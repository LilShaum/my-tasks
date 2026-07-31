// @ts-check
/**
 * sheet.js — bottom sheets.
 *
 * One sheet is open at a time. Opening handles the things that are easy to
 * forget and obvious when missing: focus moves into the sheet and is trapped
 * there, Escape closes, the background stops scrolling, and focus returns to
 * whatever opened it.
 */

import { el, need, trapFocus, haptic } from '../utils/dom.js';

/** @type {{root: HTMLElement, backdrop: HTMLElement, release: () => void, opener: Element|null}|null} */
let open = null;

/**
 * @param {Object} opts
 * @param {string} opts.title
 * @param {(Node|string|null|false)[]} opts.body
 * @param {(Node|string|null|false)[]} [opts.footer]
 * @param {() => void} [opts.onClose]
 * @returns {{close: () => void, body: HTMLElement}}
 */
export function openSheet({ title, body, footer, onClose }) {
  closeSheet();

  const opener = document.activeElement;

  const backdrop = el('div', {
    class: 'sheet-backdrop',
    onclick: () => closeSheet(),
  });

  const bodyHost = el('div', { class: 'sheet-body' }, body);

  const root = el('div', {
    class: 'sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  }, [
    el('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    el('div', { class: 'sheet-head' }, [
      el('h2', { text: title }),
      el('button', {
        type: 'button',
        class: 'btn-icon',
        'aria-label': 'Close',
        text: '✕',
        onclick: () => closeSheet(),
      }),
    ]),
    bodyHost,
    footer && el('div', { class: 'sheet-foot' }, footer),
  ]);

  document.body.append(backdrop, root);

  // Stop the page behind from scrolling while the sheet is up.
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const releaseTrap = trapFocus(root);

  /** @param {KeyboardEvent} e */
  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSheet();
    }
  };
  document.addEventListener('keydown', onKeydown);

  open = {
    root,
    backdrop,
    opener,
    release: () => {
      releaseTrap();
      document.removeEventListener('keydown', onKeydown);
      document.body.style.overflow = previousOverflow;
      onClose?.();
    },
  };

  // Animate in on the next frame — setting the attribute in the same frame the
  // element is inserted skips the transition.
  requestAnimationFrame(() => {
    backdrop.dataset.open = 'true';
    root.dataset.open = 'true';
    const first = root.querySelector('button, [href], input, select, textarea');
    if (first instanceof HTMLElement) first.focus({ preventScroll: true });
  });

  haptic(8);

  return { close: closeSheet, body: bodyHost };
}

export function closeSheet() {
  if (!open) return;
  const { root, backdrop, release, opener } = open;
  open = null;

  release();
  root.dataset.open = 'false';
  backdrop.dataset.open = 'false';

  setTimeout(() => {
    root.remove();
    backdrop.remove();
  }, 340);

  if (opener instanceof HTMLElement && document.contains(opener)) {
    opener.focus({ preventScroll: true });
  }
}

