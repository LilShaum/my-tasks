// @ts-check
/**
 * heads-up.js — what she usually gets before her period, said while there is
 * still time to do something about it.
 *
 * Insights already finds her patterns ("Bloating · 3/3 cycles · most often on
 * day 22"), and that knowledge stayed on a screen she has to go and read. The
 * moment it is useful is the day before, on the screen she actually opens —
 * so she can have the painkillers in her bag, move the hard conversation, or
 * simply know that the low mood is the cycle and not the week.
 *
 * Two choices that differ from the Insights view, both on purpose:
 *
 *   - Anchored to the *next* period, not to day 1. Premenstrual symptoms follow
 *     the coming period; "day 22" is five days early in a 27-day cycle and two
 *     late in a 30-day one. Counting back from each cycle's real next start is
 *     what makes "about 4 days before" true across cycles of different lengths.
 *   - Only things worth a warning. Physical symptoms, her own named ones, and
 *     the moods that are the reason people track PMS. "You usually feel happy
 *     around now" is not a heads-up.
 *
 * Held to the same standard as the Patterns card: three complete cycles before
 * anything is said, and present in at least 60% of them. Below that it is a
 * count, not a tendency, and this screen does not dress counts up as patterns.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./cycles.js').Cycle} Cycle
 * @typedef {import('./model.js').DayLog} DayLog
 */

import { addDays } from '../utils/date.js';
import { MIN_CYCLES_FOR_PATTERN } from './stats.js';

/** How far before a period counts as "before your period". */
export const BEFORE_WINDOW = 10;

/** Present in at least this share of complete cycles. Same as Patterns. */
const THRESHOLD = 0.6;

/**
 * And at least this many times as common before the period as in the rest of
 * the cycle.
 *
 * Without it, anything she logs all month — a headache that comes with low
 * water, acne that is always there — also turns up in the ten days before her
 * period, in most cycles, and was announced as something to expect. Being
 * present is not the same as being premenstrual; being concentrated there is.
 */
const CONCENTRATION = 2;

/** Days outside the window needed before the comparison above means anything. */
const MIN_REST_DAYS = 5;

/** Moods that are not something anyone needs warning of. */
const NOT_A_WARNING = new Set(['calm', 'happy', 'energetic', 'playful', 'confident', 'neutral']);

/**
 * @typedef {Object} PremenstrualPattern
 * @property {string} id
 * @property {'symptoms'|'moods'|'custom'} kind
 * @property {number} cyclesWith
 * @property {number} cyclesTotal
 * @property {number} typicalBefore  median days before the period it first shows
 */

/**
 * What she reliably gets in the days before her period, and how far ahead.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @returns {PremenstrualPattern[]} most consistent first
 */
export function premenstrualPatterns(logs, cycles) {
  const complete = cycles.filter((c) => c.complete && c.nextStart);
  if (complete.length < MIN_CYCLES_FOR_PATTERN) return [];

  /** @type {Map<string, {kind: PremenstrualPattern['kind'], onsets: number[]}>} */
  const found = new Map();

  /*
    How often each id shows up inside the window and outside it, as a share of
    logged days. The period itself is left out of both: it is neither "before
    the period" nor the quiet stretch the window is being compared with.
  */
  let windowDays = 0;
  let restDays = 0;
  /** @type {Map<string, {inWindow: number, inRest: number}>} */
  const share = new Map();
  for (const cycle of complete) {
    const next = /** @type {DateKey} */ (cycle.nextStart);
    for (let date = addDays(cycle.periodEnd, 1); date < next; date = addDays(date, 1)) {
      const log = logs[date];
      if (!log) continue;
      const inWindow = date >= addDays(next, -BEFORE_WINDOW);
      if (inWindow) windowDays += 1; else restDays += 1;
      for (const id of new Set([...log.symptoms, ...log.moods, ...log.custom])) {
        const entry = share.get(id) ?? { inWindow: 0, inRest: 0 };
        if (inWindow) entry.inWindow += 1; else entry.inRest += 1;
        share.set(id, entry);
      }
    }
  }
  /** @param {string} id */
  const concentrated = (id) => {
    if (restDays < MIN_REST_DAYS || !windowDays) return true;
    const entry = share.get(id) ?? { inWindow: 0, inRest: 0 };
    return entry.inWindow / windowDays >= CONCENTRATION * (entry.inRest / restDays);
  };

  for (const cycle of complete) {
    const next = /** @type {DateKey} */ (cycle.nextStart);
    /** First appearance in this cycle, as days before the next period. */
    /** @type {Map<string, {kind: PremenstrualPattern['kind'], before: number}>} */
    const firstSeen = new Map();

    for (let before = BEFORE_WINDOW; before >= 1; before -= 1) {
      const date = addDays(next, -before);
      // A short cycle can put the window inside the period itself, and
      // cramps during a period are not a premenstrual sign.
      if (date <= cycle.periodEnd) continue;
      const log = logs[date];
      if (!log) continue;

      /** @type {[PremenstrualPattern['kind'], string[]][]} */
      const groups = [['symptoms', log.symptoms], ['moods', log.moods], ['custom', log.custom]];
      for (const [kind, ids] of groups) {
        for (const id of ids ?? []) {
          if (id === 'none' || (kind === 'moods' && NOT_A_WARNING.has(id))) continue;
          if (!firstSeen.has(id)) firstSeen.set(id, { kind, before });
        }
      }
    }

    for (const [id, { kind, before }] of firstSeen) {
      const entry = found.get(id) ?? { kind, onsets: [] };
      entry.onsets.push(before);
      found.set(id, entry);
    }
  }

  /** @type {PremenstrualPattern[]} */
  const out = [];
  for (const [id, { kind, onsets }] of found) {
    if (onsets.length / complete.length < THRESHOLD) continue;
    if (!concentrated(id)) continue;
    const sorted = [...onsets].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const typicalBefore = sorted.length % 2
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    out.push({ id, kind, cyclesWith: onsets.length, cyclesTotal: complete.length, typicalBefore });
  }

  return out.sort((a, b) => b.cyclesWith - a.cyclesWith || b.typicalBefore - a.typicalBefore);
}

/**
 * The patterns to mention today, if any.
 *
 * Shown from a day before each one usually starts until the period arrives —
 * early enough to plan around, and quiet for the rest of the cycle. Nothing is
 * said when the forecast has nothing to count back from, or once the period
 * is due or late: by then she is not waiting for it, she is in it.
 *
 * @param {PremenstrualPattern[]} patterns
 * @param {import('./predict.js').Prediction} prediction
 * @returns {PremenstrualPattern[]}
 */
export function headsUpToday(patterns, prediction) {
  const until = prediction.daysUntilPeriod;
  if (until == null || until < 1 || prediction.isLate || prediction.withinWindow) return [];
  return patterns.filter((p) => until <= p.typicalBefore + 1);
}
