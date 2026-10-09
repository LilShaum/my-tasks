// @ts-check
/**
 * reminders.js — her reminder choices, and keeping the phone's schedule in step.
 *
 * Her reminders are real notifications now: they arrive with the app closed.
 * They used to be checked only when she opened the app, which is exactly when
 * Today already said the same thing (PRODUCT.md, D1).
 *
 * What leaves the phone: its push address and a list of times. The words, and
 * the reasons behind each time, are worked out here (reminder-plan.js) and kept
 * in settings.selfPush.plan, where the service worker reads them when a push
 * arrives. Whenever her data changes the plan is rebuilt, and if the times
 * moved they are sent again, so a reminder for a pill she has marked or a day
 * she has logged is gone before it is due.
 *
 * @typedef {import('../domain/reminder-plan.js').ReminderChoices} ReminderSettings
 */

import * as db from '../storage/db.js';
import * as store from '../state/store.js';
import { todayKey } from '../utils/date.js';
import { predict } from '../domain/predict.js';
import { reminderPlan } from '../domain/reminder-plan.js';
import { registerSelf, currentEndpoint } from '../storage/push.js';

const META_REMINDERS = 'reminders';
/** Long enough to fold a burst of taps into one send. */
const DEBOUNCE_MS = 3000;

/** @returns {ReminderSettings} */
function defaultReminders() {
  return {
    periodSoon: false,
    periodSoonDays: 2,
    periodLate: false,
    fertile: false,
    pill: false,
    pillTime: '21:00',
    logDaily: false,
  };
}

/** The choices, kept in memory once read, so a store change can plan without waiting. */
let cached = /** @type {ReminderSettings|null} */ (null);

/** @returns {Promise<ReminderSettings>} */
export async function loadReminders() {
  const stored = await db.getMeta(META_REMINDERS, null);
  cached = { ...defaultReminders(), ...(stored && typeof stored === 'object' ? stored : {}) };
  return cached;
}

/** @param {Partial<ReminderSettings>} patch */
export async function saveReminders(patch) {
  const next = { ...(await loadReminders()), ...patch };
  await db.setMeta(META_REMINDERS, next);
  cached = next;
  return next;
}

/** Whether any reminder is chosen. @param {ReminderSettings} r */
export const anyOn = (r) => r.periodSoon || r.periodLate || r.fertile || r.pill || r.logDaily;

let syncing = false;
let timer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);

/**
 * Rebuild the plan and, if the times changed or a day has passed, send them.
 * Resolves true when the server has the current times.
 * @param {{force?: boolean}} [opts]
 */
export async function syncReminders({ force = false } = {}) {
  const { settings, logs, periodDays } = store.getState();
  const sp = settings.selfPush;
  if (!sp || syncing || settings.role === 'partner') return false;
  syncing = true;
  try {
    // A backup restored from another phone brings that phone's address.
    const endpoint = await currentEndpoint();
    if (endpoint && endpoint !== sp.endpoint) {
      store.updateSettings({ selfPush: null });
      return false;
    }
    const choices = cached ?? await loadReminders();
    const today = todayKey();
    const plan = reminderPlan({
      prediction: predict({ periodDays, settings, today, logs }),
      settings, logs, choices, today, now: Date.now(),
    });
    const sent = JSON.stringify(plan.map((p) => p.at));
    const latest = () => store.getState().settings.selfPush;
    if (!force && sent === sp.sent && Date.now() - sp.sentAt < 24 * 3600e3) {
      if (JSON.stringify(plan) !== JSON.stringify(sp.plan)) {
        const l = latest();
        if (l) store.updateSettings({ selfPush: { ...l, plan } });
      }
      return true;
    }
    try {
      await registerSelf(sp, plan.map((p) => p.at));
      const l = latest();
      if (l) store.updateSettings({ selfPush: { ...l, plan, sent, sentAt: Date.now() } });
      return true;
    } catch {
      // Offline: keep the words in step; the times go next time.
      const l = latest();
      if (l) store.updateSettings({ selfPush: { ...l, plan } });
      return false;
    }
  } finally {
    syncing = false;
  }
}

function schedule() {
  if (!store.getState().settings.selfPush) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncReminders(); }, DEBOUNCE_MS);
}

/** Start watching. Safe to call once at start-up whether or not any reminder is on. */
export function startReminderSync() {
  void loadReminders().then(schedule).catch(() => {});
  store.subscribe(schedule);
  addEventListener('online', schedule);
}
