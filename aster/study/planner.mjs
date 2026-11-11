// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
// Local planner for assignments, exams, meetings and recurring tasks, with an
// RFC 5545 (iCalendar) export. Dates are calendar dates without time zones;
// optional times are "floating" local times, as a paper planner would show.
import {clean, cleanMultiline, assertId, isPlainObject, assertLimit, assertDate, parseDate,
  formatDate, fail} from '../common/util.mjs';

export const PLANNER_SCHEMA = 1;
export const PLANNER_LIMITS = Object.freeze({tasks: 5000, completionsPerTask: 2000, occurrences: 5000});
export const CATEGORIES = Object.freeze(['task', 'assignment', 'exam', 'study', 'meeting', 'event']);
export const PRIORITIES = Object.freeze(['low', 'normal', 'high']);
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Monday = 0 … Sunday = 6. Day 0 (1970-01-01) was a Thursday.
const weekday = day => (((day + 3) % 7) + 7) % 7;

function normalizeRecurrence(input, dueDay) {
  if (input === null || input === undefined) return null;
  if (!isPlainObject(input)) fail('invalid_recurrence', 'Recurrence must be an object');
  const freq = input.freq;
  if (!['daily', 'weekly', 'monthly'].includes(freq)) fail('invalid_recurrence', 'Recurrence must be daily, weekly or monthly');
  const interval = input.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) fail('invalid_recurrence', 'Interval must be 1–365');
  const rule = {freq, interval};
  if (input.byDay !== undefined) {
    if (freq !== 'weekly') fail('invalid_recurrence', 'byDay is only supported for weekly recurrence');
    if (!Array.isArray(input.byDay) || !input.byDay.length || !input.byDay.every(day => WEEKDAYS.includes(day))) {
      fail('invalid_recurrence', 'byDay must list weekdays such as MO, WE, FR');
    }
    rule.byDay = WEEKDAYS.filter(day => input.byDay.includes(day));
  }
  if (input.until !== undefined && input.count !== undefined) fail('invalid_recurrence', 'Use until or count, not both');
  if (input.until !== undefined) {
    if (assertDate(input.until, 'recurrence end') < dueDay) fail('invalid_recurrence', 'Recurrence ends before it starts');
    rule.until = input.until;
  }
  if (input.count !== undefined) {
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 1000) fail('invalid_recurrence', 'Count must be 1–1000');
    rule.count = input.count;
  }
  return rule;
}

export function normalizeTask(input) {
  if (!isPlainObject(input)) fail('invalid_task', 'Task must be an object');
  const id = assertId(input.id, 'task ID');
  const title = clean(input.title, 256) || fail('invalid_task', 'Task title is required');
  const dueDay = assertDate(input.due, 'due date');
  const time = input.time ?? null;
  if (time !== null && (typeof time !== 'string' || !TIME.test(time))) fail('invalid_task', 'Time must be HH:MM');
  const durationMinutes = input.durationMinutes ?? (time ? 60 : null);
  if (durationMinutes !== null && (time === null || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)) {
    fail('invalid_task', 'Duration must be 1–1440 minutes and requires a time');
  }
  const category = input.category ?? 'task';
  if (!CATEGORIES.includes(category)) fail('invalid_task', 'Unknown category');
  const priority = input.priority ?? 'normal';
  if (!PRIORITIES.includes(priority)) fail('invalid_task', 'Unknown priority');
  const recurrence = normalizeRecurrence(input.recurrence, dueDay);
  const completed = input.completed ?? [];
  if (!Array.isArray(completed)) fail('invalid_task', 'Completed dates must be an array');
  assertLimit(completed.length, PLANNER_LIMITS.completionsPerTask, 'completed dates');
  completed.forEach(date => assertDate(date, 'completed date'));
  return {
    id, title, notes: cleanMultiline(input.notes ?? '', 8192), due: input.due, time, durationMinutes,
    category, priority, course: clean(input.course ?? '', 128), workspace: clean(input.workspace ?? '', 64),
    recurrence, completed: [...new Set(completed)].sort(),
  };
}

// Yields occurrence day numbers in ascending order, stopping once the
// candidate passes endDay, the rule's `until`, or its `count`.
function* occurrenceDays(task, endDay) {
  const start = parseDate(task.due);
  const rule = task.recurrence;
  if (!rule) { if (start <= endDay) yield start; return; }
  const last = Math.min(endDay, rule.until ? parseDate(rule.until) : Infinity);
  let emitted = 0;
  const emit = day => (rule.count === undefined || emitted++ < rule.count);
  if (rule.freq === 'daily') {
    for (let day = start; day <= last; day += rule.interval) { if (!emit(day)) return; yield day; }
  } else if (rule.freq === 'weekly') {
    const offsets = (rule.byDay || [WEEKDAYS[weekday(start)]]).map(day => WEEKDAYS.indexOf(day));
    for (let monday = start - weekday(start); monday <= last; monday += 7 * rule.interval) {
      for (const offset of offsets) {
        const day = monday + offset;
        if (day < start) continue;
        if (day > last) return;
        if (!emit(day)) return;
        yield day;
      }
    }
  } else {
    const first = new Date(start * 86400000);
    const dayOfMonth = first.getUTCDate();
    for (let step = 0; ; step++) {
      const monthIndex = first.getUTCMonth() + step * rule.interval;
      const year = first.getUTCFullYear() + Math.floor(monthIndex / 12);
      const month = monthIndex % 12;
      if (Date.UTC(year, month, 1) / 86400000 > last) return;
      const candidate = new Date(Date.UTC(year, month, dayOfMonth));
      if (candidate.getUTCMonth() !== month) continue; // e.g. no 31st this month: skipped, as in RFC 5545
      const day = candidate.getTime() / 86400000;
      if (day > last) return;
      if (!emit(day)) return;
      yield day;
    }
  }
}

export function expandOccurrences(task, from, to, {limit = PLANNER_LIMITS.occurrences} = {}) {
  const normalized = normalizeTask(task);
  const fromDay = assertDate(from, 'range start');
  const toDay = assertDate(to, 'range end');
  if (toDay < fromDay) fail('invalid_range', 'Range ends before it starts');
  const done = new Set(normalized.completed);
  const result = [];
  for (const day of occurrenceDays(normalized, toDay)) {
    if (day < fromDay) continue;
    if (result.length >= limit) fail('limit_exceeded', 'Too many occurrences in range; narrow the range');
    const date = formatDate(day);
    result.push({taskId: normalized.id, date, time: normalized.time, title: normalized.title,
      category: normalized.category, priority: normalized.priority, course: normalized.course, done: done.has(date)});
  }
  return result;
}

const isOccurrence = (task, date) => {
  const day = assertDate(date);
  for (const candidate of occurrenceDays(task, day)) if (candidate === day) return true;
  return false;
};

export class Planner {
  #tasks = new Map();

  add(task) {
    const normalized = normalizeTask(task);
    if (this.#tasks.has(normalized.id)) fail('duplicate_id', 'Task already exists');
    assertLimit(this.#tasks.size + 1, PLANNER_LIMITS.tasks, 'tasks');
    this.#tasks.set(normalized.id, normalized);
    return normalized.id;
  }

  update(id, changes) {
    const current = this.#tasks.get(id) || fail('not_found', 'Task not found');
    if (!isPlainObject(changes) || ('id' in changes && changes.id !== id)) fail('invalid_task', 'Task ID cannot change');
    this.#tasks.set(id, normalizeTask({...current, ...changes}));
  }

  remove(id) { if (!this.#tasks.delete(id)) fail('not_found', 'Task not found'); }
  get(id) { const task = this.#tasks.get(id); return task ? structuredClone(task) : null; }
  get tasks() { return [...this.#tasks.values()].map(task => structuredClone(task)); }

  // Marks one occurrence done. For a one-off task the date defaults to its due date.
  complete(id, date) {
    const task = this.#tasks.get(id) || fail('not_found', 'Task not found');
    const target = date ?? task.due;
    if (!isOccurrence(task, target)) fail('invalid_date', 'The task does not occur on that date');
    if (!task.completed.includes(target)) {
      assertLimit(task.completed.length + 1, PLANNER_LIMITS.completionsPerTask, 'completed dates');
      task.completed = [...task.completed, target].sort();
    }
  }

  uncomplete(id, date) {
    const task = this.#tasks.get(id) || fail('not_found', 'Task not found');
    const target = date ?? task.due;
    task.completed = task.completed.filter(value => value !== target);
  }

  occurrences(from, to, {limit = PLANNER_LIMITS.occurrences} = {}) {
    const result = [];
    for (const task of this.#tasks.values()) {
      for (const item of expandOccurrences(task, from, to, {limit})) {
        result.push(item);
        if (result.length > limit) fail('limit_exceeded', 'Too many occurrences in range; narrow the range');
      }
    }
    const rank = {high: 0, normal: 1, low: 2};
    return result.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '')
      || rank[a.priority] - rank[b.priority] || a.taskId.localeCompare(b.taskId));
  }

  // Upcoming work for the next `days` days plus anything still open from the
  // previous `lookbackDays` days, which is reported as overdue.
  agenda(today, {days = 7, lookbackDays = 30} = {}) {
    const todayDay = assertDate(today, 'today');
    if (!Number.isInteger(days) || days < 1 || days > 366 || !Number.isInteger(lookbackDays) || lookbackDays < 0 || lookbackDays > 366) {
      fail('invalid_range', 'Agenda range is out of bounds');
    }
    const overdue = lookbackDays ? this.occurrences(formatDate(todayDay - lookbackDays), formatDate(todayDay - 1))
      .filter(item => !item.done) : [];
    const upcoming = this.occurrences(today, formatDate(todayDay + days - 1));
    return {overdue, upcoming};
  }

  toJSON() { return {schema: PLANNER_SCHEMA, tasks: this.tasks}; }

  static fromJSON(data) {
    if (!isPlainObject(data) || data.schema !== PLANNER_SCHEMA || !Array.isArray(data.tasks)) {
      fail('unsupported_schema', 'Unsupported planner data');
    }
    assertLimit(data.tasks.length, PLANNER_LIMITS.tasks, 'tasks');
    const planner = new Planner();
    for (const task of data.tasks) planner.add(task);
    return planner;
  }
}

// ---- iCalendar export ---------------------------------------------------

const escapeText = value => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

// Folds content lines at 75 octets without splitting UTF-8 sequences.
function fold(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const max = parts.length ? 74 : 75;
    if (bytes + size > max) { parts.push(current); current = ''; bytes = 0; }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const compactDate = date => date.replace(/-/g, '');
function localDateTime(date, time, plusMinutes = 0) {
  const [hours, minutes] = time.split(':').map(Number);
  const value = new Date(parseDate(date) * 86400000 + (hours * 60 + minutes + plusMinutes) * 60000);
  return value.toISOString().slice(0, 19).replace(/[-:]/g, '');
}

function rrule(task) {
  const rule = task.recurrence;
  const parts = [`FREQ=${rule.freq.toUpperCase()}`, `INTERVAL=${rule.interval}`];
  if (rule.byDay) parts.push(`BYDAY=${rule.byDay.join(',')}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  // UNTIL must match DTSTART's value type: a DATE for all-day items, a local
  // DATE-TIME for timed items.
  if (rule.until) parts.push(`UNTIL=${task.time ? `${compactDate(rule.until)}T235959` : compactDate(rule.until)}`);
  return parts.join(';');
}

// `now` must be a UTC ISO-8601 timestamp; it becomes DTSTAMP. Completed
// one-off tasks are skipped unless includeCompleted is true.
export function toIcs(tasks, {now, calendarName = 'Aster Planner', includeCompleted = false} = {}) {
  if (typeof now !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(now) || Number.isNaN(Date.parse(now))) {
    fail('invalid_timestamp', 'now must be a UTC ISO-8601 timestamp');
  }
  const stamp = new Date(now).toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Aster//Planner 1//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(clean(calendarName, 128) || 'Aster Planner')}`];
  for (const input of tasks) {
    const task = normalizeTask(input);
    if (!task.recurrence && task.completed.includes(task.due) && !includeCompleted) continue;
    lines.push('BEGIN:VEVENT', `UID:${task.id}@planner.aster`, `DTSTAMP:${stamp}`);
    if (task.time) {
      lines.push(`DTSTART:${localDateTime(task.due, task.time)}`, `DTEND:${localDateTime(task.due, task.time, task.durationMinutes)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(task.due)}`, `DTEND;VALUE=DATE:${compactDate(formatDate(parseDate(task.due) + 1))}`);
    }
    lines.push(`SUMMARY:${escapeText(task.title)}`);
    const description = [task.course && `Course: ${task.course}`, task.notes].filter(Boolean).join('\n');
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    lines.push(`CATEGORIES:${task.category.toUpperCase()}`, `PRIORITY:${{high: 1, normal: 5, low: 9}[task.priority]}`);
    if (task.recurrence) lines.push(`RRULE:${rrule(task)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

