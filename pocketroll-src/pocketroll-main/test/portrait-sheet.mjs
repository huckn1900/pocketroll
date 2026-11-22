/* test/portrait-sheet.mjs — contact sheet must follow the film orientation:
   feed buildSheet synthetic PORTRAIT frames (a black circle dead-center), then
   measure the printed cell: the circle must stay round (aspect preserved),
   the sheet must be portrait, and the jpg is saved for visual inspection.
   Usage: node test/portrait-sheet.mjs <url> [out.jpg] */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const out = process.argv[3] || 'test/out-sheet-portrait.jpg';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=${process.env.TEMP}\\chrome-ps-${port}`,
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
    const src = document.createElement('canvas'); src.width = 720; src.height = 1280;
    const ic = src.getContext('2d');
    ic.fillStyle = '#e8e0cf'; ic.fillRect(0, 0, 720, 1280);
    ic.fillStyle = '#000'; ic.beginPath(); ic.arc(360, 640, 120, 0, 7); ic.fill();
    const u = src.toDataURL('image/jpeg', 0.92);
    state.frames = [{ url: u }, { url: u }, { url: u }];
    const sheet = await buildSheet(state.frames.map(f => f.url));
    if (!sheet) return 'NO SHEET';
    const s = new Image(); s.src = sheet; await s.decode();
    const sc = document.createElement('canvas'); sc.width = s.naturalWidth; sc.height = s.naturalHeight;
    const sctx = sc.getContext('2d'); sctx.drawImage(s, 0, 0);
    // cell 0 sits at (36, 56) as a 244x433 portrait cell — sample inside the black frame border
    const d = sctx.getImageData(44, 64, 228, 417).data;
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = 0; y < 417; y++) for (let x = 0; x < 228; x++) {
      const i = (y * 228 + x) * 4;
      if (d[i] < 60 && d[i+1] < 60 && d[i+2] < 60) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    const w = maxX - minX, h = maxY - minY;
    return JSON.stringify({ sheet: s.naturalWidth + 'x' + s.naturalHeight, circle: w + 'x' + h,
      round: Math.abs(w - h) <= 6, portraitSheet: s.naturalHeight > s.naturalWidth, b64: sheet.split(',')[1] });
  })()`,
  awaitPromise: true, returnByValue: true, timeout: 20000,
});
const val = (probe.result && probe.result.result && probe.result.result.value) ?? probe.result?.value;
if (!val || val === 'NO SHEET') { console.log('FAIL no sheet', val); process.exit(1); }
const j = JSON.parse(val);
console.log(`sheet ${j.sheet} portrait=${j.portraitSheet} circle ${j.circle} round=${j.round}`);
// portrait-cell layout: sheet width must equal the portrait formula 3*244+24+72 = 828
console.log(j.round && j.sheet.startsWith('828x') ? 'PASS portrait cells, aspect preserved' : 'FAIL aspect/layout');
writeFileSync(out, Buffer.from(j.b64, 'base64'));
console.log('sheet saved → ' + out);
ws.close(); proc.kill();
setTimeout(() => process.exit(0), 300);
