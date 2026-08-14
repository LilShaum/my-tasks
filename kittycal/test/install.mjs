/**
 * install.mjs — the warning that Safari may delete everything.
 *
 * The unit tests cover when it should appear. These cover the two things only
 * a browser can answer: that the platform sniffing picks the right set of
 * instructions, and — the one that matters most — that the warning stays away
 * from anyone whose data is already safe. A false alarm here is not a cosmetic
 * bug: it is the app claiming a risk that does not exist, on the one screen
 * she looks at daily, which is how a real warning gets tapped past later.
 *
 * Run: node test/install.mjs   (with a static server on 8099)
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = 'http://127.0.0.1:8099/';

let pass = 0;
let fail = 0;

const ok = (label, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok    ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const browser = await pw.chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

/**
 * Boot a seeded install.
 *
 * `storage` picks which browser to imitate:
 *   'safari'    — no navigator.storage.persist at all, which is iOS
 *   'persisted' — persist() exists and has been granted
 */
async function open({ userAgent = IPHONE, storage = 'safari', settings = {} } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, userAgent,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });

  await page.evaluate(async (settings) => {
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

    const days = [];
    for (let c = 0; c < 3; c += 1) {
      const s = -6 - ((2 - c) * 28);
      for (let i = 0; i < 5; i += 1) days.push(shift(s + i));
    }

    await new Promise((res) => {
      const tx = db.transaction(['meta'], 'readwrite');
      tx.objectStore('meta').put({ key: 'settings', value: {
        theme: 'hellokitty', onboarded: true, disclaimerAck: true,
        avgCycleLength: 28, avgPeriodLength: 5, name: 'Sam',
        lastBackup: shift(0), lastBackupAt: Date.now(),
        ...settings,
      } });
      tx.objectStore('meta').put({ key: 'periodDays', value: days });
      tx.oncomplete = () => res(undefined);
    });
  }, settings);

  // Imitate the browser's storage API before any app code runs.
  await page.addInitScript((mode) => {
    const estimate = async () => ({ usage: 41_000, quota: 5e8 });
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      get: () => (mode === 'persisted'
        ? { estimate, persist: async () => true, persisted: async () => true }
        // iOS Safari: the API exists but persist()/persisted() do not.
        : { estimate }),
    });
  }, storage);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    document.querySelector('.sheet [aria-label="Close"]')?.click();
  });
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}

const card = (page) => page.$('.install-nudge');

console.log('\nthe instructions match the phone');
{
  const cases = [
    [IPHONE, 'ios'],
    ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', 'android'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36', 'desktop'],
  ];
  for (const [ua, expected] of cases) {
    const { page, ctx } = await open({ userAgent: ua });
    const got = await page.evaluate(async () =>
      (await import('/js/storage/persist.js')).installPlatform());
    ok(`${expected}`, got === expected, got);
    await ctx.close();
  }
}

console.log('\non an exposed iPhone it says why, and how');
{
  const { page, ctx, errors } = await open();
  const el = await card(page);
  ok('the warning is on Today', Boolean(el));

  const text = await page.$eval('.install-nudge', (n) => n.textContent ?? '');
  ok('it names the actual risk', /deletes what a website has stored/i.test(text));
  ok('it says there is no server copy', /no server copy/i.test(text));
  ok('it gives the taps', /Share button/i.test(text) && /Add to\s+Home Screen/i.test(text));
  ok('it holds alert contrast rather than blending in',
    Boolean(await page.$('.install-nudge .alert-warn')));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\nit stays away from anyone already safe');
{
  const { page, ctx, errors } = await open({ storage: 'persisted' });
  ok('persistent storage gets no warning', !(await card(page)));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n"not now" quietens it, and the app keeps working');
{
  const { page, ctx, errors } = await open();
  ok('shown to begin with', Boolean(await card(page)));

  await page.click('.install-nudge .btn-ghost');
  await page.waitForTimeout(400);
  ok('gone after the tap', !(await card(page)));

  const stored = await page.evaluate(async () =>
    (await import('/js/state/store.js')).getState().settings.installSnoozed);
  ok('and the snooze is written down, not just hidden', Boolean(stored), String(stored));

  // The risk outlives the dismissal, so this must not be a permanent silence.
  const days = await page.evaluate(async () =>
    (await import('/js/domain/install-health.js')).SNOOZE_DAYS);
  ok('for a fortnight, not forever', days > 0 && days <= 14, String(days));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\na fresh install is not asked during setup');
{
  // One day of data is the day she finished onboarding.
  const { page, ctx } = await open();
  const shown = await page.evaluate(async () => {
    const { installNudge } = await import('/js/domain/install-health.js');
    const { defaultSettings } = await import('/js/domain/model.js');
    const today = (await import('/js/utils/date.js')).todayKey();
    return installNudge({
      logs: {}, periodDays: new Set([today]), settings: defaultSettings(), today,
      storage: { installed: false, persisted: false, canRequest: false },
    });
  });
  ok('a single day of data stays quiet', shown === null);
  await ctx.close();
}

console.log('\ntwo data-safety warnings never show at once');
{
  // Both eligible: no install, storage not persisted, never backed up. The
  // default seed carries 15 period days, well past the 14-day backup floor.
  const { page, ctx } = await open({ storage: 'safari', settings: { lastBackup: '', lastBackupAt: 0 } });
  const both = await page.evaluate(() => ({
    install: document.querySelectorAll('.install-nudge').length,
    backup: document.querySelectorAll('.backup-nudge').length,
  }));
  ok('install shows', both.install === 1, JSON.stringify(both));
  ok('and backup does not, though its own condition is also true',
    both.backup === 0, JSON.stringify(both));
  await ctx.close();
}
{
  // Storage already persisted, so install has nothing to warn about — backup
  // should still appear on its own rather than staying silent by association.
  const { page, ctx } = await open({
    storage: 'persisted', settings: { lastBackup: '', lastBackupAt: 0 },
  });
  const solo = await page.evaluate(() => ({
    install: document.querySelectorAll('.install-nudge').length,
    backup: document.querySelectorAll('.backup-nudge').length,
  }));
  ok('backup shows on its own once install has nothing to say',
    solo.install === 0 && solo.backup === 1, JSON.stringify(solo));
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
