// @ts-check
/**
 * pill.js — where she is in the pack.
 *
 * `pillTaken` was a boolean and a daily nudge, which is a tick box with no
 * memory: it could tell her to take one today and had no idea whether today
 * was an active pill or the fourth day of a break, nor whether yesterday ever
 * got marked. The one moment a pill tracker earns its place is the moment
 * she cannot remember about yesterday, and that was the moment it had nothing
 * to say.
 *
 * **What this deliberately does not do.** It never says "you missed a pill",
 * and it never says what to do about one. Two different reasons:
 *
 *   - An unmarked day is a fact about the *record*, not about her body. She
 *     may well have taken it and not opened the app. The app already draws
 *     this distinction everywhere else — `checkedIn` exists precisely so that
 *     "she said nothing happened" and "she never answered" stay different
 *     things — and it would be a poor place to abandon it, because the wrong
 *     version frightens someone about a pill she actually took.
 *
 *   - What to do after a genuinely missed pill depends on which pill, how
 *     late, and where in the pack — it is the leaflet's job and the
 *     pharmacist's, and Kittycal is "not contraception and not medical
 *     advice" in its own README. Stating the days and pointing at the leaflet
 *     is the honest end of what a calendar can offer.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./model.js').Settings} Settings
 * @typedef {import('./model.js').DayLog} DayLog
 */

import { daysBetween, addDays } from '../utils/date.js';

/**
 * The regimens worth naming.
 *
 * Not an exhaustive list of every product — that is a database that would go
 * stale, and the packs differ by brand within each of these anyway. These are
 * the shapes, and "something else" carries the rest by letting her state the
 * two numbers herself.
 */
export const REGIMENS = [
  { id: 'none', label: 'Not tracking a pack', active: 0, brk: 0 },
  { id: '21-7', label: '21 pills, then 7 days off', active: 21, brk: 7 },
  { id: '24-4', label: '24 pills, then 4 days off', active: 24, brk: 4 },
  { id: '28-0', label: 'Every day, no break', active: 28, brk: 0 },
  { id: '63-7', label: '63 pills, then 7 days off', active: 63, brk: 7 },
];

/** @param {string} id */
export function regimen(id) {
  return REGIMENS.find((r) => r.id === id) ?? REGIMENS[0];
}

/**
 * @typedef {Object} PackPosition
 * @property {number} day        1-based day within the pack
 * @property {number} total      pack length including any break
 * @property {number} activeDays pills in the pack
 * @property {number} breakDays  days off after them
 * @property {number} pack       1-based pack number since she started
 * @property {boolean} active    an active pill day rather than a break day
 * @property {number} left       active days remaining, including today
 * @property {DateKey} packStart first day of the pack today falls in
 */

/**
 * Where a date falls in the pack, or null when there is nothing to say.
 *
 * Null rather than a guess whenever the regimen is off, the start date is
 * missing, or the date is before she started — the same rule the rest of the
 * app follows about not describing a cycle that has not begun.
 *
 * @param {Settings} settings
 * @param {DateKey} date
 * @returns {PackPosition|null}
 */
export function packPosition(settings, date) {
  const shape = regimen(settings.pillRegimen);
  const total = shape.active + shape.brk;
  if (!total || !settings.pillPackStart) return null;

  const elapsed = daysBetween(settings.pillPackStart, date);
  if (elapsed < 0) return null;

  const within = elapsed % total;
  const active = within < shape.active;

  return {
    day: within + 1,
    total,
    activeDays: shape.active,
    breakDays: shape.brk,
    pack: Math.floor(elapsed / total) + 1,
    active,
    left: active ? shape.active - within : 0,
    packStart: addDays(date, -within),
  };
}

/**
 * Active pill days in the recent past with nothing marked on them.
 *
 * "Unmarked", never "missed" — see the note at the top of this file. Today is
 * excluded: a day still in progress is not a day she failed to record.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Settings} settings
 * @param {DateKey} today
 * @param {number} [lookback] days back to consider
 * @returns {DateKey[]} oldest first
 */
export function unmarkedDays(logs, settings, today, lookback = 7) {
  if (regimen(settings.pillRegimen).id === 'none' || !settings.pillPackStart) return [];

  /** @type {DateKey[]} */
  const out = [];
  for (let back = lookback; back >= 1; back -= 1) {
    const date = addDays(today, -back);
    if (date < settings.pillPackStart) continue;

    const position = packPosition(settings, date);
    if (!position?.active) continue;
    if (logs[date]?.pillTaken) continue;
    out.push(date);
  }
  return out;
}

/**
 * A sentence for the pack row, or null when there is no pack.
 * @param {PackPosition|null} position
 * @returns {string|null}
 */
export function describePack(position) {
  if (!position) return null;
  return position.active
    ? `Pill ${position.day} of ${position.activeDays}`
    : `Break day ${position.day - position.activeDays} of ${position.breakDays}`;
}
