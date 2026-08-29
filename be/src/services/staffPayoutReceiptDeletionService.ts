export type StaffPayoutReceiptDeletionItem = {
  collectionLogId: number | null;
  financeTransactionId: number | null;
  label: string;
  amountMinor: number;
  currencyCode: string;
};

export type StaffPayoutReceiptReissueItem = {
  collectionLogId: number;
  financeTransactionId: number | null;
  label: string;
  amountMinor: number;
  currencyCode: string;
};

/**
 * Builds the live item snapshot for a replacement receipt after payout rows are
 * removed. Historical items already detached from their collection log are
 * intentionally excluded so a cancelled receipt can never be reissued from
 * snapshot-only references.
 */
export const buildStaffPayoutReceiptReissueItems = (
  items: StaffPayoutReceiptDeletionItem[],
  deletedCollectionLogIds: Iterable<number>,
): StaffPayoutReceiptReissueItem[] => {
  const deletedIds = new Set(deletedCollectionLogIds);

  return items.flatMap((item) => {
    if (item.collectionLogId == null || deletedIds.has(item.collectionLogId)) {
      return [];
    }
    return [{
      collectionLogId: item.collectionLogId,
      financeTransactionId: item.financeTransactionId,
      label: item.label,
      amountMinor: Number(item.amountMinor),
      currencyCode: item.currencyCode,
    }];
  });
};
