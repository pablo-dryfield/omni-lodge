import os from 'os';
import { performance } from 'perf_hooks';
import type { Request } from 'express';
import { QueryTypes } from 'sequelize';
import sequelize from '../config/database.js';
import logger from '../utils/logger.js';
import { requestCounter, responseTimeHistogram } from '../metrics/metrics.js';
import { queryDiagnosticsService } from './queryDiagnosticsService.js';
import { externalRequestDiagnosticsService } from './externalRequestDiagnosticsService.js';
import { heapDiagnosticsService, type HeapSnapshotFile } from './heapDiagnosticsService.js';

type PoolSnapshot = {
  size: number | null;
  available: number | null;
  borrowed: number | null;
  pending: number | null;
  max: number | null;
  min: number | null;
};

type PerformanceHistoryPoint = {
  timestamp: string;
  sessionId: string;
  processStartedAt: string;
  cpuPercent: number;
  rssMb: number;
  heapUsedMb: number;
  heapUsedPercent: number;
  eventLoopLagMs: number;
  eventLoopUtilization: number;
  activeRequests: number;
  requestRatePerMinute: number;
  averageResponseMs: number;
  p95ResponseMs: number;
  errorRatePercent: number;
  slowRequestCount: number;
  dbPending: number | null;
  dbBorrowed: number | null;
  systemMemoryUsedPercent: number | null;
};

type RestartSessionSummary = {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  sampleCount: number;
  isCurrent: boolean;
};

type RouteDiagnostics = {
  routeKey: string;
  method: string;
  requestCount: number;
  errorCount: number;
  slowCount: number;
  averageResponseMs: number;
  p95ResponseMs: number;
  maxResponseMs: number;
  lastResponseMs: number;
  lastStatusCode: number;
  lastSeenAt: string;
};

type ActiveRequestSnapshot = {
  id: string;
  method: string;
  routeKey: string;
  startedAt: string;
  runningForMs: number;
  ip: string | null;
  userId: number | null;
  userTypeId: number | null;
  firstName: string | null;
  lastName: string | null;
  roleName: string | null;
};

type SlowRequestSnapshot = ActiveRequestSnapshot & {
  statusCode: number;
  durationMs: number;
  userAgent: string | null;
};

type ErrorRequestSnapshot = SlowRequestSnapshot & {
  responseBodySize: number | null;
};

type PerformanceSnapshot = {
  generatedAt: string;
  startedAt: string;
  environment: {
    nodeEnv: string;
    hostname: string;
    platform: NodeJS.Platform;
    release: string;
    arch: string;
    processId: number;
    cpuCores: number;
    timezone: string;
  };
  process: {
    uptimeSeconds: number;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    heapUsedPercent: number;
    externalMb: number;
    arrayBuffersMb: number;
    cpuPercent: number;
    eventLoopLagMs: number;
    eventLoopUtilization: number;
    activeRequestCount: number;
    activeHandleCount: number;
  };
  system: {
    totalMemoryMb: number;
    freeMemoryMb: number;
    usedMemoryMb: number;
    usedMemoryPercent: number;
    loadAverage: [number, number, number];
  };
  database: {
    pool: PoolSnapshot;
    queries: {
      totalCapturedSinceStart: number;
      slowQueryThresholdMs: number;
      topQueries: Array<{
        label: string;
        count: number;
        slowCount: number;
        averageDurationMs: number;
        p95DurationMs: number;
        maxDurationMs: number;
        lastDurationMs: number;
        lastSeenAt: string;
        sqlSnippet: string;
        sampleSql: string;
        sampleSqlSnippet: string;
      }>;
      recentSlowQueries: Array<{
        startedAt: string;
        durationMs: number;
        label: string;
        sqlSnippet: string;
        requestId: string | null;
        routeKey: string | null;
        method: string | null;
      }>;
      routeCorrelations: Array<{
        routeKey: string;
        method: string;
        requestCount: number;
        averageTotalQueryDurationMs: number;
        maxTotalQueryDurationMs: number;
        topQueryLabels: string[];
      }>;
      recentRequestCorrelations: Array<{
        requestId: string;
        routeKey: string;
        method: string;
        startedAt: string;
        requestDurationMs: number;
        statusCode: number;
        totalQueryDurationMs: number;
        queries: Array<{
          label: string;
          durationMs: number;
          sqlSnippet: string;
        }>;
      }>;
    };
  };
  externalCalls: ReturnType<typeof externalRequestDiagnosticsService.getSnapshot>;
  traffic: {
    totalRequestsSinceStart: number;
    totalErrorsSinceStart: number;
    recentWindowMinutes: number;
    recentRequestCount: number;
    recentErrorCount: number;
    averageResponseMs: number;
    p95ResponseMs: number;
    slowRequestCount: number;
    errorRatePercent: number;
  };
  handles: Array<{ type: string; count: number }>;
  requests: Array<{ type: string; count: number }>;
  activeRequests: ActiveRequestSnapshot[];
  topRoutes: RouteDiagnostics[];
  recentSlowRequests: SlowRequestSnapshot[];
  recentErrors: ErrorRequestSnapshot[];
  history: PerformanceHistoryPoint[];
  currentSessionId: string;
  restartSessions: RestartSessionSummary[];
  heapSnapshots: {
    supported: boolean;
    directory: string;
    recentSnapshots: HeapSnapshotFile[];
  };
};

type RouteAggregate = {
  routeKey: string;
  method: string;
  requestCount: number;
  errorCount: number;
  slowCount: number;
  totalResponseMs: number;
  maxResponseMs: number;
  lastResponseMs: number;
  lastStatusCode: number;
  lastSeenAtMs: number;
  responseWindowMs: number[];
};

type RequestWindowEntry = {
  timestampMs: number;
  durationMs: number;
  statusCode: number;
  routeKey: string;
};

type ActiveRequestRecord = {
  id: string;
  method: string;
  routeKey: string;
  startedAtMs: number;
  startedAtIso: string;
  ip: string | null;
  userAgent: string | null;
  userId: number | null;
  userTypeId: number | null;
  firstName: string | null;
  lastName: string | null;
  roleName: string | null;
};

type RequestStartContext = ActiveRequestRecord;

type PersistedPerformanceRow = {
  captured_at: Date | string;
  performance_session_id: string;
  process_started_at: Date | string;
  cpu_percent: number;
  rss_mb: number;
  heap_used_mb: number;
  heap_used_percent: number;
  event_loop_lag_ms: number;
  event_loop_utilization: number;
  active_requests: number;
  request_rate_per_minute: number;
  average_response_ms: number;
  p95_response_ms: number;
  error_rate_percent: number;
  slow_request_count: number;
  db_pending: number | null;
  db_borrowed: number | null;
  system_memory_used_percent: number | null;
};

const PERFORMANCE_SNAPSHOTS_TABLE = 'performance_snapshots';
const HISTORY_LIMIT = 60 * 48;
const HISTORY_LOOKBACK_DAYS = 30;
const PERSIST_RETENTION_DAYS = 30;
const PERSIST_SAMPLE_INTERVAL_MS = 5 * 60_000;
const PERSIST_CLEANUP_INTERVAL_MS = 6 * 60_000 * 60;
const RECENT_REQUEST_LIMIT = 10_000;
const ROUTE_WINDOW_LIMIT = 200;
const SLOW_REQUEST_LIMIT = 100;
const ERROR_REQUEST_LIMIT = 100;
const ACTIVE_REQUEST_LIMIT = 20;
const REQUEST_WINDOW_MINUTES = 15;
const SAMPLE_INTERVAL_MS = 60_000;
const EVENT_LOOP_SAMPLE_MS = 1_000;
const SUMMARY_LOG_INTERVAL_MS = 10 * 60_000;
const DEFAULT_SLOW_REQUEST_THRESHOLD_MS = 1_500;
const DIAGNOSTIC_EXCLUDED_ROUTE_KEYS = new Set(['/api/performance/heap-snapshot']);

const round = (value: number, digits = 2): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const toMegabytes = (value: number): number => round(value / (1024 * 1024), 2);

const pushLimited = <T>(target: T[], entry: T, limit: number): void => {
  target.push(entry);
  if (target.length > limit) {
    target.splice(0, target.length - limit);
  }
};

const formatRouteKey = (req: Request): string => {
  const rawPath = (req.originalUrl || req.url || req.path || '').split('?')[0];
  const normalized = rawPath
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:uuid')
    .replace(/\/[A-Za-z0-9_-]{14,}(?=\/|$)/g, '/:token');
  return normalized || '/';
};

const shouldExcludeFromDiagnosticsScoring = (routeKey: string): boolean =>
  DIAGNOSTIC_EXCLUDED_ROUTE_KEYS.has(routeKey);

const percentile = (values: number[], percentileValue: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return round(sorted[index] ?? 0);
};

const summarizeNamedObjects = (items: unknown[]): Array<{ type: string; count: number }> => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const type =
      (item as { constructor?: { name?: string } } | null)?.constructor?.name ||
      typeof item;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type));
};

const readNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'function') {
    try {
      const resolved = value();
      return typeof resolved === 'number' && Number.isFinite(resolved) ? resolved : null;
    } catch {
      return null;
    }
  }
  return null;
};

const toHistoryPoint = (row: PersistedPerformanceRow): PerformanceHistoryPoint => ({
  timestamp: new Date(row.captured_at).toISOString(),
  sessionId: String(row.performance_session_id),
  processStartedAt: new Date(row.process_started_at).toISOString(),
  cpuPercent: round(Number(row.cpu_percent ?? 0)),
  rssMb: round(Number(row.rss_mb ?? 0)),
  heapUsedMb: round(Number(row.heap_used_mb ?? 0)),
  heapUsedPercent: round(Number(row.heap_used_percent ?? 0)),
  eventLoopLagMs: round(Number(row.event_loop_lag_ms ?? 0)),
  eventLoopUtilization: round(Number(row.event_loop_utilization ?? 0)),
  activeRequests: Number(row.active_requests ?? 0),
  requestRatePerMinute: round(Number(row.request_rate_per_minute ?? 0)),
  averageResponseMs: round(Number(row.average_response_ms ?? 0)),
  p95ResponseMs: round(Number(row.p95_response_ms ?? 0)),
  errorRatePercent: round(Number(row.error_rate_percent ?? 0)),
  slowRequestCount: Number(row.slow_request_count ?? 0),
  dbPending: row.db_pending == null ? null : Number(row.db_pending),
  dbBorrowed: row.db_borrowed == null ? null : Number(row.db_borrowed),
  systemMemoryUsedPercent:
    row.system_memory_used_percent == null ? null : round(Number(row.system_memory_used_percent)),
});

class PerformanceMonitorService {
  private readonly startedAt = new Date();
  private readonly sessionId = `${os.hostname()}-${process.pid}-${this.startedAt.toISOString()}`;
  private readonly slowRequestThresholdMs =
    Number(process.env.PERFORMANCE_SLOW_REQUEST_MS) || DEFAULT_SLOW_REQUEST_THRESHOLD_MS;
  private readonly routeAggregates = new Map<string, RouteAggregate>();
  private readonly activeRequests = new Map<string, ActiveRequestRecord>();
  private readonly recentRequests: RequestWindowEntry[] = [];
  private readonly recentSlowRequests: SlowRequestSnapshot[] = [];
  private readonly recentErrors: ErrorRequestSnapshot[] = [];
  private readonly history: PerformanceHistoryPoint[] = [];
  private totalRequestsSinceStart = 0;
  private totalErrorsSinceStart = 0;
  private requestSequence = 0;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuAtNs = process.hrtime.bigint();
  private lastElu = performance.eventLoopUtilization();
  private lastEventLoopCheckAt = performance.now();
  private lastSampledRequestCount = 0;
  private lastSampledErrorCount = 0;
  private eventLoopLagMs = 0;
  private readonly sampleTimer: NodeJS.Timeout;
  private readonly eventLoopTimer: NodeJS.Timeout;
  private readonly summaryTimer: NodeJS.Timeout;
  private lastPersistedAtMs = 0;
  private lastCleanupAtMs = 0;
  private persistenceWriteInFlight = false;
  private persistenceReadInFlight: Promise<PerformanceHistoryPoint[]> | null = null;
  private persistenceUnavailableLogged = false;

  constructor() {
    this.sampleTimer = setInterval(() => {
      void this.captureHistorySample();
    }, SAMPLE_INTERVAL_MS);
    this.sampleTimer.unref?.();

    this.eventLoopTimer = setInterval(() => {
      this.sampleEventLoopLag();
    }, EVENT_LOOP_SAMPLE_MS);
    this.eventLoopTimer.unref?.();

    this.summaryTimer = setInterval(() => {
      void this.logSummary();
    }, SUMMARY_LOG_INTERVAL_MS);
    this.summaryTimer.unref?.();

    void this.captureHistorySample();
  }

  startRequest(req: Request): RequestStartContext {
    const id = `${Date.now()}-${++this.requestSequence}`;
    const routeKey = formatRouteKey(req);
    const startedAtMs = Date.now();
    const context: RequestStartContext = {
      id,
      method: req.method,
      routeKey,
      startedAtMs,
      startedAtIso: new Date(startedAtMs).toISOString(),
      ip: req.ip || null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      userId: req.authContext?.id ?? null,
      userTypeId: req.authContext?.userTypeId ?? null,
      firstName: req.authContext?.firstName ?? null,
      lastName: req.authContext?.lastName ?? null,
      roleName: req.authContext?.roleName ?? req.authContext?.roleSlug ?? null,
    };

    this.activeRequests.set(id, context);
    queryDiagnosticsService.startRequest(context);
    return context;
  }

  attachAuthenticatedUser(
    requestId: string,
    user: {
      userId: number | null;
      userTypeId: number | null;
      firstName: string | null;
      lastName: string | null;
      roleName: string | null;
    },
  ): void {
    const activeRequest = this.activeRequests.get(requestId);
    if (!activeRequest) {
      return;
    }
    activeRequest.userId = user.userId;
    activeRequest.userTypeId = user.userTypeId;
    activeRequest.firstName = user.firstName;
    activeRequest.lastName = user.lastName;
    activeRequest.roleName = user.roleName;
  }

  finishRequest(context: RequestStartContext, statusCode: number, durationMs: number, responseBodySize?: number | null): void {
    this.activeRequests.delete(context.id);
    this.totalRequestsSinceStart += 1;
    queryDiagnosticsService.finishRequest(context, statusCode, durationMs);
    if (statusCode >= 500) {
      this.totalErrorsSinceStart += 1;
    }
    const excludedFromScoring = shouldExcludeFromDiagnosticsScoring(context.routeKey);

    if (!excludedFromScoring) {
      const routeMetricKey = `${context.method} ${context.routeKey}`;
      const aggregate = this.routeAggregates.get(routeMetricKey) ?? {
        routeKey: context.routeKey,
        method: context.method,
        requestCount: 0,
        errorCount: 0,
        slowCount: 0,
        totalResponseMs: 0,
        maxResponseMs: 0,
        lastResponseMs: 0,
        lastStatusCode: 0,
        lastSeenAtMs: 0,
        responseWindowMs: [],
      };

      aggregate.requestCount += 1;
      aggregate.totalResponseMs += durationMs;
      aggregate.maxResponseMs = Math.max(aggregate.maxResponseMs, durationMs);
      aggregate.lastResponseMs = durationMs;
      aggregate.lastStatusCode = statusCode;
      aggregate.lastSeenAtMs = Date.now();
      if (statusCode >= 500) {
        aggregate.errorCount += 1;
      }
      if (durationMs >= this.slowRequestThresholdMs) {
        aggregate.slowCount += 1;
      }
      pushLimited(aggregate.responseWindowMs, durationMs, ROUTE_WINDOW_LIMIT);
      this.routeAggregates.set(routeMetricKey, aggregate);

      pushLimited(
        this.recentRequests,
        {
          timestampMs: Date.now(),
          durationMs,
          statusCode,
          routeKey: routeMetricKey,
        },
        RECENT_REQUEST_LIMIT,
      );
    }

    requestCounter.inc({
      method: context.method,
      path: context.routeKey,
      status: String(statusCode),
    });
    responseTimeHistogram.observe(
      {
        method: context.method,
        path: context.routeKey,
        status: String(statusCode),
      },
      durationMs / 1000,
    );

    if (!excludedFromScoring && durationMs >= this.slowRequestThresholdMs) {
      const slowRequest: SlowRequestSnapshot = {
        id: context.id,
        method: context.method,
        routeKey: context.routeKey,
        startedAt: context.startedAtIso,
        runningForMs: durationMs,
        statusCode,
        durationMs: round(durationMs),
        ip: context.ip,
        userAgent: context.userAgent,
        userId: context.userId,
        userTypeId: context.userTypeId,
        firstName: context.firstName,
        lastName: context.lastName,
        roleName: context.roleName,
      };
      pushLimited(this.recentSlowRequests, slowRequest, SLOW_REQUEST_LIMIT);
      logger.warn('[performance] Slow request detected', {
        requestId: context.id,
        method: context.method,
        routeKey: context.routeKey,
        statusCode,
        durationMs: round(durationMs),
        activeRequests: this.activeRequests.size,
        eventLoopLagMs: round(this.eventLoopLagMs),
        heapUsedMb: toMegabytes(process.memoryUsage().heapUsed),
        userId: context.userId,
        userTypeId: context.userTypeId,
        userName: `${context.firstName ?? ''} ${context.lastName ?? ''}`.trim() || null,
        roleName: context.roleName,
        dbPool: this.readDbPoolSnapshot(),
      });
    }

    if (!excludedFromScoring && statusCode >= 500) {
      const errorRequest: ErrorRequestSnapshot = {
        id: context.id,
        method: context.method,
        routeKey: context.routeKey,
        startedAt: context.startedAtIso,
        runningForMs: durationMs,
        statusCode,
        durationMs: round(durationMs),
        ip: context.ip,
        userAgent: context.userAgent,
        responseBodySize: responseBodySize ?? null,
        userId: context.userId,
        userTypeId: context.userTypeId,
        firstName: context.firstName,
        lastName: context.lastName,
        roleName: context.roleName,
      };
      pushLimited(this.recentErrors, errorRequest, ERROR_REQUEST_LIMIT);
      logger.error('[performance] Server error request', {
        requestId: context.id,
        method: context.method,
        routeKey: context.routeKey,
        statusCode,
        durationMs: round(durationMs),
        activeRequests: this.activeRequests.size,
        userId: context.userId,
        userTypeId: context.userTypeId,
        userName: `${context.firstName ?? ''} ${context.lastName ?? ''}`.trim() || null,
        roleName: context.roleName,
        dbPool: this.readDbPoolSnapshot(),
      });
    }
  }

  async getSnapshot(): Promise<PerformanceSnapshot> {
    const mergedHistory = await this.getMergedHistory();
    const restartSessions = this.buildRestartSessions(mergedHistory);
    const recentHeapSnapshots = await heapDiagnosticsService.listSnapshots();
    const memory = process.memoryUsage();
    const cpuPercent = this.computeCpuPercent();
    const eventLoopUtilizationValue = this.computeEventLoopUtilization();
    const dbPool = this.readDbPoolSnapshot();
    const recentWindow = this.getRecentWindowEntries();
    const recentDurations = recentWindow.map((entry) => entry.durationMs);
    const recentErrors = recentWindow.filter((entry) => entry.statusCode >= 500).length;
    const slowRequestCount = recentWindow.filter((entry) => entry.durationMs >= this.slowRequestThresholdMs).length;
    const totalMemoryMb = toMegabytes(os.totalmem());
    const freeMemoryMb = toMegabytes(os.freemem());
    const usedMemoryMb = round(totalMemoryMb - freeMemoryMb);
    const usedMemoryPercent = totalMemoryMb > 0 ? round((usedMemoryMb / totalMemoryMb) * 100) : 0;

    return {
      generatedAt: new Date().toISOString(),
      startedAt: this.startedAt.toISOString(),
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        hostname: os.hostname(),
        platform: process.platform,
        release: os.release(),
        arch: os.arch(),
        processId: process.pid,
        cpuCores: os.cpus().length,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      process: {
        uptimeSeconds: round(process.uptime(), 1),
        rssMb: toMegabytes(memory.rss),
        heapUsedMb: toMegabytes(memory.heapUsed),
        heapTotalMb: toMegabytes(memory.heapTotal),
        heapUsedPercent: memory.heapTotal > 0 ? round((memory.heapUsed / memory.heapTotal) * 100) : 0,
        externalMb: toMegabytes(memory.external),
        arrayBuffersMb: toMegabytes(memory.arrayBuffers),
        cpuPercent,
        eventLoopLagMs: round(this.eventLoopLagMs),
        eventLoopUtilization: round(eventLoopUtilizationValue * 100),
        activeRequestCount: this.activeRequests.size,
        activeHandleCount: this.getActiveHandles().length,
      },
      system: {
        totalMemoryMb,
        freeMemoryMb,
        usedMemoryMb,
        usedMemoryPercent,
        loadAverage: os.loadavg().map((value) => round(value, 2)) as [number, number, number],
      },
      database: {
        pool: dbPool,
        queries: queryDiagnosticsService.getSnapshot(),
      },
      externalCalls: externalRequestDiagnosticsService.getSnapshot(),
      traffic: {
        totalRequestsSinceStart: this.totalRequestsSinceStart,
        totalErrorsSinceStart: this.totalErrorsSinceStart,
        recentWindowMinutes: REQUEST_WINDOW_MINUTES,
        recentRequestCount: recentWindow.length,
        recentErrorCount: recentErrors,
        averageResponseMs: recentDurations.length > 0 ? round(recentDurations.reduce((sum, value) => sum + value, 0) / recentDurations.length) : 0,
        p95ResponseMs: percentile(recentDurations, 95),
        slowRequestCount,
        errorRatePercent: recentWindow.length > 0 ? round((recentErrors / recentWindow.length) * 100) : 0,
      },
      handles: summarizeNamedObjects(this.getActiveHandles()),
      requests: summarizeNamedObjects(this.getActiveNodeRequests()),
      activeRequests: [...this.activeRequests.values()]
        .map((entry) => ({
          id: entry.id,
          method: entry.method,
          routeKey: entry.routeKey,
          startedAt: entry.startedAtIso,
          runningForMs: round(Date.now() - entry.startedAtMs),
          ip: entry.ip,
          userId: entry.userId,
          userTypeId: entry.userTypeId,
          firstName: entry.firstName,
          lastName: entry.lastName,
          roleName: entry.roleName,
        }))
        .sort((left, right) => right.runningForMs - left.runningForMs)
        .slice(0, ACTIVE_REQUEST_LIMIT),
      topRoutes: this.buildRouteDiagnostics(),
      recentSlowRequests: [...this.recentSlowRequests].reverse(),
      recentErrors: [...this.recentErrors].reverse(),
      history: mergedHistory,
      currentSessionId: this.sessionId,
      restartSessions,
      heapSnapshots: {
        supported: true,
        directory: heapDiagnosticsService.getSnapshotDirectory(),
        recentSnapshots: recentHeapSnapshots,
      },
    };
  }

  private async captureHistorySample(): Promise<void> {
    const memory = process.memoryUsage();
    const recentWindow = this.getRecentWindowEntries();
    const recentDurations = recentWindow.map((entry) => entry.durationMs);
    const dbPool = this.readDbPoolSnapshot();
    const currentTotalRequests = this.totalRequestsSinceStart;
    const currentTotalErrors = this.totalErrorsSinceStart;
    const requestDelta = currentTotalRequests - this.lastSampledRequestCount;
    const errorDelta = currentTotalErrors - this.lastSampledErrorCount;
    this.lastSampledRequestCount = currentTotalRequests;
    this.lastSampledErrorCount = currentTotalErrors;

    const totalMemoryMb = toMegabytes(os.totalmem());
    const freeMemoryMb = toMegabytes(os.freemem());
    const usedMemoryPercent =
      totalMemoryMb > 0 ? round(((totalMemoryMb - freeMemoryMb) / totalMemoryMb) * 100) : 0;

    const historyPoint: PerformanceHistoryPoint = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      processStartedAt: this.startedAt.toISOString(),
      cpuPercent: this.computeCpuPercent(),
      rssMb: toMegabytes(memory.rss),
      heapUsedMb: toMegabytes(memory.heapUsed),
      heapUsedPercent: memory.heapTotal > 0 ? round((memory.heapUsed / memory.heapTotal) * 100) : 0,
      eventLoopLagMs: round(this.eventLoopLagMs),
      eventLoopUtilization: round(this.computeEventLoopUtilization() * 100),
      activeRequests: this.activeRequests.size,
      requestRatePerMinute: round(requestDelta / (SAMPLE_INTERVAL_MS / 60_000), 2),
      averageResponseMs:
        recentDurations.length > 0
          ? round(recentDurations.reduce((sum, value) => sum + value, 0) / recentDurations.length)
          : 0,
      p95ResponseMs: percentile(recentDurations, 95),
      errorRatePercent: requestDelta > 0 ? round((errorDelta / requestDelta) * 100) : 0,
      slowRequestCount: recentWindow.filter((entry) => entry.durationMs >= this.slowRequestThresholdMs).length,
      dbPending: dbPool.pending,
      dbBorrowed: dbPool.borrowed,
      systemMemoryUsedPercent: usedMemoryPercent,
    };

    pushLimited(this.history, historyPoint, HISTORY_LIMIT);
    await this.persistHistoryPoint(historyPoint);
  }

  private async logSummary(): Promise<void> {
    const snapshot = await this.getSnapshot();
    logger.info('[performance] Periodic snapshot', {
      uptimeSeconds: snapshot.process.uptimeSeconds,
      cpuPercent: snapshot.process.cpuPercent,
      rssMb: snapshot.process.rssMb,
      heapUsedMb: snapshot.process.heapUsedMb,
      heapUsedPercent: snapshot.process.heapUsedPercent,
      eventLoopLagMs: snapshot.process.eventLoopLagMs,
      activeRequests: snapshot.process.activeRequestCount,
      recentP95ResponseMs: snapshot.traffic.p95ResponseMs,
      recentErrorRatePercent: snapshot.traffic.errorRatePercent,
      dbPool: snapshot.database.pool,
      topSqlQueries: snapshot.database.queries.topQueries.slice(0, 3).map((query) => ({
        label: query.label,
        avgMs: query.averageDurationMs,
        p95Ms: query.p95DurationMs,
        slowCount: query.slowCount,
      })),
      topRoutes: snapshot.topRoutes.slice(0, 5).map((route) => ({
        routeKey: route.routeKey,
        method: route.method,
        avgMs: route.averageResponseMs,
        p95Ms: route.p95ResponseMs,
        slowCount: route.slowCount,
      })),
      topExternalCalls: snapshot.externalCalls.topEndpoints.slice(0, 3).map((call) => ({
        endpoint: `${call.method} ${call.host}${call.pathLabel}`,
        avgMs: call.averageDurationMs,
        p95Ms: call.p95DurationMs,
        slowCount: call.slowCount,
      })),
    });
  }

  private buildRouteDiagnostics(): RouteDiagnostics[] {
    return [...this.routeAggregates.values()]
      .map((route) => ({
        routeKey: route.routeKey,
        method: route.method,
        requestCount: route.requestCount,
        errorCount: route.errorCount,
        slowCount: route.slowCount,
        averageResponseMs:
          route.requestCount > 0 ? round(route.totalResponseMs / route.requestCount) : 0,
        p95ResponseMs: percentile(route.responseWindowMs, 95),
        maxResponseMs: round(route.maxResponseMs),
        lastResponseMs: round(route.lastResponseMs),
        lastStatusCode: route.lastStatusCode,
        lastSeenAt: new Date(route.lastSeenAtMs).toISOString(),
      }))
      .sort(
        (left, right) =>
          right.p95ResponseMs - left.p95ResponseMs ||
          right.averageResponseMs - left.averageResponseMs ||
          right.requestCount - left.requestCount,
      )
      .slice(0, 25);
  }

  private async getMergedHistory(): Promise<PerformanceHistoryPoint[]> {
    const persisted = await this.readPersistedHistory();
    const liveMap = new Map(this.history.map((point) => [`${point.sessionId}\u0000${point.timestamp}`, point]));
    for (const point of persisted) {
      const key = `${point.sessionId}\u0000${point.timestamp}`;
      if (!liveMap.has(key)) {
        liveMap.set(key, point);
      }
    }
    return [...liveMap.values()]
      .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
      .slice(-Math.max(HISTORY_LIMIT, 4_032));
  }

  private async readPersistedHistory(): Promise<PerformanceHistoryPoint[]> {
    if (this.persistenceReadInFlight) {
      return this.persistenceReadInFlight;
    }

    this.persistenceReadInFlight = (async () => {
      try {
        const rows = await sequelize.query<PersistedPerformanceRow>(
          `
            SELECT
              captured_at,
              performance_session_id,
              process_started_at,
              cpu_percent,
              rss_mb,
              heap_used_mb,
              heap_used_percent,
              event_loop_lag_ms,
              event_loop_utilization,
              active_requests,
              request_rate_per_minute,
              average_response_ms,
              p95_response_ms,
              error_rate_percent,
              slow_request_count,
              db_pending,
              db_borrowed,
              system_memory_used_percent
            FROM ${PERFORMANCE_SNAPSHOTS_TABLE}
            WHERE captured_at >= NOW() - (CAST(:lookbackDays AS integer) * INTERVAL '1 day')
            ORDER BY captured_at ASC
          `,
          {
            replacements: { lookbackDays: HISTORY_LOOKBACK_DAYS },
            type: QueryTypes.SELECT,
          },
        );
        return rows.map(toHistoryPoint);
      } catch (error) {
        this.handlePersistenceError('read', error);
        return [];
      } finally {
        this.persistenceReadInFlight = null;
      }
    })();

    return this.persistenceReadInFlight;
  }

  private async persistHistoryPoint(point: PerformanceHistoryPoint): Promise<void> {
    const nowMs = Date.now();
    if (this.persistenceWriteInFlight || nowMs - this.lastPersistedAtMs < PERSIST_SAMPLE_INTERVAL_MS) {
      return;
    }

    this.persistenceWriteInFlight = true;
    this.lastPersistedAtMs = nowMs;

    try {
      await sequelize.query(
        `
          INSERT INTO ${PERFORMANCE_SNAPSHOTS_TABLE} (
            captured_at,
            performance_session_id,
            process_started_at,
            cpu_percent,
            rss_mb,
            heap_used_mb,
            heap_used_percent,
            event_loop_lag_ms,
            event_loop_utilization,
            active_requests,
            request_rate_per_minute,
            average_response_ms,
            p95_response_ms,
            error_rate_percent,
            slow_request_count,
            db_pending,
            db_borrowed,
            system_memory_used_percent,
            created_at,
            updated_at
          ) VALUES (
            :capturedAt,
            :performanceSessionId,
            :processStartedAt,
            :cpuPercent,
            :rssMb,
            :heapUsedMb,
            :heapUsedPercent,
            :eventLoopLagMs,
            :eventLoopUtilization,
            :activeRequests,
            :requestRatePerMinute,
            :averageResponseMs,
            :p95ResponseMs,
            :errorRatePercent,
            :slowRequestCount,
            :dbPending,
            :dbBorrowed,
            :systemMemoryUsedPercent,
            NOW(),
            NOW()
          )
        `,
        {
          replacements: {
            capturedAt: point.timestamp,
            performanceSessionId: point.sessionId,
            processStartedAt: point.processStartedAt,
            cpuPercent: point.cpuPercent,
            rssMb: point.rssMb,
            heapUsedMb: point.heapUsedMb,
            heapUsedPercent: point.heapUsedPercent,
            eventLoopLagMs: point.eventLoopLagMs,
            eventLoopUtilization: point.eventLoopUtilization,
            activeRequests: point.activeRequests,
            requestRatePerMinute: point.requestRatePerMinute,
            averageResponseMs: point.averageResponseMs,
            p95ResponseMs: point.p95ResponseMs,
            errorRatePercent: point.errorRatePercent,
            slowRequestCount: point.slowRequestCount,
            dbPending: point.dbPending,
            dbBorrowed: point.dbBorrowed,
            systemMemoryUsedPercent: point.systemMemoryUsedPercent,
          },
          type: QueryTypes.INSERT,
        },
      );

      if (nowMs - this.lastCleanupAtMs >= PERSIST_CLEANUP_INTERVAL_MS) {
        this.lastCleanupAtMs = nowMs;
        await sequelize.query(
          `DELETE FROM ${PERFORMANCE_SNAPSHOTS_TABLE} WHERE captured_at < NOW() - (CAST(:retentionDays AS integer) * INTERVAL '1 day')`,
          {
            replacements: { retentionDays: PERSIST_RETENTION_DAYS },
            type: QueryTypes.DELETE,
          },
        );
      }
    } catch (error) {
      this.handlePersistenceError('write', error);
    } finally {
      this.persistenceWriteInFlight = false;
    }
  }

  private handlePersistenceError(operation: 'read' | 'write', error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const missingPersistenceSchema =
      /performance_snapshots|performance_session_id|process_started_at|does not exist|relation .* does not exist|column .* does not exist|invalid object name/i.test(
        message,
      );
    if (missingPersistenceSchema) {
      if (!this.persistenceUnavailableLogged) {
        this.persistenceUnavailableLogged = true;
        logger.warn(
          `[performance] Snapshot persistence unavailable during ${operation}. Run the performance snapshots migrations to enable persisted history and restart-session tracking.`,
        );
      }
      return;
    }
    logger.warn(`[performance] Snapshot persistence ${operation} failed`, { message });
  }

  private buildRestartSessions(history: PerformanceHistoryPoint[]): RestartSessionSummary[] {
    const sessions = new Map<string, RestartSessionSummary>();

    for (const point of history) {
      const current = sessions.get(point.sessionId);
      if (!current) {
        sessions.set(point.sessionId, {
          sessionId: point.sessionId,
          startedAt: point.processStartedAt,
          endedAt: point.timestamp,
          sampleCount: 1,
          isCurrent: point.sessionId === this.sessionId,
        });
        continue;
      }

      current.sampleCount += 1;
      if (new Date(point.timestamp).getTime() > new Date(current.endedAt ?? point.timestamp).getTime()) {
        current.endedAt = point.timestamp;
      }
      if (new Date(point.processStartedAt).getTime() < new Date(current.startedAt).getTime()) {
        current.startedAt = point.processStartedAt;
      }
      current.isCurrent = current.isCurrent || point.sessionId === this.sessionId;
    }

    return [...sessions.values()]
      .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
      .map((session) => ({
        ...session,
        endedAt: session.isCurrent ? null : session.endedAt,
      }));
  }

  private computeCpuPercent(): number {
    const nowNs = process.hrtime.bigint();
    const elapsedMs = Number(nowNs - this.lastCpuAtNs) / 1_000_000;
    const usage = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuAtNs = nowNs;

    if (elapsedMs <= 0) {
      return 0;
    }

    const totalCpuMs = (usage.user + usage.system) / 1000;
    const normalized = totalCpuMs / (elapsedMs * Math.max(os.cpus().length, 1));
    return round(normalized * 100);
  }

  private computeEventLoopUtilization(): number {
    const current = performance.eventLoopUtilization();
    const delta = performance.eventLoopUtilization(this.lastElu, current);
    this.lastElu = current;
    return delta.utilization;
  }

  private sampleEventLoopLag(): void {
    const now = performance.now();
    const expected = this.lastEventLoopCheckAt + EVENT_LOOP_SAMPLE_MS;
    this.eventLoopLagMs = Math.max(0, now - expected);
    this.lastEventLoopCheckAt = now;
  }

  private getRecentWindowEntries(): RequestWindowEntry[] {
    const cutoffMs = Date.now() - REQUEST_WINDOW_MINUTES * 60_000;
    while (this.recentRequests.length > 0 && this.recentRequests[0] && this.recentRequests[0].timestampMs < cutoffMs) {
      this.recentRequests.shift();
    }
    return this.recentRequests;
  }

  private getActiveHandles(): unknown[] {
    const raw = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles;
    return typeof raw === 'function' ? raw.call(process) : [];
  }

  private getActiveNodeRequests(): unknown[] {
    const raw = (process as unknown as { _getActiveRequests?: () => unknown[] })._getActiveRequests;
    return typeof raw === 'function' ? raw.call(process) : [];
  }

  private readDbPoolSnapshot(): PoolSnapshot {
    const pool = (sequelize as unknown as { connectionManager?: { pool?: Record<string, unknown> } }).connectionManager?.pool;
    if (!pool) {
      return {
        size: null,
        available: null,
        borrowed: null,
        pending: null,
        max: null,
        min: null,
      };
    }

    return {
      size: readNumber(pool.size),
      available: readNumber(pool.available),
      borrowed: readNumber(pool.borrowed ?? pool.using ?? pool.used),
      pending: readNumber(pool.pending ?? pool.waiting ?? pool.queued),
      max: readNumber(pool.max),
      min: readNumber(pool.min),
    };
  }
}

export const performanceMonitorService = new PerformanceMonitorService();
