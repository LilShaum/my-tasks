// @ts-check
/**
 * Export and import. The promise "your data never leaves this device" is only
 * honest if she can get it off the device deliberately, so the round trip has
 * to be exact — not approximately right.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildExport, toJSON, parseImport, exportFilename, EXPORT_VERSION } from '../js/storage/backup.js';
import { emptyLog, defaultSettings, normalizeLog, normalizeSettings } from '../js/domain/model.js';

/** A state object with a bit of everything in it. */
function sampleState() {
  const settings = {
    ...defaultSettings(),
    theme: 'kuromi',
    name: 'Sam',
    avgCycleLength: 30,
    birthControl: 'condoms',
    unitTemp: /** @type {'F'} */ ('F'),
    customSymptoms: ['jaw ache', 'restless legs'],
    onboarded: true,
  };

  /** @type {Record<string, import('../js/domain/model.js').DayLog>} */
  const logs = {
    '2026-07-01': {
      ...emptyLog('2026-07-01'),
      flow: 'heavy',
      symptoms: ['cramps', 'headache'],
      moods: ['sad'],
      notes: 'rough one. "quotes" & <tags> and emoji 🩷',
      bbt: 36.42,
      weight: 61.3,
      water: 1500,
      sleep: 7.5,
    },
    '2026-07-02': {
      ...emptyLog('2026-07-02'),
      flow: 'medium',
      sex: ['protected'],
      drive: 'low',
      testOvulation: 'negative',
    },
    '2026-07-15': {
      ...emptyLog('2026-07-15'),
      discharge: ['egg-white'],
      custom: ['jaw ache'],
      pillTaken: true,
    },
  };

  const periodDays = new Set(['2026-07-01', '2026-07-02', '2026-07-03']);
  return { settings, logs, periodDays };
}

test('export declares its format and version', () => {
  const file = buildExport(sampleState());
  assert.equal(file.format, 'kittycal-export');
  assert.equal(file.version, EXPORT_VERSION);
  assert.ok(Date.parse(file.exportedAt) > 0, 'exportedAt is a real timestamp');
});

test('a full export round-trips exactly', () => {
  const original = sampleState();
  const text = toJSON(original);
  const result = parseImport(text);

  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.settings, original.settings);
  assert.deepEqual([...(result.periodDays ?? [])].sort(), [...original.periodDays].sort());
  assert.equal(result.logCount, 3);

  for (const date of Object.keys(original.logs)) {
    assert.deepEqual(
      result.logs?.[date], original.logs[date],
      `log for ${date} did not survive the round trip`,
    );
  }
});

test('notes with quotes, angle brackets and emoji survive intact', () => {
  const original = sampleState();
  const text = toJSON(original);
  const result = parseImport(text);
  assert.equal(
    result.logs?.['2026-07-01'].notes,
    'rough one. "quotes" & <tags> and emoji 🩷',
  );
});

test('floating point values are not rounded on the way through', () => {
  const original = sampleState();
  const result = parseImport(toJSON(original));
  assert.equal(result.logs?.['2026-07-01'].bbt, 36.42);
  assert.equal(result.logs?.['2026-07-01'].weight, 61.3);
  assert.equal(result.logs?.['2026-07-01'].sleep, 7.5);
});

test('an empty database round-trips to an empty database', () => {
  const empty = { settings: defaultSettings(), logs: {}, periodDays: new Set() };
  const result = parseImport(toJSON(empty));
  assert.equal(result.ok, true);
  assert.equal(result.logCount, 0);
  assert.equal(result.periodCount, 0);
  assert.deepEqual(result.settings, defaultSettings());
});

test('two exports of the same data are byte-identical apart from the timestamp', () => {
  const state = sampleState();
  const strip = (/** @type {string} */ s) => s.replace(/"exportedAt":.*/, '');
  assert.equal(strip(toJSON(state)), strip(toJSON(state)));
});

/* ── Rejecting bad input ────────────────────────────────────────────────── */

test('malformed JSON is rejected with a readable message', () => {
  const result = parseImport('{not json');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /not valid JSON/);
});

test('a file from some other app is rejected', () => {
  const result = parseImport(JSON.stringify({ some: 'other app', logs: [] }));
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /does not look like a Kittycal export/);
});

test('an export from a future version is rejected rather than half-read', () => {
  const result = parseImport(JSON.stringify({
    format: 'kittycal-export',
    version: EXPORT_VERSION + 1,
    logs: [],
    periodDays: [],
  }));
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /newer version/);
});

test('null and non-object payloads are rejected', () => {
  assert.equal(parseImport('null').ok, false);
  assert.equal(parseImport('42').ok, false);
  assert.equal(parseImport('"a string"').ok, false);
});

/* ── Tolerating damaged-but-ours input ──────────────────────────────────── */

test('a truncated or hand-edited export still imports what is salvageable', () => {
  const result = parseImport(JSON.stringify({
    format: 'kittycal-export',
    version: 1,
    settings: { theme: 'keroppi', avgCycleLength: 'not a number' },
    periodDays: ['2026-07-01', 'garbage', 42, null, '2026-07-02'],
    logs: [
      { date: '2026-07-01', flow: 'heavy' },       // missing every array field
      { date: 'nonsense', flow: 'light' },          // bad key, dropped
      { flow: 'light' },                            // no date at all, dropped
      null,
      { date: '2026-07-05', symptoms: 'not an array', bbt: 'hot' },
    ],
  }));

  assert.equal(result.ok, true);
  assert.equal(result.periodCount, 2, 'only well-formed date keys are kept');
  assert.equal(result.logCount, 2, 'only logs with a valid date are kept');

  // Missing fields are filled in rather than left undefined, so no view can
  // crash on a partial record.
  const day = result.logs?.['2026-07-01'];
  assert.deepEqual(day?.symptoms, []);
  assert.deepEqual(day?.moods, []);
  assert.equal(day?.flow, 'heavy');
  assert.equal(day?.water, 0);

  // Wrongly-typed values are coerced back to their defaults.
  const bad = result.logs?.['2026-07-05'];
  assert.deepEqual(bad?.symptoms, []);
  assert.equal(bad?.bbt, null);

  // An out-of-range setting is clamped, not accepted.
  assert.equal(result.settings?.theme, 'keroppi');
  assert.equal(result.settings?.avgCycleLength, defaultSettings().avgCycleLength);
});

test('an unknown flow value falls back to none', () => {
  const log = normalizeLog({ date: '2026-07-01', flow: /** @type {any} */ ('torrential') });
  assert.equal(log.flow, 'none');
});

test('the export filename carries the date', () => {
  assert.match(exportFilename(), /^kittycal-\d{4}-\d{2}-\d{2}\.json$/);
});

/* ── Settings survive the round trip ──────────────────────────────────────
   `normalizeSettings` decides whether an incoming value is acceptable by
   comparing its type against the default's. That silently destroys every
   field whose default is null — `typeof null` is 'object', so no real value
   ever matches — and it runs on every app start, not just on import.

   `birthYear` was the casualty: asked for during setup, discarded seconds
   later, and printed on the doctor report where it therefore never appeared.
   This asserts the whole class rather than the one field, so the next
   nullable setting cannot land the same way. */

test('every setting survives normalisation', () => {
  const populated = {
    ...defaultSettings(),
    mode: 'cycle', theme: 'kuromi', colorMode: 'dark',
    avgCycleLength: 31, avgPeriodLength: 6, lutealLength: 13,
    birthControl: 'iud-copper', birthYear: 1998, name: 'Sam',
    firstDayOfWeek: 0, unitTemp: 'F', unitWeight: 'lb', unitWater: 'oz',
    lastBackup: '2026-07-01', recapSeen: '2026-06-01', lastBackupAt: 1750000000000,
    backupSnoozed: '2026-05-01', checkinSkipped: '2026-08-01',
    onboarded: true, disclaimerAck: true,
    customSymptoms: ['PMS rage'], recentChips: ['cramps'],
    showFertility: false, schemaVersion: 1,
  };

  const out = normalizeSettings(structuredClone(populated));

  for (const key of Object.keys(populated)) {
    assert.deepEqual(out[key], populated[key], `"${key}" was not preserved`);
  }
});

test('a nonsense birth year is refused rather than kept', () => {
  assert.equal(normalizeSettings({ birthYear: 1200 }).birthYear, null);
  assert.equal(normalizeSettings({ birthYear: 3000 }).birthYear, null);
  assert.equal(normalizeSettings({ birthYear: 'nineteen' }).birthYear, null);
  assert.equal(normalizeSettings({ birthYear: NaN }).birthYear, null);
  assert.equal(normalizeSettings({}).birthYear, null, 'absent stays absent');
});
