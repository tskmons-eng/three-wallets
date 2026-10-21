import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance, totals, owed, loanPositions, netWorth, applyFixed, defaultState, people } from '../app/js/calc.js';

const loan = (date, from, to, amount) => ({ id: Math.random().toString(36), t: 0, memo: '', date, kind: 'loan', wallet: from, to, amount });
function start() {
  const S = defaultState('2026-09-01');
  S.wallets[0].init = 2000000; S.wallets[1].init = 300000; S.wallets[2].init = 1000000;
  return S;
}
const bal = S => ['co', 'me', 'inv'].map(w => balance(S, w));

test('理解確認の例の数字どおりになる', () => {
  const S = start();
  S.recs.push(loan('2026-10-01', 'co', 'me', 500000));
  assert.deepEqual(bal(S), [1500000, 800000, 1000000]);
  S.recs.push(loan('2026-10-02', 'inv', 'me', 200000));
  assert.deepEqual(bal(S), [1500000, 1000000, 800000]);
  S.recs.push(loan('2026-10-03', 'me', 'co', 300000));
  assert.deepEqual(bal(S), [1800000, 700000, 800000]);
  S.recs.push(loan('2026-10-04', 'me', 'p:田中', 30000));
  assert.deepEqual(bal(S), [1800000, 670000, 800000]);

  assert.equal(owed(S, 'me', 'co'), 200000);
  assert.equal(owed(S, 'me', 'inv'), 200000);
  assert.equal(owed(S, 'p:田中', 'me'), 30000);
  assert.equal(owed(S, 'co', 'me'), -200000, '逆向きはマイナス');
  const pos = loanPositions(S).map(p => `${p.debtor}>${p.creditor}:${p.amount}`).sort();
  assert.deepEqual(pos, ['me>co:200000', 'me>inv:200000', 'p:田中>me:30000']);
  assert.equal(bal(S).reduce((a, b) => a + b), 3270000);
  assert.equal(netWorth(S), 3300000);
  assert.deepEqual(people(S), ['p:田中']);
});

test('貸し借りは支出にも収入にも、移動の合計にも数えない', () => {
  const S = start();
  S.recs.push(loan('2026-10-01', 'co', 'me', 500000), loan('2026-10-05', 'p:田中', 'me', 50000));
  const t = totals(S, '2026-10');
  assert.equal(t.tin, 0); assert.equal(t.tout, 0); assert.deepEqual(t.mv, {});
});

test('全部返したら残りの一覧から消える。人から借りると本当の合計は増えない', () => {
  const S = start();
  S.recs.push(loan('2026-10-01', 'p:佐藤', 'me', 100000));
  assert.equal(netWorth(S), 3300000, '現金は10万増えるが、返すお金なので本当の合計は同じ');
  S.recs.push(loan('2026-10-10', 'me', 'p:佐藤', 100000));
  assert.deepEqual(loanPositions(S), []);
});

test('毎月の返済：残りより多くは返さず、返し終わったら止まり、後で借りてもさかのぼらない', () => {
  const S = start();
  S.recs.push(loan('2026-09-10', 'co', 'me', 250000));
  S.fixed.push({ id: 'r', name: '会社へ返済', amount: 100000, day: 25, wallet: 'me', loanTo: 'co', from: '2026-09-15', done: [] });
  assert.equal(applyFixed(S, '2026-11-30'), 3); // 9月10万・10月10万・11月は残り5万だけ
  assert.deepEqual(S.recs.filter(r => r.fixedId).map(r => r.amount), [100000, 100000, 50000]);
  assert.equal(owed(S, 'me', 'co'), 0);
  assert.equal(applyFixed(S, '2027-01-30'), 0, '返し終わった月は飛ばす');
  S.recs.push(loan('2027-02-01', 'co', 'me', 80000));
  assert.equal(applyFixed(S, '2027-02-26'), 1, '飛ばした12月・1月はさかのぼらず、2月の分だけ');
  assert.equal(S.recs.at(-1).amount, 80000);
  assert.equal(S.recs.at(-1).kind, 'loan');
});
