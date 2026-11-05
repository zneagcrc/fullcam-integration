# FullCAM modelling decisions

Decisions behind `project/src/fullcam-templates/plot-builder.ts`, `calculateCarbonResults` in `project/src/spatial-data-updater.ts` and `project/src/carbon-scenario.ts` (October 2026). Several are provisional until the FullCAM team (fullcam@dcceew.gov.au) answers the questions in [open-issues.md](open-issues.md).

## Species and activities

- Species 7, 23, 31, 32, 33 and 34 are supported. Species 31 and 32 have no planting event in their libraries, so they're clearing-only.
- Users pick a species *choice*; rainfall picks the variant: Native Species Regeneration -> 33 (<500mm) or 34 (>=500mm); Native species and revegetation -> 31 or 32. Rainfall comes from the client's Excel site tab (or SILO).
- All three clearing events are offered. ***Initial clearing: no product recovery*** is the default (the FullCAM team's recommendation for farm clearing): it's listed first in dropdowns, and a blank clearing type in pasted tables uses it.
- **Starting debris** (plot-level `InitDebrF`): a plot that starts with an existing forest (other clearing) uses the species' default from its `<ForestInit><InitDebrF>`, as the FullCAM team advised (7 = 12.44, 23 = 0, 31 = 34.07, 33 = 3.78, 34 = 10.67 tC/ha). Plots that start as bare ground (plantings, and plantings later cleared) start with no debris, per the VEERG chapter's "No initial trees or debris".
- **Clearing an existing forest** sets `treeExistsInit="true"` and derives biomass from the tree age at clearing via `tInitStem="FracAge"`. Growth curve: `BlockES` for species 7 and 23 (their defaults ignore age), `BlockLMG` for 31-34. The `BlockLMG` choice for 31 and 32 is unconfirmed.
- **Tree age:** decimal years at the clearing date (1 year 6 months = 1.5). Anything that isn't a number over 0 and up to 9999 (including blank) means mature, i.e. 9999, for every species. This is deliberately silent in the UI. There's no maximum age in the species data; biomass approaches the site maximum (about max x e^(-2G/age)), so very old ages barely differ.

## Event ordering

- **Planting before clearing:** the clearing removes that planting. The plot starts as bare ground and any tree age entered is ignored.
- **Clearing on or before planting:** an existing forest is cleared, then the site is replanted. Same-day events put the clearing first.

## Simulation period

Derived from the inputs, not hard-coded:
- **Start:** January of the earliest of the planting date, clearing date and carbon analysis start year.
- **End:** January after the carbon analysis end year.

Starting no earlier than needed means a forest being cleared always exists at the start. Activity dates after the analysis end year are rejected.

## Scenarios: plantings, clearings and management events

Mirrors the client's reporting-year Excel workbook (`project/fullcam-processor.html` has both input methods). The VEERG chapter's 20-year lookback (16.1.2.1) means history is modelled, not just the reporting year:

- **Plantings:** name, date planted, **area originally planted** (the app subtracts every clearing), location, species, rainfall.
- **Cleared plantings:** one row per planting per *year* of clearing, any date from 20 years before the reporting period to its end. Several clearings in one year: total area and the date when most of it happened. Clearings can't add up to more than the area originally planted.
- **Other clearing:** existing forest with its own location, species, age and rainfall, cleared in the same window.
- **Post-clearing debris burn date** (both clearing tables, optional): burnt or planned within 3 years of clearing (chapter A2.6); modelled as *Site prep: Windrow and burn* with its defaults. A burn planned after the reporting period can't change that period's stocks, but is simulated for the 20-year allocation (a note says so).
- **Clearing is by area**, so every clearing plot clears 100% (no partial thinning).
- **Clearings older than the 20-year lookback** aren't modelled (a note says so), but cleared planting area still comes off the planting.
- **Wildfire events** (planting, date, % of planting burned, % of trees killed) and **planned burns** (planting, date, % affected) apply to the area still standing on the date; percentages are of that standing area. An event after a planting is fully cleared is an error. Chapter Table 16.9 mapping: *Prescribed burn* for planned burns; wildfires use *Wildfire - trees killed* if >5% killed else *trees not killed* (Environmental plantings, Mallee), or the nearest 10% band event (Native Species Regeneration: 0-60%, then 70-100%); % burned sets the area affected; "maximum years to regrow post-fire" is set to 20.
- **Growth pauses** (planting, date, pause length in decimal years) apply to the area still standing on the date, like fires. Chapter Table 16.10: a forest treatment event with "Type 1: Age advance" on, age advance = -pause length, advancement period = pause length.

Plots: each planting's standing area (with all its fires), each clearing of a planting (planted, fires before the clearing, cleared, debris burn), and each other clearing (existing forest, cleared, debris burn). Plots run one after another; per-hectare results x area are totalled. The reporting period is the analysis period.

## Carbon results

The results feed the VEERG LULUCF calculations (`C:\htdocs\zneagcrc\GAF-VEERG-Functions\VEERG documents\VEERG V1.1\MG_Chapter16_LULUCF_v1.1.pdf`, Section 16.2.1.2 and Appendix A2.2.5), so they follow that chapter:

- **Woody carbon stock = trees + forest debris.** Wood products (`prodCMF`) are not counted as stored; carbon moved into products at clearing counts as released and is shown separately as "held in wood products" (the chapter's harvested-wood-products method reports products separately).
- **Stocks table:** C mass of trees and of debris at the end of year *y−1* (the month before the reporting period starts) and the end of year *y* (its last month), per plot in tC/ha (the chapter's input unit) with tC x area. These are the chapter's C(t,y-1), C(t,y), C(d,y-1), C(d,y).
- The reporting period is flexible but will almost always be a calendar or financial year. The chapter's *y* is the last row of that year (step 12 for calendar, step 6 for financial), which is what the period's end month gives.
- Results are in tC; the workbook does the x44/12 conversion to t CO2.
- **Fire emissions:** CH4 and N2O from FullCAM's fire columns, summed over the reporting period's months, per plot (t/ha of the whole plot, and t x area), for the chapter's biomass burning method (16.2.1.4).

## Chapter 16 equation inputs (`project/src/chapter16-tables.ts`)

Paul calculates with the chapter's equations in the workbook, so the results give each equation argument separately (never combined), one table per equation, each with a "Copy table" button (tab-separated, full precision; values only unless "Include header row" is ticked, since Paul usually pastes just the values):

- **Activity area = one FullCAM plot.** When a planting is cleared it becomes two areas: the standing remainder (activity *j* = 4 planting, or 5 for Native Species Regeneration) and the cleared part (*j* = 1-3 land clearing; the workbook picks which). Other clearings are their own areas.
- **16.2.1.2 (2)-(4):** A, C trees and C debris at the end of y-1 and y (t C/ha).
- **16.2.1.4:** one row per fire in year y per activity area it reached; A burnt = area x share burnt, M = FullCAM's gas for the fire / share burnt (per burnt hectare), so M x A burnt = the fire's total gas.
- **16.2.1.7:** for product-recovery clearings in year y, Cp = forest products in the clearing's row less the row before (the chapter's definition; it applies the method to farm/plantation forestry only).
- **A2.6.1:** per clearing: A, trees and debris before and 20 years after (split, t C/ha), s, Ds, and the debris burn's A burnt and M (whole cleared area burnt).
- **16.2.1.5:** A for each clearing in year y (the regional loss rate comes from the chapter's Table 16.4).
- **Fire gas timing (verified live):** FullCAM records a fire's CH4/N2O in one month row, scaled by the share burnt: the fire's own month, except a fire dated on the 1st lands in the previous month's row. Gas is matched to each fire on that basis; two fires in the same row are flagged as combined.

## 20-year clearing allocation (Appendix A2.6)

- **Clearing plots simulate at least 20 years past the clearing** (end = January of clearing year + 21). FullCAM simulates forward in time, so the reporting period's values don't change (verified live: identical results with and without the extension).
- For each clearing: woody carbon (trees + debris) at the end of the month before the clearing, and at the end of the same month 20 years later; change = after - before.
- **Years since clearing** = whole years from the clearing month to the reporting period's last month (so a clearing in the reporting year is 0, whether the period is a calendar or financial year). **Discount factor** (Table 16.27) = 0.0975 - 0.005 x years, 0 from 20 years.
- Allocated to the reporting period = change x area x discount factor. Fire CH4/N2O from the clearing month to 20 years on (e.g. a debris burn) are allocated the same way. Results stay in tC; the workbook converts to t CO2.
- **Planned debris burns** (after the reporting period, within 3 years of clearing) are simulated, so they count in the allocation; they can't change the reporting period's stocks.

| Result | Window |
|---|---|
| Sequestered in planting | From the planting (or analysis start) to just before the clearing that removes it (or analysis end) |
| Released by clearing | From just before the clearing (or analysis start) to just before the next planting (or analysis end) |
| Net change | The whole analysis period |

- Planting and clearing results cover only their own windows, so they don't always add up to the net. The UI says so.
- **Clear then replant:** clearing debris still decaying after the replanting is counted in the planting result, which can make it negative (e.g. slow-growing NSR regeneration).
- **Same-month clear and replant:** the clearing can't be separated from monthly output, so its release is included in the planting result.
