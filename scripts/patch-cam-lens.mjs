// scripts/patch-cam-lens.mjs — idempotent: give every body a genuinely distinct lens rendering.
// camera_character gains: distortion (barrel coefficient), flash behaviour (gain/spread) for
// bodies with built-in flash, and recalibrated sharpness so sharp primes stay crisp.
import fs from 'node:fs';
const FILE = 'assets/cameras.json';
const lens = {
  trip35:     { sharpness: 0.75, distortion: 0.05 },                                   // 4-element Zuiko: mild soft, slight barrel
  instamatic: { sharpness: 0.55, distortion: 0.10, flash: { gain: 0.55, spread: 0.30 } }, // flash cube: flat, wide coverage
  af35m:      { sharpness: 0.70, distortion: 0.06, flash: { gain: 0.85, spread: 0.10 } }, // built-in flash: hot centre, hard falloff
  l35af:      { sharpness: 0.80, distortion: 0.03 },                                   // crisp 80s zoom, near-flat field
  t4:         { sharpness: 0.92, distortion: 0.015 },                                  // Zeiss T* prime: sharp, flat
  contaxt2:   { sharpness: 0.96, distortion: 0.012 },                                  // C. Zeiss: sharpest here
  mju2:       { sharpness: 0.80, distortion: 0.022 },                                 // sharp but tiny lens, slight edge falloff
  gr1v:       { sharpness: 0.94, distortion: 0.010 },                                  // Ricoh GR prime: sharp, corners only vignette
  tc01:       { sharpness: 0.85, distortion: 0.030 },                                  // 16mm lens: soft corners, visible barrel
  lca:        { sharpness: 0.55, distortion: 0.16 },                                  // plastic wide-angle: heavy barrel + soft
};
const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
for (const c of j.cameras) {
  const l = lens[c.id];
  if (!l) throw new Error('no lens profile for ' + c.id);
  c.camera_character.sharpness = l.sharpness;
  c.camera_character.distortion = l.distortion;
  if (l.flash) c.camera_character.flash = l.flash; else delete c.camera_character.flash;
}
fs.writeFileSync(FILE, JSON.stringify(j, null, 1));
const ids = Object.keys(lens);
console.log('patched', j.cameras.length, 'cameras; sharpness spread',
  Math.min(...j.cameras.map(c => c.camera_character.sharpness)), '-',
  Math.max(...j.cameras.map(c => c.camera_character.sharpness)), '; flash on',
  j.cameras.filter(c => c.camera_character.flash).map(c => c.id).join(','));
