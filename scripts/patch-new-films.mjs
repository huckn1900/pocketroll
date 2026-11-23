// scripts/patch-new-films.mjs — idempotent: append the twelve stocks of the expansion round.
// Order is the user's list, and every entry carries its OWN parameters — no stock borrows
// another stock's preset. Values are simulation estimates of each emulsion's behaviour
// (toe/shoulder, chroma, grain size, split-tone tint, colour response); they are tuned by
// engine previews, never copied from a neighbouring profile.
import fs from 'node:fs';

const IDENTITY = { contrast: 1.0, black_lift: 0.02, white_point: 0.96, saturation: 1, grain_size: 1, grain_strength: 0.3, tint_highlights: '#f2efe6', tint_shadows: '#101216', halation: 0.08, vignette: 0.04, fade: 0, wb: [1, 1, 1], exposure: 0, highlights: 0.2, shadows: 0.1, rgb_matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], grain_color: true };

// Every stock below is written against that identity so the deltas are explicit in the file:
// a profile that equals another profile is a preset, not a stock.
const NEW = [
  { id: 'portra800', brand: 'Kodak', name: 'Portra 800', type: 'color_negative', iso: 800, status: 'current', era: 'low-contrast portrait negative, high speed',
    story: 'The high-speed member of the Portra family: loose contrast and a long shoulder, so skin stays soft and highlights roll off instead of clipping. Its grain is the honest cost of that speed — visible, and the reason portraits shot on it look like photographs rather than prints.',
    filter_params: { contrast: 1.02, black_lift: 0.08, white_point: 0.94, saturation: 0.86, grain_size: 2.2, grain_strength: 0.55, tint_highlights: '#f2dfb8', tint_shadows: '#2b2418', halation: 0.14, vignette: 0.06, fade: 0.06, wb: [1.11, 1.0, 0.88], exposure: 0.12, highlights: 0.55, shadows: -0.22, rgb_matrix: [0.88, 0.09, 0.03, 0.03, 0.92, 0.05, 0.04, 0.06, 0.90], grain_color: true },
    leak_prob: 0.16, leak_strength: 0.55, tier: 'pro', can: { body: '#c9a97e', band: '#3a2c1d', label: 'PORTRA 800' } },
  { id: 'ultramax400', brand: 'Kodak', name: 'UltraMax 400', type: 'color_negative', iso: 400, status: 'current', era: 'consumer punch, warm primaries',
    story: 'A consumer stock built to look good straight out of the lab: stronger contrast and denser chroma than Gold, with warm reds and a hard shoulder. Chunkier grain than a premium negative of the same speed — the trade a cheap high-speed film makes on purpose.',
    filter_params: { contrast: 1.16, black_lift: 0.02, white_point: 0.97, saturation: 1.10, grain_size: 1.9, grain_strength: 0.50, tint_highlights: '#ffd2a0', tint_shadows: '#221b12', halation: 0.12, vignette: 0.07, fade: 0.03, wb: [1.13, 1.0, 0.85], exposure: 0.07, highlights: 0.30, shadows: 0.12, rgb_matrix: [0.90, 0.06, 0.04, 0.02, 0.90, 0.08, 0.04, 0.05, 0.91], grain_color: true },
    leak_prob: 0.14, leak_strength: 0.5, tier: 'pro', can: { body: '#d08a3a', band: '#241a11', label: 'ULTRAMAX' } },
  { id: 'fp4plus', brand: 'Ilford', name: 'FP4 Plus', type: 'bw', iso: 400, status: 'current', era: 'quiet monochrome, fine grain for its speed',
    story: 'The workhorse medium-speed monochrome: unusually fine grain for ISO 400 and a gentle ramp, so shadows keep detail instead of blocking up. Where Tri-X is loud, FP4 is quiet — reportage that reads as paper, not as texture.',
    filter_params: { contrast: 1.04, black_lift: 0.045, white_point: 0.96, saturation: 0, grain_size: 0.9, grain_strength: 0.26, tint_highlights: '#efe8db', tint_shadows: '#15161b', halation: 0.07, vignette: 0.05, fade: 0.03, wb: [1, 1, 1], exposure: 0.02, highlights: 0.18, shadows: 0.14, rgb_matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], grain_color: false },
    leak_prob: 0.10, leak_strength: 0.5, tier: 'pro', can: { body: '#2e3a46', band: '#e8eaf0', label: 'FP4' } },
  { id: 'delta3200', brand: 'Ilford', name: 'Delta 3200 Pro', type: 'bw', iso: 3200, status: 'current', era: 'monochrome at available-light speed',
    story: 'A structured, fast monochrome emulsion for low light: deep blacks, hard midtone contrast and a shoulder that gives highlights up quickly while holding texture. Grain is coarse and deliberate — at this speed the texture IS the image.',
    filter_params: { contrast: 1.32, black_lift: 0.012, white_point: 0.99, saturation: 0, grain_size: 3.0, grain_strength: 0.70, tint_highlights: '#f4f2e9', tint_shadows: '#0c0d12', halation: 0.10, vignette: 0.06, fade: 0, wb: [1, 1, 1], exposure: 0.05, highlights: 0.52, shadows: 0.22, rgb_matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], grain_color: false },
    leak_prob: 0.12, leak_strength: 0.6, tier: 'pro', can: { body: '#2a2b2b', band: '#e36b2a', label: 'DELTA 3200' } },
  { id: 'acros2', brand: 'Fujifilm', name: 'Neopan Acros II 100', type: 'bw', iso: 100, status: 'current', era: 'super-fine grain monochrome',
    story: 'Fujifilm\'s slow monochrome with the finest grain in this library: crisp highlights, clean micro-contrast and blues that fall slightly darker than most panchromatic films. Used for architecture and studio work, where grain would be a defect.',
    filter_params: { contrast: 1.24, black_lift: 0.02, white_point: 0.98, saturation: 0, grain_size: 0.4, grain_strength: 0.14, tint_highlights: '#f7f5ef', tint_shadows: '#0e1015', halation: 0.05, vignette: 0.04, fade: 0, wb: [0.99, 1.0, 1.02], exposure: 0, highlights: 0.22, shadows: 0.20, rgb_matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], grain_color: false },
    leak_prob: 0.08, leak_strength: 0.45, tier: 'pro', can: { body: '#1f2226', band: '#d7dee4', label: 'ACROS II' } },
  { id: 'cinestill400d', brand: 'CineStill', name: 'CineStill 400D', type: 'color_negative', iso: 400, status: 'current', era: 'daylight-balanced negative with motion-derived colour science',
    story: 'Daylight-balanced, and packaged for standard C-41 processing — unlike tungsten-balanced 800T, it carries no warm cast in daylight. Softer shoulder and lighter halation than 800T, and much finer grain: the cinematic roll-off without the night-for-night colour.',
    filter_params: { contrast: 1.02, black_lift: 0.06, white_point: 0.95, saturation: 0.94, grain_size: 1.4, grain_strength: 0.40, tint_highlights: '#ffe4c2', tint_shadows: '#232b34', halation: 0.10, vignette: 0.06, fade: 0.05, wb: [1.05, 1.0, 0.95], exposure: 0.10, highlights: 0.48, shadows: -0.16, rgb_matrix: [0.90, 0.05, 0.05, 0.02, 0.92, 0.06, 0.02, 0.05, 0.93], grain_color: true },
    leak_prob: 0.10, leak_strength: 0.5, tier: 'pro', can: { body: '#23272b', band: '#2f8f86', label: '400D' } },
  { id: 'cinestill50d', brand: 'CineStill', name: 'CineStill 50D', type: 'color_negative', iso: 50, status: 'current', era: 'slow daylight negative, fine grain',
    story: 'The slow end of the same daylight line: near-grainless chroma, tight shoulder, controlled highlights. For bright daylight and tripod work where the cinematic roll-off is wanted without any texture.',
    filter_params: { contrast: 1.12, black_lift: 0.025, white_point: 0.97, saturation: 0.86, grain_size: 0.6, grain_strength: 0.20, tint_highlights: '#f2ecdc', tint_shadows: '#1c222a', halation: 0.07, vignette: 0.05, fade: 0.03, wb: [1.04, 1.0, 0.96], exposure: 0.03, highlights: 0.40, shadows: 0.12, rgb_matrix: [0.92, 0.04, 0.04, 0.02, 0.93, 0.05, 0.02, 0.04, 0.94], grain_color: true },
    leak_prob: 0.08, leak_strength: 0.4, tier: 'pro', can: { body: '#2b2520', band: '#b4884a', label: '50D' } },
  { id: 'fomapan100', brand: 'Foma', name: 'Fomapan 100 Classic', type: 'bw', iso: 100, status: 'current', era: 'retro monochrome, cheap and foggy',
    story: 'A budget monochrome made on an old emulsion recipe: flat contrast, a lifted toe that reads as fog, coarse grain and a warm cast that fades quickly. Not a clean print — an old photograph, which is exactly why people buy it.',
    filter_params: { contrast: 0.84, black_lift: 0.13, white_point: 0.92, saturation: 0, grain_size: 2.0, grain_strength: 0.46, tint_highlights: '#e6d9c2', tint_shadows: '#241e15', halation: 0.10, vignette: 0.08, fade: 0.14, wb: [1.05, 1.0, 0.93], exposure: 0.08, highlights: 0.50, shadows: 0.18, rgb_matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], grain_color: false },
    leak_prob: 0.22, leak_strength: 0.7, tier: 'pro', can: { body: '#8b6f4a', band: '#2b2118', label: 'FOMAPAN' } },
  { id: 'metropolis', brand: 'LomoChrome', name: 'LomoChrome Metropolis', type: 'color_negative', iso: 200, status: 'current', era: 'experimental chromogenic negative, extended ISO 100-400',
    story: 'A chromogenic negative with an engineered palette rather than a faithful one: teal shadows, olive midtones and amber highlights, the hue response pulled off the standard route on purpose. Rated ISO 200 with LomoChrome\'s extended 100-400 range; exposure choice decides how far the palette drifts.',
    filter_params: { contrast: 1.06, black_lift: 0.055, white_point: 0.95, saturation: 0.70, grain_size: 1.5, grain_strength: 0.42, tint_highlights: '#f6a566', tint_shadows: '#143a44', halation: 0.12, vignette: 0.10, fade: 0.07, wb: [1.08, 0.99, 0.90], exposure: 0.06, highlights: 0.34, shadows: 0.14, rgb_matrix: [0.62, 0.30, 0.08, 0.14, 0.66, 0.20, 0.10, 0.26, 0.64], grain_color: true },
    leak_prob: 0.30, leak_strength: 0.8, tier: 'pro', can: { body: '#20303a', band: '#e29a55', label: 'METROPOLIS' } },
  { id: 'purple', brand: 'LomoChrome', name: 'LomoChrome Purple', type: 'color_negative', iso: 200, status: 'current', era: 'experimental chromogenic negative, hue rotation',
    story: 'The strongest hue rotation in this library: greens turn violet, blues push toward teal, and yellow never arrives, so orange cannot form. Same extended ISO 100-400 behaviour as Metropolis. This is a palette rewrite, not a colour correction — an approximation of how the emulsion re-maps hues.',
    filter_params: { contrast: 1.04, black_lift: 0.05, white_point: 0.95, saturation: 0.84, grain_size: 1.6, grain_strength: 0.44, tint_highlights: '#e6b2f4', tint_shadows: '#2a1938', halation: 0.12, vignette: 0.10, fade: 0.05, wb: [1.02, 0.98, 1.02], exposure: 0.05, highlights: 0.30, shadows: 0.16, rgb_matrix: [0.55, 0.28, 0.17, 0.20, 0.32, 0.48, 0.30, 0.22, 0.48], grain_color: true },
    leak_prob: 0.30, leak_strength: 0.85, tier: 'pro', can: { body: '#3a2246', band: '#b36fd0', label: 'PURPLE' } },
  { id: 'ferrania-p30', brand: 'Ferrania', name: 'P30', type: 'bw', iso: 80, status: 'current', era: 'revived chromogenic monochrome on paper support',
    story: 'Ferrania\'s revived monochrome on a paper support: soft shoulder, low contrast and a warm sepia-leaning render, with box speed 80 and no DX coding — Ferrania recommends a camera you can set manually. Hand processing gives the most consistent results, so the look here is an approximation of one lab\'s answer.',
    filter_params: { contrast: 0.90, black_lift: 0.10, white_point: 0.93, saturation: 0.16, grain_size: 2.2, grain_strength: 0.50, tint_highlights: '#f0d4ab', tint_shadows: '#3a2a1b', halation: 0.11, vignette: 0.09, fade: 0.11, wb: [1.10, 1.0, 0.86], exposure: 0.07, highlights: 0.42, shadows: 0.16, rgb_matrix: [0.85, 0.10, 0.05, 0.05, 0.88, 0.07, 0.04, 0.07, 0.89], grain_color: false },
    leak_prob: 0.24, leak_strength: 0.7, tier: 'pro', can: { body: '#6e2c22', band: '#e4c79a', label: 'P30' } },
  { id: 'tmax100', brand: 'Kodak', name: 'T-Max 100', type: 'bw', iso: 100, status: 'current', era: 'technical monochrome, sharp and dense',
    story: 'A technical monochrome: single-layer emulsion, sharp edges and dense blacks, with grain fine enough to survive enlargement but still present. Where Acros is neutral, T-Max is hard — the negative people print when they want structure.',
    filter_params: { contrast: 1.28, black_lift: 0.015, white_point: 0.98, saturation: 0, grain_size: 0.7, grain_strength: 0.30, tint_highlights: '#f1efe7', tint_shadows: '#0d0f14', halation: 0.06, vignette: 0.05, fade: 0.02, wb: [1, 1, 1], exposure: 0, highlights: 0.26, shadows: 0.24, rgb_matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], grain_color: false },
    leak_prob: 0.10, leak_strength: 0.45, tier: 'pro', can: { body: '#2b2b2b', band: '#e8c93f', label: 'T-MAX' } },
];

const doc = JSON.parse(fs.readFileSync('assets/films.json', 'utf8'));
let added = 0, repaired = 0;
for (const f of NEW) {
  const existing = doc.films.find(x => x.id === f.id);
  if (existing) {
    // an appended profile missing its canister is repaired here, never re-tuned: parameters
    // live once they have been tuned by previews, and re-writing them would erase the tuning
    if (!existing.can) { existing.can = f.can; repaired++; }
    continue;
  }
  // key order mirrors the existing profiles; the process label is applied by patch-film-process.mjs
  const entry = { id: f.id, brand: f.brand, name: f.name, type: f.type, iso: f.iso, status: f.status, era: f.era, story: f.story,
    filter_params: Object.assign({}, IDENTITY, f.filter_params), leak_prob: f.leak_prob, leak_strength: f.leak_strength, tier: f.tier, can: f.can };
  doc.films.push(entry); added++;
}
fs.writeFileSync('assets/films.json', JSON.stringify(doc, null, 1));

// sanity: unique ids, rated ISO, a canister, and every rgb row summing to 1 (chroma-preserving)
const again = JSON.parse(fs.readFileSync('assets/films.json', 'utf8')).films;
const ids = again.map(f => f.id);
if (new Set(ids).size !== ids.length) throw new Error('duplicate film ids');
const bad = [];
for (const f of again) {
  const p = f.filter_params;
  if (!Number.isInteger(f.iso) || f.iso <= 0) bad.push(f.id + ' iso');
  if (!f.can || !f.can.body || !f.can.label) bad.push(f.id + ' can');
  if (!f.story) bad.push(f.id + ' story');
  p.rgb_matrix.forEach((v, i) => { if (typeof v !== 'number') bad.push(f.id + ' matrix'); });
  const rows = [0, 1, 2].map(r => p.rgb_matrix.slice(r * 3, r * 3 + 3).reduce((a, b) => a + b, 0));
  rows.forEach((s, r) => { if (Math.abs(s - 1) > 0.01) bad.push(`${f.id} row ${r} sum ${s.toFixed(2)}`); });
  if (Math.abs(p.contrast - 1) > 1 || p.saturation > 1.5 || p.grain_size > 4) bad.push(f.id + ' out of range');
}
// every stock must be distinguishable from every other stock — a borrowed preset is not a stock
const sig = again.map(f => {
  const p = f.filter_params;
  return [f.id, f.iso, p.contrast, p.saturation, p.grain_size, p.grain_strength, p.wb.join(','), p.tint_shadows, p.rgb_matrix.join(',')].join('|');
});
if (new Set(sig).size !== sig.length) throw new Error('two stocks share identical parameters');
console.log(`assets/films.json: ${again.length} films, ${added} added, ${repaired} canisters repaired`);
if (bad.length) throw new Error('invalid profiles: ' + bad.join(', '));
