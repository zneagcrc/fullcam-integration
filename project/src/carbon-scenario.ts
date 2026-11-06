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
  type FireActivity,
  type GrowthPauseActivity,
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
  type CarbonStocks,
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

export type LandUseAfterClearing = 'non-irrigated-crop' | 'irrigated-crop' | 'non-irrigated-pasture' | 'irrigated-pasture' | 'settlements';

/** Land uses after clearing, as labelled in the workbook */
export const LAND_USE_LABELS: Record<LandUseAfterClearing, string> = {
  'non-irrigated-crop': 'Non-irrigated crop',
  'irrigated-crop': 'Irrigated crop',
  'non-irrigated-pasture': 'Non-irrigated pasture',
  'irrigated-pasture': 'Irrigated pasture',
  'settlements': 'Settlements',
};

/** The chapter's land clearing activity (j): 1 forest to cropland, 2 to grassland, 3 to settlements */
export function landClearingActivity(landUse: LandUseAfterClearing): '1' | '2' | '3' {
  return landUse === 'settlements' ? '3' : landUse.endsWith('pasture') ? '2' : '1';
}

export interface PlantingInstance {
  name: string;
  /** YYYYMMDD */
  datePlanted: number;
  /** Area originally planted; clearings (current and historical) are subtracted from it */
  areaHa: number;
  latitude: number;
  longitude: number;
  species: PlantingSpecies;
  /** Overrides the site rainfall for this planting */
  rainfallMm?: number;
}

/** One row per planting per year of clearing; historical clearings (lookback period) included */
export interface ClearedPlanting {
  plantingName: string;
  /** YYYYMMDD */
  dateCleared: number;
  areaClearedHa: number;
  clearingType: ClearingType;
  /** YYYYMMDD; the cleared debris was burnt, or is planned to be within 3 years of clearing */
  debrisBurnDate?: number;
  landUse: LandUseAfterClearing;
}

export interface OtherClearing {
  description: string;
  /** YYYYMMDD */
  dateCleared: number;
  latitude: number;
  longitude: number;
  areaClearedHa: number;
  species: ClearingSpecies;
  /** Anything that isn't a number over 0 and up to 9999 means mature */
  treeAgeYears?: number;
  clearingType: ClearingType;
  /** YYYYMMDD; the cleared debris was burnt, or is planned to be within 3 years of clearing */
  debrisBurnDate?: number;
  landUse: LandUseAfterClearing;
  /** Overrides the site rainfall for this clearing */
  rainfallMm?: number;
}

/** A wildfire in a planting; applies to the area still standing on the date */
export interface WildfireEvent {
  plantingName: string;
  /** YYYYMMDD */
  date: number;
  /** Percent of the standing planting burnt, 0-100 */
  percentBurnt: number;
  /** Percent of trees killed in the burnt area, 0-100 */
  percentTreesKilled: number;
}

/** A planned (prescribed) burn in a planting; applies to the area still standing on the date */
export interface PlannedBurn {
  plantingName: string;
  /** YYYYMMDD */
  date: number;
  /** Percent of the standing planting affected, 0-100 */
  percentAffected: number;
}

/** A growth pause in a planting (e.g. a grazing disturbance); applies to the area still standing on the date */
export interface GrowthPause {
  plantingName: string;
  /** YYYYMMDD */
  date: number;
  /** Decimal years, e.g. 3.75 for 3 years 9 months */
  pauseYears: number;
}

export interface CarbonScenario {
  reportingPeriod: CarbonAnalysisPeriod;
  /** Site average annual rainfall (mm), used by every row that doesn't give its own */
  rainfallMm?: number;
  plantings: PlantingInstance[];
  clearedPlantings: ClearedPlanting[];
  otherClearings: OtherClearing[];
  wildfires?: WildfireEvent[];
  plannedBurns?: PlannedBurn[];
  growthPauses?: GrowthPause[];
}

/**
 * Appendix A2.6 amounts for a clearing's area: the 20-year woody carbon change (tC, negative is a
 * loss) and fire gases (t), and the share allocated to the reporting period (x discount factor)
 */
export interface AllocationTotals {
  change: number;
  ch4: number;
  n2o: number;
  allocatedChange: number;
  allocatedCh4: number;
  allocatedN2o: number;
}

/** The VEERG chapter's lookback: activities up to 20 years before the reporting period are modelled */
export const LOOKBACK_YEARS = 20;

/** The chapter (Appendix A2.6) counts a debris burn done, or planned within 3 years of clearing */
export const DEBRIS_BURN_MAX_YEARS = 3;

export interface PlotJob {
  label: string;
  /**
   * The chapter's activity area: a planting's standing area, each clearing split off from a planting,
   * or an other clearing. One FullCAM plot each.
   */
  activityArea: string;
  /** The chapter's land use change activity (j): 4 planting, 5 regeneration, 1-3 land clearing */
  activity: '1' | '2' | '3' | '4' | '5';
  /** Clearings only */
  landUse?: LandUseAfterClearing;
  rainfallMm?: number;
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
  /** t of gas emitted by fires in the reporting period, for the job's area */
  ch4Total?: number;
  n2oTotal?: number;
  /** Clearings only (Appendix A2.6), for the job's area: the 20-year change and this period's share */
  allocationTotals?: AllocationTotals;
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
  /** t of gas emitted by fires in the reporting period, summed over plots */
  ch4Total: number;
  n2oTotal: number;
  /** Appendix A2.6 clearing allocation, summed over clearing plots */
  allocationTotals?: AllocationTotals;
  /** Net change since the start of the reporting period, by month, summed over plots (tC) */
  netSeries: CarbonSeriesPoint[];
  /** Carbon stock by month, summed over plots (tC) */
  stockSeries: CarbonSeriesPoint[];
  /** Tree and debris stocks at the start and end of the reporting period, summed over plots (tC) */
  stocksTotal?: CarbonStocks;
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

/** YYYYMMDD plus whole years */
function addYears(date: number, years: number): number {
  return date + years * 10000;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** YYYYMMDD -> "16 Jun 2025" */
function formatDate(date: number): string {
  return `${date % 100} ${MONTH_NAMES[(Math.floor(date / 100) % 100) - 1]} ${Math.floor(date / 10000)}`;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** First month of the lookback period: 20 years before the reporting period starts */
function lookbackStartMonth(period: CarbonAnalysisPeriod): number {
  return period.startYear * 12 + period.startMonth - 1 - LOOKBACK_YEARS * 12;
}

/** Is the date before the lookback period (so it's no longer modelled)? */
function beforeLookback(date: number, period: CarbonAnalysisPeriod): boolean {
  return dateMonthIndex(date) < lookbackStartMonth(period);
}

/** Area of a planting still standing on a date: originally planted, less clearings on or before it */
function standingAreaOn(scenario: CarbonScenario, planting: PlantingInstance, date: number): number {
  const cleared = scenario.clearedPlantings
    .filter(c => c.plantingName.trim() === planting.name.trim() && c.dateCleared <= date && c.areaClearedHa > 0)
    .reduce((total, c) => total + c.areaClearedHa, 0);
  return planting.areaHa - cleared;
}

export type ScenarioList =
  | 'reportingPeriod'
  | 'site'
  | 'scenario'
  | 'plantings'
  | 'clearedPlantings'
  | 'otherClearings'
  | 'wildfires'
  | 'plannedBurns'
  | 'growthPauses';

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
  site: 'Site',
  scenario: 'Scenario',
  plantings: 'Plantings',
  clearedPlantings: 'Cleared plantings',
  otherClearings: 'Other clearing',
  wildfires: 'Wildfire events',
  plannedBurns: 'Planned burns',
  growthPauses: 'Growth pauses',
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

  if (scenario.rainfallMm !== undefined && !(scenario.rainfallMm > 0)) {
    issues.push({ list: 'site', field: 'rainfallMm', message: 'average annual rainfall must be more than 0 mm' });
  }
  // A row's own rainfall overrides the site's; reported once against the site if neither is given
  let rainfallNeeded = false;
  const checkSpecies = (list: ScenarioList, row: number, species: ClearingSpecies, rainfallMm: number | undefined, plantable: boolean) => {
    if (!SPECIES_CHOICES[species] || (plantable && !SPECIES_CHOICES[species].plantable)) {
      issues.push({ list, row, field: 'species', message: plantable ? 'choose a species that can be planted' : 'choose a species' });
    } else if (needsRainfall(species) && rainfallMm !== undefined && !(rainfallMm > 0)) {
      issues.push({ list, row, field: 'rainfallMm', message: 'average annual rainfall must be more than 0 mm' });
    } else if (needsRainfall(species) && rainfallMm === undefined && scenario.rainfallMm === undefined) {
      rainfallNeeded = true;
    }
  };

  const checkClearingType = (list: ScenarioList, row: number, clearingType: ClearingType) => {
    if (!CLEARING_EVENT_NAMES[clearingType]) {
      issues.push({ list, row, field: 'clearingType', message: 'choose a clearing type' });
    }
  };

  const checkLandUse = (list: ScenarioList, row: number, landUse: LandUseAfterClearing) => {
    if (!LAND_USE_LABELS[landUse]) {
      issues.push({ list, row, field: 'landUse', message: 'choose the land use after clearing' });
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

  const findPlanting = (name: string) => plantings.find(p => p.name.trim() === name.trim());
  // Activity dates may be historical, but not after the reporting period
  const notAfterPeriod = (date: number) => !monthsValid || dateMonthIndex(date) <= periodEnd;

  const checkDebrisBurn = (list: ScenarioList, row: number, dateCleared: number, debrisBurnDate?: number) => {
    if (debrisBurnDate === undefined) {
      return;
    }
    if (!isValidDate(debrisBurnDate)) {
      issues.push({ list, row, field: 'debrisBurnDate', message: 'enter a valid debris burn date, or leave it blank if there was no burn' });
    } else if (isValidDate(dateCleared) && debrisBurnDate < dateCleared) {
      issues.push({ list, row, field: 'debrisBurnDate', message: 'the debris burn date must not be before the date cleared' });
    } else if (isValidDate(dateCleared) && debrisBurnDate > addYears(dateCleared, DEBRIS_BURN_MAX_YEARS)) {
      issues.push({ list, row, field: 'debrisBurnDate', message: `the debris burn must be within ${DEBRIS_BURN_MAX_YEARS} years of clearing` });
    }
  };

  const clearedYears = new Set<string>();
  clearedPlantings.forEach((c, row) => {
    const list = 'clearedPlantings';
    const planting = findPlanting(c.plantingName);
    if (!planting) {
      issues.push({ list, row, field: 'plantingName', message: 'choose a planting from the plantings list' });
    }
    if (!isValidDate(c.dateCleared)) {
      issues.push({ list, row, field: 'dateCleared', message: 'enter a valid date cleared' });
    } else if (!notAfterPeriod(c.dateCleared)) {
      issues.push({ list, row, field: 'dateCleared', message: 'date cleared must not be after the reporting period' });
    } else if (planting && isValidDate(planting.datePlanted) && c.dateCleared <= planting.datePlanted) {
      issues.push({ list, row, field: 'dateCleared', message: 'date cleared must be after the date planted' });
    } else if (planting) {
      const key = `${planting.name.trim()}|${Math.floor(c.dateCleared / 10000)}`;
      if (clearedYears.has(key)) {
        issues.push({ list, row, field: 'dateCleared', message: `"${planting.name}" already has a clearing in ${Math.floor(c.dateCleared / 10000)}; use one row per planting per year of clearing` });
      }
      clearedYears.add(key);
    }
    if (!(c.areaClearedHa > 0)) {
      issues.push({ list, row, field: 'areaClearedHa', message: 'area cleared must be greater than 0' });
    }
    checkClearingType(list, row, c.clearingType);
    checkDebrisBurn(list, row, c.dateCleared, c.debrisBurnDate);
    checkLandUse(list, row, c.landUse);
  });

  // A planting's clearings can't add up to more than was originally planted; flag the row that tips it over
  for (const planting of plantings) {
    let cleared = 0;
    clearedPlantings
      .map((c, row) => ({ c, row }))
      .filter(({ c }) => c.plantingName.trim() === planting.name.trim() && c.areaClearedHa > 0 && isValidDate(c.dateCleared))
      .sort((a, b) => a.c.dateCleared - b.c.dateCleared)
      .forEach(({ c, row }) => {
        cleared += c.areaClearedHa;
        if (cleared > planting.areaHa + 1e-9) {
          issues.push({
            list: 'clearedPlantings', row, field: 'areaClearedHa',
            message: `clearings of "${planting.name}" add up to ${round(cleared)} ha, more than the area originally planted (${planting.areaHa} ha)`,
          });
        }
      });
  }

  // Each is its own activity area in the results, so its name must not be shared
  const otherNames = new Set<string>();
  otherClearings.forEach((o, row) => {
    const list = 'otherClearings';
    if (!o.description.trim()) {
      issues.push({ list, row, field: 'description', message: 'enter a description' });
    } else if (plantingNames.has(o.description.trim())) {
      issues.push({ list, row, field: 'description', message: `"${o.description}" is also a planting name; use a different description so the results can tell them apart` });
    } else if (otherNames.has(o.description.trim())) {
      issues.push({ list, row, field: 'description', message: `description "${o.description}" is used more than once` });
    }
    otherNames.add(o.description.trim());
    if (!isValidDate(o.dateCleared)) {
      issues.push({ list, row, field: 'dateCleared', message: 'enter a valid date cleared' });
    } else if (!notAfterPeriod(o.dateCleared)) {
      issues.push({ list, row, field: 'dateCleared', message: 'date cleared must not be after the reporting period' });
    }
    if (!(o.areaClearedHa > 0)) {
      issues.push({ list, row, field: 'areaClearedHa', message: 'area cleared must be greater than 0' });
    }
    checkLocation(list, row, o.latitude, o.longitude);
    checkSpecies(list, row, o.species, o.rainfallMm, false);
    checkClearingType(list, row, o.clearingType);
    checkDebrisBurn(list, row, o.dateCleared, o.debrisBurnDate);
    checkLandUse(list, row, o.landUse);
  });

  if (rainfallNeeded) {
    issues.push({ list: 'site', field: 'rainfallMm', message: 'enter the average annual rainfall (it decides between the <500mm and >=500mm native species)' });
  }

  // Fires apply to the area of the planting still standing on the date
  const checkPlantingEvent = (list: ScenarioList, row: number, plantingName: string, date: number): boolean => {
    const planting = findPlanting(plantingName);
    if (!planting) {
      issues.push({ list, row, field: 'plantingName', message: 'choose a planting from the plantings list' });
      return false;
    }
    if (!isValidDate(date)) {
      issues.push({ list, row, field: 'date', message: 'enter a valid event date' });
      return false;
    }
    if (!notAfterPeriod(date)) {
      issues.push({ list, row, field: 'date', message: 'event date must not be after the reporting period' });
      return false;
    }
    if (isValidDate(planting.datePlanted) && date < planting.datePlanted) {
      issues.push({ list, row, field: 'date', message: 'event date must not be before the date planted' });
      return false;
    }
    if (standingAreaOn(scenario, planting, date) <= 0) {
      const lastClearing = clearedPlantings
        .filter(c => c.plantingName.trim() === planting.name.trim() && c.dateCleared <= date)
        .reduce((latest, c) => Math.max(latest, c.dateCleared), 0);
      issues.push({ list, row, field: 'date', message: `"${planting.name}" was fully cleared by ${formatDate(lastClearing)}, so there's no area left for this event` });
      return false;
    }
    return true;
  };
  const checkPercent = (list: ScenarioList, row: number, field: string, value: number, label: string, allowZero: boolean) => {
    if (!(Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) && value <= 100)) {
      issues.push({ list, row, field, message: `${label} must be ${allowZero ? 'from 0% to 100%' : 'more than 0% and at most 100%'}` });
    }
  };

  (scenario.wildfires ?? []).forEach((w, row) => {
    checkPlantingEvent('wildfires', row, w.plantingName, w.date);
    checkPercent('wildfires', row, 'percentBurnt', w.percentBurnt, 'percent of planting burnt', false);
    checkPercent('wildfires', row, 'percentTreesKilled', w.percentTreesKilled, 'percent of trees killed', true);
  });
  (scenario.plannedBurns ?? []).forEach((b, row) => {
    checkPlantingEvent('plannedBurns', row, b.plantingName, b.date);
    checkPercent('plannedBurns', row, 'percentAffected', b.percentAffected, 'percent of planting affected', false);
  });
  (scenario.growthPauses ?? []).forEach((g, row) => {
    checkPlantingEvent('growthPauses', row, g.plantingName, g.date);
    if (!(Number.isFinite(g.pauseYears) && g.pauseYears > 0)) {
      issues.push({ list: 'growthPauses', row, field: 'pauseYears', message: 'pause length must be more than 0 years' });
    }
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
 * Things that don't stop the scenario running but should be checked: planting events on the same day.
 * FullCAM rejects a wildfire, planned burn and growth pause all on one day ("Document not Ready"),
 * though any two of them run. One warning per planting and date, located at its first event.
 */
export function findScenarioWarnings(scenario: CarbonScenario): ScenarioIssue[] {
  const events = [
    ...(scenario.wildfires ?? []).map((e, row) => ({ list: 'wildfires' as const, row, kind: 'wildfire', plantingName: e.plantingName, date: e.date })),
    ...(scenario.plannedBurns ?? []).map((e, row) => ({ list: 'plannedBurns' as const, row, kind: 'planned burn', plantingName: e.plantingName, date: e.date })),
    ...(scenario.growthPauses ?? []).map((e, row) => ({ list: 'growthPauses' as const, row, kind: 'growth pause', plantingName: e.plantingName, date: e.date })),
  ].filter(e => e.plantingName.trim() && isValidDate(e.date));

  const sameDay = new Map<string, typeof events>();
  for (const event of events) {
    const key = `${event.plantingName.trim()}|${event.date}`;
    sameDay.set(key, [...(sameDay.get(key) ?? []), event]);
  }

  const warnings: ScenarioIssue[] = [];
  for (const group of sameDay.values()) {
    if (group.length < 2) continue;
    const { list, row, plantingName, date } = group[0];
    const message = new Set(group.map(e => e.kind)).size === 3
      ? `"${plantingName}" has a wildfire, a planned burn and a growth pause on ${formatDate(date)}. FullCAM can't simulate all three on the same day, so this planting's plots will fail; move one of them to another day.`
      : `"${plantingName}" has ${group.length} events on ${formatDate(date)} (${group.map(e => e.kind).join(', ')}). FullCAM can run these, but check the dates are right.`;
    warnings.push({ list, row, message });
  }
  return warnings;
}

/**
 * Checks the scenario's inputs. Returns user-facing errors labelled by list and row;
 * an empty array means the scenario can be run.
 */
export function validateScenario(scenario: CarbonScenario): string[] {
  return findScenarioIssues(scenario).map(formatIssue);
}

/**
 * Plots for the scenario (assumes it's valid):
 * - each planting's standing area (originally planted, less all its clearings), with its fires
 * - each clearing of a planting: planted, fires before the clearing, cleared (+ debris burn)
 * - each other clearing: existing forest cleared (+ debris burn)
 * Clearings before the 20-year lookback aren't modelled (their area still comes off the planting).
 * Clearing plots run 20 years past the clearing for the Appendix A2.6 allocation.
 */
export function buildPlotJobs(scenario: CarbonScenario): PlotJob[] {
  const { reportingPeriod: period } = scenario;
  const jobs: PlotJob[] = [];

  const plantingFires = (planting: PlantingInstance): FireActivity[] => [
    ...(scenario.wildfires ?? [])
      .filter(w => w.plantingName.trim() === planting.name.trim())
      .map(w => ({ date: w.date, kind: 'wildfire' as const, fractionAffected: w.percentBurnt / 100, percentTreesKilled: w.percentTreesKilled, name: 'Wildfire' })),
    ...(scenario.plannedBurns ?? [])
      .filter(b => b.plantingName.trim() === planting.name.trim())
      .map(b => ({ date: b.date, kind: 'prescribed-burn' as const, fractionAffected: b.percentAffected / 100, name: 'Planned burn' })),
  ];
  // Clearing plots run 20 years past the clearing, so a burn planned within 3 years of it is always
  // simulated: it counts in the 20-year allocation, and can't change the reporting period's values
  const debrisBurn = (date?: number): FireActivity[] =>
    date === undefined ? [] : [{ date, kind: 'debris-burn', fractionAffected: 1, name: 'Debris burn' }];

  const addJob = (
    label: string,
    source: PlotJob['source'],
    areaHa: number,
    latitude: number,
    longitude: number,
    activities: PlotActivities,
    rainfallMm: number | undefined,
    landUse?: LandUseAfterClearing
  ) => {
    const name = activities.planting?.name ?? activities.clearing?.name ?? label;
    const isClearing = activities.clearing !== undefined;
    jobs.push({
      label,
      activityArea: isClearing && activities.planting
        ? `${name}, cleared ${formatDate(activities.clearing!.date)}`
        : name,
      // Native Species Regeneration plantings are human-induced natural regeneration (j = 5)
      activity: landUse ? landClearingActivity(landUse) : activities.speciesId === 33 || activities.speciesId === 34 ? '5' : '4',
      landUse,
      rainfallMm,
      source,
      areaHa,
      latitude,
      longitude,
      activities,
      dates: getSimulationDates(activities, period.startYear, period.endYear),
    });
  };

  scenario.plantings.forEach((planting, row) => {
    const rainfallMm = planting.rainfallMm ?? scenario.rainfallMm;
    const speciesId = resolveSpeciesId(planting.species, rainfallMm);
    const planted = { date: planting.datePlanted, name: planting.name };
    const fires = plantingFires(planting);
    const growthPauses: GrowthPauseActivity[] = (scenario.growthPauses ?? [])
      .filter(g => g.plantingName.trim() === planting.name.trim())
      .map(g => ({ date: g.date, years: g.pauseYears, name: 'Growth pause' }));
    const clearings = scenario.clearedPlantings
      .map((c, clearedRow) => ({ c, clearedRow }))
      .filter(({ c }) => c.plantingName.trim() === planting.name.trim())
      .sort((a, b) => a.c.dateCleared - b.c.dateCleared);
    const standingArea = planting.areaHa - clearings.reduce((total, { c }) => total + c.areaClearedHa, 0);

    if (standingArea > 0) {
      addJob(`Planting "${planting.name}"`, { list: 'plantings', row }, standingArea, planting.latitude, planting.longitude, {
        speciesId,
        planting: planted,
        fires,
        growthPauses,
      }, rainfallMm);
    }
    for (const { c, clearedRow } of clearings) {
      if (beforeLookback(c.dateCleared, period)) {
        continue;
      }
      addJob(`Cleared planting "${planting.name}" (cleared ${formatDate(c.dateCleared)})`, { list: 'clearedPlantings', row: clearedRow }, c.areaClearedHa, planting.latitude, planting.longitude, {
        speciesId,
        planting: planted,
        clearing: { date: c.dateCleared, type: c.clearingType, fractionCleared: 1, name: planting.name },
        // Events on the clearing day happen after it, on the standing area only
        fires: [...fires.filter(f => f.date < c.dateCleared), ...debrisBurn(c.debrisBurnDate)],
        growthPauses: growthPauses.filter(g => g.date < c.dateCleared),
      }, rainfallMm, c.landUse);
    }
  });

  scenario.otherClearings.forEach((clearing, row) => {
    if (beforeLookback(clearing.dateCleared, period)) {
      return;
    }
    const rainfallMm = clearing.rainfallMm ?? scenario.rainfallMm;
    addJob(`Other clearing "${clearing.description}"`, { list: 'otherClearings', row }, clearing.areaClearedHa, clearing.latitude, clearing.longitude, {
      speciesId: resolveSpeciesId(clearing.species, rainfallMm),
      clearing: {
        date: clearing.dateCleared,
        type: clearing.clearingType,
        fractionCleared: 1,
        treeAgeYears: clearing.treeAgeYears,
        name: clearing.description,
      },
      fires: debrisBurn(clearing.debrisBurnDate),
    }, rainfallMm, clearing.landUse);
  });

  return jobs;
}

/** Notes about inputs that are deliberately left out of the modelling */
export function scenarioNotes(scenario: CarbonScenario): string[] {
  const { reportingPeriod: period } = scenario;
  const periodEnd = period.endYear * 12 + period.endMonth - 1;
  const notes: string[] = [];
  const oldClearings = [...scenario.clearedPlantings, ...scenario.otherClearings].filter(c => beforeLookback(c.dateCleared, period));
  if (oldClearings.length > 0) {
    notes.push(`${oldClearings.length} clearing(s) happened more than ${LOOKBACK_YEARS} years before the reporting period, so they aren't modelled (cleared planting area still comes off the planting).`);
  }
  const plannedBurns = [...scenario.clearedPlantings, ...scenario.otherClearings]
    .filter(c => c.debrisBurnDate !== undefined && dateMonthIndex(c.debrisBurnDate) > periodEnd);
  if (plannedBurns.length > 0) {
    notes.push(`${plannedBurns.length} debris burn(s) are planned after the reporting period: they count in the 20-year clearing allocation but don't change this period's stocks.`);
  }
  return notes;
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
      ch4Total: results.fireEmissions && results.fireEmissions.ch4 * job.areaHa,
      n2oTotal: results.fireEmissions && results.fireEmissions.n2o * job.areaHa,
      allocationTotals: results.allocation && {
        change: results.allocation.change * job.areaHa,
        ch4: results.allocation.ch4 * job.areaHa,
        n2o: results.allocation.n2o * job.areaHa,
        allocatedChange: results.allocation.change * job.areaHa * results.allocation.discountFactor,
        allocatedCh4: results.allocation.ch4 * job.areaHa * results.allocation.discountFactor,
        allocatedN2o: results.allocation.n2o * job.areaHa * results.allocation.discountFactor,
      },
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

  const withStocks = rows.filter(row => row.results?.stocks);
  const stockSum = (pick: (stocks: CarbonStocks) => number) =>
    withStocks.reduce((total, row) => total + pick(row.results!.stocks!) * row.job.areaHa, 0);
  const stocksTotal: CarbonStocks | undefined = withStocks.length === 0 ? undefined : {
    startLabel: withStocks[0].results!.stocks!.startLabel,
    endLabel: withStocks[0].results!.stocks!.endLabel,
    treesStart: stockSum(s => s.treesStart),
    treesEnd: stockSum(s => s.treesEnd),
    debrisStart: stockSum(s => s.debrisStart),
    debrisEnd: stockSum(s => s.debrisEnd),
  };

  return {
    rows,
    netSeries,
    stockSeries,
    stocksTotal,
    plantingTotal: sum(row => row.plantingTotal),
    clearingTotal: sum(row => row.clearingTotal),
    productsTotal: sum(row => row.productsTotal),
    netTotal: sum(row => row.netTotal),
    ch4Total: sum(row => row.ch4Total),
    n2oTotal: sum(row => row.n2oTotal),
    allocationTotals: rows.some(row => row.allocationTotals) ? {
      change: sum(row => row.allocationTotals?.change),
      ch4: sum(row => row.allocationTotals?.ch4),
      n2o: sum(row => row.allocationTotals?.n2o),
      allocatedChange: sum(row => row.allocationTotals?.allocatedChange),
      allocatedCh4: sum(row => row.allocationTotals?.allocatedCh4),
      allocatedN2o: sum(row => row.allocationTotals?.allocatedN2o),
    } : undefined,
    complete: rows.every(row => !row.error),
    notes: [...new Set([...rows.flatMap(row => row.results?.notes ?? []), ...scenarioNotes(scenario)])],
  };
}
