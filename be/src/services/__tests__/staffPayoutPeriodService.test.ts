import { isStaffPayoutPeriodClosedInWarsaw } from '../staffPayoutPeriodService.js';

describe('staff payout period closure', () => {
  it('closes the previous month at Warsaw midnight even while UTC is still on the prior date', () => {
    expect(isStaffPayoutPeriodClosedInWarsaw(
      '2026-09-30',
      new Date('2026-09-30T22:30:00.000Z'),
    )).toBe(true);
  });

  it('keeps the current Warsaw month open before local midnight', () => {
    expect(isStaffPayoutPeriodClosedInWarsaw(
      '2026-09-30',
      new Date('2026-09-30T21:30:00.000Z'),
    )).toBe(false);
  });
});
