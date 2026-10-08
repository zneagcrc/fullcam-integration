# FullCAM API behaviour

Verified against the live FullCAM 2024 APIs (October 2026). The DCCEEW docs in `docs/` are thin, so most of this was found by testing.

## Data builder

- **Species IDs** (confirmed via `siteinfo`; spec in `docs/Essential FullCAM User Input.docx`):

  | ID | Species | Notes |
  |---|---|---|
  | 7 | Environmental plantings | |
  | 23 | Mallee eucalypt species | |
  | 32 | Native species and revegetation >=500mm rainfall | MVG; used by `docs/ExampleDeforestation.plo`; no planting event |
  | 33 | Native Species Regeneration <500mm rainfall | |
  | 34 | Native Species Regeneration >=500mm rainfall | |

- **`GET /species?specId=N`** returns a complete `<SpeciesForest>` block (~0.4s) that drops straight into a plot file. It's identical across locations (NSW and WA compared), so the blocks are bundled in `project/src/fullcam-templates/species/` and refreshed with `project/scripts/fetch-species.mjs`.
- **Plot events are copies of library events.** Each species block contains a library of events (planting, clearing, fires, thinning). A plot event is the library event with `tEvent="SpecF"` changed to `"Doc"`, plus `nmRegime`, a `regimeInstance` UUID and `<dateEV>`.
- **`update-spatialdata`** only normalises blank species fields to `0.0`; it doesn't change growth parameters. It keeps any extra `<OutLook>` output selections in the plot.

## Simulator

- **Send the spatial-update response verbatim.** Stripping the `<?xml ...?>` declaration gives `400 Simulation validation failed - no error details available`.
- **`400 Document not Ready`** happened when a plot started with an existing forest (`treeExistsInit="true"`) and had a planting before a later clearing. Plant-then-clear from bare ground works, and so does clear-then-plant.
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
