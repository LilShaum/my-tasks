/**
 * reminders.mjs — her reminders as real notifications, end to end on one phone.
 *
 *   - Reminders she switched on before they were notifications are not shown
 *     as on: a note says they now arrive with the app closed.
 *   - Switching one on asks for permission once, and gives the server her
 *     push address and times only: no words, no dates of anything, no share.
 *   - Settings says when the next one is, and what the server learns.
 *   - The pill reminder appears only for a daily pill, at her time, and a pill
 *     she marks drops today's reminder from what the server holds.
 *   - Switching the last one off makes the server forget this phone.
 *   - Nothing reaches any other host while no reminder is on.
 *
 * Headless Chromium has no push service, so subscribing is stood in for, and
 * the server is a pretend one: no request reaches the real server.
 *
 * Run: node test/run-browser.mjs reminders      (SHOTS=dir to keep screenshots)
 */

import { launchChromium } from './browser.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const ORIGIN = new URL(BASE).origin;
const SUPABASE = 'https://uepxpnqgrwvqruzexxsg.supabase.co';
const SHOTS = process.env.SHOTS || '';
/** @param {import('playwright').Page} p @param {string} name */
const shot = async (p, name) => {
  if (!SHOTS) return;
  await p.locator('.section-title', { hasText: 'Reminders' }).scrollIntoViewIfNeeded();
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${SHOTS}/reminders-${name}.png` });
};

let checks = 0;
let failures = 0;
const check = (cond, label, extra = '') => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

/** @type {{fn: string, args: any}[]} */
const calls = [];
/** @type {Map<string, string[]>} */
const server = new Map();

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
/** @type {string[]} */
const offOrigin = [];
ctx.on('request', (req) => {
  const u = new URL(req.url());
  if (u.origin !== ORIGIN && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) offOrigin.push(req.url());
});
await ctx.route(`${SUPABASE}/**`, async (route) => {
  const req = route.request();
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  const fn = req.url().split('/rpc/')[1] ?? '';
  const args = JSON.parse(req.postData() || '{}');
  calls.push({ fn, args });
  if (fn === 'kittycal_push_register_self') server.set(args.p_endpoint, args.p_times);
  if (fn === 'kittycal_push_forget') server.delete(args.p_endpoint);
  return route.fulfill({ status: 200, headers, contentType: 'application/json', body: '' });
});
await ctx.grantPermissions(['notifications'], { origin: ORIGIN });

const page = await ctx.newPage();
/** @type {string[]} */
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });

// Her phone: three cycles, on the combined pill, with reminders switched on
// back when they only fired on opening the app.
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('kittycal', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('logs', { keyPath: 'date' });
      d.createObjectStore('meta', { keyPath: 'key' });
      d.createObjectStore('blobs', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const pad = (x) => String(x).padStart(2, '0');
  const shift = (x) => { const d = new Date(); d.setDate(d.getDate() + x);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const periodDays = [];
  for (const s of [-74, -46, -18]) for (let i = 0; i < 5; i += 1) periodDays.push(shift(s + i));
  await new Promise((res) => {
    const tx = db.transaction(['meta'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      name: 'Mia', theme: 'mymelody', onboarded: true, role: 'self', disclaimerAck: true, installDismissed: true,
      avgCycleLength: 28, avgPeriodLength: 5, birthControl: 'pill-combined',
      lastBackup: shift(0), lastBackupAt: Date.now() } });
    tx.objectStore('meta').put({ key: 'periodDays', value: periodDays });
    tx.objectStore('meta').put({ key: 'reminders', value: { periodSoon: true } });
    tx.oncomplete = () => res(undefined);
  });
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
for (let i = 0; i < 3 && await page.locator('.sheet[data-open="true"]').count(); i += 1) {
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
}

// Headless Chromium has no push service; stand in for the browser's subscribe.
await page.evaluate(() => {
  const fake = { endpoint: 'https://fcm.googleapis.com/fcm/send/her-phone-123', keys: { p256dh: 'BPk-fake-key', auth: 'fake-auth' } };
  let subscribed = false;
  /** @type {any} */ (PushManager.prototype).subscribe = async () => { subscribed = true;
    return { endpoint: fake.endpoint, toJSON: () => fake, unsubscribe: async () => { subscribed = false; return true; } }; };
  /** @type {any} */ (PushManager.prototype).getSubscription = async () => (subscribed
    ? { endpoint: fake.endpoint, toJSON: () => fake, unsubscribe: async () => { subscribed = false; return true; } } : null);
});

const settingsText = async () => page.locator('#view-settings').innerText();
await page.locator('[data-tab="settings"]').click();
await page.waitForTimeout(700);

console.log('\nbefore she switches any on');
check(/now arrive even when Kittycal is closed/.test(await settingsText()), 'reminders from before are explained, not silently off');
check(await page.locator('[role="switch"][aria-label="Period coming up"]').getAttribute('aria-checked') === 'false',
  'and shown as off until she allows notifications');
check(offOrigin.length === 0, 'nothing has reached any other host', offOrigin.join(' '));
await shot(page, 'before');

console.log('\nshe switches on "Period coming up"');
await page.locator('[role="switch"][aria-label="Period coming up"]').click();
await page.waitForTimeout(1500);
const reg = calls.find((c) => c.fn === 'kittycal_push_register_self');
check(Boolean(reg), 'this phone is registered for her own reminders');
check(reg && Object.keys(reg.args).sort().join() === 'p_auth,p_endpoint,p_p256dh,p_times', 'with its address and times, and nothing else', JSON.stringify(reg?.args));
check(reg && !/Mia|period|pill|cramp|Oct|Nov/i.test(JSON.stringify(reg.args.p_times)), 'the times say nothing about why');
check(reg && reg.args.p_times.length === 3, 'her next three periods, two days ahead', String(reg?.args.p_times.length));
check(await page.locator('[role="switch"][aria-label="Period coming up"]').getAttribute('aria-checked') === 'true', 'the switch shows on');
const text = await settingsText();
check(/Next: .*“Your period is likely in 2 days”/.test(text), 'Settings says when the next one is, and what it will say', text.match(/Next:.*/)?.[0] ?? '');
check(/only told when to buzz this phone, never what about/.test(text), 'and what the server learns');
const words = await page.evaluate(async () => (await import('/js/state/store.js')).getState().settings.selfPush?.plan[0]?.title ?? '');
check(/likely in 2 days/.test(words), 'the words are kept on this phone', words);

console.log('\nthe pill');
check(await page.locator('[role="switch"][aria-label="My pill"]').count() === 1, 'offered, because she takes a daily pill');
await page.locator('[role="switch"][aria-label="My pill"]').click();
await page.waitForTimeout(1500);
check(await page.locator('input[type="time"]').count() === 1, 'with a time to set');
await page.locator('input[type="time"]').fill('23:59');
await page.locator('input[type="time"]').dispatchEvent('change');
await page.waitForTimeout(1500);
const withPill = server.get('https://fcm.googleapis.com/fcm/send/her-phone-123') ?? [];
const tonight = withPill.some((t) => { const d = new Date(t); return d.getDate() === new Date().getDate() && d.getHours() === 23 && d.getMinutes() === 59; });
check(tonight, 'tonight’s pill is due at her time', JSON.stringify(withPill.slice(0, 3)));

// She marks today's pill, the way the diary does.
await page.evaluate(async () => {
  const store = await import('/js/state/store.js');
  const pad = (x) => String(x).padStart(2, '0');
  const d = new Date(); const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const { emptyLog } = await import('/js/domain/model.js');
  store.putLog({ ...emptyLog(key), pillTaken: true });
});
await page.waitForTimeout(4500);
await page.locator('[data-tab="settings"]').click();
await page.waitForTimeout(500);
await shot(page, 'on');
const afterTaken = server.get('https://fcm.googleapis.com/fcm/send/her-phone-123') ?? [];
const stillTonight = afterTaken.some((t) => { const d = new Date(t); return d.getDate() === new Date().getDate() && d.getHours() === 23; });
check(!stillTonight && afterTaken.length > 0, 'marking today’s pill takes tonight’s reminder off the server', JSON.stringify(afterTaken.slice(0, 3)));

console.log('\nswitching them off');
await page.locator('[data-tab="settings"]').click();
await page.waitForTimeout(500);
await page.locator('[role="switch"][aria-label="My pill"]').click();
await page.waitForTimeout(1000);
await page.locator('[role="switch"][aria-label="Period coming up"]').click();
await page.waitForTimeout(1200);
check(server.size === 0, 'the last one off makes the server forget this phone');
check(await page.evaluate(async () => (await import('/js/state/store.js')).getState().settings.selfPush) === null, 'and this phone forgets its address');

check(errors.length === 0, 'no page errors', errors.join(' | '));
await browser.close();
console.log(`\nreminders: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
