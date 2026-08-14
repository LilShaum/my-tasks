/**
 * export.mjs — getting the file off the phone, and only saying so when it went.
 *
 * Kittycal has no server, so an exported file is the only copy of her history
 * that survives a dead phone. That makes the backup path the one place where
 * claiming success falsely is worse than failing loudly: recording a backup
 * that did not happen silences the nudge for a month and leaves her believing
 * she is covered.
 *
 * `<a download>` gives no signal at all — no event, no promise, no error — and
 * an installed iOS web app quietly ignores it. So there the file goes out
 * through the share sheet, which does report back. These checks stand in for a
 * device: the share API is faked, and what matters is what the app records
 * afterwards in each of the three outcomes.
 *
 * Run: node test/export.mjs   (with a static server on 8099)
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = 'http://127.0.0.1:8099/';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let checks = 0;
let failures = 0;

const check = (cond, label, extra = '') => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

const browser = await pw.chromium.launch({ executablePath: CHROME });

/**
 * Boot a seeded app pretending to be a particular device.
 *
 * @param {Object} o
 * @param {boolean} o.installed   running from the Home Screen
 * @param {'ok'|'cancel'|'absent'} o.share  how the share sheet behaves
 * @param {string} [o.userAgent]
 */
async function open({ installed, share, userAgent = IPHONE }) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, userAgent,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });

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
    const { emptyLog } = await import('/js/domain/model.js');
    const pad = (n) => String(n).padStart(2, '0');
    const shift = (n) => {
      const d = new Date(); d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const days = [];
    for (let i = 0; i < 5; i += 1) days.push(shift(-6 + i));

    await new Promise((res) => {
      const tx = db.transaction(['meta', 'logs'], 'readwrite');
      for (let i = 1; i <= 20; i += 1) {
        tx.objectStore('logs').put({ ...emptyLog(shift(-i)), checkedIn: true });
      }
      tx.objectStore('meta').put({ key: 'periodDays', value: days });
      tx.objectStore('meta').put({ key: 'settings', value: {
        theme: 'hellokitty', onboarded: true, disclaimerAck: true,
        avgCycleLength: 28, avgPeriodLength: 5, name: 'Sam',
        // Deliberately never backed up, so lastBackup starts empty and any
        // value found afterwards was written by the export itself.
        lastBackup: '', lastBackupAt: 0,
      } });
      tx.oncomplete = () => res(undefined);
    });
  });

  await page.addInitScript(({ installed, share }) => {
    if (installed) {
      Object.defineProperty(navigator, 'standalone', {
        configurable: true, get: () => true,
      });
      // The standard signal too, so nothing depends on which one is read.
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
        ? /** @type {any} */ ({ matches: true, media: q,
            addEventListener() {}, removeEventListener() {}, addListener() {},
            removeListener() {}, onchange: null, dispatchEvent: () => false })
        : mm(q));
    }

    /** @type {any[]} */
    const shared = [];
    /** @type {any} */ (window).__shared = shared;

    if (share === 'absent') {
      // @ts-ignore — deleting an optional API is the point
      delete navigator.share;
      // @ts-ignore
      delete navigator.canShare;
      return;
    }

    Object.defineProperty(navigator, 'canShare', {
      configurable: true, value: () => true,
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (/** @type {any} */ data) => {
        shared.push((data.files ?? []).map((/** @type {File} */ f) => f.name));
        if (share === 'cancel') {
          const err = new Error('Share canceled');
          err.name = 'AbortError';
          throw err;
        }
      },
    });
  }, { installed, share });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    document.querySelector('.sheet [aria-label="Close"]')?.click();
  });
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}

/** Run the real export action and report what the app did about it. */
const runExport = (page) => page.evaluate(async () => {
  const { exportEverything } = await import('/js/storage/export-action.js');
  await exportEverything();
  await new Promise((r) => setTimeout(r, 250));
  const { getState } = await import('/js/state/store.js');
  return {
    lastBackup: getState().settings.lastBackup,
    shared: /** @type {any} */ (window).__shared,
    toast: document.querySelector('.toast')?.textContent ?? '',
  };
});

console.log('\ninstalled on iOS, the file goes out through the share sheet');
{
  const { page, ctx, errors } = await open({ installed: true, share: 'ok' });
  const out = await runExport(page);

  check(out.shared.length === 1, 'the share sheet was used, not a silent link',
    JSON.stringify(out.shared));
  check(/kittycal.*\.json$/i.test(out.shared[0]?.[0] ?? ''),
    'and it carried the backup file itself', JSON.stringify(out.shared));
  check(Boolean(out.lastBackup), 'a completed share counts as a backup',
    JSON.stringify(out.lastBackup));
  check(/Exported/i.test(out.toast), 'and it says so', out.toast);
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

console.log('\nbacking out of the share sheet is not a backup');
{
  const { page, ctx, errors } = await open({ installed: true, share: 'cancel' });
  const out = await runExport(page);

  check(out.shared.length === 1, 'the sheet was offered');
  /*
    The important one. Before this, the export recorded a backup and toasted
    success the instant it handed the file over, so cancelling still bought a
    month of silence from the nudge — over a file that was never written.
  */
  check(out.lastBackup === '', 'but nothing was written down',
    JSON.stringify(out.lastBackup));
  check(!/Exported/i.test(out.toast), 'and nothing claimed otherwise', out.toast);
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

console.log('\nin a Safari tab the ordinary download is left alone');
{
  const { page, ctx, errors } = await open({ installed: false, share: 'ok' });
  const out = await runExport(page);

  /*
    Sharing costs an extra sheet and a decision, so it is only worth it where
    the alternative fails silently. A browser tab is not that place.
  */
  check(out.shared.length === 0, 'no share sheet where the link works',
    JSON.stringify(out.shared));
  check(Boolean(out.lastBackup), 'and the backup is still recorded');
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

console.log('\nan installed app with no share API still falls back to the link');
{
  const { page, ctx, errors } = await open({ installed: true, share: 'absent' });
  const out = await runExport(page);

  check(Boolean(out.lastBackup),
    'the export completes rather than dead-ending', JSON.stringify(out.lastBackup));
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

console.log('\non a desktop browser nothing changes');
{
  const { page, ctx, errors } = await open({
    installed: false, share: 'ok',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  });
  const out = await runExport(page);
  check(out.shared.length === 0, 'the link is used', JSON.stringify(out.shared));
  check(Boolean(out.lastBackup), 'and the backup is recorded');
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`\nexport: ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
