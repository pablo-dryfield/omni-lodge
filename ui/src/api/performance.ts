import axiosInstance from "../utils/axiosInstance";

export type PerformanceHistoryPoint = {
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
  userId: number | null;
  userTypeId: number | null;
  firstName: string | null;
  lastName: string | null;
  roleName: string | null;
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
  currentSessionId: string;
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
        userId: number | null;
        userTypeId: number | null;
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
  };
  externalCalls: {
    totalCapturedSinceStart: number;
    slowExternalCallThresholdMs: number;
    topEndpoints: Array<{
      protocol: "http" | "https";
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
    recentSlowCalls: Array<{
      startedAt: string;
      durationMs: number;
      protocol: "http" | "https";
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
    }>;
    activeCalls: Array<{
      requestId: string | null;
      routeKey: string | null;
      userId: number | null;
      userTypeId: number | null;
      firstName: string | null;
      lastName: string | null;
      roleName: string | null;
      method: string;
      protocol: "http" | "https";
      host: string;
      path: string;
      startedAt: string;
      startedAtMs: number;
      runningForMs: number;
    }>;
    routeCorrelations: Array<{
      routeKey: string;
      requestCount: number;
      averageExternalDurationMs: number;
      maxExternalDurationMs: number;
      topEndpoints: string[];
    }>;
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
  restartSessions: Array<{
    sessionId: string;
    startedAt: string;
    endedAt: string | null;
    sampleCount: number;
    isCurrent: boolean;
  }>;
  history: PerformanceHistoryPoint[];
  heapSnapshots: {
    supported: boolean;
    directory: string;
    recentSnapshots: Array<{
      fileName: string;
      filePath: string;
      sizeMb: number;
      createdAt: string;
    }>;
  };
};

export type PerformanceExplainResponse = {
  sql: string;
  plan: string[];
  generatedAt: string;
};

export type CaptureHeapSnapshotResponse = {
  snapshot: {
    fileName: string;
    filePath: string;
    sizeMb: number;
    createdAt: string;
  };
  generatedAt: string;
  warning: string;
};

export const fetchPerformanceSnapshot = async (): Promise<PerformanceSnapshotResponse> => {
  const response = await axiosInstance.get<PerformanceSnapshotResponse>("/performance/snapshot");
  return response.data;
};

export const runPerformanceExplain = async (sql: string): Promise<PerformanceExplainResponse> => {
  const response = await axiosInstance.post<PerformanceExplainResponse>("/performance/explain", { sql });
  return response.data;
};

export const capturePerformanceHeapSnapshot = async (): Promise<CaptureHeapSnapshotResponse> => {
  const response = await axiosInstance.post<CaptureHeapSnapshotResponse>("/performance/heap-snapshot");
  return response.data;
};
