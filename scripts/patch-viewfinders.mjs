#!/usr/bin/env node
/* POCKETROLL — keeps the per-body viewfinder design in assets/cameras.json.
   A viewfinder is part of the body, not a shared interface: each profile declares what its
   own finder really shows, taken from the maker's manual or an authentic finder description.
   Nothing is added to make a finder look sophisticated: where a manual states a marking the
   entry uses its wording, where a finder is bare the entry says bare.
   Idempotent: a profile that already carries a design with this id is left alone; `--check`
   only reports, `--rewrite` re-applies the table (used when research changes a design). */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../assets/cameras.json', import.meta.url);
const CHECK = process.argv.includes('--check');
const REWRITE = process.argv.includes('--rewrite');

/* Schema — the per-camera viewfinder config, all geometry as a fraction of the picture the
   body displays, never pixels:
     id         design id, one per body
     optics     how the finder is built, and therefore how its boundary is drawn
     frame      false = a bare peep window with no projected boundary; a number = inset of the
                picture boundary (0 = the viewfield edge or the ground screen IS the frame)
     parallax   subject distances (metres) at which the finder prints compensation marks
     nearShift  the projected boundary slides for close focus (a parallax-corrected frame)
     closeFrame a permanent second, inner close-range frame printed in the finder
     focus      none | afFrame | afMarks | crosshair | patch | screen — the focusing aid it has
     focusShape rect | oval — the shape of a rangefinder spot, where the finder has one
     focusGeom  the size of that aid, as fractions of the frame
     lamps      af | flash — indicator lamps inside the finder, if it has any
     readout    null, or { kind: lcd | needle, shows: [...], striped: over-exposure zone,
              onPress: numerals appear on the half-press only, shutterScale: the fixed steps an
              LED scale prints, derive: what its meter reads the scene at }
     meter      'aperture' + meterScale — an aperture scale lit in the same window as the frame,
              reading against the shutter declared in derive
     ghosts     persistent beam-splitter ghost images in the field */

/* How the finder is built — the boundary style follows the optics, never a colour scheme:
   window   a plain peep window that projects nothing (a bare glass, no marks at all)
   albada   a projected bright picture frame (the Albada / reverse-Galilean finder)
   field    a Galilean whose window IS the field: the viewfield edge is the picture frame
   rf       thin projected framelines from the rangefinder window
   screen   a waist-level ground screen: the screen edge is the frame */
const OPTICS = ['window', 'albada', 'field', 'rf', 'screen'];
const FOCUS = ['none', 'afFrame', 'afMarks', 'crosshair', 'patch', 'screen'];
const SHAPES = ['rect', 'oval'];        // only a rangefinder spot declares a shape
const SHOWS = ['shutter', 'aperture', 'ev', 'iso', 'battery', 'focus', 'comp', 'af'];
const LAMPS = ['af', 'flash'];          // an indicator in a finder is a lamp, not a numeral
const KINDS = ['lcd', 'needle'];

/* One entry per body. Sources: maker manuals (cameramanuals.org / butkus.org / diaxa.com),
   camera-wiki.org, and authentic finder descriptions; sources are listed in
   docs/architecture.md. A lens aperture written here is the widest aperture that body's own
   meter reads at, quoted from its specification — it is what makes a derived numeral a
   reading of the scene instead of a decoration. */
const VF = {
  // Olympus Trip 35 — Albada finder projects its picture frame; the exposure needle scale and
  // the low-light "Judas window" are on the top plate, NOT in the viewfinder, and focus comes
  // from a zone scale outside the glass. So the frame is all the finder shows.
  trip35: { optics: 'albada', frame: 0.035, parallax: [1.2], focus: 'none', lamps: [] },
  // Kodak Instamatic — a plain peep window: no projected frame line, no marks, no readout.
  instamatic: { optics: 'window', frame: false, focus: 'none', lamps: [] },
  // Canon AF35M — a plain window; its infrared autofocus works off the glass and nothing on
  // it confirms focus. A point-and-shoot finder with nothing on it stays nothing on it.
  af35m: { optics: 'window', frame: false, focus: 'none', lamps: [] },
  // Nikon L35AF (manual, cameramanuals.org) — reverse-Galilean Albada-type bright frame,
  // picture frame marks, parallax compensation frame marks (0.8–1 m), autofocus frame marks
  // and a focus needle in the window.
  l35af: { optics: 'albada', frame: 0.03, parallax: [0.8, 1.0], focus: 'afFrame',
    focusGeom: { w: 0.26, h: 0.2 }, readout: { kind: 'needle', shows: ['focus'] } },
  // Yashica T4 Super / T5 (authentic finder description) — a small Galilean window with an
  // OVAL rangefinder reticle, parallax correction marks, and a green lamp for focus lock.
  // It projects no picture frame, so no frame is drawn.
  t4: { optics: 'window', frame: false, focus: 'patch', focusShape: 'oval',
    focusGeom: { w: 0.16, h: 0.12 }, parallax: [0.7], lamps: ['af'] },
  // Contax T2 (manual: "Display in the Viewfinder") — projected picture frame, an inner
  // close-range frame, a focus frame for the infrared AF, a flash symbol where a flash is
  // fitted, and shutter-speed numerals; exposure compensation and battery state ride the same
  // display. Aperture-priority, so the numerals come from the scene at f/2.0.
  contaxt2: { optics: 'rf', frame: 0.02, closeFrame: true, focus: 'afFrame',
    focusGeom: { w: 0.22, h: 0.16 }, lamps: ['af'],
    readout: { kind: 'lcd', shows: ['shutter', 'comp', 'battery'], derive: { at_aperture: 2.0 } } },
  // Olympus Stylus / MJU-II (authentic finder description) — "the whole viewfinder is the
  // field of view and picture frame; the lines are the close-up frame lines; the green dot
  // indicates focus lock". The frame is therefore the viewfield edge, not a projected inset.
  mju2: { optics: 'field', frame: 0, closeFrame: true, focus: 'none', lamps: ['af'] },
  // Ricoh GR1v (manual, cameramanuals.org) — reverse-Galilean viewfinder with a field-of-view
  // frame, parallax correction marks at 1.5 m and 0.7 m, autofocus marks, a shutter
  // indication, an AE warning and an exposure-compensation indicator.
  gr1v: { optics: 'albada', frame: 0.03, parallax: [0.7, 1.5], focus: 'afMarks',
    focusGeom: { w: 0.42, h: 0.22 },
    readout: { kind: 'lcd', shows: ['shutter', 'comp'], derive: { at_aperture: 2.8 } } },
  // Minolta TC-1 (camera-wiki.org) — a wide-angle real-image viewfinder with no projected
  // frame: "half pressing the shutter button will display the shutter speed, focus distance,
  // focus confirmation in the viewfinder… Inside it displays the shutter speed 8, 30, 125 and
  // 500". The numerals answer the half-press, so they stay dark until then; the aperture the
  // meter reads at is the lens's own f/3.5.
  tc01: { optics: 'window', frame: false, focus: 'none', lamps: ['af'],
    readout: { kind: 'lcd', shows: ['shutter'], onPress: true, shutterScale: [8, 30, 125, 500],
      derive: { at_aperture: 3.5 } } },
  // Lomo LC-A — a plain window, no marks; zone focus only.
  lca: { optics: 'window', frame: false, focus: 'none', lamps: [] },
  // Olympus XA (instruction book, diaxa.com) — "Confirm the shutter speed in the viewfinder…
  // If the shutter speed needle enters the striped, over-exposure warning zone…"; "the arrows
  // indicate parallax correction marks… frame the subject in the area under the 2 parallax
  // correction marks"; "turn the focusing lever until the double image in the central
  // rectangle fuses into one". No bright frame lines are stated, so none are drawn.
  xa: { optics: 'window', frame: false, focus: 'patch', focusShape: 'rect',
    focusGeom: { w: 0.2, h: 0.12 }, parallax: [0.85, 1.0],
    readout: { kind: 'needle', shows: ['shutter'], striped: true } },
  // Rollei 35 — a plain window; the meter needle sits on the top plate beside the lens.
  rollei35: { optics: 'window', frame: false, focus: 'none', lamps: [] },
  // Pentax 6×7 — waist-level finder: a ground screen, and the screen edge IS the frame
  // (100% coverage). No projected lines, no aid box, no readout.
  p67: { optics: 'screen', frame: 0, focus: 'screen', lamps: [] },
  // Canon Canonet QL17 GIII (camera-wiki.org) — "bright frame-lines that move diagonally
  // down and to the right when the camera is focused in the near-field, to correct for
  // parallax… Also lit by the same window is the meter, which shows the aperture being
  // selected… curiously, the scale skips f/2… The rangefinder spot is fairly large, bright
  // and rectangular, with soft edges, appearing yellow… persistent ghost images caused by the
  // beam-splitter." Shutter-priority EE, so the aperture is derived at the dial's 1/125.
  canonetql17: { optics: 'rf', frame: 0.03, nearShift: true, focus: 'patch',
    focusShape: 'rect', focusGeom: { w: 0.22, h: 0.16 }, ghosts: true,
    meter: 'aperture', meterScale: [1.7, 2.8, 4, 5.6, 8, 11, 16], derive: { at_shutter: 125 } },
  // Konica Big Mini BM-201 (review) — "half-press to trigger the auto-focus mechanism and
  // allow the viewfinder to tell you whether the subject is in focus": an in-focus lamp, and
  // no projected frame.
  bigmini: { optics: 'window', frame: false, focus: 'none', lamps: ['af'] },
  // Fuji GA645 (authentic finder description) — parallax-corrected projected framelines, a
  // central crosshair for the autofocus point, and an LED readout along the bottom edge
  // showing aperture and shutter speed. Auto-exposure at the lens's f/2.8.
  ga645: { optics: 'rf', frame: 0.03, nearShift: true, focus: 'crosshair',
    focusGeom: { w: 0.12, h: 0.12 }, lamps: ['flash'],
    readout: { kind: 'lcd', shows: ['aperture', 'shutter'],
      derive: { at_aperture: 2.8, at_shutter: 125 } } },
  // Nikon 35Ti (authentic finder description) — projected frame lines with a digital display
  // in the lower edge: shutter speed, aperture, autofocus confirmation and battery state.
  // Auto-exposure at the lens's f/3.5.
  n35ti: { optics: 'rf', frame: 0.03, focus: 'none', lamps: ['flash'],
    readout: { kind: 'lcd', shows: ['shutter', 'aperture', 'af', 'battery'],
      derive: { at_aperture: 3.5, at_shutter: 125 } } },
  // Konica Hexar AF (Wikipedia + cameraquest) — "projected parallax-corrected brightline
  // framelines", "center cross hairs to indicate AF focus point", and shutter speeds on the
  // top-plate LCD, NOT in the finder. So the finder shows lines and crosshairs, and no numerals.
  hexaraf: { optics: 'rf', frame: 0.03, nearShift: true, focus: 'crosshair',
    focusGeom: { w: 0.14, h: 0.14 }, lamps: [] },
};

/* Reject anything that would be an invented marking: an aid with no size, a size with no aid,
   an instrument the body does not have, a lamp on a body without a flash, two needles in one
   window, a frame on a window that projects none. */
function bad(v, c){
  const p = [];
  if (!OPTICS.includes(v.optics)) p.push(`${c.id} unknown optics ${v.optics}`);
  if (v.optics === 'window' && v.frame !== false) p.push(`${c.id} a plain window projects no boundary`);
  if (v.optics === 'field' && v.frame !== 0) p.push(`${c.id} a field-frame body has no inset to declare`);
  if (v.optics === 'screen' && v.frame !== 0) p.push(`${c.id} a ground screen's edge is the frame`);
  if ((v.optics === 'albada' || v.optics === 'rf') && typeof v.frame !== 'number') p.push(`${c.id} a projected-frame finder needs a frame inset`);
  if (v.focus === 'screen' && v.optics !== 'screen') p.push(`${c.id} a focusing screen only exists behind a ground screen`);
  if (v.optics === 'screen' && v.focus !== 'screen') p.push(`${c.id} a ground screen has no other focusing aid`);
  const aid = ['afFrame', 'afMarks', 'crosshair', 'patch'].includes(v.focus);
  if (aid && !v.focusGeom) p.push(`${c.id} a focusing aid without a size`);
  if (!aid && v.focusGeom) p.push(`${c.id} a size given to a finder that has no aid`);
  if (v.focusShape && v.focus !== 'patch') p.push(`${c.id} a spot shape is only declared for a rangefinder patch`);
  if (v.focusShape && !SHAPES.includes(v.focusShape)) p.push(`${c.id} unknown spot shape ${v.focusShape}`);
  if (v.closeFrame && typeof v.frame !== 'number') p.push(`${c.id} a close-range frame needs a picture frame to sit inside`);
  if (v.nearShift && typeof v.frame !== 'number') p.push(`${c.id} only a projected frame can slide for near focus`);
  if (v.ghosts && v.optics !== 'rf') p.push(`${c.id} ghost images come from a beam-splitter, not this optics`);
  for (const l of v.lamps || []){
    if (!LAMPS.includes(l)) p.push(`${c.id} unknown lamp ${l}`);
    if (l === 'flash' && c.hud?.flash !== 'on') p.push(`${c.id} a flash lamp needs a body that has a flash`);
  }
  if (v.meter){
    if (v.meter !== 'aperture') p.push(`${c.id} unknown meter ${v.meter}`);
    if (!Array.isArray(v.meterScale) || !v.meterScale.length) p.push(`${c.id} an aperture scale must print the f-stops it has`);
    for (const f of v.meterScale || []) if (!(+f > 0)) p.push(`${c.id} meter scale has a non-aperture value`);
    if (v.readout?.kind === 'needle') p.push(`${c.id} two needles in one window`);
  }
  const r = v.readout;
  if (r){
    if (!KINDS.includes(r.kind)) p.push(`${c.id} unknown readout kind ${r.kind}`);
    if (!Array.isArray(r.shows) || !r.shows.length) p.push(`${c.id} a readout that shows nothing is not a readout`);
    for (const s of r.shows || []) if (!SHOWS.includes(s)) p.push(`${c.id} unknown readout mark ${s}`);
    if (r.kind === 'needle' && (r.shows.includes('aperture') || r.shows.includes('battery'))) p.push(`${c.id} a needle shows the exposure scale, not numerals`);
    if (r.striped && !(r.kind === 'needle' && r.shows.includes('shutter'))) p.push(`${c.id} a striped warning zone belongs to a shutter needle`);
    if (r.shutterScale){
      if (!r.shows.includes('shutter')) p.push(`${c.id} a shutter scale with no shutter numeral`);
      for (const s of r.shutterScale) if (!(+s > 0)) p.push(`${c.id} shutter scale values must be shutter denominators`);
    }
    const d = r.derive;
    if (r.kind === 'lcd' && !d && r.shows.includes('shutter') && !c.hud?.shutter) p.push(`${c.id} a shutter numeral with nothing to read from`);
  }
  /* a meter reads the scene at the aperture or the shutter its body is built around; that is
     declared on the readout, or on the design when the meter itself is the only display */
  const d = v.derive || r?.derive;
  if (d){
    if (d.at_aperture !== undefined && !(+d.at_aperture > 0)) p.push(`${c.id} derive at_aperture must be an aperture`);
    if (d.at_shutter !== undefined && !(+d.at_shutter > 0)) p.push(`${c.id} derive at_shutter must be a shutter denominator`);
    if (d.at_aperture && !r?.shows.includes('shutter')) p.push(`${c.id} deriving a shutter needs a shutter numeral`);
    if (d.at_shutter && !r?.shows.includes('aperture') && v.meter !== 'aperture') p.push(`${c.id} deriving an aperture needs an aperture display`);
  }
  return p;
}

const j = JSON.parse(readFileSync(FILE, 'utf8'));
let added = 0, kept = 0;
const problems = [];
for (const c of j.cameras){
  const spec = VF[c.id];
  if (!spec){ problems.push(`${c.id} has no viewfinder research`); continue; }
  const full = { id: `${c.id}-vf`, closeFrame: false, nearShift: false, ghosts: false,
    parallax: [], lamps: [], focus: 'none', focusShape: null, focusGeom: null,
    readout: null, meter: null, meterScale: null, ...spec };
  problems.push(...bad(full, c));
  if (c.viewfinder && c.viewfinder.id === full.id && !REWRITE){ kept++; continue; }
  c.viewfinder = full;
  added++;
}
for (const p of problems) console.log('PROBLEM', p);
if (problems.length){ console.log('NOT WRITTEN — fix the table above'); process.exit(1); }
if (CHECK){ console.log(`viewfinders ok · ${kept} kept · ${added} would be applied · ${j.cameras.length} bodies`); process.exit(0); }
writeFileSync(FILE, JSON.stringify(j, null, 2) + '\n');
console.log(`cameras.json · ${added} viewfinder designs applied · ${kept} kept · ${j.cameras.length} bodies`);
