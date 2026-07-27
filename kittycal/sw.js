// @ts-nocheck
/**
 * sw.js — offline support.
 *
 * Cache-first for everything, because every asset this app has is part of the
 * app itself: there is no remote data to be stale about. Once installed,
 * Kittycal works on a plane, in a basement, with the wifi off, forever.
 *
 * Bump CACHE_VERSION when shipping changes, otherwise installed copies keep
 * serving the old files.
 */

const CACHE_VERSION = 'kittycal-v1';

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',

  'css/reset.css',
  'css/tokens.css',
  'css/themes.css',
  'css/components.css',
  'css/layout.css',
  'css/views/today.css',
  'css/views/calendar.css',

  'assets/fonts/nunito.woff2',
  'assets/fonts/fredoka.woff2',
  'assets/icons/icon.svg',

  'js/main.js',
  'js/state/store.js',
  'js/storage/db.js',
  'js/storage/repo.js',
  'js/storage/backup.js',
  'js/domain/model.js',
  'js/domain/cycles.js',
  'js/domain/predict.js',
  'js/domain/phases.js',
  'js/domain/acog.js',
  'js/data/themes.js',
  'js/data/mascots.js',
  'js/views/onboarding.js',
  'js/views/today.js',
  'js/views/calendar.js',
  'js/views/settings.js',
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
