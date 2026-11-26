/* test/cans-check.mjs — render every film canister at readable scale and assert two things:
    1) the printed label never overflows its band,
    2) every stock is the SAME print — the shelf standardises the canister geometry, so only
       the type inside the band adapts to a long film name, never the can's dimensions.
    Usage: node test/cans-check.mjs <url> [out.png]
    Why: the shelf draws one standardised 48×72 print per stock (cap, body, band, ISO baseline
    and bottom gap are fixed coordinates). This builds a zoomed contact sheet of all stocks,
    measures each <text> run against the band, and compares every can's geometry against the
    first can plus every ISO baseline against the first one. */
import { spawn } from 'node:child_process';
import { chromeBin, tmpProfile } from './browser.mjs';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const out = process.argv[3] || 'test/out-cans.png';
const chrome = chromeBin(); // DSH_CHROME overrides the browser executable — see test/browser.mjs
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--user-data-dir=${tmpProfile('cans', port)}`,
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
  const SCALE = 2.5; // the print is 48x72; measured at 120x180 so glyph runs are readable
  state.films.forEach(f => {
    const cell = document.createElement('div');
    cell.style.cssText = 'background:#24211D;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px';
    const holder = document.createElement('div');
    holder.innerHTML = canSvg(f);
    const svg = holder.querySelector('svg');
    svg.style.transform = 'scale(' + SCALE + ')';
    svg.style.transformOrigin = 'top left';
    holder.style.width = (48 * SCALE) + 'px'; holder.style.height = (72 * SCALE) + 'px';
    const name = document.createElement('div');
    name.style.cssText = "font-family:'PC Mono',monospace;font-size:10px;color:#cfc5b4;letter-spacing:.08em";
    name.textContent = f.id;
    cell.appendChild(holder); cell.appendChild(name);
    grid.appendChild(cell);
  });
  document.body.appendChild(grid);
  const cans = [...document.querySelectorAll('.cansvg')];
  const shapeOf = (svg) => [...svg.querySelectorAll('rect')].map(r =>
    [r.getAttribute('x'), r.getAttribute('y'), r.getAttribute('width'), r.getAttribute('height')].join(':')).join('|');
  const shape = shapeOf(cans[0]);
  const isoYOf = (svg) => [...svg.querySelectorAll('text')].map(t => t.getAttribute('y')).sort().pop();
  const isoY = isoYOf(cans[0]);
  const overflow = [], ragged = [], offBaseline = [];
  cans.forEach(svg => {
    const band = svg.querySelectorAll('rect')[2];
    const bandW = Number(band.getAttribute('width'));
    svg.querySelectorAll('text').forEach(t => {
      const b = t.getBBox();
      const half = b.width / 2, cx = Number(t.getAttribute('x'));
      if (cx - half < Number(band.getAttribute('x')) - 0.5 || cx + half > Number(band.getAttribute('x')) + bandW + 0.5) {
        overflow.push(svg.getAttribute('viewBox') + ' ' + t.textContent + ' w=' + b.width.toFixed(1));
      }
    });
    if (shapeOf(svg) !== shape) ragged.push(svg.getAttribute('viewBox'));
    if (isoYOf(svg) !== isoY) offBaseline.push(svg.getAttribute('viewBox'));
  });
  return JSON.stringify({ cans: cans.length, print: cans[0].getAttribute('viewBox'),
    isoBaseline: isoY, overflow, ragged, offBaseline });
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
