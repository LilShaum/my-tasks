// @ts-check
/**
 * ring.js — the cycle ring on the Today screen.
 *
 * An SVG donut showing the whole cycle at a glance: coloured arcs for each
 * phase, a marker at today's position, and the headline number in the middle.
 *
 * The centre is the app's most-looked-at piece of data, so it follows the
 * data-zone rules — tabular numerals, no decorative motion, plain copy — even
 * though it sits inside the cute part of the app.
 *
 * @typedef {import('../domain/predict.js').Prediction} Prediction
 */

import { svg, el } from '../utils/dom.js';
import { ringSegments, PHASES } from '../domain/phases.js';

const SIZE = 240;
const STROKE = 18;
const R = (SIZE - STROKE) / 2 - 8;
const CX = SIZE / 2;
const CY = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * Point on the ring for a fraction of the way round, starting at 12 o'clock
 * and going clockwise.
 * @param {number} fraction 0..1
 * @returns {{x: number, y: number}}
 */
function pointAt(fraction) {
  const angle = fraction * Math.PI * 2 - Math.PI / 2;
  return { x: CX + Math.cos(angle) * R, y: CY + Math.sin(angle) * R };
}

/**
 * Build the ring.
 *
 * @param {Object} opts
 * @param {Prediction} opts.prediction
 * @param {string} opts.headline    the big number or short word
 * @param {string} opts.caption     the line under it
 * @param {string} [opts.eyebrow]   the small line above it
 * @returns {HTMLElement}
 */
export function cycleRing({ prediction, headline, caption, eyebrow }) {
  const segments = ringSegments(prediction);
  const total = prediction.avgCycleLength || 28;

  // Where today sits on the ring. Clamped to just under a full turn so a late
  // period doesn't wrap the marker back round to the start and read as day 1.
  const day = prediction.cycleDay ?? 0;
  const progress = total > 0 ? Math.min(0.999, Math.max(0, (day - 1) / total)) : 0;

  const ring = svg('svg', {
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    width: SIZE,
    height: SIZE,
    class: 'cycle-ring',
    role: 'img',
    'aria-label': buildRingLabel(prediction, headline, caption),
  });

  // Track.
  ring.append(svg('circle', {
    cx: CX, cy: CY, r: R,
    fill: 'none',
    stroke: 'var(--surface-3)',
    'stroke-width': STROKE,
  }));

  // Phase arcs. Drawn with dash offsets rather than arc paths — one primitive,
  // no large-arc-flag edge cases at the half-way point.
  for (const segment of segments) {
    const length = (segment.to - segment.from) * CIRCUMFERENCE;
    if (length <= 0) continue;
    ring.append(svg('circle', {
      cx: CX, cy: CY, r: R,
      fill: 'none',
      stroke: `var(${PHASES[segment.id].token})`,
      'stroke-width': STROKE,
      'stroke-dasharray': `${length} ${CIRCUMFERENCE - length}`,
      'stroke-dashoffset': `${-segment.from * CIRCUMFERENCE}`,
      transform: `rotate(-90 ${CX} ${CY})`,
      'stroke-linecap': 'butt',
    }));
  }

  // Today's marker.
  if (prediction.cycleDay != null) {
    const { x, y } = pointAt(progress);
    ring.append(svg('circle', {
      cx: x, cy: y, r: STROKE / 2 + 4,
      fill: 'var(--card)',
      stroke: 'var(--ink)',
      'stroke-width': 3,
    }));
    ring.append(svg('circle', { cx: x, cy: y, r: 4, fill: 'var(--ink)' }));
  }

  return el('div', { class: 'ring-wrap' }, [
    ring,
    el('div', { class: 'ring-center data-zone' }, [
      eyebrow && el('span', { class: 'ring-eyebrow', text: eyebrow }),
      el('span', { class: 'ring-headline num', text: headline }),
      el('span', { class: 'ring-caption', text: caption }),
    ]),
  ]);
}

/**
 * A single sentence describing the ring, for screen readers. The visual is a
 * chart; the label has to carry the same information in words.
 * @param {Prediction} prediction
 * @param {string} headline
 * @param {string} caption
 */
function buildRingLabel(prediction, headline, caption) {
  const parts = [`${headline}. ${caption}.`];
  if (prediction.cycleDay != null) {
    parts.push(`Day ${prediction.cycleDay} of an estimated ${prediction.avgCycleLength} day cycle.`);
  }
  return parts.join(' ');
}

