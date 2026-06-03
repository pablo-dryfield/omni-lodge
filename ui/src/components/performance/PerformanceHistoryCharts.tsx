import type { ReactElement, ReactNode } from "react";
import { Badge, Group, Paper, Stack, Text } from "@mantine/core";
import dayjs from "dayjs";
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

type ChartPoint = {
  timestamp: string;
  p95Ms?: number;
  avgMs?: number;
  errorRate?: number;
  rssMb?: number;
  heapMb?: number;
  cpuPercent?: number;
  eventLoopLagMs?: number;
};

type PerformanceHistoryChartsProps = {
  historyCount: number;
  historyRange: string;
  isMobile: boolean;
  renderSectionCard: (args: {
    children: ReactNode;
    icon: ReactNode;
    title: string;
  }) => ReactElement;
  requestHistory: ChartPoint[];
  resourceHistory: ChartPoint[];
  resourceIcon: ReactNode;
  resourceTitleIcon: ReactNode;
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
const formatChartTimestamp = (value: string): string => dayjs(value).format("DD/MM HH:mm");

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

const PerformanceHistoryCharts = ({
  historyCount,
  historyRange,
  isMobile,
  renderSectionCard,
  requestHistory,
  resourceHistory,
  resourceIcon,
  resourceTitleIcon,
}: PerformanceHistoryChartsProps) => (
  <>
    {renderSectionCard({
      icon: resourceIcon,
      title: "Latency Drift",
      children: (
        <Stack gap="sm">
          <Group justify="space-between">
            <Text c="dimmed" size="sm">
              Tracks whether request latency or error rate drifts upward as the process stays online.
            </Text>
            <Badge variant="light" color="gray">
              {historyCount} samples in {historyRange}
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
      ),
    })}

    {renderSectionCard({
      icon: resourceTitleIcon,
      title: "Resource Pressure",
      children: (
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
      ),
    })}
  </>
);

export default PerformanceHistoryCharts;
