import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetStatus, budgetLevel, notices, defaultState, pairKey } from '../app/js/calc.js';

const out = (date, cat, amount, wallet = 'me') => ({ id: Math.random().toString(36), t: 0, memo: '', date, kind: 'out', amount, wallet, cat });

test('予算：理解確認の例の数字どおり（83%で黄、超えたら赤）', () => {
  const S = defaultState('2026-10-01');
  S.cats.find(c => c.id === 'food').budget = 30000;
  S.recs.push(out('2026-10-05', 'food', 25000), out('2026-09-30', 'food', 99999));
  let b = budgetStatus(S, '2026-10')[0];
  assert.equal(b.used, 25000); assert.equal(Math.round(b.ratio * 100), 83); assert.equal(budgetLevel(b.ratio), 'warn');
  assert.equal(notices(S, '2026-10-20')[0].id, 'budget:food:2026-10:warn');
  S.recs.push(out('2026-10-20', 'food', 6000));
  b = budgetStatus(S, '2026-10')[0];
  assert.equal(b.used - b.budget, 1000); assert.equal(budgetLevel(b.ratio), 'over');
  assert.equal(notices(S, '2026-10-20')[0].id, 'budget:food:2026-10:over', '状態が悪くなると id が変わる（消していても出る）');
  assert.equal(budgetLevel(1), 'warn', 'ちょうど予算は超えていない');
});

test('予算の無い分類・収入は出ない', () => {
  const S = defaultState('2026-10-01');
  S.recs.push(out('2026-10-05', 'fun', 50000));
  assert.deepEqual(budgetStatus(S, '2026-10'), []);
  assert.deepEqual(notices(S, '2026-10-20'), []);
});

test('返す期限：7日前から黄、過ぎたら赤、返し終わったら出ない', () => {
  const S = defaultState('2026-10-01');
  S.recs.push({ id: 'l', t: 0, memo: '', date: '2026-10-01', kind: 'loan', amount: 50000, wallet: 'co', to: 'me' });
  S.loanDue = { [pairKey('me', 'co')]: '2026-10-31' };
  assert.equal(notices(S, '2026-10-23').length, 0, '8日前は出ない');
  let n = notices(S, '2026-10-24')[0];
  assert.equal(n.level, 'warn'); assert.equal(n.days, 7); assert.equal(n.debtor, 'me'); assert.equal(n.amount, 50000);
  assert.equal(notices(S, '2026-11-01')[0].level, 'over');
  assert.equal(notices(S, '2026-11-01')[0].days, -1);
  S.recs.push({ id: 'r', t: 1, memo: '', date: '2026-10-30', kind: 'loan', amount: 50000, wallet: 'me', to: 'co' });
  assert.equal(notices(S, '2026-11-01').length, 0);
});
