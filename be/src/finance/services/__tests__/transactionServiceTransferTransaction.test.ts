jest.mock('../../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../auditLogService.js', () => ({ recordFinanceAuditLog: jest.fn() }));
jest.mock('../../../services/staffPayoutReceiptProtectionService.js', () => ({
  assertCounterpartyIsNotStaffPayment: jest.fn(),
  assertFinanceTransactionIsNotReceiptProtected: jest.fn(),
}));
jest.mock('../../models/FinanceFile.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../models/VolunteerFundEntry.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../models/VolunteerFund.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));

import sequelize from '../../../config/database.js';
import FinanceTransaction from '../../models/FinanceTransaction.js';
import VolunteerFund from '../../models/VolunteerFund.js';
import { createFinanceTransfer } from '../transactionService.js';

describe('createFinanceTransfer transaction ownership', () => {
  const outerTransaction = { LOCK: { UPDATE: 'UPDATE' } } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    (VolunteerFund.findAll as jest.Mock).mockResolvedValue([]);
    let nextId = 50;
    (FinanceTransaction.create as jest.Mock).mockImplementation(async (payload) => ({
      id: ++nextId,
      ...payload,
      toJSON: () => payload,
    }));
  });

  it('creates both rows in a supplied outer transaction without nesting a new one', async () => {
    const pair = await createFinanceTransfer(
      {
        fromAccountId: 1,
        toAccountId: 2,
        amountMinor: 30_000,
        currency: 'PLN',
        status: 'paid',
        date: '2026-08-31',
        meta: { source: 'volunteer-fund-allocation' },
      },
      9,
      { transaction: outerTransaction },
    );

    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(FinanceTransaction.create).toHaveBeenCalledTimes(2);
    expect(FinanceTransaction.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        accountId: 1,
        kind: 'transfer',
        status: 'paid',
        meta: expect.objectContaining({
          source: 'volunteer-fund-allocation',
          direction: 'out',
          counter_account_id: 2,
        }),
      }),
      { transaction: outerTransaction },
    );
    expect(FinanceTransaction.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        accountId: 2,
        kind: 'transfer',
        status: 'paid',
        meta: expect.objectContaining({
          source: 'volunteer-fund-allocation',
          direction: 'in',
          counter_account_id: 1,
        }),
      }),
      { transaction: outerTransaction },
    );
    expect(pair.debit.id).toBe(51);
    expect(pair.credit.id).toBe(52);
    expect(pair.debit.meta?.transfer_group_id).toBe(pair.credit.meta?.transfer_group_id);
  });
});
