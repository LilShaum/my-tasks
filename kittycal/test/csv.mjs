// @ts-nocheck
/**
 * csv.mjs — the spreadsheet seam, through the real buttons.
 *
 * The unit tests cover the writer and the reader in memory. Neither of them
 * can catch the things that actually break this feature: a download that fires
 * with the wrong mime type or no filename, a file input that rejects the file
 * she picked, a confirm sheet that does not say what the parser understood, or
 * a merge that reaches the store and never lands on disk.
 *
 * So this drives it end to end — export through the settings row, read the
 * downloaded bytes, feed a foreign file back through the picker, and check
 * IndexedDB afterwards.
 *
 *     python3 -m http.server 8099 &
 *     node test/csv.mjs http://127.0.0.1:8099
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fails = 0;
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails += 1;
};

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
await p.goto(BASE);

await p.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('kittycal', 1);
    r.onupgradeneeded = () => { const d = r.result;
      d.createObjectStore('logs', { keyPath: 'date' });
      d.createObjectStore('meta', { keyPath: 'key' });
      d.createObjectStore('blobs', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const pad = (n) => String(n).padStart(2, '0');
  const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
  const days = [];
  let at = -90;
  for (let c = 0; c < 4; c += 1) { for (let i = 0; i < 4; i += 1) days.push(shift(at + i)); at += 28; }
  const logs = [shift(-5)].map((date) => ({
    date, flow: 'none', symptoms: ['cramps'], moods: [], discharge: [], activity: [],
    other: [], sex: [], drive: null, custom: [], severity: { cramps: 3 }, bbt: 36.5,
    weight: null, water: 0, sleep: null, steps: null, pillTaken: false,
    testPregnancy: null, testOvulation: null, notes: 'a note, with a comma', checkedIn: true,
    updated: Date.now(),
  }));
  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme: 'hellokitty', onboarded: true, disclaimerAck: true, name: 'Sam',
      lastBackup: shift(0), lastBackupAt: Date.now(), checkinSkipped: shift(0) } });
    tx.objectStore('meta').put({ key: 'periodDays', value: days });
    for (const l of logs) tx.objectStore('logs').put(l);
    tx.oncomplete = () => res();
  });
});

await p.reload();
await p.waitForTimeout(1500);
await p.locator('[data-tab="settings"]').click();
await p.waitForTimeout(800);

// Export as CSV
const row = p.locator('button.row', { hasText: 'Export as a spreadsheet' });
check(await row.count() > 0, 'the CSV export row exists');
const [download] = await Promise.all([ p.waitForEvent('download'), row.click() ]);
const name = download.suggestedFilename();
check(/^kittycal-\d{4}-\d{2}-\d{2}\.csv$/.test(name), 'filename is a dated .csv', name);

const path = await download.path();
const fs = await import('node:fs/promises');
const text = await fs.readFile(path, 'utf8');
const lines = text.trim().split('\r\n');
check(lines[0].startsWith('date,cycle,cycle day,cycle length,period day,flow'),
  'header is the day table', lines[0].slice(0, 60));
check(lines.length === 17, 'a row per period day plus the logged day', `${lines.length - 1} rows`);
check(text.includes('"a note, with a comma"'), 'a note with a comma is quoted');
check(text.includes('Cramps: Severe'), 'severity is written beside its symptom');

// Import a foreign CSV and confirm the merge
const foreign = '/tmp/foreign.csv';
await fs.writeFile(foreign, 'Date,Flow,Notes\n2025-01-06,Heavy,from another app\n2025-01-07,Light,\n');
await p.locator('input[type=file][accept*="csv"]').setInputFiles(foreign);
await p.waitForTimeout(700);
const sheet = await p.locator('.sheet, dialog').first().innerText().catch(() => '');
check(/Bring in 2 days/.test(sheet), 'the sheet says how many days', sheet.split('\n')[0]);
check(/Read the "Date" column as dates/.test(sheet), 'and which column it read as dates');
check(/keeps? as they are|only fills the gaps/.test(sheet), 'and that existing days are kept');

await p.locator('button', { hasText: 'Bring them in' }).first().click();
await p.waitForTimeout(1200);

const stored = await p.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open('kittycal', 1); r.onsuccess = () => res(r.result); });
  const all = await new Promise((res) => { const rq = db.transaction(['logs']).objectStore('logs').getAll(); rq.onsuccess = () => res(rq.result); });
  const meta = await new Promise((res) => { const rq = db.transaction(['meta']).objectStore('meta').get('periodDays'); rq.onsuccess = () => res(rq.result); });
  return { dates: all.map((l) => l.date), periods: meta.value };
});
check(stored.dates.includes('2025-01-06'), 'the imported day is on disk');
check(stored.periods.includes('2025-01-06'), 'and counts as a period day');
check(stored.periods.includes('2025-01-07'), 'a light day counts as a period day too');

console.log(fails ? `\ncsv: ${fails} failed` : '\ncsv: all checks passed');
await browser.close();
process.exit(fails ? 1 : 0);
