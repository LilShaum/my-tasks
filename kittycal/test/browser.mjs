/**
 * browser.mjs — where Playwright and Chromium are, wherever this is running.
 *
 * Every probe in this directory used to open with two absolute paths baked in:
 *
 *     import pw from '/opt/node22/lib/node_modules/playwright/index.js';
 *     ... executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
 *
 * Those are one machine's paths. They are the reason the browser probes could
 * only ever be a local step — not the browser download the Test workflow
 * declines to do, which is a deliberate choice and still holds, but the plain
 * fact that the files are not there on any other computer. Fourteen copies of
 * a path with a pinned Chromium build number in it also meant that upgrading
 * the browser meant editing every one of them.
 *
 * Resolution order, both settable from the environment so CI can say where it
 * put things without editing any probe:
 *
 *   Playwright  $PLAYWRIGHT_MODULE → the 'playwright' package → this box's copy
 *   Chromium    $PLAYWRIGHT_CHROMIUM → this box's copy → whatever Playwright
 *               installed for itself
 *
 * The last Chromium case is the CI one, and it is `undefined` rather than a
 * path: `launch()` reads that as "use the browser you downloaded", which is
 * exactly right after `playwright install chromium`.
 *
 * No dependency is added to package.json by any of this. The module is
 * imported by name only if it is already there.
 */

import { existsSync } from 'node:fs';

/** This container's copies, kept as the last fallback so nothing changes locally. */
const LOCAL_MODULE = '/opt/node22/lib/node_modules/playwright/index.js';
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** @returns {Promise<any>} */
async function playwright() {
  const candidates = process.env.PLAYWRIGHT_MODULE
    ? [process.env.PLAYWRIGHT_MODULE]
    : ['playwright', LOCAL_MODULE];

  /** @type {string[]} */
  const tried = [];
  for (const specifier of candidates) {
    try {
      const mod = await import(specifier);
      return mod.default ?? mod;
    } catch (err) {
      tried.push(`${specifier} (${err.code ?? err.message})`);
    }
  }

  throw new Error(
    `Playwright not found. Tried: ${tried.join(', ')}.\n`
    + 'Install it (npm i --no-save playwright) or set $PLAYWRIGHT_MODULE.',
  );
}

/**
 * The Chromium binary to drive, or undefined to let Playwright pick its own.
 * @returns {string|undefined}
 */
export function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  if (existsSync(LOCAL_CHROMIUM)) return LOCAL_CHROMIUM;
  return undefined;
}

/**
 * Launch Chromium. Takes the same options as `chromium.launch`; anything
 * passed wins over the resolved executable, so a probe can still pin one.
 * @param {Record<string, unknown>} [opts]
 */
export async function launchChromium(opts = {}) {
  const pw = await playwright();
  return pw.chromium.launch({ executablePath: chromiumPath(), ...opts });
}
