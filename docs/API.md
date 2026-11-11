# Aster module API

This is the reference for connecting Aster's interface designs to its tested logic. Every module below is a dependency-free ES module (Node 22+ or any modern browser engine). None of them touches the network, the filesystem or browser storage: each takes and returns plain data, and the embedder decides where serialized state lives.

**Status:** standalone and tested (`npm test`), **not yet connected** to the native browser UI. See [STATUS.md](STATUS.md).

## Conventions

- **Errors.** Every validation failure throws `AsterError` (from `aster/common/util.mjs`). It has a stable `code`, such as `invalid_id`, `not_found`, `duplicate_id`, `limit_exceeded`, `invalid_date` or `unsupported_schema`, and a user-readable `message`. UI code should branch on `code` and may show `message`. Fuzz tests check that corrupted input fails with `AsterError` and never with a `TypeError`.
- **IDs.** Every ID matches `[A-Za-z0-9_-]{1,64}`. The caller generates them, for example with `crypto.randomUUID()`.
- **Dates and times.** Calendar dates are `YYYY-MM-DD` strings. Timestamps are UTC ISO-8601 strings ending in `Z`, such as `2026-11-11T12:00:00Z`. Planner times are floating local `HH:MM` values, so a date never moves when the time zone or daylight-saving time changes.
- **Persistence.** Every stateful class has `toJSON()` → `{schema, …}` and `static fromJSON(data)`. `fromJSON` validates every record and rejects unknown schema versions. Use `storage/backup.mjs` to bundle several modules into one file.
- **Text.** Inputs are trimmed, stripped of control characters and length-bounded. Stored text is plain text, so the UI must render it as text, never as HTML.

```js
import {ResearchLibrary} from './aster/research/library.mjs';
import {Planner, toIcs} from './aster/study/planner.mjs';
import {FlashcardCollection} from './aster/study/flashcards.mjs';
import {parseDelimited, inferColumns, describe, numericColumn, linearRegression} from './aster/data/dataset.mjs';
import {renderChartSvg, tableToCsv} from './aster/data/chart.mjs';
import {prepareRequest, buildPayload, ConsentBroker} from './aster/ai/consent.mjs';
import {createBackup, readBackup, planRetention} from './aster/storage/backup.mjs';
```

---

## Citations: `aster/research/metadata.mjs`

Runs in an isolated renderer world. It extracts metadata only and never fetches anything.

| Function | Returns |
| --- | --- |
| `extractPageMetadata(document, pageUrl)` | `{title, authors[], issued, modified, website, publisher, url, doi, warnings[], missing[]}`. `issued` is `[y]`, `[y, m]`, `[y, m, d]` or `null`. `missing` names the fields the user must review. Values are never invented. |
| `toCsl(metadata, id, accessDate?)` | CSL-JSON item, `type: 'webpage'` |
| `toBibtex(metadata, id, accessDate?)` | One escaped `@misc` entry |
| `toRis(metadata, id, accessDate?)` | One `ELEC` record. Injected `ER`/`TY` lines are neutralized. |
| `safeUrl`, `isoDate`, `normalizeDoi` | Validation helpers |

Formatted styles (APA 7, MLA 9, Chicago, Harvard, IEEE) still need a maintained CSL processor and licensed style files. They are not implemented here.

## Research library: `aster/research/library.mjs`

```js
const library = new ResearchLibrary();
library.addFolder({id: 'ee', name: 'Extended Essay'});
library.addFolder({id: 'ee-1', name: 'Chapter 1', parentId: 'ee'});
const result = library.addSource({id: 's1', metadata: extracted, folderId: 'ee-1', tags: ['primary'], addedAt});
// → {added: true, id} or {added: false, duplicateOf: 's0', reason: 'doi'|'url'|'title', confidence: 'exact'|'likely'}
```

| Method | Notes |
| --- | --- |
| `addFolder({id, name, parentId?})`, `renameFolder(id, name)`, `removeFolder(id)` | Folders can be up to 8 levels deep. Sibling names must be unique, ignoring case. Only empty folders can be removed. |
| `addSource({id, metadata, folderId?, tags?, addedAt?, allowDuplicate?})` | Sanitizes metadata and returns duplicate information instead of adding a duplicate. Pass `allowDuplicate: true` once the user confirms. |
| `findDuplicate(metadata)` | `{id, reason, confidence}` or `null` |
| `getSource(id)`, `updateMetadata(id, metadata)`, `moveSource(id, folderId)`, `setTags(id, tags)`, `removeSource(id)` | Tags are lowercased, de-duplicated and sorted, with at most 32 per source. Removing a source also removes its annotations. |
| `addAnnotation({id, sourceId, quote?, note?, createdAt?})`, `removeAnnotation(id)`, `annotationsFor(sourceId)` | An annotation needs a quote or a note. |
| `query({folderId?, includeSubfolders?, tag?, text?})` | Filters combine with AND. `folderId: null` means unfiled. Results are sorted by `addedAt`. |
| `allTags()` | `[{tag, count}]` for a tag cloud or filter list |
| `exportBibliography(ids, 'csl-json'\|'bibtex'\|'ris', accessDate?)` | Throws on unknown IDs instead of silently dropping them |

Free functions: `sanitizeMetadata`, `mergeMissingFields(existing, incoming)` → `{metadata, filled[], conflicts[]}` (for a "merge duplicate" dialog: fills gaps, never overwrites), `normalizeUrlForMatch`, `titleFingerprint`, `duplicateKeys`.

**Duplicate rules:**

- **DOI:** an exact match, ignoring case.
- **URL:** an exact match after ignoring the scheme, `www.`, the fragment, `utm_*`/`fbclid`/`gclid`-style tracking parameters, parameter order and a trailing slash.
- **Title:** reported only as a *likely* duplicate. It needs a normalized title of at least 12 characters plus the same year and the same first-author surname.

## Planner: `aster/study/planner.mjs`

```js
const planner = new Planner();
planner.add({id: 'ia', title: 'History IA draft', due: '2026-11-20', category: 'assignment', priority: 'high', course: 'History HL'});
planner.add({id: 'lab', title: 'Lab', due: '2026-11-16', time: '14:00', durationMinutes: 90,
  recurrence: {freq: 'weekly', byDay: ['MO', 'TH'], until: '2026-12-17'}});
planner.complete('lab', '2026-11-16');
const {overdue, upcoming} = planner.agenda('2026-11-11', {days: 7});
const ics = toIcs(planner.tasks, {now: new Date().toISOString(), calendarName: 'School'});
```

**Task fields:**

| Field | Values |
| --- | --- |
| `id` | Required |
| `title` | Required |
| `due` | Required, `YYYY-MM-DD` |
| `time` | `HH:MM` or `null` for an all-day item |
| `durationMinutes` | Default 60, only valid with `time` |
| `category` | `task`, `assignment`, `exam`, `study`, `meeting` or `event` |
| `priority` | `low`, `normal` or `high` |
| `course`, `workspace`, `notes` | Free text |
| `recurrence` | Optional rule, see below |
| `completed` | Dates of completed occurrences |

**Recurrence** is `{freq: 'daily'|'weekly'|'monthly', interval?: 1–365, byDay?: ['MO',…] (weekly only), until?: date | count?: 1–1000}`. `count` includes occurrences before the requested range. A monthly rule on the 29th–31st skips months that don't have that day, as RFC 5545 specifies.

| Method / function | Returns |
| --- | --- |
| `add`, `update(id, changes)`, `remove`, `get`, `tasks` | Basic task management. IDs cannot change. |
| `complete(id, date?)`, `uncomplete(id, date?)` | `date` defaults to the due date. It throws if the task doesn't occur on that date. |
| `occurrences(from, to)` | `[{taskId, date, time, title, category, priority, course, done}]`, sorted by date. All-day items come before timed items, then items sort by priority. |
| `agenda(today, {days = 7, lookbackDays = 30})` | `{overdue, upcoming}`. Overdue items are open occurrences before today. |
| `expandOccurrences(task, from, to)` | Expands one task. Throws `limit_exceeded` above 5,000 occurrences. |
| `toIcs(tasks, {now, calendarName?, includeCompleted?})` | iCalendar text with `RRULE`, escaped text, CRLF line endings and lines folded at 75 octets on UTF-8 boundaries. Completed one-off tasks are left out unless `includeCompleted` is set. |

## Flashcards: `aster/study/flashcards.mjs`

Uses the SM-2 algorithm. Grades run from 0 to 5: below 3 is a lapse, which resets the card to a 1-day interval and keeps its ease. The ease factor never drops below 1.3.

| API | Notes |
| --- | --- |
| `add({id, front, back, deck?, tags?, created})` | `created` is the first due date |
| `importRows(rows, {prefix, deck, created})` | Takes `[front, back]` rows, for example `parseDelimited(text, {header: false}).rows`. Returns `{added: ids, skipped: rowIndexes}`. |
| `edit(id, {front?, back?, deck?, tags?})`, `remove(id)`, `get(id)`, `decks` | Basic card management |
| `review(id, grade, today)` | Returns the updated card. The last 50 reviews are kept for stats. |
| `due(today, {deck?, limit = 50})` | Most overdue first, then hardest (lowest ease) first |
| `stats(today, {deck?})` | `{total, new, due, learned (interval ≥ 21 d), reviewedToday, retention}` |
| `scheduleReview(card, grade, today)` | Pure function used by `review` |

## Datasets: `aster/data/dataset.mjs`

This module parses untrusted files, so it must run in a dedicated worker or sandboxed renderer, never in privileged browser code. Limits are 32 MiB, 200,000 rows, 512 columns and 32 KiB per cell.

A *table* is `{columns: string[], rows: string[][], warnings: string[]}`. Every row has `columns.length` cells.

| Function | Notes |
| --- | --- |
| `parseDelimited(text, {delimiter?, header = true})` | RFC 4180: quotes, doubled quotes, embedded newlines, CRLF/LF and BOM. Detects `,`, tab, `;` or `\|` automatically. Short rows are padded and reported in `warnings`. Duplicate or blank headers are renamed. |
| `parseJsonRecords(text)` | Takes an array of flat objects and keeps the order in which columns first appear. Nested values are kept as JSON text and reported. |
| `inferColumns(table)` | `[{name, index, type: 'number'\|'boolean'\|'date'\|'text'\|'empty', missing, distinct}]` |
| `parseNumber(value)` | Strict. Thousands separators, `%`, currency signs, hex and `Infinity` all give `null` rather than a guess. |
| `numericColumn(table, name)` | Numbers, with `null` for missing or non-numeric cells |
| `describe(values)` | `{count, missing, sum, mean, median, variance, sd, min, max, q1, q3}`. Variance and SD are for a sample (n−1). Quartiles use R type 7, the same as Excel `QUARTILE.INC`. |
| `frequencies(table, name, {limit})` | `{items: [{value, count}], distinct, missing}` |
| `linearRegression(xs, ys)` | Ordinary least squares on complete pairs: `{n, slope, intercept, r, r2, slopeStandardError, residualStandardError}` |
| `pearson(xs, ys)` | The correlation `r` |
| `cleanTable(table, {trim, dropEmptyRows, dropDuplicateRows})` | `{table, report: {trimmedCells, emptyRowsRemoved, duplicateRowsRemoved}}`. Returns a copy and does not modify the input. |

Missing values are `''`, `NA`, `N/A`, `null`, `NaN`, `-` and `—`, ignoring case. XLSX import is **not implemented**; it needs a vetted ZIP/XML parser inside the sandbox.

## Charts and exports: `aster/data/chart.mjs`

```js
const svg = renderChartSvg({type: 'scatter', title: 'Temperature vs rate', xLabel: '°C', yLabel: 'Rate',
  series: [{name: 'Trial 1', points: xs.map((x, i) => [x, ys[i]])}], trendline: linearRegression(xs, ys)});
```

| Function | Notes |
| --- | --- |
| `renderChartSvg(spec)` | Supports `bar` (grouped), `line` and `scatter`. Bar and line charts take `categories[]` plus `series: [{name, values}]`. Scatter charts take `series: [{name, points: [[x, y]]}]` and an optional `trendline: {slope, intercept}`. `null` values are skipped, and a line breaks at a gap. Limits are 12 series, 5,000 points and 200 categories. Width can be 240–2400 and height 180–1800. |
| `tableToCsv(table)` | RFC 4180 output. Cells that start with `= + - @`, a tab or a carriage return get a leading `'` to block spreadsheet formula injection. Plain numbers such as `-5` are left unchanged. |
| `niceTicks(min, max, count)`, `formatNumber(n)`, `PALETTE` | Axis helpers. The palette is Okabe–Ito, which stays distinguishable with common colour-vision deficiencies. |

The SVG output has a `<title>`/`<desc>` and `role="img"`, escapes all text, and contains no scripts, event handlers, links or external references. This makes it safe to save as a file. To show it inside a page, load it with `<img src="blob:…">`.

## AI consent: `aster/ai/consent.mjs`

This module holds policy only. It contains no network code and no stored secrets. The intended flow:

1. Validate the provider settings with `validateProviderConfig({id, name, endpoint, model, credential: {keychainRef: 'aster-ai/<id>'}})`. Only HTTPS is allowed, with no credentials or secret-looking parameters in the URL. The API key itself lives in the OS keychain, and only the privileged broker resolves it.
2. Call `await prepareRequest({requestId, provider, purpose, instructions, items: [{label, text, origin}], offTheRecord, redact = true})` to get a **preview**: `{provider: {name, host, model}, items (redacted text), totalCharacters, redactions, warnings, digest}`. It throws `private_profile` in private windows. Purposes are `explain`, `summarize`, `feedback`, `brainstorm`, `quiz`, `translate` and `other`.
3. Show the user the preview. On **Send**, call `broker.approve(preview)` → `{grantId, expiresAt}`. On **Cancel**, call `broker.deny(preview)`.
4. Immediately before transmitting, call `await broker.authorizeSend(grantId, buildPayload(preview))`. A grant works once, expires after 5 minutes by default, and fails with `payload_changed` if the content differs in any way from what the user approved.
5. Wrap the response with `labelGeneratedText(text, {provider, model, generatedAt})` so the UI can mark it as AI-generated and show `ACADEMIC_NOTICE`.

`redactSensitive(text)` replaces common API keys, bearer tokens, email addresses, Luhn-valid card numbers and 9–15-digit phone numbers. It is a safety net, not a guarantee, which is why the preview shows the user everything that will be sent. `broker.log` records decisions as metadata only (request ID, provider, purpose, size, digest), never content.

## Backups: `aster/storage/backup.mjs`

```js
const text = await createBackup({modules: {library, planner, flashcards}, createdAt: new Date().toISOString(), appVersion: '0.2.0', label: 'Before exams'});
const {modules, unknownModules, migratedFrom, warnings} = await readBackup(text, {migrations});
const {keep, remove} = planRetention(existingBackups, {keepLast: 5, keepDaily: 7, keepWeekly: 4, keepMonthly: 6});
```

| Function | Notes |
| --- | --- |
| `createBackup({modules, createdAt, appVersion, label?})` | Takes a map of module name to an instance with `toJSON()` or plain data with an integer `schema`. Produces `{format: 'aster-backup', version, createdAt, appVersion, label, modules, checksum: {algorithm: 'SHA-256', value}}`. The checksum covers canonical JSON, so key order doesn't matter. The size limit is 64 MiB. |
| `readBackup(text, {migrations?, codecs?, currentVersion?})` | Checks the checksum, then applies `migrations` (`[{from, to: from + 1, migrate(envelope)}]`) in order, then rebuilds each module with its codec. The default codecs are `library`, `planner` and `flashcards`. Unknown modules come back in `unknownModules` with a warning. A backup from a newer Aster fails with `newer_backup`, and a damaged one with `checksum_mismatch`. |
| `planRetention(backups, options)` | Grandfather-father-son rotation over `[{id, createdAt}]`. Returns the IDs to `keep` and `remove`, newest first. It refuses to remove every backup. |
| `backupFileName(createdAt)` | `aster-backup-20261111T120000Z.json` |

The checksum detects corruption and accidental edits. It is **not** a signature, and backups are **not** encrypted.

## Connecting a design

Each screen maps to one module:

| Screen | Module |
| --- | --- |
| Citation sidebar | `extractPageMetadata` → review form showing the `missing` fields → `ResearchLibrary.addSource` → on a duplicate, a merge dialog using `mergeMissingFields` |
| Library view | `query`, `allTags`, folders, `annotationsFor`, `exportBibliography` |
| Planner / Today | `agenda`, `occurrences` for a calendar grid, `complete`, `toIcs` for "Export to calendar" |
| Study | `due`, `review`, `stats` |
| Data | `parseDelimited` / `parseJsonRecords` in a worker → `inferColumns` preview → `cleanTable` → `describe` / `linearRegression` → `renderChartSvg` / `tableToCsv` |
| AI panel | `prepareRequest` → preview sheet → `approve` / `deny` → `authorizeSend` → `labelGeneratedText` |
| Settings → Backups | `createBackup`, `readBackup`, `planRetention` |

Show `AsterError.message` to the user, and use `code` for UI logic, such as offering to merge when a source is a duplicate.
