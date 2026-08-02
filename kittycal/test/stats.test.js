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
  loggingStreak, loggingConsistency, CONSISTENCY_WINDOW, daysLogged, bbtForCycle,
  moodByPhase,
} from '../js/domain/stats.js';
import { buildCycles } from '../js/domain/cycles.js';
import { phaseInCycle } from '../js/domain/phases.js';
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

/* ── Mood by phase ──────────────────────────────────────────────────────── */

/** Six 28-day cycles ending with a period that started 3 days ago. */
function sixCycles(today = '2026-07-20') {
  const days = [];
  for (let c = 5; c >= 0; c--) {
    const start = addDays(today, -3 - c * 28);
    for (let i = 0; i < 5; i++) days.push(addDays(start, i));
  }
  return buildCycles(days);
}

/** @param {Record<string, string[]>} byDate */
function moodLogs(byDate) {
  /** @type {Record<string, any>} */
  const logs = {};
  for (const [date, moods] of Object.entries(byDate)) {
    logs[date] = {
      date, flow: 'none', symptoms: [], moods, discharge: [], activity: [],
      other: [], sex: [], custom: [], drive: null, bbt: null, weight: null,
      water: 0, sleep: null, steps: null, pillTaken: false,
      testPregnancy: null, testOvulation: null, notes: '', updated: 0,
    };
  }
  return logs;
}

test('phaseInCycle covers a whole historical cycle', () => {
  const cycles = sixCycles();
  const cycle = cycles[1];

  /** @type {Record<string, number>} */
  const seen = {};
  for (let i = 0; i < 28; i++) {
    const id = phaseInCycle(addDays(cycle.start, i), cycle, 14).id;
    seen[id] = (seen[id] ?? 0) + 1;
  }

  // Every day is accounted for, and each phase actually appears — the whole
  // point, since `phaseFor` returns `unknown` for 23 of these 28 days.
  assert.equal(Object.values(seen).reduce((a, b) => a + b, 0), 28);
  assert.ok(!seen.unknown, `unclassified days: ${seen.unknown}`);
  for (const id of ['menstrual', 'follicular', 'ovulatory', 'luteal']) {
    assert.ok(seen[id] > 0, `no ${id} days`);
  }
});

test('phaseInCycle refuses an incomplete cycle', () => {
  const cycles = sixCycles();
  const open = cycles[cycles.length - 1];
  assert.equal(open.complete, false);
  assert.equal(phaseInCycle(open.start, open, 14).id, 'unknown');
});

test('moodByPhase buckets moods into the phase they happened in', () => {
  const cycles = sixCycles();
  const cycle = cycles[1];

  const logs = moodLogs({
    [cycle.start]: ['irritable'],                    // day 1 — menstrual
    [addDays(cycle.start, 1)]: ['irritable', 'sad'], // day 2 — menstrual
    [addDays(cycle.start, 7)]: ['happy'],            // follicular
    [addDays(cycle.start, 13)]: ['happy'],           // ovulatory
    [addDays(cycle.start, 24)]: ['irritable'],       // luteal
  });

  const out = moodByPhase(logs, cycles, 14);

  assert.deepEqual(out.get('menstrual')?.moods.map((m) => [m.id, m.count]),
    [['irritable', 2], ['sad', 1]]);
  assert.equal(out.get('menstrual')?.total, 2, 'two days, three mood entries');
  assert.equal(out.get('follicular')?.moods[0].id, 'happy');
  assert.equal(out.get('luteal')?.moods[0].id, 'irritable');
});

test('moodByPhase ignores the open cycle and undated noise', () => {
  const cycles = sixCycles();
  const open = cycles[cycles.length - 1];

  const logs = moodLogs({
    [addDays(open.start, 1)]: ['happy'],   // inside the still-open cycle
    '2019-01-01': ['sad'],                 // long before any cycle
  });

  assert.equal(moodByPhase(logs, cycles, 14).size, 0,
    'a phase needs the next period to exist before it can be located');
});

test('moodByPhase reports totals so shares can be compared', () => {
  const cycles = sixCycles();
  const cycle = cycles[1];

  // Luteal is roughly twice the fertile window, so raw counts would always
  // favour it. The total is what lets the UI divide.
  /** @type {Record<string, string[]>} */
  const byDate = {};
  for (let i = 20; i < 26; i++) byDate[addDays(cycle.start, i)] = ['calm'];
  byDate[addDays(cycle.start, 13)] = ['happy'];

  const out = moodByPhase(byDate && moodLogs(byDate), cycles, 14);
  assert.equal(out.get('luteal')?.total, 6);
  assert.equal(out.get('ovulatory')?.total, 1);
});

test('moodByPhase drops the "none" mood', () => {
  const cycles = sixCycles();
  const cycle = cycles[1];
  const out = moodByPhase(moodLogs({ [cycle.start]: ['none'] }), cycles, 14);
  assert.equal(out.get('menstrual')?.moods.length, 0);
});

/* ── Consistency, not streaks ──────────────────────────────────────────────
   A streak resets to zero the first time she misses a day, and a prominent
   zero on the screen whose job is to make the history feel worth adding to is
   how an app becomes a source of guilt. Consistency degrades by one instead. */

test('consistency counts logged days in the window', () => {
  /** @type {Record<string, any>} */
  const logs = {};
  for (let i = 0; i < 30; i += 1) logs[addDays('2026-06-30', -i)] = emptyLog('x');
  assert.equal(loggingConsistency(logs, '2026-06-30', addDays), 30);
});

test('one missed day costs consistency exactly one', () => {
  /** @type {Record<string, any>} */
  const logs = {};
  for (let i = 0; i < 30; i += 1) logs[addDays('2026-06-30', -i)] = emptyLog('x');
  delete logs[addDays('2026-06-30', -5)];

  assert.equal(loggingConsistency(logs, '2026-06-30', addDays), 29);
  // The same gap takes a streak to zero, which is the behaviour being avoided.
  assert.equal(loggingStreak(logs, '2026-06-30', addDays), 5);
});

test('a gap yesterday does not wipe the figure out', () => {
  /** @type {Record<string, any>} */
  const logs = {};
  for (let i = 0; i < 30; i += 1) logs[addDays('2026-06-30', -i)] = emptyLog('x');
  delete logs[addDays('2026-06-30', -1)];
  delete logs['2026-06-30'];

  // Two days off after a month of logging is 28, not nothing.
  assert.equal(loggingConsistency(logs, '2026-06-30', addDays), 28);
  assert.equal(loggingStreak(logs, '2026-06-30', addDays), 0);
});

test('consistency ignores anything older than the window', () => {
  /** @type {Record<string, any>} */
  const logs = {};
  for (let i = 0; i < 90; i += 1) logs[addDays('2026-06-30', -i)] = emptyLog('x');
  assert.equal(loggingConsistency(logs, '2026-06-30', addDays), CONSISTENCY_WINDOW);
});
