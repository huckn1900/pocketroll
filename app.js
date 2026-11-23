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
  distMap(w, h, d){
    // barrel coefficient: dest pixel samples a src point pulled toward centre;
    // edges stay pinned (no gaps), the centre magnifies — plastic wide-angle look
    const key = w + 'x' + h + ':' + d.toFixed(3);
    if (this._dm && this._dm.key === key) return this._dm.idx;
    const idx = new Uint32Array(w * h);
    for (let y = 0; y < h; y++){
      const v = (y / h) * 2 - 1;
      const sv = 1 - d * (1 - v * v);
      for (let x = 0; x < w; x++){
        const u = (x / w) * 2 - 1;
        const s = sv * (1 - d * (1 - u * u));
        let sx = (u * s * 0.5 + 0.5) * w, sy = (v * s * 0.5 + 0.5) * h;
        sx = sx < 0 ? 0 : sx > w - 1 ? w - 1 : sx | 0;
        sy = sy < 0 ? 0 : sy > h - 1 ? h - 1 : sy | 0;
        idx[y * w + x] = sy * w + sx;
      }
    }
    this._dm = { key, idx };
    return idx;
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
    // analysis/tests need the lens and colour science without the random light leaks the
    // cheap bodies seep every frame; the app itself never passes this.
    const noLeak = !!(opts && opts.noLeak);
    const w = this.canvas.width, h = this.canvas.height;
    // lens softness from camera character — scaled with resolution, so a plastic
    // lens stays soft at export size while sharp primes (T*, GR) never blur
    const blur = (1 - (this.cam?.camera_character?.sharpness ?? 1)) * (2.0 + w / 420);
    this.ctx.filter = blur > 0.35 ? `blur(${blur.toFixed(1)}px)` : 'none';
    this.ctx.drawImage(src, 0, 0, srcW, srcH);
    this.ctx.filter = 'none';

    // pixel pass — full film pipeline:
    // color temperature (wb gains) + lens cast + exposure response
    // → tone curve (toe / midtone gamma / shoulder) → chroma scaled by saturation
    // → RGB color-response matrix → split-tone tint → luminance-dependent film grain
    const img = this.ctx.getImageData(0, 0, w, h);
    const d = img.data;
    // lens distortion: every body ships rectilinear today (distortion 0 in cameras.json —
    // the user asked for the plastic fisheye bulge gone, straight lines stay straight).
    // The map stays available for a future wide-angle pack that opts in with a small value;
    // sampling map is cached per canvas size + coefficient
    const dist = this.cam?.camera_character?.distortion ?? 0;
    if (dist > 0.02){
      const idx = this.distMap(w, h, dist);
      const out = new Uint8ClampedArray(d.length);
      for (let i = 0, p = 0; i < d.length; i += 4, p++){
        const s = idx[p] * 4;
        out[i] = d[s]; out[i + 1] = d[s + 1]; out[i + 2] = d[s + 2]; out[i + 3] = d[s + 3];
      }
      d.set(out);
    }
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
    // (iso lives at the film profile top level; filter_params.iso is legacy)
    const isoEff = this.film.iso || p.iso || 100;
    const isoScale = Math.min(1.6, Math.max(0.8, Math.pow(isoEff / 100, 0.32)));
    const cell = Math.max(1, (p.grain_size || 1) * (w / 720) * 1.7 * isoScale);
    const ampMul = 0.75 + 0.5 * isoScale + Math.max(0, -(p.exposure || 0)) * 0.3;
    const grainColor = p.grain_color !== false; // B&W stocks get pure luminance grain
    const noise = this.noise;
    const fl = this.cam?.camera_character?.flash || {};
    const fGain = fl.gain ?? 0.68, fSpread = fl.spread ?? 0.14;
    let col = 0, row = 0;
    for (let i = 0; i < d.length; i += 4){
      let fg = 1, satEff = sat, cool = 0;
      if (flash){
        const dx = col / w - 0.5, dy = row / h - 0.54;
        // flash coverage follows the body: hot centre + hard falloff (AF-35M type)
        // vs flat wide wash (Instamatic cube) — same film, different light
        const fm = Math.exp(-(dx * dx + dy * dy) / fSpread);
        fg = 0.86 + fGain * fm;              // subject pops, background drops deeper
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
    if (cast.leaks && !noLeak){ // LC-A light leaks
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
function loadOpts(){ try{ return Object.assign({ date: false, flash: true, facing: 'environment' }, JSON.parse(localStorage.getItem(OPTS_KEY)) || {}); }catch{ return { date: false, flash: true, facing: 'environment' }; } }
function saveOpts(){ try{ localStorage.setItem(OPTS_KEY, JSON.stringify(state.opts)); }catch{} }

/* ---------- app state ---------- */
/* The roll in the camera is an object with an identity, not a scratch array: `rollId` is
   the record persisted to IndexedDB on every exposure, and `scans` is separate data — a
   scan is processed by the film, it never consumes a frame of the roll. */
const state = { cameras: [], films: [], cam: null, film: null, shotsLeft: 36, frames: [], scans: [],
  rollId: null, developed: false, rolls: [], battery: 92, opts: loadOpts(), sheet: null, persisted: false };
const vf = $('viewfinder');
const engine = new FilmEngine(vf);
/* The modules below are loaded as plain scripts before this file and share one global
   scope: storage/database + current-roll + archive + backup, film/roll-manager +
   development, camera/camera-manager + capture. app.js owns the engine, the state object
   and every renderer — the modules own device and data behaviour. `pendingFilm` is the
   preview's pending choice, `pendingBackup` lives in storage/backup.js. */
let pendingFilm = null;

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
  // no roll in the camera reads as a blank counter, the way a real camera does
  $('counter').textContent = state.rollId ? String(state.shotsLeft).padStart(2, '0') : '—';
  $('expCount').textContent = state.rollId ? state.shotsLeft + ' EXP' : '0 EXP';
}
/* the roll page owns everything about the current roll: develop appears only
   after shooting, the contact sheet only after developing (the main screen
   is just the shutter — feature entries never share its visual weight). */
function renderRollPage(){
  const has = state.frames.length > 0;
  $('rollStatus').textContent = isDeveloping ? 'in the developer · wait for the fixer'
    : state.developed ? 'roll developed · archived · load a fresh roll'
    : !state.rollId ? 'no roll in the camera · load a film'
    : has ? `${state.frames.length} frames exposed · latent until developed`
    : state.shotsLeft === 0 ? 'roll finished · develop it' : `roll loaded · ${state.shotsLeft} frames left`;
  $('developRoll').style.display = has && !state.developed ? '' : 'none';
  $('developRoll').disabled = isDeveloping;
  $('developRoll').classList.toggle('ready', !!state.rollId && has && state.shotsLeft === 0 && !state.developed);
  $('sheetBtn').style.display = state.sheet ? '' : 'none';
  $('openRoll').classList.toggle('ready', !!state.rollId && has && state.shotsLeft === 0 && !state.developed);
  // standalone develop action on the main screen: shoot → develop, right here
  $('developMain').style.display = !!state.rollId && has && state.shotsLeft === 0 && !state.developed ? '' : 'none';
  $('developMain').disabled = isDeveloping;
}

/* sleep is a shared util: the developer phases and the preview both wait on it. */
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

let vfAspect = 0;
function renderViewfinder(){
  // show the FULL frame, never crop or squash: canvas matches source aspect,
  // and the stage's aspect follows the sensor so the LCD reads edge-to-edge
  const src = usingDemo ? demoCanvas : (video && video.videoWidth ? video : null);
  if (!src) return;
  const sw = src.width || video.videoWidth;
  const sh = src.height || video.videoHeight;
  if (!sw || !sh) return;
  const ar = sw / sh;
  // follow the sensor aspect, clamped to a sane LCD box (real compact LCDs ~4:3);
  // object-fit:contain keeps the FULL frame inside — never crop, never squash
  const clamped = Math.min(1.34, Math.max(0.72, ar));
  if (Math.abs(vfAspect - clamped) > 0.02){
    vfAspect = clamped;
    $('vfStage').style.aspectRatio = String(clamped);
  }
  const cw = previewW, ch = Math.max(2, Math.round(previewW * sh / sw));
  if (vf.width !== cw || vf.height !== ch){ vf.width = cw; vf.height = ch; }
  engine.process(src, sw, sh);
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

/* The shutter itself lives in camera/capture.js: the frame, the leak, the stamp, the
   thumbnail and the roll record it writes. What stays here is the lab scan path. */
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
  const out = cap.toDataURL('image/jpeg', 0.95);
  URL.revokeObjectURL(url);
  /* A scan is a print the lab processed, not an exposure: it goes in the SCAN shelf with
     its own record (which stock ran it), so a 36-frame roll stays a 36-frame roll and the
     counter never lies. The filmstrip only ever shows what the shutter actually exposed. */
  const scan = { id: 'scan-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    u: out, t: thumbFromCanvas(cap), date: Date.now(),
    cam: state.cam ? `${state.cam.brand} ${state.cam.model}` : 'unknown body',
    film: state.film ? `${state.film.brand} ${state.film.name}` : 'unknown stock',
    iso: state.film ? (state.film.iso || state.film.filter_params?.iso || null) : null };
  state.scans.unshift(scan);
  saveScan(scan);
  renderArchive();
  toast('lab scan · the roll count stays honest');
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
      // edge printing is what the film itself carries: an exposed frame keeps the stock it was
      // shot on, an unexposed cell shows the stock currently threaded
      const brand = (f && f.brand) || state.film.brand;
      const iso = (f && f.iso) != null ? f.iso : state.film.iso;
      const edge = document.createElement('span'); edge.className = 'edge';
      edge.textContent = (brand.split(' ')[0] || brand).toUpperCase().slice(0, 7) + ' ' + iso;
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
/* Exposure-time prints (light leak, date stamp) live in camera/capture.js; the darkroom run
   (back door, develop tank, bell, contact sheet) lives in film/development.js. Both are
   plain scripts in the same global scope, so the UI calls them by name as before. */
/* ---------- darkroom shelf UI ----------
   The data layer is split into storage/database.js (the device store), storage/current-roll.js
   (the roll in the camera), storage/archive.js (developed rolls, scans, whole-roll zip) and
   storage/backup.js (export, validation, plan, restore). app.js keeps the shelf UI only. */
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtDate(iso){ const d = new Date(iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
let archTab = 'rolls', favOnly = false;
function renderArchive(){
  const a = $('archive'); a.innerHTML = '';
  const t1 = $('tabRolls'), t2 = $('tabFrames'), t3 = $('tabScans'), chip = $('favChip');
  if (t1) t1.classList.toggle('on', archTab === 'rolls');
  if (t2) t2.classList.toggle('on', archTab === 'frames');
  if (t3) t3.classList.toggle('on', archTab === 'scans');
  if (chip) chip.classList.toggle('on', favOnly);
  /* A roll still in the camera is shown here too — the archive answers "what do I have",
     and a half-shot roll is something the user owns, not a missing photo. */
  const live = state.rollId && state.frames.length && !state.developed;
  if (live){
    const el = document.createElement('div'); el.className = 'roll-card incamera';
    el.innerHTML = `<div class="meta"><span>IN CAMERA</span>`
      + `<span class="sub">${esc(state.film ? state.film.name : 'a roll')}</span></div>`
      + `<div class="rollmeta">${state.frames.length} FRAMES LATENT · DEVELOP IT TO ARCHIVE</div>`
      + `<div class="mini">${state.frames.slice(0, 8).map(f => `<img src="${f.t || f.url}" alt="">`).join('')}</div>`;
    el.onclick = () => { $('galleryModal').classList.remove('open'); $('rollModal').classList.add('open'); };
    a.appendChild(el);
  }
  // an empty tab says so, but never over the roll that is still in the camera
  const note = t => { if (!live) a.insertAdjacentHTML('beforeend', `<div class="note">${t}</div>`); };
  if (archTab === 'scans') {
    if (!state.scans.length) { note('no lab scans yet — SCAN IN PHOTO runs a photo through the loaded film'); renderStorage(); return; }
    state.scans.forEach((s) => {
      const el = document.createElement('div'); el.className = 'framecell';
      el.innerHTML = `<img src="${s.t || s.u}" alt="">`
        + `<button class="dlbtn" title="download full scan">↓</button>`
        + `<div class="fmeta">SCAN · ${esc(s.film)}${s.iso ? ' · ISO ' + s.iso : ''} · ${fmtDate(s.date)}</div>`;
      el.querySelector('.dlbtn').onclick = (e) => { e.stopPropagation(); download(s.u, `scan_${s.id}`); };
      el.querySelector('img').onclick = () => openScan(s);
      a.appendChild(el);
    });
    renderStorage(); return;
  }
  if (archTab === 'rolls') {
    if (!state.rolls.length) { note('no rolls developed yet — shoot a full roll, then DEVELOP it'); renderStorage(); return; }
    state.rolls.forEach(r => {
      const el = document.createElement('div'); el.className = 'roll-card';
      const favs = r.frames.filter(f => f.fav).length;
      el.innerHTML = `<div class="meta"><span>${esc(r.film)} · ${r.frames.length} frames</span><span class="sub">${esc(r.cam)} · ${fmtDate(r.loadedAt)}</span></div>`
        + `<div class="rollmeta">LOADED ${fmtDate(r.loadedAt)} · DEVELOPED ${fmtDate(r.developedAt)} · STATUS DEVELOPED${r.iso ? ' · ISO ' + r.iso : ''}${favs ? ' · ★ ' + favs : ''}${r.notes ? ' · ' + esc(r.notes) : ''}</div>`
        + `<div class="mini">${r.frames.slice(0, 8).map(f => `<img src="${f.t}" alt="">`).join('')}</div>`;
      el.onclick = () => openRoll(r);
      a.appendChild(el);
    });
  } else {
    const rows = [];
    state.rolls.forEach(r => r.frames.forEach((f, i) => rows.push({ r, f, i })));
    const list = favOnly ? rows.filter(x => x.f.fav) : rows;
    if (!list.length) { note(favOnly ? 'no favorited frames yet — ★ marks a keeper' : 'no frames yet — develop a roll to see its prints'); renderStorage(); return; }
    list.forEach(x => {
      const el = document.createElement('div'); el.className = 'framecell';
      el.innerHTML = `<img src="${x.f.t}" alt="">`
        + `<button class="favbtn${x.f.fav ? ' on' : ''}" title="favorite">★</button>`
        + `<button class="dlbtn" title="download full frame">↓</button>`
        + `<div class="fmeta">${esc(x.r.film)} · FRAME ${x.i + 1} · ${fmtDate(x.r.loadedAt)}${x.f.fav ? ' · ★' : ''}</div>`;
      el.querySelector('.favbtn').onclick = async (e) => { e.stopPropagation(); x.f.fav = !x.f.fav; await updateRoll(x.r); renderArchive(); };
      el.querySelector('.dlbtn').onclick = (e) => { e.stopPropagation(); download(x.f.u, `roll_${x.r.id}_frame_${x.i + 1}`); };
      el.querySelector('img').onclick = () => openFrame(x.r, x.i);
      a.appendChild(el);
    });
  }
  renderStorage();
}
function openScan(s){
  $('rollTitle').textContent = `SCAN · ${s.film}`;
  $('rollMeta').innerHTML = `<div class="mrow"><span>SOURCE</span><span>imported print run through the film</span></div>`
    + `<div class="mrow"><span>FILM</span><span>${esc(s.film)}${s.iso ? ' · ISO ' + s.iso : ''}</span></div>`
    + `<div class="mrow"><span>BODY</span><span>${esc(s.cam)}</span></div>`
    + `<div class="mrow"><span>PROCESSED</span><span>${fmtDate(s.date)}</span></div>`
    + `<div class="mrow"><span>ROLL COUNT</span><span>not consumed — a scan is a lab print</span></div>`;
  const n = $('rollNotes'); if (n) { n.value = ''; }
  const z = $('zipBtn'); if (z) z.style.display = 'none';
  const grid = $('rollGrid'); grid.innerHTML = '';
  const img = document.createElement('img'); img.src = s.u;
  img.title = 'tap to download full-res scan';
  img.onclick = () => download(s.u, `scan_${s.id}`);
  grid.appendChild(img);
  $('rollViewer').classList.add('open');
}
async function renderStorage(){
  const el = $('storageNote'); if (!el) return;
  const frames = state.rolls.reduce((n, r) => n + (r.frames?.length || 0), 0);
  const counts = `${state.rolls.length} rolls · ${frames} frames · ${state.scans.length} scans`;
  let txt = `${counts} kept · survives refresh and offline`;
  const est = await storageEstimate(); // null when the browser cannot answer; we do not guess
  if (est) {
    const mb = v => Math.round((v || 0) / 1048576);
    txt = `${counts} · ~${mb(est.usage)} MB used of ~${mb(est.quota)} MB available · survives refresh and offline`;
  }
  if (navigator.storage && navigator.storage.persist && state.persisted) txt += ' · storage marked persistent';
  if (!db) txt += ' · device storage unavailable — export a backup to keep anything';
  el.textContent = txt;
}
/* Whole-roll zip export and the backup file are storage concerns — they live in
   storage/archive.js and storage/backup.js; this file only wires the buttons. */
function rollMetaBlock(r){
  return `<div class="mrow"><span>CAMERA</span><span>${esc(r.cam)}</span></div>`
    + `<div class="mrow"><span>FILM</span><span>${esc(r.film)}${r.iso ? ' · ISO ' + r.iso : ''}</span></div>`
    + `<div class="mrow"><span>FRAMES</span><span>${r.frames.length}</span></div>`
    + `<div class="mrow"><span>DATE LOADED</span><span>${fmtDate(r.loadedAt)}</span></div>`
    + `<div class="mrow"><span>DATE DEVELOPED</span><span>${fmtDate(r.developedAt)}</span></div>`
    + `<div class="mrow"><span>STATUS</span><span>${r.status.toUpperCase()}</span></div>`;
}
function openRoll(r){
  $('rollTitle').textContent = `${r.film} · ${r.frames.length} frames`;
  $('rollMeta').innerHTML = rollMetaBlock(r);
  const n = $('rollNotes');
  if (n) {
    n.value = r.notes || '';
    n.placeholder = 'roll notes — e.g. "Weekend in Toronto — Autumn 2026"';
    n.onchange = async () => { r.notes = n.value.trim(); await updateRoll(r); renderArchive(); toast('roll notes saved with the archive'); };
  }
  const z = $('zipBtn');
  if (z) { z.style.display = ''; z.onclick = async () => { downloadBytes(await rollZip(r), `roll_${r.id}.zip`); toast('roll exported as zip'); }; }
  const grid = $('rollGrid'); grid.innerHTML = '';
  r.frames.forEach((f, i) => {
    const img = document.createElement('img'); img.src = f.t;
    img.title = `frame ${i + 1} · tap to download full-res print`;
    img.onclick = () => download(f.u, `roll_${r.id}_${i + 1}`);
    grid.appendChild(img);
  });
  $('rollViewer').classList.add('open');
}
function openFrame(r, i){
  $('rollTitle').textContent = `FRAME ${i + 1} · ${r.film}`;
  $('rollMeta').innerHTML = rollMetaBlock(r)
    + `<div class="mrow"><span>THIS FRAME</span><span>${esc(r.cam)} · frame ${i + 1} of ${r.frames.length}</span></div>`;
  const n = $('rollNotes'); if (n) { n.value = r.notes || ''; n.onchange = async () => { r.notes = n.value.trim(); await updateRoll(r); renderArchive(); }; }
  const z = $('zipBtn'); if (z) z.style.display = 'none';
  const grid = $('rollGrid'); grid.innerHTML = '';
  const img = document.createElement('img'); img.src = r.frames[i].u;
  img.title = 'tap to download full-res print';
  img.onclick = () => download(r.frames[i].u, `roll_${r.id}_${i + 1}`);
  grid.appendChild(img);
  $('rollViewer').classList.add('open');
}

/* Loading gear: film/roll-manager.js owns applying stock and threading a new roll (with the
   lifecycle gate), camera/camera-manager.js owns swapping bodies and the sensor. */

/* ---------- modals ---------- */
/* ---------- web entitlement ----------
   The released free web demo keeps the classic five stocks and five bodies; Pro content is
   shown but locked, and the full library lives in the paid Pro APK (one-time, via Patreon).
   THIS BUILD IS A TEST BUILD: WEB_LICENSE='all' opens every finished stock so each stock's
   colour science can be tried and calibrated in the browser. Profiles keep their tier, so the
   business model is untouched — set it back to 'free' to re-lock the web demo to the free
   tier before this goes out to users. */
const WEB_LICENSE = 'all'; // 'free' = production gate · 'all' = every finished stock loadable
function entitled(f){ return WEB_LICENSE === 'all' || f.tier === 'free'; }
function proHint(){
  toast('PRO content · the full library is in the Pro APK — GET PRO in ⚙ Settings');
}

/* ---------- shelf availability semantics ----------
   Three states, never mixed: AVAILABLE (usable right now) / LOCKED (finished, needs
   the Pro APK — lock icon on the right, PRO tag next to the name only) / COMING SOON
   (still in development, not loadable). */
function filmCat(f){
  if (f.type === 'bw') return 'bw';
  if (f.type === 'motion_negative' || f.brand === 'Cinestill') return 'cinema';
  return 'color';
}
function filmState(f){
  if (f.status === 'coming') return 'soon';
  return entitled(f) ? 'avail' : 'lock';
}
const TYPE_TAG = { bw: 'b&w', slide: 'slide', motion_negative: 'cinema neg', color_negative: 'color neg' };
const canInk = (hex) => { const c = hexToRgb(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.45 ? '#241f16' : '#efe6d2'; };
/* The label is printed INSIDE the band: font size is derived from the band width and
   textLength forces the exact run width, so long names wrap onto two lines like a real
   can instead of being clipped at the edge. */
const CAN_TEXT_BOX = 18;
const monoFit = (t, box, maxFs, minFs) => {
  const n = Math.max(1, String(t).length);
  const fs = Math.max(minFs, Math.min(maxFs, box / (0.62 * n)));
  return { fs, w: Math.min(box, Math.round(n * 0.62 * fs)) };
};
/* long names wrap onto a readable syllable boundary (KENT|MERE, CINE|STILL,
   COLOR|PLUS, EKTA|CHROME) instead of being clipped at the band edge */
const CAN_BREAKS = ['CHROME', 'PLUS', 'STILL', 'MERE'];
const canLines = (label) => {
  const s = String(label || '35').toUpperCase().slice(0, 12);
  if (s.length <= 7) return [s];
  for (const part of CAN_BREAKS) {
    const i = s.indexOf(part);
    if (i > 0 && i <= 5) return [s.slice(0, i), s.slice(i)];
  }
  const cut = Math.ceil(s.length / 2);
  return [s.slice(0, cut), s.slice(cut)];
};
/* tiny 35mm canister built from the stock's own can colours — a collectible mark,
   not a photo of the film; the actual look is shown by the engine preview below */
function canSvg(f){
  const c = f.can || { body: '#2b2723', band: '#d8c9a9', label: '35' };
  const lines = canLines(c.label);
  const ink = canInk(c.band);
  const two = lines.length > 1;
  let y = two ? 17.6 : 21.4;
  const labelRuns = lines.map(l => {
    const fit = monoFit(l, CAN_TEXT_BOX, 5.2, 3.4);
    const run = `<text x="15" y="${y.toFixed(1)}" text-anchor="middle" fill="${ink}" textLength="${fit.w}" lengthAdjust="spacingAndGlyphs"`
      + ` style="font-family:'PC Mono',ui-monospace,monospace;font-size:${fit.fs.toFixed(2)}px;font-weight:700">${esc(l)}</text>`;
    y += two ? 5.2 : 0;
    return run;
  }).join('');
  const isoFit = monoFit(String(f.iso || ''), 9, 4.2, 3.2);
  return `<svg class="cansvg" viewBox="0 0 30 36" width="30" height="36" aria-hidden="1">`
    + `<rect x="5" y="2.5" width="20" height="5" rx="2" fill="${c.body}" opacity=".72"/>`
    + `<rect x="5" y="7" width="20" height="23" rx="2.5" fill="${c.body}"/>`
    + `<rect x="5" y="12" width="20" height="13" fill="${c.band}"/>`
    + labelRuns
    + `<text x="15" y="28.4" text-anchor="middle" fill="${canInk(c.body)}" opacity=".85" textLength="${isoFit.w}" lengthAdjust="spacingAndGlyphs"`
    + ` style="font-family:'PC Mono',ui-monospace,monospace;font-size:${isoFit.fs.toFixed(2)}px;font-weight:700">${esc(String(f.iso || ''))}</text>`
    + `<rect x="9" y="30" width="12" height="1.6" rx="1" fill="${c.band}" opacity=".5"/></svg>`;
}
/* the same canister at 18px for the nameplate chip: no text at that size (it would be
   unreadable), so the colour band is the identity; a hairline rim keeps dark cans legible
   on the dark plate */
function canMark(f){
  const c = f.can || { body: '#2b2723', band: '#d8c9a9', label: '35' };
  return `<svg viewBox="0 0 30 36" width="18" height="22" aria-hidden="1">`
    + `<rect x="5" y="2.5" width="20" height="5" rx="2" fill="${c.body}" opacity=".72"/>`
    + `<rect x="5" y="7" width="20" height="23" rx="2.5" fill="${c.body}"/>`
    + `<rect x="5" y="12" width="20" height="13" fill="${c.band}"/>`
    + `<rect x="9" y="30" width="12" height="1.6" rx="1" fill="${c.band}" opacity=".5"/>`
    + `<rect x="5" y="2.5" width="20" height="30" rx="2.5" fill="none" stroke="rgba(233,223,205,.22)" stroke-width="1"/></svg>`;
}
function stateChip(st){
  if (st === 'lock') return '<span class="stchip lock">&#128274; LOCKED</span>';
  if (st === 'soon') return '<span class="stchip soon">COMING SOON</span>';
  return '<span class="stchip avail">AVAILABLE</span>';
}

/* ---------- film shelf: category tabs + brand caption groups ----------
   Built from profiles only, so it scales to dozens of expansion packs later. */
let filmCatOn = 'all';
function buildLists(){
  const cl = $('camList'); cl.innerHTML = '';
  state.cameras.forEach(c => {
    const st = (c.tier === 'pro' || c.tier === 'expansion') ? 'lock' : 'avail';
    const el = document.createElement('div');
    el.className = 'item' + (state.cam?.id === c.id ? ' active' : '') + (st === 'lock' ? ' locked' : '');
    el.innerHTML = `<div class="txt"><div class="t">${esc(c.brand)} ${esc(c.model)}${st === 'lock' ? ' <span class="protag">PRO</span>' : ''}</div><div class="d">${c.year} · ${c.lens.focal_mm}mm ${c.lens.aperture} · ${esc(c.vibe)}</div></div>${stateChip(st)}`;
    el.onclick = () => {
      if (st === 'lock'){ proHint(); return; }
      loadCamera(c); buildLists(); $('cameraBagModal').classList.remove('open');
    };
    cl.appendChild(el);
  });
  buildFilmList();
}
function buildFilmList(){
  const fl = $('filmList'); fl.innerHTML = '';
  document.querySelectorAll('#filmTabs .tab').forEach(t => t.classList.toggle('on', t.dataset.cat === filmCatOn));
  const visible = state.films.filter(f => filmCatOn === 'all' || filmCat(f) === filmCatOn);
  const byBrand = {};
  visible.forEach(f => { (byBrand[f.brand] = byBrand[f.brand] || []).push(f); });
  const brands = Object.keys(byBrand).sort((a, b) => byBrand[b].length - byBrand[a].length || a.localeCompare(b));
  const count = $('filmCount');
  if (count) count.textContent = `${visible.length} films · ${filmCatOn === 'all' ? 'all' : filmCatOn.toUpperCase()}`;
  const capline = $('filmBrands');
  if (capline) capline.textContent = brands.join(' · ');
  /* A test build has to say so: the shelf still shows which catalog tier each stock belongs
     to, so opening everything here never reads as "the web demo is the full library". */
  const gateNote = $('filmGate');
  if (gateNote) gateNote.textContent = WEB_LICENSE === 'all'
    ? 'test build · every finished stock is open here so the science can be checked. the released web keeps the free five; PRO stocks unlock in the Pro APK.'
    : '';
  brands.forEach(brand => {
    const cap = document.createElement('div');
    cap.className = 'brandcap'; cap.textContent = brand.toUpperCase();
    fl.appendChild(cap);
    byBrand[brand].forEach(f => {
      const st = filmState(f);
      const el = document.createElement('div');
      el.className = 'item filmitem' + (state.film?.id === f.id ? ' active' : '') + (st === 'lock' ? ' locked' : '');
      // the PRO tag marks catalog tier, not availability — it stays next to the name in both modes
      const proTag = f.tier !== 'free' ? ' <span class="protag">PRO</span>' : '';
      const extra = st === 'soon' ? ' · in development'
        : f.status.startsWith('disc') ? ' · ' + f.status : '';
      // a film is developed, not filtered: the lab process is part of the stock's identity
      const proc = f.process ? ` · ${esc(f.process)}` : '';
      el.innerHTML = `<div class="ic">${canSvg(f)}</div>`
        + `<div class="txt"><div class="t">${esc(f.brand)} ${esc(f.name)}${proTag}</div>`
        + `<div class="d">${f.iso} · ${TYPE_TAG[f.type]}${proc}${extra}</div></div>${stateChip(st)}`;
      // tapping a stock opens its preview first — never loads silently
      el.onclick = () => openFilmPreview(f);
      fl.appendChild(el);
    });
  });
}

/* ---------- film preview ----------
   Samples are rendered by this engine on a neutral body, so the colour shown is the
   film's own science with no camera cast mixed in — no stock photos from the web. */
const NEUTRAL_CAM = { id: 'neutral', brand: 'Neutral', model: 'neutral body', lens: { focal_mm: 35, aperture: 'f/8' }, camera_character: {} };
const PV_CROPS = [
  { x: 0, y: 0, w: 1280, h: 960, cap: 'FULL FRAME' },
  { x: 880, y: 470, w: 400, h: 300, cap: 'SUBJECT IN FRAME' },
  { x: 60, y: 300, w: 400, h: 300, cap: 'SHADOW TEXTURE' },
];
let sampleImg = null;
function loadSample(){
  return new Promise((res, rej) => {
    if (sampleImg) { res(sampleImg); return; }
    const img = new Image();
    img.onload = () => { sampleImg = img; res(img); };
    img.onerror = () => rej(new Error('sample unavailable'));
    img.src = 'assets/samples/street.jpg';
  });
}
function renderParamBars(f){
  const p = f.filter_params;
  const bars = [
    ['GRAIN', p.grain_strength],
    ['CONTRAST', (p.contrast - 0.75) / 0.5],
    ['SATURATION', p.saturation / 1.4],
    ['FADE', (p.fade || 0) / 0.35],
  ];
  $('pvBars').innerHTML = bars.map(([k, v]) => {
    const n = Math.round(clamp01(v) * 100);
    return `<div class="pvbar"><span>${k}</span><span class="track"><i style="width:${n}%"></i></span><span>${n}</span></div>`;
  }).join('');
}
async function renderSamples(f){
  const row = $('pvSamples'); row.innerHTML = '';
  let img;
  try { img = await loadSample(); }
  catch { row.innerHTML = '<div class="note">sample image unavailable offline</div>'; return; }
  PV_CROPS.forEach(c => {
    const cell = document.createElement('div'); cell.className = 'pvcell';
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 240; cv.className = 'pvimg';
    cv.getContext('2d').drawImage(img, c.x, c.y, c.w, c.h, 0, 0, 320, 240);
    const eng = new FilmEngine(cv); eng.setCombo(NEUTRAL_CAM, f);
    eng.process(cv, 320, 240);
    const cap = document.createElement('div'); cap.className = 'pvcap'; cap.textContent = c.cap;
    cell.appendChild(cv); cell.appendChild(cap);
    row.appendChild(cell);
  });
}
/* Loading a stock cannot quietly throw away a roll that is still exposed: the preview offers
   what a camera actually lets you do — develop the roll, or open the back door and fog it. */
function hideSwapGate(){
  pendingFilm = null;
  const gate = $('pvSwap'); if (gate) gate.style.display = 'none';
}
function tryLoadFilm(f){
  if (loadFilm(f)) { buildFilmList(); $('filmPreview').classList.remove('open'); hideSwapGate(); return; }
  pendingFilm = f;
  const gate = $('pvSwap');
  if (!gate) { toast('finish the roll in the camera before loading another stock'); return; }
  $('pvSwapText').textContent = `${state.frames.length} frame${state.frames.length === 1 ? '' : 's'} still latent in the camera — choose what happens to them`;
  gate.style.display = '';
}
async function swapDevelop(){
  if (!pendingFilm) return;
  const f = pendingFilm;
  await developRoll(); // the roll comes out of the developer and into the archive
  hideSwapGate();
  loadFilm(f, { force: true });
  buildFilmList();
  $('filmPreview').classList.remove('open');
}
function swapFog(){
  if (!pendingFilm) return;
  const f = pendingFilm;
  backDoor();
  hideSwapGate();
  loadFilm(f, { force: true });
  buildFilmList();
  $('filmPreview').classList.remove('open');
}

async function openFilmPreview(f){
  const st = filmState(f);
  hideSwapGate();
  $('pvTitle').textContent = `${f.brand} ${f.name}`;
  /* The preview must say exactly what the shelf chip says. A finished Pro stock is not
     "in production" — that phrasing reads as unfinished, which is the confusion the user
     ruled out: LOCKED means finished and unlocked by buying Pro, COMING SOON means still
     being made. In a test build a Pro stock is open, and the line says exactly that —
     opening it here does not claim the free web demo owns it permanently. */
  let statusLine;
  if (st === 'soon') statusLine = 'IN DEVELOPMENT';
  else if (st === 'lock') statusLine = 'PRO STOCK · UNLOCKS IN THE PRO APK';
  else if (f.tier !== 'free') statusLine = f.status.startsWith('disc') ? 'DISCONTINUED PRO STOCK · OPEN FOR TESTING HERE' : 'PRO STOCK · OPEN FOR TESTING HERE';
  else statusLine = 'AVAILABLE NOW';
  // the lab process belongs with the stock's identity, not buried in a footnote
  $('pvMeta').textContent = `${f.iso} · ${TYPE_TAG[f.type]} · ${statusLine}${f.process ? ` · PROCESS ${f.process}` : ''} · samples rendered by the POCKETROLL engine on a neutral body`;
  $('pvStory').textContent = f.story || '';
  renderParamBars(f);
  const btn = $('pvLoad');
  btn.classList.toggle('locked', st === 'lock');
  if (st === 'avail'){
    btn.textContent = 'LOAD FILM'; btn.disabled = false;
    btn.onclick = () => tryLoadFilm(f);
    $('pvHint').textContent = f.status.startsWith('disc')
      ? 'historical stock · its original lab process no longer exists, so this is an approximation — open here for testing'
      : f.tier !== 'free'
      ? 'test build: open here so the science can be checked · in the released web this stock unlocks in the Pro APK'
      : 'loads a fresh 36-frame roll · swapping bodies never resets it';
  } else if (st === 'lock'){
    btn.textContent = 'UNLOCK WITH PRO'; btn.disabled = false;
    btn.onclick = proHint;
    $('pvHint').textContent = 'finished stock · available in the Pro APK (GET PRO in ⚙ Settings)';
  } else {
    btn.textContent = 'COMING SOON'; btn.disabled = true; btn.onclick = null;
    $('pvHint').textContent = 'preview of the current tuned version · not loadable yet';
  }
  $('filmPreview').classList.add('open');
  await renderSamples(f);
}

/* ---------- build notice ----------
   CACHE in sw.js is bumped on every deploy. The page compares it with the build it was
   shipped with, so a stale cached app says a newer one exists instead of quietly staying
   behind — the user reloads on purpose rather than serving old code forever. BUILD and
   CACHE must be equal in any shipped commit: bump the two together, never apart. */
const BUILD = 'pocketroll-v11';
async function checkNewVersion(){
  try {
    const res = await fetch('sw.js?cb=' + Date.now(), { cache: 'no-store' }); // a query bypasses the SW
    if (!res.ok) return;
    const txt = await res.text();
    const m = txt.match(/const CACHE = ['"]([^'"]+)['"]/);
    if (!m || m[1] === BUILD) return;
    const bar = $('updateBar');
    if (!bar) return;
    bar.textContent = 'NEW VERSION AVAILABLE · RELOAD';
    bar.style.display = '';
    bar.onclick = async () => {
      try { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); } catch {}
      location.reload();
    };
  } catch {}
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
  loadCamera(cam, { quiet: true });
  loadFilm(fil, { force: true });
  if (q.get('hud') === 'full') $('hud').classList.add('full');
  $('vfStage').addEventListener('click', () => $('hud').classList.toggle('full'));
  renderHud();
  renderCamState();
  await loadArchives();
  /* A half-shot roll belongs in the camera, not in the archive: reopening the app puts the
     same roll back with the same frames and the same counter — the ritual survives a refresh.
     Test hooks that name gear explicitly (?cam/?film/?autoshot/?dev/?fresh) start clean so
     checks stay deterministic. */
  const freshIntent = q.has('cam') || q.has('film') || q.has('autoshot') || q.has('dev') || q.has('fresh');
  if (!freshIntent && pendingRoll) restoreCurrentRoll(pendingRoll);
  else renderStrip();
  renderArchive();
  // ask the browser to keep our data; best effort, and the result is stated in the storage note
  if (navigator.storage && navigator.storage.persist) { try { state.persisted = await navigator.storage.persist(); } catch {} }
  checkNewVersion();
  // the finder sleeps when the page goes to the background and wakes on foreground:
  // sensor lifecycle is owned by camera/camera-manager.js
  wireCameraLifecycle();
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
  $('openBag').onclick = () => $('cameraBagModal').classList.add('open');
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
  // archive: split browsing (all frames vs by roll), favorites, backup/restore
  $('tabRolls').onclick = () => { archTab = 'rolls'; renderArchive(); };
  $('tabFrames').onclick = () => { archTab = 'frames'; renderArchive(); };
  $('tabScans').onclick = () => { archTab = 'scans'; renderArchive(); };
  $('favChip').onclick = () => { favOnly = !favOnly; renderArchive(); };
  $('backupBtn').onclick = backupAll;
  $('restoreBtn').onclick = () => $('restoreInput').click();
  // the file is read, shown as a plan, and only merged after the user agrees to it
  $('restoreInput').onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) restoreFile(f, { preview: true }); e.target.value = ''; };
  const rc = $('restoreConfirm'); if (rc) rc.onclick = async () => { await applyBackup(pendingBackup); };
  const rx = $('restoreCancel'); if (rx) rx.onclick = () => { pendingBackup = null; const p = $('restorePlan'); if (p) p.style.display = 'none'; };
  // film shelf: category tabs keep the list ready for dozens of expansion packs
  document.querySelectorAll('#filmTabs .tab').forEach(t => {
    t.onclick = () => { filmCatOn = t.dataset.cat; buildFilmList(); };
  });
  // camera plumbing: retry after a denial, and choose which sensor the finder uses
  const retry = $('optCamRetry');
  if (retry) retry.onclick = async () => { await initCamera(); renderCamState(); if (!usingDemo) toast('camera feed restored'); };
  const flip = $('optCamFlip');
  if (flip) flip.onclick = async () => {
    state.opts.facing = state.opts.facing === 'user' ? 'environment' : 'user';
    saveOpts();
    await initCamera(); renderCamState();
    toast(state.opts.facing === 'user' ? 'front sensor · self-portraits' : 'rear sensor · point and shoot');
  };
  // roll lifecycle: the preview asks what happens to latent frames before switching stock
  const sd = $('swapDevelop'); if (sd) sd.onclick = swapDevelop;
  const sf = $('swapFog'); if (sf) sf.onclick = swapFog;
  const sc = $('swapCancel'); if (sc) sc.onclick = () => { hideSwapGate(); toast('roll kept in the camera'); };
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { hideSwapGate(); b.closest('.modal').classList.remove('open'); });
  // test hook: ?page=roll|gallery|settings|bag opens that page directly
  const page = q.get('page');
  if (page === 'roll') $('rollModal').classList.add('open');
  if (page === 'gallery') $('galleryModal').classList.add('open');
  if (page === 'settings') $('settingsModal').classList.add('open');
  if (page === 'bag') $('cameraBagModal').classList.add('open');
  // test hook: ?preview=<film id> opens that stock's preview page (engine samples)
  const pvId = q.get('preview');
  if (pvId){
    const pf = state.films.find(x => x.id === pvId);
    if (pf){
      const open = () => { openFilmPreview(pf); if (q.get('gate') === '1') tryLoadFilm(pf); };
      // ?gate=1 needs a roll with latent frames, so it waits for the autoshots to land
      if (q.get('gate') === '1' && q.get('autoshot') === '1') setTimeout(open, 2400); else open();
    }
  }
  // test hooks: ?scans=1 shows the lab-scan shelf; ?plan=1 shows a restore plan for a sample file
  if (q.get('scans') === '1'){ $('galleryModal').classList.add('open'); $('tabScans').click(); }
  if (q.get('plan') === '1'){
    const px = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2/BEDRwAAA';
    const demo = { app: 'pocketroll', schemaVersion: BACKUP_SCHEMA, exported: new Date().toISOString(),
      counts: { rolls: 1, frames: 2, scans: 1 },
      rolls: [{ id: 'roll-demo-1', status: 'developed', cam: 'Olympus Trip 35', film: 'Kodak Gold 200', iso: 200, loadedAt: 1, developedAt: 2, frames: [{ u: px, t: px }, { u: px, t: px }] }],
      scans: [{ id: 'scan-demo-1', u: px, t: px, date: 3, cam: 'Olympus Trip 35', film: 'Kodak Gold 200' }],
      inCamera: { id: 'roll-demo-cam', status: 'shooting', filmId: 'gold200', cameraId: 'trip35', shotsLeft: 34, loadedAt: 4, frames: [{ u: px, t: px }] } };
    restoreFile(new File([JSON.stringify(demo)], 'pocketroll-backup.json', { type: 'application/json' }), { preview: true });
  }
  // spacebar is the shutter — but never while a page (roll/gallery/settings) is open
  document.addEventListener('keydown', (e) => { if (e.code === 'Space' && !document.querySelector('.modal.open')) { e.preventDefault(); capture(); } });
}
window.FilmEngine = FilmEngine;
window.CAMERA_CAST = CAMERA_CAST;
if (document.getElementById('viewfinder')) boot();
