// @ts-check
/**
 * backup-health.test.js — when to mention backing up.
 *
 * The failure this guards against is not a crash, it is a nag: something that
 * appears too often becomes something she taps past without reading, and the
 * one time it matters she taps past it too. So most of these assert silence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  backupNudge, MIN_DAYS_AT_RISK, SNOOZE_DAYS,
} from '../js/domain/backup-health.js';
import { defaultSettings } from '../js/domain/model.js';
import { addDays } from '../js/utils/date.js';

const TODAY = '2026-07-29';

/** @param {Partial<import('../js/domain/model.js').Settings>} patch */
const settingsWith = (patch = {}) => ({ ...defaultSettings(), ...patch });

/**
 * `n` logged days ending today, each stamped `updated` at `at`.
 * @param {number} n
 * @param {number} at epoch ms
 */
function logsOf(n, at = Date.now()) {
  /** @type {Record<string, any>} */
  const logs = {};
  for (let i = 0; i < n; i++) {
    const date = addDays(TODAY, -i);
    logs[date] = {
      date, flow: 'none', symptoms: ['cramps'], moods: [], discharge: [],
      activity: [], other: [], sex: [], custom: [], drive: null,
      bbt: null, weight: null, water: 0, sleep: null, steps: null,
      pillTaken: false, testPregnancy: null, testOvulation: null,
      notes: '', updated: at,
    };
  }
  return logs;
}

/** @param {number} n dates ending today */
const datesOf = (n) =>
  new Set(Array.from({ length: n }, (_, i) => addDays(TODAY, -i)));

test('stays quiet below the threshold', () => {
  const nudge = backupNudge({
    logs: logsOf(MIN_DAYS_AT_RISK - 1),
    periodDays: new Set(),
    settings: settingsWith(),
    today: TODAY,
  });
  assert.equal(nudge, null);
});

test('speaks up once enough is unprotected', () => {
  const nudge = backupNudge({
    logs: logsOf(MIN_DAYS_AT_RISK),
    periodDays: new Set(),
    settings: settingsWith(),
    today: TODAY,
  });
  assert.ok(nudge);
  assert.equal(nudge.daysAtRisk, MIN_DAYS_AT_RISK);
  assert.equal(nudge.neverBackedUp, true);
  assert.equal(nudge.daysSinceBackup, null);
});

test('a fresh backup silences it', () => {
  const now = Date.now();
  const nudge = backupNudge({
    logs: logsOf(40, now - 60_000),
    periodDays: datesOf(40),
    settings: settingsWith({ lastBackup: TODAY, lastBackupAt: now }),
    today: TODAY,
  });
  assert.equal(nudge, null, 'everything logged predates the backup');
});

test('counts period days even when nothing else is logged', () => {
  // Someone who only ever marks bleeding days still has data worth losing.
  const nudge = backupNudge({
    logs: {},
    periodDays: datesOf(MIN_DAYS_AT_RISK + 3),
    settings: settingsWith(),
    today: TODAY,
  });
  assert.ok(nudge, 'period-only users were the case this nearly missed');
  assert.equal(nudge.daysAtRisk, MIN_DAYS_AT_RISK + 3);
});

test('a day that is both a period day and a logged day counts once', () => {
  const nudge = backupNudge({
    logs: logsOf(20),
    periodDays: datesOf(20),
    settings: settingsWith(),
    today: TODAY,
  });
  assert.ok(nudge);
  assert.equal(nudge.daysAtRisk, 20, 'the same 20 dates, not 40');
});

test('editing an old day puts it back at risk', () => {
  const backedUpAt = Date.parse('2026-07-01T12:00:00Z');

  // Dates from months ago — every one older than the backup *date* — but all
  // touched after the backup was taken.
  /** @type {Record<string, any>} */
  const logs = {};
  for (let i = 0; i < MIN_DAYS_AT_RISK; i++) {
    const date = addDays('2026-03-01', i);
    logs[date] = { ...logsOf(1)[TODAY], date, updated: backedUpAt + 86_400_000 };
  }

  const nudge = backupNudge({
    logs,
    periodDays: new Set(),
    settings: settingsWith({ lastBackup: '2026-07-01', lastBackupAt: backedUpAt }),
    today: TODAY,
  });

  assert.ok(nudge, 'a date-only comparison would have called these protected');
  assert.equal(nudge.daysAtRisk, MIN_DAYS_AT_RISK);
  assert.equal(nudge.neverBackedUp, false);
  assert.equal(nudge.daysSinceBackup, 28);
});

test('dismissing snoozes rather than silences', () => {
  const base = {
    logs: logsOf(30),
    periodDays: new Set(),
    today: TODAY,
  };

  const justSnoozed = backupNudge({
    ...base,
    settings: settingsWith({ backupSnoozed: addDays(TODAY, -1) }),
  });
  assert.equal(justSnoozed, null);

  const stillInside = backupNudge({
    ...base,
    settings: settingsWith({ backupSnoozed: addDays(TODAY, -(SNOOZE_DAYS - 1)) }),
  });
  assert.equal(stillInside, null);

  const expired = backupNudge({
    ...base,
    settings: settingsWith({ backupSnoozed: addDays(TODAY, -SNOOZE_DAYS) }),
  });
  assert.ok(expired, 'the data is still only in one place a month later');
});
