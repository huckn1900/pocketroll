// scripts/patch-new-cameras.mjs — idempotent: add the camera-expansion bodies, and give
// EVERY body its own machine-readable operation fields.
//
// The point of this round is not another compact that looks different: each body must state
// how it is actually operated — how it focuses, how it meters, what gate the film is printed
// at, how many frames that gate holds, and what the shutter sounds like. A body that only
// changes the name on the nameplate is not a camera, it is a filter with a label.
import fs from 'node:fs';

// --- operation fields for the bodies already in the bag -------------------------------------
// Derived from each profile's own descriptive text; nothing here invents a capability.
const SYSTEMS = {
  trip35:     { route: 'everyday', focus_mode: 'scale', focus_system: 'three-zone scale, no rangefinder patch', exposure_system: 'selenium meter, two fixed exposures', shutter_character: 'leaf shutter, near-silent click', hud: { flash: 'off', shutter: 'PRGM 1/60', focus_hint: 'zone: no readout' } },
  instamatic: { route: 'everyday', focus_mode: 'scale', focus_system: 'zone scale', exposure_system: 'fixed shutter/aperture pairs', shutter_character: 'leaf shutter, soft clunk', hud: { flash: 'on', shutter: 'PRGM 1/60', focus_hint: 'zone scale' } },
  af35m:      { route: 'everyday', focus_mode: 'af', focus_system: 'active infrared autofocus (the first AF camera)', exposure_system: 'program AE with built-in flash', shutter_character: 'leaf shutter, quick snap', hud: { flash: 'on', shutter: 'PRGM' } },
  l35af:      { route: 'everyday', focus_mode: 'af', focus_system: 'autofocus', exposure_system: 'program AE', shutter_character: 'leaf shutter, quick snap', hud: { flash: 'off', shutter: 'PRGM' } },
  lca:        { route: 'everyday', focus_mode: 'scale', focus_system: 'zone scale', exposure_system: 'auto aperture with an override button', shutter_character: 'leaf shutter, audible clack', hud: { flash: 'off', shutter: '1/125', focus_hint: 'zone scale' } },
  t4:         { route: 'premium', focus_mode: 'af', focus_system: 'autofocus', exposure_system: 'program AE + DX coding', shutter_character: 'leaf shutter, quiet snap', hud: { flash: 'none', shutter: '1/250' } },
  contaxt2:   { route: 'premium', focus_mode: 'af', focus_system: 'autofocus with manual override', exposure_system: 'program AE + aperture priority', shutter_character: 'leaf shutter, quiet click', hud: { flash: 'none', shutter: '1/250' } },
  mju2:       { route: 'premium', focus_mode: 'af', focus_system: 'autofocus', exposure_system: 'program AE', shutter_character: 'leaf shutter, dry click', hud: { flash: 'none', shutter: '1/200' } },
  gr1v:       { route: 'premium', focus_mode: 'af', focus_system: 'multi-point AF, preset 1-5m, or manual', exposure_system: 'aperture priority + manual ISO', shutter_character: 'leaf shutter, silent snap', hud: { flash: 'none', shutter: '1/500', focus_hint: 'preset zone or AF' } },
  tc01:       { route: 'premium', focus_mode: 'af', focus_system: 'autofocus', exposure_system: 'program AE', shutter_character: 'leaf shutter, small click', hud: { flash: 'none', shutter: 'PRGM' } },
};

// --- the three new bodies ------------------------------------------------------------------
// Lens facts are only stated where a source states them; where a system is interchangeable,
// the profile says so instead of quoting a focal length we have not verified.
const NEW = [
  { id: 'xa', brand: 'Olympus', model: 'XA', year: 1979, route: 'rangefinder',
    format: '35mm (135)', frames: 36,
    lens: { focal_mm: 35, aperture: 'f/2.8 Zuiko', elements: '6 elements / 5 groups, reverse retrofocus' },
    focus: 'rangefinder with a coincident patch', focus_mode: 'rangefinder',
    focus_system: 'rangefinder patch · focus when the two images merge',
    exposure: 'aperture priority: you set the f-stop, the meter picks the shutter', exposure_system: 'aperture priority',
    finder: 'direct optical with frame lines and the shutter speed at the side',
    shutter_character: 'tight focal-plane click, thumb-wheel advance',
    features: ['sliding dust cover', 'aperture lever on the right side', 'ISO dial below the lens', 'thumb-wheel film wind', 'base lever adds 1.5 stops for backlight'],
    camera_character: { color_cast: 'clean and slightly warm, small sharp prime', vignette: 0.06, sharpness: 0.9, halation_bias: 0.12, quirk: 'pocket rangefinder framing, no confirmation', distortion: 0 },
    hud: { flash: 'none', shutter: 'AP 1/250', focus_hint: 'rangefinder patch' },
    price_usd: '120-260 used', vibe: 'the pocket rangefinder',
    story: 'Designed by Yoshihisa Maitani and sold from 1979 to 1985 — one of the smallest rangefinder cameras ever made. The lens team had to invent a reverse-retrofocus six-element design to fit 35mm into a 4cm body. You set the aperture with a lever on the right side, focus by a lever under the lens, and read the shutter speed at the side of the finder: nothing chooses for you except the shutter.',
    tier: 'pro' },
  { id: 'rollei35', brand: 'Rollei', model: '35', year: 1966, route: 'mechanical',
    format: '35mm (135)', frames: 36,
    lens: { focal_mm: 40, aperture: 'f/3.5 Steinheil Cassar', elements: '3 elements, in a retracting sliding tube' },
    focus: 'focus set from a distance scale, no rangefinder patch', focus_mode: 'scale',
    focus_system: 'scale focus · dial the distance, no confirmation',
    exposure: 'fully manual: aperture dial and shutter dial, no meter assistance', exposure_system: 'fully manual',
    finder: 'small direct optical finder',
    shutter_character: 'mechanical leaf shutter, audible clunk and a slow cocking stroke',
    features: ['lens retracts into the body', 'shutter split between body clockwork and lamellas in the tube', 'fully manual dials', 'cocking lever top-left, rewind bottom-right'],
    camera_character: { color_cast: 'neutral with a faint warm bias, soft three-element rendering', vignette: 0.12, sharpness: 0.62, halation_bias: 0.18, quirk: 'three-element Cassar: gentle edges, low micro-contrast', distortion: 0 },
    hud: { flash: 'none', shutter: 'MANUAL 1/125', focus_hint: 'scale focus' },
    price_usd: '180-400 used', vibe: 'the mechanical classic',
    story: 'Shown at photokina in 1966, Heinz Waaske\'s camera was the smallest 135 camera then existing. A normal leaf shutter would not fit around the fully retracting lens, so the shutter was split: the clockwork stays in the body, the lamellas ride in the sliding tube, coupled by shafts. Roughly two million of the series were made over thirty years; production continued in small batches until 2015. There is no meter and no autofocus — you read the light yourself.',
    tier: 'pro' },
  { id: 'p67', brand: 'Asahi Pentax', model: '6×7', year: 1969, route: 'medium',
    format: '120 rollfilm · 55×70mm frame', frames: 8,
    gate: { film: '120', short_mm: 55, long_mm: 70, aspect: 70 / 55 },
    lens: { focal_mm: null, aperture: 'interchangeable standard lens', elements: '6×7 bayonet mount, inner and outer' },
    focus: 'focus viewed on the SLR focusing screen through a waist-level finder', focus_mode: 'slr',
    focus_system: 'SLR focusing screen · waist-level finder',
    exposure: 'fully manual with through-the-lens metering', exposure_system: 'fully manual, TTL metering',
    finder: 'waist-level finder on the 6×7 focusing screen',
    shutter_character: 'focal-plane shutter with mirror slap, then a long dull thud',
    features: ['6×7 gate: 55×70mm on 120 film', 'interchangeable viewfinder and lens', 'waist-level finder', 'mirror lock-up (added 1976)', 'eight exposures per roll'],
    camera_character: { color_cast: 'neutral, even coverage across a large negative', vignette: 0.03, sharpness: 0.95, halation_bias: 0.06, grain_bias: 0.75, quirk: 'large negative: grain reads finer, edges stay clean', distortion: 0 },
    hud: { flash: 'none', shutter: 'MANUAL TTL', focus_hint: 'TTL · waist level' },
    price_usd: '250-600 used', vibe: 'the medium-format camera',
    story: 'The Asahi Pentax 6×7 launched in 1969: a 55×70mm frame on 120 rollfilm — eight exposures, not thirty-six — behind an interchangeable lens and viewfinder on a body so large that fans nicknamed it Baké-PEN, the monster Pentax. Mirror lock-up came in 1976. It is worked like a large SLR: metered through the lens, focused on a screen at waist level, and shot slowly because every frame costs.',
    tier: 'pro' },
  // --- the next five bodies: different lens angles, focus systems, structures -----------------
  // Specs are quoted only where a source states them (camera-wiki, Canon's own museum page,
  // the GA645 manual, CameraQuest, KenRockwell); anything unverified is left out instead of guessed.
  { id: 'canonetql17', brand: 'Canon', model: 'Canonet QL17 GIII', year: 1972, route: 'rangefinder',
    format: '35mm (135)', frames: 36,
    lens: { focal_mm: 40, aperture: 'f/1.7 Canonet Lens' },
    focus: 'coupled rangefinder with parallax compensation for close focus', focus_mode: 'rangefinder',
    focus_system: 'coupled rangefinder · parallax-compensated close focus',
    exposure: 'shutter-priority EE: the meter picks the shutter, the aperture ring has an A position and manual f-stops', exposure_system: 'shutter-priority EE (CdS), manual aperture override',
    finder: 'bright direct optical with frame lines',
    shutter_character: 'leaf shutter, small metallic click',
    features: ['QL quick-load back: drop the cartridge in, no leader to thread', 'shutter-priority EE with an aperture ring', 'parallax compensation dial for close work', 'self timer', 'clip-on lens hood'],
    camera_character: { color_cast: 'neutral with a faint warm bias, fast bright prime', vignette: 0.08, sharpness: 0.85, halation_bias: 0.16, quirk: 'frame lines you must respect; parallax offset close in', distortion: 0 },
    hud: { flash: 'none', shutter: 'EE 1/125', focus_hint: 'rangefinder patch' },
    price_usd: '60-160 used', vibe: 'the bright cheap rangefinder',
    story: 'Made from 1972 to 1982, the G-III QL17 is the last and best of Canon\'s Canonet line — nicknamed Kanonnet in Japan. A coupled rangefinder with a fully shutter-priority CdS EE meter and an f/1.7 lens: the aperture ring sits at A for automatic work, or you choose an f-stop yourself. QL means Quick Load: the cartridge drops straight into the back, no leader to thread. It earned its reputation as the rangefinder for people who could not buy a Leica.',
    tier: 'pro' },
  { id: 'bigmini', brand: 'Konica', model: 'Big Mini BM-201', year: 1990, route: 'everyday',
    format: '35mm (135)', frames: 36,
    lens: { focal_mm: 35, aperture: 'f/3.5 Konica Lens', elements: '4 elements / 4 groups' },
    focus: 'infrared non-scan autofocus, focus lock by half-depressing the release', focus_mode: 'af',
    focus_system: 'infrared non-scan AF · focus lock at half-press',
    exposure: 'programmed AE from a centre-weighted CdS meter, DX-coded film ISO 25–3200', exposure_system: 'program AE (CdS centre-weighted), DX coded',
    finder: 'bright direct optical with control LEDs',
    shutter_character: 'leaf shutter, quick functional click',
    features: ['built-in flash reaching 3.8 m at ISO 100', 'macro mode for 35–60 cm', 'DX film-speed recognition', 'automatic winding and rewind', 'LCD readout', 'a version that prints the date on the film'],
    camera_character: { color_cast: 'neutral, slightly flat and hazy', vignette: 0.10, sharpness: 0.55, halation_bias: 0.22, quirk: 'four-element lens: soft edges, flare-prone against bright sources', distortion: 0 },
    hud: { flash: 'on', shutter: 'PRGM', focus_hint: 'AF · lock at half-press' },
    price_usd: '40-120 used', vibe: 'the automatic pocket compact',
    story: 'Launched in 1990, the Big Mini is Konica\'s small fully automatic compact: a four-element 35mm f/3.5, infrared non-scan autofocus, a centre-weighted CdS program meter and DX coding from ISO 25 to 3200 — everything is decided for you except where you point it. It became a cult classic in Japan precisely because it is humble: 188 g, no pretence, and a lens that renders plainly rather than beautifully.',
    tier: 'pro' },
  { id: 'ga645', brand: 'Fujifilm', model: 'GA645 Professional', year: 1995, route: 'medium',
    format: '120 rollfilm · 41.5×56mm frame', frames: 16,
    gate: { film: '120', short_mm: 41.5, long_mm: 56, aspect: 56 / 41.5 },
    lens: { focal_mm: 60, aperture: 'f/4 Super Fujinon' },
    focus: 'hybrid active/passive autofocus with a manual focusing mode and focus lock', focus_mode: 'af',
    focus_system: 'hybrid active/passive AF · manual mode with focus lock',
    exposure: 'programmed AE, aperture-priority AE, or manual exposure; exposure compensation', exposure_system: 'program AE, aperture priority, or manual',
    finder: 'eye-level finder with autofocus framelines',
    shutter_character: 'motorized leaf shutter, a soft program clunk',
    features: ['6×4.5 gate: 41.5×56mm on 120 film, sixteen exposures', 'motorized winding and rewind', 'built-in flash', 'exposure data shown and printed on the LCD', '220 roll holds thirty-two frames'],
    camera_character: { color_cast: 'neutral, clean coverage across the frame', vignette: 0.04, sharpness: 0.9, halation_bias: 0.08, grain_bias: 0.85, quirk: 'medium-format negative: grain reads finer than 135', distortion: 0 },
    hud: { flash: 'on', shutter: 'PRGM 1/250', focus_hint: 'AF · manual override' },
    price_usd: '250-500 used', vibe: 'the autofocus medium format',
    story: 'The GA645 Professional, from around 1995, was sold as the world\'s first fully automatic 6×4.5 camera. Its manual states the gate plainly: picture size 6×4.5cm, actual picture size 56×41.5mm, sixteen exposures on a 120 roll and thirty-two on 220 — so this body prints a different shape of negative from every 35mm compact in the bag. It works like a compact though: hybrid autofocus, program exposure, motorized winding.',
    tier: 'pro' },
  { id: 'n35ti', brand: 'Nikon', model: '35Ti', year: 1993, route: 'premium',
    format: '35mm (135)', frames: 36,
    lens: { focal_mm: 35, aperture: 'f/2.8 Nikkor', elements: '6 elements / 4 groups, double-Gauss' },
    focus: 'active infrared autofocus with a manual scale-focus fallback', focus_mode: 'af',
    focus_system: 'active IR autofocus · manual scale override',
    exposure: 'programmed AE with an aperture override, metered by a 6-segment 3D matrix meter', exposure_system: 'program AE with aperture override, 6-segment matrix metering',
    finder: 'direct optical; the aperture and shutter are shown on analogue dials in the lens barrel',
    shutter_character: 'leaf shutter, a measured quiet click',
    features: ['titanium covers', 'analogue aperture and shutter dials in the barrel', 'six-segment matrix metering', 'built-in flash', 'data imprint', 'panorama mode'],
    camera_character: { color_cast: 'neutral and exact, an unusually sharp compact prime', vignette: 0.05, sharpness: 0.98, halation_bias: 0.1, quirk: 'reads like an instrument: dials, not digits', distortion: 0 },
    hud: { flash: 'on', shutter: 'PRGM 1/250', focus_hint: 'AF · scale fallback' },
    price_usd: '300-600 used', vibe: 'the instrument compact',
    story: 'The 35Ti came out in 1993 at about a thousand dollars: 35 for the lens, Ti for the titanium covers. Inside the barrel are analogue dials that show the chosen aperture and shutter speed while the camera meters the scene with Nikon\'s six-segment 3D matrix meter — the most instrument-like compact Nikon ever made. It stayed in production until 1999, and its double-Gauss f/2.8 is one of the best lenses ever fitted to a 35mm camera.',
    tier: 'pro' },
  { id: 'hexaraf', brand: 'Konica', model: 'Hexar AF', year: 1993, route: 'premium',
    format: '35mm (135)', frames: 36,
    lens: { focal_mm: 35, aperture: 'f/2 Hexar Lens', elements: '7 elements / 6 groups' },
    focus: 'active infrared autofocus in 290 steps; autofocus and exposure lock at half-press', focus_mode: 'af',
    focus_system: 'active IR AF in 290 steps · AE/AF lock at half-press',
    exposure: 'programmed, aperture-priority or match-needle, metered by a non-TTL silicon cell (wide or spot)', exposure_system: 'program, aperture priority or match-needle, non-TTL silicon metering',
    finder: 'bright optical with motorized framelines and AF cross-hairs',
    shutter_character: 'electronic leaf shutter, famously silent — in stealth mode the advance is quieter than a Leica M',
    features: ['silent stealth film advance', 'non-TTL silicon metering with a wide or spot angle', 'guide-number flash system that works with any flash', 'DX 25–5000, manual 6–6400', 'shutter 30 s to 1/250 plus T', 'built-in lens hood'],
    camera_character: { color_cast: 'neutral, fast and clean', vignette: 0.04, sharpness: 0.97, halation_bias: 0.12, quirk: 'available-light street camera: its meter needs watching', distortion: 0 },
    hud: { flash: 'none', shutter: 'PRGM 1/250', focus_hint: 'AF · AE lock at half-press' },
    price_usd: '250-500 used', vibe: 'the silent street camera',
    story: 'Konica\'s flagship compact from 1993: a fixed seven-element 35mm f/2 reputed to be near a copy of the Leica Summicron, combined with autofocus — which made it faster to work than any manual-focus rangefinder, and quieter: in stealth mode the motorized advance is quieter than an M6. Its metering is deliberately primitive (non-TTL silicon, wide or spot), and there is no built-in flash: the guide-number system lets any flash meter correctly.',
    tier: 'pro' },
];

const doc = JSON.parse(fs.readFileSync('assets/cameras.json', 'utf8'));
let added = 0, patched = 0;
for (const c of doc.cameras) {
  if (c.route && c.focus_mode && c.hud) continue; // already carries its own operation fields
  const s = SYSTEMS[c.id];
  if (!s) throw new Error(`no operation fields for existing body ${c.id}`);
  const before = JSON.stringify(c);
  c.route = s.route; c.focus_mode = s.focus_mode; c.focus_system = s.focus_system;
  c.exposure_system = s.exposure_system; c.shutter_character = s.shutter_character;
  c.frames = c.frames || 36;
  c.hud = s.hud;
  if (JSON.stringify(c) !== before) patched++;
}
for (const c of NEW) {
  if (doc.cameras.some(x => x.id === c.id)) continue;
  doc.cameras.push({ id: c.id, brand: c.brand, model: c.model, year: c.year, route: c.route,
    format: c.format, frames: c.frames, gate: c.gate, lens: c.lens, focus: c.focus, focus_mode: c.focus_mode,
    focus_system: c.focus_system, exposure: c.exposure, exposure_system: c.exposure_system, finder: c.finder,
    shutter_character: c.shutter_character, features: c.features, camera_character: c.camera_character,
    hud: c.hud, price_usd: c.price_usd, vibe: c.vibe, story: c.story, tier: c.tier });
  added++;
}
fs.writeFileSync('assets/cameras.json', JSON.stringify(doc, null, 1));

// sanity: ids unique; every body states its route, focus and exposure systems, a frame count
// and a shutter character; a gate must be a real print ratio with matching mm and capacity.
const again = JSON.parse(fs.readFileSync('assets/cameras.json', 'utf8')).cameras;
const ids = again.map(c => c.id);
if (new Set(ids).size !== ids.length) throw new Error('duplicate camera ids');
const ROUTES = ['everyday', 'rangefinder', 'mechanical', 'premium', 'medium'];
const MODES = ['af', 'scale', 'rangefinder', 'slr'];
const bad = [];
for (const c of again) {
  if (!ROUTES.includes(c.route)) bad.push(`${c.id} route`);
  if (!MODES.includes(c.focus_mode)) bad.push(`${c.id} focus_mode`);
  if (!c.focus_system || !c.exposure_system) bad.push(`${c.id} systems`);
  if (!c.shutter_character) bad.push(`${c.id} shutter character`);
  if (!Number.isInteger(c.frames) || c.frames <= 0) bad.push(`${c.id} frames`);
  if (!c.hud || !c.hud.shutter) bad.push(`${c.id} hud`);
  if (!c.lens || typeof c.lens.aperture !== 'string') bad.push(`${c.id} lens`);
  if (c.gate) {
    const g = c.gate;
    if (!(g.short_mm > 0 && g.long_mm > g.short_mm)) bad.push(`${c.id} gate mm`);
    if (Math.abs(g.aspect - g.long_mm / g.short_mm) > 0.01) bad.push(`${c.id} gate aspect`);
    // a gate that is not 35mm must not pretend to hold a 36-frame 135 roll
    if (g.film !== '135' && c.frames > 24) bad.push(`${c.id} ${g.film} gate with ${c.frames} frames`);
    if (c.frames < 5) bad.push(`${c.id} capacity too small to be a roll`);
  } else if (c.frames !== 36) bad.push(`${c.id} 135 body with ${c.frames} frames`);
}
// each body must be distinguishable in operation, not just in name
const sig = again.map(c => [c.route, c.focus_mode, c.lens.focal_mm, c.lens.aperture, c.exposure_system, c.frames, c.gate ? c.gate.aspect : 'sensor', c.shutter_character].join('|'));
if (new Set(sig).size !== sig.length) throw new Error('two bodies share identical operation');
console.log(`assets/cameras.json: ${again.length} bodies, ${added} added, ${patched} given operation fields`);
console.log('routes:', ROUTES.map(r => `${r}=${again.filter(c => c.route === r).length}`).join(' · '));
if (bad.length) throw new Error('invalid bodies: ' + bad.join(', '));
