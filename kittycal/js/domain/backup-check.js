// @ts-check
/**
 * backup-check.js — what does this backup file actually hold?
 *
 * An export is the only copy of her data that survives losing the phone, and
 * until now the only way to find out whether a given file was any good was to
 * import it — which destroys the thing you were hedging against. That is a bad
 * trade to have to make, and it is the reason "I have backups" and "I have
 * working backups" are different sentences everywhere else too.
 *
 * So: parse a file, compare it against what is on the device, and say what it
 * holds, without touching anything. The comparison is the useful half. Knowing
 * a file has 412 logged days means little; knowing it is missing the last
 * eleven days you logged is a decision.
 *
 * Pure functions over plain data. No I/O, no DOM.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./model.js').DayLog} DayLog
 */

import { emptyLog } from './model.js';
import { toKey, todayKey, daysBetween } from '../utils/date.js';

/**
 * Fields compared when deciding whether two versions of a day differ.
 *
 * Everything in a DayLog except `updated`, which is a save timestamp: exporting
 * and re-importing the same day can move it without a single answer changing,
 * and reporting that as a difference would cry wolf on every file.
 */
const COMPARED = Object.keys(emptyLog('2026-01-01')).filter((k) => k !== 'updated');

/**
 * @typedef {Object} BackupCheck
 * @property {boolean} ok
 * @property {string} [error]        why it could not be read, if it could not
 * @property {'empty'|'match'|'behind'|'ahead'|'diverged'} state
 * @property {number} logCount       logged days in the file
 * @property {number} periodCount    period days in the file
 * @property {DateKey|null} firstDate  earliest logged or period day in the file
 * @property {DateKey|null} lastDate   latest
 * @property {number|null} ageDays   days since the file was exported
 * @property {number} onlyHere       days on this device the file does not have
 * @property {number} onlyInFile     days in the file this device does not have
 * @property {number} differ         days both have, answered differently
 */

/** A check result for a file that could not be read at all. */
const unreadable = (/** @type {string} */ error) => /** @type {BackupCheck} */ ({
  ok: false, error, state: 'empty', logCount: 0, periodCount: 0,
  firstDate: null, lastDate: null, ageDays: null,
  onlyHere: 0, onlyInFile: 0, differ: 0,
});

/**
 * Describe a parsed export against the data currently on the device.
 *
 * @param {import('../storage/backup.js').ImportResult} parsed
 * @param {{logs: Record<DateKey, DayLog>, periodDays: Set<DateKey>}} current
 * @param {DateKey} [today]
 * @returns {BackupCheck}
 */
export function describeBackup(parsed, current, today = todayKey()) {
  if (!parsed.ok) return unreadable(parsed.error ?? 'That file could not be read.');

  const logs = parsed.logs ?? {};
  const periodDays = parsed.periodDays ?? new Set();

  const dates = [...new Set([...Object.keys(logs), ...periodDays])].sort();
  const hereDates = new Set([...Object.keys(current.logs), ...current.periodDays]);

  /*
    Counted per calendar day, not per record.

    An earlier version counted logs and period days into the same total
    separately, so one day that was both — which is most bleeding days — was
    reported as two. A number on this screen is there to be reasoned about
    ("restoring would lose 3 days"), and one that runs to twice the truth on
    exactly the days that matter most is worse than no number.
  */
  let onlyHere = 0;
  let onlyInFile = 0;
  let differ = 0;

  for (const date of new Set([...hereDates, ...dates])) {
    const inHere = hereDates.has(date);
    const inFile = logs[date] != null || periodDays.has(date);

    if (inHere && !inFile) { onlyHere += 1; continue; }
    if (inFile && !inHere) { onlyInFile += 1; continue; }

    // Present in both. Period membership counts as much as the log does: it is
    // what every cycle length and every prediction is measured from.
    const here = current.logs[date];
    const there = logs[date];
    const logsDiffer = here && there ? !sameDay(here, there) : Boolean(here) !== Boolean(there);
    if (logsDiffer || current.periodDays.has(date) !== periodDays.has(date)) differ += 1;
  }

  return {
    ok: true,
    state: classify({ empty: dates.length === 0, onlyHere, onlyInFile, differ }),
    logCount: Object.keys(logs).length,
    periodCount: periodDays.size,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    ageDays: ageInDays(parsed.exportedAt, today),
    onlyHere,
    onlyInFile,
    differ,
  };
}

/**
 * @param {{empty: boolean, onlyHere: number, onlyInFile: number, differ: number}} counts
 * @returns {BackupCheck['state']}
 */
function classify({ empty, onlyHere, onlyInFile, differ }) {
  if (empty) return 'empty';
  if (!onlyHere && !onlyInFile && !differ) return 'match';
  if (differ) return 'diverged';
  // A plain older backup: everything in it is still here, and the device has
  // moved on since. That is the expected, healthy case, not a problem.
  if (onlyHere && !onlyInFile) return 'behind';
  if (onlyInFile && !onlyHere) return 'ahead';
  return 'diverged';
}

/**
 * Do two versions of a day say the same things?
 * @param {DayLog} a
 * @param {DayLog} b
 */
function sameDay(a, b) {
  for (const key of COMPARED) {
    const x = /** @type {any} */ (a)[key];
    const y = /** @type {any} */ (b)[key];
    if (Array.isArray(x) || Array.isArray(y)) {
      // Chip order is a record of the order she tapped things, not an answer.
      const ax = [...(x ?? [])].sort();
      const ay = [...(y ?? [])].sort();
      if (ax.length !== ay.length || ax.some((v, i) => v !== ay[i])) return false;
    } else if (x && typeof x === 'object') {
      if (JSON.stringify(sortKeys(x)) !== JSON.stringify(sortKeys(y ?? {}))) return false;
    } else if (x !== y) {
      return false;
    }
  }
  return true;
}

/** @param {Record<string, unknown>} obj */
function sortKeys(obj) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of Object.keys(obj).sort()) out[key] = obj[key];
  return out;
}

/**
 * How many days ago the file was written, from its own timestamp.
 *
 * Returns null rather than 0 when the timestamp is missing or nonsense: "made
 * today" is a claim, and a file that does not say when it was made has not made
 * it. Future timestamps are clamped to 0 — a phone whose clock was wrong once
 * should not produce "exported in 4 days".
 *
 * @param {unknown} exportedAt  ISO string from the file
 * @param {DateKey} today
 */
export function ageInDays(exportedAt, today) {
  if (typeof exportedAt !== 'string') return null;
  const when = new Date(exportedAt);
  if (Number.isNaN(when.getTime())) return null;
  return Math.max(0, daysBetween(toKey(when), today));
}
