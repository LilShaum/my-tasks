// @ts-check
/**
 * model.js — data shapes and their defaults.
 *
 * Pure data and factory functions, no I/O. Both the storage layer and the
 * domain layer import from here, so neither has to depend on the other.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 */

/**
 * One logged day. Absent fields mean "not logged", which is distinct from a
 * zero — `flow: 'none'` is a statement that there was no bleeding, while no
 * record at all means she didn't open the app.
 *
 * Canonical units, always: bbt in °C, weight in kg, water in ml.
 *
 * @typedef {Object} DayLog
 * @property {DateKey} date
 * @property {'none'|'spotting'|'light'|'medium'|'heavy'|'clots'} flow
 * @property {string[]} symptoms   taxonomy ids
 * @property {string[]} moods
 * @property {string[]} discharge
 * @property {string[]} activity
 * @property {string[]} other      travel, stress, alcohol, illness…
 * @property {string[]} sex        protected, unprotected, masturbation…
 * @property {string|null} drive   'low'|'neutral'|'high'
 * @property {string[]} custom     user-defined symptom ids
 * @property {number|null} bbt     °C
 * @property {number|null} weight  kg
 * @property {number} water        ml
 * @property {number|null} sleep   hours
 * @property {number|null} steps
 * @property {boolean} pillTaken
 * @property {string|null} testPregnancy  'positive'|'negative'
 * @property {string|null} testOvulation  'peak'|'high'|'negative'
 * @property {string} notes
 * @property {number} updated      epoch ms, for import conflict resolution
 */

/**
 * @typedef {Object} Settings
 * @property {'cycle'|'conceive'|'pregnancy'} mode
 * @property {string} theme
 * @property {'light'|'dark'|'auto'} colorMode
 * @property {number} avgCycleLength   user's stated prior, in days
 * @property {number} avgPeriodLength  days
 * @property {number} lutealLength     days; 14 unless she knows better
 * @property {string} birthControl     see BIRTH_CONTROL
 * @property {number|null} birthYear
 * @property {string} name             for greetings; optional, local-only
 * @property {0|1} firstDayOfWeek      0 Sunday, 1 Monday
 * @property {'C'|'F'} unitTemp
 * @property {'kg'|'lb'} unitWeight
 * @property {'ml'|'oz'} unitWater
 * @property {string} lastBackup      DateKey of the last export, or ''
 * @property {string} recapSeen       cycleStart of the last recap dismissed, or ''
 * @property {number} lastBackupAt    epoch ms of the last export, or 0
 * @property {string} backupSnoozed   DateKey the backup prompt was dismissed, or ''
 * @property {string} checkinSkipped  DateKey the daily check-in was skipped, or ''
 * @property {boolean} onboarded
 * @property {boolean} disclaimerAck
 * @property {string[]} customSymptoms
 * @property {string[]} recentChips    ids, most recent first
 * @property {boolean} showFertility   derived-ish; see predict.js
 * @property {number} schemaVersion
 */

/** Hormonal methods suppress ovulation, so fertility output is meaningless. */
export const HORMONAL_BIRTH_CONTROL = new Set([
  'pill-combined', 'pill-mini', 'implant', 'injection', 'iud-hormonal',
  'patch', 'ring',
]);

export const BIRTH_CONTROL = [
  { id: 'none', label: 'None' },
  { id: 'pill-combined', label: 'Combined pill' },
  { id: 'pill-mini', label: 'Mini pill' },
  { id: 'iud-hormonal', label: 'Hormonal IUD' },
  { id: 'iud-copper', label: 'Copper IUD' },
  { id: 'implant', label: 'Implant' },
  { id: 'injection', label: 'Injection' },
  { id: 'patch', label: 'Patch' },
  { id: 'ring', label: 'Vaginal ring' },
  { id: 'condoms', label: 'Condoms' },
  { id: 'fertility-awareness', label: 'Fertility awareness' },
  { id: 'other', label: 'Something else' },
];

/** @returns {Settings} */
export function defaultSettings() {
  return {
    mode: 'cycle',
    theme: 'hellokitty',
    colorMode: 'auto',
    avgCycleLength: 28,
    avgPeriodLength: 5,
    lutealLength: 14,
    birthControl: 'none',
    birthYear: null,
    name: '',
    firstDayOfWeek: 1,
    unitTemp: 'C',
    unitWeight: 'kg',
    unitWater: 'ml',
    lastBackup: '',
    recapSeen: '',
    lastBackupAt: 0,
    backupSnoozed: '',
    checkinSkipped: '',
    onboarded: false,
    disclaimerAck: false,
    customSymptoms: [],
    recentChips: [],
    showFertility: true,
    schemaVersion: 1,
  };
}

/**
 * @param {DateKey} date
 * @returns {DayLog}
 */
export function emptyLog(date) {
  return {
    date,
    flow: 'none',
    symptoms: [],
    moods: [],
    discharge: [],
    activity: [],
    other: [],
    sex: [],
    drive: null,
    custom: [],
    bbt: null,
    weight: null,
    water: 0,
    sleep: null,
    steps: null,
    pillTaken: false,
    testPregnancy: null,
    testOvulation: null,
    notes: '',
    updated: Date.now(),
  };
}

/**
 * True when a log holds nothing worth keeping. Used to prune records back out
 * of storage when the last chip is deselected, so the calendar doesn't show
 * dots for days that were opened and then emptied.
 * @param {DayLog} log
 */
export function isLogEmpty(log) {
  return (
    log.flow === 'none' &&
    !log.symptoms.length && !log.moods.length && !log.discharge.length &&
    !log.activity.length && !log.other.length && !log.sex.length &&
    !log.custom.length &&
    log.drive == null && log.bbt == null && log.weight == null &&
    log.sleep == null && log.steps == null &&
    !log.water && !log.pillTaken &&
    log.testPregnancy == null && log.testOvulation == null &&
    !log.notes.trim()
  );
}

/**
 * A flow level that counts as menstrual bleeding. Spotting deliberately does
 * not: Flo treats it as bleeding outside a period, and folding it into period
 * days would corrupt cycle-length maths.
 * @param {DayLog['flow']} flow
 */
export function isBleeding(flow) {
  return flow === 'light' || flow === 'medium' || flow === 'heavy' || flow === 'clots';
}

/**
 * Normalise a possibly-old or partial record up to the current shape. Applied
 * on read and on import, so a record written by an older version — or a
 * hand-edited export — can never crash a view with an undefined array.
 * @param {Partial<DayLog> & {date: DateKey}} raw
 * @returns {DayLog}
 */
export function normalizeLog(raw) {
  const base = emptyLog(raw.date);
  /** @param {unknown} v */
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  /** @param {unknown} v */
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  return {
    ...base,
    ...raw,
    flow: isValidFlow(raw.flow) ? raw.flow : 'none',
    symptoms: arr(raw.symptoms),
    moods: arr(raw.moods),
    discharge: arr(raw.discharge),
    activity: arr(raw.activity),
    other: arr(raw.other),
    sex: arr(raw.sex),
    custom: arr(raw.custom),
    drive: typeof raw.drive === 'string' ? raw.drive : null,
    bbt: num(raw.bbt),
    weight: num(raw.weight),
    sleep: num(raw.sleep),
    steps: num(raw.steps),
    water: num(raw.water) ?? 0,
    pillTaken: raw.pillTaken === true,
    testPregnancy: typeof raw.testPregnancy === 'string' ? raw.testPregnancy : null,
    testOvulation: typeof raw.testOvulation === 'string' ? raw.testOvulation : null,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    updated: num(raw.updated) ?? Date.now(),
  };
}

/**
 * @param {unknown} flow
 * @returns {flow is DayLog['flow']}
 */
function isValidFlow(flow) {
  return flow === 'none' || flow === 'spotting' || flow === 'light' ||
         flow === 'medium' || flow === 'heavy' || flow === 'clots';
}

/**
 * Merge stored settings over the defaults, dropping unknown keys and keeping
 * the type of each known one. Same reasoning as normalizeLog.
 * @param {Partial<Settings>|null|undefined} raw
 * @returns {Settings}
 */
export function normalizeSettings(raw) {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;

  /** @type {Settings} */
  const out = { ...base };
  for (const key of /** @type {(keyof Settings)[]} */ (Object.keys(base))) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (typeof value === typeof base[key] || Array.isArray(base[key])) {
      // @ts-expect-error — key-by-key assignment is sound, TS can't see it
      out[key] = value;
    }
  }

  // Clamp the numeric priors into physiologically sane ranges so a corrupted
  // or hand-edited value can't produce nonsense predictions.
  out.avgCycleLength = clampInt(out.avgCycleLength, 15, 90, base.avgCycleLength);
  out.avgPeriodLength = clampInt(out.avgPeriodLength, 1, 14, base.avgPeriodLength);
  out.lutealLength = clampInt(out.lutealLength, 8, 20, base.lutealLength);
  out.firstDayOfWeek = out.firstDayOfWeek === 0 ? 0 : 1;
  if (!Array.isArray(out.customSymptoms)) out.customSymptoms = [];
  if (!Array.isArray(out.recentChips)) out.recentChips = [];

  return out;
}

/**
 * @param {unknown} n
 * @param {number} lo
 * @param {number} hi
 * @param {number} fallback
 */
function clampInt(n, lo, hi, fallback) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
