import test from 'node:test';
import assert from 'node:assert/strict';
import {AsterError} from '../aster/common/util.mjs';
import {ResearchLibrary} from '../aster/research/library.mjs';
import {Planner} from '../aster/study/planner.mjs';
import {FlashcardCollection} from '../aster/study/flashcards.mjs';
import {BookmarkCollection} from '../aster/research/bookmarks.mjs';
import {parseDelimited, parseJsonRecords} from '../aster/data/dataset.mjs';
import {readBackup} from '../aster/storage/backup.mjs';

// Deterministic PRNG so failures are reproducible.
function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}
const junk = [null, undefined, 0, -1, 1.5, NaN, '', 'x', '2026-02-30', [], {}, [null], {__proto__: null}, true, 'a'.repeat(5000)];

function mutate(value, random) {
  const copy = structuredClone(value);
  const paths = [];
  const walk = (node, path) => {
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) { paths.push([...path, key]); walk(node[key], [...path, key]); }
    }
  };
  walk(copy, []);
  const path = paths[Math.floor(random() * paths.length)];
  let parent = copy;
  for (const key of path.slice(0, -1)) parent = parent[key];
  const last = path[path.length - 1];
  if (random() < 0.2 && !Array.isArray(parent)) delete parent[last];
  else parent[last] = junk[Math.floor(random() * junk.length)];
  return copy;
}

function sampleData() {
  const library = new ResearchLibrary();
  library.addFolder({id: 'f', name: 'F'});
  library.addSource({id: 's', metadata: {title: 'A sufficiently long title', authors: ['A B'], issued: [2020, 1], url: 'https://e.org/x', doi: '10.1000/x'},
    folderId: 'f', tags: ['t'], addedAt: '2026-11-11T10:00:00Z'});
  library.addAnnotation({id: 'n', sourceId: 's', quote: 'q', createdAt: '2026-11-11T10:00:00Z'});
  const planner = new Planner();
  planner.add({id: 't', title: 'T', due: '2026-11-11', time: '09:00', recurrence: {freq: 'weekly', byDay: ['MO'], count: 3}, completed: ['2026-11-16']});
  const cards = new FlashcardCollection();
  cards.add({id: 'c', front: 'F', back: 'B', created: '2026-11-11'});
  cards.review('c', 4, '2026-11-11');
  const marks = new BookmarkCollection();
  marks.addFolder({id: 'f', name: 'F'});
  marks.add({id: 'm', url: 'https://example.org/', title: 'E', folderId: 'f', addedAt: '2026-11-11T10:00:00Z'});
  return [[ResearchLibrary, library.toJSON()], [Planner, planner.toJSON()], [FlashcardCollection, cards.toJSON()], [BookmarkCollection, marks.toJSON()]];
}

test('corrupted stored data fails with AsterError, never a crash', () => {
  const random = rng(20261111);
  for (const [codec, data] of sampleData()) {
    for (let i = 0; i < 3000; i++) {
      const corrupted = mutate(data, random);
      try { codec.fromJSON(corrupted); } catch (error) {
        assert.ok(error instanceof AsterError, `${codec.name}: ${error?.stack}\n${JSON.stringify(corrupted)}`);
      }
    }
  }
});

test('random bytes never crash the dataset parsers', () => {
  const random = rng(7);
  const alphabet = 'ab1,;\t|"\r\n ."[]{}:\\';
  for (let i = 0; i < 3000; i++) {
    const text = Array.from({length: Math.floor(random() * 80)}, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
    for (const parse of [parseDelimited, parseJsonRecords]) {
      try {
        const table = parse(text);
        assert.ok(table.rows.every(row => row.length === table.columns.length));
      } catch (error) {
        assert.ok(error instanceof AsterError, `${parse.name}(${JSON.stringify(text)}): ${error?.stack}`);
      }
    }
  }
});

test('truncated or flipped backups are rejected cleanly', async () => {
  const {createBackup} = await import('../aster/storage/backup.mjs');
  const [[, library], [, planner]] = sampleData();
  const text = await createBackup({modules: {library, planner}, createdAt: '2026-11-11T12:00:00Z', appVersion: '1.0.0'});
  const random = rng(99);
  for (let i = 0; i < 300; i++) {
    const position = Math.floor(random() * text.length);
    const variant = random() < 0.5 ? text.slice(0, position)
      : text.slice(0, position) + String.fromCharCode(32 + Math.floor(random() * 90)) + text.slice(position + 1);
    if (variant === text) continue;
    await assert.rejects(readBackup(variant), error => error instanceof AsterError);
  }
});

test('pure-JavaScript SHA-256 matches Node crypto', async () => {
  const {sha256HexSync} = await import('../aster/common/util.mjs');
  const {createHash} = await import('node:crypto');
  const random = rng(3);
  const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'Ünïcödé ✓ 日本語', 'x'.repeat(100000)];
  for (let i = 0; i < 200; i++) inputs.push(Array.from({length: Math.floor(random() * 300)}, () => String.fromCharCode(Math.floor(random() * 0x3000))).join(''));
  for (const input of inputs) assert.equal(sha256HexSync(input), createHash('sha256').update(input, 'utf8').digest('hex'));
});
