/**
 * smartcheckin.mjs — the check-in knows where she is in her cycle.
 *
 *   - The symptom question marks what she usually has at this point, "often
 *     now", without moving the buttons she knows.
 *   - Something she logs all month is not "often now" just because it also
 *     happens before her period.
 *   - On a period day, the bleeding question reminds her what yesterday was,
 *     without choosing for her.
 *
 * Run: node test/run-browser.mjs smartcheckin
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
 * Four complete 28-day cycles and a current one that started `ago` days ago.
 * Bloating the three days before every period, cramps on its first two days,
 * headaches every third day regardless.
 */
const seed = async ({ ago, yesterday }) => {
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
  const starts = [0, 1, 2, 3, 4].map((k) => -ago - 28 * k);
  const periodDays = [];
  for (const s of starts) for (let i = 0; i < 5; i += 1) if (s + i <= 0) periodDays.push(shift(s + i));
  /** @type {Record<string, any>} */
  const logs = {};
  const blank = (date) => ({ date, flow: 'none', symptoms: [], moods: [], discharge: [], activity: [],
    other: [], sex: [], custom: [], severity: {}, notes: '', checkedIn: true });
  for (let n = -ago - 28 * 4; n < 0; n += 1) {
    const s = Math.max(...starts.filter((x) => x <= n));
    const day = n - s + 1;
    const until = s + 28 - n;
    const log = blank(shift(n));
    if (day <= 5) log.flow = ['heavy', 'heavy', 'medium', 'light', 'light'][day - 1];
    if (day <= 2) log.symptoms.push('cramps');
    if (until <= 3) log.symptoms.push('bloating');
    if (n % 3 === 0) log.symptoms.push('headache');
    logs[log.date] = log;
  }
  if (yesterday === 'unlogged') delete logs[shift(-1)];
  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme: 'hellokitty', onboarded: true, disclaimerAck: true, avgCycleLength: 28,
      avgPeriodLength: 5, lastBackup: shift(0), lastBackupAt: Date.now(),
    } });
    tx.objectStore('meta').put({ key: 'periodDays', value: periodDays });
    for (const log of Object.values(logs)) tx.objectStore('logs').put(log);
    tx.oncomplete = () => res(undefined);
  });
};

const browser = await launchChromium();

/** Open the check-in and return its first-question hint and the symptom options. */
async function run({ ago, yesterday = 'logged' }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(seed, { ago, yesterday });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  if (!(await page.locator('.checkin-title').count())) {
    await page.locator('button:has-text("Check in for today")').click();
    await page.waitForTimeout(500);
  }
  const hint = await page.locator('.checkin-step .hint').first().textContent().catch(() => null);
  await page.locator('.checkin-option[data-opt="none"]').click();
  await page.waitForTimeout(300);
  await page.locator('.checkin-next').click();
  await page.waitForTimeout(400);
  const options = await page.$$eval('.checkin-option', (n) => n.map((b) => ({
    id: b.getAttribute('data-opt'),
    note: b.querySelector('.checkin-option-note')?.textContent ?? '',
  })));
  await ctx.close();
  return { hint, options, errors };
}

const noted = (options) => options.filter((o) => o.note === 'often now').map((o) => o.id);

console.log('\ntwo days before her period');
{
  const { options, errors } = await run({ ago: 26 });
  check(noted(options).includes('bloating'), 'bloating is marked "often now"', JSON.stringify(noted(options)));
  check(!noted(options).includes('headache'),
    'headaches she logs all month are not, though they also fall before her period', JSON.stringify(noted(options)));
  check(options.length === 8, 'still eight answers', String(options.length));
  check(errors.length === 0, 'no page errors', errors.join(' | '));
}

console.log('\nthe second day of her period');
{
  const { hint, options } = await run({ ago: 1 });
  check(noted(options).includes('cramps'), 'cramps are marked "often now"', JSON.stringify(noted(options)));
  check(hint === 'Yesterday: heavy.', 'the bleeding question says what yesterday was', String(hint));
  const first = options.slice(0, 4).map((o) => o.id);
  check(first[0] === 'cramps', 'the familiar order is kept, not reshuffled around the note', first.join(','));
}

console.log('\nyesterday marked as a period day but never logged');
{
  const { hint } = await run({ ago: 1, yesterday: 'unlogged' });
  check(hint === 'Yesterday was a period day.', 'it still says so, without inventing a level', String(hint));
}

console.log('\nmid-cycle, nothing usual');
{
  const { hint, options } = await run({ ago: 14 });
  check(noted(options).length === 0, 'nothing is marked', JSON.stringify(noted(options)));
  check(hint === null, 'and the bleeding question has no hint', String(hint));
}

await browser.close();
console.log(`\nsmart check-in: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
