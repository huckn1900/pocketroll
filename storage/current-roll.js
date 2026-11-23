/* POCKETROLL — storage layer 2/4: the roll sitting in the camera.
   An undeveloped roll is data, not scratch state: it is written down when loaded and on
   every exposure, so closing the page never costs a photo the user already took. The record
   is also the interchange format — backup files carry the same shape. */
'use strict';

let pendingRoll = null; // the record found at boot; the UI decides whether to put it back

function newRollId(){ return 'roll-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
function rollInCamera(){ return !!state.rollId && state.frames.length > 0 && !state.developed; }
function rollRecord(){
  return { id: state.rollId, status: 'shooting', developed: false,
    camId: state.cam?.id || '', cam: state.cam ? `${state.cam.brand} ${state.cam.model}` : 'unknown body',
    filmId: state.film?.id || '', film: state.film ? `${state.film.brand} ${state.film.name}` : 'unknown stock',
    iso: state.film?.iso || null, shotsLeft: state.shotsLeft, loadedAt: state.loadedAt || Date.now(),
    // the gate belongs to the body: a record must say how many frames its camera holds,
    // so restoring a 6×7 roll never comes back as a 36-frame 135 roll.
    capacity: rollCapacity(), format: state.cam?.format || '35mm (135)',
    frames: state.frames.map(f => ({ u: f.url, t: f.t || f.url, fav: false })) };
}
async function saveCurrentRoll(){
  if (!db || !state.rollId) return;
  try { await idbPut(rollRecord()); }
  catch { toast('could not save this roll · export a backup from GALLERY to keep it'); }
}
async function dropCurrentRoll(){
  const id = state.rollId; state.rollId = null;
  if (db && id){ try { await idbDelete(id); } catch {} }
}
async function saveScan(s){
  if (!db) return;
  try { await idbPut(s, SCAN_STORE); }
  catch { toast('could not save the scan · export a backup from GALLERY'); }
}
function restoreCurrentRoll(rec){
  const f = state.films.find(x => x.id === rec.filmId);
  const c = state.cameras.find(x => x.id === rec.camId);
  if (f) applyFilm(f);
  if (c) loadCamera(c, { quiet: true });
  state.rollId = rec.id; state.loadedAt = rec.loadedAt || Date.now();
  state.frames = (rec.frames || []).map(fr => ({ url: fr.u, t: fr.t || fr.u }));
  const cap = Number(rec.capacity) || rollCapacity();
  state.shotsLeft = Math.max(0, Math.min(cap, Number(rec.shotsLeft) || 0));
  state.developed = false; state.sheet = null;
  renderCounter(); renderStrip(); renderRollPage();
  if (state.frames.length) toast(`picked up where you left off · ${state.frames.length} frames still latent`);
}
