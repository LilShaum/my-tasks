// @ts-check
/**
 * log.js — the logging sheet.
 *
 * One bottom sheet with collapsible categories, one tap per chip, an Apply
 * button to commit. That mirrors Flo's interaction so it'll feel familiar, and
 * it means nothing is written until she says so — tapping around to see what's
 * available never leaves a record behind.
 *
 * Edits accumulate in a working copy. Apply writes it; closing discards it.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('../domain/model.js').DayLog} DayLog
 */

import { el, haptic, announce } from '../utils/dom.js';
import { fmtRelative, fmtLong, todayKey } from '../utils/date.js';
import {
  CATEGORIES, TESTS, MEASURES, WATER_GLASS_ML, WATER_GOAL_ML, labelFor,
} from '../data/taxonomy.js';
import { isLogEmpty, isBleeding } from '../domain/model.js';
import { openSheet, closeSheet } from '../ui/sheet.js';
import { burst } from '../ui/particles.js';
import { toast } from '../ui/toast.js';
import { getTheme } from '../data/themes.js';
import {
  cToF, fToC, kgToLb, lbToKg, mlToOz, fmtWater, round,
} from '../utils/fmt.js';
import * as store from '../state/store.js';

/** How many recently-used chips float to the top of a category. */
const RECENT_LIMIT = 6;

/**
 * Open the logging sheet for a date.
 * @param {DateKey} date
 */
export function openLogSheet(date) {
  const settings = store.getState().settings;

  /** Working copy. Nothing is committed until Apply. */
  const draft = structuredClone(store.getLog(date));
  const before = structuredClone(draft);

  const isFuture = date > todayKey();

  const body = [
    isFuture && el('div', { class: 'alert alert-warn' }, [
      el('span', { class: 'alert-icon', text: '!', 'aria-hidden': 'true' }),
      el('div', { text:
        'This day hasn’t happened yet. You can still make a note, but logging ' +
        'flow here would throw off your cycle predictions.' }),
    ]),

    ...CATEGORIES.map((cat) => categorySection(cat, draft, settings)),
    customSection(draft, settings),
    testsSection(draft),
    ...MEASURES.map((measure) => measureSection(measure, draft, settings)),
    waterSection(draft, settings),
    pillSection(draft),
    notesSection(draft),
  ];

  const footer = [
    el('button', {
      type: 'button',
      class: 'btn btn-block btn-lg',
      text: 'Apply',
      onclick: () => commit(date, draft, before),
    }),
  ];

  openSheet({
    title: fmtRelative(date),
    body,
    footer,
  });
}

/* ── Chip categories ────────────────────────────────────────────────────── */

/**
 * @param {import('../data/taxonomy.js').Category} cat
 * @param {DayLog} draft
 * @param {import('../domain/model.js').Settings} settings
 */
function categorySection(cat, draft, settings) {
  const single = cat.select === 'single';

  /** Current value(s) for this category on the draft. */
  const current = () => {
    const value = /** @type {any} */ (draft)[cat.id];
    if (single) return value == null ? [] : [String(value)];
    return Array.isArray(value) ? value : [];
  };

  // Recently-used first, then the rest in declaration order. Keeps the chips
  // she actually uses within reach without hiding anything.
  const recent = settings.recentChips
    .filter((id) => cat.options.some((o) => o.id === id))
    .slice(0, RECENT_LIMIT);
  const ordered = [
    ...recent.map((id) => cat.options.find((o) => o.id === id)).filter(Boolean),
    ...cat.options.filter((o) => !recent.includes(o.id)),
  ];

  const row = el('div', { class: 'chip-row' });

  for (const option of /** @type {import('../data/taxonomy.js').Option[]} */ (ordered)) {
    const chip = el('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(current().includes(option.id)),
      dataset: { opt: option.id },
      onclick: () => {
        toggle(cat, draft, option.id, single);
        // Repaint the whole row: single-select needs the others cleared, and
        // "none" clears its siblings in multi-select.
        for (const other of row.children) {
          const id = /** @type {HTMLElement} */ (other).dataset.opt;
          other.setAttribute('aria-pressed', String(id != null && current().includes(id)));
        }
        haptic(8);
      },
    }, [
      option.emoji && el('span', { 'aria-hidden': 'true', text: option.emoji }),
      el('span', { text: option.label }),
    ]);
    row.append(chip);
  }

  // Flow leads and stays open — it's the reason most people open this sheet.
  return section(cat.name, cat.hint, [row], {
    open: cat.id === 'flow',
    count: selectionCount(cat, draft),
  });
}

/**
 * @param {import('../data/taxonomy.js').Category} cat
 * @param {DayLog} draft
 * @param {string} id
 * @param {boolean} single
 */
function toggle(cat, draft, id, single) {
  const target = /** @type {any} */ (draft);

  if (single) {
    // Tapping the active option again clears it, except for flow where 'none'
    // is itself a meaningful answer.
    if (target[cat.id] === id) {
      target[cat.id] = cat.id === 'flow' ? 'none' : null;
    } else {
      target[cat.id] = id;
    }
    return;
  }

  /** @type {string[]} */
  const list = Array.isArray(target[cat.id]) ? [...target[cat.id]] : [];
  const at = list.indexOf(id);

  if (at >= 0) {
    list.splice(at, 1);
  } else if (id === 'none') {
    // "None" is exclusive: saying you had no discharge and then listing three
    // kinds of it is a contradiction, not a selection.
    target[cat.id] = ['none'];
    return;
  } else {
    list.push(id);
  }

  target[cat.id] = list.filter((x) => x !== 'none' || id === 'none');
}

/* ── Custom symptoms ────────────────────────────────────────────────────── */

/**
 * @param {DayLog} draft
 * @param {import('../domain/model.js').Settings} settings
 */
function customSection(draft, settings) {
  const row = el('div', { class: 'chip-row' });

  const paint = () => {
    row.replaceChildren();
    for (const name of store.getState().settings.customSymptoms) {
      const chip = el('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(draft.custom.includes(name)),
        onclick: () => {
          const at = draft.custom.indexOf(name);
          if (at >= 0) draft.custom.splice(at, 1);
          else draft.custom.push(name);
          chip.setAttribute('aria-pressed', String(draft.custom.includes(name)));
          haptic(8);
        },
      }, [el('span', { text: name })]);
      row.append(chip);
    }

    row.append(el('button', {
      type: 'button',
      class: 'chip chip-add',
      text: '+ Add your own',
      onclick: () => {
        const name = window.prompt('What would you like to track?')?.trim();
        if (!name) return;
        if (name.length > 40) {
          toast('That name is a bit long — 40 characters max');
          return;
        }
        const existing = store.getState().settings.customSymptoms;
        if (existing.some((s) => s.toLowerCase() === name.toLowerCase())) {
          toast('You already track that one');
          return;
        }
        store.updateSettings({ customSymptoms: [...existing, name] });
        draft.custom.push(name);
        paint();
        announce(`Added ${name}`);
      },
    }));
  };

  paint();

  return section(
    'Anything else',
    'Track whatever you like — it shows up in your patterns alongside everything else.',
    [row],
    { count: draft.custom.length },
  );
}

/* ── Tests ──────────────────────────────────────────────────────────────── */

/** @param {DayLog} draft */
function testsSection(draft) {
  return el('div', {}, TESTS.map((test) => {
    const row = el('div', { class: 'chip-row' });

    for (const option of test.options) {
      const chip = el('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(/** @type {any} */ (draft)[test.id] === option.id),
        dataset: { opt: option.id },
        onclick: () => {
          const target = /** @type {any} */ (draft);
          target[test.id] = target[test.id] === option.id ? null : option.id;
          for (const other of row.children) {
            const id = /** @type {HTMLElement} */ (other).dataset.opt;
            other.setAttribute('aria-pressed', String(target[test.id] === id));
          }
          haptic(8);
        },
      }, [
        option.emoji && el('span', { 'aria-hidden': 'true', text: option.emoji }),
        el('span', { text: option.label }),
      ]);
      row.append(chip);
    }

    return section(test.name, /** @type {any} */ (test).hint, [row],
      { count: /** @type {any} */ (draft)[test.id] ? 1 : 0 });
  }));
}

/* ── Numeric measures ───────────────────────────────────────────────────── */

/**
 * @param {typeof MEASURES[number]} measure
 * @param {DayLog} draft
 * @param {import('../domain/model.js').Settings} settings
 */
function measureSection(measure, draft, settings) {
  const unit = measure.unitSetting
    ? /** @type {any} */ (settings)[measure.unitSetting]
    : null;

  /** Stored value → the number shown in the input. */
  const toDisplay = (/** @type {number|null} */ v) => {
    if (v == null) return '';
    if (measure.id === 'bbt' && unit === 'F') return round(cToF(v), 1).toString();
    if (measure.id === 'weight' && unit === 'lb') return round(kgToLb(v), 1).toString();
    return round(v, measure.decimals).toString();
  };

  /** Typed number → the value we store. */
  const toStored = (/** @type {number} */ v) => {
    if (measure.id === 'bbt' && unit === 'F') return fToC(v);
    if (measure.id === 'weight' && unit === 'lb') return lbToKg(v);
    return v;
  };

  const unitLabel = measure.id === 'bbt' ? `°${unit}`
    : measure.id === 'weight' ? String(unit)
    : measure.id === 'sleep' ? 'hours'
    : 'steps';

  const input = el('input', {
    class: 'input num',
    type: 'number',
    inputmode: 'decimal',
    step: String(measure.step),
    placeholder: '—',
    value: toDisplay(/** @type {any} */ (draft)[measure.id]),
    'aria-label': `${measure.name} in ${unitLabel}`,
    style: { maxWidth: '140px' },
    oninput: (/** @type {Event} */ e) => {
      const raw = /** @type {HTMLInputElement} */ (e.target).value;
      const target = /** @type {any} */ (draft);
      if (raw === '') { target[measure.id] = null; return; }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      target[measure.id] = toStored(parsed);
    },
  });

  return section(measure.name, /** @type {any} */ (measure).hint, [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' } }, [
      input,
      el('span', { class: 'hint-sm', text: unitLabel }),
      el('button', {
        type: 'button',
        class: 'btn-ghost',
        text: 'Clear',
        style: { marginLeft: 'auto', minHeight: '36px', padding: '0 var(--sp-3)' },
        onclick: () => {
          /** @type {any} */ (draft)[measure.id] = null;
          /** @type {HTMLInputElement} */ (input).value = '';
        },
      }),
    ]),
  ], { count: /** @type {any} */ (draft)[measure.id] != null ? 1 : 0 });
}

/* ── Water ──────────────────────────────────────────────────────────────── */

/**
 * @param {DayLog} draft
 * @param {import('../domain/model.js').Settings} settings
 */
function waterSection(draft, settings) {
  const readout = el('span', { class: 'water-readout num' });
  const glasses = el('div', { class: 'water-glasses' });

  const total = () => Math.round(draft.water / WATER_GLASS_ML);
  const goalGlasses = Math.round(WATER_GOAL_ML / WATER_GLASS_ML);

  const paint = () => {
    readout.textContent =
      `${fmtWater(draft.water, settings.unitWater)} of ${fmtWater(WATER_GOAL_ML, settings.unitWater)}`;
    glasses.replaceChildren();
    for (let i = 0; i < goalGlasses; i++) {
      const filled = i < total();
      glasses.append(el('button', {
        type: 'button',
        class: `water-glass${filled ? ' is-filled' : ''}`,
        'aria-label': `${i + 1} ${i === 0 ? 'glass' : 'glasses'}`,
        'aria-pressed': String(filled),
        text: filled ? '◆' : '◇',
        onclick: () => {
          // Tapping the last filled glass empties it; otherwise fill to here.
          draft.water = (total() === i + 1) ? i * WATER_GLASS_ML : (i + 1) * WATER_GLASS_ML;
          paint();
          haptic(6);
        },
      }));
    }
  };

  paint();

  return section('Water', `One glass is ${fmtWater(WATER_GLASS_ML, settings.unitWater)}.`, [
    glasses,
    readout,
  ], { count: total() });
}

/* ── Pill ───────────────────────────────────────────────────────────────── */

/** @param {DayLog} draft */
function pillSection(draft) {
  const settings = store.getState().settings;
  if (settings.birthControl === 'none') return null;

  const toggleBtn = el('button', {
    type: 'button',
    class: 'toggle',
    role: 'switch',
    'aria-checked': String(draft.pillTaken),
    'aria-label': 'Birth control taken today',
    onclick: () => {
      draft.pillTaken = !draft.pillTaken;
      toggleBtn.setAttribute('aria-checked', String(draft.pillTaken));
      haptic(8);
    },
  });

  return section('Birth control', null, [
    el('div', { class: 'row', style: { padding: '0' } }, [
      el('span', { class: 'row-label', text: 'Taken today' }),
      toggleBtn,
    ]),
  ], { count: draft.pillTaken ? 1 : 0 });
}

/* ── Notes ──────────────────────────────────────────────────────────────── */

/** @param {DayLog} draft */
function notesSection(draft) {
  return section('Notes', null, [
    el('textarea', {
      class: 'input',
      rows: '3',
      maxlength: '2000',
      placeholder: 'Anything you want to remember about today',
      'aria-label': 'Notes',
      value: draft.notes,
      style: { resize: 'vertical', minHeight: '84px' },
      oninput: (/** @type {Event} */ e) => {
        draft.notes = /** @type {HTMLTextAreaElement} */ (e.target).value;
      },
    }),
  ], { count: draft.notes.trim() ? 1 : 0 });
}

/* ── Layout helper ──────────────────────────────────────────────────────── */

/**
 * A collapsible category.
 *
 * Everything expanded at once is 110-odd chips in a single scroll, which is
 * unusable on a phone. Collapsed by default, open when the category already
 * has something in it, so reopening a logged day shows you what you recorded
 * without hunting.
 *
 * Built on <details>/<summary> so keyboard operation and screen-reader
 * expanded/collapsed state come from the platform rather than from ARIA we'd
 * have to maintain.
 *
 * @param {string} title
 * @param {string|null|undefined} hint
 * @param {(Node|string|null|false)[]} children
 * @param {{open?: boolean, count?: number}} [opts]
 */
function section(title, hint, children, opts = {}) {
  const { open = false, count = 0 } = opts;

  return el('details', { class: 'log-section', open: open || count > 0 || null }, [
    el('summary', { class: 'log-section-head' }, [
      el('span', { class: 'log-section-title', text: title }),
      count > 0 && el('span', { class: 'badge badge-primary num', text: String(count) }),
      el('span', { class: 'log-chevron', 'aria-hidden': 'true', text: '⌄' }),
    ]),
    el('div', { class: 'log-section-body' }, [
      hint && el('p', { class: 'hint-sm', text: hint }),
      ...children,
    ]),
  ]);
}

/**
 * How many selections a category currently holds, for the summary badge.
 * @param {import('../data/taxonomy.js').Category} cat
 * @param {DayLog} draft
 */
function selectionCount(cat, draft) {
  const value = /** @type {any} */ (draft)[cat.id];
  if (Array.isArray(value)) return value.filter((v) => v !== 'none').length;
  if (cat.id === 'flow') return value && value !== 'none' ? 1 : 0;
  return value ? 1 : 0;
}

/* ── Commit ─────────────────────────────────────────────────────────────── */

/**
 * @param {DateKey} date
 * @param {DayLog} draft
 * @param {DayLog} before
 */
function commit(date, draft, before) {
  const settings = store.getState().settings;

  // Remember what she picked so those chips surface first next time.
  const picked = [
    ...draft.symptoms, ...draft.moods, ...draft.discharge,
    ...draft.activity, ...draft.other, ...draft.sex,
  ];
  if (picked.length) {
    const recent = [...new Set([...picked.reverse(), ...settings.recentChips])].slice(0, 24);
    store.updateSettings({ recentChips: recent });
  }

  store.putLog(draft);
  closeSheet();

  const nowEmpty = isLogEmpty(draft);
  const wasEmpty = isLogEmpty(before);

  if (nowEmpty && !wasEmpty) {
    toast(`Cleared ${fmtLong(date)}`);
    return;
  }
  if (nowEmpty) return;

  // Celebrate the act of logging, never what was logged. A heavy day and a
  // good day get exactly the same response.
  if (wasEmpty) {
    burst({ shape: getTheme(settings.theme).particle, count: 34 });
    haptic([10, 30, 10]);
  } else {
    haptic(12);
  }

  toast(summarise(draft, date));
}

/**
 * A short, factual recap of what was saved. No praise, no judgement.
 * @param {DayLog} log
 * @param {DateKey} date
 */
function summarise(log, date) {
  /** @type {string[]} */
  const bits = [];
  if (isBleeding(log.flow)) bits.push(labelFor('flow', log.flow).toLowerCase());
  else if (log.flow === 'spotting') bits.push('spotting');

  const chips = log.symptoms.length + log.moods.length + log.discharge.length
    + log.activity.length + log.other.length + log.sex.length + log.custom.length;
  if (chips) bits.push(`${chips} ${chips === 1 ? 'entry' : 'entries'}`);
  if (log.bbt != null) bits.push('temperature');
  if (log.notes.trim()) bits.push('a note');

  const when = date === todayKey() ? 'today' : fmtLong(date);
  return bits.length ? `Saved ${bits.join(', ')} for ${when}` : `Saved ${when}`;
}
