/* POCKETROLL — camera layer 2/2: the moment of exposure.
   Everything that only exists at the shutter belongs here: the frame is processed at the
   stream's native pixels, light leak and date stamp are chance/opt-in prints that never
   enter the finder, and the thumbnail is made from the frame we already have — so restoring
   a half-shot roll never re-decodes twenty photos. The exposure then goes to the roll record. */
'use strict';

function thumbFromCanvas(src){
  // thumbnail made at the moment of exposure, from the frame we already have on canvas
  const w = Math.min(320, src.width);
  const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * src.height / src.width);
  c.getContext('2d').drawImage(src, 0, 0, w, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}
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
function capture(){
  if (!state.film){ toast('load a film first'); return; }
  if (!state.rollId){ toast('no roll in the camera · load a film'); return; }
  if (state.shotsLeft <= 0){ toast('roll finished · develop it'); return; }
  shutterSound();
  // a body with a focusing aid snaps its indicator to locked; a scale-focus camera has
  // nothing on its glass to confirm, so nothing flashes
  const focus = $('hudFocus');
  if (state.cam?.focus_mode !== 'scale'){
    focus.classList.add('lock'); setTimeout(() => focus.classList.remove('lock'), 350);
  }
  const flashShot = state.opts.flash && state.cam?.hud?.flash === 'on';
  state.battery = Math.max(4, state.battery - (flashShot ? 2 : 1));
  renderHud();
  const cap = document.createElement('canvas');
  // export at the stream's native pixel size (cap guards 4K+ streams from huge pixel loops),
  // cropped to the body's print gate when it prints one — the negative is that shape.
  const w = usingDemo ? 1280 : Math.min(2560, video.videoWidth || 1280);
  const gate = state.cam?.gate?.aspect;
  const h = gate ? Math.round(w / gate)
    : usingDemo ? 960 : Math.round(w * (video.videoHeight / (video.videoWidth || 1)));
  cap.width = w; cap.height = h;
  const tmp = new FilmEngine(cap); tmp.setCombo(state.cam, state.film);
  tmp.process(usingDemo ? demoCanvas : video, usingDemo ? demoCanvas.width : video.videoWidth, usingDemo ? demoCanvas.height : video.videoHeight, { flash: flashShot });
  const cctx = cap.getContext('2d');
  rollLeak(cctx, w, h);            // per-frame chance, tuned by film stock + body
  if (state.opts.date) stampDate(cctx, w, h);
  const url = cap.toDataURL('image/jpeg', 0.95); // export quality: full-res, never silently compressed
  state.frames.push({ url, t: thumbFromCanvas(cap), brand: state.film.brand, iso: state.film.iso });
  state.shotsLeft--;
  renderCounter();
  renderStrip();
  const g = $('stripFrames'); g.classList.remove('advance'); void g.offsetWidth; g.classList.add('advance'); // film-advance tick
  scrollStripToLast();
  renderRollPage();
  saveCurrentRoll(); // the exposure is written down as it happens — refresh loses nothing
  renderArchive();   // the shelf answers "what do I have" at any moment, not on reopen
  if (state.shotsLeft === 0) toast(`roll finished · ${state.frames.length} frames exposed · ready to DEVELOP`);
}
