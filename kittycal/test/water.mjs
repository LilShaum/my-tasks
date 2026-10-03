/**
 * water.mjs — can she add a glass of water without leaving Today?
 *
 * The check-in asks about water once. The rest of the day she drinks more, and
 * the only way to say so used to be the full diary, four taps deep. So Today
 * carries a one-row strip: what she has had, a minus and a plus.
 *
 * What this guards:
 *
 *   1. The strip is there by default and gone when she turns water off.
 *   2. Plus adds one glass of whatever size she chose, minus takes one away,
 *      minus is disabled at zero, and nothing caps the total.
 *   3. Water is not an answer. Adding it must not mark the day as checked in:
 *      the check-in is still offered and the week strip does not tick today.
 *   4. The row does not overflow a 320px screen, and focus stays on the button
 *      she just tapped even though the whole view is rebuilt under it.
 *   5. The line under the check-in button counts the questions it will ask.
 *
 * Run: npm run test:browser -- water
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

/** Six tidy cycles so Today has a ring, plus whatever settings the case needs. */
const seed = async ({ settings, log }) => {
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
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  const days = [];
  for (let c = 0; c < 6; c += 1) {
    for (let i = 0; i < 5; i += 1) {
      const d = new Date(now);
      d.setDate(d.getDate() - (c * 28 + (14 - i)));
      days.push(key(d));
    }
  }
  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme: 'hellokitty', onboarded: true, disclaimerAck: true, avgCycleLength: 28,
      avgPeriodLength: 5, name: 'Sam', showFertility: true, mode: 'cycle', ...settings,
    } });
    tx.objectStore('meta').put({ key: 'periodDays', value: days });
    if (log) tx.objectStore('logs').put({
      date: key(now), symptoms: [], moods: [], discharge: [], activity: [],
      other: [], sex: [], custom: [], ...log,
    });
    tx.oncomplete = () => res(undefined);
  });
};

const browser = await launchChromium();

async function open({ settings = {}, log = null, width = 390 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(seed, { settings, log });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1700);
  // The first launch of a day asks for the check-in on its own; dismiss it.
  if (await page.locator('.sheet[data-open="true"]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
  }
  return { ctx, page };
}

const stripText = (page) => page.evaluate(() =>
  (document.querySelector('.water-strip')?.innerText ?? '').replace(/\s+/g, ' ').trim());

/** What is on disk for today's water, after giving the debounced write time. */
const storedWater = async (page) => {
  await page.waitForTimeout(700);
  return page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('kittycal', 1);
    r.onsuccess = () => {
      const all = r.result.transaction('logs').objectStore('logs').getAll();
      all.onsuccess = () => {
        const d = new Date();
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const row = all.result.find((l) => l.date === k);
        res(row ? { water: row.water, checkedIn: !!row.checkedIn } : null);
      };
    };
  }));
};

const tap = async (page, which) => {
  await page.locator(`.water-strip [data-water="${which}"]`).click();
  await page.waitForTimeout(350);
};

const focusedWater = (page) => page.evaluate(() =>
  document.activeElement?.dataset?.water ?? document.activeElement?.tagName);

console.log('\nthe strip is there by default, and gone when water is off');
{
  const { ctx, page } = await open();
  check(await page.locator('.water-strip').count() === 1, 'shown by default');
  check(/Water today/.test(await stripText(page)) && /None yet/.test(await stripText(page)),
    'says "Water today" and "None yet" before any water', await stripText(page));
  const order = await page.evaluate(() => {
    const strip = document.querySelector('.water-strip');
    const week = document.querySelector('.week-strip');
    return !!(strip && week && week.nextElementSibling === strip);
  });
  check(order, 'sits directly under the week strip');
  check(!/—/.test(await stripText(page)), 'no em dash in its text');
  await ctx.close();
}
{
  const { ctx, page } = await open({ settings: { askWater: false } });
  check(await page.locator('.water-strip').count() === 0, 'hidden when "Ask about water" is off');
  await ctx.close();
}

console.log('\nplus and minus');
{
  const { ctx, page } = await open();
  const minus = page.locator('.water-strip [data-water="remove"]');
  const plus = page.locator('.water-strip [data-water="add"]');

  check(await minus.isDisabled(), 'minus is disabled at zero');
  check((await plus.innerText()).trim() === '+ Glass', 'the add button is labelled "+ Glass"',
    await plus.innerText());
  check(await plus.getAttribute('aria-label') === 'Add a glass of water', 'with an accessible name');
  check(await minus.getAttribute('aria-label') === 'Remove a glass of water', 'and so does minus');

  await tap(page, 'add');
  check(/250 ml/.test(await stripText(page)) && /1 glass\b/.test(await stripText(page))
    && !/1 glasses/.test(await stripText(page)),
  'one tap shows 250 ml and "1 glass"', await stripText(page));
  check(await focusedWater(page) === 'add',
    'focus is still on the add button after the view re-renders', String(await focusedWater(page)));
  const one = await storedWater(page);
  check(one?.water === 250, 'and 250 ml is stored', JSON.stringify(one));
  check(one?.checkedIn === false, 'without marking the day as checked in', JSON.stringify(one));

  await tap(page, 'add');
  await tap(page, 'add');
  check(/750 ml/.test(await stripText(page)) && /3 glasses/.test(await stripText(page)),
    'three taps show 750 ml and "3 glasses"', await stripText(page));

  check(!(await minus.isDisabled()), 'minus is enabled once there is water');
  await tap(page, 'remove');
  check(/500 ml/.test(await stripText(page)) && /2 glasses/.test(await stripText(page)),
    'minus removes one glass', await stripText(page));
  check((await storedWater(page))?.water === 500, 'and the stored amount follows');

  await tap(page, 'remove');
  await tap(page, 'remove');
  check(/None yet/.test(await stripText(page)), 'back to "None yet" at zero', await stripText(page));
  check(await page.locator('.water-strip [data-water="remove"]').isDisabled(),
    'minus is disabled again at zero');
  check(await focusedWater(page) === 'add',
    'focus moves to add when minus disables itself, not to the page', String(await focusedWater(page)));
  await ctx.close();
}

console.log('\nno cap');
{
  const { ctx, page } = await open();
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await tap(page, 'add');
  }
  check(/2\.5 L/.test(await stripText(page)) && /10 glasses/.test(await stripText(page)),
    'ten glasses keeps counting past eight', await stripText(page));
  await ctx.close();
}

console.log('\na bigger glass');
{
  const { ctx, page } = await open({ settings: { glassMl: 500 } });
  const plus = page.locator('.water-strip [data-water="add"]');
  check(/Bottle/.test(await plus.innerText()), 'the add button says Bottle', await plus.innerText());
  await tap(page, 'add');
  check((await storedWater(page))?.water === 500, 'and adds 500 ml');
  check(/500 ml/.test(await stripText(page)) && /1 bottle\b/.test(await stripText(page)),
    'shown as 500 ml and "1 bottle"', await stripText(page));
  await ctx.close();
}

console.log('\nwater is not an answer');
{
  const { ctx, page } = await open();
  await tap(page, 'add');
  const today = await page.evaluate(() =>
    (document.querySelector('#view-today')?.innerText ?? '').replace(/\s+/g, ' '));
  check(await page.locator('#view-today button:has-text("Check in for today")').count() === 1,
    '"Check in for today" is still offered after adding water');
  check(!/Logged today/.test(today), 'and today is not described as logged');
  const mark = await page.evaluate(() =>
    document.querySelector('.week-day.is-today .week-day-mark')?.textContent?.trim() ?? null);
  check(mark === '', 'the week strip does not tick today', JSON.stringify(mark));
  const todayCls = await page.evaluate(() => document.querySelector('.week-day.is-today')?.className ?? '');
  check(/is-missed/.test(todayCls) && !/is-logged/.test(todayCls),
    'it is still drawn as not yet logged', todayCls);

  // Tapping it opens the check-in rather than the diary.
  await page.locator('.week-day.is-today').click();
  await page.waitForTimeout(700);
  check(await page.locator('.checkin-title').count() === 1, 'tapping today opens the check-in');
  await page.keyboard.press('Escape');
  await ctx.close();
}
{
  // A day that was checked in is a logged day, with or without water.
  const { ctx, page } = await open({ log: { checkedIn: true, water: 500 } });
  const mark = await page.evaluate(() =>
    document.querySelector('.week-day.is-today .week-day-mark')?.textContent?.trim() ?? null);
  check(mark === '✓', 'a checked-in day with water is ticked', JSON.stringify(mark));
  check(await page.locator('#view-today button:has-text("Check in for today")').count() === 0,
    'and no longer asks for the check-in');
  await ctx.close();
}

console.log('\nthe copy under the check-in button counts the questions');
{
  const { ctx, page } = await open();
  const copy = await page.locator('.log-cta-summary').innerText();
  check(/^Five quick questions/.test(copy), 'five with the defaults', copy);
  check(!/—/.test(copy), 'and has no em dash');
  await ctx.close();
}
{
  const { ctx, page } = await open({ settings: { askSleep: false, askWater: false } });
  const copy = await page.locator('.log-cta-summary').innerText();
  check(/^Three quick questions/.test(copy), 'three with sleep and water off', copy);
  await ctx.close();
}

console.log('\nthe narrowest phone');
{
  const { ctx, page } = await open({ width: 320, settings: { glassMl: 200 } });
  await tap(page, 'add');
  await tap(page, 'add');
  const m = await page.evaluate(() => {
    const strip = document.querySelector('.water-strip');
    const box = strip?.getBoundingClientRect();
    const btns = [...document.querySelectorAll('.water-btn')].map((b) => {
      const r = b.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      right: box ? box.right : null,
      vw: document.documentElement.clientWidth,
      stripOverflow: strip ? strip.scrollWidth - strip.clientWidth : null,
      btns,
    };
  });
  check(m.page <= 0, 'the page does not scroll sideways at 320px', JSON.stringify(m));
  check(m.right != null && m.right <= m.vw && m.stripOverflow <= 0,
    'the strip fits inside the screen', JSON.stringify(m));
  check(m.btns.length === 2 && m.btns.every((b) => b.w >= 44 && b.h >= 44),
    'both buttons are at least 44px', JSON.stringify(m.btns));
  await ctx.close();
}

await browser.close();
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
