/**
 * Refreshes src/fullcam-templates/species/*.xml from the FullCAM 2024 Data Builder species endpoint.
 * Species blocks are location-independent, so any valid coordinate works.
 *
 * Usage: FULLCAM_SUBSCRIPTION_KEY=... node scripts/fetch-species.mjs
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SPECIES_IDS = [7, 23, 32, 33, 34];
const BASE_URL = 'https://api.climatechange.gov.au/climate/carbon-accounting/2024/data/v1/2024/data-builder/species';
const OUT_DIR = fileURLToPath(new URL('../src/fullcam-templates/species/', import.meta.url));

const key = process.env.FULLCAM_SUBSCRIPTION_KEY;
if (!key) {
  console.error('Set FULLCAM_SUBSCRIPTION_KEY');
  process.exit(1);
}

for (const id of SPECIES_IDS) {
  const params = new URLSearchParams({ latitude: '-30.542', longitude: '151.428', area: 'Cell', frCat: 'All', specId: String(id), version: '2024' });
  const response = await fetch(`${BASE_URL}?${params}`, { headers: { 'Ocp-Apim-Subscription-Key': key } });
  if (!response.ok) {
    throw new Error(`Species ${id}: ${response.status} ${await response.text()}`);
  }
  const block = (await response.text()).match(/<SpeciesForest [\s\S]*<\/SpeciesForest>/);
  if (!block) {
    throw new Error(`Species ${id}: response has no SpeciesForest element`);
  }
  writeFileSync(`${OUT_DIR}${id}.xml`, block[0] + '\n');
  console.log(`Species ${id}: ${block[0].length} chars`);
}
