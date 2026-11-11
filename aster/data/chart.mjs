// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
// Static chart and table exports. SVG output contains no scripts, event
// handlers, external references or style sheets, and all text is escaped,
// so dataset contents cannot become active content.
import {clean, isPlainObject, fail} from '../common/util.mjs';
import {parseNumber} from './dataset.mjs';

export const CHART_LIMITS = Object.freeze({series: 12, points: 5000, categories: 200, width: [240, 2400], height: [180, 1800]});
// Okabe–Ito palette: distinguishable with common colour-vision deficiencies.
export const PALETTE = Object.freeze(['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#7F7F7F', '#000000']);

const xml = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const fixed = value => Math.round(value * 100) / 100;

export function formatNumber(value) {
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || magnitude < 1e-3) return value.toExponential(2).replace(/\.?0+e/, 'e');
  return String(Number(value.toPrecision(6)));
}

// "Nice" axis ticks (1, 2, 5 × 10^n steps) covering [min, max].
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) fail('invalid_chart', 'Axis bounds must be finite');
  if (min === max) { const pad = min === 0 ? 1 : Math.abs(min) * 0.1; min -= pad; max += pad; }
  const raw = (max - min) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * power).find(candidate => candidate >= raw);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let i = 0; start + i * step <= end + step * 1e-9 && ticks.length <= 50; i++) {
    ticks.push(Number((start + i * step).toPrecision(12)));
  }
  return ticks;
}

const finiteOrNull = value => (value === null || value === undefined ? null
  : Number.isFinite(value) ? value : fail('invalid_chart', 'Chart values must be finite numbers or null'));

function validate(spec) {
  if (!isPlainObject(spec)) fail('invalid_chart', 'Chart spec must be an object');
  const type = spec.type;
  if (!['bar', 'line', 'scatter'].includes(type)) fail('invalid_chart', 'Chart type must be bar, line or scatter');
  const width = spec.width ?? 640;
  const height = spec.height ?? 400;
  if (!Number.isInteger(width) || width < CHART_LIMITS.width[0] || width > CHART_LIMITS.width[1]
      || !Number.isInteger(height) || height < CHART_LIMITS.height[0] || height > CHART_LIMITS.height[1]) {
    fail('invalid_chart', 'Chart size is out of range');
  }
  if (!Array.isArray(spec.series) || !spec.series.length || spec.series.length > CHART_LIMITS.series) {
    fail('invalid_chart', `Provide 1–${CHART_LIMITS.series} series`);
  }
  let total = 0;
  const series = spec.series.map((item, index) => {
    if (!isPlainObject(item)) fail('invalid_chart', 'Invalid series');
    const name = clean(item.name, 80) || `Series ${index + 1}`;
    if (type === 'scatter') {
      if (!Array.isArray(item.points)) fail('invalid_chart', 'Scatter series need points');
      total += item.points.length;
      const points = item.points.map(point => {
        if (!Array.isArray(point) || point.length !== 2) fail('invalid_chart', 'Points must be [x, y]');
        return point.map(finiteOrNull);
      }).filter(([x, y]) => x !== null && y !== null);
      return {name, points};
    }
    if (!Array.isArray(item.values)) fail('invalid_chart', 'Series need values');
    total += item.values.length;
    return {name, values: item.values.map(finiteOrNull)};
  });
  if (total > CHART_LIMITS.points) fail('limit_exceeded', 'Too many points to chart');
  let categories = [];
  if (type !== 'scatter') {
    if (!Array.isArray(spec.categories) || !spec.categories.length || spec.categories.length > CHART_LIMITS.categories) {
      fail('invalid_chart', `Provide 1–${CHART_LIMITS.categories} categories`);
    }
    categories = spec.categories.map(value => clean(String(value ?? ''), 40));
    if (series.some(item => item.values.length !== categories.length)) fail('invalid_chart', 'Each series needs one value per category');
  }
  let trendline = null;
  if (spec.trendline !== undefined && spec.trendline !== null) {
    if (type !== 'scatter' || !isPlainObject(spec.trendline) || !Number.isFinite(spec.trendline.slope) || !Number.isFinite(spec.trendline.intercept)) {
      fail('invalid_chart', 'A trendline needs a scatter chart with a finite slope and intercept');
    }
    trendline = {slope: spec.trendline.slope, intercept: spec.trendline.intercept};
  }
  return {type, width, height, series, categories, trendline,
    title: clean(spec.title, 120), xLabel: clean(spec.xLabel, 80), yLabel: clean(spec.yLabel, 80)};
}

export function renderChartSvg(input) {
  const spec = validate(input);
  const {width, height, type, series} = spec;
  const legend = series.length > 1;
  const margin = {top: spec.title ? 40 : 16, right: 16, bottom: 48 + (legend ? 24 : 0), left: 64};
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const ys = type === 'scatter' ? series.flatMap(item => item.points.map(point => point[1])) : series.flatMap(item => item.values).filter(v => v !== null);
  if (!ys.length) fail('insufficient_data', 'No values to chart');
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (type === 'bar') { yMin = Math.min(0, yMin); yMax = Math.max(0, yMax); }
  const yTicks = niceTicks(yMin, yMax);
  const [y0, y1] = [yTicks[0], yTicks[yTicks.length - 1]];
  const yScale = value => margin.top + plotH - ((value - y0) / (y1 - y0)) * plotH;
  let xScale;
  let xTicks = [];
  if (type === 'scatter') {
    const xs = series.flatMap(item => item.points.map(point => point[0]));
    xTicks = niceTicks(Math.min(...xs), Math.max(...xs));
    const [x0, x1] = [xTicks[0], xTicks[xTicks.length - 1]];
    xScale = value => margin.left + ((value - x0) / (x1 - x0)) * plotW;
  } else {
    const band = plotW / spec.categories.length;
    xScale = index => margin.left + band * (index + 0.5);
  }
  const titleId = 'aster-chart-title';
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId}" font-family="system-ui, sans-serif" font-size="12">`];
  out.push(`<title id="${titleId}">${xml(spec.title || `${type} chart`)}</title>`);
  out.push(`<desc>${xml(`${series.map(item => item.name).join(', ')}${spec.xLabel ? ` by ${spec.xLabel}` : ''}`)}</desc>`);
  out.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  if (spec.title) out.push(`<text x="${width / 2}" y="24" text-anchor="middle" font-size="16" font-weight="600" fill="#1a1a1a">${xml(spec.title)}</text>`);
  for (const tick of yTicks) {
    const y = fixed(yScale(tick));
    out.push(`<line x1="${margin.left}" x2="${margin.left + plotW}" y1="${y}" y2="${y}" stroke="#e3e3e3"/>`);
    out.push(`<text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" fill="#4d4d4d">${xml(formatNumber(tick))}</text>`);
  }
  if (type === 'scatter') {
    for (const tick of xTicks) {
      const x = fixed(xScale(tick));
      out.push(`<text x="${x}" y="${margin.top + plotH + 18}" text-anchor="middle" fill="#4d4d4d">${xml(formatNumber(tick))}</text>`);
    }
  } else {
    const every = Math.ceil(spec.categories.length / Math.max(1, Math.floor(plotW / 60)));
    spec.categories.forEach((category, index) => {
      if (index % every) return;
      out.push(`<text x="${fixed(xScale(index))}" y="${margin.top + plotH + 18}" text-anchor="middle" fill="#4d4d4d">${xml(category)}</text>`);
    });
  }
  out.push(`<line x1="${margin.left}" x2="${margin.left + plotW}" y1="${fixed(yScale(Math.max(y0, Math.min(0, y1))))}" y2="${fixed(yScale(Math.max(y0, Math.min(0, y1))))}" stroke="#8c8c8c"/>`);
  series.forEach((item, seriesIndex) => {
    const color = PALETTE[seriesIndex % PALETTE.length];
    out.push(`<g fill="${color}" stroke="${color}" aria-label="${xml(item.name)}">`);
    if (type === 'bar') {
      const band = plotW / spec.categories.length;
      const barW = (band * 0.8) / series.length;
      item.values.forEach((value, index) => {
        if (value === null) return;
        const x = margin.left + band * index + band * 0.1 + barW * seriesIndex;
        const top = yScale(Math.max(0, value));
        const bottom = yScale(Math.min(0, value));
        out.push(`<rect x="${fixed(x)}" y="${fixed(top)}" width="${fixed(Math.max(1, barW - 1))}" height="${fixed(Math.max(0, bottom - top))}" stroke="none"><title>${xml(`${spec.categories[index]}: ${formatNumber(value)}`)}</title></rect>`);
      });
    } else if (type === 'line') {
      let path = '';
      let pen = false;
      item.values.forEach((value, index) => {
        if (value === null) { pen = false; return; }
        path += `${pen ? 'L' : 'M'}${fixed(xScale(index))} ${fixed(yScale(value))} `;
        pen = true;
      });
      out.push(`<path d="${path.trim()}" fill="none" stroke-width="2"/>`);
      item.values.forEach((value, index) => {
        if (value !== null) out.push(`<circle cx="${fixed(xScale(index))}" cy="${fixed(yScale(value))}" r="3" stroke="none"><title>${xml(`${spec.categories[index]}: ${formatNumber(value)}`)}</title></circle>`);
      });
    } else {
      for (const [x, y] of item.points) {
        out.push(`<circle cx="${fixed(xScale(x))}" cy="${fixed(yScale(y))}" r="3.5" fill-opacity="0.8" stroke="none"><title>${xml(`(${formatNumber(x)}, ${formatNumber(y)})`)}</title></circle>`);
      }
    }
    out.push('</g>');
  });
  if (spec.trendline) {
    const [xa, xb] = [xTicks[0], xTicks[xTicks.length - 1]];
    const clampY = value => Math.min(margin.top + plotH, Math.max(margin.top, yScale(value)));
    const {slope, intercept} = spec.trendline;
    out.push(`<line x1="${fixed(xScale(xa))}" y1="${fixed(clampY(intercept + slope * xa))}" x2="${fixed(xScale(xb))}" y2="${fixed(clampY(intercept + slope * xb))}" stroke="#1a1a1a" stroke-width="1.5" stroke-dasharray="6 4"><title>Trend line</title></line>`);
  }
  if (spec.xLabel) out.push(`<text x="${margin.left + plotW / 2}" y="${margin.top + plotH + 38}" text-anchor="middle" fill="#1a1a1a">${xml(spec.xLabel)}</text>`);
  if (spec.yLabel) out.push(`<text transform="translate(16 ${margin.top + plotH / 2}) rotate(-90)" text-anchor="middle" fill="#1a1a1a">${xml(spec.yLabel)}</text>`);
  if (legend) {
    let x = margin.left;
    const y = height - 14;
    series.forEach((item, index) => {
      out.push(`<rect x="${x}" y="${y - 9}" width="10" height="10" fill="${PALETTE[index % PALETTE.length]}"/>`);
      out.push(`<text x="${x + 14}" y="${y}" fill="#1a1a1a">${xml(item.name)}</text>`);
      x += 24 + item.name.length * 7;
    });
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}

// CSV export. Cells that a spreadsheet would treat as a formula are
// prefixed with an apostrophe (OWASP CSV injection guidance); plain numbers
// such as -5 are left unchanged.
export function tableToCsv(table) {
  if (!isPlainObject(table) || !Array.isArray(table.columns) || !Array.isArray(table.rows)) fail('invalid_input', 'Expected a table');
  const cell = value => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text) && parseNumber(text) === null) text = `'${text}`;
    return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [table.columns, ...table.rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
