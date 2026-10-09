/**
 * partner.mjs — partner mode, end to end, on two phones.
 *
 * Her phone and his talk through a pretend Supabase: an in-memory map that
 * mirrors supabase/partner-sharing.sql (a put creates a share or updates it
 * only with its token, a get returns the encrypted row or nothing, a delete
 * needs the token). No request reaches the real server.
 *
 *   Her phone
 *     - Share sheet: the defaults, a preview that is his actual Today, and
 *       "Start sharing" sending one put of ciphertext with a code to show.
 *     - Today grows a one-tap status row while she shares, and a tap sends.
 *     - A phone tracking its own cycle that opens a link is offered partner
 *       mode, and keeps its own data.
 *   His phone
 *     - The first screen asks who the app is for. "Following my partner’s
 *       cycle" never asks about a period.
 *     - A wrong code is explained; her code connects; name and look follow,
 *       with her theme picked to start.
 *     - His app: her status, the ring with her character in her colours,
 *       what is likely today from her own patterns, a few lines of help, the
 *       week ahead; Calendar, Rhythm (her typical month) and Settings tabs.
 *     - Opening her link on a fresh phone skips straight to "Connected".
 *     - When she stops sharing, his app says so.
 *   And the promises around it
 *     - What is sent is ciphertext: her name is not readable in it.
 *     - With sharing off, her app makes no request to any other host.
 *     - No page errors, nothing wider than a 390px phone.
 *
 * Run: node test/run-browser.mjs partner        (SHOTS=dir to keep screenshots)
 */

import { launchChromium } from './browser.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const ORIGIN = new URL(BASE).origin;
const SUPABASE = 'https://uepxpnqgrwvqruzexxsg.supabase.co';
const SHOTS = process.env.SHOTS || '';

let checks = 0;
let failures = 0;
const check = (cond, label, extra = '') => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

const errors = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) errors.push(`${who} (csp): ${m.text()}`);
  });
};

let shot = 0;
const snap = async (page, name) => {
  if (!SHOTS) return;
  shot += 1;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${String(shot).padStart(2, '0')}-${name}.png` });
};

/* ── The pretend server ───────────────────────────────────────────────── */

const newServer = () => ({ rows: new Map(), push: new Map(), calls: [], down: false });
const callCount = (server, fn) => server.calls.filter((c) => c.fn === fn).length;

async function attach(ctx, server) {
  await ctx.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const fn = req.url().split('/rpc/')[1] ?? '';
    const body = req.postData() || '{}';
    const args = JSON.parse(body);
    server.calls.push({ fn, args, url: req.url(), body });
    const json = (status, payload) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: payload === undefined ? '' : JSON.stringify(payload),
    });
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS',
      } });
    }
    if (server.down) return json(500, { message: 'down' });
    const row = server.rows.get(args.p_id);
    if (fn === 'kittycal_put_share') {
      if (!args.p_token || args.p_token.length < 32) return json(400, { message: 'token too short' });
      if (row && row.token !== args.p_token) return json(400, { message: 'not allowed' });
      server.rows.set(args.p_id, { token: args.p_token, blob: args.p_blob, updated_at: new Date().toISOString() });
      return json(200);
    }
    if (fn === 'kittycal_get_share') return json(200, row ? [{ blob: row.blob, updated_at: row.updated_at }] : []);
    if (fn === 'kittycal_push_register') {
      if (!server.rows.has(args.p_share_id)) return json(400, { message: 'no such share' });
      server.push.set(args.p_endpoint, { share: args.p_share_id, times: args.p_times });
      return json(200);
    }
    if (fn === 'kittycal_push_forget') { server.push.delete(args.p_endpoint); return json(200); }
    if (fn === 'kittycal_delete_share') {
      if (row && row.token === args.p_token) server.rows.delete(args.p_id);
      return json(200);
    }
    return json(404, {});
  });
}

/* ── Her phone: six months with real patterns ──────────────────────────── */

const seed = async ({ name, theme }) => {
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
  // Today is 3 days before her next period: bloating and harder days are on.
  const lens = [28, 29, 28, 27, 28, 28];
  const starts = [-25];
  for (let i = lens.length - 1; i >= 0; i -= 1) starts.unshift(starts[0] - lens[i]);
  const periodDays = [];
  for (const s of starts) for (let i = 0; i < 5; i += 1) if (s + i <= 0) periodDays.push(shift(s + i));
  let rnd = 9;
  const r = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; };
  const logs = [];
  for (let x = starts[0]; x <= 0; x += 1) {
    const s = Math.max(...starts.filter((y) => y <= x));
    const next = starts.find((y) => y > x) ?? s + 28;
    const day = x - s + 1; const until = next - x;
    const log = { date: shift(x), flow: 'none', symptoms: [], moods: [], discharge: [], activity: [], other: [],
      sex: [], custom: [], severity: {}, notes: '', checkedIn: true };
    if (day <= 5) log.flow = ['medium', 'heavy', 'medium', 'light', 'spotting'][day - 1];
    if (day <= 2) log.symptoms.push('cramps');
    if (until <= 3) log.symptoms.push('bloating');
    if (until <= 4) log.moods.push('irritable'); else log.moods.push(r() < 0.5 ? 'happy' : 'calm');
    if (day >= 15 && until > 4 && r() < 0.5) log.symptoms.push('fatigue');
    log.sleep = until <= 6 ? 6 : 8;
    logs.push(log);
  }
  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme, name, onboarded: true, role: 'self', disclaimerAck: true, avgCycleLength: 28, avgPeriodLength: 5,
      lastBackup: shift(0), lastBackupAt: Date.now(), installDismissed: true } });
    tx.objectStore('meta').put({ key: 'periodDays', value: periodDays });
    for (const l of logs) tx.objectStore('logs').put(l);
    tx.oncomplete = () => res(undefined);
  });
};

const browser = await launchChromium();

/** @param {{seeded?: {name: string, theme: string}, server: any, dark?: boolean}} o */
async function phone({ seeded, server, dark = false }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
  /** @type {string[]} */
  const offOrigin = [];
  ctx.on('request', (req) => {
    const u = new URL(req.url());
    if (u.origin !== ORIGIN && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) offOrigin.push(req.url());
  });
  await attach(ctx, server);
  const page = await ctx.newPage();
  watch(page, seeded ? 'her' : 'his');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (seeded) {
    await page.evaluate(seed, seeded);
    await page.reload({ waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(900);
  return { ctx, page, offOrigin };
}

const wider = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const tab = async (page, name) => { await page.locator(`[data-tab="${name}"]`).click(); await page.waitForTimeout(500); };
const closeSheets = async (page) => {
  for (let i = 0; i < 3 && await page.locator('.sheet[data-open="true"]').count(); i += 1) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  }
};

const server = newServer();

/* ── 1. Her phone, sharing off: nothing leaves it ──────────────────────── */
console.log('\nher phone with sharing off');
const her = await phone({ seeded: { name: 'Mia', theme: 'mymelody' }, server });
await closeSheets(her.page);
for (const t of ['calendar', 'insights', 'settings', 'today']) await tab(her.page, t);
check(her.offOrigin.length === 0, 'no request to any other host while she does not share', her.offOrigin.join(' '));
check(await her.page.locator('.status-row').count() === 0, 'no status row on Today until she shares');

/* ── 2. She shares ─────────────────────────────────────────────────────── */
console.log('\nshe starts sharing');
await her.page.evaluate(async () => (await import('/js/views/partner.js')).openShareSheet());
await her.page.waitForTimeout(500);
const toggles = await her.page.$$eval('.share-sheet .toggle', (n) => n.map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-checked')]));
check(toggles.length === 5, 'five choices', JSON.stringify(toggles));
check(toggles.find(([l]) => /fertile/i.test(l))?.[1] === 'false', 'the fertile window starts off');
check(toggles.filter(([, v]) => v === 'true').length === 4, 'the other four start on');
check(await her.page.locator('.share-note textarea').count() === 1, 'the note is there');
check(!(await her.page.locator('.share-note').getAttribute('open')), 'but folded away: it is optional');
await snap(her.page, 'her-share-sheet');

await her.page.locator('button', { hasText: 'See what their app shows' }).click();
await her.page.waitForTimeout(500);
check(await her.page.locator('.pa-preview .cycle-ring').count() === 1, 'the preview is his Today: the ring');
check(await her.page.locator('.pa-preview .pa-item').count() >= 1, 'with what is likely today');
await snap(her.page, 'her-preview');
await her.page.locator('button', { hasText: 'Back to sharing' }).click();
await her.page.waitForTimeout(400);

check(server.calls.length === 0, 'nothing has been sent before she starts');
await her.page.locator('button', { hasText: 'Start sharing' }).click();
await her.page.waitForTimeout(2500);
check(callCount(server, 'kittycal_put_share') === 1, 'starting sends exactly one put', String(callCount(server, 'kittycal_put_share')));
const put = server.calls.find((c) => c.fn === 'kittycal_put_share');
/*
  The blob is base64 ciphertext, so three random letters like "Mia" turn up in
  it by chance about one run in a hundred (it did, once, and stopped a
  deploy). What must not be there is anything readable: a JSON key, her name
  as JSON, or a pattern's name, none of which base64 can spell by accident.
*/
const blob = String(put?.args?.p_blob ?? '');
check(put && /^[A-Za-z0-9+/=_-]+$/.test(blob) && !/"name"|"Mia"|bloating|Bloating/.test(put.body),
  'what is sent is ciphertext: her name and patterns are not readable', blob.slice(0, 60));
const code = (await her.page.locator('.share-code').textContent().catch(() => '') ?? '').trim();
check(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(code), 'a code is shown to give him', code);
await snap(her.page, 'her-sharing');
await closeSheets(her.page);

/* ── 3. Her Today: one tap to tell him ─────────────────────────────────── */
console.log('\nher one-tap status');
await tab(her.page, 'today');
check(await her.page.locator('.status-row').count() === 1, 'Today now has the status row');
check(await her.page.locator('.status-sticker').count() === 6, 'with six stickers');
const putsBefore = callCount(server, 'kittycal_put_share');
await her.page.locator('.status-sticker', { hasText: 'Cuddles please' }).click();
await her.page.waitForTimeout(1500);
check(callCount(server, 'kittycal_put_share') === putsBefore + 1, 'a tap sends straight away');
check(await her.page.locator('.status-sticker.is-on').count() === 1, 'and shows as sent');
check(/Sent at/.test(await her.page.locator('.status-row-title').textContent() ?? ''), 'with the time it went');
await her.page.evaluate(() => window.scrollTo(0, 420));
await snap(her.page, 'her-status-row');
check(!(await wider(her.page)), 'her Today fits a 390px phone');

/* ── 4. His phone: the door and his setup ──────────────────────────────── */
console.log('\nhis phone: who is this for?');
const his = await phone({ server });
check(await his.page.locator('.door-card').count() === 2, 'the first screen offers the two apps');
await snap(his.page, 'his-door');
await his.page.locator('.door-card', { hasText: 'partner' }).click();
await his.page.waitForTimeout(500);
const setupText = await his.page.locator('#onboarding-root').innerText();
check(/Connect to her cycle/.test(setupText), 'the partner path starts with connecting');
check(!/period start|birth control|How long is your cycle/i.test(setupText), 'and never asks about a period');
await snap(his.page, 'his-connect');

await his.page.fill('#pa-code', 'nope');
await his.page.locator('#onboarding-root .btn-lg').click();
await his.page.waitForTimeout(300);
check(/doesn’t look like a code/.test(await his.page.locator('.pa-error').textContent() ?? ''), 'a malformed code is explained');
await his.page.fill('#pa-code', 'ABCDE-FGHJK');
await his.page.locator('#onboarding-root .btn-lg').click();
await his.page.waitForTimeout(1500);
check(/Couldn’t find that one/.test(await his.page.locator('.pa-error').textContent() ?? ''), 'a code with no share behind it says so');
await his.page.fill('#pa-code', code.toLowerCase().replace('-', ' '));
await his.page.locator('#onboarding-root .btn-lg').click();
await his.page.waitForTimeout(2000);
check(/Connected to Mia’s cycle/.test(await his.page.locator('#onboarding-root h2').textContent() ?? ''), 'her code connects, typed however he likes');
await snap(his.page, 'his-connected');
await his.page.locator('#onboarding-root .btn-lg').click();
await his.page.waitForTimeout(400);
await his.page.fill('#onboarding-root input', 'Sam');
await snap(his.page, 'his-name');
await his.page.locator('#onboarding-root .btn-lg').click();
await his.page.waitForTimeout(400);
check(await his.page.locator('.theme-card[aria-checked="true"], [role="radio"][aria-checked="true"]').count() === 1, 'one look is picked');
check(/uses My Melody/.test(await his.page.locator('#onboarding-root').innerText()), 'and he is told it is hers');
// He picks his own.
await his.page.locator('[role="radio"]', { hasText: 'Badtz-Maru' }).click();
await snap(his.page, 'his-look');
await his.page.locator('#onboarding-root .btn-lg').click();
await his.page.waitForTimeout(1500);

/* ── 5. His app ────────────────────────────────────────────────────────── */
console.log('\nhis app');
check(await his.page.locator('.sheet[data-open="true"]').count() === 0, 'no check-in asks him about a period');
check(await his.page.locator('[data-tab="insights"] span').textContent() === 'Rhythm', 'his third tab is Rhythm');
check(/Afternoon, Sam|Morning, Sam|Evening, Sam/.test(await his.page.locator('.today-greeting h2').textContent() ?? ''), 'it greets him');
check(/Cuddles please/.test(await his.page.locator('.pa-status').textContent().catch(() => '') ?? ''), 'her status is the first thing he sees');
const markerTheme = await his.page.locator('.cycle-ring .ring-marker-art').getAttribute('data-theme');
check(markerTheme === 'mymelody', 'the ring marks her with her character, in her colours', String(markerTheme));
check(await his.page.evaluate(() => document.documentElement.dataset.theme) === 'badtzmaru', 'while his app wears the look he chose');
check(/Keep the evening free/.test(await his.page.locator('.pa-status').textContent() ?? ''), 'with the one thing that helps, right under it');
const titles = await his.page.$$eval('.pa-item-title', (n) => n.map((c) => c.textContent?.trim() ?? ''));
check(titles.includes('Bloating'), 'likely today comes from her own pattern: bloating', JSON.stringify(titles));
check(titles.includes('Harder days'), 'and harder days', JSON.stringify(titles));
const lines = await his.page.$$eval('.pa-item-text', (n) => n.map((c) => c.textContent?.trim() ?? ''));
check(lines.length >= 2 && lines.every((t) => /^Usually /.test(t)), 'each says when it usually happens for her', JSON.stringify(lines));
check(lines.every((t) => t.length < 130), 'in a line or two');
check(await his.page.locator('.pa-help, .pa-chip, .pa-dot').count() === 0, 'no separate help list, chips or unexplained dots');
const key = await his.page.locator('.pa-key').textContent().catch(() => '') ?? '';
check(/Period/.test(key) && /Luteal/.test(key), 'the ring’s colours are named under it', key);
const weekLegend = await his.page.locator('.pa-today .pa-legend').textContent().catch(() => '') ?? '';
check(/Period likely/.test(weekLegend) && /Harder days/.test(weekLegend), 'the week’s looks are named', weekLegend);
check(await his.page.locator('.pa-day').count() === 7, 'the week ahead, seven days');
check(/period is likely to start/.test(await his.page.locator('.pa-week-note').textContent().catch(() => '') ?? ''), 'and it says when her period is likely');
check(!(await wider(his.page)), 'his Today fits a 390px phone');
await snap(his.page, 'his-today');
await his.page.evaluate(() => window.scrollTo(0, 700));
await snap(his.page, 'his-today-lower');

await his.page.locator('.pa-day').nth(3).click();
await his.page.waitForTimeout(500);
check(/Day \d+ of Mia’s cycle/.test(await his.page.locator('.pa-day-head').textContent().catch(() => '') ?? ''), 'a day opens with where she will be');
await snap(his.page, 'his-day-sheet');
await closeSheets(his.page);

await tab(his.page, 'insights');
check(/Mia’s rhythm/.test(await his.page.locator('#app-title-text').textContent() ?? ''), 'Rhythm is titled with her name');
const rows = await his.page.$$eval('.pa-when-row .pa-item-title', (n) => n.map((c) => c.textContent?.trim()));
check(rows.includes('Period') && rows.includes('Bloating'), 'her month lists her period and her own patterns', JSON.stringify(rows));
check(await his.page.locator('.pa-when-track').count() >= 2, 'each placed on a track of her month with today marked');
check(await his.page.locator('#view-insights .pa-bar, #view-insights .pa-coming, #view-insights .pa-tile').count() === 0, 'and nothing that repeats Today or Calendar: no month bar, no dates list, no number tiles');
const rowText = await his.page.locator('.pa-when').innerText();
check(/Next: \w{3} \d+ \w{3}/.test(rowText) || /Until \w{3} \d+ \w{3}/.test(rowText), 'each with the dates it lands on', rowText.slice(0, 200));
check(!/hasn’t shared patterns/.test(await his.page.locator('#view-insights').innerText()), 'and no “not enough history” line when there are patterns');
check(/dependable/i.test(await his.page.locator('.pa-dependable').textContent().catch(() => '') ?? ''), 'how far ahead he can plan, said once');
check(!(await wider(his.page)), 'Rhythm fits a 390px phone');
await snap(his.page, 'his-rhythm');
await his.page.evaluate(() => window.scrollTo(0, 650));
await snap(his.page, 'his-rhythm-lower');

await tab(his.page, 'calendar');
check(await his.page.locator('.cal-grid .cal-cell').count() >= 28, 'Calendar draws the month');
check(await his.page.locator('.cal-cell.is-predicted').count() >= 1, 'with her expected period');
check(await his.page.locator('#view-calendar .pa-coming li').count() === 3, 'and her next three periods, with the add-to-calendar button, live here');
const calLegend = await his.page.locator('#view-calendar .cal-legend').textContent() ?? '';
check(/Period likely/.test(calLegend) && !/Expected|Usual symptoms/.test(calLegend), 'named “Period likely”, with no mystery dots', calLegend);
check(/Today/.test(await his.page.locator('.pa-picked h3').textContent().catch(() => '') ?? ''), 'today’s detail sits under the month');
await his.page.locator('.cal-cell.is-predicted').first().click();
await his.page.waitForTimeout(400);
check(/Period likely/.test(await his.page.locator('.pa-picked').innerText().catch(() => '')), 'and tapping a day shows that day');
await snap(his.page, 'his-calendar');

await tab(his.page, 'settings');
check((await his.page.locator('.pa-code').textContent()) === code, 'Settings shows the code, to connect another phone');
check(await his.page.locator('button', { hasText: 'Disconnect' }).count() === 1, 'and a way to disconnect');
// Her character is drawn on several screens at once, some hidden. Shared clip
// ids made the copy here lose its clip and show stripes; every id is unique now.
const dupes = await his.page.evaluate(() => {
  const ids = [...document.querySelectorAll('[id]')].map((n) => n.id);
  return ids.filter((id, i) => ids.indexOf(id) !== i);
});
check(dupes.length === 0, 'no id is used twice on the page, so every drawing keeps its own clip', dupes.slice(0, 5).join(' '));
await snap(his.page, 'his-settings');
await tab(his.page, 'today');

/* ── 5b. Heads-ups on his phone ────────────────────────────────────────── */
console.log('\nhis heads-ups');
await his.ctx.grantPermissions(['notifications'], { origin: ORIGIN });
// Headless Chromium has no push service; stand in for the browser's subscribe.
await his.page.evaluate(() => {
  const fake = { endpoint: 'https://push.example/abc123def456ghi', keys: { p256dh: 'BPk-fake-key', auth: 'fake-auth' } };
  /** @type {any} */ (PushManager.prototype).subscribe = async () => ({ toJSON: () => fake, unsubscribe: async () => true });
  /** @type {any} */ (PushManager.prototype).getSubscription = async () => null;
});
await tab(his.page, 'settings');
check(/Heads-ups/i.test(await his.page.locator('#view-settings').innerText()), 'Settings has a heads-ups section');
await his.page.locator('[role="switch"][aria-label^="Before Mia"]').click();
await his.page.waitForTimeout(1500);
const reg = [...server.push.values()][0];
check(server.push.size === 1, 'turning one on registers this phone', String(server.push.size));
check(reg && reg.times.length >= 1 && reg.times.every((t) => !Number.isNaN(Date.parse(t))), 'with times only', JSON.stringify(reg));
const regCall = server.calls.find((c) => c.fn === 'kittycal_push_register');
check(regCall && !/Mia|period|tomorrow/i.test(JSON.stringify(regCall.args)), 'and nothing about her: no name, no words');
check(/Next:/.test(await his.page.locator('#view-settings').innerText()), 'Settings says when the next one is');
await snap(his.page, 'his-headsups');

// A push arrives: the service worker shows what his phone planned.
const shown = await his.page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  const { getState } = await import('/js/state/store.js');
  const plan = getState().settings.partnerPush?.plan ?? [];
  return { planned: plan.length, first: plan[0]?.title ?? '' , scope: reg.scope };
});
check(shown.planned >= 1 && /period is likely tomorrow/.test(shown.first), 'his phone keeps the words itself', JSON.stringify(shown));

await his.page.locator('[role="switch"][aria-label^="Before Mia"]').click();
await his.page.waitForTimeout(1200);
check(server.push.size === 0, 'turning the last one off forgets this phone');
await tab(his.page, 'today');

/* ── 6. Opening her link on a fresh phone ──────────────────────────────── */
console.log('\nher link on a fresh phone');
const fresh = await phone({ server });
await fresh.page.goto(`${BASE}/#partner=${code}`, { waitUntil: 'networkidle' });
await fresh.page.waitForTimeout(2500);
check(/Connected to Mia’s cycle/.test(await fresh.page.locator('#onboarding-root h2').textContent().catch(() => '') ?? ''), 'the link goes straight to Connected, no door');
check(!/#partner=/.test(await fresh.page.evaluate(() => location.href)), 'and the code is taken out of the address bar');
await fresh.ctx.close();

/* ── 7. Her link on a phone that tracks its own cycle ──────────────────── */
console.log('\nher link on a phone that tracks its own cycle');
const other = await phone({ seeded: { name: 'Jo', theme: 'keroppi' }, server });
await other.page.goto(`${BASE}/#partner=${code}`, { waitUntil: 'networkidle' });
await other.page.waitForTimeout(2500);
check(/Mia shared her cycle with you/.test(await other.page.locator('.pa-offer').textContent().catch(() => '') ?? ''), 'it is offered partner mode');
await snap(other.page, 'offer-sheet');
await other.page.locator('button', { hasText: 'Not now' }).click();
await other.page.waitForTimeout(400);
check(await other.page.locator('.cycle-ring').count() === 1, '"Not now" leaves her own app as it was');
await other.ctx.close();

/* ── 8. She stops sharing ──────────────────────────────────────────────── */
console.log('\nshe stops sharing');
await her.page.evaluate(async () => (await import('/js/views/partner.js')).openShareSheet());
await her.page.waitForTimeout(400);
await her.page.locator('button', { hasText: 'Stop sharing' }).click();
await her.page.waitForTimeout(400);
await her.page.locator('.sheet[data-open="true"] button', { hasText: 'Stop sharing' }).last().click();
await her.page.waitForTimeout(1200);
check(server.rows.size === 0, 'the share is deleted');
await his.page.locator('.pa-foot button', { hasText: 'Refresh' }).click();
await his.page.waitForTimeout(1500);
check(/Mia has stopped sharing/.test(await his.page.locator('#view-today').innerText()), 'his app says she stopped sharing');
await snap(his.page, 'his-stopped');

check(errors.length === 0, 'no page errors on any phone', errors.join(' | '));
await her.ctx.close();
await his.ctx.close();
await browser.close();
console.log(`\npartner: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
