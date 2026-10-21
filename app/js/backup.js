// 自社サーバーへのバックアップ。送る前にこの端末の中で合言葉から作った鍵で暗号化する。
// サーバーに置かれるのは読めない中身だけ。合言葉そのものはどこにも保存しない。
//
// 合言葉から2つを作る：
//   バックアップID … 持ち主の目印。新しいiPhoneでも合言葉だけで同じものが作れる（固定の塩を使う）
//   暗号の鍵       … 端末ごとの塩で作る。塩は暗号文と一緒に送るので、戻すときは合言葉と塩から作り直せる

export const SERVER = 'https://seemore-grp.com/wallet-backup/';
const ITER = 310000;
const enc = new TextEncoder(), dec = new TextDecoder();

function b64(buf) {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function material(pass) {
  return crypto.subtle.importKey('raw', enc.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
}

export async function deriveId(pass) {
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('three-wallets/backup-id/v1'), iterations: ITER }, await material(pass), 256);
  return hex(bits);
}

export async function deriveKey(pass, salt) {
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, await material(pass),
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(state, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(state)));
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct), at: new Date().toISOString() };
}

// この端末にしまってある鍵で開く。開けなければ例外
export async function openWithKey(blob, key, failMsg = '合言葉が違うか、バックアップが壊れています') {
  let pt;
  try { pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct)); }
  catch (e) { throw new Error(failMsg); }
  return JSON.parse(dec.decode(pt));
}

export async function open(blob, pass) {
  const key = await deriveKey(pass, unb64(blob.salt));
  return { state: await openWithKey(blob, key), key, salt: unb64(blob.salt) };
}

async function call(id, opts = {}, query = '') {
  let res;
  try {
    res = await fetch(SERVER + query, { ...opts, headers: { 'X-Backup-Id': id, ...(opts.headers || {}) }, cache: 'no-store' });
  } catch (e) {
    throw new Error('サーバーにつながりません（電波を確かめてください）');
  }
  if (!res.ok) {
    let msg = 'サーバーでうまくいきませんでした（' + res.status + '）';
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res;
}

export async function push(id, blob) {
  const res = await call(id, { method: 'POST', body: JSON.stringify(blob), headers: { 'Content-Type': 'application/json' } });
  return res.json();
}

export async function fetchLatest(id, date) {
  const res = await call(id, {}, date ? '?date=' + encodeURIComponent(date) : '');
  return { blob: await res.json(), date: res.headers.get('X-Backup-Date') || date || '' };
}

export async function listDates(id) {
  const res = await call(id, {}, '?list=1');
  return (await res.json()).dates || [];
}
