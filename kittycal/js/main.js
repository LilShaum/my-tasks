// @ts-check
/**
 * main.js — boot and route.
 *
 * Order matters here. The theme is applied from localStorage by an inline
 * script in index.html before this module even loads, so there's no flash of
 * the wrong palette. This file then hydrates from IndexedDB, decides between
 * onboarding and the app proper, and renders on every store change.
 */

import { need, $, announce, el } from './utils/dom.js';
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
import { isSheetOpen, isSheetInUse, openSheet, closeSheet } from './ui/sheet.js';
import { toast } from './ui/toast.js';
import { mascot } from './ui/mascot.js';
import { loadLock, showLockScreen } from './ui/lock.js';
import { checkReminders } from './ui/reminders.js';
import { requestPersistence, refreshStorageSnapshot } from './storage/persist.js';
import { buildCycles } from './domain/cycles.js';
import { parseShareHash } from './storage/share.js';
import { startPartnerSync } from './state/partner-sync.js';
import {
  renderPartnerToday, renderPartnerCalendar, renderPartnerRhythm, renderPartnerSettings,
  refreshPartner, partnerTitle, PARTNER_TABS,
} from './views/partner-app.js';
import { mountDoor, mountPartnerSetup, connect } from './views/partner-setup.js';
import { emblem } from './ui/mascot.js';
import { predict } from './domain/predict.js';

/** view id → renderer, for each of the two apps this install can be */
const APPS = {
  self: { today: renderToday, calendar: renderCalendar, insights: renderInsights, settings: renderSettings },
  partner: {
    today: renderPartnerToday, calendar: renderPartnerCalendar,
    insights: renderPartnerRhythm, settings: renderPartnerSettings,
  },
};

/** Which of the two is running. Set once at boot; switching reloads. */
let mode = /** @type {'self'|'partner'} */ ('self');

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
    toast('Couldn’t save to this device. Your last change may be lost. ' +
      'Check you’re not in a private window and have some space free.',
      { ms: 8000 });
  });

  try {
    await store.hydrate();
  } catch (err) {
    console.error('kittycal: could not open the database', err);
    showFatal(
      'Kittycal couldn’t open its local database. If you’re in a private ' +
      'browsing window, try a normal one. Private mode blocks the storage the ' +
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

  /*
    A partner's share link carries its secret in the fragment. Take it, then
    take it out of the address bar, so a screenshot or a shared URL bar does
    not pass it on by accident.
  */
  const link = parseShareHash(location.hash);
  if (link) history.replaceState(null, '', location.pathname + location.search);
  addEventListener('hashchange', () => {
    const later = parseShareHash(location.hash);
    if (!later) return;
    history.replaceState(null, '', location.pathname + location.search);
    void arriveWithLink(later);
  });

  /*
    Which app this phone is. Phones from before the question existed are
    whatever they were already doing: set up for her own cycle, or following
    someone else's from a link.
  */
  const role = settings.role ?? (settings.onboarded ? 'self' : settings.partnerOf ? 'partner' : null);
  if (link) {
    hideBootScreen();
    await arriveWithLink(link);
  } else if (role === 'partner') {
    if (settings.partnerOf && settings.role === 'partner') startPartnerApp();
    else startPartnerSetup();
  } else if (role === 'self') {
    startApp();
  } else {
    startDoor();
  }

  hideBootScreen();

  // Ask the browser not to evict her data. Done after boot rather than before,
  // so it never delays first paint, and it's safe to call on every launch —
  // it resolves immediately once granted.
  // Then work out whether it worked, and redraw — Today only warns her about
  // installing once it knows the app cannot protect the data by itself.
  void requestPersistence()
    .then(refreshStorageSnapshot)
    .then(() => { if (store.getState().ready) render(); })
    .catch(() => { /* the warning simply stays hidden; nothing else depends on it */ });
}

/**
 * Her link opened this app.
 *
 * On a phone set up for its own cycle, the link is connected and she or he is
 * asked whether to switch: the phone's own data is kept either way. Anywhere
 * else it goes straight into the partner's setup, already connected.
 *
 * @param {{code: string}|{id: string, key: string}} link
 */
async function arriveWithLink(link) {
  const { settings } = store.getState();
  const tracksOwn = settings.role === 'self' || (settings.role == null && settings.onboarded);
  if (mode === 'partner' && started) {
    await connect(link);
    return;
  }
  if (!tracksOwn) {
    showConnecting();
    const result = await connect(link);
    if (result !== 'ok') toast(result === 'missing'
      ? 'That link doesn’t work any more. Ask her for her code.'
      : 'Couldn’t connect. Check your connection, then try the link again.', { ms: 6000 });
    startPartnerSetup();
    return;
  }
  if (!started) startApp();
  const result = await connect(link);
  if (result !== 'ok') { toast('Couldn’t open that link. Ask her for her code.'); return; }
  offerPartnerMode();
}

/** A phone that tracks its own cycle has just been sent someone's. */
function offerPartnerMode() {
  const snap = store.getState().settings.partnerOf?.snapshot;
  if (!snap) return;
  const art = emblem(snap.theme ?? 'plain', { size: 64, className: '' });
  art.setAttribute('data-theme', snap.theme ?? 'plain');
  openSheet({
    title: 'Partner view',
    body: [
      el('div', { class: 'pa-offer' }, [
        art,
        el('h3', { text: snap.name ? `${snap.name} shared her cycle with you` : 'Someone shared their cycle with you' }),
        el('p', { class: 'hint', text: 'Partner mode turns this phone into a companion for her cycle. '
          + 'Your own logs stay here, and you can switch back from Settings.' }),
      ]),
      el('div', { class: 'dialog-actions' }, [
        el('button', { type: 'button', class: 'btn btn-block btn-lg', onclick: async () => {
          store.updateSettings({ role: 'partner' });
          await store.flushNow();
          location.reload();
        } }, ['Switch to partner mode']),
        el('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: () => closeSheet() }, ['Not now']),
      ]),
    ],
  });
}

function showConnecting() {
  const host = need('#onboarding-root');
  host.hidden = false;
  need('#app-root').hidden = true;
  host.replaceChildren(el('div', { class: 'onb' }, [
    el('div', { class: 'onb-body' }, [el('p', { class: 'hint', style: { textAlign: 'center' }, text: 'Connecting…' })]),
  ]));
}

/** The first question: whose cycle is this phone for? */
function startDoor() {
  const host = need('#onboarding-root');
  host.hidden = false;
  need('#app-root').hidden = true;
  mountDoor(host, {
    onSelf: () => startOnboarding(),
    onPartner: () => startPartnerSetup(),
  });
}

function startPartnerSetup() {
  const host = need('#onboarding-root');
  host.hidden = false;
  need('#app-root').hidden = true;
  const { settings } = store.getState();
  mountPartnerSetup(host, {
    onBack: settings.onboarded || settings.partnerOf ? undefined : () => startDoor(),
    onDone: () => {
      host.hidden = true;
      host.replaceChildren();
      startPartnerApp();
      announce('All set. This is her cycle, for you.');
    },
  });
}

/** Kittycal for the person she shares with: his four screens, no tracking. */
function startPartnerApp() {
  mode = 'partner';
  need('#app-root').hidden = false;
  need('#onboarding-root').hidden = true;
  document.documentElement.dataset.app = 'partner';

  // The tab bar is shared; only the third tab's name changes.
  for (const [tab, label] of Object.entries(PARTNER_TABS)) {
    const span = document.querySelector(`[data-tab="${tab}"] span`);
    if (span) span.textContent = label;
  }

  if (!started) {
    started = true;
    wireTabs();
    const help = $('#help-btn');
    if (help) {
      help.setAttribute('aria-label', 'How partner mode works');
      help.addEventListener('click', () => openPartnerHelp());
    }
    store.subscribe(render);
    watchDayRollover();
  }
  render();

  // Fresh on open, on every return to the foreground, and every quarter hour
  // while it is on screen.
  void refreshPartner({ force: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshPartner(); });
  setInterval(() => { if (!document.hidden) void refreshPartner(); }, 15 * 60_000);
}

function openPartnerHelp() {
  const name = store.getState().settings.partnerOf?.snapshot?.name ?? 'She';
  openSheet({
    title: 'How partner mode works',
    body: [
      el('p', { text: `${name} logs her cycle in her own Kittycal and chooses what to share. This app shows `
        + 'it from your side: where she is, what her own history says is likely, and what usually helps.' }),
      el('p', { text: 'Every forecast comes from her logs, so it gets sharper the longer she uses the app. '
        + 'It is a forecast, not a promise, and never a reason to tell her how she feels.' }),
      el('p', { text: 'What she shares is encrypted on her phone. The server stores a locked copy it cannot read; '
        + 'only the code unlocks it. She can stop sharing at any time.' }),
    ],
  });
}

function startOnboarding() {
  const host = need('#onboarding-root');
  host.hidden = false;
  need('#app-root').hidden = true;

  mountOnboarding(host, {
    theme: store.getState().settings.theme,
    onDone: () => {
      store.updateSettings({ role: 'self' });
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
    startPartnerSync();
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
  if (mode === 'partner') return;
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

  for (const [name, renderer] of Object.entries(APPS[mode])) {
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
  if (title) title.textContent = mode === 'partner' ? partnerTitle(ui.view) : titleFor(ui.view);
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
  if (!settings.onboarded || mode === 'partner') return;
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

    // Never yank the page out from under a sheet she is using: nothing typed
    // into the logging sheet is saved until Apply. A sheet that opened by
    // itself and has not been touched (the morning check-in) holds nothing,
    // and letting it block meant the new version waited a whole launch.
    if (isSheetInUse()) return;

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
