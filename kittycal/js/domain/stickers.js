// @ts-check
/**
 * stickers.js — the collection she builds up by using the app.
 *
 * Every other reward in Kittycal is a sentence that appears once and is gone.
 * This is the one thing that accumulates, and the rules it is built to are as
 * much about what it must never do as what it does:
 *
 *   - **It never subtracts.** Nothing here can be lost, expire, or grey back
 *     out. A streak counter is the standard shape for this and it is the wrong
 *     one: it resets to zero the first time she misses a day, which turns one
 *     bad Tuesday into the app telling her she failed. That is a documented way
 *     to lose someone. Every sticker, once earned, is earned.
 *   - **It rewards the act, never the outcome.** There is no sticker for a
 *     light period, a short cycle, or a month without cramps. Rewarding those
 *     would make the bad months feel like failures and teach her to stop
 *     logging them, which is the one thing that would actually break the app.
 *   - **It is derived, not stored.** Like `periodDays`, nothing about stickers
 *     lives on disk. That is not tidiness: it means backfilling last March
 *     retroactively earns whatever it should have, an export/import restores
 *     the whole collection for free, and there is no separate state that can
 *     drift out of step with the logs.
 *
 * Each sticker borrows one theme's motif, so the full set is the whole cast —
 * and because each renders in that theme's palette, the finished book is
 * fourteen different colours rather than fourteen of the current one.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./model.js').DayLog} DayLog
 * @typedef {import('./model.js').Settings} Settings
 * @typedef {import('./cycles.js').Cycle} Cycle
 */

/**
 * @typedef {Object} StickerContext
 * @property {Record<DateKey, DayLog>} logs
 * @property {Cycle[]} cycles
 * @property {Settings} settings
 */

/**
 * @typedef {Object} Sticker
 * @property {string} id
 * @property {string} emblem       theme id whose motif this sticker wears
 * @property {string} title
 * @property {string} requirement  what earns it, in plain words
 * @property {DateKey|null} on     the day it was earned, or null
 */

/**
 * Every date with a log, oldest first.
 * @param {Record<DateKey, DayLog>} logs
 */
const loggedDates = (logs) => Object.keys(logs).sort();

/**
 * The nth logged day, or null if she has not got there yet.
 *
 * This is what makes a count-based sticker carry a real date rather than
 * "whenever you happened to open Settings": the thirtieth day she logged is a
 * specific day, and it stays that day even if she logs another hundred.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {number} n
 * @returns {DateKey|null}
 */
function nthLoggedDay(logs, n) {
  const dates = loggedDates(logs);
  return dates.length >= n ? dates[n - 1] : null;
}

/**
 * The nth day whose log satisfies `pred`, oldest first.
 * @param {Record<DateKey, DayLog>} logs
 * @param {(log: DayLog) => boolean} pred
 * @param {number} [n]
 * @returns {DateKey|null}
 */
function nthDayWhere(logs, pred, n = 1) {
  let found = 0;
  for (const date of loggedDates(logs)) {
    if (!pred(logs[date])) continue;
    found += 1;
    if (found === n) return date;
  }
  return null;
}

/**
 * The day the nth cycle completed — which is the day the *next* period began,
 * because that is the moment its length became knowable.
 * @param {Cycle[]} cycles
 * @param {number} n
 * @returns {DateKey|null}
 */
function nthCycleClosed(cycles, n) {
  const complete = cycles.filter((c) => c.complete);
  return complete.length >= n ? complete[n - 1].nextStart : null;
}

/**
 * The set, in the order she will earn it.
 *
 * Ordering is the whole design here. The first four are reachable inside a
 * month, because a collection with nothing in it for eight weeks is not a
 * collection. The middle ones need cycles, which is time she cannot rush. The
 * last few are things the app can do that she may not have found — the book
 * doubles as the only place that says "you can write a note on a day" without
 * it being a nag on a screen she reads daily.
 *
 * @type {{id: string, emblem: string, title: string, requirement: string,
 *         earnedOn: (ctx: StickerContext) => DateKey|null}[]}
 */
const DEFINITIONS = [
  {
    id: 'first-day',
    emblem: 'hellokitty',
    title: 'Day one',
    requirement: 'Log your first day',
    earnedOn: ({ logs }) => nthLoggedDay(logs, 1),
  },
  {
    id: 'first-week',
    emblem: 'mymelody',
    title: 'A week of it',
    requirement: 'Log seven days',
    earnedOn: ({ logs }) => nthLoggedDay(logs, 7),
  },
  {
    id: 'first-period',
    emblem: 'pochacco',
    title: 'First period marked',
    requirement: 'Record a period',
    earnedOn: ({ cycles }) => cycles[0]?.start ?? null,
  },
  {
    id: 'first-month',
    emblem: 'cinnamoroll',
    title: 'A month of it',
    requirement: 'Log thirty days',
    earnedOn: ({ logs }) => nthLoggedDay(logs, 30),
  },
  {
    id: 'own-words',
    emblem: 'hangyodon',
    title: 'In your own words',
    requirement: 'Write a note on any day',
    earnedOn: ({ logs }) => nthDayWhere(logs, (l) => Boolean(l.notes.trim())),
  },
  {
    id: 'first-cycle',
    emblem: 'keroppi',
    title: 'A cycle, start to finish',
    requirement: 'Log one complete cycle',
    earnedOn: ({ cycles }) => nthCycleClosed(cycles, 1),
  },
  {
    id: 'named-it',
    emblem: 'aggretsuko',
    title: 'Named it yourself',
    requirement: 'Add a symptom that is not in the list',
    earnedOn: ({ logs }) => nthDayWhere(logs, (l) => l.custom.length > 0),
  },
  {
    id: 'how-bad',
    emblem: 'gudetama',
    title: 'How bad it was',
    requirement: 'Say how bad a symptom was',
    earnedOn: ({ logs }) =>
      nthDayWhere(logs, (l) => Object.keys(l.severity).length > 0),
  },
  {
    id: 'by-the-numbers',
    emblem: 'plain',
    title: 'By the numbers',
    requirement: 'Record a temperature, a weight or a night of sleep',
    earnedOn: ({ logs }) => nthDayWhere(logs,
      (l) => l.bbt != null || l.weight != null || l.sleep != null),
  },
  {
    id: 'patterns',
    emblem: 'pompompurin',
    title: 'Patterns unlocked',
    requirement: 'Log three complete cycles, so Kittycal can spot what recurs',
    earnedOn: ({ cycles }) => nthCycleClosed(cycles, 3),
  },
  {
    id: 'ten-notes',
    emblem: 'badtzmaru',
    title: 'Ten notes deep',
    requirement: 'Write notes on ten different days',
    earnedOn: ({ logs }) => nthDayWhere(logs, (l) => Boolean(l.notes.trim()), 10),
  },
  {
    id: 'hundred-days',
    emblem: 'twinstars',
    title: 'A hundred days',
    requirement: 'Log a hundred days',
    earnedOn: ({ logs }) => nthLoggedDay(logs, 100),
  },
  {
    id: 'six-cycles',
    emblem: 'chococat',
    title: 'Six cycles in',
    requirement: 'Log six complete cycles',
    earnedOn: ({ cycles }) => nthCycleClosed(cycles, 6),
  },
  {
    id: 'a-year',
    emblem: 'kuromi',
    title: 'A year of it',
    requirement: 'Log three hundred and sixty-five days',
    earnedOn: ({ logs }) => nthLoggedDay(logs, 365),
  },
];

/** How many there are to find, without exposing the definitions themselves. */
export const STICKER_COUNT = DEFINITIONS.length;

/**
 * The whole book: every sticker, with the day it was earned or null.
 *
 * Returns all fourteen rather than only the earned ones, deliberately. A
 * sticker book with the empty slots printed in it is the thing she is filling;
 * a list that only grows is a log. The empty ones carry what earns them,
 * because she has never used a period tracker before and this is the one place
 * the app can say "you can name your own symptom" without it being a nag on a
 * screen she reads every day.
 *
 * @param {StickerContext} ctx
 * @returns {Sticker[]}
 */
export function stickerBook(ctx) {
  return DEFINITIONS.map(({ id, emblem, title, requirement, earnedOn }) => ({
    id, emblem, title, requirement, on: earnedOn(ctx),
  }));
}

/**
 * Just the ids she has earned, for cheaply comparing two moments.
 * @param {StickerContext} ctx
 * @returns {Set<string>}
 */
export function earnedIds(ctx) {
  const out = new Set();
  for (const def of DEFINITIONS) if (def.earnedOn(ctx)) out.add(def.id);
  return out;
}

/**
 * What she earned between two moments — one sticker at most.
 *
 * A single check-in can cross two thresholds at once: the day a cycle closes
 * can also be her thirtieth day, and announcing both turns a small moment into
 * a list.
 *
 * The earliest one in the book wins. The set is ordered by roughly when she
 * will reach each slot, so the earliest is the one that has been sitting empty
 * in front of her the longest — which is the one worth telling her about,
 * rather than whichever incidental thing she also happened to do that day.
 *
 * @param {Set<string>} before
 * @param {StickerContext} after
 * @returns {Sticker|null}
 */
export function newlyEarned(before, after) {
  return stickerBook(after).find((s) => s.on && !before.has(s.id)) ?? null;
}
