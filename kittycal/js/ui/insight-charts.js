// @ts-check
/**
 * insight-charts.js — the charts the redesigned Insights screen is built from.
 *
 * Each one answers a single question, and is drawn so the answer is visible
 * before a single number is read:
 *
 *   - `rhythmCurve`   how something rises and falls across her cycle
 *   - `bodyMapGrid`   when in her cycle each symptom tends to land
 *   - `fingerprint`   what each period looked like, day by day
 *   - `pairedBars`    how often something happened with and without a condition
 *
 * The first two share one horizontal axis: the days after a period starts on
 * the left, the days before the next one on the right. Lining things up
 * against *her period* rather than a day number is the point — "day 26" means
 * a different thing in a 26-day cycle than in a 32-day one, while "three days
 * before your period" means the same thing every time.
 *
 * Same data-zone rules as chart.js: thin strokes, tabular numerals, no motion,
 * and a text summary on every chart for screen readers.
 */

import { svg, el } from '../utils/dom.js';

/** How many days each side of the curve shows. Matches AFTER/BEFORE in rhythm.js. */
const SIDE = 14;

/**
 * Average each point with its neighbours, so one odd day does not draw a spike.
 * A slot with no data stays empty rather than being invented from its
 * neighbours.
 *
 * @param {(number|null)[]} values
 * @returns {(number|null)[]}
 */
function smooth(values) {
  return values.map((value, i) => {
    if (value == null) return null;
    const near = [values[i - 1], value, values[i + 1]].filter((v) => v != null);
    return /** @type {number[]} */ (near).reduce((a, b) => a + b, 0) / near.length;
  });
}

/**
 * The 28 slots of the shared axis, left to right: day 1 … day 14 after the
 * period starts, then 14 … 1 days before the next.
 *
 * @param {(number|null)[]} after
 * @param {(number|null)[]} before
 */
function joined(after, before) {
  return [...after.slice(0, SIDE), ...before.slice(0, SIDE).reverse()];
}

/**
 * A smooth line across her cycle.
 *
 * @param {Object} opts
 * @param {(number|null)[]} opts.after   index 0 = day 1 of the period
 * @param {(number|null)[]} opts.before  index 0 = the day before the next period
 * @param {number} opts.min
 * @param {number} opts.max
 * @param {{value: number, label: string}[]} opts.ticks
 * @param {number} [opts.periodDays]     shaded at the left, in the period colour
 * @param {number} [opts.window]         the days-before stretch the finding is about, shaded
 * @param {number|null} [opts.reference] a dashed line, e.g. the rest-of-cycle average
 * @param {string} [opts.referenceLabel]
 * @param {string} opts.summary
 */
export function rhythmCurve({
  after, before, min, max, ticks, periodDays = 5, window = 0, reference = null,
  referenceLabel = '', summary,
}) {
  const width = 320;
  const height = 168;
  const pad = { top: 14, right: 8, bottom: 30, left: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slots = SIDE * 2;

  const x = (/** @type {number} */ i) => pad.left + ((i + 0.5) * plotW) / slots;
  const y = (/** @type {number} */ v) =>
    pad.top + plotH - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * plotH;

  const chart = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'chart rhythm-chart',
    role: 'img',
    'aria-label': summary,
  });

  const slotW = plotW / slots;

  // The period, in its own colour, so the left edge reads as "your period"
  // without a legend.
  if (periodDays > 0) {
    chart.append(svg('rect', {
      class: 'rhythm-zone-period',
      x: pad.left, y: pad.top,
      width: slotW * Math.min(SIDE, periodDays), height: plotH,
      rx: 4,
    }));
  }

  // The stretch the title is talking about.
  if (window > 0) {
    chart.append(svg('rect', {
      class: 'rhythm-zone-window',
      x: pad.left + plotW - slotW * Math.min(SIDE, window), y: pad.top,
      width: slotW * Math.min(SIDE, window), height: plotH,
      rx: 4,
    }));
  }

  for (const tick of ticks) {
    chart.append(svg('line', {
      class: 'rhythm-grid',
      x1: pad.left, x2: pad.left + plotW, y1: y(tick.value), y2: y(tick.value),
    }));
    chart.append(svg('text', {
      class: 'chart-label', x: pad.left - 6, y: y(tick.value) + 3, 'text-anchor': 'end',
      text: tick.label,
    }));
  }

  // Where the two halves meet. Not a real day boundary in every cycle, so it
  // is drawn as a quiet seam rather than an axis.
  chart.append(svg('line', {
    class: 'rhythm-seam',
    x1: pad.left + plotW / 2, x2: pad.left + plotW / 2, y1: pad.top, y2: pad.top + plotH,
  }));

  if (reference != null) {
    chart.append(svg('line', {
      class: 'rhythm-reference',
      x1: pad.left, x2: pad.left + plotW, y1: y(reference), y2: y(reference),
    }));
  }

  const values = smooth(joined(after, before));

  // Broken wherever there is no data, never bridged: a line across a gap
  // claims days nobody logged.
  /** @type {string[]} */
  const runs = [];
  /** @type {[number, number][]} */
  let run = [];
  const flush = () => {
    if (run.length > 1) runs.push(run.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(''));
    run = [];
  };
  values.forEach((value, i) => {
    if (value == null) { flush(); return; }
    run.push([x(i), y(value)]);
  });
  flush();

  for (const d of runs) {
    // A soft fill under the line, then the line itself.
    const first = d.match(/^M([\d.]+)/);
    const last = d.match(/L?([\d.]+),[\d.]+$/);
    if (first && last) {
      chart.append(svg('path', {
        class: 'rhythm-area',
        d: `${d}L${last[1]},${pad.top + plotH}L${first[1]},${pad.top + plotH}Z`,
      }));
    }
    chart.append(svg('path', { class: 'rhythm-line', d }));
  }

  const base = pad.top + plotH + 16;
  chart.append(svg('text', { class: 'chart-label', x: pad.left, y: base, text: 'Period starts' }));
  chart.append(svg('text', {
    class: 'chart-label', x: pad.left + plotW / 2, y: base, 'text-anchor': 'middle', text: 'Middle',
  }));
  chart.append(svg('text', {
    class: 'chart-label', x: pad.left + plotW, y: base, 'text-anchor': 'end', text: 'Next period',
  }));

  /*
    The key sits under the chart, not on it. Written on the plot, the label
    for the dashed line ran straight through the curve wherever the two met.
  */
  const key = [
    window > 0 && el('span', { class: 'rhythm-key' }, [
      el('span', { class: 'rhythm-swatch is-window', 'aria-hidden': 'true' }),
      `the ${plural(window, 'day')} before your period`,
    ]),
    reference != null && referenceLabel && el('span', { class: 'rhythm-key' }, [
      el('span', { class: 'rhythm-swatch is-reference', 'aria-hidden': 'true' }),
      referenceLabel,
    ]),
  ].filter(Boolean);

  return key.length
    ? el('div', { class: 'rhythm-wrap' }, [chart, el('div', { class: 'rhythm-keys', 'aria-hidden': 'true' }, key)])
    : chart;
}

/** @param {number} n @param {string} word */
function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Days shown on each side of the body map. Fewer than the curve: it has to fit a row label. */
const MAP_AFTER = 7;
const MAP_BEFORE = 10;

/**
 * When each symptom tends to show up, one row per symptom.
 *
 * Darker cells are days it turned up in more of her cycles. The sentence under
 * the name says the same thing in words, so the grid is the picture and never
 * the only way to get the answer.
 *
 * @param {Object} opts
 * @param {{label: string, sentence: string, after: (number|null)[], before: (number|null)[]}[]} opts.rows
 * @param {string} opts.summary
 */
export function bodyMapGrid({ rows, summary }) {
  const cell = (/** @type {number|null} */ rate) => el('span', {
    class: `map-cell${rate ? ' has-value' : ''}`,
    style: rate ? { '--heat': String(Math.min(1, 0.18 + rate * 0.82)) } : {},
  });

  return el('div', { class: 'body-map', role: 'img', 'aria-label': summary }, [
    el('div', { class: 'map-axis', 'aria-hidden': 'true' }, [
      el('span', { class: 'map-axis-after', text: 'Your period →' }),
      el('span', { class: 'map-axis-before', text: '← Before the next' }),
    ]),
    ...rows.map((row) => el('div', { class: 'map-row' }, [
      el('div', { class: 'map-row-head' }, [
        el('span', { class: 'map-row-label', text: row.label }),
        el('span', { class: 'map-row-sentence', text: row.sentence }),
      ]),
      el('div', { class: 'map-cells', 'aria-hidden': 'true' }, [
        ...row.after.slice(0, MAP_AFTER).map(cell),
        el('span', { class: 'map-gap' }),
        ...row.before.slice(0, MAP_BEFORE).reverse().map(cell),
      ]),
    ])),
  ]);
}

/** How strongly each flow level is drawn. Spotting is outlined rather than filled. */
const FLOW_STRENGTH = /** @type {Record<string, number>} */ ({
  heavy: 1, clots: 1, medium: 0.62, light: 0.32, spotting: 0.14,
});

/**
 * Each period as a row of days, shaded by how heavy each day was.
 *
 * @param {Object} opts
 * @param {{label: string, flows: string[]}[]} opts.rows  newest first
 * @param {number|null} [opts.highlightDay]  1-based, outlined in every row
 * @param {string} opts.summary
 */
export function fingerprint({ rows, highlightDay = null, summary }) {
  const width = Math.max(7, ...rows.map((r) => r.flows.length));
  return el('div', { class: 'fingerprint', role: 'img', 'aria-label': summary }, [
    el('div', { class: 'fp-row fp-head', 'aria-hidden': 'true', style: { '--fp-cols': String(width) } }, [
      el('span', { class: 'fp-label' }),
      ...Array.from({ length: width }, (_, i) => el('span', {
        class: `fp-day${highlightDay === i + 1 ? ' is-highlight' : ''}`, text: `D${i + 1}`,
      })),
    ]),
    ...rows.map((row) => el('div', {
      class: 'fp-row', 'aria-hidden': 'true', style: { '--fp-cols': String(width) },
    }, [
      el('span', { class: 'fp-label', text: row.label }),
      ...Array.from({ length: width }, (_, i) => {
        const flow = row.flows[i];
        const strength = flow ? FLOW_STRENGTH[flow] ?? 0 : 0;
        // Past the end of this period: a pinpoint, so it can never be read as a light day.
        if (i >= row.flows.length) return el('span', { class: 'fp-cell is-after' });
        return el('span', {
          class: `fp-cell${strength ? ' has-flow' : ''}${flow === 'spotting' ? ' is-spotting' : ''}`
            + `${flow === 'unknown' ? ' is-unknown' : ''}`
            + `${highlightDay === i + 1 ? ' is-highlight' : ''}`,
          style: strength ? { '--flow': String(strength) } : {},
        });
      }),
    ])),
    el('div', { class: 'fp-legend', 'aria-hidden': 'true' }, [
      ...['heavy', 'medium', 'light'].map((flow) => el('span', { class: 'fp-key' }, [
        el('span', { class: 'fp-cell has-flow', style: { '--flow': String(FLOW_STRENGTH[flow]) } }),
        flow[0].toUpperCase() + flow.slice(1),
      ])),
      // Only when some period day has no flow logged: a mark is named where it is drawn.
      rows.some((r) => r.flows.includes('unknown')) ? el('span', { class: 'fp-key' }, [
        el('span', { class: 'fp-cell is-unknown' }), 'Not logged',
      ]) : null,
    ]),
  ]);
}

/**
 * Pairs of bars: how often something happened on days with a condition, and
 * on the rest. The counts sit next to every bar, because "45%" from nine days
 * and from ninety are not the same claim.
 *
 * @param {Object} opts
 * @param {{title: string, rows: {label: string, rate: number, hits: number, n: number, strong?: boolean}[]}[]} opts.groups
 * @param {string} opts.summary
 */
export function pairedBars({ groups, summary }) {
  return el('div', { class: 'paired-bars', role: 'img', 'aria-label': summary },
    groups.map((group) => el('div', { class: 'pb-group', 'aria-hidden': 'true' }, [
      el('p', { class: 'pb-title', text: group.title }),
      ...group.rows.map((row) => el('div', { class: `pb-row${row.strong ? ' is-strong' : ''}` }, [
        el('span', { class: 'pb-label', text: row.label }),
        el('span', { class: 'pb-track' }, [
          el('span', { class: 'pb-fill', style: { width: `${Math.round(row.rate * 100)}%` } }),
        ]),
        el('span', { class: 'pb-value num', text: `${row.hits} of ${row.n}` }),
      ])),
    ])));
}
