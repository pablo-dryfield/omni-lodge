import { useCallback, useEffect, useMemo, useState } from "react";
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
  List,
  MultiSelect,
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
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { navigateToPage } from "../actions/navigationActions";
import { GenericPageProps } from "../types/general/GenericPageProps";
import GoogleReviews from "../components/reports/GoogleReviews";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import {
  useReportModels,
  useRunReportPreview,
  type ReportModelFieldResponse,
  type ReportModelPayload,
  type ReportPreviewRequest,
  type ReportPreviewResponse,
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

type JoinCondition = {
  id: string;
  leftModel: string;
  leftField: string;
  rightModel: string;
  rightField: string;
  joinType: "inner" | "left" | "right" | "full";
  description?: string;
};

type VisualDefinition = {
  id: string;
  name: string;
  type: "line" | "area";
  metric: string;
  dimension: DimensionKey;
  comparison?: SharedMetricKey;
};

type ReportTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  schedule: string;
  lastUpdated: string;
  owner: string;
  models: string[];
  fields: Array<{ modelId: string; fieldIds: string[] }>;
  joins: JoinCondition[];
  visuals: VisualDefinition[];
  metrics: string[];
  filters: Array<{ id: string; label: string; value: string }>;
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
  name: "Ad-hoc report",
  category: "Custom",
  description: "Configure models and fields to begin building your report.",
  schedule: "Manual",
  lastUpdated: "Just now",
  owner: "You",
  models: [],
  fields: [],
  joins: [],
  visuals: [
    {
      id: "visual-default",
      name: "Revenue trend",
      type: "line",
      metric: "revenue",
      dimension: "month",
      comparison: "bookings",
    },
  ],
  metrics: [],
  filters: [],
});

const formatCurrency = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const formatPercent = (value: number) =>
  `${(value * 100).toFixed(1).replace(".0", "")}%`;
const formatWhole = (value: number) => Math.round(value).toLocaleString("en-US");
const formatScore = (value: number) => `${Math.round(value)} pts`;

const toColumnAlias = (modelId: string, fieldId: string) => `${modelId}__${fieldId}`;

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

const buildInitialTemplates = (models: DataModelDefinition[]): ReportTemplate[] => {
  if (models.length === 0) {
    return [];
  }

  const primaryModel =
    models.find((candidate) => candidate.fields.length >= 3) ?? models[0];

  const association =
    primaryModel.associations?.find((assoc) =>
      models.some((candidate) => candidate.id === assoc.targetModelId)
    ) ?? null;

  const secondaryModel = association
    ? models.find((candidate) => candidate.id === association.targetModelId)
    : undefined;

  const defaultFields = primaryModel.fields.slice(0, 5).map((field) => field.id);

  const template: ReportTemplate = {
    id: `template-${primaryModel.id.toLowerCase()}`,
    name: `${primaryModel.name} overview`,
    category: "Custom",
    description: secondaryModel
      ? `Explore ${primaryModel.name} with ${secondaryModel.name} linked for context.`
      : `Explore key fields from the ${primaryModel.name} model.`,
    schedule: "Manual",
    lastUpdated: "Just now",
    owner: "You",
    models: secondaryModel ? [primaryModel.id, secondaryModel.id] : [primaryModel.id],
    fields: [
      { modelId: primaryModel.id, fieldIds: defaultFields },
      ...(secondaryModel
        ? [
            {
              modelId: secondaryModel.id,
              fieldIds: secondaryModel.fields.slice(0, 3).map((field) => field.id),
            },
          ]
        : []),
    ],
    joins:
      secondaryModel && association
        ? [
            {
              id: `join-${primaryModel.id}-${secondaryModel.id}`,
              leftModel: primaryModel.id,
              leftField: association.foreignKey ?? getDefaultKey(primaryModel),
              rightModel: secondaryModel.id,
              rightField: association.sourceKey ?? getDefaultKey(secondaryModel),
              joinType: "left",
              description: `${association.associationType} association`,
            },
          ]
        : [],
    visuals: [deepClone(DEFAULT_VISUAL)],
    metrics: METRIC_LIBRARY.slice(0, 2).map((metric) => metric.value),
    filters: [],
  };

  return [template];
};

const findMetricDefinition = (metricValue: string) =>
  METRIC_LIBRARY.find((metric) => metric.value === metricValue) ?? METRIC_LIBRARY[0];

const formatTimestamp = () =>
  new Date().toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

const Reports = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const activeKey = useAppSelector((state) => state.reportsNavBarActiveKey);

  const {
    data: backendModelsResponse,
    isLoading: isModelsLoading,
    isError: isModelsError,
  } = useReportModels();

  const dataModels = useMemo(() => {
    const models = backendModelsResponse?.models ?? [];
    return models.map(mapBackendModel);
  }, [backendModelsResponse]);

  const { mutateAsync: runPreview, isPending: isPreviewLoading } = useRunReportPreview();

  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [draft, setDraft] = useState<ReportTemplate>(createEmptyTemplate());
  const [lastRunAt, setLastRunAt] = useState<string>("—");
  const [filterInput, setFilterInput] = useState("");
  const [autoDistribution, setAutoDistribution] = useState(true);
  const [notifyTeam, setNotifyTeam] = useState(true);
  const [previewResult, setPreviewResult] = useState<ReportPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    dispatch(navigateToPage("Reports"));
  }, [dispatch, props.title]);

  useEffect(() => {
    if (dataModels.length === 0 || templates.length > 0) {
      return;
    }
    const initialTemplates = buildInitialTemplates(dataModels);
    const fallback = initialTemplates.length > 0 ? initialTemplates : [createEmptyTemplate()];
    setTemplates(fallback);
    if (fallback[0]) {
      setSelectedTemplateId(fallback[0].id);
      setDraft(deepClone(fallback[0]));
    }
  }, [dataModels, templates.length]);

  useEffect(() => {
    if (!activeKey || activeKey === "GoogleReviews") {
      return;
    }
    const token = activeKey.toLowerCase();
    const candidate = templates.find(
      (template) =>
        template.category.toLowerCase().includes(token) ||
        template.name.toLowerCase().includes(token)
    );
    if (candidate && candidate.id !== selectedTemplateId) {
      setSelectedTemplateId(candidate.id);
      setDraft(deepClone(candidate));
    }
  }, [activeKey, templates, selectedTemplateId]);

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

  const selectedFieldDetails = useMemo(() => {
    return draft.fields.flatMap((entry) => {
      const model = modelMap.get(entry.modelId);
      if (!model) {
        return [];
      }
      return entry.fieldIds
        .map((fieldId) => {
          const field = model.fields.find((candidate) => candidate.id === fieldId);
          if (!field) {
            return null;
          }
          return {
            ...field,
            modelId: model.id,
            modelName: model.name,
          };
        })
        .filter((field): field is DataField & { modelId: string; modelName: string } =>
          Boolean(field)
        );
    });
  }, [draft.fields, modelMap]);

  const previewColumns = useMemo(
    () => previewResult?.columns ?? [],
    [previewResult],
  );
  const previewRows = useMemo(
    () => previewResult?.rows ?? [],
    [previewResult],
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

  const builderContext =
    activeKey && activeKey !== "GoogleReviews"
      ? activeKey
      : selectedTemplate?.category ?? "Report builder";

  const isGoogleReviewsView = activeKey === "GoogleReviews";

  const handleSelectTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }
    setSelectedTemplateId(templateId);
    setDraft(deepClone(template));
  };

  const handleToggleModel = (modelId: string) => {
    setDraft((current) => {
      const hasModel = current.models.includes(modelId);
      if (hasModel) {
        return {
          ...current,
          models: current.models.filter((id) => id !== modelId),
          fields: current.fields.filter((entry) => entry.modelId !== modelId),
          joins: current.joins.filter(
            (join) => join.leftModel !== modelId && join.rightModel !== modelId
          ),
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
    setDraft((current) => {
      const nextFields = current.fields.map((entry) => {
        if (entry.modelId !== modelId) {
          return entry;
        }
        const hasField = entry.fieldIds.includes(fieldId);
        return {
          ...entry,
          fieldIds: hasField
            ? entry.fieldIds.filter((id) => id !== fieldId)
            : [...entry.fieldIds, fieldId],
        };
      });
      return { ...current, fields: nextFields };
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

  const handleSaveTemplate = () => {
    setTemplates((current) => {
      const formatted = { ...draft, lastUpdated: formatTimestamp() };
      const exists = current.some((template) => template.id === draft.id);
      if (exists) {
        return current.map((template) => (template.id === draft.id ? formatted : template));
      }
      return [...current, formatted];
    });
  };

  const handleCreateTemplate = () => {
    const contextLabel = activeKey && activeKey !== "GoogleReviews" ? activeKey : "Custom";
    const fresh: ReportTemplate = {
      id: `template-${Date.now()}`,
      name: `${contextLabel} report`,
      category: "Custom",
      description:
        "Blank template. Add data models, joins and visualizations to start building your report.",
      schedule: "Manual",
      lastUpdated: "Just now",
      owner: "You",
      models: [],
      fields: [],
      joins: [],
      visuals: [deepClone(DEFAULT_VISUAL)],
      metrics: [],
      filters: [],
    };
    setTemplates((current) => [...current, fresh]);
    setSelectedTemplateId(fresh.id);
    setDraft(deepClone(fresh));
  };

  const handleDuplicateTemplate = () => {
    if (!selectedTemplate) {
      return;
    }
    const duplicated: ReportTemplate = {
      ...deepClone(selectedTemplate),
      id: `${selectedTemplate.id}-copy-${Date.now()}`,
      name: `${selectedTemplate.name} (copy)`,
      lastUpdated: "Just now",
      owner: "You",
    };
    setTemplates((current) => [...current, duplicated]);
    setSelectedTemplateId(duplicated.id);
    setDraft(deepClone(duplicated));
  };

  const handleDeleteTemplate = () => {
    if (!selectedTemplate) {
      return;
    }
    setTemplates((current) => {
      const filtered = current.filter((template) => template.id !== selectedTemplate.id);
      if (filtered.length === 0) {
        const regenerated = buildInitialTemplates(dataModels);
        const fallbackTemplate = regenerated[0] ?? createEmptyTemplate();
        setSelectedTemplateId(fallbackTemplate.id);
        setDraft(deepClone(fallbackTemplate));
        return regenerated.length > 0 ? regenerated : [fallbackTemplate];
      }
      const nextSelection = filtered[0];
      setSelectedTemplateId(nextSelection.id);
      setDraft(deepClone(nextSelection));
      return filtered;
    });
  };

  const handleAddJoin = (
    leftModelId: string,
    rightModelId: string,
    options?: {
      leftField?: string;
      rightField?: string;
      joinType?: JoinCondition["joinType"];
      description?: string;
    }
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
  };

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
      filters: draft.filters.map((filter) => filter.value).filter((value) => value.trim().length > 0),
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

  const handleAddFilter = () => {
    const trimmed = filterInput.trim();
    if (!trimmed) {
      return;
    }
    setDraft((current) => ({
      ...current,
      filters: [
        ...current.filters,
        {
          id: `filter-${Date.now()}`,
          label: trimmed,
          value: trimmed,
        },
      ],
    }));
    setFilterInput("");
  };

  const handleRemoveFilter = (filterId: string) => {
    setDraft((current) => ({
      ...current,
      filters: current.filters.filter((filter) => filter.id !== filterId),
    }));
  };

  const builderLoaded = dataModels.length > 0;

  if (isGoogleReviewsView) {
    return (
      <PageAccessGuard pageSlug={PAGE_SLUG}>
        <Box
          p="xl"
          bg="#f4f6f8"
          style={{ minHeight: "100vh", display: "flex", flexDirection: "column", gap: 24 }}
        >
          <Paper radius="lg" shadow="sm" p="xl" withBorder>
            <Group justify="space-between" align="flex-start">
              <div>
                <Title order={2}>Guest sentiment intelligence</Title>
                <Text c="dimmed" mt={6}>
                  Monitor Google reviews, response velocity and reputation indicators.
                </Text>
              </div>
              <Badge color="blue" variant="filled">
                Live feed
              </Badge>
            </Group>
          </Paper>
          <Paper radius="lg" shadow="sm" p="xl" withBorder style={{ flex: 1 }}>
            <GoogleReviews />
          </Paper>
        </Box>
      </PageAccessGuard>
    );
  }

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
              <Button leftSection={<IconTemplate size={16} />} variant="light" onClick={handleCreateTemplate}>
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
              <Button leftSection={<IconDeviceFloppy size={16} />} onClick={handleSaveTemplate}>
                Save changes
              </Button>
            </Group>
          </Group>

          {!builderLoaded ? (
            <Paper p="lg" radius="lg" shadow="xs" withBorder>
              {isModelsLoading ? (
                <Text c="dimmed">Loading data models</Text>
              ) : isModelsError ? (
                <Text c="red">Unable to load data models. Please verify backend connectivity.</Text>
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
                      disabled={!selectedTemplate}
                    >
                      Duplicate
                    </Button>
                    <Button
                      variant="light"
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      onClick={handleDeleteTemplate}
                      disabled={!selectedTemplate}
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
                                {suggestion.source.name} - {suggestion.target.name}
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
                                    <Table.Th>Type</Table.Th>
                                    <Table.Th>Column</Table.Th>
                                    <Table.Th align="right">Include</Table.Th>
                                  </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                  {model.fields.map((field) => {
                                    const checked = selections.includes(field.id);
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
                    <Group align="flex-start" gap="sm">
                      <TextInput
                        placeholder="Add a filter clause (e.g. stay_date >= current_date - interval '30 day')"
                        value={filterInput}
                        onChange={(event) => setFilterInput(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            handleAddFilter();
                          }
                        }}
                        style={{ flex: 1 }}
                      />
                      <Button variant="light" onClick={handleAddFilter}>
                        Apply filter
                      </Button>
                    </Group>
                    {draft.filters.length > 0 && (
                      <List size="sm" spacing="xs">
                        {draft.filters.map((filter) => (
                          <List.Item key={filter.id} icon={<IconAdjustments size={14} />}>
                            <Group justify="space-between">
                              <Text>{filter.label}</Text>
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="red"
                                onClick={() => handleRemoveFilter(filter.id)}
                                aria-label="Remove filter"
                              >
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Group>
                          </List.Item>
                        ))}
                      </List>
                    )}
                    <Divider my="sm" />
                    <Checkbox
                      label="Auto-publish PDF package to leadership workspace"
                      checked={autoDistribution}
                      onChange={(event) => setAutoDistribution(event.currentTarget.checked)}
                    />
                    <Checkbox
                      label="Send digest to #revenue-ops Slack channel on refresh"
                      checked={notifyTeam}
                      onChange={(event) => setNotifyTeam(event.currentTarget.checked)}
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
                      {lastRunAt === "—" ? "Preview not run yet" : `Last run: ${lastRunAt}`}
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
                            {previewColumns.map((column) => (
                              <Table.Th key={column}>{humanizeAlias(column)}</Table.Th>
                            ))}
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




