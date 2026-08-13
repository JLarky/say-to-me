self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "say-to-me";
  const options = {
    body: data.body || "",
    tag: data.tag || "say-to-me",
    // Without renotify, a same-tag push silently updates in place instead of
    // re-alerting, so the user never notices it.
    renotify: true,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && client.focus) return client.focus();
      }
      return clients.openWindow(url);
    }),
  );
});
