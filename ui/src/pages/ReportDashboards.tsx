import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { GridStack } from "gridstack";
import "gridstack/dist/gridstack.min.css";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Flex,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
  useMantineTheme,
} from "@mantine/core";
import {
  IconAdjustments,
  IconArrowLeft,
  IconDeviceFloppy,
  IconLayoutGrid,
  IconPlus,
  IconSearch,
  IconTableExport,
  IconTrash,
} from "@tabler/icons-react";
import type { GenericPageProps } from "../types/general/GenericPageProps";
import { useAppDispatch } from "../store/hooks";
import { navigateToPage } from "../actions/navigationActions";
import {
  useReportDashboards,
  useCreateDashboard,
  useUpdateDashboard,
  useDeleteDashboard,
  useUpsertDashboardCard,
  useDeleteDashboardCard,
  useExportDashboard,
  useReportTemplates,
  type DashboardCardDto,
  type DashboardCardPayload,
  type DashboardCardViewConfig,
  type DashboardPreviewPeriodPreset,
  type DashboardSpotlightCardViewConfig,
  type DashboardVisualCardViewConfig,
  type FilterOperator,
  type ReportDashboardDto,
  type ReportTemplateDto,
  type DashboardExportResponse,
} from "../api/reports";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { GraphicCard } from "../components/dashboard/GraphicCard";
import { SpotlightCard } from "../components/dashboard/SpotlightCardParts";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";

dayjs.extend(isoWeek);

type DashboardCardLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type LayoutMode = "desktop" | "mobile";

type DashboardGridItem = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type CardDraft = {
  id?: string;
  templateId: string;
  title: string;
  layout: DashboardCardLayout;
  viewConfig: Record<string, unknown>;
};

const DEFAULT_CARD_LAYOUT: DashboardCardLayout = {
  x: 0,
  y: 0,
  w: 6,
  h: 4,
};
const LAYOUT_EDITOR_CELL_HEIGHT = 12;
const LAYOUT_EDITOR_COLUMN_COUNT_DESKTOP = 168;
const LAYOUT_EDITOR_COLUMN_COUNT_MOBILE = 48;
const LAYOUT_EDITOR_COLUMN_COUNT_BY_MODE: Record<LayoutMode, number> = {
  desktop: LAYOUT_EDITOR_COLUMN_COUNT_DESKTOP,
  mobile: LAYOUT_EDITOR_COLUMN_COUNT_MOBILE,
};
const DEFAULT_MOBILE_LAYOUT: DashboardCardLayout = {
  x: 0,
  y: 0,
  w: Math.min(DEFAULT_CARD_LAYOUT.w, LAYOUT_EDITOR_COLUMN_COUNT_MOBILE),
  h: DEFAULT_CARD_LAYOUT.h,
};
const LAYOUT_EDITOR_GRID_SIZE = Math.max(12, Math.floor(LAYOUT_EDITOR_CELL_HEIGHT / 8));

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
const scaleLayoutForColumns = (
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
const DASHBOARD_EDITOR_GRID_CSS = `
${buildGridStackColumnStyles(LAYOUT_EDITOR_COLUMN_COUNT_DESKTOP)}
${buildGridStackColumnStyles(LAYOUT_EDITOR_COLUMN_COUNT_MOBILE)}
.dashboard-layout-grid .grid-stack-item-content {
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  height: 100%;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  border: none;
  padding: 0;
  cursor: grab;
  transition: transform 0.2s ease;
}
.dashboard-layout-grid .grid-stack-item-content:active {
  cursor: grabbing;
}
.dashboard-layout-grid .grid-stack-item-content:hover {
  transform: translateY(-2px);
}
.dashboard-layout-grid .demo-grid-item.is-accent {
  color: #2563eb;
}
.dashboard-layout-grid .dashboard-layout-card {
  height: 100%;
  width: 100%;
}
.dashboard-layout-grid .ui-resizable-handle {
  background: transparent;
}
`;

const deepClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const resolveNumericValue = (value: number | string | undefined): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseLayoutSource = (
  source: Record<string, unknown> | undefined | null,
  fallback: DashboardCardLayout,
  maxColumns: number,
): DashboardCardLayout => {
  const resolveNumber = (key: string, fallbackValue: number): number => {
    const value = source?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallbackValue;
  };
  const width = Math.max(1, Math.min(maxColumns, resolveNumber("w", fallback.w)));
  const height = Math.max(1, resolveNumber("h", fallback.h));
  const x = resolveNumber("x", fallback.x);
  const y = resolveNumber("y", fallback.y);
  const maxX = Math.max(0, maxColumns - width);
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, y),
    w: width,
    h: height,
  };
};
const parseLayout = (
  layout: Record<string, unknown> | undefined | null,
  mode: LayoutMode = "desktop",
): DashboardCardLayout => {
  const safeLayout = layout && typeof layout === "object" ? layout : {};
  const desktopSource =
    Object.prototype.hasOwnProperty.call(safeLayout, "desktop") && typeof safeLayout.desktop === "object"
      ? (safeLayout.desktop as Record<string, unknown>)
      : null;
  const mobileSource =
    Object.prototype.hasOwnProperty.call(safeLayout, "mobile") && typeof safeLayout.mobile === "object"
      ? (safeLayout.mobile as Record<string, unknown>)
      : null;
  if (mode === "mobile") {
    if (mobileSource) {
      return parseLayoutSource(mobileSource, DEFAULT_MOBILE_LAYOUT, LAYOUT_EDITOR_COLUMN_COUNT_MOBILE);
    }
    const desktopBase = desktopSource ?? (safeLayout as Record<string, unknown>);
    const desktopParsed = parseLayoutSource(desktopBase, DEFAULT_CARD_LAYOUT, LAYOUT_EDITOR_COLUMN_COUNT_DESKTOP);
    return scaleLayoutForColumns(desktopParsed, LAYOUT_EDITOR_COLUMN_COUNT_DESKTOP, LAYOUT_EDITOR_COLUMN_COUNT_MOBILE);
  }
  if (desktopSource) {
    return parseLayoutSource(desktopSource, DEFAULT_CARD_LAYOUT, LAYOUT_EDITOR_COLUMN_COUNT_DESKTOP);
  }
  if (mobileSource) {
    const mobileParsed = parseLayoutSource(mobileSource, DEFAULT_MOBILE_LAYOUT, LAYOUT_EDITOR_COLUMN_COUNT_MOBILE);
    return scaleLayoutForColumns(mobileParsed, LAYOUT_EDITOR_COLUMN_COUNT_MOBILE, LAYOUT_EDITOR_COLUMN_COUNT_DESKTOP);
  }
  return parseLayoutSource(safeLayout as Record<string, unknown>, DEFAULT_CARD_LAYOUT, LAYOUT_EDITOR_COLUMN_COUNT_DESKTOP);
};

const hasLayoutForMode = (layout: Record<string, unknown> | undefined | null, mode: LayoutMode): boolean => {
  if (!layout || typeof layout !== "object") {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(layout, mode)) {
    const candidate = (layout as Record<string, unknown>)[mode];
    return candidate !== null && typeof candidate === "object";
  }
  return ["x", "y", "w", "h"].some((key) => Object.prototype.hasOwnProperty.call(layout, key));
};

const normalizeGridItem = (item: DashboardGridItem, mode: LayoutMode): DashboardCardLayout => {
  const maxColumns = LAYOUT_EDITOR_COLUMN_COUNT_BY_MODE[mode];
  const width = Math.max(1, Math.min(maxColumns, item.w));
  const maxX = Math.max(0, maxColumns - width);
  return {
    x: Math.max(0, Math.min(item.x, maxX)),
    y: Math.max(0, item.y),
    w: width,
    h: Math.max(1, item.h),
  };
};

const normalizeLayoutForMode = (layout: DashboardCardLayout, mode: LayoutMode): DashboardCardLayout =>
  normalizeGridItem({ id: "layout", ...layout }, mode);

const SPOTLIGHT_PERIOD_LABELS: Record<DashboardPreviewPeriodPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  all_time: "All time",
  last_7_days: "Last 7 days",
  last_week: "Last week",
  this_week: "This week",
  last_30_days: "Last 30 days",
  last_30_months: "Last 30 months",
  this_year: "This year",
  this_quarter: "This quarter",
  last_quarter: "Last quarter",
  this_month: "This month",
  last_month: "Last month",
};

const PERIOD_PRESET_OPTIONS: Array<{ value: DashboardPreviewPeriodPreset; label: string }> = [
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

const FILTER_OPERATORS: FilterOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "contains",
  "starts_with",
  "ends_with",
  "is_null",
  "is_not_null",
  "is_true",
  "is_false",
];

const isFilterOperator = (value: unknown): value is FilterOperator =>
  typeof value === "string" && FILTER_OPERATORS.includes(value as FilterOperator);

type TemplateDateFilter = {
  id: string;
  modelId: string;
  fieldId: string;
  operator: FilterOperator;
};

type DashboardDateFilterOption = {
  id: string;
  modelId: string;
  fieldId: string;
  operator: FilterOperator;
  label: string;
};

const buildDateFilterOptionId = (entry: { id?: string; modelId: string; fieldId: string; operator: FilterOperator }) =>
  entry.id ?? `${entry.modelId}.${entry.fieldId}.${entry.operator}`;

const sanitizeDateFilterLabel = (value: string): string => value.replace(/\s*\([^)]*\)\s*$/, "").trim();

const buildDateFilterOptionLabel = (entry: { label?: string; modelId: string; fieldId: string }) => {
  const base = entry.label ?? `${entry.modelId}.${entry.fieldId}`;
  return sanitizeDateFilterLabel(base);
};

const resolveDashboardDateFilterOptions = (
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

const getTemplateDateFilters = (template: ReportTemplateDto | null): TemplateDateFilter[] => {
  if (!template || !Array.isArray(template.filters)) {
    return [];
  }
  return template.filters
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as {
        id?: unknown;
        leftModelId?: unknown;
        leftFieldId?: unknown;
        operator?: unknown;
        valueKind?: unknown;
      };
      if (record.valueKind !== "date") {
        return null;
      }
      const modelId = typeof record.leftModelId === "string" ? record.leftModelId : null;
      const fieldId = typeof record.leftFieldId === "string" ? record.leftFieldId : null;
      const operator = isFilterOperator(record.operator) ? record.operator : null;
      if (!modelId || !fieldId || !operator) {
        return null;
      }
      const id =
        typeof record.id === "string" && record.id.trim().length > 0
          ? record.id
          : `${modelId}.${fieldId}.${index}`;
      return { id, modelId, fieldId, operator };
    })
    .filter((entry): entry is TemplateDateFilter => Boolean(entry));
};

const findMatchingDateFilterId = (
  dateFilter: { modelId: string; fieldId: string; operator: FilterOperator } | undefined,
  metadata: Map<string, { modelId: string; fieldId: string; operator: FilterOperator }>,
): string | null => {
  if (!dateFilter) {
    return null;
  }
  for (const [id, entry] of metadata.entries()) {
    if (
      entry.modelId === dateFilter.modelId &&
      entry.fieldId === dateFilter.fieldId &&
      entry.operator === dateFilter.operator
    ) {
      return id;
    }
  }
  return null;
};

const computeSpotlightPresetRange = (
  preset: DashboardPreviewPeriodPreset,
): { from: string; to: string } => {
  const today = dayjs();
  const getQuarterStart = (value: dayjs.Dayjs) => {
    const quarterIndex = Math.floor(value.month() / 3);
    const startMonth = quarterIndex * 3;
    return value.month(startMonth).startOf("month");
  };
  const getQuarterEnd = (value: dayjs.Dayjs) => value.add(2, "month").endOf("month");
  switch (preset) {
    case "today":
      return {
        from: today.startOf("day").format("YYYY-MM-DD HH:mm:ss.SSS"),
        to: today.endOf("day").format("YYYY-MM-DD HH:mm:ss.SSS"),
      };
    case "yesterday": {
      const base = today.subtract(1, "day");
      return {
        from: base.startOf("day").format("YYYY-MM-DD HH:mm:ss.SSS"),
        to: base.endOf("day").format("YYYY-MM-DD HH:mm:ss.SSS"),
      };
    }
    case "all_time":
      return {
        from: dayjs("1900-01-01").startOf("day").format("YYYY-MM-DD HH:mm:ss.SSS"),
        to: dayjs("2100-12-31").endOf("day").format("YYYY-MM-DD HH:mm:ss.SSS"),
      };
    case "last_7_days": {
      const from = today.subtract(6, "day");
      return {
        from: from.startOf("day").format("YYYY-MM-DD HH:mm:ss.SSS"),
        to: today.endOf("day").format("YYYY-MM-DD HH:mm:ss.SSS"),
      };
    }
    case "last_week": {
      const base = today.subtract(1, "week");
      return {
        from: base.startOf("isoWeek").format("YYYY-MM-DD HH:mm:ss.SSS"),
        to: base.endOf("isoWeek").format("YYYY-MM-DD HH:mm:ss.SSS"),
      };
    }
    case "this_week":
      return {
        from: today.startOf("isoWeek").format("YYYY-MM-DD HH:mm:ss.SSS"),
        to: today.endOf("isoWeek").format("YYYY-MM-DD HH:mm:ss.SSS"),
      };
    case "last_30_days": {
      const from = today.subtract(29, "day");
      return {
        from: from.startOf("day").format("YYYY-MM-DD HH:mm:ss.SSS"),
        to: today.endOf("day").format("YYYY-MM-DD HH:mm:ss.SSS"),
      };
    }
    case "last_30_months": {
      const from = today.subtract(29, "month");
      return {
        from: from.startOf("month").format("YYYY-MM-DD HH:mm:ss.SSS"),
        to: today.endOf("day").format("YYYY-MM-DD HH:mm:ss.SSS"),
      };
    }
    case "last_month": {
      const base = today.subtract(1, "month");
      return {
        from: base.startOf("month").format("YYYY-MM-DD HH:mm:ss.SSS"),
        to: base.endOf("month").format("YYYY-MM-DD HH:mm:ss.SSS"),
      };
    }
    case "this_year":
      return {
        from: today.startOf("year").format("YYYY-MM-DD HH:mm:ss.SSS"),
        to: today.endOf("year").format("YYYY-MM-DD HH:mm:ss.SSS"),
      };
    case "this_quarter": {
      const quarterStart = getQuarterStart(today);
      return {
        from: quarterStart.format("YYYY-MM-DD HH:mm:ss.SSS"),
        to: getQuarterEnd(quarterStart).format("YYYY-MM-DD HH:mm:ss.SSS"),
      };
    }
    case "last_quarter": {
      const quarterStart = getQuarterStart(today).subtract(3, "month");
      return {
        from: quarterStart.format("YYYY-MM-DD HH:mm:ss.SSS"),
        to: getQuarterEnd(quarterStart).format("YYYY-MM-DD HH:mm:ss.SSS"),
      };
    }
    case "this_month":
    default:
      return {
        from: today.startOf("month").format("YYYY-MM-DD HH:mm:ss.SSS"),
        to: today.endOf("day").format("YYYY-MM-DD HH:mm:ss.SSS"),
      };
  }
};

const formatSpotlightRangeLabel = (preset: DashboardPreviewPeriodPreset): string => {
  const range = computeSpotlightPresetRange(preset);
  const fromLabel = dayjs(range.from).format("MMM D, YYYY");
  const toLabel = dayjs(range.to).format("MMM D, YYYY");
  return `${fromLabel} - ${toLabel}`;
};

const formatDateRangeLabel = (range?: { from?: string; to?: string } | null): string | null => {
  const from = range?.from;
  const to = range?.to;
  if (!from || !to) {
    return null;
  }
  const fromLabel = dayjs(from);
  const toLabel = dayjs(to);
  if (!fromLabel.isValid() || !toLabel.isValid()) {
    return null;
  }
  return `${fromLabel.format("MMM D, YYYY")} - ${toLabel.format("MMM D, YYYY")}`;
};

const extractFilterRange = (filters: DashboardVisualCardViewConfig["queryConfig"] extends infer T
  ? T extends { filters?: infer F }
    ? F
    : undefined
  : undefined,
  modelId?: string,
  fieldId?: string,
): { from: string; to: string } | null => {
  if (!filters || !modelId || !fieldId) {
    return null;
  }
  const match = filters.find((filter) => filter.modelId === modelId && filter.fieldId === fieldId);
  if (!match || match.operator !== "between") {
    return null;
  }
  const value = match.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const from = typeof value.from === "string" ? value.from : null;
    const to = typeof value.to === "string" ? value.to : null;
    if (from && to) {
      return { from, to };
    }
  }
  return null;
};

const resolveVisualDateRangeLabel = (config: DashboardVisualCardViewConfig): string | null => {
  const filterRange = extractFilterRange(
    config.queryConfig?.filters,
    config.dateFilter?.modelId,
    config.dateFilter?.fieldId,
  );
  if (filterRange) {
    return formatDateRangeLabel(filterRange);
  }
  return formatDateRangeLabel(config.queryConfig?.time?.range ?? null);
};

const resolveDateFilterLabel = (
  config: DashboardVisualCardViewConfig | DashboardSpotlightCardViewConfig,
): string | null => {
  const sanitizeLabel = (value: string) => value.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const fallback = config.dateFilter ? `${config.dateFilter.modelId}.${config.dateFilter.fieldId}` : null;
  const options = Array.isArray(config.dateFilterOptions) ? config.dateFilterOptions : [];
  if (config.dateFilter) {
    const match = options.find(
      (option) =>
        option.modelId === config.dateFilter?.modelId &&
        option.fieldId === config.dateFilter?.fieldId &&
        option.operator === config.dateFilter?.operator,
    );
    return match?.label ? sanitizeLabel(match.label) : fallback;
  }
  if (options.length > 0) {
    const option = options[0];
    if (option.label) {
      return sanitizeLabel(option.label);
    }
    return `${option.modelId}.${option.fieldId}`;
  }
  return fallback;
};

const isSpotlightCardViewConfig = (
  config: DashboardCardViewConfig | null | undefined,
): config is DashboardSpotlightCardViewConfig =>
  Boolean(
    config && config.mode === "spotlight" && typeof (config as DashboardSpotlightCardViewConfig).spotlight === "object",
  );

const isVisualCardViewConfig = (
  config: DashboardCardViewConfig | null | undefined,
): config is DashboardVisualCardViewConfig =>
  Boolean(config && config.mode === "visual" && typeof (config as DashboardVisualCardViewConfig).visual === "object");

const extractLayoutConfig = (
  layout: Record<string, unknown> | undefined | null,
): Partial<Record<LayoutMode, DashboardCardLayout>> => {
  if (!layout || typeof layout !== "object") {
    return {};
  }
  const source = layout as Record<string, unknown>;
  const hasDesktop = Object.prototype.hasOwnProperty.call(source, "desktop") && typeof source.desktop === "object";
  const hasMobile = Object.prototype.hasOwnProperty.call(source, "mobile") && typeof source.mobile === "object";
  if (hasDesktop || hasMobile) {
    return {
      ...(hasDesktop
        ? { desktop: parseLayoutSource(source.desktop as Record<string, unknown>, DEFAULT_CARD_LAYOUT, LAYOUT_EDITOR_COLUMN_COUNT_DESKTOP) }
        : {}),
      ...(hasMobile
        ? { mobile: parseLayoutSource(source.mobile as Record<string, unknown>, DEFAULT_MOBILE_LAYOUT, LAYOUT_EDITOR_COLUMN_COUNT_MOBILE) }
        : {}),
    };
  }
  if (["x", "y", "w", "h"].some((key) => Object.prototype.hasOwnProperty.call(source, key))) {
    return {
      desktop: parseLayoutSource(source, DEFAULT_CARD_LAYOUT, LAYOUT_EDITOR_COLUMN_COUNT_DESKTOP),
    };
  }
  return {};
};

const updateLayoutConfig = (
  layout: Record<string, unknown> | undefined | null,
  mode: LayoutMode,
  next: DashboardCardLayout,
): Partial<Record<LayoutMode, DashboardCardLayout>> => {
  const current = extractLayoutConfig(layout);
  return {
    ...current,
    [mode]: normalizeLayoutForMode(next, mode),
  };
};

const layoutsAreEqual = (a: DashboardCardLayout, b: DashboardCardLayout): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const downloadDashboardExport = (payload: DashboardExportResponse, filename: string) => {
  const blob = new Blob([JSON.stringify(payload.export, null, 2)], {
    type: payload.export.format ?? "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const getViewConfigDescription = (viewConfig: Record<string, unknown> | undefined | null): string => {
  if (!viewConfig || typeof viewConfig !== "object") {
    return "";
  }
  const candidate = (viewConfig as { description?: unknown }).description;
  return typeof candidate === "string" ? candidate : "";
};

const useTemplateLookup = (templates: ReportTemplateDto[]) => {
  return useMemo(() => {
    const map = new Map<string, ReportTemplateDto>();
    templates.forEach((template) => {
      if (template.id) {
        map.set(template.id, template);
      }
    });
    return map;
  }, [templates]);
};

const DashboardCardSummary = ({
  card,
  template,
}: {
  card: DashboardCardDto;
  template: ReportTemplateDto | undefined;
}) => {
  const layout = parseLayout(card.layout, "desktop");
  const description = getViewConfigDescription(card.viewConfig);
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text fw={600}>{card.title}</Text>
        <Badge variant="light" color="blue">
          {layout.w}×{layout.h}
        </Badge>
      </Group>
      <Text fz="xs" c="dimmed">
        Position ({layout.x}, {layout.y})
      </Text>
      {description.length > 0 && (
        <Text fz="xs">{description}</Text>
      )}
    </Stack>
  );
};

const DashboardCardList = ({
  cards,
  templateLookup,
  onEdit,
  onRemove,
}: {
  cards: DashboardCardDto[];
  templateLookup: Map<string, ReportTemplateDto>;
  onEdit: (card: DashboardCardDto) => void;
  onRemove: (card: DashboardCardDto) => void;
}) => {
  if (cards.length === 0) {
    return (
      <Paper withBorder radius="md" p="lg">
        <Stack gap="xs" align="center">
          <IconLayoutGrid size={32} stroke={1.5} />
          <Text c="dimmed">No cards yet. Add a card to start building the dashboard.</Text>
        </Stack>
      </Paper>
    );
  }

  return (
    <Stack gap="sm">
      {cards.map((card) => {
        const template = templateLookup.get(card.templateId);
        return (
          <Card key={card.id} withBorder radius="md" padding="md" shadow="sm">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{card.title}</Text>
                <Group gap="xs">
                  <Button variant="light" size="xs" onClick={() => onEdit(card)}>
                    Edit
                  </Button>
                  <ActionIcon variant="subtle" color="red" onClick={() => onRemove(card)} aria-label="Remove card">
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Group>
              <DashboardCardSummary card={card} template={template} />
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
};

const DashboardLayoutEditor = ({
  cards,
  templateLookup,
  onLayoutCommit,
  onUpdateCardViewConfig,
  layoutMode,
}: {
  cards: DashboardCardDto[];
  templateLookup: Map<string, ReportTemplateDto>;
  onLayoutCommit: (layout: DashboardGridItem[], mode: LayoutMode) => void;
  onUpdateCardViewConfig: (
    cardId: string,
    updater: (config: DashboardCardViewConfig) => DashboardCardViewConfig,
  ) => void;
  layoutMode: LayoutMode;
}) => {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridInstanceRef = useRef<GridStack | null>(null);
  const layoutCommitRef = useRef(onLayoutCommit);
  const isSyncingRef = useRef(false);
  const lastMinRowRef = useRef<number | null>(null);
  const columnCount = LAYOUT_EDITOR_COLUMN_COUNT_BY_MODE[layoutMode];
  const layoutEntries = useMemo(
    () =>
      cards.map((card) => ({
        card,
        layout: parseLayout(card.layout, layoutMode),
        hasStoredLayout: hasLayoutForMode(card.layout, layoutMode),
      })),
    [cards, layoutMode],
  );
  const layoutById = useMemo(() => {
    const map = new Map<string, DashboardCardLayout>();
    layoutEntries.forEach(({ card, layout, hasStoredLayout }) => {
      if (hasStoredLayout) {
        map.set(card.id, layout);
      }
    });
    return map;
  }, [layoutEntries]);
  const [dateFieldSelections, setDateFieldSelections] = useState<Record<string, string>>({});
  useEffect(() => {
    setDateFieldSelections((current) => {
      const next: Record<string, string> = { ...current };
      const validIds = new Set<string>();
      layoutEntries.forEach(({ card }) => {
        const viewConfig = (card.viewConfig as DashboardCardViewConfig) ?? null;
        if (!viewConfig || typeof viewConfig !== "object") {
          return;
        }
        if (!isSpotlightCardViewConfig(viewConfig) && !isVisualCardViewConfig(viewConfig)) {
          return;
        }
        const options = resolveDashboardDateFilterOptions(viewConfig);
        if (options.length === 0) {
          return;
        }
        validIds.add(card.id);
        const selectedIds = resolveSelectedDateFilterIds(viewConfig, options);
        const existing = current[card.id];
        if (!existing || !selectedIds.includes(existing)) {
          const fallback = selectedIds[0] ?? options[0]?.id;
          if (fallback) {
            next[card.id] = fallback;
          }
        }
      });
      Object.keys(next).forEach((cardId) => {
        if (!validIds.has(cardId)) {
          delete next[cardId];
        }
      });
      return next;
    });
  }, [layoutEntries]);
  const handleDateFieldSelection = useCallback((cardId: string, dateFieldId: string) => {
    setDateFieldSelections((current) => ({
      ...current,
      [cardId]: dateFieldId,
    }));
  }, []);
  const handleToggleDateFieldSelection = useCallback(
    (cardId: string, dateFieldId: string) => {
      onUpdateCardViewConfig(cardId, (currentViewConfig) => {
        if (!isSpotlightCardViewConfig(currentViewConfig) && !isVisualCardViewConfig(currentViewConfig)) {
          return currentViewConfig;
        }
        const options = resolveDashboardDateFilterOptions(currentViewConfig);
        if (options.length === 0) {
          return currentViewConfig;
        }
        const selectedIds = resolveSelectedDateFilterIds(currentViewConfig, options);
        const isSelected = selectedIds.includes(dateFieldId);
        const nextIds = isSelected
          ? selectedIds.filter((id) => id !== dateFieldId)
          : [...selectedIds, dateFieldId];
        const orderedIds = options.map((option) => option.id).filter((id) => nextIds.includes(id));
        const safeIds =
          orderedIds.length > 0
            ? orderedIds
            : selectedIds.length > 0
              ? selectedIds
              : options.length > 0
                ? [options[0].id]
                : [];
        return {
          ...currentViewConfig,
          dateFilterSelections: safeIds,
        };
      });
    },
    [onUpdateCardViewConfig],
  );

  const updateGridMinRows = useCallback(() => {
    const container = gridRef.current;
    const grid = gridInstanceRef.current;
    if (!container || !grid) {
      return;
    }
    const baseHeight = container.parentElement?.getBoundingClientRect().height ?? container.clientHeight;
    if (!baseHeight) {
      return;
    }
    const cellHeight = resolveNumericValue(grid.opts.cellHeight);
    if (!cellHeight || cellHeight <= 0) {
      return;
    }
    const safeHeight = Math.max(0, baseHeight - 1);
    const nextMinRow = Math.max(1, Math.floor(safeHeight / cellHeight));
    if (lastMinRowRef.current === nextMinRow) {
      return;
    }
    lastMinRowRef.current = nextMinRow;
    grid.opts.minRow = nextMinRow;
    grid.opts.maxRow = nextMinRow;
    if (grid.engine) {
      grid.engine.maxRow = nextMinRow;
    }
    const gridWithUpdate = grid as GridStack & { _updateContainerHeight?: () => void };
    gridWithUpdate._updateContainerHeight?.();
  }, []);

  useEffect(() => {
    layoutCommitRef.current = onLayoutCommit;
  }, [onLayoutCommit]);

  useEffect(() => {
    const container = gridRef.current;
    if (!container) {
      return;
    }
    let grid = gridInstanceRef.current;
    if (grid) {
      grid.destroy(false);
      gridInstanceRef.current = null;
    }
    grid = GridStack.init(
      {
        column: columnCount,
        cellHeight: LAYOUT_EDITOR_CELL_HEIGHT,
        margin: "0px 0px",
        float: true,
        disableOneColumnMode: true,
        draggable: {
          handle: ".grid-stack-item-content",
        },
        resizable: {
          handles: "all",
          autoHide: true,
        },
      },
      container,
    );
    const handleChange = () => {
      if (isSyncingRef.current) {
        return;
      }
      const nodes = grid?.engine?.nodes ?? [];
      const nextLayout = nodes
        .map((node) => ({
          id: String(node.id ?? node.el?.getAttribute("gs-id") ?? node.el?.getAttribute("data-gs-id") ?? ""),
          x: node.x ?? 0,
          y: node.y ?? 0,
          w: node.w ?? 1,
          h: node.h ?? 1,
        }))
        .filter((node) => node.id.length > 0);
      if (nextLayout.length > 0) {
        layoutCommitRef.current(nextLayout, layoutMode);
      }
    };
    grid.on("change", handleChange);
    gridInstanceRef.current = grid;
    updateGridMinRows();
    requestAnimationFrame(() => updateGridMinRows());
    const activeGrid = grid;
    return () => {
      activeGrid.off("change");
      activeGrid.destroy(false);
      gridInstanceRef.current = null;
    };
  }, [columnCount, layoutMode, updateGridMinRows]);

  useEffect(() => {
    const container = gridRef.current;
    const grid = gridInstanceRef.current;
    if (!container || !grid) {
      return;
    }
    isSyncingRef.current = true;
    grid.batchUpdate();
    grid.removeAll(false);
    container.querySelectorAll<HTMLElement>(".grid-stack-item").forEach((element) => {
      const cardId = element.getAttribute("gs-id") ?? element.getAttribute("data-gs-id");
      const layout = cardId ? layoutById.get(String(cardId)) : null;
      if (cardId && layout) {
        grid.makeWidget(element, {
          x: layout.x,
          y: layout.y,
          w: layout.w,
          h: layout.h,
          id: cardId,
        });
        return;
      }
      grid.makeWidget(element);
    });
    grid.batchUpdate(false);
    isSyncingRef.current = false;
    updateGridMinRows();
    requestAnimationFrame(() => updateGridMinRows());
  }, [layoutById, layoutEntries, updateGridMinRows]);

  useEffect(() => {
    const container = gridRef.current;
    if (!container) {
      return;
    }
    const observedElement = container.parentElement ?? container;
    let resizeObserver: ResizeObserver | null = null;
    const handleResize = () => updateGridMinRows();

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => updateGridMinRows());
      resizeObserver.observe(observedElement);
    } else {
      window.addEventListener("resize", handleResize);
    }
    updateGridMinRows();
    requestAnimationFrame(() => updateGridMinRows());

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener("resize", handleResize);
      }
    };
  }, [updateGridMinRows]);

  return (
    <Box
      ref={gridRef}
      className="dashboard-layout-grid grid-stack"
      style={{
        width: "100%",
        height: "100%",
        minHeight: "100%",
        borderRadius: 14,
        border: "1px dashed rgba(15, 23, 42, 0.18)",
        backgroundColor: "#f5f7fb",
        backgroundImage:
          "linear-gradient(0deg, rgba(15, 23, 42, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 23, 42, 0.06) 1px, transparent 1px)",
        backgroundSize: `${LAYOUT_EDITOR_GRID_SIZE}px ${LAYOUT_EDITOR_GRID_SIZE}px`,
        overflow: "hidden",
      }}
    >
      <style>{DASHBOARD_EDITOR_GRID_CSS}</style>
      {layoutEntries.map(({ card, layout, hasStoredLayout }) => {
        const viewConfig = (card.viewConfig as DashboardCardViewConfig) ?? null;
        let content = (
          <div
            style={{
              height: "100%",
              width: "100%",
              borderRadius: 14,
              border: "1px solid rgba(15, 23, 42, 0.12)",
              background: "linear-gradient(180deg, #ffffff 0%, #f6f7f9 100%)",
              boxShadow: "0 12px 24px rgba(15, 23, 42, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 12,
            }}
          >
            <Text size="xs" c="dimmed" ta="center">
              Configure this card in Reports to preview it here.
            </Text>
          </div>
        );

        if (isSpotlightCardViewConfig(viewConfig)) {
          const spotlightConfig = viewConfig;
          const defaultPreset = spotlightConfig?.periodConfig?.defaultPreset ?? null;
          const defaultLabel = defaultPreset ? SPOTLIGHT_PERIOD_LABELS[defaultPreset] : null;
          const dateFieldOptions = resolveDashboardDateFilterOptions(spotlightConfig);
          const selectedDateFieldIds = resolveSelectedDateFilterIds(spotlightConfig, dateFieldOptions);
          const selectedDateFieldOptions = dateFieldOptions.filter((option) =>
            selectedDateFieldIds.includes(option.id),
          );
          const activeDateFieldId =
            dateFieldSelections[card.id] ??
            selectedDateFieldIds[0] ??
            dateFieldOptions[0]?.id;
          const activeDateField = dateFieldOptions.find((option) => option.id === activeDateFieldId) ?? null;
          const dateFieldLabel = activeDateField?.label ?? resolveDateFilterLabel(spotlightConfig);
          const dateFieldMenuOptions = dateFieldOptions.map((option) => ({
            value: option.id,
            label: option.label,
          }));
          const rangeLabel = defaultPreset ? formatSpotlightRangeLabel(defaultPreset) : null;
          const infoLabel = dateFieldLabel && rangeLabel ? `${dateFieldLabel}\n${rangeLabel}` : rangeLabel;
          const sampleCard = spotlightConfig?.sample?.cards?.[0];
          const metricLabel = sampleCard?.label ?? spotlightConfig?.spotlight?.metricLabel ?? "Metric";
          const metricValue = sampleCard?.value ?? "-";
          const periodPresets = spotlightConfig?.periodConfig?.presets ?? [];
          const allowCustom = Boolean(spotlightConfig?.periodConfig?.allowCustom);
          const showPeriodControls = periodPresets.length > 0;
          const periodOptions = showPeriodControls
            ? [
                ...periodPresets.map((preset) => ({
                  value: preset,
                  label: SPOTLIGHT_PERIOD_LABELS[preset],
                })),
                ...(allowCustom ? [{ value: "custom", label: "Custom" }] : []),
              ]
            : [];
          const periodRows =
            showPeriodControls && selectedDateFieldOptions.length > 0
              ? selectedDateFieldOptions.map((option) => ({
                  label: defaultLabel ?? "",
                  options: periodOptions,
                  activeValue: defaultPreset ?? undefined,
                  dateFieldLabel: option.label,
                  dateFieldOptions: dateFieldMenuOptions,
                  activeDateField: activeDateField?.id,
                  selectedDateFieldIds,
                  onToggleDateField: (value: string) => handleToggleDateFieldSelection(card.id, value),
                }))
              : undefined;
          content = (
            <SpotlightCard
              title={card.title || "Untitled card"}
              metricLabel={metricLabel}
              metricValue={metricValue}
              periodRows={periodRows}
              periodLabel={defaultLabel ?? undefined}
              rangeLabel={infoLabel ?? undefined}
              dateFieldLabel={dateFieldLabel ?? undefined}
              dateFieldOptions={dateFieldMenuOptions}
              activeDateField={activeDateField?.id}
              onSelectDateField={(value) => handleDateFieldSelection(card.id, value)}
              periodOptions={periodOptions}
              activePeriod={defaultPreset ?? undefined}
            />
          );
        } else if (isVisualCardViewConfig(viewConfig)) {
          const periodConfig = viewConfig.periodConfig;
          const defaultPreset = periodConfig?.defaultPreset ?? null;
          const periodLabel = defaultPreset ? SPOTLIGHT_PERIOD_LABELS[defaultPreset] : null;
          const allowCustom = Boolean(periodConfig?.allowCustom);
          const periodOptions =
            periodConfig?.presets && periodConfig.presets.length > 0
              ? [
                  ...periodConfig.presets.map((preset) => ({
                    value: preset,
                    label: SPOTLIGHT_PERIOD_LABELS[preset],
                  })),
                  ...(allowCustom ? [{ value: "custom", label: "Custom" }] : []),
                ]
              : [];
          const dateFieldOptions = resolveDashboardDateFilterOptions(viewConfig);
          const selectedDateFieldIds = resolveSelectedDateFilterIds(viewConfig, dateFieldOptions);
          const selectedDateFieldOptions = dateFieldOptions.filter((option) =>
            selectedDateFieldIds.includes(option.id),
          );
          const activeDateFieldId =
            dateFieldSelections[card.id] ??
            selectedDateFieldIds[0] ??
            dateFieldOptions[0]?.id;
          const activeDateField = dateFieldOptions.find((option) => option.id === activeDateFieldId) ?? null;
          const dateFieldLabel = activeDateField?.label ?? resolveDateFilterLabel(viewConfig);
          const dateFieldMenuOptions = dateFieldOptions.map((option) => ({
            value: option.id,
            label: option.label,
          }));
          const rangeLabel = defaultPreset
            ? formatSpotlightRangeLabel(defaultPreset)
            : resolveVisualDateRangeLabel(viewConfig);
          const infoLabel = dateFieldLabel && rangeLabel ? `${dateFieldLabel}\n${rangeLabel}` : rangeLabel;
          const periodRows =
            periodLabel && selectedDateFieldOptions.length > 0
              ? selectedDateFieldOptions.map((option) => ({
                  label: periodLabel ?? "",
                  options: periodOptions,
                  activeValue: defaultPreset ?? undefined,
                  dateFieldLabel: option.label,
                  dateFieldOptions: dateFieldMenuOptions,
                  activeDateField: activeDateField?.id,
                  selectedDateFieldIds,
                  onToggleDateField: (value: string) => handleToggleDateFieldSelection(card.id, value),
                }))
              : undefined;
          content = (
            <GraphicCard
              title={card.title || "Untitled card"}
              config={viewConfig}
              rows={viewConfig.sample?.rows ?? []}
              infoLabel={infoLabel ?? "Date range not set"}
              periodRows={periodRows}
              dateFieldLabel={dateFieldLabel ?? undefined}
              dateFieldOptions={dateFieldMenuOptions}
              activeDateField={activeDateField?.id}
              onSelectDateField={(value) => handleDateFieldSelection(card.id, value)}
              periodLabel={periodLabel ?? undefined}
              periodOptions={periodOptions}
              activePeriod={defaultPreset ?? undefined}
            />
          );
        }

        return (
          <div
            key={card.id}
            className="grid-stack-item"
            data-gs-id={card.id}
            data-gs-x={hasStoredLayout ? layout.x : undefined}
            data-gs-y={hasStoredLayout ? layout.y : undefined}
            data-gs-w={layout.w}
            data-gs-h={layout.h}
            data-gs-width={layout.w}
            data-gs-height={layout.h}
            data-gs-auto-position={hasStoredLayout ? undefined : "true"}
          >
            <div className="grid-stack-item-content dashboard-layout-card">{content}</div>
          </div>
        );
      })}
    </Box>
  );
};

const DEFAULT_VIEW_CONFIG: Record<string, unknown> = {
  mode: "template-default",
};

const createCardDraftFromTemplate = (template: ReportTemplateDto | undefined): CardDraft => {
  const title = template?.name ?? "Dashboard card";
  const viewConfig =
    template?.queryConfig !== null && template?.queryConfig !== undefined
      ? { ...DEFAULT_VIEW_CONFIG, queryConfig: deepClone(template.queryConfig) }
      : { ...DEFAULT_VIEW_CONFIG };
  return {
    templateId: template?.id ?? "",
    title,
    viewConfig,
    layout: { ...DEFAULT_CARD_LAYOUT },
  };
};

const createCardDraftFromCard = (card: DashboardCardDto): CardDraft => ({
  id: card.id,
  templateId: card.templateId,
  title: card.title,
  viewConfig: deepClone(card.viewConfig ?? DEFAULT_VIEW_CONFIG),
  layout: parseLayout(card.layout, "desktop"),
});

const ReportDashboards = ({ title }: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const layoutEditorHeaderHeight = isMobile ? 56 : 68;
  const layoutEditorPaddingX = isMobile ? 16 : 24;
  const layoutEditorPaddingY = isMobile ? 12 : 20;
  const layoutEditorGridPaddingX = isMobile ? 8 : 12;
  const layoutEditorGridPaddingY = isMobile ? 8 : 12;

  useEffect(() => {
    dispatch(navigateToPage(title ?? "Report dashboards"));
  }, [dispatch, title]);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 250);
  const dashboardsQuery = useReportDashboards({ search: debouncedSearch.trim() });
  const templatesQuery = useReportTemplates();

  const dashboards = useMemo(
    () => dashboardsQuery.data?.dashboards ?? [],
    [dashboardsQuery.data?.dashboards],
  );
  const templates = useMemo(
    () => templatesQuery.data?.templates ?? [],
    [templatesQuery.data?.templates],
  );
  const templateLookup = useTemplateLookup(templates);
  const templateOptions = useMemo(
    () =>
      templates.map((template) => ({
        value: template.id,
        label: template.name ?? "Untitled template",
      })),
    [templates],
  );

  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(null);
  const [dashboardDraft, setDashboardDraft] = useState<ReportDashboardDto | null>(null);
  const [cardModalOpen, setCardModalOpen] = useState(false);
  const [cardDraft, setCardDraft] = useState<CardDraft | null>(null);
  const [cardMode, setCardMode] = useState<"create" | "edit">("create");
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [layoutEditorMode, setLayoutEditorMode] = useState<LayoutMode>("desktop");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [pendingLayoutChanges, setPendingLayoutChanges] = useState<
    Record<string, Partial<Record<LayoutMode, DashboardCardLayout>>>
  >({});
  const [pendingCardConfigChanges, setPendingCardConfigChanges] = useState<Record<string, true>>({});
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const selectedCardTemplate = useMemo(
    () => (cardDraft ? templateLookup.get(cardDraft.templateId) ?? null : null),
    [cardDraft, templateLookup],
  );
  const templateDateFilters = useMemo(
    () => getTemplateDateFilters(selectedCardTemplate),
    [selectedCardTemplate],
  );
  const templateDateFilterMetadata = useMemo(() => {
    const map = new Map<string, { modelId: string; fieldId: string; operator: FilterOperator }>();
    templateDateFilters.forEach((filter) => {
      map.set(filter.id, {
        modelId: filter.modelId,
        fieldId: filter.fieldId,
        operator: filter.operator,
      });
    });
    return map;
  }, [templateDateFilters]);
  const templateDateFilterOptions = useMemo(
    () =>
      templateDateFilters.map((filter) => ({
        value: filter.id,
        label: `${filter.modelId}.${filter.fieldId} (${filter.operator})`,
      })),
    [templateDateFilters],
  );
  const templateDateFilterLabelById = useMemo(
    () => new Map(templateDateFilterOptions.map((option) => [option.value, option.label])),
    [templateDateFilterOptions],
  );
  const visualDashboardConfig = useMemo(() => {
    if (!cardDraft) {
      return null;
    }
    const viewConfig = cardDraft.viewConfig as DashboardCardViewConfig;
    return isVisualCardViewConfig(viewConfig) ? viewConfig : null;
  }, [cardDraft]);
  const spotlightDashboardConfig = useMemo(() => {
    if (!cardDraft) {
      return null;
    }
    const viewConfig = cardDraft.viewConfig as DashboardCardViewConfig;
    return isSpotlightCardViewConfig(viewConfig) ? viewConfig : null;
  }, [cardDraft]);
  const selectedVisualDateFilterId = useMemo(
    () =>
      visualDashboardConfig ? findMatchingDateFilterId(visualDashboardConfig.dateFilter, templateDateFilterMetadata) : null,
    [templateDateFilterMetadata, visualDashboardConfig],
  );
  const selectedSpotlightDateFilterId = useMemo(
    () =>
      spotlightDashboardConfig
        ? findMatchingDateFilterId(spotlightDashboardConfig.dateFilter, templateDateFilterMetadata)
        : null,
    [spotlightDashboardConfig, templateDateFilterMetadata],
  );

  const updateVisualCardDraft = useCallback(
    (updater: (current: DashboardVisualCardViewConfig) => DashboardVisualCardViewConfig) => {
      setCardDraft((current) => {
        if (!current) {
          return current;
        }
        const viewConfig = current.viewConfig as DashboardCardViewConfig;
        if (!isVisualCardViewConfig(viewConfig)) {
          return current;
        }
        return {
          ...current,
          viewConfig: updater(viewConfig),
        };
      });
    },
    [],
  );

  const updateSpotlightCardDraft = useCallback(
    (updater: (current: DashboardSpotlightCardViewConfig) => DashboardSpotlightCardViewConfig) => {
      setCardDraft((current) => {
        if (!current) {
          return current;
        }
        const viewConfig = current.viewConfig as DashboardCardViewConfig;
        if (!isSpotlightCardViewConfig(viewConfig)) {
          return current;
        }
        return {
          ...current,
          viewConfig: updater(viewConfig),
        };
      });
    },
    [],
  );

  const resolveAllowedDateFilterIds = useCallback(
    (
      config: DashboardVisualCardViewConfig | DashboardSpotlightCardViewConfig,
      allIds: string[],
      defaultId: string | null,
    ): string[] => {
      if (Array.isArray(config.dateFilterOptions)) {
        const optionIds = config.dateFilterOptions
          .map((option) => option.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        if (optionIds.length > 0) {
          return optionIds;
        }
        if (defaultId) {
          return [defaultId];
        }
      }
      return allIds;
    },
    [],
  );

  const buildDateFilterOptionsFromIds = useCallback(
    (
      ids: string[],
      metadata: Map<string, { modelId: string; fieldId: string; operator: FilterOperator }>,
      labels: Map<string, string>,
    ) =>
      ids
        .map((id) => {
          const entry = metadata.get(id);
          if (!entry) {
            return null;
          }
          const label = labels.get(id);
          return {
            id,
            modelId: entry.modelId,
            fieldId: entry.fieldId,
            operator: entry.operator,
            ...(label ? { label } : {}),
          };
        })
        .filter(
          (entry): entry is {
            id: string;
            modelId: string;
            fieldId: string;
            operator: FilterOperator;
            label?: string;
          } => Boolean(entry),
        ),
    [],
  );

  const selectedVisualExtraDateFilterIds = useMemo(() => {
    if (!visualDashboardConfig) {
      return [];
    }
    const allIds = templateDateFilterOptions.map((option) => option.value);
    const allowedIds = resolveAllowedDateFilterIds(
      visualDashboardConfig,
      allIds,
      selectedVisualDateFilterId,
    );
    return allowedIds.filter((id) => id !== selectedVisualDateFilterId);
  }, [
    resolveAllowedDateFilterIds,
    selectedVisualDateFilterId,
    templateDateFilterOptions,
    visualDashboardConfig,
  ]);

  const selectedSpotlightExtraDateFilterIds = useMemo(() => {
    if (!spotlightDashboardConfig) {
      return [];
    }
    const allIds = templateDateFilterOptions.map((option) => option.value);
    const allowedIds = resolveAllowedDateFilterIds(
      spotlightDashboardConfig,
      allIds,
      selectedSpotlightDateFilterId,
    );
    return allowedIds.filter((id) => id !== selectedSpotlightDateFilterId);
  }, [
    resolveAllowedDateFilterIds,
    selectedSpotlightDateFilterId,
    spotlightDashboardConfig,
    templateDateFilterOptions,
  ]);

  useEffect(() => {
    if (!selectedDashboardId && dashboards.length > 0) {
      setSelectedDashboardId(dashboards[0].id);
    }
  }, [dashboards, selectedDashboardId]);

  const selectedDashboard = useMemo(
    () => dashboards.find((dashboard) => dashboard.id === selectedDashboardId) ?? null,
    [dashboards, selectedDashboardId],
  );

  useEffect(() => {
    if (selectedDashboard) {
      setDashboardDraft(deepClone(selectedDashboard));
    } else {
      setDashboardDraft(null);
    }
  }, [selectedDashboard]);

  useEffect(() => {
    setPendingLayoutChanges({});
    setPendingCardConfigChanges({});
  }, [selectedDashboardId]);

  const createDashboardMutation = useCreateDashboard();
  const updateDashboardMutation = useUpdateDashboard();
  const deleteDashboardMutation = useDeleteDashboard();
  const upsertCardMutation = useUpsertDashboardCard();
  const deleteCardMutation = useDeleteDashboardCard();
  const exportDashboardMutation = useExportDashboard();

  const handleCreateDashboard = async () => {
    setFeedback(null);
    try {
      const created = await createDashboardMutation.mutateAsync({
        name: "Untitled dashboard",
        description: "",
      });
      queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      setSelectedDashboardId(created.id);
      setFeedback({ type: "success", message: "Dashboard created." });
    } catch (error) {
      console.error("Failed to create dashboard", error);
      setFeedback({ type: "error", message: "Failed to create dashboard." });
    }
  };

  const handleSaveDashboard = async () => {
    if (!dashboardDraft) {
      return;
    }
    setFeedback(null);
    try {
      const payload = {
        name: dashboardDraft.name,
        description: dashboardDraft.description,
      };
      await updateDashboardMutation.mutateAsync({
        id: dashboardDraft.id,
        payload,
      });
      queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      setFeedback({ type: "success", message: "Dashboard updated." });
    } catch (error) {
      console.error("Failed to update dashboard", error);
      setFeedback({ type: "error", message: "Failed to update dashboard." });
    }
  };

  const handleDeleteDashboard = async () => {
    if (!dashboardDraft) {
      return;
    }
    if (!window.confirm("Delete this dashboard? This cannot be undone.")) {
      return;
    }
    setFeedback(null);
    try {
      await deleteDashboardMutation.mutateAsync(dashboardDraft.id);
      queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      setSelectedDashboardId(null);
      setFeedback({ type: "success", message: "Dashboard deleted." });
    } catch (error) {
      console.error("Failed to delete dashboard", error);
      setFeedback({ type: "error", message: "Failed to delete dashboard." });
    }
  };

  const handleOpenCreateCard = () => {
    if (!dashboardDraft) {
      return;
    }
    const template = templates[0];
    setCardDraft(createCardDraftFromTemplate(template));
    setCardMode("create");
    setCardModalOpen(true);
  };

  const handleOpenEditCard = (card: DashboardCardDto) => {
    setCardDraft(createCardDraftFromCard(card));
    setCardMode("edit");
    setCardModalOpen(true);
  };

  const handleRemoveCard = async (card: DashboardCardDto) => {
    if (!dashboardDraft) {
      return;
    }
    if (!window.confirm("Remove this card from the dashboard?")) {
      return;
    }
    setFeedback(null);
    try {
      await deleteCardMutation.mutateAsync({ dashboardId: dashboardDraft.id, cardId: card.id });
      queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      setFeedback({ type: "success", message: "Card removed." });
    } catch (error) {
      console.error("Failed to remove card", error);
      setFeedback({ type: "error", message: "Failed to remove card." });
    }
  };

  const handleLayoutCommit = (nextLayout: DashboardGridItem[], mode: LayoutMode) => {
    if (!dashboardDraft || nextLayout.length === 0) {
      return;
    }
    const normalized = new Map<string, DashboardCardLayout>();
    nextLayout.forEach((item) => {
      normalized.set(item.id, normalizeGridItem(item, mode));
    });

    setDashboardDraft((current) => {
      if (!current) {
        return current;
      }
      const nextCards = current.cards.map((card) => {
        const layout = normalized.get(card.id);
        if (!layout) {
          return card;
        }
        return {
          ...card,
          layout: updateLayoutConfig(card.layout, mode, layout),
        };
      });
      return { ...current, cards: nextCards };
    });

    setPendingLayoutChanges((current) => {
      const nextChanges = { ...current };
      normalized.forEach((layout, cardId) => {
        const baselineCard = selectedDashboard?.cards?.find((card) => card.id === cardId);
        const baselineLayout = baselineCard ? parseLayout(baselineCard.layout, mode) : layout;
        if (layoutsAreEqual(layout, baselineLayout)) {
          const existing = nextChanges[cardId];
          if (existing) {
            const { [mode]: _removed, ...rest } = existing;
            if (Object.keys(rest).length > 0) {
              nextChanges[cardId] = rest;
            } else {
              delete nextChanges[cardId];
            }
          }
        } else {
          nextChanges[cardId] = {
            ...(nextChanges[cardId] ?? {}),
            [mode]: layout,
          };
        }
      });
      return nextChanges;
    });
  };

  const handleUpdateCardViewConfig = useCallback(
    (cardId: string, updater: (config: DashboardCardViewConfig) => DashboardCardViewConfig) => {
      setDashboardDraft((current) => {
        if (!current) {
          return current;
        }
        const nextCards = current.cards.map((card) => {
          if (card.id !== cardId) {
            return card;
          }
          const viewConfig = (card.viewConfig as DashboardCardViewConfig) ?? null;
          if (!viewConfig || typeof viewConfig !== "object") {
            return card;
          }
          return {
            ...card,
            viewConfig: updater(viewConfig),
          };
        });
        return { ...current, cards: nextCards };
      });
      setPendingCardConfigChanges((current) => ({ ...current, [cardId]: true }));
    },
    [],
  );

  const handleSaveLayoutChanges = async () => {
    if (!dashboardDraft) {
      return;
    }
    const layoutEntries = Object.entries(pendingLayoutChanges);
    const pendingCardIds = new Set<string>([
      ...layoutEntries.map(([cardId]) => cardId),
      ...Object.keys(pendingCardConfigChanges),
    ]);
    if (pendingCardIds.size === 0) {
      return;
    }
    setIsSavingLayout(true);
    setFeedback(null);
    try {
      await Promise.all(
        Array.from(pendingCardIds).map((cardId) => {
          const card = dashboardDraft.cards.find((candidate) => candidate.id === cardId);
          if (!card) {
            return null;
          }
          return upsertCardMutation.mutateAsync({
            dashboardId: dashboardDraft.id,
            cardId,
            payload: {
              templateId: card.templateId,
              title: card.title,
              viewConfig: card.viewConfig as Record<string, unknown>,
              layout: card.layout,
            },
          });
        }),
      );
      setPendingLayoutChanges({});
      setPendingCardConfigChanges({});
      await queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      setFeedback({ type: "success", message: "Layout saved." });
    } catch (error) {
      console.error("Failed to save layout", error);
      setFeedback({ type: "error", message: "Failed to save layout." });
    } finally {
      setIsSavingLayout(false);
    }
  };

  const handleSaveCard = async () => {
    if (!dashboardDraft || !cardDraft) {
      return;
    }
    if (!cardDraft.templateId || cardDraft.templateId.trim().length === 0) {
      setFeedback({ type: "error", message: "Select a template for the card." });
      return;
    }
    if (!cardDraft.title || cardDraft.title.trim().length === 0) {
      setFeedback({ type: "error", message: "Card title is required." });
      return;
    }
    const existingLayout =
      cardMode === "edit"
        ? dashboardDraft?.cards.find((candidate) => candidate.id === cardDraft.id)?.layout ?? null
        : null;
    const layoutConfig = updateLayoutConfig(existingLayout, "desktop", cardDraft.layout);
    let viewConfig = deepClone(cardDraft.viewConfig) as DashboardCardViewConfig;
    if (isVisualCardViewConfig(viewConfig)) {
      if (viewConfig.dateFilter && (!viewConfig.dateFilterOptions || viewConfig.dateFilterOptions.length === 0)) {
        const allIds = templateDateFilterOptions.map((option) => option.value);
        const resolvedOptions = buildDateFilterOptionsFromIds(
          allIds,
          templateDateFilterMetadata,
          templateDateFilterLabelById,
        );
        if (resolvedOptions.length > 0) {
          viewConfig = {
            ...viewConfig,
            dateFilterOptions: resolvedOptions,
          };
        }
      }
    } else if (isSpotlightCardViewConfig(viewConfig)) {
      if (viewConfig.dateFilter && (!viewConfig.dateFilterOptions || viewConfig.dateFilterOptions.length === 0)) {
        const allIds = templateDateFilterOptions.map((option) => option.value);
        const resolvedOptions = buildDateFilterOptionsFromIds(
          allIds,
          templateDateFilterMetadata,
          templateDateFilterLabelById,
        );
        if (resolvedOptions.length > 0) {
          viewConfig = {
            ...viewConfig,
            dateFilterOptions: resolvedOptions,
          };
        }
      }
    }
    const payload: DashboardCardPayload = {
      templateId: cardDraft.templateId,
      title: cardDraft.title,
      viewConfig,
      layout: layoutConfig,
    };
    setFeedback(null);
    try {
      await upsertCardMutation.mutateAsync({
        dashboardId: dashboardDraft.id,
        cardId: cardMode === "edit" ? cardDraft.id : undefined,
        payload,
      });
      queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      setCardModalOpen(false);
      setCardDraft(null);
      setFeedback({ type: "success", message: "Card saved." });
    } catch (error) {
      console.error("Failed to save dashboard card", error);
      setFeedback({ type: "error", message: "Failed to save dashboard card." });
    }
  };

  const handleExportDashboard = async () => {
    if (!dashboardDraft) {
      return;
    }
    setFeedback(null);
    try {
      const result = await exportDashboardMutation.mutateAsync(dashboardDraft.id);
      const filename = `${dashboardDraft.name.replace(/[^a-z0-9-_]+/gi, "_") || "dashboard"}_${Date.now()}.json`;
      downloadDashboardExport(result, filename);
      setFeedback({ type: "success", message: "Dashboard export downloaded." });
    } catch (error) {
      console.error("Failed to export dashboard", error);
      setFeedback({ type: "error", message: "Failed to export dashboard." });
    }
  };

  const isBusy =
    dashboardsQuery.isLoading ||
    templatesQuery.isLoading ||
    createDashboardMutation.isPending ||
    updateDashboardMutation.isPending ||
    deleteDashboardMutation.isPending ||
    upsertCardMutation.isPending ||
    deleteCardMutation.isPending ||
    exportDashboardMutation.isPending;

  const pendingLayoutCount = new Set([
    ...Object.keys(pendingLayoutChanges),
    ...Object.keys(pendingCardConfigChanges),
  ]).size;

  const selectedDashboardCards = dashboardDraft?.cards ?? selectedDashboard?.cards ?? [];

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.reports}>
      <Box bg="#f4f6f8" p="xl" style={{ minHeight: "100vh" }}>
        <Stack gap="xl">
          <Group justify="space-between" align="flex-start">
            <Stack gap="xs">
              <Group gap="sm">
                <ActionIcon variant="light" aria-label="Back to report builder" onClick={() => navigate("/reports")}>
                  <IconArrowLeft size={18} />
                </ActionIcon>
                <Title order={2}>Dashboards workspace</Title>
              </Group>
              <Text c="dimmed">
                Curate dashboards composed of saved report templates. Configure card layouts, tailor presets, and export
                the configuration for distribution.
              </Text>
            </Stack>
            <Group gap="sm">
              <Button
                variant="light"
                leftSection={<IconLayoutGrid size={16} />}
                onClick={handleCreateDashboard}
                loading={createDashboardMutation.isPending}
              >
                New dashboard
              </Button>
              {dashboardDraft && (
                <Button
                  variant="light"
                  leftSection={<IconTableExport size={16} />}
                  onClick={handleExportDashboard}
                  loading={exportDashboardMutation.isPending}
                >
                  Export dashboard
                </Button>
              )}
              <Button
                leftSection={<IconDeviceFloppy size={16} />}
                onClick={handleSaveDashboard}
                disabled={!dashboardDraft}
                loading={updateDashboardMutation.isPending}
              >
                Save changes
              </Button>
            </Group>
          </Group>

          {feedback && (
            <Text c={feedback.type === "success" ? "teal" : "red"}>{feedback.message}</Text>
          )}

          <Flex gap="lg" align="flex-start" direction={{ base: "column", lg: "row" }}>
            <Stack gap="lg" style={{ width: 320, flexShrink: 0 }}>
              <Paper withBorder radius="lg" p="md" shadow="xs">
                <Stack gap="sm">
                  <TextInput
                    placeholder="Search dashboards"
                    value={search}
                    onChange={(event) => setSearch(event.currentTarget.value)}
                    leftSection={<IconSearch size={14} />}
                    size="sm"
                  />
                  <Divider my="xs" />
                  {dashboardsQuery.isLoading ? (
                    <Stack align="center" gap="xs">
                      <Loader size="sm" />
                      <Text c="dimmed" fz="sm">
                        Loading dashboards...
                      </Text>
                    </Stack>
                  ) : dashboards.length === 0 ? (
                    <Text c="dimmed" fz="sm">
                      No dashboards found. Create one to get started.
                    </Text>
                  ) : (
                    <ScrollArea h={420} type="always" offsetScrollbars>
                      <Stack gap="sm">
                        {dashboards.map((dashboard) => {
                          const isActive = dashboard.id === selectedDashboardId;
                          return (
                            <Card
                              key={dashboard.id}
                              withBorder
                              padding="sm"
                              radius="md"
                              shadow={isActive ? "sm" : "xs"}
                              onClick={() => setSelectedDashboardId(dashboard.id)}
                              style={{ cursor: "pointer", borderColor: isActive ? "#1c7ed6" : undefined }}
                            >
                              <Stack gap={4}>
                                <Text fw={600}>{dashboard.name}</Text>
                                <Text fz="xs" c="dimmed">
                                  {dashboard.description ?? "No description"}
                                </Text>
                                <Group gap={6}>
                                  <Badge size="xs" variant="light">
                                    {dashboard.cards.length} cards
                                  </Badge>
                                  <Badge size="xs" variant="light" color="gray">
                                    {dashboard.updatedAt ? new Date(dashboard.updatedAt).toLocaleString() : "Draft"}
                                  </Badge>
                                </Group>
                              </Stack>
                            </Card>
                          );
                        })}
                      </Stack>
                    </ScrollArea>
                  )}
                </Stack>
              </Paper>
            </Stack>

            <Stack gap="lg" style={{ flex: 1, width: "100%" }}>
              <Paper withBorder radius="lg" p="lg" shadow="xs">
                {isBusy && !dashboardDraft && dashboards.length === 0 ? (
                  <Stack align="center" gap="xs">
                    <Loader size="sm" />
                    <Text c="dimmed" fz="sm">
                      Loading workspace...
                    </Text>
                  </Stack>
                ) : !dashboardDraft ? (
                  <Stack gap="sm" align="center">
                    <IconAdjustments size={36} stroke={1.5} />
                    <Text c="dimmed" fz="sm" ta="center">
                      Select a dashboard from the list or create a new one to configure cards and layout.
                    </Text>
                  </Stack>
                ) : (
                  <Stack gap="lg">
                    <Stack gap="xs">
                      <Group gap="sm">
                        <TextInput
                          label="Dashboard name"
                          value={dashboardDraft.name}
                          onChange={(event) =>
                            setDashboardDraft((current) =>
                              current ? { ...current, name: event.currentTarget.value } : current,
                            )
                          }
                          style={{ flex: 1 }}
                        />
                        <Button
                          variant="light"
                          color="red"
                          leftSection={<IconTrash size={16} />}
                          onClick={handleDeleteDashboard}
                          disabled={deleteDashboardMutation.isPending}
                        >
                          Delete
                        </Button>
                      </Group>
                      <Textarea
                        label="Description"
                        value={dashboardDraft.description ?? ""}
                        onChange={(event) =>
                          setDashboardDraft((current) =>
                            current ? { ...current, description: event.currentTarget.value } : current,
                          )
                        }
                        minRows={2}
                        placeholder="Summarize the purpose of this dashboard."
                      />
                    </Stack>

                    <Divider label="Cards" labelPosition="center" />

                    <Group justify="space-between" align="center">
                      <Text fw={600}>Dashboard cards</Text>
                      <Group gap="sm">
                        <Button
                          variant="light"
                          leftSection={<IconLayoutGrid size={16} />}
                          onClick={() => setLayoutEditorOpen(true)}
                        >
                          Open layout editor
                        </Button>
                        <Button
                          variant="light"
                          leftSection={<IconPlus size={16} />}
                          onClick={handleOpenCreateCard}
                          disabled={templates.length === 0}
                        >
                          Add card
                        </Button>
                      </Group>
                    </Group>

                    <DashboardCardList
                      cards={selectedDashboardCards}
                      templateLookup={templateLookup}
                      onEdit={handleOpenEditCard}
                      onRemove={handleRemoveCard}
                    />
                  </Stack>
                )}
              </Paper>
            </Stack>
          </Flex>
        </Stack>
      </Box>

      <Modal
        opened={cardModalOpen}
        onClose={() => setCardModalOpen(false)}
        title={cardMode === "create" ? "Add dashboard card" : "Edit dashboard card"}
        centered
        size="lg"
      >
        {cardDraft ? (
          <Stack gap="md">
            <Select
              label="Template"
              data={templateOptions}
              value={cardDraft.templateId || null}
              onChange={(value) => {
                const template = templateLookup.get(value ?? "");
                setCardDraft((current) => {
                  if (!current) {
                    return null;
                  }
                  const next = {
                    ...current,
                    templateId: value ?? "",
                  };
                  if (template && cardMode === "create") {
                    const fromTemplate = createCardDraftFromTemplate(template);
                    return {
                      ...next,
                      title: fromTemplate.title,
                      viewConfig: fromTemplate.viewConfig,
                      layout: fromTemplate.layout,
                    };
                  }
                  return next;
                });
              }}
              searchable
              placeholder={templates.length === 0 ? "No templates available" : "Select template"}
              disabled={templates.length === 0}
            />
            <TextInput
              label="Card title"
              value={cardDraft.title}
              onChange={(event) =>
                setCardDraft((current) => (current ? { ...current, title: event.currentTarget.value } : current))
              }
              placeholder="Display name for the card"
            />
            <Textarea
              label="Notes"
              value={getViewConfigDescription(cardDraft.viewConfig)}
              onChange={(event) =>
                setCardDraft((current) =>
                  current
                    ? {
                        ...current,
                        viewConfig: {
                          ...current.viewConfig,
                          description: event.currentTarget.value,
                        },
                      }
                    : current,
                )
              }
              minRows={2}
              placeholder="Optional context shown in the dashboard."
            />
            {visualDashboardConfig && (
              <Paper withBorder radius="md" p="md">
                <Stack gap="sm">
                  <Text fw={600} fz="sm">
                    Visual filters
                  </Text>
                  {templateDateFilterOptions.length === 0 ? (
                    <Text fz="sm" c="dimmed">
                      Add a date filter to the template to enable per-card period buttons.
                    </Text>
                  ) : (
                    <>
                      <Select
                        label="Date field"
                        data={templateDateFilterOptions}
                        value={selectedVisualDateFilterId}
                        placeholder="Select date field"
                        onChange={(value) => {
                          updateVisualCardDraft((current) => {
                            if (!value) {
                              const { dateFilter, dateFilterOptions, ...rest } = current;
                              return rest;
                            }
                            const metadata = templateDateFilterMetadata.get(value);
                            if (!metadata) {
                              return current;
                            }
                            const allIds = templateDateFilterOptions.map((option) => option.value);
                            const allowedIds = resolveAllowedDateFilterIds(
                              current,
                              allIds,
                              selectedVisualDateFilterId,
                            );
                            const nextIds = [value, ...allowedIds.filter((id) => id !== value)];
                            const nextOptions = buildDateFilterOptionsFromIds(
                              nextIds,
                              templateDateFilterMetadata,
                              templateDateFilterLabelById,
                            );
                            return {
                              ...current,
                              dateFilter: { ...metadata },
                              ...(nextOptions.length > 0 ? { dateFilterOptions: nextOptions } : {}),
                            };
                          });
                        }}
                      />
                      <MultiSelect
                        label="Extra date fields"
                        data={templateDateFilterOptions.filter(
                          (option) => option.value !== selectedVisualDateFilterId,
                        )}
                        value={selectedVisualExtraDateFilterIds}
                        onChange={(value) => {
                          updateVisualCardDraft((current) => {
                            const normalized = value.filter((entry) =>
                              templateDateFilterOptions.some((option) => option.value === entry),
                            );
                            const defaultId = selectedVisualDateFilterId;
                            const nextIds = defaultId
                              ? [defaultId, ...normalized.filter((id) => id !== defaultId)]
                              : normalized;
                            if (nextIds.length === 0) {
                              const { dateFilterOptions, ...rest } = current;
                              return rest;
                            }
                            const nextOptions = buildDateFilterOptionsFromIds(
                              nextIds,
                              templateDateFilterMetadata,
                              templateDateFilterLabelById,
                            );
                            return {
                              ...current,
                              ...(nextOptions.length > 0 ? { dateFilterOptions: nextOptions } : {}),
                            };
                          });
                        }}
                        searchable
                        disabled={!selectedVisualDateFilterId}
                      />
                      <MultiSelect
                        label="Quick filter buttons"
                        data={PERIOD_PRESET_OPTIONS}
                        value={visualDashboardConfig.periodConfig?.presets ?? []}
                        onChange={(value) => {
                          updateVisualCardDraft((current) => {
                            const normalized = value.filter((entry) =>
                              PERIOD_PRESET_OPTIONS.some((option) => option.value === entry),
                            ) as DashboardPreviewPeriodPreset[];
                            if (normalized.length === 0) {
                              const { periodConfig, ...rest } = current;
                              return rest;
                            }
                            const existingDefault = current.periodConfig?.defaultPreset;
                            const allowCustom = Boolean(current.periodConfig?.allowCustom);
                            const defaultPreset =
                              existingDefault && normalized.includes(existingDefault)
                                ? existingDefault
                                : normalized[0];
                            return {
                              ...current,
                              periodConfig: {
                                presets: normalized,
                                defaultPreset,
                                allowCustom,
                              },
                            };
                          });
                        }}
                        searchable
                        disabled={!selectedVisualDateFilterId}
                      />
                      <Select
                        label="Default period"
                        data={(visualDashboardConfig.periodConfig?.presets ?? []).map((preset) => ({
                          value: preset,
                          label: SPOTLIGHT_PERIOD_LABELS[preset],
                        }))}
                        value={visualDashboardConfig.periodConfig?.defaultPreset ?? null}
                        placeholder="Select default"
                        onChange={(value) => {
                          if (!value) {
                            return;
                          }
                          updateVisualCardDraft((current) => {
                            if (!current.periodConfig) {
                              return current;
                            }
                            return {
                              ...current,
                              periodConfig: {
                                ...current.periodConfig,
                                defaultPreset: value as DashboardPreviewPeriodPreset,
                              },
                            };
                          });
                        }}
                        disabled={!selectedVisualDateFilterId || !visualDashboardConfig.periodConfig}
                      />
                      <Switch
                        label="Allow custom range"
                        checked={Boolean(visualDashboardConfig.periodConfig?.allowCustom)}
                        onChange={(event) => {
                          const allowCustom = event.currentTarget.checked;
                          updateVisualCardDraft((current) => {
                            if (!current.periodConfig) {
                              return current;
                            }
                            return {
                              ...current,
                              periodConfig: {
                                ...current.periodConfig,
                                allowCustom,
                              },
                            };
                          });
                        }}
                        disabled={!selectedVisualDateFilterId || !visualDashboardConfig.periodConfig}
                      />
                    </>
                  )}
                </Stack>
              </Paper>
            )}
            {spotlightDashboardConfig && (
              <Paper withBorder radius="md" p="md">
                <Stack gap="sm">
                  <Text fw={600} fz="sm">
                    Spotlight filters
                  </Text>
                  {templateDateFilterOptions.length === 0 ? (
                    <Text fz="sm" c="dimmed">
                      Add a date filter to the template to enable per-card period buttons.
                    </Text>
                  ) : (
                    <>
                      <Select
                        label="Date field"
                        data={templateDateFilterOptions}
                        value={selectedSpotlightDateFilterId}
                        placeholder="Select date field"
                        onChange={(value) => {
                          updateSpotlightCardDraft((current) => {
                            if (!value) {
                              const { dateFilter, dateFilterOptions, ...rest } = current;
                              return rest;
                            }
                            const metadata = templateDateFilterMetadata.get(value);
                            if (!metadata) {
                              return current;
                            }
                            const allIds = templateDateFilterOptions.map((option) => option.value);
                            const allowedIds = resolveAllowedDateFilterIds(
                              current,
                              allIds,
                              selectedSpotlightDateFilterId,
                            );
                            const nextIds = [value, ...allowedIds.filter((id) => id !== value)];
                            const nextOptions = buildDateFilterOptionsFromIds(
                              nextIds,
                              templateDateFilterMetadata,
                              templateDateFilterLabelById,
                            );
                            return {
                              ...current,
                              dateFilter: { ...metadata },
                              ...(nextOptions.length > 0 ? { dateFilterOptions: nextOptions } : {}),
                            };
                          });
                        }}
                      />
                      <MultiSelect
                        label="Extra date fields"
                        data={templateDateFilterOptions.filter(
                          (option) => option.value !== selectedSpotlightDateFilterId,
                        )}
                        value={selectedSpotlightExtraDateFilterIds}
                        onChange={(value) => {
                          updateSpotlightCardDraft((current) => {
                            const normalized = value.filter((entry) =>
                              templateDateFilterOptions.some((option) => option.value === entry),
                            );
                            const defaultId = selectedSpotlightDateFilterId;
                            const nextIds = defaultId
                              ? [defaultId, ...normalized.filter((id) => id !== defaultId)]
                              : normalized;
                            if (nextIds.length === 0) {
                              const { dateFilterOptions, ...rest } = current;
                              return rest;
                            }
                            const nextOptions = buildDateFilterOptionsFromIds(
                              nextIds,
                              templateDateFilterMetadata,
                              templateDateFilterLabelById,
                            );
                            return {
                              ...current,
                              ...(nextOptions.length > 0 ? { dateFilterOptions: nextOptions } : {}),
                            };
                          });
                        }}
                        searchable
                        disabled={!selectedSpotlightDateFilterId}
                      />
                      <MultiSelect
                        label="Quick filter buttons"
                        data={PERIOD_PRESET_OPTIONS}
                        value={spotlightDashboardConfig.periodConfig?.presets ?? []}
                        onChange={(value) => {
                          updateSpotlightCardDraft((current) => {
                            const normalized = value.filter((entry) =>
                              PERIOD_PRESET_OPTIONS.some((option) => option.value === entry),
                            ) as DashboardPreviewPeriodPreset[];
                            if (normalized.length === 0) {
                              const { periodConfig, ...rest } = current;
                              return rest;
                            }
                            const existingDefault = current.periodConfig?.defaultPreset;
                            const allowCustom = Boolean(current.periodConfig?.allowCustom);
                            const defaultPreset =
                              existingDefault && normalized.includes(existingDefault)
                                ? existingDefault
                                : normalized[0];
                            return {
                              ...current,
                              periodConfig: {
                                presets: normalized,
                                defaultPreset,
                                allowCustom,
                              },
                            };
                          });
                        }}
                        searchable
                        disabled={!selectedSpotlightDateFilterId}
                      />
                      <Select
                        label="Default period"
                        data={(spotlightDashboardConfig.periodConfig?.presets ?? []).map((preset) => ({
                          value: preset,
                          label: SPOTLIGHT_PERIOD_LABELS[preset],
                        }))}
                        value={spotlightDashboardConfig.periodConfig?.defaultPreset ?? null}
                        placeholder="Select default"
                        onChange={(value) => {
                          if (!value) {
                            return;
                          }
                          updateSpotlightCardDraft((current) => {
                            if (!current.periodConfig) {
                              return current;
                            }
                            return {
                              ...current,
                              periodConfig: {
                                ...current.periodConfig,
                                defaultPreset: value as DashboardPreviewPeriodPreset,
                              },
                            };
                          });
                        }}
                        disabled={!selectedSpotlightDateFilterId || !spotlightDashboardConfig.periodConfig}
                      />
                      <Switch
                        label="Allow custom range"
                        checked={Boolean(spotlightDashboardConfig.periodConfig?.allowCustom)}
                        onChange={(event) => {
                          const allowCustom = event.currentTarget.checked;
                          updateSpotlightCardDraft((current) => {
                            if (!current.periodConfig) {
                              return current;
                            }
                            return {
                              ...current,
                              periodConfig: {
                                ...current.periodConfig,
                                allowCustom,
                              },
                            };
                          });
                        }}
                        disabled={!selectedSpotlightDateFilterId || !spotlightDashboardConfig.periodConfig}
                      />
                    </>
                  )}
                </Stack>
              </Paper>
            )}
            <Group align="flex-end" gap="sm">
              <NumberInput
                label="Columns (1-12)"
                value={cardDraft.layout.w}
                onChange={(value) =>
                  setCardDraft((current) =>
                    current
                      ? {
                          ...current,
                          layout: {
                            ...current.layout,
                            w: typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.min(12, value)) : 6,
                          },
                        }
                      : current,
                  )
                }
                min={1}
                max={12}
              />
              <NumberInput
                label="Rows"
                value={cardDraft.layout.h}
                onChange={(value) =>
                  setCardDraft((current) =>
                    current
                      ? {
                          ...current,
                          layout: {
                            ...current.layout,
                            h: typeof value === "number" && Number.isFinite(value) ? Math.max(1, value) : 4,
                          },
                        }
                      : current,
                  )
                }
                min={1}
              />
              <NumberInput
                label="Start column"
                value={cardDraft.layout.x}
                onChange={(value) =>
                  setCardDraft((current) =>
                    current
                      ? {
                          ...current,
                          layout: {
                            ...current.layout,
                            x: typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0,
                          },
                        }
                      : current,
                  )
                }
                min={0}
              />
              <NumberInput
                label="Start row"
                value={cardDraft.layout.y}
                onChange={(value) =>
                  setCardDraft((current) =>
                    current
                      ? {
                          ...current,
                          layout: {
                            ...current.layout,
                            y: typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0,
                          },
                        }
                      : current,
                  )
                }
                min={0}
              />
            </Group>
            <Group justify="flex-end" gap="sm">
              <Button variant="light" onClick={() => setCardModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveCard} loading={upsertCardMutation.isPending}>
                {cardMode === "create" ? "Add card" : "Save card"}
              </Button>
            </Group>
          </Stack>
        ) : (
          <Stack align="center" gap="xs">
            <Loader size="sm" />
          </Stack>
        )}
      </Modal>

      <Modal
        opened={layoutEditorOpen}
        onClose={() => setLayoutEditorOpen(false)}
        title={null}
        fullScreen
        padding={0}
        withCloseButton={false}
        styles={{
          inner: { padding: 0 },
          content: {
            display: "flex",
            flexDirection: "column",
            width: "100vw",
            maxWidth: "100vw",
            margin: 0,
            borderRadius: 0,
          },
          body: { flex: 1, display: "flex", flexDirection: "column", padding: 0 },
        }}
      >
        <Box
          style={{
            height: layoutEditorHeaderHeight,
            minHeight: layoutEditorHeaderHeight,
            display: "flex",
            flexWrap: "nowrap",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            columnGap: 12,
            padding: `0 ${layoutEditorPaddingX}px`,
            background: `linear-gradient(135deg, ${theme.colors.dark[7]} 0%, ${theme.colors.dark[8]} 45%, ${theme.colors.dark[9]} 100%)`,
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.22)",
            color: theme.white,
          }}
        >
          <Group gap={isMobile ? 6 : "sm"} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text
              fw={600}
              c="white"
              size={isMobile ? "sm" : "md"}
              style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {isMobile ? "Layout" : "Layout editor"}
            </Text>
            <Group gap={isMobile ? 6 : "xs"} wrap="nowrap" style={{ flexShrink: 0 }}>
              <Button
                size={isMobile ? "xs" : "sm"}
                variant={layoutEditorMode === "desktop" ? "filled" : "outline"}
                onClick={() => setLayoutEditorMode("desktop")}
                styles={{
                  root: {
                    backgroundColor: layoutEditorMode === "desktop" ? "#ffffff" : "transparent",
                    color: layoutEditorMode === "desktop" ? "#0b0d12" : "#ffffff",
                    borderColor: "rgba(255,255,255,0.4)",
                    paddingLeft: isMobile ? 8 : undefined,
                    paddingRight: isMobile ? 8 : undefined,
                    height: isMobile ? 28 : undefined,
                    minHeight: isMobile ? 28 : undefined,
                  },
                }}
              >
                {isMobile ? "Desk" : "Desktop"}
              </Button>
              <Button
                size={isMobile ? "xs" : "sm"}
                variant={layoutEditorMode === "mobile" ? "filled" : "outline"}
                onClick={() => setLayoutEditorMode("mobile")}
                styles={{
                  root: {
                    backgroundColor: layoutEditorMode === "mobile" ? "#ffffff" : "transparent",
                    color: layoutEditorMode === "mobile" ? "#0b0d12" : "#ffffff",
                    borderColor: "rgba(255,255,255,0.4)",
                    paddingLeft: isMobile ? 8 : undefined,
                    paddingRight: isMobile ? 8 : undefined,
                    height: isMobile ? 28 : undefined,
                    minHeight: isMobile ? 28 : undefined,
                  },
                }}
              >
                {isMobile ? "Mob" : "Mobile"}
              </Button>
            </Group>
          </Group>
          <Group gap={isMobile ? 6 : "sm"} wrap="nowrap" justify="flex-end" style={{ flexShrink: 0 }}>
            <Button
              size={isMobile ? "xs" : "sm"}
              variant="outline"
              onClick={() => setLayoutEditorOpen(false)}
              styles={{
                root: {
                  borderColor: "rgba(255,255,255,0.4)",
                  color: "#fff",
                  paddingLeft: isMobile ? 10 : undefined,
                  paddingRight: isMobile ? 10 : undefined,
                  height: isMobile ? 28 : undefined,
                  minHeight: isMobile ? 28 : undefined,
                },
              }}
            >
              Close
            </Button>
            <Button
              size={isMobile ? "xs" : "sm"}
              leftSection={<IconDeviceFloppy size={isMobile ? 14 : 16} />}
              onClick={handleSaveLayoutChanges}
              disabled={pendingLayoutCount === 0 || isSavingLayout}
              loading={isSavingLayout}
              styles={{
                root: {
                  backgroundColor: "#ffffff",
                  color: "#0b0d12",
                  paddingLeft: isMobile ? 10 : undefined,
                  paddingRight: isMobile ? 10 : undefined,
                  height: isMobile ? 28 : undefined,
                  minHeight: isMobile ? 28 : undefined,
                },
              }}
            >
              {isMobile ? "Save" : "Save layout"}
            </Button>
          </Group>
        </Box>
        <Box
          style={{
            flex: 1,
            padding: `${layoutEditorGridPaddingY}px ${layoutEditorGridPaddingX}px`,
            backgroundColor: "#f4f4f7",
            minHeight: 0,
            display: "flex",
          }}
        >
          <Box style={{ flex: 1, minHeight: 0, height: "100%" }}>
            <DashboardLayoutEditor
              cards={selectedDashboardCards}
              templateLookup={templateLookup}
              onLayoutCommit={handleLayoutCommit}
              onUpdateCardViewConfig={handleUpdateCardViewConfig}
              layoutMode={layoutEditorMode}
            />
          </Box>
        </Box>
      </Modal>
    </PageAccessGuard>
  );
};

export default ReportDashboards;
