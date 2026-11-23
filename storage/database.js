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
/* What the settings page states: how much the shelf holds and how much room is left.
   Returns null when the browser cannot answer — the UI then says so instead of guessing. */
async function storageEstimate(){
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const est = await navigator.storage.estimate();
    return { usage: est.usage || 0, quota: est.quota || 0 };
  } catch { return null; }
}
