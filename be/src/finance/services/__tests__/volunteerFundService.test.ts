jest.mock('../../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../auditLogService.js', () => ({ recordFinanceAuditLog: jest.fn() }));
jest.mock('../transactionService.js', () => ({
  createFinanceTransaction: jest.fn(),
  updateFinanceTransaction: jest.fn(),
}));
jest.mock('../../../models/CompensationComponent.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../../models/CompensationSettlementRule.js', () => ({
  __esModule: true,
  default: { count: jest.fn() },
}));
jest.mock('../../../models/User.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
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
  default: { create: jest.fn(), findByPk: jest.fn() },
}));
jest.mock('../../models/VolunteerFundEntry.js', () => ({
  __esModule: true,
  default: { count: jest.fn(), create: jest.fn(), findByPk: jest.fn(), findOne: jest.fn(), sum: jest.fn() },
}));

import sequelize from '../../../config/database.js';
import HttpError from '../../../errors/HttpError.js';
import FinanceAccount from '../../models/FinanceAccount.js';
import FinanceCategory from '../../models/FinanceCategory.js';
import FinanceTransaction from '../../models/FinanceTransaction.js';
import FinanceVendor from '../../models/FinanceVendor.js';
import VolunteerFund from '../../models/VolunteerFund.js';
import VolunteerFundEntry from '../../models/VolunteerFundEntry.js';
import { createFinanceTransaction, updateFinanceTransaction } from '../transactionService.js';
import {
  createManualVolunteerFundEntry,
  normalizeVolunteerFundInput,
  parseFinanceDate,
  reverseVolunteerFundEntry,
} from '../volunteerFundService.js';

describe('volunteer fund validation', () => {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    (sequelize.transaction as jest.Mock).mockImplementation(
      async (callback: (value: unknown) => unknown) => callback(transaction),
    );
    (VolunteerFundEntry.sum as jest.Mock).mockResolvedValue(10_000);
  });

  it('normalizes names, slugs, and currency', () => {
    expect(normalizeVolunteerFundInput({
      name: '  Volunteer Activities  ',
      currency: 'pln',
      linkedAccountId: 3,
      expenseCategoryId: 7,
    })).toEqual({
      name: 'Volunteer Activities',
      slug: 'volunteer-activities',
      currency: 'PLN',
      description: null,
      linkedAccountId: 3,
      expenseCategoryId: 7,
      isActive: true,
    });
  });

  it('preserves explicit deactivation when merging an edit', () => {
    expect(normalizeVolunteerFundInput(
      { isActive: false },
      {
        name: 'Volunteer Fund',
        slug: 'volunteer-fund',
        currency: 'PLN',
        description: null,
        linkedAccountId: null,
        expenseCategoryId: null,
        isActive: true,
      },
    ).isActive).toBe(false);
  });

  it('accepts exact calendar dates and rejects impossible dates', () => {
    expect(parseFinanceDate('2026-08-29', 'entryDate')).toBe('2026-08-29');
    expect(() => parseFinanceDate('2026-02-30', 'entryDate')).toThrow(HttpError);
    expect(() => parseFinanceDate('2026-8-29', 'entryDate')).toThrow(HttpError);
  });

  it('keeps allocation source attribution on a reversal', async () => {
    (VolunteerFund.findByPk as jest.Mock).mockResolvedValue({ id: 4 });
    (VolunteerFundEntry.sum as jest.Mock).mockResolvedValue(20_000);
    const original = {
      id: 91,
      fundId: 4,
      entryType: 'allocation',
      amountMinor: 12_500,
      currency: 'PLN',
      entryDate: '2026-08-29',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      description: 'Base allocation',
      attributedStaffUserId: null,
      compensationComponentId: null,
      sourceKind: 'guide_commission',
      sourceReference: '191:2026-08:guide_commission',
      attributionSnapshot: {},
      sourceSnapshot: { payoutBatchKey: 'batch' },
    };
    (VolunteerFundEntry.findOne as jest.Mock)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(null);
    (VolunteerFundEntry.create as jest.Mock).mockImplementation(async (payload) => ({
      id: 92,
      ...payload,
      toJSON: () => payload,
    }));

    await reverseVolunteerFundEntry(
      4,
      91,
      { entryDate: '2026-08-30', reason: 'Correction' },
      7,
    );

    expect(VolunteerFundEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: 'reversal',
        amountMinor: -12_500,
        sourceKind: 'guide_commission',
        sourceReference: '191:2026-08:guide_commission',
        reversalOfEntryId: 91,
      }),
      { transaction },
    );
  });

  it('rejects an allocation reversal that would make the fund negative', async () => {
    (VolunteerFund.findByPk as jest.Mock).mockResolvedValue({ id: 4 });
    (VolunteerFundEntry.findOne as jest.Mock)
      .mockResolvedValueOnce({
        id: 91,
        fundId: 4,
        entryType: 'allocation',
        amountMinor: 12_500,
        currency: 'PLN',
        sourceKind: 'guide_commission',
        description: 'Base allocation',
      })
      .mockResolvedValueOnce(null);
    (VolunteerFundEntry.sum as jest.Mock).mockResolvedValue(10_000);

    await expect(reverseVolunteerFundEntry(
      4,
      91,
      { entryDate: '2026-08-30', reason: 'Correction' },
      7,
    )).rejects.toThrow(/would make the Volunteer Fund balance negative/i);

    expect(VolunteerFundEntry.create).not.toHaveBeenCalled();
  });

  it('rejects a Finance transaction link on a non-cash allocation reversal', async () => {
    (VolunteerFund.findByPk as jest.Mock).mockResolvedValue({ id: 4 });
    (VolunteerFundEntry.findOne as jest.Mock)
      .mockResolvedValueOnce({
        id: 91,
        fundId: 4,
        entryType: 'allocation',
        amountMinor: 2_500,
        currency: 'PLN',
        sourceKind: 'guide_commission',
        description: 'Guide commission allocation',
      })
      .mockResolvedValueOnce(null);

    await expect(reverseVolunteerFundEntry(
      4,
      91,
      {
        entryDate: '2026-08-30',
        reason: 'Correction',
        financeTransactionId: 77,
      },
      7,
    )).rejects.toThrow(/cannot link a new Finance transaction/i);

    expect(FinanceTransaction.findByPk).not.toHaveBeenCalled();
    expect(VolunteerFundEntry.create).not.toHaveBeenCalled();
  });

  it('rejects a cash spend without a paid Finance expense or expense creation details', async () => {
    (VolunteerFund.findByPk as jest.Mock).mockResolvedValue({
      id: 4,
      isActive: true,
      currency: 'PLN',
      linkedAccountId: 3,
      expenseCategoryId: 7,
    });

    await expect(createManualVolunteerFundEntry(
      4,
      'spend',
      {
        entryDate: '2026-08-29',
        amountMinor: 2_500,
        description: 'Volunteer supplies',
        idempotencyKey: 'manual-spend:no-finance',
      },
      7,
    )).rejects.toThrow(/must link an existing paid Finance expense or provide a vendor/i);

    expect(createFinanceTransaction).not.toHaveBeenCalled();
    expect(VolunteerFundEntry.create).not.toHaveBeenCalled();
  });

  it('rejects a spend that exceeds the balance while holding the fund lock', async () => {
    (VolunteerFund.findByPk as jest.Mock).mockResolvedValue({
      id: 4,
      isActive: true,
      currency: 'PLN',
      linkedAccountId: 3,
      expenseCategoryId: 7,
    });
    (VolunteerFundEntry.findOne as jest.Mock).mockResolvedValue(null);
    (VolunteerFundEntry.sum as jest.Mock).mockResolvedValue(2_000);

    await expect(createManualVolunteerFundEntry(
      4,
      'spend',
      {
        entryDate: '2026-08-29',
        amountMinor: 2_500,
        description: 'Volunteer supplies',
        vendorId: 9,
        idempotencyKey: 'manual-spend:over-budget',
      },
      7,
    )).rejects.toThrow(/exceeds the available Volunteer Fund balance/i);

    expect(VolunteerFund.findByPk).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ transaction, lock: transaction.LOCK.UPDATE }),
    );
    expect(VolunteerFundEntry.sum).toHaveBeenCalledWith(
      'amountMinor',
      { where: { fundId: 4 }, transaction },
    );
    expect(createFinanceTransaction).not.toHaveBeenCalled();
    expect(VolunteerFundEntry.create).not.toHaveBeenCalled();
  });

  it('returns the committed spend on an idempotent retry without creating another expense', async () => {
    (VolunteerFund.findByPk as jest.Mock).mockResolvedValue({
      id: 4,
      isActive: true,
      currency: 'PLN',
      linkedAccountId: 3,
      expenseCategoryId: 7,
    });
    const existing = {
      id: 91,
      entryType: 'spend',
      amountMinor: -2_500,
      entryDate: '2026-08-29',
      description: 'Volunteer supplies',
      financeTransactionId: 55,
    };
    (VolunteerFundEntry.findOne as jest.Mock).mockResolvedValue(existing);

    await expect(createManualVolunteerFundEntry(
      4,
      'spend',
      {
        entryDate: '2026-08-29',
        amountMinor: 2_500,
        description: 'Volunteer supplies',
        vendorId: 9,
        idempotencyKey: 'manual-spend:stable-retry-key',
      },
      7,
    )).resolves.toEqual({ entry: existing, duplicated: true });

    expect(VolunteerFundEntry.sum).not.toHaveBeenCalled();
    expect(createFinanceTransaction).not.toHaveBeenCalled();
    expect(VolunteerFundEntry.create).not.toHaveBeenCalled();
  });

  it('atomically creates and links a paid Finance expense for a spend', async () => {
    (VolunteerFund.findByPk as jest.Mock).mockResolvedValue({
      id: 4,
      isActive: true,
      currency: 'PLN',
      linkedAccountId: 3,
      expenseCategoryId: 7,
    });
    (VolunteerFundEntry.findOne as jest.Mock).mockResolvedValue(null);
    (FinanceAccount.findByPk as jest.Mock).mockResolvedValue({ id: 3, currency: 'PLN', isActive: true });
    (FinanceCategory.findByPk as jest.Mock).mockResolvedValue({ id: 7, kind: 'expense', isActive: true });
    (FinanceVendor.findByPk as jest.Mock).mockResolvedValue({ id: 9 });
    (createFinanceTransaction as jest.Mock).mockResolvedValue({ id: 55 });
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue({
      id: 55,
      kind: 'expense',
      status: 'paid',
      date: '2026-08-29',
      accountId: 3,
      categoryId: 7,
      currency: 'PLN',
      amountMinor: 2_500,
    });
    (VolunteerFundEntry.create as jest.Mock).mockImplementation(async (payload) => ({
      id: 91,
      ...payload,
      toJSON: () => payload,
    }));

    await createManualVolunteerFundEntry(
      4,
      'spend',
      {
        entryDate: '2026-08-29',
        amountMinor: 2_500,
        description: 'Volunteer supplies',
        accountId: 3,
        categoryId: 7,
        vendorId: 9,
        idempotencyKey: 'manual-spend:auto-finance',
      },
      7,
    );

    expect(createFinanceTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'expense',
        status: 'paid',
        date: '2026-08-29',
        accountId: 3,
        categoryId: 7,
        counterpartyId: 9,
        amountMinor: 2_500,
      }),
      7,
      { transaction },
    );
    expect(VolunteerFundEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: 'spend',
        amountMinor: -2_500,
        financeTransactionId: 55,
        sourceSnapshot: expect.objectContaining({ financeLinkMode: 'created' }),
      }),
      { transaction },
    );
  });

  it('links an existing matching paid Finance expense without creating another one', async () => {
    (VolunteerFund.findByPk as jest.Mock).mockResolvedValue({
      id: 4,
      isActive: true,
      currency: 'PLN',
      linkedAccountId: 3,
      expenseCategoryId: 7,
    });
    (VolunteerFundEntry.findOne as jest.Mock).mockResolvedValue(null);
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue({
      id: 77,
      kind: 'expense',
      status: 'paid',
      date: '2026-08-29',
      accountId: 3,
      categoryId: 7,
      currency: 'PLN',
      amountMinor: 2_500,
    });
    (VolunteerFundEntry.create as jest.Mock).mockImplementation(async (payload) => ({
      id: 91,
      ...payload,
      toJSON: () => payload,
    }));

    await createManualVolunteerFundEntry(
      4,
      'spend',
      {
        entryDate: '2026-08-29',
        amountMinor: 2_500,
        description: 'Volunteer supplies',
        financeTransactionId: 77,
        idempotencyKey: 'manual-spend:existing-finance',
      },
      7,
    );

    expect(createFinanceTransaction).not.toHaveBeenCalled();
    expect(VolunteerFundEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        financeTransactionId: 77,
        sourceSnapshot: expect.objectContaining({ financeLinkMode: 'existing' }),
      }),
      { transaction },
    );
  });

  it('rejects an existing Finance expense that is not paid', async () => {
    (VolunteerFund.findByPk as jest.Mock).mockResolvedValue({
      id: 4,
      isActive: true,
      currency: 'PLN',
      linkedAccountId: 3,
      expenseCategoryId: 7,
    });
    (VolunteerFundEntry.findOne as jest.Mock).mockResolvedValue(null);
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue({
      id: 77,
      kind: 'expense',
      status: 'planned',
      date: '2026-08-29',
      accountId: 3,
      categoryId: 7,
      currency: 'PLN',
      amountMinor: 2_500,
    });

    await expect(createManualVolunteerFundEntry(
      4,
      'spend',
      {
        entryDate: '2026-08-29',
        amountMinor: 2_500,
        description: 'Volunteer supplies',
        financeTransactionId: 77,
        idempotencyKey: 'manual-spend:planned-finance',
      },
      7,
    )).rejects.toThrow(/paid Finance expense/i);

    expect(VolunteerFundEntry.create).not.toHaveBeenCalled();
  });

  it('voids an automatically created Finance expense in the same spend reversal', async () => {
    (VolunteerFund.findByPk as jest.Mock).mockResolvedValue({ id: 4 });
    const original = {
      id: 91,
      fundId: 4,
      entryType: 'spend',
      amountMinor: -2_500,
      currency: 'PLN',
      entryDate: '2026-08-29',
      periodStart: null,
      periodEnd: null,
      description: 'Volunteer supplies',
      attributedStaffUserId: null,
      compensationComponentId: null,
      sourceKind: 'manual_spend',
      sourceReference: null,
      attributionSnapshot: {},
      sourceSnapshot: { financeLinkMode: 'created' },
      financeTransactionId: 55,
      idempotencyKey: 'manual-spend:auto-finance',
    };
    (VolunteerFundEntry.findOne as jest.Mock)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(null);
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue({
      id: 55,
      kind: 'expense',
      status: 'paid',
      meta: {
        source: 'volunteer-fund',
        volunteerFundId: 4,
        volunteerFundEntryIdempotencyKey: 'manual-spend:auto-finance',
      },
    });
    (updateFinanceTransaction as jest.Mock).mockResolvedValue({ id: 55, status: 'void' });
    (VolunteerFundEntry.create as jest.Mock).mockImplementation(async (payload) => ({
      id: 92,
      ...payload,
      toJSON: () => payload,
    }));

    await reverseVolunteerFundEntry(
      4,
      91,
      { entryDate: '2026-08-30', reason: 'Purchase refunded' },
      7,
    );

    expect(updateFinanceTransaction).toHaveBeenCalledWith(
      55,
      { status: 'void' },
      7,
      { transaction, allowVolunteerFundSpendReversal: true },
    );
    expect(VolunteerFundEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: 'reversal',
        amountMinor: 2_500,
        financeTransactionId: null,
        sourceSnapshot: expect.objectContaining({
          financeReversal: {
            financeTransactionId: 55,
            action: 'voided_atomically',
          },
        }),
      }),
      { transaction },
    );
  });

  it('atomically voids an externally linked paid Finance expense during fund reversal', async () => {
    (VolunteerFund.findByPk as jest.Mock).mockResolvedValue({ id: 4 });
    const original = {
      id: 91,
      fundId: 4,
      entryType: 'spend',
      amountMinor: -2_500,
      currency: 'PLN',
      entryDate: '2026-08-29',
      periodStart: null,
      periodEnd: null,
      description: 'Volunteer supplies',
      attributedStaffUserId: null,
      compensationComponentId: null,
      sourceKind: 'manual_spend',
      sourceReference: null,
      attributionSnapshot: {},
      sourceSnapshot: { financeLinkMode: 'existing' },
      financeTransactionId: 77,
      idempotencyKey: 'manual-spend:existing-finance',
    };
    (VolunteerFundEntry.findOne as jest.Mock)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(null);
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue({
      id: 77,
      kind: 'expense',
      status: 'paid',
      meta: {},
    });

    (updateFinanceTransaction as jest.Mock).mockResolvedValue({ id: 77, status: 'void' });
    (VolunteerFundEntry.create as jest.Mock).mockImplementation(async (payload) => ({
      id: 92,
      ...payload,
      toJSON: () => payload,
    }));

    await reverseVolunteerFundEntry(
      4,
      91,
      { entryDate: '2026-08-30', reason: 'Purchase refunded' },
      7,
    );

    expect(updateFinanceTransaction).toHaveBeenCalledWith(
      77,
      { status: 'void' },
      7,
      { transaction, allowVolunteerFundSpendReversal: true },
    );
    expect(VolunteerFundEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: 'reversal',
        amountMinor: 2_500,
        sourceSnapshot: expect.objectContaining({
          financeReversal: {
            financeTransactionId: 77,
            action: 'voided_atomically',
          },
        }),
      }),
      { transaction },
    );
  });
});
