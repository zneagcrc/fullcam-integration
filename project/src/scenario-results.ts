/**
 * Scenario results
 * Renders a carbon scenario's results: net change and stock charts, the per-plot results table
 * with totals, notes, and each plot's FullCAM output with its own charts.
 */

import type { ScenarioResult } from './carbon-scenario';
import type { CarbonAnalysisPeriod } from './spatial-data-updater';
import { renderNetChart, renderStepSequestrationCharts, renderStockChart } from './carbon-charts';
import { buildEquationTables, equationTableToTsv, type Cell, type EquationTable } from './chapter16-tables';

const escapeHtml = (text: unknown) =>
  String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function formatCell(
  total: number | undefined,
  perHectare?: number,
  { loss = false, signed = false, unit = 'tC', digits = 2 } = {}
): string {
  if (total === undefined) return '—';
  const text = (value: number) => (signed && value > 0 ? '+' : '') + value.toFixed(digits);
  const cls = loss || (signed && total < 0) ? ' class="loss"' : '';
  const perHa = perHectare === undefined ? '' : `<span class="per-ha">${text(perHectare)} ${unit}/ha</span>`;
  return `<span${cls}>${text(total)}</span>${perHa}`;
}

function renderEquationTable(table: EquationTable, index: number): string {
  const cell = (value: Cell, digits?: number) =>
    value === undefined ? '—' : typeof value === 'number' && digits !== undefined ? value.toFixed(digits) : escapeHtml(value);
  const disabled = table.rows.length === 0 ? ' disabled' : '';
  const body = table.rows.length === 0
    ? `<tr><td colspan="${table.columns.length}">None in this reporting period</td></tr>`
    : table.rows.map(row => `<tr>${row.map((value, i) => `<td>${cell(value, table.columns[i].digits)}</td>`).join('')}</tr>`).join('');
  return `
    <div class="equation-table">
      <div class="equation-table-header">
        <h4>${escapeHtml(table.title)} <span class="equation-ref">${escapeHtml(table.equations)}</span></h4>
        <div class="copy-controls">
          <label class="copy-header"><input type="checkbox" data-header="${index}"${disabled}> Include header row</label>
          <button type="button" class="copy-table" data-table="${index}"${disabled}>Copy table</button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="results-table">
          <thead><tr>${table.columns.map(c => `<th>${escapeHtml(c.header)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="results-caption">${escapeHtml(table.note)}</p>
    </div>`;
}

/** Copies text to the clipboard, falling back to a hidden textarea where the Clipboard API isn't allowed */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
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

  // The VEERG chapter's equation arguments, one table per equation (see chapter16-tables.ts)
  const equationTables = buildEquationTables(result, period);
  const equationSection = `
    <h3 class="results-subheading">Chapter 16 equation inputs</h3>
    <p class="results-caption">Each column is one argument of the VEERG LULUCF chapter's equations, and each row one activity area: a planting's standing area, each clearing split off from a planting, or an other clearing. Use "Copy table" to paste a table's values into Excel (full precision); tick "Include header row" to copy the column headings too.${result.complete ? '' : ' <strong>Incomplete: failed plots are left out.</strong>'}</p>
    ${equationTables.map((table, index) => renderEquationTable(table, index)).join('')}`;
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
          <th>Net change, trees + debris (tC)</th>
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
    ${equationSection}
    ${outputs.map((row, i) => `
      <details>
        <summary>FullCAM output: ${escapeHtml(row.job.label)}</summary>
        <div id="${idPrefix}-change-${i}" class="carbon-chart"></div>
        <div id="${idPrefix}-total-${i}" class="carbon-chart"></div>
        <pre>${escapeHtml(row.simulationOutput)}</pre>
      </details>`).join('')}`;

  renderNetChart(section.querySelector('[data-chart="net"]'), result.netSeries, { incomplete: !result.complete });
  renderStockChart(section.querySelector('[data-chart="stock"]'), result.stockSeries, { incomplete: !result.complete });

  section.querySelectorAll<HTMLButtonElement>('.copy-table').forEach(button => {
    button.addEventListener('click', async () => {
      const index = button.dataset.table;
      const includeHeader = section.querySelector<HTMLInputElement>(`input[data-header="${index}"]`)?.checked ?? false;
      await copyText(equationTableToTsv(equationTables[Number(index)], includeHeader));
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy table'; }, 1500);
    });
  });

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
