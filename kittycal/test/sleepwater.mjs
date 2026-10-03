/**
 * sleepwater.mjs — the check-in's sleep and water questions, in a real browser.
 *
 * The check-in used to ask three things: bleeding, mood, symptoms. Sleep and
 * water are now asked as well, unless she has switched them off in Settings,
 * and the order matters because the first question has a shortcut that skips
 * the next two:
 *
 *   1. Bleeding   one tap, moves on
 *   2. Mood       Next
 *   3. Symptoms   Next
 *   4. Sleep      hours, and how well; Next
 *   5. Water      one tap on a number of glasses, moves on; or Skip
 *   6. Temperature (only for someone who keeps one — prompts.mjs covers it)
 *
 * What these guard, in the order they would hurt:
 *
 *   - "Nothing to report today" is the quiet-day button. Before sleep and water
 *     it finished the check-in. It must now land on sleep and not close the
 *     sheet, or the two new questions are never asked on exactly the days she
 *     does the least — but it must still finish when there is nothing further
 *     to ask, or switching the questions off leaves a button that goes nowhere.
 *   - Sleep quality is stored as the symptoms that already exist for it, so a
 *     bad night reaches Patterns without a new field. Picking one has to clear
 *     the other two, or "restless" and "barely slept" both end up on the day.
 *   - One tap of water stores glasses times the glass size she chose. Getting
 *     the multiplication wrong would mis-state every day's water silently.
 *   - Water added from Today before she has checked in must not count as having
 *     logged the day, or the first drink cancels the questions.
 *
 * Run: node test/run-browser.mjs sleepwater
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
 * A finished user with five tidy cycles behind her, so the week strip has days
 * that count as missed, and today sits mid-cycle.
 */
const seed = async ({ settings, logs }) => {
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
  const days = [];
  for (let cyc = 4; cyc >= 0; cyc -= 1) {
    for (let i = 0; i < 5; i += 1) days.push(shift(-14 - cyc * 28 + i));
  }
  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme: 'hellokitty', onboarded: true, disclaimerAck: true,
      avgCycleLength: 28, avgPeriodLength: 5, name: 'Sam',
      lastBackup: shift(0), lastBackupAt: Date.now(),
      ...settings,
    } });
    tx.objectStore('meta').put({ key: 'periodDays', value: days });
    for (const log of logs) {
      const { offset = 0, ...fields } = log;
      tx.objectStore('logs').put({
        flow: 'none', symptoms: [], moods: [], discharge: [], activity: [],
        other: [], sex: [], custom: [], severity: {}, notes: '', ...fields,
        date: shift(offset),
      });
    }
    tx.oncomplete = () => res(undefined);
  });
};

const browser = await launchChromium();

/**
 * Seed, reload, and wait for the app to settle.
 *
 * @param {{settings?: Record<string, any>, logs?: Record<string, any>[],
 *   keepSheet?: boolean}} [opts]
 *   keepSheet leaves the check-in that opens by itself on load, for the cases
 *   where whether it opens is the question.
 */
async function open({ settings = {}, logs = [], keepSheet = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(seed, { settings, logs });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1700);
  if (!keepSheet && await page.locator('.sheet[data-open="true"]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
  }
  return { ctx, page };
}

/** Start today's check-in from the button on Today. */
async function startCheckin(page) {
  await page.locator('button:has-text("Check in for today")').click();
  await page.waitForTimeout(700);
}

const sheetOpen = (page) => page.locator('.sheet[data-open="true"]').count().then((n) => n > 0);
const title = (page) => page.locator('.checkin-title').innerText().catch(() => '');
const dots = (page) => page.locator('.checkin-dot').count();
const activeDot = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.checkin-dot')].findIndex((d) => d.classList.contains('is-active')));
const pressed = (page, sel) => page.locator(sel).getAttribute('aria-pressed');
const settle = (page, ms = 350) => page.waitForTimeout(ms);

/** The saved log for a day, read off the disk rather than out of memory. */
const logOnDisk = (page, offset = 0) => page.evaluate(async (off) => {
  const d = new Date(); d.setDate(d.getDate() + off);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const db = await new Promise((res) => {
    const r = indexedDB.open('kittycal', 1); r.onsuccess = () => res(r.result);
  });
  return new Promise((res) => {
    const g = db.transaction(['logs'], 'readonly').objectStore('logs').get(key);
    g.onsuccess = () => res(g.result ?? null);
  });
}, offset);

/** Bleeding: none. Mood: Next. Symptoms: Next — so the sleep question is up. */
async function toSleep(page, { symptom } = {}) {
  await page.locator('.checkin-option[data-opt="none"]').click();
  await settle(page);
  await page.locator('.checkin-next').click();
  await settle(page);
  if (symptom) {
    await page.locator(`.checkin-option[data-opt="${symptom}"]`).click();
    await settle(page, 200);
  }
  await page.locator('.checkin-next').click();
  await settle(page);
}

/* ── 1. The order, with everything on ─────────────────────────────────── */
console.log('\nthe check-in asks about sleep and then water, after symptoms');
{
  const { ctx, page } = await open();
  await startCheckin(page);

  check(await dots(page) === 5, 'the defaults give five questions', String(await dots(page)));

  const seen = [await title(page)];
  await page.locator('.checkin-option[data-opt="none"]').click();
  await settle(page);
  seen.push(await title(page));
  await page.locator('.checkin-next').click();
  await settle(page);
  seen.push(await title(page));
  const symptomsButton = (await page.locator('.checkin-next').innerText()).trim();
  await page.locator('.checkin-next').click();
  await settle(page);
  seen.push(await title(page));
  const sleepButton = (await page.locator('.checkin-next').innerText()).trim();
  await page.locator('.checkin-next').click();
  await settle(page);
  seen.push(await title(page));

  check(/bleeding/i.test(seen[0]) && /feeling/i.test(seen[1]) && /bothering/i.test(seen[2]),
    'bleeding, mood and symptoms come first, in that order', seen.slice(0, 3).join(' | '));
  check(seen[3] === 'How did you sleep last night?',
    'sleep follows symptoms', seen[3]);
  check(seen[4] === 'How much water so far today?',
    'and water follows sleep', seen[4]);
  check(symptomsButton === 'Next' && sleepButton === 'Next',
    'neither symptoms nor sleep says Done, because there is more to come',
    `${symptomsButton} / ${sleepButton}`);
  check(await activeDot(page) === 4, 'water is the fifth dot', String(await activeDot(page)));
  const step = await page.evaluate(() => document.querySelector('.sheet')?.textContent?.match(/Step \d of \d/)?.[0]);
  check(step === 'Step 5 of 5', 'and says so for anyone who cannot see the dots', step);
  await ctx.close();
}

/* ── 2. Sleep hours and quality ───────────────────────────────────────── */
console.log('\nsleep: hours, and how well');
{
  const { ctx, page } = await open();
  await startCheckin(page);
  await toSleep(page);

  const hourLabels = await page.evaluate(() =>
    [...document.querySelectorAll('.checkin-options:not(.is-3) .checkin-option')]
      .map((b) => [b.dataset.opt, (b.textContent ?? '').trim()]));
  check(hourLabels.map((h) => h[0]).join(',') === '5,6,7,8,9,10',
    'hours run from five to ten, six choices', JSON.stringify(hourLabels));
  check(hourLabels[0]?.[1] === 'Under 6h' && hourLabels[5]?.[1] === '10h+',
    'with the ends labelled "Under 6h" and "10h+"', JSON.stringify([hourLabels[0], hourLabels[5]]));
  check(await page.locator('.checkin-option[data-opt="4"]').count() === 0,
    'and there is no four-hour button any more');

  const seven = '.checkin-option[data-opt="7"]';
  check(await pressed(page, seven) === 'false', 'nothing is pre-selected');
  await page.locator(seven).click();
  check(await pressed(page, seven) === 'true', 'tapping an hour selects it');
  await page.locator('.checkin-option[data-opt="8"]').click();
  check(await pressed(page, seven) === 'false'
    && await pressed(page, '.checkin-option[data-opt="8"]') === 'true',
  'and picking another moves the selection');
  await page.locator('.checkin-option[data-opt="8"]').click();
  check(await pressed(page, '.checkin-option[data-opt="8"]') === 'false',
    'tapping the selected hour again clears it');
  await page.locator(seven).click();

  const group = '.checkin-subgroup .checkin-option';
  check(await page.locator(group).count() === 3, 'quality is three choices under the hours');
  const states = async () => ({
    well: await pressed(page, `${group}[data-opt="well"]`),
    restless: await pressed(page, `${group}[data-opt="restless"]`),
    barely: await pressed(page, `${group}[data-opt="barely"]`),
  });

  await page.locator(`${group}[data-opt="restless"]`).click();
  let s = await states();
  check(s.restless === 'true' && s.well === 'false' && s.barely === 'false',
    'picking restless selects only that', JSON.stringify(s));
  await page.locator(`${group}[data-opt="barely"]`).click();
  s = await states();
  check(s.barely === 'true' && s.restless === 'false' && s.well === 'false',
    'switching to barely unselects restless', JSON.stringify(s));
  await page.locator(`${group}[data-opt="barely"]`).click();
  s = await states();
  check(s.barely === 'false', 'and tapping it again clears it', JSON.stringify(s));

  // Hours and quality are independent: choosing quality must not touch hours.
  check(await pressed(page, seven) === 'true', 'quality leaves the hours alone');
  await ctx.close();
}

/**
 * Run the check-in through a given sleep answer and return what was saved.
 * @param {{hours?: string, taps: string[], symptom?: string}} opts
 */
async function saveSleep({ hours, taps, symptom }) {
  const { ctx, page } = await open();
  await startCheckin(page);
  await toSleep(page, { symptom });
  if (hours) await page.locator(`.checkin-option[data-opt="${hours}"]`).click();
  for (const tap of taps) {
    await page.locator(`.checkin-subgroup .checkin-option[data-opt="${tap}"]`).click();
  }
  await page.locator('.checkin-next').click();
  await settle(page);
  await page.locator('.checkin-shortcut', { hasText: 'Skip' }).click();
  await settle(page, 900);
  const log = await logOnDisk(page);
  await ctx.close();
  return log;
}

console.log('\nwhat sleep stores');
{
  let log = await saveSleep({ hours: '7', taps: [] });
  check(log?.sleep === 7, 'seven hours is stored as the number 7', String(log?.sleep));
  check(!log?.symptoms.includes('restless-sleep') && !log?.symptoms.includes('insomnia'),
    'and with no quality chosen adds no symptom', JSON.stringify(log?.symptoms));

  log = await saveSleep({ hours: '5', taps: [] });
  check(log?.sleep === 5, 'the first choice, "Under 6h", is stored as 5', String(log?.sleep));

  log = await saveSleep({ hours: '10', taps: [] });
  check(log?.sleep === 10, 'and the last, "10h+", as 10', String(log?.sleep));

  log = await saveSleep({ hours: '6', taps: ['restless'], symptom: 'cramps' });
  check(log?.symptoms.includes('restless-sleep'),
    'restless adds the restless-sleep symptom', JSON.stringify(log?.symptoms));
  check(log?.symptoms.includes('cramps'),
    'next to the symptoms she had already ticked', JSON.stringify(log?.symptoms));
  check(!log?.symptoms.includes('insomnia'), 'and not insomnia');

  log = await saveSleep({ hours: '5', taps: ['restless', 'barely'] });
  check(log?.symptoms.includes('insomnia') && !log?.symptoms.includes('restless-sleep'),
    'switching from restless to barely leaves insomnia only', JSON.stringify(log?.symptoms));

  log = await saveSleep({ hours: '8', taps: ['restless', 'barely', 'well'] });
  check(!log?.symptoms.includes('insomnia') && !log?.symptoms.includes('restless-sleep'),
    'switching on to well leaves neither', JSON.stringify(log?.symptoms));
  check(log?.sleep === 8, 'while the hours still land', String(log?.sleep));

  log = await saveSleep({ hours: '8', taps: ['barely', 'barely'] });
  check(!log?.symptoms.includes('insomnia'),
    'tapping barely twice clears it again', JSON.stringify(log?.symptoms));

  log = await saveSleep({ taps: [] });
  check(log?.sleep == null, 'leaving sleep blank stores no hours', String(log?.sleep));
  check(log?.checkedIn === true, 'and still counts as checked in');
}

/* ── 3. Water ─────────────────────────────────────────────────────────── */

/** Bleeding none, Next, Next, Next: the water question is up. */
async function toWater(page) {
  await toSleep(page);
  await page.locator('.checkin-next').click();
  await settle(page);
}

console.log('\nwater: one tap, glasses times the glass size');
{
  let { ctx, page } = await open();
  await startCheckin(page);
  await toWater(page);

  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.checkin-option')].map((b) => b.dataset.opt));
  check(labels.join(',') === '0,1,2,3,4,5,6,7,8', 'zero to eight glasses are offered',
    labels.join(','));
  const hint = await page.locator('.sheet .hint').innerText();
  check(/250/.test(hint), 'and the hint says how big a glass is', hint);

  await page.locator('.checkin-option[data-opt="3"]').click();
  await settle(page, 1000);
  check(!await sheetOpen(page), 'one tap finishes the check-in, with no Next to press');
  let log = await logOnDisk(page);
  check(log?.water === 750, 'three glasses is stored as 3 x 250 = 750', String(log?.water));
  check(log?.checkedIn === true && log?.flow === 'none', 'and the day is checked in');
  await ctx.close();

  ({ ctx, page } = await open({ settings: { glassMl: 500 } }));
  await startCheckin(page);
  await toWater(page);
  const bigHint = await page.locator('.sheet .hint').innerText();
  check(/500/.test(bigHint), 'a 500 ml glass is reflected in the hint', bigHint);
  await page.locator('.checkin-option[data-opt="2"]').click();
  await settle(page, 1000);
  log = await logOnDisk(page);
  check(log?.water === 1000, 'and two glasses of 500 ml is stored as 1000', String(log?.water));
  await ctx.close();

  ({ ctx, page } = await open({ settings: { glassMl: 200 } }));
  await startCheckin(page);
  await toWater(page);
  await page.locator('.checkin-option[data-opt="8"]').click();
  await settle(page, 1000);
  log = await logOnDisk(page);
  check(log?.water === 1600, 'eight glasses of 200 ml is 1600', String(log?.water));
  await ctx.close();

  ({ ctx, page } = await open());
  await startCheckin(page);
  await toWater(page);
  check((await page.locator('.checkin-option[data-opt="0"]').innerText()).trim() === 'None yet',
    'today\u2019s zero reads "None yet"');
  await page.locator('.checkin-option[data-opt="0"]').click();
  await settle(page, 1000);
  log = await logOnDisk(page);
  check(!await sheetOpen(page) && !log?.water && log?.checkedIn === true,
    'the zero option finishes with no water recorded', JSON.stringify(log?.water));
  await ctx.close();
}

console.log('\nskipping the water question');
{
  const { ctx, page } = await open();
  await startCheckin(page);
  await toWater(page);
  const skip = page.locator('.checkin-shortcut');
  check((await skip.innerText()).trim() === 'Skip', 'the water question has a Skip');
  await skip.click();
  await settle(page, 1000);
  check(!await sheetOpen(page), 'Skip finishes the check-in');
  const log = await logOnDisk(page);
  check(!log?.water, 'and leaves water at nothing', String(log?.water));
  check(log?.checkedIn === true, 'while the day still counts as checked in');
  await ctx.close();
}

/* ── 4. The quiet-day shortcut ────────────────────────────────────────── */
console.log('\n"Nothing to report today" still asks about sleep and water');
{
  const { ctx, page } = await open();
  await startCheckin(page);

  const shortcut = page.locator('.checkin-shortcut');
  check((await shortcut.innerText()).trim() === 'Nothing to report today',
    'the shortcut is labelled for today');
  await shortcut.click();
  await settle(page);

  check(await sheetOpen(page), 'it does not close the sheet');
  check(await title(page) === 'How did you sleep last night?',
    'it lands on the sleep question', await title(page));
  check(await activeDot(page) === 3, 'which is the fourth dot', String(await activeDot(page)));
  check(await page.locator('.checkin-dot.is-done').count() === 3,
    'with the three before it marked done');
  check(await logOnDisk(page) === null,
    'and nothing is written until the check-in is finished');

  // Back goes to symptoms, which she never saw — and which must be empty.
  await page.locator('.btn-back').click();
  await settle(page);
  check(/bothering/i.test(await title(page)), 'Back from there is the symptoms question');
  check(await page.locator('.checkin-option[aria-pressed="true"]').count() === 0,
    'with nothing ticked on it');
  await page.locator('.checkin-next').click();
  await settle(page);

  await page.locator('.checkin-next').click();
  await settle(page);
  check(await title(page) === 'How much water so far today?', 'sleep leads on to water');
  await page.locator('.checkin-shortcut', { hasText: 'Skip' }).click();
  await settle(page, 1000);

  const log = await logOnDisk(page);
  check(!await sheetOpen(page), 'finishing the last question closes it');
  check(log?.flow === 'none' && log?.checkedIn === true,
    'and stores flow none, checked in', JSON.stringify({ flow: log?.flow, ci: log?.checkedIn }));
  check(log?.moods.length === 0 && log?.symptoms.length === 0,
    'with no moods or symptoms');
  await ctx.close();
}

console.log('\nthe shortcut on a missed day');
{
  /*
    A day she skipped is reachable from the week strip on Today. The label must
    not say "today" there, and everything else about it works the same.
  */
  const { ctx, page } = await open();
  const yesterday = page.locator('.week-day[aria-label^="Yesterday"]');
  const label = await yesterday.getAttribute('aria-label');
  check(/^Yesterday, not logged/.test(label ?? ''),
    'the strip offers yesterday as a missed day', label ?? '');
  await yesterday.click();
  await settle(page, 700);

  check(/bleeding yesterday/i.test(await title(page)),
    'the question is about yesterday', await title(page));
  const shortcut = page.locator('.checkin-shortcut');
  const text = (await shortcut.innerText()).trim();
  check(text === 'Nothing to report', 'the shortcut reads "Nothing to report", without "today"', text);

  await shortcut.click();
  await settle(page);
  check(await sheetOpen(page), 'and it still goes on to sleep rather than closing');
  check(/sleep/i.test(await title(page)) && /yesterday/i.test(await title(page)),
    'asking about the night before yesterday', await title(page));
  await page.locator('.checkin-next').click();
  await settle(page);
  check(/water/i.test(await title(page)) && /yesterday/i.test(await title(page)),
    'then about yesterday’s water', await title(page));
  const noneLabel = (await page.locator('.checkin-option[data-opt="0"]').innerText()).trim();
  check(noneLabel === 'None', 'a past day\u2019s zero is labelled "None", not "None yet"', noneLabel);
  await page.locator('.checkin-option[data-opt="4"]').click();
  await settle(page, 1000);

  const past = await logOnDisk(page, -1);
  check(past?.checkedIn === true && past?.flow === 'none' && past?.water === 1000,
    'the answers are saved against yesterday', JSON.stringify(past && { f: past.flow, w: past.water }));
  check(await logOnDisk(page, 0) === null,
    'and today, which still owes its own check-in, is untouched');
  await ctx.close();
}

/* ── 5. Switched off ──────────────────────────────────────────────────── */
console.log('\nwith sleep and water switched off it is the three questions again');
{
  const { ctx, page } = await open({ settings: { askSleep: false, askWater: false } });
  await startCheckin(page);
  check(await dots(page) === 3, 'three dots', String(await dots(page)));
  await page.locator('.checkin-shortcut').click();
  await settle(page, 1000);
  check(!await sheetOpen(page), '"Nothing to report today" closes the sheet');
  const log = await logOnDisk(page);
  check(log?.flow === 'none' && log?.checkedIn === true,
    'with the day stored as checked in', JSON.stringify(log && { f: log.flow, ci: log.checkedIn }));
  await ctx.close();
}

console.log('\nwith only one of them switched on');
{
  let { ctx, page } = await open({ settings: { askWater: false } });
  await startCheckin(page);
  check(await dots(page) === 4, 'sleep alone makes four questions', String(await dots(page)));
  await page.locator('.checkin-shortcut').click();
  await settle(page);
  check(await sheetOpen(page) && /sleep/i.test(await title(page)),
    'and the shortcut lands on sleep, which is now the last');
  check((await page.locator('.checkin-next').innerText()).trim() === 'Done',
    'where Next has become Done');
  check(await page.getByRole('button', { name: 'Add more detail' }).count() === 1,
    'and Add more detail is offered');
  await page.locator('.checkin-option[data-opt="6"]').click();
  await page.locator('.checkin-next').click();
  await settle(page, 1000);
  let log = await logOnDisk(page);
  check(!await sheetOpen(page) && log?.sleep === 6 && log?.checkedIn === true,
    'Done saves it', JSON.stringify(log && { s: log.sleep, ci: log.checkedIn }));
  await ctx.close();

  ({ ctx, page } = await open({ settings: { askSleep: false } }));
  await startCheckin(page);
  check(await dots(page) === 4, 'water alone makes four questions', String(await dots(page)));
  await page.locator('.checkin-shortcut').click();
  await settle(page);
  check(await sheetOpen(page) && /water/i.test(await title(page)),
    'and the shortcut lands on water');
  await page.locator('.checkin-option[data-opt="1"]').click();
  await settle(page, 1000);
  log = await logOnDisk(page);
  check(!await sheetOpen(page) && log?.water === 250 && log?.sleep == null,
    'one glass finishes it, with no sleep recorded', JSON.stringify(log && { w: log.water, s: log.sleep }));
  await ctx.close();
}

/* ── 6. Water added before checking in ────────────────────────────────── */
console.log('\nwater logged from Today before the check-in does not cancel it');
{
  const water = { offset: 0, water: 500 };

  let { ctx, page } = await open({ logs: [water], keepSheet: true });
  check(await sheetOpen(page) && await dots(page) === 5,
    'the check-in still opens by itself on a day with only water');

  // Asked before it is dismissed: backing out of it is a skip for the day.
  const state = await page.evaluate(async () => {
    const { needsCheckin, onlyWater } = await import('/js/views/checkin.js');
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const blank = { checkedIn: false, flow: 'none', symptoms: [], moods: [], discharge: [],
      activity: [], other: [], sex: [], custom: [], notes: '' };
    return {
      needs: needsCheckin(key),
      only: onlyWater({ ...blank, water: 500 }),
      checked: onlyWater({ ...blank, water: 500, checkedIn: true }),
      none: onlyWater({ ...blank, water: 0 }),
      withMood: onlyWater({ ...blank, water: 500, moods: ['happy'] }),
      withFlow: onlyWater({ ...blank, water: 500, flow: 'light' }),
    };
  });
  check(state.needs === true, 'needsCheckin is still true for it', JSON.stringify(state));
  check(state.only === true, 'onlyWater recognises a day that is only water');
  check(state.checked === false && state.none === false,
    'but not one already checked in, nor one with no water');
  check(state.withMood === false && state.withFlow === false,
    'nor one with anything else on it');

  await page.keyboard.press('Escape');
  await settle(page, 600);

  check(await page.locator('button:has-text("Check in for today")').count() === 1,
    'Today still offers "Check in for today"');

  // And the flow it opens does not pretend she has answered bleeding.
  if (await page.locator('button:has-text("Check in for today")').count()) {
    await startCheckin(page);
    check(await page.locator('.checkin-option[aria-pressed="true"]').count() === 0,
      'and offers bleeding fresh, with no answer pre-selected');
    check(await page.locator('.checkin-shortcut').count() === 1,
      'and the quiet-day shortcut is still there');
    await page.locator('.checkin-shortcut').click();
    await settle(page);
    await page.locator('.checkin-next').click();
    await settle(page);
    check(await pressed(page, '.checkin-option[data-opt="2"]') === 'true',
      'the 500 ml already drunk shows as two glasses');
    await page.locator('.checkin-shortcut', { hasText: 'Skip' }).click();
    await settle(page, 1000);
    const log = await logOnDisk(page);
    check(log?.water === 500 && log?.checkedIn === true && log?.flow === 'none',
      'skipping keeps the water she had logged, and the day is checked in',
      JSON.stringify(log && { w: log.water, ci: log.checkedIn }));
  }
  await ctx.close();

  // Water plus anything else is a day she has logged for real.
  ({ ctx, page } = await open({ logs: [{ offset: 0, water: 500, moods: ['happy'] }], keepSheet: true }));
  check(!await sheetOpen(page), 'with a mood as well, nothing opens by itself');
  check(await page.locator('button:has-text("Check in for today")').count() === 0,
    'and Today does not offer the check-in');
  await ctx.close();

  // Already checked in, and water was added afterwards.
  ({ ctx, page } = await open({ logs: [{ ...water, checkedIn: true }], keepSheet: true }));
  check(!await sheetOpen(page), 'a checked-in day with water on it is left alone');
  await ctx.close();
}

/* ── 7. Add more detail ───────────────────────────────────────────────── */
console.log('\nAdd more detail opens the diary from whichever question is last');
{
  let { ctx, page } = await open();
  await startCheckin(page);
  const more = page.getByRole('button', { name: 'Add more detail' });

  await toSleep(page);
  check(await more.count() === 0, 'not offered on sleep while water is still to come');
  await page.locator('.checkin-next').click();
  await settle(page);
  check(await more.count() === 1, 'offered on water, the last question');

  await more.click();
  await settle(page, 900);
  check(await page.locator('.checkin-step').count() === 0
    && await page.locator('.sheet button:has-text("Apply")').count() === 1,
  'it opens the diary sheet');
  const log = await logOnDisk(page);
  check(log?.checkedIn === true, 'and the check-in so far is already saved', JSON.stringify(log?.checkedIn));
  await ctx.close();

  // With water off, sleep is the last question and carries it.
  ({ ctx, page } = await open({ settings: { askWater: false } }));
  await startCheckin(page);
  await toSleep(page);
  await page.locator('.checkin-option[data-opt="9"]').click();
  await page.getByRole('button', { name: 'Add more detail' }).click();
  await settle(page, 900);
  check(await page.locator('.checkin-step').count() === 0
    && await page.locator('.sheet button:has-text("Apply")').count() === 1,
  'with water off it is on the sleep question, and opens the diary too');
  const saved = await logOnDisk(page);
  check(saved?.sleep === 9, 'carrying the hours she had picked', String(saved?.sleep));
  await ctx.close();
}

/* ── 8. Settings ──────────────────────────────────────────────────────── */
console.log('\nSettings has the switches for it');
{
  const { ctx, page } = await open();
  await page.locator('[data-tab="settings"]').click();
  await settle(page, 700);

  const section = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('#view-settings h2')]
      .find((h) => /Daily questions/i.test(h.textContent ?? ''));
    return heading ? (heading.closest('.section')?.textContent ?? '') : null;
  });
  check(section != null, 'there is a "Daily questions" section');
  check(/Ask about sleep/.test(section ?? '') && /Ask about water/.test(section ?? '')
    && /Glass size/.test(section ?? ''),
  'with sleep, water and glass size in it', (section ?? '').slice(0, 120));

  const sleepSwitch = page.locator('#view-settings [role="switch"][aria-label*="sleep" i]');
  const waterSwitch = page.locator('#view-settings [role="switch"][aria-label*="water" i]');
  check(await sleepSwitch.getAttribute('aria-checked') === 'true'
    && await waterSwitch.getAttribute('aria-checked') === 'true',
  'both are on by default');

  const glass = page.locator('#set-glass-size');
  check(await glass.inputValue() === '250', 'and a glass is 250 ml');
  await glass.selectOption('330');
  await sleepSwitch.click();
  await settle(page, 500);

  const saved = await page.evaluate(async () => {
    const { getState } = await import('/js/state/store.js');
    const s = getState().settings;
    return { sleep: s.askSleep, water: s.askWater, glass: s.glassMl };
  });
  check(saved.sleep === false && saved.water === true && saved.glass === 330,
    'changing them is saved', JSON.stringify(saved));

  await page.locator('[data-tab="today"]').click();
  await settle(page, 600);
  await startCheckin(page);
  check(await dots(page) === 4, 'and the check-in follows: water but no sleep', String(await dots(page)));
  await page.locator('.checkin-shortcut').click();
  await settle(page);
  await page.locator('.checkin-option[data-opt="3"]').click();
  await settle(page, 1000);
  const log = await logOnDisk(page);
  check(log?.water === 990, 'with three glasses of 330 ml stored as 990', String(log?.water));
  await ctx.close();
}

await browser.close();
console.log(`\nsleep and water: ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
