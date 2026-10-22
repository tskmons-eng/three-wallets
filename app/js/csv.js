// 記録を CSV にする（PC の画面で書き出す用）。Excel でそのまま開けるように、先頭に BOM、改行は CRLF。
import { catOf, partyName } from './labels.js';

const KIND = { in: '収入', out: '支出', move: '移動', loan: '貸し借り', adj: '残高合わせ' };

// 1つの欄。カンマ・ダブルクォート・改行を含むときは囲む。式として動かないように =+-@ で始まるものは ' を前に付ける
function cell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(S, recs) {
  const head = ['日付', '種類', '分類', 'から', 'へ', '金額', 'メモ', '自動'];
  const rows = recs.map(r => {
    const from = r.kind === 'in' ? '' : partyName(S, r.wallet);
    const to = r.kind === 'in' ? partyName(S, r.wallet) : r.kind === 'move' || r.kind === 'loan' ? partyName(S, r.to) : '';
    return [r.date, KIND[r.kind] || r.kind, r.kind === 'in' || r.kind === 'out' ? catOf(S, r.cat).name : '', from, to, r.amount, r.memo || '', r.fixedId ? '固定費' : ''];
  });
  return '﻿' + [head, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
