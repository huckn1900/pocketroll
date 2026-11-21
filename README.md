# POCKETROLL 35 — film filter camera

A phone camera that shoots 35mm film looks. The UI is the **back of a point-and-shoot camera** (cream plastic body, chrome viewfinder bezel, red LED frame counter, DX film canister label, filmstrip contact sheet); the filter engine emulates real camera × film-stock combinations from the material library in `assets/`.

## Run it
Live: **https://huckn1900.github.io/pocketroll/** (open on your phone — HTTPS secure context = camera works; installable as PWA)
```
python -m http.server 8765      # any static server works
open http://127.0.0.1:8765/
```
- It is a PWA: installable from Chrome on Android/desktop, works offline after first load (service worker caches the shell).
- Controls: **SHUTTER** button or spacebar captures; **camera bag** / **film shelf** pick the combo; **develop photo** runs a gallery photo of yours through the loaded film (does not consume roll frames); **back door** animates the film door; frames auto-rewind at 0.
- Test hooks: `?cam=<id>&film=<id>&autoshot=1`, and `test/calibration.html` (all 15 stocks on a real photo, for parameter tuning).

## Architecture
- `assets/cameras.json` — 10 classic point-and-shoots (Olympus Trip 35 … Ricoh GR1v, Minolta TC-01, Lomo LC-A). Each carries a `camera_character` (color cast gains, vignette, sharpness, halation bias, quirks like LC-A light leaks / AF35M flash pop).
- `assets/films.json` — 15 classic stocks (Tri-X, HP5+, Delta, Kentmere, Portra 160/400, Gold 200, Ektar, ColorPlus, Vision3 500T, Cinestill 800T, Velvia, Provia, E100, Kodachrome). `filter_params` are calibrated against a real sample photo via the calibration grid (see docs/research.md for sources).
- `app.js` — `FilmEngine`: lens blur → luminance tone curve (contrast/black-lift/white-point) → chroma kept & scaled by saturation → split-tone tint blend → halation bloom → film grain → vignette → quirk overlays. The data files are the single source of truth; adding a camera or film = adding a JSON entry.
- Behavior that differentiates from typical film apps: the **roll state follows the film, not the camera** (swapping cameras never resets the 36-frame roll), correct 36-frame counting, rewind ritual.

## Store & legal route
See `docs/store-copy.md` (listing copy) and `docs/research.md` (research + trademark analysis). Film *looks* are not copyrightable; brand names are used descriptively/nominatively only — POCKETROLL is an invented name, footer disclaimer included.

## Packaging status
- PWA here is directly deployable (any static host).
- Native APK needs Android SDK/Java on the build machine (not installed on this Windows box yet) → Capacitor wrap later, or wrap the PWA as a TWA.
- iOS path: Mac/Xcode Cloud at submission time.
