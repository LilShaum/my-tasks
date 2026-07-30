// @ts-check
/**
 * stats.js — patterns across cycles.
 *
 * This is the analysis Flo charges for: cycle-length trends, symptom patterns,
 * how things line up against cycle phase. All of it is arithmetic over data
 * she already has, so there's no reason for it to cost anything.
 *
 * Pure functions, no I/O, so it's all directly testable.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./model.js').DayLog} DayLog
 * @typedef {import('./cycles.js').Cycle} Cycle
 */

import { daysBetween, range, addDays } from '../utils/date.js';
import { cycleContaining } from './cycles.js';
import { phaseInCycle } from './phases.js';

/**
 * The last day belonging to a cycle.
 *
 * `nextStart` is the first day of the *following* cycle, so using it directly
 * as an inclusive range end counts that day twice — once as day 1 of the next
 * cycle and once as the final day of this one. For a symptom logged on day 1
 * that silently inflated every pattern count.
 *
 * @param {Cycle} cycle
 * @returns {DateKey}
 */
function cycleEnd(cycle) {
  return cycle.nextStart ? addDays(cycle.nextStart, -1) : cycle.periodEnd;
}

/** A pattern needs this many cycles behind it before it's worth mentioning. */
const MIN_CYCLES_FOR_PATTERN = 3;

/** And it has to show up in at least this share of them. */
const PATTERN_THRESHOLD = 0.6;

/**
 * Every symptom-ish id logged on a day, flattened. Flow and drive are excluded
 * — they're scales, not occurrences, and would distort a frequency count.
 * @param {DayLog} log
 * @returns {string[]}
 */
export function loggedIds(log) {
  return [
    ...log.symptoms, ...log.moods, ...log.discharge,
    ...log.activity, ...log.other, ...log.sex, ...log.custom,
  ].filter((id) => id !== 'none');
}

/**
 * How often each symptom appears, across all logged days.
 * @param {Record<DateKey, DayLog>} logs
 * @returns {{id: string, count: number}[]} most frequent first
 */
export function symptomFrequency(logs) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const log of Object.values(logs)) {
    for (const id of loggedIds(log)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * For one symptom: in how many of her cycles did it appear, and on which days
 * of the cycle?
 *
 * The day histogram is what makes this useful — "cramps on day 1-2" is
 * actionable in a way that "cramps 14 times" is not.
 *
 * @param {string} symptomId
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @returns {{cyclesWith: number, cyclesTotal: number, byDay: Map<number, number>, peakDays: number[]}}
 */
export function symptomPattern(symptomId, logs, cycles) {
  // Only completed cycles: the current one is still accumulating, and counting
  // it would understate how often a late-cycle symptom occurs.
  const complete = cycles.filter((c) => c.complete);

  /** @type {Map<number, number>} */
  const byDay = new Map();
  let cyclesWith = 0;

  for (const cycle of complete) {
    let seenInCycle = false;

    for (const date of range(cycle.start, cycleEnd(cycle))) {
      const log = logs[date];
      if (!log || !loggedIds(log).includes(symptomId)) continue;
      seenInCycle = true;
      const day = daysBetween(cycle.start, date) + 1;
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }

    if (seenInCycle) cyclesWith++;
  }

  // The cycle days where this shows up most often.
  const max = Math.max(0, ...byDay.values());
  const peakDays = max === 0
    ? []
    : [...byDay.entries()].filter(([, n]) => n === max).map(([day]) => day).sort((a, b) => a - b);

  return { cyclesWith, cyclesTotal: complete.length, byDay, peakDays };
}

/**
 * @typedef {Object} Pattern
 * @property {string} id
 * @property {number} cyclesWith
 * @property {number} cyclesTotal
 * @property {number[]} peakDays
 * @property {number} share    0..1
 */

/**
 * Symptoms that recur reliably enough to be worth surfacing.
 *
 * Deliberately conservative: at least three completed cycles of history, and
 * the symptom has to appear in 60% of them. Announcing a "pattern" from two
 * coincidences would make the whole feature untrustworthy.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @param {number} [limit]
 * @returns {Pattern[]}
 */
export function detectPatterns(logs, cycles, limit = 8) {
  const complete = cycles.filter((c) => c.complete);
  if (complete.length < MIN_CYCLES_FOR_PATTERN) return [];

  /** @type {Pattern[]} */
  const found = [];

  for (const { id } of symptomFrequency(logs)) {
    const pattern = symptomPattern(id, logs, cycles);
    if (pattern.cyclesTotal === 0) continue;
    const share = pattern.cyclesWith / pattern.cyclesTotal;
    if (share < PATTERN_THRESHOLD) continue;
    found.push({
      id,
      cyclesWith: pattern.cyclesWith,
      cyclesTotal: pattern.cyclesTotal,
      peakDays: pattern.peakDays,
      share,
    });
  }

  return found.sort((a, b) => b.share - a.share || b.cyclesWith - a.cyclesWith).slice(0, limit);
}

/**
 * A numeric series for charting, oldest first, skipping days with no reading.
 * @param {Record<DateKey, DayLog>} logs
 * @param {'bbt'|'weight'|'sleep'|'water'|'steps'} field
 * @returns {{date: DateKey, value: number}[]}
 */
export function series(logs, field) {
  return Object.keys(logs)
    .sort()
    .map((date) => ({ date, value: /** @type {any} */ (logs[date])[field] }))
    .filter((point) => typeof point.value === 'number' && Number.isFinite(point.value)
      && !(field === 'water' && point.value === 0));
}

/**
 * BBT readings for one cycle, with the day-of-cycle attached, for the chart.
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle} cycle
 */
export function bbtForCycle(logs, cycle) {
  return range(cycle.start, cycleEnd(cycle))
    .map((date) => ({ date, day: daysBetween(cycle.start, date) + 1, bbt: logs[date]?.bbt ?? null }))
    .filter((p) => p.bbt != null)
    .map((p) => ({ ...p, bbt: /** @type {number} */ (p.bbt) }));
}

/**
 * Which moods she logs at each point in the cycle.
 *
 * Counted per phase and returned with the phase total, because raw counts are
 * not comparable between phases: the luteal stretch is roughly twice the
 * length of the fertile window, so whatever she feels then would top any
 * table simply by having more days in it. The caller divides.
 *
 * Only *complete* cycles are counted. The phase of a past day is worked out
 * from its own cycle by counting back from the next period's start, which
 * needs that next period to exist.
 *
 * Takes the luteal length rather than a phase function on purpose. The
 * obvious thing to pass would be `phaseFor`, which is anchored to the current
 * prediction and returns `unknown` for almost every historical date — an easy
 * mistake that would have produced a chart of nothing.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @param {number} lutealDays
 * @returns {Map<string, {total: number, moods: {id: string, count: number}[]}>}
 *   keyed by phase id, moods most frequent first
 */
export function moodByPhase(logs, cycles, lutealDays) {
  const complete = cycles.filter((c) => c.complete);

  /** @type {Map<string, Map<string, number>>} */
  const raw = new Map();
  /** @type {Map<string, number>} */
  const totals = new Map();

  for (const [date, log] of Object.entries(logs)) {
    if (!log.moods.length) continue;

    const cycle = complete.find((c) => date >= c.start && date < /** @type {string} */ (c.nextStart));
    if (!cycle) continue;

    const phase = phaseInCycle(date, cycle, lutealDays).id;
    if (phase === 'unknown') continue;

    totals.set(phase, (totals.get(phase) ?? 0) + 1);

    if (!raw.has(phase)) raw.set(phase, new Map());
    const bucket = /** @type {Map<string, number>} */ (raw.get(phase));
    for (const mood of log.moods) {
      if (mood === 'none') continue;
      bucket.set(mood, (bucket.get(mood) ?? 0) + 1);
    }
  }

  /** @type {Map<string, {total: number, moods: {id: string, count: number}[]}>} */
  const out = new Map();
  for (const [phase, bucket] of raw) {
    out.set(phase, {
      total: totals.get(phase) ?? 0,
      moods: [...bucket.entries()]
        .map(([id, count]) => ({ id, count }))
        // Ties broken by id so the order is stable between renders.
        .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    });
  }
  return out;
}


/**
 * Consecutive days logged, ending today or yesterday.
 *
 * Yesterday counts so the streak doesn't read as broken first thing in the
 * morning before she's opened the app. Streaks reward logging and never
 * penalise a gap — there is no "you lost your streak" anywhere in this app.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {DateKey} today
 * @param {(key: DateKey, days: number) => DateKey} addDaysFn
 * @returns {number}
 */
export function loggingStreak(logs, today, addDaysFn) {
  let streak = 0;
  let cursor = logs[today] ? today : addDaysFn(today, -1);
  if (!logs[cursor]) return 0;

  while (logs[cursor]) {
    streak++;
    cursor = addDaysFn(cursor, -1);
  }
  return streak;
}

/**
 * Total days with any log, for the "you've tracked N days" line.
 * @param {Record<DateKey, DayLog>} logs
 */
export const daysLogged = (logs) => Object.keys(logs).length;
