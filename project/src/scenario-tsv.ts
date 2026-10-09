/**
 * Scenario TSV
 * Reads tables copied from the reporting-year Excel workbook (tab-separated, header row included)
 * into a carbon scenario: plantings, cleared plantings and other clearing.
 */

import {
  CLEARING_EVENT_NAMES,
  SPECIES_CHOICES,
  type CarbonScenario,
  type ClearedPlanting,
  type ClearingSpecies,
  type OtherClearing,
  type PlantingInstance,
  type PlantingSpecies,
  type ScenarioIssue,
} from './carbon-scenario';
import type { ClearingType } from './fullcam-templates/plot-builder';

type TableName = 'plantings' | 'clearedPlantings' | 'otherClearings';

const TABLE_LABELS: Record<TableName, string> = {
  plantings: 'Plantings',
  clearedPlantings: 'Cleared plantings',
  otherClearings: 'Other clearing',
};

/** Where a parsed row came from, for error messages */
export interface PastedRowInfo {
  /** 1-based data row in the pasted table (header excluded, blank rows counted) */
  tableRow: number;
  /** The row's name, planting or description */
  name: string;
}

export interface PastedScenario {
  scenario: CarbonScenario;
  rows: Record<TableName, PastedRowInfo[]>;
  /** Problems reading the pasted text itself (missing headers, unreadable values) */
  errors: string[];
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Reads a spreadsheet date: "01-January-2025", "16-Jun-25", "31/12/2025" (day/month/year) or
 * "2025-12-31". Returns YYYYMMDD, or null if it isn't a real date.
 */
export function parseSheetDate(text: string): number | null {
  const value = text.trim();
  let day: number;
  let month: number;
  let year: number;

  let match = value.match(/^(\d{1,2})[-\s/]([A-Za-z]+)[-\s/](\d{2}|\d{4})$/);
  if (match) {
    const name = match[2].toLowerCase();
    const index = MONTHS.findIndex(m => m === name || (name.length >= 3 && m.startsWith(name)));
    if (index === -1) {
      return null;
    }
    [day, month, year] = [Number(match[1]), index + 1, Number(match[3])];
  } else if ((match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
    [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return null;
  }

  if (year < 100) {
    year += year < 50 ? 2000 : 1900;
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return year * 10000 + month * 100 + day;
}

/** "1,234.5" -> 1234.5; blank -> undefined; anything else that isn't a number -> NaN */
function parseNumber(text: string): number | undefined {
  const value = text.replace(/,/g, '').trim();
  return value === '' ? undefined : Number(value);
}

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

function matchSpecies(text: string, plantableOnly: boolean): ClearingSpecies | null {
  const value = normalise(text);
  const found = Object.entries(SPECIES_CHOICES).find(([, choice]) => normalise(choice.label) === value);
  if (!found || (plantableOnly && !found[1].plantable)) {
    return null;
  }
  return found[0] as ClearingSpecies;
}

/** Matches workbook labels like "Thin (clearing): to standing dead wood and litter" or just "Thin (clearing)" */
function matchClearingType(text: string): ClearingType | null {
  const value = normalise(text);
  const found = (Object.entries(CLEARING_EVENT_NAMES) as [ClearingType, string][])
    .find(([, name]) => value === normalise(name) || value.startsWith(`${normalise(name)}:`));
  return found ? found[0] : null;
}

interface ColumnSpec {
  key: string;
  header: string;
  required: boolean;
}

/**
 * Splits pasted text into rows of cells, finds the header row (within the first few lines, in case
 * a title was copied too) and returns each data row as { column key -> cell text }.
 */
function readTable(text: string, table: TableName, columns: ColumnSpec[], errors: string[]): Array<{ tableRow: number; cells: Record<string, string> }> {
  const lines = text.replace(/\r/g, '').split('\n').map(line => line.split('\t').map(cell => cell.replace(/^"|"$/g, '').trim()));
  if (lines.every(cells => cells.every(cell => cell === ''))) {
    return [];
  }

  const required = columns.filter(c => c.required);
  const headerIndex = lines.slice(0, 5).findIndex(cells => {
    const headers = cells.map(normalise);
    return required.every(c => headers.includes(normalise(c.header)));
  });
  if (headerIndex === -1) {
    errors.push(`${TABLE_LABELS[table]}: couldn't find the header row. Copy the whole table including its headers (needs: ${required.map(c => c.header).join(', ')})`);
    return [];
  }

  const headers = lines[headerIndex].map(normalise);
  const positions = Object.fromEntries(columns.map(c => [c.key, headers.indexOf(normalise(c.header))]));

  return lines.slice(headerIndex + 1).map((cells, i) => ({
    tableRow: i + 1,
    cells: Object.fromEntries(columns.map(c => [c.key, positions[c.key] === -1 ? '' : cells[positions[c.key]] ?? ''])),
  }));
}

/**
 * Reads the three pasted tables and the reporting period start and end cells into a scenario.
 * Rows without a name, planting or description (blank template rows) are skipped.
 */
export function parsePastedScenario(input: {
  periodStart: string;
  periodEnd: string;
  plantings: string;
  clearedPlantings: string;
  otherClearings: string;
}): PastedScenario {
  const errors: string[] = [];
  const rows: PastedScenario['rows'] = { plantings: [], clearedPlantings: [], otherClearings: [] };

  const start = parseSheetDate(input.periodStart);
  const end = parseSheetDate(input.periodEnd);
  if (start === null) {
    errors.push(`Reporting period: start date "${input.periodStart.trim()}" isn't a recognised date (e.g. 01-January-2025 or 01/01/2025)`);
  }
  if (end === null) {
    errors.push(`Reporting period: end date "${input.periodEnd.trim()}" isn't a recognised date (e.g. 31-December-2025 or 31/12/2025)`);
  }

  // Unreadable values become NaN/'' so the scenario checks still report the row
  const readDate = (where: string, label: string, text: string) => {
    if (!text) return NaN;
    const date = parseSheetDate(text);
    if (date === null) {
      errors.push(`${where}: ${label} "${text}" isn't a recognised date`);
    }
    return date ?? NaN;
  };
  const readSpecies = (where: string, text: string, plantableOnly: boolean) => {
    const species = matchSpecies(text, plantableOnly);
    if (text && !species) {
      errors.push(`${where}: species "${text}" isn't recognised${plantableOnly ? ' as a species that can be planted' : ''}`);
    }
    return species ?? ('' as ClearingSpecies);
  };
  const readClearingType = (where: string, text: string) => {
    const type = matchClearingType(text);
    if (text && !type) {
      errors.push(`${where}: clearing type "${text}" isn't recognised`);
    }
    return type ?? ('' as ClearingType);
  };
  const where = (table: TableName, tableRow: number, name: string) => `${TABLE_LABELS[table]}, row ${tableRow} (${name})`;

  const plantings: PlantingInstance[] = [];
  for (const { tableRow, cells } of readTable(input.plantings, 'plantings', [
    { key: 'name', header: 'Planting name', required: true },
    { key: 'datePlanted', header: 'Date planted', required: true },
    { key: 'areaHa', header: 'Area planted (hectares)', required: true },
    { key: 'latitude', header: 'Latitude', required: true },
    { key: 'longitude', header: 'Longitude', required: true },
    { key: 'species', header: 'Species (select)', required: true },
    { key: 'rainfallMm', header: 'Average annual rainfall (mm)', required: false },
  ], errors)) {
    if (!cells.name) continue;
    const at = where('plantings', tableRow, cells.name);
    rows.plantings.push({ tableRow, name: cells.name });
    plantings.push({
      name: cells.name,
      datePlanted: readDate(at, 'date planted', cells.datePlanted),
      areaHa: parseNumber(cells.areaHa) as number,
      latitude: parseNumber(cells.latitude) as number,
      longitude: parseNumber(cells.longitude) as number,
      species: readSpecies(at, cells.species, true) as PlantingSpecies,
      rainfallMm: parseNumber(cells.rainfallMm),
    });
  }

  const clearedPlantings: ClearedPlanting[] = [];
  for (const { tableRow, cells } of readTable(input.clearedPlantings, 'clearedPlantings', [
    { key: 'plantingName', header: 'Planting instance (select)', required: true },
    { key: 'dateCleared', header: 'Date cleared', required: true },
    { key: 'areaClearedHa', header: 'Area cleared (hectares)', required: true },
    { key: 'clearingType', header: 'Clearing type (select)', required: true },
  ], errors)) {
    if (!cells.plantingName) continue;
    const at = where('clearedPlantings', tableRow, cells.plantingName);
    rows.clearedPlantings.push({ tableRow, name: cells.plantingName });
    clearedPlantings.push({
      plantingName: cells.plantingName,
      dateCleared: readDate(at, 'date cleared', cells.dateCleared),
      areaClearedHa: parseNumber(cells.areaClearedHa) as number,
      clearingType: readClearingType(at, cells.clearingType),
    });
  }

  const otherClearings: OtherClearing[] = [];
  for (const { tableRow, cells } of readTable(input.otherClearings, 'otherClearings', [
    { key: 'description', header: 'Description', required: true },
    { key: 'dateCleared', header: 'Date cleared', required: true },
    { key: 'latitude', header: 'Latitude', required: true },
    { key: 'longitude', header: 'Longitude', required: true },
    { key: 'areaClearedHa', header: 'Area cleared (hectares)', required: true },
    { key: 'species', header: 'Species cleared (select)', required: true },
    { key: 'treeAgeYears', header: 'Age of trees (years)', required: false },
    { key: 'clearingType', header: 'Clearing type (select)', required: true },
    { key: 'rainfallMm', header: 'Average annual rainfall (mm)', required: false },
  ], errors)) {
    if (!cells.description) continue;
    const at = where('otherClearings', tableRow, cells.description);
    rows.otherClearings.push({ tableRow, name: cells.description });
    otherClearings.push({
      description: cells.description,
      dateCleared: readDate(at, 'date cleared', cells.dateCleared),
      latitude: parseNumber(cells.latitude) as number,
      longitude: parseNumber(cells.longitude) as number,
      areaClearedHa: parseNumber(cells.areaClearedHa) as number,
      species: readSpecies(at, cells.species, false),
      // Anything that isn't a number from 1 to 9999 means mature
      treeAgeYears: parseNumber(cells.treeAgeYears),
      clearingType: readClearingType(at, cells.clearingType),
      rainfallMm: parseNumber(cells.rainfallMm),
    });
  }

  // The reporting period is whole months: the start date's month to the end date's month
  const monthOf = (date: number | null) => (date === null ? NaN : Math.floor(date / 100) % 100);
  const yearOf = (date: number | null) => (date === null ? NaN : Math.floor(date / 10000));

  return {
    scenario: {
      reportingPeriod: { startYear: yearOf(start), startMonth: monthOf(start), endYear: yearOf(end), endMonth: monthOf(end) },
      plantings,
      clearedPlantings,
      otherClearings,
    },
    rows,
    errors,
  };
}

/** Formats a scenario issue using the pasted table's row numbers and names */
export function formatPastedIssue(issue: ScenarioIssue, rows: PastedScenario['rows']): string {
  if (issue.list === 'reportingPeriod') {
    return `Reporting period: ${issue.message}`;
  }
  if (issue.list === 'scenario' || issue.row === undefined) {
    return issue.message.charAt(0).toUpperCase() + issue.message.slice(1);
  }
  const info = rows[issue.list][issue.row];
  return info
    ? `${TABLE_LABELS[issue.list]}, row ${info.tableRow} (${info.name}): ${issue.message}`
    : `${TABLE_LABELS[issue.list]}: ${issue.message}`;
}
