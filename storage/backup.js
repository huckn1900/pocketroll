/* POCKETROLL — storage layer 4/4: backup and restore.
   schemaVersion is what a future app reads to know how the file is shaped; counts let the
   UI verify a file without loading every frame. A restore never half-applies: the whole file
   is validated before anything is written, and what is already kept stays kept. */
'use strict';

const BACKUP_SCHEMA = 2;
let pendingBackup = null; // the validated plan, shown before the user confirms

function backupAll(){
  if (!state.rolls.length && !state.scans.length) { toast('nothing to back up yet'); return; }
  const frames = state.rolls.reduce((n, r) => n + (r.frames?.length || 0), 0);
  const payload = { app: 'pocketroll', schemaVersion: BACKUP_SCHEMA, version: 1, exported: new Date().toISOString(),
    counts: { rolls: state.rolls.length, frames, scans: state.scans.length },
    rolls: state.rolls, scans: state.scans,
    inCamera: state.rollId && state.frames.length && !state.developed ? rollRecord() : null };
  const json = JSON.stringify(payload);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = 'pocketroll-archive-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  toast(`exported ${state.rolls.length} rolls · ${frames} frames · ${state.scans.length} scans · restore the file on any device`);
}
function validateBackup(j){
  if (!j || j.app !== 'pocketroll') return { ok: false, why: 'not a pocketroll backup file · your archive stays untouched' };
  if (j.schemaVersion === undefined && j.version === undefined) return { ok: false, why: 'this file has no schema version · your archive stays untouched' };
  const rolls = Array.isArray(j.rolls) ? j.rolls : [];
  const scans = Array.isArray(j.scans) ? j.scans : [];
  const goodRolls = [], bad = [];
  for (const r of rolls) {
    const fr = Array.isArray(r?.frames) ? r.frames : [];
    const usable = fr.length > 0 && fr.every(f => f && typeof (f.u || f.url || f.t) === 'string');
    if (!r || typeof r !== 'object' || !usable) { bad.push(String(r?.id || 'unnamed roll')); continue; }
    goodRolls.push(migrateRoll({ ...r, frames: fr.map(f => ({ u: f.u || f.url || f.t, t: f.t || f.u || f.url, fav: !!f.fav })) }));
  }
  const goodScans = scans.filter(s => s && typeof s.u === 'string').map(s => ({
    id: s.id || ('scan-' + Date.now().toString(36)), u: s.u, t: s.t || s.u, date: s.date || Date.now(),
    cam: s.cam || 'unknown body', film: s.film || 'unknown stock', iso: s.iso || null }));
  const frames = goodRolls.reduce((n, r) => n + r.frames.length, 0);
  const inCamera = j.inCamera && Array.isArray(j.inCamera.frames) && j.inCamera.frames.length ? j.inCamera : null;
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
async function applyBackup(v){
  if (!v || !v.ok) return;
  const beforeRolls = state.rolls.slice(), beforeScans = state.scans.slice(), beforeRollId = state.rollId, beforePending = pendingRoll;
  let added = 0, dupes = 0, scanAdded = 0;
  try {
    for (const rec of v.rolls) {
      const i = state.rolls.findIndex(x => x.id === rec.id);
      if (i >= 0) { state.rolls[i] = rec; dupes++; } else { state.rolls.push(rec); }
      added++;
      if (db) await idbPut(rec);
    }
    for (const s of v.scans) {
      const i = state.scans.findIndex(x => x.id === s.id);
      if (i >= 0) { state.scans[i] = s; dupes++; } else { state.scans.push(s); }
      scanAdded++;
      if (db) await idbPut(s, SCAN_STORE);
    }
    let camNote = '';
    if (v.inCamera) {
      if (db) await idbPut(v.inCamera);
      /* A camera holds one roll. If the user is mid-roll, the imported latent roll stays on
         record and comes back once that roll is developed or fogged — never silently replacing it. */
      if (rollInCamera()) {
        pendingRoll = v.inCamera;
        camNote = ' · a roll is already in the camera: the restored latent roll waits in storage until it resolves';
      } else {
        if (state.rollId) await dropCurrentRoll();
        state.frames = []; state.developed = false;
        restoreCurrentRoll(v.inCamera);
        camNote = ` · ${v.inCamera.frames.length} latent frames went back into the camera`;
      }
    }
    state.rolls.sort((a, b) => (b.developedAt || 0) - (a.developedAt || 0));
    state.scans.sort((a, b) => (b.date || 0) - (a.date || 0));
    if (!db) { try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(state.rolls.slice(0, 6))); } catch {} }
    renderArchive();
    toast(`restored ${added} roll${added === 1 ? '' : 's'} · ${scanAdded} scan${scanAdded === 1 ? '' : 's'} · ${dupes} already here, refreshed${v.bad.length ? ` · ${v.bad.length} incomplete records skipped` : ''}${camNote}`);
  } catch (e) {
    // nothing partial: the archive the user already had comes back exactly as it was
    state.rolls = beforeRolls; state.scans = beforeScans; state.rollId = beforeRollId; pendingRoll = beforePending;
    renderArchive();
    toast('could not write the restored records · your archive is unchanged');
  } finally {
    pendingBackup = null;
    const plan = $('restorePlan'); if (plan) plan.style.display = 'none';
  }
}
