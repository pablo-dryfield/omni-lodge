import {
  Box,
  Card,
  CardContent,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha, styled, useTheme } from "@mui/material/styles";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LinkOffRoundedIcon from "@mui/icons-material/LinkOffRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import type { DashboardVisualCardViewConfig } from "../../api/reports";
import { SpotlightPeriodRow } from "./SpotlightCardParts";

export type VisualChartPoint = {
  dimension: string;
  metric: number | null;
  comparison: number | null;
};

type GraphicCardProps = {
  title: string;
  config: DashboardVisualCardViewConfig;
  points?: VisualChartPoint[];
  rows?: Array<Record<string, unknown>>;
  infoLabel?: string | null;
  periodLabel?: string | null;
  periodOptions?: Array<{ value: string; label: string }>;
  activePeriod?: string | null;
  onSelectPeriod?: (value: string) => void;
  customInput?: { from: string; to: string };
  onCustomInputChange?: (key: "from" | "to", value: string) => void;
  onApplyCustomRange?: () => void;
  isLinked?: boolean;
  onToggleLink?: () => void;
};

const GraphicCardShell = styled(Card)(({ theme }) => ({
  position: "relative",
  height: "100%",
  width: "100%",
  borderRadius: 14,
  border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
  background:
    theme.palette.mode === "dark"
      ? "linear-gradient(160deg, rgba(12, 18, 30, 0.98) 0%, rgba(18, 26, 44, 0.98) 100%)"
      : "linear-gradient(180deg, #ffffff 0%, #f6f7f9 100%)",
  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.08)",
  overflow: "hidden",
}));

const pieSegmentColors = [
  "#E6194B",
  "#3CB44B",
  "#FFE119",
  "#0082C8",
  "#F58231",
  "#911EB4",
  "#46F0F0",
  "#F032E6",
  "#D2F53C",
  "#008080",
  "#AA6E28",
  "#800000",
];

const chartColors = {
  metric: "#1976d2",
  comparison: "#9c27b0",
};

const normalizeCurrencyCode = (currency?: string): string => {
  const normalized = currency?.trim().toUpperCase();
  return normalized && normalized.length === 3 ? normalized : "PLN";
};

const getStoredBaseCurrency = (): string => {
  if (typeof window === "undefined") {
    return "PLN";
  }
  try {
    const raw = window.localStorage.getItem("finance-section-settings");
    if (!raw) {
      return "PLN";
    }
    const parsed = JSON.parse(raw) as { baseCurrency?: string };
    const candidate = parsed?.baseCurrency?.trim().toUpperCase();
    return candidate && candidate.length === 3 ? candidate : "PLN";
  } catch {
    return "PLN";
  }
};

const toNumeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const formatDimensionValue = (value: unknown): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "-";
  }
  return JSON.stringify(value);
};

const collectColumnKeys = (rows: Array<Record<string, unknown>>): Set<string> => {
  const keys = new Set<string>();
  rows.forEach((row) => {
    if (row && typeof row === "object") {
      Object.keys(row).forEach((key) => keys.add(key));
    }
  });
  return keys;
};

const pickColumnKey = (
  columns: Set<string>,
  candidates: Array<string | null | undefined>,
  exclude: Set<string>,
): string | null => {
  for (const candidate of candidates) {
    if (candidate && columns.has(candidate) && !exclude.has(candidate)) {
      return candidate;
    }
  }
  for (const key of columns) {
    if (!exclude.has(key)) {
      return key;
    }
  }
  return null;
};

const mapRowsToVisualPoints = (
  rows: Array<Record<string, unknown>>,
  config: DashboardVisualCardViewConfig,
): VisualChartPoint[] => {
  if (!rows || rows.length === 0) {
    return [];
  }
  const columns = collectColumnKeys(rows);
  if (columns.size === 0) {
    return [];
  }
  const dimensionKey =
    pickColumnKey(
      columns,
      [config.dimensionAlias, config.queryConfig?.dimensions?.[0]?.alias, config.visual.dimension],
      new Set(),
    ) ?? null;
  const metricExclude = new Set<string>();
  if (dimensionKey) {
    metricExclude.add(dimensionKey);
  }
  const metricKey =
    pickColumnKey(
      columns,
      [config.metricAlias, config.queryConfig?.metrics?.[0]?.alias, config.visual.metric],
      metricExclude,
    ) ?? null;
  const comparisonExclude = new Set<string>(metricExclude);
  if (metricKey) {
    comparisonExclude.add(metricKey);
  }
  const comparisonKey =
    pickColumnKey(
      columns,
      [config.comparisonAlias, config.queryConfig?.metrics?.[1]?.alias, config.visual.comparison],
      comparisonExclude,
    ) ?? null;

  if (!dimensionKey || !metricKey) {
    return [];
  }

  return rows
    .map((row) => {
      const dimensionRaw = row[dimensionKey];
      const metricRaw = row[metricKey];
      const comparisonRaw = comparisonKey ? row[comparisonKey] : undefined;
      const metric = toNumeric(metricRaw);
      const comparison = comparisonKey ? toNumeric(comparisonRaw) : null;
      if (metric === null && comparison === null) {
        return null;
      }
      return {
        dimension: formatDimensionValue(dimensionRaw),
        metric,
        comparison,
      };
    })
    .filter((entry): entry is VisualChartPoint => entry !== null);
};

type MetricFormat = "number" | "currency" | "percentage";

const inferMetricFormat = (label?: string, metric?: string): MetricFormat => {
  const candidate = `${label ?? ""} ${metric ?? ""}`.toLowerCase();
  if (/(price|amount|revenue|gross|net|earning|income|sales|cost|balance|currency)/.test(candidate)) {
    return "currency";
  }
  if (/(percent|percentage|ratio|rate|pct)/.test(candidate)) {
    return "percentage";
  }
  return "number";
};

const formatChartValue = (value: unknown, format: MetricFormat, currency?: string): string => {
  const numeric = toNumeric(value);
  if (numeric === null) {
    return typeof value === "string" ? value : "-";
  }
  if (format === "currency") {
    const normalized = normalizeCurrencyCode(currency);
    const amount = numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (normalized === "PLN") {
      return `${amount} zł`;
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  }
  if (format === "percentage") {
    return `${numeric.toFixed(2)}%`;
  }
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

export const GraphicCard = ({
  title,
  config,
  points,
  rows,
  infoLabel: infoLabelOverride,
  periodLabel,
  periodOptions = [],
  activePeriod,
  onSelectPeriod,
  customInput,
  onCustomInputChange,
  onApplyCustomRange,
  isLinked,
  onToggleLink,
}: GraphicCardProps) => {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("sm"));
  const pieContainerRef = useRef<HTMLDivElement | null>(null);
  const [pinnedPie, setPinnedPie] = useState<{ dimension: string; value: number | string | null } | null>(null);
  const [infoAnchorEl, setInfoAnchorEl] = useState<HTMLElement | null>(null);
  const chartData = useMemo(() => {
    if (points && points.length > 0) {
      return points;
    }
    if (rows && rows.length > 0) {
      return mapRowsToVisualPoints(rows, config);
    }
    return [];
  }, [config, points, rows]);
  const hasData = chartData.length > 0;
  const metricLabel = config.visual.metricLabel ?? "Metric";
  const comparisonLabel = config.visual.comparisonLabel ?? "Comparison";
  const isPie = config.visual.type === "pie";
  const infoText = (infoLabelOverride ?? "").trim();
  const infoLabel = infoText.length > 0 ? infoText : "Date range not set";
  const linkState = isLinked ?? true;
  const canToggleLink = typeof onToggleLink === "function";
  const inferredFormat = inferMetricFormat(config.visual.metricLabel, config.visual.metric);
  const metricFormat: MetricFormat =
    config.visual.metricCurrency
      ? "currency"
      : config.visual.metricFormat && config.visual.metricFormat !== "number"
      ? config.visual.metricFormat
      : inferredFormat;
  const metricCurrency =
    config.visual.metricCurrency ?? (metricFormat === "currency" ? getStoredBaseCurrency() : undefined);
  const tooltipFormatter = (value: unknown) => [formatChartValue(value, metricFormat, metricCurrency), metricLabel];
  const pieTooltipFormatter = (value: unknown, _name: string, props: { payload?: { dimension?: string } }) => {
    const dimension = props?.payload?.dimension ?? _name;
    return [formatChartValue(value, metricFormat, metricCurrency), dimension];
  };
  const renderPieTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ value?: unknown; name?: string; payload?: { dimension?: string } }>;
  }) => {
    if (!active || !payload || payload.length === 0) {
      return null;
    }
    const entry = payload[0];
    const dimension = entry.payload?.dimension ?? entry.name ?? "-";
    const value = formatChartValue(entry.value, metricFormat, metricCurrency);
    return (
      <Box
        sx={{
          bgcolor: "rgba(17, 24, 39, 0.92)",
          color: "#fff",
          px: 1.5,
          py: 1,
          borderRadius: 1,
          boxShadow: "0 12px 24px rgba(15, 23, 42, 0.25)",
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>
          {dimension}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.9 }}>
          {value}
        </Typography>
      </Box>
    );
  };
  const pieTooltipPayload = pinnedPie
    ? [
        {
          value:
            typeof pinnedPie.value === "number" || typeof pinnedPie.value === "string" ? pinnedPie.value : "",
          name: pinnedPie.dimension,
          payload: { dimension: pinnedPie.dimension },
        },
      ]
    : undefined;

  useEffect(() => {
    if (!pinnedPie) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || !pieContainerRef.current) {
        return;
      }
      if (!pieContainerRef.current.contains(target)) {
        setPinnedPie(null);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [pinnedPie]);

  useEffect(() => {
    if (!pinnedPie) {
      return;
    }
    const stillExists = chartData.some((entry) => entry.dimension === pinnedPie.dimension);
    if (!stillExists) {
      setPinnedPie(null);
    }
  }, [chartData, pinnedPie]);

  const handleInfoToggle = (event: MouseEvent<HTMLButtonElement>) => {
    setInfoAnchorEl((current) => (current ? null : event.currentTarget));
  };
  const handleInfoClose = () => setInfoAnchorEl(null);

  const renderChart = () => {
    if (config.visual.type === "pie") {
      return (
        <Stack
          ref={pieContainerRef}
          direction={isCompact ? "column" : "row"}
          spacing={2}
          alignItems="center"
          justifyContent="center"
          sx={{ height: "100%", width: "100%" }}
        >
          <Box sx={{ flex: "1 1 auto", minWidth: isCompact ? 0 : 220, height: isCompact ? 200 : "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <ChartTooltip
                  formatter={pieTooltipFormatter}
                  content={renderPieTooltip}
                  active={pinnedPie ? true : undefined}
                  payload={pinnedPie ? pieTooltipPayload : undefined}
                />
                <Pie
                  data={chartData}
                  dataKey="metric"
                  nameKey="dimension"
                  innerRadius={44}
                  outerRadius={86}
                  paddingAngle={2}
                  onClick={(data) => {
                    const dimension = data?.payload?.dimension ?? data?.name;
                    if (!dimension) {
                      return;
                    }
                    const rawValue = data?.value ?? data?.payload?.metric ?? null;
                    const numericValue = toNumeric(rawValue);
                    const value =
                      numericValue ?? (typeof rawValue === "string" ? rawValue : null);
                    setPinnedPie((current) =>
                      current && current.dimension === dimension ? null : { dimension, value },
                    );
                  }}
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`pie-${entry.dimension}-${index}`}
                      fill={pieSegmentColors[index % pieSegmentColors.length]}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </Box>
          <Box
            sx={{
              flex: "0 0 auto",
              width: isCompact ? "100%" : 140,
              marginLeft: isCompact ? 0 : "auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              textAlign: "left",
              gap: 0.5,
              paddingRight: isCompact ? 0 : 10,
            }}
          >
            {chartData.map((entry, index) => (
              <Box
                key={`legend-${entry.dimension}-${index}`}
                sx={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "10px auto",
                  columnGap: 2,
                  alignItems: "center",
                }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: pieSegmentColors[index % pieSegmentColors.length],
                    flexShrink: 0,
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  {entry.dimension}
                </Typography>
              </Box>
            ))}
          </Box>
        </Stack>
      );
    }

    if (config.visual.type === "scatter") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="dimension" name={config.visual.dimensionLabel} />
            <YAxis name={metricLabel} />
            <ChartTooltip formatter={tooltipFormatter} />
            <Legend />
            <Scatter
              name={metricLabel}
              data={chartData}
              fill={chartColors.metric}
              line={{ stroke: chartColors.metric }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      );
    }

    const primaryElement =
      config.visual.type === "bar" || config.visual.type === "stackedBar" ? (
        <Bar
          dataKey="metric"
          name={metricLabel}
          fill={chartColors.metric}
          stackId={config.visual.type === "stackedBar" ? "stack" : undefined}
        />
      ) : config.visual.type === "area" || config.visual.type === "stackedArea" ? (
        <Area
          type="monotone"
          dataKey="metric"
          name={metricLabel}
          stroke={chartColors.metric}
          fill={chartColors.metric}
          stackId={config.visual.type === "stackedArea" ? "stack" : undefined}
        />
      ) : (
        <Line type="monotone" dataKey="metric" name={metricLabel} stroke={chartColors.metric} dot={false} />
      );

    return (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="dimension" />
          <YAxis />
          <ChartTooltip formatter={tooltipFormatter} />
          <Legend />
          {primaryElement}
          {config.visual.comparison && !isPie && (
            <Line
              type="monotone"
              dataKey="comparison"
              name={comparisonLabel}
              stroke={chartColors.comparison}
              dot={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    );
  };

  return (
    <GraphicCardShell variant="outlined">
      <CardContent
        sx={{
          position: "relative",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 1,
          p: { xs: 1.5, md: 2 },
        }}
      >
        <Box
          sx={{
            position: "absolute",
            top: 10,
            right: 12,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Tooltip title={linkState ? "Linked period" : "Unlinked period"} arrow placement="top">
            <span>
              <IconButton
                size="small"
                onClick={onToggleLink}
                disabled={!canToggleLink}
                aria-label={linkState ? "Unlink period" : "Link period"}
                sx={{ p: 0.4 }}
              >
                {linkState ? (
                  <LinkRoundedIcon
                    sx={{
                      fontSize: 16,
                      color: "text.primary",
                    }}
                  />
                ) : (
                  <LinkOffRoundedIcon
                    sx={{
                      fontSize: 16,
                      color: "text.disabled",
                    }}
                  />
                )}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        <Box
          sx={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.5,
            alignSelf: "center",
          }}
        >
          <Typography variant="subtitle1" fontWeight={700} textAlign="center">
            {title}
          </Typography>
          <Tooltip title={infoLabel} arrow placement="top">
            <IconButton
              size="small"
              onClick={handleInfoToggle}
              aria-label="Show visualization info"
              sx={{ p: 0.25, color: "text.secondary" }}
            >
              <InfoOutlinedIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
          <Popover
            open={Boolean(infoAnchorEl)}
            anchorEl={infoAnchorEl}
            onClose={handleInfoClose}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            transformOrigin={{ vertical: "top", horizontal: "center" }}
            PaperProps={{
              sx: {
                px: 1.25,
                py: 0.75,
                maxWidth: 220,
                borderRadius: 1.5,
                bgcolor: "rgba(17, 24, 39, 0.96)",
                color: "#fff",
                boxShadow: "0 12px 30px rgba(15, 23, 42, 0.35)",
              },
            }}
          >
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.9)" }}>
              {infoLabel}
            </Typography>
          </Popover>
        </Box>
        <Box sx={{ flexGrow: 1, minHeight: 0 }}>
          {hasData ? renderChart() : null}
        </Box>
        {periodLabel && (
          <SpotlightPeriodRow
            label={periodLabel}
            options={periodOptions}
            activeValue={activePeriod ?? undefined}
            onSelectOption={onSelectPeriod}
            customInput={customInput}
            onCustomInputChange={onCustomInputChange}
            onApplyCustomRange={onApplyCustomRange}
          />
        )}
      </CardContent>
    </GraphicCardShell>
  );
};
