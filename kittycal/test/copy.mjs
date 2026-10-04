/**
 * copy.mjs - nothing she reads on screen contains an em dash.
 *
 * The copy rule is simple: short sentences, plain words, no em dashes. The
 * em dash is the easiest part to check by machine, and the part that creeps
 * back in whenever someone writes a long explanation. En dashes in ranges
 * ("21-35 days") are fine and are not what this looks for.
 *
 * It walks the main screens with several seeded people, so the states that
 * only some of them reach are covered too: a late period, a long gap, a
 * positive pregnancy test, the pill pack, conceive mode with ovulation signals,
 * a first launch. For each screen it reads every piece of text the page holds
 * (not only what is scrolled into view, so collapsed diary sections count)
 * plus aria-labels, titles, placeholders and alt text, and fails on "—".
 *
 * Screens: onboarding, Today, the check-in (every step), Calendar (and its
 * edit mode), Insights (and its guide), Settings (and the sticker book), the
 * diary sheet, the notes sheet, Help and the doctor's report.
 *
 * Run: npm run test:browser -- copy
 */

import { launchChromium } from './browser.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const EM = '—';

let checks = 0;
let failures = 0;
const check = (cond, label, extra = '') => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${extra ? ` - ${extra}` : ''}`); }
};

/* ── Seeding ────────────────────────────────────────────────────────────── */

/**
 * Runs in the page. `startsAgo` lists how many days ago each period began,
 * newest first, each lasting `periodLen` days. A rich diary is written over
 * the last `diaryDays` days so the screens have something to say.
 */
const seed = async ({ settings, startsAgo, periodLen = 5, diaryDays = 0, extra = {} }) => {
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

  const periodDays = [];
  for (const s of startsAgo) {
    for (let i = 0; i < periodLen; i += 1) {
      if (s - i >= 0) periodDays.push(shift(-(s - i)));
    }
  }

  const logs = [];
  for (let i = 0; i < diaryDays; i += 1) {
    // Today is left unanswered so the check-in opens by itself and gets read.
    const log = { ...emptyLog(shift(-i)), checkedIn: i !== 0 };
    if (periodDays.includes(log.date)) log.flow = i % 2 ? 'heavy' : 'medium';
    if (i % 3 === 0) log.symptoms = ['cramps', 'headache'];
    if (i % 4 === 0) log.moods = ['irritable'];
    if (i % 5 === 0) log.sleep = 380;
    if (i % 2 === 0) log.water = 800;
    if (i % 7 === 0) log.notes = 'Felt rough today, early night.';
    if (i % 9 === 0) log.custom = ['Sore wrists'];
    if (i > 0 && i < 20) log.bbt = i < 8 ? 36.8 : 36.4;
    if (i === 10) log.testOvulation = 'peak';
    logs.push({ ...log, ...(extra.logFor ? extra.logFor(i, shift(-i)) : {}) });
  }
  if (extra.positiveTestAgo != null) {
    const d = shift(-extra.positiveTestAgo);
    const existing = logs.find((l) => l.date === d);
    if (existing) existing.testPregnancy = 'positive';
    else logs.push({ ...emptyLog(d), checkedIn: true, testPregnancy: 'positive' });
  }

  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    for (const l of logs) tx.objectStore('logs').put(l);
    tx.objectStore('meta').put({ key: 'periodDays', value: periodDays });
    if (settings) {
      tx.objectStore('meta').put({ key: 'settings', value: {
        theme: 'hellokitty', onboarded: true, disclaimerAck: true,
        avgCycleLength: 28, avgPeriodLength: 5, name: 'Sam', showFertility: true,
        mode: 'cycle', askSleep: true, askWater: true, birthYear: 2001,
        ...settings,
      } });
    }
    tx.oncomplete = () => res(undefined);
  });
};

/* ── Reading the page ───────────────────────────────────────────────────── */

/**
 * Every string the page holds for a reader: all text content (visible or
 * collapsed, minus scripts and styles) and the attributes that are read aloud
 * or shown as hints.
 */
const readPage = () => {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
  const attrs = [...document.querySelectorAll('[aria-label], [title], [placeholder], [alt]')]
    .flatMap((n) => ['aria-label', 'title', 'placeholder', 'alt'].map((a) => n.getAttribute(a) ?? ''));
  return `${clone.textContent ?? ''}\n${attrs.join('\n')}\n${document.title}`;
};

const context = (text) => {
  const at = text.indexOf(EM);
  return at === -1 ? '' : text.slice(Math.max(0, at - 50), at + 50).replace(/\s+/g, ' ');
};

const browser = await launchChromium();

/** Scan whatever is on screen right now. */
const scan = async (page, label) => {
  const text = await page.evaluate(readPage);
  check(!text.includes(EM), `no em dash: ${label}`, context(text));
  return text;
};

/** Open the app for one person, seeded, and settle. */
async function open(who, seedArgs, { width = 390 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (seedArgs) {
    await page.evaluate(seed, seedArgs);
    await page.reload({ waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(1700);
  console.log(`\n${who}`);
  return { ctx, page, errors };
}

const sheetOpen = (page) => page.locator('.sheet[data-open="true"]').count();

const closeSheets = async (page) => {
  for (let i = 0; i < 3 && await sheetOpen(page); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
  }
};

/**
 * The check-in opens by itself on the first launch of a day. Step through it
 * with the primary button, reading every question, until it closes or says
 * goodbye.
 */
const walkCheckin = async (page, label) => {
  if (!await sheetOpen(page)) return 0;
  let steps = 0;
  for (let i = 0; i < 12; i += 1) {
    await scan(page, `${label}, check-in step ${i + 1}`);
    steps += 1;
    const next = page.locator('.sheet[data-open="true"] .checkin-next').first();
    if (!await next.count()) break;
    const done = /see you tomorrow/i.test(await next.innerText());
    await next.click().catch(() => {});
    await page.waitForTimeout(350);
    if (done || !await sheetOpen(page)) break;
  }
  await closeSheets(page);
  return steps;
};

const tab = async (page, name) => {
  await page.locator(`[data-tab="${name}"]`).click();
  await page.waitForTimeout(600);
};

/** The screens every seeded person gets. */
async function tour(page, label, { full = true } = {}) {
  const steps = await walkCheckin(page, label);
  check(steps > 0 || label.startsWith('first'), `${label}: the check-in was read (${steps} screens)`);

  await tab(page, 'today');
  await scan(page, `${label}, Today`);

  await tab(page, 'calendar');
  await scan(page, `${label}, Calendar`);
  const edit = page.locator('.cal-edit-btn').first();
  if (await edit.count()) {
    await edit.click();
    await page.waitForTimeout(400);
    await scan(page, `${label}, Calendar editing`);
    await edit.click().catch(() => {});
    await page.waitForTimeout(300);
  }

  await tab(page, 'insights');
  await scan(page, `${label}, Insights`);

  await tab(page, 'settings');
  await scan(page, `${label}, Settings`);

  await page.locator('#help-btn').click();
  await page.waitForTimeout(600);
  const help = await scan(page, `${label}, Help`);
  check(/How Kittycal works/.test(help), `${label}: Help opened`);
  await closeSheets(page);

  if (!full) return;

  // Insights guide and the doctor's report.
  await tab(page, 'insights');
  const guide = page.locator('.guide-button').first();
  if (await guide.count()) {
    await guide.click();
    await page.waitForTimeout(500);
    await scan(page, `${label}, Insights guide`);
    await closeSheets(page);
  }
  const report = page.locator('#view-insights button', { hasText: 'Open report' }).first();
  if (await report.count()) {
    await report.evaluate((b) => {
      const root = document.querySelector('#report-root');
      window.print = () => { window.__reportText = root.textContent ?? ''; };
      b.click();
    });
    await page.waitForTimeout(500);
    const printed = await page.evaluate(() => window.__reportText ?? '');
    check(printed.length > 100, `${label}: the report was built`);
    check(!printed.includes(EM), `no em dash: ${label}, doctor's report`, context(printed));
  }

  // Settings: the sticker book.
  await tab(page, 'settings');
  const stickers = page.locator('#view-settings button, #view-settings .row', { hasText: 'Sticker book' }).first();
  if (await stickers.count()) {
    await stickers.click();
    await page.waitForTimeout(500);
    await scan(page, `${label}, sticker book`);
    await closeSheets(page);
  }

  // The diary sheet, with a search that finds nothing and a search that does.
  await tab(page, 'today');
  const more = page.locator('button', { hasText: /Add more|Check in for today/ }).first();
  if (await more.count()) {
    await more.click();
    await page.waitForTimeout(700);
    if (await page.locator('.sheet[data-open="true"] .search-input').count()) {
      await scan(page, `${label}, diary`);
      const search = page.locator('.sheet[data-open="true"] .search-input');
      await search.fill('zzzzzz');
      await page.waitForTimeout(400);
      await scan(page, `${label}, diary, search with no match`);
      await search.fill('cramps');
      await page.waitForTimeout(400);
      await scan(page, `${label}, diary, search with a match`);
    }
    await closeSheets(page);
  }

  // The notes search, if there is a way in.
  const notes = page.locator('button', { hasText: /Search what you wrote|Your notes|Notes/ }).first();
  if (await notes.count()) {
    await notes.click().catch(() => {});
    await page.waitForTimeout(500);
    await scan(page, `${label}, notes`);
    await closeSheets(page);
  }
}

/* ── 1. First launch: onboarding ────────────────────────────────────────── */

{
  const { ctx, page, errors } = await open('a first launch, through every setup step', null);
  for (let i = 0; i < 14; i += 1) {
    await scan(page, `onboarding screen ${i + 1}`);
    const hidden = await page.locator('#onboarding-root').evaluate((n) => n.hidden).catch(() => true);
    if (hidden) break;
    // Pick a recent start date on that step so the "earlier periods" screen has content.
    const chip = page.locator('#onboarding-root .chip', { hasText: '14 days ago' });
    if (await chip.count()) await chip.first().click();
    await page.locator('#onboarding-root .btn-lg').click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(700);
  await tour(page, 'first launch', { full: false });
  check(errors.length === 0, 'first launch: no page errors', errors[0] ?? '');
  await ctx.close();
}

/* ── 2. A settled, regular cycle with a full diary ──────────────────────── */

{
  const { ctx, page, errors } = await open('a regular cycle, six months of diary', {
    settings: { askSleep: true, askWater: true },
    startsAgo: [12, 40, 68, 96, 124, 152, 180],
    diaryDays: 120,
  });
  await tour(page, 'regular');
  check(errors.length === 0, 'regular: no page errors', errors[0] ?? '');
  await ctx.close();
}

/* ── 3. The same, at the narrowest phone ────────────────────────────────── */

{
  const { ctx, page } = await open('a regular cycle at 320px', {
    settings: {},
    startsAgo: [12, 40, 68, 96, 124],
    diaryDays: 60,
  }, { width: 320 });
  await tour(page, 'narrow', { full: false });
  await ctx.close();
}

/* ── 4. Conceive mode, with ovulation signals ───────────────────────────── */

{
  const { ctx, page } = await open('trying to conceive, with a test and a temperature rise', {
    settings: { mode: 'conceive', unitTemp: 'F', unitWeight: 'lb', unitWater: 'oz' },
    startsAgo: [11, 39, 67, 95],
    diaryDays: 30,
  });
  await tour(page, 'conceive');
  await ctx.close();
}

/* ── 5. Conceive mode with nothing logged to date ovulation ─────────────── */

{
  const { ctx, page } = await open('trying to conceive, nothing to date ovulation yet', {
    settings: { mode: 'conceive' },
    startsAgo: [11, 39],
    diaryDays: 0,
  });
  await tour(page, 'conceive, no signals', { full: false });
  await ctx.close();
}

/* ── 6. A period that is due, then late ─────────────────────────────────── */

for (const [name, ago] of [['due', 27], ['late', 36], ['very late', 50]]) {
  const { ctx, page } = await open(`a period that is ${name}`, {
    settings: {},
    startsAgo: [ago, ago + 28, ago + 56, ago + 84, ago + 112],
    diaryDays: 20,
  });
  await tour(page, `period ${name}`, { full: false });
  await ctx.close();
}

/* ── 7. A long gap, with and without recent check-ins ───────────────────── */

for (const [name, diaryDays] of [['an old gap, no recent logs', 0], ['months without a period, still logging', 40]]) {
  const { ctx, page } = await open(name, {
    settings: {},
    startsAgo: [150, 178, 206, 234],
    diaryDays,
  });
  await tour(page, name, { full: false });
  await ctx.close();
}

/* ── 8. A positive pregnancy test ───────────────────────────────────────── */

{
  const { ctx, page } = await open('a positive pregnancy test', {
    settings: {},
    startsAgo: [20, 48, 76, 104],
    diaryDays: 20,
    extra: { positiveTestAgo: 3 },
  });
  await tour(page, 'pregnancy test', { full: false });
  await ctx.close();
}

/* ── 9. Hormonal birth control with a pill pack ─────────────────────────── */

{
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(); d.setDate(d.getDate() - 9);
  const packStart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const { ctx, page } = await open('the combined pill, with a pack in progress', {
    settings: { birthControl: 'pill-combined', pillRegimen: '21-7', pillPackStart: packStart },
    startsAgo: [12, 40, 68, 96],
    diaryDays: 25,
  });
  await tour(page, 'pill pack');
  await ctx.close();
}

/* ── 10. Onboarded, but with nothing logged ─────────────────────────────── */

{
  const { ctx, page } = await open('set up, with no periods marked yet', {
    settings: { name: '' },
    startsAgo: [],
    diaryDays: 0,
  });
  await tour(page, 'empty');
  await ctx.close();
}

/* ── 11. A backed-up warning and the install nudge ──────────────────────── */

{
  const { ctx, page } = await open('a long unbacked-up history', {
    settings: { lastBackup: '', backupSnoozed: '', installSnoozed: '' },
    startsAgo: [12, 40, 68, 96, 124, 152],
    diaryDays: 100,
  });
  await tour(page, 'unbacked history', { full: false });
  await ctx.close();
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
await browser.close();
process.exit(failures ? 1 : 0);
