// @ts-check
/**
 * network.mjs — proves the privacy claim instead of asserting it.
 *
 * "Kittycal makes no outbound network requests" is the central promise of this
 * app, so it gets a test rather than a paragraph. Run it against a served copy:
 *
 *     python3 -m http.server 8099 &
 *     node test/network.mjs http://127.0.0.1:8099
 *
 * Two checks:
 *
 *   1. Every request the page makes is same-origin. Any request to another host
 *      — a font CDN, an analytics beacon, an image — fails the test.
 *   2. The app still works with the network cut off after first load, which is
 *      what "installs to your home screen and works offline" has to mean.
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;

const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const ORIGIN = new URL(BASE).origin;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

/** @type {string[]} */
const offOrigin = [];
/** @type {string[]} */
const sameOrigin = [];
/** @type {string[]} */
const failures = [];

page.on('request', (req) => {
  const url = req.url();
  if (url.startsWith('data:') || url.startsWith('blob:')) return;
  if (new URL(url).origin === ORIGIN) sameOrigin.push(url);
  else offOrigin.push(url);
});
page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));

/* ── 1. Walk the whole app and watch every request ───────────────────────── */

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// Seed an onboarded state with history so every view has something to render.
await page.evaluate(async () => {
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
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  /** @type {string[]} */
  const days = [];
  for (let c = 4; c >= 0; c--) {
    for (let i = 0; i < 5; i++) days.push(shift(-(c * 28) - 6 + i));
  }

  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    tx.objectStore('meta').put({
      key: 'settings',
      value: { theme: 'hellokitty', onboarded: true, disclaimerAck: true,
               avgCycleLength: 28, avgPeriodLength: 5 },
    });
    tx.objectStore('meta').put({ key: 'periodDays', value: days });
    tx.objectStore('logs').put({
      date: shift(-6), flow: 'heavy', symptoms: ['cramps'], moods: ['sad'],
      discharge: [], activity: [], other: [], sex: [], drive: null, custom: [],
      bbt: 36.4, weight: null, water: 500, sleep: 7, steps: null,
      pillTaken: false, testPregnancy: null, testOvulation: null,
      notes: 'test', updated: Date.now(),
    });
    tx.oncomplete = res;
  });
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);

for (const tab of ['calendar', 'insights', 'settings', 'today']) {
  await page.click(`[data-tab="${tab}"]`);
  await page.waitForTimeout(500);
}

// Open the logging sheet, which is the most module-hungry path.
await page.click('.log-cta .btn');
await page.waitForTimeout(600);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// Cycle a few themes, since each one could in principle pull an asset.
await page.click('[data-tab="settings"]');
for (const theme of ['kuromi', 'gudetama', 'plain']) {
  await page.click(`#view-settings [data-theme="${theme}"]`);
  await page.waitForTimeout(250);
}

/* ── 2. Cut the network and confirm the app still runs ───────────────────── */

// Give the service worker a moment to finish precaching before going offline.
await page.waitForTimeout(1200);
await context.setOffline(true);

let offlineOk = false;
let offlineDetail = '';
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  offlineOk = await page.locator('#app-root').isVisible();
  // And it must still be usable, not merely painted.
  await page.click('[data-tab="calendar"]');
  await page.waitForTimeout(400);
  const cells = await page.locator('.cal-cell').count();
  offlineDetail = `app visible, ${cells} calendar cells rendered`;
  offlineOk = offlineOk && cells > 20;
} catch (err) {
  offlineDetail = String(err instanceof Error ? err.message : err);
}

await context.setOffline(false);
await browser.close();

/* ── Report ──────────────────────────────────────────────────────────────── */

console.log(`same-origin requests:  ${sameOrigin.length}`);
console.log(`off-origin requests:   ${offOrigin.length}`);
if (offOrigin.length) {
  console.log('\nFAILED — the app reached outside its own origin:\n');
  for (const url of [...new Set(offOrigin)]) console.log(`  ! ${url}`);
}

console.log(`offline after install: ${offlineOk ? 'works' : 'FAILED'} (${offlineDetail})`);

if (failures.length) {
  console.log('\npage errors:');
  for (const f of failures) console.log(`  ! ${f}`);
}

const passed = offOrigin.length === 0 && offlineOk && failures.length === 0;
console.log(passed ? '\nall network checks pass' : '\nnetwork checks FAILED');
process.exit(passed ? 0 : 1);
