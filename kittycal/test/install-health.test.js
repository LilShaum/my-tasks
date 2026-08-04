// @ts-check
/**
 * install-health.test.js — when to warn that the browser may delete everything.
 *
 * Two ways to get this wrong. Warning someone whose data is already safe makes
 * the app a liar and trains her to dismiss warnings; staying quiet when Safari
 * is genuinely counting down loses everything she has recorded. Most of these
 * assert silence, and the two that don't are the ones that matter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installNudge, MIN_DATA_DAYS, SNOOZE_DAYS } from '../js/domain/install-health.js';
import { defaultSettings } from '../js/domain/model.js';
import { addDays } from '../js/utils/date.js';

const TODAY = '2026-07-29';

/** A browser that cannot protect her: not installed, not persisted. */
const EXPOSED = { installed: false, persisted: false, canRequest: false };

/** @param {number} days */
const logsOver = (days) => Object.fromEntries(
  Array.from({ length: days }, (_, i) => [addDays(TODAY, -i), { flow: 'none' }]),
);

const ask = (over = {}) => installNudge({
  logs: logsOver(4),
  periodDays: new Set(),
  settings: defaultSettings(),
  today: TODAY,
  storage: EXPOSED,
  ...over,
});

test('an exposed browser with a few days of data gets the warning', () => {
  const nudge = ask();
  assert.ok(nudge);
  assert.equal(nudge.dataDays, 4);
});

test('an installed app is never warned', () => {
  assert.equal(ask({ storage: { ...EXPOSED, installed: true } }), null);
});

test('persistent storage is never warned, installed or not', () => {
  assert.equal(ask({ storage: { ...EXPOSED, persisted: true } }), null);
});

test('one day of data is setup, not a history worth warning about', () => {
  assert.equal(ask({ logs: logsOver(1) }), null);
  assert.ok(ask({ logs: logsOver(MIN_DATA_DAYS) }), 'the second day is the threshold');
});

test('period days count as data on their own', () => {
  const nudge = ask({ logs: {}, periodDays: new Set([TODAY, addDays(TODAY, -1)]) });
  assert.ok(nudge, 'someone who only marks periods still has data to lose');
  assert.equal(nudge.dataDays, 2);
});

test('a day that is both a log and a period day counts once', () => {
  const nudge = ask({ logs: logsOver(2), periodDays: new Set([TODAY]) });
  assert.equal(nudge?.dataDays, 2);
});

test('"not now" buys a fortnight, and not a day more', () => {
  const snoozed = (days) => ask({
    settings: { ...defaultSettings(), installSnoozed: addDays(TODAY, -days) },
  });

  assert.equal(snoozed(0), null, 'silent the day she dismissed it');
  assert.equal(snoozed(SNOOZE_DAYS - 1), null);
  assert.ok(snoozed(SNOOZE_DAYS), 'and back once the fortnight is up');
});

test('a snooze never outlives the risk', () => {
  // The point of the shorter snooze: Safari can act inside a fortnight, so a
  // month of silence would cover a window in which the data is already gone.
  assert.ok(SNOOZE_DAYS <= 14);
});

test('installing while snoozed silences it immediately, without waiting', () => {
  const nudge = ask({
    settings: { ...defaultSettings(), installSnoozed: addDays(TODAY, -30) },
    storage: { ...EXPOSED, installed: true },
  });
  assert.equal(nudge, null);
});

test('canRequest is reported but does not change the decision', () => {
  const without = ask();
  const with_ = ask({ storage: { ...EXPOSED, canRequest: true } });

  assert.ok(without && with_, 'a browser that has persist() and was refused is still exposed');
  assert.equal(without.canRequest, false);
  assert.equal(with_.canRequest, true);
});
