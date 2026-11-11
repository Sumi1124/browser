import test from 'node:test';
import assert from 'node:assert/strict';
import {FlashcardCollection, newCard, scheduleReview} from '../aster/study/flashcards.mjs';
import {parseDelimited, parseJsonRecords, detectDelimiter, parseNumber, inferColumns, numericColumn, describe,
  frequencies, linearRegression, cleanTable} from '../aster/data/dataset.mjs';
import {renderChartSvg, tableToCsv, niceTicks} from '../aster/data/chart.mjs';

test('SM-2 scheduling', () => {
  let card = newCard({id: 'c1', front: 'Mitochondria?', back: 'Powerhouse of the cell', created: '2026-11-01'});
  card = scheduleReview(card, 5, '2026-11-01');
  assert.deepEqual([card.interval, card.repetitions, card.due, card.ease], [1, 1, '2026-11-02', 2.6]);
  card = scheduleReview(card, 4, '2026-11-02');
  assert.deepEqual([card.interval, card.due, card.ease], [6, '2026-11-08', 2.6]);
  card = scheduleReview(card, 3, '2026-11-08');
  assert.deepEqual([card.interval, card.due, card.ease], [16, '2026-11-24', 2.46]);
  const lapsed = scheduleReview(card, 1, '2026-11-24');
  assert.deepEqual([lapsed.interval, lapsed.repetitions, lapsed.lapses, lapsed.ease], [1, 0, 1, 2.46]);
  let hard = card;
  for (let i = 0; i < 20; i++) hard = scheduleReview(hard, 3, '2026-11-24');
  assert.equal(hard.ease, 1.3);
  assert.throws(() => scheduleReview(card, 6, '2026-11-24'), /0–5/);
  assert.equal(card.history.length, 3);
});

test('flashcard collection: import, due queue, stats, persistence', () => {
  const cards = new FlashcardCollection();
  const {added, skipped} = cards.importRows([['Q1', 'A1'], ['', 'no front'], ['Q2', 'A2'], 'bad'], {prefix: 'bio', deck: 'Biology', created: '2026-11-01'});
  assert.deepEqual(added, ['bio-1', 'bio-2']);
  assert.deepEqual(skipped, [1, 3]);
  cards.add({id: 'chem-1', front: 'pH 7?', back: 'Neutral', deck: 'Chemistry', created: '2026-11-05'});
  assert.deepEqual(cards.decks, ['Biology', 'Chemistry']);
  assert.deepEqual(cards.due('2026-11-02').map(card => card.id), ['bio-1', 'bio-2']);
  cards.review('bio-1', 5, '2026-11-02');
  cards.review('bio-2', 1, '2026-11-02');
  // Equally overdue cards are ordered hardest (lowest ease) first.
  assert.deepEqual(cards.due('2026-11-03', {deck: 'Biology'}).map(card => card.id), ['bio-2', 'bio-1']);
  const stats = cards.stats('2026-11-02');
  assert.deepEqual(stats, {total: 3, new: 1, due: 0, learned: 0, reviewedToday: 2, retention: 0.5});
  cards.edit('chem-1', {back: 'Neutral at 25 °C'});
  assert.equal(cards.get('chem-1').back, 'Neutral at 25 °C');
  const restored = FlashcardCollection.fromJSON(JSON.parse(JSON.stringify(cards.toJSON())));
  assert.deepEqual(restored.toJSON(), cards.toJSON());
  const broken = cards.toJSON();
  broken.cards[0].ease = 0.5;
  assert.throws(() => FlashcardCollection.fromJSON(broken), /ease/);
});

test('CSV parsing follows RFC 4180 and reports ragged rows', () => {
  const csv = '﻿name,score,notes\r\n"Lee, A",91.5,"said ""hi""\nthen left"\r\nKim,,\r\nPark,77\r\n';
  const table = parseDelimited(csv);
  assert.deepEqual(table.columns, ['name', 'score', 'notes']);
  assert.deepEqual(table.rows[0], ['Lee, A', '91.5', 'said "hi"\nthen left']);
  assert.deepEqual(table.rows[2], ['Park', '77', '']);
  assert.equal(table.warnings.length, 1);
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a;b\n"1;2";3'), ';');
  assert.deepEqual(parseDelimited('x,x,\n1,2,3').columns, ['x', 'x_2', 'Column 3']);
  assert.throws(() => parseDelimited('a,b\n"open,2'), /not closed/);
  assert.deepEqual(parseDelimited('1,2\n3,4', {header: false}).columns, ['Column 1', 'Column 2']);
});

test('JSON records, strict numbers and type inference', () => {
  const table = parseJsonRecords('[{"year":2020,"ok":true,"tags":["a"]},{"year":"2021","date":"2021-03-04"}]');
  assert.deepEqual(table.columns, ['year', 'ok', 'tags', 'date']);
  assert.deepEqual(table.rows[1], ['2021', '', '', '2021-03-04']);
  assert.equal(table.warnings.length, 1);
  assert.throws(() => parseJsonRecords('{"a":1}'), /array/);
  for (const [input, expected] of [['1e3', 1000], ['-.5', -0.5], ['1,000', null], ['12%', null], ['0x10', null], ['Infinity', null], ['', null]]) {
    assert.equal(parseNumber(input), expected, input);
  }
  const types = inferColumns(table).map(column => [column.name, column.type, column.missing]);
  assert.deepEqual(types, [['year', 'number', 0], ['ok', 'boolean', 1], ['tags', 'text', 1], ['date', 'date', 1]]);
});

test('descriptive statistics and regression', () => {
  const stats = describe([2, 4, 4, 4, 5, 5, 7, 9, null]);
  assert.equal(stats.count, 8);
  assert.equal(stats.missing, 1);
  assert.equal(stats.mean, 5);
  assert.equal(stats.median, 4.5);
  assert.ok(Math.abs(stats.sd - 2.138089935) < 1e-9);
  assert.deepEqual([stats.q1, stats.q3, stats.min, stats.max], [4, 5.5, 2, 9]);
  assert.equal(describe([null]).mean, null);
  const fit = linearRegression([1, 2, 3, 4, 5, null], [2.1, 3.9, 6.2, 7.8, 10.1, 99]);
  assert.equal(fit.n, 5);
  assert.ok(Math.abs(fit.slope - 1.99) < 1e-9);
  assert.ok(Math.abs(fit.intercept - 0.05) < 1e-9);
  assert.ok(fit.r2 > 0.99);
  assert.throws(() => linearRegression([1, 1], [2, 3]), /no variation/);
  assert.throws(() => linearRegression([1], [2]), /two complete/);
  const table = {columns: ['g', 'v'], rows: [['a', '1'], [' b ', 'x'], ['', ''], ['a', '1'], ['b', 'NA']]};
  const {table: cleaned, report} = cleanTable(table, {dropDuplicateRows: true});
  assert.deepEqual(report, {trimmedCells: 1, emptyRowsRemoved: 1, duplicateRowsRemoved: 1});
  assert.deepEqual(numericColumn(cleaned, 'v'), [1, null, null]);
  assert.deepEqual(frequencies(cleaned, 'g'), {items: [{value: 'b', count: 2}, {value: 'a', count: 1}], distinct: 2, missing: 0});
});

test('SVG charts escape data and contain no active content', () => {
  assert.deepEqual(niceTicks(0, 7), [0, 2, 4, 6, 8]);
  assert.deepEqual(niceTicks(-3, 12), [-5, 0, 5, 10, 15]);
  const svg = renderChartSvg({type: 'bar', title: '<script>alert(1)</script>', categories: ['A&B', 'C'],
    series: [{name: 'onload="x"', values: [3, -2]}, {name: 'Two', values: [null, 5]}], yLabel: 'Score'});
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(!/<script|javascript:|\son\w+=|href=/i.test(svg));
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(svg.includes('A&amp;B'));
  assert.equal((svg.match(/<rect [^>]*stroke="none"/g) || []).length, 3);
  const scatter = renderChartSvg({type: 'scatter', series: [{name: 'Trial', points: [[1, 2], [2, 4], [3, null]]}], trendline: {slope: 2, intercept: 0}});
  assert.equal((scatter.match(/<circle/g) || []).length, 2);
  assert.ok(scatter.includes('stroke-dasharray'));
  const line = renderChartSvg({type: 'line', categories: ['Mon', 'Tue', 'Wed'], series: [{name: 'Hours', values: [1, null, 3]}]});
  assert.ok(/d="M[\d.]+ [\d.]+ M/.test(line));
  assert.throws(() => renderChartSvg({type: 'pie', series: []}), /bar, line or scatter/);
  assert.throws(() => renderChartSvg({type: 'bar', categories: ['a'], series: [{values: [Infinity]}]}), /finite/);
  assert.throws(() => renderChartSvg({type: 'bar', categories: ['a', 'b'], series: [{values: [1]}]}), /one value per category/);
});

test('CSV export neutralizes spreadsheet formulas but keeps negative numbers', () => {
  const csv = tableToCsv({columns: ['a', 'b'], rows: [['=HYPERLINK("x")', '-5'], ['@SUM(A1)', 'x,y'], ['+1+1', ' pad'], ['-1.5e3', null]]});
  assert.equal(csv, 'a,b\r\n"\'=HYPERLINK(""x"")",-5\r\n\'@SUM(A1),"x,y"\r\n\'+1+1," pad"\r\n-1.5e3,\r\n');
});
