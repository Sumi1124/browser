// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
// Shared validation helpers for Aster's standalone JavaScript modules. These
// helpers have no browser bindings, storage access or network access.

export class AsterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AsterError';
    this.code = code;
  }
}

export const fail = (code, message) => { throw new AsterError(code, message); };

// Removes control characters, collapses whitespace and bounds length.
export const clean = (value, max = 4096) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

// Like clean() but keeps line breaks, for notes and flashcard text.
export const cleanMultiline = (value, max = 16384) => typeof value === 'string'
  ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .split('\n').map(line => line.replace(/[ ]+/g, ' ').trimEnd()).join('\n').trim().slice(0, max) : '';

const ID = /^[a-zA-Z0-9_-]{1,64}$/;
export const isId = value => typeof value === 'string' && ID.test(value);
export function assertId(value, what = 'ID') {
  if (!isId(value)) fail('invalid_id', `Invalid ${what}`);
  return value;
}

export const isPlainObject = value => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype;

export function assertLimit(count, limit, what) {
  if (count > limit) fail('limit_exceeded', `Too many ${what} (limit ${limit})`);
}

// Calendar dates are handled as UTC day numbers so that daylight-saving
// changes never shift a date-only value.
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function parseDate(value) {
  const match = typeof value === 'string' && value.match(DATE);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1) return null;
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(time / 86400000);
}
export function assertDate(value, what = 'date') {
  const day = parseDate(value);
  if (day === null) fail('invalid_date', `Invalid ${what}; expected YYYY-MM-DD`);
  return day;
}
export function formatDate(dayNumber) {
  return new Date(dayNumber * 86400000).toISOString().slice(0, 10);
}
export const addDays = (date, days) => formatDate(assertDate(date) + days);

// ISO-8601 instant validation for timestamps such as createdAt.
export function assertInstant(value, what = 'timestamp') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(value)
      || Number.isNaN(Date.parse(value))) fail('invalid_timestamp', `Invalid ${what}; expected UTC ISO-8601`);
  return value;
}

// Deterministic JSON with sorted object keys, used for checksums and consent
// hashes so that equal data always produces equal bytes.
export function canonicalJson(value) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'number' && !Number.isFinite(value)) fail('invalid_value', 'Non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return fail('invalid_value', 'Unsupported value in canonical JSON');
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function parseJsonBounded(text, maxBytes, what) {
  if (typeof text !== 'string') fail('invalid_input', `${what} must be text`);
  if (new TextEncoder().encode(text).length > maxBytes) fail('limit_exceeded', `${what} is too large`);
  try { return JSON.parse(text); } catch { return fail('invalid_json', `${what} is not valid JSON`); }
}
