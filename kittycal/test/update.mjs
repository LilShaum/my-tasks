/**
 * update.mjs — a new version is not held back by a sheet nobody touched.
 *
 * The app reloads itself once when a new version takes over, and skips that
 * while a sheet is in use so nothing typed is lost. It used to skip it for
 * any open sheet, and the morning check-in opens by itself on launch, so the
 * new version waited a whole extra launch. Her partner opened her link and
 * saw the previous app until he reloaded by hand.
 *
 * Run: node test/run-browser.mjs update
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

console.log('\na sheet opened for her, then used by her');
const state = () => page.evaluate(async () => {
  const sheet = await import('/js/ui/sheet.js');
  return { open: sheet.isSheetOpen(), inUse: sheet.isSheetInUse() };
});
await page.evaluate(async () => {
  const { openSheet } = await import('/js/ui/sheet.js');
  const { el } = await import('/js/utils/dom.js');
  openSheet({ title: 'Test', body: [el('input', { class: 'input', id: 'probe-input' })] });
});
await page.waitForTimeout(400);
check((await state()).open, 'the sheet is open');
check(!(await state()).inUse, 'but untouched, so an update may reload');
await page.locator('#probe-input').click();
await page.keyboard.type('half a note');
check((await state()).inUse, 'once she taps and types in it, an update waits');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check(!(await state()).open && !(await state()).inUse, 'closed, nothing holds the update back');

await browser.close();
console.log(`\nupdate: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
