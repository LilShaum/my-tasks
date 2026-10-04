// @ts-check
/**
 * measure.js — one numeric reading, with its unit and its plausible range.
 *
 * Shared by the full diary and the daily check-in. It lived inside log.js, and
 * when the check-in was taught to ask for a temperature it grew its own copy of
 * the input instead — with its own unit conversion and none of the range
 * checking. That copy stored whatever was typed, which brought back the exact
 * bug this row had been fixed for: a dropped decimal point saving 366 °C, a
 * baseline dragged up fifty degrees, and ovulation "confirmed" on a day nothing
 * happened. Two copies of the rules for a number is how one of them goes wrong
 * unnoticed, so there is one.
 *
 * The caller owns where the value lives: `get` reads it, `set` stores it (and
 * does whatever else the caller needs on change). Values pass through in
 * canonical units — °C, kg — whatever she reads and types in.
 *
 * @typedef {import('../data/taxonomy.js').MEASURES[number]} Measure
 */

import { el, svg } from '../utils/dom.js';
import { cToF, fToC, kgToLb, lbToKg, round } from '../utils/fmt.js';

/**
 * @param {Object} o
 * @param {Measure} o.measure
 * @param {import('../domain/model.js').Settings} o.settings
 * @param {() => number|null} o.get   the stored value, in canonical units
 * @param {(value: number|null) => void} o.set
 */
export function measureRow({ measure, settings, get, set }) {
  const unit = measure.unitSetting
    ? /** @type {any} */ (settings)[measure.unitSetting]
    : null;

  /** Stored value → the number shown in the input. */
  const toDisplay = (/** @type {number|null} */ v) => {
    if (v == null) return '';
    if (measure.id === 'bbt' && unit === 'F') return round(cToF(v), 1).toString();
    if (measure.id === 'weight' && unit === 'lb') return round(kgToLb(v), 1).toString();
    return round(v, measure.decimals).toString();
  };

  /** Typed number → the value we store. */
  const toStored = (/** @type {number} */ v) => {
    if (measure.id === 'bbt' && unit === 'F') return fToC(v);
    if (measure.id === 'weight' && unit === 'lb') return lbToKg(v);
    return v;
  };

  const unitLabel = measure.id === 'bbt' ? `°${unit}`
    : measure.id === 'weight' ? String(unit)
    : measure.id === 'sleep' ? 'hours'
    : 'steps';

  const clear = el('button', {
    type: 'button',
    class: 'btn-icon measure-clear',
    'aria-label': `Clear ${measure.name.toLowerCase()}`,
    hidden: get() == null,
    onclick: () => {
      set(null);
      input.value = '';
      clear.hidden = true;
    },
  }, [
    svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
                 'stroke-width': '2', 'stroke-linecap': 'round',
                 'aria-hidden': 'true' }, [
      svg('path', { d: 'M6 6l12 12M18 6L6 18' }),
    ]),
  ]);

  /*
    A number that cannot be true is not kept.

    `MEASURES` has carried a plausible range for every field since it was
    written — 35 to 39 °C, 30 to 200 kg — and nothing enforced it. The handler
    checked `Number.isFinite` and stored whatever that let through, so a
    dropped decimal point put 366 °C in the database.

    That is not merely a silly number on a screen. `detectThermalShift` reads
    the mean of the six readings before a candidate day, so one bad entry drags
    that baseline up by fifty degrees and the app can report ovulation
    "confirmed" on a day nothing happened — a false statement about her body,
    from a typo. It also flattens the BBT chart to a horizontal line, because
    the y-scale has to span the impossible value.

    Rejected rather than clamped. Clamping 366 to 39 produces a number that
    looks like a reading and is not one; nobody would ever notice it. The whole
    point is that she gets told.
  */
  const lo = Number(toDisplay(measure.min));
  const hi = Number(toDisplay(measure.max));

  const problem = el('p', { class: 'hint-sm measure-problem', role: 'alert', hidden: true });

  const input = /** @type {HTMLInputElement} */ (el('input', {
    class: 'input num measure-input',
    type: 'number',
    inputmode: 'decimal',
    step: String(measure.step),
    min: String(lo),
    max: String(hi),
    placeholder: '–',
    value: toDisplay(get()),
    'aria-label': `${measure.name} in ${unitLabel}`,
    oninput: (/** @type {Event} */ e) => {
      const raw = /** @type {HTMLInputElement} */ (e.target).value;
      clear.hidden = raw === '';
      problem.hidden = true;
      input.removeAttribute('aria-invalid');
      if (raw === '') { set(null); return; }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      /*
        Out-of-range keystrokes are simply not stored, but nothing is said
        yet — she is very likely still typing, and "35 is too low" flashing up
        while she reaches for the decimal point would be the app arguing with
        her mid-word. The complaint waits for `change`, which fires when she
        leaves the field.
      */
      if (parsed < lo || parsed > hi) { set(null); return; }
      set(toStored(parsed));
    },
    onchange: () => {
      const raw = input.value;
      if (raw === '') return;
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= lo && parsed <= hi) return;

      problem.textContent = `${measure.name} has to be between ${lo} and ${hi} `
        + `${unitLabel}. Nothing was saved for it.`;
      problem.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.value = '';
      clear.hidden = true;
      set(null);
    },
  }));

  return el('div', { class: 'measure-row', dataset: { field: measure.id } }, [
    el('label', { class: 'measure-label' }, [
      el('span', { text: measure.name }),
      measure.hint && el('span', { class: 'hint-sm', text: measure.hint }),
      problem,
    ]),
    el('div', { class: 'measure-control' }, [
      input,
      el('span', { class: 'hint-sm measure-unit', text: unitLabel }),
      clear,
    ]),
  ]);
}
