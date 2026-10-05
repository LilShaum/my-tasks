// @ts-check
/**
 * Insights that answer a question or say nothing.
 *
 * Every test here is either "the real pattern is found, in the right place" or
 * "the data does not support it, so nothing is claimed". The second kind is
 * the more important: the module's whole job is to stay quiet when it should.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AFTER, BEFORE, HARD_MOOD, align, alignedSeries, bodyMap, moodCurve,
  sleepCurve, goesWith, periodFingerprint,
  binomialTail, easierDays,
} from '../js/domain/rhythm.js';
import { buildCycles } from '../js/domain/cycles.js';
import { emptyLog } from '../js/domain/model.js';
import { addDays, range } from '../js/utils/date.js';

const START = '2026-01-05';

/**
 * Cycles of the given lengths (the last one left open), with a log on every
 * day. `fill` returns the fields to set on a day given where it sits.
 *
 * @param {number[]} lengths
 * @param {(ctx: {date: string, after: number, before: number, cycle: number}) => Partial<import('../js/domain/model.js').DayLog>} [fill]
 * @param {number} [periodLen]
 */
function world(lengths, fill = () => ({}), periodLen = 5) {
  const starts = [START];
  for (const len of lengths) starts.push(addDays(starts[starts.length - 1], len));
  /** @type {string[]} */
  const periodDays = [];
  for (const s of starts) periodDays.push(...range(s, addDays(s, periodLen - 1)));
  const cycles = buildCycles(periodDays);

  /** @type {Record<string, any>} */
  const logs = {};
  cycles.forEach((cycle, i) => {
    const end = cycle.nextStart ? addDays(cycle.nextStart, -1) : addDays(cycle.start, periodLen - 1);
    for (const date of range(cycle.start, end)) {
      const pos = align(cycle, date);
      logs[date] = { ...emptyLog(date), ...fill({ date, ...pos, cycle: i }) };
    }
  });
  return { logs, cycles };
}

// --- alignment ----------------------------------------------------------------

test('align: day 1 of a 28-day cycle is after 1, before 28; the last day is before 1', () => {
  const cycle = buildCycles([...range('2026-01-05', '2026-01-09'), ...range('2026-02-02', '2026-02-06')])[0];
  assert.deepEqual(align(cycle, '2026-01-05'), { after: 1, before: 28 });
  assert.deepEqual(align(cycle, '2026-02-01'), { after: 28, before: 1 });
});

test('alignedSeries: a short cycle counts a day in both arrays', () => {
  const { logs, cycles } = world([20, 20]);
  const series = alignedSeries(logs, cycles, () => 1);
  assert.equal(series.cycles, 2);
  assert.equal(series.after.length, AFTER);
  assert.equal(series.before.length, BEFORE);
  // 20-day cycle: after 1..14 and before 1..14 overlap on 8 days.
  const total = series.after.reduce((a, s) => a + s.n, 0) + series.before.reduce((a, s) => a + s.n, 0);
  assert.equal(total, 2 * 28);
  // After day 10 is also before day 11.
  assert.equal(series.after[9].n, 2);
  assert.equal(series.before[10].n, 2);
});

test('alignedSeries: a long cycle leaves its middle in neither array', () => {
  const { logs, cycles } = world([40, 40]);
  const series = alignedSeries(logs, cycles, () => 1);
  const total = series.after.reduce((a, s) => a + s.n, 0) + series.before.reduce((a, s) => a + s.n, 0);
  assert.equal(total, 2 * 28);
});

test('alignedSeries: ignores the open cycle, unlogged days and null values', () => {
  const { logs, cycles } = world([28, 28], ({ after }) => ({ sleep: after === 3 ? null : 7 }));
  // Drop one day's log entirely.
  delete logs['2026-01-06'];
  const series = alignedSeries(logs, cycles, (log) => log.sleep);
  assert.equal(series.cycles, 2);
  assert.equal(series.after[0].n, 2);        // after 1: both cycles
  assert.equal(series.after[1].n, 1);        // after 2: first cycle's log deleted
  assert.equal(series.after[2].n, 0);        // after 3: always null
  assert.equal(series.after[0].sum, 14);
  // The open third cycle contributed nothing to any slot.
  const open = cycles[2];
  assert.equal(open.complete, false);
  assert.equal(series.after[0].n, 2);
});

// --- body map -----------------------------------------------------------------

test('bodyMap: finds bloating before the period and cramps on days 1-2, ignores pleasant moods', () => {
  const { logs, cycles } = world([28, 28, 28, 28], ({ after, before, cycle }) => {
    /** @type {string[]} */
    const symptoms = [];
    if (before <= 3) symptoms.push('bloating');
    if (after <= 2) symptoms.push('cramps');
    if (cycle === 0 && after === 10) symptoms.push('headache');   // once in four cycles: noise
    return { symptoms, moods: ['happy'] };
  });
  const rows = bodyMap(logs, cycles);
  const ids = rows.map((r) => r.id);
  assert.deepEqual(new Set(ids), new Set(['bloating', 'cramps']));
  assert.ok(!ids.includes('happy'));
  assert.ok(!ids.includes('headache'));

  const bloating = /** @type {NonNullable<typeof rows[0]>} */ (rows.find((r) => r.id === 'bloating'));
  assert.equal(bloating.kind, 'symptoms');
  assert.equal(bloating.cyclesWith, 4);
  assert.equal(bloating.cyclesTotal, 4);
  assert.deepEqual(bloating.when, { where: 'before', from: 3 });
  assert.equal(bloating.before[0], 1);
  assert.equal(bloating.before[5], 0);

  const cramps = /** @type {NonNullable<typeof rows[0]>} */ (rows.find((r) => r.id === 'cramps'));
  assert.deepEqual(cramps.when, { where: 'period', from: 1, to: 2 });
  assert.equal(cramps.after[0], 1);
  assert.equal(cramps.after[2], 0);
});

test('bodyMap: hard moods and custom symptoms are included, with their kind', () => {
  const { logs, cycles } = world([28, 28, 28], ({ before }) => ({
    moods: before <= 2 ? ['irritable', 'calm'] : ['calm'],
    custom: before === 1 ? ['sore-back'] : [],
  }));
  const rows = bodyMap(logs, cycles);
  const irritable = rows.find((r) => r.id === 'irritable');
  assert.equal(irritable?.kind, 'moods');
  assert.deepEqual(irritable?.when, { where: 'before', from: 2 });
  assert.equal(rows.find((r) => r.id === 'sore-back')?.kind, 'custom');
  assert.ok(!rows.some((r) => r.id === 'calm'));
});

test('bodyMap: needs three complete cycles', () => {
  const { logs, cycles } = world([28, 28], () => ({ symptoms: ['cramps'] }));
  assert.deepEqual(bodyMap(logs, cycles), []);
});

test('bodyMap: an id in under 60% of cycles is left out; sorted and limited', () => {
  // 5 cycles: "tired" in 3 of 5 (60%), "cramps" in all, "nausea" in 2 of 5.
  const { logs, cycles } = world([28, 28, 28, 28, 28], ({ after, cycle }) => {
    /** @type {string[]} */
    const symptoms = [];
    if (after === 1) symptoms.push('cramps');
    if (after === 2 && cycle < 3) symptoms.push('tired');
    if (after === 3 && cycle < 2) symptoms.push('nausea');
    return { symptoms };
  });
  const rows = bodyMap(logs, cycles);
  assert.deepEqual(rows.map((r) => r.id), ['cramps', 'tired']);
  assert.equal(bodyMap(logs, cycles, 1).length, 1);
});

test('bodyMap: a peak below 30% gives no timing, and a mid-cycle peak says middle', () => {
  // Present in every cycle but on a different day each time: no slot reaches 30%.
  const scattered = world([28, 28, 28, 28, 28], ({ after, cycle }) =>
    ({ symptoms: after === 2 + cycle * 2 ? ['headache'] : [] }));
  const row = bodyMap(scattered.logs, scattered.cycles)[0];
  assert.equal(row.id, 'headache');
  assert.equal(row.when, null);

  // Always on after-day 11: the middle of the cycle, not the period.
  const middle = world([28, 28, 28], ({ after }) => ({ symptoms: after === 11 ? ['ovulation-pain'] : [] }));
  assert.deepEqual(bodyMap(middle.logs, middle.cycles)[0].when, { where: 'middle' });
});

test('bodyMap: something logged on random days gets no timing, even when one day peaks by chance', () => {
  // Headache on about one day in eight, anywhere: six cycles of noise. Before
  // the chance test this printed "Day 5 of your period, 6 of 6 cycles".
  let seed = 7;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const { logs, cycles } = world([29, 27, 30, 28, 31, 28], ({ after }) => ({
    symptoms: [...(after <= 2 ? ['cramps'] : []), ...(rand() < 0.12 ? ['headache'] : [])],
  }));
  const rows = bodyMap(logs, cycles);
  const headache = rows.find((r) => r.id === 'headache');
  assert.ok(headache, 'it is still listed: she logs it most cycles');
  assert.equal(headache?.when, null);
  // A real pattern beside it still gets its timing.
  assert.deepEqual(rows.find((r) => r.id === 'cramps')?.when, { where: 'period', from: 1, to: 2 });
});

test('binomialTail: matches hand-worked values', () => {
  assert.equal(binomialTail(0, 5, 0.3), 1);
  assert.equal(binomialTail(6, 5, 0.3), 0);
  assert.ok(Math.abs(binomialTail(5, 5, 0.5) - 1 / 32) < 1e-12);
  // P(X ≥ 2), n = 3, p = 0.5: (3 + 1) / 8.
  assert.ok(Math.abs(binomialTail(2, 3, 0.5) - 0.5) < 1e-12);
  assert.ok(binomialTail(200, 400, 0.5) > 0.5 && binomialTail(200, 400, 0.5) < 0.53);
});

test('HARD_MOOD: the pleasant six are not hard, everything else is', () => {
  for (const id of ['calm', 'happy', 'energetic', 'playful', 'confident', 'neutral']) {
    assert.equal(HARD_MOOD(id), false, id);
  }
  for (const id of ['irritable', 'anxious', 'sad', 'moody']) assert.equal(HARD_MOOD(id), true, id);
});

// --- mood curve ---------------------------------------------------------------

test('moodCurve: finds irritability clustered before the period', () => {
  const { logs, cycles } = world([28, 28, 28, 28], ({ before }) =>
    ({ moods: before <= 4 ? ['irritable'] : ['calm'] }));
  const curve = /** @type {NonNullable<ReturnType<typeof moodCurve>>} */ (moodCurve(logs, cycles));
  assert.equal(curve.cycles, 4);
  assert.equal(curve.before[0], 1);
  assert.equal(curve.before[8], 0);
  const f = /** @type {NonNullable<typeof curve.finding>} */ (curve.finding);
  assert.ok(f);
  assert.equal(f.window, 4);
  assert.ok(f.windowRate > 0.7);
  assert.equal(f.restRate, 0);
  assert.ok(f.windowN >= 8 && f.restN >= 8);
});

test('moodCurve: no finding when moods are uniform across the cycle', () => {
  const { logs, cycles } = world([28, 28, 28, 28], () => ({ moods: ['irritable'] }));
  const curve = moodCurve(logs, cycles);
  assert.ok(curve);
  assert.equal(curve.finding, null);
});

test('moodCurve: a small rise is not a finding', () => {
  // About 40% before, about 33% elsewhere: a few points and 1.2x, under both bars.
  const { logs, cycles } = world([28, 28, 28, 28, 28], ({ before, after, cycle }) => {
    const hard = before <= 5 ? cycle < 2 : (after + cycle) % 3 === 0;
    return { moods: [hard ? 'sad' : 'calm'] };
  });
  const curve = /** @type {NonNullable<ReturnType<typeof moodCurve>>} */ (moodCurve(logs, cycles));
  assert.equal(curve.finding, null);
  assert.ok(curve.before[0] != null && curve.before[0] > 0.3);
});

test('moodCurve: null with fewer than three cycles or twenty mood days', () => {
  const two = world([28, 28], () => ({ moods: ['sad'] }));
  assert.equal(moodCurve(two.logs, two.cycles), null);
  const sparse = world([28, 28, 28], ({ after }) => ({ moods: after === 1 ? ['sad'] : [] }));
  assert.equal(moodCurve(sparse.logs, sparse.cycles), null);
});

// --- sleep curve --------------------------------------------------------------

test('sleepCurve: sleep drops before the period, as negative minutes', () => {
  const { logs, cycles } = world([28, 28, 28], ({ before }) => ({ sleep: before <= 7 ? 6.5 : 8 }));
  const curve = /** @type {NonNullable<ReturnType<typeof sleepCurve>>} */ (sleepCurve(logs, cycles));
  assert.equal(curve.cycles, 3);
  const f = /** @type {NonNullable<typeof curve.finding>} */ (curve.finding);
  assert.ok(f);
  assert.equal(f.minutes, -90);
  assert.equal(f.windowMean, 6.5);
  assert.equal(f.restMean, 8);
  assert.equal(curve.before[0], 6.5);
  assert.equal(curve.after[0], 8);
});

test('sleepCurve: a rise is positive, and under 20 minutes is nothing', () => {
  const longer = world([28, 28, 28], ({ before }) => ({ sleep: before <= 7 ? 9 : 7.5 }));
  assert.equal(sleepCurve(longer.logs, longer.cycles)?.finding?.minutes, 90);
  const same = world([28, 28, 28], ({ before }) => ({ sleep: before <= 7 ? 7.2 : 7.0 }));
  const curve = sleepCurve(same.logs, same.cycles);
  assert.ok(curve);
  assert.equal(curve.finding, null);
});

test('sleepCurve: no finding when either group has under eight nights', () => {
  // Sleep logged only in the week before the period: nothing to compare against.
  const { logs, cycles } = world([28, 28, 28], ({ before }) => ({ sleep: before <= 7 ? 6 : null }));
  const curve = sleepCurve(logs, cycles);
  assert.ok(curve);
  assert.equal(curve.finding, null);
  assert.equal(curve.before[0], 6);
  assert.equal(curve.after[0], null);
});

test('sleepCurve: restless share counts symptoms even without hours', () => {
  const { logs, cycles } = world([28, 28, 28], ({ before }) => ({
    sleep: before % 2 ? 7 : null,
    symptoms: before <= 2 ? ['restless-sleep'] : [],
  }));
  const curve = /** @type {NonNullable<ReturnType<typeof sleepCurve>>} */ (sleepCurve(logs, cycles));
  assert.equal(curve.restless.before[0], 1);   // before 1: odd, restless
  assert.equal(curve.restless.before[1], 1);   // before 2: no hours but restless symptom
  assert.equal(curve.restless.before[2], 0);   // before 3: hours logged, no symptom
  assert.equal(curve.restless.before[3], null); // before 4: neither, not observed
});

test('sleepCurve: null with fewer than two cycles or fourteen nights', () => {
  const one = world([28], () => ({ sleep: 7 }));
  assert.equal(sleepCurve(one.logs, one.cycles), null);
  const thin = world([28, 28], ({ after }) => ({ sleep: after <= 6 ? 7 : null }));
  assert.equal(sleepCurve(thin.logs, thin.cycles), null);   // 12 nights
});

// --- what goes with it ---------------------------------------------------------

/**
 * A run of days, some of them "bad" (low water, headache), without any cycle.
 * @param {number} lowDays @param {number} lowWithHeadache
 * @param {number} okDays @param {number} okWithHeadache
 */
function waterDays(lowDays, lowWithHeadache, okDays, okWithHeadache) {
  /** @type {Record<string, any>} */
  const logs = {};
  let i = 0;
  const add = (/** @type {number} */ water, /** @type {boolean} */ headache) => {
    const date = addDays('2026-03-01', i++);
    logs[date] = { ...emptyLog(date), water, checkedIn: true, symptoms: headache ? ['headache'] : [] };
  };
  for (let n = 0; n < lowDays; n++) add(500, n < lowWithHeadache);
  for (let n = 0; n < okDays; n++) add(1800, n < okWithHeadache);
  return logs;
}

test('goesWith: headaches go with low water', () => {
  const logs = waterDays(16, 12, 24, 2);
  const out = goesWith(logs, '2099-01-01');
  assert.equal(out.length, 1);
  const c = out[0];
  assert.equal(c.condition, 'lowWater');
  assert.equal(c.outcome, 'headache');
  assert.deepEqual([c.withN, c.withHits, c.withoutN, c.withoutHits], [16, 12, 24, 2]);
  assert.equal(c.rateWith, 0.75);
  assert.ok(c.ratio && c.ratio > 8);
});

test('goesWith: today is excluded, and days without water or sleep sit out', () => {
  const logs = waterDays(16, 12, 24, 2);
  const today = '2026-03-01';
  // Today is the first low-water headache day. Without exclusion, withN would be 16.
  const c = goesWith(logs, today)[0];
  assert.equal(c.withN, 15);
  assert.equal(c.withHits, 11);

  // A day with no water logged (0) is neither low nor ok.
  const date = '2027-01-01';
  logs[date] = { ...emptyLog(date), water: 0, checkedIn: true, symptoms: ['headache'] };
  const again = goesWith(logs, '2099-01-01')[0];
  assert.equal(again.withN, 16);
  assert.equal(again.withoutN, 24);
});

test('goesWith: no claim from a weak or thin difference', () => {
  assert.deepEqual(goesWith(waterDays(16, 6, 24, 8), '2099-01-01'), []);   // 38% vs 33%
  assert.deepEqual(goesWith(waterDays(7, 7, 24, 0), '2099-01-01'), []);    // only 7 low days
  assert.deepEqual(goesWith(waterDays(16, 3, 24, 0), '2099-01-01'), []);   // never otherwise, but only 3 hits
  assert.equal(goesWith(waterDays(16, 4, 24, 0), '2099-01-01').length, 1); // 4 hits is enough
});

test('goesWith: days with nothing logged do not count as "no symptom"', () => {
  // 10 low-water days with headache; ok-water days have water but are not checked in
  // and have no symptom: they say nothing about headaches, so there is nothing to compare.
  const logs = waterDays(10, 10, 0, 0);
  for (let i = 0; i < 20; i++) {
    const date = addDays('2026-06-01', i);
    logs[date] = { ...emptyLog(date), water: 2000 };
  }
  assert.deepEqual(goesWith(logs, '2099-01-01'), []);
});

test('goesWith: hard mood only counts on days with a mood, and at most two per condition', () => {
  /** @type {Record<string, any>} */
  const logs = {};
  const rough = ['headache', 'cramps', 'bloating', 'tired'];
  for (let i = 0; i < 40; i++) {
    const date = addDays('2026-03-01', i);
    const bad = i < 15;
    logs[date] = {
      ...emptyLog(date), checkedIn: true,
      sleep: bad ? 4.5 : 8, water: bad ? 600 : 2000,
      symptoms: bad ? rough : [],
      moods: [bad ? 'irritable' : 'calm'],
    };
  }
  // Mood-less days with short sleep must not pad the hard-mood comparison.
  for (let i = 0; i < 10; i++) {
    const date = addDays('2026-08-01', i);
    logs[date] = { ...emptyLog(date), sleep: 4, water: 2000 };
  }
  const out = goesWith(logs, '2099-01-01', 10);
  const per = (/** @type {string} */ c) => out.filter((x) => x.condition === c).length;
  assert.equal(per('shortSleep'), 2);
  assert.equal(per('lowWater'), 2);
  assert.equal(out.length, 4);
  assert.equal(goesWith(logs, '2099-01-01').length, 3);                 // default limit
  const mood = goesWith(logs, '2099-01-01', 10).find((c) => c.outcome === 'hard-mood');
  if (mood) assert.equal(mood.withN, 15);
  // Sorted by the size of the gap.
  const gaps = out.map((c) => c.rateWith - c.rateWithout);
  assert.deepEqual(gaps, [...gaps].sort((a, b) => b - a));
});

// --- period fingerprint ---------------------------------------------------------

/**
 * Cycles of 28 days whose periods have the given lengths, with flows chosen by
 * `flowOf(day, cycleIndex)` (1-based day).
 * @param {number[]} lens
 * @param {(day: number, i: number) => string} flowOf
 */
function periods(lens, flowOf) {
  /** @type {string[]} */
  const periodDays = [];
  /** @type {Record<string, any>} */
  const logs = {};
  lens.forEach((len, i) => {
    const start = addDays(START, i * 28);
    for (let d = 1; d <= len; d++) {
      const date = addDays(start, d - 1);
      periodDays.push(date);
      logs[date] = { ...emptyLog(date), flow: flowOf(d, i) };
    }
  });
  return { logs, cycles: buildCycles(periodDays) };
}

test('periodFingerprint: finds the heaviest day, newest period first', () => {
  const shape = ['light', 'heavy', 'medium', 'light', 'spotting'];
  const { logs, cycles } = periods([5, 5, 5, 5, 5, 5], (d) => shape[d - 1]);
  const fp = /** @type {NonNullable<ReturnType<typeof periodFingerprint>>} */ (periodFingerprint(logs, cycles));
  assert.equal(fp.rows.length, 6);
  assert.deepEqual(fp.heaviestDay, { day: 2, share: 1 });
  assert.deepEqual(fp.rows[0].flows, shape);
  assert.equal(fp.rows[0].length, 5);
  assert.ok(fp.rows[0].start > fp.rows[1].start);
  assert.equal(fp.rows[0].start, cycles[5].start);
  assert.equal(fp.lengthTrend, null);
  assert.equal(fp.longPeriods, 0);
});

test('periodFingerprint: heaviest day is the first of a tie, and needs 60% agreement', () => {
  // Two heavy days each time: day 2 and day 3 tie, so day 2 wins every period.
  const tie = periods([5, 5, 5], (d) => (d === 2 || d === 3 ? 'heavy' : 'light'));
  assert.equal(periodFingerprint(tie.logs, tie.cycles)?.heaviestDay?.day, 2);

  // Heaviest on day 1, 2 or 3 in turn: nobody reaches 60%.
  const mixed = periods([5, 5, 5, 5, 5, 5], (d, i) => (d === (i % 3) + 1 ? 'heavy' : 'light'));
  assert.equal(periodFingerprint(mixed.logs, mixed.cycles)?.heaviestDay, null);

  // Only two periods vary: not enough to say.
  const two = periods([5, 5], (d) => (d === 2 ? 'heavy' : 'light'));
  assert.equal(periodFingerprint(two.logs, two.cycles)?.heaviestDay, null);
});

test('periodFingerprint: a flat period has no heaviest day', () => {
  const flat = periods([5, 5, 5, 5, 5, 5], () => 'medium');
  const fp = /** @type {NonNullable<ReturnType<typeof periodFingerprint>>} */ (periodFingerprint(flat.logs, flat.cycles));
  assert.equal(fp.heaviestDay, null);

  // Marked days with no log at all are medium by convention: also flat.
  const bare = periods([5, 5, 5, 5], () => 'medium');
  const emptyLogs = {};
  assert.equal(periodFingerprint(emptyLogs, bare.cycles)?.heaviestDay, null);
  assert.deepEqual(periodFingerprint(emptyLogs, bare.cycles)?.rows[0].flows, Array(5).fill('medium'));
});

test('periodFingerprint: length trend and long periods', () => {
  const { logs, cycles } = periods([4, 4, 4, 6, 6, 8], () => 'medium');
  const fp = /** @type {NonNullable<ReturnType<typeof periodFingerprint>>} */ (periodFingerprint(logs, cycles));
  // newest three: 6, 6, 8 (mean 6.67); the three before: 4, 4, 4.
  assert.equal(fp.lengthTrend?.change, 2.7);
  assert.equal(fp.longPeriods, 1);
  assert.deepEqual(fp.rows.map((r) => r.length), [8, 6, 6, 4, 4, 4]);

  // Shrinking is negative.
  const shrinking = periods([7, 7, 7, 4, 4, 4], () => 'medium');
  assert.equal(periodFingerprint(shrinking.logs, shrinking.cycles)?.lengthTrend?.change, -3);

  // Under a day and a half is not a trend, and fewer than six periods cannot show one.
  const steady = periods([5, 5, 5, 6, 6, 5], () => 'medium');
  assert.equal(periodFingerprint(steady.logs, steady.cycles)?.lengthTrend, null);
  const few = periods([3, 3, 3, 7, 7], () => 'medium');
  assert.equal(periodFingerprint(few.logs, few.cycles)?.lengthTrend, null);
});

test('periodFingerprint: limit windows the rows; null below two periods', () => {
  const { logs, cycles } = periods([5, 5, 5, 5, 5, 5, 5, 5], () => 'medium');
  assert.equal(periodFingerprint(logs, cycles)?.rows.length, 6);
  assert.equal(periodFingerprint(logs, cycles, 3)?.rows.length, 3);
  assert.equal(periodFingerprint(logs, cycles, 3)?.lengthTrend, null);

  const one = periods([5], () => 'medium');
  assert.equal(periodFingerprint(one.logs, one.cycles), null);
  assert.equal(periodFingerprint({}, []), null);
});

test('easierDays: a quiet stretch between period and PMS is found, inside her own data', () => {
  let seed = 3;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const { logs, cycles } = world([28, 29, 28, 27, 28], ({ after, before }) => {
    /** @type {string[]} */
    const symptoms = [];
    if (after <= 3) symptoms.push('cramps');
    if (before <= 6) symptoms.push('bloating');
    // Middle days are quiet apart from the odd headache; days 15 to 22 are not.
    if (after >= 15 && before > 6 && rand() < 0.6) symptoms.push('fatigue');
    if (after >= 6 && after <= 13 && rand() < 0.05) symptoms.push('headache');
    return { symptoms, checkedIn: true };
  });
  const easy = easierDays(logs, cycles);
  assert.ok(easy, 'a window is found');
  assert.ok(easy.from >= 6 && easy.to <= 14 && easy.to - easy.from >= 3, JSON.stringify(easy));
});

test('easierDays: logging evenly, or hardly at all, gives no window', () => {
  let seed = 5;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const even = world([28, 28, 28, 28], () => ({ symptoms: rand() < 0.4 ? ['fatigue'] : [], checkedIn: true }));
  assert.equal(easierDays(even.logs, even.cycles), null);
  const quiet = world([28, 28, 28, 28], () => ({ checkedIn: true }));
  assert.equal(easierDays(quiet.logs, quiet.cycles), null);
  const short = world([28, 28], ({ after }) => ({ symptoms: after <= 3 ? ['cramps'] : [], checkedIn: true }));
  assert.equal(easierDays(short.logs, short.cycles), null);
});
