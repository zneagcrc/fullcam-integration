# Open issues

## FullCAM team answers (October 2026) not yet built

- **Don't use species 32** (Native species and revegetation >=500mm) at all; the other species are fine for planting and clearing (species 31 still has no planting event). Still undecided: what a >=500mm "Native species and revegetation" site should use instead.
- **Growth curve / `tInitStem`:** the team said "BlockES" and "use defaults for tInitStem". With default `tInitStem` (`Frac`) the entered age is ignored for species 7, 23 and 31, and the VEERG chapter (Table 16.19) says to leave growth calibration at its default ("User defined" / `Custom`). Paul chose to leave the current settings for now.

## Questions for the FullCAM team

4. Replanting after a *partial* clearing appears to make the remaining standing trees vanish: tree carbon drops to ~0, but debris gains only the cleared share. Is that intended?
5. *Initial clearing: product recovery* put only ~7.6 of 46 tC/ha into products in a Mallee test (most went to debris), which seems low for "~90% of stems". Expected?
6. Does `prodCMF` already include the landfill pool (`prodLfCMF`)? Landfill was 0 in every test, so results currently count `prodCMF` only.
7. (Paul is asking; for the VEERG chapter authors) Does the Table 16.4 annual SOC loss rate (16.2.1.5) apply only in the year of clearing, or every year after it (e.g. for 20 years)? The SOC table currently lists only clearings in year y.

## Project issues

- **The older pages are deprecated** (Paul, November 2026): `spatial-data-updater.html` and `fullcam-tsv-processor.html` aren't maintained and reject every clearing (no land use input). Don't update them; use `fullcam-processor.html`.

- **The FullCAM subscription key is exposed.** `VITE_FULLCAM_SUBSCRIPTION_KEY` is built into the browser bundle, and both proxies (`project/src/api-proxy.ts`, `lambda/index.ts`) take the key from the request body. Moving it to the proxy/Lambda environment only would keep it private.
- **Chart colours were changed to a colour-blind-safe set.** The old trees/debris green and orange failed a colour-vision check. Trees, debris and wood products now use validated colours (aqua, orange, blue), and the total is a neutral dark line. The per-step bar chart still uses green/red for gain/loss.
