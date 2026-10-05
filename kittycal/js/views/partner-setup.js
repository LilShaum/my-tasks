// @ts-check
/**
 * partner-setup.js — the first question, and the partner's own setup.
 *
 * Kittycal is two apps that share an install: a period tracker, and a
 * companion for someone whose partner shares her cycle. The very first
 * screen asks which this phone is for, so a partner is never walked through
 * questions about a period he does not have.
 *
 * His setup is three short steps:
 *
 *   1. Connect: paste her link or type her code. Opening her link skips the
 *      typing; the step then just shows whose cycle it is.
 *   2. His name, for the greeting. Optional.
 *   3. His look. Her theme is picked to start with, so the two apps match
 *      unless he chooses otherwise; her character marks her cycle either way.
 *
 * It reuses onboarding's layout and classes so the two setups feel like one
 * app.
 */

import { el, replace, haptic, announce } from '../utils/dom.js';
import { themePicker, setPickerSelection } from '../ui/theme-picker.js';
import { mascot, emblem, spotArt } from '../ui/mascot.js';
import { applyTheme } from '../ui/theme.js';
import { getTheme } from '../data/themes.js';
import { parseShareInput, resolveLink, getShare } from '../storage/share.js';
import * as store from '../state/store.js';

/* ── The door ───────────────────────────────────────────────────────────── */

/**
 * "Who's this for?" Two answers, each a card that says what it leads to.
 *
 * @param {HTMLElement} host
 * @param {{onSelf: () => void, onPartner: () => void}} opts
 */
export function mountDoor(host, { onSelf, onPartner }) {
  const theme = store.getState().settings.theme;
  replace(host, [
    el('div', { class: 'onb door' }, [
      el('div', { class: 'onb-body' }, [
        el('div', { class: 'onb-step pop-in' }, [
          el('div', { class: 'onb-art', 'aria-hidden': 'true' }, [mascot(theme, { size: 112 })]),
          el('h2', { tabindex: '-1', 'data-autofocus': '', text: 'Hi! Who’s this for?' }),
          el('p', { class: 'hint', text: 'You can change this later in Settings.' }),
          el('div', { class: 'door-choices' }, [
            el('button', {
              type: 'button', class: 'door-card',
              onclick: () => { haptic(); onSelf(); },
            }, [
              el('span', { class: 'door-art', 'aria-hidden': 'true' }, [spotArt('calendar', { size: 56, className: '' })]),
              el('span', { class: 'door-text' }, [
                el('span', { class: 'door-title', text: 'Tracking my own cycle' }),
                el('span', { class: 'door-sub', text: 'Periods, symptoms, patterns and forecasts' }),
              ]),
            ]),
            el('button', {
              type: 'button', class: 'door-card',
              onclick: () => { haptic(); onPartner(); },
            }, [
              el('span', { class: 'door-art door-pair', 'aria-hidden': 'true' }, [
                emblem(theme, { size: 40, className: '' }),
                el('span', { class: 'door-heart', text: '♥' }),
              ]),
              el('span', { class: 'door-text' }, [
                el('span', { class: 'door-title', text: 'Following my partner’s cycle' }),
                el('span', { class: 'door-sub', text: 'She shares a code from her Kittycal' }),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]);
  /** @type {HTMLElement|null} */ (host.querySelector('h2'))?.focus();
}

/* ── His setup ──────────────────────────────────────────────────────────── */

/**
 * @param {HTMLElement} host
 * @param {{onDone: () => void, onBack?: () => void}} opts
 */
export function mountPartnerSetup(host, { onDone, onBack }) {
  // Always from the first step: when her link already connected this phone,
  // it is the confirmation (whose cycle, and the code for the Home Screen app).
  let step = 0;
  const draft = {
    name: store.getState().settings.name,
    theme: store.getState().settings.partnerOf?.snapshot?.theme ?? store.getState().settings.theme,
  };
  applyTheme(draft.theme, store.getState().settings.colorMode);

  const steps = [connectStep, nameStep, lookStep];

  const render = () => {
    const s = steps[step]();
    replace(host, [
      el('div', { class: 'onb' }, [
        el('div', { class: 'onb-progress', 'aria-hidden': 'true' },
          steps.map((_, i) => el('span', { class: 'onb-pip', dataset: { done: String(i <= step) } }))),
        el('div', { class: 'onb-body' }, [el('div', { class: 'onb-step pop-in' }, s.content)]),
        el('div', { class: 'onb-foot' }, s.footer),
      ]),
    ]);
    const h = /** @type {HTMLElement|null} */ (host.querySelector('h2'));
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  };

  const next = () => { step += 1; if (step >= steps.length) finish(); else render(); };
  const back = () => { if (step === 0) onBack?.(); else { step -= 1; render(); } };

  /** @param {string} label @param {() => void} onNext @param {boolean} [disabled] */
  const footer = (label, onNext, disabled = false) => [
    el('button', { type: 'button', class: 'btn btn-block btn-lg', text: label, disabled: disabled || null,
      onclick: () => { haptic(); onNext(); } }),
    step > 0 || onBack ? el('button', { type: 'button', class: 'btn btn-ghost', text: '← Back', onclick: back }) : null,
  ];

  function connectStep() {
    const of = store.getState().settings.partnerOf;
    const snap = of?.snapshot ?? null;
    if (snap) {
      const art = emblem(snap.theme ?? 'plain', { size: 72, className: '' });
      art.setAttribute('data-theme', snap.theme ?? 'plain');
      return {
        content: [
          el('div', { class: 'onb-art onb-art-sm', 'aria-hidden': 'true' }, [art]),
          el('h2', { text: snap.name ? `Connected to ${snap.name}’s cycle` : 'Connected to her cycle' }),
          el('p', { class: 'hint', text: 'You’ll see what she chose to share: where she is in her cycle, what’s '
            + 'likely each day, and how you can help.' }),
          of?.code ? installTip(of.code) : null,
        ],
        footer: footer('Continue', next),
      };
    }

    const input = el('input', {
      class: 'input pa-code-input', type: 'text', id: 'pa-code', autocomplete: 'off', autocapitalize: 'characters',
      spellcheck: 'false', placeholder: 'e.g. K7MPX-Q4RWZ',
    });
    const error = el('p', { class: 'hint-sm pa-error', role: 'alert' });
    const go = async () => {
      const link = parseShareInput(/** @type {HTMLInputElement} */ (input).value);
      if (!link) { error.textContent = 'That doesn’t look like a code. It’s ten letters and numbers, like ABCDE-FGHJK.'; return; }
      error.textContent = 'Connecting…';
      const result = await connect(link);
      if (result === 'ok') { announce('Connected'); render(); return; }
      error.textContent = result === 'missing'
        ? 'Couldn’t find that one. Check the code with her: she can see it in Settings, Share with your partner.'
        : 'Couldn’t reach the server. Check your connection and try again.';
    };
    return {
      content: [
        el('div', { class: 'onb-art onb-art-sm', 'aria-hidden': 'true' }, [mascot(draft.theme, { size: 72 })]),
        el('h2', { text: 'Connect to her cycle' }),
        el('p', { class: 'hint', text: 'In her Kittycal she goes to Settings, then Share with your partner. '
          + 'Type the code it shows, or paste the link she sent.' }),
        el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Her code' }), input]),
        error,
      ],
      footer: footer('Connect', () => { void go(); }),
    };
  }

  function nameStep() {
    return {
      content: [
        el('div', { class: 'onb-art onb-art-sm', 'aria-hidden': 'true' }, [mascot(draft.theme, { size: 72 })]),
        el('h2', { text: 'What should we call you?' }),
        el('p', { class: 'hint', text: 'Only used to say hello. It stays on this phone.' }),
        el('label', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Name (optional)' }),
          el('input', { class: 'input', type: 'text', value: draft.name, placeholder: 'Your name', maxlength: '40',
            autocomplete: 'given-name',
            oninput: (/** @type {Event} */ e) => { draft.name = /** @type {HTMLInputElement} */ (e.target).value.trim(); } }),
        ]),
      ],
      footer: footer('Continue', next),
    };
  }

  function lookStep() {
    const snap = store.getState().settings.partnerOf?.snapshot ?? null;
    const grid = themePicker({
      selected: draft.theme,
      onPick: (id) => {
        draft.theme = id;
        applyTheme(id, store.getState().settings.colorMode);
        setPickerSelection(grid, id);
        haptic(8);
      },
    });
    return {
      content: [
        el('h2', { text: 'Pick your look' }),
        el('p', { class: 'hint', text: snap?.theme
          ? `${snap.name ?? 'She'} uses ${getTheme(snap.theme).name}, so that’s picked to start. Her character shows `
            + 'on her cycle whichever you choose.'
          : 'Colours and the little friend in the corner. You can change it any time.' }),
        grid,
      ],
      footer: footer('Done', next),
    };
  }

  function finish() {
    store.updateSettings({ role: 'partner', name: draft.name, theme: draft.theme });
    onDone();
  }

  render();
}

/**
 * Connect this phone to a share. Resolves the code, fetches once to prove it
 * exists, and saves it.
 * @param {{code: string}|{id: string, key: string}} link
 * @returns {Promise<'ok'|'missing'|'offline'>}
 */
export async function connect(link) {
  try {
    const share = await resolveLink(link);
    const got = await getShare(share);
    if (!got) return 'missing';
    store.updateSettings({ partnerOf: {
      id: share.id, key: share.key, code: share.code, snapshot: got.snapshot, fetchedAt: Date.now(), gone: false,
    } });
    return 'ok';
  } catch (err) {
    return err instanceof Error && err.message === 'unreadable share' ? 'missing' : 'offline';
  }
}

/**
 * On an iPhone in Safari, a Home Screen app starts with its own empty storage,
 * so the code is what carries the connection across.
 * @param {string} code
 */
function installTip(code) {
  const standalone = matchMedia('(display-mode: standalone)').matches
    || /** @type {any} */ (navigator).standalone === true;
  if (standalone) return null;
  return el('div', { class: 'note pa-install' }, [
    el('span', { class: 'note-icon', 'aria-hidden': 'true', text: '★' }),
    el('span', {}, [
      'Adding Kittycal to your Home Screen? Do it now, then open it there and choose ',
      el('strong', { text: 'Following my partner’s cycle' }),
      ' with this code: ',
      el('strong', { class: 'num', text: code }),
    ]),
  ]);
}

