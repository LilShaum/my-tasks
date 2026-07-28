// @ts-check
/**
 * tips.js — the daily insight library.
 *
 * Flo's home screen carries a row of personalised cards written by its medical
 * team. Those are copyrighted, so this is an original set — smaller, but keyed
 * to the same two things: where she is in her cycle, and what she actually
 * logged.
 *
 * Rules these follow, and the reason for each:
 *
 *   - **Nothing diagnostic.** These explain what's typical and common. They
 *     never tell her what's wrong with her, and anything that sounds like it
 *     might be gets routed to "worth asking a doctor" instead.
 *   - **No advice she didn't ask for about her body.** No weight talk, no
 *     "you should exercise", no diet suggestions. A cycle tracker that
 *     editorialises about your habits is one you stop opening.
 *   - **Never sympathetic about a symptom in a way that implies alarm.**
 *     "Cramps are common on day 1" is useful. "Poor you" is not, and "cramps
 *     can indicate…" is frightening and out of scope.
 *   - **Facts, warmly.** The tone is a knowledgeable friend, not a brochure
 *     and not a pastel greeting card.
 *
 * Each tip declares when it applies. `pick` scores the candidates and returns
 * the most specific few, so the same three cards don't show every day.
 *
 * @typedef {import('../domain/phases.js').PhaseId} PhaseId
 */

/**
 * @typedef {Object} Tip
 * @property {string} id
 * @property {string} title
 * @property {string} body
 * @property {PhaseId[]} [phases]      only in these phases
 * @property {string[]} [whenLogged]   only if one of these ids was logged today
 * @property {number[]} [cycleDays]    only on these days of the cycle
 * @property {boolean} [needsFertility] skip when fertility output is hidden
 */

/** @type {Tip[]} */
export const TIPS = [
  /* ── Menstrual ─────────────────────────────────────────────────────── */
  {
    id: 'period-day-one',
    title: 'Day one is the first day of real bleeding',
    body: 'Not spotting the evening before — that is why Kittycal keeps the two ' +
      'separate. Getting day one right is most of what makes the next ' +
      'prediction accurate.',
    phases: ['menstrual'],
    cycleDays: [1, 2],
  },
  {
    id: 'period-cramps',
    title: 'Cramps are doing something',
    body: 'They are the uterus contracting to shed its lining, which is why they ' +
      'cluster in the first day or two and then ease off. Heat helps because it ' +
      'relaxes the muscle.',
    phases: ['menstrual'],
    whenLogged: ['cramps', 'abdominal-pain'],
  },
  {
    id: 'period-tired',
    title: 'Lower energy here is expected',
    body: 'Oestrogen is at its lowest point of the whole cycle during your period. ' +
      'If you feel like doing less right now, that is the reason.',
    phases: ['menstrual'],
    whenLogged: ['fatigue', 'low-energy', 'sad', 'low'],
  },
  {
    id: 'period-length',
    title: 'Most periods run three to seven days',
    body: 'Yours can sit anywhere in that range and still be completely ordinary. ' +
      'What matters more is whether it is roughly the same each time.',
    phases: ['menstrual'],
  },

  /* ── Follicular ────────────────────────────────────────────────────── */
  {
    id: 'follicular-variable',
    title: 'This is the part that varies',
    body: 'When a cycle runs long or short, it is almost always this phase ' +
      'stretching or shrinking — the second half stays roughly fixed. A late ' +
      'period usually means ovulation came late, not that anything went wrong.',
    phases: ['follicular'],
  },
  {
    id: 'follicular-skin',
    title: 'Skin often settles in this phase',
    body: 'Rising oestrogen tends to mean less oil. If you get breakouts, they ' +
      'more often turn up later in the cycle than here.',
    phases: ['follicular'],
    whenLogged: ['acne', 'oily-skin'],
  },

  /* ── Ovulatory ─────────────────────────────────────────────────────── */
  {
    id: 'ovulatory-discharge',
    title: 'Discharge is the sign you can read without a test',
    body: 'Around ovulation it thins to something like raw egg white, then turns ' +
      'thicker and cloudier afterwards. Logging it builds a record that does ' +
      'not depend on remembering.',
    phases: ['ovulatory'],
    whenLogged: ['egg-white', 'watery', 'creamy', 'sticky'],
    needsFertility: true,
  },
  {
    id: 'ovulatory-twinge',
    title: 'A one-sided twinge around now has a name',
    body: 'Mittelschmerz — literally "middle pain". Some people feel ovulation as ' +
      'a brief ache on one side, and it can swap sides month to month.',
    phases: ['ovulatory'],
    whenLogged: ['ovulation-pain', 'abdominal-pain'],
    needsFertility: true,
  },
  {
    id: 'ovulatory-window',
    title: 'The fertile window is mostly before, not after',
    body: 'Sperm can survive around five days; an egg lasts about one. That ' +
      'asymmetry is why the window opens well before ovulation and closes ' +
      'almost immediately after it.',
    phases: ['ovulatory'],
    needsFertility: true,
  },

  /* ── Luteal ────────────────────────────────────────────────────────── */
  {
    id: 'luteal-fixed',
    title: 'This phase barely moves',
    body: 'The stretch between ovulation and your period is about 14 days for ' +
      'most people, and it stays put even when cycles vary. That is why ' +
      'Kittycal counts backwards from your next period to estimate ovulation ' +
      'rather than halving the cycle.',
    phases: ['luteal'],
  },
  {
    id: 'luteal-bloating',
    title: 'Bloating late in the cycle is common',
    body: 'Progesterone slows the gut down and the body holds on to a bit more ' +
      'water. It usually resolves once your period starts.',
    phases: ['luteal'],
    whenLogged: ['bloating', 'swelling', 'constipation'],
  },
  {
    id: 'luteal-cravings',
    title: 'Appetite genuinely changes here',
    body: 'Resting metabolism rises slightly in the luteal phase, so feeling ' +
      'hungrier is not imagined and not a lapse of willpower.',
    phases: ['luteal'],
    whenLogged: ['cravings', 'increased-appetite'],
  },
  {
    id: 'luteal-sleep',
    title: 'Sleep can get patchier before a period',
    body: 'Body temperature runs a few tenths of a degree warmer after ovulation, ' +
      'and that alone is enough to make sleep lighter for some people.',
    phases: ['luteal'],
    whenLogged: ['insomnia', 'restless-sleep', 'night-sweats'],
  },
  {
    id: 'luteal-mood',
    title: 'Mood shifts here are hormonal, not a character flaw',
    body: 'The progesterone drop late in the luteal phase affects serotonin. If ' +
      'you notice this happening at the same point every month, that pattern ' +
      'shows up in your Insights.',
    phases: ['luteal'],
    whenLogged: ['mood-swings', 'irritable', 'sad', 'anxious', 'low'],
  },

  /* ── Any phase ─────────────────────────────────────────────────────── */
  {
    id: 'any-bbt',
    title: 'Temperature confirms ovulation after the fact',
    body: 'A sustained rise of about 0.2°C over three days means it has already ' +
      'happened. It is a good record, but it cannot tell you in advance.',
    whenLogged: ['bbt'],
    needsFertility: true,
  },
  {
    id: 'any-headache',
    title: 'Hormonal headaches cluster at two points',
    body: 'Most often just before a period and around ovulation, when oestrogen ' +
      'moves fastest. Logging them builds a picture of which one is yours.',
    whenLogged: ['headache', 'migraine'],
  },
  {
    id: 'any-log-more',
    title: 'Patterns need about three cycles',
    body: 'That is the point where Kittycal can tell a real pattern from a ' +
      'coincidence. Even a couple of taps a day is enough to get there.',
  },
  {
    id: 'any-irregular',
    title: 'Cycles move around, and that is normal',
    body: 'Stress, travel, illness, a change in sleep — all of them can shift a ' +
      'cycle by days. A single unusual month on its own means very little.',
  },
  {
    id: 'any-range',
    title: 'There is no such thing as a 28-day rule',
    body: 'Anywhere from 21 to 35 days is considered typical for an adult. The ' +
      'number that matters is not 28, it is whether yours is roughly the same ' +
      'each time.',
  },
  {
    id: 'any-spotting',
    title: 'Spotting is not the start of a period',
    body: 'That is why Kittycal keeps them apart — counting spotting as day one ' +
      'would quietly stretch every cycle length and skew what comes next. Log ' +
      'it as spotting and the maths stays honest.',
  },
  {
    id: 'any-backfill',
    title: 'Old periods are worth filling in',
    body: 'Editing period dates on any past month feeds straight back into the ' +
      'predictions. Three remembered cycles improve things more than three ' +
      'perfectly logged days.',
  },
  {
    id: 'any-report',
    title: 'You can print a summary for an appointment',
    body: 'Insights has a report covering the last six months — cycle lengths, ' +
      'recurring symptoms and anything outside the typical ranges. Doctors get ' +
      'a lot more from that than from "a bit irregular, I think".',
  },
  {
    id: 'any-export',
    title: 'Your data is yours to take',
    body: 'Settings can export everything as a plain file you can read, keep or ' +
      'move to another device. Nothing here is locked in, because nothing here ' +
      'is anywhere but this device.',
  },
  {
    id: 'any-not-contraception',
    title: 'Predictions are not contraception',
    body: 'Fertile windows are estimates from your own history, and ovulation ' +
      'can move. Worth remembering however neat the calendar looks.',
    needsFertility: true,
  },
  {
    id: 'any-passcode',
    title: 'There is a passcode if you want one',
    body: 'Settings can put four digits in front of the app. Useful if your ' +
      'phone gets handed around, and it takes about ten seconds to set up.',
  },
];

/**
 * Choose the most relevant tips for today.
 *
 * Scoring favours specificity: a tip that matches both the phase and something
 * she logged today beats a generic one. Ties break on the date so the order is
 * stable through a day but rotates between days — the same card every morning
 * stops being read within a week.
 *
 * @param {Object} input
 * @param {PhaseId} input.phase
 * @param {number|null} input.cycleDay
 * @param {string[]} input.loggedToday   taxonomy ids logged today
 * @param {boolean} input.showFertility
 * @param {string} input.dateSeed        today's date key, for rotation
 * @param {number} [input.limit]
 * @returns {Tip[]}
 */
export function pick({ phase, cycleDay, loggedToday, showFertility, dateSeed, limit = 3 }) {
  const logged = new Set(loggedToday);

  /** @type {{tip: Tip, score: number}[]} */
  const scored = [];

  for (const tip of TIPS) {
    if (tip.needsFertility && !showFertility) continue;
    if (tip.phases && !tip.phases.includes(phase)) continue;
    if (tip.cycleDays && (cycleDay == null || !tip.cycleDays.includes(cycleDay))) continue;

    // A tip gated on a symptom only appears when that symptom is logged.
    if (tip.whenLogged) {
      if (!tip.whenLogged.some((id) => logged.has(id))) continue;
      scored.push({ tip, score: 3 });
      continue;
    }

    scored.push({ tip, score: tip.phases ? 2 : 1 });
  }

  // Deterministic per-day rotation so the generic tips take turns.
  //
  // This needs a genuine permutation, and two obvious approaches both fail:
  // adding a date-derived offset to each id's hash shifts every value equally,
  // and concatenating the date onto the id is barely better, because a
  // polynomial hash is linear — `hash(A + S) - hash(B + S)` is just
  // `(hash(A) - hash(B)) * 31^|S|`, which keeps the same sign. Either way the
  // same three cards showed every single day.
  //
  // XOR the two hashes and run the result through an avalanche mixer, so one
  // changed bit in the date reshuffles the whole ordering.
  const seed = hash(dateSeed);
  scored.sort((a, b) =>
    b.score - a.score || mix(hash(a.tip.id) ^ seed) - mix(hash(b.tip.id) ^ seed));

  return scored.slice(0, limit).map((entry) => entry.tip);
}

/** Small stable string hash. Not cryptographic — it only has to be repeatable.
 * @param {string} text */
function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Avalanche mixer (the murmur3 finalizer). Spreads a single changed input bit
 * across the whole output, which is exactly what the plain polynomial hash
 * above fails to do and why the rotation needs it.
 * @param {number} x
 */
function mix(x) {
  x = Math.imul(x ^ (x >>> 16), 2246822507);
  x = Math.imul(x ^ (x >>> 13), 3266489909);
  return (x ^ (x >>> 16)) >>> 0;
}
