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
import { renderInsights } from './views/insights.js';
import { renderSettings } from './views/settings.js';
import { mountOnboarding } from './views/onboarding.js';
import { openHelp } from './views/help.js';
import { needsCheckin, openCheckin } from './views/checkin.js';
import { openLogSheet } from './views/log.js';
import { isSheetOpen } from './ui/sheet.js';
import { toast } from './ui/toast.js';
import { mascot } from './ui/mascot.js';
import { loadLock, showLockScreen } from './ui/lock.js';
import { checkReminders } from './ui/reminders.js';
import { requestPersistence } from './storage/persist.js';
import { buildCycles } from './domain/cycles.js';
import { predict } from './domain/predict.js';

/** view id → renderer */
const VIEWS = {
  today: renderToday,
  calendar: renderCalendar,
  insights: renderInsights,
  settings: renderSettings,
};

let started = false;

async function boot() {
  // Reflect whatever the pre-paint script chose, so store and DOM agree even
  // before hydration finishes.
  const stored = readStoredTheme();
  applyTheme(stored.theme, stored.colorMode);

  /*
    A write that fails has to be visible.

    Everything else in the app is built on the assumption that what she sees is
    what is stored, and the failure mode without this is the worst one there
    is: a tick, a celebration, and an empty database. Registered before hydrate
    so even a failure during boot has somewhere to go.
  */
  store.onSaveError(() => {
    toast('Could not save to this device. Your last change may be lost — ' +
      'check you are not in a private window and have some space free.',
      { ms: 8000 });
  });

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

  // The lock goes up before anything is revealed. Onboarding is exempt —
  // there's nothing to protect yet and no passcode to check against.
  const lock = await loadLock();
  if (lock.enabled && settings.onboarded) {
    hideBootScreen();
    await showLockScreen(settings.theme);
  }

  if (!settings.onboarded) {
    startOnboarding();
  } else {
    startApp();
  }

  hideBootScreen();

  // Ask the browser not to evict her data. Done after boot rather than before,
  // so it never delays first paint, and it's safe to call on every launch —
  // it resolves immediately once granted.
  void requestPersistence();
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
    const help = $('#help-btn');
    if (help) help.addEventListener('click', () => openHelp());
    store.subscribe(render);
    watchDayRollover();
  }

  render();
  // A launch that already said what it was for does not also get asked.
  if (!applyLaunchIntent()) maybeAskForCheckin();
}

/**
 * Act on a home-screen shortcut.
 *
 * The manifest's `shortcuts` give a long-press on the app icon a menu, and each
 * entry launches the same page with a `?go=` parameter. That is the whole
 * mechanism: there is no router, and adding one for three destinations would be
 * more machinery than the feature is worth.
 *
 * The parameter is stripped from the address bar once it has been acted on, so
 * a reload — or a home-screen app resumed days later — does not re-open the
 * diary at a moment she did not ask for it.
 *
 * @returns {boolean} whether the launch had an intent
 */
function applyLaunchIntent() {
  const go = new URLSearchParams(location.search).get('go');
  if (!go) return false;

  history.replaceState(null, '', location.pathname);

  if (go === 'log') {
    store.setView('today');
    openLogSheet(todayKey());
    return true;
  }
  if (go === 'calendar' || go === 'insights') {
    store.setView(go);
    return true;
  }
  return false;
}

/**
 * Open the daily check-in on the first launch of a day.
 *
 * The whole reason this exists is that a passive control collects thin data:
 * a row of chips waits to be told something, and mostly is not. Asking is what
 * turns "I might log later" into a logged day.
 *
 * It is a sheet rather than a takeover, dismissible with the same tap as any
 * other sheet, and skipping it stops the app asking again until tomorrow. It
 * appears at most once per day, never on a day already logged, and never
 * before onboarding is finished.
 *
 * The "once" is tracked per date rather than per page load. An app added to the
 * Home Screen is not reloaded between uses — iOS keeps it resident for days —
 * so a once-per-session flag would have asked on the day it was installed and
 * then never again, which is the whole daily loop failing silently.
 */
let askedFor = /** @type {string|null} */ (null);
function maybeAskForCheckin() {
  const today = todayKey();
  if (askedFor === today) return;

  const { ui, ready } = store.getState();
  if (!ready || ui.locked) return;
  // Never over the top of something she is already doing. Midnight passing
  // mid-sentence in the diary is not a reason to take the screen away.
  if (isSheetOpen()) return;
  if (!needsCheckin(today)) return;

  askedFor = today;
  // After first paint, so the check-in slides over a drawn screen rather than
  // arriving before there is anything behind it.
  requestAnimationFrame(() => openCheckin(today));
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
  renderHeaderMascot();
}

/**
 * The theme's mascot in the header.
 *
 * It used to be a bow hardcoded into index.html, which meant every theme showed
 * Hello Kitty's motif and an uploaded picture never appeared here at all. Only
 * re-rendered when the theme actually changes — this runs on every render, and
 * rebuilding it each time would restart the image load.
 */
let headerMascotTheme = '';
function renderHeaderMascot() {
  const host = $('#header-mascot');
  if (!host) return;
  const theme = store.getState().settings.theme;
  if (theme === headerMascotTheme) return;
  headerMascotTheme = theme;
  host.replaceChildren(mascot(theme, { size: 30, className: '' }));
}

/** @param {string} view */
function titleFor(view) {
  if (view === 'calendar') return 'Calendar';
  if (view === 'insights') return 'Insights';
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
      // A new day is a new check-in. Without this the app would go quiet after
      // the first day for anyone who never fully closes it.
      maybeAskForCheckin();
    }
  };

  // Cheap poll, plus an immediate check whenever the app is brought forward.
  setInterval(check, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      check();
      // Also on every return to the foreground, not only on a date change: the
      // usual way she reaches the app is bringing it forward, and the day may
      // have turned over while it sat in the background with the poll frozen.
      maybeAskForCheckin();
      void runReminderCheck();
    }
  });
}

/**
 * Fire any reminders that have come due.
 *
 * There is no server, so nothing can wake the phone while the app is closed.
 * This runs at boot and whenever the app returns to the foreground, which is
 * the most a serverless PWA can honestly offer. Settings says so plainly.
 */
async function runReminderCheck() {
  const { settings, periodDays, logs } = store.getState();
  if (!settings.onboarded) return;
  const today = todayKey();
  try {
    await checkReminders({
      prediction: predict({ periodDays, settings, today, logs }),
      loggedToday: logs[today] != null,
      birthControl: settings.birthControl,
    });
  } catch (err) {
    console.warn('kittycal: reminder check failed', err);
  }
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

  /*
    Take a new version on the first launch, not the second.

    The worker is cache-first, so an update lands like this: launch one fetches
    the new sw.js, installs it and precaches everything — but the page you are
    looking at was already served from the old cache. Only launch two shows the
    new app. Measured, not assumed: two full reloads before anything changed.

    That is standard service-worker behaviour and a genuinely bad experience —
    "I don't see the changes" is the correct reaction to it. So when the new
    worker takes control, the page reloads itself once and the update is
    invisible.

    `hadController` is read before registering: on a first-ever install there is
    no controller and nothing on screen is stale, so there is nothing to
    refresh. Without that check this would reload every first run.
  */
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;

    // Never yank the page out from under an open sheet — nothing typed into
    // the logging sheet is saved until Apply. She gets the update next launch,
    // which is no worse than the old behaviour.
    if (isSheetOpen()) return;

    reloading = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('sw.js').catch((err) => {
    console.warn('kittycal: service worker registration failed', err);
  });
}

/* ── Go ─────────────────────────────────────────────────────────────────── */

// Make sure pending writes land if the app is backgrounded or closed. `pagehide`
// is the reliable one on iOS; `beforeunload` never fires there.
// Three signals, because no single one is reliable across platforms:
// `visibilitychange` fires when the app is backgrounded (the common case on a
// phone), `pagehide` when it's being unloaded — the only one iOS reliably
// gives — and `freeze` when Chrome is about to discard the page entirely.
// Writes are already flushed urgently at the point of the change, so these are
// a backstop rather than the primary save.
window.addEventListener('pagehide', () => { void store.flushNow(); });
document.addEventListener('freeze', () => { void store.flushNow(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void store.flushNow();
});

boot().then(registerServiceWorker).then(runReminderCheck);
