import type { Request, Response } from 'express';
import { Op } from 'sequelize';

jest.mock('../../models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    findByPk: jest.fn(),
  },
}));
jest.mock('../../models/FinanceAccount.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/FinanceCategory.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/FinanceVendor.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/FinanceClient.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/FinanceFile.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/transactionService.js', () => ({
  createFinanceTransaction: jest.fn(),
  updateFinanceTransaction: jest.fn(),
  createFinanceTransfer: jest.fn(),
}));
jest.mock('../../services/auditLogService.js', () => ({ recordFinanceAuditLog: jest.fn() }));
jest.mock('../../services/transactionDeletionService.js', () => ({
  deleteFinanceTransactionAndCleanupInvoice: jest.fn(),
  VOLUNTEER_FUND_ALLOCATION_TRANSFER_PROTECTED_MESSAGE: 'protected volunteer transfer',
}));
jest.mock('../../../services/staffPayoutReceiptProtectionService.js', () => ({
  STAFF_PAYOUT_RECEIPT_TRANSACTION_PROTECTED_MESSAGE: 'protected staff payout',
}));
jest.mock('../../../services/configService.js', () => ({
  getConfigValue: jest.fn(),
}));
jest.mock('../../../middleware/authorizationMiddleware.js', () => ({
  hasModuleActionPermission: jest.fn(),
}));
jest.mock('../../services/plannedExpenseService.js', () => {
  class PlannedExpenseActionError extends Error {
    readonly status: number;

    constructor(message: string, httpStatus: number) {
      super(message);
      this.status = httpStatus;
    }
  }
  return {
    applyPlannedExpenseAction: jest.fn(),
    listEligibleExpensePayers: jest.fn(),
    PlannedExpenseActionError,
  };
});

import { getConfigValue } from '../../../services/configService.js';
import { hasModuleActionPermission } from '../../../middleware/authorizationMiddleware.js';
import FinanceTransaction from '../../models/FinanceTransaction.js';
import {
  applyPlannedExpenseAction,
  listEligibleExpensePayers,
  PlannedExpenseActionError,
} from '../../services/plannedExpenseService.js';
import {
  applyPlannedExpenseActionHandler,
  listPlannedExpenseTransactions,
} from '../transactionController.js';

const findAndCountAll = FinanceTransaction.findAndCountAll as unknown as jest.Mock;
const findAll = FinanceTransaction.findAll as unknown as jest.Mock;
const getConfig = getConfigValue as jest.Mock;
const hasPermission = hasModuleActionPermission as jest.Mock;
const applyAction = applyPlannedExpenseAction as jest.Mock;
const listPayers = listEligibleExpensePayers as jest.Mock;

const makeResponse = () => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  return res;
};

const makeTransaction = (id: number, date: string) => ({
  id,
  date,
  toJSON: () => ({ id, date, kind: 'expense', status: 'planned' }),
});

describe('listPlannedExpenseTransactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T10:00:00.000Z'));
    getConfig.mockReturnValue('Europe/Warsaw');
    findAll.mockResolvedValue([]);
    listPayers.mockResolvedValue([]);
    hasPermission.mockResolvedValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns one globally sorted, bounded planned-expense queue with due states', async () => {
    hasPermission.mockResolvedValue(true);
    listPayers.mockResolvedValue([{ userId: 12, fullName: 'Aimee Kelly' }]);
    findAndCountAll.mockResolvedValue({
      count: 3,
      rows: [
        makeTransaction(1, '2026-08-20'),
        makeTransaction(2, '2026-09-01'),
        makeTransaction(3, '2026-09-03'),
      ],
    });
    findAll.mockResolvedValue([
      {
        currency: 'EUR',
        totalCount: '1',
        overdueCount: '0',
        dueTodayCount: '0',
        upcomingCount: '1',
        totalMinor: '5000',
        overdueMinor: '0',
        dueTodayMinor: '0',
        upcomingMinor: '5000',
      },
      {
        currency: 'PLN',
        totalCount: '4',
        overdueCount: '2',
        dueTodayCount: '1',
        upcomingCount: '1',
        totalMinor: '100000',
        overdueMinor: '60000',
        dueTodayMinor: '20000',
        upcomingMinor: '20000',
      },
    ]);
    const req = { query: { limit: '500', offset: '-2' } } as unknown as Request;
    const res = makeResponse();

    await listPlannedExpenseTransactions(req, res);

    expect(findAndCountAll).toHaveBeenCalledTimes(1);
    const options = findAndCountAll.mock.calls[0][0];
    expect(options.where).toEqual({ kind: 'expense', status: 'planned' });
    expect(options.limit).toBe(50);
    expect(options.offset).toBe(0);
    expect(options.order[0].val).toContain('2026-09-01');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ id: 1, dueState: 'overdue' }),
        expect.objectContaining({ id: 2, dueState: 'due_today' }),
        expect.objectContaining({ id: 3, dueState: 'upcoming' }),
      ],
      summary: {
        counts: { total: 5, overdue: 2, dueToday: 1, upcoming: 2 },
        amountsByCurrency: [
          {
            currency: 'EUR',
            totalMinor: 5000,
            overdueMinor: 0,
            dueTodayMinor: 0,
            upcomingMinor: 5000,
          },
          {
            currency: 'PLN',
            totalMinor: 100000,
            overdueMinor: 60000,
            dueTodayMinor: 20000,
            upcomingMinor: 20000,
          },
        ],
      },
      options: { eligiblePayers: [{ userId: 12, fullName: 'Aimee Kelly' }] },
      meta: {
        count: 3,
        limit: 50,
        offset: 0,
        today: '2026-09-01',
        timezone: 'Europe/Warsaw',
        timing: 'all',
      },
    });
  });

  it('supports an overdue-only queue using the same server business date', async () => {
    findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    const req = { query: { timing: 'overdue', limit: '5', offset: '10' } } as unknown as Request;
    const res = makeResponse();

    await listPlannedExpenseTransactions(req, res);

    const options = findAndCountAll.mock.calls[0][0];
    expect(options.where.kind).toBe('expense');
    expect(options.where.status).toBe('planned');
    expect(options.where.date[Op.lt]).toBe('2026-09-01');
    expect(options.limit).toBe(5);
    expect(options.offset).toBe(10);
    expect(listPayers).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ options: {} }));
  });

  it('rejects an unsupported timing filter before querying finance data', async () => {
    const req = { query: { timing: 'late-ish' } } as unknown as Request;
    const res = makeResponse();

    await listPlannedExpenseTransactions(req, res);

    expect(findAndCountAll).not.toHaveBeenCalled();
    expect(findAll).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith([
      { message: 'timing must be all, overdue, due_today, or upcoming' },
    ]);
  });

  it('falls back to Warsaw when the configured timezone is invalid', async () => {
    getConfig.mockReturnValue('Invalid/Timezone');
    findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    const req = { query: {} } as unknown as Request;
    const res = makeResponse();

    await listPlannedExpenseTransactions(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ timezone: 'Europe/Warsaw' }),
    }));
  });
});

describe('applyPlannedExpenseActionHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hasPermission.mockResolvedValue(false);
  });

  it('passes the dynamic recurring permission and returns the updated transaction', async () => {
    hasPermission.mockResolvedValue(true);
    applyAction.mockResolvedValue({ id: 11, status: 'paid' });
    const req = {
      params: { id: '11' },
      body: { action: 'pay' },
      authContext: { id: 7 },
    } as unknown as Request;
    const res = makeResponse();

    await applyPlannedExpenseActionHandler(req, res);

    expect(hasPermission).toHaveBeenCalledWith(
      req,
      'finance-recurring',
      'update',
    );
    expect(applyAction).toHaveBeenCalledWith(
      '11',
      { action: 'pay' },
      7,
      { allowRecurringUpdate: true },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: { id: 11, status: 'paid' } });
  });

  it('preserves safe action error statuses', async () => {
    applyAction.mockRejectedValue(new PlannedExpenseActionError('stale', 409));
    const req = {
      params: { id: '11' },
      body: { action: 'pay' },
      authContext: { id: 7 },
    } as unknown as Request;
    const res = makeResponse();

    await applyPlannedExpenseActionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith([{ message: 'stale' }]);
  });
});
