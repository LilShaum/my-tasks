// @ts-check
/**
 * mascot.js — renders the active theme's mascot.
 *
 * Resolution order, first hit wins:
 *   1. an image she uploaded in-app (IndexedDB blob)
 *   2. a file dropped into assets/mascots/<theme>.{png,webp,jpg,gif,svg}
 *   3. the built-in emblem from data/mascots.js
 *
 * Uploads win because that's the path that works on the phone where the app
 * actually gets used. Both image paths degrade to the emblem if the file is
 * missing or fails to decode, so a bad drop-in can never leave a blank hole.
 */

import { el, svg } from '../utils/dom.js';
import { EMBLEMS, SPOT_ART } from '../data/mascots.js';
import * as repo from '../storage/repo.js';

/** Object URLs we've handed out, so they can be revoked on theme change.
 * @type {Map<string, string>} */
const blobUrls = new Map();

/**
 * The optional drop-in manifest, loaded at most once per session.
 *
 * An earlier version probed for `<theme>.png`, `.webp`, `.jpg`… per theme,
 * which meant up to 84 requests and a console full of 404s for the
 * overwhelming majority of users who have no drop-in files at all. One
 * optional manifest is a single request that 404s once and is then cached.
 *
 * @type {Promise<Record<string, string>>|null}
 */
let manifestPromise = null;

/**
 * Build an emblem as an inline SVG element.
 * @param {string} themeId
 * @param {{size?: number, className?: string, title?: string}} [opts]
 * @returns {SVGElement}
 */
export function emblem(themeId, opts = {}) {
  const { size = 64, className = 'mascot', title } = opts;
  const markup = EMBLEMS[themeId] ?? EMBLEMS.plain;

  const node = svg('svg', {
    viewBox: '0 0 100 100',
    width: size,
    height: size,
    class: className,
    role: title ? 'img' : 'presentation',
    'aria-label': title ?? null,
    'aria-hidden': title ? null : 'true',
    html: markup,
  });

  return node;
}

/**
 * Named spot illustration (empty states, lock screen).
 * @param {keyof typeof SPOT_ART} name
 * @param {{size?: number, className?: string}} [opts]
 */
export function spotArt(name, opts = {}) {
  const { size = 108, className = 'empty-art' } = opts;
  return svg('svg', {
    viewBox: '0 0 100 100',
    width: size,
    height: size,
    class: className,
    'aria-hidden': 'true',
    html: SPOT_ART[name] ?? SPOT_ART.empty,
  });
}

/**
 * Load assets/mascots/manifest.json, mapping theme id → filename. Absent for
 * almost everyone, which is why it's one request and the failure is quiet.
 * @returns {Promise<Record<string, string>>}
 */
function loadManifest() {
  if (manifestPromise) return manifestPromise;

  manifestPromise = fetch('assets/mascots/manifest.json', { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : {}))
    .then((data) => {
      if (!data || typeof data !== 'object') return {};
      /** @type {Record<string, string>} */
      const out = {};
      for (const [theme, file] of Object.entries(data)) {
        // Only plain filenames — no traversal, no absolute URLs. This file is
        // user-authored, so it gets treated as input rather than trusted.
        if (typeof file === 'string' && /^[\w.-]+$/.test(file)) out[theme] = file;
      }
      return out;
    })
    .catch(() => ({}));

  return manifestPromise;
}

/**
 * The drop-in file for a theme, if the manifest names one.
 * @param {string} themeId
 * @returns {Promise<string|null>}
 */
async function findDropIn(themeId) {
  const manifest = await loadManifest();
  const file = manifest[themeId];
  return file ? `assets/mascots/${file}` : null;
}

/**
 * Resolve the best available mascot for a theme.
 * @param {string} themeId
 * @returns {Promise<{kind: 'image', url: string}|{kind: 'emblem'}>}
 */
export async function resolveMascot(themeId) {
  try {
    const blob = await repo.loadMascot(themeId);
    if (blob) {
      const previous = blobUrls.get(themeId);
      if (previous) URL.revokeObjectURL(previous);
      const url = URL.createObjectURL(blob);
      blobUrls.set(themeId, url);
      return { kind: 'image', url };
    }
  } catch (err) {
    console.warn('kittycal: could not read custom mascot', err);
  }

  const dropIn = await findDropIn(themeId);
  if (dropIn) return { kind: 'image', url: dropIn };

  return { kind: 'emblem' };
}

/**
 * A mascot element that starts as the emblem and upgrades in place if a custom
 * image resolves. Rendering synchronously first means no layout shift and no
 * empty frame while IndexedDB is consulted.
 *
 * @param {string} themeId
 * @param {{size?: number, className?: string, title?: string}} [opts]
 * @returns {HTMLElement}
 */
export function mascot(themeId, opts = {}) {
  const { size = 64, className = 'mascot', title } = opts;

  const host = el('span', {
    class: `mascot-host ${className}`,
    style: { display: 'inline-block', width: `${size}px`, height: `${size}px` },
  }, [emblem(themeId, { size, className: '', title })]);

  resolveMascot(themeId).then((found) => {
    if (found.kind !== 'image') return;
    const img = el('img', {
      src: found.url,
      alt: title ?? '',
      'aria-hidden': title ? null : 'true',
      width: size,
      height: size,
      style: {
        width: `${size}px`, height: `${size}px`,
        'object-fit': 'contain',
      },
    });
    img.addEventListener('error', () => {
      // Bad image — fall back rather than showing a broken-image glyph.
      host.replaceChildren(emblem(themeId, { size, className: '', title }));
    });
    host.replaceChildren(img);
  }).catch(() => { /* emblem already rendered */ });

  return host;
}

/** Release any object URLs we created. Called before an erase or a reload. */
export function releaseMascotUrls() {
  for (const url of blobUrls.values()) URL.revokeObjectURL(url);
  blobUrls.clear();
}

/** Forget the cached manifest, so newly added files are picked up. */
export function invalidateMascotCache() {
  manifestPromise = null;
}
