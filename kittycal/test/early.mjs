/**
 * early.mjs — what Insights says before there is a history.
 *
 * Stacking cycles takes months. The analysis screen used to refuse to draw
 * anything at all below two of them, so the half of the app that justifies
 * building it was a locked door for exactly the stretch when someone decides
 * whether to keep using it.
 *
 * These walk the same screen at four ages — nothing, a few logged days, one
 * cycle, three cycles — and check that it always says something true, never
 * calls a count a pattern, and always states what is still missing.
 *
 * Run: node test/early.mjs   (with a static server on 8099)
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = 'http://127.0.0.1:8099/';

let pass = 0;
let fail = 0;

/** @param {string} label @param {boolean} cond @param {string} [extra] */
const ok = (label, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok    ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

const browser = await pw.chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

/**
 * Open the app with a given history and land on Insights.
 * @param {{cycles: number, loggedDays: number}} shape
 */
async function insightsWith(shape) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });

  await page.evaluate(async (shape) => {
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

    const base = {
      flow: 'none', symptoms: [], moods: [], discharge: [], activity: [], other: [],
      sex: [], drive: null, custom: [], severity: {}, bbt: null, weight: null, water: 0,
      sleep: null, steps: null, pillTaken: false, testPregnancy: null, testOvulation: null,
      notes: '', checkedIn: true, updated: Date.now(),
    };

    const days = [];
    const logs = [];

    // `cycles` period starts, 28 days apart, the newest 6 days ago — so the
    // most recent cycle is still running.
    for (let c = 0; c < shape.cycles; c += 1) {
      const start = -6 - ((shape.cycles - 1 - c) * 28);
      for (let i = 0; i < 5; i += 1) days.push(shift(start + i));
    }

    /*
      Spread across every cycle, not just the most recent days. A run of logs
      confined to the last month gives plenty of completed cycles and no
      symptom recurring across them, so `detectPatterns` correctly finds
      nothing — which is a fine state for the app and a useless fixture for
      testing the state where it finds something.
    */
    const span = Math.max(1, shape.cycles * 28);
    for (let i = 0; i < shape.loggedDays; i += 1) {
      const back = shape.cycles ? Math.round((i / shape.loggedDays) * (span - 1)) : i;
      logs.push({
        ...base,
        date: shift(-back),
        symptoms: ['cramps'],
        moods: ['irritable'],
      });
    }

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
  }, shape);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    /** @type {HTMLElement|null} */
    (document.querySelector('.sheet-close, [aria-label*="Close"]'))?.click();
  });
  await page.evaluate(async () => (await import('/js/state/store.js')).setView('insights'));
  await page.waitForTimeout(500);

  const headings = await page.$$eval('#view-insights h2', (n) => n.map((h) => h.textContent));
  const text = await page.$eval('#view-insights', (n) => n.textContent ?? '');

  return { page, ctx, errors, headings, text };
}

/* ── Nothing at all ─────────────────────────────────────────────────────── */

console.log('\na brand-new install');
{
  const { ctx, headings, text, errors } = await insightsWith({ cycles: 0, loggedDays: 0 });
  ok('still shows the empty state when there is genuinely nothing',
    /Not enough to analyse yet/.test(text), headings.join(', '));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ── A few days, no period marked ───────────────────────────────────────── */

console.log('\nfour days logged, no period marked yet');
{
  const { ctx, headings, text, errors } = await insightsWith({ cycles: 0, loggedDays: 4 });

  ok('the screen is no longer a locked door',
    !/Not enough to analyse yet/.test(text), text.slice(0, 80));
  ok('it counts what she has logged', headings.includes('What you log most'),
    headings.join(', '));
  ok('and names the commonest thing', /Cramps/.test(text));
  ok('but never calls it a pattern', !headings.includes('Patterns'), headings.join(', '));
  ok('it says a count is not a pattern in so many words',
    /Not a pattern yet/i.test(text));
  ok('and says what is still missing', headings.includes('Still to come'),
    headings.join(', '));
  ok('naming the number of cycles it needs', /3 more cycles/.test(text));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ── One cycle in progress ──────────────────────────────────────────────── */

console.log('\none period marked, mid-cycle');
{
  const { ctx, page, headings, text, errors } = await insightsWith({ cycles: 1, loggedDays: 8 });

  ok('the current cycle gets its own card', headings.includes('This cycle'),
    headings.join(', '));
  ok('with the cycle day on it', /Cycle day/.test(text));

  // One period start means no completed cycle, so there is no length to state.
  ok('no cycle length is claimed from a single period start',
    !headings.includes('Cycle length'), headings.join(', '));

  ok('and no chart is drawn from one point',
    (await page.$$('.chart')).length === 0);
  ok('nothing is headed with an apology for being empty',
    !headings.includes('Patterns') && !headings.includes('Mood by phase'),
    headings.join(', '));
  ok('the guide is not offered when there is nothing to guide',
    (await page.$$('.guide-button')).length === 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ── Two completed cycles ───────────────────────────────────────────────── */

console.log('\nthree periods marked, so two completed cycles');
{
  const { ctx, page, headings, text, errors } = await insightsWith({ cycles: 3, loggedDays: 10 });

  ok('cycle length appears', headings.includes('Cycle length'), headings.join(', '));
  /*
    Scoped to the cycle-length card on purpose. Three period starts give two
    completed cycles but three finished periods, so Period length legitimately
    has enough points to draw — asserting "no chart anywhere" would have been
    asserting a bug.
  */
  const cycleCard = await page.$('.card:has(h2:text-is("Cycle length"))');
  ok('stated in words rather than drawn as a two-point line',
    /Your cycles so far/.test(text) && (await cycleCard.$$('.chart')).length === 0,
    text.match(/Your cycles so far[^.]*\./)?.[0] ?? '(not found)');
  ok('still no patterns claimed', !headings.includes('Patterns'), headings.join(', '));
  ok('and it says one more cycle is needed', /1 more cycle/.test(text));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ── Enough for everything ──────────────────────────────────────────────── */

console.log('\nfive periods marked, so four completed cycles');
{
  const { ctx, page, headings, text, errors } = await insightsWith({ cycles: 5, loggedDays: 30 });

  ok('now there is a chart', (await page.$$('.chart')).length > 0);
  ok('and the reading guide is offered with it',
    (await page.$$('.guide-button')).length === 1);
  ok('patterns take over', headings.includes('Patterns'), headings.join(', '));
  ok('and the plain count card steps aside',
    !headings.includes('What you log most'), headings.join(', '));

  console.log('\n  opening the guide');
  await page.click('.guide-button');
  await page.waitForSelector('.guide-entry');
  const guide = await page.$eval('.sheet-body', (n) => n.textContent ?? '');
  ok('it explains the ringed dot', /ringed/.test(guide));
  ok('it explains the darker strips', /darker/i.test(guide));
  ok('it explains why the mood bars are shares', /shares/i.test(guide));
  ok('and it repeats that none of it is a diagnosis',
    /Nothing here is a diagnosis/i.test(guide));

  const entries = await page.$$eval('.guide-entry h3', (n) => n.map((h) => h.textContent));
  ok('one entry per chart on the screen', entries.length >= 5, JSON.stringify(entries));

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log(`\nearly insights: ${pass}/${pass + fail} checks passed`);
await browser.close();
if (fail) process.exit(1);
