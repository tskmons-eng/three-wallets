import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../app/js/csv.js';
import { defaultState } from '../app/js/calc.js';

test('CSV：Excel で開ける形（BOM・CRLF）で、種類ごとに から・へ が入る', () => {
  const S = defaultState('2026-10-01');
  const recs = [
    { date: '2026-10-02', kind: 'out', amount: 1200, wallet: 'me', cat: 'food', memo: 'ラーメン, 大盛り' },
    { date: '2026-10-03', kind: 'in', amount: 500000, wallet: 'co', cat: 'sale', memo: '"アルファード"' },
    { date: '2026-10-04', kind: 'move', amount: 30000, wallet: 'me', to: 'inv', memo: 'つみたて', fixedId: 'f' },
    { date: '2026-10-05', kind: 'loan', amount: 30000, wallet: 'me', to: 'p:田中', memo: '' },
    { date: '2026-10-06', kind: 'adj', amount: -800, wallet: 'me', memo: '=1+1' },
  ];
  const csv = toCsv(S, recs);
  assert.ok(csv.startsWith('﻿日付,種類,分類,から,へ,金額,メモ,自動,紐づけ\r\n'));
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 6);
  assert.equal(lines[1], '2026-10-02,支出,食費,自分,,1200,"ラーメン, 大盛り",,');
  assert.equal(lines[2], '2026-10-03,収入,売上,,会社,500000,"""アルファード""",,');
  assert.equal(lines[3], '2026-10-04,移動,,自分,投資,30000,つみたて,固定費,');
  assert.equal(lines[4], '2026-10-05,貸し借り,,自分,田中,30000,,,');
  assert.equal(lines[5], "2026-10-06,残高合わせ,,自分,,-800,'=1+1,,", '式として動かないように');
});

test('CSV：紐づいた記録には、まとまりの名前が入る', () => {
  const S = defaultState('2026-10-01');
  const recs = [
    { id: 'a', date: '2026-10-03', kind: 'out', amount: 20000, wallet: 'co', cat: 'buy', memo: 'プリウス', link: 'a' },
    { id: 'b', date: '2026-10-20', kind: 'in', amount: 40000, wallet: 'co', cat: 'sale', memo: '', link: 'a' },
    { id: 'c', date: '2026-10-21', kind: 'out', amount: 500, wallet: 'me', cat: 'food', memo: '' },
  ];
  S.recs = recs;
  const lines = toCsv(S, recs).slice(1).trimEnd().split('\r\n');
  assert.ok(lines[1].endsWith(',プリウス')); assert.ok(lines[2].endsWith(',プリウス')); assert.ok(lines[3].endsWith(',,'));
});
