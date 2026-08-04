// @ts-check
/**
 * spotting.test.js — bleeding between periods.
 *
 * Two things can go wrong here and only one of them is a bug in the usual
 * sense. The first is missing a real pattern. The second, and the worse one,
 * is telling someone that a couple of stray marks are a finding worth taking
 * to a doctor — so most of what follows asserts silence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { spottingBetweenPeriods } from '../js/domain/stats.js';
import { evaluate, SPOTTING_MIN_CYCLES, SPOTTING_MIN_DAYS } from '../js/domain/acog.js';
import { buildCycles } from '../js/domain/cycles.js';
import { addDays, range } from '../js/utils/date.js';

/** Period days for `n` 28-day cycles of 5 days' bleeding, starting 1 Jan. */
function periodSet(n, { start = '2026-01-01', cycleLen = 28, periodLen = 5 } = {}) {
  /** @type {string[]} */
  const days = [];
  for (let i = 0; i < n; i += 1) {
    const s = addDays(start, i * cycleLen);
    days.push(...range(s, addDays(s, periodLen - 1)));
  }
  return new Set(days);
}

/** @param {string[]} dates */
const spotOn = (dates) => Object.fromEntries(dates.map((d) => [d, { flow: 'spotting' }]));

/** The flag, or undefined. */
const spotFlag = (logs, cycles) => evaluate({
  cycleLengths: [], periodLengths: [], daysSinceLastPeriod: null,
  spotting: spottingBetweenPeriods(logs, cycles),
}).find((f) => f.id === 'spotting');

test('the tail of a period is not bleeding between periods', () => {
  const cycles = buildCycles(periodSet(3));
  // Days 4 and 5 of the first period, logged as spotting rather than light.
  const out = spottingBetweenPeriods(spotOn(['2026-01-04', '2026-01-05']), cycles);
  assert.deepEqual(out, { days: 0, cycles: 0 });
});

test('spotting after a period ends is counted', () => {
  const cycles = buildCycles(periodSet(3));
  const out = spottingBetweenPeriods(spotOn(['2026-01-14', '2026-01-15']), cycles);
  assert.deepEqual(out, { days: 2, cycles: 1 });
});

test('days and cycles are counted separately', () => {
  const cycles = buildCycles(periodSet(4));
  const out = spottingBetweenPeriods(
    spotOn(['2026-01-14', '2026-01-15', '2026-02-11', '2026-03-15']),
    cycles,
  );
  assert.deepEqual(out, { days: 4, cycles: 3 });
});

test('one cycle of spotting is not a pattern, however many days', () => {
  const cycles = buildCycles(periodSet(4));
  const many = spotOn(['2026-01-14', '2026-01-15', '2026-01-16', '2026-01-17']);
  assert.equal(spottingBetweenPeriods(many, cycles).cycles, 1);
  assert.equal(spotFlag(many, cycles), undefined, 'one cycle stays quiet');
});

test('a single day in each of two cycles is not enough either', () => {
  const cycles = buildCycles(periodSet(4));
  const sparse = spotOn(['2026-01-14', '2026-02-11']);
  assert.deepEqual(spottingBetweenPeriods(sparse, cycles), { days: 2, cycles: 2 });
  assert.equal(spotFlag(sparse, cycles), undefined, 'two days is not three');
});

test('both thresholds met, and the flag says what was observed', () => {
  const cycles = buildCycles(periodSet(4));
  const logs = spotOn(['2026-01-14', '2026-01-15', '2026-02-11']);

  const counted = spottingBetweenPeriods(logs, cycles);
  assert.equal(counted.days, SPOTTING_MIN_DAYS);
  assert.equal(counted.cycles, SPOTTING_MIN_CYCLES);

  const flag = spotFlag(logs, cycles);
  assert.ok(flag, 'three days across two cycles is the pattern');
  assert.match(flag.title, /3 days/);
  assert.match(flag.title, /2 cycles/);
  // Never a diagnosis: it points at an appointment, not a condition.
  assert.match(flag.detail, /appointment/);
});

test('no spotting argument at all leaves the other flags alone', () => {
  const flags = evaluate({
    cycleLengths: [40, 41, 42], periodLengths: [], daysSinceLastPeriod: null,
  });
  assert.ok(flags.some((f) => f.id === 'cycle-long'));
  assert.ok(!flags.some((f) => f.id === 'spotting'));
});

test('period days themselves are never counted, whatever they are logged as', () => {
  const cycles = buildCycles(periodSet(4));
  // Every day of every period marked spotting — an odd but legal state.
  const logs = spotOn([...periodSet(4)]);
  assert.deepEqual(spottingBetweenPeriods(logs, cycles), { days: 0, cycles: 0 });
});
