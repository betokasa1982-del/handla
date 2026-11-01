/* Handla service worker.
   Bump CACHE when you change any shell file — old caches are dropped on activate. */
const CACHE = 'handla-v10';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './data/stores_index.json',
  './data/i18n/grocery-terms.json',
  './js/terms.cjs',
  './js/ui.cjs'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache the sync API or anything cross-origin that isn't a font.
  if (url.hostname === 'api.github.com') return;

  // Shop directory and per-store prices: network first, cached copy when offline.
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Network-first for the document, so a new deploy shows up immediately
  // but the app still opens with no signal.
  if (req.mode === 'navigate' || url.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for everything else in the shell, plus web fonts.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && (url.origin === location.origin || url.hostname.endsWith('gstatic.com'))) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
