import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Group,
  Loader,
  Pagination,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconActivity,
  IconAlertTriangle,
  IconChartLine,
  IconClock,
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
  fetchPerformanceSnapshot,
  type PerformanceSnapshotResponse,
} from "../api/performance";

dayjs.extend(duration);

const PAGE_SLUG = PAGE_SLUGS.performance;
const POLL_INTERVAL_MS = 10_000;
const HISTORY_RANGE_OPTIONS = [
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
] as const;

type HistoryRange = (typeof HISTORY_RANGE_OPTIONS)[number]["value"];
type PaginatedSectionKey =
  | "routes"
  | "activeRequests"
  | "slowRequests"
  | "errors"
  | "topQueries"
  | "slowQueries";

type DiagnosisSeverity = "critical" | "warning" | "info" | "healthy";

type DiagnosisItem = {
  severity: DiagnosisSeverity;
  title: string;
  summary: string;
  signals: string[];
  actions: string[];
};

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

  if (snapshot.process.heapUsedPercent >= 80 || heapGrowth >= 250 || rssGrowth >= 400) {
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
  const [tablePages, setTablePages] = useState<Record<PaginatedSectionKey, number>>({
    routes: 1,
    activeRequests: 1,
    slowRequests: 1,
    errors: 1,
    topQueries: 1,
    slowQueries: 1,
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

  const history = useMemo(() => {
    const source = snapshot?.history ?? [];
    const now = dayjs();
    const threshold =
      historyRange === "24h"
        ? now.subtract(24, "hour")
        : historyRange === "30d"
          ? now.subtract(30, "day")
          : now.subtract(7, "day");
    return source.filter((point) => dayjs(point.timestamp).isAfter(threshold));
  }, [historyRange, snapshot?.history]);

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

  const routePage = Math.min(tablePages.routes, routeTotalPages);
  const activeRequestPage = Math.min(tablePages.activeRequests, activeRequestTotalPages);
  const slowRequestPage = Math.min(tablePages.slowRequests, slowRequestTotalPages);
  const errorPage = Math.min(tablePages.errors, errorTotalPages);
  const topQueryPage = Math.min(tablePages.topQueries, topQueryTotalPages);
  const slowQueryPage = Math.min(tablePages.slowQueries, slowQueryTotalPages);

  const visibleRoutes = paginateItems(snapshot?.topRoutes ?? [], routePage, tablePageSize);
  const visibleActiveRequests = paginateItems(snapshot?.activeRequests ?? [], activeRequestPage, tablePageSize);
  const visibleSlowRequests = paginateItems(snapshot?.recentSlowRequests ?? [], slowRequestPage, tablePageSize);
  const visibleErrors = paginateItems(snapshot?.recentErrors ?? [], errorPage, tablePageSize);
  const visibleTopQueries = paginateItems(snapshot?.database.queries.topQueries ?? [], topQueryPage, tablePageSize);
  const visibleSlowQueries = paginateItems(snapshot?.database.queries.recentSlowQueries ?? [], slowQueryPage, tablePageSize);
  const diagnosisItems = snapshot ? generateDiagnostics(snapshot, history) : [];

  const setSectionPage = (section: PaginatedSectionKey, page: number) => {
    setTablePages((current) => ({ ...current, [section]: page }));
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
                <SegmentedControl
                  value={historyRange}
                  onChange={(value) => setHistoryRange(value as HistoryRange)}
                  data={[...HISTORY_RANGE_OPTIONS]}
                  radius="xl"
                />
              </Group>
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
