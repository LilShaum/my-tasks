// @ts-check
/**
 * loop.mjs — the daily loop, end to end, in a real browser.
 *
 * Not a node:test file: every one of these bugs lived in the seam between the
 * store, IndexedDB and the DOM, and none of them are reachable without all
 * three. Run it against a served copy of the app:
 *
 *     python3 -m http.server 8099 &
 *     node test/loop.mjs http://127.0.0.1:8099
 *
 * The loop under test is the whole of daily use: open the app, get asked three
 * questions, answer them, have it stored, see it reflected, come back tomorrow.
 * Everything else in Kittycal is downstream of this working every single day,
 * so each case here is a bug that was actually shipped and actually found.
 *
 * Exits non-zero on any failure, so it can gate a commit.
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;

const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = 0;
let checks = 0;

/** @param {boolean} ok @param {string} what @param {string} [detail] */
function check(ok, what, detail = '') {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.error(`  FAIL  ${what}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`  ok    ${what}`);
  }
}

/**
 * A movable clock, installed before any app code runs, so a day can turn over
 * without the page being reloaded. That is the case that matters: an app on the
 * Home Screen is not reloaded between uses, and iOS keeps it resident for days.
 */
function installClock() {
  const RealDate = Date;
  // @ts-ignore - test shim
  window.__dayOffset = 0;
  // @ts-ignore - test shim
  const shifted = () => RealDate.now() + window.__dayOffset * 86400000;
  class FakeDate extends RealDate {
    /** @param {any[]} args */
    constructor(...args) {
      // @ts-ignore - forwarding to the real constructor
      if (!args.length) super(shifted()); else super(...args);
    }
    static now() { return shifted(); }
  }
  // @ts-ignore - test shim
  window.Date = FakeDate;
}

/**
 * Put a finished user in place: onboarded, and optionally with five cycles of
 * period history behind her.
 * @param {import('playwright').Page} page
 * @param {boolean} withHistory
 */
function seed(page, withHistory) {
  return page.evaluate(async (withHistory) => {
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
    const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
    const shift = (/** @type {number} */ n) => {
      const d = new Date(); d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const days = [];
    if (withHistory) {
      for (let cyc = 4; cyc >= 0; cyc -= 1) {
        const start = -14 - (cyc * 28);
        for (let i = 0; i < 5; i += 1) days.push(shift(start + i));
      }
    }
    await new Promise((res) => {
      const tx = db.transaction(['meta'], 'readwrite');
      tx.objectStore('meta').put({ key: 'settings', value: {
        theme: 'hellokitty', onboarded: true, disclaimerAck: true,
        avgCycleLength: 28, avgPeriodLength: 5, name: 'Sam',
        lastBackup: shift(0), lastBackupAt: Date.now(),
      } });
      tx.objectStore('meta').put({ key: 'periodDays', value: days });
      tx.oncomplete = () => res(undefined);
    });
  }, withHistory);
}

/** @param {import('playwright').Page} page */
const logsOnDisk = (page) => page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('kittycal', 1); r.onsuccess = () => res(r.result);
  });
  return new Promise((res) => {
    const tx = db.transaction(['logs'], 'readonly');
    const g = tx.objectStore('logs').getAll();
    g.onsuccess = () => res(g.result.length);
  });
});

/** Answer all three questions with the quickest possible day. @param {import('playwright').Page} p */
async function completeCheckin(p, flow = 'No bleeding') {
  await p.locator('.checkin-option', { hasText: flow }).click();
  await p.waitForTimeout(250);
  await p.locator('.checkin-next').click();
  await p.waitForTimeout(250);
  await p.locator('.checkin-next').click();
  await p.waitForTimeout(1000);
}

const browser = await chromium.launch({ executablePath: CHROME });

/** @param {(p: import('playwright').Page) => Promise<void>} fn */
async function withPage(fn, { clock = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
  });
  if (clock) await context.addInitScript(installClock);
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    failures += 1;
    console.error(`  FAIL  uncaught page error — ${e.message}`);
  });
  try { await fn(page); } finally { await context.close(); }
}

/* ── 1. A tap that lands twice must not skip a question ─────────────────
   A phone double-tap fires the same node twice. The button that was tapped is
   still alive after the render that replaced it, so the second firing used to
   advance a second time — losing the mood question entirely. */
console.log('\ndouble-tap on an answer');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, true);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.checkin-option')]
      .find((b) => b.textContent?.trim() === 'Light');
    /** @type {HTMLElement} */ (btn).click();
    /** @type {HTMLElement} */ (btn).click();
  });
  await p.waitForTimeout(700);
  const showing = await p.locator('.checkin-title').innerText().catch(() => '(gone)');
  check(showing === 'How are you feeling?', 'advances exactly one question', showing);
});

/* ── 2. A failed write must never look like a success ───────────────────
   The worst failure this app can have: a tick, a burst of confetti, and an
   empty database. What the screen shows must match what is stored. */
console.log('\nstorage refuses the write');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, true);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  // Break writes the way a full disk or a closed connection would.
  await p.evaluate(() => {
    const orig = IDBDatabase.prototype.transaction;
    // @ts-ignore - test shim
    window.__broken = true;
    // @ts-ignore - test shim
    IDBDatabase.prototype.transaction = function (names, mode, ...rest) {
      // @ts-ignore - test shim
      if (window.__broken && mode === 'readwrite') {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return orig.call(this, names, mode, ...rest);
    };
  });

  await completeCheckin(p, 'Medium');

  check(await p.locator('.toast').count() > 0, 'the failure is shown, not swallowed');
  check(await logsOnDisk(p) === 0, 'nothing is on disk');

  const today = (await p.locator('.log-cta').innerText().catch(() => '')).replace(/\n+/g, ' ');
  check(!today.includes('Logged today') && !today.includes('Checked in'),
    'the screen does not claim the day was logged', today);
  check(await p.locator('.checkin-step').count() > 0,
    'the check-in stays open so it can be retried');
});

/* ── 3. Midnight, without a reload ──────────────────────────────────────
   A once-per-page-load flag asked on the day it was installed and then never
   again. An installed app is not reloaded between uses. */
console.log('\nthe day turns over while the app is open');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, true);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await completeCheckin(p);

  check(await p.locator('.checkin-step').count() === 0, 'today is done and the sheet is closed');

  await p.evaluate(() => {
    // @ts-ignore - test shim
    window.__dayOffset = 1;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p.waitForTimeout(1200);
  check(await p.locator('.checkin-step').count() > 0, 'asks again on the new day');

  // But it must never take the screen away from something already open.
  await p.locator('.sheet-close, [aria-label*="Close"]').first().click();
  await p.waitForTimeout(600);
  await p.locator('.week-day.is-missed').first().click();
  await p.waitForTimeout(600);
  const before = await p.locator('.checkin-title').innerText();
  await p.evaluate(() => {
    // @ts-ignore - test shim
    window.__dayOffset = 2;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p.waitForTimeout(1000);
  check(await p.locator('.checkin-title').innerText() === before,
    'an open sheet is left alone across midnight');
}, { clock: true });

/* ── 4. Someone with no cycle history at all ────────────────────────────
   She skipped the last-period question during setup. Today cannot draw a ring,
   but the daily loop must still be there — the empty state used to replace it,
   so she could be asked to check in, answer, and be told "nothing logged yet"
   with no way to check in again. */
console.log('\nno cycle history yet');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, false);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  check(await p.locator('.checkin-step').count() > 0, 'still asks the three questions');
  await completeCheckin(p);

  check(await p.locator('.week-strip').count() === 1, 'the week strip is still there');
  check(await p.locator('.log-cta button').count() > 0, 'a check-in is still reachable');
  check(await logsOnDisk(p) === 1, 'the answer was stored');
});

/* ── 5. The ordinary day, start to finish ───────────────────────────────
   The path she walks every day, asserted the boring way. */
console.log('\nthe ordinary day');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, true);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  check(await p.locator('.checkin-step').count() > 0, 'opens by itself');
  check(await p.locator('.checkin-option[aria-pressed="true"]').count() === 0,
    'nothing is answered on her behalf');

  await completeCheckin(p, 'Medium');

  check(await logsOnDisk(p) === 1, 'the day is on disk');
  check(await p.locator('.checkin-step').count() === 0, 'the sheet closes');

  const today = (await p.locator('.log-cta').innerText()).replace(/\n+/g, ' ');
  check(today.includes('Logged today'), 'Today shows what was logged', today);
  check(await p.locator('.week-day.is-today.is-logged').count() === 1,
    'the week strip ticks today off');

  // Reopening must not ask again, and must not lose the answer.
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  check(await p.locator('.checkin-step').count() === 0, 'does not ask twice in a day');
  check(await logsOnDisk(p) === 1, 'the day survives a restart');
});

/* ── 6. The day when nothing happened ───────────────────────────────────
   The commonest day there is, and the one storage used to throw away: a log
   with no bleeding and nothing ticked looked empty, so it was pruned on write.
   The app then asked again the next day and the week strip showed the day as
   never logged. "No bleeding on the 3rd" is also an observation the cycle
   maths wants, and it is not the same as never having been asked. */
console.log('\na day when nothing happened');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, true);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  await completeCheckin(p, 'No bleeding');

  check(await logsOnDisk(p) === 1, 'an answer of "nothing" is still stored');

  const today = (await p.locator('.log-cta').innerText()).replace(/\n+/g, ' ');
  check(today.includes('nothing to report'),
    'Today says so without pretending something was logged', today);

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  check(await p.locator('.checkin-step').count() === 0, 'it does not ask again');
  check(await p.locator('.week-day.is-today.is-logged').count() === 1,
    'the week strip still counts the day as logged');
});

await browser.close();

console.log(`\ndaily loop: ${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} failing`);
  process.exit(1);
}
console.log('the loop holds');
