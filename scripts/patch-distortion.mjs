// scripts/patch-distortion.mjs — lens distortion is switched off for every body.
// The user asked for the fisheye/barrel bulge gone (2026-11-22): straight lines must stay
// straight in the viewfinder and in the prints. The engine keeps the capability (it applies a
// barrel map only when camera_character.distortion > 0.02), so a future wide-angle expansion
// pack can opt in with a small value; today every profile is rectilinear (0).
// Run: node scripts/patch-distortion.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'assets/cameras.json';
const raw = readFileSync(path, 'utf8');
const patched = raw.replace(/("distortion":\s*)[0-9.]+/g, '$10');
const count = raw.match(/"distortion":\s*[0-9.]+/g)?.length ?? 0;
writeFileSync(path, patched);
const stillOn = patched.match(/"distortion":\s*(?!0)[0-9.]+/g) ?? [];
console.log(`bodies with a distortion field: ${count}; left non-zero: ${stillOn.length}`);
