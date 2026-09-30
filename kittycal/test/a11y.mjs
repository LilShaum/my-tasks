/**
 * a11y.mjs — what the app looks like to someone who is not looking at it.
 *
 * This app is used one-handed, often in the dark, and the things it asks her to
 * do are almost all taps on small round targets whose meaning comes from
 * colour and position. That is exactly the kind of interface that goes quietly
 * unusable with a screen reader, and nothing in the unit tests can see it: the
 * views build their DOM imperatively, so whether a control ends up with a name
 * is a property of the rendered page and nothing else.
 *
 * So the names are read back out of Chromium's own accessibility tree rather
 * than guessed at from the source. That is the same computation a screen reader
 * consumes — `aria-label`, `aria-labelledby`, the label element, the text
 * content, in the real order of precedence — and it is the only way to be sure
 * that an icon-only button announces as something other than "button".
 *
 * Three properties, on every screen:
 *
 *   1. Every control that can be operated has a name. A tab stop that
 *      announces as "button" is a dead end: there is no way to find out what it
 *      does except to press it and see what happens to your data.
 *   2. Headings descend without skipping. Heading level is how a screen reader
 *      user skims, and a jump from h2 to h4 reads as a missing section.
 *   3. A sheet is really modal. `aria-modal` is a claim, not a mechanism — the
 *      background has to be `inert` too, or the reader walks straight out of the
 *      dialog into the page it is covering and starts reading the screen the
 *      sheet is meant to be in front of.
 *
 * Run: npm run test:browser -- a11y
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

/** Enough history that every screen has something real to render. */
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
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date();
  const days = [];
  for (let c = 0; c < 5; c += 1) {
    for (let i = 0; i < 5; i += 1) {
      const d = new Date(today);
      d.setDate(d.getDate() - (c * 28 + (4 - i)));
      days.push(key(d));
    }
  }
  await new Promise((res) => {
    const tx = db.transaction(['meta', 'logs'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme: 'hellokitty', onboarded: true, disclaimerAck: true,
      avgCycleLength: 28, avgPeriodLength: 5, name: 'Sam', showFertility: true,
    } });
    tx.objectStore('meta').put({ key: 'periodDays', value: days });
    tx.objectStore('logs').put({
      date: key(today), flow: 'medium', symptoms: ['cramps'], moods: ['happy'],
      notes: 'a note', bbt: 36.6,
    });
    tx.oncomplete = () => res(undefined);
  });
};

const browser = await launchChromium();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(SEED);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
if (await page.locator('.sheet[data-open="true"]').count()) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
}

/**
 * Roles that are useless without a name — an unnamed one of these is a control
 * she can reach and cannot identify.
 */
const NEEDS_NAME = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox',
  'switch', 'slider', 'spinbutton', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'tab', 'option',
]);

/** Operable, unnamed nodes in Chromium's accessibility tree. */
async function unnamedControls() {
  const snapshot = await page.accessibility.snapshot({ interestingOnly: true });
  const found = [];
  const walk = (node) => {
    if (!node) return;
    if (NEEDS_NAME.has(node.role) && !String(node.name ?? '').trim()
        && !node.disabled && !String(node.description ?? '').trim()) {
      found.push(`${node.role}${node.value ? `[${node.value}]` : ''}`);
    }
    (node.children ?? []).forEach(walk);
  };
  walk(snapshot);
  return found;
}

/**
 * Visible heading levels, in document order.
 *
 * Read from the DOM rather than the accessibility tree, because the tree
 * flattens the nesting this is about. Nodes hidden from the reader are excluded
 * the same way it excludes them — `inert`, `aria-hidden`, or not rendered.
 */
async function headingLevels() {
  return page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')]
    .filter((e) => {
      if (e.closest('[inert],[aria-hidden="true"]')) return false;
      const box = e.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    })
    .map((e) => ({
      level: Number(e.getAttribute('aria-level') ?? e.tagName.slice(1)),
      text: (e.textContent ?? '').trim().slice(0, 32),
    })));
}

const tab = async (name) => {
  await page.locator(`[data-tab="${name}"]`).click();
  await page.waitForTimeout(550);
};

for (const name of ['today', 'calendar', 'insights', 'settings']) {
  console.log(`\n${name} announces every control it offers`);
  await tab(name);

  const unnamed = await unnamedControls();
  check(unnamed.length === 0,
    'nothing she can operate announces as bare role with no name',
    unnamed.slice(0, 6).join(', '));

  const headings = await headingLevels();
  check(headings.length > 0, 'the screen has headings to skim by');
  const skipped = headings
    .map((h, i) => ({ h, prev: headings[i - 1] }))
    .filter(({ h, prev }) => prev && h.level > prev.level + 1)
    .map(({ h, prev }) => `h${prev.level} → h${h.level} at "${h.text}"`);
  check(skipped.length === 0, 'and they descend without skipping a level', skipped.join('; '));
  check(headings.filter((h) => h.level === 1).length === 1,
    'under exactly one top-level heading',
    `h1 count ${headings.filter((h) => h.level === 1).length}`);
}

console.log('\nthe log sheet is really modal, not just labelled as one');
{
  await tab('today');
  await page.locator('button:has-text("Add more")').first().click();
  await page.waitForTimeout(800);

  const state = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet[data-open="true"]');
    const outside = [...document.body.children]
      .filter((c) => !(sheet && (c === sheet || c.contains(sheet))));
    return {
      open: !!sheet,
      ariaModal: sheet?.getAttribute('aria-modal') ?? null,
      named: !!(sheet?.getAttribute('aria-label') || sheet?.getAttribute('aria-labelledby')),
      focusInside: !!(sheet && document.activeElement && sheet.contains(document.activeElement)),
      // Anything left non-inert beside the sheet is a way out of the dialog.
      leaking: outside
        .filter((c) => !c.hasAttribute('inert') && c.querySelector('button,a[href],input,select,textarea'))
        .map((c) => `${c.tagName.toLowerCase()}.${String(c.className || '').split(' ')[0]}`),
    };
  });

  check(state.open, 'the sheet opened');
  check(state.ariaModal === 'true', 'it declares itself modal', String(state.ariaModal));
  check(state.named, 'and has a name, so the reader says what it is');
  check(state.focusInside, 'focus moved into it rather than staying behind it');
  check(state.leaking.length === 0,
    'and everything behind it is inert, so the reader cannot walk out',
    state.leaking.join(', '));

  /*
    The trap itself. `aria-modal` is advisory and `inert` stops the reader; a
    keyboard still walks the tab order unless something cycles it. Forty tabs is
    several times round any sheet in the app, so if focus can get out it will.
  */
  let escapedTo = null;
  for (let i = 0; i < 40 && !escapedTo; i += 1) {
    await page.keyboard.press('Tab');
    // eslint-disable-next-line no-await-in-loop
    escapedTo = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet[data-open="true"]');
      const active = document.activeElement;
      if (sheet && active && sheet.contains(active)) return null;
      return (active?.getAttribute('aria-label') || active?.textContent || active?.tagName || '?')
        .trim().slice(0, 30);
    });
  }
  check(escapedTo === null, 'and forty tabs never leave it', `landed on ${escapedTo}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    closed: !document.querySelector('.sheet[data-open="true"]'),
    stillInert: [...document.body.children].some((c) => c.hasAttribute('inert')),
    focus: document.activeElement === document.body
      ? 'body'
      : (document.activeElement?.getAttribute('aria-label')
        || document.activeElement?.textContent || '?').trim().slice(0, 30),
  }));
  check(after.closed, 'Escape closes it');
  check(!after.stillInert, 'and the screen behind it becomes reachable again');
  check(after.focus !== 'body',
    'with focus back on something, not dropped to the document', after.focus);
}

await browser.close();
console.log(`\na11y: ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
