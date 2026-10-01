// @ts-check
/**
 * What she usually gets before her period — found, and said at the right time.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { premenstrualPatterns, headsUpToday } from '../js/domain/heads-up.js';
import { buildCycles } from '../js/domain/cycles.js';
import { emptyLog } from '../js/domain/model.js';
import { addDays, range } from '../js/utils/date.js';

/**
 * Cycles of the given lengths, with things logged a fixed number of days
 * before each next period.
 * @param {number[]} lengths
 * @param {Record<string, {kind: 'symptoms'|'moods'|'custom', before: number[]}>} marks
 */
function history(lengths, marks) {
  /** @type {string[]} */
  const periodDays = [];
  /** @type {Record<string, any>} */
  const logs = {};
  let start = '2026-01-05';
  const starts = [start];
  for (const len of lengths) { start = addDays(start, len); starts.push(start); }
  for (const s of starts) periodDays.push(...range(s, addDays(s, 4)));

  for (let c = 1; c < starts.length; c += 1) {
    for (const [id, { kind, before }] of Object.entries(marks)) {
      for (const b of before) {
        const date = addDays(starts[c], -b);
        logs[date] ??= emptyLog(date);
        logs[date][kind].push(id);
      }
    }
  }
  return { logs, cycles: buildCycles(new Set(periodDays)), lastStart: starts[starts.length - 1] };
}

test('counted back from each real period, so varying cycle lengths agree', () => {
  /*
    Bloating starting four days before every period, across cycles of 26, 31
    and 28 days. Counted from day 1 that is day 22, 27 and 24 — no typical day
    at all. Counted back from the period it is "about 4 days before" every time,
    which is the true and useful statement.
  */
  const { logs, cycles } = history([26, 31, 28], {
    bloating: { kind: 'symptoms', before: [4, 3, 2, 1] },
  });
  const found = premenstrualPatterns(logs, cycles);
  assert.equal(found.length, 1);
  assert.deepEqual(
    { id: found[0].id, before: found[0].typicalBefore, with: found[0].cyclesWith, of: found[0].cyclesTotal },
    { id: 'bloating', before: 4, with: 3, of: 3 },
  );
});

test('nothing is called a pattern before three complete cycles', () => {
  const { logs, cycles } = history([28, 28], { bloating: { kind: 'symptoms', before: [3] } });
  assert.deepEqual(premenstrualPatterns(logs, cycles), []);
});

test('something in only one cycle of three is a coincidence, not a pattern', () => {
  const { logs, cycles } = history([28, 28, 28], {});
  const late = cycles[2].nextStart;
  const date = addDays(/** @type {string} */ (late), -3);
  logs[date] = emptyLog(date);
  logs[date].symptoms.push('headache');
  assert.deepEqual(premenstrualPatterns(logs, cycles), []);
});

test('good moods are not a warning; hard ones and her own symptoms are', () => {
  const { logs, cycles } = history([28, 28, 28], {
    happy: { kind: 'moods', before: [3] },
    irritable: { kind: 'moods', before: [2] },
    'sore jaw': { kind: 'custom', before: [5] },
  });
  const ids = premenstrualPatterns(logs, cycles).map((p) => p.id).sort();
  assert.deepEqual(ids, ['irritable', 'sore jaw']);
});

test('said from a day before it usually starts until the period arrives', () => {
  const pattern = [{ id: 'bloating', kind: /** @type {const} */ ('symptoms'), cyclesWith: 3, cyclesTotal: 3, typicalBefore: 4 }];
  const at = (/** @type {number} */ until, extra = {}) =>
    headsUpToday(pattern, /** @type {any} */ ({ daysUntilPeriod: until, isLate: false, withinWindow: false, ...extra })).length;
  assert.equal(at(8), 0, 'too early');
  assert.equal(at(6), 0);
  assert.equal(at(5), 1, 'a day of warning');
  assert.equal(at(1), 1);
  assert.equal(at(0), 0, 'due today: she is not waiting for it any more');
  assert.equal(at(-2, { isLate: true }), 0);
  assert.equal(at(/** @type {any} */ (null)), 0, 'nothing to count back from');
});
