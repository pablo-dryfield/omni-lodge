import http, { type ClientRequest, type IncomingMessage, type RequestOptions as HttpRequestOptions } from 'http';
import https from 'https';
import { URL } from 'url';
import { getRequestContextValue } from './requestContextService.js';
import logger from '../utils/logger.js';
import { captureExternalRequestFailureSafe } from './errorMonitoringService.js';

type ExternalCallAggregate = {
  protocol: 'http' | 'https';
  method: string;
  host: string;
  pathLabel: string;
  count: number;
  slowCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastDurationMs: number;
  lastStatusCode: number | null;
  lastErrorCode: string | null;
  lastSeenAtMs: number;
  durationWindowMs: number[];
};

type RecentSlowExternalCall = {
  startedAt: string;
  durationMs: number;
  protocol: 'http' | 'https';
  method: string;
  host: string;
  path: string;
  statusCode: number | null;
  errorCode: string | null;
  requestId: string | null;
  routeKey: string | null;
  userId: number | null;
  userTypeId: number | null;
  firstName: string | null;
  lastName: string | null;
  roleName: string | null;
};

type ActiveExternalCall = {
  requestId: string | null;
  routeKey: string | null;
  userId: number | null;
  userTypeId: number | null;
  firstName: string | null;
  lastName: string | null;
  roleName: string | null;
  method: string;
  protocol: 'http' | 'https';
  host: string;
  path: string;
  startedAt: string;
  startedAtMs: number;
};

type RouteExternalAggregate = {
  routeKey: string;
  requestCount: number;
  totalExternalDurationMs: number;
  maxExternalDurationMs: number;
  endpointCounts: Map<string, number>;
};

export type ExternalRequestDiagnosticsSnapshot = {
  totalCapturedSinceStart: number;
  slowExternalCallThresholdMs: number;
  topEndpoints: Array<{
    protocol: 'http' | 'https';
    method: string;
    host: string;
    pathLabel: string;
    count: number;
    slowCount: number;
    averageDurationMs: number;
    p95DurationMs: number;
    maxDurationMs: number;
    lastDurationMs: number;
    lastStatusCode: number | null;
    lastErrorCode: string | null;
    lastSeenAt: string;
  }>;
  recentSlowCalls: RecentSlowExternalCall[];
  activeCalls: Array<ActiveExternalCall & { runningForMs: number }>;
  routeCorrelations: Array<{
    routeKey: string;
    requestCount: number;
    averageExternalDurationMs: number;
    maxExternalDurationMs: number;
    topEndpoints: string[];
  }>;
};

export type NormalizedTarget = {
  protocol: 'http' | 'https';
  method: string;
  host: string;
  path: string;
  pathLabel: string;
};

type HttpRequestInput = string | URL | HttpRequestOptions | undefined;
type FetchRequestInput = Parameters<typeof fetch>[0];

const WINDOW_LIMIT = 200;
const RECENT_LIMIT = 100;
const ACTIVE_LIMIT = 50;
const DEFAULT_SLOW_EXTERNAL_CALL_MS = 800;

const round = (value: number, digits = 2): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const percentile = (values: number[], percentileValue: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return round(sorted[index] ?? 0);
};

const pushLimited = <T>(target: T[], entry: T, limit: number): void => {
  target.push(entry);
  if (target.length > limit) {
    target.splice(0, target.length - limit);
  }
};

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const pathWithoutQuery = (value: string): string =>
  collapseWhitespace(value).split('?')[0] || '/';

const normalizePathLabel = (value: string): string =>
  pathWithoutQuery(value)
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:uuid')
    .replace(/\/[A-Za-z0-9_-]{14,}(?=\/|$)/g, '/:token') || '/';

const resolvePort = (options: URL | HttpRequestOptions, protocol: 'http' | 'https'): string => {
  if (options instanceof URL) {
    return options.port || (protocol === 'https' ? '443' : '80');
  }
  if (typeof options.port === 'number') {
    return String(options.port);
  }
  if (typeof options.port === 'string' && options.port.trim().length > 0) {
    return options.port.trim();
  }
  return protocol === 'https' ? '443' : '80';
};

export const normalizeExternalHttpTarget = (
  protocol: 'http' | 'https',
  input: HttpRequestInput,
  overrideOptions?: HttpRequestOptions,
): NormalizedTarget | null => {
  try {
    if (input instanceof URL) {
      const host = input.hostname;
      const method = typeof overrideOptions?.method === 'string' && overrideOptions.method.trim()
        ? overrideOptions.method.toUpperCase()
        : 'GET';
      const path = input.pathname || '/';
      return {
        protocol,
        method,
        host,
        path,
        pathLabel: normalizePathLabel(path),
      };
    }

    if (typeof input === 'string') {
      const url = new URL(input);
      const method = typeof overrideOptions?.method === 'string' && overrideOptions.method.trim()
        ? overrideOptions.method.toUpperCase()
        : 'GET';
      const path = url.pathname || '/';
      return {
        protocol,
        method,
        host: url.hostname,
        path,
        pathLabel: normalizePathLabel(path),
      };
    }

    if (input && typeof input === 'object') {
      const requestOptions = input as HttpRequestOptions & {
        pathname?: string;
        search?: string;
      };
      const method = typeof input.method === 'string' && input.method.trim().length > 0 ? input.method.toUpperCase() : 'GET';
      const path = pathWithoutQuery(
        `${requestOptions.path || requestOptions.pathname || '/'}${requestOptions.search || ''}`,
      );
      const hostname =
        typeof requestOptions.hostname === 'string' && requestOptions.hostname.trim().length > 0
          ? requestOptions.hostname.trim()
          : typeof requestOptions.host === 'string' && requestOptions.host.trim().length > 0
            ? requestOptions.host.split(':')[0]
            : 'unknown-host';
      const port = resolvePort(requestOptions, protocol);
      const needsPort = !((protocol === 'https' && port === '443') || (protocol === 'http' && port === '80'));
      return {
        protocol,
        method,
        host: needsPort ? `${hostname}:${port}` : hostname,
        path,
        pathLabel: normalizePathLabel(path),
      };
    }
  } catch {
    return null;
  }

  return null;
};

const normalizeFetchTarget = (
  input: FetchRequestInput,
  init?: RequestInit,
): NormalizedTarget | null => {
  try {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const url = new URL(isRequest ? (input as Request).url : String(input));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const protocol = url.protocol === 'https:' ? 'https' : 'http';
    const method = String(init?.method ?? (isRequest ? (input as Request).method : 'GET')).toUpperCase();
    const defaultPort = protocol === 'https' ? '443' : '80';
    const host = url.port && url.port !== defaultPort ? `${url.hostname}:${url.port}` : url.hostname;
    const path = url.pathname || '/';
    return { protocol, method, host, path, pathLabel: normalizePathLabel(path) };
  } catch {
    return null;
  }
};

export const classifyExternalRequestClose = (
  responseReceived: boolean,
  timeoutObserved = false,
): string | null => {
  if (responseReceived) return null;
  return timeoutObserved ? 'TIMEOUT' : 'REQUEST_CLOSED';
};

export const classifyExternalRequestError = (
  errorCode: string | undefined,
  errorName: string | undefined,
  timeoutObserved: boolean,
): string => errorCode ?? (timeoutObserved ? 'TIMEOUT' : errorName ?? 'ERROR');

export const classifyExternalResponseClose = (complete: boolean): string | null =>
  complete ? null : 'INCOMPLETE_RESPONSE';

export class ExternalRequestDiagnosticsService {
  private readonly slowExternalCallThresholdMs =
    Number(process.env.PERFORMANCE_SLOW_EXTERNAL_CALL_MS) || DEFAULT_SLOW_EXTERNAL_CALL_MS;
  private readonly aggregates = new Map<string, ExternalCallAggregate>();
  private readonly recentSlowCalls: RecentSlowExternalCall[] = [];
  private readonly activeCalls = new Map<ClientRequest, ActiveExternalCall>();
  private readonly routeAggregates = new Map<string, RouteExternalAggregate>();
  private installed = false;
  private totalCapturedSinceStart = 0;

  install(): void {
    if (this.installed) {
      return;
    }
    this.patchModule(http, 'http');
    this.patchModule(https, 'https');
    this.patchFetch();
    this.installed = true;
  }

  getSnapshot(): ExternalRequestDiagnosticsSnapshot {
    return {
      totalCapturedSinceStart: this.totalCapturedSinceStart,
      slowExternalCallThresholdMs: this.slowExternalCallThresholdMs,
      topEndpoints: [...this.aggregates.values()]
        .map((aggregate) => ({
          protocol: aggregate.protocol,
          method: aggregate.method,
          host: aggregate.host,
          pathLabel: aggregate.pathLabel,
          count: aggregate.count,
          slowCount: aggregate.slowCount,
          averageDurationMs: round(aggregate.totalDurationMs / Math.max(aggregate.count, 1)),
          p95DurationMs: percentile(aggregate.durationWindowMs, 95),
          maxDurationMs: round(aggregate.maxDurationMs),
          lastDurationMs: round(aggregate.lastDurationMs),
          lastStatusCode: aggregate.lastStatusCode,
          lastErrorCode: aggregate.lastErrorCode,
          lastSeenAt: new Date(aggregate.lastSeenAtMs).toISOString(),
        }))
        .sort(
          (left, right) =>
            right.p95DurationMs - left.p95DurationMs ||
            right.averageDurationMs - left.averageDurationMs ||
            right.count - left.count,
        )
        .slice(0, 20),
      recentSlowCalls: [...this.recentSlowCalls].reverse(),
      activeCalls: [...this.activeCalls.values()]
        .map((call) => ({
          ...call,
          runningForMs: round(Date.now() - call.startedAtMs),
        }))
        .sort((left, right) => right.runningForMs - left.runningForMs)
        .slice(0, ACTIVE_LIMIT),
      routeCorrelations: [...this.routeAggregates.values()]
        .map((aggregate) => ({
          routeKey: aggregate.routeKey,
          requestCount: aggregate.requestCount,
          averageExternalDurationMs: round(aggregate.totalExternalDurationMs / Math.max(aggregate.requestCount, 1)),
          maxExternalDurationMs: round(aggregate.maxExternalDurationMs),
          topEndpoints: [...aggregate.endpointCounts.entries()]
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 5)
            .map(([label]) => label),
        }))
        .sort(
          (left, right) =>
            right.averageExternalDurationMs - left.averageExternalDurationMs ||
            right.maxExternalDurationMs - left.maxExternalDurationMs ||
            right.requestCount - left.requestCount,
        )
        .slice(0, 20),
    };
  }

  private patchModule(moduleRef: typeof http | typeof https, protocol: 'http' | 'https'): void {
    const requestFn = moduleRef.request as typeof http.request & { __omniInstrumented?: boolean };
    if (requestFn.__omniInstrumented) {
      return;
    }

    const originalRequest = moduleRef.request.bind(moduleRef);
    const service = this;

    const instrumentedRequest = function instrumentedRequest(
      ...args: Parameters<typeof http.request>
    ): ClientRequest {
      const request = originalRequest(...args);
      const overrideOptions = args[1] && typeof args[1] === 'object'
        ? args[1] as HttpRequestOptions
        : undefined;
      service.observeRequest(request, protocol, args[0], overrideOptions);
      return request;
    };

    const instrumentedGet = function instrumentedGet(
      ...args: Parameters<typeof http.get>
    ): ClientRequest {
      const request = instrumentedRequest(...(args as Parameters<typeof http.request>));
      request.end();
      return request;
    };

    moduleRef.request = instrumentedRequest as typeof moduleRef.request;
    moduleRef.get = instrumentedGet as typeof moduleRef.get;
    (moduleRef.request as typeof http.request & { __omniInstrumented?: boolean }).__omniInstrumented = true;
    (moduleRef.get as typeof http.get & { __omniInstrumented?: boolean }).__omniInstrumented = true;
  }

  private patchFetch(): void {
    const fetchRef = globalThis.fetch as typeof fetch & { __omniInstrumented?: boolean };
    if (typeof fetchRef !== 'function' || fetchRef.__omniInstrumented) return;
    const originalFetch = fetchRef.bind(globalThis);
    const service = this;
    const instrumentedFetch = async function instrumentedFetch(
      input: FetchRequestInput,
      init?: RequestInit,
    ): Promise<Response> {
      const target = normalizeFetchTarget(input, init);
      if (!target) return originalFetch(input, init);
      const startedAtMs = Date.now();
      const call = {
        ...target,
        requestId: getRequestContextValue('requestId'),
        routeKey: getRequestContextValue('routeKey'),
        userId: getRequestContextValue('userId') ?? null,
        userTypeId: getRequestContextValue('userTypeId') ?? null,
        firstName: getRequestContextValue('firstName') ?? null,
        lastName: getRequestContextValue('lastName') ?? null,
        roleName: getRequestContextValue('roleName') ?? null,
        startedAt: new Date(startedAtMs).toISOString(),
      };
      try {
        const response = await originalFetch(input, init);
        service.recordCompletedCall(call, Date.now() - startedAtMs, response.status, null);
        return response;
      } catch (error) {
        const failure = error as Error & { code?: string; cause?: { code?: string } };
        service.recordCompletedCall(
          call,
          Date.now() - startedAtMs,
          null,
          failure.code ?? failure.cause?.code ?? failure.name ?? 'FETCH_ERROR',
        );
        throw error;
      }
    } as typeof fetch & { __omniInstrumented?: boolean };
    instrumentedFetch.__omniInstrumented = true;
    globalThis.fetch = instrumentedFetch;
  }

  private observeRequest(
    request: ClientRequest,
    protocol: 'http' | 'https',
    input: HttpRequestInput,
    overrideOptions?: HttpRequestOptions,
  ): void {
    const target = normalizeExternalHttpTarget(protocol, input, overrideOptions);
    if (!target) {
      return;
    }

    const startedAtMs = Date.now();
    const requestId = getRequestContextValue('requestId');
    const routeKey = getRequestContextValue('routeKey');
    const userId = getRequestContextValue('userId') ?? null;
    const userTypeId = getRequestContextValue('userTypeId') ?? null;
    const firstName = getRequestContextValue('firstName') ?? null;
    const lastName = getRequestContextValue('lastName') ?? null;
    const roleName = getRequestContextValue('roleName') ?? null;
    this.activeCalls.set(request, {
      requestId,
      routeKey,
      userId,
      userTypeId,
      firstName,
      lastName,
      roleName,
      method: target.method,
      protocol: target.protocol,
      host: target.host,
      path: target.path,
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
    });

    let completed = false;
    let responseReceived = false;
    let timeoutObserved = false;
    const finalize = (response: IncomingMessage | null, errorCode: string | null): void => {
      if (completed) {
        return;
      }
      completed = true;
      this.activeCalls.delete(request);

      const durationMs = Date.now() - startedAtMs;
      this.recordCompletedCall(
        {
          ...target,
          requestId,
          routeKey,
          userId,
          userTypeId,
          firstName,
          lastName,
          roleName,
          startedAt: new Date(startedAtMs).toISOString(),
        },
        durationMs,
        response?.statusCode ?? null,
        errorCode,
      );
    };

    request.on('response', (response) => {
      responseReceived = true;
      response.on('end', () => finalize(response, null));
      response.on('aborted', () => finalize(response, 'INCOMPLETE_RESPONSE'));
      response.on('close', () => finalize(response, classifyExternalResponseClose(response.complete)));
    });
    // Successful protocol switches (for example Puppeteer's WebSocket/CDP
    // connection) emit `upgrade` rather than `response`. CONNECT tunnels use
    // the analogous `connect` event. Both have received valid response
    // headers and must not become REQUEST_CLOSED issues when the HTTP request
    // object subsequently closes.
    request.on('upgrade', (response) => {
      responseReceived = true;
      finalize(response, null);
    });
    request.on('connect', (response) => {
      responseReceived = true;
      finalize(response, null);
    });
    // A ClientRequest timeout is only an inactivity notification. Node does
    // not abort the request automatically, and a response can still arrive.
    // Record TIMEOUT only if the request subsequently fails or closes before
    // receiving response headers; otherwise this would report successful slow
    // Google Drive downloads as failures after the global agent's 5-second timeout.
    request.on('timeout', () => {
      timeoutObserved = true;
    });
    request.on('error', (error: Error & { code?: string }) => finalize(
      null,
      classifyExternalRequestError(error.code, error.name, timeoutObserved),
    ));
    request.on('close', () => {
      const closeError = classifyExternalRequestClose(responseReceived, timeoutObserved);
      if (closeError) finalize(null, closeError);
    });
  }

  private recordCompletedCall(
    call: NormalizedTarget & {
      requestId: string | null;
      routeKey: string | null;
      userId: number | null;
      userTypeId: number | null;
      firstName: string | null;
      lastName: string | null;
      roleName: string | null;
      startedAt: string;
    },
    durationMs: number,
    statusCode: number | null,
    errorCode: string | null,
  ): void {
    this.totalCapturedSinceStart += 1;
    const key = `${call.protocol} ${call.method} ${call.host} ${call.pathLabel}`;
    const aggregate = this.aggregates.get(key) ?? {
      protocol: call.protocol,
      method: call.method,
      host: call.host,
      pathLabel: call.pathLabel,
      count: 0,
      slowCount: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      lastDurationMs: 0,
      lastStatusCode: null,
      lastErrorCode: null,
      lastSeenAtMs: 0,
      durationWindowMs: [],
    };

    aggregate.count += 1;
    aggregate.totalDurationMs += durationMs;
    aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs, durationMs);
    aggregate.lastDurationMs = durationMs;
    aggregate.lastStatusCode = statusCode;
    aggregate.lastErrorCode = errorCode;
    aggregate.lastSeenAtMs = Date.now();
    if (durationMs >= this.slowExternalCallThresholdMs) {
      aggregate.slowCount += 1;
    }
    pushLimited(aggregate.durationWindowMs, durationMs, WINDOW_LIMIT);
    this.aggregates.set(key, aggregate);

    if ((statusCode != null && statusCode >= 400) || errorCode) {
      captureExternalRequestFailureSafe({
        protocol: call.protocol,
        method: call.method,
        host: call.host,
        path: call.path,
        statusCode,
        errorCode,
        durationMs,
        requestId: call.requestId,
        route: call.routeKey,
        userId: call.userId,
      });
    }

    if (call.routeKey) {
      const routeAggregate = this.routeAggregates.get(call.routeKey) ?? {
        routeKey: call.routeKey,
        requestCount: 0,
        totalExternalDurationMs: 0,
        maxExternalDurationMs: 0,
        endpointCounts: new Map<string, number>(),
      };
      routeAggregate.requestCount += 1;
      routeAggregate.totalExternalDurationMs += durationMs;
      routeAggregate.maxExternalDurationMs = Math.max(routeAggregate.maxExternalDurationMs, durationMs);
      routeAggregate.endpointCounts.set(key, (routeAggregate.endpointCounts.get(key) ?? 0) + 1);
      this.routeAggregates.set(call.routeKey, routeAggregate);
    }

    if (durationMs >= this.slowExternalCallThresholdMs) {
      pushLimited(
        this.recentSlowCalls,
        {
          startedAt: call.startedAt,
          durationMs: round(durationMs),
          protocol: call.protocol,
          method: call.method,
          host: call.host,
          path: call.path,
          statusCode,
          errorCode,
          requestId: call.requestId,
          routeKey: call.routeKey,
          userId: call.userId,
          userTypeId: call.userTypeId,
          firstName: call.firstName,
          lastName: call.lastName,
          roleName: call.roleName,
        },
        RECENT_LIMIT,
      );
      logger.warn('[performance] Slow external call detected', {
        protocol: call.protocol,
        method: call.method,
        host: call.host,
        path: call.path,
        durationMs: round(durationMs),
        statusCode,
        errorCode,
        routeKey: call.routeKey,
        requestId: call.requestId,
        userId: call.userId,
        userTypeId: call.userTypeId,
        userName: `${call.firstName ?? ''} ${call.lastName ?? ''}`.trim() || null,
        roleName: call.roleName,
      });
    }
  }
}

export const externalRequestDiagnosticsService = new ExternalRequestDiagnosticsService();
