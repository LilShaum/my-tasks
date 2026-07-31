// @ts-check
/**
 * fmt.js — units and number display.
 *
 * Storage is always canonical (°C, kg, ml) and conversion happens only at the
 * display boundary. That way changing a unit preference never rewrites stored
 * data, and never accumulates rounding error.
 *
 * Every displayed value carries an explicit unit and an explicit precision.
 * Ambiguity is what makes a cute health app feel untrustworthy — much more
 * than the pink does.
 */

/** @param {number} c @returns {number} */
export const cToF = (c) => c * 9 / 5 + 32;
/** @param {number} f @returns {number} */
export const fToC = (f) => (f - 32) * 5 / 9;
/** @param {number} kg @returns {number} */
export const kgToLb = (kg) => kg * 2.2046226;
/** @param {number} lb @returns {number} */
export const lbToKg = (lb) => lb / 2.2046226;
/** @param {number} ml @returns {number} */
export const mlToOz = (ml) => ml / 29.5735296;

/**
 * Basal body temperature. Two decimals in °C, one in °F — BBT charting turns
 * on tenths of a degree, so precision here is functional, not cosmetic.
 * @param {number|null} celsius
 * @param {'C'|'F'} unit
 */
export function fmtTemp(celsius, unit) {
  if (celsius == null) return '—';
  return unit === 'F'
    ? `${cToF(celsius).toFixed(1)}°F`
    : `${celsius.toFixed(2)}°C`;
}

/**
 * @param {number|null} kg
 * @param {'kg'|'lb'} unit
 */
export function fmtWeight(kg, unit) {
  if (kg == null) return '—';
  return unit === 'lb'
    ? `${kgToLb(kg).toFixed(1)} lb`
    : `${kg.toFixed(1)} kg`;
}

/**
 * @param {number} ml
 * @param {'ml'|'oz'} unit
 */
export function fmtWater(ml, unit) {
  if (!ml) return '0';
  return unit === 'oz'
    ? `${Math.round(mlToOz(ml))} oz`
    : ml >= 1000 ? `${(ml / 1000).toFixed(1)} L` : `${Math.round(ml)} ml`;
}

/**
 * A count with its noun pluralised.
 * @param {number} n
 * @param {string} singular
 * @param {string} [plural]
 */
export function plural(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural ?? `${singular}s`}`;
}

/** @param {number} n @param {number} [places] */
export function round(n, places = 0) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** @param {number} n @param {number} lo @param {number} hi */
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Join a list the way a person would: 'a', 'a and b', 'a, b and c'.
 * @param {string[]} items
 */
export function listJoin(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
