/* POCKETROLL 35 — film filter engine + camera-back UI
   Data source of truth: assets/cameras.json + assets/films.json (material library). */
'use strict';

const $ = (id) => document.getElementById(id);
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const hexToRgb = (h) => ({ r: parseInt(h.slice(1,3),16)/255, g: parseInt(h.slice(3,5),16)/255, b: parseInt(h.slice(5,7),16)/255 });

/* numeric camera-side emulation derived from cameras.json character fields */
const CAMERA_CAST = {
  trip35:     { gain:[1.03,1.0,0.93] },
  instamatic: { gain:[1.06,1.0,0.84] },
  af35m:      { gain:[0.98,1.0,1.05], flash:true },
  l35af:      { gain:[0.97,1.0,1.04] },
  t4:         { gain:[1.02,1.0,0.97], micro:true },
  contaxt2:   { gain:[1.0,1.0,1.0] },
  mju2:       { gain:[0.98,1.0,1.03] },
  gr1v:       { gain:[1.0,1.0,1.0] },
  tc01:       { gain:[1.02,1.0,0.96] },
  lca:        { gain:[1.10,1.02,0.88], leaks:true },
};

class FilmEngine {
  constructor(canvas){ this.canvas = canvas; this.ctx = canvas.getContext('2d', {willReadFrequently:true}); }
  setCombo(cam, film){
    this.cam = cam; this.film = film;
    if (!film) return;
    this.lut = this.buildLUT(film);
    this.noise = this.makeNoise(film.filter_params);
  }
  buildLUT(f){
    const p = f.filter_params;
    const curve = new Uint8Array(256);
    const wH = new Float32Array(256), wS = new Float32Array(256);
    this.tintH = hexToRgb(p.tint_highlights); this.tintS = hexToRgb(p.tint_shadows);
    // Color Science modules: white balance response, exposure response, channel-mix matrix
    this.wb = p.wb || [1, 1, 1];
    this.exposure = Math.pow(2, p.exposure || 0);
    this.matrix = p.rgb_matrix || [1,0,0, 0,1,0, 0,0,1];
    const sh = p.shadows ?? 0, hi = p.highlights ?? 0;
    for (let i = 0; i < 256; i++){
      let v = i/255;
      // midtone slope (film gamma)
      v = clamp01(0.5 + (v - 0.5) * p.contrast);
      // toe: characteristic-curve shadow response — crush (slide films) or lift (negative fade)
      if (sh > 0) v = clamp01(v - sh * Math.max(0, 0.30 - v) * 0.85);
      if (sh < 0) v = clamp01(v + (-sh) * Math.pow(1 - v, 2));
      v = clamp01(v + (p.black_lift || 0) * Math.pow(1 - v, 2));
      // shoulder: highlight rolloff — negatives roll off soft, slides clip harder
      if (hi > 0) v = clamp01(v - hi * Math.max(0, v - 0.72) * 0.55);
      if (hi < 0) v = clamp01(v + (-hi) * Math.max(0, v - 0.70) * 0.4);
      // white point compression
      v *= p.white_point;
      curve[i] = Math.round(v * 255);
      // split-tone tint weights: highlights & shadows
      wH[i] = Math.pow(clamp01((v - 0.62)/0.38), 1.3) * 0.45;
      wS[i] = Math.pow(clamp01((0.36 - v)/0.36), 1.3) * 0.55;
    }
    return { curve, wH, wS };
  }
  makeNoise(p){
    // 256×256 luminance noise field, sampled per-pixel so grain can follow
    // the printed luminance and scale with output resolution (film grain is a
    // fixed physical size on film: scans at higher res show finer grain per px).
    const arr = new Uint8Array(256 * 256);
    for (let i = 0; i < arr.length; i++) arr[i] = 128 + Math.round((Math.random()*2 - 1) * 90);
    return arr;
  }
  process(src, srcW, srcH, opts){
    if (!this.film) { this.ctx.drawImage(src, 0, 0, srcW, srcH); return; }
    const p = this.film.filter_params;
    const cast = (this.cam && CAMERA_CAST[this.cam.id]) || { gain:[1,1,1] };
    // on-camera electronic flash at the moment of capture: brightens & slightly cools
    // the subject center, desaturates the lit area, and lets the background drop deeper.
    const flash = !!(opts && opts.flash);
    const w = this.canvas.width, h = this.canvas.height;
    // lens softness from camera character
    const blur = (1 - (this.cam?.camera_character?.sharpness ?? 1)) * 2.2;
    this.ctx.filter = blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : 'none';
    this.ctx.drawImage(src, 0, 0, srcW, srcH);
    this.ctx.filter = 'none';

    // pixel pass — full film pipeline:
    // color temperature (wb gains) + lens cast + exposure response
    // → tone curve (toe / midtone gamma / shoulder) → chroma scaled by saturation
    // → RGB color-response matrix → split-tone tint → luminance-dependent film grain
    const img = this.ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const { curve, wH, wS } = this.lut;
    const sat = p.saturation;
    const ex = this.exposure;
    const g0 = this.wb[0]*cast.gain[0]*ex, g1 = this.wb[1]*cast.gain[1]*ex, g2 = this.wb[2]*cast.gain[2]*ex;
    const m = this.matrix;
    const hR = this.tintH.r*255, hG = this.tintH.g*255, hB = this.tintH.b*255;
    const sR = this.tintS.r*255, sG = this.tintS.g*255, sB = this.tintS.b*255;
    const grainOn = p.grain_strength > 0;
    // grain follows the stock: higher-ISO films have physically bigger grains,
    // underexposure makes grain more visible in shadows (like a pushed print)
    const isoScale = Math.min(1.6, Math.max(0.8, Math.pow((p.iso || 100) / 100, 0.32)));
    const cell = Math.max(1, (p.grain_size || 1) * (w / 720) * 1.7 * isoScale);
    const ampMul = 0.75 + 0.5 * isoScale + Math.max(0, -(p.exposure || 0)) * 0.3;
    const grainColor = p.grain_color !== false; // B&W stocks get pure luminance grain
    const noise = this.noise;
    let col = 0, row = 0;
    for (let i = 0; i < d.length; i += 4){
      let fg = 1, satEff = sat, cool = 0;
      if (flash){
        const dx = col / w - 0.5, dy = row / h - 0.54;
        const fm = Math.exp(-(dx * dx + dy * dy) / 0.14); // flash coverage: center-weighted
        fg = 0.86 + 0.68 * fm;               // subject pops, background drops deeper
        satEff = sat * (1 - 0.26 * fm);      // electronic flash neutralises the lit area
        cool = 0.05 * fm;                    // ~5500K flash: slight cool cast on lit parts
      }
      const r = d[i] * g0 * fg, g = d[i+1] * g1 * fg, b = d[i+2] * g2 * fg * (1 + cool);
      const v = Math.min(255, (r*0.299 + g*0.587 + b*0.114) | 0);
      const base = curve[v];
      const wh = wH[v], ws = wS[v], keep = 1 - wh - ws;
      const cr = (r - v) * satEff, cg = (g - v) * satEff, cb = (b - v) * satEff;
      const rr0 = (base + cr) * keep, rg0 = (base + cg) * keep, rb0 = (base + cb) * keep;
      let rr = rr0*m[0] + rg0*m[1] + rb0*m[2];
      let gg = rr0*m[3] + rg0*m[4] + rb0*m[5];
      let bb = rr0*m[6] + rg0*m[7] + rb0*m[8];
      rr = clamp01((rr + hR*wh + sR*ws) / 255) * 255;
      gg = clamp01((gg + hG*wh + sG*ws) / 255) * 255;
      bb = clamp01((bb + hB*wh + sB*ws) / 255) * 255;
      if (grainOn){
        // grain amplitude follows printed luminance: peaks in midtones/shadows,
        // fades out in blown highlights — like real grain on a scan
        const vo = (rr*0.299 + gg*0.587 + bb*0.114) / 255;
        const bell = 1 - clamp01(Math.abs(vo - 0.42) / 0.45);
        const amp = p.grain_strength * (0.30 + 0.80 * bell) * 34 * ampMul;
        const nx = (col / cell | 0) & 255, ny = (row / cell | 0) & 255;
        const nL = (noise[ny*256 + nx] - 128) / 90;
        if (grainColor){ // mostly luminance grain + a little chromatic noise
          const nr = (noise[((ny+53)&255)*256 + ((nx+91)&255)] - 128) / 90;
          const ng = (noise[((ny+107)&255)*256 + ((nx+37)&255)] - 128) / 90;
          const nb = (noise[((ny+171)&255)*256 + ((nx+13)&255)] - 128) / 90;
          rr += nL*amp + nr*amp*0.35; gg += nL*amp + ng*amp*0.35; bb += nL*amp + nb*amp*0.35;
        } else { rr += nL*amp; gg += nL*amp; bb += nL*amp; }
      }
      d[i] = rr; d[i+1] = gg; d[i+2] = bb;
      col++; if (col >= w){ col = 0; row++; }
    }
    this.ctx.putImageData(img, 0, 0);

    // halation: bright pass blurred & tinted, additive; bloom scales with resolution
    const hal = (p.halation || 0) + (this.cam?.camera_character?.halation_bias ?? 0) * 0.4;
    if (hal > 0.03){
      const resScale = Math.max(1, w / 720);
      const bw = Math.max(1, w>>2), bh = Math.max(1, h>>2);
      const bc = document.createElement('canvas'); bc.width = bw; bc.height = bh;
      const bctx = bc.getContext('2d');
      bctx.filter = `contrast(2.4) brightness(1.35) blur(${((3 + hal*6) * resScale).toFixed(1)}px)`;
      bctx.drawImage(this.canvas, 0, 0, bw, bh);
      bctx.filter = 'none';
      bctx.globalCompositeOperation = 'multiply';
      bctx.fillStyle = '#ff9a6a'; bctx.fillRect(0,0,bw,bh);
      this.ctx.globalCompositeOperation = 'lighter';
      this.ctx.globalAlpha = hal * 0.35;
      this.ctx.drawImage(bc, 0, 0, w, h);
      this.ctx.globalAlpha = 1; this.ctx.globalCompositeOperation = 'source-over';
    }

    // grain is handled inside the pixel pass (luminance-dependent, resolution-aware)

    // vignette: camera + film combined
    const vig = clamp01((p.vignette||0) + (this.cam?.camera_character?.vignette ?? 0));
    if (vig > 0.02){
      const grd = this.ctx.createRadialGradient(w/2, h/2, Math.min(w,h)*0.35, w/2, h/2, Math.max(w,h)*0.72);
      grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, `rgba(0,0,0,${(vig*0.85).toFixed(2)})`);
      this.ctx.fillStyle = grd; this.ctx.fillRect(0, 0, w, h);
    }

    // quirk overlays
    if (cast.leaks){ // LC-A light leaks
      const grd = this.ctx.createLinearGradient(w, 0, w*0.4, h*0.6);
      grd.addColorStop(0, 'rgba(255,120,40,0.30)'); grd.addColorStop(1, 'rgba(255,120,40,0)');
      this.ctx.globalCompositeOperation = 'screen'; this.ctx.fillStyle = grd; this.ctx.fillRect(0,0,w,h);
      this.ctx.globalCompositeOperation = 'source-over';
    }
    if (cast.flash){ // AF35M on-camera flash pop
      const grd = this.ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.min(w,h)*0.6);
      grd.addColorStop(0, 'rgba(255,245,230,0.22)'); grd.addColorStop(1, 'rgba(255,245,230,0)');
      this.ctx.globalCompositeOperation = 'screen'; this.ctx.fillStyle = grd; this.ctx.fillRect(0,0,w,h);
      this.ctx.globalCompositeOperation = 'source-over';
    }
  }
}

/* LCD finder readout per camera (plausible programmed values, UI prop only) */
const CAMERA_HUD = {
  trip35:     { flash: 'off',  shutter: 'PRGM 1/60' },
  instamatic: { flash: 'on',   shutter: 'PRGM 1/60' },
  af35m:      { flash: 'on',   shutter: 'PRGM' },
  l35af:      { flash: 'off',  shutter: 'PRGM' },
  t4:         { flash: 'none', shutter: '1/250' },
  contaxt2:   { flash: 'none', shutter: '1/250' },
  mju2:       { flash: 'none', shutter: '1/200' },
  gr1v:       { flash: 'none', shutter: '1/500' },
  tc01:       { flash: 'none', shutter: 'PRGM' },
  lca:        { flash: 'off',  shutter: '1/125' },
};

/* Light leaks: stray light seeping into the chamber between frames — probability
   & strength follow the film stock (cheap/expired stocks leak more) multiplied by
   the camera body (LC-A / cheap point-and-shoots leak through the door seal). */
const CAMERA_LEAK = { lca: 2.2, trip35: 1.4, instamatic: 1.2, af35m: 1.2, tc01: 1.3, t4: 0.45, contaxt2: 0.4, mju2: 0.45, gr1v: 0.4, l35af: 0.5 };

const OPTS_KEY = 'pocketroll-opts-v1';
function loadOpts(){ try{ return Object.assign({ date: false, flash: true }, JSON.parse(localStorage.getItem(OPTS_KEY)) || {}); }catch{ return { date: false, flash: true }; } }
function saveOpts(){ try{ localStorage.setItem(OPTS_KEY, JSON.stringify(state.opts)); }catch{} }

/* ---------- app state ---------- */
const state = { cameras: [], films: [], cam: null, film: null, shotsLeft: 36, frames: [], developed: false, rolls: [], battery: 92, opts: loadOpts(), sheet: null };
const vf = $('viewfinder');
const engine = new FilmEngine(vf);
let video = null, demoCanvas = null, usingDemo = false;

function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1800); }

/* LCD finder HUD: minimal by default (focus box + ISO), tap the finder for the
   full readout (flash / battery / shutter / EV) — like a real camera saving power. */
function renderHud(){
  const h = state.cam ? (CAMERA_HUD[state.cam.id] || { flash: 'none', shutter: 'PRGM' }) : { flash: 'none', shutter: '' };
  const fl = $('hudFlash');
  const capable = h.flash === 'on'; // only bodies with a built-in flash can fire one
  fl.style.display = capable ? '' : 'none';
  fl.className = 'vf-flash' + (capable && state.opts.flash ? ' on' : '');
  fl.textContent = '⚡';
  $('hudIso').textContent = state.film ? 'ISO ' + state.film.iso : 'no film';
  $('hudReadout').textContent = (h.shutter ? h.shutter : '—') + ' · +0.0 EV';
  $('hudBattFill').style.width = state.battery + '%';
  $('hudBattPct').textContent = state.battery + '%';
  $('hudBatt').classList.toggle('low', state.battery < 20);
}
function renderOpts(){
  $('optDate').classList.toggle('on', state.opts.date);
  const capable = state.cam ? CAMERA_HUD[state.cam.id]?.flash === 'on' : false;
  $('optFlash').classList.toggle('disabled', !capable);
  $('optFlash').classList.toggle('on', capable && state.opts.flash);
}

/* main-screen counters: FRAMES LEFT card + bezel EXP readout */
function renderCounter(){
  $('counter').textContent = String(state.shotsLeft).padStart(2, '0');
  $('expCount').textContent = state.shotsLeft + ' EXP';
}
/* the roll page owns everything about the current roll: develop appears only
   after shooting, the contact sheet only after developing (the main screen
   is just the shutter — feature entries never share its visual weight). */
function renderRollPage(){
  const has = state.frames.length > 0;
  $('rollStatus').textContent = state.developed ? 'roll developed · archived · load a fresh roll'
    : has ? `${state.frames.length} frames exposed · latent until developed`
    : state.shotsLeft === 0 ? 'roll finished · develop it' : `roll loaded · ${state.shotsLeft} frames left`;
  $('developRoll').style.display = has && !state.developed ? '' : 'none';
  $('developRoll').classList.toggle('ready', state.shotsLeft === 0 && has && !state.developed);
  $('sheetBtn').style.display = state.sheet ? '' : 'none';
  $('openRoll').classList.toggle('ready', state.shotsLeft === 0 && has && !state.developed);
  // standalone develop action on the main screen: shoot → develop, right here
  $('developMain').style.display = state.shotsLeft === 0 && has && !state.developed ? '' : 'none';
}

function demoScene(){
  // procedural fallback scene so filters can be tested without camera permission
  const c = document.createElement('canvas'); c.width = 1280; c.height = 960;
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0,0,0,600);
  sky.addColorStop(0,'#b8d4e8'); sky.addColorStop(1,'#f6e2c8');
  ctx.fillStyle = sky; ctx.fillRect(0,0,1280,600);
  ctx.fillStyle = '#ffd9a0'; ctx.beginPath(); ctx.arc(980,240,70,0,7); ctx.fill();
  ctx.fillStyle = '#31424d';
  for (let i=0;i<9;i++){ const x=i*150+20, hgt=120+Math.random()*260; ctx.fillRect(x,600-hgt,90,hgt); }
  ctx.fillStyle = '#20262e'; ctx.fillRect(0,600,1280,360);
  ctx.fillStyle = '#55616a'; ctx.fillRect(0,600,1280,8);
  // a bright highlight to show halation
  ctx.fillStyle = '#fff2d8'; ctx.beginPath(); ctx.arc(300,540,26,0,7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(60,700,120,18);
  return c;
}

async function initCamera(){
  try{
    // ask the sensor for its native resolution so exports are full-pixel, not 640×480
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video = document.createElement('video'); video.srcObject = stream; video.play();
    usingDemo = false;
  }catch(e){
    usingDemo = true;
    toast('camera unavailable · demo scene');
  }
}

function renderViewfinder(){
  const cw = previewW, ch = Math.round(previewW * 0.75);
  if (vf.width !== cw){ vf.width = cw; vf.height = ch; }
  if (usingDemo) engine.process(demoCanvas, demoCanvas.width, demoCanvas.height);
  else if (video && video.videoWidth) engine.process(video, video.videoWidth, video.videoHeight);
}
let frameMs = 16, previewW = 640;
function loop(){
  const t0 = performance.now();
  renderViewfinder();
  frameMs = frameMs * 0.8 + (performance.now() - t0) * 0.2;
  // graceful degradation on slow phones: lower preview res, keep the frame smooth
  if (frameMs > 60) previewW = 480; else if (frameMs < 30) previewW = 640;
  requestAnimationFrame(loop);
}

/* shutter ritual: mechanical click (WebAudio noise bursts through bandpass =
   mirror slap + snap) plus haptics where the device supports them. */
function shutterSound(){
  if (navigator.vibrate) navigator.vibrate([12, 40, 18]);
  try{
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const t = ac.currentTime;
    for (const [off, gain, freq] of [[0, 0.3, 1400], [0.07, 0.14, 700]]){
      const buf = ac.createBuffer(1, Math.round(ac.sampleRate * 0.06), ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2 - 1) * Math.exp(-i / (d.length * 0.22));
      const src = ac.createBufferSource(); src.buffer = buf;
      const bi = ac.createBiquadFilter(); bi.type = 'bandpass'; bi.frequency.value = freq;
      const g = ac.createGain(); g.gain.value = gain;
      src.connect(bi); bi.connect(g); g.connect(ac.destination);
      src.start(t + off);
    }
    setTimeout(() => ac.close(), 400);
  } catch(e){ /* silent on browsers without WebAudio */ }
}

/* ---------- capture ---------- */
function capture(){
  if (!state.film){ toast('load a film first'); return; }
  if (state.shotsLeft <= 0){ toast('roll finished · develop it'); return; }
  shutterSound();
  // focus box snaps to locked for a moment; battery sips down (flash shots draw more)
  const focus = $('hudFocus');
  focus.classList.add('lock'); setTimeout(() => focus.classList.remove('lock'), 350);
  const flashShot = state.opts.flash && CAMERA_HUD[state.cam?.id]?.flash === 'on';
  state.battery = Math.max(4, state.battery - (flashShot ? 2 : 1));
  renderHud();
  const cap = document.createElement('canvas');
  // export at the stream's native pixel size (cap guards 4K+ streams from huge pixel loops)
  const w = usingDemo ? 1280 : Math.min(2560, video.videoWidth || 1280);
  const h = usingDemo ? 960 : Math.round(w * (video.videoHeight / (video.videoWidth || 1)));
  cap.width = w; cap.height = h;
  const tmp = new FilmEngine(cap); tmp.setCombo(state.cam, state.film);
  tmp.process(usingDemo ? demoCanvas : video, usingDemo ? demoCanvas.width : video.videoWidth, usingDemo ? demoCanvas.height : video.videoHeight, { flash: flashShot });
  const cctx = cap.getContext('2d');
  rollLeak(cctx, w, h);            // per-frame chance, tuned by film stock + body
  if (state.opts.date) stampDate(cctx, w, h);
  const url = cap.toDataURL('image/jpeg', 0.9);
  state.frames.push({ url });
  state.shotsLeft--;
  renderCounter();
  renderStrip();
  const g = $('stripFrames'); g.classList.remove('advance'); void g.offsetWidth; g.classList.add('advance'); // film-advance tick
  scrollStripToLast();
  renderRollPage();
  if (state.shotsLeft === 0) toast('frame 36 exposed · open ROLL to develop');
}
/* develop an imported photo through the loaded film — treated as a lab-developed
   scan (does not consume a frame from the roll; the roll counter stays honest). */
async function importPhoto(file){
  if (!state.film){ toast('load a film first'); return; }
  const url = URL.createObjectURL(file);
  const img = new Image(); img.src = url;
  try { await img.decode(); } catch { toast('could not read that image'); URL.revokeObjectURL(url); return; }
  const cap = document.createElement('canvas');
  const w = Math.min(2560, img.naturalWidth);
  const h = Math.round(w * img.naturalHeight / img.naturalWidth);
  cap.width = w; cap.height = h;
  const tmp = new FilmEngine(cap); tmp.setCombo(state.cam, state.film);
  tmp.process(img, img.naturalWidth, img.naturalHeight);
  if (state.opts.date) stampDate(cap.getContext('2d'), w, h); // lab print stamp on scans too
  const out = cap.toDataURL('image/jpeg', 0.9);
  state.frames.push({ url: out, developed: true }); // loose-frame scan: lab-developed on arrival
  URL.revokeObjectURL(url);
  renderStrip();
  scrollStripToLast();
  toast('loose frame developed · does not consume the roll');
}
/* ---------- film roll system ----------
   Exposed frames stay LATENT (dark, numbered, edge marks) until the whole roll
   is developed — the ritual the user asked for; tapping a latent frame only gives
   a brief preview pulse, never a full reveal. */
function renderStrip(){
  const g = $('stripFrames'); g.innerHTML = '';
  for (let i = 0; i < 36; i++){
    const el = document.createElement('div');
    const f = state.frames[i];
    const dev = f && (f.developed || state.developed); // developing the roll reveals every exposed frame
    el.className = 'frame' + (f ? (dev ? ' developed' : ' latent') : '');
    const num = document.createElement('span'); num.className = 'num'; num.textContent = String(i + 1).padStart(2, '0');
    el.appendChild(num);
    if (state.film){
      const edge = document.createElement('span'); edge.className = 'edge';
      edge.textContent = (state.film.brand.split(' ')[0] || state.film.brand).toUpperCase().slice(0, 7) + ' ' + state.film.iso;
      el.appendChild(edge);
    }
    if (f && dev){
      el.style.backgroundImage = `url(${f.url})`;
      el.title = `${state.film?.name || 'frame'} · frame ${i + 1} — tap to print`;
      el.onclick = () => download(f.url, i + 1);
    } else if (f){
      el.title = 'latent image · develop the roll to reveal';
      el.onclick = () => previewFrame(el, f.url);
    } else {
      el.title = `frame ${i + 1} · not exposed`;
    }
    g.appendChild(el);
  }
}
function previewFrame(el, url){
  el.style.backgroundImage = `url(${url})`;
  el.classList.add('preview');
  toast('latent preview · develop the roll to reveal');
  setTimeout(() => { el.classList.remove('preview'); el.style.backgroundImage = ''; }, 1250);
}
function scrollStripToLast(){
  const el = $('stripFrames').children[state.frames.length - 1];
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}
function download(url, n){
  const a = document.createElement('a'); a.href = url;
  a.download = `${(state.film?.id || 'frame')}_${String(n).padStart(2, '0')}.jpg`; a.click();
}
/* light leak: 1–2 warm red/orange seeps drawn only at exposure (never in the
   live finder — leaks happen when light sneaks past the door seal between frames) */
function rollLeak(ctx, w, h){
  const film = state.film;
  const prob = ((film?.leak_prob) ?? 0.12) * (CAMERA_LEAK[state.cam?.id] || 1);
  if (Math.random() > prob) return;
  const s = film?.leak_strength ?? 0.5;
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 1 + Math.floor(Math.random() * 2); k++){
    const x = Math.random() * w, y = Math.random() * h;
    const r = (0.25 + Math.random() * 0.5) * w;
    const hue = Math.random() < 0.55 ? '255,84,28' : '255,150,52';
    const grd = ctx.createRadialGradient(x, y, r * 0.08, x, y, r);
    grd.addColorStop(0, `rgba(${hue},${(0.38 * s).toFixed(2)})`);
    grd.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
  }
  ctx.globalCompositeOperation = 'source-over';
}
/* date stamp: retro orange LCD-back print, e.g. "26 11 '26" bottom-right */
function stampDate(ctx, w, h){
  const d = new Date();
  const txt = `${String(d.getDate()).padStart(2, '0')} ${String(d.getMonth() + 1).padStart(2, '0')} '${String(d.getFullYear()).slice(2)}`;
  ctx.font = `bold ${Math.round(w * 0.024)}px ui-monospace, monospace`;
  const tw = ctx.measureText(txt).width;
  ctx.shadowColor = 'rgba(255,120,40,.75)'; ctx.shadowBlur = w * 0.006;
  ctx.fillStyle = 'rgba(255,138,61,.92)';
  ctx.fillText(txt, w - tw - w * 0.035, h - h * 0.045);
  ctx.shadowBlur = 0;
}
/* contact sheet: lab-style proof sheet of the developed roll — film base with
   sprocket holes, edge printing, frames in a grid with orange frame numbers */
async function buildSheet(urls){
  const imgs = [];
  for (const u of urls){
    const im = new Image(); im.src = u;
    try { await im.decode(); imgs.push(im); } catch { /* skip unreadable frame */ }
  }
  if (!imgs.length) return null;
  const cols = 3, cw = 340, ch = Math.round(cw * 0.66), gap = 24, edge = 46;
  const rows = Math.ceil(imgs.length / cols);
  const c = document.createElement('canvas');
  c.width = cols * cw + edge * 2; c.height = rows * (ch + gap) + edge * 2 + 26;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#17110c'; ctx.fillRect(0, 0, c.width, c.height); // film base
  ctx.fillStyle = '#c9bda6';
  for (let x = edge; x < c.width - edge - 26; x += 64){ ctx.fillRect(x, 10, 26, 16); ctx.fillRect(x, c.height - 26, 26, 16); }
  const f = state.film;
  ctx.fillStyle = '#c9a45a'; ctx.font = 'bold 20px ui-monospace, monospace';
  ctx.fillText(`POCKETROLL LAB · ${(f ? f.brand + ' ' + f.name + ' ' + f.iso : 'CONTACT PRINT').toUpperCase()} · ${(state.cam?.model || 'SCAN').toUpperCase()}`, edge, edge - 12);
  imgs.forEach((im, i) => {
    const x = edge + (i % cols) * (cw + gap), y = edge + Math.floor(i / cols) * (ch + gap) + 6;
    ctx.fillStyle = '#000'; ctx.fillRect(x - 3, y - 3, cw + 6, ch + 6);
    ctx.drawImage(im, x, y, cw, ch);
    ctx.fillStyle = '#ff8a3d'; ctx.font = 'bold 15px ui-monospace, monospace';
    ctx.fillText(String(i + 1).padStart(2, '0'), x + 6, y + ch + 15);
  });
  return c.toDataURL('image/jpeg', 0.88);
}
function backDoor(){
  if (state.frames.length && !state.developed){
    // opening the door on an undeveloped roll fogs the exposed frames — real and ruthless
    state.frames = []; renderStrip();
    $('counter').textContent = '—'; $('expCount').textContent = '0 EXP';
    $('openRoll').classList.remove('ready');
    $('rollStatus').textContent = 'door opened · exposed frames fogged';
    $('developRoll').style.display = 'none';
    toast('oops — light fogged the undeveloped roll');
  } else {
    state.frames = []; state.developed = false; state.sheet = null; renderStrip();
    $('counter').textContent = '—'; $('expCount').textContent = '0 EXP';
    $('openRoll').classList.remove('ready');
    $('rollStatus').textContent = 'empty spool out · load a fresh roll';
    $('developRoll').style.display = 'none'; $('sheetBtn').style.display = 'none';
    toast('empty spool out');
  }
  const g = $('stripFrames'); g.classList.remove('pullout'); void g.offsetWidth; g.classList.add('pullout'); // spool pulls out of the opened door
  if (navigator.vibrate) navigator.vibrate([30, 80, 30, 80, 30]); // motor-sputter
}
function developRoll(){
  if (!state.frames.length){ toast('no exposed frames to develop'); return; }
  if (state.developed){ toast('this roll is already developed'); return; }
  const mask = $('devMask'), step = $('devStep'), bar = $('devBar');
  mask.classList.add('on');
  const phases = [['in developer · 68°F', 30], ['stop bath', 55], ['fixer', 80], ['wash · drying', 100]];
  let i = 0;
  (function next(){
    if (i < phases.length){ step.textContent = phases[i][0]; bar.style.width = phases[i][1] + '%'; setTimeout(next, 950); i++; }
    else finish();
  })();
  async function finish(){
    mask.classList.remove('on'); bar.style.width = '0';
    state.developed = true;
    renderStrip();
    [...$('stripFrames').children].forEach((el, idx) => {
      if (el.className.includes('developed')){ el.style.animationDelay = (idx * 0.045) + 's'; el.classList.add('reveal'); }
    });
    renderRollPage(); // the develop action disappears the moment the photos appear
    ding();
    toast('roll developed · tap frames to print');
    // quiet wrap-up: archive shelf + lab contact sheet land a few seconds later
    await archiveRoll();
    const sheet = await buildSheet(state.frames.map(f => f.url));
    if (sheet) state.sheet = sheet;
    renderRollPage();
    toast('archived · contact sheet ready');
  }
}
function ding(){ // darkroom timer bell when the roll comes out of the fixer
  try{
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(); const g = ac.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.12, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.5);
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.5);
    setTimeout(() => ac.close(), 650);
  } catch(e){ /* silent */ }
}
/* ---------- film archive (localStorage shelf, downscaled contact prints) ---------- */
const ARCHIVE_KEY = 'pocketroll-archive-v1';
function loadArchives(){ try{ state.rolls = JSON.parse(localStorage.getItem(ARCHIVE_KEY)) || []; } catch{ state.rolls = []; } }
function saveArchives(){
  try{ localStorage.setItem(ARCHIVE_KEY, JSON.stringify(state.rolls.slice(0, 6))); }
  catch(e){ state.rolls = state.rolls.slice(0, 3); try{ localStorage.setItem(ARCHIVE_KEY, JSON.stringify(state.rolls)); } catch{} }
}
function thumbOf(url){
  return new Promise(res => {
    const img = new Image(); img.src = url;
    img.onload = () => {
      const c = document.createElement('canvas');
      const w = Math.min(320, img.naturalWidth);
      c.width = w; c.height = Math.round(w * img.naturalHeight / img.naturalWidth);
      c.getContext('2d').drawImage(img, 0, 0, w, c.height);
      res(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => res(url);
  });
}
async function archiveRoll(){
  const thumbs = [];
  for (const f of state.frames) thumbs.push(await thumbOf(f.url));
  state.rolls.unshift({
    id: Date.now(),
    film: state.film ? `${state.film.brand} ${state.film.name}` : 'unknown stock',
    cam: state.cam ? `${state.cam.brand} ${state.cam.model}` : 'scan only',
    date: new Date().toISOString(),
    frames: thumbs,
  });
  saveArchives();
  renderArchive();
}
function renderArchive(){
  const a = $('archive'); a.innerHTML = '';
  state.rolls.forEach(r => {
    const el = document.createElement('div'); el.className = 'roll-card';
    const d = new Date(r.date);
    el.innerHTML = `<div class="meta"><span>${r.film} · ${r.frames.length} frames</span><span class="sub">${r.cam} · ${d.toLocaleDateString()}</span></div>`
      + `<div class="mini">${r.frames.slice(0, 8).map(u => `<img src="${u}" alt="">`).join('')}</div>`;
    el.onclick = () => openRoll(r);
    a.appendChild(el);
  });
}
function openRoll(r){
  $('rollTitle').textContent = `${r.film} · ${r.frames.length} frames`;
  const grid = $('rollGrid'); grid.innerHTML = '';
  r.frames.forEach((u, i) => {
    const img = document.createElement('img'); img.src = u;
    img.title = `frame ${i + 1} · tap to download`;
    img.onclick = () => { const a = document.createElement('a'); a.href = u; a.download = `roll_${r.id}_${i + 1}.jpg`; a.click(); };
    grid.appendChild(img);
  });
  $('rollViewer').classList.add('open');
}

/* ---------- loading gear ---------- */
function loadFilm(f){
  state.film = f; state.shotsLeft = 36;
  state.frames = []; state.developed = false;
  engine.setCombo(state.cam, f);
  $('vfFilm').textContent = f.name.toUpperCase();
  $('filmLine').textContent = 'FILM · ' + f.name.toUpperCase();
  renderCounter();
  $('openRoll').classList.remove('ready');
  state.sheet = null;
  renderStrip();
  const g = $('stripFrames'); g.classList.remove('slidein'); void g.offsetWidth; g.classList.add('slidein'); // film threading in
  $('stripFrames').scrollLeft = 0;
  renderRollPage();
  renderHud();
  toast(`loading roll · ${f.name}`);
}
function loadCamera(c){
  state.cam = c;
  engine.setCombo(c, state.film);
  $('camModel').textContent = c.model.toUpperCase();
  renderHud();
  renderOpts();
  toast('camera swapped — roll untouched');
}

/* ---------- modals ---------- */
function buildLists(){
  const cl = $('camList'); cl.innerHTML = '';
  state.cameras.forEach(c => {
    const el = document.createElement('div');
    el.className = 'item' + (state.cam?.id === c.id ? ' active' : '');
    el.innerHTML = `<div><div class="t">${c.brand} ${c.model}</div><div class="d">${c.year} · ${c.lens.focal_mm}mm ${c.lens.aperture} · ${c.vibe}</div></div><span class="badge">${c.format.includes('126') ? '126 cartridge' : '135'}</span>`;
    el.onclick = () => { loadCamera(c); buildLists(); $('settingsModal').classList.remove('open'); };
    cl.appendChild(el);
  });
  const fl = $('filmList'); fl.innerHTML = '';
  state.films.forEach(f => {
    const el = document.createElement('div');
    el.className = 'item' + (state.film?.id === f.id ? ' active' : '');
    const typeTag = f.type === 'bw' ? 'b&w' : f.type === 'slide' ? 'slide' : 'color neg';
    el.innerHTML = `<div><div class="t">${f.brand} ${f.name}</div><div class="d">${f.iso} · ${typeTag} · ${f.story}</div></div><span class="badge${f.status.startsWith('disc') ? ' heritage' : ''}">${f.status.startsWith('disc') ? 'heritage' : 'in production'}</span>`;
    el.onclick = () => { loadFilm(f); buildLists(); $('rollModal').classList.remove('open'); };
    fl.appendChild(el);
  });
}

/* ---------- wire up ---------- */
async function boot(){
  try{
    const [camRes, filmRes] = await Promise.all([fetch('assets/cameras.json'), fetch('assets/films.json')]);
    state.cameras = (await camRes.json()).cameras;
    state.films = (await filmRes.json()).films;
  }catch(e){
    toast('assets load failed: ' + (e && e.message ? e.message : String(e)));
    return;
  }
  buildLists();
  // show something immediately; real camera feed swaps in when granted
  demoCanvas = demoScene(); usingDemo = true;
  const q = new URLSearchParams(location.search);
  const cam = state.cameras.find(c => c.id === q.get('cam')) || state.cameras.find(c => c.id === 'trip35');
  const fil = state.films.find(f => f.id === q.get('film')) || state.films.find(f => f.id === 'gold200');
  if (q.get('date') === '1') state.opts.date = true; // test hook: force date stamp for this run
  loadCamera(cam);
  loadFilm(fil);
  if (q.get('hud') === 'full') $('hud').classList.add('full');
  $('vfStage').addEventListener('click', () => $('hud').classList.toggle('full'));
  renderHud();
  loadArchives(); renderArchive(); renderStrip();
  loop();
  // autoshot fires after the feed is settled (live camera if granted, demo otherwise)
  initCamera().then(() => {
    if (q.get('autoshot') === '1') {
      const shots = Math.max(1, Number(q.get('shots')) || 3); // ?shots=36 to expose a whole roll
      setTimeout(() => { for (let i = 0; i < shots; i++) capture(); }, 900);
    }
    if (q.get('dev') === '1') setTimeout(developRoll, 2600); // test hook: develop the roll after autoshots
  });

  $('shutter').onclick = capture;
  $('openRoll').onclick = () => $('rollModal').classList.add('open');
  $('openGallery').onclick = () => $('galleryModal').classList.add('open');
  $('openSettings').onclick = () => $('settingsModal').classList.add('open');
  $('doorBtn').onclick = backDoor;
  $('developRoll').onclick = developRoll;
  $('developMain').onclick = developRoll;
  $('sheetBtn').onclick = () => { if (state.sheet) download(state.sheet, 'sheet'); else toast('develop a roll first'); };
  $('optDate').onclick = () => { state.opts.date = !state.opts.date; saveOpts(); renderOpts(); toast(state.opts.date ? "date stamp on · prints stamped at exposure" : 'date stamp off'); };
  $('optFlash').onclick = () => {
    if (!state.cam || CAMERA_HUD[state.cam.id]?.flash !== 'on'){ toast('this body has no built-in flash'); return; }
    state.opts.flash = !state.opts.flash; saveOpts(); renderHud(); renderOpts();
    toast(state.opts.flash ? 'flash on · fires at the shutter' : 'flash off');
  };
  $('loadPhoto').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) importPhoto(f); e.target.value = ''; };
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.remove('open'));
  // test hook: ?page=roll|gallery|settings opens that page directly
  const page = q.get('page');
  if (page === 'roll') $('rollModal').classList.add('open');
  if (page === 'gallery') $('galleryModal').classList.add('open');
  if (page === 'settings') $('settingsModal').classList.add('open');
  // spacebar is the shutter — but never while a page (roll/gallery/settings) is open
  document.addEventListener('keydown', (e) => { if (e.code === 'Space' && !document.querySelector('.modal.open')) { e.preventDefault(); capture(); } });
}
window.FilmEngine = FilmEngine;
window.CAMERA_CAST = CAMERA_CAST;
if (document.getElementById('viewfinder')) boot();
