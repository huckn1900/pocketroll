/* POCKETROLL — storage layer 1/4: the device store.
   IndexedDB is the real store; localStorage holds settings and the legacy shelf being
   migrated once. If IDB is unavailable the app says so plainly instead of pretending the
   photos are safe, and asks for a backup export. Nothing here knows about the UI. */
'use strict';

const ARCHIVE_KEY = 'pocketroll-archive-v1'; // legacy shelf: migrated into IDB once
const DB_NAME = 'pocketroll-db', DB_STORE = 'rolls', SCAN_STORE = 'scans';
let db = null, storageBroken = false;

function openDB(){
  return new Promise((res, rej) => {
    if (!('indexedDB' in window)) { rej(new Error('no indexedDB')); return; }
    const rq = indexedDB.open(DB_NAME, 2);
    rq.onupgradeneeded = () => {
      const d = rq.result; // v2 adds the scan shelf; existing rolls are untouched
      if (!d.objectStoreNames.contains(DB_STORE)) d.createObjectStore(DB_STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(SCAN_STORE)) d.createObjectStore(SCAN_STORE, { keyPath: 'id' });
    };
    rq.onerror = () => rej(rq.error || new Error('db open failed'));
    rq.onsuccess = () => res(rq.result);
  });
}
function idbGetAll(store){
  return new Promise((res, rej) => {
    const rq = db.transaction(store, 'readonly').objectStore(store).getAll();
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}
function idbPut(rec, store){
  return new Promise((res, rej) => {
    const rq = db.transaction(store || DB_STORE, 'readwrite').objectStore(store || DB_STORE).put(rec);
    rq.onsuccess = () => res(true); rq.onerror = () => rej(rq.error);
  });
}
function idbDelete(key){
  return new Promise((res, rej) => {
    const rq = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).delete(key);
    rq.onsuccess = () => res(true); rq.onerror = () => rej(rq.error);
  });
}
/* One readwrite transaction over both shelves. A restore uses this so the whole file lands
   together or not at all — several separate transactions can half-apply, and a half-written
   archive is the thing users cannot recover from by themselves. */
function idbApply({ puts = [], deletes = [] }){
  return new Promise((res, rej) => {
    if (!db) { rej(new Error('no device store')); return; }
    let tx;
    try { tx = db.transaction([DB_STORE, SCAN_STORE], 'readwrite'); } catch (e) { rej(e); return; }
    for (const key of deletes) tx.objectStore(DB_STORE).delete(key);
    for (const [rec, store] of puts) tx.objectStore(store || DB_STORE).put(rec);
    // the transaction, not each request, is the unit of truth: it completes or aborts as one
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error || new Error('store write failed'));
    tx.onabort = () => rej(tx.error || new Error('store write aborted'));
  });
}
/* Only the shapes this app ever writes are accepted as image sources: frames are canvas data
   URLs (base64 or percent-encoded), an imported file is a blob URL for one decode. A backup
   file is untrusted data, so anything else — including a string built to break out of an HTML
   attribute — is refused here, before it can reach markup, a CSS value, or a navigation. */
function safeImageURL(v){
  if (typeof v !== 'string') return null;
  if (/["'<>\\\s]/.test(v)) return null; // markup or whitespace: never a source this app writes
  if (/^data:image\/(png|jpe?g|gif|webp)(;base64)?[,]/i.test(v)) return v;
  if (/^blob:/.test(v)) return v;
  return null;
}
/* A CSS url() value quoted and escaped, so a stored string cannot close the declaration
   early and write styles it did not own. */
function cssUrl(v){
  const u = safeImageURL(v);
  if (!u) return '';
  return 'url("' + u.replace(/[\\"]/g, c => '\\' + c) + '")';
}
/* What the settings page states: how much the shelf holds and how much room is left.
   Returns null when the browser cannot answer — the UI then says so instead of guessing. */
async function storageEstimate(){
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const est = await navigator.storage.estimate();
    return { usage: est.usage || 0, quota: est.quota || 0 };
  } catch { return null; }
}
