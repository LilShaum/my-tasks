// @ts-check
/**
 * phases.js — which phase of the cycle a given day falls in.
 *
 * Four phases, in the order they occur: menstrual, follicular, ovulatory,
 * luteal. Boundaries come from the same predictions the rest of the app uses,
 * so the phase shown on the Today screen always agrees with the calendar.
 *
 * When fertility output is suppressed — a hormonal method, or she's turned it
 * off — the ovulatory phase doesn't exist and the whole post-period stretch
 * reads as follicular. That's deliberate: inventing an ovulatory phase for
 * someone whose ovulation is suppressed would be dressing up a guess.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./predict.js').Prediction} Prediction
 * @typedef {import('./cycles.js').Cycle} Cycle
 */

import { isPeriodDay } from './cycles.js';

/** @typedef {'menstrual'|'follicular'|'ovulatory'|'luteal'|'unknown'|'overdue'} PhaseId */

/**
 * @typedef {Object} PhaseInfo
 * @property {PhaseId} id
 * @property {string} name
 * @property {string} summary   what's happening, plainly
 * @property {string} token     the CSS custom property to colour it with
 */

/** @type {Record<PhaseId, PhaseInfo>} */
export const PHASES = {
  menstrual: {
    id: 'menstrual',
    name: 'Period',
    summary:
      'The lining of your uterus is shedding. Cramps, tiredness and a lower ' +
      'mood are all common in these few days.',
    token: '--period',
  },
  follicular: {
    id: 'follicular',
    name: 'Follicular',
    summary:
      'Oestrogen is climbing as your body prepares an egg. Energy and mood ' +
      'often pick up through this stretch.',
    token: '--fertile-soft',
  },
  ovulatory: {
    id: 'ovulatory',
    name: 'Ovulatory',
    summary:
      'An egg is released around now. You may notice clearer, stretchier ' +
      'discharge and a higher sex drive. This is the fertile part of the cycle.',
    token: '--ovulation',
  },
  luteal: {
    id: 'luteal',
    name: 'Luteal',
    summary:
      'Progesterone rises and then falls if there is no pregnancy. PMS ' +
      'symptoms — sore breasts, bloating, mood shifts — usually show up here.',
    token: '--luteal',
  },
  unknown: {
    id: 'unknown',
    name: 'Not enough data',
    summary:
      'Log a period and Kittycal can start working out where you are in your ' +
      'cycle.',
    token: '--line-soft',
  },
  /*
    Distinct from `unknown`, which is the brand-new-user state. Someone whose
    period is well overdue has logged plenty — telling her to "log a period so
    Kittycal can start working out where you are" would be both wrong and
    faintly insulting. What is true is that the model has run past its own
    prediction and no longer knows.

    The copy deliberately does not speculate about why. Naming causes on a
    screen someone opens while waiting for a late period is not this app's job.
  */
  overdue: {
    id: 'overdue',
    name: 'Past your expected date',
    summary:
      'Your period was expected before now, so Kittycal cannot say which phase ' +
      'you are in. Logging it when it arrives puts everything back on track.',
    token: '--line-soft',
  },
};

/**
 * Which phase a date falls in.
 *
 * @param {Object} input
 * @param {DateKey} input.date
 * @param {Cycle[]} input.cycles
 * @param {Prediction} input.prediction
 * @returns {PhaseInfo}
 */
export function phaseFor({ date, cycles, prediction }) {
  // Actual logged bleeding always wins over any prediction.
  if (isPeriodDay(cycles, date)) return PHASES.menstrual;

  if (!prediction.lastStart || date < prediction.lastStart) return PHASES.unknown;

  // Once the history has gone stale there is no cycle to be at a point in.
  // Naming a phase here asserted things like "luteal phase" 431 days after the
  // last logged period, which is not a claim any data supports.
  if (prediction.stale) return PHASES.unknown;

  /*
    Past the expected start, every extra day is a day the model did not
    predict. A few days late is still plausibly luteal — luteal length varies
    by a day or two either way. Being late by longer than an entire luteal
    phase is not: whatever is happening, she is definitionally not still in
    the two-week window that was supposed to end with a period.
  */
  if (prediction.isLate && (prediction.daysLate ?? 0) > prediction.lutealDays) {
    return PHASES.overdue;
  }

  const { ovulation, fertileWindow, nextStart } = prediction;

  if (prediction.showFertility && ovulation && fertileWindow) {
    if (date >= fertileWindow.start && date <= fertileWindow.end) return PHASES.ovulatory;
    if (date > fertileWindow.end && (!nextStart || date < nextStart)) return PHASES.luteal;
    if (date > ovulation) return PHASES.luteal;
    return PHASES.follicular;
  }

  // No fertility output: everything between periods is follicular-ish. Say
  // "follicular" rather than inventing a luteal boundary we can't locate.
  return PHASES.follicular;
}

/**
 * Phase boundaries for the current cycle, for drawing the cycle ring.
 * Percentages of the cycle, so the ring doesn't need date maths.
 *
 * @param {Prediction} prediction
 * @returns {{id: PhaseId, from: number, to: number}[]} fractions 0..1
 */
export function ringSegments(prediction) {
  const total = prediction.avgCycleLength;
  if (!total) return [];

  /** @type {{id: PhaseId, from: number, to: number}[]} */
  const segments = [];
  const frac = (/** @type {number} */ day) => Math.min(1, Math.max(0, day / total));

  const periodEnd = prediction.avgPeriodLength;
  segments.push({ id: 'menstrual', from: 0, to: frac(periodEnd) });

  if (prediction.showFertility && prediction.ovulation && prediction.nextStart) {
    // Day-of-cycle for the fertile window, derived from the luteal length so it
    // matches the dates exactly.
    const ovulationDay = total - prediction.lutealDays;
    const fertileStart = Math.max(periodEnd, ovulationDay - prediction.fertileBefore);
    const fertileEnd = Math.min(total, ovulationDay + 1);

    if (fertileStart > periodEnd) {
      segments.push({ id: 'follicular', from: frac(periodEnd), to: frac(fertileStart) });
    }
    segments.push({ id: 'ovulatory', from: frac(fertileStart), to: frac(fertileEnd) });
    segments.push({ id: 'luteal', from: frac(fertileEnd), to: 1 });
  } else {
    segments.push({ id: 'follicular', from: frac(periodEnd), to: 1 });
  }

  return segments;
}
