import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Drawer,
  Flex,
  Group,
  Highlight,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  SimpleGrid,
  Switch,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import dayjs from "dayjs";
import {
  IconAdjustments,
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconCalendarStats,
  IconChartHistogram,
  IconCheck,
  IconClock,
  IconCopy,
  IconDatabase,
  IconDeviceFloppy,
  IconDownload,
  IconLayoutGrid,
  IconMail,
  IconMessage2,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconTemplate,
  IconTrash,
} from "@tabler/icons-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import type { Formatter, Payload } from "recharts/types/component/DefaultTooltipContent";
import { useAppDispatch } from "../store/hooks";
import { navigateToPage } from "../actions/navigationActions";
import { GenericPageProps } from "../types/general/GenericPageProps";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { parseDerivedFieldExpression } from "../utils/derivedFieldParser";
import {
  useReportModels,
  useReportTemplates,
  useRunReportPreview,
  useRunReportQuery,
  useSaveReportTemplate,
  useDeleteReportTemplate,
  useDerivedFields,
  type QueryConfig,
  type QueryConfigMetric,
  type QueryConfigDimension,
  type QueryConfigFilter,
  type QueryConfigFilterValue,
  type QueryConfigDerivedField,
  type ReportQueryResult,
  type ReportQuerySuccessResponse,
  type ReportQueryJobResponse,
  getReportQueryJob,
  useTemplateSchedules,
  useCreateTemplateSchedule,
  useUpdateTemplateSchedule,
  useDeleteTemplateSchedule,
  useExportReportTemplate,
  useUpdateDerivedField,
  useReportDashboards,
  useUpsertDashboardCard,
  type DashboardCardViewConfig,
  type DashboardSpotlightCardViewConfig,
  type DashboardVisualCardViewConfig,
  type DashboardPreviewTableCardViewConfig,
  type DashboardCardDto,
  type TemplateScheduleDto,
  type TemplateSchedulePayload,
  type TemplateScheduleDeliveryTarget,
  type DerivedFieldDefinitionDto,
  type DerivedFieldExpressionAst,
  type DerivedFieldDto,
  type MetricSpotlightDefinitionDto,
  type ReportModelFieldResponse,
  type ReportModelPayload,
  type ReportPreviewRequest,
  type ReportPreviewResponse,
  type PreviewOrderClausePayload,
  type PreviewGroupingRuleDto,
  type PreviewAggregationRuleDto,
  type PreviewHavingRuleDto,
  type ReportTemplateDto,
  type ReportTemplateListResponse,
  type SaveReportTemplateRequest,
} from "../api/reports";

const PAGE_SLUG = PAGE_SLUGS.reports;
const DERIVED_FIELD_SENTINEL = "__derived__";
type DataField = {
  id: string;
  label: string;
  type: "id" | "number" | "currency" | "string" | "date" | "percentage" | "boolean";
  sourceColumn?: string;
  allowNull?: boolean;
  primaryKey?: boolean;
  references?: {
    model: string | null;
    key?: string | null;
  };
};

type AssociationDefinition = {
  targetModelId: string;
  associationType: string;
  foreignKey?: string;
  sourceKey?: string;
  through?: string | null;
  alias?: string | null;
};

type DataModelDefinition = {
  id: string;
  name: string;
  description?: string;
  connection?: string;
  recordCount?: string;
  lastSynced?: string;
  primaryKey?: string;
  primaryKeys?: string[];
  tableName?: string;
  schema?: string;
  fields: DataField[];
  associations?: AssociationDefinition[];
};

type PreviewColumnMeta = {
  alias: string;
  fieldLabel: string;
  customLabel?: string;
  modelName?: string;
  modelId?: string;
  tableName?: string;
  fieldId?: string;
  sourceColumn?: string;
};

type SelectedFieldDetail = DataField & {
  modelId: string;
  modelName: string;
  alias?: string;
  source?: "model" | "derived";
  derivedFieldId?: string;
};

type JoinCondition = {
  id: string;
  leftModel: string;
  leftField: string;
  rightModel: string;
  rightField: string;
  joinType: "inner" | "left" | "right" | "full";
  description?: string;
};

type ManualJoinDraft = {
  leftModelId: string;
  leftFieldId: string;
  rightModelId: string;
  rightFieldId: string;
  joinType: JoinCondition["joinType"];
};

type VisualDefinition = {
  id: string;
  name: string;
  type: "line" | "area" | "bar" | "stackedArea" | "stackedBar" | "scatter";
  metric: string;
  metricAggregation?: QueryConfigMetric["aggregation"];
  dimension: string;
  dimensionBucket?: QueryConfigDimension["bucket"];
  comparison?: string;
  comparisonAggregation?: QueryConfigMetric["aggregation"];
  limit?: number | null;
};

type FilterValueKind = "string" | "number" | "date" | "boolean";
type FilterComparisonMode = "value" | "field";
type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "is_null"
  | "is_not_null"
  | "is_true"
  | "is_false";

type ReportFilter = {
  id: string;
  leftModelId: string;
  leftFieldId: string;
  operator: FilterOperator;
  rightType: FilterComparisonMode;
  rightModelId?: string;
  rightFieldId?: string;
  value?: string;
  valueKind: FilterValueKind;
  range?: {
    from?: string;
    to?: string;
  };
};

type FilterFieldOption = {
  value: string;
  label: string;
  modelId: string;
  fieldId: string;
  field: DataField;
  source?: "model" | "derived";
};

type VisualQueryDescriptor = {
  config: QueryConfig | null;
  metricAlias: string | null;
  dimensionAlias: string | null;
  comparisonAlias: string | null;
  metricBaseAlias: string | null;
  dimensionBaseAlias: string | null;
  metricLabel: string;
  dimensionLabel: string;
  comparisonLabel?: string;
  warnings: string[];
};

type PreviewOrderRule = {
  id: string;
  source: "model" | "derived";
  modelId?: string;
  fieldId: string;
  direction: "asc" | "desc";
};

type PreviewGroupingRule = {
  id: string;
  source: "model" | "derived";
  modelId?: string;
  fieldId: string;
  bucket?: TimeBucket | null;
};

type PreviewAggregationRule = {
  id: string;
  source: "model" | "derived";
  modelId?: string;
  fieldId: string;
  aggregation: QueryConfigMetric["aggregation"];
  alias?: string;
};

type PreviewHavingRule = {
  id: string;
  aggregationId: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
  value?: string;
  valueKind: FilterValueKind;
};

type DerivedFieldStatus = "active" | "stale";
type ReportDerivedField = DerivedFieldDefinitionDto & { status?: DerivedFieldStatus };
const DERIVED_FIELD_VISIBILITY_FLAG = "__includeInBuilder";

const isDerivedFieldVisibleInBuilder = (field: DerivedFieldDefinitionDto): boolean => {
  if (field.status === "stale") {
    return false;
  }
  const rawFlag = field.metadata ? field.metadata[DERIVED_FIELD_VISIBILITY_FLAG] : undefined;
  return typeof rawFlag === "boolean" ? rawFlag : true;
};

const applyDerivedFieldVisibility = (field: ReportDerivedField, enabled: boolean): ReportDerivedField => {
  const metadata = { ...(field.metadata ?? {}) };
  if (enabled) {
    if (DERIVED_FIELD_VISIBILITY_FLAG in metadata) {
      delete metadata[DERIVED_FIELD_VISIBILITY_FLAG];
    }
  } else {
    metadata[DERIVED_FIELD_VISIBILITY_FLAG] = false;
  }
  const normalizedMetadata = Object.keys(metadata).length > 0 ? metadata : undefined;
  return {
    ...field,
    metadata: normalizedMetadata,
  };
};

type ReportTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  schedule: string;
  lastUpdated: string;
  owner: string;
  autoDistribution: boolean;
  notifyTeam: boolean;
  autoRunOnOpen: boolean;
  models: string[];
  fields: Array<{ modelId: string; fieldIds: string[] }>;
  joins: JoinCondition[];
  visuals: VisualDefinition[];
  metrics: string[];
  filters: ReportFilter[];
  columnOrder: string[];
  columnAliases: Record<string, string>;
  queryConfig: QueryConfig | null;
  derivedFields: ReportDerivedField[];
  metricsSpotlight: MetricSpotlightDefinitionDto[];
  previewOrder: PreviewOrderRule[];
  previewGrouping: PreviewGroupingRule[];
  previewAggregations: PreviewAggregationRule[];
  previewHaving: PreviewHavingRule[];
};

const DEFAULT_CONNECTION_LABEL = "OmniLodge core database";

const JOIN_TYPE_OPTIONS: { value: JoinCondition["joinType"]; label: string }[] = [
  { value: "inner", label: "Inner join" },
  { value: "left", label: "Left join" },
  { value: "right", label: "Right join" },
  { value: "full", label: "Full outer join" },
];

const METRIC_AGGREGATIONS: QueryConfigMetric["aggregation"][] = [
  "sum",
  "avg",
  "min",
  "max",
  "count",
  "count_distinct",
];

const AGGREGATION_LABELS: Record<QueryConfigMetric["aggregation"], string> = {
  sum: "Sum",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
  count: "Count",
  count_distinct: "Unique count",
};

const HAVING_OPERATOR_OPTIONS: { value: PreviewHavingRule["operator"]; label: string }[] = [
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
];

type TimeBucket = Exclude<QueryConfigDimension["bucket"], undefined>;

const DIMENSION_BUCKETS: TimeBucket[] = [
  "hour",
  "day",
  "week",
  "month",
  "quarter",
  "year",
];

const BUCKET_LABELS: Record<TimeBucket, string> = {
  hour: "Hour",
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

const isReportQuerySuccess = (
  result: ReportQueryResult,
): result is ReportQuerySuccessResponse => {
  return Boolean(
    result &&
      typeof result === "object" &&
      Array.isArray((result as ReportQuerySuccessResponse).rows) &&
      Array.isArray((result as ReportQuerySuccessResponse).columns),
  );
};

const isReportQueryJob = (result: ReportQueryResult): result is ReportQueryJobResponse => {
  return Boolean(result && typeof result === "object" && "jobId" in result);
};

const createManualJoinDraft = (joinType: JoinCondition["joinType"] = "left"): ManualJoinDraft => ({
  leftModelId: "",
  leftFieldId: "",
  rightModelId: "",
  rightFieldId: "",
  joinType,
});

const humanizeName = (value: string): string =>
  value
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const resolveFieldType = (field: ReportModelFieldResponse): DataField["type"] => {
  const rawType = (field.type ?? "").toLowerCase();
  const fieldName = field.fieldName.toLowerCase();

  if (field.primaryKey || fieldName === "id" || fieldName.endsWith("_id")) {
    return "id";
  }
  if (rawType.includes("bool")) {
    return "boolean";
  }
  if (rawType.includes("date") || rawType.includes("time")) {
    return "date";
  }
  if (rawType.includes("percent")) {
    return "percentage";
  }
  if (rawType.includes("money") || rawType.includes("currency")) {
    return "currency";
  }
  if (
    rawType.includes("int") ||
    rawType.includes("number") ||
    rawType.includes("numeric") ||
    rawType.includes("decimal") ||
    rawType.includes("float") ||
    rawType.includes("double") ||
    rawType.includes("bigint")
  ) {
    return "number";
  }
  return "string";
};

const mapBackendField = (field: ReportModelFieldResponse): DataField => ({
  id: field.fieldName,
  label: humanizeName(field.fieldName),
  type: resolveFieldType(field),
  sourceColumn: field.columnName,
  allowNull: field.allowNull,
  primaryKey: field.primaryKey,
  references: field.references,
});

const mapBackendModel = (model: ReportModelPayload): DataModelDefinition => {
  const fields = model.fields.map(mapBackendField);
  const primaryCandidates = [
    model.primaryKey,
    ...(model.primaryKeys ?? []),
    fields.find((field) => field.primaryKey)?.id,
    fields[0]?.id,
  ].filter((value): value is string => Boolean(value));

  const associations: AssociationDefinition[] = (model.associations ?? []).map(
    (association) => ({
      targetModelId: association.targetModel,
      associationType: association.associationType,
      foreignKey: association.foreignKey,
      sourceKey: association.sourceKey,
      through: association.through ?? null,
      alias: association.as ?? association.name ?? null,
    })
  );

  return {
    id: model.id,
    name: model.name,
    description: model.description,
    connection: model.connection ?? DEFAULT_CONNECTION_LABEL,
    recordCount: model.recordCount,
    lastSynced: model.lastSynced ? new Date(model.lastSynced).toLocaleString() : undefined,
    primaryKey: primaryCandidates[0],
    primaryKeys: model.primaryKeys ?? [],
    tableName: model.tableName,
    schema: model.schema,
    fields,
    associations,
  };
};

const getDefaultKey = (model: DataModelDefinition): string =>
  model.primaryKey ??
  model.primaryKeys?.[0] ??
  model.fields.find((field) => field.primaryKey)?.id ??
  model.fields[0]?.id ??
  "id";

const deepClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const generateId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const createEmptyTemplate = (): ReportTemplate => ({
  id: "template-empty",
  name: "",
  category: "",
  description: "",
  schedule: "Manual",
  lastUpdated: "Not saved yet",
  owner: "You",
  autoDistribution: true,
  notifyTeam: true,
  autoRunOnOpen: false,
  models: [],
  fields: [],
  joins: [],
  visuals: [],
  metrics: [],
  filters: [],
  columnOrder: [],
  columnAliases: {},
  queryConfig: null,
  derivedFields: [],
  metricsSpotlight: [],
  previewOrder: [],
  previewGrouping: [],
  previewAggregations: [],
  previewHaving: [],
});

const buildJoinKey = (left: string, right: string) => {
  const normalized = [left.trim(), right.trim()].filter((entry) => entry.length > 0).sort();
  return normalized.join("::");
};

const inferReferencedModelsFromExpression = (expression: string | undefined): string[] => {
  if (!expression || typeof expression !== "string") {
    return [];
  }
  const tokens = expression.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z_][A-Za-z0-9_]*/g);
  const set = new Set<string>();
  for (const match of tokens) {
    if (match[1]) {
      set.add(match[1]);
    }
  }
  return Array.from(set);
};

const getEffectiveReferencedModels = (
  field: Pick<DerivedFieldDefinitionDto, "referencedModels" | "expression">,
): string[] => {
  if (Array.isArray(field.referencedModels) && field.referencedModels.length > 0) {
    return field.referencedModels;
  }
  try {
    const parsed = parseDerivedFieldExpression(field.expression);
    return parsed.referencedModels;
  } catch {
    return inferReferencedModelsFromExpression(field.expression);
  }
};

const buildModelPairs = (models: string[] | undefined): Array<[string, string]> => {
  if (!Array.isArray(models) || models.length < 2) {
    return [];
  }
  const uniqueModels = Array.from(
    new Set(models.filter((modelId): modelId is string => typeof modelId === "string" && modelId.length > 0)),
  ).sort();
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < uniqueModels.length; i += 1) {
    for (let j = i + 1; j < uniqueModels.length; j += 1) {
      pairs.push([uniqueModels[i], uniqueModels[j]]);
    }
  }
  return pairs;
};

const reconcileDerivedFieldStatuses = <T extends DerivedFieldDefinitionDto>(
  fields: T[],
  models: string[],
): T[] => {
  if (!fields || fields.length === 0) {
    return fields;
  }
  const modelSet = new Set(models);
  let mutated = false;
  const next = fields.map((field) => {
    const referenced = getEffectiveReferencedModels(field as ReportDerivedField);
    if (referenced.length === 0) {
      if (!field.status) {
        return field;
      }
      mutated = true;
      const clone = { ...field };
      delete clone.status;
      return clone;
    }
    const isStale = referenced.some((modelId) => !modelSet.has(modelId));
    const currentStatus = field.status === "stale" ? "stale" : undefined;
    if ((!isStale && !currentStatus) || (isStale && currentStatus === "stale")) {
      return field;
    }
    mutated = true;
    if (isStale) {
      return { ...field, status: "stale" };
    }
    const clone = { ...field };
    delete clone.status;
    return clone;
  });
  return mutated ? next : fields;
};

const DEFAULT_VISUAL: VisualDefinition = {
  id: "visual-default",
  name: "Preview visual",
  type: "line",
  metric: "",
  dimension: "",
  metricAggregation: "sum",
  limit: 100,
};

const DASHBOARD_CARD_DEFAULT_LAYOUT = {
  x: 0,
  y: 0,
  w: 6,
  h: 4,
};

type DashboardCardModalDraft = {
  templateId: string;
  title: string;
  viewConfig: DashboardCardViewConfig;
  layout: Record<string, unknown>;
};

const toColumnAlias = (modelId: string, fieldId: string) => `${modelId}__${fieldId}`;

const parseColumnAlias = (
  alias: string | undefined,
): { modelId: string; fieldId: string } | null => {
  if (!alias || typeof alias !== "string") {
    return null;
  }
  const parts = alias.split("__");
  if (parts.length < 2) {
    return null;
  }
  const [modelId, ...fieldParts] = parts;
  const fieldId = fieldParts.join("__");
  if (!modelId || !fieldId) {
    return null;
  }
  return { modelId, fieldId };
};

const buildMetricAggregationAlias = (
  baseAlias: string,
  aggregation: QueryConfigMetric["aggregation"],
) => `${baseAlias}_${aggregation}`;

const buildDimensionAlias = (
  baseAlias: string,
  bucket?: QueryConfigDimension["bucket"],
) => (bucket ? `${baseAlias}_${bucket}` : baseAlias);

const parseRecipientList = (input: string): TemplateScheduleDeliveryTarget[] => {
  if (!input) {
    return [];
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

  return input
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => {
      if (emailPattern.test(value)) {
        return { type: "email", value };
      }
      if (value.startsWith("#") || value.startsWith("@")) {
        return { type: "slack", value };
      }
      return { type: "custom", value };
    });
};

const formatDeliveryTargetsLabel = (targets: TemplateScheduleDeliveryTarget[]): string => {
  if (!targets || targets.length === 0) {
    return "";
  }
  const resolved = targets
    .map((target) => {
      if (!target || typeof target !== "object") {
        return null;
      }
      if (typeof (target as { value?: unknown }).value === "string") {
        return (target as { value?: unknown }).value as string;
      }
      if (typeof (target as { email?: unknown }).email === "string") {
        return (target as { email?: unknown }).email as string;
      }
      if (typeof (target as { channel?: unknown }).channel === "string") {
        return (target as { channel?: unknown }).channel as string;
      }
      if (typeof (target as { address?: unknown }).address === "string") {
        return (target as { address?: unknown }).address as string;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value));
  return resolved.join(", ");
};

const formatMetricValue = (
  value: number,
  format: MetricSpotlightDefinitionDto["format"] = "number",
): string => {
  if (!Number.isFinite(value)) {
    return "—";
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

const isPreviewTableCardViewConfig = (
  config: DashboardCardViewConfig | null | undefined,
): config is DashboardPreviewTableCardViewConfig =>
  Boolean(
    config &&
      config.mode === "preview_table" &&
      typeof (config as DashboardPreviewTableCardViewConfig).previewRequest === "object",
  );

const getDashboardCardDescription = (viewConfig: DashboardCardViewConfig | null | undefined): string => {
  if (!viewConfig || typeof viewConfig !== "object") {
    return "";
  }
  const candidate = (viewConfig as { description?: unknown }).description;
  return typeof candidate === "string" ? candidate : "";
};

const hasEditableDashboardViewConfig = (
  viewConfig: DashboardCardViewConfig | null | undefined,
): viewConfig is DashboardCardViewConfig & Record<string, unknown> =>
  Boolean(viewConfig && typeof viewConfig === "object");

const SPOTLIGHT_COMPARISON_OPTIONS: {
  value: NonNullable<MetricSpotlightDefinitionDto["comparison"]>;
  label: string;
}[] = [
  { value: "previous", label: "Previous period" },
  { value: "wow", label: "Week over week" },
  { value: "mom", label: "Month over month" },
  { value: "yoy", label: "Year over year" },
];

const SPOTLIGHT_FORMAT_OPTIONS: {
  value: NonNullable<MetricSpotlightDefinitionDto["format"]>;
  label: string;
}[] = [
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency (USD)" },
  { value: "percentage", label: "Percentage" },
];

const normalizeFiltersForQuery = (
  filters: ReportFilter[],
): { filters: QueryConfigFilter[]; warnings: string[] } => {
  const supportedOperators: Partial<Record<FilterOperator, QueryConfigFilter["operator"]>> = {
    eq: "eq",
    neq: "neq",
    gt: "gt",
    gte: "gte",
    lt: "lt",
    lte: "lte",
    between: "between",
  };

  const normalized: QueryConfigFilter[] = [];
  const warnings: string[] = [];

  filters.forEach((filter) => {
    if (filter.leftModelId === DERIVED_FIELD_SENTINEL) {
      warnings.push(
        `Filter on derived field ${filter.leftFieldId} is only supported in previews and was skipped for analytics.`,
      );
      return;
    }
    if (filter.rightType === "field") {
      warnings.push(
        `Filter on ${filter.leftModelId}.${filter.leftFieldId} compares to another field and was skipped for analytics.`,
      );
      return;
    }

    const operator = supportedOperators[filter.operator];
    if (!operator) {
      warnings.push(
        `Filter operator "${filter.operator}" on ${filter.leftModelId}.${filter.leftFieldId} is not supported for analytics and was skipped.`,
      );
      return;
    }

    let value: QueryConfigFilterValue | undefined;
    if (filter.operator === "between") {
      const rawFrom = filter.range?.from ?? "";
      const rawTo = filter.range?.to ?? "";
      const from = rawFrom.trim();
      const to = rawTo.trim();
      if (!from || !to) {
        warnings.push(
          `Filter on ${filter.leftModelId}.${filter.leftFieldId} requires both start and end values.`,
        );
        return;
      }
      if (filter.valueKind === "number") {
        const fromNumeric = Number(from);
        const toNumeric = Number(to);
        if (!Number.isFinite(fromNumeric) || !Number.isFinite(toNumeric)) {
          warnings.push(
            `Filter on ${filter.leftModelId}.${filter.leftFieldId} has invalid numeric bounds.`,
          );
          return;
        }
        value = { from: fromNumeric, to: toNumeric };
      } else {
        value = { from, to };
      }
    } else if (filter.valueKind === "boolean") {
      if (filter.value === "true") {
        value = true;
      } else if (filter.value === "false") {
        value = false;
      } else {
        warnings.push(
          `Filter on ${filter.leftModelId}.${filter.leftFieldId} has an invalid boolean value and was skipped.`,
        );
        return;
      }
    } else if (filter.valueKind === "number") {
      if (filter.value === undefined || filter.value === "") {
        warnings.push(
          `Filter on ${filter.leftModelId}.${filter.leftFieldId} requires a numeric value and was skipped.`,
        );
        return;
      }
      const numericValue = Number(filter.value);
      if (!Number.isFinite(numericValue)) {
        warnings.push(
          `Filter on ${filter.leftModelId}.${filter.leftFieldId} has an invalid number and was skipped.`,
        );
        return;
      }
      value = numericValue;
    } else if (filter.valueKind === "date") {
      if (!filter.value) {
        warnings.push(
          `Filter on ${filter.leftModelId}.${filter.leftFieldId} requires a date value and was skipped.`,
        );
        return;
      }
      value = filter.value;
    } else {
      if (!filter.value) {
        warnings.push(
          `Filter on ${filter.leftModelId}.${filter.leftFieldId} requires a value and was skipped.`,
        );
        return;
      }
      value = filter.value;
    }

    normalized.push({
      modelId: filter.leftModelId,
      fieldId: filter.leftFieldId,
      operator,
      value,
    });
  });

  return { filters: normalized, warnings };
};

const arraysShallowEqual = <T,>(first: readonly T[], second: readonly T[]) =>
  first.length === second.length && first.every((value, index) => value === second[index]);

const recordsShallowEqual = <T,>(first: Record<string, T>, second: Record<string, T>) => {
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  if (firstKeys.length !== secondKeys.length) {
    return false;
  }
  return firstKeys.every((key) => Object.prototype.hasOwnProperty.call(second, key) && first[key] === second[key]);
};

const omitRecordKey = <T,>(record: Record<string, T>, key: string) => {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return record;
  }
  const { [key]: _omitted, ...rest } = record;
  return rest;
};

const humanizeAlias = (alias: string) => {
  const [, field = alias] = alias.split("__");
  return humanizeName(field);
};

const coerceNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value.replace(/[^0-9.\-]+/g, ""));
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return null;
};

const coerceString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("en-US");
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
};

const formatPreviewValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString("en-US") : "-";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
};

const CATEGORY_OPTIONS = [
  { value: "Executive summary", label: "Executive summary" },
  { value: "Revenue management", label: "Revenue management" },
  { value: "Sales & marketing", label: "Sales & marketing" },
  { value: "Guest experience", label: "Guest experience" },
  { value: "Operations", label: "Operations" },
  { value: "Custom", label: "Custom" },
];

const VISUAL_TYPE_OPTIONS: Array<{ value: VisualDefinition["type"]; label: string }> = [
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "bar", label: "Column" },
  { value: "stackedArea", label: "Stacked area" },
  { value: "stackedBar", label: "Stacked column" },
  { value: "scatter", label: "Scatter" },
];

const VISUAL_TYPE_SET = new Set(VISUAL_TYPE_OPTIONS.map((option) => option.value));

const SCHEDULE_OPTIONS = [
  { value: "Manual", label: "Manual run" },
  { value: "Daily 06:00", label: "Daily - 06:00" },
  { value: "Weekly Monday 07:30", label: "Weekly - Monday 07:30" },
  { value: "Monthly 1st 09:00", label: "Monthly - 1st @ 09:00" },
];

type ScheduleStatus = "active" | "paused";

const SCHEDULE_STATUS_OPTIONS: { value: ScheduleStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
];

type FilterOperatorDefinition = {
  value: FilterOperator;
  label: string;
  types: DataField["type"][];
  requiresValue: boolean;
  allowFieldComparison?: boolean;
};

const FILTER_OPERATOR_LIBRARY: FilterOperatorDefinition[] = [
  {
    value: "eq",
    label: "Equals",
    types: ["id", "string", "number", "currency", "date", "percentage", "boolean"],
    requiresValue: true,
    allowFieldComparison: true,
  },
  {
    value: "neq",
    label: "Does not equal",
    types: ["id", "string", "number", "currency", "date", "percentage", "boolean"],
    requiresValue: true,
    allowFieldComparison: true,
  },
  {
    value: "gt",
    label: "Greater than",
    types: ["number", "currency", "percentage", "date"],
    requiresValue: true,
    allowFieldComparison: true,
  },
  {
    value: "gte",
    label: "Greater than or equal",
    types: ["number", "currency", "percentage", "date"],
    requiresValue: true,
    allowFieldComparison: true,
  },
  {
    value: "lt",
    label: "Less than",
    types: ["number", "currency", "percentage", "date"],
    requiresValue: true,
    allowFieldComparison: true,
  },
  {
    value: "lte",
    label: "Less than or equal",
    types: ["number", "currency", "percentage", "date"],
    requiresValue: true,
    allowFieldComparison: true,
  },
  {
    value: "between",
    label: "Between",
    types: ["number", "currency", "percentage", "date"],
    requiresValue: true,
  },
  {
    value: "contains",
    label: "Contains",
    types: ["string", "id"],
    requiresValue: true,
  },
  {
    value: "starts_with",
    label: "Starts with",
    types: ["string", "id"],
    requiresValue: true,
  },
  {
    value: "ends_with",
    label: "Ends with",
    types: ["string", "id"],
    requiresValue: true,
  },
  {
    value: "is_null",
    label: "Is null",
    types: ["id", "string", "number", "currency", "date", "percentage", "boolean"],
    requiresValue: false,
  },
  {
    value: "is_not_null",
    label: "Is not null",
    types: ["id", "string", "number", "currency", "date", "percentage", "boolean"],
    requiresValue: false,
  },
  {
    value: "is_true",
    label: "Is true",
    types: ["boolean"],
    requiresValue: false,
  },
  {
    value: "is_false",
    label: "Is false",
    types: ["boolean"],
    requiresValue: false,
  },
];

const FILTER_OPERATOR_LOOKUP = new Map<FilterOperator, FilterOperatorDefinition>(
  FILTER_OPERATOR_LIBRARY.map((definition) => [definition.value, definition]),
);

const getValueKindForFieldType = (type: DataField["type"]): FilterValueKind => {
  if (type === "number" || type === "currency" || type === "percentage") {
    return "number";
  }
  if (type === "date") {
    return "date";
  }
  if (type === "boolean") {
    return "boolean";
  }
  return "string";
};

const getOperatorOptionsForFieldType = (type: DataField["type"]) =>
  FILTER_OPERATOR_LIBRARY.filter((operator) => operator.types.includes(type));

const escapeSqlLiteral = (value: string) => value.replace(/'/g, "''");

const buildFilterOptionKey = (modelId: string, fieldId: string) => `${modelId}::${fieldId}`;

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const formatTimestamp = () =>
  new Date().toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

const formatLastUpdatedLabel = (value?: string | Date | null) => {
  if (!value) {
    return "Not saved yet";
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not saved yet";
  }
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatDateForFilter = (date: Date | null): string | undefined =>
  date ? dayjs(date).format("YYYY-MM-DD") : undefined;

const parseDateForFilter = (value?: string) => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value, "YYYY-MM-DD", true);
  return parsed.isValid() ? parsed.toDate() : null;
};

const normalizeQueryConfig = (candidate: unknown): QueryConfig | null => {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const parsed = candidate as QueryConfig;
  if (!Array.isArray(parsed.models) || parsed.models.some((model) => typeof model !== "string")) {
    return null;
  }
  return deepClone(parsed);
};

const normalizeDerivedFields = (candidate: unknown): DerivedFieldDefinitionDto[] => {
  if (!Array.isArray(candidate)) {
    return [];
  }

  const derived: DerivedFieldDefinitionDto[] = [];
  candidate.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const expression = typeof record.expression === "string" ? record.expression.trim() : "";
    const kind = record.kind === "aggregate" ? "aggregate" : record.kind === "row" ? "row" : null;
    if (!id || !name || !expression || !kind) {
      return;
    }
    const scope: DerivedFieldDefinitionDto["scope"] =
      record.scope === "workspace" ? "workspace" : "template";
    const metadata =
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? (deepClone(record.metadata) as Record<string, unknown>)
        : undefined;
    let expressionAst: DerivedFieldExpressionAst | null | undefined;
    if (record.expressionAst && typeof record.expressionAst === "object") {
      expressionAst = deepClone(record.expressionAst) as DerivedFieldExpressionAst;
    } else if (record.expressionAst === null) {
      expressionAst = null;
    }
    const referencedModels = Array.isArray(record.referencedModels)
      ? record.referencedModels.filter(
          (model): model is string => typeof model === "string" && model.trim().length > 0,
        )
      : undefined;
    const referencedFields =
      record.referencedFields && typeof record.referencedFields === "object" && !Array.isArray(record.referencedFields)
        ? Object.entries(record.referencedFields as Record<string, unknown>).reduce<
            Record<string, string[]>
          >((accumulator, [modelId, value]) => {
            if (typeof modelId !== "string" || !Array.isArray(value)) {
              return accumulator;
            }
            const trimmedModel = modelId.trim();
            if (!trimmedModel) {
              return accumulator;
            }
            const fields = Array.from(
              new Set(
                value
                  .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
                  .filter((entry) => entry.length > 0),
              ),
            );
            if (fields.length > 0) {
              accumulator[trimmedModel] = fields;
            }
            return accumulator;
          }, {})
        : undefined;
    const joinDependencies =
      Array.isArray(record.joinDependencies) && record.joinDependencies.length > 0
        ? record.joinDependencies
            .map((entry) => {
              if (!Array.isArray(entry) || entry.length !== 2) {
                return null;
              }
              const left = typeof entry[0] === "string" ? entry[0].trim() : "";
              const right = typeof entry[1] === "string" ? entry[1].trim() : "";
              if (!left || !right) {
                return null;
              }
              return [left, right] as [string, string];
            })
            .filter((pair): pair is [string, string] => pair !== null)
        : undefined;
    const modelGraphSignature =
      typeof record.modelGraphSignature === "string" && record.modelGraphSignature.trim().length > 0
        ? record.modelGraphSignature.trim()
        : undefined;
    const compiledSqlHash =
      typeof record.compiledSqlHash === "string" && record.compiledSqlHash.trim().length > 0
        ? record.compiledSqlHash.trim()
        : undefined;
    const status =
      record.status === "stale" ? "stale" : record.status === "active" ? "active" : undefined;
    derived.push({
      id,
      name,
      expression,
      kind,
      scope,
      ...(metadata ? { metadata } : {}),
      ...(expressionAst !== undefined ? { expressionAst } : {}),
      ...(referencedModels && referencedModels.length > 0 ? { referencedModels } : {}),
      ...(referencedFields && Object.keys(referencedFields).length > 0 ? { referencedFields } : {}),
      ...(joinDependencies && joinDependencies.length > 0 ? { joinDependencies } : {}),
      ...(modelGraphSignature ? { modelGraphSignature } : {}),
      ...(compiledSqlHash ? { compiledSqlHash } : {}),
      ...(status ? { status } : {}),
    });
  });
  return derived;
};

const normalizePreviewOrderRules = (value: unknown): PreviewOrderRule[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const rules: PreviewOrderRule[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const id =
      typeof record.id === "string" && record.id.trim().length > 0
        ? record.id.trim()
        : `order-${index}`;
    const direction = record.direction === "desc" ? "desc" : "asc";
    const source = record.source === "derived" ? "derived" : "model";
    const fieldId = typeof record.fieldId === "string" ? record.fieldId.trim() : "";
    if (!fieldId) {
      return;
    }
    const modelIdCandidate =
      typeof record.modelId === "string" && record.modelId.trim().length > 0
        ? record.modelId.trim()
        : undefined;
    rules.push({
      id,
      source,
      modelId: source === "derived" ? undefined : modelIdCandidate,
      fieldId,
      direction,
    });
  });
  return rules;
};

const normalizePreviewGroupingRules = (value: unknown): PreviewGroupingRule[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const rules: PreviewGroupingRule[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const id =
      typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : `group-${index}`;
    const source = record.source === "derived" ? "derived" : "model";
    const fieldId = typeof record.fieldId === "string" ? record.fieldId.trim() : "";
    if (!fieldId) {
      return;
    }
    const modelId =
      source === "derived"
        ? undefined
        : typeof record.modelId === "string" && record.modelId.trim().length > 0
        ? record.modelId.trim()
        : undefined;
    const bucket =
      typeof record.bucket === "string" && record.bucket.trim().length > 0
        ? (record.bucket.trim() as TimeBucket)
        : null;
    rules.push({
      id,
      source,
      modelId,
      fieldId,
      bucket,
    });
  });
  return rules;
};

const normalizePreviewAggregationRules = (value: unknown): PreviewAggregationRule[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const aggregations: PreviewAggregationRule[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const fieldId = typeof record.fieldId === "string" ? record.fieldId.trim() : "";
    if (!fieldId) {
      return;
    }
    const id =
      typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : `agg-${index}`;
    const source = record.source === "derived" ? "derived" : "model";
    const modelId =
      source === "derived"
        ? undefined
        : typeof record.modelId === "string" && record.modelId.trim().length > 0
        ? record.modelId.trim()
        : undefined;
    const aggregation =
      record.aggregation === "avg" ||
      record.aggregation === "min" ||
      record.aggregation === "max" ||
      record.aggregation === "count" ||
      record.aggregation === "count_distinct"
        ? (record.aggregation as PreviewAggregationRule["aggregation"])
        : "sum";
    const alias =
      typeof record.alias === "string" && record.alias.trim().length > 0 ? record.alias.trim() : undefined;
    aggregations.push({
      id,
      source,
      modelId,
      fieldId,
      aggregation,
      alias,
    });
  });
  return aggregations;
};

const normalizePreviewHavingRules = (value: unknown): PreviewHavingRule[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const clauses: PreviewHavingRule[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const aggregationId =
      typeof record.aggregationId === "string" && record.aggregationId.trim().length > 0
        ? record.aggregationId.trim()
        : "";
    if (!aggregationId) {
      return;
    }
    const operator =
      record.operator === "neq" ||
      record.operator === "gt" ||
      record.operator === "gte" ||
      record.operator === "lt" ||
      record.operator === "lte"
        ? (record.operator as PreviewHavingRule["operator"])
        : "eq";
    const id =
      typeof record.id === "string" && record.id.trim().length > 0
        ? record.id.trim()
        : `having-${index}`;
    const valueKind =
      record.valueKind === "string" ||
      record.valueKind === "number" ||
      record.valueKind === "date" ||
      record.valueKind === "boolean"
        ? (record.valueKind as FilterValueKind)
        : "number";
    const value =
      typeof record.value === "string" ||
      typeof record.value === "number" ||
      typeof record.value === "boolean"
        ? String(record.value)
        : record.value === null
        ? "0"
        : undefined;
    clauses.push({
      id,
      aggregationId,
      operator,
      value,
      valueKind,
    });
  });
  return clauses;
};

const serializePreviewGroupingRules = (rules: PreviewGroupingRule[]): PreviewGroupingRuleDto[] =>
  rules.map((rule) => ({
    id: rule.id,
    source: rule.source,
    modelId: rule.source === "derived" ? null : rule.modelId ?? null,
    fieldId: rule.fieldId,
    bucket: rule.bucket ?? null,
  }));

const serializePreviewAggregationRules = (
  rules: PreviewAggregationRule[],
): PreviewAggregationRuleDto[] =>
  rules.map((rule) => ({
    id: rule.id,
    source: rule.source,
    modelId: rule.source === "derived" ? null : rule.modelId ?? null,
    fieldId: rule.fieldId,
    aggregation: rule.aggregation,
    alias: rule.alias ?? null,
  }));

const serializePreviewHavingRules = (rules: PreviewHavingRule[]): PreviewHavingRuleDto[] =>
  rules.map((rule) => ({
    id: rule.id,
    aggregationId: rule.aggregationId,
    operator: rule.operator,
    value: rule.value ?? "",
    valueKind: rule.valueKind,
  }));

const buildDerivedFieldPayloads = (
  fields: DerivedFieldDefinitionDto[],
): QueryConfigDerivedField[] => {
  return fields
    .map(ensureDerivedFieldMetadata)
    .filter(
      (field) =>
        isDerivedFieldVisibleInBuilder(field) &&
        field.expressionAst &&
        typeof field.expressionAst === "object",
    )
    .map((field) => ({
      id: field.id,
      alias: field.id,
      expressionAst: deepClone(field.expressionAst!) as DerivedFieldExpressionAst,
      referencedModels: field.referencedModels ?? [],
      joinDependencies: field.joinDependencies ?? [],
      modelGraphSignature: field.modelGraphSignature ?? null,
      compiledSqlHash: field.compiledSqlHash ?? null,
    }));
};

const evaluateJoinCoverage = (
  field: ReportDerivedField,
  joinLookup: ReadonlySet<string>,
): Array<{ pair: [string, string]; satisfied: boolean }> => {
  const referencedModels = getEffectiveReferencedModels(field);
  const dependencies =
    field.joinDependencies && field.joinDependencies.length > 0
      ? field.joinDependencies
      : buildModelPairs(referencedModels);
  if (!dependencies || dependencies.length === 0) {
    return [];
  }
  return dependencies.map((pair) => ({
    pair,
    satisfied: joinLookup.has(buildJoinKey(pair[0], pair[1])),
  }));
};

const validateDerivedFieldExpression = (value: string): string | null => {
  if (!value || value.trim().length === 0) {
    return "Expression is required.";
  }
  try {
    parseDerivedFieldExpression(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid expression.";
  }
};

const ensureDerivedFieldMetadata = (field: ReportDerivedField): ReportDerivedField => {
  if (field.expressionAst && field.referencedModels && field.referencedModels.length > 0) {
    return field;
  }
  try {
    const parsed = parseDerivedFieldExpression(field.expression);
    return {
      ...field,
      expressionAst: parsed.ast,
      referencedModels: parsed.referencedModels,
      referencedFields:
        field.referencedFields && Object.keys(field.referencedFields).length > 0
          ? field.referencedFields
          : parsed.referencedFields,
      joinDependencies:
        field.joinDependencies && field.joinDependencies.length > 0
          ? field.joinDependencies
          : buildModelPairs(parsed.referencedModels),
    };
  } catch {
    return field;
  }
};

const normalizeMetricSpotlights = (candidate: unknown): MetricSpotlightDefinitionDto[] => {
  if (!Array.isArray(candidate)) {
    return [];
  }

  const comparisonValues: ReadonlyArray<MetricSpotlightDefinitionDto["comparison"]> = [
    "previous",
    "wow",
    "mom",
    "yoy",
  ];
  const formatValues: ReadonlyArray<MetricSpotlightDefinitionDto["format"]> = [
    "number",
    "currency",
    "percentage",
  ];

  return candidate
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const metric = typeof record.metric === "string" ? record.metric.trim() : "";
      const label = typeof record.label === "string" ? record.label.trim() : "";
      if (!metric || !label) {
        return null;
      }
      const targetRaw = record.target;
      const numericTarget =
        typeof targetRaw === "number"
          ? targetRaw
          : typeof targetRaw === "string"
          ? Number(targetRaw)
          : undefined;
      const target =
        typeof numericTarget === "number" && Number.isFinite(numericTarget) ? numericTarget : undefined;
      const comparisonCandidate =
        typeof record.comparison === "string"
          ? (record.comparison as MetricSpotlightDefinitionDto["comparison"])
          : null;
      const comparison =
        comparisonCandidate && comparisonValues.includes(comparisonCandidate) ? comparisonCandidate : undefined;
      const formatCandidate =
        typeof record.format === "string" ? (record.format as MetricSpotlightDefinitionDto["format"]) : null;
      const format = formatCandidate && formatValues.includes(formatCandidate) ? formatCandidate : undefined;

      return {
        metric,
        label,
        ...(target !== undefined ? { target } : {}),
        ...(comparison ? { comparison } : {}),
        ...(format ? { format } : {}),
      };
    })
    .filter((entry): entry is MetricSpotlightDefinitionDto => Boolean(entry));
};

const mapTemplateFromApi = (template: ReportTemplateDto): ReportTemplate => {
  const rawColumnOrder = Array.isArray(template.columnOrder)
    ? template.columnOrder
    : Array.isArray(template.options?.columnOrder)
    ? template.options.columnOrder
    : [];

  const rawColumnAliases =
    (template.columnAliases && typeof template.columnAliases === "object" && template.columnAliases) ||
    (template.options?.columnAliases && typeof template.options.columnAliases === "object"
      ? template.options.columnAliases
      : {});

  const columnAliases = Object.entries(rawColumnAliases as Record<string, unknown>).reduce<
    Record<string, string>
  >((accumulator, [key, value]) => {
    if (typeof key === "string" && typeof value === "string") {
      accumulator[key] = value;
    }
    return accumulator;
  }, {});

  const queryConfig = normalizeQueryConfig(template.queryConfig);
  const derivedFields = reconcileDerivedFieldStatuses(
    normalizeDerivedFields(template.derivedFields).map((field) =>
      ensureDerivedFieldMetadata(field as ReportDerivedField),
    ),
    Array.isArray(template.models) ? template.models : [],
  );
  const metricsSpotlight = normalizeMetricSpotlights(template.metricsSpotlight);
  const previewOrder =
    Array.isArray(template.previewOrder) && template.previewOrder.length > 0
      ? normalizePreviewOrderRules(template.previewOrder)
      : Array.isArray(template.options?.previewOrder)
      ? normalizePreviewOrderRules(template.options.previewOrder)
      : [];
  const previewGrouping =
    Array.isArray(template.previewGrouping) && template.previewGrouping.length > 0
      ? normalizePreviewGroupingRules(template.previewGrouping)
      : Array.isArray(template.options?.previewGrouping)
      ? normalizePreviewGroupingRules(template.options.previewGrouping)
      : [];
  const previewAggregations =
    Array.isArray(template.previewAggregations) && template.previewAggregations.length > 0
      ? normalizePreviewAggregationRules(template.previewAggregations)
      : Array.isArray(template.options?.previewAggregations)
      ? normalizePreviewAggregationRules(template.options.previewAggregations)
      : [];
  const previewHaving =
    Array.isArray(template.previewHaving) && template.previewHaving.length > 0
      ? normalizePreviewHavingRules(template.previewHaving)
      : Array.isArray(template.options?.previewHaving)
      ? normalizePreviewHavingRules(template.options.previewHaving)
      : [];

  const columnOrder = rawColumnOrder.filter(
    (alias): alias is string => typeof alias === "string" && alias.length > 0,
  );
  const orderRank = new Map<string, number>();
  columnOrder.forEach((alias, index) => {
    if (!orderRank.has(alias)) {
      orderRank.set(alias, index);
    }
  });

  const mappedFields: Array<{ modelId: string; fieldIds: string[] }> = Array.isArray(template.fields)
    ? template.fields
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const modelId = typeof entry.modelId === "string" ? entry.modelId : null;
          const fieldIds = Array.isArray(entry.fieldIds)
            ? entry.fieldIds.filter((fieldId): fieldId is string => typeof fieldId === "string")
            : [];
          if (!modelId) {
            return null;
          }
          const sortedFieldIds = [...fieldIds].sort((a, b) => {
            const aliasA = toColumnAlias(modelId, a);
            const aliasB = toColumnAlias(modelId, b);
            const rankA = orderRank.get(aliasA);
            const rankB = orderRank.get(aliasB);
            if (rankA === undefined && rankB === undefined) {
              return fieldIds.indexOf(a) - fieldIds.indexOf(b);
            }
            if (rankA === undefined) {
              return 1;
            }
            if (rankB === undefined) {
              return -1;
            }
            return rankA - rankB;
          });

          return {
            modelId,
            fieldIds: sortedFieldIds,
          };
        })
        .filter((entry): entry is { modelId: string; fieldIds: string[] } => Boolean(entry))
    : [];

  const visuals: VisualDefinition[] = Array.isArray(template.visuals)
    ? template.visuals
        .map((entry, index): VisualDefinition | null => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const candidate = entry as Record<string, unknown>;
          const idCandidate = typeof candidate.id === "string" ? candidate.id.trim() : "";
          const nameCandidate = typeof candidate.name === "string" ? candidate.name.trim() : "";
          const metricCandidate =
            typeof candidate.metric === "string" ? candidate.metric.trim() : "";
          const dimensionCandidate =
            typeof candidate.dimension === "string" ? candidate.dimension.trim() : "";
          const comparisonCandidate =
            typeof candidate.comparison === "string" && candidate.comparison.trim().length > 0
              ? candidate.comparison.trim()
              : undefined;
        const typeCandidate = VISUAL_TYPE_SET.has(candidate.type as VisualDefinition["type"])
          ? (candidate.type as VisualDefinition["type"])
          : "line";
          const metricAggregationCandidate =
            typeof candidate.metricAggregation === "string"
              ? (candidate.metricAggregation as QueryConfigMetric["aggregation"])
              : null;
          const comparisonAggregationCandidate =
            typeof candidate.comparisonAggregation === "string"
              ? (candidate.comparisonAggregation as QueryConfigMetric["aggregation"])
              : null;
          const dimensionBucketCandidate =
            typeof candidate.dimensionBucket === "string"
              ? (candidate.dimensionBucket as QueryConfigDimension["bucket"])
              : null;
          const limitCandidate =
            typeof candidate.limit === "number"
              ? candidate.limit
              : typeof candidate.limit === "string"
              ? Number(candidate.limit)
              : null;

          const metricAggregation = METRIC_AGGREGATIONS.includes(
            (metricAggregationCandidate ?? "sum") as QueryConfigMetric["aggregation"],
          )
            ? (metricAggregationCandidate ?? "sum")
            : "sum";
          const dimensionBucket =
            dimensionBucketCandidate && DIMENSION_BUCKETS.includes(dimensionBucketCandidate)
              ? dimensionBucketCandidate
              : undefined;
          const comparisonAggregation =
            comparisonCandidate &&
            comparisonAggregationCandidate &&
            METRIC_AGGREGATIONS.includes(comparisonAggregationCandidate)
              ? comparisonAggregationCandidate
              : undefined;
          const limit =
            limitCandidate !== null && Number.isFinite(limitCandidate) && limitCandidate > 0
              ? Math.round(Number(limitCandidate))
              : 100;

          const visual: VisualDefinition = {
            id: idCandidate.length > 0 ? idCandidate : `visual-${index}`,
            name: nameCandidate.length > 0 ? nameCandidate : `Visual ${index + 1}`,
            type: typeCandidate,
            metric: metricCandidate,
            dimension: dimensionCandidate,
            metricAggregation,
            dimensionBucket,
            limit,
          };

          if (comparisonCandidate) {
            visual.comparison = comparisonCandidate;
            if (comparisonAggregation) {
              visual.comparisonAggregation = comparisonAggregation;
            }
          }

          return visual;
        })
        .filter((visual): visual is VisualDefinition => visual !== null)
    : [];

  return {
    id: template.id,
    name: template.name ?? "Untitled report",
    category: template.category ?? "Custom",
    description: template.description ?? "",
    schedule: template.schedule ?? "Manual",
    lastUpdated: formatLastUpdatedLabel(template.updatedAt),
    owner: template.owner?.name ?? "Shared",
  autoDistribution: template.options?.autoDistribution ?? true,
  notifyTeam: template.options?.notifyTeam ?? true,
  autoRunOnOpen: template.options?.autoRunOnOpen ?? false,
    models: Array.isArray(template.models) ? template.models : [],
    fields: mappedFields,
    joins: Array.isArray(template.joins) ? (template.joins as JoinCondition[]) : [],
    visuals: visuals.length > 0 ? visuals : [DEFAULT_VISUAL],
    metrics: Array.isArray(template.metrics)
      ? template.metrics.filter(
          (metric): metric is string =>
            typeof metric === "string" && metric.trim().length > 0 && metric.includes("__"),
        )
      : [],
    filters: Array.isArray(template.filters) ? (template.filters as ReportFilter[]) : [],
    columnOrder,
    columnAliases,
    queryConfig,
    derivedFields,
    metricsSpotlight,
    previewOrder,
    previewGrouping,
    previewAggregations,
    previewHaving,
  };
};

const mapDerivedFieldDtoToReportField = (field: DerivedFieldDto): ReportDerivedField =>
  ensureDerivedFieldMetadata({
    id: field.id,
    name: field.name,
    expression: field.expression,
    kind: field.kind,
    scope: field.scope,
    metadata: field.metadata ?? {},
    expressionAst: field.expressionAst ?? undefined,
    referencedModels: field.referencedModels ?? [],
    referencedFields: field.referencedFields ?? {},
    joinDependencies: field.joinDependencies ?? [],
    modelGraphSignature: field.modelGraphSignature ?? null,
    compiledSqlHash: field.compiledSqlHash ?? null,
    status: field.status,
  });

const extractAxiosErrorMessage = (error: unknown, fallback: string): string => {
  const axiosError = error as AxiosError<{ error?: string; message?: string }> | undefined;
  return (
    axiosError?.response?.data?.error ??
    axiosError?.response?.data?.message ??
    axiosError?.message ??
    fallback
  );
};

const Reports = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const {
    data: backendModelsResponse,
    isLoading: isModelsLoading,
    isError: isModelsError,
  } = useReportModels();

  const dataModels = useMemo(() => {
    const models = backendModelsResponse?.models ?? [];
    return models.map(mapBackendModel);
  }, [backendModelsResponse]);

  const queryClient = useQueryClient();
  const { mutateAsync: runPreview, isPending: isPreviewLoading } = useRunReportPreview();
  const { mutateAsync: runAnalyticsQuery, isPending: isAnalyticsMutationPending } = useRunReportQuery();
  const dashboardsQuery = useReportDashboards({ search: "" });
  const dashboards = useMemo(
    () => dashboardsQuery.data?.dashboards ?? [],
    [dashboardsQuery.data?.dashboards],
  );
  const dashboardOptions = useMemo(
    () =>
      dashboards.map((dashboard) => ({
        value: dashboard.id,
        label: dashboard.name && dashboard.name.trim().length > 0 ? dashboard.name : "Untitled dashboard",
      })),
    [dashboards],
  );
  const hasDashboardTargets = dashboardOptions.length > 0;

  const {
    data: templatesResponse,
    isLoading: isTemplatesLoading,
    isError: isTemplatesError,
  } = useReportTemplates();

  const saveTemplateMutation = useSaveReportTemplate();
  const deleteTemplateMutation = useDeleteReportTemplate();
  const updateDerivedFieldMutation = useUpdateDerivedField();
  const upsertDashboardCardMutation = useUpsertDashboardCard();

  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [draft, setDraft] = useState<ReportTemplate>(createEmptyTemplate());
  const [lastRunAt, setLastRunAt] = useState<string>("Not run yet");
  const [previewResult, setPreviewResult] = useState<ReportPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [manualJoinDraft, setManualJoinDraft] = useState<ManualJoinDraft>(() => createManualJoinDraft());
  const [visualResult, setVisualResult] = useState<ReportQuerySuccessResponse | null>(null);
  const [visualQueryError, setVisualQueryError] = useState<string | null>(null);
  const [visualWarnings, setVisualWarnings] = useState<string[]>([]);
  const [visualJob, setVisualJob] = useState<{ jobId: string; hash?: string } | null>(null);
  const [visualJobStatus, setVisualJobStatus] = useState<ReportQueryJobResponse["status"] | null>(null);
  const [isVisualQueryRunning, setIsVisualQueryRunning] = useState(false);
  const [visualExecutedAt, setVisualExecutedAt] = useState<string | null>(null);
  const [previewSql, setPreviewSql] = useState<string | null>(null);
  const [visualSql, setVisualSql] = useState<string | null>(null);
  const [templateSearch, setTemplateSearch] = useState<string>("");
  const [debouncedTemplateSearch] = useDebouncedValue(templateSearch, 250);
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<string>("all");
  const handleRunAnalysisRef = useRef<() => void>(() => {});
  const autoRunTemplateIdRef = useRef<string | null>(null);
  const [dashboardCardDraft, setDashboardCardDraft] = useState<DashboardCardModalDraft | null>(null);
  const [isDashboardModalOpen, setDashboardModalOpen] = useState(false);
  const [selectedDashboardIdForModal, setSelectedDashboardIdForModal] = useState<string | null>(null);
  const [dashboardCardTitle, setDashboardCardTitle] = useState("");
  const [dashboardModalError, setDashboardModalError] = useState<string | null>(null);
  const [templateSuccess, setTemplateSuccess] = useState<string | null>(null);
  const [isDerivedFieldsDrawerOpen, setDerivedFieldsDrawerOpen] = useState(false);
  const [selectedDerivedFieldId, setSelectedDerivedFieldId] = useState<string | null>(() =>
    draft.derivedFields[0]?.id ?? null,
  );
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [derivedFieldDraft, setDerivedFieldDraft] = useState<{
    expression: string;
    lastSaved: string;
    error: string | null;
  }>({
    expression: "",
    lastSaved: "",
    error: null,
  });

  const derivedFieldsTemplateId =
    draft.id && draft.id !== "template-empty" ? draft.id : undefined;
  const templateDerivedFieldsQuery = useDerivedFields(derivedFieldsTemplateId);
  const [scheduleDraft, setScheduleDraft] = useState(() => {
    const timezoneGuess = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
      } catch {
        return "UTC";
      }
    })();
    return {
      cadence: SCHEDULE_OPTIONS[1]?.value ?? SCHEDULE_OPTIONS[0]?.value ?? "Manual",
      timezone: timezoneGuess,
      recipients: "",
      status: "active" as ScheduleStatus,
    };
  });
  const [activeScheduleMutationId, setActiveScheduleMutationId] = useState<string | null>(null);
  const createScheduleMutation = useCreateTemplateSchedule();
  const updateScheduleMutation = useUpdateTemplateSchedule();
  const deleteScheduleMutation = useDeleteTemplateSchedule();
  const exportTemplateMutation = useExportReportTemplate();
  const upsertTemplateInCache = useCallback(
    (record: ReportTemplateDto) => {
      queryClient.setQueryData<ReportTemplateListResponse>(["reports", "templates"], (current) => {
        if (!current) {
          return { templates: [record] };
        }
        const exists = current.templates.some((template) => template.id === record.id);
        return {
          templates: exists
            ? current.templates.map((template) => (template.id === record.id ? record : template))
            : [...current.templates, record],
        };
      });
    },
    [queryClient],
  );

  const removeTemplateFromCache = useCallback(
    (templateId: string) => {
      queryClient.setQueryData<ReportTemplateListResponse>(["reports", "templates"], (current) => {
        if (!current) {
          return current;
        }
        return {
          templates: current.templates.filter((template) => template.id !== templateId),
        };
      });
    },
    [queryClient],
  );

  useEffect(() => {
    if (!templatesResponse) {
      return;
    }

    setTemplateError(null);
    const mapped = templatesResponse.templates.map((template) => mapTemplateFromApi(template));
    setTemplates(mapped);

    if (!selectedTemplateId && mapped.length > 0) {
      setSelectedTemplateId(mapped[0].id);
    }
  }, [templatesResponse, selectedTemplateId]);

  const categoryOptions = useMemo(() => {
    const categories = new Set<string>();
    templates.forEach((template) => {
      if (template.category && template.category.trim().length > 0) {
        categories.add(template.category);
      }
    });
    return Array.from(categories).sort((first, second) => first.localeCompare(second));
  }, [templates]);

  const categorySelectOptions = useMemo(
    () => [
      { value: "all", label: "All categories" },
      ...categoryOptions.map((category) => ({ value: category, label: category })),
    ],
    [categoryOptions],
  );

  const highlightQuery = useMemo(() => debouncedTemplateSearch.trim(), [debouncedTemplateSearch]);

  const filteredTemplates = useMemo(() => {
    const normalizedSearch = debouncedTemplateSearch.trim().toLowerCase();
    const normalizedCategory = templateCategoryFilter.toLowerCase();

    return templates.filter((template) => {
      const templateCategory = (template.category ?? "").toLowerCase();
      const matchesCategory =
        normalizedCategory === "all" || templateCategory === normalizedCategory;

      if (!matchesCategory) {
        return false;
      }

      if (normalizedSearch.length === 0) {
        return true;
      }

      const haystack = [
        template.name,
        template.description,
        template.owner,
        template.category,
      ]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase());

      return haystack.some((value) => value.includes(normalizedSearch));
    });
  }, [debouncedTemplateSearch, templateCategoryFilter, templates]);

  useEffect(() => {
    dispatch(navigateToPage("Reports"));
  }, [dispatch, props.title]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId),
    [selectedTemplateId, templates]
  );

  useEffect(() => {
    if (selectedTemplate) {
      setDraft(deepClone(selectedTemplate));
    }
  }, [selectedTemplate]);

  const modelMap = useMemo(() => {
    const map = new Map<string, DataModelDefinition>();
    dataModels.forEach((model) => map.set(model.id, model));
    return map;
  }, [dataModels]);

  const selectedModels = useMemo(
    () =>
      draft.models
        .map((modelId) => modelMap.get(modelId))
        .filter((value): value is DataModelDefinition => Boolean(value)),
    [draft.models, modelMap]
  );

  const selectedFieldDetails = useMemo<SelectedFieldDetail[]>(() => {
    const details: SelectedFieldDetail[] = [];

    draft.fields.forEach((entry) => {
      const model = modelMap.get(entry.modelId);
      if (!model) {
        return;
      }

      entry.fieldIds.forEach((fieldId) => {
        const field = model.fields.find((candidate) => candidate.id === fieldId);
        if (!field) {
          return;
        }

        const aliasKey = toColumnAlias(model.id, field.id);
        const aliasValue = draft.columnAliases[aliasKey];

        const detail: SelectedFieldDetail = {
          ...field,
          modelId: model.id,
          modelName: model.name,
          source: "model",
        };

        if (aliasValue !== undefined) {
          detail.alias = aliasValue;
        }

        details.push(detail);
      });
    });

    return details;
  }, [draft.columnAliases, draft.fields, modelMap]);

  const fieldDetailByAlias = useMemo(() => {
    const map = new Map<string, SelectedFieldDetail>();
    selectedFieldDetails.forEach((detail) => {
      map.set(toColumnAlias(detail.modelId, detail.id), detail);
    });
    draft.derivedFields.forEach((field) => {
      if (!isDerivedFieldVisibleInBuilder(field)) {
        map.delete(field.id);
        return;
      }
      if (map.has(field.id)) {
        return;
      }
      map.set(field.id, {
        id: field.id,
        label: field.name,
        type: "number",
        modelId: DERIVED_FIELD_SENTINEL,
        modelName: field.scope === "workspace" ? "Workspace derived field" : "Template derived field",
        sourceColumn: field.expression,
        source: "derived",
        derivedFieldId: field.id,
      });
    });
    return map;
  }, [draft.derivedFields, selectedFieldDetails]);
  const derivedFieldMap = useMemo(() => {
    return new Map(draft.derivedFields.map((field) => [field.id, field]));
  }, [draft.derivedFields]);
  const enabledDerivedFieldCount = useMemo(
    () => draft.derivedFields.filter((field) => isDerivedFieldVisibleInBuilder(field)).length,
    [draft.derivedFields],
  );
  const totalFieldInventoryCount = selectedFieldDetails.length + enabledDerivedFieldCount;
  const derivedFieldPayloads = useMemo(
    () => buildDerivedFieldPayloads(draft.derivedFields),
    [draft.derivedFields],
  );
  const staleDerivedFields = useMemo(
    () => draft.derivedFields.filter((field) => field.status === "stale"),
    [draft.derivedFields],
  );
  const hasStaleDerivedFields = staleDerivedFields.length > 0;
  const staleDerivedFieldNames = staleDerivedFields.map((field) => field.name).join(", ");
  useEffect(() => {
    if (draft.derivedFields.length === 0) {
      setSelectedDerivedFieldId(null);
      return;
    }
    if (!selectedDerivedFieldId || !draft.derivedFields.some((field) => field.id === selectedDerivedFieldId)) {
      setSelectedDerivedFieldId(draft.derivedFields[0].id);
    }
  }, [draft.derivedFields, selectedDerivedFieldId]);
  const selectedDerivedField = useMemo(
    () =>
      draft.derivedFields.find((field) => field.id === selectedDerivedFieldId) ??
      draft.derivedFields[0] ??
      null,
    [draft.derivedFields, selectedDerivedFieldId],
  );
  useEffect(() => {
    if (selectedDerivedField) {
      setDerivedFieldDraft({
        expression: selectedDerivedField.expression,
        lastSaved: selectedDerivedField.expression,
        error: null,
      });
    } else {
      setDerivedFieldDraft({
        expression: "",
        lastSaved: "",
        error: null,
      });
    }
  }, [selectedDerivedField]);

  useEffect(() => {
    if (!derivedFieldsTemplateId || !templateDerivedFieldsQuery.data?.derivedFields) {
      return;
    }
    const fetchedMap = new Map(
      templateDerivedFieldsQuery.data.derivedFields.map((dto) => [
        dto.id,
        mapDerivedFieldDtoToReportField(dto),
      ]),
    );
    if (fetchedMap.size === 0) {
      return;
    }
    setDraft((current) => {
      if (current.id !== derivedFieldsTemplateId) {
        return current;
      }
      let mutated = false;
      const merged: ReportDerivedField[] = current.derivedFields.map((field) => {
        const remote = fetchedMap.get(field.id);
        if (!remote) {
          return field;
        }
        fetchedMap.delete(field.id);
        const hasChanged =
          field.expression !== remote.expression ||
          field.compiledSqlHash !== remote.compiledSqlHash ||
          field.modelGraphSignature !== remote.modelGraphSignature ||
          (field.expressionAst ? JSON.stringify(field.expressionAst) : null) !==
            (remote.expressionAst ? JSON.stringify(remote.expressionAst) : null);
        if (hasChanged) {
          mutated = true;
          return remote;
        }
        return field;
      });
      fetchedMap.forEach((field) => {
        merged.push(field);
        mutated = true;
      });
      if (!mutated) {
        return current;
      }
      return {
        ...current,
        derivedFields: reconcileDerivedFieldStatuses(merged, current.models),
      };
    });
  }, [derivedFieldsTemplateId, templateDerivedFieldsQuery.data]);
  const joinCoverageLookup = useMemo(() => {
    const lookup = new Set<string>();
    draft.joins.forEach((join) => {
      if (typeof join.leftModel === "string" && typeof join.rightModel === "string") {
        lookup.add(buildJoinKey(join.leftModel, join.rightModel));
      }
    });
    return lookup;
  }, [draft.joins]);
  const fieldPaletteEntries = useMemo(() => {
    return draft.fields
      .map((selection) => {
        const model = modelMap.get(selection.modelId);
        if (!model) {
          return null;
        }
        const activeFields =
          selection.fieldIds.length > 0
            ? model.fields.filter((field) => selection.fieldIds.includes(field.id))
            : model.fields;
        if (activeFields.length === 0) {
          return null;
        }
        return { model, fields: activeFields };
      })
      .filter(
        (entry): entry is { model: DataModelDefinition; fields: DataField[] } => entry !== null,
      );
  }, [draft.fields, modelMap]);
  const selectedDerivedFieldCoverage = useMemo(
    () =>
      selectedDerivedField
        ? evaluateJoinCoverage(selectedDerivedField, joinCoverageLookup)
        : [],
    [joinCoverageLookup, selectedDerivedField],
  );
  const derivedFieldPreviewSamples = useMemo(() => {
    if (!selectedDerivedField || !previewResult?.rows || !previewResult?.columns) {
      return null;
    }
    const alias = selectedDerivedField.id;
    if (!previewResult.columns.includes(alias)) {
      return null;
    }
    const rows = previewResult.rows.slice(0, 20).map((row, index) => ({
      key: `${alias}-${index}`,
      value: (row as Record<string, unknown>)[alias],
    }));
    return { alias, rows };
  }, [previewResult?.rows, previewResult?.columns, selectedDerivedField]);
  const derivedExpressionHasChanges = useMemo(
    () =>
      Boolean(
        selectedDerivedField &&
          derivedFieldDraft.expression !== derivedFieldDraft.lastSaved,
      ),
    [derivedFieldDraft.expression, derivedFieldDraft.lastSaved, selectedDerivedField],
  );
  const joinModelOptions = useMemo(() => {
    return draft.models
      .map((modelId) => modelMap.get(modelId))
      .filter((value): value is DataModelDefinition => Boolean(value))
      .map((model) => ({
        value: model.id,
        label: model.name,
      }));
  }, [draft.models, modelMap]);

  const getFieldOptions = useCallback(
    (modelId: string) => {
      const model = modelMap.get(modelId);
      if (!model) {
        return [];
      }
      return model.fields.map((field) => ({
        value: field.id,
        label: field.label ?? humanizeName(field.id),
      }));
    },
    [modelMap],
  );

  const updateManualJoinDraft = useCallback(
    (patch: Partial<ManualJoinDraft>) => {
      setManualJoinDraft((current) => {
        const next = { ...current, ...patch };
        if (patch.leftModelId !== undefined) {
          const model = modelMap.get(patch.leftModelId);
          next.leftFieldId = patch.leftModelId && model ? model.fields[0]?.id ?? "" : "";
        }
        if (patch.rightModelId !== undefined) {
          const model = modelMap.get(patch.rightModelId);
          next.rightFieldId = patch.rightModelId && model ? model.fields[0]?.id ?? "" : "";
        }
        return next;
      });
      if (templateError === "This join already exists.") {
        setTemplateError(null);
      }
    },
    [modelMap, templateError],
  );

  useEffect(() => {
    setManualJoinDraft((current) => {
      let changed = false;
      let leftModelId = current.leftModelId;
      let leftFieldId = current.leftFieldId;
      if (leftModelId && !draft.models.includes(leftModelId)) {
        leftModelId = "";
        leftFieldId = "";
        changed = true;
      } else if (leftModelId) {
        const model = modelMap.get(leftModelId);
        const hasField = model?.fields.some((field) => field.id === leftFieldId);
        if (!hasField) {
          leftFieldId = model?.fields[0]?.id ?? "";
          changed = true;
        }
      }

      let rightModelId = current.rightModelId;
      let rightFieldId = current.rightFieldId;
      if (rightModelId && !draft.models.includes(rightModelId)) {
        rightModelId = "";
        rightFieldId = "";
        changed = true;
      } else if (rightModelId) {
        const model = modelMap.get(rightModelId);
        const hasField = model?.fields.some((field) => field.id === rightFieldId);
        if (!hasField) {
          rightFieldId = model?.fields[0]?.id ?? "";
          changed = true;
        }
      }

      if (!changed) {
        return current;
      }

      return {
        ...current,
        leftModelId,
        leftFieldId,
        rightModelId,
        rightFieldId,
      };
    });
  }, [draft.models, modelMap]);

  const joinModelsAvailable = joinModelOptions.length >= 2;
  const canSubmitManualJoin =
    Boolean(manualJoinDraft.leftModelId) &&
    Boolean(manualJoinDraft.leftFieldId) &&
    Boolean(manualJoinDraft.rightModelId) &&
    Boolean(manualJoinDraft.rightFieldId);

  const filterFieldOptions = useMemo<FilterFieldOption[]>(() => {
    const baseOptions = draft.models.flatMap((modelId) => {
      const model = modelMap.get(modelId);
      if (!model) {
        return [];
      }
      return model.fields.map((field) => ({
        value: buildFilterOptionKey(model.id, field.id),
        label: `${model.name} • ${field.label}`,
        modelId: model.id,
        fieldId: field.id,
        field,
        source: "model" as const,
      }));
    });

    const derivedOptions = draft.derivedFields
      .filter((field) => isDerivedFieldVisibleInBuilder(field))
      .map((field) => ({
        value: buildFilterOptionKey(DERIVED_FIELD_SENTINEL, field.id),
        label: `Derived • ${field.name}`,
        modelId: DERIVED_FIELD_SENTINEL,
        fieldId: field.id,
        field: {
          id: field.id,
          label: field.name,
          type: "number",
          sourceColumn: field.expression,
        } as DataField,
        source: "derived" as const,
      }));

    return [...baseOptions, ...derivedOptions];
  }, [draft.derivedFields, draft.models, modelMap]);

  const numericFilterFieldOptions = useMemo(
    () =>
      filterFieldOptions.filter((option) =>
        ["number", "currency", "percentage", "id"].includes(option.field.type),
      ),
    [filterFieldOptions],
  );

  const filterFieldLookup = useMemo(() => {
    const lookup = new Map<string, FilterFieldOption>();
    filterFieldOptions.forEach((option) => {
      lookup.set(buildFilterOptionKey(option.modelId, option.fieldId), option);
    });
    return lookup;
  }, [filterFieldOptions]);

  const previewColumnsFromSelection = useMemo(() => {
    const columns = previewResult?.columns ?? [];
    if (columns.length === 0) {
      return columns;
    }

    const orderedAliases = draft.fields.flatMap((entry) =>
      entry.fieldIds
        .filter((fieldId): fieldId is string => Boolean(fieldId))
        .map((fieldId) => toColumnAlias(entry.modelId, fieldId)),
    );

    if (orderedAliases.length === 0) {
      return columns;
    }

    const columnSet = new Set(columns);
    const seen = new Set<string>();
    const ordered: string[] = [];

    orderedAliases.forEach((alias) => {
      if (!seen.has(alias) && columnSet.has(alias)) {
        ordered.push(alias);
        seen.add(alias);
      }
    });

    columns.forEach((alias) => {
      if (!seen.has(alias)) {
        ordered.push(alias);
        seen.add(alias);
      }
    });

    return ordered;
  }, [draft.fields, previewResult]);

  useEffect(() => {
    setDraft((current) => {
      if (!current || current.columnOrder.length === 0) {
        return current;
      }
      const allowed = new Set(previewColumnsFromSelection);
      const sanitized = current.columnOrder.filter((alias) => allowed.has(alias));
      if (arraysShallowEqual(current.columnOrder, sanitized)) {
        return current;
      }
      return {
        ...current,
        columnOrder: sanitized,
      };
    });
  }, [previewColumnsFromSelection]);

  useEffect(() => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const selectedAliases = new Set(
        current.fields.flatMap((entry) =>
          entry.fieldIds
            .filter((fieldId): fieldId is string => Boolean(fieldId))
            .map((fieldId) => toColumnAlias(entry.modelId, fieldId)),
        ),
      );
      const aliasEntries = Object.entries(current.columnAliases);
      const sanitizedEntries = aliasEntries.filter(
        ([aliasKey, label]) => selectedAliases.has(aliasKey) && typeof label === "string" && label.trim().length > 0,
      );
      const sanitizedMap = sanitizedEntries.reduce<Record<string, string>>((accumulator, [key, value]) => {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          accumulator[key] = trimmed;
        }
        return accumulator;
      }, {});
      if (recordsShallowEqual(current.columnAliases, sanitizedMap)) {
        return current;
      }
      return {
        ...current,
        columnAliases: sanitizedMap,
      };
    });
  }, [draft.fields]);

  const previewColumns = useMemo(() => {
    if (previewColumnsFromSelection.length === 0) {
      return previewColumnsFromSelection;
    }

    const baseSet = new Set(previewColumnsFromSelection);
    const sanitizedOverrides = draft.columnOrder.filter((alias) => baseSet.has(alias));
    const remainder = previewColumnsFromSelection.filter((alias) => !sanitizedOverrides.includes(alias));

    return [...sanitizedOverrides, ...remainder];
  }, [draft.columnOrder, previewColumnsFromSelection]);
  const previewRows = useMemo(
    () => previewResult?.rows ?? [],
    [previewResult],
  );

  const movePreviewColumn = useCallback(
    (alias: string, direction: "left" | "right") => {
      const delta = direction === "left" ? -1 : 1;
      const workingOrder = previewColumns;
      const currentIndex = workingOrder.indexOf(alias);
      if (currentIndex === -1) {
        return;
      }
      const targetIndex = currentIndex + delta;
      if (targetIndex < 0 || targetIndex >= workingOrder.length) {
        return;
      }
      const nextOrder = [...workingOrder];
      const [moved] = nextOrder.splice(currentIndex, 1);
      nextOrder.splice(targetIndex, 0, moved);
      setDraft((current) => ({
        ...current,
        columnOrder: nextOrder,
      }));
    },
    [previewColumns],
  );

  const previewColumnMetadata = useMemo(() => {
    return new Map<string, PreviewColumnMeta>(
      previewColumns.map((alias) => {
        const derivedField = derivedFieldMap.get(alias);
        if (derivedField) {
          return [
            alias,
            {
              alias,
              fieldLabel: derivedField.name || humanizeAlias(alias),
              customLabel: draft.columnAliases[alias],
              modelName: derivedField.scope === "workspace" ? "Workspace derived field" : "Template derived field",
              sourceColumn: derivedField.expression,
            },
          ];
        }
        const [rawModelId, rawFieldId] = alias.split("__");
        const fieldId = rawFieldId && rawFieldId.length > 0 ? rawFieldId : undefined;
        const modelId = fieldId ? rawModelId : undefined;
        const model = modelId ? modelMap.get(modelId) : undefined;
        const field = model?.fields.find((candidate) => candidate.id === fieldId);
        return [
          alias,
          {
            alias,
            fieldLabel: field?.label ?? humanizeAlias(alias),
            customLabel: draft.columnAliases[alias],
            modelName: model?.name,
            modelId,
            tableName: model?.tableName,
            fieldId,
            sourceColumn: field?.sourceColumn,
          },
        ];
      }),
    );
  }, [derivedFieldMap, draft.columnAliases, modelMap, previewColumns]);

  const getColumnLabel = useCallback(
    (alias: string) => {
      if (!alias) {
        return "Select column";
      }
      const metadata = previewColumnMetadata.get(alias);
      return metadata?.customLabel ?? metadata?.fieldLabel ?? humanizeAlias(alias);
    },
    [previewColumnMetadata],
  );

  const previewColumnSets = useMemo(() => {
    const numeric = new Set<string>();
    const textual = new Set<string>();
    const boolean = new Set<string>();

    previewColumns.forEach((column) => {
      let hasNumeric = false;
      let hasText = false;
      let hasBoolean = false;

      previewRows.forEach((row) => {
        const value = row[column];
        if (value === null || value === undefined) {
          return;
        }
        if (typeof value === "number") {
          if (Number.isFinite(value)) {
            hasNumeric = true;
          }
          return;
        }
        if (typeof value === "boolean") {
          hasBoolean = true;
          return;
        }
        if (value instanceof Date) {
          hasNumeric = true;
          hasText = true;
          return;
        }
        if (typeof value === "string") {
          const numericCandidate = Number(value.replace(/[^0-9.\-]+/g, ""));
          if (Number.isFinite(numericCandidate) && value.trim().length > 0) {
            hasNumeric = true;
          }
          hasText = true;
          return;
        }
        hasText = true;
      });

      if (hasNumeric) {
        numeric.add(column);
      }
      if (hasText) {
        textual.add(column);
      }
      if (hasBoolean) {
        boolean.add(column);
      }
    });

    return { numeric, textual, boolean };
  }, [previewColumns, previewRows]);

  const numericColumnsSet = previewColumnSets.numeric;
  const textualColumnsSet = previewColumnSets.textual;
  const orderedNumericColumns = useMemo(
    () => previewColumns.filter((alias) => numericColumnsSet.has(alias)),
    [numericColumnsSet, previewColumns],
  );
  const orderedTextualColumns = useMemo(
    () => previewColumns.filter((alias) => textualColumnsSet.has(alias)),
    [previewColumns, textualColumnsSet],
  );

  const metricOptions = useMemo(
    () =>
      orderedNumericColumns.map((alias) => ({
        value: alias,
        label: getColumnLabel(alias),
      })),
    [getColumnLabel, orderedNumericColumns],
  );

  const dimensionOptions = useMemo(
    () =>
      orderedTextualColumns.map((alias) => ({
        value: alias,
        label: getColumnLabel(alias),
      })),
    [getColumnLabel, orderedTextualColumns],
  );

  useEffect(() => {
    setDraft((current) => {
      const numericSet = new Set(orderedNumericColumns);
      const textualSet = new Set(orderedTextualColumns);

      const sanitizedMetrics =
        orderedNumericColumns.length === 0
          ? current.metrics
          : current.metrics.filter((alias) => numericSet.has(alias));
      let metricsChanged = sanitizedMetrics.length !== current.metrics.length;

      const baseVisuals = current.visuals.length > 0 ? current.visuals : [DEFAULT_VISUAL];
      let visualsChanged = baseVisuals.length !== current.visuals.length;

      const sanitizedVisuals = baseVisuals.map((visual, index) => {
        const metricAlias =
          visual.metric &&
          (numericSet.has(visual.metric) || orderedNumericColumns.length === 0)
            ? visual.metric
            : orderedNumericColumns[0] ?? "";
        const dimensionAlias =
          visual.dimension &&
          (textualSet.has(visual.dimension) || orderedTextualColumns.length === 0)
            ? visual.dimension
            : orderedTextualColumns[0] ?? "";
        const comparisonAlias =
          visual.comparison &&
          (numericSet.has(visual.comparison) || orderedNumericColumns.length === 0) &&
          visual.comparison !== metricAlias
            ? visual.comparison
            : undefined;
        const normalizedType = VISUAL_TYPE_SET.has(visual.type as VisualDefinition["type"])
          ? (visual.type as VisualDefinition["type"])
          : "line";
        const name = visual.name && visual.name.trim().length > 0 ? visual.name : `Visual ${index + 1}`;
        const id = visual.id && visual.id.trim().length > 0 ? visual.id : `visual-${index}`;
        const metricAggregation =
          visual.metricAggregation && METRIC_AGGREGATIONS.includes(visual.metricAggregation)
            ? visual.metricAggregation
            : "sum";
        const dimensionBucket =
          visual.dimensionBucket && DIMENSION_BUCKETS.includes(visual.dimensionBucket)
            ? visual.dimensionBucket
            : undefined;
        const comparisonAggregation =
          visual.comparisonAggregation && METRIC_AGGREGATIONS.includes(visual.comparisonAggregation)
            ? visual.comparisonAggregation
            : undefined;
        const limitValue =
          typeof visual.limit === "number" && Number.isFinite(visual.limit) && visual.limit > 0
            ? Math.round(visual.limit)
            : 100;

        const nextVisual: VisualDefinition = {
          id,
          name,
          type: normalizedType,
          metric: metricAlias,
          dimension: dimensionAlias,
          metricAggregation,
          dimensionBucket,
          limit: limitValue,
        };
        if (comparisonAlias) {
          nextVisual.comparison = comparisonAlias;
          if (comparisonAggregation) {
            nextVisual.comparisonAggregation = comparisonAggregation;
          }
        }

        if (
          metricAlias !== visual.metric ||
          dimensionAlias !== visual.dimension ||
          comparisonAlias !== visual.comparison ||
          normalizedType !== visual.type ||
          name !== visual.name ||
          id !== visual.id ||
          nextVisual.metricAggregation !== visual.metricAggregation ||
          nextVisual.dimensionBucket !== visual.dimensionBucket ||
          nextVisual.comparisonAggregation !== visual.comparisonAggregation ||
          nextVisual.limit !== visual.limit
        ) {
          visualsChanged = true;
        }

        return nextVisual;
      });

      if (!metricsChanged && !visualsChanged) {
        return current;
      }

      const result: ReportTemplate = {
        ...current,
        metrics: sanitizedMetrics,
        visuals: sanitizedVisuals as VisualDefinition[],
      };

      return result;
    });
  }, [orderedNumericColumns, orderedTextualColumns]);

  const activeVisual = draft.visuals[0] ?? DEFAULT_VISUAL;
  const buildVisualDescriptor = useCallback(
    (visual: VisualDefinition | null): VisualQueryDescriptor => {
      const emptyDescriptor: VisualQueryDescriptor = {
        config: null,
        metricAlias: null,
        dimensionAlias: null,
        comparisonAlias: null,
        metricBaseAlias: null,
        dimensionBaseAlias: null,
        metricLabel: "Metric",
        dimensionLabel: "Dimension",
        comparisonLabel: undefined,
        warnings: [],
      };

      if (draft.models.length === 0 || !visual) {
        return emptyDescriptor;
      }

      const metricBaseAlias = visual.metric;
      const dimensionBaseAlias = visual.dimension;

      if (!metricBaseAlias || !dimensionBaseAlias) {
        return emptyDescriptor;
      }

      const resolveFieldReference = (
        alias: string,
      ): ({ kind: "model"; modelId: string; fieldId: string } | { kind: "derived"; fieldId: string }) | null => {
        if (!alias) {
          return null;
        }
        const detail = fieldDetailByAlias.get(alias);
        if (!detail) {
          return null;
        }
        if (detail.source === "derived" || detail.derivedFieldId) {
          return { kind: "derived", fieldId: detail.derivedFieldId ?? detail.id };
        }
        const parsed = parseColumnAlias(alias);
        if (!parsed) {
          return null;
        }
        return { kind: "model", ...parsed };
      };

      const metricDetail = fieldDetailByAlias.get(metricBaseAlias);
      const dimensionDetail = fieldDetailByAlias.get(dimensionBaseAlias);

      const warnings: string[] = [];

      if (!metricDetail) {
        warnings.push("Select a metric field to run analytics.");
        return { ...emptyDescriptor, warnings };
      }

      if (!dimensionDetail) {
        warnings.push("Select a dimension field to run analytics.");
        return { ...emptyDescriptor, warnings };
      }

      const metricReference = resolveFieldReference(metricBaseAlias);
      const dimensionReference = resolveFieldReference(dimensionBaseAlias);

      if (!metricReference || !dimensionReference) {
        warnings.push("Unable to determine metric/dimension columns for analytics.");
        return { ...emptyDescriptor, warnings };
      }

      if (dimensionReference.kind === "derived") {
        warnings.push("Derived fields cannot be used as dimensions yet.");
        return { ...emptyDescriptor, warnings };
      }

      const metricAggregation =
        visual.metricAggregation && METRIC_AGGREGATIONS.includes(visual.metricAggregation)
          ? visual.metricAggregation
          : "sum";
      const metricAlias = buildMetricAggregationAlias(metricBaseAlias, metricAggregation);

      const dimensionBucket: TimeBucket | undefined =
        visual.dimensionBucket && DIMENSION_BUCKETS.includes(visual.dimensionBucket as TimeBucket)
          ? (visual.dimensionBucket as TimeBucket)
          : undefined;
      const dimensionAlias = buildDimensionAlias(dimensionBaseAlias, dimensionBucket);

      const metrics: QueryConfigMetric[] = [
        metricReference.kind === "derived"
          ? {
              modelId: DERIVED_FIELD_SENTINEL,
              fieldId: metricReference.fieldId,
              aggregation: metricAggregation,
              alias: metricAlias,
            }
          : {
              modelId: metricReference.modelId,
              fieldId: metricReference.fieldId,
              aggregation: metricAggregation,
              alias: metricAlias,
            },
      ];

      let comparisonAlias: string | null = null;
      if (visual.comparison) {
        const comparisonBaseAlias = visual.comparison;
        const comparisonDetail = fieldDetailByAlias.get(comparisonBaseAlias);
        if (comparisonDetail) {
          const comparisonReference = resolveFieldReference(comparisonBaseAlias);
          if (comparisonReference) {
            const comparisonAggregation =
              visual.comparisonAggregation && METRIC_AGGREGATIONS.includes(visual.comparisonAggregation)
                ? visual.comparisonAggregation
                : metricAggregation;
            comparisonAlias = buildMetricAggregationAlias(comparisonBaseAlias, comparisonAggregation);
            metrics.push(
              comparisonReference.kind === "derived"
                ? {
                    modelId: DERIVED_FIELD_SENTINEL,
                    fieldId: comparisonReference.fieldId,
                    aggregation: comparisonAggregation,
                    alias: comparisonAlias,
                  }
                : {
                    modelId: comparisonReference.modelId,
                    fieldId: comparisonReference.fieldId,
                    aggregation: comparisonAggregation,
                    alias: comparisonAlias,
                  },
            );
          } else {
            warnings.push(
              `Comparison series ${comparisonBaseAlias} could not be resolved and was skipped.`,
            );
          }
        } else {
          warnings.push(
            `Comparison series ${visual.comparison} is not in the selected field list and was skipped.`,
          );
        }
      }

      const { filters: normalizedFilters, warnings: filterWarnings } = normalizeFiltersForQuery(
        draft.filters,
      );
      warnings.push(...filterWarnings);

      const limitValue =
        typeof visual.limit === "number" && Number.isFinite(visual.limit) && visual.limit > 0
          ? Math.round(visual.limit)
          : 100;

      const joins =
        draft.joins.length > 0
          ? draft.joins.map(
              ({ id, leftModel, leftField, rightModel, rightField, joinType, description }) => ({
                id,
                leftModel,
                leftField,
                rightModel,
                rightField,
                joinType,
                description,
              }),
            )
          : undefined;

      const descriptor: VisualQueryDescriptor = {
        config: {
          models: [...draft.models],
          joins,
          filters: normalizedFilters.length > 0 ? normalizedFilters : undefined,
          metrics,
          dimensions: [
            {
              modelId: dimensionReference.modelId,
              fieldId: dimensionReference.fieldId,
              bucket: dimensionBucket,
              alias: dimensionAlias,
            },
          ],
          orderBy: [{ alias: dimensionAlias, direction: "asc" }],
          limit: limitValue,
          derivedFields: derivedFieldPayloads.length > 0 ? derivedFieldPayloads : undefined,
          options: {
            allowAsync: true,
            templateId:
              draft.id && draft.id !== "template-empty" ? draft.id : undefined,
          },
        },
        metricAlias,
        dimensionAlias,
        comparisonAlias,
        metricBaseAlias,
        dimensionBaseAlias,
        metricLabel: getColumnLabel(metricBaseAlias),
        dimensionLabel: getColumnLabel(dimensionBaseAlias),
        comparisonLabel: visual.comparison ? getColumnLabel(visual.comparison) : undefined,
        warnings,
      };

      return descriptor;
    },
    [
      draft.filters,
      draft.id,
      draft.joins,
      draft.models,
      fieldDetailByAlias,
      getColumnLabel,
      derivedFieldPayloads,
    ],
  );
  const visualQueryDescriptor = useMemo(
    () => buildVisualDescriptor(activeVisual ?? null),
    [activeVisual, buildVisualDescriptor],
  );

  const chartMetricAlias = visualQueryDescriptor.metricAlias ?? "";
  const chartDimensionAlias = visualQueryDescriptor.dimensionAlias ?? "";
  const chartComparisonAlias = visualQueryDescriptor.comparisonAlias ?? undefined;
  const visualRows = useMemo(() => visualResult?.rows ?? [], [visualResult]);
  const visualColumns = useMemo(() => visualResult?.columns ?? [], [visualResult]);

  const metricAliasOptions = useMemo(() => {
    const registry = new Map<string, string>();
    const register = (alias?: string | null) => {
      if (!alias) {
        return;
      }
      if (!registry.has(alias)) {
        registry.set(alias, getColumnLabel(alias));
      }
    };

    metricOptions.forEach((option) => register(option.value));
    draft.metrics.forEach(register);
    draft.metricsSpotlight.forEach((spotlight) => register(spotlight.metric));
    register(visualQueryDescriptor.metricAlias ?? undefined);
    register(visualQueryDescriptor.comparisonAlias ?? undefined);

    return Array.from(registry.entries()).map(([value, label]) => ({
      value,
      label,
    }));
  }, [
    draft.metrics,
    draft.metricsSpotlight,
    getColumnLabel,
    metricOptions,
    visualQueryDescriptor.comparisonAlias,
    visualQueryDescriptor.metricAlias,
  ]);


  const chartData = useMemo(() => {
    if (!chartMetricAlias || !chartDimensionAlias) {
      return [];
    }

    if (
      !visualColumns.includes(chartMetricAlias) ||
      !visualColumns.includes(chartDimensionAlias)
    ) {
      return [];
    }

    return visualRows
      .map((row) => {
        const dimensionValue = coerceString(row[chartDimensionAlias]);
        const metricValue = coerceNumber(row[chartMetricAlias]);
        if (!dimensionValue || metricValue === null) {
          return null;
        }
        const point: { dimension: string; primary: number; secondary?: number } = {
          dimension: dimensionValue,
          primary: metricValue,
        };
        if (chartComparisonAlias) {
          const comparisonValue = coerceNumber(row[chartComparisonAlias]);
          if (comparisonValue !== null) {
            point.secondary = comparisonValue;
          }
        }
        return point;
      })
      .filter(
        (value): value is { dimension: string; primary: number; secondary?: number } => value !== null,
      );
  }, [chartComparisonAlias, chartDimensionAlias, chartMetricAlias, visualColumns, visualRows]);

  const hasChartData = chartData.length > 0;
  const metricAggregationLabel = AGGREGATION_LABELS[activeVisual.metricAggregation ?? "sum"];
  const metricLabelBase = visualQueryDescriptor.metricLabel || "Metric";
  const metricLabel =
    activeVisual.metric && metricAggregationLabel
      ? `${metricLabelBase} (${metricAggregationLabel})`
      : metricLabelBase;
  const dimensionBucketLabel = activeVisual.dimensionBucket
    ? BUCKET_LABELS[activeVisual.dimensionBucket as TimeBucket]
    : null;
  const dimensionLabelBase = visualQueryDescriptor.dimensionLabel || "Dimension";
  const dimensionLabel = dimensionBucketLabel
    ? `${dimensionLabelBase} (${dimensionBucketLabel})`
    : dimensionLabelBase;
  const comparisonAggregationLabel = activeVisual.comparison
    ? AGGREGATION_LABELS[
        activeVisual.comparisonAggregation ?? activeVisual.metricAggregation ?? "sum"
      ]
    : null;
  const comparisonLabel =
    activeVisual.comparison && visualQueryDescriptor.comparisonLabel
      ? comparisonAggregationLabel
        ? `${visualQueryDescriptor.comparisonLabel} (${comparisonAggregationLabel})`
        : visualQueryDescriptor.comparisonLabel
      : undefined;

  const getMetricLabel = useCallback(
    (alias?: string) => metricOptions.find((option) => option.value === alias)?.label,
    [metricOptions],
  );

  const metricDisplayLabel = useMemo(() => {
    const labelSource =
      visualQueryDescriptor.metricLabel ?? getMetricLabel(activeVisual.metric) ?? metricLabel;
    return metricAggregationLabel ? `${labelSource} (${metricAggregationLabel})` : labelSource;
  }, [
    activeVisual.metric,
    getMetricLabel,
    metricAggregationLabel,
    metricLabel,
    visualQueryDescriptor.metricLabel,
  ]);

  const comparisonDisplayLabel = useMemo(() => {
    if (!activeVisual.comparison) {
      return comparisonLabel;
    }
    const labelSource =
      visualQueryDescriptor.comparisonLabel ??
      getMetricLabel(activeVisual.comparison) ??
      comparisonLabel;
    return comparisonAggregationLabel ? `${labelSource} (${comparisonAggregationLabel})` : labelSource;
  }, [
    activeVisual.comparison,
    comparisonAggregationLabel,
    comparisonLabel,
    getMetricLabel,
    visualQueryDescriptor.comparisonLabel,
  ]);

  const formatNumberForDisplay = useCallback(
    (value: number) =>
      Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "-",
    [],
  );

  const tooltipFormatter = useCallback<Formatter<number, string>>(
    (value, _name, entry) => {
      const payload = entry as Payload<number, string> | undefined;
      const dataKey = typeof payload?.dataKey === "string" ? payload.dataKey : "";
      const label =
        dataKey === "primary" ? metricDisplayLabel : comparisonDisplayLabel ?? "Comparison";
      return [formatNumberForDisplay(value ?? 0), label];
    },
    [comparisonDisplayLabel, formatNumberForDisplay, metricDisplayLabel],
  );

  const isStackedVisualization =
    activeVisual.type === "stackedArea" || activeVisual.type === "stackedBar";

  const renderPrimarySeries = () => {
    switch (activeVisual.type) {
      case "area":
      case "stackedArea":
        return (
          <Area
            type="monotone"
            dataKey="primary"
            stroke="#1c7ed6"
            fill="#a5d8ff"
            name={metricDisplayLabel}
            yAxisId="left"
            stackId={activeVisual.type === "stackedArea" ? "stack" : undefined}
          />
        );
      case "bar":
      case "stackedBar":
        return (
          <Bar
            dataKey="primary"
            fill="#228be6"
            barSize={26}
            name={metricDisplayLabel}
            yAxisId="left"
            stackId={activeVisual.type === "stackedBar" ? "stack" : undefined}
          />
        );
      case "scatter":
        return (
          <Scatter
            dataKey="primary"
            fill="#1c7ed6"
            name={metricDisplayLabel}
            yAxisId="left"
            line
          />
        );
      case "line":
      default:
        return (
          <Line
            type="monotone"
            dataKey="primary"
            stroke="#1c7ed6"
            strokeWidth={2}
            dot={false}
            name={metricDisplayLabel}
            yAxisId="left"
          />
        );
    }
  };

  const renderComparisonSeries = () => {
    if (!chartComparisonAlias) {
      return null;
    }
    const comparisonYAxisId = isStackedVisualization ? "left" : "right";
    const name = comparisonDisplayLabel ?? "Comparison";
    switch (activeVisual.type) {
      case "area":
      case "stackedArea":
        return (
          <Area
            type="monotone"
            dataKey="secondary"
            stroke="#2b8a3e"
            fill="#d3f9d8"
            name={name}
            yAxisId={comparisonYAxisId}
            stackId={activeVisual.type === "stackedArea" ? "stack" : undefined}
          />
        );
      case "bar":
      case "stackedBar":
        return (
          <Bar
            dataKey="secondary"
            fill="#82c91e"
            barSize={26}
            name={name}
            yAxisId={comparisonYAxisId}
            stackId={activeVisual.type === "stackedBar" ? "stack" : undefined}
          />
        );
      case "scatter":
        return (
          <Scatter
            dataKey="secondary"
            fill="#2b8a3e"
            name={name}
            yAxisId={comparisonYAxisId}
          />
        );
      case "line":
      default:
        return (
          <Line
            type="monotone"
            dataKey="secondary"
            stroke="#2b8a3e"
            strokeWidth={2}
            dot={false}
            name={name}
            yAxisId={comparisonYAxisId}
          />
        );
    }
  };

  const aggregationOptions = useMemo(
    () =>
      METRIC_AGGREGATIONS.map((value) => ({
        value,
        label: AGGREGATION_LABELS[value],
      })),
    [],
  );

  const bucketOptions = useMemo(
    () =>
      DIMENSION_BUCKETS.map((value) => ({
        value,
        label: BUCKET_LABELS[value],
      })),
    [],
  );

  const dimensionDetail = visualQueryDescriptor.dimensionBaseAlias
    ? fieldDetailByAlias.get(visualQueryDescriptor.dimensionBaseAlias)
    : undefined;
  const supportsDimensionBuckets = dimensionDetail?.type === "date";

  const runVisualAnalytics = useCallback(async () => {
    setVisualWarnings(visualQueryDescriptor.warnings);

    if (!visualQueryDescriptor.config) {
      setVisualResult(null);
      setVisualExecutedAt(null);
      setVisualSql(null);
      if (visualQueryDescriptor.warnings.length > 0) {
        setVisualQueryError(visualQueryDescriptor.warnings[0]);
      } else {
        setVisualQueryError("Select a metric and dimension to run analytics.");
      }
      setVisualJob(null);
      setVisualJobStatus(null);
      setIsVisualQueryRunning(false);
      return;
    }

    if (hasStaleDerivedFields) {
      const staleMessage =
        staleDerivedFieldNames.length > 0
          ? `Resolve stale derived fields (${staleDerivedFieldNames}) before running analytics.`
          : "Resolve stale derived fields before running analytics.";
      setVisualResult(null);
      setVisualQueryError(staleMessage);
      setIsVisualQueryRunning(false);
      setVisualExecutedAt(null);
      setVisualJob(null);
      setVisualJobStatus(null);
      return;
    }

    setIsVisualQueryRunning(true);
    setVisualQueryError(null);
    setVisualJob(null);
    setVisualJobStatus(null);
    setVisualResult(null);
    setVisualExecutedAt(null);
    setVisualSql(null);

    try {
      const response = await runAnalyticsQuery(visualQueryDescriptor.config);
      if (isReportQuerySuccess(response)) {
        setVisualResult(response);
        setVisualSql(typeof response.sql === "string" ? response.sql : null);
        const executedAt =
          typeof response.meta?.executedAt === "string"
            ? response.meta.executedAt
            : typeof response.meta?.cachedAt === "string"
            ? response.meta.cachedAt
            : new Date().toISOString();
        setVisualExecutedAt(executedAt);
        setVisualQueryError(null);
        setVisualJobStatus("completed");
        setIsVisualQueryRunning(false);
      } else if (isReportQueryJob(response)) {
        setVisualJob({ jobId: response.jobId, hash: response.hash });
        setVisualJobStatus(response.status);
        setVisualSql(null);
      } else {
        setVisualQueryError("Received an unknown analytics response.");
        setIsVisualQueryRunning(false);
        setVisualSql(null);
      }
    } catch (error) {
      setVisualQueryError(extractAxiosErrorMessage(error, "Failed to run analytics query."));
      setIsVisualQueryRunning(false);
      setVisualJobStatus("failed");
      setVisualExecutedAt(null);
      setVisualSql(null);
    }
  }, [hasStaleDerivedFields, runAnalyticsQuery, staleDerivedFieldNames, visualQueryDescriptor]);

  useEffect(() => {
    if (!visualJob) {
      return;
    }

    let isCancelled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const result = await getReportQueryJob(visualJob.jobId);
        if (isCancelled) {
          return;
        }
        if (isReportQuerySuccess(result)) {
          setVisualResult(result);
          setVisualSql(typeof result.sql === "string" ? result.sql : null);
          const executedAt =
            typeof result.meta?.executedAt === "string"
              ? result.meta.executedAt
              : typeof result.meta?.cachedAt === "string"
              ? result.meta.cachedAt
              : new Date().toISOString();
          setVisualExecutedAt(executedAt);
          setVisualQueryError(null);
          setVisualJob(null);
          setVisualJobStatus("completed");
          setIsVisualQueryRunning(false);
          return;
        }
        if (isReportQueryJob(result)) {
          setVisualJobStatus(result.status);
          if (result.status === "failed") {
            setVisualQueryError("Analytics job failed. Try running the query again.");
            setVisualJob(null);
            setVisualExecutedAt(null);
            setIsVisualQueryRunning(false);
            setVisualSql(null);
            return;
          }
          timeoutHandle = setTimeout(poll, 1500);
        }
      } catch (error) {
        if (isCancelled) {
          return;
        }
        setVisualQueryError(
          extractAxiosErrorMessage(error, "Failed to fetch analytics job status."),
        );
        setVisualJob(null);
        setVisualJobStatus("failed");
        setVisualExecutedAt(null);
        setIsVisualQueryRunning(false);
        setVisualSql(null);
      }
    };

    poll();

    return () => {
      isCancelled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    };
  }, [visualJob]);

  const analyticsRunLabel = useMemo(
    () => (visualExecutedAt ? formatLastUpdatedLabel(visualExecutedAt) : null),
    [visualExecutedAt],
  );
  const visualJobStatusLabel = visualJobStatus
    ? `${visualJobStatus.charAt(0).toUpperCase()}${visualJobStatus.slice(1)}`
    : null;

  const metricsSummary = useMemo(() => {
    type SummaryCard = {
      id: string;
      label: string;
      value: string;
      delta: string;
      context: string;
      tone: "positive" | "neutral" | "negative";
    };

    const cards: SummaryCard[] = [];

    if (draft.metricsSpotlight.length > 0) {
      draft.metricsSpotlight.forEach((spotlight, index) => {
        const alias = spotlight.metric;
        if (!alias) {
          return;
        }

        const values = visualRows
          .map((row) => coerceNumber(row[alias]))
          .filter((value): value is number => value !== null);

        if (values.length === 0) {
          cards.push({
            id: alias || `spotlight-${index}`,
            label: spotlight.label || getColumnLabel(alias),
            value: "Run analytics",
            delta: "—",
            context: "Execute the analytics query to populate this card.",
            tone: "neutral",
          });
          return;
        }

        const aggregatedValue = values.reduce((total, value) => total + value, 0);
        const formattedValue = formatMetricValue(aggregatedValue, spotlight.format);

        let deltaDisplay = "—";
        let tone: "positive" | "neutral" | "negative" = "neutral";
        const contextParts: string[] = [];

        if (typeof spotlight.target === "number") {
          const difference = aggregatedValue - spotlight.target;
          tone = difference >= 0 ? "positive" : "negative";
          deltaDisplay = `${difference >= 0 ? "+" : ""}${formatMetricValue(
            difference,
            spotlight.format,
          )}`;
          contextParts.push(`Target ${formatMetricValue(spotlight.target, spotlight.format)}`);
        }

        if (spotlight.comparison) {
          contextParts.push(`Comparison: ${spotlight.comparison.toUpperCase()}`);
        }

        if (contextParts.length === 0) {
          contextParts.push("Latest analytics result");
        }

        cards.push({
          id: alias || `spotlight-${index}`,
          label: spotlight.label || getColumnLabel(alias),
          value: formattedValue,
          delta: deltaDisplay,
          context: contextParts.join(" • "),
          tone,
        });
      });

      if (cards.length > 0) {
        return cards;
      }
    }

    if (!chartMetricAlias || visualRows.length === 0 || visualColumns.length === 0) {
      return [];
    }

    const metricValues = visualRows
      .map((row) => coerceNumber(row[chartMetricAlias]))
      .filter((value): value is number => value !== null);

    if (metricValues.length === 0) {
      return [];
    }

    const aggregation = activeVisual.metricAggregation ?? "sum";
    let headlineValue: number | null = null;
    let headlineLabel = metricLabel;
    let context = "";

    switch (aggregation) {
      case "avg": {
        headlineValue =
          metricValues.reduce((total, value) => total + value, 0) / metricValues.length;
        context = `Average across ${metricValues.length} rows`;
        headlineLabel = `Average ${metricLabel.toLowerCase()}`;
        break;
      }
      case "min": {
        headlineValue = Math.min(...metricValues);
        context = "Minimum value across the result set";
        headlineLabel = `Minimum ${metricLabel.toLowerCase()}`;
        break;
      }
      case "max": {
        headlineValue = Math.max(...metricValues);
        context = "Maximum value across the result set";
        headlineLabel = `Maximum ${metricLabel.toLowerCase()}`;
        break;
      }
      default: {
        headlineValue = metricValues.reduce((total, value) => total + value, 0);
        context = `Total across ${metricValues.length} rows`;
        headlineLabel = `Total ${metricLabel.toLowerCase()}`;
        break;
      }
    }

    const summaryCards: SummaryCard[] = [];

    if (headlineValue !== null) {
      let deltaDisplay = "—";
      let tone: "positive" | "neutral" | "negative" = "neutral";

      if (chartComparisonAlias) {
        const comparisonAggregation =
          activeVisual.comparisonAggregation ?? activeVisual.metricAggregation ?? "sum";
        const comparisonValues = visualRows
          .map((row) => coerceNumber(row[chartComparisonAlias]))
          .filter((value): value is number => value !== null);

        if (comparisonValues.length > 0) {
          let comparisonHeadline: number | null = null;
          switch (comparisonAggregation) {
            case "avg":
              comparisonHeadline =
                comparisonValues.reduce((total, value) => total + value, 0) /
                comparisonValues.length;
              break;
            case "min":
              comparisonHeadline = Math.min(...comparisonValues);
              break;
            case "max":
              comparisonHeadline = Math.max(...comparisonValues);
              break;
            default:
              comparisonHeadline = comparisonValues.reduce((total, value) => total + value, 0);
              break;
          }

          if (comparisonHeadline !== null) {
            const diff = headlineValue - comparisonHeadline;
            tone = diff > 0 ? "positive" : diff < 0 ? "negative" : "neutral";
            const diffLabel = `${diff >= 0 ? "+" : ""}${formatNumberForDisplay(diff)}`;
            if (Math.abs(comparisonHeadline) > 1e-6) {
              const percent = (diff / Math.abs(comparisonHeadline)) * 100;
              deltaDisplay = `${diffLabel} (${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%)`;
            } else {
              deltaDisplay = diffLabel;
            }
          }
        }
      }

      summaryCards.push({
        id: "headline-metric",
        label: headlineLabel,
        value: formatNumberForDisplay(headlineValue),
        delta: deltaDisplay,
        context,
        tone,
      });
    }

    if (chartDimensionAlias) {
      const ranked = [...visualRows].sort((a, b) => {
        const first = coerceNumber(a[chartMetricAlias]) ?? -Infinity;
        const second = coerceNumber(b[chartMetricAlias]) ?? -Infinity;
        return second - first;
      });
      const topRow = ranked[0];
      if (topRow) {
        const dimensionValue = coerceString(topRow[chartDimensionAlias]);
        const metricValue = coerceNumber(topRow[chartMetricAlias]);
        if (dimensionValue && metricValue !== null) {
          summaryCards.push({
            id: `top-dimension-${dimensionValue}`,
            label: `Top ${dimensionLabel.toLowerCase()}`,
            value: dimensionValue,
            delta: formatNumberForDisplay(metricValue),
            context: `Highest ${metricLabel.toLowerCase()} by dimension`,
            tone: "neutral",
          });
        }
      }
    }

    return summaryCards;
  }, [
    activeVisual.comparisonAggregation,
    activeVisual.metricAggregation,
    chartComparisonAlias,
    chartDimensionAlias,
    chartMetricAlias,
    dimensionLabel,
    draft.metricsSpotlight,
    formatNumberForDisplay,
    metricLabel,
    visualColumns,
    visualRows,
    getColumnLabel,
  ]);

  const joinGraph = useMemo(() => {
    const nodes = draft.models.map((modelId) => ({
      id: modelId,
      label: modelMap.get(modelId)?.name ?? modelId,
    }));

    const edges = draft.joins.map((join) => ({
      id: join.id,
      from: join.leftModel,
      to: join.rightModel,
      joinType: join.joinType,
      description: join.description ?? "",
      leftLabel: modelMap.get(join.leftModel)?.name ?? join.leftModel,
      rightLabel: modelMap.get(join.rightModel)?.name ?? join.rightModel,
    }));

    const adjacency = new Map<string, Set<string>>();
    nodes.forEach((node) => adjacency.set(node.id, new Set<string>()));
    edges.forEach((edge) => {
      adjacency.get(edge.from)?.add(edge.to);
      adjacency.get(edge.to)?.add(edge.from);
    });

    const components: string[][] = [];
    const visited = new Set<string>();
    nodes.forEach((node) => {
      if (visited.has(node.id)) {
        return;
      }
      const queue: string[] = [node.id];
      const members: string[] = [];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) {
          continue;
        }
        visited.add(current);
        members.push(current);
        adjacency.get(current)?.forEach((neighbor) => {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        });
      }
      if (members.length > 0) {
        components.push(members);
      }
    });

    const disconnectedIds = components
      .slice(1)
      .reduce<string[]>((accumulator, component) => accumulator.concat(component), []);
    const disconnectedSet = new Set(disconnectedIds);
    const disconnected = nodes.filter((node) => disconnectedSet.has(node.id));

    return { nodes, edges, adjacency, components, disconnected };
  }, [draft.joins, draft.models, modelMap]);

  const joinGraphLabelLookup = useMemo(() => {
    const map = new Map<string, string>();
    joinGraph.nodes.forEach((node) => {
      map.set(node.id, node.label);
    });
    return map;
  }, [joinGraph]);

  const joinGraphNodeStats = useMemo(
    () =>
      joinGraph.nodes.map((node) => ({
        ...node,
        connections: joinGraph.adjacency.get(node.id)?.size ?? 0,
      })),
    [joinGraph],
  );

  const joinGraphComponentSummaries = useMemo(
    () =>
      joinGraph.components.map((component, index) => ({
        id: `component-${index}`,
        title: `Cluster ${index + 1}`,
        members: component.map((nodeId) => joinGraphLabelLookup.get(nodeId) ?? nodeId),
      })),
    [joinGraph, joinGraphLabelLookup],
  );

  const joinSuggestions = useMemo(() => {
    const existingKeys = new Set(
      draft.joins.map(
        (join) => `${join.leftModel}:${join.leftField}->${join.rightModel}:${join.rightField}`
      )
    );

    const suggestions: Array<{
      source: DataModelDefinition;
      target: DataModelDefinition;
      on: string;
      relationship: string;
      leftField: string;
      rightField: string;
    }> = [];

    const seenSignatures = new Set<string>();

    selectedModels.forEach((model) => {
      const associations = model.associations ?? [];
      associations.forEach((association) => {
        const target = modelMap.get(association.targetModelId);
        if (!target || !draft.models.includes(target.id)) {
          return;
        }

        const leftField = association.foreignKey ?? getDefaultKey(model);
        const rightField = association.sourceKey ?? getDefaultKey(target);
        const orientedKey = `${model.id}:${leftField}->${target.id}:${rightField}`;
        const normalizedKey = [model.id, target.id].sort().join("|") + `|${leftField}|${rightField}`;

        if (existingKeys.has(orientedKey) || seenSignatures.has(normalizedKey)) {
          return;
        }

        seenSignatures.add(normalizedKey);

        const relationshipLabel = association.alias
          ? `${association.associationType} (${association.alias})`
          : association.associationType;

        suggestions.push({
          source: model,
          target,
          on: `${model.id}.${leftField} = ${target.id}.${rightField}`,
          relationship: relationshipLabel,
          leftField,
          rightField,
        });
      });
    });

    return suggestions;
  }, [draft.joins, draft.models, modelMap, selectedModels]);

  const builderContext = selectedTemplate?.category ?? "Report builder";
  const isTemplatePersisted = Boolean(draft.id && draft.id !== "template-empty");
  const scheduleQueryKey = useMemo(
    () => (isTemplatePersisted ? (["reports", "templates", draft.id, "schedules"] as const) : null),
    [isTemplatePersisted, draft.id],
  );
  const {
    data: scheduleData,
    isLoading: isSchedulesLoading,
    isError: isSchedulesError,
  } = useTemplateSchedules(isTemplatePersisted ? draft.id : undefined);
  const scheduleList = scheduleData?.schedules ?? [];

  const handleSelectTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }
    setTemplateError(null);
    setTemplateSuccess(null);
    setSelectedTemplateId(templateId);
    setDraft(deepClone(template));
  };

  const handleToggleModel = (modelId: string) => {
    setDraft((current) => {
      const hasModel = current.models.includes(modelId);
      if (hasModel) {
        const aliasPrefix = `${modelId}__`;
        const filteredColumnOrder = current.columnOrder.filter((alias) => !alias.startsWith(aliasPrefix));
        const filteredColumnAliases = Object.entries(current.columnAliases).reduce<Record<string, string>>(
          (accumulator, [aliasKey, value]) => {
            if (!aliasKey.startsWith(aliasPrefix)) {
              accumulator[aliasKey] = value;
            }
            return accumulator;
          },
          {},
        );
        const filteredMetrics = current.metrics.filter((alias) => !alias.startsWith(aliasPrefix));
        const filteredVisuals = current.visuals.map((visual) => {
          const metric = visual.metric.startsWith(aliasPrefix) ? "" : visual.metric;
          const dimension = visual.dimension.startsWith(aliasPrefix) ? "" : visual.dimension;
          const comparison =
            visual.comparison && visual.comparison.startsWith(aliasPrefix)
              ? undefined
              : visual.comparison;
          return { ...visual, metric, dimension, comparison };
        });
        const nextModels = current.models.filter((id) => id !== modelId);
        return {
          ...current,
          models: nextModels,
          fields: current.fields.filter((entry) => entry.modelId !== modelId),
          joins: current.joins.filter(
            (join) => join.leftModel !== modelId && join.rightModel !== modelId
          ),
          filters: current.filters.filter(
            (filter) =>
              filter.leftModelId !== modelId &&
              (filter.rightType !== "field" || filter.rightModelId !== modelId),
          ),
          columnOrder: filteredColumnOrder,
          columnAliases: filteredColumnAliases,
          metrics: filteredMetrics,
          visuals: filteredVisuals,
          derivedFields: reconcileDerivedFieldStatuses(current.derivedFields, nextModels),
        };
      }
      const nextModels = [...current.models, modelId];
      return {
        ...current,
        models: nextModels,
        fields: current.fields.some((entry) => entry.modelId === modelId)
          ? current.fields
          : [...current.fields, { modelId, fieldIds: [] }],
        derivedFields: reconcileDerivedFieldStatuses(current.derivedFields, nextModels),
      };
    });
  };

  const handleFieldToggle = (modelId: string, fieldId: string) => {
    const aliasKey = toColumnAlias(modelId, fieldId);
    setDraft((current) => {
      const existingEntry = current.fields.find((entry) => entry.modelId === modelId);
      const existingFieldIds = existingEntry?.fieldIds ?? [];
      const fieldWasSelected = existingFieldIds.includes(fieldId);
      const updatedFieldIds = fieldWasSelected
        ? existingFieldIds.filter((id) => id !== fieldId)
        : [...existingFieldIds, fieldId];

      const nextFields = existingEntry
        ? current.fields.map((entry) =>
            entry.modelId === modelId ? { ...entry, fieldIds: updatedFieldIds } : entry,
          )
        : [...current.fields, { modelId, fieldIds: [fieldId] }];

      const nextColumnOrder = fieldWasSelected
        ? current.columnOrder.filter((alias) => alias !== aliasKey)
        : current.columnOrder;

      const nextColumnAliases = fieldWasSelected
        ? omitRecordKey(current.columnAliases, aliasKey)
        : current.columnAliases;

      const nextMetrics = fieldWasSelected
        ? current.metrics.filter((alias) => alias !== aliasKey)
        : current.metrics;

      const nextVisuals = current.visuals.map((visual) => {
        const metric = fieldWasSelected && visual.metric === aliasKey ? "" : visual.metric;
        const dimension = fieldWasSelected && visual.dimension === aliasKey ? "" : visual.dimension;
        const comparison =
          fieldWasSelected && visual.comparison === aliasKey ? undefined : visual.comparison;
        return { ...visual, metric, dimension, comparison };
      });

      return {
        ...current,
        fields: nextFields,
        columnOrder: nextColumnOrder,
        columnAliases: nextColumnAliases,
        metrics: nextMetrics,
        visuals: nextVisuals,
      };
    });
  };

  const handleFieldAliasChange = (modelId: string, fieldId: string, alias: string) => {
    const aliasKey = toColumnAlias(modelId, fieldId);
    const trimmed = alias.trim();
    setDraft((current) => {
      const hasExistingAlias = Object.prototype.hasOwnProperty.call(current.columnAliases, aliasKey);
      if (trimmed.length === 0) {
        if (!hasExistingAlias) {
          return current;
        }
        const nextAliases = omitRecordKey(current.columnAliases, aliasKey);
        if (nextAliases === current.columnAliases) {
          return current;
        }
        return {
          ...current,
          columnAliases: nextAliases,
        };
      }
      if (hasExistingAlias && current.columnAliases[aliasKey] === trimmed) {
        return current;
      }
      return {
        ...current,
        columnAliases: {
          ...current.columnAliases,
          [aliasKey]: trimmed,
        },
      };
    });
  };

  const handleToggleDerivedFieldVisibility = useCallback(
    (fieldId: string, enabled: boolean) => {
      const currentField = draft.derivedFields.find((field) => field.id === fieldId);
      const nextField = currentField ? applyDerivedFieldVisibility(currentField, enabled) : null;

      setDraft((current) => ({
        ...current,
        derivedFields: current.derivedFields.map((field) =>
          field.id === fieldId ? applyDerivedFieldVisibility(field, enabled) : field,
        ),
      }));

      if (
        nextField &&
        nextField.scope === "template" &&
        fieldId &&
        !fieldId.startsWith("derived-") &&
        !fieldId.startsWith("temp")
      ) {
        updateDerivedFieldMutation.mutate({
          id: fieldId,
          payload: {
            metadata: nextField.metadata ?? {},
          },
        });
      }
    },
    [draft.derivedFields, updateDerivedFieldMutation],
  );

  const renderDerivedFieldInventory = () => (
    <>
      <Divider my="sm" />
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text fw={600} fz="sm">
            Derived fields
          </Text>
          <Badge size="xs" variant="light">
            {draft.derivedFields.length === 0
              ? "0 created"
              : `${enabledDerivedFieldCount}/${draft.derivedFields.length} enabled`}
          </Badge>
        </Group>
        {draft.derivedFields.length === 0 ? (
          <Alert color="gray" variant="light">
            Create derived fields from the manager to combine metrics across models.
          </Alert>
        ) : (
          <ScrollArea h={200} offsetScrollbars type="always">
            <Table verticalSpacing="xs" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Models</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th align="right">Include</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {draft.derivedFields.map((field) => {
                  const referencedModels = getEffectiveReferencedModels(field);
                  const referencedLabels =
                    referencedModels.length === 0
                      ? "Detected automatically"
                      : referencedModels
                          .map((modelId) => modelMap.get(modelId)?.name ?? modelId)
                          .join(", ");
                  const missingModels = referencedModels.filter(
                    (modelId) => !draft.models.includes(modelId),
                  );
                  const isEnabled = isDerivedFieldVisibleInBuilder(field);
                  const isStale = field.status === "stale";
                  return (
                    <Table.Tr key={field.id}>
                      <Table.Td>
                        <Text fw={500} fz="sm">
                          {field.name}
                        </Text>
                        <Text fz="xs" c="dimmed">
                          {field.expression}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text fz="xs" c={missingModels.length > 0 ? "red" : "dimmed"}>
                          {referencedLabels}
                        </Text>
                        {missingModels.length > 0 && (
                          <Text fz="xs" c="red">
                            Missing:{" "}
                            {missingModels
                              .map((modelId) => modelMap.get(modelId)?.name ?? modelId)
                              .join(", ")}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <Badge
                            size="xs"
                            variant="light"
                            color={field.kind === "aggregate" ? "violet" : "blue"}
                          >
                            {field.kind === "aggregate" ? "Aggregate" : "Row-level"}
                          </Badge>
                          <Badge size="xs" variant="light" color={isStale ? "red" : "teal"}>
                            {isStale ? "Stale" : "Ready"}
                          </Badge>
                        </Group>
                      </Table.Td>
                      <Table.Td align="right">
                        <Switch
                          size="sm"
                          checked={isEnabled}
                          onChange={(event) =>
                            handleToggleDerivedFieldVisibility(field.id, event.currentTarget.checked)
                          }
                          disabled={isStale}
                          aria-label={`Toggle derived field ${field.name}`}
                        />
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Stack>
    </>
  );

  const handleAddSpotlight = () => {
    setTemplateError(null);
    setTemplateSuccess(null);
    const defaultMetric = metricAliasOptions[0]?.value;
    if (!defaultMetric) {
      setTemplateError("Select at least one numeric field to create a spotlight card.");
      return;
    }
    setDraft((current) => ({
      ...current,
      metricsSpotlight: [
        ...current.metricsSpotlight,
        {
          metric: defaultMetric,
          label: getColumnLabel(defaultMetric),
          format: "number",
        },
      ],
    }));
  };

  const handleCloseDashboardModal = () => {
    setDashboardModalOpen(false);
    setDashboardCardDraft(null);
    setDashboardModalError(null);
    setDashboardCardTitle("");
  };

  const handleOpenDashboardModal = (cardDraft: DashboardCardModalDraft) => {
    setDashboardCardDraft(cardDraft);
    setDashboardCardTitle(cardDraft.title);
    setDashboardModalError(null);
    setSelectedDashboardIdForModal((current) => current ?? dashboardOptions[0]?.value ?? null);
    setDashboardModalOpen(true);
  };

  const ensureTemplateReadyForDashboard = () => {
    if (!isTemplatePersisted || !draft.id) {
      setTemplateError("Save this template before sending items to dashboards.");
      setTemplateSuccess(null);
      return false;
    }
    return true;
  };

  const buildFilterClausesForRequest = useCallback(
    (filters: ReportFilter[], aliasLookup: Map<string, string>) => {
      const clauses: string[] = [];
      const errors: string[] = [];

      const resolveColumnExpressionForFilter = (modelId: string, fieldId: string): string | null => {
        const alias = aliasLookup.get(modelId);
        const model = modelMap.get(modelId);
        if (!alias || !model) {
          return null;
        }
        const field = model.fields.find((candidate) => candidate.id === fieldId);
        if (!field) {
          return null;
        }
        const column = field.sourceColumn ?? field.id;
        return `${alias}.${quoteIdentifier(column)}`;
      };

      const buildDerivedExpressionSql = (fieldId: string): string | null => {
        const derivedField = derivedFieldMap.get(fieldId);
        if (!derivedField || !derivedField.expressionAst) {
          return null;
        }

        const renderNode = (node: DerivedFieldExpressionAst): string | null => {
          switch (node.type) {
            case "column":
              return resolveColumnExpressionForFilter(node.modelId, node.fieldId);
            case "literal":
              if (node.valueType === "number") {
                return Number(node.value).toString();
              }
              if (node.valueType === "boolean") {
                return node.value ? "TRUE" : "FALSE";
              }
              return `'${escapeSqlLiteral(String(node.value ?? ""))}'`;
            case "binary": {
              const left = renderNode(node.left);
              const right = renderNode(node.right);
              if (!left || !right) {
                return null;
              }
              return `(${left} ${node.operator} ${right})`;
            }
            case "unary": {
              const argument = renderNode(node.argument);
              if (!argument) {
                return null;
              }
              return `${node.operator}(${argument})`;
            }
            case "function": {
              const args = node.args.map((arg) => renderNode(arg));
              if (args.some((arg) => !arg)) {
                return null;
              }
              return `${node.name}(${args.join(", ")})`;
            }
            default:
              return null;
          }
        };

        return renderNode(derivedField.expressionAst);
      };

      const resolveFieldExpression = (option: FilterFieldOption): string | null => {
        if (option.modelId === DERIVED_FIELD_SENTINEL) {
          return buildDerivedExpressionSql(option.fieldId);
        }
        return resolveColumnExpressionForFilter(option.modelId, option.fieldId);
      };

      filters.forEach((filter) => {
        const leftOption = filterFieldLookup.get(buildFilterOptionKey(filter.leftModelId, filter.leftFieldId));
        if (!leftOption) {
          errors.push("A filter references a field that is no longer available.");
          return;
        }

        const operatorDefinition = FILTER_OPERATOR_LOOKUP.get(filter.operator);
        if (!operatorDefinition) {
          return;
        }

        const leftExpression = resolveFieldExpression(leftOption);
        if (!leftExpression) {
          errors.push(`"${leftOption.label}" is not available in the current preview.`);
          return;
        }

        const requiresValue = operatorDefinition.requiresValue;
        const allowFieldComparison = operatorDefinition.allowFieldComparison ?? false;
        const fieldLabel = leftOption.label;

        if (!requiresValue) {
          switch (filter.operator) {
            case "is_null":
              clauses.push(`${leftExpression} IS NULL`);
              break;
            case "is_not_null":
              clauses.push(`${leftExpression} IS NOT NULL`);
              break;
            case "is_true":
              clauses.push(`${leftExpression} IS TRUE`);
              break;
            case "is_false":
              clauses.push(`${leftExpression} IS FALSE`);
              break;
            default:
              break;
          }
          return;
        }

        if (filter.rightType === "field") {
          if (!allowFieldComparison) {
            errors.push(`The operator on "${fieldLabel}" does not support comparing against a field.`);
            return;
          }
          if (!filter.rightModelId || !filter.rightFieldId) {
            errors.push(`Select a comparison field for "${fieldLabel}".`);
            return;
          }
          const rightOption = filterFieldLookup.get(
            buildFilterOptionKey(filter.rightModelId, filter.rightFieldId),
          );
          if (!rightOption) {
            errors.push("The comparison field is no longer available.");
            return;
          }
          const rightExpression = resolveFieldExpression(rightOption);
          if (!rightExpression) {
            errors.push("The comparison field is not available in the current preview.");
            return;
          }
          const operatorSqlMap: Partial<Record<FilterOperator, string>> = {
            eq: "=",
            neq: "<>",
            gt: ">",
            gte: ">=",
            lt: "<",
            lte: "<=",
          };
          const sqlOperator = operatorSqlMap[filter.operator];
          if (!sqlOperator) {
            errors.push(`"${fieldLabel}" operator requires a literal value.`);
            return;
          }
          clauses.push(`${leftExpression} ${sqlOperator} ${rightExpression}`);
          return;
        }

        const buildLiteral = (kind: FilterValueKind, value: string): string | null => {
          if (kind === "number") {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) {
              errors.push(`Enter a valid number for "${fieldLabel}".`);
              return null;
            }
            return String(numeric);
          }
          if (kind === "boolean") {
            const normalized = value.toLowerCase();
            if (normalized !== "true" && normalized !== "false") {
              errors.push(`Select true or false for "${fieldLabel}".`);
              return null;
            }
            return normalized === "true" ? "TRUE" : "FALSE";
          }
          return `'${escapeSqlLiteral(value)}'`;
        };

        if (filter.operator === "between") {
          const rangeFrom = (filter.range?.from ?? "").trim();
          const rangeTo = (filter.range?.to ?? "").trim();
          if (!rangeFrom || !rangeTo) {
            errors.push(`Provide both start and end values for "${fieldLabel}".`);
            return;
          }
          const fromLiteral = buildLiteral(filter.valueKind, rangeFrom);
          const toLiteral = buildLiteral(filter.valueKind, rangeTo);
          if (!fromLiteral || !toLiteral) {
            return;
          }
          clauses.push(`${leftExpression} BETWEEN ${fromLiteral} AND ${toLiteral}`);
          return;
        }

        const trimmedValue = (filter.value ?? "").trim();
        if (filter.valueKind !== "boolean" && trimmedValue.length === 0) {
          errors.push(`Provide a value for the filter on "${fieldLabel}".`);
          return;
        }

        switch (filter.operator) {
          case "eq":
          case "neq":
          case "gt":
          case "gte":
          case "lt":
          case "lte": {
            const operatorSqlMap: Record<FilterOperator, string> = {
              eq: "=",
              neq: "<>",
              gt: ">",
              gte: ">=",
              lt: "<",
              lte: "<=",
              between: "",
              contains: "",
              starts_with: "",
              ends_with: "",
              is_null: "IS NULL",
              is_not_null: "IS NOT NULL",
              is_true: "IS TRUE",
              is_false: "IS FALSE",
            };
            const literal = buildLiteral(filter.valueKind, trimmedValue);
            if (!literal) {
              return;
            }
            clauses.push(`${leftExpression} ${operatorSqlMap[filter.operator]} ${literal}`);
            break;
          }
          case "contains": {
            const literal = `'${`%${escapeSqlLiteral(trimmedValue)}%`}'`;
            clauses.push(`${leftExpression} ILIKE ${literal}`);
            break;
          }
          case "starts_with": {
            const literal = `'${`${escapeSqlLiteral(trimmedValue)}%`}'`;
            clauses.push(`${leftExpression} ILIKE ${literal}`);
            break;
          }
          case "ends_with": {
            const literal = `'${`%${escapeSqlLiteral(trimmedValue)}`}'`;
            clauses.push(`${leftExpression} ILIKE ${literal}`);
            break;
          }
          default:
            break;
        }
      });

      return { clauses, errors };
    },
    [derivedFieldMap, filterFieldLookup, modelMap],
  );

  const buildPreviewRequestPayload = useCallback((): {
    payload?: ReportPreviewRequest;
    error?: string;
    visualError?: string;
  } => {
    if (draft.models.length === 0) {
      return {
        error: "Select at least one data model to run a preview.",
        visualError: "Select at least one data model to run analytics.",
      };
    }

    const sanitizedFields = draft.fields
      .map((entry) => ({
        modelId: entry.modelId,
        fieldIds: entry.fieldIds.filter((fieldId) => Boolean(fieldId)),
      }))
      .filter((entry) => entry.fieldIds.length > 0);

    if (sanitizedFields.length === 0) {
      return {
        error: "Select at least one field to include in your preview.",
        visualError: "Select at least one field to power analytics.",
      };
    }

    if (hasStaleDerivedFields) {
      const staleMessage =
        staleDerivedFieldNames.length > 0
          ? `Resolve stale derived fields (${staleDerivedFieldNames}) before running a preview.`
          : "Resolve stale derived fields before running a preview.";
      return {
        error: staleMessage,
        visualError: staleMessage,
      };
    }

    const aliasMap = new Map<string, string>();
    draft.models.forEach((modelId, index) => {
      aliasMap.set(modelId, `m${index}`);
    });

    const { clauses: filterClauses, errors: filterErrors } = buildFilterClausesForRequest(
      draft.filters,
      aliasMap,
    );

    if (filterErrors.length > 0) {
      const message = filterErrors.join(" | ");
      return {
        error: message,
        visualError: message,
      };
    }

    const orderByPayload = draft.previewOrder.reduce<PreviewOrderClausePayload[]>(
      (accumulator, rule) => {
        if (rule.source === "derived") {
          accumulator.push({
            source: "derived",
            fieldId: rule.fieldId,
            direction: rule.direction,
          });
          return accumulator;
        }
        if (rule.modelId) {
          accumulator.push({
            source: "model",
            modelId: rule.modelId,
            fieldId: rule.fieldId,
            direction: rule.direction,
          });
        }
        return accumulator;
      },
      [],
    );

    const payload: ReportPreviewRequest = {
      models: draft.models,
      fields: sanitizedFields,
      joins: draft.joins.map(
        ({ id, leftModel, leftField, rightModel, rightField, joinType, description }) => ({
          id,
          leftModel,
          leftField,
          rightModel,
          rightField,
          joinType,
          description,
        }),
      ),
      filters: filterClauses,
      orderBy: orderByPayload.length > 0 ? orderByPayload : undefined,
      limit: 500,
      derivedFields: derivedFieldPayloads.length > 0 ? derivedFieldPayloads : undefined,
      grouping:
        draft.previewGrouping.length > 0
          ? draft.previewGrouping.reduce<PreviewGroupingRuleDto[]>((accumulator, rule) => {
              if (rule.source === "model" && !rule.modelId) {
                return accumulator;
              }
              accumulator.push({
                id: rule.id,
                source: rule.source,
                modelId: rule.source === "derived" ? null : rule.modelId ?? null,
                fieldId: rule.fieldId,
                bucket: rule.bucket ?? null,
              });
              return accumulator;
            }, [])
          : undefined,
      aggregations:
        draft.previewAggregations.length > 0
          ? draft.previewAggregations.reduce<PreviewAggregationRuleDto[]>((accumulator, rule) => {
              if (rule.source === "model" && !rule.modelId) {
                return accumulator;
              }
              accumulator.push({
                id: rule.id,
                source: rule.source,
                modelId: rule.source === "derived" ? null : rule.modelId ?? null,
                fieldId: rule.fieldId,
                aggregation: rule.aggregation,
                alias: rule.alias ?? null,
              });
              return accumulator;
            }, [])
          : undefined,
      having:
        draft.previewHaving.length > 0
          ? draft.previewHaving
              .filter((clause) => draft.previewAggregations.some((agg) => agg.id === clause.aggregationId))
              .map((clause) => ({
                id: clause.id,
                aggregationId: clause.aggregationId,
                operator: clause.operator,
                value: clause.value ?? "",
                valueKind: clause.valueKind,
              }))
          : undefined,
    };

    return { payload };
  }, [draft, derivedFieldPayloads, hasStaleDerivedFields, staleDerivedFieldNames, buildFilterClausesForRequest]);

  const findDateFilterMetadata = useCallback(
    (
      filterClauses?: ReportPreviewRequest["filters"],
    ): {
      modelId: string;
      fieldId: string;
      operator: FilterOperator;
      filterIndex: number;
      clauseSql?: string;
    } | null => {
      let fallback: {
        modelId: string;
        fieldId: string;
        operator: FilterOperator;
        filterIndex: number;
        clauseSql?: string;
      } | null = null;
      for (let index = 0; index < draft.filters.length; index += 1) {
        const filter = draft.filters[index];
        if (!filter.leftModelId || !filter.leftFieldId) {
          continue;
        }
        const leftOption = filterFieldLookup.get(buildFilterOptionKey(filter.leftModelId, filter.leftFieldId));
        if (!leftOption || leftOption.modelId === DERIVED_FIELD_SENTINEL) {
          continue;
        }
        const isDateFilter = filter.valueKind === "date" || leftOption.field.type === "date";
        if (!isDateFilter) {
          continue;
        }
        if (
          filter.operator === "between" ||
          filter.operator === "gte" ||
          filter.operator === "lte"
        ) {
          const clauseInput = Array.isArray(filterClauses) ? filterClauses[index] : undefined;
          const clauseSql =
            typeof clauseInput === "string" && clauseInput.trim().length > 0 ? clauseInput.trim() : undefined;
          const metadata = {
            modelId: filter.leftModelId,
            fieldId: filter.leftFieldId,
            operator: filter.operator,
            filterIndex: index,
            ...(clauseSql ? { clauseSql } : {}),
          };
          if (filter.operator === "between") {
            return metadata;
          }
          if (!fallback) {
            fallback = metadata;
          }
        }
      }
      return fallback;
    },
    [draft.filters, filterFieldLookup],
  );

  const buildVisualCardViewConfig = useCallback(
    (
      visual: VisualDefinition,
      options?: {
        sample?: DashboardVisualCardViewConfig["sample"];
        dateFilterMetadata?: ReturnType<typeof findDateFilterMetadata> | null;
      },
    ): DashboardVisualCardViewConfig | null => {
      if (!visual.metric || !visual.dimension) {
        return null;
      }
      const descriptor = buildVisualDescriptor(visual);
      const metricLabel = descriptor.metricLabel ?? getColumnLabel(visual.metric) ?? "Metric";
      const dimensionLabel =
        descriptor.dimensionLabel ?? getColumnLabel(visual.dimension) ?? "Dimension";
      const comparisonLabel =
        visual.comparison &&
        (descriptor.comparisonLabel ?? getColumnLabel(visual.comparison) ?? visual.comparison);
      const normalizedName =
        visual.name && visual.name.trim().length > 0 ? visual.name.trim() : `${metricLabel} vs ${dimensionLabel}`;
      return {
        mode: "visual",
        description: `Visual: ${metricLabel} vs ${dimensionLabel}`,
        queryConfig: descriptor.config ? deepClone(descriptor.config) : null,
        metricAlias: descriptor.metricAlias ?? undefined,
        dimensionAlias: descriptor.dimensionAlias ?? undefined,
        comparisonAlias: descriptor.comparisonAlias ?? undefined,
        ...(options?.dateFilterMetadata ? { dateFilter: { ...options.dateFilterMetadata } } : {}),
        visual: {
          id: visual.id,
          name: normalizedName,
          type: visual.type,
          metric: visual.metric,
          metricAggregation:
            visual.metricAggregation && METRIC_AGGREGATIONS.includes(visual.metricAggregation)
              ? visual.metricAggregation
              : "sum",
          metricLabel,
          dimension: visual.dimension,
          dimensionLabel,
          dimensionBucket: visual.dimensionBucket,
          comparison: visual.comparison ?? undefined,
          comparisonLabel: comparisonLabel ?? undefined,
          comparisonAggregation:
            visual.comparison && visual.comparisonAggregation
              ? visual.comparisonAggregation
              : undefined,
          limit:
            typeof visual.limit === "number" && Number.isFinite(visual.limit) && visual.limit > 0
              ? Math.round(visual.limit)
              : 100,
        },
        sample: options?.sample,
      };
    },
    [buildVisualDescriptor, getColumnLabel],
  );

  const handleAddVisualToDashboard = () => {
    if (!ensureTemplateReadyForDashboard()) {
      return;
    }
    if (!activeVisual.metric || !activeVisual.dimension) {
      setTemplateError("Select both a metric and dimension before adding this visual to a dashboard.");
      return;
    }
    const metricLabel =
      visualQueryDescriptor.metricLabel ?? getColumnLabel(activeVisual.metric) ?? "Metric";
    const dimensionLabel =
      visualQueryDescriptor.dimensionLabel ?? getColumnLabel(activeVisual.dimension) ?? "Dimension";
    const defaultTitle =
      activeVisual.name && activeVisual.name.trim().length > 0
        ? activeVisual.name.trim()
        : `${metricLabel} vs ${dimensionLabel}`;
    const sample =
      visualRows.length > 0
        ? {
            rows: visualRows.slice(0, 25).map((row) => ({ ...row })),
            columns: [...visualColumns],
          }
        : undefined;
    const dateFilterMetadata = findDateFilterMetadata();
    const viewConfig = buildVisualCardViewConfig(activeVisual, {
      sample,
      dateFilterMetadata,
    });
    if (!viewConfig) {
      setTemplateError("Unable to build the visual configuration for this dashboard card.");
      return;
    }
    const cardDraft: DashboardCardModalDraft = {
      templateId: draft.id,
      title: defaultTitle,
      viewConfig,
      layout: { ...DASHBOARD_CARD_DEFAULT_LAYOUT },
    };
    handleOpenDashboardModal(cardDraft);
  };

  const buildPreviewTableViewConfig = useCallback(
    (
      description: string,
      existing: DashboardPreviewTableCardViewConfig | null = null,
      onError?: (message: string) => void,
    ): DashboardPreviewTableCardViewConfig | null => {
      const { payload, error } = buildPreviewRequestPayload();
      if (!payload) {
        if (onError) {
          onError(error ?? "Unable to build the preview configuration for this dashboard card.");
        }
        return null;
      }
      const dateFilterMetadata = findDateFilterMetadata(payload.filters);
      return {
        mode: "preview_table",
        description,
        previewRequest: deepClone(payload),
        columnOrder: previewColumns.length > 0 ? [...previewColumns] : existing?.columnOrder ?? [],
        columnAliases: { ...draft.columnAliases },
        ...(dateFilterMetadata ? { dateFilter: dateFilterMetadata } : {}),
      };
    },
    [buildPreviewRequestPayload, draft.columnAliases, findDateFilterMetadata, previewColumns],
  );

  const updateDashboardCardsForTemplate = useCallback(
    async (templateId: string) => {
      if (!templateId || dashboards.length === 0) {
        return;
      }
      const dateFilterMetadata = findDateFilterMetadata();
      const visualLookup = new Map<string, VisualDefinition>();
      draft.visuals.forEach((visual) => {
        if (visual.id) {
          visualLookup.set(visual.id, visual);
        }
      });
      const spotlightLookup = new Map<string, MetricSpotlightDefinitionDto>();
      draft.metricsSpotlight.forEach((spotlight) => {
        if (spotlight.metric) {
          spotlightLookup.set(spotlight.metric, spotlight);
        }
      });
      const updateTasks: Promise<DashboardCardDto | void>[] = [];
      const enqueueUpdate = (
        dashboardId: string,
        card: DashboardCardDto,
        viewConfig: DashboardCardViewConfig,
      ) => {
        updateTasks.push(
          upsertDashboardCardMutation.mutateAsync({
            dashboardId,
            cardId: card.id,
            payload: {
              templateId,
              title: card.title,
              viewConfig,
              layout: card.layout,
            },
          }),
        );
      };
      dashboards.forEach((dashboard) => {
        (dashboard.cards ?? []).forEach((card) => {
          if (card.templateId !== templateId) {
            return;
          }
          const viewConfig = (card.viewConfig as DashboardCardViewConfig) ?? null;
          if (isPreviewTableCardViewConfig(viewConfig)) {
            const updatedConfig = buildPreviewTableViewConfig(viewConfig.description ?? card.title, viewConfig);
            if (!updatedConfig) {
              return;
            }
            enqueueUpdate(dashboard.id, card, updatedConfig);
            return;
          }
          if (isVisualCardViewConfig(viewConfig)) {
            const visualId = viewConfig.visual?.id ?? null;
            const matchingVisual = visualId ? visualLookup.get(visualId) : undefined;
            if (matchingVisual) {
              const updatedConfig = buildVisualCardViewConfig(matchingVisual, {
                sample: viewConfig.sample,
                dateFilterMetadata,
              });
              if (updatedConfig) {
                enqueueUpdate(dashboard.id, card, updatedConfig);
                return;
              }
            }
            if (dateFilterMetadata) {
              if (
                viewConfig.dateFilter &&
                viewConfig.dateFilter.modelId === dateFilterMetadata.modelId &&
                viewConfig.dateFilter.fieldId === dateFilterMetadata.fieldId &&
                viewConfig.dateFilter.operator === dateFilterMetadata.operator
              ) {
                return;
              }
              enqueueUpdate(dashboard.id, card, {
                ...viewConfig,
                dateFilter: { ...dateFilterMetadata },
              });
            }
            return;
          }
          if (isSpotlightCardViewConfig(viewConfig)) {
            const spotlightMetric = viewConfig.spotlight?.metric ?? null;
            const latestSpotlight = spotlightMetric ? spotlightLookup.get(spotlightMetric) : undefined;
            if (latestSpotlight) {
              const updatedConfig: DashboardSpotlightCardViewConfig = {
                ...viewConfig,
                spotlight: {
                  ...viewConfig.spotlight,
                  ...latestSpotlight,
                  metricLabel: getColumnLabel(latestSpotlight.metric),
                },
                ...(dateFilterMetadata ? { dateFilter: { ...dateFilterMetadata } } : {}),
              };
              enqueueUpdate(dashboard.id, card, updatedConfig);
              return;
            }
            if (dateFilterMetadata) {
              if (
                viewConfig.dateFilter &&
                viewConfig.dateFilter.modelId === dateFilterMetadata.modelId &&
                viewConfig.dateFilter.fieldId === dateFilterMetadata.fieldId &&
                viewConfig.dateFilter.operator === dateFilterMetadata.operator
              ) {
                return;
              }
              enqueueUpdate(dashboard.id, card, {
                ...viewConfig,
                dateFilter: { ...dateFilterMetadata },
              });
            }
          }
        });
      });
      if (updateTasks.length === 0) {
        return;
      }
      try {
        await Promise.allSettled(updateTasks);
        await queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      } catch (error) {
        console.error("Failed to refresh dashboard cards after saving template", error);
        setTemplateError((current) => current ?? "Template saved, but some dashboard cards were not refreshed.");
      }
    },
    [
      buildPreviewTableViewConfig,
      buildVisualCardViewConfig,
      dashboards,
      draft.metricsSpotlight,
      draft.visuals,
      findDateFilterMetadata,
      getColumnLabel,
      queryClient,
      setTemplateError,
      upsertDashboardCardMutation,
    ],
  );

  const handleAddPreviewToDashboard = () => {
    if (!ensureTemplateReadyForDashboard()) {
      return;
    }
    if (!draft.id) {
      return;
    }
    if (previewColumns.length === 0) {
      setTemplateError("Run the data preview to capture sample rows before adding this table to a dashboard.");
      setTemplateSuccess(null);
      return;
    }
    const baseTitle = draft.name && draft.name.trim().length > 0 ? draft.name.trim() : "Report";
    const defaultTitle = `${baseTitle} preview table`;
    const viewConfig = buildPreviewTableViewConfig(`Preview table for ${baseTitle}`, null, (errorMessage) => {
      setTemplateError(errorMessage);
      setTemplateSuccess(null);
    });
    if (!viewConfig) {
      return;
    }
    const cardDraft: DashboardCardModalDraft = {
      templateId: draft.id,
      title: defaultTitle,
      viewConfig,
      layout: {
        ...DASHBOARD_CARD_DEFAULT_LAYOUT,
        w: 10,
        h: 6,
      },
    };
    handleOpenDashboardModal(cardDraft);
  };

  const handleAddSpotlightToDashboard = (index: number) => {
    if (!ensureTemplateReadyForDashboard()) {
      return;
    }
    const spotlight = draft.metricsSpotlight[index];
    if (!spotlight || !spotlight.metric) {
      setTemplateError("Choose a metric for this spotlight before adding it to a dashboard.");
      return;
    }
    const metricLabel = getColumnLabel(spotlight.metric);
    const defaultTitle =
      spotlight.label && spotlight.label.trim().length > 0 ? spotlight.label.trim() : metricLabel;
    const spotlightId = spotlight.metric || `spotlight-${index}`;
    const summaryCard = metricsSummary.find((card) => card.id === spotlightId);
    const dateFilterMetadata = findDateFilterMetadata();
    const viewConfig: DashboardCardViewConfig = {
      mode: "spotlight",
      description: `Spotlight: ${defaultTitle}`,
      spotlight: {
        ...spotlight,
        metricLabel,
      },
      ...(dateFilterMetadata ? { dateFilter: dateFilterMetadata } : {}),
      sample: summaryCard
        ? {
            cards: [
              {
                id: summaryCard.id,
                label: summaryCard.label,
                value: summaryCard.value,
                delta: summaryCard.delta,
                context: summaryCard.context,
                tone: summaryCard.tone,
              },
            ],
          }
        : undefined,
    };
    const cardDraft: DashboardCardModalDraft = {
      templateId: draft.id,
      title: defaultTitle,
      viewConfig,
      layout: {
        ...DASHBOARD_CARD_DEFAULT_LAYOUT,
        w: 3,
        h: 3,
      },
    };
    handleOpenDashboardModal(cardDraft);
  };

  const handleConfirmDashboardCard = async () => {
    if (!dashboardCardDraft) {
      setDashboardModalError("Select a visual or spotlight to create a card.");
      return;
    }
    if (!selectedDashboardIdForModal) {
      setDashboardModalError("Choose a destination dashboard.");
      return;
    }
    const normalizedTitle = dashboardCardTitle.trim();
    if (normalizedTitle.length === 0) {
      setDashboardModalError("Enter a title for the dashboard card.");
      return;
    }
    setDashboardModalError(null);
    try {
      await upsertDashboardCardMutation.mutateAsync({
        dashboardId: selectedDashboardIdForModal,
        payload: {
          templateId: dashboardCardDraft.templateId,
          title: normalizedTitle,
          viewConfig: dashboardCardDraft.viewConfig,
          layout: dashboardCardDraft.layout,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      setTemplateSuccess("Dashboard card saved.");
      handleCloseDashboardModal();
    } catch (error) {
      setDashboardModalError(extractAxiosErrorMessage(error, "Failed to save dashboard card."));
    }
  };

  const renderDashboardCardSummary = () => {
    if (!dashboardCardDraft) {
      return null;
    }
    const { viewConfig } = dashboardCardDraft;
    if (!viewConfig || typeof viewConfig !== "object") {
      return (
        <Text fz="sm" c="dimmed">
          Legacy dashboard card. Save a new visual or spotlight to update the configuration preview.
        </Text>
      );
    }
    if (isVisualCardViewConfig(viewConfig)) {
      const visual = viewConfig.visual;
      const visualTypeLabel =
        VISUAL_TYPE_OPTIONS.find((option) => option.value === visual.type)?.label ?? visual.type;
      return (
        <Stack gap={4}>
          <Text fw={600} fz="sm">
            {visual.metricLabel} vs {visual.dimensionLabel}
          </Text>
          <Text fz="xs" c="dimmed">
            {visualTypeLabel} • Aggregation {visual.metricAggregation.toUpperCase()}
            {visual.dimensionBucket ? ` • Bucket ${visual.dimensionBucket}` : ""}
            {visual.comparison ? ` • Comparison ${visual.comparisonLabel ?? visual.comparison}` : ""}
          </Text>
          {viewConfig.sample?.rows && viewConfig.sample.rows.length > 0 ? (
            <Text fz="xs" c="dimmed">
              Captured {viewConfig.sample.rows.length} sample row
              {viewConfig.sample.rows.length === 1 ? "" : "s"} across {viewConfig.sample.columns.length} columns.
            </Text>
          ) : (
            <Text fz="xs" c="dimmed">
              Run analytics to capture preview data for this card.
            </Text>
          )}
        </Stack>
      );
    }
    if (isSpotlightCardViewConfig(viewConfig)) {
      const { spotlight } = viewConfig;
      const sampleCard = viewConfig.sample?.cards?.[0];
      return (
        <Stack gap={4}>
          <Text fw={600} fz="sm">
            {spotlight.label?.trim() || spotlight.metricLabel}
          </Text>
          <Text fz="xs" c="dimmed">
            Format: {(spotlight.format ?? "number").toUpperCase()}
            {typeof spotlight.target === "number" ? ` • Target ${formatMetricValue(spotlight.target, spotlight.format)}` : ""}
            {spotlight.comparison ? ` • Comparison ${spotlight.comparison.toUpperCase()}` : ""}
          </Text>
          {sampleCard ? (
            <Text fz="xs" c="dimmed">
              Latest value {sampleCard.value} ({sampleCard.delta}) – {sampleCard.context}.
            </Text>
          ) : (
            <Text fz="xs" c="dimmed">
              Run analytics to capture sample values for this spotlight.
            </Text>
          )}
        </Stack>
      );
    }
    if (isPreviewTableCardViewConfig(viewConfig)) {
      return (
        <Stack gap={4}>
          <Text fw={600} fz="sm">
            Preview table
          </Text>
          <Text fz="xs" c="dimmed">
            {viewConfig.columnOrder.length} columns captured from the latest preview configuration.
          </Text>
        </Stack>
      );
    }
    return null;
  };

  const handleSpotlightChange = (
    index: number,
    patch: Partial<MetricSpotlightDefinitionDto>,
  ) => {
    setDraft((current) => {
      const next = [...current.metricsSpotlight];
      const existing = next[index];
      if (!existing) {
        return current;
      }
      next[index] = { ...existing, ...patch };
      return {
        ...current,
        metricsSpotlight: next,
      };
    });
  };

  const handleRemoveSpotlight = (index: number) => {
    setDraft((current) => ({
      ...current,
      metricsSpotlight: current.metricsSpotlight.filter((_, spotlightIndex) => spotlightIndex !== index),
    }));
  };

  const handleScheduleDraftChange = (patch: Partial<typeof scheduleDraft>) => {
    setScheduleDraft((current) => ({ ...current, ...patch }));
  };

  const handleUpdateSchedule = async (
    scheduleId: string,
    payload: Partial<TemplateSchedulePayload>,
  ) => {
    if (!isTemplatePersisted || !draft.id) {
      return;
    }
    setTemplateError(null);
    setTemplateSuccess(null);
    setActiveScheduleMutationId(scheduleId);
    try {
      await updateScheduleMutation.mutateAsync({
        templateId: draft.id,
        scheduleId,
        payload,
      });
      if (scheduleQueryKey) {
        await queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
      }
      setTemplateSuccess("Schedule updated.");
    } catch (error) {
      setTemplateError(extractAxiosErrorMessage(error, "Failed to update schedule."));
    } finally {
      setActiveScheduleMutationId(null);
    }
  };

  const handleCreateSchedule = async () => {
    if (!isTemplatePersisted || !draft.id) {
      setTemplateError("Save the template before configuring schedules.");
      setTemplateSuccess(null);
      return;
    }
    setTemplateError(null);
    setTemplateSuccess(null);
    const deliveryTargets = parseRecipientList(scheduleDraft.recipients);
    if (deliveryTargets.length === 0) {
      setTemplateError("Add at least one recipient email to create a schedule.");
      return;
    }
    try {
      await createScheduleMutation.mutateAsync({
        templateId: draft.id,
        payload: {
          cadence: scheduleDraft.cadence,
          timezone: scheduleDraft.timezone,
          deliveryTargets,
          status: scheduleDraft.status,
        },
      });
      if (scheduleQueryKey) {
        await queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
      }
      setScheduleDraft((current) => ({ ...current, recipients: "" }));
      setTemplateSuccess("Schedule created.");
    } catch (error) {
      setTemplateError(extractAxiosErrorMessage(error, "Failed to create schedule."));
    }
  };

  const handleScheduleCadenceChange = (schedule: TemplateScheduleDto, cadence: string | null) => {
    if (!cadence || cadence === schedule.cadence) {
      return;
    }
    void handleUpdateSchedule(schedule.id, { cadence });
  };

  const handleScheduleTimezoneBlur = (schedule: TemplateScheduleDto, value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === schedule.timezone) {
      return;
    }
    void handleUpdateSchedule(schedule.id, { timezone: trimmed });
  };

  const handleScheduleRecipientsBlur = (schedule: TemplateScheduleDto, value: string) => {
    const normalized = value.trim();
    if (normalized === formatDeliveryTargetsLabel(schedule.deliveryTargets).trim()) {
      return;
    }
    void handleUpdateSchedule(schedule.id, {
      deliveryTargets: parseRecipientList(normalized),
    });
  };

  const handleToggleScheduleStatus = (schedule: TemplateScheduleDto) => {
    const nextStatus: ScheduleStatus =
      (schedule.status ?? "active") === "paused" ? "active" : "paused";
    void handleUpdateSchedule(schedule.id, { status: nextStatus });
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!isTemplatePersisted || !draft.id) {
      return;
    }
    if (typeof window !== "undefined" && !window.confirm("Remove this schedule?")) {
      return;
    }
    setTemplateError(null);
    setTemplateSuccess(null);
    setActiveScheduleMutationId(scheduleId);
    try {
      await deleteScheduleMutation.mutateAsync({ templateId: draft.id, scheduleId });
      if (scheduleQueryKey) {
        await queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
      }
      setTemplateSuccess("Schedule removed.");
    } catch (error) {
      setTemplateError(extractAxiosErrorMessage(error, "Failed to delete schedule."));
    } finally {
      setActiveScheduleMutationId(null);
    }
  };

  const handleExportTemplate = async () => {
    if (!isTemplatePersisted || !draft.id) {
      setTemplateError("Save the template before exporting.");
      setTemplateSuccess(null);
      return;
    }
    setTemplateError(null);
    setTemplateSuccess(null);
    try {
      await exportTemplateMutation.mutateAsync(draft.id);
      setTemplateSuccess("Template export initiated.");
    } catch (error) {
      setTemplateError(extractAxiosErrorMessage(error, "Failed to export template."));
    }
  };

  const handleVisualChange = (patch: Partial<VisualDefinition>) => {
    setDraft((current) => {
      const nextVisual = { ...current.visuals[0], ...patch };
      return {
        ...current,
        visuals: current.visuals.length > 0 ? [nextVisual, ...current.visuals.slice(1)] : [nextVisual],
      };
    });
  };

  const handleSaveTemplate = async () => {
    if (saveTemplateMutation.isPending) {
      return;
    }

    setTemplateSuccess(null);
    if (!draft.name.trim()) {
      setTemplateError("Template name is required.");
      return;
    }

    if (hasStaleDerivedFields) {
      setTemplateError(
        staleDerivedFieldNames.length > 0
          ? `Resolve stale derived fields (${staleDerivedFieldNames}) before saving.`
          : "Resolve stale derived fields before saving.",
      );
      return;
    }

    setTemplateError(null);

    const payload: SaveReportTemplateRequest = {
      id: templates.some((template) => template.id === draft.id) ? draft.id : undefined,
      name: draft.name.trim(),
      category: draft.category.trim() || "Custom",
      description: draft.description,
      schedule: draft.schedule || "Manual",
      models: [...draft.models],
      fields: deepClone(draft.fields),
      joins: deepClone(draft.joins),
      visuals: deepClone(draft.visuals),
      metrics: [...draft.metrics],
      filters: deepClone(draft.filters),
      options: {
        autoDistribution: draft.autoDistribution,
        notifyTeam: draft.notifyTeam,
        columnOrder: [...draft.columnOrder],
        columnAliases: { ...draft.columnAliases },
        previewOrder: draft.previewOrder.map((rule) => ({ ...rule })),
        previewGrouping: serializePreviewGroupingRules(draft.previewGrouping),
        previewAggregations: serializePreviewAggregationRules(draft.previewAggregations),
        previewHaving: serializePreviewHavingRules(draft.previewHaving),
        autoRunOnOpen: draft.autoRunOnOpen,
      },
      queryConfig: draft.queryConfig ? deepClone(draft.queryConfig) : null,
      derivedFields: deepClone(draft.derivedFields),
      metricsSpotlight: deepClone(draft.metricsSpotlight),
      columnOrder: [...draft.columnOrder],
      columnAliases: { ...draft.columnAliases },
      previewOrder: draft.previewOrder.map((rule) => ({ ...rule })),
      previewGrouping: serializePreviewGroupingRules(draft.previewGrouping),
      previewAggregations: serializePreviewAggregationRules(draft.previewAggregations),
      previewHaving: serializePreviewHavingRules(draft.previewHaving),
    };

    try {
      const saved = await saveTemplateMutation.mutateAsync(payload);
      upsertTemplateInCache(saved);
      const mapped = mapTemplateFromApi(saved);
      const mergedTemplate =
        mapped.columnOrder.length > 0 || Object.keys(mapped.columnAliases).length > 0
          ? mapped
          : {
              ...mapped,
              columnOrder: [...draft.columnOrder],
              columnAliases: { ...draft.columnAliases },
              autoRunOnOpen: draft.autoRunOnOpen,
              previewOrder: [...draft.previewOrder],
              previewGrouping: [...draft.previewGrouping],
              previewAggregations: [...draft.previewAggregations],
              previewHaving: [...draft.previewHaving],
            };
      setTemplates((current) => {
        const exists = current.some((template) => template.id === mergedTemplate.id);
        if (exists) {
          return current.map((template) => (template.id === mergedTemplate.id ? mergedTemplate : template));
        }
        return [...current, mergedTemplate];
      });
      setSelectedTemplateId(mergedTemplate.id);
      setDraft(deepClone(mergedTemplate));
      await updateDashboardCardsForTemplate(mergedTemplate.id);
      setTemplateSuccess("Template saved.");
    } catch (error) {
      setTemplateError(extractAxiosErrorMessage(error, "Failed to save template"));
    }
  };

  const handleCreateTemplate = async () => {
    if (saveTemplateMutation.isPending) {
      return;
    }

    setTemplateError(null);
    setTemplateSuccess(null);

    const contextLabel =
      selectedTemplate?.category && selectedTemplate.category.trim().length > 0
        ? selectedTemplate.category
        : "Custom";
    const payload: SaveReportTemplateRequest = {
      name: `${contextLabel} report`,
      category: "Custom",
      description:
        "Blank template. Add data models, joins and visualizations to start building your report.",
      schedule: "Manual",
      models: [],
      fields: [],
      joins: [],
      visuals: [deepClone(DEFAULT_VISUAL)],
      metrics: [],
      filters: [],
      options: {
        autoDistribution: true,
        notifyTeam: true,
        columnOrder: [],
        columnAliases: {},
        previewOrder: [],
        previewGrouping: [],
        previewAggregations: [],
        previewHaving: [],
        autoRunOnOpen: false,
      },
      queryConfig: null,
      derivedFields: [],
      metricsSpotlight: [],
      columnOrder: [],
      columnAliases: {},
      previewOrder: [],
      previewGrouping: [],
      previewAggregations: [],
      previewHaving: [],
    };

    try {
      const created = await saveTemplateMutation.mutateAsync(payload);
      upsertTemplateInCache(created);
      const mapped = mapTemplateFromApi(created);
      const mergedTemplate =
        mapped.columnOrder.length > 0 || Object.keys(mapped.columnAliases).length > 0
          ? mapped
          : {
              ...mapped,
              columnOrder: [],
              columnAliases: {},
              autoRunOnOpen: false,
              previewOrder: [],
              previewGrouping: [],
              previewAggregations: [],
              previewHaving: [],
            };
      setTemplates((current) => [...current, mergedTemplate]);
      setSelectedTemplateId(mergedTemplate.id);
      setDraft(deepClone(mergedTemplate));
      setTemplateSuccess("Template created.");
    } catch (error) {
      setTemplateError(extractAxiosErrorMessage(error, "Failed to create template"));
    }
  };

  const handleDuplicateTemplate = async () => {
    if (!selectedTemplate || saveTemplateMutation.isPending) {
      return;
    }

    setTemplateError(null);
    setTemplateSuccess(null);

    const duplicatePayload: SaveReportTemplateRequest = {
      name: `${selectedTemplate.name || "Untitled report"} (copy)`,
      category: selectedTemplate.category,
      description: selectedTemplate.description,
      schedule: selectedTemplate.schedule,
      models: [...selectedTemplate.models],
      fields: deepClone(selectedTemplate.fields),
      joins: deepClone(selectedTemplate.joins),
      visuals: deepClone(selectedTemplate.visuals),
      metrics: [...selectedTemplate.metrics],
      filters: deepClone(selectedTemplate.filters),
      options: {
        autoDistribution: selectedTemplate.autoDistribution,
        notifyTeam: selectedTemplate.notifyTeam,
        columnOrder: [...selectedTemplate.columnOrder],
        columnAliases: { ...selectedTemplate.columnAliases },
        previewOrder: selectedTemplate.previewOrder.map((rule) => ({ ...rule })),
        previewGrouping: serializePreviewGroupingRules(selectedTemplate.previewGrouping),
        previewAggregations: serializePreviewAggregationRules(selectedTemplate.previewAggregations),
        previewHaving: serializePreviewHavingRules(selectedTemplate.previewHaving),
        autoRunOnOpen: selectedTemplate.autoRunOnOpen,
      },
      queryConfig: selectedTemplate.queryConfig
        ? deepClone(selectedTemplate.queryConfig)
        : null,
      derivedFields: deepClone(selectedTemplate.derivedFields),
      metricsSpotlight: deepClone(selectedTemplate.metricsSpotlight),
      columnOrder: [...selectedTemplate.columnOrder],
      columnAliases: { ...selectedTemplate.columnAliases },
      previewOrder: selectedTemplate.previewOrder.map((rule) => ({ ...rule })),
      previewGrouping: serializePreviewGroupingRules(selectedTemplate.previewGrouping),
      previewAggregations: serializePreviewAggregationRules(selectedTemplate.previewAggregations),
      previewHaving: serializePreviewHavingRules(selectedTemplate.previewHaving),
    };

    try {
      const created = await saveTemplateMutation.mutateAsync(duplicatePayload);
      upsertTemplateInCache(created);
      const mapped = mapTemplateFromApi(created);
      const mergedTemplate =
        mapped.columnOrder.length > 0 || Object.keys(mapped.columnAliases).length > 0
          ? mapped
          : {
              ...mapped,
              columnOrder: [...selectedTemplate.columnOrder],
              columnAliases: { ...selectedTemplate.columnAliases },
              autoRunOnOpen: selectedTemplate.autoRunOnOpen,
              previewOrder: [...selectedTemplate.previewOrder],
              previewGrouping: [...selectedTemplate.previewGrouping],
              previewAggregations: [...selectedTemplate.previewAggregations],
              previewHaving: [...selectedTemplate.previewHaving],
            };
      setTemplates((current) => [...current, mergedTemplate]);
      setSelectedTemplateId(mergedTemplate.id);
      setDraft(deepClone(mergedTemplate));
      setTemplateSuccess("Template duplicated.");
    } catch (error) {
      setTemplateError(extractAxiosErrorMessage(error, "Failed to duplicate template"));
    }
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplate || deleteTemplateMutation.isPending) {
      return;
    }

    setTemplateError(null);
    setTemplateSuccess(null);

    try {
      await deleteTemplateMutation.mutateAsync(selectedTemplate.id);
      removeTemplateFromCache(selectedTemplate.id);
      setTemplates((current) => {
        const filtered = current.filter((template) => template.id !== selectedTemplate.id);
        if (filtered.length === 0) {
          setSelectedTemplateId("");
          setDraft(createEmptyTemplate());
          return [];
        }
        const fallback = filtered[0];
        setSelectedTemplateId(fallback.id);
        setDraft(deepClone(fallback));
        return filtered;
      });
      setTemplateSuccess("Template removed.");
    } catch (error) {
      setTemplateError(extractAxiosErrorMessage(error, "Failed to delete template"));
    }
  };

  const handleAddJoin = useCallback(
    (
      leftModelId: string,
      rightModelId: string,
      options?: {
        leftField?: string;
        rightField?: string;
        joinType?: JoinCondition["joinType"];
        description?: string;
      },
    ) => {
      const leftModel = modelMap.get(leftModelId);
      const rightModel = modelMap.get(rightModelId);
      if (!leftModel || !rightModel) {
        return;
      }
      setDraft((current) => ({
        ...current,
        joins: [
          ...current.joins,
          {
            id: `join-${leftModelId}-${rightModelId}-${Date.now()}`,
            leftModel: leftModelId,
            leftField: options?.leftField ?? getDefaultKey(leftModel),
            rightModel: rightModelId,
            rightField: options?.rightField ?? getDefaultKey(rightModel),
            joinType: options?.joinType ?? "left",
            description:
              options?.description ?? `Join ${leftModel.name} to ${rightModel.name}`,
          },
        ],
      }));
    },
    [modelMap],
  );

  const handleManualJoinSubmit = useCallback(() => {
    if (
      !manualJoinDraft.leftModelId ||
      !manualJoinDraft.leftFieldId ||
      !manualJoinDraft.rightModelId ||
      !manualJoinDraft.rightFieldId
    ) {
      return;
    }

    const duplicate = draft.joins.some(
      (join) =>
        join.leftModel === manualJoinDraft.leftModelId &&
        join.rightModel === manualJoinDraft.rightModelId &&
        join.leftField === manualJoinDraft.leftFieldId &&
        join.rightField === manualJoinDraft.rightFieldId &&
        join.joinType === manualJoinDraft.joinType,
    );

    if (duplicate) {
      setTemplateError("This join already exists.");
      return;
    }

    setTemplateError(null);

    const leftModel = modelMap.get(manualJoinDraft.leftModelId);
    const rightModel = modelMap.get(manualJoinDraft.rightModelId);

    handleAddJoin(manualJoinDraft.leftModelId, manualJoinDraft.rightModelId, {
      leftField: manualJoinDraft.leftFieldId,
      rightField: manualJoinDraft.rightFieldId,
      joinType: manualJoinDraft.joinType,
      description: `${manualJoinDraft.joinType.toUpperCase()} join between ${
        leftModel?.name ?? manualJoinDraft.leftModelId
      } and ${rightModel?.name ?? manualJoinDraft.rightModelId}`,
    });

    setManualJoinDraft((current) => createManualJoinDraft(current.joinType));
  }, [draft.joins, handleAddJoin, manualJoinDraft, modelMap]);

  const handleRemoveJoin = (joinId: string) => {
    setDraft((current) => ({
      ...current,
      joins: current.joins.filter((join) => join.id !== joinId),
    }));
  };

  const handleRunAnalysis = async () => {
    setPreviewError(null);

    const { payload, error, visualError } = buildPreviewRequestPayload();
    if (!payload) {
      const previewMessage = error ?? "Unable to build preview configuration.";
      const analyticsMessage = visualError ?? previewMessage;
      setPreviewResult(null);
      setPreviewError(previewMessage);
      setVisualResult(null);
      setVisualQueryError(analyticsMessage);
      setVisualExecutedAt(null);
      setIsVisualQueryRunning(false);
      return;
    }

    try {
      const response = await runPreview(payload);
      setPreviewResult(response);
      setPreviewSql(typeof response.sql === "string" ? response.sql : null);
      setPreviewError(null);
      await runVisualAnalytics();
      setLastRunAt(formatTimestamp());
    } catch (error) {
      console.error("Failed to run report preview", error);
      const axiosError = error as AxiosError<{ message?: string }>;
      const message =
        axiosError?.response?.data?.message ?? axiosError?.message ?? "Failed to run report preview.";
      setPreviewError(message);
      setPreviewSql(null);
      setVisualQueryError("Analytics query was not executed because the preview failed.");
      setIsVisualQueryRunning(false);
      setVisualResult(null);
      setVisualExecutedAt(null);
    }
  };

  const handleRemoveDerivedField = useCallback((fieldId: string) => {
    setDraft((current) => ({
      ...current,
      derivedFields: current.derivedFields.filter((field) => field.id !== fieldId),
    }));
  }, []);

  const handleRestoreModel = useCallback(
    (modelId: string) => {
      if (!modelId) {
        return;
      }
      setDraft((current) => {
        if (current.models.includes(modelId)) {
          const reconciled = reconcileDerivedFieldStatuses(current.derivedFields, current.models);
          if (reconciled === current.derivedFields) {
            return current;
          }
          return {
            ...current,
            derivedFields: reconciled,
          };
        }
        const nextModels = [...current.models, modelId];
        return {
          ...current,
          models: nextModels,
          fields: current.fields.some((entry) => entry.modelId === modelId)
            ? current.fields
            : [...current.fields, { modelId, fieldIds: [] }],
          derivedFields: reconcileDerivedFieldStatuses(current.derivedFields, nextModels),
        };
      });
      setTemplateSuccess(`Re-added ${modelMap.get(modelId)?.name ?? modelId} to this template.`);
    },
    [modelMap, setTemplateSuccess],
  );

  const handleRecheckDerivedFields = useCallback(() => {
    setDraft((current) => {
      const reconciled = reconcileDerivedFieldStatuses(current.derivedFields, current.models);
      if (reconciled === current.derivedFields) {
        return current;
      }
      return {
        ...current,
        derivedFields: reconciled,
      };
    });
  }, []);

  const handleOpenDerivedFieldManager = useCallback(() => {
    setDerivedFieldsDrawerOpen(false);
    navigate("/reports/derived-fields");
  }, [navigate]);

  const handleCopyToken = useCallback(async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken((current) => (current === token ? null : current)), 2000);
    } catch {
      setCopiedToken(token);
    }
  }, []);

  const handleCopyExpression = useCallback(
    async (expression: string) => {
      try {
        await navigator.clipboard.writeText(expression);
        setTemplateSuccess(`Copied expression for derived field.`);
      } catch {
        setTemplateError("Failed to copy expression to clipboard.");
      }
    },
    [setTemplateError, setTemplateSuccess],
  );

  const handleExpressionDraftChange = useCallback((value: string) => {
    setDerivedFieldDraft((current) => ({
      ...current,
      expression: value,
      error: validateDerivedFieldExpression(value),
    }));
  }, []);

  const handleResetExpressionDraft = useCallback(() => {
    setDerivedFieldDraft((current) => ({
      ...current,
      expression: current.lastSaved,
      error: null,
    }));
  }, []);

  const handleApplyExpressionDraft = useCallback(() => {
    if (!selectedDerivedField || derivedFieldDraft.error) {
      return;
    }
    let parsed;
    try {
      parsed = parseDerivedFieldExpression(derivedFieldDraft.expression);
    } catch (error) {
      setDerivedFieldDraft((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Invalid expression.",
      }));
      return;
    }
    setDraft((current) => {
      const nextFields = current.derivedFields.map((field) =>
        field.id === selectedDerivedField.id
          ? {
              ...field,
              expression: derivedFieldDraft.expression,
              expressionAst: parsed.ast,
              referencedModels: parsed.referencedModels,
              referencedFields: parsed.referencedFields,
              joinDependencies:
                field.joinDependencies && field.joinDependencies.length > 0
                  ? field.joinDependencies
                  : buildModelPairs(parsed.referencedModels),
            }
          : field,
      );
      return {
        ...current,
        derivedFields: reconcileDerivedFieldStatuses(nextFields, current.models),
      };
    });
    setDerivedFieldDraft((current) => ({
      ...current,
      lastSaved: current.expression,
      error: null,
    }));
    setTemplateError(null);
    setTemplateSuccess("Expression updated. Save the template to persist changes.");
  }, [
    derivedFieldDraft.error,
    derivedFieldDraft.expression,
    selectedDerivedField,
    setTemplateError,
    setTemplateSuccess,
  ]);

  const updateFilter = (filterId: string, updater: (filter: ReportFilter) => ReportFilter) => {
    setDraft((current) => ({
      ...current,
      filters: current.filters.map((filter) => (filter.id === filterId ? updater(filter) : filter)),
    }));
  };

  const handleRemoveFilter = (filterId: string) => {
    setDraft((current) => ({
      ...current,
      filters: current.filters.filter((filter) => filter.id !== filterId),
    }));
  };

  useEffect(() => {
    handleRunAnalysisRef.current = handleRunAnalysis;
  });

  useEffect(() => {
    if (!draft.autoRunOnOpen) {
      autoRunTemplateIdRef.current = null;
      return;
    }
    if (isPreviewLoading || hasStaleDerivedFields) {
      return;
    }
    if (draft.models.length === 0) {
      return;
    }
    const hasSelectedFields = draft.fields.some((entry) => entry.fieldIds.some((fieldId) => Boolean(fieldId)));
    if (!hasSelectedFields) {
      return;
    }
    if (autoRunTemplateIdRef.current === draft.id) {
      return;
    }
    autoRunTemplateIdRef.current = draft.id;
    handleRunAnalysisRef.current();
  }, [draft.autoRunOnOpen, draft.id, draft.models, draft.fields, isPreviewLoading, hasStaleDerivedFields]);

  const createPreviewOrderRuleFromOption = (option: FilterFieldOption): PreviewOrderRule => ({
    id: `order-${Date.now()}`,
    source: option.source === "derived" ? "derived" : "model",
    modelId: option.source === "derived" ? undefined : option.modelId,
    fieldId: option.fieldId,
    direction: "desc",
  });

  const handleAddPreviewOrderRule = () => {
    const defaultOption = filterFieldOptions[0];
    if (!defaultOption) {
      return;
    }
    setDraft((current) => ({
      ...current,
      previewOrder: [...current.previewOrder, createPreviewOrderRuleFromOption(defaultOption)],
    }));
  };

  const handlePreviewOrderFieldChange = (ruleId: string, optionValue: string | null) => {
    if (!optionValue) {
      return;
    }
    const option = filterFieldOptions.find((candidate) => candidate.value === optionValue);
    if (!option) {
      return;
    }
    setDraft((current) => ({
      ...current,
      previewOrder: current.previewOrder.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              source: option.source === "derived" ? "derived" : "model",
              modelId: option.source === "derived" ? undefined : option.modelId,
              fieldId: option.fieldId,
            }
          : rule,
      ),
    }));
  };

  const handlePreviewOrderDirectionChange = (ruleId: string, direction: "asc" | "desc") => {
    setDraft((current) => ({
      ...current,
      previewOrder: current.previewOrder.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              direction,
            }
          : rule,
      ),
    }));
  };

  const handleRemovePreviewOrderRule = (ruleId: string) => {
    setDraft((current) => ({
      ...current,
      previewOrder: current.previewOrder.filter((rule) => rule.id !== ruleId),
    }));
  };

  const handleAddGroupingRule = () => {
    const defaultOption = filterFieldOptions[0];
    if (!defaultOption) {
      return;
    }
    setDraft((current) => ({
      ...current,
      previewGrouping: [
        ...current.previewGrouping,
        {
          id: generateId("group"),
          source: defaultOption.source === "derived" ? "derived" : "model",
          modelId: defaultOption.source === "derived" ? undefined : defaultOption.modelId,
          fieldId: defaultOption.fieldId,
          bucket: null,
        },
      ],
    }));
  };

  const handleGroupingFieldChange = (ruleId: string, optionValue: string | null) => {
    if (!optionValue) {
      return;
    }
    const option = filterFieldLookup.get(optionValue);
    if (!option) {
      return;
    }
    setDraft((current) => ({
      ...current,
      previewGrouping: current.previewGrouping.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              source: option.source === "derived" ? "derived" : "model",
              modelId: option.source === "derived" ? undefined : option.modelId,
              fieldId: option.fieldId,
              bucket: option.field.type === "date" ? rule.bucket ?? null : null,
            }
          : rule,
      ),
    }));
  };

  const handleGroupingBucketChange = (ruleId: string, bucket: TimeBucket | null) => {
    setDraft((current) => ({
      ...current,
      previewGrouping: current.previewGrouping.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              bucket,
            }
          : rule,
      ),
    }));
  };

  const handleRemoveGroupingRule = (ruleId: string) => {
    setDraft((current) => ({
      ...current,
      previewGrouping: current.previewGrouping.filter((rule) => rule.id !== ruleId),
    }));
  };

  const handleAddAggregationRule = () => {
    const defaultOption = numericFilterFieldOptions[0];
    if (!defaultOption) {
      return;
    }
    setDraft((current) => ({
      ...current,
      previewAggregations: [
        ...current.previewAggregations,
        {
          id: generateId("agg"),
          source: defaultOption.source === "derived" ? "derived" : "model",
          modelId: defaultOption.source === "derived" ? undefined : defaultOption.modelId,
          fieldId: defaultOption.fieldId,
          aggregation: "sum",
          alias: defaultOption.label,
        },
      ],
    }));
  };

  const handleAggregationFieldChange = (aggregationId: string, optionValue: string | null) => {
    if (!optionValue) {
      return;
    }
    const option = filterFieldLookup.get(optionValue);
    if (!option) {
      return;
    }
    setDraft((current) => ({
      ...current,
      previewAggregations: current.previewAggregations.map((aggregation) =>
        aggregation.id === aggregationId
          ? {
              ...aggregation,
              source: option.source === "derived" ? "derived" : "model",
              modelId: option.source === "derived" ? undefined : option.modelId,
              fieldId: option.fieldId,
              alias: option.label,
            }
          : aggregation,
      ),
    }));
  };

  const handleAggregationTypeChange = (
    aggregationId: string,
    aggregation: PreviewAggregationRule["aggregation"],
  ) => {
    setDraft((current) => ({
      ...current,
      previewAggregations: current.previewAggregations.map((rule) =>
        rule.id === aggregationId
          ? {
              ...rule,
              aggregation,
            }
          : rule,
      ),
    }));
  };

  const handleAggregationAliasChange = (aggregationId: string, alias: string) => {
    setDraft((current) => ({
      ...current,
      previewAggregations: current.previewAggregations.map((rule) =>
        rule.id === aggregationId
          ? {
              ...rule,
              alias,
            }
          : rule,
      ),
    }));
  };

  const handleRemoveAggregationRule = (aggregationId: string) => {
    setDraft((current) => {
      const nextAggregations = current.previewAggregations.filter((rule) => rule.id !== aggregationId);
      if (nextAggregations.length === current.previewAggregations.length) {
        return current;
      }
      const validAggregationIds = new Set(nextAggregations.map((rule) => rule.id));
      const nextHaving = current.previewHaving.filter((clause) =>
        validAggregationIds.has(clause.aggregationId),
      );
      return {
        ...current,
        previewAggregations: nextAggregations,
        previewHaving: nextHaving,
      };
    });
  };

  const handleAddHavingRule = () => {
    const defaultAggregation = draft.previewAggregations[0];
    if (!defaultAggregation) {
      return;
    }
    setDraft((current) => ({
      ...current,
      previewHaving: [
        ...current.previewHaving,
        {
          id: generateId("having"),
          aggregationId: defaultAggregation.id,
          operator: "gt",
          valueKind: "number",
          value: "",
        },
      ],
    }));
  };

  const handleHavingAggregationChange = (clauseId: string, aggregationId: string) => {
    setDraft((current) => ({
      ...current,
      previewHaving: current.previewHaving.map((clause) =>
        clause.id === clauseId
          ? {
              ...clause,
              aggregationId,
            }
          : clause,
      ),
    }));
  };

  const handleHavingOperatorChange = (
    clauseId: string,
    operator: PreviewHavingRule["operator"],
  ) => {
    setDraft((current) => ({
      ...current,
      previewHaving: current.previewHaving.map((clause) =>
        clause.id === clauseId
          ? {
              ...clause,
              operator,
            }
          : clause,
      ),
    }));
  };

  const handleHavingValueChange = (clauseId: string, value: string) => {
    setDraft((current) => ({
      ...current,
      previewHaving: current.previewHaving.map((clause) =>
        clause.id === clauseId
          ? {
              ...clause,
              value,
            }
          : clause,
      ),
    }));
  };

  const handleRemoveHavingRule = (clauseId: string) => {
    setDraft((current) => ({
      ...current,
      previewHaving: current.previewHaving.filter((clause) => clause.id !== clauseId),
    }));
  };

  const handleAddFilterRow = () => {
    const defaultOption = filterFieldOptions[0];
    if (!defaultOption) {
      return;
    }
    const operatorOptions = getOperatorOptionsForFieldType(defaultOption.field.type);
    const defaultOperator =
      operatorOptions.find((definition) => definition.value === "eq")?.value ??
      operatorOptions[0]?.value ??
      "eq";
    const operatorDefinition = FILTER_OPERATOR_LOOKUP.get(defaultOperator);
    const requiresValue = operatorDefinition?.requiresValue ?? true;
    const defaultKind = getValueKindForFieldType(defaultOption.field.type);

    const newFilter: ReportFilter = {
      id: `filter-${Date.now()}`,
      leftModelId: defaultOption.modelId,
      leftFieldId: defaultOption.fieldId,
      operator: defaultOperator,
      rightType: "value",
      valueKind: defaultKind,
      value: defaultKind === "boolean" ? "true" : "",
    };

    if (!requiresValue) {
      newFilter.value = undefined;
    }

    if (newFilter.operator === "between") {
      newFilter.value = undefined;
      newFilter.range = {};
    }

    setDraft((current) => ({
      ...current,
      filters: [...current.filters, newFilter],
    }));
  };

  const handleFilterFieldChange = (filterId: string, optionValue: string | null) => {
    if (!optionValue) {
      return;
    }
    const option = filterFieldOptions.find((candidate) => candidate.value === optionValue);
    if (!option) {
      return;
    }

    updateFilter(filterId, (filter) => {
      const operatorOptions = getOperatorOptionsForFieldType(option.field.type);
      const nextOperator =
        operatorOptions.find((definition) => definition.value === filter.operator)?.value ??
        operatorOptions[0]?.value ??
        filter.operator;
      const operatorDefinition = FILTER_OPERATOR_LOOKUP.get(nextOperator);
      const requiresValue = operatorDefinition?.requiresValue ?? true;
      const allowFieldComparison = operatorDefinition?.allowFieldComparison ?? false;
      const nextValueKind = getValueKindForFieldType(option.field.type);

      const nextFilter: ReportFilter = {
        ...filter,
        leftModelId: option.modelId,
        leftFieldId: option.fieldId,
        operator: nextOperator,
        valueKind: nextValueKind,
      };

      if (!requiresValue) {
        nextFilter.rightType = "value";
        nextFilter.rightModelId = undefined;
        nextFilter.rightFieldId = undefined;
        nextFilter.value = undefined;
        nextFilter.range = undefined;
        return nextFilter;
      }

      if (!allowFieldComparison && nextFilter.rightType === "field") {
        nextFilter.rightType = "value";
        nextFilter.rightModelId = undefined;
        nextFilter.rightFieldId = undefined;
      }

      if (nextFilter.rightType === "field") {
        const compatibleOption = filterFieldOptions.find(
          (candidate) =>
            getValueKindForFieldType(candidate.field.type) === nextValueKind &&
            (candidate.modelId !== option.modelId || candidate.fieldId !== option.fieldId),
        );
        if (compatibleOption) {
          nextFilter.rightModelId = compatibleOption.modelId;
          nextFilter.rightFieldId = compatibleOption.fieldId;
        } else {
          nextFilter.rightType = "value";
          nextFilter.rightModelId = undefined;
          nextFilter.rightFieldId = undefined;
        }
      }

      if (nextFilter.operator === "between") {
        nextFilter.rightType = "value";
        nextFilter.rightModelId = undefined;
        nextFilter.rightFieldId = undefined;
        nextFilter.value = undefined;
        nextFilter.range = nextFilter.range ?? {};
        return nextFilter;
      }

      if (nextFilter.rightType === "value") {
        nextFilter.value =
          nextValueKind === "boolean"
            ? nextFilter.value === "false"
              ? "false"
              : "true"
            : "";
        nextFilter.range = undefined;
      }

      return nextFilter;
    });
  };

  const handleFilterOperatorChange = (filterId: string, operator: FilterOperator) => {
    const definition = FILTER_OPERATOR_LOOKUP.get(operator);
    if (!definition) {
      return;
    }
    updateFilter(filterId, (filter) => {
      const nextFilter: ReportFilter = { ...filter, operator };
      const requiresValue = definition.requiresValue;
      const allowFieldComparison = definition.allowFieldComparison ?? false;

      if (!requiresValue) {
        nextFilter.rightType = "value";
        nextFilter.rightModelId = undefined;
        nextFilter.rightFieldId = undefined;
        nextFilter.value = undefined;
        nextFilter.range = undefined;
        return nextFilter;
      }

      if (!allowFieldComparison && nextFilter.rightType === "field") {
        nextFilter.rightType = "value";
        nextFilter.rightModelId = undefined;
        nextFilter.rightFieldId = undefined;
      }

      if (nextFilter.rightType === "value") {
        if (operator === "between") {
          nextFilter.value = undefined;
          nextFilter.range = nextFilter.range ?? {};
          return nextFilter;
        }
        nextFilter.value =
          nextFilter.valueKind === "boolean"
            ? nextFilter.value === "false"
              ? "false"
              : "true"
            : nextFilter.value ?? "";
        nextFilter.range = undefined;
      }

      return nextFilter;
    });
  };

  const handleFilterComparisonModeChange = (filterId: string, mode: FilterComparisonMode) => {
    updateFilter(filterId, (filter) => {
      if (filter.operator === "between") {
        return filter;
      }
      if (mode === "field") {
        const operatorDefinition = FILTER_OPERATOR_LOOKUP.get(filter.operator);
        if (!operatorDefinition?.allowFieldComparison) {
          return filter;
        }
        const leftOption = filterFieldLookup.get(
          buildFilterOptionKey(filter.leftModelId, filter.leftFieldId),
        );
        if (!leftOption) {
          return filter;
        }
        const targetKind = getValueKindForFieldType(leftOption.field.type);
        const compatibleOption = filterFieldOptions.find(
          (candidate) =>
            getValueKindForFieldType(candidate.field.type) === targetKind &&
            !(candidate.modelId === leftOption.modelId && candidate.fieldId === leftOption.fieldId),
        );
        if (!compatibleOption) {
          return filter;
        }
        return {
          ...filter,
          rightType: "field",
          rightModelId: compatibleOption.modelId,
          rightFieldId: compatibleOption.fieldId,
          value: undefined,
        };
      }

      return {
        ...filter,
        rightType: "value",
        rightModelId: undefined,
        rightFieldId: undefined,
        value:
          filter.valueKind === "boolean"
            ? filter.value === "false"
              ? "false"
              : "true"
            : filter.value ?? "",
      };
    });
  };

  const handleFilterRightFieldChange = (filterId: string, optionValue: string | null) => {
    if (!optionValue) {
      return;
    }
    const option = filterFieldOptions.find((candidate) => candidate.value === optionValue);
    if (!option) {
      return;
    }
    updateFilter(filterId, (filter) => ({
      ...filter,
      rightModelId: option.modelId,
      rightFieldId: option.fieldId,
    }));
  };

  const handleFilterValueChange = (filterId: string, rawValue: string | null) => {
    updateFilter(filterId, (filter) => {
      if (filter.operator === "between") {
        return filter;
      }
      return {
        ...filter,
        value: rawValue ?? "",
      };
    });
  };

  const handleFilterRangeChange = (
    filterId: string,
    patch: { from?: string | undefined; to?: string | undefined },
  ) => {
    updateFilter(filterId, (filter) => {
      const nextRange = { ...(filter.range ?? {}), ...patch };
      const normalizedRange = {
        from:
          typeof nextRange.from === "string" && nextRange.from.length > 0
            ? nextRange.from.trim()
            : undefined,
        to:
          typeof nextRange.to === "string" && nextRange.to.length > 0
            ? nextRange.to.trim()
            : undefined,
      };
      const hasValues =
        (normalizedRange.from && normalizedRange.from.length > 0) ||
        (normalizedRange.to && normalizedRange.to.length > 0);
      return {
        ...filter,
        range: hasValues ? normalizedRange : undefined,
      };
    });
  };

  const handleFilterDateRangeChange = (filterId: string, value: [Date | null, Date | null]) => {
    const [from, to] = value;
    handleFilterRangeChange(filterId, {
      from: formatDateForFilter(from),
      to: formatDateForFilter(to),
    });
  };

  useEffect(() => {
    setDraft((current) => {
      let changed = false;
      const nextFilters = current.filters
        .map((filter) => {
          const leftOption = filterFieldLookup.get(
            buildFilterOptionKey(filter.leftModelId, filter.leftFieldId),
          );
          if (!leftOption) {
            changed = true;
            return null;
          }

          const operatorOptions = getOperatorOptionsForFieldType(leftOption.field.type);
          let operator = filter.operator;
          if (!operatorOptions.some((definition) => definition.value === operator)) {
            operator =
              operatorOptions.find((definition) => definition.value === "eq")?.value ??
              operatorOptions[0]?.value ??
              operator;
            changed = true;
          }
          const operatorDefinition = FILTER_OPERATOR_LOOKUP.get(operator);
          const requiresValue = operatorDefinition?.requiresValue ?? true;
          const allowFieldComparison = operatorDefinition?.allowFieldComparison ?? false;
          const valueKind = getValueKindForFieldType(leftOption.field.type);

          const normalized: ReportFilter = {
            ...filter,
            leftModelId: leftOption.modelId,
            leftFieldId: leftOption.fieldId,
            operator,
            valueKind,
          };

          if (!requiresValue) {
            if (
              normalized.rightType !== "value" ||
              normalized.value !== undefined ||
              normalized.rightModelId ||
              normalized.rightFieldId
            ) {
              changed = true;
            }
            normalized.rightType = "value";
            normalized.rightModelId = undefined;
            normalized.rightFieldId = undefined;
            normalized.value = undefined;
            return normalized;
          }

          if (!allowFieldComparison && normalized.rightType === "field") {
            normalized.rightType = "value";
            normalized.rightModelId = undefined;
            normalized.rightFieldId = undefined;
            changed = true;
          }

          if (normalized.rightType === "field") {
            const rightKey =
              normalized.rightModelId && normalized.rightFieldId
                ? buildFilterOptionKey(normalized.rightModelId, normalized.rightFieldId)
                : null;
            const rightOption = rightKey ? filterFieldLookup.get(rightKey) : undefined;
            const targetKind = getValueKindForFieldType(leftOption.field.type);

            if (
              !rightOption ||
              getValueKindForFieldType(rightOption.field.type) !== targetKind
            ) {
              const replacement = filterFieldOptions.find(
                (candidate) =>
                  getValueKindForFieldType(candidate.field.type) === targetKind &&
                  !(candidate.modelId === leftOption.modelId && candidate.fieldId === leftOption.fieldId),
              );
              if (replacement) {
                normalized.rightModelId = replacement.modelId;
                normalized.rightFieldId = replacement.fieldId;
              } else {
                normalized.rightType = "value";
                normalized.rightModelId = undefined;
                normalized.rightFieldId = undefined;
              }
              changed = true;
            }
          }

          if (normalized.operator === "between") {
            normalized.rightType = "value";
            normalized.rightModelId = undefined;
            normalized.rightFieldId = undefined;
            normalized.value = undefined;
            normalized.range = normalized.range ?? {};
            return normalized;
          }

          if (normalized.rightType === "value" && normalized.valueKind === "boolean") {
            normalized.value = normalized.value === "false" ? "false" : "true";
          }
          normalized.range = undefined;

          return normalized;
        })
        .filter((filter): filter is ReportFilter => filter !== null);

      if (!changed) {
        return current;
      }
      return {
        ...current,
        filters: nextFilters,
      };
    });
  }, [filterFieldLookup, filterFieldOptions]);

  useEffect(() => {
    setDraft((current) => {
      const validKeys = new Set(filterFieldOptions.map((option) => option.value));
      const buildKey = (source: "model" | "derived", modelId: string | undefined, fieldId: string) =>
        source === "derived"
          ? buildFilterOptionKey(DERIVED_FIELD_SENTINEL, fieldId)
          : modelId
          ? buildFilterOptionKey(modelId, fieldId)
          : "";

      let changed = false;
      let nextState = current;

      if (nextState.previewOrder.length > 0) {
        const nextOrder = nextState.previewOrder.filter((rule) => {
          const key = buildKey(rule.source, rule.modelId, rule.fieldId);
          return key.length > 0 && validKeys.has(key);
        });
        if (nextOrder.length !== nextState.previewOrder.length) {
          nextState = {
            ...nextState,
            previewOrder: nextOrder,
          };
          changed = true;
        }
      }

      if (nextState.previewGrouping.length > 0) {
        const nextGrouping = nextState.previewGrouping.filter((rule) => {
          const key = buildKey(rule.source, rule.modelId, rule.fieldId);
          return key.length > 0 && validKeys.has(key);
        });
        if (nextGrouping.length !== nextState.previewGrouping.length) {
          nextState = {
            ...nextState,
            previewGrouping: nextGrouping,
          };
          changed = true;
        }
      }

      if (nextState.previewAggregations.length > 0) {
        const nextAggregations = nextState.previewAggregations.filter((rule) => {
          const key = buildKey(rule.source, rule.modelId, rule.fieldId);
          return key.length > 0 && validKeys.has(key);
        });
        if (nextAggregations.length !== nextState.previewAggregations.length) {
          nextState = {
            ...nextState,
            previewAggregations: nextAggregations,
          };
          changed = true;
        }
        const validAggregationIds = new Set(nextAggregations.map((rule) => rule.id));
        const nextHaving = nextState.previewHaving.filter((clause) =>
          validAggregationIds.has(clause.aggregationId),
        );
        if (nextHaving.length !== nextState.previewHaving.length) {
          nextState = {
            ...nextState,
            previewHaving: nextHaving,
          };
          changed = true;
        }
      }

      return changed ? nextState : current;
    });
  }, [filterFieldOptions]);



  const builderLoaded = dataModels.length > 0 && !isTemplatesLoading && !isTemplatesError;

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Box bg="#f4f6f8" p="xl" style={{ minHeight: "100vh" }}>
        <Stack gap="xl">
          <Group justify="space-between" align="flex-start">
            <div>
              <Group gap="sm">
                <Title order={2}>Enterprise report builder</Title>
                <Badge color="blue" variant="light" size="lg">
                  {builderContext}
                </Badge>
              </Group>
              <Text c="dimmed" mt={6}>
                Design reusable report templates, blend operational datasets and visualize performance in one workspace.
              </Text>
              <Group gap="xs" mt="xs">
                <Badge variant="outline" color="gray">
                  Last run {lastRunAt}
                </Badge>
                <Badge variant="outline" color="gray">
                  {selectedFieldDetails.length} fields selected
                </Badge>
              </Group>
            </div>
            <Group>
              <Button
                leftSection={<IconLayoutGrid size={16} />}
                variant="subtle"
                onClick={() => navigate("/reports/dashboards")}
              >
                Dashboards
              </Button>
              <Button
                leftSection={<IconAdjustments size={16} />}
                variant="subtle"
                onClick={() => setDerivedFieldsDrawerOpen(true)}
              >
                Derived fields
              </Button>
              <Button
                leftSection={<IconTemplate size={16} />}
                variant="light"
                onClick={handleCreateTemplate}
                loading={saveTemplateMutation.isPending}
              >
                New template
              </Button>
              <Button
                leftSection={<IconPlayerPlay size={16} />}
                variant="light"
                onClick={handleRunAnalysis}
                loading={isPreviewLoading || isVisualQueryRunning}
              >
                Run analysis
              </Button>
              <Button
                leftSection={<IconDownload size={16} />}
                variant="light"
                onClick={handleExportTemplate}
                disabled={!isTemplatePersisted || exportTemplateMutation.isPending}
                loading={exportTemplateMutation.isPending}
              >
                Export template
              </Button>
              <Button
                leftSection={<IconDeviceFloppy size={16} />}
                onClick={handleSaveTemplate}
                loading={saveTemplateMutation.isPending}
              >
                Save changes
              </Button>
            </Group>
          </Group>
          {hasStaleDerivedFields && (
            <Alert
              color="red"
              icon={<IconAlertTriangle size={16} />}
              variant="light"
              title="Derived fields need attention"
            >
              Resolve stale derived fields
              {staleDerivedFieldNames ? ` (${staleDerivedFieldNames})` : ""} before running previews or
              saving this template.
            </Alert>
          )}
          {templateError && (
            <Text c="red" mt="sm">
              {templateError}
            </Text>
          )}
          {templateSuccess && !templateError && (
            <Text c="teal" mt="sm">
              {templateSuccess}
            </Text>
          )}

          {!builderLoaded ? (
            <Paper p="lg" radius="lg" shadow="xs" withBorder>
              {isModelsLoading || isTemplatesLoading ? (
                <Text c="dimmed">Loading report builder data...</Text>
              ) : isModelsError ? (
                <Text c="red">Unable to load data models. Please verify backend connectivity.</Text>
              ) : isTemplatesError ? (
                <Text c="red">Unable to load saved templates. Please try again.</Text>
              ) : (
                <Text c="dimmed">No data models available. Try refreshing or contact your administrator.</Text>
              )}
            </Paper>
          ) : (
            <Flex gap="lg" align="flex-start">
              <Stack gap="lg" style={{ width: 320 }}>
                <Paper p="md" radius="lg" shadow="xs" withBorder>
                  <Group justify="space-between" mb="sm">
                    <Text fw={600} fz="lg">
                      Template library
                    </Text>
                    <ActionIcon
                    variant="subtle"
                    color="blue"
                    onClick={handleCreateTemplate}
                    aria-label="Add template"
                    disabled={saveTemplateMutation.isPending}
                  >
                    <IconPlus size={18} />
                  </ActionIcon>
                  </Group>
                  <Divider mb="sm" />
                  <Stack gap="xs" mb="sm">
                    <TextInput
                      placeholder="Search templates"
                      value={templateSearch}
                      onChange={(event) => setTemplateSearch(event.currentTarget.value)}
                      leftSection={<IconSearch size={14} />}
                      size="sm"
                    />
                    <Select
                      placeholder="Filter by category"
                      data={categorySelectOptions}
                      value={templateCategoryFilter}
                      onChange={(value) => setTemplateCategoryFilter(value ?? "all")}
                      size="sm"
                    />
                    {categoryOptions.length > 0 && (
                      <ScrollArea type="hover" offsetScrollbars>
                        <Group gap="xs" wrap="nowrap" pb={4}>
                          {["all", ...categoryOptions].map((category) => {
                            const value = category === "all" ? "all" : category;
                            const isActive = templateCategoryFilter === value;
                            const label = value === "all" ? "All templates" : category;
                            return (
                              <Badge
                                key={`template-category-${value}`}
                                size="xs"
                                variant={isActive ? "filled" : "outline"}
                                color={isActive ? "blue" : "gray"}
                                style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                                onClick={() => setTemplateCategoryFilter(value)}
                              >
                                {label}
                              </Badge>
                            );
                          })}
                        </Group>
                      </ScrollArea>
                    )}
                  </Stack>
                  <Group justify="space-between" align="center" mb="sm">
                    <Text fz="xs" c="dimmed">
                      Showing {filteredTemplates.length} of {templates.length} templates
                    </Text>
                    {highlightQuery && (
                      <Badge size="xs" variant="outline" color="blue">
                        Match: "{highlightQuery}"
                      </Badge>
                    )}
                  </Group>
                  {filteredTemplates.length === 0 ? (
                    <Text c="dimmed" fz="sm">
                      No templates match your filters.
                    </Text>
                  ) : (
                    <ScrollArea h={260} type="always" offsetScrollbars>
                      <Stack gap="sm">
                        {filteredTemplates.map((template) => {
                          const isActive = template.id === draft.id;
                          const fieldCount = template.fields.reduce(
                            (total, entry) => total + entry.fieldIds.length,
                            0,
                          );
                          const metricsCount = template.metricsSpotlight?.length ?? 0;
                          const description = template.description?.trim();

                          return (
                            <Card
                              key={template.id}
                              withBorder
                              padding="md"
                              radius="md"
                              shadow={isActive ? "sm" : "xs"}
                              style={{
                                borderColor: isActive ? "#1c7ed6" : undefined,
                                cursor: "pointer",
                              }}
                              onClick={() => handleSelectTemplate(template.id)}
                            >
                              <Stack gap="xs">
                                <Group justify="space-between" align="flex-start">
                                  <div>
                                    <Text fw={600}>
                                      <Highlight highlight={highlightQuery}>{template.name}</Highlight>
                                    </Text>
                                    <Group gap={6} mt={6}>
                                      {template.category && (
                                        <Badge size="xs" variant="light">
                                          {template.category}
                                        </Badge>
                                      )}
                                      <Badge size="xs" variant="light" color="gray">
                                        {template.schedule}
                                      </Badge>
                                    </Group>
                                  </div>
                                  {isActive && (
                                    <Badge color="blue" size="xs">
                                      Active
                                    </Badge>
                                  )}
                                </Group>
                                {description && (
                                  <Text size="xs" c="dimmed" lineClamp={2}>
                                    <Highlight highlight={highlightQuery}>{description}</Highlight>
                                  </Text>
                                )}
                                <Group gap={6} mt="xs">
                                  <Badge size="xs" variant="outline" color="blue">
                                    {template.models.length} models
                                  </Badge>
                                  <Badge size="xs" variant="outline" color="gray">
                                    {fieldCount} fields
                                  </Badge>
                                  <Badge size="xs" variant="outline" color="violet">
                                    {template.visuals.length} visuals
                                  </Badge>
                                  {metricsCount > 0 && (
                                    <Badge size="xs" variant="outline" color="teal">
                                      {metricsCount} spotlights
                                    </Badge>
                                  )}
                                </Group>
                                <Text size="xs" c="dimmed">
                                  <Highlight highlight={highlightQuery}>
                                    {`Updated ${template.lastUpdated} - Owner ${template.owner}`}
                                  </Highlight>
                                </Text>
                              </Stack>
                            </Card>
                          );
                        })}
                      </Stack>
                    </ScrollArea>
                  )}
                  <Divider my="sm" />
                  <Group grow>
                    <Button
                      variant="light"
                      leftSection={<IconCopy size={14} />}
                      onClick={handleDuplicateTemplate}
                      disabled={!selectedTemplate || saveTemplateMutation.isPending}
                      loading={saveTemplateMutation.isPending && Boolean(selectedTemplate)}
                    >
                      Duplicate
                    </Button>
                    <Button
                      variant="light"
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      onClick={handleDeleteTemplate}
                      disabled={!selectedTemplate || deleteTemplateMutation.isPending}
                      loading={deleteTemplateMutation.isPending && Boolean(selectedTemplate)}
                    >
                      Remove
                    </Button>
                  </Group>
                </Paper>

                <Paper p="md" radius="lg" shadow="xs" withBorder>
                  <Group justify="space-between">
                    <Text fw={600}>Data models</Text>
                    <Badge variant="light">{draft.models.length} selected</Badge>
                  </Group>
                  <Divider my="sm" />
                  <Stack gap="sm">
                    {dataModels.map((model) => {
                      const selected = draft.models.includes(model.id);
                      const associationSummary =
                        model.associations && model.associations.length > 0
                          ? model.associations
                              .map((association) =>
                                association.alias
                                  ? `${association.associationType} (${association.alias})`
                                  : `${association.associationType} - ${association.targetModelId}`
                              )
                              .slice(0, 3)
                              .join(" · ")
                          : null;
                      const description =
                        model.description ??
                        (model.tableName
                          ? `Table ${model.schema ? `${model.schema}.` : ""}${model.tableName}`
                          : "Data model");
                      return (
                        <Card key={model.id} withBorder padding="sm" radius="md">
                          <Group align="flex-start" gap="sm">
                            <ThemeIcon
                              radius="md"
                              size="lg"
                              variant={selected ? "filled" : "light"}
                              color={selected ? "blue" : "gray"}
                            >
                              <IconDatabase size={18} />
                            </ThemeIcon>
                            <Stack gap={4} style={{ flex: 1 }}>
                              <Group justify="space-between" align="flex-start">
                                <div>
                                  <Text fw={600} fz="sm">
                                    {model.name}
                                  </Text>
                                  <Text fz="xs" c="dimmed">
                                    {description}
                                  </Text>
                                </div>
                                <Checkbox
                                  aria-label={`Toggle model ${model.name}`}
                                  checked={selected}
                                  onChange={() => handleToggleModel(model.id)}
                                />
                              </Group>
                              <Group gap={6}>
                                <Badge size="xs" variant="light">
                                  {model.connection ?? DEFAULT_CONNECTION_LABEL}
                                </Badge>
                                {model.tableName && (
                                  <Badge size="xs" variant="light">
                                    {model.schema
                                      ? `${model.schema}.${model.tableName}`
                                      : model.tableName}
                                  </Badge>
                                )}
                                {model.recordCount && model.recordCount !== "N/A" && (
                                  <Badge size="xs" variant="light">
                                    {model.recordCount}
                                  </Badge>
                                )}
                                {model.lastSynced && (
                                  <Badge size="xs" variant="light">
                                    Synced {model.lastSynced}
                                  </Badge>
                                )}
                              </Group>
                              {selected && associationSummary && (
                                <Text fz="xs" c="dimmed">
                                  Joins: {associationSummary}
                                </Text>
                              )}
                            </Stack>
                          </Group>
                        </Card>
                      );
                    })}
                  </Stack>
                </Paper>
              </Stack>

              <Stack gap="lg" style={{ flex: 1 }}>
                <Paper p="md" radius="lg" shadow="xs" withBorder>
                  <Group justify="space-between" mb="md">
                    <Text fw={600}>Template details</Text>
                    <Badge variant="light">{draft.owner}</Badge>
                  </Group>
                  <Stack gap="md">
                    <TextInput
                      label="Report name"
                      value={draft.name}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, name: event.currentTarget.value }))
                      }
                      placeholder="Name your report"
                    />
                    <Textarea
                      label="Purpose"
                      minRows={2}
                      value={draft.description}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          description: event.currentTarget.value,
                        }))
                      }
                      placeholder="Summarize the business question this report answers."
                    />
                    <Flex gap="md" wrap="wrap">
                      <Select
                        label="Category"
                        data={CATEGORY_OPTIONS}
                        value={draft.category}
                        onChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            category: value ?? current.category,
                          }))
                        }
                        placeholder="Select focus area"
                        style={{ flex: 1, minWidth: 200 }}
                      />
                      <Select
                        label="Delivery cadence"
                        data={SCHEDULE_OPTIONS}
                        value={draft.schedule}
                        onChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            schedule: value ?? current.schedule,
                          }))
                        }
                        placeholder="Choose refresh schedule"
                        style={{ flex: 1, minWidth: 200 }}
                      />
                    </Flex>
                    <MultiSelect
                      label="Key metrics to highlight"
                      data={metricOptions}
                      value={draft.metrics.filter((alias) =>
                        metricOptions.some((option) => option.value === alias),
                      )}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          metrics: Array.from(new Set(value)),
                        }))
                      }
                      placeholder={metricOptions.length === 0 ? "Add numeric fields" : "Select metrics"}
                      searchable
                      disabled={metricOptions.length === 0}
                    />
                    <Switch
                      label="Auto-run preview on open"
                      description="Automatically refresh the preview when this template loads."
                      checked={draft.autoRunOnOpen}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          autoRunOnOpen: event.currentTarget.checked,
                        }))
                      }
                    />
                  </Stack>
                </Paper>

                <Paper p="md" radius="lg" shadow="xs" withBorder>
                  <Group justify="space-between" mb="md">
                    <Group gap="xs" align="center">
                      <ThemeIcon variant="light" color="grape">
                        <IconCalendarStats size={18} />
                      </ThemeIcon>
                      <Text fw={600}>Schedules & delivery</Text>
                    </Group>
                    <Badge variant="light">{scheduleList.length}</Badge>
                  </Group>
                  <Stack gap="md">
                    {!isTemplatePersisted && (
                      <Alert color="yellow" variant="light">
                        Save the template before configuring automated deliveries.
                      </Alert>
                    )}
                    {isTemplatePersisted && isSchedulesLoading && (
                      <Group gap="xs" align="center">
                        <Loader size="sm" color="blue" />
                        <Text c="dimmed" fz="sm">
                          Loading delivery schedules...
                        </Text>
                      </Group>
                    )}
                    {isTemplatePersisted && isSchedulesError && (
                      <Alert color="red" variant="light">
                        Unable to load schedules. Try saving your changes and refreshing the page.
                      </Alert>
                    )}
                    {isTemplatePersisted &&
                      !isSchedulesLoading &&
                      !isSchedulesError &&
                      scheduleList.length > 0 && (
                        <Stack gap="sm">
                          {scheduleList.map((schedule) => {
                            const isMutating = activeScheduleMutationId === schedule.id;
                            const recipientsLabel = formatDeliveryTargetsLabel(schedule.deliveryTargets);
                            const statusLabel =
                              (schedule.status ?? "active") === "paused" ? "Paused" : "Active";
                            return (
                              <Card key={schedule.id} withBorder padding="md" radius="md">
                                <Stack gap="sm">
                                  <Group justify="space-between" align="center">
                                    <Group gap="sm" align="center">
                                      <Badge size="xs" variant="light" color="violet">
                                        {schedule.cadence}
                                      </Badge>
                                      <Switch
                                        size="sm"
                                        label={statusLabel}
                                        checked={(schedule.status ?? "active") !== "paused"}
                                        onChange={() => handleToggleScheduleStatus(schedule)}
                                        disabled={isMutating || updateScheduleMutation.isPending}
                                      />
                                      {isMutating && <Loader size="xs" color="blue" />}
                                    </Group>
                                    <ActionIcon
                                      variant="subtle"
                                      color="red"
                                      onClick={() => handleDeleteSchedule(schedule.id)}
                                      aria-label="Remove schedule"
                                      disabled={isMutating || deleteScheduleMutation.isPending}
                                    >
                                      <IconTrash size={16} />
                                    </ActionIcon>
                                  </Group>
                                  <Flex gap="sm" wrap="wrap">
                                    <Select
                                      label="Cadence"
                                      data={SCHEDULE_OPTIONS}
                                      value={schedule.cadence}
                                      onChange={(value) => handleScheduleCadenceChange(schedule, value)}
                                      style={{ flex: 1, minWidth: 200 }}
                                      disabled={isMutating || updateScheduleMutation.isPending}
                                    />
                                    <TextInput
                                      key={`${schedule.id}-timezone`}
                                      label="Timezone"
                                      defaultValue={schedule.timezone}
                                      placeholder="UTC"
                                      onBlur={(event) =>
                                        handleScheduleTimezoneBlur(schedule, event.currentTarget.value)
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          event.currentTarget.blur();
                                        }
                                      }}
                                      disabled={isMutating || updateScheduleMutation.isPending}
                                      style={{ flex: 1, minWidth: 200 }}
                                    />
                                  </Flex>
                                  <TextInput
                                    key={`${schedule.id}-recipients`}
                                    label="Recipients"
                                    description="Comma-separated emails or Slack channels."
                                    defaultValue={recipientsLabel}
                                    leftSection={<IconMail size={16} />}
                                    onBlur={(event) =>
                                      handleScheduleRecipientsBlur(schedule, event.currentTarget.value)
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.currentTarget.blur();
                                      }
                                    }}
                                    disabled={isMutating || updateScheduleMutation.isPending}
                                  />
                                  <Group justify="space-between" align="center">
                                    <Text fz="xs" c="dimmed">
                                      Last run:{" "}
                                      {schedule.lastRunAt
                                        ? formatLastUpdatedLabel(schedule.lastRunAt)
                                        : "Never"}
                                    </Text>
                                    <Text fz="xs" c="dimmed">
                                      Next run:{" "}
                                      {schedule.nextRunAt
                                        ? formatLastUpdatedLabel(schedule.nextRunAt)
                                        : "Pending"}
                                    </Text>
                                  </Group>
                                </Stack>
                              </Card>
                            );
                          })}
                        </Stack>
                      )}
                    <Divider />
                    <Stack gap="sm">
                      <Group justify="space-between" align="center">
                        <Text fw={600} fz="sm">
                          Create new schedule
                        </Text>
                        <Badge size="xs" variant="light" color="blue">
                          Draft
                        </Badge>
                      </Group>
                      <Flex gap="sm" wrap="wrap">
                        <Select
                          label="Cadence"
                          data={SCHEDULE_OPTIONS}
                          value={scheduleDraft.cadence}
                          onChange={(value) =>
                            handleScheduleDraftChange({ cadence: value ?? scheduleDraft.cadence })
                          }
                          disabled={!isTemplatePersisted || createScheduleMutation.isPending}
                          style={{ flex: 1, minWidth: 180 }}
                        />
                        <Select
                          label="Status"
                          data={SCHEDULE_STATUS_OPTIONS}
                          value={scheduleDraft.status}
                          onChange={(value) =>
                            handleScheduleDraftChange({
                              status: (value ?? scheduleDraft.status) as ScheduleStatus,
                            })
                          }
                          disabled={!isTemplatePersisted || createScheduleMutation.isPending}
                          style={{ flex: 1, minWidth: 160 }}
                        />
                      </Flex>
                      <Flex gap="sm" wrap="wrap">
                        <TextInput
                          label="Timezone"
                          value={scheduleDraft.timezone}
                          onChange={(event) =>
                            handleScheduleDraftChange({ timezone: event.currentTarget.value })
                          }
                          placeholder="UTC"
                          disabled={!isTemplatePersisted || createScheduleMutation.isPending}
                          style={{ flex: 1, minWidth: 180 }}
                        />
                        <TextInput
                          label="Recipients"
                          value={scheduleDraft.recipients}
                          onChange={(event) =>
                            handleScheduleDraftChange({ recipients: event.currentTarget.value })
                          }
                          placeholder="email@example.com, #channel-name"
                          leftSection={<IconSend size={16} />}
                          disabled={!isTemplatePersisted || createScheduleMutation.isPending}
                          style={{ flex: 1, minWidth: 240 }}
                        />
                      </Flex>
                      <Group justify="flex-end">
                        <Button
                          leftSection={<IconSend size={14} />}
                          onClick={handleCreateSchedule}
                          disabled={!isTemplatePersisted || createScheduleMutation.isPending}
                          loading={createScheduleMutation.isPending}
                        >
                          Save schedule
                        </Button>
                      </Group>
                    </Stack>
                  </Stack>
                </Paper>

                <Paper p="md" radius="lg" shadow="xs" withBorder>
                  <Group justify="space-between" mb="md">
                    <Text fw={600}>Data model joins</Text>
                    <Badge variant="light">{draft.joins.length} defined</Badge>
                  </Group>
                  <Stack gap="md">
                    <Stack gap="xs">
                      <Text fw={600} fz="sm">
                        Create custom join
                      </Text>
                      {!joinModelsAvailable ? (
                        <Text c="dimmed" fz="sm">
                          Select at least two data models to configure a custom join.
                        </Text>
                      ) : (
                        <Stack gap="xs">
                          <Group align="flex-end" gap="sm" wrap="wrap">
                            <Select
                              label="Left model"
                              data={joinModelOptions}
                              placeholder="Select model"
                              value={manualJoinDraft.leftModelId || null}
                              onChange={(value) => updateManualJoinDraft({ leftModelId: value ?? "" })}
                              style={{ flex: 1, minWidth: 200 }}
                            />
                            <Select
                              label="Left field"
                              data={getFieldOptions(manualJoinDraft.leftModelId)}
                              placeholder="Select field"
                              value={manualJoinDraft.leftFieldId || null}
                              onChange={(value) => updateManualJoinDraft({ leftFieldId: value ?? "" })}
                              disabled={!manualJoinDraft.leftModelId}
                              style={{ flex: 1, minWidth: 200 }}
                            />
                          </Group>
                          <Group align="flex-end" gap="sm" wrap="wrap">
                            <Select
                              label="Right model"
                              data={joinModelOptions}
                              placeholder="Select model"
                              value={manualJoinDraft.rightModelId || null}
                              onChange={(value) => updateManualJoinDraft({ rightModelId: value ?? "" })}
                              style={{ flex: 1, minWidth: 200 }}
                            />
                            <Select
                              label="Right field"
                              data={getFieldOptions(manualJoinDraft.rightModelId)}
                              placeholder="Select field"
                              value={manualJoinDraft.rightFieldId || null}
                              onChange={(value) => updateManualJoinDraft({ rightFieldId: value ?? "" })}
                              disabled={!manualJoinDraft.rightModelId}
                              style={{ flex: 1, minWidth: 200 }}
                            />
                            <Select
                              label="Join type"
                              data={JOIN_TYPE_OPTIONS}
                              value={manualJoinDraft.joinType}
                              onChange={(value) =>
                                updateManualJoinDraft({
                                  joinType: (value ?? manualJoinDraft.joinType) as JoinCondition["joinType"],
                                })
                              }
                              style={{ width: 160 }}
                            />
                            <Button
                              leftSection={<IconPlus size={14} />}
                              onClick={handleManualJoinSubmit}
                              disabled={!canSubmitManualJoin || !joinModelsAvailable}
                            >
                              Add join
                            </Button>
                          </Group>
                        </Stack>
                      )}
                    </Stack>
                    {draft.joins.length === 0 ? (
                      <Text c="dimmed">
                        Add relationships between models to enable blended reporting.
                      </Text>
                    ) : (
                      <Stack gap="sm">
                        {draft.joins.map((join) => {
                          const leftModel = modelMap.get(join.leftModel);
                          const rightModel = modelMap.get(join.rightModel);
                          return (
                            <Card key={join.id} withBorder padding="sm" radius="md">
                              <Group justify="space-between" align="flex-start">
                                <div>
                                  <Group gap="xs">
                                    <Badge variant="light" color="blue">
                                      {join.joinType.toUpperCase()}
                                    </Badge>
                                    <Text fw={600} fz="sm">
                                      {leftModel?.name ?? join.leftModel} - {rightModel?.name ?? join.rightModel}
                                    </Text>
                                  </Group>
                                  <Text fz="xs" c="dimmed" mt={4}>
                                    {join.leftModel}.{join.leftField} = {join.rightModel}.{join.rightField}
                                  </Text>
                                  {join.description && (
                                    <Text fz="xs" mt={6}>
                                      {join.description}
                                    </Text>
                                  )}
                                </div>
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  onClick={() => handleRemoveJoin(join.id)}
                                  aria-label="Remove join"
                                >
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Group>
                            </Card>
                          );
                        })}
                      </Stack>
                    )}
                    {joinSuggestions.length > 0 && (
                      <>
                        <Divider my="md" />
                        <Text fw={600} fz="sm" mb={6}>
                          Suggested joins
                        </Text>
                        <Stack gap="xs">
                          {joinSuggestions.map((suggestion) => (
                            <Group
                              key={`${suggestion.source.id}-${suggestion.target.id}-${suggestion.leftField}`}
                              justify="space-between"
                              align="flex-start"
                            >
                              <div>
                                <Text fw={500} fz="sm">
                                  {`${suggestion.source.name} -> ${suggestion.target.name}`}
                                </Text>
                                <Text fz="xs" c="dimmed">
                                  {suggestion.relationship}
                                </Text>
                              </div>
                              <ActionIcon
                                variant="subtle"
                                color="blue"
                                onClick={() =>
                                  handleAddJoin(suggestion.source.id, suggestion.target.id, {
                                    leftField: suggestion.leftField,
                                    rightField: suggestion.rightField,
                                    description: suggestion.relationship,
                                  })
                                }
                                aria-label="Add join"
                              >
                                <IconPlus size={16} />
                              </ActionIcon>
                            </Group>
                          ))}
                        </Stack>
                      </>
                    )}
                    {joinGraph.nodes.length > 0 && (
                      <>
                        <Divider my="md" />
                        <Stack gap="sm">
                          <Group justify="space-between" align="center">
                            <Text fw={600} fz="sm">
                              Join graph overview
                            </Text>
                            <Badge
                              variant="light"
                              color={joinGraph.disconnected.length === 0 ? "teal" : "red"}
                            >
                              {joinGraph.disconnected.length === 0
                                ? "Fully connected"
                                : `${joinGraph.disconnected.length} disconnected`}
                            </Badge>
                          </Group>
                          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                            <Stack gap={6}>
                              <Text fz="xs" fw={600} c="dimmed">
                                Model coverage
                              </Text>
                              {joinGraphNodeStats.length === 0 ? (
                                <Text fz="xs" c="dimmed">No models selected.</Text>
                              ) : (
                                joinGraphNodeStats.map((node) => (
                                  <Group key={`join-node-${node.id}`} justify="space-between">
                                    <Text fz="sm">{node.label}</Text>
                                    <Badge size="xs" variant="light">
                                      {node.connections} link{node.connections === 1 ? "" : "s"}
                                    </Badge>
                                  </Group>
                                ))
                              )}
                            </Stack>
                            <Stack gap={6}>
                              <Text fz="xs" fw={600} c="dimmed">
                                Connectivity
                              </Text>
                              {joinGraphComponentSummaries.length <= 1 ? (
                                <Text fz="xs" c="dimmed">All selected models are reachable.</Text>
                              ) : (
                                joinGraphComponentSummaries.map((component) => (
                                  <Stack key={component.id} gap={2}>
                                    <Text fz="xs" fw={600}>
                                      {component.title}
                                    </Text>
                                    <Text fz="xs" c="dimmed">
                                      {component.members.join(", ")}
                                    </Text>
                                  </Stack>
                                ))
                              )}
                            </Stack>
                          </SimpleGrid>
                          {joinGraph.disconnected.length > 0 && (
                            <Alert color="red" variant="light" title="Disconnected models">
                              {joinGraph.disconnected.map((node) => node.label).join(", ")} are not connected
                              to the join graph. Add joins to include them in the analytics pipeline.
                            </Alert>
                          )}
                        </Stack>
                      </>
                    )}
                  </Stack>
                </Paper>
                <Paper p="md" radius="lg" shadow="xs" withBorder>
                  <Group justify="space-between" mb="md">
                    <Text fw={600}>Field inventory</Text>
                    <Badge variant="light">{totalFieldInventoryCount} fields</Badge>
                  </Group>
                  {selectedModels.length === 0 ? (
                    <Stack gap="md">
                      <Text c="dimmed">
                        Select at least one data model to begin adding fields to your report.
                      </Text>
                      {renderDerivedFieldInventory()}
                    </Stack>
                  ) : (
                    <Stack gap="md">
                      {selectedModels.map((model) => {
                        const selections =
                          draft.fields.find((entry) => entry.modelId === model.id)?.fieldIds ?? [];
                        return (
                          <Stack key={model.id} gap="xs">
                            <Group justify="space-between">
                              <Text fw={600} fz="sm">
                                {model.name}
                              </Text>
                              <Badge size="xs" variant="light">
                                {selections.length} selected
                              </Badge>
                            </Group>
                            <ScrollArea h={160} offsetScrollbars type="always">
                              <Table verticalSpacing="xs" highlightOnHover>
                                <Table.Thead>
                                  <Table.Tr>
                                    <Table.Th>Field</Table.Th>
                                    <Table.Th>Alias</Table.Th>
                                    <Table.Th>Type</Table.Th>
                                    <Table.Th>Column</Table.Th>
                                    <Table.Th align="right">Include</Table.Th>
                                  </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                  {model.fields.map((field) => {
                                    const checked = selections.includes(field.id);
                                    const aliasKey = toColumnAlias(model.id, field.id);
                                    const aliasValue = draft.columnAliases[aliasKey] ?? "";
                                    return (
                                      <Table.Tr key={field.id}>
                                        <Table.Td>
                                          <Text fw={500} fz="sm">
                                            {field.label}
                                          </Text>
                                          <Text fz="xs" c="dimmed">
                                            {field.id}
                                          </Text>
                                        </Table.Td>
                                        <Table.Td>
                                          <TextInput
                                            size="xs"
                                            placeholder="Custom label"
                                            value={aliasValue}
                                            disabled={!checked}
                                            onChange={(event) =>
                                              handleFieldAliasChange(model.id, field.id, event.currentTarget.value)
                                            }
                                          />
                                        </Table.Td>
                                        <Table.Td>
                                          <Badge size="xs" variant="light">
                                            {field.type}
                                          </Badge>
                                        </Table.Td>
                                        <Table.Td>
                                          <Text fz="xs" c="dimmed">
                                            {field.sourceColumn ?? "—"}
                                          </Text>
                                        </Table.Td>
                                        <Table.Td align="right">
                                          <Checkbox
                                            checked={checked}
                                            onChange={() => handleFieldToggle(model.id, field.id)}
                                          />
                                        </Table.Td>
                                      </Table.Tr>
                                    );
                                  })}
                                </Table.Tbody>
                              </Table>
                            </ScrollArea>
                          </Stack>
                        );
                      })}
                      {renderDerivedFieldInventory()}
                    </Stack>
                  )}
                </Paper>

                <Paper p="md" radius="lg" shadow="xs" withBorder>
                  <Group justify="space-between" mb="md">
                    <Group gap="xs">
                      <ThemeIcon variant="light" color="blue">
                        <IconChartHistogram size={18} />
                      </ThemeIcon>
                      <Text fw={600}>Visuals & analytics</Text>
                    </Group>
                    <Group gap="xs" align="center" wrap="wrap">
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconLayoutGrid size={14} />}
                        onClick={handleAddVisualToDashboard}
                        disabled={
                          !isTemplatePersisted || !activeVisual.metric || !activeVisual.dimension
                        }
                      >
                        Add to dashboard
                      </Button>
                      <Badge variant="light">{chartData.length} points</Badge>
                      {visualJobStatusLabel && (
                        <Badge
                          color={
                            visualJobStatus === "failed"
                              ? "red"
                              : visualJobStatus === "completed"
                              ? "green"
                              : "yellow"
                          }
                        >
                          {visualJobStatusLabel}
                        </Badge>
                      )}
                      {analyticsRunLabel && (
                        <Badge variant="outline" color="gray">
                          Updated {analyticsRunLabel}
                        </Badge>
                      )}
                    </Group>
                  </Group>
                  <Flex gap="lg" align="flex-start" wrap="wrap">
                    <Stack gap="sm" style={{ minWidth: 260, flex: "0 0 260px" }}>
                      <Select
                        label="Visualization type"
                        data={VISUAL_TYPE_OPTIONS}
                        value={activeVisual.type}
                        onChange={(value) =>
                          handleVisualChange({
                            type: VISUAL_TYPE_SET.has(value as VisualDefinition["type"])
                              ? (value as VisualDefinition["type"])
                              : "line",
                          })
                        }
                      />
                      <Select
                        label="Metric"
                        data={metricOptions}
                        value={activeVisual.metric || null}
                        onChange={(value) =>
                          handleVisualChange({ metric: value ?? "" })
                        }
                        placeholder={
                          metricOptions.length === 0 ? "Add numeric fields to your preview" : undefined
                        }
                        disabled={metricOptions.length === 0}
                        searchable
                      />
                      <Select
                        label="Aggregation"
                        data={aggregationOptions}
                        value={activeVisual.metricAggregation ?? "sum"}
                        onChange={(value) =>
                          handleVisualChange({
                            metricAggregation: (value ?? "sum") as QueryConfigMetric["aggregation"],
                          })
                        }
                        disabled={metricOptions.length === 0}
                      />
                      <Select
                        label="Dimension"
                        data={dimensionOptions}
                        value={activeVisual.dimension || null}
                        onChange={(value) =>
                          handleVisualChange({
                            dimension: value ?? "",
                          })
                        }
                        placeholder={
                          dimensionOptions.length === 0 ? "Add textual fields to your preview" : undefined
                        }
                        disabled={dimensionOptions.length === 0}
                        searchable
                      />
                      {supportsDimensionBuckets && (
                        <Select
                          label="Time bucket"
                          data={bucketOptions}
                          value={activeVisual.dimensionBucket ?? null}
                          onChange={(value) =>
                            handleVisualChange({
                              dimensionBucket: (value ?? undefined) as
                                | QueryConfigDimension["bucket"]
                                | undefined,
                            })
                          }
                          placeholder="No bucketing"
                          clearable
                        />
                      )}
                      <Select
                        label="Comparison series"
                        data={metricOptions.filter((option) => option.value !== activeVisual.metric)}
                        value={activeVisual.comparison ?? null}
                        onChange={(value) =>
                          handleVisualChange({
                            comparison: value ?? undefined,
                          })
                        }
                        placeholder="Optional secondary series"
                        disabled={metricOptions.length <= 1}
                        searchable
                        clearable
                      />
                      {activeVisual.comparison && (
                        <Select
                          label="Comparison aggregation"
                          data={aggregationOptions}
                          value={
                            activeVisual.comparisonAggregation ??
                            activeVisual.metricAggregation ??
                            "sum"
                          }
                          onChange={(value) =>
                            handleVisualChange({
                              comparisonAggregation: (value ?? undefined) as
                                | QueryConfigMetric["aggregation"]
                                | undefined,
                            })
                          }
                        />
                      )}
                      <NumberInput
                        label="Row limit"
                        value={activeVisual.limit ?? 100}
                        onChange={(value) =>
                          handleVisualChange({
                            limit:
                              typeof value === "number" && Number.isFinite(value) && value > 0
                                ? Math.round(value)
                                : null,
                          })
                        }
                        min={10}
                        max={10000}
                        step={10}
                      />
                      <Button
                        variant="light"
                        leftSection={<IconPlayerPlay size={14} />}
                        onClick={runVisualAnalytics}
                        loading={isVisualQueryRunning || isAnalyticsMutationPending}
                      >
                        Re-run analytics
                      </Button>
                      {visualWarnings.length > 0 && (
                        <Stack gap={4}>
                          {visualWarnings.map((warning, index) => (
                            <Text key={`visual-warning-${index}`} c="orange" fz="xs">
                              {warning}
                            </Text>
                          ))}
                        </Stack>
                      )}
                      {visualQueryError && (
                        <Text c="red" fz="sm">
                          {visualQueryError}
                        </Text>
                      )}
                    </Stack>
                    <Paper
                      withBorder
                      radius="lg"
                      shadow="xs"
                      style={{
                        flex: 1,
                        minHeight: 260,
                        minWidth: 320,
                        padding: 12,
                        background: "#ffffff",
                      }}
                    >
                      {isVisualQueryRunning ? (
                        <Flex align="center" justify="center" direction="column" h={240} gap="xs">
                          <Loader size="sm" color="blue" />
                          <Text c="dimmed" fz="sm">
                            Running analytics query...
                          </Text>
                        </Flex>
                      ) : hasChartData ? (
                        <ResponsiveContainer width="100%" height={240}>
                          <ComposedChart data={chartData}>
                            <CartesianGrid stroke="#f1f3f5" strokeDasharray="4 4" />
                            <XAxis dataKey="dimension" tick={{ fontSize: 12 }} />
                            <YAxis yAxisId="left" tick={{ fontSize: 12 }} stroke="#1c7ed6" />
                            {chartComparisonAlias && !isStackedVisualization && (
                              <YAxis
                                yAxisId="right"
                                orientation="right"
                                tick={{ fontSize: 12 }}
                                stroke="#2b8a3e"
                              />
                            )}
                            <RechartsTooltip
                              formatter={tooltipFormatter}
                              labelFormatter={(label) => `${dimensionLabel}: ${label}`}
                            />
                            <Legend />
                            {renderPrimarySeries()}
                            {renderComparisonSeries()}
                          </ComposedChart>
                        </ResponsiveContainer>
                      ) : (
                        <Flex align="center" justify="center" h={240}>
                          <Text c="dimmed" fz="sm" ta="center">
                            {!activeVisual.metric || !activeVisual.dimension
                              ? "Select a metric and dimension to render this visualization."
                              : visualRows.length === 0
                              ? "Run the analysis to populate this visualization."
                              : "No chartable datapoints were returned for the selected fields."}
                          </Text>
                        </Flex>
                      )}
                    </Paper>
                  </Flex>
                </Paper>

                <Paper p="md" radius="lg" shadow="xs" withBorder>
                  <Group justify="space-between" mb="md">
                    <Group gap="xs" align="center">
                      <ThemeIcon variant="light" color="teal">
                        <IconMessage2 size={18} />
                      </ThemeIcon>
                      <Text fw={600}>Metrics spotlight</Text>
                    </Group>
                    <Button
                      variant="light"
                      size="sm"
                      leftSection={<IconPlus size={14} />}
                      onClick={handleAddSpotlight}
                      disabled={metricAliasOptions.length === 0}
                    >
                      Add card
                    </Button>
                  </Group>
                  <Stack gap="sm">
                    {metricAliasOptions.length === 0 && (
                      <Text c="dimmed" fz="sm">
                        Select numeric fields in the data preview to enable spotlight cards.
                      </Text>
                    )}
                    {draft.metricsSpotlight.length === 0 ? (
                      <Text c="dimmed" fz="sm">
                        Highlight critical KPIs by adding spotlight cards. These surface alongside your
                        analytics visualization.
                      </Text>
                    ) : (
                      draft.metricsSpotlight.map((spotlight, index) => (
                        <Card
                          key={`${spotlight.metric ?? `spotlight-${index}`}-${index}`}
                          withBorder
                          radius="md"
                          padding="md"
                        >
                          <Stack gap="sm">
                            <Group justify="space-between" align="center">
                              <Text fw={600} fz="sm">
                                Spotlight {index + 1}
                              </Text>
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                aria-label="Remove spotlight"
                                onClick={() => handleRemoveSpotlight(index)}
                              >
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Group>
                            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
                              <Select
                                label="Metric"
                                data={metricAliasOptions}
                                value={spotlight.metric ?? null}
                                onChange={(value) => {
                                  if (value) {
                                    handleSpotlightChange(index, { metric: value });
                                  }
                                }}
                                searchable
                                required
                              />
                              <TextInput
                                label="Display label"
                                value={spotlight.label ?? ""}
                                onChange={(event) =>
                                  handleSpotlightChange(index, { label: event.currentTarget.value })
                                }
                                placeholder={
                                  spotlight.metric ? getColumnLabel(spotlight.metric) : "Metric label"
                                }
                              />
                              <Select
                                label="Format"
                                data={SPOTLIGHT_FORMAT_OPTIONS}
                                value={spotlight.format ?? "number"}
                                onChange={(value) =>
                                  handleSpotlightChange(index, {
                                    format: (value ?? "number") as MetricSpotlightDefinitionDto["format"],
                                  })
                                }
                              />
                            </SimpleGrid>
                            <Flex gap="sm" wrap="wrap">
                              <NumberInput
                                label="Target"
                                value={spotlight.target ?? undefined}
                                onChange={(value) =>
                                  handleSpotlightChange(index, {
                                    target:
                                      typeof value === "number" && Number.isFinite(value)
                                        ? value
                                        : undefined,
                                  })
                                }
                                allowDecimal
                                placeholder="Optional target"
                                style={{ flex: 1, minWidth: 160 }}
                              />
                              <Select
                                label="Comparison baseline"
                                data={SPOTLIGHT_COMPARISON_OPTIONS}
                                value={spotlight.comparison ?? null}
                                onChange={(value) =>
                                  handleSpotlightChange(index, {
                                    comparison: value
                                      ? (value as MetricSpotlightDefinitionDto["comparison"])
                                      : undefined,
                                  })
                                }
                                placeholder="None"
                                clearable
                                style={{ flex: 1, minWidth: 200 }}
                              />
                            </Flex>
                            <Group justify="flex-end">
                              <Button
                                size="xs"
                                variant="subtle"
                                leftSection={<IconLayoutGrid size={14} />}
                                onClick={() => handleAddSpotlightToDashboard(index)}
                                disabled={!isTemplatePersisted || !spotlight.metric}
                              >
                                Add to dashboard
                              </Button>
                            </Group>
                          </Stack>
                        </Card>
                      ))
                    )}
                  </Stack>
                </Paper>

                <Paper p="md" radius="lg" shadow="xs" withBorder>
                  <Stack gap="md">
                    <Group justify="space-between" align="center">
                      <Group gap="xs" align="center">
                        <ThemeIcon variant="light" color="gray">
                          <IconAdjustments size={16} />
                        </ThemeIcon>
                        <Text fw={600}>Query inspector</Text>
                      </Group>
                      <Badge variant="light">Diagnostics</Badge>
                    </Group>
                    <Stack gap="xs">
                      <Text fw={500} fz="sm">
                        Preview query
                      </Text>
                      <Textarea
                        value={
                          previewSql ?? "Run data preview to capture the SQL backing the table."
                        }
                        readOnly
                        autosize
                        minRows={3}
                        styles={{ input: { fontFamily: "monospace" } }}
                      />
                    </Stack>
                    <Stack gap="xs">
                      <Text fw={500} fz="sm">
                        Visuals & analytics query
                      </Text>
                      <Textarea
                        value={
                          visualSql ?? "Run analytics to capture the SQL powering the chart."
                        }
                        readOnly
                        autosize
                        minRows={3}
                        styles={{ input: { fontFamily: "monospace" } }}
                      />
                    </Stack>
                  </Stack>
                </Paper>

                <Paper p="md" radius="lg" shadow="xs" withBorder>
                  <Group justify="space-between" mb="md">
                    <Group gap="xs">
                      <ThemeIcon variant="light" color="indigo">
                        <IconAdjustments size={18} />
                      </ThemeIcon>
                      <Text fw={600}>Filters & distribution</Text>
                    </Group>
                  </Group>
                  <Stack gap="sm">
                    {draft.filters.length === 0 ? (
                      filterFieldOptions.length === 0 ? (
                        <Text c="dimmed" fz="sm">
                          Select at least one data model to start defining filter conditions.
                        </Text>
                      ) : (
                        <Text c="dimmed" fz="sm">
                          No filters applied. Add a condition to focus your preview.
                        </Text>
                      )
                    ) : (
                      draft.filters.map((filter) => {
                        const leftKey = buildFilterOptionKey(filter.leftModelId, filter.leftFieldId);
                        const leftOption = filterFieldLookup.get(leftKey);

                        if (!leftOption) {
                          return (
                            <Paper key={filter.id} withBorder radius="md" p="sm">
                              <Group justify="space-between" align="center">
                                <Text c="red" fz="sm">
                                  Filter references a field that is no longer available.
                                </Text>
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  onClick={() => handleRemoveFilter(filter.id)}
                                  aria-label="Remove filter"
                                >
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Group>
                            </Paper>
                          );
                        }

                        const operatorOptions = getOperatorOptionsForFieldType(leftOption.field.type);
                        const operatorDefinition =
                          operatorOptions.find((definition) => definition.value === filter.operator) ??
                          FILTER_OPERATOR_LOOKUP.get(filter.operator);
                        const operatorSelectData = operatorOptions.map((definition) => ({
                          value: definition.value,
                          label: definition.label,
                        }));
                        const requiresValue = operatorDefinition?.requiresValue ?? true;
                        const allowFieldComparison = operatorDefinition?.allowFieldComparison ?? false;
                        const comparisonModeOptions =
                          allowFieldComparison && requiresValue
                            ? [
                                { label: "Value", value: "value" },
                                { label: "Field", value: "field" },
                              ]
                            : [{ label: "Value", value: "value" }];
                        const targetKind = getValueKindForFieldType(leftOption.field.type);
                        const comparableFieldOptions = filterFieldOptions
                          .filter(
                            (option) =>
                              getValueKindForFieldType(option.field.type) === targetKind &&
                              !(option.modelId === leftOption.modelId && option.fieldId === leftOption.fieldId),
                          )
                          .map((option) => ({
                            value: option.value,
                            label: option.label,
                          }));
                        const comparisonMode =
                          filter.rightType === "field" && comparableFieldOptions.length === 0
                            ? "value"
                            : filter.rightType;
                        const rightFieldValue =
                          filter.rightModelId && filter.rightFieldId
                            ? buildFilterOptionKey(filter.rightModelId, filter.rightFieldId)
                            : null;

                        let valueControl: JSX.Element | null = null;
                        if (filter.operator === "between") {
                          if (filter.valueKind === "date") {
                            const dateRange: [Date | null, Date | null] = [
                              parseDateForFilter(filter.range?.from),
                              parseDateForFilter(filter.range?.to),
                            ];
                            valueControl = (
                              <DatePickerInput
                                label="Between"
                                type="range"
                                allowSingleDateInRange
                                value={dateRange}
                                onChange={(value) =>
                                  handleFilterDateRangeChange(
                                    filter.id,
                                    value as [Date | null, Date | null],
                                  )
                                }
                                valueFormat="MMM DD, YYYY"
                              />
                            );
                          } else if (filter.valueKind === "number") {
                            const fromNumeric =
                              filter.range?.from && filter.range.from.length > 0
                                ? Number(filter.range.from)
                                : undefined;
                            const toNumeric =
                              filter.range?.to && filter.range.to.length > 0
                                ? Number(filter.range.to)
                                : undefined;
                            valueControl = (
                              <Group align="flex-end" gap="sm" wrap="wrap">
                                <NumberInput
                                  label="From"
                                  value={
                                    typeof fromNumeric === "number" && Number.isFinite(fromNumeric)
                                      ? fromNumeric
                                      : undefined
                                  }
                                  onChange={(value) =>
                                    handleFilterRangeChange(filter.id, {
                                      from:
                                        value === null || value === ""
                                          ? undefined
                                          : String(value),
                                    })
                                  }
                                  allowDecimal
                                  w={140}
                                />
                                <NumberInput
                                  label="To"
                                  value={
                                    typeof toNumeric === "number" && Number.isFinite(toNumeric)
                                      ? toNumeric
                                      : undefined
                                  }
                                  onChange={(value) =>
                                    handleFilterRangeChange(filter.id, {
                                      to:
                                        value === null || value === ""
                                          ? undefined
                                          : String(value),
                                    })
                                  }
                                  allowDecimal
                                  w={140}
                                />
                              </Group>
                            );
                          } else {
                            valueControl = (
                              <Group align="flex-end" gap="sm" wrap="wrap">
                                <TextInput
                                  label="From"
                                  value={filter.range?.from ?? ""}
                                  onChange={(event) =>
                                    handleFilterRangeChange(filter.id, {
                                      from: event.currentTarget.value,
                                    })
                                  }
                                  w={200}
                                />
                                <TextInput
                                  label="To"
                                  value={filter.range?.to ?? ""}
                                  onChange={(event) =>
                                    handleFilterRangeChange(filter.id, {
                                      to: event.currentTarget.value,
                                    })
                                  }
                                  w={200}
                                />
                              </Group>
                            );
                          }
                        } else if (requiresValue) {
                          if (comparisonMode === "field" && comparableFieldOptions.length > 0) {
                            valueControl = (
                              <Select
                                label="Compare to"
                                data={comparableFieldOptions}
                                value={rightFieldValue}
                                onChange={(value) => handleFilterRightFieldChange(filter.id, value)}
                                w={260}
                              />
                            );
                          } else if (comparisonMode === "value") {
                            if (filter.valueKind === "boolean") {
                              valueControl = (
                                <Select
                                  label="Value"
                                  data={[
                                    { value: "true", label: "True" },
                                    { value: "false", label: "False" },
                                  ]}
                                  value={filter.value ?? "true"}
                                  onChange={(value) =>
                                    handleFilterValueChange(filter.id, value ?? "true")
                                  }
                                  w={140}
                                />
                              );
                            } else if (filter.valueKind === "number") {
                              const parsedValue =
                                filter.value !== undefined && filter.value !== ""
                                  ? Number(filter.value)
                                  : undefined;
                              valueControl = (
                                <NumberInput
                                  label="Value"
                                  value={
                                    parsedValue !== undefined && Number.isFinite(parsedValue)
                                      ? parsedValue
                                      : undefined
                                  }
                                  onChange={(value) =>
                                    handleFilterValueChange(
                                      filter.id,
                                      value === "" || value === null ? "" : String(value),
                                    )
                                  }
                                  allowDecimal
                                  w={180}
                                />
                              );
                            } else {
                              valueControl = (
                                <TextInput
                                  label="Value"
                                  placeholder={
                                    filter.valueKind === "date" ? "YYYY-MM-DD" : "Enter value"
                                  }
                                  value={filter.value ?? ""}
                                  onChange={(event) =>
                                    handleFilterValueChange(filter.id, event.currentTarget.value)
                                  }
                                  w={240}
                                />
                              );
                            }
                          }
                        }

                        return (
                          <Paper key={filter.id} withBorder radius="md" p="sm">
                            <Stack gap="xs">
                              <Group align="flex-end" gap="sm" wrap="wrap">
                                <Select
                                  label="Field"
                                  data={filterFieldOptions.map((option) => ({
                                    value: option.value,
                                    label: option.label,
                                  }))}
                                  value={leftOption.value}
                                  onChange={(value) => handleFilterFieldChange(filter.id, value)}
                                  w={260}
                                />
                                <Select
                                  label="Operator"
                                  data={operatorSelectData}
                                  value={filter.operator}
                                  onChange={(value) =>
                                    handleFilterOperatorChange(
                                      filter.id,
                                      (value ?? filter.operator) as FilterOperator,
                                    )
                                  }
                                  w={200}
                                />
                                {requiresValue && allowFieldComparison && (
                                  <Stack gap={4} style={{ width: 160 }}>
                                    <Text fz="xs" fw={500}>
                                      Compare with
                                    </Text>
                                    <SegmentedControl
                                      value={comparisonMode}
                                      onChange={(value) =>
                                        handleFilterComparisonModeChange(
                                          filter.id,
                                          value as FilterComparisonMode,
                                        )
                                      }
                                      data={comparisonModeOptions}
                                      disabled={comparableFieldOptions.length === 0}
                                    />
                                  </Stack>
                                )}
                                {valueControl}
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  onClick={() => handleRemoveFilter(filter.id)}
                                  aria-label="Remove filter"
                                >
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Group>
                              {filter.operator === "contains" ||
                              filter.operator === "starts_with" ||
                              filter.operator === "ends_with" ? (
                                <Text fz="xs" c="dimmed">
                                  Text comparisons use case-insensitive matching.
                                </Text>
                              ) : null}
                            </Stack>
                          </Paper>
                        );
                      })
                    )}
                    <Button
                      variant="light"
                      leftSection={<IconPlus size={16} />}
                      onClick={handleAddFilterRow}
                      disabled={filterFieldOptions.length === 0}
                    >
                      Add condition
                    </Button>
                    <Divider my="sm" />
                    <Stack gap="xs">
                      <Group justify="space-between" align="center">
                        <Text fw={600} fz="sm">
                          Grouping
                        </Text>
                        <Button
                          variant="subtle"
                          size="xs"
                          leftSection={<IconPlus size={12} />}
                          onClick={handleAddGroupingRule}
                          disabled={filterFieldOptions.length === 0}
                        >
                          Add group field
                        </Button>
                      </Group>
                      {draft.previewGrouping.length === 0 ? (
                        <Text c="dimmed" fz="sm">
                          {filterFieldOptions.length === 0
                            ? "Select data models to enable grouping."
                            : "No grouping applied. Add a field to aggregate rows."}
                        </Text>
                      ) : (
                        draft.previewGrouping.map((group) => {
                          const optionKey =
                            group.source === "derived"
                              ? buildFilterOptionKey(DERIVED_FIELD_SENTINEL, group.fieldId)
                              : group.modelId
                              ? buildFilterOptionKey(group.modelId, group.fieldId)
                              : "";
                          const option = optionKey ? filterFieldLookup.get(optionKey) : undefined;
                          const supportsBucket = option?.field.type === "date";
                          return (
                            <Paper key={group.id} withBorder radius="md" p="sm">
                              <Stack gap="xs">
                                <Group align="flex-end" gap="sm" wrap="wrap">
                                  <Select
                                    label="Field"
                                    data={filterFieldOptions.map((candidate) => ({
                                      value: candidate.value,
                                      label: candidate.label,
                                    }))}
                                    value={option ? optionKey : null}
                                    onChange={(value) => handleGroupingFieldChange(group.id, value)}
                                    searchable
                                    placeholder="Select field"
                                    style={{ flex: 1, minWidth: 220 }}
                                  />
                                  {supportsBucket && (
                                    <Select
                                      label="Bucket"
                                      data={bucketOptions}
                                      value={group.bucket ?? null}
                                      onChange={(value) =>
                                        handleGroupingBucketChange(
                                          group.id,
                                          (value as TimeBucket | null | undefined) ?? null,
                                        )
                                      }
                                      placeholder="No bucketing"
                                      clearable
                                      style={{ width: 180 }}
                                    />
                                  )}
                                  <ActionIcon
                                    variant="subtle"
                                    color="red"
                                    onClick={() => handleRemoveGroupingRule(group.id)}
                                    aria-label="Remove grouping"
                                  >
                                    <IconTrash size={16} />
                                  </ActionIcon>
                                </Group>
                              </Stack>
                            </Paper>
                          );
                        })
                      )}
                    </Stack>
                    <Divider my="sm" />
                    <Stack gap="xs">
                      <Group justify="space-between" align="center">
                        <Text fw={600} fz="sm">
                          Aggregations
                        </Text>
                        <Button
                          variant="subtle"
                          size="xs"
                          leftSection={<IconPlus size={12} />}
                          onClick={handleAddAggregationRule}
                          disabled={numericFilterFieldOptions.length === 0}
                        >
                          Add aggregation
                        </Button>
                      </Group>
                      {draft.previewAggregations.length === 0 ? (
                        <Text c="dimmed" fz="sm">
                          {numericFilterFieldOptions.length === 0
                            ? "Select numeric fields in the preview to enable aggregations."
                            : "No aggregated metrics defined."}
                        </Text>
                      ) : (
                        draft.previewAggregations.map((aggregation) => {
                          const optionKey =
                            aggregation.source === "derived"
                              ? buildFilterOptionKey(DERIVED_FIELD_SENTINEL, aggregation.fieldId)
                              : aggregation.modelId
                              ? buildFilterOptionKey(aggregation.modelId, aggregation.fieldId)
                              : "";
                          const option = optionKey ? filterFieldLookup.get(optionKey) : undefined;
                          return (
                            <Paper key={aggregation.id} withBorder radius="md" p="sm">
                              <Stack gap="xs">
                                <Group align="flex-end" gap="sm" wrap="wrap">
                                  <Select
                                    label="Field"
                                    data={numericFilterFieldOptions.map((candidate) => ({
                                      value: candidate.value,
                                      label: candidate.label,
                                    }))}
                                    value={option ? optionKey : null}
                                    onChange={(value) =>
                                      handleAggregationFieldChange(aggregation.id, value)
                                    }
                                    searchable
                                    placeholder="Select field"
                                    style={{ flex: 1, minWidth: 220 }}
                                  />
                                  <Select
                                    label="Aggregation"
                                    data={METRIC_AGGREGATIONS.map((value) => ({
                                      value,
                                      label: AGGREGATION_LABELS[value],
                                    }))}
                                    value={aggregation.aggregation}
                                    onChange={(value) =>
                                      handleAggregationTypeChange(
                                        aggregation.id,
                                        (value as PreviewAggregationRule["aggregation"]) ?? "sum",
                                      )
                                    }
                                    style={{ width: 180 }}
                                  />
                                  <TextInput
                                    label="Alias"
                                    value={aggregation.alias ?? ""}
                                    onChange={(event) =>
                                      handleAggregationAliasChange(
                                        aggregation.id,
                                        event.currentTarget.value,
                                      )
                                    }
                                    placeholder="Optional label"
                                    style={{ flex: 1, minWidth: 160 }}
                                  />
                                  <ActionIcon
                                    variant="subtle"
                                    color="red"
                                    onClick={() => handleRemoveAggregationRule(aggregation.id)}
                                    aria-label="Remove aggregation"
                                  >
                                    <IconTrash size={16} />
                                  </ActionIcon>
                                </Group>
                              </Stack>
                            </Paper>
                          );
                        })
                      )}
                    </Stack>
                    <Divider my="sm" />
                    <Stack gap="xs">
                      <Group justify="space-between" align="center">
                        <Text fw={600} fz="sm">
                          Group filters (HAVING)
                        </Text>
                        <Button
                          variant="subtle"
                          size="xs"
                          leftSection={<IconPlus size={12} />}
                          onClick={handleAddHavingRule}
                          disabled={draft.previewAggregations.length === 0}
                        >
                          Add group filter
                        </Button>
                      </Group>
                      {draft.previewHaving.length === 0 ? (
                        <Text c="dimmed" fz="sm">
                          {draft.previewAggregations.length === 0
                            ? "Add an aggregation to enable HAVING filters."
                            : "No HAVING filters applied."}
                        </Text>
                      ) : (
                        draft.previewHaving.map((clause) => {
                          const aggregationOptions = draft.previewAggregations.map((aggregation) => {
                            const optionKey =
                              aggregation.source === "derived"
                                ? buildFilterOptionKey(DERIVED_FIELD_SENTINEL, aggregation.fieldId)
                                : aggregation.modelId
                                ? buildFilterOptionKey(aggregation.modelId, aggregation.fieldId)
                                : "";
                            const option = optionKey ? filterFieldLookup.get(optionKey) : undefined;
                            const baseLabel = option?.label ?? aggregation.fieldId;
                            const label = aggregation.alias && aggregation.alias.trim().length > 0
                              ? `${aggregation.alias} (${AGGREGATION_LABELS[aggregation.aggregation]})`
                              : `${baseLabel} (${AGGREGATION_LABELS[aggregation.aggregation]})`;
                            return {
                              value: aggregation.id,
                              label,
                            };
                          });
                          const numericValue =
                            clause.value !== undefined && clause.value !== ""
                              ? Number(clause.value)
                              : undefined;
                          return (
                            <Paper key={clause.id} withBorder radius="md" p="sm">
                              <Stack gap="xs">
                                <Group align="flex-end" gap="sm" wrap="wrap">
                                  <Select
                                    label="Aggregation"
                                    data={aggregationOptions}
                                    value={clause.aggregationId}
                                    onChange={(value) =>
                                      value && handleHavingAggregationChange(clause.id, value)
                                    }
                                    placeholder="Select aggregation"
                                    style={{ flex: 1, minWidth: 220 }}
                                  />
                                  <Select
                                    label="Operator"
                                    data={HAVING_OPERATOR_OPTIONS}
                                    value={clause.operator}
                                    onChange={(value) =>
                                      handleHavingOperatorChange(
                                        clause.id,
                                        (value as PreviewHavingRule["operator"]) ?? "gt",
                                      )
                                    }
                                    style={{ width: 140 }}
                                  />
                                  <NumberInput
                                    label="Value"
                                    value={
                                      typeof numericValue === "number" && Number.isFinite(numericValue)
                                        ? numericValue
                                        : undefined
                                    }
                                    onChange={(value) =>
                                      handleHavingValueChange(
                                        clause.id,
                                        value === null || value === undefined
                                          ? ""
                                          : String(value),
                                      )
                                    }
                                    allowDecimal
                                    w={160}
                                  />
                                  <ActionIcon
                                    variant="subtle"
                                    color="red"
                                    onClick={() => handleRemoveHavingRule(clause.id)}
                                    aria-label="Remove group filter"
                                  >
                                    <IconTrash size={16} />
                                  </ActionIcon>
                                </Group>
                              </Stack>
                            </Paper>
                          );
                        })
                      )}
                    </Stack>
                    <Divider my="sm" />
                    <Stack gap="xs">
                      <Group justify="space-between" align="center">
                        <Text fw={600} fz="sm">
                          Preview order
                        </Text>
                        <Button
                          variant="subtle"
                          size="xs"
                          leftSection={<IconPlus size={12} />}
                          onClick={handleAddPreviewOrderRule}
                          disabled={filterFieldOptions.length === 0}
                        >
                          Add sort rule
                        </Button>
                      </Group>
                      {draft.previewOrder.length === 0 ? (
                        <Text c="dimmed" fz="sm">
                          No ordering applied. Rows will follow the default database ordering.
                        </Text>
                      ) : (
                        draft.previewOrder.map((rule) => {
                          const optionKey =
                            rule.source === "derived"
                              ? buildFilterOptionKey(DERIVED_FIELD_SENTINEL, rule.fieldId)
                              : rule.modelId
                              ? buildFilterOptionKey(rule.modelId, rule.fieldId)
                              : "";
                          const optionMissing = !optionKey || !filterFieldLookup.has(optionKey);
                          return (
                            <Paper key={rule.id} withBorder radius="md" p="sm">
                              <Stack gap="xs">
                                <Group align="flex-end" gap="sm" wrap="wrap">
                                  <Select
                                    label="Field"
                                    data={filterFieldOptions.map((option) => ({
                                      value: option.value,
                                      label: option.label,
                                    }))}
                                    value={optionMissing ? null : optionKey}
                                    onChange={(value) => handlePreviewOrderFieldChange(rule.id, value)}
                                    placeholder="Select field"
                                    searchable
                                    style={{ flex: 1, minWidth: 220 }}
                                  />
                                  <SegmentedControl
                                    value={rule.direction}
                                    onChange={(value) =>
                                      handlePreviewOrderDirectionChange(
                                        rule.id,
                                        (value as "asc" | "desc") ?? "asc",
                                      )
                                    }
                                    data={[
                                      { value: "asc", label: "Asc" },
                                      { value: "desc", label: "Desc" },
                                    ]}
                                  />
                                  <ActionIcon
                                    variant="subtle"
                                    color="red"
                                    onClick={() => handleRemovePreviewOrderRule(rule.id)}
                                    aria-label="Remove sort rule"
                                  >
                                    <IconTrash size={16} />
                                  </ActionIcon>
                                </Group>
                                {optionMissing && (
                                  <Text fz="xs" c="red">
                                    Field is no longer available. Select another column to keep this rule.
                                  </Text>
                                )}
                              </Stack>
                            </Paper>
                          );
                        })
                      )}
                    </Stack>
                    <Divider my="sm" />
                    <Checkbox
                      label="Auto-publish PDF package to leadership workspace"
                      checked={draft.autoDistribution}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          autoDistribution: event.currentTarget.checked,
                        }))
                      }
                    />
                    <Checkbox
                      label="Send digest to #revenue-ops Slack channel on refresh"
                      checked={draft.notifyTeam}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          notifyTeam: event.currentTarget.checked,
                        }))
                      }
                    />
                  </Stack>
                </Paper>

                <Paper p="md" radius="lg" shadow="xs" withBorder>
                  <Group justify="space-between" mb="md" align="center">
                    <Group gap="xs" align="center">
                      <Group gap="xs" align="center">
                        <Text fw={600}>Data preview</Text>
                        <Badge variant="light">{previewRows.length} rows</Badge>
                      </Group>
                      <Button
                        variant="subtle"
                        size="xs"
                        leftSection={<IconLayoutGrid size={14} />}
                        onClick={handleAddPreviewToDashboard}
                        disabled={previewColumns.length === 0}
                      >
                        Add to dashboard
                      </Button>
                    </Group>
                    <Text fz="xs" c="dimmed">
                      {lastRunAt === "Not run yet" ? "Preview not run yet" : `Last run: ${lastRunAt}`}
                    </Text>
                  </Group>
                  {previewError && (
                    <Box mb="sm">
                      <Text fz="sm" c="red">
                        {previewError}
                      </Text>
                    </Box>
                  )}
                  {isPreviewLoading ? (
                    <Text c="dimmed" fz="sm">
                      Running preview&hellip;
                    </Text>
                  ) : previewRows.length === 0 || previewColumns.length === 0 ? (
                    <Text c="dimmed" fz="sm">
                      Configure your models, fields, and filters, then run the analysis to see sample rows.
                    </Text>
                  ) : (
                    <ScrollArea>
                      <Table
                        highlightOnHover
                        striped
                        verticalSpacing="xs"
                        style={{ fontSize: "0.85rem" }}
                      >
                        <Table.Thead>
                          <Table.Tr>
                            {previewColumns.map((column, columnIndex) => {
                              const metadata = previewColumnMetadata.get(column);
                              const tableDescriptor =
                                metadata?.modelName ?? metadata?.tableName ?? metadata?.modelId;
                              const technicalDescriptor =
                                metadata?.modelId && metadata?.fieldId
                                  ? `${metadata.modelId}.${metadata.fieldId}`
                                  : metadata?.fieldId ?? metadata?.sourceColumn;
                              const baseLabel = metadata?.fieldLabel ?? humanizeAlias(column);
                              const customLabel =
                                metadata?.customLabel && metadata.customLabel.length > 0
                                  ? metadata.customLabel
                                  : undefined;
                              const displayLabel = customLabel ?? baseLabel;
                              const secondarySegments: string[] = [];
                              if (customLabel && customLabel !== baseLabel) {
                                secondarySegments.push(baseLabel);
                              }
                              if (tableDescriptor) {
                                secondarySegments.push(tableDescriptor);
                              }
                              if (technicalDescriptor) {
                                secondarySegments.push(technicalDescriptor);
                              }
                              const subtitle = secondarySegments.join(" / ");
                              const isFirst = columnIndex === 0;
                              const isLast = columnIndex === previewColumns.length - 1;
                              const showReorder = previewColumns.length > 1;
                              return (
                                <Table.Th key={column}>
                                  <Group gap="xs" justify="space-between" align="flex-start">
                                    <Box>
                                      <Text fw={600} fz="sm">
                                        {displayLabel}
                                      </Text>
                                      {subtitle && (
                                        <Text fz="xs" c="dimmed">
                                          {subtitle}
                                        </Text>
                                      )}
                                    </Box>
                                    {showReorder && (
                                      <Group gap={4}>
                                        <ActionIcon
                                          size="sm"
                                          variant="subtle"
                                          aria-label={`Move ${displayLabel} left`}
                                          onClick={() => movePreviewColumn(column, "left")}
                                          disabled={isFirst}
                                        >
                                          <IconArrowLeft size={14} />
                                        </ActionIcon>
                                        <ActionIcon
                                          size="sm"
                                          variant="subtle"
                                          aria-label={`Move ${displayLabel} right`}
                                          onClick={() => movePreviewColumn(column, "right")}
                                          disabled={isLast}
                                        >
                                          <IconArrowRight size={14} />
                                        </ActionIcon>
                                      </Group>
                                    )}
                                  </Group>
                                </Table.Th>
                              );
                            })}
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {previewRows.map((row, rowIndex) => {
                            const rowData = row as Record<string, unknown>;
                            return (
                              <Table.Tr key={`preview-row-${rowIndex}`}>
                                {previewColumns.map((column) => (
                                  <Table.Td key={`${rowIndex}-${column}`}>
                                    {formatPreviewValue(rowData[column])}
                                  </Table.Td>
                                ))}
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                  )}
                </Paper>

                <Paper p="md" radius="lg" shadow="xs" withBorder>
                  <Group justify="space-between" mb="md">
                    <Text fw={600}>Metrics spotlight</Text>
                    <Badge variant="light">{metricsSummary.length} cards</Badge>
                  </Group>
                  <Flex gap="md" wrap="wrap">
                    {metricsSummary.map((summary) => (
                      <Card
                        key={summary.id}
                        withBorder
                        padding="md"
                        radius="md"
                        style={{ flex: "1 1 220px" }}
                      >
                        <Stack gap={4}>
                          <Group justify="space-between">
                            <Text fw={600}>{summary.label}</Text>
                            <Badge
                              variant="light"
                              color={
                                summary.tone === "negative"
                                  ? "red"
                                  : summary.tone === "positive"
                                  ? "teal"
                                  : "gray"
                              }
                            >
                              {summary.delta}
                            </Badge>
                          </Group>
                          <Text fz="xl" fw={700}>
                            {summary.value}
                          </Text>
                          <Text fz="xs" c="dimmed">
                            {summary.context}
                          </Text>
                        </Stack>
                      </Card>
                    ))}
                  </Flex>
                </Paper>

              </Stack>
            </Flex>
          )}
        </Stack>
      </Box>

      <Drawer
        opened={isDerivedFieldsDrawerOpen}
        onClose={() => setDerivedFieldsDrawerOpen(false)}
        position="right"
        size="lg"
        title="Derived fields workspace"
        overlayProps={{ opacity: 0.2, blur: 2 }}
        withinPortal={false}
      >
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text fw={600}>Cross-model expressions</Text>
              <Text fz="sm" c="dimmed">
                Monitor how derived fields interact with the models selected in this template.
              </Text>
            </div>
            <Group gap="xs">
              <Button
                variant="light"
                size="xs"
                leftSection={<IconRefresh size={14} />}
                onClick={handleRecheckDerivedFields}
              >
                Re-check joins
              </Button>
              <Button
                variant="subtle"
                size="xs"
                leftSection={<IconAdjustments size={14} />}
                onClick={handleOpenDerivedFieldManager}
              >
                Full manager
              </Button>
            </Group>
          </Group>
          <Divider />
          {draft.derivedFields.length === 0 ? (
            <Alert color="gray" variant="light">
              No derived fields added yet. Use the full manager to create reusable expressions, or add
              them to templates as they become available.
            </Alert>
          ) : (
            <Flex gap="lg" align="flex-start" wrap="wrap">
              <Stack gap="sm" style={{ flex: "1 1 280px" }}>
                {draft.derivedFields.map((field) => {
                const missingModels = getEffectiveReferencedModels(field).filter(
                  (modelId) => !draft.models.includes(modelId),
                );
                  const isSelected = selectedDerivedField?.id === field.id;
                  return (
                    <Card
                      key={field.id}
                      withBorder
                      shadow={isSelected ? "md" : "xs"}
                      radius="md"
                      onClick={() => setSelectedDerivedFieldId(field.id)}
                      role="button"
                      aria-pressed={isSelected}
                      tabIndex={0}
                      style={{
                        borderColor: isSelected ? "#228be6" : undefined,
                        cursor: "pointer",
                      }}
                    >
                      <Stack gap="sm">
                        <Group justify="space-between" align="flex-start">
                          <div>
                            <Text fw={600}>{field.name}</Text>
                            <Group gap="xs" mt={4}>
                              <Badge variant="light">
                                {field.scope === "workspace" ? "Workspace scope" : "Template scope"}
                              </Badge>
                              {field.status === "stale" ? (
                                <Badge color="red" variant="filled">
                                  Needs attention
                                </Badge>
                              ) : (
                                <Badge color="green" variant="outline">
                                  Ready
                                </Badge>
                              )}
                            </Group>
                          </div>
                          <Group gap="xs">
                            {field.status === "stale" && (
                              <Button
                                size="xs"
                                variant="subtle"
                                leftSection={<IconRefresh size={14} />}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleRecheckDerivedFields();
                                }}
                              >
                                Re-check
                              </Button>
                            )}
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRemoveDerivedField(field.id);
                              }}
                              aria-label={`Remove derived field ${field.name}`}
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Group>
                        </Group>
                        {field.expression && (
                          <Text fz="sm" c="dimmed" lineClamp={3}>
                            {field.expression}
                          </Text>
                        )}
                        {field.status === "stale" && missingModels.length > 0 && (
                          <Stack gap={6}>
                            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
                              Re-add these models to resolve: {missingModels.join(", ")}
                            </Alert>
                            <Group gap="xs" wrap="wrap">
                              {missingModels.map((modelId) => (
                                <Button
                                  key={`${field.id}-restore-${modelId}`}
                                  size="xs"
                                  variant="light"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleRestoreModel(modelId);
                                  }}
                                >
                                  Re-add {modelMap.get(modelId)?.name ?? modelId}
                                </Button>
                              ))}
                            </Group>
                          </Stack>
                        )}
                      </Stack>
                    </Card>
                  );
                })}
              </Stack>
              <Stack gap="md" style={{ flex: "1 1 360px" }}>
                {selectedDerivedField ? (
                  <>
                    <Group justify="space-between" align="center">
                      <Text fw={600}>Field details</Text>
                      <Button
                        variant="subtle"
                        size="xs"
                        leftSection={<IconCopy size={14} />}
                        onClick={() => handleCopyExpression(selectedDerivedField.expression)}
                      >
                        Copy expression
                      </Button>
                    </Group>
                    <Textarea
                      value={derivedFieldDraft.expression}
                      autosize
                      minRows={6}
                      styles={{ input: { fontFamily: "monospace" } }}
                      onChange={(event) => handleExpressionDraftChange(event.currentTarget.value)}
                      error={derivedFieldDraft.error ?? undefined}
                    />
                    <Group gap="xs">
                      <Button
                        variant="light"
                        size="xs"
                        onClick={handleResetExpressionDraft}
                        disabled={!derivedExpressionHasChanges}
                      >
                        Reset
                      </Button>
                      <Button
                        size="xs"
                        onClick={handleApplyExpressionDraft}
                        disabled={!derivedExpressionHasChanges || Boolean(derivedFieldDraft.error)}
                      >
                        Apply changes
                      </Button>
                    </Group>
                    <Stack gap="xs">
                      <Text fw={600}>Join coverage</Text>
                      {selectedDerivedFieldCoverage.length === 0 ? (
                        <Alert color="gray" variant="light">
                          Single-model expression. No joins required.
                        </Alert>
                      ) : (
                        <Group gap="xs">
                          {selectedDerivedFieldCoverage.map(({ pair, satisfied }) => (
                            <Badge
                              key={`${pair[0]}-${pair[1]}`}
                              color={satisfied ? "green" : "red"}
                              variant={satisfied ? "light" : "filled"}
                              leftSection={<IconCheck size={12} />}
                            >
                              {pair[0]} ↔ {pair[1]}
                            </Badge>
                          ))}
                        </Group>
                      )}
                    </Stack>
                    {selectedDerivedField?.status === "stale" && (
                      (() => {
                        const missingModels = getEffectiveReferencedModels(selectedDerivedField).filter(
                          (modelId) => !draft.models.includes(modelId),
                        );
                        if (missingModels.length === 0) {
                          return null;
                        }
                        return (
                          <Stack gap={6}>
                            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
                              Re-add these models to resolve: {missingModels.join(", ")}
                            </Alert>
                            <Group gap="xs" wrap="wrap">
                              {missingModels.map((modelId) => (
                                <Button
                                  key={`selected-restore-${modelId}`}
                                  size="xs"
                                  variant="light"
                                  onClick={() => handleRestoreModel(modelId)}
                                >
                                  Re-add {modelMap.get(modelId)?.name ?? modelId}
                                </Button>
                              ))}
                            </Group>
                          </Stack>
                        );
                      })()
                    )}
                    <Stack gap="xs">
                      <Text fw={600}>Sample output</Text>
                      {derivedFieldPreviewSamples ? (
                        <Table striped highlightOnHover withColumnBorders>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>{selectedDerivedField.name}</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {derivedFieldPreviewSamples.rows.map((row) => (
                              <Table.Tr key={row.key}>
                                <Table.Td>{formatPreviewValue(row.value)}</Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      ) : (
                        <Alert color="gray" variant="light">
                          Run a preview to see sample values for this derived field.
                        </Alert>
                      )}
                    </Stack>
                    <Stack gap="xs">
                      <Group justify="space-between">
                        <Text fw={600}>Insert column tokens</Text>
                        {copiedToken && (
                          <Badge color="teal" variant="light">
                            Copied {copiedToken}
                          </Badge>
                        )}
                      </Group>
                      {fieldPaletteEntries.length === 0 ? (
                        <Alert color="gray" variant="light">
                          Select fields in your template to enable quick token insertion.
                        </Alert>
                      ) : (
                        <ScrollArea h={220}>
                          <Stack gap="sm">
                            {fieldPaletteEntries.map(({ model, fields }) => (
                              <Stack key={model.id} gap={4}>
                                <Text fw={500}>{model.name}</Text>
                                <Group gap="xs" wrap="wrap">
                                  {fields.map((field) => {
                                    const token = `${model.id}.${field.id}`;
                                    return (
                                      <Button
                                        key={token}
                                        size="xs"
                                        variant="light"
                                        onClick={() => handleCopyToken(token)}
                                        styles={{ root: { paddingLeft: 10, paddingRight: 10 } }}
                                      >
                                        {field.label ?? field.id}
                                      </Button>
                                    );
                                  })}
                                </Group>
                              </Stack>
                            ))}
                          </Stack>
                        </ScrollArea>
                      )}
                    </Stack>
                  </>
                ) : (
                  <Alert color="gray" variant="light">
                    Select a derived field to inspect its joins and available tokens.
                  </Alert>
                )}
              </Stack>
            </Flex>
          )}
          <Button
            variant="light"
            leftSection={<IconAdjustments size={16} />}
            onClick={handleOpenDerivedFieldManager}
          >
            Open derived field manager
          </Button>
        </Stack>
      </Drawer>
      <Modal
        opened={isDashboardModalOpen}
        onClose={handleCloseDashboardModal}
        title="Add to dashboard"
        size="lg"
        centered
      >
        {dashboardCardDraft ? (
          <Stack gap="md">
            {!hasDashboardTargets && !dashboardsQuery.isLoading && (
              <Alert color="yellow" variant="light" title="No dashboards available">
                <Stack gap="xs">
                  <Text fz="sm">
                    Create a dashboard first, then return here to drop this card onto the grid.
                  </Text>
                  <Button
                    variant="subtle"
                    size="xs"
                    leftSection={<IconLayoutGrid size={14} />}
                    onClick={() => {
                      navigate("/reports/dashboards");
                      handleCloseDashboardModal();
                    }}
                  >
                    Open dashboards
                  </Button>
                </Stack>
              </Alert>
            )}
            <Select
              label="Destination dashboard"
              data={dashboardOptions}
              value={selectedDashboardIdForModal}
              onChange={(value) => setSelectedDashboardIdForModal(value)}
              placeholder={
                dashboardsQuery.isLoading
                  ? "Loading dashboards..."
                  : hasDashboardTargets
                  ? "Select dashboard"
                  : "Create a dashboard to continue"
              }
              disabled={!hasDashboardTargets}
              searchable
            />
            <TextInput
              label="Card title"
              value={dashboardCardTitle}
              onChange={(event) => setDashboardCardTitle(event.currentTarget.value)}
              placeholder="Dashboard card title"
            />
            <Textarea
              label="Description"
              minRows={2}
              value={getDashboardCardDescription(dashboardCardDraft.viewConfig)}
              onChange={(event) =>
                setDashboardCardDraft((current) =>
                  current && hasEditableDashboardViewConfig(current.viewConfig)
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
              placeholder="Optional note shown with the card."
            />
            <Paper withBorder radius="md" p="md">
              {renderDashboardCardSummary() ?? (
                <Text fz="sm" c="dimmed">
                  Select a visual or spotlight to preview its configuration.
                </Text>
              )}
            </Paper>
            {dashboardModalError && (
              <Text c="red" fz="sm">
                {dashboardModalError}
              </Text>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={handleCloseDashboardModal}>
                Cancel
              </Button>
              <Button
                onClick={handleConfirmDashboardCard}
                loading={upsertDashboardCardMutation.isPending}
                disabled={!hasDashboardTargets || upsertDashboardCardMutation.isPending}
              >
                Save card
              </Button>
            </Group>
          </Stack>
        ) : (
          <Text c="dimmed" fz="sm">
            Select a visual or spotlight to send it to a dashboard.
          </Text>
        )}
      </Modal>
    </PageAccessGuard>
  );
};

export default Reports;







