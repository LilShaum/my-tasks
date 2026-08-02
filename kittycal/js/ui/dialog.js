// @ts-check
/**
 * dialog.js — asking a question without leaving the app.
 *
 * Kittycal used `window.confirm` and `window.prompt` for nine decisions,
 * including the two that matter most: setting a passcode, and erasing
 * everything. They work, and they are wrong here for reasons that go past
 * looks:
 *
 *   - A native dialog is stamped with the origin. In an installed app that
 *     reads as "lilshaum.github.io wants your passcode", which is precisely
 *     the shape of a phishing prompt, on the one screen where being trusted
 *     matters.
 *   - The text is truncated. The passcode prompt explained in three sentences
 *     that this is not encryption; a phone shows roughly the first one.
 *   - There is no styling, no theme, no haptics, and the buttons are the
 *     platform's. A system dialog in the middle of a themed app reads as
 *     something having gone wrong.
 *   - `confirm` gives one undifferentiated OK. Erasing everything used two of
 *     them back to back, which is not twice the friction — it is the same
 *     dismissal reflex, twice.
 *
 * These build on the app's own sheet, so they trap focus, close on Escape,
 * restore focus to whatever opened them, and look like the rest of Kittycal.
 * Both resolve rather than throw, so a caller can always `await` them, and
 * every way of dismissing one — backdrop, Escape, the close button — means no.
 */

import { el, haptic } from '../utils/dom.js';
import { openSheet, closeSheet } from './sheet.js';

/**
 * Ask for a yes or no.
 *
 * The confirming button carries the verb — "Erase everything", not "OK" — so
 * the last thing read before tapping is what is about to happen.
 *
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string[]} opts.body       one paragraph each
 * @param {string} opts.confirmLabel
 * @param {boolean} [opts.danger]    irreversible; styles the action accordingly
 * @returns {Promise<boolean>}
 */
export function confirmSheet({ title, body, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    let answered = false;

    const finish = (/** @type {boolean} */ value) => {
      if (answered) return;
      answered = true;
      resolve(value);
    };

    const sheet = openSheet({
      title,
      body: [
        ...body.map((text) => el('p', { class: 'hint dialog-body-p', text })),
        el('div', { class: 'dialog-actions' }, [
          el('button', {
            type: 'button',
            class: `btn btn-block btn-lg${danger ? ' btn-danger' : ''}`,
            onclick: () => { haptic(); finish(true); sheet.close(); },
          }, [confirmLabel]),
          el('button', {
            type: 'button',
            class: 'btn btn-ghost btn-block',
            onclick: () => { haptic(); finish(false); sheet.close(); },
          }, ['Cancel']),
        ]),
      ],
      // Backdrop tap, Escape and the close button all land here, and all of
      // them mean no.
      onClose: () => finish(false),
    });
  });
}

/**
 * Ask for a short piece of text.
 *
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string[]} [opts.body]
 * @param {string} opts.label            the field's own label
 * @param {string} opts.confirmLabel
 * @param {string} [opts.placeholder]
 * @param {'text'|'numeric'} [opts.mode] numeric brings up a digit keypad
 * @param {number} [opts.maxLength]
 * @param {boolean} [opts.secret]        masked, for a passcode
 * @param {(value: string) => string|null} [opts.validate] message, or null if fine
 * @returns {Promise<string|null>} null when cancelled
 */
export function promptSheet({
  title, body = [], label, confirmLabel, placeholder, mode = 'text',
  maxLength, secret = false, validate,
}) {
  return new Promise((resolve) => {
    let answered = false;
    const finish = (/** @type {string|null} */ value) => {
      if (answered) return;
      answered = true;
      resolve(value);
    };

    const error = el('p', { class: 'dialog-error', role: 'alert' });

    const input = el('input', {
      type: secret ? 'password' : 'text',
      class: 'input dialog-input',
      id: 'dialog-input',
      inputmode: mode,
      autocomplete: 'off',
      autocapitalize: mode === 'numeric' ? 'off' : 'sentences',
      ...(maxLength ? { maxlength: String(maxLength) } : {}),
      ...(placeholder ? { placeholder } : {}),
      // data-autofocus so the sheet lands on the field rather than its own
      // close button — there is exactly one thing to do here.
      'data-autofocus': '',
    });

    const submit = () => {
      const value = /** @type {HTMLInputElement} */ (input).value.trim();
      const problem = validate?.(value) ?? null;
      if (problem) {
        error.textContent = problem;
        haptic([10, 40, 10]);
        /** @type {HTMLInputElement} */ (input).focus();
        return;
      }
      haptic();
      finish(value);
      closeSheet();
    };

    openSheet({
      title,
      body: [
        ...body.map((text) => el('p', { class: 'hint dialog-body-p', text })),
        el('label', { class: 'dialog-label', for: 'dialog-input', text: label }),
        input,
        error,
        el('div', { class: 'dialog-actions' }, [
          el('button', {
            type: 'button', class: 'btn btn-block btn-lg', onclick: submit,
          }, [confirmLabel]),
          el('button', {
            type: 'button',
            class: 'btn btn-ghost btn-block',
            onclick: () => { haptic(); finish(null); closeSheet(); },
          }, ['Cancel']),
        ]),
      ],
      onClose: () => finish(null),
    });

    // Enter submits, which is what a single-field form should do everywhere.
    input.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
  });
}
