import { getRequestContextValue } from './requestContextService.js';

type QueryAggregate = {
  normalizedSql: string;
  label: string;
  count: number;
  slowCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastDurationMs: number;
  lastSeenAtMs: number;
  durationWindowMs: number[];
  sampleSql: string;
  sampleSqlSnippet: string;
};

type RecentSlowQuery = {
  startedAt: string;
  durationMs: number;
  label: string;
  sqlSnippet: string;
  requestId: string | null;
  routeKey: string | null;
  method: string | null;
  userId: number | null;
  userTypeId: number | null;
};

type QueryDiagnosticsSnapshot = {
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
  recentSlowQueries: RecentSlowQuery[];
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
    userId: number | null;
    userTypeId: number | null;
    firstName: string | null;
    lastName: string | null;
    roleName: string | null;
    queries: Array<{
      label: string;
      durationMs: number;
      sqlSnippet: string;
    }>;
  }>;
};

type ActiveRequestQueryRecord = {
  requestId: string;
  routeKey: string;
  method: string;
  startedAt: string;
  userId: number | null;
  userTypeId: number | null;
  firstName: string | null;
  lastName: string | null;
  roleName: string | null;
  queries: Array<{
    label: string;
    durationMs: number;
    sqlSnippet: string;
  }>;
  totalQueryDurationMs: number;
};

type RouteQueryAggregate = {
  routeKey: string;
  method: string;
  requestCount: number;
  totalQueryDurationMs: number;
  maxTotalQueryDurationMs: number;
  queryLabelCounts: Map<string, number>;
};

const QUERY_WINDOW_LIMIT = 200;
const RECENT_SLOW_QUERY_LIMIT = 100;
const RECENT_REQUEST_CORRELATION_LIMIT = 100;
const DEFAULT_SLOW_QUERY_THRESHOLD_MS = 250;
const DIAGNOSTIC_EXCLUDED_ROUTE_KEYS = new Set(['/api/performance/heap-snapshot']);

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

const stripSequelizePrefix = (sql: string): string =>
  sql.replace(/^Executing \([^)]+\):\s*/i, '');

const shouldExcludeRouteFromDiagnostics = (routeKey: string | null): boolean =>
  routeKey != null && DIAGNOSTIC_EXCLUDED_ROUTE_KEYS.has(routeKey);

const truncate = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;

const normalizeSql = (sql: string): string => {
  const normalized = collapseWhitespace(stripSequelizePrefix(sql))
    .replace(/'(?:''|[^'])*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\$\d+/g, '?')
    .replace(/\s*=\s*/g, ' = ')
    .replace(/\s*,\s*/g, ', ');
  return normalized;
};

const queryLabelFromSql = (normalizedSql: string): string => {
  const match = normalizedSql.match(/^(select|insert|update|delete)\s+(?:into\s+|from\s+)?("?[\w.]+"?)/i);
  if (match) {
    return `${match[1].toUpperCase()} ${match[2].replace(/"/g, '')}`;
  }
  const generic = normalizedSql.split(' ').slice(0, 3).join(' ').toUpperCase();
  return generic || 'QUERY';
};

class QueryDiagnosticsService {
  private readonly slowQueryThresholdMs =
    Number(process.env.PERFORMANCE_SLOW_QUERY_MS) || DEFAULT_SLOW_QUERY_THRESHOLD_MS;
  private readonly aggregates = new Map<string, QueryAggregate>();
  private readonly recentSlowQueries: RecentSlowQuery[] = [];
  private readonly activeRequestQueries = new Map<string, ActiveRequestQueryRecord>();
  private readonly routeCorrelations = new Map<string, RouteQueryAggregate>();
  private readonly recentRequestCorrelations: QueryDiagnosticsSnapshot['recentRequestCorrelations'] = [];
  private totalCapturedSinceStart = 0;

  startRequest(request: {
    id: string;
    routeKey: string;
    method: string;
    startedAtIso: string;
    userId: number | null;
    userTypeId: number | null;
    firstName: string | null;
    lastName: string | null;
    roleName: string | null;
  }): void {
    this.activeRequestQueries.set(request.id, {
      requestId: request.id,
      routeKey: request.routeKey,
      method: request.method,
      startedAt: request.startedAtIso,
      userId: request.userId,
      userTypeId: request.userTypeId,
      firstName: request.firstName,
      lastName: request.lastName,
      roleName: request.roleName,
      queries: [],
      totalQueryDurationMs: 0,
    });
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
    const activeRequest = this.activeRequestQueries.get(requestId);
    if (!activeRequest) {
      return;
    }
    activeRequest.userId = user.userId;
    activeRequest.userTypeId = user.userTypeId;
    activeRequest.firstName = user.firstName;
    activeRequest.lastName = user.lastName;
    activeRequest.roleName = user.roleName;
  }

  finishRequest(request: { id: string; routeKey: string; method: string }, statusCode: number, requestDurationMs: number): void {
    const active = this.activeRequestQueries.get(request.id);
    if (!active) {
      return;
    }
    this.activeRequestQueries.delete(request.id);
    if (shouldExcludeRouteFromDiagnostics(request.routeKey)) {
      return;
    }
    if (active.queries.length === 0) {
      return;
    }

    const routeMetricKey = `${request.method} ${request.routeKey}`;
    const routeAggregate = this.routeCorrelations.get(routeMetricKey) ?? {
      routeKey: request.routeKey,
      method: request.method,
      requestCount: 0,
      totalQueryDurationMs: 0,
      maxTotalQueryDurationMs: 0,
      queryLabelCounts: new Map<string, number>(),
    };
    routeAggregate.requestCount += 1;
    routeAggregate.totalQueryDurationMs += active.totalQueryDurationMs;
    routeAggregate.maxTotalQueryDurationMs = Math.max(routeAggregate.maxTotalQueryDurationMs, active.totalQueryDurationMs);
    active.queries.forEach((query) => {
      routeAggregate.queryLabelCounts.set(query.label, (routeAggregate.queryLabelCounts.get(query.label) ?? 0) + 1);
    });
    this.routeCorrelations.set(routeMetricKey, routeAggregate);

    pushLimited(
      this.recentRequestCorrelations,
      {
        requestId: request.id,
        routeKey: request.routeKey,
        method: request.method,
        startedAt: active.startedAt,
        requestDurationMs: round(requestDurationMs),
        statusCode,
        totalQueryDurationMs: round(active.totalQueryDurationMs),
        userId: active.userId,
        userTypeId: active.userTypeId,
        firstName: active.firstName,
        lastName: active.lastName,
        roleName: active.roleName,
        queries: active.queries
          .slice()
          .sort((left, right) => right.durationMs - left.durationMs)
          .slice(0, 10),
      },
      RECENT_REQUEST_CORRELATION_LIMIT,
    );
  }

  recordQuery(rawSql: string, elapsedMs?: number): void {
    if (typeof rawSql !== 'string' || rawSql.trim().length === 0) {
      return;
    }
    if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) {
      return;
    }

    const normalizedSql = normalizeSql(rawSql);
    if (!normalizedSql) {
      return;
    }

    this.totalCapturedSinceStart += 1;
    const fullSql = collapseWhitespace(stripSequelizePrefix(rawSql));
    const rawSqlSnippet = truncate(fullSql, 500);
    const requestId = getRequestContextValue('requestId');
    const routeKey = getRequestContextValue('routeKey');
    const method = getRequestContextValue('method');
    if (shouldExcludeRouteFromDiagnostics(routeKey)) {
      return;
    }
    const userId = getRequestContextValue('userId');
    const userTypeId = getRequestContextValue('userTypeId');

    const aggregate = this.aggregates.get(normalizedSql) ?? {
      normalizedSql,
      label: queryLabelFromSql(normalizedSql),
      count: 0,
      slowCount: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      lastDurationMs: 0,
      lastSeenAtMs: 0,
      durationWindowMs: [],
      sampleSql: truncate(fullSql, 8_000),
      sampleSqlSnippet: rawSqlSnippet,
    };

    aggregate.count += 1;
    aggregate.totalDurationMs += elapsedMs;
    aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs, elapsedMs);
    aggregate.lastDurationMs = elapsedMs;
    aggregate.lastSeenAtMs = Date.now();
    if (elapsedMs >= this.slowQueryThresholdMs) {
      aggregate.slowCount += 1;
    }
    pushLimited(aggregate.durationWindowMs, elapsedMs, QUERY_WINDOW_LIMIT);
    aggregate.sampleSql = truncate(fullSql, 8_000);
    aggregate.sampleSqlSnippet = rawSqlSnippet;
    this.aggregates.set(normalizedSql, aggregate);

    if (requestId) {
      const activeRequest = this.activeRequestQueries.get(requestId);
      if (activeRequest) {
        activeRequest.totalQueryDurationMs += elapsedMs;
        pushLimited(
          activeRequest.queries,
          {
            label: aggregate.label,
            durationMs: round(elapsedMs),
            sqlSnippet: rawSqlSnippet,
          },
          25,
        );
      }
    }

    if (elapsedMs >= this.slowQueryThresholdMs) {
      pushLimited(
        this.recentSlowQueries,
        {
          startedAt: new Date().toISOString(),
          durationMs: round(elapsedMs),
          label: aggregate.label,
          sqlSnippet: truncate(normalizedSql, 320),
          requestId,
          routeKey,
          method,
          userId,
          userTypeId,
        },
        RECENT_SLOW_QUERY_LIMIT,
      );
    }
  }

  getSnapshot(): QueryDiagnosticsSnapshot {
    return {
      totalCapturedSinceStart: this.totalCapturedSinceStart,
      slowQueryThresholdMs: this.slowQueryThresholdMs,
      topQueries: [...this.aggregates.values()]
        .map((aggregate) => ({
          label: aggregate.label,
          count: aggregate.count,
          slowCount: aggregate.slowCount,
          averageDurationMs: round(aggregate.totalDurationMs / Math.max(aggregate.count, 1)),
          p95DurationMs: percentile(aggregate.durationWindowMs, 95),
          maxDurationMs: round(aggregate.maxDurationMs),
          lastDurationMs: round(aggregate.lastDurationMs),
          lastSeenAt: new Date(aggregate.lastSeenAtMs).toISOString(),
          sqlSnippet: truncate(aggregate.normalizedSql, 320),
          sampleSql: aggregate.sampleSql,
          sampleSqlSnippet: aggregate.sampleSqlSnippet,
        }))
        .sort(
          (left, right) =>
            right.p95DurationMs - left.p95DurationMs ||
            right.averageDurationMs - left.averageDurationMs ||
            right.count - left.count,
        )
        .slice(0, 20),
      recentSlowQueries: [...this.recentSlowQueries].reverse(),
      routeCorrelations: [...this.routeCorrelations.values()]
        .map((route) => ({
          routeKey: route.routeKey,
          method: route.method,
          requestCount: route.requestCount,
          averageTotalQueryDurationMs: round(route.totalQueryDurationMs / Math.max(route.requestCount, 1)),
          maxTotalQueryDurationMs: round(route.maxTotalQueryDurationMs),
          topQueryLabels: [...route.queryLabelCounts.entries()]
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 5)
            .map(([label]) => label),
        }))
        .sort(
          (left, right) =>
            right.averageTotalQueryDurationMs - left.averageTotalQueryDurationMs ||
            right.maxTotalQueryDurationMs - left.maxTotalQueryDurationMs ||
            right.requestCount - left.requestCount,
        )
        .slice(0, 20),
      recentRequestCorrelations: [...this.recentRequestCorrelations].reverse(),
    };
  }
}

export const queryDiagnosticsService = new QueryDiagnosticsService();
