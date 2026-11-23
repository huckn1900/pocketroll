/* POCKETROLL — storage layer 3/4: developed rolls, scans, and whole-roll export.
   A developed roll replaces its shooting record under the SAME id — one roll, one record.
   A failed write never silently drops rolls: they stay visible and the user is told the one
   thing that actually rescues them (the backup export). */
'use strict';

function migrateRoll(r){
  // old shelf record → full roll record (nothing is lost on migration)
  const frames = (r.frames || []).map(u => typeof u === 'string' ? { u, t: u, fav: false } : { u: u.u, t: u.t || u.u, fav: !!u.fav });
  return { id: r.id, status: 'developed', camId: r.camId || '', cam: r.cam || 'unknown body',
    filmId: r.filmId || '', film: r.film || 'unknown stock', iso: r.iso || null,
    format: r.format || '',
    loadedAt: r.loadedAt || r.date || Date.now(), developedAt: r.developedAt || r.date || Date.now(),
    notes: r.notes || '', frames };
}
async function loadArchives(){
  try {
    db = await openDB();
    let all = await idbGetAll(DB_STORE);
    const developed = all.filter(r => r.status !== 'shooting');
    if (!developed.length) { // one-time migration of the legacy localStorage shelf
      try {
        const legacy = JSON.parse(localStorage.getItem(ARCHIVE_KEY)) || [];
        for (const r of legacy) { const rec = migrateRoll(r); await idbPut(rec); developed.push(rec); }
        if (legacy.length) localStorage.removeItem(ARCHIVE_KEY);
      } catch {}
    }
    // a roll still in the camera is not archive: it goes back into the camera on boot
    pendingRoll = all.find(r => r.status === 'shooting') || null;
    state.rolls = developed.sort((a, b) => (b.developedAt || 0) - (a.developedAt || 0));
    try { state.scans = (await idbGetAll(SCAN_STORE)).sort((a, b) => (b.date || 0) - (a.date || 0)); } catch { state.scans = []; }
  } catch (e) {
    db = null; storageBroken = true; // degraded environment: small local shelf, stated plainly
    try { state.rolls = JSON.parse(localStorage.getItem(ARCHIVE_KEY)) || []; } catch { state.rolls = []; }
    pendingRoll = null;
    toast('device storage unavailable · photos live in this session only — export a backup from GALLERY');
  }
}
async function persistRoll(rec){
  state.rolls.unshift(rec);
  state.rolls.sort((a, b) => (b.developedAt || 0) - (a.developedAt || 0));
  if (db) {
    try { await idbPut(rec); }
    catch { toast('could not write to the archive · EXPORT BACKUP in GALLERY to keep this roll'); }
  } else {
    try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(state.rolls.slice(0, 6))); } catch {}
    if (state.rolls.length > 6) toast('small local shelf holds only 6 rolls · export a backup from GALLERY');
  }
}
async function updateRoll(rec){
  if (db) { try { await idbPut(rec); } catch { toast('could not save that change · export a backup from GALLERY'); } }
  else { try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(state.rolls.slice(0, 6))); } catch {} }
}
function thumbOf(url){
  return new Promise(res => {
    const img = new Image(); img.src = url;
    img.onload = () => {
      const c = document.createElement('canvas');
      const w = Math.min(320, img.naturalWidth);
      c.width = w; c.height = Math.round(w * img.naturalHeight / img.naturalWidth);
      c.getContext('2d').drawImage(img, 0, 0, w, c.height);
      res(c.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => res(url);
  });
}
async function archiveRoll(){
  // the developed record replaces the shooting record under the SAME id — one roll, one record
  const frames = [];
  for (const f of state.frames) frames.push({ u: f.url, t: f.t || await thumbOf(f.url), fav: false });
  const rec = {
    id: state.rollId || ('roll-' + Date.now().toString(36)), status: 'developed', developed: true,
    camId: state.cam ? state.cam.id : '', cam: state.cam ? `${state.cam.brand} ${state.cam.model}` : 'scanned prints',
    filmId: state.film ? state.film.id : '', film: state.film ? `${state.film.brand} ${state.film.name}` : 'scanned prints',
    iso: state.film ? (state.film.iso || state.film.filter_params.iso || null) : null,
    // the negative the roll was shot on travels with the record: a 6×7 roll is not filed as 135
    format: state.cam?.format || '35mm (135)',
    loadedAt: state.loadedAt || Date.now(), developedAt: Date.now(),
    notes: '', frames,
  };
  state.rollId = null; // the roll has left the camera: it is archive now
  await persistRoll(rec);
  renderArchive();
}

/* ---------- whole-roll export: mini zip writer (stored, no compression) ---------- */
function crc32(buf){
  let c = ~0;
  for (let i = 0; i < buf.length; i++){ c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return (~c) >>> 0;
}
function zipStore(entries){
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries){
    const nb = new TextEncoder().encode(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + nb.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, e.data.length, true); dv.setUint32(22, e.data.length, true);
    dv.setUint16(26, nb.length, true);
    local.set(nb, 30);
    parts.push(local, e.data);
    const cen = new Uint8Array(46 + nb.length);
    const cd = new DataView(cen.buffer);
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, e.data.length, true); cd.setUint32(24, e.data.length, true);
    cd.setUint16(28, nb.length, true); cd.setUint32(42, offset, true);
    cen.set(nb, 46);
    central.push(cen);
    offset += local.length + e.data.length;
  }
  const cenLen = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ed = new DataView(end.buffer);
  ed.setUint32(0, 0x06054b50, true); ed.setUint16(8, entries.length, true); ed.setUint16(10, entries.length, true);
  ed.setUint32(12, cenLen, true); ed.setUint32(16, offset, true);
  const total = new Uint8Array(offset + cenLen + 22);
  let p = 0;
  for (const b of parts){ total.set(b, p); p += b.length; }
  for (const c of central){ total.set(c, p); p += c.length; }
  total.set(end, p);
  return total;
}
async function blobOf(dataUrl){ const r = await fetch(dataUrl); return new Uint8Array(await r.arrayBuffer()); }
async function rollZip(r){
  const entries = [];
  for (let i = 0; i < r.frames.length; i++) entries.push({ name: `frame_${String(i + 1).padStart(2, '0')}.jpg`, data: await blobOf(r.frames[i].u) });
  entries.push({ name: 'roll.json', data: new TextEncoder().encode(JSON.stringify({ camera: r.cam, film: r.film, iso: r.iso, format: r.format || '', frames: r.frames.length, loaded: r.loadedAt, developed: r.developedAt, notes: r.notes })) });
  return zipStore(entries);
}
function downloadBytes(bytes, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes])); a.download = name; a.click();
}
