// @ts-check
/**
 * push.js — notifications, for his heads-ups and for her reminders.
 *
 * Subscribing gives the browser's push address for this phone. That address
 * and the times from push-plan.js (his) or reminder-plan.js (hers) are all the
 * server gets; his also names the share he follows. What each notification
 * says is saved on the phone (settings.partnerPush.plan, settings.selfPush.plan),
 * where the service worker reads it when a push wakes it.
 */

import { rpc } from './share.js';

/** The app's public VAPID key. Its private half is in Supabase Vault. */
export const VAPID_PUBLIC = 'BHFJeGCxjsAeOe5BqZR3JoGEG46sWnRvghfk3fxlKE4hO7FCAet46WN7FU-CuhOs7tI25qtjAsEY1khPMLnpPH4';

const isiOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches
  || /** @type {any} */ (navigator).standalone === true;

/**
 * Whether this phone can get notifications at all.
 * - 'ok'      it can
 * - 'install' an iPhone in Safari: only an app on the Home Screen can
 * - 'blocked' the person said no, in the browser or the phone's settings
 * - 'none'    this browser cannot
 * @returns {'ok'|'install'|'blocked'|'none'}
 */
export function pushSupport() {
  if (isiOS() && !standalone()) return 'install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'none';
  if (Notification.permission === 'denied') return 'blocked';
  return 'ok';
}

/** @param {string} b64 */
function keyBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/**
 * Ask, then subscribe. Must be called from a tap: iPhones only show the
 * permission question in answer to one.
 * @returns {Promise<{endpoint: string, p256dh: string, auth: string}|null>}
 */
export async function subscribePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}

/**
 * Tell the server when to wake this phone. Replaces whatever it had.
 * @param {string} shareId
 * @param {{endpoint: string, p256dh: string, auth: string}} sub
 * @param {number[]} times  epoch ms
 */
export async function registerPush(shareId, sub, times) {
  await rpc('kittycal_push_register', {
    p_share_id: shareId, p_endpoint: sub.endpoint, p_p256dh: sub.p256dh, p_auth: sub.auth,
    p_times: times.map((t) => new Date(t).toISOString()),
  });
}

/**
 * Her reminders: tell the server when to wake this phone. Replaces whatever it
 * had. No share, no name, nothing but the address and the times.
 * @param {{endpoint: string, p256dh: string, auth: string}} sub
 * @param {number[]} times  epoch ms
 */
export async function registerSelf(sub, times) {
  await rpc('kittycal_push_register_self', {
    p_endpoint: sub.endpoint, p_p256dh: sub.p256dh, p_auth: sub.auth,
    p_times: times.map((t) => new Date(t).toISOString()),
  });
}

/**
 * The address this browser holds now, or null. A backup restored on another
 * phone carries the old phone's address, which this one cannot use.
 */
export async function currentEndpoint() {
  try {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

/**
 * Stop: the server forgets this phone, and the browser drops the address.
 * @param {string} endpoint
 */
export async function forgetPush(endpoint) {
  try { await rpc('kittycal_push_forget', { p_endpoint: endpoint }); } catch { /* it ages out when the address dies */ }
  try {
    const reg = await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
  } catch { /* nothing to undo */ }
}
