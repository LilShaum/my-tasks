// @ts-check
/**
 * robust.test.js — states the audit reached that the app should refuse.
 *
 * Each of these was found by hunting rather than by sampling: walking every
 * day of four years through the date helpers, fuzzing the importer with
 * twenty malformed files, and driving Today through nine seeded histories.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { predict } from '../js/domain/predict.js';
import { defaultSettings } from '../js/domain/model.js';
import { parseImport, buildExport } from '../js/storage/backup.js';
import { addDays, daysBetween, range } from '../js/utils/date.js';

/* ── A period that has not happened ─────────────────────────────────────── */

test('a period marked in the future cannot make today a negative day', () => {
  const today = '2026-08-03';
  const out = predict({
    periodDays: new Set(['2026-09-01', '2026-09-02']),
    settings: { ...defaultSettings(), onboarded: true },
    today,
  });

  // It used to report Day -29 beside "58 days to your period".
  assert.ok(out.cycleDay == null || out.cycleDay >= 1,
    `cycleDay was ${out.cycleDay}`);
});

test('and future days do not contribute a cycle length either', () => {
  const today = '2026-08-03';
  const withFuture = predict({
    periodDays: new Set(['2026-07-01', '2026-07-02', '2026-09-01', '2026-09-02']),
    settings: { ...defaultSettings(), onboarded: true },
    today,
  });
  const withoutFuture = predict({
    periodDays: new Set(['2026-07-01', '2026-07-02']),
    settings: { ...defaultSettings(), onboarded: true },
    today,
  });

  assert.equal(withFuture.cycleDay, withoutFuture.cycleDay,
    'a date in the future changed where she is today');
  assert.equal(withFuture.avgCycleLength, withoutFuture.avgCycleLength,
    'a cycle that has not finished happening was averaged in');
});

test('a period marked for today still counts', () => {
  const today = '2026-08-03';
  const out = predict({
    periodDays: new Set([today]),
    settings: { ...defaultSettings(), onboarded: true },
    today,
  });
  assert.equal(out.cycleDay, 1, 'today is day one, not tomorrow');
});

/* ── Dates that do not exist ────────────────────────────────────────────── */

test('an imported date that names no real day is dropped', () => {
  const file = buildExport({
    settings: defaultSettings(), logs: {}, periodDays: new Set(['2026-02-01']),
  });
  file.logs = [
    { date: '2026-13-45' },   // right shape, impossible day
    { date: '2026-02-30' },   // February has no 30th
    { date: '2025-02-29' },   // 2025 is not a leap year
    { date: '2026-02-28' },   // real
  ];
  file.periodDays = ['2026-13-45', '2026-02-28'];

  const back = parseImport(JSON.stringify(file));
  assert.ok(back.ok, back.error);
  assert.deepEqual(Object.keys(back.logs), ['2026-02-28'],
    'only the day that exists survived');
  assert.deepEqual([...back.periodDays], ['2026-02-28'],
    'and the same rule applies to period days, which every cycle length is measured from');
});

test('a leap day in a leap year is a real day', () => {
  const file = buildExport({
    settings: defaultSettings(), logs: {}, periodDays: new Set(['2024-02-29']),
  });
  const back = parseImport(JSON.stringify(file));
  assert.deepEqual([...back.periodDays], ['2024-02-29']);
});

/* ── Date arithmetic, over a span rather than at a point ────────────────── */

test('every day of four years steps by exactly one day', () => {
  let cursor = '2024-01-01';
  for (let i = 0; i < 366 * 4; i += 1) {
    const next = addDays(cursor, 1);
    assert.equal(daysBetween(cursor, next), 1, `${cursor} → ${next}`);
    cursor = next;
  }
});

test('a backwards range is empty rather than endless', () => {
  assert.deepEqual(range('2026-05-10', '2026-05-05'), []);
});
