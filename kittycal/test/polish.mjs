/**
 * polish.mjs — things found by using the app rather than by reading it.
 *
 * Each of these was a real defect that no unit test could have caught, because
 * each is a property of the rendered page: a state drawn on the calendar with
 * nothing in the legend naming it, a card whose heading is in the wrong tense
 * for its own dates, a control smaller than the size the rest of the app holds
 * itself to, and a caption sitting four rows below the field it describes.
 *
 * Run: node test/polish.mjs   (with a static server on 8099)
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = 'http://127.0.0.1:8099/';

let pass = 0;
let fail = 0;

/** @param {string} label @param {boolean} cond @param {string} [extra] */
const ok = (label, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok    ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

const browser = await pw.chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
/** @type {string[]} */
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });

// Mid-luteal: the fertile window is behind her, the next period ahead.
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

  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const shift = (/** @type {number} */ n) => {
    const d = new Date(); d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const days = [];
  for (let c = 0; c < 4; c += 1) {
    const start = -23 - ((3 - c) * 29);
    for (let i = 0; i < 5; i += 1) days.push(shift(start + i));
  }

  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme: 'hellokitty', onboarded: true, disclaimerAck: true, avgCycleLength: 29,
      avgPeriodLength: 5, lutealLength: 14, name: 'Sam',
      lastBackup: shift(0), lastBackupAt: Date.now(),
    } });
    tx.objectStore('meta').put({ key: 'periodDays', value: days });
    tx.oncomplete = () => res(undefined);
  });
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.evaluate(() => {
  /** @type {HTMLElement|null} */
  (document.querySelector('.sheet-close, [aria-label*="Close"]'))?.click();
});
await page.waitForTimeout(300);

console.log('\nthe fertile window, once it has been and gone');
{
  const text = await page.$eval('#view-today', (n) => n.textContent ?? '');
  const dates = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#view-today .card')];
    const card = cards.find((c) => /Fertile window/.test(c.querySelector('h3')?.textContent ?? ''));
    return card?.querySelector('.big-value')?.textContent ?? '';
  });

  ok('the card is still there, because when ovulation was is worth knowing',
    /Fertile window/.test(text), text.slice(0, 60));
  ok('but the heading no longer offers a past window as news',
    /Fertile window has passed/.test(text), dates);
  ok('and the estimate is in the past tense too',
    /Ovulation was estimated/.test(text));
}

console.log('\nthe calendar legend covers what the calendar draws');
{
  await page.evaluate(async () => (await import('/js/state/store.js')).setView('calendar'));
  await page.waitForSelector('.cal-cell');
  await page.waitForTimeout(400);

  /*
    Collected from the grid rather than hard-coded, so a state added later
    without a legend entry fails here rather than shipping unexplained. This is
    how the luteal shading went unlabelled: it was drawn on every day between
    ovulation and the next expected period, and grey on a future date reads as
    "unavailable" until something names it.
  */
  const drawn = await page.$$eval('.cal-cell', (cells) => {
    const seen = new Set();
    for (const c of cells) {
      for (const cls of c.classList) {
        if (cls.startsWith('is-') && cls !== 'is-today' && cls !== 'is-outside'
          && cls !== 'is-selected' && cls !== 'is-future' && cls !== 'is-logged') seen.add(cls);
      }
    }
    return [...seen];
  });

  const explained = await page.$$eval('.cal-legend-swatch', (n) =>
    n.map((s) => [...s.classList].find((c) => c.startsWith('is-'))));

  const missing = drawn.filter((d) => !explained.includes(d));
  ok('every state on the grid has a legend entry', missing.length === 0,
    `drawn ${JSON.stringify(drawn)}, explained ${JSON.stringify(explained)}`);
  ok('the luteal shading in particular is named', explained.includes('is-luteal'),
    JSON.stringify(explained));

  /*
    And the converse, which is the direction that broke when the check above
    was satisfied: the fix for the unlabelled shading appended its legend item
    *after* the guard that keeps this function from naming absent states, so
    the two directions ended up enforced by different code paths.

    Scoped to the three conditional states, and deliberately not applied to the
    whole list. "Period logged" is unconditional — the calendar always draws
    logged periods — and this fixture's current month happens to contain none,
    so a blanket converse would fail on a legend entry that is doing its job.
    What the code actually promises is narrower: the fertility family is listed
    when it is drawn and not otherwise.
  */
  const conditional = ['is-fertile', 'is-ovulation', 'is-luteal'];
  const unused = conditional.filter((c) => explained.includes(c) && !drawn.includes(c));
  ok('and no fertility state is explained without being drawn',
    unused.length === 0,
    `explained-but-undrawn ${JSON.stringify(unused)}`);
}

/*
  Two views that draw no luteal days at all, and used to explain them anyway.

  Worth separating from the block above because neither is reachable from that
  fixture: one is a different view, and the other is a different person.
*/
console.log('\nthe legend stays quiet where the calendar says nothing');
{
  // The year view drops the phase tints on purpose — at twelve grids to a
  // screen a tint is a smear — so it must drop their legend entries too.
  await page.locator('.cal-today-btn', { hasText: 'Year' }).click();
  await page.waitForTimeout(500);

  const yearLegend = await page.$$eval('.cal-legend-swatch', (n) =>
    n.map((s) => [...s.classList].find((c) => c.startsWith('is-'))));
  ok('the year view explains only what its mini-grids draw',
    !yearLegend.includes('is-luteal') && !yearLegend.includes('is-fertile')
    && !yearLegend.includes('is-ovulation'),
    JSON.stringify(yearLegend));

  await page.locator('.cal-today-btn', { hasText: 'Months' }).click();
  await page.waitForTimeout(500);

  /*
    On a hormonal method the app refuses to predict ovulation, because it is
    not happening. `buildMarks` follows that and builds no luteal set — but the
    legend was gated on `nextStart` alone, so it went on saying "After
    ovulation" to the one person the rule exists to protect from that sentence.
  */
  await page.evaluate(async () => {
    const store = await import('/js/state/store.js');
    store.updateSettings({ birthControl: 'pill-combined' });
  });
  await page.waitForTimeout(600);

  const cells = await page.$$eval('.cal-cell.is-luteal', (n) => n.length);
  ok('a hormonal method draws no luteal days', cells === 0, `${cells} cells`);

  const onPill = await page.$$eval('.cal-legend-swatch', (n) =>
    n.map((s) => [...s.classList].find((c) => c.startsWith('is-'))));
  ok('and the legend does not say "After ovulation" to her',
    !onPill.includes('is-luteal'), JSON.stringify(onPill));

  await page.evaluate(async () => {
    const store = await import('/js/state/store.js');
    store.updateSettings({ birthControl: 'none' });
  });
  await page.waitForTimeout(600);
}

console.log('\nchips are as big to tap as the app claims');
{
  await page.evaluate(async () => {
    const { openLogSheet } = await import('/js/views/log.js');
    const { todayKey } = await import('/js/utils/date.js');
    openLogSheet(todayKey());
  });
  await page.waitForSelector('.chip');
  await page.waitForTimeout(400);

  /*
    Tested by tapping rather than by measuring. The chip is 38px of visible
    pill with three more of invisible reach top and bottom, so a measurement of
    the box says 38 and is not what a thumb experiences.
  */
  const result = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.chip')]
      .find((c) => /Cramps/.test(c.textContent ?? ''));
    if (!chip) return null;

    /** @param {number} offset px outside the visible pill, negative is above */
    const tapAt = (offset) => {
      const before = chip.getAttribute('aria-pressed');
      const r = chip.getBoundingClientRect();
      const y = offset < 0 ? r.top + offset + 0.5 : r.bottom + offset - 0.5;
      document.elementFromPoint(r.left + r.width / 2, y)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return chip.getAttribute('aria-pressed') !== before;
    };

    return { above: tapAt(-2), below: tapAt(2), wayOff: tapAt(9) };
  });

  ok('a chip exists to tap', result !== null);
  ok('two pixels above the pill still hits it', result?.above === true);
  ok('two pixels below the pill still hits it', result?.below === true);
  ok('nine pixels away does not, so neighbours stay separable',
    result?.wayOff === false);

  await page.evaluate(() => {
    /** @type {HTMLElement|null} */
    (document.querySelector('.sheet-close, [aria-label*="Close"]'))?.click();
  });
  await page.waitForTimeout(300);
}

console.log('\na field’s caption sits with the field');
{
  await page.evaluate(async () => (await import('/js/state/store.js')).setView('settings'));
  await page.waitForTimeout(500);

  const attached = await page.evaluate(() => {
    const group = [...document.querySelectorAll('.row-label-group')]
      .find((g) => /Luteal phase length/.test(g.textContent ?? ''));
    return group?.querySelector('.row-hint')?.textContent ?? null;
  });

  ok('the luteal note is inside the luteal row', /Fourteen is typical/.test(attached ?? ''),
    String(attached));

  // It used to be the last thing in the card, directly under an unrelated switch.
  const strayed = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.row')];
    const toggleRow = rows.find((r) => /Show fertility estimates/.test(r.textContent ?? ''));
    return /Fourteen/.test(toggleRow?.parentElement?.textContent?.split('Show fertility')[1] ?? '');
  });
  ok('and not underneath the fertility switch', strayed === false);
}

console.log('\nthe question every prediction is built on');
{
  // A fresh context, because this one is past onboarding.
  const fresh = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const onb = await fresh.newPage();
  onb.on('pageerror', (e) => errors.push(String(e)));
  await onb.goto(BASE, { waitUntil: 'networkidle' });
  await onb.waitForTimeout(400);

  // Theme, name, year, then the date.
  for (let i = 0; i < 3; i += 1) {
    await onb.evaluate(() => {
      const b = [...document.querySelectorAll('#onb-foot button')];
      (b.find((x) => /next|continue/i.test(x.textContent ?? '')) ?? b[0]).click();
    });
    await onb.waitForTimeout(300);
  }

  const heading = await onb.$eval('#onb-body h2', (n) => n.textContent ?? '');
  ok('we are on the last-period question', /When did your last period start/.test(heading),
    heading);

  const labels = await onb.$$eval('.chip-row .chip', (n) => n.map((c) => c.textContent));
  ok('the shortcuts are words, not abbreviations',
    labels.includes('14 days ago') && !labels.includes('14d ago'), JSON.stringify(labels));

  ok('and they wrap rather than scrolling off the phone',
    await onb.evaluate(() => {
      const row = document.querySelector('.chip-row');
      return row ? row.scrollWidth <= row.clientWidth + 1 : false;
    }));

  await onb.evaluate(() => {
    /** @type {HTMLElement|undefined} */
    ([...document.querySelectorAll('.chip-row .chip')]
      .find((c) => /14 days/.test(c.textContent ?? '')))?.click();
  });
  await onb.waitForTimeout(200);

  const pressed = await onb.$$eval('.chip-row .chip',
    (n) => n.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.textContent));
  ok('the tapped shortcut looks tapped', pressed.length === 1 && /14 days/.test(pressed[0] ?? ''),
    JSON.stringify(pressed));

  const filled = await onb.$eval('#onb-lastperiod', (n) => n.value);
  ok('and it fills the date field', /^\d{4}-\d{2}-\d{2}$/.test(filled), filled);

  await fresh.close();
}

console.log('\nthe calendar refuses to log a period that has not happened');
{
  await page.evaluate(async () => (await import('/js/state/store.js')).setView('calendar'));
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    /** @type {HTMLElement|undefined} */
    ([...document.querySelectorAll('button')]
      .find((b) => /Edit period dates/i.test(b.textContent ?? '')))?.click();
  });
  await page.waitForTimeout(300);

  const cells = await page.evaluate(() => {
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const all = [...document.querySelectorAll('.cal-cell[data-date]')];
    const future = all.filter((c) => (c.dataset.date ?? '') > key);
    const past = all.filter((c) => (c.dataset.date ?? '') <= key);
    return {
      futureCount: future.length,
      futureDisabled: future.every((c) => c.disabled),
      futureSaysWhy: future.every((c) => /cannot be marked/.test(c.getAttribute('aria-label') ?? '')),
      pastEnabled: past.length > 0 && past.every((c) => !c.disabled),
    };
  });

  /*
    Marking one future day used to be enough to have Today announce "Day -29"
    and "58 days to your period" while another card on the same screen said
    there was not enough data to say anything at all.
  */
  ok('there are future days on this month to test', cells.futureCount > 0);
  ok('every one of them refuses the tap in edit mode', cells.futureDisabled === true);
  ok('and says why, rather than only looking greyed', cells.futureSaysWhy === true);
  ok('while past days stay markable', cells.pastEnabled === true);
}

console.log('\nthe screen has a hierarchy rather than one weight');
{
  await page.evaluate(async () => (await import('/js/state/store.js')).setView('today'));
  await page.waitForTimeout(500);

  const weights = await page.evaluate(() => {
    const answer = [...document.querySelectorAll('#view-today .card')]
      .find((c) => /Next period|days late|Fertile window/.test(c.textContent ?? ''));
    const tip = document.querySelector('#view-today .tip-card');
    const phase = document.querySelector('.phase-line');
    /** Resolve a token to the same string form getComputedStyle reports. */
    const asPainted = (/** @type {string} */ name) => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = `var(${name})`;
      document.body.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    };

    return {
      answerFound: !!answer,
      tipFound: !!tip,
      answerBg: answer ? getComputedStyle(answer).backgroundColor : null,
      tipBg: tip ? getComputedStyle(tip).backgroundColor : null,
      cardToken: asPainted('--card'),
      surface2Token: asPainted('--surface-2'),
      answerShadow: answer ? getComputedStyle(answer).boxShadow !== 'none' : null,
      tipShadow: tip ? getComputedStyle(tip).boxShadow !== 'none' : null,
      phaseWash: phase ? getComputedStyle(phase).backgroundColor : null,
      phaseRule: phase ? parseFloat(getComputedStyle(phase).borderTopWidth) : null,
    };
  });

  /*
    Everything on Today used to be a `.card` — the same fill, border and
    shadow — so the answer to "when is my period" carried exactly the weight of
    a background explainer. Nothing led, so the whole screen had to be read.

    Asserted on which token each card is filled with, not on border width or a
    luminance sum. Both cards live inside a `.data-zone`, which rebinds `--bw`
    to the thin data border, so they legitimately share a width; and two
    earlier versions of this check compared numbers that were not colours.
  */
  ok('a prediction card and a reference card both exist',
    weights.answerFound === true && weights.tipFound === true);
  ok('the answer card is filled with the card colour',
    weights.answerBg === weights.cardToken, `${weights.answerBg} vs ${weights.cardToken}`);
  ok('the reference card drops to the quiet surface',
    weights.tipBg === weights.surface2Token, `${weights.tipBg} vs ${weights.surface2Token}`);
  ok('so the two are not drawn the same', weights.answerBg !== weights.tipBg);
  ok('reference cards carry no sticker shadow', weights.tipShadow === false);
  ok('while the answers keep theirs', weights.answerShadow === true);

  ok('the phase block is washed in a colour, not left plain',
    !!weights.phaseWash && weights.phaseWash !== 'rgba(0, 0, 0, 0)', String(weights.phaseWash));
  ok('and carries a rule in that colour', (weights.phaseRule ?? 0) >= 2,
    String(weights.phaseRule));
}

console.log('\na reading that cannot be true is not kept');
{
  await page.evaluate(async () => {
    const { openLogSheet } = await import('/js/views/log.js');
    const { todayKey } = await import('/js/utils/date.js');
    openLogSheet(todayKey());
  });
  await page.waitForSelector('.sheet');
  await page.evaluate(() => {
    document.querySelectorAll('.sheet [aria-expanded="false"]').forEach((b) => {
      if (/Measurement/i.test(b.textContent ?? '')) b.click();
    });
  });
  await page.waitForTimeout(400);

  /*
    `MEASURES` has carried a plausible range for every field since it was
    written and nothing enforced it, so a dropped decimal point put 366 °C in
    the database — which then dragged the six-reading baseline that
    `detectThermalShift` measures against, and could have the app confirm
    ovulation on a day nothing happened.
  */
  const typo = await page.evaluate(async () => {
    const input = [...document.querySelectorAll('.measure-input')][0];
    if (!input) return null;
    const set = (v) => {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('366');
    await new Promise((r) => setTimeout(r, 150));
    const rejected = {
      cleared: input.value === '',
      flagged: input.getAttribute('aria-invalid') === 'true',
      said: document.querySelector('.measure-problem:not([hidden])')?.textContent ?? '',
    };
    set('36.6');
    await new Promise((r) => setTimeout(r, 150));
    return { ...rejected, goodKept: input.value === '36.6',
      goodClean: input.getAttribute('aria-invalid') === null };
  });

  ok('the measurement field exists', typo !== null);
  ok('an impossible reading is not kept', typo?.cleared === true);
  ok('the field is marked invalid', typo?.flagged === true);
  ok('and it says what the range is', /between/.test(typo?.said ?? ''), typo?.said);
  ok('a plausible reading is accepted', typo?.goodKept === true);
  ok('and clears the complaint', typo?.goodClean === true);

  await page.evaluate(() => {
    /** @type {HTMLElement|null} */
    (document.querySelector('.sheet-close, [aria-label*="Close"]'))?.click();
  });
  await page.waitForTimeout(300);
}

/*
  el()'s `style` object silently drops camelCase keys — `setProperty` needs
  `margin-top`, not `marginTop`, and does nothing at all with the wrong one, no
  error either way. Every call site in the app writes the JS spelling, since
  that's the natural way to write an object literal, so this had gone quietly
  wrong in 32 places: the button under every prediction card sat flush against
  the sentence above it, number pickers in Settings didn't centre, and so on.
  Nothing about it would show up as a JS error or a failed assertion elsewhere
  — the only way to catch it is to render something and measure it, which is
  what this file is for.
*/
const styleBug = await page.evaluate(async () => {
  const { el } = await import('/js/utils/dom.js');
  const node = el('div', { style: { marginTop: '13px', '--kc-test': '7px' } });
  document.body.append(node);
  const computed = getComputedStyle(node);
  const out = { marginTop: computed.marginTop, custom: computed.getPropertyValue('--kc-test').trim() };
  node.remove();
  return out;
});
ok('el() applies a camelCase style key', styleBug.marginTop === '13px', styleBug.marginTop);
ok('and still passes a custom property straight through', styleBug.custom === '7px', styleBug.custom);

ok('no page errors throughout', errors.length === 0, errors.join(' | '));

console.log(`\npolish: ${pass}/${pass + fail} checks passed`);
await browser.close();
if (fail) process.exit(1);
