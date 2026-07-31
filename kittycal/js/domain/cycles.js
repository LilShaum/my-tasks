// @ts-check
/**
 * cycles.js — turn a set of period days into a list of cycles.
 *
 * Pure functions over plain data, no I/O and no store access, so all of this is
 * directly unit-testable — which matters, because this is where the subtle bugs
 * live.
 *
 * The input is the set of days she has confirmed as bleeding. Nothing about
 * cycles is ever stored: it's all derived here, every time. That's what makes
 * retroactive edits work correctly — marking a period back in March
 * automatically re-shapes every cycle and prediction after it.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 */

import { addDays, daysBetween, range } from '../utils/date.js';

/**
 * A single unlogged day inside a period doesn't split it. People forget to open
 * the app, and two periods can't physically start two days apart — so treating
 * a one-day gap as continuous is much more often right than wrong.
 */
const PERIOD_GAP_TOLERANCE = 1;

/**
 * Two period starts closer than this are the same period logged with a bigger
 * gap, not two cycles. Below this we merge rather than record an absurd
 * cycle length.
 */
const MIN_PLAUSIBLE_CYCLE = 10;

/** Cycle lengths outside this range are excluded from averaging. */
export const CYCLE_LENGTH_FLOOR = 15;
export const CYCLE_LENGTH_CEIL = 90;

/**
 * @typedef {Object} Period
 * @property {DateKey} start   first bleeding day
 * @property {DateKey} end     last bleeding day
 * @property {number} length   inclusive day count
 * @property {DateKey[]} days  the actual logged days (may skip one)
 */

/**
 * @typedef {Object} Cycle
 * @property {number} index          0-based, chronological
 * @property {DateKey} start         first day of this cycle's period
 * @property {DateKey} periodEnd     last bleeding day
 * @property {number} periodLength
 * @property {DateKey|null} nextStart
 * @property {number|null} length    days from this start to the next; null for
 *                                   the current, still-running cycle
 * @property {boolean} complete
 */

/**
 * Group period days into discrete periods.
 * @param {Set<DateKey>|DateKey[]} periodDays
 * @returns {Period[]}
 */
export function buildPeriods(periodDays) {
  const sorted = [...periodDays].sort();
  if (!sorted.length) return [];

  /** @type {Period[]} */
  const periods = [];
  /** @type {DateKey[]} */
  let current = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const gap = daysBetween(sorted[i - 1], sorted[i]);
    if (gap <= PERIOD_GAP_TOLERANCE + 1) {
      current.push(sorted[i]);
    } else {
      periods.push(makePeriod(current));
      current = [sorted[i]];
    }
  }
  periods.push(makePeriod(current));

  return mergeImplausible(periods);
}

/**
 * @param {DateKey[]} days
 * @returns {Period}
 */
function makePeriod(days) {
  const start = days[0];
  const end = days[days.length - 1];
  return { start, end, length: daysBetween(start, end) + 1, days };
}

/**
 * Fold together periods whose starts are implausibly close. Runs repeatedly
 * until stable, so a run of three closely-spaced fragments collapses fully
 * rather than only pairwise.
 * @param {Period[]} periods
 * @returns {Period[]}
 */
function mergeImplausible(periods) {
  if (periods.length < 2) return periods;

  /** @type {Period[]} */
  const out = [periods[0]];
  for (let i = 1; i < periods.length; i++) {
    const previous = out[out.length - 1];
    const gap = daysBetween(previous.start, periods[i].start);
    if (gap < MIN_PLAUSIBLE_CYCLE) {
      out[out.length - 1] = makePeriod([...previous.days, ...periods[i].days]);
    } else {
      out.push(periods[i]);
    }
  }
  return out;
}

/**
 * Build the cycle list. The final cycle is open — it has no next start yet, so
 * its length is null and it's marked incomplete. Callers must not average it
 * in; `cycleLengths` below already excludes it.
 * @param {Set<DateKey>|DateKey[]} periodDays
 * @returns {Cycle[]}
 */
export function buildCycles(periodDays) {
  const periods = buildPeriods(periodDays);

  return periods.map((period, i) => {
    const nextStart = i + 1 < periods.length ? periods[i + 1].start : null;
    return {
      index: i,
      start: period.start,
      periodEnd: period.end,
      periodLength: period.length,
      nextStart,
      length: nextStart ? daysBetween(period.start, nextStart) : null,
      complete: nextStart != null,
    };
  });
}

/**
 * Completed cycle lengths, oldest first, with implausible values dropped. A
 * 200-day "cycle" is a logging gap, not a cycle, and letting it into the mean
 * would wreck every prediction downstream.
 * @param {Cycle[]} cycles
 * @returns {number[]}
 */
export function cycleLengths(cycles) {
  return cycles
    .filter((c) => c.length != null)
    .map((c) => /** @type {number} */ (c.length))
    .filter((n) => n >= CYCLE_LENGTH_FLOOR && n <= CYCLE_LENGTH_CEIL);
}

/**
 * Period lengths, oldest first. The most recent period is excluded when it
 * might still be running (it ends today or yesterday), since counting a period
 * mid-flow would drag the average down.
 * @param {Cycle[]} cycles
 * @param {DateKey} today
 * @returns {number[]}
 */
export function periodLengths(cycles, today) {
  return cycles
    .filter((c) => {
      const stillRunning = daysBetween(c.periodEnd, today) <= 1;
      return !(stillRunning && !c.complete);
    })
    .map((c) => c.periodLength);
}

/**
 * The cycle containing `date`, or null.
 * @param {Cycle[]} cycles
 * @param {DateKey} date
 * @returns {Cycle|null}
 */
export function cycleContaining(cycles, date) {
  for (let i = cycles.length - 1; i >= 0; i--) {
    const cycle = cycles[i];
    if (date < cycle.start) continue;
    if (cycle.nextStart && date >= cycle.nextStart) continue;
    return cycle;
  }
  return null;
}

/**
 * Day-of-cycle for a date, 1-based. Null when the date precedes all logged
 * history — we can't know where in a cycle she was before she started logging,
 * and guessing would be worse than saying nothing.
 * @param {Cycle[]} cycles
 * @param {DateKey} date
 * @returns {number|null}
 */
export function cycleDay(cycles, date) {
  const cycle = cycleContaining(cycles, date);
  if (!cycle) return null;
  return daysBetween(cycle.start, date) + 1;
}

/** @param {Cycle[]} cycles @returns {Cycle|null} */
export function currentCycle(cycles) {
  return cycles.length ? cycles[cycles.length - 1] : null;
}

/** @param {Cycle[]} cycles @returns {DateKey|null} */
export function lastPeriodStart(cycles) {
  return cycles.length ? cycles[cycles.length - 1].start : null;
}

/**
 * Is `date` inside a logged period? Uses the period span rather than the raw
 * day set, so a single skipped day inside a period still reads as a period day
 * on the calendar.
 * @param {Cycle[]} cycles
 * @param {DateKey} date
 */
export function isPeriodDay(cycles, date) {
  return cycles.some((c) => date >= c.start && date <= c.periodEnd);
}

/**
 * Every day covered by a period, as a set.
 *
 * Same rule as `isPeriodDay`, answered for a whole screen at once. That scans
 * every cycle per call, which is fine for one date and wasteful for 365 — five
 * years of history meant tens of thousands of comparisons to paint the year
 * view.
 *
 * @param {Cycle[]} cycles
 * @returns {Set<DateKey>}
 */
export function filledPeriodDays(cycles) {
  /** @type {Set<DateKey>} */
  const out = new Set();
  for (const cycle of cycles) {
    for (const day of range(cycle.start, cycle.periodEnd)) out.add(day);
  }
  return out;
}

/**
 * Mean, and the max-min spread, of the supplied lengths.
 * @param {number[]} lengths
 */
export function summarize(lengths) {
  if (!lengths.length) {
    return { count: 0, mean: null, min: null, max: null, spread: null, stdev: null };
  }
  const sum = lengths.reduce((a, b) => a + b, 0);
  const mean = sum / lengths.length;
  const min = Math.min(...lengths);
  const max = Math.max(...lengths);
  const variance =
    lengths.reduce((acc, n) => acc + (n - mean) ** 2, 0) / lengths.length;
  return {
    count: lengths.length,
    mean,
    min,
    max,
    spread: max - min,
    stdev: Math.sqrt(variance),
  };
}

/**
 * Expand a period's expected span for display, given a typical length. Used to
 * draw a *predicted* period, where only the start is estimated.
 * @param {DateKey} start
 * @param {number} length
 * @returns {{start: DateKey, end: DateKey}}
 */
export function periodSpan(start, length) {
  return { start, end: addDays(start, Math.max(1, Math.round(length)) - 1) };
}
