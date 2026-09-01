import { isStaffPayoutReimbursementCollection } from '../staffPayoutCollectionClassificationService.js';

describe('staff payout collection classification', () => {
  it('uses the explicit reimbursement marker for new payout rows', () => {
    expect(isStaffPayoutReimbursementCollection({
      meta: {
        settlementKind: 'reimbursement',
        excludeFromStaffPayoutLedger: true,
      },
    })).toBe(true);
  });

  it('recognizes reimbursement rows created before the explicit marker existed', () => {
    expect(isStaffPayoutReimbursementCollection({
      meta: { lineLabel: 'Reimbursements' },
      description: 'Staff reimbursements payout',
    })).toBe(true);
  });

  it('keeps ordinary compensation in the payout ledger', () => {
    expect(isStaffPayoutReimbursementCollection({
      meta: { lineLabel: 'Reviews', sourceKey: 'compensation_component' },
      description: 'Reviews payout',
      note: 'August compensation',
    })).toBe(false);
  });
});
