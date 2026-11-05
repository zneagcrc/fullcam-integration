/**
 * Chapter 16 equation inputs
 * Lays out FullCAM results as the arguments of the VEERG LULUCF chapter's equations (Methodological
 * Guidance Chapter 16, v1.1), one column per argument and one row per activity area, so they can be
 * copied straight into the workbook's calculations.
 */

import type { PlotJobResult, ScenarioResult } from './carbon-scenario';
import type { CarbonAnalysisPeriod } from './spatial-data-updater';
import type { FireKind } from './fullcam-templates/plot-builder';

export type Cell = string | number | undefined;

export interface EquationColumn {
  header: string;
  /** Decimal places when displayed; copied values keep full precision */
  digits?: number;
}

export interface EquationTable {
  title: string;
  /** Which equations the columns feed */
  equations: string;
  columns: EquationColumn[];
  rows: Cell[][];
  note: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** YYYYMMDD -> "16 Jun 2025" */
function formatDate(date: number): string {
  return `${date % 100} ${MONTH_NAMES[(Math.floor(date / 100) % 100) - 1]} ${Math.floor(date / 10000)}`;
}

const FIRE_LABELS: Record<FireKind, string> = {
  'wildfire': 'Wildfire',
  'prescribed-burn': 'Planned burn',
  'debris-burn': 'Post-clearing debris burn',
};

const ACTIVITY_LABELS: Record<string, string> = {
  '4': '4 (revegetation by planting)',
  '5': '5 (human-induced natural regeneration)',
  '1-3': '1-3 (land clearing)',
};

/** Builds the equation input tables from a scenario's results */
export function buildEquationTables(result: ScenarioResult, period: CarbonAnalysisPeriod): EquationTable[] {
  const rows = result.rows.filter((row): row is PlotJobResult & { results: NonNullable<PlotJobResult['results']> } => !!row.results);
  const periodStart = period.startYear * 10000 + period.startMonth * 100 + 1;
  const periodEnd = period.endYear * 10000 + period.endMonth * 100 + 31;
  const inPeriod = (date: number) => date >= periodStart && date <= periodEnd;
  const stocks = rows.find(row => row.results.stocks)?.results.stocks;
  const y = stocks ? `end of ${stocks.endLabel}` : 'end of y';
  const yMinus1 = stocks ? `end of ${stocks.startLabel}` : 'end of y-1';

  const tables: EquationTable[] = [];

  // 16.2.1.2 (2)-(4): woody carbon stock change
  tables.push({
    title: 'Woody carbon stock change',
    equations: 'Section 16.2.1.2, equations (2)-(4)',
    columns: [
      { header: 'Activity area (i)' },
      { header: 'Activity (j)' },
      { header: 'A i,j (ha)', digits: 2 },
      { header: 'C t,i,j,y-1 trees (t C/ha)', digits: 4 },
      { header: 'C t,i,j,y trees (t C/ha)', digits: 4 },
      { header: 'C d,i,j,y-1 debris (t C/ha)', digits: 4 },
      { header: 'C d,i,j,y debris (t C/ha)', digits: 4 },
    ],
    rows: rows.filter(row => row.results.stocks).map(row => {
      const s = row.results.stocks!;
      return [row.job.activityArea, ACTIVITY_LABELS[row.job.activity], row.job.areaHa, s.treesStart, s.treesEnd, s.debrisStart, s.debrisEnd];
    }),
    note: `C mass of trees and of forest debris from the last FullCAM output row of year y (${y}) and of the year before (${yMinus1}) (Appendix A2.2.5). Each clearing is its own activity area, split off from its planting.`,
  });

  // 16.2.1.4: biomass burning in year y
  const fireRows: Cell[][] = [];
  for (const row of rows) {
    for (const fire of row.results.fires ?? []) {
      if (!inPeriod(fire.date)) continue;
      const areaBurnt = row.job.areaHa * fire.fractionAffected;
      fireRows.push([
        row.job.activityArea,
        ACTIVITY_LABELS[row.job.activity],
        FIRE_LABELS[fire.kind],
        formatDate(fire.date),
        areaBurnt,
        fire.ch4 / fire.fractionAffected,
        fire.n2o / fire.fractionAffected,
        fire.combinedWithOtherFire ? 'Recorded in the same month as another fire: its gas is in that fire\'s row' : '',
      ]);
    }
  }
  tables.push({
    title: 'Biomass burning',
    equations: 'Section 16.2.1.4, equation (1)',
    columns: [
      { header: 'Activity area (i)' },
      { header: 'Activity (j)' },
      { header: 'Fire' },
      { header: 'Date' },
      { header: 'A burnt (ha)', digits: 2 },
      { header: 'M CH4 (t/ha burnt)', digits: 6 },
      { header: 'M N2O (t/ha burnt)', digits: 6 },
      { header: 'Note' },
    ],
    rows: fireRows,
    note: 'One row per fire in year y and activity area it reached. M is FullCAM\'s gas for the fire per hectare actually burnt (FullCAM\'s per-hectare figure is averaged over the whole plot, so it\'s divided by the share burnt), so M x A burnt gives the fire\'s total gas.',
  });

  // 16.2.1.7: harvested wood products
  tables.push({
    title: 'Harvested wood products',
    equations: 'Section 16.2.1.7, equation (1)',
    columns: [
      { header: 'Activity area (i)' },
      { header: 'Date cleared' },
      { header: 'A i,j,y (ha)', digits: 2 },
      { header: 'C p,i,j,y wood products (t C/ha)', digits: 4 },
    ],
    rows: rows
      .filter(row => row.job.activities.clearing?.type === 'product-recovery' && inPeriod(row.job.activities.clearing.date))
      .map(row => [row.job.activityArea, formatDate(row.job.activities.clearing!.date), row.job.areaHa, row.results.productsAtClearing]),
    note: 'For clearings with product recovery in year y: C mass of forest products in the clearing\'s output row less the row before (Appendix A2.2.5). The chapter applies this method to farm and plantation forestry (j = 6-7).',
  });

  // A2.6.1 (1)-(6): clearing emissions allocated over 20 years
  tables.push({
    title: 'Clearing emissions allocation',
    equations: 'Appendix A2.6.1, equations (1)-(6)',
    columns: [
      { header: 'Activity area (i)' },
      { header: 'Date cleared' },
      { header: 'A i (ha)', digits: 2 },
      { header: 'C t,i,j,before trees (t C/ha)', digits: 4 },
      { header: 'C t,i,j,after trees, 20 years on (t C/ha)', digits: 4 },
      { header: 'C d,i,j,before debris (t C/ha)', digits: 4 },
      { header: 'C d,i,j,after debris, 20 years on (t C/ha)', digits: 4 },
      { header: 'Years since clearing (s)' },
      { header: 'D s', digits: 4 },
      { header: 'A burnt, debris burn (ha)', digits: 2 },
      { header: 'M CH4, debris burn (t/ha burnt)', digits: 6 },
      { header: 'M N2O, debris burn (t/ha burnt)', digits: 6 },
    ],
    rows: rows.filter(row => row.results.allocation).map(row => {
      const a = row.results.allocation!;
      const burnt = (row.job.activities.fires ?? []).some(fire => fire.kind === 'debris-burn');
      return [
        row.job.activityArea,
        formatDate(row.job.activities.clearing!.date),
        row.job.areaHa,
        a.treesBefore,
        a.treesAfter,
        a.debrisBefore,
        a.debrisAfter,
        a.yearsSinceClearing,
        a.discountFactor,
        // A debris burn covers the whole cleared area, so gas per plot hectare is per burnt hectare
        burnt ? row.job.areaHa : 0,
        burnt ? a.ch4 : 0,
        burnt ? a.n2o : 0,
      ];
    }),
    note: 'Before = the last output row before the clearing; after = the same month 20 years later. D s is the Table 16.27 discount factor for the years from the clearing to the end of year y (0 from 20 years). The debris burn includes one planned within 3 years of clearing.',
  });

  // 16.2.1.5: soil organic carbon loss from clearing in year y
  tables.push({
    title: 'Soil organic carbon loss from clearing',
    equations: 'Section 16.2.1.5, equation (2)',
    columns: [
      { header: 'Activity area (i)' },
      { header: 'Activity (j)' },
      { header: 'Date cleared' },
      { header: 'A i,j (ha)', digits: 2 },
    ],
    rows: rows
      .filter(row => row.job.activities.clearing && inPeriod(row.job.activities.clearing.date))
      .map(row => [row.job.activityArea, ACTIVITY_LABELS[row.job.activity], formatDate(row.job.activities.clearing!.date), row.job.areaHa]),
    note: 'Clearings in year y. The annual stock loss for the region (Table 16.4, by IBRA region) isn\'t a FullCAM output, so it comes from the chapter.',
  });

  return tables;
}

/** Tab-separated text of a table's rows, optionally with the header row, for pasting into Excel; numbers keep full precision */
export function equationTableToTsv(table: EquationTable, includeHeader = false): string {
  const rows = table.rows.map(row => row.map(cell => (cell === undefined ? '' : String(cell))));
  const lines = includeHeader ? [table.columns.map(c => c.header), ...rows] : rows;
  return lines.map(cells => cells.join('\t')).join('\n');
}
