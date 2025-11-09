import { Link as RouterLink } from "react-router-dom";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import PersonIcon from "@mui/icons-material/Person";
import SettingsIcon from "@mui/icons-material/Settings";
import Grid from "@mui/material/Grid";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  ThemeProvider,
  Typography,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { createTheme } from "@mui/material/styles";
import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import {
  ResponsiveContainer,
  ComposedChart,
  ScatterChart,
  Scatter,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  Legend,
  Line,
  Area,
  Bar,
} from "recharts";
import { GenericPageProps } from "../types/general/GenericPageProps";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { navigateToPage } from "../actions/navigationActions";
import { selectAllowedNavigationPages, selectAllowedPageSlugs } from "../selectors/accessControlSelectors";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import type { NavigationIconKey } from "../types/general/NavigationState";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import {
  useReportDashboards,
  useHomeDashboardPreference,
  runReportQueryWithPolling,
  type DashboardCardDto,
  type DashboardCardViewConfig,
  type DashboardSpotlightCardViewConfig,
  type DashboardVisualCardViewConfig,
  type HomeDashboardPreferenceDto,
  type MetricSpotlightDefinitionDto,
  type ReportQuerySuccessResponse,
  type QueryConfig,
} from "../api/reports";

const PAGE_SLUG = PAGE_SLUGS.dashboard;
const DEFAULT_HOME_PREFERENCE: HomeDashboardPreferenceDto = {
  viewMode: "navigation",
  savedDashboardIds: [],
  activeDashboardId: null,
};

const chartColors = {
  metric: "#1976d2",
  comparison: "#9c27b0",
};

const DEFAULT_CARD_LAYOUT = {
  x: 0,
  y: 0,
  w: 6,
  h: 4,
};

type VisualChartPoint = {
  dimension: string;
  metric: number | null;
  comparison: number | null;
};

type DashboardCardLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
};

const cloneConfig = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const formatMetricValue = (
  value: number,
  format: MetricSpotlightDefinitionDto["format"] = "number",
): string => {
  if (!Number.isFinite(value)) {
    return "-";
  }

  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(value);
    case "percentage":
      return `${value.toFixed(2)}%`;
    default:
      return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
};

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

type DashboardCardLiveState = {
  status: "idle" | "loading" | "error" | "success";
  visualSample?: VisualChartPoint[];
  spotlightSample?: DashboardSpotlightCardViewConfig["sample"];
  error?: string | null;
  warning?: string | null;
};

const isVisualCardViewConfig = (
  config: DashboardCardViewConfig | null | undefined,
): config is DashboardVisualCardViewConfig =>
  Boolean(config && config.mode === "visual" && typeof (config as DashboardVisualCardViewConfig).visual === "object");

const isSpotlightCardViewConfig = (
  config: DashboardCardViewConfig | null | undefined,
): config is DashboardSpotlightCardViewConfig =>
  Boolean(
    config && config.mode === "spotlight" && typeof (config as DashboardSpotlightCardViewConfig).spotlight === "object",
  );

const theme = createTheme();

const renderNavigationIcon = (icon: NavigationIconKey) => {
  switch (icon) {
    case "eventAvailable":
      return <EventAvailableIcon fontSize="large" />;
    case "assignmentTurnedIn":
      return <AssignmentTurnedInIcon fontSize="large" />;
    case "calendarMonth":
      return <CalendarMonthIcon fontSize="large" />;
    case "accountBalance":
      return <AccountBalanceIcon fontSize="large" />;
    case "formatListNumbered":
      return <FormatListNumberedIcon fontSize="large" />;
    case "person":
      return <PersonIcon fontSize="large" />;
    case "settings":
      return <SettingsIcon fontSize="large" />;
    default:
      return <PersonIcon fontSize="large" />;
  }
};

const PageWrapper = styled("div")(({ theme: muiTheme }) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "calc(100vh - 120px)",
  padding: muiTheme.spacing(6, 3),
  [muiTheme.breakpoints.down("md")]: {
    padding: muiTheme.spacing(4, 3),
  },
  [muiTheme.breakpoints.down("sm")]: {
    padding: muiTheme.spacing(3, 2),
    minHeight: "auto",
  },
}));

const TilesContainer = styled("div")({
  width: "100%",
  maxWidth: 1260,
  margin: "0 auto",
});

const TileLink = styled(RouterLink)(({ theme: muiTheme }) => ({
  display: "flex",
  justifyContent: "center",
  textDecoration: "none",
  width: "100%",
  paddingTop: muiTheme.spacing(1),
  paddingBottom: muiTheme.spacing(1),
}));

const LogoTile = styled(Paper)(({ theme: muiTheme }) => ({
  width: "clamp(140px, 28vw, 200px)",
  height: "clamp(140px, 28vw, 200px)",
  backgroundColor: muiTheme.palette.grey[100],
  borderRadius: "50%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  alignItems: "center",
  gap: muiTheme.spacing(1),
  textAlign: "center",
  transition: muiTheme.transitions.create(["background-color", "transform"], {
    duration: muiTheme.transitions.duration.shorter,
  }),
  [muiTheme.breakpoints.down("sm")]: {
    width: "min(240px, 70vw)",
    height: "min(240px, 70vw)",
  },
  "&:hover": {
    backgroundColor: muiTheme.palette.grey[200],
    transform: "translateY(-4px)",
  },
  "&:active": {
    backgroundColor: muiTheme.palette.grey[300],
    transform: "translateY(-1px)",
  },
}));

const PageName = styled(Typography)(({ theme: muiTheme }) => ({
  color: muiTheme.palette.text.primary,
  textDecoration: "none",
  marginTop: muiTheme.spacing(1),
}));

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  const axiosError = error as AxiosError<{ message?: string }>;
  const responseMessage = axiosError?.response?.data?.message;
  if (typeof responseMessage === "string" && responseMessage.length > 0) {
    return responseMessage;
  }
  if (axiosError?.message) {
    return axiosError.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const candidate = (error as { message?: string }).message;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return fallback;
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

const parseDashboardLayout = (
  layout: Record<string, unknown> | null | undefined,
  fallback: DashboardCardLayout = DEFAULT_CARD_LAYOUT,
): DashboardCardLayout => {
  const source = layout && typeof layout === "object" ? layout : {};
  const resolve = (key: string, defaultValue: number): number => {
    const candidate = source[key as keyof typeof source];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string") {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return defaultValue;
  };
  const width = Math.max(1, Math.min(12, resolve("w", fallback.w)));
  const height = Math.max(1, resolve("h", fallback.h));
  return {
    x: Math.max(0, resolve("x", fallback.x)),
    y: Math.max(0, resolve("y", fallback.y)),
    w: width,
    h: height,
  };
};

const HOME_GRID_ROW_HEIGHT_PX = 90;

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

const buildVisualSample = (config: DashboardVisualCardViewConfig): VisualChartPoint[] => {
  const rows = Array.isArray(config.sample?.rows) ? config.sample.rows : [];
  return mapRowsToVisualPoints(rows, config);
};

const renderVisualChart = (
  config: DashboardVisualCardViewConfig,
  data: VisualChartPoint[],
) => {
  if (config.visual.type === "scatter") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="dimension" name={config.visual.dimensionLabel} />
          <YAxis name={config.visual.metricLabel} />
          <ChartTooltip />
          <Legend />
          <Scatter
            name={config.visual.metricLabel ?? "Metric"}
            data={data}
            fill={chartColors.metric}
            line={{ stroke: chartColors.metric }}
          />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  const metricLabel = config.visual.metricLabel ?? "Metric";
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
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="dimension" />
        <YAxis />
        <ChartTooltip />
        <Legend />
        {primaryElement}
        {config.visual.comparison && (
          <Line
            type="monotone"
            dataKey="comparison"
            name={config.visual.comparisonLabel ?? "Comparison"}
            stroke={chartColors.comparison}
            dot={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
};

const SpotlightTone = {
  positive: "success.main",
  negative: "error.main",
  neutral: "text.primary",
} as const;

const computeLiveCardState = (
  card: DashboardCardDto,
  viewConfig: DashboardCardViewConfig | null | undefined,
  templateState?: { data?: ReportQuerySuccessResponse; isLoading: boolean; error?: string | null },
): DashboardCardLiveState => {
  if (!templateState) {
    return { status: "loading" };
  }
  if (templateState.isLoading) {
    return { status: "loading" };
  }
  if (templateState.error) {
    return { status: "error", error: templateState.error };
  }
  if (!templateState.data || !viewConfig || typeof viewConfig !== "object") {
    return { status: "idle" };
  }
  if (isVisualCardViewConfig(viewConfig)) {
    const sample = buildVisualSampleFromResult(viewConfig, templateState.data);
    return { status: "success", visualSample: sample };
  }
  if (isSpotlightCardViewConfig(viewConfig)) {
    const sample = buildSpotlightSampleFromResult(viewConfig, templateState.data);
    return { status: "success", spotlightSample: sample };
  }
  return { status: "success" };
};

const buildVisualSampleFromResult = (
  config: DashboardVisualCardViewConfig,
  result?: ReportQuerySuccessResponse,
): VisualChartPoint[] => {
  if (!result || !Array.isArray(result.rows)) {
    return [];
  }
  const limit = Math.max(1, Math.min(config.visual.limit ?? 100, 200));
  const rows = result.rows.slice(0, limit);
  return mapRowsToVisualPoints(rows, config);
};

const buildSpotlightSampleFromResult = (
  config: DashboardSpotlightCardViewConfig,
  result?: ReportQuerySuccessResponse,
): DashboardSpotlightCardViewConfig["sample"] | undefined => {
  if (!result || !Array.isArray(result.rows) || result.rows.length === 0) {
    return undefined;
  }
  const metricAlias = config.spotlight.metric;
  if (!metricAlias) {
    return undefined;
  }
  const values = result.rows
    .map((row) => coerceNumber(row[metricAlias]))
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return undefined;
  }
  const aggregatedValue = values.reduce((total, value) => total + value, 0);
  const formattedValue = formatMetricValue(aggregatedValue, config.spotlight.format);
  let delta = "-";
  let tone: "positive" | "neutral" | "negative" = "neutral";
  const contextParts: string[] = [];

  if (typeof config.spotlight.target === "number") {
    const difference = aggregatedValue - config.spotlight.target;
    tone = difference >= 0 ? "positive" : "negative";
    delta = `${difference >= 0 ? "+" : ""}${formatMetricValue(difference, config.spotlight.format)}`;
    contextParts.push(`Target ${formatMetricValue(config.spotlight.target, config.spotlight.format)}`);
  }

  const cards = [
    {
      id: metricAlias,
      label: config.spotlight.label?.trim() || config.spotlight.metricLabel || metricAlias,
      value: formattedValue,
      delta,
      context: contextParts.join(" • ") || "Live dashboard value",
      tone,
    },
  ];
  return { cards };
};

const Home = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(navigateToPage(props.title));
  }, [dispatch, props.title]);

  const allowedPages = useAppSelector(selectAllowedNavigationPages);
  const allowedPageSlugs = useAppSelector(selectAllowedPageSlugs);
  const canUseDashboards = useMemo(
    () => allowedPages.some((page) => page.slug === PAGE_SLUGS.reports),
    [allowedPages],
  );
  const canManageHomeExperience = allowedPageSlugs.has(PAGE_SLUGS.settingsHomeExperience);

  const homePreferenceQuery = useHomeDashboardPreference();
  const dashboardsQuery = useReportDashboards({ search: "", enabled: canUseDashboards });

  const preference = homePreferenceQuery.data ?? DEFAULT_HOME_PREFERENCE;
  const normalizedSavedIds = preference.savedDashboardIds.filter((id) => typeof id === "string" && id.length > 0);
  const activeDashboardId = useMemo(() => {
    if (preference.activeDashboardId && normalizedSavedIds.includes(preference.activeDashboardId)) {
      return preference.activeDashboardId;
    }
    return normalizedSavedIds[0] ?? null;
  }, [preference.activeDashboardId, normalizedSavedIds]);
  const effectiveViewMode = canUseDashboards ? preference.viewMode : "navigation";

  const dashboards = dashboardsQuery.data?.dashboards ?? [];
  const savedDashboardSummaries = normalizedSavedIds.map((id) => {
    const dashboard = dashboards.find((entry) => entry.id === id);
    return {
      id,
      name: dashboard?.name ?? "Missing dashboard",
      missing: !dashboard,
    };
  });
  const activeDashboard = dashboards.find((dashboard) => dashboard.id === activeDashboardId) ?? null;
  const activeCards = useMemo(() => activeDashboard?.cards ?? [], [activeDashboard]);
  const orderedActiveCards = useMemo(
    () =>
      activeCards
        .slice()
        .sort((a, b) => {
          const layoutA = parseDashboardLayout(a.layout);
          const layoutB = parseDashboardLayout(b.layout);
          if (layoutA.y === layoutB.y) {
            return layoutA.x - layoutB.x;
          }
          return layoutA.y - layoutB.y;
        }),
    [activeCards],
  );
  const shouldHydrateLiveData = canUseDashboards && effectiveViewMode === "dashboard";

  const cardHydrationDescriptors = useMemo(() => {
    if (!shouldHydrateLiveData || activeCards.length === 0) {
      return [];
    }
    return activeCards.map((card) => {
      const viewConfig = (card.viewConfig as DashboardCardViewConfig) ?? null;
      let queryConfig: QueryConfig | null = null;
      if (isVisualCardViewConfig(viewConfig) && viewConfig.queryConfig) {
        queryConfig = cloneConfig(viewConfig.queryConfig);
      }
      if (queryConfig) {
        queryConfig.options = {
          ...queryConfig.options,
          templateId: card.templateId || queryConfig.options?.templateId || null,
          allowAsync: true,
        };
      }
      return {
        card,
        viewConfig,
        queryConfig,
        cacheKey: queryConfig ? JSON.stringify(queryConfig) : "missing",
      };
    });
  }, [activeCards, shouldHydrateLiveData]);

  const cardLiveQueries = useQueries({
    queries: cardHydrationDescriptors.map(({ card, queryConfig, cacheKey }) => ({
      queryKey: ["reports", "dashboard-card", card.id, cacheKey],
      enabled: shouldHydrateLiveData && Boolean(queryConfig),
      queryFn: async () => {
        if (!queryConfig) {
          return null;
        }
        return runReportQueryWithPolling(queryConfig, { pollIntervalMs: 1500, timeoutMs: 45_000 });
      },
      staleTime: 30 * 1000,
    })),
  });

  const liveCardSamples = useMemo(() => {
    if (!shouldHydrateLiveData) {
      return new Map<string, DashboardCardLiveState>();
    }
    const map = new Map<string, DashboardCardLiveState>();
    if (cardHydrationDescriptors.length === 0) {
      return map;
    }
    cardHydrationDescriptors.forEach(({ card, viewConfig, queryConfig }, index) => {
      const queryResult = cardLiveQueries[index];
      if (!queryConfig) {
        const warning =
          isVisualCardViewConfig(viewConfig) && effectiveViewMode === "dashboard"
            ? "Open this template in Reports and re-save the card to enable live data."
            : null;
        map.set(card.id, { status: "idle", warning });
        return;
      }
      if (!queryResult) {
        map.set(card.id, { status: "idle" });
        return;
      }
      if (queryResult.isLoading || queryResult.isFetching) {
        map.set(card.id, { status: "loading" });
        return;
      }
      if (queryResult.error) {
        map.set(card.id, {
          status: "error",
          error: getErrorMessage(queryResult.error, "Failed to refresh dashboard data."),
        });
        return;
      }
      const data = queryResult.data as ReportQuerySuccessResponse | null;
      if (!data) {
        map.set(card.id, { status: "idle" });
        return;
      }
      map.set(card.id, computeLiveCardState(card, viewConfig, { data, isLoading: false }));
    });
    return map;
  }, [cardHydrationDescriptors, cardLiveQueries, effectiveViewMode, shouldHydrateLiveData]);

  const renderNavigationTiles = () => (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Navigation
        </Typography>
        <Grid container spacing={{ xs: 3, sm: 4, md: 5 }} justifyContent="center">
          {allowedPages.length === 0 ? (
            <Grid size={{ xs: 12 }}>
              <Typography variant="subtitle1" color="textSecondary">
                You do not have access to any sections yet.
              </Typography>
            </Grid>
          ) : (
            allowedPages.map((page) => (
              <Grid key={page.name} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <TileLink to={page.path} aria-label={`Go to ${page.name}`}>
                  <LogoTile elevation={3}>
                    {renderNavigationIcon(page.icon)}
                    <PageName variant="subtitle1">{page.name}</PageName>
                  </LogoTile>
                </TileLink>
              </Grid>
            ))
          )}
        </Grid>
      </CardContent>
    </Card>
  );

  const renderDashboardSummary = () => {
    if (!canUseDashboards) {
      return (
        <Alert severity="info">
          Dashboards require Reports access. Contact an administrator if you need this permission.
        </Alert>
      );
    }
    if (dashboardsQuery.error) {
      return <Alert severity="error">{getErrorMessage(dashboardsQuery.error, "Failed to load dashboards.")}</Alert>;
    }
    if (dashboardsQuery.isLoading) {
      return (
        <Stack direction="row" alignItems="center" gap={1}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="textSecondary">
            Loading dashboards...
          </Typography>
        </Stack>
      );
    }
    if (normalizedSavedIds.length === 0) {
      return (
        <Typography variant="body2" color="textSecondary">
          Pin dashboards to show them on the home page. Your pinned dashboards appear here for quick switching.
        </Typography>
      );
    }
    if (!activeDashboard) {
      return (
        <Alert severity="warning">
          The active dashboard is no longer available. Remove it or pick another dashboard to continue.
        </Alert>
      );
    }
    if (activeDashboard.cards.length === 0) {
      return (
        <Alert severity="info">
          This dashboard does not have any cards yet. Add cards from the Reports workspace to populate it.
        </Alert>
      );
    }
    return (
      <Stack gap={2}>
        <Card variant="outlined">
          <CardContent>
            <Stack gap={1}>
              <Typography variant="h6">{activeDashboard.name}</Typography>
              <Typography variant="body2" color="textSecondary">
                {activeDashboard.description ?? "Display saved visuals and spotlights from your reporting templates."}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
            gridAutoRows: `${HOME_GRID_ROW_HEIGHT_PX}px`,
            gap: 2,
          }}
        >
          {orderedActiveCards.map((card) => {
            const layout = parseDashboardLayout(card.layout);
            return (
              <Box
                key={card.id}
                sx={{
                  gridColumn: `span ${Math.max(1, Math.min(12, layout.w))}`,
                  gridRow: `span ${Math.max(1, layout.h)}`,
                  minWidth: 0,
                }}
              >
                <DashboardCard card={card} liveState={liveCardSamples.get(card.id)} />
              </Box>
            );
          })}
        </Box>
      </Stack>
    );
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <ThemeProvider theme={theme}>
        <PageWrapper>
          <TilesContainer>
            <Stack gap={3}>
              <Card variant="outlined">
                <CardContent>
                  <Stack gap={2}>
                    <Stack
                      direction={{ xs: "column", md: "row" }}
                      alignItems={{ xs: "flex-start", md: "center" }}
                      justifyContent="space-between"
                      gap={2}
                    >
                      <Stack gap={0.5}>
                        <Typography variant="h6">Home experience</Typography>
                        <Typography variant="body2" color="textSecondary">
                          Your administrator controls whether Home opens in navigation or dashboards mode.
                        </Typography>
                      </Stack>
                    </Stack>
                    {homePreferenceQuery.isLoading && (
                      <Stack direction="row" alignItems="center" gap={1}>
                        <CircularProgress size={18} />
                        <Typography variant="body2" color="textSecondary">
                          Loading your preference...
                        </Typography>
                      </Stack>
                    )}
                    {homePreferenceQuery.error && (
                      <Alert severity="error">
                        {getErrorMessage(homePreferenceQuery.error, "Failed to load home preference.")}
                      </Alert>
                    )}
                    {!homePreferenceQuery.isLoading && !homePreferenceQuery.error && (
                      <Stack gap={2}>
                        <Typography variant="body2" color="textSecondary">
                          Default experience:{" "}
                          <strong>{effectiveViewMode === "dashboard" ? "Dashboards" : "Navigation"}</strong>
                        </Typography>
                        {(canUseDashboards || canManageHomeExperience) && (
                          <Stack direction={{ xs: "column", sm: "row" }} gap={1}>
                            {canManageHomeExperience && (
                              <Button component={RouterLink} to="/settings/home-experience" variant="outlined">
                                Open Home Experience settings
                              </Button>
                            )}
                            {canUseDashboards && (
                              <Button component={RouterLink} to="/reports/dashboards" variant="text">
                                Manage dashboards workspace
                              </Button>
                            )}
                          </Stack>
                        )}
                        {canUseDashboards && (
                          <>
                            <Divider />
                            <Stack gap={1}>
                              <Typography variant="subtitle2">Pinned dashboards</Typography>
                              {savedDashboardSummaries.length === 0 ? (
                                <Typography variant="body2" color="textSecondary">
                                  No dashboards assigned to your home view yet.
                                </Typography>
                              ) : (
                                <Stack direction="row" flexWrap="wrap" gap={1}>
                                  {savedDashboardSummaries.map((dashboard) => (
                                    <Chip
                                      key={dashboard.id}
                                      label={dashboard.name}
                                      color={dashboard.id === activeDashboardId ? "primary" : "default"}
                                      variant={dashboard.id === activeDashboardId ? "filled" : "outlined"}
                                      sx={{ textTransform: "none" }}
                                    />
                                  ))}
                                </Stack>
                              )}
                            </Stack>
                          </>
                        )}
                      </Stack>
                    )}
                  </Stack>
                </CardContent>
              </Card>
              {effectiveViewMode === "dashboard" ? renderDashboardSummary() : renderNavigationTiles()}
            </Stack>
          </TilesContainer>
        </PageWrapper>
      </ThemeProvider>
    </PageAccessGuard>
  );
};

const DashboardCard = ({ card, liveState }: { card: DashboardCardDto; liveState?: DashboardCardLiveState }) => {
  const viewConfig = card.viewConfig as DashboardCardViewConfig;
  if (!viewConfig || typeof viewConfig !== "object") {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1">{card.title}</Typography>
          <Typography variant="body2" color="textSecondary">
            This card does not have a saved configuration.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  if (isVisualCardViewConfig(viewConfig)) {
    return <VisualDashboardCard card={card} config={viewConfig} liveState={liveState ?? { status: "idle" }} />;
  }

  if (isSpotlightCardViewConfig(viewConfig)) {
    return (
      <SpotlightDashboardCard card={card} config={viewConfig} liveState={liveState ?? { status: "idle" }} />
    );
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack gap={1}>
          <Typography variant="subtitle1">{card.title}</Typography>
          <Typography variant="body2" color="textSecondary">
            Legacy dashboard card format. Open the template to refresh this card.
          </Typography>
          <Box component="pre" sx={{ bgcolor: "grey.100", p: 2, borderRadius: 1, overflowX: "auto" }}>
            {JSON.stringify(viewConfig, null, 2)}
          </Box>
          <Button component={RouterLink} to={`/reports?templateId=${card.templateId}`} size="small">
            Open template
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

const VisualDashboardCard = ({
  card,
  config,
  liveState,
}: {
  card: DashboardCardDto;
  config: DashboardVisualCardViewConfig;
  liveState: DashboardCardLiveState;
}) => {
  const sample = liveState.visualSample ?? buildVisualSample(config);
  const isLoading = liveState.status === "loading";
  const error = liveState.status === "error" ? liveState.error : null;
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack gap={1.5}>
          <Typography variant="subtitle1">{card.title}</Typography>
          {config.description && (
            <Typography variant="body2" color="textSecondary">
              {config.description}
            </Typography>
          )}
          {liveState.warning && (
            <Alert severity="warning">{liveState.warning}</Alert>
          )}
          {isLoading && (
            <Stack direction="row" gap={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2" color="textSecondary">
                Refreshing data…
              </Typography>
            </Stack>
          )}
          {error && (
            <Alert severity="error">
              {error}
            </Alert>
          )}
          <Box sx={{ height: sample.length > 0 ? 240 : "auto" }}>
            {sample.length > 0 ? (
              renderVisualChart(config, sample)
            ) : (
              <Typography variant="body2" color="textSecondary">
                {isLoading ? "Loading chart data…" : "No data returned. Adjust the template filters to see values."}
              </Typography>
            )}
          </Box>
          <Button component={RouterLink} to={`/reports?templateId=${card.templateId}`} size="small">
            Open template
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

const SpotlightDashboardCard = ({
  card,
  config,
  liveState,
}: {
  card: DashboardCardDto;
  config: DashboardSpotlightCardViewConfig;
  liveState: DashboardCardLiveState;
}) => {
  const sampleCards = liveState.spotlightSample?.cards ?? config.sample?.cards ?? [];
  const isLoading = liveState.status === "loading";
  const error = liveState.status === "error" ? liveState.error : null;
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack gap={1.5}>
          <Typography variant="subtitle1">{card.title}</Typography>
          {config.description && (
            <Typography variant="body2" color="textSecondary">
              {config.description}
            </Typography>
          )}
          {liveState.warning && (
            <Alert severity="warning">{liveState.warning}</Alert>
          )}
          {isLoading && (
            <Stack direction="row" gap={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2" color="textSecondary">
                Refreshing data…
              </Typography>
            </Stack>
          )}
          {error && (
            <Alert severity="error">
              {error}
            </Alert>
          )}
          {sampleCards.length > 0 ? (
            <Stack direction={{ xs: "column", md: "row" }} gap={2}>
              {sampleCards.slice(0, 4).map((sampleCard) => (
                <Paper key={sampleCard.id} variant="outlined" sx={{ p: 2, flex: 1, minWidth: 180 }}>
                  <Stack gap={0.5}>
                    <Typography variant="subtitle2">{sampleCard.label}</Typography>
                    <Typography variant="h5">{sampleCard.value}</Typography>
                    {sampleCard.delta && (
                      <Typography variant="body2" sx={{ color: SpotlightTone[sampleCard.tone] ?? "text.primary" }}>
                        {sampleCard.delta} vs prior
                      </Typography>
                    )}
                    {sampleCard.context && (
                      <Typography variant="caption" color="textSecondary">
                        {sampleCard.context}
                      </Typography>
                    )}
                  </Stack>
                </Paper>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="textSecondary">
              {isLoading ? "Loading spotlight values…" : "No spotlight values returned for this template."}
            </Typography>
          )}
          <Button component={RouterLink} to={`/reports?templateId=${card.templateId}`} size="small">
            Open template
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default Home;
