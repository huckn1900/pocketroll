# POCKETROLL 35 — architecture & business model (Round⑦ plan, user-defined)

**Product principle:** A little camera. A lot of memories. Sell the experience of shooting film, not filters.

## Business model — three tiers

| Tier | Price | Distribution | Contents |
|---|---|---|---|
| **Free Web Demo** | US$0 | https://huckn1900.github.io/pocketroll/ | classic 5 films + 5 cameras, full core ritual (shoot → latent → develop → contact sheet → archive) |
| **POCKETROLL 35 PRO** | **US$6.99 one-time** | Patreon purchase → downloadable Android APK | full built-in library: all finished film profiles + all camera profiles, all Pro features, permanent — no subscription. Profiles still in development carry `status:"coming"` and show as COMING SOON (not included in Pro until released) |
| **Expansion Packs** | per pack, optional | future, on demand | Film Packs (new stocks/color science/grain) & Camera Packs (new bodies/imaging character); each purchase permanently unlocks its pack |

Flow: **TRY IT** (free web) → **OWN IT** (Pro APK via Patreon) → **EXPAND IT** (content packs).
The free demo is the storefront: it demonstrates the ritual and locks the rest of the library behind a visible PRO tag + a PRO block in Settings. That block is a STATE, not a link: the Pro APK is still being built, so it reads COMING SOON and nothing is purchasable today.

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
│   └── backup.js       schemaVersion 2 payload, validation (rolls + inCamera), restore plan, merge committed in one transaction
├── film/
│   ├── roll-manager.js applying stock, threading a new roll, the lifecycle gate
│   └── development.js  back door, the one-tank develop run, bell, contact sheet
├── camera/
│   ├── viewfinder.js   the body's own finder: boundary from its optics, its focusing aid,
│   │                   its lamps, its instruments — read from cameras.json, nothing invented
│   ├── camera-manager.js sensor lifecycle, demo fallback, body swap, background pause/resume
│   └── capture.js      the moment of exposure: frame, leak, date stamp, thumbnail, roll record
├── assets/             cameras.json · films.json · samples · fonts
├── sw.js               shell pre-cache + network-first for code
├── scripts/            idempotent profile patches + make-icon.mjs (renders the brand mark)
├── icon.svg · icon.png · icon-192.png    the launcher mark, generated — never hand-edited
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

- The shipped library is measured from `assets/`, not written in docs: **28 film profiles** and
  **18 camera bodies**. Distribution today — films: 5 `free/current`, 21 `pro/current`, 1
  `pro/discontinued (2009)` (Kodachrome 64, D-70 lab, rendered as an approximation), 1
  `expansion/coming`; bodies: 5 `free/ready`, 13 `pro` (premium compacts such as Contax T2,
  MJU-II, GR1v, TC-01, L35AF). `scripts/patch-tiers.mjs` tags every profile with
  `tier: free|pro|expansion` — the free five are gold200, portra400, hp5plus, velvia50, colorplus
  (one per film family) and trip35, instamatic, af35m, lca, t4. Adding content = adding a profile
  file plus its entitlement; nothing else changes.
- Every body carries its own **viewfinder design** (`viewfinder` in `assets/cameras.json`, one
  design per body, kept by `scripts/patch-viewfinders.mjs` from manuals and authentic finder
  descriptions, drawn by `camera/viewfinder.js`). Selecting a body in the bag selects its finder
  with it; `test/viewfinder-check.mjs` compares what is drawn against what the profile declares
  and refuses marks no source states (see *Camera-specific viewfinder system* below).
- `buildLists()` shows locked Pro profiles with an amber `PRO` tag; tapping one hints the Pro APK instead of loading (`proHint()`). URL hooks (`?cam=`, `?film=`) bypass gating for testing/development only.
- Settings carries a **PRO APK · US$6.99 · COMING SOON** block (`.getpro.soon`, the ink-panel/amber vocabulary of a LOCKED · PRO card, nothing presses) plus lines saying it is not on sale yet, Android first, iOS later. When the creator page exists this becomes a real Patreon link and the wording becomes the purchase.
- License state on the web is fixed to `free` (`state.license` concept); PurchaseVerification for the APK will validate the Patreon purchase and store entitlements locally (offline-capable).
- **User Manual (`#manualModal`)** — opened from SETTINGS (`#openManual`), which closes the settings page so closing the manual lands back on the camera; `?page=manual` opens it directly for tests. The copy is print in `index.html`: a booklet on the same cream sheet (a dark cover panel carrying **text only** — kicker, name, two tagline lines — with sprocket bands as printed edges, exposure-numbered steps, hairline-divided spec rows, an edition line at the foot). It reuses `.modal/.sheet/.closebtn[data-close]/.divide`, the two type faces and the existing tokens — no new hue, no new layout token, no engine/roll/archive/storage code. The edition number exists in exactly one place: `app.js MANUAL_EDITION`; the markup carries no number. Reading the manual must never change camera or roll state (`test/probe-manual.txt` asserts open → state identical → close → shutter still answers).

## Film library roadmap (Round⑰, user-defined)

**Web licensing gate (web only).** `app.js` carries `const WEB_LICENSE` and `entitled()` is the
only place entitlement is decided. `'free'` is the released gate: the classic five stocks and
five bodies load, every PRO stock and body stays visible on the shelf reading `LOCKED · PRO`,
and its preview offers `UNLOCK WITH PRO` instead of loading. `'all'` opens every finished
profile in the browser so each one's colour science and operation can be tried and calibrated;
profiles keep their `tier`, and that mode prints the one-line note saying it is a test build so
opening everything never reads as "the free web owns the full library". Shipping either way
changes that single constant only — pricing and entitlements are untouched. Both shelves use the
same gate: a profile is a profile. `test/roll-check.mjs` asserts it: every PRO card reads
LOCKED · PRO, the free tier stays AVAILABLE / SELECTED, the unfinished stock stays COMING SOON,
the release build prints no test-build note, and trying a PRO stock or body never touches the
roll or the camera.
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
- **Removing a roll from the shelf**: `deleteArchivedRoll()` in `storage/archive.js` takes the
  record and its prints out of the store together, so a half-deleted shelf never holds missing
  photos; a failed write puts the roll back exactly where it was. DELETE is offered on developed
  records only -- the roll still in the camera is resolved on the deck roll page (DEVELOP or back
  door), never deleted here. The button arms on the first press and only the second press removes,
  which keeps the physical-choice language instead of adding a generic confirm dialog.
- **One developer tank**: `developRoll()` is guarded by `isDeveloping` — a second tap is refused,
  related actions go disabled while the tank runs, and a thrown step leaves the roll latent rather
  than half-developed, so a retry is safe. One develop → one archive record → one contact sheet.
- **Roll record schema** (`status` distinguishes a live roll from an archived one) — this is the
  same record the Pro APK's RollManager/gallery will ship, so the archive format doubles as the
  interchange format.
- **Backup & Restore** (`schemaVersion: 2`): one JSON export carrying counts + rolls + scans + the
  roll currently in the camera — a user holding only an undeveloped roll is exportable, because the
  exposures in the chamber are what they own right now (`backupPayload()` answers eligibility, so
  `backupAll()` never refuses a live roll). Import validates structure first: shelf records and the
  `inCamera` record are held to the same standard (identity, body, stock, gate, real exposures with
  an image source this app can actually write), unusable records are reported as skipped, never
  silently repaired. The plan — "will restore N rolls · N frames · N scans · latent frames go back
  into the camera · what you already kept stays kept" — is shown before CONFIRM. Re-imports merge by
  id (refresh, never pile up).
- **The restore is atomic**: the merged shelf is computed in memory, then committed as **one**
  IndexedDB readwrite transaction across both stores (`idbApply()`) — including the delete that
  clears the chamber's old record when an empty camera takes the imported roll. The transaction
  completes or aborts as a unit, so no partial restore is possible; the app applies the restored
  state (rolls, scans, camera, frames, counter, film) only after the store agrees, and a failed
  write leaves both the database and the current camera state exactly as they were.
- **Backup data is untrusted**: image URLs are validated against the formats the app writes
  (`safeImageURL()` — canvas data URLs, blob URLs) and placed through real elements
  (`document.createElement('img')` + `img.src`) or an escaped CSS `url()` (`cssUrl()`), never
  interpolated into HTML. A crafted backup file therefore cannot inject markup, CSS, or a link.
  A per-roll `.zip` export (frames + roll.json) stays the sharing escape hatch.
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
- **Brand mark**: `icon.svg`, `icon.png` (512, maskable-safe) and `icon-192.png` are rendered by
-   `node scripts/make-icon.mjs` at the proportions of the original mark: a lid bar above a wide
   top rim and bottom rim, only the LEFT edge of the body, and a short film strip coming out on
   the right — the sprocket holes and the carved corner are ground-colour cut-outs, so the mark
   never uses a third colour — with the `35` in the bundled brand face filling the body. Drawn in
   `#D94B37`, the exact colour the header prints its `35` in (`--red`), on the splash ground
   `#141311`. The PNGs are generated, never hand-edited; the manifest points at both sizes and iOS
   reads `apple-touch-icon`, so an installed shortcut on Android and iPhone gets the same mark.
   Chrome caches the icon of an already-installed app, so a new mark needs a re-install.
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
optional `gate` `{film, short_mm, long_mm, aspect}`, `viewfinder` (see the next section — what
that body's finder really shows), `hud` (flash availability, shutter readout, focus hint) and
`camera_character` (`color_cast`, `vignette`, `sharpness`, `halation_bias`, optional
`grain_bias`). The glass is not derived from `focus_mode`: it is declared per body, because two
bodies with the same focus system can show completely different things on it.

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

## Camera-specific viewfinder system (Round㊷, user-defined)

*"The viewfinder should not be a universal interface shared by every camera. It should be part of
each camera's identity."* One camera · one identity · one dedicated viewfinder: selecting a body
in the bag selects its finder with it, and that finder stays until another body is chosen.

**The config, per body** (`viewfinder` in `assets/cameras.json`, kept by
`scripts/patch-viewfinders.mjs`, which is idempotent and refuses any mark no source states):

- `id` — the design id (`<body>-vf`). The built stage carries it as `data-vf`, so the design on
  screen and the selected profile cannot drift apart.
- `optics` — `window` | `albada` | `field` | `rf` | `screen`. The boundary style is the optical
  construction, not a colour scheme: an Albada projects a bright frame, a rangefinder projects
  thin framelines, a Galilean whose window *is* the field draws the viewfield edge, a
  waist-level body draws a ground screen, a plain window draws nothing.
- `frame` — the projected frame's inset as a fraction of the displayed picture; `false` = the
  body projects no frame at all, `0` = the viewfield edge *is* the frame.
- `parallax` / `nearShift` / `closeFrame` / `ghosts` — near-focus marks printed at the focusing
  moment, a frame that slides for close focus, a permanent inner close-range frame, and the
  duplicate images a beam-splitter viewfinder really throws.
- `focus` + `focusShape` + `focusGeom` — the aid the body has: a coincident patch (soft-edged
  spot, oval reticle, central rectangle), an AF frame, AF marks, a crosshair, or a ground screen.
  Geometry is the aid's own size, as a fraction of the picture.
- `lamps` — `af` | `flash`, lit by the camera's own state, never by a tap.
- `readout` — `needle` (a scale with a pole, optional striped over-exposure zone) or `lcd`
  (illuminated numerals), with `shows`, `onPress` (a display that answers the half-press),
  `shutterScale` (a body's own LED steps) and `derive` (the aperture or shutter its meter works
  at, quoted from that body's specification).
- `meter` / `meterScale` / `derive` — an aperture scale lit inside the same window, reading
  against the shutter the EE program holds; a scale with skips in it prints only its own steps.

Numerals are measurements, not strings: the scene's luminance gives the exposure value, and the
design's declared meter turns it into a shutter step or an f-stop on that body's own scale. A
focus needle rests at the far end with nothing locked, and an exposure-compensation or AF mark
stays unlit because the app is at compensation 0 and has no focus sensor — never faked on.

**Authenticity over decoration is the rule.** No artificial focus points, exposure marks or grids
added to make a finder look sophisticated; nothing invented. Consequences that are enforced, not
styled: the Trip 35's exposure zone sits on the top plate, not in the glass; XA has no bright-line
frame; a Hexar shows crosshairs but no shutter numerals in the finder; TC-1's display is dark
until the shutter is half-pressed; μ II and T4 draw no projected picture frame; a body with no
readout shows nothing. Complexity follows the machine — a rangefinder carries frame lines plus a
patch, a waist-level body carries a screen, pocket cameras stay minimal — and no body gets corner
brackets, because none of these bodies prints them.

**Research sources**, each kept in the patch script beside the design it produced: Contax T2
("Display in the Viewfinder" — Picture Frame, Focus Frame, Shutter Speed; easymanua.ls +
manualslib), Yashica T5/T5D manual (cameramanuals.org) and the T4/T5 reticle and lock-lamp
description, Nikon L35AF manual (reverse-Galilean Albada bright frame, 0.52×, ~85% coverage, AF
frame marks, parallax marks, focus needle), Ricoh GR1v manual ("Viewfinder Indicators":
field-of-view frame, parallax marks at 1.5 m / 0.7 m, auto-focus marks, shutter indication, AE
warning, compensation indicator), Olympus XA manual and test report (parallax arrows, the
double-image rectangle that fuses, a shutter needle with a striped over-exposure zone), Canonet
QL17 GIII (camera-wiki.org: 0.6× rangefinder/viewfinder with parallax compensation, coincident
patch, beam-splitter ghosts, aperture scale lit by the same window, the scale skips f/2), Konica
Hexar AF (cameraquest.com + Wikipedia: centre crosshairs, speeds indicated in the top LCD,
parallax-corrected framelines), Fujifilm GA645 (dantestella.com: ~0.5× projected framelines,
central crosshair, LED readout at the bottom), Nikon 35Ti (kenrockwell.com: frame lines and
digital display), Pentax 6×7 waist-level ground screen (100% coverage), Minolta TC-1
(camera-wiki.org: half-pressing displays shutter speeds 8, 30, 125, 500 in the finder), Konica
Big Mini BM-201 (michaelfil.com: half-press confirms focus), Olympus μ II ("the whole viewfinder
is the field of view and picture frame", green dot indicates focus lock).

**Where the marks sit.** The overlay is a separate DOM layer positioned to the contained, centred
picture, so frame lines and focusing aids line up with what the body displays and never land on
the black bars, and no finder graphic ever reaches the captured photograph. Geometry is a
fraction of the picture, so a body switch scales marks without restyling the page: placement is
keyed on the geometry and the design id, and the page never scrolls. Readouts stay behind the
tap (a real camera keeps its display dark until asked); lamps and the half-press display answer
the camera itself. The finder box stays the body's own frame shape — 135 bodies the compact-LCD
box following the displayed feed, gated bodies their real print ratio — and the overlay never
crops, stretches or distorts the captured image.

**Module ownership.** `camera/viewfinder.js` builds and paints a design; `app.js` calls it from
`renderHud()` (which runs on every body swap, so the two stay synchronised) and from the render
loop for placement. There is no `CAMERA_HUD` map, no `.focusbox`, no corner-bracket variant, and
no shared overlay component. `test/viewfinder-check.mjs` derives its assertions from each
profile's own design — a finder drawn from a guessed universal template passes the eye and fails
that gate.

## Future content updates

New film → new profile JSON only. New camera → same. New pack → pack folder + entitlement. FilmEngine/CameraEngine keep reading configs; no core rewrite.
