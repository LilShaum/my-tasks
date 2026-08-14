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

  /*
    The mode is carried by a titled panel, not by a full-width filled button.
    The work on this screen is tapping the day circles, so the way *out* of the
    mode must not be the biggest thing on it — but it still has to be a real
    target, or quietening it has just made it hard to leave.
  */
  check(await page.locator('.cal-editbar.is-editing').count() === 1,
    'the panel says which mode she is in');
  check(await page.locator('.cal-editbar-title').innerText() === 'Editing period dates',
    'and says so in words, before the instructions');

  const done = await page.locator('.cal-editbar button').boundingBox();
  const cell = await page.locator('.cal-cell:not(.cal-cell-empty)').first().boundingBox();
  check(done != null && cell != null && done.width < cell.width * 3,
    'the exit is sized to its label rather than the screen',
    JSON.stringify(done));
  check(done != null && done.height >= 44 && done.width >= 64,
    'and is still comfortably tappable', JSON.stringify(done));

  await page.locator('.cal-editbar button').click();
  await page.waitForTimeout(400);
  check(await page.locator('.cal-editbar.is-editing').count() === 0,
    'and leaving the mode takes the panel with it');
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

/* ── 4. The legend names what is on screen, and nothing else ──────────── */
console.log('\nthe legend describes the grid rather than the prediction');
{
  const legend = async () => ((await page.locator('.cal-legend').count())
    ? (await page.locator('.cal-legend').innerText()).replace(/\n/g, ' / ')
    : '');

  await page.locator('button:has-text("Today")').first().click();
  await page.waitForTimeout(500);
  const now = await legend();
  check(/Period logged/.test(now) && /Period expected/.test(now),
    'the current month names both what she logged and what is forecast', now);

  /*
    A month behind her has no forecast in it, so the three forward-looking
    entries were pure noise — and "After ovulation" over a grid with no muted
    day in it invites the reading that grey means unavailable.
  */
  for (let i = 0; i < 2; i += 1) {
    await page.locator('[aria-label="Previous month"]').click();
    await page.waitForTimeout(350);
  }
  const past = await legend();
  check(past === 'Period logged',
    'a month behind her names only the one state it draws', past);

  await page.locator('button:has-text("Today")').first().click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Year")').click();
  await page.waitForTimeout(600);
  const year = await legend();
  check(!/Fertile|Ovulation|After ovulation/.test(year),
    'and the year view, which draws neither, offers neither', year);
}

/* ── 5. Contraception suppresses the words as well as the days ────────── */
console.log('\nnothing names ovulation to someone whose ovulation is suppressed');
{
  await page.evaluate(async () => {
    const store = await import('/js/state/store.js');
    store.updateSettings({ birthControl: 'pill-combined' });
  });
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Months")').click();
  await page.waitForTimeout(600);

  const text = (await page.locator('.cal-legend').innerText()).replace(/\n/g, ' / ');
  /*
    `buildMarks` already refuses to produce fertile, ovulation or luteal days
    on hormonal contraception. The legend was built from the prediction rather
    than from the grid, so it went on offering "After ovulation" underneath a
    month that contained no such day — the safety rule held everywhere except
    in the words.
  */
  check(!/Fertile|Ovulation|After ovulation/.test(text),
    'the legend drops all three with the days they named', text);
  check(await page.locator('.cal-cell.is-luteal').count() === 0,
    'and there were none of those days to name', 'luteal cells present');
}

/* ── 6. The diary never leaves her without the word for where she is ──── */
console.log('\nthe category heading stays with its chips');
{
  await tab('today');
  await page.locator('button:has-text("Add more")').first().click();
  await page.waitForTimeout(800);

  const offset = await page.evaluate(() => {
    const body = document.querySelector('.sheet-body');
    return body ? getComputedStyle(body).getPropertyValue('--log-sticky-top').trim() : '';
  });
  check(/^\d+(\.\d+)?px$/.test(offset) && parseFloat(offset) > 0,
    'the headings are parked at the measured height of the search bar', offset);

  /*
    Body symptoms alone is thirty-eight chips. Scrolled into the middle of
    them, exactly one heading should be sitting in the band between the top of
    the sheet body and the bottom of the search bar — the one whose chips are
    on screen.
  */
  await page.evaluate(() => document.querySelector('.sheet-body')?.scrollTo(0, 900));
  await page.waitForTimeout(450);

  const pinned = await page.evaluate(() => {
    const body = document.querySelector('.sheet-body')?.getBoundingClientRect();
    const search = document.querySelector('.search-wrap')?.getBoundingClientRect();
    if (!body || !search) return [];
    return [...document.querySelectorAll('.log-section-head')]
      .filter((h) => {
        const top = h.getBoundingClientRect().top;
        return top >= body.top - 2 && top < search.bottom + 8;
      })
      .map((h) => h.querySelector('.log-section-title')?.textContent ?? '');
  });

  check(pinned.length === 1,
    'one heading is pinned, not none and not a stack of them',
    JSON.stringify(pinned));

  // It has to be the open one whose chips fill the screen, not a leftover.
  check(pinned[0] === 'Symptoms', 'and it is the category she is looking at',
    JSON.stringify(pinned));

  /*
    The search bar owns the top of the scroller, so the pinned heading has to
    clear it. Only the pinned one is asked: a heading whose section has already
    scrolled past is released and sitting above the viewport, which is the
    point of sticky rather than a fault.
  */
  const gap = await page.evaluate(() => {
    const body = document.querySelector('.sheet-body')?.getBoundingClientRect();
    const search = document.querySelector('.search-wrap')?.getBoundingClientRect();
    if (!body || !search) return null;
    const head = [...document.querySelectorAll('.log-section-head')]
      .find((h) => {
        const top = h.getBoundingClientRect().top;
        return top >= body.top - 2 && top < search.bottom + 8;
      });
    return head ? head.getBoundingClientRect().top - search.bottom : null;
  });
  check(gap != null && gap >= -1,
    'and it sits below the search bar rather than over it', String(gap));
}

await browser.close();
console.log(`\nscreens: ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
