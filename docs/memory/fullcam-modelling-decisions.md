# FullCAM modelling decisions

Decisions behind `project/src/fullcam-templates/plot-builder.ts` and `calculateCarbonResults` in `project/src/spatial-data-updater.ts` (October 2026). Several are provisional until the FullCAM team (fullcam@dcceew.gov.au) answers the questions in [open-issues.md](open-issues.md).

## Species and activities

- Species 7, 23, 32, 33 and 34 are supported for planting and clearing. Species 32 has no planting event in its library, so it's clearing-only.
- All three clearing events are offered: *Thin (clearing)*, *Initial clearing: no product recovery*, *Initial clearing: product recovery*.
- **Starting debris** (plot-level `InitDebrF`) is zero for now. It's expected to become species-specific (`initDebris` in the `SPECIES` registry).
- **Clearing an existing forest** sets `treeExistsInit="true"` and derives biomass from the tree age at clearing via `tInitStem="FracAge"`. Growth curve: `BlockES` for species 7 and 23 (their defaults ignore age), `BlockLMG` for 32, 33 and 34. The `BlockLMG` choice for 32 is unconfirmed.

## Event ordering

- **Planting before clearing:** the clearing removes that planting. The plot starts as bare ground and any tree age entered is ignored.
- **Clearing on or before planting:** an existing forest is cleared, then the site is replanted. Same-day events put the clearing first.

## Simulation period

Derived from the inputs, not hard-coded:
- **Start:** January of the earliest of the planting date, clearing date and carbon analysis start year.
- **End:** January after the carbon analysis end year.

Starting no earlier than needed means a forest being cleared always exists at the start. Activity dates after the analysis end year are rejected.

## Carbon results

Carbon stock = trees + forest debris + forest products (`prodCMF`); wood products count as stored. Results are in tC (no CO2e conversion yet).

| Result | Window |
|---|---|
| Sequestered in planting | From the planting (or analysis start) to just before the clearing that removes it (or analysis end) |
| Released by clearing | From just before the clearing (or analysis start) to just before the next planting (or analysis end) |
| Net change | The whole analysis period |

- Planting and clearing results cover only their own windows, so they don't always add up to the net. The UI says so.
- **Clear then replant:** clearing debris still decaying after the replanting is counted in the planting result, which can make it negative (e.g. slow-growing NSR regeneration).
- **Same-month clear and replant:** the clearing can't be separated from monthly output, so its release is included in the planting result.
