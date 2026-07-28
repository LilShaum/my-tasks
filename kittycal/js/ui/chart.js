// @ts-check
/**
 * chart.js — small SVG charts.
 *
 * Hand-rolled rather than a charting library: three chart types at this size
 * is less code than a dependency's configuration, and it keeps the app at zero
 * dependencies.
 *
 * These live in the data zone, so they follow those rules — no decorative
 * motion, tabular numerals, thin strokes. Every chart also carries a text
 * summary for screen readers, because a chart that only exists visually is a
 * chart half the point of which is missing.
 */

import { svg, el } from '../utils/dom.js';

const PAD = { top: 12, right: 10, bottom: 22, left: 30 };

/**
 * Vertical bars with an average line. Used for cycle and period length.
 *
 * @param {Object} opts
 * @param {{label: string, value: number, flagged?: boolean}[]} opts.data
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {number} [opts.average]   draws a dashed reference line
 * @param {[number, number]} [opts.normalBand]  shaded typical range
 * @param {string} opts.summary     the accessible description
 * @param {string} [opts.unit]
 */
export function barChart({
  data, width = 320, height = 150, average, normalBand, summary, unit = '',
}) {
  const chart = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height: String(height),
    class: 'chart',
    role: 'img',
    'aria-label': summary,
    preserveAspectRatio: 'none',
  });

  if (!data.length) return chart;

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const values = data.map((d) => d.value);
  const lo = Math.max(0, Math.min(...values, normalBand?.[0] ?? Infinity) - 3);
  const hi = Math.max(...values, normalBand?.[1] ?? 0) + 3;
  const span = Math.max(1, hi - lo);

  const y = (/** @type {number} */ v) => PAD.top + plotH - ((v - lo) / span) * plotH;

  // Typical-range band behind everything, so out-of-range bars read at a glance.
  if (normalBand) {
    const [bandLo, bandHi] = normalBand;
    chart.append(svg('rect', {
      x: PAD.left, y: y(bandHi),
      width: plotW, height: Math.max(1, y(bandLo) - y(bandHi)),
      fill: 'var(--ok)', opacity: '0.10',
    }));
  }

  const slot = plotW / data.length;
  const barW = Math.max(4, Math.min(26, slot * 0.62));

  data.forEach((point, i) => {
    const cx = PAD.left + slot * i + slot / 2;
    const top = y(point.value);
    chart.append(svg('rect', {
      x: cx - barW / 2,
      y: top,
      width: barW,
      height: Math.max(2, PAD.top + plotH - top),
      rx: Math.min(5, barW / 2),
      fill: point.flagged ? 'var(--warn)' : 'var(--primary)',
      stroke: point.flagged ? 'var(--warn)' : 'var(--primary-line)',
      'stroke-width': '1',
    }));

    // Only label every other bar once they get tight, so they don't collide.
    if (data.length <= 8 || i % 2 === 0) {
      chart.append(svg('text', {
        x: cx, y: height - 7,
        'text-anchor': 'middle',
        class: 'chart-label',
        text: point.label,
      }));
    }
  });

  if (average != null) {
    chart.append(svg('line', {
      x1: PAD.left, x2: width - PAD.right,
      y1: y(average), y2: y(average),
      stroke: 'var(--ink-2)', 'stroke-width': '1.5', 'stroke-dasharray': '4 3',
    }));
    chart.append(svg('text', {
      x: PAD.left - 4, y: y(average) + 3.5,
      'text-anchor': 'end', class: 'chart-label',
      text: `${Math.round(average)}${unit}`,
    }));
  }

  return chart;
}

/**
 * A line with dots. Used for BBT, where the shape between points matters.
 *
 * @param {Object} opts
 * @param {{x: number, y: number}[]} opts.data   x is day-of-cycle
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {number} [opts.coverline]  the BBT thermal-shift baseline
 * @param {number} [opts.marker]     a vertical rule, e.g. detected ovulation
 * @param {string} opts.summary
 * @param {number} [opts.decimals]
 */
export function lineChart({
  data, width = 320, height = 160, coverline, marker, summary, decimals = 2,
}) {
  const chart = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%', height: String(height),
    class: 'chart', role: 'img', 'aria-label': summary,
    preserveAspectRatio: 'none',
  });

  if (data.length < 2) return chart;

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const ys = data.map((d) => d.y);
  const lo = Math.min(...ys, coverline ?? Infinity) - 0.1;
  const hi = Math.max(...ys, coverline ?? -Infinity) + 0.1;
  const span = Math.max(0.2, hi - lo);

  const xs = data.map((d) => d.x);
  const xLo = Math.min(...xs);
  const xHi = Math.max(...xs);
  const xSpan = Math.max(1, xHi - xLo);

  const px = (/** @type {number} */ x) => PAD.left + ((x - xLo) / xSpan) * plotW;
  const py = (/** @type {number} */ v) => PAD.top + plotH - ((v - lo) / span) * plotH;

  // Axis labels: just the extremes, which is all there's room for.
  for (const value of [hi - 0.05, lo + 0.05]) {
    chart.append(svg('text', {
      x: PAD.left - 4, y: py(value) + 3.5,
      'text-anchor': 'end', class: 'chart-label',
      text: value.toFixed(decimals),
    }));
  }

  if (coverline != null) {
    chart.append(svg('line', {
      x1: PAD.left, x2: width - PAD.right,
      y1: py(coverline), y2: py(coverline),
      stroke: 'var(--ovulation)', 'stroke-width': '1.5', 'stroke-dasharray': '4 3',
    }));
  }

  if (marker != null) {
    chart.append(svg('line', {
      x1: px(marker), x2: px(marker),
      y1: PAD.top, y2: PAD.top + plotH,
      stroke: 'var(--ovulation)', 'stroke-width': '2', opacity: '0.5',
    }));
  }

  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${px(d.x)},${py(d.y)}`).join(' ');
  chart.append(svg('path', {
    d: path, fill: 'none',
    stroke: 'var(--primary-line)', 'stroke-width': '2',
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  for (const point of data) {
    chart.append(svg('circle', {
      cx: px(point.x), cy: py(point.y), r: '2.8',
      fill: 'var(--card)', stroke: 'var(--primary-line)', 'stroke-width': '1.5',
    }));
  }

  return chart;
}

/**
 * A one-row heatmap across the cycle: how often something was logged on each
 * day of the cycle. This is the chart that turns "I get cramps sometimes" into
 * "day 1 and 2, in 8 of 9 cycles".
 *
 * Intensity is carried by opacity *and* stated in each cell's title, so it
 * doesn't rely on colour discrimination alone.
 *
 * @param {Object} opts
 * @param {Map<number, number>} opts.byDay   cycle day → count
 * @param {number} opts.cycleLength
 * @param {number} opts.max
 * @param {string} opts.summary
 */
export function dayHeatmap({ byDay, cycleLength, max, summary }) {
  const days = Math.max(1, Math.round(cycleLength));
  const row = el('div', {
    class: 'heatmap',
    role: 'img',
    'aria-label': summary,
    style: { '--heat-cols': String(days) },
  });

  for (let day = 1; day <= days; day++) {
    const count = byDay.get(day) ?? 0;
    const intensity = max > 0 ? count / max : 0;
    row.append(el('span', {
      class: `heat-cell${count ? ' has-value' : ''}`,
      style: { opacity: count ? String(0.22 + intensity * 0.78) : '1' },
      title: `Day ${day}: ${count} ${count === 1 ? 'time' : 'times'}`,
    }));
  }

  return el('div', { class: 'heatmap-wrap' }, [
    row,
    el('div', { class: 'heatmap-axis' }, [
      el('span', { text: 'Day 1' }),
      el('span', { text: `Day ${days}` }),
    ]),
  ]);
}
