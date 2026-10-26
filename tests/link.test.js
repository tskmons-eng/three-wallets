import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkGroups, linkTo, tidyLinks, balance, totals, defaultState } from '../app/js/calc.js';
import { groupName } from '../app/js/labels.js';

const rec = (id, date, kind, amount, extra) => ({ id, t: 0, date, kind, amount, wallet: 'co', memo: '', ...extra });

test('理解確認の例：仕入れ→修理→売上で、出た 40,000・入った 40,000・差し引き 0。内訳と残金は変わらない', () => {
  const S = defaultState('2026-10-01'); S.wallets[0].init = 1000000;
  const a = rec('a', '2026-10-03', 'out', 20000, { cat: 'buy', memo: 'プリウス' });
  S.recs.push(a);
  const before = { bal: balance(S, 'co') };
  const b = rec('b', '2026-10-05', 'out', 20000, { cat: 'cexp', memo: '修理' }); linkTo(S, b, a); S.recs.push(b);
  let g = linkGroups(S)[0];
  assert.equal(g.out, 40000); assert.equal(g.in, 0); assert.equal(groupName(S, g), 'プリウス');
  const c = rec('c', '2026-10-20', 'in', 40000, { cat: 'sale' }); linkTo(S, c, b); S.recs.push(c);
  g = linkGroups(S)[0];
  assert.deepEqual([g.out, g.in, g.net, g.recs.length, g.id], [40000, 40000, 0, 3, 'a'], '2件目から紐づけても同じまとまり');
  const t = totals(S, '2026-10');
  assert.deepEqual([t.out.buy, t.out.cexp, t.inn.sale], [20000, 20000, 40000], '分類ごとの内訳は今までどおり');
  assert.equal(balance(S, 'co'), before.bal - 20000 + 40000, '残金も今までどおり（紐づけても、修理の −2万と売上の +4万が普通に効くだけ）');
});

test('始まりの記録を消しても、まとまりは残る。1件になったら解く', () => {
  const S = defaultState('2026-10-01');
  const a = rec('a', '2026-10-03', 'out', 20000, { cat: 'buy', memo: 'プリウス' }), b = rec('b', '2026-10-05', 'out', 5000, { cat: 'cexp', memo: '修理' }), c = rec('c', '2026-10-06', 'in', 40000, { cat: 'sale' });
  S.recs.push(a, b, c); linkTo(S, b, a); linkTo(S, c, a);
  S.recs = S.recs.filter(r => r.id !== 'a'); tidyLinks(S);
  const g = linkGroups(S)[0];
  assert.equal(g.recs.length, 2); assert.equal(g.id, 'a'); assert.equal(groupName(S, g), '修理', '名前は残った中で一番古い記録のメモ');
  S.recs = S.recs.filter(r => r.id !== 'b'); tidyLinks(S);
  assert.deepEqual(linkGroups(S), []); assert.equal(S.recs[0].link, undefined);
});

test('人との貸し借りは数える。財布どうしは数えない。終わりにした印と名前', () => {
  const S = defaultState('2026-10-01');
  const a = rec('a', '2026-10-01', 'loan', 30000, { wallet: 'me', to: 'p:田中' }), b = rec('b', '2026-10-10', 'loan', 30000, { wallet: 'p:田中', to: 'me' }), c = rec('c', '2026-10-11', 'loan', 99999, { wallet: 'co', to: 'me' });
  S.recs.push(a, b, c); linkTo(S, b, a); linkTo(S, c, a);
  S.groups = { a: { done: true, name: '田中さんの件' } };
  const g = linkGroups(S)[0];
  assert.deepEqual([g.out, g.in, g.done], [30000, 30000, true]);
  assert.equal(groupName(S, g), '田中さんの件');
});
