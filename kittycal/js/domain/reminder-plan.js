// @ts-check
/**
 * reminder-plan.js — her reminders: when each is due, and what it says.
 *
 * They used to fire only when she opened the app, at which point Today was
 * already saying the same thing (PRODUCT.md, D1). Now her phone works out the
 * coming reminders here, keeps the words, and gives the server nothing but the
 * times; an empty push at each time wakes the phone, and the service worker
 * shows the entry planned for then. The same design as his heads-ups
 * (push-plan.js).
 *
 * Planned far enough ahead to keep working if she does not open the app for a
 * while: her next three periods, and a month of pill days. Every time
 * something changes (she logs, marks a pill, a period starts), the plan is
 * rebuilt and sent again, so a reminder for something already done is gone
 * before it is due.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./predict.js').Prediction} Prediction
 * @typedef {import('./model.js').Settings} Settings
 * @typedef {import('./model.js').DayLog} DayLog
 * @typedef {{at: number, title: string, body: string, kind: string}} PlannedReminder
 */

import { addDays, fmtDayMonth, dow, DOW_SHORT } from '../utils/date.js';
import { nothingRecorded } from './model.js';
import { packPosition, describePack } from './pill.js';

/**
 * @typedef {Object} ReminderChoices
 * @property {boolean} periodSoon
 * @property {number} periodSoonDays   how many days ahead
 * @property {boolean} periodLate
 * @property {boolean} fertile
 * @property {boolean} pill
 * @property {string} pillTime         'HH:MM', her local time
 * @property {boolean} logDaily
 */

/** Local hours: a heads-up over breakfast, a logging nudge after dinner. */
export const MORNING = 9;
export const EVENING = 20;
/** The most times the server keeps for one phone. */
export const SELF_LIMIT = 60;
/** Methods taken as a daily pill, the only ones a daily reminder fits. */
export const DAILY_PILL = new Set(['pill-combined', 'pill-mini']);

/**
 * @param {DateKey} key
 * @param {number} hour
 * @param {number} [minute]
 */
const at = (key, hour, minute = 0) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0).getTime();
};

/** @param {DateKey} key */
const day = (key) => `${DOW_SHORT[dow(key)]} ${fmtDayMonth(key)}`;

/**
 * Did she log anything that day? Water alone is a tap on Today, not a log.
 * @param {DayLog|undefined} log
 */
const logged = (log) => Boolean(log && (log.checkedIn || !nothingRecorded({ ...log, water: 0 })));

/**
 * Every reminder due from now, soonest first.
 *
 * @param {Object} input
 * @param {Prediction} input.prediction
 * @param {Settings} input.settings
 * @param {Record<DateKey, DayLog>} input.logs
 * @param {ReminderChoices} input.choices
 * @param {DateKey} input.today
 * @param {number} input.now   epoch ms; nothing in the past or the next five minutes
 * @returns {PlannedReminder[]}
 */
export function reminderPlan({ prediction: p, settings, logs, choices, today, now }) {
  /** @type {PlannedReminder[]} */
  const out = [];
  const forecast = p.nextStart && !p.expecting && !p.stale;
  const len = Math.max(15, p.avgCycleLength || 28);

  // Her period, a couple of days ahead: this one, and the two after, so it
  // still arrives if she does not open the app for a month.
  if (choices.periodSoon && forecast && p.nextStart) {
    const ahead = Math.max(1, Math.min(7, choices.periodSoonDays || 2));
    for (let k = 0; k < 3; k += 1) {
      const start = addDays(p.nextStart, k * len);
      out.push({
        kind: 'period-soon',
        at: at(addDays(start, -ahead), MORNING),
        title: ahead === 1 ? 'Your period is likely tomorrow' : `Your period is likely in ${ahead} days`,
        body: `Around ${day(start)}. Worth having what you need with you.`,
      });
    }
  }

  // The morning after her own range has passed with nothing logged. Asked as
  // a question, because the record may simply be behind.
  if (choices.periodLate && forecast && p.nextStart && !p.isLate) {
    const edge = p.startWindow?.to ?? p.nextStart;
    out.push({
      kind: 'period-late',
      at: at(addDays(edge, 1), MORNING),
      title: 'Has your period started?',
      body: `It was expected around ${day(p.nextStart)}. Log it when it does and Kittycal recalculates.`,
    });
  }

  // The morning her fertile window opens: this cycle's, and the next.
  if (choices.fertile && forecast && p.showFertility && p.fertileWindow) {
    for (let k = 0; k < 2; k += 1) {
      const start = addDays(p.fertileWindow.start, k * len);
      const ovulation = p.ovulation ? addDays(p.ovulation, k * len) : null;
      out.push({
        kind: 'fertile',
        at: at(start, MORNING),
        title: 'Your fertile window starts today',
        body: ovulation ? `Ovulation is estimated around ${day(ovulation)}.` : 'Based on your recent cycles.',
      });
    }
  }

  // The pill, at her time, every day it is due: not on a break day of a pack
  // she tracks, and not on a day she has already marked.
  if (choices.pill && DAILY_PILL.has(settings.birthControl)) {
    const [h, m] = (choices.pillTime || '21:00').split(':').map(Number);
    for (let d = 0; d < 30; d += 1) {
      const date = addDays(today, d);
      const position = packPosition(settings, date);
      if (position && !position.active) continue;
      if (logs[date]?.pillTaken) continue;
      const where = describePack(position);
      out.push({
        kind: 'pill',
        at: at(date, Number.isFinite(h) ? h : 21, Number.isFinite(m) ? m : 0),
        title: 'Time for your pill',
        body: `${where ? `${where}. ` : ''}Mark it in Kittycal once you have.`,
      });
    }
  }

  // A nudge in the evening on a day with nothing logged yet. Two weeks of
  // them; the plan is rebuilt whenever she does open the app.
  if (choices.logDaily) {
    for (let d = 0; d < 14; d += 1) {
      const date = addDays(today, d);
      if (logged(logs[date])) continue;
      out.push({
        kind: 'log',
        at: at(date, EVENING),
        title: 'Anything to log today?',
        body: 'Flow, symptoms, mood. Whatever you feel like recording.',
      });
    }
  }

  return out.filter((r) => r.at > now + 5 * 60_000).sort((a, b) => a.at - b.at).slice(0, SELF_LIMIT);
}

/**
 * Which planned reminders a push that arrived at `now` is for: every entry
 * within a quarter of an hour (two can share a time), else the closest within
 * six hours, else none. The service worker keeps its own copy; this is the
 * one the tests hold it to.
 *
 * @param {{at: number}[]} plan
 * @param {number} now
 */
export function remindersFor(plan, now) {
  const close = plan.filter((p) => Math.abs(p.at - now) <= 15 * 60_000);
  if (close.length) return close;
  let best = null;
  for (const p of plan) {
    const off = Math.abs(p.at - now);
    if (off <= 6 * 3600e3 && (!best || off < Math.abs(best.at - now))) best = p;
  }
  return best ? [best] : [];
}
