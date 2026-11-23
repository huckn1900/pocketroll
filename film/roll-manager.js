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
  state.rollId = newRollId(); state.shotsLeft = rollCapacity();
  state.frames = []; state.developed = false;
  /* a fresh roll takes the strip with it: the marks of frames that fogged belong to the spool
     that just left the camera, not to the one now threaded. */
  state.fogged = 0;
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
  /* The badges answer the camera, not the catalog: whatever is now threaded says SELECTED,
     and the stock it replaced stops saying so — a shelf that keeps an old badge is a lie. */
  buildLists();
  /* Loading answers in one line at the screen the user is already on: the stock now threaded,
     what it replaces with, and that the body in hand did not change. */
  toast(`loaded ${f.name} · fresh roll in ${state.cam?.model || 'this body'} · ${rollCapacity()} frames`);
  return true;
}
