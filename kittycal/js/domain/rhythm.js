// @ts-check
/**
 * rhythm.js — how her days line up against her own cycle, said only when the
 * data actually says it.
 *
 * Insights used to be a stack of counts. This is the other half: every chart
 * has to answer a real question ("when do my cramps come?", "do I sleep worse
 * before my period?", "what goes with my headaches?") with a finding the
 * numbers support, and when they do not, the functions here return null or []
 * and the screen says nothing. A missing finding is correct output, not a gap
 * to be filled with something plausible.
 *
 * The one idea underneath all of it is *alignment*. Calendar dates are no use
 * for comparing cycles, and "day 22" means different things in a 26-day and a
 * 32-day cycle. So every logged day is placed twice:
 *
 *   - `after`:  days since the period started (1 = first bleeding day). Right
 *     for things that follow the period itself: cramps, flow-day tiredness.
 *   - `before`: days until the next period (1 = the day before it). Right for
 *     things that follow the coming period: PMS, the pre-period sleep dip.
 *     This is the same anchoring heads-up.js uses, for the same reason.
 *
 * Each slot of those two arrays then pools the same position across every
 * complete cycle, so "3 days before" really means 3 days before, every time.
 * A day may appear in both arrays when the cycle is short, and a day in the
 * middle of a long cycle appears in neither: the arrays are two windows onto
 * the cycle's edges, not a partition of it.
 *
 * Pure functions over plain data: no DOM, no store, everything passed in.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./model.js').DayLog} DayLog
 * @typedef {import('./cycles.js').Cycle} Cycle
 */

import { addDays, daysBetween, range } from '../utils/date.js';
import { loggedIds, trackedCycles } from './stats.js';

/** Days counted from a period's first day. */
export const AFTER = 14;
/** Days counted back from the next period's first day. */
export const BEFORE = 14;

/** Complete cycles needed before any pattern is claimed. Same bar as Patterns. */
const MIN_CYCLES = 3;
/** An id has to show up in at least this share of complete cycles to be listed. */
const PRESENCE = 0.6;
/** A rate below this is background noise, not a concentration. */
const MIN_PEAK = 0.3;
/** How unlikely a run must be, from her usual rate alone, to be called a timing. */
const CHANCE = 0.001;
/** Her usual rate is never taken as below this, so "never on other days" is not "impossible". */
const MIN_BASE_RATE = 0.02;

/**
 * P(X ≥ k) for X ~ Binomial(n, p), summed in log space so long histories do
 * not overflow.
 * @param {number} k
 * @param {number} n
 * @param {number} p
 */
export function binomialTail(k, n, p) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let logC = 0;
  for (let i = 1; i <= k; i += 1) logC += Math.log((n - k + i) / i);
  let total = 0;
  for (let i = k; i <= n; i += 1) {
    total += Math.exp(logC + i * Math.log(p) + (n - i) * Math.log(1 - p));
    logC += Math.log((n - i) / (i + 1));
  }
  return Math.min(1, total);
}

/** Moods nobody needs warning about. Everything else is a "hard" mood. */
const PLEASANT_MOODS = new Set(['calm', 'happy', 'energetic', 'playful', 'confident', 'neutral']);

/**
 * @param {string} id a mood id
 * @returns {boolean} true for any mood that is not a pleasant one
 */
export function HARD_MOOD(id) {
  return !PLEASANT_MOODS.has(id);
}

/**
 * @typedef {Object} Slot
 * @property {number} n    days that contributed
 * @property {number} sum  total of their values
 */

/**
 * Where a date sits in a complete cycle.
 *
 * `after` is 1-based so that day 1 is the first bleeding day, which is how she
 * talks about it. `before` counts to the *next* start, so 1 is the day before
 * the period. For an open cycle there is no next start and `before` is
 * Infinity: such a day belongs in no "before" slot, and nothing here aligns
 * open cycles anyway.
 *
 * @param {Cycle} cycle
 * @param {DateKey} date
 * @returns {{after: number, before: number}}
 */
export function align(cycle, date) {
  return {
    after: daysBetween(cycle.start, date) + 1,
    before: cycle.nextStart ? daysBetween(date, cycle.nextStart) : Infinity,
  };
}

/**
 * The finished cycles she logged in. One with no logs is not a cycle in which
 * nothing happened, so it is not counted as one (see stats.js trackedCycles).
 * @param {Cycle[]} cycles @param {Record<DateKey, DayLog>} logs
 * @returns {(Cycle & {nextStart: DateKey})[]}
 */
function completeOnly(cycles, logs) {
  return trackedCycles(logs, cycles);
}

/**
 * Every date in a complete cycle: its first day through the day before the next.
 * @param {Cycle & {nextStart: DateKey}} cycle
 * @returns {DateKey[]}
 */
function cycleDates(cycle) {
  return range(cycle.start, addDays(cycle.nextStart, -1));
}

/** @param {number} length @returns {Slot[]} */
const emptySlots = (length) => Array.from({ length }, () => ({ n: 0, sum: 0 }));

/**
 * Pool a numeric value across every complete cycle into position slots.
 *
 * Only days she actually logged contribute (`valueOf` decides, and may return
 * null to skip a day for this measure). An unlogged day is "unknown", not zero,
 * and counting it as zero would make every rate look lower the less she used
 * the app.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @param {(log: DayLog) => number|null} valueOf
 * @returns {{after: Slot[], before: Slot[], cycles: number}}
 */
export function alignedSeries(logs, cycles, valueOf) {
  const after = emptySlots(AFTER);
  const before = emptySlots(BEFORE);
  const complete = completeOnly(cycles, logs);

  for (const cycle of complete) {
    for (const date of cycleDates(cycle)) {
      const log = logs[date];
      if (!log) continue;
      const value = valueOf(log);
      if (value == null || !Number.isFinite(value)) continue;
      const pos = align(cycle, date);
      if (pos.after <= AFTER) { after[pos.after - 1].n += 1; after[pos.after - 1].sum += value; }
      if (pos.before <= BEFORE) { before[pos.before - 1].n += 1; before[pos.before - 1].sum += value; }
    }
  }
  return { after, before, cycles: complete.length };
}

/**
 * Mean per slot. One day is an anecdote, so a slot needs two to say anything.
 * @param {Slot[]} slots
 * @returns {(number|null)[]}
 */
function means(slots) {
  return slots.map((s) => (s.n >= 2 ? s.sum / s.n : null));
}

/**
 * Add up a run of slots (1-based, inclusive) into one pooled group.
 * @param {Slot[]} slots
 * @param {number} from
 * @param {number} to
 * @returns {Slot}
 */
function pool(slots, from, to) {
  const out = { n: 0, sum: 0 };
  for (let k = from; k <= Math.min(to, slots.length); k += 1) {
    out.n += slots[k - 1].n;
    out.sum += slots[k - 1].sum;
  }
  return out;
}

/**
 * @param {...Slot} groups
 * @returns {Slot}
 */
function merge(...groups) {
  return groups.reduce((a, g) => ({ n: a.n + g.n, sum: a.sum + g.sum }), { n: 0, sum: 0 });
}

// ---------------------------------------------------------------------------
// Body map
// ---------------------------------------------------------------------------

/**
 * @typedef {{where: 'period', from: number, to: number}
 *   | {where: 'before', from: number}
 *   | {where: 'middle'}} When
 */

/**
 * @typedef {Object} BodyRow
 * @property {string} id
 * @property {'symptoms'|'moods'|'custom'} kind
 * @property {number} cyclesWith   complete cycles in which it was logged at least once
 * @property {number} cyclesTotal
 * @property {(number|null)[]} after
 * @property {(number|null)[]} before
 * @property {When|null} when
 */

/**
 * Where an id concentrates, in her words rather than a curve.
 *
 * The peak is the highest rate anywhere; the run is the stretch of
 * neighbouring slots (inside the same array) that stay at or above half the
 * peak, and never below 30% in absolute terms, because half of a tiny peak is
 * still nothing. Then:
 *
 *   - peak in the `after` array and early (day 7 or sooner): it follows the
 *     period itself, reported as the run's first and last day.
 *   - peak in the `before` array with the run reaching the day or two before
 *     the period: a premenstrual run, reported by how early it starts.
 *   - peak in after-day 8+ or before-day 11+: the middle of the cycle.
 *   - anything else (a run in before 3 to 10 that never reaches the period)
 *     is null. "From 7 days before" would imply it carries on to the period
 *     when it does not, and this module does not guess.
 *
 * And before any of that, the run has to be more than luck. Something she
 * logs on one day in eight, scattered anywhere, will land on the same cycle
 * day in two of six cycles somewhere in a 28-day span, and that slot clears
 * the 30% floor. This printed "Headache: day 5 of your period" over a grid
 * that showed headaches everywhere. So the run's count is tested against her
 * own rate for that thing on every other day: if her usual rate could
 * plausibly have produced it (one chance in a thousand, which allows for the
 * thirty-odd slots searched), it is not a timing.
 *
 * @param {Slot[]} afterSlots
 * @param {Slot[]} beforeSlots
 * @returns {When|null}
 */
function whenItHappens(afterSlots, beforeSlots) {
  const after = means(afterSlots);
  const before = means(beforeSlots);
  let peak = 0;
  /** @type {'after'|'before'} */
  let side = 'after';
  let at = -1;
  for (const [name, arr] of /** @type {const} */ ([['after', after], ['before', before]])) {
    arr.forEach((rate, i) => {
      if (rate != null && rate > peak) { peak = rate; side = name; at = i; }
    });
  }
  if (at < 0 || peak < MIN_PEAK) return null;

  const arr = side === 'after' ? after : before;
  const floor = Math.max(MIN_PEAK, peak * 0.5);
  const ok = (/** @type {number} */ i) => arr[i] != null && /** @type {number} */ (arr[i]) >= floor;
  let lo = at;
  let hi = at;
  while (lo > 0 && ok(lo - 1)) lo -= 1;
  while (hi < arr.length - 1 && ok(hi + 1)) hi += 1;

  const slots = side === 'after' ? afterSlots : beforeSlots;
  const run = pool(slots, lo + 1, hi + 1);
  const all = merge(pool(afterSlots, 1, AFTER), pool(beforeSlots, 1, BEFORE));
  const restN = all.n - run.n;
  const base = Math.max(MIN_BASE_RATE, restN > 0 ? (all.sum - run.sum) / restN : 0);
  if (binomialTail(run.sum, run.n, base) > CHANCE) return null;

  if (side === 'after') {
    if (at + 1 > 7) return { where: 'middle' };
    return { where: 'period', from: lo + 1, to: hi + 1 };
  }
  // `before`: slot index i is k = i + 1 days before the period.
  if (lo + 1 <= 2) return { where: 'before', from: hi + 1 };
  if (at + 1 > 10) return { where: 'middle' };
  return null;
}

/**
 * The things she reliably logs, and where in her cycle they land.
 *
 * Held to the Patterns bar: three complete cycles, and an id has to turn up in
 * at least 60% of them to be listed at all. Pleasant moods are left out for
 * the reason heads-up.js leaves them out: "you were happy around now" is not
 * something to chart on a screen about what to expect.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @param {number} [limit]
 * @returns {BodyRow[]}
 */
export function bodyMap(logs, cycles, limit = 8) {
  const complete = completeOnly(cycles, logs);
  if (complete.length < MIN_CYCLES) return [];

  /** @type {Record<BodyRow['kind'], (log: DayLog) => string[]>} */
  const sources = {
    symptoms: (log) => log.symptoms ?? [],
    moods: (log) => (log.moods ?? []).filter(HARD_MOOD),
    custom: (log) => log.custom ?? [],
  };
  const kinds = /** @type {BodyRow['kind'][]} */ (['symptoms', 'moods', 'custom']);

  /** In how many cycles each id appears. @type {Map<string, {kind: BodyRow['kind'], id: string, cycles: number}>} */
  const seen = new Map();
  for (const cycle of complete) {
    /** @type {Set<string>} */
    const inThis = new Set();
    for (const date of cycleDates(cycle)) {
      const log = logs[date];
      if (!log) continue;
      for (const kind of kinds) {
        for (const id of sources[kind](log)) {
          if (id === 'none') continue;
          const key = `${kind}:${id}`;
          if (inThis.has(key)) continue;
          inThis.add(key);
          const entry = seen.get(key) ?? { kind, id, cycles: 0 };
          entry.cycles += 1;
          seen.set(key, entry);
        }
      }
    }
  }

  /** @type {(BodyRow & {peak: number})[]} */
  const rows = [];
  for (const { kind, id, cycles: cyclesWith } of seen.values()) {
    if (cyclesWith / complete.length < PRESENCE) continue;
    const series = alignedSeries(logs, complete, (log) => (sources[kind](log).includes(id) ? 1 : 0));
    const after = means(series.after);
    const before = means(series.before);
    const peak = Math.max(0, ...after.map((r) => r ?? 0), ...before.map((r) => r ?? 0));
    rows.push({
      id, kind, cyclesWith, cyclesTotal: complete.length,
      after, before, when: whenItHappens(series.after, series.before), peak,
    });
  }

  rows.sort((a, b) =>
    b.cyclesWith - a.cyclesWith || b.peak - a.peak || a.id.localeCompare(b.id));
  return rows.slice(0, limit).map(({ peak, ...row }) => row);
}

// ---------------------------------------------------------------------------
// Mood curve
// ---------------------------------------------------------------------------

/** How far before the period the "window" group reaches for mood. */
const MOOD_WINDOW = 5;

/**
 * @typedef {Object} MoodFinding
 * @property {number} window      days before the period at which the elevated run starts (2 at the least)
 * @property {number} windowRate  share of mood-logged days with a hard mood, before 1..5
 * @property {number} restRate    the same, everywhere else
 * @property {number} windowN
 * @property {number} restN
 */

/**
 * Average of the non-null neighbours of slot `i` (itself and one either side).
 * A moving average because single slots are small samples; three of them
 * together stop one odd day deciding where a run starts.
 * @param {(number|null)[]} arr
 * @param {number} i
 * @returns {number|null}
 */
function smoothed(arr, i) {
  /** @type {number[]} */
  const near = [];
  for (const v of [arr[i - 1], arr[i], arr[i + 1]]) if (v != null) near.push(v);
  return near.length ? near.reduce((a, b) => a + b, 0) / near.length : null;
}

/**
 * Does she have harder moods before her period than the rest of the cycle?
 *
 * The curve is the share of mood-logged days that held any hard mood. The
 * finding compares the five days before the period with every other aligned
 * slot pooled, and is only made when the gap is both real in size (15 points)
 * and in ratio (1.5x). Either alone misleads: 60% against 50% is a big ratio of
 * nothing, and 5% against 1% is a big ratio of a handful of days.
 *
 * Slots are pooled as the arrays hold them, so in a very short cycle a day
 * can be in both the window and the rest. That is rare (under 19 days) and
 * the effect is to understate a difference, never to invent one.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @returns {{after: (number|null)[], before: (number|null)[], cycles: number, finding: MoodFinding|null}|null}
 */
export function moodCurve(logs, cycles) {
  const complete = completeOnly(cycles, logs);
  if (complete.length < MIN_CYCLES) return null;

  let moodDays = 0;
  for (const cycle of complete) {
    for (const date of cycleDates(cycle)) if (logs[date]?.moods?.length) moodDays += 1;
  }
  if (moodDays < 20) return null;

  const series = alignedSeries(logs, complete, (log) =>
    (log.moods?.length ? (log.moods.some(HARD_MOOD) ? 1 : 0) : null));
  const after = means(series.after);
  const before = means(series.before);

  const win = pool(series.before, 1, MOOD_WINDOW);
  const rest = merge(pool(series.after, 1, AFTER), pool(series.before, MOOD_WINDOW + 1, BEFORE));

  /** @type {MoodFinding|null} */
  let finding = null;
  if (win.n >= 8 && rest.n >= 8) {
    const windowRate = win.sum / win.n;
    const restRate = rest.sum / rest.n;
    if (windowRate - restRate >= 0.15 && windowRate >= 1.5 * restRate) {
      // Walk out from the period while the smoothed rate stays above the
      // midpoint between the two groups: that is where the rise begins.
      const mid = (windowRate + restRate) / 2;
      let k = 0;
      while (k < before.length) {
        const avg = smoothed(before, k);
        if (avg == null || avg < mid) break;
        k += 1;
      }
      finding = { window: Math.max(2, k), windowRate, restRate, windowN: win.n, restN: rest.n };
    }
  }
  return { after, before, cycles: complete.length, finding };
}

// ---------------------------------------------------------------------------
// Sleep curve
// ---------------------------------------------------------------------------

/** How far before the period the sleep "window" reaches. */
const SLEEP_WINDOW = 7;

/**
 * @typedef {Object} SleepFinding
 * @property {number} minutes     window minus rest, signed, rounded to whole minutes
 * @property {number} windowMean  hours
 * @property {number} restMean    hours
 * @property {number} windowN
 * @property {number} restN
 */

/** Symptom ids that say the night was bad. The check-in's sleep quality chips write these. */
const BAD_SLEEP = ['restless-sleep', 'insomnia'];

/**
 * Does she sleep differently in the week before her period?
 *
 * Hours come from the sleep field. The restless share also counts a night with
 * no hours logged but a restless or insomnia symptom, because "barely slept"
 * is a real answer whether or not she typed a number. Twenty minutes is the
 * smallest difference worth reporting; below that it is within how much a
 * night varies by itself.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @returns {{after: (number|null)[], before: (number|null)[],
 *   restless: {after: (number|null)[], before: (number|null)[]},
 *   cycles: number, finding: SleepFinding|null}|null}
 */
export function sleepCurve(logs, cycles) {
  const complete = completeOnly(cycles, logs);
  if (complete.length < 2) return null;

  // Count real nights, not slot entries: a day in both arrays is one night.
  let nights = 0;
  for (const cycle of complete) {
    for (const date of cycleDates(cycle)) if (logs[date] && logs[date].sleep != null) nights += 1;
  }
  if (nights < 14) return null;

  const hours = alignedSeries(logs, complete, (log) => (log.sleep == null ? null : log.sleep));
  const restless = alignedSeries(logs, complete, (log) => {
    const bad = BAD_SLEEP.some((id) => log.symptoms?.includes(id));
    if (log.sleep == null && !bad) return null;
    return bad ? 1 : 0;
  });

  const win = pool(hours.before, 1, SLEEP_WINDOW);
  const rest = merge(pool(hours.after, 1, AFTER), pool(hours.before, SLEEP_WINDOW + 1, BEFORE));

  /** @type {SleepFinding|null} */
  let finding = null;
  if (win.n >= 8 && rest.n >= 8) {
    const windowMean = win.sum / win.n;
    const restMean = rest.sum / rest.n;
    const minutes = Math.round((windowMean - restMean) * 60);
    if (Math.abs(minutes) >= 20) {
      finding = { minutes, windowMean, restMean, windowN: win.n, restN: rest.n };
    }
  }

  return {
    after: means(hours.after),
    before: means(hours.before),
    restless: { after: means(restless.after), before: means(restless.before) },
    cycles: complete.length,
    finding,
  };
}

// ---------------------------------------------------------------------------
// What goes with it
// ---------------------------------------------------------------------------

/** Under this many hours is a short night. */
const SHORT_SLEEP = 6;
/** Under this many ml is a low-water day. */
const LOW_WATER = 1000;

/**
 * @typedef {Object} Comparison
 * @property {'shortSleep'|'lowWater'} condition
 * @property {string} outcome   'hard-mood' or a symptom id
 * @property {number} withN
 * @property {number} withHits
 * @property {number} withoutN
 * @property {number} withoutHits
 * @property {number} rateWith
 * @property {number} rateWithout
 * @property {number|null} ratio   rateWith / rateWithout, null when rateWithout is 0
 */

/**
 * Each test returns null when the day cannot say (no sleep logged, no water
 * logged), so those days sit out rather than counting as "no".
 * @type {{id: Comparison['condition'], test: (log: DayLog) => boolean|null}[]}
 */
const CONDITIONS = [
  { id: 'shortSleep', test: (log) => (log.sleep == null ? null : log.sleep < SHORT_SLEEP) },
  { id: 'lowWater', test: (log) => (!log.water ? null : log.water < LOW_WATER) },
];

/**
 * Is a day observed for symptoms? A day with nothing logged says nothing about
 * whether she had a headache, so it must not count as a "no". A check-in does:
 * "nothing bothering me" is an answer.
 * @param {DayLog} log
 */
const symptomObserved = (log) => !!log.checkedIn || loggedIds(log).length > 0;

/**
 * What tends to go with short sleep or little water, in her own days.
 *
 * Each comparison puts days where a condition holds next to days where it does
 * not, on the same outcome, and keeps it only if all of these hold: eight days
 * each side, a gap of 15 points, and at least 1.5x the rate (or, when the
 * other side never has it at all, at least four occurrences, since "1.5x of
 * zero" would let two coincidences through). It says "goes with", never
 * "causes", and that wording is the caller's to keep.
 *
 * Today is excluded entirely: water logged so far today is a total in
 * progress, not a low day, and would read as "low water" all morning.
 *
 * At most two comparisons per condition, so one habit cannot take over the
 * card.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {DateKey} today
 * @param {number} [limit]
 * @returns {Comparison[]}
 */
export function goesWith(logs, today, limit = 3) {
  const days = Object.values(logs).filter((log) => log && log.date !== today);

  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const log of days) {
    for (const id of log.symptoms ?? []) if (id !== 'none') counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const topSymptoms = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([id]) => id);

  /** @type {{id: string, observed: (log: DayLog) => boolean, hit: (log: DayLog) => boolean}[]} */
  const outcomes = [
    {
      id: 'hard-mood',
      observed: (log) => (log.moods?.length ?? 0) > 0,
      hit: (log) => log.moods.some(HARD_MOOD),
    },
    ...topSymptoms.map((id) => ({
      id,
      observed: symptomObserved,
      hit: (/** @type {DayLog} */ log) => log.symptoms.includes(id),
    })),
  ];

  /** @type {Comparison[]} */
  const found = [];
  for (const condition of CONDITIONS) {
    for (const outcome of outcomes) {
      let withN = 0, withHits = 0, withoutN = 0, withoutHits = 0;
      for (const log of days) {
        const holds = condition.test(log);
        if (holds == null || !outcome.observed(log)) continue;
        const hit = outcome.hit(log);
        if (holds) { withN += 1; if (hit) withHits += 1; }
        else { withoutN += 1; if (hit) withoutHits += 1; }
      }
      if (withN < 8 || withoutN < 8) continue;
      const rateWith = withHits / withN;
      const rateWithout = withoutHits / withoutN;
      if (rateWith - rateWithout < 0.15) continue;
      if (rateWithout === 0 ? withHits < 4 : rateWith / rateWithout < 1.5) continue;
      found.push({
        condition: condition.id, outcome: outcome.id,
        withN, withHits, withoutN, withoutHits, rateWith, rateWithout,
        ratio: rateWithout === 0 ? null : rateWith / rateWithout,
      });
    }
  }

  found.sort((a, b) =>
    (b.rateWith - b.rateWithout) - (a.rateWith - a.rateWithout) ||
    a.condition.localeCompare(b.condition) || a.outcome.localeCompare(b.outcome));

  /** @type {Comparison[]} */
  const out = [];
  /** @type {Record<string, number>} */
  const per = {};
  for (const c of found) {
    if (out.length >= limit) break;
    if ((per[c.condition] ?? 0) >= 2) continue;
    per[c.condition] = (per[c.condition] ?? 0) + 1;
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Period fingerprint
// ---------------------------------------------------------------------------

/** How heavy each flow level is, for finding the heaviest day. */
const INTENSITY = /** @type {Record<string, number>} */ ({
  none: 0, spotting: 0.5, light: 1, medium: 2, heavy: 3, clots: 3,
});

/**
 * @typedef {Object} FingerprintRow
 * @property {DateKey} start
 * @property {string[]} flows   flow on each bleeding day, day 1 first
 * @property {number} length
 */

/**
 * The shape of her recent periods, newest first.
 *
 * A bleeding day she marked on the calendar without opening it has no log; by
 * the same convention the rest of the app uses it is a medium day. The current
 * period is included even though it is still open, so its row is what she has
 * logged so far.
 *
 * Findings, each null unless the rows support it:
 *
 *   - heaviestDay: the day that is the (first) heaviest in most periods.
 *     A period with the same flow every day has no heaviest day, only a
 *     first one, so those do not vote: otherwise a run of all-medium periods
 *     would "find" that day 1 is her heaviest. Needs three periods that vary,
 *     and 60% of them agreeing.
 *   - lengthTrend: newest three periods against the three before, only when
 *     the difference is at least a day and a half.
 *   - longPeriods: how many in the window ran past 7 days. A count, no claim.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @param {number} [limit]
 * @returns {{rows: FingerprintRow[], heaviestDay: {day: number, share: number}|null,
 *   lengthTrend: {change: number}|null, longPeriods: number}|null}
 */
export function periodFingerprint(logs, cycles, limit = 6) {
  if (cycles.length < 2) return null;

  /** @type {FingerprintRow[]} */
  const rows = cycles.slice(-limit).reverse().map((cycle) => {
    const flows = range(cycle.start, cycle.periodEnd).map((date) => logs[date]?.flow ?? 'medium');
    return { start: cycle.start, flows, length: flows.length };
  });
  if (rows.length < 2) return null;

  /** @type {Map<number, number>} */
  const wins = new Map();
  let voters = 0;
  for (const row of rows) {
    const levels = row.flows.map((f) => INTENSITY[f] ?? 0);
    const top = Math.max(...levels);
    if (levels.every((l) => l === top)) continue;
    voters += 1;
    const day = levels.indexOf(top) + 1;
    wins.set(day, (wins.get(day) ?? 0) + 1);
  }
  /** @type {{day: number, share: number}|null} */
  let heaviestDay = null;
  if (voters >= 3) {
    for (const [day, count] of wins) {
      if (count / voters >= 0.6) heaviestDay = { day, share: count / voters };
    }
  }

  /** @type {{change: number}|null} */
  let lengthTrend = null;
  if (rows.length >= 6) {
    const mean = (/** @type {FingerprintRow[]} */ r) => r.reduce((a, x) => a + x.length, 0) / r.length;
    const change = mean(rows.slice(0, 3)) - mean(rows.slice(3, 6));
    if (Math.abs(change) >= 1.5) lengthTrend = { change: Math.round(change * 10) / 10 };
  }

  return {
    rows,
    heaviestDay,
    lengthTrend,
    longPeriods: rows.filter((r) => r.length > 7).length,
  };
}

// ---------------------------------------------------------------------------
// Easier days
// ---------------------------------------------------------------------------

/** Shortest and longest stretch worth calling "her easier days". */
const EASY_MIN = 4;
const EASY_MAX = 9;

/**
 * The stretch of her cycle where she usually logs the least going wrong.
 *
 * A day "has something" when she logged any symptom or a hard mood. Each
 * aligned day after her period starts gets the share of her cycles in which
 * it had something; the quietest run of at least four days, outside her
 * period, is a candidate. It is only claimed when it is clearly quieter than
 * the rest of her cycle (at most 60% of her usual rate, and at least one
 * chance in a thousand short of what her usual rate would give by luck), so
 * someone who logs little, or logs evenly, gets no window rather than a
 * random one.
 *
 * Counted from the first day of her period: `{from: 7, to: 12}` is cycle days
 * 7 to 12.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @returns {{from: number, to: number}|null}
 */
export function easierDays(logs, cycles) {
  const complete = completeOnly(cycles, logs);
  if (complete.length < MIN_CYCLES) return null;
  const series = alignedSeries(logs, complete, (log) => {
    if (!log.checkedIn && !log.symptoms?.length && !log.moods?.length) return null;
    const rough = (log.symptoms ?? []).some((id) => id !== 'none') || (log.moods ?? []).some(HARD_MOOD);
    return rough ? 1 : 0;
  });
  const all = merge(pool(series.after, 1, AFTER), pool(series.before, 1, BEFORE));
  if (all.n < 30) return null;
  const usual = all.sum / all.n;
  if (usual < 0.15) return null;

  // Never inside her period: the quiet run is about the days between.
  const periodLen = Math.round(complete.reduce((a, c) => a + c.periodLength, 0) / complete.length);
  const first = Math.max(periodLen + 1, 2);
  const rate = means(series.after);

  /** @type {{from: number, to: number, mean: number}|null} */
  let best = null;
  for (let from = first; from + EASY_MIN - 1 <= AFTER; from += 1) {
    const slots = rate.slice(from - 1, from - 1 + EASY_MIN);
    if (slots.some((r) => r == null)) continue;
    const mean = /** @type {number[]} */ (slots).reduce((a, b) => a + b, 0) / EASY_MIN;
    if (!best || mean < best.mean) best = { from, to: from + EASY_MIN - 1, mean };
  }
  if (!best || best.mean > usual * 0.6) return null;

  // Grow it while the next day is just as quiet.
  const limit = usual * 0.6;
  while (best.to < AFTER && best.to - best.from + 1 < EASY_MAX) {
    const r = rate[best.to];
    if (r == null || r > limit) break;
    best.to += 1;
  }

  // And make sure it is not luck: few enough rough days in the run that her
  // usual rate would rarely produce so few.
  const run = pool(series.after, best.from, best.to);
  const roughAtMost = run.sum;
  const quietTail = binomialTail(run.n - roughAtMost, run.n, 1 - usual);
  if (quietTail > CHANCE) return null;

  return { from: best.from, to: best.to };
}
