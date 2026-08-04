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

const MS_DAY = 86400000;

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Sunday-first; `firstDayOfWeek` in settings rotates these for display. */
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
  const d = fromKey(key);
  d.setDate(d.getDate() + days);
  return toKey(d);
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
  return Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / MS_DAY);
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
  const n = daysBetween(start, end);
  for (let i = 0; i <= n; i++) out.push(addDays(start, i));
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
