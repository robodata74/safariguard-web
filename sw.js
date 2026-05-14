// SafariGuard Global — Service Worker v2
// Enables offline access and phone app installation

const CACHE   = 'safariguard-v2';
const OFFLINE  = '/safariguard-web/index.html';

const ASSETS = [
  '/safariguard-web/',
  '/safariguard-web/index.html',
  '/safariguard-web/manifest.json',
  '/safariguard-web/dashboard.html',
];

// ── INSTALL — pre-cache core shell ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .catch(err => console.warn('[SW] Pre-cache failed:', err))
  );
  self.skipWaiting();
});

// ── ACTIVATE — purge stale caches ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH — cache-first for shell, network-first for data ──
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Never intercept: Firebase, Maps, PayPal, Cloudflare Worker, fonts
  if (
    url.includes('workers.dev')      ||
    url.includes('firebaseio.com')   ||
    url.includes('googleapis.com')   ||
    url.includes('gstatic.com')      ||
    url.includes('paypal.com')       ||
    url.includes('fonts.googleapis') ||
    e.request.method !== 'GET'
  ) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Return cache immediately, then update in background (stale-while-revalidate)
        const refresh = fetch(e.request).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => {});
        return cached;
      }

      // Not in cache — fetch from network and cache the result
      return fetch(e.request)
        .then(res => {
          if (!res || res.status !== 200 || res.type === 'opaque') return res;
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(OFFLINE));
    })
  );
});
