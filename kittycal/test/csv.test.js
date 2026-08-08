// @ts-check
/**
 * The spreadsheet seam. Two things carry most of the weight here: the export
 * must not hand a spreadsheet something it will execute, and the importer must
 * never place a day on a date the file did not unambiguously name.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toCSV, csvField, parseCSV, parseDate, sniffDateOrder, parseFlow, parseCSVImport,
} from '../js/storage/csv.js';
import { emptyLog, defaultSettings } from '../js/domain/model.js';

const state = (logs = {}, periodDays = []) => ({
  settings: defaultSettings(),
  logs,
  periodDays: new Set(periodDays),
});

/* ── Escaping ────────────────────────────────────────────────────────────── */

test('fields containing commas, quotes or newlines are quoted', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('two\nlines'), '"two\nlines"');
});

test('a note that looks like a formula is defused, not executed', () => {
  // Excel, Sheets and Numbers all run these on open.
  for (const danger of ['=1+1', '+1', '-1', '@SUM(A1)']) {
    assert.ok(csvField(danger).startsWith("'"), `${danger} should be neutralised`);
  }
  // And the escaping still applies on top of it.
  assert.equal(csvField('=a,b'), `"'=a,b"`);
});

/* ── Export ──────────────────────────────────────────────────────────────── */

test('a period day with nothing else logged still gets a row', () => {
  const text = toCSV(state({}, ['2026-03-01', '2026-03-02']));
  const lines = text.trim().split('\r\n');
  assert.equal(lines.length, 3, 'header plus two days');
  assert.ok(lines[1].startsWith('2026-03-01,1,1,yes'), lines[1]);
});

test('the export carries cycle number and cycle day', () => {
  const days = ['2026-01-01', '2026-01-02', '2026-01-29', '2026-01-30'];
  const rows = parseCSV(toCSV(state({}, days)));
  const header = rows[0];
  const cycle = header.indexOf('cycle');
  const cycleDay = header.indexOf('cycle day');

  assert.deepEqual([rows[1][cycle], rows[1][cycleDay]], ['1', '1']);
  assert.deepEqual([rows[2][cycle], rows[2][cycleDay]], ['1', '2']);
  assert.deepEqual([rows[3][cycle], rows[3][cycleDay]], ['2', '1']);
});

test('labels are written, not ids', () => {
  const log = { ...emptyLog('2026-03-01'), symptoms: ['tender-breasts'], flow: 'heavy' };
  const text = toCSV(state({ '2026-03-01': log }, ['2026-03-01']));
  assert.ok(text.includes('Tender breasts'), 'label, not tender-breasts');
  assert.ok(text.includes('Heavy'));
});

test('severity is written beside the symptom it belongs to', () => {
  const log = {
    ...emptyLog('2026-03-01'),
    symptoms: ['cramps'],
    severity: /** @type {Record<string, 1|2|3>} */ ({ cramps: 3 }),
  };
  assert.ok(toCSV(state({ '2026-03-01': log })).includes('Cramps: Severe'));
});

/* ── The CSV reader ──────────────────────────────────────────────────────── */

test('quoted fields survive commas and embedded newlines', () => {
  const rows = parseCSV('date,notes\r\n2026-01-01,"a,b"\r\n2026-01-02,"two\nlines"\r\n');
  assert.deepEqual(rows[1], ['2026-01-01', 'a,b']);
  assert.deepEqual(rows[2], ['2026-01-02', 'two\nlines']);
});

test('semicolon and tab separated files are read too', () => {
  assert.deepEqual(parseCSV('date;flow\n2026-01-01;Heavy\n')[1], ['2026-01-01', 'Heavy']);
  assert.deepEqual(parseCSV('date\tflow\n2026-01-01\tHeavy\n')[1], ['2026-01-01', 'Heavy']);
});

/* ── Dates: the part that must never guess ───────────────────────────────── */

test('an ambiguous day/month column is refused rather than guessed', () => {
  const order = sniffDateOrder(['03/04/2026', '05/06/2026']);
  assert.equal(order, null, 'nothing in the file settles it');

  const result = parseCSVImport('date,flow\n03/04/2026,Heavy\n05/06/2026,Light\n');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /day\/month or month\/day/);
});

test('a value above 12 anywhere in the column settles the whole column', () => {
  assert.equal(sniffDateOrder(['03/04/2026', '25/04/2026']), 'dmy');
  assert.equal(sniffDateOrder(['04/03/2026', '04/25/2026']), 'mdy');
  assert.equal(sniffDateOrder(['2026-04-03']), 'iso');
});

test('impossible dates are rejected rather than rolled over', () => {
  assert.equal(parseDate('2026-13-45', 'iso'), null);
  assert.equal(parseDate('2026-02-30', 'iso'), null);
  assert.equal(parseDate('2026-02-28', 'iso'), '2026-02-28');
});

test('day-first and month-first are read as told', () => {
  assert.equal(parseDate('03/04/2026', 'dmy'), '2026-04-03');
  assert.equal(parseDate('03/04/2026', 'mdy'), '2026-03-04');
});

/* ── Flow ────────────────────────────────────────────────────────────────── */

test('flow words map on, and an unknown affirmative does not invent heavy', () => {
  assert.equal(parseFlow('Heavy'), 'heavy');
  assert.equal(parseFlow('moderate'), 'medium');
  assert.equal(parseFlow('spotting'), 'spotting');
  assert.equal(parseFlow('none'), 'none');
  assert.equal(parseFlow('yes'), 'medium', 'marks the day without inventing an intensity');
  assert.equal(parseFlow('x'), 'medium');
  assert.equal(parseFlow('purple'), null);
  assert.equal(parseFlow(''), null);
});

/* ── Import ──────────────────────────────────────────────────────────────── */

test('a plain date and flow file imports, and sets period days', () => {
  const result = parseCSVImport(
    'Date,Flow,Notes\n2026-03-01,Heavy,rough one\n2026-03-02,Light,\n2026-03-15,None,\n',
  );
  assert.equal(result.ok, true);
  assert.equal(result.understood, 3);
  assert.deepEqual([...(result.periodDays ?? [])].sort(), ['2026-03-01', '2026-03-02']);
  assert.equal(result.logs?.['2026-03-01'].notes, 'rough one');
  assert.equal(result.logs?.['2026-03-15'].flow, 'none', 'a stated no-bleed is a real answer');
});

test('unreadable rows are counted and reported, not silently dropped', () => {
  const result = parseCSVImport(
    'date,flow\n2026-03-01,Heavy\nnot-a-date,Heavy\n,Light\n2026-03-02,Heavy\n',
  );
  assert.equal(result.ok, true);
  assert.equal(result.understood, 2);
  assert.equal(result.skipped, 2);
  assert.ok((result.notes ?? []).some((n) => /2 rows had no readable date/.test(n)));
});

test('a file with no date column is refused with a usable message', () => {
  const result = parseCSVImport('thing,other\na,b\n');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /date column/);
});

test('symptoms come in as custom symptoms, since the names are not ours', () => {
  const result = parseCSVImport('date,symptoms\n2026-03-01,Cramping; Sore head\n');
  assert.deepEqual(result.logs?.['2026-03-01'].custom, ['Cramping', 'Sore head']);
  assert.ok((result.notes ?? []).some((n) => /custom symptoms/.test(n)));
});

test('a file with dates but nothing readable on them is refused', () => {
  const result = parseCSVImport('date,mood\n2026-03-01,happy\n');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /could be read as a day/);
});

test('an export of real data reads back through the importer', () => {
  const logs = {
    '2026-03-01': { ...emptyLog('2026-03-01'), flow: /** @type {const} */ ('heavy'),
                    notes: 'a note, with a comma' },
    '2026-03-02': { ...emptyLog('2026-03-02'), flow: /** @type {const} */ ('light') },
  };
  const result = parseCSVImport(toCSV(state(logs, ['2026-03-01', '2026-03-02'])));

  assert.equal(result.ok, true);
  assert.equal(result.understood, 2);
  assert.deepEqual([...(result.periodDays ?? [])].sort(), ['2026-03-01', '2026-03-02']);
  assert.equal(result.logs?.['2026-03-01'].notes, 'a note, with a comma');
});
