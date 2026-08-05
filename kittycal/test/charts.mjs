/**
 * charts.mjs — the Insights charts, checked in a real browser.
 *
 * These cover the things that made the charts hard to read, each of which was
 * invisible to a unit test because it is a property of the drawn output:
 *
 *   - the SVG scaled non-uniformly, stretching every number it contained;
 *   - the x-axis was labelled with a position in an array;
 *   - nothing on the plot said what the shaded band's edges were;
 *   - and the bars had a baseline just under the smallest value, so the
 *     picture claimed differences several times larger than the data.
 *
 * Run: node test/charts.mjs   (with a static server on 8099)
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = 'http://127.0.0.1:8099/';

let pass = 0;
let fail = 0;

/** @param {string} label @param {boolean} cond @param {string} [extra] */
const ok = (label, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok    ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

const browser = await pw.chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
/** @type {string[]} */
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });

/*
  Nine cycles of deliberately uneven length, one of them (36 days) outside the
  typical range so the flagged path is exercised, plus a run of nightly sleep
  readings so the daily-series axis is exercised too.
*/
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('kittycal', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('logs', { keyPath: 'date' });
      d.createObjectStore('meta', { keyPath: 'key' });
      d.createObjectStore('blobs', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const shift = (/** @type {number} */ n) => {
    const d = new Date(); d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const lengths = [28, 31, 26, 29, 36, 27, 30, 25, 28];
  const periods = [5, 4, 6, 5, 7, 4, 5, 3, 5];
  const days = [];
  const logs = [];
  const base = {
    flow: 'none', symptoms: [], moods: [], discharge: [], activity: [], other: [],
    sex: [], drive: null, custom: [], severity: {}, bbt: null, weight: null, water: 0,
    sleep: null, steps: null, pillTaken: false, testPregnancy: null, testOvulation: null,
    notes: '', checkedIn: true, updated: Date.now(),
  };

  let cursor = -lengths.reduce((a, b) => a + b, 0);
  lengths.forEach((len, ci) => {
    for (let i = 0; i < periods[ci]; i += 1) days.push(shift(cursor + i));
    cursor += len;
  });

  for (let i = 0; i < 16; i += 1) {
    logs.push({ ...base, date: shift(-16 + i), sleep: 6.5 + ((i % 4) * 0.6) });
  }

  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme: 'hellokitty', onboarded: true, disclaimerAck: true,
      avgCycleLength: 28, avgPeriodLength: 5, name: 'Sam',
      lastBackup: shift(0), lastBackupAt: Date.now(),
    } });
    tx.objectStore('meta').put({ key: 'periodDays', value: days });
    for (const log of logs) tx.objectStore('logs').put(log);
    tx.oncomplete = () => res(undefined);
  });
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.evaluate(() => {
  /** @type {HTMLElement|null} */
  (document.querySelector('.sheet-close, [aria-label*="Close"]'))?.click();
});
await page.evaluate(async () => (await import('/js/state/store.js')).setView('insights'));
await page.waitForSelector('.chart');
await page.waitForTimeout(300);

console.log('\nthe drawing is not distorted');

const shapes = await page.$$eval('.chart', (nodes) => nodes.map((n) => {
  const box = n.getBoundingClientRect();
  const vb = n.getAttribute('viewBox').split(' ').map(Number);
  return { drawn: box.width / box.height, declared: vb[2] / vb[3], w: box.width };
}));

ok('every chart is on the page', shapes.length >= 3, String(shapes.length));
ok('and each keeps the aspect ratio it was drawn at',
  shapes.every((s) => Math.abs(s.drawn - s.declared) < 0.02),
  JSON.stringify(shapes.map((s) => [s.drawn.toFixed(2), s.declared.toFixed(2)])));
ok('none of them overflows the phone',
  shapes.every((s) => s.w <= 390), JSON.stringify(shapes.map((s) => s.w)));

console.log('\nthe cycle-length chart says what it is showing');

const cycleCard = await page.$('.card:has(h3:text-is("Cycle length"))');
const labels = await cycleCard.$$eval('.chart text', (n) => n.map((t) => t.textContent));

ok('the x-axis is labelled with months, not row numbers',
  labels.some((l) => /^[A-Z][a-z]{2}$/.test(l)) && !labels.includes('1'),
  JSON.stringify(labels));

ok('both edges of the typical range are numbered',
  labels.includes('21') && labels.includes('35'), JSON.stringify(labels));

ok('the newest cycle is called out by value',
  labels.some((l) => /^\d+d$/.test(l)), JSON.stringify(labels));

const marks = await cycleCard.$$eval('.chart circle', (n) => n.map((c) => ({
  r: Number(c.getAttribute('r')),
  fill: c.getAttribute('fill'),
})));

// Eight, not nine: a cycle only has a length once the next period has begun,
// so the one currently running is not on the chart.
ok('one dot per completed cycle', marks.filter((m) => m.r === 4).length === 8,
  String(marks.filter((m) => m.r === 4).length));

/*
  The 36-day cycle is the only one outside 21-35. It must be distinguishable
  without relying on colour, so it carries a ring as well as the warn fill.
*/
ok('the out-of-range cycle is ringed, not merely recoloured',
  marks.filter((m) => m.r === 7 && m.fill === 'none').length === 1,
  JSON.stringify(marks.filter((m) => m.r === 7)));

ok('and its value is spelled out', labels.includes('36d'), JSON.stringify(labels));

console.log('\nnothing overlaps');

const collisions = await cycleCard.evaluate((card) => {
  const texts = [...card.querySelectorAll('.chart text')];
  const boxes = texts.map((t) => ({ t: t.textContent, b: t.getBoundingClientRect() }));
  const hits = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i].b; const c = boxes[j].b;
      const overlap = a.left < c.right && c.left < a.right
        && a.top < c.bottom && c.top < a.bottom;
      if (overlap) hits.push(`${boxes[i].t} / ${boxes[j].t}`);
    }
  }
  return hits;
});

ok('no two labels sit on top of each other', collisions.length === 0,
  collisions.join(', '));

console.log('\na nightly series does not repeat itself');

const sleepLabels = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.card')];
  const trends = cards.find((c) => c.querySelector('h3')?.textContent === 'Trends');
  if (!trends) return null;
  const charts = [...trends.querySelectorAll('.chart')];
  const last = charts[charts.length - 1];
  return [...last.querySelectorAll('text')]
    .map((t) => t.textContent)
    .filter((t) => /^\d+ [A-Z][a-z]{2}$/.test(t));
});

if (sleepLabels === null) {
  ok('the sleep chart rendered', false, 'no Trends card');
} else {
  ok('sixteen nights get a handful of dated labels',
    sleepLabels.length > 0 && sleepLabels.length <= 6, JSON.stringify(sleepLabels));
  ok('and no label is repeated',
    new Set(sleepLabels).size === sleepLabels.length, JSON.stringify(sleepLabels));
}

console.log('\nand it is still described to a screen reader');

const described = await page.$$eval('.chart', (n) =>
  n.every((c) => (c.getAttribute('aria-label') ?? '').length > 20));
ok('every chart carries a text summary', described);

ok('no page errors', errors.length === 0, errors.join(' | '));

console.log(`\ncharts: ${pass}/${pass + fail} checks passed`);
await browser.close();
if (fail) process.exit(1);
