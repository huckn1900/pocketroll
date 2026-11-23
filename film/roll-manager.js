/* POCKETROLL — film layer 1/2: the roll that is loaded in the camera.
   A roll has a lifecycle, so changing stock cannot silently destroy one:
   · empty camera → load freely
   · exposed and undeveloped → develop it first, or open the back door and fog it
   · developed → it is already archived; a fresh roll may go in
   loadFilm returns false when the caller has to resolve the roll first — the UI (film
   preview) offers the physical choices, this module only enforces the rule. */
'use strict';

function applyFilm(f){
  state.film = f;
  engine.setCombo(state.cam, f);
  $('vfFilm').textContent = f.name.toUpperCase();
  // the nameplate prints the same noun in the same face; ISO is a number, so it stays mono
  $('filmLine').textContent = f.name.toUpperCase();
  $('filmIso').textContent = 'ISO ' + f.iso;
  $('filmMark').innerHTML = canMark(f);
  renderHud();
}
function loadFilm(f, { force = false } = {}){
  if (!force && rollInCamera()) return false; // the caller has to resolve the roll first
  applyFilm(f);
  state.rollId = newRollId(); state.shotsLeft = 36;
  state.frames = []; state.developed = false;
  state.loadedAt = Date.now(); // roll record: the date this roll was loaded
  state.sheet = null;
  renderCounter();
  $('openRoll').classList.remove('ready');
  renderStrip();
  const g = $('stripFrames'); g.classList.remove('slidein'); void g.offsetWidth; g.classList.add('slidein'); // film threading in
  $('stripFrames').scrollLeft = 0;
  renderRollPage();
  saveCurrentRoll(); // a threaded roll is on record before the first shutter press
  renderArchive();   // the shelf shows the roll sitting in the camera, stock and all
  toast(`loading roll · ${f.name}`);
  return true;
}
