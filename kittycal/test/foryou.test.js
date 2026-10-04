// @ts-check
/**
 * "For you today": what is worth telling her, ranked, and not said twice.
 *
 * The engine is pure, so each test builds a small world (cycles, logs, a real
 * prediction) and asks what it would say. Two things matter most: that each
 * moment turns up when it is true and useful, and that it stays quiet when it
 * would repeat itself, state the obvious, or guess from data that is not there.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { momentsFor, fresh, markSeen } from '../js/domain/foryou.js';
import { predict } from '../js/domain/predict.js';
import { buildCycles } from '../js/domain/cycles.js';
import { defaultSettings, emptyLog } from '../js/domain/model.js';
import { addDays, range } from '../js/utils/date.js';

/** @typedef {import('../js/domain/foryou.js').Moment} Moment */

const TODAY = '2026-06-10';
const TOMORROW = addDays(TODAY, 1);

/**
 * A history of `complete` 28-day cycles followed by an open one, arranged so
 * that today is `until` days before the next period is due (negative: late).
 *
 * `fill` sets fields on a past day given where it sits in its cycle: `before`
 * counts back from the next period (1 = the day before it), `after` forward
 * from the start (1 = the first day of bleeding). Today's own log is `today`.
 * Days of the open cycle get `fill` too, so patterns can be present in it.
 *
 * @param {Object} [o]
 * @param {number} [o.complete]
 * @param {number} [o.until]
 * @param {(ctx: {date: string, after: number, before: number}) => Partial<import('../js/domain/model.js').DayLog>} [o.fill]
 * @param {Partial<import('../js/domain/model.js').DayLog>|null} [o.today]
 * @param {Partial<import('../js/domain/model.js').Settings>} [o.settings]
 * @param {number} [o.hour]
 * @param {string} [o.now]  a different "today" (the same cycle, a day later)
 */
function world({
  complete = 4, until = 2, fill = () => ({}), today = null, settings: patch = {}, hour = 9, now = TODAY,
} = {}) {
  const settings = { ...defaultSettings(), onboarded: true, ...patch };
  const len = settings.avgCycleLength;
  const lastStart = addDays(now, -(len - until));
  /** @type {string[]} */
  const starts = [];
  for (let i = complete; i >= 0; i -= 1) starts.push(addDays(lastStart, -len * i));
  /** @type {string[]} */
  const periodDays = [];
  for (const s of starts) periodDays.push(...range(s, addDays(s, 4)).filter((d) => d <= now));

  const cycles = buildCycles(periodDays);
  /** @type {Record<string, any>} */
  const logs = {};
  const dayNo = (/** @type {string} */ a, /** @type {string} */ b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const next = i + 1 < starts.length ? starts[i + 1] : addDays(lastStart, len);
    for (const date of range(start, addDays(next, -1))) {
      if (date > now) break;
      logs[date] = {
        ...emptyLog(date), checkedIn: true,
        ...fill({ date, after: dayNo(start, date) + 1, before: dayNo(date, next) }),
      };
    }
  }
  if (today) logs[now] = { ...(logs[now] ?? emptyLog(now)), checkedIn: true, ...today };
  const prediction = predict({ periodDays, settings, today: now, logs });
  return { today: now, logs, cycles, prediction, settings, hour };
}

/** @param {ReturnType<typeof world>} w @param {Partial<Parameters<typeof momentsFor>[0]>} [over] */
const moments = (w, over = {}) => momentsFor({ ...w, ...over });
/** @param {Moment[]} list @param {string} kind */
const ofKind = (list, kind) => list.filter((m) => m.kind === kind);

/** @param {Partial<Moment>} m @returns {Moment} */
const moment = (m) => ({
  id: 'x', kind: 'tip', icon: '🎀', text: 't', anchor: null, weight: 1, cooldown: null, ...m,
});

// --- the test world itself -----------------------------------------------------

test('the test world puts today where it says', () => {
  const w = world({ until: 2 });
  assert.equal(w.prediction.daysUntilPeriod, 2);
  assert.equal(w.cycles.filter((c) => c.complete).length, 4);
  assert.equal(world({ until: 9 }).prediction.daysUntilPeriod, 9);
});

// --- when things are due -------------------------------------------------------

test('a period two days away says "likely in 2 days"; one day away says "tomorrow"', () => {
  const two = ofKind(moments(world({ until: 2 })), 'timing');
  assert.equal(two.length, 1);
  assert.match(two[0].text, /likely in 2 days/);
  assert.equal(two[0].cooldown, 0);

  const one = ofKind(moments(world({ until: 1 })), 'timing');
  assert.equal(one.length, 1);
  assert.match(one[0].text, /likely tomorrow/);
  assert.doesNotMatch(one[0].text, /in 1 day/);
});

test('a period more than three days away says nothing about timing', () => {
  const list = moments(world({ until: 4 }));
  assert.deepEqual(ofKind(list, 'timing'), []);
});

test('inside the start window it says "any day now", once ever for that period', () => {
  const [m, ...rest] = ofKind(moments(world({ until: 0 })), 'timing');
  assert.equal(rest.length, 0);
  assert.match(m.text, /any day now/);
  assert.equal(m.cooldown, null);
  assert.match(m.id, /^anyday:/);
});

test('late says how many days, and what usually explains it', () => {
  const [m] = ofKind(moments(world({ until: -5 })), 'timing');
  assert.match(m.id, /^late:/);
  assert.match(m.text, /4 days later than forecast/);
  assert.match(m.text, /Stress, travel or being unwell/);
  // Not an alarm and not a diagnosis.
  assert.doesNotMatch(m.text, /\b(abnormal|worry|condition|disorder)\b/i);
  assert.equal(m.cooldown, 0);

  const [one] = ofKind(moments(world({ until: -2 })), 'timing');
  assert.match(one.text, /1 day later than forecast/);
});

test('late for someone whose cycles vary says so instead of listing reasons', () => {
  // Cycle lengths of 22, 35, 24, 34: far from regular.
  const lengths = [22, 35, 24, 34];
  let start = addDays(TODAY, -(lengths.reduce((a, b) => a + b, 0) + 40));
  const starts = [start];
  for (const len of lengths) { start = addDays(start, len); starts.push(start); }
  const periodDays = starts.flatMap((s) => range(s, addDays(s, 4)));
  const settings = { ...defaultSettings(), onboarded: true };
  const logs = {};
  const prediction = predict({ periodDays, settings, today: TODAY, logs });
  assert.ok(prediction.isLate, 'the fixture should be late');
  assert.notEqual(prediction.regularity, 'regular');
  const list = momentsFor({
    today: TODAY, logs, cycles: buildCycles(periodDays), prediction, settings, hour: 9,
  });
  const [m] = ofKind(list, 'timing');
  assert.match(m.text, /Your cycles vary, so this happens\./);
  assert.doesNotMatch(m.text, /pregnant/);
});

test('every timing id carries what changes, so tomorrow is a new moment', () => {
  const day1 = ofKind(moments(world({ until: 2 })), 'timing')[0];
  const day2 = ofKind(moments(world({ until: 1, now: TOMORROW })), 'timing')[0];
  assert.notEqual(day1.id, day2.id);
  assert.match(day1.text, /in 2 days/);
  assert.match(day2.text, /tomorrow/);

  // Said today, it is out of today's list, and back (as a different moment) tomorrow.
  const seen = markSeen({}, [day1], TODAY);
  assert.deepEqual(fresh([day1], seen, TODAY), []);
  assert.deepEqual(fresh([day2], seen, TOMORROW).map((m) => m.id), [day2.id]);

  // Late moves the same way: the number of days is part of the id.
  const late1 = ofKind(moments(world({ until: -2 })), 'timing')[0];
  const late2 = ofKind(moments(world({ until: -3, now: TOMORROW })), 'timing')[0];
  assert.notEqual(late1.id, late2.id);
  assert.match(late2.text, /2 days later/);
  assert.deepEqual(fresh([late2], markSeen({}, [late1], TODAY), TOMORROW).map((m) => m.id), [late2.id]);
});

test('the same timing moment is not repeated on the same day, but is not blocked forever', () => {
  const [m] = ofKind(moments(world({ until: 2 })), 'timing');
  const seen = markSeen({}, [m], TODAY);
  assert.deepEqual(fresh([m], seen, TODAY), [], 'cooldown 0: not again today');
  assert.deepEqual(fresh([m], seen, TOMORROW).map((x) => x.id), [m.id], 'cooldown 0: fine tomorrow');
});

test('a stale forecast produces no timing or coming moments', () => {
  const w = world({ until: -120, fill: ({ before }) => (before <= 4 ? { symptoms: ['bloating'] } : {}) });
  assert.equal(w.prediction.stale, true);
  const list = moments(w);
  assert.deepEqual(ofKind(list, 'timing'), []);
  assert.deepEqual(ofKind(list, 'coming'), []);
});

test('an expected (positive-test) forecast produces no timing or coming moments', () => {
  const w = world({ until: 2, today: { testPregnancy: 'positive' } });
  assert.equal(w.prediction.expecting, true);
  const list = moments(w);
  assert.deepEqual(ofKind(list, 'timing'), []);
  assert.deepEqual(ofKind(list, 'coming'), []);
});

// --- fertile window ------------------------------------------------------------

test('a fertile window opening tomorrow is said, with its dates', () => {
  const [m] = ofKind(moments(world({ until: 20 })), 'timing');
  assert.match(m.id, /^fertile:/);
  assert.match(m.text, /opens tomorrow/);
  assert.match(m.text, /11 Jun to 17 Jun/);
  assert.equal(m.cooldown, 0);
  const [today] = ofKind(moments(world({ until: 19 })), 'timing');
  assert.match(today.text, /opens today/);
  // Not the day after, and not once it is open.
  assert.deepEqual(ofKind(moments(world({ until: 21 })), 'timing'), []);
  assert.deepEqual(ofKind(moments(world({ until: 18 })), 'timing'), []);
});

test('the fertile window is left out when she has switched fertility off', () => {
  const w = world({ until: 20, settings: { showFertility: false } });
  assert.deepEqual(ofKind(moments(w), 'timing'), []);
});

test('the fertile window is left out on hormonal birth control', () => {
  for (const birthControl of ['pill-combined', 'implant', 'iud-hormonal', 'ring']) {
    const w = world({ until: 20, settings: { birthControl } });
    assert.deepEqual(ofKind(moments(w), 'timing'), [], birthControl);
  }
  // A non-hormonal method does not suppress ovulation.
  const copper = world({ until: 20, settings: { birthControl: 'iud-copper' } });
  assert.equal(ofKind(moments(copper), 'timing').length, 1);
});

test('the fertile window matters more when she is trying to conceive', () => {
  const cycle = ofKind(moments(world({ until: 20, settings: { mode: 'cycle' } })), 'timing')[0];
  const conceive = ofKind(moments(world({ until: 20, settings: { mode: 'conceive' } })), 'timing')[0];
  assert.ok(conceive.weight > cycle.weight, `${conceive.weight} vs ${cycle.weight}`);
  // It outranks a period that is also close; in cycle mode it does not.
  assert.equal(conceive.weight, 6);
  assert.equal(cycle.weight, 3.5);
});

// --- what usually starts about now ---------------------------------------------

/** Bloating from four days before every period. @type {Parameters<typeof world>[0]} */
const bloatingBefore = {
  until: 3,
  fill: ({ before }) => (before <= 4 ? { symptoms: ['bloating'] } : {}),
  today: { symptoms: [] },
};

test('a premenstrual pattern that starts about now is said, once', () => {
  const list = moments(world(bloatingBefore));
  const coming = ofKind(list, 'coming');
  assert.equal(coming.length, 1);
  assert.match(coming[0].text, /Bloating usually starts around now for you \(4 of your last 4 cycles\)/);
  assert.equal(coming[0].anchor, 'insight-body');
  assert.equal(coming[0].cooldown, null);
});

test('a coming pattern is never repeated once seen, however long ago', () => {
  const [m] = ofKind(moments(world(bloatingBefore)), 'coming');
  const seen = markSeen({}, [m], TODAY);
  for (const later of [TODAY, TOMORROW, addDays(TODAY, 30), addDays(TODAY, 59)]) {
    assert.deepEqual(fresh([m], seen, later), [], later);
  }
  // The id names the period it is about, so the next cycle's version is a new moment.
  const nextCycle = world({ ...bloatingBefore, until: 3, now: addDays(TODAY, 28) });
  const [again] = ofKind(moments(nextCycle), 'coming');
  assert.notEqual(again.id, m.id);
  assert.equal(fresh([again], seen, addDays(TODAY, 28)).length, 1);
});

test('too early for the pattern says nothing; one day of margin is allowed', () => {
  // Usually from 4 days before: wait until 5 days out (a day of warning).
  assert.deepEqual(ofKind(moments(world({ ...bloatingBefore, until: 6 })), 'coming'), []);
  assert.equal(ofKind(moments(world({ ...bloatingBefore, until: 5 })), 'coming').length, 1);
  assert.equal(ofKind(moments(world({ ...bloatingBefore, until: 1 })), 'coming').length, 1);
});

test('only one coming moment is produced even when several patterns are due', () => {
  const w = world({
    until: 3,
    fill: ({ before }) => (before <= 4 ? { symptoms: ['bloating', 'headache'] } : {}),
    today: { symptoms: [] },
  });
  assert.equal(ofKind(moments(w), 'coming').length, 1);
});

test('no coming moment when she has already logged that symptom today', () => {
  const w = world({ ...bloatingBefore, today: { symptoms: ['bloating'] } });
  assert.deepEqual(ofKind(moments(w), 'coming'), []);
  // Logging something else does not hide it.
  const other = world({ ...bloatingBefore, today: { symptoms: ['headache'] } });
  assert.equal(ofKind(moments(other), 'coming').length, 1);
});

test('no coming moment when she has already logged that mood today', () => {
  const base = {
    until: 3,
    fill: (/** @type {{before: number}} */ { before }) => (before <= 3 ? { moods: ['irritable'] } : {}),
  };
  const open = world({ ...base, today: { moods: [] } });
  const [m] = ofKind(moments(open), 'coming');
  assert.match(m.text, /Irritable usually starts around now/);

  const logged = world({ ...base, today: { moods: ['irritable'] } });
  assert.deepEqual(ofKind(moments(logged), 'coming'), []);
});

test('no coming moment when the period is late', () => {
  const w = world({ ...bloatingBefore, until: -4 });
  assert.deepEqual(ofKind(moments(w), 'coming'), []);
});

// --- about what she just logged ------------------------------------------------

test('a logged symptom that is usual at this point gets a reassuring moment', () => {
  const w = world({ ...bloatingBefore, today: { symptoms: ['bloating'] } });
  const logged = ofKind(moments(w), 'logged');
  assert.equal(logged.length, 1);
  assert.match(logged[0].id, /^usual:bloating:/);
  assert.match(logged[0].text, /Bloating around now is usual for you \(4 of 4 cycles\)/);
  assert.match(logged[0].text, /doing what it normally does/);
  assert.equal(logged[0].anchor, 'insight-body');
});

test('a logged symptom that is not usual now gets no logged moment', () => {
  // Bloating belongs to the days before the period; today is far from it.
  const w = world({ ...bloatingBefore, until: 14, today: { symptoms: ['bloating'] } });
  assert.deepEqual(ofKind(moments(w), 'logged').filter((m) => m.id.startsWith('usual:')), []);
  // Nothing logged at all: nothing to say about it.
  const quiet = world(bloatingBefore);
  delete quiet.logs[TODAY];
  assert.deepEqual(ofKind(moments(quiet), 'logged'), []);
});

test('a usual period symptom is recognised by cycle day', () => {
  // Cramps on days 1-2 of every period; today is day 2.
  const w = world({
    until: 27,
    fill: ({ after }) => (after <= 2 ? { symptoms: ['cramps'] } : {}),
    today: { symptoms: ['cramps'] },
  });
  assert.equal(w.prediction.cycleDay, 2);
  const [m] = ofKind(moments(w), 'logged');
  assert.match(m.id, /^usual:cramps:/);
});

test('short sleep in the week before her period, with a sleep-dip finding, says so', () => {
  const dip = { until: 3, fill: (/** @type {{before: number}} */ { before }) => ({ sleep: before <= 7 ? 6.5 : 8 }) };
  const w = world({ ...dip, today: { sleep: 5 } });
  const [m] = ofKind(moments(w), 'logged').filter((x) => x.id.startsWith('sleepdip:'));
  assert.ok(m, 'a sleepdip moment');
  assert.match(m.text, /A short night\. Your sleep usually dips in the week before your period/);
  assert.equal(m.anchor, 'insight-sleep');
  assert.equal(m.cooldown, null);

  // Six hours is not short; nor is a short night far from the period.
  const six = world({ ...dip, today: { sleep: 6 } });
  assert.deepEqual(moments(six).filter((x) => x.id.startsWith('sleepdip:')), []);
  const early = world({ ...dip, until: 12, today: { sleep: 5 } });
  assert.deepEqual(moments(early).filter((x) => x.id.startsWith('sleepdip:')), []);
});

test('a short night is not called a dip when her sleep does not dip', () => {
  const w = world({ until: 3, fill: () => ({ sleep: 8 }), today: { sleep: 5 } });
  assert.deepEqual(moments(w).filter((x) => x.id.startsWith('sleepdip:')), []);
});

/** Headaches always on low-water days. @type {Parameters<typeof world>[0]} */
const lowWaterHeadaches = {
  until: 10,
  fill: ({ after }) => (after % 5 < 2 ? { water: 500, symptoms: ['headache'] } : { water: 1800 }),
};

test('low water late in the day, with a low-water finding, says what it goes with', () => {
  const w = world({ ...lowWaterHeadaches, today: { water: 600 }, hour: 16 });
  const [m] = moments(w).filter((x) => x.id.startsWith('water:'));
  assert.ok(m, 'a water moment');
  assert.equal(m.id, `water:${TODAY}`);
  assert.match(m.text, /Under 1 L of water so far\. On your low-water days, headache showed up/);
  assert.equal(m.anchor, 'insight-pairs');
});

test('low water before 15:00 says nothing yet', () => {
  const morning = world({ ...lowWaterHeadaches, today: { water: 600 }, hour: 14 });
  assert.deepEqual(moments(morning).filter((x) => x.id.startsWith('water:')), []);
  const three = world({ ...lowWaterHeadaches, today: { water: 600 }, hour: 15 });
  assert.equal(moments(three).filter((x) => x.id.startsWith('water:')).length, 1);
});

test('no water moment when nothing is logged, enough is logged, or there is no finding', () => {
  const none = world({ ...lowWaterHeadaches, today: { water: 0 }, hour: 18 });
  assert.deepEqual(moments(none).filter((x) => x.id.startsWith('water:')), []);
  const plenty = world({ ...lowWaterHeadaches, today: { water: 1000 }, hour: 18 });
  assert.deepEqual(moments(plenty).filter((x) => x.id.startsWith('water:')), []);
  const noFinding = world({ until: 10, fill: () => ({ water: 500 }), today: { water: 600 }, hour: 18 });
  assert.deepEqual(moments(noFinding).filter((x) => x.id.startsWith('water:')), []);
});

// --- new in Insights -----------------------------------------------------------

/** A sleep dip every cycle. @type {Parameters<typeof world>[0]} */
const sleepDipWorld = { until: 10, fill: ({ before }) => ({ sleep: before <= 7 ? 6.5 : 8 }) };

test('a finding is announced as new in Insights, with a place to open', () => {
  const finds = ofKind(moments(world(sleepDipWorld)), 'finding');
  const dip = finds.find((m) => m.id === 'finding:sleep-dip');
  assert.ok(dip);
  assert.match(dip.text, /^New in Insights: you sleep less in the week before your period\./);
  assert.equal(dip.anchor, 'insight-sleep');
  assert.equal(dip.cooldown, null);
});

test('findings are said once ever', () => {
  const dip = ofKind(moments(world(sleepDipWorld)), 'finding').find((m) => m.id === 'finding:sleep-dip');
  assert.ok(dip);
  assert.equal(fresh([dip], {}, TODAY).length, 1);
  const seen = markSeen({}, [dip], TODAY);
  for (const later of [TOMORROW, addDays(TODAY, 15), addDays(TODAY, 400)]) {
    assert.deepEqual(fresh([dip], seen, later), [], later);
  }
});

test('no finding without the data for one', () => {
  assert.deepEqual(ofKind(moments(world({ complete: 1, until: 10 })), 'finding'), []);
  assert.deepEqual(ofKind(moments(world({ until: 10 })), 'finding'), []);
});

// --- ranking -------------------------------------------------------------------

test('moments come strongest first', () => {
  const w = world({
    until: 2,
    fill: ({ before }) => ({ sleep: before <= 7 ? 6.5 : 8, symptoms: before <= 4 ? ['bloating'] : [] }),
    today: { symptoms: ['bloating'], sleep: 5 },
  });
  const list = moments(w);
  const weights = list.map((m) => m.weight);
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a));
  assert.ok(list.length >= 4);
  assert.equal(list[0].kind, 'timing', 'a period two days away leads');
});

test('nothing is said to someone with no history', () => {
  const settings = { ...defaultSettings(), onboarded: true };
  const prediction = predict({ periodDays: [], settings, today: TODAY, logs: {} });
  assert.deepEqual(
    momentsFor({ today: TODAY, logs: {}, cycles: [], prediction, settings, hour: 18 }), []);
});

// --- fresh -----------------------------------------------------------------------

test('fresh: at most three, strongest first', () => {
  const list = [
    moment({ id: 'a', kind: 'timing', weight: 6 }),
    moment({ id: 'b', kind: 'timing', weight: 5 }),
    moment({ id: 'c', kind: 'timing', weight: 4 }),
    moment({ id: 'd', kind: 'timing', weight: 3 }),
  ];
  assert.deepEqual(fresh(list, {}, TODAY).map((m) => m.id), ['a', 'b', 'c']);
  assert.deepEqual(fresh(list, {}, TODAY, 2).map((m) => m.id), ['a', 'b']);
  assert.deepEqual(fresh([], {}, TODAY), []);
});

test('fresh: one per kind, except timing', () => {
  const list = [
    moment({ id: 'f1', kind: 'finding', weight: 9 }),
    moment({ id: 'f2', kind: 'finding', weight: 8 }),
    moment({ id: 't1', kind: 'timing', weight: 7 }),
    moment({ id: 't2', kind: 'timing', weight: 6 }),
    moment({ id: 'l1', kind: 'logged', weight: 5 }),
    moment({ id: 'l2', kind: 'logged', weight: 4 }),
  ];
  assert.deepEqual(fresh(list, {}, TODAY, 10).map((m) => m.id), ['f1', 't1', 't2', 'l1']);
  // The one passed over for its kind does not use up a slot.
  assert.deepEqual(fresh(list, {}, TODAY).map((m) => m.id), ['f1', 't1', 't2']);
});

test('fresh: a seen finding lets the next of its kind through', () => {
  const list = [
    moment({ id: 'f1', kind: 'finding', weight: 9 }),
    moment({ id: 'f2', kind: 'finding', weight: 8 }),
  ];
  assert.deepEqual(fresh(list, { f1: '2026-01-01' }, TODAY).map((m) => m.id), ['f2']);
});

test('fresh: cooldown 0 means not again the same day', () => {
  const m = moment({ id: 'soon', kind: 'timing', cooldown: 0 });
  assert.deepEqual(fresh([m], { soon: TODAY }, TODAY), []);
  assert.equal(fresh([m], { soon: addDays(TODAY, -1) }, TODAY).length, 1);
});

test('fresh: a 14-day cooldown holds for fourteen days and releases on the fifteenth', () => {
  const tip = moment({ id: 'tip:x', kind: 'tip', cooldown: 14 });
  assert.deepEqual(fresh([tip], { 'tip:x': addDays(TODAY, -1) }, TODAY), []);
  assert.deepEqual(fresh([tip], { 'tip:x': addDays(TODAY, -14) }, TODAY), []);
  assert.equal(fresh([tip], { 'tip:x': addDays(TODAY, -15) }, TODAY).length, 1);
  assert.equal(fresh([tip], {}, TODAY).length, 1, 'never seen');
});

test('fresh: cooldown null is once ever', () => {
  const m = moment({ id: 'once', kind: 'coming', cooldown: null });
  assert.deepEqual(fresh([m], { once: '2020-01-01' }, TODAY), []);
});

test('fresh: other ids do not affect a moment', () => {
  const m = moment({ id: 'a', cooldown: null });
  assert.equal(fresh([m], { b: TODAY }, TODAY).length, 1);
});

// --- markSeen --------------------------------------------------------------------

test('markSeen: records today against every shown id and keeps the rest', () => {
  const next = markSeen({ old: addDays(TODAY, -3) }, [moment({ id: 'a' }), moment({ id: 'b' })], TODAY);
  assert.deepEqual(next, { old: addDays(TODAY, -3), a: TODAY, b: TODAY });
});

test('markSeen: does not mutate what it was given', () => {
  const seen = { old: addDays(TODAY, -3) };
  markSeen(seen, [moment({ id: 'a' })], TODAY);
  assert.deepEqual(seen, { old: addDays(TODAY, -3) });
});

test('markSeen: shown again today refreshes the date', () => {
  const next = markSeen({ a: addDays(TODAY, -20) }, [moment({ id: 'a' })], TODAY);
  assert.equal(next.a, TODAY);
});

test('markSeen: drops ids older than sixty days but keeps finding ids of any age', () => {
  const old = addDays(TODAY, -61);
  const edge = addDays(TODAY, -60);
  const next = markSeen({
    'soon:2025-01-01:2': old,
    'tip:x': old,
    'finding:sleep-dip': old,
    'finding:pairs:lowWater:headache': '2024-01-01',
    'kept:edge': edge,
    'kept:recent': addDays(TODAY, -5),
  }, [], TODAY);
  assert.deepEqual(Object.keys(next).sort(), [
    'finding:pairs:lowWater:headache', 'finding:sleep-dip', 'kept:edge', 'kept:recent',
  ]);
});

test('markSeen: a pruned once-ever finding does not come back', () => {
  const dip = moment({ id: 'finding:sleep-dip', kind: 'finding', cooldown: null });
  let seen = markSeen({}, [dip], '2025-01-01');
  for (let i = 0; i < 5; i += 1) seen = markSeen(seen, [], addDays(TODAY, i));
  assert.equal(seen['finding:sleep-dip'], '2025-01-01');
  assert.deepEqual(fresh([dip], seen, TODAY), []);
});

// --- the two together, as the check-in uses them -----------------------------------

test('end to end: two days out, said once today, then quiet for it until tomorrow', () => {
  const w = world({ until: 2 });
  const shown = fresh(moments(w), {}, TODAY);
  assert.ok(shown.length >= 1 && shown.length <= 3);
  assert.ok(shown.some((m) => /likely in 2 days/.test(m.text)));
  const seen = markSeen({}, shown, TODAY);
  assert.deepEqual(fresh(moments(w), seen, TODAY), [], 'nothing fresh left today');

  const tomorrow = world({ until: 1, now: TOMORROW });
  const next = fresh(moments(tomorrow), seen, TOMORROW);
  assert.ok(next.some((m) => /likely tomorrow/.test(m.text)));
});
