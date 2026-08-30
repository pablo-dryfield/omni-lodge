import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";
import type {
  FinanceSettlementRule,
  FinanceSettlementRuleBulkPayload,
  FinanceSettlementRuleListResponse,
  FinanceSettlementRulePayload,
} from "../types/finance";

export const settlementRulesQueryKey = ["finance", "settlement-rules"] as const;

const extractRules = (payload: unknown): FinanceSettlementRule[] => {
  if (Array.isArray(payload)) {
    return payload as FinanceSettlementRule[];
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.rules)) {
    return record.rules as FinanceSettlementRule[];
  }
  if (Array.isArray(record.data)) {
    return record.data as FinanceSettlementRule[];
  }
  return [];
};

const normalizeRule = (rule: FinanceSettlementRule & Record<string, unknown>): FinanceSettlementRule => ({
  ...rule,
  targetScope: (rule.targetScope ?? rule.scope) as FinanceSettlementRule["targetScope"],
  matchKind: (rule.matchKind ?? rule.sourceKind) as FinanceSettlementRule["matchKind"],
  matchKey: (rule.matchKey ?? rule.componentCategory ?? rule.specialSource ?? null) as string | null,
  fundId: Number(rule.fundId ?? rule.volunteerFundId) || null,
  userName: (rule.userName ?? formatJoinedName(rule.targetUser) ?? null) as string | null,
  componentName: (rule.componentName ?? readJoinedName(rule.component) ?? null) as string | null,
  fundName: (rule.fundName ?? rule.volunteerFundName ?? readJoinedName(rule.fund) ?? null) as string | null,
});

function readJoinedName(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function formatJoinedName(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { firstName?: unknown; lastName?: unknown };
  const name = [record.firstName, record.lastName]
    .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
    .map((part) => part.trim())
    .join(" ");
  return name || null;
}

const normalizeRules = (rules: FinanceSettlementRule[]) =>
  rules.map((rule) => normalizeRule(rule as FinanceSettlementRule & Record<string, unknown>));

export const useFinanceSettlementRules = () =>
  useQuery<FinanceSettlementRuleListResponse>({
    queryKey: settlementRulesQueryKey,
    queryFn: async () => {
      const response = await axiosInstance.get("/finance/settlement-rules");
      return { rules: normalizeRules(extractRules(response.data)) };
    },
  });

export const useCreateFinanceSettlementRule = () => {
  const queryClient = useQueryClient();
  return useMutation<FinanceSettlementRule, unknown, FinanceSettlementRulePayload>({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/finance/settlement-rules", payload);
      return normalizeRule((response.data?.rule ?? response.data) as FinanceSettlementRule & Record<string, unknown>);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: settlementRulesQueryKey });
    },
  });
};

export const useUpdateFinanceSettlementRule = () => {
  const queryClient = useQueryClient();
  return useMutation<
    FinanceSettlementRule,
    unknown,
    { id: number; changes: Partial<FinanceSettlementRulePayload> }
  >({
    mutationFn: async ({ id, changes }) => {
      const response = await axiosInstance.put(`/finance/settlement-rules/${id}`, changes);
      return normalizeRule((response.data?.rule ?? response.data) as FinanceSettlementRule & Record<string, unknown>);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: settlementRulesQueryKey });
    },
  });
};

export const useBulkUpdateFinanceSettlementRules = () => {
  const queryClient = useQueryClient();
  return useMutation<FinanceSettlementRule[], unknown, FinanceSettlementRuleBulkPayload>({
    mutationFn: async (payload) => {
      const response = await axiosInstance.put("/finance/settlement-rules/bulk", payload);
      return normalizeRules(extractRules(response.data));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: settlementRulesQueryKey });
    },
  });
};

export const useDeleteFinanceSettlementRule = () => {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: async (id) => {
      await axiosInstance.delete(`/finance/settlement-rules/${id}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: settlementRulesQueryKey });
    },
  });
};
