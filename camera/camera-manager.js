/* POCKETROLL — camera layer 1/2: the sensor and the body.
   The feed is a device resource, not a page element. Tracks are released when we switch
   sensors or the browser interrupts them; play() is awaited so the finder never shows a
   black panel that was promised but not started; the preview sleeps while the page sits in
   the background, because a live sensor burning battery nobody asked for is a bug on a
   phone, not a feature. What the finder is doing is stated plainly in #camState. */
'use strict';

let video = null, demoCanvas = null, usingDemo = false;
let stream = null, camPaused = false;

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
function stopStream(){ if (!stream) return; for (const t of stream.getTracks()) t.stop(); stream = null; }
async function initCamera(){
  stopStream();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    usingDemo = true; renderCamState(); toast('this browser has no camera · demo scene stands in'); return;
  }
  const rear = state.opts.facing !== 'user';
  try{
    // ask the sensor for its native resolution so exports are full-pixel, not 640×480
    const ideal = rear ? { width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1280 }, height: { ideal: 960 } };
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: rear ? 'environment' : 'user', ...ideal }, audio: false });
    if (!video){ video = document.createElement('video'); video.playsInline = true; video.muted = true; }
    video.srcObject = stream;
    for (const t of stream.getTracks()) t.onended = () => {
      if (camPaused || !stream) return; // an intentional stop is not an interruption
      usingDemo = true; renderCamState(); toast('camera interrupted · retrying'); setTimeout(initCamera, 800);
    };
    await video.play();
    usingDemo = false;
    renderCamState();
  }catch(e){
    stopStream();
    usingDemo = true; renderCamState();
    toast('camera blocked · demo scene stands in. allow camera access, then SETTINGS → RETRY CAMERA');
  }
}
function renderCamState(){
  const el = $('camState'); if (!el) return;
  el.textContent = camPaused ? 'camera: resting · sensor released while the page is in the background'
    : usingDemo ? 'camera: blocked · demo scene'
    : 'camera: live feed · ' + (state.opts.facing === 'user' ? 'front sensor' : 'rear sensor');
  const flip = $('optCamFlip'); if (flip) flip.classList.toggle('on', state.opts.facing === 'user');
}
function wireCameraLifecycle(){
  /* Background means nobody is looking at the finder: pause the feed and hand the sensor
     back, so the phone stops spending battery on a preview no one can see. Coming back
     re-acquires the stream — a paused video with a dead track would show a frozen frame. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      camPaused = true;
      if (video) video.pause();
      stopStream();
      renderCamState();
    } else {
      camPaused = false;
      initCamera().then(renderCamState).catch(() => {});
    }
  });
}
/* Swapping bodies never touches the roll — the film in the camera is the product.
   The one exception is physical: a body prints a different gate, so it holds a different
   roll. A 6×7 back cannot carry a 135 roll that already has exposures on it, and neither
   can a 6×4.5 back carry a 6×7 one — both are 120 film, but the negatives differ. */
function rollCapacity(){ return (state.cam && state.cam.frames) || 36; }
function gateKey(c){ return c?.gate ? `${c.gate.film}:${Math.round(c.gate.aspect * 1000) / 1000}` : '135'; }
function loadCamera(c, { quiet = false } = {}){
  const otherGate = state.cam ? gateKey(c) !== gateKey(state.cam) : false;
  if (state.rollId && otherGate){
    if (state.frames.length){ toast('that body prints a different frame size · develop it or open the back door first'); return false; }
    // nothing exposed yet: the empty roll comes out and the new body holds its own gate
    state.rollId = newRollId(); state.loadedAt = Date.now();
    state.frames = []; state.developed = false; state.sheet = null;
  }
  state.cam = c;
  engine.setCombo(c, state.film);
  // the status plate reads like the body's own nameplate. A model string that is only a
  // number or a print format ("6×7", "35", "35Ti") is not a name by itself, so those
  // profiles carry `plate` with the maker on it; self-identifying models print as-is.
  $('camModel').textContent = (c.plate || c.model).toUpperCase();
  // the counter follows the gate this body holds, never a hardcoded 36
  state.shotsLeft = state.rollId ? Math.min(state.shotsLeft, rollCapacity()) : rollCapacity();
  renderHud();
  renderOpts();
  renderCounter();
  renderStrip();
  renderRollPage();
  if (state.rollId) saveCurrentRoll();
  if (!quiet) toast(otherGate ? `different gate · this body holds ${rollCapacity()} frames` : 'camera swapped — roll untouched');
  return true;
}
