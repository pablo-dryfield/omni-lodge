import devConfig from "../config/devConfig";
import prodConfig from "../config/prodConfig";
import { createBrowserClientErrorQueueStore } from "./errorMonitoringQueue";
import {
  describeElement,
  normalizeError,
  redactCorrelationId,
  redactString,
  redactUrl,
  sanitizeForTelemetry,
} from "./errorMonitoringSanitizer";
import type {
  ApiFailureCapture,
  ClientErrorBreadcrumb,
  ClientErrorCapture,
  ClientErrorEvent,
  ClientErrorHttpContext,
  ClientErrorQueueStore,
  ErrorMonitoringOptions,
  ErrorMonitoringUserContext,
  QueuedClientError,
} from "./errorMonitoringTypes";

export type {
  ApiFailureCapture,
  ClientErrorCapture,
  ClientErrorEvent,
  ErrorMonitoringOptions,
  ErrorMonitoringUserContext,
} from "./errorMonitoringTypes";

const apiConfig = process.env.NODE_ENV === "production" ? prodConfig : devConfig;
const DEFAULT_ENDPOINT = `${apiConfig.baseURL.replace(/\/+$/, "")}/client-errors/batch`;
const SESSION_STORAGE_KEY = "omnilodge:error-monitoring:session:v1";
const DEFAULT_FLUSH_INTERVAL_MS = 30_000;
const DEFAULT_MAX_QUEUE_SIZE = 100;
const DEFAULT_MAX_QUEUE_BYTES = 750_000;
const DEFAULT_DEDUPE_WINDOW_MS = 30_000;
const DEFAULT_TRANSPORT_TIMEOUT_MS = 15_000;
const MAX_BATCH_EVENTS = 20;
const MAX_BATCH_BYTES = 55_000;
const MAX_BREADCRUMBS = 30;
const AXIOS_START_KEY = "__omnilodgeErrorMonitoringStartedAt";

type InternalOptions = Required<
  Pick<
    ErrorMonitoringOptions,
    | "endpoint"
    | "environment"
    | "captureConsole"
    | "captureFetch"
    | "captureNetworkTransports"
    | "flushIntervalMs"
    | "maxQueueSize"
    | "maxQueueBytes"
    | "dedupeWindowMs"
    | "transportTimeoutMs"
  >
> &
  Pick<
    ErrorMonitoringOptions,
    | "release"
    | "getUserContext"
    | "queueStore"
    | "fetchImpl"
    | "defaultAxiosClient"
  >;

type NavigatorWithDiagnostics = Navigator & {
  deviceMemory?: number;
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
  standalone?: boolean;
};

const resolveRelease = (): string | undefined => {
  const configured =
    process.env.REACT_APP_RELEASE ||
    process.env.REACT_APP_BUILD_VERSION ||
    process.env.REACT_APP_GIT_SHA ||
    process.env.REACT_APP_BUILD_ID;
  if (configured) {
    return configured;
  }
  if (typeof document !== "undefined") {
    const metaRelease = document
      .querySelector<HTMLMetaElement>('meta[name="app-version"], meta[name="build-id"]')
      ?.content.trim();
    if (metaRelease) {
      return metaRelease;
    }
    const mainBundle = Array.from(document.scripts || [])
      .map((script) => script.src)
      .find((source) => /\/static\/js\/main\.[a-z0-9]+\.js(?:$|\?)/i.test(source));
    const bundleHash = mainBundle?.match(/\/main\.([a-z0-9]+)\.js(?:$|\?)/i)?.[1];
    if (bundleHash) {
      return `web-${bundleHash}`;
    }
  }
  if (typeof window !== "undefined") {
    const build = (window as unknown as {
      __OMNILODGE_BUILD__?: { release?: unknown; version?: unknown; commit?: unknown };
    }).__OMNILODGE_BUILD__;
    const candidate = build?.release ?? build?.version ?? build?.commit;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return `web-${process.env.NODE_ENV || "unversioned"}`;
};

let options: InternalOptions = {
  endpoint: DEFAULT_ENDPOINT,
  release: resolveRelease(),
  environment: process.env.NODE_ENV || "unknown",
  captureConsole: true,
  captureFetch: true,
  captureNetworkTransports: true,
  flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
  maxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
  maxQueueBytes: DEFAULT_MAX_QUEUE_BYTES,
  dedupeWindowMs: DEFAULT_DEDUPE_WINDOW_MS,
  transportTimeoutMs: DEFAULT_TRANSPORT_TIMEOUT_MS,
};

let queueStore: ClientErrorQueueStore | null = null;
let queueOperation: Promise<unknown> = Promise.resolve();
let flushTimer: number | null = null;
let flushTimerDueAt: number | null = null;
let periodicTimer: number | null = null;
let installedCleanup: (() => void) | null = null;
let transportFetch: typeof fetch | null = null;
let sending = false;
let activeFlushPromise: Promise<boolean> | null = null;
let internalActivity = 0;
let fallbackUserContext: ErrorMonitoringUserContext | null = null;
let sessionId: string | null = null;
const inFlightEventIds = new Set<string>();
const breadcrumbs: ClientErrorBreadcrumb[] = [];
let pendingQueueOverflowDrops = 0;
let pendingQueueOverflowFatalDrops = 0;
let pendingQueueOverflowFirstAt: string | null = null;

const createId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const random = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random}-${Math.random().toString(36).slice(2)}`;
};

const getSessionId = (): string => {
  if (sessionId) {
    return sessionId;
  }
  if (typeof window !== "undefined") {
    try {
      const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        sessionId = stored;
        return stored;
      }
      sessionId = createId();
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      return sessionId;
    } catch {
      // A privacy mode may disable sessionStorage; an in-memory ID is sufficient.
    }
  }
  sessionId = createId();
  return sessionId;
};

const runQueueOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = queueOperation.then(operation, operation);
  queueOperation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const getQueueStore = (): ClientErrorQueueStore => {
  if (options.queueStore) {
    return options.queueStore;
  }
  if (!queueStore) {
    queueStore = createBrowserClientErrorQueueStore();
  }
  return queueStore;
};

const fnv1a = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const normalizeFingerprintPart = (value: string | undefined): string =>
  (value || "")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>")
    .replace(/\b\d{3,}\b/g, "<number>")
    .slice(0, 2_000);

const RUNTIME_ERROR_TYPES = new Set<ClientErrorEvent["type"]>([
  "react_error",
  "exception",
  "unhandled_rejection",
  "console_error",
]);

const normalizeFailedUrlForFingerprint = (rawUrl: string | undefined): string => {
  const redacted = redactUrl(rawUrl);
  if (!redacted) return "";
  let path = redacted;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://local.invalid";
    path = new URL(redacted, base).pathname;
  } catch {
    path = redacted.replace(/[?#].*$/, "");
  }
  return path
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
    .replace(/\/(?:\d+)(?=\/|$)/g, "/:id")
    .replace(/\/[a-z0-9_-]{20,}(?=\/|$)/gi, "/:id")
    .replace(/([._-])[0-9a-f]{8,}(?=\.)/gi, "$1:hash")
    .slice(0, 1_000);
};

const failedUrlForFingerprint = (event: ClientErrorEvent): string | undefined => {
  if (event.http?.url) return redactUrl(event.http.url);
  if (event.type !== "resource_error" && event.type !== "csp_violation") return undefined;
  const details = event.context?.details;
  const detailRecord = details && typeof details === "object" && !Array.isArray(details)
    ? details as Record<string, unknown>
    : undefined;
  const candidate = event.context?.resourceUrl
    ?? event.context?.blockedUrl
    ?? event.context?.blockedUri
    ?? event.context?.source
    ?? event.context?.sourceFile
    ?? detailRecord?.resourceUrl
    ?? detailRecord?.blockedUrl
    ?? detailRecord?.blockedUri
    ?? detailRecord?.source
    ?? detailRecord?.sourceFile;
  return typeof candidate === "string" ? redactUrl(candidate) : undefined;
};

const fingerprintEvent = (event: ClientErrorEvent): string =>
  fnv1a((() => {
    const runtimeError = RUNTIME_ERROR_TYPES.has(event.type);
    const apiError = event.type === "api_error";
    return [
      runtimeError ? "runtime_error" : event.type,
      runtimeError || apiError ? undefined : event.name,
      apiError ? undefined : normalizeFingerprintPart(event.message),
      apiError
        ? undefined
        : normalizeFingerprintPart(event.stack?.split("\n").slice(0, 3).join("\n")),
      event.route,
      event.http?.method,
      event.http?.status,
      normalizeFailedUrlForFingerprint(failedUrlForFingerprint(event)),
    ].join("|");
  })());

const ERROR_LEVEL_RANK: Record<ClientErrorEvent["level"], number> = {
  warning: 1,
  error: 2,
  fatal: 3,
};

const RUNTIME_TYPE_RANK: Partial<Record<ClientErrorEvent["type"], number>> = {
  console_error: 1,
  unhandled_rejection: 2,
  exception: 3,
  react_error: 4,
};

const richerText = (left: string | undefined, right: string | undefined): string | undefined =>
  (right?.length ?? 0) > (left?.length ?? 0) ? right : left;

const mergeCoalescedEvents = (
  stored: ClientErrorEvent,
  incoming: ClientErrorEvent,
): ClientErrorEvent => {
  const preferIncoming = (RUNTIME_TYPE_RANK[incoming.type] ?? 0) >= (RUNTIME_TYPE_RANK[stored.type] ?? 0);
  const preferred = preferIncoming ? incoming : stored;
  const storedDetails = stored.context?.details;
  const incomingDetails = incoming.context?.details;
  const mergedDetails = {
    ...(storedDetails && typeof storedDetails === "object" && !Array.isArray(storedDetails)
      ? storedDetails as Record<string, unknown>
      : {}),
    ...(incomingDetails && typeof incomingDetails === "object" && !Array.isArray(incomingDetails)
      ? incomingDetails as Record<string, unknown>
      : {}),
  };
  const previousOccurrences = Number(stored.tags?.localOccurrences || 1);
  const incomingOccurrences = Number(incoming.tags?.localOccurrences || 1);
  return {
    ...stored,
    ...preferred,
    eventId: stored.eventId,
    type: preferred.type,
    level: ERROR_LEVEL_RANK[incoming.level] > ERROR_LEVEL_RANK[stored.level]
      ? incoming.level
      : stored.level,
    stack: richerText(stored.stack, incoming.stack),
    componentStack: richerText(stored.componentStack, incoming.componentStack),
    occurredAt: incoming.occurredAt,
    tags: {
      ...(stored.tags || {}),
      ...(incoming.tags || {}),
      localOccurrences: previousOccurrences + incomingOccurrences,
    },
    context: {
      ...(stored.context || {}),
      ...(incoming.context || {}),
      ...(Object.keys(mergedDetails).length > 0 ? { details: mergedDetails } : {}),
      latestOccurrenceAt: incoming.occurredAt,
    },
    breadcrumbs: (incoming.breadcrumbs?.length ?? 0) > (stored.breadcrumbs?.length ?? 0)
      ? incoming.breadcrumbs
      : stored.breadcrumbs,
  };
};

const safeUserContext = (): ErrorMonitoringUserContext | null => {
  let supplied: ErrorMonitoringUserContext | null | undefined;
  try {
    supplied = options.getUserContext?.();
  } catch {
    supplied = null;
  }
  const user = supplied ?? fallbackUserContext;
  if (!user) {
    return null;
  }
  try {
    const id = user.id;
    const roleSlug = user.roleSlug;
    const userTypeId = user.userTypeId;
    const staffType = user.staffType;
    const authenticated = user.authenticated;
    return {
      id:
        typeof id === "number" && Number.isSafeInteger(id) && id > 0
          ? id
          : null,
      roleSlug: roleSlug ? redactString(roleSlug, 100) : null,
      userTypeId: typeof userTypeId === "number" ? userTypeId : null,
      staffType: staffType ? redactString(staffType, 100) : null,
      authenticated: Boolean(authenticated),
    };
  } catch {
    // Identity context is optional diagnostics. A hostile/stale state object
    // must not prevent the underlying error from being recorded.
    return null;
  }
};

const getDisplayMode = (): string => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "unknown";
  }
  try {
    if ((navigator as NavigatorWithDiagnostics).standalone) {
      return "standalone";
    }
    const modes = ["fullscreen", "standalone", "minimal-ui", "browser"];
    return modes.find((mode) => window.matchMedia(`(display-mode: ${mode})`).matches) ?? "unknown";
  } catch {
    return "unknown";
  }
};

const getRuntimeContext = (): Record<string, unknown> => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { runtime: "non-browser" };
  }
  const diagnosticNavigator = navigator as NavigatorWithDiagnostics;
  const connection = diagnosticNavigator.connection;
  const orientation = window.screen?.orientation;
  const scriptAssets = Array.from(document.scripts || [])
    .map((script) => script.src)
    .filter((source) => /\/static\/js\/|\.[a-f0-9]{8,}\.js(?:$|\?)/i.test(source))
    .slice(-5)
    .map((source) => redactUrl(source));

  return {
    page: {
      referrer: redactUrl(document.referrer || undefined),
      visibility: document.visibilityState,
      online: navigator.onLine,
    },
    device: {
      platform: diagnosticNavigator.platform || undefined,
      language: diagnosticNavigator.language || undefined,
      languages: diagnosticNavigator.languages?.slice(0, 5),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      screen: window.screen ? `${window.screen.width}x${window.screen.height}` : undefined,
      pixelRatio: window.devicePixelRatio,
      touchPoints: diagnosticNavigator.maxTouchPoints,
      deviceMemoryGb: diagnosticNavigator.deviceMemory,
      connection: connection
        ? {
            effectiveType: connection.effectiveType,
            downlinkMbps: connection.downlink,
            rttMs: connection.rtt,
            saveData: connection.saveData,
          }
        : undefined,
      orientation: orientation
        ? { type: orientation.type, angle: orientation.angle }
        : undefined,
      displayMode: getDisplayMode(),
    },
    build: {
      release: options.release,
      environment: options.environment,
      buildTime: process.env.REACT_APP_BUILD_TIME || undefined,
      sourceMapsExpected:
        process.env.REACT_APP_SOURCE_MAPS_EXPECTED === "true"
          ? true
          : process.env.REACT_APP_SOURCE_MAPS_EXPECTED === "false"
            ? false
            : undefined,
      scriptAssets,
    },
  };
};

const currentPageUrl = (): string | undefined =>
  typeof window === "undefined" ? undefined : redactUrl(window.location.href);

const currentRoute = (): string | undefined =>
  typeof window === "undefined"
    ? undefined
    : redactUrl(window.location.pathname);

const addBreadcrumb = (breadcrumb: ClientErrorBreadcrumb): void => {
  const sanitized = sanitizeForTelemetry({
    ...breadcrumb,
    timestamp: new Date().toISOString(),
  });
  if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) {
    breadcrumbs.push(sanitized as ClientErrorBreadcrumb);
    if (breadcrumbs.length > MAX_BREADCRUMBS) {
      breadcrumbs.splice(0, breadcrumbs.length - MAX_BREADCRUMBS);
    }
  }
};

const sanitizeTags = (
  tags: ClientErrorCapture["tags"],
): ClientErrorEvent["tags"] => {
  if (!tags) {
    return undefined;
  }
  const sanitized = sanitizeForTelemetry(tags, {
    depth: 2,
    maxStringLength: 300,
    maxNodes: 60,
    maxTotalStringLength: 5_000,
  });
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return undefined;
  }
  const result: NonNullable<ClientErrorEvent["tags"]> = {};
  Object.entries(sanitized as Record<string, unknown>)
    .slice(0, 30)
    .forEach(([key, value]) => {
      const sanitizedKey = redactString(key, 80);
      if (typeof value === "string") {
        result[sanitizedKey] = redactString(value, 300);
      } else if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        result[sanitizedKey] = value;
      }
    });
  return result;
};

const sanitizeHttp = (
  http: ClientErrorCapture["http"],
): ClientErrorHttpContext | undefined => {
  if (!http) {
    return undefined;
  }
  return {
    method: http.method ? redactString(http.method.toUpperCase(), 20) : undefined,
    url: redactUrl(http.url),
    status: typeof http.status === "number" ? http.status : undefined,
    durationMs:
      typeof http.durationMs === "number" && Number.isFinite(http.durationMs)
        ? Math.max(0, Math.round(http.durationMs))
        : undefined,
    requestId: http.requestId ? redactCorrelationId(http.requestId, 200) : undefined,
  };
};

const buildEvent = (
  capture: ClientErrorCapture,
  capturedUserIdOverride?: number | null,
): ClientErrorEvent => {
  const userContext = safeUserContext();
  const suppliedContext = sanitizeForTelemetry(capture.context);
  const context = {
    ...getRuntimeContext(),
    ...(suppliedContext !== undefined ? { details: suppliedContext } : {}),
  };
  return {
    eventId: capture.eventId || createId(),
    capturedUserId:
      capturedUserIdOverride !== undefined
        ? capturedUserIdOverride
        : typeof userContext?.id === "number"
          ? userContext.id
          : null,
    type: capture.type,
    level: capture.level || "error",
    message: redactString(capture.message || "Unknown client error", 2_000),
    name: capture.name ? redactString(capture.name, 200) : undefined,
    stack: capture.stack ? redactString(capture.stack, 12_000) : undefined,
    componentStack: capture.componentStack
      ? redactString(capture.componentStack, 8_000)
      : undefined,
    occurredAt: capture.occurredAt || new Date().toISOString(),
    pageUrl: redactUrl(capture.pageUrl) || currentPageUrl(),
    route: capture.route ? redactUrl(capture.route) : currentRoute(),
    release: capture.release || options.release,
    environment: capture.environment || options.environment,
    sessionId: capture.sessionId || getSessionId(),
    requestId: capture.requestId ? redactCorrelationId(capture.requestId, 200) : undefined,
    http: sanitizeHttp(capture.http),
    tags: sanitizeTags(capture.tags),
    context,
    breadcrumbs: breadcrumbs.map((breadcrumb) => ({ ...breadcrumb })),
  };
};

const byteLength = (value: unknown): number => {
  try {
    const json = JSON.stringify(value) || "";
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(json).length;
    }
    return json.length;
  } catch {
    // Treat an unreadable/circular value as oversized so queue bounding drops it
    // before it can permanently block every future flush.
    return Number.MAX_SAFE_INTEGER;
  }
};

const boundQueue = async (store: ClientErrorQueueStore): Promise<void> => {
  const all = await store.getAll();
  const prioritized = all
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const severity = (ERROR_LEVEL_RANK[right.item.event?.level] || 0)
        - (ERROR_LEVEL_RANK[left.item.event?.level] || 0);
      return severity
        || right.item.enqueuedAt - left.item.enqueuedAt
        || right.index - left.index;
    })
    .map(({ item }) => item);
  const keptIds = new Set<string>();
  let keptBytes = 0;
  const maxItems = Math.max(1, options.maxQueueSize);
  const maxBytes = Math.max(1_000, options.maxQueueBytes);
  for (const item of prioritized) {
    const itemBytes = byteLength(item);
    const eventBytes = byteLength(item.event) + 1;
    // A record larger than the transport's maximum batch can never be sent.
    // Drop it here and report it through the bounded overflow marker instead
    // of allowing it to block retries forever.
    if (itemBytes > maxBytes || eventBytes > MAX_BATCH_BYTES) continue;
    if (
      keptIds.size < maxItems
      && keptBytes + itemBytes <= maxBytes
    ) {
      keptIds.add(item.id);
      keptBytes += itemBytes;
    }
  }
  const remove = all.filter((item) => !keptIds.has(item.id)).map((item) => item.id);
  if (remove.length > 0) {
    const removedIds = new Set(remove);
    const removedItems = all.filter((item) => removedIds.has(item.id));
    pendingQueueOverflowDrops += removedItems.length;
    pendingQueueOverflowFatalDrops += removedItems.filter(
      (item) => item.event?.level === "fatal",
    ).length;
    pendingQueueOverflowFirstAt ||= new Date().toISOString();
    await store.remove(remove);
  }
};

const enqueueEvent = (event: ClientErrorEvent): Promise<void> =>
  runQueueOperation(async () => {
    const store = getQueueStore();
    const now = Date.now();
    const fingerprint = fingerprintEvent(event);
    const existing = (await store.getAll()).find(
      (item) =>
        item.fingerprint === fingerprint &&
        item.event.capturedUserId === event.capturedUserId &&
        item.event.release === event.release &&
        !inFlightEventIds.has(item.id) &&
        now - item.enqueuedAt <= options.dedupeWindowMs,
    );
    if (existing) {
      existing.event = mergeCoalescedEvents(existing.event, event);
      existing.nextAttemptAt = Math.min(existing.nextAttemptAt, now);
      await store.put(existing);
    } else {
      await store.put({
        id: event.eventId,
        event,
        fingerprint,
        enqueuedAt: now,
        nextAttemptAt: now,
        attempts: 0,
      });
    }
    await boundQueue(store);
  });

const scheduleFlush = (delayMs = 1_000): void => {
  if (typeof window === "undefined") {
    return;
  }
  const boundedDelay = Math.max(0, delayMs);
  const dueAt = Date.now() + boundedDelay;
  if (flushTimer !== null && flushTimerDueAt !== null) {
    if (flushTimerDueAt <= dueAt) return;
    window.clearTimeout(flushTimer);
  }
  flushTimerDueAt = dueAt;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushTimerDueAt = null;
    void flushErrorMonitoring();
  }, boundedDelay);
};

const enqueueQueueOverflowSummary = async (): Promise<void> => {
  if (pendingQueueOverflowDrops <= 0) return;
  const dropped = pendingQueueOverflowDrops;
  const fatalDropped = pendingQueueOverflowFatalDrops;
  const firstAt = pendingQueueOverflowFirstAt;
  pendingQueueOverflowDrops = 0;
  pendingQueueOverflowFatalDrops = 0;
  pendingQueueOverflowFirstAt = null;
  try {
    await enqueueEvent(buildEvent({
      type: "manual",
      level: "warning",
      name: "MonitoringQueueOverflow",
      message: "Browser monitoring queue reached its storage limit",
      tags: {
        monitoringQueueOverflow: true,
        droppedEvents: dropped,
        droppedFatalEvents: fatalDropped,
      },
      context: {
        firstOverflowAt: firstAt,
        recoveredAt: new Date().toISOString(),
      },
    }));
  } catch {
    pendingQueueOverflowDrops += dropped;
    pendingQueueOverflowFatalDrops += fatalDropped;
    pendingQueueOverflowFirstAt ||= firstAt;
  }
};

const captureClientErrorWithIdentity = (
  capture: ClientErrorCapture,
  capturedUserIdOverride?: number | null,
): string => {
  let eventId: string;
  try {
    eventId = capture.eventId || createId();
  } catch {
    eventId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  let event: ClientErrorEvent;
  try {
    event = buildEvent({ ...capture, eventId }, capturedUserIdOverride);
  } catch {
    // Some browser privacy modes throw while device/page context is inspected.
    // Preserve a minimal diagnostic instead of losing the original failure.
    event = {
      eventId,
      capturedUserId:
        capturedUserIdOverride !== undefined
          ? capturedUserIdOverride
          : safeUserContext()?.id ?? null,
      type: capture.type || "manual",
      level: capture.level || "error",
      message:
        typeof capture.message === "string"
          ? redactString(capture.message, 2_000)
          : "Unknown client error",
      name: typeof capture.name === "string" ? redactString(capture.name, 200) : undefined,
      stack: typeof capture.stack === "string" ? redactString(capture.stack, 12_000) : undefined,
      occurredAt: capture.occurredAt || new Date().toISOString(),
      release: options.release,
      environment: options.environment,
      sessionId: getSessionId(),
      tags: { contextCollectionFailed: true },
    };
  }
  void enqueueEvent(event)
    .then(() => scheduleFlush())
    .catch(() => undefined);
  return eventId;
};

export const captureClientError = (capture: ClientErrorCapture): string =>
  captureClientErrorWithIdentity(capture);

export const captureException = (
  error: unknown,
  context?: Record<string, unknown>,
): string => {
  const normalized = normalizeError(error);
  return captureClientError({
    type: "exception",
    level: "error",
    name: normalized.name,
    message: normalized.message,
    stack: normalized.stack,
    context: {
      ...(context || {}),
      ...(normalized.context !== undefined ? { thrownValue: normalized.context } : {}),
    },
  });
};

export const captureReactError = (
  error: unknown,
  componentStack?: string | null,
  context?: Record<string, unknown>,
): string => {
  const normalized = normalizeError(error);
  return captureClientError({
    type: "react_error",
    level: "fatal",
    name: normalized.name,
    message: normalized.message,
    stack: normalized.stack,
    componentStack: componentStack || undefined,
    context,
  });
};

const endpointUrl = (): URL | null => {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://local.invalid";
    return new URL(options.endpoint, base);
  } catch {
    return null;
  }
};

const isTelemetryUrl = (url: string | undefined): boolean => {
  if (!url) {
    return false;
  }
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://local.invalid";
    const candidate = new URL(url, base);
    const endpoint = endpointUrl();
    return Boolean(
      endpoint &&
        candidate.origin === endpoint.origin &&
        candidate.pathname.replace(/\/+$/, "") === endpoint.pathname.replace(/\/+$/, ""),
    );
  } catch {
    return url.includes("/client-errors/batch");
  }
};

const isHealthProbe = (url: string | undefined): boolean => {
  if (!url) {
    return false;
  }
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://local.invalid";
    return /\/(?:health|healthcheck|ready|readiness|live|liveness)\/?$/i.test(
      new URL(url, base).pathname,
    );
  } catch {
    return false;
  }
};

const isExpectedUnauthenticatedSessionCheck = (failure: ApiFailureCapture): boolean => {
  if (
    failure.status !== 401 ||
    failure.method?.trim().toUpperCase() !== "GET" ||
    !failure.url
  ) {
    return false;
  }
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://local.invalid";
    const pathname = new URL(failure.url, base).pathname.replace(/\/+$/, "");
    return pathname === "/api/session";
  } catch {
    return false;
  }
};

const shouldIgnoreApiFailure = (failure: ApiFailureCapture): boolean => {
  if (
    failure.isCanceled ||
    isTelemetryUrl(failure.url) ||
    isHealthProbe(failure.url) ||
    isExpectedUnauthenticatedSessionCheck(failure)
  ) {
    return true;
  }
  if (failure.status === 308 || failure.expectedStatuses?.includes(failure.status ?? -1)) {
    return true;
  }
  return typeof failure.status === "number" && failure.status < 400;
};

export const captureApiFailure = (failure: ApiFailureCapture): string | null => {
  if (shouldIgnoreApiFailure(failure)) {
    return null;
  }
  const normalized = failure.stack
    ? {
        name: failure.name || "ApiError",
        message: failure.message || failure.statusText || "API request failed",
        stack: failure.stack,
      }
    : normalizeError(failure.message || failure.statusText || "API request failed");
  addBreadcrumb({
    category: "http",
    level: "error",
    method: failure.method?.toUpperCase(),
    url: redactUrl(failure.url),
    status: failure.status,
    durationMs: failure.durationMs,
  });
  return captureClientError({
    type: "api_error",
    level: typeof failure.status === "number" && failure.status < 500 ? "warning" : "error",
    name: failure.name || normalized.name || "ApiError",
    message:
      failure.message ||
      failure.statusText ||
      (failure.status ? `API request failed with status ${failure.status}` : "API request failed"),
    stack: failure.stack || normalized.stack,
    requestId: failure.requestId,
    http: {
      method: failure.method,
      url: failure.url,
      status: failure.status,
      durationMs: failure.durationMs,
      requestId: failure.requestId,
    },
    tags: {
      ...(failure.tags || {}),
      ...(failure.code ? { errorCode: failure.code } : {}),
      networkError: typeof failure.status !== "number",
    },
    context:
      failure.responseSummary === undefined
        ? undefined
        : { responseSummary: sanitizeForTelemetry(failure.responseSummary) },
  });
};

type AxiosHeadersLike = Record<string, unknown> & {
  get?: (name: string) => unknown;
};

type AxiosLikeError = {
  name?: string;
  message?: string;
  stack?: string;
  code?: string;
  config?: {
    method?: string;
    url?: string;
    baseURL?: string;
    signal?: { aborted?: boolean };
    skipErrorMonitoring?: boolean;
    expectedStatuses?: number[];
    [AXIOS_START_KEY]?: number;
  };
  response?: {
    status?: number;
    statusText?: string;
    data?: unknown;
    headers?: AxiosHeadersLike;
  };
};

const resolveRequestId = (candidate: AxiosHeadersLike | undefined): string | undefined => {
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  const get = (candidate as { get?: (name: string) => unknown }).get;
  const value =
    (typeof get === "function" ? get.call(candidate, "x-request-id") : undefined) ??
    (candidate as Record<string, unknown>)["x-request-id"] ??
    (candidate as Record<string, unknown>)["x-correlation-id"];
  return typeof value === "string" ? value : undefined;
};

export const markAxiosRequestForErrorMonitoring = <T extends object>(config: T): T => {
  try {
    (config as unknown as Record<string, unknown>)[AXIOS_START_KEY] = Date.now();
  } catch {
    // Frozen request configs still work; only duration telemetry is omitted.
  }
  return config;
};

const joinRequestUrl = (baseUrl?: string, url?: string): string | undefined => {
  if (!url) {
    return baseUrl;
  }
  try {
    return new URL(url, baseUrl || (typeof window !== "undefined" ? window.location.origin : undefined)).href;
  } catch {
    return baseUrl ? `${baseUrl.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}` : url;
  }
};

const summarizeAxiosResponse = (data: unknown): unknown => {
  try {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return undefined;
    }
    const ownValue = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(data, key);
      return descriptor && "value" in descriptor ? descriptor.value : undefined;
    };
    const machineValue = (value: unknown): string | number | boolean | undefined => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "boolean") return value;
      if (typeof value === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(value)) {
        return value;
      }
      return undefined;
    };
    const summary = {
      code: machineValue(ownValue("code") ?? ownValue("errorCode")),
      status: machineValue(ownValue("status")),
      type: machineValue(ownValue("type")),
    };
    return Object.values(summary).some((value) => value !== undefined) ? summary : undefined;
  } catch {
    return undefined;
  }
};

export const captureAxiosError = (error: unknown): string | null => {
  const candidate = (error && typeof error === "object" ? error : {}) as AxiosLikeError;
  const config = candidate.config;
  if (config?.skipErrorMonitoring) {
    return null;
  }
  const canceled =
    config?.signal?.aborted === true ||
    candidate.code === "ERR_CANCELED" ||
    candidate.name === "CanceledError" ||
    candidate.name === "AbortError" ||
    candidate.message?.toLowerCase() === "canceled";
  const startedAt = config?.[AXIOS_START_KEY];
  return captureApiFailure({
    method: config?.method,
    url: joinRequestUrl(config?.baseURL, config?.url),
    status: candidate.response?.status,
    statusText: candidate.response?.statusText,
    durationMs: typeof startedAt === "number" ? Date.now() - startedAt : undefined,
    requestId: resolveRequestId(candidate.response?.headers),
    code: candidate.code,
    message: candidate.message,
    name: candidate.name,
    stack: candidate.stack,
    isCanceled: canceled,
    expectedStatuses: config?.expectedStatuses,
    responseSummary: summarizeAxiosResponse(candidate.response?.data),
  });
};

const selectBatch = (items: QueuedClientError[]): QueuedClientError[] => {
  const selected: QueuedClientError[] = [];
  let size = byteLength({ events: [] });
  for (const item of items) {
    const eventSize = byteLength(item.event) + 1;
    if (eventSize > MAX_BATCH_BYTES) {
      continue;
    }
    if (selected.length > 0 && size + eventSize > MAX_BATCH_BYTES) {
      break;
    }
    selected.push(item);
    size += eventSize;
    if (selected.length >= MAX_BATCH_EVENTS) {
      break;
    }
  }
  return selected;
};

const retryDelay = (attempts: number): number => {
  const exponential = Math.min(5 * 60_000, 2_000 * 2 ** Math.min(attempts, 8));
  return exponential + Math.floor(Math.random() * Math.min(5_000, exponential / 4));
};

const getTransport = (): typeof fetch | null => {
  if (options.fetchImpl) {
    return options.fetchImpl;
  }
  if (transportFetch) {
    return transportFetch;
  }
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return window.fetch.bind(window);
  }
  return null;
};

const getAuthHeader = (): Record<string, string> => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const token = window.localStorage.getItem("authToken");
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

const sendWithTimeout = async (
  transport: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> => {
  const timeoutMs = Math.max(1_000, options.transportTimeoutMs);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      try {
        controller?.abort();
      } catch {
        // A custom AbortController must not interfere with queue retry.
      }
      const error = new Error(`Error monitoring delivery timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      transport(url, { ...init, ...(controller ? { signal: controller.signal } : {}) }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
};

const executeFlush = async (): Promise<boolean> => {
  if (sending || internalActivity > 0) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }
  const transport = getTransport();
  if (!transport) {
    return false;
  }

  sending = true;
  try {
    const now = Date.now();
    const selection = await runQueueOperation(async () => {
      const store = getQueueStore();
      await boundQueue(store);
      const available = (await store.getAll())
        .filter((item) => !inFlightEventIds.has(item.id));
      const batch = selectBatch(
        available
          .filter((item) => item.nextAttemptAt <= now)
          .sort((left, right) => left.enqueuedAt - right.enqueuedAt),
      );
      const nextAttemptAt = available.reduce<number | null>(
        (earliest, item) => earliest === null || item.nextAttemptAt < earliest
          ? item.nextAttemptAt
          : earliest,
        null,
      );
      return { batch, nextAttemptAt };
    });
    const { batch } = selection;
    if (batch.length === 0) {
      if (selection.nextAttemptAt !== null) {
        scheduleFlush(Math.max(0, selection.nextAttemptAt - Date.now()));
      }
      return true;
    }
    batch.forEach((item) => inFlightEventIds.add(item.id));
    const body = JSON.stringify({ events: batch.map((item) => item.event) });
    let success = false;
    try {
      internalActivity += 1;
      const response = await sendWithTimeout(transport, options.endpoint, {
        method: "POST",
        credentials: "include",
        keepalive: byteLength(body) <= MAX_BATCH_BYTES,
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        body,
      });
      success = response.status >= 200 && response.status < 300;
    } catch {
      success = false;
    } finally {
      internalActivity -= 1;
    }

    const nextRetryAt = await runQueueOperation(async () => {
      const store = getQueueStore();
      if (success) {
        await store.remove(batch.map((item) => item.id));
        return null;
      }
      const failureTime = Date.now();
      const updates = batch.map((item) => {
        const attempts = item.attempts + 1;
        return {
          ...item,
          attempts,
          nextAttemptAt: failureTime + retryDelay(attempts),
        };
      });
      await Promise.all(updates.map((item) => store.put(item)));
      return Math.min(...updates.map((item) => item.nextAttemptAt));
    });
    if (success) {
      // The queue now has room. Emit one aggregate marker instead of recursively
      // enqueueing a warning while it is already overflowing.
      await enqueueQueueOverflowSummary();
    }
    if (!success) {
      scheduleFlush(Math.max(0, (nextRetryAt ?? Date.now()) - Date.now()));
    } else {
      scheduleFlush(100);
    }
    return success;
  } finally {
    inFlightEventIds.clear();
    sending = false;
  }
};

export const flushErrorMonitoring = (): Promise<boolean> => {
  if (activeFlushPromise) {
    // All concurrent callers share the same delivery. Captures made while this
    // request is active schedule the next bounded flush themselves, avoiding an
    // unbounded chain of follow-up callbacks during an outage.
    return activeFlushPromise;
  }
  activeFlushPromise = executeFlush()
    .catch(() => false)
    .finally(() => {
      activeFlushPromise = null;
    });
  return activeFlushPromise;
};

const extractResourceUrl = (target: EventTarget | null): string | undefined => {
  if (!target || typeof target !== "object") {
    return undefined;
  }
  const candidate = target as { src?: unknown; href?: unknown; currentSrc?: unknown };
  const value = candidate.currentSrc || candidate.src || candidate.href;
  return typeof value === "string" ? value : undefined;
};

const installGlobalErrorHandlers = (): (() => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const onError = (event: Event): void => {
    if (internalActivity > 0) {
      return;
    }
    const errorEvent = event as ErrorEvent;
    const resourceUrl = extractResourceUrl(event.target);
    if (event.target !== window && resourceUrl) {
      if (isTelemetryUrl(resourceUrl)) {
        return;
      }
      const element = describeElement(event.target);
      captureClientError({
        type: "resource_error",
        level: "error",
        name: "ResourceLoadError",
        message: `Failed to load ${String(element.tag || "resource")}`,
        context: { element, resourceUrl: redactUrl(resourceUrl) },
      });
      return;
    }
    const normalized = normalizeError(errorEvent.error || errorEvent.message || "Script error");
    captureClientError({
      type: "exception",
      level: "error",
      name: normalized.name,
      message: normalized.message,
      stack: normalized.stack,
      context: {
        source: redactUrl(errorEvent.filename),
        line: errorEvent.lineno || undefined,
        column: errorEvent.colno || undefined,
      },
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    if (internalActivity > 0) {
      return;
    }
    const normalized = normalizeError(event.reason);
    captureClientError({
      type: "unhandled_rejection",
      level: "error",
      name: normalized.name,
      message: normalized.message,
      stack: normalized.stack,
      context:
        normalized.context === undefined ? undefined : { reason: normalized.context },
    });
  };
  const onSecurityPolicyViolation = (event: SecurityPolicyViolationEvent): void => {
    captureClientError({
      type: "csp_violation",
      level: event.disposition === "enforce" ? "error" : "warning",
      name: "SecurityPolicyViolation",
      message: `Content Security Policy blocked ${event.violatedDirective || "a resource"}`,
      context: {
        blockedUri: redactUrl(event.blockedURI),
        documentUri: redactUrl(event.documentURI),
        effectiveDirective: event.effectiveDirective,
        violatedDirective: event.violatedDirective,
        disposition: event.disposition,
        sourceFile: redactUrl(event.sourceFile),
        line: event.lineNumber,
        column: event.columnNumber,
      },
    });
  };
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  window.addEventListener("securitypolicyviolation", onSecurityPolicyViolation);
  return () => {
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    window.removeEventListener("securitypolicyviolation", onSecurityPolicyViolation);
  };
};

type BrowserReportBody = {
  toJSON?: () => unknown;
  message?: unknown;
  id?: unknown;
  sourceFile?: unknown;
  lineNumber?: unknown;
  columnNumber?: unknown;
};

type BrowserReport = {
  type?: string;
  url?: string;
  body?: BrowserReportBody | null;
};

type ReportingObserverLike = {
  observe(): void;
  disconnect(): void;
};

type ReportingObserverConstructor = {
  new (
    callback: (reports: BrowserReport[]) => void,
    options?: { buffered?: boolean; types?: string[] },
  ): ReportingObserverLike;
  supportedTypes?: string[];
};

const installReportingObserver = (): (() => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const Constructor = (window as unknown as {
    ReportingObserver?: ReportingObserverConstructor;
  }).ReportingObserver;
  if (!Constructor) {
    return () => undefined;
  }

  const supported = Constructor.supportedTypes || [];
  const requested = ["crash", "deprecation", "intervention"].filter(
    (type) => supported.length === 0 || supported.includes(type),
  );
  if (supported.length > 0 && requested.length === 0) {
    return () => undefined;
  }

  let observer: ReportingObserverLike | null = null;
  try {
    observer = new Constructor(
      (reports) => {
        reports.slice(0, 20).forEach((report) => {
          if (isTelemetryUrl(report.url)) {
            return;
          }
          const rawBody = report.body?.toJSON?.() || report.body || {};
          const body = sanitizeForTelemetry(rawBody, { depth: 4, maxStringLength: 1_000 });
          const bodyRecord =
            body && typeof body === "object" && !Array.isArray(body)
              ? (body as Record<string, unknown>)
              : {};
          captureClientError({
            type: "manual",
            level: report.type === "crash" ? "error" : "warning",
            name: `Browser${report.type ? ` ${report.type}` : ""}Report`,
            message:
              typeof bodyRecord.message === "string"
                ? bodyRecord.message
                : `Browser reported ${report.type || "a runtime problem"}`,
            context: {
              reportType: report.type,
              reportUrl: redactUrl(report.url),
              body: {
                ...bodyRecord,
                ...(typeof bodyRecord.sourceFile === "string"
                  ? { sourceFile: redactUrl(bodyRecord.sourceFile) }
                  : {}),
              },
            },
          });
        });
      },
      { buffered: true, ...(requested.length > 0 ? { types: requested } : {}) },
    );
    observer.observe();
  } catch {
    observer = null;
  }
  return () => observer?.disconnect();
};

const installBreadcrumbHandlers = (): (() => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const onClick = (event: MouseEvent): void => {
    addBreadcrumb({ category: "ui.click", target: describeElement(event.target) });
  };
  const onSubmit = (event: SubmitEvent): void => {
    addBreadcrumb({ category: "ui.submit", target: describeElement(event.target) });
  };
  const onNavigation = (): void => {
    addBreadcrumb({ category: "navigation", route: currentRoute(), url: currentPageUrl() });
  };
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;
  const wrappedPushState: History["pushState"] = function (
    this: History,
    ...args: Parameters<History["pushState"]>
  ) {
    originalPushState.apply(this, args);
    onNavigation();
  };
  const wrappedReplaceState: History["replaceState"] = function (
    this: History,
    ...args: Parameters<History["replaceState"]>
  ) {
    originalReplaceState.apply(this, args);
    onNavigation();
  };
  window.history.pushState = wrappedPushState;
  window.history.replaceState = wrappedReplaceState;
  window.addEventListener("click", onClick, { capture: true, passive: true });
  window.addEventListener("submit", onSubmit, true);
  window.addEventListener("popstate", onNavigation);
  return () => {
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("submit", onSubmit, true);
    window.removeEventListener("popstate", onNavigation);
    if (window.history.pushState === wrappedPushState) {
      window.history.pushState = originalPushState;
    }
    if (window.history.replaceState === wrappedReplaceState) {
      window.history.replaceState = originalReplaceState;
    }
  };
};

const consoleMessage = (args: unknown[]): ReturnType<typeof normalizeError> => {
  try {
    const error = args.find((value) => {
      try {
        return value instanceof Error;
      } catch {
        return false;
      }
    });
    if (error) {
      return normalizeError(error);
    }
    const safeArgs = sanitizeForTelemetry(args, {
      depth: 3,
      maxStringLength: 500,
      maxNodes: 80,
      maxTotalStringLength: 4_000,
    });
    let message = "console.error";
    try {
      message = JSON.stringify(safeArgs) || message;
    } catch {
      // Retain the safe generic message.
    }
    return { name: "ConsoleError", message: redactString(message, 2_000) };
  } catch {
    return { name: "ConsoleError", message: "console.error (arguments unreadable)" };
  }
};

const installConsoleCapture = (): (() => void) => {
  if (!options.captureConsole || typeof console === "undefined") {
    return () => undefined;
  }
  const original = console.error;
  if (typeof original !== "function") {
    return () => undefined;
  }
  const wrapped: typeof console.error = (...args: unknown[]) => {
    try {
      original.apply(console, args);
    } catch {
      // A host console implementation should never be allowed to crash the app.
    }
    if (internalActivity > 0) {
      return;
    }
    try {
      const normalized = consoleMessage(args);
      captureClientError({
        type: "console_error",
        level: "error",
        name: normalized.name,
        message: normalized.message,
        stack: normalized.stack,
        context: { argumentCount: Math.min(args.length, 1_000) },
      });
    } catch {
      // Monitoring must be observational and never make console.error unsafe.
    }
  };
  console.error = wrapped;
  return () => {
    if (console.error === wrapped) {
      console.error = original;
    }
  };
};

const requestDetails = (
  input: RequestInfo | URL,
  init?: RequestInit,
): { url: string; method: string; aborted: boolean } => {
  const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
  return {
    url: request?.url || String(input),
    method: (init?.method || request?.method || "GET").toUpperCase(),
    aborted: Boolean(init?.signal?.aborted || request?.signal?.aborted),
  };
};

const installFetchCapture = (): (() => void) => {
  if (!options.captureFetch || typeof window === "undefined" || typeof window.fetch !== "function") {
    return () => undefined;
  }
  const original = window.fetch;
  const boundOriginal = original.bind(window);
  transportFetch = options.fetchImpl || boundOriginal;
  const wrapped: typeof window.fetch = async (input, init) => {
    const request = requestDetails(input, init);
    if (
      internalActivity > 0 ||
      isTelemetryUrl(request.url)
    ) {
      return boundOriginal(input, init);
    }
    const startedAt = Date.now();
    try {
      const response = await boundOriginal(input, init);
      const durationMs = Date.now() - startedAt;
      addBreadcrumb({
        category: "http",
        method: request.method,
        url: redactUrl(request.url),
        status: response.status,
        durationMs,
      });
      if (!response.ok && response.status !== 308 && !isHealthProbe(request.url)) {
        captureApiFailure({
          method: request.method,
          url: request.url,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          requestId:
            response.headers.get("x-request-id") ||
            response.headers.get("x-correlation-id") ||
            undefined,
        });
      }
      return response;
    } catch (error) {
      const normalized = normalizeError(error);
      const canceled =
        request.aborted ||
        normalized.name === "AbortError" ||
        (error as { code?: unknown } | null)?.code === "ERR_CANCELED";
      captureApiFailure({
        method: request.method,
        url: request.url,
        durationMs: Date.now() - startedAt,
        name: normalized.name,
        message: normalized.message,
        stack: normalized.stack,
        isCanceled: canceled,
      });
      throw error;
    }
  };
  window.fetch = wrapped;
  return () => {
    if (window.fetch === wrapped) {
      window.fetch = original;
    }
  };
};

type RawXhrState = {
  method: string;
  url: string;
  startedAt: number;
  reported: boolean;
};

const installXmlHttpRequestCapture = (): (() => void) => {
  if (
    !options.captureNetworkTransports
    || typeof window === "undefined"
    || typeof window.XMLHttpRequest !== "function"
  ) {
    return () => undefined;
  }
  const prototype = window.XMLHttpRequest.prototype;
  const originalOpen = prototype.open;
  const originalSend = prototype.send;
  if (typeof originalOpen !== "function" || typeof originalSend !== "function") {
    return () => undefined;
  }
  const states = new WeakMap<XMLHttpRequest, RawXhrState>();
  const instrumented = new WeakSet<XMLHttpRequest>();

  const report = (
    xhr: XMLHttpRequest,
    kind: "abort" | "error" | "loadend" | "timeout",
  ): void => {
    try {
      const state = states.get(xhr);
      if (!state || state.reported || isTelemetryUrl(state.url) || isHealthProbe(state.url)) return;
      let status = 0;
      try {
        status = Number(xhr.status) || 0;
      } catch {
        status = 0;
      }
      if (kind === "loadend" && status > 0 && status < 400) return;
      if (status === 308) return;
      state.reported = true;
      const durationMs = Math.max(0, Date.now() - state.startedAt);
      if (kind === "abort") {
        captureClientError({
          type: "api_error",
          level: "warning",
          name: "XMLHttpRequestAbort",
          message: "XMLHttpRequest was aborted",
          http: { method: state.method, url: state.url, durationMs },
          tags: { transport: "xmlhttprequest", aborted: true },
        });
        return;
      }
      captureApiFailure({
        method: state.method,
        url: state.url,
        status: status > 0 ? status : undefined,
        durationMs,
        name:
          kind === "timeout"
            ? "XMLHttpRequestTimeout"
            : kind === "error"
              ? "XMLHttpRequestNetworkError"
              : "XMLHttpRequestError",
        message:
          kind === "timeout"
            ? "XMLHttpRequest timed out"
            : status > 0
              ? `XMLHttpRequest failed with status ${status}`
              : "XMLHttpRequest failed",
        tags: { transport: "xmlhttprequest" },
      });
    } catch {
      // Instrumentation must not alter XMLHttpRequest event delivery.
    }
  };

  const wrappedOpen = function (this: XMLHttpRequest, ...args: unknown[]): void {
    Reflect.apply(originalOpen, this, args);
    try {
      states.set(this, {
        method: typeof args[0] === "string" ? args[0].toUpperCase().slice(0, 20) : "GET",
        url: typeof args[1] === "string" ? args[1] : String(args[1] ?? ""),
        startedAt: 0,
        reported: false,
      });
    } catch {
      // Preserve native XHR behavior even for an unusual URL object.
    }
  } as XMLHttpRequest["open"];

  const wrappedSend = function (this: XMLHttpRequest, ...args: unknown[]): void {
    const state = states.get(this);
    if (state) {
      state.startedAt = Date.now();
      state.reported = false;
    }
    if (!instrumented.has(this)) {
      try {
        this.addEventListener("abort", () => report(this, "abort"));
        this.addEventListener("error", () => report(this, "error"));
        this.addEventListener("timeout", () => report(this, "timeout"));
        this.addEventListener("loadend", () => report(this, "loadend"));
        instrumented.add(this);
      } catch {
        // Native send still runs below.
      }
    }
    Reflect.apply(originalSend, this, args);
  } as XMLHttpRequest["send"];

  try {
    prototype.open = wrappedOpen;
    try {
      prototype.send = wrappedSend;
    } catch (error) {
      prototype.open = originalOpen;
      throw error;
    }
  } catch {
    return () => undefined;
  }
  return () => {
    if (prototype.open === wrappedOpen) prototype.open = originalOpen;
    if (prototype.send === wrappedSend) prototype.send = originalSend;
  };
};

const networkUrl = (value: unknown): string => {
  try {
    return typeof value === "string" ? value : String(value ?? "");
  } catch {
    return "";
  }
};

const inheritNativeConstructor = (
  wrapper: Function,
  original: Function,
  prototype: object,
): void => {
  Object.setPrototypeOf(wrapper, original);
  Object.defineProperty(wrapper, "prototype", { value: prototype, writable: false });
};

const installWebSocketCapture = (): (() => void) => {
  if (
    !options.captureNetworkTransports
    || typeof window === "undefined"
    || typeof window.WebSocket !== "function"
  ) {
    return () => undefined;
  }
  const OriginalWebSocket = window.WebSocket;
  const WrappedWebSocket = function (
    this: WebSocket,
    url: string | URL,
    protocols?: string | string[],
  ): WebSocket {
    const constructorArguments = protocols === undefined ? [url] : [url, protocols];
    if (!new.target) {
      return Reflect.apply(OriginalWebSocket, this, constructorArguments) as WebSocket;
    }
    const socket = Reflect.construct(
      OriginalWebSocket,
      constructorArguments,
      new.target,
    ) as WebSocket;
    const requestUrl = networkUrl(url);
    let reported = false;
    try {
      socket.addEventListener("error", () => {
        if (reported || isTelemetryUrl(requestUrl)) return;
        reported = true;
        captureClientError({
          type: "api_error",
          level: "error",
          name: "WebSocketConnectionError",
          message: "WebSocket connection failed",
          http: { method: "WS", url: requestUrl },
          tags: { transport: "websocket" },
        });
      });
      socket.addEventListener("close", (event) => {
        if (reported || event.code === 1000 || event.code === 1001 || isTelemetryUrl(requestUrl)) {
          return;
        }
        reported = true;
        captureClientError({
          type: "api_error",
          level: "warning",
          name: "WebSocketAbnormalClose",
          message: "WebSocket closed abnormally",
          http: { method: "WS", url: requestUrl },
          tags: { transport: "websocket", closeCode: event.code },
        });
      });
    } catch {
      // The constructed native socket is still returned unchanged.
    }
    return socket;
  } as unknown as typeof WebSocket;
  try {
    inheritNativeConstructor(WrappedWebSocket, OriginalWebSocket, OriginalWebSocket.prototype);
    window.WebSocket = WrappedWebSocket;
  } catch {
    return () => undefined;
  }
  return () => {
    if (window.WebSocket === WrappedWebSocket) window.WebSocket = OriginalWebSocket;
  };
};

const installEventSourceCapture = (): (() => void) => {
  if (
    !options.captureNetworkTransports
    || typeof window === "undefined"
    || typeof window.EventSource !== "function"
  ) {
    return () => undefined;
  }
  const OriginalEventSource = window.EventSource;
  const WrappedEventSource = function (
    this: EventSource,
    url: string | URL,
    eventSourceInitDict?: EventSourceInit,
  ): EventSource {
    const constructorArguments = eventSourceInitDict === undefined
      ? [url]
      : [url, eventSourceInitDict];
    if (!new.target) {
      return Reflect.apply(OriginalEventSource, this, constructorArguments) as EventSource;
    }
    const source = Reflect.construct(
      OriginalEventSource,
      constructorArguments,
      new.target,
    ) as EventSource;
    const requestUrl = networkUrl(url);
    let reportedSinceOpen = false;
    try {
      source.addEventListener("open", () => {
        reportedSinceOpen = false;
      });
      source.addEventListener("error", () => {
        if (reportedSinceOpen || isTelemetryUrl(requestUrl)) return;
        reportedSinceOpen = true;
        captureClientError({
          type: "api_error",
          level: "warning",
          name: "EventSourceConnectionError",
          message: "EventSource connection failed",
          http: { method: "SSE", url: requestUrl },
          tags: { transport: "eventsource" },
        });
      });
    } catch {
      // The constructed native source is still returned unchanged.
    }
    return source;
  } as unknown as typeof EventSource;
  try {
    inheritNativeConstructor(WrappedEventSource, OriginalEventSource, OriginalEventSource.prototype);
    window.EventSource = WrappedEventSource;
  } catch {
    return () => undefined;
  }
  return () => {
    if (window.EventSource === WrappedEventSource) window.EventSource = OriginalEventSource;
  };
};

const installDefaultAxiosCapture = (): (() => void) => {
  type InterceptorManager = {
    use: (
      fulfilled: (value: unknown) => unknown,
      rejected: (error: unknown) => Promise<never>,
    ) => unknown;
    eject: (id: unknown) => void;
  };
  const client = options.defaultAxiosClient as {
    interceptors?: { request?: InterceptorManager; response?: InterceptorManager };
  } | undefined;
  const request = client?.interceptors?.request;
  const response = client?.interceptors?.response;
  if (!request || !response || typeof request.use !== "function" || typeof response.use !== "function") {
    return () => undefined;
  }
  const requestInterceptor = request.use(
    (config) =>
      config && typeof config === "object"
        ? markAxiosRequestForErrorMonitoring(config)
        : config,
    (error) => {
      captureAxiosError(error);
      return Promise.reject(error);
    },
  );
  const responseInterceptor = response.use(
    (response) => response,
    (error) => {
      captureAxiosError(error);
      return Promise.reject(error);
    },
  );
  return () => {
    request.eject(requestInterceptor);
    response.eject(responseInterceptor);
  };
};

const installLifecycleHandlers = (): (() => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const onOnline = (): void => scheduleFlush(0);
  const onVisible = (): void => {
    if (document.visibilityState === "visible") {
      scheduleFlush(0);
    }
  };
  const onPageHide = (): void => {
    void flushErrorMonitoring();
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisible);
  };
};

const installBootstrapWatchdog = (): (() => void) => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }
  let fired = false;
  let disposed = false;
  let timer: number | null = null;
  const scheduleCheck = (delayMs: number): void => {
    if (disposed || fired || timer !== null) return;
    timer = window.setTimeout(check, delayMs);
  };
  const check = (): void => {
    timer = null;
    if (disposed || fired) return;
    const root = document.getElementById("root");
    if (root && (root.firstElementChild || (root.textContent || "").trim())) {
      // Once React has mounted, a later empty state is an application concern,
      // not a bootstrap failure.
      disposed = true;
      return;
    }
    if (
      document.visibilityState !== "visible" ||
      (typeof navigator !== "undefined" && navigator.onLine === false) ||
      document.readyState !== "complete" ||
      !root
    ) {
      scheduleCheck(5_000);
      return;
    }
    fired = true;
    captureClientError({
      type: "exception",
      level: "fatal",
      name: "AppBootstrapTimeout",
      message: "The application root remained empty after startup",
      context: { earlyBoot: true, bootstrapWatchdog: true },
    });
  };
  const onRetrySignal = (): void => scheduleCheck(0);
  window.addEventListener("online", onRetrySignal);
  window.addEventListener("load", onRetrySignal);
  document.addEventListener("visibilitychange", onRetrySignal);
  scheduleCheck(20_000);
  return () => {
    disposed = true;
    if (timer !== null) window.clearTimeout(timer);
    window.removeEventListener("online", onRetrySignal);
    window.removeEventListener("load", onRetrySignal);
    document.removeEventListener("visibilitychange", onRetrySignal);
  };
};

type EarlyErrorBuffer = {
  events?: unknown[];
  dispose?: () => void;
};

const drainEarlyErrorBuffer = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  const host = window as unknown as {
    __OMNILODGE_EARLY_ERROR_BUFFER__?: EarlyErrorBuffer;
  };
  const buffer = host.__OMNILODGE_EARLY_ERROR_BUFFER__;
  if (!buffer) {
    return;
  }
  try {
    buffer.dispose?.();
  } catch {
    // The normal global listeners are already installed.
  }
  try {
    delete host.__OMNILODGE_EARLY_ERROR_BUFFER__;
  } catch {
    host.__OMNILODGE_EARLY_ERROR_BUFFER__ = undefined;
  }

  const supportedTypes = new Set([
    "exception",
    "unhandled_rejection",
    "resource_error",
  ]);
  (Array.isArray(buffer.events) ? buffer.events : []).slice(-20).forEach((rawEvent) => {
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
      return;
    }
    const event = rawEvent as Record<string, unknown>;
    const type = typeof event.type === "string" && supportedTypes.has(event.type)
      ? event.type as ClientErrorCapture["type"]
      : "manual";
    const hasCapturedIdentity = Object.prototype.hasOwnProperty.call(event, "capturedUserId");
    const capturedIdentity =
      typeof event.capturedUserId === "number"
      && Number.isSafeInteger(event.capturedUserId)
      && event.capturedUserId > 0
        ? event.capturedUserId
        : null;
    captureClientErrorWithIdentity({
      eventId: typeof event.eventId === "string" ? event.eventId : undefined,
      type,
      level: event.level === "warning" || event.level === "fatal" ? event.level : "error",
      name: typeof event.name === "string" ? event.name : "EarlyBootError",
      message:
        typeof event.message === "string" ? event.message : "Application startup failed",
      stack: typeof event.stack === "string" ? event.stack : undefined,
      occurredAt: typeof event.occurredAt === "string" ? event.occurredAt : undefined,
      context: {
        earlyBoot: true,
        bufferedBeforeMonitoringInitialization: true,
        details: event.context,
      },
    }, hasCapturedIdentity ? capturedIdentity : undefined);
  });
};

export const setErrorMonitoringUser = (
  user: ErrorMonitoringUserContext | null,
): void => {
  fallbackUserContext = user;
};

export const initializeErrorMonitoring = (
  suppliedOptions: ErrorMonitoringOptions = {},
): (() => void) => {
  installedCleanup?.();
  options = {
    ...options,
    ...suppliedOptions,
    endpoint: suppliedOptions.endpoint || options.endpoint || DEFAULT_ENDPOINT,
    release: suppliedOptions.release || options.release || resolveRelease(),
  };
  if (suppliedOptions.queueStore) {
    queueStore = suppliedOptions.queueStore;
  }
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    transportFetch = suppliedOptions.fetchImpl || window.fetch.bind(window);
  }

  const safeInstall = (installer: () => () => void): (() => void) => {
    try {
      return installer();
    } catch {
      return () => undefined;
    }
  };
  const cleanupHandlers = [
    safeInstall(installGlobalErrorHandlers),
    safeInstall(installReportingObserver),
    safeInstall(installBreadcrumbHandlers),
    safeInstall(installConsoleCapture),
    safeInstall(installFetchCapture),
    safeInstall(installXmlHttpRequestCapture),
    safeInstall(installWebSocketCapture),
    safeInstall(installEventSourceCapture),
    safeInstall(installDefaultAxiosCapture),
    safeInstall(installLifecycleHandlers),
    safeInstall(installBootstrapWatchdog),
  ];
  drainEarlyErrorBuffer();
  if (typeof window !== "undefined") {
    periodicTimer = window.setInterval(
      () => void flushErrorMonitoring(),
      Math.max(5_000, options.flushIntervalMs),
    );
  }
  addBreadcrumb({ category: "monitoring", action: "initialized", route: currentRoute() });
  scheduleFlush(0);

  const cleanup = (): void => {
    cleanupHandlers.reverse().forEach((handler) => {
      try {
        handler();
      } catch {
        // One browser hook must not prevent the others from being restored.
      }
    });
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
      flushTimerDueAt = null;
    }
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
    if (installedCleanup === cleanup) {
      installedCleanup = null;
    }
  };
  installedCleanup = cleanup;
  return cleanup;
};

export const shutdownErrorMonitoring = (): void => {
  installedCleanup?.();
};

export const resetErrorMonitoringForTests = async (): Promise<void> => {
  shutdownErrorMonitoring();
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
    flushTimerDueAt = null;
  }
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
  await activeFlushPromise?.catch(() => undefined);
  await queueOperation.catch(() => undefined);
  // A pending capture schedules its flush after its queue write resolves. Clear
  // timers again after draining that write so one test cannot report in another.
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
    flushTimerDueAt = null;
  }
  await getQueueStore().clear().catch(() => undefined);
  queueOperation = Promise.resolve();
  queueStore = null;
  sending = false;
  activeFlushPromise = null;
  internalActivity = 0;
  fallbackUserContext = null;
  sessionId = null;
  transportFetch = null;
  inFlightEventIds.clear();
  breadcrumbs.splice(0, breadcrumbs.length);
  pendingQueueOverflowDrops = 0;
  pendingQueueOverflowFatalDrops = 0;
  pendingQueueOverflowFirstAt = null;
  options = {
    endpoint: DEFAULT_ENDPOINT,
    release: resolveRelease(),
    environment: process.env.NODE_ENV || "unknown",
    captureConsole: true,
    captureFetch: true,
    captureNetworkTransports: true,
    flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
    maxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
    maxQueueBytes: DEFAULT_MAX_QUEUE_BYTES,
    dedupeWindowMs: DEFAULT_DEDUPE_WINDOW_MS,
    transportTimeoutMs: DEFAULT_TRANSPORT_TIMEOUT_MS,
  };
};
