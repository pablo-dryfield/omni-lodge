const DEFAULT_TEXT_INPUT_BUDGET = 50_000;
const DEFAULT_CONTEXT_BUDGET = 8_000;
const MAX_PATH_SEGMENT_LENGTH = 512;
const MAX_PERCENT_DECODE_PASSES = 6;
const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|session|credential|card|iban|bank[_-]?(?:account|number)|swift|bic)/i;
const RELEASE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,119}$/;
const JWT_RELEASE_PATTERN = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/i;
const FINANCIAL_RELEASE_PATTERN = /^(?:\d{13,34}|[A-Z]{2}\d{2}[A-Z0-9]{11,30})$/i;

export const safeUiServerRead = (value, key) => {
  try {
    return value == null ? undefined : value[key];
  } catch {
    return undefined;
  }
};

const safeUiServerString = (value, fallback = '') => {
  try {
    return String(value ?? '');
  } catch {
    return fallback;
  }
};

const boundedInput = (value, maxLength) => {
  const requested = Number.isFinite(Number(maxLength)) ? Math.max(0, Number(maxLength)) : 2_000;
  const budget = Math.min(
    DEFAULT_TEXT_INPUT_BUDGET,
    Math.max(4_096, Math.ceil(requested) * 4),
  );
  return safeUiServerString(value, '[unavailable]').slice(0, budget);
};

export const sanitizeUiServerPersonalText = (value, maxLength = 2_000) => {
  try {
    return boundedInput(value, maxLength)
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-token]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
      .replace(/(\b(?:password|passwd|secret|token|authorization|api[_-]?key|iban|swift|bic|bank[_ -]?(?:account|number))\b\s*[:=]\s*)[^\r\n,;&]+/gi, '$1[redacted]')
      .replace(/\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/gi, '[redacted-bank-account]')
      .replace(/([?&][^=&#\s]{1,100}=)[^&#\s)\]]+/g, '$1[redacted]')
      .replace(/\b(?:\d[ -]*?){13,34}\b/g, '[redacted-number]')
      .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, '[redacted-phone]')
      .slice(0, Math.max(0, Math.floor(Number(maxLength) || 0)));
  } catch {
    return '[unavailable]';
  }
};

export const sanitizeUiServerText = (value, maxLength = 2_000) => {
  try {
    return sanitizeUiServerPersonalText(value, maxLength)
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[uuid]')
      .replace(/\b(?=[A-Za-z0-9_-]{24,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g, '[opaque-id]')
      .slice(0, Math.max(0, Math.floor(Number(maxLength) || 0)));
  } catch {
    return '[unavailable]';
  }
};

export const sanitizeUiServerCorrelationId = (value) => {
  const stringValue = sanitizeUiServerPersonalText(value, 200);
  if (/^[A-Za-z0-9._:-]{1,200}$/.test(stringValue)) return stringValue;
  return stringValue.replace(/[^A-Za-z0-9._:[\]-]/g, '-').slice(0, 200);
};

// Release identifiers are trusted machine tokens, not free text. Keeping this
// path separate from the personal-text redactor prevents ISO-style dates in a
// deployment tag from being mistaken for phone numbers.
export const sanitizeUiServerRelease = (value) => {
  const candidate = safeUiServerString(value).trim();
  if (!RELEASE_TOKEN_PATTERN.test(candidate)) return null;
  if (JWT_RELEASE_PATTERN.test(candidate) || FINANCIAL_RELEASE_PATTERN.test(candidate)) return null;
  return candidate;
};

const decodePathSegment = (value) => {
  let decoded = safeUiServerString(value).slice(0, MAX_PATH_SEGMENT_LENGTH);
  for (let attempt = 0; attempt < MAX_PERCENT_DECODE_PASSES; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next.slice(0, MAX_PATH_SEGMENT_LENGTH);
    } catch {
      return { decoded, malformed: true };
    }
  }
  return {
    decoded,
    // Do not persist a segment whose nested encoding exceeded the fixed budget.
    malformed: /%[0-9a-f]{2}/i.test(decoded),
  };
};

export const sanitizeUiServerPathSegment = (segment) => {
  const original = safeUiServerString(segment).slice(0, MAX_PATH_SEGMENT_LENGTH);
  if (!original) return original;
  const { decoded, malformed } = decodePathSegment(original);
  if (malformed) return '[redacted-encoded]';
  if (sanitizeUiServerPersonalText(decoded, MAX_PATH_SEGMENT_LENGTH) !== decoded) return '[redacted]';
  if (/^\d+$/.test(decoded)) return '[numeric-id]';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)) {
    return '[uuid]';
  }
  if (/^(?=.{20,}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9._~-]+$/.test(decoded)) {
    return '[opaque-id]';
  }
  return original;
};

export const safeUiServerRequestPath = (value) => {
  try {
    return new URL(safeUiServerString(value, '/'), 'http://ui-server.invalid')
      .pathname
      .split('/')
      .map(sanitizeUiServerPathSegment)
      .join('/')
      .slice(0, 1_000);
  } catch {
    return '/';
  }
};

const sanitizeContextValue = (value, state, depth) => {
  if (state.remaining <= 0) return '[truncated]';
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : safeUiServerString(value);
  if (typeof value === 'string' || typeof value === 'bigint' || typeof value === 'symbol') {
    const sanitized = sanitizeUiServerText(value, Math.min(1_000, state.remaining));
    state.remaining -= Buffer.byteLength(sanitized, 'utf8');
    return sanitized;
  }
  if (typeof value === 'function') return '[function]';
  if (depth >= 3) return '[max-depth]';
  if ((typeof value === 'object' || typeof value === 'function') && state.seen.has(value)) {
    return '[circular]';
  }
  if (typeof value === 'object' || typeof value === 'function') state.seen.add(value);

  if (Array.isArray(value)) {
    const result = [];
    for (let index = 0; index < Math.min(value.length, 20) && state.remaining > 0; index += 1) {
      result.push(sanitizeContextValue(safeUiServerRead(value, index), state, depth + 1));
    }
    return result;
  }

  const result = {};
  let keys;
  try {
    keys = Object.keys(value).slice(0, 30);
  } catch {
    return '[unavailable]';
  }
  for (const key of keys) {
    if (state.remaining <= 0) break;
    const safeKey = sanitizeUiServerText(key, 100) || 'field';
    state.remaining -= Buffer.byteLength(safeKey, 'utf8');
    result[safeKey] = SENSITIVE_KEY.test(key)
      ? '[redacted]'
      : sanitizeContextValue(safeUiServerRead(value, key), state, depth + 1);
  }
  return result;
};

export const sanitizeUiServerContext = (value, maxBytes = DEFAULT_CONTEXT_BUDGET) => {
  try {
    const remaining = Number.isFinite(Number(maxBytes))
      ? Math.max(256, Math.min(32_000, Math.floor(Number(maxBytes))))
      : DEFAULT_CONTEXT_BUDGET;
    const sanitized = sanitizeContextValue(value, { remaining, seen: new WeakSet() }, 0);
    return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
      ? sanitized
      : { value: sanitized };
  } catch {
    return { unavailable: true };
  }
};

export const uiServerTelemetryByteLength = (value) => {
  try {
    return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

export const pruneUiServerTelemetryQueueToBytes = (queue, maxBytes) => {
  const boundedBytes = Number.isFinite(Number(maxBytes)) ? Math.max(1, Math.floor(Number(maxBytes))) : 1;
  let serialized = JSON.stringify(queue);
  let dropped = 0;
  while (uiServerTelemetryByteLength(serialized) > boundedBytes && queue.length > 1) {
    const lowerSeverityIndex = queue.findIndex((event) => safeUiServerRead(event, 'level') !== 'fatal');
    queue.splice(lowerSeverityIndex >= 0 ? lowerSeverityIndex : 0, 1);
    dropped += 1;
    serialized = JSON.stringify(queue);
  }
  if (uiServerTelemetryByteLength(serialized) > boundedBytes && queue.length === 1) {
    const event = queue[0];
    queue[0] = {
      eventId: sanitizeUiServerCorrelationId(safeUiServerRead(event, 'eventId')) || 'spool-overflow',
      type: ['exception', 'api_error', 'manual'].includes(safeUiServerRead(event, 'type'))
        ? safeUiServerRead(event, 'type')
        : 'exception',
      level: safeUiServerRead(event, 'level') === 'fatal' ? 'fatal' : 'error',
      name: sanitizeUiServerText(safeUiServerRead(event, 'name') || 'UiServerTelemetryOverflow', 160),
      message: 'Telemetry payload exceeded the private spool event limit',
      occurredAt: sanitizeUiServerText(safeUiServerRead(event, 'occurredAt'), 40),
      pageUrl: '/',
      route: '/',
      tags: { runtime: 'ui-server' },
      context: { runtime: 'ui-server', payloadTruncated: true },
    };
    dropped += 1;
    serialized = JSON.stringify(queue);
  }
  if (uiServerTelemetryByteLength(serialized) > boundedBytes) {
    queue.splice(0, queue.length);
    dropped += 1;
    serialized = '[]';
  }
  return { serialized, dropped, bytes: uiServerTelemetryByteLength(serialized) };
};
