jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../models/AffiliatePayoutLog.js', () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));
jest.mock('../../models/StaffPayoutCollectionLog.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StaffPayoutLedger.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StaffProfile.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StaffPayoutReceipt.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StaffPayoutReceiptItem.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/RequiredAction.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/CompensationComponent.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceAccount.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceCategory.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceTransaction.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/VolunteerFund.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/VolunteerFundEntry.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/services/transactionService.js', () => ({
  createFinanceTransaction: jest.fn(),
  updateFinanceTransaction: jest.fn(),
}));
jest.mock('../../services/affiliateService.js', () => ({
  getAffiliateOverview: jest.fn(),
}));
jest.mock('../../services/configService.js', () => ({ getConfigValue: jest.fn(() => 'PLN') }));
jest.mock('../../services/staffPayoutReceiptService.js', () => ({ createStaffPayoutReceipt: jest.fn() }));
jest.mock('../../services/staffPayoutReceiptDeletionService.js', () => ({
  buildStaffPayoutReceiptReissueItems: jest.fn(),
}));
jest.mock('../../services/staffPayoutReceiptValidation.js', () => ({
  groupStaffPayoutReceiptItemsByCurrency: jest.fn(),
}));
jest.mock('../../services/staffPayoutBatchValidation.js', () => ({
  assertStaffPayoutDirectionDetails: jest.fn(),
  assertUniqueStaffAffiliatePayoutClaims: jest.fn(),
  deriveStaffPayoutReimbursementAmount: jest.fn(),
  parseStrictStaffPayoutDate: jest.fn(),
  validateStaffPayoutFinanceSelections: jest.fn(),
}));
jest.mock('../../services/compensationSettlementRoutingService.js', () => ({
  loadCompensationSettlementRouter: jest.fn(),
}));
jest.mock('../../services/compensationSettlementIntentService.js', () => ({
  verifyCompensationSettlementIntent: jest.fn(),
}));
jest.mock('../../services/staffPayoutLedgerReconciliationService.js', () => ({
  reconcilePersistedStaffPayoutLedgers: jest.fn(),
}));

import AffiliatePayoutLog from '../../models/AffiliatePayoutLog.js';
import { getAffiliateOverview } from '../../services/affiliateService.js';
import { createAffiliatePayoutLogForStaffLine } from '../staffPayoutController.js';

describe('staff payout affiliate validation transaction', () => {
  it('reads eligibility and writes the payout log in the caller transaction', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;
    (getAffiliateOverview as jest.Mock).mockResolvedValue({
      bookings: [
        {
          id: 9513,
          isCommissionPaid: false,
          affiliateCommissionAmount: 40,
          currency: 'PLN',
        },
        {
          id: 9514,
          isCommissionPaid: false,
          affiliateCommissionAmount: 40,
          currency: 'PLN',
        },
      ],
    });
    (AffiliatePayoutLog.create as jest.Mock).mockResolvedValue({ id: 71 });

    await createAffiliatePayoutLogForStaffLine({
      staffProfileId: 24,
      rangeStart: '2026-07-01',
      rangeEnd: '2026-07-31',
      paidDate: '2026-08-29',
      amountMinor: 8_000,
      currency: 'PLN',
      financeTransactionId: 601,
      note: 'Promotion payout',
      actorId: 1,
      affiliatePayout: {
        affiliateUserId: 24,
        bookingIds: [9513, 9514],
      },
    }, transaction);

    expect(getAffiliateOverview).toHaveBeenCalledWith(expect.objectContaining({
      selectedAffiliateUserId: 24,
      transaction,
    }));
    expect(AffiliatePayoutLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        affiliateUserId: 24,
        amountMinor: 8_000,
        bookingIds: [9513, 9514],
      }),
      { transaction },
    );
  });
});
