import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import type { FinanceTransaction } from "../types/finance";
import axiosInstance from "../utils/axiosInstance";

export type PlannedExpenseDueState = "overdue" | "due_today" | "upcoming";

export type HomePlannedExpense = FinanceTransaction & {
  dueState: PlannedExpenseDueState;
};

export type PlannedExpenseCurrencySummary = {
  currency: string;
  totalMinor: number;
  overdueMinor: number;
  dueTodayMinor: number;
  upcomingMinor: number;
};

export type HomePlannedExpensesResponse = {
  data: HomePlannedExpense[];
  summary: {
    counts: {
      total: number;
      overdue: number;
      dueToday: number;
      upcoming: number;
    };
    amountsByCurrency: PlannedExpenseCurrencySummary[];
  };
  options: {
    eligiblePayers?: Array<{
      userId: number;
      fullName: string;
    }>;
  };
  meta: {
    count: number;
    limit: number;
    offset: number;
    today: string;
    timezone: string;
    timing: "all" | PlannedExpenseDueState;
  };
};

export type PlannedExpenseAction = "pay" | "staff_paid";

export type PlannedExpenseActionPayload = {
  id: number;
  action: PlannedExpenseAction;
  paymentDate?: string;
  paidByUserId?: number;
};

export const HOME_PLANNED_EXPENSES_QUERY_KEY = ["finance", "home", "planned-expenses"] as const;

const shouldRetry = (failureCount: number, error: AxiosError): boolean => {
  const status = error.response?.status;
  if (status === 401 || status === 403) {
    return false;
  }
  return failureCount < 1;
};

export const useHomePlannedExpenses = ({
  enabled,
  limit = 8,
}: {
  enabled: boolean;
  limit?: number;
}) => useQuery<HomePlannedExpensesResponse, AxiosError>({
  queryKey: [...HOME_PLANNED_EXPENSES_QUERY_KEY, limit],
  queryFn: async () => {
    const response = await axiosInstance.get<HomePlannedExpensesResponse>(
      "/finance/transactions/planned-expenses",
      { params: { limit, offset: 0, timing: "all" } },
    );
    return response.data;
  },
  enabled,
  retry: shouldRetry,
  staleTime: 60_000,
  refetchOnMount: "always",
  refetchOnWindowFocus: false,
});

export const usePlannedExpenseAction = () => {
  const queryClient = useQueryClient();
  return useMutation<HomePlannedExpense, AxiosError, PlannedExpenseActionPayload>({
    mutationFn: async ({ id, ...payload }) => {
      const response = await axiosInstance.post<{ data: HomePlannedExpense }>(
        `/finance/transactions/${id}/planned-expense-action`,
        payload,
      );
      return response.data.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: HOME_PLANNED_EXPENSES_QUERY_KEY });
    },
  });
};
