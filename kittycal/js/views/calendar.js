// @ts-check
/**
 * calendar.js — the month grid.
 *
 * Colour semantics follow Flo's, because they're well-chosen and she may
 * already know them:
 *
 *   filled           a logged period day
 *   dotted outline   a predicted period day
 *   tinted band      the predicted fertile window
 *   ringed           the estimated ovulation day
 *   muted            luteal phase
 *   small dot        something else logged that day
 *
 * Two modes. Normally tapping a day opens it. In "edit period dates" mode —
 * reached the same way as in Flo, from a button above the grid — tapping toggles
 * period days directly, and dragging across marks a run of them.
 *
 * The grid is a real `role="grid"` with arrow-key navigation, because a month
 * view that can only be used by tapping is unusable with a keyboard.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 */

import { el, replace, haptic, announce } from '../utils/dom.js';
import {
  todayKey, makeKey, daysInMonth, fmtMonthYear, fmtLong, gridColumn, rotateDow,
  DOW_MIN, addDays, range, month as monthOf, year as yearOf, dayOfMonth,
} from '../utils/date.js';
import { buildCycles, isPeriodDay } from '../domain/cycles.js';
import { predict, upcomingPeriods, upcomingFertile } from '../domain/predict.js';
import { toastUndo } from '../ui/toast.js';
import { spotArt } from '../ui/mascot.js';
import * as store from '../state/store.js';

/** How many cycles ahead to draw. */
const FORECAST_CYCLES = 4;

/** @param {HTMLElement} host */
export function renderCalendar(host) {
  const state = store.getState();
  const { settings, periodDays, logs, ui } = state;
  const today = todayKey();

  const cycles = buildCycles(periodDays);
  const prediction = predict({ periodDays, settings, today });

  // Pre-compute the forecast as lookup sets so each cell is an O(1) check
  // rather than a scan over every predicted range.
  const marks = buildMarks(prediction, cycles, today);

  replace(host, [
    monthHeader(ui.calYear, ui.calMonth),
    editModeBar(ui.periodEditMode),
    grid({
      year: ui.calYear,
      month: ui.calMonth,
      today,
      firstDayOfWeek: settings.firstDayOfWeek,
      periodDays,
      cycles,
      logs,
      marks,
      editMode: ui.periodEditMode,
    }),
    legend(prediction),
    !cycles.length ? firstRunHint() : null,
  ]);
}

/* ── Forecast lookup sets ───────────────────────────────────────────────── */

/**
 * @param {import('../domain/predict.js').Prediction} prediction
 * @param {import('../domain/cycles.js').Cycle[]} cycles
 * @param {DateKey} today
 */
function buildMarks(prediction, cycles, today) {
  /** @type {Set<DateKey>} */ const predictedPeriod = new Set();
  /** @type {Set<DateKey>} */ const fertile = new Set();
  /** @type {Set<DateKey>} */ const ovulation = new Set();

  for (const span of upcomingPeriods(prediction, FORECAST_CYCLES)) {
    for (const day of range(span.start, span.end)) predictedPeriod.add(day);
  }

  for (const window of upcomingFertile(prediction, FORECAST_CYCLES)) {
    for (const day of range(window.start, window.end)) fertile.add(day);
    ovulation.add(window.ovulation);
  }

  // The stretch between the last period and the next expected one, past
  // ovulation, is luteal. Only drawn for the current cycle — projecting a
  // luteal phase months out would imply precision we don't have.
  /** @type {Set<DateKey>} */ const luteal = new Set();
  if (prediction.showFertility && prediction.ovulation && prediction.nextStart) {
    const from = addDays(prediction.ovulation, 1);
    if (from < prediction.nextStart) {
      for (const day of range(from, addDays(prediction.nextStart, -1))) luteal.add(day);
    }
  }

  return { predictedPeriod, fertile, ovulation, luteal, today };
}

/* ── Header ─────────────────────────────────────────────────────────────── */

/**
 * @param {number} year
 * @param {number} month
 */
function monthHeader(year, month) {
  return el('div', { class: 'cal-head' }, [
    el('button', {
      type: 'button', class: 'btn-icon', 'aria-label': 'Previous month', text: '‹',
      onclick: () => { haptic(8); store.shiftMonth(-1); },
    }),
    el('h2', { class: 'cal-month', text: fmtMonthYear(year, month), 'aria-live': 'polite' }),
    el('button', {
      type: 'button', class: 'btn-icon', 'aria-label': 'Next month', text: '›',
      onclick: () => { haptic(8); store.shiftMonth(1); },
    }),
    el('button', {
      type: 'button', class: 'btn btn-secondary cal-today-btn', text: 'Today',
      onclick: () => {
        const now = todayKey();
        store.setUi({ calYear: yearOf(now), calMonth: monthOf(now) });
        haptic(8);
      },
    }),
  ]);
}

/** @param {boolean} active */
function editModeBar(active) {
  return el('div', { class: 'cal-editbar' }, [
    el('button', {
      type: 'button',
      class: active ? 'btn' : 'btn btn-secondary',
      'aria-pressed': String(active),
      text: active ? 'Done editing' : 'Edit period dates',
      onclick: () => {
        store.setUi({ periodEditMode: !active });
        haptic(10);
        announce(active
          ? 'Finished editing period dates'
          : 'Editing period dates. Tap days to mark or unmark bleeding.');
      },
    }),
    active && el('p', { class: 'hint-sm', text:
      'Tap any day to mark or unmark it as a period day. Drag across several to ' +
      'do a run at once. Past months work too — filling in old periods makes ' +
      'every prediction better.' }),
  ]);
}

/* ── The grid ───────────────────────────────────────────────────────────── */

/**
 * @param {Object} opts
 * @param {number} opts.year
 * @param {number} opts.month
 * @param {DateKey} opts.today
 * @param {0|1} opts.firstDayOfWeek
 * @param {Set<DateKey>} opts.periodDays
 * @param {import('../domain/cycles.js').Cycle[]} opts.cycles
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} opts.logs
 * @param {ReturnType<typeof buildMarks>} opts.marks
 * @param {boolean} opts.editMode
 */
function grid({ year, month, today, firstDayOfWeek, periodDays, cycles, logs, marks, editMode }) {
  const total = daysInMonth(year, month);
  const first = makeKey(year, month, 1);
  const lead = gridColumn(first, firstDayOfWeek);

  const table = el('div', {
    class: 'cal-grid',
    role: 'grid',
    'aria-label': `${fmtMonthYear(year, month)} calendar`,
  });

  for (const label of rotateDow(DOW_MIN, firstDayOfWeek)) {
    table.append(el('div', { class: 'cal-dow', role: 'columnheader', text: label }));
  }

  for (let i = 0; i < lead; i++) {
    table.append(el('div', { class: 'cal-cell cal-cell-empty', role: 'gridcell' }));
  }

  /** Drag state for marking a run of period days. */
  let dragging = false;
  /** @type {boolean} */ let dragTurnOn = true;
  /** @type {Set<DateKey>} */ const dragTouched = new Set();

  for (let day = 1; day <= total; day++) {
    const key = makeKey(year, month, day);
    const cell = dayCell({
      key, day, today, periodDays, cycles, logs, marks, editMode,
      onActivate: () => activate(key, editMode),
      onDragStart: () => {
        if (!editMode) return;
        dragging = true;
        dragTurnOn = !store.getState().periodDays.has(key);
        dragTouched.clear();
        dragTouched.add(key);
      },
      onDragOver: () => {
        if (!editMode || !dragging || dragTouched.has(key)) return;
        dragTouched.add(key);
        store.setPeriodDays([key], dragTurnOn);
        haptic(6);
      },
    });
    table.append(cell);
  }

  // A pointerup anywhere ends a drag, including outside the grid.
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (dragTouched.size > 1) {
      announce(`${dragTouched.size} days updated`);
    }
    dragTouched.clear();
  };
  table.addEventListener('pointerup', endDrag);
  table.addEventListener('pointercancel', endDrag);
  window.addEventListener('pointerup', endDrag, { once: true });

  table.addEventListener('keydown', (e) => onGridKeydown(e, firstDayOfWeek));

  return table;
}

/**
 * Tap behaviour. In edit mode a tap toggles a period day, with undo. Otherwise
 * it selects the day — the detail sheet that opens from here lands in the next
 * phase, so for now selection is announced and the day is highlighted.
 * @param {DateKey} key
 * @param {boolean} editMode
 */
function activate(key, editMode) {
  if (editMode) {
    const wasOn = store.getState().periodDays.has(key);
    store.setPeriodDays([key], !wasOn);
    haptic(10);
    toastUndo(
      wasOn ? `${fmtLong(key)} is no longer a period day` : `${fmtLong(key)} marked as a period day`,
      () => store.setPeriodDays([key], wasOn),
    );
    return;
  }

  store.setUi({ selectedDate: key });
  announce(`Selected ${fmtLong(key)}`);
}

/**
 * @param {Object} opts
 * @param {DateKey} opts.key
 * @param {number} opts.day
 * @param {DateKey} opts.today
 * @param {Set<DateKey>} opts.periodDays
 * @param {import('../domain/cycles.js').Cycle[]} opts.cycles
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} opts.logs
 * @param {ReturnType<typeof buildMarks>} opts.marks
 * @param {boolean} opts.editMode
 * @param {() => void} opts.onActivate
 * @param {() => void} opts.onDragStart
 * @param {() => void} opts.onDragOver
 */
function dayCell(opts) {
  const { key, day, today, periodDays, cycles, logs, marks, editMode } = opts;

  const isToday = key === today;
  const isPast = key <= today;
  const logged = periodDays.has(key) || isPeriodDay(cycles, key);
  // Never show a prediction over a day that already has real data.
  const predicted = !logged && marks.predictedPeriod.has(key) && key > today;
  const fertile = !logged && !predicted && marks.fertile.has(key);
  const isOvulation = marks.ovulation.has(key) && !logged;
  const luteal = !logged && !predicted && !fertile && marks.luteal.has(key);
  const log = logs[key];
  const hasOtherData = log != null && !periodDays.has(key);
  const selected = store.getState().ui.selectedDate === key;

  /** @type {string[]} */
  const classes = ['cal-cell'];
  if (isToday) classes.push('is-today');
  if (logged) classes.push('is-period');
  if (predicted) classes.push('is-predicted');
  if (fertile) classes.push('is-fertile');
  if (isOvulation) classes.push('is-ovulation');
  if (luteal) classes.push('is-luteal');
  if (selected) classes.push('is-selected');
  if (!isPast) classes.push('is-future');

  const cell = el('button', {
    type: 'button',
    class: classes.join(' '),
    role: 'gridcell',
    tabindex: isToday ? '0' : '-1',
    dataset: { date: key },
    'aria-label': cellLabel({ key, logged, predicted, fertile, isOvulation, isToday, hasOtherData, editMode }),
    'aria-pressed': editMode ? String(logged) : null,
    'aria-current': isToday ? 'date' : null,
    onclick: opts.onActivate,
    onpointerdown: opts.onDragStart,
    onpointerenter: opts.onDragOver,
  }, [
    el('span', { class: 'cal-num num', text: String(day) }),
    hasOtherData && el('span', { class: 'cal-dot', 'aria-hidden': 'true' }),
  ]);

  return cell;
}

/**
 * The cell's accessible name. A calendar built from colour needs every cell to
 * state its meaning in words.
 * @param {Object} o
 */
function cellLabel(o) {
  const parts = [fmtLong(o.key)];
  if (o.isToday) parts.push('today');
  if (o.logged) parts.push('period day');
  else if (o.predicted) parts.push('period expected');
  if (o.isOvulation) parts.push('ovulation estimated');
  else if (o.fertile) parts.push('fertile window');
  if (o.hasOtherData) parts.push('has notes');
  if (o.editMode) parts.push(o.logged ? 'tap to unmark' : 'tap to mark as period');
  return parts.join(', ');
}

/**
 * Arrow-key navigation across the grid, following the roving-tabindex pattern.
 * @param {KeyboardEvent} e
 * @param {0|1} firstDayOfWeek
 */
function onGridKeydown(e, firstDayOfWeek) {
  const target = /** @type {HTMLElement} */ (e.target);
  const key = target?.dataset?.date;
  if (!key) return;

  /** @type {Record<string, number>} */
  const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  const step = steps[e.key];
  if (step == null) return;

  e.preventDefault();
  const next = addDays(/** @type {DateKey} */ (key), step);

  // Follow the move into an adjacent month if it crosses a boundary.
  if (monthOf(next) !== monthOf(/** @type {DateKey} */ (key))) {
    store.setUi({ calYear: yearOf(next), calMonth: monthOf(next), selectedDate: next });
    // The grid re-renders; focus the equivalent cell once it exists.
    requestAnimationFrame(() => {
      const cell = document.querySelector(`[data-date="${next}"]`);
      if (cell instanceof HTMLElement) {
        cell.tabIndex = 0;
        cell.focus();
      }
    });
    return;
  }

  const cell = document.querySelector(`[data-date="${next}"]`);
  if (cell instanceof HTMLElement) {
    target.tabIndex = -1;
    cell.tabIndex = 0;
    cell.focus();
  }
}

/* ── Legend ─────────────────────────────────────────────────────────────── */

/** @param {import('../domain/predict.js').Prediction} prediction */
function legend(prediction) {
  /** @type {{class: string, label: string}[]} */
  const items = [
    { class: 'is-period', label: 'Period logged' },
    { class: 'is-predicted', label: 'Period expected' },
  ];
  if (prediction.showFertility) {
    items.push({ class: 'is-fertile', label: 'Fertile window' });
    items.push({ class: 'is-ovulation', label: 'Ovulation estimated' });
  }

  return el('ul', { class: 'cal-legend' }, items.map((item) =>
    el('li', {}, [
      el('span', { class: `cal-legend-swatch ${item.class}`, 'aria-hidden': 'true' }),
      el('span', { text: item.label }),
    ]),
  ));
}

function firstRunHint() {
  return el('div', { class: 'empty' }, [
    spotArt('calendar', { size: 88 }),
    el('h3', { text: 'Mark your last period' }),
    el('p', { text:
      'Tap "Edit period dates" above, then tap the days you bled. That is all ' +
      'Kittycal needs to start predicting.' }),
  ]);
}
