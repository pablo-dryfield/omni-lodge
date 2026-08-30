import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";
import type {
  VolunteerFundAdjustmentPayload,
  VolunteerFundLedgerEntry,
  VolunteerFundLedgerFilters,
  VolunteerFundLedgerResponse,
  VolunteerFundListResponse,
  VolunteerFundPayload,
  VolunteerFundReversalPayload,
  VolunteerFundSpendPayload,
  VolunteerFundSummary,
} from "../types/finance";

export const volunteerFundsQueryKey = ["finance", "volunteer-funds"] as const;

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeFund = (value: unknown): VolunteerFundSummary => {
  const fund = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const linkedAccount = fund.linkedAccount && typeof fund.linkedAccount === "object"
    ? (fund.linkedAccount as Record<string, unknown>)
    : null;
  const expenseCategory = fund.expenseCategory && typeof fund.expenseCategory === "object"
    ? (fund.expenseCategory as Record<string, unknown>)
    : null;
  return {
    ...(fund as unknown as VolunteerFundSummary),
    id: toFiniteNumber(fund.id),
    name: typeof fund.name === "string" ? fund.name : "Volunteer Fund",
    currency: typeof fund.currency === "string" ? fund.currency : "PLN",
    description: typeof fund.description === "string" ? fund.description : null,
    linkedAccountId: toFiniteNumber(fund.linkedAccountId, 0) || null,
    linkedAccountName: typeof linkedAccount?.name === "string" ? linkedAccount.name : null,
    expenseCategoryId: toFiniteNumber(fund.expenseCategoryId, 0) || null,
    expenseCategoryName: typeof expenseCategory?.name === "string" ? expenseCategory.name : null,
    balanceMinor: toFiniteNumber(fund.balanceMinor ?? fund.currentBalanceMinor),
    allocationTotalMinor: toFiniteNumber(
      fund.allocationTotalMinor ?? fund.allocationsMinor ?? fund.allocatedMinor ?? fund.totalAllocatedMinor,
    ),
    spendTotalMinor: toFiniteNumber(fund.spendTotalMinor ?? fund.spendMinor ?? fund.spentMinor ?? fund.totalSpentMinor),
    adjustmentTotalMinor: toFiniteNumber(
      fund.adjustmentTotalMinor ?? fund.adjustmentsMinor ?? fund.adjustedMinor ?? fund.totalAdjustedMinor,
    ),
    isActive: fund.isActive !== false,
  };
};

const joinedPersonName = (value: unknown): string | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const person = value as { firstName?: unknown; lastName?: unknown };
  const name = [person.firstName, person.lastName]
    .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
    .map((part) => part.trim())
    .join(" ");
  return name || null;
};

const joinedRecordName = (value: unknown): string | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
};

const normalizeEntry = (value: unknown): VolunteerFundLedgerEntry => {
  const entry = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const sourceSnapshot = entry.sourceSnapshot && typeof entry.sourceSnapshot === "object"
    ? (entry.sourceSnapshot as Record<string, unknown>)
    : null;
  const reversalEntry = entry.reversalEntry && typeof entry.reversalEntry === "object"
    ? (entry.reversalEntry as Record<string, unknown>)
    : null;
  return {
    ...(entry as unknown as VolunteerFundLedgerEntry),
    id: toFiniteNumber(entry.id),
    fundId: toFiniteNumber(entry.fundId),
    entryType: entry.entryType as VolunteerFundLedgerEntry["entryType"],
    date: String(entry.date ?? entry.entryDate ?? ""),
    amountMinor: toFiniteNumber(entry.amountMinor ?? entry.signedAmountMinor),
    runningBalanceMinor:
      entry.runningBalanceMinor == null ? null : toFiniteNumber(entry.runningBalanceMinor),
    currency: typeof entry.currency === "string" ? entry.currency : "PLN",
    description: typeof entry.description === "string" ? entry.description : null,
    staffUserId: toFiniteNumber(entry.staffUserId ?? entry.attributedStaffUserId, 0) || null,
    staffName: (entry.staffName as string | null | undefined) ?? joinedPersonName(entry.attributedStaffUser),
    compensationComponentId: toFiniteNumber(entry.compensationComponentId, 0) || null,
    compensationComponentName:
      (entry.compensationComponentName as string | null | undefined) ?? joinedRecordName(entry.compensationComponent),
    financeTransactionId: toFiniteNumber(entry.financeTransactionId, 0) || null,
    financeLinkMode:
      sourceSnapshot?.financeLinkMode === "created" || sourceSnapshot?.financeLinkMode === "existing"
        ? sourceSnapshot.financeLinkMode
        : null,
    sourceEntryId: toFiniteNumber(entry.sourceEntryId ?? entry.reversalOfEntryId, 0) || null,
    reversedByEntryId: toFiniteNumber(entry.reversedByEntryId ?? reversalEntry?.id, 0) || null,
    isReversed: entry.isReversed === true || Boolean(reversalEntry),
    createdByName: (entry.createdByName as string | null | undefined) ?? null,
    createdAt: String(entry.createdAt ?? ""),
  };
};

const extractFunds = (payload: unknown): VolunteerFundSummary[] => {
  if (Array.isArray(payload)) {
    return payload.map(normalizeFund);
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.funds)) {
    return record.funds.map(normalizeFund);
  }
  if (Array.isArray(record.data)) {
    return record.data.map(normalizeFund);
  }
  return [];
};

const extractLedger = (payload: unknown): VolunteerFundLedgerResponse => {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const paginationSource = record.pagination && typeof record.pagination === "object"
    ? (record.pagination as Record<string, unknown>)
    : {};
  const filterSource = record.filters && typeof record.filters === "object"
    ? (record.filters as Record<string, unknown>)
    : {};
  const fundSource = {
    ...((record.fund && typeof record.fund === "object" ? record.fund : {}) as Record<string, unknown>),
    ...((record.summary && typeof record.summary === "object" ? record.summary : {}) as Record<string, unknown>),
  };
  const fund = normalizeFund(fundSource);
  const entries = Array.isArray(record.entries)
    ? record.entries.map(normalizeEntry)
    : Array.isArray(record.data)
      ? record.data.map(normalizeEntry)
      : [];
  const limit = toFiniteNumber(paginationSource.limit, entries.length || 100);
  const offset = toFiniteNumber(paginationSource.offset);
  const total = toFiniteNumber(paginationSource.total, entries.length);
  return {
    fund,
    entries,
    pagination: {
      limit,
      offset,
      total,
      hasMore: paginationSource.hasMore === true || offset + entries.length < total,
    },
    filters: {
      startDate: typeof filterSource.startDate === "string" ? filterSource.startDate : null,
      endDate: typeof filterSource.endDate === "string" ? filterSource.endDate : null,
      entryType:
        typeof filterSource.entryType === "string"
          ? (filterSource.entryType as VolunteerFundLedgerEntry["entryType"])
          : null,
    },
  };
};

export const useVolunteerFunds = () =>
  useQuery<VolunteerFundListResponse>({
    queryKey: volunteerFundsQueryKey,
    queryFn: async () => {
      const response = await axiosInstance.get("/finance/volunteer-funds");
      return { funds: extractFunds(response.data) };
    },
  });

export const useVolunteerFundLedger = (
  fundId: number | null,
  filters: VolunteerFundLedgerFilters,
) =>
  useQuery<VolunteerFundLedgerResponse>({
    queryKey: [...volunteerFundsQueryKey, fundId, "ledger", filters],
    queryFn: async () => {
      const response = await axiosInstance.get(`/finance/volunteer-funds/${fundId}/ledger`, { params: filters });
      return extractLedger(response.data);
    },
    enabled: fundId != null,
  });

const useInvalidateVolunteerFunds = () => {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: volunteerFundsQueryKey });
  };
};

export const useCreateVolunteerFund = () => {
  const invalidate = useInvalidateVolunteerFunds();
  return useMutation<VolunteerFundSummary, unknown, VolunteerFundPayload>({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/finance/volunteer-funds", payload);
      return normalizeFund(response.data?.fund ?? response.data);
    },
    onSuccess: invalidate,
  });
};

export const useUpdateVolunteerFund = () => {
  const invalidate = useInvalidateVolunteerFunds();
  return useMutation<VolunteerFundSummary, unknown, { id: number; changes: Partial<VolunteerFundPayload> }>({
    mutationFn: async ({ id, changes }) => {
      const response = await axiosInstance.put(`/finance/volunteer-funds/${id}`, changes);
      return normalizeFund(response.data?.fund ?? response.data);
    },
    onSuccess: invalidate,
  });
};

export const useCreateVolunteerFundAdjustment = () => {
  const invalidate = useInvalidateVolunteerFunds();
  return useMutation<VolunteerFundLedgerEntry, unknown, { fundId: number; payload: VolunteerFundAdjustmentPayload }>({
    mutationFn: async ({ fundId, payload }) => {
      const response = await axiosInstance.post(`/finance/volunteer-funds/${fundId}/adjustments`, payload);
      return normalizeEntry(response.data?.entry ?? response.data);
    },
    onSuccess: invalidate,
  });
};

export const useCreateVolunteerFundSpend = () => {
  const invalidate = useInvalidateVolunteerFunds();
  return useMutation<VolunteerFundLedgerEntry, unknown, { fundId: number; payload: VolunteerFundSpendPayload }>({
    mutationFn: async ({ fundId, payload }) => {
      const response = await axiosInstance.post(`/finance/volunteer-funds/${fundId}/spend`, payload);
      return normalizeEntry(response.data?.entry ?? response.data);
    },
    onSuccess: invalidate,
  });
};

export const useReverseVolunteerFundEntry = () => {
  const invalidate = useInvalidateVolunteerFunds();
  return useMutation<
    VolunteerFundLedgerEntry,
    unknown,
    { fundId: number; entryId: number; payload: VolunteerFundReversalPayload }
  >({
    mutationFn: async ({ fundId, entryId, payload }) => {
      const response = await axiosInstance.post(
        `/finance/volunteer-funds/${fundId}/entries/${entryId}/reversal`,
        payload,
      );
      return normalizeEntry(response.data?.entry ?? response.data);
    },
    onSuccess: invalidate,
  });
};
