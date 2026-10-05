// @ts-check
/**
 * His heads-ups: when they are planned, what they say, and which one a push
 * that has just arrived is for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pushPlan, pushFor, EVENING_HOUR, MORNING_HOUR, PLAN_LIMIT } from '../js/domain/push-plan.js';
import { addDays } from '../js/utils/date.js';

const TODAY = '2026-10-05';
const NOW = new Date(2026, 9, 5, 12, 0).getTime();
const local = (/** @type {string} */ key, /** @type {number} */ hour) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
};

/** Her period due in `until` days, harder days from 4 days before. */
const snap = (until, over = {}) => /** @type {import('../js/domain/partner.js').Snapshot} */ ({
  v: 2, name: 'Mia', updated: TODAY, paused: false,
  lastStart: addDays(TODAY, until - 28), nextStart: addDays(TODAY, until),
  cycleLength: 28, periodLength: 5, lutealDays: 14, phase: true, fertile: false,
  patterns: [], mood: 4, helps: '', theme: 'mymelody',
  lanes: [{ id: 'harder-days', label: 'Harder days', kind: 'mood', from: -4, to: -1 }],
  easy: null, stats: null, status: null, ...over,
});

test('the evening before each expected period, and only when he asked', () => {
  const plan = pushPlan(snap(10), { period: true, harder: false }, TODAY, NOW);
  assert.equal(plan[0].at, local(addDays(TODAY, 9), EVENING_HOUR));
  assert.equal(plan[0].title, 'Mia’s period is likely tomorrow');
  assert.equal(plan[1].at, local(addDays(TODAY, 37), EVENING_HOUR), 'and the one after, a cycle later');
  assert.deepEqual(pushPlan(snap(10), { period: false, harder: false }, TODAY, NOW), []);
});

test('the morning harder days usually start', () => {
  const plan = pushPlan(snap(10), { period: false, harder: true }, TODAY, NOW);
  assert.equal(plan[0].at, local(addDays(TODAY, 6), MORNING_HOUR), 'four days before her period');
  assert.match(plan[0].title, /Harder days usually start about now for Mia/);
  // Nothing to plan if she does not share it.
  assert.deepEqual(pushPlan(snap(10, { lanes: [] }), { period: false, harder: true }, TODAY, NOW), []);
});

test('nothing in the past, soonest first, never more than the server keeps', () => {
  // Due tomorrow: this evening's heads-up is still ahead at noon.
  const soon = pushPlan(snap(1), { period: true, harder: true }, TODAY, NOW);
  assert.equal(soon[0].at, local(TODAY, EVENING_HOUR));
  assert.ok(soon.every((p, i) => i === 0 || p.at >= soon[i - 1].at));
  const late = pushPlan(snap(1), { period: true, harder: true }, TODAY, local(TODAY, 20));
  assert.ok(late.every((p) => p.at > local(TODAY, 20)), 'not once it has gone by');
  assert.ok(pushPlan(snap(10), { period: true, harder: true }, TODAY, NOW).length <= PLAN_LIMIT);
});

test('a paused summary plans nothing', () => {
  assert.deepEqual(pushPlan(snap(10, { paused: true }), { period: true, harder: true }, TODAY, NOW), []);
});

test('pushFor: the closest plan entry within six hours, or none', () => {
  const plan = [{ at: 1000, title: 'a', body: '' }, { at: 1000 + 10 * 3600e3, title: 'b', body: '' }];
  assert.equal(pushFor(plan, 1000 + 60_000)?.title, 'a');
  assert.equal(pushFor(plan, 1000 + 9 * 3600e3)?.title, 'b');
  assert.equal(pushFor(plan, 1000 + 30 * 3600e3), null);
});
