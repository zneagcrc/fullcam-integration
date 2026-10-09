# FullCAM modelling decisions

Decisions behind `project/src/fullcam-templates/plot-builder.ts`, `calculateCarbonResults` in `project/src/spatial-data-updater.ts` and `project/src/carbon-scenario.ts` (October 2026). Several are provisional until the FullCAM team (fullcam@dcceew.gov.au) answers the questions in [open-issues.md](open-issues.md).

## Species and activities

- Species 7, 23, 31, 32, 33 and 34 are supported. Species 31 and 32 have no planting event in their libraries, so they're clearing-only.
- Users pick a species *choice*; rainfall picks the variant: Native Species Regeneration -> 33 (<500mm) or 34 (>=500mm); Native species and revegetation -> 31 or 32. Rainfall comes from the client's Excel site tab (or SILO).
- All three clearing events are offered: *Thin (clearing)*, *Initial clearing: no product recovery*, *Initial clearing: product recovery*.
- **Starting debris** (plot-level `InitDebrF`) is zero for now. It's expected to become species-specific (`initDebris` in the `SPECIES` registry).
- **Clearing an existing forest** sets `treeExistsInit="true"` and derives biomass from the tree age at clearing via `tInitStem="FracAge"`. Growth curve: `BlockES` for species 7 and 23 (their defaults ignore age), `BlockLMG` for 31-34. The `BlockLMG` choice for 31 and 32 is unconfirmed.
- **Tree age:** anything that isn't a number from 1 to 9999 (including blank) means mature, i.e. 9999, for every species. This is deliberately silent in the UI. There's no maximum age in the species data; biomass approaches the site maximum (about max x e^(-2G/age)), so very old ages barely differ.

## Event ordering

- **Planting before clearing:** the clearing removes that planting. The plot starts as bare ground and any tree age entered is ignored.
- **Clearing on or before planting:** an existing forest is cleared, then the site is replanted. Same-day events put the clearing first.

## Simulation period

Derived from the inputs, not hard-coded:
- **Start:** January of the earliest of the planting date, clearing date and carbon analysis start year.
- **End:** January after the carbon analysis end year.

Starting no earlier than needed means a forest being cleared always exists at the start. Activity dates after the analysis end year are rejected.

## Scenarios: plantings, cleared plantings, other clearing

Mirrors the client's reporting-year Excel workbook and the spatial data updater page:

- **Plantings:** name, date planted, area *still standing at the start of the reporting period* (users update it each year, so earlier years' clearings aren't modelled), location, species, rainfall.
- **Cleared plantings:** at most one per planting, within the reporting period. If a planting was cleared in several goes, users enter the total area and the date when most of it happened.
- **Other clearing:** existing forest with its own location, species, age and rainfall, cleared within the reporting period.
- **Clearing is by area**, so every clearing plot clears 100% (no partial thinning).

Each row becomes a FullCAM plot: the uncleared planting area (planted only), the cleared planting area (planted then cleared, bare-ground start), and each other clearing (existing forest then cleared). Plots run one after another; per-hectare results x area are totalled. The reporting period is the analysis period.

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
