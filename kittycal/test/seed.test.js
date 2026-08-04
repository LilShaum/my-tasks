// @ts-check
/**
 * seed.test.js — turning remembered dates into cycles.
 *
 * Onboarding now asks for up to four period starts and one average bleed
 * length. The risk is quiet and expensive: apply the length literally and a
 * bleed can run into the next start, at which point `buildCycles` reads two
 * periods as one long one — and every average, prediction and flag in the app
 * is built from that reading. So most of this is about the clipping.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  seedPeriodDays, buildCycles, cycleLengths, CYCLE_LENGTH_FLOOR,
} from '../js/domain/cycles.js';
import { addDays } from '../js/utils/date.js';

const TODAY = '2026-07-29';

test('one remembered start is one period and no complete cycle', () => {
  const days = seedPeriodDays(['2026-07-01'], 5, TODAY);
  assert.deepEqual(days, [
    '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05',
  ]);
  assert.equal(cycleLengths(buildCycles(new Set(days))).length, 0);
});

test('each extra remembered start is one more measurable cycle', () => {
  const days = seedPeriodDays(['2026-07-01', '2026-06-03', '2026-05-08'], 5, TODAY);
  const lengths = cycleLengths(buildCycles(new Set(days)));

  assert.deepEqual(lengths, [26, 28], 'two complete cycles from three dates');
});

test('a bleed is clipped at the next start rather than overrunning it', () => {
  const days = seedPeriodDays(['2026-07-01', '2026-06-28'], 5, TODAY);

  assert.deepEqual(days, [
    '2026-06-28', '2026-06-29', '2026-06-30',   // clipped from five to three
    '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05',
  ]);
  assert.equal(new Set(days).size, days.length, 'no day is marked twice');
});

test('starts closer than a cycle merge, which is why the step will not take them', () => {
  /*
    The honest limit of the data model, pinned so it is not mistaken for a bug
    later. `periodDays` is a flat set and a period is whatever marked days sit
    next to each other, so two starts three days apart cannot be two periods —
    clipped or not, the marks are contiguous and read as one long bleed.

    Nothing here can fix that; the fix is upstream, and the earlier-periods step
    will not accept a date less than CYCLE_LENGTH_FLOOR before the one above it.
  */
  const cycles = buildCycles(new Set(seedPeriodDays(['2026-07-01', '2026-06-28'], 5, TODAY)));
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].periodLength, 8);

  // At the floor the app enforces, they separate properly.
  const apart = buildCycles(new Set(
    seedPeriodDays(['2026-07-01', addDays('2026-07-01', -CYCLE_LENGTH_FLOOR)], 5, TODAY),
  ));
  assert.equal(apart.length, 2);
  assert.deepEqual(cycleLengths(apart), [CYCLE_LENGTH_FLOOR]);
});

test('the future is never marked as bled', () => {
  const days = seedPeriodDays(['2026-07-27'], 5, TODAY);
  assert.deepEqual(days, ['2026-07-27', '2026-07-28', '2026-07-29']);
});

test('order in, order out — the caller does not have to sort', () => {
  const jumbled = seedPeriodDays(['2026-05-08', '2026-07-01', '2026-06-03'], 5, TODAY);
  const sorted = seedPeriodDays(['2026-05-08', '2026-06-03', '2026-07-01'], 5, TODAY);
  assert.deepEqual(jumbled, sorted);
  assert.deepEqual([...jumbled].sort(), jumbled, 'and the result is oldest first');
});

test('a repeated date does not double up', () => {
  const days = seedPeriodDays(['2026-07-01', '2026-07-01'], 3, TODAY);
  assert.deepEqual(days, ['2026-07-01', '2026-07-02', '2026-07-03']);
});

test('nothing remembered marks nothing', () => {
  assert.deepEqual(seedPeriodDays([], 5, TODAY), []);
});

test('a bleed length of zero still marks the start day', () => {
  // The start is the one thing she actually told us; it must survive any
  // nonsense in the length, which is a separate answer she may have skipped.
  assert.deepEqual(seedPeriodDays(['2026-07-01'], 0, TODAY), ['2026-07-01']);
});

test('four remembered starts reach three complete cycles', () => {
  // Three is the threshold at which the prediction engine stops calling itself
  // an estimate, which is the whole reason the step asks for three extras.
  const days = seedPeriodDays(
    ['2026-07-01', '2026-06-03', '2026-05-08', '2026-04-10'], 5, TODAY,
  );
  assert.equal(cycleLengths(buildCycles(new Set(days))).length, 3);
});
