// @ts-check
/**
 * partner-tips.js — what his app suggests, and what she can tell him in a tap.
 *
 * The rules every line here keeps:
 *
 *   - One line, and something he can actually do. "Be supportive" is not a
 *     tip; "take dinner off her plate" is.
 *   - Keyed to something real: a pattern from her own logs that lands today,
 *     where she is in her cycle, or a status she sent. Nothing is shown
 *     because it is generically true of "women".
 *   - Never blames her body or her mood. "Hormones, not you" is said to
 *     reassure him, never as a reason to dismiss her.
 *   - She can preview every one of them from her share sheet, so nothing
 *     here should read as something she would be embarrassed to see.
 *
 * Icons are a symptom id (drawn from data/icons.js) or one of the moment
 * emoji that data/icons.js draws as its own marks.
 */

/** @type {Record<string, {icon: string, lines: string[]}>} */
export const TIPS = {
  // What she sent, which outranks everything else.
  'status:good': { icon: '🌟', lines: ['She’s feeling good today. A nice day to make a plan together.'] },
  'status:tired': { icon: 'low-energy', lines: ['Low on energy today. Take one chore off her plate without asking.'] },
  'status:cramps': { icon: 'cramps', lines: ['Cramps today. Heat pad, painkillers within reach, and you handle dinner.'] },
  'status:space': { icon: '💭', lines: ['She’d like some space. A short kind message, then let her be.'] },
  'status:cuddles': { icon: '💗', lines: ['She asked for cuddles. Keep the evening free.'] },
  'status:snacks': { icon: 'cravings', lines: ['Snack request. You know her favourites.'] },

  // Timing.
  due: { icon: '🗓️', lines: ['Her period could start any day now. Supplies at home?', 'Any day now. Keep plans flexible this week.'] },
  soon: { icon: '🗓️', lines: ['Her period’s likely in a day or two. Worth having supplies ready.'] },
  'period-start': {
    icon: '🩸',
    lines: [
      'The first days are usually the hardest. Keep plans easy to cancel.',
      'Offer to cook or pick up food tonight.',
      'A warm drink and the sofa beat a big night out today.',
    ],
  },
  'period-later': { icon: '🩸', lines: ['Usually easing off by now. Ask how she’s feeling rather than guessing.'] },
  easy: {
    icon: '🌟',
    lines: [
      'Usually one of her easier stretches. A good time for that date.',
      'Her easier days. Good timing for plans you’ve been putting off.',
    ],
  },
  follicular: { icon: '✨', lines: ['Energy often picks up around now. A good stretch for plans.'] },
  fertile: { icon: '🌷', lines: ['Her fertile window: pregnancy is possible on these days.'] },

  // Her own patterns, when one lands today.
  cramps: {
    icon: 'cramps',
    lines: ['Heat pad charged and painkillers within reach.', 'Cramps usually show up now. Offer to handle dinner.'],
  },
  bloating: {
    icon: 'bloating',
    lines: ['Comfy plans beat dressed-up ones around now.', 'Bloating usually shows up now. Skip the snack jokes, bring the snacks.'],
  },
  headache: {
    icon: 'headache',
    lines: ['Headaches tend to land now. Keep the evening quiet, lights low.', 'Water and something to eat often help a headache. Offer both.'],
  },
  migraine: { icon: 'migraine', lines: ['Migraines tend to land now. A dark, quiet room and no plans if one hits.'] },
  fatigue: {
    icon: 'fatigue',
    lines: ['She’s usually more tired around now. An early night beats a big night out.', 'Take one chore off her list without being asked.'],
  },
  'low-energy': { icon: 'low-energy', lines: ['Energy usually dips now. Keep plans low-key.'] },
  backache: { icon: 'backache', lines: ['Her back usually aches around now. A back rub goes a long way.'] },
  nausea: { icon: 'nausea', lines: ['She can feel queasy around now. Plain food, and skip strong smells.'] },
  'tender-breasts': { icon: 'tender-breasts', lines: ['Tenderness is usual around now. Go gently with hugs.'] },
  cravings: { icon: 'cravings', lines: ['Cravings usually kick in now. Stock something she likes.'] },
  insomnia: { icon: 'insomnia', lines: ['Her sleep is often worse now. Keep late nights for another week.'] },
  'harder-days': {
    icon: '💭',
    lines: [
      'Harder days usually start around now. Extra patience; it’s hormones, not you.',
      'Ask “what would help?” rather than guessing.',
      'A kind message in the afternoon lands well on harder days.',
    ],
  },
  sleep: { icon: '🌙', lines: ['She usually sleeps less this week. Keep evenings low-key.'] },
};

/**
 * What she can tell him in one tap. Short, warm, and each one changes what
 * his app suggests that day.
 */
export const STATUSES = /** @type {const} */ ([
  { id: 'good', label: 'Feeling good', icon: '🌟' },
  { id: 'tired', label: 'Low energy', icon: 'low-energy' },
  { id: 'cramps', label: 'Cramps', icon: 'cramps' },
  { id: 'space', label: 'Need space', icon: '💭' },
  { id: 'cuddles', label: 'Cuddles please', icon: '💗' },
  { id: 'snacks', label: 'Snacks please', icon: 'cravings' },
]);
