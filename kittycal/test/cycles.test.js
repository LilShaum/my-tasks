// @ts-check
/**
 * Cycle construction from a raw set of bleeding days. The interesting cases are
 * all about imperfect logging: a forgotten day mid-period, two fragments of one
 * period, a months-long gap where she stopped using the app.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPeriods, buildCycles, cycleLengths, periodLengths, cycleDay,
  cycleContaining, isPeriodDay, summarize, periodSpan, lastPeriodStart,
  filledPeriodDays,
} from '../js/domain/cycles.js';
import { range, addDays } from '../js/utils/date.js';

/** Helper: the days of a period starting at `start` running `len` days. */
const period = (start, len) => range(start, addDays(start, len - 1));

test('a single period yields one open cycle', () => {
  const cycles = buildCycles(period('2026-07-01', 5));
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].start, '2026-07-01');
  assert.equal(cycles[0].periodEnd, '2026-07-05');
  assert.equal(cycles[0].periodLength, 5);
  assert.equal(cycles[0].length, null, 'no next start yet');
  assert.equal(cycles[0].complete, false);
});

test('consecutive periods produce cycle lengths from start to start', () => {
  const days = [
    ...period('2026-01-01', 5),
    ...period('2026-01-29', 5), // 28 days later
    ...period('2026-02-26', 4), // 28 days later
  ];
  const cycles = buildCycles(days);
  assert.equal(cycles.length, 3);
  assert.equal(cycles[0].length, 28);
  assert.equal(cycles[1].length, 28);
  assert.equal(cycles[2].length, null);
  assert.deepEqual(cycleLengths(cycles), [28, 28]);
});

test('a single forgotten day inside a period does not split it', () => {
  // Logged 1,2,4,5 — day 3 was missed. That is one five-day period, not two.
  const days = ['2026-07-01', '2026-07-02', '2026-07-04', '2026-07-05'];
  const periods = buildPeriods(days);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].start, '2026-07-01');
  assert.equal(periods[0].end, '2026-07-05');
  assert.equal(periods[0].length, 5, 'span is inclusive of the missing day');
});

test('a two-day gap splits the run, but the fragments re-merge when adjacent', () => {
  // Days 1,2 then 5,6. The gap is wide enough to break the run, but two
  // periods cannot start four days apart — so this has to end up as one
  // period with a light patch in the middle, not two cycles.
  const periods = buildPeriods(['2026-07-01', '2026-07-02', '2026-07-05', '2026-07-06']);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].start, '2026-07-01');
  assert.equal(periods[0].end, '2026-07-06');
});

test('bleeding a fortnight apart is two separate periods', () => {
  // Far enough apart to be a genuine second episode rather than one period.
  const periods = buildPeriods([
    '2026-07-01', '2026-07-02',
    '2026-07-15', '2026-07-16',
  ]);
  assert.equal(periods.length, 2);
  assert.equal(periods[0].start, '2026-07-01');
  assert.equal(periods[1].start, '2026-07-15');
});

test('fragments closer than a plausible cycle are merged', () => {
  // Two "periods" starting four days apart cannot be two cycles.
  const periods = buildPeriods([
    '2026-07-01', '2026-07-02',
    '2026-07-05', '2026-07-06', '2026-07-07',
  ]);
  assert.equal(periods.length, 1, 'merged into one period');
  assert.equal(periods[0].start, '2026-07-01');
  assert.equal(periods[0].end, '2026-07-07');
});

test('three closely-spaced fragments collapse fully, not just pairwise', () => {
  const periods = buildPeriods([
    '2026-07-01', '2026-07-04', '2026-07-07', '2026-07-10',
  ]);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].end, '2026-07-10');
});

test('implausible cycle lengths are excluded from averaging but kept in history', () => {
  const days = [
    ...period('2026-01-01', 4),
    ...period('2026-01-29', 4),  // 28 — fine
    ...period('2026-10-01', 4),  // 245 days later: she stopped logging
    ...period('2026-10-29', 4),  // 28 — fine
  ];
  const cycles = buildCycles(days);
  assert.equal(cycles.length, 4, 'all four periods are still recorded');
  assert.deepEqual(cycleLengths(cycles), [28, 28], 'the 245-day gap is not a cycle');
});

test('cycleDay is 1-based from the period start', () => {
  const days = [...period('2026-07-01', 5), ...period('2026-07-29', 5)];
  const cycles = buildCycles(days);
  assert.equal(cycleDay(cycles, '2026-07-01'), 1);
  assert.equal(cycleDay(cycles, '2026-07-14'), 14);
  assert.equal(cycleDay(cycles, '2026-07-28'), 28);
  assert.equal(cycleDay(cycles, '2026-07-29'), 1, 'new cycle resets');
  assert.equal(cycleDay(cycles, '2026-06-30'), null, 'before all history');
});

test('cycleContaining picks the right cycle at a boundary', () => {
  const days = [...period('2026-07-01', 5), ...period('2026-07-29', 5)];
  const cycles = buildCycles(days);
  assert.equal(cycleContaining(cycles, '2026-07-28')?.start, '2026-07-01');
  assert.equal(cycleContaining(cycles, '2026-07-29')?.start, '2026-07-29');
});

test('isPeriodDay covers a skipped day inside the period span', () => {
  const cycles = buildCycles(['2026-07-01', '2026-07-02', '2026-07-04']);
  assert.ok(isPeriodDay(cycles, '2026-07-03'), 'the missed day still reads as period');
  assert.ok(!isPeriodDay(cycles, '2026-07-05'));
});

test('periodLengths excludes a period that may still be running', () => {
  // "Today" is the last logged bleeding day, so this period is not finished and
  // counting it would drag the average down.
  const cycles = buildCycles(period('2026-07-25', 3));
  assert.deepEqual(periodLengths(cycles, '2026-07-27'), []);
  // A week later it is clearly over and should count.
  assert.deepEqual(periodLengths(cycles, '2026-08-03'), [3]);
});

test('summarize reports mean, spread and stdev', () => {
  const s = summarize([26, 28, 30, 28]);
  assert.equal(s.count, 4);
  assert.equal(s.mean, 28);
  assert.equal(s.min, 26);
  assert.equal(s.max, 30);
  assert.equal(s.spread, 4);
  assert.ok(s.stdev != null && s.stdev > 1.4 && s.stdev < 1.5);
});

test('summarize on an empty list returns nulls rather than NaN', () => {
  const s = summarize([]);
  assert.equal(s.count, 0);
  assert.equal(s.mean, null);
  assert.equal(s.spread, null);
});

test('periodSpan is inclusive', () => {
  assert.deepEqual(periodSpan('2026-07-01', 5), { start: '2026-07-01', end: '2026-07-05' });
  assert.deepEqual(periodSpan('2026-07-01', 1), { start: '2026-07-01', end: '2026-07-01' });
});

test('lastPeriodStart returns the most recent period', () => {
  const days = [...period('2026-01-01', 4), ...period('2026-06-01', 4)];
  assert.equal(lastPeriodStart(buildCycles(days)), '2026-06-01');
  assert.equal(lastPeriodStart([]), null);
});

test('empty input produces no periods and no cycles', () => {
  assert.deepEqual(buildPeriods([]), []);
  assert.deepEqual(buildCycles([]), []);
  assert.deepEqual(cycleLengths([]), []);
});

test('a Set input works the same as an array', () => {
  const days = [...period('2026-01-01', 4), ...period('2026-01-29', 4)];
  const fromArray = buildCycles(days);
  const fromSet = buildCycles(new Set(days));
  assert.deepEqual(fromSet.map((c) => c.start), fromArray.map((c) => c.start));
});

test('unsorted input is handled', () => {
  const shuffled = ['2026-01-03', '2026-01-01', '2026-01-04', '2026-01-02'];
  const periods = buildPeriods(shuffled);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].start, '2026-01-01');
  assert.equal(periods[0].end, '2026-01-04');
});

test('filledPeriodDays covers the span, gaps included', () => {
  // One period marked 10th, 11th, 13th, 14th — the 12th deliberately missing.
  // buildPeriods tolerates a one-day gap, so this is one period, and the
  // calendar should not draw a hole through the middle of it.
  const cycles = buildCycles([
    '2026-06-10', '2026-06-11', '2026-06-13', '2026-06-14',
  ]);
  const filled = filledPeriodDays(cycles);

  assert.deepEqual([...filled].sort(), [
    '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14',
  ]);
});

test('filledPeriodDays agrees with isPeriodDay, date for date', () => {
  const days = [];
  for (let c = 0; c < 6; c++) {
    for (let i = 0; i < 5; i++) days.push(addDays('2026-01-05', c * 28 + i));
  }
  // Punch a hole so the gap-tolerance path is exercised.
  days.splice(days.indexOf(addDays('2026-01-05', 2 * 28 + 2)), 1);

  const cycles = buildCycles(days);
  const filled = filledPeriodDays(cycles);

  // Every day across the whole span must give the same answer both ways.
  for (let i = -10; i < 6 * 28 + 20; i++) {
    const date = addDays('2026-01-05', i);
    assert.equal(filled.has(date), isPeriodDay(cycles, date), date);
  }
});

test('filledPeriodDays is empty with no cycles', () => {
  assert.equal(filledPeriodDays([]).size, 0);
});
