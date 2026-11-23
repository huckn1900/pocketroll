/* test/archive-check.mjs — darkroom archive v2 (IndexedDB) behaviour on a live page:
   1) after develop, the roll record carries full metadata (cam/film/iso/dates/status);
   2) Roll Notes persist across a page reload (IndexedDB, not session state);
   3) favorites toggle persists; backup JSON round-trips through restoreFile().
   Usage: node test/archive-check.mjs <base-url> */
import { spawn } from 'node:child_process';

const base = process.argv[2];
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--user-data-dir=${process.env.TEMP}\\chrome-ac-${port}`,
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

// 1) shoot a short roll, develop it, inspect the archive record
await send('Page.navigate', { url: `${base}/index.html?cam=trip35&autoshot=1&shots=3&dev=1` });
await new Promise(r => setTimeout(r, 11500)); // autoshots @900ms, dev @2600ms, develop ~7s + archive
const rec = JSON.parse(await evalIn(`(async () => { try {
  if (!state.rolls.length) return JSON.stringify({ error: 'NO ROLL ARCHIVED' });
  const r = state.rolls[0];
  r.notes = 'Weekend in Toronto — Autumn 2026';
  await updateRoll(r);
  r.frames[0].fav = true;
  await updateRoll(r);
  const backup = JSON.stringify({ app: 'pocketroll', version: 1, exported: new Date().toISOString(), rolls: state.rolls });
  return JSON.stringify({
    id: r.id, cam: r.cam, film: r.film, iso: r.iso, status: r.status,
    loadedAt: r.loadedAt, developedAt: r.developedAt,
    frames: r.frames.length, frameKeys: Object.keys(r.frames[0]).sort().join(','),
    notesSaved: (await loadArchives(), state.rolls[0].notes),
    favSaved: state.rolls[0].frames[0].fav,
    backupLen: backup.length,
  });
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`));
console.log('record:', JSON.stringify(rec));

// 2) full reload: notes + favorite must come back from IndexedDB
await send('Page.navigate', { url: `${base}/index.html` });
await new Promise(r => setTimeout(r, 3500));
const after = JSON.parse(await evalIn(`(async () => { try {
  await loadArchives();
  if (!state.rolls.length) return JSON.stringify({ error: 'LOST AFTER RELOAD' });
  const r = state.rolls.find(x => x.id === ${JSON.stringify(rec.id)});
  if (!r) return JSON.stringify({ error: 'ROLL id missing after reload' });
  // restore round-trip through the real restoreFile path
  const backup = JSON.stringify({ app: 'pocketroll', version: 1, exported: new Date().toISOString(), rolls: [r] });
  await restoreFile(new File([backup], 'bk.json', { type: 'application/json' }));
  const r2 = state.rolls.find(x => x.id === r.id);
  return JSON.stringify({ notes: r.notes, fav: r.frames[0].fav, frames: r.frames.length,
    restoredCount: state.rolls.length, restoredNotes: r2.notes });
} catch (e) { return JSON.stringify({ error: String(e) }); } })()`));
console.log('after reload:', JSON.stringify(after));

const ok = [];
if (rec.error || after.error) ok.push('FAIL ' + (rec.error || after.error));
else {
  ok.push(/Olympus Trip 35/.test(rec.cam) ? `PASS record camera: ${rec.cam}` : `FAIL camera field (${rec.cam})`);
  ok.push(/Gold/i.test(rec.film) && rec.iso === 200 ? `PASS record film+iso: ${rec.film} ISO ${rec.iso}` : `FAIL film (${rec.film}, iso ${rec.iso})`);
  ok.push(rec.status === 'developed' && rec.loadedAt <= rec.developedAt ? `PASS dates/status: loaded ${rec.loadedAt} <= developed ${rec.developedAt}` : 'FAIL dates/status');
  ok.push(rec.frameKeys === 'fav,t,u' ? `PASS frame schema ${rec.frameKeys}` : `FAIL frame schema (${rec.frameKeys})`);
  ok.push(rec.notesSaved === 'Weekend in Toronto — Autumn 2026' && after.notes === rec.notesSaved ? 'PASS roll notes persist across reload' : `FAIL notes (${rec.notesSaved} / ${after.notes})`);
  ok.push(rec.favSaved === true && after.fav === true ? 'PASS favorite persists across reload' : `FAIL fav (${rec.favSaved} / ${after.fav})`);
  ok.push(after.restoredCount === 1 && after.restoredNotes === rec.notesSaved ? `PASS backup restore round-trip (${after.restoredCount} roll)` : `FAIL restore (${after.restoredCount})`);
}
console.log(ok.join('\n'));
ws.close(); proc.kill();
setTimeout(() => process.exit(0), 300);
