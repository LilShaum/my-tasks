// @ts-check
/**
 * roundtrip.test.js — a backup must restore exactly what it saved, and a
 * damaged one must never take the app down with it.
 *
 * This app keeps no server copy. The export file is the only thing standing
 * between a woman and losing years of her own records, so two properties
 * matter more than any feature in the app:
 *
 *   1. Whatever goes in comes back out unchanged. Not "close enough" — a
 *      temperature of 36.65 must not come back 36.7, and a note with a newline
 *      in it must not come back with the newline gone.
 *   2. A file that has been damaged — truncated by a full disk, mangled by a
 *      mail client, opened and saved by a text editor — is either rejected with
 *      something readable or salvaged into a state the views can render. It is
 *      never a thrown exception, because a thrown exception during Restore is
 *      indistinguishable, from where she is sitting, from her data being gone.
 *
 * `backup.test.js` checks both with worked examples. This checks them across
 * thousands of generated states and tens of thousands of corruptions, which is
 * the only way to cover every field of every category at once.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toJSON, parseImport } from '../js/storage/backup.js';
import { defaultSettings, emptyLog, normalizeLog, normalizeSettings } from '../js/domain/model.js';
import { CATEGORIES, TESTS } from '../js/data/taxonomy.js';
import { addDays } from '../js/utils/date.js';

/** Fixed seed: a failure here is reproducible, not a flake. */
function generator(seed) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return {
    rnd,
    int: (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1)),
    pick: (a) => a[Math.floor(rnd() * a.length)],
    some: (a) => a.filter(() => rnd() < 0.35),
  };
}

const optionIds = (id) => {
  const found = [...CATEGORIES, ...TESTS].find((c) => c.id === id);
  assert.ok(found, `taxonomy has no category "${id}"`);
  return found.options.map((o) => o.id);
};

/** A log with real option ids and the awkward values people actually enter. */
function randomLog(g, date) {
  const l = emptyLog(date);
  if (g.rnd() < 0.8) l.flow = g.pick(optionIds('flow'));
  l.symptoms = g.some(optionIds('symptoms'));
  l.moods = g.some(optionIds('moods'));
  l.discharge = g.rnd() < 0.5 ? [g.pick(optionIds('discharge'))] : [];
  l.activity = g.some(optionIds('activity'));
  l.other = g.some(optionIds('other'));
  l.sex = g.some(optionIds('sex'));
  if (g.rnd() < 0.4) l.drive = g.pick(optionIds('drive'));
  if (g.rnd() < 0.4) l.testPregnancy = g.pick(optionIds('testPregnancy'));
  if (g.rnd() < 0.4) l.testOvulation = g.pick(optionIds('testOvulation'));
  // Fractions that a careless round-trip would quietly flatten.
  if (g.rnd() < 0.5) l.bbt = 35 + g.rnd() * 3;
  if (g.rnd() < 0.4) l.weight = 40 + g.rnd() * 80;
  if (g.rnd() < 0.5) l.sleep = g.rnd() * 14;
  if (g.rnd() < 0.5) l.water = g.int(0, 20);
  if (g.rnd() < 0.5) l.steps = g.int(0, 40000);
  if (g.rnd() < 0.3) l.pillTaken = g.rnd() < 0.5;
  if (g.rnd() < 0.3) l.checkedIn = true;
  if (g.rnd() < 0.4) {
    l.notes = g.pick([
      'cramps all day', '"quoted"', 'emoji 🐱 and\na newline', '  padded  ',
      'back\\slash', 'a'.repeat(400),
    ]);
  }
  if (g.rnd() < 0.3) {
    l.severity = {};
    for (const sym of l.symptoms) if (g.rnd() < 0.6) l.severity[sym] = g.int(1, 3);
  }
  if (g.rnd() < 0.2) l.custom = g.some(['my-custom-1', 'weird id']);
  l.updated = Date.now() - g.int(0, 10 ** 8);
  return normalizeLog(l);
}

test('any state she can reach survives export and import unchanged', () => {
  const g = generator(31415);

  for (let i = 0; i < 800; i++) {
    const settings = normalizeSettings({
      ...defaultSettings(),
      name: g.pick(['', 'Ada', 'a'.repeat(60), 'Zoë 🐱', '<script>']),
      colorMode: g.pick(['light', 'dark', 'auto']),
      avgCycleLength: g.int(15, 60),
      avgPeriodLength: g.int(1, 14),
      lutealLength: g.int(8, 20),
      birthControl: g.pick(['none', 'pill', 'iud-hormonal', 'condoms']),
      birthYear: g.pick([null, 1970, 1999, 2010]),
      firstDayOfWeek: g.pick([0, 1]),
      unitTemp: g.pick(['c', 'f']),
      unitWeight: g.pick(['kg', 'lb']),
      customSymptoms: g.some(['itchy', 'restless legs', 'x'.repeat(50)]),
      recentChips: g.some(['cramps', 'happy']),
      showFertility: g.rnd() < 0.5,
      onboarded: true,
      lastBackupAt: g.pick([null, new Date().toISOString()]),
    });

    /** @type {Record<string, any>} */
    const logs = {};
    let d = addDays('2026-09-30', -g.int(0, 600));
    for (let n = g.int(0, 25); n > 0; n--) {
      logs[d] = randomLog(g, d);
      d = addDays(d, g.int(1, 20));
    }

    const periodDays = new Set();
    let q = addDays('2026-09-30', -g.int(0, 600));
    for (let n = g.int(0, 40); n > 0; n--) {
      periodDays.add(q);
      q = addDays(q, g.int(1, 12));
    }

    const back = parseImport(toJSON({ settings, logs, periodDays }));
    assert.ok(back.ok, `a file this app just wrote failed to import: ${back.error}`);
    assert.deepEqual(back.settings, settings, 'settings changed across the round trip');
    assert.deepEqual([...(back.periodDays ?? [])].sort(), [...periodDays].sort(),
      'period days changed across the round trip');
    assert.deepEqual(back.logs, logs, 'a log changed across the round trip');
  }
});

test('a damaged export is refused or salvaged, never thrown', () => {
  const g = generator(27182);

  const good = toJSON({
    settings: defaultSettings(),
    logs: {
      '2026-09-01': normalizeLog({ ...emptyLog('2026-09-01'), flow: 'medium', notes: 'hi', bbt: 36.65 }),
    },
    periodDays: new Set(['2026-09-01', '2026-09-02']),
  });

  /* Shapes a hand-edited or half-written file can take, including the ones that
     put the wrong *type* in every field rather than merely the wrong value. */
  const handwritten = [
    '', ' ', 'null', '[]', '{}', '0', 'true', '"a string"', '{"format":"kittycal',
    '{"format":"kittycal-export","version":1}',
    '{"format":"kittycal-export","version":1,"logs":null,"periodDays":null,"settings":null}',
    '{"format":"kittycal-export","version":1,"logs":{"not":"an array"},"periodDays":"nope"}',
    '{"format":"kittycal-export","version":999}',
    '{"format":"kittycal-export","version":"1"}',
    '{"format":"kittycal-export","version":1,"logs":[null,1,"x",{},{"date":null},'
      + '{"date":"2026-13-45"},{"date":"2026-02-30"},{"date":"nope"}],'
      + '"periodDays":[null,1,{},"2026-02-30","0000-00-00"],"settings":[]}',
    '{"format":"kittycal-export","version":1,"settings":'
      + '{"avgCycleLength":"x","birthYear":{},"customSymptoms":5,"name":123}}',
    '{"format":"kittycal-export","version":1,"logs":[{"date":"2026-09-01",'
      + '"symptoms":"notanarray","severity":"nope","flow":{},"bbt":"hot","water":[],"updated":"soon"}]}',
  ];

  /** Every accepted import has to be something the views can render. */
  const assertUsable = (result, how) => {
    assert.ok(result && typeof result.ok === 'boolean', `no verdict for ${how}`);
    if (!result.ok) {
      assert.ok(typeof result.error === 'string' && result.error.length > 0,
        `rejected ${how} without telling her why`);
      return;
    }
    for (const key of Object.keys(defaultSettings())) {
      assert.ok(key in /** @type {any} */ (result.settings),
        `setting "${key}" went missing importing ${how}`);
    }
    for (const [key, log] of Object.entries(result.logs ?? {})) {
      assert.match(key, /^\d{4}-\d{2}-\d{2}$/, `impossible log date accepted from ${how}`);
      assert.equal(log.date, key, `a log's date disagrees with its key after ${how}`);
      for (const field of ['symptoms', 'moods', 'discharge', 'activity', 'other', 'sex', 'custom']) {
        assert.ok(Array.isArray(log[field]), `${field} is not an array after ${how}`);
      }
      assert.ok(log.severity === null
        || (typeof log.severity === 'object' && !Array.isArray(log.severity)),
      `severity is not a map after ${how}`);
    }
    for (const day of result.periodDays ?? []) {
      assert.match(day, /^\d{4}-\d{2}-\d{2}$/, `impossible period day accepted from ${how}`);
    }
  };

  for (const text of handwritten) assertUsable(parseImport(text), `handwritten ${JSON.stringify(text.slice(0, 40))}`);

  // Bit-rot against a file this app really wrote.
  for (let i = 0; i < 6000; i++) {
    const how = g.pick(['truncate', 'mutate', 'delete', 'insert', 'duplicate']);
    let t = good;
    if (how === 'truncate') {
      t = t.slice(0, g.int(0, t.length));
    } else if (how === 'mutate') {
      const at = g.int(0, t.length - 1);
      t = t.slice(0, at) + g.pick(['x', '0', '"', '}', ']', ',', ':', '\\', '-', 'e']) + t.slice(at + 1);
    } else if (how === 'delete') {
      const at = g.int(0, t.length - 1);
      t = t.slice(0, at) + t.slice(at + g.int(1, 40));
    } else if (how === 'insert') {
      const at = g.int(0, t.length);
      t = t.slice(0, at) + g.pick(['{', '[', '"', '999999999999999999', 'null', '\\u']) + t.slice(at);
    } else {
      const at = g.int(0, t.length - 1);
      t = t.slice(0, at) + t.slice(at, at + g.int(1, 60)) + t.slice(at);
    }
    assertUsable(parseImport(t), `${how} at iteration ${i}`);
  }
});
