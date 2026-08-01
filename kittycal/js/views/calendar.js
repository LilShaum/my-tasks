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
  DOW_MIN, MONTHS, MONTHS_SHORT, addDays, range,
  month as monthOf, year as yearOf, dayOfMonth,
} from '../utils/date.js';
import { buildCycles, filledPeriodDays } from '../domain/cycles.js';
import { predict, upcomingPeriods, upcomingFertile } from '../domain/predict.js';
import { toastUndo } from '../ui/toast.js';
import { spotArt } from '../ui/mascot.js';
import { openLogSheet } from './log.js';
import { openCheckin } from './checkin.js';
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

  // The same treatment for period days. `isPeriodDay` scans every cycle, and
  // the year view called it 365 times — at five years of history that is
  // ~24,000 comparisons to draw one screen. Built once here, it is a lookup.
  //
  // This is the *filled span*, not the marked days: `buildPeriods` tolerates a
  // one-day gap, so a period marked 10th, 11th, 13th, 14th is one period and
  // the 12th is drawn as part of it.
  const periodFill = filledPeriodDays(cycles);

  if (ui.calView === 'year') {
    replace(host, [
      yearHeader(ui.calYear),
      yearGrid({ year: ui.calYear, today, periodFill, marks,
                 firstDayOfWeek: settings.firstDayOfWeek }),
      legend(prediction, { fertility: false }),
    ]);
    return;
  }

  replace(host, [
    monthHeader(ui.calYear, ui.calMonth),
    editModeBar(ui.periodEditMode),
    grid({
      year: ui.calYear,
      month: ui.calMonth,
      today,
      firstDayOfWeek: settings.firstDayOfWeek,
      periodDays,
      periodFill,
      logs,
      marks,
      editMode: ui.periodEditMode,
    }),
    legend(prediction),
    !cycles.length ? firstRunHint() : null,
  ]);
}

/* ── Year view ──────────────────────────────────────────────────────────── */

/** @param {number} year */
function yearHeader(year) {
  return el('div', { class: 'cal-head' }, [
    el('button', {
      type: 'button', class: 'btn-icon', 'aria-label': 'Previous year', text: '‹',
      onclick: () => { haptic(8); store.setUi({ calYear: year - 1 }); },
    }),
    el('h2', { class: 'cal-month num', text: String(year), 'aria-live': 'polite' }),
    el('button', {
      type: 'button', class: 'btn-icon', 'aria-label': 'Next year', text: '›',
      onclick: () => { haptic(8); store.setUi({ calYear: year + 1 }); },
    }),
    el('button', {
      type: 'button', class: 'btn btn-secondary cal-today-btn', text: 'Months',
      onclick: () => { haptic(8); store.setUi({ calView: 'month' }); },
    }),
  ]);
}

/**
 * Twelve miniature months. Tapping one jumps to it.
 *
 * Deliberately shows only logged periods and predicted periods — at this size
 * a fertile-window tint would be a smear of colour rather than information.
 * The point of this view is "when did I bleed over the year", which is exactly
 * the question you bring to a doctor's appointment.
 *
 * @param {Object} opts
 * @param {number} opts.year
 * @param {DateKey} opts.today
 * @param {Set<DateKey>} opts.periodFill
 * @param {ReturnType<typeof buildMarks>} opts.marks
 * @param {0|1} opts.firstDayOfWeek
 */
function yearGrid({ year, today, periodFill, marks, firstDayOfWeek }) {
  const wrap = el('div', { class: 'year-grid' });

  for (let month = 0; month < 12; month++) {
    const total = daysInMonth(year, month);
    const lead = gridColumn(makeKey(year, month, 1), firstDayOfWeek);

    const mini = el('div', { class: 'mini-grid', 'aria-hidden': 'true' });
    for (let i = 0; i < lead; i++) mini.append(el('span', { class: 'mini-cell' }));

    let periodCount = 0;
    for (let d = 1; d <= total; d++) {
      const key = makeKey(year, month, d);
      const logged = periodFill.has(key);
      const predicted = !logged && marks.predictedPeriod.has(key) && key > today;
      if (logged) periodCount++;

      /** @type {string[]} */
      const classes = ['mini-cell'];
      if (logged) classes.push('is-period');
      else if (predicted) classes.push('is-predicted');
      if (key === today) classes.push('is-today');

      mini.append(el('span', { class: classes.join(' ') }));
    }

    wrap.append(el('button', {
      type: 'button',
      class: 'mini-month',
      'aria-label': `${MONTHS[month]} ${year}, ${periodCount} period ${periodCount === 1 ? 'day' : 'days'} logged`,
      onclick: () => {
        haptic(8);
        store.setUi({ calYear: year, calMonth: month, calView: 'month' });
      },
    }, [
      el('span', { class: 'mini-month-name', text: MONTHS_SHORT[month] }),
      mini,
    ]));
  }

  return wrap;
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
  return el('div', { class: 'cal-head cal-head-5' }, [
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
    el('button', {
      type: 'button', class: 'btn btn-secondary cal-today-btn', text: 'Year',
      onclick: () => { haptic(8); store.setUi({ calView: 'year' }); },
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
 * @param {Set<DateKey>} opts.periodFill
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} opts.logs
 * @param {ReturnType<typeof buildMarks>} opts.marks
 * @param {boolean} opts.editMode
 */
function grid({ year, month, today, firstDayOfWeek, periodDays, periodFill, logs, marks, editMode }) {
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
      key, day, today, periodDays, periodFill, logs, marks, editMode,
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
 * it opens whichever of the two logging paths actually fits the day.
 *
 * The rule is the one the week strip on Today already uses: a day with nothing
 * on it gets the three questions, a day that has already been answered gets the
 * diary. Sending every tap to the diary meant catching up on anything older
 * than the week strip's seven days cost a wall of collapsed categories to
 * record what the check-in asks in three taps — which is the friction the
 * check-in exists to remove, still sitting there one screen over.
 *
 * Future dates keep the diary. "Any bleeding today?" is not a question that can
 * be asked about next Tuesday, and a check-in there would invite marking a
 * period that has not happened.
 *
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

  const unanswered = !store.getState().logs[key] && key <= todayKey();
  if (unanswered) openCheckin(key); else openLogSheet(key);
}

/**
 * @param {Object} opts
 * @param {DateKey} opts.key
 * @param {number} opts.day
 * @param {DateKey} opts.today
 * @param {Set<DateKey>} opts.periodDays
 * @param {Set<DateKey>} opts.periodFill
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} opts.logs
 * @param {ReturnType<typeof buildMarks>} opts.marks
 * @param {boolean} opts.editMode
 * @param {() => void} opts.onActivate
 * @param {() => void} opts.onDragStart
 * @param {() => void} opts.onDragOver
 */
function dayCell(opts) {
  const { key, day, today, periodDays, periodFill, logs, marks, editMode } = opts;

  const isToday = key === today;
  const isPast = key <= today;

  /*
    Two different truths, and which one to show depends on what the tap does.

    Normally the cell shows the *filled span* — the one-day gap inside a period
    marked 10th, 11th, 13th, 14th is drawn as period, because that is how the
    cycle is actually counted.

    In edit mode the tap toggles membership of `periodDays`, so the cell has to
    show `periodDays`. Otherwise the gap day rendered as selected, and tapping
    it — which anyone would do to turn it off — turned it *on*, with no visible
    change. The control was reporting a state its own tap did not control.
  */
  const marked = periodDays.has(key);
  const logged = editMode ? marked : (marked || periodFill.has(key));
  // Never show a prediction over a day that already has real data.
  const predicted = !logged && marks.predictedPeriod.has(key) && key > today;
  const fertile = !logged && !predicted && marks.fertile.has(key);
  const isOvulation = marks.ovulation.has(key) && !logged;
  const luteal = !logged && !predicted && !fertile && marks.luteal.has(key);
  const log = logs[key];
  const hasOtherData = log != null && !marked;
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

/**
 * @param {import('../domain/predict.js').Prediction} prediction
 * @param {{fertility?: boolean}} [opts] set fertility:false where the view
 *   doesn't draw those states — a legend for something not on screen is worse
 *   than no legend.
 */
function legend(prediction, opts = {}) {
  const { fertility = true } = opts;

  /** @type {{class: string, label: string}[]} */
  const items = [
    { class: 'is-period', label: 'Period logged' },
    { class: 'is-predicted', label: 'Period expected' },
  ];
  if (fertility && prediction.showFertility) {
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
