// @ts-check
/**
 * model.test.js — the two "is this day empty?" questions.
 *
 * They look like the same question and are not, and collapsing them broke the
 * daily loop: a check-in answered "no bleeding, nothing bothering me" produced
 * a log that looked empty, so storage pruned it on write. The app then asked
 * again the next day and showed the day as never logged.
 *
 *   nothingRecorded  — she logged no observations. What the screens describe.
 *   isLogEmpty       — nothing worth keeping. What storage prunes.
 *
 * A day she checked in on is never the second, however little is on it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLog, normalizeLog, isLogEmpty, nothingRecorded, normalizeSettings,
} from '../js/domain/model.js';

test('a blank day is both empty and unrecorded', () => {
  const log = emptyLog('2026-08-01');
  assert.equal(nothingRecorded(log), true);
  assert.equal(isLogEmpty(log), true, 'a day opened and left alone is still pruned');
});

test('a checked-in day with nothing on it is kept', () => {
  const log = { ...emptyLog('2026-08-01'), checkedIn: true };
  assert.equal(nothingRecorded(log), true, 'she still recorded nothing');
  assert.equal(isLogEmpty(log), false, 'but the answer itself is worth keeping');
});

test('anything recorded makes a day non-empty on its own', () => {
  for (const patch of [
    { flow: /** @type {const} */ ('light') },
    { symptoms: ['cramps'] },
    { moods: ['happy'] },
    { bbt: 36.6 },
    { water: 250 },
    { notes: 'a note' },
    { pillTaken: true },
  ]) {
    const log = { ...emptyLog('2026-08-01'), ...patch };
    const what = Object.keys(patch)[0];
    assert.equal(nothingRecorded(log), false, `${what} counts as recorded`);
    assert.equal(isLogEmpty(log), false, `${what} is worth keeping`);
  }
});

test('whitespace in the notes is not a record', () => {
  const log = { ...emptyLog('2026-08-01'), notes: '   \n ' };
  assert.equal(nothingRecorded(log), true);
  assert.equal(isLogEmpty(log), true);
});

test('checkedIn survives the export round-trip', () => {
  const log = { ...emptyLog('2026-08-01'), checkedIn: true };
  const through = normalizeLog(JSON.parse(JSON.stringify(log)));
  assert.equal(through.checkedIn, true);
  assert.equal(isLogEmpty(through), false);
});

test('a record written before the field existed still imports', () => {
  const old = normalizeLog({ date: '2026-07-01', flow: 'medium', symptoms: ['cramps'] });
  assert.equal(old.checkedIn, false, 'defaults to not-checked-in rather than undefined');
  assert.equal(isLogEmpty(old), false, 'and is kept on its own merits');
});

test('a junk value for checkedIn does not become truthy', () => {
  const log = normalizeLog(
    /** @type {any} */ ({ date: '2026-07-01', checkedIn: 'yes' }),
  );
  assert.equal(log.checkedIn, false);
  assert.equal(isLogEmpty(log), true, 'a hand-edited export cannot resurrect a blank day');
});

test('an unknown mode falls back to plain cycle tracking', () => {
  // `pregnancy` was in the union once and shipped in every export written
  // while it was, so a real file can still carry it.
  assert.equal(normalizeSettings({ mode: 'pregnancy' }).mode, 'cycle');
  assert.equal(normalizeSettings({ mode: 'nonsense' }).mode, 'cycle');
  assert.equal(normalizeSettings({ mode: 'conceive' }).mode, 'conceive');
  assert.equal(normalizeSettings({}).mode, 'cycle');
});
