// @ts-check
/**
 * notes.js — everything she has written, gathered up.
 *
 * The diary has always had a free-text field, and until now that text was
 * write-only. It could be read back exactly one way: remember the date, go to
 * the calendar, open that day. Anything she wrote and did not memorise the
 * date of was gone.
 *
 * That is the app taking something in and offering no way to get it out —
 * worse for notes than for anything else, because a note is what she writes
 * when a chip does not cover it. "Worst cramps yet, couldn't work" is the most
 * specific thing in the whole database and the hardest thing to find.
 *
 * The moment it matters is the appointment. The doctor report summarises
 * counts and ranges; it cannot summarise a sentence she wrote in March.
 *
 * Pure functions over plain data, so the searching and the ordering are
 * testable without a browser.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./model.js').DayLog} DayLog
 * @typedef {import('./cycles.js').Cycle} Cycle
 */

import { cycleDay } from './cycles.js';

/**
 * @typedef {Object} NoteEntry
 * @property {DateKey} date
 * @property {string} text
 * @property {number|null} cycleDay  day of the cycle it falls in, if known
 */

/**
 * Every non-empty note, newest first.
 *
 * Newest first because the common question is "what did I write recently",
 * and because a list that grows downward puts the thing you want furthest
 * from your thumb after a year of use.
 *
 * @param {Record<DateKey, DayLog>} logs
 * @param {Cycle[]} cycles
 * @returns {NoteEntry[]}
 */
export function collectNotes(logs, cycles) {
  /** @type {NoteEntry[]} */
  const out = [];

  for (const date of Object.keys(logs)) {
    const text = logs[date]?.notes?.trim();
    if (!text) continue;
    out.push({ date, text, cycleDay: cycleDay(cycles, date) });
  }

  // Date keys are YYYY-MM-DD, so string ordering is chronological ordering.
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * The entries matching a search.
 *
 * Substring, case-insensitive, and deliberately nothing cleverer. She is
 * looking for a word she knows she wrote — stemming or fuzzy matching would
 * mostly serve to return things she did not write, which is the one failure
 * mode that makes a search feel broken.
 *
 * An empty query returns everything rather than nothing, so the field starts
 * as a filter rather than a gate.
 *
 * @param {NoteEntry[]} entries
 * @param {string} query
 * @returns {NoteEntry[]}
 */
export function searchNotes(entries, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => entry.text.toLowerCase().includes(needle));
}
