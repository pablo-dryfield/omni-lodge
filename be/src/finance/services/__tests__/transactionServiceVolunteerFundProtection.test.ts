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
jest.mock('../../models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/VolunteerFundEntry.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

import FinanceTransaction from '../../models/FinanceTransaction.js';
import VolunteerFundEntry from '../../models/VolunteerFundEntry.js';
import { updateFinanceTransaction } from '../transactionService.js';

describe('Finance transaction protection for Volunteer Fund spends', () => {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;

  const createRecord = () => ({
    id: 55,
    kind: 'expense',
    date: '2026-08-29',
    accountId: 3,
    currency: 'PLN',
    amountMinor: 2_500,
    fxRate: '1',
    categoryId: 7,
    counterpartyType: 'vendor',
    counterpartyId: 9,
    status: 'paid',
    update: jest.fn().mockResolvedValue(undefined),
    toJSON: jest.fn().mockReturnValue({}),
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects an ordinary edit of an expense backing a fund spend', async () => {
    const record = createRecord();
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue(record);
    (VolunteerFundEntry.findOne as jest.Mock).mockResolvedValue({ id: 91 });

    await expect(updateFinanceTransaction(
      55,
      { amountMinor: 3_000 },
      1,
      { transaction },
    )).rejects.toThrow(/backs a Volunteer Fund spend/i);

    expect(record.update).not.toHaveBeenCalled();
  });

  it('allows only the internal atomic void used by a fund spend reversal', async () => {
    const record = createRecord();
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue(record);
    (VolunteerFundEntry.findOne as jest.Mock).mockResolvedValue({ id: 91 });

    await expect(updateFinanceTransaction(
      55,
      { status: 'void' },
      1,
      { transaction, allowVolunteerFundSpendReversal: true },
    )).resolves.toBe(record);

    expect(record.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'void' }),
      { transaction },
    );
  });
});
