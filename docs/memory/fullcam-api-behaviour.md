# FullCAM API behaviour

Verified against the live FullCAM 2024 APIs (October 2026). The DCCEEW docs in `docs/` are thin, so most of this was found by testing.

## Data builder

- **Species IDs** (confirmed via `siteinfo`; spec in `docs/Essential FullCAM User Input.docx`):

  | ID | Species | Notes |
  |---|---|---|
  | 7 | Environmental plantings | |
  | 23 | Mallee eucalypt species | |
  | 31 | Native species and revegetation <500mm rainfall | MVG; no planting event |
  | 32 | Native species and revegetation >=500mm rainfall | MVG; used by `docs/ExampleDeforestation.plo`; no planting event |
  | 33 | Native Species Regeneration <500mm rainfall | |
  | 34 | Native Species Regeneration >=500mm rainfall | |

- **`GET /species?specId=N`** returns a complete `<SpeciesForest>` block (~0.4s) that drops straight into a plot file. It's identical across locations (NSW and WA compared), so the blocks are bundled in `project/src/fullcam-templates/species/` and refreshed with `project/scripts/fetch-species.mjs`.
- **Plot events are copies of library events.** Each species block contains a library of events (planting, clearing, fires, thinning). A plot event is the library event with `tEvent="SpecF"` changed to `"Doc"`, plus `nmRegime`, a `regimeInstance` UUID and `<dateEV>`.
- **`update-spatialdata`** only normalises blank species fields to `0.0`; it doesn't change growth parameters. It keeps any extra `<OutLook>` output selections in the plot.
- **Forest treatment events (`tEV="TmtF"`, used for growth pauses) aren't in any API source:** not in the species libraries, the 3 `templates`, or `regimes`. The builder writes the XML itself, following one made in the FullCAM web app (`docs/Environmental Plantings Method - From FullCAM template.plo`): `<TmtF ageAdvTmtF="-0.5" advPeriodTmtF="0.5" yieldMultTmtF="" type1On="true" type2On="false" fixTmtF="" phaTmtF=""/>`, with `tFaqEV`, `aqStYrEV`, `categoryEV` and `idSP` blank. FullCAM accepts it (verified live).

## Simulator

- **Send the spatial-update response verbatim.** Stripping the `<?xml ...?>` declaration gives `400 Simulation validation failed - no error details available`.
- **`400 Document not Ready`** happened when a plot started with an existing forest (`treeExistsInit="true"`) and had a planting before a later clearing. Plant-then-clear from bare ground works, and so does clear-then-plant.
- **`400 Document not Ready`** also happens when a wildfire, a prescribed burn and a forest treatment (growth pause) are all on the same day (Mallee, November 2026). Any two of them on the same day run fine. `findScenarioWarnings` in `carbon-scenario.ts` warns about this (and about any other same-day planting events) without stopping the run.
- **Output columns** come from `<OutWinSet><OutWin><OutLook tOutOL="...">` in the plot:

  | Code | CSV column |
  |---|---|
  | `treeCM` | C mass of trees |
  | `cpdebrCMF` | C mass of forest debris |
  | `prodCMF` | C mass of forest products |
  | `prodLfCMF` | C mass of forest products in landfill |
  | `flowCH4MSiteAtmsFire`, `flowN2OMSiteAtmsFire` | CH4 / N2O emitted due to fire |

  Unknown codes are silently ignored (no error, no column), which makes it easy to probe for names.
- **CSV rows are end-of-month stocks.** The first row is an opening row (e.g. `2014,12` for a 2015 start). An event dated in month *m* already shows in month *m*'s row, so "just before an event" is the previous month's row.
