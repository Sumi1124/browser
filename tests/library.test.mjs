import test from 'node:test';
import assert from 'node:assert/strict';
import {ResearchLibrary, normalizeUrlForMatch, titleFingerprint, sanitizeMetadata, mergeMissingFields,
  LIBRARY_SCHEMA} from '../aster/research/library.mjs';

const at = '2026-11-11T10:00:00Z';
const paper = {title: 'The Economic History of Railways', authors: ['Ada Lovelace'], issued: [2024, 2, 29],
  url: 'https://www.example.org/paper/?utm_source=x&b=2&a=1#section', doi: '10.1234/Example', website: 'History Review'};

test('URL matching ignores tracking, scheme, www, fragment, order and trailing slash', () => {
  assert.equal(normalizeUrlForMatch(paper.url), 'example.org/paper?a=1&b=2');
  assert.equal(normalizeUrlForMatch('http://example.org/paper?b=2&a=1'), 'example.org/paper?a=1&b=2');
  assert.equal(normalizeUrlForMatch('https://example.org/'), 'example.org');
  assert.equal(normalizeUrlForMatch('javascript:alert(1)'), '');
  assert.equal(titleFingerprint('Café — Économie!'), 'cafeeconomie');
});

test('sanitizeMetadata drops unknown fields and never invents values', () => {
  const result = sanitizeMetadata({title: ' A\u0000 title ', issued: [2023, 2, 29], extra: '<script>', authors: ['X', 'X', '']});
  assert.deepEqual(result, {title: 'A title', authors: ['X'], issued: null, website: '', publisher: '', url: '', doi: ''});
  assert.throws(() => sanitizeMetadata({authors: ['Only author']}), /title, URL or DOI/);
});

test('duplicate sources are detected by DOI, URL and title', () => {
  const library = new ResearchLibrary();
  assert.deepEqual(library.addSource({id: 's1', metadata: paper, addedAt: at}), {added: true, id: 's1'});
  const byDoi = library.addSource({id: 's2', metadata: {title: 'Other', doi: 'https://doi.org/10.1234/example'}, addedAt: at});
  assert.deepEqual(byDoi, {added: false, duplicateOf: 's1', reason: 'doi', confidence: 'exact'});
  const byUrl = library.addSource({id: 's3', metadata: {title: 'Other', url: 'http://example.org/paper?a=1&b=2'}, addedAt: at});
  assert.equal(byUrl.reason, 'url');
  const byTitle = library.addSource({id: 's4', metadata: {title: 'The economic history of railways.', authors: ['Lady Ada Lovelace'], issued: [2024]}, addedAt: at});
  assert.deepEqual([byTitle.reason, byTitle.confidence], ['title', 'likely']);
  // Short titles are never matched on title alone.
  assert.equal(library.addSource({id: 's5', metadata: {title: 'Intro'}, addedAt: at}).added, true);
  assert.equal(library.addSource({id: 's6', metadata: {title: 'Intro'}, addedAt: at}).added, true);
  assert.equal(library.addSource({id: 's7', metadata: {doi: '10.1234/example'}, addedAt: at, allowDuplicate: true}).added, true);
  assert.equal(library.size, 4);
});

test('mergeMissingFields fills gaps and reports conflicts without overwriting', () => {
  const {metadata, filled, conflicts} = mergeMissingFields({title: 'A long enough title', url: 'https://a.org/x'},
    {title: 'A different title', publisher: 'Press', url: 'https://a.org/x'});
  assert.equal(metadata.title, 'A long enough title');
  assert.equal(metadata.publisher, 'Press');
  assert.deepEqual(filled, ['publisher']);
  assert.deepEqual(conflicts.map(item => item.field), ['title']);
});

test('folders, tags, annotations and queries', () => {
  const library = new ResearchLibrary();
  library.addFolder({id: 'ee', name: 'Extended Essay'});
  library.addFolder({id: 'ee-ch1', name: 'Chapter 1', parentId: 'ee'});
  assert.throws(() => library.addFolder({id: 'dup', name: 'chapter 1', parentId: 'ee'}), /already exists/);
  assert.throws(() => library.addFolder({id: 'x', name: 'X', parentId: 'missing'}), /Parent folder/);
  library.addFolder({id: 'ee-ch2', name: 'Chapter 2', parentId: 'ee'});
  assert.throws(() => library.renameFolder('ee-ch2', 'CHAPTER 1'), /already exists/);
  library.renameFolder('ee-ch2', 'Chapter 2: Sources');
  library.removeFolder('ee-ch2');
  library.addSource({id: 'a', metadata: paper, folderId: 'ee-ch1', tags: ['Primary', 'primary', ' rail '], addedAt: '2026-11-11T10:00:00Z'});
  library.addSource({id: 'b', metadata: {title: 'Steam engines and society', authors: ['Grace Hopper']}, folderId: 'ee', addedAt: '2026-11-10T10:00:00Z'});
  library.addSource({id: 'c', metadata: {url: 'https://unfiled.example/'}, addedAt: '2026-11-12T10:00:00Z'});
  assert.deepEqual(library.getSource('a').tags, ['primary', 'rail']);
  assert.deepEqual(library.query({folderId: 'ee'}).map(s => s.id), ['b']);
  assert.deepEqual(library.query({folderId: 'ee', includeSubfolders: true}).map(s => s.id), ['b', 'a']);
  assert.deepEqual(library.query({folderId: null}).map(s => s.id), ['c']);
  assert.deepEqual(library.query({tag: 'PRIMARY'}).map(s => s.id), ['a']);
  assert.deepEqual(library.query({text: 'hopper'}).map(s => s.id), ['b']);
  assert.deepEqual(library.allTags(), [{tag: 'primary', count: 1}, {tag: 'rail', count: 1}]);
  library.addAnnotation({id: 'n1', sourceId: 'a', quote: 'Railways changed\r\ntrade.', note: 'Use in intro', createdAt: at});
  assert.equal(library.annotationsFor('a')[0].quote, 'Railways changed\ntrade.');
  assert.throws(() => library.addAnnotation({id: 'n2', sourceId: 'a', createdAt: at}), /quote or a note/);
  assert.throws(() => library.removeFolder('ee'), /contents first/);
  library.removeSource('a');
  assert.deepEqual(library.annotationsFor('a'), []);
  // Removing a source frees its DOI for a new record.
  assert.equal(library.addSource({id: 'a2', metadata: {doi: '10.1234/example'}, addedAt: at}).added, true);
});

test('bibliography exports reject unknown sources and support three formats', () => {
  const library = new ResearchLibrary();
  library.addSource({id: 'a', metadata: paper, addedAt: at});
  const csl = JSON.parse(library.exportBibliography(['a'], 'csl-json', '2026-11-11'));
  assert.equal(csl[0].DOI, '10.1234/Example');
  assert.match(library.exportBibliography(['a'], 'bibtex'), /^@misc\{a,/);
  assert.match(library.exportBibliography(['a'], 'ris'), /^TY {2}- ELEC/);
  assert.throws(() => library.exportBibliography(['a', 'zz'], 'ris'), /Source not found: zz/);
  assert.throws(() => library.exportBibliography(['a'], 'docx'), /Unsupported/);
});

test('serialization round-trips and rejects inconsistent data', () => {
  const library = new ResearchLibrary();
  library.addFolder({id: 'p', name: 'Parent'});
  library.addFolder({id: 'c', name: 'Child', parentId: 'p'});
  library.addSource({id: 'a', metadata: paper, folderId: 'c', tags: ['x'], addedAt: at});
  library.addAnnotation({id: 'n', sourceId: 'a', note: 'Note', createdAt: at});
  const json = library.toJSON();
  assert.equal(json.schema, LIBRARY_SCHEMA);
  const reversed = {...json, folders: [...json.folders].reverse()};
  assert.deepEqual(ResearchLibrary.fromJSON(JSON.parse(JSON.stringify(reversed))).toJSON().sources, json.sources);
  assert.throws(() => ResearchLibrary.fromJSON({...json, schema: 99}), /Unsupported/);
  assert.throws(() => ResearchLibrary.fromJSON({...json, folders: [{id: 'a', name: 'A', parentId: 'b'}, {id: 'b', name: 'B', parentId: 'a'}]}), /inconsistent/);
  assert.throws(() => ResearchLibrary.fromJSON({...json, annotations: [{id: 'n', sourceId: 'missing', note: 'x', createdAt: at}]}), /Source not found/);
  assert.throws(() => ResearchLibrary.fromJSON({...json, sources: [{...json.sources[0], folderId: 'gone'}]}), /Folder not found/);
});
