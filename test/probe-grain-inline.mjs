
(async () => {
  const EW = 1920, EH = 1080;      // what a phone export produces
  const PW = 390, PH = 219;        // what a phone viewfinder actually paints
  const SHOWN = 360;               // what an exported frame is displayed at on a phone
  const BEFORE = { amp: 34, size: 1.7, chromatic: 0.35, isoAmp: 0.5, base: 0.75, tile: true, fineMax: 1.6 };
  const AFTER = undefined;         // undefined = the shipped GRAIN defaults in app.js

  /* ?film=<id> renders one stock only (for phone-size screenshot review); ?scene=<id> keeps just
     that reference. The full run without params produces the tables below. */
  const Q = new URLSearchParams(location.search);
  const onlyFilm = Q.get('film');
  const onlyScene = Q.get('scene');
  let films = (await (await fetch('../assets/films.json')).json()).films
    .filter(f => ['gold200', 'portra400', 'trix400', 'cinestill800t'].includes(f.id));
  if (onlyFilm) films = films.filter(f => f.id === onlyFilm);
  const cellOf = (f, w, cfg) => {
    const g = cfg ? Object.assign({}, GRAIN, cfg) : GRAIN;
    const iso = Math.min(1.6, Math.max(0.8, Math.pow(f.iso / 100, 0.32)));
    return Math.max(1, (f.filter_params.grain_size || 1) * (w / 720) * g.size * iso);
  };
  const rect = (frac, w, h) => [Math.round(frac[0] * w), Math.round(frac[1] * h), Math.round(frac[2] * w), Math.round(frac[3] * h)];

  /* Deterministic synthetic references plus the real test photograph: identical pixels for both
     configs, so every difference measured here comes from grain and nothing else. Regions are
     fractions so the same reference works at viewfinder size and at export size. */
  const scenes = {};
  scenes.sky = { name: 'bright daylight 路 blue sky', flat: [0.18, 0.06, 0.5, 0.22], detail: [0.62, 0.6, 0.3, 0.3], draw(c, w, h){
    const g = c.createLinearGradient(0, 0, 0, h * 0.7);
    g.addColorStop(0, '#4f7fb8'); g.addColorStop(0.6, '#9dc0d8'); g.addColorStop(1, '#d8e4e8');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#c9d6dd'; c.fillRect(0, h * 0.62, w, h * 0.38);
    for (let i = 0; i < 7; i++){ const x = w * 0.6 + i * w * 0.055, hh = h * 0.24 + ((i * 37) % 160) / 400 * h;
      c.fillStyle = i % 2 ? '#5b6570' : '#48525d'; c.fillRect(x, h * 0.62 - hh, w * 0.045, hh);
      c.fillStyle = '#8d99a6'; c.fillRect(x + 6, h * 0.62 - hh + 10, w * 0.03, Math.max(4, h * 0.03)); }
    c.fillStyle = '#2c3239'; c.fillRect(w * 0.62, h * 0.62, Math.max(2, w * 0.005), h * 0.3);
  } };
  scenes.portrait = { name: 'portrait 路 soft skin', flat: [0.55, 0.42, 0.2, 0.2], detail: [0.32, 0.35, 0.42, 0.45], draw(c, w, h){
    const bg = c.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#6d6a63'); bg.addColorStop(1, '#3b3833');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    const skin = c.createRadialGradient(w * 0.55, h * 0.55, h * 0.02, w * 0.55, h * 0.55, h * 0.42);
    skin.addColorStop(0, '#e8b58c'); skin.addColorStop(1, '#a2704f');
    c.fillStyle = skin; c.beginPath(); c.ellipse(w * 0.55, h * 0.55, w * 0.19, h * 0.28, 0, 0, 7); c.fill();
    c.fillStyle = '#2a2220'; c.beginPath(); c.ellipse(w * 0.55, h * 0.28, w * 0.2, h * 0.17, 0, 0, 7); c.fill();
    c.fillStyle = '#6e4a36'; c.beginPath(); c.ellipse(w * 0.55, h * 0.9, w * 0.28, h * 0.18, 0, 0, 7); c.fill();
    c.strokeStyle = '#3a2b24'; c.lineWidth = Math.max(2, w * 0.008); c.beginPath(); c.moveTo(w * 0.35, h * 0.55); c.lineTo(w * 0.75, h * 0.55); c.stroke();
  } };
  scenes.sunset = { name: 'sunset 路 deep shadows', flat: [0.15, 0.1, 0.45, 0.18], detail: [0.66, 0.72, 0.28, 0.25], draw(c, w, h){
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2b3a4e'); g.addColorStop(0.45, '#c86a3c'); g.addColorStop(0.72, '#e6a256'); g.addColorStop(1, '#221a16');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const sun = c.createRadialGradient(w * 0.78, h * 0.58, h * 0.01, w * 0.78, h * 0.58, h * 0.25);
    sun.addColorStop(0, '#ffe6a8'); sun.addColorStop(1, 'rgba(255,200,120,0)'); c.fillStyle = sun; c.fillRect(w * 0.55, h * 0.3, w * 0.45, h * 0.6);
    c.fillStyle = '#161211'; c.fillRect(0, h * 0.72, w, h * 0.28);
    for (let i = 0; i < 5; i++){ c.fillStyle = '#1a1512'; c.fillRect(w * 0.66 + i * w * 0.07, h * 0.72 - h * 0.11 - i * h * 0.04, w * 0.05, h * 0.11 + i * h * 0.04); }
  } };
  scenes.indoor = { name: 'indoor lighting 路 flat wall', flat: [0.1, 0.25, 0.45, 0.25], detail: [0.64, 0.38, 0.22, 0.4], draw(c, w, h){
    const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#8b7b66'); g.addColorStop(0.55, '#a08f76'); g.addColorStop(1, '#6a5b4c');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const lamp = c.createRadialGradient(w * 0.18, h * 0.17, h * 0.01, w * 0.18, h * 0.17, h * 0.4);
    lamp.addColorStop(0, '#ffe2b2'); lamp.addColorStop(1, 'rgba(255,226,178,0)'); c.fillStyle = lamp; c.fillRect(0, 0, w * 0.46, h * 0.55);
    c.fillStyle = '#453c33'; c.fillRect(0, h * 0.78, w, h * 0.22);
    c.fillStyle = '#2f2822'; c.fillRect(w * 0.64, h * 0.38, w * 0.18, h * 0.42);
    c.fillStyle = '#c9b291'; c.fillRect(w * 0.69, h * 0.43, w * 0.08, h * 0.18);
  } };
  scenes.night = { name: 'night 路 deep blacks', flat: [0.15, 0.06, 0.45, 0.2], detail: [0.7, 0.55, 0.25, 0.3], draw(c, w, h){
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#10161f'); g.addColorStop(0.7, '#18202a'); g.addColorStop(1, '#20282f');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++){ const x = w * 0.72 + ((i * 60) % (w * 0.2)), y = h * 0.58 + ((i * 33) % (h * 0.28));
      const l = c.createRadialGradient(x, y, 2, x, y, h * 0.12);
      l.addColorStop(0, '#ffd9a0'); l.addColorStop(1, 'rgba(255,217,160,0)'); c.fillStyle = l; c.fillRect(x - h * 0.15, y - h * 0.15, h * 0.3, h * 0.3); }
    c.fillStyle = '#0b0f14'; c.fillRect(0, h * 0.66, w, h * 0.34);
  } };
  const street = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = '../assets/samples/street.jpg'; });
  if (street) scenes.street = { name: 'street photograph (real reference)', flat: [0.1, 0.1, 0.4, 0.2], detail: [0.55, 0.45, 0.35, 0.4], draw(c, w, h){ c.drawImage(street, 0, 0, w, h); } };

  const drawScene = (id, w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    scenes[id].draw(cv.getContext('2d'), w, h); return cv; };
  const flat = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').fillStyle = '#6e6e6e'; cv.getContext('2d').fillRect(0, 0, w, h); return cv; };

  /* Grain metrics on a structure-free surface: 蟽 is grain, colour 蟽 is dye speckle, and "blocky"
     is the share of neighbouring pixels carrying the SAME value 鈥?hard clump squares score ~0.8,
     a continuous clump texture scores near 0. That is the blockiness in question, measured. */
  function grainStats(cv, x, y, w, h){
    const d = cv.getContext('2d').getImageData(x, y, w, h).data;
    const lum = new Float32Array(w * h);
    let mean = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++){
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      lum[p] = l; mean += l;
    }
    mean /= lum.length;
    let sq = 0; for (const v of lum) sq += (v - mean) * (v - mean);
    // colour speckle = how much r鈭抌 VARIES pixel to pixel, not how warm the grade is: the mean
    // offset is the film's own cast and stays put; only the dye-layer noise moves.
    let cmean = 0; const cb = new Float32Array(lum.length);
    for (let i = 0, p = 0; i < d.length; i += 4, p++){ cb[p] = d[i] - d[i + 2]; cmean += cb[p]; }
    cmean /= cb.length;
    let csq = 0; for (const v of cb) csq += (v - cmean) * (v - cmean);
    let same = 0, hf = 0, n = 0;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w - 1; xx++){
      const dv = Math.abs(lum[yy * w + xx] - lum[yy * w + xx + 1]);
      if (dv < 0.6) same++; hf += dv; n++;
    }
    return { std: +Math.sqrt(sq / lum.length).toFixed(2), chroma: +Math.sqrt(csq / lum.length).toFixed(2), blocky: +(same / Math.max(1, n)).toFixed(2), hf: +(hf / Math.max(1, n)).toFixed(2) };
  }
  /* Structure on a real reference: gradient energy with grain 梅 gradient energy without grain.
     Grain sits on top of detail; if it smears detail away the ratio drops below 1. */
  function structureStats(cv, x, y, w, h){
    const d = cv.getContext('2d').getImageData(x, y, w, h).data;
    const lum = (xx, yy) => 0.2126 * d[(yy * w + xx) * 4] + 0.7152 * d[(yy * w + xx) * 4 + 1] + 0.0722 * d[(yy * w + xx) * 4 + 2];
    let g = 0;
    for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++)
      g += Math.abs(lum(xx + 1, yy) - lum(xx - 1, yy)) + Math.abs(lum(xx, yy + 1) - lum(xx, yy - 1));
    return g / (w * h);
  }
  /* Does the 256 tile actually repeat? The tile wraps whenever a frame is wider than 256路cell,
     so pixel x and x + 256路cell carry the SAME grain value: 蟻 = 1 means the grain pattern is
     literally printed twice across the frame, 蟻 鈮?0 means nothing repeats. A frame narrower than
     one tile cannot repeat 鈥?it reports wraps < 1 instead of a misleading 蟻. */
  function repeatStats(cv, cell){
    const w = cv.width, h = cv.height, p = Math.round(256 * cell), wraps = +(w / p).toFixed(2);
    const cols = w - p;
    if (p < 2 || cols < 16) return { rho: null, wraps };
    const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
    const lum = (x, y) => 0.2126 * d[(y * w + x) * 4] + 0.7152 * d[(y * w + x) * 4 + 1] + 0.0722 * d[(y * w + x) * 4 + 2];
    const A = [], B = [];
    for (let y = 4; y < h - 4; y += 2) for (let x = 0; x < cols; x++){ A.push(lum(x, y)); B.push(lum(x + p, y)); }
    const n = A.length; if (n < 16) return { rho: null, wraps };
    const mA = A.reduce((s, v) => s + v, 0) / n, mB = B.reduce((s, v) => s + v, 0) / n;
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++){ const a = A[i] - mA, b = B[i] - mB; cov += a * b; va += a * a; vb += b * b; }
    return { rho: +(cov / Math.sqrt(va * vb)).toFixed(2), wraps };
  }

  function render(src, w, h, film, cfg){
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const eng = new FilmEngine(cv); eng.setCombo(NEUTRAL_CAM, film); eng.setGrain(cfg);
    eng.process(src, src.width, src.height);
    return cv;
  }
  const shown = (cv) => { const p = document.createElement('canvas'); p.width = SHOWN; p.height = Math.round(SHOWN * cv.height / cv.width);
    p.getContext('2d').drawImage(cv, 0, 0, p.width, p.height); return p; };
  function card(cv, label, note){
    const div = document.createElement('div'); div.className = 'card';
    div.appendChild(cv);
    div.appendChild(Object.assign(document.createElement('div'), { className: 't', textContent: label }));
    div.appendChild(Object.assign(document.createElement('div'), { className: 'm', textContent: note }));
    return div;
  }

  const rowsA = [], rowsB = [];

  /* A 路 flat mid-tone at viewfinder size 鈥?the seam test */
  const hostA = document.getElementById('flatphone');
  for (const f of films){
    for (const [name, cfg] of [['BEFORE', BEFORE], ['AFTER', AFTER]]){
      const cv = render(flat(PW, PH), PW, PH, f, cfg);
      const st = grainStats(cv, 0, 0, PW, PH), cell = cellOf(f, PW, cfg);
      rowsA.push({ film: f.id, surface: 'viewfinder flat', cfg: name, ...st, ...repeatStats(cv, cell), cellPx: +cell.toFixed(2) });
      hostA.appendChild(card(cv, f.id + ' ' + name + ' 路 ' + f.iso + ' ISO', JSON.stringify(st) + '  clump ' + cell.toFixed(2) + 'px'));
    }
  }

  /* A2 路 flat mid-tone at a large preview (1200脳675): the 256 tile wraps here, so repetition,
     if it exists, is visible in the image itself 鈥?not assumed. */
  const WW = 1200, WH = 675;
  const hostW = document.getElementById('flatwide');
  for (const f of films){
    if (onlyFilm) continue;   // single-stock review skips the heavy wide/export renders
    for (const [name, cfg] of [['BEFORE', BEFORE], ['AFTER', AFTER]]){
      const cv = render(flat(WW, WH), WW, WH, f, cfg), cell = cellOf(f, WW, cfg);
      const rs = repeatStats(cv, cell);
      rowsA.push({ film: f.id, surface: 'wide flat', cfg: name, ...grainStats(cv, Math.round(WW * 0.3), Math.round(WH * 0.35), 400, 240), ...rs, cellPx: +cell.toFixed(2) });
      hostW.appendChild(card(cv, f.id + ' ' + name + ' 路 1200px preview', 'tile wraps ' + rs.wraps + '脳 路 grain 蟻 at tile period ' + rs.rho));
    }
  }

  /* B 路 flat frame at export size, and what a phone shows when it scales that print down */
  const hostB = document.getElementById('flatexport');
  for (const f of films){
    if (onlyFilm) continue;
    for (const [name, cfg] of [['BEFORE', BEFORE], ['AFTER', AFTER]]){
      const cv = render(flat(EW, EH), EW, EH, f, cfg), disp = shown(cv);
      const cellE = cellOf(f, EW, cfg);
      rowsA.push({ film: f.id, surface: 'export flat', cfg: name, ...grainStats(cv, Math.round(EW * 0.3), Math.round(EH * 0.35), 500, 300), ...repeatStats(cv, cellE), cellPx: +cellE.toFixed(2) });
      rowsA.push({ film: f.id, surface: 'phone-displayed flat', cfg: name, ...grainStats(disp, Math.round(SHOWN * 0.3), Math.round(SHOWN * 0.35 * EH / EW), 120, 70), rho: null, wraps: null, cellPx: +(cellE * SHOWN / EW).toFixed(2) });
      hostB.appendChild(card(disp, f.id + ' ' + name + ' 路 export shown at ' + SHOWN + 'px', 'clump as shown ' + (cellE * SHOWN / EW).toFixed(2) + 'px'));
    }
  }

  /* C 路 the reference photographs at viewfinder size */
  const hostC = document.getElementById('scenes');
  for (const [id, s] of Object.entries(scenes)){
    if (onlyScene && id !== onlyScene) continue;
    const srcP = drawScene(id, PW, PH);
    const host = document.createElement('div'); host.className = 'row';
    for (const f of films){
      const base = Math.max(0.1, structureStats(render(srcP, PW, PH, f, { amp: 0, chromatic: 0 }), ...rect(s.detail, PW, PH)));
      for (const [name, cfg] of [['BEFORE', BEFORE], ['AFTER', AFTER]]){
        const cv = render(srcP, PW, PH, f, cfg);
        const ratio = +(structureStats(cv, ...rect(s.detail, PW, PH)) / base).toFixed(2);
        rowsB.push({ film: f.id, reference: id, cfg: name, ratio, cellPx: +cellOf(f, PW, cfg).toFixed(2) });
        if (name === 'BEFORE') host.appendChild(card(cv, f.id + ' BEFORE 路 ' + s.name, 'detail kept ' + ratio));
        else host.appendChild(card(cv, f.id + ' AFTER 路 ' + s.name, 'detail kept ' + ratio));
      }
    }
    hostC.appendChild(host);
  }

  const fill = (id, rows, cols) => {
    const tb = document.getElementById(id).querySelector('tbody');
    for (const r of rows){
      const tr = document.createElement('tr');
      tr.innerHTML = cols.map(c => `<td class="${c === 'cfg' && r.cfg === 'AFTER' ? 'a' : ''}">${r[c]}</td>`).join('');
      tb.appendChild(tr);
    }
  };
  fill('tblA', rowsA, ['film', 'surface', 'cfg', 'std', 'chroma', 'blocky', 'wraps', 'rho', 'cellPx']);
  fill('tblB', rowsB, ['film', 'reference', 'cfg', 'ratio', 'cellPx']);

  // 蟻 and wraps only exist where the tile actually wraps: average the measurable rows, ignore the rest.
  const pick = (rows, sel, k) => { const g = rows.filter(sel).filter(r => r[k] != null); if (!g.length) return 'n/a'; return +(g.reduce((s, r) => s + r[k], 0) / g.length).toFixed(2); };
  const cmp = (selB, selA, k, label) => `${label}: ${pick(rowsA, r => selB(r), k)} 鈫?${pick(rowsA, r => selA(r), k)}`;
  const cmpB = (selB, selA, k, label) => `${label}: ${pick(rowsB, r => selB(r), k)} 鈫?${pick(rowsB, r => selA(r), k)}`;
  const lines = [
    cmp(r => r.surface === 'viewfinder flat' && r.cfg === 'BEFORE', r => r.surface === 'viewfinder flat' && r.cfg === 'AFTER', 'std', 'grain 蟽 at viewfinder size'),
    cmp(r => r.surface === 'viewfinder flat' && r.cfg === 'BEFORE', r => r.surface === 'viewfinder flat' && r.cfg === 'AFTER', 'chroma', 'colour speckle 蟽'),
    cmp(r => r.surface === 'viewfinder flat' && r.cfg === 'BEFORE', r => r.surface === 'viewfinder flat' && r.cfg === 'AFTER', 'blocky', 'blocky (identical neighbours)'),
    cmp(r => r.surface === 'wide flat' && r.cfg === 'BEFORE', r => r.surface === 'wide flat' && r.cfg === 'AFTER', 'wraps', 'tile wraps across a 1200px preview'),
    cmp(r => r.surface === 'wide flat' && r.cfg === 'BEFORE', r => r.surface === 'wide flat' && r.cfg === 'AFTER', 'rho', 'grain 蟻 at the tile period (1 = pattern printed twice)'),
    cmp(r => r.surface === 'export flat' && r.cfg === 'BEFORE', r => r.surface === 'export flat' && r.cfg === 'AFTER', 'std', 'grain 蟽 at export size'),
    cmp(r => r.surface === 'phone-displayed flat' && r.cfg === 'BEFORE', r => r.surface === 'phone-displayed flat' && r.cfg === 'AFTER', 'std', 'grain 蟽 as a phone displays it'),
    cmpB(r => r.cfg === 'BEFORE', r => r.cfg === 'AFTER', 'ratio', 'detail kept on the reference photographs'),
  ];
  document.getElementById('sum').textContent = lines.join('\n');
  window.__GRAIN_STATS = { rowsA, rowsB, summary: document.getElementById('sum').textContent };
})();

