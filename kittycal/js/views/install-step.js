// @ts-check
/**
 * install-step.js — the first screen on an iPhone that has not installed yet.
 *
 * On iOS a Home Screen app gets its own storage, separate from Safari's. So
 * setting up in Safari and adding to the Home Screen afterwards opens an empty
 * app with no way back to what she entered; Safari can also clear storage it
 * thinks is unused, and only a Home Screen app can get notifications. The
 * install has to come before setup, not after it.
 *
 * Shown only where it is true: an iPhone or iPad, in the browser rather than
 * the installed app, not inside a frame. Never a dead end: "Continue in
 * Safari" always goes on to setup.
 */

import { el, replace, haptic } from '../utils/dom.js';
import { installPlatform, isInstalled } from '../storage/persist.js';
import { mascot } from '../ui/mascot.js';
import * as store from '../state/store.js';

const SKIPPED = 'kc-install-skipped';

/** Whether to show this screen before setup. */
export function shouldOfferInstall() {
  let skipped = false;
  try { skipped = sessionStorage.getItem(SKIPPED) === '1'; } catch { /* private mode */ }
  return installPlatform() === 'ios' && !isInstalled() && window.top === window.self && !skipped;
}

/** The share glyph Safari shows: a square with an arrow out of the top. */
const shareGlyph = () => glyph('M12 15V3 M8 7l4-4 4 4 M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7');
/** Add to Home Screen's glyph: a plus in a rounded square. */
const addGlyph = () => glyph('M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M12 8v8 M8 12h8');

/** @param {string} d */
function glyph(d) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return el('span', { class: 'install-glyph' }, [svg]);
}

/**
 * @param {HTMLElement} host
 * @param {{onContinue: () => void}} opts
 */
export function mountInstallStep(host, { onContinue }) {
  const theme = store.getState().settings.theme;
  replace(host, [
    el('div', { class: 'onb install-step' }, [
      el('div', { class: 'onb-body' }, [
        el('div', { class: 'onb-step pop-in' }, [
          el('div', { class: 'onb-art', 'aria-hidden': 'true' }, [mascot(theme, { size: 96 })]),
          el('h2', { tabindex: '-1', 'data-autofocus': '', text: 'First, add Kittycal to your Home Screen' }),
          el('p', { class: 'hint', text: 'On iPhone, Kittycal keeps your data safest as a Home Screen app, and only '
            + 'there can it send you reminders. What you set up here in Safari stays in Safari.' }),
          el('ol', { class: 'install-steps' }, [
            el('li', {}, [el('span', { class: 'install-num', text: '1' }),
              el('span', {}, ['Tap ', el('strong', { text: 'Share' }), ' ', shareGlyph(), ' at the bottom of Safari.'])]),
            el('li', {}, [el('span', { class: 'install-num', text: '2' }),
              el('span', {}, ['Scroll down and tap ', el('strong', { text: 'Add to Home Screen' }), ' ', addGlyph(), '.'])]),
            el('li', {}, [el('span', { class: 'install-num', text: '3' }),
              el('span', {}, ['Open Kittycal from your Home Screen and set up there.'])]),
          ]),
        ]),
      ]),
      el('div', { class: 'onb-foot' }, [
        el('button', {
          type: 'button', class: 'btn btn-ghost btn-block',
          onclick: () => {
            haptic();
            try { sessionStorage.setItem(SKIPPED, '1'); } catch { /* private mode */ }
            onContinue();
          },
        }, ['Continue in Safari anyway']),
      ]),
    ]),
  ]);
  /** @type {HTMLElement|null} */ (host.querySelector('h2'))?.focus();
}
