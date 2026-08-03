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
import { todayKey, fmtDayMonth, fmtMonth, addDays } from '../utils/date.js';
import { plural, listJoin, fmtTemp, fmtWeight } from '../utils/fmt.js';
import {
  buildCycles, cycleLengths, cycleLengthPoints, periodLengthPoints, summarize, currentCycle,
} from '../domain/cycles.js';
import { predict, detectThermalShift } from '../domain/predict.js';
import { phaseFor, PHASES } from '../domain/phases.js';
import {
  detectPatterns, symptomPattern, symptomFrequency, series, bbtForCycle, daysLogged,
  loggingConsistency, moodByPhase, severitySummary, cycleSummary, MIN_CYCLES_FOR_PATTERN,
} from '../domain/stats.js';
import { labelOf, severityLabel } from '../data/taxonomy.js';
import * as acog from '../domain/acog.js';
import { trendChart, lineChart, dayHeatmap } from '../ui/chart.js';
import { openSheet } from '../ui/sheet.js';
import { spotArt } from '../ui/mascot.js';
import { openReport } from './report.js';
import { openNotes, noteCount } from './notes.js';
import * as store from '../state/store.js';

/** @param {HTMLElement} host */
export function renderInsights(host) {
  const { settings, periodDays, logs } = store.getState();
  const today = todayKey();

  const cycles = buildCycles(periodDays);
  const prediction = predict({ periodDays, settings, today });
  const lengths = cycleLengths(cycles);
  const lengthPoints = cycleLengthPoints(cycles);
  const periodPoints = periodLengthPoints(cycles, today);

  /*
    The screen used to refuse to render below two cycles, which meant the
    analysis half of the app was a locked door for the first two months —
    exactly the stretch when someone is deciding whether the app is worth
    keeping. Nothing about that gate was necessary: plenty of what is here
    needs only the days she has already logged.

    So every card decides for itself now, and the cards that need history say
    so by not appearing. The genuine empty state is reserved for a database
    with nothing in it at all.
  */
  const complete = cycles.filter((c) => c.complete).length;

  /*
    Worked out once and handed to both cards, because the plain count card
    stands down for the Patterns card and "enough cycles exist" turned out not
    to mean "patterns were found". Someone four cycles in who only started
    logging symptoms last month has enough history for the threshold and no
    symptom recurring often enough to clear it — gating on the count alone took
    her count card away and gave her nothing in its place.
  */
  const patterns = detectPatterns(logs, cycles);

  const cards = [
    overviewCard(logs, cycles, lengths, today),
    thisCycleCard(logs, cycles, today),
    cycleLengthCard(lengthPoints, prediction),
    periodLengthCard(periodPoints),
    loggedMostCard(logs, patterns.length),
    patternsCard(logs, cycles, prediction, patterns),
    moodCard(logs, cycles, settings),
    bbtCard(logs, cycles, settings),
    trendCard(logs, settings),
    notesCard(),
  ].filter(Boolean);

  if (!cards.length) {
    replace(host, [notEnoughYet(cycles.length)]);
    return;
  }

  replace(host, [
    el('div', { class: 'data-zone' }, [
      // Only offered once there is a chart to explain. Before that it would be
      // a guide to things she cannot see.
      cards.some(hasChart) ? readingGuideButton() : null,
      ...cards,
      comingUpCard(cycles, complete, logs),
      reportCard(),
      footnote(),
    ]),
  ]);
}

/** @param {any} node */
const hasChart = (node) =>
  node instanceof HTMLElement && node.querySelector('.chart, .heatmap');

/* ── Overview ───────────────────────────────────────────────────────────── */

/**
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 * @param {import('../domain/cycles.js').Cycle[]} cycles
 * @param {number[]} lengths
 * @param {DateKey} today
 */
function overviewCard(logs, cycles, lengths, today) {
  // Three zeros under three headings is not an overview of anything.
  if (!cycles.length && !daysLogged(logs)) return null;

  const stats = summarize(lengths);
  /*
    Consistency over a window, not a streak.

    A streak resets to zero the first time she misses a day, and this card is
    the last place that should be showing her a zero — its job is to make the
    history feel worth adding to. A count over the last thirty days moves by
    one when she misses a day and moves back when she catches up.
  */
  const recent = loggingConsistency(logs, today, addDays);
  const total = daysLogged(logs);

  /*
    Only the figures that are saying something.

    All three were unconditional, which read badly in the first fortnight:
    "Cycles 0" is a headline about an absence, and "Days 9 / Last 30 days 9" is
    the same number under two labels — the second only diverges once there is
    history older than a month for it to exclude.
  */
  const figures = [
    cycles.length ? stat('Cycles', String(cycles.length), 'logged') : null,
    stat('Days', String(total), 'tracked'),
    recent < total
      ? stat('Last 30 days', String(recent), recent === 1 ? 'day logged' : 'days logged')
      : null,
  ].filter(Boolean);

  return el('div', { class: 'card' }, [
    el('h2', { text: 'Your history' }),
    el('div', { class: 'stat-row' }, figures),
    stats.mean != null && el('p', { class: 'hint-sm', text:
      `Average cycle ${Math.round(stats.mean)} days, ` +
      `ranging from ${stats.min} to ${stats.max}.` }),
  ]);
}

/* ── Cycle length ───────────────────────────────────────────────────────── */

/**
 * How many points before the x-axis has to start skipping labels.
 *
 * Twelve fits, and a year of cycles is the span worth looking at: further back
 * than that and a change of pattern is history rather than news.
 */
const CHART_POINTS = 12;

/**
 * And how few before a chart is the wrong thing entirely.
 *
 * Two dots joined by a line is not a trend, it is a line — it draws a slope
 * from a single difference and invites her to read a direction into it. Below
 * three, the honest form is a sentence.
 */
const CHART_MIN = 3;

/**
 * @param {{start: DateKey, length: number}[]} points
 * @param {import('../domain/predict.js').Prediction} prediction
 */
function cycleLengthCard(points, prediction) {
  if (!points.length) return null;

  const stats = summarize(points.map((p) => p.length));
  const recent = points.slice(-CHART_POINTS);

  if (points.length < CHART_MIN) {
    return el('div', { class: 'card' }, [
      el('h2', { text: 'Cycle length' }),
      el('p', { text: `${points.length === 1 ? 'Your first cycle was' : 'Your cycles so far:'} ` +
        `${listJoin(points.map((p) => `${p.length} days`))}.` }),
      el('p', { class: 'hint-sm', text:
        points.every((p) => acog.isCycleTypical(p.length))
          ? `That is inside the typical ${acog.CYCLE_MIN}–${acog.CYCLE_MAX} days.`
          : `Typical is ${acog.CYCLE_MIN}–${acog.CYCLE_MAX} days.` }),
    ]);
  }

  const data = recent.map((point) => ({
    // The month it started, rather than its position in a list. "4" is a row
    // number; "Mar" is a thing she can remember.
    label: fmtMonth(point.start),
    value: point.length,
    flagged: !acog.isCycleTypical(point.length),
  }));

  const outside = data.filter((d) => d.flagged).length;

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
      `One dot per cycle, oldest first. Inside the green band is the typical ` +
      `${acog.CYCLE_MIN}–${acog.CYCLE_MAX} days.` }),
    trendChart({
      data,
      average: stats.mean ?? undefined,
      normalBand: [acog.CYCLE_MIN, acog.CYCLE_MAX],
      unit: 'd',
      summary: `Your last ${recent.length} cycle lengths, from ${stats.min} to ` +
        `${stats.max} days, averaging ${Math.round(stats.mean ?? 0)}. ` +
        (outside
          ? `${plural(outside, 'cycle')} outside the typical range.`
          : 'All within the typical range.'),
    }),
    outside > 0 && el('p', { class: 'hint-sm', text:
      `The ringed ${outside === 1 ? 'dot is a cycle' : 'dots are cycles'} outside ` +
      'that range.' }),
    el('div', { class: 'stat-row' }, [
      stat('Average', String(prediction.avgCycleLength), 'days'),
      stat('Variation', String(stats.spread ?? 0), 'days'),
      stat('Pattern', regularity === 'regular' ? 'Regular'
        : regularity === 'variable' ? 'Variable' : 'Irregular', ''),
    ]),
    el('p', { class: 'hint-sm', text: wording[regularity] }),
  ]);
}

/** @param {{start: DateKey, length: number}[]} points */
function periodLengthCard(points) {
  if (!points.length) return null;
  const stats = summarize(points.map((p) => p.length));
  const recent = points.slice(-CHART_POINTS);

  if (points.length < CHART_MIN) {
    return el('div', { class: 'card' }, [
      el('h2', { text: 'Period length' }),
      el('p', { text: `${points.length === 1 ? 'Your last period lasted' : 'Your periods so far:'} ` +
        `${listJoin(points.map((p) => `${p.length} days`))}.` }),
      el('p', { class: 'hint-sm', text:
        `Typical is ${acog.PERIOD_MIN}–${acog.PERIOD_MAX} days of bleeding.` }),
    ]);
  }

  return el('div', { class: 'card' }, [
    el('h2', { text: 'Period length' }),
    el('p', { class: 'hint-sm', text:
      `Days of bleeding per period. Typical is ${acog.PERIOD_MIN}–` +
      `${acog.PERIOD_MAX}.` }),
    trendChart({
      data: recent.map((point) => ({
        label: fmtMonth(point.start),
        value: point.length,
        flagged: !acog.isPeriodTypical(point.length),
      })),
      average: stats.mean ?? undefined,
      normalBand: [acog.PERIOD_MIN, acog.PERIOD_MAX],
      unit: 'd',
      height: 150,
      summary: `Your last ${recent.length} period lengths, from ${stats.min} ` +
        `to ${stats.max} days.`,
    }),
  ]);
}

/* ── Early cards ────────────────────────────────────────────────────────── */

/**
 * What this cycle has held so far.
 *
 * The first card that says anything on day three of using the app. Everything
 * else on this screen compares cycles to each other, which needs cycles to
 * compare — this just counts what is in the one she is in.
 *
 * It keeps appearing once there is a history, because "where am I and what has
 * this one been like" stays a reasonable question after a year.
 *
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 * @param {import('../domain/cycles.js').Cycle[]} cycles
 * @param {DateKey} today
 */
function thisCycleCard(logs, cycles, today) {
  const cycle = currentCycle(cycles);
  if (!cycle) return null;

  const summary = cycleSummary(logs, cycle, today);
  if (!summary.daysLogged) return null;

  /*
    The tally of what came up is only worth printing here once "this cycle" is
    a subset of something. With a single cycle behind her it is every day she
    has ever logged, which the count card below states more usefully — the same
    five things, twice, a screen apart.
  */
  const top = cycles.length > 1 ? summary.logged.slice(0, 6) : [];

  return el('div', { class: 'card' }, [
    el('h2', { text: 'This cycle' }),
    el('p', { class: 'hint-sm', text:
      `Since your period started on ${fmtDayMonth(cycle.start)}.` }),
    el('div', { class: 'stat-row' }, [
      stat('Cycle day', String(summary.day), ''),
      stat('Days logged', String(summary.daysLogged), ''),
      stat('Bleeding', String(summary.bleedingDays), summary.bleedingDays === 1 ? 'day' : 'days'),
    ]),
    top.length ? el('div', { class: 'tally' }, top.map((entry) =>
      el('span', { class: 'badge', text: `${labelOf(entry.id)} ${entry.count}` }))) : null,
  ]);
}

/**
 * What she logs most, over everything she has ever logged.
 *
 * A count is not a pattern and this card is careful never to call it one — but
 * it is true from the first week, which is the entire point. "Cramps, 6 days"
 * is a real thing to know about yourself long before "cramps in 8 of 9 cycles"
 * is available.
 *
 * It steps aside once the Patterns card can speak, because by then the same
 * symptoms are being described better a few centimetres further down.
 *
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 * @param {number} patternCount  how many patterns the card below found
 */
function loggedMostCard(logs, patternCount) {
  if (patternCount > 0) return null;

  const top = symptomFrequency(logs).slice(0, 8);
  if (!top.length) return null;

  const most = top[0].count;

  return el('div', { class: 'card' }, [
    el('h2', { text: 'What you log most' }),
    el('p', { class: 'hint-sm', text:
      'Every day you have recorded, counted up. Not a pattern yet — just what ' +
      'you have written down.' }),
    el('ul', { class: 'tally-list' }, top.map((entry) => el('li', { class: 'tally-row' }, [
      el('span', { class: 'tally-name', text: labelOf(entry.id) }),
      // A track behind each bar, so a short bar reads as a low count rather
      // than as a missing one.
      el('span', { class: 'tally-track' }, [
        el('span', { class: 'tally-fill', style: { width: `${(entry.count / most) * 100}%` } }),
      ]),
      el('span', { class: 'tally-count num', text: String(entry.count) }),
    ]))),
  ]);
}

/**
 * What is not here yet, and exactly what it takes.
 *
 * This replaces the dead end the old empty state was. "Not enough to analyse"
 * with a button to the calendar told her the screen was useless without saying
 * for how long or why, which is the version of this message that gets an app
 * deleted. A specific number of cycles is a much smaller thing to be told.
 *
 * Silent once everything has arrived, rather than congratulating her.
 *
 * @param {import('../domain/cycles.js').Cycle[]} cycles
 * @param {number} complete
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 */
function comingUpCard(cycles, complete, logs) {
  /** @type {string[]} */
  const waiting = [];

  if (complete < 1) {
    waiting.push('your cycle length, once one period follows another');
  } else if (complete < CHART_MIN) {
    waiting.push(`a cycle-length chart, after ${plural(CHART_MIN - complete, 'more cycle')}`);
  }

  if (complete < MIN_CYCLES_FOR_PATTERN) {
    waiting.push(`symptom patterns, after ${plural(MIN_CYCLES_FOR_PATTERN - complete, 'more cycle')}`);
  }

  if (!daysLogged(logs)) {
    waiting.push('everything else, once you start logging days');
  }

  if (!waiting.length) return null;

  return el('div', { class: 'card' }, [
    el('h2', { text: 'Still to come' }),
    el('ul', { class: 'coming-list' },
      waiting.map((line) => el('li', { text: `${line[0].toUpperCase()}${line.slice(1)}.` }))),
    el('p', { class: 'hint-sm', text:
      'Kittycal waits for enough history before calling something a pattern, ' +
      'so what it does say is worth trusting.' }),
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

  // Same reasoning as Patterns: absent rather than apologising for itself.
  if (rows.length < 2) return null;

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
 * @param {import('../domain/stats.js').Pattern[]} patterns
 */
function patternsCard(logs, cycles, prediction, patterns) {
  const complete = cycles.filter((c) => c.complete).length;

  /*
    Nothing to say, so nothing is said.

    This used to render a card headed "Patterns" whose only content explained
    that there were no patterns — which was reasonable when the whole screen
    was otherwise blank, and is clutter now that there is real content above it
    and a "Still to come" card below saying the same thing once. A heading over
    an apology is worse than an absence.
  */
  if (!patterns.length) return null;

  return el('div', { class: 'card' }, [
    el('h2', { text: 'Patterns' }),
    el('p', { class: 'hint-sm', text:
      // The strips are a darkness ramp and nothing said so, which left the
      // one thing they encode to be guessed at.
      `Things that show up in most of your cycles, and where in the cycle they ` +
      `land — darker means more cycles. Based on ` +
      `${plural(complete, 'complete cycle')}.` }),

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
        severityLine(pattern.id, logs),
      ]);
    })),
  ]);
}

/**
 * "Usually mild, severe 3 times" — but only where she has said.
 *
 * Silent unless the symptom was graded, and silent about the days it was not,
 * because severity is optional by design and a line reading "graded on 2 of 14
 * days" would turn an optional field into a chore she is behind on.
 *
 * @param {string} id
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 */
function severityLine(id, logs) {
  const summary = severitySummary(id, logs);
  if (!summary.rated) return null;

  const typical = severityLabel(summary.typical)?.toLowerCase();
  const severe = summary.counts[2];

  // "Usually severe, severe 4 times" says one thing twice.
  const text = severe && summary.typical !== 3
    ? `Usually ${typical}, but severe ${plural(severe, 'time')}.`
    : `Usually ${typical}.`;

  return el('span', { class: 'hint-sm', text });
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
      /*
        The same chart as sleep below it, not a different one.

        Weight used the BBT line chart, which draws hollow markers and numbers
        only its own extremes — so two series doing the identical job, one
        above the other in one card, were drawn in two visual languages. The
        BBT chart keeps its own shape because it genuinely differs: it plots
        against day-of-cycle and carries a coverline.
      */
      trendChart({
        data: weights.map((point) => ({
          label: fmtDayMonth(point.date),
          value: settings.unitWeight === 'lb' ? point.value * 2.2046226 : point.value,
        })),
        height: 140,
        decimals: 1,
        unit: settings.unitWeight,
        summary: `Weight trend over the last ${weights.length} readings.`,
      }),
    ]),

    sleeps.length >= 3 && el('div', { style: { marginTop: 'var(--sp-4)' } }, [
      el('p', { class: 'hint-sm', text:
        `Sleep, last ${plural(sleeps.length, 'night')}. Average ` +
        `${(sleeps.reduce((a, s) => a + s.value, 0) / sleeps.length).toFixed(1)} hours.` }),
      trendChart({
        data: sleeps.map((point) => ({ label: fmtDayMonth(point.date), value: point.value })),
        height: 140,
        unit: 'h',
        decimals: 1,
        average: sleeps.reduce((a, s) => a + s.value, 0) / sleeps.length,
        summary: `Sleep hours over the last ${sleeps.length} nights.`,
      }),
    ]),
  ]);
}

/* ── Report ─────────────────────────────────────────────────────────────── */

/*
  Only appears once she has written something. An empty "Your notes" card on a
  screen she visits to see her data would be one more thing to scroll past for
  everyone who never uses the notes box.
*/
function notesCard() {
  const n = noteCount();
  if (!n) return null;

  return el('div', { class: 'card' }, [
    el('h2', { text: 'Your notes' }),
    el('p', { class: 'hint-sm', text:
      `${plural(n, 'thing')} you have written in the diary. Searchable, newest ` +
      'first, and tapping one opens that day.' }),
    el('button', {
      type: 'button',
      class: 'btn',
      style: { marginTop: 'var(--sp-3)' },
      text: 'Read them back',
      onclick: () => { haptic(); openNotes(); },
    }),
  ]);
}

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

/* ── How to read these ──────────────────────────────────────────────────── */

/**
 * The button that opens the reading guide.
 *
 * Sits above the cards rather than beside a heading. One button for the screen
 * keeps the charts themselves uncluttered, and the alternative — a small mark
 * on each of six cards — would put more chrome on the page than the thing it
 * explains.
 */
function readingGuideButton() {
  return el('button', {
    type: 'button',
    class: 'btn btn-ghost guide-button',
    onclick: () => { haptic(); openReadingGuide(); },
  }, [
    el('span', { class: 'guide-icon', 'aria-hidden': 'true', text: 'i' }),
    el('span', { text: 'How to read these' }),
  ]);
}

/**
 * A short entry per chart, each explaining the one thing that is not obvious.
 *
 * Deliberately not a tutorial. Every chart on the screen already carries a
 * caption saying what it plots; what a caption has no room for is the encoding
 * — that a ringed dot means outside the typical range, that the mood bars are
 * shares rather than counts, that darker strips mean more cycles. Those are
 * the sentences here, and nothing else is.
 */
function openReadingGuide() {
  /** @param {string} title @param {string} body */
  const entry = (title, body) => el('div', { class: 'guide-entry' }, [
    el('h3', { text: title }),
    el('p', { text: body }),
  ]);

  openSheet({
    title: 'How to read these',
    body: [
      entry('Cycle length and period length',
        'One dot per cycle, oldest on the left, labelled with the month it '
        + 'began. The green band is the typical range and its edges are '
        + 'numbered on the left. A dot outside it is ringed and its value '
        + 'written next to it. The dashed line is your own average.'),

      entry('Patterns',
        'One strip per thing you log, running across a whole cycle. Day 1 is '
        + 'the first day of bleeding. The darker a day, the more of your '
        + 'cycles you logged that thing on it.'),

      entry('Mood by phase',
        'The share of days in each phase where you logged that mood — shares, '
        + 'not counts, because the luteal phase is about twice as long as the '
        + 'fertile window and would otherwise win every row by having more '
        + 'days in it.'),

      entry('Temperature',
        'Your waking temperature through the current cycle. A rise that holds '
        + 'for three days suggests ovulation has already happened; the dotted '
        + 'line is the baseline it is measured against.'),

      entry('Weight and sleep',
        'Your recent readings in order. The numbers on the left are the '
        + 'highest and lowest in view, so any dot can be read off them.'),

      el('p', { class: 'hint', text:
        'Nothing here is a diagnosis. It is a description of what you logged, '
        + 'and the ranges it compares against are published by the American '
        + 'College of Obstetricians and Gynecologists.' }),
    ],
  });
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
