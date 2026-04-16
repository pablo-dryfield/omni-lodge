/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const fileExtensionRegexp = new RegExp('/[^/?]+\\.[^/]+$');
registerRoute(
  ({ request, url }) => {
    if (request.mode !== 'navigate') {
      return false;
    }

    if (url.pathname.startsWith('/_')) {
      return false;
    }

    if (url.pathname.match(fileExtensionRegexp)) {
      return false;
    }

    return true;
  },
  createHandlerBoundToURL(`${process.env.PUBLIC_URL ?? ''}/index.html`),
);

registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/static/'),
  new StaleWhileRevalidate({
    cacheName: 'static-resources',
    plugins: [
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  }),
);

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', (event) => {
  const payload = (() => {
    if (!event.data) {
      return {};
    }
    try {
      return event.data.json() as Record<string, unknown>;
    } catch {
      return {
        title: 'Task reminder',
        body: event.data.text(),
      };
    }
  })();

  const title =
    typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : 'Task reminder';
  const body =
    typeof payload.body === 'string' && payload.body.trim()
      ? payload.body.trim()
      : 'You have a pending task to complete.';
  const targetUrl =
    typeof payload.url === 'string' && payload.url.trim()
      ? payload.url.trim()
      : '/assistant-manager-tasks?section=dashboard';
  const tag =
    typeof payload.tag === 'string' && payload.tag.trim()
      ? payload.tag.trim()
      : 'am-task-reminder';
  const renotify = payload.renotify === true;
  const requireInteraction = payload.requireInteraction === true;
  const silent = payload.silent === true;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify,
      requireInteraction,
      silent,
      data: {
        targetUrl,
      },
      badge: `${process.env.PUBLIC_URL ?? ''}/logo192.png`,
      icon: `${process.env.PUBLIC_URL ?? ''}/logo192.png`,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notificationData = event.notification.data as
    | { targetUrl?: string }
    | undefined;
  const targetUrl =
    notificationData?.targetUrl && notificationData.targetUrl.trim()
      ? notificationData.targetUrl
      : '/assistant-manager-tasks?section=dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const matchingClient = clients.find((client) => {
        const url = new URL(client.url);
        return url.pathname === '/assistant-manager-tasks';
      });

      if (matchingClient) {
        matchingClient.navigate(targetUrl).catch(() => undefined);
        return matchingClient.focus();
      }

      return self.clients.openWindow(targetUrl);
    }),
  );
});
