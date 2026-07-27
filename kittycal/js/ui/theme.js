// @ts-check
/**
 * theme.js — applies a theme to the document.
 *
 * The theme and colour mode are mirrored into localStorage as well as
 * IndexedDB. That's the one thing localStorage is genuinely better at: it's
 * synchronous, so index.html can read it in a blocking inline script and set
 * the attributes before first paint. Waiting on IndexedDB would mean a visible
 * flash of the wrong palette on every launch.
 */

import { getTheme, DEFAULT_THEME, isTheme } from '../data/themes.js';

export const LS_THEME = 'kittycal.theme';
export const LS_MODE = 'kittycal.mode';

/**
 * Apply a theme and colour mode to <html>.
 * @param {string} themeId
 * @param {'light'|'dark'|'auto'} colorMode
 */
export function applyTheme(themeId, colorMode) {
  const theme = getTheme(themeId);
  const root = document.documentElement;

  root.dataset.theme = theme.id;
  root.dataset.pattern = theme.pattern;
  root.dataset.mode = resolveMode(colorMode);
  root.dataset.colorScheme = colorMode;

  try {
    localStorage.setItem(LS_THEME, theme.id);
    localStorage.setItem(LS_MODE, colorMode);
  } catch {
    /* private browsing with storage disabled — the app still works */
  }

  updateMetaThemeColor();
}

/**
 * Resolve 'auto' against the OS preference.
 * @param {'light'|'dark'|'auto'} colorMode
 * @returns {'light'|'dark'}
 */
export function resolveMode(colorMode) {
  if (colorMode === 'light' || colorMode === 'dark') return colorMode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Keep the browser chrome (iOS status bar, Android address bar) in step with
 * the theme. Read the computed surface colour rather than duplicating the
 * palette here, so it can never drift out of sync with the CSS.
 */
export function updateMetaThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const surface = getComputedStyle(document.documentElement)
    .getPropertyValue('--surface').trim();
  if (surface) meta.setAttribute('content', surface);
}

/** What the pre-paint inline script stored, if anything. */
export function readStoredTheme() {
  try {
    const theme = localStorage.getItem(LS_THEME);
    const mode = localStorage.getItem(LS_MODE);
    return {
      theme: theme && isTheme(theme) ? theme : DEFAULT_THEME,
      colorMode: /** @type {'light'|'dark'|'auto'} */ (
        mode === 'light' || mode === 'dark' ? mode : 'auto'
      ),
    };
  } catch {
    return { theme: DEFAULT_THEME, colorMode: /** @type {'auto'} */ ('auto') };
  }
}

/**
 * Re-resolve 'auto' when the OS flips between light and dark mid-session.
 * @param {() => 'light'|'dark'|'auto'} getColorMode
 */
export function watchSystemMode(getColorMode) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', () => {
    if (getColorMode() !== 'auto') return;
    document.documentElement.dataset.mode = resolveMode('auto');
    updateMetaThemeColor();
  });
}
