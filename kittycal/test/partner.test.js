// @ts-check
/**
 * Partner sharing: the summary she sends, what his screen makes of it, and the
 * encryption it travels under.
 *
 * The things that must never break, in the order they would hurt:
 *   - the summary holds only what she ticked, and never a log, a note, a test
 *     result or the fact that her period is late;
 *   - his screen stays right while her app is closed, and never says "late";
 *   - the key that decrypts the summary is not something a wrong key, a
 *     malformed link or a repeated encryption can get around.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SHARE_ITEMS, defaultChoices, buildSnapshot, partnerModel, icsFor, cleanSnapshot,
  partnerDay, dayItems, laneWhen, isDue, nextRun, freshStatus, STATUS_HOURS,
} from '../js/domain/partner.js';
import {
  newSecrets, encrypt, decrypt, shareLink, parseShareHash,
  newCode, normalizeCode, secretsFromCode, parseShareInput,
} from '../js/storage/share.js';
import { defaultSettings } from '../js/domain/model.js';
import { addDays } from '../js/utils/date.js';

const TODAY = '2026-10-04';

/** @typedef {import('../js/domain/partner.js').Snapshot} Snapshot */

/* ── buildSnapshot ──────────────────────────────────────────────────────── */

/** A prediction with a forecast, in the one shape buildSnapshot reads. */
const prediction = (/** @type {Record<string, any>} */ over = {}) => /** @type {any} */ ({
  avgCycleLength: 28, avgPeriodLength: 5, lutealDays: 14,
  lastStart: addDays(TODAY, -10), nextStart: addDays(TODAY, 18),
  expecting: false, stale: false, onHormonal: false, showFertility: true,
  // Things she knows that the summary must never carry.
  isLate: false, daysLate: null, pregnancyTest: null, confidence: 'high',
  ...over,
});

const PATTERNS = /** @type {any[]} */ ([
  { id: 'cramps', kind: 'symptoms', cyclesWith: 4, cyclesTotal: 4, typicalBefore: 2 },
  { id: 'irritable', kind: 'moods', cyclesWith: 4, cyclesTotal: 4, typicalBefore: 4 },
  { id: 'my own thing', kind: 'custom', cyclesWith: 3, cyclesTotal: 4, typicalBefore: 5 },
]);

/** @param {Record<string, any>} [over] */
const snapshot = (over = {}) => {
  const { choices, settings, prediction: p, ...rest } = over;
  return buildSnapshot({
    settings: { ...defaultSettings(), name: 'Sam', ...settings },
    prediction: prediction(p),
    choices: { ...defaultChoices(), mood: true, fertile: true, ...choices },
    helps: 'A heat pad and a quiet night.',
    patterns: PATTERNS,
    moodWindow: 3,
    today: TODAY,
    ...rest,
  });
};

test('the defaults match what the sheet shows: only the fertile window starts off', () => {
  const d = defaultChoices();
  assert.equal(d.fertile, false);
  for (const id of ['phase', 'patterns', 'mood', 'helps', 'name']) {
    assert.equal(/** @type {any} */ (d)[id], true, id);
  }
  // The note is not a toggle: it goes when she writes one.
  assert.deepEqual(Object.keys(d).sort(), [...SHARE_ITEMS.map((i) => i.id), 'helps'].sort());
});

test('with everything chosen the summary carries it', () => {
  const s = snapshot();
  assert.equal(s.name, 'Sam');
  assert.equal(s.phase, true);
  assert.equal(s.fertile, true);
  assert.equal(s.mood, 3);
  assert.equal(s.helps, 'A heat pad and a quiet night.');
  assert.equal(s.paused, false);
  assert.equal(s.lastStart, addDays(TODAY, -10));
  assert.equal(s.nextStart, addDays(TODAY, 18));
  assert.equal(s.cycleLength, 28);
  assert.equal(s.periodLength, 5);
  assert.equal(s.lutealDays, 14);
  assert.equal(s.updated, TODAY);
});

test('every choice is respected, one at a time', () => {
  assert.equal(snapshot({ choices: { name: false } }).name, null);
  assert.equal(snapshot({ choices: { phase: false } }).phase, false);
  assert.deepEqual(snapshot({ choices: { patterns: false } }).patterns, []);
  assert.equal(snapshot({ choices: { helps: false } }).helps, '');
  assert.equal(snapshot({ choices: { mood: false } }).mood, null);
  assert.equal(snapshot({ choices: { fertile: false } }).fertile, false);
});

test('a blank name is no name, even when she chose to share it', () => {
  assert.equal(snapshot({ settings: { name: '   ' } }).name, null);
});

test('the name is trimmed to 40 characters and the helps text to 600', () => {
  const s = snapshot({ settings: { name: ` ${'N'.repeat(80)} ` }, helps: `  ${'h'.repeat(900)}  ` });
  assert.equal(s.name?.length, 40);
  assert.equal(s.helps.length, 600);
  assert.equal(s.helps, 'h'.repeat(600));
});

test('patterns leave moods out, use her own words for custom ones, and stop at five', () => {
  const s = snapshot();
  assert.equal(s.patterns.some((p) => p.label.toLowerCase().includes('irritable')), false);
  assert.equal(s.patterns.length, 2);
  assert.deepEqual(s.patterns[1], { label: 'my own thing', before: 5 });
  assert.equal(s.patterns[0].before, 2);
  assert.notEqual(s.patterns[0].label, 'cramps', 'a symptom id becomes its label');

  const many = Array.from({ length: 9 }, (_, i) => ({
    id: `c${i}`, kind: 'custom', cyclesWith: 3, cyclesTotal: 3, typicalBefore: 2,
  }));
  assert.equal(snapshot({ patterns: many }).patterns.length, 5);
});

test('the summary has exactly the documented fields: no logs, notes, tests or lateness', () => {
  const s = snapshot({
    prediction: { isLate: true, daysLate: 9, pregnancyTest: 'negative', confidence: 'low' },
    settings: { notes: 'private diary', partnerOf: null },
  });
  assert.deepEqual(Object.keys(s).sort(), [
    'cycleLength', 'easy', 'fertile', 'helps', 'lanes', 'lastStart', 'lutealDays', 'mood', 'name',
    'nextStart', 'patterns', 'paused', 'periodLength', 'phase', 'stats', 'status', 'theme', 'tracked', 'updated', 'v',
  ]);
  const text = JSON.stringify(s);
  for (const word of ['late', 'Late', 'pregnan', 'test', 'note', 'diary', 'log']) {
    assert.equal(text.includes(word), false, `must not mention "${word}"`);
  }
});

test('a late period reads the same as an on-time one: the dates are her forecast', () => {
  const late = snapshot({ prediction: { isLate: true, daysLate: 6, nextStart: addDays(TODAY, -6) } });
  assert.equal(late.paused, false);
  assert.equal(late.nextStart, addDays(TODAY, -6));
  assert.equal('isLate' in late, false);
  assert.equal('daysLate' in late, false);
});

test('expecting, stale, or no forecast: paused, with no dates, patterns or mood', () => {
  const cases = [
    { expecting: true }, { stale: true }, { lastStart: null }, { nextStart: null },
  ];
  for (const over of cases) {
    const s = snapshot({ prediction: over });
    assert.equal(s.paused, true, JSON.stringify(over));
    assert.equal(s.lastStart, null);
    assert.equal(s.nextStart, null);
    assert.deepEqual(s.patterns, []);
    assert.equal(s.mood, null);
  }
});

test('expecting and stale look the same from the outside', () => {
  const a = snapshot({ prediction: { expecting: true } });
  const b = snapshot({ prediction: { stale: true } });
  assert.deepEqual(a, b);
});

test('hormonal birth control: fertile false even when chosen, and no phase text', () => {
  const s = snapshot({ prediction: { onHormonal: true }, choices: { fertile: true, phase: true } });
  assert.equal(s.fertile, false);
  assert.equal(s.phase, false);
});

test('fertile is also off when the app does not show fertility', () => {
  assert.equal(snapshot({ prediction: { showFertility: false } }).fertile, false);
});

/* ── partnerModel ───────────────────────────────────────────────────────── */

/**
 * A summary whose next period is `until` days from `today`; her last start is
 * a cycle before that. Everything on, unless overridden.
 * @param {number} until
 * @param {Partial<Snapshot>} [over]
 * @returns {Snapshot}
 */
const snap = (until, over = {}) => ({
  v: 1, name: 'Sam', updated: addDays(TODAY, -2), paused: false,
  lastStart: addDays(TODAY, until - 28), nextStart: addDays(TODAY, until),
  cycleLength: 28, periodLength: 5, lutealDays: 14,
  phase: true, fertile: true, patterns: [], mood: null, helps: '',
  theme: 'hellokitty', lanes: [], easy: null, stats: null, status: null, tracked: null,
  ...over,
});

/** A summary read on a day `offset` days from the one it was made around. */
const modelOn = (/** @type {Snapshot} */ s, /** @type {number} */ offset = 0) =>
  partnerModel(s, addDays(TODAY, offset));

test('on her period: day N, only from a start she logged', () => {
  // Last start 2 days ago, so today is day 3.
  const s = snap(26);
  const m = partnerModel(s, TODAY);
  assert.equal(m.status, 'period');
  assert.equal(m.headline, 'On Sam’s period, day 3');
  assert.equal(m.phase?.id, 'period');

  assert.equal(partnerModel(s, addDays(s.lastStart ?? '', 0)).headline, 'On Sam’s period, day 1');
  assert.equal(partnerModel(s, addDays(s.lastStart ?? '', 4)).headline, 'On Sam’s period, day 5');
  // Day six is past a five-day period.
  assert.notEqual(partnerModel(s, addDays(s.lastStart ?? '', 5)).status, 'period');
});

test('without a name it says her', () => {
  const m = partnerModel(snap(26, { name: null }), TODAY);
  assert.equal(m.headline, 'On her period, day 3');
  assert.equal(m.who, 'Your partner');
});

test('a forecast start that has arrived is never "on her period", only due', () => {
  const m = modelOn(snap(0));
  assert.equal(m.status, 'due');
  const m2 = modelOn(snap(0), 3);
  assert.equal(m2.status, 'due', 'still inside its expected days');
  assert.doesNotMatch(m2.headline, /day \d/);
});

test('Period likely in N days for 1 to 7, "tomorrow" for 1, a plain count beyond', () => {
  assert.equal(modelOn(snap(1)).headline, 'Period likely tomorrow');
  assert.equal(modelOn(snap(2)).headline, 'Period likely in 2 days');
  assert.equal(modelOn(snap(7)).headline, 'Period likely in 7 days');
  assert.equal(modelOn(snap(7)).status, 'soon');
  assert.equal(modelOn(snap(8)).headline, 'Next period in about 8 days');
  assert.equal(modelOn(snap(8)).status, 'later');
  assert.equal(modelOn(snap(20)).headline, 'Next period in about 20 days');
  assert.ok(modelOn(snap(3)).sub, 'soon has a line about being ready');
  assert.equal(modelOn(snap(10)).sub, null);
});

test('"due around now" from the forecast start until its expected period has passed', () => {
  assert.equal(modelOn(snap(0)).headline, 'Sam’s period is due around now');
  for (let late = 0; late <= 4; late++) {
    const m = modelOn(snap(-late));
    assert.equal(m.status, 'due', `${late} days after the forecast start`);
    assert.equal(m.headline, 'Sam’s period is due around now');
  }
  assert.equal(modelOn(snap(0, { name: null })).headline, 'Her period is due around now');
});

test('then it rolls forward a cycle if her app has not been opened since, and never says late', () => {
  // The forecast start was after her last update: nobody knows, so the next
  // cycle is the best guess once the expected bleed is over.
  const unseen = snap(-5, { updated: addDays(TODAY, -6) });
  const m = modelOn(unseen);
  assert.equal(m.status, 'later');
  assert.equal(m.headline, 'Next period in about 23 days');
  assert.equal(m.upcoming[0].start, addDays(TODAY, 23));

  for (let days = 0; days <= 120; days += 3) {
    const m2 = modelOn(snap(0), days);
    assert.doesNotMatch(`${m2.headline} ${m2.sub ?? ''}`, /late|overdue|missed/i, `day +${days}`);
  }
});

test('if her app saw the forecast start pass with no period logged, it stays due, not "23 days away"', () => {
  // Forecast start 8 days ago; her app updated the summary 2 days ago.
  const s = snap(-8);
  for (const offset of [0, 5, 15]) {
    const m = modelOn(s, offset);
    assert.equal(m.status, 'due', `+${offset}`);
    assert.doesNotMatch(m.headline, /late|overdue|missed/i);
  }
  // A cycle on, her own forecast has stopped guessing, and so does his.
  assert.notEqual(modelOn(s, 28).status, 'due');
});

test('rolling forward is by whole cycles, however long the summary sits', () => {
  const m = modelOn(snap(0), 28 * 3 + 10);
  assert.equal(m.status, 'later');
  assert.equal(m.upcoming[0].start, addDays(TODAY, 28 * 4));
  // And a rolled-forward start is a forecast, never "on her period".
  assert.notEqual(modelOn(snap(0), 28 + 1).status, 'period');
});

test('upcoming: three periods, one cycle apart, each as long as her period', () => {
  const m = modelOn(snap(10, { cycleLength: 30, periodLength: 4 }));
  assert.equal(m.upcoming.length, 3);
  assert.equal(m.upcoming[0].start, addDays(TODAY, 10));
  assert.equal(m.upcoming[0].end, addDays(TODAY, 13));
  assert.equal(m.upcoming[1].start, addDays(TODAY, 40));
  assert.equal(m.upcoming[1].end, addDays(TODAY, 43));
});

test('phase ids: follicular, fertile (only when shared) and luteal', () => {
  // Ovulation is next - 14, so until=23 is 9 days before it (and day 6 of her cycle).
  assert.equal(modelOn(snap(23)).phase?.id, 'follicular');
  assert.equal(modelOn(snap(20)).phase?.id, 'follicular');
  assert.equal(modelOn(snap(19)).phase?.id, 'fertile');
  assert.equal(modelOn(snap(15)).phase?.id, 'fertile');
  assert.equal(modelOn(snap(14)).phase?.id, 'fertile', 'the day itself');
  assert.equal(modelOn(snap(13)).phase?.id, 'fertile', 'the day after');
  assert.equal(modelOn(snap(12)).phase?.id, 'luteal');
  assert.equal(modelOn(snap(5)).phase?.id, 'luteal');

  // Not shared: the same days read as the phases around it, never as fertile.
  for (let until = 1; until <= 25; until++) {
    const id = modelOn(snap(until, { fertile: false })).phase?.id;
    assert.notEqual(id, 'fertile', `until ${until}`);
  }
  assert.equal(modelOn(snap(16, { fertile: false })).phase?.id, 'follicular');
  assert.equal(modelOn(snap(13, { fertile: false })).phase?.id, 'luteal');
});

test('no phase card when she did not share the phase', () => {
  assert.equal(modelOn(snap(10, { phase: false })).phase, null);
  assert.equal(modelOn(snap(26, { phase: false })).phase, null, 'not even on her period');
});

test('patterns are flagged "now" when within their lead time plus a day', () => {
  const patterns = [{ label: 'Bloating', before: 3 }];
  assert.equal(modelOn(snap(5, { patterns })).patterns[0].now, false);
  assert.equal(modelOn(snap(4, { patterns })).patterns[0].now, true);
  assert.equal(modelOn(snap(1, { patterns })).patterns[0].now, true);
  assert.equal(modelOn(snap(0, { patterns })).patterns[0].now, false, 'due: it is here, not coming');
  assert.equal(modelOn(snap(26, { patterns })).patterns[0].now, false, 'on her period');
  assert.equal(modelOn(snap(4, { patterns })).patterns[0].label, 'Bloating');
});

test('mood text: "about now" inside the window, a lead time outside it', () => {
  const near = modelOn(snap(2, { mood: 3 })).mood;
  assert.equal(near, 'Harder days usually start about now for Sam.');
  const far = modelOn(snap(15, { mood: 3 })).mood;
  assert.equal(far, 'Harder days usually start about 3 days before Sam’s period.');
  assert.equal(modelOn(snap(2, { mood: 3, name: null })).mood,
    'Harder days usually start about now for her.');
  assert.equal(modelOn(snap(15, { mood: 3, name: null })).mood,
    'Harder days usually start about 3 days before her period.');
  assert.equal(modelOn(snap(15)).mood, null, 'not shared');
  assert.equal(modelOn(snap(26, { mood: 3 })).mood?.includes('about now'), false, 'on her period');
});

test('helps text passes through untouched', () => {
  assert.equal(modelOn(snap(10, { helps: 'Tea.' })).helps, 'Tea.');
});

test('a paused summary is the quiet model, helps kept, nothing else', () => {
  const paused = snap(10, {
    paused: true, lastStart: null, nextStart: null, helps: 'Tea.', patterns: [{ label: 'x', before: 2 }], mood: 2,
  });
  const m = partnerModel(paused, TODAY);
  assert.equal(m.status, 'quiet');
  assert.equal(m.headline, 'Nothing to show right now');
  assert.equal(m.sub, 'Sam will update this when there is.');
  assert.equal(m.phase, null);
  assert.deepEqual(m.patterns, []);
  assert.equal(m.mood, null);
  assert.deepEqual(m.upcoming, []);
  assert.equal(m.helps, 'Tea.');

  assert.equal(partnerModel({ ...paused, name: null }, TODAY).sub,
    'Your partner will update this when there is.');
  // Missing dates are quiet even if `paused` was somehow false.
  assert.equal(partnerModel(snap(10, { nextStart: null }), TODAY).status, 'quiet');
});

test('the summary is enough on its own: it agrees with a fresh one a few days later', () => {
  // Her phone made this four days ago. A fresh one made today says the same.
  const old = snap(10, { updated: addDays(TODAY, -4), lastStart: addDays(TODAY, -4 - 18), nextStart: addDays(TODAY, 6) });
  const fresh = snap(6, { lastStart: addDays(TODAY, 6 - 28), nextStart: addDays(TODAY, 6) });
  assert.deepEqual(partnerModel(old, TODAY).upcoming, partnerModel(fresh, TODAY).upcoming);
  assert.equal(partnerModel(old, TODAY).headline, partnerModel(fresh, TODAY).headline);
});

/* ── icsFor ─────────────────────────────────────────────────────────────── */

test('icsFor: three all-day events, end exclusive, CRLF throughout', () => {
  const m = modelOn(snap(10, { periodLength: 5 }));
  const ics = icsFor(m, '20261004T120000Z');

  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(/(?<!\r)\n/.test(ics), false, 'every newline is CRLF');
  assert.equal((ics.match(/^BEGIN:VEVENT$/gm) ?? []).length, 3);
  assert.equal((ics.match(/^END:VEVENT$/gm) ?? []).length, 3);

  const day = (/** @type {string} */ k) => k.replace(/-/g, '');
  const [a, b] = m.upcoming;
  assert.ok(ics.includes(`DTSTART;VALUE=DATE:${day(a.start)}\r\n`));
  assert.ok(ics.includes(`DTEND;VALUE=DATE:${day(addDays(a.end, 1))}\r\n`), 'exclusive end: the day after');
  assert.ok(ics.includes(`DTSTART;VALUE=DATE:${day(b.start)}\r\n`));
  assert.ok(ics.includes(`DTEND;VALUE=DATE:${day(addDays(b.end, 1))}\r\n`));
  assert.equal((ics.match(/^DTSTAMP:20261004T120000Z$/gm) ?? []).length, 3);
  assert.ok(ics.includes('SUMMARY:Sam’s period (expected)'));
  // Unique ids, or a calendar merges the two.
  const uids = ics.match(/^UID:.*$/gm) ?? [];
  assert.equal(new Set(uids).size, 3);
});

test('icsFor: without a name the event just says Period', () => {
  const ics = icsFor(modelOn(snap(10, { name: null })), '20261004T120000Z');
  assert.ok(ics.includes('SUMMARY:Period (expected)'));
});

test('icsFor: a month boundary rolls the exclusive end over correctly', () => {
  const m = partnerModel(snap(0, { nextStart: '2026-10-29', lastStart: '2026-10-01', periodLength: 5 }), '2026-10-10');
  const ics = icsFor(m, '20261010T000000Z');
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261029'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20261103'), 'Oct 29 + 5 days = Nov 3 (the day after Nov 2)');
});

/* ── share.js: secrets, encryption, links ───────────────────────────────── */

const B64URL = /^[A-Za-z0-9_-]+$/;

test('newSecrets: id 22, key 43 and token 43 characters of base64url', () => {
  const s = newSecrets();
  assert.equal(s.id.length, 22);
  assert.equal(s.key.length, 43);
  assert.equal(s.token.length, 43);
  for (const v of Object.values(s)) assert.match(v, B64URL);
});

test('newSecrets: fresh every time, and the three differ', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const s = newSecrets();
    for (const v of Object.values(s)) seen.add(v);
  }
  assert.equal(seen.size, 150);
});

test('newSecrets satisfy the server: id 16 to 64, token at least 32', () => {
  const s = newSecrets();
  assert.ok(s.id.length >= 16 && s.id.length <= 64);
  assert.ok(s.token.length >= 32);
  assert.ok(s.key.length >= 40 && s.key.length <= 64, 'and the link pattern');
});

test('encrypt then decrypt returns the same value', async () => {
  const { key } = newSecrets();
  const value = {
    v: 1, name: 'Sam ♥', helps: 'A heat pad — “quiet night”. 日本語 🐱',
    patterns: [{ label: 'Bloating', before: 3 }], mood: null, paused: false,
  };
  const blob = await encrypt(value, key);
  assert.match(blob, B64URL);
  assert.deepEqual(await decrypt(blob, key), value);
});

test('the ciphertext does not contain the plaintext', async () => {
  const { key } = newSecrets();
  const blob = await encrypt({ name: 'Samantha', helps: 'chocolate' }, key);
  const raw = Buffer.from(blob.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
  assert.equal(raw.includes('Samantha'), false);
  assert.equal(raw.includes('chocolate'), false);
  assert.equal(blob.includes('Samantha'), false);
});

test('decrypt with the wrong key rejects', async () => {
  const blob = await encrypt({ a: 1 }, newSecrets().key);
  await assert.rejects(decrypt(blob, newSecrets().key));
});

test('decrypt of a tampered blob rejects', async () => {
  const { key } = newSecrets();
  const blob = await encrypt({ a: 1 }, key);
  const flipped = `${blob.slice(0, -4)}${blob.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`;
  await assert.rejects(decrypt(flipped, key));
});

test('two encryptions of the same value differ: the IV is random', async () => {
  const { key } = newSecrets();
  const a = await encrypt({ same: true }, key);
  const b = await encrypt({ same: true }, key);
  assert.notEqual(a, b);
  assert.notEqual(a.slice(0, 16), b.slice(0, 16), 'the first twelve bytes are the IV');
  assert.deepEqual(await decrypt(a, key), await decrypt(b, key));
});

test('shareLink and parseShareHash round trip with an explicit base', () => {
  const s = newSecrets();
  const link = shareLink(s, 'https://example.org/kittycal/');
  assert.equal(link, `https://example.org/kittycal/#partner=${s.id}.${s.key}`);
  const hash = link.slice(link.indexOf('#'));
  assert.deepEqual(parseShareHash(hash), { id: s.id, key: s.key });
});

test('the key is in the fragment, so it is never sent to a server', () => {
  const s = newSecrets();
  const url = new URL(shareLink(s, 'https://example.org/app/'));
  assert.equal(url.pathname + url.search, '/app/');
  assert.ok(url.hash.includes(s.key));
});

test('parseShareHash rejects anything that is not a share link', () => {
  const s = newSecrets();
  const bad = [
    '', '#', '#partner=', '#partner=.', '#partner', `#partner=${s.id}`, `#partner=${s.id}.`,
    `#partner=.${s.key}`, `#partner=${s.id}${s.key}`,
    `#partner=short.${s.key}`, `#partner=${s.id}.short`,
    `#partner=${'a'.repeat(65)}.${s.key}`, `#partner=${s.id}.${'a'.repeat(65)}`,
    `#partner=${s.id}.${'a'.repeat(39)}`, `#partner=${'a'.repeat(15)}.${s.key}`,
    `#partner=${s.id}.${s.key}.extra`, `#partner=${s.id}.${s.key}&x=1`,
    `#partner=${s.id}.${s.key}/`, `#partner=${s.id}!.${s.key}`, `#partner=${s.id}.${s.key}+`,
    `partner=${s.id}.${s.key}`, `#Partner=${s.id}.${s.key}`, `#other=${s.id}.${s.key}`,
    ` #partner=${s.id}.${s.key}`, `#partner=${s.id}.${s.key} `, `#partner=${s.id}.${s.key}\n`,
    '#partner=<script>.alert(1)',
  ];
  for (const hash of bad) assert.equal(parseShareHash(hash), null, JSON.stringify(hash));
});

/* ── cleanSnapshot: what arrives from a link is untrusted ───────────────── */

test('cleanSnapshot: a real summary passes through unchanged', () => {
  const snap = snapshot();
  assert.deepEqual(cleanSnapshot(JSON.parse(JSON.stringify(snap))), snap);
  const paused = snapshot({ prediction: { expecting: true } });
  assert.deepEqual(cleanSnapshot(paused), paused);
});

test('cleanSnapshot: anything that is not a summary is refused', () => {
  for (const junk of [null, 42, 'hi', [], {}, { v: 3, updated: TODAY }, { v: 1, updated: 'yesterday' }]) {
    assert.equal(cleanSnapshot(junk), null, JSON.stringify(junk));
  }
});

test('cleanSnapshot: hand-made fields are typed, ranged and capped, and the view still draws', () => {
  const bad = cleanSnapshot({
    v: 1, updated: TODAY, name: { evil: true }, lastStart: addDays(TODAY, -3), nextStart: 'soon',
    cycleLength: 9999, periodLength: -1, lutealDays: 'x', phase: 'yes', fertile: 1,
    patterns: [{ label: '<img src=x onerror=alert(1)>', before: 500 }, 'nope', null, { before: 2 }],
    mood: 'lots', helps: 'x'.repeat(5000),
  });
  assert.ok(bad);
  assert.equal(bad.name, null);
  assert.equal(bad.nextStart, null);
  assert.equal(bad.paused, true, 'no forecast without both dates');
  assert.equal(bad.cycleLength, 28);
  assert.equal(bad.periodLength, 5);
  assert.equal(bad.lutealDays, 14);
  assert.equal(bad.phase, false);
  assert.equal(bad.fertile, false);
  // Kept as text: the view sets textContent, so markup is shown, never run.
  assert.deepEqual(bad.patterns, [{ label: '<img src=x onerror=alert(1)>'.slice(0, 40), before: 3 }]);
  assert.equal(bad.mood, null);
  assert.equal(bad.helps.length, 600);
  assert.doesNotThrow(() => partnerModel(bad, TODAY));
});

/* ── The partner app: days, help, status, codes ─────────────────────────── */

const LANES = /** @type {import('../js/domain/partner.js').Lane[]} */ ([
  { id: 'cramps', label: 'Cramps', kind: 'body', from: 1, to: 2 },
  { id: 'bloating', label: 'Bloating', kind: 'body', from: -3, to: -1 },
  { id: 'harder-days', label: 'Harder days', kind: 'mood', from: -4, to: -1 },
]);

test('partnerDay: lanes land on the right days, counted from either end of her cycle', () => {
  const s = snap(3, { lanes: LANES, easy: { from: 7, to: 11 } });
  const d = partnerDay(s, TODAY);
  assert.ok(d);
  assert.equal(d.untilNext, 3);
  assert.deepEqual(d.lanes.map((l) => l.id), ['bloating', 'harder-days']);
  assert.equal(partnerDay(s, addDays(TODAY, -1))?.lanes.map((l) => l.id).join(), 'harder-days');
  // Day 1 and 2 of the next period: cramps, counted from the expected start.
  const first = partnerDay(s, addDays(TODAY, 3));
  assert.equal(first?.period, 'expected');
  assert.equal(first?.cycleDay, 1);
  assert.deepEqual(first?.lanes.map((l) => l.id), ['cramps']);
  // Day 9 of the cycle that started 25 days ago: her easier stretch.
  assert.equal(partnerDay(s, addDays(TODAY, -17))?.easy, true);
  assert.equal(partnerDay(s, TODAY)?.easy, false);
});

test('partnerDay: nothing before her last start, and nothing while paused', () => {
  const s = snap(10);
  assert.equal(partnerDay(s, addDays(s.lastStart ?? '', -1)), null);
  assert.equal(partnerDay({ ...s, paused: true }, TODAY), null);
});

test('dayItems: each thing named, with when it usually happens for her and one thing that helps', () => {
  const s = snap(3, { lanes: LANES });
  const items = dayItems(s, /** @type {any} */ (partnerDay(s, TODAY)), TODAY);
  assert.deepEqual(items.map((i) => i.title), ['Bloating', 'Harder days']);
  assert.match(items[0].text, /^Usually the last 3 days before her period\. \S/);
  assert.match(items[1].text, /^Usually the last 4 days before her period\. /);
  for (const i of items) assert.ok(i.text.length < 120 && !i.text.includes('\n'), i.text);
  // Stable through the day, so it does not change under him.
  assert.deepEqual(dayItems(s, /** @type {any} */ (partnerDay(s, TODAY)), TODAY), items);
});

test('dayItems: her period by day, a coming one as likely, a quiet stretch as easier', () => {
  const on = snap(-1, { lastStart: addDays(TODAY, -1), lanes: LANES });
  const onItems = dayItems(on, /** @type {any} */ (partnerDay(on, TODAY)), TODAY);
  assert.equal(onItems[0].title, 'Period, day 2');
  assert.equal(onItems[1].title, 'Cramps');
  assert.match(onItems[1].text, /^Usually the first 2 days of her period\./);

  const soon = snap(1);
  assert.equal(dayItems(soon, /** @type {any} */ (partnerDay(soon, TODAY)), TODAY)[0].title, 'Period likely tomorrow');
  const ahead = snap(5);
  const day = /** @type {any} */ (partnerDay(ahead, addDays(TODAY, 6)));
  assert.equal(dayItems(ahead, day, TODAY)[0].title, 'Period likely, day 2');

  const quiet = snap(20, { easy: { from: 7, to: 11 } });
  const q = dayItems(quiet, /** @type {any} */ (partnerDay(quiet, TODAY)), TODAY);
  assert.equal(q[0].title, 'One of her easier days');
  assert.match(q[0].text, /^Usually days 7 to 11 of her cycle\. /);
});

test('a due period is "due any day", never day 3 or 4 of something unconfirmed', () => {
  const s = snap(-3, { lanes: LANES });
  const d = /** @type {any} */ (partnerDay(s, TODAY));
  assert.equal(d.period, 'expected');
  assert.ok(isDue(s, d, TODAY));
  const items = dayItems(s, d, TODAY);
  assert.equal(items[0].title, 'Period due any day');
  assert.ok(!items.some((i) => /Period, day|Cramps|easing off/.test(`${i.title} ${i.text}`)), JSON.stringify(items));
  // A forecast period ahead is not due.
  const ahead = snap(5);
  assert.ok(!isDue(ahead, /** @type {any} */ (partnerDay(ahead, addDays(TODAY, 5))), TODAY));
});

test('laneWhen: said the way he would picture it', () => {
  assert.equal(laneWhen({ from: 1, to: 2 }, 5), 'Usually the first 2 days of her period');
  assert.equal(laneWhen({ from: 1, to: 1 }, 5), 'Usually the first day of her period');
  assert.equal(laneWhen({ from: 2, to: 3 }, 5), 'Usually days 2 to 3 of her period');
  assert.equal(laneWhen({ from: 8, to: 13 }, 5), 'Usually days 8 to 13 of her cycle');
  assert.equal(laneWhen({ from: -3, to: -1 }, 5), 'Usually the last 3 days before her period');
  assert.equal(laneWhen({ from: -1, to: -1 }, 5), 'Usually the day before her period');
  assert.equal(laneWhen({ from: -6, to: -3 }, 5), 'Usually 6 to 3 days before her period');
});

test('nextRun: the stretch under way today with its real first day, or the next one', () => {
  const s = snap(3, { lanes: LANES, easy: { from: 7, to: 11 } });
  const since = /** @type {any} */ (partnerDay(s, TODAY)).start;
  const harder = nextRun(s, (d) => d.lanes.some((l) => l.kind === 'mood'), since, TODAY);
  assert.deepEqual(harder, { from: addDays(TODAY, -1), to: addDays(TODAY, 2) });
  const easy = nextRun(s, (d) => d.easy, since, TODAY);
  // This cycle's easier days are over; the next ones are days 7 to 11 of the next.
  assert.deepEqual(easy, { from: addDays(TODAY, 3 + 6), to: addDays(TODAY, 3 + 10) });
});

test('buildSnapshot: tracked says how many cycles of check-ins her patterns have, only if shared', () => {
  assert.equal(snapshot({ tracked: 1 }).tracked, 1);
  assert.equal(snapshot({ tracked: 1, choices: { patterns: false, mood: false } }).tracked, null);
  assert.equal(cleanSnapshot({ ...snap(5), tracked: 2 })?.tracked, 2);
  assert.equal(cleanSnapshot({ ...snap(5), tracked: 'lots' })?.tracked, 0);
  assert.equal(cleanSnapshot({ ...snap(5), tracked: undefined })?.tracked, null);
});

test('freshStatus: shows for its hours, then lapses', () => {
  const s = snap(10, { status: { id: 'tired', at: 1_000_000 } });
  assert.ok(freshStatus(s, 1_000_000 + 3600e3));
  assert.equal(freshStatus(s, 1_000_000 + STATUS_HOURS * 3600e3 + 1), null);
});

test('cleanSnapshot: v2 lanes, easier days, stats and status survive; bad ones are dropped', () => {
  const good = snap(10, {
    v: 2, lanes: LANES, easy: { from: 7, to: 11 },
    stats: { min: 27, max: 31, cycles: 6, regularity: 'regular', hits: 4, total: 4 },
    status: { id: 'snacks', at: 5 },
  });
  assert.deepEqual(cleanSnapshot(JSON.parse(JSON.stringify(good))), good);
  const bad = cleanSnapshot({ ...good,
    lanes: [{ id: 'x', label: 'X', kind: 'body', from: -3, to: 4 }, { id: 'y', label: 'Y', kind: 'evil', from: 2, to: 1 }],
    easy: { from: 0, to: 99 }, status: { id: 'hack', at: 1 }, theme: '<script>' });
  assert.deepEqual(bad?.lanes, []);
  assert.equal(bad?.easy, null);
  assert.equal(bad?.status, null);
  assert.equal(bad?.theme, null);
});

test('codes: forgiving to type, and the same code always gives the same share', async () => {
  const code = newCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.equal(normalizeCode(code.toLowerCase().replace('-', ' ')), code);
  assert.equal(normalizeCode('ABCDE-FGHIO'), 'ABCDE-FGH10');
  assert.equal(normalizeCode('too short'), null);
  const a = await secretsFromCode(code);
  const b = await secretsFromCode(code);
  assert.deepEqual(a, b);
  assert.notEqual((await secretsFromCode(newCode())).id, a.id);
  assert.match(a.id, /^[A-Za-z0-9_-]{22}$/);
  // The derived key really encrypts and decrypts.
  assert.deepEqual(await decrypt(await encrypt({ hi: 1 }, a.key), a.key), { hi: 1 });
});

test('links and typed input: a code link, a pasted link, or the bare code all connect', () => {
  const code = 'ABCDE-FGHJK';
  assert.deepEqual(parseShareHash(`#partner=${code}`), { code });
  assert.equal(shareLink({ id: 'i', key: 'k', code }, 'https://x/'), `https://x/#partner=${code}`);
  assert.deepEqual(parseShareInput(`Open this: https://x/kittycal/#partner=${code}`), { code });
  assert.deepEqual(parseShareInput(' abcde fghjk '), { code });
  assert.equal(parseShareInput('hello'), null);
});
