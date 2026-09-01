import axiosInstance from "../utils/axiosInstance";
import type {
  FinanceRecurringOccurrenceListResponse,
  FinanceTransaction,
} from "../types/finance";

const withCredentials = { withCredentials: true as const };

const asTransaction = (value: unknown): FinanceTransaction => {
  const candidate = value && typeof value === "object" && "transaction" in value
    ? (value as { transaction: unknown }).transaction
    : value && typeof value === "object" && "data" in value
      ? (value as { data: unknown }).data
      : value;
  if (!candidate || typeof candidate !== "object" || !("id" in candidate)) {
    throw new Error("The recurring occurrence response did not include a transaction.");
  }
  return candidate as FinanceTransaction;
};

export const normalizeRecurringOccurrenceList = (
  value: unknown,
  requestedLimit = 10,
  requestedOffset = 0,
): FinanceRecurringOccurrenceListResponse => {
  if (Array.isArray(value)) {
    return {
      data: value as FinanceTransaction[],
      meta: { count: value.length, limit: requestedLimit, offset: requestedOffset },
    };
  }
  if (!value || typeof value !== "object") {
    throw new Error("The recurring occurrence history response was invalid.");
  }
  const response = value as {
    data?: unknown;
    items?: unknown;
    transactions?: unknown;
    meta?: { count?: unknown; limit?: unknown; offset?: unknown };
    pagination?: { total?: unknown; limit?: unknown; offset?: unknown };
  };
  const rows = Array.isArray(response.data)
    ? response.data
    : Array.isArray(response.items)
      ? response.items
    : Array.isArray(response.transactions)
      ? response.transactions
      : null;
  if (!rows) {
    throw new Error("The recurring occurrence history response did not include transactions.");
  }
  return {
    data: rows as FinanceTransaction[],
    meta: {
      count: Number.isSafeInteger(Number(response.meta?.count ?? response.pagination?.total))
        ? Number(response.meta?.count ?? response.pagination?.total)
        : rows.length,
      limit: Number.isSafeInteger(Number(response.meta?.limit ?? response.pagination?.limit))
        ? Number(response.meta?.limit ?? response.pagination?.limit)
        : requestedLimit,
      offset: Number.isSafeInteger(Number(response.meta?.offset ?? response.pagination?.offset))
        ? Number(response.meta?.offset ?? response.pagination?.offset)
        : requestedOffset,
    },
  };
};

export const getFinanceRecurringOccurrences = async (
  ruleId: number,
  limit = 10,
  offset = 0,
): Promise<FinanceRecurringOccurrenceListResponse> => {
  const response = await axiosInstance.get(
    `/finance/recurring-rules/${ruleId}/occurrences`,
    { ...withCredentials, params: { limit, offset } },
  );
  return normalizeRecurringOccurrenceList(response.data, limit, offset);
};

export const postFinanceRecurringOccurrence = async (
  ruleId: number,
  transactionId: number,
): Promise<FinanceTransaction> => {
  const response = await axiosInstance.post(
    `/finance/recurring-rules/${ruleId}/occurrences/${transactionId}/post`,
    {},
    withCredentials,
  );
  return asTransaction(response.data);
};

export const voidFinanceRecurringOccurrence = async (
  ruleId: number,
  transactionId: number,
): Promise<FinanceTransaction> => {
  const response = await axiosInstance.post(
    `/finance/recurring-rules/${ruleId}/occurrences/${transactionId}/void`,
    {},
    withCredentials,
  );
  return asTransaction(response.data);
};
