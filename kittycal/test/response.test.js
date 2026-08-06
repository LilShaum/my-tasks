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

test('counts down to patterns as each cycle closes', () => {
  const { logs, periodDays } = history({ first: '2026-01-01', count: 2 });
  // Open a third period, which closes the second cycle: two complete, one to go.
  const date = addDays('2026-01-01', 2 * 28);
  periodDays.add(date);
  const log = { ...emptyLog(date), flow: /** @type {const} */ ('medium'), checkedIn: true };

  const said = respondToCheckin({
    log, logs, cycles: buildCycles(periodDays), today: date,
  });
  assert.match(/** @type {string} */ (said), /closes your last cycle at 28 days/);
  assert.match(/** @type {string} */ (said), /One more/);
});

test('says the countdown when a cycle closes, not every day until then', () => {
  /*
    This is the whole point of attaching it to the cycle close. The number only
    changes when a cycle ends; repeating it daily in between was the app saying
    the same sentence for two months, which is how a line stops being read.
  */
  const { logs, cycles } = history({ first: '2026-01-01', count: 3 });
  const date = addDays('2026-01-01', 2 * 28 + 10);
  const log = { ...emptyLog(date), checkedIn: true };

  assert.equal(respondToCheckin({ log, logs, cycles, today: date }), null);
});

test('notices a symptom that showed up at this point last cycle', () => {
  // Two cycles, cramps on day 6 of each — one short of anything the pattern
  // detector will touch, and the second month is exactly when she needs the
  // app to have noticed something.
  const { logs, cycles } = history({
    first: '2026-01-01', count: 2, mark: { day: 6, ids: ['cramps'] },
  });
  const date = addDays('2026-01-01', 28 + 5);
  const log = { ...emptyLog(date), symptoms: ['cramps'], checkedIn: true };

  const said = respondToCheckin({ log, logs, cycles, today: date });
  assert.match(/** @type {string} */ (said), /cramps/);
  assert.match(/** @type {string} */ (said), /last cycle/);
  // And it must not dress two occurrences up as a tendency.
  assert.doesNotMatch(/** @type {string} */ (said), /pattern|usually|typical|always/i);
});

test('does not reach past the previous cycle for an echo', () => {
  // Cramps on day 6 of the first cycle only. By the third cycle "last cycle
  // too" would be false, so it says nothing.
  const { logs, cycles } = history({
    first: '2026-01-01', count: 3, mark: { day: 6, ids: ['cramps'], inCycles: 1 },
  });
  const date = addDays('2026-01-01', 2 * 28 + 5);
  const log = { ...emptyLog(date), symptoms: ['cramps'], checkedIn: true };

  assert.equal(respondToCheckin({ log, logs, cycles, today: date }), null);
});

test('marks the first time something is logged, once there is a baseline', () => {
  /** @type {Record<string, import('../js/domain/model.js').DayLog>} */
  const logs = {};
  const first = '2026-02-01';
  for (let i = 0; i < 8; i += 1) {
    const key = addDays(first, i);
    logs[key] = { ...emptyLog(key), symptoms: ['cramps'], checkedIn: true };
  }

  const date = addDays(first, 8);
  const log = { ...emptyLog(date), symptoms: ['nausea'], checkedIn: true };
  const said = respondToCheckin({ log, logs, cycles: [], today: date });
  assert.match(/** @type {string} */ (said), /First time/);
  assert.match(/** @type {string} */ (said), /nausea/i);
});

test('stays quiet in the first days, when everything is a first', () => {
  /** @type {Record<string, import('../js/domain/model.js').DayLog>} */
  const logs = {};
  const first = '2026-02-01';
  for (let i = 0; i < 2; i += 1) {
    const key = addDays(first, i);
    logs[key] = { ...emptyLog(key), symptoms: ['cramps'], checkedIn: true };
  }

  const date = addDays(first, 2);
  const log = { ...emptyLog(date), symptoms: ['nausea'], checkedIn: true };
  assert.equal(respondToCheckin({ log, logs, cycles: [], today: date }), null);
});

test('counts a run of the same symptom, at marked lengths only', () => {
  /** @type {Record<string, import('../js/domain/model.js').DayLog>} */
  const logs = {};
  const first = '2026-02-01';
  // Enough prior days that the first-ever line is done with headache.
  for (let i = 0; i < 6; i += 1) {
    const key = addDays(first, i);
    logs[key] = { ...emptyLog(key), symptoms: ['headache'], checkedIn: true };
  }

  // Day 7 of the run is a marked length.
  const seventh = addDays(first, 6);
  const said = respondToCheckin({
    log: { ...emptyLog(seventh), symptoms: ['headache'], checkedIn: true },
    logs, cycles: [], today: seventh,
  });
  assert.match(/** @type {string} */ (said), /7 days in a row/);
  assert.match(/** @type {string} */ (said), /headache/i);

  // Day 6 is not, and nothing else has anything to say about it.
  const sixth = addDays(first, 5);
  const upToFifth = Object.fromEntries(
    Object.entries(logs).filter(([key]) => key < sixth),
  );
  assert.equal(respondToCheckin({
    log: logs[sixth], logs: upToFifth, cycles: [], today: sixth,
  }), null);
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
