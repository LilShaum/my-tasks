/**
 * onboard.mjs — arriving with a history instead of without one.
 *
 * Setup used to ask for one period date, which is zero completed cycles, which
 * means roughly three months of the app saying "not enough data yet" — exactly
 * the stretch in which someone decides whether it is worth keeping. It now asks
 * for the ones before that too.
 *
 * These walk the real flow and check the arithmetic that comes out the far end,
 * plus the guard that stops a mistyped date turning two cycles into one.
 *
 * Run: node test/onboard.mjs   (with a static server on 8099)
 */

import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = 'http://127.0.0.1:8099/';

let pass = 0;
let fail = 0;

const ok = (label, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok    ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
};

const pad = (n) => String(n).padStart(2, '0');
const shift = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const browser = await pw.chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

/** Boot a clean install and walk to the earlier-periods step. */
async function toEarlierStep() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  const next = () => page.locator('#onboarding-root .btn-lg').click();
  const heading = () => page.locator('#onboarding-root h2').first().textContent();

  for (let i = 0; i < 12; i += 1) {
    if (/last period start/i.test((await heading()) ?? '')) break;
    await next(); await page.waitForTimeout(150);
  }
  await page.locator('#onboarding-root .chip', { hasText: '28 days ago' }).click();
  await page.waitForTimeout(150);
  await next(); await page.waitForTimeout(300);

  return { page, ctx, errors, next, heading };
}

/** Finish the remaining steps and return what the app ended up with. */
async function finish(page, next, heading) {
  for (let i = 0; i < 12; i += 1) {
    const h = (await heading().catch(() => '')) ?? '';
    if (/before you start/i.test(h)) break;
    await next(); await page.waitForTimeout(150);
  }
  for (let i = 0; i < 4; i += 1) {
    if (await page.locator('#onboarding-root').evaluate((n) => n.hidden).catch(() => true)) break;
    await next().catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(700);

  return page.evaluate(async () => {
    const store = await import('/js/state/store.js');
    const { buildCycles, cycleLengths } = await import('/js/domain/cycles.js');
    const cycles = buildCycles(store.getState().periodDays);
    return { cycles: cycles.length, lengths: cycleLengths(cycles) };
  });
}

console.log('\nthe step is reachable and asks for one date at a time');
{
  const { page, ctx, errors, heading } = await toEarlierStep();
  ok('it comes straight after the last period', /earlier periods/i.test((await heading()) ?? ''),
    (await heading()) ?? '');
  ok('one empty slot to begin with',
    (await page.locator('#onboarding-root .onb-earlier .field').count()) === 1);
  ok('nothing is filled in by default',
    (await page.inputValue('#onb-earlier-0')) === '');
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\neach remembered date becomes a measurable cycle');
{
  const { page, ctx, errors, next, heading } = await toEarlierStep();

  await page.fill('#onb-earlier-0', shift(-55));
  await page.dispatchEvent('#onb-earlier-0', 'change');
  await page.waitForTimeout(250);
  ok('a filled slot opens the next one',
    (await page.locator('#onboarding-root .onb-earlier .field').count()) === 2);

  const hint = await page.locator('#onboarding-root .onb-earlier .hint-sm').first().textContent();
  ok('and states the gap it implies', /27 days before/i.test(hint ?? ''), hint ?? '');

  await page.fill('#onb-earlier-1', shift(-85));
  await page.dispatchEvent('#onb-earlier-1', 'change');
  await page.waitForTimeout(250);

  const out = await finish(page, next, heading);
  ok('three periods recorded', out.cycles === 3, JSON.stringify(out));
  ok('two complete cycles, measured from her own dates',
    out.lengths.length === 2 && out.lengths.every((n) => n >= 25 && n <= 31),
    JSON.stringify(out.lengths));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\nskipping it leaves the old behaviour exactly as it was');
{
  const { page, ctx, errors, next, heading } = await toEarlierStep();
  const out = await finish(page, next, heading);
  ok('one period, no complete cycle', out.cycles === 1 && out.lengths.length === 0,
    JSON.stringify(out));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\na date too close to the one above it is refused');
{
  const { page, ctx, errors, next, heading } = await toEarlierStep();

  // Three days before the last period. Marks would run together and read as a
  // single long bleed, so the field must not accept it.
  await page.fill('#onb-earlier-0', shift(-31));
  await page.dispatchEvent('#onb-earlier-0', 'change');
  await page.waitForTimeout(250);

  ok('no second slot opened',
    (await page.locator('#onboarding-root .onb-earlier .field').count()) === 1);

  const max = await page.getAttribute('#onb-earlier-0', 'max');
  ok('the field advertises the limit to the date picker too',
    max === shift(-28 - 15), `${max} vs ${shift(-43)}`);

  const out = await finish(page, next, heading);
  ok('and nothing bogus was recorded', out.cycles === 1 && out.lengths.length === 0,
    JSON.stringify(out));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
