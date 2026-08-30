jest.mock('../../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../auditLogService.js', () => ({ recordFinanceAuditLog: jest.fn() }));
jest.mock('../../../services/configService.js', () => ({ getConfigValue: jest.fn(() => 'PLN') }));
jest.mock('../../../models/CompensationComponent.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../../models/CompensationSettlementRule.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), findAll: jest.fn(), findByPk: jest.fn() },
}));
jest.mock('../../../models/User.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/VolunteerFund.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));

import HttpError from '../../../errors/HttpError.js';
import sequelize from '../../../config/database.js';
import CompensationSettlementRule from '../../../models/CompensationSettlementRule.js';
import VolunteerFund from '../../models/VolunteerFund.js';
import {
  assertProspectiveSettlementRule,
  deactivateSettlementRule,
  normalizeSettlementRuleInput,
  settlementRuleRangesOverlap,
  updateSettlementRule,
} from '../compensationSettlementRuleService.js';

describe('compensation settlement rule validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes the volunteer fund default using canonical fields', () => {
    expect(normalizeSettlementRuleInput({
      targetScope: 'staff_type',
      staffType: 'Volunteer',
      matchKind: 'default',
      destination: 'volunteer_fund',
      fundId: 4,
      isActive: true,
    })).toEqual({
      targetScope: 'staff_type',
      staffType: 'volunteer',
      userId: null,
      matchKind: 'default',
      componentId: null,
      matchKey: null,
      destination: 'volunteer_fund',
      fundId: 4,
      effectiveStart: null,
      effectiveEnd: null,
      isActive: true,
    });
  });

  it('normalizes category and special-source compatibility aliases', () => {
    expect(normalizeSettlementRuleInput({
      scope: 'global',
      sourceKind: 'category',
      componentCategory: 'Review',
      destination: 'staff_vendor',
    })).toMatchObject({
      targetScope: 'global',
      matchKind: 'component_category',
      matchKey: 'review',
      fundId: null,
    });
    expect(normalizeSettlementRuleInput({
      targetScope: 'staff_type',
      staffType: 'volunteer',
      sourceKind: 'special_source',
      specialSource: 'Promotion_Sales',
      destination: 'staff_vendor',
    })).toMatchObject({
      matchKind: 'system_source',
      matchKey: 'promotion_sales',
    });
  });

  it('requires a fund only for volunteer_fund destinations', () => {
    expect(() => normalizeSettlementRuleInput({
      targetScope: 'global',
      matchKind: 'default',
      destination: 'volunteer_fund',
    })).toThrow(HttpError);
    expect(normalizeSettlementRuleInput({
      targetScope: 'global',
      matchKind: 'default',
      destination: 'staff_vendor',
      fundId: 9,
    }).fundId).toBeNull();
  });

  it('detects open-ended and bounded effective-date overlaps', () => {
    expect(settlementRuleRangesOverlap(null, null, '2026-08-01', '2026-08-31')).toBe(true);
    expect(settlementRuleRangesOverlap('2026-08-01', '2026-08-31', '2026-08-31', null)).toBe(true);
    expect(settlementRuleRangesOverlap('2026-08-01', '2026-08-10', '2026-08-11', null)).toBe(false);
  });

  it('requires every new rule, including an inactive draft, to start on a future month boundary', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-29T12:00:00.000Z'));
    try {
      const inactiveDraft = normalizeSettlementRuleInput({
        targetScope: 'staff_type',
        staffType: 'volunteer',
        matchKind: 'default',
        destination: 'volunteer_fund',
        fundId: 4,
        isActive: false,
      });
      expect(() => assertProspectiveSettlementRule(inactiveDraft)).toThrow(
        'effectiveStart is required for a new settlement rule.',
      );
      expect(() => assertProspectiveSettlementRule({
        ...inactiveDraft,
        effectiveStart: '2026-08-31',
      })).toThrow('effectiveStart must be the first day of a calendar month.');
      expect(() => assertProspectiveSettlementRule({
        ...inactiveDraft,
        effectiveStart: '2026-09-01',
      })).not.toThrow();
    } finally {
      jest.useRealTimers();
    }
  });

  it('allows a begun rule to be ended on the current month boundary without changing its routing', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-29T12:00:00.000Z'));
    try {
      const update = jest.fn().mockResolvedValue(undefined);
      const existing = {
        id: 12,
        targetScope: 'staff_type',
        staffType: 'volunteer',
        userId: null,
        matchKind: 'default',
        componentId: null,
        matchKey: null,
        destination: 'volunteer_fund',
        fundId: 4,
        effectiveStart: '2026-08-01',
        effectiveEnd: null,
        isActive: true,
        update,
      };
      const transaction = { LOCK: { UPDATE: 'UPDATE' } };
      (sequelize.transaction as jest.Mock).mockImplementation(
        async (callback: (value: typeof transaction) => unknown) => callback(transaction),
      );
      (CompensationSettlementRule.findByPk as jest.Mock).mockResolvedValue(existing);
      (CompensationSettlementRule.findAll as jest.Mock).mockResolvedValue([]);
      (VolunteerFund.findByPk as jest.Mock).mockResolvedValue({
        id: 4,
        currency: 'PLN',
        isActive: true,
      });

      await expect(updateSettlementRule(12, { effectiveEnd: '2026-08-31' }, 1)).resolves.toBe(existing);

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          effectiveEnd: '2026-08-31',
          isActive: true,
        }),
        { transaction },
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not deactivate a begun rule because that would erase historical routing', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-29T12:00:00.000Z'));
    try {
      const existing = {
        id: 12,
        targetScope: 'staff_type',
        staffType: 'volunteer',
        userId: null,
        matchKind: 'default',
        componentId: null,
        matchKey: null,
        destination: 'volunteer_fund',
        fundId: 4,
        effectiveStart: '2026-08-01',
        effectiveEnd: null,
        isActive: true,
        update: jest.fn(),
      };
      const transaction = { LOCK: { UPDATE: 'UPDATE' } };
      (sequelize.transaction as jest.Mock).mockImplementation(
        async (callback: (value: typeof transaction) => unknown) => callback(transaction),
      );
      (CompensationSettlementRule.findByPk as jest.Mock).mockResolvedValue(existing);

      await expect(deactivateSettlementRule(12, 1)).rejects.toThrow(
        /history is immutable/i,
      );
      expect(existing.update).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
