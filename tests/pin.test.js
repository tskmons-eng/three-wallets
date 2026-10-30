import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinView, linkTo, defaultState } from '../app/js/calc.js';

test('追いかける印：理解確認の例の数字どおり（1件から始めて、取り戻しを紐づける）', () => {
  const S = defaultState('2026-10-01');
  const a = { id: 'a', t: 0, date: '2026-10-30', kind: 'out', amount: 20000, wallet: 'co', cat: 'buy', memo: 'プリウス' };
  S.recs.push(a);
  const pin = { id: 'a', at: '2026-10-30' };
  let v = pinView(S, pin, '2026-10-30');
  assert.deepEqual([v.out, v.in, v.rest, v.ratio, v.days, v.done], [20000, 0, 20000, 0, 1, false]);
  const b = { id: 'b', t: 1, date: '2026-11-02', kind: 'in', amount: 5000, wallet: 'co', cat: 'sale', memo: '' };
  linkTo(S, b, a); S.recs.push(b);
  v = pinView(S, pin, '2026-11-10');
  assert.deepEqual([v.rest, v.ratio, v.days], [15000, 0.25, 12], '印の id はそのまま、まとまりとして数える');
  const c = { id: 'c', t: 2, date: '2026-11-10', kind: 'in', amount: 18000, wallet: 'co', cat: 'sale', memo: '' };
  linkTo(S, c, b); S.recs.push(c);
  v = pinView(S, pin, '2026-11-10');
  assert.equal(v.done, true); assert.equal(v.in - v.out, 3000); assert.equal(v.rest, 0);
});

test('印を付けた記録が消えたら null', () => {
  const S = defaultState('2026-10-01');
  assert.equal(pinView(S, { id: 'x', at: '2026-10-30' }, '2026-10-30'), null);
});
