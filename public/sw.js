// Service worker: shows the server's Web Push notifications, even with no tab open.

// A new version takes over at once instead of waiting for every open tab to close. It caches nothing
// and serves no requests, so there is nothing to keep consistent between versions.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('push', (event) => {
  let msg;
  try {
    msg = event.data.json();
  } catch {
    // Not the server's JSON (a DevTools test push, say). Show it anyway: every push must show something.
    msg = { title: 'Session Runner', body: event.data?.text() ?? '' };
  }

  // Close the last one rather than reuse its tag: macOS swaps in a same-tag notification silently,
  // with no banner, even with renotify. A fresh one each time always shows.
  event.waitUntil(
    self.registration.getNotifications().then((old) => {
      old.forEach((n) => n.close());
      return self.registration.showNotification(msg.title, { body: msg.body });
    }),
  );
});

// Clicking it brings back an open tab, or opens one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((tabs) => (tabs[0] ? tabs[0].focus() : self.clients.openWindow('/'))),
  );
});
