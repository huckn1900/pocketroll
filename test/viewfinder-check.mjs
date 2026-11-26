/* test/viewfinder-check.mjs — the viewfinder is a per-body system, so the assertions are derived
   from each profile's own `viewfinder` design rather than from a hardcoded list: what the manual
   says the body shows must be exactly what the screen draws, and nothing more.

     1) design follows the body: dataset.vf equals the profile's design id, every body has its own
     2) marks equal the design: boundary style from the optical construction, the focusing aid the
        body has, the lamps and instruments it really reads out — no invented marks
     3) nothing left over from the old universal finder (.focusbox / .vf-corners / data-focus / #hud)
     4) marks sit on the displayed picture, not on the black bars: overlay rect == contained feed
     5) switching bodies changes the design without moving the layout (stage rect + scroll unchanged)
     6) a display that answers the half-press stays dark until the shutter is pressed
     7) numerals come from the declared meter scale, never from a scale the body does not have
     8) the finder graphics never reach the photograph

   Usage: node test/viewfinder-check.mjs "<url with ?hud=full>" [out.png]
   Why: "authenticity over decoration" is the hard rule of this round — a design drawn from a
   guessed universal template would pass a visual check and fail this one. */
import { spawn } from 'node:child_process';
import { chromeBin, tmpProfile } from './browser.mjs';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const out = process.argv[3] || 'test/out-viewfinder.png';
const chrome = chromeBin(); // DSH_CHROME overrides the browser executable — see test/browser.mjs
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--user-data-dir=${tmpProfile('vfc', port)}`,
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

const probe = `(async () => {
  const stage = document.getElementById('vfStage');
  const host = document.getElementById('vfOverlay');
  const cv = document.getElementById('viewfinder');
  const failures = [];
  const ids = new Set();
  const marks = [];

  /* what a design must draw, derived from the profile itself */
  const expect = (v) => {
    const need = [];
    if (v.optics === 'screen') need.push('vf-screen', 'vf-fresnel', 'vf-screenedge');
    else if (typeof v.frame === 'number') need.push(v.optics === 'rf' ? 'vf-lines' : 'vf-frame');
    if (v.closeFrame) need.push('vf-close');
    if ((v.parallax || []).length) need.push('vf-parallax');
    if (v.ghosts) need.push('vf-ghost', 'vf-ghost');
    if (v.focus === 'patch') need.push('vf-patch');
    if (v.focus === 'afFrame') need.push('vf-af');
    if (v.focus === 'afMarks') need.push('vf-afmarks');
    if (v.focus === 'crosshair') need.push('vf-cross');
    for (const l of v.lamps || []) need.push('vf-lamp');
    if (v.readout?.kind === 'needle') {
      need.push('vf-needle');
      if (v.readout.shows.includes('focus') && v.readout.shows.includes('shutter')) need.push('vf-needle');
    }
    if (v.readout?.kind === 'lcd') need.push('vf-led');
    if (v.meter === 'aperture') need.push('vf-meter');
    return need.sort();
  };

  const sameGate = (a, b) => (a?.gate ? String(a.gate.aspect) : '135') === (b?.gate ? String(b.gate.aspect) : '135');
  let gateStage = null;
  for (const c of state.cameras) {
    if (!loadCamera(c, { quiet: true })) continue;
    const v = c.viewfinder;
    ids.add(stage.dataset.vf);
    if (stage.dataset.vf !== v.id) failures.push(c.id + ': design id is ' + stage.dataset.vf + ', profile says ' + v.id);
    if (stage.dataset.optics !== v.optics) failures.push(c.id + ': optics mismatch');
    const got = [...host.children].map(n => n.className.split(' ')[0]).sort();
    const want = expect(v);
    marks.push({ id: c.id, optics: v.optics, design: stage.dataset.vf, drawn: got.length, declared: want.length });
    if (got.join('|') !== want.join('|')) {
      failures.push(c.id + ': draws [' + got.join(' ') + '] but its design declares [' + want.join(' ') + ']');
    }
    /* instruments and readouts stay behind the tap; boundaries are optics and always visible */
    for (const n of host.querySelectorAll('.vf-needle,.vf-meter,.vf-led')) {
      if (!n.className.includes('full-only')) failures.push(c.id + ': ' + n.className.split(' ')[0] + ' is lit without being asked');
    }
    /* a plain window must not be given a frame to look sophisticated */
    if (v.frame === false && host.querySelector('.vf-frame,.vf-lines,.vf-screenedge')) {
      failures.push(c.id + ': a window that projects no frame is drawing a boundary');
    }
    /* the spot keeps its own shape, and only a projected frame can shift for near focus */
    if (v.focusShape === 'oval' && !host.querySelector('.vf-patch.oval')) failures.push(c.id + ': oval reticle drawn as a rectangle');
    if (v.focusShape !== 'oval' && host.querySelector('.vf-patch.oval')) failures.push(c.id + ': rectangular spot drawn as an oval');
    if (!v.nearShift && host.querySelector('.nearshift')) failures.push(c.id + ': a frame that does not correct for near focus is sliding');
    /* marks line up with the displayed picture, never with the letterbox bars */
    const w = stage.clientWidth, h = stage.clientHeight;
    const aspect = (video.videoWidth || cv.width) / (video.videoHeight || cv.height);
    let pw = w, ph = h;
    if (aspect > w / h) ph = Math.round(w / aspect); else pw = Math.round(h * aspect);
    const dx = parseFloat(host.style.left) - (w - pw) / 2, dy = parseFloat(host.style.top) - (h - ph) / 2;
    const dw = parseFloat(host.style.width) - pw, dh = parseFloat(host.style.height) - ph;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2 || Math.abs(dw) > 2 || Math.abs(dh) > 2) {
      failures.push(c.id + ': marks are off the picture by ' + dx + ',' + dy + ',' + dw + ',' + dh);
    }
    /* switching bodies of the same gate must not move anything */
    const rect = stage.getBoundingClientRect();
    if (gateStage && sameGate(gateStage, c)) {
      if (Math.abs(rect.width - gateStage.rect.width) > 1 || Math.abs(rect.height - gateStage.rect.height) > 1) {
        failures.push(c.id + ': switching the body moved the finder window');
      }
    }
    gateStage = { rect, gate: c.gate };
    if (document.documentElement.scrollHeight > innerHeight + 1) failures.push(c.id + ': the page scrolled while switching');
  }
  if (ids.size !== state.cameras.length) failures.push('only ' + ids.size + ' distinct designs for ' + state.cameras.length + ' bodies');

  /* the old universal interface must be gone */
  for (const sel of ['.focusbox', '.vf-corners', '.vf-brackets', '[data-focus]', '#hud', '#hudReadout']) {
    if (document.querySelector(sel)) failures.push('leftover universal finder markup: ' + sel);
  }

  /* TC-1's numerals answer the half-press: dark until pressed, lit for that moment */
  loadCamera(state.cameras.find(c => c.id === 'tc01'), { quiet: true });
  const led = host.querySelector('.vf-led.onpress');
  if (!led) failures.push('tc01: its half-press display is missing');
  else {
    const dark = Number(getComputedStyle(led).opacity);
    vfConfirm(state.cam);
    await new Promise(r => setTimeout(r, 320));   // the reveal fades in over .18s
    const lit = Number(getComputedStyle(led).opacity);
    if (dark > 0.01) failures.push('tc01: display is lit without a press (opacity ' + dark + ')');
    if (lit < 0.5) failures.push('tc01: half-press does not light the display');
  }

  /* a focus needle rests at infinity with nothing locked, and an EE meter only prints stops
     its own scale has (the Canonet scale skips f/2) */
  loadCamera(state.cameras.find(c => c.id === 'l35af'), { quiet: true });
  for (const n of host.querySelectorAll('.vf-needle')) {
    if (n.style.getPropertyValue('--kind') === 'focus') {
      const p = n.querySelector('.vf-needlepole').style.getPropertyValue('--pos');
      if (p !== '1') failures.push('l35af: focus needle reads ' + p + ' with nothing locked');
    }
  }
  loadCamera(state.cameras.find(c => c.id === 'canonetql17'), { quiet: true });
  renderHud();
  const tick = host.querySelector('.vf-mtick')?.textContent || '';
  const scale = state.cameras.find(c => c.id === 'canonetql17').viewfinder.meterScale;
  const printed = parseFloat(tick.replace('f', ''));
  if (!scale.includes(printed)) failures.push('canonetql17: meter printed ' + tick + ', not on its scale ' + scale.join(','));

  /* the finder graphics never reach the photograph: hold a still scene and read the canvas twice */
  const still = document.createElement('canvas'); still.width = 640; still.height = 480;
  const g2 = still.getContext('2d'); g2.fillStyle = '#8a8a8a'; g2.fillRect(0, 0, 640, 480);
  try { video.srcObject = still.captureStream(); } catch {}
  if (typeof demoCanvas !== 'undefined') { try { demoCanvas = still; } catch {} }
  await new Promise(r => setTimeout(r, 900));
  const meanOf = () => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return s / (d.length / 4);
  };
  const withMarks = meanOf();
  host.style.display = 'none';
  await new Promise(r => setTimeout(r, 400));
  const withoutMarks = meanOf();
  host.style.display = '';
  if (Math.abs(withMarks - withoutMarks) > 0.6) {
    failures.push('the photograph changed when the finder marks were hidden: ' + withMarks.toFixed(1) + ' vs ' + withoutMarks.toFixed(1));
  }

  loadCamera(state.cameras.find(c => c.id === 'contaxt2'), { quiet: true });
  return JSON.stringify({ bodies: state.cameras.length, designs: [...ids], marks, failures });
})()`;

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url });
await new Promise(r => setTimeout(r, 3500)); // boot + assets fetch
const res = await send('Runtime.evaluate', { expression: probe, awaitPromise: true, returnByValue: true, timeout: 40000 });
const val = (res.result && res.result.result && res.result.result.value) ?? res.result?.value;
const parsed = val ? JSON.parse(val) : { failures: ['probe returned no value'] };
console.log(JSON.stringify(parsed, null, parsed.failures.length ? 2 : 0));
await new Promise(r => setTimeout(r, 400));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('finder sheet → ' + out);
ws.close(); proc.kill();
setTimeout(() => process.exit(parsed.failures.length ? 1 : 0), 300);
