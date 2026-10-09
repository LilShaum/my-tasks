// @ts-check
/**
 * Her reminders: each at the right time, only when it applies, and never for
 * something already done.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reminderPlan, remindersFor, SELF_LIMIT, MORNING, EVENING } from '../js/domain/reminder-plan.js';
import { defaultSettings, emptyLog } from '../js/domain/model.js';
import { addDays } from '../js/utils/date.js';

const TODAY = '2026-10-05';
const NOW = new Date(2026, 9, 5, 7, 0).getTime(); // 7 AM, before the morning ones

/** @param {string} key @param {number} hour @param {number} [min] */
const at = (key, hour, min = 0) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, hour, min).getTime();
};

/** A forecast with the next period ten days out. @param {Record<string, any>} [over] */
const prediction = (over = {}) => /** @type {any} */ ({
  nextStart: addDays(TODAY, 10), avgCycleLength: 28,
  startWindow: { from: addDays(TODAY, 9), to: addDays(TODAY, 11), days: 1 },
  isLate: false, withinWindow: false, expecting: false, stale: false,
  showFertility: true, fertileWindow: { start: addDays(TODAY, 2), end: addDays(TODAY, 8) },
  ovulation: addDays(TODAY, 7),
  ...over,
});

const none = { periodSoon: false, periodSoonDays: 2, periodLate: false, fertile: false, pill: false, pillTime: '21:00', logDaily: false };

/** @param {Record<string, any>} [o] */
const plan = (o = {}) => reminderPlan({
  prediction: prediction(o.prediction),
  settings: { ...defaultSettings(), ...o.settings },
  logs: o.logs ?? {},
  choices: { ...none, ...o.choices },
  today: TODAY,
  now: o.now ?? NOW,
});

test('nothing chosen, nothing planned', () => {
  assert.deepEqual(plan(), []);
});

test('period coming up: two days before, at breakfast, for this period and the next two', () => {
  const p = plan({ choices: { periodSoon: true } });
  assert.deepEqual(p.map((r) => r.at), [
    at(addDays(TODAY, 8), MORNING), at(addDays(TODAY, 36), MORNING), at(addDays(TODAY, 64), MORNING),
  ]);
  assert.equal(p[0].title, 'Your period is likely in 2 days');
  assert.match(p[0].body, /^Around \w{3} 15 Oct\./);
});

test('has it started: the morning after her own range, asked, and not once she is already past it', () => {
  const p = plan({ choices: { periodLate: true } });
  assert.deepEqual(p.map((r) => [r.at, r.title]), [[at(addDays(TODAY, 12), MORNING), 'Has your period started?']]);
  assert.doesNotMatch(p[0].body, /\blate\b/i);
  assert.deepEqual(plan({ choices: { periodLate: true }, prediction: { isLate: true } }), []);
});

test('no period reminders without a forecast to count from', () => {
  for (const over of [{ expecting: true }, { stale: true }, { nextStart: null }]) {
    assert.deepEqual(plan({ choices: { periodSoon: true, periodLate: true, fertile: true }, prediction: over }), [], JSON.stringify(over));
  }
});

test('fertile window: the morning it opens, only while fertility is shown', () => {
  const p = plan({ choices: { fertile: true } });
  assert.deepEqual(p.map((r) => r.at), [at(addDays(TODAY, 2), MORNING), at(addDays(TODAY, 30), MORNING)]);
  assert.deepEqual(plan({ choices: { fertile: true }, prediction: { showFertility: false } }), []);
});

test('the pill: at her time, only for a daily pill, skipping break days and days already marked', () => {
  const pill = { choices: { pill: true, pillTime: '08:30' } };
  assert.deepEqual(plan({ ...pill, settings: { birthControl: 'implant' } }), [], 'an implant has no daily pill');

  const daily = plan({ ...pill, settings: { birthControl: 'pill-combined' } });
  // Today's 8:30 is still ahead at 7 AM, so 30 days from today.
  assert.equal(daily.length, 30);
  assert.equal(daily[0].at, at(TODAY, 8, 30));
  assert.equal(daily[0].title, 'Time for your pill');

  // A 21/7 pack that started 18 days ago: pills 19 to 21, then a week off.
  const pack = plan({ ...pill, settings: { birthControl: 'pill-combined', pillRegimen: '21-7', pillPackStart: addDays(TODAY, -18) } });
  const days = pack.map((r) => new Date(r.at).getDate());
  assert.ok(days.includes(5) && days.includes(7), 'the last three pills of the pack');
  assert.ok(!days.includes(8) && !days.includes(14), 'nothing in the break week');
  assert.match(pack[0].body, /^Pill 19 of 21\./);

  const taken = plan({ ...pill, settings: { birthControl: 'pill-mini' }, logs: { [TODAY]: { ...emptyLog(TODAY), pillTaken: true } } });
  assert.ok(!taken.some((r) => r.at === at(TODAY, 8, 30)), 'today is marked, so no reminder today');
});

test('check-in nudge: 8 PM on days with nothing logged; water alone is not a log', () => {
  const water = { ...emptyLog(TODAY), water: 500 };
  const p = plan({ choices: { logDaily: true }, logs: { [TODAY]: water } });
  assert.equal(p[0].at, at(TODAY, EVENING));
  const done = plan({ choices: { logDaily: true }, logs: { [TODAY]: { ...emptyLog(TODAY), checkedIn: true } } });
  assert.equal(done[0].at, at(addDays(TODAY, 1), EVENING));
});

test('soonest first, nothing already past, and no more than the server keeps', () => {
  const all = plan({
    choices: { periodSoon: true, periodLate: true, fertile: true, pill: true, logDaily: true },
    settings: { birthControl: 'pill-combined' },
    now: at(TODAY, 21, 0),
  });
  assert.ok(all.length <= SELF_LIMIT);
  assert.ok(all.every((r, i) => i === 0 || all[i - 1].at <= r.at));
  assert.ok(all.every((r) => r.at > at(TODAY, 21, 5)), 'tonight’s 8 PM nudge has gone');
});

test('a push shows every reminder due at that time, or the closest within six hours', () => {
  const t = at(TODAY, 21);
  const p = [{ at: t, title: 'a' }, { at: t + 60_000, title: 'b' }, { at: t + 3 * 3600e3, title: 'c' }];
  assert.deepEqual(remindersFor(p, t).map((x) => x.title), ['a', 'b']);
  assert.deepEqual(remindersFor(p, t + 2 * 3600e3).map((x) => x.title), ['c']);
  assert.deepEqual(remindersFor(p, t + 12 * 3600e3), []);
});
