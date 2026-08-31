import type { FinanceTransaction } from "../../types/finance";

export type ManualExpenseStatus = "paid" | "awaiting_reimbursement";

export const isManualExpenseStatus = (
  status: FinanceTransaction["status"],
): status is ManualExpenseStatus => (
  status === "paid" || status === "awaiting_reimbursement"
);

export const readTransactionPaidByUserId = (meta: unknown): number | null => {
  if (!meta || typeof meta !== "object") {
    return null;
  }
  const record = meta as Record<string, unknown>;
  const candidate = record.paidByUserId ?? record.staffUserId ?? null;
  if (candidate == null) {
    return null;
  }
  const numeric = Number(candidate);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
};

export const writeTransactionPaidByUserId = (
  meta: Record<string, unknown> | null,
  userId: number | null,
): Record<string, unknown> | null => {
  const next = { ...(meta ?? {}) };
  delete next.staffUserId;
  if (Number.isInteger(userId) && Number(userId) > 0) {
    next.paidByUserId = Number(userId);
  } else {
    delete next.paidByUserId;
  }
  return Object.keys(next).length > 0 ? next : null;
};

export const buildPaidBySelectionChange = (
  meta: Record<string, unknown> | null,
  userId: number | null,
): Pick<FinanceTransaction, "status"> & { meta: Record<string, unknown> | null } => {
  const normalizedUserId = Number.isInteger(userId) && Number(userId) > 0
    ? Number(userId)
    : null;
  return {
    status: normalizedUserId ? "awaiting_reimbursement" : "paid",
    meta: writeTransactionPaidByUserId(meta, normalizedUserId),
  };
};

export const validateManualExpensePayment = (
  status: ManualExpenseStatus,
  paidByUserId: number | null,
  isKnownStaffUser: boolean,
): string | null => {
  if (status === "awaiting_reimbursement" && (!paidByUserId || !isKnownStaffUser)) {
    return "Select the staff member who paid this expense personally.";
  }
  if (status === "paid" && paidByUserId) {
    return "An expense paid by a staff member must be awaiting reimbursement.";
  }
  return null;
};

export const hasManualPaymentStateChanged = (
  currentStatus: FinanceTransaction["status"],
  currentPaidByUserId: number | null,
  originalStatus: FinanceTransaction["status"],
  originalPaidByUserId: number | null,
): boolean => (
  currentStatus !== originalStatus || currentPaidByUserId !== originalPaidByUserId
);
