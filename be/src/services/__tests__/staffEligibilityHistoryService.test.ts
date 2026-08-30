jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../__mocks__/sequelizeModelStub', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/AuditLog.js', () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));
jest.mock('../../models/ShiftRole.js', () => ({
  __esModule: true,
  default: { count: jest.fn() },
}));
jest.mock('../../models/StaffProfile.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../models/StaffProfileTypePeriod.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
}));
jest.mock('../../models/UserShiftRole.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), destroy: jest.fn(), bulkCreate: jest.fn() },
}));
jest.mock('../../models/UserShiftRoleMembershipPeriod.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), create: jest.fn() },
}));
jest.mock('../../models/UserTypeMembershipPeriod.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() },
}));

import {
  closeStaffProfileTypeHistoryForDeletion,
  normalizeStaffEligibilityEffectiveDate,
  StaffEligibilityHistoryError,
  staffEligibilityPeriodContainsDate,
  staffEligibilityPeriodOverlapsRange,
} from '../staffEligibilityHistoryService';
import AuditLog from '../../models/AuditLog';
import StaffProfile from '../../models/StaffProfile';
import StaffProfileTypePeriod from '../../models/StaffProfileTypePeriod';

const userModel = jest.requireMock('../../__mocks__/sequelizeModelStub').default as {
  findByPk: jest.Mock;
};

describe('staff eligibility history service', () => {
  it('defaults changes to the Warsaw business date and rejects future dates', () => {
    const now = new Date('2026-01-01T23:30:00.000Z');
    expect(normalizeStaffEligibilityEffectiveDate(undefined, now)).toBe('2026-01-02');
    expect(() => normalizeStaffEligibilityEffectiveDate('2026-01-03', now)).toThrow(
      StaffEligibilityHistoryError,
    );
    expect(() => normalizeStaffEligibilityEffectiveDate('2026-02-30', now)).toThrow(
      /valid date/i,
    );
  });

  it('uses inclusive business-day period boundaries', () => {
    const period = { effectiveStart: '2026-08-05', effectiveEnd: '2026-08-20' } as never;
    expect(staffEligibilityPeriodContainsDate(period, '2026-08-05')).toBe(true);
    expect(staffEligibilityPeriodContainsDate(period, '2026-08-20')).toBe(true);
    expect(staffEligibilityPeriodContainsDate(period, '2026-08-21')).toBe(false);
    expect(staffEligibilityPeriodOverlapsRange(period, '2026-08-20', '2026-08-31')).toBe(true);
    expect(staffEligibilityPeriodOverlapsRange(period, '2026-08-21', '2026-08-31')).toBe(false);
  });

  it('closes only the current staff-type period when a profile is deleted', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;
    const priorPeriod = {
      id: 80,
      staffType: 'volunteer',
      effectiveStart: '2026-06-01',
      effectiveEnd: '2026-06-30',
      changeReason: null,
      update: jest.fn(),
      destroy: jest.fn(),
    };
    const currentPeriod = {
      id: 81,
      staffType: 'long_term',
      effectiveStart: '2026-07-01',
      effectiveEnd: null,
      changeReason: 'Promoted',
      update: jest.fn(),
      destroy: jest.fn(),
    };
    userModel.findByPk.mockResolvedValue({ id: 28 });
    (StaffProfile.findOne as jest.Mock).mockResolvedValue({ staffType: 'long_term' });
    (StaffProfileTypePeriod.findAll as jest.Mock).mockResolvedValue([priorPeriod, currentPeriod]);

    const result = await closeStaffProfileTypeHistoryForDeletion({
      userId: 28,
      effectiveDate: '2026-08-20',
      actorId: 7,
      reason: 'Staff profile removed',
      source: 'staff_profile_deletion',
      metadata: { profileDeleted: true },
      transaction,
    });

    expect(currentPeriod.update).toHaveBeenCalledWith({
      effectiveEnd: '2026-08-20',
      endedBy: 7,
      changeReason: 'Staff profile removed',
    }, { transaction });
    expect(currentPeriod.destroy).not.toHaveBeenCalled();
    expect(priorPeriod.update).not.toHaveBeenCalled();
    expect(priorPeriod.destroy).not.toHaveBeenCalled();
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 7,
      action: 'staff_eligibility.staff_profile_deleted',
      entity: 'user',
      entityId: '28',
      metaJson: expect.objectContaining({
        effectiveDate: '2026-08-20',
        previous: 'long_term',
        next: null,
        applied: null,
        metadata: expect.objectContaining({
          profileDeleted: true,
          periodId: 81,
          periodAction: 'closed',
        }),
      }),
    }), { transaction });
    expect(result).toEqual({
      changed: true,
      effectiveDate: '2026-08-20',
      previous: 'long_term',
      next: null,
      periodId: 81,
      periodAction: 'closed',
    });
  });

  it('retains a same-day staff-type period as immutable earning-date evidence', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;
    const priorPeriod = {
      id: 90,
      staffType: 'volunteer',
      effectiveStart: '2026-06-01',
      effectiveEnd: '2026-06-30',
      changeReason: null,
      update: jest.fn(),
      destroy: jest.fn(),
    };
    const currentPeriod = {
      id: 91,
      staffType: 'long_term',
      effectiveStart: '2026-08-20',
      effectiveEnd: null,
      changeReason: null,
      update: jest.fn(),
      destroy: jest.fn(),
    };
    userModel.findByPk.mockResolvedValue({ id: 28 });
    (StaffProfile.findOne as jest.Mock).mockResolvedValue({ staffType: 'long_term' });
    (StaffProfileTypePeriod.findAll as jest.Mock).mockResolvedValue([priorPeriod, currentPeriod]);

    const result = await closeStaffProfileTypeHistoryForDeletion({
      userId: 28,
      effectiveDate: '2026-08-20',
      actorId: 7,
      source: 'staff_profile_deletion',
      transaction,
    });

    expect(currentPeriod.update).toHaveBeenCalledWith({
      effectiveEnd: '2026-08-20',
      endedBy: 7,
      changeReason: null,
    }, { transaction });
    expect(currentPeriod.destroy).not.toHaveBeenCalled();
    expect(priorPeriod.update).not.toHaveBeenCalled();
    expect(priorPeriod.destroy).not.toHaveBeenCalled();
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      metaJson: expect.objectContaining({
        metadata: expect.objectContaining({
          periodId: 91,
          periodAction: 'closed',
        }),
      }),
    }), { transaction });
    expect(result.periodAction).toBe('closed');
  });

});
