#!/usr/bin/env bash
# サーバーの受け口を手元で動かして、受け取る・返す・断るを確かめる。本物のサーバーには触らない。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$(mktemp -d)"; PORT=8799; U="http://127.0.0.1:$PORT/index.php"
WALLET_BACKUP_DATA="$DATA" php -S 127.0.0.1:$PORT -t "$ROOT/server" >/dev/null 2>&1 & PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$DATA"' EXIT
sleep 1
ID=$(printf 'a%.0s' {1..64}); BAD=$(printf 'b%.0s' {1..64})
ok=0; ng=0
check() { if [ "$2" = "$3" ]; then echo "✔ $1"; ok=$((ok+1)); else echo "✖ $1（期待 $3／実際 $2）"; ng=$((ng+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
check "登録前に取りに来たら404" "$(code -H "X-Backup-Id: $ID" "$U")" 404
check "IDなしは400" "$(code -X POST -d '{}' "$U")" 400
check "形が違うものは400" "$(code -X POST -H "X-Backup-Id: $ID" -d '{"x":1}' "$U")" 400
check "最初の送信で登録・保存" "$(code -X POST -H "X-Backup-Id: $ID" -d '{"v":1,"salt":"s","iv":"i","ct":"c1"}' "$U")" 200
check "同じ日は上書き" "$(code -X POST -H "X-Backup-Id: $ID" -d '{"v":1,"salt":"s","iv":"i","ct":"c2"}' "$U")" 200
check "最新を返す" "$(curl -s -H "X-Backup-Id: $ID" "$U" | grep -o '"ct":"c2"')" '"ct":"c2"'
check "別のIDは送れない" "$(code -X POST -H "X-Backup-Id: $BAD" -d '{"v":1,"salt":"s","iv":"i","ct":"x"}' "$U")" 403
check "別のIDは読めない" "$(code -H "X-Backup-Id: $BAD" "$U")" 403
check "日付の一覧" "$(curl -s -H "X-Backup-Id: $ID" "$U?list=1" | grep -c '"date"')" 1
check "変な日付は400" "$(code -H "X-Backup-Id: $ID" "$U?date=../x")" 400
check "CORS の事前確認に204" "$(code -X OPTIONS -H 'Origin: https://tskmons-eng.github.io' "$U")" 204
check "保存先は外から見えない場所" "$(ls "$DATA" | grep -c allowed.txt)" 1
for i in $(seq 1 20); do code -H "X-Backup-Id: $BAD" "$U" >/dev/null; done
check "間違いが続いたら止める" "$(code -H "X-Backup-Id: $ID" "$U")" 429
echo "通った $ok 件・失敗 $ng 件"
[ $ng -eq 0 ]
