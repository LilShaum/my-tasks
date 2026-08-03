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
import { emptyLog, normalizeSettings, pruneSeverity } from '../domain/model.js';
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

/**
 * Told about a write that failed, so it can be shown rather than only logged.
 *
 * Registered by main.js. The store cannot reach for a toast itself without the
 * data layer depending on the UI, and a storage failure is exactly the thing
 * that must never be swallowed: the screen has already said "saved".
 *
 * @type {((err: unknown) => void)|null}
 */
let saveErrorHandler = null;

/** @param {(err: unknown) => void} fn */
export function onSaveError(fn) { saveErrorHandler = fn; }

/**
 * Write everything currently dirty, and put it all back if the write fails.
 *
 * The flags are cleared before the await so that changes made *during* the
 * write are not lost — they re-dirty and go out on the next pass. The cost is
 * that a failure has to restore them by hand, and getting that wrong is how a
 * day disappears while the screen shows a tick. It restores the log dates too,
 * which is the case an earlier version missed.
 *
 * @returns {Promise<boolean>} whether everything landed
 */
async function writeDirty() {
  const settings = dirty.settings;
  const periods = dirty.periods;
  const dates = [...dirty.logs];

  if (!settings && !periods && !dates.length) return true;

  dirty.settings = false;
  dirty.periods = false;
  dirty.logs.clear();

  const jobs = [];
  if (settings) jobs.push(repo.saveSettings(state.settings));
  if (periods) jobs.push(repo.savePeriodDays(state.periodDays));
  if (dates.length) jobs.push(repo.saveLogs(dates.map((d) => state.logs[d] ?? emptyLog(d))));

  try {
    await Promise.all(jobs);
    return true;
  } catch (err) {
    if (settings) dirty.settings = true;
    if (periods) dirty.periods = true;
    for (const date of dates) dirty.logs.add(date);

    console.error('kittycal: failed to save', err);
    saveErrorHandler?.(err);
    return false;
  }
}

/*
  Writes run one at a time, in order.

  Without this a second save can start while the first is still in flight, find
  the dirty set already emptied, and report success for work it never did — so
  `await putLog(...)` would resolve before the data was anywhere near the disk.
  Chaining means the second call waits, then writes whatever is genuinely left,
  including anything the first put back after failing.
*/
let chain = /** @type {Promise<boolean>} */ (Promise.resolve(true));

function runWrite() {
  const next = chain.then(writeDirty, writeDirty);
  chain = next;
  return next;
}

const flush = debounce(() => { void runWrite(); }, 300);

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
 * @returns {Promise<boolean>} whether the write landed, for urgent writes
 */
function scheduleFlush(urgent = false) {
  if (urgent) return runWrite();
  flush();
  return Promise.resolve(true);
}

/**
 * Force an immediate write — used before unload, after imports, and by anything
 * that needs to know the data is really down before it says so.
 *
 * @returns {Promise<boolean>} whether everything landed
 */
export function flushNow() {
  return runWrite();
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
 * Remember what she picked, so those chips surface first next time.
 *
 * A store action rather than something each view does for itself, because it
 * was the latter and the two logging paths quietly disagreed: the diary
 * recorded her picks and the check-in did not. Since the check-in is how most
 * days get logged, the "what you log most" list it reads from stayed empty
 * forever — the personalisation existed and never fired for the main journey.
 * One implementation, called from both, cannot drift like that again.
 *
 * @param {DayLog} log
 */
export function rememberPicks(log) {
  const picked = [
    ...log.symptoms, ...log.moods, ...log.discharge,
    ...log.activity, ...log.other, ...log.sex,
  ];
  if (!picked.length) return;
  // Reversed so the most recently chosen ends up nearest the front.
  const recent = [...new Set([...picked.reverse(), ...state.settings.recentChips])].slice(0, 24);
  updateSettings({ recentChips: recent });
}

/**
 * Write a log. Flow changes are mirrored into `periodDays` so that marking
 * bleeding in the diary and marking a period on the calendar are the same
 * act — there's no way to get the two out of step.
 *
 * Returns whether the write reached storage, so a caller that is about to
 * congratulate her can check first.
 *
 * @param {DayLog} log
 * @returns {Promise<boolean>}
 */
export function putLog(log, { quiet = false } = {}) {
  /*
    Severity belongs to a symptom, so it cannot outlive one. Done here rather
    than in each view because there are four ways a symptom gets deselected —
    the check-in, the diary's own chips, the diary's quick row, and "none"
    clearing a whole category — and a rating left behind by any of them would
    silently reattach itself the next time that symptom was picked.
  */
  log = pruneSeverity(log);

  // Kept so a failed write can be undone. The screen renders from memory, so
  // leaving the change in place after the disk refused it would show her a day
  // that will not be there tomorrow.
  const prevLog = state.logs[log.date];
  const prevPeriods = state.periodDays;

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

  const saved = scheduleFlush(true).then((ok) => {
    if (!ok) {
      if (prevLog) state.logs = { ...state.logs, [log.date]: prevLog };
      else { const rest = { ...state.logs }; delete rest[log.date]; state.logs = rest; }
      state.periodDays = prevPeriods;
      // Nothing left to retry for this date — memory now matches the disk.
      dirty.logs.delete(log.date);
      notify();
    }
    return ok;
  });

  /*
    `quiet` writes still persist and still update state — they just skip the
    subscriber notification, and so skip a full re-render of the visible view.

    That matters for logging a symptom straight from the Today screen. Nothing
    on that screen depends on which symptoms are ticked except the row of chips
    itself, but a re-render rebuilds the prediction cards, and those carry an
    entrance animation — so every tap would have made the screen jump.

    It is safe because only the active view renders, and switching views
    re-renders from state that is already correct. Flow is the exception and
    never uses it: marking bleeding moves the ring and every prediction under
    it, so that genuinely needs the repaint.
  */
  if (!quiet) notify();
  return saved;
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
