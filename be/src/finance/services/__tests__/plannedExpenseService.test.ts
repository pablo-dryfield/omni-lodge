jest.mock('../../../config/database.js', () => ({
  __esModule: true,
  default: {
    transaction: jest.fn(),
  },
}));
jest.mock('../../../models/StaffProfile.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn(), findAll: jest.fn() },
}));
jest.mock('../../../models/User.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../../services/configService.js', () => ({ getConfigValue: jest.fn() }));
jest.mock('../../../services/staffPayoutReceiptProtectionService.js', () => ({
  STAFF_PAYMENT_REQUIRES_PAYS_MESSAGE: 'staff payments require Pays',
  STAFF_PAYOUT_RECEIPT_TRANSACTION_PROTECTED_MESSAGE: 'receipt protected',
}));
jest.mock('../../models/FinanceAccount.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/FinanceCategory.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/FinanceVendor.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/VolunteerFund.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../models/VolunteerFundEntry.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../transactionService.js', () => ({ updateFinanceTransaction: jest.fn() }));

import sequelize from '../../../config/database.js';
import StaffProfile from '../../../models/StaffProfile.js';
import User from '../../../models/User.js';
import { getConfigValue } from '../../../services/configService.js';
import FinanceAccount from '../../models/FinanceAccount.js';
import FinanceCategory from '../../models/FinanceCategory.js';
import FinanceTransaction from '../../models/FinanceTransaction.js';
import FinanceVendor from '../../models/FinanceVendor.js';
import VolunteerFund from '../../models/VolunteerFund.js';
import VolunteerFundEntry from '../../models/VolunteerFundEntry.js';
import {
  applyPlannedExpenseAction,
  PlannedExpenseActionError,
} from '../plannedExpenseService.js';
import { updateFinanceTransaction } from '../transactionService.js';

const databaseTransaction = { LOCK: { UPDATE: 'UPDATE' } };
const runTransaction = sequelize.transaction as jest.Mock;
const transactionFindByPk = FinanceTransaction.findByPk as jest.Mock;
const accountFindByPk = FinanceAccount.findByPk as jest.Mock;
const categoryFindByPk = FinanceCategory.findByPk as jest.Mock;
const vendorFindByPk = FinanceVendor.findByPk as jest.Mock;
const fundFindOne = VolunteerFund.findOne as jest.Mock;
const fundEntryFindOne = VolunteerFundEntry.findOne as jest.Mock;
const profileFindByPk = StaffProfile.findByPk as jest.Mock;
const userFindByPk = User.findByPk as jest.Mock;
const updateTransaction = updateFinanceTransaction as jest.Mock;
const configValue = getConfigValue as jest.Mock;

const plannedExpense = (overrides: Record<string, unknown> = {}) => ({
  id: 44,
  kind: 'expense',
  status: 'planned',
  date: '2026-08-28',
  accountId: 3,
  currency: 'PLN',
  amountMinor: 12500,
  categoryId: 8,
  counterpartyType: 'vendor',
  counterpartyId: 9,
  nightReportId: null,
  receiptGroupKey: null,
  meta: { memo: 'keep me' },
  ...overrides,
});

describe('applyPlannedExpenseAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T10:00:00.000Z'));
    runTransaction.mockImplementation(async (callback: (transaction: unknown) => unknown) => (
      callback(databaseTransaction)
    ));
    configValue.mockReturnValue('Europe/Warsaw');
    transactionFindByPk.mockResolvedValue(plannedExpense());
    accountFindByPk.mockResolvedValue({ id: 3, isActive: true, currency: 'PLN' });
    categoryFindByPk.mockResolvedValue({ id: 8, isActive: true, kind: 'expense' });
    vendorFindByPk.mockResolvedValue({ id: 9, isActive: true });
    fundFindOne.mockResolvedValue(null);
    fundEntryFindOne.mockResolvedValue(null);
    updateTransaction.mockResolvedValue({ id: 44, status: 'paid' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('locks and posts a company-paid expense using today while preserving provenance', async () => {
    const result = await applyPlannedExpenseAction(
      44,
      { action: 'pay' },
      7,
    );

    expect(transactionFindByPk).toHaveBeenCalledWith(44, {
      transaction: databaseTransaction,
      lock: 'UPDATE',
    });
    expect(updateTransaction).toHaveBeenCalledWith(
      44,
      {
        status: 'paid',
        date: '2026-09-01',
        meta: expect.objectContaining({
          memo: 'keep me',
          plannedExpenseScheduledFor: '2026-08-28',
          plannedExpenseAction: 'pay',
          plannedExpenseActionBy: 7,
        }),
      },
      7,
      { transaction: databaseTransaction },
    );
    expect(result).toEqual({ id: 44, status: 'paid' });
  });

  it('attributes a staff-paid expense only to an active staff/vendor identity', async () => {
    profileFindByPk.mockResolvedValue({
      userId: 12,
      active: true,
      financeVendorId: 30,
    });
    userFindByPk.mockResolvedValue({ id: 12, status: true, approved: true });
    vendorFindByPk.mockImplementation(async (id: number) => ({ id, isActive: true }));
    updateTransaction.mockResolvedValue({ id: 44, status: 'awaiting_reimbursement' });

    await applyPlannedExpenseAction(
      44,
      { action: 'staff_paid', paidByUserId: 12, paymentDate: '2026-08-31' },
      7,
    );

    expect(updateTransaction).toHaveBeenCalledWith(
      44,
      expect.objectContaining({
        status: 'awaiting_reimbursement',
        date: '2026-08-31',
        meta: expect.objectContaining({ paidByUserId: 12 }),
      }),
      7,
      { transaction: databaseTransaction },
    );
  });

  it('rejects stale and system-managed rows with conflict semantics', async () => {
    transactionFindByPk.mockResolvedValueOnce(plannedExpense({ status: 'paid' }));
    await expect(applyPlannedExpenseAction(44, { action: 'pay' }, 7)).rejects.toMatchObject({
      status: 409,
    } satisfies Partial<PlannedExpenseActionError>);
    expect(updateTransaction).not.toHaveBeenCalled();

    transactionFindByPk.mockResolvedValueOnce(plannedExpense({ meta: { source: 'night-report-cost' } }));
    await expect(applyPlannedExpenseAction(44, { action: 'pay' }, 7)).rejects.toMatchObject({
      status: 409,
    } satisfies Partial<PlannedExpenseActionError>);
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it('requires recurring update permission only for recurring-generated rows', async () => {
    transactionFindByPk.mockResolvedValue(plannedExpense({
      meta: { recurring_rule_id: 18, recurring_scheduled_for: '2026-08-28' },
    }));

    await expect(applyPlannedExpenseAction(44, { action: 'pay' }, 7)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<PlannedExpenseActionError>);
    expect(updateTransaction).not.toHaveBeenCalled();

    await applyPlannedExpenseAction(
      44,
      { action: 'pay' },
      7,
      { allowRecurringUpdate: true },
    );
    expect(updateTransaction).toHaveBeenCalledWith(
      44,
      expect.objectContaining({
        status: 'paid',
        meta: expect.objectContaining({
          recurring_rule_id: 18,
          recurring_scheduled_for: '2026-08-28',
        }),
      }),
      7,
      { transaction: databaseTransaction },
    );
  });

  it('rejects Volunteer Fund-linked records before any status change', async () => {
    fundFindOne.mockResolvedValue({ id: 2 });

    await expect(applyPlannedExpenseAction(44, { action: 'pay' }, 7)).rejects.toMatchObject({
      status: 409,
    } satisfies Partial<PlannedExpenseActionError>);
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it('rejects void because homepage actions only support posting payment', async () => {
    await expect(applyPlannedExpenseAction(
      44,
      { action: 'void' as never },
      7,
    )).rejects.toMatchObject({
      status: 400,
      message: 'action must be pay or staff_paid',
    } satisfies Partial<PlannedExpenseActionError>);

    expect(runTransaction).not.toHaveBeenCalled();
    expect(updateTransaction).not.toHaveBeenCalled();
  });
});
