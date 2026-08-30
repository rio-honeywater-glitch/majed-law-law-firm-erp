// Service Worker — Web Push notifications
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { title: event.data.text() }; }

  const title = data.title ?? "إشعار جديد";
  const options = {
    body: data.body ?? "",
    icon: "/logo192.png",
    badge: "/logo192.png",
    dir: "rtl",
    lang: "ar",
    data: { url: data.url ?? "/" },
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: false,
  };

  // Notify open tabs so they can play the notification sound
  const notifyTabs = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clientList) => {
      for (const client of clientList) {
        client.postMessage({ type: "PUSH_RECEIVED", title, body: data.body ?? "" });
      }
    });

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      notifyTabs,
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    }),
  );
});
