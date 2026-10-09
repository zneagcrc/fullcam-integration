/**
 * Scenario results
 * Renders a carbon scenario's results: net change and stock charts, the per-plot results table
 * with totals, notes, and each plot's FullCAM output with its own charts.
 */

import type { ScenarioResult } from './carbon-scenario';
import type { CarbonAnalysisPeriod } from './spatial-data-updater';
import { renderNetChart, renderStepSequestrationCharts, renderStockChart } from './carbon-charts';

const escapeHtml = (text: unknown) =>
  String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function formatCell(total: number | undefined, perHectare?: number, { loss = false, signed = false } = {}): string {
  if (total === undefined) return '—';
  const text = (value: number) => (signed && value > 0 ? '+' : '') + value.toFixed(2);
  const cls = loss || (signed && total < 0) ? ' class="loss"' : '';
  const perHa = perHectare === undefined ? '' : `<span class="per-ha">${text(perHectare)} tC/ha</span>`;
  return `<span${cls}>${text(total)}</span>${perHa}`;
}

/** Renders the results into the section (replacing its contents) */
export function renderScenarioResults(section: HTMLElement, result: ScenarioResult, period: CarbonAnalysisPeriod): void {
  // Per-plot chart containers are found by id, so ids are prefixed per section
  const idPrefix = section.id || 'scenarioResults';
  section.classList.add('scenario-results');
  section.classList.toggle('error', !result.complete);

  const rows = result.rows.map(row => `
    <tr>
      <td>${escapeHtml(row.job.label)}${row.error ? `<span class="per-ha error">${escapeHtml(row.error)}</span>` : ''}</td>
      <td>${row.job.areaHa}</td>
      <td>${formatCell(row.plantingTotal, row.results?.planting?.perHectare)}</td>
      <td>${formatCell(row.clearingTotal, row.results?.clearing?.perHectare, { loss: true })}</td>
      <td>${formatCell(row.productsTotal, row.results?.productsHeld?.perHectare)}</td>
      <td>${formatCell(row.netTotal, row.results?.net?.perHectare, { signed: true })}</td>
    </tr>`).join('');

  const outputs = result.rows.filter(row => row.simulationOutput);

  section.innerHTML = `
    ${result.complete
      ? `<p class="success">✓ ${result.rows.length} plot(s) simulated</p>`
      : '<p class="error">✗ Some plots failed, so the totals leave them out. See the rows below.</p>'}
    <div class="carbon-chart" data-chart="net"></div>
    <div class="carbon-chart" data-chart="stock"></div>
    <table class="results-table">
      <thead>
        <tr>
          <th>Plot</th>
          <th>Area (ha)</th>
          <th>Sequestered in planting (tC)</th>
          <th>Released by clearing (tC)</th>
          <th>Held in wood products (tC)</th>
          <th>Net change (tC)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td>Total${result.complete ? '' : ' (incomplete)'}</td>
          <td></td>
          <td>${formatCell(result.plantingTotal)}</td>
          <td>${formatCell(result.clearingTotal, undefined, { loss: true })}</td>
          <td>${formatCell(result.productsTotal)}</td>
          <td>${formatCell(result.netTotal, undefined, { signed: true })}</td>
        </tr>
      </tfoot>
    </table>
    <ul class="results-notes">${result.notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul>
    ${outputs.map((row, i) => `
      <details>
        <summary>FullCAM output: ${escapeHtml(row.job.label)}</summary>
        <div id="${idPrefix}-change-${i}" class="carbon-chart"></div>
        <div id="${idPrefix}-total-${i}" class="carbon-chart"></div>
        <pre>${escapeHtml(row.simulationOutput)}</pre>
      </details>`).join('')}`;

  renderNetChart(section.querySelector('[data-chart="net"]'), result.netSeries, { incomplete: !result.complete });
  renderStockChart(section.querySelector('[data-chart="stock"]'), result.stockSeries, { incomplete: !result.complete });

  // Per-hectare charts for each plot, over the reporting period
  const range = {
    startYear: period.startYear,
    startStepInYear: period.startMonth,
    endYear: period.endYear,
    endStepInYear: period.endMonth,
  };
  outputs.forEach((row, i) => {
    renderStepSequestrationCharts(row.simulationOutput, range, `${idPrefix}-change-${i}`, `${idPrefix}-total-${i}`);
  });
}

/** Shows an error in place of results */
export function renderScenarioError(section: HTMLElement, message: string): void {
  section.classList.add('scenario-results', 'error');
  section.innerHTML = `<p class="error">✗ ${escapeHtml(message)}</p>`;
}
