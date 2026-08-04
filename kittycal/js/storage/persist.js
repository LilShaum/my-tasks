// @ts-check
/**
 * persist.js — keeping her data from being thrown away.
 *
 * Everything Kittycal knows lives in one browser's IndexedDB on one device.
 * That is the whole privacy design, and it is also the whole risk: browsers
 * are allowed to evict that storage, and two of them do it aggressively.
 *
 *   - Chrome and Firefox evict "best-effort" storage under disk pressure.
 *     `navigator.storage.persist()` upgrades a site to "persistent", which is
 *     exempt. Installed apps are usually granted it without a prompt.
 *   - Safari deletes IndexedDB for a *website* after roughly seven days with
 *     no interaction. Crucially, that rule does not apply to a site added to
 *     the Home Screen — which is why installing matters more than any API call
 *     on iOS, and why `persist()` there often just returns false.
 *
 * So this module does two things: ask for persistence where asking helps, and
 * work out honestly which of the two protections is actually in force, so
 * Settings can tell her the truth rather than a reassuring guess.
 */

/**
 * @typedef {Object} StorageHealth
 * @property {boolean} persisted        the browser promises not to evict
 * @property {boolean} canRequest       persist() exists at all
 * @property {boolean} installed        running as a home-screen/standalone app
 * @property {number|null} usedBytes
 * @property {number|null} quotaBytes
 * @property {'safe'|'ok'|'at-risk'} level
 * @property {string} summary           one line, for the user
 */

/** Is the app running as an installed app rather than a browser tab? */
function isInstalled() {
  // iOS Safari predates the standard and only sets navigator.standalone.
  const iosStandalone = /** @type {any} */ (navigator).standalone === true;
  const displayMode = typeof window.matchMedia === 'function' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
     window.matchMedia('(display-mode: fullscreen)').matches ||
     window.matchMedia('(display-mode: minimal-ui)').matches);
  return Boolean(iosStandalone || displayMode);
}

/**
 * Ask the browser to treat this site's storage as persistent.
 *
 * Safe to call repeatedly — it resolves immediately if already granted. On
 * browsers that don't implement it (notably iOS Safari) this is a no-op and
 * returns false, which is not a failure: there, being installed is the
 * protection.
 *
 * @returns {Promise<boolean>} whether storage is persistent afterwards
 */
export async function requestPersistence() {
  if (!navigator.storage?.persist || !navigator.storage?.persisted) return false;

  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** @returns {Promise<boolean>} */
async function isPersisted() {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

/**
 * A plain-language read on how safe her data currently is.
 * @returns {Promise<StorageHealth>}
 */
export async function checkStorage() {
  const canRequest = Boolean(navigator.storage?.persist);
  const persisted = await isPersisted();
  const installed = isInstalled();

  /** @type {number|null} */ let usedBytes = null;
  /** @type {number|null} */ let quotaBytes = null;
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate) {
      usedBytes = estimate.usage ?? null;
      quotaBytes = estimate.quota ?? null;
    }
  } catch {
    /* estimate is unavailable in some browsers; not important enough to care */
  }

  /** @type {'safe'|'ok'|'at-risk'} */
  let level;
  let summary;

  if (persisted) {
    level = 'safe';
    summary = 'Your browser has promised not to delete this app’s data.';
  } else if (installed) {
    // The iOS case: persist() is unavailable, but being installed exempts the
    // app from the seven-day eviction rule, which is the threat that matters.
    level = 'ok';
    summary = 'Kittycal is installed to your Home Screen, which keeps your ' +
      'data safe from being cleared automatically.';
  } else if (!canRequest) {
    level = 'at-risk';
    summary = 'This browser may clear the app’s data if you go a while without ' +
      'opening it. Adding Kittycal to your Home Screen prevents that.';
  } else {
    level = 'at-risk';
    summary = 'Your browser has not guaranteed this app’s data. Add Kittycal to ' +
      'your Home Screen, or keep an exported backup.';
  }

  return { persisted, canRequest, installed, usedBytes, quotaBytes, level, summary };
}

/**
 * Human-readable byte size.
 * @param {number|null} bytes
 */
export function fmtBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
