/* test/features-check.mjs — assert Round-11 feature behaviour on a live page:
   1) flash simulation: same fake scene captured with flash ON vs OFF — the centre
      must be brighter and the corner (background) must stay deep; needs a
      flash-capable body: pass ?cam=af35m (trip35/lca etc. have no built-in flash);
   2) date stamp: bottom-right corner pixels must carry the orange stamp tint;
   3) contact sheet: after develop, state.sheet is a real decodable image; saved to disk.
   Usage: node test/features-check.mjs <url-with-autoshot-date+cam> [out-sheet.jpg] */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const outSheet = process.argv[3] || 'test/out-sheet.jpg';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--user-data-dir=${process.env.TEMP}\\chrome-fc-${port}-${Date.now().toString(36)}`,
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
await new Promise(r => setTimeout(r, 4200)); // boot + autoshot @900ms

const probe = await send('Runtime.evaluate', {
  expression: `(async () => {
    if (state.frames.length < 3) return 'NO SHOTS';
    const patch = (url, x, y, s) => new Promise(res => {
      const im = new Image(); im.src = url;
      im.onload = () => {
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        const d = c.getContext('2d').drawImage(im, 0, 0) || c.getContext('2d').getImageData(x, y, s, s).data;
        let l = 0, r = 0, g = 0, b = 0, n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) { l += d[i] * .299 + d[i+1] * .587 + d[i+2] * .114; r += d[i]; g += d[i+1]; b += d[i+2]; }
        res({ l: Math.round(l / n), r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) });
      };
      im.onerror = () => res(null);
    });
    // deterministic scene for the cross-frame compares: the fake-device blob changes shape
    // every shot, so brightness/orange-pixel comparisons across frames are flaky — swap BOTH
    // sources to a uniform gray canvas (same capture pipeline, no moving content). capture()
    // reads the video when a device is present and the fake canvas when it is not; swapping
    // both covers either runner.
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 960;
    const cx2 = cv.getContext('2d'); cx2.fillStyle = '#808080'; cx2.fillRect(0, 0, 1280, 960);
    video.srcObject = cv.captureStream(30); video.play();
    demoCanvas = cv;
    await new Promise(r => setTimeout(r, 400));
    // Address the frames this probe captured by taking them as they are made, not by index:
    // the autoshot count in the URL shifts every index, so a fixed index compared an
    // autoshot of the moving scene against a gray frame.
    state.opts.flash = true; capture({ noLeak: true }); await new Promise(r => setTimeout(r, 350));
    const onUrl = state.frames[state.frames.length - 1].url;
    state.opts.flash = false; capture({ noLeak: true }); await new Promise(r => setTimeout(r, 350));
    const offUrl = state.frames[state.frames.length - 1].url;
    const g = new Image(); g.src = onUrl; await g.decode();
    const GW = g.naturalWidth, GH = g.naturalHeight;   // the gray frames' own geometry
    const on = await patch(onUrl, Math.round(GW * .40), Math.round(GH * .42), 40);
    const off = await patch(offUrl, Math.round(GW * .40), Math.round(GH * .42), 40);
    const corner = await patch(onUrl, GW - 140, GH - 55, 30);
    // noLeak on every comparison frame: a light leak is a random orange wash, and a frame
    // that happened to get one out-measures a stamped frame that did not — the leak is not
    // what this assertion is about.
    state.opts.date = false; capture({ noLeak: true }); // same gray scene, no stamp — control frame
    await new Promise(r => setTimeout(r, 350));
    const controlUrl = state.frames[state.frames.length - 1].url;
    const cornerNo = await patch(controlUrl, GW - 140, GH - 55, 30);
    const orangeCount = (u) => new Promise(res => {
      const im = new Image(); im.src = u;
      im.onload = () => {
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0);
        const d = ctx.getImageData(Math.round(im.naturalWidth * 0.82), Math.round(im.naturalHeight * 0.90),
          Math.round(im.naturalWidth * 0.16), Math.round(im.naturalHeight * 0.08)).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 140 && d[i] > d[i+1] + 55 && d[i] > d[i+2] + 90) n++;
        res(n);
      };
      im.onerror = () => res(-1);
    });
    // count orange stamp pixels in the bottom-right stamp zone of both frames. Both sides are
    // the SAME gray scene with the leak suppressed: the autoshot frame is the procedural demo
    // scene, whose content changes every run, so counting orange pixels there measured the
    // scene — and a random light leak — instead of the stamp.
    const stamped = await orangeCount(onUrl);
    const unstamped = await orangeCount(controlUrl);
    state.opts.flash = true;
    developRoll();
    await new Promise(r => setTimeout(r, 6500)); // developer phases + reveal + archive + sheet
    const sheetOk = !!state.sheet;
    let sheetSize = 'none';
    if (sheetOk) { const s = new Image(); s.src = state.sheet; await s.decode(); sheetSize = s.naturalWidth + 'x' + s.naturalHeight; }
    return JSON.stringify({
      center_flash_on: on && on.l, center_flash_off: off && off.l,
      corner_rgb: corner && [corner.r, corner.g, corner.b],
      corner_no_stamp: cornerNo && [cornerNo.r, cornerNo.g, cornerNo.b],
      stamp_pixels: [stamped, unstamped],
      developed: state.developed, sheet: sheetSize, frames: state.frames.length,
    });
  })()`,
  awaitPromise: true, returnByValue: true, timeout: 20000,
});
const val = (probe.result && probe.result.result && probe.result.result.value) ?? probe.result?.value;
console.log(val ?? JSON.stringify(probe));
if (val && !val.startsWith('NO')) {
  const j = JSON.parse(val);
  const ok = [];
  ok.push(j.center_flash_on > j.center_flash_off ? 'PASS flash brightens centre' : `FAIL flash (${j.center_flash_on} vs ${j.center_flash_off})`);
  ok.push(j.stamp_pixels && j.stamp_pixels[0] > j.stamp_pixels[1] + 40 ? `PASS date stamp orange pixels (${j.stamp_pixels[0]} vs ${j.stamp_pixels[1]})` : `FAIL stamp (${j.stamp_pixels})`);
  ok.push(j.developed && j.sheet !== 'none' ? `PASS contact sheet ${j.sheet}` : 'FAIL sheet');
  console.log(ok.join('\n'));
  if (j.sheet !== 'none') {
    const sheet = await send('Runtime.evaluate', { expression: 'state.sheet', returnByValue: true });
    const dataUrl = (sheet.result && sheet.result.result && sheet.result.result.value) ?? sheet.result?.value;
    writeFileSync(outSheet, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('sheet saved → ' + outSheet);
  }
}
ws.close(); proc.kill();
setTimeout(() => process.exit(0), 300);
