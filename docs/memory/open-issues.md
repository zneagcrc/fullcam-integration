# Open issues

## Questions for the FullCAM team

1. Is zero starting debris and litter acceptable for clearing runs, or is there a recommended source? `docs/ExampleDeforestation.plo` starts with non-zero values.
2. Which clearing event is intended for a standard farm clearing? The deforestation example names its event *Thin (clearing)* but uses `tFaqEV="InitClrNoProd"` (the no-product-recovery category).
3. Is `FracAge` with the user's tree age acceptable for setting carbon at clearing, and are `BlockES` (species 7, 23) and `BlockLMG` (32, 33, 34) the right growth curves?
4. Replanting after a *partial* clearing appears to make the remaining standing trees vanish: tree carbon drops to ~0, but debris gains only the cleared share. Is that intended?
5. *Initial clearing: product recovery* put only ~7.6 of 46 tC/ha into products in a Mallee test (most went to debris), which seems low for "~90% of stems". Expected?
6. Does `prodCMF` already include the landfill pool (`prodLfCMF`)? Landfill was 0 in every test, so results currently count `prodCMF` only.

## Project issues

- **The FullCAM subscription key is exposed.** `VITE_FULLCAM_SUBSCRIPTION_KEY` is built into the browser bundle, and both proxies (`project/src/api-proxy.ts`, `lambda/index.ts`) take the key from the request body. Moving it to the proxy/Lambda environment only would keep it private.
- **The TSV processor always uses Environmental plantings.** `fullcam-tsv-processor.html` has no species field in its TSV format.
- **The charts don't include wood products.** The result cards count products as stored, but the per-step charts still show trees and debris only.
