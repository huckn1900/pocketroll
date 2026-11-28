/* scripts/make-cover.mjs — renders the Payhip product cover (1000x1250) from payhip/_cover-src.html
   in headless Chrome. Fonts are waited on before the screenshot.
   usage: node scripts/make-cover.mjs [--out payhip/PocketRoll35-cover.png] */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromeBin, tmpProfile } from '../test/browser.mjs';

const argv = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) { argv[process.argv[i].slice(2)] = process.argv[i + 1]; i++; }
}
const out = argv.out || 'payhip/PocketRoll35-cover.png';
const src = new URL('../payhip/_cover-src.html', import.meta.url).href;

const port = 9533 + Math.floor(Math.random() * 60);
const proc = spawn(chromeBin(), ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=${tmpProfile('cover', port)}`, `--remote-debugging-port=${port}`],
  { stdio: 'ignore', detached: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitPort() {
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); if (r.ok) return await r.json(); } catch {}
    await sleep(400);
  }
  throw new Error('no devtools');
}
const list = await waitPort();
const target = list.find((t) => t.type === 'page') || list[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1250, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: src });
await sleep(1500);
await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true });
await sleep(400);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
ws.close(); proc.kill();
console.log('cover → ' + out);
