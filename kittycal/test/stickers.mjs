/**
 * stickers.mjs — the sticker book on screen.
 *
 * The domain tests prove the derivation. What they cannot see is whether the
 * fourteen slots actually render, whether an earned one is distinguishable
 * from an empty one without relying on colour, and — the part that matters
 * most — whether earning one is ever mentioned to her. A collection nobody is
 * told about is a collection that does not exist.
 *
 * Run: node test/stickers.mjs   (with a static server on 8099)
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = 'http://127.0.0.1:8099/';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let checks = 0;
let failures = 0;

const check = (cond, label, extra = '') => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

const browser = await pw.chromium.launch({ executablePath: CHROME });

/** @param {(p: import('playwright').Page) => Promise<void>} fn */
async function withPage(fn) {
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    failures += 1;
    console.error(`  FAIL  uncaught page error — ${e.message}`);
  });
  try { await fn(page); } finally { await context.close(); }
}

/**
 * An onboarded user with `days` consecutive logs behind her.
 * @param {import('playwright').Page} page
 */
function seed(page, days) {
  return page.evaluate(async (days) => {
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
    const { emptyLog } = await import('/js/domain/model.js');
    const pad = (n) => String(n).padStart(2, '0');
    const shift = (n) => {
      const d = new Date(); d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    await new Promise((res) => {
      const tx = db.transaction(['meta', 'logs'], 'readwrite');
      for (let i = 1; i <= days; i += 1) {
        tx.objectStore('logs').put({ ...emptyLog(shift(-i)), checkedIn: true });
      }
      tx.objectStore('meta').put({ key: 'settings', value: {
        theme: 'hellokitty', onboarded: true, disclaimerAck: true,
        avgCycleLength: 28, avgPeriodLength: 5, name: 'Sam',
        lastBackup: shift(0), lastBackupAt: Date.now(),
      } });
      tx.objectStore('meta').put({ key: 'periodDays', value: [] });
      tx.oncomplete = () => res(undefined);
    });
  }, days);
}

/** @param {import('playwright').Page} p */
async function openBook(p) {
  // Today is unlogged in these fixtures, so the check-in opens by itself and
  // sits over the tab bar. Getting past it is part of the journey.
  if (await p.locator('.sheet[data-open="true"]').count()) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  }
  await p.locator('[data-tab="settings"]').click();
  await p.waitForTimeout(500);
  await p.locator('.row', { hasText: 'Sticker book' }).click();
  await p.waitForTimeout(600);
}

/* ── 1. A book with nothing in it is still a book ───────────────────── */
console.log('\nbefore she has earned anything');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, 0);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  await openBook(p);

  const slots = await p.locator('.sticker').count();
  check(slots === 14, 'all fourteen slots are printed', `${slots} found`);

  const earned = await p.locator('.sticker.is-earned').count();
  check(earned === 0, 'and none of them are filled', `${earned} filled`);

  /*
    Every empty slot has to say what fills it. This is the only place in the
    app that mentions naming your own symptom or rating how bad something was,
    and she has never used a period tracker before.
  */
  const withText = await p.evaluate(() =>
    [...document.querySelectorAll('.sticker:not(.is-earned) .sticker-sub')]
      .filter((n) => (n.textContent ?? '').trim().length > 4).length);
  check(withText === 14, 'and every one says what would fill it', `${withText}/14`);
});

/* ── 2. Earned reads as earned without relying on colour ────────────── */
console.log('\nonce there is something in it');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, 40);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  await openBook(p);

  const earned = await p.locator('.sticker.is-earned').count();
  // Day one, seven days, thirty days. No period logged, so nothing else.
  check(earned === 3, 'the count matches what she has actually done', `${earned}`);

  const row = await p.locator('.row', { hasText: 'Sticker book' }).innerText();
  check(/3 of 14/.test(row), 'and Settings says so before she opens it', row.trim());
  check(!/missing|left|remaining|to go/i.test(row),
    'without framing the empty ones as a shortfall', row.trim());

  /*
    Border style, not just colour. A sticker that reads as earned only by being
    more saturated reads as earned to nobody looking at this in bright sun, and
    to nobody who cannot distinguish the two hues.
  */
  const styles = await p.evaluate(() => {
    const one = document.querySelector('.sticker.is-earned');
    const other = document.querySelector('.sticker:not(.is-earned)');
    return {
      earned: getComputedStyle(one).borderTopStyle,
      empty: getComputedStyle(other).borderTopStyle,
      shadow: getComputedStyle(one).boxShadow,
    };
  });
  check(styles.earned === 'solid' && styles.empty === 'dashed',
    'earned and empty differ in shape, not only in colour',
    `${styles.earned} vs ${styles.empty}`);
  check(styles.shadow !== 'none', 'and an earned sticker is lifted off the page');

  // The date it was earned, not today.
  const first = await p.locator('.sticker.is-earned').first().getAttribute('aria-label');
  check(/earned/.test(first ?? ''), 'each one carries the day it was earned', first ?? '');
});

/* ── 3. Earning one is actually mentioned ───────────────────────────── */
console.log('\nearning one during a check-in');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  // Six days behind her, so today's check-in is the seventh.
  await seed(p, 6);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  await p.locator('.checkin-option', { hasText: 'No bleeding' }).click();
  await p.waitForTimeout(250);
  await p.locator('.checkin-next').click();
  await p.waitForTimeout(250);
  await p.locator('.checkin-next').click();
  await p.waitForTimeout(1200);

  const toast = await p.locator('.toast').innerText().catch(() => '');
  check(/Sticker earned/.test(toast), 'she is told about it', toast.trim());
  check(/A week of it/.test(toast), 'and told which one', toast.trim());

  /*
    And the sticker must not cost her the confirmation that the day saved.

    A live region holds one message: a second `announce` replaces the first,
    so a sticker toast calling `announce` for itself meant a screen reader
    heard about the sticker *instead of* hearing the day had been recorded.
    Both facts, one announcement — which is also why the double-tap guard
    elsewhere can still count announcements to prove the finish ran once.
  */
  const live = await p.locator('#live-region').innerText().catch(() => '');
  check(/Checked in/.test(live), 'without costing her the save confirmation', live.trim());
  check(/Sticker earned/.test(live), 'and the sticker is in the same announcement',
    live.trim());
});

/* ── 4. And not told again the next day ─────────────────────────────── */
console.log('\nand not again for one she already has');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, 12);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  await p.locator('.checkin-option', { hasText: 'No bleeding' }).click();
  await p.waitForTimeout(250);
  await p.locator('.checkin-next').click();
  await p.waitForTimeout(250);
  await p.locator('.checkin-next').click();
  await p.waitForTimeout(1200);

  const toast = await p.locator('.toast').innerText().catch(() => '');
  check(!/Sticker/.test(toast), 'the thirteenth day says nothing about stickers',
    toast.trim() || 'no toast');
});

await browser.close();
console.log(`\nsticker book: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
