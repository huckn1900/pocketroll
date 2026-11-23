import { readFileSync, writeFileSync } from 'node:fs';
const f = 'test/camera-diff.mjs';
let s = readFileSync(f, 'utf8');
if (s.includes('capture({ noLeak: true })')) { console.log('already patched'); process.exit(0); }
const before = s;
s = s.replace(/capture\(\);/, 'capture({ noLeak: true }); // the exposure, minus the chamber\'s quirk overlays');
if (s === before) { console.log('NO MATCH'); process.exit(1); }
writeFileSync(f, s);
console.log('patched camera-diff.mjs');
