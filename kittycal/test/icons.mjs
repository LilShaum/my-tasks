/**
 * icons.mjs — are the diary's marks actually telling themselves apart?
 *
 * Every option in the diary carries a drawn mark, and the docstring in
 * icons.js says what they are for: "the label is what names the thing; the mark
 * is what lets the eye find it again in a list of thirty-nine." That is a
 * claim about legibility at a specific size, and nothing in the source can
 * check it. A set can satisfy every rule in the contract — one weight,
 * currentColor, strokes inside 3…21 — and still be useless, because the rules
 * say nothing about whether two marks look the same.
 *
 * They did. The first version of this set was built on shared base forms with
 * the meaning carried by a small detail inside: ten discharge options were one
 * droplet outline with a different squiggle in it, and the test readings were
 * one stick outline with the result drawn small inside. Rendered at the 18px a
 * chip really uses and compared pixel for pixel, "peak" and "high" came out
 * 98.9% identical, and every pair of discharge marks sat between 90% and 96%.
 * The distinguishing element was two or three pixels; the shared container was
 * everything else. Nobody reading the source would see it, and the contact
 * sheet only makes it obvious once you already suspect it.
 *
 * So the check is the measurement. Each mark is drawn at 18px, its coverage
 * read back out of a canvas, and every pair scored. The rule is that two
 * options in the same category may not be more than `LIMIT` alike, because a
 * category is the list she scans. Across categories the bar is only that marks
 * are not outright identical, since the same picture in two different lists is
 * far less confusing than two pictures in one.
 *
 * This is a floor, not a verdict. A mark can pass it and still be a bad
 * drawing of the thing it names — that part still needs eyes on a contact
 * sheet. What it buys is that the specific failure above cannot come back
 * silently, which is exactly how it arrived.
 *
 * Run: npm run test:browser -- icons
 */

import { launchChromium } from './browser.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8099';

/** The size a diary chip renders a mark at. */
const RENDER_PX = 18;

/**
 * How alike two marks in one category may be. 1.0 is pixel-identical.
 *
 * Set at 0.90 because that is the level the failure above lived at — the old
 * discharge set ran 0.90 to 0.96 and the test readings to 0.99 — and because
 * the redrawn set clears it with the worst pair at 0.896. Genuinely close
 * neighbours are allowed to be close: "happy" and "playful" are both smiling
 * faces and sit just under the line, which is honest, because they are similar
 * moods and drawing them far apart would be a lie about what they mean.
 */
const LIMIT = 0.90;

/**
 * …unless the difference between them is large enough to see anyway.
 *
 * The ratio alone stopped being the right test once the set moved to Lucide.
 * A face with a smile and a face with a frown share a head, so they score as
 * 93% alike — and they are among the easiest pairs on the sheet to tell
 * apart, because the part that differs is a whole mouth. What made Opus 5's
 * set unreadable was not the ratio, it was that the difference was tiny:
 * measured at 18px, "peak" and "high" differed by 1.5 pixels of ink, and its
 * worst pairs all sat between 1.5 and 7.
 *
 * So a pair passes if it is under LIMIT alike, or if at least this much ink
 * differs — about one full stroke, five pixels long, at the size a chip draws.
 * Calibrated on what was looked at, not on what would pass: plus against
 * minus differs by 8.3 and reads clearly; a flat-mouthed face against an
 * annoyed one differed by 5.2 and read as the same face, so it was redrawn.
 */
const MIN_VISIBLE_DIFF = 8;

/**
 * Marks that are deliberately the same picture in more than one category.
 *
 * "No bleeding", "None", "No sex" and "Didn't exercise" are all absences, and
 * they share one dash on purpose: a single convention the eye learns once beats
 * four different drawings of nothing.
 */
const SHARED_ON_PURPOSE = [
  ['flow:none', 'discharge:none', 'sex:none', 'activity:none'],
];

let checks = 0;
let failures = 0;
const check = (cond, label, extra = '') => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${extra ? `\n          ${extra}` : ''}`); }
};

const browser = await launchChromium();
const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });

const measured = await page.evaluate(async (size) => {
  const { CATEGORIES, TESTS } = await import('/js/data/taxonomy.js');
  const { iconFor } = await import('/js/data/icons.js');

  /** Every option, with the mark it really resolves to. */
  const marks = [];
  for (const category of [...CATEGORIES, ...TESTS]) {
    for (const option of category.options) {
      marks.push({
        key: `${category.id}:${option.id}`,
        where: `${category.name}/${option.label}`,
        category: category.id,
        svg: iconFor(option.id, category.id) || '',
      });
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  /* Rasterise at the real size. The alpha channel is the ink: how much of each
     pixel the stroke covers, antialiasing included, which is what an eye at
     this size is actually working with. */
  for (const mark of marks) {
    const image = new Image();
    image.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `
      + 'viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" '
      + `stroke-linecap="round" stroke-linejoin="round">${mark.svg}</svg>`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res, rej) => { image.onload = res; image.onerror = rej; });
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(image, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const pixels = new Float32Array(size * size);
    let ink = 0;
    for (let i = 0; i < size * size; i += 1) {
      pixels[i] = data[i * 4 + 3] / 255;
      ink += pixels[i];
    }
    mark.pixels = pixels;
    mark.ink = ink;
  }

  const blank = marks.filter((m) => m.ink < 2).map((m) => m.where);

  /* The stroked extent of each mark, measured rather than read off the path
     numbers — a curve's widest point is usually not one of its control points,
     and a half-unit clearance is the difference between a mark that breathes
     and one the browser shaves a pixel off. */
  const NS = 'http://www.w3.org/2000/svg';
  const stage = document.createElementNS(NS, 'svg');
  stage.setAttribute('viewBox', '0 0 24 24');
  stage.setAttribute('style', 'position:absolute;width:24px;height:24px;opacity:0;pointer-events:none');
  document.body.append(stage);
  const HALF_STROKE = 1;
  const clipping = [];
  for (const mark of marks) {
    stage.innerHTML = mark.svg;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const child of stage.children) {
      const box = child.getBBox();
      x0 = Math.min(x0, box.x); y0 = Math.min(y0, box.y);
      x1 = Math.max(x1, box.x + box.width); y1 = Math.max(y1, box.y + box.height);
    }
    const lo = Math.min(x0, y0) - HALF_STROKE;
    const hi = Math.max(x1, y1) + HALF_STROKE;
    if (lo < 0.5 || hi > 23.5) {
      clipping.push(`${mark.where} — painted ${lo.toFixed(1)}…${hi.toFixed(1)} of 0…24`);
    }
  }
  stage.remove();

  const within = [];
  const identicalAcross = [];
  for (let i = 0; i < marks.length; i += 1) {
    for (let j = i + 1; j < marks.length; j += 1) {
      const a = marks[i];
      const b = marks[j];
      let diff = 0;
      let total = 0;
      for (let k = 0; k < a.pixels.length; k += 1) {
        diff += Math.abs(a.pixels[k] - b.pixels[k]);
        total += a.pixels[k] + b.pixels[k];
      }
      if (!total) continue;
      const similarity = 1 - diff / total;
      if (a.category === b.category) {
        within.push({ similarity, diff, a: a.where, b: b.where });
      } else if (similarity > 0.995) {
        identicalAcross.push({ keys: [a.key, b.key], a: a.where, b: b.where });
      }
    }
  }
  within.sort((x, y) => x.diff - y.diff);
  return { count: marks.length, blank, clipping, within: within.slice(0, 40), identicalAcross };
}, RENDER_PX);

console.log(`\nevery diary mark, rasterised at the ${RENDER_PX}px a chip uses`);
check(measured.count > 100, `${measured.count} marks measured`);
check(measured.blank.length === 0,
  'none of them renders as nothing at all', measured.blank.join(', '));
check(measured.clipping.length === 0,
  'and every one keeps clear of the edges it is drawn in',
  measured.clipping.join('\n          '));

console.log('\nno two options in one category look the same');
{
  const over = measured.within.filter((pair) => pair.similarity > LIMIT && pair.diff < MIN_VISIBLE_DIFF);
  check(over.length === 0,
    `no pair in a category is both over ${LIMIT * 100}% alike and under ${MIN_VISIBLE_DIFF}px apart`,
    over.map((pair) => `${(pair.similarity * 100).toFixed(1)}% alike, ${pair.diff.toFixed(1)}px apart  `
      + `${pair.a}  vs  ${pair.b}`).join('\n          '));

  const worst = measured.within[0];
  if (worst) {
    console.log(`        smallest difference: ${worst.diff.toFixed(1)}px  `
      + `(${(worst.similarity * 100).toFixed(1)}% alike)  ${worst.a} vs ${worst.b}`);
  }
}

console.log('\nmarks repeated across categories are the ones meant to be');
{
  const allowed = new Set();
  for (const group of SHARED_ON_PURPOSE) {
    for (const one of group) for (const two of group) if (one !== two) allowed.add([one, two].sort().join('|'));
  }
  const unexpected = measured.identicalAcross
    .filter((pair) => !allowed.has([...pair.keys].sort().join('|')));
  check(unexpected.length === 0,
    'nothing else draws the same picture as something in another list',
    unexpected.map((pair) => `${pair.a}  ==  ${pair.b}`).join('\n          '));

  // The deliberate ones must still actually be shared — if one is redrawn on
  // its own, the convention has quietly broken and this should say so.
  for (const group of SHARED_ON_PURPOSE) {
    const found = measured.identicalAcross
      .filter((pair) => pair.keys.every((k) => group.includes(k))).length;
    const wanted = (group.length * (group.length - 1)) / 2;
    check(found === wanted,
      `the "nothing happened" dash is still one mark across all ${group.length} of its lists`,
      `${found} of ${wanted} pairs still match`);
  }
}

await browser.close();
console.log(`\nicons: ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
