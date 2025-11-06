import { useMutation, useQuery } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import axiosInstance from "../utils/axiosInstance";

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

export type ReportTemplateOptionsDto = {
  autoDistribution: boolean;
  notifyTeam: boolean;
  columnOrder?: string[];
  columnAliases?: Record<string, string>;
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
  owner: {
    id: number | null;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
  columnOrder?: string[];
  columnAliases?: Record<string, string>;
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
