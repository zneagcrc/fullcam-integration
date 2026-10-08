# Map and cadastre notes

## Cadastre data comes from free state services, not Geoscape

Geoscape's Maps API (a national cadastre vector-tile layer) needs a paid tier of about $300/month; a free key gets 403 on tile requests. All Geoscape wiring was removed from `project/src/map.ts` (not just disabled). `VITE_GEOSCAPE_API_KEY` may still be in `.env` but is unused. Re-adding Geoscape would mean reimplementing it, so extend the free state services first.

## Queensland cadastre service

Free and keyless ArcGIS `MapServer`:

`https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer`

- Layer 4 ("Cadastral parcels") supports `query` and returns GeoJSON. Useful fields: `lot`, `plan`, `lotplan` (e.g. `3RP91637`), `lot_area`, `locality`, `shire_name`. Geometry is `Polygon`, occasionally `MultiPolygon`.
- It's a dynamic service with no cached `{z}/{x}/{y}` tiles. Background parcel boundaries use the `/export` operation with Mapbox GL's `{bbox-epsg-3857}` raster tile template (`QLD_CADASTRE_RASTER_TILE_URL` in `map.ts`).
- Use this as the pattern for other states: look for the state land authority's free ArcGIS/WMS service first.

## SA2 code years don't match, so `Cattle_Reg` is always null

The `abs-sa2-layer` Mapbox tileset uses **2021** SA2 boundaries, but `project/src/data/cattle-reg-by-sa2.json` is keyed by **2011** SA2 codes (`SA2_MAIN11`). ABS reissues codes each Census, so they don't line up. This was a deliberate "ship the wiring now, fix the data later" call: the tileset will be updated to align codes.

Once the tileset is updated, if `cattleReg` is still null, check the console line `'SA2 code:', sa2Code` from `getSA2Region()`. Add the property name the tileset actually exposes to `SA2_CODE_PROPERTY_CANDIDATES` in `map.ts`.
