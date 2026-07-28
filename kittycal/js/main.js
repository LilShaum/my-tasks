// @ts-check
/**
 * main.js — boot and route.
 *
 * Order matters here. The theme is applied from localStorage by an inline
 * script in index.html before this module even loads, so there's no flash of
 * the wrong palette. This file then hydrates from IndexedDB, decides between
 * onboarding and the app proper, and renders on every store change.
 */

import { need, $, announce } from './utils/dom.js';
import { todayKey } from './utils/date.js';
import * as store from './state/store.js';
import { applyTheme, readStoredTheme, watchSystemMode } from './ui/theme.js';
import { renderToday } from './views/today.js';
import { renderCalendar } from './views/calendar.js';
import { renderSettings } from './views/settings.js';
import { mountOnboarding } from './views/onboarding.js';

/** view id → renderer */
const VIEWS = {
  today: renderToday,
  calendar: renderCalendar,
  settings: renderSettings,
};

let started = false;

async function boot() {
  // Reflect whatever the pre-paint script chose, so store and DOM agree even
  // before hydration finishes.
  const stored = readStoredTheme();
  applyTheme(stored.theme, stored.colorMode);

  try {
    await store.hydrate();
  } catch (err) {
    console.error('kittycal: could not open the database', err);
    showFatal(
      'Kittycal could not open its local database. If you are in a private ' +
      'browsing window, try a normal one — private mode blocks the storage the ' +
      'app needs.',
    );
    return;
  }

  const { settings } = store.getState();
  // Settings are the authority once hydrated; the localStorage copy is only a
  // pre-paint hint and could be stale after an import.
  applyTheme(settings.theme, settings.colorMode);
  watchSystemMode(() => store.getState().settings.colorMode);

  if (!settings.onboarded) {
    startOnboarding();
  } else {
    startApp();
  }

  hideBootScreen();
}

function startOnboarding() {
  const host = need('#onboarding-root');
  host.hidden = false;
  need('#app-root').hidden = true;

  mountOnboarding(host, {
    theme: store.getState().settings.theme,
    onDone: () => {
      host.hidden = true;
      host.replaceChildren();
      startApp();
      announce('Setup finished. Welcome to Kittycal.');
    },
  });
}

function startApp() {
  need('#app-root').hidden = false;
  need('#onboarding-root').hidden = true;

  if (!started) {
    started = true;
    wireTabs();
    store.subscribe(render);
    watchDayRollover();
  }

  render();
}

/* ── Rendering ──────────────────────────────────────────────────────────── */

function render() {
  const { ui, ready } = store.getState();
  if (!ready) return;

  for (const [name, renderer] of Object.entries(VIEWS)) {
    const host = $(`#view-${name}`);
    if (!host) continue;
    const active = ui.view === name;
    host.hidden = !active;
    // Only the visible view is rendered. There's no benefit to keeping hidden
    // views up to date, and skipping them keeps every interaction cheap.
    if (active) renderer(host);
  }

  syncTabs(ui.view);
  const title = $('#app-title-text');
  if (title) title.textContent = titleFor(ui.view);
}

/** @param {string} view */
function titleFor(view) {
  if (view === 'calendar') return 'Calendar';
  if (view === 'settings') return 'Settings';
  return 'Kittycal';
}

function wireTabs() {
  for (const tab of document.querySelectorAll('[data-tab]')) {
    tab.addEventListener('click', () => {
      const name = /** @type {HTMLElement} */ (tab).dataset.tab;
      if (!name) return;
      store.setView(name);
      // Jump to the top — switching views mid-scroll is disorienting.
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  }
}

/** @param {string} active */
function syncTabs(active) {
  for (const tab of document.querySelectorAll('[data-tab]')) {
    const name = /** @type {HTMLElement} */ (tab).dataset.tab;
    tab.setAttribute('aria-selected', String(name === active));
  }
}

/* ── Housekeeping ───────────────────────────────────────────────────────── */

/**
 * Re-render when the date changes underneath us. A period tracker left open
 * overnight must not still be claiming it's yesterday, and "day 14" quietly
 * becoming wrong is exactly the kind of bug nobody reports.
 */
function watchDayRollover() {
  let current = todayKey();

  const check = () => {
    const now = todayKey();
    if (now !== current) {
      current = now;
      render();
    }
  };

  // Cheap poll, plus an immediate check whenever the app is brought forward.
  setInterval(check, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check();
  });
}

function hideBootScreen() {
  const boot = $('#boot');
  if (!boot) return;
  boot.dataset.hide = 'true';
  setTimeout(() => boot.remove(), 320);
}

/** @param {string} message */
function showFatal(message) {
  const boot = $('#boot');
  if (!boot) return;
  boot.replaceChildren();
  const box = document.createElement('div');
  box.className = 'alert alert-danger';
  box.style.margin = 'var(--sp-4)';
  box.textContent = message;
  boot.append(box);
}

/* ── Service worker ─────────────────────────────────────────────────────── */

/**
 * Registered only over http(s) — from a file:// URL there's no service worker
 * scope and the failure is noisy for no reason.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!location.protocol.startsWith('http')) return;
  navigator.serviceWorker.register('sw.js').catch((err) => {
    console.warn('kittycal: service worker registration failed', err);
  });
}

/* ── Go ─────────────────────────────────────────────────────────────────── */

// Make sure pending writes land if the app is backgrounded or closed. `pagehide`
// is the reliable one on iOS; `beforeunload` never fires there.
window.addEventListener('pagehide', () => { void store.flushNow(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void store.flushNow();
});

boot().then(registerServiceWorker);
