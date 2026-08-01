// @ts-check
/**
 * checkin.js — the daily check-in.
 *
 * The app used to wait to be told things. A row of chips sits there, and if
 * you happen to know you want to record a headache, you tap "headache". That
 * is a fine shortcut and a poor way to collect data: blank space gets skipped,
 * and the insights are only ever as good as what got logged.
 *
 * So it asks instead. Three questions, one screen each, big answers, and it
 * moves on the moment you tap. A day with nothing going on is three taps. A
 * day with cramps and a bad mood is five or six.
 *
 * The three questions are not arbitrary — they are exactly the three things
 * every derived screen in the app needs:
 *
 *   1. Flow, which drives every cycle length, prediction and phase.
 *   2. Mood, which is the whole of the mood-by-phase chart.
 *   3. Symptoms, which is the whole of pattern detection.
 *
 * Nothing else is asked. Temperature, weight, sleep, water and the rest live
 * in the full diary, one tap away at the end, because asking about them daily
 * would turn a fifteen-second habit into a form.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('../domain/model.js').DayLog} DayLog
 */

import { el, haptic, announce } from '../utils/dom.js';
import { todayKey } from '../utils/date.js';
import { CATEGORIES, DEFAULT_CHIPS, labelFor } from '../data/taxonomy.js';
import { openSheet, closeSheet } from '../ui/sheet.js';
import { openLogSheet } from './log.js';
import { burst } from '../ui/particles.js';
import { getTheme } from '../data/themes.js';
import * as store from '../state/store.js';

/**
 * The moods offered.
 *
 * Six of the nineteen. The full list belongs in the diary — a check-in that
 * opens with nineteen buttons is a form, and the point of this is that it is
 * not one. Deliberately balanced: three that are pleasant, three that are not,
 * so the question does not read as fishing for a particular answer.
 */
const CHECKIN_MOODS = ['happy', 'calm', 'energetic', 'irritable', 'anxious', 'low-energy'];

/**
 * The symptoms offered, before her own history is mixed in.
 *
 * Eight, covering the complaints a cycle actually produces. Whatever she has
 * been logging recently floats to the front, so this list stops being generic
 * within a couple of weeks of use.
 */
const CHECKIN_SYMPTOMS = [
  'cramps', 'headache', 'bloating', 'fatigue',
  'tender-breasts', 'backache', 'nausea', 'acne',
];

/** Flow levels, in the order they are offered. */
const FLOW_STEPS = /** @type {const} */ ([
  ['none', 'No bleeding'],
  ['light', 'Light'],
  ['medium', 'Medium'],
  ['heavy', 'Heavy'],
]);

/**
 * Whether today still wants a check-in.
 *
 * False once she has logged anything at all for today — including from the
 * diary — because being asked "bleeding today?" after you have just recorded
 * a heavy day is the app not paying attention.
 *
 * @param {DateKey} date
 * @returns {boolean}
 */
export function needsCheckin(date) {
  const { logs, settings } = store.getState();
  if (!settings.onboarded) return false;
  if (logs[date]) return false;
  return settings.checkinSkipped !== date;
}

/**
 * Open the check-in for a date.
 *
 * @param {DateKey} [date]
 */
export function openCheckin(date = todayKey()) {
  /*
    One working copy for the whole flow, written once at the end.

    Writing per question would mean a half-answered check-in leaves a
    half-written day behind, and "bleeding: none" saved because she opened the
    thing and changed her mind is worse than no record at all.
  */
  const draft = /** @type {DayLog} */ (structuredClone(store.getLog(date)));

  /*
    Flow is stored as `none` by default, so a blank day arrives with "No
    bleeding" already looking like her answer. On a question that has not been
    asked yet, that is the app putting words in her mouth — and it is a
    single-select, so a pre-selected option also means the obvious tap does
    nothing visible.
  */
  const flowAnswered = store.getState().logs[date] != null;

  let step = 0;
  const steps = [flowStep, moodStep, symptomStep];

  const sheet = openSheet({
    title: 'Today',
    body: [],
    onClose: () => {
      // Closing without finishing is a skip, not a refusal forever — it just
      // stops the app asking again until tomorrow.
      if (step < steps.length) store.updateSettings({ checkinSkipped: date });
    },
  });

  const render = () => {
    sheet.body.replaceChildren(
      progress(step, steps.length),
      steps[step](),
    );
    sheet.body.scrollTop = 0;
  };

  const next = () => {
    step += 1;
    if (step >= steps.length) return finish();
    render();
  };

  const finish = () => {
    store.putLog(draft);
    closeSheet();

    const theme = getTheme(store.getState().settings.theme);
    burst({ shape: theme.particle });
    announce('Checked in for today');
  };

  /* ── 1. Flow ───────────────────────────────────────────────────────── */

  function flowStep() {
    return question({
      title: 'Any bleeding today?',
      hint: 'This is the one that matters most — it is what every prediction ' +
        'is built from.',
      options: FLOW_STEPS.map(([id, label]) => ({
        id,
        label,
        selected: flowAnswered && draft.flow === id,
        // Single-select, so tapping an answer *is* moving on. No Next button
        // to hunt for and no second tap to confirm what was already decided.
        onPick: () => {
          draft.flow = /** @type {DayLog['flow']} */ (id);
          next();
        },
      })),
    });
  }

  /* ── 2. Mood ───────────────────────────────────────────────────────── */

  function moodStep() {
    return question({
      title: 'How are you feeling?',
      hint: 'Pick as many as fit, or none.',
      multi: true,
      current: () => draft.moods,
      options: CHECKIN_MOODS.map((id) => ({
        id,
        label: labelFor('moods', id),
        selected: draft.moods.includes(id),
        onPick: () => toggle(draft.moods, id, (list) => { draft.moods = list; }),
      })),
      onNext: next,
    });
  }

  /* ── 3. Symptoms ───────────────────────────────────────────────────── */

  function symptomStep() {
    // Her own recent picks first, then the standard list behind them.
    const ids = [];
    for (const id of [...store.getState().settings.recentChips, ...DEFAULT_CHIPS,
                      ...CHECKIN_SYMPTOMS]) {
      if (ids.length >= 8) break;
      if (ids.includes(id)) continue;
      const inSymptoms = CATEGORIES
        .find((c) => c.id === 'symptoms')?.options.some((o) => o.id === id);
      if (inSymptoms) ids.push(id);
    }

    return question({
      title: 'Anything bothering you?',
      hint: 'Whatever your body is doing today.',
      multi: true,
      current: () => draft.symptoms,
      options: ids.map((id) => ({
        id,
        label: labelFor('symptoms', id),
        selected: draft.symptoms.includes(id),
        onPick: () => toggle(draft.symptoms, id, (l) => { draft.symptoms = l; }),
      })),
      lastStep: true,
      onNext: next,
      onMore: () => {
        // Straight into the full diary, carrying everything answered so far so
        // nothing has to be re-entered.
        store.putLog(draft);
        step = steps.length;
        closeSheet();
        openLogSheet(date);
      },
    });
  }

  render();
}

/**
 * Add or remove an id, then repaint.
 * @param {string[]} list
 * @param {string} id
 * @param {(next: string[]) => void} set
 */
function toggle(list, id, set) {
  const at = list.indexOf(id);
  set(at >= 0
    ? [...list.slice(0, at), ...list.slice(at + 1)]
    : [...list, id]);
}

/**
 * One question: a heading, a grid of answers, and a way onward.
 *
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} opts.hint
 * @param {{id: string, label: string, selected: boolean, onPick: () => void}[]} opts.options
 * @param {boolean} [opts.multi]
 * @param {() => string[]} [opts.current]
 * @param {boolean} [opts.lastStep]
 * @param {() => void} [opts.onNext]
 * @param {() => void} [opts.onMore]
 */
function question({ title, hint, options, multi, current, lastStep, onNext, onMore }) {
  const grid = el('div', { class: 'checkin-options' });

  /** @type {HTMLElement[]} */
  const buttons = [];

  for (const option of options) {
    const button = el('button', {
      type: 'button',
      class: 'checkin-option',
      'aria-pressed': String(option.selected),
      onclick: () => {
        haptic(10);
        option.onPick();
        if (multi && current) {
          const now = current();
          for (const b of buttons) {
            b.setAttribute('aria-pressed', String(now.includes(b.dataset.opt ?? '')));
          }
        }
      },
      dataset: { opt: option.id },
    }, [el('span', { text: option.label })]);

    buttons.push(button);
    grid.append(button);
  }

  return el('div', { class: 'checkin-step' }, [
    el('h2', { class: 'checkin-title', text: title }),
    el('p', { class: 'hint', text: hint }),
    grid,

    multi && el('button', {
      type: 'button',
      class: 'btn btn-block btn-lg checkin-next',
      onclick: () => { haptic(); onNext?.(); },
    }, [lastStep ? 'Done' : 'Next']),

    // On the last step only: a way into the full diary for anyone who wants
    // to record a temperature or write a note. Quiet, because most days it is
    // not wanted.
    lastStep && el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-block',
      onclick: () => { haptic(); onMore?.(); },
    }, ['Add more detail']),
  ]);
}

/**
 * Three dots, so the end is visible from the start.
 * @param {number} at
 * @param {number} total
 */
function progress(at, total) {
  return el('div', { class: 'checkin-progress', 'aria-label': `Step ${at + 1} of ${total}` },
    Array.from({ length: total }, (_, i) => el('span', {
      class: `checkin-dot${i === at ? ' is-active' : ''}${i < at ? ' is-done' : ''}`,
      'aria-hidden': 'true',
    })));
}
