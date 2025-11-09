import { useMutation, useQuery } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import axiosInstance from "../utils/axiosInstance";

export type QueryConfigFieldRef = {
  modelId: string;
  fieldId: string;
};

export type QueryConfigSelect = QueryConfigFieldRef & {
  alias?: string;
};

export type QueryConfigMetric = QueryConfigFieldRef & {
  alias?: string;
  aggregation: "sum" | "avg" | "min" | "max" | "count" | "count_distinct";
  window?: {
    kind: "rolling" | "cumulative";
    frame: number;
  };
};

export type QueryConfigDimension = QueryConfigFieldRef & {
  alias?: string;
  bucket?: "hour" | "day" | "week" | "month" | "quarter" | "year";
  topN?: {
    limit: number;
    includeOthers?: boolean;
  };
};

export type QueryConfigFilterValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>
  | { from?: string | number; to?: string | number };

export type QueryConfigFilter = QueryConfigFieldRef & {
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "between";
  value: QueryConfigFilterValue;
  joinWith?: "and" | "or";
};

export type PreviewFilterClausePayload = {
  leftModelId: string;
  leftFieldId: string;
  operator:
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
  rightType: "value" | "field";
  rightModelId?: string;
  rightFieldId?: string;
  value?: string | number | boolean | null;
  valueKind?: "string" | "number" | "date" | "boolean";
};

export type PreviewOrderRuleDto = {
  id: string;
  source: "model" | "derived";
  modelId?: string | null;
  fieldId: string;
  direction: "asc" | "desc";
};

export type PreviewOrderClausePayload = {
  source: "model" | "derived";
  modelId?: string | null;
  fieldId: string;
  direction?: "asc" | "desc";
};

export type QueryConfigOrderBy = {
  alias: string;
  direction?: "asc" | "desc";
};

export type QueryConfigDerivedField = {
  id: string;
  alias?: string;
  expressionAst: DerivedFieldExpressionAst;
  referencedModels?: string[];
  joinDependencies?: Array<[string, string]>;
  modelGraphSignature?: string | null;
  compiledSqlHash?: string | null;
};

export type QueryConfigTimeRange = {
  field: QueryConfigFieldRef["fieldId"];
  modelId: QueryConfigFieldRef["modelId"];
  range?: { from?: string; to?: string };
  bucket?: "hour" | "day" | "week" | "month" | "quarter" | "year";
  gapFill?: "zero" | "null";
};

export type QueryConfigComparison = {
  mode: "previous" | "wow" | "mom" | "yoy";
  label?: string;
};

export type QueryConfigOptions = {
  allowAsync?: boolean;
  cacheTtlSeconds?: number;
  forceAsync?: boolean;
  templateId?: string | null;
  explain?: boolean;
  anomalyDetection?: {
    method: "zscore";
    threshold?: number;
  };
};

export type QueryConfig = {
  models: string[];
  select?: QueryConfigSelect[];
  metrics?: QueryConfigMetric[];
  dimensions?: QueryConfigDimension[];
  filters?: QueryConfigFilter[];
  orderBy?: QueryConfigOrderBy[];
  derivedFields?: QueryConfigDerivedField[];
  joins?: Array<{
    id: string;
    leftModel: string;
    leftField: string;
    rightModel: string;
    rightField: string;
    joinType?: "inner" | "left" | "right" | "full";
    description?: string;
  }>;
  limit?: number;
  offset?: number;
  time?: QueryConfigTimeRange | null;
  comparisons?: QueryConfigComparison[];
  options?: QueryConfigOptions;
};

export type ReportQuerySuccessResponse = {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  sql: string;
  meta: Record<string, unknown>;
};

export type ReportQueryJobResponse = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  hash?: string;
  queuedAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: Record<string, unknown>;
};

export type ReportQueryResult = ReportQuerySuccessResponse | ReportQueryJobResponse;

export type TemplateScheduleDeliveryTarget = Record<string, unknown>;

export type TemplateScheduleDto = {
  id: string;
  templateId: string;
  cadence: string;
  timezone: string;
  deliveryTargets: TemplateScheduleDeliveryTarget[];
  lastRunAt: string | null;
  nextRunAt: string | null;
  status: string | null;
  meta: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TemplateScheduleListResponse = {
  schedules: TemplateScheduleDto[];
};

export type TemplateSchedulePayload = {
  cadence: string;
  timezone?: string;
  deliveryTargets?: TemplateScheduleDeliveryTarget[];
  status?: string;
  meta?: Record<string, unknown>;
  nextRunAt?: string | null;
};

export type DashboardVisualCardViewConfig = {
  mode: "visual";
  description?: string;
  queryConfig?: QueryConfig | null;
  metricAlias?: string;
  dimensionAlias?: string;
  comparisonAlias?: string;
  visual: {
    id: string;
    name: string;
    type: "line" | "area" | "bar" | "stackedArea" | "stackedBar" | "scatter";
    metric: string;
    metricAggregation: QueryConfigMetric["aggregation"];
    metricLabel: string;
    dimension: string;
    dimensionLabel: string;
    dimensionBucket?: QueryConfigDimension["bucket"];
    comparison?: string;
    comparisonLabel?: string;
    comparisonAggregation?: QueryConfigMetric["aggregation"];
    limit?: number | null;
  };
  sample?: {
    rows: Array<Record<string, unknown>>;
    columns: string[];
  };
};

export type DashboardSpotlightCardViewConfig = {
  mode: "spotlight";
  description?: string;
  spotlight: MetricSpotlightDefinitionDto & {
    metricLabel?: string;
  };
  sample?: {
    cards: Array<{
      id: string;
      label: string;
      value: string;
      delta: string;
      context: string;
      tone: "positive" | "neutral" | "negative";
    }>;
  };
};

export type DashboardLegacyCardViewConfig = Record<string, unknown> & {
  mode?: string;
};

export type DashboardCardViewConfig =
  | DashboardVisualCardViewConfig
  | DashboardSpotlightCardViewConfig
  | DashboardLegacyCardViewConfig
  | null
  | undefined;

export type DashboardCardDto = {
  id: string;
  dashboardId: string;
  templateId: string;
  title: string;
  viewConfig: DashboardCardViewConfig;
  layout: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ReportDashboardDto = {
  id: string;
  name: string;
  description: string | null;
  ownerId: number | null;
  config: Record<string, unknown>;
  filters: Record<string, unknown>;
  shareToken: string | null;
  shareExpiresAt: string | null;
  cards: DashboardCardDto[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type DashboardListResponse = {
  dashboards: ReportDashboardDto[];
};

export type DashboardPayload = {
  name: string;
  description?: string | null;
  config?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  shareToken?: string | null;
  shareExpiresAt?: string | null;
};

export type DashboardCardPayload = {
  templateId: string;
  title: string;
  viewConfig?: DashboardCardViewConfig;
  layout?: Record<string, unknown>;
};

export type DashboardExportResponse = {
  export: {
    format: string;
    generatedAt: string;
    dashboard: ReportDashboardDto;
  };
};

export type HomeDashboardPreferenceDto = {
  viewMode: "navigation" | "dashboard";
  savedDashboardIds: string[];
  activeDashboardId: string | null;
};

export type UpdateHomeDashboardPreferencePayload = Partial<{
  viewMode: HomeDashboardPreferenceDto["viewMode"];
  savedDashboardIds: string[];
  activeDashboardId: string | null;
}>;

export type DerivedFieldExpressionAst =
  | { type: "column"; modelId: string; fieldId: string }
  | { type: "literal"; valueType: "number" | "string" | "boolean"; value: number | string | boolean }
  | { type: "binary"; operator: "+" | "-" | "*" | "/"; left: DerivedFieldExpressionAst; right: DerivedFieldExpressionAst }
  | { type: "unary"; operator: "+" | "-"; argument: DerivedFieldExpressionAst }
  | { type: "function"; name: string; args: DerivedFieldExpressionAst[] };

export type DerivedFieldDto = {
  id: string;
  scope: "workspace" | "template";
  templateId: string | null;
  workspaceId: string | null;
  name: string;
  expression: string;
  kind: "row" | "aggregate";
  metadata: Record<string, unknown>;
  expressionAst?: DerivedFieldExpressionAst | null;
  referencedModels?: string[];
  referencedFields?: Record<string, string[]>;
  joinDependencies?: Array<[string, string]>;
  modelGraphSignature?: string | null;
  compiledSqlHash?: string | null;
  status?: "active" | "stale";
  createdBy: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DerivedFieldListResponse = {
  derivedFields: DerivedFieldDto[];
};

export type DerivedFieldPayload = {
  templateId?: string | null;
  name: string;
  expression: string;
  kind?: "row" | "aggregate";
  scope?: "workspace" | "template";
  metadata?: Record<string, unknown>;
  expressionAst?: DerivedFieldExpressionAst | null;
  referencedModels?: string[];
  referencedFields?: Record<string, string[]>;
  joinDependencies?: Array<[string, string]>;
  modelGraphSignature?: string | null;
  compiledSqlHash?: string | null;
  status?: "active" | "stale";
};

export type DerivedFieldDefinitionDto = {
  id: string;
  name: string;
  expression: string;
  kind: "row" | "aggregate";
  scope: "template" | "workspace";
  metadata?: Record<string, unknown>;
  expressionAst?: DerivedFieldExpressionAst | null;
  referencedModels?: string[];
  referencedFields?: Record<string, string[]>;
  joinDependencies?: Array<[string, string]>;
  modelGraphSignature?: string | null;
  compiledSqlHash?: string | null;
  status?: "active" | "stale";
};

export type MetricSpotlightDefinitionDto = {
  metric: string;
  label: string;
  target?: number;
  comparison?: "previous" | "wow" | "mom" | "yoy";
  format?: "number" | "currency" | "percentage";
};

export type ReportModelFieldResponse = {
  fieldName: string;
  columnName: string;
  type: string;
  allowNull: boolean;
  primaryKey: boolean;
  defaultValue: string | number | boolean | null;
  unique: boolean;
  references?: {
    model: string | null;
    key?: string | null;
  };
};

export type ReportModelAssociationResponse = {
  name: string | null;
  targetModel: string;
  associationType: string;
  foreignKey?: string;
  sourceKey?: string;
  through?: string | null;
  as?: string;
};

export type ReportModelPayload = {
  id: string;
  name: string;
  tableName: string;
  schema?: string;
  description: string;
  connection: string;
  recordCount: string;
  lastSynced: string;
  primaryKeys: string[];
  primaryKey: string | null;
  fields: ReportModelFieldResponse[];
  associations: ReportModelAssociationResponse[];
};

export type ReportModelsResponse = {
  models: ReportModelPayload[];
};

export const useReportModels = () =>
  useQuery<ReportModelsResponse>({
    queryKey: ["reports", "models"],
    queryFn: async () => {
      const response = await axiosInstance.get("/reports/models");
      return response.data as ReportModelsResponse;
    },
    staleTime: 5 * 60 * 1000,
  });

export type ReportPreviewRequest = {
  models: string[];
  fields: Array<{ modelId: string; fieldIds: string[] }>;
  joins?: Array<{
    id: string;
    leftModel: string;
    leftField: string;
    rightModel: string;
    rightField: string;
    joinType?: "inner" | "left" | "right" | "full";
    description?: string;
  }>;
  filters?: Array<string | PreviewFilterClausePayload>;
  orderBy?: PreviewOrderClausePayload[];
  limit?: number;
  derivedFields?: QueryConfigDerivedField[];
};

export type ReportPreviewResponse = {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  sql: string;
};

export const useRunReportPreview = () =>
  useMutation<ReportPreviewResponse, AxiosError<{ message?: string }>, ReportPreviewRequest>({
    mutationFn: async (payload: ReportPreviewRequest) => {
      const response = await axiosInstance.post("/reports/preview", payload);
      return response.data as ReportPreviewResponse;
    },
  });

export type ReportQueryRequest = QueryConfig;

export const useRunReportQuery = () =>
  useMutation<ReportQueryResult, AxiosError<{ message?: string; error?: string }>, ReportQueryRequest>({
    mutationFn: async (payload: ReportQueryRequest) => {
      const response = await axiosInstance.post("/reports/query", payload);
      return response.data as ReportQueryResult;
    },
  });

export const getReportQueryJob = async (jobId: string): Promise<ReportQueryResult> => {
  const response = await axiosInstance.get(`/reports/query/jobs/${jobId}`);
  return response.data as ReportQueryResult;
};

export const useTemplateSchedules = (templateId?: string) =>
  useQuery<TemplateScheduleListResponse>({
    queryKey: ["reports", "templates", templateId, "schedules"],
    enabled: Boolean(templateId),
    queryFn: async () => {
      const response = await axiosInstance.get(`/reports/templates/${templateId}/schedules`);
      return response.data as TemplateScheduleListResponse;
    },
  });

export const useCreateTemplateSchedule = () =>
  useMutation<
    TemplateScheduleDto,
    AxiosError<{ message?: string }>,
    { templateId: string; payload: TemplateSchedulePayload }
  >({
    mutationFn: async ({ templateId, payload }) => {
      const response = await axiosInstance.post(`/reports/templates/${templateId}/schedules`, payload);
      return (response.data as { schedule: TemplateScheduleDto }).schedule;
    },
  });

export const useUpdateTemplateSchedule = () =>
  useMutation<
    TemplateScheduleDto,
    AxiosError<{ message?: string }>,
    { templateId: string; scheduleId: string; payload: Partial<TemplateSchedulePayload> }
  >({
    mutationFn: async ({ templateId, scheduleId, payload }) => {
      const response = await axiosInstance.put(
        `/reports/templates/${templateId}/schedules/${scheduleId}`,
        payload,
      );
      return (response.data as { schedule: TemplateScheduleDto }).schedule;
    },
  });

export const useDeleteTemplateSchedule = () =>
  useMutation<void, AxiosError<{ message?: string }>, { templateId: string; scheduleId: string }>({
    mutationFn: async ({ templateId, scheduleId }) => {
      await axiosInstance.delete(`/reports/templates/${templateId}/schedules/${scheduleId}`);
    },
  });

export const useExportReportTemplate = () =>
  useMutation<unknown, AxiosError<{ message?: string }>, string>({
    mutationFn: async (templateId: string) => {
      const response = await axiosInstance.post(`/reports/templates/${templateId}/export`, {});
      return response.data;
    },
  });

export type UseReportDashboardsOptions = {
  search?: string;
  enabled?: boolean;
};

export const useReportDashboards = ({ search = "", enabled = true }: UseReportDashboardsOptions = {}) => {
  const trimmedSearch = search.trim();
  return useQuery<DashboardListResponse>({
    queryKey: ["reports", "dashboards", trimmedSearch.length > 0 ? trimmedSearch : "all"],
    queryFn: async () => {
      const response = await axiosInstance.get("/reports/dashboards", {
        params: trimmedSearch.length > 0 ? { search: trimmedSearch } : undefined,
      });
      return response.data as DashboardListResponse;
    },
    enabled,
  });
};

export const useCreateDashboard = () =>
  useMutation<ReportDashboardDto, AxiosError<{ message?: string }>, DashboardPayload>({
    mutationFn: async (payload: DashboardPayload) => {
      const response = await axiosInstance.post("/reports/dashboards", payload);
      return (response.data as { dashboard: ReportDashboardDto }).dashboard;
    },
  });

export const useUpdateDashboard = () =>
  useMutation<
    ReportDashboardDto,
    AxiosError<{ message?: string }>,
    { id: string; payload: Partial<DashboardPayload> }
  >({
    mutationFn: async ({ id, payload }) => {
      const response = await axiosInstance.put(`/reports/dashboards/${id}`, payload);
      return (response.data as { dashboard: ReportDashboardDto }).dashboard;
    },
  });

export const useDeleteDashboard = () =>
  useMutation<void, AxiosError<{ message?: string }>, string>({
    mutationFn: async (dashboardId: string) => {
      await axiosInstance.delete(`/reports/dashboards/${dashboardId}`);
    },
  });

export const useUpsertDashboardCard = () =>
  useMutation<
    DashboardCardDto,
    AxiosError<{ message?: string }>,
    { dashboardId: string; cardId?: string; payload: DashboardCardPayload }
  >({
    mutationFn: async ({ dashboardId, cardId, payload }) => {
      const url = cardId
        ? `/reports/dashboards/${dashboardId}/cards/${cardId}`
        : `/reports/dashboards/${dashboardId}/cards`;
      const response = await axiosInstance[cardId ? "put" : "post"](url, payload);
      return (response.data as { card: DashboardCardDto }).card;
    },
  });

export const useDeleteDashboardCard = () =>
  useMutation<void, AxiosError<{ message?: string }>, { dashboardId: string; cardId: string }>({
    mutationFn: async ({ dashboardId, cardId }) => {
      await axiosInstance.delete(`/reports/dashboards/${dashboardId}/cards/${cardId}`);
    },
  });

export const useExportDashboard = () =>
  useMutation<DashboardExportResponse, AxiosError<{ message?: string }>, string>({
    mutationFn: async (dashboardId: string) => {
      const response = await axiosInstance.post(`/reports/dashboards/${dashboardId}/export`, {});
      return response.data as DashboardExportResponse;
    },
  });

export const useHomeDashboardPreference = () =>
  useQuery<HomeDashboardPreferenceDto>({
    queryKey: ["reports", "home-preference"],
    queryFn: async () => {
      const response = await axiosInstance.get("/reports/home-preferences");
      return (response.data as { preference: HomeDashboardPreferenceDto }).preference;
    },
    staleTime: 5 * 60 * 1000,
  });

export const useUpdateHomeDashboardPreference = () =>
  useMutation<
    HomeDashboardPreferenceDto,
    AxiosError<{ message?: string }>,
    UpdateHomeDashboardPreferencePayload
  >({
    mutationFn: async (payload: UpdateHomeDashboardPreferencePayload) => {
      const response = await axiosInstance.put("/reports/home-preferences", payload);
      return (response.data as { preference: HomeDashboardPreferenceDto }).preference;
    },
  });

export const useHomeDashboardPreferenceAdmin = (userId?: number | null) =>
  useQuery<HomeDashboardPreferenceDto>({
    queryKey: ["reports", "home-preference", "admin", userId ?? "none"],
    enabled: typeof userId === "number" && Number.isFinite(userId) && userId > 0,
    queryFn: async () => {
      if (!userId) {
        throw new Error("User id is required");
      }
      const response = await axiosInstance.get(`/reports/home-preferences/${userId}`);
      return (response.data as { preference: HomeDashboardPreferenceDto }).preference;
    },
    staleTime: 5 * 60 * 1000,
  });

export const useUpdateHomeDashboardPreferenceAdmin = () =>
  useMutation<
    HomeDashboardPreferenceDto,
    AxiosError<{ message?: string }>,
    { userId: number; payload: UpdateHomeDashboardPreferencePayload }
  >({
    mutationFn: async ({ userId, payload }) => {
      const response = await axiosInstance.put(`/reports/home-preferences/${userId}`, payload);
      return (response.data as { preference: HomeDashboardPreferenceDto }).preference;
    },
  });

export const useDerivedFields = (templateId?: string) =>
  useQuery<DerivedFieldListResponse>({
    queryKey: ["reports", "derived-fields", templateId ?? "workspace"],
    queryFn: async () => {
      const response = await axiosInstance.get("/reports/derived-fields", {
        params: templateId ? { templateId } : undefined,
      });
      return response.data as DerivedFieldListResponse;
    },
    staleTime: 60 * 1000,
  });

export const useCreateDerivedField = () =>
  useMutation<DerivedFieldDto, AxiosError<{ message?: string }>, DerivedFieldPayload>({
    mutationFn: async (payload: DerivedFieldPayload) => {
      const response = await axiosInstance.post("/reports/derived-fields", payload);
      return (response.data as { derivedField: DerivedFieldDto }).derivedField;
    },
  });

export const useUpdateDerivedField = () =>
  useMutation<
    DerivedFieldDto,
    AxiosError<{ message?: string }>,
    { id: string; payload: Partial<DerivedFieldPayload> }
  >({
    mutationFn: async ({ id, payload }) => {
      const response = await axiosInstance.put(`/reports/derived-fields/${id}`, payload);
      return (response.data as { derivedField: DerivedFieldDto }).derivedField;
    },
  });

export const useDeleteDerivedField = () =>
  useMutation<void, AxiosError<{ message?: string }>, string>({
    mutationFn: async (derivedFieldId: string) => {
      await axiosInstance.delete(`/reports/derived-fields/${derivedFieldId}`);
    },
  });

export type ReportTemplateOptionsDto = {
  autoDistribution: boolean;
  notifyTeam: boolean;
  columnOrder: string[];
  columnAliases: Record<string, string>;
  previewOrder: PreviewOrderRuleDto[];
  autoRunOnOpen: boolean;
};

export type ReportTemplateDto = {
  id: string;
  name: string;
  category: string;
  description: string;
  schedule: string;
  models: string[];
  fields: Array<{ modelId: string; fieldIds: string[] }>;
  joins: unknown[];
  visuals: unknown[];
  metrics: string[];
  filters: unknown[];
  options: ReportTemplateOptionsDto;
  queryConfig: QueryConfig | null;
  derivedFields: DerivedFieldDefinitionDto[];
  metricsSpotlight: MetricSpotlightDefinitionDto[];
  previewOrder: PreviewOrderRuleDto[];
  owner: {
    id: number | null;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
  columnOrder: string[];
  columnAliases: Record<string, string>;
};

export type ReportTemplateListResponse = {
  templates: ReportTemplateDto[];
};

export type SaveReportTemplateRequest = {
  id?: string;
  name: string;
  category: string;
  description: string;
  schedule: string;
  models: string[];
  fields: Array<{ modelId: string; fieldIds: string[] }>;
  joins: unknown[];
  visuals: unknown[];
  metrics: string[];
  filters: unknown[];
  options: ReportTemplateOptionsDto;
  queryConfig?: QueryConfig | null;
  derivedFields?: DerivedFieldDefinitionDto[];
  metricsSpotlight?: MetricSpotlightDefinitionDto[];
  columnOrder?: string[];
  columnAliases?: Record<string, string>;
  previewOrder?: PreviewOrderRuleDto[];
};

export const useReportTemplates = () =>
  useQuery<ReportTemplateListResponse>({
    queryKey: ["reports", "templates"],
    queryFn: async () => {
      const response = await axiosInstance.get("/reports/templates");
      return response.data as ReportTemplateListResponse;
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

export const useSaveReportTemplate = () =>
  useMutation<ReportTemplateDto, AxiosError<{ error?: string; message?: string }>, SaveReportTemplateRequest>({
    mutationFn: async (payload: SaveReportTemplateRequest) => {
      if (payload.id) {
        const response = await axiosInstance.put(`/reports/templates/${payload.id}`, payload);
        return (response.data as { template: ReportTemplateDto }).template;
      }
      const response = await axiosInstance.post("/reports/templates", payload);
      return (response.data as { template: ReportTemplateDto }).template;
    },
  });

export const useDeleteReportTemplate = () =>
  useMutation<void, AxiosError<{ error?: string; message?: string }>, string>({
    mutationFn: async (templateId: string) => {
      await axiosInstance.delete(`/reports/templates/${templateId}`);
    },
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isReportQuerySuccessResponse = (
  result: ReportQueryResult,
): result is ReportQuerySuccessResponse => {
  return Boolean(
    result &&
      typeof result === "object" &&
      Array.isArray((result as ReportQuerySuccessResponse).rows) &&
      Array.isArray((result as ReportQuerySuccessResponse).columns),
  );
};

const isReportQueryJobResponse = (result: ReportQueryResult): result is ReportQueryJobResponse => {
  return Boolean(result && typeof result === "object" && "jobId" in result);
};

type ResolveQueryOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
};

export const resolveReportQueryResult = async (
  result: ReportQueryResult,
  { pollIntervalMs = 1500, timeoutMs = 60_000 }: ResolveQueryOptions = {},
): Promise<ReportQuerySuccessResponse> => {
  if (isReportQuerySuccessResponse(result)) {
    return result;
  }
  if (!isReportQueryJobResponse(result)) {
    throw new Error("Unexpected report query response.");
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(pollIntervalMs);
    const next = await getReportQueryJob(result.jobId);
    if (isReportQuerySuccessResponse(next)) {
      return next;
    }
    if (isReportQueryJobResponse(next) && next.status === "failed") {
      const message =
        (next.error && typeof next.error === "object" && (next.error as { message?: string }).message) ||
        "Dashboard query failed.";
      throw new Error(message);
    }
  }
  throw new Error("Timed out while loading dashboard data.");
};

export const runReportQueryWithPolling = async (
  payload: QueryConfig,
  options?: ResolveQueryOptions,
): Promise<ReportQuerySuccessResponse> => {
  const response = await axiosInstance.post("/reports/query", payload);
  return resolveReportQueryResult(response.data as ReportQueryResult, options);
};






