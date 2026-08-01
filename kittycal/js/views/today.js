// @ts-check
/**
 * today.js — the home screen.
 *
 * Modelled on Flo's main screen: a big ring in the middle carrying a countdown,
 * the current cycle day, and a row of cards below. The countdown flips — it
 * counts to ovulation while that's ahead, then to the period once ovulation has
 * passed.
 *
 * Design rules in force here:
 *   - The mascot reacts to the *act of logging*, never to what was logged. No
 *     sad face at a heavy day.
 *   - Every number is tabular, carries its unit, and says how confident it is.
 *   - Nothing claims to be medical advice.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 */

import { el, svg, replace, haptic } from '../utils/dom.js';
import { todayKey, fmtDayMonth, fmtRelative, daysBetween, addDays, dow, dayOfMonth, DOW_MIN }
  from '../utils/date.js';
import { plural, listJoin } from '../utils/fmt.js';
import { labelFor, labelOf, CATEGORIES, DEFAULT_CHIPS } from '../data/taxonomy.js';
import { pick } from '../data/tips.js';
import { loggedIds } from '../domain/stats.js';
import { nothingRecorded } from '../domain/model.js';
import { buildRecap, cluster } from '../domain/recap.js';
import { backupNudge } from '../domain/backup-health.js';
import { exportEverything } from '../storage/export-action.js';
import { openLogSheet } from './log.js';
import { openCheckin } from './checkin.js';
import { buildCycles, cycleLengths, periodLengths } from '../domain/cycles.js';
import { predict, conceptionChance } from '../domain/predict.js';
import { phaseFor } from '../domain/phases.js';
import { evaluate } from '../domain/acog.js';
import { cycleRing } from '../ui/ring.js';
import { spotArt } from '../ui/mascot.js';
import * as store from '../state/store.js';

/**
 * @param {HTMLElement} host
 */
export function renderToday(host) {
  const state = store.getState();
  const { settings, periodDays, logs } = state;
  const today = todayKey();

  const cycles = buildCycles(periodDays);
  const prediction = predict({ periodDays, settings, today });
  const phase = phaseFor({ date: today, cycles, prediction });

  /*
    No cycles yet — she skipped the last-period question during setup, or has
    only ever logged days with no bleeding on them.

    The ring and every prediction need a cycle to exist, so those are replaced
    by a prompt to mark one. The daily loop is not: the check-in and the week
    strip stay exactly where they always are. An earlier version returned here
    with only the prompt, which meant someone in this state could be asked to
    check in, answer, and still be told "Nothing logged yet" with no way to
    check in again.
  */
  if (!cycles.length) {
    replace(host, [
      greeting(settings.name, today),
      emptyState(settings.name),
      logButton(logs[today], today),
      weekStrip(logs, periodDays, today),
      disclaimerNote(),
    ]);
    return;
  }

  const headline = ringHeadline(prediction);

  /*
   * Today answers three questions, in this order: where am I, what is coming,
   * and can I log now. Everything else earns its place or belongs on another
   * screen.
   *
   * What used to be here and is not any more:
   *   - a colour legend under the ring, plus a separate "Luteal phase" card.
   *     Between them the phase was stated three times. It is now named once,
   *     in text, directly under the ring — which also removes the ring's
   *     reliance on colour alone.
   *   - a cycle-length stats card, which was a duplicate of the first card on
   *     Insights. Stats are not a "today" question.
   *   - a standalone confidence banner. It is meta-information about one
   *     prediction, so it now sits as a line inside that prediction.
   *
   * And the Log button has moved from the very bottom to directly under the
   * ring: it is the most frequent action in the app and it was below the fold.
   */
  const recap = buildRecap({ cycles, logs, today });
  const showRecap = recap && settings.recapSeen !== recap.cycleStart;

  replace(host, [
    greeting(settings.name, today),

    showRecap ? recapCard(/** @type {NonNullable<typeof recap>} */ (recap)) : null,

    cycleRing({
      prediction,
      headline: headline.value,
      caption: headline.caption,
      eyebrow: prediction.cycleDay != null ? `Day ${prediction.cycleDay}` : undefined,
    }),

    phaseLine(phase),
    logButton(logs[today], today),
    weekStrip(logs, periodDays, today),

    el('div', { class: 'section stagger' }, [
      prediction.stale ? staleCard(prediction)
        : prediction.isLate ? lateCard(prediction) : nextPeriodCard(prediction),
      prediction.showFertility && prediction.ovulation ? fertileCard(prediction, today) : null,
      ...acogCards(cycles, today, prediction),
    ]),

    tipsRow({ phase, prediction, log: logs[today], today }),
    backupPrompt({ logs, periodDays, settings, today }),
    disclaimerNote(),
  ]);
}

/**
 * The one thing that can lose all of this.
 *
 * Kittycal has no server, so an exported file is the only copy that survives
 * the phone. Settings has said so from the start, which is no use at all —
 * nobody opens Settings to be reminded of something they have not thought of.
 *
 * It sits near the bottom rather than at the top: it is important but never
 * urgent, and it must not be the first thing she sees on a screen whose job is
 * to answer "where am I in my cycle". It is also silent almost always —
 * `backupNudge` returns null until there is a fortnight of unprotected data,
 * and dismissing it buys a month.
 *
 * @param {Object} input
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} input.logs
 * @param {Set<DateKey>} input.periodDays
 * @param {import('../domain/model.js').Settings} input.settings
 * @param {DateKey} input.today
 */
function backupPrompt({ logs, periodDays, settings, today }) {
  const nudge = backupNudge({ logs, periodDays, settings, today });
  if (!nudge) return null;

  return el('div', { class: 'card data-zone backup-nudge' }, [
    el('h3', { text: 'Worth backing up' }),
    el('p', { class: 'hint-sm', text:
      nudge.neverBackedUp
        ? `${plural(nudge.daysAtRisk, 'day')} of your history is only on this ` +
          'phone. A backup file is the only copy that survives losing or ' +
          'replacing it.'
        : `${plural(nudge.daysAtRisk, 'day')} logged since your last backup ` +
          `${plural(/** @type {number} */ (nudge.daysSinceBackup), 'day')} ago.` }),
    el('div', { class: 'backup-nudge-actions' }, [
      el('button', {
        type: 'button', class: 'btn',
        onclick: async (/** @type {Event} */ e) => {
          haptic();
          const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
          // The file is built from the whole store, so on a long history this
          // is not instant. Disabling prevents a second tap producing a second
          // download of the same thing.
          btn.disabled = true;
          try {
            await exportEverything();
          } finally {
            btn.disabled = false;
          }
        },
      }, ['Back up now']),
      el('button', {
        type: 'button', class: 'btn btn-ghost',
        onclick: () => {
          haptic();
          // Snoozed, not silenced: the data is still only in one place, and
          // there will be more of it in a month.
          store.updateSettings({ backupSnoozed: today });
        },
      }, ['Not now']),
    ]),
  ]);
}

/**
 * The look back at the cycle that just closed.
 *
 * Sits above the ring because it is the one thing on this screen that is only
 * true today — everything below it will still be there tomorrow. It appears
 * for a week after a cycle closes, and once dismissed it does not come back
 * for that cycle.
 *
 * The tone is deliberately flat. A recap is the app telling her something
 * about her own body, so it reports and does not react: no celebration for a
 * "textbook" cycle, no concern for a long one. Whether a number matters is a
 * question for a doctor, and the ACOG cards further down already raise it.
 *
 * @param {import('../domain/recap.js').Recap} recap
 */
function recapCard(recap) {
  const lines = [
    lengthLine('Cycle', recap.length, recap.usualLength),
    lengthLine('Period', recap.periodLength, recap.usualPeriodLength),
    ...recap.notable.map(notableLine),
  ];

  return el('div', { class: 'card data-zone recap' }, [
    el('div', { class: 'recap-head' }, [
      el('div', {}, [
        el('h3', { text: 'Your last cycle' }),
        el('p', { class: 'hint-sm', text:
          `${fmtDayMonth(recap.cycleStart)} to ${fmtDayMonth(recap.cycleEnd)}` }),
      ]),
      el('button', {
        type: 'button',
        class: 'btn-icon recap-close',
        'aria-label': 'Dismiss last cycle summary',
        onclick: () => {
          haptic();
          // Remembered against the cycle's own start date rather than a
          // boolean, so dismissing this one cannot suppress the next one.
          store.updateSettings({ recapSeen: recap.cycleStart });
        },
      }, [
        // `svg()`, not `el()`: createElement builds an HTML element, and an
        // HTML <svg> is an unknown element that renders as nothing at all.
        svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
                     'stroke-width': '2', 'stroke-linecap': 'round',
                     'aria-hidden': 'true' }, [
          svg('path', { d: 'M6 6l12 12M18 6L6 18' }),
        ]),
      ]),
    ]),
    el('ul', { class: 'recap-lines' }, lines.map((line) => el('li', {}, [line]))),
    // Outside the list: it counts how much was logged rather than reporting
    // something that happened, so bulleting it alongside the findings gave it
    // a weight it does not have.
    el('p', { class: 'hint-sm recap-foot', text:
      `You logged something on ${plural(recap.daysLogged, 'day')} of it.` }),
  ]);
}

/**
 * "Cycle: 30 days, 2 longer than usual" — or just the number, when there is
 * no history to compare against yet.
 * @param {string} label
 * @param {number} value
 * @param {number|null} usual
 */
function lengthLine(label, value, usual) {
  const diff = usual == null ? null : value - usual;
  const comparison =
    diff == null ? '.'
      : diff === 0 ? ', the same as usual.'
        : `, ${plural(Math.abs(diff), 'day')} ${diff > 0 ? 'longer' : 'shorter'} than usual.`;

  return el('span', {}, [
    el('strong', { class: 'num', text: `${value}-day ${label.toLowerCase()}` }),
    comparison,
  ]);
}

/**
 * How each kind of thing is worded.
 *
 * Without this the card said "Very low on 2 days", which is a mood label read
 * aloud with the fact that it is a mood stripped out. Each category gets the
 * phrasing that makes its labels into a sentence.
 *
 * @type {Record<string, (label: string) => string>}
 */
const NOTABLE_PHRASING = {
  moods: (label) => `Felt ${label.toLowerCase()}`,
  discharge: (label) => `${label} discharge`,
  activity: (label) => label,
  other: (label) => label,
  sex: (label) => label,
};

/**
 * "Cramps on 3 days, all around days 1–3."
 * @param {import('../domain/recap.js').NotableItem} item
 */
function notableLine(item) {
  const span = cluster(item.days);
  const where = !span ? ''
    : span.from === span.to
      ? `, on day ${span.from}`
      : `, all around days ${span.from}–${span.to}`;

  const phrase = NOTABLE_PHRASING[item.category] ?? ((/** @type {string} */ l) => l);

  return el('span', {}, [
    el('strong', { text: phrase(labelOf(item.id)) }),
    ` on ${plural(item.count, 'day')}${where}.`,
  ]);
}

/**
 * The phase, named in text under the ring.
 *
 * Not a card: it's a caption for the ring above it, and giving it a border
 * made it compete with the actual content below.
 * @param {import('../domain/phases.js').PhaseInfo} phase
 */
function phaseLine(phase) {
  return el('div', { class: 'phase-line' }, [
    el('div', { class: 'phase-line-head' }, [
      el('span', {
        class: 'phase-dot',
        style: { background: `var(${phase.token})` },
        'aria-hidden': 'true',
      }),
      el('h3', { text: `${phase.name} phase` }),
    ]),
    el('p', { class: 'hint', text: phase.summary }),
  ]);
}

/**
 * The primary action, directly under the ring rather than at the bottom of the
 * screen. Shows what's already recorded so tapping it isn't a leap of faith.
 * @param {import('../domain/model.js').DayLog|undefined} log
 * @param {DateKey} today
 */
/**
 * The daily log area.
 *
 * Two states, and only two.
 *
 * Not logged yet: one button that starts the three-question check-in. That
 * replaced a row of chips, which was a shortcut for someone who already knows
 * what she wants to record — passive, and passive collection gets thin data.
 * Every insight in this app is only as good as what got logged, so the app
 * asks rather than waits.
 *
 * Already logged: what today holds, plus a way to add to it. No controls,
 * because the questions have been answered and asking again is noise.
 *
 * @param {import('../domain/model.js').DayLog|undefined} log
 * @param {DateKey} today
 */
function logButton(log, today) {
  if (!log) {
    return el('div', { class: 'log-cta' }, [
      el('button', {
        type: 'button',
        class: 'btn btn-block btn-lg',
        onclick: () => { haptic(); openCheckin(today); },
      }, ['Check in for today']),
      el('p', { class: 'hint-sm log-cta-summary', text:
        'Three quick questions, about fifteen seconds.' }),
    ]);
  }

  return el('div', { class: 'log-cta' }, [
    el('div', { class: 'today-logged data-zone' }, [
      el('span', { class: 'today-logged-tick', 'aria-hidden': 'true', text: '\u2713' }),
      // A day where she checked in and nothing was happening is a real answer,
      // not an empty one — it records that she did not bleed, which the cycle
      // maths cares about. It just needs saying differently from a day with
      // three symptoms on it.
      el('p', { text: nothingRecorded(log)
        ? 'Checked in for today — nothing to report.'
        : `Logged today — ${summariseLog(log)}` }),
    ]),
    el('button', {
      type: 'button',
      class: 'btn btn-secondary btn-block',
      onclick: () => { haptic(); openLogSheet(today); },
    }, ['Add more']),
  ]);
}

/**
 * The last seven days, and whether each one got logged.
 *
 * A check-in you skipped used to be reachable only by going to the calendar,
 * finding the day, and opening the full diary — a wall of categories to answer
 * three questions with. So the missed days come to her instead: tap one and it
 * runs the same three questions it would have asked on the day.
 *
 * It stays on screen when everything is logged, rather than appearing only when
 * something is missing. A row of ticks is worth seeing, and a control that
 * moves around depending on how well you have been doing is a control you have
 * to re-find every time.
 *
 * Future days are not shown. Nothing about tomorrow can be answered yet, and a
 * tappable tomorrow invites logging a period that has not happened.
 *
 * @param {Record<DateKey, import('../domain/model.js').DayLog>} logs
 * @param {Set<DateKey>} periodDays
 * @param {DateKey} today
 */
function weekStrip(logs, periodDays, today) {
  const days = [];
  let missed = 0;

  for (let back = 6; back >= 0; back -= 1) {
    const key = addDays(today, -back);
    const log = logs[key];
    const isToday = key === today;

    /*
      Logged and missed are the real distinction — "logged" means she answered,
      "missed" means nobody knows, and a day with no log is not a day with
      nothing on it. Today is marked on top of whichever of those it is, rather
      than instead of them, so the current day stays findable once it is
      logged.
    */
    const classes = ['week-day', log ? 'is-logged' : 'is-missed'];
    if (isToday) classes.push('is-today');
    if (periodDays.has(key)) classes.push('is-period');

    // Today has not been missed, it just has not happened yet, so it is never
    // part of the catch-up count.
    if (!log && !isToday) missed += 1;

    const label = `${fmtRelative(key)}${
      log ? ', logged' : isToday ? ', not checked in yet' : ', not logged'}`;

    days.push(el('button', {
      type: 'button',
      class: classes.join(' '),
      'aria-label': label,
      onclick: () => {
        haptic();
        // Already answered: straight to the diary, because the three questions
        // have nothing left to ask. Not answered: the three questions.
        if (log) openLogSheet(key); else openCheckin(key);
      },
    }, [
      el('span', { class: 'week-day-dow', 'aria-hidden': 'true', text: DOW_MIN[dow(key)] }),
      el('span', { class: 'week-day-num', 'aria-hidden': 'true', text: String(dayOfMonth(key)) }),
      el('span', { class: 'week-day-mark', 'aria-hidden': 'true', text: log ? '✓' : '' }),
    ]));
  }

  return el('section', { class: 'week-strip', 'aria-label': 'The last seven days' }, [
    el('div', { class: 'week-strip-row' }, days),
    el('p', { class: 'hint-sm week-strip-note', text: missed
      ? `${plural(missed, 'day')} not logged — tap to catch up.`
      // Not "every day this week is logged": today usually is not, and saying
      // so would be wrong for most of the day, every day.
      : 'Nothing to catch up on.' }),
  ]);
}


/* ── Pieces ─────────────────────────────────────────────────────────────── */

/**
 * @param {string} name
 * @param {DateKey} today
 */
function greeting(name, today) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  return el('div', { class: 'today-greeting' }, [
    el('p', { class: 'hint-sm', text: fmtRelative(today).toUpperCase() }),
    el('h2', { text: name ? `${part}, ${name}` : `Good ${part.toLowerCase()}` }),
  ]);
}

/**
 * The big number in the ring. Flips between counting to ovulation and counting
 * to the period, the way Flo's does.
 * @param {import('../domain/predict.js').Prediction} prediction
 */
function ringHeadline(prediction) {
  // Nothing to count down to, and nothing honest to put in the middle of a
  // ring that is meant to show where you are in a cycle.
  if (prediction.stale) return { value: '—', caption: 'no recent period logged' };

  if (prediction.isLate && prediction.daysLate != null) {
    return {
      value: String(prediction.daysLate),
      caption: prediction.daysLate === 1 ? 'day late' : 'days late',
    };
  }

  const today = todayKey();

  // Count to ovulation while it's still ahead of us.
  if (prediction.showFertility && prediction.ovulation && prediction.ovulation > today) {
    const days = daysBetween(today, prediction.ovulation);
    if (days <= 10) {
      return {
        value: String(days),
        caption: days === 1 ? 'day to ovulation' : 'days to ovulation',
      };
    }
  }

  if (prediction.daysUntilPeriod != null) {
    const days = prediction.daysUntilPeriod;
    if (days === 0) return { value: 'Today', caption: 'period expected' };
    return {
      value: String(days),
      caption: days === 1 ? 'day to your period' : 'days to your period',
    };
  }

  return { value: '—', caption: 'not enough data' };
}

/**
 * The daily insight cards — Flo's "My daily insights" row.
 *
 * A horizontal scroller, because these are worth glancing at and not worth
 * three screens of vertical space. Cards are chosen by phase and by what she
 * actually logged today, and they rotate day to day so the same one doesn't
 * become wallpaper.
 *
 * @param {Object} opts
 * @param {import('../domain/phases.js').PhaseInfo} opts.phase
 * @param {import('../domain/predict.js').Prediction} opts.prediction
 * @param {import('../domain/model.js').DayLog|undefined} opts.log
 * @param {DateKey} opts.today
 */
function tipsRow({ phase, prediction, log, today }) {
  // loggedIds only covers the chip categories. Tips can also key off the
  // numeric trackers, so add a pseudo-id for each one that has a value —
  // without this the temperature tip could never fire.
  const loggedToday = log
    ? [
        ...loggedIds(log),
        ...(log.bbt != null ? ['bbt'] : []),
        ...(log.weight != null ? ['weight'] : []),
        ...(log.sleep != null ? ['sleep'] : []),
        ...(log.water ? ['water'] : []),
      ]
    : [];

  const tips = pick({
    phase: phase.id,
    cycleDay: prediction.cycleDay,
    loggedToday,
    showFertility: prediction.showFertility,
    dateSeed: today,
  });

  if (!tips.length) return null;

  return el('section', { class: 'tips', 'aria-label': 'Things to know today' }, [
    el('h3', { class: 'tips-heading', text: 'Worth knowing' }),
    el('ul', {
      class: 'tips-scroller',
      // A horizontal scroller is a nuisance with a keyboard unless it's
      // focusable and scrollable in its own right.
      tabindex: '0',
      role: 'list',
    }, tips.map((tip) =>
      el('li', { class: 'tip-card' }, [
        el('h4', { text: tip.title }),
        el('p', { text: tip.body }),
      ]),
    )),
  ]);
}


/** @param {import('../domain/predict.js').Prediction} prediction */
function nextPeriodCard(prediction) {
  if (!prediction.nextPeriod) return null;
  const { start, end } = prediction.nextPeriod;

  return el('div', { class: 'card data-zone' }, [
    el('h3', { text: 'Next period' }),
    el('p', { class: 'big-value num', text: `${fmtDayMonth(start)} – ${fmtDayMonth(end)}` }),
    el('p', { class: 'hint-sm', text:
      `Estimated ${prediction.avgPeriodLength}-day period, ` +
      `based on ${prediction.basis}.` }),
    confidenceLine(prediction),
  ]);
}

/**
 * How much to trust the prediction above, as a line rather than a banner.
 *
 * This used to be a full-width coloured alert of its own, which gave a footnote
 * the same visual weight as the forecast it was describing. It still never
 * hides — a prediction without its confidence is the dishonest version.
 *
 * @param {import('../domain/predict.js').Prediction} prediction
 */
function confidenceLine(prediction) {
  /** @type {Record<string, string>} */
  const copy = {
    none: 'No cycles logged yet, so this is only your stated average.',
    low: `Low confidence — based on ${plural(prediction.cyclesLogged, 'complete cycle')}. ` +
      'This will tighten up over the next couple of months.',
    medium: `Reasonable confidence — based on ${plural(prediction.cyclesLogged, 'complete cycle')}.`,
    high: `Good confidence — based on ${plural(prediction.cyclesLogged, 'complete cycle')}` +
      (prediction.recalibrated
        ? ', recently re-anchored because your cycle length changed and stayed changed.'
        : '.'),
  };

  return el('p', {
    class: `confidence confidence-${prediction.confidence}`,
    text: copy[prediction.confidence],
  });
}

/**
 * What to say when the history has simply stopped.
 *
 * Every prediction hangs off the last period she logged, so once that is
 * months old the whole screen becomes confident fiction. Before this existed,
 * coming back after a year showed "Day 431", "402 days late", "Luteal phase",
 * a fertile window from the previous summer, and "Good confidence — based on
 * 5 complete cycles".
 *
 * Nobody's period is 402 days late. The number was arithmetic, not a fact
 * about her body, and presenting it as one is the kind of thing that would
 * frighten someone opening a period tracker after a gap.
 *
 * So it says the plain thing instead, and asks for the one piece of
 * information that makes everything work again.
 *
 * @param {import('../domain/predict.js').Prediction} prediction
 */
function staleCard(prediction) {
  const months = Math.round((prediction.daysSinceStart ?? 0) / 30);

  return el('div', { class: 'card data-zone' }, [
    el('h3', { text: 'Let\u2019s pick this back up' }),
    el('p', { class: 'hint-sm', text:
      `Your last logged period was ${plural(months, 'month')} ago, which is too ` +
      'far back to predict from. Mark when your most recent period started and ' +
      'everything starts working again.' }),
    el('button', {
      type: 'button',
      class: 'btn',
      style: { marginTop: 'var(--sp-3)' },
      onclick: () => {
        haptic();
        store.setUi({ view: 'calendar', periodEditMode: true });
      },
    }, ['Mark my last period']),
  ]);
}

/**
 * Lateness is a first-class state, not a silently redrawn prediction. The copy
 * stays factual and explicitly avoids speculating about why.
 * @param {import('../domain/predict.js').Prediction} prediction
 */
function lateCard(prediction) {
  const days = prediction.daysLate ?? 0;
  return el('div', { class: 'card data-zone' }, [
    el('h3', { text: 'Your period is late' }),
    el('p', { class: 'big-value num', text: plural(days, 'day') }),
    el('p', { class: 'hint-sm', text:
      `Expected around ${prediction.nextStart ? fmtDayMonth(prediction.nextStart) : '—'}. ` +
      'Cycles shift for all sorts of ordinary reasons — stress, travel, illness, ' +
      'a change in sleep. Kittycal will update once you log your next period.' }),
    confidenceLine(prediction),
  ]);
}

/**
 * @param {import('../domain/predict.js').Prediction} prediction
 * @param {DateKey} today
 */
function fertileCard(prediction, today) {
  if (!prediction.fertileWindow || !prediction.ovulation) return null;
  const chance = conceptionChance(prediction, today);

  return el('div', { class: 'card data-zone' }, [
    el('h3', { text: 'Fertile window' }),
    el('p', { class: 'big-value num', text:
      `${fmtDayMonth(prediction.fertileWindow.start)} – ${fmtDayMonth(prediction.fertileWindow.end)}` }),
    el('p', { class: 'hint-sm', text:
      `Ovulation estimated ${fmtDayMonth(prediction.ovulation)}. Today: ${chance.label.toLowerCase()}.` }),
    prediction.fertileWidened && el('div', { class: 'alert alert-warn', style: { marginTop: 'var(--sp-3)' } }, [
      el('span', { class: 'alert-icon', text: '!', 'aria-hidden': 'true' }),
      el('div', { text:
        'This window is deliberately wide. There is not enough cycle history yet ' +
        'to narrow it down, and a narrow window here would look more certain ' +
        'than it is.' }),
    ]),
  ]);
}




/**
 * ACOG-based prompts. Framed as things worth raising with a doctor, never as
 * findings — this is not a screening tool and doesn't pretend to be.
 * @param {import('../domain/cycles.js').Cycle[]} cycles
 * @param {DateKey} today
 * @param {import('../domain/predict.js').Prediction} prediction
 */
function acogCards(cycles, today, prediction) {
  const flags = evaluate({
    cycleLengths: cycleLengths(cycles),
    periodLengths: periodLengths(cycles, today),
    daysSinceLastPeriod: prediction.lastStart ? daysBetween(prediction.lastStart, today) : null,
  });

  if (!flags.length) return [];

  return [
    el('div', { class: 'card data-zone' }, [
      el('h3', { text: 'Worth mentioning to a doctor' }),
      el('p', { class: 'hint-sm', text:
        'These are observations from your own logs, measured against the ' +
        'typical ranges published by ACOG. They are not a diagnosis and not a ' +
        'cause for alarm — just things a professional is better placed to ' +
        'interpret than an app.' }),
      el('ul', { class: 'flag-list' }, flags.map((flag) =>
        el('li', {}, [
          el('strong', { text: flag.title }),
          el('span', { class: 'hint-sm', text: flag.detail }),
        ]),
      )),
    ]),
  ];
}


/**
 * A factual one-liner about what's recorded. Deliberately no praise and no
 * commentary — the app doesn't have an opinion about her day.
 * @param {import('../domain/model.js').DayLog} log
 */
function summariseLog(log) {
  /** @type {string[]} */
  const bits = [];
  if (log.flow !== 'none') bits.push(labelFor('flow', log.flow).toLowerCase());
  const chips = log.symptoms.length + log.moods.length + log.discharge.length
    + log.activity.length + log.other.length + log.sex.length + log.custom.length;
  if (chips) bits.push(`${chips} ${chips === 1 ? 'entry' : 'entries'}`);
  if (log.bbt != null) bits.push('temperature');
  if (log.notes.trim()) bits.push('a note');
  return bits.length ? `${listJoin(bits)}.` : 'You can add to it any time.';
}

function disclaimerNote() {
  return el('p', { class: 'hint-sm', style: { 'text-align': 'center', 'margin-top': 'var(--sp-4)' }, text:
    'Predictions are estimates from your own logs. Not contraception, and not ' +
    'medical advice.' });
}

/** @param {string} name */
function emptyState(name) {
  return el('div', { class: 'empty' }, [
    spotArt('calendar'),
    el('h3', { text: name ? `Hi ${name}!` : 'Nothing logged yet' }),
    el('p', { text:
      'Mark the days of your last period on the calendar and Kittycal can ' +
      'start working out your cycle. A rough guess is enough to begin with.' }),
    el('button', {
      type: 'button',
      class: 'btn',
      text: 'Open the calendar',
      onclick: () => { haptic(); store.setView('calendar'); },
    }),
  ]);
}
