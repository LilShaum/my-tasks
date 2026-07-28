// @ts-check
/**
 * Pattern detection. The risk here is the opposite of a normal false-negative
 * worry: claiming a "pattern" from two coincidences would make the whole
 * feature untrustworthy, so most of these tests are about *not* reporting
 * things.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loggedIds, symptomFrequency, symptomPattern, detectPatterns, series,
  loggingStreak, daysLogged, bbtForCycle,
} from '../js/domain/stats.js';
import { buildCycles } from '../js/domain/cycles.js';
import { emptyLog } from '../js/domain/model.js';
import { addDays, range } from '../js/utils/date.js';

const period = (start, len) => range(start, addDays(start, len - 1));

/**
 * Build logs and period days for `n` cycles of `cycleLen` days, putting
 * `symptoms` on the given days-of-cycle in every cycle.
 */
function build({ start = '2026-01-01', cycleLen = 28, cycles = 4, periodLen = 5,
                 onDays = {}, skipCycles = [] } = {}) {
  /** @type {string[]} */
  const periodDays = [];
  /** @type {Record<string, any>} */
  const logs = {};

  for (let c = 0; c < cycles; c++) {
    const cycleStart = addDays(start, cycleLen * c);
    periodDays.push(...period(cycleStart, periodLen));

    if (skipCycles.includes(c)) continue;

    for (const [day, ids] of Object.entries(onDays)) {
      const date = addDays(cycleStart, Number(day) - 1);
      logs[date] = { ...emptyLog(date), symptoms: [...ids] };
    }
  }

  return { logs, periodDays, cyclesList: buildCycles(periodDays) };
}

test('loggedIds flattens every chip category and drops "none"', () => {
  const log = {
    ...emptyLog('2026-07-01'),
    symptoms: ['cramps'], moods: ['sad'], discharge: ['none', 'sticky'],
    activity: ['yoga'], other: ['stress'], sex: ['none'], custom: ['jaw ache'],
  };
  assert.deepEqual(loggedIds(log).sort(),
    ['cramps', 'jaw ache', 'sad', 'sticky', 'stress', 'yoga']);
});

test('symptomFrequency counts across days, most frequent first', () => {
  const { logs } = build({ cycles: 4, onDays: { 1: ['cramps', 'headache'], 2: ['cramps'] } });
  const freq = symptomFrequency(logs);
  assert.equal(freq[0].id, 'cramps');
  assert.equal(freq[0].count, 8, '2 days x 4 cycles');
  assert.equal(freq.find((f) => f.id === 'headache')?.count, 4);
});

test('symptomPattern locates the cycle days a symptom lands on', () => {
  const { logs, cyclesList } = build({ cycles: 5, onDays: { 1: ['cramps'], 2: ['cramps'] } });
  const pattern = symptomPattern('cramps', logs, cyclesList);

  // The final cycle is still open, so only the completed ones count.
  assert.equal(pattern.cyclesTotal, 4);
  assert.equal(pattern.cyclesWith, 4);
  assert.deepEqual(pattern.peakDays, [1, 2]);
  assert.equal(pattern.byDay.get(1), 4);
  assert.equal(pattern.byDay.get(2), 4);
  assert.equal(pattern.byDay.get(9), undefined);
});

test('a consistent symptom is reported as a pattern', () => {
  const { logs, cyclesList } = build({ cycles: 5, onDays: { 1: ['cramps'] } });
  const patterns = detectPatterns(logs, cyclesList);

  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].id, 'cramps');
  assert.equal(patterns[0].share, 1);
  assert.deepEqual(patterns[0].peakDays, [1]);
});

test('an occasional symptom is not reported as a pattern', () => {
  // Present in only 2 of 5 completed cycles — under the 60% threshold.
  const { logs, cyclesList } = build({
    cycles: 6, onDays: { 3: ['headache'] }, skipCycles: [0, 1, 2],
  });
  assert.deepEqual(detectPatterns(logs, cyclesList).map((p) => p.id), []);
});

test('no patterns are claimed from fewer than three complete cycles', () => {
  // Logged every single cycle, but there are only two complete ones.
  const { logs, cyclesList } = build({ cycles: 3, onDays: { 1: ['cramps'] } });
  assert.equal(cyclesList.filter((c) => c.complete).length, 2);
  assert.deepEqual(detectPatterns(logs, cyclesList), []);
});

test('patterns come back strongest first', () => {
  const { logs, cyclesList } = build({
    cycles: 6,
    onDays: { 1: ['cramps'], 2: ['bloating'] },
  });
  // Remove bloating from two cycles so cramps is the more reliable one.
  for (const date of ['2026-01-02', '2026-01-30']) {
    if (logs[date]) logs[date].symptoms = [];
  }
  const patterns = detectPatterns(logs, cyclesList);
  assert.equal(patterns[0].id, 'cramps');
  assert.ok(patterns[0].share >= (patterns[1]?.share ?? 0));
});

test('an empty history produces no patterns and no frequencies', () => {
  assert.deepEqual(detectPatterns({}, []), []);
  assert.deepEqual(symptomFrequency({}), []);
});

test('series returns only real numbers, in date order', () => {
  /** @type {Record<string, any>} */
  const logs = {
    '2026-07-03': { ...emptyLog('2026-07-03'), weight: 61.0 },
    '2026-07-01': { ...emptyLog('2026-07-01'), weight: 60.5 },
    '2026-07-02': { ...emptyLog('2026-07-02'), weight: null },
  };
  assert.deepEqual(series(logs, 'weight'), [
    { date: '2026-07-01', value: 60.5 },
    { date: '2026-07-03', value: 61.0 },
  ]);
});

test('series treats zero water as unlogged but keeps a zero elsewhere', () => {
  /** @type {Record<string, any>} */
  const logs = {
    '2026-07-01': { ...emptyLog('2026-07-01'), water: 0, sleep: 0 },
    '2026-07-02': { ...emptyLog('2026-07-02'), water: 500, sleep: 7 },
  };
  assert.deepEqual(series(logs, 'water').map((p) => p.date), ['2026-07-02']);
  assert.deepEqual(series(logs, 'sleep').map((p) => p.date), ['2026-07-01', '2026-07-02']);
});

test('bbtForCycle attaches day-of-cycle and skips days without a reading', () => {
  const periodDays = period('2026-07-01', 5);
  const cycles = buildCycles(periodDays);
  /** @type {Record<string, any>} */
  const logs = {
    '2026-07-01': { ...emptyLog('2026-07-01'), bbt: 36.4 },
    '2026-07-02': { ...emptyLog('2026-07-02'), bbt: null },
    '2026-07-03': { ...emptyLog('2026-07-03'), bbt: 36.5 },
  };
  const readings = bbtForCycle(logs, cycles[0]);
  assert.deepEqual(readings.map((r) => [r.day, r.bbt]), [[1, 36.4], [3, 36.5]]);
});

test('the logging streak counts back from today', () => {
  /** @type {Record<string, any>} */
  const logs = {};
  for (const date of ['2026-07-25', '2026-07-26', '2026-07-27']) {
    logs[date] = emptyLog(date);
  }
  assert.equal(loggingStreak(logs, '2026-07-27', addDays), 3);
  assert.equal(daysLogged(logs), 3);
});

test('a streak survives not having logged yet today', () => {
  // Opening the app in the morning must not read as a broken streak.
  /** @type {Record<string, any>} */
  const logs = { '2026-07-25': emptyLog('2026-07-25'), '2026-07-26': emptyLog('2026-07-26') };
  assert.equal(loggingStreak(logs, '2026-07-27', addDays), 2);
});

test('a gap of two days ends the streak', () => {
  /** @type {Record<string, any>} */
  const logs = { '2026-07-24': emptyLog('2026-07-24') };
  assert.equal(loggingStreak(logs, '2026-07-27', addDays), 0);
});

test('no logs at all is a streak of zero, not a crash', () => {
  assert.equal(loggingStreak({}, '2026-07-27', addDays), 0);
});
