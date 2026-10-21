// お金の計算。残金や合計は保存せず、毎回すべての記録から出す（CLAUDE.md 3章）。
// 画面には触らない純粋な関数だけを置く（tests/calc.test.js で確かめる）。

export const pad = n => String(n).padStart(2, '0');
export const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const monthOf = date => date.slice(0, 7);
export const yen = n => (n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('ja-JP');
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  return ymd(new Date(y, m - 1 + n, 1)).slice(0, 7);
}
function lastDay(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// 1件の記録が、その財布の残金をいくら動かすか
export function effect(rec, wid) {
  switch (rec.kind) {
    case 'in': return rec.wallet === wid ? rec.amount : 0;
    case 'out': return rec.wallet === wid ? -rec.amount : 0;
    case 'adj': return rec.wallet === wid ? rec.amount : 0;
    case 'move':
    case 'loan': return (rec.to === wid ? rec.amount : 0) - (rec.wallet === wid ? rec.amount : 0);
  }
  return 0;
}

export function balance(S, wid) {
  const w = S.wallets.find(x => x.id === wid);
  let b = w ? Number(w.init) || 0 : 0;
  for (const r of S.recs) b += effect(r, wid);
  return b;
}

const inWallet = (r, wf) => wf === 'all' || r.wallet === wf || r.to === wf;

export function monthDelta(S, wid, key) {
  let d = 0;
  for (const r of S.recs) if (monthOf(r.date) === key) d += effect(r, wid);
  return d;
}

// その月の分類ごとの合計。移動は支出にも収入にも数えない。残高合わせも数えない
export function totals(S, key, wf = 'all') {
  const out = {}, inn = {}, mv = {};
  let tin = 0, tout = 0;
  for (const r of S.recs) {
    if (monthOf(r.date) !== key || !inWallet(r, wf)) continue;
    if (r.kind === 'out') { out[r.cat] = (out[r.cat] || 0) + r.amount; tout += r.amount; }
    else if (r.kind === 'in') { inn[r.cat] = (inn[r.cat] || 0) + r.amount; tin += r.amount; }
    else if (r.kind === 'move') { const k = r.wallet + '>' + r.to; mv[k] = (mv[k] || 0) + r.amount; }
  }
  return { out, inn, mv, tin, tout };
}

// 固定費：登録した日の翌日以降で、まだ入れていない月の分を入れる（登録した当日の分は入れない。日付を決める前に入ってしまうため）。
// 入れた月は f.done に残すので、自動で入った記録を消しても、もう一度は入らない。
// 何か月も開かなかったときは、その間の月の分もまとめて入る。戻り値は足した件数。
export function applyFixed(S, todayStr) {
  let added = 0;
  const end = monthOf(todayStr);
  for (const f of S.fixed) {
    if (!(f.amount > 0) || !f.from) continue;
    f.done = f.done || [];
    for (let key = monthOf(f.from); key <= end; key = shiftMonth(key, 1)) {
      const date = key + '-' + pad(Math.min(Math.max(1, f.day | 0), lastDay(key)));
      if (date <= f.from || date > todayStr || f.done.includes(key)) continue;
      f.done.push(key);
      let amount = Number(f.amount);
      if (f.loanTo) {
        // 毎月の返済：残りより多くは返さない。返し終わっていたら、その月は飛ばす
        amount = Math.min(amount, owed(S, f.wallet, f.loanTo));
        if (amount <= 0) continue;
      }
      const base = { id: uid(), date, amount, wallet: f.wallet, memo: f.name, fixedId: f.id, t: Date.now() };
      S.recs.push(f.loanTo ? { ...base, kind: 'loan', to: f.loanTo } : f.to ? { ...base, kind: 'move', to: f.to } : { ...base, kind: 'out', cat: f.cat });
      added++;
    }
  }
  return added;
}

// ---------- 貸し借り ----------
// 相手は財布の id（co / me / inv）か、人なら 'p:名前'。返すのも逆向きの貸し借りとして記録する。
// 残り＝「A→B の合計 − B→A の合計」。保存せず毎回計算する。
export const isPerson = id => typeof id === 'string' && id.startsWith('p:');
export const personName = id => id.slice(2);
const pairKey = (a, b) => JSON.stringify(a < b ? [a, b] : [b, a]);

// debtor（返す側）が creditor（返してもらう側）に、あといくら返すか。マイナスなら逆向き
export function owed(S, debtor, creditor) {
  let n = 0;
  for (const r of S.recs) {
    if (r.kind !== 'loan') continue;
    if (r.wallet === creditor && r.to === debtor) n += r.amount;
    else if (r.wallet === debtor && r.to === creditor) n -= r.amount;
  }
  return n;
}

// 残りがある組み合わせの一覧。[{ debtor, creditor, amount, recs }]（残りの大きい順）
export function loanPositions(S) {
  const map = new Map();
  for (const r of S.recs) {
    if (r.kind !== 'loan') continue;
    const k = pairKey(r.wallet, r.to);
    if (!map.has(k)) map.set(k, { a: r.wallet < r.to ? r.wallet : r.to, b: r.wallet < r.to ? r.to : r.wallet, recs: [] });
    map.get(k).recs.push(r);
  }
  const out = [];
  for (const { a, b, recs } of map.values()) {
    const n = owed(S, a, b);
    if (n > 0) out.push({ debtor: a, creditor: b, amount: n, recs });
    else if (n < 0) out.push({ debtor: b, creditor: a, amount: -n, recs });
  }
  return out.sort((x, y) => y.amount - x.amount);
}

// 人との貸し借りを含めた本当の合計（財布どうしの貸し借りは合計を変えない）
export function netWorth(S) {
  let n = S.wallets.reduce((a, w) => a + balance(S, w.id), 0);
  for (const p of loanPositions(S)) {
    if (isPerson(p.debtor) && !isPerson(p.creditor)) n += p.amount;
    if (isPerson(p.creditor) && !isPerson(p.debtor)) n -= p.amount;
  }
  return n;
}

export function people(S) {
  const set = new Set();
  for (const r of S.recs) if (r.kind === 'loan') for (const x of [r.wallet, r.to]) if (isPerson(x)) set.add(x);
  for (const f of S.fixed) if (isPerson(f.loanTo)) set.add(f.loanTo);
  return [...set];
}

// 分類ボタンの並び：よく使う順
export function usage(S) {
  const u = {};
  for (const r of S.recs) if (r.cat) u[r.cat] = (u[r.cat] || 0) + 1;
  return u;
}

export function defaultState(todayStr) {
  return {
    ver: 1,
    startDate: todayStr,
    wallets: [
      { id: 'co', name: '会社', init: 0 },
      { id: 'me', name: '自分', init: 0 },
      { id: 'inv', name: '投資', init: 0 },
    ],
    cats: [
      { id: 'fix', name: '固定費', kind: 'out', wallet: 'me' },
      { id: 'food', name: '食費', kind: 'out', wallet: 'me' },
      { id: 'life', name: '日用品', kind: 'out', wallet: 'me' },
      { id: 'fun', name: '遊び', kind: 'out', wallet: 'me' },
      { id: 'gas', name: 'ガソリン', kind: 'out', wallet: 'co' },
      { id: 'buy', name: '仕入れ', kind: 'out', wallet: 'co' },
      { id: 'cexp', name: '会社経費', kind: 'out', wallet: 'co' },
      { id: 'cfix', name: '会社の固定費', kind: 'out', wallet: 'co' },
      { id: 'sale', name: '売上', kind: 'in', wallet: 'co' },
      { id: 'pay', name: '給料', kind: 'in', wallet: 'me' },
      { id: 'oin', name: 'その他の収入', kind: 'in', wallet: 'me' },
    ],
    fixed: [],
    recs: [],
  };
}

// バックアップから戻したデータが使える形か
export function isValidState(S) {
  return !!S && S.ver === 1 && Array.isArray(S.wallets) && Array.isArray(S.cats) && Array.isArray(S.fixed) && Array.isArray(S.recs);
}
