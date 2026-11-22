# POCKETROLL 35 — the experience of shooting film, not just the look

A phone camera that behaves like a real 35mm camera. Only 36 exposures per roll; frames stay **latent** until you develop the whole roll in the darkroom; every developed roll auto-prints a **contact sheet** and lands in a dated **film archive**; opening the back door before developing fogs your frames. The look (color science per film stock, ISO-appropriate grain, halation, light leaks by stock) comes from the experience, not from presets. The UI is the **back of a point-and-shoot camera** (cream plastic body, chrome viewfinder bezel, red LED frame counter, DX film canister label, filmstrip); the engine emulates real camera × film combinations from the material library in `assets/`. Avoid being another VSCO/Lightroom — the product is the ritual.

## Run it
Live: **https://huckn1900.github.io/pocketroll/** (open on your phone — HTTPS secure context = camera works; installable as PWA)
```
python -m http.server 8765      # any static server works
open http://127.0.0.1:8765/
```
- It is a PWA: installable from Chrome on Android/desktop, works offline after first load (service worker caches the shell). Fonts are bundled OFL latin subsets (`assets/fonts/`: Roboto Condensed for brand/print, IBM Plex Mono for parameters) — no runtime webfont dependency.
- Controls: **SHUTTER** button or spacebar exposes a frame; **camera bag** / **film shelf** load gear (swapping cameras never resets the roll); **develop roll** runs the darkroom ritual (developer → stop bath → fixer → wash, then frames reveal and archive); **contact sheet ↓** downloads the lab proof sheet after developing; **scan in photo** lab-develops an external photo as a loose frame; **back door** opens the door — on an undeveloped roll this FOGS the exposed frames; tap the finder for the full LCD readout; tap a latent frame for a brief preview pulse only.
- Test hooks: `?cam=<id>&film=<id>&autoshot=1&dev=1&date=1&hud=full&page=roll|gallery|settings`; `test/calibration.html` (all 15 stocks on a real photo, for parameter tuning); `sounds.html` (sound lab: film-advance lever/motor + focus chirp/whir variants for auditioning before integration); `test/features-check.mjs` / `test/export-check.mjs` / `test/pwa-check.mjs` / `test/sound-smoke.mjs` / `test/page-probe.mjs` (CDP assertions & debug probes).

## Architecture
- `assets/cameras.json` — 10 classic point-and-shoots (Olympus Trip 35 … Ricoh GR1v, Minolta TC-01, Lomo LC-A). Each carries a `camera_character` (color cast gains, vignette, sharpness, halation bias, quirks like LC-A light leaks / AF35M flash pop).
- `assets/films.json` — 15 classic stocks (Tri-X, HP5+, Delta, Kentmere, Portra 160/400, Gold 200, Ektar, ColorPlus, Vision3 500T, Cinestill 800T, Velvia, Provia, E100, Kodachrome). `filter_params` are calibrated against a real sample photo via the calibration grid (see docs/research.md for sources).
- `app.js` — `FilmEngine`: lens blur → luminance tone curve (contrast/black-lift/white-point) → chroma kept & scaled by saturation → split-tone tint blend → halation bloom → film grain → vignette → quirk overlays. The data files are the single source of truth; adding a camera or film = adding a JSON entry.
- Behavior that differentiates from typical film apps: the **roll state follows the film, not the camera** (swapping cameras never resets the 36-frame roll), correct 36-frame counting, rewind ritual.

## Store & legal route
See `docs/store-copy.md` (listing copy) and `docs/research.md` (research + trademark analysis). Film *looks* are not copyrightable; brand names are used descriptively/nominatively only — POCKETROLL is an invented name, footer disclaimer included.

## Packaging status
- PWA here is directly deployable (any static host).
- ## Business model (Round⑦, user-defined)
- **Free Web Demo** — classic 5 films + 5 classic bodies (profiles tagged `tier:"free"` in `assets/`), full core ritual; this repo's site IS the demo. Locked Pro profiles show an amber `PRO` tag; tapping one hints the Pro APK.
- **POCKETROLL 35 PRO — US$6.99 one-time via Patreon** — downloadable Android APK unlocking the full built-in library (all 15 films + all 10 cameras), permanent, no subscription. iOS needs its own Apple-compliant distribution later.
- **Expansion Packs** (optional) — future Film Packs / Camera Packs, purchased individually, each permanently unlocked. New content = new profile files + entitlement only; engines keep reading configs (see `docs/architecture.md`).
- The GET PRO button in Settings links to Patreon — URL placeholder until the creator page exists.

Native APK needs Android SDK/Java on the build machine (not installed on this Windows box yet) → Capacitor wrap later, or wrap the PWA as a TWA.
- iOS path: Mac/Xcode Cloud at submission time.
