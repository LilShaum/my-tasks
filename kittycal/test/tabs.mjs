/**
 * tabs.mjs — two tabs of the app, open at once, both logging.
 *
 * Every write sends the whole in-memory value of a slice rather than a diff,
 * which is correct for one tab and destructive with two: the second tab holds
 * whatever it loaded when it opened, and logging anything there writes that
 * stale copy over everything the first tab has saved since.
 *
 * Before the fix this file guards, tab A logging cramps and tab B logging
 * headache left only headache on disk. Silent, total, and the worst class of
 * bug this app can have.
 *
 * Run: npm run test:browser -- tabs
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

const SEED = async () => {
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
  const { emptyLog } = await import('/js/domain/model.js');
  const periodDays = [];
  let start = -14;
  for (const len of [29, 27, 30]) {
    for (let i = 0; i < 5; i += 1) periodDays.push(shift(start + i));
    start -= len;
  }
  const logs = [];
  for (let i = 1; i < 40; i += 1) logs.push({ ...emptyLog(shift(-i)), checkedIn: true });
  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    for (const l of logs) tx.objectStore('logs').put(l);
    tx.objectStore('meta').put({ key: 'periodDays', value: periodDays });
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme: 'hellokitty', onboarded: true, disclaimerAck: true,
      avgCycleLength: 28, avgPeriodLength: 5, name: 'Sam',
      lastBackup: shift(0), lastBackupAt: Date.now(),
    } });
    tx.oncomplete = () => res(undefined);
  });
};

const settle = async (page, ms = 1700) => {
  await page.waitForTimeout(ms);
  if (await page.locator('.sheet[data-open="true"]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
  }
};

/** Log one symptom through the store's own write path. */
const logSymptom = (page, id) => page.evaluate(async (id) => {
  const store = await import('/js/state/store.js');
  const { todayKey } = await import('/js/utils/date.js');
  const log = store.getLog(todayKey());
  store.putLog({ ...log, symptoms: [...new Set([...log.symptoms, id])], checkedIn: true });
  await store.flushNow();
}, id);

const browser = await launchChromium();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});

const a = await ctx.newPage();
await a.goto(BASE, { waitUntil: 'networkidle' });
await a.evaluate(SEED);
await a.reload({ waitUntil: 'networkidle' });
await settle(a);

/*
  The second tab opens *before* the first one writes. That ordering is the
  whole point: its in-memory copy of today is a snapshot taken before anything
  tab A is about to do, which is exactly the state a real second tab is in.
*/
const b = await ctx.newPage();
await b.goto(BASE, { waitUntil: 'networkidle' });
await settle(b);

console.log('\ntwo tabs, both logging, neither reloaded');
await logSymptom(a, 'cramps');
await a.waitForTimeout(700);
await logSymptom(b, 'headache');
await b.waitForTimeout(900);

const onDisk = await b.evaluate(async () => {
  const { todayKey } = await import('/js/utils/date.js');
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('kittycal', 1);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return new Promise((res) => {
    const tx = db.transaction('logs', 'readonly');
    const g = tx.objectStore('logs').get(todayKey());
    g.onsuccess = () => res(g.result?.symptoms ?? []);
  });
});

check(onDisk.includes('cramps'), 'the first tab’s entry survives', JSON.stringify(onDisk));
check(onDisk.includes('headache'), 'and so does the second tab’s', JSON.stringify(onDisk));

/*
  The second tab must also *show* the merged truth, not just fail to destroy
  it. A tab displaying a record that disagrees with storage is how someone
  ends up deleting an entry they cannot see.
*/
const shown = await b.evaluate(async () => {
  const store = await import('/js/state/store.js');
  const { todayKey } = await import('/js/utils/date.js');
  return store.getLog(todayKey()).symptoms;
});
check(shown.includes('cramps') && shown.includes('headache'),
  'and the second tab is showing both, not a stale copy', JSON.stringify(shown));

await browser.close();
console.log(`\ntabs: ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
