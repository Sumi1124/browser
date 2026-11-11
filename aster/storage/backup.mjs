// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
// Versioned, checksummed backups of Aster's local data, with ordered schema
// migrations and a grandfather-father-son retention plan. The checksum
// detects corruption and accidental edits; it is not a signature and the
// file is not encrypted.
import {isPlainObject, assertInstant, canonicalJson, sha256Hex, parseJsonBounded, clean, fail} from '../common/util.mjs';
import {ResearchLibrary} from '../research/library.mjs';
import {Planner} from '../study/planner.mjs';
import {FlashcardCollection} from '../study/flashcards.mjs';
import {BookmarkCollection} from '../research/bookmarks.mjs';

export const BACKUP_FORMAT = 'aster-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_LIMITS = Object.freeze({bytes: 64 * 1024 * 1024, modules: 32});
export const DEFAULT_CODECS = Object.freeze({library: ResearchLibrary, planner: Planner, flashcards: FlashcardCollection, bookmarks: BookmarkCollection});
const MODULE_NAME = /^[a-z][a-z0-9-]{0,31}$/;

const body = envelope => ({format: envelope.format, version: envelope.version, createdAt: envelope.createdAt,
  appVersion: envelope.appVersion, label: envelope.label, modules: envelope.modules});

// `modules` maps a module name to an object with toJSON() (such as a
// Planner) or to plain data. Every module's data must carry an integer schema.
export async function createBackup({modules, createdAt, appVersion, label = ''}) {
  assertInstant(createdAt, 'createdAt');
  if (typeof appVersion !== 'string' || !/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(appVersion)) fail('invalid_backup', 'appVersion must be semantic');
  if (!isPlainObject(modules) || !Object.keys(modules).length) fail('invalid_backup', 'Choose at least one module to back up');
  if (Object.keys(modules).length > BACKUP_LIMITS.modules) fail('limit_exceeded', 'Too many modules');
  const data = {};
  for (const [name, value] of Object.entries(modules)) {
    if (!MODULE_NAME.test(name)) fail('invalid_backup', `Invalid module name: ${name}`);
    const json = value && typeof value.toJSON === 'function' ? value.toJSON() : value;
    if (!isPlainObject(json) || !Number.isInteger(json.schema)) fail('invalid_backup', `Module ${name} has no schema version`);
    data[name] = JSON.parse(JSON.stringify(json));
  }
  const envelope = {format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt, appVersion, label: clean(label, 128), modules: data};
  envelope.checksum = {algorithm: 'SHA-256', value: await sha256Hex(canonicalJson(body(envelope)))};
  const text = JSON.stringify(envelope);
  if (new TextEncoder().encode(text).length > BACKUP_LIMITS.bytes) fail('limit_exceeded', 'Backup is too large');
  return text;
}

// migrations: [{from: 1, to: 2, migrate(envelope) => envelope}], applied in
// order after the checksum is verified. Backups from a newer Aster are
// rejected rather than partially read. Modules without a codec are returned
// unchanged in `unknownModules` so a restore can keep them.
export async function readBackup(text, {migrations = [], codecs = DEFAULT_CODECS, currentVersion = BACKUP_VERSION} = {}) {
  const envelope = parseJsonBounded(text, BACKUP_LIMITS.bytes, 'Backup');
  if (!isPlainObject(envelope) || envelope.format !== BACKUP_FORMAT) fail('invalid_backup', 'Not an Aster backup');
  if (!Number.isInteger(envelope.version) || envelope.version < 1) fail('invalid_backup', 'Invalid backup version');
  if (envelope.version > currentVersion) fail('newer_backup', 'This backup was made by a newer version of Aster');
  if (!isPlainObject(envelope.checksum) || envelope.checksum.algorithm !== 'SHA-256' || typeof envelope.checksum.value !== 'string') {
    fail('invalid_backup', 'Backup has no checksum');
  }
  if (!isPlainObject(envelope.modules)) fail('invalid_backup', 'Backup has no modules');
  let actual;
  try { actual = await sha256Hex(canonicalJson(body(envelope))); } catch { fail('invalid_backup', 'Backup contains unsupported values'); }
  if (actual !== envelope.checksum.value) fail('checksum_mismatch', 'Backup is damaged or was modified');
  assertInstant(envelope.createdAt, 'createdAt');
  let current = structuredClone(body(envelope));
  const migratedFrom = current.version;
  while (current.version < currentVersion) {
    const step = migrations.find(item => item.from === current.version);
    if (!step || step.to !== current.version + 1 || typeof step.migrate !== 'function') {
      fail('no_migration', `No migration from backup version ${current.version}`);
    }
    current = step.migrate(structuredClone(current));
    if (!isPlainObject(current) || current.version !== step.to || !isPlainObject(current.modules)) {
      fail('migration_failed', `Migration to version ${step.to} returned invalid data`);
    }
  }
  const modules = {};
  const unknownModules = {};
  const warnings = [];
  for (const [name, data] of Object.entries(current.modules)) {
    const codec = codecs[name];
    if (!codec) { unknownModules[name] = data; warnings.push(`Module "${name}" is not recognised and was kept unchanged.`); continue; }
    modules[name] = codec.fromJSON(data);
  }
  return {version: currentVersion, migratedFrom: migratedFrom === currentVersion ? null : migratedFrom,
    createdAt: current.createdAt, appVersion: current.appVersion, label: current.label, modules, unknownModules, warnings};
}

export function backupFileName(createdAt) {
  assertInstant(createdAt, 'createdAt');
  return `aster-backup-${new Date(createdAt).toISOString().slice(0, 19).replace(/[-:]/g, '')}Z.json`;
}

// Grandfather-father-son retention: the newest `keepLast` backups, plus the
// newest backup of each of the last `keepDaily` days, `keepWeekly` ISO weeks
// and `keepMonthly` months that have backups. Times are compared in UTC.
export function planRetention(backups, {keepLast = 5, keepDaily = 7, keepWeekly = 4, keepMonthly = 6} = {}) {
  if (!Array.isArray(backups)) fail('invalid_input', 'Backups must be an array');
  for (const value of [keepLast, keepDaily, keepWeekly, keepMonthly]) {
    if (!Number.isInteger(value) || value < 0 || value > 1000) fail('invalid_input', 'Retention counts must be 0–1000');
  }
  if (keepLast + keepDaily + keepWeekly + keepMonthly === 0) fail('invalid_input', 'Retention would remove every backup');
  const ids = new Set();
  const sorted = backups.map(item => {
    if (!isPlainObject(item) || typeof item.id !== 'string' || ids.has(item.id)) fail('invalid_input', 'Each backup needs a unique id');
    ids.add(item.id);
    return {id: item.id, time: Date.parse(assertInstant(item.createdAt, 'createdAt'))};
  }).sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
  const keep = new Set(sorted.slice(0, keepLast).map(item => item.id));
  const bucket = (count, keyOf) => {
    const seen = new Set();
    for (const item of sorted) {
      const key = keyOf(new Date(item.time));
      if (seen.has(key)) continue;
      if (seen.size >= count) break;
      seen.add(key);
      keep.add(item.id);
    }
  };
  const day = date => date.toISOString().slice(0, 10);
  const week = date => {
    const dayNumber = Math.floor(date.getTime() / 86400000);
    return dayNumber - (((dayNumber + 3) % 7) + 7) % 7; // Monday of the ISO week
  };
  const month = date => date.toISOString().slice(0, 7);
  bucket(keepDaily, day);
  bucket(keepWeekly, week);
  bucket(keepMonthly, month);
  return {keep: sorted.filter(item => keep.has(item.id)).map(item => item.id),
    remove: sorted.filter(item => !keep.has(item.id)).map(item => item.id)};
}
