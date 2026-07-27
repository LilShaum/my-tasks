// @ts-check
/**
 * theme-picker.js — the sticker book.
 *
 * A grid of theme cards, each previewing itself: the card sets its own --h and
 * --c so the swatch *is* the theme rather than a description of it. Used in
 * onboarding and again in Settings.
 */

import { el } from '../utils/dom.js';
import { THEMES } from '../data/themes.js';
import { emblem } from './mascot.js';

/**
 * @param {Object} opts
 * @param {string} opts.selected        currently active theme id
 * @param {(id: string) => void} opts.onPick
 * @param {boolean} [opts.showNames]
 * @returns {HTMLElement}
 */
export function themePicker({ selected, onPick, showNames = true }) {
  const grid = el('div', {
    class: 'theme-grid',
    role: 'radiogroup',
    'aria-label': 'Theme',
  });

  for (const theme of THEMES) {
    const isActive = theme.id === selected;

    const card = el('button', {
      type: 'button',
      class: 'theme-card',
      role: 'radio',
      'aria-checked': String(isActive),
      'aria-pressed': String(isActive),
      'aria-label': `${theme.name}. ${theme.blurb}`,
      dataset: { theme: theme.id },
      // Each card renders in its own palette by scoping the theme attribute
      // to itself; css/themes.css matches on [data-theme] at any depth.
      onclick: () => onPick(theme.id),
    }, [
      emblem(theme.id, { size: 54, className: '' }),
      showNames && el('span', { class: 'theme-card-name', text: theme.name }),
      el('span', { class: 'theme-card-dots', 'aria-hidden': 'true' }, [
        el('span', { class: 'theme-card-dot', style: { background: theme.swatch[0] } }),
        el('span', { class: 'theme-card-dot', style: { background: theme.swatch[1] } }),
      ]),
    ]);

    // Scoping data-theme onto the card makes every token inside it resolve to
    // that theme, so the emblem and border preview the palette accurately.
    card.dataset.theme = theme.id;

    grid.append(card);
  }

  return grid;
}

/**
 * Update selection in place, so picking a theme doesn't rebuild the grid and
 * lose scroll position or keyboard focus.
 * @param {HTMLElement} grid
 * @param {string} selected
 */
export function setPickerSelection(grid, selected) {
  for (const card of grid.children) {
    const active = /** @type {HTMLElement} */ (card).dataset.theme === selected;
    card.setAttribute('aria-checked', String(active));
    card.setAttribute('aria-pressed', String(active));
  }
}
