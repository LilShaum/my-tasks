// @ts-nocheck
/**
 * sw.js — offline support.
 *
 * Cache-first for everything, because every asset this app has is part of the
 * app itself: there is no remote data to be stale about. Once installed,
 * Kittycal works on a plane, in a basement, with the wifi off, forever.
 *
 * The catch with cache-first is that an installed copy keeps serving what it
 * cached until this script's own bytes change — that is the only signal a
 * browser uses to reinstall a worker. So the version is not written by hand,
 * where it would eventually be forgotten and a release would ship to the site
 * without ever reaching the phone. The deploy workflow substitutes the commit
 * SHA for __BUILD__, so every deploy changes these bytes and every installed
 * copy re-fetches everything on next launch.
 *
 * Served straight from the repo (a local server, say), __BUILD__ is left as-is
 * and behaves like any other fixed version string.
 */

const CACHE_VERSION = 'kittycal-__BUILD__';

const PRECACHE = [
  './',
  'index.html',
  'install.html',
  'manifest.webmanifest',

  'css/reset.css',
  'css/tokens.css',
  'css/themes.css',
  'css/components.css',
  'css/layout.css',
  'css/views/today.css',
  'css/views/calendar.css',
  'css/views/log.css',
  'css/views/insights.css',
  'css/print.css',
  'css/views/lock.css',
  'css/views/help.css',
  'css/views/partner.css',

  'assets/fonts/nunito.woff2',
  'assets/fonts/fredoka.woff2',
  'assets/icons/icon.svg',
  // The one iOS actually puts on the Home Screen. index.html links it and
  // PRECACHE did not have it, which test/precache.test.js is here to notice.
  'assets/icons/icon-180.png',
  'assets/mascots/manifest.json',

  'js/main.js',
  'js/state/store.js',
  'js/storage/db.js',
  'js/storage/repo.js',
  'js/storage/backup.js',
  'js/storage/csv.js',
  'js/storage/export-action.js',
  'js/storage/persist.js',
  'js/domain/model.js',
  'js/domain/cycles.js',
  'js/domain/accuracy.js',
  'js/domain/backup-check.js',
  'js/domain/install-health.js',
  'js/domain/ovulation.js',
  'js/domain/predict.js',
  'js/domain/phases.js',
  'js/domain/pill.js',
  'js/domain/acog.js',
  'js/domain/stats.js',
  'js/domain/heads-up.js',
  'js/domain/rhythm.js',
  'js/ui/insight-charts.js',
  'js/domain/foryou.js',
  'js/domain/partner.js',
  'js/storage/share.js',
  'js/storage/push.js',
  'js/domain/push-plan.js',
  'js/domain/reminder-plan.js',
  'js/state/partner-sync.js',
  'js/views/partner.js',
  'js/views/partner-app.js',
  'js/views/partner-setup.js',
  'js/data/partner-tips.js',
  'js/domain/recap.js',
  'js/domain/response.js',
  'js/domain/notes.js',
  'js/domain/backup-health.js',
  'js/data/themes.js',
  'js/data/mascots.js',
  'js/views/onboarding.js',
  'js/views/today.js',
  'js/views/calendar.js',
  'js/views/settings.js',
  'js/views/log.js',
  'js/views/insights.js',
  'js/views/report.js',
  'js/views/notes.js',
  'js/ui/severity.js',
  'js/ui/measure.js',
  'js/views/help.js',
  'js/views/checkin.js',
  'js/data/icons.js',
  'js/data/taxonomy.js',
  'js/data/tips.js',
  'js/ui/sheet.js',
  'js/ui/dialog.js',
  'js/ui/image-picker.js',
  'js/ui/chart.js',
  'js/ui/lock.js',
  'js/ui/reminders.js',
  'js/ui/theme.js',
  'js/ui/theme-picker.js',
  'js/ui/mascot.js',
  'js/ui/ring.js',
  'js/ui/toast.js',
  'js/ui/particles.js',
  'js/utils/date.js',
  'js/utils/dom.js',
  'js/utils/fmt.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      // Added one at a time rather than cache.addAll, so a single missing file
      // — a mascot drop-in that isn't there, say — doesn't abort the whole
      // install and leave the app without offline support.
      await Promise.all(PRECACHE.map(async (url) => {
        try {
          await cache.add(new Request(url, { cache: 'reload' }));
        } catch (err) {
          console.warn('kittycal sw: could not precache', url, err);
        }
      }));
      await self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch anything off-origin. There shouldn't be any — the CSP forbids
  // it — but a service worker is the wrong place to make assumptions.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const response = await fetch(request);
      // Cache successful same-origin responses so drop-in mascots and any
      // newly added file become available offline after first use.
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      // Offline and not cached. For a navigation, hand back the app shell so
      // the PWA still opens; otherwise there is nothing useful to return.
      if (request.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});

/* ── Notifications: his heads-ups, her reminders ───────────────────────────
   The server sends an empty push at a time this phone asked for. What it
   should say is on this phone, in the plan saved with its settings
   (partnerPush on his, selfPush on hers). A push must always show
   something, so a late or unexpected one gets a plain line. */

function readSettings() {
  return new Promise((resolve) => {
    const open = indexedDB.open('kittycal', 1);
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      try {
        const get = open.result.transaction(['meta'], 'readonly').objectStore('meta').get('settings');
        get.onsuccess = () => resolve(get.result ? get.result.value : null);
        get.onerror = () => resolve(null);
      } catch { resolve(null); }
    };
  });
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const settings = await readSettings();
    // His heads-ups and her reminders: whichever this phone planned. The
    // same rule as remindersFor in reminder-plan.js: every entry within a
    // quarter of an hour (two can share a time), else the closest within six.
    const plan = [
      ...((settings && settings.partnerPush && settings.partnerPush.plan) || []),
      ...((settings && settings.selfPush && settings.selfPush.plan) || []),
    ];
    const now = Date.now();
    let show = plan.filter((p) => Math.abs(p.at - now) <= 15 * 60e3);
    if (!show.length) {
      let best = null;
      for (const p of plan) {
        const off = Math.abs(p.at - now);
        if (off <= 6 * 3600e3 && (!best || off < Math.abs(best.at - now))) best = p;
      }
      if (best) show = [best];
    }
    const options = (tag) => ({
      icon: 'assets/icons/icon-180.png',
      badge: 'assets/icons/icon-180.png',
      tag,
      data: { url: './' },
    });
    if (!show.length) {
      // A push must always show something.
      const partner = settings && settings.role === 'partner';
      const name = settings && settings.partnerOf && settings.partnerOf.snapshot && settings.partnerOf.snapshot.name;
      await self.registration.showNotification('Kittycal', {
        ...options('kittycal-heads-up'),
        body: partner ? `A heads-up about ${name ? `${name}’s` : 'her'} cycle. Open Kittycal to see it.`
          : 'A reminder from Kittycal. Open it to see.',
      });
      return;
    }
    for (const p of show) {
      await self.registration.showNotification(p.title, { ...options(`kittycal-${p.kind || 'heads-up'}`), body: p.body });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.length) return windows[0].focus();
    return self.clients.openWindow('./');
  })());
});
