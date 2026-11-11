import test from 'node:test';
import assert from 'node:assert/strict';
import {safeUrl, isoDate, normalizeDoi, toCsl, toBibtex, toRis} from '../aster/research/metadata.mjs';
const metadata = {title: 'Economic history', authors: ['Ada Lovelace'], issued: [2024, 2, 29],
  url: 'https://example.org/paper', doi: '10.1234/example', website: 'History Review'};
test('calendar dates are validated without inventing missing precision', () => {
  assert.deepEqual(isoDate('2024-02-29T12:00:00Z'), [2024, 2, 29]);
  assert.deepEqual(isoDate('2024'), [2024]);
  assert.deepEqual(isoDate('2024-02'), [2024, 2]);
  for (const date of ['2023-02-29', '2024-13-01', '2024-02-30', '11/12/2024', 'yesterday', '0000', '2024-01-00']) assert.equal(isoDate(date), null);
});
test('URL and DOI policies reject credentials and active content', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://secret@example.org'), '');
  assert.equal(safeUrl('/paper', 'https://example.org/'), 'https://example.org/paper');
  assert.equal(normalizeDoi('https://doi.org/10.1234/example'), '10.1234/example');
  assert.equal(normalizeDoi('10.1234/a}\n@misc{evil}'), '');
});
test('CSL JSON preserves missing fields and literal author names', () => {
  assert.deepEqual(toCsl({}, 'source1'), {id: 'source1', type: 'webpage'});
  const result = toCsl(metadata, 'source1', '2026-11-11');
  assert.deepEqual(result.author, [{literal: 'Ada Lovelace'}]);
  assert.deepEqual(result.issued, {'date-parts': [[2024, 2, 29]]});
  assert.equal(result.publisher, undefined);
  assert.throws(() => toCsl(metadata, 'bad}\n@misc{evil'), /Invalid citation ID/);
});
test('BibTeX exports source information with escaped delimiters', () => {
  const result = toBibtex({...metadata, title: 'A} & B% {C'}, 'source1', '2026-11-11');
  assert.ok(result.includes('title = {A\\} \\& B\\% \\{C}'));
  assert.ok(result.includes('author = {{Ada Lovelace}}'));
  assert.ok(result.includes('year = {2024}'));
  assert.equal((result.match(/@misc/g) || []).length, 1);
});
test('RIS cannot inject a second record through page metadata', () => {
  const result = toRis({...metadata, title: 'Title\r\nER  -\r\nTY  - JOUR'}, 'source1', '2026-11-11');
  assert.equal(result.split('\r\n').filter(line => line.startsWith('TY  -')).length, 1);
  assert.equal(result.split('\r\n').filter(line => line.startsWith('ER  -')).length, 1);
  assert.ok(result.includes('DO  - 10.1234/example'));
});
