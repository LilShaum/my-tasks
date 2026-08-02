// @ts-check
/**
 * insights.js — cycle analysis.
 *
 * Everything in here is behind Flo Premium. It's all arithmetic over data she
 * already has, so there's no honest reason for it to cost anything.
 *
 * The whole screen is a data zone: thin borders, tabular numerals, no
 * decorative motion, no mascot. Same palette as the rest of the app, different
 * density — cute chrome, restrained data.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 */

import { el, replace, haptic } from '../utils/dom.js';
import { todayKey, fmtDayMonth, addDays } from '../utils/date.js';
import { plural, fmtTemp, fmtWeight } from '../utils/fmt.js';
import {
  buildCycles, cycleLengths, periodLengths, summarize, currentCycle,
} from '../domain/cycles.js';
import { predict, detectThermalShift } from '../domain/predict.js';
import { phaseFor, PHASES } from '../domain/phases.js';
import {
  detectPatterns, symptomPattern, series, bbtForCycle, daysLogged, loggingConsistency,
  moodByPhase,
} from '../domain/stats.js';
import { labelOf } from '../data/taxonomy.js';
import * as acog from '../domain/acog.js';
import { barChart, lineChart, dayHeatmap } from '../ui/chart.js';
import { spotArt } from '../ui/mascot.js';
import { openReport } from './report.js';
import * as store from '../state/store.js';

/** @param {HTMLElement} host */
export function renderInsights(host) {
  const { settings, periodDays, logs } = store.getState();
  const today = todayKey();

  const cycles = buildCycles(periodDays);
  const prediction = predict({ periodDays, settings, today });
  const lengths = cycleLengths(cycles);
  const periods = periodLengths(cycles, today);

  if (cycles.length < 2) {
    replace(host, [notEnoughYet(cycles.length)]);
    return;
  }

  replace(host, [
    el('div', { class: 'data-zone' }, [
      overviewCard(logs, cycles, lengths, today),
      cycleLengthCard(lengths, prediction),
      periodLengthCard(periods),
      patternsCard(logs, cycles, prediction),
      moodCard(logs, cycles, settings),
      bbtCard(logs, cycles, settings),
      trendCard(logs, settings),
      reportCard(),
      footnote(),
    ]),
  ]);
}

/* ── Overview ───────────────────────────────────────────────────────────── */

/**
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 * @param {import('../domain/cycles.js').Cycle[]} cycles
 * @param {number[]} lengths
 * @param {DateKey} today
 */
function overviewCard(logs, cycles, lengths, today) {
  const stats = summarize(lengths);
  /*
    Consistency over a window, not a streak.

    A streak resets to zero the first time she misses a day, and this card is
    the last place that should be showing her a zero — its job is to make the
    history feel worth adding to. A count over the last thirty days moves by
    one when she misses a day and moves back when she catches up.
  */
  const recent = loggingConsistency(logs, today, addDays);

  return el('div', { class: 'card' }, [
    el('h2', { text: 'Your history' }),
    el('div', { class: 'stat-row' }, [
      stat('Cycles', String(cycles.length), cycles.length === 1 ? 'logged' : 'logged'),
      stat('Days', String(daysLogged(logs)), 'tracked'),
      stat('Last 30 days', String(recent), recent === 1 ? 'day logged' : 'days logged'),
    ]),
    stats.mean != null && el('p', { class: 'hint-sm', text:
      `Average cycle ${Math.round(stats.mean)} days, ` +
      `ranging from ${stats.min} to ${stats.max}.` }),
  ]);
}

/* ── Cycle length ───────────────────────────────────────────────────────── */

/**
 * @param {number[]} lengths
 * @param {import('../domain/predict.js').Prediction} prediction
 */
function cycleLengthCard(lengths, prediction) {
  if (!lengths.length) return null;

  const stats = summarize(lengths);
  const recent = lengths.slice(-12);
  const offset = lengths.length - recent.length;

  const data = recent.map((value, i) => ({
    label: String(offset + i + 1),
    value,
    flagged: !acog.isCycleTypical(value),
  }));

  const regularity = prediction.regularity ?? 'regular';
  /** @type {Record<string, string>} */
  const wording = {
    regular: 'Consistent from cycle to cycle.',
    variable: 'Moves around a little between cycles.',
    irregular: 'Varies quite a lot between cycles.',
  };

  return el('div', { class: 'card' }, [
    el('h2', { text: 'Cycle length' }),
    el('p', { class: 'hint-sm', text:
      `Last ${plural(recent.length, 'cycle')}. The green band is the typical ` +
      `range, ${acog.CYCLE_MIN}–${acog.CYCLE_MAX} days.` }),
    barChart({
      data,
      average: stats.mean ?? undefined,
      normalBand: [acog.CYCLE_MIN, acog.CYCLE_MAX],
      unit: 'd',
      summary: `Bar chart of your last ${recent.length} cycle lengths, ` +
        `from ${stats.min} to ${stats.max} days, averaging ` +
        `${Math.round(stats.mean ?? 0)}. ` +
        `${data.filter((d) => d.flagged).length} fall outside the typical range.`,
    }),
    el('div', { class: 'stat-row' }, [
      stat('Average', String(prediction.avgCycleLength), 'days'),
      stat('Variation', String(stats.spread ?? 0), 'days'),
      stat('Pattern', regularity === 'regular' ? 'Regular'
        : regularity === 'variable' ? 'Variable' : 'Irregular', ''),
    ]),
    el('p', { class: 'hint-sm', text: wording[regularity] }),
  ]);
}

/** @param {number[]} periods */
function periodLengthCard(periods) {
  if (periods.length < 2) return null;
  const stats = summarize(periods);
  const recent = periods.slice(-12);

  return el('div', { class: 'card' }, [
    el('h2', { text: 'Period length' }),
    el('p', { class: 'hint-sm', text:
      `Typical is ${acog.PERIOD_MIN}–${acog.PERIOD_MAX} days of bleeding.` }),
    barChart({
      data: recent.map((value, i) => ({
        label: String(periods.length - recent.length + i + 1),
        value,
        flagged: !acog.isPeriodTypical(value),
      })),
      average: stats.mean ?? undefined,
      normalBand: [acog.PERIOD_MIN, acog.PERIOD_MAX],
      unit: 'd',
      height: 120,
      summary: `Bar chart of your last ${recent.length} period lengths, ` +
        `from ${stats.min} to ${stats.max} days.`,
    }),
  ]);
}

/* ── Mood by phase ──────────────────────────────────────────────────────── */

/**
 * Days with a mood logged before a phase is worth comparing.
 *
 * Three: enough that a single unusual day cannot own a whole phase, low enough
 * that the card appears within a couple of months of ordinary use.
 */
const MIN_DAYS_PER_PHASE = 3;

/**
 * How she tends to feel at each point in the cycle.
 *
 * Shares, not counts. The luteal stretch is about twice the length of the
 * fertile window, so whatever she feels then would top any raw table simply by
 * having more days in it — the bar would be measuring the calendar rather than
 * her mood.
 *
 * Only complete cycles count, and only phases with enough days behind them get
 * a row: one cheerful Tuesday in the follicular phase is not a finding.
 *
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 * @param {import('../domain/cycles.js').Cycle[]} cycles
 * @param {import('../domain/model.js').Settings} settings
 */
function moodCard(logs, cycles, settings) {
  const byPhase = moodByPhase(logs, cycles, settings.lutealLength);

  // Drawn in cycle order rather than by size, so the card reads as a journey
  // through the month.
  const order = ['menstrual', 'follicular', 'ovulatory', 'luteal'];
  const rows = order
    .map((id) => ({ id, data: byPhase.get(id) }))
    .filter((r) => r.data && r.data.total >= MIN_DAYS_PER_PHASE);

  if (rows.length < 2) {
    return el('div', { class: 'card' }, [
      el('h2', { text: 'Mood by phase' }),
      el('p', { class: 'hint-sm', text:
        'Log how you are feeling on a few more days and this fills in — it ' +
        'needs a handful in each part of the cycle before the comparison ' +
        'means anything.' }),
    ]);
  }

  const total = rows.reduce((n, r) => n + (r.data?.total ?? 0), 0);

  return el('div', { class: 'card' }, [
    el('h2', { text: 'Mood by phase' }),
    el('p', { class: 'hint-sm', text:
      `What you logged most at each point in your cycle, as a share of the ` +
      `days you recorded a mood. Based on ${plural(total, 'day')}.` }),

    el('ul', { class: 'mood-list' }, rows.map(({ id, data }) => {
      const phase = PHASES[/** @type {'menstrual'} */ (id)];
      const top = (data?.moods ?? []).slice(0, 2);
      const denom = data?.total ?? 1;

      return el('li', { class: 'mood-row' }, [
        el('div', { class: 'mood-head' }, [
          el('span', { class: 'phase-dot', 'aria-hidden': 'true',
                       style: { background: `var(${phase.token})` } }),
          el('strong', { text: phase.name }),
          el('span', { class: 'hint-sm', text: plural(denom, 'day') }),
        ]),
        el('div', { class: 'mood-bars' }, top.map((m) => {
          const pct = Math.round((m.count / denom) * 100);
          return el('div', { class: 'mood-bar-row' }, [
            el('span', { class: 'mood-bar-label', text: labelOf(m.id) }),
            el('span', { class: 'mood-bar-track', 'aria-hidden': 'true' }, [
              el('span', { class: 'mood-bar-fill', style: { width: `${pct}%` } }),
            ]),
            el('span', { class: 'mood-bar-pct num', text: `${pct}%` }),
          ]);
        })),
      ]);
    })),
  ]);
}

/* ── Symptom patterns ───────────────────────────────────────────────────── */

/**
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 * @param {import('../domain/cycles.js').Cycle[]} cycles
 * @param {import('../domain/predict.js').Prediction} prediction
 */
function patternsCard(logs, cycles, prediction) {
  const patterns = detectPatterns(logs, cycles);
  const complete = cycles.filter((c) => c.complete).length;

  if (!patterns.length) {
    return el('div', { class: 'card' }, [
      el('h2', { text: 'Patterns' }),
      el('p', { class: 'hint-sm', text: complete < 3
        ? `Kittycal starts looking for patterns after three complete cycles. ` +
          `You have ${plural(complete, 'so far')}.`
        : 'Nothing recurs reliably enough to call a pattern yet. Keep logging ' +
          'and this fills in.' }),
    ]);
  }

  return el('div', { class: 'card' }, [
    el('h2', { text: 'Patterns' }),
    el('p', { class: 'hint-sm', text:
      `Things that show up in most of your cycles, and where in the cycle they ` +
      `land. Based on ${plural(complete, 'complete cycle')}.` }),

    el('ul', { class: 'pattern-list' }, patterns.map((pattern) => {
      const detail = symptomPattern(pattern.id, logs, cycles);
      const max = Math.max(0, ...detail.byDay.values());
      const label = labelOf(pattern.id);
      const peaks = pattern.peakDays.slice(0, 3);
      const where = peaks.length
        ? `most often on day ${peaks.length > 1
            ? `${peaks.slice(0, -1).join(', ')} and ${peaks[peaks.length - 1]}`
            : peaks[0]}`
        : '';

      return el('li', { class: 'pattern' }, [
        el('div', { class: 'pattern-head' }, [
          el('strong', { text: label }),
          el('span', { class: 'badge num', text:
            `${pattern.cyclesWith}/${pattern.cyclesTotal} cycles` }),
        ]),
        dayHeatmap({
          byDay: detail.byDay,
          cycleLength: prediction.avgCycleLength,
          max,
          summary: `${label} logged in ${pattern.cyclesWith} of ` +
            `${pattern.cyclesTotal} cycles, ${where || 'spread across the cycle'}.`,
        }),
        where && el('span', { class: 'hint-sm', text: `${where[0].toUpperCase()}${where.slice(1)}.` }),
      ]);
    })),
  ]);
}

/* ── BBT ────────────────────────────────────────────────────────────────── */

/**
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 * @param {import('../domain/cycles.js').Cycle[]} cycles
 * @param {import('../domain/model.js').Settings} settings
 */
function bbtCard(logs, cycles, settings) {
  const cycle = currentCycle(cycles);
  if (!cycle) return null;

  const readings = bbtForCycle(logs, cycle);
  if (readings.length < 4) return null;

  const shiftDate = detectThermalShift(
    readings.map((r) => ({ date: r.date, bbt: r.bbt })),
  );
  const shiftPoint = shiftDate ? readings.find((r) => r.date === shiftDate) : null;

  // Coverline: the mean of the six readings before the shift, which is the
  // baseline the rise is measured against.
  let coverline;
  if (shiftPoint) {
    const before = readings.slice(Math.max(0, readings.indexOf(shiftPoint) - 6),
                                 readings.indexOf(shiftPoint));
    if (before.length) coverline = before.reduce((a, r) => a + r.bbt, 0) / before.length;
  }

  const toDisplay = (/** @type {number} */ c) =>
    settings.unitTemp === 'F' ? c * 9 / 5 + 32 : c;

  return el('div', { class: 'card' }, [
    el('h2', { text: 'Basal body temperature' }),
    el('p', { class: 'hint-sm', text: `This cycle, ${plural(readings.length, 'reading')}.` }),
    lineChart({
      data: readings.map((r) => ({ x: r.day, y: toDisplay(r.bbt) })),
      coverline: coverline != null ? toDisplay(coverline) : undefined,
      marker: shiftPoint?.day,
      decimals: settings.unitTemp === 'F' ? 1 : 2,
      summary: shiftPoint
        ? `Temperature chart showing a sustained rise from cycle day ${shiftPoint.day}.`
        : 'Temperature chart for this cycle. No sustained rise detected yet.',
    }),
    shiftPoint
      ? el('div', { class: 'alert alert-ok' }, [
          el('span', { class: 'alert-icon', text: '✓', 'aria-hidden': 'true' }),
          el('div', { text:
            `Your temperature rose on day ${shiftPoint.day} (${fmtDayMonth(shiftPoint.date)}) ` +
            `and stayed up. That normally means ovulation had already happened ` +
            `a day or two earlier — it confirms it after the fact rather than ` +
            `predicting it.` }),
        ])
      : el('p', { class: 'hint-sm', text:
          'No sustained rise yet. Three readings in a row at least 0.2°C above ' +
          'the previous six days would confirm ovulation has happened.' }),
  ]);
}

/* ── Weight and sleep trends ────────────────────────────────────────────── */

/**
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 * @param {import('../domain/model.js').Settings} settings
 */
function trendCard(logs, settings) {
  const weights = series(logs, 'weight').slice(-30);
  const sleeps = series(logs, 'sleep').slice(-30);
  if (weights.length < 3 && sleeps.length < 3) return null;

  return el('div', { class: 'card' }, [
    el('h2', { text: 'Trends' }),

    weights.length >= 3 && el('div', {}, [
      el('p', { class: 'hint-sm', text:
        `Weight, last ${plural(weights.length, 'reading')}. ` +
        `Now ${fmtWeight(weights[weights.length - 1].value, settings.unitWeight)}.` }),
      lineChart({
        data: weights.map((point, i) => ({
          x: i,
          y: settings.unitWeight === 'lb' ? point.value * 2.2046226 : point.value,
        })),
        height: 110,
        decimals: 1,
        summary: `Weight trend over the last ${weights.length} readings.`,
      }),
    ]),

    sleeps.length >= 3 && el('div', { style: { marginTop: 'var(--sp-4)' } }, [
      el('p', { class: 'hint-sm', text:
        `Sleep, last ${plural(sleeps.length, 'night')}. Average ` +
        `${(sleeps.reduce((a, s) => a + s.value, 0) / sleeps.length).toFixed(1)} hours.` }),
      barChart({
        data: sleeps.map((point, i) => ({ label: String(i + 1), value: point.value })),
        height: 110,
        unit: 'h',
        average: sleeps.reduce((a, s) => a + s.value, 0) / sleeps.length,
        summary: `Sleep hours over the last ${sleeps.length} nights.`,
      }),
    ]),
  ]);
}

/* ── Report ─────────────────────────────────────────────────────────────── */

function reportCard() {
  return el('div', { class: 'card' }, [
    el('h2', { text: 'Report for a doctor' }),
    el('p', { class: 'hint-sm', text:
      'A printable summary of your last six months — cycle lengths, period ' +
      'lengths, recurring symptoms and anything outside the typical ranges. ' +
      'Print it, or choose "Save as PDF" in the print dialogue.' }),
    el('button', {
      type: 'button',
      class: 'btn',
      style: { marginTop: 'var(--sp-3)' },
      text: 'Open report',
      onclick: () => { haptic(); openReport(); },
    }),
  ]);
}

function footnote() {
  return el('p', { class: 'hint-sm', style: { textAlign: 'center', marginTop: 'var(--sp-4)' }, text:
    'All of this is calculated on your device from what you have logged. ' +
    'It describes your own history — it is not a diagnosis.' });
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/**
 * @param {string} label
 * @param {string} value
 * @param {string} unit
 */
function stat(label, value, unit) {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'stat-label', text: label }),
    el('span', { class: 'stat-value num', text: value }),
    unit && el('span', { class: 'stat-unit', text: unit }),
  ]);
}

/** @param {number} cycleCount */
function notEnoughYet(cycleCount) {
  return el('div', { class: 'empty' }, [
    spotArt('chart'),
    el('h2', { text: 'Not enough to analyse yet' }),
    el('p', { text: cycleCount === 0
      ? 'Once you have logged a couple of periods, this is where your cycle ' +
        'length, patterns and trends show up.'
      : 'One period logged. After the next one Kittycal can start comparing ' +
        'cycles, and the charts here fill in.' }),
    el('button', {
      type: 'button', class: 'btn', text: 'Go to the calendar',
      onclick: () => { haptic(); store.setView('calendar'); },
    }),
  ]);
}
