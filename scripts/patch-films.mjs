/* scripts/patch-films.mjs — add Color Science / Exposure / Grain modules to every film.
   Directional values grounded on film datasheets & emulation recipes:
   - negatives: soft shoulder rolloff, lifted toe; slides: toe crush + hard shoulder
   - WB gains mirror each stock's balance (Kodak warm, Fuji cool, 500T/800T tungsten-warm in daylight)
   - rgb_matrix rows sum to 1.0 (subtle channel response, not stylization)
   - grain_color: false for B&W stocks (pure luminance grain) */
import { readFileSync, writeFileSync } from 'node:fs';

const I = [1,0,0, 0,1,0, 0,0,1];
const add = {
  trix400:       { wb:[1,1,1],        exposure:0,     highlights:0.22, shadows:0.10,  rgb_matrix:I, grain_color:false },
  hp5plus:       { wb:[1,1,1],        exposure:0.05,  highlights:0.35, shadows:-0.12, rgb_matrix:I, grain_color:false },
  delta100:      { wb:[1,1,1],        exposure:0,     highlights:0.15, shadows:0.18,  rgb_matrix:I, grain_color:false },
  kentmere400:   { wb:[1,1,1],        exposure:0,     highlights:0.25, shadows:-0.08, rgb_matrix:I, grain_color:false },
  portra160:     { wb:[1.05,1.0,0.94], exposure:0.10, highlights:0.55, shadows:-0.18, rgb_matrix:[0.88,0.10,0.02, 0.02,0.94,0.04, 0.02,0.06,0.92], grain_color:true },
  portra400:     { wb:[1.05,1.0,0.93], exposure:0.08, highlights:0.50, shadows:-0.14, rgb_matrix:[0.88,0.10,0.02, 0.02,0.94,0.04, 0.02,0.06,0.92], grain_color:true },
  gold200:       { wb:[1.12,1.0,0.86], exposure:0.06, highlights:0.45, shadows:-0.12, rgb_matrix:[0.92,0.06,0.02, 0.03,0.92,0.05, 0.01,0.07,0.92], grain_color:true },
  ektar100:      { wb:[1.06,1.0,0.92], exposure:0,    highlights:0.28, shadows:0.12,  rgb_matrix:[0.92,0.05,0.03, 0.02,0.93,0.05, 0.04,0.04,0.92], grain_color:true },
  colorplus:     { wb:[1.04,1.02,0.90], exposure:0.10, highlights:0.45, shadows:-0.20, rgb_matrix:[0.90,0.06,0.04, 0.04,0.90,0.06, 0.02,0.06,0.92], grain_color:true },
  'vision3-500t':{ wb:[1.16,1.0,0.82], exposure:0.18, highlights:0.45, shadows:-0.22, rgb_matrix:[0.93,0.04,0.03, 0.01,0.93,0.06, 0.02,0.06,0.92], grain_color:true },
  cinestill800t: { wb:[1.12,1.0,0.86], exposure:0.14, highlights:0.38, shadows:-0.24, rgb_matrix:[0.94,0.03,0.03, 0.02,0.92,0.06, 0.01,0.05,0.94], grain_color:true },
  velvia50:      { wb:[0.97,1.0,1.05], exposure:-0.10, highlights:0.30, shadows:0.34, rgb_matrix:[0.96,0.02,0.02, 0.01,0.90,0.09, 0.03,0.02,0.95], grain_color:true },
  provia100f:    { wb:[0.98,1.0,1.03], exposure:-0.05, highlights:0.22, shadows:0.24, rgb_matrix:[0.95,0.03,0.02, 0.02,0.95,0.03, 0.02,0.02,0.96], grain_color:true },
  e100:          { wb:[0.97,1.0,1.05], exposure:-0.05, highlights:0.22, shadows:0.26, rgb_matrix:[0.96,0.02,0.02, 0.02,0.96,0.02, 0.02,0.02,0.96], grain_color:true },
  kodachrome64:  { wb:[1.14,1.0,0.88], exposure:0,    highlights:0.32, shadows:0.28, rgb_matrix:[0.94,0.04,0.02, 0.02,0.93,0.05, 0.04,0.02,0.94], grain_color:true },
  // Cinema Collection: an original simulation, not a lab stock — values come from the film's own visual study (see the profile's inspiration field), never from another stock's recipe.
  hanabi:        { wb:[0.94,0.98,1.05], exposure:-0.15, highlights:0.60, shadows:-0.30, rgb_matrix:[0.86,0.10,0.04, 0.04,0.85,0.11, 0.02,0.08,0.90], grain_color:true },
};

const f = JSON.parse(readFileSync('assets/films.json', 'utf8'));
for (const film of f.films){
  // this map grounds the original 15; newer stocks ship their own parameters (patch-new-films.mjs)
  const a = add[film.id];
  if (a) Object.assign(film.filter_params, a);
  // validate matrix rows sum to 1 — every profile in the file, whoever authored it
  const m = film.filter_params.rgb_matrix;
  if (m){
    for (let r = 0; r < 3; r++){
      const s = m[r*3] + m[r*3+1] + m[r*3+2];
      if (Math.abs(s - 1) > 0.001) throw new Error(`${film.id} matrix row ${r} sums to ${s}`);
    }
  }
}
writeFileSync('assets/films.json', JSON.stringify(f, null, 2) + '\n');
console.log('patched ' + f.films.length + ' films: wb/exposure/highlights/shadows/rgb_matrix/grain_color added');
