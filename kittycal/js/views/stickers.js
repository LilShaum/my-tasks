// @ts-check
/**
 * stickers.js — the sticker book, as a screen.
 *
 * A sheet off Settings rather than a tab. It is the least important thing in
 * the app on any given day and one of the few that is purely nice, which is
 * exactly the split the design rules draw: cute lives in the chrome, and the
 * chrome is not where the tab bar's four slots go.
 *
 * Empty slots are drawn as outlines, with what earns them written underneath.
 * A collection you cannot see the shape of is not a collection, and since she
 * has never used a period tracker before, the empty half doubles as the only
 * place the app says "you can name your own symptom" without that being a
 * standing instruction on a screen she reads daily.
 */

import { el, announce } from '../utils/dom.js';
import { fmtLong } from '../utils/date.js';
import { plural } from '../utils/fmt.js';
import { openSheet } from '../ui/sheet.js';
import { emblem } from '../ui/mascot.js';
import { stickerBook, STICKER_COUNT } from '../domain/stickers.js';
import { buildCycles } from '../domain/cycles.js';
import * as store from '../state/store.js';

/**
 * The store's current shape, as the sticker derivation wants it.
 *
 * Lives here rather than in `domain/stickers.js` because domain modules do not
 * reach into the store — that boundary is what makes them unit-testable — and
 * exported rather than copied because the check-in and the diary both need it
 * either side of a write.
 */
export function stickerContext() {
  const { logs, periodDays, settings } = store.getState();
  return { logs, cycles: buildCycles(periodDays), settings };
}

/** The current book, derived from whatever is in the store right now. */
const currentBook = () => stickerBook(stickerContext());

/** How many she has, for the row in Settings. */
export function stickerCounts() {
  const book = currentBook();
  return { earned: book.filter((s) => s.on).length, total: STICKER_COUNT };
}

/** Open the sticker book. */
export function openStickerBook() {
  const book = currentBook();
  const earned = book.filter((s) => s.on).length;

  openSheet({
    title: 'Sticker book',
    body: [
      el('p', { class: 'hint', text: earned === 0
        ? 'Fourteen to collect. They come from using Kittycal — never from '
          + 'what your cycle happens to do.'
        : `${earned} of ${STICKER_COUNT}. Once a sticker is yours it stays `
          + 'yours, whatever you do or do not log after it.' }),
      el('div', { class: 'sticker-grid' }, book.map(slot)),
    ],
  });

  announce(`Sticker book, ${plural(earned, 'sticker')} of ${STICKER_COUNT}`);
}

/**
 * One slot, filled or empty.
 *
 * Not a button. Every card in this app that looks tappable does something, and
 * a sticker does not — making them buttons would have her tapping fourteen
 * things to find out that none of them lead anywhere.
 *
 * @param {import('../domain/stickers.js').Sticker} sticker
 */
function slot(sticker) {
  const card = el('div', {
    class: `sticker${sticker.on ? ' is-earned' : ''}`,
    // The visible text alone reads as a fragment out of order — the date sits
    // under the title with no word joining them.
    'aria-label': sticker.on
      ? `${sticker.title}, earned ${fmtLong(sticker.on)}`
      : `Not yet earned: ${sticker.title}. ${sticker.requirement}`,
  }, [
    el('span', { class: 'sticker-art', 'aria-hidden': 'true' }, [
      emblem(sticker.emblem, { size: 52, className: '' }),
    ]),
    el('span', { class: 'sticker-title', 'aria-hidden': 'true', text: sticker.title }),
    el('span', {
      class: 'sticker-sub',
      'aria-hidden': 'true',
      text: sticker.on ? fmtLong(sticker.on) : sticker.requirement,
    }),
  ]);

  /*
    Each earned sticker wears its own palette, the same trick the theme picker
    uses: css/themes.css matches [data-theme] at any depth, so scoping it to
    the card makes every token inside resolve to that character's hue.

    Only the earned ones. An unearned slot in full colour is just a sticker
    with small print, and the whole point is that the book fills up in front of
    her — so the empty ones stay in the surrounding theme, drained by the CSS.
  */
  if (sticker.on) card.dataset.theme = sticker.emblem;

  return card;
}
