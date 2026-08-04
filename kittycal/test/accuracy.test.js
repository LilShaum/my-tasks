// @ts-check
/**
 * accuracy.test.js — the app scoring itself.
 *
 * The one figure in Kittycal that describes the app rather than the user, and
 * the only one it has any incentive to flatter. So the tests care most about
 * the cases where it must decline to claim anything: too little history, and
 * a bias too small to name.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { predictionAccuracy, CLOSE_ENOUGH, MIN_SCORED } from '../js/domain/accuracy.js';
import { buildCycles } from '../js/domain/cycles.js';
import { addDays } from '../js/utils/date.js';

/**
 * Cycles of the given lengths, back to back from 1 January.
 * @param {number[]} lengths
 */
function cyclesOf(lengths) {
  const days = new Set();
  let cursor = '2026-01-01';
  for (const length of lengths) {
    for (let i = 0; i < 5; i += 1) days.add(addDays(cursor, i));
    cursor = addDays(cursor, length);
  }
  // One more period so the final listed cycle is complete.
  for (let i = 0; i < 5; i += 1) days.add(addDays(cursor, i));
  return buildCycles(days);
}

test('nothing is claimed without enough history to score', () => {
  for (const lengths of [[], [28], [28, 28]]) {
    const out = predictionAccuracy(cyclesOf(lengths));
    assert.ok(out.total < MIN_SCORED,
      `${lengths.length} cycles produced ${out.total} scored predictions`);
  }
});

test('a perfectly regular history scores perfectly', () => {
  const out = predictionAccuracy(cyclesOf([28, 28, 28, 28, 28, 28]));

  assert.ok(out.total >= MIN_SCORED, `only ${out.total} scored`);
  assert.equal(out.hits, out.total, 'every prediction should have landed');
  assert.equal(out.medianError, 0);
  assert.equal(out.bias, 0);
});

test('the error is signed so the direction survives', () => {
  // Settled at 28, then every later cycle runs long. The app, averaging the
  // past, keeps naming a day too early.
  const out = predictionAccuracy(cyclesOf([28, 28, 28, 34, 34, 34, 34]));

  assert.ok(out.total >= MIN_SCORED);
  assert.ok(/** @type {number} */ (out.bias) > 0,
    `bias ${out.bias} — positive means the app predicted before the period arrived`);
  assert.ok(out.scored.every((s) => s.predicted <= s.actual),
    'every prediction should sit on or before the real day');
});

test('a wildly irregular history scores badly, and says so', () => {
  const out = predictionAccuracy(cyclesOf([21, 45, 22, 44, 23, 43, 24]));

  assert.ok(out.total >= MIN_SCORED);
  assert.ok(out.medianError > CLOSE_ENOUGH,
    `median miss was ${out.medianError} days, which should not read as accurate`);
  assert.ok(out.hits < out.total, 'it must not claim to have hit every one');
});

test('one disrupted cycle does not define the record', () => {
  // Five good cycles and one that ran a fortnight long.
  const out = predictionAccuracy(cyclesOf([28, 28, 28, 28, 42, 28, 28, 28]));

  const errors = out.scored.map((s) => Math.abs(s.errorDays));
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;

  /*
    Not "the median stays under two days" — that was a wish rather than a
    property. A fourteen-day disruption genuinely does spoil the next few
    forecasts, because it stays inside the six-cycle averaging window, and an
    accuracy figure that hid this would be exactly the flattery this card
    exists to avoid.

    The real claim is narrower: the median describes a typical cycle while the
    mean is dragged by the bad one.
  */
  assert.ok(out.medianError < mean,
    `median ${out.medianError} vs mean ${mean.toFixed(1)}`);
  assert.ok(out.medianError < 14 / 2,
    `median ${out.medianError} — the outlier should not be describing the record`);
});

test('every scored entry compares a real prediction with a real outcome', () => {
  const out = predictionAccuracy(cyclesOf([27, 29, 28, 30, 28, 29]));

  for (const s of out.scored) {
    assert.match(s.actual, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(s.predicted, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof s.errorDays, 'number');
    assert.ok(Number.isFinite(s.errorDays));
  }
  assert.equal(out.hits, out.scored.filter((s) => Math.abs(s.errorDays) <= CLOSE_ENOUGH).length);
});

test('implausible gaps are not scored as predictions', () => {
  // A 200-day gap is a stretch of not logging, not a cycle to be judged on.
  const out = predictionAccuracy(cyclesOf([28, 28, 200, 28, 28, 28]));
  assert.ok(out.scored.every((s) => Math.abs(s.errorDays) < 100),
    'a logging gap should not appear as a 170-day miss');
});
