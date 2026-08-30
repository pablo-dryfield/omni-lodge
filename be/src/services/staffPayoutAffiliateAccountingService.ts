export type AffiliateCommissionEarnings = {
  commissionTotal: number;
  commissionPaidTotal: number;
  commissionOutstandingTotal: number;
};

export type StaffPayoutEarningsTarget = {
  bucketTotals: Record<string, number>;
  totalPayout: number;
};

export type PaidAffiliateBooking = {
  affiliateCommissionAmount: number;
  affiliatePayoutLogId: number | null;
  isCommissionPaid: boolean;
};

/**
 * Adds gross affiliate commission to the earnings side of a staff payout.
 *
 * Paid commission is still earned commission. Payment reconciliation and the
 * ledger subtract recorded payments separately, so using only the outstanding
 * amount here would remove earnings as soon as they are paid and manufacture
 * an equal overpayment balance.
 */
export const applyAffiliateCommissionEarnings = (
  target: StaffPayoutEarningsTarget,
  affiliateCommission: AffiliateCommissionEarnings,
): void => {
  const earnedAmount = affiliateCommission.commissionTotal;
  if (!Number.isFinite(earnedAmount) || earnedAmount <= 0) {
    return;
  }

  target.bucketTotals.affiliate_commission =
    (target.bucketTotals.affiliate_commission ?? 0) + earnedAmount;
  target.totalPayout += earnedAmount;
};

/**
 * Returns paid affiliate commission that is not already represented by a
 * staff payout collection row for the requested report range.
 *
 * Affiliate payouts can be created from either the Pays screen (which writes
 * both records) or the Affiliates screen (which historically wrote only an
 * affiliate payout log). Summing the visible paid bookings keeps custom and
 * partial ranges proportional instead of pulling in an entire payout-log
 * amount whose bookings may span beyond the report.
 */
export const getUncollectedAffiliatePaidAmount = (params: {
  bookings: readonly PaidAffiliateBooking[];
  payoutFinanceTransactionIdByLogId: ReadonlyMap<number, number | null>;
  collectedFinanceTransactionIds: ReadonlySet<number>;
}): number => {
  const amountMinor = params.bookings.reduce((sum, booking) => {
    if (!booking.isCommissionPaid || !booking.affiliatePayoutLogId) {
      return sum;
    }
    if (!params.payoutFinanceTransactionIdByLogId.has(booking.affiliatePayoutLogId)) {
      // Without the payout record we cannot safely determine whether a
      // collection row already represents this booking.
      return sum;
    }

    const financeTransactionId =
      params.payoutFinanceTransactionIdByLogId.get(booking.affiliatePayoutLogId) ?? null;
    if (
      financeTransactionId != null &&
      params.collectedFinanceTransactionIds.has(financeTransactionId)
    ) {
      return sum;
    }

    const bookingAmountMinor = Math.round(booking.affiliateCommissionAmount * 100);
    return Number.isFinite(bookingAmountMinor) && bookingAmountMinor > 0
      ? sum + bookingAmountMinor
      : sum;
  }, 0);

  return amountMinor / 100;
};

/**
 * Canonical paid amount for the payable side of a staff payout period.
 *
 * Collection rows are authoritative for integrated Pays/affiliate payments.
 * Legacy/direct affiliate payout logs that have no matching collection row
 * are added once from their visible booking allocations.
 */
export const getCanonicalPayablePaidMinor = (params: {
  collectedPayableMinor: number;
  uncollectedAffiliatePaidMinor: number;
}): number => {
  if (!Number.isSafeInteger(params.collectedPayableMinor) || params.collectedPayableMinor < 0) {
    throw new Error('Collected payable amount must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(params.uncollectedAffiliatePaidMinor)
    || params.uncollectedAffiliatePaidMinor < 0) {
    throw new Error('Uncollected affiliate paid amount must be a non-negative safe integer.');
  }
  const totalPaidMinor = params.collectedPayableMinor + params.uncollectedAffiliatePaidMinor;
  if (!Number.isSafeInteger(totalPaidMinor)) {
    throw new Error('Canonical payable paid amount exceeds safe currency limits.');
  }
  return totalPaidMinor;
};
