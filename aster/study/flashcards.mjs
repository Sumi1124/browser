// Copyright 2026 Aster contributors. BSD-3-Clause; see LICENSE.
// Local flashcards with SM-2 spaced repetition (Wozniak, 1990). Card text is
// stored as plain text; the UI must render it as text, never as HTML.
import {clean, cleanMultiline, assertId, isPlainObject, assertLimit, assertDate, formatDate, fail} from '../common/util.mjs';

export const FLASHCARD_SCHEMA = 1;
export const FLASHCARD_LIMITS = Object.freeze({cards: 20000, historyPerCard: 50, textLength: 4096, maxIntervalDays: 36500});
const MIN_EASE = 1.3;

export function newCard({id, front, back, deck = 'General', tags = [], created}) {
  assertId(id, 'card ID');
  const card = {
    id, front: cleanMultiline(front, FLASHCARD_LIMITS.textLength), back: cleanMultiline(back, FLASHCARD_LIMITS.textLength),
    deck: clean(deck, 128) || 'General',
    tags: Array.isArray(tags) ? [...new Set(tags.map(tag => clean(tag, 64).toLowerCase()).filter(Boolean))].slice(0, 32).sort()
      : fail('invalid_card', 'Tags must be an array'),
    ease: 2.5, interval: 0, repetitions: 0, lapses: 0, due: formatDate(assertDate(created, 'created date')), history: [],
  };
  if (!card.front || !card.back) fail('invalid_card', 'A card needs a front and a back');
  return card;
}

// grade: 0–5 as in SM-2 (0 = blackout, 3 = correct with difficulty, 5 = perfect).
// Returns a new card; the input is not modified.
export function scheduleReview(card, grade, today) {
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) fail('invalid_grade', 'Grade must be an integer 0–5');
  const todayDay = assertDate(today, 'review date');
  const next = structuredClone(card);
  if (grade < 3) {
    next.repetitions = 0;
    next.interval = 1;
    next.lapses += 1;
  } else {
    next.interval = next.repetitions === 0 ? 1 : next.repetitions === 1 ? 6 : Math.round(next.interval * next.ease);
    next.repetitions += 1;
    const ease = next.ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
    next.ease = Math.max(MIN_EASE, Math.round(ease * 1000) / 1000);
  }
  next.interval = Math.min(next.interval, FLASHCARD_LIMITS.maxIntervalDays);
  next.due = formatDate(todayDay + next.interval);
  next.history = [...next.history, {date: today, grade}].slice(-FLASHCARD_LIMITS.historyPerCard);
  return next;
}

function validateStoredCard(input) {
  if (!isPlainObject(input)) fail('invalid_data', 'Invalid card record');
  const card = newCard({...input, created: input.due});
  const numbers = {ease: [MIN_EASE, 10], interval: [0, FLASHCARD_LIMITS.maxIntervalDays], repetitions: [0, 1e6], lapses: [0, 1e6]};
  for (const [key, [min, max]] of Object.entries(numbers)) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (key !== 'ease' && !Number.isInteger(value))) {
      fail('invalid_data', `Invalid card ${key}`);
    }
    card[key] = value;
  }
  if (!Array.isArray(input.history)) fail('invalid_data', 'Invalid card history');
  card.history = input.history.slice(-FLASHCARD_LIMITS.historyPerCard).map(entry => {
    if (!isPlainObject(entry) || !Number.isInteger(entry.grade) || entry.grade < 0 || entry.grade > 5) fail('invalid_data', 'Invalid review entry');
    assertDate(entry.date, 'review date');
    return {date: entry.date, grade: entry.grade};
  });
  return card;
}

export class FlashcardCollection {
  #cards = new Map();

  add(input) {
    const card = newCard(input);
    if (this.#cards.has(card.id)) fail('duplicate_id', 'Card already exists');
    assertLimit(this.#cards.size + 1, FLASHCARD_LIMITS.cards, 'cards');
    this.#cards.set(card.id, card);
    return card.id;
  }

  // Imports [front, back] rows, e.g. from parseDelimited(). IDs are
  // `${prefix}-${n}`. Blank rows are skipped and reported.
  importRows(rows, {prefix, deck, created}) {
    assertId(prefix, 'ID prefix');
    if (!Array.isArray(rows)) fail('invalid_input', 'Rows must be an array');
    const added = [];
    const skipped = [];
    let n = 0;
    rows.forEach((row, index) => {
      const [front, back] = Array.isArray(row) ? row : [];
      if (typeof front !== 'string' || typeof back !== 'string' || !clean(front) || !clean(back)) { skipped.push(index); return; }
      do n++; while (this.#cards.has(`${prefix}-${n}`));
      added.push(this.add({id: `${prefix}-${n}`, front, back, deck, created}));
    });
    return {added, skipped};
  }

  edit(id, {front, back, deck, tags}) {
    const card = this.#cards.get(id) || fail('not_found', 'Card not found');
    const updated = newCard({id, front: front ?? card.front, back: back ?? card.back, deck: deck ?? card.deck,
      tags: tags ?? card.tags, created: card.due});
    Object.assign(card, {front: updated.front, back: updated.back, deck: updated.deck, tags: updated.tags});
  }

  remove(id) { if (!this.#cards.delete(id)) fail('not_found', 'Card not found'); }
  get(id) { const card = this.#cards.get(id); return card ? structuredClone(card) : null; }
  get decks() { return [...new Set([...this.#cards.values()].map(card => card.deck))].sort(); }

  review(id, grade, today) {
    const card = this.#cards.get(id) || fail('not_found', 'Card not found');
    const next = scheduleReview(card, grade, today);
    this.#cards.set(id, next);
    return structuredClone(next);
  }

  // Cards due on or before `today`, most overdue first.
  due(today, {deck, limit = 50} = {}) {
    assertDate(today, 'today');
    return [...this.#cards.values()].filter(card => card.due <= today && (deck === undefined || card.deck === deck))
      .sort((a, b) => a.due.localeCompare(b.due) || a.ease - b.ease || a.id.localeCompare(b.id))
      .slice(0, limit).map(card => structuredClone(card));
  }

  stats(today, {deck} = {}) {
    assertDate(today, 'today');
    const cards = [...this.#cards.values()].filter(card => deck === undefined || card.deck === deck);
    const reviews = cards.flatMap(card => card.history);
    const correct = reviews.filter(entry => entry.grade >= 3).length;
    return {
      total: cards.length,
      new: cards.filter(card => card.repetitions === 0 && !card.history.length).length,
      due: cards.filter(card => card.due <= today).length,
      learned: cards.filter(card => card.interval >= 21).length,
      reviewedToday: reviews.filter(entry => entry.date === today).length,
      retention: reviews.length ? correct / reviews.length : null,
    };
  }

  toJSON() { return {schema: FLASHCARD_SCHEMA, cards: [...this.#cards.values()].map(card => structuredClone(card))}; }

  static fromJSON(data) {
    if (!isPlainObject(data) || data.schema !== FLASHCARD_SCHEMA || !Array.isArray(data.cards)) {
      fail('unsupported_schema', 'Unsupported flashcard data');
    }
    assertLimit(data.cards.length, FLASHCARD_LIMITS.cards, 'cards');
    const collection = new FlashcardCollection();
    for (const input of data.cards) {
      const card = validateStoredCard(input);
      if (collection.#cards.has(card.id)) fail('invalid_data', 'Duplicate card ID');
      collection.#cards.set(card.id, card);
    }
    return collection;
  }
}
