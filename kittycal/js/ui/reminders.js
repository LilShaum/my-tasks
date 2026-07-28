// @ts-check
/**
 * reminders.js — period, pill and logging nudges.
 *
 * An honest note about what this can and cannot do.
 *
 * Flo's reminders arrive because Flo runs a server that sends push messages to
 * your phone. Kittycal has no server — that is the entire point of it — so it
 * cannot wake your phone up while it's closed. What it can do is check for due
 * reminders whenever the app is opened or brought back to the foreground, and
 * fire them then.
 *
 * In practice that means: open the app any time on the day a reminder is due
 * and you get it. Never open the app and you never get it. The settings screen
 * says exactly this rather than implying background delivery that will not
 * happen.
 *
 * Each reminder fires at most once per day, tracked by date key, so a reminder
 * doesn't repeat every time the app is foregrounded.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 */

import { todayKey, daysBetween, addDays, fmtDayMonth } from '../utils/date.js';
import { plural } from '../utils/fmt.js';
import * as db from '../storage/db.js';

const META_REMINDERS = 'reminders';
const META_FIRED = 'remindersFired';

/**
 * @typedef {Object} ReminderSettings
 * @property {boolean} periodSoon
 * @property {number} periodSoonDays   how many days ahead
 * @property {boolean} periodLate
 * @property {boolean} fertile
 * @property {boolean} pill
 * @property {boolean} logDaily
 */

/** @returns {ReminderSettings} */
export function defaultReminders() {
  return {
    periodSoon: false,
    periodSoonDays: 2,
    periodLate: false,
    fertile: false,
    pill: false,
    logDaily: false,
  };
}

/** @returns {Promise<ReminderSettings>} */
export async function loadReminders() {
  const stored = await db.getMeta(META_REMINDERS, null);
  return { ...defaultReminders(), ...(stored && typeof stored === 'object' ? stored : {}) };
}

/** @param {Partial<ReminderSettings>} patch */
export async function saveReminders(patch) {
  const current = await loadReminders();
  const next = { ...current, ...patch };
  await db.setMeta(META_REMINDERS, next);
  return next;
}

/** Which reminders have already fired, keyed `id:date`. */
async function loadFired() {
  const stored = await db.getMeta(META_FIRED, null);
  return Array.isArray(stored) ? new Set(stored) : new Set();
}

/** @param {Set<string>} fired */
async function saveFired(fired) {
  // Keep the last 60 entries; older ones can never match again.
  await db.setMeta(META_FIRED, [...fired].slice(-60));
}

/* ── Permission ─────────────────────────────────────────────────────────── */

export function notificationsSupported() {
  return typeof Notification !== 'undefined';
}

/** @returns {NotificationPermission|'unsupported'} */
export function permissionState() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/** @returns {Promise<boolean>} */
export async function requestPermission() {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/* ── Firing ─────────────────────────────────────────────────────────────── */

/**
 * @param {string} title
 * @param {string} body
 */
async function notify(title, body) {
  if (permissionState() !== 'granted') return;

  // Prefer the service worker: notifications shown through it survive the page
  // being closed and behave correctly when the PWA is installed.
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, {
        body,
        icon: 'assets/icons/icon-192.png',
        badge: 'assets/icons/icon-192.png',
        tag: 'kittycal',
        silent: false,
      });
      return;
    }
  } catch {
    /* fall through to a page notification */
  }

  try {
    new Notification(title, { body, icon: 'assets/icons/icon-192.png' });
  } catch {
    /* the browser refused; nothing more to do */
  }
}

/**
 * Work out which reminders are due today and fire them.
 *
 * Called at boot and whenever the app returns to the foreground.
 *
 * @param {Object} input
 * @param {import('../domain/predict.js').Prediction} input.prediction
 * @param {boolean} input.loggedToday
 * @param {string} input.birthControl
 */
export async function checkReminders({ prediction, loggedToday, birthControl }) {
  if (permissionState() !== 'granted') return [];

  const settings = await loadReminders();
  const fired = await loadFired();
  const today = todayKey();

  /** @type {{id: string, title: string, body: string}[]} */
  const due = [];

  // Period expected in N days.
  if (settings.periodSoon && prediction.nextStart && !prediction.isLate) {
    const away = daysBetween(today, prediction.nextStart);
    if (away >= 0 && away <= settings.periodSoonDays) {
      due.push({
        id: 'period-soon',
        title: away === 0 ? 'Your period is expected today' : `Period expected ${away === 1 ? 'tomorrow' : `in ${away} days`}`,
        body: away === 0
          ? `Around ${fmtDayMonth(prediction.nextStart)}, based on your last few cycles.`
          : `Around ${fmtDayMonth(prediction.nextStart)}. Worth having what you need to hand.`,
      });
    }
  }

  // Late.
  if (settings.periodLate && prediction.isLate && prediction.daysLate != null) {
    due.push({
      id: 'period-late',
      title: `Your period is ${plural(prediction.daysLate, 'day')} late`,
      body: 'Cycles shift for all sorts of ordinary reasons. Log it when it starts and Kittycal will recalculate.',
    });
  }

  // Fertile window opening — only when fertility output is shown at all.
  if (settings.fertile && prediction.showFertility && prediction.fertileWindow) {
    if (today === prediction.fertileWindow.start) {
      due.push({
        id: 'fertile',
        title: 'Your fertile window starts today',
        body: prediction.ovulation
          ? `Ovulation estimated around ${fmtDayMonth(prediction.ovulation)}.`
          : 'Based on your recent cycles.',
      });
    }
  }

  // Daily pill.
  if (settings.pill && birthControl !== 'none') {
    due.push({
      id: 'pill',
      title: 'Birth control reminder',
      body: 'Tap to mark today as taken.',
    });
  }

  // Gentle logging nudge. Rewards logging; never mentions a broken streak.
  if (settings.logDaily && !loggedToday) {
    due.push({
      id: 'log-daily',
      title: 'Anything to log today?',
      body: 'Flow, symptoms, mood — whatever you feel like recording.',
    });
  }

  /** @type {string[]} */
  const sent = [];
  for (const reminder of due) {
    const key = `${reminder.id}:${today}`;
    if (fired.has(key)) continue;
    fired.add(key);
    sent.push(reminder.id);
    await notify(reminder.title, reminder.body);
  }

  if (sent.length) await saveFired(fired);
  return sent;
}

/** Clear the fired log, so reminders can fire again today. For testing. */
export async function resetFired() {
  await db.setMeta(META_FIRED, []);
}
