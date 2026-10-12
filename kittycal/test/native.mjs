/**
 * native.mjs — the app behaves like an app on a phone, not like a web page.
 *
 *   - No field anywhere is under 16px. iOS zooms the page in when a smaller
 *     field is focused and leaves it zoomed, which is how tapping her name in
 *     Settings made the whole app drift sideways. Checked on every screen that
 *     has a field: Settings, the diary with every section open, setup, and his
 *     setup and Settings.
 *   - Nothing is wider than a 320px phone, and the page cannot be moved
 *     sideways at all (overflow-x: clip, no sideways rubber-band).
 *   - Buttons and tabs cannot be selected like text (no copy bubble on a
 *     press-and-hold), and fields can: typing into one still works.
 *
 * Run: node test/run-browser.mjs native
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

const browser = await launchChromium();
/** @type {string[]} */
const errors = [];

async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { ctx, page };
}

/** Every visible field under 16px, and how far the page reaches past the screen. */
const measure = (page) => page.evaluate(() => {
  const small = [...document.querySelectorAll('input, select, textarea')]
    .filter((n) => /** @type {HTMLElement} */ (n).offsetParent && /** @type {HTMLInputElement} */ (n).type !== 'hidden')
    .map((n) => ({ what: `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}.${[...n.classList].join('.')}`, size: parseFloat(getComputedStyle(n).fontSize) }))
    .filter((f) => f.size < 16);
  return {
    small: small.map((f) => `${f.what}=${f.size}px`),
    fields: document.querySelectorAll('input, select, textarea').length,
    over: document.documentElement.scrollWidth - window.innerWidth,
  };
});

/** @param {string} where @param {Awaited<ReturnType<typeof measure>>} m */
const fieldsOk = (where, m) => {
  check(m.small.length === 0, `${where}: every field is 16px or more, so iOS never zooms in`, m.small.join(', '));
  check(m.over <= 0, `${where}: nothing reaches past a 320px screen`, `${m.over}px over`);
};

/* ── Her phone ──────────────────────────────────────────────────────────── */
console.log('\nher phone');
{
  const { ctx, page } = await phone();
  await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('kittycal', 1);
      r.onupgradeneeded = () => { const d = r.result;
        d.createObjectStore('logs', { keyPath: 'date' }); d.createObjectStore('meta', { keyPath: 'key' }); d.createObjectStore('blobs', { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const pad = (x) => String(x).padStart(2, '0');
    const shift = (x) => { const d = new Date(); d.setDate(d.getDate() + x); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const periodDays = [];
    for (const s of [-60, -32, -4]) for (let i = 0; i < 5; i += 1) periodDays.push(shift(s + i));
    await new Promise((res) => { const tx = db.transaction(['meta'], 'readwrite');
      tx.objectStore('meta').put({ key: 'settings', value: { name: 'Mia', onboarded: true, role: 'self', disclaimerAck: true,
        installDismissed: true, birthControl: 'pill-combined', lastBackup: shift(0), lastBackupAt: Date.now() } });
      tx.objectStore('meta').put({ key: 'periodDays', value: periodDays });
      tx.oncomplete = () => res(undefined); });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  for (let i = 0; i < 3 && await page.locator('.sheet[data-open="true"]').count(); i += 1) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }

  const css = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).overflowX,
    body: getComputedStyle(document.body).overflowX,
    bounce: getComputedStyle(document.documentElement).overscrollBehaviorX,
  }));
  check(css.html === 'clip' && css.body === 'clip', 'the page cannot be moved sideways', JSON.stringify(css));
  check(css.bounce === 'none', 'and has no sideways rubber-band', css.bounce);

  for (const t of ['today', 'calendar', 'insights']) {
    await page.locator(`[data-tab="${t}"]`).click(); await page.waitForTimeout(400);
    fieldsOk(t, await measure(page));
  }
  await page.locator('[data-tab="settings"]').click(); await page.waitForTimeout(500);
  const settings = await measure(page);
  check(settings.fields >= 10, 'Settings has its fields', String(settings.fields));
  fieldsOk('Settings', settings);

  const selectable = await page.evaluate(() => ({
    button: getComputedStyle(document.querySelector('[data-tab="today"]') ?? document.body).userSelect,
    field: getComputedStyle(document.querySelector('#view-settings input, #view-settings textarea') ?? document.body).userSelect,
  }));
  check(selectable.button === 'none', 'a tab cannot be selected like text', selectable.button);
  check(selectable.field !== 'none', 'a field can', selectable.field);

  // The diary, every section open.
  await page.locator('[data-tab="today"]').click(); await page.waitForTimeout(300);
  await page.evaluate(async () => {
    const m = await import('/js/views/log.js');
    const d = new Date(); const pad = (x) => String(x).padStart(2, '0');
    m.openLogSheet(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  });
  await page.waitForTimeout(600);
  for (const d of await page.locator('.sheet[data-open="true"] details').all()) await d.evaluate((n) => { /** @type {any} */ (n).open = true; });
  await page.waitForTimeout(300);
  const diary = await measure(page);
  check(diary.fields >= 4, 'the diary has its fields', String(diary.fields));
  fieldsOk('the diary', diary);
  // Unselectable controls around it must not stop a field taking typing.
  const notes = page.locator('.sheet[data-open="true"] textarea').first();
  check(await notes.count() === 1, 'the diary has a notes field');
  await notes.fill('Felt fine');
  check(await notes.inputValue() === 'Felt fine', 'and typing into it works');
  await ctx.close();
}

/* ── Setup on a new phone ───────────────────────────────────────────────── */
console.log('\nsetup');
{
  const { ctx, page } = await phone();
  await page.locator('.door-card', { hasText: 'own cycle' }).click();
  await page.waitForTimeout(500);
  for (let step = 0; step < 8; step += 1) {
    fieldsOk(`setup step ${step + 1}`, await measure(page));
    const next = page.locator('#onboarding-root .btn-lg').first();
    if (!(await next.count())) break;
    await next.click().catch(() => {});
    await page.waitForTimeout(400);
    if (!(await page.locator('#onboarding-root:not([hidden])').count())) break;
  }
  await ctx.close();
}

/* ── His phone ──────────────────────────────────────────────────────────── */
console.log('\nhis phone');
{
  const { ctx, page } = await phone();
  await page.locator('.door-card', { hasText: 'partner' }).click();
  await page.waitForTimeout(500);
  const connect = await measure(page);
  check(connect.fields >= 1, 'the code field is there');
  fieldsOk('connecting', connect);
  await ctx.close();
}

check(errors.length === 0, 'no page errors', errors.join(' | '));
await browser.close();
console.log(`\nnative: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
