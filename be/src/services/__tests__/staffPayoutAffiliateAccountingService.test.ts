import {
  applyAffiliateCommissionEarnings,
  getCanonicalPayablePaidMinor,
  getUncollectedAffiliatePaidAmount,
} from '../staffPayoutAffiliateAccountingService';

describe('applyAffiliateCommissionEarnings', () => {
  it('keeps paid affiliate commission in historical payout earnings', () => {
    const payout = {
      bucketTotals: { commission: 51 },
      totalPayout: 452.4,
    };

    applyAffiliateCommissionEarnings(payout, {
      commissionTotal: 80,
      commissionPaidTotal: 80,
      commissionOutstandingTotal: 0,
    });

    expect(payout).toEqual({
      bucketTotals: { commission: 51, affiliate_commission: 80 },
      totalPayout: 532.4,
    });
  });

  it('uses total earned commission for due while preserving mixed paid and outstanding state', () => {
    const payout = {
      bucketTotals: { affiliate_commission: 10 },
      totalPayout: 200,
    };

    applyAffiliateCommissionEarnings(payout, {
      commissionTotal: 120,
      commissionPaidTotal: 80,
      commissionOutstandingTotal: 40,
    });

    expect(payout).toEqual({
      bucketTotals: { affiliate_commission: 130 },
      totalPayout: 320,
    });
  });

  it('ignores empty or invalid earned amounts', () => {
    const payout = {
      bucketTotals: { commission: 25 },
      totalPayout: 25,
    };

    applyAffiliateCommissionEarnings(payout, {
      commissionTotal: 0,
      commissionPaidTotal: 0,
      commissionOutstandingTotal: 0,
    });
    applyAffiliateCommissionEarnings(payout, {
      commissionTotal: Number.NaN,
      commissionPaidTotal: 0,
      commissionOutstandingTotal: 0,
    });

    expect(payout).toEqual({
      bucketTotals: { commission: 25 },
      totalPayout: 25,
    });
  });
});

describe('getUncollectedAffiliatePaidAmount', () => {
  const payoutTransactions = new Map<number, number | null>([
    [10, 601],
    [11, 602],
    [12, null],
  ]);

  it('reconciles a direct affiliate payout that has no staff collection row', () => {
    expect(
      getUncollectedAffiliatePaidAmount({
        bookings: [
          {
            affiliateCommissionAmount: 80,
            affiliatePayoutLogId: 10,
            isCommissionPaid: true,
          },
        ],
        payoutFinanceTransactionIdByLogId: payoutTransactions,
        collectedFinanceTransactionIds: new Set(),
      }),
    ).toBe(80);
  });

  it('does not double count an integrated payout already in staff collections', () => {
    expect(
      getUncollectedAffiliatePaidAmount({
        bookings: [
          {
            affiliateCommissionAmount: 80,
            affiliatePayoutLogId: 10,
            isCommissionPaid: true,
          },
        ],
        payoutFinanceTransactionIdByLogId: payoutTransactions,
        collectedFinanceTransactionIds: new Set([601]),
      }),
    ).toBe(0);
  });

  it('adds only unrepresented payments when direct and integrated payouts are mixed', () => {
    expect(
      getUncollectedAffiliatePaidAmount({
        bookings: [
          {
            affiliateCommissionAmount: 80,
            affiliatePayoutLogId: 10,
            isCommissionPaid: true,
          },
          {
            affiliateCommissionAmount: 35.25,
            affiliatePayoutLogId: 11,
            isCommissionPaid: true,
          },
        ],
        payoutFinanceTransactionIdByLogId: payoutTransactions,
        collectedFinanceTransactionIds: new Set([601]),
      }),
    ).toBe(35.25);
  });

  it('uses only visible booking allocations for a custom partial range', () => {
    expect(
      getUncollectedAffiliatePaidAmount({
        bookings: [
          {
            affiliateCommissionAmount: 20,
            affiliatePayoutLogId: 10,
            isCommissionPaid: true,
          },
          {
            affiliateCommissionAmount: 40,
            affiliatePayoutLogId: 10,
            isCommissionPaid: true,
          },
        ],
        payoutFinanceTransactionIdByLogId: payoutTransactions,
        collectedFinanceTransactionIds: new Set(),
      }),
    ).toBe(60);
  });

  it('supports legacy paid logs without a finance transaction but skips unsafe missing references', () => {
    expect(
      getUncollectedAffiliatePaidAmount({
        bookings: [
          {
            affiliateCommissionAmount: 12.34,
            affiliatePayoutLogId: 12,
            isCommissionPaid: true,
          },
          {
            affiliateCommissionAmount: 99,
            affiliatePayoutLogId: null,
            isCommissionPaid: true,
          },
          {
            affiliateCommissionAmount: 50,
            affiliatePayoutLogId: null,
            isCommissionPaid: false,
          },
        ],
        payoutFinanceTransactionIdByLogId: payoutTransactions,
        collectedFinanceTransactionIds: new Set(),
      }),
    ).toBe(12.34);
  });
});

describe('getCanonicalPayablePaidMinor', () => {
  it('combines collection rows with legacy affiliate payouts without double counting integrated payouts', () => {
    expect(getCanonicalPayablePaidMinor({
      collectedPayableMinor: 8_000,
      uncollectedAffiliatePaidMinor: 1_234,
    })).toBe(9_234);
  });

  it('rejects an unsafe collection total instead of persisting a corrupt ledger balance', () => {
    expect(() => getCanonicalPayablePaidMinor({
      collectedPayableMinor: -1,
      uncollectedAffiliatePaidMinor: 0,
    })).toThrow(/non-negative safe integer/i);
  });
});
