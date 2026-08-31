export type VolunteerFundEntryType = "allocation" | "spend" | "adjustment" | "reversal";

export interface VolunteerFundSummary {
  id: number;
  name: string;
  currency: string;
  description: string | null;
  fundingSourceAccountId: number | null;
  fundingSourceAccountName?: string | null;
  linkedAccountId: number | null;
  linkedAccountName?: string | null;
  expenseCategoryId: number | null;
  expenseCategoryName?: string | null;
  balanceMinor: number;
  allocationTotalMinor: number;
  spendTotalMinor: number;
  adjustmentTotalMinor: number;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface VolunteerFundLedgerEntry {
  id: number;
  fundId: number;
  entryType: VolunteerFundEntryType;
  date: string;
  /** Signed ledger value: allocations/positive adjustments are positive; spend is negative. */
  amountMinor: number;
  signedAmountMinor?: number;
  runningBalanceMinor: number | null;
  currency: string;
  description: string | null;
  staffUserId: number | null;
  staffName?: string | null;
  compensationComponentId: number | null;
  compensationComponentName?: string | null;
  financeTransactionId: number | null;
  financeLinkMode: "created" | "existing" | null;
  sourceEntryId: number | null;
  reversedByEntryId: number | null;
  isReversed: boolean;
  createdByName?: string | null;
  createdAt: string;
}

export type VolunteerFundPayload = {
  name: string;
  currency: string;
  description?: string | null;
  fundingSourceAccountId?: number | null;
  linkedAccountId?: number | null;
  expenseCategoryId?: number | null;
  isActive?: boolean;
};

export type VolunteerFundLedgerFilters = {
  startDate?: string;
  endDate?: string;
  entryType?: VolunteerFundEntryType;
  limit?: number;
  offset?: number;
};

export type VolunteerFundAdjustmentPayload = {
  entryDate: string;
  amountMinor: number;
  description: string;
  idempotencyKey: string;
};

type VolunteerFundSpendBasePayload = {
  entryDate: string;
  amountMinor: number;
  description: string;
  idempotencyKey: string;
};

export type VolunteerFundSpendPayload = VolunteerFundSpendBasePayload & (
  | {
      financeTransactionId: number;
      accountId?: never;
      categoryId?: never;
      vendorId?: never;
      invoiceFileId?: never;
    }
  | {
      financeTransactionId?: null;
      accountId: number;
      categoryId: number;
      vendorId: number;
      invoiceFileId?: number | null;
    }
);

export type VolunteerFundReversalPayload = {
  entryDate: string;
  reason: string;
};

export type VolunteerFundListResponse = {
  funds: VolunteerFundSummary[];
};

export type VolunteerFundLedgerResponse = {
  fund: VolunteerFundSummary;
  entries: VolunteerFundLedgerEntry[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  filters: {
    startDate: string | null;
    endDate: string | null;
    entryType: VolunteerFundEntryType | null;
  };
};
