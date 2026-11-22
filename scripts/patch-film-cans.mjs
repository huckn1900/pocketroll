/* scripts/patch-film-cans.mjs — idempotent: adds per-film `can` visual identity
   (approximate real film-can packaging colours) + a 'coming' stub for in-production stock.
   Run: node scripts/patch-film-cans.mjs */
import fs from 'node:fs';
const path = './assets/films.json';
const j = JSON.parse(fs.readFileSync(path, 'utf8'));

const cans = {
  gold200:     { body: '#c98b2e', band: '#201c17', label: 'GOLD' },
  colorplus:   { body: '#a3543f', band: '#efe6d2', label: 'COLORPLUS' },
  portra160:   { body: '#232120', band: '#d9b64a', label: 'PORTRA' },
  portra400:   { body: '#232120', band: '#d9b64a', label: 'PORTRA' },
  ektar100:    { body: '#232120', band: '#d2a03b', label: 'EKTAR' },
  trix400:     { body: '#211f1e', band: '#d8c9a9', label: 'TRI-X' },
  hp5plus:     { body: '#e6e3da', band: '#4f8f3f', label: 'HP5' },
  delta100:    { body: '#e6e3da', band: '#6d5a93', label: 'DELTA' },
  kentmere400: { body: '#e6e3da', band: '#3f6f8f', label: 'KENTMERE' },
  velvia50:    { body: '#c8ccc6', band: '#b8402e', label: 'VELVIA' },
  provia100f:  { body: '#c8ccc6', band: '#2f6fa0', label: 'PROVIA' },
  e100:        { body: '#e6e3da', band: '#c07a2f', label: 'EKTACHROME' },
  kodachrome64:{ body: '#a33327', band: '#efe6d2', label: 'KODACHROME' },
  'vision3-500t': { body: '#232120', band: '#d97a37', label: 'VISION3' },
  cinestill800t:  { body: '#232120', band: '#d4552f', label: 'CINESTILL' },
  superia400:  { body: '#b8b9b2', band: '#c24a6b', label: 'SUPERIA' },
};

for (const f of j.films) {
  if (!cans[f.id]) throw new Error(`no can palette for ${f.id}`);
  f.can = cans[f.id];
}

/* in-production stock: full parameters exist but the film is still being tuned —
   UI shows COMING SOON; engine can render previews of the current pass. */
if (!j.films.find(f => f.id === 'superia400')) {
  j.films.push({
    id: 'superia400', brand: 'Fujifilm', name: 'Superia Xtra 400',
    type: 'color_negative', iso: 400, status: 'coming', era: '2005',
    story: 'Everyday consumer colour negative: soft greens, forgiving overexposure, gentle contrast. Currently in production for this app.',
    stub: true, tier: 'expansion',
    filter_params: {
      contrast: 1.05, black_lift: 0.06, white_point: 0.93, saturation: 1.05,
      grain_size: 1.2, grain_strength: 0.35,
      tint_highlights: '#f4ecd9', tint_shadows: '#16202c',
      halation: 0.05, vignette: 0.04, fade: 0.08,
      wb: [1, 1, 1.02], exposure: 0.05, highlights: 0.35, shadows: 0.12,
      rgb_matrix: [0.92, 0.05, 0.03, 0.02, 0.94, 0.04, 0.01, 0.06, 0.93],
      grain_color: true,
    },
    can: cans.superia400,
  });
}

fs.writeFileSync(path, JSON.stringify(j, null, 1));
console.log(`patched ${j.films.length} films (can identity + ${cans.superia400 ? 'superia stub' : ''})`);
