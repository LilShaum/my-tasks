// @ts-check
/**
 * report.js — the printable summary for a doctor.
 *
 * Flo's version is Premium and iOS-only. This one is free and works anywhere
 * there's a print dialogue, which on every modern platform includes "Save as
 * PDF" — so it doubles as the PDF export without needing a PDF library.
 *
 * The report deliberately does not look like the app. A clinician gets six
 * months of history as plain tables in black on white: no theme, no mascot, no
 * pastels. print.css strips the rest of the page and prints only this.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 */

import { el, need } from '../utils/dom.js';
import { todayKey, addDays, fmtLong, fmtDayMonth, daysBetween } from '../utils/date.js';
import { plural } from '../utils/fmt.js';
import { buildCycles, cycleLengths, periodLengths, summarize } from '../domain/cycles.js';
import { predict } from '../domain/predict.js';
import { detectPatterns, symptomFrequency, daysLogged } from '../domain/stats.js';
import { labelFor, labelOf, isMood } from '../data/taxonomy.js';
import * as acog from '../domain/acog.js';
import * as store from '../state/store.js';

const MONTHS_COVERED = 6;

/**
 * Build the report into #report-root and trigger the print dialogue.
 */
export function openReport() {
  const host = need('#report-root');
  host.replaceChildren(buildReport());
  host.hidden = false;

  // Let layout settle before the dialogue opens, or the first page can come out
  // mid-render in some browsers.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
      host.hidden = true;
    });
  });
}

function buildReport() {
  const { settings, periodDays, logs } = store.getState();
  const today = todayKey();
  const from = addDays(today, -MONTHS_COVERED * 30);

  const cycles = buildCycles(periodDays);
  const recent = cycles.filter((c) => c.start >= from);
  const lengths = cycleLengths(cycles);
  const periods = periodLengths(cycles, today);
  const prediction = predict({ periodDays, settings, today });
  const stats = summarize(lengths);

  const flags = acog.evaluate({
    cycleLengths: lengths,
    periodLengths: periods,
    daysSinceLastPeriod: prediction.lastStart ? daysBetween(prediction.lastStart, today) : null,
  });

  // Only symptoms logged inside the covered window.
  /** @type {Record<DateKey, import('../domain/model.js').DayLog>} */
  const windowLogs = {};
  for (const [date, log] of Object.entries(logs)) {
    if (date >= from) windowLogs[date] = log;
  }

  return el('article', { class: 'report' }, [
    el('header', { class: 'report-head' }, [
      el('h1', { text: 'Menstrual cycle summary' }),
      el('p', { text:
        `${settings.name ? `${settings.name}. ` : ''}` +
        `Covering ${fmtLong(from)} to ${fmtLong(today)}. ` +
        `Generated ${fmtLong(today)} by Kittycal.` }),
      // Explicit null check, not a truthiness guard: `0 && …` evaluates to 0,
      // which append() would happily render as the text "0".
      settings.birthYear != null && el('p', { text: `Year of birth: ${settings.birthYear}.` }),
      el('p', { text:
        `Birth control: ${birthControlLabel(settings.birthControl)}.` }),
    ]),

    section('At a glance', [
      table([
        ['Cycles recorded (all time)', String(cycles.length)],
        ['Cycles in this period', String(recent.length)],
        ['Days with any log', String(daysLogged(windowLogs))],
        ['Average cycle length', stats.mean != null
          ? `${Math.round(stats.mean)} days (range ${stats.min}–${stats.max})` : '—'],
        ['Cycle-to-cycle variation', stats.spread != null ? `${stats.spread} days` : '—'],
        ['Average period length', periods.length
          ? `${Math.round(periods.reduce((a, b) => a + b, 0) / periods.length)} days` : '—'],
        ['Most recent period started', prediction.lastStart ? fmtLong(prediction.lastStart) : '—'],
      ]),
    ]),

    section('Cycle history', [
      recent.length
        ? table(
            recent.map((cycle) => [
              `${fmtDayMonth(cycle.start)} – ${fmtDayMonth(cycle.periodEnd)}`,
              `${cycle.periodLength} day period`,
              cycle.length != null ? `${cycle.length} day cycle` : 'current cycle',
            ]),
            ['Period dates', 'Bleeding', 'Cycle length'],
          )
        : el('p', { text: 'No cycles recorded in this period.' }),
    ]),

    /*
      Physical symptoms and mood, reported separately.

      They were one table headed "Recurring symptoms", so a clinician read
      "Happy — 3 of 3 cycles" as a presenting complaint sitting alongside
      cramps. Both are worth putting in front of a doctor; they are not the
      same kind of observation, and a report that muddles them reads as
      unserious about the ones that matter.

      `recent`, not `cycles`: the logs passed in are limited to the reported
      window, so counting them against all-time cycles would put a smaller
      numerator over a larger denominator and understate every pattern.
    */
    section('Recurring symptoms', recurringSection(windowLogs, recent, 'symptoms')),

    section('Mood', recurringSection(windowLogs, recent, 'moods')),

    section('Outside typical ranges', [
      flags.length
        ? el('ul', { class: 'report-list' }, flags.map((flag) =>
            el('li', {}, [el('strong', { text: `${flag.title}. ` }), flag.detail]),
          ))
        : el('p', { text:
            `Nothing recorded falls outside the typical ranges used here ` +
            `(cycles ${acog.CYCLE_MIN}–${acog.CYCLE_MAX} days, bleeding ` +
            `${acog.PERIOD_MIN}–${acog.PERIOD_MAX} days).` }),
    ]),

    el('footer', { class: 'report-foot' }, [
      el('p', { text:
        'Ranges referenced are those published by the American College of ' +
        'Obstetricians and Gynecologists. This summary is generated from ' +
        'self-reported data entered by the patient. It is a record of what was ' +
        'logged, not a clinical assessment, and contains no diagnosis.' }),
    ]),
  ]);
}

/**
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 * @param {import('../domain/cycles.js').Cycle[]} cycles
 * @param {'symptoms'|'moods'} kind  moods are reported in their own section
 */
function recurringSection(logs, cycles, kind) {
  const wanted = (/** @type {string} */ id) => (kind === 'moods' ? isMood(id) : !isMood(id));

  const patterns = detectPatterns(logs, cycles, 40).filter((p) => wanted(p.id)).slice(0, 12);
  const frequency = symptomFrequency(logs).filter(({ id }) => wanted(id)).slice(0, 12);

  const noun = kind === 'moods' ? 'moods' : 'symptoms';
  if (!frequency.length) {
    return [el('p', { text: `No ${noun} logged in this period.` })];
  }

  /** @type {Node[]} */
  const out = [];

  if (patterns.length) {
    out.push(el('p', { text:
      'Logged in the majority of complete cycles, with the cycle days on which ' +
      'they most often occurred:' }));
    out.push(table(
      patterns.map((pattern) => [
        labelOf(pattern.id),
        `${pattern.cyclesWith} of ${pattern.cyclesTotal}`,
        // Blank rather than a guess: `peakDays` is empty unless the day
        // genuinely recurs, so there is nothing honest to put here.
        pattern.peakDays.length ? `day ${pattern.peakDays.join(', ')}` : 'no particular day',
      ]),
      ['What was logged', 'Cycles affected', 'Typical cycle day'],
    ));
  }

  out.push(el('p', { text: 'Most frequently logged overall:' }));
  out.push(table(
    frequency.map(({ id, count }) => [
      labelOf(id),
      plural(count, 'day'),
    ]),
    ['What was logged', 'Days logged'],
  ));

  return out;
}

/**
 * @param {string} title
 * @param {(Node|string|null|false)[]} children
 */
function section(title, children) {
  return el('section', { class: 'report-section' }, [
    el('h2', { text: title }),
    ...children,
  ]);
}

/**
 * @param {string[][]} rows
 * @param {string[]} [head]
 */
function table(rows, head) {
  return el('table', { class: 'report-table' }, [
    head && el('thead', {}, [
      el('tr', {}, head.map((cell) => el('th', { text: cell }))),
    ]),
    el('tbody', {}, rows.map((row) =>
      el('tr', {}, row.map((cell) => el('td', { text: cell }))),
    )),
  ]);
}

/** @param {string} id */
function birthControlLabel(id) {
  /** @type {Record<string, string>} */
  const labels = {
    none: 'none', 'pill-combined': 'combined oral contraceptive',
    'pill-mini': 'progestogen-only pill', 'iud-hormonal': 'hormonal IUD',
    'iud-copper': 'copper IUD', implant: 'implant', injection: 'injection',
    patch: 'patch', ring: 'vaginal ring', condoms: 'condoms',
    'fertility-awareness': 'fertility awareness', other: 'other',
  };
  return labels[id] ?? id;
}
