// @ts-check
/**
 * date.js — date-only arithmetic.
 *
 * Everything in Kittycal is a calendar day, never an instant. A period starts
 * on a date; it doesn't start at 14:32 UTC. So the canonical form is a
 * `DateKey` string, 'YYYY-MM-DD', always interpreted in the user's local
 * timezone.
 *
 * The rules that keep this correct:
 *   - Never `new Date('2026-07-27')`. That parses as UTC midnight, which is
 *     the previous day for anyone west of Greenwich.
 *   - Build keys from getFullYear/getMonth/getDate, never from toISOString().
 *   - Do day arithmetic by constructing a local Date at noon, so a DST jump
 *     of ±1h can never roll the date across a boundary.
 *
 * @typedef {string} DateKey  'YYYY-MM-DD' in local time
 */


export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Sunday-first; `firstDayOfWeek` in settings rotates these for display. */
export const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW_MIN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const pad = (n) => String(n).padStart(2, '0');

/**
 * Local calendar day of a Date as a DateKey.
 * @param {Date} d
 * @returns {DateKey}
 */
export function toKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parse a DateKey into a local Date at noon. Noon (not midnight) means a DST
 * shift of an hour in either direction leaves the calendar date untouched.
 * @param {DateKey} key
 * @returns {Date}
 */
export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/*
  Calendar arithmetic without Date objects.

  `addDays` and `daysBetween` are the most-called functions in the app — every
  cycle, phase, window and chart is built from them — and each call used to
  split the key, build one or two Dates at local noon, and format a new string.
  On a phone with three years of daily logs that put Today at about 360 ms to
  draw, with date parsing the largest share of the app's own time.

  A day number (days since 1970-01-01 on the proleptic Gregorian calendar,
  Howard Hinnant's days_from_civil) makes both plain integer arithmetic. It is
  also immune to time zones and daylight saving by construction rather than by
  the noon trick, because no clock time is ever involved.
*/

/** Parsed day numbers, by key. Keys repeat constantly and there are only a few
 *  thousand distinct ones in a lifetime of use, so this never grows large. */
const dayCache = new Map();

/**
 * @param {DateKey} key
 * @returns {number} days since 1970-01-01; NaN for a malformed key
 */
export function dayNumber(key) {
  const hit = dayCache.get(key);
  if (hit !== undefined) return hit;

  let y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const d = Number(key.slice(8, 10));
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * ((m + 9) % 12) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const n = era * 146097 + doe - 719468;

  if (dayCache.size < 20000) dayCache.set(key, n);
  return n;
}

/**
 * The inverse of `dayNumber`.
 * @param {number} n days since 1970-01-01
 * @returns {DateKey}
 */
export function keyOfDay(n) {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524)
    - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return makeKey(yoe + era * 400 + (m <= 2 ? 1 : 0), m - 1, d);
}

/** @returns {DateKey} today, local */
export function todayKey() {
  return toKey(new Date());
}

/**
 * @param {number} y
 * @param {number} m 0-indexed month
 * @param {number} d
 * @returns {DateKey}
 */
export function makeKey(y, m, d) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

/**
 * Shift a DateKey by whole days.
 * @param {DateKey} key
 * @param {number} days may be negative
 * @returns {DateKey}
 */
export function addDays(key, days) {
  return keyOfDay(dayNumber(key) + days);
}

/**
 * Whole days from `a` to `b`. Positive when `b` is later.
 * Both are normalised to local noon first, so the division is exact and
 * immune to DST.
 * @param {DateKey} a
 * @param {DateKey} b
 * @returns {number}
 */
export function daysBetween(a, b) {
  return dayNumber(b) - dayNumber(a);
}

/**
 * @param {DateKey} key
 * @param {DateKey} start inclusive
 * @param {DateKey} end inclusive
 */
export const isBetween = (key, start, end) => key >= start && key <= end;

/** Inclusive list of keys from `start` to `end`. Empty if end precedes start.
 * @param {DateKey} start @param {DateKey} end @returns {DateKey[]} */
export function range(start, end) {
  /** @type {DateKey[]} */
  const out = [];
  const first = dayNumber(start);
  const last = dayNumber(end);
  for (let day = first; day <= last; day++) out.push(keyOfDay(day));
  return out;
}

/** Day of week, 0 = Sunday. @param {DateKey} key */
export const dow = (key) => fromKey(key).getDay();

/** @param {number} y @param {number} m 0-indexed @returns {number} */
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

/** @param {DateKey} key */
export const year = (key) => Number(key.slice(0, 4));
/** @param {DateKey} key @returns {number} 0-indexed month */
export const month = (key) => Number(key.slice(5, 7)) - 1;
/** @param {DateKey} key */
export const dayOfMonth = (key) => Number(key.slice(8, 10));

/* ── Display formatting ─────────────────────────────────────────────────── */

/** 'Mon 27 Jul' @param {DateKey} key */
function fmtShort(key) {
  const d = fromKey(key);
  return `${DOW_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** '27 July 2026' @param {DateKey} key */
export function fmtLong(key) {
  const d = fromKey(key);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** '27 Jul' @param {DateKey} key */
export function fmtDayMonth(key) {
  const d = fromKey(key);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/**
 * 'Jul' — the month alone, for a chart axis.
 *
 * No year: a year of cycles is at most thirteen points, so the months never
 * repeat, and the extra two digits under every dot would cost more room than
 * they buy.
 *
 * @param {DateKey} key
 */
export function fmtMonth(key) {
  return MONTHS_SHORT[fromKey(key).getMonth()];
}

/** 'July 2026' @param {number} y @param {number} m 0-indexed */
export const fmtMonthYear = (y, m) => `${MONTHS[m]} ${y}`;

/**
 * Human relative day: 'Today', 'Yesterday', 'Tomorrow', else a short date.
 * @param {DateKey} key
 */
export function fmtRelative(key) {
  const diff = daysBetween(todayKey(), key);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return fmtShort(key);
}

/**
 * 'in 5 days' / '3 days ago' / 'today'. Used for countdowns, so it stays
 * plain — no cute phrasing in anything that carries a number.
 * @param {number} days
 */
export function fmtDayCount(days) {
  if (days === 0) return 'today';
  const n = Math.abs(days);
  const unit = n === 1 ? 'day' : 'days';
  return days > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

/**
 * Rotate the weekday header row for a Monday-first (or any) week start.
 * @param {string[]} labels
 * @param {number} firstDay 0 = Sunday
 */
export function rotateDow(labels, firstDay) {
  return labels.slice(firstDay).concat(labels.slice(0, firstDay));
}

/**
 * Which grid column (0-6) a date falls in, given the week start.
 * @param {DateKey} key
 * @param {number} firstDay 0 = Sunday
 */
export function gridColumn(key, firstDay) {
  return (dow(key) - firstDay + 7) % 7;
}
