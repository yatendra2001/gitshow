/* gitshow service worker — Web Push + click-to-focus.
 *
 * Scope: entire origin. Registered from components/notifications/push-enable.tsx.
 * Responsibilities:
 *   1. Receive `push` events from the browser's push service and
 *      render them as notifications (title + body + deep link).
 *   2. On notification click, focus the existing tab or open a new
 *      one at action_url.
 *
 * Intentionally minimal. No offline caching, no prefetching — this
 * service worker is for notifications only.
 */

self.addEventListener("install", (event) => {
  // Activate immediately; we don't ship a precache.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "gitshow", body: "", url: "/" };
  try {
    if (event.data) {
      payload = Object.assign(payload, event.data.json());
    }
  } catch (err) {
    // Plain text fallback.
    try {
      if (event.data) payload.body = event.data.text();
    } catch {
      /* swallow */
    }
  }

  const options = {
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-72.png",
    data: { url: payload.url ?? "/" },
    tag: payload.tag || "gitshow",
    renotify: Boolean(payload.renotify),
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientsList) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
      return undefined;
    })(),
  );
});
