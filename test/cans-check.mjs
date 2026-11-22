/* test/cans-check.mjs — render every film canister at readable scale and assert the
   printed label never overflows its band.
   Usage: node test/cans-check.mjs <url> [out.png]
   Why: the shelf cans are ~30px, too small to eyeball for clipped glyphs; this builds
   a zoomed contact sheet of all stocks and measures each <text> run against the band. */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const out = process.argv[3] || 'test/out-cans.png';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--user-data-dir=${process.env.TEMP}\\chrome-cans-${port}`,
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
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) pend.get(m.id)(m); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

const build = `(async () => {
  document.body.innerHTML = '';
  document.body.style.background = '#D8C9A9';
  document.body.style.padding = '16px';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:14px';
  state.films.forEach(f => {
    const cell = document.createElement('div');
    cell.style.cssText = 'background:#24211D;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px';
    const holder = document.createElement('div');
    holder.innerHTML = canSvg(f);
    holder.querySelector('svg').style.transform = 'scale(3)';
    holder.querySelector('svg').style.transformOrigin = 'top left';
    holder.style.width = '90px'; holder.style.height = '108px';
    const name = document.createElement('div');
    name.style.cssText = "font-family:'PC Mono',monospace;font-size:10px;color:#cfc5b4;letter-spacing:.08em";
    name.textContent = f.id;
    cell.appendChild(holder); cell.appendChild(name);
    grid.appendChild(cell);
  });
  document.body.appendChild(grid);
  // measure: every printed run must stay inside the 20-unit-wide band
  const bad = [];
  document.querySelectorAll('.cansvg').forEach(svg => {
    const band = svg.querySelectorAll('rect')[2];
    const bandW = Number(band.getAttribute('width'));
    svg.querySelectorAll('text').forEach(t => {
      const b = t.getBBox();
      const half = b.width / 2, cx = Number(t.getAttribute('x'));
      if (cx - half < Number(band.getAttribute('x')) - 0.5 || cx + half > Number(band.getAttribute('x')) + bandW + 0.5) {
        bad.push(svg.getAttribute('viewBox') + ' ' + t.textContent + ' w=' + b.width.toFixed(1));
      }
    });
  });
  return JSON.stringify({ cans: document.querySelectorAll('.cansvg').length, overflow: bad });
})()`;

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url });
await new Promise(r => setTimeout(r, 3000)); // boot + assets fetch
const probe = await send('Runtime.evaluate', { expression: build, awaitPromise: true, returnByValue: true, timeout: 20000 });
const val = (probe.result && probe.result.result && probe.result.result.value) ?? probe.result?.value;
console.log(val ?? JSON.stringify(probe));
await new Promise(r => setTimeout(r, 400));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('can sheet → ' + out);
ws.close(); proc.kill();
setTimeout(() => process.exit(0), 300);
