/**
 * age.mjs — is she measured against the range that is typical at her age?
 *
 * Onboarding asked for a birth year on the claim that it "helps Kittycal know
 * what is typical for you", and nothing but the printed report ever read it. In
 * the first years of having periods, cycles of 21–45 days are typical (ACOG
 * Committee Opinion No. 651); held to the adult 21–35, a teenager with normal
 * 40-day cycles was told they were worth raising at an appointment.
 *
 * Run: npm run test:browser -- age
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

/* Five cycles of 38–42 days. */
const SEED = async (birthYear) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('kittycal', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('logs', { keyPath: 'date' });
      d.createObjectStore('meta', { keyPath: 'key' }); d.createObjectStore('blobs', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return key(d); };
  const days = []; let back = 10;
  for (const len of [40, 42, 38, 41, 40]) { for (let i = 0; i < 5; i++) days.push(ago(back - i)); back += len; }
  for (let i = 0; i < 5; i++) days.push(ago(back - i));
  await new Promise((res) => { const tx = db.transaction(['meta','logs'],'readwrite');
    tx.objectStore('meta').put({ key:'settings', value:{ theme:'mymelody', onboarded:true, disclaimerAck:true, name:'Ava', birthYear, avgCycleLength: 40, lastBackupAt: Date.now() } });
    tx.objectStore('meta').put({ key:'periodDays', value: days });
    tx.objectStore('logs').put({ date: ago(0), symptoms: [], moods: ['calm'], discharge: [], activity: [], other: [], sex: [], custom: [], checkedIn: true });
    tx.oncomplete = () => res(undefined); });
};
const browser = await launchChromium();
const thisYear = new Date().getFullYear();

for (const [age, label] of [[16, 'a sixteen-year-old'], [31, 'an adult']]) {
  console.log(`\n${label} with 40-day cycles`);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  // eslint-disable-next-line no-await-in-loop
  await page.evaluate(SEED, thisYear - age);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  if (await page.locator('.sheet[data-open="true"]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  const today = await page.evaluate(() => document.querySelector('#view-today')?.textContent ?? '');
  const flagged = /cycles were longer than/.test(today);
  check(age < 18 ? !flagged : flagged,
    age < 18 ? 'is not told her normal cycles are worth a doctor\'s visit' : 'is still flagged, as before');

  await page.locator('[data-tab="insights"]').click();
  await page.waitForTimeout(700);
  // The cycle card's basis line names the band: "The shaded band is the typical 21 to 45."
  const band = await page.evaluate(() =>
    (document.querySelector('#insight-cycle')?.textContent?.match(/typical (\d+) to (\d+)\b/) ?? []).slice(1).join('–'));
  check(band === (age < 18 ? '21–45' : '21–35'), 'and Insights shades the range for her age', band);
  // And the drawn band's upper edge is numbered on the chart itself.
  const edges = await page.$$eval('#insight-cycle .chart text', (n) => n.map((t) => t.textContent));
  check(edges.includes(age < 18 ? '45' : '35') && !edges.includes(age < 18 ? '35' : '45'),
    'and the chart numbers the edge of that band', JSON.stringify(edges));

  await page.locator('[data-tab="settings"]').click();
  await page.waitForTimeout(700);
  const field = await page.evaluate(() => document.querySelector('#set-birth-year')?.value ?? null);
  check(field === String(thisYear - age), 'and her birth year can be seen and changed in Settings', String(field));
  await ctx.close();
}

await browser.close();
console.log(`\nage: ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
