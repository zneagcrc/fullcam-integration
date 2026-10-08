# FullCAM integration

Web app (Vite + TypeScript, in `project/`) that builds FullCAM plot files for a site, sends them through a proxy to the FullCAM 2024 `update-spatialdata` and `run-plotsimulation` APIs, and reports carbon results. It also has a Mapbox map for selecting sites and parcels.

- Plot generation: `project/src/fullcam-templates/plot-builder.ts` (species registry, events, validation) on top of the base plot in `template-plot.ts`.
- API calls and carbon results: `project/src/spatial-data-updater.ts`.
- Proxies: `project/src/api-proxy.ts` (local) and `lambda/index.ts` (deployed).
- Reference material: `docs/` (FullCAM API PDFs, example `.plo` files, requirements docx).

## Project memory

Keep these notes current when you learn something that isn't obvious from the code.

@docs/memory/fullcam-api-behaviour.md
@docs/memory/fullcam-modelling-decisions.md
@docs/memory/open-issues.md
@docs/memory/dev-testing-workflow.md
@docs/memory/map-and-cadastre.md
