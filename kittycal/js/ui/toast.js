// @ts-check
/**
 * toast.js — transient messages, with an optional undo.
 *
 * Toasts are decoration around the real signal: every call also announces to
 * the live region, so the message reaches a screen reader whether or not the
 * visual toast is seen. Copy stays plain — a toast often carries a number.
 */

import { el, need, announce } from '../utils/dom.js';

const DEFAULT_MS = 3200;

/** @type {Set<HTMLElement>} */
const live = new Set();

/**
 * @param {string} message
 * @param {{ms?: number, action?: {label: string, onAction: () => void}, silent?: boolean}} [opts]
 */
export function toast(message, opts = {}) {
  const { ms = DEFAULT_MS, action, silent = false } = opts;
  const host = need('#toast-host');

  // More than a couple stacked is noise; retire the oldest.
  while (live.size >= 2) {
    const oldest = live.values().next().value;
    if (oldest) dismiss(oldest);
  }

  /** @type {HTMLElement} */
  let node;

  const button = action
    ? el('button', {
        class: 'toast-action',
        type: 'button',
        text: action.label,
        onclick: () => {
          action.onAction();
          dismiss(node);
        },
      })
    : null;

  node = el('div', { class: 'toast', role: 'status' }, [
    el('span', { text: message }),
    button,
  ]);

  host.append(node);
  live.add(node);

  if (!silent) announce(message);

  const timer = setTimeout(() => dismiss(node), ms);
  node.dataset.timer = String(timer);

  return node;
}

/** @param {HTMLElement} node */
function dismiss(node) {
  if (!live.has(node)) return;
  live.delete(node);
  clearTimeout(Number(node.dataset.timer));
  node.style.transition = 'opacity 180ms, transform 180ms';
  node.style.opacity = '0';
  node.style.transform = 'translateY(6px) scale(0.97)';
  setTimeout(() => node.remove(), 200);
}

/**
 * Toast with an undo affordance. Returns nothing — the caller owns the undo
 * closure and whatever state it needs to restore.
 * @param {string} message
 * @param {() => void} onUndo
 */
export function toastUndo(message, onUndo) {
  return toast(message, { ms: 5200, action: { label: 'Undo', onAction: onUndo } });
}

export function clearToasts() {
  for (const node of [...live]) dismiss(node);
}
