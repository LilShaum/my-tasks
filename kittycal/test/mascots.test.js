// @ts-check
/**
 * mascots.test.js — the emblem set's construction contract, structurally.
 *
 * These fourteen drawings only look like a set because they are built to the
 * same rules, and rules that live in a comment are rules that get forgotten by
 * whoever adds the fifteenth. The geometric half of the contract — optical size
 * and centring — needs a browser to measure real path bounds and lives in
 * test/mascots.mjs; what can be checked from the markup is checked here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EMBLEMS, SPOT_ART } from '../js/data/mascots.js';
import { THEMES } from '../js/data/themes.js';

const ALL = { ...EMBLEMS, ...SPOT_ART };

test('every theme has an emblem', () => {
  for (const theme of THEMES) {
    assert.ok(EMBLEMS[theme.id], `${theme.id} has no emblem`);
  }
  // And nothing is left behind for a theme that no longer exists.
  const ids = new Set(THEMES.map((t) => t.id));
  for (const id of Object.keys(EMBLEMS)) {
    assert.ok(ids.has(id), `${id} has an emblem but is not a theme`);
  }
});

test('every drawing goes through the shared stroke contract', () => {
  for (const [name, markup] of Object.entries(ALL)) {
    assert.match(markup, /^\s*<g fill="none" stroke=/, `${name} is not wrapped by ink()`);
    assert.match(markup, /stroke-linecap="round"/, `${name} lost the cap style`);
    assert.match(markup, /stroke-linejoin="round"/, `${name} lost the join style`);
  }
});

test('line weight comes from the sanctioned scale', () => {
  /*
    This used to read "no shape sets its own weight", and it was the right rule
    for the problem it was written against: the set had 2.5, 3, 3.5 and 4 all in
    play at once for no reason, and pinning it to one value fixed that.

    One value turned out to be the next problem. A drawing where the outer
    silhouette, a form sitting inside it and a crease across that form are all
    inked at exactly the same width is a drawing nothing was decided about,
    and it was a good part of why the set read as generated. So there are three
    weights now — silhouette, form, mark — and the rule is that a shape uses one
    of them rather than whatever looked right at the time.
  */
  const ALLOWED = new Set(['6', '4', '2.5']);

  for (const [name, markup] of Object.entries(ALL)) {
    for (const [, width] of markup.matchAll(/stroke-width="([^"]+)"/g)) {
      assert.ok(ALLOWED.has(width),
        `${name} sets stroke-width="${width}"; the scale is ${[...ALLOWED].join(', ')}`);
    }
  }
});

test('colours come from theme tokens, never baked in', () => {
  // One drawing has to work across 14 palettes in two modes. A literal colour
  // would look correct in exactly the theme it was picked against.
  for (const [name, markup] of Object.entries(ALL)) {
    assert.doesNotMatch(markup, /(?:fill|stroke)="#/, `${name} has a hard-coded hex colour`);
    assert.doesNotMatch(markup, /(?:fill|stroke)="rgb/, `${name} has a hard-coded rgb colour`);
  }
});

test('the detail budget holds', () => {
  /*
    An emblem renders at 30px in the header, and there is a point past which
    more shapes stop adding detail and start adding mud. The ceiling has moved
    up twice as the drawings got better — it is a guard against a runaway
    emblem, not a target.
  */
  for (const [name, markup] of Object.entries(EMBLEMS)) {
    const shapes = [...markup.matchAll(/<(path|circle|ellipse|rect)\b/g)].length;
    assert.ok(shapes <= 20, `${name} draws ${shapes} shapes; the budget is 20`);
  }
});
