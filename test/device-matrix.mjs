/* test/device-matrix.mjs — run the live page across mainstream phone viewports (iPhone / Android /
   foldables / iPad) and report the layout invariants, once per device in a single Chrome instance.

   node test/device-matrix.mjs [baseUrl]      default: the deployed page.
   DSH_MATRIX_EXPR_FILE=<file> overrides the probe expression (default test/probe-device-fit.txt).

   Each device is measured twice in spirit: the panel size, and the same size minus the browser's
   own toolbars — because the height a page actually gets on a phone is smaller than the screen,
   and that is where a camera layout breaks. iOS Safari's bars cost ~110px, Chrome Android's ~90px.
   Safe-area insets are emulated (iPhone home indicator 48px / notch 32px) so the reserved padding
   can be verified, not assumed. */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.argv[2] || 'https://huckn1900.github.io/pocketroll/index.html';
const exprFile = process.env.DSH_MATRIX_EXPR_FILE || 'test/probe-device-fit.txt';
const expr = readFileSync(exprFile, 'utf8');
const waitMs = Number(process.env.WAIT_MS || 5000);

/* viewport sizes from Panescope's 2026 device library (CSS px, portrait) — https://panescope.com/blog/viewport-sizes/ */
const DEVICES = [
  { name: 'iPhone SE (3rd gen)', w: 375, h: 667, dpr: 2, ios: true },
  { name: 'iPhone SE 3 · Safari bars', w: 375, h: 557, dpr: 2, ios: true },
  { name: 'iPhone 13 mini', w: 375, h: 812, dpr: 3, ios: true },
  { name: 'iPhone 14 / 16e', w: 390, h: 844, dpr: 3, ios: true },
  { name: 'iPhone 14 · Safari bars', w: 390, h: 734, dpr: 3, ios: true },
  { name: 'iPhone 15 / 16', w: 393, h: 852, dpr: 3, ios: true },
  { name: 'iPhone 16 · Safari bars', w: 393, h: 742, dpr: 3, ios: true },
  { name: 'iPhone 17 / 17 Pro', w: 402, h: 874, dpr: 3, ios: true },
  { name: 'iPhone Air', w: 420, h: 912, dpr: 3, ios: true },
  { name: 'iPhone 17 Pro Max', w: 440, h: 956, dpr: 3, ios: true },
  { name: 'Galaxy S24 / S25', w: 360, h: 780, dpr: 3 },
  { name: 'Galaxy S24 · Chrome bars', w: 360, h: 690, dpr: 3 },
  { name: 'Generic Android', w: 360, h: 800, dpr: 3 },
  { name: 'Galaxy S25 Ultra / A55', w: 384, h: 832, dpr: 2.625 },
  { name: 'Galaxy Z Flip 6', w: 360, h: 880, dpr: 3 },
  { name: 'Galaxy Z Fold 6 (folded)', w: 369, h: 905, dpr: 2.625 },
  { name: 'Pixel 8 / 9 / 10', w: 412, h: 915, dpr: 2.625 },
  { name: 'Pixel 10 · Chrome bars', w: 412, h: 825, dpr: 2.625 },
  { name: 'Pixel 9 Pro', w: 427, h: 952, dpr: 3 },
  { name: 'Pixel 9 Pro XL', w: 448, h: 997, dpr: 3 },
  { name: 'iPhone SE 3 · landscape', w: 667, h: 375, dpr: 2, ios: true },
  { name: 'iPhone 17 Pro · landscape', w: 874, h: 402, dpr: 3, ios: true },
  { name: 'iPhone 17 Pro · landscape, Safari bars', w: 874, h: 340, dpr: 3, ios: true },
  { name: 'iPhone 17 Pro Max · landscape', w: 956, h: 440, dpr: 3, ios: true },
  { name: 'Galaxy S24 · landscape', w: 780, h: 360, dpr: 3 },
  { name: 'Galaxy S24 · landscape, Chrome bars', w: 780, h: 300, dpr: 3 },
  { name: 'Pixel 8 · landscape', w: 915, h: 412, dpr: 2.625 },
  { name: 'Galaxy Z Fold 6 (unfolded)', w: 707, h: 823, dpr: 2.625 },
  { name: 'Pixel 9 Pro Fold (unfolded)', w: 791, h: 820, dpr: 2.625 },
  { name: 'iPad Air 11 · landscape', w: 1180, h: 820, dpr: 2 },
  /* the short tail: phones still in use with the smallest viewports, browser chrome included */
  { name: 'iPhone 8 / SE 2 · Safari bars', w: 375, h: 580, dpr: 2, ios: true },
  { name: 'iPhone 5-class', w: 320, h: 568, dpr: 2, ios: true },
  { name: 'Galaxy S8 / A-series', w: 360, h: 640, dpr: 3 },
  { name: 'Galaxy S8 · Chrome bars', w: 360, h: 560, dpr: 3 },
  { name: 'iPhone SE 3 · landscape, Safari bars', w: 667, h: 320, dpr: 2, ios: true },
  { name: 'Galaxy S8 · landscape, Chrome bars', w: 640, h: 300, dpr: 3 },
];

/* Real insets, not placeholders: iPhone portrait reserves the notch and the home indicator;
   iPhone landscape moves the notch to a side edge; Android reports nothing — its navigation bar
   lives outside the web viewport, so env(safe-area-inset-*) is zero there. */
const insetsFor = d => {
  if (!d.ios) return { top: 0, bottom: 0, left: 0, right: 0 };
  return d.w > d.h ? { top: 0, bottom: 21, left: 44, right: 44 } : { top: 50, bottom: 34, left: 0, right: 0 };
};

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=${process.env.TEMP}\\chrome-mc-${port}-${Date.now().toString(36)}`, `--remote-debugging-port=${port}`,
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

const rows = [];
for (let i = 0; i < DEVICES.length; i++) {
  const d = DEVICES[i];
  await send('Emulation.setDeviceMetricsOverride', { width: d.w, height: d.h, deviceScaleFactor: d.dpr, mobile: true });
  // iPhone home indicator / notch, Android 3-button bar; a page must reserve them.
  await send('Emulation.setSafeAreaInsetsOverride', { insets: insetsFor(d) }).catch(() => {});
  exceptions.length = 0;
  await send('Page.navigate', { url: `${base}?cam=trip35&film=gold200&autoshot=1&shots=3&date=1&dev=1&_cb=${i}` });
  await new Promise(r => setTimeout(r, waitMs));
  const r = await send('Runtime.evaluate', { expression: expr.replace('__INSETS__', JSON.stringify(insetsFor(d))), returnByValue: true, awaitPromise: true });
  const ex = r.result && r.result.exceptionDetails;
  const raw = (r.result && r.result.result) || r.result;
  const val = raw && typeof raw.value !== 'undefined' ? raw.value : raw;
  const out = typeof val === 'string' ? JSON.parse(val)
    : (val && typeof val === 'object' ? val : { error: (ex && (ex.exception?.description || ex.text)) || (raw && raw.description) || String(raw) });
  out.exceptions = exceptions.slice(0, 2);
  rows.push({ device: d.name, css: `${d.w}x${d.h}`, dpr: d.dpr, ...out });
}

/* ── verdict table ── one line per device; a FAIL means an invariant a phone would hit. */
const flag = (ok) => ok ? 'ok' : 'FAIL';
/* a window wider than any body shape prints means the room ran out and the shape was lost */
const shapeOk = (a) => a <= 1.36;
for (const r of rows) {
  if (r.error) { console.log(`${(r.device + '            ').slice(0, 38)} ${r.css}  PROBE ERROR: ${r.error}${r.exceptions && r.exceptions.length ? ' | ' + r.exceptions.join(' | ') : ''}`); continue; }
  const geom = r.portrait
    ? `dock ${r.dockInView ? 'ok' : 'FAIL'} shutter ${flag(Math.abs(r.shutterCentreOff) <= 3)} symmetric ${flag(r.symmetric)} strip ${flag(r.stripClearsDock)}`
    : `rail ${flag(r.railOnAppEdge)} rightOfStage ${flag(r.controlsRightOfStage)} railSym ${flag(r.railSymmetric)} strip ${flag(r.stripClearsRail)}`;
  console.log(`${(r.device + '            ').slice(0, 38)} ${r.css}  noScroll ${flag(r.noScroll)} overflowX ${flag(!r.overflowX)} `
    + `stage ${r.stage.w}x${r.stage.h} a=${r.stage.aspect} ${flag(r.stage.inView)} shape ${flag(shapeOk(r.stage.aspect))} safePad ${r.dockPadBottom} `
    + `deck ${flag(r.deck.fits)} tabs ${flag(r.deck.tabsInView)} gallery ${flag(r.gallery.fits)} inset ${flag(!r.insetClash?.count)} minTap ${r.minTapPx} text ${r.smallestText.px}px  ${geom}`);
  if (r.exceptions.length) console.log(`  ! exceptions: ${r.exceptions.join(' | ')}`);
}
const bad = rows.filter(r => !r.error && (!r.noScroll || r.overflowX || !r.dockInView || !r.stage.inView || !shapeOk(r.stage.aspect)
  || (r.portrait ? !r.stripClearsDock : !r.stripClearsRail)
  || !r.deck?.fits || !r.deck?.tabsInView || !r.gallery?.fits || !!r.insetClash?.count
  || (r.portrait && (Math.abs(r.shutterCentreOff) > 3 || !r.symmetric))
  || (!r.portrait && (!r.railOnAppEdge || !r.controlsRightOfStage || !r.railSymmetric))));
console.log(`\n${rows.length} viewports tested · ${rows.length - bad.length} clean · ${bad.length} with a problem`);
if (bad.length) for (const b of bad) console.log(`  problem: ${b.device} → ` + JSON.stringify({
  noScroll: b.noScroll, overflowX: b.overflowX, dockInView: b.dockInView,
  stripClears: b.portrait ? b.stripClearsDock : b.stripClearsRail,
  stage: b.stage, shapeOk: shapeOk(b.stage.aspect), deck: b.deck?.fits, tabs: b.deck?.tabsInView, gallery: b.gallery?.fits,
  insetClash: b.insetClash, centring: b.portrait ? [b.shutterCentreOff, b.symmetric] : [b.railOnAppEdge, b.controlsRightOfStage, b.railSymmetric],
  smallestText: b.smallestText, minTap: b.minTapPx, footOneLine: b.footOneLine, plateOverflow: b.plateOverflow }));
/* usability floor, informational: iOS guidance is 44px, Android Material 48dp; small print is a
   legibility limit on a real handset, not a style note */
const tight = rows.filter(r => !r.error && r.minTapPx !== null && r.minTapPx < 44);
if (tight.length) console.log(`  tap floor: ${tight.length}/${rows.length} viewports have a control under 44px (smallest ${Math.min(...tight.map(r => r.minTapPx))}px)`);
const tiny = rows.filter(r => !r.error && r.smallestText.px < 9);
if (tiny.length) console.log(`  small print: ${tiny.length}/${rows.length} viewports render text at ${Math.min(...tiny.map(r => r.smallestText.px))}px (${tiny[0].smallestText.where})`);
console.log('\nfull json:\n' + JSON.stringify(rows));

ws.close(); proc.kill();
setTimeout(() => process.exit(0), 300);
