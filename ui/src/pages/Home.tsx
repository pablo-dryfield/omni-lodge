import { Link as RouterLink } from "react-router-dom";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import PersonIcon from "@mui/icons-material/Person";
import SettingsIcon from "@mui/icons-material/Settings";
import BarChartIcon from "@mui/icons-material/BarChart";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import Grid from "@mui/material/Grid";
import {
  Alert,
  Chip,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  MenuItem,
  Paper,
  Stack,
  ThemeProvider,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  TextField,
  Switch,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { styled, alpha } from "@mui/material/styles";
import { createTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { GridStack } from "gridstack";
import "gridstack/dist/gridstack.min.css";
import { GenericPageProps } from "../types/general/GenericPageProps";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { navigateToPage } from "../actions/navigationActions";
import { selectAllowedNavigationPages } from "../selectors/accessControlSelectors";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { GraphicCard, type VisualChartPoint } from "../components/dashboard/GraphicCard";
import { SpotlightCard } from "../components/dashboard/SpotlightCardParts";
import type { NavigationIconKey } from "../types/general/NavigationState";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import {
  useReportDashboards,
  useHomeDashboardPreference,
  runBulkReportQueries,
  runDashboardPreviewCard,
  type DashboardCardDto,
  type DashboardCardViewConfig,
  type DashboardSpotlightCardViewConfig,
  type DashboardVisualCardViewConfig,
  type DashboardPreviewTableCardViewConfig,
  type FilterOperator,
  type HomeDashboardPreferenceDto,
  type MetricSpotlightDefinitionDto,
  type ReportQuerySuccessResponse,
  type ReportBulkQueryRequest,
  type ReportBulkQueryResultEntry,
  type QueryConfig,
  type QueryConfigFilter,
  type DashboardPreviewCardResponse,
  type DashboardPreviewPeriodOverride,
  type DashboardPreviewPeriodPreset,
} from "../api/reports";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";

dayjs.extend(isoWeek);

const PAGE_SLUG = PAGE_SLUGS.dashboard;
const DEFAULT_HOME_PREFERENCE: HomeDashboardPreferenceDto = {
  viewMode: "navigation",
  savedDashboardIds: [],
  activeDashboardId: null,
};

const DEFAULT_CARD_LAYOUT = {
  x: 0,
  y: 0,
  w: 6,
  h: 4,
};
const buildGridStackColumnStyles = (columns: number): string => {
  const columnWidth = 100 / columns;
  const rules = [`.gs-${columns} > .grid-stack-item { width: ${columnWidth.toFixed(6)}%; }`];
  for (let i = 0; i <= columns; i += 1) {
    const width = (columnWidth * i).toFixed(6);
    rules.push(`.gs-${columns} > .grid-stack-item[gs-w="${i}"] { width: ${width}%; }`);
    rules.push(`.gs-${columns} > .grid-stack-item[gs-x="${i}"] { left: ${width}%; }`);
  }
  return rules.join("\n");
};

const buildHomeGridCss = (columns: number): string => `
${buildGridStackColumnStyles(columns)}
.home-dashboard-grid .grid-stack-item-content {
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  height: 100%;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  padding: 0;
  cursor: default;
}
`;

const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;

type DashboardCardLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type DashboardLayoutMode = "desktop" | "mobile";

type CardLayoutMetrics = {
  columnSpan: number;
  rowSpan: number;
  approxHeightPx?: number;
};

const cloneConfig = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const normalizeCurrencyCode = (currency?: string): string => {
  const normalized = currency?.trim().toUpperCase();
  return normalized && normalized.length === 3 ? normalized : "PLN";
};

const formatCurrencyValue = (value: number, currency?: string): string => {
  const normalized = normalizeCurrencyCode(currency);
  const amount = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (normalized === "PLN") {
    return `${amount} zł`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: normalized,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatMetricValue = (
  value: number,
  format: MetricSpotlightDefinitionDto["format"] = "number",
  currency?: string,
): string => {
  if (!Number.isFinite(value)) {
    return "-";
  }

  switch (format) {
    case "currency":
      return formatCurrencyValue(value, currency);
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

const formatPreviewTableValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : String(value);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (value instanceof Date) {
    return value.toLocaleString();
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatDisplayDate = (value: string | undefined | null): string | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY") : value;
};

const formatPeriodBoundary = (value: dayjs.Dayjs): string => value.format("YYYY-MM-DD HH:mm:ss.SSS");

const computePeriodRange = (
  override: DashboardPreviewPeriodOverride | DashboardPreviewPeriodPreset | null,
): { from: string; to: string } | null => {
  if (!override) {
    return null;
  }
  if (typeof override === "string") {
    const today = dayjs();
    const getQuarterStart = (value: dayjs.Dayjs) => {
      const quarterIndex = Math.floor(value.month() / 3);
      const startMonth = quarterIndex * 3;
      return value.month(startMonth).startOf("month");
    };
    const getQuarterEnd = (value: dayjs.Dayjs) => value.add(2, "month").endOf("month");
    switch (override) {
      case "today":
        return {
          from: formatPeriodBoundary(today.startOf("day")),
          to: formatPeriodBoundary(today.endOf("day")),
        };
      case "yesterday": {
        const base = today.subtract(1, "day");
        return {
          from: formatPeriodBoundary(base.startOf("day")),
          to: formatPeriodBoundary(base.endOf("day")),
        };
      }
      case "all_time": {
        const from = dayjs("1900-01-01").startOf("day");
        const to = dayjs("2100-12-31").endOf("day");
        return {
          from: formatPeriodBoundary(from),
          to: formatPeriodBoundary(to),
        };
      }
      case "last_7_days": {
        const from = today.subtract(6, "day");
        return {
          from: formatPeriodBoundary(from.startOf("day")),
          to: formatPeriodBoundary(today.endOf("day")),
        };
      }
      case "last_week": {
        const base = today.subtract(1, "week");
        return {
          from: formatPeriodBoundary(base.startOf("isoWeek")),
          to: formatPeriodBoundary(base.endOf("isoWeek")),
        };
      }
      case "this_week":
        return {
          from: formatPeriodBoundary(today.startOf("isoWeek")),
          to: formatPeriodBoundary(today.endOf("isoWeek")),
        };
      case "last_30_days": {
        const from = today.subtract(29, "day");
        return {
          from: formatPeriodBoundary(from.startOf("day")),
          to: formatPeriodBoundary(today.endOf("day")),
        };
      }
      case "last_30_months": {
        const from = today.subtract(29, "month");
        return {
          from: formatPeriodBoundary(from.startOf("month")),
          to: formatPeriodBoundary(today.endOf("day")),
        };
      }
      case "last_month": {
        const base = today.subtract(1, "month");
        return {
          from: formatPeriodBoundary(base.startOf("month")),
          to: formatPeriodBoundary(base.endOf("month")),
        };
      }
      case "this_year":
        return {
          from: formatPeriodBoundary(today.startOf("year")),
          to: formatPeriodBoundary(today.endOf("year")),
        };
      case "this_quarter": {
        const quarterStart = getQuarterStart(today);
        return {
          from: formatPeriodBoundary(quarterStart),
          to: formatPeriodBoundary(getQuarterEnd(quarterStart)),
        };
      }
      case "last_quarter": {
        const quarterStart = getQuarterStart(today).subtract(3, "month");
        return {
          from: formatPeriodBoundary(quarterStart),
          to: formatPeriodBoundary(getQuarterEnd(quarterStart)),
        };
      }
      case "this_month":
      default:
        return {
          from: formatPeriodBoundary(today.startOf("month")),
          to: formatPeriodBoundary(today.endOf("month")),
        };
    }
  }
  if (override.mode === "custom" && override.from && override.to) {
    return {
      from: override.from,
      to: override.to,
    };
  }
  return null;
};

const normalizeCustomDateRange = (from: string, to: string): { from: string; to: string } | null => {
  const fromDate = dayjs(from, "YYYY-MM-DD", true);
  const toDate = dayjs(to, "YYYY-MM-DD", true);
  if (!fromDate.isValid() || !toDate.isValid()) {
    return null;
  }
  if (fromDate.isAfter(toDate)) {
    return null;
  }
  return {
    from: formatPeriodBoundary(fromDate.startOf("day")),
    to: formatPeriodBoundary(toDate.endOf("day")),
  };
};

const normalizeQueryRange = (
  range?: { from?: string; to?: string } | null,
): { from: string; to: string } | null => {
  const from = typeof range?.from === "string" && range.from.trim().length > 0 ? range.from.trim() : null;
  const to = typeof range?.to === "string" && range.to.trim().length > 0 ? range.to.trim() : null;
  if (!from || !to) {
    return null;
  }
  return { from, to };
};

const extractFilterRange = (filter?: QueryConfigFilter | null): { from: string; to: string } | null => {
  if (!filter || filter.operator !== "between") {
    return null;
  }
  const value = filter.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const from = typeof value.from === "string" ? value.from : null;
    const to = typeof value.to === "string" ? value.to : null;
    if (from && to) {
      return { from, to };
    }
  }
  return null;
};

const resolveVisualDateRange = (
  config: DashboardVisualCardViewConfig,
  periodOverride: DashboardPreviewPeriodOverride | DashboardPreviewPeriodPreset | null,
  dateFilterOverride?: { modelId: string; fieldId: string; operator: FilterOperator } | null,
): { from: string; to: string } | null => {
  const overrideRange =
    periodOverride && cardSupportsPeriodOverride(config) ? computePeriodRange(periodOverride) : null;
  if (overrideRange) {
    return overrideRange;
  }
  const activeDateFilter = dateFilterOverride ?? config.dateFilter ?? null;
  if (activeDateFilter && Array.isArray(config.queryConfig?.filters)) {
    const match = config.queryConfig.filters.find(
      (filter) => filter.modelId === activeDateFilter.modelId && filter.fieldId === activeDateFilter.fieldId,
    );
    const filterRange = extractFilterRange(match);
    if (filterRange) {
      return filterRange;
    }
  }
  return normalizeQueryRange(config.queryConfig?.time?.range ?? undefined);
};

const formatRangeLabel = (range: { from: string; to: string } | null): string | null => {
  if (!range) {
    return null;
  }
  const from = formatDisplayDate(range.from);
  const to = formatDisplayDate(range.to);
  if (!from || !to) {
    return null;
  }
  return from === to ? from : `${from} - ${to}`;
};

const computeComparisonRange = (
  comparison: MetricSpotlightDefinitionDto["comparison"] | undefined,
  baseRange: { from: string; to: string } | null,
  customRange?: MetricSpotlightDefinitionDto["comparisonRange"] | null,
): { from: string; to: string } | null => {
  if (!comparison) {
    return null;
  }
  if (comparison === "custom") {
    if (!customRange) {
      return null;
    }
    return normalizeCustomDateRange(customRange.from, customRange.to);
  }
  if (!baseRange) {
    return null;
  }
  const fromDate = dayjs(baseRange.from);
  const toDate = dayjs(baseRange.to);
  if (!fromDate.isValid() || !toDate.isValid()) {
    return null;
  }
  if (comparison === "previous") {
    const durationMs = toDate.valueOf() - fromDate.valueOf() + 1;
    const comparisonFrom = fromDate.subtract(durationMs, "millisecond");
    const comparisonTo = toDate.subtract(durationMs, "millisecond");
    return {
      from: formatPeriodBoundary(comparisonFrom),
      to: formatPeriodBoundary(comparisonTo),
    };
  }
  if (comparison === "wow") {
    return {
      from: formatPeriodBoundary(fromDate.subtract(7, "day")),
      to: formatPeriodBoundary(toDate.subtract(7, "day")),
    };
  }
  if (comparison === "mom") {
    return {
      from: formatPeriodBoundary(fromDate.subtract(1, "month")),
      to: formatPeriodBoundary(toDate.subtract(1, "month")),
    };
  }
  if (comparison === "yoy") {
    return {
      from: formatPeriodBoundary(fromDate.subtract(1, "year")),
      to: formatPeriodBoundary(toDate.subtract(1, "year")),
    };
  }
  return null;
};

const applyPeriodOverrideToQueryConfig = (
  queryConfig: QueryConfig | null,
  override: DashboardPreviewPeriodOverride | DashboardPreviewPeriodPreset | null,
  metadata?: { modelId: string; fieldId: string; operator: FilterOperator } | null,
): QueryConfig | null => {
  if (!queryConfig || !override) {
    return queryConfig;
  }
  const range = computePeriodRange(override);
  if (!range) {
    return queryConfig;
  }
  if (queryConfig.time && queryConfig.time.field) {
    queryConfig.time = {
      ...queryConfig.time,
      range,
    };
  }
  if (metadata) {
    const filters = Array.isArray(queryConfig.filters) ? [...queryConfig.filters] : [];
    const nextFilters = filters.filter(
      (filter) => !(filter.modelId === metadata.modelId && filter.fieldId === metadata.fieldId),
    );
    const operator: QueryConfigFilter["operator"] = "between";
    const value = { from: range.from, to: range.to };
    nextFilters.push({
      modelId: metadata.modelId,
      fieldId: metadata.fieldId,
      operator: operator as QueryConfigFilter["operator"],
      value,
    });
    queryConfig.filters = nextFilters;
  }
  return queryConfig;
};

const cardSupportsPeriodOverride = (viewConfig: DashboardCardViewConfig | null | undefined): boolean => {
  if (!viewConfig || typeof viewConfig !== "object") {
    return false;
  }
  if (isPreviewTableCardViewConfig(viewConfig)) {
    return Boolean(viewConfig.dateFilter);
  }
  if (isVisualCardViewConfig(viewConfig)) {
    return Boolean(viewConfig.dateFilter || viewConfig.dateFilterOptions?.length || viewConfig.queryConfig?.time?.field);
  }
  if (isSpotlightCardViewConfig(viewConfig)) {
    return false;
  }
  return false;
};

const isPreviewTableCardViewConfig = (
  config: DashboardCardViewConfig | null | undefined,
): config is DashboardPreviewTableCardViewConfig =>
  Boolean(
    config &&
      config.mode === "preview_table" &&
      typeof (config as DashboardPreviewTableCardViewConfig).previewRequest === "object",
  );

type DashboardCardLiveState = {
  status: "idle" | "loading" | "error" | "success";
  visualSample?: VisualChartPoint[];
  spotlightSample?: DashboardSpotlightCardViewConfig["sample"];
  previewSample?: {
    columns: string[];
    columnOrder: string[];
    columnAliases: Record<string, string>;
    rows: Array<Record<string, unknown>>;
    executedAt?: string | null;
  };
  error?: string | null;
  warning?: string | null;
};

type CardHydrationDescriptor =
  | {
      mode: "preview_table";
      card: DashboardCardDto;
      viewConfig: DashboardPreviewTableCardViewConfig;
      cacheKey: string;
      periodOverride: DashboardPreviewPeriodOverride | DashboardPreviewPeriodPreset | null;
    }
  | {
      mode: "visual";
      card: DashboardCardDto;
      viewConfig: DashboardCardViewConfig | null;
      queryConfig: QueryConfig | null;
      cacheKey: string;
    }
  | {
      mode: "spotlight";
      card: DashboardCardDto;
      viewConfig: DashboardSpotlightCardViewConfig;
      queryConfig: QueryConfig | null;
      comparisonQueryConfig: QueryConfig | null;
      baseRange: { from: string; to: string } | null;
      comparisonRange: { from: string; to: string } | null;
      cacheKey: string;
    }
  | {
      mode: "legacy";
      card: DashboardCardDto;
      viewConfig: DashboardCardViewConfig | null;
      queryConfig: QueryConfig | null;
      cacheKey: string;
    };

type PreviewPeriodValue = DashboardPreviewPeriodPreset | "custom";
type SpotlightPeriodSelection = DashboardPreviewPeriodPreset | "custom";
type VisualPeriodSelection = DashboardPreviewPeriodPreset | "custom";

const PERIOD_OPTIONS: Array<{ value: PreviewPeriodValue; label: string }> = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Custom range" },
];

const SPOTLIGHT_PERIOD_OPTIONS: Array<{ value: DashboardPreviewPeriodPreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "all_time", label: "All time" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_week", label: "Last week" },
  { value: "this_week", label: "This week" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_30_months", label: "Last 30 months" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_year", label: "This year" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_quarter", label: "Last quarter" },
];

const SPOTLIGHT_PERIOD_LABEL_LOOKUP = new Map(
  SPOTLIGHT_PERIOD_OPTIONS.map((option) => [option.value, option.label]),
);

const getSpotlightPeriodLabel = (preset: DashboardPreviewPeriodPreset): string =>
  SPOTLIGHT_PERIOD_LABEL_LOOKUP.get(preset) ?? preset.replace(/_/g, " ");

const normalizeSpotlightPeriodConfig = (
  config: DashboardSpotlightCardViewConfig | null | undefined,
): {
  presets: DashboardPreviewPeriodPreset[];
  defaultPreset: DashboardPreviewPeriodPreset;
  allowCustom?: boolean;
} | null => {
  const hasDateFilter = Boolean(config?.dateFilter || config?.dateFilterOptions?.length);
  if (!config?.periodConfig || !hasDateFilter) {
    return null;
  }
  const presets = Array.isArray(config.periodConfig.presets)
    ? config.periodConfig.presets.filter(
        (preset): preset is DashboardPreviewPeriodPreset =>
          typeof preset === "string" && SPOTLIGHT_PERIOD_LABEL_LOOKUP.has(preset),
      )
    : [];
  if (presets.length === 0) {
    return null;
  }
  const defaultPreset = presets.includes(config.periodConfig.defaultPreset)
    ? config.periodConfig.defaultPreset
    : presets[0];
  return {
    presets,
    defaultPreset,
    allowCustom: Boolean(config.periodConfig.allowCustom),
  };
};

const normalizeVisualPeriodConfig = (
  config: DashboardVisualCardViewConfig | null | undefined,
): {
  presets: DashboardPreviewPeriodPreset[];
  defaultPreset: DashboardPreviewPeriodPreset;
  allowCustom?: boolean;
} | null => {
  const hasDateFilter = Boolean(config?.dateFilter || config?.dateFilterOptions?.length);
  if (!config?.periodConfig || !hasDateFilter) {
    return null;
  }
  const presets = Array.isArray(config.periodConfig.presets)
    ? config.periodConfig.presets.filter(
        (preset): preset is DashboardPreviewPeriodPreset =>
          typeof preset === "string" && SPOTLIGHT_PERIOD_LABEL_LOOKUP.has(preset),
      )
    : [];
  if (presets.length === 0) {
    return null;
  }
  const defaultPreset = presets.includes(config.periodConfig.defaultPreset)
    ? config.periodConfig.defaultPreset
    : presets[0];
  return {
    presets,
    defaultPreset,
    allowCustom: Boolean(config.periodConfig.allowCustom),
  };
};

type DashboardDateFilterOption = {
  id: string;
  modelId: string;
  fieldId: string;
  operator: FilterOperator;
  label?: string;
  filterIndex?: number;
  clauseSql?: string;
  filterPath?: number[];
};

const buildDateFilterOptionId = (entry: { id?: string; modelId: string; fieldId: string; operator: FilterOperator }) =>
  entry.id ?? `${entry.modelId}.${entry.fieldId}.${entry.operator}`;

const sanitizeDateFilterLabel = (value: string): string => value.replace(/\s*\([^)]*\)\s*$/, "").trim();

const buildDateFilterOptionLabel = (entry: { label?: string; modelId: string; fieldId: string }) => {
  const base = entry.label ?? `${entry.modelId}.${entry.fieldId}`;
  return sanitizeDateFilterLabel(base);
};

const resolveDateFilterOptions = (
  config: DashboardVisualCardViewConfig | DashboardSpotlightCardViewConfig,
): DashboardDateFilterOption[] => {
  const options: DashboardDateFilterOption[] = Array.isArray(config.dateFilterOptions)
    ? config.dateFilterOptions
        .map((option) => ({
          ...option,
          id: buildDateFilterOptionId(option),
          label: buildDateFilterOptionLabel(option),
        }))
        .filter((option) => option.id.length > 0)
    : [];
  const defaultFilter = config.dateFilter
    ? {
        id: buildDateFilterOptionId(config.dateFilter),
        modelId: config.dateFilter.modelId,
        fieldId: config.dateFilter.fieldId,
        operator: config.dateFilter.operator,
        label: buildDateFilterOptionLabel(config.dateFilter),
        ...(config.dateFilter.filterIndex !== undefined ? { filterIndex: config.dateFilter.filterIndex } : {}),
        ...(config.dateFilter.filterPath ? { filterPath: config.dateFilter.filterPath } : {}),
        ...(config.dateFilter.clauseSql ? { clauseSql: config.dateFilter.clauseSql } : {}),
      }
    : null;
  if (
    defaultFilter &&
    !options.some((option) => option.id === defaultFilter.id) &&
    !options.some(
      (option) =>
        option.modelId === defaultFilter.modelId &&
        option.fieldId === defaultFilter.fieldId &&
        option.operator === defaultFilter.operator,
    )
  ) {
    return [defaultFilter, ...options];
  }
  return options;
};

const resolveSelectedDateFilterIds = (
  config: DashboardVisualCardViewConfig | DashboardSpotlightCardViewConfig,
  options: DashboardDateFilterOption[],
): string[] => {
  const allowedIds = options.map((option) => option.id);
  const configured = Array.isArray(config.dateFilterSelections) ? config.dateFilterSelections : [];
  const normalized = configured.filter((id) => allowedIds.includes(id));
  if (normalized.length > 0) {
    return normalized;
  }
  if (config.dateFilter) {
    const match = options.find(
      (option) =>
        option.modelId === config.dateFilter?.modelId &&
        option.fieldId === config.dateFilter?.fieldId &&
        option.operator === config.dateFilter?.operator,
    );
    if (match) {
      return [match.id];
    }
  }
  return allowedIds.length > 0 ? [allowedIds[0]] : [];
};

const resolveSelectedDateFilters = (
  config: DashboardVisualCardViewConfig | DashboardSpotlightCardViewConfig,
): DashboardDateFilterOption[] => {
  const options = resolveDateFilterOptions(config);
  if (options.length === 0) {
    return [];
  }
  const selectedIds = resolveSelectedDateFilterIds(config, options);
  const selected = options.filter((option) => selectedIds.includes(option.id));
  return selected.length > 0 ? selected : options;
};

const resolveSelectedDateFiltersForCard = (
  config: DashboardVisualCardViewConfig | DashboardSpotlightCardViewConfig,
  selectedIdsOverride?: string[] | null,
): DashboardDateFilterOption[] => {
  const options = resolveDateFilterOptions(config);
  if (options.length === 0) {
    return [];
  }
  if (selectedIdsOverride && selectedIdsOverride.length > 0) {
    const selected = options.filter((option) => selectedIdsOverride.includes(option.id));
    if (selected.length > 0) {
      return selected;
    }
  }
  return resolveSelectedDateFilters(config);
};

const resolveNextSelectedDateFilterIds = (
  options: DashboardDateFilterOption[] | undefined,
  currentIds: string[] | undefined,
  toggledId: string,
): string[] => {
  if (!options || options.length === 0) {
    return currentIds ?? [];
  }
  const optionIds = options.map((option) => option.id);
  const normalizedCurrent = (currentIds ?? []).filter((id) => optionIds.includes(id));
  if (!optionIds.includes(toggledId)) {
    return normalizedCurrent.length > 0 ? normalizedCurrent : [optionIds[0]];
  }
  const isSelected = normalizedCurrent.includes(toggledId);
  const next = isSelected
    ? normalizedCurrent.filter((id) => id !== toggledId)
    : [...normalizedCurrent, toggledId];
  const ordered = optionIds.filter((id) => next.includes(id));
  return ordered.length > 0 ? ordered : [optionIds[0]];
};

type DateFilterSignature = { modelId: string; fieldId: string; operator: FilterOperator };

const resolveDateFilterSignature = (
  options: DashboardDateFilterOption[] | undefined,
  dateFilterId: string,
): DateFilterSignature | null => {
  if (!options || options.length === 0) {
    return null;
  }
  const match = options.find((option) => option.id === dateFilterId);
  return match ? { modelId: match.modelId, fieldId: match.fieldId, operator: match.operator } : null;
};

const findOptionIdBySignature = (
  options: DashboardDateFilterOption[] | undefined,
  signature: DateFilterSignature | null,
): string | null => {
  if (!options || options.length === 0 || !signature) {
    return null;
  }
  const match = options.find(
    (option) =>
      option.modelId === signature.modelId &&
      option.fieldId === signature.fieldId &&
      option.operator === signature.operator,
  );
  return match?.id ?? null;
};

const resolveToggleIdForOptions = (
  options: DashboardDateFilterOption[] | undefined,
  signature: DateFilterSignature | null,
  fallbackId: string,
): string | null => {
  if (!options || options.length === 0) {
    return null;
  }
  if (signature) {
    const matched = findOptionIdBySignature(options, signature);
    if (matched) {
      return matched;
    }
  }
  return options.some((option) => option.id === fallbackId) ? fallbackId : null;
};

const resolveActiveDateFilter = (
  config: DashboardVisualCardViewConfig | DashboardSpotlightCardViewConfig,
  selectedId: string | null | undefined,
): DashboardDateFilterOption | null => {
  const options = resolveDateFilterOptions(config);
  if (selectedId) {
    const match = options.find((option) => option.id === selectedId);
    if (match) {
      return match;
    }
  }
  if (config.dateFilter) {
    const match = options.find(
      (option) =>
        option.modelId === config.dateFilter?.modelId &&
        option.fieldId === config.dateFilter?.fieldId &&
        option.operator === config.dateFilter?.operator,
    );
    if (match) {
      return match;
    }
    return {
      id: buildDateFilterOptionId(config.dateFilter),
      modelId: config.dateFilter.modelId,
      fieldId: config.dateFilter.fieldId,
      operator: config.dateFilter.operator,
      label: buildDateFilterOptionLabel(config.dateFilter),
      ...(config.dateFilter.filterIndex !== undefined ? { filterIndex: config.dateFilter.filterIndex } : {}),
      ...(config.dateFilter.filterPath ? { filterPath: config.dateFilter.filterPath } : {}),
      ...(config.dateFilter.clauseSql ? { clauseSql: config.dateFilter.clauseSql } : {}),
    };
  }
  return options[0] ?? null;
};

const buildCustomPeriodOverride = (
  range: { from: string; to: string } | null,
): DashboardPreviewPeriodOverride | null =>
  range ? { mode: "custom", from: range.from, to: range.to } : null;

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
    case "barChart":
      return <BarChartIcon fontSize="large" />;
    case "star":
      return <SportsEsportsIcon fontSize="large" />;
    default:
      return <PersonIcon fontSize="large" />;
  }
};

const PageWrapper = styled("div")(({ theme: muiTheme }) => ({
  display: "flex",
  alignItems: "flex-start",
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

const TileButtonWrapper = styled("div")(({ theme: muiTheme }) => ({
  display: "flex",
  justifyContent: "center",
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

const StyledDashboardCard = styled(Card)(({ theme: muiTheme }) => ({
  height: "100%",
  borderRadius: 18,
  borderColor: muiTheme.palette.mode === "dark" ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.08)",
  background: muiTheme.palette.mode === "dark" ? "rgba(15,23,42,0.85)" : "linear-gradient(180deg,#ffffff 0%,#f7f9fc 100%)",
  boxShadow:
    "0 8px 24px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.5)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  minHeight: 140,
}));

const CardAccent = styled("div")(({ theme: muiTheme }) => ({
  width: "100%",
  height: 4,
  borderRadius: "999px",
  background: `linear-gradient(90deg, ${muiTheme.palette.primary.main}, ${muiTheme.palette.secondary.main})`,
  opacity: 0.7,
}));

const CardTitle = styled(Typography)(({ theme: muiTheme }) => ({
  fontWeight: 600,
  letterSpacing: 0.2,
  color: muiTheme.palette.text.primary,
}));

const CardSubtitle = styled(Typography)(({ theme: muiTheme }) => ({
  color: muiTheme.palette.text.secondary,
  fontSize: 13,
  lineHeight: 1.5,
}));

const PageName = styled(Typography)(({ theme: muiTheme }) => ({
  color: muiTheme.palette.text.primary,
  textDecoration: "none",
  marginTop: muiTheme.spacing(1),
}));

const formatSpotlightRangeLabel = (range: { from: string; to: string } | null): string | null => {
  if (!range) {
    return null;
  }
  const fromLabel = formatDisplayDate(range.from);
  const toLabel = formatDisplayDate(range.to);
  if (!fromLabel || !toLabel) {
    return null;
  }
  return `${fromLabel} - ${toLabel}`;
};

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

type PreviewInsight = {
  headline: string;
  detail?: string;
  tone: "positive" | "neutral" | "negative";
  metricLabel?: string;
};

const formatPercent = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  return `${(value * 100).toFixed(1)}%`;
};

const guessDimensionColumn = (
  rows: Array<Record<string, unknown>>,
  columns: string[],
): string | null => {
  if (!rows.length || columns.length === 0) {
    return null;
  }
  for (const column of columns) {
    const hasString = rows.some((row) => typeof row?.[column] === "string" && (row[column] as string).trim().length > 0);
    if (hasString) {
      return column;
    }
  }
  return columns[0] ?? null;
};

const guessMetricColumn = (
  rows: Array<Record<string, unknown>>,
  columns: string[],
  exclude?: string | null,
): string | null => {
  if (!rows.length) {
    return null;
  }
  for (const column of columns) {
    if (exclude && column === exclude) {
      continue;
    }
    const hasNumber = rows.some((row) => typeof row?.[column] === "number" && Number.isFinite(row[column] as number));
    if (hasNumber) {
      return column;
    }
  }
  return null;
};

const buildPreviewInsight = (
  rows: Array<Record<string, unknown>>,
  columns: string[],
  columnAliases: Record<string, string>,
): PreviewInsight | null => {
  if (!rows.length || columns.length === 0) {
    return null;
  }
  const dimensionColumn = guessDimensionColumn(rows, columns);
  const metricColumn = guessMetricColumn(rows, columns, dimensionColumn);
  if (!dimensionColumn || !metricColumn) {
    return null;
  }
  const topRow = rows[0];
  const dimensionValue = formatPreviewTableValue(topRow[dimensionColumn]);
  const metricValue = toNumeric(topRow[metricColumn]);
  if (metricValue === null) {
    return null;
  }
  const metricLabel = columnAliases[metricColumn] ?? metricColumn;
  const secondRow = rows[1];
  const secondValue = secondRow ? toNumeric(secondRow[metricColumn]) : null;
  let detail: string | undefined;
  let tone: PreviewInsight["tone"] = "neutral";
  if (secondValue !== null && secondValue !== 0) {
    const delta = metricValue - secondValue;
    const percent = formatPercent(delta / Math.abs(secondValue));
    tone = delta >= 0 ? "positive" : "negative";
    detail = `${delta >= 0 ? "+" : ""}${percent} vs runner-up`;
  } else if (secondValue !== null) {
    const delta = metricValue - secondValue;
    tone = delta >= 0 ? "positive" : "negative";
    detail = `${delta >= 0 ? "+" : ""}${formatPreviewTableValue(delta)} vs runner-up`;
  }
  return {
    headline: `${dimensionValue} leads ${metricLabel} at ${formatPreviewTableValue(metricValue)}`,
    detail,
    tone,
    metricLabel,
  };
};

const HOME_LAYOUT_SOURCE_COLUMNS_DESKTOP = 168;
const HOME_LAYOUT_SOURCE_COLUMNS_MOBILE = 48;
const HOME_LAYOUT_LEGACY_COLUMNS = 12;

const scaleDashboardLayoutColumns = (
  layout: DashboardCardLayout,
  fromColumns: number,
  toColumns: number,
): DashboardCardLayout => {
  if (fromColumns <= 0 || toColumns <= 0 || fromColumns === toColumns) {
    return { ...layout };
  }
  const ratio = toColumns / fromColumns;
  const nextWidth = Math.max(1, Math.round(layout.w * ratio));
  let nextX = Math.max(0, Math.round(layout.x * ratio));
  const maxX = Math.max(0, toColumns - nextWidth);
  if (nextX > maxX) {
    nextX = maxX;
  }
  return {
    ...layout,
    x: nextX,
    w: Math.min(toColumns, nextWidth),
  };
};

const resolveLayoutNumber = (
  source: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number,
): number => {
  const candidate = source?.[key as keyof typeof source];
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }
  if (typeof candidate === "string") {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const isLegacyColumnLayout = (source: Record<string, unknown> | null | undefined): boolean => {
  if (!source) {
    return false;
  }
  const width = resolveLayoutNumber(source, "w", 0);
  const x = resolveLayoutNumber(source, "x", 0);
  return width > 0 && width <= HOME_LAYOUT_LEGACY_COLUMNS && x <= HOME_LAYOUT_LEGACY_COLUMNS;
};

const parseLayoutSource = (
  source: Record<string, unknown> | null | undefined,
  fallback: DashboardCardLayout,
  maxColumns: number,
): DashboardCardLayout => {
  const resolve = (key: string, defaultValue: number): number => {
    return resolveLayoutNumber(source, key, defaultValue);
  };
  const width = Math.max(1, Math.min(maxColumns, resolve("w", fallback.w)));
  const height = Math.max(1, resolve("h", fallback.h));
  const x = resolve("x", fallback.x);
  const y = resolve("y", fallback.y);
  const maxX = Math.max(0, maxColumns - width);
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, y),
    w: width,
    h: height,
  };
};

const resolveDashboardLayout = (
  layout: Record<string, unknown> | null | undefined,
  mode: DashboardLayoutMode,
  targetColumns: number,
  fallback: DashboardCardLayout = DEFAULT_CARD_LAYOUT,
): DashboardCardLayout => {
  const source = layout && typeof layout === "object" ? layout : {};
  const desktopSource =
    Object.prototype.hasOwnProperty.call(source, "desktop") && typeof (source as { desktop?: unknown }).desktop === "object"
      ? ((source as { desktop?: Record<string, unknown> }).desktop ?? null)
      : null;
  const mobileSource =
    Object.prototype.hasOwnProperty.call(source, "mobile") && typeof (source as { mobile?: unknown }).mobile === "object"
      ? ((source as { mobile?: Record<string, unknown> }).mobile ?? null)
      : null;
  const hasBuckets = Boolean(desktopSource || mobileSource);

  if (!hasBuckets) {
    const parsed = parseLayoutSource(source, fallback, HOME_LAYOUT_LEGACY_COLUMNS);
    return scaleDashboardLayoutColumns(parsed, HOME_LAYOUT_LEGACY_COLUMNS, targetColumns);
  }

  if (mode === "mobile") {
    if (mobileSource) {
      const legacyMobile = isLegacyColumnLayout(mobileSource);
      const sourceColumns = legacyMobile ? HOME_LAYOUT_LEGACY_COLUMNS : HOME_LAYOUT_SOURCE_COLUMNS_MOBILE;
      const parsed = parseLayoutSource(mobileSource, fallback, sourceColumns);
      return scaleDashboardLayoutColumns(parsed, sourceColumns, targetColumns);
    }
    const desktopCandidate = desktopSource ?? source;
    const legacyDesktop = isLegacyColumnLayout(desktopCandidate);
    const desktopColumns = legacyDesktop ? HOME_LAYOUT_LEGACY_COLUMNS : HOME_LAYOUT_SOURCE_COLUMNS_DESKTOP;
    const desktopParsed = parseLayoutSource(desktopCandidate, fallback, desktopColumns);
    const derivedMobile = scaleDashboardLayoutColumns(
      desktopParsed,
      desktopColumns,
      HOME_LAYOUT_SOURCE_COLUMNS_MOBILE,
    );
    return scaleDashboardLayoutColumns(derivedMobile, HOME_LAYOUT_SOURCE_COLUMNS_MOBILE, targetColumns);
  }

  if (desktopSource) {
    const legacyDesktop = isLegacyColumnLayout(desktopSource);
    const sourceColumns = legacyDesktop ? HOME_LAYOUT_LEGACY_COLUMNS : HOME_LAYOUT_SOURCE_COLUMNS_DESKTOP;
    const parsed = parseLayoutSource(desktopSource, fallback, sourceColumns);
    return scaleDashboardLayoutColumns(parsed, sourceColumns, targetColumns);
  }
  if (mobileSource) {
    const legacyMobile = isLegacyColumnLayout(mobileSource);
    const sourceColumns = legacyMobile ? HOME_LAYOUT_LEGACY_COLUMNS : HOME_LAYOUT_SOURCE_COLUMNS_MOBILE;
    const parsed = parseLayoutSource(mobileSource, fallback, sourceColumns);
    return scaleDashboardLayoutColumns(parsed, sourceColumns, targetColumns);
  }
  const parsed = parseLayoutSource(source, fallback, HOME_LAYOUT_LEGACY_COLUMNS);
  return scaleDashboardLayoutColumns(parsed, HOME_LAYOUT_LEGACY_COLUMNS, targetColumns);
};

const HOME_GRID_ROW_HEIGHT_PX = 12;

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

const getComparisonLabel = (
  comparison?: MetricSpotlightDefinitionDto["comparison"],
  comparisonRange?: MetricSpotlightDefinitionDto["comparisonRange"] | null,
): string | null => {
  switch (comparison) {
    case "previous":
      return "Previous period";
    case "wow":
      return "Week over week";
    case "mom":
      return "Month over month";
    case "yoy":
      return "Year over year";
    case "custom": {
      const from = comparisonRange?.from ? formatDisplayDate(comparisonRange.from) : null;
      const to = comparisonRange?.to ? formatDisplayDate(comparisonRange.to) : null;
      if (from && to) {
        return `Custom compare ${from} - ${to}`;
      }
      return "Custom compare";
    }
    default:
      return null;
  }
};

const computeLiveCardState = (
  card: DashboardCardDto,
  viewConfig: DashboardCardViewConfig | null | undefined,
  templateState?: {
    data?: ReportQuerySuccessResponse;
    comparisonData?: ReportQuerySuccessResponse | null;
    baseRange?: { from: string; to: string } | null;
    comparisonRange?: { from: string; to: string } | null;
    isLoading: boolean;
    error?: string | null;
  },
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
    const sample = buildSpotlightSampleFromResult(
      viewConfig,
      templateState.data,
      templateState.comparisonData ?? null,
      templateState.baseRange ?? null,
      templateState.comparisonRange ?? null,
    );
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
  comparisonResult?: ReportQuerySuccessResponse | null,
  baseRange?: { from: string; to: string } | null,
  comparisonRange?: { from: string; to: string } | null,
): DashboardSpotlightCardViewConfig["sample"] | undefined => {
  if (!result || !Array.isArray(result.rows) || result.rows.length === 0) {
    return undefined;
  }
  const metricAlias = config.spotlight.metric;
  if (!metricAlias) {
    return undefined;
  }
  const effectiveAlias = (() => {
    if (metricAlias in result.rows[0]) {
      return metricAlias;
    }
    const aggregation = config.spotlight.aggregation ?? "sum";
    const aggregatedAlias = `${metricAlias}_${aggregation}`;
    return aggregatedAlias in result.rows[0] ? aggregatedAlias : metricAlias;
  })();

  const aggregateValues = (
    values: number[],
    aggregation: MetricSpotlightDefinitionDto["aggregation"] | undefined,
  ): number | null => {
    if (values.length === 0) {
      return null;
    }
    switch (aggregation) {
      case "avg":
        return values.reduce((total, value) => total + value, 0) / values.length;
      case "min":
        return Math.min(...values);
      case "max":
        return Math.max(...values);
      case "count":
        return values.length;
      case "count_distinct":
        return new Set(values).size;
      case "sum":
      default:
        return values.reduce((total, value) => total + value, 0);
    }
  };

  const values = result.rows
    .map((row) => coerceNumber(row[effectiveAlias]))
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return undefined;
  }
  const aggregatedValue = aggregateValues(values, config.spotlight.aggregation);
  if (aggregatedValue === null) {
    return undefined;
  }
  const formattedValue = formatMetricValue(
    aggregatedValue,
    config.spotlight.format,
    config.spotlight.currency,
  );
  let delta = "-";
  let tone: "positive" | "neutral" | "negative" = "neutral";
  const contextParts: string[] = [];
  let comparisonValue: number | null = null;
  if (comparisonResult && Array.isArray(comparisonResult.rows)) {
    const comparisonValues = comparisonResult.rows
      .map((row) => coerceNumber(row[effectiveAlias]))
      .filter((value): value is number => value !== null);
    if (comparisonValues.length > 0) {
      const aggregatedComparison = aggregateValues(comparisonValues, config.spotlight.aggregation);
      comparisonValue = aggregatedComparison;
    }
  }
  let comparisonApplied = false;
  let comparisonLabel: string | null = null;
  const rangeLabel = formatRangeLabel(baseRange ?? null);
  const comparisonRangeLabel = formatRangeLabel(comparisonRange ?? null);

  if (config.spotlight.comparison && comparisonValue !== null) {
    const difference = aggregatedValue - comparisonValue;
    tone = difference >= 0 ? "positive" : "negative";
    delta = `${difference >= 0 ? "+" : ""}${formatMetricValue(
      difference,
      config.spotlight.format,
      config.spotlight.currency,
    )}`;
    comparisonLabel = getComparisonLabel(config.spotlight.comparison, config.spotlight.comparisonRange ?? null);
    if (comparisonLabel) {
      contextParts.push(comparisonLabel);
    }
    comparisonApplied = true;
  }

  if (typeof config.spotlight.target === "number") {
    if (!comparisonApplied) {
      const difference = aggregatedValue - config.spotlight.target;
      tone = difference >= 0 ? "positive" : "negative";
      delta = `${difference >= 0 ? "+" : ""}${formatMetricValue(
        difference,
        config.spotlight.format,
        config.spotlight.currency,
      )}`;
    }
    contextParts.push(
      `Target ${formatMetricValue(
        config.spotlight.target,
        config.spotlight.format,
        config.spotlight.currency,
      )}`,
    );
  }

  const cards = [
    {
      id: metricAlias,
      label: config.spotlight.label?.trim() || config.spotlight.metricLabel || metricAlias,
      value: formattedValue,
      delta,
      context: contextParts.join(" • "),
      tone,
      ...(comparisonApplied && comparisonValue !== null
        ? {
            comparisonValue: formatMetricValue(
              comparisonValue,
              config.spotlight.format,
              config.spotlight.currency,
            ),
            comparisonLabel: comparisonLabel ?? undefined,
          }
        : {}),
      ...(rangeLabel ? { rangeLabel } : {}),
      ...(comparisonRangeLabel ? { comparisonRangeLabel } : {}),
    },
  ];
  return { cards };
};

const Home = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();

  const handleOpenMiniGame = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.dispatchEvent(new CustomEvent("omni-open-game"));
  }, []);

  useEffect(() => {
    dispatch(navigateToPage(props.title));
  }, [dispatch, props.title]);

  const allowedPages = useAppSelector(selectAllowedNavigationPages);
  const canUseDashboards = useMemo(
    () => allowedPages.some((page) => page.slug === PAGE_SLUGS.reports),
    [allowedPages],
  );

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
  const activeDashboard = dashboards.find((dashboard) => dashboard.id === activeDashboardId) ?? null;
  const activeCards = useMemo(() => activeDashboard?.cards ?? [], [activeDashboard]);
  const orderedActiveCards = useMemo(
    () =>
      activeCards
        .slice()
        .sort((a, b) => {
          const layoutA = resolveDashboardLayout(a.layout, "desktop", HOME_LAYOUT_LEGACY_COLUMNS);
          const layoutB = resolveDashboardLayout(b.layout, "desktop", HOME_LAYOUT_LEGACY_COLUMNS);
          if (layoutA.y === layoutB.y) {
            return layoutA.x - layoutB.x;
          }
          return layoutA.y - layoutB.y;
        }),
    [activeCards],
  );
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const layoutMode: DashboardLayoutMode = isSmallScreen ? "mobile" : "desktop";
  const gridColumns =
    layoutMode === "mobile" ? HOME_LAYOUT_SOURCE_COLUMNS_MOBILE : HOME_LAYOUT_SOURCE_COLUMNS_DESKTOP;
  const gridRowHeight = HOME_GRID_ROW_HEIGHT_PX;
  const gridGapPx = 0;
  const homeGridSize = Math.max(12, Math.floor(gridRowHeight / 8));
  const homeGridCss = useMemo(() => buildHomeGridCss(gridColumns), [gridColumns]);
  const dashboardGridRef = useRef<HTMLDivElement | null>(null);
  const dashboardGridInstanceRef = useRef<GridStack | null>(null);
  const gridLayoutCards = useMemo(() => {
    return orderedActiveCards.map((card) => {
      const layout = resolveDashboardLayout(card.layout, layoutMode, gridColumns);
      let columnSpan = Math.max(1, Math.min(gridColumns, layout.w));
      let rowSpan = Math.max(1, layout.h);
      let gridX = Math.max(0, layout.x);
      let gridY = Math.max(0, layout.y);

      const maxX = Math.max(0, gridColumns - columnSpan);
      if (gridX > maxX) {
        gridX = maxX;
      }

      return {
        card,
        layout,
        gridX,
        gridY,
        columnSpan,
        rowSpan,
        approxHeightPx: rowSpan * gridRowHeight,
      };
    });
  }, [gridColumns, gridRowHeight, layoutMode, orderedActiveCards]);
  const shouldHydrateLiveData = canUseDashboards && effectiveViewMode === "dashboard";

  useEffect(() => {
    const container = dashboardGridRef.current;
    if (!container) {
      return;
    }
    if (gridLayoutCards.length === 0) {
      if (dashboardGridInstanceRef.current) {
        dashboardGridInstanceRef.current.destroy(false);
        dashboardGridInstanceRef.current = null;
      }
      return;
    }
    if (dashboardGridInstanceRef.current) {
      dashboardGridInstanceRef.current.destroy(false);
      dashboardGridInstanceRef.current = null;
    }
    const grid = GridStack.init(
      {
        column: gridColumns,
        cellHeight: gridRowHeight,
        margin: gridGapPx,
        float: true,
        disableOneColumnMode: true,
        staticGrid: true,
      },
      container,
    );
    dashboardGridInstanceRef.current = grid;
    return () => {
      grid.destroy(false);
      dashboardGridInstanceRef.current = null;
    };
  }, [gridColumns, gridGapPx, gridLayoutCards.length, gridRowHeight]);

  useEffect(() => {
    const container = dashboardGridRef.current;
    const grid = dashboardGridInstanceRef.current;
    if (!container || !grid) {
      return;
    }
    const layoutById = new Map(
      gridLayoutCards.map((entry) => [
        entry.card.id,
        { x: entry.gridX, y: entry.gridY, w: entry.columnSpan, h: entry.rowSpan },
      ]),
    );
    grid.batchUpdate();
    grid.removeAll(false);
    container.querySelectorAll<HTMLElement>(".grid-stack-item").forEach((element) => {
      const cardId = element.getAttribute("gs-id") ?? element.getAttribute("data-gs-id");
      const layout = cardId ? layoutById.get(cardId) : null;
      if (cardId && layout) {
        grid.makeWidget(element, { ...layout, id: cardId });
        return;
      }
      grid.makeWidget(element);
    });
    grid.batchUpdate(false);
  }, [gridLayoutCards]);
  const cardsSupportPeriod = useMemo(
    () => orderedActiveCards.some((card) => cardSupportsPeriodOverride((card.viewConfig as DashboardCardViewConfig) ?? null)),
    [orderedActiveCards],
  );
  const [globalPeriodSelection, setGlobalPeriodSelection] = useState<PreviewPeriodValue>("this_month");
  const [globalCustomInputs, setGlobalCustomInputs] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [globalCustomAppliedRange, setGlobalCustomAppliedRange] = useState<{ from: string; to: string } | null>(null);
  const [globalSegmentValue, setGlobalSegmentValue] = useState<string | null>(null);
  const [linkedCardStates, setLinkedCardStates] = useState<Record<string, boolean>>({});
  const globalPeriodOverride = useMemo<DashboardPreviewPeriodPreset | DashboardPreviewPeriodOverride | null>(() => {
    if (!cardsSupportPeriod) {
      return null;
    }
    if (globalPeriodSelection === "custom") {
      return buildCustomPeriodOverride(globalCustomAppliedRange);
    }
    return globalPeriodSelection;
  }, [globalCustomAppliedRange, globalPeriodSelection, cardsSupportPeriod]);
  useEffect(() => {
    setLinkedCardStates((current) => {
      const next: Record<string, boolean> = { ...current };
      const activeIds = new Set(orderedActiveCards.map((card) => card.id));
      orderedActiveCards.forEach((card) => {
        if (next[card.id] === undefined) {
          next[card.id] = true;
        }
      });
      Object.keys(next).forEach((cardId) => {
        if (!activeIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
  }, [orderedActiveCards]);
  const handleToggleCardLink = useCallback((cardId: string) => {
    setLinkedCardStates((current) => ({
      ...current,
      [cardId]: !(current[cardId] ?? true),
    }));
  }, []);
  const cardViewConfigById = useMemo(() => {
    const map = new Map<string, DashboardCardViewConfig | null>();
    orderedActiveCards.forEach((card) => {
      map.set(card.id, (card.viewConfig as DashboardCardViewConfig) ?? null);
    });
    return map;
  }, [orderedActiveCards]);
  const visualDateFilterOptionsById = useMemo(() => {
    const map = new Map<string, DashboardDateFilterOption[]>();
    orderedActiveCards.forEach((card) => {
      const viewConfig = (card.viewConfig as DashboardCardViewConfig) ?? null;
      if (!isVisualCardViewConfig(viewConfig)) {
        return;
      }
      const options = resolveDateFilterOptions(viewConfig);
      if (options.length > 0) {
        map.set(card.id, options);
      }
    });
    return map;
  }, [orderedActiveCards]);
  const spotlightDateFilterOptionsById = useMemo(() => {
    const map = new Map<string, DashboardDateFilterOption[]>();
    orderedActiveCards.forEach((card) => {
      const viewConfig = (card.viewConfig as DashboardCardViewConfig) ?? null;
      if (!isSpotlightCardViewConfig(viewConfig)) {
        return;
      }
      const options = resolveDateFilterOptions(viewConfig);
      if (options.length > 0) {
        map.set(card.id, options);
      }
    });
    return map;
  }, [orderedActiveCards]);
  const [visualDateFilterSelectionSets, setVisualDateFilterSelectionSets] = useState<Record<string, string[]>>({});
  const [spotlightDateFilterSelectionSets, setSpotlightDateFilterSelectionSets] = useState<Record<string, string[]>>({});
  useEffect(() => {
    setVisualDateFilterSelectionSets((current) => {
      const next: Record<string, string[]> = { ...current };
      const validIds = new Set<string>();
      visualDateFilterOptionsById.forEach((options, cardId) => {
        const viewConfig = cardViewConfigById.get(cardId);
        if (!viewConfig || !isVisualCardViewConfig(viewConfig)) {
          return;
        }
        validIds.add(cardId);
        const optionIds = new Set(options.map((option) => option.id));
        const existing = current[cardId] ?? [];
        const normalized = existing.filter((id) => optionIds.has(id));
        const fallback = resolveSelectedDateFilterIds(viewConfig, options);
        const nextIds = normalized.length > 0 ? normalized : fallback;
        if (nextIds.length > 0) {
          next[cardId] = nextIds;
        }
      });
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
  }, [visualDateFilterOptionsById, cardViewConfigById]);
  useEffect(() => {
    setSpotlightDateFilterSelectionSets((current) => {
      const next: Record<string, string[]> = { ...current };
      const validIds = new Set<string>();
      spotlightDateFilterOptionsById.forEach((options, cardId) => {
        const viewConfig = cardViewConfigById.get(cardId);
        if (!viewConfig || !isSpotlightCardViewConfig(viewConfig)) {
          return;
        }
        validIds.add(cardId);
        const optionIds = new Set(options.map((option) => option.id));
        const existing = current[cardId] ?? [];
        const normalized = existing.filter((id) => optionIds.has(id));
        const fallback = resolveSelectedDateFilterIds(viewConfig, options);
        const nextIds = normalized.length > 0 ? normalized : fallback;
        if (nextIds.length > 0) {
          next[cardId] = nextIds;
        }
      });
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
  }, [spotlightDateFilterOptionsById, cardViewConfigById]);
  const periodGroupKeyById = useMemo(() => {
    const map = new Map<string, string>();
    orderedActiveCards.forEach((card) => {
      const viewConfig = (card.viewConfig as DashboardCardViewConfig) ?? null;
      if (!viewConfig || typeof viewConfig !== "object") {
        return;
      }
      if (isSpotlightCardViewConfig(viewConfig)) {
        const periodConfig = normalizeSpotlightPeriodConfig(viewConfig);
        if (!periodConfig) {
          return;
        }
        const presetsKey = periodConfig.presets.join("|");
        const allowCustom = periodConfig.allowCustom ? "1" : "0";
        const templateId = card.templateId ?? "template";
        map.set(
          card.id,
          `${templateId}:${presetsKey}:${allowCustom}`,
        );
        return;
      }
      if (isVisualCardViewConfig(viewConfig)) {
        const periodConfig = normalizeVisualPeriodConfig(viewConfig);
        if (!periodConfig) {
          return;
        }
        const presetsKey = periodConfig.presets.join("|");
        const allowCustom = periodConfig.allowCustom ? "1" : "0";
        const templateId = card.templateId ?? "template";
        map.set(
          card.id,
          `${templateId}:${presetsKey}:${allowCustom}`,
        );
      }
    });
    return map;
  }, [orderedActiveCards]);
  const getLinkedCardTargets = useCallback(
    (sourceCardId: string): { visualIds: string[]; spotlightIds: string[] } => {
      const isLinked = linkedCardStates[sourceCardId] ?? true;
      const groupKey = periodGroupKeyById.get(sourceCardId);
      const candidates =
        isLinked && groupKey
          ? orderedActiveCards.filter(
              (card) =>
                periodGroupKeyById.get(card.id) === groupKey && (linkedCardStates[card.id] ?? true),
            )
          : orderedActiveCards.filter((card) => card.id === sourceCardId);
      const visualIds: string[] = [];
      const spotlightIds: string[] = [];
      candidates.forEach((card) => {
        const viewConfig = cardViewConfigById.get(card.id) ?? null;
        if (isVisualCardViewConfig(viewConfig)) {
          visualIds.push(card.id);
          return;
        }
        if (isSpotlightCardViewConfig(viewConfig)) {
          spotlightIds.push(card.id);
        }
      });
      return { visualIds, spotlightIds };
    },
    [cardViewConfigById, linkedCardStates, orderedActiveCards, periodGroupKeyById],
  );
  const getLinkedDateFilterTargets = useCallback(
    (sourceCardId: string): { visualIds: string[]; spotlightIds: string[] } => {
      const isLinked = linkedCardStates[sourceCardId] ?? true;
      const sourceCard = orderedActiveCards.find((card) => card.id === sourceCardId) ?? null;
      const sourceTemplateId = sourceCard?.templateId ?? null;
      const candidates =
        isLinked && sourceTemplateId
          ? orderedActiveCards.filter(
              (card) => card.templateId === sourceTemplateId && (linkedCardStates[card.id] ?? true),
            )
          : orderedActiveCards.filter((card) => card.id === sourceCardId);
      const visualIds: string[] = [];
      const spotlightIds: string[] = [];
      candidates.forEach((card) => {
        const viewConfig = cardViewConfigById.get(card.id) ?? null;
        if (isVisualCardViewConfig(viewConfig) && (visualDateFilterOptionsById.get(card.id) ?? []).length > 0) {
          visualIds.push(card.id);
          return;
        }
        if (isSpotlightCardViewConfig(viewConfig) && (spotlightDateFilterOptionsById.get(card.id) ?? []).length > 0) {
          spotlightIds.push(card.id);
        }
      });
      return { visualIds, spotlightIds };
    },
    [
      cardViewConfigById,
      linkedCardStates,
      orderedActiveCards,
      spotlightDateFilterOptionsById,
      visualDateFilterOptionsById,
    ],
  );
  const handleToggleVisualDateFilter = useCallback(
    (cardId: string, dateFilterId: string) => {
      const { visualIds, spotlightIds } = getLinkedDateFilterTargets(cardId);
      const sourceSignature = resolveDateFilterSignature(
        visualDateFilterOptionsById.get(cardId),
        dateFilterId,
      );
      setVisualDateFilterSelectionSets((current) => {
        const next = { ...current };
        visualIds.forEach((id) => {
          const options = visualDateFilterOptionsById.get(id);
          const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFilterId);
          if (toggleId) {
            const nextIds = resolveNextSelectedDateFilterIds(options, current[id], toggleId);
            if (nextIds.length > 0) {
              next[id] = nextIds;
            }
          }
        });
        return next;
      });
      if (spotlightIds.length > 0) {
        setSpotlightDateFilterSelectionSets((current) => {
          const next = { ...current };
          spotlightIds.forEach((id) => {
            const options = spotlightDateFilterOptionsById.get(id);
            const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFilterId);
            if (toggleId) {
              const nextIds = resolveNextSelectedDateFilterIds(options, current[id], toggleId);
              if (nextIds.length > 0) {
                next[id] = nextIds;
              }
            }
          });
          return next;
        });
      }
    },
    [getLinkedDateFilterTargets, spotlightDateFilterOptionsById, visualDateFilterOptionsById],
  );
  const handleToggleSpotlightDateFilter = useCallback(
    (cardId: string, dateFilterId: string) => {
      const { visualIds, spotlightIds } = getLinkedDateFilterTargets(cardId);
      const sourceSignature = resolveDateFilterSignature(
        spotlightDateFilterOptionsById.get(cardId),
        dateFilterId,
      );
      setSpotlightDateFilterSelectionSets((current) => {
        const next = { ...current };
        spotlightIds.forEach((id) => {
          const options = spotlightDateFilterOptionsById.get(id);
          const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFilterId);
          if (toggleId) {
            const nextIds = resolveNextSelectedDateFilterIds(options, current[id], toggleId);
            if (nextIds.length > 0) {
              next[id] = nextIds;
            }
          }
        });
        return next;
      });
      if (visualIds.length > 0) {
        setVisualDateFilterSelectionSets((current) => {
          const next = { ...current };
          visualIds.forEach((id) => {
            const options = visualDateFilterOptionsById.get(id);
            const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFilterId);
            if (toggleId) {
              const nextIds = resolveNextSelectedDateFilterIds(options, current[id], toggleId);
              if (nextIds.length > 0) {
                next[id] = nextIds;
              }
            }
          });
          return next;
        });
      }
    },
    [getLinkedDateFilterTargets, spotlightDateFilterOptionsById, visualDateFilterOptionsById],
  );
  const visualPeriodConfigById = useMemo(() => {
    const map = new Map<
      string,
      { presets: DashboardPreviewPeriodPreset[]; defaultPreset: DashboardPreviewPeriodPreset; allowCustom?: boolean }
    >();
    orderedActiveCards.forEach((card) => {
      const viewConfig = (card.viewConfig as DashboardCardViewConfig) ?? null;
      if (!isVisualCardViewConfig(viewConfig)) {
        return;
      }
      const normalized = normalizeVisualPeriodConfig(viewConfig);
      if (normalized) {
        map.set(card.id, normalized);
      }
    });
    return map;
  }, [orderedActiveCards]);
  const spotlightPeriodConfigById = useMemo(() => {
    const map = new Map<
      string,
      { presets: DashboardPreviewPeriodPreset[]; defaultPreset: DashboardPreviewPeriodPreset; allowCustom?: boolean }
    >();
    orderedActiveCards.forEach((card) => {
      const viewConfig = (card.viewConfig as DashboardCardViewConfig) ?? null;
      if (!isSpotlightCardViewConfig(viewConfig)) {
        return;
      }
      const normalized = normalizeSpotlightPeriodConfig(viewConfig);
      if (normalized) {
        map.set(card.id, normalized);
      }
    });
    return map;
  }, [orderedActiveCards]);
  const [visualPeriodSelections, setVisualPeriodSelections] = useState<Record<string, VisualPeriodSelection>>({});
  const [visualPeriodSelectionsByField, setVisualPeriodSelectionsByField] = useState<
    Record<string, Record<string, VisualPeriodSelection>>
  >({});
  const [visualCustomInputs, setVisualCustomInputs] = useState<Record<string, { from: string; to: string }>>({});
  const [visualCustomInputsByField, setVisualCustomInputsByField] = useState<
    Record<string, Record<string, { from: string; to: string }>>
  >({});
  const [visualCustomAppliedRanges, setVisualCustomAppliedRanges] = useState<
    Record<string, { from: string; to: string }>
  >({});
  const [visualCustomAppliedRangesByField, setVisualCustomAppliedRangesByField] = useState<
    Record<string, Record<string, { from: string; to: string }>>
  >({});
  useEffect(() => {
    setVisualPeriodSelections((current) => {
      const next: Record<string, VisualPeriodSelection> = { ...current };
      const validIds = new Set<string>();
      visualPeriodConfigById.forEach((config, cardId) => {
        validIds.add(cardId);
        const existing = current[cardId];
        if (
          !existing ||
          (existing === "custom" && !config.allowCustom) ||
          (existing !== "custom" && !config.presets.includes(existing))
        ) {
          next[cardId] = config.defaultPreset;
        }
      });
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
  }, [visualPeriodConfigById]);
  useEffect(() => {
    setVisualCustomInputs((current) => {
      const next: Record<string, { from: string; to: string }> = { ...current };
      const validIds = new Set<string>(visualPeriodConfigById.keys());
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
    setVisualCustomAppliedRanges((current) => {
      const next: Record<string, { from: string; to: string }> = { ...current };
      const validIds = new Set<string>(visualPeriodConfigById.keys());
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
    setVisualPeriodSelectionsByField((current) => {
      const next: Record<string, Record<string, VisualPeriodSelection>> = { ...current };
      const validIds = new Set<string>(visualPeriodConfigById.keys());
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
    setVisualCustomInputsByField((current) => {
      const next: Record<string, Record<string, { from: string; to: string }>> = { ...current };
      const validIds = new Set<string>(visualPeriodConfigById.keys());
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
    setVisualCustomAppliedRangesByField((current) => {
      const next: Record<string, Record<string, { from: string; to: string }>> = { ...current };
      const validIds = new Set<string>(visualPeriodConfigById.keys());
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
  }, [visualPeriodConfigById]);
  const [spotlightPeriodSelections, setSpotlightPeriodSelections] = useState<
    Record<string, SpotlightPeriodSelection>
  >({});
  const [spotlightPeriodSelectionsByField, setSpotlightPeriodSelectionsByField] = useState<
    Record<string, Record<string, SpotlightPeriodSelection>>
  >({});
  const [spotlightCustomInputs, setSpotlightCustomInputs] = useState<
    Record<string, { from: string; to: string }>
  >({});
  const [spotlightCustomInputsByField, setSpotlightCustomInputsByField] = useState<
    Record<string, Record<string, { from: string; to: string }>>
  >({});
  const [spotlightCustomAppliedRanges, setSpotlightCustomAppliedRanges] = useState<
    Record<string, { from: string; to: string }>
  >({});
  const [spotlightCustomAppliedRangesByField, setSpotlightCustomAppliedRangesByField] = useState<
    Record<string, Record<string, { from: string; to: string }>>
  >({});
  useEffect(() => {
    setSpotlightPeriodSelections((current) => {
      const next: Record<string, SpotlightPeriodSelection> = { ...current };
      const validIds = new Set<string>();
      spotlightPeriodConfigById.forEach((config, cardId) => {
        validIds.add(cardId);
        const existing = current[cardId];
        if (
          !existing ||
          (existing === "custom" && !config.allowCustom) ||
          (existing !== "custom" && !config.presets.includes(existing))
        ) {
          next[cardId] = config.defaultPreset;
        }
      });
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
  }, [spotlightPeriodConfigById]);
  useEffect(() => {
    setSpotlightCustomInputs((current) => {
      const next: Record<string, { from: string; to: string }> = { ...current };
      const validIds = new Set<string>(spotlightPeriodConfigById.keys());
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
    setSpotlightCustomAppliedRanges((current) => {
      const next: Record<string, { from: string; to: string }> = { ...current };
      const validIds = new Set<string>(spotlightPeriodConfigById.keys());
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
    setSpotlightPeriodSelectionsByField((current) => {
      const next: Record<string, Record<string, SpotlightPeriodSelection>> = { ...current };
      const validIds = new Set<string>(spotlightPeriodConfigById.keys());
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
    setSpotlightCustomInputsByField((current) => {
      const next: Record<string, Record<string, { from: string; to: string }>> = { ...current };
      const validIds = new Set<string>(spotlightPeriodConfigById.keys());
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
    setSpotlightCustomAppliedRangesByField((current) => {
      const next: Record<string, Record<string, { from: string; to: string }>> = { ...current };
      const validIds = new Set<string>(spotlightPeriodConfigById.keys());
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
  }, [spotlightPeriodConfigById]);
  const handleVisualPeriodChange = useCallback(
    (cardId: string, preset: VisualPeriodSelection, dateFieldId?: string) => {
      if (!dateFieldId) {
        const { visualIds, spotlightIds } = getLinkedCardTargets(cardId);
        setVisualPeriodSelections((current) => {
          const next = { ...current };
          visualIds.forEach((id) => {
            next[id] = preset;
          });
          return next;
        });
        if (spotlightIds.length > 0) {
          setSpotlightPeriodSelections((current) => {
            const next = { ...current };
            spotlightIds.forEach((id) => {
              next[id] = preset;
            });
            return next;
          });
        }
        return;
      }
      const { visualIds, spotlightIds } = getLinkedDateFilterTargets(cardId);
      const sourceSignature = resolveDateFilterSignature(
        visualDateFilterOptionsById.get(cardId),
        dateFieldId,
      );
      setVisualPeriodSelectionsByField((current) => {
        const next = { ...current };
        visualIds.forEach((id) => {
          const options = visualDateFilterOptionsById.get(id);
          const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
          if (!toggleId) {
            return;
          }
          const cardSelections = { ...(next[id] ?? {}) };
          cardSelections[toggleId] = preset;
          next[id] = cardSelections;
        });
        return next;
      });
      if (spotlightIds.length > 0) {
        setSpotlightPeriodSelectionsByField((current) => {
          const next = { ...current };
          spotlightIds.forEach((id) => {
            const options = spotlightDateFilterOptionsById.get(id);
            const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
            if (!toggleId) {
              return;
            }
            const cardSelections = { ...(next[id] ?? {}) };
            cardSelections[toggleId] = preset as SpotlightPeriodSelection;
            next[id] = cardSelections;
          });
          return next;
        });
      }
    },
    [
      getLinkedCardTargets,
      getLinkedDateFilterTargets,
      spotlightDateFilterOptionsById,
      visualDateFilterOptionsById,
    ],
  );
  const handleVisualCustomInputChange = useCallback(
    (cardId: string, key: "from" | "to", value: string, dateFieldId?: string) => {
      if (!dateFieldId) {
        setVisualCustomInputs((current) => ({
          ...current,
          [cardId]: {
            from: key === "from" ? value : current[cardId]?.from ?? "",
            to: key === "to" ? value : current[cardId]?.to ?? "",
          },
        }));
        return;
      }
      const { visualIds, spotlightIds } = getLinkedDateFilterTargets(cardId);
      const sourceSignature = resolveDateFilterSignature(
        visualDateFilterOptionsById.get(cardId),
        dateFieldId,
      );
      setVisualCustomInputsByField((current) => {
        const next = { ...current };
        visualIds.forEach((id) => {
          const options = visualDateFilterOptionsById.get(id);
          const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
          if (!toggleId) {
            return;
          }
          const currentInputs = (next[id] ?? {})[toggleId];
          const cardInputs = { ...(next[id] ?? {}) };
          cardInputs[toggleId] = {
            from: key === "from" ? value : currentInputs?.from ?? "",
            to: key === "to" ? value : currentInputs?.to ?? "",
          };
          next[id] = cardInputs;
        });
        return next;
      });
      if (spotlightIds.length > 0) {
        setSpotlightCustomInputsByField((current) => {
          const next = { ...current };
          spotlightIds.forEach((id) => {
            const options = spotlightDateFilterOptionsById.get(id);
            const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
            if (!toggleId) {
              return;
            }
            const currentInputs = (next[id] ?? {})[toggleId];
            const cardInputs = { ...(next[id] ?? {}) };
            cardInputs[toggleId] = {
              from: key === "from" ? value : currentInputs?.from ?? "",
              to: key === "to" ? value : currentInputs?.to ?? "",
            };
            next[id] = cardInputs;
          });
          return next;
        });
      }
    },
    [getLinkedDateFilterTargets, spotlightDateFilterOptionsById, visualDateFilterOptionsById],
  );
  const handleVisualApplyCustomRange = useCallback(
    (cardId: string, dateFieldId?: string) => {
      if (!dateFieldId) {
        const inputs = visualCustomInputs[cardId];
        if (!inputs) {
          return;
        }
        const normalized = normalizeCustomDateRange(inputs.from, inputs.to);
        if (!normalized) {
          return;
        }
        const { visualIds, spotlightIds } = getLinkedCardTargets(cardId);
        setVisualCustomInputs((current) => {
          const next = { ...current };
          visualIds.forEach((id) => {
            next[id] = inputs;
          });
          return next;
        });
        setSpotlightCustomInputs((current) => {
          const next = { ...current };
          spotlightIds.forEach((id) => {
            next[id] = inputs;
          });
          return next;
        });
        setVisualCustomAppliedRanges((current) => {
          const next = { ...current };
          visualIds.forEach((id) => {
            next[id] = normalized;
          });
          return next;
        });
        if (spotlightIds.length > 0) {
          setSpotlightCustomAppliedRanges((current) => {
            const next = { ...current };
            spotlightIds.forEach((id) => {
              next[id] = normalized;
            });
            return next;
          });
        }
        setVisualPeriodSelections((current) => {
          const next = { ...current };
          visualIds.forEach((id) => {
            next[id] = "custom";
          });
          return next;
        });
        if (spotlightIds.length > 0) {
          setSpotlightPeriodSelections((current) => {
            const next = { ...current };
            spotlightIds.forEach((id) => {
              next[id] = "custom";
            });
            return next;
          });
        }
        return;
      }
      const inputs = visualCustomInputsByField[cardId]?.[dateFieldId];
      if (!inputs) {
        return;
      }
      const normalized = normalizeCustomDateRange(inputs.from, inputs.to);
      if (!normalized) {
        return;
      }
      const { visualIds, spotlightIds } = getLinkedDateFilterTargets(cardId);
      const sourceSignature = resolveDateFilterSignature(
        visualDateFilterOptionsById.get(cardId),
        dateFieldId,
      );
      setVisualCustomInputsByField((current) => {
        const next = { ...current };
        visualIds.forEach((id) => {
          const options = visualDateFilterOptionsById.get(id);
          const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
          if (!toggleId) {
            return;
          }
          const cardInputs = { ...(next[id] ?? {}) };
          cardInputs[toggleId] = inputs;
          next[id] = cardInputs;
        });
        return next;
      });
      if (spotlightIds.length > 0) {
        setSpotlightCustomInputsByField((current) => {
          const next = { ...current };
          spotlightIds.forEach((id) => {
            const options = spotlightDateFilterOptionsById.get(id);
            const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
            if (!toggleId) {
              return;
            }
            const cardInputs = { ...(next[id] ?? {}) };
            cardInputs[toggleId] = inputs;
            next[id] = cardInputs;
          });
          return next;
        });
      }
      setVisualCustomAppliedRangesByField((current) => {
        const next = { ...current };
        visualIds.forEach((id) => {
          const options = visualDateFilterOptionsById.get(id);
          const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
          if (!toggleId) {
            return;
          }
          const cardRanges = { ...(next[id] ?? {}) };
          cardRanges[toggleId] = normalized;
          next[id] = cardRanges;
        });
        return next;
      });
      if (spotlightIds.length > 0) {
        setSpotlightCustomAppliedRangesByField((current) => {
          const next = { ...current };
          spotlightIds.forEach((id) => {
            const options = spotlightDateFilterOptionsById.get(id);
            const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
            if (!toggleId) {
              return;
            }
            const cardRanges = { ...(next[id] ?? {}) };
            cardRanges[toggleId] = normalized;
            next[id] = cardRanges;
          });
          return next;
        });
      }
      setVisualPeriodSelectionsByField((current) => {
        const next = { ...current };
        visualIds.forEach((id) => {
          const options = visualDateFilterOptionsById.get(id);
          const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
          if (!toggleId) {
            return;
          }
          const cardSelections = { ...(next[id] ?? {}) };
          cardSelections[toggleId] = "custom";
          next[id] = cardSelections;
        });
        return next;
      });
      if (spotlightIds.length > 0) {
        setSpotlightPeriodSelectionsByField((current) => {
          const next = { ...current };
          spotlightIds.forEach((id) => {
            const options = spotlightDateFilterOptionsById.get(id);
            const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
            if (!toggleId) {
              return;
            }
            const cardSelections = { ...(next[id] ?? {}) };
            cardSelections[toggleId] = "custom";
            next[id] = cardSelections;
          });
          return next;
        });
      }
    },
    [
      getLinkedCardTargets,
      getLinkedDateFilterTargets,
      spotlightDateFilterOptionsById,
      visualCustomInputs,
      visualCustomInputsByField,
      visualDateFilterOptionsById,
    ],
  );
  const getVisualPeriodSelection = useCallback(
    (cardId: string, dateFieldId?: string): VisualPeriodSelection | null => {
      const config = visualPeriodConfigById.get(cardId);
      if (!config) {
        return null;
      }
      const selected = dateFieldId
        ? visualPeriodSelectionsByField[cardId]?.[dateFieldId] ?? visualPeriodSelections[cardId]
        : visualPeriodSelections[cardId];
      if (selected === "custom" && config.allowCustom) {
        return "custom";
      }
      if (selected && selected !== "custom" && config.presets.includes(selected)) {
        return selected;
      }
      return config.defaultPreset;
    },
    [visualPeriodConfigById, visualPeriodSelections, visualPeriodSelectionsByField],
  );
  const getVisualPeriodOverride = useCallback(
    (cardId: string, dateFieldId?: string): DashboardPreviewPeriodPreset | DashboardPreviewPeriodOverride | null => {
      const config = visualPeriodConfigById.get(cardId);
      if (!config) {
        return null;
      }
      const selected = dateFieldId
        ? visualPeriodSelectionsByField[cardId]?.[dateFieldId] ?? visualPeriodSelections[cardId]
        : visualPeriodSelections[cardId];
      if (selected === "custom" && config.allowCustom) {
        const applied = dateFieldId
          ? visualCustomAppliedRangesByField[cardId]?.[dateFieldId] ?? visualCustomAppliedRanges[cardId]
          : visualCustomAppliedRanges[cardId];
        return applied ? { mode: "custom", from: applied.from, to: applied.to } : config.defaultPreset;
      }
      if (selected && selected !== "custom" && config.presets.includes(selected)) {
        return selected;
      }
      return config.defaultPreset;
    },
    [
      visualCustomAppliedRanges,
      visualCustomAppliedRangesByField,
      visualPeriodConfigById,
      visualPeriodSelections,
      visualPeriodSelectionsByField,
    ],
  );
  const handleSpotlightPeriodChange = useCallback(
    (cardId: string, preset: SpotlightPeriodSelection, dateFieldId?: string) => {
      if (!dateFieldId) {
        const { visualIds, spotlightIds } = getLinkedCardTargets(cardId);
        setSpotlightPeriodSelections((current) => {
          const next = { ...current };
          spotlightIds.forEach((id) => {
            next[id] = preset;
          });
          return next;
        });
        if (visualIds.length > 0) {
          setVisualPeriodSelections((current) => {
            const next = { ...current };
            visualIds.forEach((id) => {
              next[id] = preset as VisualPeriodSelection;
            });
            return next;
          });
        }
        return;
      }
      const { visualIds, spotlightIds } = getLinkedDateFilterTargets(cardId);
      const sourceSignature = resolveDateFilterSignature(
        spotlightDateFilterOptionsById.get(cardId),
        dateFieldId,
      );
      setSpotlightPeriodSelectionsByField((current) => {
        const next = { ...current };
        spotlightIds.forEach((id) => {
          const options = spotlightDateFilterOptionsById.get(id);
          const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
          if (!toggleId) {
            return;
          }
          const cardSelections = { ...(next[id] ?? {}) };
          cardSelections[toggleId] = preset;
          next[id] = cardSelections;
        });
        return next;
      });
      if (visualIds.length > 0) {
        setVisualPeriodSelectionsByField((current) => {
          const next = { ...current };
          visualIds.forEach((id) => {
            const options = visualDateFilterOptionsById.get(id);
            const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
            if (!toggleId) {
              return;
            }
            const cardSelections = { ...(next[id] ?? {}) };
            cardSelections[toggleId] = preset as VisualPeriodSelection;
            next[id] = cardSelections;
          });
          return next;
        });
      }
    },
    [
      getLinkedCardTargets,
      getLinkedDateFilterTargets,
      spotlightDateFilterOptionsById,
      visualDateFilterOptionsById,
    ],
  );
  const handleSpotlightCustomInputChange = useCallback(
    (cardId: string, key: "from" | "to", value: string, dateFieldId?: string) => {
      if (!dateFieldId) {
        setSpotlightCustomInputs((current) => ({
          ...current,
          [cardId]: {
            from: key === "from" ? value : current[cardId]?.from ?? "",
            to: key === "to" ? value : current[cardId]?.to ?? "",
          },
        }));
        return;
      }
      const { visualIds, spotlightIds } = getLinkedDateFilterTargets(cardId);
      const sourceSignature = resolveDateFilterSignature(
        spotlightDateFilterOptionsById.get(cardId),
        dateFieldId,
      );
      setSpotlightCustomInputsByField((current) => {
        const next = { ...current };
        spotlightIds.forEach((id) => {
          const options = spotlightDateFilterOptionsById.get(id);
          const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
          if (!toggleId) {
            return;
          }
          const currentInputs = (next[id] ?? {})[toggleId];
          const cardInputs = { ...(next[id] ?? {}) };
          cardInputs[toggleId] = {
            from: key === "from" ? value : currentInputs?.from ?? "",
            to: key === "to" ? value : currentInputs?.to ?? "",
          };
          next[id] = cardInputs;
        });
        return next;
      });
      if (visualIds.length > 0) {
        setVisualCustomInputsByField((current) => {
          const next = { ...current };
          visualIds.forEach((id) => {
            const options = visualDateFilterOptionsById.get(id);
            const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
            if (!toggleId) {
              return;
            }
            const currentInputs = (next[id] ?? {})[toggleId];
            const cardInputs = { ...(next[id] ?? {}) };
            cardInputs[toggleId] = {
              from: key === "from" ? value : currentInputs?.from ?? "",
              to: key === "to" ? value : currentInputs?.to ?? "",
            };
            next[id] = cardInputs;
          });
          return next;
        });
      }
    },
    [getLinkedDateFilterTargets, spotlightDateFilterOptionsById, visualDateFilterOptionsById],
  );
  const handleSpotlightApplyCustomRange = useCallback(
    (cardId: string, dateFieldId?: string) => {
      if (!dateFieldId) {
        const inputs = spotlightCustomInputs[cardId];
        if (!inputs) {
          return;
        }
        const normalized = normalizeCustomDateRange(inputs.from, inputs.to);
        if (!normalized) {
          return;
        }
        const { visualIds, spotlightIds } = getLinkedCardTargets(cardId);
        setSpotlightCustomInputs((current) => {
          const next = { ...current };
          spotlightIds.forEach((id) => {
            next[id] = inputs;
          });
          return next;
        });
        setVisualCustomInputs((current) => {
          const next = { ...current };
          visualIds.forEach((id) => {
            next[id] = inputs;
          });
          return next;
        });
        setSpotlightCustomAppliedRanges((current) => {
          const next = { ...current };
          spotlightIds.forEach((id) => {
            next[id] = normalized;
          });
          return next;
        });
        if (visualIds.length > 0) {
          setVisualCustomAppliedRanges((current) => {
            const next = { ...current };
            visualIds.forEach((id) => {
              next[id] = normalized;
            });
            return next;
          });
        }
        setSpotlightPeriodSelections((current) => {
          const next = { ...current };
          spotlightIds.forEach((id) => {
            next[id] = "custom";
          });
          return next;
        });
        if (visualIds.length > 0) {
          setVisualPeriodSelections((current) => {
            const next = { ...current };
            visualIds.forEach((id) => {
              next[id] = "custom";
            });
            return next;
          });
        }
        return;
      }
      const inputs = spotlightCustomInputsByField[cardId]?.[dateFieldId];
      if (!inputs) {
        return;
      }
      const normalized = normalizeCustomDateRange(inputs.from, inputs.to);
      if (!normalized) {
        return;
      }
      const { visualIds, spotlightIds } = getLinkedDateFilterTargets(cardId);
      const sourceSignature = resolveDateFilterSignature(
        spotlightDateFilterOptionsById.get(cardId),
        dateFieldId,
      );
      setSpotlightCustomInputsByField((current) => {
        const next = { ...current };
        spotlightIds.forEach((id) => {
          const options = spotlightDateFilterOptionsById.get(id);
          const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
          if (!toggleId) {
            return;
          }
          const cardInputs = { ...(next[id] ?? {}) };
          cardInputs[toggleId] = inputs;
          next[id] = cardInputs;
        });
        return next;
      });
      if (visualIds.length > 0) {
        setVisualCustomInputsByField((current) => {
          const next = { ...current };
          visualIds.forEach((id) => {
            const options = visualDateFilterOptionsById.get(id);
            const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
            if (!toggleId) {
              return;
            }
            const cardInputs = { ...(next[id] ?? {}) };
            cardInputs[toggleId] = inputs;
            next[id] = cardInputs;
          });
          return next;
        });
      }
      setSpotlightCustomAppliedRangesByField((current) => {
        const next = { ...current };
        spotlightIds.forEach((id) => {
          const options = spotlightDateFilterOptionsById.get(id);
          const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
          if (!toggleId) {
            return;
          }
          const cardRanges = { ...(next[id] ?? {}) };
          cardRanges[toggleId] = normalized;
          next[id] = cardRanges;
        });
        return next;
      });
      if (visualIds.length > 0) {
        setVisualCustomAppliedRangesByField((current) => {
          const next = { ...current };
          visualIds.forEach((id) => {
            const options = visualDateFilterOptionsById.get(id);
            const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
            if (!toggleId) {
              return;
            }
            const cardRanges = { ...(next[id] ?? {}) };
            cardRanges[toggleId] = normalized;
            next[id] = cardRanges;
          });
          return next;
        });
      }
      setSpotlightPeriodSelectionsByField((current) => {
        const next = { ...current };
        spotlightIds.forEach((id) => {
          const options = spotlightDateFilterOptionsById.get(id);
          const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
          if (!toggleId) {
            return;
          }
          const cardSelections = { ...(next[id] ?? {}) };
          cardSelections[toggleId] = "custom";
          next[id] = cardSelections;
        });
        return next;
      });
      if (visualIds.length > 0) {
        setVisualPeriodSelectionsByField((current) => {
          const next = { ...current };
          visualIds.forEach((id) => {
            const options = visualDateFilterOptionsById.get(id);
            const toggleId = resolveToggleIdForOptions(options, sourceSignature, dateFieldId);
            if (!toggleId) {
              return;
            }
            const cardSelections = { ...(next[id] ?? {}) };
            cardSelections[toggleId] = "custom";
            next[id] = cardSelections;
          });
          return next;
        });
      }
    },
    [
      getLinkedCardTargets,
      getLinkedDateFilterTargets,
      spotlightCustomInputs,
      spotlightCustomInputsByField,
      spotlightDateFilterOptionsById,
      visualDateFilterOptionsById,
    ],
  );
  const getSpotlightPeriodSelection = useCallback(
    (cardId: string, dateFieldId?: string): SpotlightPeriodSelection | null => {
      const config = spotlightPeriodConfigById.get(cardId);
      if (!config) {
        return null;
      }
      const selected = dateFieldId
        ? spotlightPeriodSelectionsByField[cardId]?.[dateFieldId] ?? spotlightPeriodSelections[cardId]
        : spotlightPeriodSelections[cardId];
      if (selected === "custom" && config.allowCustom) {
        return "custom";
      }
      if (selected && selected !== "custom" && config.presets.includes(selected)) {
        return selected;
      }
      return config.defaultPreset;
    },
    [spotlightPeriodConfigById, spotlightPeriodSelections, spotlightPeriodSelectionsByField],
  );
  const getSpotlightPeriodOverride = useCallback(
    (cardId: string, dateFieldId?: string): DashboardPreviewPeriodPreset | DashboardPreviewPeriodOverride | null => {
      const config = spotlightPeriodConfigById.get(cardId);
      if (!config) {
        return null;
      }
      const selected = dateFieldId
        ? spotlightPeriodSelectionsByField[cardId]?.[dateFieldId] ?? spotlightPeriodSelections[cardId]
        : spotlightPeriodSelections[cardId];
      if (selected === "custom" && config.allowCustom) {
        const applied = dateFieldId
          ? spotlightCustomAppliedRangesByField[cardId]?.[dateFieldId] ?? spotlightCustomAppliedRanges[cardId]
          : spotlightCustomAppliedRanges[cardId];
        return applied ? { mode: "custom", from: applied.from, to: applied.to } : config.defaultPreset;
      }
      if (selected && selected !== "custom" && config.presets.includes(selected)) {
        return selected;
      }
      return config.defaultPreset;
    },
    [
      spotlightCustomAppliedRanges,
      spotlightCustomAppliedRangesByField,
      spotlightPeriodConfigById,
      spotlightPeriodSelections,
      spotlightPeriodSelectionsByField,
    ],
  );
  const handleGlobalPresetSelection = useCallback(
    (value: PreviewPeriodValue) => {
      setGlobalPeriodSelection(value);
      if (value !== "custom") {
        setGlobalCustomAppliedRange(null);
      }
    },
    [],
  );
  const handleGlobalCustomInputChange = useCallback((key: "from" | "to", value: string) => {
    setGlobalCustomInputs((current) => ({
      ...current,
      [key]: value ?? "",
    }));
  }, []);
  const handleGlobalApplyCustomRange = useCallback(() => {
    const from = globalCustomInputs.from.trim();
    const to = globalCustomInputs.to.trim();
    if (!from || !to) {
      return;
    }
    setGlobalPeriodSelection("custom");
    setGlobalCustomAppliedRange({
      from,
      to,
    });
  }, [globalCustomInputs.from, globalCustomInputs.to]);
  const globalAppliedRangeLabel = useMemo(() => {
    if (!globalPeriodOverride) {
      return null;
    }
    if (typeof globalPeriodOverride === "string") {
      const now = dayjs();
      if (globalPeriodOverride === "this_month") {
        return `Applied range: ${now.startOf("month").format("MMM D, YYYY")} - ${now
          .endOf("month")
          .format("MMM D, YYYY")}`;
      }
      const ref = now.subtract(1, "month");
      return `Applied range: ${ref.startOf("month").format("MMM D, YYYY")} - ${ref
        .endOf("month")
        .format("MMM D, YYYY")}`;
    }
    if (globalPeriodOverride.mode === "custom") {
      const from = formatDisplayDate(globalPeriodOverride.from);
      const to = formatDisplayDate(globalPeriodOverride.to);
      return from && to ? `Applied range: ${from} - ${to}` : null;
    }
    return null;
  }, [globalPeriodOverride]);
  const [refreshMode, setRefreshMode] = useState<"manual" | "auto">("manual");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const triggerRefresh = useCallback(() => {
    setRefreshNonce((current) => current + 1);
    setLastRefreshedAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    if (!shouldHydrateLiveData || !activeDashboardId) {
      return;
    }
    triggerRefresh();
  }, [activeDashboardId, shouldHydrateLiveData, triggerRefresh]);

  useEffect(() => {
    if (!shouldHydrateLiveData || refreshMode !== "auto") {
      return;
    }
    const handle = setInterval(triggerRefresh, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [refreshMode, shouldHydrateLiveData, triggerRefresh]);

  const hasHandledInitialPeriodRefresh = useRef(false);
  useEffect(() => {
    if (!shouldHydrateLiveData) {
      return;
    }
    if (!hasHandledInitialPeriodRefresh.current) {
      hasHandledInitialPeriodRefresh.current = true;
      return;
    }
    triggerRefresh();
  }, [globalPeriodOverride, shouldHydrateLiveData, triggerRefresh]);

  const globalPeriodStatusText = useMemo(() => {
    if (!cardsSupportPeriod) {
      return "Add a date filter to a dashboard card to enable period overrides.";
    }
    if (globalPeriodSelection === "custom" && !globalCustomAppliedRange) {
      return "Select start and end dates, then click Apply.";
    }
    return globalAppliedRangeLabel ?? "Select a period to apply to all preview tables.";
  }, [globalAppliedRangeLabel, globalCustomAppliedRange, globalPeriodSelection, cardsSupportPeriod]);

  const cardHydrationDescriptors = useMemo<CardHydrationDescriptor[]>(() => {
    if (!shouldHydrateLiveData || activeCards.length === 0) {
      return [];
    }
    return activeCards.map((card) => {
      const rawViewConfig = (card.viewConfig as DashboardCardViewConfig) ?? null;
      if (isPreviewTableCardViewConfig(rawViewConfig)) {
        const periodOverride =
          isPreviewTableCardViewConfig(rawViewConfig) && rawViewConfig.dateFilter ? globalPeriodOverride : null;
        const cacheKey = JSON.stringify({
          mode: "preview",
          templateId: card.templateId,
          config: rawViewConfig.previewRequest,
          period: periodOverride ?? "none",
          refreshNonce,
        });
        return {
          mode: "preview_table" as const,
          card,
          viewConfig: rawViewConfig,
          cacheKey,
          periodOverride,
        };
      }
      let queryConfig: QueryConfig | null = null;
      let comparisonQueryConfig: QueryConfig | null = null;
      if (isVisualCardViewConfig(rawViewConfig) && rawViewConfig.queryConfig) {
        queryConfig = cloneConfig(rawViewConfig.queryConfig);
        if (queryConfig) {
          const selectedDateFilters = resolveSelectedDateFiltersForCard(
            rawViewConfig,
            visualDateFilterSelectionSets[card.id],
          );
          if (selectedDateFilters.length > 0) {
            selectedDateFilters.forEach((filter) => {
              const visualPeriodOverride = getVisualPeriodOverride(card.id, filter.id) ?? globalPeriodOverride;
              if (visualPeriodOverride) {
                applyPeriodOverrideToQueryConfig(queryConfig, visualPeriodOverride, filter);
              }
            });
          } else {
            const visualPeriodOverride = getVisualPeriodOverride(card.id) ?? globalPeriodOverride;
            if (visualPeriodOverride) {
              applyPeriodOverrideToQueryConfig(queryConfig, visualPeriodOverride, null);
            }
          }
          queryConfig.options = {
            ...queryConfig.options,
            templateId: card.templateId || queryConfig.options?.templateId || null,
            allowAsync: true,
          };
        }
        return {
          mode: queryConfig ? ("visual" as const) : ("legacy" as const),
          card,
          viewConfig: rawViewConfig,
          queryConfig: queryConfig ?? null,
          cacheKey: queryConfig ? JSON.stringify({ queryConfig, refreshNonce }) : JSON.stringify({ refreshNonce }),
        };
      }
      if (isSpotlightCardViewConfig(rawViewConfig)) {
        let baseRange: { from: string; to: string } | null = null;
        let comparisonRange: { from: string; to: string } | null = null;
        if (rawViewConfig.queryConfig) {
          queryConfig = cloneConfig(rawViewConfig.queryConfig);
          if (queryConfig) {
            const selectedDateFilters = resolveSelectedDateFiltersForCard(
              rawViewConfig,
              spotlightDateFilterSelectionSets[card.id],
            );
            const primaryDateFilter = selectedDateFilters[0] ?? null;
            const spotlightPeriod = primaryDateFilter
              ? getSpotlightPeriodOverride(card.id, primaryDateFilter.id)
              : getSpotlightPeriodOverride(card.id);
            const spotlightRange = spotlightPeriod ? computePeriodRange(spotlightPeriod) : null;
            if (spotlightPeriod) {
              if (selectedDateFilters.length > 0) {
                selectedDateFilters.forEach((filter) => {
                  const perFilterOverride = getSpotlightPeriodOverride(card.id, filter.id) ?? spotlightPeriod;
                  applyPeriodOverrideToQueryConfig(queryConfig, perFilterOverride, filter);
                });
              } else {
                applyPeriodOverrideToQueryConfig(queryConfig, spotlightPeriod, null);
              }
            }
            baseRange = spotlightRange ?? normalizeQueryRange(queryConfig.time?.range ?? undefined);
            comparisonRange = computeComparisonRange(
              rawViewConfig.spotlight.comparison,
              baseRange,
              rawViewConfig.spotlight.comparisonRange ?? null,
            );
            if (comparisonRange) {
              const comparisonOverride: DashboardPreviewPeriodOverride = {
                mode: "custom",
                from: comparisonRange.from,
                to: comparisonRange.to,
              };
              comparisonQueryConfig = cloneConfig(rawViewConfig.queryConfig);
              if (comparisonQueryConfig) {
                if (selectedDateFilters.length > 0) {
                  selectedDateFilters.forEach((filter) =>
                    applyPeriodOverrideToQueryConfig(
                      comparisonQueryConfig,
                      comparisonOverride,
                      filter,
                    ),
                  );
                } else {
                  applyPeriodOverrideToQueryConfig(
                    comparisonQueryConfig,
                    comparisonOverride,
                    null,
                  );
                }
                comparisonQueryConfig.options = {
                  ...comparisonQueryConfig.options,
                  templateId: card.templateId || comparisonQueryConfig.options?.templateId || null,
                  allowAsync: true,
                };
              }
            }
            queryConfig.options = {
              ...queryConfig.options,
              templateId: card.templateId || queryConfig.options?.templateId || null,
              allowAsync: true,
            };
          }
        }
        return {
          mode: "spotlight" as const,
          card,
          viewConfig: rawViewConfig,
          queryConfig: queryConfig ?? null,
          comparisonQueryConfig,
          baseRange,
          comparisonRange,
          cacheKey: JSON.stringify({ queryConfig, comparisonQueryConfig, refreshNonce }),
        };
      }
      return {
        mode: "legacy" as const,
        card,
        viewConfig: rawViewConfig,
        queryConfig: null,
        cacheKey: JSON.stringify({ refreshNonce }),
      };
    });
  }, [
    activeCards,
    globalPeriodOverride,
    refreshNonce,
    shouldHydrateLiveData,
    getSpotlightPeriodOverride,
    getVisualPeriodOverride,
    spotlightDateFilterSelectionSets,
    visualDateFilterSelectionSets,
  ]);

  const buildBulkRequestId = useCallback(
    (cardId: string, kind: "primary" | "comparison") => `${cardId}:${kind}`,
    [],
  );
  const reportBulkRequest = useMemo(() => {
    const requests: ReportBulkQueryRequest[] = [];
    const descriptorByRequestId = new Map<
      string,
      { cardId: string; kind: "visual" | "spotlight"; isComparison: boolean; descriptor: CardHydrationDescriptor }
    >();
    cardHydrationDescriptors.forEach((descriptor) => {
      if (descriptor.mode === "visual" && descriptor.queryConfig) {
        const id = buildBulkRequestId(descriptor.card.id, "primary");
        requests.push({ id, config: descriptor.queryConfig });
        descriptorByRequestId.set(id, {
          cardId: descriptor.card.id,
          kind: "visual",
          isComparison: false,
          descriptor,
        });
      } else if (descriptor.mode === "spotlight" && descriptor.queryConfig) {
        const id = buildBulkRequestId(descriptor.card.id, "primary");
        requests.push({ id, config: descriptor.queryConfig });
        descriptorByRequestId.set(id, {
          cardId: descriptor.card.id,
          kind: "spotlight",
          isComparison: false,
          descriptor,
        });
        if (descriptor.comparisonQueryConfig) {
          const comparisonId = buildBulkRequestId(descriptor.card.id, "comparison");
          requests.push({ id: comparisonId, config: descriptor.comparisonQueryConfig });
          descriptorByRequestId.set(comparisonId, {
            cardId: descriptor.card.id,
            kind: "spotlight",
            isComparison: true,
            descriptor,
          });
        }
      }
    });
    const cacheKey = JSON.stringify({
      refreshNonce,
      requests: requests.map((entry) => ({ id: entry.id, config: entry.config })),
    });
    return { requests, descriptorByRequestId, cacheKey };
  }, [buildBulkRequestId, cardHydrationDescriptors, refreshNonce]);

  const previewTableDescriptors = useMemo(
    () => cardHydrationDescriptors.filter((descriptor) => descriptor.mode === "preview_table"),
    [cardHydrationDescriptors],
  );
  const previewTableQueries = useQueries({
    queries: previewTableDescriptors.map((descriptor) => ({
      queryKey: ["reports", "dashboard-card", descriptor.card.id, descriptor.cacheKey],
      enabled: shouldHydrateLiveData,
      queryFn: async () =>
        runDashboardPreviewCard(descriptor.card.dashboardId, descriptor.card.id, {
          period: descriptor.periodOverride ?? undefined,
        }),
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  });

  const previewQueryByCardId = useMemo(() => {
    const map = new Map<string, (typeof previewTableQueries)[number]>();
    previewTableDescriptors.forEach((descriptor, index) => {
      map.set(descriptor.card.id, previewTableQueries[index]);
    });
    return map;
  }, [previewTableDescriptors, previewTableQueries]);

  const bulkReportQuery = useQuery({
    queryKey: ["reports", "dashboard-card", "bulk", reportBulkRequest.cacheKey],
    enabled: shouldHydrateLiveData && reportBulkRequest.requests.length > 0,
    queryFn: async () => runBulkReportQueries(reportBulkRequest.requests),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const bulkResultsById = useMemo(() => {
    const map = new Map<string, ReportBulkQueryResultEntry>();
    const results = bulkReportQuery.data?.results ?? [];
    results.forEach((entry) => {
      map.set(entry.id, entry);
    });
    return map;
  }, [bulkReportQuery.data]);

  const liveCardSamples = useMemo(() => {
    if (!shouldHydrateLiveData) {
      return new Map<string, DashboardCardLiveState>();
    }
    const map = new Map<string, DashboardCardLiveState>();
    if (cardHydrationDescriptors.length === 0) {
      return map;
    }
    cardHydrationDescriptors.forEach((descriptor) => {
      if (descriptor.mode === "preview_table") {
        const queryResult = previewQueryByCardId.get(descriptor.card.id);
        if (!queryResult) {
          map.set(descriptor.card.id, { status: "idle" });
          return;
        }
        if (queryResult.isLoading || queryResult.isFetching) {
          map.set(descriptor.card.id, { status: "loading" });
          return;
        }
        if (queryResult.error) {
          map.set(descriptor.card.id, {
            status: "error",
            error: getErrorMessage(queryResult.error, "Failed to refresh preview data."),
          });
          return;
        }
        const data = queryResult.data as DashboardPreviewCardResponse | null;
        if (!data) {
          map.set(descriptor.card.id, { status: "idle" });
          return;
        }
        map.set(descriptor.card.id, {
          status: "success",
          previewSample: {
            columns: Array.isArray(data.columns) ? data.columns : [],
            columnOrder:
              Array.isArray(data.columnOrder) && data.columnOrder.length > 0
                ? data.columnOrder
                : Array.isArray(data.columns)
                ? data.columns
                : [],
            columnAliases: data.columnAliases ?? {},
            rows: Array.isArray(data.rows) ? data.rows : [],
            executedAt: data.executedAt ?? null,
          },
        });
        return;
      }
      if (descriptor.mode === "spotlight") {
        if (!descriptor.queryConfig) {
          const warning =
            effectiveViewMode === "dashboard"
              ? "Open this template in Reports and re-save the card to enable live data."
              : null;
          map.set(descriptor.card.id, { status: "idle", warning });
          return;
        }
        if (bulkReportQuery.isLoading || bulkReportQuery.isFetching) {
          map.set(descriptor.card.id, { status: "loading" });
          return;
        }
        if (bulkReportQuery.error) {
          map.set(descriptor.card.id, {
            status: "error",
            error: getErrorMessage(bulkReportQuery.error, "Failed to refresh spotlight data."),
          });
          return;
        }
        const primaryEntry = bulkResultsById.get(buildBulkRequestId(descriptor.card.id, "primary"));
        if (!primaryEntry) {
          map.set(descriptor.card.id, { status: "idle" });
          return;
        }
        if (primaryEntry.status === "error") {
          map.set(descriptor.card.id, {
            status: "error",
            error: primaryEntry.message ?? "Failed to refresh spotlight data.",
          });
          return;
        }
        const comparisonEntry = bulkResultsById.get(buildBulkRequestId(descriptor.card.id, "comparison"));
        const primary = primaryEntry.response;
        const comparison =
          comparisonEntry && comparisonEntry.status === "success"
            ? comparisonEntry.response
            : null;
        map.set(
          descriptor.card.id,
          computeLiveCardState(descriptor.card, descriptor.viewConfig, {
            data: primary,
            comparisonData: comparison,
            baseRange: descriptor.baseRange ?? null,
            comparisonRange: descriptor.comparisonRange ?? null,
            isLoading: false,
          }),
        );
        return;
      }
      if (!descriptor.queryConfig) {
        const warning =
          isVisualCardViewConfig(descriptor.viewConfig) && effectiveViewMode === "dashboard"
            ? "Open this template in Reports and re-save the card to enable live data."
            : null;
        map.set(descriptor.card.id, { status: "idle", warning });
        return;
      }
      if (bulkReportQuery.isLoading || bulkReportQuery.isFetching) {
        map.set(descriptor.card.id, { status: "loading" });
        return;
      }
      if (bulkReportQuery.error) {
        map.set(descriptor.card.id, {
          status: "error",
          error: getErrorMessage(bulkReportQuery.error, "Failed to refresh dashboard data."),
        });
        return;
      }
      const primaryEntry = bulkResultsById.get(buildBulkRequestId(descriptor.card.id, "primary"));
      if (!primaryEntry) {
        map.set(descriptor.card.id, { status: "idle" });
        return;
      }
      if (primaryEntry.status === "error") {
        map.set(descriptor.card.id, {
          status: "error",
          error: primaryEntry.message ?? "Failed to refresh dashboard data.",
        });
        return;
      }
      map.set(
        descriptor.card.id,
        computeLiveCardState(descriptor.card, descriptor.viewConfig, {
          data: primaryEntry.response,
          isLoading: false,
        }),
      );
    });
    return map;
  }, [
    buildBulkRequestId,
    bulkReportQuery.error,
    bulkReportQuery.isFetching,
    bulkReportQuery.isLoading,
    bulkResultsById,
    cardHydrationDescriptors,
    effectiveViewMode,
    previewQueryByCardId,
    shouldHydrateLiveData,
  ]);

  const globalSegmentOptions = useMemo(() => {
    const counts = new Map<string, number>();
    orderedActiveCards.forEach((card) => {
      const liveState = liveCardSamples.get(card.id);
      if (!liveState) {
        return;
      }
      if (liveState.previewSample && liveState.previewSample.rows.length > 0) {
        const { rows, columns } = liveState.previewSample;
        const dimensionColumn = guessDimensionColumn(rows, columns);
        if (!dimensionColumn) {
          return;
        }
        rows.slice(0, 50).forEach((row) => {
          const label = formatPreviewTableValue(row[dimensionColumn]);
          if (label && label !== "-") {
            counts.set(label, (counts.get(label) ?? 0) + 1);
          }
        });
        return;
      }
      if (liveState.visualSample && liveState.visualSample.length > 0) {
        liveState.visualSample.slice(0, 50).forEach((point) => {
          if (point.dimension) {
            counts.set(point.dimension, (counts.get(point.dimension) ?? 0) + 1);
          }
        });
      }
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value]) => value)
      .slice(0, 12);
  }, [liveCardSamples, orderedActiveCards]);

  useEffect(() => {
    if (globalSegmentValue && !globalSegmentOptions.includes(globalSegmentValue)) {
      setGlobalSegmentValue(null);
    }
  }, [globalSegmentOptions, globalSegmentValue]);

  const renderNavigationTiles = () => (
    <Card sx={{backgroundColor: 'transparent', boxShadow: 'none'}}>
      <CardContent>
        <Grid container spacing={{ xs: 3, sm: 4, md: 5 }} justifyContent="center">
          {allowedPages.length === 0 ? (
            <Grid size={{ xs: 12 }}>
              <Typography variant="subtitle1" color="textSecondary">
                You do not have access to any sections yet.
              </Typography>
            </Grid>
          ) : (
            <>
              {allowedPages.map((page) => (
                <Grid key={page.name} size={{ xs: 12, sm: 6, md: 3, lg: 3 }}>
                  <TileLink to={page.path} aria-label={`Go to ${page.name}`}>
                    <LogoTile elevation={3}>
                      {renderNavigationIcon(page.icon)}
                      <PageName variant="subtitle1">{page.name}</PageName>
                    </LogoTile>
                  </TileLink>
                </Grid>
              ))}
              <Grid size={{ xs: 12, sm: 6, md: 3, lg: 3 }}>
                <TileButtonWrapper>
                  <LogoTile
                    elevation={3}
                    onClick={handleOpenMiniGame}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleOpenMiniGame();
                      }
                    }}
                    sx={{ cursor: "pointer", border: "none" }}
                    aria-label="Play Krakow Runner"
                  >
                    <SportsEsportsIcon fontSize="large" />
                    <PageName variant="subtitle1">Krakow Runner</PageName>
                  </LogoTile>
                </TileButtonWrapper>
              </Grid>
            </>
          )}
        </Grid>
      </CardContent>
    </Card>
  );

  const renderDashboardControls = () => {
    const isCustom = globalPeriodSelection === "custom";
    const lastUpdatedLabel = lastRefreshedAt ? dayjs(lastRefreshedAt).format("DD/MM/YYYY, HH:mm:ss") : "Never refreshed";
    const hasSegments = globalSegmentOptions.length > 0;
    return (
      <Stack gap={isCustom ? 1.5 : 1} alignItems="center" justifyContent="center">
        <Stack direction={{ xs: "column", md: "row" }} gap={2} alignItems="center" justifyContent="center">
          <Button
            variant="contained"
            startIcon={<RefreshIcon fontSize="small" />}
            onClick={triggerRefresh}
            disabled={!shouldHydrateLiveData}
          >
            Refresh data
          </Button>
          <Stack direction="row" gap={1} alignItems="center">
            <Switch
              checked={refreshMode === "auto"}
              onChange={(event) => setRefreshMode(event.target.checked ? "auto" : "manual")}
            />
            <Typography variant="body2">{refreshMode === "auto" ? "Automatic refresh" : "Idle mode"}</Typography>
          </Stack>
          <Typography variant="body2" color="textSecondary">
            Last updated {lastUpdatedLabel}
          </Typography>
        </Stack>
        {hasSegments && (
          <Stack direction={{ xs: "column", md: "row" }} gap={1} alignItems="center" justifyContent="center">
            <TextField
              select
              size="small"
              label="Focus segment"
              value={globalSegmentValue ?? ""}
              onChange={(event) => setGlobalSegmentValue(event.target.value.length > 0 ? event.target.value : null)}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="">All segments</MenuItem>
              {globalSegmentOptions.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
            {globalSegmentValue && (
              <Chip size="small" color="info" label={`Focused on ${globalSegmentValue}`} variant="outlined" />
            )}
          </Stack>
        )}
        {cardsSupportPeriod && (
          <>
            <Stack direction="row" gap={1} flexWrap="wrap" justifyContent="center">
              {PERIOD_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="small"
                  variant={globalPeriodSelection === option.value ? "contained" : "outlined"}
                  onClick={() => handleGlobalPresetSelection(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </Stack>
            {isCustom && (
              <Stack direction={{ xs: "column", sm: "row" }} gap={1} alignItems="center" justifyContent="center">
                <TextField
                  type="date"
                  size="small"
                  label="Start"
                  value={globalCustomInputs.from}
                  onChange={(event) => handleGlobalCustomInputChange("from", event.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  type="date"
                  size="small"
                  label="End"
                  value={globalCustomInputs.to}
                  onChange={(event) => handleGlobalCustomInputChange("to", event.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleGlobalApplyCustomRange}
                  disabled={globalCustomInputs.from.trim().length === 0 || globalCustomInputs.to.trim().length === 0}
                >
                  Apply
                </Button>
              </Stack>
            )}
            <CardSubtitle variant="caption" sx={{ textAlign: "center" }}>
              {globalPeriodStatusText}
            </CardSubtitle>
          </>
        )}
      </Stack>
    );
  };

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
    if (gridLayoutCards.length === 0) {
      return (
        <Typography variant="body2" color="textSecondary">
          This dashboard does not have any cards yet.
        </Typography>
      );
    }
    return (
      <Box
        ref={dashboardGridRef}
        className="grid-stack home-dashboard-grid"
        sx={{
          width: "100%",
          height: { xs: "calc(100vh - 96px)", md: "calc(100vh - 120px)" },
          minHeight: { xs: "calc(100vh - 96px)", md: "calc(100vh - 120px)" },
          borderRadius: 4,
          // border: "1px dashed rgba(15, 23, 42, 0.18)",
          backgroundColor: "#f5f7fb",
          // backgroundImage:
          //   "linear-gradient(0deg, rgba(15, 23, 42, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 23, 42, 0.06) 1px, transparent 1px)",
          // backgroundSize: `${homeGridSize}px ${homeGridSize}px`,
          overflow: "hidden",
        }}
      >
        <style>{homeGridCss}</style>
        {gridLayoutCards.map(({ card, gridX, gridY, columnSpan, rowSpan, approxHeightPx }) => {
          const spotlightConfig = spotlightPeriodConfigById.get(card.id);
          const visualPeriodConfig = visualPeriodConfigById.get(card.id) ?? null;
          const visualPeriodSelection = getVisualPeriodSelection(card.id);
          const isLinked = linkedCardStates[card.id] ?? true;
          return (
            <Box
              key={card.id}
              className="grid-stack-item"
              data-gs-id={card.id}
              data-gs-x={gridX}
              data-gs-y={gridY}
              data-gs-w={columnSpan}
              data-gs-h={rowSpan}
              data-gs-width={columnSpan}
              data-gs-height={rowSpan}
            >
              <div className="grid-stack-item-content">
                <DashboardCard
                  card={card}
                  liveState={liveCardSamples.get(card.id)}
                  layoutMetrics={{ approxHeightPx, columnSpan, rowSpan }}
                  periodOverride={globalPeriodOverride ?? null}
                  getVisualPeriodOverride={getVisualPeriodOverride}
                  visualPeriodConfig={visualPeriodConfig}
                  visualPeriodSelection={visualPeriodSelection}
                  visualPeriodSelectionByField={visualPeriodSelectionsByField[card.id] ?? {}}
                  visualDateFilterSelectionIds={visualDateFilterSelectionSets[card.id] ?? null}
                  onVisualDateFilterToggle={handleToggleVisualDateFilter}
                  onVisualPeriodChange={handleVisualPeriodChange}
                  visualCustomInput={visualCustomInputs[card.id] ?? null}
                  visualCustomInputsByField={visualCustomInputsByField[card.id] ?? {}}
                  onVisualCustomInputChange={handleVisualCustomInputChange}
                  onVisualApplyCustomRange={handleVisualApplyCustomRange}
                  spotlightPeriodConfig={spotlightConfig ?? null}
                  spotlightPeriodSelection={
                    getSpotlightPeriodSelection(card.id) ?? spotlightConfig?.defaultPreset ?? null
                  }
                  spotlightPeriodSelectionByField={spotlightPeriodSelectionsByField[card.id] ?? {}}
                  spotlightDateFilterSelectionIds={spotlightDateFilterSelectionSets[card.id] ?? null}
                  onSpotlightDateFilterToggle={handleToggleSpotlightDateFilter}
                  onSpotlightPeriodChange={handleSpotlightPeriodChange}
                  spotlightCustomInput={spotlightCustomInputs[card.id] ?? null}
                  spotlightCustomInputsByField={spotlightCustomInputsByField[card.id] ?? {}}
                  onSpotlightCustomInputChange={handleSpotlightCustomInputChange}
                  onSpotlightApplyCustomRange={handleSpotlightApplyCustomRange}
                  isLinked={isLinked}
                  onToggleLink={handleToggleCardLink}
                  segmentFilter={globalSegmentValue}
                />
              </div>
            </Box>
          );
        })}
      </Box>
    );
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <ThemeProvider theme={theme}>
        <PageWrapper
          style={
            effectiveViewMode === "dashboard"
              ? { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 }
              : undefined
          }
        >
          <TilesContainer
            style={effectiveViewMode === "dashboard" ? { maxWidth: "100%" } : undefined}
          >
            <Stack gap={3}>
              {effectiveViewMode === "dashboard" ? renderDashboardSummary() : renderNavigationTiles()}
            </Stack>
          </TilesContainer>
        </PageWrapper>
      </ThemeProvider>
    </PageAccessGuard>
  );
};

const DashboardCard = ({
  card,
  liveState,
  layoutMetrics,
  periodOverride,
  getVisualPeriodOverride,
  visualPeriodConfig,
  visualPeriodSelection,
  visualPeriodSelectionByField,
  visualDateFilterSelectionIds,
  onVisualDateFilterToggle,
  onVisualPeriodChange,
  visualCustomInput,
  visualCustomInputsByField,
  onVisualCustomInputChange,
  onVisualApplyCustomRange,
  spotlightPeriodConfig,
  spotlightPeriodSelection,
  spotlightPeriodSelectionByField,
  spotlightDateFilterSelectionIds,
  onSpotlightDateFilterToggle,
  onSpotlightPeriodChange,
  spotlightCustomInput,
  spotlightCustomInputsByField,
  onSpotlightCustomInputChange,
  onSpotlightApplyCustomRange,
  isLinked,
  onToggleLink,
  segmentFilter,
}: {
  card: DashboardCardDto;
  liveState?: DashboardCardLiveState;
  layoutMetrics?: CardLayoutMetrics;
  periodOverride?: DashboardPreviewPeriodOverride | DashboardPreviewPeriodPreset | null;
  getVisualPeriodOverride?: (
    cardId: string,
    dateFieldId?: string,
  ) => DashboardPreviewPeriodPreset | DashboardPreviewPeriodOverride | null;
  visualPeriodConfig?: {
    presets: DashboardPreviewPeriodPreset[];
    defaultPreset: DashboardPreviewPeriodPreset;
    allowCustom?: boolean;
  } | null;
  visualPeriodSelection?: VisualPeriodSelection | null;
  visualPeriodSelectionByField?: Record<string, VisualPeriodSelection>;
  visualDateFilterSelectionIds?: string[] | null;
  onVisualDateFilterToggle?: (cardId: string, dateFilterId: string) => void;
  onVisualPeriodChange?: (cardId: string, preset: VisualPeriodSelection, dateFieldId?: string) => void;
  visualCustomInput?: { from: string; to: string } | null;
  visualCustomInputsByField?: Record<string, { from: string; to: string }>;
  onVisualCustomInputChange?: (cardId: string, key: "from" | "to", value: string, dateFieldId?: string) => void;
  onVisualApplyCustomRange?: (cardId: string, dateFieldId?: string) => void;
  spotlightPeriodConfig?: {
    presets: DashboardPreviewPeriodPreset[];
    defaultPreset: DashboardPreviewPeriodPreset;
    allowCustom?: boolean;
  } | null;
  spotlightPeriodSelection?: SpotlightPeriodSelection | null;
  spotlightPeriodSelectionByField?: Record<string, SpotlightPeriodSelection>;
  spotlightDateFilterSelectionIds?: string[] | null;
  onSpotlightDateFilterToggle?: (cardId: string, dateFilterId: string) => void;
  onSpotlightPeriodChange?: (cardId: string, preset: SpotlightPeriodSelection, dateFieldId?: string) => void;
  spotlightCustomInput?: { from: string; to: string } | null;
  spotlightCustomInputsByField?: Record<string, { from: string; to: string }>;
  onSpotlightCustomInputChange?: (cardId: string, key: "from" | "to", value: string, dateFieldId?: string) => void;
  onSpotlightApplyCustomRange?: (cardId: string, dateFieldId?: string) => void;
  isLinked?: boolean;
  onToggleLink?: (cardId: string) => void;
  segmentFilter?: string | null;
}) => {
  const viewConfig = card.viewConfig as DashboardCardViewConfig;
  if (!viewConfig || typeof viewConfig !== "object") {
    return (
      <StyledDashboardCard variant="outlined">
      <CardAccent />
      <CardContent
        sx={{
          flexGrow: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 3,
        }}
      >
          <Typography variant="body2" color="textSecondary" align="center">
            This card does not have a saved configuration yet.
          </Typography>
        </CardContent>
      </StyledDashboardCard>
    );
  }

  if (isVisualCardViewConfig(viewConfig)) {
    const visualDateFieldOptions = resolveDateFilterOptions(viewConfig);
    const selectedVisualDateFieldIds =
      visualDateFilterSelectionIds && visualDateFilterSelectionIds.length > 0
        ? visualDateFilterSelectionIds
        : resolveSelectedDateFilterIds(viewConfig, visualDateFieldOptions);
    const activeVisualDateFilter = resolveActiveDateFilter(viewConfig, selectedVisualDateFieldIds[0] ?? null);
    const visualPeriodOverride = getVisualPeriodOverride?.(card.id, activeVisualDateFilter?.id) ?? null;
    const visualRange = resolveVisualDateRange(viewConfig, visualPeriodOverride, activeVisualDateFilter);
    const visualRangeLabel = formatRangeLabel(visualRange) ?? "Date range not set";
    const visualDateFieldLabel = activeVisualDateFilter ? buildDateFilterOptionLabel(activeVisualDateFilter) : null;
    const visualInfoLabel =
      visualDateFieldLabel && visualRangeLabel ? `${visualDateFieldLabel}\n${visualRangeLabel}` : visualRangeLabel;
    return (
      <VisualDashboardCard
        card={card}
        config={viewConfig}
        liveState={liveState ?? { status: "idle" }}
        segmentFilter={segmentFilter}
        infoLabel={visualInfoLabel}
        dateFieldSelection={selectedVisualDateFieldIds[0] ?? undefined}
        selectedDateFieldIds={selectedVisualDateFieldIds}
        onToggleDateField={(dateFilterId) => onVisualDateFilterToggle?.(card.id, dateFilterId)}
        periodConfig={visualPeriodConfig ?? undefined}
        periodSelection={visualPeriodSelection ?? undefined}
        periodSelectionByField={visualPeriodSelectionByField ?? undefined}
        onPeriodChange={(preset, dateFieldId) => onVisualPeriodChange?.(card.id, preset, dateFieldId)}
        customInput={visualCustomInput ?? undefined}
        customInputsByField={visualCustomInputsByField ?? undefined}
        onCustomInputChange={(key, value, dateFieldId) =>
          onVisualCustomInputChange?.(card.id, key, value, dateFieldId)
        }
        onApplyCustomRange={(dateFieldId) => onVisualApplyCustomRange?.(card.id, dateFieldId)}
        isLinked={isLinked}
        onToggleLink={() => onToggleLink?.(card.id)}
      />
    );
  }

  if (isSpotlightCardViewConfig(viewConfig)) {
    const spotlightDateFieldOptions = resolveDateFilterOptions(viewConfig);
    const selectedSpotlightDateFieldIds =
      spotlightDateFilterSelectionIds && spotlightDateFilterSelectionIds.length > 0
        ? spotlightDateFilterSelectionIds
        : resolveSelectedDateFilterIds(viewConfig, spotlightDateFieldOptions);
    const activeSpotlightDateFilter = resolveActiveDateFilter(
      viewConfig,
      selectedSpotlightDateFieldIds[0] ?? null,
    );
    return (
      <SpotlightDashboardCard
        card={card}
        config={viewConfig}
        liveState={liveState ?? { status: "idle" }}
        periodConfig={spotlightPeriodConfig ?? undefined}
        periodSelection={spotlightPeriodSelection ?? undefined}
        periodSelectionByField={spotlightPeriodSelectionByField ?? undefined}
        dateFieldSelection={activeSpotlightDateFilter?.id ?? selectedSpotlightDateFieldIds[0] ?? undefined}
        selectedDateFieldIds={selectedSpotlightDateFieldIds}
        onToggleDateField={(dateFilterId) => onSpotlightDateFilterToggle?.(card.id, dateFilterId)}
        onPeriodChange={(preset, dateFieldId) => onSpotlightPeriodChange?.(card.id, preset, dateFieldId)}
        customInput={spotlightCustomInput ?? undefined}
        customInputsByField={spotlightCustomInputsByField ?? undefined}
        onCustomInputChange={(key, value, dateFieldId) =>
          onSpotlightCustomInputChange?.(card.id, key, value, dateFieldId)
        }
        onApplyCustomRange={(dateFieldId) => onSpotlightApplyCustomRange?.(card.id, dateFieldId)}
        isLinked={isLinked}
        onToggleLink={() => onToggleLink?.(card.id)}
      />
    );
  }

  if (isPreviewTableCardViewConfig(viewConfig)) {
    return (
      <PreviewTableDashboardCard
        card={card}
        config={viewConfig}
        liveState={liveState ?? { status: "idle" }}
        layoutMetrics={layoutMetrics}
        periodOverride={periodOverride ?? null}
        segmentFilter={segmentFilter}
      />
    );
  }

  return (
    <StyledDashboardCard variant="outlined">
      <CardAccent />
      <CardContent
        sx={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 1.5, p: { xs: 2.5, md: 3 } }}
      >
        <CardSubtitle variant="body2">
          Legacy dashboard card format. Open the template and re-save the card to modernize it.
        </CardSubtitle>
        <Box component="pre" sx={{ bgcolor: "grey.100", p: 2, borderRadius: 2, overflowX: "auto", fontSize: 12 }}>
          {JSON.stringify(viewConfig, null, 2)}
        </Box>
      </CardContent>
    </StyledDashboardCard>
  );
};

const VisualDashboardCard = ({
  card,
  config,
  liveState,
  segmentFilter,
  infoLabel,
  dateFieldSelection,
  onDateFieldChange,
  selectedDateFieldIds,
  onToggleDateField,
  periodConfig,
  periodSelection,
  periodSelectionByField,
  onPeriodChange,
  customInput,
  customInputsByField,
  onCustomInputChange,
  onApplyCustomRange,
  isLinked,
  onToggleLink,
}: {
  card: DashboardCardDto;
  config: DashboardVisualCardViewConfig;
  liveState: DashboardCardLiveState;
  segmentFilter?: string | null;
  infoLabel?: string | null;
  dateFieldSelection?: string | null;
  onDateFieldChange?: (dateFilterId: string) => void;
  selectedDateFieldIds?: string[] | null;
  onToggleDateField?: (dateFilterId: string) => void;
  periodConfig?: {
    presets: DashboardPreviewPeriodPreset[];
    defaultPreset: DashboardPreviewPeriodPreset;
    allowCustom?: boolean;
  };
  periodSelection?: VisualPeriodSelection;
  periodSelectionByField?: Record<string, VisualPeriodSelection>;
  onPeriodChange?: (preset: VisualPeriodSelection, dateFieldId?: string) => void;
  customInput?: { from: string; to: string };
  customInputsByField?: Record<string, { from: string; to: string }>;
  onCustomInputChange?: (key: "from" | "to", value: string, dateFieldId?: string) => void;
  onApplyCustomRange?: (dateFieldId?: string) => void;
  isLinked?: boolean;
  onToggleLink?: () => void;
}) => {
  const sample = liveState.visualSample ?? [];
  const chartSample = segmentFilter ? sample.filter((point) => point.dimension === segmentFilter) : sample;
  const dateFieldOptions = resolveDateFilterOptions(config);
  const resolvedSelectedDateFieldIds =
    selectedDateFieldIds && selectedDateFieldIds.length > 0
      ? selectedDateFieldIds
      : resolveSelectedDateFilterIds(config, dateFieldOptions);
  const selectedDateFieldOptions = dateFieldOptions.filter((option) =>
    resolvedSelectedDateFieldIds.includes(option.id),
  );
  const activeDateField =
    selectedDateFieldOptions[0] ?? resolveActiveDateFilter(config, dateFieldSelection);
  const showDateFieldRow = false;
  const dateFieldLabel = activeDateField ? buildDateFilterOptionLabel(activeDateField) : null;
  const infoDateFieldLabel = dateFieldLabel;
  const dateFieldMenuOptions = dateFieldOptions.map((option) => ({
    value: option.id,
    label: buildDateFilterOptionLabel(option),
  }));
  const hasPeriodConfig =
    Boolean(periodConfig && activeDateField && periodConfig.presets.length > 0);
  const canEdit = hasPeriodConfig && typeof onPeriodChange === "function";
  const allowCustom = Boolean(periodConfig?.allowCustom);
  const periodSelections = periodSelectionByField ?? {};
  const customInputsByDateField = customInputsByField ?? {};
  const resolvePreset = (selection?: VisualPeriodSelection | null): VisualPeriodSelection | null => {
    if (!selection) {
      return periodConfig?.defaultPreset ?? null;
    }
    if (selection === "custom") {
      return allowCustom ? "custom" : periodConfig?.defaultPreset ?? null;
    }
    return periodConfig?.presets.includes(selection) ? selection : periodConfig?.defaultPreset ?? null;
  };
  const activeDateFieldId = activeDateField?.id ?? selectedDateFieldOptions[0]?.id;
  const activePreset = resolvePreset(
    activeDateFieldId ? periodSelections[activeDateFieldId] ?? periodSelection ?? null : periodSelection ?? null,
  );
  const customInputs =
    (activeDateFieldId ? customInputsByDateField[activeDateFieldId] : null) ??
    customInput ??
    { from: "", to: "" };
  const activeLabel = activePreset
    ? activePreset === "custom"
      ? "Custom"
      : getSpotlightPeriodLabel(activePreset)
    : null;
  const periodOptions = hasPeriodConfig
    ? [
        ...(periodConfig?.presets ?? []).map((preset) => ({
          value: preset,
          label: getSpotlightPeriodLabel(preset),
        })),
        ...(allowCustom ? [{ value: "custom", label: "Custom" }] : []),
      ]
    : [];
  const periodRows =
    hasPeriodConfig && selectedDateFieldOptions.length > 0
      ? selectedDateFieldOptions.map((option) => {
          const rowPreset = resolvePreset(periodSelections[option.id] ?? periodSelection ?? null);
          const rowCustomInputs =
            customInputsByDateField[option.id] ?? customInput ?? { from: "", to: "" };
          const rowLabel = option.label ?? buildDateFilterOptionLabel(option);
          const label = rowPreset ? (rowPreset === "custom" ? "Custom" : getSpotlightPeriodLabel(rowPreset)) : "";
          return {
            label,
            options: periodOptions,
            activeValue: rowPreset ?? undefined,
            onSelectOption: canEdit
              ? (value: string) => onPeriodChange?.(value as VisualPeriodSelection, option.id)
              : undefined,
            dateFieldLabel: rowLabel,
            dateFieldOptions: dateFieldMenuOptions,
            activeDateField: activeDateField?.id,
            onSelectDateField: onDateFieldChange,
            selectedDateFieldIds: resolvedSelectedDateFieldIds,
            onToggleDateField,
            customInput: allowCustom ? rowCustomInputs : undefined,
            onCustomInputChange:
              allowCustom && canEdit
                ? (key: "from" | "to", value: string) => onCustomInputChange?.(key, value, option.id)
                : undefined,
            onApplyCustomRange: allowCustom && canEdit ? () => onApplyCustomRange?.(option.id) : undefined,
          };
        })
      : undefined;

  return (
    <GraphicCard
      title={card.title}
      config={config}
      points={chartSample}
      infoLabel={infoLabel}
      periodRows={periodRows}
      dateFieldLabel={dateFieldLabel ?? undefined}
      dateFieldOptions={dateFieldMenuOptions}
      activeDateField={activeDateField?.id}
      onSelectDateField={onDateFieldChange}
      periodLabel={hasPeriodConfig ? activeLabel ?? undefined : undefined}
      periodOptions={periodOptions}
      activePeriod={activePreset ?? undefined}
      onSelectPeriod={canEdit ? (value) => onPeriodChange?.(value as VisualPeriodSelection) : undefined}
      customInput={allowCustom ? customInputs : undefined}
      onCustomInputChange={allowCustom && canEdit ? onCustomInputChange : undefined}
      onApplyCustomRange={allowCustom && canEdit ? onApplyCustomRange : undefined}
      isLinked={isLinked}
      onToggleLink={onToggleLink}
    />
  );
};

const SpotlightDashboardCard = ({
  card,
  config,
  liveState,
  periodConfig,
  periodSelection,
  periodSelectionByField,
  dateFieldSelection,
  onDateFieldChange,
  selectedDateFieldIds,
  onToggleDateField,
  onPeriodChange,
  customInput,
  customInputsByField,
  onCustomInputChange,
  onApplyCustomRange,
  isLinked,
  onToggleLink,
}: {
  card: DashboardCardDto;
  config: DashboardSpotlightCardViewConfig;
  liveState: DashboardCardLiveState;
  periodConfig?: {
    presets: DashboardPreviewPeriodPreset[];
    defaultPreset: DashboardPreviewPeriodPreset;
    allowCustom?: boolean;
  };
  periodSelection?: SpotlightPeriodSelection;
  periodSelectionByField?: Record<string, SpotlightPeriodSelection>;
  dateFieldSelection?: string | null;
  onDateFieldChange?: (dateFilterId: string) => void;
  selectedDateFieldIds?: string[] | null;
  onToggleDateField?: (dateFilterId: string) => void;
  onPeriodChange?: (preset: SpotlightPeriodSelection, dateFieldId?: string) => void;
  customInput?: { from: string; to: string };
  customInputsByField?: Record<string, { from: string; to: string }>;
  onCustomInputChange?: (key: "from" | "to", value: string, dateFieldId?: string) => void;
  onApplyCustomRange?: (dateFieldId?: string) => void;
  isLinked?: boolean;
  onToggleLink?: () => void;
}) => {
  const sampleCards = liveState.spotlightSample?.cards ?? [];
  const isLoading = liveState.status === "loading";
  const error = liveState.status === "error" ? liveState.error : null;
  const dateFieldOptions = resolveDateFilterOptions(config);
  const resolvedSelectedDateFieldIds =
    selectedDateFieldIds && selectedDateFieldIds.length > 0
      ? selectedDateFieldIds
      : resolveSelectedDateFilterIds(config, dateFieldOptions);
  const selectedDateFieldOptions = dateFieldOptions.filter((option) =>
    resolvedSelectedDateFieldIds.includes(option.id),
  );
  const activeDateField =
    selectedDateFieldOptions[0] ?? resolveActiveDateFilter(config, dateFieldSelection);
  const showDateFieldRow = false;
  const dateFieldLabel = activeDateField ? buildDateFilterOptionLabel(activeDateField) : null;
  const infoDateFieldLabel = dateFieldLabel;
  const dateFieldMenuOptions = dateFieldOptions.map((option) => ({
    value: option.id,
    label: buildDateFilterOptionLabel(option),
  }));
  const showPeriodControls =
    Boolean(periodConfig && activeDateField && periodConfig.presets.length > 0) &&
    typeof onPeriodChange === "function";
  const allowCustom = Boolean(periodConfig?.allowCustom);
  const periodSelections = periodSelectionByField ?? {};
  const customInputsByDateField = customInputsByField ?? {};
  const resolvePreset = (selection?: SpotlightPeriodSelection | null): SpotlightPeriodSelection | null => {
    if (!selection) {
      return periodConfig?.defaultPreset ?? null;
    }
    if (selection === "custom") {
      return allowCustom ? "custom" : periodConfig?.defaultPreset ?? null;
    }
    return periodConfig?.presets.includes(selection) ? selection : periodConfig?.defaultPreset ?? null;
  };
  const activeDateFieldId = activeDateField?.id ?? selectedDateFieldOptions[0]?.id;
  const activePreset = resolvePreset(
    activeDateFieldId ? periodSelections[activeDateFieldId] ?? periodSelection ?? null : periodSelection ?? null,
  );
  const customInputs =
    (activeDateFieldId ? customInputsByDateField[activeDateFieldId] : null) ??
    customInput ??
    { from: "", to: "" };
  const activeLabel = activePreset
    ? activePreset === "custom"
      ? "Custom"
      : getSpotlightPeriodLabel(activePreset)
    : null;
  const activeRangeOverride: DashboardPreviewPeriodOverride | DashboardPreviewPeriodPreset | null =
    activePreset === "custom" && customInputs.from && customInputs.to
      ? { mode: "custom", from: customInputs.from, to: customInputs.to }
      : activePreset && activePreset !== "custom"
        ? activePreset
        : null;
  const activeRangeLabel = formatSpotlightRangeLabel(computePeriodRange(activeRangeOverride));
  const infoRangeLabel =
    infoDateFieldLabel && activeRangeLabel ? `${infoDateFieldLabel}\n${activeRangeLabel}` : activeRangeLabel;
  const periodOptions = showPeriodControls
    ? [
        ...(periodConfig?.presets ?? []).map((preset) => ({
          value: preset,
          label: getSpotlightPeriodLabel(preset),
        })),
        ...(allowCustom ? [{ value: "custom", label: "Custom" }] : []),
      ]
    : [];
  const periodRows =
    showPeriodControls && selectedDateFieldOptions.length > 0
      ? selectedDateFieldOptions.map((option) => {
          const rowPreset = resolvePreset(periodSelections[option.id] ?? periodSelection ?? null);
          const rowCustomInputs =
            customInputsByDateField[option.id] ?? customInput ?? { from: "", to: "" };
          const rowLabel = option.label ?? buildDateFilterOptionLabel(option);
          const label = rowPreset ? (rowPreset === "custom" ? "Custom" : getSpotlightPeriodLabel(rowPreset)) : "";
          return {
            label,
            options: periodOptions,
            activeValue: rowPreset ?? undefined,
            onSelectOption: (value: string) => onPeriodChange?.(value as SpotlightPeriodSelection, option.id),
            dateFieldLabel: rowLabel,
            dateFieldOptions: dateFieldMenuOptions,
            activeDateField: activeDateField?.id,
            onSelectDateField: onDateFieldChange,
            selectedDateFieldIds: resolvedSelectedDateFieldIds,
            onToggleDateField,
            customInput: allowCustom ? rowCustomInputs : undefined,
            onCustomInputChange: allowCustom
              ? (key: "from" | "to", value: string) => onCustomInputChange?.(key, value, option.id)
              : undefined,
            onApplyCustomRange: allowCustom ? () => onApplyCustomRange?.(option.id) : undefined,
          };
        })
      : undefined;
  const primarySample = sampleCards[0];
  const metricLabel = primarySample ? primarySample.label ?? config.spotlight.metricLabel ?? "Metric" : null;
  const fallbackMetricValue = formatMetricValue(0, config.spotlight.format, config.spotlight.currency);
  const metricValue = primarySample?.value ?? fallbackMetricValue;
  const deltaText = primarySample ? primarySample.delta ?? null : null;
  const rangeText = primarySample?.rangeLabel ? `Current: ${primarySample.rangeLabel}` : null;
  const contextText = primarySample?.context ?? null;
  const filteredContextText = contextText === "Latest analytics result" ? null : contextText;
  const statusText = error ?? liveState.warning ?? null;
  const statusTone = error ? "error" : liveState.warning ? "warning" : isLoading ? "info" : null;

  return (
    <SpotlightCard
      title={card.title}
      metricLabel={metricLabel}
      metricValue={metricValue}
      deltaText={deltaText}
      rangeText={rangeText}
      contextText={filteredContextText}
      statusText={statusText ?? undefined}
      statusTone={statusTone ?? undefined}
      periodRows={periodRows}
      dateFieldLabel={dateFieldLabel ?? undefined}
      dateFieldOptions={dateFieldMenuOptions}
      activeDateField={activeDateField?.id}
      onSelectDateField={onDateFieldChange}
      periodLabel={showPeriodControls ? activeLabel ?? undefined : undefined}
      rangeLabel={showPeriodControls ? infoRangeLabel ?? undefined : undefined}
      periodOptions={showPeriodControls ? periodOptions : []}
      activePeriod={activePreset ?? undefined}
      onSelectPeriod={showPeriodControls ? (value) => onPeriodChange?.(value as SpotlightPeriodSelection) : undefined}
      customInput={allowCustom ? customInputs : undefined}
      onCustomInputChange={allowCustom ? onCustomInputChange : undefined}
      onApplyCustomRange={allowCustom ? onApplyCustomRange : undefined}
      isLinked={isLinked}
      onToggleLink={onToggleLink}
    />
  );
};

const PreviewTableDashboardCard = ({
  card,
  config,
  liveState,
  layoutMetrics,
  periodOverride,
  segmentFilter,
}: {
  card: DashboardCardDto;
  config: DashboardPreviewTableCardViewConfig;
  liveState: DashboardCardLiveState;
  layoutMetrics?: CardLayoutMetrics;
  periodOverride: DashboardPreviewPeriodOverride | DashboardPreviewPeriodPreset | null;
  segmentFilter?: string | null;
}) => {
  const sample = liveState.previewSample;
  const isLoading = liveState.status === "loading";
  const error = liveState.status === "error" ? liveState.error : null;
  const [cardRef, cardSize] = useElementSize<HTMLDivElement>();
  const layoutHeight = layoutMetrics?.approxHeightPx ?? 360;
  const measuredHeight = cardSize.height > 0 ? cardSize.height : layoutHeight;
  const tableHeight = Math.max(160, measuredHeight - 160);
  const columnOrder =
    sample && sample.columnOrder.length > 0
      ? sample.columnOrder
      : config.columnOrder.length > 0
      ? config.columnOrder
      : sample?.columns ?? [];
  const columns = columnOrder.length > 0 ? columnOrder : sample?.columns ?? [];
  const columnAliases = sample?.columnAliases ?? config.columnAliases ?? {};
  const rawRows = sample?.rows ?? [];
  const canOverridePeriod = Boolean(config.dateFilter);
  const effectivePeriodOverride = canOverridePeriod ? periodOverride : null;
  const [page, setPage] = useState(0);
  const rowsPerPage = 10;
  useEffect(() => {
    setPage(0);
  }, [card.id, sample?.executedAt, segmentFilter]);
  const dimensionColumn = guessDimensionColumn(rawRows, columns);
  const filteredRows =
    segmentFilter && dimensionColumn
      ? rawRows.filter((row) => formatPreviewTableValue(row[dimensionColumn]) === segmentFilter)
      : rawRows;
  const filterEmptyState = Boolean(segmentFilter && dimensionColumn && rawRows.length > 0 && filteredRows.length === 0);
  const rows = filterEmptyState ? rawRows : filteredRows;
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const safePage = Math.min(page, totalPages - 1);
  const startIndex = safePage * rowsPerPage;
  const displayedRows = rows.slice(startIndex, startIndex + rowsPerPage);
  const executedLabel = sample?.executedAt
    ? new Date(sample.executedAt).toLocaleString()
    : null;
  const previewInsight = buildPreviewInsight(rows, columns, columnAliases);

  return (
    <StyledDashboardCard ref={cardRef} variant="outlined">
      <CardAccent />
      <CardContent
        sx={{
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
          p: { xs: 2.5, md: 3 },
        }}
      >
        <Stack gap={0.5} alignItems="center" textAlign="center">
          <CardTitle variant="subtitle1">{card.title}</CardTitle>
          {config.description && <CardSubtitle variant="body2">{config.description}</CardSubtitle>}
        </Stack>
        {segmentFilter && (
          <Chip size="small" color="info" label={`Focused on ${segmentFilter}`} variant="outlined" />
        )}
        {liveState.warning && <Alert severity="warning">{liveState.warning}</Alert>}
        {isLoading && (
          <Stack direction="row" gap={1} alignItems="center" justifyContent="center">
            <CircularProgress size={16} />
            <CardSubtitle variant="body2">Refreshing preview rows...</CardSubtitle>
          </Stack>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {filterEmptyState && (
          <Alert severity="info" variant="outlined">
            No rows returned for “{segmentFilter}”. Showing all rows for context.
          </Alert>
        )}
        {previewInsight && rows.length > 0 && !error && (
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              borderRadius: 2,
              borderColor: previewInsight.tone === "positive" ? "success.light" : previewInsight.tone === "negative" ? "error.light" : "rgba(15,23,42,0.12)",
              background:
                previewInsight.tone === "positive"
                  ? "rgba(46, 125, 50, 0.08)"
                  : previewInsight.tone === "negative"
                    ? "rgba(211, 47, 47, 0.08)"
                    : "rgba(15, 23, 42, 0.04)",
            }}
          >
            <Typography variant="subtitle2" fontWeight={600}>
              {previewInsight.headline}
            </Typography>
            {previewInsight.detail && <CardSubtitle variant="body2">{previewInsight.detail}</CardSubtitle>}
          </Paper>
        )}
        {!error && !isLoading && columns.length === 0 && (
          <CardSubtitle variant="body2" sx={{ textAlign: "center" }}>
            No preview columns available yet. Re-run the report preview and re-save this card.
          </CardSubtitle>
        )}
        {!error && !isLoading && columns.length > 0 && displayedRows.length === 0 && (
          <CardSubtitle variant="body2" sx={{ textAlign: "center" }}>
            No preview rows returned for this configuration.
          </CardSubtitle>
        )}
        {!error && columns.length > 0 && displayedRows.length > 0 && (
          <TableContainer
            component={Box}
            sx={{
              flexGrow: 1,
              maxHeight: tableHeight,
              overflow: "auto",
              borderRadius: 2,
              border: "1px solid rgba(15, 23, 42, 0.08)",
            }}
          >
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {columns.map((column) => (
                    <TableCell key={column} sx={{ fontWeight: 600 }}>
                      {columnAliases[column] ?? column}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {displayedRows.map((row, rowIndex) => (
                  <TableRow key={`${card.id}-row-${rowIndex}`}>
                    {columns.map((column) => (
                      <TableCell key={`${card.id}-row-${rowIndex}-${column}`}>
                        {formatPreviewTableValue((row as Record<string, unknown>)[column])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {rows.length > 0 ? (
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <CardSubtitle variant="caption">
              Showing {startIndex + 1}-{startIndex + displayedRows.length} of {rows.length} rows
            </CardSubtitle>
            <Stack direction="row" gap={1}>
              <Button
                variant="text"
                size="small"
                onClick={() => setPage((prev) => Math.max(0, prev - 1))}
                disabled={safePage === 0}
              >
                Previous
              </Button>
              <Button
                variant="text"
                size="small"
                onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
                disabled={safePage >= totalPages - 1}
              >
                Next
              </Button>
            </Stack>
          </Stack>
        ) : (
          <CardSubtitle variant="caption" sx={{ textAlign: "center" }}>
            No preview rows matched the current filters.
          </CardSubtitle>
        )}
        {executedLabel && (
          <CardSubtitle variant="caption" sx={{ textAlign: "center" }}>
            Last executed: {executedLabel}
          </CardSubtitle>
        )}
        <Stack direction="row" gap={1} justifyContent="center">
          <Button
            component={RouterLink}
            to={`/reports?templateId=${card.templateId}`}
            variant="outlined"
            size="small"
          >
            Investigate in Reports
          </Button>
          <Button component={RouterLink} to="/reports/dashboards" variant="text" size="small">
            Edit card
          </Button>
        </Stack>
      </CardContent>
    </StyledDashboardCard>
  );
};

const HeroSpotlightRow = ({
  cards,
  liveCardSamples,
  spotlightPeriodConfigById,
  getSpotlightPeriodSelection,
  onSpotlightPeriodChange,
  spotlightCustomInputs,
  onSpotlightCustomInputChange,
  onSpotlightApplyCustomRange,
}: {
  cards: DashboardCardDto[];
  liveCardSamples: Map<string, DashboardCardLiveState>;
  spotlightPeriodConfigById?: Map<
    string,
    { presets: DashboardPreviewPeriodPreset[]; defaultPreset: DashboardPreviewPeriodPreset; allowCustom?: boolean }
  >;
  getSpotlightPeriodSelection?: (cardId: string) => SpotlightPeriodSelection | null;
  onSpotlightPeriodChange?: (cardId: string, preset: SpotlightPeriodSelection, dateFieldId?: string) => void;
  spotlightCustomInputs?: Record<string, { from: string; to: string }>;
  onSpotlightCustomInputChange?: (cardId: string, key: "from" | "to", value: string, dateFieldId?: string) => void;
  onSpotlightApplyCustomRange?: (cardId: string, dateFieldId?: string) => void;
}) => {
  if (cards.length === 0) {
    return null;
  }
  const singleCard = cards.length === 1;
  const twoCards = cards.length === 2;
  return (
    <Grid container spacing={{ xs: 2, md: 3 }} justifyContent="center">
      {cards.map((card) => (
        <Grid
          key={card.id}
          size={{
            xs: 12,
            sm: singleCard ? 8 : 6,
            md: singleCard ? 6 : twoCards ? 6 : 4,
          }}
        >
          <HeroSpotlightCard
            card={card}
            liveState={liveCardSamples.get(card.id)}
            periodConfig={spotlightPeriodConfigById?.get(card.id)}
            periodSelection={
              getSpotlightPeriodSelection?.(card.id) ??
              spotlightPeriodConfigById?.get(card.id)?.defaultPreset ??
              undefined
            }
            onPeriodChange={(preset) => onSpotlightPeriodChange?.(card.id, preset)}
            customInput={spotlightCustomInputs?.[card.id]}
            onCustomInputChange={(key: "from" | "to", value: string) =>
              onSpotlightCustomInputChange?.(card.id, key, value)
            }
            onApplyCustomRange={() => onSpotlightApplyCustomRange?.(card.id)}
          />
        </Grid>
      ))}
    </Grid>
  );
};

const HeroSpotlightCard = ({
  card,
  liveState,
  periodConfig,
  periodSelection,
  onPeriodChange,
  customInput,
  onCustomInputChange,
  onApplyCustomRange,
}: {
  card: DashboardCardDto;
  liveState: DashboardCardLiveState | undefined;
  periodConfig?: {
    presets: DashboardPreviewPeriodPreset[];
    defaultPreset: DashboardPreviewPeriodPreset;
    allowCustom?: boolean;
  };
  periodSelection?: SpotlightPeriodSelection;
  onPeriodChange?: (preset: SpotlightPeriodSelection) => void;
  customInput?: { from: string; to: string };
  onCustomInputChange?: (key: "from" | "to", value: string) => void;
  onApplyCustomRange?: () => void;
}) => {
  const config = (card.viewConfig as DashboardCardViewConfig) ?? null;
  if (!isSpotlightCardViewConfig(config)) {
    return null;
  }
  const sampleCards = liveState?.spotlightSample?.cards ?? [];
  const primary = sampleCards[0];
  const showPeriodControls =
    Boolean(periodConfig && config.dateFilter && periodConfig.presets.length > 0) &&
    typeof onPeriodChange === "function";
  const allowCustom = Boolean(periodConfig?.allowCustom);
  const activePreset = periodSelection ?? periodConfig?.defaultPreset ?? null;
  const customInputs = customInput ?? { from: "", to: "" };
  const activeLabel = activePreset
    ? activePreset === "custom"
      ? "Custom"
      : getSpotlightPeriodLabel(activePreset)
    : null;
  const activeRangeOverride: DashboardPreviewPeriodOverride | DashboardPreviewPeriodPreset | null =
    activePreset === "custom" && customInputs.from && customInputs.to
      ? { mode: "custom", from: customInputs.from, to: customInputs.to }
      : activePreset && activePreset !== "custom"
        ? activePreset
        : null;
  const activeRangeLabel = formatSpotlightRangeLabel(computePeriodRange(activeRangeOverride));
  const periodOptions = showPeriodControls
    ? [
        ...(periodConfig?.presets ?? []).map((preset) => ({
          value: preset,
          label: getSpotlightPeriodLabel(preset),
        })),
        ...(allowCustom ? [{ value: "custom", label: "Custom" }] : []),
      ]
    : [];
  const metricLabel = primary ? primary.label ?? config.spotlight.metricLabel ?? "Metric" : null;
  const fallbackMetricValue = formatMetricValue(0, config.spotlight.format, config.spotlight.currency);
  const metricValue = primary?.value ?? fallbackMetricValue;
  const deltaText = primary?.delta ?? null;
  const rangeText = primary?.rangeLabel ? `Current: ${primary.rangeLabel}` : null;
  const contextText = primary?.context ?? null;
  const statusText = null;

  return (
    <SpotlightCard
      title={card.title}
      metricLabel={metricLabel}
      metricValue={metricValue}
      deltaText={deltaText}
      rangeText={rangeText}
      contextText={contextText}
      statusText={statusText ?? undefined}
      statusTone={statusText ? "info" : undefined}
      periodLabel={showPeriodControls ? activeLabel ?? undefined : undefined}
      rangeLabel={showPeriodControls ? activeRangeLabel ?? undefined : undefined}
      periodOptions={showPeriodControls ? periodOptions : []}
      activePeriod={activePreset ?? undefined}
      onSelectPeriod={showPeriodControls ? (value) => onPeriodChange?.(value as SpotlightPeriodSelection) : undefined}
      customInput={allowCustom ? customInputs : undefined}
      onCustomInputChange={allowCustom ? onCustomInputChange : undefined}
      onApplyCustomRange={allowCustom ? onApplyCustomRange : undefined}
      titleVariant="h6"
    />
  );
};

export default Home;






const useElementSize = <T extends HTMLElement>() => {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(node);
    setSize({ width: node.clientWidth, height: node.clientHeight });
    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, size] as const;
};
