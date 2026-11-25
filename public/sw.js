/**
 * Service Worker — handles Web Push notifications for NQ Weather corridor alerts.
 */

/* eslint-env serviceworker */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'NQ Weather Alert', body: event.data.text() };
  }

  const title = data.title || 'NQ Weather Alert';
  const options = {
    body: data.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.tag || 'nq-weather',
    data: { url: data.url || '/' },
    requireInteraction: data.severity === 'critical' || data.severity === 'high',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing tab if one is open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus().then((c) => c.navigate(url));
        }
      }
      // Otherwise open a new window
      return clients.openWindow(url);
    }),
  );
});
