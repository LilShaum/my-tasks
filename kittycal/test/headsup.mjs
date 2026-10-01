/**
 * headsup.mjs — does she hear about her own patterns when they are useful?
 *
 * Insights found her patterns ("Bloating · 3/3 cycles · most often on day 22")
 * and kept them on a screen she has to go and read. The useful moment is the
 * day before, on the screen she opens. These check the card says it then, says
 * nothing the rest of the cycle, leaves good moods out, and counts back from
 * the period so cycles of different lengths agree.
 *
 * Run: npm run test:browser -- headsup
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

/* Four cycles of 27–29 days. Bloating on the four days before each period,
   irritability on the three before it, sore breasts on the last two — and
   "happy" on the fourth day before, which is not something to warn about. */
const SEED = async ({ untilNext }) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('kittycal', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('logs', { keyPath: 'date' });
      d.createObjectStore('meta', { keyPath: 'key' }); d.createObjectStore('blobs', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return key(d); };
  // starts (days ago): last start is 28 - untilNext ago; earlier ones 28 apart-ish
  const lens = [28, 27, 29, 28];
  const starts = [28 - untilNext]; for (const l of lens) starts.push(starts[starts.length - 1] + l);
  const days = []; for (const s of starts) for (let i = 0; i < 5; i++) days.push(ago(s - i));
  const blank = { symptoms: [], moods: [], discharge: [], activity: [], other: [], sex: [], custom: [] };
  const logs = {};
  for (let c = 0; c < starts.length - 1; c++) { const next = starts[c];
    for (let b = 1; b <= 4; b++) { const k = ago(next + b); logs[k] = { date: k, ...blank, symptoms: ['bloating', ...(b <= 2 ? ['tender-breasts'] : [])], moods: b <= 3 ? ['irritable'] : ['happy'] }; } }
  await new Promise((res) => { const tx = db.transaction(['meta','logs'],'readwrite');
    tx.objectStore('meta').put({ key:'settings', value:{ theme:'hellokitty', onboarded:true, disclaimerAck:true, name:'Sam', mode:'cycle', showFertility: true, lastBackupAt: Date.now() } });
    tx.objectStore('meta').put({ key:'periodDays', value: days });
    for (const l of Object.values(logs)) tx.objectStore('logs').put(l);
    tx.oncomplete = () => res(undefined); });
};
const browser = await launchChromium();

async function cardAt(untilNext) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(SEED, { untilNext });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  if (await page.locator('.sheet[data-open="true"]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
  }
  const text = await page.evaluate(() => {
    const card = [...document.querySelectorAll('#view-today .card')]
      .find((c) => /Coming up for you/.test(c.textContent ?? ''));
    return card ? (card.textContent ?? '') : null;
  });
  await ctx.close();
  return text;
}

console.log('\nfour days before her period');
{
  const card = await cardAt(4);
  check(card != null, 'Today says what usually comes next for her');
  check(/Bloating/.test(card ?? '') && /about 4 days before/.test(card ?? ''),
    'bloating, counted back from the period', (card ?? '').slice(0, 120));
  check(/Irritable/.test(card ?? ''), 'and the mood that comes with it');
  check(!/Happy/.test(card ?? ''), 'but not a good mood, which is not a warning');
  check(!/Tender breasts/.test(card ?? ''),
    'and not yet the one that usually starts two days out');
  check(/4 of your last 4 cycles/.test(card ?? ''), 'and says how often, from her own logs');
}

console.log('\nthe report for a doctor says the same thing the way a doctor asks it');
{
  /* Premenstrual symptoms are assessed by how long before the period they
     start; "day 22" drifts with cycle length. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(SEED, { untilNext: 12 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  if (await page.locator('.sheet[data-open="true"]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  await page.locator('[data-tab="insights"]').click();
  await page.waitForTimeout(600);
  await page.locator('button', { hasText: /report/i }).first().click();
  await page.waitForTimeout(1200);
  const rows = await page.evaluate(() => [...document.querySelectorAll('table tr')]
    .map((r) => [...r.children].map((c) => (c.textContent ?? '').trim())));
  const head = rows.find((r) => r.includes('Before a period'));
  const bloating = rows.find((r) => r[0] === 'Bloating');
  check(head != null, 'the recurring-symptoms table has a "Before a period" column');
  check(bloating != null && bloating.includes('from about 4 days before'),
    'and bloating reads "from about 4 days before"', JSON.stringify(bloating));
  await ctx.close();
}

console.log('\ntwelve days before her period');
{
  const card = await cardAt(12);
  check(card == null, 'nothing is said while it is not near', String(card).slice(0, 80));
}

await browser.close();
console.log(`\nheadsup: ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
