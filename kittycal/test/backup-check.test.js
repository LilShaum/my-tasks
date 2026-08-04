// @ts-check
/**
 * backup-check.test.js — reading a backup without restoring it.
 *
 * The thing this must never do is tell her a file is a complete copy when it
 * is not. Everything else here is arithmetic; that one is the promise.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeBackup, ageInDays } from '../js/domain/backup-check.js';
import { buildExport, parseImport } from '../js/storage/backup.js';
import { emptyLog, defaultSettings } from '../js/domain/model.js';

const TODAY = '2026-07-29';

/** A device state: logs on the given dates, plus period days. */
function device(dates = ['2026-07-01', '2026-07-02'], periods = ['2026-07-01']) {
  /** @type {Record<string, any>} */
  const logs = {};
  for (const d of dates) logs[d] = { ...emptyLog(d), flow: 'medium' };
  return { logs, periodDays: new Set(periods), settings: defaultSettings() };
}

/** Round-trip a device state through the real export and parse path. */
const roundTrip = (state) => parseImport(JSON.stringify(buildExport(state)));

test('a file that is not JSON is reported as unreadable, not as empty', () => {
  const check = describeBackup(parseImport('not json at all'), device(), TODAY);
  assert.equal(check.ok, false);
  assert.match(check.error ?? '', /JSON/);
});

test('an export of the current state is a complete copy', () => {
  const state = device();
  const check = describeBackup(roundTrip(state), state, TODAY);

  assert.equal(check.state, 'match');
  assert.equal(check.onlyHere, 0);
  assert.equal(check.onlyInFile, 0);
  assert.equal(check.differ, 0);
  assert.equal(check.logCount, 2);
  assert.equal(check.periodCount, 1);
  assert.equal(check.firstDate, '2026-07-01');
  assert.equal(check.lastDate, '2026-07-02');
});

test('a re-save that changed nothing does not count as a difference', () => {
  const state = device();
  const file = roundTrip(state);

  // Same answers, saved again a minute later.
  const later = device();
  for (const log of Object.values(later.logs)) log.updated = Date.now() + 60_000;

  assert.equal(describeBackup(file, later, TODAY).state, 'match');
});

test('chip order is not an answer', () => {
  const state = device();
  state.logs['2026-07-01'].symptoms = ['cramps', 'headache'];
  const file = roundTrip(state);

  const reordered = device();
  reordered.logs['2026-07-01'].symptoms = ['headache', 'cramps'];

  assert.equal(describeBackup(file, reordered, TODAY).state, 'match');
});

test('an older backup is behind, and says how far', () => {
  const file = roundTrip(device());
  const now = device(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']);

  const check = describeBackup(file, now, TODAY);
  assert.equal(check.state, 'behind');
  assert.equal(check.onlyHere, 2);
  assert.equal(check.onlyInFile, 0);
});

test('a file holding days the device lost is ahead', () => {
  const file = roundTrip(device(['2026-07-01', '2026-07-02', '2026-07-03']));
  const check = describeBackup(file, device(), TODAY);

  assert.equal(check.state, 'ahead');
  assert.equal(check.onlyInFile, 1);
  assert.equal(check.onlyHere, 0);
});

test('the same day answered differently in each is a divergence', () => {
  const file = roundTrip(device());
  const changed = device();
  changed.logs['2026-07-02'].flow = 'light';

  const check = describeBackup(file, changed, TODAY);
  assert.equal(check.state, 'diverged');
  assert.equal(check.differ, 1);
  assert.equal(check.onlyHere, 0);
});

test('a period day missing from the file is not a match, even when logs agree', () => {
  const file = roundTrip(device(['2026-07-01', '2026-07-02'], ['2026-07-01']));
  const more = device(['2026-07-01', '2026-07-02'], ['2026-07-01', '2026-07-02']);

  const check = describeBackup(file, more, TODAY);
  assert.equal(check.state, 'diverged', 'the file disagrees about that day');
  assert.equal(check.differ, 1);
  assert.equal(check.onlyHere, 0, 'the day itself is in both — it is the answer that differs');
});

test('a day that is both a log and a period day counts once', () => {
  // The device has one extra day, marked as a period day and logged.
  const file = roundTrip(device(['2026-07-01'], ['2026-07-01']));
  const now = device(['2026-07-01', '2026-07-02'], ['2026-07-01', '2026-07-02']);

  const check = describeBackup(file, now, TODAY);
  assert.equal(check.onlyHere, 1, 'one day, not one log plus one period day');
  assert.equal(check.state, 'behind');
});

test('a valid file holding nothing is empty, not a match against an empty device', () => {
  const blank = { logs: {}, periodDays: new Set(), settings: defaultSettings() };
  const check = describeBackup(roundTrip(blank), blank, TODAY);

  assert.equal(check.state, 'empty', 'two empty things agreeing is not a backup');
  assert.equal(check.logCount, 0);
  assert.equal(check.firstDate, null);
});

test('age comes from the file, and a missing timestamp stays unknown', () => {
  assert.equal(ageInDays('2026-07-22T09:00:00', TODAY), 7);
  assert.equal(ageInDays(undefined, TODAY), null);
  assert.equal(ageInDays('sometime last week', TODAY), null);
  // A phone with a wrong clock should not produce a file made in the future.
  assert.equal(ageInDays('2026-08-05T09:00:00', TODAY), 0);
});

test('a file with no exportedAt still reports its contents', () => {
  const raw = buildExport(device());
  delete (/** @type {any} */ (raw)).exportedAt;

  const check = describeBackup(parseImport(JSON.stringify(raw)), device(), TODAY);
  assert.equal(check.ok, true);
  assert.equal(check.ageDays, null);
  assert.equal(check.state, 'match');
});
