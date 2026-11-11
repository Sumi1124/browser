import test from 'node:test';
import assert from 'node:assert/strict';
import {Planner, expandOccurrences, normalizeTask, toIcs} from '../aster/study/planner.mjs';

const dates = (task, from, to) => expandOccurrences(task, from, to).map(item => item.date);

test('tasks are validated', () => {
  assert.throws(() => normalizeTask({id: 't', title: 'X', due: '2026-02-30'}), /due date/);
  assert.throws(() => normalizeTask({id: 't', title: '', due: '2026-02-01'}), /title/);
  assert.throws(() => normalizeTask({id: 't', title: 'X', due: '2026-02-01', time: '24:00'}), /HH:MM/);
  assert.throws(() => normalizeTask({id: 't', title: 'X', due: '2026-02-01', durationMinutes: 30}), /requires a time/);
  assert.throws(() => normalizeTask({id: 't', title: 'X', due: '2026-02-01', recurrence: {freq: 'yearly'}}), /daily, weekly/);
  assert.throws(() => normalizeTask({id: 't', title: 'X', due: '2026-02-01', recurrence: {freq: 'daily', until: '2026-01-01'}}), /ends before/);
  assert.throws(() => normalizeTask({id: 't', title: 'X', due: '2026-02-01', recurrence: {freq: 'daily', until: '2026-03-01', count: 2}}), /not both/);
  assert.equal(normalizeTask({id: 't', title: 'X', due: '2026-02-01', time: '09:30'}).durationMinutes, 60);
});

test('daily, weekly and monthly recurrence', () => {
  const base = {id: 't', title: 'Practice', due: '2026-11-02'}; // Monday
  assert.deepEqual(dates({...base, recurrence: {freq: 'daily', interval: 2, count: 3}}, '2026-11-01', '2026-12-31'),
    ['2026-11-02', '2026-11-04', '2026-11-06']);
  assert.deepEqual(dates({...base, recurrence: {freq: 'weekly'}}, '2026-11-01', '2026-11-20'), ['2026-11-02', '2026-11-09', '2026-11-16']);
  assert.deepEqual(dates({...base, due: '2026-11-04', recurrence: {freq: 'weekly', interval: 2, byDay: ['FR', 'MO', 'WE']}}, '2026-11-01', '2026-11-30'),
    ['2026-11-04', '2026-11-06', '2026-11-16', '2026-11-18', '2026-11-20', '2026-11-30']);
  // A month without a 31st is skipped, as RFC 5545 specifies.
  assert.deepEqual(dates({...base, due: '2026-01-31', recurrence: {freq: 'monthly'}}, '2026-01-01', '2026-06-30'),
    ['2026-01-31', '2026-03-31', '2026-05-31']);
  assert.deepEqual(dates({...base, due: '2024-02-29', recurrence: {freq: 'monthly', interval: 12}}, '2024-01-01', '2032-12-31'),
    ['2024-02-29', '2028-02-29', '2032-02-29']);
  assert.deepEqual(dates({...base, recurrence: {freq: 'weekly', until: '2026-11-16'}}, '2026-11-01', '2027-01-01'), ['2026-11-02', '2026-11-09', '2026-11-16']);
  // `count` includes occurrences before the requested range.
  assert.deepEqual(dates({...base, recurrence: {freq: 'daily', count: 5}}, '2026-11-05', '2026-11-30'), ['2026-11-05', '2026-11-06']);
  assert.throws(() => expandOccurrences({...base, recurrence: {freq: 'daily'}}, '2026-01-01', '2050-01-01', {limit: 100}), /narrow the range/);
});

test('planner completion, agenda and overdue items', () => {
  const planner = new Planner();
  planner.add({id: 'essay', title: 'History IA draft', due: '2026-11-10', category: 'assignment', priority: 'high', course: 'History HL'});
  planner.add({id: 'vocab', title: 'Vocabulary', due: '2026-11-09', time: '18:00', recurrence: {freq: 'daily'}});
  planner.add({id: 'exam', title: 'Maths paper 1', due: '2026-11-13', time: '09:00', category: 'exam'});
  assert.throws(() => planner.add({id: 'exam', title: 'Dup', due: '2026-11-13'}), /already exists/);
  planner.complete('vocab', '2026-11-09');
  assert.throws(() => planner.complete('exam', '2026-11-14'), /does not occur/);
  const {overdue, upcoming} = planner.agenda('2026-11-11', {days: 3, lookbackDays: 3});
  assert.deepEqual(overdue.map(item => `${item.taskId}@${item.date}`), ['essay@2026-11-10', 'vocab@2026-11-10']);
  assert.deepEqual(upcoming.map(item => `${item.taskId}@${item.date}`),
    ['vocab@2026-11-11', 'vocab@2026-11-12', 'exam@2026-11-13', 'vocab@2026-11-13']);
  planner.complete('essay');
  assert.equal(planner.agenda('2026-11-11', {days: 1, lookbackDays: 3}).overdue.some(item => item.taskId === 'essay'), false);
  planner.uncomplete('essay');
  planner.update('essay', {due: '2026-11-20'});
  assert.equal(planner.get('essay').due, '2026-11-20');
  assert.throws(() => planner.update('essay', {id: 'other'}), /cannot change/);
  const restored = Planner.fromJSON(JSON.parse(JSON.stringify(planner.toJSON())));
  assert.deepEqual(restored.toJSON(), planner.toJSON());
  assert.throws(() => Planner.fromJSON({schema: 2, tasks: []}), /Unsupported/);
});

test('iCalendar export escapes text, folds lines and encodes recurrence', () => {
  const ics = toIcs([
    {id: 'a', title: 'Essay; draft, v2', due: '2026-11-20', notes: 'Line one\nLine two \\ end', course: 'English A'},
    {id: 'b', title: 'Lab', due: '2026-11-16', time: '23:30', durationMinutes: 90, recurrence: {freq: 'weekly', byDay: ['MO', 'TH'], until: '2026-12-17'}},
    {id: 'c', title: 'Done', due: '2026-11-01', completed: ['2026-11-01']},
    {id: 'd', title: 'Ünïcödé '.repeat(20), due: '2026-11-21', recurrence: {freq: 'monthly', count: 3}},
  ], {now: '2026-11-11T12:00:00Z'});
  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(lines.includes('SUMMARY:Essay\\; draft\\, v2'));
  assert.ok(lines.includes('DESCRIPTION:Course: English A\\nLine one\\nLine two \\\\ end'));
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20261120'));
  assert.ok(lines.includes('DTEND;VALUE=DATE:20261121'));
  assert.ok(lines.includes('DTSTART:20261116T233000'));
  assert.ok(lines.includes('DTEND:20261117T010000'));
  assert.ok(lines.includes('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;UNTIL=20261217T235959'));
  assert.ok(lines.includes('RRULE:FREQ=MONTHLY;INTERVAL=1;COUNT=3'));
  assert.ok(lines.includes('DTSTAMP:20261111T120000Z'));
  assert.ok(!ics.includes('UID:c@'));
  const encoder = new TextEncoder();
  for (const line of lines) assert.ok(encoder.encode(line).length <= 75, `line too long: ${line}`);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes(`SUMMARY:${'Ünïcödé '.repeat(20).trim()}`));
  assert.throws(() => toIcs([], {now: '2026-11-11'}), /UTC/);
});
