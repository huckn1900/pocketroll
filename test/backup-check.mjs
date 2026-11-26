/* test/backup-check.mjs — the backup/restore guarantees the review asked for:
   1) a user holding only an undeveloped roll can export it and get it back into the camera;
   2) a crafted backup file cannot inject HTML into the archive (image URLs are validated,
      pictures are built as elements, never interpolated into markup);
   3) a failed restore leaves nothing half-written: no partial IDB records, and the camera and
      its latent frames stay untouched.
   Usage: node test/backup-check.mjs <base-url> */
import { spawn } from 'node:child_process';
import { chromeBin, tmpProfile } from './browser.mjs';

const base = process.argv[2];
const chrome = chromeBin(); // DSH_CHROME overrides the browser executable — see test/browser.mjs
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--user-data-dir=${tmpProfile('bk', port)}`,
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

await send('Page.enable');
// a short roll that is never developed: this is the state the old export refused to write
await send('Page.navigate', { url: `${base}/index.html?cam=trip35&film=gold200&autoshot=1&shots=4&page=gallery` });
await new Promise(r => setTimeout(r, 9000));

// 1) export with only the roll in the camera, then take it back into an empty chamber
const one = JSON.parse(await evalIn(`(async () => { try {
  if (!state.frames.length) return JSON.stringify({ error: 'NO LATENT FRAMES' });
  const payload = backupPayload();
  if (!payload) return JSON.stringify({ error: 'EXPORT REFUSED with only a live roll' });
  const print = state.frames[0].url;
  payload.scans = [{ id: 'scan-proof', u: print, t: state.frames[0].t || print, date: Date.now(),
    cam: 'Olympus Trip 35', film: 'Kodak Gold 200', iso: 200 }];
  const json = JSON.stringify(payload);
  const before = { rolls: (await idbGetAll(DB_STORE)).map(r => r.id), scans: (await idbGetAll(SCAN_STORE)).map(s => s.id) };
  // empty the chamber the way a spool leaves a camera, then restore the file
  await dropCurrentRoll();
  state.frames = []; state.developed = false; renderCounter(); renderStrip(); renderArchive();
  await restoreFile(new File([json], 'latent.json', { type: 'application/json' }));
  const storedRolls = await idbGetAll(DB_STORE), storedScans = await idbGetAll(SCAN_STORE);
  return JSON.stringify({
    exportedRolls: payload.counts.rolls, exportedLatent: payload.counts.latent,
    restoredFrames: state.frames.length, restoredId: state.rollId, wantId: payload.inCamera.id,
    shotsLeft: state.shotsLeft, capacity: rollCapacity(),
    storedShooting: storedRolls.filter(r => r.status === 'shooting').length,
    storedScans: storedScans.length, beforeRolls: before.rolls.length,
    imgOk: document.querySelectorAll('#archive img').length,
    inCameraCard: !!document.querySelector('.roll-card.incamera'),
  });
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`));
console.log('latent export/restore:', JSON.stringify(one));

// 2) a crafted backup file must not inject HTML into the archive
const craftedRaw = await evalIn(`(async () => { try {
  const print = state.frames.length ? (state.frames[0].url || state.frames[0].u) : (state.rolls[0]?.frames[0]?.u);
  if (!print) return JSON.stringify({ error: 'NO PRINT TO CRAFT WITH' });
  const bad = '"><b id=injected>x</b>';
  const file = { app: 'pocketroll', schemaVersion: 2, version: 1, exported: new Date().toISOString(),
    counts: { rolls: 2, frames: 2, scans: 1 },
    rolls: [
      { id: 'roll-crafted', status: 'developed', developed: true, cam: bad, film: bad, iso: 200,
        format: '35mm (135)', loadedAt: Date.now() - 2000, developedAt: Date.now() - 1000,
        notes: '<script>window.__injectedScript = 1</script>', frames: [{ u: bad, t: bad }] },
      { id: 'roll-good', status: 'developed', developed: true, cam: 'Olympus Trip 35', film: 'Kodak Gold 200',
        iso: 200, format: '35mm (135)', loadedAt: Date.now() - 3000, developedAt: Date.now() - 2000,
        notes: 'Weekend in Toronto', frames: [{ u: print, t: print }] }],
    scans: [{ id: 'scan-crafted', u: bad, date: Date.now(), cam: bad, film: bad }] };
  const rollsBefore = state.rolls.map(r => r.id);
  await restoreFile(new File([JSON.stringify(file)], 'crafted.json', { type: 'application/json' }));
  const cards = document.querySelectorAll('#archive .roll-card');
  const imgs = document.querySelectorAll('#archive img');
  return JSON.stringify({
    kept: state.rolls.map(r => r.id), rollsBefore: rollsBefore.length,
    injectedElement: !!document.getElementById('injected'),
    injectedScript: window.__injectedScript === 1,
    imgCount: imgs.length,
    badSrcs: Array.from(imgs).filter(i => !i.src.startsWith('data:image/')).map(i => i.src).slice(0, 3),
    cardCount: cards.length, cardTextHasRawTag: /<b id=injected/.test(document.getElementById('archive').textContent),
    craftedScanKept: state.scans.some(s => s.id === 'scan-crafted'), scansTotal: state.scans.length,
  });
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`);
console.log('crafted backup:', craftedRaw);
const crafted = JSON.parse(craftedRaw ?? '{"error":"no value returned"}');

// 3) a failed write must leave the store and the camera exactly as they were
const failed = JSON.parse(await evalIn(`(async () => { try {
  const orig = idbApply;
  const snapshot = { rolls: state.rolls.map(r => r.id), scans: state.scans.map(s => s.id),
    frames: state.frames.length, rollId: state.rollId, shotsLeft: state.shotsLeft,
    storedRolls: (await idbGetAll(DB_STORE)).map(r => r.id), storedScans: (await idbGetAll(SCAN_STORE)).map(s => s.id) };
  idbApply = () => Promise.reject(new Error('quota exceeded'));
  const p = (state.frames[0]?.url || state.frames[0]?.u) || (state.rolls[0]?.frames[0]?.u);
  if (!p) { idbApply = orig; return JSON.stringify({ error: 'NO PRINT TO CRAFT WITH' }); }
  const file = { app: 'pocketroll', schemaVersion: 2, version: 1, exported: new Date().toISOString(),
    counts: { rolls: 1, frames: 1, scans: 1 },
    rolls: [{ id: 'roll-never-lands', status: 'developed', developed: true, cam: 'Olympus Trip 35',
      film: 'Kodak Gold 200', iso: 200, format: '35mm (135)', loadedAt: Date.now() - 4000,
      developedAt: Date.now() - 3000, notes: '', frames: [{ u: p, t: p }] }],
    scans: [{ id: 'scan-never-lands', u: p, date: Date.now(), cam: 'x', film: 'x' }],
    inCamera: { id: 'roll-latent-never-lands', status: 'shooting', developed: false, camId: 'trip35',
      cam: 'Olympus Trip 35', filmId: 'gold200', film: 'Kodak Gold 200', iso: 200, shotsLeft: 32,
      capacity: 36, format: '35mm (135)', loadedAt: Date.now(), frames: [{ u: p, t: p }] } };
  await restoreFile(new File([JSON.stringify(file)], 'fails.json', { type: 'application/json' }));
  idbApply = orig;
  const after = { rolls: state.rolls.map(r => r.id), scans: state.scans.map(s => s.id),
    frames: state.frames.length, rollId: state.rollId, shotsLeft: state.shotsLeft,
    storedRolls: (await idbGetAll(DB_STORE)).map(r => r.id), storedScans: (await idbGetAll(SCAN_STORE)).map(s => s.id) };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return JSON.stringify({
    storeUnchanged: same(snapshot.storedRolls, after.storedRolls) && same(snapshot.storedScans, after.storedScans),
    shelfUnchanged: same(snapshot.rolls, after.rolls) && same(snapshot.scans, after.scans),
    cameraUnchanged: snapshot.frames === after.frames && snapshot.rollId === after.rollId && snapshot.shotsLeft === after.shotsLeft,
    framesBefore: snapshot.frames, framesAfter: after.frames,
    partialRoll: after.storedRolls.includes('roll-never-lands'), partialScan: after.storedScans.includes('scan-never-lands'),
    partialLatent: after.storedRolls.includes('roll-latent-never-lands'),
    latentFramesLost: after.frames === 0,
  });
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`));
console.log('failed restore:', JSON.stringify(failed));

const ok = [];
if (one.error || crafted.error || failed.error) ok.push('FAIL ' + (one.error || crafted.error || failed.error));
else {
  ok.push(one.exportedLatent === 4 && one.exportedRolls === 0 ? `PASS export with only an undeveloped roll (${one.exportedLatent} latent frames)` : `FAIL export refused (${one.exportedLatent}/${one.exportedRolls})`);
  ok.push(one.restoredFrames === 4 && one.restoredId === one.wantId ? `PASS latent frames back into the camera (${one.restoredFrames} frames, ${one.restoredId})` : `FAIL camera restore (${one.restoredFrames} frames, id ${one.restoredId})`);
  ok.push(one.storedShooting >= 1 && one.storedScans >= 1 ? `PASS one transaction wrote both shelves (${one.storedShooting} roll record, ${one.storedScans} scan)` : `FAIL store after restore (${one.storedShooting}/${one.storedScans})`);
  ok.push(one.inCameraCard && one.imgOk >= 1 ? `PASS the roll in the camera shows on the shelf (${one.imgOk} prints)` : `FAIL in-camera record (${one.inCameraCard}, ${one.imgOk})`);
  ok.push(crafted.kept.length === 1 && crafted.kept[0] === 'roll-good' ? 'PASS incomplete crafted roll skipped, good record kept' : `FAIL crafted records (${JSON.stringify(crafted.kept)})`);
  ok.push(!crafted.injectedElement && !crafted.injectedScript ? 'PASS crafted backup injected no HTML' : `FAIL crafted backup injected markup (${crafted.injectedElement}/${crafted.injectedScript})`);
  ok.push(crafted.imgCount > 0 && crafted.badSrcs.length === 0 ? `PASS prints are built as elements (${crafted.imgCount} img, every src validated)` : `FAIL img rendering (${crafted.imgCount}, bad srcs ${JSON.stringify(crafted.badSrcs)})`);
  ok.push(!crafted.craftedScanKept ? `PASS crafted scan with an unusable image was not kept (${crafted.scansTotal} scans still on the shelf are the real ones)` : `FAIL crafted scan kept`);
  ok.push(!crafted.cardTextHasRawTag ? 'PASS no raw tag text left in the record' : `FAIL raw tag in card text`);
  ok.push(failed.storeUnchanged && !failed.partialRoll && !failed.partialScan && !failed.partialLatent ? 'PASS failed restore wrote nothing (no partial records)' : `FAIL partial records after failure (${JSON.stringify(failed)})`);
  ok.push(failed.shelfUnchanged ? 'PASS the shelf the user already had is unchanged' : 'FAIL shelf changed on failure');
  ok.push(failed.cameraUnchanged && !failed.latentFramesLost ? `PASS camera untouched on failure (${failed.framesBefore} latent frames still in the chamber)` : `FAIL camera changed on failure (${JSON.stringify(failed)})`);
}
console.log(ok.join('\n'));
ws.close(); proc.kill();
setTimeout(() => process.exit(0), 300);
