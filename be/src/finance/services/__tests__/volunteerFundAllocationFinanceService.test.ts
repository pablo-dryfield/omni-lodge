jest.mock('../../models/FinanceAccount.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn(), findAll: jest.fn() },
}));
jest.mock('../transactionService.js', () => ({
  createFinanceTransfer: jest.fn(),
  updateFinanceTransaction: jest.fn(),
}));

import HttpError from '../../../errors/HttpError.js';
import FinanceAccount from '../../models/FinanceAccount.js';
import FinanceTransaction from '../../models/FinanceTransaction.js';
import { createFinanceTransfer, updateFinanceTransaction } from '../transactionService.js';
import {
  createVolunteerFundAllocationTransfer,
  reverseVolunteerFundAllocationTransfer,
} from '../volunteerFundAllocationFinanceService.js';

describe('Volunteer Fund allocation Finance transfers', () => {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;
  const fund = {
    id: 4,
    name: 'Volunteer Fund',
    currency: 'PLN',
    fundingSourceAccountId: 1,
    linkedAccountId: 2,
  } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    (FinanceAccount.findAll as jest.Mock).mockResolvedValue([
      { id: 1, currency: 'PLN', isActive: true },
      { id: 2, currency: 'PLN', isActive: true },
    ]);
  });

  it('creates a paid pair inside the caller transaction with stable allocation metadata', async () => {
    (createFinanceTransfer as jest.Mock).mockResolvedValue({
      debit: {
        id: 51,
        meta: { direction: 'out', transfer_group_id: 'group-1' },
      },
      credit: {
        id: 52,
        meta: { direction: 'in', transfer_group_id: 'group-1' },
      },
    });

    await expect(createVolunteerFundAllocationTransfer({
      fund,
      allocationIdempotencyKey: 'staff-settlement:batch:fund:item',
      amountMinor: 30_000,
      date: '2026-08-31',
      description: 'Volunteer compensation allocation',
      payoutBatchKey: 'batch',
      settlementRequestId: 'request-1',
      staffUserId: 191,
      sourceKey: 'guide_commission',
      componentId: 7,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      actorId: 9,
      transaction,
    })).resolves.toEqual({
      debitTransactionId: 51,
      creditTransactionId: 52,
      transferGroupId: 'group-1',
      fromAccountId: 1,
      toAccountId: 2,
    });

    expect(createFinanceTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        fromAccountId: 1,
        toAccountId: 2,
        amountMinor: 30_000,
        currency: 'PLN',
        status: 'paid',
        meta: expect.objectContaining({
          source: 'volunteer-fund-allocation',
          volunteerFundId: 4,
          volunteerFundAllocationIdempotencyKey: 'staff-settlement:batch:fund:item',
          payoutBatchKey: 'batch',
          settlementRequestId: 'request-1',
          staffUserId: 191,
        }),
      }),
      9,
      { transaction, allowVolunteerFundAllocationForFundId: 4 },
    );
    expect(FinanceAccount.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ transaction, lock: transaction.LOCK.UPDATE }),
    );
  });

  it('requires two active configured accounts in the fund currency', async () => {
    await expect(createVolunteerFundAllocationTransfer({
      fund: { ...fund, fundingSourceAccountId: null } as never,
      allocationIdempotencyKey: 'allocation-key',
      amountMinor: 100,
      date: '2026-08-31',
      description: 'Allocation',
      payoutBatchKey: 'batch',
      settlementRequestId: 'request-1',
      staffUserId: 191,
      sourceKey: 'guide_commission',
      componentId: null,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      actorId: 9,
      transaction,
    })).rejects.toBeInstanceOf(HttpError);

    expect(createFinanceTransfer).not.toHaveBeenCalled();
  });

  const buildPair = (status: 'paid' | 'void' = 'paid') => [
    {
      id: 51,
      kind: 'transfer',
      status,
      date: '2026-08-31',
      accountId: 1,
      currency: 'PLN',
      amountMinor: 30_000,
      meta: {
        source: 'volunteer-fund-allocation',
        direction: 'out',
        transfer_group_id: 'group-1',
        counter_account_id: 2,
        volunteerFundId: 4,
        volunteerFundAllocationIdempotencyKey: 'allocation-key',
      },
    },
    {
      id: 52,
      kind: 'transfer',
      status,
      date: '2026-08-31',
      accountId: 2,
      currency: 'PLN',
      amountMinor: 30_000,
      meta: {
        source: 'volunteer-fund-allocation',
        direction: 'in',
        transfer_group_id: 'group-1',
        counter_account_id: 1,
        volunteerFundId: 4,
        volunteerFundAllocationIdempotencyKey: 'allocation-key',
      },
    },
  ];

  const original = {
    id: 91,
    fundId: 4,
    amountMinor: 30_000,
    currency: 'PLN',
    entryDate: '2026-08-31',
    idempotencyKey: 'allocation-key',
    financeTransactionId: 51,
    financeCounterTransactionId: 52,
    sourceSnapshot: {
      financeTransfer: {
        debitTransactionId: 51,
        creditTransactionId: 52,
        transferGroupId: 'group-1',
        fromAccountId: 1,
        toAccountId: 2,
      },
    },
  } as never;

  it('voids both rows using immutable historical accounts after the fund config changes', async () => {
    const pair = buildPair();
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue(pair[0]);
    (FinanceTransaction.findAll as jest.Mock).mockResolvedValue(pair);
    (updateFinanceTransaction as jest.Mock).mockResolvedValue({ status: 'void' });

    await expect(reverseVolunteerFundAllocationTransfer({
      fund: {
        ...fund,
        fundingSourceAccountId: 88,
        linkedAccountId: 99,
      } as never,
      original,
      actorId: 9,
      transaction,
    })).resolves.toEqual(expect.objectContaining({
      debitTransactionId: 51,
      creditTransactionId: 52,
      fromAccountId: 1,
      toAccountId: 2,
      action: 'voided_atomically',
    }));

    expect(updateFinanceTransaction).toHaveBeenNthCalledWith(
      1,
      51,
      { status: 'void' },
      9,
      { transaction, allowVolunteerFundAllocationReversal: true },
    );
    expect(updateFinanceTransaction).toHaveBeenNthCalledWith(
      2,
      52,
      { status: 'void' },
      9,
      { transaction, allowVolunteerFundAllocationReversal: true },
    );
  });

  it('is idempotent when both paired rows are already void', async () => {
    const pair = buildPair('void');
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue(pair[0]);
    (FinanceTransaction.findAll as jest.Mock).mockResolvedValue(pair);

    await expect(reverseVolunteerFundAllocationTransfer({
      fund,
      original,
      actorId: 9,
      transaction,
    })).resolves.toEqual(expect.objectContaining({ action: 'already_void' }));

    expect(updateFinanceTransaction).not.toHaveBeenCalled();
  });

  it('rejects a partially voided pair instead of leaving account balances inconsistent', async () => {
    const pair = buildPair();
    pair[1].status = 'void';
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue(pair[0]);
    (FinanceTransaction.findAll as jest.Mock).mockResolvedValue(pair);

    await expect(reverseVolunteerFundAllocationTransfer({
      fund,
      original,
      actorId: 9,
      transaction,
    })).rejects.toThrow(/both sides/i);

    expect(updateFinanceTransaction).not.toHaveBeenCalled();
  });

  it('keeps legacy ledger-only allocations reversible without Finance changes', async () => {
    await expect(reverseVolunteerFundAllocationTransfer({
      fund,
      original: {
        ...original,
        financeTransactionId: null,
        financeCounterTransactionId: null,
      } as never,
      actorId: 9,
      transaction,
    })).resolves.toBeNull();

    expect(FinanceTransaction.findByPk).not.toHaveBeenCalled();
    expect(updateFinanceTransaction).not.toHaveBeenCalled();
  });

  it('rejects a half-linked allocation before changing either Finance transaction', async () => {
    await expect(reverseVolunteerFundAllocationTransfer({
      fund,
      original: { ...original, financeCounterTransactionId: null } as never,
      actorId: 9,
      transaction,
    })).rejects.toThrow(/incomplete Finance transfer link/i);

    expect(FinanceTransaction.findByPk).not.toHaveBeenCalled();
    expect(updateFinanceTransaction).not.toHaveBeenCalled();
  });

  it('requires the relational credit link to match the immutable transfer snapshot', async () => {
    await expect(reverseVolunteerFundAllocationTransfer({
      fund,
      original: { ...original, financeCounterTransactionId: 99 } as never,
      actorId: 9,
      transaction,
    })).rejects.toThrow(/immutable Finance transfer snapshot/i);

    expect(FinanceTransaction.findByPk).not.toHaveBeenCalled();
    expect(updateFinanceTransaction).not.toHaveBeenCalled();
  });
});
