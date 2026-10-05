/**
 * insights.mjs — the redesigned Insights screen, read the way she reads it.
 *
 * Every card on this screen answers a question and its title is the answer:
 * "Regular: your cycles run 27 to 30 days", "Day 2 is usually your heaviest",
 * "Harder days bunch up in the 4 days before your period". The old counter
 * cards (Your history, This cycle, What you log most, Patterns, ...) are gone
 * on purpose, and what is checked here is that their replacements say the
 * right thing for three different people:
 *
 *   regular    seven cycles of 27-30 days, a mood and sleep dip before her
 *              period, short nights and low water going with headaches
 *   irregular  cycles of 26-45 days and periods that run past a week
 *   new        one period and twelve days of logs: nothing to conclude yet
 *
 * and that on every one of them the page holds together: no horizontal
 * overflow at 320 or 390px, no em dash in anything she can read, no empty card
 * title, a screen-reader summary on every chart, no page errors.
 *
 * The seeding is deterministic (a fixed pseudo-random sequence), so a failure
 * is a change in the app and not in the dice.
 *
 * Run: npm run test:browser -- insights
 */

import { launchChromium } from './browser.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8099';

let checks = 0;
let failures = 0;
const check = (cond, label, extra = '') => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

/* ── The three people ───────────────────────────────────────────────────── */

/**
 * Seed IndexedDB for one persona. Runs in the page, so it takes and returns
 * plain data only.
 */
const SEED = async ({ persona }) => {
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
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return key(d); };

  // Deterministic pseudo-random (Park-Miller).
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  const lens = persona === 'irregular' ? [34, 26, 41, 29, 37, 31, 45]
    : persona === 'new' ? [] : [28, 27, 30, 28, 29, 28, 27];
  const periodLens = persona === 'irregular' ? [6, 5, 8, 9, 6, 8, 5] : [5, 5, 6, 5, 5, 4, 5];

  // Days ago that each period began, newest first. The newest began 19 days
  // ago, so the one now running is already over and the next is 9 days off.
  const untilNext = 9;
  const starts = persona === 'new' ? [12] : [28 - untilNext];
  for (const l of lens) starts.push(starts[starts.length - 1] + l);

  const periodDays = [];
  const flowOf = {};
  starts.forEach((s, idx) => {
    const pl = periodLens[idx % periodLens.length];
    const pattern = ['medium', 'heavy', 'heavy', 'medium', 'light', 'light', 'light', 'spotting', 'light'];
    for (let i = 0; i < pl; i += 1) {
      const d = ago(s - i);
      periodDays.push(d);
      flowOf[d] = pattern[i] ?? 'light';
    }
  });

  const blank = { symptoms: [], moods: [], discharge: [], activity: [], other: [], sex: [], custom: [], severity: {} };
  const startAgo = [...starts].sort((a, b) => a - b);
  const span = persona === 'new' ? 12 : startAgo[startAgo.length - 1] + 2;

  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme: 'hellokitty', onboarded: true, disclaimerAck: true, name: 'Sam',
      showFertility: true, mode: 'cycle', lastBackupAt: Date.now(), lastBackup: ago(0),
    } });
    tx.objectStore('meta').put({ key: 'periodDays', value: periodDays });

    for (let i = 1; i <= span; i += 1) {
      if (rnd() < 0.12) continue; // a few missed days
      const s0 = startAgo.find((s) => s >= i);
      if (s0 == null) continue;
      const idx = startAgo.indexOf(s0);
      const cd = s0 - i; // days since that period began
      const next = idx > 0 ? s0 - startAgo[idx - 1] : 28;
      const until = next - cd; // days until the next one

      const r = rnd();
      const moods = rnd() < 0.15 ? []
        : until <= 4 ? (r < 0.55 ? ['irritable'] : r < 0.75 ? ['anxious'] : ['calm'])
          : cd < 2 ? (r < 0.4 ? ['sad'] : ['calm'])
            : (cd > 10 && cd < 16) ? (r < 0.5 ? ['energetic', 'happy'] : ['happy'])
              : r < 0.12 ? ['irritable'] : r < 0.6 ? ['calm'] : ['happy'];
      const sleep = until <= 6 ? [5, 6, 6, 6.5, 7][Math.floor(rnd() * 5)] : [7, 7.5, 8, 8, 8.5][Math.floor(rnd() * 5)];
      const water = [500, 750, 1000, 1500, 1750, 2000, 2250][Math.floor(rnd() * 7)];
      const symptoms = [];
      if (cd < 2 && rnd() < 0.85) symptoms.push('cramps');
      if (cd < 2 && rnd() < 0.6) symptoms.push('backache');
      if (until <= 3 && rnd() < 0.75) symptoms.push('bloating');
      if (until <= 2 && rnd() < 0.6) symptoms.push('tender-breasts');
      if ((water < 1000 && rnd() < 0.55) || rnd() < 0.08) symptoms.push('headache');
      if (sleep < 6 && rnd() < 0.5) symptoms.push('restless-sleep');
      if (rnd() < 0.05) symptoms.push('acne');

      const d = ago(i);
      tx.objectStore('logs').put({
        date: d, ...blank, checkedIn: true, flow: flowOf[d] ?? 'none', moods, symptoms, sleep, water,
        bbt: null, weight: null, steps: null, drive: null, pillTaken: false,
        testPregnancy: null, testOvulation: null, notes: '', updated: Date.now(),
      });
    }
    tx.oncomplete = () => res(undefined);
  });
};

const browser = await launchChromium();

/**
 * Open the app as one persona and land on Insights.
 * @param {string} persona
 * @param {{width?: number, scheme?: 'light'|'dark'}} [opts]
 */
async function open(persona, { width = 390, scheme = 'light' } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(SEED, { persona });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  if (await page.locator('.sheet[data-open="true"]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
  }
  await page.locator('[data-tab="insights"]').click();
  await page.waitForSelector('#view-insights .card, #view-insights .empty');
  await page.waitForTimeout(700);
  return { ctx, page, errors };
}

/** Text of one card's title, or null when the card is not drawn. */
const titleOf = (page, id) => page.$eval(`#insight-${id} h3`, (h) => h.textContent ?? '').catch(() => null);

/* ── regular ────────────────────────────────────────────────────────────── */

console.log('\nregular: seven cycles of 27 to 30 days');
{
  const { ctx, page, errors } = await open('regular');

  const titles = {};
  for (const id of ['cycle', 'periods', 'body', 'mood', 'sleep', 'pairs', 'trends']) {
    titles[id] = await titleOf(page, id);
  }

  // At a glance: one to three findings, each a button that goes to its card.
  const items = await page.$$('.glance-card .glance-item');
  check(items.length >= 1 && items.length <= 3, 'At a glance lists one to three findings', String(items.length));
  check(await page.$eval('#view-insights .data-zone > :first-child', (n) => n.classList.contains('glance-card')),
    'and it is the first thing on the screen');

  for (let i = 0; i < items.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await page.evaluate(async (index) => {
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 200));
      const buttons = document.querySelectorAll('.glance-card .glance-item');
      const label = buttons[index].querySelector('.glance-text')?.textContent ?? '';
      buttons[index].click();
      await new Promise((r) => setTimeout(r, 1200));
      // The card the page came to rest on: the one nearest the top of the viewport.
      const cards = [...document.querySelectorAll('.insight-card')]
        .map((c) => ({ id: c.id, top: c.getBoundingClientRect().top }))
        .sort((a, b) => Math.abs(a.top) - Math.abs(b.top));
      // A card near the end of the page can only come up as far as the page scrolls.
      const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      return { label, scrolled: window.scrollY, id: cards[0]?.id, top: cards[0]?.top, atEnd };
    }, i);
    check(result.scrolled > 0 && result.top > -4 && (result.top < 160 || (result.atEnd && result.top < 420)),
      `tapping "${result.label}" scrolls ${result.id} into view`, JSON.stringify(result));
  }
  await page.evaluate(() => window.scrollTo(0, 0));

  // The cycle card.
  check(/^Regular/.test(titles.cycle ?? ''), 'the cycle title is the finding: it starts "Regular"', String(titles.cycle));
  check(/^Regular: your cycles run \d+ to \d+ days$/.test(titles.cycle ?? ''), 'and gives the range', String(titles.cycle));
  check((await page.$$('#insight-cycle .chart')).length === 1, 'with the cycle-length chart under it');
  const note = await page.$eval('#insight-cycle .insight-note', (n) => n.textContent ?? '').catch(() => '');
  check(/of Kittycal's period forecasts landed within \d+ days/.test(note), 'and one sentence on how close the forecasts were', note);
  const rows = await page.$$('#insight-cycle details.insight-more .cycle-row');
  check(rows.length >= 7, '"See every cycle" folds away a row per cycle', String(rows.length));
  check(await page.$eval('#insight-cycle details.insight-more summary', (s) => s.textContent) === 'See every cycle',
    'under that name');
  await page.$eval('#insight-cycle details.insight-more', (d) => { d.open = true; });
  await rows[0].click();
  await page.waitForSelector('.sheet[data-open="true"]');
  check(/Cycle from/.test(await page.$eval('.sheet[data-open="true"]', (s) => s.textContent ?? '')),
    'and a row opens that cycle');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);

  // The removed counter cards stay removed.
  const allTitles = await page.$$eval('#view-insights .card h3, #view-insights .card h2',
    (n) => n.map((h) => h.textContent));
  const gone = ['Your history', 'This cycle', 'What you log most', 'Patterns', 'Mood by phase', 'Period length',
    'How close Kittycal has been', 'Cycle by cycle', 'Trends', 'Cycle length'];
  check(gone.every((t) => !allTitles.includes(t)), 'none of the old counter cards is back', allTitles.join(' | '));

  // Period fingerprint.
  check((await page.$$('#insight-periods .fingerprint .fp-cell')).length > 0, 'the period fingerprint is drawn');
  check(/heaviest/.test(titles.periods ?? '') || /more than 7 days/.test(titles.periods ?? ''),
    'its title is the finding', String(titles.periods));

  // Body map.
  const body = await page.$('#insight-body .body-map');
  check(body != null, 'the body map is drawn', String(titles.body));
  const bodyText = await page.$eval('#insight-body', (n) => n.textContent ?? '').catch(() => '');
  check(!/Irritable/i.test(bodyText), 'and leaves moods to the mood curve (no "Irritable" row)', bodyText.slice(0, 160));
  const moodsInMap = await page.evaluate(async () => {
    const { CATEGORIES, labelOf } = await import('/js/data/taxonomy.js');
    const moodLabels = CATEGORIES.find((c) => c.id === 'moods').options.map((o) => labelOf(o.id));
    const labels = [...document.querySelectorAll('#insight-body .map-row-label')].map((n) => n.textContent);
    return labels.filter((l) => moodLabels.includes(l));
  });
  check(moodsInMap.length === 0, 'none of the rows is a mood', moodsInMap.join(', '));
  check((await page.$$('#insight-body .map-row')).length >= 1, 'and it has at least one row');

  // Mood and sleep curves.
  check(/before your period/.test(titles.mood ?? ''), 'the mood title names the days before her period', String(titles.mood));
  check((await page.$$('#insight-mood svg.rhythm-chart')).length === 1, 'and draws the curve');
  check(/less the week before/.test(titles.sleep ?? ''), 'the sleep title says she sleeps less the week before', String(titles.sleep));
  check((await page.$$('#insight-sleep svg.rhythm-chart')).length === 1, 'and draws the curve');

  // What goes with what.
  const values = await page.$$eval('#insight-pairs .pb-value', (n) => n.map((v) => v.textContent ?? ''));
  check(values.length >= 2 && values.every((v) => /^\d+ of \d+$/.test(v)),
    'the paired bars carry their counts, "x of n"', JSON.stringify(values));

  // The guide appears because there are charts to explain.
  check((await page.$$('.guide-button')).length === 1, 'the reading guide is offered');

  // Sleep and water are not repeated as counters: each has its own cycle
  // card. With no weight or steps logged, there is no numbers card at all.
  check(titles.trends == null, 'no "recent numbers" card repeating sleep and water as counters', String(titles.trends));
  check(titles.sleep != null, 'sleep keeps its own card, through the cycle', String(titles.sleep));

  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

/* ── irregular ──────────────────────────────────────────────────────────── */

console.log('\nirregular: cycles of 26 to 45 days, periods past a week');
{
  const { ctx, page, errors } = await open('irregular');

  const cycle = await titleOf(page, 'cycle');
  check(/vary/.test(cycle ?? ''), 'the cycle title says her cycles vary', String(cycle));
  const periods = await titleOf(page, 'periods');
  check(/more than 7 days/.test(periods ?? ''), 'the periods title says they ran past 7 days', String(periods));

  const glance = await page.$$eval('.glance-card .glance-item .glance-text', (n) => n.map((t) => t.textContent ?? ''));
  check(glance.some((t) => /past 7 days/.test(t)), 'At a glance includes it', JSON.stringify(glance));
  check(glance.length >= 1 && glance.length <= 3, 'and lists no more than three', String(glance.length));
  check((await page.$$('#insight-periods .hint-sm')).length > 0
    && /worth mentioning to a doctor/.test(await page.$eval('#insight-periods', (n) => n.textContent ?? '')),
  'with a note that it is worth mentioning to a doctor');

  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

/* ── new ────────────────────────────────────────────────────────────────── */

console.log('\nnew: one period and twelve days of logs');
{
  const { ctx, page, errors } = await open('new');

  const first = await page.$eval('#view-insights .data-zone > :first-child', (n) => ({
    cls: n.className, heading: n.querySelector('h2')?.textContent ?? '',
  }));
  check(/still-card/.test(first.cls) && /is-welcome/.test(first.cls), 'the welcome card is first', JSON.stringify(first));
  check(first.heading === 'Your insights are on their way', 'and says so', first.heading);
  check((await page.$$('.glance-card')).length === 0, 'there is no At a glance card');
  check((await page.$$('#view-insights .still-card')).length === 1, 'and "Still to come" is not repeated further down');
  const welcome = await page.$eval('.still-card.is-welcome', (n) => n.textContent ?? '');
  check(/after 3 more cycles/.test(welcome), 'it names how many cycles it needs', welcome.slice(0, 200));
  // Twelve nights of sleep are enough for the plain sleep chart under "Your recent
  // numbers", so the guide is legitimately on offer; what must be absent is every
  // card that needs several cycles.
  check((await page.$$('#insight-cycle, #insight-periods, #insight-body, #insight-mood, #insight-sleep, #insight-pairs')).length === 0,
    'none of the cards that need cycles is drawn');
  const guides = (await page.$$('.guide-button')).length;
  const drawn = (await page.$$('#view-insights .chart')).length;
  check((guides === 1) === (drawn > 0), 'the guide is offered exactly when there is a chart to explain', `${guides} guide, ${drawn} charts`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'nothing overflows sideways');

  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

/* ── a brand-new install, which is not the same as a new person ─────────── */

console.log('\nempty: nothing logged at all');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  /** @type {string[]} */
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
    await new Promise((res) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key: 'settings', value: {
        theme: 'hellokitty', onboarded: true, disclaimerAck: true, name: 'Sam', lastBackupAt: Date.now(),
      } });
      tx.oncomplete = () => res(undefined);
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  if (await page.locator('.sheet[data-open="true"]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
  }
  await page.locator('[data-tab="insights"]').click();
  await page.waitForTimeout(700);

  check(await page.$eval('#view-insights .empty h3', (h) => h.textContent) === 'Your insights will grow here',
    'the empty state greets her');
  const button = page.locator('#view-insights .empty button', { hasText: 'Go to the calendar' });
  check(await button.count() === 1, 'and offers a way to the calendar');
  await button.click();
  await page.waitForTimeout(500);
  check(await page.locator('#view-calendar').isVisible(), 'which goes there');
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

/* ── every persona, every width ─────────────────────────────────────────── */

for (const persona of ['regular', 'irregular', 'new']) {
  for (const width of [320, 390]) {
    console.log(`\n${persona} at ${width}px`);
    const { ctx, page, errors } = await open(persona, { width });

    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - window.innerWidth,
      body: document.body.scrollWidth - window.innerWidth,
      // Anything inside Insights that sticks out past the right edge. The page
      // clips sideways overflow, so a wide child would otherwise go unnoticed.
      wide: [...document.querySelectorAll('#view-insights *')]
        .filter((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && b.right > window.innerWidth + 1; })
        .slice(0, 4).map((n) => `${n.tagName.toLowerCase()}.${String(n.className?.baseVal ?? n.className).split(' ')[0]}`),
    }));
    check(overflow.page <= 0 && overflow.body <= 0, 'the page does not scroll sideways', JSON.stringify(overflow));
    check(overflow.wide.length === 0, 'and nothing in Insights sticks out past the edge', overflow.wide.join(', '));

    const text = await page.$eval('#view-insights', (n) => n.textContent ?? '');
    const labels = await page.$$eval('#view-insights [aria-label]', (n) => n.map((e) => e.getAttribute('aria-label') ?? ''));
    check(!text.includes('—') && !labels.some((l) => l.includes('—')), 'no em dash in anything she can read',
      (text.match(/.{0,30}—.{0,30}/) ?? labels.filter((l) => l.includes('—')))[0] ?? '');

    const h3 = await page.$$eval('#view-insights .insight-card h3', (n) => n.map((h) => (h.textContent ?? '').trim()));
    check(h3.every((t) => t.length > 0), `every insight card has a title (${h3.length} cards)`, JSON.stringify(h3));

    const charts = await page.$$eval(
      '#view-insights .chart, #view-insights .body-map, #view-insights .fingerprint, #view-insights .paired-bars',
      (n) => n.map((c) => ({
        cls: String(c.className?.baseVal ?? c.className).split(' ')[0],
        role: c.getAttribute('role'),
        label: (c.getAttribute('aria-label') ?? '').trim(),
      })),
    );
    check(charts.every((c) => c.role === 'img' && c.label.length > 0),
      `every chart has a screen-reader summary (${charts.length} charts)`, JSON.stringify(charts.filter((c) => c.role !== 'img' || !c.label)));
    check(charts.length > 0 || persona === 'new', 'and charts are drawn where there is data');

    check(errors.length === 0, 'no page errors', errors.join(' | '));
    await ctx.close();
  }
}

/* ── dark mode ──────────────────────────────────────────────────────────── */

console.log('\nregular, dark colour scheme');
{
  const { ctx, page, errors } = await open('regular', { scheme: 'dark' });

  const dark = await page.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.35;
  });
  check(dark, 'the page really is dark');
  check((await page.$$('#view-insights .insight-card')).length >= 5, 'the cards render');
  check((await page.$$('#view-insights svg.rhythm-chart')).length === 2, 'with both curves drawn');
  const cards = await page.$$eval('#view-insights .insight-card', (n) => n.map((c) => {
    const b = c.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  }));
  check(cards.every(Boolean), 'and every card has a size');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'nothing overflows');
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`\ninsights: ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
