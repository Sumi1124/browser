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

// Pure-JavaScript SHA-256 (FIPS 180-4). Used when Web Crypto is unavailable,
// for example in pages served from an app's custom URL scheme, which
// browsers do not always treat as a secure context.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

export function sha256HexSync(text) {
  const bytes = new TextEncoder().encode(text);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(length);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(length - 4, (bytes.length << 3) >>> 0);
  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => { hash[i] = (hash[i] + value) >>> 0; });
  }
  return Array.from(hash, word => word.toString(16).padStart(8, '0')).join('');
}

export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256HexSync(text);
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Random identifier that works with or without a secure context.
export function randomId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function parseJsonBounded(text, maxBytes, what) {
  if (typeof text !== 'string') fail('invalid_input', `${what} must be text`);
  if (new TextEncoder().encode(text).length > maxBytes) fail('limit_exceeded', `${what} is too large`);
  try { return JSON.parse(text); } catch { return fail('invalid_json', `${what} is not valid JSON`); }
}
