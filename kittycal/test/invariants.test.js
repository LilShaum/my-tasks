// @ts-check
/**
 * invariants.test.js — the rules the forecast must obey for *any* history.
 *
 * The other prediction tests are examples: a tidy 28-day history, a sustained
 * shift, a woman on the pill. Examples are how you check that the maths is
 * right, and they only ever check the cases someone thought of. Real histories
 * are messier than anything written by hand — forgotten days mid-period, a
 * period logged twice three days apart, an eight-month gap, a date typed in by
 * a phone with the wrong year — and the failures that matter are the
 * combinations nobody would sit down and write a test for.
 *
 * So this generates thousands of them from a fixed seed and asserts the
 * properties that must hold regardless: no cycle runs backwards, no day belongs
 * to two periods, ovulation never falls outside its own fertile window, a stale
 * record never carries a confident forecast. Deterministic, so a failure here
 * is reproducible rather than a flake — change the seed to widen the search.
 *
 * This is the file that caught the cycle-length clamp discarding the number she
 * was asked for, which every example test had agreed was correct.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPeriods, buildCycles, filledPeriodDays, cycleDay, cycleContaining,
  cycleLengths, CYCLE_LENGTH_FLOOR, CYCLE_LENGTH_CEIL,
} from '../js/domain/cycles.js';
import {
  predict, upcomingPeriods, upcomingFertile, conceptionChance,
  CYCLE_MIN_CLAMP, CYCLE_STATED_MIN, CYCLE_STATED_MAX,
} from '../js/domain/predict.js';
import { normalizeSettings, defaultSettings } from '../js/domain/model.js';
import { addDays, daysBetween } from '../js/utils/date.js';

/** The gap tolerance and merge threshold `cycles.js` promises to enforce. */
const MIN_PLAUSIBLE_CYCLE = 10;

const TODAY = /** @type {any} */ ('2026-09-30');
const ITERATIONS = 4000;

/** A fixed-seed LCG, so a failure is always reproducible. */
function generator(seed) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return {
    rnd,
    int: (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1)),
    pick: (a) => a[Math.floor(rnd() * a.length)],
  };
}

/**
 * A history that looks like one a real person produced, including the ways
 * real histories are broken.
 */
function randomHistory(g) {
  const count = g.pick([0, 0, 1, 2, 3, 5, 8, 14, 30]);
  /** @type {string[]} */
  const days = [];
  let cursor = addDays(TODAY, -g.int(0, 900));
  for (let i = 0; i < count; i++) {
    const bleed = g.int(1, g.pick([3, 5, 9, 14]));
    for (let d = 0; d < bleed; d++) {
      if (g.rnd() < 0.15) continue;              // a day she forgot to mark
      days.push(addDays(cursor, d));
    }
    // Gaps short enough to merge, ordinary, long, and absurd.
    cursor = addDays(cursor, g.int(1, g.pick([12, 28, 45, 120, 400])));
  }
  // A phone with the wrong clock, or a hand-edited file.
  if (g.rnd() < 0.1) days.push(addDays(TODAY, g.int(1, 60)));
  return [...new Set(days)].sort();
}

/** Settings as they can actually reach `predict` — i.e. past validation. */
function randomSettings(g) {
  return normalizeSettings({
    ...defaultSettings(),
    avgCycleLength: g.int(CYCLE_STATED_MIN, CYCLE_STATED_MAX),
    avgPeriodLength: g.int(1, 14),
    lutealLength: g.int(8, 20),
    birthControl: g.pick(['none', 'pill', 'iud-hormonal', 'iud-copper', 'condoms', 'implant']),
    showFertility: g.rnd() < 0.8,
  });
}

test('cycles derived from any history are well-formed', () => {
  const g = generator(20260930);
  for (let i = 0; i < ITERATIONS; i++) {
    const periodDays = randomHistory(g);
    const where = () => `history: ${JSON.stringify(periodDays)}`;

    const periods = buildPeriods(periodDays);
    for (let j = 1; j < periods.length; j++) {
      assert.ok(periods[j].start > periods[j - 1].end, `periods overlap — ${where()}`);
      assert.ok(
        daysBetween(periods[j - 1].start, periods[j].start) >= MIN_PLAUSIBLE_CYCLE,
        `two starts closer than ${MIN_PLAUSIBLE_CYCLE} days survived the merge — ${where()}`,
      );
    }
    for (const p of periods) {
      assert.equal(p.length, daysBetween(p.start, p.end) + 1, `length disagrees with span — ${where()}`);
      assert.ok(p.days.every((d) => d >= p.start && d <= p.end), `day outside its span — ${where()}`);
    }

    // Nothing invented, nothing lost, nothing counted twice.
    const covered = periods.flatMap((p) => p.days);
    assert.deepEqual([...covered].sort(), periodDays, `days went missing or doubled — ${where()}`);

    const cycles = buildCycles(periodDays);
    const filled = filledPeriodDays(cycles);
    for (const d of periodDays) {
      assert.ok(filled.has(d), `${d} is logged but not filled — ${where()}`);
    }
    for (const c of cycles) {
      assert.ok(c.length == null || c.length > 0, `non-positive cycle length — ${where()}`);
      assert.ok(c.periodEnd >= c.start, `period ends before it starts — ${where()}`);
      assert.ok(c.nextStart == null || c.periodEnd < c.nextStart,
        `period runs into the next cycle — ${where()}`);
      assert.equal(cycleContaining(cycles, c.start), c, `a cycle lost its own start — ${where()}`);
      assert.ok((cycleDay(cycles, c.start) ?? 0) >= 1, `day-of-cycle below 1 — ${where()}`);
    }
    for (const n of cycleLengths(cycles)) {
      assert.ok(n >= CYCLE_LENGTH_FLOOR && n <= CYCLE_LENGTH_CEIL,
        `implausible length ${n} reached the average — ${where()}`);
    }
  }
});

test('the forecast never contradicts itself, whatever it is given', () => {
  const g = generator(19840614);
  for (let i = 0; i < ITERATIONS; i++) {
    const periodDays = randomHistory(g);
    const settings = randomSettings(g);
    const where = () => `history: ${JSON.stringify(periodDays)}\nsettings: ${JSON.stringify(settings)}`;

    const p = predict({ periodDays, settings, today: TODAY, logs: {} });
    const ok = (cond, msg) => assert.ok(cond, `${msg}\n  ${where()}`);

    ok(p.avgCycleLength >= Math.min(CYCLE_MIN_CLAMP, settings.avgCycleLength)
      && p.avgCycleLength <= Math.max(45, settings.avgCycleLength),
    `cycle length ${p.avgCycleLength} escaped its bounds`);
    ok(p.avgPeriodLength >= 1 && p.avgPeriodLength <= 14,
      `period length ${p.avgPeriodLength} escaped its bounds`);

    // A day that has not happened cannot say where she is now.
    ok(p.lastStart == null || p.lastStart <= TODAY, 'lastStart is in the future');
    ok(p.nextStart == null || p.lastStart == null || p.nextStart > p.lastStart,
      'the next period is not after the last');
    ok(p.cycleDay == null || p.cycleDay >= 1, `cycle day ${p.cycleDay} is below 1`);
    ok(p.nextStart == null || p.daysUntilPeriod === daysBetween(TODAY, p.nextStart),
      'the countdown disagrees with the date it counts to');

    // Staleness must take everything down with it — a confident badge over a
    // dead record is the most misleading thing the app can show.
    if (p.stale) {
      ok(p.nextStart == null && p.nextPeriod == null && p.startWindow == null
        && p.daysUntilPeriod == null && p.confidence === 'none'
        && p.ovulation == null && p.fertileWindow == null,
      'a stale record still carried a forecast');
      ok(p.staleReason != null, 'stale with no reason to show her');
    } else {
      ok(p.staleReason == null, 'a reason was given without staleness');
    }

    ok(!(p.isLate && p.withinWindow), 'late and not-yet-late at the same time');
    ok(p.isLate === (p.daysLate != null && p.daysLate > 0),
      'the late count disagrees with the late flag');
    ok(p.startWindow == null || p.nextStart == null
      || (p.startWindow.from < p.nextStart && p.startWindow.to > p.nextStart),
    'the start window does not bracket its own estimate');

    // Fertility: suppressed means absent, not merely hidden.
    ok(!(p.onHormonal && p.showFertility), 'ovulation shown to someone who is not ovulating');
    ok(p.showFertility || (p.ovulation == null && p.fertileWindow == null),
      'fertility output produced while fertility is off');
    ok(p.ovulation == null || p.fertileWindow == null
      || (p.ovulation >= p.fertileWindow.start && p.ovulation <= p.fertileWindow.end),
    'ovulation fell outside its own fertile window');
    ok(p.ovulation == null || p.nextStart == null || p.ovulation < p.nextStart,
      'ovulation lands on or after the next period');
    ok(p.fertileWindow == null || p.nextStart == null || p.fertileWindow.end < p.nextStart,
      'the fertile window runs into the next period');
    if (p.ovulation) {
      assert.equal(conceptionChance(p, p.ovulation).tier, 'high',
        `ovulation day is not peak fertility\n  ${where()}`);
    }

    ok(p.nextPeriod == null || p.nextPeriod.start === p.nextStart,
      'the predicted bleed does not begin on the predicted start');
    ok(p.confidence !== 'none' || p.cyclesLogged === 0 || p.stale,
      'confidence collapsed with cycles on record and no staleness');
    ok(Number.isFinite(p.lutealDays) && p.lutealDays > 0, 'luteal length is not a usable number');

    // Projections forward.
    const ahead = upcomingPeriods(p, 4);
    ok(p.nextStart != null || ahead.length === 0, 'projected a period with nothing to project from');
    for (let j = 1; j < ahead.length; j++) {
      ok(ahead[j].start > ahead[j - 1].end, 'projected periods overlap');
    }
    const fertile = upcomingFertile(p, 4);
    for (const f of fertile) {
      ok(f.ovulation >= f.start && f.ovulation <= f.end,
        'a projected fertile window does not contain its ovulation');
    }
    if (fertile.length) {
      assert.equal(fertile[0].ovulation, p.ovulation,
        `the first projection disagrees with the prediction\n  ${where()}`);
      assert.deepEqual(
        { start: fertile[0].start, end: fertile[0].end },
        { start: p.fertileWindow?.start, end: p.fertileWindow?.end },
        `the first projected window disagrees with the prediction\n  ${where()}`,
      );
    }
  }
});
