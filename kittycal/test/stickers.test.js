// @ts-check
/**
 * stickers.test.js — the collection, and the promises it makes.
 *
 * Two of these tests are about behaviour the feature would be actively harmful
 * without: that nothing is ever taken away, and that nothing is earned for
 * what her body did rather than for what she recorded.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stickerBook, earnedIds, newlyEarned, STICKER_COUNT } from '../js/domain/stickers.js';
import { buildCycles } from '../js/domain/cycles.js';
import { emptyLog } from '../js/domain/model.js';
import { defaultSettings } from '../js/domain/model.js';
import { THEMES } from '../js/data/themes.js';
import { addDays } from '../js/utils/date.js';

const settings = defaultSettings();

/**
 * `days` consecutive logs from `first`, with an optional mutation per day.
 * @param {string} first
 * @param {number} days
 * @param {(log: import('../js/domain/model.js').DayLog, i: number) => void} [touch]
 */
function logsFrom(first, days, touch) {
  /** @type {Record<string, import('../js/domain/model.js').DayLog>} */
  const logs = {};
  for (let i = 0; i < days; i += 1) {
    const key = addDays(first, i);
    const log = { ...emptyLog(key), checkedIn: true };
    touch?.(log, i);
    logs[key] = log;
  }
  return logs;
}

/** `count` periods of 5 days, 28 days apart. */
function cyclesFrom(first, count) {
  /** @type {Set<string>} */
  const period = new Set();
  for (let c = 0; c < count; c += 1) {
    for (let d = 0; d < 5; d += 1) period.add(addDays(first, c * 28 + d));
  }
  return buildCycles(period);
}

test('every sticker wears a motif that exists', () => {
  const ids = new Set(THEMES.map((t) => t.id));
  for (const sticker of stickerBook({ logs: {}, cycles: [], settings })) {
    assert.ok(ids.has(sticker.emblem), `${sticker.id} wears "${sticker.emblem}"`);
  }
});

test('the whole book is always returned, empty slots and all', () => {
  const book = stickerBook({ logs: {}, cycles: [], settings });
  assert.equal(book.length, STICKER_COUNT);
  assert.equal(book.filter((s) => s.on).length, 0);
  // And every empty slot says what would fill it.
  for (const sticker of book) assert.ok(sticker.requirement.length > 0);
});

test('an earned sticker carries the day it was earned, not today', () => {
  const logs = logsFrom('2026-01-01', 40);
  const book = stickerBook({ logs, cycles: [], settings });

  const week = book.find((s) => s.id === 'first-week');
  const month = book.find((s) => s.id === 'first-month');
  // The seventh and thirtieth days she logged, exactly.
  assert.equal(week?.on, '2026-01-07');
  assert.equal(month?.on, '2026-01-30');
});

test('nothing is ever taken away', () => {
  /*
    The rule the whole feature stands on. A month of daily logging followed by
    six weeks of nothing has to leave the collection exactly as it was — the
    version of this that quietly greys a sticker back out is the version that
    makes missing a week feel like a punishment.
  */
  const logs = logsFrom('2026-01-01', 30);
  const earnedThen = earnedIds({ logs, cycles: [], settings });

  // Six weeks pass with nothing logged at all.
  const earnedNow = earnedIds({ logs, cycles: [], settings });
  assert.deepEqual([...earnedNow], [...earnedThen]);

  // And the dates on them have not moved either.
  const before = stickerBook({ logs, cycles: [], settings });
  const after = stickerBook({ logs, cycles: [], settings });
  assert.deepEqual(after, before);
});

test('backfilling history earns what it should have earned', () => {
  // Derived rather than stored, so filling in an old month is not a special
  // case that needs replaying — it is just a different set of logs.
  const sparse = logsFrom('2026-03-01', 5);
  assert.equal(earnedIds({ logs: sparse, cycles: [], settings }).has('first-week'), false);

  const filled = { ...logsFrom('2026-01-01', 20), ...sparse };
  assert.ok(earnedIds({ logs: filled, cycles: [], settings }).has('first-week'));
});

test('nothing is earned for what her body did', () => {
  /*
    Design rule 2, as a test. A heavy month and a quiet month, identical in
    every way except flow and symptoms, must earn exactly the same set — or the
    collection starts telling her some months went better than others.
  */
  const rough = logsFrom('2026-01-01', 30, (log) => {
    log.flow = 'heavy';
    log.symptoms = ['cramps', 'headache'];
    log.moods = ['low-energy'];
  });
  const easy = logsFrom('2026-01-01', 30, (log) => { log.flow = 'none'; });

  assert.deepEqual(
    [...earnedIds({ logs: rough, cycles: [], settings })],
    [...earnedIds({ logs: easy, cycles: [], settings })],
  );
});

test('a cycle sticker lands on the day the cycle closed', () => {
  const cycles = cyclesFrom('2026-01-01', 4);
  const book = stickerBook({ logs: {}, cycles, settings });

  // The first cycle became a known length on the day the second period began.
  assert.equal(book.find((s) => s.id === 'first-cycle')?.on, '2026-01-29');
  assert.equal(book.find((s) => s.id === 'patterns')?.on, addDays('2026-01-01', 3 * 28));
  // Four periods means three complete cycles; six is still out of reach.
  assert.equal(book.find((s) => s.id === 'six-cycles')?.on, null);
});

test('the things she might not know the app can do', () => {
  const logs = logsFrom('2026-01-01', 3, (log, i) => {
    if (i === 0) log.notes = 'slept badly';
    if (i === 1) log.custom = ['jaw ache'];
    if (i === 2) { log.symptoms = ['cramps']; log.severity = { cramps: 2 }; }
  });
  const earned = earnedIds({ logs, cycles: [], settings });

  assert.ok(earned.has('own-words'));
  assert.ok(earned.has('named-it'));
  assert.ok(earned.has('how-bad'));
  // A blank note is not a note.
  const blank = logsFrom('2026-02-01', 1, (log) => { log.notes = '   '; });
  assert.equal(earnedIds({ logs: blank, cycles: [], settings }).has('own-words'), false);
});

test('one sticker is announced at a time, the hardest one', () => {
  // A day that crosses two thresholds at once: her thirtieth log, and the
  // first note she has written.
  const before = earnedIds({ logs: logsFrom('2026-01-01', 29), cycles: [], settings });
  const after = {
    logs: logsFrom('2026-01-01', 30, (log, i) => { if (i === 29) log.notes = 'first note'; }),
    cycles: [],
    settings,
  };

  const said = newlyEarned(before, after);
  assert.equal(said?.id, 'first-month');
});

test('nothing is announced when nothing was crossed', () => {
  const logs = logsFrom('2026-01-01', 12);
  const before = earnedIds({ logs, cycles: [], settings });
  assert.equal(newlyEarned(before, { logs, cycles: [], settings }), null);
});
