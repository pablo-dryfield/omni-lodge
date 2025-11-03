import { useMutation } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";

export type SqlStatementType = "read" | "update" | "delete";

export type SqlHelperResponse = {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  rowCount: number;
  truncated: boolean;
  affectedCount: number;
  durationMs: number;
  statementType: SqlStatementType;
};

export const useExecuteSql = () =>
  useMutation<SqlHelperResponse, unknown, { query: string }>({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/sql-helper/execute", payload);
      return response.data as SqlHelperResponse;
    },
  });
