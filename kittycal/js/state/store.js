// @ts-check
/**
 * store.js — one store, plain actions, subscriber notification.
 *
 * Deliberately not a framework. Actions mutate through named functions that
 * bump a version counter and schedule (a) a persist and (b) a re-render.
 * Views subscribe and re-read via selectors.
 *
 * Persistence is debounced 300ms and batched by kind, so holding down the
 * water "+" button doesn't issue thirty IndexedDB transactions.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('../domain/model.js').DayLog} DayLog
 * @typedef {import('../domain/model.js').Settings} Settings
 */

import * as repo from '../storage/repo.js';
import { emptyLog, normalizeSettings } from '../domain/model.js';
import { defaultSettings } from '../domain/model.js';
import { debounce } from '../utils/dom.js';
import { todayKey } from '../utils/date.js';

/**
 * @typedef {Object} UiState
 * @property {string} view          'today'|'calendar'|'insights'|'settings'
 * @property {number} calYear
 * @property {number} calMonth      0-indexed
 * @property {'month'|'year'} calView
 * @property {DateKey} selectedDate
 * @property {boolean} periodEditMode
 * @property {boolean} locked
 */

/**
 * @typedef {Object} State
 * @property {Settings} settings
 * @property {Record<DateKey, DayLog>} logs
 * @property {Set<DateKey>} periodDays
 * @property {UiState} ui
 * @property {number} version
 * @property {boolean} ready
 */

const today = todayKey();

/** @type {State} */
let state = {
  settings: defaultSettings(),
  logs: {},
  periodDays: new Set(),
  ui: {
    view: 'today',
    calYear: Number(today.slice(0, 4)),
    calMonth: Number(today.slice(5, 7)) - 1,
    calView: 'month',
    selectedDate: today,
    periodEditMode: false,
    locked: false,
  },
  version: 0,
  ready: false,
};

/** @type {Set<(s: State) => void>} */
const subscribers = new Set();

/** @returns {State} */
export const getState = () => state;

/**
 * @param {(s: State) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Notify subscribers on the next frame, coalescing bursts into one render. */
let notifyQueued = false;
function notify() {
  state.version++;
  if (notifyQueued) return;
  notifyQueued = true;
  requestAnimationFrame(() => {
    notifyQueued = false;
    for (const fn of subscribers) fn(state);
  });
}

/* ── Persistence ─────────────────────────────────────────────────────────
   Dirty flags rather than a queue of writes: what matters is the final
   value of each slice, not the sequence of intermediate ones.            */

const dirty = { settings: false, periods: false, /** @type {Set<DateKey>} */ logs: new Set() };

const flush = debounce(async () => {
  const jobs = [];

  if (dirty.settings) {
    dirty.settings = false;
    jobs.push(repo.saveSettings(state.settings));
  }
  if (dirty.periods) {
    dirty.periods = false;
    jobs.push(repo.savePeriodDays(state.periodDays));
  }
  if (dirty.logs.size) {
    const dates = [...dirty.logs];
    dirty.logs.clear();
    const logs = dates.map((d) => state.logs[d] ?? emptyLog(d));
    jobs.push(repo.saveLogs(logs));
  }

  try {
    await Promise.all(jobs);
  } catch (err) {
    console.error('kittycal: failed to save', err);
    // Re-flag so the next change retries rather than silently dropping data.
    dirty.settings = true;
    dirty.periods = true;
  }
}, 300);

/**
 * Schedule a write.
 *
 * Debounced by default so holding the water "+" doesn't issue thirty
 * transactions. `urgent` skips the wait for writes that must not be lost if the
 * app is swiped away in the next fraction of a second — applying a log entry,
 * or marking a period day. A 300ms window is small, but losing a period date to
 * it would be the single worst bug this app could have.
 *
 * @param {boolean} [urgent]
 */
function scheduleFlush(urgent = false) {
  if (urgent) { void flushNow(); return; }
  flush();
}

/** Force an immediate write — used before unload and after imports. */
export async function flushNow() {
  if (dirty.settings) { dirty.settings = false; await repo.saveSettings(state.settings); }
  if (dirty.periods) { dirty.periods = false; await repo.savePeriodDays(state.periodDays); }
  if (dirty.logs.size) {
    const dates = [...dirty.logs];
    dirty.logs.clear();
    await repo.saveLogs(dates.map((d) => state.logs[d] ?? emptyLog(d)));
  }
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

/** Load everything from storage into the store. */
export async function hydrate() {
  const { settings, logs, periodDays } = await repo.loadAll();
  state = { ...state, settings, logs, periodDays, ready: true };
  notify();
  return state;
}

/* ── Settings actions ───────────────────────────────────────────────────── */

/** @param {Partial<Settings>} patch */
export function updateSettings(patch) {
  state.settings = normalizeSettings({ ...state.settings, ...patch });
  dirty.settings = true;
  flush();
  notify();
}

/* ── Log actions ────────────────────────────────────────────────────────── */

/**
 * The log for a date, creating a blank one in memory if absent. The returned
 * object is a copy — callers mutate it and hand it to `putLog`.
 * @param {DateKey} date
 * @returns {DayLog}
 */
export function getLog(date) {
  const existing = state.logs[date];
  return existing ? { ...existing } : emptyLog(date);
}

/**
 * Write a log. Flow changes are mirrored into `periodDays` so that marking
 * bleeding in the diary and marking a period on the calendar are the same
 * act — there's no way to get the two out of step.
 * @param {DayLog} log
 */
export function putLog(log) {
  state.logs = { ...state.logs, [log.date]: log };
  dirty.logs.add(log.date);

  const bleeding = log.flow === 'light' || log.flow === 'medium' ||
                   log.flow === 'heavy' || log.flow === 'clots';
  const marked = state.periodDays.has(log.date);
  if (bleeding && !marked) {
    state.periodDays = new Set(state.periodDays).add(log.date);
    dirty.periods = true;
  } else if (!bleeding && marked) {
    const next = new Set(state.periodDays);
    next.delete(log.date);
    state.periodDays = next;
    dirty.periods = true;
  }

  scheduleFlush(true);
  notify();
}

/**
 * Apply a patch to a date's log in one call.
 * @param {DateKey} date
 * @param {Partial<DayLog>} patch
 */
export function patchLog(date, patch) {
  putLog({ ...getLog(date), ...patch });
}

/** @param {DateKey} date */
export function removeLog(date) {
  const next = { ...state.logs };
  delete next[date];
  state.logs = next;
  dirty.logs.add(date);

  if (state.periodDays.has(date)) {
    const days = new Set(state.periodDays);
    days.delete(date);
    state.periodDays = days;
    dirty.periods = true;
  }

  flush();
  notify();
}

/* ── Period-day actions ─────────────────────────────────────────────────── */

/**
 * Mark or unmark period days. Also keeps each day's `flow` consistent:
 * marking a day with no recorded flow gives it the stated average as a
 * sensible default, and unmarking clears bleeding back to 'none'.
 * @param {DateKey[]} dates
 * @param {boolean} on
 */
export function setPeriodDays(dates, on) {
  if (!dates.length) return;
  const days = new Set(state.periodDays);
  const logs = { ...state.logs };

  for (const date of dates) {
    if (on) {
      days.add(date);
      const log = logs[date] ?? emptyLog(date);
      if (log.flow === 'none' || log.flow === 'spotting') {
        logs[date] = { ...log, flow: 'medium' };
        dirty.logs.add(date);
      }
    } else {
      days.delete(date);
      const log = logs[date];
      if (log && log.flow !== 'none' && log.flow !== 'spotting') {
        logs[date] = { ...log, flow: 'none' };
        dirty.logs.add(date);
      }
    }
  }

  state.periodDays = days;
  state.logs = logs;
  dirty.periods = true;
  scheduleFlush(true);
  notify();
}

/** @param {DateKey} date */
export function togglePeriodDay(date) {
  setPeriodDays([date], !state.periodDays.has(date));
}

/* ── UI actions (not persisted) ─────────────────────────────────────────── */

/** @param {Partial<UiState>} patch */
export function setUi(patch) {
  state.ui = { ...state.ui, ...patch };
  notify();
}

/** @param {string} view */
export function setView(view) {
  setUi({ view, periodEditMode: false });
}

/** @param {number} delta months */
export function shiftMonth(delta) {
  const d = new Date(state.ui.calYear, state.ui.calMonth + delta, 1);
  setUi({ calYear: d.getFullYear(), calMonth: d.getMonth() });
}

/* ── Bulk replace, for import ───────────────────────────────────────────── */

/**
 * @param {{settings?: Settings, logs?: Record<DateKey, DayLog>, periodDays?: Set<DateKey>}} data
 */
export function replaceAll(data) {
  if (data.settings) state.settings = normalizeSettings(data.settings);
  if (data.logs) state.logs = data.logs;
  if (data.periodDays) state.periodDays = data.periodDays;
  dirty.settings = true;
  dirty.periods = true;
  for (const date of Object.keys(state.logs)) dirty.logs.add(date);
  notify();
  return flushNow();
}

/** Reset the in-memory store after an erase, without reloading the page. */
export function resetToDefaults() {
  state = {
    ...state,
    settings: defaultSettings(),
    logs: {},
    periodDays: new Set(),
    ready: true,
  };
  dirty.settings = false;
  dirty.periods = false;
  dirty.logs.clear();
  notify();
}
