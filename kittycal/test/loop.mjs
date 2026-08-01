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

/** Medium flow plus a symptom, so there is something to respond to. */
async function completeCheckinWithSymptom(p) {
  await p.locator('.checkin-option', { hasText: 'Medium' }).click();
  await p.waitForTimeout(300);
  await p.locator('.checkin-next').click();
  await p.waitForTimeout(300);
  await p.locator('.checkin-option', { hasText: 'Cramps' }).click();
  await p.waitForTimeout(200);
  await p.locator('.checkin-next').click();
  await p.waitForTimeout(1400);
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

/* ── 1b. …and neither must a double-tap on Done ─────────────────────────
   The one move the token guard does not cover, because it is the one that does
   not re-render: Done stays live for as long as the write takes. Tapping it
   twice ran the whole ending twice — two writes, two bursts, two screen-reader
   announcements. */
console.log('\ndouble-tap on Done');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, true);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  await p.evaluate(() => {
    // @ts-ignore - test shim
    window.__announces = 0;
    const live = document.querySelector('[aria-live]');
    new MutationObserver(() => {
      // @ts-ignore - test shim
      if (live?.textContent?.trim()) window.__announces += 1;
    }).observe(/** @type {Node} */ (live), { childList: true, characterData: true, subtree: true });
  });

  await p.locator('.checkin-option', { hasText: 'Light' }).click();
  await p.waitForTimeout(250);
  await p.locator('.checkin-next').click();
  await p.waitForTimeout(250);
  await p.evaluate(() => {
    const done = /** @type {HTMLElement} */ (document.querySelector('.checkin-next'));
    done.click(); done.click();
  });
  await p.waitForTimeout(1500);

  // @ts-ignore - test shim
  const announces = await p.evaluate(() => window.__announces);
  check(announces === 1, 'the day is finished exactly once', `announced ${announces} times`);
  check(await logsOnDisk(p) === 1, 'and stored once');
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

/* ── 7. Correcting a mis-tap ────────────────────────────────────────────
   The first question moves on the instant it is tapped, which is what makes a
   quiet day three taps and also means a mis-tap is instantly a wrong answer —
   on the one field every prediction is built from. */
console.log('\ncorrecting a mis-tap');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, true);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  check(await p.locator('.btn-back').count() === 0,
    'no way back from the first question, because there is nowhere to go');

  await p.locator('.checkin-option', { hasText: 'Heavy' }).click();   // meant Light
  await p.waitForTimeout(400);
  await p.locator('.checkin-option', { hasText: 'Irritable' }).click();
  await p.waitForTimeout(200);

  check(await p.locator('.btn-back').count() === 1, 'Back is offered from then on');
  await p.locator('.btn-back').click();
  await p.waitForTimeout(400);

  const shown = await p.locator('.checkin-option[aria-pressed="true"]')
    .evaluateAll((ns) => ns.map((n) => n.innerText.trim()));
  check(shown.length === 1 && shown[0] === 'Heavy',
    'going back shows what she actually chose', shown.join(', '));

  await p.locator('.checkin-option', { hasText: 'Light' }).click();
  await p.waitForTimeout(400);
  const moods = await p.locator('.checkin-option[aria-pressed="true"]')
    .evaluateAll((ns) => ns.map((n) => n.innerText.trim()));
  check(moods.includes('Irritable'), 'the mood survived the round trip', moods.join(', '));

  await p.locator('.checkin-next').click();
  await p.waitForTimeout(300);
  await p.locator('.checkin-next').click();
  await p.waitForTimeout(1200);

  const stored = await p.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open('kittycal', 1); r.onsuccess = () => res(r.result);
    });
    return new Promise((res) => {
      const tx = db.transaction(['logs'], 'readonly');
      const g = tx.objectStore('logs').getAll();
      g.onsuccess = () => res(g.result[0]);
    });
  });
  check(stored.flow === 'light', 'the correction is what gets saved', `flow=${stored.flow}`);
});

/* ── 8. Reaching it without a touchscreen ───────────────────────────────
   Replacing the sheet's contents destroys whatever was focused and the browser
   drops focus to <body>, so a keyboard user was thrown to the top of the
   document after every answer and a screen reader said nothing about the
   question that had just appeared. Three times a day, every day. */
console.log('\nkeyboard and screen reader');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, true);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  const focused = () => p.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName.toLowerCase()}.${(a.className || '').split(' ')[0]}` : 'none';
  });

  check(await focused() === 'h2.checkin-title',
    'opening lands on the question, not on the close button', await focused());

  await p.locator('.checkin-option', { hasText: 'Light' }).click();
  await p.waitForTimeout(500);
  check(await focused() === 'h2.checkin-title',
    'answering moves focus to the next question', await focused());

  // And the whole thing is operable from the keyboard alone.
  await p.keyboard.press('Tab');
  const afterTab = await focused();
  check(afterTab !== 'body', 'Tab from the question reaches a control', afterTab);
});

/* ── 9. Catching up on something older than a week ──────────────────────
   The week strip reaches back seven days. Beyond that the calendar is the only
   way in, and it used to send every tap to the full diary — a wall of collapsed
   categories to record what the check-in asks in three taps. Same rule as the
   strip: unanswered gets the questions, answered gets the diary, and a future
   date gets the diary because "any bleeding today?" cannot be asked about next
   Tuesday. */
console.log('\ncatching up from the calendar');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, true);
  // Log one day a fortnight back, to prove the two paths diverge.
  await p.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open('kittycal', 1); r.onsuccess = () => res(r.result);
    });
    const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
    const d = new Date(); d.setDate(d.getDate() - 14);
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    await new Promise((res) => {
      const tx = db.transaction(['logs'], 'readwrite');
      tx.objectStore('logs').put({ date, flow: 'medium', symptoms: ['cramps'], moods: [],
        discharge: [], activity: [], other: [], sex: [], drive: null, custom: [], bbt: null,
        weight: null, water: 0, sleep: null, steps: null, pillTaken: false,
        testPregnancy: null, testOvulation: null, notes: '', checkedIn: true, updated: Date.now() });
      tx.oncomplete = () => res(undefined);
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.locator('.sheet-close, [aria-label*="Close"]').first().click();
  await p.waitForTimeout(500);

  await p.locator('[data-tab="calendar"]').click();
  await p.waitForTimeout(700);

  // Last month, so these are days that have actually happened.
  await p.locator('[aria-label="Previous month"]').click();
  await p.waitForTimeout(600);
  await p.locator('.cal-day, .cal-cell').filter({ hasText: /^10$/ }).first().click();
  await p.waitForTimeout(700);
  check(await p.locator('.checkin-step').count() > 0,
    'an unanswered day from weeks ago gets the three questions');
  const asked = await p.locator('.checkin-title').innerText();
  check(/Jul|Jun|May|Apr|Mar|Feb|Jan|Aug|Sep|Oct|Nov|Dec/.test(asked),
    'and names the day it is asking about', asked);

  await p.locator('.sheet-close, [aria-label*="Close"]').first().click();
  await p.waitForTimeout(600);
  await p.locator('[aria-label="Next month"]').click();
  await p.waitForTimeout(600);

  const logged = await p.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() - 14); return String(d.getDate());
  });
  await p.locator('.cal-day, .cal-cell')
    .filter({ hasText: new RegExp(`^${logged}$`) }).first().click();
  await p.waitForTimeout(700);
  check(await p.locator('.checkin-step').count() === 0,
    'a day already answered goes to the diary instead');
});

/* ── 10. Checking in every day must not ruin the calendar ───────────────
   Keeping checked-in days that hold nothing was the fix for the vanishing
   quiet day, and it came within one boolean of wrecking the calendar: the "has
   other data" dot keyed off whether a row existed, so every quiet day would
   have sprouted one. On a normal cycle that is most of the month, and a mark
   that is nearly always present marks nothing. */
console.log('\nchecking in every day, for weeks');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(async () => {
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
    const blank = (/** @type {string} */ date) => ({ date, flow: 'none', symptoms: [],
      moods: [], discharge: [], activity: [], other: [], sex: [], drive: null, custom: [],
      bbt: null, weight: null, water: 0, sleep: null, steps: null, pillTaken: false,
      testPregnancy: null, testOvulation: null, notes: '', checkedIn: true, updated: Date.now() });
    const days = [];
    await new Promise((res) => {
      const tx = db.transaction(['meta', 'logs'], 'readwrite');
      // Sixty days of diligent check-ins; almost all of them say "nothing".
      for (let back = 60; back >= 1; back -= 1) {
        const key = shift(-back);
        const l = blank(key);
        if (back % 28 < 5) { l.flow = 'medium'; days.push(key); }
        if (back % 17 === 0) l.symptoms = ['headache'];   // genuinely worth a dot
        tx.objectStore('logs').put(l);
      }
      tx.objectStore('meta').put({ key: 'settings', value: {
        theme: 'hellokitty', onboarded: true, disclaimerAck: true, avgCycleLength: 28,
        avgPeriodLength: 5, name: 'Sam', lastBackup: shift(0), lastBackupAt: Date.now(),
        checkinSkipped: shift(0) } });
      tx.objectStore('meta').put({ key: 'periodDays', value: days });
      tx.oncomplete = () => res(undefined);
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.locator('[data-tab="calendar"]').click();
  await p.waitForTimeout(700);
  await p.locator('[aria-label="Previous month"]').click();
  await p.waitForTimeout(700);

  const dots = await p.locator('.cal-dot').count();
  check(dots <= 3, 'the dot still means something', `${dots} dots on a fully checked-in month`);
  check(await p.locator('.cal-cell.is-period').count() > 0, 'period days are still drawn');
});

/* ── 11. The quiet day, in one tap ──────────────────────────────────────
   "No bleeding, no moods, nothing bothering me" is the most common day there
   is, and it cost three taps to say — the last two being Next buttons over
   questions whose answer is already "none". */
console.log('\nthe quiet day in one tap');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, true);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  check(await p.locator('.checkin-shortcut').count() === 1, 'the shortcut is offered');

  await p.locator('.checkin-shortcut').click();
  await p.waitForTimeout(1400);

  check(await p.locator('.checkin-step').count() === 0, 'one tap finishes the day');
  check(await logsOnDisk(p) === 1, 'and stores it');

  const stored = await p.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open('kittycal', 1); r.onsuccess = () => res(r.result);
    });
    return new Promise((res) => {
      const tx = db.transaction(['logs'], 'readonly');
      const g = tx.objectStore('logs').getAll();
      g.onsuccess = () => res(g.result[0]);
    });
  });
  check(stored.flow === 'none' && stored.moods.length === 0
    && stored.symptoms.length === 0 && stored.checkedIn === true,
    'as a real answer of "nothing", not as a skip',
    JSON.stringify({ flow: stored.flow, checkedIn: stored.checkedIn }));

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  check(await p.locator('.checkin-step').count() === 0, 'and it does not ask again');
});

/* ── 12. The shortcut must not throw away an answer ─────────────────────
   Once she has said something, "nothing to report" would be a lie about her
   own data — so it stops being offered. */
console.log('\nthe shortcut after she has answered something');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await seed(p, true);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  await p.locator('.checkin-option', { hasText: 'No bleeding' }).click();
  await p.waitForTimeout(400);
  await p.locator('.checkin-option', { hasText: 'Anxious' }).click();
  await p.waitForTimeout(200);
  await p.locator('.btn-back').click();
  await p.waitForTimeout(500);

  check(await p.locator('.checkin-title').innerText() === 'Any bleeding today?',
    'back on the first question');
  check(await p.locator('.checkin-shortcut').count() === 0,
    'the shortcut is gone, because it would discard the mood she picked');
});

/* ── 13. Saying something back ──────────────────────────────────────────
   The loop used to end in a receipt for what she had just typed. This is the
   only part of the exchange that gives her something she did not already
   know, and it is the whole reason the check-in asks about symptoms daily. */
console.log('\nwhat it says back');
await withPage(async (p) => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  // Four complete cycles with cramps on day 2 of each; today is day 2 of a
  // fifth, still unlogged.
  await p.evaluate(async () => {
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
    const blank = (/** @type {string} */ date) => ({ date, flow: 'medium', symptoms: [],
      moods: [], discharge: [], activity: [], other: [], sex: [], drive: null, custom: [],
      bbt: null, weight: null, water: 0, sleep: null, steps: null, pillTaken: false,
      testPregnancy: null, testOvulation: null, notes: '', checkedIn: true, updated: Date.now() });
    const days = [];
    await new Promise((res) => {
      const tx = db.transaction(['meta', 'logs'], 'readwrite');
      for (const startBack of [113, 85, 57, 29, 1]) {
        const span = startBack === 1 ? 1 : 5;   // today is day 2, left unlogged
        for (let i = 0; i < span; i += 1) {
          const key = shift(-startBack + i);
          days.push(key);
          const l = blank(key);
          if (i === 1) l.symptoms = ['cramps'];
          tx.objectStore('logs').put(l);
        }
      }
      tx.objectStore('meta').put({ key: 'settings', value: {
        theme: 'hellokitty', onboarded: true, disclaimerAck: true, avgCycleLength: 28,
        avgPeriodLength: 5, name: 'Sam', lastBackup: shift(0), lastBackupAt: Date.now() } });
      tx.objectStore('meta').put({ key: 'periodDays', value: days });
      tx.oncomplete = () => res(undefined);
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  await completeCheckinWithSymptom(p);

  const said = await p.locator('.today-said').innerText().catch(() => '');
  check(/cramps/.test(said) && /cycles/.test(said),
    'it names the pattern she just matched', said);
  check(!/sorry|hope|great|well done|good job/i.test(said),
    'and does not editorialise about it', said);

  const receipt = await p.locator('.today-logged p').first().innerText();
  check(/cramps/.test(receipt), 'the receipt names what she logged, not a count', receipt);
});

await browser.close();

console.log(`\ndaily loop: ${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} failing`);
  process.exit(1);
}
console.log('the loop holds');
