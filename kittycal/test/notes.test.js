// @ts-check
/**
 * notes.test.js — gathering and searching what she wrote.
 *
 * The diary's free-text field was write-only until this existed: readable only
 * by remembering the date and opening that day. These cover the two things
 * that make it readable instead — the order, and the search.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectNotes, searchNotes } from '../js/domain/notes.js';
import { buildCycles } from '../js/domain/cycles.js';
import { emptyLog } from '../js/domain/model.js';
import { addDays } from '../js/utils/date.js';

/** @param {Record<string, string>} byDate */
function logsWith(byDate) {
  /** @type {Record<string, any>} */
  const logs = {};
  for (const [date, notes] of Object.entries(byDate)) {
    logs[date] = { ...emptyLog(date), notes };
  }
  return logs;
}

/** Five 28-day cycles from 1 January. */
function cycles() {
  const period = new Set();
  for (let c = 0; c < 5; c += 1) {
    const start = addDays('2026-01-01', c * 28);
    for (let i = 0; i < 5; i += 1) period.add(addDays(start, i));
  }
  return buildCycles(period);
}

test('notes come back newest first', () => {
  const out = collectNotes(logsWith({
    '2026-01-10': 'middle',
    '2026-03-02': 'newest',
    '2026-01-02': 'oldest',
  }), cycles());

  assert.deepEqual(out.map((n) => n.text), ['newest', 'middle', 'oldest']);
});

test('days without a note are left out entirely', () => {
  const logs = logsWith({ '2026-01-02': 'something' });
  logs['2026-01-03'] = { ...emptyLog('2026-01-03'), notes: '' };
  logs['2026-01-04'] = { ...emptyLog('2026-01-04'), notes: '   \n  ' };
  logs['2026-01-05'] = { ...emptyLog('2026-01-05'), symptoms: ['cramps'] };

  const out = collectNotes(logs, cycles());
  assert.equal(out.length, 1, 'whitespace and blank are not notes');
  assert.equal(out[0].text, 'something');
});

test('a note carries the cycle day it fell on', () => {
  // 2 January is day 2 of the cycle starting on the 1st.
  const out = collectNotes(logsWith({ '2026-01-02': 'day two' }), cycles());
  assert.equal(out[0].cycleDay, 2);
});

test('a note from before any cycle still comes back', () => {
  const out = collectNotes(logsWith({ '2025-11-04': 'long ago' }), cycles());
  assert.equal(out.length, 1, 'it is still hers to read');
  assert.equal(out[0].cycleDay, null, 'but there is no cycle day to claim');
});

test('the text is preserved exactly, minus surrounding space', () => {
  const messy = '  Worst cramps yet — "couldn\'t" work.\n\nTook two ibuprofen.  ';
  const out = collectNotes(logsWith({ '2026-01-02': messy }), cycles());
  assert.equal(out[0].text, messy.trim());
  assert.match(out[0].text, /\n\n/, 'the paragraph break survives');
});

test('search is a case-insensitive substring', () => {
  const entries = collectNotes(logsWith({
    '2026-01-02': 'Worst CRAMPS yet',
    '2026-01-20': 'slept badly',
    '2026-02-02': 'cramping again',
  }), cycles());

  assert.deepEqual(searchNotes(entries, 'cramp').map((n) => n.text),
    ['cramping again', 'Worst CRAMPS yet']);
  assert.deepEqual(searchNotes(entries, 'SLEPT').map((n) => n.text), ['slept badly']);
});

test('an empty search returns everything rather than nothing', () => {
  const entries = collectNotes(logsWith({
    '2026-01-02': 'one', '2026-01-20': 'two',
  }), cycles());

  assert.equal(searchNotes(entries, '').length, 2);
  assert.equal(searchNotes(entries, '   ').length, 2, 'and so does whitespace');
});

test('a search matching nothing returns nothing', () => {
  const entries = collectNotes(logsWith({ '2026-01-02': 'one' }), cycles());
  assert.equal(searchNotes(entries, 'zebra').length, 0);
});
