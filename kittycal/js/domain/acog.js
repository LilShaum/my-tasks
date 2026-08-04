// @ts-check
/**
 * acog.js — normal-range thresholds.
 *
 * Flo benchmarks its cycle widgets against ACOG guidance, and those ranges are
 * published, so we can use the real numbers rather than inventing our own.
 *
 * Source: American College of Obstetricians and Gynecologists, "Your First
 * Period" / "Abnormal Uterine Bleeding" patient FAQs, and ACOG Committee
 * Opinion 651 (Menstruation in Girls and Adolescents: Using the Menstrual
 * Cycle as a Vital Sign).
 *
 * These drive an honest "worth mentioning to a doctor" prompt. They are
 * emphatically not a diagnosis — the copy that uses them says so, and points
 * at a professional rather than a conclusion.
 */

/** Typical adult cycle length, first day to first day. */
export const CYCLE_MIN = 21;
export const CYCLE_MAX = 35;

/** Typical bleed duration. */
export const PERIOD_MIN = 2;
export const PERIOD_MAX = 7;

/**
 * Cycle-to-cycle variation. ACOG treats a spread of more than 7–9 days between
 * a person's shortest and longest cycle as worth investigating.
 */
export const VARIATION_REGULAR = 7;
export const VARIATION_IRREGULAR = 9;

/** No bleeding for this long, with cycles previously established. */
export const AMENORRHEA_DAYS = 90;

/**
 * @typedef {Object} Flag
 * @property {string} id
 * @property {string} title      plain statement of the observation
 * @property {string} detail     what it means, non-diagnostic
 */

/** Spotting has to recur across at least this many cycles to be a pattern. */
export const SPOTTING_MIN_CYCLES = 2;

/** And total at least this many days, so two stray marks are not a finding. */
export const SPOTTING_MIN_DAYS = 3;

/**
 * Evaluate cycle statistics against the ranges above.
 *
 * Deliberately conservative: it reports what was *observed* ("your cycles have
 * ranged from 19 to 41 days"), never what it might mean clinically, and always
 * ends by pointing at a clinician. It also stays quiet until there's enough
 * data to say anything — three cycles minimum.
 *
 * @param {Object} stats
 * @param {number[]} stats.cycleLengths
 * @param {number[]} stats.periodLengths
 * @param {number|null} stats.daysSinceLastPeriod
 * @param {{days: number, cycles: number}} [stats.spotting] bleeding logged
 *   outside a period, and how many cycles it spanned
 * @returns {Flag[]}
 */
export function evaluate({ cycleLengths, periodLengths, daysSinceLastPeriod, spotting }) {
  /** @type {Flag[]} */
  const flags = [];

  /*
    Bleeding between periods.

    ACOG lists it alongside the cycle-length and duration deviations, and Apple
    Health notifies on it, and Kittycal flagged the other four and simply had
    no opinion on this one — despite storing the exact observation it needs.
    Spotting is already kept separate from period days precisely so that it
    can be counted on its own.

    Two cycles, not one. A single cycle with a few spots is unremarkable; the
    same thing in two separate cycles is the pattern that has a name.
  */
  if (spotting && spotting.cycles >= SPOTTING_MIN_CYCLES && spotting.days >= SPOTTING_MIN_DAYS) {
    flags.push({
      id: 'spotting',
      title: `Bleeding between periods on ${spotting.days} days, across `
        + `${spotting.cycles} cycles`,
      detail: 'Spotting outside a period now and then is common, but when it '
        + 'keeps happening it is one of the things worth mentioning at an '
        + 'appointment.',
    });
  }

  if (cycleLengths.length >= 3) {
    const short = cycleLengths.filter((n) => n < CYCLE_MIN).length;
    const long = cycleLengths.filter((n) => n > CYCLE_MAX).length;
    const min = Math.min(...cycleLengths);
    const max = Math.max(...cycleLengths);

    if (short >= 2) {
      flags.push({
        id: 'cycle-short',
        title: `${short} of your cycles were shorter than ${CYCLE_MIN} days`,
        detail: `A typical adult cycle runs ${CYCLE_MIN}–${CYCLE_MAX} days. ` +
          'Consistently shorter cycles are something a doctor can look into.',
      });
    }
    if (long >= 2) {
      flags.push({
        id: 'cycle-long',
        title: `${long} of your cycles were longer than ${CYCLE_MAX} days`,
        detail: `A typical adult cycle runs ${CYCLE_MIN}–${CYCLE_MAX} days. ` +
          'Consistently longer cycles are worth raising at an appointment.',
      });
    }
    if (max - min > VARIATION_IRREGULAR) {
      flags.push({
        id: 'variation',
        title: `Your cycles have ranged from ${min} to ${max} days`,
        detail: `A spread wider than about ${VARIATION_IRREGULAR} days between ` +
          'your shortest and longest cycle counts as irregular. It is common, ' +
          'and it is also the kind of thing worth mentioning.',
      });
    }
  }

  if (periodLengths.length >= 3) {
    const heavy = periodLengths.filter((n) => n > PERIOD_MAX).length;
    if (heavy >= 2) {
      flags.push({
        id: 'period-long',
        title: `${heavy} of your periods lasted more than ${PERIOD_MAX} days`,
        detail: `Bleeding usually lasts ${PERIOD_MIN}–${PERIOD_MAX} days. ` +
          'Longer or heavier bleeding has causes that are very treatable, so ' +
          'it is worth asking about.',
      });
    }
  }

  if (daysSinceLastPeriod != null && daysSinceLastPeriod >= AMENORRHEA_DAYS) {
    flags.push({
      id: 'no-period',
      title: `It has been ${daysSinceLastPeriod} days since your last logged period`,
      detail: 'Three months without a period, when you are not pregnant or on ' +
        'a method that stops them, is a good reason to book an appointment.',
    });
  }

  return flags;
}

/**
 * Is a single cycle length inside the typical range?
 * @param {number} days
 */
export const isCycleTypical = (days) => days >= CYCLE_MIN && days <= CYCLE_MAX;

/**
 * @param {number} days
 */
export const isPeriodTypical = (days) => days >= PERIOD_MIN && days <= PERIOD_MAX;

/**
 * Describe regularity from the spread between shortest and longest cycle.
 * @param {number} spread
 * @returns {'regular'|'variable'|'irregular'}
 */
export function regularity(spread) {
  if (spread <= VARIATION_REGULAR) return 'regular';
  if (spread <= VARIATION_IRREGULAR) return 'variable';
  return 'irregular';
}
