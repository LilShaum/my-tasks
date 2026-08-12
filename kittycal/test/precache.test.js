// @ts-check
/**
 * Every module the app imports has to be in the service worker's PRECACHE.
 *
 * This is the one failure in the project that is completely silent. The app
 * works in development, the tests pass, the deploy succeeds — and then someone
 * opens it on a plane and a screen is blank, because `sw.js` never fetched the
 * one file that was added last week and the cache-first handler has nothing to
 * serve. Nothing anywhere else in the suite loads the app over a dead network,
 * so nothing else can catch it.
 *
 * It has been a standing note in the project docs — "new modules MUST be added
 * to PRECACHE" — which is to say it has been relying on somebody remembering.
 * Two modules were added correctly in the audit branch by remembering. This
 * checks instead.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every .js file under js/, as a repo-relative path with forward slashes. */
function modules(dir = 'js') {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...modules(path));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

const sw = readFileSync(join(root, 'sw.js'), 'utf8');

test('every js module is precached by the service worker', () => {
  const missing = modules().filter((path) => !sw.includes(`'${path}'`));
  assert.deepEqual(missing, [],
    'these are imported by the app but never fetched into the offline cache');
});

test('PRECACHE does not list files that no longer exist', () => {
  // The other direction: a stale entry makes `cache.addAll` reject, and
  // because it rejects as a whole, one dead path means *nothing* is cached and
  // the app is entirely offline-broken rather than partly.
  const listed = [...sw.matchAll(/'((?:js|css|assets)\/[^']+)'/g)].map((m) => m[1]);
  const present = new Set([
    ...modules(),
    ...filesUnder('css'),
    ...filesUnder('assets'),
  ]);

  const dead = [...new Set(listed)].filter((path) => !present.has(path));
  assert.deepEqual(dead, [], 'PRECACHE names files that are not in the repo');
});

/** @param {string} dir */
function filesUnder(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

test('the app shell and every stylesheet index.html loads are precached', () => {
  // index.html is the list that actually decides what the browser asks for; if
  // a stylesheet is linked there and missing here, the offline app renders
  // unstyled rather than blank, which is the harder failure to notice.
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const hrefs = [...html.matchAll(/href="((?:css|assets)\/[^"]+)"/g)].map((m) => m[1]);

  const missing = [...new Set(hrefs)].filter((path) => !sw.includes(`'${path}'`));
  assert.deepEqual(missing, [], 'linked by index.html but not precached');
});
