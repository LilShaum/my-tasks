/**
 * screens.mjs — walking the app the way she does, with real history behind it.
 *
 * The unit tests prove the maths and the other probes each guard one feature.
 * What none of them do is open the screens with six months of data in place
 * and read what they actually say — which is how every bug this file guards
 * was found. All three were invisible to code review and obvious on screen:
 *
 *   - Insights counted the cycle she is living through, so it announced "6
 *     cycles logged" while Today said "based on 5 complete cycles" and the
 *     sticker asking for six stayed locked.
 *   - Edit mode said "tap any day" while every day after today was disabled.
 *   - The calendar had half a screen of empty background below the legend and
 *     nothing to say about the month she had paged back to.
 *
 * Run: node test/screens.mjs   (with a static server on 8099)
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = 'http://127.0.0.1:8099/';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let checks = 0;
let failures = 0;

const check = (cond, label, extra = '') => {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

const browser = await pw.chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => {
  failures += 1;
  console.error(`  FAIL  uncaught page error — ${e.message}`);
});

await page.goto(BASE, { waitUntil: 'networkidle' });

/*
  Six periods, so five cycles have finished and a sixth is running. That gap
  between "periods marked" and "cycles completed" is the whole point of the
  fixture: it is the shape that made three screens disagree.
*/
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

  const { emptyLog } = await import('/js/domain/model.js');
  const pad = (n) => String(n).padStart(2, '0');
  const shift = (n) => {
    const d = new Date(); d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const periodDays = [];
  let start = -12;
  for (const len of [29, 27, 30, 28, 26, 28]) {
    for (let i = 0; i < 5; i += 1) periodDays.push(shift(start + i));
    start -= len;
  }

  const logs = [];
  for (let i = 0; i < 120; i += 1) {
    const log = { ...emptyLog(shift(-i)), checkedIn: true };
    if (periodDays.includes(log.date)) log.flow = 'medium';
    if (i % 3 === 0) log.symptoms = ['cramps'];
    logs.push(log);
  }

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
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1600);
if (await page.locator('.sheet[data-open="true"]').count()) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
}

const tab = async (name) => {
  await page.locator(`[data-tab="${name}"]`).click();
  await page.waitForTimeout(600);
};

/* ── 1. Every screen agrees how much history there is ─────────────────── */
console.log('\nthe screens tell the same story about her history');
{
  await tab('insights');
  const history = await page.locator('.card', { hasText: 'Your history' }).innerText();
  const shown = /(\d+)\s*\n?\s*logged/i.exec(history.replace(/\s+/g, ' '))
    || /CYCLES\s+(\d+)/i.exec(history.replace(/\s+/g, ' '));

  /*
    Read off the domain rather than hard-coded, so the check survives the
    fixture being edited: five of the six periods have another period after
    them, and only those are cycles with a length.
  */
  const complete = await page.evaluate(async () => {
    const { buildCycles } = await import('/js/domain/cycles.js');
    const { getState } = await import('/js/state/store.js');
    return buildCycles(getState().periodDays).filter((c) => c.complete).length;
  });

  check(complete === 5, 'the fixture really does have one cycle still running',
    String(complete));
  check(shown != null && Number(shown[1]) === complete,
    'Insights counts finished cycles, not the one she is in',
    `${shown?.[1]} vs ${complete}`);

  await tab('today');
  const confidence = await page.locator('.confidence').first().innerText();
  check(confidence.includes(`${complete} complete cycle`),
    'and Today quotes the same number back', confidence);
}

/* ── 2. Edit mode only promises what it can do ────────────────────────── */
console.log('\nedit mode does not offer a tap that does nothing');
{
  await tab('calendar');
  await page.locator('.cal-editbar button').click();
  await page.waitForTimeout(400);

  const hint = await page.locator('.cal-editbar .hint-sm').innerText();
  check(!/tap any day to/i.test(hint),
    'it no longer says "any day", which was never true', hint);

  const future = page.locator('.cal-cell.is-future').first();
  if (await future.count()) {
    check(await future.isDisabled(),
      'because a day after today genuinely cannot be marked');
  } else {
    check(false, 'expected at least one future day in this month');
  }

  await page.locator('.cal-editbar button').click();
  await page.waitForTimeout(400);
}

/* ── 3. The month she paged to can say what happened in it ────────────── */
console.log('\nthe calendar answers for the month on screen');
{
  const recall = page.locator('.cal-recall');
  check(await recall.count() === 1, 'this month has a summary under the grid');

  const summary = await recall.innerText();
  check(/day of bleeding|days of bleeding|No period days marked/.test(summary),
    'which says whether she bled', summary.replace(/\n/g, ' | '));
  check(/Logged something on \d+ of \d+ days?\./.test(summary),
    'and how much of it she logged', summary.replace(/\n/g, ' | '));

  /*
    The figures have to move with the month, not describe today wherever she
    is. Paging back a month and getting the same sentence would be worse than
    no card at all.
  */
  const here = await recall.innerText();
  await page.locator('[aria-label="Previous month"]').click();
  await page.waitForTimeout(450);
  const back = await page.locator('.cal-recall').innerText();
  check(here !== back, 'and it changes when she pages back', `${here} === ${back}`);

  /*
    A month still running is only counted as far as today; a finished one is
    counted whole. The heading is the only thing that says which.
  */
  await page.locator('[aria-label="Next month"]').click();
  await page.waitForTimeout(450);
  const heading = await page.locator('.cal-recall h3').innerText();
  check(/so far$/.test(heading), 'the current month is labelled as unfinished', heading);

  // Forward into months she has not lived yet: nothing to recall, so nothing.
  for (let i = 0; i < 3; i += 1) {
    await page.locator('[aria-label="Next month"]').click();
    await page.waitForTimeout(300);
  }
  check(await page.locator('.cal-recall').count() === 0,
    'and a month that has not happened yet stays quiet');
}

/* ── 4. The calendar says where in the cycle she is ───────────────────── */
/*
  The grid draws the cycle in colour but never named her place in it: every
  state on screen is a *state* — bleeding, fertile, expected — and none of them
  was "you are here". The cycle day lived on Today and inside a day sheet she
  had to tap.

  Both halves matter. A strip that named a different day from the one Today
  names would be the same class of bug as §1, and a strip about *now* left
  standing under a grid about March would be worse than no strip at all.
*/
console.log('\nthe calendar says which day of the cycle she is on');
{
  await tab('calendar');
  // Back to the current month; §3 left the view several months ahead.
  await page.locator('.cal-today-btn', { hasText: 'Today' }).click();
  await page.waitForTimeout(450);

  const here = page.locator('.cal-here');
  check(await here.count() === 1, 'the month containing today carries the strip');

  const shown = /Day\s+(\d+)/.exec(await here.innerText());
  check(shown != null, 'and it names a cycle day', await here.innerText());

  await tab('today');
  const ring = await page.locator('.ring-day, .view#view-today').first().innerText();
  const onToday = /DAY\s+(\d+)/i.exec(ring.replace(/\s+/g, ' '));
  check(onToday != null && shown != null && shown[1] === onToday[1],
    'the same day Today is counting', `calendar ${shown?.[1]} vs today ${onToday?.[1]}`);

  // The phase has to agree too — the strip and the ring arc are both drawn
  // from the phase token, so a mismatch would be two colours for one day.
  const heading = await page.locator('.phase-line-head h3').innerText();

  await tab('calendar');
  const stripPhase = (await page.locator('.cal-here').innerText()).split('·')[1].trim();
  check(heading.toLowerCase().startsWith(stripPhase.toLowerCase()),
    'and the same phase', `${stripPhase} vs ${heading}`);

  await page.locator('[aria-label="Previous month"]').click();
  await page.waitForTimeout(450);
  check(await page.locator('.cal-here').count() === 0,
    'a month she has paged away to does not claim to be now');
}

await browser.close();
console.log(`\nscreens: ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
