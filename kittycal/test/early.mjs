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

import { launchChromium } from './browser.mjs';

const BASE = 'http://127.0.0.1:8099/';

let pass = 0;
let fail = 0;

/** @param {string} label @param {boolean} cond @param {string} [extra] */
const ok = (label, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok    ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

const browser = await launchChromium();

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

  const headings = await page.$$eval('#view-insights .card h3', (n) => n.map((h) => h.textContent));
  const text = await page.$eval('#view-insights', (n) => n.textContent ?? '');

  return { page, ctx, errors, headings, text };
}

/* ── Nothing at all ─────────────────────────────────────────────────────── */

console.log('\na brand-new install');
{
  const { ctx, page, headings, text, errors } = await insightsWith({ cycles: 0, loggedDays: 0 });
  ok('still shows the empty state when there is genuinely nothing',
    (await page.$$('#view-insights .empty')).length === 1
    && /Your insights will grow here/.test(text), headings.join(', '));
  ok('with a way to the calendar', /Go to the calendar/.test(text));
  ok('and no welcome card or glance on top of it',
    (await page.$$('.still-card, .glance-card')).length === 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ── A few days, no period marked ───────────────────────────────────────── */

/*
  This used to be a "What you log most" count card ("Cramps, 4 days") with a
  line saying a count is not a pattern. The count card was removed on purpose:
  a number she cannot do anything with is not an insight. In its place the
  screen opens with a welcome that says what it is waiting for.
*/
console.log('\nfour days logged, no period marked yet');
{
  const { ctx, page, headings, text, errors } = await insightsWith({ cycles: 0, loggedDays: 4 });

  ok('the screen is no longer a locked door',
    !/Your insights will grow here/.test(text), text.slice(0, 80));
  const welcome = await page.$('#view-insights .data-zone > :first-child.still-card.is-welcome');
  ok('it opens with the welcome card', welcome != null);
  ok('named as such',
    /Your insights are on their way/.test(await page.$eval('#view-insights .still-card h2', (h) => h.textContent ?? '')));
  ok('no glance list, since there is nothing to glance at',
    (await page.$$('.glance-card')).length === 0);
  ok('the count of what she logged is not dressed up as a card',
    !headings.includes('What you log most') && !headings.includes('Your history'), headings.join(', '));
  ok('and it never calls anything a pattern', !headings.includes('Patterns') && !/Not a pattern yet/i.test(text),
    headings.join(', '));
  ok('it says why it is waiting', /waits until there is enough to be sure/.test(text));
  ok('and what each missing card needs, naming the number of cycles',
    /Your cycle chart: after 3 more cycles/.test(text), text.slice(0, 200));
  ok('no cycle card, fingerprint or body map is drawn from nothing',
    (await page.$$('#insight-cycle, #insight-periods, #insight-body')).length === 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ── One cycle in progress ──────────────────────────────────────────────── */

console.log('\none period marked, mid-cycle');
{
  const { ctx, page, headings, text, errors } = await insightsWith({ cycles: 1, loggedDays: 8 });

  /*
    "This cycle" (cycle day, days logged) was removed: it was a counter, and
    Today already says which cycle day it is. With one period there is still
    nothing to compare, so the welcome card leads.
  */
  ok('the welcome card leads while there is only one period',
    (await page.$$('#view-insights .data-zone > :first-child.still-card.is-welcome')).length === 1,
    headings.join(', '));
  ok('and the counter card for this cycle is gone',
    !headings.includes('This cycle') && !/Cycle day/.test(text), headings.join(', '));

  // One period start means no completed cycle, so there is no length to state.
  ok('no cycle length is claimed from a single period start',
    (await page.$$('#insight-cycle')).length === 0 && !/Your first full cycle/.test(text),
    headings.join(', '));
  ok('and says the chart is three cycles away', /Your cycle chart: after 3 more cycles/.test(text),
    text.slice(0, 200));
  ok('and the fingerprint waits for the next period', /Your period fingerprint: after your next period/.test(text),
    text.slice(0, 200));

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

  const cycleCard = await page.$('#insight-cycle');
  ok('the cycle card appears', cycleCard != null, headings.join(', '));
  /*
    Scoped to the cycle card on purpose: other cards may legitimately draw
    something at this age, so "no chart anywhere" would be asserting the wrong
    thing. Two dots are a line, not a pattern, so the cycle card says it in words.
  */
  const title = cycleCard ? await cycleCard.$eval('h3', (h) => h.textContent ?? '') : '';
  ok('its title states the lengths rather than drawing a two-point line',
    /^Your cycles so far: 28 and 28 days$/.test(title) && (await cycleCard.$$('.chart')).length === 0,
    title || '(not found)');
  ok('it does not judge regularity from two cycles',
    !/^Regular|vary/.test(title) && (await cycleCard.$$('.insight-note')).length === 0);
  ok('and says one more cycle makes the chart',
    /A chart appears after 1 more cycle/.test(await cycleCard.innerText()));
  ok('the still-to-come list says the same', /Your cycle chart: after 1 more cycle/.test(text));
  ok('still no patterns claimed', !headings.includes('Patterns'), headings.join(', '));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ── Enough for everything ──────────────────────────────────────────────── */

console.log('\nfive periods marked, so four completed cycles');
{
  const { ctx, page, headings, text, errors } = await insightsWith({ cycles: 5, loggedDays: 30 });

  ok('now there is a chart', (await page.$$('#insight-cycle .chart')).length === 1);
  ok('the cycle title is the finding', /^Regular: your cycles are all 28 days$/.test(
    await page.$eval('#insight-cycle h3', (h) => h.textContent ?? '')));
  ok('and the reading guide is offered with it',
    (await page.$$('.guide-button')).length === 1);
  ok('findings lead, so At a glance opens the screen',
    (await page.$$('#view-insights .data-zone > :first-child.glance-card')).length === 1,
    headings.join(', '));
  ok('and the welcome has stepped down to a plain "Still to come"',
    (await page.$$('.still-card.is-welcome')).length === 0);
  ok('and the plain count card stays gone',
    !headings.includes('What you log most') && !headings.includes('Your history'), headings.join(', '));

  console.log('\n  opening the guide');
  await page.click('.guide-button');
  await page.waitForSelector('.guide-entry');
  const guide = await page.$eval('.sheet-body', (n) => n.textContent ?? '');
  ok('it explains the ringed dot', /ringed/.test(guide));
  ok('it explains the darker dots and squares', /darker/i.test(guide));
  ok('it explains which way the curves run', /Left is the start of your period/i.test(guide));
  ok('and it repeats that none of it is a diagnosis',
    /Nothing here is a diagnosis/i.test(guide));

  const entries = await page.$$eval('.guide-entry h3', (n) => n.map((h) => h.textContent));
  ok('one entry per kind of chart on the screen', entries.length >= 5, JSON.stringify(entries));

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/* ── The groups, at every age ───────────────────────────────────────────── */

/*
  Insights is grouped into named sections, and every card in it decides for
  itself whether it has anything to say. Those two facts fight: at three days
  of use most cards stand down, and a group whose cards have all gone is a
  heading over nothing — which is worse than no heading, because it reads as a
  section that failed to load.

  Checked at all four ages rather than one, since which cards survive is
  exactly what changes between them.
*/
console.log('\nno group is ever a heading over nothing');
for (const shape of [
  { cycles: 0, loggedDays: 3 },
  { cycles: 1, loggedDays: 12 },
  { cycles: 3, loggedDays: 40 },
  { cycles: 6, loggedDays: 120 },
]) {
  const { page, ctx, errors } = await insightsWith(shape);
  const label = `${shape.cycles} cycles, ${shape.loggedDays} days logged`;

  const groups = await page.$$eval('#view-insights .insight-group', (nodes) =>
    nodes.map((g) => ({
      label: g.querySelector('.section-label')?.textContent ?? '(unnamed)',
      cards: g.querySelectorAll('.card').length,
    })));

  ok(`${label}: every group has cards`,
    groups.every((g) => g.cards > 0),
    JSON.stringify(groups.filter((g) => !g.cards)));

  ok(`${label}: every group is named`,
    groups.every((g) => g.label !== '(unnamed)'), JSON.stringify(groups));

  /*
    And the heading levels still descend without a gap: h1 in the app header
    names the view, h2 names the group, h3 names the card. The cards were h2
    before the groups existed, so getting this wrong was one careless find and
    replace away.
  */
  const levels = await page.$$eval('#view-insights h1, #view-insights h2, #view-insights h3',
    (nodes) => nodes.map((n) => Number(n.tagName[1])));
  const skips = levels.filter((lvl, i) => i > 0 && lvl > levels[i - 1] + 1);
  ok(`${label}: no heading level is skipped`, skips.length === 0, JSON.stringify(levels));

  ok(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log(`\nearly insights: ${pass}/${pass + fail} checks passed`);
await browser.close();
if (fail) process.exit(1);
