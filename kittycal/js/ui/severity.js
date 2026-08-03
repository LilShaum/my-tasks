// @ts-check
/**
 * severity.js — saying how bad it was.
 *
 * Logging that cramps happened is a much weaker statement than it sounds.
 * "Cramps in 8 of 9 cycles" reads the same whether they were a background ache
 * or the kind that costs a day of work, and those are different facts — the
 * second is the one worth taking to a doctor. It is the most-repeated request
 * under every period tracker in the store, and until now we had no way to say
 * it either.
 *
 * The whole design problem is that it must not cost anything.
 *
 * So this is never a question. It appears underneath the symptoms she has
 * already picked, on the same screen, after she has picked them — so a day
 * where she does not care is exactly as many taps as it was before, and a day
 * where she does is one more. There is no "skip" control because there is
 * nothing to skip: Done is already the next thing under it.
 *
 * A rated level tapped again clears it, so a mis-tap costs one tap to undo
 * rather than leaving a wrong number in a clinical document.
 */

import { el, haptic } from '../utils/dom.js';
import { SEVERITY } from '../data/taxonomy.js';

/**
 * @typedef {Object} SeverityBlock
 * @property {HTMLElement} node
 * @property {(ids: string[]) => void} update  repaint for a new selection
 */

/**
 * A rating strip for each currently-selected symptom.
 *
 * The block hides itself entirely when nothing is selected, rather than
 * rendering an empty heading — on the check-in that is the common case, and a
 * permanent "How bad?" over an empty space is a question the screen is asking
 * and she has no way to answer.
 *
 * @param {Object} opts
 * @param {(id: string) => string} opts.label     display name for an id
 * @param {(id: string) => number|undefined} opts.get
 * @param {(id: string, value: 1|2|3|null) => void} opts.set  null clears
 * @param {string} [opts.hint]
 * @returns {SeverityBlock}
 */
export function severityBlock({ label, get, set, hint = 'How bad? Optional.' }) {
  const node = el('div', { class: 'severity-block' });

  /** @param {string[]} ids */
  const update = (ids) => {
    if (!ids.length) {
      node.replaceChildren();
      node.hidden = true;
      return;
    }

    node.hidden = false;
    node.replaceChildren(
      el('p', { class: 'hint-sm severity-hint', text: hint }),
      ...ids.map(row),
    );
  };

  /** @param {string} id */
  function row(id) {
    const name = label(id);

    /** @type {HTMLElement[]} */
    const buttons = [];

    const paint = () => {
      const now = get(id);
      for (const button of buttons) {
        button.setAttribute('aria-pressed', String(Number(button.dataset.level) === now));
      }
    };

    for (const level of SEVERITY) {
      const button = el('button', {
        type: 'button',
        class: 'severity-level',
        'aria-pressed': 'false',
        // The visible word says how bad, but not how bad *what* — the symptom
        // it belongs to is a sibling node, so the accessible name repeats it.
        'aria-label': `${level.label} ${name}`,
        dataset: { level: String(level.value) },
        onclick: () => {
          haptic(8);
          // Tapping the current level clears it. Severity is optional, so
          // there has to be a way back to having not said.
          set(id, get(id) === level.value ? null : level.value);
          paint();
        },
      }, [el('span', { 'aria-hidden': 'true', text: level.label })]);

      buttons.push(button);
    }

    paint();

    return el('div', { class: 'severity-row' }, [
      el('span', { class: 'severity-name', text: name }),
      // Grouped so a screen reader announces the three as one control rather
      // than three unrelated buttons that happen to follow a word.
      el('div', { class: 'severity-scale', role: 'group', 'aria-label': `How bad was ${name}?` },
        buttons),
    ]);
  }

  update([]);
  return { node, update };
}
