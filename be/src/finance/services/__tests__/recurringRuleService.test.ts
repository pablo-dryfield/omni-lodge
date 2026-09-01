jest.mock('../../../config/database.js', () => ({
  __esModule: true,
  default: {
    transaction: jest.fn(),
  },
}));
jest.mock('../../models/FinanceAccount.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/FinanceCategory.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/FinanceClient.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/FinanceRecurringRule.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(), update: jest.fn() },
}));
jest.mock('../../models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findAndCountAll: jest.fn() },
}));
jest.mock('../../models/FinanceVendor.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/VolunteerFund.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../transactionService.js', () => ({
  createFinanceTransaction: jest.fn(),
  updateFinanceTransaction: jest.fn(),
}));
jest.mock('../auditLogService.js', () => ({ recordFinanceAuditLog: jest.fn() }));

import HttpError from '../../../errors/HttpError.js';
import sequelize from '../../../config/database.js';
import FinanceAccount from '../../models/FinanceAccount.js';
import FinanceCategory from '../../models/FinanceCategory.js';
import FinanceRecurringRule from '../../models/FinanceRecurringRule.js';
import FinanceTransaction from '../../models/FinanceTransaction.js';
import FinanceVendor from '../../models/FinanceVendor.js';
import VolunteerFund from '../../models/VolunteerFund.js';
import { recordFinanceAuditLog } from '../auditLogService.js';
import { createFinanceTransaction, updateFinanceTransaction } from '../transactionService.js';
import {
  computeFirstRecurringDateOnOrAfter,
  computeNextRecurringDate,
  createFinanceRecurringRule,
  executeRecurringRules,
  normalizeRecurringRuleCreatePayload,
  normalizeRecurringRuleUpdatePayload,
  postFinanceRecurringRuleOccurrence,
  recurringDateToInstant,
  updateFinanceRecurringRule,
  voidFinanceRecurringRuleOccurrence,
} from '../recurringRuleService.js';

const expenseTemplate = {
  kind: 'expense',
  accountId: 1,
  currency: 'pln',
  amountMinor: 355_500,
  categoryId: 2,
  counterpartyType: 'vendor',
  counterpartyId: 3,
  status: 'planned',
  description: 'Rent',
};

describe('recurring rule payload validation', () => {
  it('normalizes a valid payload and strips schedule fields that do not apply', () => {
    const payload = normalizeRecurringRuleCreatePayload({
      kind: 'expense',
      templateJson: expenseTemplate,
      frequency: 'daily',
      interval: 1,
      byMonthDay: 20,
      startDate: '2026-08-31',
      endDate: null,
      timezone: 'Europe/Warsaw',
    });

    expect(payload.byMonthDay).toBeNull();
    expect(payload.status).toBe('active');
    expect(payload.templateJson.currency).toBe('PLN');
  });

  it.each([
    [{ ...expenseTemplate, amountMinor: 0 }, 'amountMinor'],
    [{ ...expenseTemplate, currency: 'PL' }, 'currency'],
    [{ ...expenseTemplate, counterpartyType: 'client' }, 'counterpartyType'],
    [{ ...expenseTemplate, status: 'paid' }, 'planned'],
  ])('rejects an unsafe transaction template', (templateJson, expectedMessage) => {
    expect(() => normalizeRecurringRuleCreatePayload({
      kind: 'expense',
      templateJson,
      frequency: 'monthly',
      interval: 1,
      byMonthDay: 1,
      startDate: '2026-08-31',
      timezone: 'Europe/Warsaw',
    })).toThrow(expectedMessage);
  });

  it('rejects impossible dates, reversed ranges, invalid timezones, and unknown fields', () => {
    const base = {
      kind: 'expense',
      templateJson: expenseTemplate,
      frequency: 'monthly',
      interval: 1,
      byMonthDay: 1,
      startDate: '2026-08-31',
      timezone: 'Europe/Warsaw',
    };

    expect(() => normalizeRecurringRuleCreatePayload({ ...base, startDate: '2026-02-30' }))
      .toThrow('valid calendar date');
    expect(() => normalizeRecurringRuleCreatePayload({ ...base, endDate: '2026-08-01' }))
      .toThrow('on or after');
    expect(() => normalizeRecurringRuleCreatePayload({ ...base, timezone: 'Not/A_Timezone' }))
      .toThrow('valid IANA timezone');
    expect(() => normalizeRecurringRuleCreatePayload({ ...base, createdBy: 999 }))
      .toThrow('unsupported fields');
  });

  it('uses HTTP 400 errors for invalid client payloads', () => {
    try {
      normalizeRecurringRuleCreatePayload(null);
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(400);
    }
  });

  it('allows nullable schedule fields to be explicitly cleared on update', () => {
    const existing = normalizeRecurringRuleCreatePayload({
      kind: 'expense',
      templateJson: expenseTemplate,
      frequency: 'monthly',
      interval: 1,
      byMonthDay: 15,
      startDate: '2026-08-01',
      endDate: '2026-12-31',
      timezone: 'Europe/Warsaw',
    });

    const updated = normalizeRecurringRuleUpdatePayload({
      byMonthDay: null,
      endDate: null,
    }, existing);

    expect(updated.byMonthDay).toBeNull();
    expect(updated.endDate).toBeNull();
  });
});

describe('recurring schedule calculations', () => {
  it('keeps the monthly anchor after clamping short months', () => {
    const schedule = {
      frequency: 'monthly' as const,
      interval: 1,
      byMonthDay: 31,
      startDate: '2027-01-31',
      endDate: null,
      timezone: 'Europe/Warsaw',
    };

    const february = computeNextRecurringDate(schedule, '2027-01-31');
    const march = computeNextRecurringDate(schedule, february);
    expect(february).toBe('2027-02-28');
    expect(march).toBe('2027-03-31');
  });

  it('restores February 29 on a later leap year', () => {
    const schedule = {
      frequency: 'yearly' as const,
      interval: 1,
      byMonthDay: 29,
      startDate: '2024-02-29',
      endDate: null,
      timezone: 'Europe/Warsaw',
    };

    let occurrence = computeNextRecurringDate(schedule, '2024-02-29');
    occurrence = computeNextRecurringDate(schedule, occurrence);
    occurrence = computeNextRecurringDate(schedule, occurrence);
    occurrence = computeNextRecurringDate(schedule, occurrence);
    expect(occurrence).toBe('2028-02-29');
  });

  it('efficiently finds the next daily, weekly, and monthly occurrence', () => {
    expect(computeFirstRecurringDateOnOrAfter({
      frequency: 'daily',
      interval: 3,
      byMonthDay: null,
      startDate: '2020-01-01',
      endDate: null,
      timezone: 'UTC',
    }, '2026-08-31')).toBe('2026-09-02');

    expect(computeFirstRecurringDateOnOrAfter({
      frequency: 'weekly',
      interval: 2,
      byMonthDay: null,
      startDate: '2026-08-03',
      endDate: null,
      timezone: 'UTC',
    }, '2026-08-31')).toBe('2026-08-31');

    expect(computeFirstRecurringDateOnOrAfter({
      frequency: 'monthly',
      interval: 1,
      byMonthDay: 31,
      startDate: '2026-01-01',
      endDate: null,
      timezone: 'UTC',
    }, '2026-04-01')).toBe('2026-04-30');
  });

  it('stores a due date as local midnight in the rule timezone', () => {
    expect(recurringDateToInstant('2026-08-31', 'Europe/Warsaw').toISOString())
      .toBe('2026-08-30T22:00:00.000Z');
  });
});

const databaseTransaction = sequelize.transaction as unknown as jest.Mock;
const recurringFindAll = FinanceRecurringRule.findAll as unknown as jest.Mock;
const recurringFindByPk = FinanceRecurringRule.findByPk as unknown as jest.Mock;
const recurringUpdate = FinanceRecurringRule.update as unknown as jest.Mock;
const recurringCreate = FinanceRecurringRule.create as unknown as jest.Mock;
const accountFindByPk = FinanceAccount.findByPk as unknown as jest.Mock;
const categoryFindByPk = FinanceCategory.findByPk as unknown as jest.Mock;
const vendorFindByPk = FinanceVendor.findByPk as unknown as jest.Mock;
const fundFindOne = VolunteerFund.findOne as unknown as jest.Mock;
const transactionFindOne = FinanceTransaction.findOne as unknown as jest.Mock;
const createTransaction = createFinanceTransaction as jest.Mock;
const updateTransaction = updateFinanceTransaction as jest.Mock;
const audit = recordFinanceAuditLog as jest.Mock;

const mockDbTransaction = { LOCK: { UPDATE: 'UPDATE' } };

const makeRule = (overrides: Record<string, unknown> = {}) => {
  const rule: Record<string, any> = {
    id: 1,
    kind: 'expense',
    templateJson: { ...expenseTemplate, currency: 'PLN' },
    frequency: 'daily',
    interval: 1,
    byMonthDay: null,
    startDate: '2026-08-01',
    endDate: null,
    timezone: 'UTC',
    nextRunDate: new Date('2026-08-01T00:00:00.000Z'),
    lastRunAt: null,
    status: 'active',
    completedAt: null,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    updatedBy: null,
    ...overrides,
  };
  rule.update = jest.fn(async (changes: Record<string, unknown>) => {
    Object.assign(rule, changes);
    return rule;
  });
  rule.toJSON = jest.fn(() => ({ ...rule }));
  return rule;
};

const setValidReferenceMocks = () => {
  accountFindByPk.mockResolvedValue({ id: 1, isActive: true, currency: 'PLN' });
  categoryFindByPk.mockResolvedValue({ id: 2, isActive: true, kind: 'expense' });
  vendorFindByPk.mockResolvedValue({ id: 3, isActive: true });
  fundFindOne.mockResolvedValue(null);
};

describe('recurring execution hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    databaseTransaction.mockImplementation(async (callback: (transaction: unknown) => unknown) =>
      callback(mockDbTransaction));
    recurringUpdate.mockResolvedValue([1]);
    transactionFindOne.mockResolvedValue(null);
    createTransaction.mockResolvedValue({ id: 500 });
    audit.mockResolvedValue({ id: 1 });
    setValidReferenceMocks();
  });

  it('catches up multiple due occurrences within a bound and leaves the next due run deferred', async () => {
    const rule = makeRule();
    recurringFindAll.mockResolvedValue([{ id: 1 }]);
    recurringFindByPk.mockResolvedValue(rule);

    const result = await executeRecurringRules(7, {
      now: new Date('2026-08-03T12:00:00.000Z'),
      maxCatchUpPerRule: 2,
    });

    expect(createTransaction).toHaveBeenCalledTimes(2);
    expect(createTransaction.mock.calls.map(([input]) => input.date)).toEqual([
      '2026-08-01',
      '2026-08-02',
    ]);
    expect(result).toMatchObject({
      processed: 1,
      createdTransactions: 2,
      failed: 0,
      deferred: 1,
    });
    expect(rule.update).toHaveBeenCalledWith(expect.objectContaining({
      nextRunDate: new Date('2026-08-03T00:00:00.000Z'),
      consecutiveFailures: 0,
    }), expect.any(Object));
  });

  it('isolates a failed rule, persists its health, and continues with the next rule', async () => {
    const failedRule = makeRule({
      id: 1,
      templateJson: { ...expenseTemplate, accountId: 99, currency: 'PLN' },
    });
    const healthyRule = makeRule({ id: 2 });
    recurringFindAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    recurringFindByPk.mockImplementation(async (id: number) => (id === 1 ? failedRule : healthyRule));
    accountFindByPk.mockImplementation(async (id: number) => (
      id === 99 ? null : { id, isActive: true, currency: 'PLN' }
    ));

    const result = await executeRecurringRules(7, {
      now: new Date('2026-08-01T12:00:00.000Z'),
      maxCatchUpPerRule: 1,
    });

    expect(result.failed).toBe(1);
    expect(result.createdTransactions).toBe(1);
    expect(result.failures[0]).toMatchObject({ ruleId: 1 });
    expect(failedRule.update).not.toHaveBeenCalled();
    expect(recurringUpdate).toHaveBeenCalledWith(expect.objectContaining({
      lastError: expect.stringContaining('account'),
      lastErrorAt: new Date('2026-08-01T12:00:00.000Z'),
    }), { where: { id: 1 } });
    expect(createTransaction).toHaveBeenCalledTimes(1);
  });

  it('marks an ended rule completed without creating past-end occurrences', async () => {
    const rule = makeRule({
      endDate: '2026-08-02',
      nextRunDate: new Date('2026-08-03T00:00:00.000Z'),
    });
    recurringFindAll.mockResolvedValue([{ id: 1 }]);
    recurringFindByPk.mockResolvedValue(rule);

    const result = await executeRecurringRules(7, {
      now: new Date('2026-08-04T12:00:00.000Z'),
    });

    expect(createTransaction).not.toHaveBeenCalled();
    expect(result.completed).toBe(1);
    expect(rule.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      nextRunDate: null,
      completedAt: new Date('2026-08-04T12:00:00.000Z'),
    }), expect.any(Object));
  });
});

describe('recurring lifecycle and occurrence actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    databaseTransaction.mockImplementation(async (callback: (transaction: unknown) => unknown) =>
      callback(mockDbTransaction));
    audit.mockResolvedValue({ id: 1 });
    setValidReferenceMocks();
  });

  it('reuses an outer management-request transaction instead of committing independently', async () => {
    const createdRule = makeRule();
    recurringCreate.mockResolvedValue(createdRule);

    await createFinanceRecurringRule({
      kind: 'expense',
      templateJson: expenseTemplate,
      frequency: 'monthly',
      interval: 1,
      byMonthDay: 1,
      startDate: '2026-09-01',
      endDate: null,
      timezone: 'Europe/Warsaw',
    }, 7, {
      transaction: mockDbTransaction as any,
      now: new Date('2026-08-31T12:00:00.000Z'),
    });

    expect(databaseTransaction).not.toHaveBeenCalled();
    expect(recurringCreate).toHaveBeenCalledWith(expect.objectContaining({
      createdBy: 7,
      status: 'active',
    }), { transaction: mockDbTransaction });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      entity: 'finance_recurring_rule',
      action: 'create',
      transaction: mockDbTransaction,
    }));
  });

  it('allows a failing rule to be paused without revalidating stale references', async () => {
    const rule = makeRule({
      lastError: 'Vendor is inactive',
      lastErrorAt: new Date('2026-08-31T00:00:00.000Z'),
      consecutiveFailures: 4,
    });
    recurringFindByPk.mockResolvedValue(rule);

    const updated = await updateFinanceRecurringRule(1, { status: 'paused' }, 7);

    expect(accountFindByPk).not.toHaveBeenCalled();
    expect(updated.status).toBe('paused');
    expect(updated.lastError).toBe('Vendor is inactive');
  });

  it('treats already-posted and already-void occurrences idempotently', async () => {
    recurringFindByPk.mockResolvedValue({ id: 1 });
    const paid = { id: 10, status: 'paid' };
    const voided = { id: 11, status: 'void' };
    transactionFindOne
      .mockResolvedValueOnce(paid)
      .mockResolvedValueOnce(voided);

    await expect(postFinanceRecurringRuleOccurrence(1, 10, 7))
      .resolves.toEqual({ transaction: paid, changed: false });
    await expect(voidFinanceRecurringRuleOccurrence(1, 11, 7))
      .resolves.toEqual({ transaction: voided, changed: false });
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it('refuses to mutate a transaction that is not owned by the requested rule', async () => {
    recurringFindByPk.mockResolvedValue({ id: 1 });
    transactionFindOne.mockResolvedValue(null);

    await expect(postFinanceRecurringRuleOccurrence(1, 999, 7))
      .rejects.toMatchObject({ status: 404, message: 'Recurring occurrence not found' });
  });
});
