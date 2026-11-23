/* test/sound-smoke.mjs — verify sounds.js functions run without throwing in headless Chrome.
   Usage: node test/sound-smoke.mjs <url-of-sounds-html> */
import { spawn } from 'node:child_process';

const url = process.argv[2];
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=${process.env.TEMP}\\chrome-sm-${port}-${Date.now().toString(36)}`,
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
const val = (r) => (r.result && r.result.result && r.result.result.value) ?? r.result?.value;

await send('Page.enable');
await send('Page.navigate', { url });
await new Promise(r => setTimeout(r, 2500));
const probe = await send('Runtime.evaluate', {
  expression: `try {
    Sounds.advanceLever(); Sounds.advanceMotor(); Sounds.focusChirp(); Sounds.focusWhir();
    Sounds.combo('lever'); Sounds.combo('motor');
    'SMOKE OK — all 6 sound paths ran';
  } catch (e) { 'FAIL: ' + e.message; }`,
  returnByValue: true,
});
console.log(val(probe) ?? JSON.stringify(probe));
ws.close(); proc.kill();
setTimeout(() => process.exit(0), 300);
