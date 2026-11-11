// Drives the Mac app's study-tools panel in Chromium with a fake native
// bridge. It checks the interface logic; the native WebKit app itself is
// tested by the --self-test run in the Mac CI job.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize, resolve} from 'node:path';
import {chromium} from 'playwright-core';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css'};

function serve() {
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname));
    const file = path.startsWith('/aster/') ? join(ROOT, path) : join(ROOT, 'mac/Resources/web', path);
    if (!file.startsWith(ROOT)) { response.writeHead(403).end(); return; }
    let body;
    try { body = await readFile(file); } catch { response.writeHead(404).end(); return; }
    response.writeHead(200, {'content-type': TYPES[extname(file)] || 'application/octet-stream'}).end(body);
  });
  return new Promise(done => server.listen(0, '127.0.0.1', () => done(server)));
}

// Fake WKScriptMessageHandlerWithReply bridge, with in-memory storage.
const bridgeScript = () => {
  // Backed by sessionStorage so "app storage" survives page reloads, like files on disk.
  const store = new Proxy({}, {
    get: (_, key) => sessionStorage.getItem(`store:${String(key)}`) ?? undefined,
    set: (_, key, value) => { sessionStorage.setItem(`store:${String(key)}`, value); return true; },
    deleteProperty: (_, key) => { sessionStorage.removeItem(`store:${String(key)}`); return true; },
    ownKeys: () => Object.keys(sessionStorage).filter(key => key.startsWith('store:')).map(key => key.slice(6)),
    getOwnPropertyDescriptor: () => ({enumerable: true, configurable: true}),
  });
  window.__store = store;
  window.__saved = [];
  window.__nextFile = null;
  window.__citation = null;
  window.__opened = [];
  window.confirm = () => true;
  window.webkit = {messageHandlers: {aster: {postMessage: async message => {
    switch (message.op) {
      case 'appInfo': return {version: '9.9.9'};
      case 'load': return store[message.key] ?? null;
      case 'save': store[message.key] = message.text; return true;
      case 'saveFile': window.__saved.push({name: message.suggestedName, text: message.text}); return true;
      case 'openFile': return window.__nextFile;
      case 'citeCurrentPage': if (!window.__citation) throw new Error('Open a web page first.'); return window.__citation;
      case 'openURL': window.__opened.push(message.url); return true;
      default: throw new Error(`Unknown op ${message.op}`);
    }
  }}}};
};

test('study tools panel works end to end with the native bridge', async () => {
  const server = await serve();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    // Only for root-run development containers, where Chromium's sandbox cannot start.
    chromiumSandbox: process.env.ASTER_TEST_DISABLE_SANDBOX !== '1',
  });
  try {
    const page = await browser.newPage({viewport: {width: 380, height: 900}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
    // Every file the panel requests must exist (the browser's own favicon probe aside).
    page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`); });
    await page.addInitScript(bridgeScript);
    await page.goto(`http://127.0.0.1:${server.address().port}/tools.html`);
    await page.waitForSelector('html[data-ready="true"]');

    // Planner: add a task, complete it, export a calendar.
    await page.fill('#planner input[placeholder="What needs doing?"]', 'Physics lab report');
    await page.click('#planner button:has-text("Add")');
    await page.waitForSelector('#planner li:has-text("Physics lab report")');
    await page.click('#planner button:has-text("Export to Calendar")');
    const ics = await page.evaluate(() => window.__saved.at(-1));
    assert.equal(ics.name, 'aster-planner.ics');
    assert.match(ics.text, /SUMMARY:Physics lab report/);
    await page.check('#planner li:has-text("Physics lab report") input[type=checkbox]');
    await page.waitForSelector('#planner li.done:has-text("Physics lab report")');
    await page.click('#planner button:has-text("Export to Calendar")');
    await page.waitForSelector('#toast.error:has-text("nothing to export")');
    assert.equal(await page.evaluate(() => window.__saved.length), 1);
    const stored = JSON.parse(await page.evaluate(() => window.__store.planner));
    assert.equal(stored.tasks[0].completed.length, 1);

    // Flashcards: add a card and study it.
    await page.click('.tabs button[data-view="cards"]');
    await page.fill('#cards textarea[placeholder="Question"]', 'Speed of light?');
    await page.fill('#cards textarea[placeholder="Answer"]', '3.00 × 10⁸ m/s');
    await page.click('#cards button:has-text("Add card")');
    await page.click('#cards button:has-text("Study now (1 due)")');
    await page.click('#cards button:has-text("Show answer")');
    assert.ok(await page.isVisible('#cards .answer:has-text("3.00 × 10⁸ m/s")'));
    await page.click('#cards button:has-text("Good")');
    await page.waitForSelector('#cards :text("All done for now")');

    // Library: cite a page with missing fields, then detect a duplicate.
    await page.evaluate(() => { window.__citation = {title: 'Railways <b>and</b> trade', authors: [], issued: [2024, 3], website: 'History Review',
      publisher: '', url: 'https://example.org/rail?utm_source=x', doi: '', missing: ['authors'], warnings: []}; });
    await page.click('.tabs button[data-view="library"]');
    await page.click('#library button:has-text("Cite current page")');
    await page.waitForSelector('#library .warn:has-text("Not found on the page: authors")');
    assert.equal(await page.inputValue('#library label:has-text("Published") input'), '2024-03');
    await page.fill('#library label:has-text("Authors") textarea', 'Ada Lovelace');
    await page.fill('#library label:has-text("Tags") input', 'IA, primary');
    await page.click('#library button:has-text("Save")');
    await page.waitForSelector('#library li:has-text("Railways <b>and</b> trade")');
    assert.equal(await page.locator('#library b').count(), 0, 'page text is never parsed as HTML');
    await page.click('#library button:has-text("Cite current page")');
    await page.fill('#library label:has-text("Publisher") input', 'Rail Press');
    await page.click('#library button:has-text("Save")');
    await page.waitForSelector('#library .warn:has-text("already in your library (same url)")');
    await page.click('#library button:has-text("Fill gaps in existing")');
    const library = JSON.parse(await page.evaluate(() => window.__store.library));
    assert.equal(library.sources.length, 1);
    assert.equal(library.sources[0].metadata.publisher, 'Rail Press');
    assert.deepEqual(library.sources[0].tags, ['ia', 'primary']);
    await page.click('#library button:has-text("Export 1 shown")');
    assert.match(await page.evaluate(() => window.__saved.at(-1).text), /author = \{\{Ada Lovelace\}\}/);
    await page.click('#library li button.link[title^="https://example.org"]');
    assert.deepEqual(await page.evaluate(() => window.__opened), ['https://example.org/rail?utm_source=x']);

    // Data: open a CSV, see statistics, draw a scatter chart with a trend line.
    await page.evaluate(() => { window.__nextFile = {name: 'rates.csv', text: 'temp,rate\n10,2.1\n20,3.9\n30,6.2\n40,7.8\n50,10.1\n'}; });
    await page.click('.tabs button[data-view="data"]');
    await page.click('#data button:has-text("Open file")');
    await page.waitForSelector('#data h2:has-text("rates.csv: 5 rows")');
    assert.ok(await page.isVisible('#data td:has-text("6.02")'));
    await page.click('#data button:has-text("Draw chart")');
    await page.waitForSelector('#data .chart img');
    assert.match(await page.textContent('#data .chart .note'), /rate = 0\.199 × temp \+ 0\.05\s+\(R² = 0\.997, n = 5\)/);
    assert.ok(await page.evaluate(() => document.querySelector('#data .chart img').naturalWidth > 0), 'chart image renders');

    // Backup: create, then restore into a fresh session.
    await page.click('.tabs button[data-view="backup"]');
    await page.click('#backup button:has-text("Back up now")');
    const backup = await page.evaluate(() => window.__saved.at(-1));
    assert.match(backup.name, /^aster-backup-\d{8}T\d{6}Z\.json$/);
    assert.equal(JSON.parse(backup.text).appVersion, '9.9.9');
    await page.evaluate(() => { for (const key of Object.keys(window.__store)) delete window.__store[key]; });
    await page.reload();
    await page.waitForSelector('html[data-ready="true"]');
    await page.evaluate(text => { window.__nextFile = {name: 'backup.json', text}; }, backup.text);
    await page.click('.tabs button[data-view="backup"]');
    await page.click('#backup button:has-text("Restore from backup")');
    await page.waitForSelector('#backup p:has-text("1 sources, 1 tasks, 1 cards")');
    await page.click('#backup button:has-text("Replace my data")');
    await page.waitForFunction(() => window.__store.library && window.__store.planner && window.__store.flashcards);

    // Corrupt stored data locks that module instead of overwriting it.
    await page.evaluate(() => { window.__store.planner = '{"schema":1,"tasks":[{"id":"bad"}]}'; });
    await page.reload();
    await page.waitForSelector('html[data-ready="true"]');
    await page.click('.tabs button[data-view="planner"]');
    await page.fill('#planner input[placeholder="What needs doing?"]', 'Should not save');
    await page.click('#planner button:has-text("Add")');
    await page.waitForSelector('#toast.error:has-text("locked")');
    assert.equal(await page.evaluate(() => window.__store.planner), '{"schema":1,"tasks":[{"id":"bad"}]}');

    assert.deepEqual(await page.evaluate(() => window.asterTools.selfTest().then(result => result.checks)),
      ['sha256', 'ics', 'chart', 'backup', 'storage', 'ui']);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
