// Trwały zapis ostatnio wczytanego skanu w przeglądarce (IndexedDB, duży limit; Map i Set zapisują się wprost).
// Wszystkie funkcje połykają błędy (tryb prywatny, zablokowane dane witryn) i zwracają false/null.
const DB_NAME = "dealhunter-ah";
const STORE = "kv";

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("brak IndexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB zablokowana"));
  });
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(result.result ?? true); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

export async function kvSet(key, value) {
  try { return await run("readwrite", (s) => s.put(value, key)); } catch { return false; }
}
export async function kvGet(key) {
  try { return (await run("readonly", (s) => s.get(key))) ?? null; } catch { return null; }
}
export async function kvDelete(key) {
  try { return await run("readwrite", (s) => s.delete(key)); } catch { return false; }
}
