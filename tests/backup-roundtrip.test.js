// バックアップの往復を通しで試す：暗号化 → 手元で動かした受け口へ送る → 取ってくる → 同じ合言葉で戻す。
// 本物のサーバーには触らない。php が無い環境では飛ばす。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bk from '../app/js/backup.js';
import { defaultState } from '../app/js/calc.js';

const hasPhp = spawnSync('php', ['-v']).status === 0;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('バックアップの往復（手元の受け口で）', { skip: !hasPhp && 'php が無いので飛ばす' }, async t => {
  const data = mkdtempSync(join(tmpdir(), 'wallet-'));
  const port = 8800 + Math.floor(Math.random() * 100);
  const php = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', join(root, 'server')], { env: { ...process.env, WALLET_BACKUP_DATA: data }, stdio: 'ignore' });
  t.after(() => { php.kill(); rmSync(data, { recursive: true, force: true }); });
  await new Promise(r => setTimeout(r, 800));
  bk.setServer(`http://127.0.0.1:${port}/index.php`);

  const pass = 'テスト用の合言葉-roundtrip';
  const S = defaultState('2026-10-01');
  S.recs.push({ id: 'a', date: '2026-10-02', kind: 'out', amount: 1200, wallet: 'me', cat: 'food', memo: 'ラーメン' });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const [id, key] = await Promise.all([bk.deriveId(pass), bk.deriveKey(pass, salt)]);

  await assert.rejects(bk.fetchLatest(id), e => e.status === 404, '登録前は見つからない');
  const res = await bk.push(id, await bk.seal(S, key, salt));
  assert.equal(res.ok, true);

  // 新しいiPhone：合言葉だけで同じIDを作り、取ってきて戻す
  const id2 = await bk.deriveId(pass);
  const { blob, date } = await bk.fetchLatest(id2);
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  const back = await bk.open(blob, pass);
  assert.deepEqual(back.state, S);
  // 戻したあとも同じ鍵で送り続けられる
  assert.equal((await bk.push(id2, await bk.seal(back.state, back.key, back.salt))).ok, true);
  assert.equal((await bk.listDates(id2)).length, 1);

  // 違う合言葉は、IDの時点で断られる
  await assert.rejects(bk.fetchLatest(await bk.deriveId('ちがう合言葉です')), e => e.status === 403);
});
