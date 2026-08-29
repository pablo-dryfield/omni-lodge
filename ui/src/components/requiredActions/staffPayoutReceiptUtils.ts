import type { StaffPayoutReceiptPayload } from "../../api/requiredActions";

export type NormalizedStaffPayoutReceipt = StaffPayoutReceiptPayload & {
  id: number;
  amount: number;
  acknowledgedAmount: string;
  currency: string;
};

export const normalizeStaffPayoutReceipt = (
  payload?: StaffPayoutReceiptPayload,
): NormalizedStaffPayoutReceipt | null => {
  if (!payload) {
    return null;
  }
  const id = Number(payload.id);
  const amountMinor = Number(payload.amountMinor);
  const amountFromMajor = Number(payload.amount);
  const amount =
    Number.isInteger(amountMinor) && amountMinor > 0
      ? amountMinor / 100
      : Number.isFinite(amountFromMajor) && amountFromMajor > 0
        ? amountFromMajor
        : Number.NaN;
  const currency = typeof payload.currency === "string" ? payload.currency.trim().toUpperCase() : "";
  if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(amount) || amount <= 0 || !currency) {
    return null;
  }
  return {
    ...payload,
    id,
    amount,
    acknowledgedAmount: amount.toFixed(2),
    currency,
  };
};

export const formatPayoutReceiptAmount = (receipt: NormalizedStaffPayoutReceipt): string =>
  `${receipt.currency} ${receipt.amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
