// @ts-check
/**
 * icons.js — a mark for every option in the diary.
 *
 * ── Why this exists
 *
 * Every one of the 102 loggable options used to carry a system emoji: 🌀 for
 * cramps, 🎈 for bloating, 😴 for fatigue. On the screen this app is used on
 * most, that meant a wall of multi-colour glyphs drawn by the operating system
 * — a different set on every phone, none of them in the palette, all of them
 * louder than the pastel they sat on. Onboarding and the sticker book ship
 * original artwork; the diary was borrowing its pictures from Apple.
 *
 * ── The construction contract
 *
 * One contract, stated here, obeyed by every mark below. The app already has an
 * icon language — the tab bar and the header control — and this is that
 * language, extended rather than invented:
 *
 *   - 24×24 viewBox, always.
 *   - `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, round caps
 *     and joins. Nothing carries its own colour.
 *   - Strokes stay inside 3…21 so a mark never touches its own edge.
 *
 * `currentColor` is the load-bearing part. A mark inherits the colour of the
 * chip it sits in, so it is correct in all fourteen themes and both colour
 * modes without a single extra declaration — and it goes on being correct when
 * a chip is selected and its text colour flips. That is the whole reason not
 * to draw these with fills.
 *
 * Weight is uniform on purpose. Mascots are illustration and carry three line
 * weights; these are icons and carry one. Mixing the two vocabularies is what
 * makes an icon set look assembled from several places.
 *
 * ── What is deliberately not here
 *
 * No mark tries to be a picture of a sensation. "Backache", "joint pain" and
 * "muscle ache" are not three different drawings, and pretending otherwise
 * produces three identical human silhouettes that are slower to tell apart
 * than the words underneath them. Related symptoms share a base form and vary
 * one element. The label is what names the thing; the mark is what lets the
 * eye find it again in a list of thirty-nine.
 *
 * Exported as inner SVG markup rather than as elements, so the same string can
 * be used by `icon()` in the DOM and by the printable report.
 */

/* ── Shared forms ───────────────────────────────────────────────────────── */

/** The droplet, used by everything to do with fluid. */
const DROP = 'M12 3.6c-3.1 3.8-5.2 6.7-5.2 9.1a5.2 5.2 0 0 0 10.4 0c0-2.4-2.1-5.3-5.2-9.1Z';

/** A smaller droplet, for scales that count them. */
const DROP_SM = 'M12 9.5c-1.8 2.2-3 3.9-3 5.3a3 3 0 0 0 6 0c0-1.4-1.2-3.1-3-5.3Z';

/**
  The flow scale counts droplets rather than drawing a level inside one.

  The first version was a single droplet with one, two or three level lines in
  it. It looked like a scale at 24px and was three identical droplets at the 18
  these are actually rendered at — on the one control the whole app is built
  around. Count survives any size: one, two, three.

  @param {number} cx
*/
const drop = (cx) => `M${cx} 8.5c-1.6 2-2.6 3.4-2.6 4.5a2.6 2.6 0 0 0 5.2 0c0-1.1-1-2.5-2.6-4.5Z`;

/*
  Moods are an expression and no head.

  The first version drew each as a 9-radius circle with eyes and a mouth inside
  it. On the contact sheet at the 18px these actually render at, all nineteen
  were the same circle: the outline took the box and left the features two or
  three pixels each. Dropping the head gives the expression the whole 24, which
  roughly doubles every feature — and two dots above a curve reads as a face
  without needing to be told.

  It also stops moods colliding with the handful of symptoms that are genuinely
  about a face.
*/

/** Eyes as dots, the default pair, set wide. */
const EYES = 'M7.8 8.6h.01M16.2 8.6h.01';

/** Eyes closed, for the calm end. */
const EYES_SHUT = 'M6.2 8.4c1-1.2 2.4-1.2 3.4 0M14.4 8.4c1-1.2 2.4-1.2 3.4 0';

/** Brows angled in, for the cross end. */
const BROWS = 'M5.8 5.8 9.6 8M18.2 5.8 14.4 8';

/** A body, for the symptoms that are located somewhere on one. */
const TORSO = 'M12 3.2a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2ZM8.4 20.8v-4.4l-1.3-3.1V9.9a1.6 1.6 0 0 1 1.6-1.6h6.6a1.6 1.6 0 0 1 1.6 1.6v3.4l-1.3 3.1v4.4';

/** @param {string} d @returns {string} */
const p = (d) => `<path d="${d}"/>`;

/** A mood is just its expression. */
const mood = (/** @type {string} */ inner) => inner;

/* ── The marks ──────────────────────────────────────────────────────────── */

/**
 * Option id → inner SVG markup.
 *
 * Keyed by the same ids `taxonomy.js` stores, so a renamed option fails the
 * coverage test in taxonomy.test.js rather than silently losing its mark.
 *
 * @type {Record<string, string>}
 */
export const ICONS = {
  /* ── Flow. A scale, so it reads as one: a droplet gaining level lines. ── */
  none: p('M5.5 12h13'),
  spotting: p('M9.6 9.4h.01') + p('M14.2 13.6h.01') + p('M10.4 16.8h.01'),
  light: p(drop(12)),
  medium: p(drop(8.4)) + p(drop(15.6)),
  heavy: p(drop(6.2)) + p(drop(12)) + p(drop(17.8)),
  clots: p('M9.4 8.2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z')
    + p('M15.2 12a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Z'),

  /* ── Mood. An expression at full size; see the note above. ──────────── */
  calm: mood(p(EYES_SHUT) + p('M6.6 14.4c2.6 2.6 8.2 2.6 10.8 0')),
  happy: mood(p(EYES) + p('M5.8 13.4c3.2 4.2 9.2 4.2 12.4 0')),
  energetic: mood(p(EYES) + p('M5.8 13.4c3.2 4.2 9.2 4.2 12.4 0') + p('M12 3.2v2.6M3.6 12h2M18.4 12h2')),
  playful: mood(p('M7.8 8.6h.01') + p('M14.4 8.4c1-1.2 2.4-1.2 3.4 0') + p('M5.8 13.4c3.2 4.2 9.2 4.2 12.4 0')),
  confident: mood(p(EYES) + p('M6.4 13.8c3 3 7.6 2.2 10.4-1.4')),
  neutral: mood(p(EYES) + p('M6.6 15h10.8')),
  'mood-swings': mood(p(EYES) + p('M5.8 16.4c1.4-2.6 3-2.6 4.4 0') + p('M13.8 13.6c1.4 2.6 3 2.6 4.4 0')),
  irritable: mood(p(BROWS) + p('M8 10.6h.01M16 10.6h.01') + p('M6.6 16h10.8')),
  angry: mood(p(BROWS) + p('M8 10.6h.01M16 10.6h.01') + p('M6.4 17.6c3.2-3.4 8.8-3.4 11.2 0')),
  sad: mood(p(EYES) + p('M6 18c3-3.8 9-3.8 12 0')),
  anxious: mood(p(EYES) + p('M5.8 15.6c1.2-1.6 2.4-1.6 3.6 0s2.4 1.6 3.6 0 2.4-1.6 3.6 0')),
  panicky: mood(p('M7.8 8.6a1.2 1.2 0 1 0 0 .01M16.2 8.6a1.2 1.2 0 1 0 0 .01') + p('M12 12.4a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z')),
  low: mood(p('M5.8 8 9.6 10.4M18.2 8 14.4 10.4') + p('M6 18.8c3-4.2 9-4.2 12 0')),
  apathetic: mood(p('M5.8 8.8h3.6M14.6 8.8h3.6') + p('M6.6 15h10.8')),
  'low-energy': mood(p(EYES_SHUT) + p('M7.4 16.8c2.8-1.8 6.4-1.8 9.2 0')),
  confused: mood(p(EYES) + p('M6 16c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 3-2')),
  guilty: mood(p('M6.6 8.6h.01M13.4 8.6h.01') + p('M7.4 17c2.8-2.2 6.4-2.2 9.2 0')),
  obsessive: mood(p('M16.6 9.2a4.6 4.6 0 1 0-3.8 7.2 3.4 3.4 0 1 0-2.4-5.8')),
  // A frown with the weight pressing down on it, not an arrow pointing up —
  // which is what this drew first, and read as "more" of something good.
  'self-critical': mood(p(EYES) + p('M6.4 17.6c3.2-3 8.8-3 11.2 0') + p('M12 6.2V2.8M10.2 4.4 12 6.2l1.8-1.8')),

  /* ── Symptoms. Grouped by where they happen, not drawn one by one. ───── */
  cramps: p('M6.6 12a5.4 5.4 0 1 1 10.8 0 5.4 5.4 0 1 1-7.4 5') + p('M4.4 8.2 6.2 9.8M19.6 8.2 17.8 9.8M12 3.4v2'),
  'abdominal-pain': p('M6 13.6a6 6 0 1 1 12 0 6 6 0 0 1-12 0Z')
    + p('M9.6 13.8l1.6-2.4 1.4 4 1.8-3')
    + p('M12 4.2v3.4'),
  'ovulation-pain': p('M6 13.6a6 6 0 1 1 12 0 6 6 0 0 1-12 0Z')
    + p('M15 11.4l1.6-2.4 1.4 3.6')
    + p('M19.6 5.6 17 8.2M21 9.6h-2.6'),
  backache: p(TORSO) + p('M15.8 10.6c1.6 1 1.6 2.6 0 3.6'),
  headache: p('M12 5a6 6 0 0 0-6 6c0 2 .9 3 1.4 4 .4.9.4 1.7.4 2.6h8.4c0-.9 0-1.7.4-2.6.5-1 1.4-2 1.4-4a6 6 0 0 0-6-6Z')
    + p('M9.6 11.6 12 8.8l-.6 3.6 2.8-1.6'),
  migraine: p('M12 5a6 6 0 0 0-6 6c0 2 .9 3 1.4 4 .4.9.4 1.7.4 2.6h8.4c0-.9 0-1.7.4-2.6.5-1 1.4-2 1.4-4a6 6 0 0 0-6-6Z')
    + p('M9.6 11.6 12 8.8l-.6 3.6 2.8-1.6')
    + p('M2.6 8.4h2M2.6 12.4h2M19.4 8.4h2M19.4 12.4h2'),
  'tender-breasts': p('M8.2 10.8a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2ZM15.8 10.8a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z') + p('M8.2 14.4h.01M15.8 14.4h.01'),
  'breast-lumps': p('M8.2 10.8a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2ZM15.8 10.8a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z') + p('M15.8 13a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Z'),
  bloating: p('M12 7.4c-3.8 0-6.6 2-6.6 4.6s2.8 4.6 6.6 4.6 6.6-2 6.6-4.6-2.8-4.6-6.6-4.6Z')
    + p('M4.6 9.6 3.2 12l1.4 2.4M19.4 9.6 20.8 12l-1.4 2.4'),
  gas: p('M9.4 16.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z') + p('M15.6 9.4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z') + p('M17.6 15.2a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z'),
  nausea: p('M5.8 8.8h3.6M14.6 8.8h3.6') + p('M5.8 15.6c1.2-1.6 2.4-1.6 3.6 0s2.4 1.6 3.6 0 2.4-1.6 3.6 0'),
  vomiting: p('M5.8 8.8h3.6M14.6 8.8h3.6') + p('M9 14h6') + p('M10.2 16.4v3.4M13.8 16.4v2.6'),
  diarrhea: p('M7.4 4.6h9.2v10.2a4.6 4.6 0 0 1-9.2 0Z') + p('M9.8 17.8v2.4M12 18.4v2.4M14.2 17.8v2.4'),
  constipation: p('M7.4 4.6h9.2v10.2a4.6 4.6 0 0 1-9.2 0Z') + p('M9.4 10.6h5.2'),
  indigestion: p('M12 5.4c-4 0-7 2.8-7 6.4s3 6.6 7 6.6 7-3 7-6.6-3-6.4-7-6.4Z') + p('M8.6 12.8c1.2-1.4 2.3-1.4 3.4 0s2.2 1.4 3.4 0'),
  fatigue: p(EYES_SHUT) + p('M8.4 15.4h7.2') + p('M17.4 3.4h3.8l-3.8 4h3.8'),
  dizziness: p('M6 6.8 9.6 10.4M9.6 6.8 6 10.4M14.4 6.8 18 10.4M18 6.8l-3.6 3.6') + p('M5.8 15.6c1.2-1.6 2.4-1.6 3.6 0s2.4 1.6 3.6 0 2.4-1.6 3.6 0'),
  fainting: p('M5.8 8.8h3.6M14.6 8.8h3.6') + p('M6.6 15h10.8') + p('M12 18.4v2.6'),
  insomnia: p('M17.4 14.6A7.4 7.4 0 0 1 8.2 5.4a7.6 7.6 0 1 0 9.2 9.2Z') + p('M14.6 4.2h3.8l-3.8 4h3.8'),
  'restless-sleep': p('M17.4 14.6A7.4 7.4 0 0 1 8.2 5.4a7.6 7.6 0 1 0 9.2 9.2Z') + p('M3.4 18.6c1-1 2-1 3 0s2 1 3 0s2-1 3 0'),
  'night-sweats': p('M17.4 14.6A7.4 7.4 0 0 1 8.2 5.4a7.6 7.6 0 1 0 9.2 9.2Z') + p(DROP_SM),
  'hot-flashes': p('M12 3.4c2.6 3 4 5 4 6.8a4 4 0 0 1-8 0c0-1 .4-1.8 1-2.6.4 1.4 1.2 2 2 2 1.2 0 1.4-1.2 1-2.6-.4-1.4-.4-2.6 0-3.6Z') + p('M5.4 18.4c1-1 2-1 3 0s2 1 3 0 2-1 3 0 2 1 3 0'),
  'vaginal-dryness': p('M12 4.4c-3.2 3.8-5.4 6.8-5.4 9.2a5.4 5.4 0 0 0 10.8 0c0-2.4-2.2-5.4-5.4-9.2Z') + p('M5.2 5.2 18.8 18.8'),
  chills: p('M12 3.6v16.8M4.8 7.8l14.4 8.4M19.2 7.8 4.8 16.2') + p('M12 6.6 9.8 4.8M12 6.6l2.2-1.8'),
  fever: p('M14.6 13.4V6.2a2.2 2.2 0 1 0-4.4 0v7.2a4 4 0 1 0 4.4 0Z') + p('M12.4 9.6v6.2'),
  acne: p('M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Z') + p('M9 9.4h.01M15.2 10.6h.01M10.6 15h.01M14.6 15.4h.01'),
  'oily-skin': p('M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Z') + p('M9.4 9c1.4 1.2 1.4 2.6 0 3.6M14.4 12c1.4 1.2 1.4 2.6 0 3.6'),
  'dry-skin': p('M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Z') + p('M8.4 9.6h2.6M13.4 9.6h2.6M8.4 14.2h2.6M13.4 14.2h2.6'),
  itching: p('M9.6 20.6V14a1.6 1.6 0 0 1 3.2 0v-1.4a1.6 1.6 0 0 1 3.2 0V14a1.6 1.6 0 0 1 3.2 0v2.6a4 4 0 0 1-4 4Z') + p('M6.4 4.2 8 5.8M4.4 8.4h2.2M6.4 12.6 8 11'),
  'hair-loss': p('M6 14.4c0-4.6 2.6-8 6-8s6 3.4 6 8') + p('M6 14.4h12') + p('M9 18.2l-1.4 2.4M12 18.2l-1.4 2.4M15 18.2l-1.4 2.4'),
  'joint-pain': p('M8.4 4.4v5a3.6 3.6 0 0 0 7.2 0v-5') + p('M8.4 19.6v-5a3.6 3.6 0 0 1 7.2 0v5') + p('M4.6 12h2M17.4 12h2'),
  'brain-fog': p('M12 4.4a4.4 4.4 0 0 0-4.4 4.4c0 1 .3 1.8.8 2.4') + p('M12 4.4a4.4 4.4 0 0 1 4.4 4.4c0 1-.3 1.8-.8 2.4') + p('M5.4 15.4c1.2-1 2.4-1 3.6 0s2.4 1 3.6 0 2.4-1 3.6 0 2.4 1 3.6 0') + p('M6.4 19.2c1.2-1 2.4-1 3.6 0s2.4 1 3.6 0'),
  swelling: p('M12 6.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6Z') + p('M12 3.2v1.4M12 19.4v1.4M3.2 12h1.4M19.4 12h1.4'),
  cravings: p('M12 20.2c-3.6-2.6-6.6-5.2-6.6-8.6a3.8 3.8 0 0 1 6.6-2.6 3.8 3.8 0 0 1 6.6 2.6c0 3.4-3 6-6.6 8.6Z') + p('M12 3.4v2.4'),
  'increased-appetite': p('M7 4.2v7.4a2.2 2.2 0 0 0 4.4 0V4.2') + p('M9.2 11.6v8.2') + p('M16.4 4.2c-1.4 1.2-1.8 3-1.8 5.4 0 1.4.6 2.2 1.8 2.2s1.8-.8 1.8-2.2c0-2.4-.4-4.2-1.8-5.4Z') + p('M16.4 11.8v8'),
  'low-appetite': p('M7 4.2v7.4a2.2 2.2 0 0 0 4.4 0V4.2') + p('M9.2 11.6v8.2') + p('M14.6 14.6h5.4'),
  'frequent-urination': p(DROP) + p('M12 3.6v-1.2') + p('M4.6 19.6h14.8'),
  'uti-pain': p(DROP) + p('M8.2 6.8 15.8 17M15.8 6.8 8.2 17'),
  thrush: p('M12 4.4c-3.2 3.8-5.4 6.8-5.4 9.2a5.4 5.4 0 0 0 10.8 0c0-2.4-2.2-5.4-5.4-9.2Z') + p('M9.6 13h.01M12.6 15h.01M14 11.6h.01'),

  /* ── Discharge. One form, varying texture. ───────────────────────────── */
  sticky: p(DROP) + p('M9.8 13.6c1.4-1 2.8-1 4.2 0'),
  creamy: p(DROP) + p('M9.2 12.8c1-.8 2-.8 3 0s2 .8 3 0'),
  watery: p(DROP) + p('M9.2 12.4c1-.8 2-.8 3 0s2 .8 3 0') + p('M9.2 15.4c1-.8 2-.8 3 0s2 .8 3 0'),
  'egg-white': p(DROP) + p('M9.6 15.6c0-2.4 1-4 2.4-4s2.4 1.6 2.4 4'),
  'clumpy-white': p(DROP) + p('M10.2 13.2h.01M13.4 12.4h.01M11.8 15.6h.01M14 15.2h.01'),
  brown: p(DROP) + p('M9.4 14.4h5.2'),
  grey: p(DROP) + p('M9.4 13.2h5.2M9.4 15.8h5.2'),
  'unusual-smell': p(DROP) + p('M16.4 5.6c1.2 1 1.2 2.2 0 3.2s-1.2 2.2 0 3.2') + p('M19.4 5.6c1.2 1 1.2 2.2 0 3.2s-1.2 2.2 0 3.2'),
  atypical: p(DROP) + p('M12 18.6v1.8') + p('M18 5.4a2.6 2.6 0 1 0-2.6 2.6'),

  /* ── Sex. A heart, and what distinguishes each. ──────────────────────── */
  protected: p('M12 20.4c-3.4-2.4-6.2-4.8-6.2-8a3.6 3.6 0 0 1 6.2-2.4 3.6 3.6 0 0 1 6.2 2.4c0 3.2-2.8 5.6-6.2 8Z') + p('M8.4 6.6a3.6 3.6 0 0 1 7.2 0'),
  unprotected: p('M12 20.4c-3.4-2.4-6.2-4.8-6.2-8a3.6 3.6 0 0 1 6.2-2.4 3.6 3.6 0 0 1 6.2 2.4c0 3.2-2.8 5.6-6.2 8Z') + p('M8.4 7.4 15.6 3.8'),
  oral: p('M4.4 12c2.4-3.2 4.8-4.8 7.6-4.8s5.2 1.6 7.6 4.8c-2.4 3.2-4.8 4.8-7.6 4.8S6.8 15.2 4.4 12Z') + p('M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z'),
  anal: p('M12 20.4c-3.4-2.4-6.2-4.8-6.2-8a3.6 3.6 0 0 1 6.2-2.4 3.6 3.6 0 0 1 6.2 2.4c0 3.2-2.8 5.6-6.2 8Z') + p('M12 3.6v3.2'),
  masturbation: p('M9.2 20.4V13a1.8 1.8 0 0 1 3.6 0v-1.6a1.8 1.8 0 0 1 3.6 0V13a1.8 1.8 0 0 1 3.6 0v3a4.4 4.4 0 0 1-4.4 4.4Z') + p('M6 6.2c1 .8 1 1.8 0 2.6'),
  toys: p('M14.6 3.8a3 3 0 0 0-5.2 0c-.8 1.4-.6 3 .4 4.2v10.2a2.2 2.2 0 1 0 4.4 0V8c1-1.2 1.2-2.8.4-4.2Z'),
  orgasm: p('M12 10.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z') + p('M12 3.4v3.6M12 17v3.6M4.6 13h3.6M15.8 13h3.6M6.4 7.4l2.6 2.6M15 16l2.6 2.6M17.6 7.4 15 10M9 16l-2.6 2.6'),
  painful: p('M12 20.4c-3.4-2.4-6.2-4.8-6.2-8a3.6 3.6 0 0 1 6.2-2.4 3.6 3.6 0 0 1 6.2 2.4c0 3.2-2.8 5.6-6.2 8Z') + p('M9 5.4 12 8l3-2.6'),

  /* ── Sex drive. A flame at three heights. ────────────────────────────── */
  high: p('M12 3.4c2.6 3 4 5 4 6.8a4 4 0 0 1-8 0c0-1 .4-1.8 1-2.6.4 1.4 1.2 2 2 2 1.2 0 1.4-1.2 1-2.6-.4-1.4-.4-2.6 0-3.6Z') + p('M6.4 17.6h11.2'),

  /* ── Activity. The thing you did. ────────────────────────────────────── */
  walking: p('M13.4 3.6a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z') + p('M10 20.4l2.2-5 2.6 2.4v3.4') + p('M12.2 15.4 11 10.6l3.2-1.8 2 3 2.6 1'),
  running: p('M14.6 3.6a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z') + p('M8.4 20.4l3-4.4 2.8 2v3') + p('M11.4 16 10 11l3.6-2.2 2.2 3.2 3 .8') + p('M4.6 10.6h3M4 14.4h2.6'),
  gym: p('M4.4 9.4v5.2M7.4 7.4v9.2M16.6 7.4v9.2M19.6 9.4v5.2') + p('M7.4 12h9.2'),
  yoga: p('M12 3.6a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z') + p('M12 8.4v5.6') + p('M5.4 19.6c1.6-2.6 4-4 6.6-4s5 1.4 6.6 4') + p('M6.6 11.4 12 13.4l5.4-2'),
  pilates: p('M12 3.6a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z') + p('M4.6 17.6h14.8') + p('M7.4 17.6c1.4-3.4 2.8-5.2 4.6-5.2s3.2 1.8 4.6 5.2') + p('M12 8.4v4'),
  cycling: p('M6 18.4a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM18 18.4a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z') + p('M6 15.2 10 9.4h4.6l3.4 5.8') + p('M14.8 5.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z'),
  swimming: p('M15.4 6.4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z') + p('M4.6 12.6 10.6 10l3.4 2.6') + p('M3.4 17.4c1.4-1.2 2.8-1.2 4.2 0s2.8 1.2 4.2 0 2.8-1.2 4.2 0 2.8 1.2 4.2 0') + p('M3.4 20.4c1.4-1.2 2.8-1.2 4.2 0s2.8 1.2 4.2 0 2.8-1.2 4.2 0 2.8 1.2 4.2 0'),
  dance: p('M13.6 3.6a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z') + p('M13.6 8.4 11 12.6l3 2.4-1.4 5.4') + p('M11 12.6 6.6 14') + p('M14 15 18 17.4'),
  'team-sport': p('M12 4.4a7.6 7.6 0 1 0 0 15.2 7.6 7.6 0 0 0 0-15.2Z') + p('M12 4.4c2.4 2.2 3.6 4.8 3.6 7.6s-1.2 5.4-3.6 7.6') + p('M12 4.4c-2.4 2.2-3.6 4.8-3.6 7.6s1.2 5.4 3.6 7.6'),
  aerobics: p('M12 3.6a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z') + p('M12 8.4v5.2') + p('M6.6 8.6 12 10.6l5.4-2') + p('M12 13.6 8.4 20.4M12 13.6l3.6 6.8'),

  /* ── Life. Events rather than sensations. ────────────────────────────── */
  travel: p('M12 3.4 14 10l6.6 2-6.6 2-2 6.6-2-6.6L3.4 12 10 10Z'),
  stress: p('M5.4 19.4 9 12.6l-2.6-.8L12 3.6l-1.4 6.4 3 .8-4.6 8.6Z') + p('M15.4 15.6h4.2M16.4 19.4h3.2'),
  alcohol: p('M8 3.6h8l-3.2 6.8v6.4') + p('M8.6 20.4h6.8') + p('M12.8 17.2v3.2'),
  illness: p('M12 3.6a3.2 3.2 0 0 0-3.2 3.2v1.6H7.2a3.2 3.2 0 0 0 0 6.4h1.6v1.6a3.2 3.2 0 0 0 6.4 0v-1.6h1.6a3.2 3.2 0 0 0 0-6.4h-1.6V6.8A3.2 3.2 0 0 0 12 3.6Z'),
  'new-medication': p('M9.4 4.6a4.4 4.4 0 0 1 6.2 6.2l-4.8 4.8a4.4 4.4 0 0 1-6.2-6.2Z') + p('M7.2 6.8l6.2 6.2') + p('M17.6 15.4v4.6M15.4 17.6h4.4'),
  hrt: p('M12 6.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z') + p('M12 13.4v6.4M9.4 17h5.2') + p('M12 6.6V3.4M14.4 4.6 12 3.4 9.6 4.6'),
  'doctor-visit': p('M6.4 8.4h11.2a1.6 1.6 0 0 1 1.6 1.6v8.4a1.6 1.6 0 0 1-1.6 1.6H6.4a1.6 1.6 0 0 1-1.6-1.6V10a1.6 1.6 0 0 1 1.6-1.6Z') + p('M9.4 8.4V6a1.6 1.6 0 0 1 1.6-1.6h2a1.6 1.6 0 0 1 1.6 1.6v2.4') + p('M12 11.6v4.8M9.6 14h4.8'),
  'poor-diet': p('M6.4 4.4v6a2.4 2.4 0 0 0 4.8 0v-6') + p('M8.8 10.6v9.2') + p('M16.6 4.4c-1.4 1.2-2 3-2 5.4 0 1.4.8 2.2 2 2.2s2-.8 2-2.2c0-2.4-.6-4.2-2-5.4Z') + p('M16.6 12v7.8') + p('M3.6 3.6l16.8 16.8'),
  'big-day': p('M6.4 6h11.2a1.6 1.6 0 0 1 1.6 1.6v10.8a1.6 1.6 0 0 1-1.6 1.6H6.4a1.6 1.6 0 0 1-1.6-1.6V7.6A1.6 1.6 0 0 1 6.4 6Z') + p('M4.8 10.4h14.4M8.6 3.6v4M15.4 3.6v4') + p('M12 13 12.9 14.9 15 15.2l-1.5 1.4.4 2-1.9-1-1.9 1 .4-2L9 15.2l2.1-.3Z'),

  /* ── Tests. A stick, and what it read. ───────────────────────────────── */
  positive: p('M8.6 3.6h6.8v16.8H8.6Z') + p('M8.6 8.6h6.8') + p('M12 11.4v6M9 14.4h6'),
  negative: p('M8.6 3.6h6.8v16.8H8.6Z') + p('M8.6 8.6h6.8') + p('M9 14.4h6'),
  peak: p('M8.6 3.6h6.8v16.8H8.6Z') + p('M8.6 8.6h6.8') + p('M9.4 12.4h5.2M9.4 15.4h5.2') + p('M12 17.8v.01'),
};

/**
 * Option ids that share a mark with another category.
 *
 * `none`, `negative`, `high`, `low` and `neutral` each appear in more than one
 * category, and they do not always mean the same thing — "None" in discharge is
 * an absence, "No sex" is a choice, and "Low" in sex drive is a level. Rather
 * than let one key silently serve two meanings, the ones that need their own
 * mark are listed here as `category:id` and win over the plain id.
 *
 * @type {Record<string, string>}
 */
export const ICONS_BY_CATEGORY = {
  'discharge:none': p('M5.5 12h13'),
  'sex:none': p('M5.5 12h13'),
  'activity:none': p('M5.5 12h13'),
  'drive:low': p('M12 3.4c2.6 3 4 5 4 6.8a4 4 0 0 1-8 0c0-1 .4-1.8 1-2.6.4 1.4 1.2 2 2 2 1.2 0 1.4-1.2 1-2.6-.4-1.4-.4-2.6 0-3.6Z'),
  'drive:neutral': p('M12 3.4c2.6 3 4 5 4 6.8a4 4 0 0 1-8 0c0-1 .4-1.8 1-2.6.4 1.4 1.2 2 2 2 1.2 0 1.4-1.2 1-2.6-.4-1.4-.4-2.6 0-3.6Z') + p('M8.4 17.6h7.2'),
  'testOvulation:high': p('M8.6 3.6h6.8v16.8H8.6Z') + p('M8.6 8.6h6.8') + p('M9.4 12.4h5.2M9.4 15.4h5.2'),
  'testOvulation:negative': p('M8.6 3.6h6.8v16.8H8.6Z') + p('M8.6 8.6h6.8') + p('M9.4 12.4h5.2'),
};

/**
 * The mark for an option, or null when it has none.
 *
 * @param {string} id
 * @param {string} [category] the category the option was found in
 * @returns {string|null} inner SVG markup
 */
export function iconFor(id, category) {
  if (category && ICONS_BY_CATEGORY[`${category}:${id}`]) {
    return ICONS_BY_CATEGORY[`${category}:${id}`];
  }
  return ICONS[id] ?? null;
}
