/**
 * native.mjs — the app behaves like an app on a phone, not like a web page.
 *
 *   - No field anywhere is under 16px. iOS zooms the page in when a smaller
 *     field is focused and leaves it zoomed, which is how tapping her name in
 *     Settings made the whole app drift sideways. Checked on every screen that
 *     has a field: Settings, the diary with every section open, setup, and his
 *     setup and Settings.
 *   - Nothing is wider than the screen, on a 390px iPhone and on the 320px
 *     smallest, and the page cannot be moved sideways at all.
 *   - Buttons and tabs cannot be selected like text (no copy bubble on a
 *     press-and-hold), and fields can: typing into one still works.
 *   - At 390px, every tappable thing is at least 44px to a finger, counting the
 *     invisible ::before/::after that extend small controls, and answers a
 *     press (an :active style), switches and native selects aside.
 *   - Sheets close with a swipe down from the top, as their handle promises.
 *   - Each screen names itself in the title, and the status-bar colour is a
 *     plain hex that follows light and dark.
 *   - An iPhone in Safari is asked to add Kittycal to the Home Screen before
 *     setup, with a way to carry on; nowhere else is.
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

/** @param {number} [width] */
async function phone(width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
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

/** Tappable things under 44px even with their ::before/::after, and ones with no pressed style. */
const touch = (page) => page.evaluate(() => {
  const active = [];
  const walk = (list) => { for (const r of list) {
    if (r.cssRules && !r.selectorText) walk(r.cssRules);
    if (r.selectorText?.includes(':active')) {
      for (const sel of r.selectorText.split(',')) if (sel.includes(':active')) {
        active.push(sel.replace(/:active/g, '').replace(/:not\([^)]*\)/g, '').replace(/::?[a-z-]+$/g, '').trim() || '*');
      }
    } } };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* cross-origin */ } }
  const reach = (n, side) => {
    let out = 0;
    for (const pseudo of ['::before', '::after']) {
      const cs = getComputedStyle(n, pseudo);
      if (cs.content === 'none' || cs.position !== 'absolute') continue;
      out = Math.max(out, -parseFloat(cs[side]) || 0);
    }
    return out;
  };
  const small = [];
  const unpressed = [];
  for (const n of document.querySelectorAll('button, a[href], [role="switch"], summary, select')) {
    if (!(n instanceof HTMLElement) || n.closest('[hidden]') || (!n.offsetParent && getComputedStyle(n).position !== 'fixed')) continue;
    if (/** @type {any} */ (n).disabled) continue;
    const r = n.getBoundingClientRect();
    if (!r.width) continue;
    const h = r.height + reach(n, 'top') + reach(n, 'bottom');
    const w = r.width + reach(n, 'left') + reach(n, 'right');
    const name = `${n.tagName.toLowerCase()}.${[...n.classList].join('.')}`;
    if (h < 43.5 || w < 43.5) small.push(`${name} ${Math.round(w)}x${Math.round(h)}`);
    const exempt = n.matches('select, .toggle');
    if (!exempt && !active.some((b) => { try { return n.matches(b) || n.matches(`${b} *`); } catch { return false; } })) unpressed.push(name);
  }
  return { small: [...new Set(small)], unpressed: [...new Set(unpressed)] };
});

/** @param {string} where @param {Awaited<ReturnType<typeof touch>>} t */
const touchOk = (where, t) => {
  check(t.small.length === 0, `${where}: everything tappable is at least 44px to a finger`, t.small.join(', '));
  check(t.unpressed.length === 0, `${where}: and answers a press`, t.unpressed.join(', '));
};

/** @param {string} where @param {Awaited<ReturnType<typeof measure>>} m */
const fieldsOk = (where, m) => {
  check(m.small.length === 0, `${where}: every field is 16px or more, so iOS never zooms in`, m.small.join(', '));
  check(m.over <= 0, `${where}: nothing reaches past the screen`, `${m.over}px over`);
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

  /** @type {Record<string, string>} */
  const titles = {};
  for (const t of ['today', 'calendar', 'insights']) {
    await page.locator(`[data-tab="${t}"]`).click(); await page.waitForTimeout(400);
    fieldsOk(t, await measure(page));
    touchOk(t, await touch(page));
    titles[t] = await page.title();
  }
  await page.locator('[data-tab="settings"]').click(); await page.waitForTimeout(500);
  titles.settings = await page.title();
  check(titles.today === 'Today · Kittycal' && titles.calendar === 'Calendar · Kittycal'
    && titles.insights === 'Insights · Kittycal' && titles.settings === 'Settings · Kittycal',
  'each screen names itself in the title', JSON.stringify(titles));
  touchOk('Settings', await touch(page));
  const statusBar = await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '');
  check(/^#[0-9a-f]{6}$/.test(statusBar), 'the status-bar colour is a plain hex every phone reads', statusBar);
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
  touchOk('the diary', await touch(page));

  // Swiped down from its handle, the sheet closes; a short tug springs back.
  const grip = await page.locator('.sheet[data-open="true"] .sheet-grip').boundingBox();
  if (grip) {
    const x = grip.x + grip.width / 2; const y = grip.y + 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x, y + 30, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(500);
    check(await page.locator('.sheet[data-open="true"]').count() === 1, 'a short tug on a sheet springs back');
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x, y + 220, { steps: 12 }); await page.mouse.up();
    await page.waitForTimeout(700);
    check(await page.locator('.sheet[data-open="true"]').count() === 0, 'a swipe down from the handle closes it');
  } else {
    check(false, 'the sheet has a handle to swipe');
  }
  await ctx.close();
}

/* ── The smallest iPhone: nothing wider than the screen ──────────────────── */
{
  const { ctx, page } = await phone(320);
  await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('kittycal', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('logs', { keyPath: 'date' });
        d.createObjectStore('meta', { keyPath: 'key' }); d.createObjectStore('blobs', { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result); });
    const d = new Date(); d.setDate(d.getDate() - 10);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await new Promise((res) => { const tx = db.transaction(['meta'], 'readwrite');
      tx.objectStore('meta').put({ key: 'settings', value: { name: 'Mia', onboarded: true, role: 'self', disclaimerAck: true, installDismissed: true } });
      tx.objectStore('meta').put({ key: 'periodDays', value: [key] }); tx.oncomplete = () => res(undefined); });
  });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  for (let i = 0; i < 3 && await page.locator('.sheet[data-open="true"]').count(); i += 1) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  for (const t of ['today', 'calendar', 'insights', 'settings']) {
    await page.locator(`[data-tab="${t}"]`).click(); await page.waitForTimeout(400);
    fieldsOk(`320px ${t}`, await measure(page));
  }
  await ctx.close();
}

/* ── Dark mode: the status bar follows ─────────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const [light, dark] = [await page.evaluate(() => {
    const m = document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '';
    return m;
  }), null];
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) + ((n >> 8) & 255) + (n & 255)) / 3; };
  check(/^#[0-9a-f]{6}$/.test(light) && lum(light) < 90, 'in dark mode the status bar is dark too', String(light ?? dark));
  await ctx.close();
}

/* ── The iPhone install screen ──────────────────────────────────────────── */
console.log('\niPhone in Safari');
{
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: iphone });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const first = await page.locator('#onboarding-root').innerText();
  check(/add Kittycal to your Home Screen/i.test(first) && /Share/.test(first) && /Add to Home Screen/.test(first),
    'it asks for the Home Screen first, with Safari’s own steps', first.slice(0, 80));
  fieldsOk('the install screen', await measure(page));
  touchOk('the install screen', await touch(page));
  await page.locator('button', { hasText: 'Continue in Safari anyway' }).click();
  await page.waitForTimeout(400);
  check(await page.locator('.door-card').count() === 2, 'and “Continue in Safari anyway” goes on to setup');

  // Already on the Home Screen: straight to setup.
  const installed = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: iphone });
  await installed.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  const p2 = await installed.newPage();
  await p2.goto(BASE, { waitUntil: 'networkidle' });
  check(await p2.locator('.door-card').count() === 2 && !/Home Screen/.test(await p2.locator('#onboarding-root').innerText()),
    'not when it is already installed');
  await installed.close();
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
