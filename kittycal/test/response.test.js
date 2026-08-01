// @ts-check
/**
 * response.test.js — what Kittycal says back after a check-in.
 *
 * This is the only place in the app that speaks to the act of logging, so the
 * tests are as much about what it refuses to say as what it says: no praise,
 * no reaction to what was logged, nothing already on the screen, and silence
 * rather than filler.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { respondToCheckin } from '../js/domain/response.js';
import { buildCycles } from '../js/domain/cycles.js';
import { emptyLog } from '../js/domain/model.js';
import { addDays } from '../js/utils/date.js';

/**
 * Build a history of `count` cycles of `length` days, starting at `first`,
 * optionally logging `symptoms` on a given day of each cycle.
 * @param {Object} o
 * @param {string} o.first
 * @param {number} o.count
 * @param {number} [o.length]
 * @param {number} [o.periodDays]
 * @param {{day: number, ids: string[], inCycles?: number}} [o.mark]
 */
function history({ first, count, length = 28, periodDays = 5, mark }) {
  /** @type {Set<string>} */
  const period = new Set();
  /** @type {Record<string, import('../js/domain/model.js').DayLog>} */
  const logs = {};

  for (let c = 0; c < count; c += 1) {
    const start = addDays(first, c * length);
    for (let d = 0; d < periodDays; d += 1) {
      const key = addDays(start, d);
      period.add(key);
      logs[key] = { ...emptyLog(key), flow: 'medium', checkedIn: true };
    }
    if (mark && c < (mark.inCycles ?? count)) {
      const key = addDays(start, mark.day - 1);
      logs[key] = { ...(logs[key] ?? emptyLog(key)), symptoms: mark.ids, checkedIn: true };
    }
  }

  return { logs, cycles: buildCycles(period), periodDays: period };
}

test('says nothing when there is nothing worth saying', () => {
  // Four complete cycles, so the "getting there" line is done, no pattern
  // matched, no period starting, no streak milestone.
  const { logs, cycles } = history({ first: '2026-01-01', count: 5 });
  const date = '2026-03-20';
  const log = { ...emptyLog(date), checkedIn: true };
  assert.equal(respondToCheckin({ log, logs, cycles, today: date }), null);
});

test('names a symptom that recurs on this day of the cycle', () => {
  const { logs, cycles } = history({
    first: '2026-01-01', count: 5, mark: { day: 2, ids: ['cramps'] },
  });
  // Day 2 of the current (fifth) cycle, where cramps always land.
  const date = addDays('2026-01-01', 4 * 28 + 1);
  const log = { ...emptyLog(date), symptoms: ['cramps'], checkedIn: true };

  const said = respondToCheckin({ log, logs, cycles, today: date });
  assert.match(/** @type {string} */ (said), /cramps/);
  assert.match(/** @type {string} */ (said), /of your last \d+ cycles/);
  assert.match(/** @type {string} */ (said), /day 2/);
});

test('stays quiet about a symptom that does not usually land today', () => {
  const { logs, cycles } = history({
    first: '2026-01-01', count: 5, mark: { day: 2, ids: ['cramps'] },
  });
  // Cramps logged on day 20, nowhere near where they normally appear. True
  // that she often gets them; says nothing about today.
  const date = addDays('2026-01-01', 4 * 28 + 19);
  const log = { ...emptyLog(date), symptoms: ['cramps'], checkedIn: true };
  assert.equal(respondToCheckin({ log, logs, cycles, today: date }), null);
});

test('will not call two coincidences a pattern', () => {
  // Cramps in only 2 of 5 cycles is under the 60% bar.
  const { logs, cycles } = history({
    first: '2026-01-01', count: 5, mark: { day: 2, ids: ['cramps'], inCycles: 2 },
  });
  const date = addDays('2026-01-01', 4 * 28 + 1);
  const log = { ...emptyLog(date), symptoms: ['cramps'], checkedIn: true };
  assert.equal(respondToCheckin({ log, logs, cycles, today: date }), null);
});

test('closes the previous cycle when a period starts', () => {
  const { logs, cycles, periodDays } = history({ first: '2026-01-01', count: 4 });
  // Start a fifth period on schedule.
  const date = addDays('2026-01-01', 4 * 28);
  periodDays.add(date);
  const withNew = buildCycles(periodDays);
  const log = { ...emptyLog(date), flow: 'medium', checkedIn: true };

  const said = respondToCheckin({ log, logs, cycles: withNew, today: date });
  assert.match(/** @type {string} */ (said), /28 days/);
});

test('counts down to patterns while the history is thin', () => {
  const { logs, cycles } = history({ first: '2026-01-01', count: 3 });
  // Three starts means two *complete* cycles; the third is still running.
  const date = addDays('2026-01-01', 2 * 28 + 10);
  const log = { ...emptyLog(date), checkedIn: true };

  const said = respondToCheckin({ log, logs, cycles, today: date });
  assert.match(/** @type {string} */ (said), /2 cycles logged/);
  assert.match(/** @type {string} */ (said), /One more/);
});

test('explains what logging is for when there is no history at all', () => {
  const date = '2026-01-10';
  const log = { ...emptyLog(date), checkedIn: true };
  const said = respondToCheckin({ log, logs: {}, cycles: [], today: date });
  assert.match(/** @type {string} */ (said), /three cycles/);
});

test('marks a streak only on round numbers', () => {
  /** @type {Record<string, import('../js/domain/model.js').DayLog>} */
  const logs = {};
  // Seven consecutive days ending today, and enough cycle history that the
  // earlier lines stay quiet.
  const base = history({ first: '2026-01-01', count: 5 });
  Object.assign(logs, base.logs);

  const today = '2026-06-10';
  for (let i = 0; i < 7; i += 1) {
    const key = addDays(today, -i);
    logs[key] = { ...emptyLog(key), checkedIn: true };
  }
  const log = logs[today];

  assert.match(
    /** @type {string} */ (respondToCheckin({ log, logs, cycles: base.cycles, today })),
    /7 days in a row/,
  );

  // An unremarkable number says nothing.
  const six = '2026-06-09';
  assert.equal(
    respondToCheckin({ log: logs[six], logs, cycles: base.cycles, today: six }),
    null,
  );
});

test('never comments on how she feels', () => {
  const { logs, cycles } = history({ first: '2026-01-01', count: 5 });
  const date = addDays('2026-01-01', 4 * 28 + 10);

  // A deliberately grim day: heavy bleeding and a run of bad moods.
  const log = {
    ...emptyLog(date), flow: /** @type {const} */ ('heavy'),
    moods: ['anxious', 'low-energy'], symptoms: ['cramps', 'headache'],
    checkedIn: true,
  };

  const said = respondToCheckin({ log, logs, cycles, today: date });
  // Whatever it says, it must not editorialise.
  const forbidden = /sorry|hope|feel better|great|well done|good job|nice|keep it up|proud/i;
  if (said) assert.doesNotMatch(said, forbidden);
});
