// @ts-check
/**
 * partner.js — the summary she shares with a partner, and what their app
 * makes of it.
 *
 * Two halves, both pure:
 *
 *   - `buildSnapshot` runs on her phone. It turns her forecast and her own
 *     patterns into a small summary holding only what she ticked. It never
 *     holds a log, a note, a test result or the fact that her period is late:
 *     a late period reads as "due around now" on his side, whatever the
 *     reason, because that is hers to tell.
 *   - `partnerDay` / `partnerModel` run on his phone. A summary is only
 *     refreshed when she opens her app, so they have to stay right in
 *     between: from her last start, her cycle length and her period length
 *     they work out where she is on any date, rolling forward a cycle at a
 *     time once a forecast date has passed.
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
import { TIPS, STATUSES } from '../data/partner-tips.js';

/**
 * What she can choose to share. Her forecast is the point of the feature and
 * always goes; her theme goes so his app can draw her character; a short note
 * goes only if she writes one.
 */
export const SHARE_ITEMS = /** @type {const} */ ([
  { id: 'phase', label: 'Your cycle and phases', sub: 'Where you are today, and how long your cycles run', default: true },
  { id: 'patterns', label: 'Your patterns', sub: 'Like when bloating usually starts, and your easier days', default: true },
  { id: 'mood', label: 'When harder days usually start', sub: 'Only if your logs show a pattern', default: true },
  { id: 'fertile', label: 'Your fertile window', sub: 'Off unless you want it shared', default: false },
  { id: 'name', label: 'Your name', sub: 'So their app says whose cycle it is', default: true },
]);

/**
 * @typedef {Object} ShareChoices
 * @property {boolean} phase
 * @property {boolean} patterns
 * @property {boolean} helps     a note she writes, sent only when there is one
 * @property {boolean} mood
 * @property {boolean} fertile
 * @property {boolean} name
 */

/** @returns {ShareChoices} */
export function defaultChoices() {
  return /** @type {ShareChoices} */ ({
    ...Object.fromEntries(SHARE_ITEMS.map((i) => [i.id, i.default])),
    helps: true,
  });
}

/**
 * Where something usually lands in her cycle. Positive positions are cycle
 * days counted from the first day of her period; negative ones count back
 * from the next period (−1 is the day before it).
 *
 * @typedef {Object} Lane
 * @property {string} id
 * @property {string} label
 * @property {'body'|'mood'|'sleep'} kind
 * @property {number} from
 * @property {number} to
 */

/**
 * @typedef {Object} Stats
 * @property {number} min        shortest of her recent cycles
 * @property {number} max        longest
 * @property {number} cycles     complete cycles behind the numbers
 * @property {'regular'|'variable'|'irregular'|null} regularity
 * @property {number|null} hits  forecasts within two days, once it can be scored
 * @property {number|null} total
 */

/**
 * @typedef {Object} Snapshot
 * @property {1|2} v
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
 * @property {string|null} theme
 * @property {Lane[]} lanes
 * @property {{from: number, to: number}|null} easy
 * @property {Stats|null} stats
 * @property {{id: string, at: number}|null} status
 * @property {number|null} tracked  finished cycles she has logged in (patterns need three); null if not shared
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
 * @param {import('./rhythm.js').BodyRow[]} [input.rows]      her body map, for lanes
 * @param {boolean} [input.sleepDip]                          she sleeps less the week before
 * @param {{from: number, to: number}|null} [input.easy]
 * @param {Stats|null} [input.stats]
 * @param {{id: string, at: number}|null} [input.status]
 * @param {number|null} [input.tracked]   finished cycles she logged in
 * @returns {Snapshot}
 */
export function buildSnapshot({
  settings, prediction: p, choices, helps, patterns, moodWindow, today,
  rows = [], sleepDip = false, easy = null, stats = null, status = null, tracked = null,
}) {
  /*
    Paused rather than wrong. After a positive pregnancy test, or when there
    is no history to forecast from, the honest summary is "nothing to show" —
    and it is said the same way in both cases, so the partner's screen cannot
    tell them apart.
  */
  const paused = p.expecting || p.stale || !p.lastStart || !p.nextStart;
  const showPatterns = choices.patterns && !paused;

  /** @type {Lane[]} */
  const lanes = [];
  if (showPatterns) {
    for (const row of rows) {
      if (row.kind === 'moods' || !row.when || row.when.where === 'middle') continue;
      const label = row.kind === 'custom' ? row.id.slice(0, 40) : labelOf(row.id);
      if (row.when.where === 'period') {
        lanes.push({ id: row.id, label, kind: 'body', from: row.when.from, to: row.when.to });
      } else {
        lanes.push({ id: row.id, label, kind: 'body', from: -row.when.from, to: -1 });
      }
      if (lanes.length >= 5) break;
    }
    if (sleepDip) lanes.push({ id: 'sleep', label: 'Shorter sleep', kind: 'sleep', from: -7, to: -1 });
  }
  if (choices.mood && !paused && moodWindow) {
    lanes.push({ id: 'harder-days', label: 'Harder days', kind: 'mood', from: -moodWindow, to: -1 });
  }

  const note = choices.helps ? helps.trim().slice(0, 600) : '';
  return {
    v: 2,
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
    patterns: showPatterns
      ? patterns.filter((x) => x.kind !== 'moods').slice(0, 5)
        .map((x) => ({ label: x.kind === 'custom' ? x.id : labelOf(x.id), before: x.typicalBefore }))
      : [],
    mood: choices.mood && !paused ? moodWindow : null,
    helps: note,
    theme: settings.theme || null,
    lanes,
    easy: showPatterns && !p.onHormonal ? easy : null,
    stats: choices.phase && !paused ? stats : null,
    status: status && STATUSES.some((s) => s.id === status.id) ? status : null,
    // So his app can say how far along her patterns are, not just that there are none.
    tracked: (choices.patterns || choices.mood) && !paused && tracked != null ? tracked : null,
  };
}

/**
 * A summary that arrived from somewhere else, made safe to draw.
 *
 * It was encrypted by her phone, but the link that carries the key can be
 * forwarded or hand-made, so what decrypts is untrusted until checked: every
 * field is typed, dates are real dates, numbers are in range and text is
 * capped. Anything that is not a summary at all comes back null. Version 1
 * summaries, from before lanes and stats existed, are read with those empty.
 *
 * @param {unknown} raw
 * @returns {Snapshot|null}
 */
export function cleanSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const date = (/** @type {unknown} */ v) => (typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v))
    ? /** @type {DateKey} */ (v) : null);
  const int = (/** @type {unknown} */ v, /** @type {number} */ lo, /** @type {number} */ hi, /** @type {number} */ dflt) =>
    (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : dflt);
  const text = (/** @type {unknown} */ v, /** @type {number} */ max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const obj = (/** @type {unknown} */ v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? /** @type {Record<string, unknown>} */ (v) : null);

  const updated = date(r.updated);
  if ((r.v !== 1 && r.v !== 2) || !updated) return null;
  const lastStart = date(r.lastStart);
  const nextStart = date(r.nextStart);

  /** @type {Lane[]} */
  const lanes = Array.isArray(r.lanes)
    ? r.lanes.slice(0, 8).flatMap((x) => {
      const l = obj(x);
      if (!l || typeof l.id !== 'string' || typeof l.label !== 'string') return [];
      const kind = l.kind === 'mood' || l.kind === 'sleep' ? l.kind : 'body';
      const from = int(l.from, -14, 45, 0);
      const to = int(l.to, -14, 45, 0);
      if (!from || !to || Math.sign(from) !== Math.sign(to) || from > to) return [];
      return [{ id: l.id.slice(0, 40), label: l.label.slice(0, 40), kind, from, to }];
    })
    : [];
  const e = obj(r.easy);
  const easyFrom = e ? int(e.from, 2, 45, 0) : 0;
  const easyTo = e ? int(e.to, 2, 45, 0) : 0;
  const s = obj(r.stats);
  const st = obj(r.status);

  return {
    v: 2,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : null,
    updated,
    paused: r.paused === true || !lastStart || !nextStart,
    lastStart,
    nextStart,
    cycleLength: int(r.cycleLength, 15, 90, 28),
    periodLength: int(r.periodLength, 1, 15, 5),
    lutealDays: int(r.lutealDays, 7, 20, 14),
    phase: r.phase === true,
    fertile: r.fertile === true,
    patterns: Array.isArray(r.patterns)
      ? r.patterns.slice(0, 5).flatMap((x) => (x && typeof x === 'object' && typeof x.label === 'string'
        ? [{ label: x.label.slice(0, 40), before: int(x.before, 1, 14, 3) }] : []))
      : [],
    mood: r.mood == null ? null : int(r.mood, 1, 14, 0) || null,
    helps: text(r.helps, 600),
    theme: typeof r.theme === 'string' && /^[a-z]{2,20}$/.test(r.theme) ? r.theme : null,
    lanes,
    easy: easyFrom && easyTo && easyFrom <= easyTo ? { from: easyFrom, to: easyTo } : null,
    stats: s ? {
      min: int(s.min, 15, 90, 28),
      max: int(s.max, 15, 90, 28),
      cycles: int(s.cycles, 0, 500, 0),
      regularity: s.regularity === 'regular' || s.regularity === 'variable' || s.regularity === 'irregular'
        ? s.regularity : null,
      hits: s.hits == null ? null : int(s.hits, 0, 500, 0),
      total: s.total == null ? null : int(s.total, 0, 500, 0),
    } : null,
    status: st && typeof st.id === 'string' && STATUSES.some((x) => x.id === st.id)
      && typeof st.at === 'number' && Number.isFinite(st.at)
      ? { id: st.id, at: st.at } : null,
    tracked: r.tracked == null ? null : int(r.tracked, 0, 500, 0),
  };
}

/* ── His side ───────────────────────────────────────────────────────────── */

/**
 * @typedef {'period'|'follicular'|'fertile'|'luteal'} PartnerPhase
 */

/**
 * @typedef {Object} PartnerDay
 * @property {DateKey} date
 * @property {number} cycleDay      1 on the first day of the (logged or expected) period
 * @property {number} untilNext     days to the next expected start; 0 or less once due
 * @property {'logged'|'expected'|null} period
 * @property {PartnerPhase|null} phase  null when she did not share phases
 * @property {Lane[]} lanes        her usual patterns that land on this day
 * @property {boolean} easy        inside her usual easier stretch
 * @property {DateKey} start       the start this day is counted from
 * @property {DateKey} next        the next expected start
 */

/**
 * Where she is on one date, worked out from his calendar rather than read
 * off hers.
 *
 * Her last start, if the date is inside that period. Otherwise the forecast
 * start, rolled forward a cycle at a time once its whole expected period has
 * gone by: her app may not have been opened since, so the summary can be
 * older than the cycle it describes. A start that has arrived but has not
 * been confirmed is "expected", never "late".
 *
 * @param {Snapshot} snap
 * @param {DateKey} date
 * @returns {PartnerDay|null}
 */
export function partnerDay(snap, date) {
  if (snap.paused || !snap.lastStart || !snap.nextStart) return null;
  const len = Math.max(15, snap.cycleLength);
  const bleed = Math.max(1, snap.periodLength);

  let start = snap.lastStart;
  let next = snap.nextStart;
  if (date < start) return null;
  /*
    Roll forward past a forecast start only when her app has not been opened
    since it: then nobody knows, and the next cycle is the best guess. If her
    app was open on or after that date and no start was logged, it has not
    come, and it stays due rather than quietly becoming "next period in 23
    days". Due, not late: that word is hers. A cycle's length on, it rolls
    anyway, as her own forecast stops guessing by then.
  */
  while (daysBetween(addDays(next, bleed - 1), date) > 0
    && !(next <= snap.updated && daysBetween(next, date) < len)) {
    start = next;
    next = addDays(next, len);
  }

  const untilNext = daysBetween(date, next);
  const sinceStart = daysBetween(start, date);
  /** @type {PartnerDay['period']} */
  let period = null;
  let counted = start;
  if (start === snap.lastStart && sinceStart < bleed) period = 'logged';
  else if (untilNext <= 0) { period = 'expected'; counted = next; }
  else if (start !== snap.lastStart && sinceStart < bleed) period = 'expected';
  const cycleDay = daysBetween(counted, date) + 1;

  /** @type {PartnerPhase|null} */
  let phase = null;
  if (snap.phase || snap.fertile) {
    const ovulation = addDays(next, -snap.lutealDays);
    const toOv = daysBetween(date, ovulation);
    if (period) phase = 'period';
    else if (snap.fertile && toOv <= 5 && toOv >= -1) phase = 'fertile';
    else if (snap.phase) phase = toOv > 0 ? 'follicular' : 'luteal';
  }

  const lanes = (snap.lanes ?? []).filter((l) => (l.from > 0
    ? cycleDay >= l.from && cycleDay <= l.to && (period !== 'expected' || untilNext <= 0 || l.from <= bleed)
    : untilNext >= -l.to && untilNext <= -l.from));
  const easy = Boolean(snap.easy && !period && untilNext > 0
    && cycleDay >= snap.easy.from && cycleDay <= snap.easy.to);

  return { date, cycleDay, untilNext, period, phase, lanes, easy, start: counted, next };
}

/**
 * What a phase means, for him: one line he will read, and a "Why?" he can
 * open. The science is there because it is the useful part ("that is
 * hormones, not you"), said by what it changes rather than as a lesson.
 */
export const PHASE_WORDS = /** @type {const} */ ({
  period: {
    title: 'Period',
    short: 'Usually the hardest days, the first two most of all.',
    more: 'Her body is shedding the lining of the uterus. Chemicals called prostaglandins make the muscles '
      + 'squeeze, which is the cramping, and they can bring tiredness and an upset stomach with them. '
      + 'It is physical, not a mood.',
  },
  follicular: {
    title: 'Follicular phase',
    short: 'Energy and mood often pick up in this stretch.',
    more: 'Oestrogen is rising as her body gets ready to ovulate. For a lot of people this is the most '
      + 'energetic, sociable part of the month.',
  },
  fertile: {
    title: 'Fertile window',
    short: 'Pregnancy is possible on these days.',
    more: 'Ovulation is close. An egg lasts about a day and sperm up to five, so the window is about six days long.',
  },
  luteal: {
    title: 'Luteal phase',
    short: 'If PMS happens, it shows up in these days.',
    more: 'After ovulation progesterone rises, then both hormones drop in the last days before her period. '
      + 'That drop is what brings PMS for a lot of people: tiredness, bloating, a shorter fuse. '
      + 'That’s hormones, not anything you did.',
  },
});

/**
 * @typedef {Object} PartnerModel
 * @property {'quiet'|'period'|'due'|'soon'|'later'} status
 * @property {string} who            "Sam" or "Your partner"
 * @property {string} headline
 * @property {string|null} sub
 * @property {{id: PartnerPhase, title: string, text: string}|null} phase
 * @property {{label: string, before: number, now: boolean}[]} patterns
 * @property {string|null} mood
 * @property {string} helps
 * @property {{start: DateKey, end: DateKey}[]} upcoming
 * @property {DateKey} updated
 * @property {PartnerDay|null} day
 */

/**
 * What his screen says today.
 *
 * @param {Snapshot} snap
 * @param {DateKey} today
 * @returns {PartnerModel}
 */
export function partnerModel(snap, today) {
  const who = snap.name || 'Your partner';
  const her = snap.name || 'she';
  /** @type {PartnerModel} */
  const quiet = {
    status: 'quiet', who, headline: 'Nothing to show right now',
    sub: `${snap.name || 'Your partner'} will update this when there is.`, phase: null,
    patterns: [], mood: null, helps: snap.helps, upcoming: [], updated: snap.updated, day: null,
  };
  const day = partnerDay(snap, today);
  if (!day) return quiet;

  const bleed = Math.max(1, snap.periodLength);
  const len = Math.max(15, snap.cycleLength);
  const until = day.untilNext;

  /** @type {PartnerModel['status']} */
  let status;
  let headline;
  let sub = null;
  if (day.period === 'logged') {
    status = 'period';
    headline = `On ${snap.name ? `${snap.name}’s` : 'her'} period, day ${day.cycleDay}`;
  } else if (until <= 0 || day.period === 'expected') {
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
  // The words only when she shared her phases; the ring still shows a period.
  if (day.phase && snap.phase) {
    const text = {
      period: 'The first couple of days are usually the hardest: cramps and tiredness are common. '
        + 'A heat pad, painkillers within reach and some patience go a long way.',
      fertile: until - snap.lutealDays <= 0 ? 'Around ovulation. Pregnancy is most likely in these days.'
        : 'Her fertile window. Pregnancy is possible from now until just after ovulation.',
      follicular: 'Oestrogen is rising, so energy and mood often pick up in this stretch.',
      luteal: 'Progesterone is high. If PMS happens, it shows up in the days before her period: '
        + 'tiredness, bloating, a shorter fuse. That’s hormones, not anything you did.',
    }[day.phase];
    phase = { id: day.phase, title: PHASE_WORDS[day.phase].title, text };
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
    // Starting from the one she is due for, or in, when that is still going.
    upcoming: [0, 1, 2].map((k) => {
      const s = addDays(day.next, k * len);
      return { start: s, end: addDays(s, bleed - 1) };
    }).filter((p) => p.end >= today),
    updated: snap.updated,
    day,
  };
}

/**
 * The days ahead, for his forecast strip and calendar.
 *
 * @param {Snapshot} snap
 * @param {DateKey} from
 * @param {number} count
 * @returns {PartnerDay[]}
 */
export function partnerDays(snap, from, count) {
  /** @type {PartnerDay[]} */
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const d = partnerDay(snap, addDays(from, i));
    if (d) out.push(d);
  }
  return out;
}

/**
 * When something usually happens, in words he can picture.
 *
 * @param {{from: number, to: number}} range  positive: cycle days; negative: days before her next period
 * @param {number} periodLength
 */
export function laneWhen({ from, to }, periodLength) {
  if (from > 0) {
    if (to <= periodLength) {
      if (from === 1) return to === 1 ? 'Usually the first day of her period' : `Usually the first ${to} days of her period`;
      return from === to ? `Usually day ${from} of her period` : `Usually days ${from} to ${to} of her period`;
    }
    return from === to ? `Usually day ${from} of her cycle` : `Usually days ${from} to ${to} of her cycle`;
  }
  const far = -from;
  const near = -to;
  if (near === 1) return far === 1 ? 'Usually the day before her period' : `Usually the last ${far} days before her period`;
  return `Usually ${far} to ${near} days before her period`;
}

/**
 * Her period is due on this day: its expected start has passed, by today or
 * by more than a period's length, with no start confirmed. Not day 3 or 4 of
 * something nobody has seen.
 *
 * @param {Snapshot} snap
 * @param {PartnerDay} day
 * @param {DateKey} today
 */
export function isDue(snap, day, today) {
  return day.period === 'expected'
    && (day.date <= today || daysBetween(day.next, day.date) >= Math.max(1, snap.periodLength));
}

/**
 * @typedef {Object} DayItem
 * @property {string} key    what it is about: a lane id, a phase, a timing
 * @property {string} icon   a symptom id or a moment emoji, drawn by the view
 * @property {string} title  the thing: "Bloating", "Period, day 2"
 * @property {string} text   when it usually happens, then one thing that helps
 */

/**
 * What is likely on a day, from her own patterns and where she is: each
 * thing named, with one line on when it usually happens for her and what
 * helps. The same list on Today, in a day's detail and in her preview.
 *
 * A period whose expected start has passed by `today` is "due", not day 3 or
 * 4 of something nobody has confirmed: her app would have said if it had
 * started. Days of a period still ahead are forecasts, and say so.
 *
 * @param {Snapshot} snap
 * @param {PartnerDay} day
 * @param {DateKey} today
 * @param {number} [limit]
 * @returns {DayItem[]}
 */
export function dayItems(snap, day, today, limit = 4) {
  // A stable pick per date: the same line all day, a different one next month.
  let seed = 0;
  for (const ch of day.date) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const line = (/** @type {string} */ key, n = 0) => {
    const lines = TIPS[key]?.lines ?? [];
    return lines.length ? lines[(seed + n) % lines.length] : '';
  };
  const bleed = Math.max(1, snap.periodLength);
  const due = isDue(snap, day, today);

  /** @type {DayItem[]} */
  const out = [];
  if (day.period === 'logged') {
    out.push({ key: 'period', icon: '🩸', title: `Period, day ${day.cycleDay}`,
      text: line(day.cycleDay <= 2 ? 'period-start' : 'period-later') });
  } else if (due) {
    out.push({ key: 'due', icon: '🗓️', title: 'Period due any day', text: line('due') });
  } else if (day.period === 'expected') {
    out.push({ key: 'period', icon: '🩸',
      title: day.untilNext === 0 ? 'Period likely to start' : `Period likely, day ${day.cycleDay}`,
      text: line(day.cycleDay <= 2 ? 'period-start' : 'period-later') });
  } else if (day.untilNext >= 1 && day.untilNext <= 2) {
    out.push({ key: 'soon', icon: '🗓️',
      title: day.untilNext === 1 ? 'Period likely tomorrow' : 'Period likely in 2 days', text: line('soon') });
  }
  for (const lane of day.lanes) {
    // Not "cramps, day 4" of a period that has not been confirmed.
    if (due && lane.from > 0) continue;
    const key = lane.kind === 'mood' ? 'harder-days' : lane.kind === 'sleep' ? 'sleep' : lane.id;
    const tip = line(key, out.length);
    out.push({
      key,
      icon: lane.kind === 'mood' ? '💭' : lane.kind === 'sleep' ? '🌙' : lane.id,
      title: lane.label,
      text: `${laneWhen(lane, bleed)}.${tip ? ` ${tip}` : ''}`,
    });
  }
  if (day.easy && snap.easy) {
    out.push({ key: 'easy', icon: '🌟', title: 'One of her easier days',
      text: `${laneWhen(snap.easy, bleed)}. ${line('easy')}` });
  }
  if (day.phase === 'fertile') out.push({ key: 'fertile', icon: '🌷', title: 'Fertile window', text: line('fertile') });
  return out.slice(0, limit);
}

/**
 * The stretch of days where `match` holds that is under way on `today`, or
 * the next one after it. Looked for from `since` (the start of her current
 * cycle), so a stretch already going has its real first day. Null if none
 * comes within the horizon.
 *
 * @param {Snapshot} snap
 * @param {(d: PartnerDay) => boolean} match
 * @param {DateKey} since
 * @param {DateKey} today
 * @param {number} [horizon]  days to look through
 * @returns {{from: DateKey, to: DateKey}|null}
 */
export function nextRun(snap, match, since, today, horizon = 100) {
  /** @type {{from: DateKey, to: DateKey}|null} */
  let run = null;
  for (const d of partnerDays(snap, since, horizon)) {
    if (match(d)) {
      if (run) run.to = d.date;
      else run = { from: d.date, to: d.date };
    } else if (run) {
      if (run.to >= today) return run;
      run = null;
    }
  }
  return run && run.to >= today ? run : null;
}

/** The status line he sees under what she sent. */
export const statusTip = (/** @type {string} */ id) => TIPS[`status:${id}`]?.lines[0] ?? '';

/** How long a status she sent stays on his screen. */
export const STATUS_HOURS = 16;

/**
 * Her status, if it is still current.
 * @param {Snapshot} snap
 * @param {number} now  epoch ms
 */
export function freshStatus(snap, now) {
  if (!snap.status) return null;
  const age = now - snap.status.at;
  return age >= 0 && age < STATUS_HOURS * 3600e3 ? snap.status : null;
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
      // A heads-up the evening before, from his own calendar app.
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Period likely tomorrow', 'TRIGGER:-PT6H', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
