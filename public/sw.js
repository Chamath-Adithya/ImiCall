// Versioned app shell: cached UI opens immediately, including offline.
const CACHE_NAME = 'imicall-shell-__BUILD_ID__';
const PRECACHE_URLS = /*__PRECACHE__*/ ['/', '/icon.svg', '/manifest.json'];
const OPTIONAL_URLS = /*__OPTIONAL__*/ [];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)));
  // A new version waits until the user chooses Update, so a call is never interrupted.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = (await caches.keys()).filter(key => key.startsWith('imicall-'));
    // Keep one previous version for tabs that are still finishing their session.
    const old = keys.filter(key => key !== CACHE_NAME);
    await Promise.all(old.slice(0, -1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
  if (event.data?.type === 'CACHE_OPTIONAL') event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const url of OPTIONAL_URLS) if (!(await cache.match(url))) {
      try { const response = await fetch(url); if (response.ok) await cache.put(url, response); } catch { break; }
    }
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || /^\/(api|ws|health)(\/|$)/.test(url.pathname)) return;
  // Never put an invitation query string into persistent cache.
  if (url.search) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const key = event.request.mode === 'navigate' && url.pathname === '/' ? '/' : event.request;
    const saved = await cache.match(key);
    if (saved) return saved;
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type === 'basic') await cache.put(key, response.clone());
      return response;
    } catch {
      return new Response('This screen has not been saved yet. Reconnect once to download it.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
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
    icon: '/icon-192.svg',
    badge: '/favicon.svg',
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

  const requested = new URL(event.notification.data?.url || '/', self.location.origin);
  const targetUrl = requested.origin === self.location.origin ? requested.href : self.location.origin;

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
