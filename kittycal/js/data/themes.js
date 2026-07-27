// @ts-check
/**
 * themes.js — the theme registry.
 *
 * Colour itself lives in css/themes.css (two custom properties per theme).
 * This file carries the metadata JavaScript needs: the display name, the
 * background pattern, which particle to throw on a celebration, and the two
 * swatch colours shown on the theme card in Settings.
 *
 * `swatch` values are literal hex rather than tokens because the picker shows
 * every theme at once, so each card can't read from the active theme's vars.
 */

/**
 * @typedef {Object} Theme
 * @property {string} id            matches [data-theme=…] in css/themes.css
 * @property {string} name
 * @property {string} blurb         one line, shown on the theme detail row
 * @property {string} pattern       matches [data-pattern=…]
 * @property {string} particle      petal|heart|star|bubble|drop|bolt|crumb
 * @property {[string, string]} swatch  [primary, accent] for the picker card
 */

/** @type {Theme[]} */
export const THEMES = [
  {
    id: 'hellokitty',
    name: 'Hello Kitty',
    blurb: 'Red bow, cheerful, impossible to dislike.',
    pattern: 'gingham',
    particle: 'heart',
    swatch: ['#e8465a', '#f2c14e'],
  },
  {
    id: 'mymelody',
    name: 'My Melody',
    blurb: 'Soft pink and sweet-natured.',
    pattern: 'polka',
    particle: 'petal',
    swatch: ['#ef7c9e', '#7fc9b0'],
  },
  {
    id: 'kuromi',
    name: 'Kuromi',
    blurb: 'Bratty, purple, secretly keeps a diary.',
    pattern: 'checker',
    particle: 'star',
    swatch: ['#9a6fc4', '#e162a8'],
  },
  {
    id: 'cinnamoroll',
    name: 'Cinnamoroll',
    blurb: 'Sky blue and drifting off somewhere.',
    pattern: 'polka',
    particle: 'bubble',
    swatch: ['#69aae6', '#f4a8b8'],
  },
  {
    id: 'keroppi',
    name: 'Keroppi',
    blurb: 'Loud, green, first to volunteer.',
    pattern: 'ripple',
    particle: 'drop',
    swatch: ['#63b84a', '#e8697a'],
  },
  {
    id: 'gudetama',
    name: 'Gudetama',
    blurb: 'Cannot be bothered. Respect it.',
    pattern: 'none',
    particle: 'crumb',
    swatch: ['#e8bc3c', '#c47a3a'],
  },
  {
    id: 'twinstars',
    name: 'Little Twin Stars',
    blurb: 'Storybook lavender and quiet wonder.',
    pattern: 'star',
    particle: 'star',
    swatch: ['#a78ad4', '#f0cf5a'],
  },
  {
    id: 'badtzmaru',
    name: 'Badtz-Maru',
    blurb: 'Monochrome with one loud yellow opinion.',
    pattern: 'stripe',
    particle: 'bolt',
    swatch: ['#5a6472', '#f2c231'],
  },
  {
    id: 'chococat',
    name: 'Chococat',
    blurb: 'Warm cocoa, always knows the gossip.',
    pattern: 'polka',
    particle: 'crumb',
    swatch: ['#8a6242', '#4aa39a'],
  },
  {
    id: 'pompompurin',
    name: 'Pompompurin',
    blurb: 'Custard yellow, naps in the hallway.',
    pattern: 'checker',
    particle: 'crumb',
    swatch: ['#e6cc55', '#9a7038'],
  },
  {
    id: 'aggretsuko',
    name: 'Aggretsuko',
    blurb: 'Mild by day. Death metal by night.',
    pattern: 'stripe',
    particle: 'bolt',
    swatch: ['#c4563c', '#5a5f6b'],
  },
  {
    id: 'pochacco',
    name: 'Pochacco',
    blurb: 'Sporty, nosy, permanently mid-activity.',
    pattern: 'gingham',
    particle: 'star',
    swatch: ['#6a8ee0', '#e8a24e'],
  },
  {
    id: 'hangyodon',
    name: 'Hangyodon',
    blurb: 'Teal, trying very hard, wants to be liked.',
    pattern: 'ripple',
    particle: 'bubble',
    swatch: ['#3aa8bc', '#f0a4bc'],
  },
  {
    id: 'plain',
    name: 'Plain',
    blurb: 'No patterns, no bounce. For doctor visits and quiet days.',
    pattern: 'none',
    particle: 'none',
    swatch: ['#7a8290', '#5f7ba8'],
  },
];

export const DEFAULT_THEME = 'hellokitty';

/** @type {Map<string, Theme>} */
const BY_ID = new Map(THEMES.map((t) => [t.id, t]));

/**
 * @param {string} id
 * @returns {Theme}
 */
export function getTheme(id) {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_THEME) ?? THEMES[0];
}

/** @param {string} id */
export const isTheme = (id) => BY_ID.has(id);
