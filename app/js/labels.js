// 画面に出す呼び方。iPhone の画面（main.js）と PC の画面（pc.js）で同じ言い方にするため、ここにまとめる。
import { yen, owed, isPerson, personName } from './calc.js';

export const walletOf = (S, id) => S.wallets.find(w => w.id === id) || { id, name: '?' };
export const catOf = (S, id) => S.cats.find(c => c.id === id) || { id, name: '（消した分類）', kind: 'out', wallet: 'me' };
// 貸し借りの相手の名前（財布なら財布の名前、人ならその名前）
export const partyName = (S, id) => isPerson(id) ? personName(id) : walletOf(S, id).name;

// 「debtor が creditor に あと n 円返す」の言い方
export function owesText(S, debtor, creditor, n) {
  const N = id => partyName(S, id);
  if (isPerson(debtor)) return `${N(debtor)}に ${yen(n)}円 貸している（${N(creditor)}の財布）`;
  if (isPerson(creditor)) return `${N(creditor)}に ${yen(n)}円 借りている（${N(debtor)}の財布）`;
  return `${N(debtor)}が${N(creditor)}に ${yen(n)}円 借りている`;
}
export function pairText(S, a, b) {
  const n = owed(S, a, b);
  return n > 0 ? owesText(S, a, b, n) : n < 0 ? owesText(S, b, a, -n) : '貸し借りなし';
}

export function recLabel(S, x) {
  if (x.kind === 'move') return `移動 ${walletOf(S, x.wallet).name} → ${walletOf(S, x.to).name}`;
  if (x.kind === 'adj') return `残高合わせ（${walletOf(S, x.wallet).name}）`;
  if (x.kind === 'loan') return `貸し借り ${partyName(S, x.wallet)} → ${partyName(S, x.to)}`;
  return catOf(S, x.cat).name;
}
// totals() の移動の鍵（'co>me'）を「会社 → 自分」に
export function moveLabel(S, k) {
  const [a, b] = k.split('>');
  return `${walletOf(S, a).name} → ${walletOf(S, b).name}`;
}
export const monthLabel = key => { const [y, m] = key.split('-'); return `${y}年${Number(m)}月`; };
export const wColor = id => `var(--w-${['co', 'me', 'inv'].includes(id) ? id : 'me'})`;
