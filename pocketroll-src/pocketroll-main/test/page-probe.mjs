/* test/page-probe.mjs — CDP eval probe for debugging: node test/page-probe.mjs <url> <expression> */
import { spawn } from 'node:child_process';
const url = process.argv[2], expr = process.argv[3];
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=${process.env.TEMP}\\chrome-probe-${port}`, `--remote-debugging-port=${port}`,
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], { stdio: 'ignore', detached: true });
async function waitPort() {
  for (let i = 0; i < 20; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); if (r.ok) return await r.json(); } catch {} await new Promise(r => setTimeout(r, 400)); }
  throw new Error('no devtools');
}
const list = await waitPort();
const target = list.find(t => t.type === 'page') || list[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const exceptions = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await new Promise(r => setTimeout(r, Number(process.env.WAIT_MS || 2500)));
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
console.log(JSON.stringify((r.result && r.result.result) ?? r.result));
if (exceptions.length) console.log('EXCEPTIONS: ' + exceptions.join(' | '));
ws.close(); proc.kill();
setTimeout(() => process.exit(0), 300);
