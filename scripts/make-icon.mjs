/* scripts/make-icon.mjs — render the app icon (the installed launcher icon in Chrome/Android).
   node scripts/make-icon.mjs        → icon.svg (source), icon.png (512×512 maskable-safe), icon-192.png

   Headless Chrome rasterises the mark (solid shapes only — no type, so no font dependency),
   so there is no image library and nothing new to install. The geometry is written once, in
   svg(), and every output comes from it. */
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/* Two colours only. GROUND is the app's installed splash colour (manifest background_color
   and theme_color) so the launcher icon and the splash agree. MARK is the app's signature
   orange-red — the exact colour the header's 35 is printed in (--red #D94B37). */
const GROUND = '#141311';
const MARK = '#D94B37';

/* The mark, redrawn for the launcher (Round ㉝): a solid film can, readable at 40px.
   Three shapes carry the whole idea — a lid bar that overhangs the body (that overhang is what
   says "can"), a filled body, and one strip of film coming out beside the lid, perforated down
   its length in the ground colour. No outline strokes, no text, no third colour, and nothing
   thin: at 40px anything fine turns to mush, so every element is a solid block. A 35mm can is
   wider than it is tall, so the body is deliberately squat (212×186).
   Content stays inside x 70–406 / y 132–364: clear of the maskable safe area (41–471) and of a
   circular crop (worst corner is 223px from the centre of a 256 radius). */
const LID_X = 70, LID_W = 232, LID_Y = 132, LID_H = 32;   // overhangs the body by 10px each side
const CAN_X = 80, CAN_W = 212, BODY_Y = 176, BODY_H = 186;
const STRIP_X = 306, STRIP_W = 100, STRIP_Y = 132, STRIP_H = 232;  // starts at the lid's right end
const HOLE_W = 24, HOLE_H = 16;
const HOLE_X = STRIP_X + (STRIP_W - HOLE_W) / 2;                  // one legible column, centred
const HOLE_ROWS = [152, 200, 248, 296];                           // ≥10px inset from the strip ends
const HOLES = HOLE_ROWS.map(y => `<rect x="${HOLE_X}" y="${y}" width="${HOLE_W}" height="${HOLE_H}" rx="6" fill="${GROUND}"/>`).join('');

function svg(size, { face = '' } = {}){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">`
    + (face ? `<defs><style>${face}</style></defs>` : '')
    + `<rect width="512" height="512" fill="${GROUND}"/>`
    + `<rect x="${LID_X}" y="${LID_Y}" width="${LID_W}" height="${LID_H}" rx="${LID_H / 2}" fill="${MARK}"/>`
    + `<rect x="${CAN_X}" y="${BODY_Y}" width="${CAN_W}" height="${BODY_H}" rx="18" fill="${MARK}"/>`
    + `<rect x="${STRIP_X}" y="${STRIP_Y}" width="${STRIP_W}" height="${STRIP_H}" rx="14" fill="${MARK}"/>`
    + HOLES + `</svg>`;
}

/* No type in the mark anymore, so nothing here depends on the bundled brand face. */
const FACE = '';
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
  /* nothing in the mark depends on a font, but settle the page before rasterising anyway */
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
