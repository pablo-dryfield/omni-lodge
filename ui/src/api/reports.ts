import { useQuery } from "@tanstack/react-query";
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
