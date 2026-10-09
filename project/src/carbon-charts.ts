import type { CarbonPeriodResult, CarbonResults } from './spatial-data-updater';

export interface CarbonAnalysisRange {
  startYear: number;
  startStepInYear: number;
  endYear: number;
  endStepInYear: number;
}

interface StepCarbonChange {
  label: string;
  treesDelta: number;
  debrisDelta: number;
  productsDelta: number;
  combinedDelta: number;
}

interface CumulativeCarbonPoint {
  label: string;
  treesTotal: number;
  debrisTotal: number;
  productsTotal: number;
  combinedTotal: number;
}

// Validated categorical slots (colour-blind safe in any pairing on white); the total is neutral ink
const TREES_COLOR = '#1baf7a';
const DEBRIS_COLOR = '#eb6834';
const PRODUCTS_COLOR = '#2a78d6';
const TOTAL_COLOR = '#333333';
const NET_COLOR = '#2a78d6';

interface ChartResult {
  success: boolean;
  error?: string;
  data?: StepCarbonChange[];
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toStepPoint(year: number, stepInYear: number): number {
  return (year * 12) + (stepInYear - 1);
}

function extractStepCarbonChanges(simulationData: any, range: CarbonAnalysisRange): ChartResult {
  const csvData = typeof simulationData === 'string'
    ? simulationData
    : JSON.stringify(simulationData);

  const lines = csvData.split('\n').filter((line) => line.trim());
  if (lines.length < 2) {
    return { success: false, error: 'No simulation rows to chart' };
  }

  const headers = lines[0].split(',').map((h) => h.trim());
  const yearIndex = headers.findIndex((h) => h.toLowerCase() === 'year');
  const stepIndex = headers.findIndex((h) => h.toLowerCase().includes('step in year'));
  const treesIndex = headers.findIndex((h) => h.includes('C mass of trees') && h.includes('tC/ha'));
  const debrisIndex = headers.findIndex((h) => h.includes('C mass of forest debris') && h.includes('tC/ha'));
  const productsIndex = headers.findIndex((h) => h.includes('C mass of forest products') && !h.includes('landfill'));

  if (yearIndex === -1 || stepIndex === -1 || treesIndex === -1 || debrisIndex === -1) {
    return { success: false, error: 'Required carbon chart columns not found in simulation CSV' };
  }

  const points: Array<{ year: number; step: number; point: number; treesCarbon: number; debrisCarbon: number; productsCarbon: number; combinedCarbon: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim());
    const year = parseInt(values[yearIndex], 10);
    const step = parseInt(values[stepIndex], 10);
    const trees = parseFloat(values[treesIndex]);
    const debris = parseFloat(values[debrisIndex]);
    // Older outputs have no wood products column
    const products = productsIndex === -1 ? 0 : parseFloat(values[productsIndex]) || 0;

    if (isNaN(year) || isNaN(step) || isNaN(trees) || isNaN(debris)) {
      continue;
    }

    points.push({
      year,
      step,
      point: toStepPoint(year, step),
      treesCarbon: trees,
      debrisCarbon: debris,
      productsCarbon: products,
      combinedCarbon: trees + debris + products
    });
  }

  points.sort((a, b) => a.point - b.point);

  if (points.length < 2) {
    return { success: false, error: 'Not enough data points to chart carbon change per step' };
  }

  const startPoint = Math.min(toStepPoint(range.startYear, range.startStepInYear), toStepPoint(range.endYear, range.endStepInYear));
  const endPoint = Math.max(toStepPoint(range.startYear, range.startStepInYear), toStepPoint(range.endYear, range.endStepInYear));

  const changes: StepCarbonChange[] = [];
  for (let i = 1; i < points.length; i++) {
    const current = points[i];
    const previous = points[i - 1];

    if (current.point < startPoint || current.point > endPoint) {
      continue;
    }

    changes.push({
      label: `${MONTH_NAMES[current.step - 1]} ${current.year}`,
      treesDelta: parseFloat((current.treesCarbon - previous.treesCarbon).toFixed(10)),
      debrisDelta: parseFloat((current.debrisCarbon - previous.debrisCarbon).toFixed(10)),
      productsDelta: parseFloat((current.productsCarbon - previous.productsCarbon).toFixed(10)),
      combinedDelta: parseFloat((current.combinedCarbon - previous.combinedCarbon).toFixed(10))
    });
  }

  if (changes.length === 0) {
    return { success: false, error: 'No step changes found in selected analysis period' };
  }

  return { success: true, data: changes };
}

function getSharedTickIndices(seriesLength: number): Set<number> {
  const indices = new Set<number>();
  if (!seriesLength || seriesLength < 1) {
    return indices;
  }

  const xTickStep = Math.max(1, Math.ceil(seriesLength / 8));
  for (let index = 0; index < seriesLength; index++) {
    if (index % xTickStep === 0 || index === seriesLength - 1) {
      indices.add(index);
    }
  }

  return indices;
}

function setEmptyChart(container: HTMLElement | null, title: string, message: string): void {
  if (!container) {
    return;
  }

  container.innerHTML = `<div class="carbon-chart-title">${title}</div><div class="carbon-chart-empty">${message}</div>`;
}

function renderCarbonChangeChart(container: HTMLElement | null, changes: StepCarbonChange[], sharedTickIndices: Set<number>): void {
  if (!container) {
    return;
  }

  if (!changes || changes.length === 0) {
    setEmptyChart(container, 'Carbon change per month', 'No chart data available');
    return;
  }

  const width = 900;
  const height = 280;
  const margin = { top: 16, right: 10, bottom: 44, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const minDelta = Math.min(0, ...changes.map((c) => c.combinedDelta));
  const maxDelta = Math.max(0, ...changes.map((c) => c.combinedDelta));
  const range = Math.max(maxDelta - minDelta, 1e-9);

  const y = (value: number) => margin.top + ((maxDelta - value) / range) * plotHeight;
  const zeroY = y(0);
  const barWidth = Math.max(1, (plotWidth / changes.length) - 1);

  const bars = changes.map((change, index) => {
    const x = margin.left + index * (plotWidth / changes.length);
    const yPos = y(change.combinedDelta);
    const heightValue = Math.max(1, Math.abs(zeroY - yPos));
    const rectY = change.combinedDelta >= 0 ? yPos : zeroY;
    const color = change.combinedDelta >= 0 ? '#4CAF50' : '#f44336';

    return `<rect x="${x.toFixed(2)}" y="${rectY.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${heightValue.toFixed(2)}" fill="${color}"><title>${change.label}: ${change.combinedDelta.toFixed(10)} tC/ha</title></rect>`;
  }).join('');

  const xTicks = changes
    .map((change, index) => ({ change, index }))
    .filter(({ index }) => sharedTickIndices.has(index))
    .map(({ change, index }) => {
      const x = margin.left + index * (plotWidth / changes.length);
      return `<text x="${x.toFixed(2)}" y="${(height - 12).toFixed(2)}" font-size="10" fill="#666">${change.label}</text>`;
    })
    .join('');

  const yTicks = [maxDelta, 0, minDelta]
    .map((value) => `<text x="8" y="${(y(value) + 4).toFixed(2)}" font-size="10" fill="#666">${value.toFixed(4)}</text>`)
    .join('');

  container.innerHTML = `
    <div class="carbon-chart-title">Carbon change per month (tC/ha)</div>
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="280" role="img" aria-label="Carbon change per month">
      <line x1="${margin.left}" y1="${zeroY.toFixed(2)}" x2="${(width - margin.right)}" y2="${zeroY.toFixed(2)}" stroke="#999" stroke-width="1" />
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${(height - margin.bottom)}" stroke="#ccc" stroke-width="1" />
      <line x1="${margin.left}" y1="${(height - margin.bottom)}" x2="${(width - margin.right)}" y2="${(height - margin.bottom)}" stroke="#ccc" stroke-width="1" />
      ${bars}
      ${xTicks}
      ${yTicks}
    </svg>
  `;
}

function buildCumulativeSequestrationSeries(changes: StepCarbonChange[]): CumulativeCarbonPoint[] {
  if (!changes || changes.length === 0) {
    return [];
  }

  let runningTotal = 0;
  let runningTreesTotal = 0;
  let runningDebrisTotal = 0;
  let runningProductsTotal = 0;
  return changes.map((change) => {
    runningTreesTotal += change.treesDelta;
    runningDebrisTotal += change.debrisDelta;
    runningProductsTotal += change.productsDelta;
    runningTotal += change.combinedDelta;
    return {
      label: change.label,
      treesTotal: parseFloat(runningTreesTotal.toFixed(10)),
      debrisTotal: parseFloat(runningDebrisTotal.toFixed(10)),
      productsTotal: parseFloat(runningProductsTotal.toFixed(10)),
      combinedTotal: parseFloat(runningTotal.toFixed(10))
    };
  });
}

function renderCarbonTotalChart(container: HTMLElement | null, totals: CumulativeCarbonPoint[], sharedTickIndices: Set<number>): void {
  if (!container) {
    return;
  }

  if (!totals || totals.length === 0) {
    setEmptyChart(container, 'Total carbon by month', 'No chart data available');
    return;
  }

  const width = 900;
  const height = 280;
  const margin = { top: 16, right: 10, bottom: 44, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const minValue = Math.min(
    0,
    ...totals.map((t) => t.treesTotal),
    ...totals.map((t) => t.debrisTotal),
    ...totals.map((t) => t.productsTotal),
    ...totals.map((t) => t.combinedTotal)
  );
  const maxValue = Math.max(
    0,
    ...totals.map((t) => t.treesTotal),
    ...totals.map((t) => t.debrisTotal),
    ...totals.map((t) => t.productsTotal),
    ...totals.map((t) => t.combinedTotal)
  );
  const valueRange = Math.max(maxValue - minValue, 1e-9);

  const y = (value: number) => margin.top + ((maxValue - value) / valueRange) * plotHeight;
  const x = (index: number) => margin.left + (index * plotWidth / Math.max(1, totals.length - 1));

  const treesColor = TREES_COLOR;
  const debrisColor = DEBRIS_COLOR;
  const productsColor = PRODUCTS_COLOR;
  const combinedColor = TOTAL_COLOR;

  const treesLine = totals
    .map((total, index) => `${x(index).toFixed(2)},${y(total.treesTotal).toFixed(2)}`)
    .join(' ');
  const debrisLine = totals
    .map((total, index) => `${x(index).toFixed(2)},${y(total.debrisTotal).toFixed(2)}`)
    .join(' ');
  const productsLine = totals
    .map((total, index) => `${x(index).toFixed(2)},${y(total.productsTotal).toFixed(2)}`)
    .join(' ');
  const combinedLine = totals
    .map((total, index) => `${x(index).toFixed(2)},${y(total.combinedTotal).toFixed(2)}`)
    .join(' ');

  const seriesPoints = totals
    .map((total, index) => {
      const px = x(index);
      const treesY = y(total.treesTotal);
      const debrisY = y(total.debrisTotal);
      const productsY = y(total.productsTotal);
      const combinedY = y(total.combinedTotal);

      return [
        `<circle cx="${px.toFixed(2)}" cy="${treesY.toFixed(2)}" r="2" fill="${treesColor}"><title>${total.label} Trees: ${total.treesTotal.toFixed(10)} tC/ha</title></circle>`,
        `<circle cx="${px.toFixed(2)}" cy="${debrisY.toFixed(2)}" r="2" fill="${debrisColor}"><title>${total.label} Debris: ${total.debrisTotal.toFixed(10)} tC/ha</title></circle>`,
        `<circle cx="${px.toFixed(2)}" cy="${productsY.toFixed(2)}" r="2" fill="${productsColor}"><title>${total.label} Wood products: ${total.productsTotal.toFixed(10)} tC/ha</title></circle>`,
        `<circle cx="${px.toFixed(2)}" cy="${combinedY.toFixed(2)}" r="2.5" fill="${combinedColor}"><title>${total.label} Combined: ${total.combinedTotal.toFixed(10)} tC/ha</title></circle>`
      ].join('');
    })
    .join('');

  const xTicks = totals
    .map((total, index) => ({ total, index }))
    .filter(({ index }) => sharedTickIndices.has(index))
    .map(({ total, index }) => {
      const px = x(index);
      return `<text x="${px.toFixed(2)}" y="${(height - 12).toFixed(2)}" font-size="10" fill="#666">${total.label}</text>`;
    })
    .join('');

  const yTicks = [maxValue, (maxValue + minValue) / 2, minValue]
    .map((value) => `<text x="8" y="${(y(value) + 4).toFixed(2)}" font-size="10" fill="#666">${value.toFixed(4)}</text>`)
    .join('');

  const hoverZones = totals
    .map((total, index) => {
      const currentX = x(index);
      const leftBoundary = index === 0
        ? margin.left
        : (x(index - 1) + currentX) / 2;
      const rightBoundary = index === totals.length - 1
        ? width - margin.right
        : (currentX + x(index + 1)) / 2;
      const zoneWidth = Math.max(1, rightBoundary - leftBoundary);

      return `<rect class="carbon-hover-zone" x="${leftBoundary.toFixed(2)}" y="${margin.top.toFixed(2)}" width="${zoneWidth.toFixed(2)}" height="${plotHeight.toFixed(2)}" fill="#ffffff" fill-opacity="0.001" stroke="none" pointer-events="all" data-label="${total.label}" data-trees="${total.treesTotal.toFixed(10)}" data-debris="${total.debrisTotal.toFixed(10)}" data-products="${total.productsTotal.toFixed(10)}" data-combined="${total.combinedTotal.toFixed(10)}" data-x="${currentX.toFixed(2)}"></rect>`;
    })
    .join('');

  container.innerHTML = `
    <div class="carbon-chart-title">Total carbon by month (tC/ha)</div>
    <div style="display:flex;gap:16px;align-items:center;margin-bottom:8px;font-size:12px;color:#666;">
      <span style="display:flex;align-items:center;gap:6px;"><span style="display:inline-block;width:10px;height:2px;background:${treesColor};"></span>C content of trees</span>
      <span style="display:flex;align-items:center;gap:6px;"><span style="display:inline-block;width:10px;height:2px;background:${debrisColor};"></span>C content of debris</span>
      <span style="display:flex;align-items:center;gap:6px;"><span style="display:inline-block;width:10px;height:2px;background:${productsColor};"></span>C content of wood products</span>
      <span style="display:flex;align-items:center;gap:6px;"><span style="display:inline-block;width:10px;height:2px;background:${combinedColor};"></span>Total C content (trees, debris and wood products)</span>
    </div>
    <div class="carbon-chart-svg-wrap">
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="280" role="img" aria-label="Total carbon by month">
        <line x1="${margin.left}" y1="${y(0).toFixed(2)}" x2="${(width - margin.right)}" y2="${y(0).toFixed(2)}" stroke="#999" stroke-width="1" />
        <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${(height - margin.bottom)}" stroke="#ccc" stroke-width="1" />
        <line x1="${margin.left}" y1="${(height - margin.bottom)}" x2="${(width - margin.right)}" y2="${(height - margin.bottom)}" stroke="#ccc" stroke-width="1" />
        <polyline points="${treesLine}" fill="none" stroke="${treesColor}" stroke-width="2" />
        <polyline points="${debrisLine}" fill="none" stroke="${debrisColor}" stroke-width="2" />
        <polyline points="${productsLine}" fill="none" stroke="${productsColor}" stroke-width="2" />
        <polyline points="${combinedLine}" fill="none" stroke="${combinedColor}" stroke-width="2" />
        ${seriesPoints}
        ${xTicks}
        ${yTicks}
        <line class="carbon-chart-hover-guide" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${(height - margin.bottom)}"></line>
        ${hoverZones}
      </svg>
      <div class="carbon-chart-tooltip"></div>
    </div>
  `;

  const tooltip = container.querySelector('.carbon-chart-tooltip') as HTMLDivElement | null;
  const hoverGuide = container.querySelector('.carbon-chart-hover-guide') as SVGLineElement | null;
  const hoverZoneNodes = container.querySelectorAll('.carbon-hover-zone');

  if (!tooltip) {
    return;
  }

  const showTooltip = (event: MouseEvent, zone: Element) => {
    const label = zone.getAttribute('data-label') || '';
    const trees = zone.getAttribute('data-trees') || '0';
    const debris = zone.getAttribute('data-debris') || '0';
    const products = zone.getAttribute('data-products') || '0';
    const combined = zone.getAttribute('data-combined') || '0';
    const hoveredX = zone.getAttribute('data-x') || `${margin.left}`;

    tooltip.innerHTML = `
      <div class="tooltip-label">${label}</div>
      <div>Trees: ${trees} tC/ha</div>
      <div>Debris: ${debris} tC/ha</div>
      <div>Wood products: ${products} tC/ha</div>
      <div>Total: ${combined} tC/ha</div>
    `;
    tooltip.style.display = 'block';

    const containerRect = container.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let left = event.clientX - containerRect.left + 12;
    let top = event.clientY - containerRect.top + 12;

    const maxLeft = Math.max(0, container.clientWidth - tooltipRect.width - 6);
    const maxTop = Math.max(0, container.clientHeight - tooltipRect.height - 6);

    left = Math.min(Math.max(6, left), maxLeft);
    top = Math.min(Math.max(6, top), maxTop);

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;

    if (hoverGuide) {
      hoverGuide.setAttribute('x1', hoveredX);
      hoverGuide.setAttribute('x2', hoveredX);
      hoverGuide.style.opacity = '1';
    }
  };

  hoverZoneNodes.forEach((zone) => {
    zone.addEventListener('mouseenter', (event) => {
      showTooltip(event as MouseEvent, zone);
    });

    zone.addEventListener('mousemove', (event) => {
      showTooltip(event as MouseEvent, zone);
    });

    zone.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
      if (hoverGuide) {
        hoverGuide.style.opacity = '0';
      }
    });
  });

  container.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
    if (hoverGuide) {
      hoverGuide.style.opacity = '0';
    }
  });
}

/** Round tick values (about 4-6) covering min..max */
function niceTicks(min: number, max: number): number[] {
  const span = Math.max(max - min, 1e-9);
  const rawStep = span / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => span / candidate <= 5) ?? 10 * magnitude;
  const first = Math.floor(min / step);
  const last = Math.ceil(max / step);
  const ticks: number[] = [];
  for (let i = first; i <= last; i++) {
    ticks.push(parseFloat((i * step).toFixed(10)));
  }
  return ticks;
}

function formatTonnes(value: number, signed = false, digits = Math.abs(value) >= 100 ? 0 : 1): string {
  const text = value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return signed && value > 0 ? `+${text}` : text;
}

interface LineChartOptions {
  title: string;
  /** Tooltip wording for a point's value, e.g. "Net change" */
  valueLabel: string;
  /** Show + on positive values */
  signed: boolean;
  /**
   * 'include-zero' always includes 0. 'auto' starts at 0 unless the data's range is under 40% of
   * its level, in which case the axis fits the data so the movement stays visible.
   */
  axis: 'include-zero' | 'auto';
}

/** The axis range to show for the given values */
function lineChartDomain(values: number[], axis: LineChartOptions['axis']): [number, number] {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const fitted = axis === 'auto' && (
    dataMin > 0 ? dataMax - dataMin < 0.4 * dataMax
      : dataMax < 0 ? dataMax - dataMin < 0.4 * -dataMin
        : false
  );
  const [low, high] = fitted ? [dataMin, dataMax] : [Math.min(0, dataMin), Math.max(0, dataMax)];
  // A flat line still needs a visible range
  const pad = high - low < 1e-9 ? Math.max(1, Math.abs(high) * 0.01) : 0;
  return [low - pad, high + pad];
}

/**
 * Single-line chart (tC) with the final value labelled at the line's end and a hover
 * crosshair + tooltip.
 */
function renderLineChart(
  container: HTMLElement | null,
  points: Array<{ label: string; value: number }>,
  options: LineChartOptions
): void {
  if (!container) {
    return;
  }
  const { title } = options;
  if (!points || points.length < 2) {
    setEmptyChart(container, title, 'No chart data available');
    return;
  }

  const width = 900;
  const height = 260;
  const margin = { top: 16, right: 96, bottom: 44, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const values = points.map((point) => point.value);
  const ticks = niceTicks(...lineChartDomain(values, options.axis));
  const minValue = ticks[0];
  const maxValue = ticks[ticks.length - 1];
  const valueRange = Math.max(maxValue - minValue, 1e-9);
  // One precision for every axis label, from the tick step
  const tickStep = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
  const tickDigits = tickStep >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(tickStep)));

  const y = (value: number) => margin.top + ((maxValue - value) / valueRange) * plotHeight;
  const x = (index: number) => margin.left + (index * plotWidth / (points.length - 1));

  const gridlines = ticks
    .map((tick) => {
      const ty = y(tick).toFixed(2);
      const stroke = tick === 0 ? '#999' : '#ececec';
      return `<line x1="${margin.left}" y1="${ty}" x2="${width - margin.right}" y2="${ty}" stroke="${stroke}" stroke-width="1" />`
        + `<text x="${margin.left - 8}" y="${(y(tick) + 4).toFixed(2)}" font-size="10" fill="#666" text-anchor="end">${formatTonnes(tick, false, tickDigits)}</text>`;
    })
    .join('');

  const tickIndices = getSharedTickIndices(points.length);
  const xTicks = points
    .map((point, index) => ({ point, index }))
    .filter(({ index }) => tickIndices.has(index))
    .map(({ point, index }) => {
      const anchor = index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle';
      return `<text x="${x(index).toFixed(2)}" y="${(height - 16).toFixed(2)}" font-size="10" fill="#666" text-anchor="${anchor}">${point.label}</text>`;
    })
    .join('');

  const line = points.map((point, index) => `${x(index).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
  const last = points[points.length - 1];
  const endX = x(points.length - 1);
  const endY = y(last.value);

  const hoverZones = points
    .map((point, index) => {
      const left = index === 0 ? margin.left : (x(index - 1) + x(index)) / 2;
      const right = index === points.length - 1 ? width - margin.right : (x(index) + x(index + 1)) / 2;
      return `<rect class="carbon-hover-zone" x="${left.toFixed(2)}" y="${margin.top}" width="${Math.max(1, right - left).toFixed(2)}" height="${plotHeight}" fill="#ffffff" fill-opacity="0.001" pointer-events="all" data-label="${point.label}" data-value="${formatTonnes(point.value, options.signed)}" data-x="${x(index).toFixed(2)}" data-y="${y(point.value).toFixed(2)}"></rect>`;
    })
    .join('');

  container.innerHTML = `
    <div class="carbon-chart-title">${title}</div>
    <div class="carbon-chart-svg-wrap">
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="${title}">
        ${gridlines}
        <polyline points="${line}" fill="none" stroke="${NET_COLOR}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <circle cx="${endX.toFixed(2)}" cy="${endY.toFixed(2)}" r="4" fill="${NET_COLOR}" stroke="#ffffff" stroke-width="2" />
        <text x="${(endX + 10).toFixed(2)}" y="${(endY + 4).toFixed(2)}" font-size="12" font-weight="bold" fill="#333">${formatTonnes(last.value, options.signed)} tC</text>
        ${xTicks}
        <line class="carbon-chart-hover-guide" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}"></line>
        <circle class="carbon-chart-hover-dot" r="4" fill="${NET_COLOR}" stroke="#ffffff" stroke-width="2" style="opacity:0;pointer-events:none"></circle>
        ${hoverZones}
      </svg>
      <div class="carbon-chart-tooltip"></div>
    </div>
  `;

  const tooltip = container.querySelector('.carbon-chart-tooltip') as HTMLDivElement | null;
  const guide = container.querySelector('.carbon-chart-hover-guide') as SVGLineElement | null;
  const dot = container.querySelector('.carbon-chart-hover-dot') as SVGCircleElement | null;
  if (!tooltip) {
    return;
  }

  const hide = () => {
    tooltip.style.display = 'none';
    guide?.style.setProperty('opacity', '0');
    dot?.style.setProperty('opacity', '0');
  };

  container.querySelectorAll('.carbon-hover-zone').forEach((zone) => {
    const show = (event: Event) => {
      const mouse = event as MouseEvent;
      const zoneX = zone.getAttribute('data-x') || `${margin.left}`;
      tooltip.innerHTML = `<div class="tooltip-label">${zone.getAttribute('data-label')}</div><div>${options.valueLabel}: ${zone.getAttribute('data-value')} tC</div>`;
      tooltip.style.display = 'block';

      const bounds = container.getBoundingClientRect();
      const tip = tooltip.getBoundingClientRect();
      const left = Math.min(Math.max(6, mouse.clientX - bounds.left + 12), Math.max(0, container.clientWidth - tip.width - 6));
      const top = Math.min(Math.max(6, mouse.clientY - bounds.top + 12), Math.max(0, container.clientHeight - tip.height - 6));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;

      guide?.setAttribute('x1', zoneX);
      guide?.setAttribute('x2', zoneX);
      guide?.style.setProperty('opacity', '1');
      dot?.setAttribute('cx', zoneX);
      dot?.setAttribute('cy', zone.getAttribute('data-y') || '0');
      dot?.style.setProperty('opacity', '1');
    };
    zone.addEventListener('mouseenter', show);
    zone.addEventListener('mousemove', show);
    zone.addEventListener('mouseleave', hide);
  });
  container.addEventListener('mouseleave', hide);
}

let chartModal: { dialog: HTMLDialogElement; body: HTMLElement } | null = null;
let chartModalOpener: HTMLElement | null = null;

/** The shared chart modal, created on first use */
function getChartModal(): { dialog: HTMLDialogElement; body: HTMLElement } {
  if (chartModal) {
    return chartModal;
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'chart-modal';
  dialog.setAttribute('aria-label', 'Larger chart');
  dialog.innerHTML = `
    <div class="chart-modal-inner">
      <div class="chart-modal-header">
        <button type="button" class="chart-modal-close">Close</button>
      </div>
      <div class="chart-modal-body"></div>
    </div>`;
  document.body.appendChild(dialog);

  const body = dialog.querySelector('.chart-modal-body') as HTMLElement;
  dialog.querySelector('.chart-modal-close')!.addEventListener('click', () => dialog.close());
  // The inner wrapper fills the dialog, so a click on the dialog itself is a click on the backdrop
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  dialog.addEventListener('close', () => {
    body.innerHTML = '';
    chartModalOpener?.focus();
    chartModalOpener = null;
  });

  chartModal = { dialog, body };
  return chartModal;
}

/**
 * Adds an Expand button to a rendered chart. The modal draws the chart again (rather than copying
 * it) so hover tooltips keep working at the larger size.
 */
function makeExpandable(container: HTMLElement | null, render: (target: HTMLElement) => void): void {
  if (!container) {
    return;
  }
  container.classList.add('carbon-chart-expandable');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'carbon-chart-expand';
  button.textContent = '⤢ Expand';
  button.setAttribute('aria-label', 'Show larger chart');
  button.addEventListener('click', () => {
    const { dialog, body } = getChartModal();
    body.innerHTML = '';
    const target = document.createElement('div');
    target.className = 'carbon-chart carbon-chart-large';
    body.appendChild(target);
    render(target);
    chartModalOpener = button;
    dialog.showModal();
  });
  container.appendChild(button);
}

const incompleteNote = (incomplete?: boolean) => (incomplete ? ' - incomplete, failed plots left out' : '');

/** Net carbon change (tC) since the start of the reporting period */
export function renderNetChart(
  container: HTMLElement | null,
  points: Array<{ label: string; value: number }>,
  options: { incomplete?: boolean } = {}
): void {
  const chartOptions: LineChartOptions = {
    title: `Net carbon change since the start of the reporting period (tC)${incompleteNote(options.incomplete)}`,
    valueLabel: 'Net change',
    signed: true,
    axis: 'include-zero',
  };
  renderLineChart(container, points, chartOptions);
  if (points?.length >= 2) {
    makeExpandable(container, (target) => renderLineChart(target, points, chartOptions));
  }
}

/** Total carbon stock (tC) over the reporting period */
export function renderStockChart(
  container: HTMLElement | null,
  points: Array<{ label: string; value: number }>,
  options: { incomplete?: boolean } = {}
): void {
  const chartOptions: LineChartOptions = {
    title: `Carbon stock: trees, debris and wood products (tC)${incompleteNote(options.incomplete)}`,
    valueLabel: 'Carbon stock',
    signed: false,
    axis: 'auto',
  };
  renderLineChart(container, points, chartOptions);
  if (points?.length >= 2) {
    makeExpandable(container, (target) => renderLineChart(target, points, chartOptions));
  }
}

export function clearCarbonCharts(changeContainerId: string, totalContainerId: string): void {
  const changeContainer = document.getElementById(changeContainerId);
  const totalContainer = document.getElementById(totalContainerId);

  if (changeContainer) {
    changeContainer.innerHTML = '';
  }

  if (totalContainer) {
    totalContainer.innerHTML = '';
  }
}

export function renderStepSequestrationCharts(
  simulationData: any,
  range: CarbonAnalysisRange,
  changeContainerId: string,
  totalContainerId: string
): { success: boolean; error?: string } {
  const changeContainer = document.getElementById(changeContainerId);
  const totalContainer = document.getElementById(totalContainerId);

  const chartDataResult = extractStepCarbonChanges(simulationData, range);
  if (!chartDataResult.success || !chartDataResult.data) {
    const message = chartDataResult.error || 'No chart data available';
    setEmptyChart(changeContainer, 'Carbon change per month', message);
    setEmptyChart(totalContainer, 'Total carbon by month', message);
    return { success: false, error: message };
  }

  const changes = chartDataResult.data;
  const sharedTickIndices = getSharedTickIndices(changes.length);
  renderCarbonChangeChart(changeContainer, changes, sharedTickIndices);
  makeExpandable(changeContainer, (target) => renderCarbonChangeChart(target, changes, sharedTickIndices));
  const cumulativeTotals = buildCumulativeSequestrationSeries(changes);
  renderCarbonTotalChart(totalContainer, cumulativeTotals, sharedTickIndices);
  makeExpandable(totalContainer, (target) => renderCarbonTotalChart(target, cumulativeTotals, sharedTickIndices));

  return { success: true };
}

function formatCarbon(value: number, signed: boolean): string {
  const text = value.toFixed(2);
  return signed && value > 0 ? `+${text}` : text;
}

function renderResultCard(label: string, result: CarbonPeriodResult, areaHectares: number, valueClass: string, signed: boolean): string {
  return `
    <div class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value ${valueClass}">${formatCarbon(result.perHectare, signed)}<span class="stat-unit">tC/ha</span></div>
      <div class="stat-detail">${formatCarbon(result.perHectare * areaHectares, signed)} tC over ${areaHectares} ha</div>
      <div class="stat-detail">${result.fromLabel} – ${result.toLabel}</div>
    </div>`;
}

/**
 * Renders planting, clearing and net carbon result cards plus explanatory notes
 */
export function renderCarbonResults(container: HTMLElement | null, results: CarbonResults, areaHectares: number): void {
  if (!container) {
    return;
  }

  const cards = [
    results.planting && renderResultCard('Sequestered in planting', results.planting, areaHectares, '', false),
    results.clearing && renderResultCard('Released by clearing', results.clearing, areaHectares, 'stat-value-loss', false),
    results.net &&
      renderResultCard('Net change (analysis period)', results.net, areaHectares, results.net.perHectare < 0 ? 'stat-value-loss' : '', true),
  ].filter(Boolean);

  const notes = results.notes.length > 0
    ? `<ul class="carbon-notes">${results.notes.map(note => `<li>${note}</li>`).join('')}</ul>`
    : '';

  container.innerHTML = cards.join('') + notes;
}
