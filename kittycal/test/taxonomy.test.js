// @ts-check
/**
 * taxonomy.test.js — guards on the option data itself.
 *
 * `labelOf` resolves an option id without knowing its category, which is only
 * sound while ids stay unambiguous. That is a property of the *data*, not the
 * code, so it is asserted here rather than assumed in a comment — adding an
 * option that reuses an existing id would otherwise silently mislabel it
 * everywhere derived data is shown.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES, labelOf, labelFor, labelIndexEntries, optionCount,
  optionMatches, normalizeQuery,
} from '../js/data/taxonomy.js';
import { loggedIds } from '../js/domain/stats.js';

test('ids in the flat label index are unambiguous', () => {
  /** @type {Map<string, {category: string, label: string}>} */
  const seen = new Map();
  /** @type {string[]} */
  const clashes = [];

  for (const entry of labelIndexEntries()) {
    const prior = seen.get(entry.id);
    if (prior) {
      clashes.push(
        `"${entry.id}" is both ${prior.category}/"${prior.label}" ` +
        `and ${entry.category}/"${entry.label}"`,
      );
    }
    seen.set(entry.id, { category: entry.category, label: entry.label });
  }

  assert.deepEqual(clashes, [], clashes.join('; '));
});

test('every id a DayLog can carry resolves to a real label', () => {
  const log = {
    date: '2026-07-29', flow: 'none', drive: null, custom: [],
    symptoms: [], moods: [], discharge: [], activity: [], other: [], sex: [],
    bbt: null, weight: null, water: 0, sleep: null, steps: null,
    pillTaken: false, testPregnancy: null, testOvulation: null,
    notes: '', updated: 0,
  };

  // Every option from every category that flows through loggedIds.
  const fields = /** @type {const} */ ([
    ['moods', 'moods'], ['symptoms', 'symptoms'], ['discharge', 'discharge'],
    ['sex', 'sex'], ['activity', 'activity'], ['other', 'other'],
  ]);

  for (const [categoryId, field] of fields) {
    const category = CATEGORIES.find((c) => c.id === categoryId);
    assert.ok(category, `missing category ${categoryId}`);

    const ids = category.options.map((o) => o.id);
    const ids2 = loggedIds({ .../** @type {any} */ (log), [field]: ids });

    for (const id of ids2) {
      assert.notEqual(
        labelOf(id), id,
        `${categoryId}/${id} falls through to its raw id instead of a label`,
      );
      assert.equal(labelOf(id), labelFor(categoryId, id),
        `${categoryId}/${id} resolves differently with and without its category`);
    }
  }
});

test('scale ids keep their own category label', () => {
  // `low` exists as both a mood and a drive level. The category-aware lookup
  // must still distinguish them.
  assert.equal(labelFor('moods', 'low'), 'Very low');
  assert.equal(labelFor('drive', 'low'), 'Low');
});

test('an unknown id echoes back, so custom symptoms display as typed', () => {
  assert.equal(labelOf('sore left elbow'), 'sore left elbow');
});

test('optionCount matches the advertised taxonomy size', () => {
  assert.ok(optionCount() >= 100, `only ${optionCount()} options`);
});

test('every option is findable by a prefix of its own label', () => {
  /** @type {string[]} */
  const unfindable = [];

  for (const category of CATEGORIES) {
    for (const option of category.options) {
      // What someone would actually type: the first word, truncated.
      const firstWord = option.label.split(/[\s-]+/)[0];
      const typed = normalizeQuery(firstWord.slice(0, Math.max(3, firstWord.length - 1)));
      if (!optionMatches({ id: option.id, label: option.label }, typed)) {
        unfindable.push(`${category.id}/${option.label} (typed "${typed}")`);
      }
    }
  }

  assert.deepEqual(unfindable, [], unfindable.slice(0, 6).join('; '));
});

test('an emoji in front of a label does not hide it from search', () => {
  /*
    The regression this exists for. Chips render the emoji as a sibling span,
    so reading the label back out of `textContent` produced "🤢Nausea" — which
    normalises to "🤢nausea" and starts with neither the query nor any word in
    it. Every one of the 104 options was unsearchable by its own name, and it
    went unnoticed because the ~20 options carrying hand-written synonyms
    still matched.
  */
  const option = { id: 'nausea', label: 'Nausea' };
  assert.equal(optionMatches(option, normalizeQuery('nausea')), true);

  const glued = { id: 'nausea', label: '🤢Nausea' };
  assert.equal(optionMatches(glued, normalizeQuery('nausea')), false,
    'if this ever passes, the guard above has stopped guarding anything');
});
