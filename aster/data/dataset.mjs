// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
// Dataset import, cleaning and statistics. Intended to run in a dedicated
// worker: it parses untrusted files, so it must never run in privileged
// browser-process code. No eval, no network, bounded memory.
import {clean, isPlainObject, fail} from '../common/util.mjs';

export const DATASET_LIMITS = Object.freeze({bytes: 32 * 1024 * 1024, rows: 200000, columns: 512, cellLength: 32768});
const MISSING = new Set(['', 'na', 'n/a', 'null', 'nan', '-', '—']);
export const isMissing = value => value === null || value === undefined || MISSING.has(String(value).trim().toLowerCase());

function checkSize(text) {
  if (typeof text !== 'string') fail('invalid_input', 'Dataset must be text');
  if (text.length > DATASET_LIMITS.bytes || new TextEncoder().encode(text).length > DATASET_LIMITS.bytes) {
    fail('limit_exceeded', 'Dataset is too large to import');
  }
  return text.replace(/^﻿/, '');
}

function uniqueNames(names) {
  const seen = new Map();
  return names.map((raw, index) => {
    const base = clean(raw, 128) || `Column ${index + 1}`;
    let name = base;
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${base}_${n}`;
    seen.set(name.toLowerCase(), true);
    return name;
  });
}

// Picks the delimiter that appears most consistently in the first lines,
// ignoring quoted text.
export function detectDelimiter(text) {
  const sample = checkSize(text).split(/\r?\n/).filter(line => line.trim()).slice(0, 20);
  let best = ',';
  let bestScore = -1;
  for (const delimiter of [',', '\t', ';', '|']) {
    const counts = sample.map(line => {
      let count = 0;
      let quoted = false;
      for (const char of line) {
        if (char === '"') quoted = !quoted;
        else if (char === delimiter && !quoted) count++;
      }
      return count;
    });
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.filter(count => count === counts[0]).length;
    const score = consistent * 1000 + counts[0];
    if (score > bestScore) { best = delimiter; bestScore = score; }
  }
  return best;
}

// RFC 4180 parsing with quoted fields, doubled quotes and CRLF/LF endings.
// Returns {columns, rows, warnings}; every row has columns.length cells.
export function parseDelimited(input, {delimiter, header = true} = {}) {
  const text = checkSize(input);
  const sep = delimiter ?? detectDelimiter(text);
  if (![',', '\t', ';', '|'].includes(sep)) fail('invalid_delimiter', 'Unsupported delimiter');
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let fieldStart = true;
  const warnings = [];
  const endField = () => {
    if (field.length > DATASET_LIMITS.cellLength) fail('limit_exceeded', 'A cell is too long');
    record.push(field);
    if (record.length > DATASET_LIMITS.columns) fail('limit_exceeded', 'Too many columns');
    field = '';
    fieldStart = true;
  };
  const endRecord = () => {
    endField();
    if (!(record.length === 1 && record[0] === '')) {
      records.push(record);
      if (records.length > DATASET_LIMITS.rows + (header ? 1 : 0)) fail('limit_exceeded', 'Too many rows');
    }
    record = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += char;
    } else if (char === '"' && fieldStart) { quoted = true; fieldStart = false; }
    else if (char === sep) endField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRecord();
    } else { field += char; fieldStart = false; }
  }
  if (quoted) fail('invalid_csv', 'A quoted field is not closed');
  if (field !== '' || record.length) endRecord();
  if (!records.length) return {columns: [], rows: [], warnings};
  const width = Math.max(...records.map(row => row.length));
  const columns = uniqueNames(header ? records[0] : Array.from({length: width}, () => ''));
  while (columns.length < width) columns.push(uniqueNames([...columns, ''])[columns.length]);
  const body = header ? records.slice(1) : records;
  let ragged = 0;
  const rows = body.map(row => {
    if (row.length !== columns.length) ragged++;
    return Array.from({length: columns.length}, (_, index) => row[index] ?? '');
  });
  if (ragged) warnings.push(`${ragged} row(s) had a different number of cells and were padded.`);
  return {columns, rows, warnings};
}

// Accepts a JSON array of flat objects. Nested values are kept as JSON text
// and reported, rather than silently flattened.
export function parseJsonRecords(input) {
  const text = checkSize(input);
  let data;
  try { data = JSON.parse(text); } catch { fail('invalid_json', 'File is not valid JSON'); }
  if (!Array.isArray(data)) fail('invalid_json', 'Expected an array of records');
  if (data.length > DATASET_LIMITS.rows) fail('limit_exceeded', 'Too many rows');
  const names = [];
  const index = new Map();
  let nested = 0;
  for (const item of data) {
    if (!isPlainObject(item)) fail('invalid_json', 'Every record must be an object');
    for (const key of Object.keys(item)) {
      if (!index.has(key)) {
        index.set(key, names.length);
        names.push(key);
        if (names.length > DATASET_LIMITS.columns) fail('limit_exceeded', 'Too many columns');
      }
    }
  }
  const rows = data.map(item => names.map(key => {
    const value = item[key];
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') { nested++; return JSON.stringify(value).slice(0, DATASET_LIMITS.cellLength); }
    return String(value).slice(0, DATASET_LIMITS.cellLength);
  }));
  return {columns: uniqueNames(names), rows, warnings: nested ? [`${nested} nested value(s) were kept as JSON text.`] : []};
}

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
// Strict: no thousands separators, currency symbols or locale decimal commas,
// because guessing those can silently change values. Percent signs are
// rejected too; clean the column explicitly instead.
export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!NUMBER.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

const BOOLEAN = new Map([['true', true], ['false', false], ['yes', true], ['no', false]]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function inferColumns(table) {
  return table.columns.map((name, index) => {
    const values = table.rows.map(row => row[index]);
    const present = values.filter(value => !isMissing(value)).map(value => String(value).trim());
    let type = 'empty';
    if (present.length) {
      if (present.every(value => parseNumber(value) !== null)) type = 'number';
      else if (present.every(value => BOOLEAN.has(value.toLowerCase()))) type = 'boolean';
      else if (present.every(value => ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)))) type = 'date';
      else type = 'text';
    }
    return {name, index, type, missing: values.length - present.length, distinct: new Set(present).size};
  });
}

export function columnIndex(table, name) {
  const index = table.columns.indexOf(name);
  if (index < 0) fail('not_found', `Column not found: ${name}`);
  return index;
}

// Numeric values of a column; missing or non-numeric cells become null.
export function numericColumn(table, name) {
  const index = columnIndex(table, name);
  return table.rows.map(row => (isMissing(row[index]) ? null : parseNumber(row[index])));
}

// Linear-interpolated quantile (R type 7 / Excel QUARTILE.INC).
function quantile(sorted, p) {
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function describe(values) {
  if (!Array.isArray(values)) fail('invalid_input', 'Values must be an array');
  const numbers = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  const missing = values.length - numbers.length;
  if (!numbers.length) return {count: 0, missing, mean: null, median: null, sd: null, variance: null, min: null, max: null, q1: null, q3: null, sum: 0};
  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = numbers.reduce((total, value) => total + value, 0);
  const mean = sum / numbers.length;
  const variance = numbers.length > 1 ? numbers.reduce((total, value) => total + (value - mean) ** 2, 0) / (numbers.length - 1) : null;
  return {
    count: numbers.length, missing, sum, mean, median: quantile(sorted, 0.5),
    variance, sd: variance === null ? null : Math.sqrt(variance),
    min: sorted[0], max: sorted[sorted.length - 1], q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75),
  };
}

export function frequencies(table, name, {limit = 50} = {}) {
  const index = columnIndex(table, name);
  const counts = new Map();
  let missing = 0;
  for (const row of table.rows) {
    if (isMissing(row[index])) { missing++; continue; }
    const value = String(row[index]).trim();
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const items = [...counts].map(([value, count]) => ({value, count}))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return {items: items.slice(0, limit), distinct: items.length, missing};
}

// Ordinary least squares on pairs where both values are present.
export function linearRegression(xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length) fail('invalid_input', 'x and y must be arrays of equal length');
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = pairs.length;
  if (n < 2) fail('insufficient_data', 'Regression needs at least two complete pairs');
  const meanX = pairs.reduce((total, [x]) => total + x, 0) / n;
  const meanY = pairs.reduce((total, [, y]) => total + y, 0) / n;
  let sxx = 0; let syy = 0; let sxy = 0;
  for (const [x, y] of pairs) { sxx += (x - meanX) ** 2; syy += (y - meanY) ** 2; sxy += (x - meanX) * (y - meanY); }
  if (sxx === 0) fail('insufficient_data', 'x has no variation');
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r = syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
  const sse = pairs.reduce((total, [x, y]) => total + (y - (intercept + slope * x)) ** 2, 0);
  const residualSe = n > 2 ? Math.sqrt(sse / (n - 2)) : null;
  return {n, slope, intercept, r, r2: r === null ? null : r * r,
    slopeStandardError: residualSe === null ? null : residualSe / Math.sqrt(sxx), residualStandardError: residualSe};
}

export const pearson = (xs, ys) => linearRegression(xs, ys).r;

// Returns a cleaned copy and a report of each change made.
export function cleanTable(table, {trim = true, dropEmptyRows = true, dropDuplicateRows = false} = {}) {
  const report = {trimmedCells: 0, emptyRowsRemoved: 0, duplicateRowsRemoved: 0};
  const seen = new Set();
  const rows = [];
  for (const row of table.rows) {
    const next = row.map(cell => {
      const value = String(cell ?? '');
      if (trim && value.trim() !== value) { report.trimmedCells++; return value.trim(); }
      return value;
    });
    if (dropEmptyRows && next.every(cell => cell.trim() === '')) { report.emptyRowsRemoved++; continue; }
    if (dropDuplicateRows) {
      const key = JSON.stringify(next);
      if (seen.has(key)) { report.duplicateRowsRemoved++; continue; }
      seen.add(key);
    }
    rows.push(next);
  }
  return {table: {columns: [...table.columns], rows, warnings: [...(table.warnings || [])]}, report};
}
