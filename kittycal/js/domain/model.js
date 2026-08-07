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
 * @property {Record<string, 1|2|3>} severity  how bad, per symptom id; sparse
 * @property {number|null} bbt     °C
 * @property {number|null} weight  kg
 * @property {number} water        ml
 * @property {number|null} sleep   hours
 * @property {number|null} steps
 * @property {boolean} pillTaken
 * @property {string|null} testPregnancy  'positive'|'negative'
 * @property {string|null} testOvulation  'peak'|'high'|'negative'
 * @property {string} notes
 * @property {boolean} checkedIn  she was asked the daily questions and answered
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
 * @property {string} pillRegimen      see REGIMENS in pill.js
 * @property {string} pillPackStart    DateKey the current pack began, or ''
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
 * @property {string} installSnoozed  DateKey the install prompt was dismissed, or ''
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
    pillRegimen: 'none',
    pillPackStart: '',
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
    installSnoozed: '',
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
    severity: {},
    bbt: null,
    weight: null,
    water: 0,
    sleep: null,
    steps: null,
    pillTaken: false,
    testPregnancy: null,
    testOvulation: null,
    notes: '',
    checkedIn: false,
    updated: Date.now(),
  };
}

/**
 * True when she recorded nothing on this day.
 *
 * Deliberately blind to `checkedIn`: answering "no bleeding, nothing bothering
 * me" is a real answer, but it is still a day with nothing on it, and the
 * screens that describe a day want to say so.
 *
 * @param {DayLog} log
 */
export function nothingRecorded(log) {
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
 * True when a log holds nothing worth keeping. Used to prune records back out
 * of storage when the last chip is deselected, so the calendar doesn't show
 * dots for days that were opened and then emptied.
 *
 * A day she checked in on is always worth keeping, even when the answer was
 * "nothing". Storage used to delete those, which quietly broke the daily loop:
 * the commonest day of all — no bleeding, nothing bothering her — vanished on
 * write, so the app asked again the next day and the week strip showed it as
 * never logged. It also threw away real information, since "no bleeding on the
 * 3rd" is an observation the cycle maths wants and "never asked" is not.
 *
 * @param {DayLog} log
 */
export function isLogEmpty(log) {
  return !log.checkedIn && nothingRecorded(log);
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
    severity: severities(raw.severity),
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
    checkedIn: raw.checkedIn === true,
    updated: num(raw.updated) ?? Date.now(),
  };
}

/**
 * The severity map, cleaned.
 *
 * Only 1, 2 and 3 survive. Everything downstream — the report, the pattern
 * rows — indexes `SEVERITY[value - 1]` to get a word, so a stray 0 or 4 from a
 * hand-edited export would print `undefined` inside a clinical document.
 *
 * @param {unknown} raw
 * @returns {Record<string, 1|2|3>}
 */
function severities(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  /** @type {Record<string, 1|2|3>} */
  const out = {};
  for (const [id, value] of Object.entries(raw)) {
    if (value === 1 || value === 2 || value === 3) out[id] = value;
  }
  return out;
}

/**
 * Drop severities for symptoms that are no longer logged.
 *
 * Severity is stored beside the symptom list rather than inside it, which is
 * what lets it stay optional and sparse — but it also means deselecting a
 * symptom would otherwise leave its rating behind, to be silently re-attached
 * the next time that symptom was picked. Applied on write so no caller has to
 * remember.
 *
 * @param {DayLog} log
 * @returns {DayLog}
 */
export function pruneSeverity(log) {
  const kept = new Set([...log.symptoms, ...log.custom]);
  /** @type {Record<string, 1|2|3>} */
  const severity = {};
  for (const [id, value] of Object.entries(log.severity)) {
    if (kept.has(id)) severity[id] = value;
  }
  return { ...log, severity };
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

  /*
    Settings whose default is `null` have to be checked by hand.

    The loop above decides whether a value is acceptable by comparing its type
    against the default's — which works for every field with a real default and
    silently destroys every field without one, because `typeof null` is
    'object' and no number, string or boolean will ever match it.

    `birthYear` was the casualty. This function runs on every app start and on
    every settings change, so the year entered during setup was discarded
    within seconds of being given, and the doctor report's "Year of birth" line
    had never once appeared for anybody. It looked like an import bug and was
    not: the export was fine, and so was the file.
  */
  const year = raw.birthYear;
  out.birthYear = typeof year === 'number' && Number.isFinite(year)
    && year > 1900 && year <= new Date().getFullYear()
    ? Math.round(year)
    : null;

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
