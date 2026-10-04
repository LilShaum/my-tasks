/**
 * foryou.mjs — "For you today", in a real browser.
 *
 * After the last check-in answer, if there is something worth knowing that she
 * has not just been told, the sheet turns into "All logged!" with up to three
 * moments and a "See you tomorrow" button. When there is nothing, the sheet
 * closes exactly as it always did. Today carries one "For you" card that
 * never repeats what the check-in has just said.
 *
 *   - Two days before a period, with four complete cycles behind her, the
 *     check-in ends with "likely in 2 days"; the ids are remembered, so the
 *     same check-in again says nothing more.
 *   - A brand-new user and a check-in for a past day never see the screen.
 *   - Today shows exactly one card; "Not useful" hides that moment for good.
 *   - A moment with somewhere to go opens Insights at the right card.
 *   - Nothing throws, and nothing is wider than a 390px phone.
 *
 * Run: node test/run-browser.mjs foryou
 */

import { launchChromium } from './browser.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8099';

let checks = 0;
let failures = 0;
const check = (cond, label, extra = '') => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

/**
 * Four complete 28-day cycles and a current one that started `ago` days ago
 * (so the next period is due in 28 - ago days). Bloating the three days before
 * every period, cramps on its first two days, a headache every third day, and
 * heavier flow at the start of each period. With `ago: 0` or no `cycles`, a
 * person with nothing to find.
 *
 * Options
 *   cycles      number of complete cycles to seed (default 4; 0 = none)
 *   checkedIn   seed today as already checked in, so the sheet does not open
 *   missing     day offsets (negative) whose logs are left out: missed days
 *   seen        forYouSeen as { id: offset }, resolved to dates in the page
 *   dismissed   forYouDismissed
 */
const seed = async ({ ago, cycles = 4, checkedIn = false, missing = [], seen = {}, dismissed = [] }) => {
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
  const starts = cycles ? Array.from({ length: cycles + 1 }, (_, k) => -ago - 28 * k) : [];
  const periodDays = [];
  for (const s of starts) for (let i = 0; i < 5; i += 1) if (s + i <= 0) periodDays.push(shift(s + i));
  /** @type {Record<string, any>} */
  const logs = {};
  const blank = (date) => ({ date, flow: 'none', symptoms: [], moods: [], discharge: [], activity: [],
    other: [], sex: [], custom: [], severity: {}, notes: '', checkedIn: true });
  for (let n = -ago - 28 * cycles; n < 0; n += 1) {
    if (!starts.length) break;
    const s = Math.max(...starts.filter((x) => x <= n));
    const day = n - s + 1;
    const until = s + 28 - n;
    const log = blank(shift(n));
    if (day <= 5) log.flow = ['heavy', 'heavy', 'medium', 'light', 'light'][day - 1];
    if (day <= 2) log.symptoms.push('cramps');
    if (until <= 3) log.symptoms.push('bloating');
    if (n % 3 === 0) log.symptoms.push('headache');
    logs[log.date] = log;
  }
  for (const off of missing) delete logs[shift(off)];
  if (checkedIn) logs[shift(0)] = blank(shift(0));

  const forYouSeen = {};
  for (const [id, off] of Object.entries(seen)) forYouSeen[id] = shift(off);

  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme: 'hellokitty', onboarded: true, disclaimerAck: true, avgCycleLength: 28,
      avgPeriodLength: 5, askSleep: false, askWater: false,
      lastBackup: shift(0), lastBackupAt: Date.now(), forYouSeen, forYouDismissed: dismissed,
    } });
    tx.objectStore('meta').put({ key: 'periodDays', value: periodDays });
    for (const log of Object.values(logs)) tx.objectStore('logs').put(log);
    tx.oncomplete = () => res(undefined);
  });
};

const browser = await launchChromium();

/** @returns {Promise<{ctx: any, page: any, errors: string[]}>} */
async function open(opts) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(seed, opts);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  return { ctx, page, errors };
}

const sheetOpen = (page) => page.locator('.sheet[data-open="true"]').count().then((n) => n > 0);
const title = (page) => page.locator('.checkin-title').first().innerText().catch(() => '');
const itemTexts = (page) => page.$$eval('.foryou-item .foryou-text', (n) => n.map((e) => e.textContent ?? ''));
const wider = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

/** The settings as saved on disk, not as held in memory. */
const settingsOnDisk = (page) => page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('kittycal', 1); r.onsuccess = () => res(r.result);
  });
  return new Promise((res) => {
    const g = db.transaction(['meta'], 'readonly').objectStore('meta').get('settings');
    g.onsuccess = () => res(g.result?.value ?? null);
  });
});

/** Open today's check-in if it did not open by itself. */
async function ensureCheckin(page) {
  if (!(await page.locator('.checkin-title').count())) {
    await page.locator('button:has-text("Check in for today")').click();
    await page.waitForTimeout(600);
  }
}

/**
 * Answer the three default questions with nothing to report: bleeding none,
 * mood Next, symptoms Next (Done). Then give the sheet time to turn into the
 * "For you" screen or to close.
 */
async function answer(page) {
  await page.locator('.checkin-option[data-opt="none"]').click();
  await page.waitForTimeout(300);
  await page.locator('.checkin-next').click();
  await page.waitForTimeout(300);
  await page.locator('.checkin-next').click();
  await page.waitForTimeout(1200);
}

/* ── 1. Two days before her period ──────────────────────────────────────── */
console.log('\ntwo days before her period, four cycles behind her');
let shownIds = {};
{
  const { ctx, page, errors } = await open({ ago: 26 });
  await ensureCheckin(page);
  await answer(page);

  check(await sheetOpen(page), 'the sheet stays open after the last answer');
  check(await title(page) === 'All logged!', 'and says "All logged!"', await title(page));
  const items = await itemTexts(page);
  check(items.length >= 1 && items.length <= 3, 'with one to three moments', String(items.length));
  check(items.some((t) => /likely in 2 days/.test(t)),
    'one of them says the period is likely in 2 days', JSON.stringify(items));
  check(await page.locator('.foryou-item').count() === items.length, 'every moment is a .foryou-item');
  check(await page.locator('.checkin-next', { hasText: 'See you tomorrow' }).count() === 1,
    'the way out is "See you tomorrow"');
  check(!(await wider(page)), 'nothing is wider than the phone');
  const sheetWide = await page.evaluate(() => {
    const s = document.querySelector('.sheet');
    return s ? s.scrollWidth > s.clientWidth + 1 : false;
  });
  check(!sheetWide, 'and the sheet does not scroll sideways');

  const saved = await settingsOnDisk(page);
  const ids = Object.keys(saved?.forYouSeen ?? {});
  check(ids.length === items.length, 'forYouSeen holds exactly the moments shown',
    `${ids.length} ids for ${items.length} items`);
  check(ids.some((id) => id.startsWith('soon:')) && ids.every((id) => saved.forYouSeen[id] === saved.forYouSeen[ids[0]]),
    'including the "soon" one, all stamped with today', JSON.stringify(saved?.forYouSeen));
  shownIds = saved?.forYouSeen ?? {};

  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  check(Object.values(shownIds).every((d) => d === today), 'and the stamp is today’s date', JSON.stringify(shownIds));

  await page.locator('.checkin-next', { hasText: 'See you tomorrow' }).click();
  await page.waitForTimeout(700);
  check(!(await sheetOpen(page)), '"See you tomorrow" closes the sheet');
  check(await page.locator('.checkin-step').count() === 0, 'and nothing of the check-in is left');
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

/* ── 2. Already said ───────────────────────────────────────────────────── */
/*
  Two days out, the engine has four things to say: the period, the heads-up
  about bloating, and two new findings. A check-in shows at most three, so the
  fourth waits for the next one; a fifth check-in has nothing left.
*/
console.log('\nthe same check-in again, with what was said remembered');
{
  const idsOf = (saved) => Object.keys(saved?.forYouSeen ?? {});
  const sayings = [];
  /** @type {Record<string, number>} */
  let seen = {};
  for (let round = 1; round <= 3; round += 1) {
    const { ctx, page, errors } = await open({ ago: 26, seen });
    await ensureCheckin(page);
    await answer(page);
    const items = await itemTexts(page);
    sayings.push(items);
    const open_ = await sheetOpen(page);
    const saved = await settingsOnDisk(page);
    if (round === 1) {
      check(items.length === 3, 'first time: the three strongest are shown', JSON.stringify(items));
    } else if (round === 2) {
      check(items.length === 1 && /heaviest/.test(items[0]),
        'next time, with those three remembered: only the one that was waiting', JSON.stringify(items));
      check(!items.some((t) => sayings[0].includes(t)), 'none of the first three again');
      check(idsOf(saved).length === 4, 'and it is remembered too', JSON.stringify(idsOf(saved)));
    } else {
      check(items.length === 0 && !open_,
        'after that, nothing is fresh: the check-in closes straight away', JSON.stringify(items));
      check(!(await page.locator('.checkin-title', { hasText: 'All logged!' }).count()), 'with no "All logged!"');
      check(idsOf(saved).length === 4, 'and nothing new is remembered', JSON.stringify(idsOf(saved)));
    }
    check(errors.length === 0, `round ${round}: no page errors`, errors.join(' | '));
    seen = Object.fromEntries(idsOf(saved).map((id) => [id, 0]));
    await ctx.close();
  }
}

/* ── 3. Partly said: only what is new is shown ──────────────────────────── */
console.log('\nthe period moment was said earlier today, the rest was not');
{
  const soon = Object.keys(shownIds).find((id) => id.startsWith('soon:'));
  const { ctx, page, errors } = await open({ ago: 26, seen: soon ? { [soon]: 0 } : {} });
  await ensureCheckin(page);
  await answer(page);
  const items = await itemTexts(page);
  check(soon !== undefined, 'the first run recorded a "soon" id to reuse', JSON.stringify(shownIds));
  check(!items.some((t) => /likely in 2 days/.test(t)),
    '"likely in 2 days" is not said twice on the same day', JSON.stringify(items));
  check(items.length === 2 && (await title(page)) === 'All logged!',
    'the others are still shown (a new finding and the bloating heads-up)', JSON.stringify(items));
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

/* ── 4. A brand-new user ────────────────────────────────────────────────── */
console.log('\na brand-new user, no history at all');
{
  const { ctx, page, errors } = await open({ ago: 0, cycles: 0 });
  await ensureCheckin(page);
  check(await page.locator('.checkin-title').count() > 0, 'the check-in opens');
  await answer(page);
  check(!(await sheetOpen(page)), 'it closes straight after the last answer');
  check(!(await page.locator('.checkin-title', { hasText: 'All logged!' }).count()), 'with no "All logged!"');
  check(await page.locator('.foryou-item').count() === 0, 'and no moments');
  const saved = await settingsOnDisk(page);
  check(Object.keys(saved?.forYouSeen ?? {}).length === 0, 'nothing is remembered as said');
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

/* ── 5. A day she missed ────────────────────────────────────────────────── */
console.log('\ncatching up on a missed day');
{
  const { ctx, page, errors } = await open({ ago: 26, checkedIn: true, missing: [-2] });
  check(!(await sheetOpen(page)), 'today is already done, so nothing opens by itself');
  const missed = page.locator('.week-day.is-missed').first();
  check(await missed.count() === 1, 'the week strip offers the missed day');
  await missed.click();
  await page.waitForTimeout(700);
  check(await page.locator('.checkin-title').count() > 0, 'its check-in opens');
  await answer(page);
  check(!(await sheetOpen(page)), 'it closes after the last answer');
  check(!(await page.locator('.checkin-title', { hasText: 'All logged!' }).count()),
    'and never shows "All logged!" for a past day');
  const saved = await settingsOnDisk(page);
  check(Object.keys(saved?.forYouSeen ?? {}).length === 0,
    'and does not use up moments meant for today', JSON.stringify(saved?.forYouSeen));
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

/* ── 6. The card on Today ───────────────────────────────────────────────── */
console.log('\nthe "For you" card on Today');
{
  const { ctx, page, errors } = await open({ ago: 26, checkedIn: true });
  check(await page.locator('.foryou-card').count() === 1, 'exactly one card');
  const text = (await page.locator('.foryou-card .foryou-text').innerText()).trim();
  check(text.length > 20, 'with something to say', text);
  check(!/likely in 2 days|likely tomorrow|any day now/.test(text),
    'which is not the timing the cards above already give', text);
  check(await page.locator('.foryou-card button:has-text("Not useful")').count() === 1, 'and a "Not useful" button');
  check(await page.locator('.foryou-card button:has-text("See it in Insights")').count() === 1,
    'and a way into Insights, because this moment has a place there');
  check(!(await wider(page)), 'it fits a 390px screen');

  await page.locator('.foryou-card button:has-text("Not useful")').click();
  await page.waitForTimeout(700);
  const saved = await settingsOnDisk(page);
  const dismissed = saved?.forYouDismissed ?? [];
  check(dismissed.length === 1, 'tapping it stores one id in forYouDismissed', JSON.stringify(dismissed));
  check(/^(finding|usual|water|sleepdip|tip):/.test(dismissed[0] ?? ''),
    'which is the moment’s own id', dismissed[0] ?? '');
  const count = await page.locator('.foryou-card').count();
  const after = count ? (await page.locator('.foryou-card .foryou-text').innerText()).trim() : '';
  check(count <= 1, 'there is still at most one card', String(count));
  check(after !== text && /day 1 of your period is usually the heaviest/.test(after),
    'and it is the next one, not the moment she just dismissed', after);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const again = await page.locator('.foryou-card .foryou-text').first().innerText().catch(() => '');
  check(again.trim() !== text, 'it stays dismissed after a reload', again);
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

/* ── 7. What the check-in said is not repeated on Today ─────────────────── */
console.log('\nthe check-in and the card do not say the same thing');
{
  const { ctx, page, errors } = await open({ ago: 26 });
  await ensureCheckin(page);
  await answer(page);
  const said = await itemTexts(page);
  await page.locator('.checkin-next', { hasText: 'See you tomorrow' }).click();
  await page.waitForTimeout(700);
  const count = await page.locator('.foryou-card').count();
  check(count === 1, 'Today shows exactly one card', String(count));
  const card = count ? (await page.locator('.foryou-card .foryou-text').innerText()).trim() : '';
  check(/day 1 of your period is usually the heaviest/.test(card),
    'the one the check-in did not have room for', card);
  check(!said.some((t) => t.trim() === card),
    'and it is none of the moments the check-in just showed', JSON.stringify({ said, card }));
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

/* ── 8. A moment with somewhere to go ───────────────────────────────────── */
console.log('\ntapping a moment that has an anchor');
{
  const { ctx, page, errors } = await open({ ago: 26 });
  await ensureCheckin(page);
  await answer(page);
  const buttons = await page.locator('button.foryou-item').count();
  check(buttons >= 1, 'at least one moment is a button, because it has a place in Insights', String(buttons));
  const label = await page.locator('button.foryou-item .foryou-text').first().innerText();
  const plain = await page.locator('div.foryou-item').count();
  check(plain >= 1, 'and a moment without a place (the period) is not a button', String(plain));
  await page.locator('button.foryou-item').first().click();
  await page.waitForTimeout(900);

  check(!(await sheetOpen(page)), 'the sheet closes');
  check(await page.locator('[data-tab="insights"][aria-selected="true"]').count() === 1, 'Insights is now the selected tab');
  check(await page.locator('#view-insights:not([hidden])').count() === 1, 'and its view is showing');
  const target = await page.evaluate(() => {
    const ids = ['insight-body', 'insight-sleep', 'insight-pairs', 'insight-mood', 'insight-periods'];
    return ids.filter((id) => document.getElementById(id));
  });
  check(target.includes('insight-body'), 'the card it points at exists', `${label} -> ${JSON.stringify(target)}`);
  const inView = await page.evaluate(() => {
    const r = document.getElementById('insight-body')?.getBoundingClientRect();
    return r ? r.top < window.innerHeight && r.bottom > 0 : false;
  });
  check(inView, 'and has been scrolled into view');
  check(!(await wider(page)), 'Insights fits a 390px screen');
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`\nfor you: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
