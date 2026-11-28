/* scripts/make-reels.mjs — the POCKETROLL reel factory.
   Shoots REAL footage of the live app in headless Chrome (phone layout, 9:16 viewport),
   then assembles MP4 + GIF previews with ffmpeg-static. Footage only: captions/hooks are
   added at posting time, never baked into frames.

   usage: node scripts/make-reels.mjs [--base <url>] [--only <name>] [--out <dir>]
   outputs: <out>/<name>.mp4 (1080x1920) and <out>/<name>.gif (preview)
   Reel specs below are the growth formats: F1 = shoot → develop reveal, F2 = full roll ritual,
   F3 = named look preview, F4 = a second body+film variation of F1.
   The -real reels feed the finder a REAL photograph (assets/samples/street.jpg, slowly
   drifting) instead of the fake device blob: the Kapi-format hook needs a real scene. */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import ffmpegPath from 'ffmpeg-static';
import { chromeBin, tmpProfile } from '../test/browser.mjs';

const argv = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) { argv[process.argv[i].slice(2)] = process.argv[i + 1]; i++; }
}
const base = argv.base || 'https://pocketroll35.pages.dev/index.html';
const outDir = argv.out || 'reels';
mkdirSync(outDir, { recursive: true });

const FPS = 10;             // assembly framerate; capture interval ≈ 1000/FPS ms
const W = 420, H = 750, DSF = 1.5; // phone layout (<430px) at exact 9:16; frames land at 630x1125

/* Real-scene feed: the sensor element is a module-level `video` reachable from the main
   world (same global scope as the app scripts). Swap its srcObject for a slowly drifting
   canvas of street.jpg — the scene moves, the app shoots it like any live feed. */
const SCENE_BASE = `(async () => {
  const img = new Image(); img.src = 'assets/samples/street.jpg'; await img.decode();
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const cw = ${'CW'}, ch = ${'CH'};
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  const t0 = performance.now();
  function draw() {
    const t = (performance.now() - t0) / 1000;
    const s = 1.16 + Math.sin(t * 0.22) * 0.03;
    ${'LAY'}
    ${'TINT'}
    requestAnimationFrame(draw);
  }
  draw();
  video.srcObject = cv.captureStream(30); video.play();
})()`;
const LAY_FULL = 'ctx.drawImage(img, (1 - s) * cw / 2 + Math.sin(t * 0.35) * 20, (1 - s) * ch / 2 + Math.cos(t * 0.27) * 12, s * cw, s * ch);';
const LAY_CROP = 'const sw0 = iw * 0.34, sx0 = (iw - sw0) / 2; const sw = sw0 * s, sh = sw * ch / cw;'
  + 'const sx = sx0 + Math.sin(t * 0.3) * 30 + (sw0 - sw) / 2, sy = Math.max(0, (ih - sh) / 2 + Math.cos(t * 0.2) * 20);'
  + 'ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);';
const TINT_NONE = '';
const TINT_NIGHT = "ctx.globalCompositeOperation='multiply'; ctx.fillStyle='#26324a'; ctx.fillRect(0,0,cw,ch); ctx.globalCompositeOperation='source-over';";
const TINT_SUNSET = "ctx.globalCompositeOperation='multiply'; ctx.fillStyle='#ffbf7f'; ctx.fillRect(0,0,cw,ch); ctx.globalCompositeOperation='source-over';";
/* The ${'...'} placeholders evaluate to bare token text inside the assembled expression. */
const scene = (lay, tint, cw, ch) => SCENE_BASE
  .replace('CW', String(cw)).replace('CH', String(ch))
  .replace('LAY', lay).replace('TINT', tint);
const SCENE_DAY = scene(LAY_FULL, TINT_NONE, 960, 720);
const SCENE_NIGHT = scene(LAY_FULL, TINT_NIGHT, 960, 720);
const SCENE_SUNSET = scene(LAY_FULL, TINT_SUNSET, 960, 720);
const SCENE_PORTRAIT = scene(LAY_CROP, TINT_NONE, 720, 960);

/* steps: {frames:n,ms} capture n screenshots; {eval:expr} fire a main-world call (no await);
   {wait:ms} pause. capture()/developRoll()/state are main-world identifiers (see key rules). */
const REELS = {
  'f1-gold-street': {
    params: '?cam=trip35&film=gold200&fresh=1&feed=0.75',
    steps: [
      { wait: 1600 }, { frames: 12 },                       // viewfinder living
      { eval: 'capture()' }, { frames: 7 },                 // shutter + latent frame
      { eval: 'developRoll()' }, { frames: 26 },            // develop animation + reveal
      { frames: 5, ms: 240 },                               // hold on the developed photo
    ],
  },
  'f2-lca-portra-roll': {
    params: '?cam=lca&film=portra400&fresh=1&feed=0.75',
    steps: [
      { wait: 1600 }, { frames: 14 },                       // viewfinder living
      { eval: 'for (let i = 0; i < 36; i++) capture()' }, { frames: 12 }, // the whole roll exposed
      { eval: 'developRoll()' }, { frames: 44 },            // four stages + staggered reveal
      { frames: 6, ms: 220 },                               // the finished roll
    ],
  },
  'f3-gold-look': {
    params: '?preview=gold200&fresh=1',
    steps: [
      { wait: 2200 }, { frames: 10 },                       // preview opens with engine samples
      { eval: 'document.querySelector(".modal.open .sheet")?.scrollBy({ top: 300 })' }, { frames: 12 },
      { eval: 'document.querySelector(".modal.open .sheet")?.scrollBy({ top: 420 })' }, { frames: 12 },
      { frames: 4, ms: 240 },
    ],
  },
  'f4-hp5-night': {
    params: '?cam=instamatic&film=hp5plus&fresh=1&feed=0.62',
    steps: [
      { wait: 1600 }, { frames: 12 },
      { eval: 'capture()' }, { frames: 7 },
      { eval: 'developRoll()' }, { frames: 26 },
      { frames: 5, ms: 240 },
    ],
  },
};

function sh(spawnArgs) {
  return new Promise((res, rej) => {
    const p = spawn(ffmpegPath, spawnArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('exit', (code) => code === 0 ? res() : rej(new Error('ffmpeg exit ' + code + ': ' + err.slice(-400))));
  });
}

async function runReel(name, spec) {
  const port = 9433 + Math.floor(Math.random() * 60);
  const proc = spawn(chromeBin(), ['--headless=new', '--disable-gpu', '--no-sandbox',
    `--user-data-dir=${tmpProfile('reel', port)}`, `--remote-debugging-port=${port}`,
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    { stdio: 'ignore', detached: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitPort() {
    for (let i = 0; i < 20; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); if (r.ok) return await r.json(); } catch {}
      await sleep(400);
    }
    throw new Error('no devtools');
  }
  const list = await waitPort();
  const target = list.find((t) => t.type === 'page') || list[0];
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
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DSF, mobile: true });

  // Load the live app; retry navigation until the app has booted (state + film loaded).
  const url = base + spec.params;
  let booted = false;
  for (let attempt = 0; attempt < 4 && !booted; attempt++) {
    await send('Page.navigate', { url });
    await sleep(2600);
    const r = await send('Runtime.evaluate', { expression: 'typeof state !== "undefined" && !!state.cam && !!state.film', returnByValue: true });
    booted = r.result?.result?.value === true;
  }
  if (!booted) throw new Error('app never booted at ' + url);

  const frameDir = `${outDir}/_frames/${name}`;
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  let frame = 0;
  for (const st of spec.steps) {
    if (st.wait) await sleep(st.wait);
    if (st.eval) await send('Runtime.evaluate', { expression: st.eval, awaitPromise: false });
    if (!st.frames) continue;
    const interval = st.ms || Math.round(1000 / FPS);
    for (let i = 0; i < st.frames; i++) {
      await sleep(interval);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${frameDir}/f${String(frame).padStart(4, '0')}.png`, Buffer.from(shot.result.data, 'base64'));
      frame++;
    }
  }
  ws.close(); proc.kill();

  const mp4 = `${outDir}/${name}.mp4`;
  await sh(['-y', '-framerate', String(FPS), '-i', `${frameDir}/f%04d.png`,
    '-vf', 'scale=1080:1920:flags=lanczos', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  const gif = `${outDir}/${name}.gif`;
  await sh(['-y', '-framerate', String(FPS), '-i', `${frameDir}/f%04d.png`,
    '-vf', 'scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer',
    '-loop', '0', gif]);
  if (exceptions.length) console.log(`${name}: page exceptions: ${exceptions.join(' | ')}`);
  console.log(`${name}: ${frame} frames → ${mp4} + ${gif}`);
}

/* Batch 2: the same formats aimed at a REAL scene — street.jpg drifting inside the finder. */
Object.assign(REELS, {
  'f5-street-gold-real': {
    params: '?cam=trip35&film=gold200&fresh=1',
    steps: [
      { wait: 1600 }, { eval: SCENE_DAY }, { wait: 1500 }, { frames: 12 },  // the real street lives in the finder
      { eval: 'capture()' }, { frames: 8 },                                  // shutter → latent frame
      { eval: 'developRoll()' }, { frames: 30 },                            // develop stages + reveal
      { frames: 6, ms: 200 },                                               // hold on the developed photo
    ],
  },
  'f6-street-velvia-real': {
    params: '?cam=t4&film=velvia50&fresh=1',
    steps: [
      { wait: 1600 }, { eval: SCENE_DAY }, { wait: 1500 }, { frames: 10 },
      { eval: 'capture()' }, { frames: 8 },
      { eval: 'developRoll()' }, { frames: 30 },
      { frames: 6, ms: 200 },
    ],
  },
  'f7-street-hp5-bw-real': {
    params: '?cam=trip35&film=hp5plus&fresh=1',
    steps: [
      { wait: 1600 }, { eval: SCENE_DAY }, { wait: 1500 }, { frames: 10 },
      { eval: 'capture()' }, { frames: 5 },
      { eval: 'capture()' }, { frames: 6 },                                 // two exposures, the strip fills up
      { eval: 'developRoll()' }, { frames: 30 },
      { frames: 6, ms: 200 },
    ],
  },
  'f8-street-night-flash': {
    params: '?cam=af35m&film=hp5plus&fresh=1',
    steps: [
      { wait: 1600 }, { eval: SCENE_NIGHT }, { wait: 1500 }, { frames: 12 },  // night street in the finder
      { eval: "$('optFlash').click()" }, { frames: 3 },                       // turn flash on (af35m owns a flash)
      { eval: 'capture()' }, { frames: 8 },                                  // flash pop on the dark scene
      { eval: 'developRoll()' }, { frames: 30 },
      { frames: 6, ms: 200 },
    ],
  },
});

/* Batch 3: the ritual formats on real scenes — full roll + contact sheet finale (F2),
   sunset look, vertical framing, and a PRO film shown unlocked (the hook bypasses gating). */
Object.assign(REELS, {
  'f9-real-full-roll': {
    params: '?cam=lca&film=portra400&fresh=1',
    steps: [
      { wait: 1600 }, { eval: SCENE_DAY }, { wait: 1500 }, { frames: 10 },
      { eval: 'for (let i = 0; i < 36; i++) capture()' }, { frames: 14 },     // the whole roll shot, fast
      { eval: 'developRoll()' }, { frames: 46 },                              // full develop ritual
      // finale = the deck's roll page: developed strip + CONTACT SHEET button (sheetBtn downloads, it is not a viewer)
      { eval: "openDeck('roll')" }, { wait: 800 }, { frames: 16 },
      { frames: 4, ms: 200 },
    ],
  },
  'f10-sunset-colorplus': {
    params: '?cam=instamatic&film=colorplus&fresh=1',
    steps: [
      { wait: 1600 }, { eval: SCENE_SUNSET }, { wait: 1500 }, { frames: 12 },  // golden-hour scene
      { eval: 'capture()' }, { frames: 8 },
      { eval: 'developRoll()' }, { frames: 30 },
      { frames: 6, ms: 200 },
    ],
  },
  'f11-portrait-hp5-vertical': {
    params: '?cam=trip35&film=hp5plus&fresh=1',
    steps: [
      { wait: 1600 }, { eval: SCENE_PORTRAIT }, { wait: 1500 }, { frames: 12 },  // vertical crop in the finder
      { eval: 'capture()' }, { frames: 8 },
      { eval: 'developRoll()' }, { frames: 30 },                                 // B&W vertical reveal
      { frames: 6, ms: 200 },
    ],
  },
  'f12-pro-cinestill-night': {
    params: '?cam=lca&film=cinestill800t&fresh=1',
    steps: [
      { wait: 1600 }, { eval: SCENE_NIGHT }, { wait: 1500 }, { frames: 12 },   // night scene, PRO film on screen
      { eval: 'capture()' }, { frames: 8 },                                     // red halation at the shutter
      { eval: 'developRoll()' }, { frames: 30 },
      { frames: 6, ms: 200 },
    ],
  },
});

const wanted = argv.only ? [argv.only] : Object.keys(REELS);
for (const name of wanted) {
  if (!REELS[name]) { console.error('unknown reel: ' + name); process.exit(1); }
  try { await runReel(name, REELS[name]); } catch (e) { console.error(`${name} FAILED: ${e.message}`); }
}
