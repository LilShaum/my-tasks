// @ts-check
/**
 * Date arithmetic is the quiet source of bugs in any cycle tracker: an
 * off-by-one from a UTC parse shifts every prediction by a day, and only for
 * users in some timezones. These tests pin the behaviour that prevents it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toKey, fromKey, addDays, daysBetween, range, makeKey, daysInMonth,
  gridColumn, rotateDow, fmtDayCount, isBetween, DOW_MIN,
} from '../js/utils/date.js';

test('toKey uses local calendar parts, not UTC', () => {
  // Late-evening local time is already the next day in UTC for anyone east of
  // Greenwich, and the previous day for anyone far enough west. The key must
  // follow the local calendar either way.
  const d = new Date(2026, 6, 27, 23, 45);
  assert.equal(toKey(d), '2026-07-27');

  const early = new Date(2026, 6, 27, 0, 15);
  assert.equal(toKey(early), '2026-07-27');
});

test('fromKey round-trips through toKey', () => {
  for (const key of ['2026-01-01', '2026-02-28', '2026-12-31', '2024-02-29']) {
    assert.equal(toKey(fromKey(key)), key, `round-trip failed for ${key}`);
  }
});

test('fromKey lands at local noon so DST cannot shift the date', () => {
  const d = fromKey('2026-03-29');
  assert.equal(d.getHours(), 12);
  assert.equal(d.getDate(), 29);
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29', 'leap year');
  assert.equal(addDays('2026-07-27', 0), '2026-07-27');
});

test('addDays survives a spring-forward transition', () => {
  // Most northern-hemisphere DST jumps land in late March. Stepping one day at
  // a time across the transition must advance the calendar by exactly one.
  let key = '2026-03-27';
  const seen = [key];
  for (let i = 0; i < 5; i++) {
    key = addDays(key, 1);
    seen.push(key);
  }
  assert.deepEqual(seen, [
    '2026-03-27', '2026-03-28', '2026-03-29',
    '2026-03-30', '2026-03-31', '2026-04-01',
  ]);
});

test('daysBetween is signed and exact', () => {
  assert.equal(daysBetween('2026-07-01', '2026-07-28'), 27);
  assert.equal(daysBetween('2026-07-28', '2026-07-01'), -27);
  assert.equal(daysBetween('2026-07-01', '2026-07-01'), 0);
  assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1);
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2, 'leap year');
  assert.equal(daysBetween('2026-01-01', '2027-01-01'), 365);
});

test('daysBetween is exact across a DST boundary', () => {
  assert.equal(daysBetween('2026-03-01', '2026-04-01'), 31);
  assert.equal(daysBetween('2026-10-01', '2026-11-01'), 31);
});

test('range is inclusive at both ends', () => {
  assert.deepEqual(range('2026-07-01', '2026-07-04'), [
    '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04',
  ]);
  assert.deepEqual(range('2026-07-01', '2026-07-01'), ['2026-07-01']);
  assert.deepEqual(range('2026-07-04', '2026-07-01'), [], 'reversed gives empty');
});

test('makeKey zero-pads', () => {
  assert.equal(makeKey(2026, 0, 1), '2026-01-01');
  assert.equal(makeKey(2026, 11, 31), '2026-12-31');
});

test('daysInMonth handles February in leap and common years', () => {
  assert.equal(daysInMonth(2026, 1), 28);
  assert.equal(daysInMonth(2024, 1), 29);
  assert.equal(daysInMonth(2026, 0), 31);
  assert.equal(daysInMonth(2026, 3), 30);
});

test('keys sort lexicographically in date order', () => {
  const keys = ['2026-12-01', '2026-02-10', '2025-11-30', '2026-02-09'];
  assert.deepEqual([...keys].sort(), [
    '2025-11-30', '2026-02-09', '2026-02-10', '2026-12-01',
  ]);
});

test('isBetween is inclusive', () => {
  assert.ok(isBetween('2026-07-05', '2026-07-01', '2026-07-10'));
  assert.ok(isBetween('2026-07-01', '2026-07-01', '2026-07-10'));
  assert.ok(isBetween('2026-07-10', '2026-07-01', '2026-07-10'));
  assert.ok(!isBetween('2026-07-11', '2026-07-01', '2026-07-10'));
});

test('gridColumn respects the configured week start', () => {
  // 2026-07-27 is a Monday.
  assert.equal(gridColumn('2026-07-27', 1), 0, 'Monday-first: Monday is column 0');
  assert.equal(gridColumn('2026-07-27', 0), 1, 'Sunday-first: Monday is column 1');
  assert.equal(gridColumn('2026-07-26', 1), 6, 'Monday-first: Sunday is column 6');
  assert.equal(gridColumn('2026-07-26', 0), 0, 'Sunday-first: Sunday is column 0');
});

test('rotateDow matches gridColumn ordering', () => {
  assert.deepEqual(rotateDow(DOW_MIN, 1), ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  assert.deepEqual(rotateDow(DOW_MIN, 0), ['S', 'M', 'T', 'W', 'T', 'F', 'S']);
});

test('fmtDayCount reads naturally and pluralises', () => {
  assert.equal(fmtDayCount(0), 'today');
  assert.equal(fmtDayCount(1), 'in 1 day');
  assert.equal(fmtDayCount(5), 'in 5 days');
  assert.equal(fmtDayCount(-1), '1 day ago');
  assert.equal(fmtDayCount(-3), '3 days ago');
});
