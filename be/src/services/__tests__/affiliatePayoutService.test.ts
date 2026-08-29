jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../__mocks__/sequelizeModelStub.ts', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/AffiliatePayoutLog.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), destroy: jest.fn(), findByPk: jest.fn() },
}));
jest.mock('../../models/RequiredAction.js', () => ({
  __esModule: true,
  default: { update: jest.fn() },
}));
jest.mock('../../models/StaffPayoutCollectionLog.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), destroy: jest.fn(), findAll: jest.fn() },
}));
jest.mock('../../models/StaffPayoutReceipt.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/StaffPayoutReceiptItem.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), update: jest.fn() },
}));
jest.mock('../../models/StaffProfile.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn(), findOne: jest.fn() },
}));
jest.mock('../affiliateService.js', () => ({ getAffiliateOverview: jest.fn() }));
jest.mock('../../finance/models/FinanceAccount.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../finance/models/FinanceCategory.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../finance/models/FinanceVendor.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), findByPk: jest.fn() },
}));
jest.mock('../../finance/models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: { destroy: jest.fn(), findByPk: jest.fn() },
}));
jest.mock('../../finance/services/transactionService.js', () => ({ createFinanceTransaction: jest.fn() }));
jest.mock('../../finance/services/transactionDeletionService.js', () => ({ cleanupInvoiceFileIfOrphan: jest.fn() }));
jest.mock('../../finance/services/auditLogService.js', () => ({ recordFinanceAuditLog: jest.fn() }));
jest.mock('../staffPayoutReceiptService.js', () => ({ createStaffPayoutReceipt: jest.fn() }));

import sequelize from '../../config/database';
import FinanceAccount from '../../finance/models/FinanceAccount';
import FinanceCategory from '../../finance/models/FinanceCategory';
import FinanceTransaction from '../../finance/models/FinanceTransaction';
import FinanceVendor from '../../finance/models/FinanceVendor';
import { recordFinanceAuditLog } from '../../finance/services/auditLogService';
import { createFinanceTransaction } from '../../finance/services/transactionService';
import AffiliatePayoutLog from '../../models/AffiliatePayoutLog';
import RequiredAction from '../../models/RequiredAction';
import StaffPayoutCollectionLog from '../../models/StaffPayoutCollectionLog';
import StaffPayoutReceipt from '../../models/StaffPayoutReceipt';
import StaffPayoutReceiptItem from '../../models/StaffPayoutReceiptItem';
import StaffProfile from '../../models/StaffProfile';
import User from '../../__mocks__/sequelizeModelStub';
import { getAffiliateOverview } from '../affiliateService';
import { createAffiliatePayout, undoAffiliatePayout } from '../affiliatePayoutService';
import { createStaffPayoutReceipt } from '../staffPayoutReceiptService';

const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const input = {
  affiliateUserId: 24,
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  accountId: 3,
  categoryId: 4,
  paidDate: '2026-08-29',
  note: 'Promotion payout',
  actorId: 1,
};

const payoutLog = {
  id: 71,
  affiliateUserId: 24,
  currencyCode: 'PLN',
  amountMinor: 8000,
  paidDate: '2026-08-29',
  rangeStart: '2026-07-01',
  rangeEnd: '2026-07-31',
  bookingIds: [9513, 9514],
  financeTransactionId: 601,
  note: 'Promotion payout',
};

const configureCreateMocks = () => {
  (sequelize.transaction as jest.Mock).mockImplementation(
    async (callback: (value: typeof transaction) => unknown) => callback(transaction),
  );
  (User.findByPk as jest.Mock).mockResolvedValue({
    id: 24,
    firstName: 'Cristian',
    lastName: 'Staff',
    username: 'cristian',
    email: 'cristian@example.com',
    phone: null,
    financeVendorId: 8,
  });
  (FinanceAccount.findByPk as jest.Mock).mockResolvedValue({ id: 3, isActive: true, currency: 'PLN' });
  (FinanceCategory.findByPk as jest.Mock).mockResolvedValue({ id: 4, isActive: true, kind: 'expense' });
  (FinanceVendor.findByPk as jest.Mock).mockResolvedValue({ id: 8 });
  (getAffiliateOverview as jest.Mock).mockResolvedValue({
    affiliateUsers: [{ id: 24, fullName: 'Cristian Staff' }],
    bookings: [
      { id: 9513, isCommissionPaid: false, affiliateCommissionAmount: 40, currency: 'PLN' },
      { id: 9514, isCommissionPaid: false, affiliateCommissionAmount: 40, currency: 'PLN' },
    ],
  });
  (createFinanceTransaction as jest.Mock).mockResolvedValue({ id: 601 });
  (AffiliatePayoutLog.create as jest.Mock).mockResolvedValue(payoutLog);
};

describe('affiliate payout staff receipt integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureCreateMocks();
  });

  it('creates a collection row and required receipt for an affiliate with a staff profile', async () => {
    (StaffProfile.findByPk as jest.Mock).mockResolvedValue({ userId: 24, financeVendorId: 8 });
    (StaffPayoutCollectionLog.create as jest.Mock).mockResolvedValue({ id: 412 });
    (createStaffPayoutReceipt as jest.Mock).mockResolvedValue({
      id: 91,
      requiredActionId: 92,
      status: 'pending',
    });

    const result = await createAffiliatePayout(input);

    expect(StaffPayoutCollectionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        staffProfileId: 24,
        direction: 'payable',
        amountMinor: 8000,
        currencyCode: 'PLN',
        financeTransactionId: 601,
      }),
      { transaction },
    );
    expect(createStaffPayoutReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        staffUserId: 24,
        rangeStart: '2026-07-01',
        rangeEnd: '2026-07-31',
        paidDate: '2026-08-29',
        items: [
          expect.objectContaining({
            collectionLogId: 412,
            financeTransactionId: 601,
            label: 'Affiliate commission',
            amountMinor: 8000,
            currencyCode: 'PLN',
          }),
        ],
        transaction,
      }),
    );
    expect(result.receipt).toEqual({ id: 91, actionId: 92, status: 'pending' });
    expect((createFinanceTransaction as jest.Mock).mock.calls[0][0].meta).toEqual(
      expect.objectContaining({
        source: 'affiliate-payout',
        staffUserId: 24,
        lineLabel: 'Affiliate commission',
        payoutBatchKey: expect.stringMatching(/^affiliate-direct:[a-f0-9]{64}$/u),
      }),
    );
  });

  it('leaves external affiliates on the existing payout flow without a staff receipt', async () => {
    (StaffProfile.findByPk as jest.Mock).mockResolvedValue(null);

    const result = await createAffiliatePayout(input);

    expect(StaffPayoutCollectionLog.create).not.toHaveBeenCalled();
    expect(createStaffPayoutReceipt).not.toHaveBeenCalled();
    expect(result.receipt).toBeNull();
    expect((createFinanceTransaction as jest.Mock).mock.calls[0][0].meta).not.toHaveProperty('staffUserId');
  });

  it('cancels a linked receipt and removes only live links when the affiliate payout is undone', async () => {
    const receiptUpdate = jest.fn().mockResolvedValue(undefined);
    (AffiliatePayoutLog.findByPk as jest.Mock).mockResolvedValue(payoutLog);
    (StaffProfile.findOne as jest.Mock).mockResolvedValue({ userId: 24 });
    (StaffPayoutCollectionLog.findAll as jest.Mock).mockResolvedValue([{ id: 412 }]);
    (StaffPayoutReceiptItem.findAll as jest.Mock).mockResolvedValue([{ receiptId: 91 }]);
    (StaffPayoutReceipt.findAll as jest.Mock).mockResolvedValue([
      { id: 91, requiredActionId: 92, status: 'completed', update: receiptUpdate },
    ]);
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue({ id: 601, invoiceFileId: null });

    await undoAffiliatePayout(71, 1);

    expect(receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'cancelled',
        cancelledBy: 1,
        cancelReason: expect.stringContaining('affiliate payout was undone'),
      }),
      { transaction },
    );
    expect(StaffProfile.findOne).toHaveBeenCalledWith({
      where: { userId: 24 },
      attributes: ['userId'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    expect((StaffProfile.findOne as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (AffiliatePayoutLog.findByPk as jest.Mock).mock.invocationCallOrder[1],
    );
    expect(RequiredAction.update).toHaveBeenCalledWith(
      { status: false, updatedBy: 1 },
      { where: { id: 92 }, transaction },
    );
    expect(StaffPayoutReceiptItem.update).toHaveBeenCalledWith(
      { collectionLogId: null, financeTransactionId: null },
      expect.objectContaining({ transaction }),
    );
    expect(StaffPayoutCollectionLog.destroy).toHaveBeenCalledWith(
      expect.objectContaining({ transaction }),
    );
    expect(AffiliatePayoutLog.destroy).toHaveBeenCalledWith({ where: { id: 71 }, transaction });
    expect(FinanceTransaction.destroy).toHaveBeenCalledWith({ where: { id: 601 }, transaction });
    expect(recordFinanceAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 601,
        action: 'delete',
        performedBy: 1,
        metadata: { source: 'affiliate-payout-undo', payoutLogId: 71 },
      }),
    );
  });

  it('reissues a receipt for sibling wage items when undoing an affiliate line from a mixed Pays batch', async () => {
    const receiptUpdate = jest.fn().mockResolvedValue(undefined);
    (AffiliatePayoutLog.findByPk as jest.Mock).mockResolvedValue(payoutLog);
    (StaffProfile.findOne as jest.Mock).mockResolvedValue({ userId: 24 });
    (StaffPayoutCollectionLog.findAll as jest.Mock).mockResolvedValue([{ id: 412 }]);
    (StaffPayoutReceiptItem.findAll as jest.Mock)
      .mockResolvedValueOnce([{ receiptId: 91, collectionLogId: 412, financeTransactionId: 601 }])
      .mockResolvedValueOnce([
        {
          id: 1,
          receiptId: 91,
          collectionLogId: 412,
          financeTransactionId: 601,
          label: 'Affiliate commission',
          amountMinor: 8000,
          currencyCode: 'PLN',
        },
        {
          id: 2,
          receiptId: 91,
          collectionLogId: 413,
          financeTransactionId: 602,
          label: 'Base pay',
          amountMinor: 12000,
          currencyCode: 'PLN',
        },
      ]);
    (StaffPayoutReceipt.findAll as jest.Mock).mockResolvedValue([
      {
        id: 91,
        requiredActionId: 92,
        status: 'pending',
        staffUserId: 24,
        payoutBatchKey: 'staff-batch:PLN',
        rangeStart: '2026-07-01',
        rangeEnd: '2026-07-31',
        paidDate: '2026-08-29',
        createdBy: 1,
        update: receiptUpdate,
      },
    ]);
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue({ id: 601, invoiceFileId: null });
    (createStaffPayoutReceipt as jest.Mock).mockResolvedValue({
      id: 93,
      requiredActionId: 94,
      status: 'pending',
    });

    await undoAffiliatePayout(71, 1);

    expect(createStaffPayoutReceipt).toHaveBeenCalledTimes(1);
    expect(createStaffPayoutReceipt).toHaveBeenCalledWith({
      staffUserId: 24,
      payoutBatchKey: 'staff-batch:PLN',
      rangeStart: '2026-07-01',
      rangeEnd: '2026-07-31',
      paidDate: '2026-08-29',
      createdBy: 1,
      items: [
        {
          collectionLogId: 413,
          financeTransactionId: 602,
          label: 'Base pay',
          amountMinor: 12000,
          currencyCode: 'PLN',
        },
      ],
      transaction,
    });
  });
});
