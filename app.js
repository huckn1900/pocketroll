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
    this.noise = this.makeNoise(film.filter_params.grain_size || 1);
  }
  buildLUT(f){
    const p = f.filter_params;
    const curve = new Uint8Array(256);
    const wH = new Float32Array(256), wS = new Float32Array(256);
    this.tintH = hexToRgb(p.tint_highlights); this.tintS = hexToRgb(p.tint_shadows);
    for (let i = 0; i < 256; i++){
      let v = i/255;
      // contrast stretch around midpoint
      v = clamp01(0.5 + (v - 0.5) * p.contrast);
      // black lift (fade): lifts shadows only
      v = clamp01(v + p.black_lift * Math.pow(1 - v, 2));
      // white point compression
      v *= p.white_point;
      curve[i] = Math.round(v * 255);
      // split-tone tint weights: highlights & shadows
      wH[i] = Math.pow(clamp01((v - 0.62)/0.38), 1.3) * 0.45;
      wS[i] = Math.pow(clamp01((0.36 - v)/0.36), 1.3) * 0.55;
    }
    return { curve, wH, wS };
  }
  makeNoise(grainSize){
    const c = document.createElement('canvas');
    const s = Math.max(128, Math.round(128 / grainSize));
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4){
      const n = 128 + (Math.random()*2 - 1) * 90;
      img.data[i] = img.data[i+1] = img.data[i+2] = n; img.data[i+3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // scale fine grain up so grain_size<1 stays fine at capture res
    const out = document.createElement('canvas'); out.width = out.height = 256;
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = grainSize >= 1;
    octx.drawImage(c, 0, 0, 256, 256);
    return out;
  }
  process(src, srcW, srcH){
    if (!this.film) { this.ctx.drawImage(src, 0, 0, srcW, srcH); return; }
    const p = this.film.filter_params;
    const cast = (this.cam && CAMERA_CAST[this.cam.id]) || { gain:[1,1,1] };
    const w = this.canvas.width, h = this.canvas.height;
    // lens softness from camera character
    const blur = (1 - (this.cam?.camera_character?.sharpness ?? 1)) * 2.2;
    this.ctx.filter = blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : 'none';
    this.ctx.drawImage(src, 0, 0, srcW, srcH);
    this.ctx.filter = 'none';

    // pixel pass: tone curve on luminance, chroma preserved & scaled by saturation,
    // split-tone tint blended by highlight/shadow weights, camera color gain on chroma
    const img = this.ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const { curve, wH, wS } = this.lut;
    const sat = p.saturation;
    const hR = this.tintH.r*255, hG = this.tintH.g*255, hB = this.tintH.b*255;
    const sR = this.tintS.r*255, sG = this.tintS.g*255, sB = this.tintS.b*255;
    for (let i = 0; i < d.length; i += 4){
      const r = d[i], g = d[i+1], b = d[i+2];
      const v = (r*0.299 + g*0.587 + b*0.114) | 0;
      const base = curve[v];
      const wh = wH[v], ws = wS[v], keep = 1 - wh - ws;
      const cr = (r*cast.gain[0] - v) * sat, cg = (g*cast.gain[1] - v) * sat, cb = (b*cast.gain[2] - v) * sat;
      d[i]   = clamp01(((base + cr) * keep + hR*wh + sR*ws) / 255) * 255;
      d[i+1] = clamp01(((base + cg) * keep + hG*wh + sG*ws) / 255) * 255;
      d[i+2] = clamp01(((base + cb) * keep + hB*wh + sB*ws) / 255) * 255;
    }
    this.ctx.putImageData(img, 0, 0);

    // halation: bright pass blurred & tinted, additive
    const hal = (p.halation || 0) + (this.cam?.camera_character?.halation_bias ?? 0) * 0.4;
    if (hal > 0.03){
      const bw = Math.max(1, w>>2), bh = Math.max(1, h>>2);
      const bc = document.createElement('canvas'); bc.width = bw; bc.height = bh;
      const bctx = bc.getContext('2d');
      bctx.filter = `contrast(2.4) brightness(1.35) blur(${(3 + hal*6).toFixed(1)}px)`;
      bctx.drawImage(this.canvas, 0, 0, bw, bh);
      bctx.filter = 'none';
      bctx.globalCompositeOperation = 'multiply';
      bctx.fillStyle = '#ff9a6a'; bctx.fillRect(0,0,bw,bh);
      this.ctx.globalCompositeOperation = 'lighter';
      this.ctx.globalAlpha = hal * 0.35;
      this.ctx.drawImage(bc, 0, 0, w, h);
      this.ctx.globalAlpha = 1; this.ctx.globalCompositeOperation = 'source-over';
    }

    // grain
    if (p.grain_strength > 0){
      this.ctx.globalCompositeOperation = 'overlay';
      this.ctx.globalAlpha = p.grain_strength * 0.45;
      const tile = 256 * (p.grain_size || 1);
      for (let x = 0; x < w; x += tile) for (let y = 0; y < h; y += tile)
        this.ctx.drawImage(this.noise, x, y, tile, tile);
      this.ctx.globalAlpha = 1; this.ctx.globalCompositeOperation = 'source-over';
    }

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

/* ---------- app state ---------- */
const state = { cameras: [], films: [], cam: null, film: null, shotsLeft: 36, gallery: [] };
const vf = $('viewfinder');
const engine = new FilmEngine(vf);
let video = null, demoCanvas = null, usingDemo = false;

function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1800); }

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
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video = document.createElement('video'); video.srcObject = stream; video.play();
    usingDemo = false; $('cameraHint').textContent = 'press space = shutter · live feed';
  }catch(e){
    usingDemo = true;
    $('cameraHint').textContent = 'camera unavailable — demo scene (still filterable)';
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
  if (state.shotsLeft <= 0){ rewind(); return; }
  shutterSound();
  const cap = document.createElement('canvas');
  const w = usingDemo ? 1280 : Math.min(1920, video.videoWidth || 1280);
  const h = usingDemo ? 960 : Math.round(w * (video.videoHeight / (video.videoWidth || 1)));
  cap.width = w; cap.height = h;
  const tmp = new FilmEngine(cap); tmp.setCombo(state.cam, state.film);
  tmp.process(usingDemo ? demoCanvas : video, usingDemo ? demoCanvas.width : video.videoWidth, usingDemo ? demoCanvas.height : video.videoHeight);
  const url = cap.toDataURL('image/jpeg', 0.9);
  state.gallery.push({ url, name: `${state.film.brand} ${state.film.name} · ${state.cam ? state.cam.model : 'no cam'} · frame ${36 - state.shotsLeft + 1}` });
  state.shotsLeft--;
  $('counter').textContent = String(state.shotsLeft).padStart(2, '0');
  renderGallery();
  if (state.shotsLeft === 0) rewind();
}
/* develop an imported photo through the loaded film — treated as a lab-developed
   scan (does not consume a frame from the roll; the roll counter stays honest). */
async function importPhoto(file){
  if (!state.film){ toast('load a film first'); return; }
  const url = URL.createObjectURL(file);
  const img = new Image(); img.src = url;
  try { await img.decode(); } catch { toast('could not read that image'); URL.revokeObjectURL(url); return; }
  const cap = document.createElement('canvas');
  const w = Math.min(1600, img.naturalWidth);
  const h = Math.round(w * img.naturalHeight / img.naturalWidth);
  cap.width = w; cap.height = h;
  const tmp = new FilmEngine(cap); tmp.setCombo(state.cam, state.film);
  tmp.process(img, img.naturalWidth, img.naturalHeight);
  const out = cap.toDataURL('image/jpeg', 0.9);
  state.gallery.push({ url: out, name: `${state.film.brand} ${state.film.name} · developed · ${state.cam ? state.cam.model : 'scan only'}` });
  URL.revokeObjectURL(url);
  renderGallery();
  toast('developed your photo');
}
function rewind(){
  $('doorInfo').textContent = 'rewinding…';
  if (navigator.vibrate) navigator.vibrate([30, 80, 30, 80, 30]); // motor-sputter rewind feel
  setTimeout(() => {
    state.shotsLeft = 36; $('counter').textContent = '36';
    $('doorInfo').textContent = 'roll stays loaded when you swap cameras';
    toast('rewound · fresh roll');
  }, 700);
}
function renderGallery(){
  const g = $('gallery'); g.innerHTML = '';
  state.gallery.slice(-8).forEach(item => {
    const el = document.createElement('div'); el.className = 'frame';
    el.style.backgroundImage = `url(${item.url})`; el.style.backgroundSize = 'cover';
    el.title = item.name + ' — tap to download';
    el.onclick = () => { const a = document.createElement('a'); a.href = item.url; a.download = item.name.replace(/[^\w.-]+/g,'_') + '.jpg'; a.click(); };
    g.appendChild(el);
  });
  for (let i = state.gallery.length; i < 8; i++){ const el = document.createElement('div'); el.className = 'empty'; g.appendChild(el); }
}

/* ---------- loading gear ---------- */
function loadFilm(f){
  state.film = f; state.shotsLeft = 36;
  engine.setCombo(state.cam, f);
  $('filmLabel').textContent = `${f.brand} ${f.name} · ${f.iso}`;
  $('canisterName').textContent = f.name.toUpperCase();
  $('canisterIso').textContent = f.iso + ' ISO';
  $('counter').textContent = '36';
  $('comboTag').textContent = (state.cam ? state.cam.model.toUpperCase() : 'BODY') + ' + ' + f.name.toUpperCase();
  $('camBody').classList.add('open');
  setTimeout(() => $('camBody').classList.remove('open'), 600);
  toast(`loading roll · ${f.name}`);
}
function loadCamera(c){
  state.cam = c;
  engine.setCombo(c, state.film);
  $('camLabel').textContent = `${c.brand} ${c.model} · ${c.year}`;
  $('comboTag').textContent = c.model.toUpperCase() + ' + ' + (state.film ? state.film.name.toUpperCase() : 'NO FILM');
  toast('camera swapped — roll untouched');
}

/* ---------- modals ---------- */
function buildLists(){
  const cl = $('camList'); cl.innerHTML = '';
  state.cameras.forEach(c => {
    const el = document.createElement('div');
    el.className = 'item' + (state.cam?.id === c.id ? ' active' : '');
    el.innerHTML = `<div><div class="t">${c.brand} ${c.model}</div><div class="d">${c.year} · ${c.lens.focal_mm}mm ${c.lens.aperture} · ${c.vibe}</div></div><span class="badge">${c.format.includes('126') ? '126 cartridge' : '135'}</span>`;
    el.onclick = () => { loadCamera(c); buildLists(); $('camModal').classList.remove('open'); };
    cl.appendChild(el);
  });
  const fl = $('filmList'); fl.innerHTML = '';
  state.films.forEach(f => {
    const el = document.createElement('div');
    el.className = 'item' + (state.film?.id === f.id ? ' active' : '');
    const typeTag = f.type === 'bw' ? 'b&w' : f.type === 'slide' ? 'slide' : 'color neg';
    el.innerHTML = `<div><div class="t">${f.brand} ${f.name}</div><div class="d">${f.iso} · ${typeTag} · ${f.story}</div></div><span class="badge${f.status.startsWith('disc') ? ' heritage' : ''}">${f.status.startsWith('disc') ? 'heritage' : 'in production'}</span>`;
    el.onclick = () => { loadFilm(f); buildLists(); $('filmModal').classList.remove('open'); };
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
    $('cameraHint').textContent = 'assets load failed: ' + (e && e.message ? e.message : String(e));
    return;
  }
  buildLists();
  // show something immediately; real camera feed swaps in when granted
  demoCanvas = demoScene(); usingDemo = true;
  const q = new URLSearchParams(location.search);
  const cam = state.cameras.find(c => c.id === q.get('cam')) || state.cameras.find(c => c.id === 'trip35');
  const fil = state.films.find(f => f.id === q.get('film')) || state.films.find(f => f.id === 'gold200');
  loadCamera(cam);
  loadFilm(fil);
  renderGallery();
  loop();
  initCamera();
  if (q.get('autoshot') === '1'){ capture(); capture(); capture(); }

  $('shutter').onclick = capture;
  $('pickCamera').onclick = () => $('camModal').classList.add('open');
  $('pickFilm').onclick = () => $('filmModal').classList.add('open');
  $('doorBtn').onclick = () => $('camBody').classList.toggle('open');
  $('downloadBtn').onclick = () => { const last = state.gallery[state.gallery.length-1]; if (last){ const a = document.createElement('a'); a.href = last.url; a.download = last.name.replace(/[^\w.-]+/g,'_') + '.jpg'; a.click(); } else toast('no frames yet'); };
  $('loadPhoto').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) importPhoto(f); e.target.value = ''; };
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.remove('open'));
  document.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.target.closest('.modal')) { e.preventDefault(); capture(); } });
}
window.FilmEngine = FilmEngine;
window.CAMERA_CAST = CAMERA_CAST;
if (document.getElementById('viewfinder')) boot();
