// scripts/patch-leaks.mjs — per-stock light leak chances on films.json (idempotent)
// Story logic: cheap/expired/motion-picture stocks leak more; careful pro stocks leak less.
// app.js rollLeak() reads film.leak_prob / film.leak_strength, multiplied by CAMERA_LEAK.
import { readFileSync, writeFileSync } from 'node:fs';

const LEAKS = {
  'trix400':        { leak_prob: 0.12, leak_strength: 0.55 },
  'hp5plus':        { leak_prob: 0.14, leak_strength: 0.60 },
  'delta100':       { leak_prob: 0.05, leak_strength: 0.35 },
  'kentmere400':    { leak_prob: 0.09, leak_strength: 0.50 },
  'portra160':      { leak_prob: 0.06, leak_strength: 0.40 },
  'portra400':      { leak_prob: 0.07, leak_strength: 0.45 },
  'gold200':        { leak_prob: 0.12, leak_strength: 0.60 },
  'ektar100':       { leak_prob: 0.08, leak_strength: 0.50 },
  'colorplus':      { leak_prob: 0.22, leak_strength: 0.75 }, // disposable-camera energy
  'vision3-500t':   { leak_prob: 0.12, leak_strength: 0.55 },
  'cinestill800t':  { leak_prob: 0.18, leak_strength: 0.70 }, // leftover motion-stock character
  'velvia50':       { leak_prob: 0.08, leak_strength: 0.45 },
  'provia100f':     { leak_prob: 0.06, leak_strength: 0.40 },
  'e100':           { leak_prob: 0.10, leak_strength: 0.50 },
  'kodachrome64':   { leak_prob: 0.12, leak_strength: 0.55 },
};

const path = 'assets/films.json';
const data = JSON.parse(readFileSync(path, 'utf8')); // strict parse — throws if malformed
let n = 0;
for (const f of data.films) {
  const l = LEAKS[f.id];
  if (!l) throw new Error('no leak profile for film id: ' + f.id);
  f.leak_prob = l.leak_prob;
  f.leak_strength = l.leak_strength;
  n++;
}
writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
console.log(`leak profiles applied to ${n} films (total ${data.films.length})`);
