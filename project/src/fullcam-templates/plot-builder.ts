/**
 * FullCAM Plot Builder
 * Builds a plot file for one species plus planting and/or clearing activities.
 *
 * Species blocks in ./species/*.xml are the <SpeciesForest> elements returned by the
 * FullCAM 2024 Data Builder `species` endpoint (they are location-independent). Each
 * block carries a library of events; plot events are copies of those library events.
 */

import { generatePlotTemplate, type SiteCoordinates, type SimulationDates } from './template-plot';

export type { SiteCoordinates, SimulationDates };

export type SpeciesId = 7 | 23 | 32 | 33 | 34;

export type ClearingType = 'thin-clearing' | 'no-product-recovery' | 'product-recovery';

interface SpeciesConfig {
  name: string;
  /** Library event used for planting, or null if the species can't be planted */
  plantingEventName: string | null;
  /** TYF growth curve used to derive initial biomass from tree age when clearing */
  clearingGrowthCurve: string;
  /** Whether clearing requires a tree age (species default age isn't meaningful) */
  requiresClearingAge: boolean;
  /** Plot-level initial debris (InitDebrF attribute -> tC/ha); unset pools are zero */
  initDebris: Record<string, number>;
}

export const SPECIES: Record<SpeciesId, SpeciesConfig> = {
  7: {
    name: 'Environmental plantings',
    plantingEventName: 'Establish environmental plantings - block geometry',
    clearingGrowthCurve: 'BlockES',
    requiresClearingAge: true,
    initDebris: {},
  },
  23: {
    name: 'Mallee eucalypt species',
    plantingEventName: 'Establish mallee eucalypt species - block geometry',
    clearingGrowthCurve: 'BlockES',
    requiresClearingAge: true,
    initDebris: {},
  },
  32: {
    name: 'Native species and revegetation >=500mm rainfall',
    plantingEventName: null,
    clearingGrowthCurve: 'BlockLMG',
    requiresClearingAge: false,
    initDebris: {},
  },
  33: {
    name: 'Native Species Regeneration <500mm rainfall',
    plantingEventName: 'Plant trees: natural regeneration in regeneration systems',
    clearingGrowthCurve: 'BlockLMG',
    requiresClearingAge: false,
    initDebris: {},
  },
  34: {
    name: 'Native Species Regeneration >=500mm rainfall',
    plantingEventName: 'Plant trees: natural regeneration in regeneration systems',
    clearingGrowthCurve: 'BlockLMG',
    requiresClearingAge: false,
    initDebris: {},
  },
};

export const CLEARING_EVENT_NAMES: Record<ClearingType, string> = {
  'thin-clearing': 'Thin (clearing)',
  'no-product-recovery': 'Initial clearing: no product recovery',
  'product-recovery': 'Initial clearing: product recovery',
};

export interface PlantingActivity {
  /** YYYYMMDD */
  date: number;
  name?: string;
}

export interface ClearingActivity {
  /** YYYYMMDD */
  date: number;
  type: ClearingType;
  /** Fraction of the forest cleared, 0-1 */
  fractionCleared: number;
  /**
   * Age of the trees at the clearing date; defaults to the species' default age where allowed.
   * Ignored when the clearing follows a planting, since the planting date sets the age.
   */
  treeAgeYears?: number;
  name?: string;
}

export interface PlotActivities {
  speciesId: SpeciesId;
  planting?: PlantingActivity;
  clearing?: ClearingActivity;
}

const DEFAULT_INIT_DEBR_F = '<InitDebrF dDdwdCMInitF="0.0" rDdwdCMInitF="0.0" dChwdCMInitF="0.0" rChwdCMInitF="0.0" dBlitCMInitF="0.0" rBlitCMInitF="0.0" dLlitCMInitF="0.0" rLlitCMInitF="0.0" dCodrCMInitF="0.0" rCodrCMInitF="0.0" dFidrCMInitF="0.0" rFidrCMInitF="0.0" dDdwdNCRatioInitF="" dChwdNCRatioInitF="" dBlitNCRatioInitF="" dLlitNCRatioInitF="" dCodrNCRatioInitF="" dFidrNCRatioInitF="" />';

const speciesLoaders = import.meta.glob<string>('./species/*.xml', { query: '?raw', import: 'default' });

async function loadSpeciesBlock(speciesId: SpeciesId): Promise<string> {
  const loader = speciesLoaders[`./species/${speciesId}.xml`];
  if (!loader) {
    throw new Error(`No species block bundled for species ${speciesId}`);
  }
  return (await loader()).trim();
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Sets (or adds) an attribute on an XML opening tag string. Value must already be XML-escaped. */
function setAttr(openingTag: string, name: string, value: string): string {
  const pattern = new RegExp(`(\\s${name}=)"[^"]*"`);
  if (pattern.test(openingTag)) {
    return openingTag.replace(pattern, `$1"${value}"`);
  }
  return openingTag.replace(/\s*(\/?>)$/, ` ${name}="${value}"$1`);
}

function getAttr(openingTag: string, name: string): string | null {
  const match = openingTag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? match[1] : null;
}

function findLibraryEvent(speciesBlock: string, eventName: string): string {
  const nmEV = `nmEV="${escapeXmlAttr(eventName)}"`;
  for (const match of speciesBlock.matchAll(/<Event [^>]*>[\s\S]*?<\/Event>/g)) {
    const openingTag = match[0].slice(0, match[0].indexOf('>') + 1);
    if (openingTag.includes(nmEV)) {
      return match[0];
    }
  }
  throw new Error(`Event "${eventName}" not found in species event library`);
}

/**
 * Turns a species library event into a plot event: tEvent SpecF -> Doc, adds a regime
 * and date, and applies attribute overrides to the event's detail element (PlnF, Thin, ...).
 */
function toPlotEvent(libraryEvent: string, date: number, regimeName: string, detailAttrs: Record<string, string>): string {
  const eventTagEnd = libraryEvent.indexOf('>') + 1;
  let eventTag = libraryEvent.slice(0, eventTagEnd);
  let body = libraryEvent.slice(eventTagEnd);

  eventTag = setAttr(eventTag, 'tEvent', 'Doc');
  eventTag = setAttr(eventTag, 'nmRegime', escapeXmlAttr(regimeName));
  eventTag = setAttr(eventTag, 'regimeInstance', crypto.randomUUID());

  const tEV = getAttr(eventTag, 'tEV');
  body = body.replace(new RegExp(`<${tEV} [^>]*>`), (detailTag) =>
    Object.entries(detailAttrs).reduce((tag, [name, value]) => setAttr(tag, name, value), detailTag)
  );

  body = body.replace(/\s*<\/Event>$/, `\n      <dateEV CalendarSystemT="FixedLength">${date}</dateEV>\n    </Event>`);
  return eventTag + body;
}

function generateEventQ(events: string[]): string {
  return `<EventQ count="${events.length}">
    ${events.join('\n    ')}
    <HeaderState sortIx="0" sortUp="true" sortBy1="false" sortBy2="false" showOnlyHS="false">
      <headSectW>80,270,785,270,270,0</headSectW>
    </HeaderState>
    <showEvT>t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,f</showEvT>
  </EventQ>`;
}

/** Parses a YYYYMMDD date, returning null if it isn't a real calendar date */
function parseDate(date: number): { year: number; month: number; day: number } | null {
  if (!Number.isInteger(date)) {
    return null;
  }
  const year = Math.floor(date / 10000);
  const month = Math.floor(date / 100) % 100;
  const day = date % 100;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** YYYYMMDD -> decimal year (date must be valid) */
function toDecimalYear(date: number): number {
  const { year, month, day } = parseDate(date)!;
  return year + (month - 1) / 12 + (day - 1) / 365;
}

/**
 * Simulation period derived from the activities and carbon analysis period.
 * Starts in January of the earliest activity or analysis start year (no earlier than needed, so a
 * forest being cleared already exists at the start) and ends in January after the analysis end year.
 */
export function getSimulationDates(activities: PlotActivities, analysisStartYear: number, analysisEndYear: number): SimulationDates {
  const activityYears = [activities.planting?.date, activities.clearing?.date]
    .filter((date): date is number => date !== undefined)
    .map((date) => Math.floor(date / 10000));
  return {
    simulationStartYear: Math.min(analysisStartYear, ...activityYears),
    simulationEndYear: analysisEndYear + 1,
  };
}

/** Age of the cleared forest at the simulation start, or null to use the species' default age */
function clearingAgeAtStart(dates: SimulationDates, clearing: ClearingActivity): number | null {
  if (clearing.treeAgeYears === undefined) {
    return null;
  }
  return clearing.treeAgeYears - (toDecimalYear(clearing.date) - dates.simulationStartYear);
}

/**
 * True when the clearing removes the planting (planting strictly before clearing), so the plot
 * starts as bare ground. Otherwise a clearing removes an existing forest, which may then be replanted.
 */
export function clearsPlanting(activities: PlotActivities): boolean {
  return !!activities.planting && !!activities.clearing && activities.planting.date < activities.clearing.date;
}

/**
 * Checks activities against the species and simulation period.
 * Returns user-facing error messages; an empty array means the activities are valid.
 */
export function validateActivities(dates: SimulationDates, activities: PlotActivities): string[] {
  const config = SPECIES[activities.speciesId];
  if (!config) {
    return [`Unsupported species: ${activities.speciesId}`];
  }

  const errors: string[] = [];
  const { simulationStartYear, simulationEndYear } = dates;

  const checkDate = (label: string, date: number): boolean => {
    if (!parseDate(date)) {
      errors.push(`${label} must be a valid date in YYYYMMDD format`);
      return false;
    }
    const decimalYear = toDecimalYear(date);
    if (decimalYear < simulationStartYear || decimalYear >= simulationEndYear) {
      errors.push(`${label} must be between ${simulationStartYear}0101 and ${simulationEndYear - 1}1231 (no later than the end of the carbon analysis period)`);
      return false;
    }
    return true;
  };

  if (!activities.planting && !activities.clearing) {
    errors.push('Include a planting or clearing event');
  }

  if (activities.planting) {
    if (!config.plantingEventName) {
      errors.push(`${config.name} can't be planted; it can only be used for clearing`);
    }
    checkDate('Planting date', activities.planting.date);
  }

  if (activities.clearing) {
    const clearing = activities.clearing;
    const dateValid = checkDate('Clearing date', clearing.date);

    if (!(clearing.fractionCleared > 0 && clearing.fractionCleared <= 1)) {
      errors.push('Percent cleared must be greater than 0 and at most 100');
    }

    if (clearsPlanting(activities)) {
      // Tree age comes from the planting date
    } else if (clearing.treeAgeYears === undefined) {
      if (config.requiresClearingAge) {
        errors.push(`Tree age at clearing is required for ${config.name}`);
      }
    } else if (!(clearing.treeAgeYears >= 1)) {
      errors.push('Tree age at clearing must be at least 1 year');
    } else if (dateValid && clearingAgeAtStart(dates, clearing)! < 0) {
      const establishedYear = Math.ceil(toDecimalYear(clearing.date) - clearing.treeAgeYears);
      errors.push(
        `Trees aged ${clearing.treeAgeYears} years at clearing were established around ${establishedYear}, so they didn't exist at the start of ${simulationStartYear}. Start the carbon analysis in ${establishedYear} or later, or increase the tree age.`
      );
    }
  }

  return errors;
}

/**
 * Plot-level InitTreeF, based on the species' ForestInit defaults.
 * Plots start with no trees unless an existing forest is cleared; its biomass is derived from
 * tree age via the species' clearing growth curve.
 */
function buildInitTreeF(speciesBlock: string, config: SpeciesConfig, dates: SimulationDates, clearing?: ClearingActivity): string {
  const forestInit = speciesBlock.match(/<ForestInit>\s*(<InitTreeF [^>]*>)/);
  if (!forestInit) {
    throw new Error('Species block has no ForestInit/InitTreeF');
  }
  let initTreeF = setAttr(forestInit[1], 'treeExistsInit', clearing ? 'true' : 'false');

  if (clearing) {
    const ageAtStart = clearingAgeAtStart(dates, clearing) ?? parseFloat(getAttr(initTreeF, 'avgTreeAgeInit') ?? '');
    const age = ageAtStart.toFixed(2);
    initTreeF = setAttr(initTreeF, 'maxTreeAgeInit', age);
    initTreeF = setAttr(initTreeF, 'avgTreeAgeInit', age);
    initTreeF = setAttr(initTreeF, 'tInitStem', 'FracAge');
    initTreeF = setAttr(initTreeF, 'tTYFCatInitF', config.clearingGrowthCurve);
  }

  return initTreeF;
}

function buildInitDebrF(config: SpeciesConfig): string {
  return Object.entries(config.initDebris).reduce(
    (tag, [name, value]) => setAttr(tag, name, String(value)),
    DEFAULT_INIT_DEBR_F
  );
}

/**
 * Generates a complete plot file for the given species and activities
 */
export async function generatePlotFile(coords: SiteCoordinates, dates: SimulationDates, activities: PlotActivities): Promise<string> {
  const errors = validateActivities(dates, activities);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  const config = SPECIES[activities.speciesId];
  const speciesBlock = await loadSpeciesBlock(activities.speciesId);
  const treeName = getAttr(speciesBlock.slice(0, speciesBlock.indexOf('>') + 1), 'nmSP') ?? '';

  // order breaks same-day ties: clearing (0) runs before planting (1)
  const events: { date: number; order: number; xml: string }[] = [];

  if (activities.planting) {
    const { date, name } = activities.planting;
    events.push({
      date,
      order: 1,
      xml: toPlotEvent(findLibraryEvent(speciesBlock, config.plantingEventName!), date, name || 'Planting', {
        treeNmPlnF: treeName,
      }),
    });
  }

  if (activities.clearing) {
    const { date, name, type, fractionCleared } = activities.clearing;
    events.push({
      date,
      order: 0,
      xml: toPlotEvent(findLibraryEvent(speciesBlock, CLEARING_EVENT_NAMES[type]), date, name || 'Clearing', {
        fracAfctThin: String(fractionCleared),
        treeNmThin: treeName,
      }),
    });
  }

  events.sort((a, b) => a.date - b.date || a.order - b.order);

  const existingForestClearing = clearsPlanting(activities) ? undefined : activities.clearing;

  return generatePlotTemplate(coords, dates, {
    speciesForestSet: `<SpeciesForestSet count="1" showOnlyInUse="false">\n${speciesBlock}\n    </SpeciesForestSet>`,
    initTreeF: buildInitTreeF(speciesBlock, config, dates, existingForestClearing),
    initDebrF: buildInitDebrF(config),
    eventQ: generateEventQ(events.map((e) => e.xml)),
  });
}
