// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
// Study tools sidebar for the Aster Mac app. Runs in a WKWebView served from
// the app bundle (aster://app/). All page text is inserted with textContent,
// never innerHTML. Storage and file dialogs go through the native bridge.
import {ResearchLibrary, mergeMissingFields} from './aster/research/library.mjs';
import {BookmarkCollection} from './aster/research/bookmarks.mjs';
import {Planner, toIcs, CATEGORIES, PRIORITIES} from './aster/study/planner.mjs';
import {FlashcardCollection, scheduleReview} from './aster/study/flashcards.mjs';
import {parseDelimited, parseJsonRecords, inferColumns, numericColumn, describe, linearRegression} from './aster/data/dataset.mjs';
import {renderChartSvg, tableToCsv, formatNumber} from './aster/data/chart.mjs';
import {createBackup, readBackup, backupFileName} from './aster/storage/backup.mjs';
import {randomId, sha256Hex} from './aster/common/util.mjs';

// ---- Native bridge --------------------------------------------------------
const bridge = {
  call(op, args = {}) {
    const handler = window.webkit?.messageHandlers?.aster;
    if (!handler) return Promise.reject(new Error('The Aster app bridge is not available.'));
    return handler.postMessage({op, ...args});
  },
};

// ---- Helpers ----------------------------------------------------------------
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'value') node.value = value;
    else if (key === 'style') node.style.cssText = value; // CSSOM: allowed by the page's CSP, unlike style attributes
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
const pad = value => String(value).padStart(2, '0');
const localDate = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const today = () => localDate();
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const shortId = () => randomId().replace(/-/g, '').slice(0, 12);
const field = (label, control, {missing = false} = {}) => h('label', {class: `field${missing ? ' missing' : ''}`}, h('span', {text: label}), control);
const select = (options, value) => h('select', {}, options.map(([optionValue, text]) => h('option', {value: optionValue, selected: optionValue === value, text})));

let toastTimer;
function toast(message, {error = false} = {}) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.className = error ? 'error' : '';
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, error ? 6000 : 3000);
}
const showError = error => toast(error?.message || String(error), {error: true});

// ---- State and persistence -------------------------------------------------
const codecs = {library: ResearchLibrary, planner: Planner, flashcards: FlashcardCollection, bookmarks: BookmarkCollection};
const state = {
  library: new ResearchLibrary(), planner: new Planner(), flashcards: new FlashcardCollection(), bookmarks: new BookmarkCollection(),
  editBookmark: null,
  locked: new Set(), appVersion: '0.0.0',
  study: null, review: null, expanded: new Set(), selected: new Set(), filters: {},
  dataset: null, chart: null, pendingRestore: null,
};

async function loadAll() {
  try { state.appVersion = (await bridge.call('appInfo')).version || state.appVersion; } catch { /* keep default */ }
  for (const [key, codec] of Object.entries(codecs)) {
    try {
      const text = await bridge.call('load', {key});
      if (text) state[key] = codec.fromJSON(JSON.parse(text));
    } catch (error) {
      // Never overwrite data we could not read; the user can restore a backup.
      state.locked.add(key);
      toast(`Your ${key} data could not be read, so changes to it won't be saved. Restore a backup in the Backup tab. (${error.message})`, {error: true});
    }
  }
}

async function persist(key) {
  if (state.locked.has(key)) throw new Error(`Not saved: your ${key} data is locked until you restore a backup.`);
  await bridge.call('save', {key, text: JSON.stringify(state[key].toJSON())});
}

// Applies a change, saves it and re-renders. Errors are shown, not thrown.
async function change(key, update, view = key === 'flashcards' ? 'cards' : key) {
  try {
    const result = update();
    await persist(key);
    render(view);
    return result;
  } catch (error) {
    showError(error);
    render(view);
    return undefined;
  }
}

// ---- Planner ---------------------------------------------------------------
function dayLabel(date) {
  const now = today();
  const tomorrow = localDate(new Date(Date.now() + 86400000));
  if (date === now) return 'Today';
  if (date === tomorrow) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'});
}

const longDate = (date = new Date()) => date.toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'});

function viewHead(title, note) {
  return h('div', {class: 'view-head'}, h('h1', {text: title}), note ? h('span', {class: 'note', text: note}) : null);
}

const PLUS = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9"/></svg>';
function icon(svg) {
  const holder = document.createElement('span');
  holder.innerHTML = svg; // constant markup defined in this file, never user data
  return holder.firstChild;
}

function agendaItem(item, {overdue = false} = {}) {
  const task = state.planner.get(item.taskId);
  const toggle = h('input', {type: 'checkbox', class: `tick${overdue ? ' overdue' : ''}`, checked: item.done, 'aria-label': `Done: ${item.title}`,
    onchange: () => change('planner', () => (item.done ? state.planner.uncomplete(item.taskId, item.date) : state.planner.complete(item.taskId, item.date)))});
  const meta = [overdue && dayLabel(item.date), item.time, item.course, task?.recurrence && `repeats ${task.recurrence.freq === 'daily' ? 'daily' : task.recurrence.freq === 'weekly' ? 'weekly' : 'monthly'}`]
    .filter(Boolean).join(' · ');
  const badge = item.priority === 'high' ? h('span', {class: 'badge high', text: 'High'})
    : item.category !== 'task' ? h('span', {class: `badge${item.category === 'exam' ? ' exam' : ''}`, text: item.category[0].toUpperCase() + item.category.slice(1)}) : null;
  return h('li', {class: item.done ? 'done' : ''}, toggle,
    h('div', {class: 'body'}, h('div', {class: 'title', text: item.title}), meta ? h('div', {class: 'meta', text: meta}) : null),
    badge,
    h('button', {class: 'link danger', title: task?.recurrence ? 'Delete this task and all its repeats' : 'Delete task', 'aria-label': `Delete ${item.title}`, text: '✕',
      onclick: () => { if (!task?.recurrence || confirm(`Delete "${item.title}" and all its repeats?`)) change('planner', () => state.planner.remove(item.taskId)); }}));
}

function renderPlanner(root) {
  root.append(viewHead('Today', longDate()));
  const title = h('input', {placeholder: 'Add a task…', 'aria-label': 'New task'});
  const due = h('input', {type: 'date', value: today()});
  const time = h('input', {type: 'time'});
  const category = select(CATEGORIES.map(value => [value, value[0].toUpperCase() + value.slice(1)]), 'task');
  const priority = select(PRIORITIES.map(value => [value, `${value[0].toUpperCase() + value.slice(1)} priority`]), 'normal');
  const repeat = select([['', 'Does not repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month']], '');
  const course = h('input', {placeholder: 'Course, e.g. History HL'});
  const add = () => {
    if (!title.value.trim()) { title.focus(); return; }
    change('planner', () => state.planner.add({id: shortId(), title: title.value, due: due.value || today(), time: time.value || null,
      category: category.value, priority: priority.value, course: course.value,
      recurrence: repeat.value ? {freq: repeat.value} : null}));
  };
  title.addEventListener('keydown', event => { if (event.key === 'Enter') add(); });
  const addButton = h('button', {class: 'primary icon-button', 'aria-label': 'Add task', title: 'Add task', onclick: add});
  addButton.append(icon(PLUS));
  root.append(h('div', {class: 'quick-add'}, title, addButton),
    h('details', {class: 'more'}, h('summary', {text: 'Date, time and more'}),
      h('div', {class: 'card'},
        h('div', {class: 'row'}, h('label', {class: 'field grow'}, h('span', {text: 'Due'}), due), h('label', {class: 'field grow'}, h('span', {text: 'Time (optional)'}), time)),
        h('div', {class: 'row'}, h('div', {class: 'grow'}, category), h('div', {class: 'grow'}, priority)),
        h('div', {class: 'row'}, h('div', {class: 'grow'}, repeat), h('div', {class: 'grow'}, course)))));

  let agenda;
  try { agenda = state.planner.agenda(today(), {days: 14, lookbackDays: 30}); } catch (error) { showError(error); return; }
  if (agenda.overdue.length) {
    root.append(h('h2', {class: 'danger'}, 'Overdue ', h('span', {class: 'count', text: agenda.overdue.length})),
      h('div', {class: 'card flush'}, h('ul', {class: 'items'}, agenda.overdue.map(item => agendaItem(item, {overdue: true})))));
  }
  if (!agenda.upcoming.length) root.append(h('div', {class: 'card empty', text: 'Nothing planned for the next two weeks. Add a task above.'}));
  // Repeating tasks appear today and tomorrow, then only their next
  // occurrence, so a daily task doesn't fill every day for two weeks.
  const tomorrow = localDate(new Date(Date.now() + 86400000));
  const shownLater = new Set();
  const byDate = new Map();
  for (const item of agenda.upcoming) {
    if (item.date > tomorrow && state.planner.get(item.taskId)?.recurrence) {
      if (shownLater.has(item.taskId)) continue;
      shownLater.add(item.taskId);
    }
    byDate.set(item.date, [...(byDate.get(item.date) || []), item]);
  }
  for (const [date, items] of byDate) {
    root.append(h('h2', {text: dayLabel(date)}), h('div', {class: 'card flush'}, h('ul', {class: 'items'}, items.map(item => agendaItem(item)))));
  }
  if (state.planner.tasks.length) {
    root.append(h('div', {class: 'row'}, h('button', {class: 'link', text: 'Export to Calendar (.ics)…', onclick: async () => {
      try {
        const text = toIcs(state.planner.tasks, {now: nowIso(), calendarName: 'Aster Planner'});
        if (!text.includes('BEGIN:VEVENT')) { toast('Every task is already done, so there is nothing to export.', {error: true}); return; }
        const saved = await bridge.call('saveFile', {suggestedName: 'aster-planner.ics', text});
        if (saved) toast('Calendar file saved. Open it to add the tasks to Calendar.');
      } catch (error) { showError(error); }
    }})));
  }
}

// ---- Flashcards --------------------------------------------------------------
const intervalText = days => (days <= 1 ? '1 day' : days < 30 ? `${days} days` : days < 365 ? `${Math.round(days / 30)} mo` : `${Math.round(days / 365)} yr`);

function renderCards(root) {
  const decks = state.flashcards.decks;
  const deck = state.filters.deck && decks.includes(state.filters.deck) ? state.filters.deck : undefined;
  if (state.study) return renderStudy(root);
  const stats = state.flashcards.stats(today(), {deck});
  root.append(viewHead('Flashcards', `${stats.due} due`));
  const deckSelect = select([['', 'All decks'], ...decks.map(name => [name, name])], deck || '');
  deckSelect.setAttribute('aria-label', 'Deck');
  deckSelect.addEventListener('change', () => { state.filters.deck = deckSelect.value || undefined; render('cards'); });
  root.append(h('div', {class: 'card'},
    decks.length > 1 ? h('div', {class: 'row'}, h('div', {class: 'grow'}, deckSelect)) : null,
    h('p', {class: 'note', text: `${stats.total} cards · ${stats.learned} learned${stats.retention === null ? '' : ` · ${Math.round(stats.retention * 100)}% remembered`}`}),
    h('button', {class: 'primary', disabled: !stats.due, text: stats.due ? `Study now (${stats.due} due)` : 'Nothing due today',
      onclick: () => { state.study = {deck, revealed: false, done: 0, total: stats.due}; render('cards'); }})));

  const front = h('textarea', {placeholder: 'Question'});
  const back = h('textarea', {placeholder: 'Answer'});
  const deckInput = h('input', {placeholder: 'Deck', value: deck || decks[0] || 'General', list: 'deck-list'});
  root.append(h('h2', {text: 'Add a card'}), h('div', {class: 'card'},
    field('Front', front), field('Back', back), field('Deck', deckInput),
    h('datalist', {id: 'deck-list'}, decks.map(name => h('option', {value: name}))),
    h('button', {class: 'primary', text: 'Add card', onclick: () => {
      if (!front.value.trim() || !back.value.trim()) { toast('A card needs a front and a back.', {error: true}); return; }
      change('flashcards', () => state.flashcards.add({id: shortId(), front: front.value, back: back.value, deck: deckInput.value, created: today()}));
    }})));

  const header = h('input', {type: 'checkbox'});
  root.append(h('h2', {text: 'Import'}), h('div', {class: 'card'},
    h('p', {class: 'note', text: 'A CSV or TSV file with the question in the first column and the answer in the second.'}),
    h('label', {class: 'check'}, header, 'First row is a header'),
    h('button', {text: 'Import from file…', onclick: async () => {
      try {
        const file = await bridge.call('openFile', {types: ['csv', 'tsv', 'txt']});
        if (!file) return;
        const table = parseDelimited(file.text, {header: header.checked});
        const result = await change('flashcards', () => state.flashcards.importRows(table.rows.map(row => [row[0], row[1]]),
          {prefix: `i${shortId()}`, deck: deckInput.value || 'Imported', created: today()}));
        if (result) toast(`Imported ${result.added.length} card(s)${result.skipped.length ? `, skipped ${result.skipped.length} incomplete row(s)` : ''}.`);
      } catch (error) { showError(error); }
    }})));
}

function renderStudy(root) {
  const study = state.study;
  const [card] = state.flashcards.due(today(), {deck: study.deck, limit: 1});
  const total = Math.max(study.total || 0, study.done + (card ? 1 : 0));
  root.append(viewHead(study.deck || 'Study', card ? `${study.done + 1} of ${total}` : 'Finished'),
    h('div', {class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(study.done)},
      h('div', {style: `width: ${total ? Math.round((study.done / total) * 100) : 100}%`})));
  if (!card) {
    root.append(h('div', {class: 'card study'}, h('p', {class: 'face', text: 'All done for now'}),
      h('p', {class: 'note', text: `You reviewed ${study.done} card(s). Come back when more are due.`})),
    h('button', {class: 'primary', text: 'Back to cards', onclick: () => { state.study = null; render('cards'); }}));
    return;
  }
  const grade = value => change('flashcards', () => {
    state.flashcards.review(card.id, value, today());
    study.revealed = false;
    study.done += 1;
  });
  root.append(h('div', {class: 'card study'},
    h('div', {class: 'face', text: card.front}),
    study.revealed ? h('div', {class: 'face answer', text: card.back}) : null));
  if (study.revealed) {
    const grades = [['Again', 1, 'again'], ['Hard', 3, 'hard'], ['Good', 4, 'good'], ['Easy', 5, 'easy']]
      .map(([text, value, kind]) => ({text, value, kind, next: scheduleReview(card, value, today()).interval}));
    // A brand-new card comes back tomorrow whatever the grade, so only show
    // the next-review time when the choices actually differ.
    const differ = new Set(grades.map(item => item.next)).size > 1;
    root.append(h('p', {class: 'note', style: 'text-align: center', text: 'How well did you remember it?'}),
      h('div', {class: 'grades'}, grades.map(item => h('button', {class: item.kind, title: `Next review in ${intervalText(item.next)}`, onclick: () => grade(item.value)},
        item.text, differ ? h('small', {text: intervalText(item.next)}) : null))));
  } else {
    root.append(h('div', {class: 'row'}, h('button', {class: 'primary grow', text: 'Show answer', onclick: () => { study.revealed = true; render('cards'); }})));
  }
  root.append(h('div', {class: 'row'},
    h('button', {class: 'link', text: 'Stop studying', onclick: () => { state.study = null; render('cards'); }}),
    h('button', {class: 'link danger', text: 'Delete card', onclick: () => { if (confirm('Delete this card?')) change('flashcards', () => state.flashcards.remove(card.id)); }})));
}

// ---- Research library ------------------------------------------------------
function folderOptions() {
  const folders = state.library.folders;
  const result = [];
  const walk = (parentId, depth) => {
    for (const folder of folders.filter(item => item.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name))) {
      result.push([folder.id, `${'  '.repeat(depth)}${folder.name}`]);
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}

function parseIssued(text) {
  const value = text.trim();
  if (!value) return null;
  const match = value.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
  if (!match) throw new Error('Write the date as YYYY, YYYY-MM or YYYY-MM-DD.');
  return match.slice(1).filter(Boolean).map(Number);
}
const formatIssued = issued => (Array.isArray(issued) ? issued.map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-') : '');

// Shows extracted or existing metadata for the user to check before saving.
function renderReview(root) {
  const review = state.review;
  const m = review.metadata;
  const missing = new Set(review.missing || []);
  const inputs = {
    title: h('input', {value: m.title || ''}),
    authors: h('textarea', {placeholder: 'One author per line', value: (m.authors || []).join('\n')}),
    issued: h('input', {placeholder: 'YYYY-MM-DD', value: formatIssued(m.issued)}),
    website: h('input', {value: m.website || ''}),
    publisher: h('input', {value: m.publisher || ''}),
    url: h('input', {value: m.url || ''}),
    doi: h('input', {value: m.doi || ''}),
  };
  const folder = select([['', 'Unfiled'], ...folderOptions()], review.folderId || '');
  const tags = h('input', {placeholder: 'Tags, separated by commas', value: (review.tags || []).join(', ')});
  const collect = () => ({
    title: inputs.title.value, authors: inputs.authors.value.split('\n').map(line => line.trim()).filter(Boolean),
    issued: parseIssued(inputs.issued.value), website: inputs.website.value, publisher: inputs.publisher.value,
    url: inputs.url.value, doi: inputs.doi.value,
  });
  const tagList = () => tags.value.split(',').map(tag => tag.trim()).filter(Boolean);
  const finish = message => { state.review = null; toast(message); };
  const save = allowDuplicate => change('library', () => {
    const metadata = collect();
    if (review.editId) {
      state.library.updateMetadata(review.editId, metadata);
      state.library.moveSource(review.editId, folder.value || null);
      state.library.setTags(review.editId, tagList());
      finish('Source updated.');
      return;
    }
    const result = state.library.addSource({id: shortId(), metadata, folderId: folder.value || null, tags: tagList(), addedAt: nowIso(), allowDuplicate});
    if (result.added) finish('Source saved to your library.');
    else state.review = {...review, metadata, folderId: folder.value, tags: tagList(), duplicate: result};
  }, 'library');

  const card = h('div', {class: 'card'}, h('strong', {text: review.editId ? 'Edit source' : 'Check the citation details'}));
  if (missing.size && !review.editId) card.append(h('div', {class: 'warn', text: `Not found on the page: ${[...missing].join(', ')}. Fill these in if you can; nothing is guessed.`}));
  for (const warning of review.warnings || []) card.append(h('div', {class: 'warn', text: warning}));
  const labels = {title: 'Title', authors: 'Authors', issued: 'Published (YYYY-MM-DD)', website: 'Website or journal', publisher: 'Publisher', url: 'URL', doi: 'DOI'};
  for (const [key, label] of Object.entries(labels)) card.append(field(label, inputs[key], {missing: missing.has(key)}));
  card.append(field('Folder', folder), field('Tags', tags));
  if (review.duplicate) {
    const existing = state.library.getSource(review.duplicate.duplicateOf);
    card.append(h('div', {class: 'warn', text: `This ${review.duplicate.confidence === 'exact' ? 'is already' : 'looks like it is already'} in your library (same ${review.duplicate.reason}): "${existing?.metadata.title || existing?.metadata.url}".`}),
      h('div', {class: 'row'},
        h('button', {class: 'primary', text: 'Fill gaps in existing', onclick: () => change('library', () => {
          const merged = mergeMissingFields(existing.metadata, collect());
          state.library.updateMetadata(existing.id, merged.metadata);
          finish(merged.filled.length ? `Added ${merged.filled.join(', ')} to the existing source.` : 'The existing source already had these details.');
        })}),
        h('button', {text: 'Save separately', onclick: () => save(true)})));
  } else {
    card.append(h('div', {class: 'row'}, h('button', {class: 'primary', text: 'Save', onclick: () => save(false)}),
      h('button', {text: 'Cancel', onclick: () => { state.review = null; render('library'); }})));
  }
  root.append(card);
}

async function citeCurrentPage() {
  try {
    const metadata = await bridge.call('citeCurrentPage');
    receiveCitation(metadata);
  } catch (error) { showError(error); }
}

function receiveCitation(metadata) {
  if (!metadata || typeof metadata !== 'object') return;
  state.review = {metadata, missing: metadata.missing || [], warnings: metadata.warnings || []};
  selectView('library');
}

function sourceItem(source) {
  const m = source.metadata;
  const expanded = state.expanded.has(source.id);
  const meta = [m.authors.slice(0, 3).join(', ') + (m.authors.length > 3 ? ' et al.' : ''), m.issued?.[0], m.website].filter(Boolean).join(' · ');
  const check = h('input', {type: 'checkbox', checked: state.selected.has(source.id), 'aria-label': `Select ${m.title || m.url}`,
    onchange: () => { if (check.checked) state.selected.add(source.id); else state.selected.delete(source.id); render('library'); }});
  const body = h('div', {class: 'body'},
    m.url ? h('button', {class: 'link', text: m.title || m.url, title: m.url, onclick: () => bridge.call('openURL', {url: m.url}).catch(showError)})
      : h('span', {class: 'title', text: m.title || m.doi}),
    meta ? h('div', {class: 'meta', text: meta}) : null,
    h('div', {}, source.tags.map(tag => h('span', {class: 'badge', text: tag}))),
    h('div', {class: 'row'},
      h('button', {class: 'link', text: expanded ? 'Hide notes' : `Notes (${state.library.annotationsFor(source.id).length})`,
        onclick: () => { if (expanded) state.expanded.delete(source.id); else state.expanded.add(source.id); render('library'); }}),
      h('button', {class: 'link', text: 'Edit', onclick: () => { state.review = {editId: source.id, metadata: m, folderId: source.folderId || '', tags: source.tags}; render('library'); window.scrollTo(0, 0); }}),
      h('button', {class: 'link danger', text: 'Delete', onclick: () => { if (confirm('Delete this source and its notes?')) change('library', () => { state.selected.delete(source.id); state.library.removeSource(source.id); }); }})));
  if (expanded) {
    const quote = h('textarea', {placeholder: 'Quote (optional)'});
    const note = h('textarea', {placeholder: 'Your note'});
    body.append(h('ul', {class: 'items'}, state.library.annotationsFor(source.id).map(annotation => h('li', {},
      h('div', {class: 'body'}, annotation.quote ? h('div', {class: 'meta', text: `“${annotation.quote}”`}) : null, annotation.note ? h('div', {text: annotation.note}) : null),
      h('button', {class: 'link danger', text: '✕', 'aria-label': 'Delete note', onclick: () => change('library', () => state.library.removeAnnotation(annotation.id))})))),
    quote, note, h('button', {text: 'Add note', onclick: () => change('library', () => state.library.addAnnotation({id: shortId(), sourceId: source.id, quote: quote.value, note: note.value, createdAt: nowIso()}))}));
  }
  return h('li', {}, check, body);
}

function renderLibrary(root) {
  root.append(viewHead('Library', `${state.library.size} source${state.library.size === 1 ? '' : 's'}`),
    h('div', {class: 'row'}, h('button', {class: 'primary', text: 'Cite current page', onclick: citeCurrentPage}), h('span', {class: 'note', text: 'or press ⌥⌘C'})));
  if (state.review) renderReview(root);

  const f = state.filters;
  const folderSelect = select([['*', 'All folders'], ['', 'Unfiled'], ...folderOptions()], f.folder ?? '*');
  const tagSelect = select([['', 'All tags'], ...state.library.allTags().map(({tag, count}) => [tag, `${tag} (${count})`])], f.tag || '');
  const search = h('input', {type: 'search', placeholder: 'Search title, author, site', value: f.text || ''});
  folderSelect.addEventListener('change', () => { f.folder = folderSelect.value; render('library'); });
  tagSelect.addEventListener('change', () => { f.tag = tagSelect.value; render('library'); });
  search.addEventListener('change', () => { f.text = search.value; render('library'); });
  const newFolder = h('input', {placeholder: 'New folder name'});
  root.append(h('h2', {text: 'Your sources'}), h('div', {class: 'card'},
    h('div', {class: 'row'}, h('div', {class: 'grow'}, folderSelect), h('div', {class: 'grow'}, tagSelect)),
    h('div', {class: 'row'}, h('div', {class: 'grow'}, search)),
    h('div', {class: 'row'}, h('div', {class: 'grow'}, newFolder), h('button', {text: 'Add folder', onclick: () => {
      if (!newFolder.value.trim()) return;
      change('library', () => state.library.addFolder({id: shortId(), name: newFolder.value, parentId: f.folder && f.folder !== '*' ? f.folder : null}));
    }}))));

  const query = {};
  if (f.folder !== undefined && f.folder !== '*') { query.folderId = f.folder || null; query.includeSubfolders = true; }
  if (f.tag) query.tag = f.tag;
  if (f.text) query.text = f.text;
  const sources = state.library.query(query).reverse();
  root.append(sources.length ? h('div', {class: 'card'}, h('ul', {class: 'items'}, sources.map(sourceItem)))
    : h('div', {class: 'card empty', text: state.library.size ? 'No sources match.' : 'Open a web page and press "Cite current page".'}));

  const format = select([['bibtex', 'BibTeX (.bib)'], ['ris', 'RIS (.ris)'], ['csl-json', 'CSL-JSON (.json)']], f.format || 'bibtex');
  format.addEventListener('change', () => { f.format = format.value; });
  const chosen = [...state.selected].filter(id => state.library.getSource(id));
  const ids = chosen.length ? chosen : sources.map(source => source.id);
  root.append(h('div', {class: 'card'}, h('div', {class: 'row'}, h('div', {class: 'grow'}, format),
    h('button', {disabled: !ids.length, text: chosen.length ? `Export ${chosen.length} selected…` : `Export ${ids.length} shown…`, onclick: async () => {
      try {
        const text = state.library.exportBibliography(ids, format.value, today());
        const extension = {bibtex: 'bib', ris: 'ris', 'csl-json': 'json'}[format.value];
        if (await bridge.call('saveFile', {suggestedName: `bibliography.${extension}`, text})) toast('Bibliography saved.');
      } catch (error) { showError(error); }
    }}))));
}

// ---- Data ----------------------------------------------------------------------
function loadDataset(name, text) {
  const trimmed = text.trimStart();
  const table = name.toLowerCase().endsWith('.json') || trimmed.startsWith('[') ? parseJsonRecords(text) : parseDelimited(text);
  if (!table.columns.length) throw new Error('No data found.');
  state.dataset = {name, table, columns: inferColumns(table)};
  state.chart = null;
  render('data');
}

function drawChart(type, xName, yName, title) {
  const {table} = state.dataset;
  const ys = numericColumn(table, yName);
  if (type === 'scatter') {
    const xs = numericColumn(table, xName);
    let fit = null;
    try { fit = linearRegression(xs, ys); } catch { /* not enough data for a trend line */ }
    const points = xs.map((x, i) => [x, ys[i]]);
    const svg = renderChartSvg({type, title, xLabel: xName, yLabel: yName, series: [{name: yName, points}], trendline: fit && {slope: fit.slope, intercept: fit.intercept}});
    state.chart = {svg, note: fit ? `${yName} = ${formatNumber(fit.slope)} × ${xName} + ${formatNumber(fit.intercept)}${fit.r2 === null ? '' : `   (R² = ${fit.r2.toFixed(3)}, n = ${fit.n})`}` : 'Not enough data for a trend line.'};
  } else {
    if (table.rows.length > 200) throw new Error('Bar and line charts can show up to 200 rows. Use a scatter chart or a smaller file.');
    const index = table.columns.indexOf(xName);
    const svg = renderChartSvg({type, title, xLabel: xName, yLabel: yName, categories: table.rows.map(row => row[index]), series: [{name: yName, values: ys}]});
    state.chart = {svg, note: ''};
  }
  render('data');
}

function renderData(root) {
  root.append(viewHead('Data', 'Statistics and charts'));
  const paste = h('textarea', {placeholder: 'Paste CSV, TSV or JSON here'});
  root.append(h('div', {class: 'card'},
    h('div', {class: 'row'}, h('button', {class: 'primary', text: 'Open file…', onclick: async () => {
      try { const file = await bridge.call('openFile', {types: ['csv', 'tsv', 'txt', 'json']}); if (file) loadDataset(file.name, file.text); } catch (error) { showError(error); }
    }})), paste, h('div', {class: 'row'}, h('button', {text: 'Use pasted data', onclick: () => { try { loadDataset('Pasted data', paste.value); } catch (error) { showError(error); } }})),
    h('p', {class: 'note', text: 'Data stays on your Mac and is not saved between sessions.'})));
  if (!state.dataset) return;
  const {name, table, columns} = state.dataset;
  const numeric = columns.filter(column => column.type === 'number');
  root.append(h('h2', {text: `${name}: ${table.rows.length} rows`}));
  for (const warning of table.warnings) root.append(h('div', {class: 'warn', text: warning}));
  root.append(h('div', {class: 'card'}, h('table', {},
    h('thead', {}, h('tr', {}, ['Column', 'Type', 'Missing'].map(text => h('th', {text})))),
    h('tbody', {}, columns.map(column => h('tr', {}, h('td', {text: column.name}), h('td', {text: column.type}), h('td', {class: 'num', text: column.missing})))))));
  if (numeric.length) {
    root.append(h('h2', {text: 'Statistics'}), h('div', {class: 'card'}, h('table', {},
      h('thead', {}, h('tr', {}, ['', 'n', 'Mean', 'SD', 'Min', 'Median', 'Max'].map(text => h('th', {text})))),
      h('tbody', {}, numeric.map(column => {
        const stats = describe(numericColumn(table, column.name));
        const cell = value => h('td', {class: 'num', text: value === null ? '–' : formatNumber(value)});
        return h('tr', {}, h('td', {text: column.name}), h('td', {class: 'num', text: stats.count}), cell(stats.mean), cell(stats.sd), cell(stats.min), cell(stats.median), cell(stats.max));
      })))));
    const type = select([['scatter', 'Scatter + trend line'], ['line', 'Line'], ['bar', 'Bar']], 'scatter');
    const x = select(columns.map(column => [column.name, column.name]), numeric[0].name);
    const y = select(numeric.map(column => [column.name, column.name]), (numeric[1] || numeric[0]).name);
    const title = h('input', {placeholder: 'Chart title'});
    root.append(h('h2', {text: 'Chart'}), h('div', {class: 'card'},
      field('Type', type), h('div', {class: 'row'}, h('div', {class: 'grow'}, field('X', x)), h('div', {class: 'grow'}, field('Y', y))), field('Title', title),
      h('button', {class: 'primary', text: 'Draw chart', onclick: () => { try { drawChart(type.value, x.value, y.value, title.value); } catch (error) { showError(error); } }})));
  }
  if (state.chart) {
    const url = URL.createObjectURL(new Blob([state.chart.svg], {type: 'image/svg+xml'}));
    root.append(h('div', {class: 'card chart'}, h('img', {src: url, alt: 'Chart'}), state.chart.note ? h('p', {class: 'note', text: state.chart.note}) : null,
      h('button', {text: 'Save chart (.svg)…', onclick: () => bridge.call('saveFile', {suggestedName: 'chart.svg', text: state.chart.svg}).then(saved => saved && toast('Chart saved.')).catch(showError)})));
  }
  root.append(h('div', {class: 'row'}, h('button', {text: 'Export as CSV…', onclick: () => bridge.call('saveFile', {suggestedName: 'data.csv', text: tableToCsv(table)}).then(saved => saved && toast('CSV saved.')).catch(showError)})));
}

// ---- Bookmarks -----------------------------------------------------------------
async function bookmarkCurrentPage() {
  try {
    const page = await bridge.call('currentPage');
    await change('bookmarks', () => {
      const result = state.bookmarks.add({id: shortId(), url: page.url, title: page.title, addedAt: nowIso()});
      toast(result.added ? 'Bookmarked.' : 'This page is already bookmarked.');
    });
  } catch (error) { showError(error); }
}

function folderName(id) {
  return state.bookmarks.folders.find(folder => folder.id === id)?.name || '';
}

function renderBookmarkEditor(root) {
  const bookmark = state.bookmarks.get(state.editBookmark);
  if (!bookmark) { state.editBookmark = null; return; }
  const title = h('input', {value: bookmark.title});
  const url = h('input', {value: bookmark.url});
  const folder = select([['', 'Unfiled'], ...state.bookmarks.folders.map(item => [item.id, item.name])], bookmark.folderId || '');
  root.append(h('div', {class: 'card'}, h('strong', {text: 'Edit bookmark'}),
    field('Name', title), field('Address', url), field('Folder', folder),
    h('div', {class: 'row'},
      h('button', {class: 'primary', text: 'Save', onclick: () => change('bookmarks', () => {
        state.bookmarks.update(bookmark.id, {title: title.value, url: url.value, folderId: folder.value || null});
        state.editBookmark = null;
      })}),
      h('button', {text: 'Cancel', onclick: () => { state.editBookmark = null; render('bookmarks'); }}))));
}

const MONOGRAM_COLORS = [['var(--good-soft)', 'var(--good)'], ['var(--blue-soft)', 'var(--blue)'], ['var(--accent-soft)', 'var(--accent-strong)'],
  ['var(--amber-soft)', 'var(--amber)'], ['var(--danger-soft)', 'var(--danger)'], ['var(--segment)', 'var(--text)']];
// Letter from the bookmark's name ("Wikipedia" → W), colour from its address.
function monogram(name, host) {
  const label = (host || name).replace(/^www\./, '');
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  const [bg, fg] = MONOGRAM_COLORS[hash % MONOGRAM_COLORS.length];
  const letter = [...name].find(char => /[\p{L}\p{N}]/u.test(char)) || label[0] || '?';
  return h('span', {class: 'monogram', 'aria-hidden': 'true', style: `background: ${bg}; color: ${fg}`, text: letter.toUpperCase()});
}

function renderBookmarks(root) {
  const f = state.filters;
  const folders = state.bookmarks.folders;
  if (f.bmFolder && f.bmFolder !== '*' && !folders.some(folder => folder.id === f.bmFolder)) f.bmFolder = '*';
  const head = viewHead('Bookmarks');
  head.append(h('button', {class: 'primary', text: 'Bookmark this page', title: 'Bookmark the page you are viewing (⌘D)', onclick: bookmarkCurrentPage}));
  root.append(head);
  if (state.editBookmark) renderBookmarkEditor(root);

  const current = f.bmFolder ?? '*';
  const chip = (id, label) => h('button', {'aria-pressed': String(current === id), text: label, onclick: () => { f.bmFolder = id; render('bookmarks'); }});
  const chips = h('div', {class: 'chips', role: 'group', 'aria-label': 'Folders'},
    chip('*', 'All'), folders.map(folder => chip(folder.id, folder.name)), chip('', 'Unfiled'));
  const search = h('input', {type: 'search', placeholder: 'Search bookmarks', value: f.bmText || ''});
  search.addEventListener('input', () => { f.bmText = search.value; renderBookmarkList(); });
  const newFolder = h('input', {placeholder: 'New folder name'});
  const selected = f.bmFolder && f.bmFolder !== '*' ? folders.find(folder => folder.id === f.bmFolder) : null;
  root.append(h('div', {class: 'row'}, h('div', {class: 'grow'}, search)), chips, h('div', {class: 'card'},
    selected ? h('div', {class: 'row'},
      h('button', {class: 'link', text: 'Rename folder', onclick: () => {
        const name = prompt('Folder name', selected.name);
        if (name !== null) change('bookmarks', () => state.bookmarks.renameFolder(selected.id, name));
      }}),
      h('button', {class: 'link danger', text: 'Delete folder', onclick: () => {
        if (confirm(`Delete the folder "${selected.name}"? Its bookmarks are kept as unfiled.`)) {
          change('bookmarks', () => { state.bookmarks.removeFolder(selected.id); f.bmFolder = '*'; });
        }
      }})) : null,
    h('div', {class: 'row'}, h('div', {class: 'grow'}, newFolder), h('button', {text: 'Add folder', onclick: () => {
      if (newFolder.value.trim()) change('bookmarks', () => { state.bookmarks.addFolder({id: shortId(), name: newFolder.value}); toast('Folder added. Use Edit on a bookmark to move it there.'); });
    }}))));

  const listCard = h('div', {class: 'card flush', id: 'bookmark-list'});
  root.append(listCard);
  function renderBookmarkList() {
    const query = {};
    if (f.bmFolder !== undefined && f.bmFolder !== '*') query.folderId = f.bmFolder || null;
    if (f.bmText) query.text = f.bmText;
    const items = state.bookmarks.list(query).reverse();
    listCard.replaceChildren(items.length ? h('ul', {class: 'items'}, items.map(bookmark => {
      let host = '';
      try { host = new URL(bookmark.url).hostname; } catch { /* stored URLs are validated */ }
      return h('li', {}, monogram(bookmark.title, host),
        h('div', {class: 'body'},
          h('button', {class: 'link title', text: bookmark.title, title: bookmark.url, onclick: () => bridge.call('openURL', {url: bookmark.url}).catch(showError)}),
          h('div', {class: 'meta', text: [host, bookmark.folderId && folderName(bookmark.folderId)].filter(Boolean).join(' · ')}),
          h('div', {class: 'row'},
            h('button', {class: 'link', text: 'Edit', onclick: () => { state.editBookmark = bookmark.id; render('bookmarks'); window.scrollTo(0, 0); }}),
            h('button', {class: 'link danger', text: 'Delete', onclick: () => change('bookmarks', () => state.bookmarks.remove(bookmark.id))}))));
    })) : h('p', {class: 'empty', text: state.bookmarks.size ? 'No bookmarks match.' : 'No bookmarks yet. Press ⌘D on any page.'}));
  }
  renderBookmarkList();

  root.append(h('h2', {text: 'Import and export'}), h('div', {class: 'card'},
    h('p', {class: 'note', text: 'Uses the standard bookmarks file (.html) that Safari, Chrome, Firefox and Edge can export and import.'}),
    h('div', {class: 'row'},
      h('button', {text: 'Import…', onclick: async () => {
        try {
          const file = await bridge.call('openFile', {types: ['html', 'htm']});
          if (!file) return;
          const result = await change('bookmarks', () => state.bookmarks.importNetscapeHtml(file.text, {makeId: shortId, now: nowIso()}));
          if (result) toast(`Imported ${result.added} bookmark(s)${result.duplicates ? `, ${result.duplicates} already saved` : ''}${result.skipped ? `, ${result.skipped} skipped (not web pages)` : ''}.`);
        } catch (error) { showError(error); }
      }}),
      h('button', {text: 'Export…', disabled: !state.bookmarks.size, onclick: async () => {
        try {
          if (await bridge.call('saveFile', {suggestedName: 'Aster Bookmarks.html', text: state.bookmarks.toNetscapeHtml()})) toast('Bookmarks exported.');
        } catch (error) { showError(error); }
      }}))));
}

// ---- Backup --------------------------------------------------------------------
function renderBackup(root) {
  root.append(viewHead('Backup'));
  const counts = `${state.library.size} sources, ${state.planner.tasks.length} tasks, ${state.flashcards.toJSON().cards.length} cards, ${state.bookmarks.size} bookmarks`;
  if (state.locked.size) root.append(h('div', {class: 'warn', text: `Locked because it could not be read: ${[...state.locked].join(', ')}. Restore a backup to fix this.`}));
  root.append(h('div', {class: 'card'},
    h('p', {text: `Save a copy of your library, planner, flashcards and bookmarks (${counts}) to a file you choose.`}),
    h('p', {class: 'note', text: 'Backups are checked for damage when restored. They are not encrypted, so keep them somewhere private.'}),
    h('button', {class: 'primary', text: 'Back up now…', onclick: async () => {
      try {
        const createdAt = nowIso();
        const text = await createBackup({modules: {library: state.library, planner: state.planner, flashcards: state.flashcards, bookmarks: state.bookmarks}, createdAt, appVersion: state.appVersion, label: 'Aster for Mac'});
        if (await bridge.call('saveFile', {suggestedName: backupFileName(createdAt), text})) toast('Backup saved.');
      } catch (error) { showError(error); }
    }})));

  root.append(h('h2', {text: 'Restore'}));
  if (state.pendingRestore) {
    const restore = state.pendingRestore;
    const m = restore.modules;
    root.append(h('div', {class: 'card'},
      h('p', {text: `Backup from ${new Date(restore.createdAt).toLocaleString()}: ${m.library?.size ?? 0} sources, ${m.planner?.tasks.length ?? 0} tasks, ${m.flashcards?.toJSON().cards.length ?? 0} cards, ${m.bookmarks?.size ?? 0} bookmarks.`}),
      restore.warnings.map(text => h('div', {class: 'warn', text})),
      h('div', {class: 'warn', text: 'Restoring replaces your current library, planner, flashcards and bookmarks (whatever the backup contains).'}),
      h('div', {class: 'row'},
        h('button', {class: 'primary', text: 'Replace my data', onclick: async () => {
          try {
            for (const key of Object.keys(codecs)) {
              if (!m[key]) continue;
              state[key] = m[key];
              state.locked.delete(key);
              await persist(key);
            }
            state.pendingRestore = null;
            state.selected.clear();
            toast('Backup restored.');
            renderAll();
          } catch (error) { showError(error); }
        }}),
        h('button', {text: 'Cancel', onclick: () => { state.pendingRestore = null; render('backup'); }}))));
  } else {
    root.append(h('div', {class: 'card'}, h('button', {text: 'Restore from backup…', onclick: async () => {
      try {
        const file = await bridge.call('openFile', {types: ['json']});
        if (!file) return;
        state.pendingRestore = await readBackup(file.text);
        render('backup');
      } catch (error) { showError(error); }
    }})));
  }
}

// ---- Views ---------------------------------------------------------------------
const renderers = {planner: renderPlanner, cards: renderCards, library: renderLibrary, bookmarks: renderBookmarks, data: renderData, backup: renderBackup};
function render(view) {
  const root = document.getElementById(view);
  root.replaceChildren();
  try { renderers[view](root); } catch (error) { showError(error); }
}
function renderAll() { for (const view of Object.keys(renderers)) render(view); }

function selectView(view) {
  for (const button of document.querySelectorAll('.tabs button')) button.setAttribute('aria-selected', String(button.dataset.view === view));
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== view;
  try { localStorage.setItem('aster.view', view); } catch { /* storage may be unavailable */ }
  render(view);
}

// Exercises every module and the native storage bridge. Used by the app's
// --self-test mode in CI.
async function selfTest() {
  const checks = [];
  const check = (name, ok) => { checks.push({name, ok}); if (!ok) throw new Error(`Self-test failed: ${name}`); };
  check('sha256', await sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const planner = new Planner();
  planner.add({id: 't', title: 'Test', due: '2026-11-16', recurrence: {freq: 'weekly'}});
  check('ics', toIcs(planner.tasks, {now: '2026-11-11T00:00:00Z'}).includes('RRULE:FREQ=WEEKLY'));
  check('chart', renderChartSvg({type: 'bar', categories: ['a'], series: [{values: [1]}]}).startsWith('<svg'));
  const text = await createBackup({modules: {planner}, createdAt: '2026-11-11T00:00:00Z', appVersion: '0.0.0'});
  check('backup', (await readBackup(text)).modules.planner.tasks.length === 1);
  await bridge.call('save', {key: 'self-test', text: 'ok ✓'});
  check('storage', await bridge.call('load', {key: 'self-test'}) === 'ok ✓');
  const marks = new BookmarkCollection();
  marks.add({id: 'b', url: 'https://example.org/', title: 'Example', addedAt: '2026-11-11T00:00:00Z'});
  const copy = new BookmarkCollection();
  check('bookmarks', copy.importNetscapeHtml(marks.toNetscapeHtml(), {makeId: shortId}).added === 1);
  check('ui', document.querySelectorAll('.tabs button').length === Object.keys(renderers).length);
  return {ok: true, checks: checks.map(item => item.name)};
}

// Another window saved this module: reload it so this panel never writes back stale data.
async function reload(key) {
  if (!codecs[key]) return;
  try {
    const text = await bridge.call('load', {key});
    state[key] = text ? codecs[key].fromJSON(JSON.parse(text)) : new codecs[key]();
    state.locked.delete(key);
  } catch (error) {
    state.locked.add(key);
    showError(error);
  }
  renderAll();
}

window.asterTools = {receiveCitation, selectView, selfTest, reload};

document.querySelector('.tabs').addEventListener('click', event => {
  const view = event.target.closest('button')?.dataset.view;
  if (view) selectView(view);
});
await loadAll();
let initial = 'planner';
try { initial = localStorage.getItem('aster.view') || initial; } catch { /* default view */ }
selectView(renderers[initial] ? initial : 'planner');
document.documentElement.dataset.ready = 'true';
