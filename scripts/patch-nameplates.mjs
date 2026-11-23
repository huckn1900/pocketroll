/* Nameplates: the status card prints what the body's own nameplate says. A model string that
   is only a number or a format ("6×7", "35", "XA", "35Ti") is not a name on its own, so those
   bodies carry a `plate` with the maker on it; self-identifying models keep printing as-is.
   Idempotent: re-run with no changes when the data already carries the plates. */
import { readFileSync, writeFileSync } from 'fs';

const PLATES = {
  xa: 'OLYMPUS XA',
  rollei35: 'ROLLEI 35',
  p67: 'PENTAX 6×7',
  n35ti: 'NIKON 35Ti',
  hexaraf: 'KONICA HEXAR AF',
};

const path = process.argv[2] || 'assets/cameras.json';
const raw = readFileSync(path, 'utf-8');
const doc = JSON.parse(raw);
let added = 0;
for (const c of doc.cameras){
  const want = PLATES[c.id];
  if (want && c.plate !== want){ c.plate = want; added++; }
  if (c.plate !== undefined && typeof c.plate !== 'string') throw new Error(`${c.id}: plate must be a string`);
}
writeFileSync(path, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
console.log(`${path}: ${doc.cameras.length} bodies, ${added} nameplates added`);
