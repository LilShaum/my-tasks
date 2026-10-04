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

/**
 * The link she sends. The key rides in the fragment, so it reaches his phone
 * and never a server.
 *
 * @param {{id: string, key: string}} share
 * @param {string} [base]
 */
export function shareLink(share, base = `${location.origin}${location.pathname}`) {
  return `${base}#partner=${share.id}.${share.key}`;
}

/**
 * @param {string} hash  location.hash
 * @returns {{id: string, key: string}|null}
 */
export function parseShareHash(hash) {
  const m = /^#partner=([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{40,64})$/.exec(hash);
  return m ? { id: m[1], key: m[2] } : null;
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
