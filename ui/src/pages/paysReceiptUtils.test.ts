import {
  buildPayReceiptHistoryLookupParams,
  canOpenPayReceipt,
  getPayReceiptHistoryEvent,
  getPayReceiptHistoryStatusMeta,
  getPayReceiptStatusMeta,
} from './paysReceiptUtils';
import type {
  PayPayoutReceiptDetail,
  PayPayoutReceiptHistoryEntry,
  PayRecordedEntryReceipt,
} from '../types/pays/Pay';

const makeReceipt = (
  overrides: Partial<PayRecordedEntryReceipt> = {},
): PayRecordedEntryReceipt => ({
  id: 12,
  status: 'pending',
  payoutBatchKey: 'batch-12',
  confirmedAt: null,
  cancelledAt: null,
  hasPhoto: false,
  hasSignature: false,
  ...overrides,
});

describe('payout receipt presentation', () => {
  it('distinguishes legacy, pending, completed, and cancelled receipts', () => {
    expect(getPayReceiptStatusMeta(null)).toEqual({ label: 'No receipt request', color: 'gray' });
    expect(getPayReceiptStatusMeta(makeReceipt())).toEqual({ label: 'Receipt pending', color: 'orange' });
    expect(getPayReceiptStatusMeta(makeReceipt({ status: 'completed' }))).toEqual({
      label: 'Receipt confirmed',
      color: 'teal',
    });
    expect(getPayReceiptStatusMeta(makeReceipt({ status: 'cancelled' }))).toEqual({
      label: 'Receipt cancelled',
      color: 'red',
    });
  });

  it('only opens evidence for entries linked to a receipt', () => {
    expect(canOpenPayReceipt(null)).toBe(false);
    expect(canOpenPayReceipt(makeReceipt())).toBe(true);
  });

  it('distinguishes a superseded receipt from the current cancelled request', () => {
    const baseHistoryEntry = {
      status: 'cancelled' as const,
      isCurrent: false,
    } satisfies Pick<PayPayoutReceiptHistoryEntry, 'status' | 'isCurrent'>;

    expect(getPayReceiptHistoryStatusMeta(baseHistoryEntry)).toEqual({
      label: 'Superseded receipt',
      color: 'red',
    });
    expect(getPayReceiptHistoryStatusMeta({ ...baseHistoryEntry, isCurrent: true })).toEqual({
      label: 'Receipt cancelled',
      color: 'red',
    });
  });

  it('shows cancellation as the latest event even when the receipt was previously confirmed', () => {
    expect(getPayReceiptHistoryEvent({
      status: 'cancelled',
      confirmedAt: '2026-08-29T12:00:00.000Z',
      cancelledAt: '2026-08-29T13:00:00.000Z',
      createdAt: '2026-08-29T11:00:00.000Z',
    })).toEqual({
      label: 'Cancelled',
      at: '2026-08-29T13:00:00.000Z',
    });
  });

  it('looks up the whole receipt chain by batch key and falls back to staff period', () => {
    const receipt = {
      payoutBatchKey: ' payout-batch:PLN ',
      staffUserId: 44,
      rangeStart: '2026-07-01',
      rangeEnd: '2026-07-31',
    } satisfies Pick<
      PayPayoutReceiptDetail,
      'payoutBatchKey' | 'staffUserId' | 'rangeStart' | 'rangeEnd'
    >;

    expect(buildPayReceiptHistoryLookupParams(receipt)).toEqual({
      batchKey: 'payout-batch:PLN',
    });
    expect(buildPayReceiptHistoryLookupParams({ ...receipt, payoutBatchKey: null })).toEqual({
      staffUserId: 44,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });
  });
});
