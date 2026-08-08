// @ts-check
/**
 * ovulation.js — when it actually happened, and what that says about her.
 *
 * Every fertile window in the app is `next period − luteal length`, and until
 * now that luteal length was a number in Settings defaulting to 14 that nobody
 * had ever checked against her. Fourteen is the population average. Real luteal
 * phases run roughly 10 to 16 days and are far more stable *within* a person
 * than between people — which is exactly what makes the assumption both
 * tempting and wrong: it is stable, so an error in it is a systematic error,
 * repeated identically every cycle, in the one number the app offers for
 * planning around.
 *
 * Meanwhile the app was already collecting two independent observations of the
 * thing it was assuming, and using neither. A thermal shift drew a coverline on
 * one chart and was read by nothing else. A positive ovulation test was stored
 * and never looked at again.
 *
 * So this measures it. For every completed cycle where ovulation can be dated
 * from her own data, the luteal length is the days from that ovulation to the
 * next period. Enough of those and the app stops guessing.
 *
 * Pure functions over plain data.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./model.js').DayLog} DayLog
 * @typedef {import('./cycles.js').Cycle} Cycle
 */

import { addDays, daysBetween, range } from '../utils/date.js';

/**
 * A sustained temperature rise, which retroactively confirms ovulation.
 *
 * Moved here from predict.js so that predictions can depend on measured
 * ovulation without ovulation depending on predictions.
 *
 * Three consecutive readings at least 0.2 °C above the mean of the previous
 * six. Returns the first day of the rise, which is *after* the event — see
 * `ovulationFromShift`.
 *
 * @param {{date: DateKey, bbt: number}[]} readings oldest first
 * @returns {DateKey|null}
 */
export function detectThermalShift(readings) {
  const BASELINE_DAYS = 6;
  const RISE = 0.2;
  const SUSTAINED = 3;

  for (let i = BASELINE_DAYS; i + SUSTAINED <= readings.length; i++) {
    const baseline = readings.slice(i - BASELINE_DAYS, i);
    const mean = baseline.reduce((a, r) => a + r.bbt, 0) / baseline.length;
    const window = readings.slice(i, i + SUSTAINED);
    if (window.every((r) => r.bbt - mean >= RISE)) return window[0].date;
  }
  return null;
}

/**
 * Temperature rises the day *after* ovulation, so the shift dates the event to
 * the day before the first high reading. One day, and it is the difference
 * between a luteal length that is right and one that is consistently a day long
 * for the rest of the app's life.
 * @param {DateKey} shiftDate
 */
const ovulationFromShift = (shiftDate) => addDays(shiftDate, -1);

/**
 * A peak LH result means the surge, and ovulation follows it by roughly a day.
 * @param {DateKey} peakDate
 */
const ovulationFromPeak = (peakDate) => addDays(peakDate, 1);

/**
 * @typedef {Object} Observation
 * @property {DateKey} cycleStart
 * @property {DateKey} ovulation
 * @property {number} lutealDays   ovulation to the next period
 * @property {'test'|'temperature'} source
 */

/** Physiological bounds. Outside these it was not a luteal phase. */
const LUTEAL_MIN = 8;
const LUTEAL_MAX = 20;

/** How many measurements before the app trusts them over the stated default. */
export const MIN_OBSERVATIONS = 2;

/**
 * Every cycle where ovulation can be dated from her own logs.
 *
 * Only complete cycles: the luteal length is measured *to* the next period, so
 * a cycle without one has nothing to measure to.
 *
 * A positive test beats a thermal shift where both exist. The test is a direct
 * observation of the surge that triggers ovulation; the shift is an inference
 * from a body-temperature change that a bad night's sleep can also produce.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @returns {Observation[]} oldest first
 */
export function confirmedOvulations(logs, cycles) {
  /** @type {Observation[]} */
  const out = [];

  for (const cycle of cycles) {
    if (!cycle.complete || !cycle.nextStart) continue;
    const days = range(cycle.start, addDays(cycle.nextStart, -1));

    /** @type {{date: DateKey, source: 'test'|'temperature'}|null} */
    let found = null;

    const peak = days.find((d) => logs[d]?.testOvulation === 'peak');
    if (peak) {
      found = { date: ovulationFromPeak(peak), source: 'test' };
    } else {
      const readings = days
        .map((d) => ({ date: d, bbt: logs[d]?.bbt }))
        .filter((r) => typeof r.bbt === 'number')
        .map((r) => ({ date: r.date, bbt: /** @type {number} */ (r.bbt) }));
      const shift = detectThermalShift(readings);
      if (shift) found = { date: ovulationFromShift(shift), source: 'temperature' };
    }

    if (!found) continue;

    const lutealDays = daysBetween(found.date, cycle.nextStart);
    // A "luteal phase" of three days, or of thirty, is a mis-dated ovulation
    // rather than a finding, and averaging it in would poison every window.
    if (lutealDays < LUTEAL_MIN || lutealDays > LUTEAL_MAX) continue;

    out.push({
      cycleStart: cycle.start,
      ovulation: found.date,
      lutealDays,
      source: found.source,
    });
  }

  return out;
}

/**
 * @typedef {Object} LutealEstimate
 * @property {number|null} days      the measured length, or null
 * @property {number} samples        how many cycles it came from
 * @property {Observation[]} observations
 */

/**
 * Her own luteal length, measured, or null if it cannot be.
 *
 * The median rather than the mean. Luteal phases are tight and roughly
 * symmetric, so the two usually agree — but a single mis-dated ovulation moves
 * a mean and barely moves a median, and one bad cycle should not shift every
 * fertile window she sees for the next month.
 *
 * Two observations is the floor. One is an anecdote, and switching away from a
 * documented population figure on the strength of a single reading would be
 * trading a known approximation for an unknown one.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @returns {LutealEstimate}
 */
export function measuredLuteal(logs, cycles) {
  const observations = confirmedOvulations(logs, cycles);
  if (observations.length < MIN_OBSERVATIONS) {
    return { days: null, samples: observations.length, observations };
  }

  const lengths = observations.map((o) => o.lutealDays).sort((a, b) => a - b);
  const mid = Math.floor(lengths.length / 2);
  const median = lengths.length % 2
    ? lengths[mid]
    // An even count has no middle value. Rounding the pair's mean up keeps the
    // estimate a whole number of days without ever shortening the window.
    : Math.round((lengths[mid - 1] + lengths[mid]) / 2);

  return { days: median, samples: observations.length, observations };
}

/**
 * @typedef {Object} CycleSignals
 * @property {DateKey|null} peakTest   day a peak ovulation test was logged
 * @property {DateKey|null} shift      first day of a sustained temperature rise
 * @property {DateKey|null} eggWhite   most recent egg-white discharge
 * @property {DateKey|null} confirmed  the ovulation date, if it can be dated
 * @property {'test'|'temperature'|null} source
 * @property {boolean} corroborated    both signals agree, within two days
 */

/**
 * What her own data says about the cycle she is *in*.
 *
 * `confirmedOvulations` above deliberately only looks at completed cycles,
 * because it exists to measure luteal length and that needs a next period to
 * measure to. But "has it happened yet, this month" is the question someone
 * trying to conceive is actually asking, and it is answerable from the same two
 * observations without waiting for the cycle to end.
 *
 * The double check is the point, and it is why this reports both signals rather
 * than only the winner. A positive test says the surge happened, which is not
 * quite the same as the egg being released; a thermal shift says the
 * progesterone rise happened, which is good evidence it was, but a fever or a
 * bad night's sleep can fake one. Sensiplan-style rules exist because either
 * alone is weaker than both agreeing — so where both are present and land
 * within two days of each other, say so, and where they disagree, do not
 * quietly prefer one and present it as settled.
 *
 * Mucus is reported but never used to date anything: egg-white discharge marks
 * the fertile stretch approaching ovulation rather than the event, so it
 * belongs on the screen and not in the arithmetic.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle|null} cycle the running cycle
 * @param {DateKey} today
 * @returns {CycleSignals|null}
 */
export function cycleSignals(logs, cycle, today) {
  if (!cycle) return null;

  const days = range(cycle.start, today);

  const peak = days.find((d) => logs[d]?.testOvulation === 'peak') ?? null;

  const readings = days
    .map((d) => ({ date: d, bbt: logs[d]?.bbt }))
    .filter((r) => typeof r.bbt === 'number')
    .map((r) => ({ date: r.date, bbt: /** @type {number} */ (r.bbt) }));
  const shift = detectThermalShift(readings);

  const eggWhite = [...days].reverse()
    .find((d) => logs[d]?.discharge.includes('egg-white')) ?? null;

  const fromTest = peak ? ovulationFromPeak(peak) : null;
  const fromShift = shift ? ovulationFromShift(shift) : null;

  const confirmed = fromTest ?? fromShift;
  const source = fromTest ? 'test' : fromShift ? 'temperature' : null;

  const corroborated = fromTest != null && fromShift != null
    && Math.abs(daysBetween(fromTest, fromShift)) <= 2;

  return { peakTest: peak, shift, eggWhite, confirmed, source, corroborated };
}
