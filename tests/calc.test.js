import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance, totals, monthDelta, applyFixed, defaultState, shiftMonth } from '../app/js/calc.js';
import { deriveId, deriveKey, seal, open } from '../app/js/backup.js';

function base() {
  const S = defaultState('2026-09-15');
  S.wallets[0].init = 1000000; S.wallets[1].init = 200000; S.wallets[2].init = 500000;
  return S;
}
const rec = (o) => ({ id: Math.random().toString(36), t: 0, memo: '', ...o });

test('残金：支出・収入・移動・残高合わせがそれぞれ正しく効く', () => {
  const S = base();
  S.recs.push(
    rec({ date: '2026-10-01', kind: 'in', amount: 300000, wallet: 'co', cat: 'sale' }),
    rec({ date: '2026-10-02', kind: 'out', amount: 5000, wallet: 'co', cat: 'gas' }),
    rec({ date: '2026-10-03', kind: 'move', amount: 100000, wallet: 'co', to: 'me' }),
    rec({ date: '2026-10-04', kind: 'move', amount: 30000, wallet: 'me', to: 'inv' }),
    rec({ date: '2026-10-05', kind: 'adj', amount: -1200, wallet: 'me' }),
  );
  assert.equal(balance(S, 'co'), 1000000 + 300000 - 5000 - 100000);
  assert.equal(balance(S, 'me'), 200000 + 100000 - 30000 - 1200);
  assert.equal(balance(S, 'inv'), 500000 + 30000);
  // 3つの合計は、外との出入り（収入−支出＋残高合わせ）だけ動く
  const all = ['co', 'me', 'inv'].reduce((a, w) => a + balance(S, w), 0);
  assert.equal(all, 1700000 + 300000 - 5000 - 1200);
});

test('分類別の合計：移動と残高合わせは支出にも収入にも数えない', () => {
  const S = base();
  S.recs.push(
    rec({ date: '2026-10-01', kind: 'in', amount: 300000, wallet: 'co', cat: 'sale' }),
    rec({ date: '2026-10-02', kind: 'out', amount: 5000, wallet: 'co', cat: 'gas' }),
    rec({ date: '2026-10-09', kind: 'out', amount: 2000, wallet: 'me', cat: 'food' }),
    rec({ date: '2026-10-10', kind: 'out', amount: 1500, wallet: 'me', cat: 'food' }),
    rec({ date: '2026-10-03', kind: 'move', amount: 100000, wallet: 'co', to: 'me' }),
    rec({ date: '2026-10-05', kind: 'adj', amount: -1200, wallet: 'me' }),
    rec({ date: '2026-09-30', kind: 'out', amount: 9999, wallet: 'me', cat: 'food' }),
  );
  const t = totals(S, '2026-10');
  assert.equal(t.tin, 300000);
  assert.equal(t.tout, 8500);
  assert.equal(t.out.food, 3500);
  assert.equal(t.mv['co>me'], 100000);
  const me = totals(S, '2026-10', 'me');
  assert.equal(me.tout, 3500);
  assert.equal(me.mv['co>me'], 100000, '移動は、入った側の財布で絞っても出る');
  assert.equal(monthDelta(S, 'me', '2026-10'), -3500 + 100000 - 1200);
});

test('固定費：登録した日より後の分だけ、月1回、自動で入る。消しても入り直さない', () => {
  const S = base();
  S.fixed.push(
    { id: 'f1', name: '家賃', amount: 85000, day: 27, wallet: 'me', cat: 'fix', from: '2026-09-15', done: [] },
    { id: 'f2', name: '保険', amount: 12000, day: 5, wallet: 'me', cat: 'fix', from: '2026-09-15', done: [] },
    { id: 'f3', name: 'つみたて', amount: 30000, day: 31, wallet: 'me', to: 'inv', from: '2026-09-15', done: [] },
  );
  // 家賃9月27日・つみたて9月30日（31日が無い月は末日）・保険10月5日。家賃10月27日はまだ先
  assert.equal(applyFixed(S, '2026-10-21'), 3);
  const dates = S.recs.map(r => r.memo + r.date).sort();
  assert.deepEqual(dates, ['つみたて2026-09-30', '保険2026-10-05', '家賃2026-09-27'].sort());
  assert.ok(!S.recs.some(r => r.memo === '保険' && r.date === '2026-09-05'), '登録より前の9月5日の分は入らない');
  assert.equal(S.recs.find(r => r.memo === 'つみたて').kind, 'move');
  assert.equal(applyFixed(S, '2026-10-21'), 0, '2回目は何も入らない');
  S.recs = S.recs.filter(r => r.memo !== '保険');
  assert.equal(applyFixed(S, '2026-10-21'), 0, '自動で入った記録を消しても、入り直さない');
  // 家賃10〜12月・保険11〜1月・つみたて10〜12月
  assert.equal(applyFixed(S, '2027-01-10'), 9, '何か月も開かなかった分もまとめて入る');
});

test('固定費：登録した当日の分は入れない（日付を決める前に入ってしまわないように）', () => {
  const S = base();
  S.fixed.push({ id: 'f', name: '家賃', amount: 85000, day: 21, wallet: 'me', cat: 'fix', from: '2026-10-21', done: [] });
  assert.equal(applyFixed(S, '2026-10-21'), 0);
  assert.equal(applyFixed(S, '2026-11-21'), 1);
});

test('月をまたぐ計算（12月→1月、2月の末日）', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  const S = base();
  S.fixed.push({ id: 'f', name: '月末', amount: 100, day: 31, wallet: 'me', cat: 'fix', from: '2027-02-01', done: [] });
  applyFixed(S, '2027-03-01');
  assert.equal(S.recs[0].date, '2027-02-28');
});

test('バックアップ：暗号化して、同じ合言葉で元どおりに戻る。違う合言葉では戻らない', async () => {
  const S = base(); S.recs.push(rec({ date: '2026-10-01', kind: 'in', amount: 1, wallet: 'co', cat: 'sale', memo: '日本語のメモ' }));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey('正しい合言葉1234', salt);
  const blob = await seal(S, key, salt);
  assert.ok(!JSON.stringify(blob).includes('日本語'), '中身は読めない');
  const back = await open(blob, '正しい合言葉1234');
  assert.deepEqual(back.state, S);
  await assert.rejects(open(blob, 'ちがう合言葉1234'), /合言葉が違う/);
  assert.equal(await deriveId('正しい合言葉1234'), await deriveId('正しい合言葉1234'), '新しいiPhoneでも同じIDになる');
  assert.notEqual(await deriveId('正しい合言葉1234'), await deriveId('ちがう合言葉1234'));
});
