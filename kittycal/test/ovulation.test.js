// @ts-check
/**
 * ovulation.test.js — measuring the number the app used to assume.
 *
 * Every fertile window is `next period − luteal length`, and that length was a
 * settings field defaulting to the population average of 14 which nothing ever
 * checked. These pin the measurement that replaces it, and — more importantly —
 * pin the cases where it must refuse to measure, because a wrong luteal length
 * is a systematic error repeated in every cycle rather than a one-off.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { confirmedOvulations, measuredLuteal, detectThermalShift } from '../js/domain/ovulation.js';
import { buildCycles } from '../js/domain/cycles.js';
import { emptyLog } from '../js/domain/model.js';
import { addDays } from '../js/utils/date.js';

/** `n` cycles of `length` days starting 1 January, five bleeding days each. */
function cyclesOf(n, length = 28) {
  const days = new Set();
  for (let c = 0; c < n; c += 1) {
    const start = addDays('2026-01-01', c * length);
    for (let i = 0; i < 5; i += 1) days.add(addDays(start, i));
  }
  return buildCycles(days);
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

/** A believable BBT run: low for `pre` days, then `post` days raised by 0.35. */
function bbtRun(from, pre, post) {
  /** @type {Record<string, any>} */
  const out = {};
  for (let i = 0; i < pre; i += 1) out[addDays(from, i)] = { bbt: 36.4 + (i % 2) * 0.02 };
  for (let i = 0; i < post; i += 1) out[addDays(from, pre + i)] = { bbt: 36.75 + (i % 2) * 0.02 };
  return out;
}

/* ── Dating ovulation ───────────────────────────────────────────────────── */

test('a positive test dates ovulation to the day after the surge', () => {
  // Cycle starts 1 Jan, next starts 29 Jan. Peak on the 14th → ovulation 15th.
  const found = confirmedOvulations(
    logsWith({ '2026-01-14': { testOvulation: 'peak' } }), cyclesOf(2));

  assert.equal(found.length, 1);
  assert.equal(found[0].ovulation, '2026-01-15', 'LH surge precedes ovulation by about a day');
  assert.equal(found[0].lutealDays, 14, 'ovulation to the next period');
  assert.equal(found[0].source, 'test');
});

test('a thermal shift dates it to the day before the rise', () => {
  // Temperature rises after ovulation, so the first high reading is day + 1.
  const found = confirmedOvulations(logsWith(bbtRun('2026-01-06', 6, 6)), cyclesOf(2));

  assert.equal(found.length, 1);
  assert.equal(found[0].ovulation, '2026-01-11', 'the rise starts on the 12th');
  assert.equal(found[0].source, 'temperature');
});

test('a test beats a temperature reading where both exist', () => {
  const logs = { ...logsWith(bbtRun('2026-01-06', 6, 6)),
    ...logsWith({ '2026-01-16': { testOvulation: 'peak' } }) };

  const found = confirmedOvulations(logs, cyclesOf(2));
  assert.equal(found[0].source, 'test', 'the surge is observed; the rise is inferred');
  assert.equal(found[0].ovulation, '2026-01-17');
});

/* ── Refusing to measure ────────────────────────────────────────────────── */

test('a cycle with no evidence contributes nothing', () => {
  assert.deepEqual(confirmedOvulations(logsWith({}), cyclesOf(3)), []);
});

test('the running cycle is never scored, because it has no next period', () => {
  const found = confirmedOvulations(
    // Day 14 of the *last* cycle, which has no cycle after it.
    logsWith({ '2026-02-11': { testOvulation: 'peak' } }), cyclesOf(2));
  assert.deepEqual(found, [], 'there is nothing to measure the luteal phase to');
});

test('an implausible luteal phase is dropped rather than averaged in', () => {
  // A "peak" two days before the next period would mean a 1-day luteal phase.
  const found = confirmedOvulations(
    logsWith({ '2026-01-27': { testOvulation: 'peak' } }), cyclesOf(2));
  assert.deepEqual(found, [], 'that is a mis-dated test, not a finding');
});

test('a high or negative test is not a peak', () => {
  for (const testOvulation of ['high', 'negative']) {
    assert.deepEqual(
      confirmedOvulations(logsWith({ '2026-01-14': { testOvulation } }), cyclesOf(2)), [],
      `"${testOvulation}" does not date ovulation`);
  }
});

/* ── The estimate ───────────────────────────────────────────────────────── */

test('one observation is not enough to move off the default', () => {
  const out = measuredLuteal(logsWith({ '2026-01-14': { testOvulation: 'peak' } }), cyclesOf(3));
  assert.equal(out.days, null, 'one reading is an anecdote');
  assert.equal(out.samples, 1);
});

test('two observations give a measurement', () => {
  const out = measuredLuteal(logsWith({
    '2026-01-14': { testOvulation: 'peak' },
    '2026-02-11': { testOvulation: 'peak' },
  }), cyclesOf(3));

  assert.equal(out.samples, 2);
  assert.equal(out.days, 14);
});

test('the median resists a single mis-dated cycle', () => {
  const out = measuredLuteal(logsWith({
    '2026-01-14': { testOvulation: 'peak' },   // luteal 14
    '2026-02-11': { testOvulation: 'peak' },   // luteal 14
    '2026-03-05': { testOvulation: 'peak' },   // luteal 19, an outlier
  }), cyclesOf(4));

  assert.equal(out.samples, 3);
  assert.equal(out.days, 14, 'a mean would have been dragged to 15.7');
});

test('a genuinely short luteal phase is believed', () => {
  // Ovulation on day 19 of a 28-day cycle → a 10-day luteal phase, twice.
  const out = measuredLuteal(logsWith({
    '2026-01-18': { testOvulation: 'peak' },
    '2026-02-15': { testOvulation: 'peak' },
  }), cyclesOf(3));

  assert.equal(out.days, 10,
    'this is the whole point — 14 would put her fertile window four days late');
});

/* ── The detector it is built on ────────────────────────────────────────── */

test('a flat temperature run has no shift', () => {
  const flat = Array.from({ length: 14 }, (_, i) => ({ date: addDays('2026-01-01', i), bbt: 36.4 }));
  assert.equal(detectThermalShift(flat), null);
});

test('a one-day spike is not a shift', () => {
  const readings = Array.from({ length: 14 }, (_, i) => ({
    date: addDays('2026-01-01', i), bbt: i === 8 ? 36.9 : 36.4,
  }));
  assert.equal(detectThermalShift(readings), null, 'it has to hold for three days');
});
