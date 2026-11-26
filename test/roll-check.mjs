/* test/roll-check.mjs — the roll lifecycle (Round 15):
   1) an undeveloped roll SURVIVES a reload: same id, same frames, same counter;
   2) LAB SCANS never touch the roll count (a 36-frame roll stays 36, the counter stays honest);
   3) DEVELOP cannot run twice at once, and one develop makes one archive record;
   4) switching stock cannot silently discard an exposed roll: develop it or open the back door;
   5) backup validation: an incomplete record is skipped, a bad file leaves the archive intact,
      duplicates merge, and an undeveloped roll from a backup goes back into the camera;
   6) camera plumbing: the feed state is stated, sensor choice persists.
   Usage: node test/roll-check.mjs <base-url> */
import { spawn } from 'node:child_process';

const base = process.argv[2];
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--user-data-dir=${process.env.TEMP}\\chrome-rc-${port}-${Date.now().toString(36)}`,
  `--remote-debugging-port=${port}`,
], { stdio: 'ignore', detached: true });

async function waitPort() {
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); if (r.ok) return await r.json(); } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('chrome devtools port never came up');
}
const list = await waitPort();
const target = list.find(t => t.type === 'page') || list[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalIn = async (expr, timeout = 30000) => {
  const p = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
  return (p.result && p.result.result && p.result.result.value) ?? p.result?.value;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await send('Page.enable');
const ok = [];
const check = (cond, pass, fail) => { const line = cond ? `PASS ${pass}` : `FAIL ${fail}`; ok.push(line); console.log(line); };
const phase = (name, obj) => check(!obj.error, `${name} ran`, `${name} phase error (${obj.error})`);

/* ── 1. shoot 3 frames, then reopen the app ─────────────────────────────── */
await send('Page.navigate', { url: `${base}/index.html?cam=trip35&film=gold200&autoshot=1&shots=3` });
await sleep(3200);
const shot = JSON.parse(await evalIn(`(async () => { try {
  const rec = await idbGetAll('rolls');
  return JSON.stringify({ rollId: state.rollId, shotsLeft: state.shotsLeft, frames: state.frames.length,
    stored: rec.map(r => ({ id: r.id, status: r.status, frames: r.frames.length })),
    cells: document.querySelectorAll('#stripFrames .frame.latent').length,
    counter: document.getElementById('counter').textContent });
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`));
phase('shooting', shot);
check(shot.rollId && shot.frames === 3 && shot.shotsLeft === 33, `3 frames shot · counter ${shot.counter}`, `counter/frames wrong (${shot.counter}, ${shot.frames})`);
check((shot.stored || []).some(r => r.status === 'shooting' && r.frames === 3), `roll persisted per shot: ${JSON.stringify(shot.stored)}`, `no shooting record in IndexedDB`);
check(shot.cells === 3, `${shot.cells} latent frames on the strip`, `strip wrong (${shot.cells})`);

await send('Page.navigate', { url: `${base}/index.html` });
await sleep(3200);
const back = JSON.parse(await evalIn(`(async () => { try {
  renderArchive();
  return JSON.stringify({ rollId: state.rollId, shotsLeft: state.shotsLeft, frames: state.frames.length,
    film: state.film?.id, cam: state.cam?.id, developed: state.developed,
    cells: document.querySelectorAll('#stripFrames .frame.latent').length,
    incameraCard: !!document.querySelector('.roll-card.incamera'),
    status: document.getElementById('rollStatus').textContent });
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`));
phase('restore', back);
check(back.rollId === shot.rollId && back.frames === 3 && back.shotsLeft === 33, `roll restored after reload · same id · counter ${back.shotsLeft}`, `roll lost after reload (${JSON.stringify(back)})`);
check(back.film === 'gold200' && back.cam === 'trip35', `gear restored: ${back.cam} + ${back.film}`, `gear not restored (${JSON.stringify(back)})`);
check(back.cells === 3, 'filmstrip rebuilt with 3 latent frames', `strip wrong (${back.cells})`);
check(back.incameraCard, 'in-camera roll shown in the archive', 'no in-camera card in archive');
check(/latent|in camera|no roll/i.test(back.status || ''), `roll page states its status: "${back.status}"`, 'roll status line missing');

/* ── 2. lab scans do not touch the roll ─────────────────────────────────── */
const scan = JSON.parse(await evalIn(`(async () => { try {
  const c = document.createElement('canvas'); c.width = 640; c.height = 480;
  const g = c.getContext('2d'); g.fillStyle = '#7d8899'; g.fillRect(0, 0, 640, 480);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  const file = new File([blob], 'scan.jpg', { type: 'image/jpeg' });
  await importPhoto(file);
  await new Promise(r => setTimeout(r, 250));
  await importPhoto(new File([blob], 'scan2.jpg', { type: 'image/jpeg' }));
  await new Promise(r => setTimeout(r, 250));
  const stored = await idbGetAll('rolls');
  const scans = await idbGetAll('scans');
  document.getElementById('tabScans').click();
  return JSON.stringify({ frames: state.frames.length, shotsLeft: state.shotsLeft, scans: state.scans.length,
    storedFrames: stored.map(r => r.frames.length), storedScans: scans.length,
    scanCards: document.querySelectorAll('#archive .framecell').length,
    stripCells: document.querySelectorAll('#stripFrames .frame.latent').length,
    incameraCard: !!document.querySelector('.roll-card.incamera') });
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`));
phase('scan', scan);
check(scan.frames === 3 && scan.shotsLeft === 33 && scan.stripCells === 3, `scans left the roll alone: ${scan.frames} frames · counter ${scan.shotsLeft}`, `scans changed the roll (${JSON.stringify(scan)})`);
check(scan.scans === 2 && scan.storedScans === 2 && scan.scanCards >= 2, `2 scans kept in their own shelf (${scan.storedScans} stored, ${scan.scanCards} shown)`, `scans not stored/shown (${JSON.stringify(scan)})`);
check((scan.storedFrames || []).every(n => n === 3), 'roll record frame count stayed 3', `roll record grew (${JSON.stringify(scan.storedFrames)})`);
check(scan.incameraCard, 'the roll in the camera still shows on the scan tab', 'in-camera card vanished on the scan tab');

/* ── 3. DEVELOP cannot run twice at once ────────────────────────────────── */
const dev = JSON.parse(await evalIn(`(async () => { try {
  const p1 = developRoll();
  const midDisabled = document.getElementById('developRoll').disabled && document.getElementById('developMain').disabled;
  const p2 = developRoll(); // rapid second tap must be refused
  await Promise.all([p1, p2]);
  const rec = await idbGetAll('rolls');
  return JSON.stringify({ midDisabled, rolls: state.rolls.length, ids: state.rolls.map(r => r.id),
    developed: state.developed, stored: rec.map(r => ({ id: r.id, status: r.status, frames: r.frames.length })),
    rollId: state.rollId, sheet: !!state.sheet });
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`));
phase('develop', dev);
check(dev.midDisabled === true, 'develop controls disabled while the developer runs', 'controls stayed live while developing');
check(dev.rolls === 1 && (dev.ids || []).length === 1, `one develop → one archive record (${dev.rolls})`, `duplicate archive (${JSON.stringify(dev.ids)})`);
check((dev.stored || []).every(r => r.status === 'developed'), 'no half-finished state left in storage', `leftover shooting record (${JSON.stringify(dev.stored)})`);
check(dev.rollId === null && dev.sheet === true && dev.developed === true, 'the roll left the camera and the contact sheet exists', `camera state after develop (${JSON.stringify(dev)})`);

/* ── 4. switching stock cannot discard an exposed roll ──────────────────── */
const gate = JSON.parse(await evalIn(`(async () => { try {
  const freshRollId = loadFilm(state.films.find(x => x.id === 'portra400')) ? state.rollId : null;
  const freeOk = freshRollId !== null && state.film.id === 'portra400' && state.shotsLeft === 36;
  capture(); capture();
  const beforeSwitch = { rollId: state.rollId, frames: state.frames.length, shotsLeft: state.shotsLeft };
  const refused = loadFilm(state.films.find(x => x.id === 'hp5plus')); // exposed roll → refused
  const stillThere = { rollId: state.rollId, frames: state.frames.length, shotsLeft: state.shotsLeft, film: state.film.id };
  tryLoadFilm(state.films.find(x => x.id === 'gold200')); // offers the two physical choices
  const gateShown = document.getElementById('pvSwap').style.display !== 'none';
  const gateText = document.getElementById('pvSwapText').textContent;
  document.getElementById('swapCancel').click();
  const afterCancel = { rollId: state.rollId, frames: state.frames.length, film: state.film.id };
  tryLoadFilm(state.films.find(x => x.id === 'gold200'));
  document.getElementById('swapFog').click();
  const afterFog = { rollId: state.rollId, frames: state.frames.length, shotsLeft: state.shotsLeft, film: state.film.id, rolls: state.rolls.length };
  const stored = await idbGetAll('rolls');
  return JSON.stringify({ freeOk, freshRollId, beforeSwitch, refused, stillThere, gateShown, gateText, afterCancel, afterFog,
    storedIds: stored.map(r => r.id), storedStatuses: stored.map(r => r.status) });
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`));
phase('lifecycle', gate);
check(gate.freeOk, `empty camera → stock switches freely (${gate.freshRollId})`, 'load refused on an empty camera');
check(gate.refused === false && gate.stillThere?.rollId === gate.beforeSwitch?.rollId && gate.stillThere?.frames === 2, `exposed roll refuses a switch · ${gate.stillThere?.frames} frames kept`, 'switch silently discarded the roll');
check(gate.gateShown && /latent/.test(gate.gateText || ''), `gate offers the choice: "${gate.gateText}"`, 'no lifecycle choice shown');
check(gate.afterCancel?.frames === 2 && gate.afterCancel?.rollId === gate.beforeSwitch?.rollId, 'cancel keeps the roll untouched', 'cancel changed the roll');
check(gate.afterFog?.shotsLeft === 36 && gate.afterFog?.film === 'gold200' && gate.afterFog?.frames === 0 && gate.afterFog?.rolls === 1, 'back door → frames fogged, new roll loaded, nothing archived', `fog path wrong (${JSON.stringify(gate.afterFog)})`);
check(!(gate.storedIds || []).includes(gate.beforeSwitch?.rollId), 'the fogged roll left storage as well', `storage kept a fogged roll (${JSON.stringify(gate.storedIds)})`);

/* ── 4b. the web gate: PRO content is shown, and never loads in this build ── */
const lic = JSON.parse(await evalIn(`(async () => { try {
  document.getElementById('openDeck').click();
  const proFilms = state.films.filter(f => f.tier !== 'free' && f.status !== 'coming');
  const soonFilms = state.films.filter(f => f.status === 'coming');
  const freeFilms = state.films.filter(f => f.tier === 'free');
  const proCams = state.cameras.filter(c => c.tier !== 'free');
  const lockChips = [...document.querySelectorAll('.filmitem .stchip.lock')].map(el => el.textContent.trim());
  const soonChips = [...document.querySelectorAll('.filmitem .stchip.soon')].length;
  const availChips = [...document.querySelectorAll('.filmitem .stchip.avail')].length;
  const selChips = [...document.querySelectorAll('.filmitem .stchip.sel')].length;
  const camLockChips = [...document.querySelectorAll('.camitem.locked .stchip.lock')].map(el => el.textContent.trim());
  const gateNote = document.getElementById('filmGate').textContent;
  const bagNote = document.getElementById('bagGate').textContent;
  const before = { film: state.film?.id, cam: state.cam?.id, frames: state.frames.length, rollId: state.rollId };
  const lf = state.films.find(f => f.tier !== 'free' && f.status !== 'coming');
  await openFilmPreview(lf);
  const pvBtn = document.getElementById('pvLoad').textContent;
  const pvHint = document.getElementById('pvHint').textContent;
  document.getElementById('pvLoad').click();
  const afterUnlock = { film: state.film?.id, frames: state.frames.length, rollId: state.rollId };
  document.querySelector('#filmPreview [data-close]').click();
  const lockedCam = state.cameras.find(c => c.tier !== 'free');
  const camCard = [...document.querySelectorAll('.camitem.locked')][0];
  if (camCard) camCard.click();
  const afterCamTry = { cam: state.cam?.id };
  document.querySelector('#deckModal [data-close]').click();
  return JSON.stringify({ proFilms: proFilms.length, soonFilms: soonFilms.length, freeFilms: freeFilms.length,
    proCams: proCams.length, lockChips, soonChips, availChips, selChips, camLockChips, gateNote, bagNote,
    before, pvBtn, pvHint, afterUnlock, afterCamTry });
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`));
phase('gate', lic);
check((lic.lockChips || []).length === lic.proFilms && (lic.lockChips || []).every(t => /LOCKED/.test(t) && /PRO/.test(t)),
  `every PRO stock reads LOCKED · PRO (${(lic.lockChips || []).length} of ${lic.proFilms})`, `PRO chips missing or mislabelled (${JSON.stringify(lic.lockChips)})`);
check((lic.camLockChips || []).length === lic.proCams, `every PRO body reads LOCKED · PRO (${(lic.camLockChips || []).length} of ${lic.proCams})`, `PRO body chips missing (${JSON.stringify(lic.camLockChips)})`);
check(lic.availChips + lic.selChips === lic.freeFilms && lic.soonChips === lic.soonFilms,
  `free stocks stay usable (${lic.availChips} available + ${lic.selChips} selected) and the unfinished one stays COMING SOON`,
  `shelf states do not match the tiers (${JSON.stringify(lic)})`);
check(!lic.gateNote && !lic.bagNote, 'no test-build note in a release build', `gate notes still printing (${JSON.stringify([lic.gateNote, lic.bagNote])})`);
check(lic.pvBtn === 'UNLOCK WITH PRO' && /Pro APK/.test(lic.pvHint || ''), `a PRO stock offers purchase, not loading: "${lic.pvBtn}"`, `preview button wrong (${lic.pvBtn})`);
check(lic.afterUnlock?.film === lic.before?.film && lic.afterUnlock?.rollId === lic.before?.rollId, 'trying a PRO stock leaves the roll in the camera alone', `the roll changed (${JSON.stringify(lic)})`);
check(lic.afterCamTry?.cam === lic.before?.cam, 'trying a PRO body leaves the camera alone', `the body changed (${JSON.stringify(lic.afterCamTry)})`);

/* ── 5. develop-first path + backup integrity ───────────────────────────── */
const bk = JSON.parse(await evalIn(`(async () => { try {
  capture(); capture(); // an exposed roll must be resolved before switching stock
  tryLoadFilm(state.films.find(x => x.id === 'velvia50'));
  document.getElementById('swapDevelop').click();
  await new Promise(r => setTimeout(r, 9000));
  const afterDevSwap = { rolls: state.rolls.length, film: state.film.id, frames: state.frames.length, rollId: state.rollId, shotsLeft: state.shotsLeft };
  const good = { app: 'pocketroll', schemaVersion: 2, exported: new Date().toISOString(),
    counts: { rolls: 1, frames: 1, scans: 1 },
    rolls: [{ id: 'roll-imported-1', status: 'developed', cam: 'Test Body', film: 'Test Stock', iso: 400,
      loadedAt: 1, developedAt: 2, notes: 'imported roll', frames: [{ u: 'data:image/jpeg,x', t: 'data:image/jpeg,x', fav: false }] }],
    scans: [{ id: 'scan-imported-1', u: 'data:image/jpeg,x', t: 'data:image/jpeg,x', date: 5, cam: 'Test Body', film: 'Test Stock' }],
    inCamera: { id: 'roll-imported-cam', status: 'shooting', filmId: 'gold200', cameraId: 'trip35', shotsLeft: 34, loadedAt: 3, developed: false, frames: [{ u: 'data:image/jpeg,x', t: 'data:image/jpeg,x', fav: false }] } };
  await restoreFile(new File([JSON.stringify(good)], 'good.json', { type: 'application/json' }), { preview: true });
  const planShown = document.getElementById('restorePlan').style.display !== 'none';
  const planText = document.getElementById('restorePlanText').textContent;
  const beforeApply = state.rolls.length;
  await applyBackup(pendingBackup);
  const afterApply = { rolls: state.rolls.length, scans: state.scans.length, rollId: state.rollId, frames: state.frames.length, shotsLeft: state.shotsLeft };
  // a file with nothing usable must not touch what is already kept
  await restoreFile(new File([JSON.stringify({ app: 'pocketroll', schemaVersion: 2, rolls: [{ id: 'broken', frames: [{ nope: 1 }] }] })], 'bad.json', { type: 'application/json' }), { preview: true });
  const afterBad = { rolls: state.rolls.map(r => r.id), planShown2: document.getElementById('restorePlan').style.display !== 'none' };
  // duplicate ids merge instead of piling up
  await restoreFile(new File([JSON.stringify(good)], 'again.json', { type: 'application/json' }), { preview: true });
  await applyBackup(pendingBackup);
  const afterDupe = { rolls: state.rolls.length, ids: state.rolls.map(r => r.id) };
  // an unknown file is refused outright
  await restoreFile(new File([JSON.stringify({ hello: 'world' })], 'other.json', { type: 'application/json' }), { preview: true });
  const afterForeign = { rolls: state.rolls.map(r => r.id), planShown3: document.getElementById('restorePlan').style.display !== 'none' };
  return JSON.stringify({ afterDevSwap, planShown, planText, beforeApply, afterApply, afterBad, afterDupe, afterForeign });
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`));
phase('backup', bk);
check(bk.afterDevSwap?.rolls === 2 && bk.afterDevSwap?.film === 'velvia50' && bk.afterDevSwap?.frames === 0 && bk.afterDevSwap?.shotsLeft === 36, `develop-first: roll archived, then the new stock loads (${JSON.stringify(bk.afterDevSwap)})`, `develop-first wrong (${JSON.stringify(bk.afterDevSwap)})`);
check(bk.planShown && /will restore 1 roll/.test(bk.planText || '') && /1 frame/.test(bk.planText || '') && /latent frames go back into the camera/.test(bk.planText || ''), `restore preview: "${bk.planText}"`, 'no restore preview shown');
check(bk.beforeApply === 2 && bk.afterApply?.rolls === 3 && bk.afterApply?.scans >= 3, `confirmed restore merged 1 roll + 1 scan (${bk.afterApply?.rolls} rolls, ${bk.afterApply?.scans} scans)`, `merge wrong (${JSON.stringify(bk.afterApply)})`);
check(bk.afterApply?.rollId === 'roll-imported-cam' && bk.afterApply?.frames === 1 && bk.afterApply?.shotsLeft === 34, `undeveloped roll from a backup goes back into the camera (${bk.afterApply?.shotsLeft} left)`, `in-camera restore wrong (${JSON.stringify(bk.afterApply)})`);
check((bk.afterBad?.rolls || []).length === 3 && !bk.afterBad?.planShown2, 'a file with nothing usable leaves the archive intact', `bad file touched the archive (${JSON.stringify(bk.afterBad)})`);
check(bk.afterDupe?.rolls === 3 && new Set(bk.afterDupe?.ids || []).size === 3, 'duplicate ids merge, they do not pile up', `duplicates piled (${JSON.stringify(bk.afterDupe?.ids)})`);
check((bk.afterForeign?.rolls || []).length === 3 && !bk.afterForeign?.planShown3, 'a file that is not a pocketroll backup is refused', 'foreign file touched the archive');

/* ── 6. camera state is stated, sensor choice persists ─────────────────── */
const cam = JSON.parse(await evalIn(`(async () => { try {
  document.getElementById('optCamFlip').click();
  await new Promise(r => setTimeout(r, 900));
  const opts = JSON.parse(localStorage.getItem('pocketroll-opts-v1') || '{}');
  document.getElementById('optCamRetry').click();
  await new Promise(r => setTimeout(r, 1200));
  renderArchive();
  return JSON.stringify({ facing: state.opts.facing, savedFacing: opts.facing,
    state2: document.getElementById('camState').textContent,
    playsInline: !!video?.playsInline, muted: !!video?.muted,
    tracks: stream?.getTracks().length || 0,
    storageNote: document.getElementById('storageNote').textContent });
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`));
phase('camera', cam);
check(cam.facing === 'user' && cam.savedFacing === 'user', 'front-sensor choice is applied and remembered', `facing not persisted (${JSON.stringify(cam)})`);
check(/camera:/.test(cam.state2 || ''), `camera state stated: "${cam.state2}"`, 'no camera state line');
check(cam.playsInline && cam.muted, 'preview video is playsInline + muted', 'video missing playsInline/muted');
check(cam.tracks >= 1, `${cam.tracks} live sensor track(s) after a switch`, 'no stream tracks');
check(/rolls|frames|scans|unavailable/i.test(cam.storageNote || ''), `storage note: "${cam.storageNote}"`, 'storage note empty');

const fails = ok.filter(l => l.startsWith('FAIL'));
console.log(fails.length ? `${fails.length} FAILURES` : 'ALL GREEN');
ws.close(); proc.kill();
setTimeout(() => process.exit(fails.length ? 1 : 0), 300);
