/* test/mobile-check.mjs — render a URL at a real mobile viewport via Chrome DevTools Protocol.
   Usage: node test/mobile-check.mjs <url> <outPng> [width=390] [height=844]
   Optional: DSH_CLIP="x,y,w,h,scale" — capture one region zoomed (inspecting a control's
   mark, a ring, a corner badge, without shrinking the whole page into the image).
   Why: headless --window-size floors viewport at ~500px, so phone-width layouts
   cannot be verified with plain screenshots; CDP device emulation is the reliable way. */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const out = process.argv[3] || 'shot-mobile.png';
const width = Number(process.argv[4] || 390);
const height = Number(process.argv[5] || 844);
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333 + Math.floor(Math.random() * 60);

const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  ...(process.env.EXTRA_FLAGS ? process.env.EXTRA_FLAGS.split(' ') : []),
  `--user-data-dir=${process.env.TEMP}\\chrome-cdp-${port}-${Date.now().toString(36)}`,
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

let id = 0;
const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url });
await new Promise(r => setTimeout(r, parseInt(process.env.WAIT_MS || '2500'))); // boot + asset fetch + a few rAF frames
const shotParams = { format: 'png' };
if (process.env.DSH_CLIP) {
  const [x, y, w, h, scale] = process.env.DSH_CLIP.split(',').map(Number);
  shotParams.clip = { x, y, width: w, height: h, scale: scale || 2 };
}
const shot = await send('Page.captureScreenshot', shotParams);
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log(`mobile ${width}x${height} → ${out}`);
ws.close(); proc.kill();
setTimeout(() => process.exit(0), 300);
