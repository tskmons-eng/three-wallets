// PC で見るだけの画面。合言葉でサーバーの最新のバックアップを取ってきて、この画面の中だけで開く。
// 送らない・直さない・保存しない（閉じれば何も残らない）。計算は calc.js、呼び方は labels.js を iPhone と共通で使う。
import { yen, monthOf, shiftMonth, ymd, balance, totals, loanPositions, netWorth, effect } from './calc.js';
import * as bk from './backup.js';
import * as L from './labels.js';
import { toCsv } from './csv.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null, got = '';
const V = { month: monthOf(ymd(new Date())), wf: 'all', hw: 'all', hc: '', hq: '', err: '', busy: false };

function login() {
  $('#app').innerHTML = `<div class="pcwrap login">
    <h1>3つの財布（PCで見る）</h1>
    <p>iPhone で決めた合言葉を入れると、自社サーバーの最新のバックアップをこの画面の中で開きます。見るだけです。合言葉もデータもこのPCには残りません。</p>
    <form id="lf"><label class="lbl">合言葉<input id="pw" type="password" autocomplete="current-password" autofocus></label>
    <p class="err">${esc(V.err)}</p>
    <button class="btn" ${V.busy ? 'disabled' : ''}>${V.busy ? '開いています…' : '開く'}</button></form></div>`;
  $('#lf').addEventListener('submit', async e => {
    e.preventDefault();
    const pass = $('#pw').value;
    if (!pass) return;
    V.busy = true; V.err = ''; // 手元で試すときだけ、手元で動かした受け口に向ける（公開先では効かない）
const testServer = new URLSearchParams(location.search).get('server');
if (testServer && location.hostname === 'localhost') bk.setServer(testServer);
login();
    try {
      const { blob, date } = await bk.fetchLatest(await bk.deriveId(pass));
      S = (await bk.open(blob, pass)).state; got = blob.at || date;
      V.busy = false; render();
    } catch (err) {
      V.busy = false; V.err = err.status === 404 ? 'バックアップが見つかりません' : err.message; login();
    }
  });
}

// 記録の一覧（画面の表と CSV で同じ絞り込みを使う）
function filtered() {
  const q = V.hq.trim();
  return S.recs.filter(r => (V.hw === 'all' || r.wallet === V.hw || r.to === V.hw) && (!V.hc || r.cat === V.hc)
    && (!q || (r.memo || '').includes(q) || L.recLabel(S, r).includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.t || 0) - (a.t || 0));
}
function downloadCsv() {
  const list = filtered().slice().reverse();   // CSV は古い順
  const blob = new Blob([toCsv(S, list)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `3つの財布_${ymd(d)}${V.hw !== 'all' || V.hc || V.hq ? '_絞り込み' : ''}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function render() {
  const W = id => L.walletOf(S, id), C = id => L.catOf(S, id);
  const all = S.wallets.reduce((a, w) => a + balance(S, w.id), 0), nw = netWorth(S);
  const pos = loanPositions(S);
  const key = V.month, prev = shiftMonth(key, -1);
  const t = totals(S, key, V.wf), p = totals(S, prev, V.wf);
  const at = new Date(got);

  const catTable = (obj, pobj, cls) => {
    const ks = Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
    if (!ks.length) return '<p class="empty">ありません</p>';
    const sum = ks.reduce((a, k) => a + obj[k], 0);
    return `<table><thead><tr><th>分類</th><th>財布</th><th class="r">${L.monthLabel(key)}</th><th class="r">先月</th><th class="r">割合</th></tr></thead><tbody>
      ${ks.map(k => `<tr><td>${esc(C(k).name)}</td><td><span class="tag" style="background:${L.wColor(C(k).wallet)}">${esc(W(C(k).wallet).name)}</span></td>
        <td class="r num ${cls}">${yen(obj[k])}</td><td class="r num muted">${pobj[k] ? yen(pobj[k]) : '—'}</td><td class="r num muted">${Math.round(obj[k] / sum * 100)}%</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="2">合計</td><td class="r num ${cls}">${yen(sum)}</td><td></td><td></td></tr></tfoot></table>`;
  };

  // 12か月の推移
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(key, i - 11));
  const mt = months.map(m => totals(S, m, V.wf));
  const catSum = {};
  for (const x of mt) for (const [k, v] of Object.entries(x.out)) catSum[k] = (catSum[k] || 0) + v;
  const topCats = Object.keys(catSum).sort((a, b) => catSum[b] - catSum[a]).slice(0, 10);
  const short = m => Number(m.slice(5)) + '月';

  const list = filtered();
  const amtCell = r => {
    if (V.hw !== 'all') { const e = effect(r, V.hw); return `<td class="r num ${e > 0 ? 'i' : e < 0 ? 'o' : ''}">${e > 0 ? '+' : e < 0 ? '−' : ''}${yen(Math.abs(e))}</td>`; }
    const s = r.kind === 'in' ? '+' : r.kind === 'out' ? '−' : r.kind === 'adj' && r.amount >= 0 ? '+' : '';
    return `<td class="r num ${r.kind === 'in' ? 'i' : r.kind === 'out' ? 'o' : ''}">${s}${yen(r.amount)}</td>`;
  };
  const kindName = { in: '収入', out: '支出', move: '移動', loan: '貸し借り', adj: '残高合わせ' };

  $('#app').innerHTML = `<div class="pcwrap">
  <header class="pchead"><h1>3つの財布</h1>
    <span class="muted">バックアップ ${esc(isNaN(at) ? got : `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`)} の時点・見るだけ（記録は iPhone で）</span>
    <button class="btn ghost small" id="reload">最新を取り直す</button></header>

  <section class="grid4">
    ${S.wallets.map(w => `<div class="card"><span class="wdot sm" style="background:${L.wColor(w.id)}"></span><div><small>${esc(w.name)}の財布</small><b class="num">${yen(balance(S, w.id))}</b></div></div>`).join('')}
    <div class="card total"><div><small>3つの合計</small><b class="num">${yen(all)}</b>${nw !== all ? `<small>人との貸し借りを含めると ${yen(nw)}</small>` : ''}</div></div>
  </section>

  ${pos.length ? `<section><h2>貸し借りの残り</h2><table><tbody>${pos.map(x => `<tr><td>${esc(L.partyName(S, x.debtor))} → ${esc(L.partyName(S, x.creditor))}へ返す</td><td class="muted">${esc(L.owesText(S, x.debtor, x.creditor, x.amount))}</td><td class="r num">${yen(x.amount)}</td></tr>`).join('')}</tbody></table></section>` : ''}

  <section>
    <div class="bar"><h2>内訳</h2>
      <div class="mnav"><button data-m="-1" aria-label="前の月">‹</button><span>${L.monthLabel(key)}</span><button data-m="1" aria-label="次の月">›</button></div>
      <div class="chips">${[['all', '全部'], ...S.wallets.map(w => [w.id, w.name])].map(([id, n]) => `<button class="chip" data-wf="${id}" aria-pressed="${V.wf === id}">${esc(n)}</button>`).join('')}</div>
      <span class="sumline">入った <b class="num i">${yen(t.tin)}</b>　出た <b class="num o">${yen(t.tout)}</b>　差し引き <b class="num">${t.tin - t.tout >= 0 ? '+' : ''}${yen(t.tin - t.tout)}</b></span></div>
    <div class="cols">
      <div><h3>出たお金</h3>${catTable(t.out, p.out, 'o')}</div>
      <div><h3>入ったお金</h3>${catTable(t.inn, p.inn, 'i')}
        <h3>財布の間の移動</h3>${Object.keys(t.mv).length ? `<table><tbody>${Object.entries(t.mv).map(([k, v]) => `<tr><td>${esc(L.moveLabel(S, k))}</td><td class="r num">${yen(v)}</td><td class="r num muted">${p.mv[k] ? yen(p.mv[k]) : '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">ありません</p>'}</div>
    </div>
  </section>

  <section><h2>12か月の推移${V.wf === 'all' ? '' : '（' + esc(W(V.wf).name) + '）'}</h2><div class="scroll"><table class="trend">
    <thead><tr><th></th>${months.map(m => `<th class="r">${short(m)}</th>`).join('')}<th class="r">合計</th></tr></thead>
    <tbody>
      <tr><td>入った</td>${mt.map(x => `<td class="r num i">${x.tin ? yen(x.tin) : ''}</td>`).join('')}<td class="r num i">${yen(mt.reduce((a, x) => a + x.tin, 0))}</td></tr>
      <tr><td>出た</td>${mt.map(x => `<td class="r num o">${x.tout ? yen(x.tout) : ''}</td>`).join('')}<td class="r num o">${yen(mt.reduce((a, x) => a + x.tout, 0))}</td></tr>
      <tr class="strong"><td>差し引き</td>${mt.map(x => `<td class="r num">${x.tin || x.tout ? yen(x.tin - x.tout) : ''}</td>`).join('')}<td class="r num">${yen(mt.reduce((a, x) => a + x.tin - x.tout, 0))}</td></tr>
      ${topCats.map(k => `<tr class="sub"><td>${esc(C(k).name)}</td>${mt.map(x => `<td class="r num muted">${x.out[k] ? yen(x.out[k]) : ''}</td>`).join('')}<td class="r num">${yen(catSum[k])}</td></tr>`).join('')}
    </tbody></table></div></section>

  <section><div class="bar"><h2>記録</h2>
    <select id="hw" aria-label="財布">${[['all', '全部の財布'], ...S.wallets.map(w => [w.id, w.name])].map(([id, n]) => `<option value="${id}" ${V.hw === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <select id="hc" aria-label="分類"><option value="">全部の分類</option>${S.cats.map(c => `<option value="${c.id}" ${V.hc === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <input id="hq" type="search" placeholder="メモや分類で探す" value="${esc(V.hq)}">
    <span class="muted">${list.length}件${list.length > 500 ? '（新しい500件を表示）' : ''}</span>
    <button class="btn ghost small" id="csv" ${list.length ? '' : 'disabled'}>この${list.length}件をCSVで書き出す</button></div>
    <div class="scroll"><table><thead><tr><th>日付</th><th>種類</th><th>内容</th><th>財布</th><th>メモ</th><th class="r">金額</th></tr></thead><tbody>
    ${list.slice(0, 500).map(r => `<tr><td class="num">${esc(r.date)}</td><td>${kindName[r.kind] || ''}</td><td>${esc(L.recLabel(S, r))}</td>
      <td>${r.kind === 'in' || r.kind === 'out' || r.kind === 'adj' ? esc(W(r.wallet).name) : ''}</td><td class="muted">${esc(r.memo)}${r.fixedId ? '（自動）' : ''}</td>${amtCell(r)}</tr>`).join('')}
    </tbody></table></div></section>
  </div>`;
}

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !S) return;
  if (b.dataset.m) { V.month = shiftMonth(V.month, Number(b.dataset.m)); render(); }
  else if (b.dataset.wf) { V.wf = b.dataset.wf; render(); }
  else if (b.id === 'reload') { S = null; login(); }
  else if (b.id === 'csv') downloadCsv();
});
document.addEventListener('change', e => {
  if (!S) return;
  if (e.target.id === 'hw') { V.hw = e.target.value; render(); }
  if (e.target.id === 'hc') { V.hc = e.target.value; render(); }
});
let qTimer;
document.addEventListener('input', e => {
  if (!S || e.target.id !== 'hq') return;
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { V.hq = e.target.value; render(); const el = $('#hq'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250);
});
login();
