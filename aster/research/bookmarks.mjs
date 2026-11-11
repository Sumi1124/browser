// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
// Bookmarks with one level of folders, duplicate detection and the
// Netscape bookmark file format that Safari, Chrome, Firefox and Edge use
// for import and export. Pure data; the embedder decides where it is stored.
import {safeUrl} from './metadata.mjs';
import {clean, assertId, isPlainObject, assertLimit, assertInstant, fail} from '../common/util.mjs';

export const BOOKMARK_SCHEMA = 1;
export const BOOKMARK_LIMITS = Object.freeze({bookmarks: 10000, folders: 200, importBytes: 16 * 1024 * 1024});

// Two URLs are the same bookmark when they differ only by a #fragment or a
// trailing slash. The Mac app's native code applies the same rule.
export function bookmarkKey(value) {
  const href = safeUrl(value);
  if (!href) return '';
  const url = new URL(href);
  url.hash = '';
  return url.href.replace(/\/+$/, '');
}

export class BookmarkCollection {
  #folders = new Map();
  #bookmarks = new Map();

  get size() { return this.#bookmarks.size; }
  get folders() { return [...this.#folders.values()].map(folder => ({...folder})); }

  addFolder({id, name}) {
    assertId(id, 'folder ID');
    if (this.#folders.has(id)) fail('duplicate_id', 'Folder already exists');
    assertLimit(this.#folders.size + 1, BOOKMARK_LIMITS.folders, 'folders');
    const folderName = clean(name, 128) || fail('invalid_name', 'Folder name is required');
    if (this.folderByName(folderName)) fail('duplicate_name', 'A folder with that name already exists');
    this.#folders.set(id, {id, name: folderName});
    return id;
  }

  folderByName(name) {
    const wanted = clean(name, 128).toLowerCase();
    return [...this.#folders.values()].find(folder => folder.name.toLowerCase() === wanted) || null;
  }

  renameFolder(id, name) {
    const folder = this.#folders.get(id) || fail('not_found', 'Folder not found');
    const folderName = clean(name, 128) || fail('invalid_name', 'Folder name is required');
    const other = this.folderByName(folderName);
    if (other && other.id !== id) fail('duplicate_name', 'A folder with that name already exists');
    folder.name = folderName;
  }

  /** Removes a folder; its bookmarks move to "unfiled" rather than being deleted. */
  removeFolder(id) {
    if (!this.#folders.delete(id)) fail('not_found', 'Folder not found');
    for (const bookmark of this.#bookmarks.values()) if (bookmark.folderId === id) bookmark.folderId = null;
  }

  find(url) {
    const key = bookmarkKey(url);
    if (!key) return null;
    const found = [...this.#bookmarks.values()].find(bookmark => bookmarkKey(bookmark.url) === key);
    return found ? {...found} : null;
  }

  /** Returns {added: true, id} or, for a URL already bookmarked, {added: false, existingId}. */
  add({id, url, title = '', folderId = null, addedAt = new Date().toISOString()}) {
    assertId(id, 'bookmark ID');
    if (this.#bookmarks.has(id)) fail('duplicate_id', 'Bookmark already exists');
    const href = safeUrl(url) || fail('invalid_url', 'Only http and https pages can be bookmarked');
    const existing = this.find(href);
    if (existing) return {added: false, existingId: existing.id};
    assertLimit(this.#bookmarks.size + 1, BOOKMARK_LIMITS.bookmarks, 'bookmarks');
    if (folderId !== null && !this.#folders.has(folderId)) fail('not_found', 'Folder not found');
    this.#bookmarks.set(id, {id, url: href, title: clean(title, 256) || new URL(href).hostname, folderId,
      addedAt: assertInstant(addedAt, 'addedAt')});
    return {added: true, id};
  }

  update(id, {title, url, folderId} = {}) {
    const bookmark = this.#bookmarks.get(id) || fail('not_found', 'Bookmark not found');
    if (url !== undefined) {
      const href = safeUrl(url) || fail('invalid_url', 'Only http and https pages can be bookmarked');
      const other = this.find(href);
      if (other && other.id !== id) fail('duplicate_url', 'That page is already bookmarked');
      bookmark.url = href;
    }
    if (title !== undefined) bookmark.title = clean(title, 256) || new URL(bookmark.url).hostname;
    if (folderId !== undefined) {
      if (folderId !== null && !this.#folders.has(folderId)) fail('not_found', 'Folder not found');
      bookmark.folderId = folderId;
    }
  }

  remove(id) { if (!this.#bookmarks.delete(id)) fail('not_found', 'Bookmark not found'); }
  get(id) { const bookmark = this.#bookmarks.get(id); return bookmark ? {...bookmark} : null; }

  /** In the order they were added. `folderId: null` lists unfiled bookmarks. */
  list({folderId, text} = {}) {
    const needle = text === undefined ? '' : clean(text, 256).toLowerCase();
    return [...this.#bookmarks.values()]
      .filter(bookmark => (folderId === undefined || bookmark.folderId === folderId)
        && (!needle || bookmark.title.toLowerCase().includes(needle) || bookmark.url.toLowerCase().includes(needle)))
      .map(bookmark => ({...bookmark}));
  }

  toJSON() {
    return {schema: BOOKMARK_SCHEMA, folders: this.folders, bookmarks: [...this.#bookmarks.values()].map(bookmark => ({...bookmark}))};
  }

  static fromJSON(data) {
    if (!isPlainObject(data) || data.schema !== BOOKMARK_SCHEMA || !Array.isArray(data.folders) || !Array.isArray(data.bookmarks)) {
      fail('unsupported_schema', 'Unsupported bookmark data');
    }
    assertLimit(data.folders.length, BOOKMARK_LIMITS.folders, 'folders');
    assertLimit(data.bookmarks.length, BOOKMARK_LIMITS.bookmarks, 'bookmarks');
    const collection = new BookmarkCollection();
    for (const folder of data.folders) {
      if (!isPlainObject(folder)) fail('invalid_data', 'Invalid folder record');
      collection.addFolder(folder);
    }
    for (const bookmark of data.bookmarks) {
      if (!isPlainObject(bookmark)) fail('invalid_data', 'Invalid bookmark record');
      if (!collection.add(bookmark).added) fail('invalid_data', 'Duplicate bookmark');
    }
    return collection;
  }

  // ---- Netscape bookmark file (bookmarks.html) ---------------------------

  toNetscapeHtml() {
    const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const line = bookmark => `<DT><A HREF="${escape(bookmark.url)}" ADD_DATE="${Math.floor(Date.parse(bookmark.addedAt) / 1000)}">${escape(bookmark.title)}</A>`;
    const out = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->',
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>'];
    for (const folder of this.#folders.values()) {
      out.push(`    <DT><H3>${escape(folder.name)}</H3>`, '    <DL><p>');
      for (const bookmark of this.list({folderId: folder.id})) out.push(`        ${line(bookmark)}`);
      out.push('    </DL><p>');
    }
    for (const bookmark of this.list({folderId: null})) out.push(`    ${line(bookmark)}`);
    out.push('</DL><p>');
    return out.join('\n') + '\n';
  }

  /**
   * Imports a bookmarks.html export. Nested folders are flattened into one
   * level named "Outer / Inner". Existing URLs are skipped, never replaced.
   * `makeId` must return a fresh ID on each call.
   */
  importNetscapeHtml(text, {makeId, now = new Date().toISOString()}) {
    const entries = parseNetscapeHtml(text);
    const result = {added: 0, duplicates: 0, skipped: 0, folders: 0};
    for (const entry of entries) {
      if (!safeUrl(entry.url)) { result.skipped++; continue; }
      if (this.find(entry.url)) { result.duplicates++; continue; }
      let folderId = null;
      if (entry.folder) {
        const folder = this.folderByName(entry.folder);
        if (folder) folderId = folder.id;
        else { folderId = this.addFolder({id: makeId(), name: entry.folder}); result.folders++; }
      }
      const added = entry.addDate && entry.addDate > 0 && entry.addDate < 32503680000
        ? new Date(entry.addDate * 1000).toISOString().replace('.000Z', 'Z') : now;
      this.add({id: makeId(), url: entry.url, title: entry.title, folderId, addedAt: added});
      result.added++;
    }
    return result;
  }
}

const decodeEntities = text => text
  .replace(/&#(\d{1,7});/g, (_, code) => (Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : ''))
  .replace(/&#x([0-9a-f]{1,6});/gi, (_, code) => (parseInt(code, 16) <= 0x10ffff ? String.fromCodePoint(parseInt(code, 16)) : ''))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');
const stripTags = html => decodeEntities(html.replace(/<[^>]*>/g, ''));

/** Returns [{title, url, folder, addDate}] in file order. Tolerant of the format's many variants. */
export function parseNetscapeHtml(text) {
  if (typeof text !== 'string') fail('invalid_input', 'Bookmark file must be text');
  if (text.length > BOOKMARK_LIMITS.importBytes) fail('limit_exceeded', 'Bookmark file is too large');
  const stack = [];
  let pendingFolder = null;
  const entries = [];
  const token = /<(\/?)dl\b[^>]*>|<h3\b[^>]*>([\s\S]*?)<\/h3>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of text.matchAll(token)) {
    if (match[0][1] === 'd' || match[0][1] === 'D' || match[1] === '/') {
      if (match[1] === '/') stack.pop();
      else { stack.push(pendingFolder); pendingFolder = null; }
    } else if (match[2] !== undefined) {
      pendingFolder = clean(stripTags(match[2]), 128) || 'Untitled folder';
    } else {
      const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[3]);
      if (!href) continue;
      const addDate = /\badd_date\s*=\s*"?(\d{1,12})/i.exec(match[3]);
      const folder = stack.filter(Boolean).join(' / ').slice(0, 128);
      entries.push({url: decodeEntities(href[2] ?? href[3] ?? href[4]), title: clean(stripTags(match[4]), 256),
        folder: folder || null, addDate: addDate ? Number(addDate[1]) : null});
      if (entries.length > BOOKMARK_LIMITS.bookmarks) fail('limit_exceeded', 'Too many bookmarks in file');
    }
  }
  return entries;
}
