// @ts-check
/**
 * partner-app.js — Kittycal for the person she shares with.
 *
 * His phone does not track a cycle. It follows hers, from the encrypted
 * summary she chose to share, and turns it into four screens of his own:
 *
 *   - Today: where she is, what her own patterns say is likely today (each
 *     with when it usually happens for her, and one thing that helps), and
 *     the week ahead at a glance.
 *   - Calendar: her coming periods, harder and easier days, every look named
 *     in a legend, and any day's detail under the month.
 *   - Rhythm: her month unrolled as a bar, what usually happens when with the
 *     dates it lands on, and the numbers behind it.
 *   - Settings: his look, the connection, and the way back.
 *
 * Two characters, on purpose. His theme dresses his app (header, colours,
 * patterns); her character, in her own colours, marks her: on the ring, and
 * next to anything she sent him. If he picks her theme they match.
 *
 * Everything is drawn from the summary; nothing here reads her logs, because
 * his phone has none. The same Today renderer draws her preview of it, so
 * what she sees in her share sheet is exactly what he gets.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('../domain/partner.js').Snapshot} Snapshot
 * @typedef {import('../domain/partner.js').PartnerDay} PartnerDay
 */

import { el, replace, haptic, announce } from '../utils/dom.js';
import {
  todayKey, daysBetween, addDays, fmtDayMonth, fmtLong, fmtRelative, fmtMonthYear,
  dow, dayOfMonth, DOW_MIN, DOW_SHORT, DOW_LONG, daysInMonth, makeKey, year as yearOf, month as monthOf,
} from '../utils/date.js';
import { plural } from '../utils/fmt.js';
import { openSheet } from '../ui/sheet.js';
import { confirmSheet } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { emblem, momentIcon } from '../ui/mascot.js';
import { cycleRing } from '../ui/ring.js';
import { themePicker, setPickerSelection } from '../ui/theme-picker.js';
import { applyTheme } from '../ui/theme.js';
import {
  partnerModel, partnerDay, partnerDays, dayItems, isDue, laneWhen, nextRun, statusTip, freshStatus, icsFor, PHASE_WORDS,
} from '../domain/partner.js';
import { STATUSES } from '../data/partner-tips.js';
import { getShare } from '../storage/share.js';
import { pushSupport, subscribePush, registerPush, forgetPush } from '../storage/push.js';
import { pushPlan } from '../domain/push-plan.js';
import { getTheme } from '../data/themes.js';
import * as store from '../state/store.js';

/* ── Fetching ───────────────────────────────────────────────────────────── */

/** @type {'idle'|'loading'|'ok'|'offline'|'gone'} */
let fetchState = 'idle';
let lastFetch = 0;

/**
 * Fetch her latest summary and remember it. Quiet on failure: the last copy
 * stays on screen with a line saying it could not refresh.
 * @param {{force?: boolean}} [opts]
 */
export async function refreshPartner({ force = false } = {}) {
  const of = store.getState().settings.partnerOf;
  if (!of || fetchState === 'loading') return fetchState;
  if (!force && Date.now() - lastFetch < 60_000) return fetchState;
  fetchState = 'loading';
  lastFetch = Date.now();
  try {
    const got = await getShare(of);
    const latest = store.getState().settings.partnerOf;
    if (!latest || latest.id !== of.id) return fetchState = 'idle';
    if (!got) {
      store.updateSettings({ partnerOf: { ...latest, gone: true } });
      return fetchState = 'gone';
    }
    store.updateSettings({ partnerOf: { ...latest, snapshot: got.snapshot, fetchedAt: Date.now(), gone: false } });
    // Her dates may have moved: keep the notification times in step.
    void syncPush();
    return fetchState = 'ok';
  } catch {
    fetchState = 'offline';
    store.updateSettings({});
    return fetchState;
  }
}

/* ── Notifications ──────────────────────────────────────────────────────── */

/**
 * Keep the server's wake-up times in step with her latest summary. Resent
 * when the times change, and at least once a day so a quiet week does not
 * leave the server with an old schedule.
 * @param {{force?: boolean}} [opts]
 */
export async function syncPush({ force = false } = {}) {
  const { settings } = store.getState();
  const pp = settings.partnerPush;
  const of = settings.partnerOf;
  if (!pp || !of?.snapshot || of.gone) return;
  const plan = pushPlan(of.snapshot, pp, todayKey(), Date.now());
  const sent = JSON.stringify(plan.map((p) => p.at));
  if (!force && sent === pp.sent && Date.now() - pp.sentAt < 24 * 3600e3) {
    // Same times; the words may still have changed (her name, say).
    if (JSON.stringify(plan) !== JSON.stringify(pp.plan)) store.updateSettings({ partnerPush: { ...pp, plan } });
    return;
  }
  try {
    await registerPush(of.id, pp, plan.map((p) => p.at));
    const latest = store.getState().settings.partnerPush;
    if (latest) store.updateSettings({ partnerPush: { ...latest, plan, sent, sentAt: Date.now() } });
  } catch {
    const latest = store.getState().settings.partnerPush;
    if (latest) store.updateSettings({ partnerPush: { ...latest, plan } });
  }
}

/**
 * Turn one kind of heads-up on or off. The first one on asks the phone for
 * permission (it has to be from a tap); the last one off forgets this phone.
 * @param {'period'|'harder'} kind
 * @param {boolean} on
 */
async function setPush(kind, on) {
  const { settings } = store.getState();
  let pp = settings.partnerPush;
  const next = { period: pp?.period ?? false, harder: pp?.harder ?? false, [kind]: on };
  if (!next.period && !next.harder) {
    if (pp) await forgetPush(pp.endpoint);
    store.updateSettings({ partnerPush: null });
    return;
  }
  if (!pp) {
    const sub = await subscribePush().catch(() => null);
    if (!sub) {
      toast('Notifications are off for Kittycal. You can allow them in your phone’s settings.', { ms: 6000 });
      store.updateSettings({});
      return;
    }
    pp = { ...sub, period: false, harder: false, plan: [], sent: '', sentAt: 0 };
  }
  store.updateSettings({ partnerPush: { ...pp, ...next } });
  await syncPush({ force: true });
  const saved = store.getState().settings.partnerPush;
  if (on) toast(saved?.sentAt ? 'You’ll get a heads-up' : 'Saved. It’ll switch on when you’re online.');
}

/** The notification rows in his Settings. */
function notificationRows() {
  const { settings } = store.getState();
  const support = pushSupport();
  const snap = settings.partnerOf?.snapshot ?? null;
  const hasMood = Boolean(snap?.lanes.some((l) => l.kind === 'mood'));
  const pp = settings.partnerPush;
  const name = snap?.name ?? 'her';

  if (support === 'install') {
    return el('p', { class: 'hint-sm', text: 'On iPhone, add Kittycal to your Home Screen and open it from there to get heads-ups.' });
  }
  if (support === 'none') {
    return el('p', { class: 'hint-sm', text: 'This browser can’t show notifications.' });
  }
  /** @param {'period'|'harder'} kind @param {string} label @param {string} sub @param {boolean} [disabled] */
  const row = (kind, label, sub, disabled = false) => {
    const on = Boolean(pp?.[kind]);
    return el('div', { class: 'row' }, [
      el('span', { class: 'row-label' }, [label, el('span', { class: 'choice-sub', text: sub })]),
      el('button', {
        type: 'button', class: 'toggle', role: 'switch', 'aria-checked': String(on), 'aria-label': label,
        disabled: disabled || null,
        onclick: () => { haptic(8); void setPush(kind, !on); },
      }),
    ]);
  };
  const next = pp?.plan.find((p) => p.at > Date.now());
  return el('div', {}, [
    el('div', { class: 'rows' }, [
      row('period', `Before ${name === 'her' ? 'her' : `${name}’s`} period`, 'The evening before it’s likely to start'),
      row('harder', 'When harder days start', hasMood
        ? 'The morning they usually begin'
        : `${snap?.name ?? 'She'} hasn’t shared this`, !hasMood && !pp?.harder),
    ]),
    support === 'blocked' && !pp
      ? el('p', { class: 'hint-sm', text: 'Notifications are blocked for Kittycal. Allow them in your phone’s settings first.' })
      : next ? el('p', { class: 'hint-sm pa-next', text: `Next: ${new Date(next.at).toLocaleString([], {
        weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.` }) : null,
  ]);
}

/** The summary on this phone, if any. */
const current = () => store.getState().settings.partnerOf?.snapshot ?? null;

/** "Mia’s" or "her". */
const hers = (/** @type {Snapshot} */ snap) => (snap.name ? `${snap.name}’s` : 'her');
/** "Mia" or "she". */
const she = (/** @type {Snapshot} */ snap) => snap.name ?? 'she';

/**
 * Her character, in her colours, wherever it is drawn.
 * @param {Snapshot} snap
 * @param {number} size
 */
function herCharacter(snap, size) {
  const theme = snap.theme ?? 'plain';
  const art = emblem(theme, { size, className: 'her-art' });
  art.setAttribute('data-theme', theme);
  return art;
}

/* ── Today ──────────────────────────────────────────────────────────────── */

/** @param {HTMLElement} host */
export function renderPartnerToday(host) {
  const { settings } = store.getState();
  const of = settings.partnerOf;
  if (!of) { replace(host, []); return; }
  replace(host, [
    greeting(settings.name),
    of.gone ? goneCard(of.snapshot) : of.snapshot ? partnerToday(of.snapshot) : loadingCard(),
    of.gone ? null : freshness(of),
  ]);
}

/**
 * His Today for a summary. Exported for her share-sheet preview, which draws
 * the same thing from the summary she is about to send.
 *
 * @param {Snapshot} snap
 * @param {{preview?: boolean, now?: number}} [opts]
 */
export function partnerToday(snap, { preview = false, now = Date.now() } = {}) {
  const today = todayKey();
  const m = partnerModel(snap, today);
  const day = m.day;
  const status = freshStatus(snap, now);

  if (!day) {
    return el('div', { class: 'pa-today' }, [
      status ? statusBubble(snap, status) : null,
      el('div', { class: 'pa-quiet card' }, [
        herCharacter(snap, 64),
        el('h3', { text: 'Nothing to show right now' }),
        el('p', { class: 'hint', text: `${snap.name ?? 'Your partner'} will update this when there is.` }),
      ]),
    ]);
  }

  const due = isDue(snap, day, today);
  return el('div', { class: 'pa-today' }, [
    status ? statusBubble(snap, status) : null,
    ring(snap, day, due),
    phaseKey(snap, due ? null : day.phase),
    due ? phaseLine('due') : day.phase && snap.phase ? phaseLine(day.phase) : null,
    likelySection(snap, day, today),
    weekAhead(snap, today, preview),
    snap.helps ? el('section', { class: 'pa-section pa-note' }, [
      el('h3', { class: 'pa-h', text: `In ${hers(snap)} words` }),
      el('p', { class: 'pa-quote', text: snap.helps }),
    ]) : null,
  ]);
}

/** @param {string} name */
function greeting(name) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  return el('div', { class: 'today-greeting' }, [
    el('p', { class: 'hint-sm', text: 'TODAY' }),
    el('h2', { text: name ? `${part}, ${name}` : `Good ${part.toLowerCase()}` }),
  ]);
}

/**
 * What she told him, as her character saying it, with the one thing that
 * helps underneath.
 * @param {Snapshot} snap
 * @param {{id: string, at: number}} status
 */
function statusBubble(snap, status) {
  const s = STATUSES.find((x) => x.id === status.id);
  if (!s) return null;
  const at = new Date(status.at);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const tip = statusTip(s.id);
  return el('div', { class: 'pa-status', role: 'status' }, [
    el('span', { class: 'pa-status-who' }, [herCharacter(snap, 40)]),
    el('div', { class: 'pa-status-bubble' }, [
      el('span', { class: 'pa-status-from', text: `${snap.name ?? 'She'} · ${time}` }),
      el('span', { class: 'pa-status-text' }, [momentIcon(s.icon, 'pa-status-mark'), s.label]),
      tip ? el('span', { class: 'pa-status-tip', text: tip }) : null,
    ]),
  ]);
}

/**
 * Her cycle as the ring, with her character on today.
 * @param {Snapshot} snap
 * @param {PartnerDay} day
 * @param {boolean} due
 */
function ring(snap, day, due) {
  const len = Math.max(15, snap.cycleLength);
  const bleed = Math.max(1, snap.periodLength);
  const showPhases = snap.phase || snap.fertile;
  /** @type {any} */
  const pseudo = {
    avgCycleLength: len, avgPeriodLength: bleed, cycleDay: due ? 1 : Math.min(day.cycleDay, len),
    showFertility: snap.fertile, ovulation: snap.fertile ? day.next : null, nextStart: day.next,
    lutealDays: snap.lutealDays, fertileBefore: 5, onHormonal: false,
  };
  const onPeriod = day.period === 'logged';
  return cycleRing({
    prediction: pseudo,
    headline: due ? 'Due' : onPeriod ? String(day.cycleDay) : String(day.untilNext),
    caption: due ? `${hers(snap)} period, any day`
      : onPeriod ? `day of ${hers(snap)} period`
        : day.untilNext === 1 ? `day until ${hers(snap)} period` : `days until ${hers(snap)} period`,
    // The number already is the day of her period; saying it twice is noise.
    eyebrow: due || onPeriod ? undefined : `Day ${day.cycleDay}`,
    theme: snap.theme ?? 'plain',
    segments: showPhases ? undefined : [
      { id: 'menstrual', from: 0, to: bleed / len },
      { id: 'unknown', from: bleed / len, to: 1 },
    ],
  });
}

/**
 * Her month as spans of cycle days, in the ring's colours: what the ring
 * shows, and what Rhythm unrolls into a bar.
 * @param {Snapshot} snap
 * @returns {{id: 'period'|'follicular'|'fertile'|'luteal'|'unknown', from: number, to: number}[]}
 */
function phaseSpans(snap) {
  const len = Math.max(15, snap.cycleLength);
  const bleed = Math.min(len, Math.max(1, snap.periodLength));
  /** @type {ReturnType<typeof phaseSpans>} */
  const out = [{ id: 'period', from: 1, to: bleed }];
  if (!snap.phase && !snap.fertile) {
    out.push({ id: 'unknown', from: bleed + 1, to: len });
    return out;
  }
  const ov = len - snap.lutealDays;
  if (snap.fertile) {
    const a = Math.max(bleed + 1, ov - 5);
    const b = Math.min(len, ov + 1);
    if (a > bleed + 1) out.push({ id: 'follicular', from: bleed + 1, to: a - 1 });
    out.push({ id: 'fertile', from: a, to: b });
    if (b < len) out.push({ id: 'luteal', from: b + 1, to: len });
  } else {
    const l = Math.max(bleed + 1, ov + 1);
    out.push({ id: 'follicular', from: bleed + 1, to: l - 1 });
    out.push({ id: 'luteal', from: l, to: len });
  }
  return out.filter((x) => x.to >= x.from);
}

/**
 * The ring's colours, named, with today's in bold. Without this the ring is
 * three colours nobody explained.
 * @param {Snapshot} snap
 * @param {PartnerDay['phase']} now
 */
function phaseKey(snap, now) {
  if (!snap.phase && !snap.fertile) return null;
  return el('ul', { class: 'pa-key', 'aria-label': 'What the colours mean' }, phaseSpans(snap).map((x) =>
    el('li', { class: x.id === now ? 'is-now' : '' }, [
      el('span', { class: 'phase-dot', style: { background: `var(${PHASE_TOKEN[x.id]})` }, 'aria-hidden': 'true' }),
      SPAN_NAMES[x.id],
    ])));
}

const SPAN_NAMES = /** @type {const} */ ({
  period: 'Period', follicular: 'Follicular', fertile: 'Fertile', luteal: 'Luteal', unknown: 'Rest of cycle',
});

/** Words for a period that is due but not confirmed, said like a phase. */
const DUE_WORDS = {
  title: 'Period due',
  short: 'It could start any day now.',
  more: 'Her forecast says it’s about now, and her app hasn’t had a new start logged yet. '
    + 'Cycles move by a few days all the time, so this is normal. When it starts and she logs it, this updates.',
};

/**
 * The phase under the ring, built exactly like hers: the phase's colour, one
 * line, and the why behind a tap.
 * @param {import('../domain/partner.js').PartnerPhase|'due'} id
 */
function phaseLine(id) {
  const words = id === 'due' ? DUE_WORDS : PHASE_WORDS[id];
  const token = PHASE_TOKEN[id === 'due' ? 'period' : id];
  return el('div', { class: 'phase-line', style: { '--phase': `var(${token})` } }, [
    el('div', { class: 'phase-line-head' }, [
      el('span', { class: 'phase-dot', style: { background: `var(${token})` }, 'aria-hidden': 'true' }),
      el('h3', { text: words.title }),
    ]),
    el('details', { class: 'phase-more' }, [
      el('summary', { class: 'hint' }, [
        words.short,
        el('span', { class: 'phase-more-cue', 'aria-hidden': 'true', text: ' Why?' }),
      ]),
      el('p', { class: 'phase-more-body', text: words.more }),
    ]),
  ]);
}

/** Each phase's colour, the same tokens her ring uses. */
const PHASE_TOKEN = /** @type {const} */ ({
  period: '--period', follicular: '--follicular', fertile: '--ovulation', luteal: '--luteal', unknown: '--surface-2',
});

/**
 * "Likely today", when there is anything to say under it.
 * @param {Snapshot} snap @param {PartnerDay} day @param {DateKey} today
 */
function likelySection(snap, day, today) {
  const list = likelyList(snap, day, today);
  if (!list) return null;
  return el('section', { class: 'pa-section' }, [
    el('div', { class: 'pa-h-row' }, [el('h3', { class: 'pa-h', text: 'Likely today' }), basisLine(snap)]),
    list,
  ]);
}

/** "From Mia’s last 6 cycles", when there are patterns to be from. @param {Snapshot} snap */
function basisLine(snap) {
  const n = snap.tracked ?? snap.stats?.cycles ?? 0;
  return n && (snap.lanes.length || snap.easy)
    ? el('span', { class: 'hint-sm', text: `From ${hers(snap)} last ${plural(n, 'cycle')}` })
    : null;
}

/**
 * What is likely on a day: each thing, when it usually happens for her, and
 * one thing that helps.
 * @param {Snapshot} snap
 * @param {PartnerDay} day
 * @param {DateKey} today
 */
function likelyList(snap, day, today) {
  const items = dayItems(snap, day, today);
  if (!items.length) {
    // She shares no patterns: nothing to explain, and nothing to wait for.
    if (snap.tracked == null && !snap.lanes.length && !snap.easy) return null;
    const learning = !snap.lanes.length && !snap.easy && (snap.tracked ?? 0) < 3;
    return el('p', { class: 'hint', text: learning
      ? `Her patterns show up here once Kittycal has learned them from ${hers(snap)} check-ins. Rhythm shows how far along that is.`
      : `Nothing from ${hers(snap)} usual pattern lands ${day.date === today ? 'today' : 'that day'}.` });
  }
  return el('ul', { class: 'pa-items' }, items.map((it) => el('li', { class: `pa-item is-${toneOf(it.key)}` }, [
    el('span', { class: 'pa-item-icon' }, [momentIcon(it.icon, 'pa-item-mark')]),
    el('span', { class: 'pa-item-body' }, [
      el('span', { class: 'pa-item-title', text: it.title }),
      it.text ? el('span', { class: 'pa-item-text', text: it.text }) : null,
    ]),
  ])));
}

/** @param {string} key */
const toneOf = (key) => (key === 'period' || key === 'due' || key === 'soon' ? 'period'
  : key === 'harder-days' ? 'mood' : key === 'sleep' ? 'sleep' : key === 'easy' ? 'easy'
    : key === 'fertile' ? 'fertile' : 'body');

/**
 * How a day is drawn in the week strip and the calendar: one look per day,
 * the most important thing on it. A due period is drawn over its expected
 * days only; past them, while it is still due, nothing is known to draw.
 * @param {Snapshot} snap
 * @param {PartnerDay|null} d
 * @param {DateKey} today
 * @returns {'is-period'|'is-predicted'|'is-fertile'|'is-harder'|'is-easy'|null}
 */
function dayLook(snap, d, today) {
  if (!d) return null;
  if (d.period === 'logged') return 'is-period';
  if (d.period === 'expected') {
    return d.date >= today && daysBetween(d.next, d.date) < Math.max(1, snap.periodLength) ? 'is-predicted' : null;
  }
  if (d.phase === 'fertile') return 'is-fertile';
  if (d.lanes.some((l) => l.kind === 'mood')) return 'is-harder';
  if (d.easy) return 'is-easy';
  return null;
}

/** What each look means, in the order the legend lists them. */
const LOOKS = /** @type {const} */ ([
  ['is-period', 'Period'],
  ['is-predicted', 'Period likely'],
  ['is-fertile', 'Fertile'],
  ['is-harder', 'Harder days'],
  ['is-easy', 'Easier days'],
]);

/**
 * A legend for the looks actually on screen, so nothing is unexplained and
 * nothing is explained that isn't there.
 * @param {Set<string>} shown
 */
function looksLegend(shown) {
  const items = LOOKS.filter(([cls]) => shown.has(cls));
  if (!items.length) return null;
  return el('ul', { class: 'cal-legend pa-legend' }, items.map(([cls, label]) => el('li', {}, [
    el('span', { class: `cal-legend-swatch ${cls}`, 'aria-hidden': 'true' }), label,
  ])));
}

/**
 * Seven days, each in its look. Tap one for the detail.
 * @param {Snapshot} snap
 * @param {DateKey} today
 * @param {boolean} preview
 */
function weekAhead(snap, today, preview) {
  const days = partnerDays(snap, today, 7);
  if (!days.length) return null;
  const summary = weekSummary(snap, days, today);
  /** @type {Set<string>} */
  const shown = new Set();
  const pills = days.map((d) => {
    const look = dayLook(snap, d, today);
    if (look) shown.add(look);
    return el('button', {
      type: 'button',
      class: ['pa-day', d.date === today ? 'is-today' : '', look ?? ''].filter(Boolean).join(' '),
      'aria-label': `${fmtRelative(d.date)}: ${dayWords(snap, d, today)}`,
      disabled: preview || null,
      onclick: () => { haptic(8); openDay(snap, d, today); },
    }, [
      el('span', { class: 'pa-day-dow', 'aria-hidden': 'true', text: DOW_MIN[dow(d.date)] }),
      el('span', { class: 'pa-day-num', 'aria-hidden': 'true', text: String(dayOfMonth(d.date)) }),
    ]);
  });
  return el('section', { class: 'pa-section' }, [
    el('h3', { class: 'pa-h', text: 'The week ahead' }),
    el('div', { class: 'pa-week' }, pills),
    looksLegend(shown),
    summary ? el('p', { class: 'pa-week-note', text: summary }) : null,
  ]);
}

/**
 * One sentence for the coming week: the first thing worth knowing.
 * @param {Snapshot} snap
 * @param {PartnerDay[]} days
 * @param {DateKey} today
 */
function weekSummary(snap, days, today) {
  const name = (/** @type {PartnerDay} */ d) => (daysBetween(days[0].date, d.date) === 1 ? 'tomorrow' : `on ${DOW_LONG[dow(d.date)]}`);
  const Hers = cap(hers(snap));
  if (isDue(snap, days[0], today)) return `${Hers} period is due. It could start any day.`;
  const firstPeriod = days.find((d, i) => i > 0 && d.period === 'expected' && !days[i - 1].period);
  if (firstPeriod) return `${Hers} period is likely to start ${name(firstPeriod)}.`;
  const mood = days.find((d, i) => i > 0 && d.lanes.some((l) => l.kind === 'mood') && !days[i - 1].lanes.some((l) => l.kind === 'mood'));
  if (mood) return `Harder days usually start ${name(mood)}.`;
  const easy = days.find((d, i) => i > 0 && d.easy && !days[i - 1].easy);
  if (easy) return `${Hers} easier stretch usually starts ${name(easy)}.`;
  if (days[0].easy) return 'Usually one of her easier weeks. Good timing for plans.';
  return null;
}

const cap = (/** @type {string} */ s) => `${s[0].toUpperCase()}${s.slice(1)}`;

/**
 * What a day holds, in words, for screen readers.
 * @param {Snapshot} snap
 * @param {PartnerDay} d
 * @param {DateKey} today
 */
function dayWords(snap, d, today) {
  const items = dayItems(snap, d, today);
  return items.map((i) => i.title.toLowerCase()).join(', ') || `day ${d.cycleDay} of ${hers(snap)} cycle`;
}

/**
 * Where she will be on a day, and what is likely: the calendar's panel, and
 * the sheet a day in the week strip opens.
 * @param {Snapshot} snap
 * @param {PartnerDay} d
 * @param {DateKey} today
 */
function dayDetail(snap, d, today) {
  const due = isDue(snap, d, today);
  const phase = due ? null : d.phase && (snap.phase || d.phase === 'fertile' || d.phase === 'period') ? d.phase : null;
  return el('div', { class: 'pa-day-detail' }, [
    el('p', { class: 'pa-day-head' }, [
      phase ? el('span', { class: 'phase-dot', style: { background: `var(${PHASE_TOKEN[phase]})` }, 'aria-hidden': 'true' }) : null,
      due ? 'Her period is due'
        : `Day ${d.cycleDay} of ${hers(snap)} cycle${phase ? ` · ${PHASE_WORDS[phase].title}` : ''}`,
    ]),
    likelyList(snap, d, today),
    d.date > today ? el('p', { class: 'hint-sm', text: 'A forecast from her history, not a promise.' }) : null,
  ]);
}

/**
 * A day from the week strip, opened.
 * @param {Snapshot} snap
 * @param {PartnerDay} d
 * @param {DateKey} today
 */
function openDay(snap, d, today) {
  openSheet({ title: d.date === today ? 'Today' : fmtLong(d.date), body: [dayDetail(snap, d, today)] });
}

/** @param {import('../domain/model.js').PartnerOf} of */
function freshness(of) {
  const when = of.fetchedAt ? fmtRelative(keyOf(of.fetchedAt)).toLowerCase() : null;
  const name = of.snapshot?.name ?? 'she';
  return el('p', { class: 'hint-sm pa-foot' }, [
    fetchState === 'offline' ? 'Couldn’t refresh, so this is the last copy. ' : '',
    when ? `Checked ${when}. ` : '',
    `You only see what ${name} chose to share. `,
    el('button', {
      type: 'button', class: 'btn-link',
      onclick: async () => { haptic(); await refreshPartner({ force: true }); announce('Refreshed'); },
    }, ['Refresh']),
  ]);
}

function loadingCard() {
  return el('div', { class: 'card pa-quiet' }, [
    el('p', { text: fetchState === 'offline' ? 'Couldn’t load it. Check your connection and try again.' : 'Loading…' }),
  ]);
}

/** @param {Snapshot|null} snap */
function goneCard(snap) {
  return el('div', { class: 'card pa-quiet' }, [
    snap ? herCharacter(snap, 56) : null,
    el('h3', { text: `${snap?.name ?? 'Your partner'} has stopped sharing` }),
    el('p', { class: 'hint', text: 'If that was a mistake, they can share again and send you a new code.' }),
    el('button', {
      type: 'button', class: 'btn btn-secondary',
      onclick: () => { haptic(); disconnect(); },
    }, ['Remove from this phone']),
  ]);
}

/* ── Calendar ───────────────────────────────────────────────────────────── */

let shownMonth = /** @type {{y: number, m: number}|null} */ (null);
/** The day whose detail shows under the month. Today until he taps another. */
let picked = /** @type {DateKey|null} */ (null);

/** @param {HTMLElement} host */
export function renderPartnerCalendar(host) {
  const snap = current();
  if (!snap) { replace(host, [loadingCard()]); return; }
  const today = todayKey();
  if (!shownMonth) shownMonth = { y: yearOf(today), m: monthOf(today) };
  const { y, m } = shownMonth;
  const first = makeKey(y, m, 1);
  const count = daysInMonth(y, m);
  const lead = (dow(first) + 6) % 7;
  const model = partnerModel(snap, today);
  const sel = picked ?? today;

  /** @type {Set<string>} */
  const shown = new Set();
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(el('span', { class: 'cal-cell cal-cell-empty', 'aria-hidden': 'true' }));
  for (let n = 1; n <= count; n += 1) {
    const key = makeKey(y, m, n);
    const d = partnerDay(snap, key);
    const look = dayLook(snap, d, today);
    if (look) shown.add(look);
    const classes = ['cal-cell'];
    if (key === today) classes.push('is-today');
    if (key === sel) classes.push('is-selected');
    if (look) classes.push(look);
    cells.push(el('button', {
      type: 'button',
      class: classes.join(' '),
      'aria-label': d ? `${fmtLong(key)}: ${dayWords(snap, d, today)}` : fmtLong(key),
      'aria-pressed': String(key === sel),
      disabled: d ? null : true,
      onclick: () => { if (d) { haptic(8); picked = key; store.updateSettings({}); } },
    }, [el('span', { class: 'cal-num', text: String(n) })]));
  }

  const selDay = partnerDay(snap, sel);
  replace(host, [
    el('div', { class: 'cal-head' }, [
      el('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Previous month', text: '‹',
        onclick: () => { haptic(8); shift(-1); } }),
      el('h2', { class: 'cal-month', text: fmtMonthYear(y, m), 'aria-live': 'polite' }),
      el('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Next month', text: '›',
        onclick: () => { haptic(8); shift(1); } }),
    ]),
    el('div', { class: 'cal-grid', role: 'grid' }, [
      ...['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => el('span', { class: 'cal-dow', 'aria-hidden': 'true', text: x })),
      ...cells,
    ]),
    looksLegend(shown),
    selDay ? el('section', { class: 'card pa-picked', 'aria-live': 'polite' }, [
      el('h3', { class: 'pa-card-title', text: sel === today ? 'Today' : fmtLong(sel) }),
      dayDetail(snap, selDay, today),
      el('p', { class: 'hint-sm pa-picked-tip', text: 'Tap any day to see what’s likely.' }),
    ]) : null,
    comingPeriods(model, today),
  ]);
}

/** @param {number} by */
function shift(by) {
  if (!shownMonth) return;
  let { y, m } = shownMonth;
  m += by;
  if (m < 0) { m = 11; y -= 1; }
  if (m > 11) { m = 0; y += 1; }
  shownMonth = { y, m };
  store.updateSettings({});
}

/** @param {import('../domain/partner.js').PartnerModel} model */
function addToCalendarButton(model) {
  return el('button', {
    type: 'button', class: 'btn btn-secondary pa-ics',
    onclick: () => {
      haptic();
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
      const url = URL.createObjectURL(new Blob([icsFor(model, stamp)], { type: 'text/calendar' }));
      const a = el('a', { href: url, download: 'kittycal-periods.ics' });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
  }, ['Add her periods to my calendar']);
}

/* ── Rhythm ─────────────────────────────────────────────────────────────── */

/** @param {HTMLElement} host */
export function renderPartnerRhythm(host) {
  const snap = current();
  if (!snap) { replace(host, [loadingCard()]); return; }
  const today = todayKey();
  const model = partnerModel(snap, today);
  if (!model.day) { replace(host, [partnerToday(snap)]); return; }

  /*
    Rhythm answers one question: what is her month usually like, and how far
    can he plan on it. Dates (coming periods, add to calendar) are Calendar's;
    where she is today is Today's ring (PRODUCT.md, U3 to U5).
  */
  replace(host, [
    monthCard(snap, model.day, today),
    dependability(snap),
    snap.phase ? phaseGuide(snap, model.day, today) : null,
  ]);
}

/**
 * Her month, unrolled: the ring's colours as a bar with today on it, then
 * what usually happens when, each with the dates it lands on this time.
 * @param {Snapshot} snap
 * @param {PartnerDay} day
 * @param {DateKey} today
 */
function monthCard(snap, day, today) {
  const len = Math.max(15, snap.cycleLength);
  const bleed = Math.max(1, snap.periodLength);
  const due = isDue(snap, day, today);
  const at = due ? len : Math.min(len, day.cycleDay);
  const start = due ? addDays(day.next, -len) : day.start;

  /** @type {{key: string, icon: string, title: string, when: string, from: number, to: number, match: (d: PartnerDay) => boolean}[]} */
  const rows = [{ key: 'period', icon: '🩸', title: 'Period', when: `Usually ${plural(bleed, 'day')}`,
    from: 1, to: bleed,
    match: (d) => d.period === 'logged' || (d.period === 'expected' && daysBetween(d.next, d.date) < bleed) }];
  for (const lane of snap.lanes) {
    const from = lane.from > 0 ? lane.from : len + lane.from + 1;
    const to = lane.to > 0 ? lane.to : len + lane.to + 1;
    rows.push({
      key: lane.kind === 'mood' ? 'harder-days' : lane.kind === 'sleep' ? 'sleep' : lane.id,
      icon: lane.kind === 'mood' ? '💭' : lane.kind === 'sleep' ? '🌙' : lane.id,
      title: lane.label,
      when: laneWhen(lane, bleed),
      from: Math.max(1, from), to: Math.min(len, to),
      match: (d) => d.lanes.some((l) => l.id === lane.id),
    });
  }
  if (snap.easy) {
    const easy = snap.easy;
    rows.push({ key: 'easy', icon: '🌟', title: 'Easier days', when: laneWhen(easy, bleed),
      from: easy.from, to: Math.min(len, easy.to), match: (d) => d.easy });
  }
  if (snap.fertile) {
    const f = phaseSpans(snap).find((x) => x.id === 'fertile');
    if (f) rows.push({ key: 'fertile', icon: '🌷', title: 'Fertile window', when: `Usually days ${f.from} to ${f.to} of her cycle`,
      from: f.from, to: f.to, match: (d) => d.phase === 'fertile' });
  }
  // In the order they happen, so it reads like her month.
  rows.sort((a, b) => a.from - b.from || (a.key === 'period' ? -1 : b.key === 'period' ? 1 : a.to - b.to));

  const patterns = rows.length > 1;
  const n = snap.tracked ?? snap.stats?.cycles ?? 0;
  return el('section', { class: 'card pa-month' }, [
    el('h3', { class: 'pa-card-title', text: 'What usually happens when' }),
    el('p', { class: 'hint-sm', text: patterns
      ? `From ${hers(snap)} last ${plural(n || 1, 'cycle')}. Each bar is her month, from one period to the next; the line is today.`
      : `Her period, and the patterns Kittycal finds in ${hers(snap)} check-ins.` }),
    patterns ? el('ul', { class: 'pa-when' }, rows.map((r) => {
      // While her period is due, every date after it is a guess on a guess:
      // say when each thing usually comes, not a date it will not keep.
      if (due) {
        const withPeriod = r.key === 'period' || r.from <= bleed;
        return whenRow(r, at, len, withPeriod ? 'Due' : null,
          `${r.when}.${withPeriod && r.key !== 'period' ? ' Expected with her period, which is due.' : r.key === 'period' ? ' It’s due now.' : ''}`, withPeriod);
      }
      const run = nextRun(snap, r.match, start, today);
      const now = Boolean(run && run.from <= today && run.to >= today);
      const until = run ? daysBetween(today, run.from) : null;
      return whenRow(r, at, len,
        run ? (now ? 'Now' : until === 1 ? 'Tomorrow' : `In ${until} days`) : null,
        run ? `${r.when}. ${now ? `Until ${dayAndDate(run.to)}` : `Next: ${spanText(run)}`}.` : `${r.when}.`,
        now);
    })) : patternsProgress(snap),
  ]);
}

/**
 * One row of "what usually happens when", with its place in her month.
 * @param {{key: string, icon: string, title: string, from: number, to: number}} r
 * @param {number} at  today's cycle day
 * @param {number} len
 * @param {string|null} badge
 * @param {string} text
 * @param {boolean} now
 */
function whenRow(r, at, len, badge, text, now) {
  const left = `${((r.from - 1) / len) * 100}%`;
  const width = `${((r.to - r.from + 1) / len) * 100}%`;
  return el('li', { class: `pa-when-row is-${toneOf(r.key)}${now ? ' is-now' : ''}` }, [
    el('span', { class: 'pa-item-icon' }, [momentIcon(r.icon, 'pa-item-mark')]),
    el('span', { class: 'pa-when-body' }, [
      el('span', { class: 'pa-when-top' }, [
        el('span', { class: 'pa-item-title', text: r.title }),
        badge ? el('span', { class: `badge${now ? ' badge-primary' : ''}`, text: badge }) : null,
      ]),
      el('span', { class: 'pa-item-text', text }),
      el('span', { class: 'pa-when-track', 'aria-hidden': 'true', style: { '--at': String((at - 0.5) / len) } }, [
        el('span', { class: 'pa-when-bar', style: { left, width } }),
      ]),
    ]),
  ]);
}

/** @param {DateKey} key */
const dayAndDate = (key) => `${DOW_SHORT[dow(key)]} ${fmtDayMonth(key)}`;
/** @param {{from: DateKey, to: DateKey}} run */
const spanText = (run) => (run.from === run.to ? dayAndDate(run.from) : `${dayAndDate(run.from)} to ${dayAndDate(run.to)}`);

/**
 * When there are no patterns to show, why, and how far along they are.
 * @param {Snapshot} snap
 */
function patternsProgress(snap) {
  const name = snap.name ?? 'She';
  const n = snap.tracked;
  if (n == null) {
    return el('p', { class: 'hint pa-progress', text: `${name} hasn’t shared her patterns. Her period and phases above are still her own.` });
  }
  if (n < 3) {
    return el('div', { class: 'pa-progress' }, [
      el('h4', { class: 'pa-when-h', text: 'Her patterns are on the way' }),
      el('div', { class: 'pa-progress-dots', role: 'img', 'aria-label': `${n} of 3 cycles` }, [0, 1, 2].map((i) =>
        el('span', { class: i < n ? 'is-done' : '' }))),
      el('p', { class: 'hint', text: `Kittycal learns things like when her cramps or harder days usually come from her daily check-ins. `
        + `It needs three full cycles of them; ${name} has ${n === 0 ? 'none finished yet' : `${n} so far`}. `
        + 'Periods she entered from memory don’t count, since there’s nothing logged in them.' }),
    ]);
  }
  return el('p', { class: 'hint pa-progress', text: `Nothing repeats clearly yet. ${name}’s check-ins don’t show anything landing at the same point each month. That can change as she logs more.` });
}

/**
 * How far ahead he can plan on her dates, said once, as the finding.
 *
 * This was four tiles: days per cycle, days of period, "Regular", and "4 of
 * 4". Two repeated other lines (the Period row already says how long it
 * lasts), and none of them was the thing he wants from them, which is whether
 * he can book the 18th (PRODUCT.md, U4).
 * @param {Snapshot} snap
 */
function dependability(snap) {
  const s = snap.stats;
  if (!s) return null;
  const title = s.regularity === 'regular' ? 'Her dates are dependable'
    : s.regularity === 'variable' ? 'Her dates can move a few days'
      : s.regularity === 'irregular' ? 'Her dates vary a lot'
        : 'How dependable her dates are';
  const range = s.min !== s.max
    ? `Her cycles run ${s.min} to ${s.max} days, usually about ${snap.cycleLength}.`
    : `Her cycles run about ${snap.cycleLength} days.`;
  const record = s.total
    ? ` ${s.hits} of her last ${s.total} forecasts were right to within 2 days.`
    : s.cycles < 3 ? ' With more cycles behind it, the forecast gets tighter.' : '';
  const advice = s.regularity === 'regular' ? ' Plans a few weeks out are a safe bet.'
    : s.regularity ? ' For anything that matters, leave a few days either side.' : '';
  return el('section', { class: 'card pa-dependable' }, [
    el('h3', { class: 'pa-card-title', text: title }),
    el('p', { class: 'hint', text: `${range}${record}${advice}` }),
  ]);
}

/**
 * @param {import('../domain/partner.js').PartnerModel} model
 * @param {DateKey} today
 */
function comingPeriods(model, today) {
  if (!model.upcoming.length) return null;
  return el('section', { class: 'card pa-coming' }, [
    el('h3', { class: 'pa-card-title', text: 'Coming periods' }),
    el('p', { class: 'hint-sm', text: 'Forecasts. They can move by a few days.' }),
    el('ul', { class: 'pa-coming-list' }, model.upcoming.map((p) => {
      const until = daysBetween(today, p.start);
      return el('li', {}, [
        el('span', { text: `${dayAndDate(p.start)} to ${dayAndDate(p.end)}` }),
        el('span', { class: 'badge', text: until <= 0 ? 'Due' : until === 1 ? 'Tomorrow' : `In ${until} days` }),
      ]);
    })),
    addToCalendarButton(model),
  ]);
}

/**
 * The four phases, for him, with the current one marked.
 * @param {Snapshot} snap
 * @param {PartnerDay} day
 * @param {DateKey} today
 */
function phaseGuide(snap, day, today) {
  const ids = /** @type {const} */ (['period', 'follicular', 'fertile', 'luteal']);
  const nowId = isDue(snap, day, today) ? null : day.phase;
  return el('section', { class: 'pa-section' }, [
    el('h3', { class: 'pa-h', text: 'Her cycle, phase by phase' }),
    el('div', { class: 'pa-phases' }, ids.filter((id) => id !== 'fertile' || snap.fertile).map((id) =>
      el('details', { class: `pa-phase${nowId === id ? ' is-now' : ''}` }, [
        el('summary', {}, [
          el('span', { class: 'pa-phase-row' }, [
            el('span', { class: 'phase-dot', style: { background: `var(${PHASE_TOKEN[id]})` }, 'aria-hidden': 'true' }),
            el('span', { class: 'pa-phase-title', text: PHASE_WORDS[id].title }),
            nowId === id ? el('span', { class: 'badge badge-primary', text: 'Now' }) : null,
          ]),
          el('span', { class: 'pa-phase-short' }, [
            PHASE_WORDS[id].short,
            el('span', { class: 'phase-more-cue', 'aria-hidden': 'true', text: ' Why?' }),
          ]),
        ]),
        el('p', { class: 'hint', text: PHASE_WORDS[id].more }),
      ]))),
  ]);
}

/* ── Settings ───────────────────────────────────────────────────────────── */

/** @param {HTMLElement} host */
export function renderPartnerSettings(host) {
  const { settings } = store.getState();
  const of = settings.partnerOf;
  const snap = of?.snapshot ?? null;
  const herTheme = snap?.theme ?? null;

  const grid = themePicker({
    selected: settings.theme,
    onPick: (id) => {
      haptic(8);
      setPickerSelection(grid, id);
      store.updateSettings({ theme: id });
      applyTheme(id, store.getState().settings.colorMode);
    },
  });

  replace(host, [
    of ? el('section', { class: 'card pa-connection' }, [
      el('div', { class: 'pa-connection-head' }, [
        snap ? el('span', { class: 'pa-status-who' }, [herCharacter(snap, 40)]) : null,
        el('div', {}, [
          el('h3', { text: snap?.name ? `${snap.name}’s cycle` : 'Your partner’s cycle' }),
          el('p', { class: 'hint-sm', text: of.gone ? 'Stopped sharing'
            : of.fetchedAt ? `Checked ${fmtRelative(keyOf(of.fetchedAt)).toLowerCase()}` : 'Not loaded yet' }),
        ]),
      ]),
      of.code ? el('div', { class: 'pa-code-line' }, [
        el('span', { class: 'hint-sm', text: 'Her code' }),
        el('span', { class: 'pa-code num', text: of.code }),
        el('span', { class: 'hint-sm', text: 'To follow her on another phone too, enter it there.' }),
      ]) : null,
      el('div', { class: 'pa-connection-actions' }, [
        el('button', { type: 'button', class: 'btn btn-secondary',
          onclick: async () => { haptic(); await refreshPartner({ force: true }); toast('Up to date'); } }, ['Refresh']),
        el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { haptic(); void askDisconnect(); } },
          ['Disconnect']),
      ]),
    ]) : null,

    of && !of.gone ? el('h3', { class: 'section-label', text: 'Heads-ups' }) : null,
    of && !of.gone ? notificationRows() : null,

    el('h3', { class: 'section-label', text: 'Look' }),
    herTheme ? el('p', { class: 'hint-sm pa-theme-note', text:
      `${snap?.name ?? 'She'} uses ${getTheme(herTheme).name}. Her character marks her cycle whichever look you pick.` }) : null,
    grid,
    el('div', { class: 'rows' }, [
      el('label', { class: 'row' }, [
        el('span', { class: 'row-label', text: 'Colour mode' }),
        el('select', {
          class: 'input', style: { width: 'auto' },
          onchange: (/** @type {Event} */ e) => {
            const v = /** @type {any} */ (/** @type {HTMLSelectElement} */ (e.target).value);
            store.updateSettings({ colorMode: v });
            applyTheme(store.getState().settings.theme, v);
          },
        }, [['auto', 'Match my phone'], ['light', 'Always light'], ['dark', 'Always dark']].map(([v, label]) =>
          el('option', { value: v, selected: settings.colorMode === v || null, text: label }))),
      ]),
      el('label', { class: 'row' }, [
        el('span', { class: 'row-label', text: 'Your name' }),
        el('input', {
          class: 'input', style: { width: '10rem' }, value: settings.name, maxlength: '40', placeholder: 'Optional',
          onchange: (/** @type {Event} */ e) => store.updateSettings({ name: /** @type {HTMLInputElement} */ (e.target).value.trim() }),
        }),
      ]),
    ]),

    el('h3', { class: 'section-label', text: 'This phone' }),
    el('div', { class: 'rows' }, [
      el('button', { type: 'button', class: 'row', onclick: () => { haptic(); void switchToOwnCycle(); } }, [
        el('span', { class: 'row-label' }, ['Track my own cycle instead',
          el('span', { class: 'choice-sub', text: 'Switches this phone to the period tracker. Her view stays connected.' })]),
        el('span', { class: 'row-value', 'aria-hidden': 'true', text: '›' }),
      ]),
    ]),
    el('p', { class: 'hint-sm pa-foot', text:
      'Nothing about you is sent anywhere. This phone only downloads the summary she shares, '
      + 'encrypted, and unlocks it with the code.' }),
  ]);
}

async function askDisconnect() {
  const name = store.getState().settings.partnerOf?.snapshot?.name ?? 'her';
  const yes = await confirmSheet({
    title: `Disconnect from ${name === 'her' ? 'her' : `${name}’s`} cycle?`,
    body: ['This phone forgets the code. You can connect again with the code or link she sends.'],
    confirmLabel: 'Disconnect',
    danger: true,
  });
  if (yes) disconnect();
}

function disconnect() {
  const pp = store.getState().settings.partnerPush;
  if (pp) void forgetPush(pp.endpoint);
  store.updateSettings({ partnerOf: null, partnerPush: null });
  announce('Disconnected');
  location.reload();
}

async function switchToOwnCycle() {
  const yes = await confirmSheet({
    title: 'Track your own cycle?',
    body: ['This phone becomes a period tracker for you. You can switch back to her view from Settings.'],
    confirmLabel: 'Switch',
  });
  if (!yes) return;
  store.updateSettings({ role: 'self' });
  await store.flushNow();
  location.reload();
}

/* ── Bits ───────────────────────────────────────────────────────────────── */

/** @param {number} ms */
function keyOf(ms) {
  const d = new Date(ms);
  return /** @type {DateKey} */ (
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

/** The tab bar's labels in partner mode. */
export const PARTNER_TABS = /** @type {const} */ ({
  today: 'Today', calendar: 'Calendar', insights: 'Rhythm', settings: 'Settings',
});

/** The header title for a tab. */
export function partnerTitle(/** @type {string} */ view) {
  const snap = current();
  if (view === 'calendar') return 'Calendar';
  if (view === 'insights') return snap?.name ? `${snap.name}’s rhythm` : 'Her rhythm';
  if (view === 'settings') return 'Settings';
  return 'Kittycal';
}

