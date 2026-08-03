// @ts-check
/**
 * severity.test.js — how bad it was.
 *
 * Two things worth pinning down. The rating must never outlive the symptom it
 * describes, and the summary must never speak for days she did not grade —
 * both are ways of putting a number in a doctor's hands that she never gave.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptyLog, normalizeLog, pruneSeverity } from '../js/domain/model.js';
import { severitySummary } from '../js/domain/stats.js';
import { severityLabel, SEVERITY } from '../js/data/taxonomy.js';

/**
 * @param {string} date
 * @param {string[]} symptoms
 * @param {Record<string, any>} severity
 */
function day(date, symptoms, severity = {}) {
  return { ...emptyLog(date), symptoms, severity };
}

/* ── Storage ────────────────────────────────────────────────────────────── */

test('a rating is dropped when its symptom is', () => {
  const log = pruneSeverity(day('2026-01-02', ['cramps'], { cramps: 3, headache: 2 }));

  assert.deepEqual(log.severity, { cramps: 3 },
    'the headache was deselected, so its rating goes with it');
});

test('a rating on a custom symptom survives pruning', () => {
  const log = pruneSeverity({
    ...emptyLog('2026-01-02'),
    custom: ['sore feet'],
    severity: { 'sore feet': 2 },
  });

  assert.deepEqual(log.severity, { 'sore feet': 2 });
});

test('pruning does not mutate the log it was given', () => {
  const before = day('2026-01-02', [], { cramps: 3 });
  pruneSeverity(before);
  assert.deepEqual(before.severity, { cramps: 3 }, 'the caller still holds its own copy');
});

test('only 1, 2 and 3 survive normalisation', () => {
  const log = normalizeLog(/** @type {any} */ ({
    date: '2026-01-02',
    severity: { cramps: 3, headache: 0, nausea: 4, acne: '2', bloating: null, fatigue: 1 },
  }));

  assert.deepEqual(log.severity, { cramps: 3, fatigue: 1 },
    'anything else would print as undefined in the report');
});

test('a missing or malformed severity map becomes an empty one', () => {
  for (const raw of [undefined, null, 'nope', 42, ['cramps']]) {
    const log = normalizeLog(/** @type {any} */ ({ date: '2026-01-02', severity: raw }));
    assert.deepEqual(log.severity, {}, `${JSON.stringify(raw)} is not a severity map`);
  }
});

test('a log written before severity existed still reads', () => {
  const log = normalizeLog(/** @type {any} */ ({ date: '2026-01-02', symptoms: ['cramps'] }));
  assert.deepEqual(log.severity, {});
  assert.equal(log.severity.cramps, undefined, 'and asking about one is not an error');
});

/* ── Summary ────────────────────────────────────────────────────────────── */

test('a symptom that was never graded reports nothing', () => {
  const logs = {
    '2026-01-02': day('2026-01-02', ['cramps']),
    '2026-01-03': day('2026-01-03', ['cramps']),
  };

  assert.deepEqual(severitySummary('cramps', logs),
    { rated: 0, worst: 0, typical: 0, counts: [0, 0, 0] });
});

test('ungraded days are left out rather than counted as mild', () => {
  const logs = {
    '2026-01-02': day('2026-01-02', ['cramps'], { cramps: 3 }),
    '2026-01-03': day('2026-01-03', ['cramps']),
    '2026-01-04': day('2026-01-04', ['cramps']),
  };

  const out = severitySummary('cramps', logs);
  assert.equal(out.rated, 1, 'one day was graded, not three');
  assert.equal(out.typical, 3, 'and averaging the blanks in would have said mild');
});

test('typical is the level she actually chose most often', () => {
  const logs = {};
  for (let i = 1; i <= 6; i += 1) logs[`2026-01-0${i}`] = day(`2026-01-0${i}`, ['cramps'], { cramps: 1 });
  logs['2026-01-07'] = day('2026-01-07', ['cramps'], { cramps: 3 });
  logs['2026-01-08'] = day('2026-01-08', ['cramps'], { cramps: 3 });

  const out = severitySummary('cramps', logs);
  assert.equal(out.typical, 1, 'the mean would be 1.5, which she never reported');
  assert.equal(out.worst, 3, 'but the worst still gets recorded');
  assert.equal(out.rated, 8);
  assert.deepEqual(out.counts, [6, 0, 2]);
});

test('a tie goes to the worse level', () => {
  const logs = {
    '2026-01-02': day('2026-01-02', ['cramps'], { cramps: 1 }),
    '2026-01-03': day('2026-01-03', ['cramps'], { cramps: 3 }),
  };

  assert.equal(severitySummary('cramps', logs).typical, 3,
    'under-reporting to a doctor is the costlier mistake');
});

test('severities belonging to other symptoms are not counted', () => {
  const logs = {
    '2026-01-02': day('2026-01-02', ['cramps', 'headache'], { cramps: 1, headache: 3 }),
  };

  assert.deepEqual(severitySummary('cramps', logs).counts, [1, 0, 0]);
  assert.deepEqual(severitySummary('headache', logs).counts, [0, 0, 1]);
});

/* ── Wording ────────────────────────────────────────────────────────────── */

test('every stored level has a word, and nothing else does', () => {
  assert.deepEqual(SEVERITY.map((s) => s.value), [1, 2, 3]);
  for (const level of SEVERITY) assert.equal(severityLabel(level.value), level.label);

  for (const bad of [0, 4, null, undefined, '1']) {
    assert.equal(severityLabel(bad), null, `${String(bad)} is not a severity`);
  }
});

/* ── Backup ─────────────────────────────────────────────────────────────── */

test('a rating survives export and import', async () => {
  const { buildExport, parseImport } = await import('../js/storage/backup.js');
  const { defaultSettings } = await import('../js/domain/model.js');

  const log = { ...day('2026-01-02', ['cramps'], { cramps: 3 }), custom: ['sore feet'] };
  log.severity['sore feet'] = 1;

  const file = buildExport({
    settings: defaultSettings(),
    logs: { '2026-01-02': log },
    periodDays: new Set(['2026-01-02']),
  });

  // Through the serialised text, not just through the functions: severity is
  // the first object-valued field on a log, so anything that flattened it
  // would pass a test that skipped the round trip.
  const back = parseImport(JSON.stringify(file));

  assert.ok(back.ok, back.error);
  assert.deepEqual(back.logs['2026-01-02'].severity, { cramps: 3, 'sore feet': 1 });
});
