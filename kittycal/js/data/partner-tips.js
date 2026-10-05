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
  // What she sent: the line under her status bubble, which already says it.
  'status:good': { icon: '🌟', lines: ['A nice day to make a plan together.'] },
  'status:tired': { icon: 'low-energy', lines: ['Take one chore off her plate without asking.'] },
  'status:cramps': { icon: 'cramps', lines: ['Heat pad, painkillers within reach, and you handle dinner.'] },
  'status:space': { icon: '💭', lines: ['A short kind message, then let her be.'] },
  'status:cuddles': { icon: '💗', lines: ['Keep the evening free.'] },
  'status:snacks': { icon: 'cravings', lines: ['You know her favourites.'] },

  // Timing. Each is the line under a title that already names the thing.
  due: { icon: '🗓️', lines: ['Could start any day. Supplies at home?', 'Keep plans flexible this week.'] },
  soon: { icon: '🗓️', lines: ['Worth having supplies, and some slack, ready.'] },
  'period-start': {
    icon: '🩸',
    lines: [
      'The first days are usually the hardest. Keep plans easy to cancel.',
      'Offering to cook or pick up food helps.',
      'A warm drink and the sofa beat a big night out.',
    ],
  },
  'period-later': { icon: '🩸', lines: ['Usually easing off by now. Ask how she’s feeling rather than guessing.'] },
  easy: { icon: '🌟', lines: ['A good time for that date.', 'Good timing for plans you’ve been putting off.'] },
  fertile: { icon: '🌷', lines: ['Pregnancy is possible on these days.'] },

  // Her own patterns, when one lands. Shown after when it usually happens,
  // so each is only the part he can do something with.
  cramps: { icon: 'cramps', lines: ['A heat pad and painkillers within reach help.', 'Offering to handle dinner helps.'] },
  bloating: { icon: 'bloating', lines: ['Comfy plans beat dressed-up ones.', 'Skip the snack jokes, bring the snacks.'] },
  headache: { icon: 'headache', lines: ['A quiet evening with the lights low helps.', 'Water and something to eat often help. Offer both.'] },
  migraine: { icon: 'migraine', lines: ['A dark, quiet room and no plans if one hits.'] },
  fatigue: { icon: 'fatigue', lines: ['An early night beats a big night out.', 'Take one chore off her list without being asked.'] },
  'low-energy': { icon: 'low-energy', lines: ['Keep plans low-key.'] },
  backache: { icon: 'backache', lines: ['A back rub goes a long way.'] },
  nausea: { icon: 'nausea', lines: ['Plain food, and skip strong smells.'] },
  'tender-breasts': { icon: 'tender-breasts', lines: ['Go gently with hugs.'] },
  cravings: { icon: 'cravings', lines: ['Stock something she likes.'] },
  insomnia: { icon: 'insomnia', lines: ['Keep late nights for another week.'] },
  'harder-days': {
    icon: '💭',
    lines: [
      'Extra patience helps. It’s hormones, not you.',
      'Ask “what would help?” rather than guessing.',
      'A kind message in the afternoon lands well.',
    ],
  },
  sleep: { icon: '🌙', lines: ['Keep evenings low-key.'] },
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
