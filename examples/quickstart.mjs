// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
// Runs every Aster module once and writes example files you can open:
//   node examples/quickstart.mjs [output-folder]
// Nothing is sent over the network.
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ResearchLibrary} from '../aster/research/library.mjs';
import {Planner, toIcs} from '../aster/study/planner.mjs';
import {FlashcardCollection} from '../aster/study/flashcards.mjs';
import {parseDelimited, inferColumns, numericColumn, describe, linearRegression} from '../aster/data/dataset.mjs';
import {renderChartSvg, tableToCsv} from '../aster/data/chart.mjs';
import {prepareRequest, buildPayload, ConsentBroker} from '../aster/ai/consent.mjs';
import {createBackup, readBackup, backupFileName} from '../aster/storage/backup.mjs';

const out = process.argv[2] || 'aster-example-output';
await mkdir(out, {recursive: true});
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const today = now.slice(0, 10);
const write = async (name, text) => { await writeFile(join(out, name), text); console.log(`  wrote ${join(out, name)}`); };

console.log('1. Research library');
const library = new ResearchLibrary();
library.addFolder({id: 'ee', name: 'Extended Essay'});
library.addSource({id: 'rail', folderId: 'ee', tags: ['primary'], addedAt: now, metadata: {
  title: 'The Economic History of Railways', authors: ['Ada Lovelace'], issued: [2024, 2, 29],
  url: 'https://example.org/railways', doi: '10.1234/example', website: 'History Review'}});
const duplicate = library.addSource({id: 'rail-copy', addedAt: now, metadata: {title: 'Copy', url: 'https://www.example.org/railways/?utm_source=mail'}});
console.log(`  duplicate detected: ${!duplicate.added} (same ${duplicate.reason} as "${duplicate.duplicateOf}")`);
await write('bibliography.bib', library.exportBibliography(['rail'], 'bibtex', today));
await write('bibliography.ris', library.exportBibliography(['rail'], 'ris', today));

console.log('2. Planner');
const planner = new Planner();
planner.add({id: 'ia', title: 'History IA draft', due: today, category: 'assignment', priority: 'high', course: 'History HL'});
planner.add({id: 'vocab', title: 'Vocabulary practice', due: today, time: '18:00', durationMinutes: 20,
  recurrence: {freq: 'weekly', byDay: ['MO', 'WE', 'FR'], count: 12}});
const {upcoming} = planner.agenda(today, {days: 7});
console.log(`  ${upcoming.length} item(s) in the next 7 days`);
await write('planner.ics', toIcs(planner.tasks, {now, calendarName: 'Aster example'}));

console.log('3. Flashcards');
const cards = new FlashcardCollection();
cards.importRows([['Powerhouse of the cell?', 'Mitochondria'], ['pH of pure water at 25 °C?', '7']], {prefix: 'bio', deck: 'Biology', created: today});
const reviewed = cards.review('bio-1', 4, today);
console.log(`  "bio-1" next due ${reviewed.due}; ${cards.stats(today).due} card(s) still due today`);

console.log('4. Data analysis and charts');
const table = parseDelimited('temperature,rate\n10,2.1\n20,3.9\n30,6.2\n40,7.8\n50,10.1\n');
console.log(`  columns: ${inferColumns(table).map(c => `${c.name} (${c.type})`).join(', ')}`);
const xs = numericColumn(table, 'temperature');
const ys = numericColumn(table, 'rate');
const fit = linearRegression(xs, ys);
console.log(`  mean rate ${describe(ys).mean.toFixed(2)}; rate = ${fit.slope.toFixed(3)} × temperature + ${fit.intercept.toFixed(3)} (R² ${fit.r2.toFixed(3)})`);
await write('chart.svg', renderChartSvg({type: 'scatter', title: 'Reaction rate vs temperature', xLabel: 'Temperature (°C)',
  yLabel: 'Rate', series: [{name: 'Trial 1', points: xs.map((x, i) => [x, ys[i]])}], trendline: fit}));
await write('data.csv', tableToCsv(table));

console.log('5. AI consent (no request is sent)');
const preview = await prepareRequest({requestId: 'demo', purpose: 'feedback', instructions: 'Is my thesis clear?',
  provider: {id: 'demo', name: 'Example provider', endpoint: 'https://api.example.com/v1', model: 'example', credential: {keychainRef: 'aster-ai/demo'}},
  items: [{label: 'Draft', text: 'Railways transformed trade. Contact me at student@example.com.'}]});
console.log(`  preview text: "${preview.items[0].text}"`);
const broker = new ConsentBroker();
const grant = broker.approve(preview);
await broker.authorizeSend(grant.grantId, buildPayload(preview));
console.log('  consent verified for the exact previewed content');

console.log('6. Backup');
const backup = await createBackup({modules: {library, planner, flashcards: cards}, createdAt: now, appVersion: '0.2.0', label: 'Example'});
const restored = await readBackup(backup);
console.log(`  restored ${restored.modules.library.size} source(s) and ${restored.modules.planner.tasks.length} task(s)`);
await write(backupFileName(now), backup);

console.log(`Done. Open the files in "${out}".`);
