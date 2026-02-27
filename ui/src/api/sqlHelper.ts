import { useMutation } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";

export type SqlStatementType = "read" | "write";

export type SqlStatementResult = {
  index: number;
  statement: string;
  statementType: SqlStatementType;
  rows: Array<Record<string, unknown>>;
  columns: string[];
  rowCount: number;
  truncated: boolean;
  affectedCount: number;
};

export type SqlHelperResponse = {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  rowCount: number;
  truncated: boolean;
  affectedCount: number;
  durationMs: number;
  statementType: SqlStatementType;
  statementCount?: number;
  results?: SqlStatementResult[];
};

export const useExecuteSql = () =>
  useMutation<SqlHelperResponse, unknown, { query: string }>({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/sql-helper/execute", payload);
      return response.data as SqlHelperResponse;
    },
  });
