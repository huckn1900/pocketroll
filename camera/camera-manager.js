/* POCKETROLL — camera layer 1/2: the sensor and the body.
   The feed is a device resource, not a page element. Tracks are released when we switch
   sensors or the browser interrupts them; play() is awaited so the finder never shows a
   black panel that was promised but not started; the preview sleeps while the page sits in
   the background, because a live sensor burning battery nobody asked for is a bug on a
   phone, not a feature. What the finder is doing is stated plainly in #camState. */
'use strict';

let video = null;
let stream = null, camPaused = false;

/* There is no stand-in scene. The finder shows the sensor or it shows nothing, because a
   drawn picture would claim the camera is working when it is not. Waiting for the sensor is
   what the leader screen (index.html #bootScreen) is for; a blocked camera says so plainly. */
function feedLive(){ return !!(video && video.videoWidth && video.videoHeight && stream); }
function stopStream(){ if (!stream) return; for (const t of stream.getTracks()) t.stop(); stream = null; }
async function initCamera(){
  stopStream();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    renderCamState(); toast('this browser has no camera · the finder stays dark'); return;
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
      renderCamState(); toast('camera interrupted · retrying'); setTimeout(initCamera, 800);
    };
    await video.play();
    renderCamState();
  }catch(e){
    stopStream();
    renderCamState();
    toast('camera blocked · allow camera access, then SETTINGS → RETRY CAMERA');
  }
}
function renderCamState(){
  const el = $('camState'); if (!el) return;
  el.textContent = camPaused ? 'camera: resting · sensor released while the page is in the background'
    : feedLive() ? 'camera: live feed · ' + (state.opts.facing === 'user' ? 'front sensor' : 'rear sensor')
    : 'camera: blocked · no feed in the finder';
  const flip = $('optCamFlip'); if (flip) flip.classList.toggle('on', state.opts.facing === 'user');
}
/* The app waits for the sensor before it opens: the feed is the product, so an unanswered
   request is a real state worth waiting on, and it must not hang forever — a permission prompt
   the user ignores ends as a blocked camera, which the app then states and offers to retry. */
async function waitForFeed(capMs = 5000){
  const t0 = performance.now();
  while (!feedLive() && performance.now() - t0 < capMs) await new Promise(r => setTimeout(r, 120));
  return feedLive();
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
    // an empty chamber re-threaded into a new body leaves nothing behind, marks included
    state.fogged = 0;
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
  /* the bag's badges answer the camera too: the body now in hand says SELECTED, the one it
     replaced stops saying so — no stale badge left on the shelf */
  buildLists();
  /* The swap answers in one line at the place the user already is: which body is now in
     hand, and whether the film stayed. No full-page transition — the bag closes and the
     camera screen updates in place. */
  if (!quiet) toast(otherGate
    ? `${c.brand} ${c.model} · different gate — this body holds ${rollCapacity()} frames`
    : `${c.brand} ${c.model} selected · ${state.film ? `${state.film.name} stays loaded, ${state.shotsLeft} frames left` : 'no film loaded'}`);
  return true;
}
