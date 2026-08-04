// @ts-check
/**
 * accuracy.js — how often the app has actually been right.
 *
 * Kittycal has always shown a confidence badge: "Good confidence — based on 5
 * complete cycles." That is a claim about *method*. It says how much evidence
 * went in; it says nothing about whether anything that came out was true. The
 * app made a prediction every cycle, observed the answer a few weeks later, and
 * threw the comparison away every single time.
 *
 * This keeps it. For each completed cycle, re-run the same forecast using only
 * what was known before that cycle began, and compare it against the day the
 * period actually started. Over a year that is a dozen predictions with a dozen
 * outcomes — a measured error rate, from data already on the device, with
 * nothing new for her to log.
 *
 * Why bother, when the confidence badge already exists: a badge asks to be
 * believed, a hit rate can be checked. "Within two days on nine of your last
 * twelve" tells her exactly how much to lean on the number, including when the
 * honest answer is "not much". No app that sells a subscription on the strength
 * of its predictions has any reason to publish this; that is precisely why it
 * belongs here.
 *
 * The scoring is deliberately *retrodictive* — it replays history rather than
 * recording predictions as they were made. That means it also scores the
 * cycles logged before this code existed, and it cannot be gamed by the app
 * quietly forgetting a bad month.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./cycles.js').Cycle} Cycle
 */

import { addDays, daysBetween } from '../utils/date.js';
import { CYCLE_LENGTH_FLOOR, CYCLE_LENGTH_CEIL } from './cycles.js';

/** Predictions inside this many days of the truth count as a hit. */
export const CLOSE_ENOUGH = 2;

/** Cycles of history required before a prediction is scored at all. */
const MIN_HISTORY = 2;

/** And how many scored cycles before the figure is worth showing. */
export const MIN_SCORED = 3;

/**
 * @typedef {Object} Scored
 * @property {DateKey} actual     the day the period really started
 * @property {DateKey} predicted  the day the app would have named
 * @property {number} errorDays   signed: positive means the app was early
 */

/**
 * @typedef {Object} Accuracy
 * @property {Scored[]} scored     oldest first
 * @property {number} hits         within CLOSE_ENOUGH days
 * @property {number} total
 * @property {number} medianError  absolute, in days
 * @property {number|null} bias    median signed error; negative means it tends to run late
 */

/**
 * Score the app against its own history.
 *
 * The forecast replayed here is the plain one — the weighted mean of the
 * cycles before it, clamped — rather than every refinement `predict` applies.
 * That is on purpose in one direction only: it must never *flatter* the app.
 * Recalibration and the widened-window rules exist to handle uncertainty, and
 * folding them in would let a prediction that hedged score as well as one that
 * committed.
 *
 * @param {Cycle[]} cycles
 * @returns {Accuracy}
 */
export function predictionAccuracy(cycles) {
  const complete = cycles.filter((c) => c.complete && c.length != null);

  /** @type {Scored[]} */
  const scored = [];

  for (let i = MIN_HISTORY; i < complete.length; i += 1) {
    const history = complete
      .slice(0, i)
      .map((c) => /** @type {number} */ (c.length))
      .filter((n) => n >= CYCLE_LENGTH_FLOOR && n <= CYCLE_LENGTH_CEIL);

    if (history.length < MIN_HISTORY) continue;

    /*
      A cycle the app would not have learned from is not one it can be judged
      on either.

      `cycleLengths` already drops anything outside 15 to 90 days, on the
      grounds that a 200-day "cycle" is a stretch of not logging rather than a
      cycle. Scoring against one anyway produced a 170-day miss in the record —
      a number that says nothing about the forecast and everything about a
      month she spent not opening the app, sitting in the one figure meant to
      tell her how far to trust it.
    */
    const length = /** @type {number} */ (complete[i].length);
    if (length < CYCLE_LENGTH_FLOOR || length > CYCLE_LENGTH_CEIL) continue;

    const expected = weightedMean(history);
    const from = complete[i].start;
    const actual = /** @type {DateKey} */ (complete[i].nextStart);
    const predicted = addDays(from, Math.round(expected));

    scored.push({
      actual,
      predicted,
      // Positive when the app named a day before the period arrived.
      errorDays: daysBetween(predicted, actual),
    });
  }

  const errors = scored.map((s) => Math.abs(s.errorDays));
  const hits = errors.filter((e) => e <= CLOSE_ENOUGH).length;

  return {
    scored,
    hits,
    total: scored.length,
    medianError: median(errors),
    bias: scored.length ? median(scored.map((s) => s.errorDays)) : null,
  };
}

/**
 * The same weighting `predict` uses for its running average: recent cycles
 * count for more, over a window of six.
 * @param {number[]} lengths oldest first
 */
function weightedMean(lengths) {
  const recent = lengths.slice(-6);
  let total = 0;
  let weight = 0;
  recent.forEach((value, i) => {
    const w = i + 1;
    total += value * w;
    weight += w;
  });
  return total / weight;
}

/**
 * Median, not mean.
 *
 * One cycle disrupted by illness or travel can be a fortnight out, and a mean
 * lets that single month describe the app's whole record. The median says what
 * a typical prediction did, which is the question being asked.
 *
 * @param {number[]} values
 */
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
