import { pad, ymd, monthOf, yen, uid, shiftMonth, balance, effect, monthDelta, totals, applyFixed, usage, defaultState, isValidState, owed, loanPositions, netWorth, people, isPerson, personName, budgetStatus, budgetLevel, notices, pairKey, linkGroups, linkTo, tidyLinks, linkable, pinView } from './calc.js';
import * as store from './store.js';
import * as bk from './backup.js';
import * as L from './labels.js';

export const VERSION = '1.9.0';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => ymd(new Date());
const toNum = v => Number(String(v).replace(/[^\d]/g, '')) || 0;

let S = null;   // 家計のデータ（バックアップされる）
let M = {};     // この端末だけの情報：バックアップID・鍵・塩・最後に送れた時刻
const V = { tab: 'home', month: monthOf(today()), wf: 'all', setup: null };
let F = null;   // 開いているシート

// 呼び方は labels.js（PC の画面と同じ言い方にする）。ここでは今のデータ S を渡すだけ
const W = id => L.walletOf(S, id);
const C = id => L.catOf(S, id);
const N = id => L.partyName(S, id);
const owesText = (debtor, creditor, n) => L.owesText(S, debtor, creditor, n);
const pairText = L.pairText;
const recLabel = x => L.recLabel(S, x);
const moveLabel = k => L.moveLabel(S, k);
const monthLabel = L.monthLabel;
const wColor = L.wColor;

/* ================= 保存とバックアップ ================= */

async function save() {
  S.updatedAt = new Date().toISOString();
  await store.set('state', S);
  scheduleBackup(1500);
}
async function saveMeta() { await store.set('meta', M); }

let bkTimer = null, bkRunning = false, bkAgain = false;
function scheduleBackup(ms) { clearTimeout(bkTimer); bkTimer = setTimeout(runBackup, ms); }
async function runBackup() {
  if (!M.id || !M.key || !S) return;
  if (bkRunning) { bkAgain = true; return; }
  bkRunning = true;
  M.pending = true;
  try {
    const blob = await bk.seal(S, M.key, M.salt);
    await bk.push(M.id, blob);
    M.lastOk = Date.now(); M.lastError = ''; M.pending = false;
  } catch (e) {
    M.lastError = e.message;
  }
  await saveMeta();
  bkRunning = false;
  paintBackup();
  if (bkAgain) { bkAgain = false; scheduleBackup(500); }
}
addEventListener('online', () => { if (M.pending) scheduleBackup(500); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S) return;
  if (applyFixed(S, today())) { save(); render(); }
  if (M.pending || !M.lastOk || Date.now() - M.lastOk > 6 * 3600e3) scheduleBackup(800);
});

function backupLine() {
  if (!M.id) return `<span class="bk late" id="bk"><i></i>バックアップ未設定</span>`;
  const late = !M.lastOk || Date.now() - M.lastOk > 3 * 86400e3;
  let when = 'まだ';
  if (M.lastOk) {
    const t = new Date(M.lastOk), min = (Date.now() - M.lastOk) / 60000;
    when = min < 1 ? 'たった今' : ymd(t) === today() ? `今日 ${pad(t.getHours())}:${pad(t.getMinutes())}` : `${t.getMonth() + 1}/${t.getDate()}`;
  }
  const note = M.pending && M.lastError ? '（送れていません）' : M.pending ? '（送っています）' : '';
  return `<span class="bk ${late || (M.pending && M.lastError) ? 'late' : ''}" id="bk"><i></i>バックアップ ${when}${note}</span>`;
}
function paintBackup() {
  document.querySelectorAll('#bk').forEach(el => { el.outerHTML = backupLine(); });
  const err = $('#bkerr'); if (err) err.textContent = M.lastError || '';
}

/* ================= 画面 ================= */

function render() {
  if (V.setup) return renderSetup();
  $('#app').innerHTML = `<div class="wrap">${V.tab === 'home' ? home() : V.tab === 'hist' ? hist() : settings()}</div>
  <nav class="tabbar" aria-label="画面"><div class="in">
    <button class="tab" data-tab="home" ${V.tab === 'home' ? 'aria-current="page"' : ''}>${ico('home')}ホーム</button>
    <button class="tab" data-tab="hist" ${V.tab === 'hist' ? 'aria-current="page"' : ''}>${ico('list')}履歴</button>
    <button class="fab" data-act="new" aria-label="記録する">＋</button>
    <button class="tab" data-tab="set" ${V.tab === 'set' ? 'aria-current="page"' : ''}>${ico('gear')}設定</button>
  </div></nav>`;
}
function ico(n) {
  const p = {
    home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    list: 'M4 6h16M4 12h16M4 18h10',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 .5-1.5-1L15 4h-6l-.5 2.5-1.5 1L5 7l-2 4 2 1-2 1 2 4 2-.5 1.5 1L9 20h6l.5-2.5 1.5-1 2 .5 2-4z',
  }[n];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="${p}"/></svg>`;
}

function home() {
  const key = V.month, prevKey = shiftMonth(key, -1);
  const t = totals(S, key, V.wf), p = totals(S, prevKey, V.wf);
  const all = S.wallets.reduce((a, w) => a + balance(S, w.id), 0);
  const maxOut = Math.max(1, ...Object.values(t.out));
  const budgets = V.wf === 'all' ? Object.fromEntries(budgetStatus(S, key).map(b => [b.cat, b])) : {};
  const rows = (obj, prev, kind) => {
    const ks = Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
    if (!ks.length) return `<div class="empty">この月はまだありません</div>`;
    return ks.map(k => { const c = C(k); return `<button class="row drill" data-act="drill" data-dc="${esc(k)}">
      <div class="lab"><span class="tag" style="background:${wColor(c.wallet)}">${esc(W(c.wallet).name)}</span><span>${esc(c.name)}</span></div>
      <div class="prev num">先月 ${prev[k] ? yen(prev[k]) : '—'}</div>
      <div class="amt num ${kind}">${yen(obj[k])}${budgets[k] ? `<small class="bud">/${yen(budgets[k].budget)}</small>` : ''}</div>
      ${kind === 'o' ? budgetBar(budgets[k], obj[k] / maxOut, c) : ''}</button>`; }).join('');
  };
  const nowKey = monthOf(today());
  return `
  <div class="top"><h1>3つの財布</h1>${backupLine()}</div>
  ${noticeList()}
  ${pinBlock()}
  <div class="wallets">${S.wallets.map(w => { const d = monthDelta(S, w.id, nowKey); return `
    <button class="wcard" data-act="wallet" data-w="${w.id}" aria-label="${esc(w.name)}の財布の詳細">
      <span class="wdot" style="background:${wColor(w.id)}"></span>
      <span><span class="wname">${esc(w.name)}の財布</span><br><span class="wsub num">今月 ${d >= 0 ? '+' : ''}${yen(d)}</span></span>
      <span class="wbal num">${yen(balance(S, w.id))}<small> 円</small></span>
    </button>`; }).join('')}</div>
  <div class="total"><span>3つの合計</span><b class="num">${yen(all)} 円</b></div>
  ${loanBlock(all)}
  ${groupBlock()}
  <section class="month">
    <div class="mhead"><h2>内訳</h2>
      <div class="mnav"><button data-act="mprev" aria-label="前の月">‹</button><span>${monthLabel(key)}</span><button data-act="mnext" aria-label="次の月" ${key >= nowKey ? 'disabled' : ''}>›</button></div></div>
    <div class="chips">${[['all', '全部'], ...S.wallets.map(w => [w.id, w.name])].map(([id, n]) => `<button class="chip" data-wf="${id}" aria-pressed="${V.wf === id}">${esc(n)}</button>`).join('')}</div>
    <div class="sum3">
      <button data-act="drillkind" data-k="in"><small>入った</small><span class="num i">${yen(t.tin)}</span></button>
      <button data-act="drillkind" data-k="out"><small>出た</small><span class="num o">${yen(t.tout)}</span></button>
      <button data-act="drillkind" data-k="both"><small>差し引き</small><span class="num">${t.tin - t.tout >= 0 ? '+' : ''}${yen(t.tin - t.tout)}</span></button>
    </div>
    <div><h3 class="sh">出たお金（押すと中身）</h3><div class="panel">${rows(t.out, p.out, 'o')}</div></div>
    <div><h3 class="sh">入ったお金</h3><div class="panel">${rows(t.inn, p.inn, 'i')}</div></div>
    <div><h3 class="sh">財布の間の移動（支出にも収入にも数えない）</h3><div class="panel">${
      Object.keys(t.mv).length ? Object.entries(t.mv).map(([k, v]) => `<button class="row drill" data-act="drill" data-mv="${esc(k)}"><div class="lab"><span>${esc(moveLabel(k))}</span></div><div class="prev num">先月 ${p.mv[k] ? yen(p.mv[k]) : '—'}</div><div class="amt num">${yen(v)}</div></button>`).join('') : '<div class="empty">この月はまだありません</div>'}</div></div>
  </section>`;
}

// 内訳の棒：予算があれば 使った÷予算（8割で黄・超えたら赤）、無ければ一番大きい分類との比べ
function budgetBar(b, rel, c) {
  if (!b) return `<div class="bar"><i style="width:${rel * 100}%;background:${wColor(c.wallet)}"></i></div>`;
  const lv = budgetLevel(b.ratio);
  return `<div class="bar bud ${lv}"><i style="width:${Math.min(1, b.ratio) * 100}%"></i></div>`;
}

// ホームの一番上のお知らせ。あるときだけ。× で消すと、状態が悪くなるまで出ない（消したことはこの iPhone だけに覚える）
function noticeList() {
  const list = notices(S, today()).map(n => n.kind === 'budget'
    ? { ...n, text: n.level === 'over' ? `${C(n.cat).name}が予算を ${yen(n.used - n.budget)}円 超えました` : `${C(n.cat).name} 予算の${Math.floor(n.ratio * 100)}%・残り ${yen(n.budget - n.used)}円`, act: `data-act="drill" data-now="1" data-dc="${esc(n.cat)}"` }
    : { ...n, text: `${N(n.debtor)} → ${N(n.creditor)} ${yen(n.amount)}円 ${n.days < 0 ? `返す期限を${-n.days}日過ぎています` : n.days === 0 ? '今日が返す期限' : `返す期限まであと${n.days}日`}`, act: `data-act="loan" data-d="${esc(n.debtor)}" data-c="${esc(n.creditor)}"` });
  if (M.id && (!M.lastOk || Date.now() - M.lastOk > 2 * 86400e3)) list.push({ id: 'backup', level: 'over', text: 'バックアップが2日以上送れていません（押すと今すぐ送る）', act: 'data-act="bknow"' });
  const shown = list.filter(n => n.id === 'backup' || !(M.dismissed || []).includes(n.id));
  if (!shown.length) return '';
  return `<div class="notices">${shown.map(n => `<div class="notice ${n.level}"><button class="ntext" ${n.act}>${esc(n.text)}</button>${n.id === 'backup' ? '' : `<button class="nx" data-act="dismiss" data-nid="${esc(n.id)}" aria-label="このお知らせを消す">×</button>`}</div>`).join('')}</div>`;
}

// 追いかける印（お試し）：取り戻したいお金。あといくら・何%・何日目を毎回目に入れる
const pinOf = id => (S.pins || []).find(p => p.id === id);
const pinName = v => v.group ? gName(v.group) : (v.recs[0].memo || recLabel(v.recs[0]));
function pinViews() { return (S.pins || []).map(p => pinView(S, p, today())).filter(Boolean); }
function pinBlock() {
  const vs = pinViews();
  if (!vs.length) return '';
  return `<section><h3 class="sh">追いかけ中（押すと中身と「取り戻しを記録」）</h3><div class="pins">${vs.map(v => `
    <button class="pin ${v.done ? 'done' : ''}" data-act="pinopen" data-p="${esc(v.id)}">
      <div class="ptop"><b>★ ${esc(pinName(v))}</b><span class="num">${v.done ? `取り戻した！ +${yen(v.in - v.out)}` : `あと ${yen(v.rest)}`}</span></div>
      <div class="bar pbar"><i style="width:${Math.min(1, v.ratio) * 100}%"></i></div>
      <div class="psub num">出た ${yen(v.out)}・戻った ${yen(v.in)}・${Math.floor(v.ratio * 100)}%・${v.days}日目</div></button>`).join('')}</div></section>`;
}
function openPin(id) { F = { kind: 'pin', p: id }; drawSheet(); }
function drawPin() {
  const p = pinOf(F.p), v = p && pinView(S, p, today());
  if (!v) { F = null; return drawSheet(); }
  const last = v.recs[v.recs.length - 1];
  layer.html = `<div class="scrim" data-act="close"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="追いかけ中"><div class="in">
    ${sheetHead('★ ' + esc(pinName(v)))}
    <div class="amount num">${v.done ? `<span class="i">+${yen(v.in - v.out)}</span>` : yen(v.rest)}<small>${v.done ? '円 取り戻した！' : '円 あと'}</small></div>
    <div class="bar pbar ${v.done ? 'done' : ''}"><i style="width:${Math.min(1, v.ratio) * 100}%"></i></div>
    <div class="sum3">
      <div><small>出た</small><span class="num o">${yen(v.out)}</span></div>
      <div><small>戻った</small><span class="num i">${yen(v.in)}</span></div>
      <div><small>${v.days}日目</small><span class="num">${Math.floor(v.ratio * 100)}%</span></div>
    </div>
    <button class="btn" data-act="pinadd" data-m="in" data-t="${esc(last.id)}">＋取り戻しを記録</button>
    <button class="btn ghost" data-act="pinadd" data-m="out" data-t="${esc(last.id)}">＋この件でさらに使った</button>
    <div class="list">${v.recs.map(r => `<button class="hitem" data-act="edit" data-id="${r.id}">
      <span>${esc(recLabel(r))}${r.memo ? `<span class="m">・${esc(r.memo)}</span>` : ''}</span>
      <span class="num ${r.kind === 'in' ? 'i' : r.kind === 'out' ? 'o' : ''}">${yen(r.amount)}</span>
      <span class="m">${esc(r.date.slice(5).replace('-', '/'))}</span></button>`).join('')}</div>
    <button class="btn ghost" data-act="unpin" data-p="${esc(v.id)}">☆ 追いかけるのをやめる</button>
  </div></div>`;
}
const pinChip = id => pinOf(id)
  ? `<button class="chip strong" data-act="unpin" data-p="${esc(id)}">★ 追いかけ中（外す）</button>`
  : `<button class="chip" data-act="pin" data-p="${esc(id)}">☆ 追いかける</button>`;

// 紐づいたお金：まとまりごとに 出た・入った・差し引き。終わりにしたものは出さない
const gName = g => L.groupName(S, g);
const signed = n => (n > 0 ? '+' : '') + yen(n);
function groupBlock() {
  const gs = linkGroups(S), open = gs.filter(g => !g.done), done = gs.length - open.length;
  if (!gs.length) return '';
  return `<section><h3 class="sh">紐づいたお金（押すと中身と「＋」）</h3>${open.length ? `<div class="panel">${open.map(g => `
    <button class="row drill" data-act="group" data-g="${esc(g.id)}"><div class="lab"><span>${esc(gName(g))}</span></div>
      <div class="prev num">出 ${yen(g.out)}・入 ${yen(g.in)}</div><div class="amt num ${g.net > 0 ? 'i' : g.net < 0 ? 'o' : ''}">${signed(g.net)}</div></button>`).join('')}</div>` : ''}
    ${done ? `<button class="add" data-act="groupsdone">終わったまとまり（${done}）</button>` : ''}</section>`;
}

function loanBlock(all) {
  const pos = loanPositions(S);
  if (!pos.length) return '';
  const nw = netWorth(S);
  return `${nw !== all ? `<div class="total"><span>人との貸し借りを含めると</span><b class="num">${yen(nw)} 円</b></div>` : ''}
  <section><h3 class="sh">貸し借りの残り（押すと中身と「返す」）</h3><div class="panel">${pos.map(p => `
    <button class="row loanrow" data-act="loan" data-d="${esc(p.debtor)}" data-c="${esc(p.creditor)}">
      <div class="lab"><span>${esc(N(p.debtor))} → ${esc(N(p.creditor))}へ返す</span></div><div class="prev"></div><div class="amt num">${yen(p.amount)}</div></button>`).join('')}</div></section>`;
}

function hist() {
  const list = [...S.recs].sort((a, b) => b.date.localeCompare(a.date) || (b.t || 0) - (a.t || 0));
  if (!list.length) return `<div class="top"><h1>履歴</h1></div><div class="empty">まだ記録がありません。下の＋から入れます。</div>`;
  const shown = list.slice(0, V.histMore ? list.length : 150);
  let out = '<div class="top"><h1>履歴</h1><span class="bk">押すと直せます</span></div><div>', day = '';
  for (const x of shown) {
    if (x.date !== day) { day = x.date; const [y, m, d] = day.split('-').map(Number); const dt = new Date(y, m - 1, d); out += `<div class="hday">${m}月${d}日（${'日月火水木金土'[dt.getDay()]}）${y !== new Date().getFullYear() ? ' ' + y + '年' : ''}</div>`; }
    const sign = x.kind === 'in' ? 'i' : x.kind === 'out' ? 'o' : '';
    const amt = x.kind === 'adj' ? (x.amount >= 0 ? '+' : '') + yen(x.amount) : (x.kind === 'out' ? '−' : x.kind === 'in' ? '+' : '') + yen(x.amount);
    out += `<button class="hitem" data-act="edit" data-id="${x.id}">
      <span>${esc(recLabel(x))} ${x.kind === 'in' || x.kind === 'out' ? `<span class="tag" style="background:${wColor(x.wallet)}">${esc(W(x.wallet).name)}</span>` : ''}</span>
      <span class="num ${sign}">${amt}</span>
      ${x.memo || x.fixedId ? `<span class="m">${x.fixedId ? '固定費（自動）' : ''}${x.memo && x.fixedId ? '・' : ''}${esc(x.memo)}</span>` : ''}</button>`;
  }
  if (shown.length < list.length) out += `<button class="btn ghost" data-act="histmore">もっと前を見る（あと${list.length - shown.length}件）</button>`;
  return out + '</div>';
}

function settings() {
  const wSel = (v, attr) => `<select ${attr}>${S.wallets.map(w => `<option value="${w.id}" ${w.id === v ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>`;
  const used = usage(S);
  const destSel = (f, i) => {
    const cur = f.loanTo ? 'loan:' + f.loanTo : f.to ? 'to:' + f.to : 'cat:' + f.cat;
    const opts = S.cats.filter(c => c.kind === 'out' && (!c.hidden || 'cat:' + c.id === cur)).map(c => [`cat:${c.id}`, c.name])
      .concat(S.wallets.filter(w => w.id !== f.wallet).map(w => [`to:${w.id}`, `${w.name}の財布へ移動`]))
      .concat([...S.wallets.map(w => w.id), ...people(S)].filter(id => id !== f.wallet).map(id => [`loan:${id}`, `貸し借り：${N(id)}へ返す`]));
    return `<select id="fk${i}" data-set="fdest" data-i="${i}" aria-label="分類">${opts.map(([v, n]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  };
  return `<div class="top"><h1>設定</h1></div>
  <div class="set"><h3>財布</h3><p>名前と使い始めた日の残高。ずれたらホームで財布を押して合わせる</p>
    ${S.wallets.map((w, i) => `<div class="frow w"><span class="wdot sm" style="background:${wColor(w.id)}"></span>
      <input id="wn${i}" value="${esc(w.name)}" data-set="wname" data-i="${i}" aria-label="財布の名前">
      <input id="wi${i}" class="num" inputmode="numeric" value="${w.init}" data-set="winit" data-i="${i}" aria-label="使い始めた日の残高"></div>`).join('')}</div>
  <div class="set"><h3>分類</h3><p>財布＝押したとき自動で選ぶ財布。使った分類は×で隠れるだけ（合計は崩れない）</p>
    ${S.cats.map((c, i) => `<div class="frow c ${c.hidden ? 'hid' : ''}"><input id="cn${i}" value="${esc(c.name)}" data-set="cname" data-i="${i}" aria-label="分類の名前">
      ${wSel(c.wallet, `id="cw${i}" data-set="cwallet" data-i="${i}" aria-label="財布"`)}
      <select id="ck${i}" data-set="ckind" data-i="${i}" aria-label="支出か収入か"><option value="out" ${c.kind === 'out' ? 'selected' : ''}>支出</option><option value="in" ${c.kind === 'in' ? 'selected' : ''}>収入</option></select>
      ${c.hidden ? `<button class="x back" data-act="cshow" data-i="${i}" aria-label="${esc(c.name)}を戻す">戻す</button>`
                 : `<button class="x" data-act="cdel" data-i="${i}" aria-label="${esc(c.name)}を${used[c.id] ? '隠す' : '消す'}">×</button>`}</div>`).join('')}
    <button class="add" data-act="cadd">＋ 分類を足す</button></div>
  <div class="set"><h3>予算（月）</h3><p>決めたい分類にだけ金額を入れる（空なら予算なし）。8割で黄・超えたら赤</p>
    <div class="bgrid">${S.cats.map((c, i) => c.kind === 'out' && !c.hidden ? `<label class="brow"><span>${esc(c.name)}</span><input id="cb${i}" class="num" inputmode="numeric" value="${c.budget || ''}" placeholder="なし" data-set="cbudget" data-i="${i}" aria-label="${esc(c.name)}の予算"></label>` : '').join('')}</div></div>
  <div class="set"><h3>固定費（毎月その日に自動で記録）</h3>
    <p>登録の翌日以降、毎月その日に自動で記録。行き先で移動・返済も選べる（返済は返し終わると止まる）</p>
    ${S.fixed.length ? '' : '<div class="empty">まだありません</div>'}
    ${S.fixed.map((f, i) => `<div class="fcard">
      <div class="frow f1"><input id="fn${i}" value="${esc(f.name)}" placeholder="名前（家賃など）" data-set="fname" data-i="${i}" aria-label="名前">
        <input id="fa${i}" class="num" inputmode="numeric" value="${f.amount || ''}" placeholder="金額" data-set="famt" data-i="${i}" aria-label="金額">
        <button class="x" data-act="fdel" data-i="${i}" aria-label="${esc(f.name)}を消す">×</button></div>
      <div class="frow f2"><label>毎月<input id="fd${i}" class="num" inputmode="numeric" value="${f.day}" data-set="fday" data-i="${i}" aria-label="毎月何日">日</label>
        ${wSel(f.wallet, `id="fw${i}" data-set="fwallet" data-i="${i}" aria-label="財布"`)}
        ${destSel(f, i)}</div></div>`).join('')}
    <button class="add" data-act="fadd">＋ 固定費を足す</button></div>
  <div class="set"><h3>バックアップ</h3>
    <p>記録のたびに暗号化して自社サーバーへ自動で送る。30日分残る</p>
    <div>${backupLine()}</div><p class="err" id="bkerr">${esc(M.lastError || '')}</p>
    <button class="btn ghost" data-act="bknow">今すぐ送る</button>
    <button class="btn ghost" data-act="restorepick">前の日のバックアップに戻す</button>
    <p>新しいiPhone：最初の画面で「前のiPhoneから引き継ぐ」→ 合言葉。<b>忘れると戻せない</b></p>
    <p>PCで見る：tskmons-eng.github.io/three-wallets/pc.html → 合言葉</p></div>
  <p class="ver">3つの財布 ${VERSION}・データはこのiPhoneの中にあります</p>`;
}

/* ================= 最初の設定 ================= */

function renderSetup() {
  const st = V.setup;
  let body = '';
  if (st.step === 'hello') body = `
    <h1 class="big">3つの財布</h1>
    <p>会社・自分・投資の3つの財布の残金と、分類ごとの合計を見るアプリです。データはこのiPhoneの中に置き、自社サーバーへ暗号化して自動でバックアップします。</p>
    <button class="btn" data-act="s-new">はじめて使う</button>
    <button class="btn ghost" data-act="s-restore">前のiPhoneから引き継ぐ</button>
    ${navigator.standalone === false ? '<p class="hint">先に、Safari の共有ボタン →「ホーム画面に追加」をしてから、ホーム画面のアイコンで開いてください。Safari のまま使うと、しばらく開かないうちにデータが消されることがあります。</p>' : ''}`;
  else if (st.step === 'balances') body = `
    <h2>1. 今の残高</h2><p>3つの財布に、今いくらあるかを入れます。だいたいで大丈夫です（あとで「残高合わせ」で直せます）。</p>
    ${['会社', '自分', '投資'].map((n, i) => `<label class="lbl">${n}の財布<input id="sb${i}" class="num" inputmode="numeric" value="${st.bal[i] || ''}" placeholder="0" data-sbal="${i}"></label>`).join('')}
    <button class="btn" data-act="s-pass">次へ</button>
    <button class="btn ghost" data-act="s-back">戻る</button>`;
  else if (st.step === 'pass') body = `
    <h2>2. 合言葉を決める</h2>
    <p>バックアップを暗号化する合言葉です。新しいiPhoneに引き継ぐときに使います。8文字以上で、人に推測されにくいものにしてください。</p>
    <p class="warn">合言葉を忘れると、バックアップから戻せません。紙などに控えてください。</p>
    <label class="lbl">合言葉<input id="p1" type="password" autocomplete="new-password"></label>
    <label class="lbl">もう一度<input id="p2" type="password" autocomplete="new-password"></label>
    <p class="err">${esc(st.err || '')}</p>
    <button class="btn" data-act="s-finish" ${st.busy ? 'disabled' : ''}>${st.busy ? '準備しています…' : 'はじめる'}</button>
    <button class="btn ghost" data-act="s-balances">戻る</button>`;
  else if (st.step === 'restore') body = `
    <h2>前のiPhoneから引き継ぐ</h2>
    <p>前のiPhoneで決めた合言葉を入れてください。自社サーバーから一番新しいバックアップを取ってきます。</p>
    <label class="lbl">合言葉<input id="rp" type="password" autocomplete="current-password"></label>
    <p class="err">${esc(st.err || '')}</p>
    <button class="btn" data-act="s-fetch" ${st.busy ? 'disabled' : ''}>${st.busy ? '探しています…' : '探す'}</button>
    <button class="btn ghost" data-act="s-hello">戻る</button>`;
  else if (st.step === 'found') body = `
    <h2>見つかりました</h2>
    ${st.existed ? '<p>この合言葉のバックアップが、もうサーバーにあります。新しく始めると前のデータを上書きしてしまうので、引き継いでください。</p>' : ''}
    <div class="confirm plain">${esc(st.date)} のバックアップ<br>記録 ${st.found.state.recs.length} 件・最後の記録 ${esc(lastRecDate(st.found.state))}</div>
    <button class="btn" data-act="s-apply">このデータで始める</button>
    <button class="btn ghost" data-act="s-hello">やめる</button>`;
  $('#app').innerHTML = `<div class="wrap setup">${body}</div>`;
}
const lastRecDate = st => st.recs.reduce((a, r) => r.date > a ? r.date : a, '') || 'なし';

async function finishSetup() {
  const st = V.setup, p1 = $('#p1').value, p2 = $('#p2').value;
  if (p1.length < 8) { st.err = '合言葉は8文字以上にしてください'; return renderSetup(); }
  if (p1 !== p2) { st.err = '2回の合言葉が違います'; return renderSetup(); }
  st.busy = true; st.err = ''; renderSetup();
  try {
    const id = await bk.deriveId(p1);
    // 同じ合言葉のバックアップが既にあれば、空のデータで上書きしないように引き継ぎへ回す
    try {
      const { blob, date } = await bk.fetchLatest(id);
      const found = await bk.open(blob, p1);
      if (isValidState(found.state)) { Object.assign(st, { step: 'found', found, id, date, busy: false, existed: true }); return renderSetup(); }
    } catch (e) {
      if (e.status === 403) throw new Error('このサーバーには別の合言葉で登録されています。前の合言葉を使ってください');
      if (e.status !== 404) throw e;
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await bk.deriveKey(p1, salt);
    S = defaultState(today());
    S.wallets.forEach((w, i) => { w.init = toNum(st.bal[i]); });
    M = { id, key, salt, lastOk: 0, lastError: '', pending: true };
    await saveMeta(); await store.set('state', S);
    V.setup = null; store.askPersist(); render();
    runBackup();
  } catch (e) { st.busy = false; st.err = e.status === 403 || e.message.startsWith('このサーバー') ? e.message : '準備できませんでした：' + e.message; renderSetup(); }
}
async function fetchForRestore() {
  const st = V.setup, pass = $('#rp').value;
  if (!pass) { st.err = '合言葉を入れてください'; return renderSetup(); }
  st.busy = true; st.err = ''; renderSetup();
  try {
    const id = await bk.deriveId(pass);
    const { blob, date } = await bk.fetchLatest(id);
    const found = await bk.open(blob, pass);
    if (!isValidState(found.state)) throw new Error('バックアップの形が読めませんでした');
    Object.assign(st, { step: 'found', found, id, date, busy: false });
  } catch (e) { st.busy = false; st.err = e.status === 404 ? 'バックアップが見つかりません。合言葉を確かめてください' : e.message; }
  renderSetup();
}
async function applyRestore() {
  const st = V.setup;
  S = st.found.state;
  M = { id: st.id, key: st.found.key, salt: st.found.salt, lastOk: Date.now(), lastError: '', pending: false };
  await store.set('state', S); await saveMeta();
  V.setup = null; store.askPersist();
  if (applyFixed(S, today())) await save();
  render(); toast('引き継ぎました');
}

/* ================= シート：記録する・直す ================= */

// preset：集計や紐づけから開いたときに、最初から選んでおくもの { cat, wallet, mode, linkTarget（紐づける相手の記録の id） }
function openEntry(rec, preset = {}) {
  if (rec && rec.kind === 'adj') { F = { kind: 'adj', wallet: rec.wallet, amount: '', editId: rec.id }; return drawSheet(); }
  F = rec
    ? { mode: rec.kind, amount: String(rec.amount), wallet: rec.wallet, walletManual: rec.kind !== 'move', to: rec.to || 'inv', cat: rec.cat, date: rec.date, memo: rec.memo || '', editId: rec.id }
    : { mode: preset.mode || (preset.cat ? C(preset.cat).kind : 'out'), amount: '', wallet: preset.wallet || 'me', walletManual: !!preset.wallet, to: 'inv', cat: preset.cat || null, presetCat: preset.cat || null, date: today(), memo: '', linkTarget: preset.linkTarget || null };
  if ((F.mode === 'move' || F.mode === 'loan') && F.wallet === F.to) F.to = F.wallet === 'inv' ? 'me' : 'inv';
  drawSheet();
}
// 貸し借りの詳細：その相手との借りた・返したの一覧と、返すボタン
function openLoan(d, c) { F = { kind: 'loandetail', d, c }; drawSheet(); }
function drawLoan() {
  const { d, c } = F, n = owed(S, d, c);
  const recs = S.recs.filter(r => r.kind === 'loan' && ((r.wallet === d && r.to === c) || (r.wallet === c && r.to === d))).sort((a, b) => b.date.localeCompare(a.date) || (b.t || 0) - (a.t || 0));
  const word = isPerson(d) ? '返してもらった' : '返す';
  layer.html = `<div class="scrim" data-act="close"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="貸し借りの中身"><div class="in">
    ${sheetHead(esc(N(d)) + ' → ' + esc(N(c)))}
    <div class="amount num">${n > 0 ? yen(n) : '0'}<small>円</small></div>
    <p class="hint">${esc(n > 0 ? owesText(d, c, n) : '全部返し終わりました')}</p>
    ${n > 0 ? `<div class="confirm plain"><div><button class="btn" data-act="repayall">全額${word}</button><button class="btn ghost" data-act="repaypart">一部${word}</button></div></div>
    <label class="meta">返す期限<input type="date" id="ldue" value="${esc((S.loanDue || {})[pairKey(d, c)] || '')}" data-set="ldue" aria-label="返す期限"><span class="hint">（なくてよい。7日前からお知らせ）</span></label>` : ''}
    <h3 class="sh">これまで（押すと直せます）</h3>
    <div>${recs.map(r => { const back = r.wallet === d; return `<button class="hitem" data-act="edit" data-id="${r.id}">
      <span>${back ? (isPerson(d) ? '返してもらった' : '返した') : (isPerson(d) ? '貸した' : '借りた')}　${esc(N(r.wallet))} → ${esc(N(r.to))}</span>
      <span class="num ${back ? 'i' : ''}">${back ? '−' : '+'}${yen(r.amount)}</span>
      <span class="m">${esc(r.date)}${r.fixedId ? '・毎月の返済（自動）' : ''}${r.memo ? '・' + esc(r.memo) : ''}</span></button>`; }).join('')}</div>
  </div></div>`;
}
const keys = () => `<div class="keys">${['1', '2', '3', '⌫', '4', '5', '6', '00', '7', '8', '9', '0'].map(k => `<button class="key" data-key="${k}" aria-label="${k === '⌫' ? '1文字消す' : k}">${k}</button>`).join('')}</div>`;
const delBlock = what => F.editId ? (F.confirmDel
  ? `<div class="confirm">${what}を消します。元に戻せません。<div><button class="btn danger" data-act="del">消す</button><button class="btn ghost" data-act="nodel">やめる</button></div></div>`
  : `<button class="btn danger" data-act="askdel">${what}を消す</button>`) : '';
// シートを描く。同じシートの描き直し（数字キーを押したときなど）では、開く動きを出さず、スクロール位置を保つ
const layer = {
  set html(v) {
    const old = document.querySelector('#layer .sheet');
    const top = old ? old.scrollTop : 0;
    $('#layer').innerHTML = v;
    const now = document.querySelector('#layer .sheet');
    if (old && now) { now.classList.add('still'); now.scrollTop = top; }
  },
};
const sheetHead = title => `<div class="grab"></div><div class="shead"><button data-act="close">閉じる</button><b>${title}</b><span class="sp"></span></div>`;

function drawSheet() {
  if (!F) { $('#layer').innerHTML = ''; return; }
  if (F.kind === 'adj') return drawAdjust();
  if (F.kind === 'pick') return drawPick();
  if (F.kind === 'loandetail') return drawLoan();
  if (F.kind === 'wallet') return drawWallet();
  if (F.kind === 'drill') return drawDrill();
  if (F.kind === 'group') return drawGroup();
  if (F.kind === 'pin') return drawPin();
  if (F.kind === 'linkpick') return drawLinkPick();
  if (F.kind === 'groupsdone') return drawDoneGroups();
  const u = usage(S);
  const cats = S.cats.filter(c => c.kind === F.mode && (!c.hidden || c.id === F.cat)).sort((a, b) => (u[b.id] || 0) - (u[a.id] || 0));
  const amt = Number(F.amount || 0);
  const wChips = (sel, attr) => S.wallets.map(w => `<button class="chip" ${attr}="${w.id}" aria-pressed="${sel === w.id}">${esc(w.name)}</button>`).join('');
  const meta = `<div class="meta"><input type="date" id="fdate" value="${F.date}" max="${today()}" aria-label="日付"><input type="text" id="fmemo" placeholder="メモ（なくてよい）" value="${esc(F.memo)}" enterkeyhint="done"></div>`;
  layer.html = `<div class="scrim" data-act="close"></div>
  <div class="sheet entry" role="dialog" aria-modal="true" aria-label="${F.editId ? '記録を直す' : '記録する'}"><div class="in">
    <div class="ehead"><button data-act="close" class="closex" aria-label="閉じる">×</button>
      <div class="seg four">${[['out', '支出'], ['in', '収入'], ['move', '移動'], ['loan', '貸し借り']].map(([m, n]) => `<button data-mode="${m}" aria-pressed="${F.mode === m}">${n}</button>`).join('')}</div></div>
    ${linkBar()}
    <div class="amount num" aria-live="polite">${F.editId ? '<span class="etag">直す</span>' : ''}${amt ? yen(amt) : '<span class="ph">0</span>'}<small>円</small></div>
    ${keys()}
    ${F.presetCat && !F.editId && (F.mode === 'out' || F.mode === 'in') ? `<button class="btn" data-cat="${esc(F.presetCat)}" ${amt ? '' : 'disabled'}>${esc(C(F.presetCat).name)}で保存</button>` : ''}
    ${F.mode === 'loan' ? loanForm(amt) : F.mode === 'move' ? `
      <div class="pick"><span>から</span><div class="chips">${wChips(F.wallet, 'data-from')}</div></div>
      <div class="pick"><span>へ</span><div class="chips">${wChips(F.to, 'data-to')}</div></div>
      <button class="btn" data-act="savemove" ${!amt || F.wallet === F.to ? 'disabled' : ''}>${F.wallet === F.to ? '同じ財布です' : F.editId ? '直す' : '移動を記録'}</button>`
    : `
      <div class="cats" aria-label="${amt ? '分類を押すと保存します' : '金額を打ってから分類を押します'}">${cats.map(c => `<button class="cat" data-cat="${c.id}" aria-pressed="${F.cat === c.id}" ${amt ? '' : 'disabled'}>${esc(c.name)}<small>${esc(W(F.walletManual ? F.wallet : c.wallet).name)}</small></button>`).join('')}</div>
      <div class="meta"><span>財布</span><div class="chips"><button class="chip" aria-pressed="${!F.walletManual}" data-w="">自動</button>${wChips(F.walletManual ? F.wallet : '', 'data-w')}</div></div>`}
    ${meta}
    ${linkEdit()}
    ${delBlock('この記録')}
  </div></div>`;
}
function loanForm(amt) {
  const parties = [...S.wallets.map(w => w.id), ...people(S)];
  const chips = (sel, attr) => parties.map(id => `<button class="chip" ${attr}="${esc(id)}" aria-pressed="${sel === id}">${esc(N(id))}</button>`).join('')
    + `<button class="chip" ${attr}="new" aria-pressed="${sel === 'new'}">＋人</button>`;
  const nameBox = (side, v) => `<input type="text" class="pname" id="pn-${side}" placeholder="相手の名前" value="${esc(v || '')}" aria-label="相手の名前">`;
  const a = F.wallet, b = F.to;
  const err = a === b ? '同じ相手です' : (isPerson(a) || a === 'new') && (isPerson(b) || b === 'new') ? 'どちらかは自分の財布にしてください' : '';
  let hint = '';
  if (!err && a !== 'new' && b !== 'new') {
    const S2 = { ...S, recs: S.recs.filter(r => r.id !== F.editId) };
    hint = `今：${pairText(S2, a, b)}` + (amt ? ` → 記録後：${pairText({ ...S2, recs: [...S2.recs, { kind: 'loan', wallet: a, to: b, amount: amt }] }, a, b)}` : '');
  }
  return `<div class="pick"><span>から</span><div class="chips">${chips(a, 'data-from')}</div></div>${a === 'new' ? nameBox('from', F.newFrom) : ''}
    <div class="pick"><span>へ</span><div class="chips">${chips(b, 'data-to')}</div></div>${b === 'new' ? nameBox('to', F.newTo) : ''}
    <p class="hint loanhint">${esc(err || hint || '借りたら「相手 → 自分の財布」、返したら「自分の財布 → 相手」')}</p>
    <button class="btn" data-act="saveloan" ${!amt || err ? 'disabled' : ''}>${err || (F.editId ? '直す' : '貸し借りを記録')}</button>`;
}
// 入力画面の紐づけの表示。新しく記録するとき：上に「紐づけ：〜」。直すとき：下に「紐づけ」「この件に紐づけて追加」
function linkLabel(targetId) {
  const t = S.recs.find(x => x.id === targetId); if (!t) return '';
  const g = t.link && linkGroups(S).find(x => x.id === t.link);
  return g ? `${gName(g)}（${g.recs.length}件・差し引き ${signed(g.net)}）` : `${recLabel(t)} ${yen(t.amount)}${t.memo ? '（' + t.memo + '）' : ''}`;
}
function linkBar() {
  if (F.editId || !F.linkTarget) return '';
  return `<div class="linkbar"><span>紐づけ：${esc(linkLabel(F.linkTarget))}</span><button data-act="unlinkF">外す</button></div>`;
}
function linkEdit() {
  if (!F.editId || !['out', 'in', 'loan'].includes(F.mode)) return '';
  const r = S.recs.find(x => x.id === F.editId);
  const g = r && r.link && linkGroups(S).find(x => x.id === r.link);
  return `<div class="linkrow">${g ? `<button class="chip" data-act="group" data-g="${esc(g.id)}">紐づけ：${esc(gName(g))}</button><button class="chip" data-act="unlink">外す</button>`
    : `<button class="chip" data-act="linkpick">紐づける</button>`}<button class="chip strong" data-act="linkadd">＋この件に紐づけて追加</button>${pinChip(r.link || r.id)}</div>`;
}

function readMeta() {
  const pf = $('#pn-from'), pt = $('#pn-to');
  if (pf) F.newFrom = pf.value;
  if (pt) F.newTo = pt.value; const d = $('#fdate'), m = $('#fmemo'); if (d) F.date = d.value || today(); if (m) F.memo = m.value.trim(); }

let lastSaved = null;
async function commit(rec) {
  if (F.editId) {
    const i = S.recs.findIndex(x => x.id === F.editId);
    if (i >= 0) { S.recs[i] = { ...S.recs[i], ...rec }; if (!linkable(S.recs[i]) && S.recs[i].link) { delete S.recs[i].link; tidyLinks(S); } }
    lastSaved = null; toast('直しました');
  } else {
    rec.id = uid(); rec.t = Date.now();
    const target = F.linkTarget && linkable(rec) && S.recs.find(x => x.id === F.linkTarget);
    if (target) linkTo(S, rec, target);
    S.recs.push(rec); lastSaved = rec.id;
    let bmsg = '';
    if (rec.kind === 'out' && C(rec.cat).budget > 0 && monthOf(rec.date) === monthOf(today())) {
      const b = budgetStatus(S, monthOf(rec.date)).find(x => x.cat === rec.cat);
      bmsg = b.used > b.budget ? `・予算を ${yen(b.used - b.budget)}円 超えました` : `・予算の残り ${yen(b.budget - b.used)}円`;
    }
    toast(`${recLabel(rec)} ${yen(rec.amount)}円を保存しました${bmsg}`, true);
  }
  F = null; drawSheet(); render(); await save();
}

// まとまりの中身：出た・入った・差し引き、記録の一覧、「＋この件に追加」、名前、終わりにする
function openGroup(gid) { F = { kind: 'group', g: gid }; drawSheet(); }
function drawGroup() {
  const g = linkGroups(S).find(x => x.id === F.g);
  if (!g) { F = null; return drawSheet(); }
  layer.html = `<div class="scrim" data-act="close"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="紐づいたお金"><div class="in">
    ${sheetHead(esc(gName(g)))}
    <div class="sum3">
      <div><small>出た</small><span class="num o">${yen(g.out)}</span></div>
      <div><small>入った</small><span class="num i">${yen(g.in)}</span></div>
      <div><small>差し引き</small><span class="num">${signed(g.net)}</span></div>
    </div>
    <button class="btn" data-act="groupadd">＋この件に追加</button>
    <div class="linkrow">${pinChip(g.id)}</div>
    <div class="list">${g.recs.map(r => `<button class="hitem" data-act="edit" data-id="${r.id}">
      <span>${esc(recLabel(r))}${r.memo ? `<span class="m">・${esc(r.memo)}</span>` : ''}</span>
      <span class="num ${r.kind === 'in' ? 'i' : r.kind === 'out' ? 'o' : ''}">${yen(r.amount)}</span>
      <span class="m">${esc(r.date.slice(5).replace('-', '/'))}</span></button>`).join('')}</div>
    <label class="meta">名前<input type="text" id="gname" value="${esc(g.name)}" placeholder="${esc(g.first.memo || recLabel(g.first))}" data-set="gname" aria-label="まとまりの名前"></label>
    <button class="btn ghost" data-act="groupdone">${g.done ? 'また開く（ホームに出す）' : '終わりにする（ホームから消す）'}</button>
  </div></div>`;
}
// 紐づける先を選ぶ：まとまり（進行中が先）と、最近の記録
function openLinkPick(recId) { F = { kind: 'linkpick', recId }; drawSheet(); }
function drawLinkPick() {
  const me = S.recs.find(x => x.id === F.recId);
  const gs = linkGroups(S).sort((a, b) => a.done - b.done);
  const recent = S.recs.filter(r => r.id !== F.recId && linkable(r) && !r.link).sort((a, b) => b.date.localeCompare(a.date) || (b.t || 0) - (a.t || 0)).slice(0, 40);
  layer.html = `<div class="scrim" data-act="close"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="紐づける先"><div class="in">
    ${sheetHead('紐づける先を選ぶ')}
    <p class="hint">${esc(recLabel(me))} ${yen(me.amount)} を、どれと紐づけますか</p>
    ${gs.length ? `<h3 class="sh">まとまり</h3><div class="list">${gs.map(g => `<button class="hitem" data-act="linkset" data-g="${esc(g.id)}"><span>${esc(gName(g))}${g.done ? '<span class="m">・終わった</span>' : ''}</span><span class="num">${signed(g.net)}</span><span class="m">${g.recs.length}件・最後 ${esc(g.last.slice(5).replace('-', '/'))}</span></button>`).join('')}</div>` : ''}
    <h3 class="sh">最近の記録</h3><div class="list">${recent.map(r => `<button class="hitem" data-act="linkset" data-id="${r.id}"><span>${esc(recLabel(r))}${r.memo ? `<span class="m">・${esc(r.memo)}</span>` : ''}</span><span class="num">${yen(r.amount)}</span><span class="m">${esc(r.date.slice(5).replace('-', '/'))}</span></button>`).join('') || '<div class="empty">ありません</div>'}</div>
  </div></div>`;
}
function openDoneGroups() { F = { kind: 'groupsdone' }; drawSheet(); }
function drawDoneGroups() {
  const gs = linkGroups(S).filter(g => g.done);
  layer.html = `<div class="scrim" data-act="close"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="終わったまとまり"><div class="in">
    ${sheetHead('終わったまとまり')}
    <div class="list">${gs.map(g => `<button class="hitem" data-act="group" data-g="${esc(g.id)}"><span>${esc(gName(g))}</span><span class="num">${signed(g.net)}</span><span class="m">出 ${yen(g.out)}・入 ${yen(g.in)}・${g.recs.length}件</span></button>`).join('') || '<div class="empty">ありません</div>'}</div>
  </div></div>`;
}

// 財布の詳細：残高、今月の出入り、その財布の記録。残高合わせは一番下（あまり使わないので）
function openWallet(wid) { F = { kind: 'wallet', wallet: wid, more: false }; drawSheet(); }
function drawWallet() {
  const wid = F.wallet, key = monthOf(today());
  let tin = 0, tout = 0, other = 0;
  for (const r of S.recs) {
    if (monthOf(r.date) !== key) continue;
    const e = effect(r, wid);
    if (!e) continue;
    if (r.kind === 'in') tin += e; else if (r.kind === 'out') tout -= e; else other += e;
  }
  const list = S.recs.filter(r => effect(r, wid) !== 0).sort((a, b) => b.date.localeCompare(a.date) || (b.t || 0) - (a.t || 0));
  const shown = F.more ? list : list.slice(0, 30);
  layer.html = `<div class="scrim" data-act="close"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="財布の詳細"><div class="in">
    ${sheetHead(esc(W(wid).name) + 'の財布')}
    <div class="amount num">${yen(balance(S, wid))}<small>円</small></div>
    <div class="sum3">
      <div><small>今月 入った</small><span class="num i">${yen(tin)}</span></div>
      <div><small>今月 出た</small><span class="num o">${yen(tout)}</span></div>
      <div><small>移動・貸し借り</small><span class="num">${other >= 0 ? '+' : ''}${yen(other)}</span></div>
    </div>
    <button class="btn" data-act="newwallet" data-w="${wid}">＋${esc(W(wid).name)}の財布で記録</button>
    <h3 class="sh">記録（押すと直せます）</h3>
    <div>${shown.length ? shown.map(r => { const e = effect(r, wid); return `<button class="hitem" data-act="edit" data-id="${r.id}">
      <span>${esc(recLabel(r))}</span><span class="num ${e > 0 ? 'i' : 'o'}">${e > 0 ? '+' : '−'}${yen(Math.abs(e))}</span>
      <span class="m">${esc(r.date)}${r.fixedId ? '・自動' : ''}${r.memo ? '・' + esc(r.memo) : ''}</span></button>`; }).join('') : '<div class="empty">まだ記録がありません</div>'}</div>
    ${shown.length < list.length ? `<button class="btn ghost" data-act="wmore">もっと前を見る（あと${list.length - shown.length}件）</button>` : ''}
    <button class="btn ghost" data-act="adjust" data-w="${wid}">残高を合わせる（実際の額とずれたとき）</button>
  </div></div>`;
}

// 内訳の詳細：その月のその分類（または移動）の記録。押すと直せる
// k：'in'（収入すべて）・'out'（支出すべて）・'both'（両方。合計は差し引き）
function openDrill(cat, mv, k) { F = { kind: 'drill', cat, mv, k, month: V.month, wf: V.wf }; drawSheet(); }
function drawDrill() {
  const { cat, mv, k, month, wf, allMonths } = F;
  const inW = r => wf === 'all' || r.wallet === wf || r.to === wf;
  const hit = r => mv ? r.kind === 'move' && r.wallet + '>' + r.to === mv
    : k ? (r.kind === 'in' && k !== 'out') || (r.kind === 'out' && k !== 'in')
    : (r.kind === 'out' || r.kind === 'in') && r.cat === cat;
  const list = S.recs.filter(r => (allMonths || monthOf(r.date) === month) && inW(r) && hit(r))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.t || 0) - (a.t || 0));
  const sum = list.reduce((a, r) => a + (k === 'both' && r.kind === 'out' ? -r.amount : r.amount), 0);
  const name = mv ? moveLabel(mv) : k ? { in: '入ったお金', out: '出たお金', both: '入った・出た' }[k] : C(cat).name;
  const title = name + '・' + (allMonths ? 'すべての月' : monthLabel(month)) + (wf === 'all' ? '' : '・' + W(wf).name);
  layer.html = `<div class="scrim" data-act="close"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="内訳の中身"><div class="in">
    ${sheetHead(esc(title))}
    <div class="amount num">${k === 'both' && sum > 0 ? '+' : ''}${yen(sum)}<small>円・${list.length}件</small></div>
    ${mv ? '' : `<button class="btn" data-act="drilladd">＋${esc(k ? (k === 'in' ? '収入' : k === 'out' ? '支出' : '') : C(cat).name)}${k === 'both' ? '' : 'で'}記録</button>`}
    <div class="list">${list.map(r => `<button class="hitem" data-act="edit" data-id="${r.id}">
      <span>${esc(recLabel(r))}${r.memo ? `<span class="m">・${esc(r.memo)}</span>` : ''} ${r.kind === 'in' || r.kind === 'out' ? `<span class="tag" style="background:${wColor(r.wallet)}">${esc(W(r.wallet).name)}</span>` : ''}</span>
      <span class="num ${r.kind === 'in' ? 'i' : r.kind === 'out' ? 'o' : ''}">${r.kind === 'out' && k === 'both' ? '−' : ''}${yen(r.amount)}</span>
      <span class="m">${esc(allMonths ? r.date : r.date.slice(5).replace('-', '/'))}${r.fixedId ? '・自動' : ''}</span></button>`).join('') || '<div class="empty">ありません</div>'}</div>
    ${allMonths ? '' : '<button class="btn ghost" data-act="drillall">前の月も見る</button>'}
  </div></div>`;
}

function openAdjust(wid) { F = { kind: 'adj', wallet: wid, amount: '' }; drawSheet(); }
function adjBase() { return balance(S, F.wallet) - (F.editId ? (S.recs.find(x => x.id === F.editId) || { amount: 0 }).amount : 0); }
function drawAdjust() {
  const now = adjBase(), amt = F.amount === '' ? null : Number(F.amount), diff = amt === null ? 0 : amt - now;
  layer.html = `<div class="scrim" data-act="close"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="残高を合わせる"><div class="in">
    ${sheetHead(esc(W(F.wallet).name) + 'の残高を合わせる')}
    <div class="amount num">${amt === null ? '<span class="ph">本当の残高</span>' : yen(amt)}<small>円</small></div>
    <div class="total"><span>アプリ <b class="num">${yen(now)}</b></span><span>差 <b class="num ${diff < 0 ? 'o' : 'i'}">${diff >= 0 ? '+' : ''}${yen(diff)}</b></span></div>
    ${keys()}
    <button class="btn" data-act="saveadj" ${amt === null || diff === 0 ? 'disabled' : ''}>この残高に合わせる</button>
    <p class="hint">差は「残高合わせ」として1件記録（支出・収入には数えない）</p>
    ${delBlock('この残高合わせ')}
  </div></div>`;
}

/* 前の日のバックアップに戻す（この端末の鍵で開くので、合言葉は要らない） */
async function openPick() {
  F = { kind: 'pick', loading: true, dates: [], err: '' }; drawSheet();
  try { F.dates = await bk.listDates(M.id); } catch (e) { F.err = e.message; }
  F.loading = false; if (F && F.kind === 'pick') drawSheet();
}
function drawPick() {
  layer.html = `<div class="scrim" data-act="close"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="前の日に戻す"><div class="in">
    ${sheetHead('前の日のバックアップに戻す')}
    ${F.loading ? '<p class="hint">サーバーに聞いています…</p>' : ''}
    ${F.err ? `<p class="err">${esc(F.err)}</p>` : ''}
    ${F.chosen ? `<div class="confirm">${esc(F.chosen)} の状態に戻します。今のデータは置き換わります（今のデータも今日の分としてサーバーに残っています）。
        <div><button class="btn danger" data-act="pickgo">戻す</button><button class="btn ghost" data-act="picknot">やめる</button></div></div>`
      : F.dates.map(d => `<button class="hitem" data-act="pickday" data-date="${d.date}"><span>${esc(d.date)}</span><span class="num">${Math.ceil(d.size / 1024)} KB</span></button>`).join('')}
  </div></div>`;
}
async function pickGo() {
  try {
    const { blob } = await bk.fetchLatest(M.id, F.chosen);
    const st = await bk.openWithKey(blob, M.key, 'このiPhoneの鍵では開けませんでした（別のiPhoneで作ったバックアップです）');
    if (!isValidState(st)) throw new Error('バックアップの形が読めませんでした');
    S = st; F = null; drawSheet(); render(); await save(); toast('戻しました');
  } catch (e) { F.err = e.message; F.chosen = null; drawSheet(); }
}

/* ================= 操作 ================= */

let toastTimer;
function toast(msg, undo) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-act="undo">取り消す</button>' : ''}`;
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

document.addEventListener('click', async e => {
  const b = e.target.closest('button,[data-act]'); if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.tab) { V.tab = d.tab; render(); scrollTo(0, 0); return; }
  if (d.wf) { V.wf = d.wf; render(); return; }
  if (d.key && F) {
    if (d.key === '⌫') F.amount = F.amount.slice(0, -1);
    else {
      const v = (F.amount + d.key).replace(/^0+/, '');
      // 残高合わせだけは「本当の残高 0円」を入れられる（ほかの記録で 0円 は意味が無いので入れない）
      if (v.length <= 10) F.amount = v || (F.kind === 'adj' ? '0' : '');
    }
    if (F.kind !== 'adj') readMeta();
    return drawSheet();
  }
  if (d.mode) {
    readMeta(); F.mode = d.mode; F.cat = null;
    if (d.mode !== 'loan') { if (!S.wallets.some(w => w.id === F.wallet)) F.wallet = 'me'; if (!S.wallets.some(w => w.id === F.to)) F.to = 'inv'; }
    if ((d.mode === 'move' || d.mode === 'loan') && F.wallet === F.to) F.to = F.wallet === 'inv' ? 'me' : 'inv';
    return drawSheet();
  }
  if ('w' in d && F && !d.act) { readMeta(); if (d.w) { F.wallet = d.w; F.walletManual = true; } else F.walletManual = false; return drawSheet(); }
  if (d.from) { readMeta(); F.wallet = d.from; return drawSheet(); }
  if (d.to) { readMeta(); F.to = d.to; return drawSheet(); }
  if (d.cat) {
    readMeta(); const c = C(d.cat);
    return commit({ kind: F.mode, amount: Number(F.amount), wallet: F.walletManual ? F.wallet : c.wallet, cat: c.id, date: F.date, memo: F.memo, to: undefined });
  }
  switch (d.act) {
    case 'new': return openEntry();
    case 'close': F = null; return drawSheet();
    case 'edit': return openEntry(S.recs.find(x => x.id === d.id));
    case 'wallet': return openWallet(d.w);
    case 'newwallet': return openEntry(null, { wallet: d.w });
    case 'drilladd': return F.k ? openEntry(null, F.k === 'both' ? {} : { mode: F.k }) : openEntry(null, { cat: F.cat });
    case 'drillall': F.allMonths = true; return drawSheet();
    case 'group': return openGroup(d.g);
    case 'pinopen': return openPin(d.p);
    case 'pin': S.pins = [...(S.pins || []).filter(p => p.id !== d.p), { id: d.p, at: today() }]; toast('追いかけ中に入れました（ホームの上に出ます）'); drawSheet(); render(); return save();
    case 'unpin': S.pins = (S.pins || []).filter(p => p.id !== d.p); if (!S.pins.length) delete S.pins; toast('追いかけるのをやめました'); if (F && F.kind === 'pin') F = null; drawSheet(); render(); return save();
    case 'pinadd': return openEntry(null, { linkTarget: d.t, mode: d.m });
    case 'groupsdone': return openDoneGroups();
    case 'groupadd': { const g = linkGroups(S).find(x => x.id === F.g); return openEntry(null, { linkTarget: g.recs[g.recs.length - 1].id }); }
    case 'groupdone': { S.groups = S.groups || {}; const m = S.groups[F.g] = S.groups[F.g] || {}; m.done = !m.done; if (!m.done) delete m.done; if (!Object.keys(m).length) delete S.groups[F.g]; drawSheet(); render(); return save(); }
    case 'linkadd': {
      // 直しかけの日付・メモ・金額は、移る前に保存しておく（黙って捨てない）
      readMeta(); const r = S.recs.find(x => x.id === F.editId);
      const amt = Number(F.amount || 0);
      if (amt && (amt !== r.amount || F.date !== r.date || F.memo !== (r.memo || ''))) { Object.assign(r, { amount: amt, date: F.date, memo: F.memo }); await save(); }
      return openEntry(null, { linkTarget: r.id, mode: r.kind === 'loan' ? 'out' : r.kind });
    }
    case 'unlinkF': F.linkTarget = null; return drawSheet();
    case 'unlink': { const r = S.recs.find(x => x.id === F.editId); delete r.link; tidyLinks(S); toast('紐づけを外しました'); drawSheet(); render(); return save(); }
    case 'linkpick': return openLinkPick(F.editId);
    case 'linkset': {
      const r = S.recs.find(x => x.id === F.recId);
      const target = d.g ? linkGroups(S).find(x => x.id === d.g).recs[0] : S.recs.find(x => x.id === d.id);
      linkTo(S, r, target); tidyLinks(S); toast('紐づけました');
      openGroup(r.link); render(); return save();
    }
    case 'drill': if (d.now) { V.month = monthOf(today()); V.wf = 'all'; } return openDrill(d.dc, d.mv);
    case 'drillkind': return openDrill(null, null, d.k);
    case 'wmore': F.more = true; return drawSheet();
    case 'adjust': return openAdjust(d.w);
    case 'saveloan': {
      readMeta();
      const side = (v, name) => v === 'new' ? ((name || '').trim() ? 'p:' + name.trim() : null) : v;
      const from = side(F.wallet, F.newFrom), to = side(F.to, F.newTo);
      if (!from || !to) { $('.loanhint').textContent = '相手の名前を入れてください'; return; }
      if (from === to) { $('.loanhint').textContent = '同じ相手です'; return; }
      return commit({ kind: 'loan', amount: Number(F.amount), wallet: from, to, date: F.date, memo: F.memo, cat: undefined });
    }
    case 'loan': return openLoan(d.d, d.c);
    case 'repayall': {
      const n = owed(S, F.d, F.c); if (n <= 0) return;
      const rec = { id: uid(), t: Date.now(), kind: 'loan', amount: n, wallet: F.d, to: F.c, date: today(), memo: '' };
      S.recs.push(rec); lastSaved = rec.id; F = null; drawSheet(); render(); toast(`${N(rec.wallet)} → ${N(rec.to)} ${yen(n)}円を記録しました`, true); return save();
    }
    case 'repaypart': { const { d: dd, c: cc } = F; F = { mode: 'loan', amount: '', wallet: dd, to: cc, walletManual: true, cat: null, date: today(), memo: '' }; return drawSheet(); }
    case 'savemove': readMeta(); return commit({ kind: 'move', amount: Number(F.amount), wallet: F.wallet, to: F.to, date: F.date, memo: F.memo, cat: undefined });
    case 'saveadj': {
      const diff = Number(F.amount) - adjBase();
      if (F.editId) S.recs = S.recs.filter(x => x.id !== F.editId);
      S.recs.push({ id: uid(), t: Date.now(), kind: 'adj', amount: diff, wallet: F.wallet, date: today(), memo: '' });
      F = null; drawSheet(); render(); toast('残高を合わせました'); return save();
    }
    case 'askdel': readMeta(); F.confirmDel = true; return drawSheet();
    case 'nodel': F.confirmDel = false; return drawSheet();
    case 'del': S.recs = S.recs.filter(x => x.id !== F.editId); tidyLinks(S); F = null; drawSheet(); render(); toast('消しました'); return save();
    case 'undo': S.recs = S.recs.filter(x => x.id !== lastSaved); tidyLinks(S); $('#toast').hidden = true; render(); return save();
    case 'mprev': V.month = shiftMonth(V.month, -1); return render();
    case 'mnext': V.month = shiftMonth(V.month, 1); return render();
    case 'histmore': V.histMore = true; return render();
    case 'cadd': S.cats.push({ id: uid(), name: '新しい分類', kind: 'out', wallet: 'me' }); render(); return save();
    case 'cdel': { const i = Number(d.i), c = S.cats[i]; if (S.fixed.some(f => f.cat === c.id && !f.to)) { toast(`固定費で${c.name}を使っているので消せません`); return; } if (usage(S)[c.id]) { c.hidden = true; toast(`${c.name}をボタンから隠しました`); } else S.cats.splice(i, 1); render(); return save(); }
    case 'cshow': S.cats[Number(d.i)].hidden = false; render(); return save();
    case 'fadd': S.fixed.push({ id: uid(), name: '', amount: 0, day: new Date().getDate(), wallet: 'me', cat: 'fix', from: today(), done: [] }); render(); return save();
    case 'fdel': S.fixed.splice(Number(d.i), 1); render(); return save();
    case 'bknow': M.lastError = ''; paintBackup(); return runBackup();
    case 'dismiss': M.dismissed = [...(M.dismissed || []).filter(x => notices(S, today()).some(n => n.id === x)), d.nid]; await saveMeta(); return render();
    case 'restorepick': return openPick();
    case 'pickday': F.chosen = d.date; return drawSheet();
    case 'picknot': F.chosen = null; return drawSheet();
    case 'pickgo': return pickGo();
    // 最初の設定
    case 's-new': V.setup = { step: 'balances', bal: ['', '', ''] }; return renderSetup();
    case 's-restore': V.setup = { step: 'restore' }; return renderSetup();
    case 's-hello': V.setup = { step: 'hello' }; return renderSetup();
    case 's-back': V.setup = { step: 'hello' }; return renderSetup();
    case 's-balances': V.setup.step = 'balances'; V.setup.err = ''; return renderSetup();
    case 's-pass': V.setup.step = 'pass'; return renderSetup();
    case 's-finish': return finishSetup();
    case 's-fetch': return fetchForRestore();
    case 's-apply': return applyRestore();
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.sbal != null) V.setup.bal[Number(el.dataset.sbal)] = el.value;
});
// 設定の欄は、書き換えても画面を作り直さない（次の欄に移るときに入力が消えないように）
document.addEventListener('change', e => {
  const el = e.target, d = el.dataset; if (!d.set || !S) return;
  const i = Number(d.i), v = el.value.trim(), n = toNum(v);
  const f = S.fixed[i];
  switch (d.set) {
    case 'wname': S.wallets[i].name = v || S.wallets[i].name; break;
    case 'winit': S.wallets[i].init = n; break;
    case 'cname': S.cats[i].name = v || S.cats[i].name; break;
    case 'cwallet': S.cats[i].wallet = v; break;
    case 'ckind': S.cats[i].kind = v; break;
    case 'cbudget': if (n > 0) S.cats[i].budget = n; else delete S.cats[i].budget; el.value = n > 0 ? n : ''; break;
    case 'gname': { S.groups = S.groups || {}; const m = S.groups[F.g] = S.groups[F.g] || {}; if (v) m.name = v; else delete m.name; if (!Object.keys(m).length) delete S.groups[F.g]; render(); break; }
    case 'ldue': S.loanDue = S.loanDue || {}; if (v) S.loanDue[pairKey(F.d, F.c)] = v; else delete S.loanDue[pairKey(F.d, F.c)]; break;
    case 'fname': f.name = v; break;
    case 'famt': f.amount = n; break;
    case 'fday': f.day = Math.min(31, Math.max(1, n || 1)); el.value = f.day; break;
    case 'fwallet': f.wallet = v; if (f.to === v || f.loanTo === v) { delete f.to; delete f.loanTo; f.cat = 'fix'; } render(); break;
    case 'fdest': delete f.to; delete f.cat; delete f.loanTo;
      if (v.startsWith('to:')) f.to = v.slice(3); else if (v.startsWith('loan:')) f.loanTo = v.slice(5); else f.cat = v.slice(4); break;
  }
  save();
});

/* ================= 起動 ================= */

async function boot() {
  try {
    S = await store.get('state');
    M = (await store.get('meta')) || {};
  } catch (e) {
    $('#app').innerHTML = `<div class="wrap"><p class="err">このiPhoneの保存場所が開けませんでした（${esc(e.message)}）。プライベートブラウズでは使えません。</p></div>`;
    return;
  }
  if (!isValidState(S)) { V.setup = { step: 'hello' }; return renderSetup(); }
  store.askPersist();
  if (applyFixed(S, today())) await save();
  render();
  scheduleBackup(1200);
}
boot();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
