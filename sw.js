const CACHE_VERSION = 'lmt-v3';

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './charts.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4',
  'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

const ALL_ASSETS = [...STATIC_ASSETS, ...CDN_ASSETS];

// Install: pre-cache all assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ALL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: delete old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for all requests
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        if (
          response.ok &&
          (event.request.url.startsWith(self.location.origin) ||
            event.request.url.includes('cdn.jsdelivr.net'))
        ) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback for navigation requests
      if (event.request.mode === 'navigate') {
        return caches.match(new URL('./index.html', self.location).href);
      }
    })
  );
});

// Notification click: open/focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing tab if open
      for (const client of windowClients) {
        if (client.url.includes('index.html') || client.url.endsWith('/')) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      return clients.openWindow('./index.html');
    })
  );
});
