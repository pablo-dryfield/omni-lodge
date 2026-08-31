jest.mock('../../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../../services/staffPayoutReceiptProtectionService.js', () => ({
  assertFinanceTransactionIsNotReceiptProtected: jest.fn(),
}));
jest.mock('../driveService.js', () => ({ deleteFinanceFileFromDrive: jest.fn() }));
jest.mock('../../models/FinanceFile.js', () => ({
  __esModule: true,
  default: { destroy: jest.fn(), findByPk: jest.fn() },
}));
jest.mock('../../models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: { count: jest.fn(), destroy: jest.fn(), findByPk: jest.fn() },
}));

import sequelize from '../../../config/database.js';
import FinanceTransaction from '../../models/FinanceTransaction.js';
import {
  deleteFinanceTransactionAndCleanupInvoice,
  VOLUNTEER_FUND_ALLOCATION_TRANSFER_PROTECTED_MESSAGE,
} from '../transactionDeletionService.js';

describe('Volunteer Fund allocation transfer deletion protection', () => {
  const databaseTransaction = { LOCK: { UPDATE: 'UPDATE' } } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    (sequelize.transaction as jest.Mock).mockImplementation(
      async (callback: (value: unknown) => unknown) => callback(databaseTransaction),
    );
  });

  it.each(['out', 'in'])('rejects deletion of the %s side of a managed allocation pair', async (direction) => {
    (FinanceTransaction.findByPk as jest.Mock).mockResolvedValue({
      id: direction === 'out' ? 51 : 52,
      invoiceFileId: null,
      meta: {
        source: 'volunteer-fund-allocation',
        direction,
        transfer_group_id: 'group-1',
      },
    });

    await expect(deleteFinanceTransactionAndCleanupInvoice({
      id: direction === 'out' ? 51 : 52,
    } as FinanceTransaction)).rejects.toThrow(
      VOLUNTEER_FUND_ALLOCATION_TRANSFER_PROTECTED_MESSAGE,
    );

    expect(FinanceTransaction.destroy).not.toHaveBeenCalled();
  });
});
