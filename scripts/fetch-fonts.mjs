/* scripts/fetch-fonts.mjs — download OFL latin subsets of the two app fonts into assets/fonts/
   (bundled so the PWA works fully offline; no runtime Google Fonts dependency).
   Run: node scripts/fetch-fonts.mjs */
import { writeFileSync, mkdirSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const cssUrl = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&family=Roboto+Condensed:wght@700&display=swap';
const css = await (await fetch(cssUrl, { headers: { 'User-Agent': UA } })).text();

// Grab only the latin subset blocks.
const blocks = [...css.matchAll(/\/\* latin \*\/\s*@font-face\s*\{([\s\S]*?)\}/g)];
mkdirSync('assets/fonts', { recursive: true });
let n = 0;
for (const [, body] of blocks) {
  const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
  const weight = /font-weight:\s*(\d+)/.exec(body)?.[1];
  const url = /url\((https:[^)]+\.woff2)\)/.exec(body)?.[1];
  if (!family || !weight || !url) continue;
  const file = `${family.toLowerCase().replace(/\s+/g, '-')}-${weight}.woff2`;
  const buf = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer());
  writeFileSync(`assets/fonts/${file}`, buf);
  console.log(`${file} — ${Math.round(buf.length / 1024)}KB`);
  n++;
}
if (n < 2) throw new Error('expected 2 latin subsets, got ' + n);
