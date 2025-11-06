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

export type QueryConfigOrderBy = {
  alias: string;
  direction?: "asc" | "desc";
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

export type DerivedFieldDefinitionDto = {
  id: string;
  name: string;
  expression: string;
  kind: "row" | "aggregate";
  scope: "template" | "workspace";
  metadata?: Record<string, unknown>;
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
  filters?: string[];
  limit?: number;
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

export type ReportTemplateOptionsDto = {
  autoDistribution: boolean;
  notifyTeam: boolean;
  columnOrder: string[];
  columnAliases: Record<string, string>;
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
