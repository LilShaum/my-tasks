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
 * A measurement per cycle, plotted as dots on a scale.
 *
 * This was a bar chart, and a bar chart was the wrong form for it. Cycle
 * lengths sit between about 21 and 45 days, so a bar starting at zero is
 * eight-ninths empty and every bar looks the same height — which is why the
 * baseline had been quietly moved up to just below the smallest value. That
 * makes the picture a lie: with a baseline at 22, a 25-day cycle drew at a
 * third the height of a 36-day one, so the chart said "less than half as long"
 * about two cycles that differ by eleven days.
 *
 * A dot has no baseline to be honest or dishonest about. Its *position*
 * carries the value, which is exactly the claim we can support, and the
 * connecting line answers the question this card actually exists for — is this
 * steady, or is it wandering?
 *
 * @param {Object} opts
 * @param {{label: string, value: number, flagged?: boolean}[]} opts.data
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {number} [opts.average]   a reference line
 * @param {[number, number]} [opts.normalBand]  the typical range, shaded
 * @param {string} opts.summary     the accessible description
 * @param {string} [opts.unit]
 * @param {number} [opts.decimals]  for values that are not whole, like weight
 */
export function trendChart({
  data, width = 320, height = 168, average, normalBand, summary, unit = '', decimals = 0,
}) {
  const chart = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'chart',
    role: 'img',
    'aria-label': summary,
  });

  if (!data.length) return chart;

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const values = data.map((d) => d.value);
  const rawLo = Math.min(...values, normalBand?.[0] ?? Infinity);
  const rawHi = Math.max(...values, normalBand?.[1] ?? -Infinity);
  // A little air above and below, so a dot sitting exactly on the band edge
  // is not drawn half outside the plot.
  const margin = Math.max(1, (rawHi - rawLo) * 0.15);
  const lo = rawLo - margin;
  const span = Math.max(1, (rawHi + margin) - lo);

  const y = (/** @type {number} */ v) => PAD.top + plotH - ((v - lo) / span) * plotH;
  const slot = plotW / data.length;
  const x = (/** @type {number} */ i) => PAD.left + slot * i + slot / 2;

  const show = (/** @type {number} */ v) => v.toFixed(decimals);

  /** Left-gutter numbers, so any dot can be read off the scale. */
  const tick = (/** @type {number} */ value) => {
    chart.append(svg('text', {
      x: PAD.left - 5, y: y(value) + 3,
      'text-anchor': 'end', class: 'chart-label',
      text: show(value),
    }));
  };

  /*
    Without a typical range there is nothing else numbering the scale, so the
    extremes do it. Weight and sleep have no published normal band — and a
    chart whose only number is the average is one you cannot read a single dot
    off.
  */
  if (!normalBand) {
    tick(rawLo);
    if (rawHi - rawLo > 0.01) tick(rawHi);
  }

  /*
    The typical range, with hairline edges.

    It used to be a 10%-opacity wash with no boundary, so "the green band is
    21-35 days" was a sentence you had to take on trust — there was nothing on
    the chart at 21 or at 35 to look at. Drawing and numbering the edges is
    what turns it from a tint into a scale.
  */
  if (normalBand) {
    const [bandLo, bandHi] = normalBand;
    chart.append(svg('rect', {
      x: PAD.left, y: y(bandHi),
      width: plotW, height: Math.max(1, y(bandLo) - y(bandHi)),
      fill: 'var(--ok)', opacity: '0.14',
    }));

    for (const edge of [bandLo, bandHi]) {
      chart.append(svg('line', {
        x1: PAD.left, x2: width - PAD.right,
        y1: y(edge), y2: y(edge),
        stroke: 'var(--ok)', 'stroke-width': '1', opacity: '0.55',
      }));
      tick(edge);
    }
  }

  if (average != null) {
    chart.append(svg('line', {
      x1: PAD.left, x2: width - PAD.right,
      y1: y(average), y2: y(average),
      stroke: 'var(--ink-3)', 'stroke-width': '1.5', 'stroke-dasharray': '4 3',
    }));

    /*
      Numbered in the gutter with the band edges, not spelled out on the plot.

      "average 29d" set inside the plot area is a label with nowhere safe to
      go: put it at either end and it lands on whichever dot happens to be
      there. The gutter is the one column guaranteed to be empty, the dashed
      rule already reads as a reference rather than data, and the stat tile
      directly beneath the chart says AVERAGE 29 DAYS in type four times the
      size — so nothing is lost by letting the gutter carry just the number.
    */
    const clashes = normalBand?.some((edge) => Math.abs(y(edge) - y(average)) < 9);
    if (!clashes) tick(average);
  }

  if (data.length > 1) {
    chart.append(svg('path', {
      d: data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.value)}`).join(' '),
      fill: 'none',
      stroke: 'var(--primary-line)', 'stroke-width': '2',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      opacity: '0.55',
    }));
  }

  /** At most six x labels, however many points there are. */
  const stride = Math.max(1, Math.ceil(data.length / 5));
  let lastLabel = '';

  data.forEach((point, i) => {
    const cx = x(i);
    const cy = y(point.value);

    /*
      Out-of-range points get a ring as well as the warning colour, and are
      always labelled. Colour alone would be the whole signal otherwise, which
      fails anyone who cannot separate these two hues — and this is the one
      mark on the chart that is actually trying to tell her something.
    */
    if (point.flagged) {
      chart.append(svg('circle', {
        cx: String(cx), cy: String(cy), r: '7',
        fill: 'none', stroke: 'var(--warn)', 'stroke-width': '1.5',
      }));
    }

    chart.append(svg('circle', {
      cx: String(cx), cy: String(cy), r: '4',
      fill: point.flagged ? 'var(--warn)' : 'var(--primary)',
      stroke: 'var(--card)', 'stroke-width': '1.5',
    }));

    // Selectively labelled: the newest reading and anything unusual. A number
    // over every dot is unreadable at this size and goes unread anyway.
    if (point.flagged || i === data.length - 1) {
      const above = cy > PAD.top + 18;
      chart.append(svg('text', {
        x: String(cx), y: String(above ? cy - 12 : cy + 19),
        'text-anchor': 'middle', class: 'chart-label chart-value',
        text: `${show(point.value)}${unit}`,
      }));
    }

    /*
      A handful of x labels, evenly spread, never the same word twice running.

      Both rules earn their place. Labelling every point overlapped at eight
      cycles; labelling every other one was fine for a series of cycles and
      absurd for a series of nights, where sixteen readings from one month
      printed "Jul" eight times in a row. The stride keeps the count sane and
      the dedupe keeps a repeated month from being said at all.
    */
    if (i % stride === 0 || i === data.length - 1) {
      if (point.label !== lastLabel) {
        lastLabel = point.label;
        chart.append(svg('text', {
          x: String(cx), y: String(height - 6),
          'text-anchor': 'middle', class: 'chart-label',
          text: point.label,
        }));
      }
    }
  });

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
    class: 'chart', role: 'img', 'aria-label': summary,
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
