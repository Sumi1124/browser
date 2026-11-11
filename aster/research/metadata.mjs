// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
// Runs in a renderer/isolated world with no browser bindings or network access.
const clean = (value, max = 4096) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
export function safeUrl(value, base) {
  try {
    const url = new URL(clean(value), base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function isoDate(value) {
  const match = clean(value).match(/^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T.*)?)?)?$/);
  if (!match) return null;
  const parts = match.slice(1).filter(Boolean).map(Number);
  if (parts[0] < 1 || (parts.length > 1 && (parts[1] < 1 || parts[1] > 12))) return null;
  if (parts.length > 2) {
    const leap = parts[0] % 4 === 0 && (parts[0] % 100 !== 0 || parts[0] % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (parts[2] < 1 || parts[2] > days[parts[1] - 1]) return null;
  }
  return parts;
}
export function normalizeDoi(value) {
  const doi = clean(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  return /^10\.\d{4,9}\/[^\s<>{}"\\]+$/i.test(doi) && doi.length <= 512 ? doi : '';
}
export function extractPageMetadata(doc = globalThis.document, pageUrl = globalThis.location.href) {
  const meta = new Map();
  for (const node of Array.from(doc.querySelectorAll('meta[name],meta[property]')).slice(0, 512)) {
    const key = (node.getAttribute('name') || node.getAttribute('property') || '').toLowerCase();
    const value = clean(node.getAttribute('content'));
    if (value) meta.set(key, [...(meta.get(key) || []), value].slice(0, 32));
  }
  const first = (...keys) => keys.map(key => meta.get(key)?.[0]).find(Boolean) || '';
  const candidates = [];
  let budget = 128;
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 8 || --budget < 0) return;
    if (Array.isArray(node)) { for (const child of node.slice(0, 32)) visit(child, depth + 1); return; }
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (types.some(type => ['Article', 'ScholarlyArticle', 'NewsArticle', 'BlogPosting', 'WebPage', 'Report'].includes(type))) candidates.push(node);
    visit(node['@graph'], depth + 1); visit(node.mainEntity, depth + 1);
  };
  const warnings = [];
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).slice(0, 16)) {
    if (script.textContent.length > 131072) { warnings.push('Oversized structured metadata skipped.'); continue; }
    try { visit(JSON.parse(script.textContent)); } catch { warnings.push('Invalid JSON-LD skipped.'); }
  }
  const canonical = safeUrl(doc.querySelector('link[rel~="canonical"]')?.getAttribute('href') || '', pageUrl) || safeUrl(pageUrl);
  const matches = item => safeUrl(typeof item.mainEntityOfPage === 'string' ? item.mainEntityOfPage : item.mainEntityOfPage?.['@id'] || item.url || item['@id'] || '') === canonical;
  const structured = candidates.find(matches) || (candidates.length === 1 ? candidates[0] : {});
  if (candidates.length > 1 && !candidates.some(matches)) warnings.push('Multiple structured sources found; confirm the page metadata.');
  const name = item => typeof item === 'string' ? clean(item, 256) : clean(item?.name, 256);
  let authors = (meta.get('citation_author') || []).map(value => clean(value, 256));
  if (!authors.length) authors = (Array.isArray(structured.author) ? structured.author : [structured.author]).map(name).filter(Boolean).slice(0, 32);
  if (!authors.length && first('author', 'dc.creator')) authors = [clean(first('author', 'dc.creator'), 256)];
  const publication = first('citation_publication_date', 'article:published_time', 'dc.date') || structured.datePublished;
  const issued = isoDate(typeof publication === 'string' ? publication.replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, '$1-$2-$3') : '');
  if (publication && !issued) warnings.push('Publication date needs confirmation.');
  const result = {
    title: clean(first('citation_title', 'og:title', 'dc.title') || structured.headline || structured.name || doc.title),
    authors: [...new Set(authors)],
    issued,
    modified: isoDate(first('article:modified_time') || structured.dateModified),
    website: clean(first('og:site_name') || name(structured.isPartOf)),
    publisher: clean(first('citation_publisher') || name(structured.publisher)),
    url: canonical,
    doi: normalizeDoi(first('citation_doi', 'dc.identifier') || (typeof structured.identifier === 'string' ? structured.identifier : structured.identifier?.value)),
    warnings,
  };
  result.missing = ['title', 'authors', 'issued', 'website'].filter(key => !result[key] || (Array.isArray(result[key]) && !result[key].length));
  return result;
}
export function toCsl(metadata, id, accessDate) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new TypeError('Invalid citation ID');
  const item = {id, type: 'webpage'};
  const title = clean(metadata.title);
  const url = safeUrl(metadata.url);
  if (title) item.title = title;
  if (url) item.URL = url;
  const authors = Array.isArray(metadata.authors) ? metadata.authors.map(value => clean(value, 256)).filter(Boolean).slice(0, 32) : [];
  if (authors.length) item.author = authors.map(literal => ({literal}));
  const issued = Array.isArray(metadata.issued) ? isoDate(metadata.issued.map((value, index) => String(value).padStart(index ? 2 : 4, '0')).join('-')) : null;
  if (issued) item.issued = {'date-parts': [issued]};
  const accessed = isoDate(accessDate);
  if (accessed) item.accessed = {'date-parts': [accessed]};
  if (clean(metadata.website)) item['container-title'] = clean(metadata.website);
  if (clean(metadata.publisher)) item.publisher = clean(metadata.publisher);
  if (normalizeDoi(metadata.doi)) item.DOI = normalizeDoi(metadata.doi);
  return item;
}
const bibEscape = value => clean(value).replace(/[\\{}%&#_$~^]/g, char => ({
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '%': '\\%', '&': '\\&', '#': '\\#',
  '_': '\\_', '$': '\\$', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
}[char]));
export function toBibtex(metadata, id, accessDate) {
  const item = toCsl(metadata, id, accessDate);
  const fields = [];
  const add = (key, value) => { if (value) fields.push(`  ${key} = {${bibEscape(String(value))}}`); };
  add('title', item.title);
  if (item.author) fields.push(`  author = {${item.author.map(author => `{${bibEscape(author.literal)}}`).join(' and ')}}`);
  add('year', item.issued?.['date-parts'][0][0]);
  add('howpublished', item['container-title']); add('publisher', item.publisher); add('url', item.URL); add('doi', item.DOI);
  if (item.accessed) add('note', `Accessed ${item.accessed['date-parts'][0].map((part, i) => String(part).padStart(i ? 2 : 4, '0')).join('-')}`);
  return `@misc{${id},\n${fields.join(',\n')}\n}\n`;
}
export function toRis(metadata, id, accessDate) {
  const item = toCsl(metadata, id, accessDate);
  const fields = ['TY  - ELEC', `ID  - ${id}`];
  const add = (key, value) => { if (value) fields.push(`${key}  - ${clean(String(value))}`); };
  add('TI', item.title);
  item.author?.forEach(author => add('AU', author.literal));
  add('PY', item.issued?.['date-parts'][0][0]);
  add('T2', item['container-title']); add('PB', item.publisher); add('UR', item.URL); add('DO', item.DOI);
  if (item.accessed) add('Y2', item.accessed['date-parts'][0].join('/'));
  return fields.join('\r\n') + '\r\nER  - \r\n';
}
