// @ts-check
/**
 * backup-health.js — how much would be lost if the phone went in a river.
 *
 * Kittycal keeps everything on the device and nothing on a server. That is the
 * whole point of it, and it is also its one real failure mode: an exported
 * file is the only copy that survives losing, breaking or replacing the phone.
 * Settings says so, but nobody opens Settings to be told they should have done
 * something.
 *
 * So the app works out its own exposure and mentions it. Two decisions shape
 * how:
 *
 *   1. **The measure is unbacked-up data, not elapsed time.** "It has been 90
 *      days" is a nag whether or not anything happened in those 90 days. "42
 *      days of logs are not in any backup" is a statement about what she would
 *      actually lose, and it stays quiet for someone who has not logged
 *      anything since the last export.
 *
 *   2. **Dismissing it snoozes rather than silences.** The risk does not go
 *      away when the message does, and a permanently dismissed warning about
 *      permanent data loss is worse than no warning. It comes back after a
 *      month, by which point there is more at stake anyway.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./model.js').DayLog} DayLog
 * @typedef {import('./model.js').Settings} Settings
 */

import { daysBetween } from '../utils/date.js';

/**
 * How much unbacked-up data is worth mentioning.
 *
 * Two weeks of entries is roughly half a cycle — enough that losing it would
 * visibly degrade her predictions, which is the point at which this stops
 * being housekeeping.
 */
export const MIN_DAYS_AT_RISK = 14;

/** How long dismissing it buys. */
export const SNOOZE_DAYS = 30;

/**
 * @typedef {Object} BackupNudge
 * @property {number} daysAtRisk      distinct dates not in any backup
 * @property {boolean} neverBackedUp
 * @property {number|null} daysSinceBackup
 */

/**
 * Whether to mention backing up, and what to say. Null means stay quiet.
 *
 * @param {Object} input
 * @param {Record<DateKey, DayLog>} input.logs
 * @param {Set<DateKey>|DateKey[]} input.periodDays
 * @param {Settings} input.settings
 * @param {DateKey} input.today
 * @returns {BackupNudge|null}
 */
export function backupNudge({ logs, periodDays, settings, today }) {
  const { lastBackup, lastBackupAt, backupSnoozed } = settings;

  if (backupSnoozed && daysBetween(backupSnoozed, today) < SNOOZE_DAYS) {
    return null;
  }

  const atRisk = datesAtRisk({ logs, periodDays, lastBackup, lastBackupAt });
  if (atRisk < MIN_DAYS_AT_RISK) return null;

  return {
    daysAtRisk: atRisk,
    neverBackedUp: !lastBackup,
    daysSinceBackup: lastBackup ? daysBetween(lastBackup, today) : null,
  };
}

/**
 * Distinct dates whose data postdates the last export.
 *
 * The two stores need different comparisons, which is why this is not a
 * one-liner:
 *
 *   - A `DayLog` carries an `updated` timestamp, so it can be compared exactly
 *     against when the backup was taken. That matters because editing an old
 *     day puts it at risk even though its date is ancient.
 *   - `periodDays` is a bare set of dates with no timestamps at all, so the
 *     best available test is whether the date itself is newer than the backup.
 *     Someone who only ever marks period days — a perfectly reasonable way to
 *     use this app — would otherwise never be counted at all.
 *
 * Counted as a set, so a date that is both a period day and a logged day is
 * one day of exposure rather than two.
 *
 * @param {Object} input
 * @param {Record<DateKey, DayLog>} input.logs
 * @param {Set<DateKey>|DateKey[]} input.periodDays
 * @param {string} input.lastBackup
 * @param {number} input.lastBackupAt
 * @returns {number}
 */
function datesAtRisk({ logs, periodDays, lastBackup, lastBackupAt }) {
  /** @type {Set<string>} */
  const at = new Set();

  for (const [date, log] of Object.entries(logs)) {
    if (!lastBackupAt || (log.updated ?? 0) > lastBackupAt) at.add(date);
  }

  for (const date of periodDays) {
    if (!lastBackup || date > lastBackup) at.add(date);
  }

  return at.size;
}
