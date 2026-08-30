import HttpError from '../../errors/HttpError.js';
import CompensationSettlementRule from '../../models/CompensationSettlementRule.js';
import {
  canRefreshClosedSettlementSnapshot,
  COMPENSATION_SETTLEMENT_SYSTEM_SOURCE,
  loadCompensationSettlementRouter,
  normalizeCompensationComponentCategory,
  normalizeCompensationStaffType,
  normalizeCompensationSystemSource,
  resolveCompensationSettlementRoute,
} from '../compensationSettlementRoutingService.js';

jest.mock('../../models/CompensationSettlementRule.js', () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
  },
}));

type RuleRecord = {
  id: number;
  targetScope: 'global' | 'staff_type' | 'user';
  staffType: string | null;
  userId: number | null;
  matchKind: 'component' | 'system_source' | 'component_category' | 'default';
  componentId: number | null;
  matchKey: string | null;
  destination: 'staff_vendor' | 'volunteer_fund' | 'excluded' | string;
  fundId: number | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  isActive: boolean;
};

const findAllMock = CompensationSettlementRule.findAll as jest.Mock;

const buildRule = (overrides: Partial<RuleRecord> = {}): RuleRecord => ({
  id: 1,
  targetScope: 'global',
  staffType: null,
  userId: null,
  matchKind: 'default',
  componentId: null,
  matchKey: null,
  destination: 'staff_vendor',
  fundId: null,
  effectiveStart: null,
  effectiveEnd: null,
  isActive: true,
  ...overrides,
});

const resolveRoute = (
  overrides: Partial<Parameters<typeof resolveCompensationSettlementRoute>[0]> = {},
) => resolveCompensationSettlementRoute({
  userId: 24,
  staffType: 'Volunteer',
  effectiveDate: '2026-08-29',
  componentId: 12,
  systemSource: 'night report',
  componentCategory: 'Base Pay',
  ...overrides,
});

describe('compensation settlement routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findAllMock.mockResolvedValue([]);
  });

  it('normalizes staff types, system sources, and component categories to stable keys', () => {
    expect(normalizeCompensationStaffType('  VOLUNTEER--Staff  ')).toBe('volunteer_staff');
    expect(normalizeCompensationSystemSource('Promotion & Sales')).toBe('promotion_and_sales');
    expect(normalizeCompensationComponentCategory('  BASE--Pay ')).toBe('base_pay');
    expect(normalizeCompensationComponentCategory('   ')).toBeNull();
  });

  it('refreshes a closed snapshot only while the period is wholly unsettled', () => {
    expect(canRefreshClosedSettlementSnapshot({
      canonicalPaidMinor: 0,
      liveFundAllocatedMinor: 0,
    })).toBe(true);
    expect(canRefreshClosedSettlementSnapshot({
      canonicalPaidMinor: 5_400,
      liveFundAllocatedMinor: 0,
    })).toBe(false);
    expect(canRefreshClosedSettlementSnapshot({
      canonicalPaidMinor: 0,
      liveFundAllocatedMinor: 5_400,
    })).toBe(false);
    expect(canRefreshClosedSettlementSnapshot({
      canonicalPaidMinor: Number.NaN,
      liveFundAllocatedMinor: 0,
    })).toBe(false);
  });

  it('uses scope precedence before match precedence: user, staff type, then global', async () => {
    findAllMock.mockResolvedValue([
      buildRule({
        id: 10,
        targetScope: 'global',
        matchKind: 'component',
        componentId: 12,
        destination: 'excluded',
      }),
      buildRule({
        id: 20,
        targetScope: 'staff_type',
        staffType: ' volunteer ',
        matchKind: 'component',
        componentId: 12,
        destination: 'volunteer_fund',
        fundId: 7,
      }),
      buildRule({
        id: 30,
        targetScope: 'user',
        userId: 24,
        matchKind: 'default',
        destination: 'staff_vendor',
      }),
    ]);

    await expect(resolveRoute()).resolves.toMatchObject({
      ruleId: 30,
      targetScope: 'user',
      matchKind: 'default',
      destination: 'staff_vendor',
      fundId: null,
    });
  });

  it('uses component, system source, category, then default within the selected scope', async () => {
    findAllMock.mockResolvedValue([
      buildRule({
        id: 1,
        targetScope: 'user',
        userId: 24,
        matchKind: 'default',
        destination: 'excluded',
      }),
      buildRule({
        id: 2,
        targetScope: 'user',
        userId: 24,
        matchKind: 'component_category',
        matchKey: 'base pay',
        destination: 'excluded',
      }),
      buildRule({
        id: 3,
        targetScope: 'user',
        userId: 24,
        matchKind: 'system_source',
        matchKey: 'Night-Report',
        destination: 'staff_vendor',
      }),
      buildRule({
        id: 4,
        targetScope: 'user',
        userId: 24,
        matchKind: 'component',
        componentId: 12,
        destination: 'volunteer_fund',
        fundId: 7,
      }),
    ]);

    await expect(resolveRoute()).resolves.toMatchObject({
      ruleId: 4,
      matchKind: 'component',
      destination: 'volunteer_fund',
      fundId: 7,
    });
  });

  it('resolves reimbursements through a normalized system-source rule', async () => {
    findAllMock.mockResolvedValue([
      buildRule({
        id: 40,
        matchKind: 'component_category',
        matchKey: 'adjustment',
        destination: 'volunteer_fund',
        fundId: 7,
      }),
      buildRule({
        id: 41,
        matchKind: 'system_source',
        matchKey: 'Reimbursement',
        destination: 'staff_vendor',
      }),
    ]);

    await expect(resolveRoute({
      componentId: null,
      systemSource: ' REIMBURSEMENT ',
      componentCategory: 'Adjustment',
    })).resolves.toMatchObject({
      ruleId: 41,
      matchKind: 'system_source',
      destination: 'staff_vendor',
      context: {
        systemSource: COMPENSATION_SETTLEMENT_SYSTEM_SOURCE.REIMBURSEMENT,
      },
    });
  });

  it('blocks an unknown source when no explicit or default rule applies', async () => {
    findAllMock.mockResolvedValue([
      buildRule({
        id: 50,
        matchKind: 'system_source',
        matchKey: 'known_source',
      }),
    ]);

    await expect(resolveRoute({
      componentId: null,
      componentCategory: null,
      systemSource: 'new unconfigured source',
    })).rejects.toMatchObject({
      status: 409,
      message: 'No active compensation settlement rule matches this item. Configure a rule before settlement.',
      details: {
        code: 'COMPENSATION_SETTLEMENT_RULE_REQUIRED',
        systemSource: 'new_unconfigured_source',
      },
    });
  });

  it('permits an unknown source only through an applicable default rule', async () => {
    findAllMock.mockResolvedValue([
      buildRule({ id: 60, matchKind: 'default', destination: 'excluded' }),
    ]);

    await expect(resolveRoute({
      componentId: null,
      componentCategory: null,
      systemSource: 'new unconfigured source',
    })).resolves.toMatchObject({
      ruleId: 60,
      matchKind: 'default',
      destination: 'excluded',
    });
  });

  it('rechecks active dates and normalized target applicability before selecting a rule', async () => {
    findAllMock.mockResolvedValue([
      buildRule({ id: 70, targetScope: 'user', userId: 25, destination: 'excluded' }),
      buildRule({
        id: 71,
        targetScope: 'staff_type',
        staffType: 'Employee',
        destination: 'excluded',
      }),
      buildRule({ id: 72, isActive: false, destination: 'excluded' }),
      buildRule({ id: 73, effectiveStart: '2026-08-30', destination: 'excluded' }),
      buildRule({ id: 74, effectiveEnd: '2026-08-28', destination: 'excluded' }),
      buildRule({ id: 75, destination: 'staff_vendor' }),
    ]);

    await expect(resolveRoute()).resolves.toMatchObject({
      ruleId: 75,
      targetScope: 'global',
      destination: 'staff_vendor',
    });
  });

  it('keeps July personal and applies the Volunteer policy from August 1', async () => {
    findAllMock.mockResolvedValue([
      buildRule({ id: 75, destination: 'staff_vendor' }),
      buildRule({
        id: 76,
        targetScope: 'staff_type',
        staffType: 'volunteer',
        matchKind: 'default',
        destination: 'volunteer_fund',
        fundId: 7,
        effectiveStart: '2026-08-01',
      }),
    ]);

    await expect(resolveRoute({ effectiveDate: '2026-07-31' })).resolves.toMatchObject({
      ruleId: 75,
      destination: 'staff_vendor',
      fundId: null,
    });
    await expect(resolveRoute({ effectiveDate: '2026-08-01' })).resolves.toMatchObject({
      ruleId: 76,
      destination: 'volunteer_fund',
      fundId: 7,
    });
  });

  it('deterministically prefers the newest effective rule and then the highest id for a tie', async () => {
    findAllMock.mockResolvedValue([
      buildRule({ id: 80, effectiveStart: '2026-01-01', destination: 'excluded' }),
      buildRule({ id: 81, effectiveStart: '2026-08-01', destination: 'staff_vendor' }),
      buildRule({ id: 82, effectiveStart: '2026-08-01', destination: 'volunteer_fund', fundId: 7 }),
    ]);

    await expect(resolveRoute()).resolves.toMatchObject({
      ruleId: 82,
      destination: 'volunteer_fund',
      fundId: 7,
    });
  });

  it('passes an existing transaction to the authoritative rule query', async () => {
    const transaction = {
      id: 'settlement-transaction',
      LOCK: { SHARE: 'SHARE' },
    } as never;
    findAllMock.mockResolvedValue([buildRule()]);

    await resolveRoute({ transaction });

    expect(findAllMock).toHaveBeenCalledTimes(1);
    expect(findAllMock).toHaveBeenCalledWith(expect.objectContaining({
      transaction,
      where: expect.objectContaining({ isActive: true }),
    }));
  });

  it('loads effective rules once and synchronously resolves a report batch', async () => {
    findAllMock.mockResolvedValue([
      buildRule({ id: 90, destination: 'staff_vendor' }),
      buildRule({
        id: 91,
        targetScope: 'staff_type',
        staffType: 'volunteer',
        matchKind: 'component_category',
        matchKey: 'base',
        destination: 'volunteer_fund',
        fundId: 7,
      }),
      buildRule({
        id: 92,
        targetScope: 'user',
        userId: 25,
        matchKind: 'default',
        destination: 'excluded',
      }),
    ]);

    const router = await loadCompensationSettlementRouter({ effectiveDate: '2026-08-29' });
    const volunteer = router.resolve({
      userId: 24,
      staffType: ' VOLUNTEER ',
      componentCategory: 'Base',
    });
    const excludedUser = router.resolve({
      userId: 25,
      staffType: 'Volunteer',
      systemSource: 'new source',
    });
    const regularStaff = router.resolve({
      userId: 26,
      staffType: 'Employee',
      componentCategory: 'Base',
    });

    expect(volunteer).toMatchObject({ ruleId: 91, destination: 'volunteer_fund' });
    expect(excludedUser).toMatchObject({ ruleId: 92, destination: 'excluded' });
    expect(regularStaff).toMatchObject({ ruleId: 90, destination: 'staff_vendor' });
    expect(findAllMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a volunteer-fund rule does not identify its fund', async () => {
    findAllMock.mockResolvedValue([
      buildRule({ destination: 'volunteer_fund', fundId: null }),
    ]);

    await expect(resolveRoute()).rejects.toMatchObject({
      status: 409,
      message: 'A volunteer-fund settlement rule must identify a volunteer fund.',
      details: { code: 'COMPENSATION_SETTLEMENT_RULE_INVALID', ruleId: 1 },
    });
  });

  it.each([
    {
      overrides: { userId: 0 },
      message: 'userId must be a positive integer.',
    },
    {
      overrides: { componentId: -1 },
      message: 'componentId must be a positive integer when provided.',
    },
    {
      overrides: { effectiveDate: '2026-02-30' },
      message: 'effectiveDate must be a valid calendar date.',
    },
  ])('rejects invalid routing input: $message', async ({ overrides, message }) => {
    await expect(resolveRoute(overrides)).rejects.toEqual(expect.objectContaining({
      status: 400,
      message,
    }));
    expect(findAllMock).not.toHaveBeenCalled();
  });

  it('uses HttpError for routing failures', async () => {
    await expect(resolveRoute()).rejects.toBeInstanceOf(HttpError);
  });
});
