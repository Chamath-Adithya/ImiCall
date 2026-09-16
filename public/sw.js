// Service Worker for ImiCall Background Calling & Web Push Notifications

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

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
