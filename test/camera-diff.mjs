/* test/camera-diff.mjs — Camera Bag: same film, different bodies must render visibly differently.
   Deterministic synthetic scene (gray bg + white vertical line at x=0.25W), captured through
   the real pipeline on T4 (sharp prime) vs LC-A+ (soft plastic lens):
   1) vignette: LC-A corner must be deeper than T4 corner;
   2) softness: LC-A line edge must spread wider than T4;
   3) rectilinear: every body ships distortion 0 today, so the vertical line must stay
      straight on both — the fisheye bulge was removed on request (see scripts/patch-distortion.mjs).
   Usage: node test/camera-diff.mjs <base-url> */
import { spawn } from 'node:child_process';

const base = process.argv[2];
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333 + Math.floor(Math.random() * 60);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--user-data-dir=${process.env.TEMP}\\chrome-cd-${port}`,
  `--remote-debugging-port=${port}`,
], { stdio: 'ignore', detached: true });

async function waitPort() {
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(`http://127.0.1:${port}/json/list`); } catch {}
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
const evalIn = async (expr, timeout = 25000) => {
  const p = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
  return (p.result && p.result.result && p.result.result.value) ?? p.result?.value;
};

const SCENE = `
  const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 960;
  const cx2 = cv.getContext('2d');
  cx2.fillStyle = '#707070'; cx2.fillRect(0, 0, 1280, 960);
  cx2.fillStyle = '#ffffff'; cx2.fillRect(300, 0, 8, 960); // vertical line at 0.2344W
  /* Two random effects would be mistaken for lens behaviour: the cheap-body light leaks the
     finder seeps every frame, and the warm seep drawn at the moment of exposure. The analysis
     path asks the engine for noLeak and zeroes this run's leak probability — the app never
     does either. We still measure the EXPORTED frame, because the finder canvas is small and
     grain breaks the line into sub-6px fragments there. */
  const orig = engine.process.bind(engine);
  engine.process = (s, sw, sh, o) => orig(s, sw, sh, { ...o, noLeak: true });
  state.film.leak_prob = 0;
  video.srcObject = cv.captureStream(30); video.play();
  await new Promise(r => setTimeout(r, 450));
  capture();
  await new Promise(r => setTimeout(r, 400));
  const im = new Image(); im.src = state.frames[state.frames.length - 1].url; await im.decode();
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0);
  const full = ctx.getImageData(0, 0, W, H).data;
  engine.process = orig;
  const cornerL = (() => { let l = 0, n = 0;
    for (let y = H - 60; y < H - 30; y++) for (let x = W - 120; x < W - 90; x++) { const i = (y * W + x) * 4; l += full[i] * .299 + full[i + 1] * .587 + full[i + 2] * .114; n++; }
    return Math.round(l / n); })();
  const lineAt = (yFrac) => {
    // The scene draws the line at x=300/1280, so track the run NEAREST that x. Light leaks
    // are switched off for this run (see above), so no warm blob can beat the real line —
    // and halation warms the line itself, which a chromatic filter would wrongly reject.
    // Grain noise produces short runs (<6px); the real line plus its blur tails stay long.
    const y = Math.round(H * yFrac);
    const want = Math.round(W * 300 / 1280);
    let best = null, mn = -1, mx = -1;
    const take = (a, b) => {
      const len = b - a + 1;
      if (len < 6) return;
      const c = (a + b) / 2, d = Math.abs(c - want);
      if (!best || d < best.dist) best = { min: a, max: b, spread: len, centre: c, dist: d };
    };
    for (let x = Math.round(W * 0.14); x <= Math.round(W * 0.36); x++) {
      const i = (y * W + x) * 4;
      const bright = full[i] * .299 + full[i + 1] * .587 + full[i + 2] * .114 > 150;
      if (bright) { if (mn < 0) mn = x; mx = x; }
      else if (mn >= 0) { take(mn, mx); mn = -1; }
    }
    if (mn >= 0) take(mn, mx);
    return best;
  };
  return JSON.stringify({ cornerL, top: lineAt(0.10), mid: lineAt(0.50), bot: lineAt(0.90) });`;

async function shoot(camId) {
  await send('Page.enable');
  await send('Page.navigate', { url: `${base}/index.html?cam=${camId}` });
  await new Promise(r => setTimeout(r, 3600));
  return JSON.parse(await evalIn(`(async () => { try { ${SCENE} } catch (e) { return JSON.stringify({ error: String(e) }); } })()`));
}

const t4 = await shoot('t4');
const lca = await shoot('lca');
console.log('t4:', JSON.stringify(t4));
console.log('lca:', JSON.stringify(lca));
const ok = [];
if (t4.error || lca.error) { console.log('FAIL boot', t4.error || lca.error); }
else {
  ok.push(lca.cornerL < t4.cornerL - 5 ? `PASS vignette: LC-A corner ${lca.cornerL} < T4 ${t4.cornerL}` : `FAIL vignette (${lca.cornerL} vs ${t4.cornerL})`);
  ok.push(lca.mid && t4.mid && lca.mid.spread > t4.mid.spread + 4 ? `PASS softness: LC-A line run ${lca.mid.spread}px > T4 ${t4.mid.spread}px` : `FAIL softness (${lca.mid?.spread} vs ${t4.mid?.spread})`);
  const pull = (s) => Math.max(Math.abs(s.mid.centre - s.top.centre), Math.abs(s.mid.centre - s.bot.centre));
  const pullL = pull(lca);
  const pullT = pull(t4);
  // Bodies ship rectilinear today (distortion 0 for every profile): the plastic fisheye
  // bulge read as warped buildings, so both bodies must keep a vertical line straight.
  // Grain splits runs asymmetrically, so a few px of tracking jitter is expected — a real
  // barrel bulge pulls the middle row tens of px away from the top and bottom rows.
  ok.push(pullL <= 6 && pullT <= 6 ? `PASS rectilinear: LC-A line drift ${pullL}px, T4 ${pullT}px (no bulge)` : `FAIL rectilinear (${pullL} vs ${pullT})`);
  console.log(ok.join('\n'));
}
ws.close(); proc.kill();
setTimeout(() => process.exit(0), 300);
