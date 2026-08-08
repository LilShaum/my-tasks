// @ts-check
/**
 * backup.js — export and import.
 *
 * The export is the counterweight to "your data never leaves this device": it
 * has to be genuinely complete and genuinely portable, or local-only storage is
 * just a way to lose everything when a phone dies.
 *
 * Format is plain readable JSON — no compression, no binary. She should be able
 * to open the file and see her own data.
 *
 * Round-tripping is covered by test/backup.test.js: export, wipe, import, and
 * the result must deep-equal the original.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('../domain/model.js').DayLog} DayLog
 * @typedef {import('../domain/model.js').Settings} Settings
 */

import { normalizeLog, normalizeSettings } from '../domain/model.js';

export const EXPORT_VERSION = 1;
const MAGIC = 'kittycal-export';

/**
 * @typedef {Object} ExportFile
 * @property {string} format
 * @property {number} version
 * @property {string} exportedAt  ISO timestamp
 * @property {Settings} settings
 * @property {DateKey[]} periodDays
 * @property {DayLog[]} logs
 */

/**
 * Build the export payload.
 * @param {{settings: Settings, logs: Record<DateKey, DayLog>, periodDays: Set<DateKey>}} state
 * @returns {ExportFile}
 */
export function buildExport({ settings, logs, periodDays }) {
  return {
    format: MAGIC,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    periodDays: [...periodDays].sort(),
    // Sorted so two exports of the same data produce identical files, which
    // makes them diffable and makes "did anything change?" answerable.
    logs: Object.keys(logs).sort().map((date) => logs[date]),
  };
}

/**
 * Serialise to a pretty-printed JSON string.
 * @param {{settings: Settings, logs: Record<DateKey, DayLog>, periodDays: Set<DateKey>}} state
 */
export function toJSON(state) {
  return JSON.stringify(buildExport(state), null, 2);
}

/**
 * A filename with the date in it, so a folder of exports sorts sensibly.
 */
export function exportFilename() {
  const now = new Date();
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `kittycal-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/**
 * @typedef {Object} ImportResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {string} [exportedAt]  ISO timestamp the file claims, if it has one
 * @property {Settings} [settings]
 * @property {Record<DateKey, DayLog>} [logs]
 * @property {Set<DateKey>} [periodDays]
 * @property {number} [logCount]
 * @property {number} [periodCount]
 */

/**
 * Parse and validate an export file.
 *
 * Deliberately forgiving about shape and strict about identity: anything that
 * claims to be a Kittycal export gets normalised field by field through
 * model.js, so a truncated or hand-edited file can't produce a record that
 * crashes a view. But a file that isn't one of ours is rejected outright rather
 * than half-imported.
 *
 * @param {string} text
 * @returns {ImportResult}
 */
/**
 * A date key that names a day that exists.
 *
 * The shape check alone accepted `2026-13-45`, which JavaScript then rolls
 * over into some other day entirely — so a hand-edited or corrupted file could
 * land a log on a date she never wrote. Rebuilding the key from the parsed
 * date and comparing is the cheapest way to reject the impossible ones.
 *
 * @param {unknown} key
 * @returns {key is string}
 */
function isRealDate(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function parseImport(text) {
  /** @type {any} */
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }

  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'That file does not contain any data.' };
  }
  if (raw.format !== MAGIC) {
    return { ok: false, error: 'That does not look like a Kittycal export.' };
  }
  if (typeof raw.version !== 'number' || raw.version > EXPORT_VERSION) {
    return {
      ok: false,
      error: 'That export was made by a newer version of Kittycal than this one.',
    };
  }

  /** @type {Record<DateKey, DayLog>} */
  const logs = {};
  if (Array.isArray(raw.logs)) {
    for (const entry of raw.logs) {
      if (!entry || typeof entry.date !== 'string') continue;
      if (!isRealDate(entry.date)) continue;
      logs[entry.date] = normalizeLog(entry);
    }
  }

  const periodDays = new Set(
    Array.isArray(raw.periodDays)
      // Same rule as the logs: a period day has to name a day that exists.
      // A phantom date here is worse than one on a log, because every cycle
      // length in the app is measured from these.
      ? raw.periodDays.filter(isRealDate)
      : [],
  );

  return {
    ok: true,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : undefined,
    settings: normalizeSettings(raw.settings),
    logs,
    periodDays,
    logCount: Object.keys(logs).length,
    periodCount: periodDays.size,
  };
}

/**
 * Trigger a download. Uses an object URL and a synthetic click, which is the
 * only approach that works across mobile browsers without a server.
 * @param {string} text
 * @param {string} filename
 * @param {string} [type] mime type; the CSV export needs its own, or a
 *   spreadsheet asked to open the file has to guess from the extension
 */
export function downloadFile(text, filename, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke on the next tick — immediately can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Read a picked file as text.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file'));
    reader.readAsText(file);
  });
}
