import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
const source = await readFile(new URL('../aster/research/metadata.mjs', import.meta.url), 'utf8');
// Sandbox remains enabled. No external provider is contacted in these tests.
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium', chromiumSandbox: true, headless: true});
const page = await browser.newPage();
async function extract(html) {
  await page.setContent(html);
  return page.evaluate(async source => {
    const blob = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
    try { return (await import(blob)).extractPageMetadata(document, 'https://example.org/article'); }
    finally { URL.revokeObjectURL(blob); }
  }, source);
}
test.after(async () => { await browser.close(); });
test('actual DOM citation tags, canonical URL, authors and dates', async () => {
  const result = await extract(`<title>Fallback</title>
    <link rel="canonical" href="/canonical">
    <meta name="citation_title" content="Research &amp; evidence">
    <meta name="citation_author" content="Ada Lovelace"><meta name="citation_author" content="Grace Hopper">
    <meta name="citation_publication_date" content="2024/02/29">
    <meta name="citation_doi" content="https://doi.org/10.1234/paper">
    <meta property="og:site_name" content="Research Institute">`);
  assert.equal(result.title, 'Research & evidence');
  assert.equal(result.url, 'https://example.org/canonical');
  assert.deepEqual(result.authors, ['Ada Lovelace', 'Grace Hopper']);
  assert.deepEqual(result.issued, [2024, 2, 29]);
  assert.deepEqual(result.missing, []);
});
test('JSON-LD graph picks the page identity and retains unknown dates', async () => {
  const result = await extract(`<title>Fallback</title><script type="application/ld+json">${JSON.stringify({'@graph': [
    {'@type': 'Article', url: 'https://other.example/', headline: 'Unrelated'},
    {'@type': 'ScholarlyArticle', mainEntityOfPage: {'@id': 'https://example.org/article'}, headline: 'Evidence', author: [{name: 'Research Team'}], publisher: {name: 'Publisher'}, datePublished: 'unknown'},
  ]})}</script>`);
  assert.equal(result.title, 'Evidence');
  assert.deepEqual(result.authors, ['Research Team']);
  assert.equal(result.issued, null);
  assert.ok(result.missing.includes('issued'));
  assert.equal(result.publisher, 'Publisher');
});
test('malformed JSON and executable canonical links are inert', async () => {
  const result = await extract(`<title>Missing fields</title><link rel="canonical" href="javascript:alert(1)"><script type="application/ld+json">{"@type":</script>`);
  assert.equal(result.url, 'https://example.org/article');
  assert.deepEqual(result.authors, []);
  assert.equal(result.issued, null);
  assert.ok(result.warnings.includes('Invalid JSON-LD skipped.'));
});
test('JSON-LD size bounds and ambiguous sources do not guess metadata', async () => {
  const result = await extract(`<title>Page title</title><script type="application/ld+json">${' '.repeat(131073)}</script><script type="application/ld+json">${JSON.stringify([
    {'@type': 'Article', headline: 'A', author: 'Wrong A'}, {'@type': 'Article', headline: 'B', author: 'Wrong B'},
  ])}</script>`);
  assert.equal(result.title, 'Page title');
  assert.deepEqual(result.authors, []);
  assert.equal(result.warnings.length, 2);
});
