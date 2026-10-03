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
 * Nothing else is asked by default. Temperature, weight, sleep, water and the
 * rest live in the full diary, one tap away at the end, because asking about
 * them daily would turn a fifteen-second habit into a form.
 *
 * ── The rule for adding a daily question
 *
 * Only ask what she can answer from where she is standing, right now, without
 * fetching anything. Flow, mood and symptoms pass: she knows them. A scale
 * reading, a step count or a thermometer reading do not pass for everyone —
 * they need a device she may not own, or a moment (first thing in the
 * morning) that may already be over. A question she cannot answer is worse
 * than no question: it teaches her the check-in is something to dismiss.
 *
 * So a measurement only joins the check-in once she has shown she has it to
 * hand — logged on three of the last thirty days, see `habitualMeasures` — and
 * even then it can always be left blank without explanation.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('../domain/model.js').DayLog} DayLog
 */

import { el, haptic, announce } from '../utils/dom.js';
import { todayKey, fmtRelative, addDays } from '../utils/date.js';
import { CATEGORIES, DEFAULT_CHIPS, MEASURES, WATER_GLASS_ML, labelFor } from '../data/taxonomy.js';
import { fmtWater } from '../utils/fmt.js';
import { openSheet, closeSheet } from '../ui/sheet.js';
import { severityBlock } from '../ui/severity.js';
import { pruneSeverity, nothingRecorded } from '../domain/model.js';
import { openLogSheet } from './log.js';
import { measureRow } from '../ui/measure.js';
import { burst } from '../ui/particles.js';
import { mascotReact } from '../ui/mascot.js';
import { loggingStreak, habitualMeasures } from '../domain/stats.js';
import { STREAK_MARKS } from '../domain/response.js';
import { earnedIds, newlyEarned } from '../domain/stickers.js';
import { stickerContext } from './stickers.js';
import { toast } from '../ui/toast.js';
import { getTheme } from '../data/themes.js';
import * as store from '../state/store.js';

/**
 * The measurements the check-in asks for only once she keeps them.
 *
 * A temperature needs a thermometer and a moment first thing in the morning,
 * so it is only asked of someone who has shown she takes one. Sleep and water
 * are different: anyone can say roughly how long they slept and how many
 * glasses they have had, so they have questions of their own (see `sleepStep`
 * and `waterStep`), on by default and switchable in Settings. Weight and steps
 * need a scale or another app, and stay in the full diary.
 */
const CHECKIN_MEASURES = ['bbt'];

/** Hours offered on the sleep question. The ends stand for "or less"/"or more". */
const SLEEP_HOURS = [4, 5, 6, 7, 8, 9, 10];

/**
 * How the night went, stored as the symptoms that already exist for it, so a
 * restless night lands in Patterns and the report without a new field.
 */
const SLEEP_QUALITY = /** @type {const} */ ([
  { id: 'well', label: 'Slept well', symptom: null },
  { id: 'restless', label: 'Restless', symptom: 'restless-sleep' },
  { id: 'barely', label: 'Barely slept', symptom: 'insomnia' },
]);

/** Glasses offered on the water question; the last one means "that or more". */
const WATER_CHOICES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

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
  { id: 'none', wide: true },
  { id: 'light' },
  { id: 'medium' },
  { id: 'heavy' },
  { id: 'spotting', note: 'does not start a period' },
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
  if (logs[date] && !onlyWater(logs[date])) return false;
  return settings.checkinSkipped !== date;
}

/**
 * A day whose only entry is water.
 *
 * Water is added a glass at a time from Today, often before the check-in has
 * happened. Counting that as "logged" would quietly cancel the day's questions
 * the first time she drank something.
 *
 * @param {DayLog} log
 */
export function onlyWater(log) {
  return !log.checkedIn && log.water > 0 && nothingRecorded({ ...log, water: 0 });
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
  const existing = store.getState().logs[date];
  let flowAnswered = existing != null && !onlyWater(existing);

  const isToday = date === todayKey();

  // 'Today' | 'Yesterday' | 'Tue 28 Jul'. The last of those reads wrong dropped
  // into a sentence bare or lowercased, so it gets an 'on' and keeps its caps.
  const when = fmtRelative(date);
  const whenLabel = when === 'Yesterday' ? 'yesterday' : when;
  const whenPhrase = when === 'Yesterday' ? 'yesterday' : `on ${when}`;

  let step = 0;

  /*
    Bleeding, mood and symptoms always. Sleep and water unless she has turned
    them off — both are answerable without fetching anything. Temperature only
    for someone who has shown she takes one.
  */
  const askSettings = store.getState().settings;
  const measureIds = habitualMeasures(store.getState().logs, todayKey(), CHECKIN_MEASURES, addDays);
  /** @type {((stale: () => boolean) => HTMLElement)[]} */
  const steps = [flowStep, moodStep, symptomStep];
  if (askSettings.askSleep) steps.push(sleepStep);
  if (askSettings.askWater) steps.push(waterStep);
  if (measureIds.length) {
    steps.push((stale) => measureStep(measureIds, draft, store.getState().settings, stale, next,
      isLast(steps.length - 1), openDiary));
  }
  /** @param {number} index */
  function isLast(index) { return index === steps.length - 1; }

  /*
    Straight into the full diary, carrying everything answered so far so
    nothing has to be re-entered. Offered on whichever question is last.
  */
  function openDiary() {
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
  }

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

    // What the book looked like before this day existed, so a sticker earned
    // by this very check-in can be told apart from the thirteen she already
    // had. Taken before the write for the obvious reason.
    const stickersBefore = earnedIds(stickerContext());

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

    /*
      The bigger beat is reserved for a logging milestone, and deliberately not
      for a cycle opening.

      A cycle opening was the obvious choice and it is the wrong one: whether a
      check-in starts a cycle is decided entirely by the flow she picked, so
      cheering there would mean a heavy day gets a bigger celebration than a
      quiet one. That is the mascot reacting to what was logged, which is the
      thing design rule 2 exists to prevent — and cheering at a period starting
      is celebrating a medical event besides.

      A streak is the one thing that is purely about her having shown up.
    */
    const streak = loggingStreak(store.getState().logs, draft.date, addDays);
    mascotReact(STREAK_MARKS.has(streak) ? 'cheer' : 'bob');

    /*
      A sticker earned by this check-in, said out loud once.

      The book itself is three taps away in Settings and she has no reason to
      go looking, so a collection nobody is ever told about is a collection
      that does not exist. One toast, at most one sticker, and never a nudge
      towards the ones she has not got — the empty slots are hers to find.

      The toast is silent and the two facts are announced together, rather than
      each calling `announce` for itself. A live region holds one message: the
      second call replaces the first, so a screen reader was hearing about the
      sticker *instead of* hearing that the day had saved. The confirmation is
      the part that must never be lost.
    */
    const won = newlyEarned(stickersBefore, stickerContext());
    if (won) toast(`Sticker earned — ${won.title}`, { silent: true });

    const confirmation = isToday ? 'Checked in for today' : `Checked in for ${whenLabel}`;
    announce(won ? `${confirmation}. Sticker earned, ${won.title}` : confirmation);
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
      options: FLOW_STEPS.map(({ id, note, wide }) => ({
        id,
        // Taken from the taxonomy rather than retyped here. The five words
        // existed twice, so renaming a level in one place left the app's
        // most-used screen quietly disagreeing with the diary and the report.
        label: labelFor('flow', id),
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

    /*
      The rating strip, under the chips rather than inside them.

      Putting it on the chip itself was the obvious shape and the wrong one:
      three targets inside a 64px tile leaves each of them too small to hit
      one-handed, and the words have to be abbreviated past the point of
      meaning anything. Below the grid, each row gets the full width, and —
      more importantly — it does not exist until she has picked something, so
      the days she has nothing to report look exactly as they always did.
    */
    const severity = severityBlock({
      label: (id) => (custom.has(id) ? id : labelFor('symptoms', id)),
      get: (id) => draft.severity[id],
      set: (id, value) => {
        if (value == null) delete draft.severity[id];
        else draft.severity[id] = value;
      },
    });

    const rated = () => [...draft.symptoms, ...draft.custom];

    // Coming back to this question must show the ratings she already gave,
    // not an empty block over a grid of ticked chips.
    severity.update(rated());

    return question({
      stale,
      title: 'Anything bothering you?',
      hint: 'Whatever your body is doing today.',
      multi: true,
      current: () => [...draft.symptoms, ...draft.custom],
      extra: severity.node,
      onChange: () => severity.update(rated()),
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
      lastStep: isLast(2),
      onNext: next,
      onMore: openDiary,
    });
  }

  /* ── 4. Sleep ──────────────────────────────────────────────────────── */

  /** @param {() => boolean} stale */
  function sleepStep(stale) {
    /*
      Two small answers on one screen rather than two screens: how long, and
      how well. Either can be left — "roughly seven, no idea how well" is a
      fine answer, and so is skipping the lot.

      Quality is stored as the symptoms that already exist for it, so it needs
      no new field and a restless night shows up in Patterns and on the report
      the way it always would have.
    */
    const qualityFrom = () => draft.symptoms.includes('insomnia') ? 'barely'
      : draft.symptoms.includes('restless-sleep') ? 'restless' : null;
    /** @type {string|null} */
    let quality = qualityFrom();
    const nearest = () => draft.sleep == null ? null
      : String(Math.min(10, Math.max(4, Math.round(draft.sleep))));

    const qualityButtons = SLEEP_QUALITY.map((option) => el('button', {
      type: 'button',
      class: 'checkin-option',
      'aria-pressed': String(quality === option.id),
      dataset: { opt: option.id },
      onclick: () => {
        if (stale()) return;
        haptic(10);
        quality = quality === option.id ? null : option.id;
        draft.symptoms = draft.symptoms.filter((id) => id !== 'restless-sleep' && id !== 'insomnia');
        const picked = SLEEP_QUALITY.find((q) => q.id === quality);
        if (picked?.symptom) draft.symptoms = [...draft.symptoms, picked.symptom];
        for (const b of qualityButtons) {
          b.setAttribute('aria-pressed', String(b.dataset.opt === quality));
        }
      },
    }, [option.label]));

    return question({
      stale,
      title: isToday ? 'How did you sleep last night?' : `How did you sleep, the night before ${whenLabel}?`,
      hint: 'Roughly is fine. Leave either part blank if you are not sure.',
      multi: true,
      columns: 4,
      current: () => { const n = nearest(); return n ? [n] : []; },
      options: SLEEP_HOURS.map((hours, i) => ({
        id: String(hours),
        label: i === 0 ? `${hours}h or less` : i === SLEEP_HOURS.length - 1 ? `${hours}h+` : `${hours}h`,
        selected: nearest() === String(hours),
        onPick: () => { draft.sleep = nearest() === String(hours) ? null : hours; },
      })),
      extra: el('div', { class: 'checkin-subgroup' }, [
        el('p', { class: 'checkin-sublabel', text: 'And how well?' }),
        el('div', { class: 'checkin-options is-3' }, qualityButtons),
      ]),
      lastStep: isLast(steps.indexOf(sleepStep)),
      onNext: next,
      onMore: openDiary,
    });
  }

  /* ── 5. Water ──────────────────────────────────────────────────────── */

  /** @param {() => boolean} stale */
  function waterStep(stale) {
    const settings = store.getState().settings;
    const glass = fmtWater(WATER_GLASS_ML, settings.unitWater);
    const glasses = Math.round(draft.water / WATER_GLASS_ML);
    const index = steps.indexOf(waterStep);
    /*
      "So far", because the check-in happens whenever she opens the app — in
      the morning that is one glass, at night it is the day's total. Either is
      honest, and the Today screen has a one-tap glass for adding the rest.
      Single tap answers and moves on, like the bleeding question.
    */
    return question({
      stale,
      title: isToday ? 'How much water so far today?' : `How much water ${whenPhrase}?`,
      hint: isToday
        ? `In glasses of about ${glass}. Add more later with one tap on Today.`
        : `In glasses of about ${glass}.`,
      columns: 3,
      options: WATER_CHOICES.map((n, i) => ({
        id: String(n),
        label: n === 0 ? 'None yet' : i === WATER_CHOICES.length - 1 ? `${n}+ glasses` : n === 1 ? '1 glass' : `${n} glasses`,
        selected: draft.water > 0 && Math.min(8, glasses) === n,
        onPick: () => {
          // Keep a total above eight that was built up a glass at a time.
          if (!(n === 8 && glasses > 8)) draft.water = n * WATER_GLASS_ML;
          next();
        },
      })),
      shortcut: { label: 'Skip', onPick: next },
      lastStep: isLast(index),
      onMore: openDiary,
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
 * The measurements she already keeps, asked in the daily fifteen seconds.
 *
 * `habitualMeasures` decides which — see the reasoning there. The short version
 * is that a woman charting her temperature every morning was being asked how
 * she felt and then left to go and find the one field that actually sharpens
 * her fertile window, four taps into a drawer, every single day. The question
 * follows the habit rather than being offered to everyone, so it costs nothing
 * to someone with no thermometer.
 *
 * Built on `question` with no options, because the frame — the heading that
 * takes focus, the stale-token guard, the Done button — is the part worth
 * sharing, and the answer here is a number rather than a chip.
 *
 * @param {string[]} ids
 * @param {DayLog} draft
 * @param {import('../domain/model.js').Settings} settings
 * @param {() => boolean} stale
 * @param {() => void} onNext
 * @param {boolean} lastStep
 * @param {() => void} onMore
 */
function measureStep(ids, draft, settings, stale, onNext, lastStep, onMore) {
  /*
    The same row the full diary uses, so a reading entered here obeys the same
    plausible range and the same units. This step first shipped with its own
    copy of the input that stored any number at all — a dropped decimal point
    became 366 °C in the database, which is the bug the diary's row was written
    to stop.
  */
  const rows = el('div', { class: 'checkin-measures' }, ids
    .map((id) => MEASURES.find((m) => m.id === id))
    .filter((measure) => measure != null)
    .map((measure) => measureRow({
      measure: /** @type {typeof MEASURES[number]} */ (measure),
      settings,
      get: () => /** @type {any} */ (draft)[/** @type {any} */ (measure).id],
      set: (value) => {
        if (stale()) return;
        /** @type {any} */ (draft)[/** @type {any} */ (measure).id] = value;
      },
    })));

  return question({
    stale,
    title: ids.length === 1 && ids[0] === 'bbt' ? 'This morning’s temperature' : 'Your numbers',
    /*
      A morning temperature is only answerable in the morning. Checked in at
      night without having taken it, she cannot give it — so the screen says
      plainly that blank is a fine answer, rather than leaving her staring at an
      empty field wondering if Done will accept it.
    */
    hint: ids.includes('bbt')
      ? (ids.length === 1
        ? 'Didn’t take it today? Leave it blank and tap Done — that’s fine.'
        : 'Leave blank anything you didn’t measure today — that’s fine.')
      : 'Leave blank anything you didn’t measure today — that’s fine.',
    multi: true,
    options: [],
    extra: rows,
    lastStep,
    onNext,
    onMore,
  });
}

/**
 * One question on its own screen.
 *
 * The parameter was an untyped destructure, which meant its shape was whatever
 * the existing call sites happened to agree on — so adding a caller that did
 * not pass `shortcut` or `onMore` broke the other three. Written down, the
 * optional parts are optional.
 *
 * @param {Object} spec
 * @param {string} spec.title
 * @param {string} spec.hint
 * @param {{id: string, label: string, selected: boolean, onPick: () => void,
 *   note?: string, wide?: boolean}[]} spec.options
 * @param {() => boolean} spec.stale   true once this question has been left
 * @param {{label: string, onPick: () => void}|null} [spec.shortcut]
 * @param {boolean} [spec.multi]       answers accumulate; show a Next button
 * @param {() => string[]} [spec.current]
 * @param {Node|null|false} [spec.extra]
 * @param {() => void} [spec.onChange]
 * @param {boolean} [spec.lastStep]    label the button Done rather than Next
 * @param {() => void} [spec.onNext]
 * @param {() => void} [spec.onMore]   open the full diary instead
 * @param {2|3|4} [spec.columns]       narrower answers, for numbers
 */
function question({ title, hint, options, stale, shortcut, multi, current, extra, onChange,
  lastStep, onNext, onMore, columns = 2 }) {
  const grid = el('div', { class: `checkin-options${columns === 2 ? '' : ` is-${columns}`}` });

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
        onChange?.();
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
    // tabindex so the step change can move focus here; data-autofocus so the
    // sheet lands on the question rather than on its own close button.
    el('h2', { class: 'checkin-title', tabindex: '-1', 'data-autofocus': '', text: title }),
    el('p', { class: 'hint', text: hint }),
    grid,
    extra,

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
