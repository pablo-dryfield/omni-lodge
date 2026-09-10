import type { AxiosRequestConfig } from "axios";
import axiosInstance from "../utils/axiosInstance";

type MonitoringRequestConfig = AxiosRequestConfig & {
  skipErrorMonitoring: true;
};

// The monitor must not recursively create client issues when its own dashboard
// endpoint is unavailable. API-side request/process capture still observes the
// underlying server failure.
const monitoringRequestConfig = (config: AxiosRequestConfig = {}): MonitoringRequestConfig => ({
  ...config,
  skipErrorMonitoring: true,
});

export type ErrorMonitoringSeverity = "warning" | "error" | "fatal";
export type ErrorMonitoringStatus = "open" | "investigating" | "resolved" | "ignored";

export type ErrorMonitoringUser = {
  id: number | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  role?: string | null;
  roleSlug?: string | null;
};

export type ErrorMonitoringAssignee = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export type ErrorMonitoringIssueSummary = {
  id: string;
  fingerprint: string;
  source: string;
  kind: string;
  title: string;
  culprit?: string | null;
  severity: ErrorMonitoringSeverity;
  status: ErrorMonitoringStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  affectedUserCount: number;
  reopenedCount: number;
  lastRegressedAt?: string | null;
  lastRoute: string | null;
  lastPageUrl: string | null;
  lastRelease: string | null;
  lastEnvironment: string | null;
  assignedTo: ErrorMonitoringAssignee | null;
  assignedToUserId?: number | null;
  statusChangedAt: string | null;
  resolvedAt?: string | null;
};

export type ErrorMonitoringBreadcrumb = {
  timestamp?: string;
  category?: string;
  level?: string;
  message?: string;
  data?: Record<string, unknown> | null;
};

export type ErrorMonitoringOccurrence = {
  id: string;
  eventId: string;
  clientEventId?: string | null;
  eventCount?: number;
  source: string;
  kind: string;
  level: string;
  errorName: string | null;
  message: string;
  stack: string | null;
  componentStack: string | null;
  occurredAt: string;
  receivedAt: string;
  user: ErrorMonitoringUser | null;
  requestId: string | null;
  httpMethod: string | null;
  httpUrlPath: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  pageUrlPath: string | null;
  route: string | null;
  release: string | null;
  environment: string | null;
  userAgent: string | null;
  context: Record<string, unknown> | null;
  tags: Record<string, unknown> | null;
  breadcrumbs: ErrorMonitoringBreadcrumb[] | null;
};

export type ErrorMonitoringNote = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: ErrorMonitoringUser | null;
};

export type ErrorMonitoringSummary = {
  counts: {
    total: number;
    open: number;
    investigating: number;
    resolved: number;
    ignored: number;
  };
  severity: {
    warning: number;
    error: number;
    fatal: number;
  };
  sources: Array<{ source: string; count: number }>;
  occurrences: {
    /** Weighted events, including locally coalesced repeats. */
    last24Hours: number;
    last7Days: number;
    /** Physical occurrence rows retained by the server. */
    samplesLast24Hours?: number;
    samplesLast7Days?: number;
  };
  queue?: {
    pending: number;
    dropped: number;
    spool?: {
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
    [key: string]: unknown;
  };
  generatedAt: string;
};

export type ErrorMonitoringPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ErrorMonitoringIssueListResponse = {
  issues: ErrorMonitoringIssueSummary[];
  pagination: ErrorMonitoringPagination;
};

export type ErrorMonitoringIssueDetailResponse = {
  issue: ErrorMonitoringIssueSummary;
  occurrences: ErrorMonitoringOccurrence[];
  notes: ErrorMonitoringNote[];
  occurrencePagination: ErrorMonitoringPagination;
};

export type ErrorMonitoringIssueFilters = {
  page?: number;
  limit?: number;
  status?: ErrorMonitoringStatus[];
  severity?: ErrorMonitoringSeverity[];
  source?: string[];
  kind?: string[];
  search?: string;
  release?: string;
  environment?: string;
  userId?: number | null;
  pagePath?: string;
  from?: string | null;
  to?: string | null;
  sort?: "lastSeenAt" | "firstSeenAt" | "occurrenceCount" | "affectedUserCount" | "severity";
  direction?: "asc" | "desc";
};

const compactParams = (params: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => {
      if (value == null || value === "") {
        return false;
      }
      return !Array.isArray(value) || value.length > 0;
    }),
  );

export const buildErrorMonitoringIssueParams = (
  filters: ErrorMonitoringIssueFilters,
): Record<string, unknown> =>
  compactParams({
    ...filters,
    status: filters.status?.join(","),
    severity: filters.severity?.join(","),
    source: filters.source?.join(","),
    kind: filters.kind?.join(","),
  });

export const fetchErrorMonitoringSummary = async (): Promise<ErrorMonitoringSummary> => {
  const response = await axiosInstance.get<ErrorMonitoringSummary>(
    "/error-monitoring/summary",
    monitoringRequestConfig(),
  );
  return response.data;
};

export const fetchErrorMonitoringIssues = async (
  filters: ErrorMonitoringIssueFilters,
): Promise<ErrorMonitoringIssueListResponse> => {
  const response = await axiosInstance.get<ErrorMonitoringIssueListResponse>(
    "/error-monitoring/issues",
    monitoringRequestConfig({ params: buildErrorMonitoringIssueParams(filters) }),
  );
  return response.data;
};

export const fetchErrorMonitoringIssue = async (
  issueId: string,
  occurrencePage = 1,
  occurrenceLimit = 20,
): Promise<ErrorMonitoringIssueDetailResponse> => {
  const response = await axiosInstance.get<ErrorMonitoringIssueDetailResponse>(
    `/error-monitoring/issues/${encodeURIComponent(issueId)}`,
    monitoringRequestConfig({ params: { occurrencePage, occurrenceLimit } }),
  );
  return response.data;
};

export type UpdateErrorMonitoringIssueInput = {
  status?: ErrorMonitoringStatus;
  severity?: ErrorMonitoringSeverity;
  assignedToUserId?: number | null;
};

export const updateErrorMonitoringIssue = async (
  issueId: string,
  changes: UpdateErrorMonitoringIssueInput,
): Promise<ErrorMonitoringIssueSummary> => {
  const response = await axiosInstance.patch<{ issue?: ErrorMonitoringIssueSummary } | ErrorMonitoringIssueSummary>(
    `/error-monitoring/issues/${encodeURIComponent(issueId)}`,
    changes,
    monitoringRequestConfig(),
  );
  const payload = response.data;
  const wrapped = payload as { issue?: ErrorMonitoringIssueSummary };
  return wrapped.issue ?? (payload as ErrorMonitoringIssueSummary);
};

export const addErrorMonitoringNote = async (
  issueId: string,
  body: string,
): Promise<ErrorMonitoringNote> => {
  const response = await axiosInstance.post<{ note?: ErrorMonitoringNote } | ErrorMonitoringNote>(
    `/error-monitoring/issues/${encodeURIComponent(issueId)}/notes`,
    { body },
    monitoringRequestConfig(),
  );
  const payload = response.data;
  const wrapped = payload as { note?: ErrorMonitoringNote };
  return wrapped.note ?? (payload as ErrorMonitoringNote);
};

export const deleteErrorMonitoringNote = async (issueId: string, noteId: string): Promise<void> => {
  await axiosInstance.delete(
    `/error-monitoring/issues/${encodeURIComponent(issueId)}/notes/${encodeURIComponent(noteId)}`,
    monitoringRequestConfig(),
  );
};

export const cleanupErrorMonitoringData = async (retentionDays?: number): Promise<void> => {
  await axiosInstance.post(
    "/error-monitoring/cleanup",
    retentionDays ? { retentionDays } : {},
    monitoringRequestConfig(),
  );
};
