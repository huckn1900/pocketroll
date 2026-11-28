// scripts/patch-film-process.mjs — idempotent: label every film profile with its lab process.
// A film is developed, not "filtered": the process is what a lab actually runs on it, and it
// is part of the stock's identity (Vision3 is ECN-2 motion negative, not ordinary C-41;
// Kodachrome's D-70 lines no longer exist anywhere). Tokens stay short — the shelf prints them.
import fs from 'node:fs';

const PROCESS = {
  // colour negative — C-41 is the standard consumer/lab process
  gold200: 'C-41', colorplus: 'C-41', superia400: 'C-41',
  portra160: 'C-41', portra400: 'C-41', ektar100: 'C-41',
  portra800: 'C-41', ultramax400: 'C-41',
  // experimental chromogenic negatives — still developed in C-41, their oddness is in the emulsion
  metropolis: 'C-41', purple: 'C-41',
  // motion-picture negative — Kodak Vision3 keeps its own ECN-2 line and its mask
  'vision3-500t': 'ECN-2',
  // CineStill is NOT ECN-2: their own help page states the colour films are made for still
  // photography in C-41 (RA-4 compatible). Motion-derived science, ordinary lab process.
  cinestill800t: 'C-41', cinestill400d: 'C-41', cinestill50d: 'C-41',
  // transparency
  velvia50: 'E-6', provia100f: 'E-6', e100: 'E-6',
  kodachrome64: 'D-70',
  // black & white — one label, the science differs per stock (fine vs dramatic grain)
  hp5plus: 'B&W', trix400: 'B&W', kentmere400: 'B&W', delta100: 'B&W',
  fp4plus: 'B&W', delta3200: 'B&W', acros2: 'B&W', fomapan100: 'B&W', tmax100: 'B&W',
  // P30 is a monochrome developed in a B&W process (Ferrania recommends hand processing)
  'ferrania-p30': 'B&W',
};

const doc = JSON.parse(fs.readFileSync('assets/films.json', 'utf8'));
let changed = 0;
for (const f of doc.films) {
  if (f.collection === 'cinema') continue; // Cinema Collection is an original simulation — no lab process exists for it, and printing one would be a lie
  const want = PROCESS[f.id];
  if (!want) throw new Error(`no process label for ${f.id}`);
  if (f.process !== want) { f.process = want; changed++; }
}
fs.writeFileSync('assets/films.json', JSON.stringify(doc, null, 1));

// sanity: every profile is labelled, and a profile's process must match its type
const again = JSON.parse(fs.readFileSync('assets/films.json', 'utf8')).films;
const bad = again.filter(f => (f.collection === 'cinema' ? f.type !== 'cinema_original' : !f.process)
  || (f.type === 'slide' && !['E-6', 'D-70'].includes(f.process))
  || (f.type === 'bw' && f.process !== 'B&W')
  || (f.type === 'color_negative' && !['C-41', 'ECN-2'].includes(f.process))
  || (f.type === 'motion_negative' && f.process !== 'ECN-2'));
console.log(`assets/films.json: ${again.length} films, ${changed} process changes`);
if (bad.length) throw new Error('process/type mismatch: ' + bad.map(f => f.id).join(', '));
if (again.some(f => f.collection === 'cinema' && !f.inspiration)) throw new Error('cinema collection profile without inspiration reference');
console.log('processes:', [...new Set(again.filter(f => f.process).map(f => f.process))].join(' · '));
