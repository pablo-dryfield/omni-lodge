jest.mock('../../models/AffiliatePayoutLog.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/StaffPayoutCollectionLog.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/StaffPayoutLedger.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../finance/models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

import AffiliatePayoutLog from '../../models/AffiliatePayoutLog';
import FinanceTransaction from '../../finance/models/FinanceTransaction';
import StaffPayoutCollectionLog from '../../models/StaffPayoutCollectionLog';
import StaffPayoutLedger from '../../models/StaffPayoutLedger';
import {
  loadCanonicalStaffPayablePaidMinor,
  loadImmutableUncollectedAffiliatePaidMinor,
  reconcilePersistedStaffPayoutLedgers,
} from '../staffPayoutLedgerReconciliationService';

describe('staff payout ledger reconciliation', () => {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    (FinanceTransaction.findAll as jest.Mock).mockResolvedValue([]);
  });

  it('persists canonical paid and closing amounts including uncollected legacy affiliate payouts', async () => {
    const julyUpdate = jest.fn().mockResolvedValue(undefined);
    const augustUpdate = jest.fn().mockResolvedValue(undefined);
    (StaffPayoutLedger.findAll as jest.Mock).mockResolvedValue([
      {
        id: 31,
        staffUserId: 24,
        rangeStart: '2026-07-01',
        rangeEnd: '2026-07-31',
        currencyCode: 'PLN',
        openingBalanceMinor: 1_000,
        dueAmountMinor: 10_000,
        update: julyUpdate,
      },
      {
        id: 32,
        staffUserId: 24,
        rangeStart: '2026-08-01',
        rangeEnd: '2026-08-31',
        currencyCode: 'PLN',
        openingBalanceMinor: 999_999,
        dueAmountMinor: 5_000,
        update: augustUpdate,
      },
    ]);
    (StaffPayoutCollectionLog.findAll as jest.Mock).mockImplementation(async ({ where }) =>
      where.rangeStart === '2026-07-01'
        ? [{ amountMinor: 8_000, financeTransactionId: 601 }]
        : [{ amountMinor: 2_000, financeTransactionId: 602 }]);
    (AffiliatePayoutLog.findAll as jest.Mock).mockResolvedValue([
      {
        id: 13,
        amountMinor: 2_000,
        bookingIds: [103],
        rangeStart: '2026-08-01',
        rangeEnd: '2026-08-31',
        financeTransactionId: 602,
        paidDate: '2026-09-01',
      },
      {
        id: 12,
        amountMinor: 1_234,
        bookingIds: [102],
        rangeStart: '2026-07-01',
        rangeEnd: '2026-07-31',
        financeTransactionId: null,
        paidDate: '2026-08-01',
      },
      {
        id: 10,
        amountMinor: 8_000,
        bookingIds: [101],
        rangeStart: '2026-07-01',
        rangeEnd: '2026-07-31',
        financeTransactionId: 601,
        paidDate: '2026-08-01',
      },
    ]);
    await reconcilePersistedStaffPayoutLedgers({
      staffUserId: 24,
      affectedRangeStart: '2026-07-10',
      affectedRangeEnd: '2026-07-20',
      transaction,
    });

    expect(StaffPayoutLedger.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { staffUserId: 24 },
      transaction,
      lock: transaction.LOCK.UPDATE,
    }));
    expect(StaffPayoutCollectionLog.findAll).toHaveBeenCalledWith({
      attributes: ['amountMinor', 'financeTransactionId', 'note'],
      where: {
        staffProfileId: 24,
        direction: 'payable',
        currencyCode: 'PLN',
        rangeStart: '2026-07-01',
        rangeEnd: '2026-07-31',
      },
      transaction,
    });
    expect(AffiliatePayoutLog.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { affiliateUserId: 24, currencyCode: 'PLN' },
      transaction,
    }));
    expect(julyUpdate).toHaveBeenCalledWith(
      {
        openingBalanceMinor: 0,
        paidAmountMinor: 9_234,
        closingBalanceMinor: 766,
      },
      { transaction },
    );
    expect(augustUpdate).toHaveBeenCalledWith(
      {
        openingBalanceMinor: 766,
        paidAmountMinor: 2_000,
        closingBalanceMinor: 3_766,
      },
      { transaction },
    );
  });

  it('keeps reimbursement cash out of the compensation liability ledger', async () => {
    (StaffPayoutCollectionLog.findAll as jest.Mock).mockResolvedValue([
      { amountMinor: 33_333, financeTransactionId: 701, note: 'Staff compensation' },
      { amountMinor: 25_000, financeTransactionId: 702, note: 'Staff reimbursements payout' },
    ]);
    (FinanceTransaction.findAll as jest.Mock).mockResolvedValue([
      {
        id: 701,
        description: 'Reviews payout',
        meta: { source: 'staff-payments', lineLabel: 'Reviews' },
      },
      {
        id: 702,
        description: 'Staff reimbursements payout',
        meta: {
          source: 'staff-payments',
          lineLabel: 'Reimbursements',
          settlementKind: 'reimbursement',
          excludeFromStaffPayoutLedger: true,
        },
      },
    ]);
    (AffiliatePayoutLog.findAll as jest.Mock).mockResolvedValue([]);

    await expect(loadCanonicalStaffPayablePaidMinor({
      staffUserId: 184,
      rangeStart: '2026-08-01',
      rangeEnd: '2026-08-31',
      currencyCode: 'PLN',
      transaction,
    })).resolves.toBe(33_333);

    expect(FinanceTransaction.findAll).toHaveBeenCalledWith({
      attributes: ['id', 'description', 'meta'],
      where: { id: [701, 702] },
      transaction,
    });
  });

  it('does not load payout data when no persisted ledger period overlaps the affected range', async () => {
    (StaffPayoutLedger.findAll as jest.Mock).mockResolvedValue([]);

    await reconcilePersistedStaffPayoutLedgers({
      staffUserId: 24,
      affectedRangeStart: '2026-07-01',
      affectedRangeEnd: '2026-07-31',
      transaction,
    });

    expect(StaffPayoutCollectionLog.findAll).not.toHaveBeenCalled();
    expect(AffiliatePayoutLog.findAll).not.toHaveBeenCalled();
  });

  it('uses the immutable payout-log range and total instead of mutable booking fields', async () => {
    (AffiliatePayoutLog.findAll as jest.Mock).mockResolvedValue([
      {
        id: 20,
        amountMinor: 9_001,
        bookingIds: [201, 202],
        rangeStart: '2026-07-10',
        rangeEnd: '2026-07-20',
        financeTransactionId: null,
        paidDate: '2026-09-01',
      },
    ]);

    await expect(loadImmutableUncollectedAffiliatePaidMinor({
      staffUserId: 24,
      rangeStart: '2026-07-01',
      rangeEnd: '2026-07-31',
      currencyCode: 'PLN',
      collectedFinanceTransactionIds: new Set(),
      transaction,
    })).resolves.toBe(9_001);
  });

  it('fails closed when a legacy payout log crosses ledger boundaries without an immutable split', async () => {
    (AffiliatePayoutLog.findAll as jest.Mock).mockResolvedValue([
      {
        id: 21,
        amountMinor: 9_001,
        rangeStart: '2026-07-15',
        rangeEnd: '2026-08-15',
        financeTransactionId: null,
        paidDate: '2026-09-01',
      },
    ]);

    await expect(loadImmutableUncollectedAffiliatePaidMinor({
      staffUserId: 24,
      rangeStart: '2026-07-01',
      rangeEnd: '2026-07-31',
      currencyCode: 'PLN',
      collectedFinanceTransactionIds: new Set(),
      transaction,
    })).rejects.toThrow(/spans more than one payout ledger period/i);
  });
});
