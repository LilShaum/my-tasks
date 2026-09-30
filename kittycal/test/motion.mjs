/**
 * motion.mjs — what `prefers-reduced-motion` should and should not remove.
 *
 * Reported by the person it happened to: every theme's background pattern had
 * "disappeared", with nothing in the app connecting that to a system setting
 * she had turned on months earlier for unrelated reasons.
 *
 * The cause was a rule in themes.css that removed `.app-bg`'s background-image
 * under reduced motion, reasoning that patterns are decoration. They are — but
 * every one of them is a static gradient. None move. The setting is a request
 * from someone who gets ill from things that move, and answering it by deleting
 * a still background costs a visible part of the app and reduces no motion.
 *
 * Both directions are checked here, because the fix for one is the obvious way
 * to break the other: the pattern must survive, and the things that genuinely
 * move must still be suppressed.
 *
 * Run: npm run test:browser -- motion
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
  await new Promise((res) => {
    const tx = db.transaction(['meta'], 'readwrite');
    tx.objectStore('meta').put({ key: 'settings', value: {
      theme: 'hellokitty', onboarded: true, disclaimerAck: true,
      avgCycleLength: 28, avgPeriodLength: 5, name: 'Sam',
    } });
    tx.oncomplete = () => res(undefined);
  });
};

const browser = await launchChromium();

/** Open the app with reduced motion set one way or the other. */
async function open(reducedMotion) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(SEED);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1700);
  if (await page.locator('.sheet[data-open="true"]').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
  }
  return { ctx, page };
}

const patternOf = (page) => page.evaluate(() => {
  const bg = document.querySelector('.app-bg');
  return bg ? getComputedStyle(bg).backgroundImage : '(no .app-bg)';
});

console.log('\nthe themed background survives a reduced-motion preference');
{
  const normal = await open('no-preference');
  const plain = await patternOf(normal.page);
  check(plain.includes('gradient'), 'it is there without the preference set', plain.slice(0, 40));
  await normal.ctx.close();

  const reduced = await open('reduce');
  const withPref = await patternOf(reduced.page);
  check(withPref.includes('gradient'),
    'and still there with it set — a static gradient is not motion', withPref.slice(0, 40));
  check(withPref === plain, 'and is the same pattern, not a substitute');

  /*
    The other half. Removing the rule that stripped the pattern must not have
    taken the genuine suppression with it, so the two things that actually move
    are asserted here rather than assumed: every animation and transition is
    flattened, and a celebration does not fire.
  */
  const flattened = await reduced.page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.transition = 'opacity 400ms linear';
    probe.style.animation = 'spin 400ms linear infinite';
    document.body.append(probe);
    const cs = getComputedStyle(probe);
    const out = { transition: cs.transitionDuration, animation: cs.animationDuration };
    probe.remove();
    return out;
  });
  check(parseFloat(flattened.transition) < 0.05,
    'transitions are still flattened', flattened.transition);
  check(parseFloat(flattened.animation) < 0.05,
    'animations are still flattened', flattened.animation);

  const fires = await reduced.page.evaluate(async () => {
    const { reducedMotion } = await import('/js/utils/dom.js');
    return reducedMotion();
  });
  check(fires === true,
    'and the app still knows to skip its celebrations', String(fires));

  await reduced.ctx.close();
}

await browser.close();
console.log(`\nmotion: ${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
