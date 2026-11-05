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

export type SpeciesId = 7 | 23 | 31 | 32 | 33 | 34;

export type ClearingType = 'thin-clearing' | 'no-product-recovery' | 'product-recovery';

/** Tree age used for a mature forest; ages that aren't over 0 and up to 9999 are treated as mature */
export const MATURE_TREE_AGE = 9999;

interface SpeciesConfig {
  name: string;
  /** Library event used for planting, or null if the species can't be planted */
  plantingEventName: string | null;
  /** TYF growth curve used to derive initial biomass from tree age when clearing */
  clearingGrowthCurve: string;
}

export const SPECIES: Record<SpeciesId, SpeciesConfig> = {
  7: {
    name: 'Environmental plantings',
    plantingEventName: 'Establish environmental plantings - block geometry',
    clearingGrowthCurve: 'BlockES',
  },
  23: {
    name: 'Mallee eucalypt species',
    plantingEventName: 'Establish mallee eucalypt species - block geometry',
    clearingGrowthCurve: 'BlockES',
  },
  31: {
    name: 'Native species and revegetation <500mm rainfall',
    plantingEventName: null,
    clearingGrowthCurve: 'BlockLMG',
  },
  32: {
    name: 'Native species and revegetation >=500mm rainfall',
    plantingEventName: null,
    clearingGrowthCurve: 'BlockLMG',
  },
  33: {
    name: 'Native Species Regeneration <500mm rainfall',
    plantingEventName: 'Plant trees: natural regeneration in regeneration systems',
    clearingGrowthCurve: 'BlockLMG',
  },
  34: {
    name: 'Native Species Regeneration >=500mm rainfall',
    plantingEventName: 'Plant trees: natural regeneration in regeneration systems',
    clearingGrowthCurve: 'BlockLMG',
  },
};

/** The FullCAM team's recommended default for clearing on a farm */
export const DEFAULT_CLEARING_TYPE: ClearingType = 'no-product-recovery';

// Listed default first, so dropdowns built from it pre-select the default
export const CLEARING_EVENT_NAMES: Record<ClearingType, string> = {
  'no-product-recovery': 'Initial clearing: no product recovery',
  'thin-clearing': 'Thin (clearing)',
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
   * Age of the trees at the clearing date, in decimal years. Anything that isn't a number over 0
   * and up to 9999 (including undefined) means a mature forest. Ignored when the clearing follows a planting,
   * since the planting date sets the age.
   */
  treeAgeYears?: number;
  name?: string;
}

/**
 * wildfire / prescribed-burn: a fire in a standing planting (VEERG chapter Table 16.9).
 * debris-burn: burning the cleared debris after a clearing ("Site prep: Windrow and burn").
 */
export type FireKind = 'wildfire' | 'prescribed-burn' | 'debris-burn';

export interface FireActivity {
  /** YYYYMMDD */
  date: number;
  kind: FireKind;
  /** Fraction of the plot's area burnt, 0-1 */
  fractionAffected: number;
  /** Wildfires only: percent of trees killed in the burnt area, 0-100 */
  percentTreesKilled?: number;
  name?: string;
}

/** A growth pause (e.g. grazing disturbance) in a planting: chapter Table 16.10 */
export interface GrowthPauseActivity {
  /** YYYYMMDD */
  date: number;
  /** Length of the pause in decimal years, e.g. 3.75 for 3 years 9 months */
  years: number;
  name?: string;
}

export interface PlotActivities {
  speciesId: SpeciesId;
  planting?: PlantingActivity;
  clearing?: ClearingActivity;
  fires?: FireActivity[];
  growthPauses?: GrowthPauseActivity[];
}

/**
 * A forest treatment event with "Type 1: Age advance" on, as the chapter models a growth pause:
 * age advance = -pause length, advancement period = pause length. There's no standard event for it
 * in the species libraries, so the XML follows one made in the FullCAM web app
 * (docs/Environmental Plantings Method - From FullCAM template.plo).
 */
function growthPauseEvent(pause: GrowthPauseActivity): string {
  const years = String(pause.years);
  return `<Event tEV="TmtF" clearEV="false" onEV="true" dateOriginEV="Calendar" nYrsFromStEV="" nDaysFromStEV="" tFaqEV="" tAaqEV="" aqStYrEV="" aqEnYrEV="" nmEV="Growth pause" categoryEV="" tEvent="Doc" idSP="" regimeInstance="${crypto.randomUUID()}" nmRegime="${escapeXmlAttr(pause.name || 'Growth pause')}">
      <notesEV/>
      <TmtF ageAdvTmtF="-${years}" advPeriodTmtF="${years}" yieldMultTmtF="" type1On="true" type2On="false" fixTmtF="" phaTmtF=""/>
      <dateEV CalendarSystemT="FixedLength">${pause.date}</dateEV>
    </Event>`;
}

/**
 * The species library's standard event for a fire. Native Species Regeneration has wildfire events
 * for bands of trees killed (0-60% in 10% steps, then 70-100%); the other species only have
 * "trees killed" and "trees not killed", chosen by the chapter's 5% threshold.
 */
function fireEventName(speciesId: SpeciesId, fire: FireActivity): string {
  if (fire.kind === 'debris-burn') {
    return 'Site prep: Windrow and burn';
  }
  if (fire.kind === 'prescribed-burn') {
    return 'Prescribed burn';
  }
  const killed = fire.percentTreesKilled ?? 0;
  if (speciesId === 33 || speciesId === 34) {
    const band = killed >= 65 ? '70-100' : String(Math.round(killed / 10) * 10);
    return `Wildfire - ${band}% trees killed - ${speciesId === 33 ? 'NSR<500mm' : 'NSR>=500mm'}`;
  }
  return killed <= 5 ? 'Wildfire - trees not killed' : 'Wildfire - trees killed';
}

/** The chapter (Table 16.9) sets every "maximum years to regrow post-fire" to 20 for wildfires and controlled burns */
const FIRE_REGROW_YEARS: Record<string, string> = Object.fromEntries(
  ['Stem', 'Bran', 'Bark', 'Leaf', 'Cort', 'Firt'].map(part => [`yrs${part}RegrowFirF`, '20'])
);

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

/** The VEERG chapter (Appendix A2.6) spreads a clearing's emissions over the 20 years after it */
export const CLEARING_ALLOCATION_YEARS = 20;

/**
 * Simulation period derived from the activities and carbon analysis period.
 * Starts in January of the earliest activity or analysis start year (no earlier than needed, so a
 * forest being cleared already exists at the start). Ends in January after the analysis end year, or,
 * for a clearing, after the 20 years following it (Appendix A2.6 needs the stock 20 years on).
 * FullCAM simulates forward in time, so running longer doesn't change the analysis period's values.
 */
export function getSimulationDates(activities: PlotActivities, analysisStartYear: number, analysisEndYear: number): SimulationDates {
  const activityYears = [activities.planting?.date, activities.clearing?.date]
    .filter((date): date is number => date !== undefined)
    .map((date) => Math.floor(date / 10000));
  const clearingYear = activities.clearing ? Math.floor(activities.clearing.date / 10000) : undefined;
  return {
    simulationStartYear: Math.min(analysisStartYear, ...activityYears),
    simulationEndYear: Math.max(
      analysisEndYear + 1,
      clearingYear === undefined ? 0 : clearingYear + CLEARING_ALLOCATION_YEARS + 1
    ),
  };
}

/** Tree age at clearing: anything that isn't a number over 0 and up to 9999 means a mature forest */
export function normaliseTreeAge(age: unknown): number {
  return typeof age === 'number' && age > 0 && age <= MATURE_TREE_AGE ? age : MATURE_TREE_AGE;
}

/** Age of the cleared forest at the simulation start */
function clearingAgeAtStart(dates: SimulationDates, clearing: ClearingActivity): number {
  return normaliseTreeAge(clearing.treeAgeYears) - (toDecimalYear(clearing.date) - dates.simulationStartYear);
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
      errors.push(`${label} must be between ${simulationStartYear}0101 and ${simulationEndYear - 1}1231 (the simulation period)`);
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

    // When the clearing follows a planting, the planting date sets the tree age
    if (dateValid && !clearsPlanting(activities) && clearingAgeAtStart(dates, clearing) < 0) {
      const treeAge = normaliseTreeAge(clearing.treeAgeYears);
      const establishedYear = Math.ceil(toDecimalYear(clearing.date) - treeAge);
      errors.push(
        `Trees aged ${treeAge} years at clearing were established around ${establishedYear}, so they didn't exist at the start of ${simulationStartYear}. Start the carbon analysis in ${establishedYear} or later, or increase the tree age.`
      );
    }
  }

  for (const fire of activities.fires ?? []) {
    const label = fire.kind === 'debris-burn' ? 'Debris burn date' : fire.kind === 'wildfire' ? 'Wildfire date' : 'Planned burn date';
    if (!checkDate(label, fire.date)) {
      continue;
    }
    if (!(fire.fractionAffected > 0 && fire.fractionAffected <= 1)) {
      errors.push(`${label}: the share of the area burnt must be greater than 0% and at most 100%`);
    }
    if (fire.kind === 'wildfire' && !(fire.percentTreesKilled! >= 0 && fire.percentTreesKilled! <= 100)) {
      errors.push('Wildfire: percent of trees killed must be from 0% to 100%');
    }
    if (fire.kind === 'debris-burn') {
      if (!activities.clearing) {
        errors.push('A debris burn needs a clearing');
      } else if (fire.date < activities.clearing.date) {
        errors.push('The debris burn date must not be before the clearing date');
      }
    } else if (activities.planting && fire.date < activities.planting.date) {
      errors.push(`${label} must not be before the planting date`);
    }
  }

  for (const pause of activities.growthPauses ?? []) {
    if (!checkDate('Growth pause date', pause.date)) {
      continue;
    }
    if (!(pause.years > 0)) {
      errors.push('Growth pause length must be more than 0 years');
    }
    if (!activities.planting) {
      errors.push('A growth pause needs a planting');
    } else if (pause.date < activities.planting.date) {
      errors.push('Growth pause date must not be before the planting date');
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
    const age = clearingAgeAtStart(dates, clearing).toFixed(2);
    initTreeF = setAttr(initTreeF, 'maxTreeAgeInit', age);
    initTreeF = setAttr(initTreeF, 'avgTreeAgeInit', age);
    initTreeF = setAttr(initTreeF, 'tInitStem', 'FracAge');
    initTreeF = setAttr(initTreeF, 'tTYFCatInitF', config.clearingGrowthCurve);
  }

  return initTreeF;
}

/**
 * Plot-level InitDebrF. A plot that starts with an existing forest (to be cleared) uses the species'
 * default starting debris, as the FullCAM team advised; a plot that starts as bare ground (plantings,
 * and plantings later cleared) starts with no debris, per the VEERG chapter's "No initial trees or debris".
 */
function buildInitDebrF(speciesBlock: string, existingForest: boolean): string {
  if (!existingForest) {
    return DEFAULT_INIT_DEBR_F;
  }
  const speciesDefault = speciesBlock.match(/<ForestInit>[\s\S]*?(<InitDebrF [^>]*>)[\s\S]*?<\/ForestInit>/);
  if (!speciesDefault) {
    throw new Error('Species block has no ForestInit/InitDebrF');
  }
  return speciesDefault[1];
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

  // order breaks same-day ties: clearing (0), then debris burn (1), planting (2), other fires (3), growth pauses (4)
  const events: { date: number; order: number; xml: string }[] = [];

  if (activities.planting) {
    const { date, name } = activities.planting;
    events.push({
      date,
      order: 2,
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

  for (const fire of activities.fires ?? []) {
    const overrides: Record<string, string> = { fracAfctFirF: String(fire.fractionAffected) };
    events.push({
      date: fire.date,
      order: fire.kind === 'debris-burn' ? 1 : 3,
      xml: toPlotEvent(
        findLibraryEvent(speciesBlock, fireEventName(activities.speciesId, fire)),
        fire.date,
        fire.name || 'Fire',
        // Debris burns use the standard event's defaults (chapter Table 16.9: "Use defaults")
        fire.kind === 'debris-burn' ? overrides : { ...overrides, ...FIRE_REGROW_YEARS }
      ),
    });
  }

  for (const pause of activities.growthPauses ?? []) {
    events.push({ date: pause.date, order: 4, xml: growthPauseEvent(pause) });
  }

  events.sort((a, b) => a.date - b.date || a.order - b.order);

  const existingForestClearing = clearsPlanting(activities) ? undefined : activities.clearing;

  return generatePlotTemplate(coords, dates, {
    speciesForestSet: `<SpeciesForestSet count="1" showOnlyInUse="false">\n${speciesBlock}\n    </SpeciesForestSet>`,
    initTreeF: buildInitTreeF(speciesBlock, config, dates, existingForestClearing),
    initDebrF: buildInitDebrF(speciesBlock, existingForestClearing !== undefined),
    eventQ: generateEventQ(events.map((e) => e.xml)),
  });
}
