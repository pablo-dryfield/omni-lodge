/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';
import {
  jsonUtf8ByteLength,
  selectUtf8EventBatch,
} from './utils/errorMonitoringByteBudget';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

const resolveApiOrigin = (): string =>
  self.location.hostname === 'transaction.omni-lodge.com'
  || self.location.hostname === 'counter.omni-lodge.com'
    ? 'https://omni-lodge.com'
    : '';

const diagnosticString = (value: unknown, fallback: string): string => {
  try {
    return String(value ?? fallback);
  } catch {
    return fallback;
  }
};

const redactDiagnosticText = (value: unknown, maxLength: number): string =>
  diagnosticString(value, 'Unknown service worker error')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-token]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/(\b(?:password|secret|token|authorization|api[_-]?key)\b\s*[:=]\s*)[^\s,;&]+/gi, '$1[redacted]')
    .replace(/([?&][^=&#\s]{1,100}=)[^&#\s)\]]+/g, '$1[redacted]')
    .replace(/\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/gi, '[redacted-iban]')
    .replace(/\b(?:\d[ -]?){20,34}\b/g, '[redacted-bank-account]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[redacted-number]')
    .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, '[redacted-phone]')
    .replace(/\b(amount|balance|salary|wage|compensation|reimbursement|payout|revenue|price|cost|subtotal|grand[_ -]?total)\s*[:=]\s*(?:PLN|EUR|USD|GBP|z\u0142|\u20ac|\$)?\s*-?\d[\d .,]*/gi, '$1=[redacted]')
    .replace(/(?:\b(?:PLN|EUR|USD|GBP|CHF)\b|z\u0142|\u20ac|\$)\s*-?\d[\d .,]*/gi, '[redacted-amount]')
    .replace(/\b-?\d[\d .,]*\s*(?:PLN|EUR|USD|GBP|CHF|z\u0142)(?![A-Za-z0-9])/gi, '[redacted-amount]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[uuid]')
    .replace(/\b(?=[A-Za-z0-9_-]{24,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g, '[opaque-id]')
    .slice(0, maxLength);

type ServiceWorkerErrorType = 'exception' | 'unhandled_rejection';

type ServiceWorkerErrorEvent = {
  eventId: string;
  capturedUserId: null;
  type: ServiceWorkerErrorType;
  level: 'error';
  name: string;
  message: string;
  stack?: string;
  occurredAt: string;
  route: '/service-worker';
  pageUrl: string;
  release: string;
  environment: string;
  context: { runtime: 'service-worker'; operation?: string };
};

type StoredServiceWorkerError = {
  id: string;
  event: ServiceWorkerErrorEvent;
  enqueuedAt: number;
  attempts: number;
  nextAttemptAt: number;
};

const SERVICE_WORKER_ERROR_DB = 'omnilodge-service-worker-monitoring';
const SERVICE_WORKER_ERROR_STORE = 'errors';
const SERVICE_WORKER_ERROR_SYNC_TAG = 'omnilodge-service-worker-errors';
const MAX_SERVICE_WORKER_ERRORS = 40;
const MAX_SERVICE_WORKER_ERROR_BYTES = 512_000;
const MAX_SERVICE_WORKER_ERROR_BATCH = 10;
// The API accepts 64 KiB. Keep a margin for intermediaries and future envelope
// fields, and treat this as an exclusive UTF-8 byte limit.
const MAX_SERVICE_WORKER_BATCH_BYTES = 55_000;
let serviceWorkerErrorMemoryQueue: StoredServiceWorkerError[] = [];
let serviceWorkerErrorDb: Promise<IDBDatabase> | null = null;
let serviceWorkerErrorDbDisabled = false;
let serviceWorkerErrorFlush: Promise<void> | null = null;
let serviceWorkerErrorRetryTimer: ReturnType<typeof setTimeout> | null = null;
let serviceWorkerErrorRetryAt: number | null = null;

const createServiceWorkerErrorId = (): string => {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Use the local fallback below in constrained worker runtimes.
  }
  return `sw-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const serviceWorkerIndexedDb = (): IDBFactory | null => {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
};

const openServiceWorkerErrorDb = (): Promise<IDBDatabase> => {
  const factory = serviceWorkerIndexedDb();
  if (serviceWorkerErrorDbDisabled || !factory) {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (serviceWorkerErrorDb) {
    return serviceWorkerErrorDb;
  }
  serviceWorkerErrorDb = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(SERVICE_WORKER_ERROR_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SERVICE_WORKER_ERROR_STORE)) {
        db.createObjectStore(SERVICE_WORKER_ERROR_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open error queue'));
    request.onblocked = () => reject(new Error('Error queue database is blocked'));
  }).catch((error) => {
    serviceWorkerErrorDb = null;
    throw error;
  });
  return serviceWorkerErrorDb;
};

const readPersistedServiceWorkerErrors = async (): Promise<StoredServiceWorkerError[]> => {
  const db = await openServiceWorkerErrorDb();
  return new Promise<StoredServiceWorkerError[]>((resolve, reject) => {
    const request = db
      .transaction(SERVICE_WORKER_ERROR_STORE, 'readonly')
      .objectStore(SERVICE_WORKER_ERROR_STORE)
      .getAll();
    request.onsuccess = () => resolve(request.result as StoredServiceWorkerError[]);
    request.onerror = () => reject(request.error || new Error('Unable to read error queue'));
  });
};

const writePersistedServiceWorkerError = async (
  item: StoredServiceWorkerError,
): Promise<void> => {
  const db = await openServiceWorkerErrorDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SERVICE_WORKER_ERROR_STORE, 'readwrite');
    transaction.objectStore(SERVICE_WORKER_ERROR_STORE).put(item);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Unable to write error queue'));
    transaction.onabort = () => reject(transaction.error || new Error('Error queue write aborted'));
  });
};

const deletePersistedServiceWorkerErrors = async (ids: string[]): Promise<void> => {
  if (!ids.length) return;
  const db = await openServiceWorkerErrorDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SERVICE_WORKER_ERROR_STORE, 'readwrite');
    const store = transaction.objectStore(SERVICE_WORKER_ERROR_STORE);
    ids.forEach((id) => store.delete(id));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Unable to prune error queue'));
    transaction.onabort = () => reject(transaction.error || new Error('Error queue prune aborted'));
  });
};

const mergeServiceWorkerErrorQueues = (
  persisted: StoredServiceWorkerError[],
): StoredServiceWorkerError[] => {
  const byId = new Map<string, StoredServiceWorkerError>();
  [...persisted, ...serviceWorkerErrorMemoryQueue].forEach((item) => {
    const previous = byId.get(item.id);
    if (!previous || item.attempts >= previous.attempts) {
      byId.set(item.id, item);
    }
  });
  return Array.from(byId.values()).sort((a, b) => a.enqueuedAt - b.enqueuedAt);
};

const boundedServiceWorkerErrors = (
  items: StoredServiceWorkerError[],
): { kept: StoredServiceWorkerError[]; removedIds: string[] } => {
  const newestFirst = [...items].sort((a, b) => b.enqueuedAt - a.enqueuedAt);
  const keptNewestFirst: StoredServiceWorkerError[] = [];
  let bytes = 0;
  newestFirst.forEach((item) => {
    const itemBytes = jsonUtf8ByteLength(item);
    if (
      Number.isFinite(itemBytes)
      && keptNewestFirst.length < MAX_SERVICE_WORKER_ERRORS
      && bytes + itemBytes <= MAX_SERVICE_WORKER_ERROR_BYTES
    ) {
      keptNewestFirst.push(item);
      bytes += itemBytes;
    }
  });
  const keptIds = new Set(keptNewestFirst.map((item) => item.id));
  return {
    kept: keptNewestFirst.reverse(),
    removedIds: items.filter((item) => !keptIds.has(item.id)).map((item) => item.id),
  };
};

const readServiceWorkerErrorQueue = async (): Promise<StoredServiceWorkerError[]> => {
  let persisted: StoredServiceWorkerError[] = [];
  if (!serviceWorkerErrorDbDisabled) {
    try {
      persisted = await readPersistedServiceWorkerErrors();
    } catch {
      serviceWorkerErrorDbDisabled = true;
      serviceWorkerErrorDb = null;
    }
  }
  const bounded = boundedServiceWorkerErrors(mergeServiceWorkerErrorQueues(persisted));
  serviceWorkerErrorMemoryQueue = bounded.kept;
  if (!serviceWorkerErrorDbDisabled && bounded.removedIds.length) {
    try {
      await deletePersistedServiceWorkerErrors(bounded.removedIds);
    } catch {
      serviceWorkerErrorDbDisabled = true;
      serviceWorkerErrorDb = null;
    }
  }
  return bounded.kept;
};

const persistServiceWorkerError = async (item: StoredServiceWorkerError): Promise<void> => {
  const merged = mergeServiceWorkerErrorQueues([item]);
  const bounded = boundedServiceWorkerErrors(merged);
  serviceWorkerErrorMemoryQueue = bounded.kept;
  if (serviceWorkerErrorDbDisabled) return;
  try {
    await Promise.all(bounded.kept.map((entry) => writePersistedServiceWorkerError(entry)));
    if (bounded.removedIds.length) {
      await deletePersistedServiceWorkerErrors(bounded.removedIds);
    }
  } catch {
    // The memory mirror keeps this worker-session's events deliverable.
    serviceWorkerErrorDbDisabled = true;
    serviceWorkerErrorDb = null;
  }
};

const removeServiceWorkerErrors = async (ids: string[]): Promise<void> => {
  const removed = new Set(ids);
  serviceWorkerErrorMemoryQueue = serviceWorkerErrorMemoryQueue.filter(
    (item) => !removed.has(item.id),
  );
  if (serviceWorkerErrorDbDisabled) return;
  try {
    await deletePersistedServiceWorkerErrors(ids);
  } catch {
    serviceWorkerErrorDbDisabled = true;
    serviceWorkerErrorDb = null;
  }
};

const replaceUnsendableServiceWorkerError = async (
  item: StoredServiceWorkerError,
): Promise<void> => {
  // Never retry a record which cannot fit into an otherwise-empty API batch.
  // Replace it with a compact diagnostic so operators still know telemetry was
  // discarded, without retaining any oversized or malformed original fields.
  await removeServiceWorkerErrors([item.id]);
  const now = Date.now();
  const eventId = createServiceWorkerErrorId();
  await persistServiceWorkerError({
    id: eventId,
    enqueuedAt: now,
    attempts: 0,
    nextAttemptAt: now,
    event: {
      eventId,
      capturedUserId: null,
      type: 'exception',
      level: 'error',
      name: 'MonitoringPayloadTooLarge',
      message: 'A service worker diagnostic exceeded the safe transport size and was discarded',
      occurredAt: new Date(now).toISOString(),
      route: '/service-worker',
      pageUrl: '/service-worker',
      release:
        process.env.REACT_APP_BUILD_VERSION
        || process.env.REACT_APP_RELEASE
        || process.env.REACT_APP_GIT_SHA
        || 'service-worker',
      environment: process.env.NODE_ENV || 'production',
      context: {
        runtime: 'service-worker',
        operation: 'replace_oversized_monitoring_payload',
      },
    },
  });
};

const requestServiceWorkerErrorSync = async (): Promise<void> => {
  const registration = self.registration as ServiceWorkerRegistration & {
    sync?: { register: (tag: string) => Promise<void> };
  };
  try {
    await registration.sync?.register(SERVICE_WORKER_ERROR_SYNC_TAG);
  } catch {
    // Background Sync is optional; lifecycle events and a bounded timer retry too.
  }
};

const scheduleServiceWorkerErrorRetry = (delayMs: number): void => {
  const boundedDelay = Math.max(1_000, Math.min(delayMs, 60_000));
  const retryAt = Date.now() + boundedDelay;
  // A later failure must not postpone an earlier retry already promised to a
  // queued event.
  if (serviceWorkerErrorRetryTimer !== null && serviceWorkerErrorRetryAt !== null) {
    if (serviceWorkerErrorRetryAt <= retryAt) return;
    clearTimeout(serviceWorkerErrorRetryTimer);
  }
  serviceWorkerErrorRetryAt = retryAt;
  serviceWorkerErrorRetryTimer = setTimeout(() => {
    serviceWorkerErrorRetryTimer = null;
    serviceWorkerErrorRetryAt = null;
    void flushServiceWorkerErrors().catch(() => undefined);
  }, boundedDelay);
};

const fetchServiceWorkerTelemetry = async (
  url: string,
  init: RequestInit,
): Promise<Response> => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      try {
        controller?.abort();
      } catch {
        // Promise.race still releases the queue flush below.
      }
      reject(new Error('Service worker telemetry delivery timed out'));
    }, 15_000);
  });
  try {
    return await Promise.race([
      fetch(url, { ...init, ...(controller ? { signal: controller.signal } : {}) }),
      timeoutPromise,
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
};

const flushServiceWorkerErrors = async (): Promise<void> => {
  if (serviceWorkerErrorFlush) return serviceWorkerErrorFlush;
  serviceWorkerErrorFlush = (async () => {
    const queue = await readServiceWorkerErrorQueue();
    const now = Date.now();
    const selection = selectUtf8EventBatch(
      queue.filter((item) => item.nextAttemptAt <= now),
      (item) => item.event,
      MAX_SERVICE_WORKER_ERROR_BATCH,
      MAX_SERVICE_WORKER_BATCH_BYTES,
    );
    for (const item of selection.individuallyUnsendable) {
      await replaceUnsendableServiceWorkerError(item);
    }
    const batch = selection.selected;
    if (!batch.length) {
      const refreshedQueue = selection.individuallyUnsendable.length > 0
        ? await readServiceWorkerErrorQueue()
        : queue;
      const nextAttemptAt = refreshedQueue.reduce<number | null>(
        (earliest, item) => item.nextAttemptAt > now && (earliest === null || item.nextAttemptAt < earliest)
          ? item.nextAttemptAt
          : earliest,
        null,
      );
      if (selection.individuallyUnsendable.length > 0) {
        scheduleServiceWorkerErrorRetry(1_000);
      } else if (nextAttemptAt !== null) {
        scheduleServiceWorkerErrorRetry(nextAttemptAt - now);
      }
      return;
    }

    try {
      const response = await fetchServiceWorkerTelemetry(`${resolveApiOrigin()}/api/client-errors/batch`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-OmniLodge-Telemetry': '1',
        },
        body: selection.body,
      });
      if (!response.ok) {
        throw new Error(`Error monitoring endpoint returned ${response.status}`);
      }
      await removeServiceWorkerErrors(batch.map((item) => item.id));
      const remaining = await readServiceWorkerErrorQueue();
      if (remaining.length) {
        const earliestRetry = remaining.reduce(
          (earliest, item) => Math.min(earliest, item.nextAttemptAt),
          Number.POSITIVE_INFINITY,
        );
        scheduleServiceWorkerErrorRetry(Math.max(1_000, earliestRetry - Date.now()));
      }
    } catch {
      const retryAt = Date.now();
      await Promise.all(batch.map((item) => {
        const attempts = item.attempts + 1;
        return persistServiceWorkerError({
          ...item,
          attempts,
          nextAttemptAt: retryAt + Math.min(60 * 60 * 1_000, 5_000 * (2 ** Math.min(attempts, 7))),
        });
      }));
      await requestServiceWorkerErrorSync();
      const remaining = await readServiceWorkerErrorQueue();
      const earliestRetry = remaining.reduce<number | null>(
        (earliest, item) => earliest === null || item.nextAttemptAt < earliest
          ? item.nextAttemptAt
          : earliest,
        null,
      );
      scheduleServiceWorkerErrorRetry(
        earliestRetry === null ? 15_000 : Math.max(1_000, earliestRetry - Date.now()),
      );
    }
  })().finally(() => {
    serviceWorkerErrorFlush = null;
  });
  return serviceWorkerErrorFlush;
};

const enqueueServiceWorkerError = async (
  type: 'exception' | 'unhandled_rejection',
  error: unknown,
  operation?: string,
): Promise<void> => {
  let candidate: Error;
  try {
    candidate = error instanceof Error
      ? error
      : new Error(diagnosticString(error, 'Unknown service worker error'));
  } catch {
    candidate = new Error('Unreadable service worker error');
  }
  const eventId = createServiceWorkerErrorId();
  const now = Date.now();
  await persistServiceWorkerError({
    id: eventId,
    enqueuedAt: now,
    attempts: 0,
    nextAttemptAt: now,
    event: {
      eventId,
      capturedUserId: null,
      type,
      level: 'error',
      name: redactDiagnosticText(candidate.name || 'ServiceWorkerError', 160),
      message: redactDiagnosticText(candidate.message, 2_000),
      stack: candidate.stack ? redactDiagnosticText(candidate.stack, 12_000) : undefined,
      occurredAt: new Date(now).toISOString(),
      route: '/service-worker',
      pageUrl: self.location.pathname,
      release:
        process.env.REACT_APP_BUILD_VERSION
        || process.env.REACT_APP_RELEASE
        || process.env.REACT_APP_GIT_SHA
        || 'service-worker',
      environment: process.env.NODE_ENV || 'production',
      context: {
        runtime: 'service-worker',
        ...(operation ? { operation: redactDiagnosticText(operation, 100) } : {}),
      },
    },
  });
  await requestServiceWorkerErrorSync();
  await flushServiceWorkerErrors();
};

const keepServiceWorkerAlive = (event: Event, work: Promise<unknown>): void => {
  const extendableEvent = event as Event & { waitUntil?: (promise: Promise<unknown>) => void };
  const guardedWork = work.catch(() => undefined);
  if (typeof extendableEvent.waitUntil === 'function') {
    extendableEvent.waitUntil(guardedWork);
    return;
  }
  void guardedWork;
};

// Install failure listeners before any Workbox initialization below. A broken
// precache manifest or route registration is otherwise capable of terminating
// evaluation before monitoring becomes active.
self.addEventListener('error', (event) => {
  keepServiceWorkerAlive(
    event,
    enqueueServiceWorkerError('exception', event.error || event.message || 'Service worker error'),
  );
});

self.addEventListener('unhandledrejection', (event) => {
  keepServiceWorkerAlive(event, enqueueServiceWorkerError('unhandled_rejection', event.reason));
});

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

// iOS and some embedded browsers do not expose Background Sync. A throttled
// waitUntil on ordinary activity gives persisted diagnostics another delivery
// opportunity without changing or delaying the intercepted response.
let lastOpportunisticErrorFlush = 0;
self.addEventListener('fetch', (event) => {
  const now = Date.now();
  if (now - lastOpportunisticErrorFlush < 30_000) return;
  lastOpportunisticErrorFlush = now;
  event.waitUntil(flushServiceWorkerErrors().catch(() => undefined));
});

self.addEventListener('install', (event) => {
  event.waitUntil(flushServiceWorkerErrors().catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(flushServiceWorkerErrors().catch(() => undefined));
});

self.addEventListener('message', (event) => {
  const skipWaiting = event.data && event.data.type === 'SKIP_WAITING'
    ? self.skipWaiting()
    : Promise.resolve();
  event.waitUntil(
    Promise.all([skipWaiting, flushServiceWorkerErrors()]).then(() => undefined).catch(() => undefined),
  );
});

type BackgroundSyncEvent = ExtendableEvent & { tag: string };
const serviceWorkerWithSync = self as ServiceWorkerGlobalScope & {
  addEventListener(
    type: 'sync',
    listener: (event: BackgroundSyncEvent) => void,
  ): void;
};
serviceWorkerWithSync.addEventListener('sync', (event) => {
  if (event.tag === SERVICE_WORKER_ERROR_SYNC_TAG) {
    event.waitUntil(flushServiceWorkerErrors().catch(() => undefined));
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
    const apiOrigin = resolveApiOrigin();
    await fetch(`${apiOrigin}/api/notifications/push/receipt`, {
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
        // This failure is explicitly captured here. Do not rethrow it into the
        // global rejection listener and create a duplicate occurrence.
        await enqueueServiceWorkerError('exception', error, 'show_notification').catch(() => undefined);
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
