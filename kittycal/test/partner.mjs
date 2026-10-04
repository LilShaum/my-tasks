/**
 * partner.mjs — partner sharing, end to end in a real browser.
 *
 * Two phones talking through a pretend Supabase. The pretend server is an
 * in-memory map that mirrors supabase/partner-sharing.sql: a put creates a
 * share or updates it only with the token it was made with (otherwise 400), a
 * get returns [{blob, updated_at}] or [], and a delete removes the row only
 * with the right token. No request ever reaches the real server: every call to
 * supabase.co is answered here.
 *
 *   Her phone
 *     - Settings → "Share with your partner": the toggles with their defaults
 *       (mood and fertile off), the always-shared period row, the "What helps
 *       you" box only while helps is on, and a preview of what he will see.
 *     - "Create the link" sends exactly one put, and what it sends is
 *       ciphertext: neither her name nor what helps is readable in it, and the
 *       key is nowhere in the request.
 *     - A changed choice is sent within a few seconds; a change that does not
 *       alter the summary is not.
 *     - The privacy note in Settings says so while she shares.
 *   His phone
 *     - Not set up: the link shows her cycle, takes the key out of the address
 *       bar, shows no onboarding, and "Track my own cycle too" opens it.
 *     - Already set up: the app loads normally and a Partner view sheet opens.
 *     - Stopping on her side shows up on his Refresh.
 *   And the promises around it
 *     - A server that is down on "Create the link" leaves nothing stored.
 *     - With sharing off, a walk through the whole app makes no request to any
 *       other host. This is the privacy claim.
 *     - No page errors, nothing wider than a 390px phone, dark mode readable.
 *
 * Run: node test/run-browser.mjs partner
 */

import { launchChromium } from './browser.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const ORIGIN = new URL(BASE).origin;
const SUPABASE = 'https://uepxpnqgrwvqruzexxsg.supabase.co';

let checks = 0;
let failures = 0;
const check = (cond, label, extra = '') => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

/** Everything that threw, anywhere. */
const errors = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) {
      errors.push(`${who} (csp): ${m.text()}`);
    }
  });
};

/* ── The pretend server ───────────────────────────────────────────────── */

/** @returns {{rows: Map<string, any>, calls: {fn: string, args: any, url: string, body: string}[], down: boolean}} */
const newServer = () => ({ rows: new Map(), calls: [], down: false });

const putCount = (server) => server.calls.filter((c) => c.fn === 'kittycal_put_share').length;
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
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
        },
      });
    }
    if (server.down) return json(500, { message: 'down' });
    const row = server.rows.get(args.p_id);
    if (fn === 'kittycal_put_share') {
      if (!args.p_token || args.p_token.length < 32) return json(400, { message: 'token too short' });
      if (row && row.token !== args.p_token) return json(400, { message: 'not allowed' });
      server.rows.set(args.p_id, { token: args.p_token, blob: args.p_blob, updated_at: new Date().toISOString() });
      return json(200);
    }
    if (fn === 'kittycal_get_share') {
      return json(200, row ? [{ blob: row.blob, updated_at: row.updated_at }] : []);
    }
    if (fn === 'kittycal_delete_share') {
      if (row && row.token === args.p_token) server.rows.delete(args.p_id);
      return json(200);
    }
    return json(404, {});
  });
}

/* ── A phone with a cycle behind it ───────────────────────────────────── */

/**
 * Five tidy cycles, today on day 15 of the current one, every day logged, and
 * bloating in the three days before each period so there is a pattern to
 * share. Today is already checked in, so no sheet opens by itself.
 */
const seed = async ({ name, theme, extra }) => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('kittycal', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('logs', { keyPath: 'date' });
      d.createObjectStore('meta', { keyPath: 'key' });
      d.createObjectStore('blobs', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const pad = (n) => String(n).padStart(2, '0');
  const shift = (n) => {
    const d = new Date(); d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const starts = [-14, -42, -70, -98, -126];
  const periodDays = [];
  for (const s of starts) for (let i = 0; i < 5; i += 1) periodDays.push(shift(s + i));
  const bleeding = new Set(periodDays);
  const before = new Set();
  for (const s of starts) for (let i = 1; i <= 3; i += 1) before.add(shift(s - i));
  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme, onboarded: true, disclaimerAck: true, avgCycleLength: 28, avgPeriodLength: 5,
      name, showFertility: true, mode: 'cycle', lastBackup: shift(0), lastBackupAt: Date.now(),
      ...extra,
    } });
    tx.objectStore('meta').put({ key: 'periodDays', value: periodDays });
    for (let i = -135; i <= 0; i += 1) {
      const date = shift(i);
      tx.objectStore('logs').put({
        date, checkedIn: true, flow: bleeding.has(date) ? 'medium' : 'none',
        symptoms: before.has(date) ? ['bloating'] : [], moods: ['calm'], discharge: [],
        activity: [], other: [], sex: [], custom: [], severity: {}, notes: 'PRIVATE-NOTE',
        updated: Date.now(),
      });
    }
    tx.oncomplete = () => res(undefined);
  });
};

const browser = await launchChromium();

/**
 * @param {{server: any, seeded?: boolean, name?: string, theme?: string,
 *   scheme?: 'light'|'dark', extra?: Record<string, any>, url?: string,
 *   who: string, clipboard?: boolean}} o
 */
async function phone({ server, seeded = true, name = 'Sam', theme = 'hellokitty', scheme = 'light', extra = {}, url = BASE, who, clipboard = false }) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme,
    permissions: clipboard ? ['clipboard-read', 'clipboard-write'] : [],
  });
  await ctx.addInitScript(() => {
    try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch { /* fine */ }
  });
  if (server) await attach(ctx, server);
  const page = await ctx.newPage();
  watch(page, who);
  if (seeded) {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(seed, { name, theme, extra });
    // Load it for real, rather than navigating to a hash on the same page.
    await page.goto('about:blank');
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1700);
  return { ctx, page };
}

const settle = (page, ms = 400) => page.waitForTimeout(ms);
const sheetOpen = (page) => page.locator('.sheet[data-open="true"]').count().then((n) => n > 0);

const settingsOnDisk = (page) => page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('kittycal', 1); r.onsuccess = () => res(r.result);
  });
  return new Promise((res) => {
    const g = db.transaction(['meta'], 'readonly').objectStore('meta').get('settings');
    g.onsuccess = () => res(g.result?.value ?? null);
  });
});

async function openSettings(page) {
  await page.locator('[data-tab="settings"]').click();
  await settle(page, 500);
}

async function openShare(page) {
  await openSettings(page);
  await page.locator('button.row:has-text("Share with your partner")').click();
  await settle(page, 700);
}

async function closeSheet(page) {
  if (await sheetOpen(page)) { await page.keyboard.press('Escape'); await settle(page, 500); }
}

const overflow = (page) => page.evaluate(() => ({
  doc: document.documentElement.scrollWidth - window.innerWidth,
  body: document.body.scrollWidth - window.innerWidth,
  sheet: (() => {
    const s = document.querySelector('.sheet[data-open="true"]');
    return s ? s.scrollWidth - s.clientWidth : 0;
  })(),
}));

const switchState = (page, label) =>
  page.locator(`.share-sheet [role="switch"][aria-label="${label}"]`).getAttribute('aria-checked');

const LABELS = {
  phase: 'Where you are in your cycle',
  patterns: 'Your usual pre-period symptoms',
  helps: 'What helps you',
  mood: 'When harder days usually start',
  fertile: 'Your fertile window',
  name: 'Your name',
};
const HELPS = 'Zebra-striped heat pad and mint tea';

/** Poll until a condition holds, up to `ms`. */
async function until(fn, ms = 7000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

const server = newServer();

/* ── 1. Her: the sheet, before anything is sent ───────────────────────── */
console.log('\nher: the share sheet');
const her = await phone({ server, who: 'her', clipboard: true });
const hp = her.page;
let link = '';
{
  await openSettings(hp);
  const note = await hp.locator('#view-settings .note').last().innerText();
  check(/Nothing here is sent anywhere/.test(note), 'the privacy note says nothing is sent, before sharing', note.slice(0, 80));
  check(/Let someone see when your period/.test(await hp.locator('button.row:has-text("Share with your partner")').innerText()),
    'the Settings row offers sharing');

  await openShare(hp);
  check(await sheetOpen(hp), 'Share with your partner opens a sheet');
  check(await hp.locator('.sheet h2:has-text("Share with your partner")').count() === 1, 'titled "Share with your partner"');

  const states = {};
  for (const [id, label] of Object.entries(LABELS)) states[id] = await switchState(hp, label);
  check(Object.keys(LABELS).every((id) => states[id] !== null), 'there is a switch for each of the six choices', JSON.stringify(states));
  check(states.phase === 'true' && states.patterns === 'true' && states.helps === 'true' && states.name === 'true',
    'phase, patterns, helps and name start on', JSON.stringify(states));
  check(states.mood === 'false' && states.fertile === 'false', 'mood and fertile start off', JSON.stringify(states));

  const alwaysRow = hp.locator('.share-sheet .row:has-text("When your period’s coming")');
  check(await alwaysRow.count() === 1 && /Always shared/.test(await alwaysRow.innerText()), 'the period row says it is always shared');
  check(await alwaysRow.locator('[role="switch"]').count() === 0, 'and has no switch to turn it off');

  check(await hp.locator('.share-helps textarea').isVisible(), 'the "What helps you" box shows while helps is on');
  await hp.locator(`.share-sheet [role="switch"][aria-label="${LABELS.helps}"]`).click();
  await settle(hp, 200);
  check(await hp.locator('.share-helps textarea').count() === 0, 'and goes when helps is turned off');
  await hp.locator(`.share-sheet [role="switch"][aria-label="${LABELS.helps}"]`).click();
  await settle(hp, 200);
  check(await hp.locator('.share-helps textarea').isVisible(), 'and comes back when it is turned on again');
  check(await callCount(server, 'kittycal_put_share') === 0, 'toggling before the link exists sends nothing');
  check(!(await settingsOnDisk(hp)).partnerShare, 'and stores nothing');

  await hp.locator('.share-helps textarea').fill(HELPS);
  await hp.locator('.share-helps textarea').dispatchEvent('change');
  await settle(hp, 200);

  const overflowSheet = await overflow(hp);
  check(overflowSheet.doc <= 0 && overflowSheet.body <= 0 && overflowSheet.sheet <= 0,
    'her sheet fits a 390px phone', JSON.stringify(overflowSheet));

  await hp.locator('.share-preview summary').click();
  await settle(hp, 400);
  // The preview is drawn with the sheet, so what she has just typed is only in
  // it after the next redraw. Say so, then redraw (turn phase off and on).
  const typedShows = (await hp.locator('.share-preview .partner').innerText()).includes(HELPS);
  if (!typedShows) console.log('  known  the preview does not show what she is typing until the sheet next redraws');
  await hp.locator(`.share-sheet [role="switch"][aria-label="${LABELS.phase}"]`).click();
  await settle(hp, 150);
  await hp.locator(`.share-sheet [role="switch"][aria-label="${LABELS.phase}"]`).click();
  await settle(hp, 250);
  await hp.locator('.share-preview summary').evaluate((n) => { if (!n.parentElement.open) n.click(); });
  await settle(hp, 300);
  const preview = await hp.locator('.share-preview .partner').innerText();
  check(await hp.locator('.share-preview .partner').count() === 1, 'the preview shows what he would see');
  check(/period/i.test(preview), 'with the headline about her period', preview.slice(0, 80));
  check(preview.includes('What helps') && preview.includes(HELPS), 'including what helps, in her words');
  check(preview.includes('Next periods (expected)'), 'and the next periods');
  check(/Bloating/i.test(preview), 'and her usual pre-period symptoms', preview.slice(0, 300));
  check(await hp.locator('.share-preview .partner-ics').count() === 0, 'the preview has no "Add to my calendar" button');
  check(!/Fertile window/.test(preview) && !/Harder days/.test(preview), 'fertile and mood stay out while they are off');

  const hint = await hp.locator('.share-sheet .hint-sm').last().innerText();
  check(/Never shared: your daily logs, notes, tests, sex, or a late period/.test(hint), 'the sheet says what is never shared');
  check(await hp.locator('.share-link input').count() === 0, 'there is no link yet');
}

/* ── 2. Her: create the link ──────────────────────────────────────────── */
console.log('\nher: create the link');
{
  await hp.locator('button:has-text("Create the link")').click();
  await settle(hp, 1500);

  const puts = server.calls.filter((c) => c.fn === 'kittycal_put_share');
  check(puts.length === 1, 'exactly one put is sent', String(puts.length));
  check(server.calls.length === 1, 'and nothing else is called', server.calls.map((c) => c.fn).join(','));
  const put = puts[0];
  check(put?.url === `${SUPABASE}/rest/v1/rpc/kittycal_put_share`, 'to the put function');
  check(put?.args.p_id?.length === 22 && put?.args.p_token?.length === 43, 'with a 22-character id and a 43-character token');

  const blob = put?.args.p_blob ?? '';
  let parsed = true;
  try { JSON.parse(blob); } catch { parsed = false; }
  check(!parsed, 'the blob is not readable JSON');
  check(/^[A-Za-z0-9_-]{40,}$/.test(blob), 'it is base64url text');
  const raw = Buffer.from(blob.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
  check(!/Sam/.test(blob) && !/Sam/.test(raw), 'it does not contain her name');
  check(!blob.includes('Zebra') && !raw.includes('Zebra') && !raw.includes('heat pad'), 'or what helps');
  check(!raw.includes('PRIVATE-NOTE') && !raw.includes('bloating'), 'or her notes or symptoms');

  const linkBox = hp.locator('.share-link input');
  check(await linkBox.count() === 1, 'the link box appears');
  link = await linkBox.inputValue().catch(() => '');
  const m = /#partner=([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(link);
  check(Boolean(m), 'the link ends #partner=<id>.<key>', link);
  check(m?.[1] === put?.args.p_id, 'the id in the link is the id that was stored');
  check(!put?.body.includes(m?.[2] ?? 'x') && !put?.url.includes(m?.[2] ?? 'x'), 'the key is not in the request');
  check(!put?.body.includes('p_key') && !link.includes(put?.args.p_token ?? 'x'), 'and neither the key nor the token is sent or shared by mistake');
  check(!link.includes('?'), 'the link has no query string');

  const stored = (await settingsOnDisk(hp)).partnerShare;
  check(stored?.id === m?.[1] && stored?.key === m?.[2] && stored?.token === put?.args.p_token,
    'settings.partnerShare holds the id, key and token');
  check(stored?.helps === HELPS && stored?.choices?.helps === true && stored?.choices?.fertile === false,
    'and her choices and what helps', JSON.stringify(stored?.choices));
  check(stored?.sentAt > 0 && stored?.sentHash?.length > 10, 'and that it was sent');
  check(!('snapshot' in (stored ?? {})), 'but not a copy of the summary');

  const toastText = await hp.locator('#toast-host').innerText();
  check(/Link copied/.test(toastText), 'the link is copied for her', toastText);
  const clip = await hp.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(clip === link, 'and the clipboard holds that link', clip);
  check(await hp.locator('.share-sheet button:has-text("Stop sharing")').count() === 1, 'the sheet now offers Stop sharing');
  check(/Sharing since/.test(await hp.locator('.share-sheet .hint').first().innerText()), 'and says since when');

  await closeSheet(hp);
  await openSettings(hp);
  const row = await hp.locator('button.row:has-text("Share with your partner")').innerText();
  check(/On\./.test(row), 'the Settings row now says On', row);
  const note = await hp.locator('#view-settings .note').last().innerText();
  check(/Only your partner summary leaves this phone/.test(note) && !/Nothing here is sent anywhere/.test(note),
    'and the privacy note changes its wording while sharing', note.slice(0, 120));
  check(/encrypted here first/.test(note), 'saying it is encrypted first');
}

/* ── 3. His phone, not set up ─────────────────────────────────────────── */
console.log('\nhim: opening the link on a phone with no cycle of its own');
const him = await phone({ server, seeded: false, who: 'him', url: link.replace(/^https?:\/\/[^/]+/, ORIGIN) });
const mp = him.page;
{
  const urlAfter = mp.url();
  check(!urlAfter.includes('#partner') && !urlAfter.includes('#'), 'the key is taken out of the address bar', urlAfter);
  check(await mp.evaluate(() => location.hash) === '', 'location.hash is empty');
  const host = mp.locator('#onboarding-root');
  check(await host.isVisible(), 'his page fills the screen');
  check(await mp.locator('#app-root').isHidden(), 'and the app behind it is hidden');
  check(await mp.locator('.onb').count() === 0, 'no onboarding is shown');
  const text = await host.innerText();
  check(text.includes('Sam’s cycle'), 'it says whose cycle it is', text.slice(0, 80));
  check(/^(On Sam’s period|Period likely|Next period in about|Sam’s period is due)/m.test(await mp.locator('.partner-hero-head').innerText()),
    'there is a headline', await mp.locator('.partner-hero-head').innerText());
  check(text.includes('What helps') && text.includes(HELPS), 'what helps, in her words');
  check(text.includes('Next periods (expected)') && await mp.locator('.partner-card li').count() >= 2, 'the next periods');
  check(/Bloating/i.test(text), 'her usual pre-period symptoms');
  check(await mp.locator('.partner-phase').count() === 1 && !/Fertile window/.test(text), 'a phase card, and no fertile window yet');
  check(await mp.locator('button:has-text("Add to my calendar")').count() === 1, 'a button to add the periods to his calendar');
  check(/You only see what Sam chose to share/.test(text), 'and a line on what he can see');
  check(!text.includes('PRIVATE-NOTE') && !/notes|test result|sex/i.test(text.replace(/chose to share/g, '')), 'nothing of her logs');
  check(await mp.locator('button:has-text("Refresh")').count() === 1, 'a Refresh button');
  check(await mp.locator('button:has-text("Track my own cycle too")').count() === 1, 'and a way to track his own cycle');
  check(callCount(server, 'kittycal_get_share') >= 1, 'he fetched the share when it opened');

  const o = await overflow(mp);
  check(o.doc <= 0 && o.body <= 0, 'his page fits a 390px phone', JSON.stringify(o));

  const stored = (await settingsOnDisk(mp)).partnerOf;
  check(stored?.id && stored?.key && stored?.snapshot?.name === 'Sam' && stored?.gone === false, 'the share is remembered on his phone');
  check(stored?.snapshot?.helps === HELPS && !('token' in (stored ?? {})), 'with the summary, and without any token');
  check(!(await settingsOnDisk(mp)).partnerShare, 'he is not sharing anything himself');
}

/* ── 4. Her: a changed choice is sent; an unchanged state is not ──────── */
console.log('\nher: changes are sent, quiet changes are not');
{
  check(await callCount(server, 'kittycal_put_share') === 1, 'one put so far');

  await openShare(hp);
  check(/Last updated/.test(await hp.locator('.share-sheet .hint').first().innerText()), 'the sheet says when it was last updated');
  await hp.locator(`.share-sheet [role="switch"][aria-label="${LABELS.fertile}"]`).click();
  await settle(hp, 200);
  check(await switchState(hp, LABELS.fertile) === 'true', 'she turns the fertile window on');
  check(await callCount(server, 'kittycal_put_share') === 1, 'it is not sent in the same instant: taps are folded together');
  const sent = await until(() => putCount(server) === 2, 6500);
  check(sent, 'a second put goes out within a few seconds', `puts: ${putCount(server)}`);
  const second = server.calls.filter((c) => c.fn === 'kittycal_put_share')[1];
  check(second?.args.p_id === server.calls[0].args.p_id && second?.args.p_token === server.calls[0].args.p_token,
    'for the same share, with the same token');
  check(second?.args.p_blob !== server.calls[0].args.p_blob, 'with a new ciphertext');
  check((await settingsOnDisk(hp)).partnerShare?.choices?.fertile === true, 'and her new choice is saved');

  // Nothing that moves the summary: a theme change is a settings update, but
  // not news for him.
  await closeSheet(hp);
  await openSettings(hp);
  await hp.locator('#view-settings [data-theme="kuromi"]').click();
  await settle(hp, 4800);
  check(putCount(server) === 2, 'a change that leaves the summary the same sends nothing', `puts: ${putCount(server)}`);
  await hp.waitForTimeout(3500);
  check(putCount(server) === 2, 'and nothing is sent later either, after the debounce');
  check(callCount(server, 'kittycal_delete_share') === 0, 'no delete has been called');
}

/* ── 5. Him: Refresh picks up the change ──────────────────────────────── */
console.log('\nhim: refresh');
{
  await mp.locator('button:has-text("Refresh")').click();
  await settle(mp, 1200);
  const text = await mp.locator('#onboarding-root').innerText();
  check(/Fertile window/.test(text), 'Refresh shows the fertile window she has now shared', text.slice(0, 200));
  check(callCount(server, 'kittycal_get_share') >= 2, 'by asking the server again');
  check(!errors.length, 'no page errors so far', errors.join(' | '));

  // "Track my own cycle too" opens onboarding.
  await mp.locator('button:has-text("Track my own cycle too")').click();
  await settle(mp, 800);
  check(await mp.locator('.onb').count() === 1, '"Track my own cycle too" opens onboarding');
  check(await mp.locator('.partner-page').count() === 0, 'in place of his page');
}

/* ── 6. Him, already onboarded ────────────────────────────────────────── */
console.log('\nhim: a phone that already tracks a cycle');
{
  const g = await phone({ server, seeded: true, name: 'Alex', who: 'him-onboarded', url: link.replace(/^https?:\/\/[^/]+/, ORIGIN) });
  const gp = g.page;
  check(await gp.locator('#app-root').isVisible(), 'the app loads normally');
  check(await gp.locator('#onboarding-root').isHidden(), 'with no partner page or onboarding over it');
  check(await sheetOpen(gp), 'and a sheet opens');
  check(await gp.locator('.sheet h2:has-text("Partner view")').count() === 1, 'it is the Partner view');
  const text = await gp.locator('.sheet[data-open="true"]').innerText();
  check(text.includes('Sam’s cycle') && text.includes(HELPS), 'showing her cycle', text.slice(0, 120));
  check(await gp.locator('.sheet button:has-text("Track my own cycle too")').count() === 0, 'with no offer to set up what he already has');
  check(await gp.evaluate(() => location.hash) === '', 'the key is out of the address bar here too');

  await closeSheet(gp);
  await openSettings(gp);
  const row = gp.locator('button.row:has-text("Sam’s cycle")');
  check(await row.count() === 1, 'Settings has a "Sam’s cycle" row');
  check(/Shared with you/.test(await row.innerText()), 'saying it is shared with him');
  const s = await settingsOnDisk(gp);
  check(s.onboarded === true && s.name === 'Alex' && s.partnerOf?.snapshot?.name === 'Sam', 'his own settings are untouched');
  await row.click();
  await settle(gp, 700);
  check(await gp.locator('.sheet h2:has-text("Partner view")').count() === 1, 'and the row reopens the view');
  const o = await overflow(gp);
  check(o.doc <= 0 && o.sheet <= 0, 'which fits a 390px phone', JSON.stringify(o));
  await g.ctx.close();
}

/* ── 7. Her: stop sharing ─────────────────────────────────────────────── */
console.log('\nher: stop sharing');
{
  check(server.rows.size === 1, 'the server holds her share');
  await openShare(hp);
  await hp.locator('.share-sheet button:has-text("Stop sharing")').click();
  await settle(hp, 500);
  check(await hp.locator('.sheet h2:has-text("Stop sharing?")').count() === 1, 'she is asked first');
  // Backing out leaves it all as it was.
  await hp.locator('.sheet button:has-text("Cancel")').click();
  await settle(hp, 700);
  check(callCount(server, 'kittycal_delete_share') === 0 && server.rows.size === 1, 'saying no deletes nothing');
  if (!(await hp.locator('.share-sheet').count())) await openShare(hp);
  await hp.locator('.share-sheet button:has-text("Stop sharing")').click();
  await settle(hp, 500);
  await hp.locator('.sheet button:has-text("Stop sharing")').last().click();
  await settle(hp, 1000);

  check(callCount(server, 'kittycal_delete_share') === 1, 'one delete is sent');
  const del = server.calls.find((c) => c.fn === 'kittycal_delete_share');
  const put = server.calls.find((c) => c.fn === 'kittycal_put_share');
  check(del?.args.p_id === put?.args.p_id && del?.args.p_token === put?.args.p_token, 'with her id and token');
  check(server.rows.size === 0, 'and the server no longer holds it');
  check((await settingsOnDisk(hp)).partnerShare === null, 'partnerShare is cleared');
  await closeSheet(hp);
  await openSettings(hp);
  const row = await hp.locator('button.row:has-text("Share with your partner")').innerText();
  check(!/On\./.test(row) && /Let someone see/.test(row), 'the Settings row offers sharing again', row);
  check(/Nothing here is sent anywhere/.test(await hp.locator('#view-settings .note').last().innerText()),
    'and the privacy note goes back to its first wording');
  const before = server.calls.length;
  await hp.waitForTimeout(3600);
  check(server.calls.length === before, 'nothing more is sent once she has stopped');
}

/* ── 8. Him: after she stopped ────────────────────────────────────────── */
console.log('\nhim: after she stopped');
{
  // His phone is back at onboarding (he chose to track his own); open the link again.
  const again = await phone({ server, seeded: false, who: 'him-again', url: link.replace(/^https?:\/\/[^/]+/, ORIGIN) });
  const ap = again.page;
  const text = await ap.locator('#onboarding-root').innerText();
  check(/has stopped sharing/.test(text), 'a link opened after she stopped says she has stopped sharing', text.slice(0, 120));
  check(await ap.locator('button:has-text("Remove from this phone")').count() === 1, 'with a way to remove it');
  await again.ctx.close();
}
{
  // A phone that opened the link while she was still sharing, then refreshes.
  const s2 = newServer();
  const a = await phone({ server: s2, who: 'her-2', name: 'Robin', extra: {} });
  await openShare(a.page);
  await a.page.locator('button:has-text("Create the link")').click();
  await settle(a.page, 1500);
  const l2 = await a.page.locator('.share-link input').inputValue();
  const b = await phone({ server: s2, seeded: false, who: 'him-2', url: l2.replace(/^https?:\/\/[^/]+/, ORIGIN) });
  check((await b.page.locator('#onboarding-root').innerText()).includes('Robin’s cycle'), 'a second pair of phones works too');
  check(await b.page.locator('button:has-text("Refresh")').count() === 1, 'he has Refresh while she shares');
  await closeSheet(a.page);
  await openShare(a.page);
  await a.page.locator('.share-sheet button:has-text("Stop sharing")').click();
  await settle(a.page, 500);
  await a.page.locator('.sheet button:has-text("Stop sharing")').last().click();
  await settle(a.page, 900);
  await b.page.locator('button:has-text("Refresh")').click();
  await settle(b.page, 1200);
  const text = await b.page.locator('#onboarding-root').innerText();
  check(/Robin has stopped sharing/.test(text), 'his Refresh shows "has stopped sharing"', text.slice(0, 160));
  check(await b.page.locator('button:has-text("Refresh")').count() === 0, 'and Refresh goes away');
  check((await settingsOnDisk(b.page)).partnerOf?.gone === true, 'it is remembered as gone');
  // Removing it leaves him on onboarding, since he has nothing else here.
  await b.page.locator('button:has-text("Remove from this phone")').click();
  await settle(b.page, 800);
  check(await b.page.locator('.onb').count() === 1, 'removing it takes him to onboarding');
  check(!(await settingsOnDisk(b.page)).partnerOf, 'and clears the share');
  await a.ctx.close();
  await b.ctx.close();
}

/* ── 9. Server unreachable on create ──────────────────────────────────── */
console.log('\nher: the server is unreachable');
{
  const down = newServer();
  down.down = true;
  const d = await phone({ server: down, who: 'her-down' });
  await openShare(d.page);
  await d.page.locator('button:has-text("Create the link")').click();
  await settle(d.page, 1200);
  const toastText = await d.page.locator('#toast-host').innerText();
  check(/Couldn’t reach the server/.test(toastText), 'she sees the "Couldn’t reach the server" toast', toastText);
  check(callCount(down, 'kittycal_put_share') === 1, 'one attempt was made');
  check((await settingsOnDisk(d.page)).partnerShare === null, 'partnerShare is not stored');
  check(await d.page.locator('.share-link input').count() === 0, 'no link is shown');
  check(await d.page.locator('button:has-text("Create the link")').isEnabled(), 'and she can try again');
  check(down.rows.size === 0, 'nothing is on the server');

  // Back online: trying again works, and the first failure left no mess behind.
  down.down = false;
  await d.page.locator('button:has-text("Create the link")').click();
  await settle(d.page, 1500);
  check(await d.page.locator('.share-link input').count() === 1 && down.rows.size === 1, 'once the server is back, creating the link works');
  check(!!(await settingsOnDisk(d.page)).partnerShare?.sentAt, 'and is stored as sent');

  // Stopping while offline: she is told, and stays shared, rather than being
  // left thinking it has stopped.
  down.down = true;
  await closeSheet(d.page);
  await openShare(d.page);
  await d.page.locator('.share-sheet button:has-text("Stop sharing")').click();
  await settle(d.page, 500);
  await d.page.locator('.sheet button:has-text("Stop sharing")').last().click();
  await settle(d.page, 1000);
  check(/Couldn’t reach the server/.test(await d.page.locator('#toast-host').innerText()), 'stopping while offline says it could not reach the server');
  check(!!(await settingsOnDisk(d.page)).partnerShare, 'and she is still shown as sharing');
  check(down.rows.size === 1, 'because the server still has it');
  await d.ctx.close();
}

/* ── 10. The privacy promise ──────────────────────────────────────────── */
console.log('\nwithout sharing, nothing leaves the phone');
{
  const quiet = newServer();
  const q = await phone({ server: quiet, who: 'quiet' });
  const qp = q.page;
  const offOrigin = [];
  qp.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return;
    if (new URL(url).origin !== ORIGIN) offOrigin.push(url);
  });
  for (const tab of ['calendar', 'insights', 'settings', 'today']) {
    await qp.locator(`[data-tab="${tab}"]`).click();
    await settle(qp, 450);
  }
  await qp.locator('[data-tab="settings"]').click();
  await settle(qp, 400);
  // The share sheet, with everything toggled and previewed, but never created.
  await qp.locator('button.row:has-text("Share with your partner")').click();
  await settle(qp, 600);
  await qp.locator(`.share-sheet [role="switch"][aria-label="${LABELS.fertile}"]`).click();
  await qp.locator(`.share-sheet [role="switch"][aria-label="${LABELS.mood}"]`).click();
  await qp.locator('.share-preview summary').click();
  await settle(qp, 500);
  await closeSheet(qp);
  await qp.locator('[data-tab="today"]').click();
  await settle(qp, 400);
  await qp.waitForTimeout(4500); // longer than the send debounce
  check(offOrigin.length === 0, 'no request to any other host', offOrigin.join(', '));
  check(quiet.calls.length === 0, 'and none to Supabase in particular', quiet.calls.map((c) => c.fn).join(','));
  check((await settingsOnDisk(qp)).partnerShare == null, 'and nothing is shared');
  await q.ctx.close();
}

/* ── 11. Layout and dark mode ─────────────────────────────────────────── */
console.log('\nhis page in the dark');
{
  const dark = newServer();
  const a = await phone({ server: dark, who: 'her-dark', scheme: 'dark' });
  await openShare(a.page);
  await a.page.locator('button:has-text("Create the link")').click();
  await settle(a.page, 1500);
  const l = await a.page.locator('.share-link input').inputValue();
  const o1 = await overflow(a.page);
  check(o1.doc <= 0 && o1.sheet <= 0, 'her sheet fits in the dark, with the link showing', JSON.stringify(o1));

  const b = await phone({ server: dark, seeded: false, who: 'him-dark', scheme: 'dark', url: l.replace(/^https?:\/\/[^/]+/, ORIGIN) });
  const bp = b.page;
  check((await bp.locator('#onboarding-root').innerText()).includes('Sam’s cycle'), 'his page renders');
  const colours = await bp.evaluate(() => {
    // Colours here are oklch(); a canvas turns any CSS colour into sRGB.
    const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const parse = (c) => {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = '#000';
      cx.fillStyle = c;
      cx.fillRect(0, 0, 1, 1);
      return [...cx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const lum = ([r, g, b]) => {
      const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    /** The first opaque background up the tree. */
    const bgOf = (node) => {
      for (let n = node; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return parse(c);
      }
      return [255, 255, 255];
    };
    const out = {};
    for (const sel of ['.partner-title', '.partner-hero-head', '.partner-card p', '.partner-card li', '.partner-foot']) {
      const node = document.querySelector(sel);
      if (!node) { out[sel] = null; continue; }
      const fg = parse(getComputedStyle(node).color);
      out[sel] = Math.round(ratio(lum(fg), lum(bgOf(node))) * 10) / 10;
    }
    return { mode: document.documentElement.dataset.mode, page: lum(bgOf(document.querySelector('.partner-page'))), ratios: out };
  });
  check(colours.mode === 'dark', 'the app is in dark mode', colours.mode);
  check(colours.page < 0.2, 'the page background is dark', String(colours.page));
  const bad = Object.entries(colours.ratios).filter(([, r]) => r !== null && r < 4.5);
  check(bad.length === 0, 'text on it has at least 4.5:1 contrast', JSON.stringify(colours.ratios));
  const o2 = await overflow(bp);
  check(o2.doc <= 0 && o2.body <= 0, 'and fits a 390px phone', JSON.stringify(o2));
  await a.ctx.close();
  await b.ctx.close();
}

/* ── Report ───────────────────────────────────────────────────────────── */
check(errors.length === 0, 'no page errors anywhere', errors.join(' | '));

await her.ctx.close();
await him.ctx.close();
await browser.close();

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
