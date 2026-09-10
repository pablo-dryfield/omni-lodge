export const DEFAULT_RESTART_NOISE_LOOKBACK_MS = 10 * 60_000;
export const DEFAULT_RESTART_NOISE_FORWARD_MS = 30_000;

/**
 * Captured once when the API process loads. Keeping the value stable is
 * important because client and UI-server queues can deliver an occurrence well
 * after the restart that caused it.
 */
export const API_PROCESS_STARTED_AT_MS = Date.now() - Math.max(0, process.uptime() * 1_000);

export type RestartNoiseCandidate = {
  source?: unknown;
  kind?: unknown;
  level?: unknown;
  message?: unknown;
  errorName?: unknown;
  occurredAt?: unknown;
  httpUrl?: unknown;
  httpStatus?: unknown;
  pageUrl?: unknown;
  context?: unknown;
};

export type RestartNoisePolicyOptions = {
  processStartedAtMs?: number;
  runtimeEnvironment?: string | null;
  publicAppOrigin?: string | null;
  lookbackMs?: number;
  forwardMs?: number;
};

const OUTAGE_STATUSES = new Set([502, 503, 504]);
const STATUSLESS_NETWORK_ERROR_NAMES = new Set([
  'networkerror',
  'timeouterror',
  'xmlhttprequestnetworkerror',
  'xmlhttprequesttimeout',
]);

const normalizedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const occurredAtMilliseconds = (value: unknown): number | null => {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
};

type ParsedRequestTarget = { path: string; origin: string | null };

const parseRequestTarget = (value: unknown): ParsedRequestTarget | null => {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate || candidate.startsWith('//') || candidate.includes('\\')) return null;
  if (candidate.startsWith('/')) {
    return { path: candidate.split(/[?#]/, 1)[0], origin: null };
  }
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return { path: parsed.pathname, origin: parsed.origin.toLowerCase() };
  } catch {
    return null;
  }
};

const parseOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Monitoring sanitization normally represents first-party requests as
 * relative paths. Absolute URLs are accepted only when their origin matches
 * the page that captured the event or the configured canonical app origin.
 */
const isFirstPartyApiTarget = (
  value: unknown,
  pageUrl: unknown,
  publicAppOrigin: string | null,
): boolean => {
  const target = parseRequestTarget(value);
  if (!target || (target.path !== '/api' && !target.path.startsWith('/api/'))) return false;
  if (!target.origin) return true;
  const pageOrigin = parseOrigin(pageUrl);
  return target.origin === pageOrigin || target.origin === publicAppOrigin;
};

const isOutageStatus = (value: unknown): boolean => (
  typeof value === 'number' && Number.isInteger(value) && OUTAGE_STATUSES.has(value)
);

const isStatusless = (value: unknown): boolean => value == null || value === 0;

const isClearStatuslessNetworkFailure = (event: RestartNoiseCandidate): boolean => {
  if (!isStatusless(event.httpStatus)) return false;
  const errorName = normalizedString(event.errorName);
  const message = normalizedString(event.message);
  if (!errorName || !message) return false;

  const combined = `${errorName} ${message}`;
  // User-initiated cancellation is not evidence that the API was unavailable.
  if (/\b(?:abort(?:ed)?|cancel(?:ed|led)?)\b/.test(combined)) return false;

  if (STATUSLESS_NETWORK_ERROR_NAMES.has(errorName)) return true;
  if (errorName === 'typeerror' && /^(?:failed to fetch|load failed|network request failed)$/.test(message)) {
    return true;
  }

  return /\bfailed to fetch\b/.test(message)
    || /\bnetworkerror\b/.test(message)
    || /\bnetwork (?:error|failure|request failed)\b/.test(message)
    || /\bxmlhttprequest (?:failed|timed out)\b/.test(message)
    || /\b(?:fetch|request) timed out\b/.test(message)
    || /\btimeout(?: of \d+ms)? exceeded\b/.test(message)
    || /\b(?:econnrefused|econnreset|etimedout)\b/.test(message);
};

const plainContext = (value: unknown): Record<string, unknown> | null => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const isTrustedUiServerProxyFailure = (event: RestartNoiseCandidate): boolean => {
  if (normalizedString(event.source) !== 'server') return false;
  if (normalizedString(event.kind) !== 'api_error') return false;
  if (!isOutageStatus(event.httpStatus) || !isFirstPartyApiTarget(event.httpUrl, null, null)) return false;
  const context = plainContext(event.context);
  return normalizedString(context?.runtime) === 'ui-server'
    && normalizedString(context?.source) === 'api-proxy';
};

const isBrowserReportingApiNetworkFailure = (
  event: RestartNoiseCandidate,
  publicAppOrigin: string | null,
): boolean => {
  if (normalizedString(event.source) !== 'client') return false;
  if (normalizedString(event.kind) !== 'manual') return false;
  if (normalizedString(event.errorName) !== 'network-error') return false;
  if (normalizedString(event.message) !== 'browser report: network-error') return false;
  const context = plainContext(event.context);
  return normalizedString(context?.reportType) === 'network-error'
    && isFirstPartyApiTarget(event.pageUrl, null, publicAppOrigin);
};

const isClientApiOutageFailure = (
  event: RestartNoiseCandidate,
  publicAppOrigin: string | null,
): boolean => {
  if (normalizedString(event.source) !== 'client') return false;
  if (normalizedString(event.kind) !== 'api_error') return false;
  if (!isFirstPartyApiTarget(event.httpUrl, event.pageUrl, publicAppOrigin)) return false;
  return isOutageStatus(event.httpStatus) || isClearStatuslessNetworkFailure(event);
};

/**
 * Returns true only for secondary API-availability symptoms caused during a
 * production process restart. It intentionally fails open: an incomplete,
 * malformed, or unfamiliar event is retained by monitoring.
 */
export const shouldSuppressExpectedRestartNoise = (
  event: RestartNoiseCandidate,
  options: RestartNoisePolicyOptions = {},
): boolean => {
  try {
    if (!event || typeof event !== 'object') return false;
    const runtimeEnvironment = options.runtimeEnvironment === undefined
      ? process.env.NODE_ENV
      : options.runtimeEnvironment;
    const normalizedEnvironment = normalizedString(runtimeEnvironment);
    if (normalizedEnvironment !== 'production' && normalizedEnvironment !== 'prod') return false;
    const level = normalizedString(event.level);
    if (level !== 'warning' && level !== 'error') return false;
    if (!normalizedString(event.message)) return false;
    const publicAppOrigin = parseOrigin(
      options.publicAppOrigin === undefined
        ? process.env.PUBLIC_APP_ORIGIN
        : options.publicAppOrigin,
    );

    const processStartedAtMs = options.processStartedAtMs === undefined
      ? API_PROCESS_STARTED_AT_MS
      : options.processStartedAtMs;
    const lookbackMs = options.lookbackMs === undefined
      ? DEFAULT_RESTART_NOISE_LOOKBACK_MS
      : options.lookbackMs;
    const forwardMs = options.forwardMs === undefined
      ? DEFAULT_RESTART_NOISE_FORWARD_MS
      : options.forwardMs;
    const occurrenceMs = occurredAtMilliseconds(event.occurredAt);
    if (
      !Number.isFinite(processStartedAtMs)
      || processStartedAtMs < 0
      || !Number.isFinite(lookbackMs)
      || lookbackMs < 0
      || !Number.isFinite(forwardMs)
      || forwardMs < 0
      || occurrenceMs == null
    ) {
      return false;
    }
    if (
      occurrenceMs < processStartedAtMs - lookbackMs
      || occurrenceMs > processStartedAtMs + forwardMs
    ) {
      return false;
    }

    return isClientApiOutageFailure(event, publicAppOrigin)
      || isTrustedUiServerProxyFailure(event)
      || isBrowserReportingApiNetworkFailure(event, publicAppOrigin);
  } catch {
    return false;
  }
};
