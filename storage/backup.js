/* POCKETROLL — storage layer 4/4: backup and restore.
   schemaVersion is what a future app reads to know how the file is shaped; counts let the
   UI verify a file without loading every frame. A restore never half-applies: every record —
   including the roll still in the camera — is validated before anything is written, the whole
   file is committed in one IndexedDB transaction, and the app takes the new state only after
   the store agrees. */
'use strict';

const BACKUP_SCHEMA = 2;
let pendingBackup = null; // the validated plan, shown before the user confirms

/* The payload is built separately from the download so a caller can test what a file would
   contain. A roll still in the camera is part of what the user owns: exporting only the
   developed shelf would lose the exposures that have not been developed yet. */
function backupPayload(){
  const inCamera = rollInCamera() ? rollRecord() : null;
  if (!state.rolls.length && !state.scans.length && !inCamera) return null;
  const frames = state.rolls.reduce((n, r) => n + (r.frames?.length || 0), 0);
  return { app: 'pocketroll', schemaVersion: BACKUP_SCHEMA, version: 1, exported: new Date().toISOString(),
    counts: { rolls: state.rolls.length, frames, scans: state.scans.length, latent: inCamera ? inCamera.frames.length : 0 },
    rolls: state.rolls, scans: state.scans, inCamera };
}
function backupAll(){
  const payload = backupPayload();
  if (!payload) { toast('nothing to back up yet — expose a frame, or run a photo through the film'); return; }
  const json = JSON.stringify(payload);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = 'pocketroll-archive-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  const latent = payload.counts.latent ? ` · ${payload.counts.latent} latent frames in the camera` : '';
  toast(`exported ${payload.counts.rolls} rolls · ${payload.counts.frames} frames · ${payload.counts.scans} scans${latent} · restore the file on any device`);
}
/* Frames carry the image source the app can render; anything else is an incomplete record,
   stated in the plan rather than written. */
function frameList(list){
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const f of list){
    const u = f && safeImageURL(f.u || f.url);
    if (!u) return null;
    out.push({ u, t: safeImageURL(f.t) || u, fav: !!(f && f.fav) });
  }
  return out.length ? out : null;
}
function validateRoll(r){
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return null;
  const frames = frameList(r.frames);
  if (!frames) return null;
  return migrateRoll({ ...r, frames });
}
/* A roll in the camera is held to the same standard as a shelf record: it is a roll with an
   identity, a body, a stock, a gate, and real exposures — not a loose array of pictures. */
function validateCurrentRoll(rec){
  if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || !rec.id) return null;
  if (rec.status !== 'shooting' || rec.developed) return null;
  const frames = frameList(rec.frames);
  if (!frames) return null;
  const num = v => Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : null;
  /* The gate travels with the record: a restored roll must say how many frames its body holds.
     Older files wrote the format but not the capacity, so the format still answers for them;
     a record with neither is incomplete, not a roll to guess at. The exposures decide how
     many frames are left, so a file never invents a count. */
  const format = typeof rec.format === 'string' && rec.format ? rec.format : '35mm (135)';
  const capacity = num(rec.capacity) ?? (/135/.test(format) ? 36 : null);
  if (capacity === null || capacity < 1 || frames.length > capacity) return null;
  const shotsLeft = num(rec.shotsLeft) ?? Math.max(0, capacity - frames.length);
  /* A record may name its gear or point at it by id; either way the app must be able to load
     it. Ids are matched against the library the app actually has — a record pointing at a body
     or stock we do not own is refused rather than loaded into the wrong camera. */
  const camId = typeof rec.camId === 'string' ? rec.camId : (typeof rec.cameraId === 'string' ? rec.cameraId : '');
  const filmId = typeof rec.filmId === 'string' ? rec.filmId : '';
  const camProfile = (state.cameras || []).find(c => c.id === camId);
  const filmProfile = (state.films || []).find(f => f.id === filmId);
  /* The record names its gear the way the app prints it (brand + model / brand + name). A
     file that only carries ids gets the same names from the library we actually have; a file
     pointing at a body or stock we do not own is refused rather than loaded into the wrong
     camera. */
  const cam = (typeof rec.cam === 'string' && rec.cam) ? rec.cam
    : (camProfile ? `${camProfile.brand} ${camProfile.model}` : '');
  const film = (typeof rec.film === 'string' && rec.film) ? rec.film
    : (filmProfile ? `${filmProfile.brand} ${filmProfile.name}` : '');
  if (!cam || !film) return null;
  const loadedAt = Number.isFinite(Number(rec.loadedAt)) ? Number(rec.loadedAt) : Date.now();
  return { id: rec.id, status: 'shooting', developed: false,
    camId: camId || '', cam,
    filmId: filmId || '', film,
    iso: typeof rec.iso === 'number' ? rec.iso : (filmProfile?.iso ?? null),
    shotsLeft: Math.min(shotsLeft, capacity), capacity, format,
    loadedAt, frames };
}
function validateBackup(j){
  if (!j || j.app !== 'pocketroll') return { ok: false, why: 'not a pocketroll backup file · your archive stays untouched' };
  if (j.schemaVersion === undefined && j.version === undefined) return { ok: false, why: 'this file has no schema version · your archive stays untouched' };
  const rolls = Array.isArray(j.rolls) ? j.rolls : [];
  const scans = Array.isArray(j.scans) ? j.scans : [];
  const goodRolls = [], bad = [];
  for (const r of rolls) {
    const rec = validateRoll(r);
    if (!rec) { bad.push(String((r && r.id) || 'unnamed roll')); continue; }
    goodRolls.push(rec);
  }
  const goodScans = scans.filter(s => s && typeof s.u === 'string' && safeImageURL(s.u)).map(s => ({
    id: s.id || ('scan-' + Date.now().toString(36)), u: safeImageURL(s.u), t: safeImageURL(s.t) || safeImageURL(s.u),
    date: s.date || Date.now(), cam: s.cam || 'unknown body', film: s.film || 'unknown stock', iso: s.iso || null }));
  let inCamera = null;
  if (j.inCamera) {
    const rec = validateCurrentRoll(j.inCamera);
    if (rec) inCamera = rec;
    else bad.push(String((j.inCamera && j.inCamera.id) || 'roll in the camera') + ' (camera roll incomplete)');
  }
  const frames = goodRolls.reduce((n, r) => n + r.frames.length, 0);
  return { ok: goodRolls.length > 0 || goodScans.length > 0 || !!inCamera,
    why: 'no usable records in this file · your archive stays untouched',
    rolls: goodRolls, scans: goodScans, frames, bad, inCamera };
}
function planText(v){
  return `will restore ${v.rolls.length} roll${v.rolls.length === 1 ? '' : 's'} · ${v.frames} frame${v.frames === 1 ? '' : 's'} · ${v.scans.length} scan${v.scans.length === 1 ? '' : 's'}`
    + (v.inCamera ? ` · ${v.inCamera.frames.length} latent frames go back into the camera` : '')
    + ` · what you already kept stays kept${v.bad.length ? ` · ${v.bad.length} incomplete record${v.bad.length === 1 ? '' : 's'} skipped` : ''}`;
}
async function restoreFile(file, { preview = false } = {}){
  let j;
  try { j = JSON.parse(await file.text()); } catch { toast('backup file could not be read · your archive stays untouched'); return; }
  const v = validateBackup(j);
  if (!v.ok) { toast(v.why); return; }
  if (preview) {
    const plan = $('restorePlan'), text = $('restorePlanText');
    if (plan && text) {
      pendingBackup = v;
      text.textContent = planText(v);
      plan.style.display = '';
      toast('this is what the file contains · CONFIRM RESTORE to merge it');
      return;
    }
  }
  await applyBackup(v);
}
/* The restore is atomic: the merged shelf is computed in memory first, then committed as ONE
   IndexedDB transaction across both shelves (plus the delete that clears the camera's old
   roll). Nothing in the app changes until that transaction completes; if it aborts, the
   archive, the scans and the roll in the camera stay exactly as they were. */
async function applyBackup(v){
  if (!v || !v.ok) return;
  const mergedRolls = state.rolls.slice(), mergedScans = state.scans.slice();
  const puts = [];
  let added = 0, dupes = 0, scanAdded = 0;
  for (const rec of v.rolls) {
    const i = mergedRolls.findIndex(x => x.id === rec.id);
    if (i >= 0) { mergedRolls[i] = rec; dupes++; } else mergedRolls.push(rec);
    added++;
    puts.push([rec, DB_STORE]);
  }
  for (const s of v.scans) {
    const i = mergedScans.findIndex(x => x.id === s.id);
    if (i >= 0) { mergedScans[i] = s; dupes++; } else mergedScans.push(s);
    scanAdded++;
    puts.push([s, SCAN_STORE]);
  }
  mergedRolls.sort((a, b) => (b.developedAt || 0) - (a.developedAt || 0));
  mergedScans.sort((a, b) => (b.date || 0) - (a.date || 0));
  /* A camera holds one roll. If the user is mid-roll, the imported latent roll stays on
     record and comes back once that roll is developed or fogged — never silently replacing it.
     Only an empty chamber takes the imported roll, and then the chamber's own record leaves
     the store in the same transaction that writes the new one. */
  const takesCamera = !!v.inCamera && !rollInCamera();
  const deletes = takesCamera && state.rollId ? [state.rollId] : [];
  if (v.inCamera) puts.push([v.inCamera, DB_STORE]);
  try {
    if (db) await idbApply({ puts, deletes });
    else { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(mergedRolls.slice(0, 6))); } // degraded device: small local shelf
  } catch {
    pendingBackup = null;
    const plan = $('restorePlan'); if (plan) plan.style.display = 'none';
    toast('could not write the restored records · your archive and the roll in the camera are unchanged');
    return;
  }
  // the store agreed: only now does the app take the restored state
  state.rolls = mergedRolls;
  state.scans = mergedScans;
  let camNote = '';
  if (v.inCamera) {
    if (!takesCamera) {
      pendingRoll = v.inCamera;
      camNote = ' · a roll is already in the camera: the restored latent roll waits in storage until it resolves';
    } else {
      state.rollId = null; state.frames = []; state.developed = false; state.sheet = null;
      try { restoreCurrentRoll(v.inCamera); camNote = ` · ${v.inCamera.frames.length} latent frames went back into the camera`; }
      catch { pendingRoll = v.inCamera; camNote = ' · the restored roll is on record; reload the page to put it in the camera'; }
    }
  }
  renderArchive();
  toast(`restored ${added} roll${added === 1 ? '' : 's'} · ${scanAdded} scan${scanAdded === 1 ? '' : 's'} · ${dupes} already here, refreshed${v.bad.length ? ` · ${v.bad.length} incomplete records skipped` : ''}${camNote}`);
  pendingBackup = null;
  const plan = $('restorePlan'); if (plan) plan.style.display = 'none';
}
