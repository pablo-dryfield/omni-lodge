import { createHash, createHmac, randomUUID } from 'crypto';
import type { Request } from 'express';
import { literal, Op, QueryTypes, UniqueConstraintError, type Order, type Transaction } from 'sequelize';

import sequelize from '../config/database.js';
import ErrorMonitoringIssue, {
  type ErrorMonitoringLevel,
  type ErrorMonitoringSource,
  type ErrorMonitoringStatus,
} from '../models/ErrorMonitoringIssue.js';
import ErrorMonitoringNote from '../models/ErrorMonitoringNote.js';
import ErrorMonitoringOccurrence from '../models/ErrorMonitoringOccurrence.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { symbolicateBrowserStack } from './browserStackSymbolicationService.js';
import { getRequestContextValue } from './requestContextService.js';
import logger from '../utils/logger.js';
import {
  ErrorMonitoringDiskSpool,
  resolveErrorMonitoringSpoolOptions,
  type ErrorMonitoringSpoolReplayResult,
} from './errorMonitoringSpoolService.js';

export const CLIENT_EVENT_TYPES = [
  'exception',
  'unhandled_rejection',
  'react_error',
  'console_error',
  'resource_error',
  'api_error',
  'csp_violation',
  'manual',
] as const;

const ISSUE_STATUSES: readonly ErrorMonitoringStatus[] = ['open', 'investigating', 'resolved', 'ignored'];
const LEVELS: readonly ErrorMonitoringLevel[] = ['warning', 'error', 'fatal'];
const SOURCES: readonly ErrorMonitoringSource[] = ['client', 'server', 'request', 'process'];
const MAX_BATCH_SIZE = 20;
const MAX_PENDING_CAPTURES = 500;
const MAX_CONTEXT_BYTES = 32_000;
const MAX_JSON_DEPTH = 5;
const MAX_JSON_NODES = 500;
const REDACTION_BOUNDARY_LOOKAHEAD = 512;
const MAX_OBJECT_KEYS = 50;
const MAX_ARRAY_LENGTH = 50;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_STACK_LENGTH = 30_000;
const MAX_COMPONENT_STACK_LENGTH = 15_000;
const MAX_TITLE_LENGTH = 500;
const MAX_NOTE_LENGTH = 4_000;
const DEFAULT_OCCURRENCE_RETENTION_DAYS = 90;
const ERROR_MONITORING_ADVISORY_LOCK_NAMESPACE = 1_869_442_405;
const ERROR_MONITORING_ADVISORY_LOCK_KEY = 1_919_250_546;

const SENSITIVE_KEY = /(?:pass(?:word|code)?|secret|token|authorization|cookie|session(?:id)?|api[-_]?key|private[-_]?key|credit|card|cvv|cvc|iban|bank|phone|e[-_]?mail|email|address|medical|body|payload|photo|image|file|blob|binary|signature|pin|username|(?:customer|guest|full|first|last)[-_]?name)/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/gi;
const LONG_BANK_ACCOUNT_PATTERN = /\b(?:\d[ -]?){20,34}\b/g;
const CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const PHONE_PATTERN = /(?:\+\d|\b\d)(?:[\s().-]*\d){7,14}\b/g;
const UUID_TEXT_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const OPAQUE_IDENTIFIER_PATTERN = /\b(?=[A-Za-z0-9_-]{20,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}\b/g;
const SECRET_ASSIGNMENT_PATTERN = /(\b(?:pass(?:word|code)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|cvv|cvc)\b\s*(?:=|:)\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const QUERY_VALUE_PATTERN = /([?&][^=&#\s]{1,100}=)[^&#\s)\]]*/g;
const LABELED_AMOUNT_PATTERN = /(\b(?:amount|balance|cost|expense|income|payment|price|refund|reimbursement|revenue|salary|total)\b(?:\s*\((?:PLN|EUR|USD|GBP|zł|€|\$|£)\))?\s*(?:=|:|is|was|of)?\s*)(?:(?:PLN|EUR|USD|GBP|zł|€|\$|£)\s*)?[-+]?\d(?:[\d .,'’]*\d)?(?:\s*(?:PLN|EUR|USD|GBP|zł|€|\$|£))?/gi;
const CURRENCY_AMOUNT_PATTERN = /(?:(?:\b(?:PLN|EUR|USD|GBP)\b|zł|€|\$|£)\s*[-+]?\d(?:[\d .,'’]*\d)?|[-+]?\d(?:[\d .,'’]*\d)?\s*(?:\b(?:PLN|EUR|USD|GBP)\b|zł|€|\$|£))/gi;

export type ClientErrorEventInput = {
  eventId?: unknown;
  /**
   * The authenticated user observed by the browser when this event was first
   * captured. This is only an attribution veto for delayed queue delivery; it
   * is never accepted as authentication.
   */
  capturedUserId?: unknown;
  type?: unknown;
  level?: unknown;
  message?: unknown;
  name?: unknown;
  stack?: unknown;
  componentStack?: unknown;
  occurredAt?: unknown;
  pageUrl?: unknown;
  route?: unknown;
  release?: unknown;
  environment?: unknown;
  sessionId?: unknown;
  requestId?: unknown;
  http?: unknown;
  tags?: unknown;
  context?: unknown;
  breadcrumbs?: unknown;
};

export type ClientErrorServerContext = {
  userId?: number | null;
  /** True only when middleware validated the private internal telemetry secret. */
  trustedInternal?: boolean;
  userAgent?: string | null;
  ip?: string | null;
};

export type CaptureEvent = {
  clientEventId?: string | null;
  source: ErrorMonitoringSource;
  kind: string;
  level: ErrorMonitoringLevel;
  message: string;
  errorName?: string | null;
  stack?: string | null;
  componentStack?: string | null;
  occurredAt?: Date;
  userId?: number | null;
  sessionId?: string | null;
  requestId?: string | null;
  httpMethod?: string | null;
  httpUrl?: string | null;
  httpStatus?: number | null;
  durationMs?: number | null;
  responseSizeBytes?: number | null;
  pageUrl?: string | null;
  route?: string | null;
  release?: string | null;
  environment?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  context?: unknown;
  tags?: unknown;
  breadcrumbs?: unknown;
  /** Number of locally coalesced identical events represented by this sample. */
  occurrenceWeight?: number;
};

export type CapturedEventResult = {
  eventId: string;
  issueId: string;
  duplicate: boolean;
  isNew: boolean;
  regressed: boolean;
};

type SafeJson = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

const clampString = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

const sanitizeClientEventId = (value: unknown): string | null => {
  const candidate = clampString(value, 128);
  return candidate && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(candidate) ? candidate : null;
};

/**
 * Correlation IDs are deliberately retained so an X-Request-Id shown to a
 * user can locate the matching browser and server occurrences. Applying the
 * generic free-text redactor here is incorrect because timestamp-based IDs
 * resemble phone numbers. Keep only a narrow machine-token alphabet and
 * reject obvious credentials or financial identifiers instead.
 */
export const sanitizeCorrelationId = (value: unknown, max = 200): string | null => {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > max) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(candidate)) return null;
  if (/^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/i.test(candidate)) return null;
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/i.test(candidate)) return null;
  if (/^\d{8,19}$/.test(candidate)) return null;
  return candidate;
};

const sanitizeClientRelease = (value: unknown): string | null => {
  const candidate = clampString(value, 120);
  return candidate && /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,119}$/.test(candidate)
    ? candidate
    : null;
};

const sanitizeClientEnvironment = (value: unknown): string | null => {
  const candidate = clampString(value, 50)?.toLowerCase();
  if (!candidate) return null;
  if (candidate === 'prod' || candidate === 'production') return 'production';
  if (candidate === 'dev' || candidate === 'development') return 'development';
  if (candidate === 'stage' || candidate === 'staging') return 'staging';
  if (candidate === 'test' || candidate === 'testing') return 'test';
  return 'unknown';
};

const stableJsonStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJsonStringify(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

export const redactSensitiveText = (value: string): string => value
  .replace(SECRET_ASSIGNMENT_PATTERN, '$1[redacted]')
  .replace(QUERY_VALUE_PATTERN, '$1[redacted]')
  .replace(BEARER_PATTERN, 'Bearer [redacted]')
  .replace(JWT_PATTERN, '[redacted-token]')
  .replace(EMAIL_PATTERN, '[redacted-email]')
  .replace(IBAN_PATTERN, '[redacted-iban]')
  .replace(LONG_BANK_ACCOUNT_PATTERN, '[redacted-bank-account]')
  .replace(LABELED_AMOUNT_PATTERN, '$1[redacted-amount]')
  .replace(CURRENCY_AMOUNT_PATTERN, '[redacted-amount]')
  .replace(CARD_PATTERN, '[redacted-number]')
  .replace(PHONE_PATTERN, '[redacted-phone]')
  .replace(UUID_TEXT_PATTERN, '[redacted-id]')
  .replace(OPAQUE_IDENTIFIER_PATTERN, '[redacted-id]');

const clampAndRedact = (value: unknown, max: number): string | null => {
  // Inspect a small bounded suffix beyond the storage limit so truncation cannot
  // cut an email, IBAN, account number, or token in half before it is recognized.
  const candidate = clampString(value, max + REDACTION_BOUNDARY_LOOKAHEAD);
  return candidate == null ? null : redactSensitiveText(candidate).slice(0, max);
};

const sanitizeJsonValue = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  budget: { remaining: number },
): SafeJson | undefined => {
  if (budget.remaining <= 0) return '[truncated-nodes]';
  budget.remaining -= 1;
  if (value == null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string') {
    return redactSensitiveText(value.slice(0, 4_000 + REDACTION_BOUNDARY_LOOKAHEAD)).slice(0, 4_000);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return undefined;
  if (depth >= MAX_JSON_DEPTH) return '[truncated-depth]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch {
    seen.delete(value);
    return '[unreadable-object]';
  }

  if (isArray) {
    const result: SafeJson[] = [];
    let length = 0;
    try {
      length = Math.min(Number((value as unknown[]).length) || 0, MAX_ARRAY_LENGTH);
    } catch {
      seen.delete(value);
      return '[unreadable-array]';
    }
    for (let index = 0; index < length; index += 1) {
      if (budget.remaining <= 0) {
        result.push('[truncated-nodes]');
        break;
      }
      let entry: unknown;
      try {
        entry = (value as unknown[])[index];
      } catch {
        result.push('[unreadable-value]');
        continue;
      }
      const sanitized = sanitizeJsonValue(entry, depth + 1, seen, budget);
      if (sanitized !== undefined) result.push(sanitized);
    }
    seen.delete(value);
    return result;
  }

  const result: Record<string, SafeJson> = {};
  let keys: string[];
  try {
    // Slice before reading properties so a very wide object cannot force every
    // getter to execute or materialize all of its values.
    keys = Object.keys(value).slice(0, MAX_OBJECT_KEYS);
  } catch {
    seen.delete(value);
    return '[unreadable-object]';
  }
  for (const key of keys) {
    if (budget.remaining <= 0) {
      result.truncated = '[truncated-nodes]';
      break;
    }
    const safeKey = key.slice(0, 120);
    if (SENSITIVE_KEY.test(safeKey)) {
      result[safeKey] = '[redacted]';
      continue;
    }
    let entry: unknown;
    try {
      entry = (value as Record<string, unknown>)[key];
    } catch {
      result[safeKey] = '[unreadable-value]';
      continue;
    }
    const sanitized = sanitizeJsonValue(entry, depth + 1, seen, budget);
    if (sanitized !== undefined) result[safeKey] = sanitized;
  }
  seen.delete(value);
  return result;
};

export const sanitizeMonitoringJson = (value: unknown): Record<string, unknown> | Array<unknown> | null => {
  try {
    const sanitized = sanitizeJsonValue(
      value,
      0,
      new WeakSet<object>(),
      { remaining: MAX_JSON_NODES },
    );
    if (typeof sanitized === 'string' && sanitized.startsWith('[unreadable-')) {
      return { unavailable: sanitized };
    }
    if (!sanitized || typeof sanitized !== 'object') return null;
    const serialized = JSON.stringify(sanitized);
    if (Buffer.byteLength(serialized, 'utf8') <= MAX_CONTEXT_BYTES) {
      return sanitized as Record<string, unknown> | Array<unknown>;
    }
    return { truncated: true, originalBytes: Buffer.byteLength(serialized, 'utf8') };
  } catch {
    // Monitoring must never become a new application failure when inspecting a
    // hostile Proxy, throwing getter, revoked object, or other exotic value.
    return { sanitizationFailed: true };
  }
};

export const sanitizeUrlPath = (value: unknown, max = 2_000): string | null => {
  const raw = clampString(value, max * 2);
  if (!raw) return null;
  const sanitizePath = (pathname: string): string => {
    let decoded = pathname;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        // Decode valid runs even if another segment contains malformed `%` data.
        const next = decoded.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
          try {
            return decodeURIComponent(encoded);
          } catch {
            return encoded;
          }
        });
        if (next === decoded) break;
        decoded = next;
      }
    }
    return redactSensitiveText(decoded
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
      .replace(/\/(?:\d+)(?=\/|$)/g, '/:id')
      .replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, '/:id'))
      .slice(0, max);
  };
  try {
    const parsed = new URL(raw, 'https://monitoring.invalid');
    const path = `${parsed.pathname}` || '/';
    return sanitizePath(path);
  } catch {
    return sanitizePath(raw.split(/[?#]/, 1)[0] || '/');
  }
};

const normalizeRouteForFingerprint = (value: string | null): string => (value ?? '')
  .toLowerCase()
  .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
  .replace(/\/(?:\d+)(?=\/|$)/g, '/:id')
  .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/:id')
  .replace(/([._-])[0-9a-f]{8,}(?=\.)/gi, '$1:hash')
  .slice(0, 500);

export const normalizeErrorMessage = (value: string): string => redactSensitiveText(value)
  .toLowerCase()
  .replace(/https?:\/\/[^\s)]+/g, '<url>')
  .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<uuid>')
  .replace(/\b[0-9a-f]{16,}\b/gi, '<id>')
  .replace(/\b\d{4}-\d{2}-\d{2}(?:[t\s][\d:.+-z]+)?\b/gi, '<date>')
  .replace(/\b\d+\b/g, '<n>')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, MAX_MESSAGE_LENGTH);

const normalizedStackSignature = (stack: string | null | undefined): string => {
  if (!stack) return '';
  return stack
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => !/node_modules\/(?:express|sequelize|sequelize-typescript)\b/i.test(line))
    .slice(0, 4)
    .map((line) => line
      .trim()
      .replace(/https?:\/\/[^\s)]+/g, '<url>')
      .replace(/\?.*?(?=:\d|\)|\s|$)/g, '')
      .replace(/:\d+:\d+/g, ':<line>')
      .replace(/\b[0-9a-f]{8,}\b/gi, '<hash>'))
    .join('|')
    .slice(0, 2_000);
};

const CLIENT_RUNTIME_KINDS = new Set([
  'react_error',
  'exception',
  'unhandled_rejection',
  'console_error',
]);

export const buildErrorFingerprint = (event: Pick<CaptureEvent,
  'source' | 'kind' | 'message' | 'errorName' | 'stack' | 'route' | 'httpMethod' | 'httpUrl' | 'httpStatus'
>): string => {
  const route = normalizeRouteForFingerprint(sanitizeUrlPath(event.route, 500));
  const failedUrl = normalizeRouteForFingerprint(sanitizeUrlPath(event.httpUrl, 500));
  const isClientRuntimeError = event.source === 'client'
    && CLIENT_RUNTIME_KINDS.has(event.kind.toLowerCase());
  const signature = [
    event.source,
    isClientRuntimeError ? 'runtime_error' : event.kind.toLowerCase(),
    isClientRuntimeError ? '' : (event.errorName ?? '').toLowerCase(),
    normalizeErrorMessage(event.message),
    normalizedStackSignature(event.stack),
    route,
    (event.httpMethod ?? '').toUpperCase(),
    failedUrl,
    event.httpStatus ?? '',
  ].join('\n');
  return createHash('sha256').update(signature).digest('hex');
};

const hashPrivateIdentifier = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const key = process.env.ERROR_MONITORING_HASH_SECRET
    || process.env.JWT_SECRET
    || 'omnilodge-error-monitoring-local-only';
  return createHmac('sha256', key).update(value.slice(0, 1_000)).digest('hex');
};

const parseLevel = (value: unknown, fallback: ErrorMonitoringLevel = 'error'): ErrorMonitoringLevel => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return LEVELS.includes(normalized as ErrorMonitoringLevel)
    ? normalized as ErrorMonitoringLevel
    : fallback;
};

const parseOccurredAt = (value: unknown): Date => {
  const now = new Date();
  if (typeof value !== 'string' && !(value instanceof Date)) return now;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return now;
  if (parsed.getTime() > now.getTime() + 5 * 60_000) return now;
  if (parsed.getTime() < now.getTime() - 180 * 24 * 60 * 60_000) return now;
  return parsed;
};

const sanitizeHttp = (value: unknown): {
  method: string | null;
  url: string | null;
  status: number | null;
  durationMs: number | null;
  requestId: string | null;
} => {
  const http = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const status = Number(http.status);
  const durationMs = http.durationMs == null ? Number.NaN : Number(http.durationMs);
  return {
    method: clampString(http.method, 12)?.toUpperCase() ?? null,
    url: sanitizeUrlPath(http.url),
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? Math.min(durationMs, 86_400_000) : null,
    requestId: sanitizeCorrelationId(http.requestId, 100),
  };
};

const parseOccurrenceWeight = (tags: unknown): number => {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return 1;
  const parsed = Number((tags as Record<string, unknown>).localOccurrences);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(Math.floor(parsed), 1_000));
};

const sanitizeClientContext = (
  value: unknown,
): Record<string, unknown> | Array<unknown> | null => {
  const context = sanitizeMonitoringJson(value);
  if (!context) return context;

  // Identity is derived exclusively from optional server-side authentication. A
  // browser must not be able to attribute an occurrence to an arbitrary user by
  // embedding a user-shaped object anywhere in diagnostic context. The value is
  // already bounded and cycle-safe, so recursively removing identity keys here
  // cannot be abused with an unbounded input graph.
  const stripIdentity = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(stripIdentity);
    if (!entry || typeof entry !== 'object') return entry;
    return Object.fromEntries(
      Object.entries(entry as Record<string, unknown>)
        .filter(([key]) => !/^(?:user|user[-_]?id|current[-_]?user|authenticated[-_]?user|auth[-_]?user|auth[-_]?context|identity)$/i.test(key))
        .map(([key, nested]) => [key, stripIdentity(nested)]),
    );
  };
  return stripIdentity(context) as Record<string, unknown> | Array<unknown>;
};

const extractFailedClientResourceUrl = (
  kind: string,
  httpUrl: string | null,
  context: Record<string, unknown> | Array<unknown> | null,
): string | null => {
  if (httpUrl) return httpUrl;
  if (!['resource_error', 'csp_violation'].includes(kind) || !context || Array.isArray(context)) return null;
  const details = context.details && typeof context.details === 'object' && !Array.isArray(context.details)
    ? context.details as Record<string, unknown>
    : null;
  return sanitizeUrlPath(
    context.resourceUrl
      ?? context.blockedUrl
      ?? context.blockedUri
      ?? context.source
      ?? context.sourceFile
      ?? details?.resourceUrl
      ?? details?.blockedUrl
      ?? details?.blockedUri
      ?? details?.source
      ?? details?.sourceFile,
  );
};

export const sanitizeClientEvent = (
  input: ClientErrorEventInput,
  serverContext: ClientErrorServerContext,
): CaptureEvent => {
  if (!input || typeof input !== 'object') throw new Error('Event must be an object.');
  const message = clampAndRedact(input.message, MAX_MESSAGE_LENGTH);
  if (!message) throw new Error('Event message is required.');
  const rawType = clampString(input.type, 64)?.toLowerCase() ?? 'exception';
  const kind = CLIENT_EVENT_TYPES.includes(rawType as typeof CLIENT_EVENT_TYPES[number])
    ? rawType
    : 'manual';
  const http = sanitizeHttp(input.http);
  const context = sanitizeClientContext(input.context);
  const requestedLevel = parseLevel(input.level);
  const parsedServerUserId = Number(serverContext.userId);
  const authenticatedUserId = Number.isSafeInteger(parsedServerUserId) && parsedServerUserId > 0
    ? parsedServerUserId
    : null;
  const parsedCapturedUserId = Number(input.capturedUserId);
  const capturedUserId = Number.isSafeInteger(parsedCapturedUserId) && parsedCapturedUserId > 0
    ? parsedCapturedUserId
    : null;
  const hasCapturedUserId = Object.prototype.hasOwnProperty.call(input, 'capturedUserId');
  const trustedUserId = authenticatedUserId != null
    && (!hasCapturedUserId || capturedUserId === authenticatedUserId)
    ? authenticatedUserId
    : null;
  const trustedInternal = serverContext.trustedInternal === true;
  const trustedProducer = trustedInternal || authenticatedUserId != null;
  const level = !trustedProducer && requestedLevel === 'fatal'
    ? 'error'
    : requestedLevel;

  return {
    clientEventId: clampString(input.eventId, 128),
    source: trustedInternal ? 'server' : 'client',
    kind,
    level,
    message,
    errorName: clampString(input.name, 160),
    stack: clampString(input.stack, MAX_STACK_LENGTH),
    componentStack: clampString(input.componentStack, MAX_COMPONENT_STACK_LENGTH),
    occurredAt: parseOccurredAt(input.occurredAt),
    userId: trustedUserId,
    sessionId: clampString(input.sessionId, 256),
    requestId: sanitizeCorrelationId(input.requestId, 100) ?? http.requestId,
    httpMethod: http.method,
    httpUrl: extractFailedClientResourceUrl(kind, http.url, context),
    httpStatus: http.status,
    durationMs: http.durationMs,
    pageUrl: sanitizeUrlPath(input.pageUrl),
    route: sanitizeUrlPath(input.route, 500),
    release: sanitizeClientRelease(input.release),
    environment: trustedInternal
      ? clampAndRedact(input.environment, 50)
      : sanitizeClientEnvironment(input.environment),
    userAgent: clampString(serverContext.userAgent, 1_000),
    ip: serverContext.ip ?? null,
    context,
    tags: input.tags,
    breadcrumbs: Array.isArray(input.breadcrumbs) ? input.breadcrumbs.slice(-MAX_ARRAY_LENGTH) : null,
    // Anonymous ingestion must not be able to inflate issue counts. Browser
    // coalescing weights remain available to authenticated sessions and the
    // private UI-server producer.
    occurrenceWeight: trustedProducer ? parseOccurrenceWeight(input.tags) : 1,
  };
};

const severityRankSql = (column: string): string => `CASE ${column}
  WHEN 'fatal' THEN 4 WHEN 'error' THEN 3 WHEN 'warning' THEN 2 WHEN 'info' THEN 1 ELSE 0 END`;

const runtimeKindRankSql = (column: string): string => `CASE ${column}
  WHEN 'react_error' THEN 4 WHEN 'exception' THEN 3 WHEN 'unhandled_rejection' THEN 2
  WHEN 'console_error' THEN 1 ELSE 0 END`;

const regressionConditionSql = `error_monitoring_issues.status = 'resolved'
  AND EXCLUDED.last_seen_at > COALESCE(
    error_monitoring_issues.resolved_at,
    '-infinity'::timestamptz
  )`;

const sendAdminIssueAlert = async (
  event: CaptureEvent,
  result: CapturedEventResult & { reopenedCount: number },
): Promise<void> => {
  const alertType = result.regressed ? 'regression' : 'new';
  const dedupeKey = result.regressed
    ? `regression:${result.issueId}:${result.reopenedCount}`
    : `new:${result.issueId}`;
  const users = await sequelize.query<{ id: number }>(
    `SELECT u.id
       FROM users u
       JOIN "userTypes" ut ON ut.id = u."userTypeId"
      WHERE u.status = true
        AND u.approved = true
        AND ut.status = true
        AND ut.slug IN ('admin', 'administrator', 'owner');`,
    { type: QueryTypes.SELECT },
  );
  if (users.length === 0) return;
  const alreadyNotified = await sequelize.query<{ user_id: number }>(
    `SELECT user_id
       FROM notifications
      WHERE template_key = 'error_monitoring_alert'
        AND payload_json ->> 'dedupeKey' = :dedupeKey
        AND user_id IN (:userIds);`,
    {
      replacements: { dedupeKey, userIds: users.map((user) => user.id) },
      type: QueryTypes.SELECT,
    },
  );
  const notifiedIds = new Set(alreadyNotified.map((row) => Number(row.user_id)));
  const targets = users.filter((user) => !notifiedIds.has(Number(user.id)));
  if (targets.length === 0) return;
  const title = result.regressed
    ? 'Resolved error happened again'
    : event.level === 'fatal'
      ? 'New fatal error detected'
      : 'New server error detected';
  const body = `${event.source.toUpperCase()}: ${event.message}`.slice(0, 500);
  const sentAt = new Date();
  await Notification.bulkCreate(targets.map((target) => ({
    userId: target.id,
    channel: 'in_app',
    templateKey: 'error_monitoring_alert',
    payloadJson: {
      title,
      body,
      url: `/error-monitoring?issue=${result.issueId}`,
      issueId: result.issueId,
      alertType,
      dedupeKey,
      severity: event.level,
      source: event.source,
      occurredAt: event.occurredAt?.toISOString() ?? sentAt.toISOString(),
    },
    sentAt,
  })));
};

const normalizeCaptureEvent = (rawEvent: CaptureEvent): CaptureEvent => {
  const source = SOURCES.includes(rawEvent.source) ? rawEvent.source : 'server';
  const status = Number(rawEvent.httpStatus);
  const durationMs = rawEvent.durationMs == null ? Number.NaN : Number(rawEvent.durationMs);
  const responseSizeBytes = rawEvent.responseSizeBytes == null
    ? Number.NaN
    : Number(rawEvent.responseSizeBytes);
  const userId = Number(rawEvent.userId);
  return {
    source,
    clientEventId: sanitizeClientEventId(rawEvent.clientEventId),
    kind: clampString(rawEvent.kind, 64)?.toLowerCase() ?? 'exception',
    level: parseLevel(rawEvent.level),
    message: clampAndRedact(rawEvent.message, MAX_MESSAGE_LENGTH) ?? 'Unknown error',
    errorName: clampAndRedact(rawEvent.errorName, 160),
    stack: clampAndRedact(rawEvent.stack, MAX_STACK_LENGTH),
    componentStack: clampAndRedact(rawEvent.componentStack, MAX_COMPONENT_STACK_LENGTH),
    occurredAt: parseOccurredAt(rawEvent.occurredAt),
    route: sanitizeUrlPath(rawEvent.route, 500),
    pageUrl: sanitizeUrlPath(rawEvent.pageUrl),
    httpUrl: sanitizeUrlPath(rawEvent.httpUrl),
    // Release identifiers are bounded machine tokens. Generic free-text
    // redaction mistakes ISO-style dates inside labels for phone numbers and
    // makes exact release filtering impossible.
    release: sanitizeClientRelease(rawEvent.release),
    environment: clampAndRedact(rawEvent.environment, 50),
    requestId: sanitizeCorrelationId(rawEvent.requestId, 100),
    userAgent: clampAndRedact(rawEvent.userAgent, 1_000),
    sessionId: clampString(rawEvent.sessionId, 256),
    ip: clampString(rawEvent.ip, 100),
    httpMethod: clampString(rawEvent.httpMethod, 12)?.toUpperCase() ?? null,
    httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? Math.min(durationMs, 86_400_000) : null,
    responseSizeBytes: Number.isFinite(responseSizeBytes) && responseSizeBytes >= 0
      ? Math.min(Math.floor(responseSizeBytes), Number.MAX_SAFE_INTEGER)
      : null,
    userId: Number.isSafeInteger(userId) && userId > 0 ? userId : null,
    context: rawEvent.context,
    tags: rawEvent.tags,
    breadcrumbs: rawEvent.breadcrumbs,
    occurrenceWeight: Math.max(1, Math.min(Math.floor(Number(rawEvent.occurrenceWeight) || 1), 1_000)),
  };
};

/** A fully bounded/redacted representation suitable for local emergency storage. */
export const prepareCaptureEventForSpool = (rawEvent: CaptureEvent): CaptureEvent => {
  const event = normalizeCaptureEvent(rawEvent);
  return {
    ...event,
    clientEventId: event.clientEventId ?? `server-spool:${randomUUID()}`,
    // Raw network identifiers are deliberately never written to disk. Immediate
    // persistence still hashes them; a replayed fallback simply omits them.
    sessionId: null,
    ip: null,
    context: sanitizeMonitoringJson(event.context),
    tags: sanitizeMonitoringJson(event.tags),
    breadcrumbs: sanitizeMonitoringJson(event.breadcrumbs),
  };
};

const acquireErrorMonitoringPersistenceLock = async (transaction: Transaction): Promise<void> => {
  // Persistence transactions share this lock. Retention takes the matching
  // exclusive lock, so its projection rebuild cannot race an occurrence insert
  // while normal captures remain concurrent with each other.
  await sequelize.query(
    `SELECT pg_advisory_xact_lock_shared(
       ${ERROR_MONITORING_ADVISORY_LOCK_NAMESPACE},
       ${ERROR_MONITORING_ADVISORY_LOCK_KEY}
     );`,
    { transaction },
  );
};

const updateAffectedUserProjection = async (
  issueId: number | string,
  userId: number,
  occurredAt: Date,
  transaction: Transaction,
): Promise<void> => {
  const insertedUsers = await sequelize.query<{ user_id: number }>(
    `INSERT INTO error_monitoring_affected_users (issue_id, user_id, first_seen_at, last_seen_at)
     VALUES (:issueId, :userId, :occurredAt, :occurredAt)
     ON CONFLICT (issue_id, user_id) DO NOTHING
     RETURNING user_id;`,
    {
      replacements: { issueId, userId, occurredAt },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  if (insertedUsers.length > 0) {
    await ErrorMonitoringIssue.increment('affectedUserCount', {
      by: 1,
      where: { id: issueId },
      transaction,
    });
    return;
  }
  await sequelize.query(
    `UPDATE error_monitoring_affected_users
        SET first_seen_at = LEAST(first_seen_at, :occurredAt),
            last_seen_at = GREATEST(last_seen_at, :occurredAt)
      WHERE issue_id = :issueId AND user_id = :userId;`,
    { replacements: { issueId, userId, occurredAt }, transaction },
  );
};

const persistCapture = async (rawEvent: CaptureEvent): Promise<CapturedEventResult> => {
  const event = normalizeCaptureEvent(rawEvent);
  const fingerprint = buildErrorFingerprint(event);
  const eventId = randomUUID();
  const now = new Date();
  const occurrenceWeight = event.occurrenceWeight ?? 1;
  const environment = event.environment ?? clampAndRedact(process.env.NODE_ENV, 50);
  const culprit = clampAndRedact(
    normalizedStackSignature(event.stack).split('|')[0] || event.route,
    500,
  );

  try {
    const result = await sequelize.transaction(async (transaction: Transaction) => {
      await acquireErrorMonitoringPersistenceLock(transaction);

      if (event.clientEventId) {
        const existing = await ErrorMonitoringOccurrence.findOne({
          where: { clientEventId: event.clientEventId },
          attributes: ['id', 'eventId', 'issueId', 'eventCount', 'occurredAt', 'userId'],
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (existing) {
          const storedWeight = Math.max(1, Number(existing.eventCount) || 1);
          const weightDelta = Math.max(0, occurrenceWeight - storedWeight);
          if (weightDelta > 0) {
            const existingOccurredAt = new Date(existing.occurredAt);
            const latestOccurredAt = existingOccurredAt.getTime() > event.occurredAt!.getTime()
              ? existingOccurredAt
              : event.occurredAt!;
            await existing.update({
              eventCount: occurrenceWeight,
              occurredAt: latestOccurredAt,
            }, { transaction });

            const issueRows = await sequelize.query<{
              reopened_count: number | string;
              regressed: boolean;
            }>(
              `WITH current_issue AS (
                 SELECT id,
                        status = 'resolved'
                          AND :occurredAt > COALESCE(resolved_at, '-infinity'::timestamptz)
                          AS regressed
                   FROM error_monitoring_issues
                  WHERE id = :issueId
                  FOR UPDATE
               )
               UPDATE error_monitoring_issues issue
                  SET kind = CASE
                        WHEN ${runtimeKindRankSql(':kind')} > ${runtimeKindRankSql('issue.kind')}
                          THEN :kind ELSE issue.kind END,
                      culprit = CASE
                        WHEN :occurredAt >= issue.last_seen_at
                          THEN COALESCE(:culprit, issue.culprit)
                        ELSE issue.culprit END,
                      severity = CASE
                        WHEN ${severityRankSql(':severity')} > ${severityRankSql('issue.severity')}
                          THEN :severity ELSE issue.severity END,
                      status = CASE WHEN current_issue.regressed THEN 'open' ELSE issue.status END,
                      reopened_count = issue.reopened_count
                        + CASE WHEN current_issue.regressed THEN 1 ELSE 0 END,
                      last_regressed_at = CASE WHEN current_issue.regressed THEN :now
                                               ELSE issue.last_regressed_at END,
                      status_changed_at = CASE WHEN current_issue.regressed THEN :now
                                               ELSE issue.status_changed_at END,
                      status_changed_by_user_id = CASE WHEN current_issue.regressed THEN NULL
                                                       ELSE issue.status_changed_by_user_id END,
                      resolved_at = CASE WHEN current_issue.regressed THEN NULL ELSE issue.resolved_at END,
                      first_seen_at = LEAST(issue.first_seen_at, :occurredAt),
                      last_seen_at = GREATEST(issue.last_seen_at, :occurredAt),
                      occurrence_count = issue.occurrence_count + :weightDelta,
                      last_user_id = CASE
                        WHEN :occurredAt >= issue.last_seen_at
                          THEN COALESCE(:userId, issue.last_user_id)
                        ELSE issue.last_user_id END,
                      last_route = CASE
                        WHEN :occurredAt >= issue.last_seen_at
                          THEN COALESCE(:route, issue.last_route)
                        ELSE issue.last_route END,
                      last_page_url = CASE
                        WHEN :occurredAt >= issue.last_seen_at
                          THEN COALESCE(:pageUrl, issue.last_page_url)
                        ELSE issue.last_page_url END,
                      last_release = CASE
                        WHEN :occurredAt >= issue.last_seen_at
                          THEN COALESCE(:release, issue.last_release)
                        ELSE issue.last_release END,
                      last_environment = CASE
                        WHEN :occurredAt >= issue.last_seen_at
                          THEN COALESCE(:environment, issue.last_environment)
                        ELSE issue.last_environment END,
                      updated_at = :now
                 FROM current_issue
                WHERE issue.id = current_issue.id
               RETURNING issue.reopened_count, current_issue.regressed;`,
              {
                replacements: {
                  issueId: existing.issueId,
                  kind: event.kind,
                  culprit,
                  severity: event.level,
                  occurredAt: event.occurredAt,
                  weightDelta,
                  userId: existing.userId ?? null,
                  route: event.route ?? null,
                  pageUrl: event.pageUrl ?? null,
                  release: event.release ?? null,
                  environment,
                  now,
                },
                type: QueryTypes.SELECT,
                transaction,
              },
            );
            if (existing.userId != null) {
              await updateAffectedUserProjection(
                existing.issueId,
                Number(existing.userId),
                event.occurredAt!,
                transaction,
              );
            }
            return {
              eventId: existing.eventId,
              issueId: String(existing.issueId),
              duplicate: true,
              isNew: false,
              regressed: issueRows[0]?.regressed === true,
              reopenedCount: Number(issueRows[0]?.reopened_count ?? 0),
            };
          }
          return {
            eventId: existing.eventId,
            issueId: String(existing.issueId),
            duplicate: true,
            isNew: false,
            regressed: false,
            reopenedCount: 0,
          };
        }
      }

      const issueRows = await sequelize.query<{
        id: number | string;
        occurrence_count: number | string;
        reopened_count: number | string;
        is_new: boolean;
        regressed: boolean;
      }>(
        `INSERT INTO error_monitoring_issues (
           fingerprint, source, kind, title, normalized_message, culprit, severity, status,
           first_seen_at, last_seen_at, occurrence_count, affected_user_count, reopened_count,
           last_regressed_at, last_user_id, last_route, last_page_url, last_release, last_environment,
           created_at, updated_at
         ) VALUES (
           :fingerprint, :source, :kind, :title, :normalizedMessage, :culprit, :severity, 'open',
           :occurredAt, :occurredAt, :occurrenceWeight, 0, 0, NULL, :userId, :route, :pageUrl, :release, :environment,
           :now, :now
         )
         ON CONFLICT (fingerprint) DO UPDATE SET
           title = CASE
             WHEN EXCLUDED.last_seen_at >= error_monitoring_issues.last_seen_at
               THEN EXCLUDED.title ELSE error_monitoring_issues.title END,
           kind = CASE
             WHEN ${runtimeKindRankSql('EXCLUDED.kind')} > ${runtimeKindRankSql('error_monitoring_issues.kind')}
               THEN EXCLUDED.kind ELSE error_monitoring_issues.kind END,
           culprit = CASE
             WHEN EXCLUDED.last_seen_at >= error_monitoring_issues.last_seen_at
               THEN COALESCE(EXCLUDED.culprit, error_monitoring_issues.culprit)
             ELSE error_monitoring_issues.culprit END,
           severity = CASE
             WHEN ${severityRankSql('EXCLUDED.severity')} > ${severityRankSql('error_monitoring_issues.severity')}
               THEN EXCLUDED.severity ELSE error_monitoring_issues.severity END,
           status = CASE WHEN ${regressionConditionSql} THEN 'open'
                         ELSE error_monitoring_issues.status END,
           reopened_count = error_monitoring_issues.reopened_count
             + CASE WHEN ${regressionConditionSql} THEN 1 ELSE 0 END,
           last_regressed_at = CASE WHEN ${regressionConditionSql} THEN :now
                                    ELSE error_monitoring_issues.last_regressed_at END,
           status_changed_at = CASE WHEN ${regressionConditionSql} THEN :now
                                    ELSE error_monitoring_issues.status_changed_at END,
           status_changed_by_user_id = CASE WHEN ${regressionConditionSql} THEN NULL
                                            ELSE error_monitoring_issues.status_changed_by_user_id END,
           resolved_at = CASE WHEN ${regressionConditionSql} THEN NULL
                              ELSE error_monitoring_issues.resolved_at END,
           first_seen_at = LEAST(error_monitoring_issues.first_seen_at, EXCLUDED.first_seen_at),
           last_seen_at = GREATEST(error_monitoring_issues.last_seen_at, EXCLUDED.last_seen_at),
           occurrence_count = error_monitoring_issues.occurrence_count + :occurrenceWeight,
           last_user_id = CASE
             WHEN EXCLUDED.last_seen_at >= error_monitoring_issues.last_seen_at
               THEN COALESCE(EXCLUDED.last_user_id, error_monitoring_issues.last_user_id)
             ELSE error_monitoring_issues.last_user_id END,
           last_route = CASE
             WHEN EXCLUDED.last_seen_at >= error_monitoring_issues.last_seen_at
               THEN COALESCE(EXCLUDED.last_route, error_monitoring_issues.last_route)
             ELSE error_monitoring_issues.last_route END,
           last_page_url = CASE
             WHEN EXCLUDED.last_seen_at >= error_monitoring_issues.last_seen_at
               THEN COALESCE(EXCLUDED.last_page_url, error_monitoring_issues.last_page_url)
             ELSE error_monitoring_issues.last_page_url END,
           last_release = CASE
             WHEN EXCLUDED.last_seen_at >= error_monitoring_issues.last_seen_at
               THEN COALESCE(EXCLUDED.last_release, error_monitoring_issues.last_release)
             ELSE error_monitoring_issues.last_release END,
           last_environment = CASE
             WHEN EXCLUDED.last_seen_at >= error_monitoring_issues.last_seen_at
               THEN COALESCE(EXCLUDED.last_environment, error_monitoring_issues.last_environment)
             ELSE error_monitoring_issues.last_environment END,
           updated_at = :now
         RETURNING id,
                   occurrence_count,
                   reopened_count,
                   (xmax = 0) AS is_new,
                   (status = 'open' AND resolved_at IS NULL
                     AND last_regressed_at = :now AND xmax <> 0) AS regressed;`,
        {
          replacements: {
            fingerprint,
            source: event.source,
            kind: event.kind,
            title: event.message.slice(0, MAX_TITLE_LENGTH),
            normalizedMessage: normalizeErrorMessage(event.message),
            culprit,
            severity: event.level,
            occurrenceWeight,
            occurredAt: event.occurredAt,
            userId: event.userId ?? null,
            route: event.route ?? null,
            pageUrl: event.pageUrl ?? null,
            release: event.release ?? null,
            environment,
            now,
          },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const issueId = issueRows[0]?.id;
      if (issueId == null) throw new Error('Error monitoring issue upsert did not return an id.');

      await ErrorMonitoringOccurrence.create({
        eventId,
        clientEventId: event.clientEventId ?? null,
        issueId,
        source: event.source,
        kind: event.kind,
        level: event.level,
        eventCount: occurrenceWeight,
        errorName: event.errorName ?? null,
        message: event.message,
        stack: event.stack ? redactSensitiveText(event.stack) : null,
        componentStack: event.componentStack ? redactSensitiveText(event.componentStack) : null,
        occurredAt: event.occurredAt,
        receivedAt: now,
        userId: event.userId ?? null,
        sessionIdHash: hashPrivateIdentifier(event.sessionId),
        requestId: event.requestId ?? null,
        httpMethod: clampString(event.httpMethod, 12)?.toUpperCase() ?? null,
        httpUrlPath: event.httpUrl ?? null,
        httpStatus: event.httpStatus ?? null,
        durationMs: event.durationMs ?? null,
        responseSizeBytes: event.responseSizeBytes ?? null,
        pageUrlPath: event.pageUrl ?? null,
        route: event.route ?? null,
        release: event.release ?? null,
        environment,
        userAgent: event.userAgent ?? null,
        ipHash: hashPrivateIdentifier(event.ip),
        context: sanitizeMonitoringJson(event.context),
        tags: sanitizeMonitoringJson(event.tags),
        breadcrumbs: sanitizeMonitoringJson(event.breadcrumbs),
        createdAt: now,
      }, { transaction });

      if (event.userId != null) {
        await updateAffectedUserProjection(issueId, event.userId, event.occurredAt!, transaction);
      }

      return {
        eventId,
        issueId: String(issueId),
        duplicate: false,
        isNew: issueRows[0]?.is_new === true,
        regressed: issueRows[0]?.regressed === true,
        reopenedCount: Number(issueRows[0]?.reopened_count ?? 0),
      };
    });
    const alertEligible = event.source !== 'client' || event.userId != null;
    const shouldAlertForNewIssue = result.isNew && alertEligible && (
      event.level === 'fatal'
      || (event.httpStatus ?? 0) >= 500
      || (event.source !== 'client' && event.level === 'error')
    );
    if (alertEligible && (result.regressed || (!result.duplicate && shouldAlertForNewIssue))) {
      void sendAdminIssueAlert(event, result).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[error-monitoring] admin alert failed: ${redactSensitiveText(message).slice(0, 500)}`);
      });
    }
    return result;
  } catch (error) {
    if (event.clientEventId && error instanceof UniqueConstraintError) {
      const existing = await ErrorMonitoringOccurrence.findOne({
        where: { clientEventId: event.clientEventId },
        attributes: ['eventId', 'issueId'],
      });
      if (existing) {
        // Another transaction inserted this client id after our initial lookup.
        // Retry through the locked duplicate path so a larger coalesced weight
        // is applied as a positive delta instead of being silently discarded.
        return persistCapture(event);
      }
    }
    throw error;
  }
};

export const captureErrorEvent = async (event: CaptureEvent): Promise<CapturedEventResult> => persistCapture(event);

export const ingestClientErrorBatch = async (
  events: unknown,
  serverContext: ClientErrorServerContext,
): Promise<{
  accepted: number;
  rejected: number;
  eventIds: string[];
  errors: Array<{ index: number; message: string; retryable: boolean }>;
}> => {
  if (!Array.isArray(events)) throw new Error('events must be an array.');
  if (events.length === 0) throw new Error('events must contain at least one event.');
  if (events.length > MAX_BATCH_SIZE) throw new Error(`A maximum of ${MAX_BATCH_SIZE} events is allowed per batch.`);

  const eventIds: string[] = [];
  const errors: Array<{ index: number; message: string; retryable: boolean }> = [];
  for (let index = 0; index < events.length; index += 1) {
    let sanitized: CaptureEvent;
    try {
      sanitized = sanitizeClientEvent(events[index] as ClientErrorEventInput, serverContext);
      if (sanitized.source === 'client' && sanitized.stack) {
        sanitized.stack = symbolicateBrowserStack(sanitized.stack, sanitized.release);
      }
    } catch (error) {
      errors.push({ index, message: error instanceof Error ? error.message : 'Invalid event.', retryable: false });
      continue;
    }
    try {
      const captured = await persistCapture(sanitized);
      eventIds.push(captured.eventId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[error-monitoring] client event persistence failed: ${redactSensitiveText(message).slice(0, 500)}`);
      errors.push({ index, message: 'Event could not be stored.', retryable: true });
    }
  }
  return { accepted: eventIds.length, rejected: errors.length, eventIds, errors };
};

const parseBrowserReportTimestamp = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const browserReportToClientEvent = (
  raw: unknown,
  serverContext: ClientErrorServerContext,
  receivedAtMs: number,
): ClientErrorEventInput | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const report = raw as Record<string, unknown>;
  const legacyCsp = report['csp-report'];
  const isLegacyCsp = legacyCsp && typeof legacyCsp === 'object' && !Array.isArray(legacyCsp);
  const reportBody = isLegacyCsp
    ? legacyCsp as Record<string, unknown>
    : report.body && typeof report.body === 'object' && !Array.isArray(report.body)
      ? report.body as Record<string, unknown>
      : report;
  const reportType = isLegacyCsp
    ? 'csp-violation'
    : clampString(report.type, 64)?.toLowerCase() ?? 'browser-report';
  const isCsp = reportType === 'csp-violation' || reportType === 'csp_report';
  const directive = clampString(
    reportBody.effectiveDirective ?? reportBody['effective-directive']
      ?? reportBody.violatedDirective ?? reportBody['violated-directive'],
    200,
  );
  const blockedUrl = sanitizeUrlPath(reportBody.blockedURL ?? reportBody['blocked-uri']);
  const message = isCsp
    ? `CSP violation${directive ? `: ${directive}` : ''}${blockedUrl ? ` blocked ${blockedUrl}` : ''}`
    : `Browser report: ${reportType}`;
  const age = typeof report.age === 'number' ? report.age : Number.NaN;
  const explicitTimestamp = parseBrowserReportTimestamp(report.timestamp ?? reportBody.timestamp);
  const hasReportAge = Number.isFinite(age) && age >= 0;
  const occurredAtMs = explicitTimestamp
    ?? (hasReportAge
      ? receivedAtMs - Math.min(age, 7 * 24 * 60 * 60_000)
      : receivedAtMs);
  const occurredAt = new Date(occurredAtMs).toISOString();
  const level: ErrorMonitoringLevel = reportType === 'crash' ? 'fatal' : 'warning';
  const explicitReportId = clampString(report.id ?? report.reportId ?? reportBody.id, 256);
  // Reporting API deliveries do not always include a UUID. When they include a
  // stable id, timestamp, or age, derive an idempotency key from the sanitized
  // report plus its estimated generation time. Do not assign a permanent hash
  // to legacy reports with no time identity: identical real violations must
  // remain countable rather than being collapsed forever.
  const hasSafeIdentity = explicitReportId != null || explicitTimestamp != null || hasReportAge;
  const safeReportBody = sanitizeMonitoringJson(reportBody);
  const clientEventId = hasSafeIdentity
    ? `browser-report:${hashPrivateIdentifier(stableJsonStringify({
      explicitReportId,
      // Rounding absorbs small transport/clock jitter when `age` is recomputed
      // for a retry while still separating independently generated reports.
      generatedSecond: explicitReportId == null ? Math.floor(occurredAtMs / 1_000) : null,
      reportType,
      reportBody: safeReportBody,
      reporter: hashPrivateIdentifier(`${serverContext.userAgent ?? ''}|${serverContext.ip ?? ''}`),
    }))}`
    : null;

  return {
    eventId: clientEventId,
    // Native reports can be queued by the browser across sign-out/account
    // changes; delivery-time cookies must never claim their identity.
    capturedUserId: null,
    type: isCsp ? 'csp_violation' : 'manual',
    level,
    message,
    name: reportType,
    occurredAt,
    pageUrl: report.url ?? reportBody.documentURL ?? reportBody['document-uri'],
    route: reportBody.sourceFile ?? reportBody['source-file'],
    context: {
      reportType,
      directive,
      blockedUrl,
      disposition: reportBody.disposition,
      lineNumber: reportBody.lineNumber ?? reportBody['line-number'],
      columnNumber: reportBody.columnNumber ?? reportBody['column-number'],
      statusCode: reportBody.statusCode ?? reportBody['status-code'],
    },
  };
};

export const ingestBrowserReports = async (
  payload: unknown,
  serverContext: ClientErrorServerContext,
): Promise<{ accepted: number; rejected: number; retryableRejected: number }> => {
  const rawReports = Array.isArray(payload) ? payload.slice(0, MAX_BATCH_SIZE) : [payload];
  if (rawReports.length === 0) return { accepted: 0, rejected: 0, retryableRejected: 0 };
  let accepted = 0;
  let rejected = 0;
  let retryableRejected = 0;
  const receivedAtMs = Date.now();
  for (let index = 0; index < rawReports.length; index += 1) {
    const converted = browserReportToClientEvent(rawReports[index], serverContext, receivedAtMs);
    if (!converted) {
      rejected += 1;
      continue;
    }
    try {
      await persistCapture(sanitizeClientEvent(converted, serverContext));
      accepted += 1;
    } catch (error) {
      rejected += 1;
      retryableRejected += 1;
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[error-monitoring] browser report persistence failed: ${redactSensitiveText(message).slice(0, 500)}`);
    }
  }
  return { accepted, rejected, retryableRejected };
};

let pendingCaptures = 0;
let droppedCaptureCount = 0;
let spooledCaptureCount = 0;
let replayedCaptureCount = 0;
let replayRetainedCount = 0;
let replayMalformedCount = 0;
let spoolWriteFailureCount = 0;
let monitoringDiskSpool: ErrorMonitoringDiskSpool<CaptureEvent> | null = null;

const getMonitoringDiskSpool = (): ErrorMonitoringDiskSpool<CaptureEvent> => {
  if (!monitoringDiskSpool) {
    monitoringDiskSpool = new ErrorMonitoringDiskSpool<CaptureEvent>({
      ...resolveErrorMonitoringSpoolOptions(),
      onDiagnostic: (message) => logger.warn(`[error-monitoring] ${message}`),
    });
  }
  return monitoringDiskSpool;
};

const ensureDurableEventId = (event: CaptureEvent): CaptureEvent => ({
  ...event,
  clientEventId: sanitizeClientEventId(event.clientEventId) ?? `server-spool:${randomUUID()}`,
});

const spoolCaptureEvent = (event: CaptureEvent, durable = false): boolean => {
  try {
    const appended = getMonitoringDiskSpool().append(prepareCaptureEventForSpool(event), { durable });
    if (appended) {
      spooledCaptureCount += 1;
      return true;
    }
  } catch {
    // Count and report below without ever exposing the event payload.
  }
  spoolWriteFailureCount += 1;
  return false;
};

type NonBlockingCaptureOptions = {
  alreadySpooled?: boolean;
};

const captureWithoutBlocking = (
  rawEvent: CaptureEvent,
  options: NonBlockingCaptureOptions = {},
): void => {
  const event = ensureDurableEventId(rawEvent);
  if (pendingCaptures >= MAX_PENDING_CAPTURES) {
    const stored = options.alreadySpooled === true || spoolCaptureEvent(event);
    if (!stored) droppedCaptureCount += 1;
    const overflowCount = spooledCaptureCount + droppedCaptureCount;
    if (overflowCount === 1 || overflowCount % 100 === 0) {
      logger.warn(
        `[error-monitoring] capture queue full; spooled=${spooledCaptureCount} dropped=${droppedCaptureCount}`,
      );
    }
    return;
  }
  pendingCaptures += 1;
  void persistCapture(event)
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const stored = options.alreadySpooled === true || spoolCaptureEvent(event);
      if (!stored) droppedCaptureCount += 1;
      // Do not feed monitoring failures back into monitoring.
      logger.warn(
        `[error-monitoring] best-effort capture failed; spooled=${stored}: ${redactSensitiveText(message).slice(0, 500)}`,
      );
    })
    .finally(() => {
      pendingCaptures -= 1;
    });
};

export const replaySpooledErrorEvents = async (): Promise<ErrorMonitoringSpoolReplayResult> => {
  const result = await getMonitoringDiskSpool().replay(async (event) => {
    await persistCapture(event);
  });
  replayedCaptureCount += result.persisted;
  replayRetainedCount += result.retained;
  replayMalformedCount += result.malformed;
  return result;
};

const getRequestIdentity = (req: Request): { userId: number | null; requestId: string | null } => {
  const authenticated = req as AuthenticatedRequest;
  return {
    userId: authenticated.authContext?.id ?? null,
    requestId: getRequestContextValue('requestId'),
  };
};

const getRequestIp = (req: Request): string | null => req.ip
  || (typeof req.socket?.remoteAddress === 'string' ? req.socket.remoteAddress : null);

export const getExpressRoutePattern = (req: Request): string => {
  const routePath = typeof req.route?.path === 'string' ? req.route.path : null;
  if (routePath) {
    const baseUrl = typeof req.baseUrl === 'string' ? req.baseUrl.replace(/\/$/, '') : '';
    const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
    return `${baseUrl}${normalizedPath}` || '/';
  }
  return req.path || sanitizeUrlPath(req.originalUrl ?? req.url, 500) || '/';
};

export const captureBackendExceptionSafe = (
  error: unknown,
  req?: Request | null,
  options: { statusCode?: number; reference?: string; requestId?: string | null } = {},
): void => {
  if (req && /\/api\/client-errors(?:\/|$)/i.test(req.originalUrl ?? req.url)) {
    return;
  }
  const resolved = error instanceof Error ? error : new Error(String(error));
  const identity = req ? getRequestIdentity(req) : { userId: null, requestId: null };
  captureWithoutBlocking({
    source: 'server',
    kind: 'backend_exception',
    level: options.statusCode != null && options.statusCode < 500 ? 'warning' : 'error',
    message: resolved.message || resolved.name || 'Backend exception',
    errorName: resolved.name,
    stack: resolved.stack,
    occurredAt: new Date(),
    userId: identity.userId,
    requestId: options.requestId ?? identity.requestId,
    httpMethod: req?.method ?? null,
    httpUrl: req?.originalUrl ?? req?.url ?? null,
    httpStatus: options.statusCode ?? 500,
    route: req ? getExpressRoutePattern(req) : null,
    environment: process.env.NODE_ENV ?? null,
    release: process.env.APP_VERSION ?? process.env.GIT_COMMIT_SHA ?? null,
    userAgent: req?.get('user-agent') ?? null,
    ip: req ? getRequestIp(req) : null,
    context: options.reference ? { errorReference: options.reference } : null,
  });
};

export type HttpFailureCapture = {
  statusCode: number;
  durationMs?: number | null;
  responseSizeBytes?: number | null;
  responseMessage?: string | null;
  requestId?: string | null;
};

export const captureHttpFailureSafe = (req: Request, details: HttpFailureCapture): void => {
  if (!Number.isInteger(details.statusCode) || details.statusCode < 400) return;
  if (/\/api\/client-errors(?:\/|$)/i.test(req.originalUrl ?? req.url)) return;
  const requestedPath = sanitizeUrlPath(req.originalUrl ?? req.url, 500);
  const normalizedRequestedPath = requestedPath?.replace(/\/+$/, '') || '/';
  const authorizationHeader = req.headers?.authorization;
  const hasBearerCredential = typeof authorizationHeader === 'string'
    && /^Bearer\s+\S+/i.test(authorizationHeader.trim());
  const cookieToken = req.cookies?.token;
  const hasCookieCredential = typeof cookieToken === 'string'
    ? Boolean(cookieToken.trim())
    : Boolean(cookieToken);
  // A logged-out browser probes this endpoint to establish that there is no
  // current session. Its 401 is the endpoint's normal control flow, not an
  // operational failure. Credential-bearing 401s still indicate a stale or
  // invalid account/session state and remain observable on the backend.
  if (
    details.statusCode === 401
    && req.method.toUpperCase() === 'GET'
    && normalizedRequestedPath === '/api/session'
    && !hasBearerCredential
    && !hasCookieCredential
  ) return;
  const identity = getRequestIdentity(req);
  // Unknown 404 paths are attacker-controlled. A synthetic route prevents bot
  // scans from creating one issue group per random URL while retaining a
  // redacted sample only inside the bounded occurrence context.
  const matchedRoute = Boolean(req.route);
  const routePattern = matchedRoute ? getExpressRoutePattern(req) : '/__unmatched_route__';
  captureWithoutBlocking({
    source: 'request',
    kind: details.statusCode >= 500 ? 'http_5xx' : 'http_4xx',
    level: details.statusCode >= 500 ? 'error' : 'warning',
    // Response bodies can echo user-entered data. Status, method, and the
    // registered route are sufficient for grouping without copying it.
    message: `HTTP ${details.statusCode} ${req.method} ${routePattern}`,
    occurredAt: new Date(),
    userId: identity.userId,
    requestId: details.requestId ?? identity.requestId,
    httpMethod: req.method,
    httpUrl: routePattern,
    httpStatus: details.statusCode,
    durationMs: details.durationMs ?? null,
    responseSizeBytes: details.responseSizeBytes ?? null,
    route: routePattern,
    environment: process.env.NODE_ENV ?? null,
    release: process.env.APP_VERSION ?? process.env.GIT_COMMIT_SHA ?? null,
    userAgent: req.get('user-agent') ?? null,
    ip: getRequestIp(req),
    context: requestedPath && requestedPath !== routePattern ? { requestedPath } : null,
  });
};

export type ExternalRequestFailureCapture = {
  protocol: 'http' | 'https';
  method: string;
  host: string;
  path: string;
  statusCode?: number | null;
  errorCode?: string | null;
  durationMs?: number | null;
  requestId?: string | null;
  route?: string | null;
  userId?: number | null;
};

export const captureExternalRequestFailureSafe = (details: ExternalRequestFailureCapture): void => {
  const status = details.statusCode ?? null;
  const errorCode = clampString(details.errorCode, 80)?.toUpperCase() ?? null;
  if ((status == null || status < 400) && !errorCode) return;
  const isTimeout = errorCode === 'TIMEOUT' || errorCode === 'ETIMEDOUT' || errorCode === 'ESOCKETTIMEDOUT';
  const kind = isTimeout
    ? 'outbound_timeout'
    : errorCode
      ? 'outbound_network_error'
      : status != null && status >= 500
        ? 'outbound_http_5xx'
        : 'outbound_http_4xx';
  const safeHost = clampString(details.host, 255) ?? 'unknown-host';
  const safePath = sanitizeUrlPath(details.path) ?? '/';
  captureWithoutBlocking({
    source: 'server',
    kind,
    level: status != null && status < 500 && !errorCode ? 'warning' : 'error',
    message: errorCode
      ? `Outbound ${details.method.toUpperCase()} ${safeHost}${safePath} failed: ${errorCode}`
      : `Outbound ${details.method.toUpperCase()} ${safeHost}${safePath} returned HTTP ${status}`,
    occurredAt: new Date(),
    userId: details.userId ?? null,
    requestId: details.requestId ?? null,
    httpMethod: details.method,
    httpUrl: safePath,
    httpStatus: status,
    durationMs: details.durationMs ?? null,
    route: details.route ?? null,
    environment: process.env.NODE_ENV ?? null,
    release: process.env.APP_VERSION ?? process.env.GIT_COMMIT_SHA ?? null,
    context: { outboundHost: safeHost, protocol: details.protocol, errorCode },
  });
};

let fatalProcessEventObserved = false;

export const captureProcessErrorSafe = (
  kind: 'uncaught_exception'
    | 'unhandled_rejection'
    | 'bootstrap_failure'
    | 'logged_error'
    | 'logged_warning'
    | 'runtime_warning'
    | 'console_error'
    | 'console_warning',
  error: unknown,
): void => {
  const resolved = error instanceof Error ? error : new Error(String(error));
  const requestId = getRequestContextValue('requestId');
  const route = getRequestContextValue('routeKey');
  const userId = getRequestContextValue('userId') ?? null;
  const fatal = kind === 'uncaught_exception'
    || kind === 'unhandled_rejection'
    || kind === 'bootstrap_failure';
  const event = ensureDurableEventId({
    source: 'process',
    kind,
    level: kind === 'runtime_warning' || kind === 'logged_warning' || kind === 'console_warning'
      ? 'warning'
      : kind === 'logged_error' || kind === 'console_error'
        ? 'error'
        : 'fatal',
    message: resolved.message || kind,
    errorName: resolved.name,
    stack: resolved.stack,
    occurredAt: new Date(),
    userId,
    requestId,
    route,
    environment: process.env.NODE_ENV ?? null,
    release: process.env.APP_VERSION ?? process.env.GIT_COMMIT_SHA ?? null,
    context: { pid: process.pid, nodeVersion: process.version, correlatedRequest: Boolean(requestId) },
  });
  // Fatal process paths intentionally continue to exit. A synchronous append
  // is the only reliable opportunity to retain the event before termination.
  const alreadySpooled = fatal ? spoolCaptureEvent(event, true) : false;
  if (fatal && alreadySpooled) fatalProcessEventObserved = true;
  captureWithoutBlocking(event, { alreadySpooled });
};

type BootstrapTerminationOptions = {
  capture?: typeof captureProcessErrorSafe;
  beforeExit?: (error: Error) => void;
  exit?: (code: number) => never;
};

/**
 * Records startup failure synchronously, emits the caller's final log, and
 * then terminates so a process supervisor can restart the unavailable API.
 * Dependencies are injectable only to make the ordering safe to test.
 */
export const terminateAfterBootstrapFailure = (
  error: unknown,
  options: BootstrapTerminationOptions = {},
): never => {
  const resolved = error instanceof Error ? error : new Error(String(error));
  const capture = options.capture ?? captureProcessErrorSafe;
  const exit = options.exit ?? process.exit;
  capture('bootstrap_failure', resolved);
  try {
    options.beforeExit?.(resolved);
  } catch {
    // A logger/transport failure must not leave a process alive without a
    // listening socket after the durable monitoring capture already succeeded.
  }
  return exit(1);
};

/** Called from Node's synchronous exit event; never changes the exit behavior. */
export const captureAbnormalProcessExitSafe = (exitCode: number): void => {
  if (!Number.isInteger(exitCode) || exitCode === 0 || fatalProcessEventObserved) return;
  const event = ensureDurableEventId({
    source: 'process',
    kind: 'abnormal_process_exit',
    level: 'error',
    message: `Node process exited with code ${exitCode}`,
    occurredAt: new Date(),
    environment: process.env.NODE_ENV ?? null,
    release: process.env.APP_VERSION ?? process.env.GIT_COMMIT_SHA ?? null,
    context: { pid: process.pid, nodeVersion: process.version, exitCode },
  });
  if (!spoolCaptureEvent(event, true)) droppedCaptureCount += 1;
};

const parsePositiveInt = (value: unknown, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

const parseCsv = <T extends string>(value: unknown, allowed: readonly T[]): T[] => {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const allowedSet = new Set<string>(allowed);
  return Array.from(new Set(entries
    .map((entry) => String(entry).trim().toLowerCase())
    .filter((entry): entry is T => allowedSet.has(entry))));
};

const userSummaryAttributes = ['id', 'firstName', 'lastName', 'email'] as const;

const serializeUser = (user: User | null | undefined): Record<string, unknown> | null => user ? {
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
} : null;

export const serializeIssue = (issue: ErrorMonitoringIssue): Record<string, unknown> => ({
  id: String(issue.id),
  fingerprint: issue.fingerprint,
  source: issue.source,
  kind: issue.kind,
  title: issue.title,
  culprit: issue.culprit,
  severity: issue.severity,
  status: issue.status,
  firstSeenAt: issue.firstSeenAt,
  lastSeenAt: issue.lastSeenAt,
  occurrenceCount: Number(issue.occurrenceCount),
  affectedUserCount: Number(issue.affectedUserCount),
  reopenedCount: Number(issue.reopenedCount),
  lastRegressedAt: issue.lastRegressedAt,
  lastRoute: issue.lastRoute,
  lastPageUrl: issue.lastPageUrl,
  lastRelease: issue.lastRelease,
  lastEnvironment: issue.lastEnvironment,
  assignedToUserId: issue.assignedToUserId,
  assignedTo: serializeUser(issue.assignedTo),
  statusChangedAt: issue.statusChangedAt,
  resolvedAt: issue.resolvedAt,
});

export type IssueListQuery = {
  page?: unknown;
  limit?: unknown;
  pageSize?: unknown;
  status?: unknown;
  severity?: unknown;
  source?: unknown;
  kind?: unknown;
  q?: unknown;
  search?: unknown;
  release?: unknown;
  environment?: unknown;
  from?: unknown;
  to?: unknown;
  userId?: unknown;
  user?: unknown;
  pagePath?: unknown;
  sort?: unknown;
  direction?: unknown;
};

export const listErrorMonitoringIssues = async (query: IssueListQuery): Promise<{
  issues: Record<string, unknown>[];
  pagination: { page: number; limit: number; pageSize: number; total: number; totalPages: number };
}> => {
  const page = parsePositiveInt(query.page, 1, 100_000);
  const limit = parsePositiveInt(query.pageSize ?? query.limit, 25, 100);
  const status = parseCsv(query.status, ISSUE_STATUSES);
  const severity = parseCsv(query.severity, LEVELS);
  const source = parseCsv(query.source, SOURCES);
  const kinds = Array.from(new Set(
    (Array.isArray(query.kind) ? query.kind : typeof query.kind === 'string' ? query.kind.split(',') : [])
      .map((entry) => clampString(entry, 64)?.toLowerCase())
      .filter((entry): entry is string => Boolean(entry)),
  )).slice(0, 20);
  const search = clampString(query.q ?? query.search, 200);
  const release = clampString(query.release, 120);
  const environment = clampString(query.environment, 50);
  const pagePath = sanitizeUrlPath(query.pagePath);
  const userId = Number(query.userId ?? query.user);
  const from = parseOccurredAtForFilter(query.from);
  const to = parseOccurredAtForFilter(query.to, true);
  const where: Record<string | symbol, unknown> = {};
  const andConditions: Array<Record<string | symbol, unknown>> = [];
  if (status.length) where.status = { [Op.in]: status };
  if (severity.length) where.severity = { [Op.in]: severity };
  if (source.length) where.source = { [Op.in]: source };
  if (kinds.length) where.kind = { [Op.in]: kinds };
  if (release) where.lastRelease = release;
  if (environment) where.lastEnvironment = environment;
  if (pagePath) {
    andConditions.push({
      [Op.or]: [
        { lastPageUrl: { [Op.iLike]: `%${pagePath}%` } },
        { lastRoute: { [Op.iLike]: `%${pagePath}%` } },
      ],
    });
  }
  if (from || to) {
    where.lastSeenAt = {
      ...(from ? { [Op.gte]: from } : {}),
      ...(to ? { [Op.lte]: to } : {}),
    };
  }
  if (search) {
    const occurrenceExactSearch = sequelize.escape(search);
    const occurrenceSearch = sequelize.escape(`%${search}%`);
    andConditions.push({
      [Op.or]: [
        { title: { [Op.iLike]: `%${search}%` } },
        { culprit: { [Op.iLike]: `%${search}%` } },
        { fingerprint: { [Op.iLike]: `%${search}%` } },
        { lastRoute: { [Op.iLike]: `%${search}%` } },
        {
          id: {
            [Op.in]: sequelize.literal(`(
              SELECT occurrence.issue_id
                FROM error_monitoring_occurrences occurrence
               WHERE occurrence.client_event_id = ${occurrenceExactSearch}
                  OR occurrence.request_id = ${occurrenceExactSearch}
                  OR CAST(occurrence.event_id AS text) = ${occurrenceExactSearch}
                  OR occurrence.client_event_id ILIKE ${occurrenceSearch}
                  OR CAST(occurrence.event_id AS text) ILIKE ${occurrenceSearch}
                  OR occurrence.request_id ILIKE ${occurrenceSearch}
            )`),
          },
        },
      ],
    });
  }
  if (Number.isInteger(userId) && userId > 0) {
    where.id = {
      [Op.in]: sequelize.literal(`(
        SELECT affected.issue_id
          FROM error_monitoring_affected_users affected
         WHERE affected.user_id = ${Math.trunc(userId)}
      )`),
    };
  }
  if (andConditions.length > 0) where[Op.and] = andConditions;

  const sortMap: Record<string, string> = {
    lastSeenAt: 'lastSeenAt',
    firstSeenAt: 'firstSeenAt',
    occurrenceCount: 'occurrenceCount',
    affectedUserCount: 'affectedUserCount',
  };
  const requestedSort = clampString(query.sort, 40) ?? 'lastSeenAt';
  const sort = sortMap[requestedSort] ?? 'lastSeenAt';
  const direction = String(query.direction).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const order: Order = requestedSort === 'severity'
    ? [[literal(severityRankSql('"ErrorMonitoringIssue"."severity"')), direction], ['id', 'DESC']]
    : [[sort, direction], ['id', 'DESC']];

  const { rows, count } = await ErrorMonitoringIssue.findAndCountAll({
    where,
    include: [{ model: User, as: 'assignedTo', attributes: [...userSummaryAttributes], required: false }],
    order,
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });
  return {
    issues: rows.map(serializeIssue),
    pagination: { page, limit, pageSize: limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) },
  };
};

const parseOccurredAtForFilter = (value: unknown, endOfDay = false): Date | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
};

const serializeOccurrence = (occurrence: ErrorMonitoringOccurrence): Record<string, unknown> => ({
  id: String(occurrence.id),
  eventId: occurrence.eventId,
  clientEventId: occurrence.clientEventId,
  source: occurrence.source,
  kind: occurrence.kind,
  level: occurrence.level,
  eventCount: Number(occurrence.eventCount),
  errorName: occurrence.errorName,
  message: occurrence.message,
  stack: occurrence.stack,
  componentStack: occurrence.componentStack,
  occurredAt: occurrence.occurredAt,
  receivedAt: occurrence.receivedAt,
  user: serializeUser(occurrence.user),
  requestId: occurrence.requestId,
  httpMethod: occurrence.httpMethod,
  httpUrlPath: occurrence.httpUrlPath,
  httpStatus: occurrence.httpStatus,
  durationMs: occurrence.durationMs == null ? null : Number(occurrence.durationMs),
  responseSizeBytes: occurrence.responseSizeBytes == null ? null : Number(occurrence.responseSizeBytes),
  pageUrlPath: occurrence.pageUrlPath,
  route: occurrence.route,
  release: occurrence.release,
  environment: occurrence.environment,
  userAgent: occurrence.userAgent,
  context: occurrence.context,
  tags: occurrence.tags,
  breadcrumbs: occurrence.breadcrumbs,
});

const serializeNote = (note: ErrorMonitoringNote): Record<string, unknown> => ({
  id: String(note.id),
  body: note.body,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
  author: serializeUser(note.author),
});

export const getErrorMonitoringIssue = async (
  issueId: number,
  query: { occurrencePage?: unknown; occurrenceLimit?: unknown; occurrencePageSize?: unknown },
): Promise<{
  issue: Record<string, unknown>;
  occurrences: Record<string, unknown>[];
  notes: Record<string, unknown>[];
  pagination: { page: number; limit: number; pageSize: number; total: number; totalPages: number };
} | null> => {
  const issue = await ErrorMonitoringIssue.findByPk(issueId, {
    include: [{ model: User, as: 'assignedTo', attributes: [...userSummaryAttributes], required: false }],
  });
  if (!issue) return null;
  const page = parsePositiveInt(query.occurrencePage, 1, 100_000);
  const limit = parsePositiveInt(query.occurrencePageSize ?? query.occurrenceLimit, 25, 100);
  const [{ rows, count }, notes] = await Promise.all([
    ErrorMonitoringOccurrence.findAndCountAll({
      where: { issueId },
      include: [{ model: User, as: 'user', attributes: [...userSummaryAttributes], required: false }],
      order: [['occurredAt', 'DESC'], ['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      distinct: true,
    }),
    ErrorMonitoringNote.findAll({
      where: { issueId },
      include: [{ model: User, as: 'author', attributes: [...userSummaryAttributes], required: false }],
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
    }),
  ]);
  return {
    issue: serializeIssue(issue),
    occurrences: rows.map(serializeOccurrence),
    notes: notes.map(serializeNote),
    pagination: { page, limit, pageSize: limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) },
  };
};

export const updateErrorMonitoringIssue = async (
  issueId: number,
  changes: { status?: unknown; severity?: unknown; assignedToUserId?: unknown },
  actorUserId: number,
): Promise<Record<string, unknown> | null> => {
  const hasSupportedChange = changes.status !== undefined
    || changes.severity !== undefined
    || changes.assignedToUserId !== undefined;
  if (!hasSupportedChange) throw new Error('No supported changes were provided.');

  return sequelize.transaction(async (transaction: Transaction) => {
    const issue = await ErrorMonitoringIssue.findByPk(issueId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!issue) return null;
    const now = new Date();
    const update: Record<string, unknown> = {};

    if (changes.status !== undefined) {
      const status = clampString(changes.status, 20)?.toLowerCase();
      if (!status || !ISSUE_STATUSES.includes(status as ErrorMonitoringStatus)) {
        throw new Error('Invalid issue status.');
      }
      // A repeated save of "resolved" must preserve the original boundary;
      // otherwise a delayed occurrence from between the two saves would be
      // incorrectly treated as pre-resolution and never reopen the issue.
      if (status !== issue.status) {
        update.status = status;
        update.statusChangedAt = now;
        update.statusChangedByUserId = actorUserId;
        update.resolvedAt = status === 'resolved' ? now : null;
      } else if (status === 'resolved' && issue.resolvedAt == null) {
        // Repair legacy/incomplete rows once without moving an existing boundary.
        update.resolvedAt = now;
      }
    }
    if (changes.severity !== undefined) {
      const severity = clampString(changes.severity, 16)?.toLowerCase();
      if (!severity || !LEVELS.includes(severity as ErrorMonitoringLevel)) {
        throw new Error('Invalid issue severity.');
      }
      if (severity !== issue.severity) update.severity = severity;
    }
    if (changes.assignedToUserId !== undefined) {
      const assignee = changes.assignedToUserId == null || changes.assignedToUserId === ''
        ? null
        : Number(changes.assignedToUserId);
      if (assignee != null && (!Number.isInteger(assignee) || assignee <= 0)) {
        throw new Error('Invalid assignee.');
      }
      if (assignee != null && !(await User.findByPk(assignee, { attributes: ['id'], transaction }))) {
        throw new Error('Assignee not found.');
      }
      if (assignee !== issue.assignedToUserId) update.assignedToUserId = assignee;
    }

    if (Object.keys(update).length > 0) {
      update.updatedAt = now;
      await issue.update(update, { transaction });
    }
    const refreshed = await ErrorMonitoringIssue.findByPk(issueId, {
      include: [{ model: User, as: 'assignedTo', attributes: [...userSummaryAttributes], required: false }],
      transaction,
    });
    return refreshed ? serializeIssue(refreshed) : null;
  });
};

export const addErrorMonitoringNote = async (
  issueId: number,
  bodyValue: unknown,
  actorUserId: number,
): Promise<Record<string, unknown> | null> => {
  const body = clampAndRedact(bodyValue, MAX_NOTE_LENGTH);
  if (!body) throw new Error('Note body is required.');
  if (!(await ErrorMonitoringIssue.findByPk(issueId, { attributes: ['id'] }))) return null;
  const now = new Date();
  const note = await ErrorMonitoringNote.create({
    issueId,
    authorUserId: actorUserId,
    body,
    createdAt: now,
    updatedAt: now,
  });
  const loaded = await ErrorMonitoringNote.findByPk(note.id, {
    include: [{ model: User, as: 'author', attributes: [...userSummaryAttributes], required: false }],
  });
  return loaded ? serializeNote(loaded) : null;
};

export const deleteErrorMonitoringNote = async (
  issueId: number,
  noteId: number,
): Promise<boolean> => (await ErrorMonitoringNote.destroy({ where: { id: noteId, issueId } })) > 0;

export const getErrorMonitoringSummary = async (): Promise<Record<string, unknown>> => {
  const [statusRows, severityRows, sourceRows, occurrenceRows] = await Promise.all([
    sequelize.query<{ status: string; count: string }>(
      'SELECT status, COUNT(*)::bigint AS count FROM error_monitoring_issues GROUP BY status;',
      { type: QueryTypes.SELECT },
    ),
    sequelize.query<{ severity: string; count: string }>(
      `SELECT severity, COUNT(*)::bigint AS count
         FROM error_monitoring_issues
        WHERE status IN ('open', 'investigating')
        GROUP BY severity;`,
      { type: QueryTypes.SELECT },
    ),
    sequelize.query<{ source: string; count: string }>(
      `SELECT source, COUNT(*)::bigint AS count
         FROM error_monitoring_issues
        WHERE status IN ('open', 'investigating')
        GROUP BY source ORDER BY count DESC;`,
      { type: QueryTypes.SELECT },
    ),
    sequelize.query<{
      last_24_hours: string;
      last_7_days: string;
      samples_last_24_hours: string;
      samples_last_7_days: string;
    }>(
      `SELECT
         COALESCE(SUM(event_count) FILTER (WHERE occurred_at >= NOW() - INTERVAL '24 hours'), 0)::bigint AS last_24_hours,
         COALESCE(SUM(event_count) FILTER (WHERE occurred_at >= NOW() - INTERVAL '7 days'), 0)::bigint AS last_7_days,
         COUNT(*) FILTER (WHERE occurred_at >= NOW() - INTERVAL '24 hours')::bigint AS samples_last_24_hours,
         COUNT(*) FILTER (WHERE occurred_at >= NOW() - INTERVAL '7 days')::bigint AS samples_last_7_days
       FROM error_monitoring_occurrences;`,
      { type: QueryTypes.SELECT },
    ),
  ]);
  const statusMap = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count)]));
  const severityMap = Object.fromEntries(severityRows.map((row) => [row.severity, Number(row.count)]));
  return {
    counts: {
      total: Object.values(statusMap).reduce((total, count) => total + count, 0),
      open: statusMap.open ?? 0,
      investigating: statusMap.investigating ?? 0,
      resolved: statusMap.resolved ?? 0,
      ignored: statusMap.ignored ?? 0,
    },
    severity: {
      warning: severityMap.warning ?? 0,
      error: severityMap.error ?? 0,
      fatal: severityMap.fatal ?? 0,
    },
    sources: sourceRows.map((row) => ({ source: row.source, count: Number(row.count) })),
    occurrences: {
      last24Hours: Number(occurrenceRows[0]?.last_24_hours ?? 0),
      last7Days: Number(occurrenceRows[0]?.last_7_days ?? 0),
      samplesLast24Hours: Number(occurrenceRows[0]?.samples_last_24_hours ?? 0),
      samplesLast7Days: Number(occurrenceRows[0]?.samples_last_7_days ?? 0),
    },
    generatedAt: new Date().toISOString(),
  };
};

export const cleanupErrorMonitoringOccurrences = async (
  retentionDays = Number(process.env.ERROR_MONITORING_RETENTION_DAYS) || DEFAULT_OCCURRENCE_RETENTION_DAYS,
): Promise<{
  deletedOccurrences: number;
  deletedAffectedUsers: number;
  retentionDays: number;
  skipped?: boolean;
  reason?: 'cleanup_already_running';
}> => {
  const safeDays = Number.isFinite(retentionDays)
    ? Math.max(7, Math.min(Math.floor(retentionDays), 365))
    : DEFAULT_OCCURRENCE_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60_000);
  return sequelize.transaction(async (transaction: Transaction) => {
    const lockRows = await sequelize.query<{ acquired: boolean | 't' | 'f' }>(
      // The exclusive form conflicts with persistence's shared lock, preventing
      // inserts while retained-data projections are rebuilt. `try` keeps each
      // PM2 worker from waiting behind another cleanup or a busy ingest burst.
      `SELECT pg_try_advisory_xact_lock(
         ${ERROR_MONITORING_ADVISORY_LOCK_NAMESPACE},
         ${ERROR_MONITORING_ADVISORY_LOCK_KEY}
       ) AS acquired;`,
      { type: QueryTypes.SELECT, transaction },
    );
    const acquired = lockRows[0]?.acquired === true || lockRows[0]?.acquired === 't';
    if (!acquired) {
      return {
        deletedOccurrences: 0,
        deletedAffectedUsers: 0,
        retentionDays: safeDays,
        skipped: true,
        reason: 'cleanup_already_running' as const,
      };
    }

    const deletedOccurrences = await ErrorMonitoringOccurrence.destroy({
      where: { occurredAt: { [Op.lt]: cutoff } },
      transaction,
    });

    // The association table is a retained-data projection. Rebuild its date
    // bounds and delete pairs whose final occurrence expired, otherwise the UI
    // would continue reporting users who no longer have any retained evidence.
    await sequelize.query(
      `INSERT INTO error_monitoring_affected_users (issue_id, user_id, first_seen_at, last_seen_at)
       SELECT issue_id, user_id, MIN(occurred_at), MAX(occurred_at)
         FROM error_monitoring_occurrences
        WHERE user_id IS NOT NULL
        GROUP BY issue_id, user_id
       ON CONFLICT (issue_id, user_id) DO UPDATE SET
         first_seen_at = EXCLUDED.first_seen_at,
         last_seen_at = EXCLUDED.last_seen_at;`,
      { transaction },
    );
    const deletedAssociations = await sequelize.query<{ issue_id: number | string }>(
      `DELETE FROM error_monitoring_affected_users affected
        WHERE NOT EXISTS (
          SELECT 1
            FROM error_monitoring_occurrences occurrence
           WHERE occurrence.issue_id = affected.issue_id
             AND occurrence.user_id = affected.user_id
        )
      RETURNING affected.issue_id;`,
      { type: QueryTypes.SELECT, transaction },
    );

    // Keep issue-level user projections consistent with the surviving samples.
    // last_user_id intentionally means the latest *authenticated* affected user;
    // an anonymous sample does not erase useful attribution from a prior sample.
    await sequelize.query(
      `UPDATE error_monitoring_issues issue
          SET affected_user_count = (
                SELECT COUNT(*)::integer
                  FROM error_monitoring_affected_users affected
                 WHERE affected.issue_id = issue.id
              ),
              last_user_id = (
                SELECT occurrence.user_id
                  FROM error_monitoring_occurrences occurrence
                 WHERE occurrence.issue_id = issue.id
                   AND occurrence.user_id IS NOT NULL
                 ORDER BY occurrence.occurred_at DESC, occurrence.id DESC
                 LIMIT 1
              );`,
      { transaction },
    );

    return {
      deletedOccurrences,
      deletedAffectedUsers: deletedAssociations.length,
      retentionDays: safeDays,
    };
  });
};

export const getErrorMonitoringQueueStats = (): {
  pending: number;
  dropped: number;
  spool: {
    queuedRecords: number;
    queuedFiles: number;
    queuedBytes: number;
    written: number;
    replayed: number;
    retainedForRetry: number;
    malformedDiscarded: number;
    writeFailures: number;
    capacityEvictedRecords: number;
    capacityEvictedBytes: number;
  };
} => {
  const stats = getMonitoringDiskSpool().getStats();
  return {
    pending: pendingCaptures,
    dropped: droppedCaptureCount + stats.evictedRecords,
    spool: {
      queuedRecords: stats.records,
      queuedFiles: stats.files,
      queuedBytes: stats.bytes,
      written: spooledCaptureCount,
      replayed: replayedCaptureCount,
      retainedForRetry: replayRetainedCount,
      malformedDiscarded: replayMalformedCount,
      writeFailures: spoolWriteFailureCount,
      capacityEvictedRecords: stats.evictedRecords,
      capacityEvictedBytes: stats.evictedBytes,
    },
  };
};
