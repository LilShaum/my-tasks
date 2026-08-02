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
import { addDays } from '../utils/date.js';

/** @typedef {'menstrual'|'follicular'|'ovulatory'|'luteal'|'unknown'|'overdue'|'suppressed'} PhaseId */

/**
 * @typedef {Object} PhaseInfo
 * @property {PhaseId} id
 * @property {string} name
 * @property {string} heading   the full headline, because two of these are not
 *                             phases at all and "Not enough data phase" is what
 *                             you get from appending the word in the view
 * @property {string} summary   what's happening, plainly
 * @property {string} token     the CSS custom property to colour it with
 */

/** @type {Record<PhaseId, PhaseInfo>} */
export const PHASES = {
  menstrual: {
    id: 'menstrual',
    name: 'Period',
    heading: 'Your period',
    summary:
      'The lining of your uterus is shedding. Cramps, tiredness and a lower ' +
      'mood are all common in these few days.',
    token: '--period',
  },
  follicular: {
    id: 'follicular',
    name: 'Follicular',
    heading: 'Follicular phase',
    summary:
      'Oestrogen is climbing as your body prepares an egg. Energy and mood ' +
      'often pick up through this stretch.',
    token: '--fertile-soft',
  },
  ovulatory: {
    id: 'ovulatory',
    name: 'Ovulatory',
    heading: 'Ovulatory phase',
    summary:
      'An egg is released around now. You may notice clearer, stretchier ' +
      'discharge and a higher sex drive. This is the fertile part of the cycle.',
    token: '--ovulation',
  },
  luteal: {
    id: 'luteal',
    name: 'Luteal',
    heading: 'Luteal phase',
    summary:
      'Progesterone rises and then falls if there is no pregnancy. PMS ' +
      'symptoms — sore breasts, bloating, mood shifts — usually show up here.',
    token: '--luteal',
  },
  unknown: {
    id: 'unknown',
    name: 'Not enough data',
    heading: 'Not enough data yet',
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
  /*
    Hormonal contraception, between bleeds.

    The app already refuses to predict ovulation on a hormonal method, on the
    grounds that it is not happening and a prediction would be worse than
    nothing. The phase copy did not follow that logic through: it went on
    telling her that oestrogen was climbing "as your body prepares an egg" and
    that "an egg is released around now", which is the exact claim the fertility
    rule exists to avoid making — and it is the reading someone would take at
    face value, because it is stated as fact rather than prediction.
  */
  suppressed: {
    id: 'suppressed',
    name: 'Between periods',
    heading: 'Between periods',
    summary:
      'Hormonal contraception stops ovulation, so the usual follicular and ' +
      'luteal phases do not apply. Bleeding is still tracked as normal.',
    token: '--line-soft',
  },
  overdue: {
    id: 'overdue',
    name: 'Past your expected date',
    heading: 'Past your expected date',
    summary:
      'Your period was expected before now, so Kittycal cannot say which phase ' +
      'you are in. Logging it when it arrives puts everything back on track.',
    token: '--line-soft',
  },
};

/**
 * How many days before and after ovulation count as the fertile window.
 *
 * Same figures `predict.js` uses forward; repeated rather than imported
 * because phases.js is imported *by* the prediction path and a cycle between
 * the two modules would be worse than two constants.
 */
const FERTILE_BEFORE = 5;
const FERTILE_AFTER = 1;

/**
 * The phase a *past* date fell in, worked out from its own cycle.
 *
 * `phaseFor` answers "where am I now" and is anchored to the current
 * prediction — it deliberately returns `unknown` for anything before the last
 * period started. That makes it the wrong tool for looking backwards: walking
 * a historical 28-day cycle through it returns `unknown` for 23 of the 28
 * days, so anything built on it would have charted almost nothing.
 *
 * This looks at the cycle the date actually belongs to. It needs a *complete*
 * cycle, because the ovulation estimate counts backwards from the next
 * period's start — which is exactly the reason the estimate is worth trusting
 * in hindsight, when the next period is a fact rather than a forecast.
 *
 * @param {DateKey} date
 * @param {Cycle} cycle          the cycle containing `date`; must be complete
 * @param {number} lutealDays
 * @returns {PhaseInfo}
 */
export function phaseInCycle(date, cycle, lutealDays) {
  if (!cycle.complete || !cycle.nextStart) return PHASES.unknown;
  if (date < cycle.start || date >= cycle.nextStart) return PHASES.unknown;

  if (date <= cycle.periodEnd) return PHASES.menstrual;

  const ovulation = addDays(cycle.nextStart, -lutealDays);
  const fertileStart = addDays(ovulation, -FERTILE_BEFORE);
  const fertileEnd = addDays(ovulation, FERTILE_AFTER);

  // A short cycle can put the estimated fertile window inside the period
  // itself. The bleeding is a fact and the estimate is not, so the fact wins
  // and the days after it are simply follicular.
  if (fertileStart <= cycle.periodEnd) {
    return date > ovulation ? PHASES.luteal : PHASES.follicular;
  }

  if (date < fertileStart) return PHASES.follicular;
  if (date <= fertileEnd) return PHASES.ovulatory;
  return PHASES.luteal;
}

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

  // Naming follicular, ovulatory or luteal to someone whose ovulation is
  // suppressed would state as fact the very thing the fertility rule refuses
  // to predict. The bleeding above is still hers; the cycle around it is not.
  if (prediction.onHormonal) return PHASES.suppressed;

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
