import axiosInstance from "../utils/axiosInstance";

export type PerformanceHistoryPoint = {
  timestamp: string;
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

export type RouteDiagnostics = {
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

export type ActiveRequestSnapshot = {
  id: string;
  method: string;
  routeKey: string;
  startedAt: string;
  runningForMs: number;
  ip: string | null;
};

export type SlowRequestSnapshot = ActiveRequestSnapshot & {
  statusCode: number;
  durationMs: number;
  userAgent: string | null;
};

export type ErrorRequestSnapshot = SlowRequestSnapshot & {
  responseBodySize: number | null;
};

export type PerformanceSnapshotResponse = {
  generatedAt: string;
  startedAt: string;
  environment: {
    nodeEnv: string;
    hostname: string;
    platform: string;
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
    pool: {
      size: number | null;
      available: number | null;
      borrowed: number | null;
      pending: number | null;
      max: number | null;
      min: number | null;
    };
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
      }>;
      recentSlowQueries: Array<{
        startedAt: string;
        durationMs: number;
        label: string;
        sqlSnippet: string;
      }>;
    };
  };
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
};

export const fetchPerformanceSnapshot = async (): Promise<PerformanceSnapshotResponse> => {
  const response = await axiosInstance.get<PerformanceSnapshotResponse>("/performance/snapshot");
  return response.data;
};
