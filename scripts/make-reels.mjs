/* scripts/make-reels.mjs — the POCKETROLL reel factory.
   Shoots REAL footage of the live app in headless Chrome (phone layout, 9:16 viewport),
   then assembles MP4 + GIF previews with ffmpeg-static. Footage only: captions/hooks are
   added at posting time, never baked into frames.

   usage: node scripts/make-reels.mjs [--base <url>] [--only <name>] [--out <dir>]
   outputs: <out>/<name>.mp4 (1080x1920) and <out>/<name>.gif (preview)
   Reel specs below are the growth formats: F1 = shoot → develop reveal, F2 = full roll ritual,
   F3 = named look preview, F4 = a second body+film variation of F1. */
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

const FPS = 8;              // assembly framerate; capture interval ≈ 1000/FPS ms
const W = 420, H = 750, DSF = 1.5; // phone layout (<430px) at exact 9:16; frames land at 630x1125

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

const wanted = argv.only ? [argv.only] : Object.keys(REELS);
for (const name of wanted) {
  if (!REELS[name]) { console.error('unknown reel: ' + name); process.exit(1); }
  try { await runReel(name, REELS[name]); } catch (e) { console.error(`${name} FAILED: ${e.message}`); }
}
