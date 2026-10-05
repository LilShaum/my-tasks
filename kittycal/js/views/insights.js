// @ts-check
/**
 * insights.js — what her own logs say about her body.
 *
 * Everything in here is behind Flo Premium. It's all arithmetic over data she
 * already has, so there's no honest reason for it to cost anything.
 *
 * The rule for a card on this screen: it answers one question she actually has
 * — is my cycle normal, which day is my heaviest, when does the bloating start,
 * do I get PMS, does my cycle affect my sleep — and its title *is* the answer,
 * in a sentence. The chart underneath is the evidence. A card that could only
 * show a count ("141 days tracked") is not on this screen any more: a number
 * she cannot do anything with is not an insight.
 *
 * When there is not enough data for an honest answer, a card says nothing and
 * the "Still to come" list says what it is waiting for.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('../domain/model.js').DayLog} DayLog
 * @typedef {import('../domain/cycles.js').Cycle} Cycle
 */

import { el, replace, haptic } from '../utils/dom.js';
import { todayKey, fmtDayMonth, fmtMonth, addDays, range } from '../utils/date.js';
import { plural, fmtTemp, fmtWeight, mlToOz } from '../utils/fmt.js';
import { buildCycles, cycleLengthPoints, summarize, currentCycle } from '../domain/cycles.js';
import { predict } from '../domain/predict.js';
import { detectThermalShift } from '../domain/ovulation.js';
import { predictionAccuracy, CLOSE_ENOUGH, MIN_SCORED } from '../domain/accuracy.js';
import { phaseFor } from '../domain/phases.js';
import { series, bbtForCycle, daysLogged, loggedIds } from '../domain/stats.js';
import {
  bodyMap, moodCurve, sleepCurve, goesWith, periodFingerprint,
} from '../domain/rhythm.js';
import { labelOf, isMood } from '../data/taxonomy.js';
import * as acog from '../domain/acog.js';
import { trendChart, lineChart } from '../ui/chart.js';
import { rhythmCurve, bodyMapGrid, fingerprint, pairedBars } from '../ui/insight-charts.js';
import { openSheet } from '../ui/sheet.js';
import { spotArt, emblem, momentIcon } from '../ui/mascot.js';
import { openReport } from './report.js';
import { openNotes, noteCount } from './notes.js';
import * as store from '../state/store.js';

/**
 * @typedef {Object} Finding
 * @property {string} icon     a single emoji, for the At a glance list
 * @property {string} text     the finding, as a sentence
 * @property {string} target   id of the card that shows the evidence
 * @property {number} weight   how much she would want to know it
 */

/** @param {HTMLElement} host */
export function renderInsights(host) {
  const { settings, periodDays, logs } = store.getState();
  const today = todayKey();

  const cycles = buildCycles(periodDays);
  const prediction = predict({ periodDays, settings, today, logs });
  const age = acog.ageFrom(settings.birthYear, today);
  const complete = cycles.filter((c) => c.complete).length;

  /*
    Every analysis is run once, up front, because two places read each one:
    its own card, and the At a glance list that picks the strongest few.
  */
  const lengthPoints = cycleLengthPoints(cycles);
  const fp = periodFingerprint(logs, cycles);
  // Moods have their own curve below, so the body map is the body: symptoms
  // and anything she named herself.
  const map = bodyMap(logs, cycles, 16).filter((row) => row.kind !== 'moods');
  const mood = moodCurve(logs, cycles);
  const sleep = sleepCurve(logs, cycles);
  const pairs = goesWith(logs, today);

  /** @type {Finding[]} */
  const findings = [];

  const cards = {
    cycle: cycleCard(logs, cycles, lengthPoints, prediction, age, findings),
    periods: periodsCard(fp, cycles, today, findings),
    body: bodyMapCard(map, findings),
    mood: moodCard(mood, settings.avgPeriodLength, findings),
    sleep: sleepCard(sleep, settings.avgPeriodLength, findings),
    pairs: goesWithCard(pairs, settings, findings),
    bbt: bbtCard(logs, cycles, settings),
    trends: trendCard(logs, settings),
    notes: notesCard(),
    report: reportCard(),
  };

  const evidence = Object.entries(cards).filter(([key, card]) => card && key !== 'report');
  if (!evidence.length && !daysLogged(logs)) {
    replace(host, [notEnoughYet(cycles.length, settings.theme)]);
    return;
  }

  /** @type {[string, (HTMLElement|null)[]][]} */
  const groups = [
    ['Your cycle', [cards.cycle, cards.periods]],
    ['Your rhythm', [cards.body, cards.mood]],
    ['Sleep and water', [cards.sleep, cards.pairs]],
    ['Measurements', [cards.bbt, cards.trends]],
    ['Read and share', [cards.notes, cards.report]],
  ];

  const glance = glanceCard(findings, settings.theme);
  const coming = stillToCome({ cycles, complete, logs, settings, map, mood, sleep, pairs }, !glance && settings.theme);

  replace(host, [
    el('div', { class: 'data-zone' }, [
      /*
        With findings, they lead. Without any yet, what is coming leads
        instead: someone in her first weeks should open this screen to a
        welcome and a plan, not to a lone chart of eleven nights.
      */
      glance ?? coming,

      ...groups.map(([label, group]) => {
        const present = group.filter(Boolean);
        return present.length
          ? el('section', { class: 'insight-group' }, [
              el('h2', { class: 'section-label', text: label }),
              ...present,
            ])
          : null;
      }),

      glance ? coming : null,
      // Only offered once there is a chart to explain. Before that it would be
      // a guide to things she cannot see.
      Object.values(cards).some((card) => card?.querySelector('.chart, .body-map, .fingerprint, .paired-bars'))
        ? readingGuideButton() : null,
      footnote(),
    ]),
  ]);
}

/* ── At a glance ────────────────────────────────────────────────────────── */

/**
 * The strongest few findings, in a sentence each, at the top.
 *
 * For the days she opens Insights with ten seconds to spare. Every line is a
 * finding some card below already makes, so tapping one scrolls to its
 * evidence — this list repeats nothing that is not backed up further down.
 *
 * @param {Finding[]} findings
 * @param {string} themeId
 */
function glanceCard(findings, themeId) {
  const top = [...findings].sort((a, b) => b.weight - a.weight).slice(0, 3);
  if (!top.length) return null;

  return el('section', { class: 'card glance-card' }, [
    el('div', { class: 'glance-head' }, [
      emblem(themeId, { size: 40, className: 'glance-emblem' }),
      el('h2', { class: 'glance-title', text: 'At a glance' }),
    ]),
    el('ul', { class: 'glance-list' }, top.map((finding) => el('li', {}, [
      el('button', {
        type: 'button',
        class: 'glance-item',
        onclick: () => {
          haptic(6);
          document.getElementById(`insight-${finding.target}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      }, [
        momentIcon(finding.icon, 'glance-icon'),
        el('span', { class: 'glance-text', text: finding.text }),
        el('span', { class: 'row-value', 'aria-hidden': 'true', text: '›' }),
      ]),
    ]))),
  ]);
}

/**
 * The shell every finding card shares: the answer as the title, what it rests
 * on underneath, then the evidence.
 *
 * @param {string} id
 * @param {string} title
 * @param {string} basis
 * @param {(Node|null|false|undefined)[]} body
 */
function insightCard(id, title, basis, body) {
  return el('div', { class: 'card insight-card', id: `insight-${id}` }, [
    el('h3', { text: title }),
    basis ? el('p', { class: 'insight-basis', text: basis }) : null,
    ...body,
  ]);
}

/* ── Your cycle ─────────────────────────────────────────────────────────── */

/** Cycles drawn on the chart. A year is about as far back as anyone wants to look. */
const CHART_POINTS = 12;

/** Cycles before the chart is drawn: two dots are a line, not a pattern. */
const CHART_MIN = 3;

/**
 * Is my cycle normal, and is it changing? One card, where there were four.
 *
 * Length, regularity, how far the forecasts have been off, and every past
 * cycle were separate cards, all answering versions of the same question. The
 * answer is the title; the dots are the evidence; the forecast record is one
 * line; the full list folds away.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @param {{start: DateKey, length: number}[]} points
 * @param {import('../domain/predict.js').Prediction} prediction
 * @param {number|null} age
 * @param {Finding[]} findings
 */
function cycleCard(logs, cycles, points, prediction, age, findings) {
  if (!points.length) return null;

  const stats = summarize(points.map((p) => p.length));
  const recent = points.slice(-CHART_POINTS);
  const recentStats = summarize(recent.map((p) => p.length));
  const max = acog.cycleMaxFor(age);
  const outside = recent.filter((p) => !acog.isCycleTypical(p.length, age)).length;

  if (points.length < CHART_MIN) {
    return insightCard('cycle',
      points.length === 1
        ? `Your first full cycle was ${plural(points[0].length, 'day')}`
        : `Your cycles so far: ${points.map((p) => p.length).join(' and ')} days`,
      points.every((p) => acog.isCycleTypical(p.length, age))
        ? `Inside the typical ${acog.CYCLE_MIN} to ${max} days. A chart appears after ${plural(CHART_MIN - points.length, 'more cycle')}.`
        : `Typical is ${acog.CYCLE_MIN} to ${max} days.`,
      []);
  }

  const regularity = prediction.regularity ?? acog.regularity(recentStats.spread ?? 0);
  const range = `${recentStats.min} to ${recentStats.max} days`;
  const same = recentStats.min === recentStats.max;
  const title = regularity === 'regular'
    ? (same ? `Regular: your cycles are all ${plural(recentStats.min ?? 0, 'day')}` : `Regular: your cycles run ${range}`)
    : regularity === 'variable'
      ? `Your cycles move around a little: ${range}`
      : `Your cycles vary quite a lot: ${range}`;

  findings.push({
    icon: '🎀',
    text: regularity === 'regular'
      ? (same ? `Your cycles are all ${plural(recentStats.min ?? 0, 'day')}.` : `Your cycle is regular, ${range}.`)
      : `Your cycles have ranged from ${range}.`,
    target: 'cycle',
    weight: regularity === 'regular' ? 2 : 3.5,
  });

  const record = predictionAccuracy(cycles);

  return insightCard('cycle', title,
    `Your last ${plural(recent.length, 'cycle')}, averaging ${Math.round(recentStats.mean ?? 0)} days. `
      + `The shaded band is the typical ${acog.CYCLE_MIN} to ${max}.`,
    [
      trendChart({
        data: recent.map((point) => ({
          label: fmtMonth(point.start),
          value: point.length,
          flagged: !acog.isCycleTypical(point.length, age),
        })),
        average: stats.mean ?? undefined,
        normalBand: [acog.CYCLE_MIN, max],
        unit: 'd',
        summary: `Your last ${recent.length} cycle lengths, from ${recentStats.min} to `
          + `${recentStats.max} days. `
          + (outside ? `${plural(outside, 'cycle')} outside the typical range.` : 'All within the typical range.'),
      }),
      outside > 0 && el('p', { class: 'hint-sm', text:
        `The ringed ${outside === 1 ? 'dot is a cycle' : 'dots are cycles'} outside the typical range. `
        + 'One now and then is common; several in a row is worth mentioning to a doctor.' }),
      record.total >= MIN_SCORED && el('p', { class: 'insight-note', text: record.hits === record.total
        ? `All ${record.total} of Kittycal's period forecasts landed within ${CLOSE_ENOUGH} days.`
        : `${record.hits} of ${record.total} of Kittycal's period forecasts landed within ${CLOSE_ENOUGH} days.` }),
      cycleList(logs, cycles, prediction.avgCycleLength),
    ]);
}

/**
 * Every past cycle, folded away under the chart. A dot cannot be opened; a row
 * can, which is the route from "that odd one in March" to what she logged in it.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @param {number} average
 */
function cycleList(logs, cycles, average) {
  if (cycles.length < 2) return null;
  const recent = [...cycles].reverse().slice(0, 12);

  return el('details', { class: 'insight-more' }, [
    el('summary', { text: 'See every cycle' }),
    el('ul', { class: 'cycle-list' }, recent.map((cycle) => {
      const running = !cycle.complete || cycle.length == null;
      const delta = running || cycle.length == null ? null : cycle.length - average;
      return el('li', {}, [
        el('button', {
          type: 'button',
          class: 'cycle-row',
          onclick: () => { haptic(); openCycleDetail(logs, cycle, average); },
        }, [
          el('span', { class: 'cycle-row-date', text: fmtDayMonth(cycle.start) }),
          el('span', { class: 'cycle-row-len num', text: running ? 'now' : `${cycle.length}d` }),
          el('span', { class: 'cycle-row-delta num', text: delta == null || Math.abs(delta) <= 1
            ? '' : delta > 0 ? `+${delta}` : String(delta) }),
          el('span', { class: 'cycle-row-period num', text: `${cycle.periodLength}d bleed` }),
          el('span', { class: 'row-value', 'aria-hidden': 'true', text: '›' }),
        ]),
      ]);
    })),
  ]);
}

/**
 * Are my periods getting heavier or longer, and which day is the worst?
 *
 * Each period as a row of dots shaded by flow. The old card was a line of
 * period lengths, which for most people is "5, 5, 5, 5" — flat, and silent
 * about the thing that actually varies, which is how heavy each day was.
 *
 * @param {ReturnType<typeof periodFingerprint>} fp
 * @param {Cycle[]} cycles
 * @param {DateKey} today
 * @param {Finding[]} findings
 */
function periodsCard(fp, cycles, today, findings) {
  if (!fp) return null;

  /*
    A period that is still going is shorter than it will be. Counting it would
    let day two of this month's period read as "your periods are getting
    shorter", so the length findings are worked out from finished periods only
    — it is still drawn, as the top row.
  */
  const current = cycles[cycles.length - 1];
  const ongoing = current && !current.complete && addDays(current.periodEnd, 1) >= today;
  const finished = ongoing ? fp.rows.slice(1) : fp.rows;
  const long = finished.filter((r) => r.length > 7).length;
  const lengths = finished.map((r) => r.length);
  const trend = lengths.length >= 6
    ? (lengths.slice(0, 3).reduce((a, b) => a + b, 0) - lengths.slice(3, 6).reduce((a, b) => a + b, 0)) / 3
    : 0;

  let title = `Your last ${plural(fp.rows.length, 'period')}, day by day`;
  if (long >= 2) {
    title = `${long} of your recent periods lasted more than 7 days`;
    findings.push({ icon: '🩸', text: `${long} recent periods ran past 7 days.`, target: 'periods', weight: 4 });
  } else if (Math.abs(trend) >= 1.5) {
    const days = Math.round(Math.abs(trend));
    title = `Your last 3 periods were about ${plural(days, 'day')} ${trend > 0 ? 'longer' : 'shorter'}`;
    findings.push({ icon: '🩸', text: `Your periods are running ${trend > 0 ? 'longer' : 'shorter'} lately.`, target: 'periods', weight: 3 });
  } else if (fp.heaviestDay) {
    title = `Day ${fp.heaviestDay.day} is usually your heaviest`;
    findings.push({ icon: '🩸', text: `Day ${fp.heaviestDay.day} of your period is usually the heaviest.`, target: 'periods', weight: 1.5 });
  }

  return insightCard('periods', title,
    'One row per period, newest at the top. Darker means heavier.',
    [
      fingerprint({
        rows: fp.rows.map((row) => ({ label: fmtDayMonth(row.start), flows: row.flows })),
        highlightDay: fp.heaviestDay?.day ?? null,
        summary: `Your last ${fp.rows.length} periods: `
          + fp.rows.map((r) => `${fmtDayMonth(r.start)}, ${plural(r.length, 'day')}`).join('; ') + '.',
      }),
      long >= 2 && el('p', { class: 'hint-sm', text:
        'Bleeding for more than 7 days, more than once, is worth mentioning to a doctor. '
        + 'It is in the report below.' }),
    ]);
}

/* ── Your rhythm ────────────────────────────────────────────────────────── */

/** Rows shown before "Show more". Five is what fits on a phone without scrolling the card. */
const MAP_ROWS = 5;

/**
 * Where a row's symptom lands, in words.
 * @param {import('../domain/rhythm.js').When|null} when
 */
function whenText(when) {
  if (!when) return 'Spread through your cycle';
  if (when.where === 'period') {
    return when.from === when.to
      ? `Day ${when.from} of your period`
      : `Days ${when.from} to ${when.to} of your period`;
  }
  if (when.where === 'before') {
    return when.from <= 1 ? 'The day before your period' : `From about ${when.from} days before your period`;
  }
  return 'Around the middle of your cycle';
}

/**
 * When in my cycle does each thing hit?
 *
 * Lined up against her period rather than a day number, so "bloating, from
 * about three days before" is the same claim in a 26-day cycle and a 32-day one.
 *
 * @param {import('../domain/rhythm.js').BodyRow[]} rows
 * @param {Finding[]} findings
 */
function bodyMapCard(rows, findings) {
  if (!rows.length) return null;

  const name = (/** @type {import('../domain/rhythm.js').BodyRow} */ row) =>
    (row.kind === 'custom' ? row.id : labelOf(row.id));

  /*
    The title names the most useful row: one that comes before her period,
    because that is the one she can see coming. Failing that, the most regular.
  */
  const lead = rows.find((r) => r.when?.where === 'before') ?? rows.find((r) => r.when) ?? null;
  let title = rows.some((r) => r.when)
    ? 'What your body does through your cycle'
    : 'What you log most is not tied to your cycle';
  if (lead?.when) {
    const n = name(lead);
    title = lead.when.where === 'before'
      ? `${n} usually starts ${lead.when.from <= 1 ? 'the day' : `about ${lead.when.from} days`} before your period`
      : lead.when.where === 'period'
        ? `${n} usually comes ${lead.when.from === lead.when.to ? `on day ${lead.when.from}` : `on days ${lead.when.from} to ${lead.when.to}`} of your period`
        : `${n} usually shows up mid-cycle`;
    findings.push({ icon: '✨', text: `${title}.`, target: 'body', weight: lead.when.where === 'before' ? 3 : 2 });
  }

  /** @param {import('../domain/rhythm.js').BodyRow[]} list */
  const grid = (list) => bodyMapGrid({
    rows: list.map((row) => ({
      label: name(row),
      sentence: `${whenText(row.when)} · ${row.cyclesWith} of ${row.cyclesTotal} cycles`,
      after: row.after,
      before: row.before,
    })),
    summary: list.map((row) => `${name(row)}: ${whenText(row.when).toLowerCase()}, in ${row.cyclesWith} of ${row.cyclesTotal} cycles.`).join(' '),
  });

  /*
    Something she logs every cycle but at no particular point is still worth
    knowing — "my headaches are not about my cycle" is an answer — but a row of
    pale squares to say so is clutter. It gets one line instead.
  */
  const timed = rows.filter((r) => r.when);
  const untied = rows.filter((r) => !r.when);
  const shown = timed.slice(0, MAP_ROWS);
  const more = timed.slice(MAP_ROWS);

  return insightCard('body', title,
    'Things you log in most cycles, lined up against your period. Darker means more of your cycles.',
    [
      shown.length > 0 && grid(shown),
      more.length > 0 && el('details', { class: 'insight-more' }, [
        el('summary', { text: `Show ${more.length} more` }),
        grid(more),
      ]),
      untied.length > 0 && el('p', { class: 'map-untied', text:
        `Not tied to your cycle: ${untied.map((r) => name(r)).join(', ')}. `
        + 'You log these, but at no particular point in it.' }),
    ]);
}

/**
 * Do I get PMS, and how much?
 *
 * One line: how often a hard mood was logged at each point in her cycle. If the
 * days before her period stand out, the title says so and the stretch is
 * shaded; if they do not, that is a finding too, and the title says that.
 *
 * @param {ReturnType<typeof moodCurve>} curve
 * @param {number} periodDays
 * @param {Finding[]} findings
 */
function moodCard(curve, periodDays, findings) {
  if (!curve) return null;
  const f = curve.finding;

  const title = f
    ? `Harder days bunch up in the ${f.window} days before your period`
    : 'Your mood stays fairly steady through your cycle';
  if (f) {
    findings.push({
      icon: '💭',
      text: `Harder moods come ${times(f.windowRate, f.restRate)} in the days before your period.`,
      target: 'mood',
      weight: 4,
    });
  }

  const pct = (/** @type {(number|null)[]} */ a) => a.map((v) => (v == null ? null : v * 100));

  return insightCard('mood', title,
    `How often you logged a hard mood, like irritable, sad or anxious, at each point in your cycle. `
      + `${plural(curve.cycles, 'cycle')}.`,
    [
      rhythmCurve({
        after: pct(curve.after),
        before: pct(curve.before),
        min: 0, max: 100,
        ticks: [{ value: 0, label: '0%' }, { value: 50, label: '50%' }, { value: 100, label: '100%' }],
        periodDays,
        window: f ? f.window : 0,
        reference: f ? f.restRate * 100 : null,
        referenceLabel: f ? 'the rest of your cycle' : '',
        summary: f
          ? `Hard moods on ${Math.round(f.windowRate * 100)}% of days in the ${f.window} days before your period, `
            + `against ${Math.round(f.restRate * 100)}% the rest of the time.`
          : 'Hard moods are spread fairly evenly through your cycle.',
      }),
      f && el('p', { class: 'hint-sm', text:
        'Lots of people feel this. It comes from progesterone falling just before a period. '
        + 'If it is hard to live with, it is worth raising with a doctor; the report below carries it.' }),
    ]);
}

/**
 * "about twice as often" from two rates.
 * @param {number} a
 * @param {number} b
 */
function times(a, b) {
  if (b <= 0) return 'much more often';
  const r = a / b;
  if (r >= 2.75) return 'about three times as often';
  if (r >= 1.75) return 'about twice as often';
  return 'noticeably more often';
}

/* ── Sleep and water ────────────────────────────────────────────────────── */

/** @param {number} minutes */
function duration(minutes) {
  const m = Math.abs(minutes);
  if (m < 60) return `${m} minutes`;
  const h = Math.floor(m / 60);
  const rest = Math.round((m - h * 60) / 5) * 5;
  return rest ? `${plural(h, 'hour')} ${rest} minutes` : plural(h, 'hour');
}

/**
 * Does my cycle affect my sleep?
 *
 * Average hours at each point in her cycle, on a fixed four-to-ten-hour scale.
 * The old chart fitted its scale to her data, so the difference between 7.5
 * and 8 hours filled the whole card and every night looked like a crisis.
 *
 * @param {ReturnType<typeof sleepCurve>} curve
 * @param {number} periodDays
 * @param {Finding[]} findings
 */
function sleepCard(curve, periodDays, findings) {
  if (!curve) return null;
  const f = curve.finding;

  const title = f
    ? `You sleep about ${duration(f.minutes)} ${f.minutes < 0 ? 'less' : 'more'} the week before your period`
    : 'Your sleep stays steady through your cycle';
  if (f) {
    findings.push({
      icon: '🌙',
      text: `You sleep about ${duration(f.minutes)} ${f.minutes < 0 ? 'less' : 'more'} the week before your period.`,
      target: 'sleep',
      weight: 3.5,
    });
  }

  return insightCard('sleep', title,
    `Average hours slept at each point in your cycle. ${plural(curve.cycles, 'cycle')}.`,
    [
      rhythmCurve({
        after: curve.after,
        before: curve.before,
        min: 4, max: 10,
        ticks: [4, 6, 8, 10].map((h) => ({ value: h, label: `${h}h` })),
        periodDays,
        window: f ? 7 : 0,
        reference: f ? f.restMean : null,
        referenceLabel: f ? 'the rest of your cycle' : '',
        summary: f
          ? `About ${f.windowMean.toFixed(1)} hours a night in the week before your period, `
            + `against ${f.restMean.toFixed(1)} the rest of the time.`
          : 'Your sleep is about the same through your cycle.',
      }),
      f && f.minutes < 0 && el('p', { class: 'hint-sm', text:
        'Common in the days before a period, when progesterone drops and body temperature runs higher. '
        + 'A cooler room and an earlier night can help.' }),
    ]);
}

/**
 * What goes with my bad days?
 *
 * Her own days compared with each other: on short nights or low-water days, how
 * often did a symptom or hard mood show up, against the rest. Only differences
 * that are large and backed by enough days on both sides are shown, and the
 * counts sit next to every bar.
 *
 * @param {ReturnType<typeof goesWith>} items
 * @param {import('../domain/model.js').Settings} settings
 * @param {Finding[]} findings
 */
function goesWithCard(items, settings, findings) {
  if (!items.length) return null;

  const litre = settings.unitWater === 'oz' ? `${Math.round(mlToOz(1000))} oz` : '1 L';
  /** @type {Record<string, {lead: string, yes: string, no: string, icon: string}>} */
  const words = {
    shortSleep: { lead: 'After nights under 6 hours', yes: 'Under 6 hours', no: '6 hours or more', icon: '🌙' },
    lowWater: { lead: `On days under ${litre} of water`, yes: `Under ${litre}`, no: `${litre} or more`, icon: '💧' },
  };
  const outcomeName = (/** @type {string} */ id) => (id === 'hard-mood' ? 'hard moods' : labelOf(id).toLowerCase());

  const sentence = (/** @type {typeof items[number]} */ item) =>
    `${words[item.condition].lead}, ${outcomeName(item.outcome)} showed up ${times(item.rateWith, item.rateWithout)}`;

  const top = items[0];
  findings.push({ icon: words[top.condition].icon, text: `${sentence(top)}.`, target: 'pairs', weight: 3.5 });

  return insightCard('pairs', sentence(top),
    'Your own days, compared. Each bar is how often it happened; the numbers are days.',
    [
      pairedBars({
        groups: items.map((item) => ({
          title: `${outcomeName(item.outcome)[0].toUpperCase()}${outcomeName(item.outcome).slice(1)}`,
          rows: [
            { label: words[item.condition].yes, rate: item.rateWith, hits: item.withHits, n: item.withN, strong: true },
            { label: words[item.condition].no, rate: item.rateWithout, hits: item.withoutHits, n: item.withoutN },
          ],
        })),
        summary: items.map((item) => `${sentence(item)}: ${item.withHits} of ${item.withN} days, `
          + `against ${item.withoutHits} of ${item.withoutN}.`).join(' '),
      }),
      el('p', { class: 'hint-sm', text:
        'These show up together in your logs. That doesn’t mean one causes the other, '
        + 'but it’s worth knowing about.' }),
    ]);
}

/* ── Still to come ──────────────────────────────────────────────────────── */

/**
 * What each missing card is waiting for, in plain numbers.
 *
 * A card that is not there yet should not simply be absent: she would never
 * know it exists, or what to log to see it. Each line names the card and the
 * smallest thing that unlocks it. Silent once everything has arrived.
 *
 * @param {Object} ctx
 * @param {Cycle[]} ctx.cycles
 * @param {number} ctx.complete
 * @param {Record<DateKey, DayLog>} ctx.logs
 * @param {import('../domain/model.js').Settings} ctx.settings
 * @param {import('../domain/rhythm.js').BodyRow[]} ctx.map
 * @param {ReturnType<typeof moodCurve>} ctx.mood
 * @param {ReturnType<typeof sleepCurve>} ctx.sleep
 * @param {ReturnType<typeof goesWith>} ctx.pairs
 * @param {string|false} welcome  a theme id when this card opens the screen
 */
function stillToCome({ cycles, complete, logs, settings, map, mood, sleep, pairs }, welcome) {
  /** @type {string[]} */
  const waiting = [];
  const more = (/** @type {number} */ n) => plural(n, 'more cycle');

  if (complete < CHART_MIN) waiting.push(`Your cycle chart: after ${more(CHART_MIN - complete)}.`);
  if (cycles.length < 2) waiting.push('Your period fingerprint: after your next period.');
  if (!map.length && complete < 3) waiting.push(`When your symptoms hit: after ${more(3 - complete)}.`);
  if (!mood) {
    waiting.push(complete < 3
      ? `Your mood curve: after ${more(3 - complete)}, logging how you feel.`
      : 'Your mood curve: keep answering "How are you feeling?" for a few more weeks.');
  }
  if (!sleep && settings.askSleep) {
    waiting.push(complete < 2
      ? `How your cycle affects your sleep: after ${more(2 - complete)} of sleep logs.`
      : 'How your cycle affects your sleep: about two more weeks of sleep answers.');
  }
  if (!pairs.length && (settings.askSleep || settings.askWater)) {
    waiting.push('What goes with your harder days: once there are a few weeks of sleep and water to compare.');
  }
  if (!daysLogged(logs)) waiting.push('Everything else: once you start logging days.');

  if (!waiting.length) return null;

  return el('div', { class: `card still-card${welcome ? ' is-welcome' : ''}` }, [
    welcome ? el('div', { class: 'glance-head' }, [
      emblem(welcome, { size: 48, className: 'glance-emblem' }),
      el('h2', { class: 'glance-title', text: 'Your insights are on their way' }),
    ]) : el('h3', { text: 'Still to come' }),
    el('ul', { class: 'coming-list' }, waiting.map((line) => el('li', { text: line }))),
    el('p', { class: 'hint-sm', text:
      'Kittycal waits until it has enough data to be sure.' }),
  ]);
}

/* ── Measurements ───────────────────────────────────────────────────────── */

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
    el('h3', { text: 'Basal body temperature' }),
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
            `a day or two earlier. It confirms ovulation after the fact. ` +
            `It can’t predict it.` }),
        ])
      : el('p', { class: 'hint-sm', text:
          'No sustained rise yet. Three readings in a row at least 0.2°C above ' +
          'the previous six days would confirm ovulation has happened.' }),
  ]);
}


/* ── Numeric trends ─────────────────────────────────────────────────────── */

/**
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 * @param {import('../domain/model.js').Settings} settings
 */
function trendCard(logs, settings) {
  const weights = series(logs, 'weight').slice(-30);
  /*
    Weight and steps: the numbers she can log that nothing else reads back.

    Sleep and water used to be here too, as a 30-night line and a sentence
    ("about 1.4 L a day, 9 days under 1 L"). Both already have cards that say
    something about her cycle: sleep through the cycle, and what goes with her
    harder days. Here they were counters, the same data a second time with no
    finding in it (PRODUCT.md, U9). Weight and steps stay because without this
    card a number she typed every morning would never come back to her.
  */
  const steps = series(logs, 'steps').slice(-30);
  if (weights.length < 3 && steps.length < 3) return null;

  return el('div', { class: 'card', id: 'insight-trends' }, [
    el('h3', { text: 'Your recent numbers' }),

    weights.length >= 3 && el('div', {}, [
      el('p', { class: 'hint-sm', text:
        `Weight, last ${plural(weights.length, 'reading')}. ` +
        `Now ${fmtWeight(weights[weights.length - 1].value, settings.unitWeight)}.` }),
      /*
        The same chart as steps below it, not a different one.

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

    steps.length >= 3 && el('div', { style: { marginTop: 'var(--sp-4)' } }, [
      el('p', { class: 'hint-sm', text:
        `Steps, last ${plural(steps.length, 'day')}. Average `
        + `${Math.round(steps.reduce((a, d) => a + d.value, 0) / steps.length).toLocaleString()} a day.` }),
      trendChart({
        data: steps.map((point) => ({ label: fmtDayMonth(point.date), value: point.value })),
        height: 140,
        decimals: 0,
        summary: `Steps over the last ${steps.length} days.`,
      }),
    ]),
  ]);
}


/**
 * What one cycle held.
 *
 * Counts of what was logged rather than a day-by-day dump: the diary already
 * shows any single day, and thirty of those in a sheet is not something anyone
 * reads. Moods are kept apart from physical symptoms for the same reason the
 * doctor report separates them — reading "Happy, 4 days" as a complaint is the
 * exact confusion that separation exists to prevent.
 *
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 * @param {import('../domain/cycles.js').Cycle} cycle
 * @param {number} average
 */
function openCycleDetail(logs, cycle, average) {
  const end = cycle.nextStart ? addDays(cycle.nextStart, -1) : todayKey();
  const days = range(cycle.start, end);

  /** @type {Map<string, number>} */
  const counts = new Map();
  let logged = 0;

  for (const date of days) {
    const log = logs[date];
    if (!log) continue;
    logged += 1;
    for (const id of loggedIds(log)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const symptoms = ranked.filter(([id]) => !isMood(id));
  const moods = ranked.filter(([id]) => isMood(id));

  /** @param {string} title @param {[string, number][]} rows */
  const section = (title, rows) => (rows.length ? el('div', { class: 'guide-entry' }, [
    el('h3', { text: title }),
    el('ul', { class: 'flag-list' }, rows.slice(0, 8).map(([id, n]) =>
      el('li', { text: `${labelOf(id)}: ${plural(n, 'day')}` }))),
  ]) : null);

  const delta = cycle.length == null ? null : cycle.length - average;

  openSheet({
    title: `Cycle from ${fmtDayMonth(cycle.start)}`,
    body: [
      el('p', { class: 'hint-sm', text: [
        cycle.length == null
          ? 'Still running.'
          : `${plural(cycle.length, 'day')} long` +
            (delta != null && Math.abs(delta) > 1
              ? `, ${plural(Math.abs(delta), 'day')} ${delta > 0 ? 'longer' : 'shorter'} than your average.`
              : ', about your average.'),
        `${plural(cycle.periodLength, 'day')} of bleeding.`,
        `${plural(logged, 'day')} logged.`,
      ].join(' ') }),

      section('Symptoms', symptoms),
      section('Mood', moods),

      !ranked.length ? el('p', { class: 'hint', text:
        'Nothing was logged in this cycle beyond the period itself.' }) : null,
    ].filter(Boolean),
  });
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
    el('h3', { text: 'Your notes' }),
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
    el('h3', { text: 'Report for a doctor' }),
    el('p', { class: 'hint-sm', text:
      'A printable summary of your last six months: cycle lengths, period ' +
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
    'It describes your own history, and it is not a diagnosis.' });
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

/**
 * One entry per kind of chart, each explaining the one thing that is not
 * obvious from the chart itself.
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
      entry('Titles',
        'Each card’s title is what your logs say. The chart underneath is the evidence, '
        + 'and the small line under the title says how much data it is based on.'),
      entry('Cycle length',
        'One dot per cycle, oldest on the left. The shaded band is the typical range. '
        + 'A dot outside it is ringed, and the dashed line is your own average.'),
      entry('Periods',
        'Each row is one period, newest at the top, with one dot per day. Darker dots were heavier days. '
        + 'A dotted outline is spotting.'),
      entry('When things hit',
        'Squares on the left are the first days of your period. Squares on the right are the days '
        + 'before your next one. The darker a square, the more of your cycles had it on that day.'),
      entry('Mood and sleep curves',
        'Left is the start of your period, right is the day before the next one. The pink patch on '
        + 'the left is your period; the lilac patch on the right is the stretch the title is about.'),
      entry('What goes with it',
        'Two bars: how often something happened on days with the condition, and on all your other days. '
        + 'The numbers are days, so you can see how much each bar rests on.'),
      el('p', { class: 'hint', text:
        'Nothing here is a diagnosis. It describes what you logged. The typical ranges come from '
        + 'the American College of Obstetricians and Gynecologists.' }),
    ],
  });
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/**
 * The screen before there is anything to show. Cute rather than apologetic:
 * this is the first thing someone sees on day one.
 *
 * @param {number} cycleCount
 * @param {string} themeId
 */
function notEnoughYet(cycleCount, themeId) {
  return el('div', { class: 'empty' }, [
    emblem(themeId, { size: 96, className: 'empty-art' }),
    el('h3', { text: 'Your insights will grow here' }),
    el('p', { text: cycleCount === 0
      ? 'Log your period and answer the daily questions. After a cycle or two, this page '
        + 'starts telling you things about your body you might not have noticed.'
      : 'One period logged. After the next one, Kittycal can start comparing cycles.' }),
    el('button', {
      type: 'button', class: 'btn', text: 'Go to the calendar',
      onclick: () => { haptic(); store.setView('calendar'); },
    }),
  ]);
}
