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
import { todayKey, fmtRelative } from '../utils/date.js';
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

/**
 * Flow levels, in the order they are offered.
 *
 * Spotting is here and it is not optional. Marking light, medium or heavy also
 * marks the day as a period day; spotting deliberately does not, because it
 * means bleeding outside a period and counting it as day one would throw every
 * cycle length off. Leaving it out of the check-in did not remove that
 * distinction, it just removed her ability to express it — someone spotting
 * mid-cycle had the choice of saying "no bleeding", which is false, or "light",
 * which starts a phantom period. Since the check-in is now the way most days
 * get logged, that was a standing invitation to corrupt the one field
 * everything else is derived from.
 *
 * `note` is what makes the difference visible at the moment of choosing, rather
 * than in a Help page nobody reads before tapping.
 */
const FLOW_STEPS = /** @type {const} */ ([
  { id: 'none', label: 'No bleeding', wide: true },
  { id: 'light', label: 'Light' },
  { id: 'medium', label: 'Medium' },
  { id: 'heavy', label: 'Heavy' },
  { id: 'spotting', label: 'Spotting', note: 'does not start a period' },
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
 * Any date, not just today. A day that got skipped is reachable from the week
 * strip on Today, and it runs the same three questions rather than dropping her
 * into the full diary — a missed day should cost the same fifteen seconds the
 * day itself would have.
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
  let flowAnswered = store.getState().logs[date] != null;

  const isToday = date === todayKey();

  // 'Today' | 'Yesterday' | 'Tue 28 Jul'. The last of those reads wrong dropped
  // into a sentence bare or lowercased, so it gets an 'on' and keeps its caps.
  const when = fmtRelative(date);
  const whenLabel = when === 'Yesterday' ? 'yesterday' : when;
  const whenPhrase = when === 'Yesterday' ? 'yesterday' : `on ${when}`;

  let step = 0;
  const steps = [flowStep, moodStep, symptomStep];

  const sheet = openSheet({
    title: when,
    body: [],
    onClose: () => {
      // Closing without finishing is a skip, not a refusal forever — it just
      // stops the app asking again until tomorrow. Only today's check-in can
      // do that: backing out of Tuesday's must not cancel the question the app
      // still owes her for today.
      if (isToday && step < steps.length) store.updateSettings({ checkinSkipped: date });
    },
  });

  /*
    Every rendered question carries a token, and its buttons refuse to act once
    that token is stale.

    The tapped button stays alive after the tap that replaced it — a phone
    double-tap fires the same node twice, and the second firing advanced a
    second time and skipped the mood question outright. Verified in the browser,
    not theorised. A simple "busy" flag does not fix it, because the re-render
    that clears the flag happens synchronously inside the first tap. Comparing
    tokens is timing-independent: a button belonging to a question we have left
    cannot move us on, however long the gap.
  */
  let token = 0;

  const render = () => {
    token += 1;
    const mine = token;
    sheet.body.replaceChildren(
      progress(step, steps.length, step > 0 ? back : null),
      steps[step](() => token !== mine),
    );
    sheet.body.scrollTop = 0;

    /*
      Put focus on the new question.

      Replacing the sheet's contents destroys whatever was focused, and the
      browser drops focus to <body> — so a keyboard user was thrown to the top
      of the document after every answer, and a screen reader said nothing at
      all about the question that had just appeared. Three times a day, every
      day. Moving focus to the heading reads the new question out and puts the
      next Tab exactly where it should be.
    */
    const heading = sheet.body.querySelector('.checkin-title');
    if (heading instanceof HTMLElement) heading.focus({ preventScroll: true });
  };

  const next = () => {
    step += 1;
    if (step >= steps.length) return void finish();
    render();
  };

  /*
    The first question is single-select and moves on the instant it is tapped,
    which is what makes a quiet day three taps — and also means a mis-tap is
    instantly a wrong answer. Flow is the field every prediction in the app is
    built from, so "Heavy" when she meant "Light" mattering until she next
    opens the diary is not acceptable. Back is the whole recovery path, and it
    keeps every answer: the draft is untouched by moving between questions.
  */
  const back = () => {
    if (step === 0) return;
    step -= 1;
    render();
  };

  /*
    Finishing is the one move the token guard does not cover, because it is the
    one that does not re-render: the Done button stays live and tappable for as
    long as the write takes. Double-tapping it ran the whole ending twice — two
    writes, two bursts, two announcements — and on the failure path would have
    wound `step` back twice.
  */
  let finishing = false;

  const finish = async () => {
    if (finishing) return;
    finishing = true;

    // The fact of having been asked and answered, recorded explicitly. Without
    // it a day of "no bleeding, nothing bothering me" is indistinguishable from
    // a day she never opened the app, and storage prunes it away.
    draft.checkedIn = true;

    // Same bookkeeping the diary does on Apply. Without it the check-in's own
    // symptom list could never learn from the taps it collects.
    store.rememberPicks(draft);

    // Nothing is celebrated until it is actually on the disk. Saying "checked
    // in" over a write that failed is worse than the failure: she would not
    // know to do it again.

    const saved = await store.putLog(draft);
    if (!saved) {
      // The store has already put memory back and toasted. Return her to the
      // last question with every answer still in the draft, so retrying is one
      // tap rather than starting again.
      finishing = false;
      step -= 1;
      render();
      return;
    }

    closeSheet();
    const theme = getTheme(store.getState().settings.theme);
    burst({ shape: theme.particle });
    announce(isToday ? 'Checked in for today' : `Checked in for ${whenLabel}`);
  };

  /* ── 1. Flow ───────────────────────────────────────────────────────── */

  /** @param {() => boolean} stale */
  function flowStep(stale) {
    return question({
      stale,
      title: isToday ? 'Any bleeding today?' : `Any bleeding ${whenPhrase}?`,
      hint: 'This is the one that matters most — it is what every prediction ' +
        'is built from.',
      /*
        The whole day in one tap.

        "No bleeding, no moods, nothing bothering me" is the most common day
        there is, and it cost three taps to say — the two after the first being
        a pair of Next buttons over questions the answer to which is already
        "none". Offering it as one control is the difference between a habit
        and a chore on exactly the days she is least motivated to bother.

        It is quiet and below the answers rather than among them: it is a
        shortcut past the questions, not one of the answers to the first.
      */
      shortcut: !flowAnswered && draft.moods.length === 0 && draft.symptoms.length === 0
        ? { label: 'Nothing to report today', onPick: () => {
            draft.flow = 'none';
            draft.moods = [];
            draft.symptoms = [];
            step = steps.length;
            void finish();
          } }
        : null,
      options: FLOW_STEPS.map(({ id, label, note, wide }) => ({
        id,
        label,
        note,
        wide,
        selected: flowAnswered && draft.flow === id,
        // Single-select, so tapping an answer *is* moving on. No Next button
        // to hunt for and no second tap to confirm what was already decided.
        onPick: () => {
          draft.flow = /** @type {DayLog['flow']} */ (id);
          // Now it *is* answered, so coming back here shows her own choice
          // rather than looking untouched again.
          flowAnswered = true;
          next();
        },
      })),
    });
  }

  /* ── 2. Mood ───────────────────────────────────────────────────────── */

  /** @param {() => boolean} stale */
  function moodStep(stale) {
    return question({
      stale,
      title: isToday ? 'How are you feeling?' : 'How were you feeling?',
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

  /** @param {() => boolean} stale */
  function symptomStep(stale) {
    const { recentChips, customSymptoms } = store.getState().settings;

    const builtIn = new Set(
      CATEGORIES.find((c) => c.id === 'symptoms')?.options.map((o) => o.id) ?? [],
    );
    /*
      Her own named symptoms count too.

      Anything she went to the trouble of creating is, by definition, something
      she cares about — and it was the one thing the fast path could never
      offer, so logging it always meant opening the full diary. They live in a
      different field on the log, which is the only reason this needs to know
      the difference at all.
    */
    const custom = new Set(customSymptoms);

    // Her own recent picks first, then the standard list behind them.
    const ids = [];
    for (const id of [...recentChips, ...DEFAULT_CHIPS, ...CHECKIN_SYMPTOMS]) {
      if (ids.length >= 8) break;
      if (ids.includes(id)) continue;
      if (builtIn.has(id) || custom.has(id)) ids.push(id);
    }

    return question({
      stale,
      title: 'Anything bothering you?',
      hint: 'Whatever your body is doing today.',
      multi: true,
      current: () => [...draft.symptoms, ...draft.custom],
      options: ids.map((id) => {
        // Custom symptoms are stored as their own text, so the id is the label.
        const isCustom = custom.has(id);
        return {
          id,
          label: isCustom ? id : labelFor('symptoms', id),
          selected: (isCustom ? draft.custom : draft.symptoms).includes(id),
          onPick: () => (isCustom
            ? toggle(draft.custom, id, (l) => { draft.custom = l; })
            : toggle(draft.symptoms, id, (l) => { draft.symptoms = l; })),
        };
      }),
      lastStep: true,
      onNext: next,
      onMore: () => {
        // Straight into the full diary, carrying everything answered so far so
        // nothing has to be re-entered.
        draft.checkedIn = true;
        // Learned from here too: the answers are already being stored, so not
        // remembering them would depend on her going on to tap Apply.
        store.rememberPicks(draft);
        // Not awaited: the diary is opening on the same draft, and she will
        // Apply there. A failure surfaces as a toast either way.
        void store.putLog(draft);
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
 * @param {{id: string, label: string, selected: boolean, onPick: () => void,
 *   note?: string, wide?: boolean}[]} opts.options
 * @param {() => boolean} opts.stale true once this question has been left
 * @param {{label: string, onPick: () => void}|null} [opts.shortcut] a way past
 *   the whole flow, offered only where answering everything at once is honest
 * @param {boolean} [opts.multi]
 * @param {() => string[]} [opts.current]
 * @param {boolean} [opts.lastStep]
 * @param {() => void} [opts.onNext]
 * @param {() => void} [opts.onMore]
 */
function question({ title, hint, options, stale, shortcut, multi, current, lastStep, onNext, onMore }) {
  const grid = el('div', { class: 'checkin-options' });

  /*
    Every control on this question goes through here. Once the question has
    been left, its buttons are inert — they are still in the DOM long enough
    for a double-tap to reach them, and acting twice on one answer is how a
    question got skipped.

    @param {() => void} fn
  */
  const guard = (fn) => () => { if (stale()) return; fn(); };

  /** @type {HTMLElement[]} */
  const buttons = [];

  for (const option of options) {
    const button = el('button', {
      type: 'button',
      class: `checkin-option${option.wide ? ' is-wide' : ''}`,
      'aria-pressed': String(option.selected),
      onclick: guard(() => {
        haptic(10);
        option.onPick();
        if (multi && current) {
          const now = current();
          for (const b of buttons) {
            b.setAttribute('aria-pressed', String(now.includes(b.dataset.opt ?? '')));
          }
        }
      }),
      dataset: { opt: option.id },
    }, [
      el('span', { text: option.label }),
      // Said here rather than in Help, because the difference only matters at
      // the moment of choosing and nobody opens Help before tapping.
      option.note && el('span', { class: 'checkin-option-note', text: option.note }),
    ]);

    buttons.push(button);
    grid.append(button);
  }

  return el('div', { class: 'checkin-step' }, [
    // tabindex so the step change can move focus here; see render().
    // tabindex so the step change can move focus here; data-autofocus so the
    // sheet lands on the question rather than on its own close button.
    el('h2', { class: 'checkin-title', tabindex: '-1', 'data-autofocus': '', text: title }),
    el('p', { class: 'hint', text: hint }),
    grid,

    multi && el('button', {
      type: 'button',
      class: 'btn btn-block btn-lg checkin-next',
      onclick: guard(() => { haptic(); onNext?.(); }),
    }, [lastStep ? 'Done' : 'Next']),

    shortcut && el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-block checkin-shortcut',
      onclick: guard(() => { haptic(); shortcut.onPick(); }),
    }, [shortcut.label]),

    // On the last step only: a way into the full diary for anyone who wants
    // to record a temperature or write a note. Quiet, because most days it is
    // not wanted.
    lastStep && el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-block',
      onclick: guard(() => { haptic(); onMore?.(); }),
    }, ['Add more detail']),
  ]);
}

/**
 * Three dots, so the end is visible from the start — and a way back.
 *
 * Back sits here rather than beside the answers so it never competes with them
 * for the tap. It is absent on the first question, where there is nothing to go
 * back to, and an empty spacer holds its place so the dots stay put.
 *
 * @param {number} at
 * @param {number} total
 * @param {(() => void)|null} onBack
 */
function progress(at, total, onBack) {
  const dots = el('div', { class: 'checkin-dots', 'aria-hidden': 'true' },
    Array.from({ length: total }, (_, i) => el('span', {
      class: `checkin-dot${i === at ? ' is-active' : ''}${i < at ? ' is-done' : ''}`,
    })));

  return el('div', { class: 'checkin-progress' }, [
    onBack
      ? el('button', {
          type: 'button',
          class: 'btn-back',
          'aria-label': 'Back to the previous question',
          onclick: () => { haptic(); onBack(); },
        }, ['← Back'])
      : el('span', { class: 'btn-back-spacer', 'aria-hidden': 'true' }),
    dots,
    // The step count for anyone who cannot see the dots. The dots themselves
    // are decorative and hidden from the accessibility tree.
    el('span', { class: 'btn-back-spacer sr-only', text: `Step ${at + 1} of ${total}` }),
  ]);
}
