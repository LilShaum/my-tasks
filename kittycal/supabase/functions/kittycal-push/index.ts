// KittyCal partner notifications: the sender.
//
// Called every five minutes by a cron job. Takes the pushes that are due and
// sends each phone an empty Web Push message, signed with the app's VAPID key.
// Empty on purpose: the server never holds the words. The phone wakes, finds
// the heads-up it scheduled for about now, and shows it.
//
// No libraries: an empty push needs no payload encryption, only a VAPID JWT
// (ES256), which WebCrypto signs directly.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUBJECT = 'https://lilshaum.github.io/my-tasks/kittycal/';

const enc = new TextEncoder();
const b64u = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

type Jwk = { kty: string; crv: string; x: string; y: string; d: string };

async function vapidAuth(endpoint: string, jwk: Jwk, key: CryptoKey) {
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: SUBJECT,
  })));
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  const publicKey = new Uint8Array([4, ...fromB64u(jwk.x), ...fromB64u(jwk.y)]);
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${b64u(publicKey)}`;
}

Deno.serve(async () => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: jwk, error: keyError } = await db.rpc('kittycal_push_vapid');
  if (keyError || !jwk) return Response.json({ error: 'no key' }, { status: 500 });
  const key = await crypto.subtle.importKey(
    'jwk', { ...jwk, key_ops: ['sign'], ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const { data: due, error } = await db.rpc('kittycal_push_take_due');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let gone = 0;
  let failed = 0;
  for (const row of (due ?? []) as { endpoint: string }[]) {
    try {
      const res = await fetch(row.endpoint, {
        method: 'POST',
        headers: {
          Authorization: await vapidAuth(row.endpoint, jwk as Jwk, key),
          TTL: String(12 * 3600),
          Urgency: 'normal',
          'Content-Length': '0',
        },
      });
      if (res.status === 404 || res.status === 410) {
        await db.rpc('kittycal_push_forget', { p_endpoint: row.endpoint });
        gone += 1;
      } else if (res.ok) {
        sent += 1;
      } else {
        failed += 1;
        console.log('push failed', res.status, await res.text());
      }
    } catch (err) {
      failed += 1;
      console.log('push error', String(err));
    }
  }
  return Response.json({ due: due?.length ?? 0, sent, gone, failed });
});
