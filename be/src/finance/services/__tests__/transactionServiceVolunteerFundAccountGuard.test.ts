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
jest.mock('../../models/VolunteerFund.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/VolunteerFundEntry.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), findByPk: jest.fn() },
}));

import { Op } from 'sequelize';
import FinanceTransaction from '../../models/FinanceTransaction.js';
import VolunteerFund from '../../models/VolunteerFund.js';
import VolunteerFundEntry from '../../models/VolunteerFundEntry.js';
import {
  createFinanceTransaction,
  createFinanceTransfer,
  updateFinanceTransaction,
} from '../transactionService.js';

describe('Volunteer Fund linked account routing guards', () => {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;
  let nextId = 50;

  const expenseInput = {
    kind: 'expense' as const,
    date: '2026-08-31',
    accountId: 2,
    currency: 'PLN',
    amountMinor: 12_500,
    categoryId: 7,
    counterpartyType: 'vendor' as const,
    counterpartyId: 9,
    status: 'paid' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    nextId = 50;
    (VolunteerFund.findAll as jest.Mock).mockResolvedValue([]);
    (VolunteerFundEntry.findOne as jest.Mock).mockResolvedValue(null);
    (FinanceTransaction.create as jest.Mock).mockImplementation(async (payload) => ({
      id: ++nextId,
      ...payload,
      toJSON: () => payload,
    }));
  });

  it('blocks a general expense on an account linked to an active Volunteer Fund', async () => {
    (VolunteerFund.findAll as jest.Mock).mockResolvedValue([
      { id: 4, name: 'Volunteer Fund', linkedAccountId: 2 },
    ]);

    await expect(createFinanceTransaction(expenseInput, 9, { transaction }))
      .rejects.toThrow(/Volunteer Fund spend flow/i);

    expect(FinanceTransaction.create).not.toHaveBeenCalled();
    expect(VolunteerFund.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        isActive: true,
        linkedAccountId: { [Op.in]: [2] },
      },
      transaction,
    }));
  });

  it.each(['income', 'refund', 'transfer'] as const)(
    'blocks a direct %s on an account linked to an active Volunteer Fund',
    async (kind) => {
      (VolunteerFund.findAll as jest.Mock).mockResolvedValue([
        { id: 4, name: 'Volunteer Fund', linkedAccountId: 2 },
      ]);
      const input = {
        ...expenseInput,
        kind,
        categoryId: null,
        counterpartyType: kind === 'income' ? 'client' as const : 'none' as const,
        counterpartyId: kind === 'income' ? 11 : null,
      };

      await expect(createFinanceTransaction(input, 9, { transaction }))
        .rejects.toThrow(/trusted Volunteer Fund workflows|allocation flow/i);

      expect(FinanceTransaction.create).not.toHaveBeenCalled();
    },
  );

  it('allows only the exact trusted fund spend flow for the linked account', async () => {
    (VolunteerFund.findAll as jest.Mock).mockResolvedValue([
      { id: 4, name: 'Volunteer Fund', linkedAccountId: 2 },
    ]);

    await expect(createFinanceTransaction(
      expenseInput,
      9,
      { transaction, allowVolunteerFundSpendForFundId: 4 },
    )).resolves.toEqual(expect.objectContaining({ id: 51, accountId: 2 }));

    await expect(createFinanceTransaction(
      expenseInput,
      9,
      { transaction, allowVolunteerFundSpendForFundId: 5 },
    )).rejects.toThrow(/does not match the active fund/i);
  });

  it('fails closed when an account is linked to multiple active funds', async () => {
    (VolunteerFund.findAll as jest.Mock).mockResolvedValue([
      { id: 4, name: 'Volunteer Fund', linkedAccountId: 2 },
      { id: 5, name: 'Second Fund', linkedAccountId: 2 },
    ]);

    await expect(createFinanceTransaction(
      expenseInput,
      9,
      { transaction, allowVolunteerFundSpendForFundId: 4 },
    )).rejects.toThrow(/multiple active Volunteer Funds/i);

    expect(FinanceTransaction.create).not.toHaveBeenCalled();
  });

  it('blocks general transfers involving a Volunteer Fund linked account', async () => {
    (VolunteerFund.findAll as jest.Mock).mockResolvedValue([
      { id: 4, name: 'Volunteer Fund', linkedAccountId: 2 },
    ]);

    await expect(createFinanceTransfer(
      {
        fromAccountId: 1,
        toAccountId: 2,
        amountMinor: 12_500,
        currency: 'PLN',
        date: '2026-08-31',
      },
      9,
      { transaction },
    )).rejects.toThrow(/Volunteer Fund allocation flow/i);

    expect(FinanceTransaction.create).not.toHaveBeenCalled();
  });

  it('allows the exact trusted fund allocation to create its transfer pair', async () => {
    (VolunteerFund.findAll as jest.Mock).mockResolvedValue([
      { id: 4, name: 'Volunteer Fund', linkedAccountId: 2 },
    ]);

    await expect(createFinanceTransfer(
      {
        fromAccountId: 1,
        toAccountId: 2,
        amountMinor: 12_500,
        currency: 'PLN',
        date: '2026-08-31',
      },
      9,
      { transaction, allowVolunteerFundAllocationForFundId: 4 },
    )).resolves.toEqual({
      debit: expect.objectContaining({ id: 51, accountId: 1 }),
      credit: expect.objectContaining({ id: 52, accountId: 2 }),
    });

    expect(FinanceTransaction.create).toHaveBeenCalledTimes(2);
  });

  it('blocks editing an ordinary transaction onto a fund-linked account', async () => {
    const record = {
      id: 55,
      kind: 'expense',
      date: '2026-08-31',
      accountId: 1,
      currency: 'PLN',
      amountMinor: 12_500,
      fxRate: '1',
      categoryId: 7,
      counterpartyType: 'vendor',
      counterpartyId: 9,
      status: 'paid',
      meta: null,
      update: jest.fn(),
      toJSON: jest.fn().mockReturnValue({}),
    };
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue(record);
    (VolunteerFund.findAll as jest.Mock).mockResolvedValue([
      { id: 4, name: 'Volunteer Fund', linkedAccountId: 2 },
    ]);

    await expect(updateFinanceTransaction(
      55,
      { accountId: 2 },
      9,
      { transaction },
    )).rejects.toThrow(/Volunteer Fund spend flow/i);

    expect(record.update).not.toHaveBeenCalled();
  });

  it.each(['income', 'expense', 'refund', 'transfer'] as const)(
    'blocks ordinary edits that leave a legacy %s on a fund-linked account',
    async (kind) => {
      const record = {
        id: 56,
        kind,
        date: '2026-08-31',
        accountId: 2,
        currency: 'PLN',
        amountMinor: 12_500,
        fxRate: '1',
        categoryId: kind === 'expense' ? 7 : null,
        counterpartyType: kind === 'expense' ? 'vendor' : 'none',
        counterpartyId: kind === 'expense' ? 9 : null,
        status: 'paid',
        meta: null,
        update: jest.fn(),
        toJSON: jest.fn().mockReturnValue({}),
      };
      (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue(record);
      (VolunteerFund.findAll as jest.Mock).mockResolvedValue([
        { id: 4, name: 'Volunteer Fund', linkedAccountId: 2 },
      ]);

      await expect(updateFinanceTransaction(
        56,
        { description: 'Changed after the fund was linked' },
        9,
        { transaction },
      )).rejects.toThrow(/Volunteer Fund (spend|allocation) flow|trusted Volunteer Fund workflows/i);

      expect(record.update).not.toHaveBeenCalled();
    },
  );

  it('allows a legacy ordinary expense to be moved off the fund-linked account', async () => {
    const record = {
      id: 57,
      kind: 'expense',
      date: '2026-08-31',
      accountId: 2,
      currency: 'PLN',
      amountMinor: 12_500,
      fxRate: '1',
      baseAmountMinor: 12_500,
      categoryId: 7,
      counterpartyType: 'vendor',
      counterpartyId: 9,
      status: 'paid',
      meta: null,
      update: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({}),
    };
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue(record);
    (VolunteerFund.findAll as jest.Mock).mockResolvedValue([]);

    await expect(updateFinanceTransaction(
      57,
      { accountId: 1 },
      9,
      { transaction },
    )).resolves.toBe(record);

    expect(VolunteerFund.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ linkedAccountId: { [Op.in]: [1] } }),
    }));
    expect(record.update).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 1 }),
      { transaction },
    );
  });
});
