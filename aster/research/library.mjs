// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
// Profile-local research library: folders, tagged sources, annotations,
// duplicate detection and bibliography exports. Pure data; the embedder
// decides where the serialized form is stored.
import {safeUrl, isoDate, normalizeDoi, toCsl, toBibtex, toRis} from './metadata.mjs';
import {clean, cleanMultiline, assertId, isId, isPlainObject, assertLimit, assertInstant, fail} from '../common/util.mjs';

export const LIBRARY_SCHEMA = 1;
export const LIBRARY_LIMITS = Object.freeze({
  folders: 512, folderDepth: 8, sources: 20000, tagsPerSource: 32, annotations: 50000,
});

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref_src|igshid)$/i;

// Key used only for matching: ignores scheme, "www.", fragments, tracking
// parameters, parameter order and a trailing slash.
export function normalizeUrlForMatch(value) {
  const href = safeUrl(value);
  if (!href) return '';
  const url = new URL(href);
  const params = [...url.searchParams].filter(([key]) => !TRACKING.test(key))
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const query = params.length ? `?${new URLSearchParams(params)}` : '';
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '';
  return `${url.hostname.replace(/^www\./, '')}${url.port ? `:${url.port}` : ''}${path}${query}`;
}

export function titleFingerprint(title) {
  return clean(title).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function validIssued(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3 || !value.every(Number.isInteger)) return null;
  return isoDate(value.map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-'));
}

// Normalizes untrusted metadata (for example from extractPageMetadata or a
// user edit) into the stored shape. Unknown fields are dropped; nothing is
// invented for missing fields.
export function sanitizeMetadata(input = {}) {
  if (!isPlainObject(input)) fail('invalid_metadata', 'Metadata must be an object');
  const authors = Array.isArray(input.authors)
    ? [...new Set(input.authors.map(value => clean(value, 256)).filter(Boolean))].slice(0, 32) : [];
  const metadata = {
    title: clean(input.title), authors, issued: validIssued(input.issued),
    website: clean(input.website), publisher: clean(input.publisher),
    url: safeUrl(input.url), doi: normalizeDoi(input.doi),
  };
  if (!metadata.title && !metadata.url && !metadata.doi) fail('invalid_metadata', 'A source needs a title, URL or DOI');
  return metadata;
}

export function duplicateKeys(metadata) {
  const keys = [];
  if (metadata.doi) keys.push({kind: 'doi', key: `doi:${metadata.doi.toLowerCase()}`});
  const url = normalizeUrlForMatch(metadata.url);
  if (url) keys.push({kind: 'url', key: `url:${url}`});
  const fingerprint = titleFingerprint(metadata.title);
  if (fingerprint.length >= 12) {
    const author = titleFingerprint((metadata.authors[0] || '').split(/\s+/).pop());
    keys.push({kind: 'title', key: `title:${fingerprint}|${metadata.issued?.[0] || ''}|${author}`});
  }
  return keys;
}

// Fills empty fields of `existing` from `incoming` and reports differing
// non-empty values instead of overwriting them.
export function mergeMissingFields(existing, incoming) {
  const base = sanitizeMetadata(existing);
  const other = sanitizeMetadata(incoming);
  const empty = value => !value || (Array.isArray(value) && !value.length);
  const filled = [];
  const conflicts = [];
  for (const key of Object.keys(base)) {
    if (empty(other[key])) continue;
    if (empty(base[key])) { base[key] = other[key]; filled.push(key); }
    else if (JSON.stringify(base[key]) !== JSON.stringify(other[key])) conflicts.push({field: key, kept: base[key], incoming: other[key]});
  }
  return {metadata: base, filled, conflicts};
}

const normalizeTags = tags => {
  if (!Array.isArray(tags)) fail('invalid_tags', 'Tags must be an array');
  const result = [...new Set(tags.map(tag => clean(tag, 64).toLowerCase()).filter(Boolean))];
  assertLimit(result.length, LIBRARY_LIMITS.tagsPerSource, 'tags');
  return result.sort();
};

export class ResearchLibrary {
  #folders = new Map();
  #sources = new Map();
  #annotations = new Map();
  #index = new Map();

  get folders() { return [...this.#folders.values()].map(folder => ({...folder})); }
  get size() { return this.#sources.size; }

  addFolder({id, name, parentId = null}) {
    assertId(id, 'folder ID');
    if (this.#folders.has(id)) fail('duplicate_id', 'Folder already exists');
    assertLimit(this.#folders.size + 1, LIBRARY_LIMITS.folders, 'folders');
    const folderName = clean(name, 128);
    if (!folderName) fail('invalid_name', 'Folder name is required');
    if (parentId !== null) {
      if (!this.#folders.has(parentId)) fail('not_found', 'Parent folder not found');
      let depth = 1;
      for (let cursor = parentId; cursor !== null; cursor = this.#folders.get(cursor).parentId) depth++;
      if (depth > LIBRARY_LIMITS.folderDepth) fail('limit_exceeded', 'Folders are nested too deeply');
    }
    if ([...this.#folders.values()].some(folder => folder.parentId === parentId && folder.name.toLowerCase() === folderName.toLowerCase())) {
      fail('duplicate_name', 'A folder with that name already exists here');
    }
    this.#folders.set(id, {id, name: folderName, parentId});
    return id;
  }

  renameFolder(id, name) {
    const folder = this.#folders.get(id) || fail('not_found', 'Folder not found');
    const folderName = clean(name, 128) || fail('invalid_name', 'Folder name is required');
    if ([...this.#folders.values()].some(other => other.id !== id && other.parentId === folder.parentId
        && other.name.toLowerCase() === folderName.toLowerCase())) {
      fail('duplicate_name', 'A folder with that name already exists here');
    }
    folder.name = folderName;
  }

  removeFolder(id) {
    if (!this.#folders.has(id)) fail('not_found', 'Folder not found');
    if ([...this.#folders.values()].some(folder => folder.parentId === id)
        || [...this.#sources.values()].some(source => source.folderId === id)) {
      fail('not_empty', 'Move or remove the folder contents first');
    }
    this.#folders.delete(id);
  }

  findDuplicate(metadata, ignoreId = null) {
    for (const {kind, key} of duplicateKeys(sanitizeMetadata(metadata))) {
      const id = this.#index.get(key);
      if (id && id !== ignoreId) return {id, reason: kind, confidence: kind === 'title' ? 'likely' : 'exact'};
    }
    return null;
  }

  #indexSource(source) {
    for (const {key} of duplicateKeys(source.metadata)) if (!this.#index.has(key)) this.#index.set(key, source.id);
  }

  #reindex() {
    this.#index.clear();
    for (const source of this.#sources.values()) this.#indexSource(source);
  }

  addSource({id, metadata, folderId = null, tags = [], addedAt = new Date().toISOString(), allowDuplicate = false}) {
    assertId(id, 'source ID');
    if (this.#sources.has(id)) fail('duplicate_id', 'Source already exists');
    assertLimit(this.#sources.size + 1, LIBRARY_LIMITS.sources, 'sources');
    if (folderId !== null && !this.#folders.has(folderId)) fail('not_found', 'Folder not found');
    const sanitized = sanitizeMetadata(metadata);
    const duplicate = this.findDuplicate(sanitized);
    if (duplicate && !allowDuplicate) return {added: false, duplicateOf: duplicate.id, reason: duplicate.reason, confidence: duplicate.confidence};
    const source = {id, metadata: sanitized, folderId, tags: normalizeTags(tags), addedAt: assertInstant(addedAt, 'addedAt')};
    this.#sources.set(id, source);
    this.#indexSource(source);
    return {added: true, id};
  }

  getSource(id) {
    const source = this.#sources.get(id);
    return source ? structuredClone(source) : null;
  }

  updateMetadata(id, metadata) {
    const source = this.#sources.get(id) || fail('not_found', 'Source not found');
    source.metadata = sanitizeMetadata(metadata);
    this.#reindex();
  }

  moveSource(id, folderId) {
    const source = this.#sources.get(id) || fail('not_found', 'Source not found');
    if (folderId !== null && !this.#folders.has(folderId)) fail('not_found', 'Folder not found');
    source.folderId = folderId;
  }

  setTags(id, tags) {
    const source = this.#sources.get(id) || fail('not_found', 'Source not found');
    source.tags = normalizeTags(tags);
  }

  removeSource(id) {
    if (!this.#sources.delete(id)) fail('not_found', 'Source not found');
    for (const [annotationId, annotation] of this.#annotations) if (annotation.sourceId === id) this.#annotations.delete(annotationId);
    this.#reindex();
  }

  addAnnotation({id, sourceId, quote = '', note = '', createdAt = new Date().toISOString()}) {
    assertId(id, 'annotation ID');
    if (this.#annotations.has(id)) fail('duplicate_id', 'Annotation already exists');
    if (!this.#sources.has(sourceId)) fail('not_found', 'Source not found');
    assertLimit(this.#annotations.size + 1, LIBRARY_LIMITS.annotations, 'annotations');
    const annotation = {id, sourceId, quote: cleanMultiline(quote, 8192), note: cleanMultiline(note), createdAt: assertInstant(createdAt, 'createdAt')};
    if (!annotation.quote && !annotation.note) fail('invalid_annotation', 'An annotation needs a quote or a note');
    this.#annotations.set(id, annotation);
    return id;
  }

  removeAnnotation(id) {
    if (!this.#annotations.delete(id)) fail('not_found', 'Annotation not found');
  }

  annotationsFor(sourceId) {
    return [...this.#annotations.values()].filter(item => item.sourceId === sourceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(item => ({...item}));
  }

  // Filters combine with AND. `folderId: null` means unfiled; omit it for all
  // folders. `includeSubfolders` searches below the given folder too.
  query({folderId, includeSubfolders = false, tag, text} = {}) {
    let folders = null;
    if (folderId !== undefined) {
      folders = new Set([folderId]);
      if (includeSubfolders && folderId !== null) {
        let grew = true;
        while (grew) {
          grew = false;
          for (const folder of this.#folders.values()) {
            if (folders.has(folder.parentId) && !folders.has(folder.id)) { folders.add(folder.id); grew = true; }
          }
        }
      }
    }
    const wantedTag = tag === undefined ? null : clean(tag, 64).toLowerCase();
    const needle = text === undefined ? '' : clean(text, 256).toLowerCase();
    return [...this.#sources.values()].filter(source => (!folders || folders.has(source.folderId))
      && (wantedTag === null || source.tags.includes(wantedTag))
      && (!needle || [source.metadata.title, source.metadata.website, source.metadata.publisher, ...source.metadata.authors]
        .some(field => field.toLowerCase().includes(needle))))
      .sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))
      .map(source => structuredClone(source));
  }

  allTags() {
    const counts = new Map();
    for (const source of this.#sources.values()) for (const tag of source.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([tag, count]) => ({tag, count}));
  }

  // format: 'csl-json' | 'bibtex' | 'ris'. Unknown IDs are rejected rather
  // than skipped so an export never silently drops a source.
  exportBibliography(ids, format, accessDate) {
    if (!Array.isArray(ids) || !ids.length) fail('invalid_input', 'Choose at least one source');
    const sources = ids.map(id => this.#sources.get(id) || fail('not_found', `Source not found: ${id}`));
    if (format === 'csl-json') return JSON.stringify(sources.map(source => toCsl(source.metadata, source.id, accessDate)), null, 2);
    if (format === 'bibtex') return sources.map(source => toBibtex(source.metadata, source.id, accessDate)).join('\n');
    if (format === 'ris') return sources.map(source => toRis(source.metadata, source.id, accessDate)).join('');
    return fail('invalid_format', 'Unsupported bibliography format');
  }

  toJSON() {
    return {
      schema: LIBRARY_SCHEMA,
      folders: this.folders,
      sources: [...this.#sources.values()].map(source => structuredClone(source)),
      annotations: [...this.#annotations.values()].map(item => ({...item})),
    };
  }

  // Rebuilds a library from stored data, validating every record. Folders may
  // appear in any order; cycles and dangling references are rejected.
  static fromJSON(data) {
    if (!isPlainObject(data) || data.schema !== LIBRARY_SCHEMA) fail('unsupported_schema', 'Unsupported research library data');
    for (const key of ['folders', 'sources', 'annotations']) if (!Array.isArray(data[key])) fail('invalid_data', `Missing ${key}`);
    assertLimit(data.folders.length, LIBRARY_LIMITS.folders, 'folders');
    assertLimit(data.sources.length, LIBRARY_LIMITS.sources, 'sources');
    assertLimit(data.annotations.length, LIBRARY_LIMITS.annotations, 'annotations');
    const library = new ResearchLibrary();
    const pending = new Map();
    for (const folder of data.folders) {
      if (!isPlainObject(folder) || !isId(folder.id) || pending.has(folder.id)) fail('invalid_data', 'Invalid folder record');
      pending.set(folder.id, folder);
    }
    while (pending.size) {
      const ready = [...pending.values()].filter(folder => folder.parentId === null || library.#folders.has(folder.parentId));
      if (!ready.length) fail('invalid_data', 'Folder hierarchy is inconsistent');
      for (const folder of ready) { library.addFolder(folder); pending.delete(folder.id); }
    }
    for (const source of data.sources) {
      if (!isPlainObject(source)) fail('invalid_data', 'Invalid source record');
      library.addSource({...source, allowDuplicate: true});
    }
    for (const annotation of data.annotations) {
      if (!isPlainObject(annotation)) fail('invalid_data', 'Invalid annotation record');
      library.addAnnotation(annotation);
    }
    return library;
  }
}
