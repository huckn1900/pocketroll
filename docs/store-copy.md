# Store listing copy — POCKETROLL 35

App name **POCKETROLL** is invented (no third-party trademark collision found in initial web checks; re-check exact name in Play Console / App Store search before committing). Brand/model names below are used **descriptively** (nominative use): no logos, no implied endorsement, disclaimer included — per docs/research.md trademark analysis (risk: LOW).

## Google Play
- **Title (≤80):** `POCKETROLL — 35mm Film Filter Camera`
- **Short description (≤80):** `Shoot classic film looks on your phone. 10 vintage cameras × 15 film stocks.`
- **Full description (≤4000):**
  > POCKETROLL turns your phone into a 35mm film camera — the way a real one feels.
  > Pick a body from 10 classic point-and-shoots (Olympus Trip 35, Canon AF35M, Yashica T4, Contax-style, Ricoh GR, Minolta TC-01, Lomo LC-A…) and load one of 15 legendary films (Ilford Tri-X & HP5+, Kodak Gold, Portra, Ektar, Fujifilm Velvia, Cinestill 800T…). Every look is built from real film behavior: tone curves, split-toning, halation glow around highlights, film grain, vignetting, and camera quirks like light leaks.
  > The interface is the back of a compact camera: frame counter, DX canister label, film door, contact sheet. Your roll follows the film, not the camera — swapping bodies never resets it. 36 exposures, then rewind. Develop any photo from your gallery through the loaded film. Works offline. No account, no data leaves your device.
  > Full roll: unlock all 15 films with a one-time purchase.
  > *Kodak, Fujifilm, Ilford, Olympus, Canon, Nikon, Yashica, Contax, Ricoh, Minolta and Lomo are trademarks of their respective owners. POCKETROLL is independent and not affiliated with or endorsed by any brand; names are used descriptively only.*
- **Category:** Apps for Entertainment → Photography. **Pricing:** free (6 films) + one-time in-app purchase for the full shelf.
- **Privacy:** no data collected; all processing on-device (declare "No data collected" in the data-safety form).

## App Store
- **Title (≤30):** `POCKETROLL Film Camera`
- **Subtitle (≤30):** `35mm film looks & grain`
- **Promo text (≤170):** `10 classic point-and-shoots × 15 legendary films. Real halation, grain, tone curves — not just a filter preset.`
- **Keywords:** film, analog, 35mm, grain, retro, camera, vintage, filter, halation, kodak
- **Description:** same body as Play full description, trimmed to ~3 paragraphs + the trademark disclaimer line. Category: Photo & Video. Pricing: free + one-time "full film shelf" IAP.
- Screenshots: use `test/calibration.html` grid crops + app UI shots (cream body, viewfinder, counter).

## If store review pushes back on brand names
Fallback plan (invented shelf names, same params in films.json): `Tri-X → TRINITY 400`, `HP5+ → SILVERLINE 400`, `Portra 160 → PORCELAIN 160`, `Gold 200 → MARIGOLD 200`, `Velvia → VERDE 50`, `Cinestill 800T → CINEBURG 800T`, etc. — keep `story`/`status` metadata internal only. The engine reads ids, so renaming display names is a JSON-only change.

## Submission checklist
1. Play Console account ($25 one-time) → fill data-safety form → closed testing 12 testers × 14 days → open testing → production.
2. Apple Developer ($99/yr) — needs a Mac or Xcode Cloud for the iOS build; Android APK can ship first via PWA/TWA while iOS build is arranged.
3. Icon: `icon.png` (512×512, generated from test/icon.html). App screenshots from the running app.
4. Re-verify "POCKETROLL" availability in both stores before paying fees.
