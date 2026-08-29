export type StaffPayoutReceiptCompactView = {
  id: number;
  status: 'pending' | 'completed' | 'cancelled';
  payoutBatchKey: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  hasPhoto: boolean;
  hasSignature: boolean;
};

type ReceiptSummarySource = {
  id: number;
  status: 'pending' | 'completed' | 'cancelled';
  payoutBatchKey?: string | null;
  confirmedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  photoFileId?: number | null;
  signatureFileId?: number | null;
};

type ReceiptAmountSource = {
  amountMinor: number;
  currencyCode: string;
};

const serializeOptionalDate = (value: Date | string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const buildStaffPayoutReceiptCompactView = (
  receipt: ReceiptSummarySource,
): StaffPayoutReceiptCompactView => ({
  id: receipt.id,
  status: receipt.status,
  payoutBatchKey: receipt.payoutBatchKey ?? null,
  confirmedAt: serializeOptionalDate(receipt.confirmedAt),
  cancelledAt: serializeOptionalDate(receipt.cancelledAt),
  hasPhoto: Boolean(receipt.photoFileId),
  hasSignature: Boolean(receipt.signatureFileId),
});

export const buildStaffPayoutReceiptTotals = (
  items: ReceiptAmountSource[],
): Array<{ amountMinor: number; amount: number; currency: string }> => {
  const totalsByCurrency = new Map<string, number>();
  items.forEach((item) => {
    const currency = item.currencyCode.trim().toUpperCase();
    if (!currency || !Number.isFinite(item.amountMinor)) {
      return;
    }
    totalsByCurrency.set(currency, (totalsByCurrency.get(currency) ?? 0) + item.amountMinor);
  });
  return Array.from(totalsByCurrency.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amountMinor]) => ({
      amountMinor,
      amount: amountMinor / 100,
      currency,
    }));
};
