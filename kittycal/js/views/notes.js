// @ts-check
/**
 * notes.js — reading back what she wrote.
 *
 * Opened from Insights. A sheet rather than a section, because a year of
 * journalling is a screen of its own and burying it under the charts would
 * make the long list the thing you scroll past to reach the report.
 *
 * Every entry says when it was and where in the cycle it fell, because
 * "Day 2" is usually the reason the sentence exists. Tapping one opens that
 * day, so reading and correcting are the same gesture.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 */

import { el, haptic, announce } from '../utils/dom.js';
import { fmtLong, fmtRelative } from '../utils/date.js';
import { plural } from '../utils/fmt.js';
import { openSheet, closeSheet } from '../ui/sheet.js';
import { collectNotes, searchNotes } from '../domain/notes.js';
import { buildCycles } from '../domain/cycles.js';
import { openLogSheet } from './log.js';
import * as store from '../state/store.js';

/** Open the notes sheet. */
export function openNotes() {
  const { logs, periodDays } = store.getState();
  const all = collectNotes(logs, buildCycles(periodDays));

  const sheet = openSheet({
    title: 'Your notes',
    body: [],
  });

  if (!all.length) {
    sheet.body.replaceChildren(
      el('p', { class: 'hint', text:
        'Nothing written yet. The notes box is at the bottom of the diary, ' +
        'for anything the buttons do not cover.' }),
    );
    return;
  }

  const list = el('div', { class: 'notes-list' });

  const count = el('p', { class: 'hint-sm notes-count', 'aria-live': 'polite' });

  const search = el('input', {
    type: 'search',
    class: 'input',
    id: 'notes-search',
    placeholder: 'Search what you wrote',
    autocomplete: 'off',
    // Straight to the field: the list is already visible behind it, so the
    // only thing left to do here is narrow it.
    'data-autofocus': '',
    oninput: () => paint(),
  });

  const paint = () => {
    const query = /** @type {HTMLInputElement} */ (search).value;
    const found = searchNotes(all, query);

    count.textContent = query.trim()
      ? `${plural(found.length, 'note')} matching “${query.trim()}”`
      : plural(all.length, 'note');

    list.replaceChildren(...(found.length
      ? found.map(entry)
      : [el('p', { class: 'hint', text: 'Nothing matches that.' })]));
  };

  /** @param {import('../domain/notes.js').NoteEntry} note */
  function entry(note) {
    const when = fmtRelative(note.date);
    return el('button', {
      type: 'button',
      class: 'note-entry',
      // The date is the useful label; the text is read out after it anyway.
      'aria-label': `${fmtLong(note.date)}, open this day`,
      onclick: () => {
        haptic();
        closeSheet();
        openLogSheet(note.date);
      },
    }, [
      el('div', { class: 'note-entry-head' }, [
        el('span', { class: 'note-entry-date', text: fmtLong(note.date) }),
        note.cycleDay != null
          ? el('span', { class: 'note-entry-day', text: `Day ${note.cycleDay}` })
          : null,
      ]),
      el('p', { class: 'note-entry-text', text: note.text }),
      /*
        Only the relative words earn a second line. `fmtRelative` falls back to
        a short date once something is more than a day old, which put "1 August
        2026" and "Sat 1 Aug" one under the other — the same fact twice, in two
        formats, which is worse than not saying it at all.
      */
      when === 'Today' || when === 'Yesterday'
        ? el('span', { class: 'note-entry-when', text: when })
        : null,
    ]);
  }

  sheet.body.replaceChildren(
    el('p', { class: 'hint', text:
      'Everything you have written in the diary, newest first. Tap one to open ' +
      'that day.' }),
    search,
    count,
    list,
  );

  paint();
  announce(`${plural(all.length, 'note')} written`);
}

/**
 * How many notes there are, for the row on Insights.
 * @returns {number}
 */
export function noteCount() {
  const { logs, periodDays } = store.getState();
  return collectNotes(logs, buildCycles(periodDays)).length;
}
