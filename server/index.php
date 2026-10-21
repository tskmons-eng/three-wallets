<?php
// 3つの財布 — バックアップの受け口（XServer: https://seemore-grp.com/wallet-backup/）
//
// 中身は iPhone の中で合言葉により暗号化済み。ここでは読めないまま保存して返すだけ。
// 合言葉から作った「バックアップID」を X-Backup-Id ヘッダーで受け取り、その SHA-256 で持ち主を判定する。
// 最初に送ってきた1つのIDだけを登録し、それ以外は受け付けない（登録し直すときはサーバーの allowed.txt を消す）。
//
//   POST            本体＝暗号化したJSON。その日の分として保存（同じ日は上書き）。30日より古い分は消す（最低3世代は残す）
//   GET             最新の1つを返す
//   GET ?list=1     残っている日付の一覧
//   GET ?date=Y-m-d その日の分を返す

const MAX_BYTES = 8 * 1024 * 1024;
const KEEP_DAYS = 30;
const KEEP_MIN = 3;
const FAIL_LIMIT = 20;          // 1時間に、間違ったIDをこの回数送ってきたIPは止める

date_default_timezone_set('Asia/Tokyo');
$ORIGIN = getenv('WALLET_ALLOWED_ORIGIN') ?: 'https://tskmons-eng.github.io';   // テストのときだけ環境変数で変える
$DATA = getenv('WALLET_BACKUP_DATA') ?: dirname(__DIR__, 2) . '/wallet_backup_data';   // 公開フォルダの外（テストのときだけ環境変数で変える）

header('Access-Control-Allow-Origin: ' . $ORIGIN);
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Backup-Id');
header('Access-Control-Max-Age: 86400');
header('Vary: Origin');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function reply($code, $body) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function failCount($dir, $add) {
    $ip = hash('sha256', isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '');
    $file = $dir . '/fail_' . substr($ip, 0, 16) . '.txt';
    $now = time();
    $list = is_file($file) ? array_filter(array_map('intval', explode("\n", (string)file_get_contents($file))), function ($t) use ($now) { return $t > $now - 3600; }) : array();
    if ($add) { $list[] = $now; file_put_contents($file, implode("\n", $list), LOCK_EX); }
    return count($list);
}

if (!is_dir($DATA) && !mkdir($DATA, 0700, true)) reply(500, array('error' => 'サーバーの保存先を作れませんでした'));

if (failCount($DATA, false) >= FAIL_LIMIT) reply(429, array('error' => '間違いが続いたので、1時間止めています'));

$id = isset($_SERVER['HTTP_X_BACKUP_ID']) ? $_SERVER['HTTP_X_BACKUP_ID'] : '';
if (!preg_match('/^[0-9a-f]{64}$/', $id)) reply(400, array('error' => 'バックアップIDがありません'));
$owner = hash('sha256', $id);

$allowedFile = $DATA . '/allowed.txt';
$allowed = is_file($allowedFile) ? trim((string)file_get_contents($allowedFile)) : '';
$method = $_SERVER['REQUEST_METHOD'];

if ($allowed === '') {
    // まだ誰も登録していない：最初の POST だけが登録できる
    if ($method !== 'POST') reply(404, array('error' => 'バックアップがまだありません'));
    file_put_contents($allowedFile, $owner, LOCK_EX);
    chmod($allowedFile, 0600);
    $allowed = $owner;
}
if (!hash_equals($allowed, $owner)) {
    failCount($DATA, true);
    reply(403, array('error' => '合言葉が違います'));
}

$dir = $DATA . '/' . substr($owner, 0, 32);
if (!is_dir($dir)) mkdir($dir, 0700, true);

function backups($dir) {
    $files = glob($dir . '/????-??-??.json');
    rsort($files);
    return $files;
}

if ($method === 'POST') {
    $body = file_get_contents('php://input', false, null, 0, MAX_BYTES + 1);
    if ($body === false || strlen($body) === 0) reply(400, array('error' => '中身が空です'));
    if (strlen($body) > MAX_BYTES) reply(413, array('error' => '大きすぎます'));
    $json = json_decode($body, true);
    if (!is_array($json) || !isset($json['v'], $json['salt'], $json['iv'], $json['ct'])) reply(400, array('error' => '形が違います'));

    $name = $dir . '/' . date('Y-m-d') . '.json';
    $tmp = $name . '.tmp' . bin2hex(random_bytes(4));
    if (file_put_contents($tmp, $body, LOCK_EX) === false || !rename($tmp, $name)) {
        @unlink($tmp);
        reply(500, array('error' => '保存できませんでした'));
    }
    chmod($name, 0600);

    $files = backups($dir);
    $limit = date('Y-m-d', time() - KEEP_DAYS * 86400);
    foreach (array_slice($files, KEEP_MIN) as $f) {
        if (basename($f, '.json') < $limit) @unlink($f);
    }
    reply(200, array('ok' => true, 'saved' => date('c'), 'count' => count(backups($dir))));
}

if ($method === 'GET') {
    $files = backups($dir);
    if (isset($_GET['list'])) {
        reply(200, array('dates' => array_map(function ($f) { return array('date' => basename($f, '.json'), 'size' => filesize($f), 'mtime' => date('c', filemtime($f))); }, $files)));
    }
    $file = '';
    if (isset($_GET['date'])) {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['date'])) reply(400, array('error' => '日付の形が違います'));
        $file = $dir . '/' . $_GET['date'] . '.json';
        if (!is_file($file)) reply(404, array('error' => 'その日のバックアップはありません'));
    } else {
        if (!$files) reply(404, array('error' => 'バックアップがまだありません'));
        $file = $files[0];
    }
    header('Content-Type: application/json; charset=utf-8');
    header('X-Backup-Date: ' . basename($file, '.json'));
    header('Access-Control-Expose-Headers: X-Backup-Date');
    readfile($file);
    exit;
}

reply(405, array('error' => '使えない操作です'));
