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

/** A peak day has to recur in at least this many cycles to be called typical. */
const PEAK_MIN_CYCLES = 2;

/** And no more than this many days may share the top spot. */
const PEAK_MAX_TIED = 3;

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

  /*
    The cycle days where this shows up most often — but only when "most often"
    means something.

    Every day tied at the maximum used to be returned, so a symptom that
    appeared once each on days 2, 7 and 12 came back as peaking on all three,
    and the doctor report printed "typical cycle day: 2, 7, 12". That is noise
    presented as a finding, in a clinical document.

    Two conditions now. The peak has to have happened in at least two cycles,
    or it is a coincidence rather than a tendency. And the tie has to be
    narrow: if half the cycle is joint-first there is no typical day, and
    saying so is better than naming four.
  */
  const max = Math.max(0, ...byDay.values());
  const tied = max < PEAK_MIN_CYCLES
    ? []
    : [...byDay.entries()].filter(([, n]) => n === max).map(([day]) => day).sort((a, b) => a - b);
  const peakDays = tied.length > PEAK_MAX_TIED ? [] : tied;

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
 * morning before she's opened the app.
 *
 * Only ever used to mark a milestone that has been *reached* — never rendered
 * as a running total, because a streak shown continuously is a number that
 * spends most of its life telling her she failed. See `loggingConsistency`,
 * which is what the screens display.
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

/** How far back the consistency figure looks. */
export const CONSISTENCY_WINDOW = 30;

/**
 * How many of the last thirty days have something logged.
 *
 * This is what the screens show, in place of a running streak, and the reason
 * is not cosmetic. A streak resets to zero the first time she misses a day,
 * and a prominent zero is the app telling her she failed — on a screen whose
 * whole job is to make her want to keep going. It is a well-documented way to
 * lose someone: one slip, and the app becomes a source of guilt rather than
 * something worth opening, so it gets deleted rather than restarted.
 *
 * A count over a window degrades gently instead. Missing a day moves it by
 * one, catching up moves it back, and it only reads as zero if she genuinely
 * logged nothing for a month — which is a true statement rather than a
 * punishment for one bad Tuesday.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {DateKey} today
 * @param {(key: DateKey, days: number) => DateKey} addDaysFn
 * @returns {number} 0..CONSISTENCY_WINDOW
 */
export function loggingConsistency(logs, today, addDaysFn) {
  let count = 0;
  for (let i = 0; i < CONSISTENCY_WINDOW; i += 1) {
    if (logs[addDaysFn(today, -i)]) count += 1;
  }
  return count;
}

/**
 * Total days with any log, for the "you've tracked N days" line.
 * @param {Record<DateKey, DayLog>} logs
 */
export const daysLogged = (logs) => Object.keys(logs).length;
