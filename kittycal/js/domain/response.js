// @ts-check
/**
 * response.js — what Kittycal says back after a check-in.
 *
 * The loop used to end with a restatement: "Logged today — medium, 2 entries."
 * She had just typed that. Fifteen seconds of her attention, every day, bought
 * her a receipt.
 *
 * So this looks for one thing she did *not* already know and says it in a
 * sentence. It is the only place in the app that speaks to the act of logging,
 * so it is bound tightly:
 *
 *   - Factual only. It reports what her own logs say and nothing else. No
 *     praise, no sympathy, no advice, no adjectives about how she feels.
 *   - Never a reaction to what was logged. A heavy day and a quiet day get the
 *     same voice — a mascot that looks sad at bad news is a mascot that teaches
 *     you to stop logging bad news.
 *   - Nothing already on the screen. The ring gives the cycle day and the
 *     countdown, the phase line names the phase; repeating those is noise.
 *   - Silence over filler. Most days there is nothing worth saying, and on
 *     those days it returns null and the app stays quiet.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./model.js').DayLog} DayLog
 * @typedef {import('./cycles.js').Cycle} Cycle
 */

import { symptomPattern, loggingStreak, loggedIds } from './stats.js';
import { labelOf } from '../data/taxonomy.js';
import { addDays, daysBetween } from '../utils/date.js';
import { plural, listJoin } from '../utils/fmt.js';

/** A symptom has to recur in at least this share of cycles to be worth naming. */
const PATTERN_SHARE = 0.6;

/** And there has to be at least this much history behind it. */
const MIN_CYCLES = 3;

/** Streak lengths worth remarking on. Sparse, so it stays an event. */
const STREAK_MARKS = new Set([7, 14, 30, 50, 100, 200, 365]);

/**
 * One sentence about what she just logged, or null.
 *
 * @param {Object} input
 * @param {DayLog} input.log        the day she just checked in
 * @param {Record<DateKey, DayLog>} input.logs
 * @param {Cycle[]} input.cycles
 * @param {DateKey} input.today
 * @returns {string|null}
 */
export function respondToCheckin({ log, logs, cycles, today }) {
  /*
    Ordered by how much it tells her, not by how easy it is to compute. The
    first one that has something to say wins, because two observations at once
    is a paragraph, and a paragraph after every check-in is something she will
    start dismissing without reading.
  */
  return matchedPattern(log, logs, cycles)
    ?? periodStarted(log, cycles)
    ?? approachingPatterns(cycles)
    ?? streakMark(logs, today)
    ?? null;
}

/**
 * Something she logged today recurs in most of her cycles, around now.
 *
 * This is the most valuable thing the app can tell anyone, and it is the whole
 * reason the check-in asks about symptoms every day. Saying it at the moment
 * she logs the symptom — rather than only on a chart she has to go and find —
 * is what turns the data into something she notices.
 *
 * @param {DayLog} log
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 */
function matchedPattern(log, logs, cycles) {
  const complete = cycles.filter((c) => c.complete);
  if (complete.length < MIN_CYCLES) return null;

  const current = cycles.at(-1);
  if (!current) return null;
  const dayInCycle = daysBetween(current.start, log.date) + 1;
  if (dayInCycle < 1) return null;

  /** @type {{id: string, cyclesWith: number, cyclesTotal: number, peakDays: number[]}|null} */
  let best = null;

  for (const id of loggedIds(log)) {
    const pattern = symptomPattern(id, logs, cycles);
    if (pattern.cyclesTotal < MIN_CYCLES) continue;
    if (pattern.cyclesWith / pattern.cyclesTotal < PATTERN_SHARE) continue;
    // Only worth saying if today is one of the days it usually lands on —
    // otherwise "you often get this" is true but says nothing about today.
    if (!pattern.peakDays.includes(dayInCycle)) continue;
    if (!best || pattern.cyclesWith > best.cyclesWith) best = { id, ...pattern };
  }

  if (!best) return null;

  // `labelOf` gives clean text with no emoji, and a custom symptom echoes its
  // own name back — so both drop into the sentence without special handling.
  const name = labelOf(best.id).toLowerCase();
  const days = listJoin(best.peakDays.map(String));
  return `You have logged ${name} in ${best.cyclesWith} of your last ` +
    `${best.cyclesTotal} cycles, most often on day ${days}.`;
}

/**
 * Today is the first day of a new cycle, so the one before it just closed.
 *
 * The full look-back already appears on Today as the recap card. This is the
 * one line of it worth having immediately, at the moment she marks the day
 * that ended the old cycle.
 *
 * @param {DayLog} log
 * @param {Cycle[]} cycles
 */
function periodStarted(log, cycles) {
  const current = cycles.at(-1);
  if (!current || current.start !== log.date) return null;

  const previous = cycles.at(-2);
  if (!previous?.length) return null;

  return `That closes your last cycle at ${plural(previous.length, 'day')}.`;
}

/**
 * She is close to having enough history for patterns to appear.
 *
 * The first weeks are the thin part of this app: the charts are empty and
 * pattern detection needs three complete cycles, so there is a long stretch
 * where daily logging buys her nothing visible. Saying how far off it is
 * turns that stretch from unrewarded into a countdown.
 *
 * @param {Cycle[]} cycles
 */
function approachingPatterns(cycles) {
  const complete = cycles.filter((c) => c.complete).length;
  if (complete >= MIN_CYCLES) return null;

  const left = MIN_CYCLES - complete;
  if (complete === 0) {
    return 'Once you have logged three cycles, Kittycal can start telling you ' +
      'what tends to happen and when.';
  }
  return `${plural(complete, 'cycle')} logged so far. ` +
    `${left === 1 ? 'One more' : `${left} more`} and Kittycal can start ` +
    'spotting what recurs.';
}

/**
 * A round number of consecutive days.
 *
 * Last in the order and deliberately sparse. A counter that congratulates you
 * daily is a nag, and it also makes breaking the run feel like a punishment —
 * which is exactly when someone stops opening an app.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {DateKey} today
 */
function streakMark(logs, today) {
  const streak = loggingStreak(logs, today, addDays);
  if (!STREAK_MARKS.has(streak)) return null;
  return `${plural(streak, 'day')} in a row.`;
}
