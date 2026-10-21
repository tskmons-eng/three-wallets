// iPhone の中の保存（IndexedDB）。家計のデータ全体を1つ、バックアップ用の鍵などを別に1つ持つ。

const DB = 'three-wallets', STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbp;
const db = () => (dbp = dbp || open());

export async function get(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function set(key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// iPhone が勝手に消さないように頼む（ホーム画面に置いたアプリなら通ることが多い）
export async function askPersist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
  return false;
}
