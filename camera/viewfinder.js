/* POCKETROLL — camera layer 3/3: the viewfinder is part of the body, not a shared interface.
   Each profile declares what its own finder really shows (cameras.json `viewfinder`, kept by
   scripts/patch-viewfinders.mjs from manuals and authentic finder descriptions), and this
   module draws exactly those marks — nothing is added to make a finder look sophisticated.
   A bare window draws nothing; an Albada finder draws its bright frame; a rangefinder draws
   frame lines and a coincident patch; a waist-level body draws a ground screen. Geometry is a
   fraction of the picture the body displays, so marks scale with the box and never shift the
   layout; the overlay is a separate layer, so no finder mark ever reaches the captured photo. */
'use strict';

/* How each kind of finder builds its boundary. The style is the optical construction, not a
   colour scheme: Albada projects a bright-line frame, a rangefinder projects thin framelines
   (some slide for near focus), a Galilean whose window equals the field has the viewfield edge
   as its frame, a ground screen's edge IS the frame, a plain window shows no boundary at all.
   There is no bracket variant here on purpose: no body in the bag prints corner brackets, so
   drawing them would be decoration. */
const VF_EDGE = {
  window:   { edge: 'none' },
  albada:   { edge: 'frame', tone: 0.5 },
  field:    { edge: 'frame', tone: 0.26 },
  rf:       { edge: 'lines', tone: 0.36 },
  screen:   { edge: 'screen' },
};

/* The f-stops a generic aperture display can print; a body with its own scale declares it. */
const VF_FSTOPS = [2, 2.8, 4, 5.6, 8, 11, 16];

/* Fallback for a profile that carries no viewfinder design: what its focus system implies,
   and nothing more. A scale-focus body gets no aid drawn on its glass. */
function vfSpec(c){
  const v = c?.viewfinder;
  if (v && v.id && VF_EDGE[v.optics]) return v;
  const mode = c?.focus_mode || 'af';
  const optics = mode === 'slr' ? 'screen' : mode === 'rangefinder' ? 'rf' : mode === 'scale' ? 'window' : 'field';
  const focus = mode === 'slr' ? 'screen' : mode === 'rangefinder' ? 'patch' : mode === 'af' ? 'afFrame' : 'none';
  return { id: 'implied-vf', optics, frame: optics === 'window' ? false : 0, parallax: [], lamps: [],
    closeFrame: false, nearShift: false, ghosts: false, focus, focusShape: null,
    focusGeom: focus === 'none' || focus === 'screen' ? null : { w: 0.22, h: 0.18 },
    readout: null, meter: null, meterScale: null };
}

/* ---------- building the design ---------- */
let vfBuiltId = '';

function buildViewfinder(c, stage){
  const spec = vfSpec(c);
  if (stage.dataset.vf === spec.id) return spec;   // same body in hand: nothing to rebuild
  stage.dataset.vf = spec.id;
  stage.dataset.optics = spec.optics;
  const host = $('vfOverlay');
  host.innerHTML = '';
  /* the boundary geometry and its tone live on the overlay, so every mark placed relative to
     the frame (inner frames, parallax marks, ghosts) inherits the same inset */
  const edge = VF_EDGE[spec.optics];
  const inset = typeof spec.frame === 'number' ? (spec.frame * 100).toFixed(1) + '%' : '0%';
  host.style.setProperty('--inset', inset);
  host.style.setProperty('--tone', String(edge.tone ?? 0.34));
  const mk = (cls, css) => {
    const n = document.createElement('i');
    n.className = cls;
    if (css) n.style.cssText = css;
    host.appendChild(n);
    return n;
  };

  /* the picture boundary */
  if (edge.edge === 'frame') mk('vf-frame' + (spec.nearShift ? ' nearshift near' : ''));
  if (edge.edge === 'lines') mk('vf-lines' + (spec.nearShift ? ' nearshift near' : ''));
  if (edge.edge === 'screen'){
    mk('vf-screen'); mk('vf-fresnel'); mk('vf-screenedge');
  }
  /* a second, inner close-range frame printed permanently (Contax T2 manual) */
  if (spec.closeFrame) mk('vf-close');
  /* parallax compensation marks: a real finder prints them when you focus close, so they
     answer the focusing moment rather than sitting on the glass all the time */
  if ((spec.parallax || []).length) mk('vf-parallax near');
  /* beam-splitter ghosts: persistent duplicate images of the field edge (Canonet optics) */
  if (spec.ghosts){ mk('vf-ghost'); mk('vf-ghost g2'); }

  /* the focusing aid the body actually has */
  const g = spec.focusGeom || { w: 0.22, h: 0.18 };
  const aid = (cls, css) => { const n = mk(cls, css); n.setAttribute('data-confirm', '1'); return n; };
  if (spec.focus === 'patch'){
    // a coincident patch keeps the shape its own finder has: Yashica's oval reticle, Canonet's
    // soft-edged rectangular spot, XA's central rectangle — not one universal box.
    const p = aid('vf-patch' + (spec.focusShape === 'oval' ? ' oval' : ''),
      `--pw:${(g.w * 100).toFixed(1)}%;--ph:${(g.h * 100).toFixed(1)}%`);
    p.appendChild(document.createElement('i')); p.appendChild(document.createElement('i'));
  }
  if (spec.focus === 'afFrame') aid('vf-af', `--aw:${(g.w * 100).toFixed(1)}%;--ah:${(g.h * 100).toFixed(1)}%`);
  if (spec.focus === 'afMarks'){
    const m = aid('vf-afmarks', `--mw:${(g.w * 100).toFixed(1)}%`);
    for (let i = 0; i < 3; i++) m.appendChild(document.createElement('i'));
  }
  if (spec.focus === 'crosshair'){
    const x = aid('vf-cross', `--cw2:${(g.w * 100).toFixed(1)}%;--ch2:${(g.h * 100).toFixed(1)}%`);
    x.appendChild(document.createElement('i')); x.appendChild(document.createElement('i'));
  }
  /* a focusing screen has no aid box: the screen itself is how you focus (§3 authenticity) */

  /* indicator lamps inside the finder */
  for (const l of spec.lamps || []) mk(`vf-lamp lamp-${l}`, '').setAttribute('data-lamp', l);

  /* the instrument it reads out: a scale and needle, or a row of illuminated numerals */
  const r = spec.readout;
  if (r?.kind === 'needle'){
    const n = mk('vf-needle full-only', `--kind:${r.shows.includes('focus') && !r.shows.includes('shutter') ? 'focus' : 'shutter'}`);
    n.appendChild(document.createElement('i'));          // the scale
    const needle = document.createElement('b'); needle.className = 'vf-needlepole'; n.appendChild(needle);
    if (r.striped) n.appendChild(Object.assign(document.createElement('u'), { className: 'vf-warnzone' }));
    if (r.shows.includes('focus') && r.shows.includes('shutter')){
      // a body that displays both instruments prints two needles, each on its own scale
      const f = mk('vf-needle full-only focus-only', '--kind:focus');
      f.appendChild(document.createElement('i'));
      f.appendChild(Object.assign(document.createElement('b'), { className: 'vf-needlepole' }));
    }
  }
  if (r?.kind === 'lcd'){
    // TC-1's numerals answer the half-press, so its display stays dark until then; every other
    // body's display is lit while you are looking at it.
    const row = mk('vf-led' + (r.onPress ? ' onpress' : '') + ' full-only');
    for (const s of r.shows){
      const el = document.createElement('b');
      el.className = 'vf-num show-' + s;
      el.setAttribute('data-show', s);
      if (s === 'battery'){
        el.innerHTML = 'BAT <span class="battbar"><i id="hudBattFill"></i></span> <span id="hudBattPct"></span>';
      }
      row.appendChild(el);
    }
  }
  /* an aperture scale lit by the same window as the frame (a meter in the finder, not a list) */
  if (spec.meter === 'aperture'){
    const m = mk('vf-meter full-only');
    m.appendChild(document.createElement('i'));
    m.appendChild(Object.assign(document.createElement('b'), { className: 'vf-needlepole' }));
    m.appendChild(Object.assign(document.createElement('u'), { className: 'vf-mtick' }));
  }
  vfBuiltId = spec.id;
  return spec;
}

/* ---------- where the marks sit ----------
   The overlay covers exactly the picture the body displays (the contained, centred feed), so
   every mark lines up with the frame the finder shows and none of it lands on the black bars. */
let vfPlaceKey = '';
function placeViewfinder(stage, feedAspect){
  const host = $('vfOverlay');
  if (!host) return;
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h || !feedAspect) return;
  let pw = w, ph = h;
  if (feedAspect > w / h) ph = Math.max(2, Math.round(w / feedAspect));
  else pw = Math.max(2, Math.round(h * feedAspect));
  const key = `${w}x${h}x${pw}x${ph}`;
  if (key === vfPlaceKey) return;   // same geometry: no restyle, so switching bodies cannot jitter the layout
  vfPlaceKey = key;
  host.style.left = ((w - pw) / 2) + 'px';
  host.style.top = ((h - ph) / 2) + 'px';
  host.style.width = pw + 'px';
  host.style.height = ph + 'px';
}

/* ---------- what the instruments say ----------
   Digital bodies print what their profile declares (their own exposure program string).
   Analog instruments (a needle, an aperture scale) read the scene: measured luminance of the
   live field gives the exposure value, which is what a real meter does. */
let vfLuma = 0.35, vfLumaAt = 0;
function vfSceneLuma(){
  const now = performance.now();
  if (now - vfLumaAt < 420) return vfLuma;
  vfLumaAt = now;
  const src = $('viewfinder');
  if (!src || !src.width) return vfLuma;
  const s = document.createElement('canvas'); s.width = 12; s.height = 8;
  const g = s.getContext('2d');
  g.drawImage(src, 0, 0, 12, 8);
  const d = g.getImageData(0, 0, 12, 8).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
  vfLuma = sum / (d.length / 4);
  return vfLuma;
}
function vfExposure(luma, iso){
  // exposure value from the measured field: a meter reading a scene, not a fixed string
  const ev = Math.log2(Math.max(0.01, luma) * (iso || 100) / 100) + 3.6;
  return Math.max(-2, Math.min(9, ev));
}
/* needle position along its scale: 0 = the darkest end, 1 = the brightest */
function vfNeedlePos(ev){ return Math.max(0.04, Math.min(1, (ev + 2) / 11)); }

/* A meter that lives in the finder reads the scene. The design declares the aperture its meter
   works at (quoted from that body's specification) or the shutter its dial holds, so a numeral
   is a measurement, not a fixed string. A profile that declares a fixed exposure program is a
   program camera: its display says what the program says. */
const VF_SHUTTER = [1, 2, 4, 8, 15, 30, 60, 125, 250, 500, 1000, 2000];
function nearest(steps, want){
  let best = steps[0], gap = Infinity;
  for (const s of steps){
    const g = Math.abs(Math.log(Math.max(1e-4, s)) - Math.log(Math.max(1e-4, want)));
    if (g < gap){ gap = g; best = s; }
  }
  return best;
}
function shutterRead(r, atAperture, ev){
  if (atAperture){
    const t = atAperture * atAperture / Math.pow(2, ev);      // EV = log2(A² / t)
    if (r.shutterScale) return String(nearest(r.shutterScale, t));   // a fixed LED scale prints its own steps
    const n = nearest(VF_SHUTTER, t);
    return t >= 1 ? Math.round(n) + 's' : '1/' + n;
  }
  return 'no program';
}
function apertureRead(scale, atShutter, ev){
  const a = nearest(scale, Math.sqrt(Math.pow(2, ev) / atShutter));
  return 'f' + a;
}

function paintViewfinder(c, st, spec){
  const h = (c && c.hud) || { flash: 'none', shutter: '' };
  const host = $('vfOverlay');
  if (!host) return spec;
  const iso = st.film ? st.film.iso : 100;
  const ev = vfExposure(vfSceneLuma(), iso);
  const tooDark = vfSceneLuma() < 0.085;

  const num = (key, text) => {
    // a numeral slot may hold a gauge (battery) instead of text; only plain slots are written
    const el = host.querySelector(`[data-show="${key}"]`);
    if (!el || el.firstElementChild) return;
    el.textContent = text;
  };
  if (spec.readout?.kind === 'lcd'){
    const d = spec.readout.derive || {};
    if (spec.readout.shows.includes('shutter')) num('shutter', shutterRead(spec.readout, d.at_aperture, ev));
    if (spec.readout.shows.includes('aperture')){
      num('aperture', apertureRead(spec.meterScale || VF_FSTOPS, d.at_shutter || 125, ev));
    }
    // an exposure-compensation mark prints only when the dial is off 0; this app is at 0,
    // and an AF mark prints only at the focusing moment — both stay unlit, never faked on
    if (spec.readout.shows.includes('battery')){
      const fill = $('hudBattFill'), pct = $('hudBattPct');
      if (fill) fill.style.width = st.battery + '%';
      if (pct) pct.textContent = st.battery + '%';
      host.querySelector('[data-show="battery"]')?.classList.toggle('low', st.battery < 20);
    }
  }
  const needlePos = vfNeedlePos(ev);
  for (const n of host.querySelectorAll('.vf-needle')){
    const pole = n.querySelector('.vf-needlepole');
    if (!pole) continue;
    // A shutter needle is driven by the meter; a focus needle reads distance, which this app
    // has no sensor for, so it rests at the far end — exactly where an autofocus camera sits
    // with nothing locked. The half-press answers with the body's own aid, not a fake reading.
    pole.style.setProperty('--pos', n.style.getPropertyValue('--kind') === 'focus' ? '1' : String(needlePos));
    n.classList.toggle('warn', !!n.querySelector('.vf-warnzone') && needlePos > 0.82);
  }
  const meter = host.querySelector('.vf-meter');
  if (meter){
    const scale = spec.meterScale || VF_FSTOPS;
    const dial = spec.derive?.at_shutter || 125;                  // the shutter its EE meter reads against
    const a = nearest(scale, Math.sqrt(Math.pow(2, ev) / dial));
    meter.querySelector('.vf-needlepole')?.style.setProperty('--pos', String(scale.indexOf(a) / (scale.length - 1)));
    const tick = meter.querySelector('.vf-mtick');
    if (tick) tick.textContent = 'f' + a;
  }
  /* lamps: a real indicator answers the camera's own state, not a tap */
  const afOn = st.opts.flash && h.flash === 'on';
  const lamp = (kind, on) => host.querySelector(`[data-lamp="${kind}"]`)?.classList.toggle('on', !!on);
  lamp('af', false);                       // lit only at the focusing moment, by vfConfirm
  lamp('flash', afOn || (spec.lamps.includes('flash') && tooDark));
  return spec;
}

/* The shutter's half-press answers whatever this body has: an AF frame snaps green, a
   rangefinder patch fuses, a needle's focus indicator settles, a parallax-corrected frame
   slides toward the near field, an AF lamp lights. A scale-focus body has nothing on its
   glass to confirm, so nothing flashes. */
function vfConfirm(c){
  const spec = vfSpec(c);
  const host = $('vfOverlay');
  if (!host) return;
  const flash = (sel, ms) => {
    const el = host.querySelector(sel);
    if (!el) return;
    el.classList.add('lock');
    setTimeout(() => el.classList.remove('lock'), ms);
  };
  flash('[data-confirm]', 350);
  flash('[data-lamp="af"]', 900);
  flash('[data-show="af"]', 700);
  // a body whose display answers the half-press (Minolta TC-1: "half pressing the shutter
  // button will display the shutter speed… in the viewfinder") lights it for that moment only
  const press = host.querySelector('.vf-led.onpress');
  if (press){
    press.classList.add('lit');
    setTimeout(() => press.classList.remove('lit'), 900);
  }
  // near-field marks and the shifted frame belong to the focusing moment, not the resting view
  for (const el of host.querySelectorAll('.near')){
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 700);
  }
  return spec;
}
