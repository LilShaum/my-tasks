// @ts-check
/**
 * The prediction engine. These tests care less about exact dates than about the
 * behaviours that make the forecast trustworthy: not over-claiming on thin
 * data, widening the fertile window when unsure, re-anchoring when her cycle
 * genuinely changes, and refusing to show ovulation to someone whose ovulation
 * is suppressed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  predict, weightedAverage, detectRecalibration, rateConfidence,
  upcomingPeriods, upcomingFertile, conceptionChance, detectThermalShift,
  CYCLE_MIN_CLAMP, CYCLE_MAX_CLAMP,
} from '../js/domain/predict.js';
import { defaultSettings } from '../js/domain/model.js';
import { range, addDays, daysBetween } from '../js/utils/date.js';

const period = (start, len) => range(start, addDays(start, len - 1));

/** Build a run of `n` periods every `cycle` days from `start`. */
function history(start, cycle, n, periodLen = 5) {
  /** @type {string[]} */
  const days = [];
  for (let i = 0; i < n; i++) {
    days.push(...period(addDays(start, cycle * i), periodLen));
  }
  return days;
}

/** @param {Partial<import('../js/domain/model.js').Settings>} [patch] */
const settings = (patch = {}) => ({ ...defaultSettings(), ...patch });

/* ── weightedAverage ─────────────────────────────────────────────────────── */

test('weightedAverage favours recent cycles', () => {
  // A plain mean of these is 28. Weighting recent higher must pull it upward.
  const plain = 28;
  const weighted = weightedAverage([26, 26, 26, 30, 30, 30]);
  assert.ok(weighted != null && weighted > plain,
    `expected > ${plain}, got ${weighted}`);
});

test('weightedAverage on a steady history returns that value', () => {
  assert.equal(weightedAverage([28, 28, 28, 28]), 28);
});

test('weightedAverage only considers the last six cycles', () => {
  // The leading 40s are outside the window and must not affect the result.
  assert.equal(weightedAverage([40, 40, 40, 28, 28, 28, 28, 28, 28]), 28);
});

test('weightedAverage of an empty list is null, not NaN', () => {
  assert.equal(weightedAverage([]), null);
});

/* ── recalibration ───────────────────────────────────────────────────────── */

test('a sustained shift triggers recalibration onto the recent cycles', () => {
  // Settled at 28 for a while, then three cycles at 34.
  const result = detectRecalibration([28, 28, 28, 34, 34, 34]);
  assert.equal(result.recalibrated, true);
  assert.equal(result.value, 34);
});

test('a single unusual cycle does not trigger recalibration', () => {
  const result = detectRecalibration([28, 28, 28, 28, 28, 36]);
  assert.equal(result.recalibrated, false);
});

test('two shifted cycles are not yet a sustained change', () => {
  const result = detectRecalibration([28, 28, 28, 28, 35, 35]);
  assert.equal(result.recalibrated, false);
});

test('recalibration works downward too', () => {
  const result = detectRecalibration([34, 34, 34, 27, 27, 27]);
  assert.equal(result.recalibrated, true);
  assert.equal(result.value, 27);
});

test('recalibration needs enough history to have a baseline', () => {
  assert.equal(detectRecalibration([34, 34, 34]).recalibrated, false);
});

/* ── confidence ──────────────────────────────────────────────────────────── */

test('confidence rises with logged cycles and falls with variation', () => {
  assert.equal(rateConfidence(0, null), 'none');
  assert.equal(rateConfidence(1, 0), 'low');
  assert.equal(rateConfidence(2, 2), 'medium');
  assert.equal(rateConfidence(5, 2), 'high');
  assert.equal(rateConfidence(5, 10), 'medium', 'wide spread caps confidence');
  assert.equal(rateConfidence(5, 20), 'low', 'very wide spread is low');
});

/* ── predict: the cold start ─────────────────────────────────────────────── */

test('with no data at all there is nothing to predict', () => {
  const p = predict({ periodDays: [], settings: settings(), today: '2026-07-27' });
  assert.equal(p.confidence, 'none');
  assert.equal(p.nextStart, null);
  assert.equal(p.nextPeriod, null);
  assert.equal(p.ovulation, null);
  assert.equal(p.cycleDay, null);
  assert.equal(p.cyclesLogged, 0);
});

test('one logged period predicts from her stated average', () => {
  const p = predict({
    periodDays: period('2026-07-01', 5),
    settings: settings({ avgCycleLength: 30 }),
    today: '2026-07-10',
  });
  assert.equal(p.avgCycleLength, 30);
  assert.equal(p.nextStart, '2026-07-31');
  assert.equal(p.cycleDay, 10);
  assert.equal(p.confidence, 'none', 'no completed cycles yet');
  assert.match(p.basis, /stated average/);
});

test('a first completed cycle is blended with her stated average', () => {
  // One observed cycle of 26 against a stated 30 should land between them,
  // rather than swinging fully onto a single observation.
  const p = predict({
    periodDays: [...period('2026-06-01', 5), ...period('2026-06-27', 5)],
    settings: settings({ avgCycleLength: 30 }),
    today: '2026-07-01',
  });
  assert.equal(p.cyclesLogged, 1);
  assert.equal(p.avgCycleLength, 28, '(26 + 30) / 2');
  assert.match(p.basis, /blended/);
});

/* ── predict: the settled case ───────────────────────────────────────────── */

test('a regular history predicts the next period accurately', () => {
  const days = history('2026-01-05', 28, 6);
  const lastStart = addDays('2026-01-05', 28 * 5);
  const p = predict({ periodDays: days, settings: settings(), today: lastStart });

  assert.equal(p.cyclesLogged, 5);
  assert.equal(p.avgCycleLength, 28);
  assert.equal(p.confidence, 'high');
  assert.equal(p.regularity, 'regular');
  assert.equal(p.spread, 0);
  assert.equal(p.nextStart, addDays(lastStart, 28));
  assert.equal(p.daysUntilPeriod, 28);
  assert.equal(p.isLate, false);
});

test('ovulation is counted back from the next period, not the midpoint', () => {
  const days = history('2026-01-05', 28, 4);
  const lastStart = addDays('2026-01-05', 28 * 3);
  const p = predict({
    periodDays: days,
    settings: settings({ lutealLength: 14 }),
    today: lastStart,
  });

  assert.ok(p.nextStart && p.ovulation);
  assert.equal(daysBetween(p.ovulation, p.nextStart), 14);
});

test('a non-default luteal length moves ovulation accordingly', () => {
  const days = history('2026-01-05', 30, 4);
  const lastStart = addDays('2026-01-05', 30 * 3);
  const p = predict({
    periodDays: days,
    settings: settings({ lutealLength: 11, avgCycleLength: 30 }),
    today: lastStart,
  });
  assert.ok(p.nextStart && p.ovulation);
  assert.equal(daysBetween(p.ovulation, p.nextStart), 11);
});

test('the fertile window spans ovulation minus five to plus one', () => {
  const days = history('2026-01-05', 28, 5);
  const p = predict({
    periodDays: days, settings: settings(), today: addDays('2026-01-05', 28 * 4),
  });
  assert.ok(p.ovulation && p.fertileWindow);
  assert.equal(daysBetween(p.fertileWindow.start, p.ovulation), 5);
  assert.equal(daysBetween(p.ovulation, p.fertileWindow.end), 1);
  assert.equal(p.fertileWidened, false);
});

/* ── predict: honesty under uncertainty ──────────────────────────────────── */

test('a thin history widens the fertile window and flags that it did', () => {
  const p = predict({
    periodDays: [...period('2026-06-01', 5), ...period('2026-06-29', 5)],
    settings: settings(),
    today: '2026-07-05',
  });
  assert.equal(p.confidence, 'low');
  assert.equal(p.fertileWidened, true);
  assert.ok(p.fertileWindow);
  const width = daysBetween(p.fertileWindow.start, p.fertileWindow.end) + 1;
  assert.equal(width, 14, 'widened rather than narrow and overconfident');
});

test('very irregular cycles are reported as irregular', () => {
  const days = [
    ...period('2026-01-01', 5),
    ...period('2026-01-22', 5), // 21
    ...period('2026-03-01', 5), // 38
    ...period('2026-03-24', 5), // 23
    ...period('2026-05-01', 5), // 38
  ];
  const p = predict({ periodDays: days, settings: settings(), today: '2026-05-10' });
  assert.equal(p.regularity, 'irregular');
  assert.ok(p.spread != null && p.spread > 9);
  assert.notEqual(p.confidence, 'high');
});

test('predicted cycle length is clamped to a physiological range', () => {
  // A wildly long stated average must not produce a 90-day forecast.
  const high = predict({
    periodDays: period('2026-07-01', 5),
    settings: settings({ avgCycleLength: 85 }),
    today: '2026-07-02',
  });
  assert.equal(high.avgCycleLength, CYCLE_MAX_CLAMP);

  const low = predict({
    periodDays: period('2026-07-01', 5),
    settings: settings({ avgCycleLength: 15 }),
    today: '2026-07-02',
  });
  assert.equal(low.avgCycleLength, CYCLE_MIN_CLAMP);
});

/* ── predict: lateness ───────────────────────────────────────────────────── */

test('a period past its predicted date reports as late', () => {
  const days = history('2026-01-05', 28, 4);
  const lastStart = addDays('2026-01-05', 28 * 3);
  const expected = addDays(lastStart, 28);
  const today = addDays(expected, 4);

  const p = predict({ periodDays: days, settings: settings(), today });
  assert.equal(p.isLate, true);
  assert.equal(p.daysLate, 4);
  assert.equal(p.daysUntilPeriod, -4);
});

test('the day the period is due is not yet late', () => {
  const days = history('2026-01-05', 28, 4);
  const lastStart = addDays('2026-01-05', 28 * 3);
  const p = predict({
    periodDays: days, settings: settings(), today: addDays(lastStart, 28),
  });
  assert.equal(p.isLate, false);
  assert.equal(p.daysUntilPeriod, 0);
});

/* ── predict: the contraception rule ─────────────────────────────────────── */

test('hormonal birth control suppresses all fertility output', () => {
  const days = history('2026-01-05', 28, 6);
  const today = addDays('2026-01-05', 28 * 5);

  for (const method of ['pill-combined', 'pill-mini', 'implant', 'injection',
    'iud-hormonal', 'patch', 'ring']) {
    const p = predict({
      periodDays: days, settings: settings({ birthControl: method }), today,
    });
    assert.equal(p.showFertility, false, `${method} should hide fertility`);
    assert.equal(p.ovulation, null, `${method} should have no ovulation day`);
    assert.equal(p.fertileWindow, null, `${method} should have no fertile window`);
    // The period forecast still works — that part is still meaningful.
    assert.ok(p.nextStart, `${method} should still predict a period`);
  }
});

test('non-hormonal methods keep fertility predictions', () => {
  const days = history('2026-01-05', 28, 6);
  const today = addDays('2026-01-05', 28 * 5);
  for (const method of ['none', 'condoms', 'iud-copper', 'fertility-awareness']) {
    const p = predict({
      periodDays: days, settings: settings({ birthControl: method }), today,
    });
    assert.equal(p.showFertility, true, `${method} should keep fertility`);
    assert.ok(p.ovulation, `${method} should have an ovulation day`);
  }
});

test('turning fertility off in settings also hides it', () => {
  const days = history('2026-01-05', 28, 6);
  const p = predict({
    periodDays: days,
    settings: settings({ showFertility: false }),
    today: addDays('2026-01-05', 28 * 5),
  });
  assert.equal(p.showFertility, false);
  assert.equal(p.ovulation, null);
});

/* ── forward projections ─────────────────────────────────────────────────── */

test('upcomingPeriods steps forward by one cycle each time', () => {
  const days = history('2026-01-05', 28, 5);
  const p = predict({
    periodDays: days, settings: settings(), today: addDays('2026-01-05', 28 * 4),
  });
  const upcoming = upcomingPeriods(p, 3);

  assert.equal(upcoming.length, 3);
  assert.equal(upcoming[0].start, p.nextStart);
  assert.equal(daysBetween(upcoming[0].start, upcoming[1].start), 28);
  assert.equal(daysBetween(upcoming[1].start, upcoming[2].start), 28);
  assert.deepEqual(upcoming.map((u) => u.ordinal), [0, 1, 2]);
});

test('upcomingPeriods is empty with no history', () => {
  const p = predict({ periodDays: [], settings: settings(), today: '2026-07-27' });
  assert.deepEqual(upcomingPeriods(p, 3), []);
});

test('upcomingFertile is empty when fertility is suppressed', () => {
  const days = history('2026-01-05', 28, 5);
  const p = predict({
    periodDays: days,
    settings: settings({ birthControl: 'pill-combined' }),
    today: addDays('2026-01-05', 28 * 4),
  });
  assert.deepEqual(upcomingFertile(p, 3), []);
});

test('upcomingFertile windows match the primary prediction', () => {
  const days = history('2026-01-05', 28, 5);
  const p = predict({
    periodDays: days, settings: settings(), today: addDays('2026-01-05', 28 * 4),
  });
  const windows = upcomingFertile(p, 2);
  assert.equal(windows[0].ovulation, p.ovulation);
  assert.equal(windows[0].start, p.fertileWindow?.start);
  assert.equal(windows[0].end, p.fertileWindow?.end);
});

/* ── conception chance ───────────────────────────────────────────────────── */

test('conception chance peaks on ovulation day and the day before', () => {
  const days = history('2026-01-05', 28, 5);
  const p = predict({
    periodDays: days, settings: settings(), today: addDays('2026-01-05', 28 * 4),
  });
  assert.ok(p.ovulation && p.fertileWindow);

  assert.equal(conceptionChance(p, p.ovulation).tier, 'high');
  assert.equal(conceptionChance(p, addDays(p.ovulation, -1)).tier, 'high');
  assert.equal(conceptionChance(p, addDays(p.ovulation, -4)).tier, 'some');
  assert.equal(conceptionChance(p, addDays(p.ovulation, 8)).tier, 'low');
});

test('conception chance is not estimated when fertility is hidden', () => {
  const days = history('2026-01-05', 28, 5);
  const p = predict({
    periodDays: days,
    settings: settings({ birthControl: 'implant' }),
    today: addDays('2026-01-05', 28 * 4),
  });
  assert.equal(conceptionChance(p, '2026-05-01').tier, 'none');
});

/* ── BBT thermal shift ───────────────────────────────────────────────────── */

test('a sustained temperature rise is detected', () => {
  const readings = [
    { date: '2026-07-01', bbt: 36.40 },
    { date: '2026-07-02', bbt: 36.35 },
    { date: '2026-07-03', bbt: 36.42 },
    { date: '2026-07-04', bbt: 36.38 },
    { date: '2026-07-05', bbt: 36.41 },
    { date: '2026-07-06', bbt: 36.36 },
    // Shift begins here: ~0.3 above the previous six-day mean of ~36.39
    { date: '2026-07-07', bbt: 36.70 },
    { date: '2026-07-08', bbt: 36.75 },
    { date: '2026-07-09', bbt: 36.72 },
  ];
  assert.equal(detectThermalShift(readings), '2026-07-07');
});

test('a single warm day is not a thermal shift', () => {
  const readings = [
    { date: '2026-07-01', bbt: 36.40 },
    { date: '2026-07-02', bbt: 36.35 },
    { date: '2026-07-03', bbt: 36.42 },
    { date: '2026-07-04', bbt: 36.38 },
    { date: '2026-07-05', bbt: 36.41 },
    { date: '2026-07-06', bbt: 36.36 },
    { date: '2026-07-07', bbt: 36.80 },
    { date: '2026-07-08', bbt: 36.38 },
    { date: '2026-07-09', bbt: 36.40 },
  ];
  assert.equal(detectThermalShift(readings), null);
});

test('too few readings cannot produce a shift', () => {
  assert.equal(detectThermalShift([{ date: '2026-07-01', bbt: 36.4 }]), null);
  assert.equal(detectThermalShift([]), null);
});

/* ── a realistic end-to-end scenario ────────────────────────────────────── */

test('a year of slightly variable logging produces a sane forecast', () => {
  const lengths = [27, 29, 28, 30, 26, 28, 29, 27, 28, 31, 28];
  /** @type {string[]} */
  const days = [];
  let start = '2026-01-03';
  for (const length of lengths) {
    days.push(...period(start, 5));
    start = addDays(start, length);
  }
  days.push(...period(start, 5));

  const p = predict({ periodDays: days, settings: settings(), today: start });

  assert.equal(p.cyclesLogged, lengths.length);
  assert.equal(p.confidence, 'high');
  assert.equal(p.regularity, 'regular');
  assert.ok(p.avgCycleLength >= 27 && p.avgCycleLength <= 30,
    `expected a plausible average, got ${p.avgCycleLength}`);
  assert.equal(p.cycleDay, 1, 'today is the first day of the newest period');
  assert.ok(p.nextStart && p.ovulation && p.fertileWindow);
  assert.equal(p.fertileWidened, false);
});
