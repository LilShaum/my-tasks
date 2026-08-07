// @ts-check
/**
 * The pack. Most of these pin the boundary days — the last pill, the first day
 * off, the roll into the next pack — because those are the only days the
 * position is worth showing on, and the ones an off-by-one would corrupt.
 *
 * The unmarked-days tests pin the wording discipline as much as the maths:
 * this module reports days with nothing recorded, never missed pills.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { packPosition, unmarkedDays, describePack, regimen } from '../js/domain/pill.js';
import { defaultSettings, emptyLog } from '../js/domain/model.js';

/** @param {Partial<import('../js/domain/model.js').Settings>} patch */
const settings = (patch) => ({ ...defaultSettings(), ...patch });

const pack = settings({ pillRegimen: '21-7', pillPackStart: '2026-03-01' });

test('day one of the pack is pill one', () => {
  const position = packPosition(pack, '2026-03-01');
  assert.equal(position?.day, 1);
  assert.equal(position?.active, true);
  assert.equal(position?.pack, 1);
  assert.equal(position?.left, 21);
});

test('the last pill and the first day off are on the right side of the line', () => {
  const last = packPosition(pack, '2026-03-21');
  assert.equal(last?.day, 21);
  assert.equal(last?.active, true);
  assert.equal(last?.left, 1, 'today is the last one');

  const off = packPosition(pack, '2026-03-22');
  assert.equal(off?.day, 22);
  assert.equal(off?.active, false);
  assert.equal(off?.left, 0);
});

test('the next pack starts on day 29 and counts as pack two', () => {
  const next = packPosition(pack, '2026-03-29');
  assert.equal(next?.day, 1);
  assert.equal(next?.pack, 2);
  assert.equal(next?.active, true);
  assert.equal(next?.packStart, '2026-03-29');
});

test('a continuous regimen never has a break day', () => {
  const every = settings({ pillRegimen: '28-0', pillPackStart: '2026-03-01' });
  for (const date of ['2026-03-01', '2026-03-28', '2026-03-29']) {
    assert.equal(packPosition(every, date)?.active, true, date);
  }
  assert.equal(packPosition(every, '2026-03-29')?.pack, 2);
});

test('nothing is claimed without a regimen, a start date, or before it began', () => {
  assert.equal(packPosition(settings({ pillPackStart: '2026-03-01' }), '2026-03-05'), null);
  assert.equal(packPosition(settings({ pillRegimen: '21-7' }), '2026-03-05'), null);
  assert.equal(packPosition(pack, '2026-02-28'), null, 'before the first pack');
});

test('the pack sentence names where she is', () => {
  assert.equal(describePack(packPosition(pack, '2026-03-05')), 'Pill 5 of 21');
  assert.equal(describePack(packPosition(pack, '2026-03-23')), 'Break day 2 of 7');
  assert.equal(describePack(null), null);
});

test('an unknown regimen id falls back to not tracking rather than crashing', () => {
  assert.equal(regimen('nonsense').id, 'none');
  assert.equal(packPosition(settings({ pillRegimen: 'nonsense', pillPackStart: '2026-03-01' }), '2026-03-02'), null);
});

/* ── Unmarked days ───────────────────────────────────────────────────────── */

test('active days with nothing marked are listed, oldest first', () => {
  const logs = {
    '2026-03-02': { ...emptyLog('2026-03-02'), pillTaken: true },
    '2026-03-04': { ...emptyLog('2026-03-04'), pillTaken: true },
  };
  assert.deepEqual(
    unmarkedDays(logs, pack, '2026-03-05', 4),
    ['2026-03-01', '2026-03-03'],
  );
});

test('today is never listed — a day in progress is not an unrecorded one', () => {
  assert.ok(!unmarkedDays({}, pack, '2026-03-05', 7).includes('2026-03-05'));
});

test('break days are not listed, because there was no pill to record', () => {
  // 22nd to 28th are the break; only the 21st should come back.
  assert.deepEqual(unmarkedDays({}, pack, '2026-03-29', 8), ['2026-03-21']);
});

test('days before the pack started are not listed', () => {
  assert.deepEqual(unmarkedDays({}, pack, '2026-03-03', 7), ['2026-03-01', '2026-03-02']);
});

test('with no pack there is nothing to be unmarked about', () => {
  assert.deepEqual(unmarkedDays({}, defaultSettings(), '2026-03-05'), []);
});
