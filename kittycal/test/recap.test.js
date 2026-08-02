// @ts-check
/**
 * recap.test.js — the end-of-cycle summary.
 *
 * The interesting cases are all about restraint: when it should say nothing,
 * and when it should decline to compare rather than compare against a guess.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRecap, cluster, RECAP_WINDOW_DAYS } from '../js/domain/recap.js';
import { buildCycles } from '../js/domain/cycles.js';
import { addDays, range } from '../js/utils/date.js';

/**
 * Period days for cycles of the given lengths, ending with a period that
 * starts `sinceLastStart` days before `today`.
 * @param {number[]} lengths cycle lengths, oldest first
 * @param {string} today
 * @param {number} sinceLastStart
 * @param {number} periodLength
 */
function periodDaysFor(lengths, today, sinceLastStart, periodLength = 5) {
  const starts = [];
  let cursor = addDays(today, -sinceLastStart);
  starts.unshift(cursor);
  for (let i = lengths.length - 1; i >= 0; i--) {
    cursor = addDays(cursor, -lengths[i]);
    starts.unshift(cursor);
  }
  /** @type {string[]} */
  const days = [];
  for (const start of starts) {
    for (let i = 0; i < periodLength; i++) days.push(addDays(start, i));
  }
  return days;
}

/** @param {string[]} dates @param {string[]} ids */
function logsOn(dates, ids) {
  /** @type {Record<string, any>} */
  const logs = {};
  for (const d of dates) {
    logs[d] = {
      date: d, flow: 'none', symptoms: ids, moods: [], discharge: [],
      activity: [], other: [], sex: [], custom: [], drive: null,
      bbt: null, weight: null, water: 0, sleep: null, steps: null,
      pillTaken: false, testPregnancy: null, testOvulation: null,
      notes: '', updated: 0,
    };
  }
  return logs;
}

const TODAY = '2026-07-29';

test('no completed cycle yields no recap', () => {
  const cycles = buildCycles(['2026-07-27', '2026-07-28']);
  assert.equal(buildRecap({ cycles, logs: {}, today: TODAY }), null);
});

test('summarises the cycle that just closed', () => {
  // Four closed cycles; the newest period started 2 days ago.
  const days = periodDaysFor([28, 28, 28, 30], TODAY, 2);
  const recap = buildRecap({ cycles: buildCycles(days), logs: {}, today: TODAY });

  assert.ok(recap);
  assert.equal(recap.length, 30, 'the cycle that just closed was 30 days');
  assert.equal(recap.usualLength, 28, 'median of the three before it');
  assert.equal(recap.periodLength, 5);
});

test('goes quiet once the window has passed', () => {
  const inside = periodDaysFor([28, 28, 28], TODAY, RECAP_WINDOW_DAYS);
  assert.ok(buildRecap({ cycles: buildCycles(inside), logs: {}, today: TODAY }));

  const outside = periodDaysFor([28, 28, 28], TODAY, RECAP_WINDOW_DAYS + 1);
  assert.equal(
    buildRecap({ cycles: buildCycles(outside), logs: {}, today: TODAY }), null,
    'a recap a week and a half old is no longer a moment',
  );
});

test('declines to compare without enough history', () => {
  // One closed cycle only: there is no "usual" to compare against yet.
  const days = periodDaysFor([28], TODAY, 3);
  const recap = buildRecap({ cycles: buildCycles(days), logs: {}, today: TODAY });

  assert.ok(recap);
  assert.equal(recap.usualLength, null);
  assert.equal(recap.usualPeriodLength, null);
});

test('uses the median, so one outlier does not redefine usual', () => {
  //                              ↓ the outlier   ↓ the cycle being recapped
  const days = periodDaysFor([28, 60, 28, 28, 29], TODAY, 2);
  const recap = buildRecap({ cycles: buildCycles(days), logs: {}, today: TODAY });

  assert.ok(recap);
  assert.equal(recap.usualLength, 28, 'a mean would have been dragged to 36');
});

test('ignores an implausible gap rather than recapping it', () => {
  const days = periodDaysFor([28, 28, 200], TODAY, 2);
  assert.equal(
    buildRecap({ cycles: buildCycles(days), logs: {}, today: TODAY }), null,
    'a 200-day gap is missing data, not a cycle worth summarising',
  );
});

test('counts logged days inside the cycle only', () => {
  const days = periodDaysFor([28, 28, 28], TODAY, 2);
  const cycles = buildCycles(days);
  const closed = cycles.filter((c) => c.complete).pop();
  assert.ok(closed);

  const inside = [closed.start, addDays(closed.start, 5)];
  const dayOneOfNext = /** @type {string} */ (closed.nextStart);
  const logs = logsOn([...inside, dayOneOfNext], ['cramps']);

  const recap = buildRecap({ cycles, logs, today: TODAY });
  assert.ok(recap);
  assert.equal(recap.daysLogged, 2, 'day 1 of the next cycle is not this one');
});

test('names what recurred, most frequent first', () => {
  const days = periodDaysFor([28, 28, 28], TODAY, 2);
  const cycles = buildCycles(days);
  const closed = cycles.filter((c) => c.complete).pop();
  assert.ok(closed);

  const logs = {
    ...logsOn(
      [closed.start, addDays(closed.start, 1), addDays(closed.start, 2)],
      ['cramps', 'headache'],
    ),
    ...logsOn([addDays(closed.start, 10)], ['headache']),
  };

  const recap = buildRecap({ cycles, logs, today: TODAY });
  assert.ok(recap);
  assert.deepEqual(
    recap.notable.map((n) => [n.id, n.category, n.count]),
    [['headache', 'symptoms', 4], ['cramps', 'symptoms', 3]],
  );
  assert.deepEqual(recap.notable[1].days, [1, 2, 3], 'cycle days, not dates');
});

test('a one-off is not notable', () => {
  const days = periodDaysFor([28, 28, 28], TODAY, 2);
  const cycles = buildCycles(days);
  const closed = cycles.filter((c) => c.complete).pop();
  assert.ok(closed);

  const recap = buildRecap({
    cycles, logs: logsOn([closed.start], ['cramps']), today: TODAY,
  });
  assert.ok(recap);
  assert.deepEqual(recap.notable, []);
});

test('cluster reports a tight span and refuses a scattered one', () => {
  assert.deepEqual(cluster([1, 2]), { from: 1, to: 2 });
  assert.deepEqual(cluster([1, 2, 3, 4, 5]), { from: 1, to: 5 });
  assert.equal(cluster([1, 9, 22]), null, 'scattered is not a pattern');
  assert.equal(cluster([4]), null, 'one occurrence is not a span');
});

test('a mood and a symptom sharing an id stay separate', () => {
  const days = periodDaysFor([28, 28, 28], TODAY, 2);
  const cycles = buildCycles(days);
  const closed = cycles.filter((c) => c.complete).pop();
  assert.ok(closed);

  // `low` is a mood ("Very low") and `low` is also a drive level. Only the
  // mood is an occurrence, but the category has to travel with it so the UI
  // can say "Felt very low" rather than the bare label.
  /** @type {Record<string, any>} */
  const logs = {};
  for (const offset of [0, 1]) {
    const d = addDays(closed.start, offset);
    logs[d] = {
      date: d, flow: 'none', symptoms: ['cramps'], moods: ['low'],
      discharge: [], activity: [], other: [], sex: [], custom: [], drive: 'low',
      bbt: null, weight: null, water: 0, sleep: null, steps: null,
      pillTaken: false, testPregnancy: null, testOvulation: null,
      notes: '', updated: 0,
    };
  }

  const recap = buildRecap({ cycles, logs, today: TODAY });
  assert.ok(recap);
  const byCategory = Object.fromEntries(recap.notable.map((n) => [n.category, n.id]));
  assert.deepEqual(byCategory, { symptoms: 'cramps', moods: 'low' });
  assert.ok(!recap.notable.some((n) => n.category === 'drive'),
    'drive is a scale, not an occurrence');
});

test('absences are not occurrences', () => {
  const days = periodDaysFor([28, 28, 28], TODAY, 2);
  const cycles = buildCycles(days);
  const closed = cycles.filter((c) => c.complete).pop();
  assert.ok(closed);

  /** @type {Record<string, any>} */
  const logs = {};
  for (const offset of [0, 1, 2]) {
    const d = addDays(closed.start, offset);
    logs[d] = {
      date: d, flow: 'none', symptoms: [], moods: [], discharge: ['none'],
      activity: ['none'], other: [], sex: ['none'], custom: [], drive: null,
      bbt: null, weight: null, water: 0, sleep: null, steps: null,
      pillTaken: false, testPregnancy: null, testOvulation: null,
      notes: '', updated: 0,
    };
  }

  const recap = buildRecap({ cycles, logs, today: TODAY });
  assert.ok(recap);
  assert.deepEqual(recap.notable, [],
    'reliably doing nothing is not a finding');
});

test('a cycle she logged nothing in still produces a recap', () => {
  // The view drops the "you logged something on N days" line at zero — a
  // summary that opens by telling her she did not use the app, on precisely
  // the cycle where she was least inclined to.
  const periodDays = new Set([
    ...range('2026-05-01', '2026-05-05'),
    ...range('2026-06-01', '2026-06-05'),
  ]);
  const recap = buildRecap({
    cycles: buildCycles(periodDays), logs: {}, today: '2026-06-03',
  });
  assert.ok(recap, 'still worth showing the lengths');
  assert.equal(recap.daysLogged, 0);
});
