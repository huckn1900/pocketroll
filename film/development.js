/* POCKETROLL — film layer 2/2: the darkroom run.
   The developer is one tank: tapping DEVELOP twice while a roll is in it would pour the
   same roll into the fixer twice — two archive records, two contact sheets. Nothing comes
   out half-developed either: if a step throws, the roll stays latent and can be run again.
   Opening the back door takes the spool out of the camera for good, and the roll record
   goes with it — so reopening the app shows an empty camera, not a phantom half-shot roll. */
'use strict';

let isDeveloping = false;

function backDoor(){
  if (isDeveloping){ toast('the roll is in the developer · wait for it to come out'); return; }
  const fogged = state.frames.length && !state.developed;
  const foggedCount = fogged ? state.frames.length : 0;
  state.frames = []; state.developed = false; state.sheet = null; state.shotsLeft = 0;
  /* the frames the light destroyed stay on the strip as marks — the roll did not lose those
     frames, it lost what was on them. A fresh roll threaded clears the marks. */
  state.fogged = foggedCount;
  dropCurrentRoll();
  renderCounter(); renderStrip(); renderRollPage(); renderArchive();
  $('rollStatus').textContent = foggedCount ? `door opened · ${foggedCount} undeveloped frames fogged` : 'empty spool out · load a fresh roll';
  $('developRoll').style.display = 'none'; $('sheetBtn').style.display = 'none';
  toast(fogged ? 'oops — light fogged the undeveloped roll' : 'empty spool out');
  const g = $('stripFrames'); g.classList.remove('pullout'); void g.offsetWidth; g.classList.add('pullout'); // spool pulls out of the opened door
  if (navigator.vibrate) navigator.vibrate([30, 80, 30, 80, 30]); // motor-sputter
}
async function developRoll(){
  if (isDeveloping){ toast('this roll is already in the developer'); return; }
  if (!state.frames.length){ toast('no exposed frames to develop'); return; }
  if (state.developed){ toast('this roll is already developed'); return; }
  if (!state.rollId){ toast('no roll in the camera · load a film'); return; }
  isDeveloping = true;
  renderRollPage(); // related operations go disabled while the tank is running
  const mask = $('devMask'), step = $('devStep'), bar = $('devBar');
  mask.classList.add('on');
  try {
    const phases = [['in developer · 68°F', 30], ['stop bath', 55], ['fixer', 80], ['wash · drying', 100]];
    for (const [label, pct] of phases){ step.textContent = label; bar.style.width = pct + '%'; await sleep(950); }
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
  } catch(e){
    state.developed = false; // never a half-developed roll: frames stay latent, retry works
    mask.classList.remove('on'); bar.style.width = '0';
    renderStrip(); renderRollPage();
    toast('developer jammed · frames kept · try DEVELOP again');
  } finally {
    isDeveloping = false;
    renderRollPage();
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
/* contact sheet: lab-style proof sheet of the developed roll — film base with
   sprocket holes, edge printing, frames in a grid with orange frame numbers */
async function buildSheet(urls){
  const imgs = [];
  for (const u of urls){
    const im = new Image(); im.src = u;
    try { await im.decode(); imgs.push(im); } catch { /* skip unreadable frame */ }
  }
  if (!imgs.length) return null;
  // the sheet follows the film: portrait phone frames get portrait cells —
  // frames are never squashed into a wrong aspect ratio.
  const ar = Math.min(1.6, Math.max(0.5, imgs[0].naturalWidth / imgs[0].naturalHeight));
  const cols = 3;
  const cw = ar >= 1 ? 320 : 244;
  const ch = Math.round(cw / ar);
  const gap = 12, edge = 36, bandTop = 56, bandBot = 42;
  const rows = Math.ceil(imgs.length / cols);
  const c = document.createElement('canvas');
  c.width = edge * 2 + cols * cw + gap * (cols - 1);
  c.height = bandTop + rows * (ch + gap) + bandBot;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#17110c'; ctx.fillRect(0, 0, c.width, c.height); // film base
  // clean label strip on top: type only — sprocket holes live in the bottom band,
  // so the print never collides with them.
  try { await document.fonts.load('bold 15px "PC Mono"'); } catch {}
  const f = state.film;
  const filmLabel = f ? f.brand + ' ' + f.name + (String(f.name).includes(String(f.iso)) ? '' : ' ' + f.iso) : 'CONTACT PRINT';
  ctx.fillStyle = '#c9a45a'; ctx.font = 'bold 15px "PC Mono", ui-monospace, monospace';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  ctx.fillText(`POCKETROLL LAB · ${filmLabel.toUpperCase()}`, edge, 34);
  const meta = `${(state.cam?.model || 'SCAN').toUpperCase()} · ${imgs.length} FRAMES`;
  ctx.font = '12px "PC Mono", ui-monospace, monospace';
  ctx.fillStyle = '#9a8a6e';
  ctx.fillText(meta, c.width - edge - ctx.measureText(meta).width, 34);
  ctx.fillStyle = '#3b332a'; ctx.fillRect(edge, bandTop - 8, c.width - edge * 2, 1);
  imgs.forEach((im, i) => {
    const x = edge + (i % cols) * (cw + gap), y = bandTop + Math.floor(i / cols) * (ch + gap);
    ctx.fillStyle = '#000'; ctx.fillRect(x - 2, y - 2, cw + 4, ch + 4);
    ctx.drawImage(im, x, y, cw, ch);
    // frame number rides inside the print, like a lab border marking
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 5;
    ctx.fillStyle = '#ff8a3d'; ctx.font = 'bold 13px "PC Mono", ui-monospace, monospace';
    ctx.fillText(String(i + 1).padStart(2, '0'), x + 7, y + 18);
    ctx.restore();
  });
  // film-base edge: sprocket holes + tiny print along the bottom
  ctx.fillStyle = '#c9bda6';
  for (let x = edge; x < c.width - edge - 22; x += 52) ctx.fillRect(x, c.height - bandBot + 8, 22, 13);
  ctx.fillStyle = '#8d8171'; ctx.font = '10px "PC Mono", ui-monospace, monospace';
  ctx.fillText(`POCKETROLL 35 · ${imgs.length} FRAMES DEVELOPED`, edge, c.height - 10);
  return c.toDataURL('image/jpeg', 0.92);
}
