jest.mock('../../finance/models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../finance/models/VolunteerFundEntry.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/StaffPayoutReceipt.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/StaffPayoutReceiptItem.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/StaffPayoutSettlementRequest.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../finance/services/volunteerFundService.js', () => ({
  reverseVolunteerFundEntryInTransaction: jest.fn(),
}));

import FinanceTransaction from '../../finance/models/FinanceTransaction.js';
import VolunteerFundEntry from '../../finance/models/VolunteerFundEntry.js';
import { reverseVolunteerFundEntryInTransaction } from '../../finance/services/volunteerFundService.js';
import StaffPayoutReceipt from '../../models/StaffPayoutReceipt.js';
import StaffPayoutReceiptItem from '../../models/StaffPayoutReceiptItem.js';
import StaffPayoutSettlementRequest from '../../models/StaffPayoutSettlementRequest.js';
import {
  findRecoverableInterruptedPayoutBatches,
  getStaffPayoutBatchKeyForDeletion,
  getPayoutBatchKeyFromReceiptKey,
  reverseFundAllocationsForFullyDeletedPayoutBatches,
} from '../staffPayoutSettlementDeletionService.js';

describe('staff payout settlement deletion', () => {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;
  const expected = {
    staffUserId: 184,
    rangeStart: '2026-08-01',
    rangeEnd: '2026-08-31',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (reverseVolunteerFundEntryInTransaction as jest.Mock).mockResolvedValue({
      entry: { id: 100 },
      duplicated: false,
    });
  });

  it('accepts a batch key only from the exact staff payout month', () => {
    const validMeta = {
      source: 'staff-payments',
      staffUserId: 184,
      rangeStart: '2026-08-01',
      rangeEnd: '2026-08-31',
      payoutBatchKey: 'batch-a',
    };

    expect(getStaffPayoutBatchKeyForDeletion({ meta: validMeta } as never, expected)).toBe('batch-a');
    expect(getStaffPayoutBatchKeyForDeletion({
      meta: { ...validMeta, staffUserId: 185 },
    } as never, expected)).toBeNull();
    expect(getStaffPayoutBatchKeyForDeletion({
      meta: { ...validMeta, source: 'volunteer-fund-allocation' },
    } as never, expected)).toBeNull();
  });

  it('recognizes only canonical receipt batch keys', () => {
    const batchKey = 'a'.repeat(64);
    expect(getPayoutBatchKeyFromReceiptKey(`${batchKey}:PLN`)).toBe(batchKey);
    expect(getPayoutBatchKeyFromReceiptKey(`${batchKey}:PLNN`)).toBeNull();
    expect(getPayoutBatchKeyFromReceiptKey('manual-batch:PLN')).toBeNull();
  });

  it('finds a cancelled, fully detached batch with live allocations and no personal payment', async () => {
    const batchKey = 'b'.repeat(64);
    (StaffPayoutReceipt.findAll as jest.Mock)
      .mockResolvedValueOnce([{
        id: 51,
        staffUserId: 184,
        payoutBatchKey: `${batchKey}:PLN`,
      }])
      .mockResolvedValueOnce([]);
    (StaffPayoutReceiptItem.findAll as jest.Mock).mockResolvedValue([{
      receiptId: 51,
      collectionLogId: null,
    }]);
    (StaffPayoutSettlementRequest.findAll as jest.Mock).mockResolvedValue([{
      staffUserId: 184,
      payoutBatchKey: batchKey,
    }]);
    (FinanceTransaction.findAll as jest.Mock).mockResolvedValue([]);
    (VolunteerFundEntry.findAll as jest.Mock)
      .mockResolvedValueOnce([{
        id: 11,
        attributedStaffUserId: 184,
        sourceSnapshot: { payoutBatchKey: batchKey },
      }])
      .mockResolvedValueOnce([]);

    const result = await findRecoverableInterruptedPayoutBatches({
      staffUserIds: [184],
      rangeStart: '2026-08-01',
      rangeEnd: '2026-08-31',
      transaction,
    });

    expect(result.get(184)).toEqual([batchKey]);
  });

  it('does not offer recovery while any personal transaction remains', async () => {
    const batchKey = 'c'.repeat(64);
    (StaffPayoutReceipt.findAll as jest.Mock)
      .mockResolvedValueOnce([{
        id: 52,
        staffUserId: 184,
        payoutBatchKey: `${batchKey}:PLN`,
      }])
      .mockResolvedValueOnce([]);
    (StaffPayoutReceiptItem.findAll as jest.Mock).mockResolvedValue([{
      receiptId: 52,
      collectionLogId: null,
    }]);
    (StaffPayoutSettlementRequest.findAll as jest.Mock).mockResolvedValue([{
      staffUserId: 184,
      payoutBatchKey: batchKey,
    }]);
    (FinanceTransaction.findAll as jest.Mock).mockResolvedValue([{
      meta: {
        source: 'staff-payments',
        staffUserId: 184,
        rangeStart: '2026-08-01',
        rangeEnd: '2026-08-31',
        payoutBatchKey: batchKey,
      },
    }]);
    (VolunteerFundEntry.findAll as jest.Mock)
      .mockResolvedValueOnce([{
        id: 12,
        attributedStaffUserId: 184,
        sourceSnapshot: { payoutBatchKey: batchKey },
      }])
      .mockResolvedValueOnce([]);

    const result = await findRecoverableInterruptedPayoutBatches({
      staffUserIds: [184],
      rangeStart: '2026-08-01',
      rangeEnd: '2026-08-31',
    });

    expect(result.has(184)).toBe(false);
  });

  it('reverses every active fund allocation when no personal row remains for the batch', async () => {
    (FinanceTransaction.findAll as jest.Mock).mockResolvedValue([]);
    (VolunteerFundEntry.findAll as jest.Mock)
      .mockResolvedValueOnce([
        { id: 11, fundId: 1, sourceSnapshot: { payoutBatchKey: 'batch-a' } },
        { id: 12, fundId: 1, sourceSnapshot: { payoutBatchKey: 'batch-a' } },
        { id: 13, fundId: 1, sourceSnapshot: { payoutBatchKey: 'other-batch' } },
      ])
      .mockResolvedValueOnce([]);

    await expect(reverseFundAllocationsForFullyDeletedPayoutBatches({
      ...expected,
      candidateBatchKeys: ['batch-a'],
      actorId: 1,
      reversalDate: '2026-09-01',
      transaction,
    })).resolves.toEqual({
      reversedAllocationCount: 2,
      reversedBatchKeys: ['batch-a'],
    });

    expect(reverseVolunteerFundEntryInTransaction).toHaveBeenNthCalledWith(
      1,
      1,
      11,
      expect.objectContaining({ entryDate: '2026-09-01' }),
      1,
      transaction,
    );
    expect(reverseVolunteerFundEntryInTransaction).toHaveBeenNthCalledWith(
      2,
      1,
      12,
      expect.objectContaining({ entryDate: '2026-09-01' }),
      1,
      transaction,
    );
  });

  it('keeps fund allocations when another personal payment remains in the batch', async () => {
    (FinanceTransaction.findAll as jest.Mock).mockResolvedValue([{
      id: 91,
      meta: {
        source: 'staff-payments',
        staffUserId: 184,
        rangeStart: '2026-08-01',
        rangeEnd: '2026-08-31',
        payoutBatchKey: 'batch-a',
      },
    }]);

    await expect(reverseFundAllocationsForFullyDeletedPayoutBatches({
      ...expected,
      candidateBatchKeys: ['batch-a'],
      actorId: 1,
      reversalDate: '2026-09-01',
      transaction,
    })).resolves.toEqual({
      reversedAllocationCount: 0,
      reversedBatchKeys: [],
    });

    expect(VolunteerFundEntry.findAll).not.toHaveBeenCalled();
    expect(reverseVolunteerFundEntryInTransaction).not.toHaveBeenCalled();
  });

  it('does not reverse an allocation that already has an immutable reversal row', async () => {
    (FinanceTransaction.findAll as jest.Mock).mockResolvedValue([]);
    (VolunteerFundEntry.findAll as jest.Mock)
      .mockResolvedValueOnce([
        { id: 11, fundId: 1, sourceSnapshot: { payoutBatchKey: 'batch-a' } },
        { id: 12, fundId: 1, sourceSnapshot: { payoutBatchKey: 'batch-a' } },
      ])
      .mockResolvedValueOnce([{ reversalOfEntryId: 11 }]);

    await expect(reverseFundAllocationsForFullyDeletedPayoutBatches({
      ...expected,
      candidateBatchKeys: ['batch-a'],
      actorId: 1,
      reversalDate: '2026-09-01',
      transaction,
    })).resolves.toEqual({
      reversedAllocationCount: 1,
      reversedBatchKeys: ['batch-a'],
    });

    expect(reverseVolunteerFundEntryInTransaction).toHaveBeenCalledTimes(1);
    expect(reverseVolunteerFundEntryInTransaction).toHaveBeenCalledWith(
      1,
      12,
      expect.any(Object),
      1,
      transaction,
    );
  });
});
