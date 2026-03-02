import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Pagination,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconActivity,
  IconAlertTriangle,
  IconCalendarEvent,
  IconChartLine,
  IconClock,
  IconCopy,
  IconCpu,
  IconDatabase,
  IconRoute,
  IconServer,
  IconSql,
} from "@tabler/icons-react";
import { isAxiosError } from "axios";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { navigateToPage } from "../actions/navigationActions";
import { useAppDispatch } from "../store/hooks";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import type { GenericPageProps } from "../types/general/GenericPageProps";
import {
  capturePerformanceHeapSnapshot,
  fetchPerformanceSnapshot,
  runPerformanceExplain,
  type CaptureHeapSnapshotResponse,
  type PerformanceExplainResponse,
  type PerformanceSnapshotResponse,
} from "../api/performance";

dayjs.extend(duration);

const PAGE_SLUG = PAGE_SLUGS.performance;
const POLL_INTERVAL_MS = 10_000;
const HISTORY_RANGE_OPTIONS = [
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "Custom", value: "custom" },
] as const;

type HistoryRange = (typeof HISTORY_RANGE_OPTIONS)[number]["value"];
type PaginatedSectionKey =
  | "routes"
  | "activeRequests"
  | "slowRequests"
  | "errors"
  | "topQueries"
  | "slowQueries"
  | "queryRoutes"
  | "requestQueries"
  | "externalEndpoints"
  | "externalSlowCalls";

type DiagnosisSeverity = "critical" | "warning" | "info" | "healthy";

type DiagnosisItem = {
  severity: DiagnosisSeverity;
  title: string;
  summary: string;
  signals: string[];
  actions: string[];
};

type CustomHistoryRangeValue = [Date | null, Date | null];
type SessionScope = "all" | "current" | "specific";

const formatMetricNumber = (value: number, digits = 0): string =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

const formatDuration = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (value >= 1000) {
    return `${formatMetricNumber(value / 1000, 2)} s`;
  }
  return `${formatMetricNumber(value, value < 10 ? 2 : 0)} ms`;
};

const formatPercent = (value: number): string => `${formatMetricNumber(value, value < 10 ? 2 : 1)}%`;
const formatTimestamp = (value: string): string => dayjs(value).format("DD/MM/YYYY HH:mm:ss");
const formatChartTimestamp = (value: string): string => dayjs(value).format("DD/MM HH:mm");
const formatDateOnly = (value: Date | string): string => dayjs(value).format("DD/MM/YYYY");
const formatUserIdentity = (user: {
  firstName?: string | null;
  lastName?: string | null;
  roleName?: string | null;
  userId?: number | null;
  userTypeId?: number | null;
}): string => {
  const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  const role = user.roleName?.trim() || null;
  const ids =
    user.userId != null || user.userTypeId != null
      ? `#${user.userId ?? "-"} / type ${user.userTypeId ?? "-"}`
      : null;
  return [fullName || null, role, ids].filter(Boolean).join(" | ") || "Guest / unauthenticated";
};

const summarizeActors = (
  items: Array<{
    userId?: number | null;
    userTypeId?: number | null;
    firstName?: string | null;
    lastName?: string | null;
    roleName?: string | null;
  }>,
  limit = 5,
): string[] => {
  const counts = new Map<
    string,
    {
      count: number;
      label: string;
    }
  >();

  items.forEach((item) => {
    const key =
      item.userId != null
        ? `user:${item.userId}`
        : item.userTypeId != null
          ? `usertype:${item.userTypeId}:${item.roleName ?? ""}`
          : "guest";
    const current = counts.get(key);
    counts.set(key, {
      count: (current?.count ?? 0) + 1,
      label: formatUserIdentity(item),
    });
  });

  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, limit)
    .map((entry, index) => `${index + 1}. ${entry.label} | count=${formatMetricNumber(entry.count)}`);
};

const summarizeUserTypes = (
  items: Array<{
    userTypeId?: number | null;
    roleName?: string | null;
  }>,
  limit = 5,
): string[] => {
  const counts = new Map<
    string,
    {
      count: number;
      label: string;
    }
  >();

  items.forEach((item) => {
    const key = item.userTypeId != null ? `type:${item.userTypeId}:${item.roleName ?? ""}` : "guest";
    const label =
      item.userTypeId != null
        ? `${item.roleName?.trim() || "Unknown role"} | type ${item.userTypeId}`
        : "Guest / unauthenticated";
    const current = counts.get(key);
    counts.set(key, {
      count: (current?.count ?? 0) + 1,
      label,
    });
  });

  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, limit)
    .map((entry, index) => `${index + 1}. ${entry.label} | count=${formatMetricNumber(entry.count)}`);
};

const createDefaultCustomHistoryRange = (): CustomHistoryRangeValue => {
  const end = new Date();
  const start = dayjs().subtract(6, "day").toDate();
  return [start, end];
};

const formatUptime = (seconds: number): string => {
  const uptime = dayjs.duration(seconds, "seconds");
  const parts = [
    uptime.days() > 0 ? `${uptime.days()}d` : null,
    uptime.hours() > 0 ? `${uptime.hours()}h` : null,
    uptime.minutes() > 0 ? `${uptime.minutes()}m` : null,
    `${uptime.seconds()}s`,
  ].filter(Boolean);
  return parts.join(" ");
};

const statusColor = (value: number, warning: number, critical: number): string => {
  if (value >= critical) {
    return "red";
  }
  if (value >= warning) {
    return "yellow";
  }
  return "blue";
};

const paginateItems = <T,>(items: T[], page: number, pageSize: number): T[] => {
  const safePage = Math.max(page, 1);
  const startIndex = (safePage - 1) * pageSize;
  return items.slice(startIndex, startIndex + pageSize);
};

const getTotalPages = (length: number, pageSize: number): number => Math.max(1, Math.ceil(length / pageSize));

const severityColorMap: Record<DiagnosisSeverity, string> = {
  critical: "red",
  warning: "yellow",
  info: "blue",
  healthy: "teal",
};

const severityRank: Record<DiagnosisSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  healthy: 3,
};

const generateDiagnostics = (
  snapshot: PerformanceSnapshotResponse,
  history: PerformanceSnapshotResponse["history"],
): DiagnosisItem[] => {
  const diagnostics: DiagnosisItem[] = [];
  const latestHistory = history[history.length - 1] ?? null;
  const earliestHistory = history[0] ?? null;
  const heapGrowth =
    latestHistory && earliestHistory ? latestHistory.heapUsedMb - earliestHistory.heapUsedMb : 0;
  const rssGrowth =
    latestHistory && earliestHistory ? latestHistory.rssMb - earliestHistory.rssMb : 0;
  const p95Growth =
    latestHistory && earliestHistory ? latestHistory.p95ResponseMs - earliestHistory.p95ResponseMs : 0;
  const topRoute = snapshot.topRoutes[0];
  const topQuery = snapshot.database.queries.topQueries[0];
  const topQueryRoute = snapshot.database.queries.routeCorrelations[0];
  const topExternalEndpoint = snapshot.externalCalls.topEndpoints[0];
  const hasMemoryGrowthTrend = heapGrowth >= 250 || rssGrowth >= 400;
  const hasHighHeapPressure = snapshot.process.heapUsedPercent >= 88;

  if (snapshot.traffic.p95ResponseMs >= 1500) {
    diagnostics.push({
      severity: "critical",
      title: "Request latency is already in a degraded state",
      summary: "The backend is responding slowly right now, not only historically.",
      signals: [
        `P95 latency is ${formatDuration(snapshot.traffic.p95ResponseMs)}.`,
        `Average latency is ${formatDuration(snapshot.traffic.averageResponseMs)}.`,
        topRoute ? `Worst route right now is ${topRoute.method} ${topRoute.routeKey}.` : "Route-level latency data is limited.",
      ],
      actions: [
        "Throttle, paginate, or cap the heaviest endpoint responses immediately.",
        "Move the slowest non-interactive route to background or async execution.",
        "Add strict execution timeouts so overloaded requests fail fast instead of stacking.",
      ],
    });
  }

  if ((snapshot.database.pool.pending ?? 0) >= 3 || (snapshot.database.pool.borrowed ?? 0) >= 8) {
    diagnostics.push({
      severity: (snapshot.database.pool.pending ?? 0) >= 6 ? "critical" : "warning",
      title: "Database pool pressure is building",
      summary: "Requests are likely waiting on database connections or long-running queries.",
      signals: [
        `DB pending is ${snapshot.database.pool.pending ?? 0}.`,
        `DB borrowed is ${snapshot.database.pool.borrowed ?? 0}.`,
        topQuery ? `Top SQL pattern is ${topQuery.label} with P95 ${formatDuration(topQuery.p95DurationMs)}.` : "SQL timing data is still warming up.",
      ],
      actions: [
        "Add or fix indexes on the filter, join, and order-by columns used by the slow query.",
        "Reduce the result set by selecting fewer columns and fewer rows.",
        "Split long multi-purpose queries into smaller route-specific queries before increasing pool size.",
      ],
    });
  }

  if (hasMemoryGrowthTrend) {
    diagnostics.push({
      severity: snapshot.process.heapUsedPercent >= 88 ? "critical" : "warning",
      title: "Memory growth suggests retained state or a leak",
      summary: "Memory usage is high or keeps climbing over the selected history window.",
      signals: [
        `Heap used is ${formatMetricNumber(snapshot.process.heapUsedMb, 1)} MB (${formatPercent(snapshot.process.heapUsedPercent)}).`,
        `Heap changed by ${formatMetricNumber(heapGrowth, 1)} MB in the selected history range.`,
        `RSS changed by ${formatMetricNumber(rssGrowth, 1)} MB in the selected history range.`,
      ],
      actions: [
        "Shrink or remove long-lived in-memory caches, maps, arrays, and report buffers.",
        "Add TTL or eviction limits to every cache that can grow with uptime.",
        "Clear retained temporary data after each request or background job completes.",
      ],
    });
  }

  if (hasHighHeapPressure && !hasMemoryGrowthTrend) {
    diagnostics.push({
      severity: snapshot.process.heapUsedPercent >= 95 ? "warning" : "info",
      title: "Heap usage is high right now, but a leak trend is not confirmed",
      summary: "Current heap utilization is elevated, but the selected history window does not show upward memory growth.",
      signals: [
        `Heap used is ${formatMetricNumber(snapshot.process.heapUsedMb, 1)} MB (${formatPercent(snapshot.process.heapUsedPercent)}).`,
        `Heap changed by ${formatMetricNumber(heapGrowth, 1)} MB in the selected history range.`,
        `RSS changed by ${formatMetricNumber(rssGrowth, 1)} MB in the selected history range.`,
      ],
      actions: [
        "Keep this under observation before treating it as a memory leak.",
        "Reduce peak in-request allocations in heavy endpoints if this warning persists under normal traffic.",
        "Only escalate to leak remediation if heap or RSS starts trending upward over time.",
      ],
    });
  }

  if (snapshot.process.eventLoopLagMs >= 120 || snapshot.process.eventLoopUtilization >= 75) {
    diagnostics.push({
      severity: snapshot.process.eventLoopLagMs >= 200 ? "critical" : "warning",
      title: "Node event loop is under pressure",
      summary: "The server may be doing blocking synchronous work or processing very large payloads.",
      signals: [
        `Event loop lag is ${formatDuration(snapshot.process.eventLoopLagMs)}.`,
        `Event loop utilization is ${formatPercent(snapshot.process.eventLoopUtilization)}.`,
        `CPU is ${formatPercent(snapshot.process.cpuPercent)}.`,
      ],
      actions: [
        "Remove synchronous heavy work from request handlers.",
        "Move report generation, exports, and large transformations to background jobs.",
        "Stream or chunk large responses instead of building them fully in memory first.",
      ],
    });
  }

  if (snapshot.process.cpuPercent >= 75 || (latestHistory?.cpuPercent ?? 0) >= 75) {
    diagnostics.push({
      severity: snapshot.process.cpuPercent >= 90 ? "critical" : "warning",
      title: "CPU saturation is contributing to slow responses",
      summary: "The process is spending too much time executing work instead of staying responsive.",
      signals: [
        `Current CPU is ${formatPercent(snapshot.process.cpuPercent)} across ${snapshot.environment.cpuCores} cores.`,
        latestHistory ? `Latest sampled CPU is ${formatPercent(latestHistory.cpuPercent)}.` : "Historical CPU sample is not available.",
        topRoute ? `Most expensive route currently is ${topRoute.method} ${topRoute.routeKey}.` : "Route hotspot not established yet.",
      ],
      actions: [
        "Reduce CPU-heavy request logic or move it off the request path.",
        "Eliminate repeated recomputation and large object serialization in hot endpoints.",
        "Increase production CPU capacity only after the hot path has been reduced.",
      ],
    });
  }

  if (snapshot.traffic.errorRatePercent >= 5 || snapshot.recentErrors.length >= 5) {
    diagnostics.push({
      severity: snapshot.traffic.errorRatePercent >= 10 ? "critical" : "warning",
      title: "Server errors are elevated",
      summary: "The issue is not only slowness; requests are failing as well.",
      signals: [
        `Recent error rate is ${formatPercent(snapshot.traffic.errorRatePercent)}.`,
        `Recent 5xx count is ${snapshot.traffic.recentErrorCount}.`,
        `Stored recent 5xx requests: ${snapshot.recentErrors.length}.`,
      ],
      actions: [
        "Add guards, bounded retries, and timeouts to the failing operation.",
        "Return controlled 4xx or fallback responses where the failure is predictable.",
        "Block further feature changes on the failing route until the 5xx path is removed.",
      ],
    });
  }

  if (snapshot.process.activeRequestCount >= 12) {
    diagnostics.push({
      severity: snapshot.process.activeRequestCount >= 20 ? "critical" : "warning",
      title: "Too many requests are in flight at once",
      summary: "Requests may be hanging or piling up faster than the backend can clear them.",
      signals: [
        `Active requests right now: ${snapshot.process.activeRequestCount}.`,
        `Tracked in-flight request rows: ${snapshot.activeRequests.length}.`,
        `Recent request volume is ${snapshot.traffic.recentRequestCount} in the last ${snapshot.traffic.recentWindowMinutes} minutes.`,
      ],
      actions: [
        "Add strict timeouts to external calls and long-running internal operations.",
        "Apply concurrency limits so the same expensive route cannot pile up indefinitely.",
        "Cancel or short-circuit work as soon as the client disconnects or the result is no longer needed.",
      ],
    });
  }

  if (topQuery && topQuery.p95DurationMs >= 300) {
    diagnostics.push({
      severity: topQuery.p95DurationMs >= 1000 ? "critical" : "warning",
      title: "At least one SQL pattern is materially slow",
      summary: "Database query time is likely a direct contributor to overall request slowness.",
      signals: [
        `${topQuery.label} has P95 ${formatDuration(topQuery.p95DurationMs)} and avg ${formatDuration(topQuery.averageDurationMs)}.`,
        `This query was seen ${formatMetricNumber(topQuery.count)} times.`,
        `Slow query threshold is ${formatDuration(snapshot.database.queries.slowQueryThresholdMs)}.`,
      ],
      actions: [
        "Add the missing index or rewrite the query so it scans less data.",
        "Reduce unnecessary joins, columns, and row volume in this SQL path.",
        "Cache or move analytics and reporting queries to async generation instead of serving them inline.",
      ],
    });
  }

  if (topQueryRoute && topQueryRoute.averageTotalQueryDurationMs >= 250) {
    diagnostics.push({
      severity: topQueryRoute.averageTotalQueryDurationMs >= 800 ? "critical" : "warning",
      title: "One route is spending too much time inside SQL",
      summary: "A specific request path is dominated by database work rather than application logic.",
      signals: [
        `${topQueryRoute.method} ${topQueryRoute.routeKey} averages ${formatDuration(topQueryRoute.averageTotalQueryDurationMs)} of SQL time per request.`,
        `Its max SQL time reached ${formatDuration(topQueryRoute.maxTotalQueryDurationMs)}.`,
        `Top query labels on this route: ${topQueryRoute.topQueryLabels.join(", ") || "none"}.`,
      ],
      actions: [
        "Rewrite this endpoint so it executes fewer queries per request.",
        "Preload related data in one targeted query instead of repeated follow-up queries.",
        "Move expensive reporting or reconciliation logic off the interactive request path.",
      ],
    });
  }

  if (topExternalEndpoint && topExternalEndpoint.p95DurationMs >= 600) {
    diagnostics.push({
      severity: topExternalEndpoint.p95DurationMs >= 1500 ? "critical" : "warning",
      title: "Outbound network calls are contributing meaningful latency",
      summary: "At least one external dependency is slow enough to affect request responsiveness.",
      signals: [
        `${topExternalEndpoint.method} ${topExternalEndpoint.host}${topExternalEndpoint.pathLabel} has P95 ${formatDuration(topExternalEndpoint.p95DurationMs)}.`,
        `Its average duration is ${formatDuration(topExternalEndpoint.averageDurationMs)} across ${formatMetricNumber(topExternalEndpoint.count)} calls.`,
        topExternalEndpoint.lastErrorCode ? `Last error code was ${topExternalEndpoint.lastErrorCode}.` : "No recent transport error was recorded on the latest call.",
      ],
      actions: [
        "Add tight client-side timeouts and fail-fast behavior to this external dependency.",
        "Cache or defer calls that do not need to block the interactive request.",
        "Retry only idempotent calls and keep retry counts bounded to avoid request pileups.",
      ],
    });
  }

  if (history.length < 10) {
    diagnostics.push({
      severity: "info",
      title: "History window is still warming up",
      summary: "There may not be enough samples yet to confirm a trend confidently.",
      signals: [
        `Visible history samples: ${history.length}.`,
        `Current uptime: ${formatUptime(snapshot.process.uptimeSeconds)}.`,
        "Trend-based diagnoses are stronger after several hours of runtime.",
      ],
      actions: [
        "Keep persistent snapshot storage enabled so longer history windows remain available.",
        "Avoid structural performance changes until the system has accumulated a meaningful baseline.",
        "Focus immediate work on obvious hot routes or slow SQL instead of trend-based changes.",
      ],
    });
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      severity: "healthy",
      title: "No obvious degradation signal is active",
      summary: "The current snapshot does not show a strong failure pattern.",
      signals: [
        `P95 latency is ${formatDuration(snapshot.traffic.p95ResponseMs)}.`,
        `Heap used is ${formatMetricNumber(snapshot.process.heapUsedMb, 1)} MB.`,
        `DB pending is ${snapshot.database.pool.pending ?? 0}.`,
      ],
      actions: [
        "Keep the current runtime configuration unchanged until a measurable degradation signal appears.",
        "Let persisted history continue accumulating so later regressions have a usable baseline.",
        "Prioritize route-to-SQL correlation next if the slowdown reappears without a visible signal here.",
      ],
    });
  }

  return diagnostics.sort((left, right) => severityRank[left.severity] - severityRank[right.severity]);
};

const MetricCard = ({
  title,
  value,
  subtitle,
  icon,
  color = "blue",
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: ReactNode;
  color?: string;
}) => (
  <Paper withBorder radius="xl" p="md" shadow="xs" style={{ height: "100%" }}>
    <Stack gap={8} align="center" justify="center" style={{ textAlign: "center", height: "100%" }}>
      <ThemeIcon size={38} radius="xl" color={color} variant="light">
        {icon}
      </ThemeIcon>
      <Text size="xs" fw={800} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.08em" }}>
        {title}
      </Text>
      <Text fw={800} size="1.6rem" style={{ lineHeight: 1.05 }}>
        {value}
      </Text>
      <Text size="sm" c="dimmed">
        {subtitle}
      </Text>
    </Stack>
  </Paper>
);

const SectionCard = ({
  icon,
  title,
  badge,
  children,
}: {
  icon: ReactNode;
  title: string;
  badge?: string | number;
  children: ReactNode;
}) => (
  <Paper
    withBorder
    radius={28}
    p="lg"
    shadow="sm"
    style={{
      background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 100%)",
    }}
  >
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Group gap="sm">
          <ThemeIcon size={40} radius="xl" color="blue" variant="light">
            {icon}
          </ThemeIcon>
          <Title order={3}>{title}</Title>
        </Group>
        {badge != null ? (
          <Badge radius="xl" variant="light" color="gray">
            {badge}
          </Badge>
        ) : null}
      </Group>
      {children}
    </Stack>
  </Paper>
);

const ChartTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length || !label) {
    return null;
  }

  return (
    <Paper withBorder shadow="md" radius="md" p="sm">
      <Stack gap={4}>
        <Text fw={900} size="sm">
          {formatChartTimestamp(label)}
        </Text>
        {payload.map((entry) => (
          <Group key={`${entry.name}-${entry.color}`} gap={8} justify="space-between" wrap="nowrap">
            <Text fw={800} size="sm" c={entry.color || "dark"}>
              {entry.name}
            </Text>
            <Text size="sm">
              {entry.name?.toLowerCase().includes("rate") || entry.name?.toLowerCase().includes("utilization")
                ? formatPercent(entry.value ?? 0)
                : entry.name?.toLowerCase().includes("count")
                  ? formatMetricNumber(entry.value ?? 0, 0)
                  : entry.name?.toLowerCase().includes("ms")
                    ? formatDuration(entry.value ?? 0)
                    : `${formatMetricNumber(entry.value ?? 0, 2)} MB`}
            </Text>
          </Group>
        ))}
      </Stack>
    </Paper>
  );
};

const PerformancePage = ({ title }: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [snapshot, setSnapshot] = useState<PerformanceSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyRange, setHistoryRange] = useState<HistoryRange>("7d");
  const [customHistoryRange, setCustomHistoryRange] = useState<CustomHistoryRangeValue>(() => createDefaultCustomHistoryRange());
  const [sessionScope, setSessionScope] = useState<SessionScope>("all");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [explainResult, setExplainResult] = useState<PerformanceExplainResponse | null>(null);
  const [explainLoadingSql, setExplainLoadingSql] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [heapCaptureState, setHeapCaptureState] = useState<{
    loading: boolean;
    error: string | null;
    lastCapture: CaptureHeapSnapshotResponse | null;
  }>({
    loading: false,
    error: null,
    lastCapture: null,
  });
  const [tablePages, setTablePages] = useState<Record<PaginatedSectionKey, number>>({
    routes: 1,
    activeRequests: 1,
    slowRequests: 1,
    errors: 1,
    topQueries: 1,
    slowQueries: 1,
    queryRoutes: 1,
    requestQueries: 1,
    externalEndpoints: 1,
    externalSlowCalls: 1,
  });
  const tablePageSize = isMobile ? 6 : 10;

  useEffect(() => {
    dispatch(navigateToPage("/performance"));
  }, [dispatch]);

  useEffect(() => {
    let cancelled = false;

    const load = async (showLoader = false) => {
      if (showLoader) {
        setLoading(true);
      }
      try {
        const data = await fetchPerformanceSnapshot();
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
        }
      } catch (fetchError) {
        if (cancelled) {
          return;
        }
        if (isAxiosError(fetchError)) {
          setError(fetchError.response?.data?.message || fetchError.message || "Failed to load performance snapshot");
        } else if (fetchError instanceof Error) {
          setError(fetchError.message);
        } else {
          setError("Failed to load performance snapshot");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load(true);
    const intervalId = window.setInterval(() => {
      void load(false);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    if (sessionScope === "current") {
      setSelectedSessionId(snapshot.currentSessionId);
      return;
    }
    if (sessionScope === "specific") {
      const exists = snapshot.restartSessions.some((session) => session.sessionId === selectedSessionId);
      if (!exists) {
        setSelectedSessionId(snapshot.restartSessions[0]?.sessionId ?? null);
      }
      return;
    }
    setSelectedSessionId(null);
  }, [selectedSessionId, sessionScope, snapshot]);

  const history = useMemo(() => {
    const source = snapshot?.history ?? [];
    const sessionFiltered =
      sessionScope === "all"
        ? source
        : source.filter((point) =>
            sessionScope === "current"
              ? point.sessionId === snapshot?.currentSessionId
              : selectedSessionId
                ? point.sessionId === selectedSessionId
                : true,
          );
    if (historyRange === "custom") {
      const [start, end] = customHistoryRange;
      if (!start || !end) {
        return sessionFiltered;
      }
      const rangeStart = dayjs(start);
      const rangeEnd = dayjs(end);
      return sessionFiltered.filter((point) => {
        const timestamp = dayjs(point.timestamp);
        return (
          (timestamp.isAfter(rangeStart) || timestamp.isSame(rangeStart)) &&
          (timestamp.isBefore(rangeEnd) || timestamp.isSame(rangeEnd))
        );
      });
    }
    const now = dayjs();
    const threshold =
      historyRange === "24h"
        ? now.subtract(24, "hour")
        : historyRange === "30d"
          ? now.subtract(30, "day")
          : now.subtract(7, "day");
    return sessionFiltered.filter((point) => dayjs(point.timestamp).isAfter(threshold));
  }, [customHistoryRange, historyRange, selectedSessionId, sessionScope, snapshot?.currentSessionId, snapshot?.history]);

  const historyRangeLabel = useMemo(() => {
    if (historyRange !== "custom") {
      return historyRange;
    }
    const [start, end] = customHistoryRange;
    if (!start || !end) {
      return "custom";
    }
    return `${dayjs(start).format("DD/MM/YYYY HH:mm:ss")} - ${dayjs(end).format("DD/MM/YYYY HH:mm:ss")}`;
  }, [customHistoryRange, historyRange]);

  const minHistoryDate = useMemo(() => {
    const firstPoint = snapshot?.history?.[0];
    return firstPoint ? dayjs(firstPoint.timestamp).toDate() : undefined;
  }, [snapshot?.history]);

  const maxHistoryDate = useMemo(() => {
    const source = snapshot?.history ?? [];
    const lastPoint = source[source.length - 1];
    return lastPoint ? dayjs(lastPoint.timestamp).toDate() : new Date();
  }, [snapshot?.history]);

  const sessionOptions = useMemo(
    () =>
      (snapshot?.restartSessions ?? []).map((session) => ({
        value: session.sessionId,
        label: `${session.isCurrent ? "Current" : "Restart"}: ${formatTimestamp(session.startedAt)}${session.endedAt ? ` -> ${formatTimestamp(session.endedAt)}` : " -> now"}`,
      })),
    [snapshot?.restartSessions],
  );

  const requestHistory = useMemo(
    () =>
      history.map((point) => ({
        timestamp: point.timestamp,
        p95Ms: point.p95ResponseMs,
        avgMs: point.averageResponseMs,
        errorRate: point.errorRatePercent,
      })),
    [history],
  );

  const resourceHistory = useMemo(
    () =>
      history.map((point) => ({
        timestamp: point.timestamp,
        rssMb: point.rssMb,
        heapMb: point.heapUsedMb,
        cpuPercent: point.cpuPercent,
        eventLoopLagMs: point.eventLoopLagMs,
      })),
    [history],
  );

  const routeTotalPages = getTotalPages(snapshot?.topRoutes.length ?? 0, tablePageSize);
  const activeRequestTotalPages = getTotalPages(snapshot?.activeRequests.length ?? 0, tablePageSize);
  const slowRequestTotalPages = getTotalPages(snapshot?.recentSlowRequests.length ?? 0, tablePageSize);
  const errorTotalPages = getTotalPages(snapshot?.recentErrors.length ?? 0, tablePageSize);
  const topQueryTotalPages = getTotalPages(snapshot?.database.queries.topQueries.length ?? 0, tablePageSize);
  const slowQueryTotalPages = getTotalPages(snapshot?.database.queries.recentSlowQueries.length ?? 0, tablePageSize);
  const queryRouteTotalPages = getTotalPages(snapshot?.database.queries.routeCorrelations.length ?? 0, tablePageSize);
  const requestQueryTotalPages = getTotalPages(snapshot?.database.queries.recentRequestCorrelations.length ?? 0, tablePageSize);
  const externalEndpointTotalPages = getTotalPages(snapshot?.externalCalls.topEndpoints.length ?? 0, tablePageSize);
  const externalSlowCallTotalPages = getTotalPages(snapshot?.externalCalls.recentSlowCalls.length ?? 0, tablePageSize);

  const routePage = Math.min(tablePages.routes, routeTotalPages);
  const activeRequestPage = Math.min(tablePages.activeRequests, activeRequestTotalPages);
  const slowRequestPage = Math.min(tablePages.slowRequests, slowRequestTotalPages);
  const errorPage = Math.min(tablePages.errors, errorTotalPages);
  const topQueryPage = Math.min(tablePages.topQueries, topQueryTotalPages);
  const slowQueryPage = Math.min(tablePages.slowQueries, slowQueryTotalPages);
  const queryRoutePage = Math.min(tablePages.queryRoutes, queryRouteTotalPages);
  const requestQueryPage = Math.min(tablePages.requestQueries, requestQueryTotalPages);
  const externalEndpointPage = Math.min(tablePages.externalEndpoints, externalEndpointTotalPages);
  const externalSlowCallPage = Math.min(tablePages.externalSlowCalls, externalSlowCallTotalPages);

  const visibleRoutes = paginateItems(snapshot?.topRoutes ?? [], routePage, tablePageSize);
  const visibleActiveRequests = paginateItems(snapshot?.activeRequests ?? [], activeRequestPage, tablePageSize);
  const visibleSlowRequests = paginateItems(snapshot?.recentSlowRequests ?? [], slowRequestPage, tablePageSize);
  const visibleErrors = paginateItems(snapshot?.recentErrors ?? [], errorPage, tablePageSize);
  const visibleTopQueries = paginateItems(snapshot?.database.queries.topQueries ?? [], topQueryPage, tablePageSize);
  const visibleSlowQueries = paginateItems(snapshot?.database.queries.recentSlowQueries ?? [], slowQueryPage, tablePageSize);
  const visibleQueryRoutes = paginateItems(snapshot?.database.queries.routeCorrelations ?? [], queryRoutePage, tablePageSize);
  const visibleRequestQueryCorrelations = paginateItems(
    snapshot?.database.queries.recentRequestCorrelations ?? [],
    requestQueryPage,
    tablePageSize,
  );
  const visibleExternalEndpoints = paginateItems(
    snapshot?.externalCalls.topEndpoints ?? [],
    externalEndpointPage,
    tablePageSize,
  );
  const visibleExternalSlowCalls = paginateItems(
    snapshot?.externalCalls.recentSlowCalls ?? [],
    externalSlowCallPage,
    tablePageSize,
  );
  const diagnosisItems = useMemo(() => (snapshot ? generateDiagnostics(snapshot, history) : []), [history, snapshot]);

  const diagnosticBundle = useMemo(() => {
    if (!snapshot) {
      return "";
    }

    const topRoutes = snapshot.topRoutes.slice(0, 5);
    const topQueries = snapshot.database.queries.topQueries.slice(0, 5);
    const queryRoutes = snapshot.database.queries.routeCorrelations.slice(0, 5);
    const requestQueryCorrelations = snapshot.database.queries.recentRequestCorrelations.slice(0, 5);
    const externalEndpoints = snapshot.externalCalls.topEndpoints.slice(0, 5);
    const externalSlowCalls = snapshot.externalCalls.recentSlowCalls.slice(0, 5);
    const slowRequests = snapshot.recentSlowRequests.slice(0, 5);
    const errorRequests = snapshot.recentErrors.slice(0, 5);
    const activeRequests = snapshot.activeRequests.slice(0, 5);
    const activeHandles = snapshot.handles.slice(0, 5);
    const heapSnapshots = snapshot.heapSnapshots.recentSnapshots.slice(0, 5);
    const diagnoses = diagnosisItems.slice(0, 5);
    const topUsersInSlowRequests = summarizeActors(snapshot.recentSlowRequests);
    const topUserTypesInSlowRequests = summarizeUserTypes(snapshot.recentSlowRequests);
    const topUsersInRequestQueryCorrelations = summarizeActors(
      snapshot.database.queries.recentRequestCorrelations,
    );
    const topUsersInSlowExternalCalls = summarizeActors(snapshot.externalCalls.recentSlowCalls);
    const selectedSession =
      sessionScope === "current"
        ? snapshot.restartSessions.find((session) => session.sessionId === snapshot.currentSessionId) ?? null
        : sessionScope === "specific" && selectedSessionId
          ? snapshot.restartSessions.find((session) => session.sessionId === selectedSessionId) ?? null
          : null;

    return [
      "OmniLodge Performance Diagnostic Bundle",
      `Generated At: ${formatTimestamp(snapshot.generatedAt)}`,
      `History Range: ${historyRangeLabel}`,
      `Session Scope: ${sessionScope}${selectedSessionId ? ` (${selectedSessionId})` : ""}`,
      `Process Started At: ${formatTimestamp(snapshot.startedAt)}`,
      `Hostname: ${snapshot.environment.hostname}`,
      `Platform: ${snapshot.environment.platform} ${snapshot.environment.release}`,
      `PID: ${snapshot.environment.processId}`,
      `Filtered History Samples: ${formatMetricNumber(history.length)}`,
      "",
      "Restart Session",
      `- Current Session Id: ${snapshot.currentSessionId}`,
      ...(selectedSession
        ? [
            `- Selected Session Id: ${selectedSession.sessionId}`,
            `- Selected Session Start: ${formatTimestamp(selectedSession.startedAt)}`,
            `- Selected Session End: ${selectedSession.endedAt ? formatTimestamp(selectedSession.endedAt) : "now"}`,
            `- Selected Session Samples: ${formatMetricNumber(selectedSession.sampleCount)}`,
          ]
        : ["- Selected Session: none"]),
      "",
      "Top Metrics",
      `- P95 Latency: ${formatDuration(snapshot.traffic.p95ResponseMs)}`,
      `- Average Latency: ${formatDuration(snapshot.traffic.averageResponseMs)}`,
      `- Active Requests: ${formatMetricNumber(snapshot.process.activeRequestCount)}`,
      `- CPU: ${formatPercent(snapshot.process.cpuPercent)}`,
      `- Heap Used: ${formatMetricNumber(snapshot.process.heapUsedMb, 1)} MB (${formatPercent(snapshot.process.heapUsedPercent)})`,
      `- RSS: ${formatMetricNumber(snapshot.process.rssMb, 1)} MB`,
      `- Event Loop Lag: ${formatDuration(snapshot.process.eventLoopLagMs)}`,
      `- DB Pending: ${formatMetricNumber(snapshot.database.pool.pending ?? 0)}`,
      `- DB Borrowed: ${formatMetricNumber(snapshot.database.pool.borrowed ?? 0)}`,
      `- Recent Error Rate: ${formatPercent(snapshot.traffic.errorRatePercent)}`,
      "",
      "Runtime Health",
      `- Uptime: ${formatUptime(snapshot.process.uptimeSeconds)}`,
      `- Heap Total: ${formatMetricNumber(snapshot.process.heapTotalMb, 1)} MB`,
      `- External: ${formatMetricNumber(snapshot.process.externalMb, 1)} MB`,
      `- System Memory Used: ${formatMetricNumber(snapshot.system.usedMemoryMb, 1)} MB (${formatPercent(snapshot.system.usedMemoryPercent)})`,
      `- Load Average: ${snapshot.system.loadAverage.map((value) => formatMetricNumber(value, 2)).join(" / ")}`,
      `- DB Pool Size: ${formatMetricNumber(snapshot.database.pool.size ?? 0)}`,
      `- DB Pool Available: ${formatMetricNumber(snapshot.database.pool.available ?? 0)}`,
      `- DB Pool Borrowed: ${formatMetricNumber(snapshot.database.pool.borrowed ?? 0)}`,
      `- DB Pool Pending: ${formatMetricNumber(snapshot.database.pool.pending ?? 0)}`,
      "",
      "Traffic Context",
      `- Requests Since Start: ${formatMetricNumber(snapshot.traffic.totalRequestsSinceStart)}`,
      `- 5xx Since Start: ${formatMetricNumber(snapshot.traffic.totalErrorsSinceStart)}`,
      `- Recent Request Count: ${formatMetricNumber(snapshot.traffic.recentRequestCount)}`,
      `- Recent Slow Request Count: ${formatMetricNumber(snapshot.traffic.slowRequestCount)}`,
      `- Recent 5xx Count: ${formatMetricNumber(snapshot.traffic.recentErrorCount)}`,
      "",
      "Diagnosis",
      ...(diagnoses.length > 0
        ? diagnoses.flatMap((item, index) => [
            `${index + 1}. [${item.severity.toUpperCase()}] ${item.title}`,
            `   Summary: ${item.summary}`,
            ...item.signals.map((signal) => `   Signal: ${signal}`),
            ...item.actions.map((action) => `   Action: ${action}`),
          ])
        : ["- No active diagnosis items."]),
      "",
      "Top Users In Slow Requests",
      ...(topUsersInSlowRequests.length > 0 ? topUsersInSlowRequests : ["- None"]),
      "",
      "Top User Types In Slow Requests",
      ...(topUserTypesInSlowRequests.length > 0 ? topUserTypesInSlowRequests : ["- None"]),
      "",
      "Top Users In Request Query Correlations",
      ...(topUsersInRequestQueryCorrelations.length > 0 ? topUsersInRequestQueryCorrelations : ["- None"]),
      "",
      "Top Users In Slow External Calls",
      ...(topUsersInSlowExternalCalls.length > 0 ? topUsersInSlowExternalCalls : ["- None"]),
      "",
      "Top Slow Routes",
      ...(topRoutes.length > 0
        ? topRoutes.map(
            (route, index) =>
              `${index + 1}. ${route.method} ${route.routeKey} | p95=${formatDuration(route.p95ResponseMs)} | avg=${formatDuration(route.averageResponseMs)} | count=${formatMetricNumber(route.requestCount)} | errors=${formatMetricNumber(route.errorCount)}`,
          )
        : ["- None"]),
      "",
      "Top Slow SQL Patterns",
      ...(topQueries.length > 0
        ? topQueries.map(
            (query, index) =>
              `${index + 1}. ${query.label} | p95=${formatDuration(query.p95DurationMs)} | avg=${formatDuration(query.averageDurationMs)} | count=${formatMetricNumber(query.count)} | sql=${query.sqlSnippet}`,
          )
        : ["- None"]),
      "",
      "Route To SQL Correlation",
      ...(queryRoutes.length > 0
        ? queryRoutes.map(
            (route, index) =>
              `${index + 1}. ${route.method} ${route.routeKey} | avg-sql=${formatDuration(route.averageTotalQueryDurationMs)} | max-sql=${formatDuration(route.maxTotalQueryDurationMs)} | top=${route.topQueryLabels.join(", ") || "-"}`,
          )
        : ["- None"]),
      "",
      "Recent Request Query Correlations",
      ...(requestQueryCorrelations.length > 0
        ? requestQueryCorrelations.map(
            (request, index) =>
              `${index + 1}. ${request.method} ${request.routeKey} | user=${formatUserIdentity(request)} | request=${formatDuration(request.requestDurationMs)} | sql=${formatDuration(request.totalQueryDurationMs)} | queries=${request.queries.map((query) => query.label).join(", ") || "-"}`,
          )
        : ["- None"]),
      "",
      "Top External Calls",
      ...(externalEndpoints.length > 0
        ? externalEndpoints.map(
            (call, index) =>
              `${index + 1}. ${call.method} ${call.host}${call.pathLabel} | p95=${formatDuration(call.p95DurationMs)} | avg=${formatDuration(call.averageDurationMs)} | count=${formatMetricNumber(call.count)} | status=${call.lastStatusCode ?? "-"} | error=${call.lastErrorCode ?? "-"}`,
          )
        : ["- None"]),
      "",
      "Recent Slow External Calls",
      ...(externalSlowCalls.length > 0
        ? externalSlowCalls.map(
            (call, index) =>
              `${index + 1}. ${call.method} ${call.host}${call.path} | user=${formatUserIdentity(call)} | duration=${formatDuration(call.durationMs)} | route=${call.routeKey ?? "-"} | status=${call.statusCode ?? "-"} | error=${call.errorCode ?? "-"}`,
          )
        : ["- None"]),
      "",
      "Current In-Flight Requests",
      ...(activeRequests.length > 0
        ? activeRequests.map(
            (request, index) =>
              `${index + 1}. ${request.method} ${request.routeKey} | user=${formatUserIdentity(request)} | running=${formatDuration(request.runningForMs)} | started=${formatTimestamp(request.startedAt)}`,
          )
        : ["- None"]),
      "",
      "Active Handles",
      ...(activeHandles.length > 0
        ? activeHandles.map(
            (handle, index) =>
              `${index + 1}. ${handle.type} | count=${formatMetricNumber(handle.count)}`,
          )
        : ["- None"]),
      "",
      "Recent Slow Requests",
      ...(slowRequests.length > 0
        ? slowRequests.map(
            (request, index) =>
              `${index + 1}. ${request.method} ${request.routeKey} | user=${formatUserIdentity(request)} | status=${request.statusCode} | duration=${formatDuration(request.durationMs)} | started=${formatTimestamp(request.startedAt)}`,
          )
        : ["- None"]),
      "",
      "Recent 5xx Requests",
      ...(errorRequests.length > 0
        ? errorRequests.map(
            (request, index) =>
              `${index + 1}. ${request.method} ${request.routeKey} | user=${formatUserIdentity(request)} | status=${request.statusCode} | duration=${formatDuration(request.durationMs)} | started=${formatTimestamp(request.startedAt)}`,
          )
        : ["- None"]),
      "",
      "Heap Snapshots",
      `- Directory: ${snapshot.heapSnapshots.directory}`,
      ...(heapSnapshots.length > 0
        ? heapSnapshots.map(
            (file, index) =>
              `${index + 1}. ${file.fileName} | created=${formatTimestamp(file.createdAt)} | size=${formatMetricNumber(file.sizeMb, 2)} MB`,
          )
        : ["- None"]),
    ].join("\n");
  }, [diagnosisItems, history.length, historyRangeLabel, selectedSessionId, sessionScope, snapshot]);

  const setSectionPage = (section: PaginatedSectionKey, page: number) => {
    setTablePages((current) => ({ ...current, [section]: page }));
  };

  const handleCopyDiagnosticBundle = async () => {
    if (!diagnosticBundle) {
      return;
    }
    try {
      await navigator.clipboard.writeText(diagnosticBundle);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const handleRunExplain = async (sql: string) => {
    setExplainLoadingSql(sql);
    setExplainError(null);
    try {
      const response = await runPerformanceExplain(sql);
      setExplainResult(response);
    } catch (caughtError) {
      const message = isAxiosError<{ message?: string }>(caughtError)
        ? caughtError.response?.data?.message ?? caughtError.message
        : caughtError instanceof Error
          ? caughtError.message
          : "Failed to run EXPLAIN ANALYZE";
      setExplainError(message);
    } finally {
      setExplainLoadingSql(null);
    }
  };

  const handleCaptureHeapSnapshot = async () => {
    setHeapCaptureState((current) => ({
      ...current,
      loading: true,
      error: null,
    }));
    try {
      const response = await capturePerformanceHeapSnapshot();
      setHeapCaptureState({
        loading: false,
        error: null,
        lastCapture: response,
      });
      setSnapshot((current) =>
        current
          ? {
              ...current,
              heapSnapshots: {
                ...current.heapSnapshots,
                recentSnapshots: [response.snapshot, ...current.heapSnapshots.recentSnapshots]
                  .sort(
                    (left, right) =>
                      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
                  )
                  .slice(0, 20),
              },
            }
          : current,
      );
    } catch (caughtError) {
      const message = isAxiosError<{ message?: string }>(caughtError)
        ? caughtError.response?.data?.message ?? caughtError.message
        : caughtError instanceof Error
          ? caughtError.message
          : "Failed to capture heap snapshot";
      setHeapCaptureState({
        loading: false,
        error: message,
        lastCapture: null,
      });
    }
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="lg" p={isMobile ? "sm" : "lg"}>
        <Paper
          withBorder
          radius={32}
          p={isMobile ? "lg" : "xl"}
          shadow="sm"
          style={{
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(30,41,59,0.98) 52%, rgba(15,118,110,0.92) 100%)",
            color: "#fff",
          }}
        >
          <Stack gap="md" align="center" style={{ textAlign: "center" }}>
            <Badge variant="light" color="teal" radius="xl">
              Administrator Only
            </Badge>
            <Title order={1} c="white">
              {title}
            </Title>
            {snapshot ? (
              <Group gap="xs" justify="center">
                <Badge radius="xl" color="gray" variant="light">
                  {snapshot.environment.hostname}
                </Badge>
                <Badge radius="xl" color="gray" variant="light">
                  {snapshot.environment.platform} {snapshot.environment.release}
                </Badge>
                <Badge radius="xl" color="gray" variant="light">
                  PID {snapshot.environment.processId}
                </Badge>
                <Badge radius="xl" color="gray" variant="light">
                  Updated {dayjs(snapshot.generatedAt).format("HH:mm:ss")}
                </Badge>
              </Group>
            ) : null}
          </Stack>
        </Paper>

        {loading && !snapshot ? (
          <Paper withBorder radius="xl" p="xl">
            <Group justify="center" py="xl">
              <Loader variant="dots" />
            </Group>
          </Paper>
        ) : null}

        {error ? (
          <Alert radius="xl" color="red" icon={<IconAlertTriangle size={18} />} title="Performance snapshot unavailable">
            {error}
          </Alert>
        ) : null}

        {snapshot ? (
          <>
            <Paper withBorder radius="xl" p="md" shadow="xs">
              <Group justify="space-between" align="center" wrap="wrap">
                <Stack gap={2}>
                  <Text fw={700}>History Range</Text>
                  <Text size="sm" c="dimmed">
                    Historical charts use persisted snapshots and live in-memory samples for the selected window.
                  </Text>
                </Stack>
                <Group gap="sm" wrap="wrap" justify="flex-end">
                  <SegmentedControl
                    value={sessionScope}
                    onChange={(value) => setSessionScope(value as SessionScope)}
                    data={[
                      { label: "All Data", value: "all" },
                      { label: "Current Session", value: "current" },
                      { label: "Specific Session", value: "specific" },
                    ]}
                    radius="xl"
                  />
                  <SegmentedControl
                    value={historyRange}
                    onChange={(value) => {
                      const nextRange = value as HistoryRange;
                      setHistoryRange(nextRange);
                      if (nextRange === "custom" && (!customHistoryRange[0] || !customHistoryRange[1])) {
                        setCustomHistoryRange(createDefaultCustomHistoryRange());
                      }
                    }}
                    data={[...HISTORY_RANGE_OPTIONS]}
                    radius="xl"
                  />
                  <Button
                    radius="xl"
                    variant="light"
                    leftSection={<IconCopy size={16} />}
                    color={copyState === "error" ? "red" : copyState === "copied" ? "teal" : "dark"}
                    onClick={() => {
                      void handleCopyDiagnosticBundle();
                    }}
                  >
                    {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy Diagnostic Bundle"}
                  </Button>
                </Group>
              </Group>
              {sessionScope === "specific" ? (
                <Select
                  label="Restart Session"
                  placeholder="Select a restart session"
                  value={selectedSessionId}
                  onChange={setSelectedSessionId}
                  data={sessionOptions}
                  radius="xl"
                  searchable
                  nothingFoundMessage="No restart sessions"
                  maw={isMobile ? undefined : 620}
                />
              ) : null}
              {historyRange === "custom" ? (
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <DateTimePicker
                    value={customHistoryRange[0]}
                    onChange={(value) => setCustomHistoryRange((current) => [value, current[1]])}
                    valueFormat="DD/MM/YYYY HH:mm:ss"
                    label="Start"
                    placeholder="Select start date and time"
                    leftSection={<IconCalendarEvent size={16} />}
                    radius="xl"
                    maxDate={maxHistoryDate}
                    minDate={minHistoryDate}
                    withSeconds
                  />
                  <DateTimePicker
                    value={customHistoryRange[1]}
                    onChange={(value) => setCustomHistoryRange((current) => [current[0], value])}
                    valueFormat="DD/MM/YYYY HH:mm:ss"
                    label="End"
                    placeholder="Select end date and time"
                    leftSection={<IconCalendarEvent size={16} />}
                    radius="xl"
                    maxDate={maxHistoryDate}
                    minDate={minHistoryDate}
                    withSeconds
                  />
                </SimpleGrid>
              ) : null}
            </Paper>

            <SimpleGrid cols={{ base: 2, sm: 3, xl: 6 }} spacing="md">
              <MetricCard
                title="P95 Latency"
                value={formatDuration(snapshot.traffic.p95ResponseMs)}
                subtitle={`Last ${snapshot.traffic.recentWindowMinutes} min`}
                color={statusColor(snapshot.traffic.p95ResponseMs, 600, 1500)}
                icon={<IconClock size={20} />}
              />
              <MetricCard
                title="Active Requests"
                value={formatMetricNumber(snapshot.process.activeRequestCount)}
                subtitle="Current in-flight"
                color={statusColor(snapshot.process.activeRequestCount, 10, 25)}
                icon={<IconActivity size={20} />}
              />
              <MetricCard
                title="CPU"
                value={formatPercent(snapshot.process.cpuPercent)}
                subtitle={`${snapshot.environment.cpuCores} cores`}
                color={statusColor(snapshot.process.cpuPercent, 55, 80)}
                icon={<IconCpu size={20} />}
              />
              <MetricCard
                title="Heap Used"
                value={`${formatMetricNumber(snapshot.process.heapUsedMb, 1)} MB`}
                subtitle={formatPercent(snapshot.process.heapUsedPercent)}
                color={statusColor(snapshot.process.heapUsedPercent, 70, 85)}
                icon={<IconServer size={20} />}
              />
              <MetricCard
                title="Event Loop Lag"
                value={formatDuration(snapshot.process.eventLoopLagMs)}
                subtitle={`Utilization ${formatPercent(snapshot.process.eventLoopUtilization)}`}
                color={statusColor(snapshot.process.eventLoopLagMs, 80, 150)}
                icon={<IconChartLine size={20} />}
              />
              <MetricCard
                title="DB Queue"
                value={formatMetricNumber(snapshot.database.pool.pending ?? 0)}
                subtitle={`Borrowed ${formatMetricNumber(snapshot.database.pool.borrowed ?? 0)}`}
                color={statusColor(snapshot.database.pool.pending ?? 0, 2, 6)}
                icon={<IconDatabase size={20} />}
              />
            </SimpleGrid>

            <SectionCard
              icon={<IconAlertTriangle size={20} />}
              title="Diagnosis"
              badge={diagnosisItems.length}
            >
              <Stack gap="md">
                {diagnosisItems.map((item, index) => (
                  <Paper key={`${item.title}-${index}`} withBorder radius="xl" p="md">
                    <Stack gap="sm">
                      <Group justify="space-between" align="center" wrap="wrap">
                        <Text fw={800}>{item.title}</Text>
                        <Badge radius="xl" color={severityColorMap[item.severity]} variant="light">
                          {item.severity.toUpperCase()}
                        </Badge>
                      </Group>
                      <Text c="dimmed" size="sm">
                        {item.summary}
                      </Text>
                      <Stack gap={4}>
                        <Text fw={700} size="sm">
                          Signals
                        </Text>
                        {item.signals.map((signal, signalIndex) => (
                          <Text key={`${item.title}-signal-${signalIndex}`} size="sm">
                            {signalIndex + 1}. {signal}
                          </Text>
                        ))}
                      </Stack>
                      <Stack gap={4}>
                        <Text fw={700} size="sm">
                          Actions
                        </Text>
                        {item.actions.map((action, actionIndex) => (
                          <Text key={`${item.title}-action-${actionIndex}`} size="sm">
                            {actionIndex + 1}. {action}
                          </Text>
                        ))}
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </SectionCard>

            <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
              <SectionCard icon={<IconChartLine size={20} />} title="Latency Drift">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text c="dimmed" size="sm">
                      Tracks whether request latency or error rate drifts upward as the process stays online.
                    </Text>
                    <Badge variant="light" color="gray">
                      {history.length} samples in {historyRange}
                    </Badge>
                  </Group>
                  <div style={{ width: "100%", height: isMobile ? 260 : 320 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={requestHistory} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#d7dde5" vertical={false} />
                        <XAxis dataKey="timestamp" hide />
                        <YAxis width={48} tickFormatter={(value) => `${Math.round(Number(value))}`} />
                        <YAxis yAxisId="right" orientation="right" width={44} tickFormatter={(value) => `${Math.round(Number(value))}%`} />
                        <RechartsTooltip content={<ChartTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="p95Ms"
                          stroke="#2563eb"
                          fill="rgba(37,99,235,0.16)"
                          strokeWidth={3}
                          name="P95 latency"
                        />
                        <Line
                          type="monotone"
                          dataKey="avgMs"
                          stroke="#0f766e"
                          strokeWidth={2.5}
                          dot={false}
                          name="Average latency"
                        />
                        <Line
                          type="monotone"
                          yAxisId="right"
                          dataKey="errorRate"
                          stroke="#dc2626"
                          strokeWidth={2.5}
                          dot={false}
                          name="Error rate"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Stack>
              </SectionCard>

              <SectionCard icon={<IconServer size={20} />} title="Resource Pressure">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text c="dimmed" size="sm">
                      Memory growth, CPU usage, and event loop delay usually expose leaks or request backlog first.
                    </Text>
                    <Badge variant="light" color="gray">
                      Window {historyRange}
                    </Badge>
                  </Group>
                  <div style={{ width: "100%", height: isMobile ? 260 : 320 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={resourceHistory} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#d7dde5" vertical={false} />
                        <XAxis dataKey="timestamp" hide />
                        <YAxis width={48} tickFormatter={(value) => `${Math.round(Number(value))}`} />
                        <YAxis yAxisId="right" orientation="right" width={44} tickFormatter={(value) => `${Math.round(Number(value))}%`} />
                        <RechartsTooltip content={<ChartTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="rssMb"
                          stroke="#334155"
                          fill="rgba(51,65,85,0.12)"
                          strokeWidth={2.5}
                          name="RSS"
                        />
                        <Area
                          type="monotone"
                          dataKey="heapMb"
                          stroke="#7c3aed"
                          fill="rgba(124,58,237,0.12)"
                          strokeWidth={2.5}
                          name="Heap"
                        />
                        <Line
                          type="monotone"
                          yAxisId="right"
                          dataKey="cpuPercent"
                          stroke="#f59e0b"
                          strokeWidth={2.5}
                          dot={false}
                          name="CPU"
                        />
                        <Line
                          type="monotone"
                          dataKey="eventLoopLagMs"
                          stroke="#dc2626"
                          strokeWidth={2.5}
                          dot={false}
                          name="Lag ms"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Stack>
              </SectionCard>
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
              <SectionCard icon={<IconDatabase size={20} />} title="Runtime Health">
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <Paper withBorder radius="xl" p="md">
                    <Stack gap={6}>
                      <Text size="xs" tt="uppercase" fw={800} c="dimmed">
                        Backend Process
                      </Text>
                      <Text size="sm">Uptime: {formatUptime(snapshot.process.uptimeSeconds)}</Text>
                      <Text size="sm">RSS: {formatMetricNumber(snapshot.process.rssMb, 1)} MB</Text>
                      <Text size="sm">Heap total: {formatMetricNumber(snapshot.process.heapTotalMb, 1)} MB</Text>
                      <Text size="sm">External: {formatMetricNumber(snapshot.process.externalMb, 1)} MB</Text>
                      <Text size="sm">Array buffers: {formatMetricNumber(snapshot.process.arrayBuffersMb, 1)} MB</Text>
                    </Stack>
                  </Paper>
                  <Paper withBorder radius="xl" p="md">
                    <Stack gap={6}>
                      <Text size="xs" tt="uppercase" fw={800} c="dimmed">
                        System
                      </Text>
                      <Text size="sm">Memory used: {formatMetricNumber(snapshot.system.usedMemoryMb, 1)} MB</Text>
                      <Text size="sm">Memory free: {formatMetricNumber(snapshot.system.freeMemoryMb, 1)} MB</Text>
                      <Text size="sm">System memory: {formatPercent(snapshot.system.usedMemoryPercent)}</Text>
                      <Text size="sm">
                        Load avg: {snapshot.system.loadAverage.map((value) => value.toFixed(2)).join(" / ")}
                      </Text>
                      <Text size="sm">Handles: {formatMetricNumber(snapshot.process.activeHandleCount)}</Text>
                    </Stack>
                  </Paper>
                  <Paper withBorder radius="xl" p="md">
                    <Stack gap={6}>
                      <Text size="xs" tt="uppercase" fw={800} c="dimmed">
                        Traffic
                      </Text>
                      <Text size="sm">Requests since restart: {formatMetricNumber(snapshot.traffic.totalRequestsSinceStart)}</Text>
                      <Text size="sm">5xx since restart: {formatMetricNumber(snapshot.traffic.totalErrorsSinceStart)}</Text>
                      <Text size="sm">Slow requests in window: {formatMetricNumber(snapshot.traffic.slowRequestCount)}</Text>
                      <Text size="sm">Recent request count: {formatMetricNumber(snapshot.traffic.recentRequestCount)}</Text>
                      <Text size="sm">Recent avg latency: {formatDuration(snapshot.traffic.averageResponseMs)}</Text>
                    </Stack>
                  </Paper>
                  <Paper withBorder radius="xl" p="md">
                    <Stack gap={6}>
                      <Text size="xs" tt="uppercase" fw={800} c="dimmed">
                        Database Pool
                      </Text>
                      <Text size="sm">Size: {snapshot.database.pool.size ?? "-"}</Text>
                      <Text size="sm">Available: {snapshot.database.pool.available ?? "-"}</Text>
                      <Text size="sm">Borrowed: {snapshot.database.pool.borrowed ?? "-"}</Text>
                      <Text size="sm">Pending: {snapshot.database.pool.pending ?? "-"}</Text>
                      <Text size="sm">
                        Bounds: {snapshot.database.pool.min ?? "-"} / {snapshot.database.pool.max ?? "-"}
                      </Text>
                    </Stack>
                  </Paper>
                </SimpleGrid>
              </SectionCard>

              <SectionCard icon={<IconRoute size={20} />} title="Live Runtime">
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <Paper withBorder radius="xl" p="md">
                    <Stack gap={6}>
                      <Text size="xs" tt="uppercase" fw={800} c="dimmed">
                        Active Handles
                      </Text>
                      {snapshot.handles.length > 0 ? (
                        snapshot.handles.slice(0, 8).map((row) => (
                          <Group key={`handle-${row.type}`} justify="space-between">
                            <Text size="sm">{row.type}</Text>
                            <Badge variant="light" color="gray">
                              {row.count}
                            </Badge>
                          </Group>
                        ))
                      ) : (
                        <Text size="sm" c="dimmed">
                          No handle data available.
                        </Text>
                      )}
                    </Stack>
                  </Paper>
                  <Paper withBorder radius="xl" p="md">
                    <Stack gap={6}>
                      <Text size="xs" tt="uppercase" fw={800} c="dimmed">
                        Active Node Requests
                      </Text>
                      {snapshot.requests.length > 0 ? (
                        snapshot.requests.slice(0, 8).map((row) => (
                          <Group key={`request-${row.type}`} justify="space-between">
                            <Text size="sm">{row.type}</Text>
                            <Badge variant="light" color="gray">
                              {row.count}
                            </Badge>
                          </Group>
                        ))
                      ) : (
                        <Text size="sm" c="dimmed">
                          No low-level request backlog detected.
                        </Text>
                      )}
                    </Stack>
                  </Paper>
                </SimpleGrid>
              </SectionCard>
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
              <SectionCard icon={<IconRoute size={20} />} title="Slowest Routes" badge={snapshot.topRoutes.length}>
                <ScrollArea>
                  <Table highlightOnHover striped>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Route</Table.Th>
                        <Table.Th ta="center">Count</Table.Th>
                        <Table.Th ta="center">P95</Table.Th>
                        <Table.Th ta="center">Avg</Table.Th>
                        <Table.Th ta="center">Max</Table.Th>
                        <Table.Th ta="center">5xx</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {visibleRoutes.map((route) => (
                        <Table.Tr key={`${route.method}-${route.routeKey}`}>
                          <Table.Td>
                            <Stack gap={2}>
                              <Text fw={700}>{route.method}</Text>
                              <Text size="sm" c="dimmed">
                                {route.routeKey}
                              </Text>
                            </Stack>
                          </Table.Td>
                          <Table.Td ta="center">{formatMetricNumber(route.requestCount)}</Table.Td>
                          <Table.Td ta="center">{formatDuration(route.p95ResponseMs)}</Table.Td>
                          <Table.Td ta="center">{formatDuration(route.averageResponseMs)}</Table.Td>
                          <Table.Td ta="center">{formatDuration(route.maxResponseMs)}</Table.Td>
                          <Table.Td ta="center">{formatMetricNumber(route.errorCount)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
                {routeTotalPages > 1 ? (
                  <Group justify="center">
                    <Pagination
                      value={routePage}
                      onChange={(page) => setSectionPage("routes", page)}
                      total={routeTotalPages}
                      radius="xl"
                      size={isMobile ? "sm" : "md"}
                    />
                  </Group>
                ) : null}
              </SectionCard>

              <SectionCard
                icon={<IconActivity size={20} />}
                title="Current In-Flight Requests"
                badge={snapshot.activeRequests.length}
              >
                {snapshot.activeRequests.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No requests are currently in flight.
                  </Text>
                ) : (
                  <>
                    <ScrollArea>
                      <Table highlightOnHover striped>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Route</Table.Th>
                            <Table.Th>User</Table.Th>
                            <Table.Th ta="center">Running</Table.Th>
                            <Table.Th ta="center">Started</Table.Th>
                            <Table.Th ta="center">IP</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {visibleActiveRequests.map((request) => (
                            <Table.Tr key={request.id}>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text fw={700}>{request.method}</Text>
                                  <Text size="sm" c="dimmed">
                                    {request.routeKey}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm" c="dimmed">
                                  {formatUserIdentity(request)}
                                </Text>
                              </Table.Td>
                              <Table.Td ta="center">{formatDuration(request.runningForMs)}</Table.Td>
                              <Table.Td ta="center">{dayjs(request.startedAt).format("HH:mm:ss")}</Table.Td>
                              <Table.Td ta="center">{request.ip ?? "-"}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                    {activeRequestTotalPages > 1 ? (
                      <Group justify="center">
                        <Pagination
                          value={activeRequestPage}
                          onChange={(page) => setSectionPage("activeRequests", page)}
                          total={activeRequestTotalPages}
                          radius="xl"
                          size={isMobile ? "sm" : "md"}
                        />
                      </Group>
                    ) : null}
                  </>
                )}
              </SectionCard>
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
              <SectionCard
                icon={<IconClock size={20} />}
                title="Recent Slow Requests"
                badge={snapshot.recentSlowRequests.length}
              >
                {snapshot.recentSlowRequests.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No slow requests have crossed the configured threshold since the current backend process started.
                  </Text>
                ) : (
                  <>
                    <ScrollArea>
                      <Table highlightOnHover striped>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>When</Table.Th>
                            <Table.Th>Route</Table.Th>
                            <Table.Th>User</Table.Th>
                            <Table.Th ta="center">Duration</Table.Th>
                            <Table.Th ta="center">Status</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {visibleSlowRequests.map((request) => (
                            <Table.Tr key={`slow-${request.id}`}>
                              <Table.Td>{formatTimestamp(request.startedAt)}</Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text fw={700}>{request.method}</Text>
                                  <Text size="sm" c="dimmed">
                                    {request.routeKey}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm" c="dimmed">
                                  {formatUserIdentity(request)}
                                </Text>
                              </Table.Td>
                              <Table.Td ta="center">{formatDuration(request.durationMs)}</Table.Td>
                              <Table.Td ta="center">{request.statusCode}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                    {slowRequestTotalPages > 1 ? (
                      <Group justify="center">
                        <Pagination
                          value={slowRequestPage}
                          onChange={(page) => setSectionPage("slowRequests", page)}
                          total={slowRequestTotalPages}
                          radius="xl"
                          size={isMobile ? "sm" : "md"}
                        />
                      </Group>
                    ) : null}
                  </>
                )}
              </SectionCard>

              <SectionCard
                icon={<IconAlertTriangle size={20} />}
                title="Recent 5xx Requests"
                badge={snapshot.recentErrors.length}
              >
                {snapshot.recentErrors.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No server-side 5xx requests recorded since this backend process started.
                  </Text>
                ) : (
                  <>
                    <ScrollArea>
                      <Table highlightOnHover striped>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>When</Table.Th>
                            <Table.Th>Route</Table.Th>
                            <Table.Th>User</Table.Th>
                            <Table.Th ta="center">Duration</Table.Th>
                            <Table.Th ta="center">Status</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {visibleErrors.map((request) => (
                            <Table.Tr key={`error-${request.id}`}>
                              <Table.Td>{formatTimestamp(request.startedAt)}</Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text fw={700}>{request.method}</Text>
                                  <Text size="sm" c="dimmed">
                                    {request.routeKey}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm" c="dimmed">
                                  {formatUserIdentity(request)}
                                </Text>
                              </Table.Td>
                              <Table.Td ta="center">{formatDuration(request.durationMs)}</Table.Td>
                              <Table.Td ta="center">{request.statusCode}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                    {errorTotalPages > 1 ? (
                      <Group justify="center">
                        <Pagination
                          value={errorPage}
                          onChange={(page) => setSectionPage("errors", page)}
                          total={errorTotalPages}
                          radius="xl"
                          size={isMobile ? "sm" : "md"}
                        />
                      </Group>
                    ) : null}
                  </>
                )}
              </SectionCard>
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
              <SectionCard
                icon={<IconSql size={20} />}
                title="Slowest SQL Patterns"
                badge={snapshot.database.queries.topQueries.length}
              >
                {snapshot.database.queries.topQueries.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No Sequelize query timing has been captured yet.
                  </Text>
                ) : (
                  <>
                    <ScrollArea>
                      <Table highlightOnHover striped>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Query</Table.Th>
                            <Table.Th ta="center">Count</Table.Th>
                            <Table.Th ta="center">P95</Table.Th>
                            <Table.Th ta="center">Avg</Table.Th>
                            <Table.Th ta="center">Max</Table.Th>
                            <Table.Th ta="center">Action</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {visibleTopQueries.map((query) => (
                            <Table.Tr key={`${query.label}-${query.sqlSnippet}`}>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text fw={700}>{query.label}</Text>
                                  <Text size="sm" c="dimmed">
                                    {query.sqlSnippet}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td ta="center">{formatMetricNumber(query.count)}</Table.Td>
                              <Table.Td ta="center">{formatDuration(query.p95DurationMs)}</Table.Td>
                              <Table.Td ta="center">{formatDuration(query.averageDurationMs)}</Table.Td>
                              <Table.Td ta="center">{formatDuration(query.maxDurationMs)}</Table.Td>
                              <Table.Td ta="center">
                                <Button
                                  size="xs"
                                  radius="xl"
                                  variant="light"
                                  color="dark"
                                  loading={explainLoadingSql === query.sampleSql}
                                  onClick={() => {
                                    void handleRunExplain(query.sampleSql);
                                  }}
                                >
                                  Explain
                                </Button>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                    {topQueryTotalPages > 1 ? (
                      <Group justify="center">
                        <Pagination
                          value={topQueryPage}
                          onChange={(page) => setSectionPage("topQueries", page)}
                          total={topQueryTotalPages}
                          radius="xl"
                          size={isMobile ? "sm" : "md"}
                        />
                      </Group>
                    ) : null}
                  </>
                )}
              </SectionCard>

              <SectionCard
                icon={<IconDatabase size={20} />}
                title="Recent Slow SQL"
                badge={snapshot.database.queries.recentSlowQueries.length}
              >
                {snapshot.database.queries.recentSlowQueries.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No SQL queries have crossed the slow-query threshold of{" "}
                    {formatDuration(snapshot.database.queries.slowQueryThresholdMs)} yet.
                  </Text>
                ) : (
                  <>
                    <ScrollArea>
                      <Table highlightOnHover striped>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>When</Table.Th>
                            <Table.Th>Query</Table.Th>
                            <Table.Th ta="center">Duration</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {visibleSlowQueries.map((query) => (
                            <Table.Tr key={`${query.startedAt}-${query.label}-${query.durationMs}`}>
                              <Table.Td>{formatTimestamp(query.startedAt)}</Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text fw={700}>{query.label}</Text>
                                  <Text size="sm" c="dimmed">
                                    {query.sqlSnippet}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td ta="center">{formatDuration(query.durationMs)}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                    {slowQueryTotalPages > 1 ? (
                      <Group justify="center">
                        <Pagination
                          value={slowQueryPage}
                          onChange={(page) => setSectionPage("slowQueries", page)}
                          total={slowQueryTotalPages}
                          radius="xl"
                          size={isMobile ? "sm" : "md"}
                        />
                      </Group>
                    ) : null}
                  </>
                )}
              </SectionCard>
            </SimpleGrid>

            {(explainResult || explainError) ? (
              <SectionCard icon={<IconSql size={20} />} title="Explain Analyze">
                <Stack gap="sm">
                  {explainError ? (
                    <Alert radius="xl" color="red" icon={<IconAlertTriangle size={18} />} title="Explain failed">
                      {explainError}
                    </Alert>
                  ) : null}
                  {explainResult ? (
                    <>
                      <Text size="sm" c="dimmed">
                        Generated {formatTimestamp(explainResult.generatedAt)}
                      </Text>
                      <Paper withBorder radius="xl" p="md" bg="gray.0">
                        <Text size="sm" fw={700} mb="xs">
                          SQL
                        </Text>
                        <Text ff="monospace" size="xs">
                          {explainResult.sql}
                        </Text>
                      </Paper>
                      <Paper withBorder radius="xl" p="md" bg="gray.0">
                        <Text size="sm" fw={700} mb="xs">
                          Plan
                        </Text>
                        <Text ff="monospace" size="xs" style={{ whiteSpace: "pre-wrap" }}>
                          {explainResult.plan.join("\n")}
                        </Text>
                      </Paper>
                    </>
                  ) : null}
                </Stack>
              </SectionCard>
            ) : null}

            <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
              <SectionCard
                icon={<IconRoute size={20} />}
                title="Route To SQL Correlation"
                badge={snapshot.database.queries.routeCorrelations.length}
              >
                {snapshot.database.queries.routeCorrelations.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No request-to-SQL correlations are available yet.
                  </Text>
                ) : (
                  <>
                    <ScrollArea>
                      <Table highlightOnHover striped>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Route</Table.Th>
                            <Table.Th ta="center">Requests</Table.Th>
                            <Table.Th ta="center">Avg SQL</Table.Th>
                            <Table.Th ta="center">Max SQL</Table.Th>
                            <Table.Th>Top Queries</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {visibleQueryRoutes.map((route) => (
                            <Table.Tr key={`${route.method}-${route.routeKey}-sql`}>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text fw={700}>{route.method}</Text>
                                  <Text size="sm" c="dimmed">
                                    {route.routeKey}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td ta="center">{formatMetricNumber(route.requestCount)}</Table.Td>
                              <Table.Td ta="center">{formatDuration(route.averageTotalQueryDurationMs)}</Table.Td>
                              <Table.Td ta="center">{formatDuration(route.maxTotalQueryDurationMs)}</Table.Td>
                              <Table.Td>
                                <Text size="sm" c="dimmed">
                                  {route.topQueryLabels.join(", ") || "-"}
                                </Text>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                    {queryRouteTotalPages > 1 ? (
                      <Group justify="center">
                        <Pagination
                          value={queryRoutePage}
                          onChange={(page) => setSectionPage("queryRoutes", page)}
                          total={queryRouteTotalPages}
                          radius="xl"
                          size={isMobile ? "sm" : "md"}
                        />
                      </Group>
                    ) : null}
                  </>
                )}
              </SectionCard>

              <SectionCard
                icon={<IconRoute size={20} />}
                title="Recent Request Query Correlations"
                badge={snapshot.database.queries.recentRequestCorrelations.length}
              >
                {snapshot.database.queries.recentRequestCorrelations.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No request/query correlations have been recorded yet.
                  </Text>
                ) : (
                  <>
                    <ScrollArea>
                      <Table highlightOnHover striped>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>When</Table.Th>
                            <Table.Th>Route</Table.Th>
                            <Table.Th>User</Table.Th>
                            <Table.Th ta="center">Request</Table.Th>
                            <Table.Th ta="center">SQL</Table.Th>
                            <Table.Th>Queries</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {visibleRequestQueryCorrelations.map((request) => (
                            <Table.Tr key={`${request.requestId}-${request.startedAt}`}>
                              <Table.Td>{formatTimestamp(request.startedAt)}</Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text fw={700}>{request.method}</Text>
                                  <Text size="sm" c="dimmed">
                                    {request.routeKey}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm" c="dimmed">
                                  {formatUserIdentity(request)}
                                </Text>
                              </Table.Td>
                              <Table.Td ta="center">{formatDuration(request.requestDurationMs)}</Table.Td>
                              <Table.Td ta="center">{formatDuration(request.totalQueryDurationMs)}</Table.Td>
                              <Table.Td>
                                <Text size="sm" c="dimmed">
                                  {request.queries.map((query) => `${query.label} (${formatDuration(query.durationMs)})`).join(", ") || "-"}
                                </Text>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                    {requestQueryTotalPages > 1 ? (
                      <Group justify="center">
                        <Pagination
                          value={requestQueryPage}
                          onChange={(page) => setSectionPage("requestQueries", page)}
                          total={requestQueryTotalPages}
                          radius="xl"
                          size={isMobile ? "sm" : "md"}
                        />
                      </Group>
                    ) : null}
                  </>
                )}
              </SectionCard>
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
              <SectionCard
                icon={<IconActivity size={20} />}
                title="External Calls"
                badge={snapshot.externalCalls.topEndpoints.length}
              >
                {snapshot.externalCalls.topEndpoints.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No outbound HTTP/HTTPS calls have been captured yet.
                  </Text>
                ) : (
                  <>
                    <ScrollArea>
                      <Table highlightOnHover striped>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Endpoint</Table.Th>
                            <Table.Th ta="center">Count</Table.Th>
                            <Table.Th ta="center">P95</Table.Th>
                            <Table.Th ta="center">Avg</Table.Th>
                            <Table.Th ta="center">Status</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {visibleExternalEndpoints.map((call) => (
                            <Table.Tr key={`${call.method}-${call.host}-${call.pathLabel}`}>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text fw={700}>
                                    {call.method} {call.host}
                                  </Text>
                                  <Text size="sm" c="dimmed">
                                    {call.pathLabel}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td ta="center">{formatMetricNumber(call.count)}</Table.Td>
                              <Table.Td ta="center">{formatDuration(call.p95DurationMs)}</Table.Td>
                              <Table.Td ta="center">{formatDuration(call.averageDurationMs)}</Table.Td>
                              <Table.Td ta="center">{call.lastStatusCode ?? call.lastErrorCode ?? "-"}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                    {externalEndpointTotalPages > 1 ? (
                      <Group justify="center">
                        <Pagination
                          value={externalEndpointPage}
                          onChange={(page) => setSectionPage("externalEndpoints", page)}
                          total={externalEndpointTotalPages}
                          radius="xl"
                          size={isMobile ? "sm" : "md"}
                        />
                      </Group>
                    ) : null}
                  </>
                )}
              </SectionCard>

              <SectionCard
                icon={<IconActivity size={20} />}
                title="Recent Slow External Calls"
                badge={snapshot.externalCalls.recentSlowCalls.length}
              >
                {snapshot.externalCalls.recentSlowCalls.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No external call has crossed the slow-call threshold of{" "}
                    {formatDuration(snapshot.externalCalls.slowExternalCallThresholdMs)} yet.
                  </Text>
                ) : (
                  <>
                    <ScrollArea>
                      <Table highlightOnHover striped>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>When</Table.Th>
                            <Table.Th>Endpoint</Table.Th>
                            <Table.Th>User</Table.Th>
                            <Table.Th ta="center">Duration</Table.Th>
                            <Table.Th ta="center">Route</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {visibleExternalSlowCalls.map((call) => (
                            <Table.Tr key={`${call.startedAt}-${call.host}-${call.path}`}>
                              <Table.Td>{formatTimestamp(call.startedAt)}</Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text fw={700}>
                                    {call.method} {call.host}
                                  </Text>
                                  <Text size="sm" c="dimmed">
                                    {call.path}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm" c="dimmed">
                                  {formatUserIdentity(call)}
                                </Text>
                              </Table.Td>
                              <Table.Td ta="center">{formatDuration(call.durationMs)}</Table.Td>
                              <Table.Td ta="center">{call.routeKey ?? "-"}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                    {externalSlowCallTotalPages > 1 ? (
                      <Group justify="center">
                        <Pagination
                          value={externalSlowCallPage}
                          onChange={(page) => setSectionPage("externalSlowCalls", page)}
                          total={externalSlowCallTotalPages}
                          radius="xl"
                          size={isMobile ? "sm" : "md"}
                        />
                      </Group>
                    ) : null}
                  </>
                )}
              </SectionCard>
            </SimpleGrid>

            <SectionCard icon={<IconServer size={20} />} title="Heap Snapshots" badge={snapshot.heapSnapshots.recentSnapshots.length}>
              <Stack gap="md">
                <Group justify="space-between" align="center" wrap="wrap">
                  <Stack gap={2}>
                    <Text fw={700}>Capture a heap snapshot on demand</Text>
                    <Text size="sm" c="dimmed">
                      Heap snapshots help retained-object inspection, but capture can briefly pause the backend process.
                    </Text>
                  </Stack>
                  <Button
                    radius="xl"
                    color="dark"
                    loading={heapCaptureState.loading}
                    onClick={() => {
                      void handleCaptureHeapSnapshot();
                    }}
                  >
                    Capture Heap Snapshot
                  </Button>
                </Group>
                <Text size="sm" c="dimmed">
                  Directory: {snapshot.heapSnapshots.directory}
                </Text>
                {heapCaptureState.error ? (
                  <Alert radius="xl" color="red" icon={<IconAlertTriangle size={18} />} title="Heap snapshot failed">
                    {heapCaptureState.error}
                  </Alert>
                ) : null}
                {heapCaptureState.lastCapture ? (
                  <Alert radius="xl" color="blue" icon={<IconServer size={18} />} title="Heap snapshot captured">
                    {heapCaptureState.lastCapture.snapshot.fileName} | {formatMetricNumber(heapCaptureState.lastCapture.snapshot.sizeMb, 2)} MB
                  </Alert>
                ) : null}
                {snapshot.heapSnapshots.recentSnapshots.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    No heap snapshots have been captured yet.
                  </Text>
                ) : (
                  <ScrollArea>
                    <Table highlightOnHover striped>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>File</Table.Th>
                          <Table.Th ta="center">Created</Table.Th>
                          <Table.Th ta="center">Size</Table.Th>
                          <Table.Th>Path</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {snapshot.heapSnapshots.recentSnapshots.map((file) => (
                          <Table.Tr key={file.filePath}>
                            <Table.Td>{file.fileName}</Table.Td>
                            <Table.Td ta="center">{formatTimestamp(file.createdAt)}</Table.Td>
                            <Table.Td ta="center">{formatMetricNumber(file.sizeMb, 2)} MB</Table.Td>
                            <Table.Td>
                              <Text size="sm" c="dimmed">
                                {file.filePath}
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                )}
              </Stack>
            </SectionCard>

            <Alert radius="xl" color="blue" icon={<IconServer size={18} />} title="How to read this page">
              If performance degrades over a day or two, look for one of these patterns: steadily rising heap or RSS,
              higher event loop lag, a growing database pending queue, one route taking over the P95 latency table, or
              one SQL pattern dominating the slow-query sections. On Windows development machines the load average is
              not meaningful; on your Ubuntu 20.04 VPS it is.
            </Alert>
          </>
        ) : null}
      </Stack>
    </PageAccessGuard>
  );
};

export default PerformancePage;
