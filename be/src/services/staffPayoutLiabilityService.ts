export type StaffPayoutLiabilitySource = {
  sourceKey: string;
  destination: string;
  amount: number;
};

/**
 * The staff payout ledger is a compensation-liability ledger. Reimbursements
 * are Finance expenses that can share a payout receipt, but they must not
 * change compensation due, paid, opening, closing, or snapshot authority.
 */
export const isStaffPayoutLedgerSource = <T extends Pick<StaffPayoutLiabilitySource, 'sourceKey'>>(
  source: T,
): boolean => source.sourceKey !== 'reimbursement';

export const filterStaffPayoutLedgerSources = <T extends Pick<StaffPayoutLiabilitySource, 'sourceKey'>>(
  sources: readonly T[],
): T[] => sources.filter(isStaffPayoutLedgerSource);

export const calculatePersonalStaffPayoutLiability = (
  sources: readonly StaffPayoutLiabilitySource[],
): number => sources
  .filter((source) => source.destination === 'staff_vendor' && isStaffPayoutLedgerSource(source))
  .reduce((sum, source) => sum + source.amount, 0);

export const calculateGrossStaffCompensation = (
  sources: readonly StaffPayoutLiabilitySource[],
): number => filterStaffPayoutLedgerSources(sources)
  .reduce((sum, source) => sum + source.amount, 0);
