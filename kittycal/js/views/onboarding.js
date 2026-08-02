// @ts-check
/**
 * onboarding.js — first-run setup.
 *
 * Structure borrowed from Flo, minus the part where it collects data and then
 * asks you to make an account to keep it. There is no account here, so the flow
 * exists purely to seed the prediction engine.
 *
 * Every question is skippable and every answer is editable later from Settings
 * — the app has to be useful to someone who taps through in fifteen seconds.
 * The only step that can't be skipped is the disclaimer, because "this is not
 * contraception" is not an optional detail.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 */

import { el, replace, need, haptic } from '../utils/dom.js';
import { todayKey, addDays, fmtLong, daysBetween } from '../utils/date.js';
import { BIRTH_CONTROL } from '../domain/model.js';
import { themePicker, setPickerSelection } from '../ui/theme-picker.js';
import { mascot, spotArt } from '../ui/mascot.js';
import { applyTheme } from '../ui/theme.js';
import * as store from '../state/store.js';
import { burst } from '../ui/particles.js';
import { getTheme } from '../data/themes.js';

/**
 * Draft answers. Held locally and committed to settings only at the end, so
 * backing out of onboarding doesn't leave half-applied values — with the one
 * exception of the theme, which is applied live because previewing it is the
 * entire point of that step.
 */
const draft = {
  /** @type {string} */ theme: 'hellokitty',
  /** @type {string} */ name: '',
  /** @type {number|null} */ birthYear: null,
  /** @type {DateKey|null} */ lastPeriodStart: null,
  /** @type {number} */ periodLength: 5,
  /** @type {number} */ cycleLength: 28,
  /** @type {boolean} */ cycleUnknown: false,
  /** @type {string} */ birthControl: 'none',
};

let stepIndex = 0;

/** @type {(() => void)|null} */
let onComplete = null;

const STEPS = [
  stepTheme,
  stepName,
  stepAge,
  stepLastPeriod,
  stepPeriodLength,
  stepCycleLength,
  stepBirthControl,
  stepDisclaimer,
];

/**
 * Mount the onboarding flow.
 * @param {HTMLElement} host
 * @param {{theme: string, onDone: () => void}} opts
 */
export function mountOnboarding(host, { theme, onDone }) {
  draft.theme = theme;
  stepIndex = 0;
  onComplete = onDone;

  host.replaceChildren(
    el('div', { class: 'onb' }, [
      el('div', { class: 'onb-progress', id: 'onb-progress', 'aria-hidden': 'true' }),
      el('div', { class: 'onb-body', id: 'onb-body' }),
      el('div', { class: 'onb-foot', id: 'onb-foot' }),
    ]),
  );

  render();
}

function render() {
  renderProgress();
  const body = need('#onb-body');
  const foot = need('#onb-foot');

  const step = STEPS[stepIndex]();

  replace(body, [el('div', { class: 'onb-step pop-in' }, step.content)]);
  replace(foot, step.footer);

  // Move focus to the step heading so a screen reader announces the new
  // question rather than leaving focus on a button that no longer exists.
  const heading = body.querySelector('h2');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    /** @type {HTMLElement} */ (heading).focus({ preventScroll: true });
  }
}

function renderProgress() {
  const host = need('#onb-progress');
  replace(host, STEPS.map((_, i) =>
    el('span', { class: 'onb-pip', dataset: { done: String(i <= stepIndex) } }),
  ));
}

function next() {
  haptic(10);
  if (stepIndex < STEPS.length - 1) {
    stepIndex++;
    render();
  } else {
    finish();
  }
}

function back() {
  if (stepIndex === 0) return;
  stepIndex--;
  render();
}

/**
 * Standard footer: a primary action plus optional skip and back.
 * @param {Object} opts
 * @param {string} [opts.nextLabel]
 * @param {boolean} [opts.canSkip]
 * @param {() => void} [opts.onNext]
 * @param {boolean} [opts.disabled]
 */
function footer({ nextLabel = 'Continue', canSkip = true, onNext, disabled = false } = {}) {
  return [
    el('button', {
      type: 'button',
      class: 'btn btn-block btn-lg',
      text: nextLabel,
      disabled: disabled || null,
      onclick: () => { onNext ? onNext() : next(); },
    }),
    el('div', { style: { display: 'flex', gap: 'var(--sp-2)' } }, [
      stepIndex > 0 && el('button', {
        type: 'button', class: 'btn btn-ghost', text: '← Back',
        style: { flex: '1' },
        onclick: back,
      }),
      canSkip && el('button', {
        type: 'button', class: 'btn btn-ghost', text: 'Skip',
        style: { flex: '1' },
        onclick: next,
      }),
    ]),
  ];
}

/* ── Steps ──────────────────────────────────────────────────────────────── */

/** Theme first: it's the most fun question and it makes the rest feel hers. */
function stepTheme() {
  const grid = themePicker({
    selected: draft.theme,
    onPick: (id) => {
      draft.theme = id;
      // Applied live — previewing is the whole point of this step.
      applyTheme(id, 'auto');
      setPickerSelection(grid, id);
      haptic(8);
    },
  });

  return {
    content: [
      el('div', { class: 'onb-art' }, [mascot(draft.theme, { size: 128 })]),
      el('h2', { text: 'Hi! Pick your look.' }),
      el('p', { class: 'hint', text:
        'This sets the colours and the little friend in the corner. You can ' +
        'change it any time, and there are fourteen of them.' }),
      grid,
    ],
    footer: footer({ canSkip: false }),
  };
}

function stepName() {
  const input = el('input', {
    class: 'input',
    type: 'text',
    id: 'onb-name',
    value: draft.name,
    placeholder: 'Your name',
    autocomplete: 'given-name',
    maxlength: '40',
    oninput: (/** @type {Event} */ e) => {
      draft.name = /** @type {HTMLInputElement} */ (e.target).value.trim();
    },
  });

  return {
    content: [
      el('h2', { text: 'What should I call you?' }),
      el('p', { class: 'hint', text:
        'Only used to say hello. It stays on this device — there is no account ' +
        'and nothing to sign into.' }),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'onb-name', text: 'Name (optional)' }),
        input,
      ]),
    ],
    footer: footer(),
  };
}

function stepAge() {
  const thisYear = new Date().getFullYear();

  const input = el('input', {
    class: 'input',
    type: 'number',
    id: 'onb-year',
    inputmode: 'numeric',
    min: String(thisYear - 70),
    max: String(thisYear - 8),
    placeholder: 'e.g. 2001',
    value: draft.birthYear ? String(draft.birthYear) : '',
    oninput: (/** @type {Event} */ e) => {
      const value = Number(/** @type {HTMLInputElement} */ (e.target).value);
      draft.birthYear = Number.isFinite(value) && value > 1900 ? value : null;
    },
  });

  return {
    content: [
      el('h2', { text: 'Which year were you born?' }),
      el('p', { class: 'hint', text:
        'Cycles shift over a lifetime, so this helps Kittycal know what is ' +
        'typical for you. Skip it if you would rather not.' }),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'onb-year', text: 'Birth year (optional)' }),
        input,
      ]),
    ],
    footer: footer(),
  };
}

/** The one answer that actually matters for predictions. */
function stepLastPeriod() {
  const today = todayKey();
  const chosen = el('p', {
    class: 'hint',
    id: 'onb-lp-label',
    text: draft.lastPeriodStart
      ? `${fmtLong(draft.lastPeriodStart)} — ${describeAgo(draft.lastPeriodStart)}`
      : 'Nothing picked yet.',
  });

  const input = el('input', {
    class: 'input',
    type: 'date',
    id: 'onb-lastperiod',
    max: today,
    min: addDays(today, -400),
    value: draft.lastPeriodStart ?? '',
    onchange: (/** @type {Event} */ e) => {
      const value = /** @type {HTMLInputElement} */ (e.target).value;
      draft.lastPeriodStart = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? /** @type {DateKey} */ (value)
        : null;
      chosen.textContent = draft.lastPeriodStart
        ? `${fmtLong(draft.lastPeriodStart)} — ${describeAgo(draft.lastPeriodStart)}`
        : 'Nothing picked yet.';
    },
  });

  /** Quick picks, because most people know it in relative terms. */
  const quick = el('div', { class: 'chip-row' }, [0, 3, 7, 14, 21, 28].map((ago) =>
    el('button', {
      type: 'button',
      class: 'chip',
      text: ago === 0 ? 'Today' : `${ago}d ago`,
      onclick: () => {
        draft.lastPeriodStart = addDays(today, -ago);
        /** @type {HTMLInputElement} */ (input).value = draft.lastPeriodStart;
        chosen.textContent =
          `${fmtLong(draft.lastPeriodStart)} — ${describeAgo(draft.lastPeriodStart)}`;
        haptic(8);
      },
    }),
  ));

  return {
    content: [
      el('h2', { text: 'When did your last period start?' }),
      el('p', { class: 'hint', text:
        'The first day of bleeding. A rough guess is fine — every prediction ' +
        'gets better as you log, and you can correct this on the calendar later.' }),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'onb-lastperiod', text: 'First day' }),
        input,
      ]),
      quick,
      chosen,
    ],
    footer: footer(),
  };
}

/** @param {DateKey} key */
function describeAgo(key) {
  const days = -daysBetween(todayKey(), key);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function stepPeriodLength() {
  return {
    content: [
      el('h2', { text: 'How many days does your period usually last?' }),
      el('p', { class: 'hint', text:
        'Counting from the first day of bleeding to the last. Most people land ' +
        'between three and seven.' }),
      stepper({
        value: draft.periodLength,
        min: 1,
        max: 14,
        unit: 'days',
        label: 'Period length',
        onChange: (v) => { draft.periodLength = v; },
      }),
    ],
    footer: footer(),
  };
}

function stepCycleLength() {
  const unsure = el('button', {
    type: 'button',
    class: 'choice',
    'aria-pressed': String(draft.cycleUnknown),
    onclick: () => {
      draft.cycleUnknown = !draft.cycleUnknown;
      unsure.setAttribute('aria-pressed', String(draft.cycleUnknown));
      haptic(8);
    },
  }, [
    el('span', { class: 'choice-emoji', text: '🤷' }),
    el('span', { class: 'choice-text' }, [
      'I am not sure',
      el('span', { class: 'choice-sub', text:
        'Kittycal will start at 28 days and learn your real number as you log.' }),
    ]),
  ]);

  return {
    content: [
      el('h2', { text: 'How long is your cycle?' }),
      el('p', { class: 'hint', text:
        'First day of one period to the day before the next. If it moves ' +
        'around, put roughly the middle — this is a starting point, not a rule.' }),
      stepper({
        value: draft.cycleLength,
        min: 15,
        max: 60,
        unit: 'days',
        label: 'Cycle length',
        onChange: (v) => { draft.cycleLength = v; draft.cycleUnknown = false;
          unsure.setAttribute('aria-pressed', 'false'); },
      }),
      unsure,
    ],
    footer: footer(),
  };
}

function stepBirthControl() {
  const list = el('div', { class: 'choice-list' });

  for (const option of BIRTH_CONTROL) {
    const row = el('button', {
      type: 'button',
      class: 'choice',
      'aria-pressed': String(draft.birthControl === option.id),
      dataset: { bc: option.id },
      onclick: () => {
        draft.birthControl = option.id;
        for (const child of list.children) {
          child.setAttribute(
            'aria-pressed',
            String(/** @type {HTMLElement} */ (child).dataset.bc === option.id),
          );
        }
        haptic(8);
      },
    }, [el('span', { class: 'choice-text', text: option.label })]);
    list.append(row);
  }

  return {
    content: [
      el('h2', { text: 'Are you using birth control?' }),
      el('p', { class: 'hint', text:
        'Hormonal methods stop ovulation, so Kittycal hides fertility ' +
        'estimates when one is selected rather than showing you a number that ' +
        'does not mean anything.' }),
      list,
    ],
    footer: footer(),
  };
}

/** Not skippable. */
function stepDisclaimer() {
  return {
    content: [
      el('div', { class: 'onb-art' }, [spotArt('lock', { size: 112, className: '' })]),
      el('h2', { text: 'Two things before you start' }),
      el('div', { class: 'alert alert-info' }, [
        el('span', { class: 'alert-icon', text: 'i', 'aria-hidden': 'true' }),
        el('div', {}, [
          el('strong', { text: 'This is not birth control.' }),
          ' Predicted periods, fertile windows and ovulation days are ' +
          'estimates based on your own logs. They are not a contraceptive ' +
          'method and not medical advice. For anything that worries you, ' +
          'please talk to a doctor.',
        ]),
      ]),
      el('div', { class: 'note' }, [
        el('span', { class: 'note-icon', text: '♥', 'aria-hidden': 'true' }),
        el('div', {}, [
          el('strong', { text: 'Your data never leaves this device.' }),
          ' Kittycal has no account, no server and makes no internet requests ' +
          'at all. Everything you log is stored in this browser, and you can ' +
          'export or erase all of it whenever you like.',
        ]),
      ]),
    ],
    footer: [
      el('button', {
        type: 'button',
        class: 'btn btn-block btn-lg',
        text: 'Got it — let’s go',
        onclick: finish,
      }),
      el('button', {
        type: 'button', class: 'btn btn-ghost', text: '← Back',
        onclick: back,
      }),
    ],
  };
}

/* ── A reusable numeric stepper ─────────────────────────────────────────── */

/**
 * @param {Object} opts
 * @param {number} opts.value
 * @param {number} opts.min
 * @param {number} opts.max
 * @param {string} opts.unit
 * @param {string} opts.label
 * @param {(v: number) => void} opts.onChange
 */
function stepper({ value, min, max, unit, label, onChange }) {
  let current = value;

  const readout = el('div', { class: 'stepper-value num' }, [
    el('span', { id: 'stepper-num', text: String(current) }),
    el('span', { class: 'stepper-unit', text: unit }),
  ]);

  /** @param {number} delta */
  const bump = (delta) => {
    current = Math.min(max, Math.max(min, current + delta));
    const num = readout.querySelector('#stepper-num');
    if (num) num.textContent = String(current);
    slider.value = String(current);
    onChange(current);
    haptic(8);
  };

  const slider = /** @type {HTMLInputElement} */ (el('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    value: String(current),
    'aria-label': label,
    style: { width: '100%', accentColor: 'var(--primary)' },
    oninput: (/** @type {Event} */ e) => {
      current = Number(/** @type {HTMLInputElement} */ (e.target).value);
      const num = readout.querySelector('#stepper-num');
      if (num) num.textContent = String(current);
      onChange(current);
    },
  }));

  return el('div', { class: 'card-tinted', style: { display: 'grid', gap: 'var(--sp-3)' } }, [
    el('div', { class: 'stepper' }, [
      el('button', {
        type: 'button', class: 'btn-icon', 'aria-label': `Decrease ${label}`,
        style: { border: 'var(--bw) solid var(--line)', background: 'var(--card)' },
        text: '−',
        onclick: () => bump(-1),
      }),
      readout,
      el('button', {
        type: 'button', class: 'btn-icon', 'aria-label': `Increase ${label}`,
        style: { border: 'var(--bw) solid var(--line)', background: 'var(--card)' },
        text: '+',
        onclick: () => bump(1),
      }),
    ]),
    slider,
  ]);
}

/* ── Commit ─────────────────────────────────────────────────────────────── */

function finish() {
  store.updateSettings({
    theme: draft.theme,
    name: draft.name,
    birthYear: draft.birthYear,
    avgPeriodLength: draft.periodLength,
    avgCycleLength: draft.cycleUnknown ? 28 : draft.cycleLength,
    birthControl: draft.birthControl,
    onboarded: true,
    disclaimerAck: true,
  });

  // Seed the first period from her answer, so the app has real data to predict
  // from on the very first screen instead of an empty state.
  if (draft.lastPeriodStart) {
    const days = [];
    for (let i = 0; i < draft.periodLength; i++) {
      const day = addDays(draft.lastPeriodStart, i);
      if (day > todayKey()) break; // never mark the future as bled
      days.push(day);
    }
    store.setPeriodDays(days, true);
  }

  haptic([12, 40, 12]);
  burst({ shape: getTheme(draft.theme).particle, count: 54 });
  onComplete?.();
}
