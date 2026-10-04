// @ts-check
/**
 * partner.js — the summary she shares with a partner, and what his screen
 * makes of it.
 *
 * Two halves, both pure:
 *
 *   - `buildSnapshot` runs on her phone. It turns her forecast into a small
 *     summary holding only what she ticked. It never holds a log, a note, a
 *     test result or the fact that her period is late: a late period reads as
 *     "due around now" on his side, whatever the reason, because that is hers
 *     to tell.
 *   - `partnerModel` runs on his phone. A summary is only refreshed when she
 *     opens her app, so it has to stay right in between: from the last start,
 *     the cycle length and the period length it works out where she is today,
 *     rolling forward a cycle at a time once a forecast date has passed.
 *
 * Nothing here talks to a network or encrypts anything; that is
 * storage/share.js.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./model.js').Settings} Settings
 * @typedef {import('./predict.js').Prediction} Prediction
 */

import { addDays, daysBetween } from '../utils/date.js';
import { labelOf } from '../data/taxonomy.js';

/** What she can choose to share. `period` is the point of the feature and is always on. */
export const SHARE_ITEMS = /** @type {const} */ ([
  { id: 'phase', label: 'Where you are in your cycle', sub: 'In plain words, with what it means for them', default: true },
  { id: 'patterns', label: 'Your usual pre-period symptoms', sub: 'Like "bloating usually starts 3 days before"', default: true },
  { id: 'helps', label: 'What helps you', sub: 'In your own words', default: true },
  { id: 'mood', label: 'When harder days usually start', sub: 'Only if your logs show a pattern', default: false },
  { id: 'fertile', label: 'Your fertile window', sub: 'Off unless you want it shared', default: false },
  { id: 'name', label: 'Your name', sub: 'So the view says whose cycle it is', default: true },
]);

/**
 * @typedef {Object} ShareChoices
 * @property {boolean} phase
 * @property {boolean} patterns
 * @property {boolean} helps
 * @property {boolean} mood
 * @property {boolean} fertile
 * @property {boolean} name
 */

/** @returns {ShareChoices} */
export function defaultChoices() {
  return /** @type {ShareChoices} */ (Object.fromEntries(SHARE_ITEMS.map((i) => [i.id, i.default])));
}

/**
 * @typedef {Object} Snapshot
 * @property {1} v
 * @property {string|null} name
 * @property {DateKey} updated
 * @property {boolean} paused       nothing to show: a forecast cannot honestly be made
 * @property {DateKey|null} lastStart
 * @property {DateKey|null} nextStart
 * @property {number} cycleLength
 * @property {number} periodLength
 * @property {number} lutealDays
 * @property {boolean} phase
 * @property {boolean} fertile
 * @property {{label: string, before: number}[]} patterns
 * @property {number|null} mood     days before a period harder days usually start
 * @property {string} helps
 */

/**
 * The summary her phone shares.
 *
 * @param {Object} input
 * @param {Settings} input.settings
 * @param {Prediction} input.prediction
 * @param {ShareChoices} input.choices
 * @param {string} input.helps
 * @param {import('./heads-up.js').PremenstrualPattern[]} input.patterns
 * @param {number|null} input.moodWindow
 * @param {DateKey} input.today
 * @returns {Snapshot}
 */
export function buildSnapshot({ settings, prediction: p, choices, helps, patterns, moodWindow, today }) {
  /*
    Paused rather than wrong. After a positive pregnancy test, or when there
    is no history to forecast from, the honest summary is "nothing to show" —
    and it is said the same way in both cases, so the partner's screen cannot
    tell them apart.
  */
  const paused = p.expecting || p.stale || !p.lastStart || !p.nextStart;
  return {
    v: 1,
    name: choices.name && settings.name.trim() ? settings.name.trim().slice(0, 40) : null,
    updated: today,
    paused,
    lastStart: paused ? null : p.lastStart,
    nextStart: paused ? null : p.nextStart,
    cycleLength: p.avgCycleLength,
    periodLength: p.avgPeriodLength,
    lutealDays: p.lutealDays,
    phase: choices.phase && !p.onHormonal,
    fertile: choices.fertile && p.showFertility && !p.onHormonal,
    patterns: choices.patterns && !paused
      ? patterns.filter((x) => x.kind !== 'moods').slice(0, 5)
        .map((x) => ({ label: x.kind === 'custom' ? x.id : labelOf(x.id), before: x.typicalBefore }))
      : [],
    mood: choices.mood && !paused ? moodWindow : null,
    helps: choices.helps ? helps.trim().slice(0, 600) : '',
  };
}

/**
 * @typedef {Object} PartnerModel
 * @property {'quiet'|'period'|'due'|'soon'|'later'} status
 * @property {string} who            "Sam" or "Your partner"
 * @property {string} headline
 * @property {string|null} sub
 * @property {{id: 'period'|'follicular'|'fertile'|'luteal', title: string, text: string}|null} phase
 * @property {{label: string, before: number, now: boolean}[]} patterns
 * @property {string|null} mood
 * @property {string} helps
 * @property {{start: DateKey, end: DateKey}[]} upcoming
 * @property {DateKey} updated
 */

/**
 * What his screen shows today.
 *
 * @param {Snapshot} snap
 * @param {DateKey} today
 * @returns {PartnerModel}
 */
export function partnerModel(snap, today) {
  const who = snap.name || 'Your partner';
  const her = snap.name || 'she';
  const quiet = {
    status: /** @type {const} */ ('quiet'), who, headline: 'Nothing to show right now',
    sub: `${snap.name || 'Your partner'} will update this when there is.`, phase: null,
    patterns: [], mood: null, helps: snap.helps, upcoming: [], updated: snap.updated,
  };
  if (snap.paused || !snap.lastStart || !snap.nextStart) return quiet;

  const len = Math.max(15, snap.cycleLength);
  const bleed = Math.max(1, snap.periodLength);

  /*
    Where she is, worked out from his calendar rather than read off hers.

    Her last start, if today is inside that period. Otherwise the forecast
    start, rolled forward a cycle at a time once its whole expected period has
    gone by — the app on her phone has not been opened since, so the summary is
    older than the cycle it describes. A start that has arrived but not been
    confirmed is "due around now", never "late".
  */
  let start = snap.lastStart;
  let next = snap.nextStart;
  while (daysBetween(addDays(next, bleed - 1), today) > 0) {
    start = next;
    next = addDays(next, len);
  }

  const sinceStart = daysBetween(start, today);
  const until = daysBetween(today, next);

  /** @type {PartnerModel['status']} */
  let status;
  let headline;
  let sub = null;
  // Only a start she actually logged counts as "on her period".
  if (start === snap.lastStart && sinceStart >= 0 && sinceStart < bleed) {
    status = 'period';
    headline = `On ${snap.name ? `${snap.name}’s` : 'her'} period, day ${sinceStart + 1}`;
  } else if (until <= 0) {
    status = 'due';
    headline = `${snap.name ? `${snap.name}’s` : 'Her'} period is due around now`;
  } else if (until <= 7) {
    status = 'soon';
    headline = until === 1 ? 'Period likely tomorrow' : `Period likely in ${until} days`;
    sub = 'Worth having supplies, and some slack, ready.';
  } else {
    status = 'later';
    headline = `Next period in about ${until} days`;
  }

  /** @type {PartnerModel['phase']} */
  let phase = null;
  if (snap.phase) {
    const ovulation = addDays(next, -snap.lutealDays);
    const toOv = daysBetween(today, ovulation);
    if (status === 'period') {
      phase = { id: 'period', title: 'Period', text:
        'The first couple of days are usually the hardest: cramps and tiredness are common. '
        + 'A heat pad, painkillers within reach and some patience go a long way.' };
    } else if (snap.fertile && toOv <= 0 && toOv >= -1) {
      phase = { id: 'fertile', title: 'Fertile window', text:
        'Around ovulation. Pregnancy is most likely in these days.' };
    } else if (snap.fertile && toOv > 0 && toOv <= 5) {
      phase = { id: 'fertile', title: 'Fertile window', text:
        'Her fertile window. Pregnancy is possible from now until just after ovulation.' };
    } else if (toOv > 0) {
      phase = { id: 'follicular', title: 'Follicular phase', text:
        'Oestrogen is rising, so energy and mood often pick up in this stretch.' };
    } else {
      phase = { id: 'luteal', title: 'Luteal phase', text:
        'Progesterone is high. If PMS happens, it shows up in the days before her period: '
        + 'tiredness, bloating, a shorter fuse. That’s hormones, not anything you did.' };
    }
  }

  const before = status === 'due' || status === 'period' ? 0 : until;
  return {
    status, who, headline, sub, phase,
    patterns: snap.patterns.map((x) => ({ ...x, now: status !== 'period' && before > 0 && before <= x.before + 1 })),
    mood: snap.mood != null
      ? (status !== 'period' && before > 0 && before <= snap.mood
        ? `Harder days usually start about now for ${her === 'she' ? 'her' : her}.`
        : `Harder days usually start about ${snap.mood} days before ${her === 'she' ? 'her' : `${her}’s`} period.`)
      : null,
    helps: snap.helps,
    upcoming: [0, 1].map((k) => {
      const s = addDays(next, k * len);
      return { start: s, end: addDays(s, bleed - 1) };
    }),
    updated: snap.updated,
  };
}

/**
 * The upcoming periods as a calendar file, so they appear in his own calendar.
 *
 * @param {PartnerModel} model
 * @param {string} stamp  e.g. 20261004T120000Z
 * @returns {string}
 */
export function icsFor(model, stamp) {
  const day = (/** @type {DateKey} */ key) => key.replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kittycal//Partner view//EN', 'CALSCALE:GREGORIAN'];
  for (const p of model.upcoming) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:kittycal-${day(p.start)}@kittycal`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(p.start)}`,
      `DTEND;VALUE=DATE:${day(addDays(p.end, 1))}`,
      `SUMMARY:${model.who === 'Your partner' ? 'Period' : `${model.who}’s period`} (expected)`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
