// @ts-check
/**
 * db.js — a thin promise wrapper over IndexedDB.
 *
 * IndexedDB rather than localStorage because: it's asynchronous so it never
 * blocks paint, it has no 5MB ceiling (uploaded mascot images would blow
 * straight through that), and it stores Blobs natively.
 *
 * Three stores:
 *   logs  — one record per logged day, keyed by DateKey
 *   meta  — settings, the period-day set, schema version; keyed by name
 *   blobs — user-supplied mascot images, keyed by theme id
 */

const DB_NAME = 'kittycal';
const DB_VERSION = 1;

export const STORE_LOGS = 'logs';
export const STORE_META = 'meta';
export const STORE_BLOBS = 'blobs';

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

/**
 * Open (and if needed create/upgrade) the database. Memoised — every caller
 * shares one connection.
 * @returns {Promise<IDBDatabase>}
 */
export function open() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const from = event.oldVersion;

      // Migrations are additive and ordered. Each `if` is a version step, so
      // upgrading from any older version replays the steps it missed.
      if (from < 1) {
        db.createObjectStore(STORE_LOGS, { keyPath: 'date' });
        db.createObjectStore(STORE_META, { keyPath: 'key' });
        db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // If another tab opens a newer version, close this handle so the
      // upgrade there isn't blocked.
      db.onversionchange = () => db.close();
      resolve(db);
    };

    req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
    req.onblocked = () =>
      reject(new Error('Kittycal is open in another tab — close it and reload.'));
  });

  return dbPromise;
}

/**
 * Wrap an IDBRequest as a promise.
 * @template T
 * @param {IDBRequest<T>} req
 * @returns {Promise<T>}
 */
function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Run `fn` against one or more stores in a single transaction, resolving once
 * the transaction *commits* — not merely when the last request succeeds. That
 * distinction matters: a request can succeed and the transaction still abort.
 *
 * @template T
 * @param {string|string[]} stores
 * @param {IDBTransactionMode} mode
 * @param {(tx: IDBTransaction) => Promise<T>|T} fn
 * @returns {Promise<T>}
 */
export async function tx(stores, mode, fn) {
  const db = await open();
  const transaction = db.transaction(stores, mode);

  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(undefined);
    transaction.onerror = () => reject(transaction.error ?? new Error('transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
  });

  const result = await fn(transaction);
  await done;
  return result;
}

/**
 * @template T
 * @param {string} store
 * @param {IDBValidKey} key
 * @returns {Promise<T|undefined>}
 */
export async function get(store, key) {
  return tx(store, 'readonly', (t) => wrap(t.objectStore(store).get(key)));
}

/**
 * @template T
 * @param {string} store
 * @returns {Promise<T[]>}
 */
export async function getAll(store) {
  return tx(store, 'readonly', (t) => wrap(t.objectStore(store).getAll()));
}

/**
 * @param {string} store
 * @param {any} value must contain the store's keyPath
 */
export async function put(store, value) {
  return tx(store, 'readwrite', (t) => wrap(t.objectStore(store).put(value)));
}

/**
 * Write many records in one transaction — far faster than N puts, and
 * atomic, so an interrupted import can't leave a half-written database.
 * @param {string} store
 * @param {any[]} values
 */
export async function putMany(store, values) {
  if (!values.length) return;
  return tx(store, 'readwrite', (t) => {
    const os = t.objectStore(store);
    for (const value of values) os.put(value);
  });
}

/**
 * @param {string} store
 * @param {IDBValidKey} key
 */
export async function del(store, key) {
  return tx(store, 'readwrite', (t) => wrap(t.objectStore(store).delete(key)));
}

/** @param {string|string[]} stores */
export async function clear(stores) {
  const list = Array.isArray(stores) ? stores : [stores];
  return tx(list, 'readwrite', (t) => {
    for (const store of list) t.objectStore(store).clear();
  });
}

/* ── meta helpers ────────────────────────────────────────────────────────
   The meta store holds one row per named value, so reads and writes read as
   plain key/value rather than record wrangling.                          */

/**
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {Promise<T>}
 */
export async function getMeta(key, fallback) {
  /** @type {{key: string, value: T}|undefined} */
  const row = await get(STORE_META, key);
  return row === undefined ? fallback : row.value;
}

/**
 * @param {string} key
 * @param {any} value
 */
export async function setMeta(key, value) {
  return put(STORE_META, { key, value });
}

/**
 * Delete the whole database. Used by "erase all my data" in Settings, which
 * on a local-only app is the complete and final version of that promise.
 */
export async function destroy() {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve(undefined);
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(undefined); // will complete once tabs close
  });
}

/** Rough storage usage, where the browser will tell us. */
export async function usage() {
  if (!navigator.storage?.estimate) return null;
  const { usage: used = 0, quota = 0 } = await navigator.storage.estimate();
  return { used, quota };
}
