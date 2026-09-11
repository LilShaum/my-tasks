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
 *   - No option carries its own picture. The mark beside a label lives in
 *     `icons.js`, keyed by the same id stored here, so the taxonomy stays a
 *     list of what can be recorded and nothing else. The label is what's
 *     stored, announced and exported.
 */

/**
 * @typedef {Object} Option
 * @property {string} id       stable; this is what gets stored
 * @property {string} label
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
      { id: 'none', label: 'No bleeding' },
      { id: 'spotting', label: 'Spotting' },
      { id: 'light', label: 'Light' },
      { id: 'medium', label: 'Medium' },
      { id: 'heavy', label: 'Heavy' },
      { id: 'clots', label: 'Blood clots' },
    ],
  },

  {
    id: 'moods',
    name: 'Mood',
    select: 'multi',
    options: [
      { id: 'calm', label: 'Calm' },
      { id: 'happy', label: 'Happy' },
      { id: 'energetic', label: 'Energetic' },
      { id: 'playful', label: 'Playful' },
      { id: 'confident', label: 'Confident' },
      { id: 'neutral', label: 'Neutral' },
      { id: 'mood-swings', label: 'Mood swings' },
      { id: 'irritable', label: 'Irritable' },
      { id: 'angry', label: 'Angry' },
      { id: 'sad', label: 'Sad' },
      { id: 'anxious', label: 'Anxious' },
      { id: 'panicky', label: 'Panicky' },
      { id: 'low', label: 'Very low' },
      { id: 'apathetic', label: 'Apathetic' },
      { id: 'low-energy', label: 'Low energy' },
      { id: 'confused', label: 'Confused' },
      { id: 'guilty', label: 'Feeling guilty' },
      { id: 'obsessive', label: 'Obsessive thoughts' },
      { id: 'self-critical', label: 'Very self-critical' },
    ],
  },

  {
    id: 'symptoms',
    name: 'Symptoms',
    select: 'multi',
    options: [
      { id: 'cramps', label: 'Cramps' },
      { id: 'abdominal-pain', label: 'Abdominal pain' },
      { id: 'ovulation-pain', label: 'Ovulation pain' },
      { id: 'backache', label: 'Backache' },
      { id: 'headache', label: 'Headache' },
      { id: 'migraine', label: 'Migraine' },
      { id: 'tender-breasts', label: 'Tender breasts' },
      { id: 'breast-lumps', label: 'Breast lumps' },
      { id: 'bloating', label: 'Bloating' },
      { id: 'gas', label: 'Gas' },
      { id: 'nausea', label: 'Nausea' },
      { id: 'vomiting', label: 'Vomiting' },
      { id: 'diarrhea', label: 'Diarrhoea' },
      { id: 'constipation', label: 'Constipation' },
      { id: 'indigestion', label: 'Indigestion' },
      { id: 'fatigue', label: 'Fatigue' },
      { id: 'dizziness', label: 'Dizziness' },
      { id: 'fainting', label: 'Fainting' },
      { id: 'insomnia', label: 'Insomnia' },
      { id: 'restless-sleep', label: 'Restless sleep' },
      { id: 'night-sweats', label: 'Night sweats' },
      { id: 'hot-flashes', label: 'Hot flushes' },
      { id: 'vaginal-dryness', label: 'Vaginal dryness' },
      { id: 'chills', label: 'Chills' },
      { id: 'fever', label: 'Fever' },
      { id: 'acne', label: 'Acne' },
      { id: 'oily-skin', label: 'Oily skin' },
      { id: 'dry-skin', label: 'Dry skin' },
      { id: 'itching', label: 'Itching' },
      { id: 'hair-loss', label: 'Hair loss' },
      { id: 'joint-pain', label: 'Joint pain' },
      { id: 'brain-fog', label: 'Brain fog' },
      { id: 'swelling', label: 'Swelling' },
      { id: 'cravings', label: 'Food cravings' },
      { id: 'increased-appetite', label: 'Increased appetite' },
      { id: 'low-appetite', label: 'Low appetite' },
      { id: 'frequent-urination', label: 'Frequent urination' },
      { id: 'uti-pain', label: 'Burning when peeing' },
      { id: 'thrush', label: 'Thrush' },
    ],
  },

  {
    id: 'discharge',
    name: 'Vaginal discharge',
    select: 'multi',
    options: [
      { id: 'none', label: 'None' },
      { id: 'sticky', label: 'Sticky' },
      { id: 'creamy', label: 'Creamy' },
      { id: 'watery', label: 'Watery' },
      { id: 'egg-white', label: 'Egg white' },
      { id: 'clumpy-white', label: 'Clumpy white' },
      { id: 'brown', label: 'Brown' },
      { id: 'grey', label: 'Grey' },
      { id: 'unusual-smell', label: 'Unusual smell' },
      { id: 'atypical', label: 'Unusual for me' },
    ],
  },

  {
    id: 'sex',
    name: 'Sex',
    select: 'multi',
    options: [
      { id: 'none', label: 'No sex' },
      { id: 'protected', label: 'Protected sex' },
      { id: 'unprotected', label: 'Unprotected sex' },
      { id: 'oral', label: 'Oral sex' },
      { id: 'anal', label: 'Anal sex' },
      { id: 'masturbation', label: 'Masturbation' },
      { id: 'toys', label: 'Sex toys' },
      { id: 'orgasm', label: 'Orgasm' },
      { id: 'painful', label: 'Painful sex' },
    ],
  },

  {
    id: 'drive',
    name: 'Sex drive',
    select: 'single',
    options: [
      { id: 'low', label: 'Low' },
      { id: 'neutral', label: 'Neutral' },
      { id: 'high', label: 'High' },
    ],
  },

  {
    id: 'activity',
    name: 'Activity',
    select: 'multi',
    options: [
      { id: 'none', label: 'Didn’t exercise' },
      { id: 'walking', label: 'Walking' },
      { id: 'running', label: 'Running' },
      { id: 'gym', label: 'Gym' },
      { id: 'yoga', label: 'Yoga' },
      { id: 'pilates', label: 'Pilates' },
      { id: 'cycling', label: 'Cycling' },
      { id: 'swimming', label: 'Swimming' },
      { id: 'dance', label: 'Dancing' },
      { id: 'team-sport', label: 'Team sport' },
      { id: 'aerobics', label: 'Aerobics' },
    ],
  },

  {
    id: 'other',
    name: 'Life',
    select: 'multi',
    options: [
      { id: 'travel', label: 'Travel' },
      { id: 'stress', label: 'Stress' },
      { id: 'alcohol', label: 'Alcohol' },
      { id: 'illness', label: 'Illness or injury' },
      { id: 'new-medication', label: 'New medication' },
      // Sits with the other things that change a cycle from outside it, beside
      // medication and illness, rather than being filed as a symptom.
      { id: 'hrt', label: 'HRT' },
      { id: 'doctor-visit', label: 'Doctor visit' },
      { id: 'poor-diet', label: 'Ate badly' },
      { id: 'big-day', label: 'Big day' },
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
      { id: 'positive', label: 'Positive' },
      { id: 'negative', label: 'Negative' },
    ],
  },
  {
    id: 'testOvulation',
    name: 'Ovulation test',
    hint: 'If your test reports peak, high and negative, log only "peak" as positive.',
    options: [
      { id: 'peak', label: 'Peak' },
      { id: 'high', label: 'High' },
      { id: 'negative', label: 'Negative' },
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

/**
 * What the quick rows show before she has any history of her own.
 *
 * `recentChips` only fills up when something is applied from the full diary
 * sheet — so someone who marks her period and nothing else, which this app
 * explicitly says is a perfectly good way to use it, had an empty list
 * forever. The shortcut rows checked that list, found nothing, and fell back
 * to the plain "Log today" button. The streamlining was invisible to exactly
 * the person it was built for.
 *
 * These four are the ones a period tracker gets asked about most. They are a
 * starting point, not a suggestion of what she should be feeling, and the
 * moment she logs anything her own choices take over.
 */
export const DEFAULT_CHIPS = ['cramps', 'fatigue', 'headache', 'bloating'];

/**
 * How bad a symptom was, when she says.
 *
 * Three levels, not five and not a slider. The most common request under
 * every period tracker's reviews is some way to say that this month's cramps
 * were not like last month's — but the moment the scale gets finer than three
 * the answer stops being obvious, and a question you have to think about is
 * one that gets skipped. Three is also what a clinician actually uses.
 *
 * Stored as 1..3 rather than as words so the doctor report can rank them and
 * the wording can change without a migration.
 */
export const SEVERITY = /** @type {const} */ ([
  { value: 1, label: 'Mild' },
  { value: 2, label: 'Moderate' },
  { value: 3, label: 'Severe' },
]);

/**
 * The word for a stored severity, or null for anything else.
 * @param {unknown} value
 * @returns {string|null}
 */
export function severityLabel(value) {
  return SEVERITY.find((s) => s.value === value)?.label ?? null;
}

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
 * Categories whose ids are *scale points* rather than occurrences.
 *
 * Flow and drive answer "how much", so their ids are things like `low` and
 * `neutral` — words that also exist as moods. They are always read with their
 * category known (`labelFor('flow', …)`), never from a flat list, so they are
 * kept out of the id-only index below. Without this, `low` would resolve to
 * drive's "Low" and quietly mislabel the mood "Very low".
 */
const SCALE_CATEGORIES = new Set(['flow', 'drive']);

/**
 * Every occurrence id to its label, for lookups that don't know the category.
 *
 * `none` is excluded because several categories define their own ("No
 * bleeding", "No sex", "Didn't exercise") and callers of `labelOf` have
 * already dropped it — `loggedIds` filters it out, since an absence is not
 * something that happened.
 *
 * `test/taxonomy.test.js` asserts what is left is collision-free, so this
 * index cannot silently start lying if a future option reuses an id.
 *
 * @type {Map<string, string>}
 */
const BY_ID = new Map(
  CATEGORIES
    .filter((c) => !SCALE_CATEGORIES.has(c.id))
    .flatMap((c) => c.options
      .filter((o) => o.id !== 'none')
      .map((o) => /** @type {[string, string]} */ ([o.id, o.label]))),
);

/**
 * Which category an option id belongs to, for the places that have to treat
 * kinds of observation differently.
 *
 * The doctor report is the reason this exists: it was listing moods under
 * "Recurring symptoms", so a clinician read "Happy — 3 of 3 cycles" as a
 * presenting complaint. Both are worth reporting; they are not the same thing.
 *
 * @type {Map<string, string>}
 */
const CATEGORY_BY_ID = new Map(
  CATEGORIES
    .filter((c) => !SCALE_CATEGORIES.has(c.id))
    .flatMap((c) => c.options
      .filter((o) => o.id !== 'none')
      .map((o) => /** @type {[string, string]} */ ([o.id, c.id]))),
);


/** Moods are reported separately from physical symptoms. @param {string} id */
export const isMood = (id) => CATEGORY_BY_ID.get(id) === 'moods';

/**
 * Display label for an option id, without knowing which category it came from.
 *
 * Anything derived from a `DayLog` — patterns, recaps, the doctor report —
 * works with flat lists of ids, having lost the category on the way in.
 * Guessing a category and calling `labelFor` is wrong twice over there: it
 * mislabels ids that live in a different category, and echoes the raw id back
 * for the ones it misses.
 *
 * Custom symptoms are stored as their own text and echo back, as in
 * `labelFor`.
 *
 * @param {string} optionId
 * @returns {string}
 */
export function labelOf(optionId) {
  return BY_ID.get(optionId) ?? optionId;
}

/** The id-only label index, exposed so a test can assert it is unambiguous. */
export function labelIndexEntries() {
  return CATEGORIES
    .filter((c) => !SCALE_CATEGORIES.has(c.id))
    .flatMap((c) => c.options
      .filter((o) => o.id !== 'none')
      .map((o) => ({ category: c.id, id: o.id, label: o.label })));
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
  'vaginal-dryness': ['dryness', 'dry'],
  hrt: ['hormone replacement', 'oestrogen', 'estrogen', 'patch'],
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

