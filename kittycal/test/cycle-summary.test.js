// @ts-check
/**
 * cycle-summary.test.js — what one cycle held.
 *
 * The function that lets Insights say something in week one, when every other
 * analysis on that screen needs months of history first. Its whole value is
 * that it never reaches outside the cycle it was given — a count that quietly
 * included the previous cycle would be worse than no count.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cycleSummary } from '../js/domain/stats.js';
import { buildCycles } from '../js/domain/cycles.js';
import { emptyLog } from '../js/domain/model.js';
import { addDays } from '../js/utils/date.js';

/** Two 28-day cycles from 1 January, five bleeding days each. */
function cycles() {
  const period = new Set();
  for (let c = 0; c < 2; c += 1) {
    const start = addDays('2026-01-01', c * 28);
    for (let i = 0; i < 5; i += 1) period.add(addDays(start, i));
  }
  return buildCycles(period);
}

/** @param {Record<string, Partial<import('../js/domain/model.js').DayLog>>} byDate */
function logsWith(byDate) {
  /** @type {Record<string, any>} */
  const logs = {};
  for (const [date, patch] of Object.entries(byDate)) {
    logs[date] = { ...emptyLog(date), ...patch };
  }
  return logs;
}

test('the cycle day counts from the start of the cycle', () => {
  const out = cycleSummary(logsWith({}), cycles()[1], '2026-02-03');
  // The second cycle starts on 29 January, so 3 February is day 6.
  assert.equal(out.day, 6);
});

test('only days inside the cycle are counted', () => {
  const logs = logsWith({
    '2026-01-10': { symptoms: ['cramps'] },   // first cycle
    '2026-01-29': { symptoms: ['cramps'] },   // second cycle, day 1
    '2026-02-02': { symptoms: ['cramps'] },   // second cycle, day 5
  });

  const first = cycleSummary(logs, cycles()[0], '2026-02-10');
  const second = cycleSummary(logs, cycles()[1], '2026-02-10');

  assert.equal(first.daysLogged, 1, 'the completed cycle stops at its last day');
  assert.equal(second.daysLogged, 2, 'and the next one starts at its own');
});

test('a running cycle stops at today, not at some future date', () => {
  const logs = logsWith({
    '2026-01-29': { symptoms: ['cramps'] },
    '2026-02-01': { symptoms: ['cramps'] },
  });

  const out = cycleSummary(logs, cycles()[1], '2026-01-30');
  assert.equal(out.day, 2);
  assert.equal(out.daysLogged, 1, 'the 1 February entry has not happened yet');
});

test('bleeding days are counted, and spotting is not one', () => {
  const logs = logsWith({
    '2026-01-29': { flow: 'medium' },
    '2026-01-30': { flow: 'heavy' },
    '2026-01-31': { flow: 'spotting' },
    '2026-02-01': { flow: 'none', symptoms: ['cramps'] },
  });

  const out = cycleSummary(logs, cycles()[1], '2026-02-05');
  assert.equal(out.bleedingDays, 2, 'spotting is bleeding outside a period');
  assert.equal(out.daysLogged, 4, 'but it is still a day she logged');
});

test('what came up is counted and ordered, most first', () => {
  const logs = logsWith({
    '2026-01-29': { symptoms: ['cramps'], moods: ['irritable'] },
    '2026-01-30': { symptoms: ['cramps'] },
    '2026-01-31': { symptoms: ['cramps', 'headache'] },
  });

  const out = cycleSummary(logs, cycles()[1], '2026-02-05');
  assert.deepEqual(out.logged, [
    { id: 'cramps', count: 3 },
    { id: 'headache', count: 1 },
    { id: 'irritable', count: 1 },
  ], 'ties fall back to the id so the order is stable between renders');
});

test('a cycle with nothing logged in it reports zero rather than throwing', () => {
  const out = cycleSummary(logsWith({}), cycles()[1], '2026-02-05');
  assert.equal(out.daysLogged, 0);
  assert.equal(out.bleedingDays, 0);
  assert.deepEqual(out.logged, []);
});

test('"none" is never counted as a thing that happened', () => {
  const logs = logsWith({
    '2026-01-29': { discharge: ['none'], activity: ['none'], symptoms: ['cramps'] },
  });

  const out = cycleSummary(logs, cycles()[1], '2026-02-05');
  assert.deepEqual(out.logged, [{ id: 'cramps', count: 1 }]);
});

test('asking about a cycle that has not started yet does not run backwards', () => {
  // `today` before the cycle start would make the day count zero or negative,
  // and a backwards range would have walked the whole calendar.
  const out = cycleSummary(logsWith({}), cycles()[1], '2026-01-05');
  assert.equal(out.daysLogged, 0);
  assert.ok(out.day <= 0, 'the day count is simply not meaningful yet');
});
