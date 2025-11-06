import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import {
  Accordion,
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Flex,
  Group,
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
} from "@mantine/core";
import {
  IconAdjustments,
  IconArrowLeft,
  IconArrowRight,
  IconChartHistogram,
  IconCopy,
  IconDatabase,
  IconDeviceFloppy,
  IconDownload,
  IconMessage2,
  IconPlayerPlay,
  IconPlus,
  IconTemplate,
  IconTrash,
} from "@tabler/icons-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { useAppDispatch } from "../store/hooks";
import { navigateToPage } from "../actions/navigationActions";
import { GenericPageProps } from "../types/general/GenericPageProps";
import GoogleReviews from "../components/reports/GoogleReviews";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import {
  useReportModels,
  useReportTemplates,
  useRunReportPreview,
  useSaveReportTemplate,
  useDeleteReportTemplate,
  type ReportModelFieldResponse,
  type ReportModelPayload,
  type ReportPreviewRequest,
  type ReportPreviewResponse,
  type ReportTemplateDto,
  type ReportTemplateListResponse,
  type SaveReportTemplateRequest,
} from "../api/reports";

const PAGE_SLUG = PAGE_SLUGS.reports;
type SharedMetricKey =
  | "revenue"
  | "bookings"
  | "adr"
  | "occupancy"
  | "addOnRevenue"
  | "cancellations"
  | "guests"
  | "nps";

type DimensionKey = "month" | "channel";

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

type SelectedFieldDetail = DataField & { modelId: string; modelName: string; alias?: string };

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
  type: "line" | "area";
  metric: string;
  dimension: DimensionKey;
  comparison?: SharedMetricKey;
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
};

type FilterFieldOption = {
  value: string;
  label: string;
  modelId: string;
  fieldId: string;
  field: DataField;
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
  models: string[];
  fields: Array<{ modelId: string; fieldIds: string[] }>;
  joins: JoinCondition[];
  visuals: VisualDefinition[];
  metrics: string[];
  filters: ReportFilter[];
  columnOrder: string[];
  columnAliases: Record<string, string>;
};

interface MetricDefinition {
  value: string;
  label: string;
  primaryKey: SharedMetricKey;
  secondaryKey?: SharedMetricKey;
  secondaryLabel?: string;
  format: (value: number) => string;
  description: string;
}

const DEFAULT_CONNECTION_LABEL = "OmniLodge core database";

const JOIN_TYPE_OPTIONS: { value: JoinCondition["joinType"]; label: string }[] = [
  { value: "inner", label: "Inner join" },
  { value: "left", label: "Left join" },
  { value: "right", label: "Right join" },
  { value: "full", label: "Full outer join" },
];

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
  models: [],
  fields: [],
  joins: [],
  visuals: [],
  metrics: [],
  filters: [],
  columnOrder: [],
  columnAliases: {},
});

const formatCurrency = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const formatPercent = (value: number) =>
  `${(value * 100).toFixed(1).replace(".0", "")}%`;
const formatWhole = (value: number) => Math.round(value).toLocaleString("en-US");
const formatScore = (value: number) => `${Math.round(value)} pts`;

const toColumnAlias = (modelId: string, fieldId: string) => `${modelId}__${fieldId}`;

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
    return "—";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
};

const AVERAGE_METRICS = new Set<SharedMetricKey>(["adr", "occupancy", "nps"]);

const computeMetricDelta = (values: number[], metric: SharedMetricKey) => {
  if (values.length < 2) {
    return {
      delta: "Stable",
      context: "Not enough history",
      tone: "neutral" as const,
    };
  }

  const first = values[0];
  const last = values[values.length - 1];
  const change = last - first;
  const tone: "positive" | "neutral" | "negative" = change > 0 ? "positive" : change < 0 ? "negative" : "neutral";

  if (metric === "occupancy") {
    const points = change * 100;
    return {
      delta: `${points >= 0 ? "+" : ""}${points.toFixed(1)} pts`,
      context: "vs. first record",
      tone,
    };
  }

  if (metric === "nps") {
    return {
      delta: `${change >= 0 ? "+" : ""}${change.toFixed(1)}`,
      context: "vs. first record",
      tone,
    };
  }

  if (Math.abs(first) < 1e-6) {
    return {
      delta: `${change >= 0 ? "+" : ""}${change.toFixed(1)}`,
      context: "Absolute change vs. first record",
      tone,
    };
  }

  const percent = (change / Math.abs(first)) * 100;
  return {
    delta: `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`,
    context: "Percentage change vs. first record",
    tone,
  };
};

const METRIC_LIBRARY: MetricDefinition[] = [
  {
    value: "revenue",
    label: "Total revenue",
    primaryKey: "revenue",
    secondaryKey: "bookings",
    secondaryLabel: "Bookings",
    format: formatCurrency,
    description: "Gross lodging, ancillary and package revenue.",
  },
  {
    value: "adr",
    label: "Average daily rate",
    primaryKey: "adr",
    secondaryKey: "occupancy",
    secondaryLabel: "Occupancy",
    format: formatCurrency,
    description: "Revenue per occupied room night.",
  },
  {
    value: "occupancy",
    label: "Occupancy",
    primaryKey: "occupancy",
    secondaryKey: "bookings",
    secondaryLabel: "Bookings",
    format: formatPercent,
    description: "Share of available inventory that was sold.",
  },
  {
    value: "addOnRevenue",
    label: "Ancillary revenue",
    primaryKey: "addOnRevenue",
    secondaryKey: "guests",
    secondaryLabel: "Guests",
    format: formatCurrency,
    description: "Upsell and experience revenue attached to reservations.",
  },
  {
    value: "nps",
    label: "Net promoter score",
    primaryKey: "nps",
    secondaryKey: "cancellations",
    secondaryLabel: "Cancellations",
    format: formatScore,
    description: "Guest loyalty indicator from review feedback.",
  },
];

const CATEGORY_OPTIONS = [
  { value: "Executive summary", label: "Executive summary" },
  { value: "Revenue management", label: "Revenue management" },
  { value: "Sales & marketing", label: "Sales & marketing" },
  { value: "Guest experience", label: "Guest experience" },
  { value: "Operations", label: "Operations" },
  { value: "Custom", label: "Custom" },
];

const SCHEDULE_OPTIONS = [
  { value: "Manual", label: "Manual run" },
  { value: "Daily 06:00", label: "Daily - 06:00" },
  { value: "Weekly Monday 07:30", label: "Weekly - Monday 07:30" },
  { value: "Monthly 1st 09:00", label: "Monthly - 1st @ 09:00" },
];

const COMPARISON_OPTIONS: { value: SharedMetricKey; label: string }[] = [
  { value: "bookings", label: "Bookings" },
  { value: "occupancy", label: "Occupancy" },
  { value: "addOnRevenue", label: "Ancillary revenue" },
  { value: "guests", label: "Guests" },
  { value: "cancellations", label: "Cancellations" },
];

const DIMENSION_OPTIONS: { value: DimensionKey; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "channel", label: "Booking channel" },
];

const DEFAULT_VISUAL: VisualDefinition = {
  id: "visual-default",
  name: "Revenue trend",
  type: "line",
  metric: "revenue",
  dimension: "month",
  comparison: "bookings",
};

const DELTA_HINTS: Record<
  string,
  { delta: string; context: string; tone: "positive" | "neutral" | "negative" }
> = {
  revenue: { delta: "+12.4%", context: "vs. rolling 8 months", tone: "positive" },
  adr: { delta: "+4.1%", context: "summer event uplift", tone: "positive" },
  occupancy: { delta: "+2.6 pts", context: "corporate contracts", tone: "positive" },
  addOnRevenue: { delta: "+18.7%", context: "experience upsell mix", tone: "positive" },
  nps: { delta: "+6 pts", context: "post-renovation feedback", tone: "positive" },
};

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

const findMetricDefinition = (metricValue: string) =>
  METRIC_LIBRARY.find((metric) => metric.value === metricValue) ?? METRIC_LIBRARY[0];

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
    models: Array.isArray(template.models) ? template.models : [],
    fields: mappedFields,
    joins: Array.isArray(template.joins) ? (template.joins as JoinCondition[]) : [],
    visuals: Array.isArray(template.visuals) ? (template.visuals as VisualDefinition[]) : [],
    metrics: Array.isArray(template.metrics)
      ? template.metrics.filter((metric): metric is string => typeof metric === "string")
      : [],
    filters: Array.isArray(template.filters) ? (template.filters as ReportFilter[]) : [],
    columnOrder,
    columnAliases,
  };
};

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

  const {
    data: templatesResponse,
    isLoading: isTemplatesLoading,
    isError: isTemplatesError,
  } = useReportTemplates();

  const saveTemplateMutation = useSaveReportTemplate();
  const deleteTemplateMutation = useDeleteReportTemplate();

  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [draft, setDraft] = useState<ReportTemplate>(createEmptyTemplate());
  const [lastRunAt, setLastRunAt] = useState<string>("Not run yet");
  const [previewResult, setPreviewResult] = useState<ReportPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [manualJoinDraft, setManualJoinDraft] = useState<ManualJoinDraft>(() => createManualJoinDraft());
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
        };

        if (aliasValue !== undefined) {
          detail.alias = aliasValue;
        }

        details.push(detail);
      });
    });

    return details;
  }, [draft.columnAliases, draft.fields, modelMap]);

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
    return draft.models.flatMap((modelId) => {
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
      }));
    });
  }, [draft.models, modelMap]);

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
  }, [draft.columnAliases, modelMap, previewColumns]);

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

  const getDefaultColumn = useCallback(
    (preference: "numeric" | "textual" | "any"): string | undefined => {
      if (preference === "numeric") {
        const candidate = previewColumns.find((column) => numericColumnsSet.has(column));
        if (candidate) {
          return candidate;
        }
      }
      if (preference === "textual") {
        const candidate = previewColumns.find((column) => textualColumnsSet.has(column));
        if (candidate) {
          return candidate;
        }
      }
      return previewColumns[0];
    },
    [numericColumnsSet, previewColumns, textualColumnsSet],
  );

  const findColumnByKeyword = useCallback(
    (keyword: string, preference: "numeric" | "textual" | "any" = "any"): string | undefined => {
      if (previewColumns.length === 0) {
        return undefined;
      }

      if (!keyword) {
        return getDefaultColumn(preference);
      }

      const normalized = keyword.toLowerCase();

      const candidateFields = selectedFieldDetails
        .filter(
          (field) =>
            field.id.toLowerCase().includes(normalized) ||
            field.label.toLowerCase().includes(normalized) ||
            (field.sourceColumn ?? "").toLowerCase().includes(normalized),
        )
        .map((field) => toColumnAlias(field.modelId, field.id))
        .filter((alias) => previewColumns.includes(alias));

      const pickByPreference = (candidates: string[]): string | undefined => {
        if (candidates.length === 0) {
          return undefined;
        }
        if (preference === "numeric") {
          return candidates.find((alias) => numericColumnsSet.has(alias)) ?? undefined;
        }
        if (preference === "textual") {
          return candidates.find((alias) => textualColumnsSet.has(alias)) ?? undefined;
        }
        return candidates[0];
      };

      const fieldMatch = pickByPreference(candidateFields);
      if (fieldMatch) {
        return fieldMatch;
      }

      const aliasMatches = previewColumns.filter((column) => {
        const segments = column.toLowerCase().split(/__|\.|_/g);
        return segments.some((segment) => segment.includes(normalized));
      });

      const aliasMatch = pickByPreference(aliasMatches);
      if (aliasMatch) {
        return aliasMatch;
      }

      return getDefaultColumn(preference);
    },
    [getDefaultColumn, numericColumnsSet, previewColumns, selectedFieldDetails, textualColumnsSet],
  );

  const activeVisual = draft.visuals[0] ?? DEFAULT_VISUAL;
  const metricDefinition = findMetricDefinition(activeVisual.metric);
  const comparisonKey =
    activeVisual.comparison ?? metricDefinition.secondaryKey ?? undefined;

  const chartData = useMemo(() => {
    if (previewRows.length === 0 || previewColumns.length === 0) {
      return [];
    }

    const dimensionAlias = findColumnByKeyword(activeVisual.dimension, "textual");
    const primaryAlias = findColumnByKeyword(metricDefinition.primaryKey, "numeric");
    const comparisonAlias = comparisonKey ? findColumnByKeyword(comparisonKey, "numeric") : undefined;

    if (!dimensionAlias || !primaryAlias) {
      return [];
    }

    return previewRows
      .map((row) => {
        const dimensionValue = coerceString(row[dimensionAlias]);
        const primaryValue = coerceNumber(row[primaryAlias]);
        if (!dimensionValue || primaryValue === null) {
          return null;
        }
        const point: { dimension: string; primary: number; secondary?: number } = {
          dimension: dimensionValue,
          primary: primaryValue,
        };
        if (comparisonAlias) {
          const comparisonValue = coerceNumber(row[comparisonAlias]);
          if (comparisonValue !== null) {
            point.secondary = comparisonValue;
          }
        }
        return point;
      })
      .filter(
        (value): value is { dimension: string; primary: number; secondary?: number } => value !== null,
      );
  }, [
    activeVisual.dimension,
    comparisonKey,
    metricDefinition.primaryKey,
    findColumnByKeyword,
    previewColumns,
    previewRows,
  ]);

  const hasChartData = chartData.length > 0;

  const metricsSummary = useMemo(() => {
    const chosenMetrics =
      draft.metrics.length > 0
        ? METRIC_LIBRARY.filter((metric) => draft.metrics.includes(metric.value))
        : METRIC_LIBRARY.slice(0, 4);

    if (previewRows.length === 0 || previewColumns.length === 0) {
      return chosenMetrics.map((definition) => ({
        id: definition.value,
        label: definition.label,
        value: "Run preview",
        delta: "—",
        context: definition.description,
        tone: "neutral" as const,
      }));
    }

    return chosenMetrics.map((definition) => {
      const primaryAlias = findColumnByKeyword(definition.primaryKey, "numeric");
      if (!primaryAlias) {
        return {
          id: definition.value,
          label: definition.label,
          value: "Not available",
          delta: "—",
          context: `Add a field matching “${definition.primaryKey}” to your selection.`,
          tone: "neutral" as const,
        };
      }

      const values = previewRows
        .map((row) => coerceNumber(row[primaryAlias]))
        .filter((value): value is number => value !== null);

      if (values.length === 0) {
        return {
          id: definition.value,
          label: definition.label,
          value: "Not available",
          delta: "—",
          context: "No numeric values returned for this metric.",
          tone: "neutral" as const,
        };
      }

      const total = values.reduce((acc, value) => acc + value, 0);
      const average = total / values.length;
      const useAverage = AVERAGE_METRICS.has(definition.primaryKey);
      const displayValue = useAverage ? definition.format(average) : definition.format(total);
      const delta = computeMetricDelta(values, definition.primaryKey);

      return {
        id: definition.value,
        label: definition.label,
        value: displayValue,
        delta: delta.delta,
        context: delta.context,
        tone: delta.tone,
      };
    });
  }, [draft.metrics, findColumnByKeyword, previewColumns, previewRows]);

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

  const handleSelectTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }
    setTemplateError(null);
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
        return {
          ...current,
          models: current.models.filter((id) => id !== modelId),
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
        };
      }
      return {
        ...current,
        models: [...current.models, modelId],
        fields: current.fields.some((entry) => entry.modelId === modelId)
          ? current.fields
          : [...current.fields, { modelId, fieldIds: [] }],
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

      return {
        ...current,
        fields: nextFields,
        columnOrder: nextColumnOrder,
        columnAliases: nextColumnAliases,
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

    if (!draft.name.trim()) {
      setTemplateError("Template name is required.");
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
      },
      columnOrder: [...draft.columnOrder],
      columnAliases: { ...draft.columnAliases },
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
    } catch (error) {
      setTemplateError(extractAxiosErrorMessage(error, "Failed to save template"));
    }
  };

  const handleCreateTemplate = async () => {
    if (saveTemplateMutation.isPending) {
      return;
    }

    setTemplateError(null);

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
      },
      columnOrder: [],
      columnAliases: {},
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
            };
      setTemplates((current) => [...current, mergedTemplate]);
      setSelectedTemplateId(mergedTemplate.id);
      setDraft(deepClone(mergedTemplate));
    } catch (error) {
      setTemplateError(extractAxiosErrorMessage(error, "Failed to create template"));
    }
  };

  const handleDuplicateTemplate = async () => {
    if (!selectedTemplate || saveTemplateMutation.isPending) {
      return;
    }

    setTemplateError(null);

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
      },
      columnOrder: [...selectedTemplate.columnOrder],
      columnAliases: { ...selectedTemplate.columnAliases },
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
            };
      setTemplates((current) => [...current, mergedTemplate]);
      setSelectedTemplateId(mergedTemplate.id);
      setDraft(deepClone(mergedTemplate));
    } catch (error) {
      setTemplateError(extractAxiosErrorMessage(error, "Failed to duplicate template"));
    }
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplate || deleteTemplateMutation.isPending) {
      return;
    }

    setTemplateError(null);

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

    if (draft.models.length === 0) {
      setPreviewResult(null);
      setPreviewError("Select at least one data model to run a preview.");
      return;
    }

    const sanitizedFields = draft.fields
      .map((entry) => ({
        modelId: entry.modelId,
        fieldIds: entry.fieldIds.filter((fieldId) => Boolean(fieldId)),
      }))
      .filter((entry) => entry.fieldIds.length > 0);

    if (sanitizedFields.length === 0) {
      setPreviewResult(null);
      setPreviewError("Select at least one field to include in your preview.");
      return;
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
      setPreviewResult(null);
      setPreviewError(filterErrors.join(" • "));
      return;
    }

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
      limit: 500,
    };

    try {
      const response = await runPreview(payload);
      setPreviewResult(response);
      setPreviewError(null);
      setLastRunAt(formatTimestamp());
    } catch (error) {
      console.error("Failed to run report preview", error);
      const axiosError = error as AxiosError<{ message?: string }>;
      const message =
        axiosError?.response?.data?.message ?? axiosError?.message ?? "Failed to run report preview.";
      setPreviewError(message);
    }
  };

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

      if (nextFilter.rightType === "value") {
        nextFilter.value =
          nextValueKind === "boolean"
            ? nextFilter.value === "false"
              ? "false"
              : "true"
            : "";
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
        return nextFilter;
      }

      if (!allowFieldComparison && nextFilter.rightType === "field") {
        nextFilter.rightType = "value";
        nextFilter.rightModelId = undefined;
        nextFilter.rightFieldId = undefined;
      }

      if (nextFilter.rightType === "value") {
        nextFilter.value =
          nextFilter.valueKind === "boolean"
            ? nextFilter.value === "false"
              ? "false"
              : "true"
            : nextFilter.value ?? "";
      }

      return nextFilter;
    });
  };

  const handleFilterComparisonModeChange = (filterId: string, mode: FilterComparisonMode) => {
    updateFilter(filterId, (filter) => {
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
    updateFilter(filterId, (filter) => ({
      ...filter,
      value: rawValue ?? "",
    }));
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

          if (normalized.rightType === "value" && normalized.valueKind === "boolean") {
            normalized.value = normalized.value === "false" ? "false" : "true";
          }

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

  const buildFilterClausesForRequest = useCallback(
    (filters: ReportFilter[], aliasLookup: Map<string, string>) => {
      const clauses: string[] = [];
      const errors: string[] = [];

      filters.forEach((filter) => {
        const leftOption = filterFieldLookup.get(
          buildFilterOptionKey(filter.leftModelId, filter.leftFieldId),
        );
        if (!leftOption) {
          errors.push("A filter references a field that is no longer available.");
          return;
        }

        const leftAlias = aliasLookup.get(filter.leftModelId);
        if (!leftAlias) {
          errors.push(`Model ${filter.leftModelId} is not included in the current preview.`);
          return;
        }

        const operatorDefinition = FILTER_OPERATOR_LOOKUP.get(filter.operator);
        if (!operatorDefinition) {
          return;
        }

        const leftColumn = leftOption.field.sourceColumn ?? leftOption.field.id;
        const leftExpression = `${leftAlias}.${quoteIdentifier(leftColumn)}`;
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
          const rightAlias = aliasLookup.get(filter.rightModelId);
          const rightOption = filterFieldLookup.get(
            buildFilterOptionKey(filter.rightModelId, filter.rightFieldId),
          );
          if (!rightAlias || !rightOption) {
            errors.push("The comparison field is no longer available.");
            return;
          }
          const rightColumn = rightOption.field.sourceColumn ?? rightOption.field.id;
          const rightExpression = `${rightAlias}.${quoteIdentifier(rightColumn)}`;
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

        const trimmedValue = (filter.value ?? "").trim();
        if (filter.valueKind !== "boolean" && trimmedValue.length === 0) {
          errors.push(`Provide a value for the filter on "${fieldLabel}".`);
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
              contains: "",
              starts_with: "",
              ends_with: "",
              is_null: "",
              is_not_null: "",
              is_true: "",
              is_false: "",
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
    [filterFieldLookup],
  );


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
                loading={isPreviewLoading}
              >
                Run analysis
              </Button>
              <Button leftSection={<IconDownload size={16} />} variant="light">
                Export preview
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
          {templateError && (
            <Text c="red" mt="sm">
              {templateError}
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
                  <ScrollArea h={260} type="always" offsetScrollbars>
                    <Stack gap="sm">
                      {templates.map((template) => {
                        const isActive = template.id === draft.id;
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
                            <Group justify="space-between" align="flex-start">
                              <div>
                                <Text fw={600}>{template.name}</Text>
                                <Group gap={6} mt={6}>
                                  <Badge size="xs" variant="light">
                                    {template.category}
                                  </Badge>
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
                            <Text size="xs" c="dimmed" mt={10}>
                              Updated {template.lastUpdated} - Owner {template.owner}
                            </Text>
                          </Card>
                        );
                      })}
                    </Stack>
                  </ScrollArea>
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
                      data={METRIC_LIBRARY.map((metric) => ({
                        value: metric.value,
                        label: metric.label,
                      }))}
                      value={draft.metrics}
                      onChange={(value) => setDraft((current) => ({ ...current, metrics: value }))}
                      placeholder="Select metrics"
                    />
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
                  </Stack>
                </Paper>
                <Paper p="md" radius="lg" shadow="xs" withBorder>
                  <Group justify="space-between" mb="md">
                    <Text fw={600}>Field inventory</Text>
                    <Badge variant="light">{selectedFieldDetails.length} fields</Badge>
                  </Group>
                  {selectedModels.length === 0 ? (
                    <Text c="dimmed">
                      Select at least one data model to begin adding fields to your report.
                    </Text>
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
                    <Badge variant="light">{chartData.length} datapoints</Badge>
                  </Group>
                  <Flex gap="lg" align="flex-start" wrap="wrap">
                    <Stack gap="sm" style={{ minWidth: 260, flex: "0 0 260px" }}>
                      <SegmentedControl
                        data={[
                          { value: "line", label: "Line" },
                          { value: "area", label: "Area" },
                        ]}
                        value={activeVisual.type}
                        onChange={(value) =>
                          handleVisualChange({ type: value as VisualDefinition["type"] })
                        }
                      />
                      <Select
                        label="Metric"
                        data={METRIC_LIBRARY.map((metric) => ({
                          value: metric.value,
                          label: metric.label,
                        }))}
                        value={activeVisual.metric}
                        onChange={(value) =>
                          handleVisualChange({ metric: value ?? activeVisual.metric })
                        }
                      />
                      <Select
                        label="Dimension"
                        data={DIMENSION_OPTIONS}
                        value={activeVisual.dimension}
                        onChange={(value) =>
                          handleVisualChange({
                            dimension: (value ?? activeVisual.dimension) as DimensionKey,
                          })
                        }
                      />
                      <Select
                        label="Comparison series"
                        data={COMPARISON_OPTIONS}
                        value={comparisonKey}
                        onChange={(value) =>
                          handleVisualChange({
                            comparison: (value ?? undefined) as SharedMetricKey | undefined,
                          })
                        }
                        placeholder="Optional secondary series"
                        clearable
                      />
                      <Textarea
                        label="Insight annotation"
                        placeholder="Add narrative context for stakeholders..."
                        minRows={2}
                      />
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
                      {hasChartData ? (
                        <ResponsiveContainer width="100%" height={240}>
                          <ComposedChart data={chartData}>
                            <CartesianGrid stroke="#f1f3f5" strokeDasharray="4 4" />
                            <XAxis dataKey="dimension" tick={{ fontSize: 12 }} />
                            <YAxis yAxisId="left" tick={{ fontSize: 12 }} stroke="#1c7ed6" />
                            {comparisonKey && (
                              <YAxis
                                yAxisId="right"
                                orientation="right"
                                tick={{ fontSize: 12 }}
                                stroke="#2b8a3e"
                              />
                            )}
                            <RechartsTooltip
                              formatter={(value: number, dataKey: string) => {
                                if (dataKey === "primary") {
                                  return metricDefinition.format(value);
                                }
                                if (comparisonKey === "occupancy") {
                                  return formatPercent(value);
                                }
                                if (comparisonKey === "addOnRevenue" || comparisonKey === "revenue") {
                                  return formatCurrency(value);
                                }
                                return formatWhole(value);
                              }}
                              labelFormatter={(label) => `${metricDefinition.label} - ${label}`}
                            />
                            <Legend />
                            {activeVisual.type === "line" && (
                              <Line
                                type="monotone"
                                dataKey="primary"
                                stroke="#1c7ed6"
                                strokeWidth={2}
                                dot={false}
                                name={metricDefinition.label}
                                yAxisId="left"
                              />
                            )}
                            {activeVisual.type === "area" && (
                              <Area
                                type="monotone"
                                dataKey="primary"
                                stroke="#1c7ed6"
                                fill="#a5d8ff"
                                name={metricDefinition.label}
                                yAxisId="left"
                              />
                            )}
                            {comparisonKey && (
                              <Line
                                type="monotone"
                                dataKey="secondary"
                                stroke="#2b8a3e"
                                strokeWidth={2}
                                dot={false}
                                name={
                                  COMPARISON_OPTIONS.find((option) => option.value === comparisonKey)?.label ??
                                  "Comparison"
                                }
                                yAxisId="right"
                              />
                            )}
                          </ComposedChart>
                        </ResponsiveContainer>
                      ) : (
                        <Flex align="center" justify="center" h={240}>
                          <Text c="dimmed" fz="sm" ta="center">
                            {previewRows.length === 0
                              ? "Run the analysis to populate this visualization."
                              : "No chartable metrics detected. Select numeric fields or adjust your visualization settings."}
                          </Text>
                        </Flex>
                      )}
                    </Paper>
                  </Flex>
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
                        if (requiresValue) {
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
                  <Group justify="space-between" mb="md">
                    <Group gap="xs">
                      <Text fw={600}>Data preview</Text>
                      <Badge variant="light">{previewRows.length} rows</Badge>
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

                <Accordion variant="separated">
                  <Accordion.Item value="google-reviews">
                    <Accordion.Control icon={<IconMessage2 size={16} />}>
                      Guest sentiment (Google reviews preview)
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Text fz="sm" c="dimmed" mb="md">
                        Blend external review intelligence alongside operational reporting to surface leading indicators of guest satisfaction.
                      </Text>
                      <Paper radius="md" withBorder shadow="xs" p="md">
                        <GoogleReviews />
                      </Paper>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              </Stack>
            </Flex>
          )}
        </Stack>
      </Box>
    </PageAccessGuard>
  );
};

export default Reports;




