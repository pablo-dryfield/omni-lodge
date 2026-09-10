export type ClientErrorType =
  | "exception"
  | "unhandled_rejection"
  | "react_error"
  | "console_error"
  | "resource_error"
  | "api_error"
  | "csp_violation"
  | "manual";

export type ClientErrorLevel = "warning" | "error" | "fatal";

export type ErrorMonitoringUserContext = {
  id?: number | null;
  roleSlug?: string | null;
  userTypeId?: number | null;
  staffType?: string | null;
  authenticated?: boolean;
};

export type ClientErrorHttpContext = {
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  requestId?: string;
};

export type ClientErrorBreadcrumb = Record<string, unknown>;

export type ClientErrorEvent = {
  eventId: string;
  /**
   * Identity observed when the event was captured. The server may use this only
   * to prevent a queued event being attributed to a different signed-in user;
   * it must never trust this client-provided value as authentication.
   */
  capturedUserId?: number | null;
  type: ClientErrorType;
  level: ClientErrorLevel;
  message: string;
  name?: string;
  stack?: string;
  componentStack?: string;
  occurredAt: string;
  pageUrl?: string;
  route?: string;
  release?: string;
  environment?: string;
  sessionId?: string;
  requestId?: string;
  http?: ClientErrorHttpContext;
  tags?: Record<string, string | number | boolean | null>;
  context?: Record<string, unknown>;
  breadcrumbs?: ClientErrorBreadcrumb[];
};

export type ClientErrorCapture = Omit<
  ClientErrorEvent,
  "eventId" | "occurredAt" | "level" | "capturedUserId"
> & {
  eventId?: string;
  occurredAt?: string;
  level?: ClientErrorLevel;
};

export type QueuedClientError = {
  id: string;
  event: ClientErrorEvent;
  fingerprint: string;
  enqueuedAt: number;
  nextAttemptAt: number;
  attempts: number;
};

export interface ClientErrorQueueStore {
  getAll(): Promise<QueuedClientError[]>;
  put(item: QueuedClientError): Promise<void>;
  remove(ids: string[]): Promise<void>;
  clear(): Promise<void>;
}

export type ApiFailureCapture = {
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  requestId?: string;
  statusText?: string;
  code?: string;
  message?: string;
  name?: string;
  stack?: string;
  isCanceled?: boolean;
  expectedStatuses?: number[];
  responseSummary?: unknown;
  tags?: Record<string, string | number | boolean | null>;
};

export type ErrorMonitoringOptions = {
  endpoint?: string;
  release?: string;
  environment?: string;
  captureConsole?: boolean;
  captureFetch?: boolean;
  captureNetworkTransports?: boolean;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  maxQueueBytes?: number;
  dedupeWindowMs?: number;
  transportTimeoutMs?: number;
  getUserContext?: () => ErrorMonitoringUserContext | null | undefined;
  queueStore?: ClientErrorQueueStore;
  fetchImpl?: typeof fetch;
  /** The default Axios export. Injected to cover calls that bypass axiosInstance. */
  defaultAxiosClient?: unknown;
};
