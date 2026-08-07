// @ts-check
/**
 * csv.js — the spreadsheet seam, in both directions.
 *
 * The JSON export beside this is complete and round-trips exactly, and nobody
 * can do anything with it. A spreadsheet cannot open it, a clinician cannot
 * read it, and neither can anyone she might reasonably want to hand a year of
 * her own observations to. "Her data survives" and "she can find and
 * understand what she recorded" are the first and fourth rules in AUDIT.md,
 * and a file only one program on earth can read satisfies the first at the
 * expense of the fourth.
 *
 * So: out, one row per day in the format every tool accepts; and in, a
 * tolerant reader for the same shape, because the largest thing standing
 * between someone and this app is three years of history somewhere else.
 *
 * Two deliberate positions, both of which cost features:
 *
 *   - **Labels out, not ids.** The CSV is for reading and analysing, not for
 *     restoring — that is what the JSON is for, and it is lossless. Writing
 *     `Tender breasts` rather than `tender-breasts` makes the file useful to a
 *     human at the cost of making it a worse backup, which is the right trade
 *     for a format whose whole purpose is being read by something else.
 *
 *   - **Dates are not guessed.** See `parseDate`. Reading `03/04/2026` as the
 *     wrong one of 3 April and 4 March would move a period start by a month
 *     and silently corrupt every cycle length derived from it, which is the
 *     single worst thing this file could do.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('../domain/model.js').DayLog} DayLog
 * @typedef {import('../domain/model.js').Settings} Settings
 */

import { emptyLog, isBleeding } from '../domain/model.js';
import { labelOf, labelFor, severityLabel } from '../data/taxonomy.js';
import { buildCycles, cycleContaining } from '../domain/cycles.js';
import { daysBetween } from '../utils/date.js';

/* ── Writing ─────────────────────────────────────────────────────────────── */

const COLUMNS = [
  'date', 'cycle', 'cycle day', 'period day', 'flow',
  'symptoms', 'severity', 'moods', 'discharge', 'sex', 'sex drive',
  'activity', 'life', 'custom',
  'bbt (C)', 'weight (kg)', 'water (ml)', 'sleep (hours)', 'steps',
  'birth control taken', 'pregnancy test', 'ovulation test', 'notes',
];

/**
 * One field, escaped for RFC 4180 — and defused for a spreadsheet.
 *
 * The quoting rules are the easy half. The other half is that Excel, Sheets
 * and Numbers all treat a leading `=`, `+`, `-` or `@` as the start of a
 * formula, so a note reading `=cmd|...` becomes something the spreadsheet
 * tries to *run* when she opens her own export. Prefixing an apostrophe makes
 * it a string again; it is the standard mitigation and it costs one invisible
 * character in a cell nobody was going to sum.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function csvField(value) {
  let text = value == null ? '' : String(value);

  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** @param {(string|number)[]} cells */
const row = (cells) => cells.map(csvField).join(',');

/**
 * Every logged day as a table.
 *
 * Period days are included even when nothing else was recorded on them: a day
 * she marked as bleeding and nothing more is a real observation, and it is the
 * one every cycle length is built from. Leaving those rows out would produce a
 * file whose period column disagreed with the app.
 *
 * @param {{settings: Settings, logs: Record<DateKey, DayLog>, periodDays: Set<DateKey>|DateKey[]}} state
 * @returns {string}
 */
export function toCSV({ logs, periodDays }) {
  const period = periodDays instanceof Set ? periodDays : new Set(periodDays);
  const cycles = buildCycles([...period]);

  const dates = [...new Set([...Object.keys(logs), ...period])].sort();

  const lines = [row(COLUMNS)];

  for (const date of /** @type {DateKey[]} */ (dates)) {
    const log = logs[date] ?? emptyLog(date);
    const cycle = cycleContaining(cycles, date);
    const index = cycle ? cycle.index + 1 : '';

    lines.push(row([
      date,
      index,
      cycle ? daysBetween(cycle.start, date) + 1 : '',
      period.has(date) ? 'yes' : 'no',
      log.flow === 'none' ? '' : labelFor('flow', log.flow),
      log.symptoms.map(labelOf).join('; '),
      severities(log),
      log.moods.map(labelOf).join('; '),
      log.discharge.map((id) => labelFor('discharge', id)).join('; '),
      log.sex.map((id) => labelFor('sex', id)).join('; '),
      log.drive ? labelFor('drive', log.drive) : '',
      log.activity.map(labelOf).join('; '),
      log.other.map(labelOf).join('; '),
      log.custom.join('; '),
      log.bbt ?? '',
      log.weight ?? '',
      log.water || '',
      log.sleep ?? '',
      log.steps ?? '',
      log.pillTaken ? 'yes' : '',
      log.testPregnancy ?? '',
      log.testOvulation ?? '',
      log.notes,
    ]));
  }

  return `${lines.join('\r\n')}\r\n`;
}

/** `Cramps: Severe; Headache: Mild` — sparse, so usually empty. @param {DayLog} log */
function severities(log) {
  return Object.entries(log.severity)
    .map(([id, value]) => `${labelOf(id)}: ${severityLabel(value)}`)
    .join('; ');
}

/** Matches `exportFilename`, so a folder of exports sorts together. */
export function csvFilename() {
  const now = new Date();
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `kittycal-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

/**
 * Split CSV text into rows of fields.
 *
 * Hand-rolled because the alternative is a dependency, and this app has none.
 * Handles quoted fields, doubled quotes inside them, and newlines inside
 * quotes; tolerates CRLF and a trailing newline; and accepts semicolons or
 * tabs as the separator, since half of Europe's spreadsheets export that way
 * and a file that opens fine on her machine should not be rejected here.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCSV(text) {
  const body = text.replace(/^﻿/, '');
  const delimiter = sniffDelimiter(body);

  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let current = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];

    if (quoted) {
      if (char === '"') {
        if (body[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') { quoted = true; continue; }
    if (char === delimiter) { current.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { current.push(field); rows.push(current); current = []; field = ''; continue; }
    field += char;
  }

  if (field !== '' || current.length) { current.push(field); rows.push(current); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Whichever of comma, semicolon or tab appears most on the header line. */
function sniffDelimiter(text) {
  const first = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length - 1]);
  counts.sort((a, b) => Number(b[1]) - Number(a[1]));
  return Number(counts[0][1]) > 0 ? String(counts[0][0]) : ',';
}

/**
 * A date, or null — never a guess.
 *
 * ISO is taken as-is. `D/M/Y` and `M/D/Y` are only accepted when the file
 * itself proves which it is: a component above 12 somewhere in the column can
 * only be a day, and that settles the whole column. When nothing proves it the
 * import stops and says so, because the failure mode of guessing is a period
 * start moved by up to a month and every cycle length after it quietly wrong.
 *
 * @param {string} raw
 * @param {'iso'|'dmy'|'mdy'} order
 * @returns {DateKey|null}
 */
export function parseDate(raw, order) {
  const text = raw.trim();
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parts = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(text);
  if (!parts || order === 'iso') return null;

  const [a, b] = [Number(parts[1]), Number(parts[2])];
  return order === 'dmy'
    ? build(Number(parts[3]), b, a)
    : build(Number(parts[3]), a, b);
}

/** @param {number} y @param {number} m @param {number} d */
function build(y, m, d) {
  if (!(y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return /** @type {DateKey} */ (`${y}-${pad(m)}-${pad(d)}`);
}

/**
 * Which order the date column is in, or null when the file does not say.
 * @param {string[]} values
 * @returns {'iso'|'dmy'|'mdy'|null}
 */
export function sniffDateOrder(values) {
  let sawSlash = false;
  for (const value of values) {
    const text = value.trim();
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(text)) return 'iso';

    const parts = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(text);
    if (!parts) continue;
    sawSlash = true;
    if (Number(parts[1]) > 12) return 'dmy';
    if (Number(parts[2]) > 12) return 'mdy';
  }
  return sawSlash ? null : 'iso';
}

const DATE_HEADERS = ['date', 'day', 'when', 'datum', 'fecha', 'timestamp'];
const FLOW_HEADERS = ['flow', 'period', 'bleeding', 'menstruation', 'menstrual flow'];
const SYMPTOM_HEADERS = ['symptom', 'symptoms', 'tags'];
const NOTE_HEADERS = ['note', 'notes', 'comment', 'comments'];

/** @param {string[]} headers @param {string[]} wanted */
function findColumn(headers, wanted) {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  let index = normalized.findIndex((h) => wanted.includes(h));
  if (index === -1) index = normalized.findIndex((h) => wanted.some((w) => h.includes(w)));
  return index;
}

/**
 * How a flow cell maps onto a level.
 *
 * Deliberately conservative at the top end: an unrecognised but clearly
 * affirmative value ("yes", "x", "1") becomes `medium` rather than `heavy`,
 * because it marks the day as a period either way and inventing an intensity
 * she never gave is the thing this app refuses to do everywhere else.
 *
 * @param {string} raw
 * @returns {DayLog['flow']|null}
 */
export function parseFlow(raw) {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (/^(none|no|false|0|n)$/.test(text)) return 'none';
  if (text.includes('spot')) return 'spotting';
  if (text.includes('clot')) return 'clots';
  if (text.includes('heav') || text.includes('strong')) return 'heavy';
  if (text.includes('light') || text.includes('lite')) return 'light';
  if (text.includes('medium') || text.includes('moderate') || text.includes('normal')) return 'medium';
  if (/^(yes|y|true|1|x|period|bleeding)$/.test(text)) return 'medium';
  return null;
}

/**
 * @typedef {Object} CsvImport
 * @property {boolean} ok
 * @property {string} [error]
 * @property {Record<DateKey, DayLog>} [logs]
 * @property {Set<DateKey>} [periodDays]
 * @property {number} [rows]        data rows seen
 * @property {number} [understood]  rows that produced a day
 * @property {number} [skipped]     rows dropped, and why is in `notes`
 * @property {string[]} [notes]     plain sentences for the confirm sheet
 */

/**
 * Read a table of days from somewhere else.
 *
 * Reports rather than swallows: the existing JSON importer's rule is that junk
 * is sanitised and counted, not silently dropped, and the same applies here.
 * A file where 200 rows arrive and 40 are unreadable must say 40, or she will
 * believe she has moved history she has not.
 *
 * @param {string} text
 * @returns {CsvImport}
 */
export function parseCSVImport(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) {
    return { ok: false, error: 'That file has no rows in it.' };
  }

  const headers = rows[0];
  const dateCol = findColumn(headers, DATE_HEADERS);
  if (dateCol === -1) {
    return {
      ok: false,
      error: 'No date column found. The first row should name the columns, and ' +
        'one of them should be "date".',
    };
  }

  const body = rows.slice(1);
  const order = sniffDateOrder(body.map((r) => r[dateCol] ?? ''));
  if (order == null) {
    return {
      ok: false,
      error: 'The dates could be day/month or month/day and the file does not ' +
        'say which. Reformat that column as YYYY-MM-DD and try again.',
    };
  }

  const flowCol = findColumn(headers, FLOW_HEADERS);
  const symptomCol = findColumn(headers, SYMPTOM_HEADERS);
  const noteCol = findColumn(headers, NOTE_HEADERS);

  /** @type {Record<DateKey, DayLog>} */
  const logs = {};
  /** @type {Set<DateKey>} */
  const periodDays = new Set();
  let skipped = 0;
  let badDates = 0;

  for (const cells of body) {
    const date = parseDate(cells[dateCol] ?? '', order);
    if (!date) { skipped += 1; badDates += 1; continue; }

    const log = logs[date] ?? emptyLog(date);
    let touched = Object.prototype.hasOwnProperty.call(logs, date);

    if (flowCol !== -1) {
      const flow = parseFlow(cells[flowCol] ?? '');
      if (flow) {
        log.flow = flow;
        if (isBleeding(flow)) periodDays.add(date);
        touched = true;
      }
    }

    if (symptomCol !== -1) {
      const raw = (cells[symptomCol] ?? '').split(/[;|]/).map((s) => s.trim()).filter(Boolean);
      if (raw.length) { log.custom = [...new Set([...log.custom, ...raw])]; touched = true; }
    }

    if (noteCol !== -1) {
      const note = (cells[noteCol] ?? '').trim();
      if (note) { log.notes = log.notes ? `${log.notes}\n${note}` : note; touched = true; }
    }

    if (!touched) { skipped += 1; continue; }
    logs[date] = log;
  }

  /** @type {string[]} */
  const notes = [];
  notes.push(`Read the "${headers[dateCol].trim()}" column as dates` +
    (order === 'iso' ? '.' : order === 'dmy' ? ', day first.' : ', month first.'));
  notes.push(flowCol === -1
    ? 'No flow or period column found, so no period days were read — only the days themselves.'
    : `Read "${headers[flowCol].trim()}" as flow.`);
  if (symptomCol !== -1) {
    notes.push(`Read "${headers[symptomCol].trim()}" as symptoms. They come in as ` +
      'custom symptoms, since their names are not Kittycal’s.');
  }
  if (badDates) notes.push(`${badDates} rows had no readable date and were skipped.`);

  const understood = Object.keys(logs).length;
  if (!understood) {
    return { ok: false, error: 'Nothing in that file could be read as a day of data.' };
  }

  return { ok: true, logs, periodDays, rows: body.length, understood, skipped, notes };
}
