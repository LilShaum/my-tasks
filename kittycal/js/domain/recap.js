// @ts-check
/**
 * recap.js — the summary that arrives when a cycle closes.
 *
 * This is Flo's "monthly cycle report", which is a Premium feature there and
 * is arithmetic here. When a new period starts, the previous cycle is finally
 * a complete object — a known length, a known period length, a known set of
 * things logged inside it — and that is the one moment where a look back is
 * genuinely interesting rather than just more numbers on a screen.
 *
 * Three rules shaped this:
 *
 *   1. **It compares her to herself, never to a textbook.** "Two days longer
 *      than your usual" is useful. "Longer than average for women your age" is
 *      not, and is the kind of thing that makes people stop logging.
 *
 *   2. **It refuses to compare when it cannot.** With fewer than two earlier
 *      cycles behind it there is no "usual" yet, so the comparison fields come
 *      back null and the UI simply omits them rather than comparing against a
 *      guess.
 *
 *   3. **It is never alarming.** Anything unusual is described in plain
 *      numbers. The judgement of whether a 34-day cycle matters belongs to a
 *      doctor, and the existing ACOG cards already handle the prompt to ask
 *      one. A recap that greeted her with a warning would be a recap she
 *      learned to dismiss unread.
 *
 * Pure functions over plain data, so all of it is directly testable.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./model.js').DayLog} DayLog
 * @typedef {import('./cycles.js').Cycle} Cycle
 */

import { daysBetween, addDays } from '../utils/date.js';
import { CYCLE_LENGTH_FLOOR, CYCLE_LENGTH_CEIL } from './cycles.js';

/**
 * How long after a cycle closes the recap stays offered.
 *
 * A week: long enough that she sees it even if she does not open the app for
 * a few days, short enough that it is gone well before it becomes wallpaper.
 */
export const RECAP_WINDOW_DAYS = 7;

/** A comparison needs this many earlier cycles before "usual" means anything. */
const MIN_CYCLES_FOR_USUAL = 2;

/** Something has to recur this often within the cycle to be worth naming. */
const MIN_OCCURRENCES = 2;

/** At most this many things are named, so the card stays a glance. */
const MAX_NOTABLE = 3;

/**
 * The `DayLog` fields whose contents are occurrences worth counting.
 *
 * Kept as an explicit list, paired with its category, rather than reusing
 * `loggedIds`: a recap has to say which *kind* of thing recurred, because
 * "Very low on 2 days" is meaningless without knowing it was a mood, and the
 * flattened id list has thrown that away by the time it arrives.
 *
 * @type {{field: keyof import('./model.js').DayLog, category: string}[]}
 */
const OCCURRENCE_FIELDS = [
  { field: 'symptoms', category: 'symptoms' },
  { field: 'moods', category: 'moods' },
  { field: 'discharge', category: 'discharge' },
  { field: 'activity', category: 'activity' },
  { field: 'other', category: 'other' },
  { field: 'sex', category: 'sex' },
  { field: 'custom', category: 'custom' },
];

/**
 * @typedef {Object} NotableItem
 * @property {string} id       taxonomy id
 * @property {string} category which list it came from; drives the phrasing
 * @property {number} count    days it was logged in this cycle
 * @property {number[]} days   cycle days it landed on, ascending
 */

/**
 * @typedef {Object} Recap
 * @property {DateKey} cycleStart      identifies the recap; also the dismiss key
 * @property {DateKey} cycleEnd
 * @property {number} length           days
 * @property {number|null} usualLength her typical before this cycle
 * @property {number} periodLength     days
 * @property {number|null} usualPeriodLength
 * @property {number} daysLogged       days inside the cycle with any log
 * @property {NotableItem[]} notable
 */

/**
 * The recap for the cycle that just closed, or null if there isn't one to show.
 *
 * Returns null when: there is no completed cycle yet, the most recent one
 * closed more than a week ago (so the moment has passed), or its length is
 * implausible — a 200-day "cycle" is a logging gap, and recapping it as though
 * it were a real cycle would be worse than saying nothing.
 *
 * @param {Object} input
 * @param {Cycle[]} input.cycles
 * @param {Record<DateKey, DayLog>} input.logs
 * @param {DateKey} input.today
 * @returns {Recap|null}
 */
export function buildRecap({ cycles, logs, today }) {
  const completed = cycles.filter((c) => c.complete);
  if (!completed.length) return null;

  const cycle = completed[completed.length - 1];
  const length = /** @type {number} */ (cycle.length);

  if (length < CYCLE_LENGTH_FLOOR || length > CYCLE_LENGTH_CEIL) return null;

  // `nextStart` is day 1 of the new cycle, so that is the day it closed.
  const closedOn = /** @type {DateKey} */ (cycle.nextStart);
  const age = daysBetween(closedOn, today);
  if (age < 0 || age > RECAP_WINDOW_DAYS) return null;

  const earlier = completed.slice(0, -1);

  return {
    cycleStart: cycle.start,
    cycleEnd: addDays(closedOn, -1),
    length,
    usualLength: usual(
      earlier
        .map((c) => /** @type {number} */ (c.length))
        .filter((n) => n >= CYCLE_LENGTH_FLOOR && n <= CYCLE_LENGTH_CEIL),
    ),
    periodLength: cycle.periodLength,
    usualPeriodLength: usual(earlier.map((c) => c.periodLength)),
    daysLogged: countLoggedDays(logs, cycle.start, closedOn),
    notable: notableIn(logs, cycle.start, closedOn),
  };
}

/**
 * Her typical value, or null if there isn't enough history to have one.
 *
 * The median rather than the mean: one 44-day cycle after a stressful month
 * should not redefine what "usual" means for the eleven around it.
 *
 * @param {number[]} values
 * @returns {number|null}
 */
function usual(values) {
  if (values.length < MIN_CYCLES_FOR_USUAL) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(median);
}

/**
 * Days with any log at all, between `start` inclusive and `end` exclusive.
 *
 * `end` is day 1 of the *next* cycle and so is deliberately excluded — counting
 * it would attribute a day of the new cycle to the one being summarised.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {DateKey} start
 * @param {DateKey} end
 * @returns {number}
 */
function countLoggedDays(logs, start, end) {
  let count = 0;
  for (let d = start; d < end; d = addDays(d, 1)) {
    if (logs[d]) count++;
  }
  return count;
}

/**
 * What recurred inside the cycle, most frequent first.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {DateKey} start
 * @param {DateKey} end   exclusive; day 1 of the next cycle
 * @returns {NotableItem[]}
 */
function notableIn(logs, start, end) {
  /** @type {Map<string, {category: string, days: number[]}>} */
  const seen = new Map();

  for (let d = start, day = 1; d < end; d = addDays(d, 1), day++) {
    const log = logs[d];
    if (!log) continue;

    for (const { field, category } of OCCURRENCE_FIELDS) {
      const ids = /** @type {string[]} */ (log[field]);
      if (!Array.isArray(ids)) continue;

      for (const id of new Set(ids)) {
        // An absence is not an occurrence. Every category spells its own
        // ("No sex", "Didn't exercise"), and counting them would report that
        // she reliably did nothing.
        if (id === 'none') continue;

        // Keyed by category too, so a mood and a symptom that share an id stay
        // separate entries rather than being silently merged.
        const key = `${category}:${id}`;
        const entry = seen.get(key);
        if (entry) entry.days.push(day);
        else seen.set(key, { category, days: [day] });
      }
    }
  }

  return [...seen.entries()]
    .map(([key, { category, days }]) => ({
      id: key.slice(category.length + 1),
      category,
      count: days.length,
      days,
    }))
    .filter((item) => item.count >= MIN_OCCURRENCES)
    // Ties broken by id so the order is stable between renders rather than
    // depending on Map insertion order, which depends on logging order.
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, MAX_NOTABLE);
}

/**
 * Where in the cycle an item clustered, or null if it was scattered.
 *
 * "Cramps on days 1–2" is worth saying; "cramps on days 1, 9 and 22" is just
 * the raw data read aloud. So a span is only reported when the occurrences sit
 * within a few days of each other.
 *
 * @param {number[]} days ascending cycle days
 * @returns {{from: number, to: number}|null}
 */
export function cluster(days) {
  if (days.length < MIN_OCCURRENCES) return null;
  const from = days[0];
  const to = days[days.length - 1];
  return to - from <= 4 ? { from, to } : null;
}
