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

test('no shape sets its own outline weight', () => {
  /*
    The whole point of `ink()` is that the weight cannot be set per shape. The
    one sanctioned exception is interior detail — a face, a grille, a ruled
    line — which steps down to 3 so a closed shape does not fill in at small
    sizes. Any other value means the set has started to drift, which is exactly
    how it looked before: 2.5, 3, 3.5 and 4 all in play at once.
  */
  for (const [name, markup] of Object.entries(ALL)) {
    for (const [, width] of markup.matchAll(/stroke-width="([^"]+)"/g)) {
      assert.ok(width === '5' || width === '3',
        `${name} sets stroke-width="${width}"; only the shared 5 and the fine 3 are allowed`);
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
    An emblem renders at 30px in the header. Past about half a dozen shapes
    there is not enough room to resolve them and the thing becomes a smudge —
    which is what happened to the microphone, at six parts plus two grille
    lines.
  */
  for (const [name, markup] of Object.entries(EMBLEMS)) {
    const shapes = [...markup.matchAll(/<(path|circle|ellipse|rect)\b/g)].length;
    assert.ok(shapes <= 7, `${name} draws ${shapes} shapes; the budget is 7`);
  }
});
