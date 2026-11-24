# POCKETROLL 35 — architecture & business model (Round⑦ plan, user-defined)

**Product principle:** A little camera. A lot of memories. Sell the experience of shooting film, not filters.

## Business model — three tiers

| Tier | Price | Distribution | Contents |
|---|---|---|---|
| **Free Web Demo** | US$0 | https://huckn1900.github.io/pocketroll/ | classic 5 films + 5 cameras, full core ritual (shoot → latent → develop → contact sheet → archive) |
| **POCKETROLL 35 PRO** | **US$6.99 one-time** | Patreon purchase → downloadable Android APK | full built-in library: all finished film profiles + all camera profiles, all Pro features, permanent — no subscription. Profiles still in development carry `status:"coming"` and show as COMING SOON (not included in Pro until released) |
| **Expansion Packs** | per pack, optional | future, on demand | Film Packs (new stocks/color science/grain) & Camera Packs (new bodies/imaging character); each purchase permanently unlocks its pack |

Flow: **TRY IT** (free web) → **OWN IT** (Pro APK via Patreon) → **EXPAND IT** (content packs).
The free demo is the storefront: it demonstrates the ritual and locks the rest of the library behind a visible PRO tag + a GET PRO button in Settings.

**Platform boundary:** the $6.99 Patreon APK plan covers **Android only** today. iOS needs its own distribution/payment design matching Apple store rules (likely standard IAP, separate price tier) — deferred, do not block Android.

## Module architecture

**Conceptual shape (unchanged):** App owns CameraEngine · FilmEngine · Gallery · RollManager;
Licensing owns LicenseManager · PurchaseVerification · PackEntitlements; Content is profile
files only — engines never hardcode content. Adding a film = adding a Film Profile; adding a
pack = adding pack files + entitlement info. Core stays stable.

**Implemented file layout (Round⑯, stage 1 — storage, roll and camera extraction):**

```
pocketroll/
├── index.html          loads plain scripts in order: storage → film → camera → app.js
├── app.js              FilmEngine, profiles/casts, app state, every renderer, boot & wiring
├── storage/
│   ├── database.js     IndexedDB v2 (rolls + scans), openDB/getAll/put/delete, storage estimate
│   ├── current-roll.js the roll in the camera: identity, record, save/drop/restore, scan save
│   ├── archive.js      developed rolls, legacy migration, thumbs, whole-roll zip export
│   └── backup.js       schemaVersion 2 payload, validation, restore plan, merge + rollback
├── film/
│   ├── roll-manager.js applying stock, threading a new roll, the lifecycle gate
│   └── development.js  back door, the one-tank develop run, bell, contact sheet
├── camera/
│   ├── camera-manager.js sensor lifecycle, demo fallback, body swap, background pause/resume
│   └── capture.js      the moment of exposure: frame, leak, date stamp, thumbnail, roll record
├── assets/             cameras.json · films.json · samples · fonts
├── sw.js               shell pre-cache + network-first for code
└── licensing/          (Pro APK stage) license-manager.js · entitlement-manager.js
```

Rules that keep the split honest:
- Plain scripts sharing one global scope, no bundler — the web demo ships as files, and the
  service worker serves code network-first. `index.html` loads storage → film → camera → app;
  nothing runs at load time, only at `boot()`, so load order is readability, not a dependency.
- `app.js` owns the engine, the state object and every renderer; modules own device and data
  behaviour and call renderers by name. A module never writes DOM copy — that is UI.
- Anything that exists only at the shutter lives in `camera/capture.js`; anything that changes
  what is on record lives in `storage/`.
- Stage 2 (when Pro/licensing lands): `app/state.js`, `app/ui/*`, `film/film-preview.js`
  (the swap gate choices), `film/scan.js` (the lab-scan path), `licensing/*`. Extracting on
  demand beats a big-bang rewrite: the regression suite stays green at every step.

## Content entitlement contract

Every content item/pack carries:
- Content ID (`gold200`, `contaxt2`, future `pack-film-01`…)
- Version
- License requirement (`free` | `pro` | `expansion:<pack>`)
- Configuration / parameter files (existing `assets/films.json` / `assets/cameras.json` schema)
- Purchase entitlement (how the buyer is proven to own it)

## Current implementation status (web prototype)

- `scripts/patch-tiers.mjs` tags every profile with `tier: free|pro` — **5 free films** (gold200, portra400, hp5plus, velvia50, colorplus — one per film family) and **5 free cameras** (trip35, instamatic, af35m, lca, t4); premium compacts (Contax T2, MJU-II, GR1v, TC-01, L35AF) and the remaining stocks are `pro`. Expansion items will get `tier: expansion`.
- `buildLists()` shows locked Pro profiles with an amber `PRO` tag; tapping one hints the Pro APK instead of loading (`proHint()`). URL hooks (`?cam=`, `?film=`) bypass gating for testing/development only.
- Settings carries the **GET PRO APK · US$6.99 · PATREON** button + a one-time/Android/iOS-later hint. The Patreon page URL is a placeholder (`https://www.patreon.com/`) until the creator page exists — swap it then.
- License state on the web is fixed to `free` (`state.license` concept); PurchaseVerification for the APK will validate the Patreon purchase and store entitlements locally (offline-capable).

## Film library roadmap (Round⑰, user-defined)

**Temporary test unlock (web only).** `app.js` carries `const WEB_LICENSE = 'all'`, which opens
every finished stock in the browser so each one's colour science can be tried and calibrated.
Profiles keep their `tier`, and the shelf still prints the `PRO` tag next to a Pro stock's
name plus a one-line note saying this is a test build — opening everything here must not read
as "the free web owns the full library". Re-locking = set `WEB_LICENSE = 'free'`; pricing and
entitlements are untouched. Cameras keep the production gate (films were what was asked for).

**Every stock owns its own parameters.** No shared colour preset: white balance, exposure bias,
toe/shoulder curve, `rgb_matrix`, split-tone tint, grain size + ISO response, highlight and
shadow behaviour, leak probability are per-profile numbers (`scripts/patch-films.mjs` keeps
matrix rows summing to 1). The spread below is a *simulated* target direction, not published
manufacturer data.

| Image route | Stocks covering it |
| --- | --- |
| Warm everyday | Gold 200, ColorPlus 200 |
| Natural portrait | Portra 160 / 400 / 800 |
| Vivid colour | Ektar 100, UltraMax 400 |
| Classic B&W | Tri-X 400, HP5 Plus, FP4 Plus |
| Fine B&W | Delta 100, Acros II, T-Max 100 |
| Dramatic B&W | Delta 3200, Ferrania P30 |
| Slide film | Velvia 50, Provia 100F, Ektachrome E100 |
| Cinema | Vision3 500T, Cinestill 800T / 400D / 50D |
| Experimental | LomoChrome Metropolis, LomoChrome Purple |

Brand grouping stays in the shelf (it scales to dozens of expansion packs); what the library
must actually cover is the **image route**, so a stock is added only where a route is thin —
Portra 800 fills low-light portraiture, Delta 3200 the only dramatic high-speed B&W, 400D the
daylight side of the cinema pair.

**Candidates, in priority order (12).** Kodak Portra 800 · Kodak UltraMax 400 · Ilford FP4
Plus · Ilford Delta 3200 · Fujifilm Neopan Acros II 100 · Cinestill 400D · Cinestill 50D ·
Foma Fomapan 100 Classic · LomoChrome Metropolis · LomoChrome Purple · Ferrania P30 · Kodak
T-Max 100. Each arrives as a profile carrying `tier`, `process` and tuned parameters — never a
copy of another stock's preset, and preview samples are always rendered by this engine on a
neutral body (never stock photos).

**Lab process is part of the identity.** `assets/films.json` carries `process`
(`scripts/patch-film-process.mjs` validates it against the profile type): **C-41** (consumer
colour negative), **ECN-2** (motion-picture negative — Vision3 and Cinestill are a separate
system, not ordinary C-41), **E-6** (transparency), **B&W**, **D-70** (Kodachrome 64: retired
2009, its processing lines no longer exist anywhere, so its render is stated as an
approximation). The shelf prints the process beside the ISO and the preview prints it in the
meta line, so a lab result can never be confused with a filter preset.

## Photo persistence & backup layer (Round⑨, tightened in Round⑮)

- **Storage**: IndexedDB `pocketroll-db` (version 2) holds two stores — `rolls` and `scans`.
  A roll in the camera is a **record with an identity**, not a scratch array:
  `{id, camId, cam, filmId, film, iso, loadedAt, developedAt, status:'shooting'|'developed', notes, frames:[{u,t,fav,brand,iso}]}`.
  Every shutter press writes it (`saveCurrentRoll()`), so closing the app loses nothing; reopening
  restores the same roll, same counter, same latent frames (`restoreCurrentRoll()`).
  localStorage holds settings only (options incl. sensor choice). Without IndexedDB the app says
  plainly that nothing persists and points at EXPORT BACKUP instead of pretending to keep things.
- **Two kinds of images, never mixed**: `roll.frames` = real shutter exposures (36 max, counted);
  `scans` = photos run through the loaded film by SCAN IN PHOTO — lab prints, stored in the `scans`
  store and shown on their own shelf. An import never changes the roll count and never turns a
  36-frame roll into 46.
- **Roll lifecycle gate**: an empty camera may take any stock; an exposed, undeveloped roll must be
  resolved first — DEVELOP it or open the back door (frames fog); a developed roll is archived
  before anything new is threaded. The film preview offers those choices instead of a generic
  confirm dialog, because this is the product's physical lifecycle.
- **One developer tank**: `developRoll()` is guarded by `isDeveloping` — a second tap is refused,
  related actions go disabled while the tank runs, and a thrown step leaves the roll latent rather
  than half-developed, so a retry is safe. One develop → one archive record → one contact sheet.
- **Roll record schema** (`status` distinguishes a live roll from an archived one) — this is the
  same record the Pro APK's RollManager/gallery will ship, so the archive format doubles as the
  interchange format.
- **Backup & Restore** (`schemaVersion: 2`): one JSON export carrying counts + rolls + scans + the
  roll currently in the camera. Import validates structure first, skips records with unusable
  frames (reported, not silently repaired), shows a plan — "will restore N rolls · N frames · N
  scans · latent frames go back into the camera · what you already kept stays kept" — and only
  applies on CONFIRM. Re-imports merge by id (refresh, never pile up); a failed write rolls the
  archive back to exactly what was kept before. A per-roll `.zip` export (frames + roll.json) stays
  the sharing escape hatch.
- **Camera**: `playsInline` + `muted` and an awaited `play()`; rear/front sensor choice persists in
  settings. There is **no stand-in scene** — the finder shows the sensor or it shows nothing, so a
  drawn picture never claims a camera that is not working. An interrupted stream retries; the state
  is stated plainly ("camera: live feed · rear sensor" / "camera: blocked · no feed in the finder")
  with RETRY CAMERA; unused tracks are stopped when switching; the preview pauses when the page goes
  to the background; a shutter press with no feed prints no frame and says why; with no signal the
  screen goes dark instead of holding its last frame, so a dead sensor never looks like a live one.
- **Opening the app**: the first screen is a film leader (`#bootScreen`) that says what the app is
  waiting for — "starting camera…" — instead of showing a placeholder image. It ends the moment the
  sensor answers either way (feed in hand, green LED; blocked, red LED and the retry path), so the
  page opens directly into a camera you can press.
- **Storage management**: the archive page shows rolls/frames/scans plus approximate bytes used and
  quota (`navigator.storage.estimate()`), asks for `navigator.storage.persist()`, and states what
  survives refresh and offline.
- **Build notice**: `sw.js` only caches `res.ok` responses and never fails a request over a cache
  write; `CACHE` in sw.js and `BUILD` in app.js are bumped together on deploy, and a mismatch shows
  "NEW VERSION AVAILABLE · RELOAD" instead of quietly running an older build.

## Camera bag roadmap (Round⑱)

The bag started as a shelf of 35mm fixed-lens point-and-shoots. The expansion round is about
**different operations**, not different-looking compacts: different lens angles, focus systems,
body structures and imaging character. A body that only changes the name on the nameplate is a
filter with a label, so every profile states its own machine-readable parameters
(`assets/cameras.json`, maintained by `scripts/patch-new-cameras.mjs`, which refuses two bodies
sharing the same operation signature).

**Five experience routes** (`route`, shown as captions in CAMERA BAG):

| route | what it is | bodies now |
|---|---|---|
| `everyday` | automatic pocket cameras, one job: point and press | Big Mini BM-201, QuickSnap CL, AF35M, Instamatic, Trip 35, LC-A |
| `rangefinder` | focus by coinciding two images; you choose the light | Olympus XA, Canonet QL17 GIII |
| `mechanical` | clockwork and scales, no electronics between you and the film | Rollei 35 |
| `premium` | engineering and character, quiet operation | 35Ti, Hexar AF, μ II, Contax T2, GR1V, T4, TC-1 |
| `medium` | a bigger negative — a different frame shape, not just a bigger camera | Pentax 6×7, GA645 Professional |

**Per-body parameters.** Each profile carries: `route`, `focus_mode` (`af` | `scale` |
`rangefinder` | `slr`), `focus_system`, `exposure_system`, `shutter_character`, `frames`,
optional `gate` `{film, short_mm, long_mm, aspect}`, `finder`, `hud` (flash availability, shutter
readout, focus hint) and `camera_character` (`color_cast`, `vignette`, `sharpness`,
`halation_bias`, optional `grain_bias`). The finder draws its focus aid from `focus_mode` — a
split-image patch for rangefinders, a centre focus box for AF, a ground-glass-style screen for
SLR, nothing for scale focus — and the HUD states the focus method in terse tokens.

**The nameplate is data, not a guess.** The status plate prints the body's own nameplate:
`plate` when the model string is only a number or a print format (`PENTAX 6×7`, `OLYMPUS XA`,
`ROLLEI 35`, `NIKON 35Ti`, `KONICA HEXAR AF` — scripts/patch-nameplates.mjs), otherwise the
model, which is already self-identifying (`TRIP 35`, `CANONET QL17 GIII`). The finder stage
keeps a compact's LCD box (clamped 0.72–1.34) for 135 bodies, and shows a gate's real shape for
medium-format bodies — 6×7 at 1.273, 6×4.5 at 1.349 — never trimmed to 4:3.

**A gate is real.** A body with `gate` crops the view *before* film science runs, drives the
finder stage ratio, and sets the export frame ratio and the roll capacity — `rollCapacity()`
reads the profile, never 36. Pentax 6×7 prints 55×70mm on 120 (eight exposures, waist-level
screen, TTL metering, interchangeable lens); GA645 Professional prints 41.5×56mm on 120
(sixteen exposures, per its manual). Both keep the medium-format character honest: grain reads
finer per pixel (`grain_bias` < 1) because the negative is larger. An archive record carries the
`format` it was shot on, so a 120 roll never comes back labelled as 35mm. Swapping to a body
with a different gate is refused while an exposed roll is loaded; after DEVELOP or a back-door
fog, the empty roll is exchanged and the new body holds its own capacity.

**Candidates, in priority order (8).** Olympus XA ✓ · Rollei 35 ✓ · Canonet QL17 GIII ✓ ·
Konica Big Mini BM-201 ✓ · Pentax 6×7 ✓ · Fujifilm GA645 ✓ · Nikon 35Ti ✓ · Konica Hexar AF ✓.
Specs are quoted only where a source states them; an interchangeable system says so instead of
inventing a focal length. Shutter *sound* is a separate track: per-body character (a near-silent
Hexar, a mechanical Rollei, the mirror-slap of a 6×7) is prototyped in `sounds.html` first and
merged into `app.js` only after the variants are chosen.

## Future content updates

New film → new profile JSON only. New camera → same. New pack → pack folder + entitlement. FilmEngine/CameraEngine keep reading configs; no core rewrite.
