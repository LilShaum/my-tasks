// @ts-check
/**
 * lock.js — passcode lock.
 *
 * A period tracker is the app most likely to be opened while someone else is
 * looking at the screen, so Flo ships a passcode and so does this.
 *
 * The PIN is never stored. What's stored is a PBKDF2-SHA-256 hash with a
 * random 16-byte salt at 210,000 iterations (the OWASP 2023 figure for
 * PBKDF2-HMAC-SHA256). That's overkill for a 4-digit PIN — the keyspace is
 * only 10,000 — but the cost is paid once per unlock and it means the stored
 * value is useless on its own.
 *
 * Being honest about what this is: it keeps a partner, a sibling or a stranger
 * with your unlocked phone out of the app. It is not disk encryption. Anyone
 * with developer tools and the device can read IndexedDB directly. The UI says
 * so rather than implying more.
 */

import { el, need, haptic, announce } from '../utils/dom.js';
import { spotArt } from './mascot.js';
import * as db from '../storage/db.js';

const META_LOCK = 'lock';
const ITERATIONS = 210_000;
const PIN_LENGTH = 4;

/**
 * @typedef {Object} LockConfig
 * @property {boolean} enabled
 * @property {string} salt    base64
 * @property {string} hash    base64
 * @property {boolean} biometric
 */

/** @returns {Promise<LockConfig>} */
export async function loadLock() {
  const stored = await db.getMeta(META_LOCK, null);
  if (!stored || typeof stored !== 'object') {
    return { enabled: false, salt: '', hash: '', biometric: false };
  }
  return /** @type {LockConfig} */ (stored);
}

/** @param {LockConfig} config */
async function saveLock(config) {
  await db.setMeta(META_LOCK, config);
}

/* ── Crypto ─────────────────────────────────────────────────────────────── */

/** @param {ArrayBuffer|Uint8Array} bytes */
function toBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Backed by an explicitly-allocated ArrayBuffer rather than `Uint8Array.from`,
 * so the type is Uint8Array<ArrayBuffer> and satisfies BufferSource. A plain
 * Uint8Array is typed over ArrayBufferLike, which could be a SharedArrayBuffer
 * and so isn't accepted by the WebCrypto signatures.
 * @param {string} base64
 * @returns {Uint8Array<ArrayBuffer>}
 */
function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * @param {string} pin
 * @param {Uint8Array<ArrayBuffer>} salt
 * @returns {Promise<string>} base64 hash
 */
async function derive(pin, salt) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key, 256,
  );
  return toBase64(bits);
}

/**
 * @param {string} pin
 * @returns {Promise<LockConfig>}
 */
export async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const hash = await derive(pin, salt);
  const config = { enabled: true, salt: toBase64(salt), hash, biometric: false };
  await saveLock(config);
  return config;
}

/**
 * @param {string} pin
 * @returns {Promise<boolean>}
 */
export async function verifyPin(pin) {
  const config = await loadLock();
  if (!config.enabled || !config.salt) return true;
  const hash = await derive(pin, fromBase64(config.salt));
  // Constant-time-ish comparison. The timing channel here is not a realistic
  // threat — the attacker has the device — but it costs nothing to avoid.
  return timingSafeEqual(hash, config.hash);
}

/** @param {string} a @param {string} b */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function disableLock() {
  await saveLock({ enabled: false, salt: '', hash: '', biometric: false });
}

/* ── Lock screen ────────────────────────────────────────────────────────── */

/**
 * Show the lock screen and resolve once the right PIN is entered.
 * @param {string} themeId
 * @returns {Promise<void>}
 */
export function showLockScreen(themeId) {
  return new Promise((resolve) => {
    const host = need('#lock-root');
    host.hidden = false;

    /** @type {string} */
    let entered = '';
    let attempts = 0;

    const dots = el('div', { class: 'pin-dots', 'aria-hidden': 'true' });
    const message = el('p', {
      class: 'hint-sm', id: 'lock-message', role: 'status', 'aria-live': 'polite',
      text: 'Enter your passcode',
    });

    const paint = () => {
      dots.replaceChildren();
      for (let i = 0; i < PIN_LENGTH; i++) {
        dots.append(el('span', { class: `pin-dot${i < entered.length ? ' is-filled' : ''}` }));
      }
    };

    /** @param {string} digit */
    const press = async (digit) => {
      if (entered.length >= PIN_LENGTH) return;
      entered += digit;
      paint();
      haptic(8);
      if (entered.length < PIN_LENGTH) return;

      const ok = await verifyPin(entered);
      if (ok) {
        haptic([10, 30, 10]);
        host.hidden = true;
        host.replaceChildren();
        announce('Unlocked');
        resolve();
        return;
      }

      attempts++;
      entered = '';
      paint();
      // No lockout after N attempts: the threat here is a person holding the
      // phone, and locking her out of her own health data to slow them down
      // is a bad trade.
      message.textContent = attempts === 1
        ? 'That is not right. Try again.'
        : `That is not right. ${attempts} attempts so far.`;
      const pad = host.querySelector('.pin-pad');
      if (pad instanceof HTMLElement && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        pad.animate(
          [{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' },
           { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }],
          { duration: 260, easing: 'ease-in-out' },
        );
      }
      haptic([40, 60, 40]);
    };

    const backspace = () => {
      entered = entered.slice(0, -1);
      paint();
      haptic(6);
    };

    const pad = el('div', { class: 'pin-pad' });
    for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']) {
      if (key === '') {
        pad.append(el('span'));
        continue;
      }
      pad.append(el('button', {
        type: 'button',
        class: 'pin-key',
        text: key,
        'aria-label': key === '⌫' ? 'Delete' : key,
        onclick: () => (key === '⌫' ? backspace() : press(key)),
      }));
    }

    paint();

    host.replaceChildren(el('div', { class: 'lock-screen' }, [
      spotArt('lock', { size: 84, className: 'lock-art' }),
      el('h2', { text: 'Kittycal is locked' }),
      message,
      dots,
      pad,
    ]));

    // Physical keyboard, for anyone using this on a laptop.
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (host.hidden) { document.removeEventListener('keydown', onKey); return; }
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); void press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
    };
    document.addEventListener('keydown', onKey);

    const first = pad.querySelector('button');
    if (first instanceof HTMLElement) first.focus();
  });
}

/**
 * Ask for a new PIN, twice, and store it. Resolves true if it was set.
 * @returns {Promise<boolean>}
 */
export async function promptForNewPin() {
  const first = window.prompt(
    'Choose a 4-digit passcode.\n\n' +
    'This keeps Kittycal shut to anyone who picks up your phone. It is not ' +
    'encryption — someone determined, with your unlocked device, could still ' +
    'reach the data underneath.',
  );
  if (first == null) return false;

  if (!/^\d{4}$/.test(first.trim())) {
    window.alert('A passcode needs to be exactly 4 digits.');
    return false;
  }

  const second = window.prompt('Enter it once more to confirm.');
  if (second == null) return false;

  if (first.trim() !== second.trim()) {
    window.alert('Those did not match. Nothing has been changed.');
    return false;
  }

  await setPin(first.trim());
  return true;
}
