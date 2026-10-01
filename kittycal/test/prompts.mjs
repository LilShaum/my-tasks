/**
 * prompts.mjs — does the app ever tell her what logging something would buy?
 *
 * Kittycal can date ovulation from a woman's own body instead of a population
 * average: log a morning temperature or an ovulation test, and after two
 * confirmed cycles `measuredLuteal` replaces the assumed fourteen days with her
 * median. That is the difference between a fertile window placed on a stranger
 * and one placed on her, and it is not a small difference — luteal phases run
 * from about ten days to sixteen, and at eleven days both of the window's peak
 * days are wrong.
 *
 * The machinery for this shipped. The ask never did. The card said where the
 * number came from only when it had been measured, and said nothing in the
 * common case where it had not, so the silence belonged to the guess. A woman
 * could use the app for a year, never be told that two numbers would sharpen
 * the one figure she opened it for, and have no way of discovering it — the
 * controls are real and sit four taps away behind a drawer called Measurements,
 * which is exactly as useful as not having them.
 *
 * So this checks the two halves that make the feature exist for her:
 *
 *   1. The fertile card says which of the two it is doing — her own measurement
 *      or an average — in both modes, not just for people trying to conceive.
 *   2. The offer is a button that lands her on the right section with it open,
 *      not a sentence describing where she could go.
 *
 * It also guards the pregnancy-test card, which replaces a countdown that was
 * being asserted against direct evidence. The assertions there are mostly about
 * what it must *not* say: a home test is hers and a clinician's to interpret,
 * not an app's to announce or congratulate.
 *
 * Run: npm run test:browser -- prompts
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

/**
 * Six tidy cycles, with today sitting mid-cycle so a fertile window exists.
 * @param {{mode: string, log?: Record<string, any>}} opts
 */
const seed = (opts) => async ({ mode, log }) => {
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
  const now = new Date();
  const days = [];
  for (let c = 0; c < 6; c += 1) {
    for (let i = 0; i < 5; i += 1) {
      const d = new Date(now);
      d.setDate(d.getDate() - (c * 28 + (14 - i)));
      days.push(key(d));
    }
  }
  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme: 'hellokitty', onboarded: true, disclaimerAck: true, avgCycleLength: 28,
      avgPeriodLength: 5, name: 'Sam', showFertility: true, mode,
    } });
    tx.objectStore('meta').put({ key: 'periodDays', value: days });
    if (log) tx.objectStore('logs').put({ date: key(now), ...log });
    tx.oncomplete = () => res(undefined);
  });
};

const browser = await launchChromium();

/** A fresh profile, seeded, with the day sheet dismissed. */
async function open({ mode = 'cycle', log = null } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(seed({}), { mode, log });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1700);
  if (await page.locator('.sheet[data-open="true"]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
  }
  return { ctx, page };
}

const cardWith = (page, pattern) => page.evaluate((p) => {
  const card = [...document.querySelectorAll('#view-today .card')]
    .find((c) => new RegExp(p).test(c.textContent ?? ''));
  return card ? (card.innerText ?? '').replace(/\s+/g, ' ').trim() : null;
}, pattern);

for (const mode of ['cycle', 'conceive']) {
  console.log(`\nthe fertile window says where its number came from — mode: ${mode}`);
  const { ctx, page } = await open({ mode });

  const card = await cardWith(page, 'Fertile window');
  check(card != null, 'the fertile card is on screen');
  check(/population average/i.test(card ?? ''),
    'and admits the placement is an average rather than hers', (card ?? '').slice(0, 90));
  check(/temperature/i.test(card ?? '') && /ovulation test/i.test(card ?? ''),
    'and names both things that would replace it');

  // The offer has to be reachable, not merely described.
  for (const [label, section] of [['Add a temperature', 'Measurements'], ['Add a test result', 'Tests']]) {
    const button = page.locator(`#view-today button:has-text("${label}")`).first();
    // eslint-disable-next-line no-await-in-loop
    check(await button.count() === 1, `"${label}" is a button, not a sentence`);
    // eslint-disable-next-line no-await-in-loop
    await button.click();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(900);
    // eslint-disable-next-line no-await-in-loop
    const landed = await page.evaluate((want) => {
      const node = [...document.querySelectorAll('.sheet-body details')]
        .find((d) => d.querySelector('.log-section-title')?.textContent?.trim() === want);
      if (!node) return { found: false };
      const box = node.getBoundingClientRect();
      return { found: true, open: node.open, onScreen: box.top < window.innerHeight && box.bottom > 0 };
    }, section);
    // eslint-disable-next-line no-await-in-loop
    check(landed.found && landed.open && landed.onScreen,
      `and lands on ${section}, already open`, JSON.stringify(landed));
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Escape');
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(600);
  }
  await ctx.close();
}

console.log('\na positive pregnancy test stops the countdown');
{
  const { ctx, page } = await open({ mode: 'cycle', log: {
    testPregnancy: 'positive', symptoms: [], moods: [], discharge: [],
    activity: [], other: [], sex: [], custom: [],
  } });

  const today = await page.evaluate(() =>
    (document.querySelector('#view-today')?.innerText ?? '').replace(/\s+/g, ' ').trim());

  check(/Predictions are paused/i.test(today), 'the paused card replaces the forecast');
  check(!/days to your period|days late/i.test(today),
    'nothing is still counting down to a period', today.slice(0, 140));
  check(!/Fertile window/i.test(today), 'and no fertile window is drawn');

  /*
    What it must not say. A positive test is not always good news and an app
    cannot know which this is, so congratulating her is a real risk and not a
    stylistic one — and announcing a pregnancy is a claim only she and a
    clinician get to make.
  */
  check(!/congratulat|good luck|exciting|wonderful/i.test(today),
    'it does not congratulate her');
  check(!/you are pregnant|you['’]re pregnant/i.test(today),
    'and does not tell her she is pregnant');
  check(/doctor|midwife/i.test(today),
    'but does point at someone who can confirm it');
  check(/Day \d+/.test(today),
    'and keeps the cycle day, which is the figure a clinician asks for');
  await ctx.close();
}

await browser.close();
console.log(`\nprompts: ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
