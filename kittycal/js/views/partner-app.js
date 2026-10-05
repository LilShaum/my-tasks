// @ts-check
/**
 * partner-app.js — Kittycal for the person she shares with.
 *
 * His phone does not track a cycle. It follows hers, from the encrypted
 * summary she chose to share, and turns it into four screens of his own:
 *
 *   - Today: where she is, what her own patterns say is likely today, two or
 *     three things he can actually do, and the week ahead at a glance.
 *   - Calendar: her coming periods and phases, for planning.
 *   - Rhythm: her typical month as a picture, and the numbers behind it.
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
  todayKey, daysBetween, fmtDayMonth, fmtLong, fmtRelative, fmtMonthYear,
  dow, dayOfMonth, DOW_MIN, DOW_SHORT, daysInMonth, makeKey, year as yearOf, month as monthOf,
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
  partnerModel, partnerDay, partnerDays, helpFor, freshStatus, icsFor, PHASE_WORDS,
} from '../domain/partner.js';
import { STATUSES } from '../data/partner-tips.js';
import { getShare } from '../storage/share.js';
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
    return fetchState = 'ok';
  } catch {
    fetchState = 'offline';
    store.updateSettings({});
    return fetchState;
  }
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

  const help = helpFor(day, status, today);
  return el('div', { class: 'pa-today' }, [
    status ? statusBubble(snap, status) : null,
    ring(snap, day),
    day.phase ? phaseLine(day.phase) : null,
    likelyToday(snap, day),
    help.length ? el('section', { class: 'pa-section' }, [
      el('h3', { class: 'pa-h', text: 'How you can help' }),
      el('ul', { class: 'pa-help' }, help.map((h) => el('li', {}, [
        el('span', { class: 'pa-help-icon' }, [momentIcon(h.icon, 'pa-help-mark')]),
        el('span', { text: h.text }),
      ]))),
    ]) : null,
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
 * What she told him, as her character saying it.
 * @param {Snapshot} snap
 * @param {{id: string, at: number}} status
 */
function statusBubble(snap, status) {
  const s = STATUSES.find((x) => x.id === status.id);
  if (!s) return null;
  const at = new Date(status.at);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return el('div', { class: 'pa-status', role: 'status' }, [
    el('span', { class: 'pa-status-who' }, [herCharacter(snap, 40)]),
    el('div', { class: 'pa-status-bubble' }, [
      el('span', { class: 'pa-status-from', text: `${snap.name ?? 'She'} · ${time}` }),
      el('span', { class: 'pa-status-text' }, [momentIcon(s.icon, 'pa-status-mark'), s.label]),
    ]),
  ]);
}

/**
 * Her cycle as the ring, with her character on today.
 * @param {Snapshot} snap
 * @param {PartnerDay} day
 */
function ring(snap, day) {
  const len = Math.max(15, snap.cycleLength);
  const bleed = Math.max(1, snap.periodLength);
  const showPhases = snap.phase || snap.fertile;
  /** @type {any} */
  const pseudo = {
    avgCycleLength: len, avgPeriodLength: bleed, cycleDay: Math.min(day.cycleDay, len),
    showFertility: snap.fertile, ovulation: snap.fertile ? day.next : null, nextStart: day.next,
    lutealDays: snap.lutealDays, fertileBefore: 5, onHormonal: false,
  };
  const value = day.period === 'logged' ? String(day.cycleDay)
    : day.period === 'expected' && day.untilNext <= 0 ? 'Due'
      : day.period === 'expected' ? String(day.cycleDay)
        : String(day.untilNext);
  const caption = day.period === 'logged' ? `day of ${hers(snap)} period`
    : day.period === 'expected' && day.untilNext <= 0 ? `${hers(snap)} period, any day`
      : day.period === 'expected' ? `day of ${hers(snap)} expected period`
        : day.untilNext === 1 ? `day until ${hers(snap)} period` : `days until ${hers(snap)} period`;
  return cycleRing({
    prediction: pseudo,
    headline: value,
    caption,
    eyebrow: `Day ${day.cycleDay}`,
    theme: snap.theme ?? 'plain',
    segments: showPhases ? undefined : [
      { id: 'menstrual', from: 0, to: bleed / len },
      { id: 'unknown', from: bleed / len, to: 1 },
    ],
  });
}

/**
 * The phase under the ring, built exactly like hers: the phase's colour, one
 * line, and the why behind a tap.
 * @param {import('../domain/partner.js').PartnerPhase} id
 */
function phaseLine(id) {
  const words = PHASE_WORDS[id];
  const token = PHASE_TOKEN[id];
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
  period: '--period', follicular: '--follicular', fertile: '--ovulation', luteal: '--luteal',
});

/**
 * The chips: what her own logs say is likely today.
 * @param {Snapshot} snap
 * @param {PartnerDay} day
 */
function likelyToday(snap, day) {
  /** @type {{icon: string, label: string, tone: string}[]} */
  const chips = [];
  if (day.period === 'logged') chips.push({ icon: '🩸', label: `Period, day ${day.cycleDay}`, tone: 'period' });
  else if (day.period === 'expected') chips.push({ icon: '🩸', label: 'Period expected', tone: 'period' });
  for (const lane of day.lanes) {
    chips.push({
      icon: lane.kind === 'mood' ? '💭' : lane.kind === 'sleep' ? '🌙' : lane.id,
      label: lane.label,
      tone: lane.kind,
    });
  }
  if (day.easy) chips.push({ icon: '🌟', label: 'One of her easier days', tone: 'easy' });
  if (day.phase === 'fertile') chips.push({ icon: '🌷', label: 'Fertile window', tone: 'fertile' });

  const basis = snap.stats?.cycles ? `From ${hers(snap)} last ${plural(snap.stats.cycles, 'cycle')}` : null;
  return el('section', { class: 'pa-section' }, [
    el('div', { class: 'pa-h-row' }, [
      el('h3', { class: 'pa-h', text: 'Likely today' }),
      basis && snap.lanes.length ? el('span', { class: 'hint-sm', text: basis }) : null,
    ]),
    chips.length
      ? el('ul', { class: 'pa-chips' }, chips.map((c) => el('li', { class: `pa-chip is-${c.tone}` }, [
        momentIcon(c.icon, 'pa-chip-mark'), c.label,
      ])))
      : el('p', { class: 'hint', text: snap.lanes.length
        ? `Nothing from ${hers(snap)} usual pattern lands today.`
        : `${snap.name ?? 'She'} hasn’t shared patterns yet, or there isn’t enough history for any.` }),
  ]);
}

/**
 * Seven days, each with what is expected on it. Tap one for the detail.
 * @param {Snapshot} snap
 * @param {DateKey} today
 * @param {boolean} preview
 */
function weekAhead(snap, today, preview) {
  const days = partnerDays(snap, today, 7);
  if (!days.length) return null;
  const summary = weekSummary(snap, days);
  return el('section', { class: 'pa-section' }, [
    el('h3', { class: 'pa-h', text: 'The week ahead' }),
    el('div', { class: 'pa-week' }, days.map((d) => dayPill(snap, d, today, preview))),
    summary ? el('p', { class: 'pa-week-note', text: summary }) : null,
  ]);
}

/**
 * @param {Snapshot} snap
 * @param {PartnerDay} d
 * @param {DateKey} today
 * @param {boolean} preview
 */
function dayPill(snap, d, today, preview) {
  const classes = ['pa-day'];
  if (d.date === today) classes.push('is-today');
  if (d.period === 'logged') classes.push('is-period');
  else if (d.period === 'expected') classes.push('is-expected');
  else if (d.phase === 'fertile') classes.push('is-fertile');
  else if (d.easy) classes.push('is-easy');
  const kinds = [...new Set(d.lanes.map((l) => l.kind))];
  return el('button', {
    type: 'button',
    class: classes.join(' '),
    'aria-label': `${fmtRelative(d.date)}: ${dayWords(snap, d)}`,
    disabled: preview || null,
    onclick: () => { haptic(8); openDay(snap, d); },
  }, [
    el('span', { class: 'pa-day-dow', 'aria-hidden': 'true', text: DOW_MIN[dow(d.date)] }),
    el('span', { class: 'pa-day-num', 'aria-hidden': 'true', text: String(dayOfMonth(d.date)) }),
    el('span', { class: 'pa-day-dots', 'aria-hidden': 'true' },
      kinds.slice(0, 3).map((k) => el('span', { class: `pa-dot is-${k}` }))),
  ]);
}

/**
 * One sentence for the coming week: the first thing worth knowing.
 * @param {Snapshot} snap
 * @param {PartnerDay[]} days
 */
function weekSummary(snap, days) {
  const name = (/** @type {PartnerDay} */ d) => (daysBetween(days[0].date, d.date) === 1 ? 'tomorrow' : DOW_SHORT[dow(d.date)]);
  const firstPeriod = days.find((d, i) => i > 0 && d.period === 'expected' && !days[i - 1].period);
  if (firstPeriod) return `${snap.name ? `${snap.name}’s` : 'Her'} period is likely to start ${name(firstPeriod) === 'tomorrow' ? 'tomorrow' : `on ${name(firstPeriod)}`}.`;
  const mood = days.find((d, i) => i > 0 && d.lanes.some((l) => l.kind === 'mood') && !days[i - 1].lanes.some((l) => l.kind === 'mood'));
  if (mood) return `Harder days usually start around ${name(mood)}.`;
  const easy = days.find((d, i) => i > 0 && d.easy && !days[i - 1].easy);
  if (easy) return `${hers(snap)[0].toUpperCase()}${hers(snap).slice(1)} easier stretch usually starts ${name(easy) === 'tomorrow' ? 'tomorrow' : `on ${name(easy)}`}.`;
  if (days[0].easy) return 'Usually one of her easier weeks. Good timing for plans.';
  return null;
}

/**
 * What a day holds, in words.
 * @param {Snapshot} snap
 * @param {PartnerDay} d
 */
function dayWords(snap, d) {
  /** @type {string[]} */
  const bits = [];
  if (d.period === 'logged') bits.push(`day ${d.cycleDay} of ${hers(snap)} period`);
  else if (d.period === 'expected') bits.push('period expected');
  else if (d.phase) bits.push(PHASE_WORDS[d.phase].title.toLowerCase());
  for (const l of d.lanes) bits.push(`${l.label.toLowerCase()} likely`);
  if (d.easy) bits.push('usually an easier day');
  return bits.join(', ') || `day ${d.cycleDay} of ${hers(snap)} cycle`;
}

/**
 * A day, opened from the week strip or the calendar.
 * @param {Snapshot} snap
 * @param {PartnerDay} d
 */
function openDay(snap, d) {
  const help = helpFor(d, null, d.date, 2);
  openSheet({
    title: fmtLong(d.date),
    body: [
      el('p', { class: 'pa-day-head' }, [
        d.phase ? el('span', { class: 'phase-dot', style: {
          background: `var(${PHASE_TOKEN[d.phase]})`,
        }, 'aria-hidden': 'true' }) : null,
        `Day ${d.cycleDay} of ${hers(snap)} cycle`,
        d.phase ? ` · ${PHASE_WORDS[d.phase].title}` : '',
      ]),
      likelyToday(snap, d),
      help.length ? el('ul', { class: 'pa-help' }, help.map((h) => el('li', {}, [
        el('span', { class: 'pa-help-icon' }, [momentIcon(h.icon, 'pa-help-mark')]),
        el('span', { text: h.text }),
      ]))) : null,
      el('p', { class: 'hint-sm', text: 'A forecast from her history, not a promise.' }),
    ],
  });
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

  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(el('span', { class: 'cal-cell cal-cell-empty', 'aria-hidden': 'true' }));
  for (let n = 1; n <= count; n += 1) {
    const key = makeKey(y, m, n);
    const d = partnerDay(snap, key);
    const classes = ['cal-cell'];
    if (key === today) classes.push('is-today');
    if (d?.period === 'logged') classes.push('is-period');
    else if (d?.period === 'expected' && key > today) classes.push('is-predicted');
    else if (d?.phase === 'fertile') classes.push('is-fertile');
    else if (d?.easy) classes.push('is-easy');
    const kinds = d ? [...new Set(d.lanes.map((l) => l.kind))] : [];
    cells.push(el('button', {
      type: 'button',
      class: classes.join(' '),
      'aria-label': d ? `${fmtLong(key)}: ${dayWords(snap, d)}` : fmtLong(key),
      disabled: d ? null : true,
      onclick: () => { if (d) { haptic(8); openDay(snap, d); } },
    }, [
      el('span', { class: 'cal-num', text: String(n) }),
      kinds.length ? el('span', { class: 'pa-day-dots', 'aria-hidden': 'true' },
        kinds.slice(0, 3).map((k) => el('span', { class: `pa-dot is-${k}` }))) : null,
    ]));
  }

  const kindsShown = new Set(snap.lanes.map((l) => l.kind));
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
    el('ul', { class: 'cal-legend' }, [
      legend('is-period', 'Period'),
      legend('is-predicted', 'Expected'),
      snap.fertile ? legend('is-fertile', 'Fertile') : null,
      snap.easy ? legend('is-easy', 'Easier days') : null,
      kindsShown.has('body') ? dotLegend('body', 'Usual symptoms') : null,
      kindsShown.has('mood') ? dotLegend('mood', 'Harder days') : null,
      kindsShown.has('sleep') ? dotLegend('sleep', 'Shorter sleep') : null,
    ]),
    model.upcoming.length ? addToCalendarButton(model) : null,
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

/** @param {string} cls @param {string} label */
const legend = (cls, label) => el('li', {}, [
  el('span', { class: `cal-legend-swatch ${cls}`, 'aria-hidden': 'true' }), label,
]);
/** @param {string} kind @param {string} label */
const dotLegend = (kind, label) => el('li', {}, [
  el('span', { class: `pa-dot is-${kind}`, 'aria-hidden': 'true' }), label,
]);

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
  }, ['Add to my calendar']);
}

/* ── Rhythm ─────────────────────────────────────────────────────────────── */

/** @param {HTMLElement} host */
export function renderPartnerRhythm(host) {
  const snap = current();
  if (!snap) { replace(host, [loadingCard()]); return; }
  const today = todayKey();
  const model = partnerModel(snap, today);
  if (!model.day) { replace(host, [partnerToday(snap)]); return; }

  replace(host, [
    typicalMonth(snap, model.day),
    statTiles(snap),
    comingPeriods(model, today),
    snap.phase ? phaseGuide(snap, model.day) : null,
  ]);
}

/**
 * Her month as lanes: where each thing usually lands, and where today is.
 * @param {Snapshot} snap
 * @param {PartnerDay} day
 */
function typicalMonth(snap, day) {
  const len = Math.max(15, snap.cycleLength);
  const bleed = Math.max(1, snap.periodLength);
  /** @type {{label: string, icon: string, tone: string, from: number, to: number}[]} */
  const rows = [{ label: 'Period', icon: '🩸', tone: 'period', from: 1, to: bleed }];
  if (snap.fertile) {
    const ov = len - snap.lutealDays;
    rows.push({ label: 'Fertile', icon: '🌷', tone: 'fertile', from: Math.max(bleed + 1, ov - 5), to: ov + 1 });
  }
  for (const lane of snap.lanes) {
    const from = lane.from > 0 ? lane.from : len + lane.from + 1;
    const to = lane.to > 0 ? lane.to : len + lane.to + 1;
    rows.push({
      label: lane.label,
      icon: lane.kind === 'mood' ? '💭' : lane.kind === 'sleep' ? '🌙' : lane.id,
      tone: lane.kind,
      from: Math.max(1, from), to: Math.min(len, to),
    });
  }
  if (snap.easy) rows.push({ label: 'Easier days', icon: '🌟', tone: 'easy', from: snap.easy.from, to: Math.min(len, snap.easy.to) });
  // In the order they happen, so the chart reads left to right like her month.
  rows.sort((a, b) => a.from - b.from || (a.tone === 'period' ? -1 : b.tone === 'period' ? 1 : a.to - b.to));

  const at = Math.min(len, day.cycleDay);
  const pct = (/** @type {number} */ n) => `${((n - 1) / len) * 100}%`;
  const width = (/** @type {number} */ a, /** @type {number} */ b) => `${((b - a + 1) / len) * 100}%`;

  return el('section', { class: 'card pa-month' }, [
    el('h3', { class: 'pa-card-title', text: `${snap.name ? `${snap.name}’s` : 'Her'} typical month` }),
    el('p', { class: 'hint-sm', text: snap.stats?.cycles
      ? `From her last ${plural(snap.stats.cycles, 'cycle')}. Today is day ${day.cycleDay}.`
      : `Today is day ${day.cycleDay}.` }),
    el('div', { class: 'pa-lanes', style: { '--today-frac': String((at - 0.5) / len) } }, [
      ...rows.map((r) => el('div', { class: 'pa-lane' }, [
        el('span', { class: 'pa-lane-label' }, [momentIcon(r.icon, 'pa-lane-mark'), r.label]),
        el('span', { class: 'pa-lane-track' }, [
          el('span', { class: `pa-lane-bar is-${r.tone}`, style: { left: pct(r.from), width: width(r.from, r.to) } }),
        ]),
      ])),
      el('div', { class: 'pa-lane pa-lane-axis', 'aria-hidden': 'true' }, [
        el('span', {}),
        el('span', { class: 'pa-axis' }, [
          el('span', { text: 'Day 1' }),
          el('span', { text: `Day ${Math.round(len / 2)}` }),
          el('span', { text: 'Next period' }),
        ]),
      ]),
      el('span', { class: 'pa-today-line', 'aria-hidden': 'true' }, [el('span', { text: 'Today' })]),
    ]),
    snap.lanes.length || snap.easy ? null : el('p', { class: 'hint', text:
      `${snap.name ?? 'She'} hasn’t shared patterns, or there isn’t enough history yet. `
      + 'They fill in after about three cycles of logging.' }),
  ]);
}

/** @param {Snapshot} snap */
function statTiles(snap) {
  const s = snap.stats;
  const tiles = [
    { big: `${snap.cycleLength}`, label: 'days per cycle', sub: s && s.min !== s.max ? `${s.min} to ${s.max} lately` : null },
    { big: `${snap.periodLength}`, label: 'days of period', sub: null },
  ];
  if (s?.regularity) {
    tiles.push({ big: { regular: 'Regular', variable: 'Varies', irregular: 'Irregular' }[s.regularity],
      label: 'cycle rhythm', sub: s.regularity === 'regular' ? 'Forecasts are dependable' : 'Dates can move a few days' });
  }
  if (s?.total) {
    tiles.push({ big: `${s.hits}/${s.total}`, label: 'forecasts within 2 days', sub: null });
  } else if (s?.cycles) {
    tiles.push({ big: `${s.cycles}`, label: 'cycles logged', sub: null });
  }
  return el('section', { class: 'pa-tiles' }, tiles.map((t) => el('div', { class: 'pa-tile' }, [
    el('span', { class: 'pa-tile-big num', text: t.big }),
    el('span', { class: 'pa-tile-label', text: t.label }),
    t.sub ? el('span', { class: 'hint-sm', text: t.sub }) : null,
  ])));
}

/**
 * @param {import('../domain/partner.js').PartnerModel} model
 * @param {DateKey} today
 */
function comingPeriods(model, today) {
  if (!model.upcoming.length) return null;
  return el('section', { class: 'card pa-coming' }, [
    el('h3', { class: 'pa-card-title', text: 'Coming periods' }),
    el('ul', { class: 'pa-coming-list' }, model.upcoming.map((p) => {
      const until = daysBetween(today, p.start);
      return el('li', {}, [
        el('span', { text: `${fmtDayMonth(p.start)} to ${fmtDayMonth(p.end)}` }),
        el('span', { class: 'badge', text: until <= 0 ? 'Now' : until === 1 ? 'Tomorrow' : `In ${until} days` }),
      ]);
    })),
    addToCalendarButton(model),
  ]);
}

/**
 * The four phases, for him, with the current one marked.
 * @param {Snapshot} snap
 * @param {PartnerDay} day
 */
function phaseGuide(snap, day) {
  const ids = /** @type {const} */ (['period', 'follicular', 'fertile', 'luteal']);
  const token = PHASE_TOKEN;
  return el('section', { class: 'pa-section' }, [
    el('h3', { class: 'pa-h', text: 'Her cycle, phase by phase' }),
    el('div', { class: 'pa-phases' }, ids.filter((id) => id !== 'fertile' || snap.fertile).map((id) =>
      el('details', { class: `pa-phase${day.phase === id ? ' is-now' : ''}` }, [
        el('summary', {}, [
          el('span', { class: 'pa-phase-row' }, [
            el('span', { class: 'phase-dot', style: { background: `var(${token[id]})` }, 'aria-hidden': 'true' }),
            el('span', { class: 'pa-phase-title', text: PHASE_WORDS[id].title }),
            day.phase === id ? el('span', { class: 'badge badge-primary', text: 'Now' }) : null,
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
        snap ? herCharacter(snap, 48) : null,
        el('div', {}, [
          el('h3', { text: snap?.name ? `${snap.name}’s cycle` : 'Your partner’s cycle' }),
          el('p', { class: 'hint-sm', text: of.gone ? 'Stopped sharing'
            : of.fetchedAt ? `Checked ${fmtRelative(keyOf(of.fetchedAt)).toLowerCase()}` : 'Not loaded yet' }),
        ]),
      ]),
      of.code ? el('p', { class: 'pa-code-line' }, [
        'Code ', el('span', { class: 'pa-code num', text: of.code }),
        el('span', { class: 'hint-sm', text: ' · enter it on another phone to follow her there too' }),
      ]) : null,
      el('div', { class: 'pa-connection-actions' }, [
        el('button', { type: 'button', class: 'btn btn-secondary',
          onclick: async () => { haptic(); await refreshPartner({ force: true }); toast('Up to date'); } }, ['Refresh']),
        el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { haptic(); void askDisconnect(); } },
          ['Disconnect']),
      ]),
    ]) : null,

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
  store.updateSettings({ partnerOf: null });
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

