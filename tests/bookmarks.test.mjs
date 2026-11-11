import test from 'node:test';
import assert from 'node:assert/strict';
import {BookmarkCollection, bookmarkKey, parseNetscapeHtml} from '../aster/research/bookmarks.mjs';

const at = '2026-11-11T10:00:00Z';
let counter = 0;
const makeId = () => `b${++counter}`;

test('bookmark keys ignore fragments and trailing slashes only', () => {
  assert.equal(bookmarkKey('https://example.org/'), 'https://example.org');
  assert.equal(bookmarkKey('https://example.org/a/#top'), 'https://example.org/a');
  assert.notEqual(bookmarkKey('https://example.org/a?x=1'), bookmarkKey('https://example.org/a?x=2'));
  assert.equal(bookmarkKey('javascript:alert(1)'), '');
});

test('add, find, update, folders and duplicates', () => {
  const marks = new BookmarkCollection();
  assert.deepEqual(marks.add({id: 'a', url: 'https://example.org/notes', title: ' Class notes ', addedAt: at}), {added: true, id: 'a'});
  assert.deepEqual(marks.add({id: 'b', url: 'https://example.org/notes/#part-2', addedAt: at}), {added: false, existingId: 'a'});
  assert.throws(() => marks.add({id: 'c', url: 'javascript:alert(1)', addedAt: at}), /http and https/);
  assert.throws(() => marks.add({id: 'c', url: 'file:///etc/passwd', addedAt: at}), /http and https/);
  marks.add({id: 'c', url: 'https://ibo.org/', addedAt: at});
  assert.equal(marks.get('c').title, 'ibo.org', 'missing titles fall back to the host name');
  marks.addFolder({id: 'f', name: 'School'});
  assert.throws(() => marks.addFolder({id: 'g', name: 'school'}), /already exists/);
  marks.update('a', {folderId: 'f', title: 'Biology notes'});
  assert.throws(() => marks.update('c', {url: 'https://example.org/notes'}), /already bookmarked/);
  assert.deepEqual(marks.list({folderId: 'f'}).map(b => b.id), ['a']);
  assert.deepEqual(marks.list({folderId: null}).map(b => b.id), ['c']);
  assert.deepEqual(marks.list({text: 'BIO'}).map(b => b.id), ['a']);
  assert.equal(marks.find('https://example.org/notes#x').id, 'a');
  marks.removeFolder('f');
  assert.equal(marks.get('a').folderId, null, 'removing a folder keeps its bookmarks');
  marks.remove('a');
  assert.equal(marks.find('https://example.org/notes'), null);
});

test('serialization round-trips and rejects bad data', () => {
  const marks = new BookmarkCollection();
  marks.addFolder({id: 'f', name: 'Research'});
  marks.add({id: 'a', url: 'https://example.org/a', title: 'A', folderId: 'f', addedAt: at});
  const json = JSON.parse(JSON.stringify(marks.toJSON()));
  assert.deepEqual(BookmarkCollection.fromJSON(json).toJSON(), json);
  assert.throws(() => BookmarkCollection.fromJSON({...json, schema: 2}), /Unsupported/);
  assert.throws(() => BookmarkCollection.fromJSON({...json, bookmarks: [...json.bookmarks, {...json.bookmarks[0], id: 'z'}]}), /Duplicate/);
  assert.throws(() => BookmarkCollection.fromJSON({...json, bookmarks: [{...json.bookmarks[0], url: 'javascript:x'}]}), /http and https/);
});

test('Netscape export escapes text and imports back identically', () => {
  const marks = new BookmarkCollection();
  marks.addFolder({id: 'f', name: 'Tom & Jerry <3'});
  marks.add({id: 'a', url: 'https://example.org/?a=1&b="2"', title: '<script>alert(1)</script>', folderId: 'f', addedAt: at});
  marks.add({id: 'b', url: 'https://example.com/', title: 'Unfiled', addedAt: '2026-01-02T03:04:05Z'});
  const html = marks.toNetscapeHtml();
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('<H3>Tom &amp; Jerry &lt;3</H3>'));
  assert.ok(html.includes('ADD_DATE="1767323045"'));
  const copy = new BookmarkCollection();
  const result = copy.importNetscapeHtml(html, {makeId, now: at});
  assert.deepEqual(result, {added: 2, duplicates: 0, skipped: 0, folders: 1});
  assert.deepEqual(copy.list().map(({url, title, addedAt}) => ({url, title, addedAt})),
    marks.list().map(({url, title, addedAt}) => ({url, title, addedAt})));
  assert.equal(copy.folders[0].name, 'Tom & Jerry <3');
  assert.deepEqual(copy.importNetscapeHtml(html, {makeId, now: at}), {added: 0, duplicates: 2, skipped: 0, folders: 0});
});

test('imports typical Chrome and Safari exports, flattening nested folders', () => {
  const chrome = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
  <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://www.ibo.org/" ADD_DATE="1700000001" ICON="data:image/png;base64,AAAA">IB &amp; you</A>
    <DT><H3>Maths</H3>
    <DL><p>
      <DT><A HREF='https://www.desmos.com/calculator'>Desmos</A>
      <DT><A HREF="javascript:void(0)">Bookmarklet</A>
    </DL><p>
  </DL><p>
  <DT><A HREF="https://news.example.org/" ADD_DATE="abc">News <b>today</b></A>
</DL><p>`;
  const entries = parseNetscapeHtml(chrome);
  assert.deepEqual(entries.map(entry => [entry.title, entry.folder]), [
    ['IB & you', 'Bookmarks bar'], ['Desmos', 'Bookmarks bar / Maths'], ['Bookmarklet', 'Bookmarks bar / Maths'], ['News today', null]]);
  const marks = new BookmarkCollection();
  const result = marks.importNetscapeHtml(chrome, {makeId, now: at});
  assert.deepEqual(result, {added: 3, duplicates: 0, skipped: 1, folders: 2});
  assert.equal(marks.find('https://www.ibo.org').addedAt, '2023-11-14T22:13:21Z');
  assert.equal(marks.find('https://news.example.org').addedAt, at);
  assert.throws(() => parseNetscapeHtml('x'.repeat(16 * 1024 * 1024 + 1)), /too large/);
});
