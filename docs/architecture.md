# POCKETROLL 35 — architecture & business model (Round⑦ plan, user-defined)

**Product principle:** A little camera. A lot of memories. Sell the experience of shooting film, not filters.

## Business model — three tiers

| Tier | Price | Distribution | Contents |
|---|---|---|---|
| **Free Web Demo** | US$0 | https://huckn1900.github.io/pocketroll/ | classic 5 films + 5 cameras, full core ritual (shoot → latent → develop → contact sheet → archive) |
| **POCKETROLL 35 PRO** | **US$6.99 one-time** | Patreon purchase → downloadable Android APK | full built-in library: all 15 film profiles + all 10 camera profiles, all Pro features, permanent — no subscription |
| **Expansion Packs** | per pack, optional | future, on demand | Film Packs (new stocks/color science/grain) & Camera Packs (new bodies/imaging character); each purchase permanently unlocks its pack |

Flow: **TRY IT** (free web) → **OWN IT** (Pro APK via Patreon) → **EXPAND IT** (content packs).
The free demo is the storefront: it demonstrates the ritual and locks the rest of the library behind a visible PRO tag + a GET PRO button in Settings.

**Platform boundary:** the $6.99 Patreon APK plan covers **Android only** today. iOS needs its own distribution/payment design matching Apple store rules (likely standard IAP, separate price tier) — deferred, do not block Android.

## Module architecture (target shape)

```
POCKETROLL 35 APP
├── App/            CameraEngine (lens sim, exposure, live view, shutter)
│                 FilmEngine   (color science, grain, light leaks, curves)
│                 Gallery      (photo storage, developed rolls)
│                 RollManager  (36-frame roll lifecycle, develop ritual)
├── Licensing/      LicenseManager · PurchaseVerification · PackEntitlements
└── Content/        Free/{FilmProfiles,CameraProfiles}
                  Pro/{FilmProfiles,CameraProfiles}
                  ExpansionPacks/{FilmPack01,…,CameraPack01,…}
```

Engines never hardcode content — they read profile files. Adding a film = adding a Film Profile; adding a pack = adding pack files + entitlement info. Core stays stable.

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

## Photo persistence & backup layer (Round⑨)

- **Storage**: developed rolls are stored in **IndexedDB** (`pocketroll-db`, store `rolls`) as full roll records — full-resolution frames (JPEG q0.95, native stream size), thumbnails, favorites, and metadata (camera/film/ISO/loaded/developed/status/notes). The old localStorage shelf is migrated once and removed; environments without IndexedDB fall back to the small shelf (archive UI says "degraded").
- **Roll record schema**: `{id, camId, cam, filmId, film, iso, loadedAt, developedAt, status, notes, frames:[{u,t,fav}]}` — this is the same record the Pro APK's RollManager/gallery will ship, so the archive format doubles as the interchange format.
- **Backup & Restore**: the archive exports as one JSON file (`BACKUP ARCHIVE`) and `restoreFile()` re-imports it on any device/device-browser (id-dedup). A per-roll `.zip` export (frames + roll.json, tiny stored-zip writer) is the escape hatch for sharing a roll.
- **Storage management**: the archive page shows roll count + approximate bytes used/quota (`navigator.storage.estimate()`) and states that frames persist across refresh and offline (SW caches the app; capture is local).

## Future content updates

New film → new profile JSON only. New camera → same. New pack → pack folder + entitlement. FilmEngine/CameraEngine keep reading configs; no core rewrite.
