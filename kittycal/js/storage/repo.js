// @ts-check
/**
 * repo.js — the only module that talks to db.js.
 *
 * Views and domain code go through here, so the storage shape stays an
 * implementation detail. Reads normalise through model.js, which means a
 * record written by an older version can never reach a view malformed.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('../domain/model.js').DayLog} DayLog
 * @typedef {import('../domain/model.js').Settings} Settings
 */

import * as db from './db.js';
import { normalizeLog, normalizeSettings, isLogEmpty } from '../domain/model.js';

const META_SETTINGS = 'settings';
const META_PERIODS = 'periodDays';

/* ── Settings ───────────────────────────────────────────────────────────── */

/** @returns {Promise<Settings>} */
export async function loadSettings() {
  const raw = await db.getMeta(META_SETTINGS, null);
  return normalizeSettings(raw);
}

/** @param {Settings} settings */
export async function saveSettings(settings) {
  await db.setMeta(META_SETTINGS, settings);
}

/* ── Period days ─────────────────────────────────────────────────────────
   The set of days she has confirmed as period bleeding. This is the single
   source of truth for the whole prediction engine: cycles, phases and
   forecasts are all derived from it and never stored.

   Kept as a sorted array on disk (JSON-friendly, diffable in an export) and
   handed out as a Set for O(1) membership tests.                          */

/** @returns {Promise<Set<DateKey>>} */
export async function loadPeriodDays() {
  /** @type {unknown} */
  const raw = await db.getMeta(META_PERIODS, []);
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k)));
}

/** @param {Set<DateKey>} days */
export async function savePeriodDays(days) {
  await db.setMeta(META_PERIODS, [...days].sort());
}

/* ── Day logs ───────────────────────────────────────────────────────────── */

/**
 * Every log, as a flat map keyed by date. The whole history is loaded at boot:
 * five years of daily logging is well under a megabyte, and having it in
 * memory makes every selector and chart synchronous.
 * @returns {Promise<Record<DateKey, DayLog>>}
 */
export async function loadLogs() {
  /** @type {any[]} */
  const rows = await db.getAll(db.STORE_LOGS);
  /** @type {Record<DateKey, DayLog>} */
  const out = {};
  for (const row of rows) {
    if (!row || typeof row.date !== 'string') continue;
    out[row.date] = normalizeLog(row);
  }
  return out;
}

/** @param {DayLog[]} logs */
export async function saveLogs(logs) {
  const keep = logs.filter((l) => !isLogEmpty(l));
  const drop = logs.filter((l) => isLogEmpty(l));
  await db.putMany(db.STORE_LOGS, keep.map((l) => ({ ...l })));
  for (const log of drop) await db.del(db.STORE_LOGS, log.date);
}

/* ── Mascot images ───────────────────────────────────────────────────────
   Stored as Blobs keyed by theme id. Kept out of the logs store so an
   export of her cycle data stays small and human-readable.               */

/**
 * @param {string} themeId
 * @returns {Promise<Blob|null>}
 */
export async function loadMascot(themeId) {
  /** @type {{id: string, blob: Blob}|undefined} */
  const row = await db.get(db.STORE_BLOBS, `mascot:${themeId}`);
  return row?.blob ?? null;
}

/**
 * @param {string} themeId
 * @param {Blob} blob
 */
export async function saveMascot(themeId, blob) {
  await db.put(db.STORE_BLOBS, { id: `mascot:${themeId}`, blob, updated: Date.now() });
}

/** @param {string} themeId */
export async function deleteMascot(themeId) {
  await db.del(db.STORE_BLOBS, `mascot:${themeId}`);
}

/* ── Whole-database operations ──────────────────────────────────────────── */

/**
 * Load everything needed to boot, in one pass.
 * @returns {Promise<{settings: Settings, logs: Record<DateKey, DayLog>, periodDays: Set<DateKey>}>}
 */
export async function loadAll() {
  const [settings, logs, periodDays] = await Promise.all([
    loadSettings(),
    loadLogs(),
    loadPeriodDays(),
  ]);
  return { settings, logs, periodDays };
}

/** Erase everything, including settings and images. */
export async function eraseEverything() {
  await db.destroy();
}

