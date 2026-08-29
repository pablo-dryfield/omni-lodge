import type {
  PayPayoutReceiptDetail,
  PayPayoutReceiptHistoryEntry,
  PayRecordedEntryReceipt,
} from '../types/pays/Pay';

export type PayReceiptStatusMeta = {
  label: string;
  color: 'gray' | 'orange' | 'teal' | 'red';
};

export const getPayReceiptStatusMeta = (
  receipt: Pick<PayRecordedEntryReceipt, 'status'> | null | undefined,
): PayReceiptStatusMeta => {
  if (!receipt) {
    return { label: 'No receipt request', color: 'gray' };
  }
  if (receipt.status === 'completed') {
    return { label: 'Receipt confirmed', color: 'teal' };
  }
  if (receipt.status === 'cancelled') {
    return { label: 'Receipt cancelled', color: 'red' };
  }
  return { label: 'Receipt pending', color: 'orange' };
};

export const canOpenPayReceipt = (
  receipt: PayRecordedEntryReceipt | null | undefined,
): receipt is PayRecordedEntryReceipt => Boolean(receipt?.id);

export const getPayReceiptHistoryStatusMeta = (
  receipt: Pick<PayPayoutReceiptHistoryEntry, 'status' | 'isCurrent'>,
): PayReceiptStatusMeta => {
  if (receipt.status === 'cancelled' && !receipt.isCurrent) {
    return { label: 'Superseded receipt', color: 'red' };
  }
  return getPayReceiptStatusMeta(receipt);
};

export const getPayReceiptHistoryEvent = (
  receipt: Pick<
    PayPayoutReceiptHistoryEntry,
    'status' | 'confirmedAt' | 'cancelledAt' | 'createdAt'
  >,
): { label: 'Confirmed' | 'Cancelled' | 'Created'; at: string } => {
  if (receipt.status === 'cancelled') {
    return {
      label: 'Cancelled',
      at: receipt.cancelledAt ?? receipt.confirmedAt ?? receipt.createdAt,
    };
  }
  if (receipt.confirmedAt) {
    return { label: 'Confirmed', at: receipt.confirmedAt };
  }
  return { label: 'Created', at: receipt.createdAt };
};

export type PayReceiptHistoryLookupParams =
  | { batchKey: string }
  | { staffUserId: number; startDate: string; endDate: string };

export const buildPayReceiptHistoryLookupParams = (
  receipt: Pick<
    PayPayoutReceiptDetail,
    'payoutBatchKey' | 'staffUserId' | 'rangeStart' | 'rangeEnd'
  >,
): PayReceiptHistoryLookupParams => {
  const batchKey = receipt.payoutBatchKey?.trim();
  if (batchKey) {
    return { batchKey };
  }
  return {
    staffUserId: receipt.staffUserId,
    startDate: receipt.rangeStart,
    endDate: receipt.rangeEnd,
  };
};
