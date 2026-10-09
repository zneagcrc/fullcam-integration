/**
 * Carbon scenario
 * Turns lists of plantings, cleared plantings and other clearings (one reporting period) into
 * FullCAM plots, runs them one after another, and totals planting, clearing and net results.
 */

import {
  CLEARING_EVENT_NAMES,
  getSimulationDates,
  validateActivities,
  type ClearingType,
  type PlotActivities,
  type SimulationDates,
  type SpeciesId,
} from './fullcam-templates/plot-builder';
import {
  calculateCarbonResults,
  carbonStockSeries,
  parseCarbonStock,
  updateSpatialData,
  type CarbonAnalysisPeriod,
  type CarbonResults,
  type CarbonSeriesPoint,
} from './spatial-data-updater';

export type PlantingSpecies = 'environmental-plantings' | 'mallee' | 'native-regeneration';
export type ClearingSpecies = PlantingSpecies | 'native-revegetation';

/** Species choices; rainfall picks between the <500mm and >=500mm variants where relevant */
export const SPECIES_CHOICES: Record<ClearingSpecies, { label: string; plantable: boolean }> = {
  'environmental-plantings': { label: 'Environmental plantings', plantable: true },
  'mallee': { label: 'Mallee eucalypt species', plantable: true },
  'native-regeneration': { label: 'Native Species Regeneration', plantable: true },
  'native-revegetation': { label: 'Native species and revegetation', plantable: false },
};

export { CLEARING_EVENT_NAMES };

export interface PlantingInstance {
  name: string;
  /** YYYYMMDD */
  datePlanted: number;
  /** Area still standing at the start of the reporting period */
  areaHa: number;
  latitude: number;
  longitude: number;
  species: PlantingSpecies;
  rainfallMm?: number;
}

export interface ClearedPlanting {
  plantingName: string;
  /** YYYYMMDD */
  dateCleared: number;
  areaClearedHa: number;
  clearingType: ClearingType;
}

export interface OtherClearing {
  description: string;
  /** YYYYMMDD */
  dateCleared: number;
  latitude: number;
  longitude: number;
  areaClearedHa: number;
  species: ClearingSpecies;
  /** Anything that isn't a number from 1 to 9999 means mature */
  treeAgeYears?: number;
  clearingType: ClearingType;
  rainfallMm?: number;
}

export interface CarbonScenario {
  reportingPeriod: CarbonAnalysisPeriod;
  plantings: PlantingInstance[];
  clearedPlantings: ClearedPlanting[];
  otherClearings: OtherClearing[];
}

export interface PlotJob {
  label: string;
  /** The input row this plot comes from */
  source: { list: 'plantings' | 'clearedPlantings' | 'otherClearings'; row: number };
  areaHa: number;
  latitude: number;
  longitude: number;
  dates: SimulationDates;
  activities: PlotActivities;
}

export interface PlotJobResult {
  job: PlotJob;
  /** Per-hectare results */
  results?: CarbonResults;
  /** tC for the job's area */
  plantingTotal?: number;
  clearingTotal?: number;
  productsTotal?: number;
  netTotal?: number;
  /** Carbon stock over the reporting period, by month (tC/ha); the first point is the start */
  stockSeries?: CarbonSeriesPoint[];
  simulationOutput?: string;
  error?: string;
}

export interface ScenarioResult {
  rows: PlotJobResult[];
  plantingTotal: number;
  clearingTotal: number;
  productsTotal: number;
  netTotal: number;
  /** Net change since the start of the reporting period, by month, summed over plots (tC) */
  netSeries: CarbonSeriesPoint[];
  /** Carbon stock by month, summed over plots (tC) */
  stockSeries: CarbonSeriesPoint[];
  /** False if any plot failed, so the totals leave something out */
  complete: boolean;
  notes: string[];
}

const RAINFALL_THRESHOLD_MM = 500;

function needsRainfall(species: ClearingSpecies): boolean {
  return species === 'native-regeneration' || species === 'native-revegetation';
}

/** Maps a species choice (plus rainfall where needed) to a FullCAM species ID */
export function resolveSpeciesId(species: ClearingSpecies, rainfallMm?: number): SpeciesId {
  const lowRainfall = (rainfallMm ?? 0) < RAINFALL_THRESHOLD_MM;
  switch (species) {
    case 'environmental-plantings':
      return 7;
    case 'mallee':
      return 23;
    case 'native-regeneration':
      return lowRainfall ? 33 : 34;
    case 'native-revegetation':
      return lowRainfall ? 31 : 32;
  }
}

function isValidDate(date: number): boolean {
  if (!Number.isInteger(date)) {
    return false;
  }
  const year = Math.floor(date / 10000);
  const month = Math.floor(date / 100) % 100;
  const day = date % 100;
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/** Month index (year * 12 + month - 1) */
function dateMonthIndex(date: number): number {
  return Math.floor(date / 10000) * 12 + (Math.floor(date / 100) % 100) - 1;
}

export type ScenarioList = 'reportingPeriod' | 'scenario' | 'plantings' | 'clearedPlantings' | 'otherClearings';

/** A problem with the scenario, located by list, row and field where possible */
export interface ScenarioIssue {
  list: ScenarioList;
  /** Zero-based row in the list */
  row?: number;
  /** Input field name (e.g. 'dateCleared'); absent for row- or list-level problems */
  field?: string;
  message: string;
}

const LIST_LABELS: Record<ScenarioList, string> = {
  reportingPeriod: 'Reporting period',
  scenario: 'Scenario',
  plantings: 'Plantings',
  clearedPlantings: 'Cleared plantings',
  otherClearings: 'Other clearing',
};

/** "Cleared plantings, row 1: area cleared (150 ha) is more than the planting area (100 ha)" */
export function formatIssue(issue: ScenarioIssue): string {
  const where = issue.row === undefined ? LIST_LABELS[issue.list] : `${LIST_LABELS[issue.list]}, row ${issue.row + 1}`;
  return `${where}: ${issue.message}`;
}

/**
 * Finds problems with the scenario's inputs, located by list, row and field so they can be shown
 * next to the input. An empty array means the scenario can be run.
 */
export function findScenarioIssues(scenario: CarbonScenario): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  const { reportingPeriod: period, plantings, clearedPlantings, otherClearings } = scenario;

  const periodStart = period.startYear * 12 + period.startMonth - 1;
  const periodEnd = period.endYear * 12 + period.endMonth - 1;
  const monthsValid = [period.startMonth, period.endMonth].every(m => Number.isInteger(m) && m >= 1 && m <= 12)
    && Number.isInteger(period.startYear) && Number.isInteger(period.endYear);
  if (!monthsValid) {
    issues.push({ list: 'reportingPeriod', field: 'period', message: 'enter a valid start and end year and month (1-12)' });
  } else if (periodEnd < periodStart) {
    issues.push({ list: 'reportingPeriod', field: 'period', message: 'the end must not be before the start' });
  }
  // An invalid period is already reported, so don't also flag every date against it
  const inPeriod = (date: number) => !monthsValid || (dateMonthIndex(date) >= periodStart && dateMonthIndex(date) <= periodEnd);

  if (plantings.length === 0 && otherClearings.length === 0) {
    issues.push({ list: 'scenario', message: 'add at least one planting or other clearing' });
  }

  const checkLocation = (list: ScenarioList, row: number, latitude: number, longitude: number) => {
    if (!(Number.isFinite(latitude) && Math.abs(latitude) <= 90)) {
      issues.push({ list, row, field: 'latitude', message: 'enter a latitude between -90 and 90' });
    }
    if (!(Number.isFinite(longitude) && Math.abs(longitude) <= 180)) {
      issues.push({ list, row, field: 'longitude', message: 'enter a longitude between -180 and 180' });
    }
  };

  const checkSpecies = (list: ScenarioList, row: number, species: ClearingSpecies, rainfallMm: number | undefined, plantable: boolean) => {
    if (!SPECIES_CHOICES[species] || (plantable && !SPECIES_CHOICES[species].plantable)) {
      issues.push({ list, row, field: 'species', message: plantable ? 'choose a species that can be planted' : 'choose a species' });
    } else if (needsRainfall(species) && !(rainfallMm! > 0)) {
      issues.push({ list, row, field: 'rainfallMm', message: 'enter the average annual rainfall (it decides between the <500mm and >=500mm species)' });
    }
  };

  const checkClearingType = (list: ScenarioList, row: number, clearingType: ClearingType) => {
    if (!CLEARING_EVENT_NAMES[clearingType]) {
      issues.push({ list, row, field: 'clearingType', message: 'choose a clearing type' });
    }
  };

  const plantingNames = new Set<string>();
  plantings.forEach((p, row) => {
    const list = 'plantings';
    if (!p.name.trim()) {
      issues.push({ list, row, field: 'name', message: 'enter a planting name' });
    } else if (plantingNames.has(p.name.trim())) {
      issues.push({ list, row, field: 'name', message: `planting name "${p.name}" is used more than once` });
    }
    plantingNames.add(p.name.trim());
    if (!isValidDate(p.datePlanted)) {
      issues.push({ list, row, field: 'datePlanted', message: 'enter a valid date planted' });
    } else if (monthsValid && dateMonthIndex(p.datePlanted) > periodEnd) {
      issues.push({ list, row, field: 'datePlanted', message: 'date planted is after the reporting period' });
    }
    if (!(p.areaHa > 0)) {
      issues.push({ list, row, field: 'areaHa', message: 'area must be greater than 0' });
    }
    checkLocation(list, row, p.latitude, p.longitude);
    checkSpecies(list, row, p.species, p.rainfallMm, true);
  });

  const clearedNames = new Set<string>();
  clearedPlantings.forEach((c, row) => {
    const list = 'clearedPlantings';
    const planting = plantings.find(p => p.name.trim() === c.plantingName.trim());
    if (!planting) {
      issues.push({ list, row, field: 'plantingName', message: 'choose a planting from the plantings list' });
    } else if (clearedNames.has(planting.name.trim())) {
      issues.push({ list, row, field: 'plantingName', message: `"${planting.name}" is already cleared in another row (only one clearing per planting)` });
    }
    if (planting) {
      clearedNames.add(planting.name.trim());
    }
    if (!isValidDate(c.dateCleared)) {
      issues.push({ list, row, field: 'dateCleared', message: 'enter a valid date cleared' });
    } else if (!inPeriod(c.dateCleared)) {
      issues.push({ list, row, field: 'dateCleared', message: 'date cleared must be within the reporting period' });
    } else if (planting && isValidDate(planting.datePlanted) && c.dateCleared <= planting.datePlanted) {
      issues.push({ list, row, field: 'dateCleared', message: 'date cleared must be after the date planted' });
    }
    if (!(c.areaClearedHa > 0)) {
      issues.push({ list, row, field: 'areaClearedHa', message: 'area cleared must be greater than 0' });
    } else if (planting && c.areaClearedHa > planting.areaHa) {
      issues.push({ list, row, field: 'areaClearedHa', message: `area cleared (${c.areaClearedHa} ha) is more than the planting area (${planting.areaHa} ha)` });
    }
    checkClearingType(list, row, c.clearingType);
  });

  otherClearings.forEach((o, row) => {
    const list = 'otherClearings';
    if (!o.description.trim()) {
      issues.push({ list, row, field: 'description', message: 'enter a description' });
    }
    if (!isValidDate(o.dateCleared)) {
      issues.push({ list, row, field: 'dateCleared', message: 'enter a valid date cleared' });
    } else if (!inPeriod(o.dateCleared)) {
      issues.push({ list, row, field: 'dateCleared', message: 'date cleared must be within the reporting period' });
    }
    if (!(o.areaClearedHa > 0)) {
      issues.push({ list, row, field: 'areaClearedHa', message: 'area cleared must be greater than 0' });
    }
    checkLocation(list, row, o.latitude, o.longitude);
    checkSpecies(list, row, o.species, o.rainfallMm, false);
    checkClearingType(list, row, o.clearingType);
  });

  // Anything left is a plot-level rule (e.g. trees too young to exist at the simulation start)
  if (issues.length === 0) {
    for (const job of buildPlotJobs(scenario)) {
      for (const message of validateActivities(job.dates, job.activities)) {
        issues.push({ list: job.source.list, row: job.source.row, message });
      }
    }
  }

  return issues;
}

/**
 * Checks the scenario's inputs. Returns user-facing errors labelled by list and row;
 * an empty array means the scenario can be run.
 */
export function validateScenario(scenario: CarbonScenario): string[] {
  return findScenarioIssues(scenario).map(formatIssue);
}

/**
 * One plot per row: uncleared planting area, cleared planting area (planted then fully cleared),
 * and other clearings (existing forest fully cleared). Assumes the scenario is valid.
 */
export function buildPlotJobs(scenario: CarbonScenario): PlotJob[] {
  const { reportingPeriod: period } = scenario;
  const jobs: PlotJob[] = [];

  const addJob = (
    label: string,
    source: PlotJob['source'],
    areaHa: number,
    latitude: number,
    longitude: number,
    activities: PlotActivities
  ) => {
    jobs.push({
      label,
      source,
      areaHa,
      latitude,
      longitude,
      activities,
      dates: getSimulationDates(activities, period.startYear, period.endYear),
    });
  };

  scenario.plantings.forEach((planting, row) => {
    const speciesId = resolveSpeciesId(planting.species, planting.rainfallMm);
    const planted = { date: planting.datePlanted, name: planting.name };
    const clearedRow = scenario.clearedPlantings.findIndex(c => c.plantingName.trim() === planting.name.trim());
    const cleared = scenario.clearedPlantings[clearedRow];
    const standingArea = planting.areaHa - (cleared?.areaClearedHa ?? 0);

    if (standingArea > 0) {
      addJob(`Planting "${planting.name}"`, { list: 'plantings', row }, standingArea, planting.latitude, planting.longitude, {
        speciesId,
        planting: planted,
      });
    }
    if (cleared) {
      addJob(`Cleared planting "${planting.name}"`, { list: 'clearedPlantings', row: clearedRow }, cleared.areaClearedHa, planting.latitude, planting.longitude, {
        speciesId,
        planting: planted,
        clearing: { date: cleared.dateCleared, type: cleared.clearingType, fractionCleared: 1, name: planting.name },
      });
    }
  });

  scenario.otherClearings.forEach((clearing, row) => {
    addJob(`Other clearing "${clearing.description}"`, { list: 'otherClearings', row }, clearing.areaClearedHa, clearing.latitude, clearing.longitude, {
      speciesId: resolveSpeciesId(clearing.species, clearing.rainfallMm),
      clearing: {
        date: clearing.dateCleared,
        type: clearing.clearingType,
        fractionCleared: 1,
        treeAgeYears: clearing.treeAgeYears,
        name: clearing.description,
      },
    });
  });

  return jobs;
}

/**
 * Runs every plot (spatial update + simulation) one after another and totals the results.
 * A failed plot is reported in its row and makes the totals incomplete; the others still run.
 */
export async function runScenario(
  scenario: CarbonScenario,
  onProgress?: (done: number, total: number, job: PlotJob) => void
): Promise<ScenarioResult> {
  const errors = validateScenario(scenario);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  const jobs = buildPlotJobs(scenario);
  const rows: PlotJobResult[] = [];

  for (const [index, job] of jobs.entries()) {
    onProgress?.(index, jobs.length, job);
    const response = await updateSpatialData(
      job.latitude,
      job.longitude,
      job.dates.simulationStartYear,
      job.dates.simulationEndYear,
      job.activities,
      '',
      true
    );

    if (!response.success) {
      rows.push({ job, error: response.error || 'Simulation failed' });
      continue;
    }

    const results = calculateCarbonResults(response, job.activities, scenario.reportingPeriod);
    const simulationOutput = typeof response.data === 'string' ? response.data : undefined;
    if (!results.success) {
      rows.push({ job, simulationOutput, error: results.error });
      continue;
    }

    const stock = simulationOutput ? parseCarbonStock(simulationOutput) : null;
    rows.push({
      job,
      results,
      simulationOutput,
      stockSeries: (stock && carbonStockSeries(stock, scenario.reportingPeriod)) ?? undefined,
      plantingTotal: results.planting && results.planting.perHectare * job.areaHa,
      clearingTotal: results.clearing && results.clearing.perHectare * job.areaHa,
      productsTotal: results.productsHeld && results.productsHeld.perHectare * job.areaHa,
      netTotal: results.net && results.net.perHectare * job.areaHa,
    });
  }
  onProgress?.(jobs.length, jobs.length, jobs[jobs.length - 1]);

  const sum = (pick: (row: PlotJobResult) => number | undefined) =>
    rows.reduce((total, row) => total + (pick(row) ?? 0), 0);

  // Every plot shares the reporting period, so their monthly series line up point for point
  const series = rows.filter(row => row.stockSeries);
  const stockSeries = (series[0]?.stockSeries ?? []).map((point, i) => ({
    label: point.label,
    value: series.reduce((total, row) => total + row.stockSeries![i].value * row.job.areaHa, 0),
  }));
  const netSeries = stockSeries.map(point => ({ label: point.label, value: point.value - stockSeries[0].value }));

  return {
    rows,
    netSeries,
    stockSeries,
    plantingTotal: sum(row => row.plantingTotal),
    clearingTotal: sum(row => row.clearingTotal),
    productsTotal: sum(row => row.productsTotal),
    netTotal: sum(row => row.netTotal),
    complete: rows.every(row => !row.error),
    notes: [...new Set(rows.flatMap(row => row.results?.notes ?? []))],
  };
}
