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

type PushReceiptEventType =
  | 'push_received'
  | 'notification_shown'
  | 'notification_show_failed'
  | 'notification_clicked'
  | 'notification_closed';

const postPushReceipt = async (params: {
  tag?: string | null;
  userId?: number | null;
  eventType: PushReceiptEventType;
  targetUrl?: string | null;
  error?: string | null;
}): Promise<void> => {
  const tag = typeof params.tag === 'string' ? params.tag.trim() : '';
  if (!tag) {
    return;
  }

  try {
    await fetch('/api/notifications/push/receipt', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: params.userId ?? null,
        tag,
        eventType: params.eventType,
        targetUrl: params.targetUrl ?? null,
        error: params.error ?? null,
        userAgent: self.navigator.userAgent ?? null,
        visibilityState: 'service-worker',
      }),
    });
  } catch {
    // Best-effort telemetry only.
  }
};

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
  const debugUserId =
    typeof payload.debugUserId === 'number' && Number.isFinite(payload.debugUserId)
      ? Math.trunc(payload.debugUserId)
      : null;
  const renotify = payload.renotify === true;
  const requireInteraction = payload.requireInteraction === true;
  const silent = payload.silent === true;

  event.waitUntil(
    (async () => {
      await postPushReceipt({
        tag,
        userId: debugUserId,
        eventType: 'push_received',
        targetUrl,
      });
      try {
        await self.registration.showNotification(title, {
          body,
          tag,
          renotify,
          requireInteraction,
          silent,
          data: {
            targetUrl,
            tag,
            debugUserId,
          },
          badge: `${process.env.PUBLIC_URL ?? ''}/logo192.png`,
          icon: `${process.env.PUBLIC_URL ?? ''}/logo192.png`,
          vibrate: silent ? undefined : [120, 80, 120],
        });
        await postPushReceipt({
          tag,
          userId: debugUserId,
          eventType: 'notification_shown',
          targetUrl,
        });
      } catch (error) {
        await postPushReceipt({
          tag,
          userId: debugUserId,
          eventType: 'notification_show_failed',
          targetUrl,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notificationData = event.notification.data as
    | { targetUrl?: string; tag?: string; debugUserId?: number }
    | undefined;
  const targetUrl =
    notificationData?.targetUrl && notificationData.targetUrl.trim()
      ? notificationData.targetUrl
      : '/assistant-manager-tasks?section=dashboard';
  const tag =
    typeof notificationData?.tag === 'string' && notificationData.tag.trim()
      ? notificationData.tag.trim()
      : event.notification.tag;
  const debugUserId =
    typeof notificationData?.debugUserId === 'number' &&
    Number.isFinite(notificationData.debugUserId)
      ? Math.trunc(notificationData.debugUserId)
      : null;

  event.waitUntil(
    (async () => {
      await postPushReceipt({
        tag,
        userId: debugUserId,
        eventType: 'notification_clicked',
        targetUrl,
      });

      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const matchingClient = clients.find((client) => {
        const url = new URL(client.url);
        return url.pathname === '/assistant-manager-tasks';
      });

      if (matchingClient) {
        matchingClient.navigate(targetUrl).catch(() => undefined);
        return matchingClient.focus();
      }

      return self.clients.openWindow(targetUrl);
    })(),
  );
});

self.addEventListener('notificationclose', (event) => {
  const notificationData = event.notification.data as
    | { targetUrl?: string; tag?: string; debugUserId?: number }
    | undefined;
  const targetUrl =
    notificationData?.targetUrl && notificationData.targetUrl.trim()
      ? notificationData.targetUrl
      : null;
  const tag =
    typeof notificationData?.tag === 'string' && notificationData.tag.trim()
      ? notificationData.tag.trim()
      : event.notification.tag;
  const debugUserId =
    typeof notificationData?.debugUserId === 'number' &&
    Number.isFinite(notificationData.debugUserId)
      ? Math.trunc(notificationData.debugUserId)
      : null;

  event.waitUntil(
    postPushReceipt({
      tag,
      userId: debugUserId,
      eventType: 'notification_closed',
      targetUrl,
    }),
  );
});
