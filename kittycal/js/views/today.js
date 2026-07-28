// @ts-check
/**
 * today.js — the home screen.
 *
 * Modelled on Flo's main screen: a big ring in the middle carrying a countdown,
 * the current cycle day, and a row of cards below. The countdown flips — it
 * counts to ovulation while that's ahead, then to the period once ovulation has
 * passed.
 *
 * Design rules in force here:
 *   - The mascot reacts to the *act of logging*, never to what was logged. No
 *     sad face at a heavy day.
 *   - Every number is tabular, carries its unit, and says how confident it is.
 *   - Nothing claims to be medical advice.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 */

import { el, replace, haptic } from '../utils/dom.js';
import { todayKey, fmtDayMonth, fmtRelative, daysBetween } from '../utils/date.js';
import { plural, listJoin } from '../utils/fmt.js';
import { labelFor } from '../data/taxonomy.js';
import { openLogSheet } from './log.js';
import { buildCycles } from '../domain/cycles.js';
import { predict, conceptionChance } from '../domain/predict.js';
import { phaseFor } from '../domain/phases.js';
import { evaluate } from '../domain/acog.js';
import { cycleLengths, periodLengths, summarize } from '../domain/cycles.js';
import { cycleRing, ringLegend } from '../ui/ring.js';
import { mascot, spotArt } from '../ui/mascot.js';
import { getTheme } from '../data/themes.js';
import * as store from '../state/store.js';

/**
 * @param {HTMLElement} host
 */
export function renderToday(host) {
  const state = store.getState();
  const { settings, periodDays, logs } = state;
  const today = todayKey();

  const cycles = buildCycles(periodDays);
  const prediction = predict({ periodDays, settings, today });
  const phase = phaseFor({ date: today, cycles, prediction });
  const theme = getTheme(settings.theme);

  if (!cycles.length) {
    replace(host, [emptyState(settings.name)]);
    return;
  }

  const headline = ringHeadline(prediction);

  replace(host, [
    greeting(settings.name, today),
    cycleRing({
      prediction,
      headline: headline.value,
      caption: headline.caption,
      eyebrow: prediction.cycleDay != null ? `Day ${prediction.cycleDay}` : undefined,
    }),
    ringLegend(prediction),
    el('div', { class: 'section stagger' }, [
      phaseCard(phase, prediction),
      prediction.isLate ? lateCard(prediction) : nextPeriodCard(prediction),
      prediction.showFertility && prediction.ovulation ? fertileCard(prediction, today) : null,
      confidenceCard(prediction),
      regularityCard(prediction, cycles, today),
      ...acogCards(cycles, today, prediction),
      loggedTodayCard(logs[today], theme.particle),
      disclaimerNote(),
    ]),
  ]);
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

/**
 * @param {string} name
 * @param {DateKey} today
 */
function greeting(name, today) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  return el('div', { class: 'today-greeting' }, [
    el('p', { class: 'hint-sm', text: fmtRelative(today).toUpperCase() }),
    el('h2', { text: name ? `${part}, ${name}` : `Good ${part.toLowerCase()}` }),
  ]);
}

/**
 * The big number in the ring. Flips between counting to ovulation and counting
 * to the period, the way Flo's does.
 * @param {import('../domain/predict.js').Prediction} prediction
 */
function ringHeadline(prediction) {
  if (prediction.isLate && prediction.daysLate != null) {
    return {
      value: String(prediction.daysLate),
      caption: prediction.daysLate === 1 ? 'day late' : 'days late',
    };
  }

  const today = todayKey();

  // Count to ovulation while it's still ahead of us.
  if (prediction.showFertility && prediction.ovulation && prediction.ovulation > today) {
    const days = daysBetween(today, prediction.ovulation);
    if (days <= 10) {
      return {
        value: String(days),
        caption: days === 1 ? 'day to ovulation' : 'days to ovulation',
      };
    }
  }

  if (prediction.daysUntilPeriod != null) {
    const days = prediction.daysUntilPeriod;
    if (days === 0) return { value: 'Today', caption: 'period expected' };
    return {
      value: String(days),
      caption: days === 1 ? 'day to your period' : 'days to your period',
    };
  }

  return { value: '—', caption: 'not enough data' };
}

/**
 * @param {import('../domain/phases.js').PhaseInfo} phase
 * @param {import('../domain/predict.js').Prediction} prediction
 */
function phaseCard(phase, prediction) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('span', {
        class: 'phase-dot',
        style: { background: `var(${phase.token})` },
        'aria-hidden': 'true',
      }),
      el('h3', { text: `${phase.name} phase` }),
    ]),
    el('p', { class: 'hint', text: phase.summary }),
  ]);
}

/** @param {import('../domain/predict.js').Prediction} prediction */
function nextPeriodCard(prediction) {
  if (!prediction.nextPeriod) return null;
  const { start, end } = prediction.nextPeriod;

  return el('div', { class: 'card data-zone' }, [
    el('h3', { text: 'Next period' }),
    el('p', { class: 'big-value num', text: `${fmtDayMonth(start)} – ${fmtDayMonth(end)}` }),
    el('p', { class: 'hint-sm', text:
      `Estimated ${prediction.avgPeriodLength}-day period, ` +
      `based on ${prediction.basis}.` }),
  ]);
}

/**
 * Lateness is a first-class state, not a silently redrawn prediction. The copy
 * stays factual and explicitly avoids speculating about why.
 * @param {import('../domain/predict.js').Prediction} prediction
 */
function lateCard(prediction) {
  const days = prediction.daysLate ?? 0;
  return el('div', { class: 'card data-zone' }, [
    el('h3', { text: 'Your period is late' }),
    el('p', { class: 'big-value num', text: plural(days, 'day') }),
    el('p', { class: 'hint-sm', text:
      `Expected around ${prediction.nextStart ? fmtDayMonth(prediction.nextStart) : '—'}. ` +
      'Cycles shift for all sorts of ordinary reasons — stress, travel, illness, ' +
      'a change in sleep. Kittycal will update once you log your next period.' }),
  ]);
}

/**
 * @param {import('../domain/predict.js').Prediction} prediction
 * @param {DateKey} today
 */
function fertileCard(prediction, today) {
  if (!prediction.fertileWindow || !prediction.ovulation) return null;
  const chance = conceptionChance(prediction, today);

  return el('div', { class: 'card data-zone' }, [
    el('h3', { text: 'Fertile window' }),
    el('p', { class: 'big-value num', text:
      `${fmtDayMonth(prediction.fertileWindow.start)} – ${fmtDayMonth(prediction.fertileWindow.end)}` }),
    el('p', { class: 'hint-sm', text:
      `Ovulation estimated ${fmtDayMonth(prediction.ovulation)}. Today: ${chance.label.toLowerCase()}.` }),
    prediction.fertileWidened && el('div', { class: 'alert alert-warn', style: { marginTop: 'var(--sp-3)' } }, [
      el('span', { class: 'alert-icon', text: '!', 'aria-hidden': 'true' }),
      el('div', { text:
        'This window is deliberately wide. There is not enough cycle history yet ' +
        'to narrow it down, and a narrow window here would look more certain ' +
        'than it is.' }),
    ]),
  ]);
}

/** @param {import('../domain/predict.js').Prediction} prediction */
function confidenceCard(prediction) {
  /** @type {Record<string, {label: string, text: string, tone: string}>} */
  const copy = {
    none: {
      label: 'No prediction yet',
      tone: 'alert-info',
      text: 'Log a period and Kittycal can start forecasting.',
    },
    low: {
      label: 'Low confidence',
      tone: 'alert-warn',
      text: `Working from ${plural(prediction.cyclesLogged, 'complete cycle')}. ` +
        'Predictions will tighten up over the next couple of months.',
    },
    medium: {
      label: 'Getting there',
      tone: 'alert-info',
      text: `Working from ${plural(prediction.cyclesLogged, 'complete cycle')}. ` +
        'Another cycle or two and this gets noticeably sharper.',
    },
    high: {
      label: 'Good confidence',
      tone: 'alert-ok',
      text: `Based on ${plural(prediction.cyclesLogged, 'complete cycle')}` +
        (prediction.recalibrated
          ? ', recently re-anchored because your cycle length changed and stayed changed.'
          : '.'),
    },
  };

  const info = copy[prediction.confidence];
  return el('div', { class: `alert ${info.tone}` }, [
    el('span', { class: 'alert-icon', text: 'i', 'aria-hidden': 'true' }),
    el('div', {}, [el('strong', { text: `${info.label}. ` }), info.text]),
  ]);
}

/**
 * @param {import('../domain/predict.js').Prediction} prediction
 * @param {import('../domain/cycles.js').Cycle[]} cycles
 * @param {DateKey} today
 */
function regularityCard(prediction, cycles, today) {
  const lengths = cycleLengths(cycles);
  if (lengths.length < 2) return null;
  const stats = summarize(lengths);
  if (stats.min == null || stats.max == null) return null;

  /** @type {Record<string, string>} */
  const wording = {
    regular: 'Your cycles are consistent.',
    variable: 'Your cycles move around a little.',
    irregular: 'Your cycles vary quite a lot.',
  };

  return el('div', { class: 'card data-zone' }, [
    el('h3', { text: 'Cycle length' }),
    el('div', { class: 'stat-row' }, [
      stat('Average', `${prediction.avgCycleLength}`, 'days'),
      stat('Shortest', `${stats.min}`, 'days'),
      stat('Longest', `${stats.max}`, 'days'),
    ]),
    el('p', { class: 'hint-sm', text:
      `${wording[prediction.regularity ?? 'regular']} ` +
      `Measured across ${plural(lengths.length, 'cycle')}.` }),
  ]);
}

/**
 * @param {string} label
 * @param {string} value
 * @param {string} unit
 */
function stat(label, value, unit) {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'stat-label', text: label }),
    el('span', { class: 'stat-value num', text: value }),
    el('span', { class: 'stat-unit', text: unit }),
  ]);
}

/**
 * ACOG-based prompts. Framed as things worth raising with a doctor, never as
 * findings — this is not a screening tool and doesn't pretend to be.
 * @param {import('../domain/cycles.js').Cycle[]} cycles
 * @param {DateKey} today
 * @param {import('../domain/predict.js').Prediction} prediction
 */
function acogCards(cycles, today, prediction) {
  const flags = evaluate({
    cycleLengths: cycleLengths(cycles),
    periodLengths: periodLengths(cycles, today),
    daysSinceLastPeriod: prediction.lastStart ? daysBetween(prediction.lastStart, today) : null,
  });

  if (!flags.length) return [];

  return [
    el('div', { class: 'card data-zone' }, [
      el('h3', { text: 'Worth mentioning to a doctor' }),
      el('p', { class: 'hint-sm', text:
        'These are observations from your own logs, measured against the ' +
        'typical ranges published by ACOG. They are not a diagnosis and not a ' +
        'cause for alarm — just things a professional is better placed to ' +
        'interpret than an app.' }),
      el('ul', { class: 'flag-list' }, flags.map((flag) =>
        el('li', {}, [
          el('strong', { text: flag.title }),
          el('span', { class: 'hint-sm', text: flag.detail }),
        ]),
      )),
    ]),
  ];
}

/**
 * The one place the mascot appears on this screen, and it responds only to
 * whether she logged — never to what she logged.
 * @param {import('../domain/model.js').DayLog|undefined} log
 * @param {string} particle
 */
function loggedTodayCard(log, particle) {
  const logged = log != null;
  const today = todayKey();

  return el('div', { class: 'card log-nudge' }, [
    el('div', { class: 'decorative' }, [mascot(store.getState().settings.theme, { size: 52 })]),
    el('div', { style: { flex: '1' } }, [
      el('h3', { text: logged ? 'Logged for today' : 'Nothing logged today' }),
      el('p', { class: 'hint-sm', text: logged
        ? summariseLog(log)
        : 'Flow, symptoms, mood — whatever you feel like recording.' }),
    ]),
    el('button', {
      type: 'button',
      class: 'btn',
      style: { minHeight: '40px', padding: '0 var(--sp-4)', fontSize: 'var(--fs-sm)' },
      text: logged ? 'Edit' : 'Log',
      onclick: () => { haptic(); openLogSheet(today); },
    }),
  ]);
}

/**
 * A factual one-liner about what's recorded. Deliberately no praise and no
 * commentary — the app doesn't have an opinion about her day.
 * @param {import('../domain/model.js').DayLog} log
 */
function summariseLog(log) {
  /** @type {string[]} */
  const bits = [];
  if (log.flow !== 'none') bits.push(labelFor('flow', log.flow).toLowerCase());
  const chips = log.symptoms.length + log.moods.length + log.discharge.length
    + log.activity.length + log.other.length + log.sex.length + log.custom.length;
  if (chips) bits.push(`${chips} ${chips === 1 ? 'entry' : 'entries'}`);
  if (log.bbt != null) bits.push('temperature');
  if (log.notes.trim()) bits.push('a note');
  return bits.length ? `${listJoin(bits)}.` : 'You can add to it any time.';
}

function disclaimerNote() {
  return el('p', { class: 'hint-sm', style: { 'text-align': 'center', 'margin-top': 'var(--sp-4)' }, text:
    'Predictions are estimates from your own logs. Not contraception, and not ' +
    'medical advice.' });
}

/** @param {string} name */
function emptyState(name) {
  return el('div', { class: 'empty' }, [
    spotArt('calendar'),
    el('h3', { text: name ? `Hi ${name}!` : 'Nothing logged yet' }),
    el('p', { text:
      'Mark the days of your last period on the calendar and Kittycal can ' +
      'start working out your cycle. A rough guess is enough to begin with.' }),
    el('button', {
      type: 'button',
      class: 'btn',
      text: 'Open the calendar',
      onclick: () => { haptic(); store.setView('calendar'); },
    }),
  ]);
}
