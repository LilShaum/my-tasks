/**
 * mascots.mjs — the emblem set's geometry, measured rather than eyeballed.
 *
 * The first version of this set was fourteen drawings that each looked fine
 * alone and did not look like a set: the bow filled its box edge to edge while
 * the lightning bolt used a third of the area and sat up in the top-left
 * corner. Nobody notices that reading one emblem. Everybody notices it in the
 * theme picker, where all fourteen are on screen at once.
 *
 * Eyeballing is what let it happen, so this measures. `getBBox({stroke: true})`
 * gives the real painted bounds of each drawing — including the stroke, which
 * grows outward from the path and is half the reason things overflow.
 *
 * Run: node test/mascots.mjs   (with a static server on 8099)
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = 'http://127.0.0.1:8099/';

/** The optical box. Artwork is centred on (50,50) inside a 100×100 viewBox. */
const EDGE_MIN = 13;
const EDGE_MAX = 88;

/** How far a drawing's centre may sit from the middle. */
const CENTRE_TOLERANCE = 4.5;

/**
 * Largest dimension, so every emblem carries roughly the same visual weight.
 * A band rather than a number: a bow is wide and flat, a bolt is tall and
 * narrow, and forcing those to identical proportions would be worse art.
 */
const SIZE_MIN = 56;
const SIZE_MAX = 76;

let pass = 0;
let fail = 0;

const ok = (label, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok    ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

const browser = await pw.chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });

const measured = await page.evaluate(async () => {
  const { EMBLEMS, SPOT_ART } = await import('/js/data/mascots.js');

  const draw = (/** @type {string} */ markup) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 100 100');
    node.setAttribute('width', '300');
    node.setAttribute('height', '300');
    node.innerHTML = markup;
    document.body.append(node);
    return node;
  };

  return [...Object.entries(EMBLEMS), ...Object.entries(SPOT_ART)].map(([name, markup]) => {
    const node = draw(markup);

    // Painted bounds, stroke included — the stroke is half the reason a
    // drawing overflows, and measuring the path alone would miss it.
    const box = node.getBBox({ stroke: true });

    /*
      And the same bounds with every unstroked interior shape removed.

      Those are the shading planes: the lighter and darker faces that give each
      emblem some volume. A plane is positioned by hand to sit inside the form
      it is shading, and there is no clip keeping it there — so the failure is
      a pale wedge poking out past the outline, which looks like a rendering
      bug rather than a drawing. If the silhouette does not change when they
      are all removed, every one of them is inside.
    */
    for (const el of [...node.querySelectorAll('[stroke="none"]')]) el.remove();
    const outline = node.getBBox({ stroke: true });
    node.remove();

    return {
      name,
      left: box.x, top: box.y,
      right: box.x + box.width, bottom: box.y + box.height,
      cx: box.x + box.width / 2, cy: box.y + box.height / 2,
      size: Math.max(box.width, box.height),
      spill: Math.max(
        outline.x - box.x,
        outline.y - box.y,
        (box.x + box.width) - (outline.x + outline.width),
        (box.y + box.height) - (outline.y + outline.height),
      ),
    };
  });
});

const n = (/** @type {number} */ v) => v.toFixed(1);

console.log('\nevery drawing stays inside the optical box');
for (const m of measured) {
  ok(m.name,
    m.left >= EDGE_MIN && m.top >= EDGE_MIN && m.right <= EDGE_MAX && m.bottom <= EDGE_MAX,
    `${n(m.left)},${n(m.top)} → ${n(m.right)},${n(m.bottom)} (allowed ${EDGE_MIN}–${EDGE_MAX})`);
}

console.log('\nand is centred in it');
for (const m of measured) {
  ok(m.name,
    Math.abs(m.cx - 50) <= CENTRE_TOLERANCE && Math.abs(m.cy - 50) <= CENTRE_TOLERANCE,
    `centre ${n(m.cx)},${n(m.cy)} (±${CENTRE_TOLERANCE} of 50,50)`);
}

console.log('\nand carries the same visual weight as the rest of the set');
for (const m of measured) {
  ok(m.name, m.size >= SIZE_MIN && m.size <= SIZE_MAX,
    `${n(m.size)} across (allowed ${SIZE_MIN}–${SIZE_MAX})`);
}

console.log('\nand its shading stays inside the form it is shading');
for (const m of measured) {
  // A hair of tolerance: an unstroked shape sitting exactly on the outline's
  // path sits half a stroke width inside the painted edge, and rounding at
  // that boundary is not a spill.
  ok(m.name, m.spill <= 0.5, `${n(m.spill)} units outside the outline`);
}

/*
  The spread across the whole set, not just each drawing against a band. Every
  emblem could sit inside the band and still have the largest be a third bigger
  than the smallest, which is the fault this whole pass was fixing.
*/
console.log('\nand the set holds together');
{
  const sizes = measured.map((m) => m.size);
  const spread = Math.max(...sizes) / Math.min(...sizes);
  ok('largest is no more than 1.3× the smallest', spread <= 1.3, `${spread.toFixed(2)}×`);
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
