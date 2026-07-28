// @ts-check
/**
 * taxonomy.js — everything that can be logged about a day.
 *
 * Flo advertises "70+ symptoms and events" across roughly 16 trackers. Its
 * exact list isn't published anywhere machine-readable, so this is built from
 * the categories and options that could be confirmed, extended with the
 * standard menstrual-health taxonomy. It's a superset, not a reconstruction:
 * ~110 options across 12 categories, plus unlimited custom symptoms.
 *
 * Notes on a few deliberate choices:
 *
 *   - Spotting is a flow level but does *not* count as a period day. It means
 *     bleeding outside a period, and folding it into period days would corrupt
 *     every cycle-length calculation downstream. Flo separates them for the
 *     same reason.
 *   - Moods are not sorted good-to-bad and carry no valence in the data. The
 *     app never scores a day.
 *   - Emoji are decoration only. Every option has a text label, and the label
 *     is what's stored, announced and exported.
 */

/**
 * @typedef {Object} Option
 * @property {string} id       stable; this is what gets stored
 * @property {string} label
 * @property {string} [emoji]
 *
 * @typedef {Object} Category
 * @property {string} id       matches the DayLog field it writes to
 * @property {string} name
 * @property {string} [hint]
 * @property {'single'|'multi'} select
 * @property {Option[]} options
 */

/** @type {Category[]} */
export const CATEGORIES = [
  {
    id: 'flow',
    name: 'Flow',
    hint: 'Marking light, medium, heavy or clots also marks the day as a period day.',
    select: 'single',
    options: [
      { id: 'none', label: 'No bleeding', emoji: '·' },
      { id: 'spotting', label: 'Spotting', emoji: '·' },
      { id: 'light', label: 'Light', emoji: '○' },
      { id: 'medium', label: 'Medium', emoji: '◐' },
      { id: 'heavy', label: 'Heavy', emoji: '●' },
      { id: 'clots', label: 'Blood clots', emoji: '◆' },
    ],
  },

  {
    id: 'moods',
    name: 'Mood',
    select: 'multi',
    options: [
      { id: 'calm', label: 'Calm', emoji: '😌' },
      { id: 'happy', label: 'Happy', emoji: '🙂' },
      { id: 'energetic', label: 'Energetic', emoji: '⚡' },
      { id: 'playful', label: 'Playful', emoji: '😄' },
      { id: 'confident', label: 'Confident', emoji: '😎' },
      { id: 'neutral', label: 'Neutral', emoji: '😐' },
      { id: 'mood-swings', label: 'Mood swings', emoji: '🎢' },
      { id: 'irritable', label: 'Irritable', emoji: '😤' },
      { id: 'angry', label: 'Angry', emoji: '😠' },
      { id: 'sad', label: 'Sad', emoji: '😢' },
      { id: 'anxious', label: 'Anxious', emoji: '😰' },
      { id: 'panicky', label: 'Panicky', emoji: '😱' },
      { id: 'low', label: 'Very low', emoji: '🌧' },
      { id: 'apathetic', label: 'Apathetic', emoji: '😶' },
      { id: 'low-energy', label: 'Low energy', emoji: '🔋' },
      { id: 'confused', label: 'Confused', emoji: '😵' },
      { id: 'guilty', label: 'Feeling guilty', emoji: '😔' },
      { id: 'obsessive', label: 'Obsessive thoughts', emoji: '🌀' },
      { id: 'self-critical', label: 'Very self-critical', emoji: '🪞' },
    ],
  },

  {
    id: 'symptoms',
    name: 'Symptoms',
    select: 'multi',
    options: [
      { id: 'cramps', label: 'Cramps', emoji: '🌀' },
      { id: 'abdominal-pain', label: 'Abdominal pain', emoji: '💢' },
      { id: 'ovulation-pain', label: 'Ovulation pain', emoji: '⚡' },
      { id: 'backache', label: 'Backache', emoji: '🔻' },
      { id: 'headache', label: 'Headache', emoji: '🤕' },
      { id: 'migraine', label: 'Migraine', emoji: '⚡' },
      { id: 'tender-breasts', label: 'Tender breasts', emoji: '💗' },
      { id: 'breast-lumps', label: 'Breast lumps', emoji: '⚪' },
      { id: 'bloating', label: 'Bloating', emoji: '🎈' },
      { id: 'gas', label: 'Gas', emoji: '💨' },
      { id: 'nausea', label: 'Nausea', emoji: '🤢' },
      { id: 'vomiting', label: 'Vomiting', emoji: '🤮' },
      { id: 'diarrhea', label: 'Diarrhoea', emoji: '🚽' },
      { id: 'constipation', label: 'Constipation', emoji: '🧱' },
      { id: 'indigestion', label: 'Indigestion', emoji: '🔥' },
      { id: 'fatigue', label: 'Fatigue', emoji: '🥱' },
      { id: 'dizziness', label: 'Dizziness', emoji: '💫' },
      { id: 'fainting', label: 'Fainting', emoji: '😵' },
      { id: 'insomnia', label: 'Insomnia', emoji: '🌙' },
      { id: 'restless-sleep', label: 'Restless sleep', emoji: '🛏' },
      { id: 'night-sweats', label: 'Night sweats', emoji: '💧' },
      { id: 'hot-flashes', label: 'Hot flushes', emoji: '🔥' },
      { id: 'chills', label: 'Chills', emoji: '🥶' },
      { id: 'fever', label: 'Fever', emoji: '🌡' },
      { id: 'acne', label: 'Acne', emoji: '🔴' },
      { id: 'oily-skin', label: 'Oily skin', emoji: '✨' },
      { id: 'dry-skin', label: 'Dry skin', emoji: '🍂' },
      { id: 'itching', label: 'Itching', emoji: '🌾' },
      { id: 'hair-loss', label: 'Hair loss', emoji: '🪮' },
      { id: 'joint-pain', label: 'Joint pain', emoji: '🦴' },
      { id: 'brain-fog', label: 'Brain fog', emoji: '🌫' },
      { id: 'swelling', label: 'Swelling', emoji: '🫧' },
      { id: 'cravings', label: 'Food cravings', emoji: '🍫' },
      { id: 'increased-appetite', label: 'Increased appetite', emoji: '🍽' },
      { id: 'low-appetite', label: 'Low appetite', emoji: '🥄' },
      { id: 'frequent-urination', label: 'Frequent urination', emoji: '💦' },
      { id: 'uti-pain', label: 'Burning when peeing', emoji: '⚠️' },
      { id: 'thrush', label: 'Thrush', emoji: '🍄' },
    ],
  },

  {
    id: 'discharge',
    name: 'Vaginal discharge',
    select: 'multi',
    options: [
      { id: 'none', label: 'None', emoji: '·' },
      { id: 'sticky', label: 'Sticky', emoji: '🩹' },
      { id: 'creamy', label: 'Creamy', emoji: '🥛' },
      { id: 'watery', label: 'Watery', emoji: '💧' },
      { id: 'egg-white', label: 'Egg white', emoji: '🥚' },
      { id: 'clumpy-white', label: 'Clumpy white', emoji: '☁️' },
      { id: 'brown', label: 'Brown', emoji: '🟤' },
      { id: 'grey', label: 'Grey', emoji: '⬜' },
      { id: 'unusual-smell', label: 'Unusual smell', emoji: '👃' },
      { id: 'atypical', label: 'Unusual for me', emoji: '❓' },
    ],
  },

  {
    id: 'sex',
    name: 'Sex',
    select: 'multi',
    options: [
      { id: 'none', label: 'No sex', emoji: '·' },
      { id: 'protected', label: 'Protected sex', emoji: '🛡' },
      { id: 'unprotected', label: 'Unprotected sex', emoji: '💗' },
      { id: 'oral', label: 'Oral sex', emoji: '💋' },
      { id: 'anal', label: 'Anal sex', emoji: '🍑' },
      { id: 'masturbation', label: 'Masturbation', emoji: '✋' },
      { id: 'toys', label: 'Sex toys', emoji: '🎀' },
      { id: 'orgasm', label: 'Orgasm', emoji: '✨' },
      { id: 'painful', label: 'Painful sex', emoji: '⚠️' },
    ],
  },

  {
    id: 'drive',
    name: 'Sex drive',
    select: 'single',
    options: [
      { id: 'low', label: 'Low', emoji: '🔽' },
      { id: 'neutral', label: 'Neutral', emoji: '➖' },
      { id: 'high', label: 'High', emoji: '🔼' },
    ],
  },

  {
    id: 'activity',
    name: 'Activity',
    select: 'multi',
    options: [
      { id: 'none', label: 'Didn’t exercise', emoji: '·' },
      { id: 'walking', label: 'Walking', emoji: '🚶' },
      { id: 'running', label: 'Running', emoji: '🏃' },
      { id: 'gym', label: 'Gym', emoji: '🏋️' },
      { id: 'yoga', label: 'Yoga', emoji: '🧘' },
      { id: 'pilates', label: 'Pilates', emoji: '🤸' },
      { id: 'cycling', label: 'Cycling', emoji: '🚲' },
      { id: 'swimming', label: 'Swimming', emoji: '🏊' },
      { id: 'dance', label: 'Dancing', emoji: '💃' },
      { id: 'team-sport', label: 'Team sport', emoji: '⚽' },
      { id: 'aerobics', label: 'Aerobics', emoji: '🎽' },
    ],
  },

  {
    id: 'other',
    name: 'Life',
    select: 'multi',
    options: [
      { id: 'travel', label: 'Travel', emoji: '✈️' },
      { id: 'stress', label: 'Stress', emoji: '😖' },
      { id: 'alcohol', label: 'Alcohol', emoji: '🍷' },
      { id: 'illness', label: 'Illness or injury', emoji: '🤒' },
      { id: 'new-medication', label: 'New medication', emoji: '💊' },
      { id: 'doctor-visit', label: 'Doctor visit', emoji: '🩺' },
      { id: 'poor-diet', label: 'Ate badly', emoji: '🍟' },
      { id: 'big-day', label: 'Big day', emoji: '⭐' },
    ],
  },
];

/**
 * Test results. Kept out of CATEGORIES because they're single-select fields on
 * their own DayLog properties rather than chip arrays.
 */
export const TESTS = [
  {
    id: 'testPregnancy',
    name: 'Pregnancy test',
    options: [
      { id: 'positive', label: 'Positive', emoji: '➕' },
      { id: 'negative', label: 'Negative', emoji: '➖' },
    ],
  },
  {
    id: 'testOvulation',
    name: 'Ovulation test',
    hint: 'If your test reports peak, high and negative, log only "peak" as positive.',
    options: [
      { id: 'peak', label: 'Peak', emoji: '🔺' },
      { id: 'high', label: 'High', emoji: '🔸' },
      { id: 'negative', label: 'Negative', emoji: '➖' },
    ],
  },
];

/**
 * Numeric trackers. `step` and range are in the canonical stored unit; the
 * logging sheet converts at the display boundary.
 */
export const MEASURES = [
  {
    id: 'bbt',
    name: 'Basal body temperature',
    hint: 'Taken first thing, before getting up. Three consecutive readings ' +
      'above your recent average confirm that ovulation has happened.',
    unitSetting: 'unitTemp',
    min: 35, max: 39, step: 0.01, decimals: 2,
  },
  {
    id: 'weight',
    name: 'Weight',
    unitSetting: 'unitWeight',
    min: 30, max: 200, step: 0.1, decimals: 1,
  },
  {
    id: 'sleep',
    name: 'Sleep',
    unitSetting: null,
    min: 0, max: 16, step: 0.5, decimals: 1,
  },
  {
    id: 'steps',
    name: 'Steps',
    unitSetting: null,
    min: 0, max: 60000, step: 500, decimals: 0,
  },
];

/** Water is logged by tapping a glass rather than typing a number. */
export const WATER_GLASS_ML = 250;
export const WATER_GOAL_ML = 2000;

/* ── Lookup helpers ─────────────────────────────────────────────────────── */

/** @type {Map<string, {category: string, option: Option}>} */
const INDEX = new Map();
for (const category of CATEGORIES) {
  for (const option of category.options) {
    INDEX.set(`${category.id}:${option.id}`, { category: category.id, option });
  }
}

/**
 * Display label for an option id within a category.
 * @param {string} categoryId
 * @param {string} optionId
 * @returns {string}
 */
export function labelFor(categoryId, optionId) {
  const found = INDEX.get(`${categoryId}:${optionId}`);
  if (found) return found.option.label;
  // Custom symptoms are stored as their own text, so echo them back.
  return optionId;
}

/**
 * @param {string} categoryId
 * @returns {Category|undefined}
 */
export function category(categoryId) {
  return CATEGORIES.find((c) => c.id === categoryId);
}

/** Total selectable options, for the "how many symptoms" claim in the UI. */
export function optionCount() {
  return CATEGORIES.reduce((total, c) => total + c.options.length, 0)
    + TESTS.reduce((total, t) => total + t.options.length, 0);
}

/**
 * Extra words that should find an option.
 *
 * Two reasons these are needed. The labels use British spellings, so anyone
 * typing "diarrhea" or "hot flashes" would otherwise find nothing. And people
 * search for what they'd actually say — "sore boobs", "the runs", "spots" —
 * rather than the clinical label on the chip.
 *
 * @type {Record<string, string[]>}
 */
const SYNONYMS = {
  diarrhea: ['diarrhea', 'the runs', 'loose'],
  'hot-flashes': ['hot flashes', 'flashes', 'overheating'],
  'tender-breasts': ['sore boobs', 'sore breasts', 'breast pain', 'boobs', 'chest'],
  'breast-lumps': ['lump', 'boobs'],
  acne: ['spots', 'pimples', 'breakout', 'skin'],
  cramps: ['cramping', 'period pain', 'pain'],
  'abdominal-pain': ['stomach ache', 'tummy', 'belly'],
  nausea: ['sick', 'queasy'],
  fatigue: ['tired', 'exhausted', 'knackered'],
  'low-energy': ['tired', 'sluggish'],
  bloating: ['bloated', 'puffy'],
  cravings: ['hungry', 'craving', 'snack'],
  'increased-appetite': ['hungry'],
  'frequent-urination': ['peeing', 'weeing', 'toilet'],
  'uti-pain': ['uti', 'cystitis', 'stinging'],
  thrush: ['yeast', 'itchy'],
  insomnia: ['cant sleep', 'awake', 'sleepless'],
  'restless-sleep': ['bad sleep', 'tossing'],
  'brain-fog': ['foggy', 'forgetful', 'concentration'],
  'mood-swings': ['moody', 'emotional'],
  irritable: ['irritated', 'annoyed', 'snappy', 'grumpy'],
  anxious: ['anxiety', 'worried', 'nervous'],
  'egg-white': ['ewcm', 'stretchy', 'clear'],
  unprotected: ['no condom'],
  protected: ['condom'],
  spotting: ['light bleeding', 'brown'],
  heavy: ['flooding'],
  clots: ['clot'],
  gym: ['workout', 'weights', 'lifting'],
  running: ['run', 'jog', 'cardio'],
  walking: ['walk', 'steps'],
};

/**
 * Does an option match a search query?
 *
 * Matches on any word boundary rather than only the start of the label, so
 * "sweat" finds "Night sweats" and "back" finds "Backache". Accent- and
 * case-insensitive, and synonym-aware.
 *
 * @param {Option} option
 * @param {string} query already normalised by `normalizeQuery`
 */
export function optionMatches(option, query) {
  if (!query) return true;

  const haystacks = [option.label, ...(SYNONYMS[option.id] ?? [])];
  return haystacks.some((text) => {
    const normalized = normalizeQuery(text);
    if (normalized.startsWith(query)) return true;
    return normalized.split(/[\s-]+/).some((word) => word.startsWith(query));
  });
}

/**
 * Lowercase, strip accents and trim — so "Diarrhoea" is reachable by typing
 * "diarrhea", and stray spaces don't break a search.
 * @param {string} text
 */
export function normalizeQuery(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // combining diacritics, left behind by NFD
    .trim();
}

/**
 * Every symptom-ish id paired with a readable label, for the insights heatmap
 * and the doctor report. Excludes the "none" options, which record an absence
 * and would only add noise to a frequency chart.
 * @returns {{id: string, label: string, category: string}[]}
 */
export function trackableSymptoms() {
  /** @type {{id: string, label: string, category: string}[]} */
  const out = [];
  for (const c of CATEGORIES) {
    if (c.id === 'flow' || c.id === 'drive') continue;
    for (const option of c.options) {
      if (option.id === 'none') continue;
      out.push({ id: option.id, label: option.label, category: c.id });
    }
  }
  return out;
}
