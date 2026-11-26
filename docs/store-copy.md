# Store listing copy — POCKETROLL 35

**Current distribution (Round⑦ business model):** free **Web Demo** at huckn1900.github.io/pocketroll → **Pro APK US$6.99 one-time via Patreon** (Android download; every finished stock and body, permanent) → **Expansion Packs** (Film/Camera packs, purchased individually, permanently unlocked). Store listings below are **deferred** — the Pro APK ships through Patreon first, so Play/Apple fees are not paid yet; iOS will get its own Apple-compliant distribution/payment later. See `docs/architecture.md`.

App name **POCKETROLL** is invented (no third-party trademark collision found in initial web checks; re-check exact name in Play Console / App Store search before committing). Brand/model names below are used **descriptively** (nominative use): no logos, no implied endorsement, disclaimer included — per docs/research.md trademark analysis (risk: LOW).

## Google Play
- **Title (≤80):** `POCKETROLL — 35mm Film Camera Experience`
- **Short description (≤80):** `A real film camera on your phone: 36 frames per roll, develop later, keep the sheet.`
- **Full description (≤4000):**
  > POCKETROLL is not a filter app. It is the experience of shooting film — the look comes from the experience, not the other way around.
  > Pick a body from 18 cameras (Olympus Trip 35, Canon AF35M, Yashica T4, Contax T2, Ricoh GR1v, Minolta TC-01, Lomo LC-A…) and load one of 28 films (Ilford HP5+ & FP4, Kodak Gold, Portra, Ektar, Fujifilm Velvia, Cinestill 800T…). Each stock has its own color science — tone curves, split-toning, halation, ISO-appropriate grain — and your roll keeps it from loading to archive.
  > The ritual is the product: only 36 exposures per roll; shutter and film-advance feedback with every shot; frames stay LATENT until you develop the whole roll in the darkroom; every developed roll prints an automatic contact sheet and lands in a dated film archive. Opening the back door before developing fogs your frames — like a real camera. The interface is the back of a compact camera: LCD viewfinder readout, frame counter, DX canister label, film door. Your roll follows the film, not the camera — swapping bodies never resets it. Works offline. No account, no data leaves your device.
  > Full roll: the Pro APK unlocks every finished film stock and every camera body — US$6.99 one-time via Patreon.
  > *Kodak, Fujifilm, Ilford, Olympus, Canon, Nikon, Yashica, Contax, Ricoh, Minolta and Lomo are trademarks of their respective owners. POCKETROLL is independent and not affiliated with or endorsed by any brand; names are used descriptively only.*
- **Category:** Apps for Entertainment → Photography. **Pricing:** deferred — free demo + Pro via Patreon today; if listed later: free app (classic 5+5) + one-time Pro unlock IAP.
- **Privacy:** no data collected; all processing on-device (declare "No data collected" in the data-safety form).

## App Store
- **Title (≤30):** `POCKETROLL Film Camera`
- **Subtitle (≤30):** `Shoot film, not filters`
- **Promo text (≤170):** `Only 36 exposures per roll. Frames stay latent until you develop the whole roll — then it prints a contact sheet and joins your film archive.`
- **Keywords:** film, analog, 35mm, grain, retro, camera, vintage, roll, develop, halation, kodak
- **Description:** same body as Play full description, trimmed to ~3 paragraphs + the trademark disclaimer line. Category: Photo & Video. Pricing: free + one-time "full film shelf" IAP.
- Screenshots: use `test/calibration.html` grid crops + app UI shots (cream body, viewfinder, counter).

## If store review pushes back on brand names
Fallback plan (invented shelf names, same params in films.json): `Tri-X → TRINITY 400`, `HP5+ → SILVERLINE 400`, `Portra 160 → PORCELAIN 160`, `Gold 200 → MARIGOLD 200`, `Velvia → VERDE 50`, `Cinestill 800T → CINEBURG 800T`, etc. — keep `story`/`status` metadata internal only. The engine reads ids, so renaming display names is a JSON-only change.

## Submission checklist
1. Play Console account ($25 one-time) → fill data-safety form → closed testing 12 testers × 14 days → open testing → production.
2. Apple Developer ($99/yr) — deferred; iOS needs its own Apple-compliant distribution/payment (see docs/architecture.md). Android first ships as a Patreon-downloaded Pro APK (Capacitor build), no store fees yet.
3. Icon: `icon.png` (512×512, generated from test/icon.html). App screenshots from the running app.
4. Re-verify "POCKETROLL" availability in both stores before paying fees.
