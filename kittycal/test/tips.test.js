// @ts-check
/**
 * The daily insight library. Two things matter here: that a tip never appears
 * in a situation it doesn't apply to, and that every tip is actually reachable
 * — a card gated on a condition that can never be true is dead weight nobody
 * notices.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TIPS, pick } from '../js/data/tips.js';

const base = {
  phase: /** @type {const} */ ('luteal'),
  cycleDay: 20,
  loggedToday: [],
  showFertility: true,
  dateSeed: '2026-07-28',
};

test('tips never exceed the requested count', () => {
  // `pick` returns *up to* the limit — in a quiet phase with nothing logged
  // there may genuinely be fewer candidates than asked for.
  assert.equal(pick({ ...base, limit: 2 }).length, 2);
  assert.ok(pick({ ...base, limit: 5 }).length <= 5);
});

test('there are enough always-applicable tips to fill a day', () => {
  // The worst case: a phase with nothing logged. If this pool is thin, the
  // same cards show every morning and stop being read.
  const quiet = pick({ ...base, loggedToday: [], limit: 3 });
  assert.equal(quiet.length, 3,
    'not enough generic tips to fill the row on a day with nothing logged');
});

test('a tip never appears outside its phase', () => {
  for (const phase of /** @type {const} */ (['menstrual', 'follicular', 'ovulatory', 'luteal'])) {
    const chosen = pick({ ...base, phase, cycleDay: 3, limit: 20 });
    for (const tip of chosen) {
      if (!tip.phases) continue;
      assert.ok(tip.phases.includes(phase),
        `${tip.id} showed in ${phase} but is limited to ${tip.phases.join(', ')}`);
    }
  }
});

test('symptom-gated tips stay hidden until that symptom is logged', () => {
  const without = pick({ ...base, loggedToday: [], limit: 20 });
  assert.ok(!without.some((t) => t.id === 'luteal-bloating'));

  const with_ = pick({ ...base, loggedToday: ['bloating'], limit: 20 });
  assert.ok(with_.some((t) => t.id === 'luteal-bloating'));
});

test('a matched symptom outranks a generic tip', () => {
  const chosen = pick({ ...base, loggedToday: ['bloating'], limit: 1 });
  assert.equal(chosen[0].id, 'luteal-bloating');
});

test('fertility tips are suppressed on hormonal birth control', () => {
  const chosen = pick({
    ...base, phase: 'ovulatory', cycleDay: 14,
    loggedToday: ['egg-white', 'ovulation-pain'],
    showFertility: false, limit: 20,
  });
  assert.equal(chosen.filter((t) => t.needsFertility).length, 0);
});

test('cycle-day gated tips only appear on those days', () => {
  const onDayOne = pick({ ...base, phase: 'menstrual', cycleDay: 1, limit: 20 });
  assert.ok(onDayOne.some((t) => t.id === 'period-day-one'));

  const onDayFive = pick({ ...base, phase: 'menstrual', cycleDay: 5, limit: 20 });
  assert.ok(!onDayFive.some((t) => t.id === 'period-day-one'));
});

test('the selection rotates between days but is stable within one', () => {
  const monday = pick({ ...base, dateSeed: '2026-07-27' });
  const mondayAgain = pick({ ...base, dateSeed: '2026-07-27' });
  assert.deepEqual(monday.map((t) => t.id), mondayAgain.map((t) => t.id),
    'same day must give the same cards');

  // Across a fortnight the generic cards should not always be the same three.
  const seen = new Set();
  for (let d = 1; d <= 14; d++) {
    const day = `2026-07-${String(d).padStart(2, '0')}`;
    for (const tip of pick({ ...base, dateSeed: day })) seen.add(tip.id);
  }
  assert.ok(seen.size > 3, `expected rotation, only ever saw ${seen.size} cards`);
});

test('every tip is reachable in some situation', () => {
  /** @type {Set<string>} */
  const reachable = new Set();

  const phases = /** @type {const} */ (['menstrual', 'follicular', 'ovulatory', 'luteal']);
  // Every gating id any tip mentions, so each has a chance to fire.
  const allGates = [...new Set(TIPS.flatMap((t) => t.whenLogged ?? []))];

  for (const phase of phases) {
    for (let day = 1; day <= 30; day++) {
      for (const showFertility of [true, false]) {
        for (const tip of pick({
          phase, cycleDay: day, loggedToday: allGates,
          showFertility, dateSeed: `2026-07-${String((day % 28) + 1).padStart(2, '0')}`,
          limit: TIPS.length,
        })) {
          reachable.add(tip.id);
        }
      }
    }
  }

  const unreachable = TIPS.filter((t) => !reachable.has(t.id)).map((t) => t.id);
  assert.deepEqual(unreachable, [],
    `these tips can never be shown: ${unreachable.join(', ')}`);
});

test('no tip duplicates another tip’s title', () => {
  const titles = TIPS.map((t) => t.title.toLowerCase());
  assert.equal(new Set(titles).size, titles.length, 'duplicate tip titles');
});

test('tip ids are unique', () => {
  const ids = TIPS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate tip ids');
});
