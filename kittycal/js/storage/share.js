// @ts-check
/**
 * share.js — partner sharing: the only code in Kittycal that sends anything
 * off the phone, and only after she turns sharing on.
 *
 * What leaves the phone is one encrypted summary (domain/partner.js decides
 * what is in it). It is encrypted here with AES-GCM under a random key that
 * lives in the share link's fragment — the part after "#", which browsers
 * never send to any server. Supabase stores ciphertext it has no key for.
 *
 * Three secrets, each with one job:
 *   - id     names the share. Anyone holding the link can read the (encrypted)
 *            row, which is the point of a link.
 *   - key    decrypts it. Only ever in the link and on the two phones.
 *   - token  lets her phone update or delete the row. Never in the link; the
 *            server keeps only its hash (see supabase/partner-sharing.sql).
 *
 * The server is reached through three Postgres functions over Supabase's REST
 * endpoint with plain `fetch`: no client library, so the app stays at zero
 * dependencies.
 */
import { cleanSnapshot } from '../domain/partner.js';


export const SUPABASE_URL = 'https://uepxpnqgrwvqruzexxsg.supabase.co';
/** Publishable by design: it identifies the project, and grants only what the functions allow. */
export const SUPABASE_KEY = 'sb_publishable_08tGkIo7-Hr87W5668KEQg_O3JJYZ7m';

/** @param {Uint8Array} bytes */
function toB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} text */
function fromB64url(text) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** @param {number} n */
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

/**
 * Fresh secrets for a new share.
 * @returns {{id: string, key: string, token: string}}
 */
export function newSecrets() {
  return { id: toB64url(random(16)), key: toB64url(random(32)), token: toB64url(random(32)) };
}

/** @param {string} key */
async function aesKey(key) {
  return crypto.subtle.importKey('raw', fromB64url(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {Promise<string>} iv + ciphertext, base64url
 */
export async function encrypt(value, key) {
  const iv = random(12);
  const data = new TextEncoder().encode(JSON.stringify(value));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key), data));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return toB64url(out);
}

/**
 * @param {string} blob
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function decrypt(blob, key) {
  const bytes = fromB64url(blob);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12) }, await aesKey(key), bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ── The code ───────────────────────────────────────────────────────────── */

/*
  A short code he can type, standing in for the whole link.

  Needed because on an iPhone a link opens in Safari, and an app added to the
  Home Screen from there starts with its own, empty storage: whatever the link
  set up in Safari is not in the installed app. So the installed app has to be
  able to connect from something a person can read off one screen and type on
  another.

  The code is the only secret. Both the share's id and its key are derived
  from it, so the server still never holds anything that decrypts her
  summary: the id is a hash of the code, and the key is stretched from it
  with PBKDF2. Ten characters from a 32-letter alphabet is 50 bits; guessing
  one through the server is out of reach, and stretching makes guessing
  against a stolen copy of the table slow as well.

  Crockford's alphabet: no I, L, O or U, so nothing reads as another
  character, and typing an O or an I is forgiven as 0 or 1.
*/
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A fresh code, shown as ABCDE-FGHJK. */
export function newCode() {
  const bytes = random(10);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % 32];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/**
 * Whatever he typed, as a code, or null if it cannot be one.
 * @param {string} input
 */
export function normalizeCode(input) {
  const raw = input.toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  if (raw.length !== 10 || [...raw].some((ch) => !CODE_ALPHABET.includes(ch))) return null;
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/**
 * The share's id and key, from its code.
 * @param {string} code  normalised
 * @returns {Promise<{id: string, key: string}>}
 */
export async function secretsFromCode(code) {
  const enc = new TextEncoder();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`kittycal-share-id:${code}`)));
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('kittycal-share-key-v1'), iterations: 150_000 },
    base, 256));
  return { id: toB64url(digest.slice(0, 16)), key: toB64url(bits) };
}

/**
 * Fresh secrets for a new share, built around a code.
 * @returns {Promise<{code: string, id: string, key: string, token: string}>}
 */
export async function newCodeSecrets() {
  const code = newCode();
  return { code, ...(await secretsFromCode(code)), token: toB64url(random(32)) };
}

/**
 * The link she sends. The secret rides in the fragment, so it reaches his
 * phone and never a server.
 *
 * @param {{id: string, key: string, code?: string}} share
 * @param {string} [base]
 */
export function shareLink(share, base = `${location.origin}${location.pathname}`) {
  return share.code ? `${base}#partner=${share.code}` : `${base}#partner=${share.id}.${share.key}`;
}

/**
 * A share link's fragment: a code, or (from before codes) an id and key.
 * @param {string} hash  location.hash
 * @returns {{code: string}|{id: string, key: string}|null}
 */
export function parseShareHash(hash) {
  const m = /^#partner=([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{40,64})$/.exec(hash);
  if (m) return { id: m[1], key: m[2] };
  const c = /^#partner=([0-9A-Za-z-]{10,12})$/.exec(hash);
  const code = c ? normalizeCode(c[1]) : null;
  return code ? { code } : null;
}

/**
 * The id and key a link or a typed code stands for.
 * @param {{code: string}|{id: string, key: string}} link
 * @returns {Promise<{id: string, key: string, code: string}>}
 */
export async function resolveLink(link) {
  if ('code' in link) return { ...(await secretsFromCode(link.code)), code: link.code };
  return { id: link.id, key: link.key, code: '' };
}

/**
 * Anything he might paste or type: the whole link, its fragment, or the code.
 * @param {string} text
 * @returns {{code: string}|{id: string, key: string}|null}
 */
export function parseShareInput(text) {
  const t = text.trim();
  const hashAt = t.indexOf('#partner=');
  if (hashAt >= 0) return parseShareHash(t.slice(hashAt));
  const code = normalizeCode(t);
  return code ? { code } : null;
}

/**
 * @param {string} fn
 * @param {Record<string, string>} args
 */
async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`share ${fn}: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Create or update her share.
 * @param {{id: string, token: string, key: string}} share
 * @param {unknown} snapshot
 */
export async function putShare(share, snapshot) {
  await rpc('kittycal_put_share', { p_id: share.id, p_token: share.token, p_blob: await encrypt(snapshot, share.key) });
}

/**
 * Read a share. Null when it no longer exists — she stopped sharing.
 * @param {{id: string, key: string}} share
 * @returns {Promise<{snapshot: import('../domain/partner.js').Snapshot, updatedAt: string}|null>}
 */
export async function getShare(share) {
  const rows = await rpc('kittycal_get_share', { p_id: share.id });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  // Untrusted until checked: a forwarded or hand-made link decrypts to
  // whatever its maker put in it.
  const snapshot = cleanSnapshot(await decrypt(row.blob, share.key));
  if (!snapshot) throw new Error('unreadable share');
  return { snapshot, updatedAt: row.updated_at };
}

/** @param {{id: string, token: string}} share */
export async function deleteShare(share) {
  await rpc('kittycal_delete_share', { p_id: share.id, p_token: share.token });
}
