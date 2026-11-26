/* test/pwa-check.mjs — verify the deployed PWA is installable-ready:
   service worker registers & activates, manifest parses, offline controller exists.
   Usage: node test/pwa-check.mjs <url> */
import { spawn } from 'node:child_process';
import { chromeBin, tmpProfile } from './browser.mjs';

const url = process.argv[2];
const chrome = chromeBin(); // DSH_CHROME overrides the browser executable — see test/browser.mjs
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=${tmpProfile('pwa', port)}`,
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
await new Promise(r => setTimeout(r, 2500));
const probe = await send('Runtime.evaluate', {
  expression: `(async () => {
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    const mf = await fetch('manifest.webmanifest').then(r => r.json()).catch(() => null);
    return JSON.stringify({
      sw_state: reg ? reg.active?.state : 'none',
      sw_scope: reg?.scope || null,
      manifest_ok: !!mf && !!mf.name && !!mf.start_url && !!mf.icons?.length,
      icon_sizes: mf?.icons?.map(i => i.sizes).join(',') || null,
      offline_controller: !!navigator.serviceWorker.controller,
    });
  })()`,
  awaitPromise: true, returnByValue: true,
});
console.log(probe.result?.value ?? JSON.stringify(probe));
ws.close(); proc.kill();
setTimeout(() => process.exit(0), 300);
