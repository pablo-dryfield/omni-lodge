import { buildStaffPayoutStaffIdentity } from '../staffPayoutStaffIdentityService.js';

describe('staff payout staff identity', () => {
  it('exposes normalized first, last, and full names', () => {
    expect(buildStaffPayoutStaffIdentity({
      userId: 177,
      firstName: '  Luna ',
      lastName: ' Volunteer  ',
    })).toEqual({
      firstName: 'Luna',
      lastName: 'Volunteer',
      fullName: 'Luna Volunteer',
    });
  });

  it('keeps a usable full name when only one name part exists', () => {
    expect(buildStaffPayoutStaffIdentity({
      userId: 24,
      firstName: 'Cristian',
      lastName: null,
    })).toEqual({
      firstName: 'Cristian',
      lastName: '',
      fullName: 'Cristian',
    });
    expect(buildStaffPayoutStaffIdentity({
      userId: 25,
      firstName: null,
      lastName: 'Iaderosa',
    })).toEqual({
      firstName: '',
      lastName: 'Iaderosa',
      fullName: 'Iaderosa',
    });
  });

  it('falls back deterministically without changing the staff identifier', () => {
    expect(buildStaffPayoutStaffIdentity({
      userId: 40761,
      firstName: ' ',
      lastName: undefined,
    })).toEqual({
      firstName: 'User 40761',
      lastName: '',
      fullName: 'User 40761',
    });
  });
});
