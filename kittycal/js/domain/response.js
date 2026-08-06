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

/**
 * Streak lengths worth remarking on. Sparse, so it stays an event.
 *
 * Exported because the check-in's mascot uses the same list to decide when to
 * play its bigger beat. Two lists would drift, and the day the animation and
 * the sentence disagree about what counts as a milestone is the day both look
 * arbitrary.
 */
export const STREAK_MARKS = new Set([7, 14, 30, 50, 100, 200, 365]);

/** How far either side of the same cycle day counts as "around this day". */
const ECHO_WINDOW = 2;

/**
 * How many days of history before a first-ever symptom is worth remarking on.
 *
 * In week one everything is a first, so saying so is just narrating the chip
 * list back at her. After a handful of days the set she reaches for has
 * settled, and something outside it is genuinely new.
 */
const MIN_DAYS_BEFORE_FIRSTS = 5;

/** Consecutive days of the same symptom worth remarking on. */
const RUN_MARKS = new Set([3, 5, 7, 10, 14]);

/** Small counts read better as words in the middle of a sentence. */
const WORDS = ['', 'One', 'Two', 'Three'];

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

    The first three months are the ones that decide whether she keeps going, and
    for a long time this list was mute across exactly that stretch: pattern
    matching needs three complete cycles, the cycle-close line needs two, and a
    seven-day streak was the earliest thing that could fire. Everything she
    logged before then bought her a countdown to a feature.

    So the middle of the chain is observations that only need her own recent
    days: a symptom that showed up at this point last cycle, something she has
    never recorded before, a run of the same thing several days deep. None of
    them are patterns and none of them claim to be — they are small, true, and
    available from about the first week.
  */
  return matchedPattern(log, logs, cycles)
    ?? periodStarted(log, cycles)
    ?? echoOfLastCycle(log, logs, cycles)
    ?? firstEverLogged(log, logs)
    ?? symptomRun(log, logs)
    ?? streakMark(logs, today)
    ?? whatLoggingIsFor(log, logs)
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

  const closed = `That closes your last cycle at ${plural(previous.length, 'day')}.`;

  /*
    While the history is still thin, the countdown to pattern detection gets
    attached here rather than living on its own.

    It used to be its own entry in the chain, which meant it fired on every
    single check-in until the third cycle closed — the same sentence, every
    day, for two months. A line she has read thirty times is wallpaper, and
    wallpaper is what she learns to skip past, including on the day it finally
    says something else.

    The number it reports only changes when a cycle closes, which is exactly
    this moment, so this is the one time saying it is news.
  */
  const complete = cycles.filter((c) => c.complete).length;
  if (complete >= MIN_CYCLES) return closed;

  const left = MIN_CYCLES - complete;
  return `${closed} ${WORDS[left] ?? left} more and Kittycal can start `
    + 'spotting what recurs.';
}

/**
 * She logged something today that she also logged around now last cycle.
 *
 * Not a pattern — two occurrences never are, and the wording is careful not to
 * imply otherwise. It is the smallest true observation the app can make, and
 * unlike everything above it, it is available in month two.
 *
 * @param {DayLog} log
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 */
function echoOfLastCycle(log, logs, cycles) {
  const current = cycles.at(-1);
  const previous = cycles.at(-2);
  if (!current || !previous?.complete) return null;

  const day = daysBetween(current.start, log.date) + 1;
  if (day < 1) return null;

  for (const id of loggedIds(log)) {
    for (let offset = -ECHO_WINDOW; offset <= ECHO_WINDOW; offset += 1) {
      const date = addDays(previous.start, day - 1 + offset);
      // The window must not spill into the cycle either side of it, or "last
      // cycle" would quietly mean "the one before that".
      if (date < previous.start || date >= /** @type {string} */ (previous.nextStart)) continue;
      if (!logs[date] || !loggedIds(logs[date]).includes(id)) continue;
      return `You logged ${labelOf(id).toLowerCase()} around this day last cycle too.`;
    }
  }
  return null;
}

/**
 * Something on today's log has never appeared on any earlier day.
 *
 * Worth saying because it is the app demonstrating that it reads what she
 * types — and because a symptom's first appearance is the one the doctor asks
 * about later. Only when exactly one thing is new: a check-in with four
 * first-timers in it is her working through the chip list, not an event.
 *
 * @param {DayLog} log
 * @param {Record<DateKey, DayLog>} logs
 */
function firstEverLogged(log, logs) {
  const earlier = Object.entries(logs).filter(([date]) => date < log.date);
  if (earlier.length < MIN_DAYS_BEFORE_FIRSTS) return null;

  const seen = new Set(earlier.flatMap(([, day]) => loggedIds(day)));
  const fresh = loggedIds(log).filter((id) => !seen.has(id));
  if (fresh.length !== 1) return null;

  return `First time you have logged ${labelOf(fresh[0]).toLowerCase()}.`;
}

/**
 * The same thing, several days running.
 *
 * A run is the one shape she cannot see on any screen — the calendar shows a
 * day at a time and the charts need cycles behind them — while being the exact
 * thing worth mentioning to a doctor. Marked at a few lengths rather than every
 * day, so a fortnight of headaches does not produce a fortnight of sentences.
 *
 * @param {DayLog} log
 * @param {Record<DateKey, DayLog>} logs
 */
function symptomRun(log, logs) {
  /** @type {{id: string, run: number}|null} */
  let best = null;

  for (const id of loggedIds(log)) {
    // Counted from `log` rather than from `logs[log.date]`, because the caller
    // may hand over the day she just saved before the store has it.
    let run = 1;
    for (let cursor = addDays(log.date, -1);
      logs[cursor] && loggedIds(logs[cursor]).includes(id);
      cursor = addDays(cursor, -1)) run += 1;

    if (!RUN_MARKS.has(run)) continue;
    if (!best || run > best.run) best = { id, run };
  }

  if (!best) return null;
  return `That is ${plural(best.run, 'day')} in a row with `
    + `${labelOf(best.id).toLowerCase()}.`;
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

/**
 * The very first check-in, and only that one.
 *
 * Nothing above this can fire on day one — every one of them reads history and
 * there is none — so without this the first thing she ever logs gets silence
 * back. This is the only sentence in the file that is about the app rather
 * than about her data, which is why it is last and why it is said once.
 *
 * @param {DayLog} log
 * @param {Record<DateKey, DayLog>} logs
 */
function whatLoggingIsFor(log, logs) {
  if (Object.keys(logs).some((date) => date < log.date)) return null;
  return 'Once you have logged three cycles, Kittycal can start telling you '
    + 'what tends to happen and when.';
}
