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
  settings; an interrupted or blocked stream falls back to the demo scene and states the state
  ("camera: live feed · rear sensor" / "camera: blocked · demo scene") with RETRY CAMERA; unused
  tracks are stopped when switching; the preview pauses when the page goes to the background.
- **Storage management**: the archive page shows rolls/frames/scans plus approximate bytes used and
  quota (`navigator.storage.estimate()`), asks for `navigator.storage.persist()`, and states what
  survives refresh and offline.
- **Build notice**: `sw.js` only caches `res.ok` responses and never fails a request over a cache
  write; `CACHE` in sw.js and `BUILD` in app.js are bumped together on deploy, and a mismatch shows
  "NEW VERSION AVAILABLE · RELOAD" instead of quietly running an older build.

## Future content updates

New film → new profile JSON only. New camera → same. New pack → pack folder + entitlement. FilmEngine/CameraEngine keep reading configs; no core rewrite.
