import {
  calculateGrossStaffCompensation,
  calculatePersonalStaffPayoutLiability,
  filterStaffPayoutLedgerSources,
} from '../staffPayoutLiabilityService.js';

describe('staff payout compensation liability', () => {
  const sources = [
    { sourceKey: 'compensation_component', destination: 'staff_vendor', amount: 2_649.10 },
    { sourceKey: 'reimbursement', destination: 'staff_vendor', amount: 33.20 },
    { sourceKey: 'guide_commission', destination: 'volunteer_fund', amount: 100 },
    { sourceKey: 'compensation_component', destination: 'excluded', amount: 25 },
  ];

  it('keeps Finance reimbursements outside personal compensation due', () => {
    expect(calculatePersonalStaffPayoutLiability(sources)).toBe(2_649.10);
  });

  it('keeps reimbursements outside gross compensation without hiding other destinations', () => {
    expect(calculateGrossStaffCompensation(sources)).toBe(2_774.10);
  });

  it('removes reimbursement sources from immutable payout snapshots', () => {
    expect(filterStaffPayoutLedgerSources(sources).map((source) => source.sourceKey)).toEqual([
      'compensation_component',
      'guide_commission',
      'compensation_component',
    ]);
  });
});
