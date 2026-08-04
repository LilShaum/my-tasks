// @ts-check
/**
 * install-health.js — whether to ask her to install the app, and why it matters.
 *
 * This is the one failure mode where the browser, not the user and not a bug,
 * deletes her data.
 *
 * Safari clears a site's script-writable storage — IndexedDB included — after
 * roughly a week without a visit. A web app added to the Home Screen is exempt.
 * On every other platform an app can opt out in code by calling
 * `navigator.storage.persist()`, and `storage/persist.js` does exactly that on
 * every launch. On iOS that method does not exist at all, so there is no code
 * path that protects her: installing is the only mitigation that works, and it
 * is a thing only she can do.
 *
 * iOS also gives a web app no way to offer it. There is no `beforeinstallprompt`
 * event and no API to trigger the sheet, so if the app does not explain Share →
 * Add to Home Screen in words, nothing else will. Settings has carried that
 * sentence since the beginning, which is no use: a new user has no reason to
 * open Settings, and nobody goes looking for a warning about something they
 * have not thought of.
 *
 * Three decisions shape when it appears:
 *
 *   1. **Only when the app genuinely cannot protect itself.** Already installed,
 *      or storage already persistent, and this stays silent forever. It is not
 *      an advert for installing; it is a warning that only applies when it is
 *      true.
 *
 *   2. **Not on the first day.** Straight after eight steps of setup is the
 *      worst moment to ask for a ninth. Waiting until there is data from more
 *      than one day also means she has come back once, which is the point at
 *      which the data is worth protecting.
 *
 *   3. **Dismissing snoozes, it does not silence.** The eviction clock is not
 *      affected by her tapping "not now", and a permanently dismissed warning
 *      about permanent data loss is worse than no warning at all.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./model.js').DayLog} DayLog
 * @typedef {import('./model.js').Settings} Settings
 */

import { daysBetween } from '../utils/date.js';

/**
 * Days carrying data before this is worth raising.
 *
 * Two, meaning she set the app up and came back to it at least once. One is
 * the day she finished onboarding, and asking then is asking during setup.
 */
export const MIN_DATA_DAYS = 2;

/** How long "not now" buys. Shorter than the backup nudge's month: the browser
 *  can act inside a fortnight, so a month of silence outlives the risk it is
 *  covering. */
export const SNOOZE_DAYS = 14;

/**
 * @typedef {Object} InstallNudge
 * @property {number} dataDays        distinct dates with anything recorded
 * @property {boolean} canRequest     whether the browser offers persist() at all
 */

/**
 * Whether to ask her to install, or null to stay quiet.
 *
 * `canRequest` is passed through rather than used here, because it changes the
 * wording and not the decision: a browser without `persist()` cannot protect
 * her however long she waits, while one that has it and has been refused might
 * still grant it later.
 *
 * @param {Object} input
 * @param {Record<DateKey, DayLog>} input.logs
 * @param {Set<DateKey>|DateKey[]} input.periodDays
 * @param {Settings} input.settings
 * @param {DateKey} input.today
 * @param {{installed: boolean, persisted: boolean, canRequest: boolean}} input.storage
 * @returns {InstallNudge|null}
 */
export function installNudge({ logs, periodDays, settings, today, storage }) {
  // Nothing to warn about. Both of these are checked live on every render, so
  // the card disappears by itself the moment she installs — there is no state
  // to write and nothing to go stale.
  if (storage.installed || storage.persisted) return null;

  const snoozed = settings.installSnoozed;
  if (snoozed && daysBetween(snoozed, today) < SNOOZE_DAYS) return null;

  const dates = new Set([...Object.keys(logs), ...periodDays]);
  if (dates.size < MIN_DATA_DAYS) return null;

  return { dataDays: dates.size, canRequest: storage.canRequest };
}
