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

/* The brand's film can, measured off the reference mark and scaled onto the 512 canvas: a lid
   bar floating above (wider than it was, sitting left of the body's centre), a wide top rim, a
   wide bottom rim, and only the LEFT edge of the body — the can is open on the right, where a
   strip of film comes out that runs down to the bottom rim. Three sprocket holes punch the top
   of that strip and one punches its lower-left corner; its lower-right corner is carved inward
   with the ground colour, so the mark never uses a third colour. The 35 is the brand face set
   at the reference's own size — it fills the body's middle, not every inch of it.
   Everything stays inside x 77–435 / y 171–342, so the mark survives a circular crop (worst
   corner is 198px from the centre) and sits inside the maskable safe area (41–471). */
const CAN_X = 77, CAN_W = 251;
const CAP_X = 107, CAP_W = 143, CAP_Y = 171, CAP_H = 27;
const TOP_Y = 208, TOP_H = 20;
const BOT_Y = 322, BOT_H = 20;
const EDGE_X = 77, EDGE_W = 12;
const FLANK_X = 340, FLANK_W = 95, FLANK_Y = 224, FLANK_H = 98;
const HOLE_W = 18, HOLE_H = 19, HOLE_RX = 5, HOLE_TOP_Y = 231;
const HOLES = [354, 377, 399].map(x => `<rect x="${x}" y="${HOLE_TOP_Y}" width="${HOLE_W}" height="${HOLE_H}" rx="${HOLE_RX}" fill="${GROUND}"/>`).join('')
  + `<rect x="352" y="294" width="${HOLE_W}" height="${HOLE_H}" rx="${HOLE_RX}" fill="${GROUND}"/>`;
/* the carved corner: a ground-coloured block over the strip's lower right, rounded so the cut
   reads as a curve rather than a bite */
const CARVE_X = 398, CARVE_Y = 272, CARVE_W = 44, CARVE_H = 60, CARVE_RX = 16;
const TEXT_X = 168, TEXT_LEN = 134, TEXT_BASE = 291, TEXT_SIZE = 78;

function svg(size, { face = '' } = {}){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">`
    + (face ? `<defs><style>${face}</style></defs>` : '')
    + `<rect width="512" height="512" fill="${GROUND}"/>`
    + `<rect x="${CAP_X}" y="${CAP_Y}" width="${CAP_W}" height="${CAP_H}" rx="${CAP_H / 2}" fill="${MARK}"/>`
    + `<rect x="${CAN_X}" y="${TOP_Y}" width="${CAN_W}" height="${TOP_H}" rx="${TOP_H / 2}" fill="${MARK}"/>`
    + `<rect x="${EDGE_X}" y="${TOP_Y + TOP_H - 2}" width="${EDGE_W}" height="${BOT_Y - TOP_Y - TOP_H + 4}" fill="${MARK}"/>`
    + `<rect x="${CAN_X}" y="${BOT_Y}" width="${CAN_W}" height="${BOT_H}" rx="${BOT_H / 2}" fill="${MARK}"/>`
    + `<rect x="${FLANK_X}" y="${FLANK_Y}" width="${FLANK_W}" height="${FLANK_H}" rx="14" fill="${MARK}"/>`
    + `<rect x="${CARVE_X}" y="${CARVE_Y}" width="${CARVE_W}" height="${CARVE_H}" rx="${CARVE_RX}" fill="${GROUND}"/>`
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
