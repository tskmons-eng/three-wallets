// 電波がなくても開けるように、アプリの部品をこの端末にしまっておく。
// 版を上げたら CACHE の名前も変える（scripts/check.sh が main.js の VERSION と同じか確かめる）。
const CACHE = 'three-wallets-1.5.0';
const FILES = ['./', './index.html', './style.css', './manifest.webmanifest', './js/main.js', './js/calc.js', './js/store.js', './js/backup.js', './js/labels.js', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 同じ場所のファイルだけ扱う。バックアップのサーバーへの通信には触らない。
// 電波が弱くてもすぐ開くように、しまってある分を先に出し、裏で新しいものを取ってしまい直す（次に開いたときに新しくなる）。
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const cached = await c.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; });
    if (cached) { e.waitUntil(fresh.catch(() => {})); return cached; }
    return fresh.catch(() => c.match('./index.html'));
  }));
});
