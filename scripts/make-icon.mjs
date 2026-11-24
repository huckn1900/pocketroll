/* scripts/make-icon.mjs — render the app icon (the installed launcher icon in Chrome/Android).
   node scripts/make-icon.mjs        → icon.svg (source), icon.png (512×512 maskable-safe), icon-192.png

   Headless Chrome rasterises the mark (the brand face comes from the bundled
   roboto-condensed-700.woff2, the same face the wordmark uses), so there is no image
   library and nothing new to install. The geometry is written once, in svg(), and every
   output comes from it. */
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/* Two colours only. GROUND is the app's installed splash colour (manifest background_color
   and theme_color) so the launcher icon and the splash agree. MARK is the app's signature
   orange-red — the exact colour the header's 35 is printed in (--red #D94B37). */
const GROUND = '#141311';
const MARK = '#D94B37';

/* The brand's film can, drawn to the proportions of the original mark: a lid bar floating
   above, a wide top rim, a wide bottom rim, and only the LEFT edge of the body — the can is
   open on the right, where a short strip of film comes out. The strip's lower-right corner is
   carved inward with the ground colour, and the sprocket holes are cut-outs in the ground
   colour too, so the mark never uses a third colour. The 35 is the brand face stretched to
   fill the body, its cap line aligned with the top of the film strip.
   Everything stays inside x 77–435 / y 161–348, so the mark survives a circular crop and sits
   inside the maskable safe area (≥77px margin on every side of a 512 canvas). */
const CAN_X = 77, CAN_W = 264;
const CAP_X = 159, CAP_W = 120, CAP_Y = 161, CAP_H = 23;
const TOP_Y = 210, TOP_H = 22;
const BOT_Y = 326, BOT_H = 22;
const EDGE_X = 79, EDGE_W = 11;
const FLANK_X = 352, FLANK_W = 83, FLANK_Y = 244, FLANK_H = 76;
const HOLES = [360, 378, 396].map(x => `<rect x="${x}" y="249" width="14" height="12" rx="4" fill="${GROUND}"/>`).join('')
  + `<rect x="355" y="303" width="16" height="12" rx="4" fill="${GROUND}"/>`;
const TEXT_X = 225, TEXT_LEN = 182, TEXT_BASE = 315, TEXT_SIZE = 97;

function svg(size, { face = '' } = {}){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">`
    + (face ? `<defs><style>${face}</style></defs>` : '')
    + `<rect width="512" height="512" fill="${GROUND}"/>`
    + `<rect x="${CAP_X}" y="${CAP_Y}" width="${CAP_W}" height="${CAP_H}" rx="${CAP_H / 2}" fill="${MARK}"/>`
    + `<rect x="${CAN_X}" y="${TOP_Y}" width="${CAN_W}" height="${TOP_H}" rx="${TOP_H / 2}" fill="${MARK}"/>`
    + `<rect x="${EDGE_X}" y="${TOP_Y + TOP_H - 2}" width="${EDGE_W}" height="${BOT_Y - TOP_Y - TOP_H + 4}" fill="${MARK}"/>`
    + `<rect x="${CAN_X}" y="${BOT_Y}" width="${CAN_W}" height="${BOT_H}" rx="${BOT_H / 2}" fill="${MARK}"/>`
    + `<rect x="${FLANK_X}" y="${FLANK_Y}" width="${FLANK_W}" height="${FLANK_H}" rx="14" fill="${MARK}"/>`
    + `<rect x="${FLANK_X + 61}" y="${FLANK_Y + 47}" width="60" height="60" rx="14" fill="${GROUND}"/>`
    + HOLES
    + `<text x="${TEXT_X}" y="${TEXT_BASE}" text-anchor="middle" fill="${MARK}" textLength="${TEXT_LEN}" lengthAdjust="spacingAndGlyphs"`
    + ` style="font-family:'POCKETROLL Brand';font-size:${TEXT_SIZE}px;font-weight:700">35</text></svg>`;
}

const FACE = `@font-face{font-family:'POCKETROLL Brand';src:url("assets/fonts/roboto-condensed-700.woff2") format('woff2');font-weight:700}`;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outSvg = path.join(ROOT, 'icon.svg');
const page = path.join(ROOT, 'test', 'icon-render.html');
const targets = process.argv[2]
  ? [[process.argv[2], Number(process.argv[3] || 512)]]
  : [['icon.png', 512], ['icon-192.png', 192]];

function pageHtml(size){
  /* one page per size: the SVG is written at that size, so a 192 icon is the same mark
     rasterised at 192, never a crop of the 512 canvas */
  return `<!doctype html><meta charset="utf-8"><style>`
    + FACE.replace('assets/fonts/', '../assets/fonts/')
    + `html,body{margin:0;padding:0;background:${GROUND};overflow:hidden}svg{display:block}</style><body>` + svg(size);
}

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=${process.env.TEMP}\\chrome-icon-${port}-${Date.now().toString(36)}`,
  `--remote-debugging-port=${port}`], { stdio: 'ignore', detached: true });

async function waitPort() {
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); if (r.ok) return await r.json(); } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('no devtools');
}
const list = await waitPort();
const target = list.find(t => t.type === 'page') || list[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Runtime.enable');
writeFileSync(outSvg, svg(512, { face: FACE }));

for (const [out, size] of targets) {
  writeFileSync(page, pageHtml(size));
  await send('Page.navigate', { url: pathToFileURL(page).href });
  await new Promise(r => setTimeout(r, 800));
  /* the 35 only exists once the bundled face is loaded, so wait for it before rasterising */
  await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(()=>true)', awaitPromise: true, returnByValue: true });
  await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  await new Promise(r => setTimeout(r, 250));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.result.data, 'base64');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w !== size || h !== size) throw new Error(`${out} came out ${w}×${h}, expected ${size}×${size}`);
  writeFileSync(path.join(ROOT, out), buf);
  console.log(`${out} → ${w}×${h} · ${(buf.length / 1024).toFixed(1)} KB · mark ${MARK} on ${GROUND}`);
}
console.log(`icon.svg → ${(svg(512, { face: FACE }).length / 1024).toFixed(1)} KB source`);
unlinkSync(page);
ws.close(); proc.kill();
setTimeout(() => process.exit(0), 300);
