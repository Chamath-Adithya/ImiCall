// Service Worker for ImiCall Background Calling, Web Push Notifications & Instant 2G Offline Caching

const CACHE_NAME = 'imicall-v4-cache';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/icon.svg',
  '/icon-192.svg',
  '/icon-512.svg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => console.warn('Pre-cache warning:', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Cache-First strategy for static assets, Network-First for HTML navigation
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip WebSocket, API, health endpoints, or non-GET
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/ws') ||
    url.pathname.startsWith('/health') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // 1. Static hashed assets (/assets/*): Cache-First for instant 0ms 2G loading
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 2. Navigation requests: Network-First with instant cached index.html fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match('/') || caches.match('/index.html'))
    );
    return;
  }

  // 3. Other GET requests (SVGs, icons, manifests)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return (
        cachedResponse ||
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
      );
    })
  );
});

// Push notification handling
self.addEventListener('push', (event) => {
  let data = {
    title: '📞 Incoming Call — ImiCall',
    body: 'Your partner is calling on your dedicated line. Tap to answer!',
    url: '/',
    lineId: '',
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    vibrate: [500, 250, 500, 250, 500, 250, 500],
    tag: 'imicall-incoming-call',
    renotify: true,
    requireInteraction: true,
    data: {
      url: data.url || `/#line=${data.lineId || ''}`,
    },
    actions: [
      { action: 'answer', title: '📞 Answer Call' },
      { action: 'decline', title: '❌ Decline' },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'decline') {
    return;
  }

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
