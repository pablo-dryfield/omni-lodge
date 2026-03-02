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
};

type RecentSlowQuery = {
  startedAt: string;
  durationMs: number;
  label: string;
  sqlSnippet: string;
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
  }>;
  recentSlowQueries: RecentSlowQuery[];
};

const QUERY_WINDOW_LIMIT = 200;
const RECENT_SLOW_QUERY_LIMIT = 100;
const DEFAULT_SLOW_QUERY_THRESHOLD_MS = 250;

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
  private totalCapturedSinceStart = 0;

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
    this.aggregates.set(normalizedSql, aggregate);

    if (elapsedMs >= this.slowQueryThresholdMs) {
      pushLimited(
        this.recentSlowQueries,
        {
          startedAt: new Date().toISOString(),
          durationMs: round(elapsedMs),
          label: aggregate.label,
          sqlSnippet: truncate(normalizedSql, 320),
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
        }))
        .sort(
          (left, right) =>
            right.p95DurationMs - left.p95DurationMs ||
            right.averageDurationMs - left.averageDurationMs ||
            right.count - left.count,
        )
        .slice(0, 20),
      recentSlowQueries: [...this.recentSlowQueries].reverse(),
    };
  }
}

export const queryDiagnosticsService = new QueryDiagnosticsService();
