// scripts/patch-tiers.mjs — idempotent: tag every film/camera profile with a license tier.
// Free web demo = 5 classic films + 5 classic bodies; Pro APK = full library;
// Expansion Packs (future) = tier 'expansion', purchased individually.
import fs from 'node:fs';

const FREE_FILMS = ['gold200', 'portra400', 'hp5plus', 'velvia50', 'colorplus'];   // color neg / portrait / B&W / slide / consumer
const FREE_CAMERAS = ['trip35', 'instamatic', 'af35m', 'lca', 't4'];               // the classic point-and-shoots
// The Pro library keeps growing: stocks and bodies added in later rounds belong to the Pro
// APK, not to a separate expansion pack — a pack is only what is sold on its own.
const PRO_FILMS = ['trix400', 'delta100', 'kentmere400', 'portra160', 'ektar100', 'vision3-500t', 'cinestill800t', 'provia100f', 'e100', 'kodachrome64',
  'portra800', 'ultramax400', 'fp4plus', 'delta3200', 'acros2', 'cinestill400d', 'cinestill50d', 'fomapan100', 'metropolis', 'purple', 'ferrania-p30', 'tmax100', 'hanabi'];
const PRO_CAMERAS = ['l35af', 'contaxt2', 'mju2', 'gr1v', 'tc01',
  'xa', 'rollei35', 'p67',                        // premium compacts + the new experience routes
  'canonetql17', 'bigmini', 'ga645', 'n35ti', 'hexaraf'];

function patch(file, key, freeIds, proIds){
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = 0;
  for (const item of doc[key]){
    const want = freeIds.includes(item.id) ? 'free' : proIds.includes(item.id) ? 'pro' : 'expansion';
    if (item.tier !== want){ item.tier = want; changed++; }
  }
  fs.writeFileSync(file, JSON.stringify(doc, null, 1));
  console.log(`${file}: ${doc[key].length} items, ${changed} tier changes`);
}

patch('assets/films.json', 'films', FREE_FILMS, PRO_FILMS);
patch('assets/cameras.json', 'cameras', FREE_CAMERAS, PRO_CAMERAS);

// sanity: exactly 5 free of each, no duplicates between lists
const f = JSON.parse(fs.readFileSync('assets/films.json', 'utf8')).films;
const c = JSON.parse(fs.readFileSync('assets/cameras.json', 'utf8')).cameras;
const count = (arr, t) => arr.filter(x => x.tier === t).length;
console.log('films free/pro:', count(f, 'free'), '/', count(f, 'pro'), ' cameras free/pro:', count(c, 'free'), '/', count(c, 'pro'));
if (count(f, 'free') !== 5 || count(c, 'free') !== 5) throw new Error('tier split broken');
