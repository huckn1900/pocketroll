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
  // bodies added in the camera-expansion round: each prime has its own cast, never a copy
  xa:         { gain:[1.02,1.0,0.96] },
  rollei35:   { gain:[1.05,1.0,0.92] },
  p67:        { gain:[1.01,1.0,0.98] },
  canonetql17:{ gain:[1.03,1.0,0.95] },   // bright f/1.7 prime, a faint warm bias
  bigmini:    { gain:[1.02,1.0,0.98] },   // four-element lens: flat rather than characterful
  ga645:      { gain:[1.0,1.0,1.0] },     // even coverage across a 6×4.5 negative
  n35ti:      { gain:[0.99,1.0,1.02] },   // exact, a touch cool — an instrument, not a toy
  hexaraf:    { gain:[1.01,1.0,0.99] },   // fast clean street prime
};

/* Grain calibration lives in ONE place, and the engine reads it instead of hard-coding
   numbers in the pixel pass. These are the shipped values; the calibration page renders the
   same frame twice with two configs and measures the difference before anything ships.
   Round ㉒ calibration: amplitude −35%, clumps finer, colour speckle well below luminance
   grain (grain is a brightness texture first), and the field no longer wraps. */
const GRAIN = {
  amp: 22,          // pixel units at the luminance bell peak (was 34)
  size: 1.3,        // clump size × resolution × ISO × body bias (was 1.7)
  chromatic: 0.18,  // colour speckle relative to luminance grain (was 0.35)
  isoAmp: 0.35,     // how much ISO raises amplitude — the SIZE keeps the physical scaling,
                    // so a fast stock reads bigger-grained without also reading louder
  base: 0.85,       // flat floor under the ISO term (was 0.75 with a 0.5 ISO slope: the two
                    // were compounded, which is what made fast stocks read loud as well as coarse)
  tile: false,      // false: field sized to the frame, nothing repeats. true: legacy 256 tile
  fineMax: 1.6      // below this clump size a grain cell is a pixel: no interpolation, no softening
};

class FilmEngine {
  constructor(canvas){ this.canvas = canvas; this.ctx = canvas.getContext('2d', {willReadFrequently:true}); }
  setCombo(cam, film){
    this.cam = cam; this.film = film;
    if (!film) return;
    this.lut = this.buildLUT(film);
    this.noise = this.makeNoise(film.filter_params);
  }
  /* Calibration override only — the app never calls it, so every shipped film uses GRAIN. */
  setGrain(o){ this.grainCfg = o ? Object.assign({}, GRAIN, o) : null; }
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
    // legacy 256×256 field, kept so the calibration page can render the previous behaviour
    // against the current one; sampled with & 255 it wraps every 256 grain cells.
    const arr = new Uint8Array(256 * 256);
    for (let i = 0; i < arr.length; i++) arr[i] = 128 + Math.round((Math.random()*2 - 1) * 90);
    return arr;
  }
  /* The shipped grain field is one value per grain CELL, sized to the frame being printed: a
     1920px export has nothing to wrap around, so no speckle pattern ever repeats. Rebuilt
     only when the frame size or the clump size changes. Grain is still a fixed physical size
     on film — the cell size scales with resolution and ISO, the field just covers the frame. */
  grainField(w, h, cell){
    const key = w + 'x' + h + ':' + cell.toFixed(2);
    if (this._gf && this._gf.key === key) return this._gf;
    const lw = Math.min(w, Math.ceil(w / cell)) + 1, lh = Math.min(h, Math.ceil(h / cell)) + 1;
    const f = new Uint8Array(lw * lh);
    for (let i = 0; i < f.length; i++) f[i] = 128 + Math.round((Math.random()*2 - 1) * 90);
    this._gf = { key, f, lw, lh };
    return this._gf;
  }
  /* Colour grain is finer than the developed clump — the three dye layers read per pixel, not
     per cell — so it gets its own per-pixel field at a fraction of the luminance amplitude.
     A frame-sized field: nothing wraps, nothing repeats. */
  chromaField(w, h){
    const key = w + 'x' + h;
    if (this._cf && this._cf.key === key) return this._cf;
    const f = new Uint8Array(w * h);
    for (let i = 0; i < f.length; i++) f[i] = 128 + Math.round((Math.random()*2 - 1) * 90);
    this._cf = { key, f, w, h };
    return this._cf;
  }
  /* Interpolating four cell values gives a clump soft edges instead of a hard square, and it
     also lowers the clump's variance by however many pixels share a cell. Measuring the real
     sampling grid keeps `amp` meaning the amplitude it always meant, so the change under
     review here is the requested −35%, not that −35% multiplied by a second hidden factor. */
  smoothNorm(w, h, cell){
    const key = w + 'x' + h + ':' + cell.toFixed(2);
    if (this._sn && this._sn.key === key) return this._sn.n;
    let acc = 0, samples = 0;
    for (let i = 0; i < 2048; i++){       // positions across the actual sampling grid
      const gx = ((i * 97 + 13) % w) / cell, gy = ((i * 151 + 7) % h) / cell;
      const fx = gx - (gx | 0), fy = gy - (gy | 0);
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      acc += (u * u + (1 - u) * (1 - u)) * (v * v + (1 - v) * (1 - v)); samples++;
    }
    const norm = 1 / Math.sqrt(Math.max(0.3, acc / samples));
    this._sn = { key, n: norm };
    return norm;
  }
  /* The viewfinder is a display, not a print. Whatever the sensor sends is drawn FULL, at
     its true aspect, centred inside the LCD box — never stretched to fill it, never trimmed
     to its corner. What the box itself is shaped like is decided outside this class — a
     print gate is the frame the film carries, a compact's window is the feed it is being
     handed — and anything that still does not fit gets the dark bars a real compact screen
     shows around a frame it cannot display. */
  _drawContained(src, sx, sy, sw2, sh2){
    const w = this.canvas.width, h = this.canvas.height;
    let dw = w, dh = Math.round(w * sh2 / sw2);
    if (dh > h){ dh = h; dw = Math.round(h * sw2 / sh2); }
    const dx = Math.round((w - dw) / 2), dy = Math.round((h - dh) / 2);
    this.ctx.fillStyle = '#0d0b09'; this.ctx.fillRect(0, 0, w, h);
    this.ctx.drawImage(src, sx, sy, sw2, sh2, dx, dy, dw, dh);
    // remember the bars so the effects pass cannot grain, bloom or vignette them: film grain
    // lives on the emulsion, not on the bezel of the screen
    this.bars = (dw < w || dh < h) ? { w, h, dw, dh, dx, dy } : null;
  }
  _repaintBars(){
    const b = this.bars; if (!b) return;
    this.ctx.fillStyle = '#0d0b09';
    this.ctx.fillRect(0, 0, b.w, b.dy);
    this.ctx.fillRect(0, b.dy + b.dh, b.w, b.h - b.dy - b.dh);
    this.ctx.fillRect(0, b.dy, b.dx, b.dh);
    this.ctx.fillRect(b.dx + b.dw, b.dy, b.w - b.dx - b.dw, b.dh);
  }
  /* A canvas cannot draw itself onto itself: _drawContained fills the bezel first, which
     wipes the scene before the copy ever happens. The preview samples and the shelf swatches
     render a film on its own canvas, so the frame is lifted out first and drawn back in. */
  _isolate(sx, sy, sw2, sh2){
    const off = this.off || (this.off = document.createElement('canvas'));
    off.width = sw2; off.height = sh2;
    const oc = off.getContext('2d');
    oc.clearRect(0, 0, sw2, sh2);
    oc.drawImage(this.canvas, sx, sy, sw2, sh2, 0, 0, sw2, sh2);
    return off;
  }
  process(src, srcW, srcH, opts){
    if (!this.film) {
      if (src === this.canvas) src = this._isolate(0, 0, srcW, srcH);
      this._drawContained(src, 0, 0, srcW, srcH); return;
    }
    const p = this.film.filter_params;
    const cast = (this.cam && CAMERA_CAST[this.cam.id]) || { gain:[1,1,1] };
    // on-camera electronic flash at the moment of capture: brightens & slightly cools
    // the subject center, desaturates the lit area, and lets the background drop deeper.
    const flash = !!(opts && opts.flash);
    // analysis/tests need the lens and colour science without the random light leaks the
    // cheap bodies seep every frame; the app itself never passes this.
    const noLeak = !!(opts && opts.noLeak);
    const w = this.canvas.width, h = this.canvas.height;
    // The print gate. A body that prints a different frame than the sensor sees — 6×7 on
    // 120 film — crops the view to that gate BEFORE any film science runs: the frame is
    // the gate, not a label on a nameplate. Bodies without a gate keep the sensor frame.
    let sx = 0, sy = 0, sw2 = srcW, sh2 = srcH;
    const gate = this.cam?.gate?.aspect;
    if (gate){
      if (srcW / srcH > gate){ sw2 = Math.round(srcH * gate); sx = Math.round((srcW - sw2) / 2); }
      else { sh2 = Math.round(srcW / gate); sy = Math.round((srcH - sh2) / 2); }
    }
    // lens softness from camera character — scaled with resolution, so a plastic
    // lens stays soft at export size while sharp primes (T*, GR) never blur
    const blur = (1 - (this.cam?.camera_character?.sharpness ?? 1)) * (2.0 + w / 420);
    if (src === this.canvas) { src = this._isolate(sx, sy, sw2, sh2); sx = 0; sy = 0; }
    this.ctx.filter = blur > 0.35 ? `blur(${blur.toFixed(1)}px)` : 'none';
    this._drawContained(src, sx, sy, sw2, sh2);
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
    const G = this.grainCfg || GRAIN;
    // grain follows the stock: higher-ISO films have physically bigger grains,
    // underexposure makes grain more visible in shadows (like a pushed print)
    // (iso lives at the film profile top level; filter_params.iso is legacy)
    const isoEff = this.film.iso || p.iso || 100;
    const isoScale = Math.min(1.6, Math.max(0.8, Math.pow(isoEff / 100, 0.32)));
    // grain is a fixed physical size on the film: a 55×70mm negative holds the same grain
    // over far more area than a 135 frame, so a medium-format scan reads finer per pixel.
    // That is the body's doing, not the stock's — grain_bias comes from camera_character.
    const grainBias = this.cam?.camera_character?.grain_bias ?? 1;
    const cell = Math.max(1, (p.grain_size || 1) * (w / 720) * G.size * isoScale * grainBias);
    // ISO raises clump SIZE physically (that is what a fast stock is); it raises amplitude
    // far less, so Tri-X reads coarse rather than loud. Underexposure still pushes grain.
    const ampMul = G.base + G.isoAmp * isoScale + Math.max(0, -(p.exposure || 0)) * 0.3;
    const grainColor = p.grain_color !== false; // B&W stocks get pure luminance grain
    const interpolate = cell > G.fineMax;       // below that a cell is a pixel: nothing to soften
    const noise = this.noise;
    const gf = grainOn && !G.tile ? this.grainField(w, h, cell) : null;
    const cf = grainOn && grainColor && !G.tile ? this.chromaField(w, h) : null;
    const smooth = interpolate && !G.tile ? this.smoothNorm(w, h, cell) / 90 : 1 / 90;
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
        const amp = p.grain_strength * (0.30 + 0.80 * bell) * G.amp * ampMul;
        let nL;
        if (G.tile){                       // legacy tiled field — kept for calibration comparison
          const nx = (col / cell | 0) & 255, ny = (row / cell | 0) & 255;
          nL = (noise[ny*256 + nx] - 128) / 90;
        } else if (interpolate){
          // a grain cell is a CLUMP, not a pixel: interpolate between its four centres so the
          // clump has soft edges instead of a hard square of identical values. Hard squares at
          // 4–16px is exactly what read as coarse digital noise in skies and flat walls.
          const gx = col / cell, gy = row / cell;
          const xi = gx | 0, yi = gy | 0, fx = gx - xi, fy = gy - yi;
          const u = fx * fx * (3 - 2 * fx), vv = fy * fy * (3 - 2 * fy);
          const x1 = xi + 1 < gf.lw ? xi + 1 : gf.lw - 1, y1 = yi + 1 < gf.lh ? yi + 1 : gf.lh - 1;
          const r0 = yi * gf.lw, r1 = y1 * gf.lw;
          const t0 = gf.f[r0 + xi] + (gf.f[r0 + x1] - gf.f[r0 + xi]) * u;
          const t1 = gf.f[r1 + xi] + (gf.f[r1 + x1] - gf.f[r1 + xi]) * u;
          nL = (t0 + (t1 - t0) * vv - 128) * smooth;  // smooth returns the variance the softening
                                                    // took away, so amp still means the amp asked for
        } else {                           // a fine stock at this resolution: the cell is a pixel
          nL = (gf.f[(row / cell | 0) * gf.lw + (col / cell | 0)] - 128) / 90;
        }
        if (grainColor){ // luminance grain carries the texture; the dye layers add a far finer and
                         // far quieter colour speckle — that is what sprinkled magenta into skies
          const ampC = amp * G.chromatic;
          let nr, ng, nb;
          if (G.tile){
            const nx = (col / cell | 0) & 255, ny = (row / cell | 0) & 255;
            nr = (noise[((ny+53)&255)*256 + ((nx+91)&255)] - 128) / 90;
            ng = (noise[((ny+107)&255)*256 + ((nx+37)&255)] - 128) / 90;
            nb = (noise[((ny+171)&255)*256 + ((nx+13)&255)] - 128) / 90;
          } else {
            nr = (cf.f[(row % cf.h) * cf.w + ((col + 91) % cf.w)] - 128) / 90;
            ng = (cf.f[((row + 37) % cf.h) * cf.w + ((col + 13) % cf.w)] - 128) / 90;
            nb = (cf.f[((row + 71) % cf.h) * cf.w + ((col + 53) % cf.w)] - 128) / 90;
          }
          rr += nL*amp + nr*ampC; gg += nL*amp + ng*ampC; bb += nL*amp + nb*ampC;
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
    // the LCD bars are the display, not the film: put them back pure black after every pass
    this._repaintBars();
  }
}

/* LCD finder readouts live in cameras.json per body (`hud`) — the panel shows what that
   camera actually reads out, not a plausible generic string. Bodies without a flash cannot
   fire one, and bodies without a meter cannot promise one. */

/* Light leaks: stray light seeping into the chamber between frames — probability
   & strength follow the film stock (cheap/expired stocks leak more) multiplied by
   the camera body (LC-A / cheap point-and-shoots leak through the door seal).
   Tight metal bodies leak little; a large 120 back lets light seep at the edges. */
const CAMERA_LEAK = { lca: 2.2, trip35: 1.4, instamatic: 1.2, af35m: 1.2, tc01: 1.3, t4: 0.45, contaxt2: 0.4, mju2: 0.45, gr1v: 0.4, l35af: 0.5, xa: 0.5, rollei35: 1.0, p67: 0.6, canonetql17: 1.2, bigmini: 0.35, ga645: 0.4, n35ti: 0.3, hexaraf: 0.35 };

const OPTS_KEY = 'pocketroll-opts-v1';
function loadOpts(){ try{ return Object.assign({ date: false, flash: true, facing: 'environment' }, JSON.parse(localStorage.getItem(OPTS_KEY)) || {}); }catch{ return { date: false, flash: true, facing: 'environment' }; } }
function saveOpts(){ try{ localStorage.setItem(OPTS_KEY, JSON.stringify(state.opts)); }catch{} }

/* ---------- app state ---------- */
/* The roll in the camera is an object with an identity, not a scratch array: `rollId` is
   the record persisted to IndexedDB on every exposure, and `scans` is separate data — a
   scan is processed by the film, it never consumes a frame of the roll. */
const state = { cameras: [], films: [], cam: null, film: null, shotsLeft: 36, frames: [], scans: [],
  rollId: null, developed: false, rolls: [], battery: 92, opts: loadOpts(), sheet: null, persisted: false,
  /* frames the light destroyed are a mark on the strip, not data in the roll: the count and
     the record stay empty, the cells stay visible until a fresh roll is threaded. */
  fogged: 0 };
/* The helper pages (calibration grid, sound lab) load this file for FilmEngine and the cast
   table only — they have no viewfinder, so the engine is built when there is one to draw into. */
const vf = $('viewfinder');
const engine = vf ? new FilmEngine(vf) : null;
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
  const cam = state.cam;
  // every body reads out its own panel from cameras.json (`hud`): a camera with no flash
  // cannot show a flash icon, a camera with no meter cannot promise an exposure program.
  const h = (cam && cam.hud) || { flash: 'none', shutter: '' };
  const fl = $('hudFlash');
  const capable = h.flash === 'on'; // only bodies with a built-in flash can fire one
  fl.style.display = capable ? '' : 'none';
  fl.className = 'vf-flash' + (capable && state.opts.flash ? ' on' : '');
  fl.textContent = '⚡';
  $('hudIso').textContent = state.film ? 'ISO ' + state.film.iso : 'no film';
  $('hudReadout').textContent = (h.shutter ? h.shutter : '—')
    + (h.focus_hint ? ` · ${h.focus_hint}` : '') + ' · +0.0 EV';
  // the finder shows how the body focuses: an AF box for autofocus bodies, frame lines and
  // a patch for a rangefinder, a focus screen for an SLR, nothing for a scale-focus camera
  // — a camera with no focusing aid does not get one drawn onto its glass.
  $('vfStage').dataset.focus = cam?.focus_mode || 'af';
  $('hudBattFill').style.width = state.battery + '%';
  $('hudBattPct').textContent = state.battery + '%';
  $('hudBatt').classList.toggle('low', state.battery < 20);
}
function renderOpts(){
  $('optDate').classList.toggle('on', state.opts.date);
  const capable = state.cam?.hud?.flash === 'on';
  $('optFlash').classList.toggle('disabled', !capable);
  $('optFlash').classList.toggle('on', capable && state.opts.flash);
}

/* main-screen counters: the FRAMES LEFT plate, which states the roll's whole arithmetic in
   one place — what is left, of how many exposures, how many were taken. The bezel no longer
   repeats a count, so this plate is the only exposure readout on the main screen. */
function renderCounter(){
  // no roll in the camera reads as a blank counter, the way a real camera does
  const threaded = !!state.rollId;
  $('counter').textContent = threaded ? String(state.shotsLeft).padStart(2, '0') : '—';
  $('expTotal').textContent = threaded ? `OF ${rollCapacity()} EXP` : 'NO ROLL';
  $('shotDone').textContent = threaded ? `SHOT ${String(state.frames.length).padStart(2, '0')}` : '';
  // a finished roll is a state, not a broken number: the LED goes dark instead of shouting
  $('counterPlate').classList.toggle('done', threaded && state.shotsLeft === 0);
}
/* the shutter answers the counter: one short LED blink on the number that just changed.
   It is feedback at the number, not a dialog — the shot itself is shown on the glass. */
function pulseCounter(){
  const n = $('counter');
  n.classList.remove('tick'); void n.offsetWidth;   // restart the animation on every frame
  n.classList.add('tick');
}
/* the camera deck: one dock entry, two pages. The roll this body holds is the left page and
   the bag of bodies is the right page. A swipe moves the track; the tabs follow wherever the
   track actually is, so tapping a tab and dragging a page mean the same thing. */
function deckSync(){
  const track = $('deckTrack');
  if (!track || !track.clientWidth) return;
  const atCam = track.scrollLeft > track.clientWidth * 0.5;
  $('deckRollTab').classList.toggle('on', !atCam);
  $('deckCamTab').classList.toggle('on', atCam);
}
function deckShow(page){
  const track = $('deckTrack');
  if (!track || !track.clientWidth) return;
  track.scrollTo({ left: page === 'camera' ? track.clientWidth : 0, behavior: 'smooth' });
  deckSync();
}
function openDeck(page){
  $('deckModal').classList.add('open');
  deckShow(page === 'camera' ? 'camera' : 'roll');
}

/* the deck's roll page owns everything about the current roll: develop appears only
   after shooting, the contact sheet only after developing (the main screen
   is just the shutter — feature entries never share its visual weight). */
function renderRollPage(){
  const has = state.frames.length > 0;
  // a medium-format body says what its roll is, because its roll really is different
  const gateNote = state.cam?.gate ? ` · ${state.cam.gate.film} roll, ${state.cam.gate.short_mm}×${state.cam.gate.long_mm}mm gate` : '';
  $('rollStatus').textContent = isDeveloping ? 'in the developer · wait for the fixer'
    : state.developed ? 'roll developed · archived · load a fresh roll'
    : !state.rollId ? 'no roll in the camera · load a film'
    : has ? `${state.frames.length} frames exposed · latent until developed${gateNote}`
    : state.shotsLeft === 0 ? 'roll finished · develop it' : `roll loaded · ${state.shotsLeft} frames left${gateNote}`;
  $('developRoll').style.display = has && !state.developed ? '' : 'none';
  $('developRoll').disabled = isDeveloping;
  $('developRoll').classList.toggle('ready', !!state.rollId && has && state.shotsLeft === 0 && !state.developed);
  /* The roll's own numbers, in the same LED tone the camera uses — here stated against this
     body's capacity, so 00 reads as finished rather than as a broken counter. */
  const rc = $('rollCount');
  rc.querySelector('b').textContent = state.rollId ? String(state.shotsLeft).padStart(2, '0') : '—';
  rc.querySelector('span').textContent = state.rollId
    ? `of ${rollCapacity()} left · ${state.cam?.gate ? state.cam.gate.film : '135'} roll`
    : 'no roll threaded';
  rc.classList.toggle('done', !!state.rollId && state.shotsLeft === 0);
  /* Before the tank runs, the page says what will happen to the roll and that it cannot be
     taken back: development is not a preview you can cancel. */
  $('devNote').style.display = has && !state.developed && !isDeveloping ? '' : 'none';
  $('sheetBtn').style.display = state.sheet ? '' : 'none';
  /* the deck's red pulse is the roll's own warning: a finished roll sitting in this body is
     waiting for the developer, and the deck's left page is where it is resolved */
  $('openDeck').classList.toggle('ready', !!state.rollId && has && state.shotsLeft === 0 && !state.developed);
  // standalone develop action on the main screen: shoot → develop, right here
  $('developMain').style.display = !!state.rollId && has && state.shotsLeft === 0 && !state.developed ? '' : 'none';
  $('developMain').textContent = `DEVELOP ROLL · ${state.frames.length} EXPOSURES DONE`;
  $('developMain').disabled = isDeveloping;
}

/* sleep is a shared util: the developer phases and the preview both wait on it. */
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

/* test hook: ?feed=0.56 pretends the sensor feed is a phone held portrait, so the window's
   tall path can be measured without a real camera. Nothing in the app ever passes a number. */
const FEED_OVERRIDE = parseFloat(new URLSearchParams(location.search).get('feed')) || 0;

let vfAspect = 0;
/* The vertical room a screen leaves unused below the film strip belongs to the finder: the
   strip, the develop action and the reserved dock row are fixed, so whatever sits below them
   is slack nobody is using. The slack is signed — negative means the page has crossed the
   line the dock reserves and the window gives room back. Each frame moves toward zero, so the
   page never scrolls and the strip ends up resting above the thumb row. */
function finderSlack(){
  const strip = document.querySelector('.strip');
  if (!strip || strip.offsetParent === null) return 0;
  const pb = parseFloat(getComputedStyle(document.body).paddingBottom) || 112;
  let bottom = strip.getBoundingClientRect().bottom;
  const dev = $('developMain');
  if (dev && dev.offsetParent !== null) bottom = Math.max(bottom, dev.getBoundingClientRect().bottom);
  return Math.floor(innerHeight - pb - bottom);
}
/* The rotated page spends its height on what sits below the finder — the strip, plus the
   develop bar when a roll is finished — and on the header above it; the thumb rail is fixed,
   so it spends none of it. The remainder is the room the LCD may take, measured every frame
   from the page's own positions, so DEVELOP appearing takes room back and the page never
   scrolls. The shape comes from the body's aspect, so the room only ever sizes the box. */
function landscapeRoom(){
  const stage = $('vfStage');
  if (!stage) return 140;
  const sr = stage.getBoundingClientRect();
  const pb = parseFloat(getComputedStyle(document.body).paddingBottom) || 8;
  let bottom = sr.bottom;
  const strip = document.querySelector('.strip');
  if (strip && strip.offsetParent !== null) bottom = Math.max(bottom, strip.getBoundingClientRect().bottom);
  const dev = $('developMain');
  if (dev && dev.offsetParent !== null) bottom = Math.max(bottom, dev.getBoundingClientRect().bottom);
  const below = bottom - sr.bottom;   // the strip and the develop bar ride the box's bottom, so their offset is fixed
  return Math.max(140, Math.floor(innerHeight - pb - below - sr.top));
}
/* a screen with no signal is dark, not holding the last frame: a frozen picture on a dead
   sensor would claim the camera is still working. Painted once, until a feed comes back. */
let lcdDark = false;
function deadLCD(){
  if (lcdDark || !vf.width || !vf.height) return;
  const ctx = vf.getContext('2d');
  ctx.fillStyle = '#0d0b09';
  ctx.fillRect(0, 0, vf.width, vf.height);
  lcdDark = true;
}
function renderViewfinder(){
  // The finder box is the BODY's frame, not the sensor's: a gate body shows the shape it
  // prints (6×7 / 6×4.5 at real ratio), a 135 compact keeps a compact LCD box (~4:3). The
  // sensor feed is then drawn COMPLETE inside that box by the engine — centred at its true
  // aspect, never stretched to fill it, never trimmed to its corner. A phone sensor held
  // portrait therefore gets the dark bars a real compact screen shows around a frame it
  // cannot display, and the page never grows taller than the layout can hold.
  const src = video;
  if (!feedLive()){ deadLCD(); return; }   // no sensor means no picture: the LCD goes dark and the status line says so
  lcdDark = false;
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) return;
  const gate = state.cam?.gate?.aspect;   // what this body prints, when it prints at all
  const stage = $('vfStage');
  const cssW = stage.clientWidth || 320;
  let box = gate ? Math.min(1.6, Math.max(0.7, gate)) : 1.333;
  if (!gate && matchMedia('(orientation:portrait)').matches){
    // the window is the compact's own screen: it takes the feed's shape, standing tall when
    // the phone is held portrait, and grows only into the vertical space the page leaves free
    const feed = Math.min(1.333, Math.max(0.5, FEED_OVERRIDE || sw / sh));
    const cur = stage.clientHeight || Math.round(cssW / 1.333);
    const tall = Math.max(140, Math.min(Math.round(cssW / feed), cur + finderSlack()));
    box = cssW / tall;
  }
  if (Math.abs(vfAspect - box) > 0.005){
    vfAspect = box;
    stage.style.aspectRatio = String(box);
  }
  if (!matchMedia('(orientation:portrait)').matches){
    // a rotated page sizes the box from the room it can spare, at this body's own shape —
    // the thumb rail is fixed and spends none of that room, so it only ever goes to the LCD
    const housing = stage.parentElement;
    const cs = getComputedStyle(housing);
    const availW = (housing.clientWidth || 320) - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const w = Math.max(120, Math.min(availW, Math.round(landscapeRoom() * box)));
    const h = Math.max(96, Math.round(w / box));
    if (Math.abs(stage.offsetWidth - w) > 1 || Math.abs(stage.offsetHeight - h) > 1){
      stage.style.width = w + 'px';
      stage.style.height = h + 'px';
    }
  }
  const cw = previewW, ch = Math.max(2, Math.round(previewW / box));
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
  const g = $('stripFrames');
  // A spool pulled out of the opened door stays out until a new one is threaded; rendering
  // the strip is the moment the chamber changes, so transient motion ends here — otherwise a
  // pulled strip keeps its transform and every later roll sits off the strip forever.
  g.classList.remove('advance', 'slidein', 'pullout'); g.innerHTML = '';
  // the strip shows the roll this body holds: 36 cells on a 135 camera, 8 on a 6×7.
  for (let i = 0, n = rollCapacity(); i < n; i++){
    const el = document.createElement('div');
    const f = state.frames[i];
    const dev = f && (f.developed || state.developed); // developing the roll reveals every exposed frame
    /* a frame the light destroyed stays on the strip as a mark: the roll did not lose those
       frames, it lost what was on them. Grey, hatched, still numbered where the light hit. */
    const foggedHere = !f && state.fogged > i;
    el.className = 'frame' + (f ? (dev ? ' developed' : ' latent') : foggedHere ? ' fogged' : '');
    const num = document.createElement('span'); num.className = 'num'; num.textContent = String(i + 1).padStart(2, '0');
    el.appendChild(num);
    if (state.film && !foggedHere){
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
    } else if (foggedHere){
      el.title = `frame ${i + 1} · fogged — the back door was opened before this roll was developed`;
    } else {
      el.title = `frame ${i + 1} · not exposed`;
    }
    g.appendChild(el);
  }
  /* the frame the camera is sitting on — the newest exposure — takes the selection hairline,
     the way a real camera knows which frame is under the gate. Tapping another cell moves it
     there until the chamber changes again. */
  if (state.frames.length) g.children[state.frames.length - 1]?.classList.add('sel');
}
function previewFrame(el, url){
  /* one frame is under the loupe at a time: the selection hairline moves to the cell you
     asked for, and renderStrip() drops it when the chamber changes. */
  for (const s of $('stripFrames').querySelectorAll('.frame.sel')) s.classList.remove('sel');
  el.classList.add('sel');
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
    // a roll still in the camera is resolved on the deck's left page, not in the archive
    el.onclick = () => { $('galleryModal').classList.remove('open'); openDeck('roll'); };
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
      el.innerHTML = `<div class="meta"><span>${esc(r.film)} · ${r.frames.length} frames</span><span class="sub">${esc(r.cam)} · ${fmtDate(r.loadedAt)}</span>`
        + `<button class="delbtn" title="take this roll off the shelf — its prints go with it">DELETE</button></div>`
        + `<div class="rollmeta">LOADED ${fmtDate(r.loadedAt)} · DEVELOPED ${fmtDate(r.developedAt)} · STATUS DEVELOPED${r.iso ? ' · ISO ' + r.iso : ''}${r.format && !/135/.test(r.format) ? ' · ' + esc(r.format) : ''}${favs ? ' · ★ ' + favs : ''}${r.notes ? ' · ' + esc(r.notes) : ''}</div>`
        + `<div class="mini">${r.frames.slice(0, 8).map(f => `<img src="${f.t}" alt="">`).join('')}</div>`;
      el.onclick = () => openRoll(r);
      /* Taking a roll off the shelf is irreversible, so the button arms on the first press and
         only the second press removes it; an arm nobody acts on expires by itself, and the
         shelf says what left with the roll. */
      const del = el.querySelector('.delbtn');
      let armed = 0;
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!armed){
          del.classList.add('armed'); del.textContent = 'CONFIRM';
          armed = setTimeout(() => { armed = 0; del.classList.remove('armed'); del.textContent = 'DELETE'; }, 6000);
          return;
        }
        clearTimeout(armed); armed = 0;
        const gone = r.frames.length;
        if (await deleteArchivedRoll(r)){
          renderArchive();
          toast(`${r.film} removed from the shelf · ${gone} prints gone · a backup file keeps anything you exported`);
        }
      };
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
    + (r.format && !/135/.test(r.format) ? `<div class="mrow"><span>NEGATIVE</span><span>${esc(r.format)}</span></div>` : '')
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
   THIS BUILD IS A TEST BUILD: WEB_LICENSE='all' opens every finished stock and body so each
   one's colour science and operation can be tried in the browser. Profiles keep their tier, so
   the business model is untouched — set it back to 'free' to re-lock the web demo to the free
   tier before this goes out to users. One gate for both shelves: a profile is a profile. */
const WEB_LICENSE = 'all'; // 'free' = production gate · 'all' = every finished profile loadable
function entitled(item){ return WEB_LICENSE === 'all' || item.tier === 'free'; }
function cameraState(c){ return entitled(c) ? 'avail' : 'lock'; }
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
   can instead of being clipped at the edge. Both boxes are measured inside the fixed
   32-unit band of the 48×72 print — a long name takes smaller type, never a wider can. */
const CAN_TEXT_BOX = 28;
const CAN_ISO_BOX = 22;
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
/* 35mm canister printed from the stock's own can colours — a collectible mark, not a photo
   of the film; the actual look is shown by the engine preview below.
   The geometry below is FIXED for every stock (one 48×72 print, cap/body/band/foot at the same
   coordinates), because a shelf of collectibles only reads as a row when every can is the same
   size: a longer film name shrinks its own type, never the can, and every ISO number sits on
   the same baseline. Brand colours and lettering stay per-stock. */
const CAN_GEO = {
  capY: 4, capH: 7,          // cap: 4→11
  bodyY: 11, bodyH: 52,      // body: 11→63, container 72 → identical bottom gap on every can
  bandY: 20, bandH: 26,      // label band: 20→46, centred at 33 whether the name is 1 or 2 lines
  label1: 34.2, labelTop: 29.6, labelLow: 36.2, // fixed baselines for both cases
  isoY: 56.5,                // every ISO number on the same baseline
  footY: 61, footH: 2,       // the dark end of the can, inside the body
};
function canSvg(f){
  const c = f.can || { body: '#2b2723', band: '#d8c9a9', label: '35' };
  const g = CAN_GEO;
  const lines = canLines(c.label);
  const ink = canInk(c.band);
  const two = lines.length > 1;
  let y = two ? g.labelTop : g.label1;
  const labelRuns = lines.map(l => {
    const fit = monoFit(l, CAN_TEXT_BOX, two ? 8.4 : 9.2, 5.4);
    const run = `<text x="24" y="${y.toFixed(1)}" text-anchor="middle" fill="${ink}" textLength="${fit.w}" lengthAdjust="spacingAndGlyphs"`
      + ` style="font-family:'PC Mono',ui-monospace,monospace;font-size:${fit.fs.toFixed(2)}px;font-weight:700">${esc(l)}</text>`;
    y += g.labelLow - g.labelTop;
    return run;
  }).join('');
  const isoFit = monoFit(String(f.iso || ''), CAN_ISO_BOX, 7.4, 4.6);
  return `<svg class="cansvg" viewBox="0 0 48 72" width="48" height="72" aria-hidden="1">`
    + `<rect x="8" y="${g.capY}" width="32" height="${g.capH}" rx="3" fill="${c.body}" opacity=".72"/>`
    + `<rect x="8" y="${g.bodyY}" width="32" height="${g.bodyH}" rx="3.5" fill="${c.body}"/>`
    + `<rect x="8" y="${g.bandY}" width="32" height="${g.bandH}" fill="${c.band}"/>`
    + labelRuns
    + `<text x="24" y="${g.isoY}" text-anchor="middle" fill="${canInk(c.body)}" opacity=".85" textLength="${isoFit.w}" lengthAdjust="spacingAndGlyphs"`
    + ` style="font-family:'PC Mono',ui-monospace,monospace;font-size:${isoFit.fs.toFixed(2)}px;font-weight:700">${esc(String(f.iso || ''))}</text>`
    + `<rect x="12" y="${g.footY}" width="24" height="${g.footH}" rx="1" fill="${c.band}" opacity=".5"/></svg>`;
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
/* One badge component for both shelves, so a camera card and a film card say the same words
   in the same shape. A card states its relation to the camera in exactly one place, and the
   words never contradict each other:
   SELECTED (in the camera now) · AVAILABLE (selectable now) · UNLOCKED (a Pro stock this
   build opened) · LOCKED · PRO (finished, needs Pro) · COMING SOON (still being made).
   A LOCKED · PRO badge already names the tier, so a locked card never also carries the PRO
   tag — two marks saying one thing is exactly the confusion the user ruled out. */
function stateChip(st){
  if (st === 'sel') return '<span class="stchip sel">SELECTED</span>';
  if (st === 'unlock') return '<span class="stchip unlock">&#9679; UNLOCKED</span>';
  if (st === 'lock') return '<span class="stchip lock">&#128274; LOCKED · PRO</span>';
  if (st === 'soon') return '<span class="stchip soon">COMING SOON</span>';
  return '<span class="stchip avail">AVAILABLE</span>';
}
/* The badge comes from the live camera, not from the profile alone: whatever is loaded says
   SELECTED, and an opened Pro stock says UNLOCKED instead of pretending it is free stock. */
function shelfState(kind, item){
  const active = kind === 'cam' ? (state.cam?.id === item.id) : (state.film?.id === item.id);
  if (active) return 'sel';
  const base = kind === 'cam' ? cameraState(item) : filmState(item);
  return base === 'avail' && item.tier !== 'free' ? 'unlock' : base;
}
/* The body glyph: every card in the bag is drawn on the same 44×44 plate, so the bag reads
   as a collection of equipment rather than a table of numbers. The silhouette is derived from
   the profile only — lens radius from the stated focal length, a rangefinder window for a
   rangefinder, a prism hump for an SLR, a film back for a gate body, a flash housing only
   where the body really has one. Nothing is invented for a body that does not state it. */
function camSvg(c){
  const focal = c.lens?.focal_mm || 35;
  const r = Math.max(7.5, Math.min(11.5, focal / 4.4));
  const med = !!c.gate;
  const by = med ? 8 : 11, bh = med ? 24 : 19;
  const cy = by + bh / 2;
  const prism = c.focus_mode === 'slr' ? `<rect x="16" y="${by - 5}" width="12" height="6" rx="1.5"/>` : '';
  const win = c.focus_mode === 'rangefinder' ? `<rect x="5" y="${by + 2}" width="7" height="4.5" rx="1"/>` : '';
  const flash = c.hud?.flash === 'on' ? `<rect x="30" y="${by - 4}" width="7" height="5" rx="1"/>` : '';
  const back = med ? `<rect x="31" y="${by + 7}" width="8" height="10" rx="1.5"/>` : '';
  const tag = med ? `<text x="22" y="40" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="6" letter-spacing="1.2" fill="#9c917f" text-anchor="middle">${esc(c.gate.film)}</text>` : '';
  return `<svg viewBox="0 0 44 44" width="44" height="44" fill="none" stroke="#cfc5b4" stroke-width="1.2" aria-hidden="1">`
    + `<rect x="4" y="${by}" width="36" height="${bh}" rx="3"/>${prism}${win}${flash}${back}`
    + `<circle cx="22" cy="${cy}" r="${r}"/><circle cx="22" cy="${cy}" r="${Math.max(3, r - 4.5)}" stroke-opacity=".55"/>`
    + `<rect x="6" y="${by + bh - 3}" width="6" height="2.5" rx="1" stroke-opacity=".5"/>${tag}</svg>`;
}
/* What a stock actually does to a scene, in three swatches the engine itself rendered on a
   neutral card: shadow, midtone, highlight. It is the stock's identity, not a brand colour
   picked by hand — and the same parameters the preview meters show. Cached per stock. */
const LOOK_CACHE = {};
function lookSwatches(f){
  if (LOOK_CACHE[f.id]) return LOOK_CACHE[f.id];
  const cv = document.createElement('canvas'); cv.width = 39; cv.height = 8;
  const ctx = cv.getContext('2d');
  ['#3a3a3a', '#8a8a8a', '#e2cfa8'].forEach((hex, i) => { ctx.fillStyle = hex; ctx.fillRect(i * 13, 0, 13, 8); });
  try {
    const eng = new FilmEngine(cv); eng.setCombo(NEUTRAL_CAM, f); eng.process(cv, 39, 8);
    const px = cv.getContext('2d').getImageData(0, 0, 39, 8).data;
    const hex = x => { const i = (4 * 39 + x) * 4; return '#' + [px[i], px[i + 1], px[i + 2]].map(v => v.toString(16).padStart(2, '0')).join(''); };
    LOOK_CACHE[f.id] = [hex(6), hex(19), hex(32)];
  } catch { LOOK_CACHE[f.id] = null; }
  return LOOK_CACHE[f.id];
}
/* One short line about how the stock behaves in use — taken from the profile's own text and
   cut to a single line. The card never grows because of it: it truncates, and the full story
   belongs to the preview page. */
function vibeFor(f){
  const s = String(f.story || '').trim();
  if (!s) return '';
  const first = s.split(/(?<=[.!?])\s/)[0] || s;
  return first.length > 78 ? first.slice(0, 78).trimEnd() + '…' : first;
}
/* Every category already NAMES its lab — a colour negative is C-41, a slide is E-6, a cinema
   negative is ECN-2 — so the card states the category once and never prints its lab twice.
   A process is only printed when it is NOT the one the category implies: Kodachrome's retired
   D-70 lab (and its discontinued status) is the single case that adds information, and it gets
   its own dim third line so the name and the ISO stay the loudest things on the card. */
const IMPLIED_LAB = { color_negative: 'C-41', bw: 'B&W', motion_negative: 'ECN-2', slide: 'E-6' };
function labLine(f){
  const p = String(f.process || '');
  const parts = [];
  if (p && p.toUpperCase() !== String(IMPLIED_LAB[f.type] || '').toUpperCase()) parts.push(p);
  if (String(f.status || '').startsWith('disc')) parts.push(f.status);
  return parts.length ? `<div class="d op">${esc(parts.join(' · '))}</div>` : '';
}
/* The category as the CARD prints it: caps, because the card is a shelf label, not a data
   dump — same tokens TYPE_TAG feeds the preview, never a second table that could drift. */
function categoryCap(f){ return String(TYPE_TAG[f.type] || '').toUpperCase(); }

/* ---------- film shelf: category tabs + brand caption groups ----------
   Built from profiles only, so it scales to dozens of expansion packs later. */
let filmCatOn = 'all';
/* ---------- camera bag: experience routes, not a flat list ----------
    A bag of bodies is organised by how it is used, and every item states its own
    operation — focal length, aperture, focusing system, exposure system, the gate the
    film prints at and how many frames that gate holds. Profiles drive it all, so a
    future camera pack only needs a profile. */
const BAG_ROUTES = [
  ['everyday', 'EVERYDAY COMPACT'], ['rangefinder', 'POCKET RANGEFINDER'],
  ['mechanical', 'MECHANICAL CLASSIC'], ['premium', 'PREMIUM COMPACT'], ['medium', 'MEDIUM FORMAT'],
];
function lensLine(c){
  return c.lens.focal_mm ? `${c.lens.focal_mm}mm ${c.lens.aperture}` : String(c.lens.aperture);
}
function gateLine(c){
  const g = c.gate;
  return g ? `${g.film} · ${g.short_mm}×${g.long_mm}mm · ${c.frames} frames`
    : `135 film · ${c.frames} frames`;
}
/* The body's technical sheet, printed only when it is opened: one line per system, never a
   paragraph. The character line on the card comes from the profile's own vibe; the prose
   stays out of the collection view, which is what makes the bag scannable on a phone. */
function specLines(c){
  const rows = [['FOCUS', `${c.focus_system}${c.focus_mode ? ` · ${c.focus_mode}` : ''}`],
    ['EXPOSURE', c.exposure_system], ['FILM', gateLine(c)]];
  if (c.lens?.elements) rows.push(['LENS', `${lensLine(c)} · ${c.lens.elements}`]);
  if (c.features?.length) rows.push(['NOTES', c.features.join(' · ')]);
  if (c.price_usd) rows.push(['MARKET', String(c.price_usd)]);
  return rows.map(([k, v]) => `<span>${k} · ${esc(v)}</span>`).join('');
}
function buildLists(){
  const cl = $('camList'); cl.innerHTML = '';
  BAG_ROUTES.forEach(([route, label]) => {
    const inRoute = state.cameras.filter(c => c.route === route);
    if (!inRoute.length) return;
    const cap = document.createElement('div');
    cap.className = 'brandcap'; cap.textContent = label;
    cl.appendChild(cap);
    inRoute.forEach(c => {
      // the badge comes from the live camera (shelfState), so nothing on the card contradicts
      // what the camera actually holds: SELECTED, AVAILABLE, UNLOCKED, LOCKED · PRO
      const st = shelfState('cam', c);
      const el = document.createElement('div');
      el.className = 'item camitem' + (st === 'sel' ? ' active' : '') + (st === 'lock' ? ' locked' : '');
      /* The PRO tag marks catalog tier, not availability — the same discipline as the film
         shelf. A card already saying LOCKED · PRO does not also carry the tag: two marks
         saying one thing is the confusion the user ruled out. */
      const proTag = c.tier !== 'free' && st !== 'lock' ? '<span class="protag">PRO</span>' : '';
      /* What a collector scans: the name, the year, the lens, and how the body behaves in
         hand. The technical sheet sits behind a disclosure row, so the bag reads as equipment,
         not as a database, and every card in the bag is the same height. */
      el.innerHTML = `<div class="ic">${camSvg(c)}</div>`
        + `<div class="txt"><div class="t"><span class="nm">${esc(c.brand)} ${esc(c.model)}</span>${proTag}</div>`
        + `<div class="d">${c.year} · ${lensLine(c)}</div>`
        + `<div class="d vibe">${esc(c.vibe)}</div>`
        + `<div class="specrow" role="button" tabindex="0">SPECIFICATION<span>show</span></div>`
        + `<div class="spec">${specLines(c)}</div></div>` + stateChip(st);
      const row = el.querySelector('.specrow'), spec = el.querySelector('.spec');
      const toggle = () => {
        spec.classList.toggle('on');
        row.querySelector('span').textContent = spec.classList.contains('on') ? 'hide' : 'show';
      };
      // opening the sheet must not swap the camera: the row answers its own click only
      row.onclick = e => { e.stopPropagation(); toggle(); };
      row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); toggle(); } };
      el.onclick = () => {
        if (st === 'lock'){ proHint(); return; }
        // a body that holds a different roll refuses the swap until the roll is resolved
        if (!loadCamera(c)) return;
        // the deck stays open on its camera page: the shelf itself says SELECTED now,
        // so closing the page would be the page saying nothing at the moment it changed
        buildLists();
      };
      cl.appendChild(el);
    });
  });
  const bagGate = $('bagGate');
  if (bagGate) bagGate.textContent = WEB_LICENSE === 'all'
    ? 'test build · every finished body is open here so its operation can be tried. the released web keeps the free five; PRO bodies unlock in the Pro APK.'
    : '';
  buildFilmList();
}
function buildFilmList(){
  const fl = $('filmList'); fl.innerHTML = '';
  document.querySelectorAll('#filmTabs .tab').forEach(t => t.classList.toggle('on', t.dataset.cat === filmCatOn));
  const visible = state.films.filter(f => filmCatOn === 'all' || filmCat(f) === filmCatOn);
  const byBrand = {};
  visible.forEach(f => { (byBrand[f.brand] = byBrand[f.brand] || []).push(f); });
  const brands = Object.keys(byBrand).sort((a, b) => byBrand[b].length - byBrand[a].length || a.localeCompare(b));
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
      // one badge from the live camera state; the card never says two things about availability
      const st = shelfState('film', f);
      const el = document.createElement('div');
      el.className = 'item filmitem' + (st === 'sel' ? ' active' : '') + (st === 'lock' ? ' locked' : '');
      /* The PRO tag marks catalog tier, not availability — it stays beside the name in both
         licence modes and truncates the name instead of colliding with it. A card already
         saying LOCKED · PRO carries no second tier mark. */
      const proTag = f.tier !== 'free' && st !== 'lock' ? '<span class="protag">PRO</span>' : '';
      /* The second line states the stock ONCE: ISO value, the ISO label, then the category —
         see labLine, which is what keeps a lab process from ever repeating that category.
         The swatches get their own line below it: inline they would be clipped by a long
         identity and would grow the card. */
      const look = lookSwatches(f);
      const meta = `<div class="d">${f.iso} ISO · ${categoryCap(f)}</div>${labLine(f)}`
        + (look ? `<div class="look">${look.map(h => `<i style="background:${h}"></i>`).join('')}</div>` : '');
      /* A short line about how the stock behaves in use, taken from the profile and cut to one
         line — the story itself belongs to the preview page, never to the list. */
      const vibe = vibeFor(f);
      el.innerHTML = `<div class="ic">${canSvg(f)}</div>`
        + `<div class="txt"><div class="t"><span class="nm">${esc(f.brand)} ${esc(f.name)}</span>${proTag}</div>${meta}`
        + (vibe ? `<div class="d vibe">${esc(vibe)}</div>` : '') + `</div>` + stateChip(st);
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
    return `<div class="pvbar"><span class="lbl">${k}</span><span class="track"><i style="width:${n}%"></i></span><span class="val">${n}</span></div>`;
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
  // the preview answers the same vocabulary the shelf uses, including the stock in the camera
  const st = shelfState('film', f);
  hideSwapGate();
  $('pvTitle').textContent = `${f.brand} ${f.name}`;
  /* The preview must say exactly what the shelf chip says. A finished Pro stock is not
     "in production" — that phrasing reads as unfinished, which is the confusion the user
     ruled out: LOCKED means finished and unlocked by buying Pro, COMING SOON means still
     being made. In a test build a Pro stock is open, and the line says exactly that —
     opening it here does not claim the free web demo owns it permanently. */
  let statusLine;
  if (st === 'sel') statusLine = 'IN THE CAMERA NOW';
  else if (st === 'soon') statusLine = 'IN DEVELOPMENT';
  else if (st === 'lock') statusLine = 'PRO STOCK · UNLOCKS IN THE PRO APK';
  else if (st === 'unlock') statusLine = f.status.startsWith('disc') ? 'DISCONTINUED PRO STOCK · OPEN FOR TESTING HERE' : 'PRO STOCK · OPEN FOR TESTING HERE';
  else statusLine = 'AVAILABLE NOW';
  // the lab process belongs with the stock's identity, not buried in a footnote
  $('pvMeta').textContent = `${f.iso} · ${TYPE_TAG[f.type]} · ${statusLine}${f.process ? ` · PROCESS ${f.process}` : ''} · samples rendered by the POCKETROLL engine on a neutral body`;
  $('pvStory').textContent = f.story || '';
  renderParamBars(f);
  /* Previewing and loading are different acts, so the page says which one it is doing before
     any samples: opening a stock never threads anything into the camera. */
  $('pvNote').textContent = st === 'sel'
    ? 'ALREADY LOADED · this page loads nothing. The roll in the camera is untouched by opening it.'
    : 'PREVIEW ONLY · this page loads nothing. LOAD FILM below threads a fresh roll into the camera.';
  const btn = $('pvLoad');
  btn.classList.toggle('locked', st === 'lock');
  if (st === 'sel'){
    // a stock already threaded cannot be "loaded" again; the roll it holds is the real state
    btn.textContent = 'ALREADY IN THE CAMERA'; btn.disabled = true; btn.onclick = null;
    $('pvHint').textContent = `threaded in ${state.cam?.model || 'this body'} · ${state.shotsLeft} frames left · develop or resolve the roll to change it`;
  } else if (st === 'avail' || st === 'unlock'){
    btn.textContent = 'LOAD FILM'; btn.disabled = false;
    btn.onclick = () => tryLoadFilm(f);
    $('pvHint').textContent = f.status.startsWith('disc')
      ? 'historical stock · its original lab process no longer exists, so this is an approximation — open here for testing'
      : f.tier !== 'free'
      ? 'test build: open here so the science can be checked · in the released web this stock unlocks in the Pro APK'
      : `loads a fresh roll in this body · ${rollCapacity()} frames · swapping bodies never resets it`;
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

/* ---------- the user manual ----------
   The booklet itself is print in index.html, not code; only its edition number is written
   here, in one place. Bump it when the camera bag, the film shelf, or the workflows the
   booklet describes change materially — updating a number needs no redesign. */
const MANUAL_EDITION = '01';

/* ---------- build notice ----------
   CACHE in sw.js is bumped on every deploy. The page compares it with the build it was
   shipped with, so a stale cached app says a newer one exists instead of quietly staying
   behind — the user reloads on purpose rather than serving old code forever. BUILD and
   CACHE must be equal in any shipped commit: bump the two together, never apart. */
const BUILD = 'pocketroll-v32';
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

/* ---------- the leader screen ----------
   A film leader, not a spinner. The app has no picture to show before the sensor answers, and
   drawing a stand-in scene would claim the camera is working when it is not — so the first
   screen says what it is waiting for, quietly. It leaves once the camera has answered either
   way: a feed, or an honest blocked. The page then opens straight into the camera, ready to
   press the shutter. */
function bootSay(msg, st){
  const line = document.querySelector('.bootline');
  const msgEl = $('bootMsg');
  if (msgEl) msgEl.textContent = msg;
  if (line) line.className = 'bootline' + (st ? ' ' + st : '');
}
function bootHide(){
  const b = $('bootScreen');
  if (!b || b.classList.contains('gone')) return;
  b.classList.add('gone');
  setTimeout(() => { b.style.display = 'none'; }, 520); // out after the fade, never hidden underneath it
}
async function openCamera(){
  await initCamera();
  const live = await waitForFeed();
  bootSay(live ? 'camera ready · roll in chamber' : 'camera blocked · SETTINGS → RETRY CAMERA', live ? 'ready' : 'blocked');
  setTimeout(bootHide, live ? 420 : 950);
  return live;
}

/* ---------- wire up ---------- */
async function boot(){
  try{
    const [camRes, filmRes] = await Promise.all([fetch('assets/cameras.json'), fetch('assets/films.json')]);
    state.cameras = (await camRes.json()).cameras;
    state.films = (await filmRes.json()).films;
  }catch(e){
    bootSay('profiles failed to load', 'blocked');
    bootHide();
    toast('assets load failed: ' + (e && e.message ? e.message : String(e)));
    return;
  }
  buildLists();
  /* Nothing stands in for the sensor. The finder waits for the feed, and the leader screen
     says what it is waiting for while profiles, the pending roll and storage are being read. */
  const q = new URLSearchParams(location.search);
  const cam = state.cameras.find(c => c.id === q.get('cam')) || state.cameras.find(c => c.id === 'trip35');
  const fil = state.films.find(f => f.id === q.get('film')) || state.films.find(f => f.id === 'gold200');
  if (q.get('date') === '1') state.opts.date = true; // test hook: force date stamp for this run
  loadCamera(cam, { quiet: true });
  if (q.get('hud') === 'full') $('hud').classList.add('full');
  $('vfStage').addEventListener('click', () => $('hud').classList.toggle('full'));
  renderCamState();
  await loadArchives();
  /* A half-shot roll belongs in the camera, not in the archive: reopening the app puts the
     same roll back with the same frames and the same counter — the ritual survives a refresh.
     Test hooks that name gear explicitly (?cam/?film/?autoshot/?dev/?fresh) start clean so
     checks stay deterministic. The roll in the camera is never replaced by a fresh one: a
     restore must not leave a second empty roll on record behind it. */
  const freshIntent = q.has('cam') || q.has('film') || q.has('autoshot') || q.has('dev') || q.has('fresh');
  if (!freshIntent && pendingRoll) {
    restoreCurrentRoll(pendingRoll);
    if (!state.film) applyFilm(fil); // a restored roll always names its stock on the plate
  } else {
    loadFilm(fil, { force: true });
    renderStrip();
  }
  renderHud();
  renderArchive();
  // ask the browser to keep our data; best effort, and the result is stated in the storage note
  if (navigator.storage && navigator.storage.persist) { try { state.persisted = await navigator.storage.persist(); } catch {} }
  checkNewVersion();
  // the finder sleeps when the page goes to the background and wakes on foreground:
  // sensor lifecycle is owned by camera/camera-manager.js
  wireCameraLifecycle();
  loop();
  /* The leader screen waits for the sensor; the shutter only answers when there is a feed.
     Test hooks fire after that same settlement, exactly as a real first press would. */
  openCamera().then(live => {
    if (!live) return;
    if (q.get('autoshot') === '1') {
      const shots = Math.max(1, Number(q.get('shots')) || 3); // ?shots=36 to expose a whole roll
      setTimeout(() => { for (let i = 0; i < shots; i++) capture(); }, 900);
    }
    if (q.get('dev') === '1') setTimeout(developRoll, 2600); // test hook: develop the roll after autoshots
  });

  $('shutter').onclick = capture;
  // the camera deck opens on the roll page — the roll in the camera is what matters at the shutter
  $('openDeck').onclick = () => openDeck('roll');
  $('deckRollTab').onclick = () => deckShow('roll');
  $('deckCamTab').onclick = () => deckShow('camera');
  $('deckTrack').addEventListener('scroll', deckSync, { passive: true });
  $('openGallery').onclick = () => $('galleryModal').classList.add('open');
  $('openSettings').onclick = () => $('settingsModal').classList.add('open');
  // the manual is a page, not a feature: opening it changes nothing about camera or roll.
  // it replaces the settings page rather than stacking over it, so closing it lands on the camera.
  $('openManual').onclick = () => { $('settingsModal').classList.remove('open'); $('manualModal').classList.add('open'); };
  const ed = $('manualEdition');
  if (ed) ed.textContent = 'POCKETROLL 35 · USER MANUAL · EDITION ' + MANUAL_EDITION;
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
  if (retry) retry.onclick = async () => { await initCamera(); renderCamState(); if (feedLive()) toast('camera feed restored'); };
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
  // test hook: ?page=roll|gallery|settings|bag|manual opens that page directly
  // (roll and bag are the two pages of the camera deck — bag lands on the right page)
  const page = q.get('page');
  if (page === 'roll') openDeck('roll');
  if (page === 'gallery') $('galleryModal').classList.add('open');
  if (page === 'settings') $('settingsModal').classList.add('open');
  if (page === 'bag') openDeck('camera');
  if (page === 'manual') $('manualModal').classList.add('open');
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
