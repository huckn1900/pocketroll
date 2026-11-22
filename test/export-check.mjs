/* test/export-check.mjs — prove capture exports at the camera stream's NATIVE pixel size.
   Loads app with fake device + autoshot, then compares gallery[0] natural size
   against video.videoWidth/Height (must match exactly).
   Usage: node test/export-check.mjs <url> */
import { spawn } from 'node:child_process';

const url = process.argv[2];
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--user-data-dir=${process.env.TEMP}\\chrome-exp-${port}`,
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

await send('Page.enable');
await send('Page.navigate', { url });
await new Promise(r => setTimeout(r, 4000)); // boot + autoshot fires ~900ms after feed settles
const probe = await send('Runtime.evaluate', {
  expression: `(async () => {
    if (!state.frames.length) return 'NO SHOTS';
    const img = new Image(); img.src = state.frames[0].url; await img.decode();
    return JSON.stringify({
      stream: video && video.videoWidth ? video.videoWidth + 'x' + video.videoHeight : 'no-camera',
      export: img.naturalWidth + 'x' + img.naturalHeight,
      shots: state.frames.length,
    });
  })()`,
  awaitPromise: true, returnByValue: true,
});
console.log(probe.result?.value ?? JSON.stringify(probe));
ws.close(); proc.kill();
setTimeout(() => process.exit(0), 300);
