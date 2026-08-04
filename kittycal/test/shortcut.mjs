/**
 * shortcut.mjs — the three things added in this pass, driven in a real browser.
 *
 * Home-screen shortcuts, the backup checker, and the spotting flag. The unit
 * tests cover the arithmetic; these cover the parts only a browser can answer:
 * does the launch parameter actually land on the right screen, does it stop
 * following her around after it has been used, and does the check sheet say
 * something true about a file it was handed.
 *
 * Run: node test/shortcut.mjs   (with a static server on 8099)
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = 'http://127.0.0.1:8099/';

let pass = 0;
let fail = 0;

const ok = (label, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok    ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

const browser = await pw.chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

/** Seed a hydrated install with `cycles` past periods, then open `path`. */
async function open(path, { cycles = 4, spotting = [] } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });

  await page.evaluate(async ({ cycles, spotting }) => {
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

    const base = {
      flow: 'none', symptoms: [], moods: [], discharge: [], activity: [], other: [],
      sex: [], drive: null, custom: [], severity: {}, bbt: null, weight: null, water: 0,
      sleep: null, steps: null, pillTaken: false, testPregnancy: null, testOvulation: null,
      notes: '', checkedIn: true, updated: Date.now(),
    };

    const days = [];
    for (let c = 0; c < cycles; c += 1) {
      const start = -6 - ((cycles - 1 - c) * 28);
      for (let i = 0; i < 5; i += 1) days.push(shift(start + i));
    }

    // Days offset from today, logged as spotting — mid-cycle by construction.
    const logs = spotting.map((back) => ({ ...base, date: shift(back), flow: 'spotting' }));

    await new Promise((res) => {
      const tx = db.transaction(['meta', 'logs'], 'readwrite');
      tx.objectStore('meta').put({ key: 'settings', value: {
        theme: 'hellokitty', onboarded: true, disclaimerAck: true,
        avgCycleLength: 28, avgPeriodLength: 5, name: 'Sam',
        lastBackup: shift(0), lastBackupAt: Date.now(),
      } });
      tx.objectStore('meta').put({ key: 'periodDays', value: days });
      for (const log of logs) tx.objectStore('logs').put(log);
      tx.oncomplete = () => res(undefined);
    });
  }, { cycles, spotting });

  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  return { page, ctx, errors };
}

/* ── The shortcuts ──────────────────────────────────────────────────────── */

console.log('\nthe manifest declares them');
{
  const res = await fetch(`${BASE}manifest.webmanifest`);
  const manifest = await res.json();
  ok('three shortcuts', manifest.shortcuts?.length === 3,
    JSON.stringify(manifest.shortcuts?.length));
  ok('each has a url, a name and an icon',
    manifest.shortcuts.every((s) => s.url && s.name && s.icons?.[0]?.src));

  for (const s of manifest.shortcuts) {
    const icon = await fetch(BASE + s.icons[0].src);
    ok(`${s.name}: icon is served`, icon.ok && icon.headers.get('content-type') === 'image/png');
    const target = await fetch(BASE + s.url.replace('./', ''));
    ok(`${s.name}: url loads`, target.ok);
  }
}

console.log('\n?go=log opens today\'s diary');
{
  const { page, ctx, errors } = await open('?go=log');
  const sheet = await page.$('.sheet');
  ok('a sheet is open', Boolean(sheet));
  const title = await page.$eval('.sheet h2', (n) => n.textContent ?? '').catch(() => '');
  ok('and it is the diary, not the check-in', /Today|log/i.test(title), title);
  ok('the parameter is gone from the address bar',
    !(await page.evaluate(() => location.search)),
    await page.evaluate(() => location.search));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n?go=calendar and ?go=insights land on their screens');
for (const [go, sel] of [['calendar', '#view-calendar'], ['insights', '#view-insights']]) {
  const { page, ctx, errors } = await open(`?go=${go}`);
  const visible = await page.$eval(sel, (n) => !n.hidden).catch(() => false);
  ok(`${go} is showing`, visible);
  ok(`${go}: nothing else popped over it`, !(await page.$('.sheet')));
  ok(`${go}: no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\na nonsense parameter is ignored, not obeyed');
{
  const { page, ctx, errors } = await open('?go=wipe-everything');
  ok('still on Today', await page.$eval('#view-today', (n) => !n.hidden));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ── The backup checker ─────────────────────────────────────────────────── */

console.log('\nchecking a backup file changes nothing');
{
  const { page, ctx, errors } = await open('');

  // Export the current data through the real path, then hand the same bytes
  // back to the checker. It should recognise itself.
  const own = await page.evaluate(async () => {
    const store = await import('/js/state/store.js');
    const backup = await import('/js/storage/backup.js');
    const { logs, periodDays, settings } = store.getState();
    return backup.toJSON({ logs, periodDays, settings });
  });

  const verdicts = await page.evaluate(async (text) => {
    const store = await import('/js/state/store.js');
    const backup = await import('/js/storage/backup.js');
    const { describeBackup } = await import('/js/domain/backup-check.js');
    const { logs, periodDays } = store.getState();

    const self = describeBackup(backup.parseImport(text), { logs, periodDays });
    const junk = describeBackup(backup.parseImport('{"hello":true}'), { logs, periodDays });
    return { self, junk, logCount: Object.keys(logs).length };
  }, own);

  ok('its own export is a complete copy', verdicts.self.state === 'match',
    JSON.stringify(verdicts.self));
  ok('and it counts what is actually there',
    verdicts.self.periodCount === 20, String(verdicts.self.periodCount));
  ok('a file that is not ours is refused', verdicts.junk.ok === false);

  // Drive the real Settings row, with a file, and confirm the sheet appears and
  // the data underneath is untouched.
  await page.evaluate(async () => (await import('/js/state/store.js')).setView('settings'));
  await page.waitForTimeout(400);

  const row = await page.$('button.row:has-text("Check a backup file")');
  ok('the Settings row exists', Boolean(row));

  const input = await page.$('input[type=file]');
  ok('there is a file input to drive', Boolean(input));

  const inputs = await page.$$('input[type=file]');
  await inputs[1].setInputFiles({
    name: 'kittycal-backup.json', mimeType: 'application/json', buffer: Buffer.from(own),
  });
  await page.waitForTimeout(500);

  const sheetText = await page.$eval('.sheet', (n) => n.textContent ?? '').catch(() => '');
  ok('the check sheet opened', /Backup check/i.test(sheetText) || sheetText.length > 0, sheetText);
  ok('it says the file is a complete copy',
    /complete copy/i.test(sheetText), sheetText.slice(0, 200));
  ok('and it says nothing was changed',
    /Nothing was changed/i.test(sheetText));

  const stillThere = await page.evaluate(async () => {
    const store = await import('/js/state/store.js');
    return store.getState().periodDays.size;
  });
  ok('the data on the device is untouched', stillThere === 20, String(stillThere));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\nan older backup is described as older, not as broken');
{
  const { page, ctx, errors } = await open('');
  const verdict = await page.evaluate(async () => {
    const store = await import('/js/state/store.js');
    const backup = await import('/js/storage/backup.js');
    const { describeBackup } = await import('/js/domain/backup-check.js');
    const { logs, periodDays, settings } = store.getState();

    // A file from before the most recent period.
    const older = new Set([...periodDays].sort().slice(0, 15));
    const text = backup.toJSON({ logs, periodDays: older, settings });
    return describeBackup(backup.parseImport(text), { logs, periodDays });
  });
  ok('behind, by exactly the days that came after it',
    verdict.state === 'behind' && verdict.onlyHere === 5, JSON.stringify(verdict));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ── The spotting flag ──────────────────────────────────────────────────── */

console.log('\nbleeding between periods');
{
  // Two days mid-cycle in one past cycle, one in another: three days, two cycles.
  const { page, ctx, errors } = await open('', { spotting: [-20, -21, -48] });
  const text = await page.$eval('#view-today', (n) => n.textContent ?? '');
  ok('Today raises it', /Bleeding between periods/i.test(text));
  ok('as something to mention, not a finding', /appointment/i.test(text));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\none stray day says nothing');
{
  const { page, ctx, errors } = await open('', { spotting: [-20] });
  const text = await page.$eval('#view-today', (n) => n.textContent ?? '');
  ok('stays quiet', !/Bleeding between periods/i.test(text));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
