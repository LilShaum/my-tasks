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

import { el, svg, haptic, announce } from '../utils/dom.js';
import { fmtRelative, fmtLong, todayKey } from '../utils/date.js';
import {
  CATEGORIES, TESTS, MEASURES, WATER_GLASS_ML, WATER_GOAL_ML, labelFor,
  optionMatches, normalizeQuery, DEFAULT_CHIPS, severityLabel,
} from '../data/taxonomy.js';
import { nothingRecorded, isBleeding } from '../domain/model.js';
import { openSheet, closeSheet } from '../ui/sheet.js';
import { severityBlock } from '../ui/severity.js';
import { burst } from '../ui/particles.js';
import { toast } from '../ui/toast.js';
import { promptSheet } from '../ui/dialog.js';
import { getTheme } from '../data/themes.js';
import { mascotReact } from '../ui/mascot.js';
import {
  cToF, fToC, kgToLb, lbToKg, mlToOz, fmtWater, fmtTemp, fmtWeight, round,
} from '../utils/fmt.js';
import { buildCycles, cycleDay } from '../domain/cycles.js';
import { predict } from '../domain/predict.js';
import { phaseFor } from '../domain/phases.js';
import * as store from '../state/store.js';

/** How many recently-used chips float to the top of a category. */
const RECENT_LIMIT = 6;

/**
 * How many chips the quick row shows at most.
 *
 * Six, not eight: eight wrapped to three rows on a phone and pushed the Flow
 * section — the reason most people open this sheet at all — off the first
 * screen. A shortcut that buries the main control is not a shortcut.
 */
const QUICK_LIMIT = 6;

/**
 * And how few it takes before showing it at all. Two chips is not a shortcut,
 * it is a row of clutter above the thing she was going to use anyway.
 */
const QUICK_MIN = 3;

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

  const chips = sheetState(draft);
  // A day with no saved log has never been answered — see chipRegistry.
  chips.setFlowAnswered(store.getState().logs[date] != null);

  const sections = [
    ...CATEGORIES.map((cat) => categorySection(cat, draft, settings, chips)),
    customSection(draft, settings, chips),
    testsSection(draft, chips),
    measurementsSection(draft, settings, chips),
    pillSection(draft),
    notesSection(draft),
  ];

  const body = [
    daySummary(date, before),

    isFuture && el('div', { class: 'alert alert-warn' }, [
      el('span', { class: 'alert-icon', text: '!', 'aria-hidden': 'true' }),
      el('div', { text:
        'This day hasn’t happened yet. You can still make a note, but logging ' +
        'flow here would throw off your cycle predictions.' }),
    ]),

    quickRow(draft, settings, chips),
    searchBar(),
    ...sections,
  ];

  // Paint every chip from the draft once the whole tree exists, so the quick
  // row and its section counterparts start out agreeing.
  chips.sync();

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

/* ── Day summary ────────────────────────────────────────────────────────── */

/**
 * What this day already looks like, shown before any of the editing controls.
 *
 * Tapping a date on the calendar used to drop you straight into a wall of
 * chips, which answers "what do you want to change" but not "what happened
 * that day" — and the second question is the one you're usually asking when
 * you tap a date in the past.
 *
 * Two parts: where the day sat in the cycle, and a plain list of everything
 * recorded. Both read-only. This is a data zone, so no bounce and no mascot.
 *
 * @param {DateKey} date
 * @param {DayLog} log  the saved state, not the working draft
 */
function daySummary(date, log) {
  const { settings, periodDays, logs } = store.getState();
  const cycles = buildCycles(periodDays);
  const prediction = predict({ periodDays, settings, today: todayKey(), logs });
  const phase = phaseFor({ date, cycles, prediction });
  const day = cycleDay(cycles, date);

  const logged = !nothingRecorded(log);

  /** @type {string[]} */
  const entries = [];
  if (log.flow !== 'none') entries.push(labelFor('flow', log.flow));
  for (const [category, ids] of /** @type {[string, string[]][]} */ ([
    ['moods', log.moods], ['symptoms', log.symptoms], ['discharge', log.discharge],
    ['sex', log.sex], ['activity', log.activity], ['other', log.other],
  ])) {
    for (const id of ids) {
      if (id === 'none') continue;
      entries.push(withSeverity(labelFor(category, id), log.severity[id]));
    }
  }
  for (const name of log.custom) entries.push(withSeverity(name, log.severity[name]));
  if (log.drive) entries.push(`${labelFor('drive', log.drive)} sex drive`);
  if (log.bbt != null) entries.push(fmtTemp(log.bbt, settings.unitTemp));
  if (log.weight != null) entries.push(fmtWeight(log.weight, settings.unitWeight));
  if (log.water) entries.push(fmtWater(log.water, settings.unitWater));
  if (log.sleep != null) entries.push(`${log.sleep}h sleep`);
  if (log.steps != null) entries.push(`${log.steps} steps`);
  if (log.pillTaken) entries.push('Birth control taken');
  if (log.testPregnancy) entries.push(`Pregnancy test: ${log.testPregnancy}`);
  if (log.testOvulation) entries.push(`Ovulation test: ${log.testOvulation}`);

  /*
    On a day with nothing logged this collapses to a single line.

    It used to be a two-line block whichever day you opened: a phase line, a
    date, and a paragraph reading "Nothing logged for this day yet" — roughly a
    fifth of the first screen spent saying that the controls below are empty,
    which they visibly are. The sentence earns its space on a *past* day, where
    "nothing here" is a real answer to why you tapped the date; it earns
    nothing on today, where you have come to log something.
  */
  return el('div', { class: `day-summary data-zone${logged ? '' : ' is-empty'}` }, [
    el('div', { class: 'day-summary-head' }, [
      el('span', {
        class: 'phase-dot',
        style: { background: `var(${phase.token})` },
        'aria-hidden': 'true',
      }),
      el('span', { class: 'day-summary-phase', text:
        day != null ? `Day ${day} · ${phase.name}` : phase.name }),
      !logged && date < todayKey()
        && el('span', { class: 'hint-sm', text: '· nothing logged' }),
      el('span', { class: 'day-summary-date num', text: fmtLong(date) }),
    ]),

    logged && el('ul', { class: 'day-summary-list' }, entries.map((entry) =>
      el('li', { class: 'badge', text: entry }),
    )),

    log.notes.trim() && el('p', { class: 'day-summary-note', text: log.notes }),
  ]);
}

/* ── Search ─────────────────────────────────────────────────────────────── */

/**
 * A search box over every chip in the sheet.
 *
 * With ~110 options behind collapsed categories, "where is bloating" is the
 * commonest thing anyone will want to do. Typing filters chips across all
 * categories at once, opens the ones that match, and hides the ones that
 * don't — so the answer is two or three keystrokes away instead of a scroll
 * and a guess about which category it lives under.
 *
 * Operates on the rendered DOM rather than re-rendering, so nothing already
 * selected in the draft is disturbed by searching.
 */
function searchBar() {
  /** Remembers which sections were open before a search, to restore after. */
  /** @type {WeakMap<HTMLElement, boolean>} */
  const wasOpen = new WeakMap();
  let searching = false;

  const count = el('span', { class: 'search-count hint-sm', 'aria-live': 'polite' });

  const input = /** @type {HTMLInputElement} */ (el('input', {
    class: 'input search-input',
    type: 'search',
    placeholder: 'Search symptoms, moods, anything…',
    'aria-label': 'Search everything you can log',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    oninput: () => apply(input.value),
  }));

  const clear = el('button', {
    type: 'button',
    class: 'btn-ghost search-clear',
    text: 'Clear',
    'aria-label': 'Clear search',
    hidden: true,
    onclick: () => { input.value = ''; apply(''); input.focus(); },
  });

  /** @param {string} raw */
  function apply(raw) {
    const query = normalizeQuery(raw);
    const sheet = input.closest('.sheet-body');
    if (!sheet) return;

    // Nothing to clear when the box is empty, and a permanently-lit Clear
    // button beside an empty field reads as an action that does something.
    clear.hidden = raw === '';

    // The quick row is a shortcut past searching. While a search is running it
    // is just chips that ignore the filter, sitting above chips that obey it.
    const quick = /** @type {HTMLElement|null} */ (sheet.querySelector('.quick-row'));
    if (quick) quick.hidden = query !== '';

    const sections = /** @type {HTMLElement[]} */ (
      [...sheet.querySelectorAll('.log-section')]
    );

    // Entering a search: remember the current open/closed state once, so
    // clearing the box puts everything back exactly as she left it.
    if (query && !searching) {
      for (const section of sections) {
        wasOpen.set(section, /** @type {HTMLDetailsElement} */ (section).open);
      }
      searching = true;
    }

    if (!query) {
      for (const section of sections) {
        section.hidden = false;
        /** @type {HTMLDetailsElement} */ (section).open = wasOpen.get(section) ?? false;
        for (const chip of section.querySelectorAll('.chip')) {
          /** @type {HTMLElement} */ (chip).hidden = false;
        }
      }
      searching = false;
      count.textContent = '';
      return;
    }

    let hits = 0;

    for (const section of sections) {
      const chips = /** @type {HTMLElement[]} */ ([...section.querySelectorAll('.chip')]);

      // Sections without chips (notes, water, temperature) can't be searched
      // by label, so match them on their own title instead.
      if (!chips.length) {
        const title = section.querySelector('.log-section-title')?.textContent ?? '';
        const match = normalizeQuery(title).includes(query);
        section.hidden = !match;
        if (match) { hits++; /** @type {HTMLDetailsElement} */ (section).open = true; }
        continue;
      }

      let sectionHits = 0;
      for (const chip of chips) {
        /*
          `dataset.label`, not `textContent`.

          Every option carries an emoji, and the chip renders it as a sibling
          span — so `textContent` came back as "🤢Nausea", which normalises to
          "🤢nausea" and starts with neither the query nor any word in it.
          Searching for an option by its own name matched nothing, for all 104
          of them, from the day the search was added.

          It looked like it worked because roughly twenty options also carry
          hand-written synonyms, and those are clean strings — so "sore boobs"
          found tender breasts while "tender" did not.
        */
        const label = chip.dataset.label ?? chip.textContent ?? '';
        const id = chip.dataset.opt ?? '';
        const match = optionMatches({ id, label }, query);
        chip.hidden = !match;
        if (match) sectionHits++;
      }

      hits += sectionHits;
      section.hidden = sectionHits === 0;
      if (sectionHits) /** @type {HTMLDetailsElement} */ (section).open = true;
    }

    count.textContent = hits === 0
      ? 'Nothing matches that'
      : `${hits} ${hits === 1 ? 'match' : 'matches'}`;
  }

  return el('div', { class: 'search-wrap' }, [input, clear, count]);
}

/**
 * "Cramps (severe)", or just "Cramps" when she did not say.
 *
 * Parenthesised rather than prefixed so the list still scans by the thing that
 * happened — a summary whose lines half begin with "Severe" is harder to read
 * down than one whose lines begin with what it was.
 *
 * @param {string} label
 * @param {number|undefined} value
 */
function withSeverity(label, value) {
  const word = severityLabel(value);
  return word ? `${label} (${word.toLowerCase()})` : label;
}

/* ── Chip categories ────────────────────────────────────────────────────── */

/**
 * @param {import('../data/taxonomy.js').Category} cat
 * @param {DayLog} draft
 * @param {import('../domain/model.js').Settings} settings
 */
function categorySection(cat, draft, settings, chips) {
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
    row.append(chips.make(cat, option, draft));
  }

  /*
    Symptoms are the only category where "how bad" is a real question. A mood
    does not have an intensity in any sense she could answer consistently, and
    flow already has one built into its levels.
  */
  const rating = cat.id === 'symptoms' ? symptomSeverity(draft, chips) : null;

  // Flow leads and stays open — it's the reason most people open this sheet.
  const node = section(cat.name, cat.hint, [row, rating], {
    open: cat.id === 'flow',
    count: selectionCount(cat, draft),
  });

  const badge = /** @type {HTMLElement|null} */ (node.querySelector('.count-badge'));
  if (badge) chips.watchBadge(cat, badge);

  return node;
}

/**
 * The severity strip for a set of symptoms.
 *
 * Two of these exist — one under the built-in symptom chips and one under her
 * own — because the two live in different fields on the log and in different
 * sections on the sheet, and a single combined block would list a symptom from
 * a section that is not on screen.
 *
 * @param {DayLog} draft
 * @param {ReturnType<typeof sheetState>} chips
 * @param {'symptoms'|'custom'} [field]
 */
function symptomSeverity(draft, chips, field = 'symptoms') {
  const block = severityBlock({
    // Custom symptoms are stored as the text she typed, so the id is the label.
    label: (id) => (field === 'custom' ? id : labelFor('symptoms', id)),
    get: (id) => draft.severity[id],
    set: (id, value) => {
      if (value == null) delete draft.severity[id];
      else draft.severity[id] = value;
    },
  });

  chips.watchSeverity(block, () => draft[field]);
  return block.node;
}

/**
 * The sheet's live UI state: every chip, and every count badge.
 *
 * The same option can now appear twice — once in its category and once in the
 * quick row at the top — and the two must never disagree about whether it is
 * selected. Rather than have the quick row reach into the sections and fake
 * clicks, both are built here and registered against their option, so one
 * `sync()` repaints all of them from the draft.
 *
 * That also fixes something that was already slightly wrong: tapping a chip
 * used to repaint only its own row, so "none" clearing its siblings was
 * correct on screen but any duplicate elsewhere would have gone stale.
 *
 * @param {DayLog} draft
 */
function sheetState(draft) {
  /** @type {{cat: import('../data/taxonomy.js').Category, id: string, node: HTMLElement}[]} */
  const all = [];

  /**
   * What is selected in a category right now.
   * @param {import('../data/taxonomy.js').Category} cat
   */
  const current = (cat) => {
    const value = /** @type {any} */ (draft)[cat.id];
    if (cat.select === 'single') return value == null ? [] : [String(value)];
    return Array.isArray(value) ? value : [];
  };

  /**
   * Flow is single-select with `none` as its stored default, so an untouched
   * day would otherwise open with "No bleeding" already ticked — presenting an
   * assumption as her answer, while the summary directly above it says nothing
   * is logged. Until she actually answers, flow shows nothing selected.
   */
  let flowAnswered = false;

  /** @param {boolean} answered */
  const setFlowAnswered = (answered) => { flowAnswered = answered; };

  /** @type {{node: HTMLElement, count: () => number}[]} */
  const badges = [];

  /** @type {{block: import('../ui/severity.js').SeverityBlock, ids: () => string[]}[]} */
  const severities = [];

  const sync = () => {
    for (const { cat, id, node } of all) {
      const selected = cat.id === 'flow' && !flowAnswered
        ? false
        : current(cat).includes(id);
      node.setAttribute('aria-pressed', String(selected));
    }

    for (const { node, count } of badges) {
      const n = count();
      node.textContent = String(n);
      node.hidden = n === 0;
    }

    for (const { block, ids } of severities) block.update(ids());
  };

  return {
    setFlowAnswered,
    sync,

    /**
     * A rating block, repainted whenever the selection changes.
     *
     * Registered here rather than updated from the chip that changed, because
     * a symptom can be deselected from three places — its own chip, the quick
     * row at the top, and "none" clearing the category — and only the first
     * of those knows which symptom it was.
     *
     * @param {import('../ui/severity.js').SeverityBlock} block
     * @param {() => string[]} ids  the symptoms this block rates
     */
    watchSeverity(block, ids) { severities.push({ block, ids }); },

    /**
     * @param {import('../data/taxonomy.js').Category} cat
     * @param {HTMLElement} node
     */
    watchBadge(cat, node) {
      badges.push({
        node,
        // Flow reads as zero until she answers it, matching its chips.
        count: () => (cat.id === 'flow' && !flowAnswered ? 0 : selectionCount(cat, draft)),
      });
    },

    /**
     * Same, for a section whose contents are not chips — Measurements and
     * Tests count typed values and tapped glasses, so they hand over their own
     * counting function rather than a category.
     * @param {HTMLElement} node
     * @param {() => number} count
     */
    watchCount(node, count) { badges.push({ node, count }); },

    /**
     * @param {import('../data/taxonomy.js').Category} cat
     * @param {import('../data/taxonomy.js').Option} option
     * @param {DayLog} d
     * @param {{compact?: boolean}} [opts]
     */
    make(cat, option, d, opts = {}) {
      const node = el('button', {
        type: 'button',
        class: opts.compact ? 'chip chip-quick' : 'chip',
        'aria-pressed': 'false',
        // The label travels as data. Reading it back out of `textContent`
        // concatenated the emoji onto the front of the word — "🤢Nausea" —
        // and nothing matched.
        dataset: { opt: option.id, label: option.label },
        onclick: () => {
          if (cat.id === 'flow') flowAnswered = true;
          toggle(cat, d, option.id, cat.select === 'single');
          sync();
          haptic(8);
        },
      }, [
        option.emoji && el('span', { 'aria-hidden': 'true', text: option.emoji }),
        el('span', { text: option.label }),
      ]);

      all.push({ cat, id: option.id, node });
      return node;
    },
  };
}

/**
 * The chips she actually uses, at the top, before any section is opened.
 *
 * This is the change that matters most for everyday use. Recently-used options
 * were already floated to the top *within* each category — but every category
 * starts collapsed, so logging "cramps" meant opening the sheet, finding
 * Symptoms, expanding it, scrolling, tapping, and applying. The chips she uses
 * most were the ones buried deepest.
 *
 * Nothing appears here until she has actually logged a few things, so a new
 * user never sees an empty row asking to be filled.
 *
 * @param {DayLog} draft
 * @param {import('../domain/model.js').Settings} settings
 * @param {ReturnType<typeof sheetState>} chips
 */
function quickRow(draft, settings, chips) {
  /** @type {{cat: import('../data/taxonomy.js').Category, option: import('../data/taxonomy.js').Option}[]} */
  const picks = [];

  // Same fallback as the Today row: her own first, defaults behind.
  for (const id of new Set([...settings.recentChips, ...DEFAULT_CHIPS])) {
    if (picks.length >= QUICK_LIMIT) break;
    for (const cat of CATEGORIES) {
      // Flow lives in its own always-open section directly below, so
      // duplicating it here would just be the same control twice.
      if (cat.id === 'flow') continue;
      const option = cat.options.find((o) => o.id === id && o.id !== 'none');
      if (option) { picks.push({ cat, option }); break; }
    }
  }

  if (picks.length < QUICK_MIN) return null;

  return el('div', { class: 'quick-row' }, [
    el('p', { class: 'hint-sm', text: 'What you log most' }),
    el('div', { class: 'chip-row' },
      picks.map(({ cat, option }) => chips.make(cat, option, draft, { compact: true }))),
  ]);
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
 * @param {ReturnType<typeof sheetState>} chips
 */
function customSection(draft, settings, chips) {
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
          // These chips are built here rather than by `chips.make`, so they
          // repaint themselves — but the rating block below still has to be
          // told that the list it is rating just changed.
          chips.sync();
          haptic(8);
        },
      }, [el('span', { text: name })]);
      row.append(chip);
    }

    row.append(el('button', {
      type: 'button',
      class: 'chip chip-add',
      text: '+ Add your own',
      onclick: async () => {
        // Validated in the sheet rather than after it: a native prompt could
        // only reject the name once it had already closed, which meant
        // retyping it from scratch.
        const name = await promptSheet({
          title: 'Track something of your own',
          label: 'What would you like to track?',
          confirmLabel: 'Add it',
          placeholder: 'Sore feet',
          maxLength: 40,
          validate: (v) => {
            if (!v) return 'Give it a name first.';
            const existing = store.getState().settings.customSymptoms;
            if (existing.some((s) => s.toLowerCase() === v.toLowerCase())) {
              return 'You already track that one.';
            }
            return null;
          },
        });
        if (!name) return;

        const existing = store.getState().settings.customSymptoms;
        store.updateSettings({ customSymptoms: [...existing, name] });
        draft.custom.push(name);
        paint();
        // A symptom she has just created is selected, so it wants a rating row
        // straight away rather than after the next unrelated tap.
        chips.sync();
        announce(`Added ${name}`);
      },
    }));
  };

  paint();

  return section(
    'Anything else',
    'Track whatever you like — it shows up in your patterns alongside everything else.',
    [row, symptomSeverity(draft, chips, 'custom')],
    { count: draft.custom.length },
  );
}

/* ── Tests ──────────────────────────────────────────────────────────────── */

/** @param {DayLog} draft */
function testsSection(draft, chips) {
  const rows = TESTS.map((test) => {
    const row = el('div', { class: 'chip-row' });

    for (const option of test.options) {
      const chip = el('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(/** @type {any} */ (draft)[test.id] === option.id),
        dataset: { opt: option.id, label: option.label },
        onclick: () => {
          const target = /** @type {any} */ (draft);
          target[test.id] = target[test.id] === option.id ? null : option.id;
          for (const other of row.children) {
            const id = /** @type {HTMLElement} */ (other).dataset.opt;
            other.setAttribute('aria-pressed', String(target[test.id] === id));
          }
          chips.sync();
          haptic(8);
        },
      }, [
        option.emoji && el('span', { 'aria-hidden': 'true', text: option.emoji }),
        el('span', { text: option.label }),
      ]);
      row.append(chip);
    }

    return el('div', { class: 'measure-row measure-row-block' }, [
      el('div', { class: 'measure-label' }, [
        el('span', { text: test.name }),
        /** @type {any} */ (test).hint
          && el('span', { class: 'hint-sm', text: /** @type {any} */ (test).hint }),
      ]),
      row,
    ]);
  });

  const count = () => TESTS.filter((t) => /** @type {any} */ (draft)[t.id]).length;

  const node = section('Tests', null, rows, { count: count() });

  const badge = /** @type {HTMLElement|null} */ (node.querySelector('.count-badge'));
  if (badge) chips.watchCount(badge, count);

  return node;
}

/* ── Numeric measures ───────────────────────────────────────────────────── */

/**
 * @param {typeof MEASURES[number]} measure
 * @param {DayLog} draft
 * @param {import('../domain/model.js').Settings} settings
 */
function measureRow(measure, draft, settings, chips) {
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

  const clear = el('button', {
    type: 'button',
    class: 'btn-icon measure-clear',
    'aria-label': `Clear ${measure.name.toLowerCase()}`,
    hidden: /** @type {any} */ (draft)[measure.id] == null,
    onclick: () => {
      /** @type {any} */ (draft)[measure.id] = null;
      input.value = '';
      clear.hidden = true;
      chips.sync();
    },
  }, [
    svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
                 'stroke-width': '2', 'stroke-linecap': 'round',
                 'aria-hidden': 'true' }, [
      svg('path', { d: 'M6 6l12 12M18 6L6 18' }),
    ]),
  ]);

  /*
    A number that cannot be true is not kept.

    `MEASURES` has carried a plausible range for every field since it was
    written — 35 to 39 °C, 30 to 200 kg — and nothing enforced it. The handler
    checked `Number.isFinite` and stored whatever that let through, so a
    dropped decimal point put 366 °C in the database.

    That is not merely a silly number on a screen. `detectThermalShift` reads
    the mean of the six readings before a candidate day, so one bad entry drags
    that baseline up by fifty degrees and the app can report ovulation
    "confirmed" on a day nothing happened — a false statement about her body,
    from a typo. It also flattens the BBT chart to a horizontal line, because
    the y-scale has to span the impossible value.

    Rejected rather than clamped. Clamping 366 to 39 produces a number that
    looks like a reading and is not one; nobody would ever notice it. The whole
    point is that she gets told.
  */
  const lo = Number(toDisplay(measure.min));
  const hi = Number(toDisplay(measure.max));

  const problem = el('p', { class: 'hint-sm measure-problem', role: 'alert', hidden: true });

  const input = /** @type {HTMLInputElement} */ (el('input', {
    class: 'input num measure-input',
    type: 'number',
    inputmode: 'decimal',
    step: String(measure.step),
    min: String(lo),
    max: String(hi),
    placeholder: '—',
    value: toDisplay(/** @type {any} */ (draft)[measure.id]),
    'aria-label': `${measure.name} in ${unitLabel}`,
    oninput: (/** @type {Event} */ e) => {
      const raw = /** @type {HTMLInputElement} */ (e.target).value;
      const target = /** @type {any} */ (draft);
      clear.hidden = raw === '';
      problem.hidden = true;
      input.removeAttribute('aria-invalid');
      if (raw === '') { target[measure.id] = null; chips.sync(); return; }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      /*
        Out-of-range keystrokes are simply not stored, but nothing is said
        yet — she is very likely still typing, and "35 is too low" flashing up
        while she reaches for the decimal point would be the app arguing with
        her mid-word. The complaint waits for `change`, which fires when she
        leaves the field.
      */
      if (parsed < lo || parsed > hi) { target[measure.id] = null; chips.sync(); return; }
      target[measure.id] = toStored(parsed);
      chips.sync();
    },
    onchange: () => {
      const raw = input.value;
      if (raw === '') return;
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= lo && parsed <= hi) return;

      problem.textContent = `${measure.name} has to be between ${lo} and ${hi} `
        + `${unitLabel}. Nothing was saved for it.`;
      problem.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.value = '';
      clear.hidden = true;
      /** @type {any} */ (draft)[measure.id] = null;
      chips.sync();
    },
  }));

  return el('div', { class: 'measure-row' }, [
    el('label', { class: 'measure-label' }, [
      el('span', { text: measure.name }),
      measure.hint && el('span', { class: 'hint-sm', text: measure.hint }),
      problem,
    ]),
    el('div', { class: 'measure-control' }, [
      input,
      el('span', { class: 'hint-sm measure-unit', text: unitLabel }),
      clear,
    ]),
  ]);
}

/**
 * Everything numeric, in one place.
 *
 * These were five top-level sections — temperature, weight, sleep, steps,
 * water — sitting at the same weight as Symptoms and Mood in a list of
 * seventeen. Most people never open any of them, so their only effect on a
 * typical visit was five more rows to scroll past before reaching Notes.
 *
 * As one section they are still one tap away for anyone charting BBT, and
 * invisible to everyone else.
 *
 * @param {DayLog} draft
 * @param {import('../domain/model.js').Settings} settings
 */
function measurementsSection(draft, settings, chips) {
  const count = () =>
    MEASURES.filter((m) => /** @type {any} */ (draft)[m.id] != null).length
    + (draft.water > 0 ? 1 : 0);

  const node = section('Measurements', null, [
    ...MEASURES.map((measure) => measureRow(measure, draft, settings, chips)),
    waterRow(draft, settings, chips),
  ], { count: count() });

  const badge = /** @type {HTMLElement|null} */ (node.querySelector('.count-badge'));
  if (badge) chips.watchCount(badge, count);

  return node;
}

function waterRow(draft, settings, chips) {
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
          chips.sync();
          haptic(6);
        },
      }));
    }
  };

  paint();

  return el('div', { class: 'measure-row measure-row-block' }, [
    el('div', { class: 'measure-label' }, [
      el('span', { text: 'Water' }),
      el('span', { class: 'hint-sm', text:
        `One glass is ${fmtWater(WATER_GLASS_ML, settings.unitWater)}.` }),
    ]),
    glasses,
    readout,
  ]);
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

  // Always built, shown only when non-zero. The badge has to be able to appear
  // and disappear as she edits — a category can now be changed from the quick
  // row while its own section is collapsed, so a badge rendered once from the
  // saved state would sit there contradicting the draft.
  const badge = el('span', {
    class: 'badge badge-primary num count-badge',
    text: String(count),
    hidden: count === 0,
  });

  return el('details', { class: 'log-section', open: open || count > 0 || null }, [
    el('summary', { class: 'log-section-head' }, [
      el('span', { class: 'log-section-title', text: title }),
      badge,
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

  store.rememberPicks(draft);
  store.putLog(draft);
  closeSheet();

  const nowEmpty = nothingRecorded(draft);
  const wasEmpty = nothingRecorded(before);

  if (nowEmpty && !wasEmpty) {
    toast(`Cleared ${fmtLong(date)}`);
    return;
  }
  if (nowEmpty) return;

  // Celebrate the act of logging, never what was logged. A heavy day and a
  // good day get exactly the same response.
  if (wasEmpty) {
    burst({ shape: getTheme(settings.theme).particle, count: 34 });
    mascotReact();
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
