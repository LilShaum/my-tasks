// @ts-check
/**
 * predict.js — forecast the next period, ovulation and fertile window.
 *
 * Flo's own accuracy documentation describes the parts of its approach that are
 * worth copying, and they aren't the neural network — they're the honesty
 * mechanisms:
 *
 *   - Under three logged cycles, don't pretend: use her stated average and
 *     label the result an estimate.
 *   - Weight recent cycles more heavily than old ones.
 *   - If cycle length shifts and *stays* shifted for three cycles, re-anchor
 *     onto those three rather than letting years of history drag the mean.
 *   - When the data doesn't support a confident fertile window, widen it and say
 *     so, instead of drawing a narrow window that looks authoritative.
 *   - If she's on a hormonal method, don't show ovulation at all. It isn't
 *     happening, so a prediction would be actively misleading.
 *
 * Ovulation is derived by the luteal-phase method — next period minus luteal
 * length — rather than the cycle midpoint. The luteal phase is the stable part
 * of the cycle; midpoint estimates degrade badly once cycles vary.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./cycles.js').Cycle} Cycle
 * @typedef {import('./model.js').Settings} Settings
 */

import { addDays, daysBetween } from '../utils/date.js';
import {
  buildCycles, cycleLengths, periodLengths, currentCycle, summarize, periodSpan,
} from './cycles.js';
import { HORMONAL_BIRTH_CONTROL } from './model.js';
import { regularity } from './acog.js';

/** How many recent cycles feed the weighted average. */
const WINDOW = 6;

/** Cycles needed before we trust logged data over her stated average. */
const MIN_CYCLES_FOR_MODEL = 3;

/** Sustained-change detection: this many consecutive cycles in one direction. */
const RECALIBRATE_AFTER = 3;
const RECALIBRATE_DELTA = 3;

/** Fertile window: ovulation minus this, through ovulation plus one. */
const FERTILE_BEFORE = 5;
const FERTILE_AFTER = 1;

/** Widened window used when confidence is low, per Flo's documented fallback. */
const UNCERTAIN_WINDOW = 14;

/**
 * Past this many days since the last logged period, the app stops predicting.
 *
 * Lateness is real and worth surfacing — a period can genuinely be weeks late,
 * and that is information. But at some point "late" stops describing a cycle
 * and starts describing a person who put the app down for a while, and every
 * number derived from that point is fiction.
 *
 * Ninety days is chosen to sit well past any ordinary delay, past the ACOG
 * threshold for absent periods (which the flags already raise separately), and
 * comfortably inside the "I forgot about this app" range.
 */
export const STALE_AFTER_DAYS = 90;

export const CYCLE_MIN_CLAMP = 21;
export const CYCLE_MAX_CLAMP = 45;

/**
 * @typedef {'none'|'low'|'medium'|'high'} Confidence
 */

/**
 * @typedef {Object} Prediction
 * @property {number} avgCycleLength   the number actually used, rounded
 * @property {number} avgPeriodLength
 * @property {Confidence} confidence
 * @property {boolean} recalibrated
 * @property {DateKey|null} lastStart
 * @property {DateKey|null} nextStart
 * @property {{start: DateKey, end: DateKey}|null} nextPeriod
 * @property {DateKey|null} ovulation
 * @property {{start: DateKey, end: DateKey}|null} fertileWindow
 * @property {boolean} fertileWidened
 * @property {boolean} showFertility
 * @property {number|null} daysUntilPeriod  negative once late
 * @property {number|null} daysLate
 * @property {boolean} isLate
 * @property {boolean} onHormonal   a method that suppresses ovulation
 * @property {boolean} stale        history too old to predict from
 * @property {number|null} daysSinceStart
 * @property {number|null} cycleDay
 * @property {number|null} spread
 * @property {'regular'|'variable'|'irregular'|null} regularity
 * @property {number} cyclesLogged
 * @property {number} lutealDays    luteal length actually used
 * @property {number} fertileBefore days of fertile window before ovulation
 */

/**
 * Weighted mean over the most recent `WINDOW` cycles, newest weighted highest.
 * A linear ramp (1,2,3…) is enough — it tracks a drifting cycle without
 * throwing away history, and it's explainable to a user, which an exponential
 * decay constant is not.
 * @param {number[]} lengths oldest first
 * @returns {number|null}
 */
export function weightedAverage(lengths) {
  if (!lengths.length) return null;
  const recent = lengths.slice(-WINDOW);
  let total = 0;
  let weight = 0;
  recent.forEach((length, i) => {
    const w = i + 1;
    total += length * w;
    weight += w;
  });
  return total / weight;
}

/**
 * Has cycle length shifted and stayed shifted?
 *
 * Compares the last three cycles against the mean of everything before them. If
 * all three moved the same way by more than a few days, the old mean is stale
 * and we re-anchor onto the recent three.
 *
 * @param {number[]} lengths oldest first
 * @returns {{recalibrated: boolean, value: number|null}}
 */
export function detectRecalibration(lengths) {
  if (lengths.length < RECALIBRATE_AFTER * 2) return { recalibrated: false, value: null };

  const recent = lengths.slice(-RECALIBRATE_AFTER);
  const historic = lengths.slice(0, -RECALIBRATE_AFTER);
  const baseline = historic.reduce((a, b) => a + b, 0) / historic.length;

  const allUp = recent.every((n) => n - baseline > RECALIBRATE_DELTA);
  const allDown = recent.every((n) => baseline - n > RECALIBRATE_DELTA);

  if (!allUp && !allDown) return { recalibrated: false, value: null };
  return {
    recalibrated: true,
    value: recent.reduce((a, b) => a + b, 0) / recent.length,
  };
}

/**
 * Rate how much to trust the forecast.
 * @param {number} cyclesLogged
 * @param {number|null} spread
 * @returns {Confidence}
 */
export function rateConfidence(cyclesLogged, spread) {
  if (cyclesLogged === 0) return 'none';
  if (cyclesLogged < 2) return 'low';
  if (spread != null && spread > 12) return 'low';
  if (cyclesLogged < MIN_CYCLES_FOR_MODEL) return 'medium';
  if (spread != null && spread > 9) return 'medium';
  return 'high';
}

/**
 * The whole forecast.
 *
 * @param {Object} input
 * @param {Set<DateKey>|DateKey[]} input.periodDays
 * @param {Settings} input.settings
 * @param {DateKey} input.today
 * @returns {Prediction}
 */
export function predict({ periodDays, settings, today }) {
  /*
    Days that have not happened yet cannot say where she is now.

    The calendar used to accept a tap on a future date, and one was enough to
    make this whole function describe a cycle that has not started: `lastStart`
    landed in the future, `daysBetween(lastStart, today)` went negative, and
    Today printed "Day -29" beside "58 days to your period" — while another
    card on the same screen said there was not enough data to say anything.
    The staleness guard below only catches history that is too *old*.

    The calendar now refuses those taps, so this is the second line: an import
    written on a device with a wrong clock, or a file edited by hand, reaches
    the same place and must not produce the same nonsense.
  */
  const usable = [...periodDays].filter((day) => day <= today);
  const cycles = buildCycles(usable);
  const lengths = cycleLengths(cycles);
  const periods = periodLengths(cycles, today);
  const stats = summarize(lengths);
  const current = currentCycle(cycles);

  const onHormonal = HORMONAL_BIRTH_CONTROL.has(settings.birthControl);
  const confidence = rateConfidence(lengths.length, stats.spread);

  /* ── Which cycle length do we use? ───────────────────────────────────── */
  let avg = settings.avgCycleLength;
  let recalibrated = false;

  if (lengths.length >= MIN_CYCLES_FOR_MODEL) {
    const shift = detectRecalibration(lengths);
    if (shift.recalibrated && shift.value != null) {
      avg = shift.value;
      recalibrated = true;
    } else {
      const weighted = weightedAverage(lengths);
      if (weighted != null) avg = weighted;
    }
  } else if (lengths.length > 0) {
    // One or two cycles: blend what we've seen with her stated prior rather
    // than swinging fully onto a single observation.
    const observed = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    avg = (observed + settings.avgCycleLength) / 2;
  }

  avg = clamp(Math.round(avg), CYCLE_MIN_CLAMP, CYCLE_MAX_CLAMP);

  const avgPeriod = periods.length
    ? clamp(Math.round(periods.reduce((a, b) => a + b, 0) / periods.length), 1, 14)
    : settings.avgPeriodLength;

  /* ── Next period ─────────────────────────────────────────────────────── */
  const lastStart = current?.start ?? null;
  const nextStart = lastStart ? addDays(lastStart, avg) : null;

  let daysUntilPeriod = nextStart ? daysBetween(today, nextStart) : null;
  let daysLate = null;
  let isLate = false;

  /*
    Beyond `STALE_AFTER_DAYS` the record has simply stopped, and everything
    downstream of it is invention. Left alone, a year away from the app
    produced a screen reading "Day 431", "402 days late", "Luteal phase", a
    fertile window from the previous summer, and — worst of all — "Good
    confidence, based on 5 complete cycles".

    Every one of those is asserted from a single fact: the last period she
    bothered to log. Nobody's period is 402 days late; nobody is 431 days into
    a luteal phase. The honest output is to stop, say the data has gone stale,
    and ask for a fresh period date.
  */
  const daysSinceStart = lastStart ? daysBetween(lastStart, today) : null;
  const stale = daysSinceStart != null && daysSinceStart > STALE_AFTER_DAYS;

  if (!stale && nextStart && daysUntilPeriod != null && daysUntilPeriod < 0) {
    isLate = true;
    daysLate = -daysUntilPeriod;
  }

  /* ── Ovulation and the fertile window ────────────────────────────────── */
  const showFertility = !onHormonal && settings.showFertility && !stale;

  /** @type {DateKey|null} */
  let ovulation = null;
  /** @type {{start: DateKey, end: DateKey}|null} */
  let fertileWindow = null;
  let fertileWidened = false;
  let fertileBefore = FERTILE_BEFORE;

  if (showFertility && nextStart) {
    // Luteal-phase method: the luteal phase is the stable part of the cycle,
    // so counting back from the next period beats halving the cycle.
    ovulation = addDays(nextStart, -settings.lutealLength);

    if (confidence === 'low' || confidence === 'none') {
      // Don't draw a narrow window we can't support. Widen and say so.
      const half = Math.floor(UNCERTAIN_WINDOW / 2);
      fertileWindow = {
        start: addDays(ovulation, -half),
        end: addDays(ovulation, UNCERTAIN_WINDOW - half - 1),
      };
      fertileWidened = true;
      fertileBefore = half;
    } else {
      fertileWindow = {
        start: addDays(ovulation, -FERTILE_BEFORE),
        end: addDays(ovulation, FERTILE_AFTER),
      };
    }
  }

  return {
    avgCycleLength: avg,
    avgPeriodLength: avgPeriod,
    // A confident-sounding badge over a stale forecast is the most misleading
    // thing on the screen, so staleness overrides however many cycles are on
    // record.
    confidence: stale ? 'none' : confidence,
    recalibrated,
    lastStart,
    nextStart: stale ? null : nextStart,
    nextPeriod: !stale && nextStart ? periodSpan(nextStart, avgPeriod) : null,
    ovulation,
    fertileWindow,
    fertileWidened,
    showFertility,
    onHormonal,
    daysUntilPeriod: stale ? null : daysUntilPeriod,
    daysLate,
    isLate,
    stale,
    daysSinceStart,
    cycleDay: stale || daysSinceStart == null ? null : daysSinceStart + 1,
    spread: stats.spread,
    regularity: stats.spread == null ? null : regularity(stats.spread),
    cyclesLogged: lengths.length,
    lutealDays: settings.lutealLength,
    fertileBefore,
  };
}

/**
 * Predicted period spans for the next `count` cycles, for drawing the calendar
 * forward. Each successive one compounds the same average, so uncertainty grows
 * with distance — the calendar renders later ones more faintly to reflect that.
 *
 * @param {Prediction} prediction
 * @param {number} count
 * @returns {{start: DateKey, end: DateKey, ordinal: number}[]}
 */
export function upcomingPeriods(prediction, count = 4) {
  if (!prediction.nextStart) return [];
  /** @type {{start: DateKey, end: DateKey, ordinal: number}[]} */
  const out = [];
  for (let i = 0; i < count; i++) {
    const start = addDays(prediction.nextStart, prediction.avgCycleLength * i);
    const span = periodSpan(start, prediction.avgPeriodLength);
    out.push({ ...span, ordinal: i });
  }
  return out;
}

/**
 * Predicted ovulation days and fertile windows for the next `count` cycles.
 * @param {Prediction} prediction
 * @param {number} count
 */
export function upcomingFertile(prediction, count = 4) {
  if (!prediction.showFertility || !prediction.ovulation) return [];
  /** @type {{ovulation: DateKey, start: DateKey, end: DateKey, ordinal: number}[]} */
  const out = [];
  const width = prediction.fertileWidened ? UNCERTAIN_WINDOW : FERTILE_BEFORE + FERTILE_AFTER + 1;
  const before = prediction.fertileWidened ? Math.floor(UNCERTAIN_WINDOW / 2) : FERTILE_BEFORE;

  for (let i = 0; i < count; i++) {
    const ovulation = addDays(prediction.ovulation, prediction.avgCycleLength * i);
    out.push({
      ovulation,
      start: addDays(ovulation, -before),
      end: addDays(ovulation, width - before - 1),
      ordinal: i,
    });
  }
  return out;
}

/**
 * Chance of conception on a given day, as a coarse band rather than a decimal.
 *
 * Flo reports tiers ("high chance", "a chance") rather than a number, and
 * that's the right call: the underlying estimate is nowhere near precise enough
 * to justify a percentage, and a percentage invites treating it as one.
 *
 * @param {Prediction} prediction
 * @param {DateKey} date
 * @returns {{tier: 'high'|'some'|'low'|'none', label: string}}
 */
export function conceptionChance(prediction, date) {
  if (!prediction.showFertility || !prediction.ovulation || !prediction.fertileWindow) {
    return { tier: 'none', label: 'Not estimated' };
  }

  const { ovulation, fertileWindow } = prediction;
  const offset = daysBetween(ovulation, date);

  if (date < fertileWindow.start || date > fertileWindow.end) {
    return { tier: 'low', label: 'Low chance of getting pregnant' };
  }
  // Peak fertility is the day before ovulation and the day itself.
  if (offset === 0 || offset === -1) {
    return { tier: 'high', label: 'High chance of getting pregnant' };
  }
  return { tier: 'some', label: 'Some chance of getting pregnant' };
}

/**
 * Detect a BBT thermal shift, which retroactively confirms that ovulation
 * happened. Three consecutive readings at least 0.2°C above the mean of the
 * previous six is the standard rule.
 *
 * Retrospective by nature — it tells you ovulation already occurred, not that
 * it's coming.
 *
 * @param {{date: DateKey, bbt: number}[]} readings chronological, °C
 * @returns {DateKey|null} the first day of the shift
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

/** @param {number} n @param {number} lo @param {number} hi */
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
