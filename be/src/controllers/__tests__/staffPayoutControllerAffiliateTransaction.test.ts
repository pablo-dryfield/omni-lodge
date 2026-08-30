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
jest.mock('../../models/StaffProfileTypePeriod.js', () => ({ __esModule: true, default: {} }));
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
  assertStaffPayoutSettlementIntentDirections: jest.fn(),
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
jest.mock('../../services/staffPayoutSettlementRequestService.js', () => ({
  assertStaffPayoutSettlementRequestBinding: jest.fn(),
  createStaffPayoutSettlementRequestBinding: jest.fn(),
}));

import AffiliatePayoutLog from '../../models/AffiliatePayoutLog.js';
import { getAffiliateOverview } from '../../services/affiliateService.js';
import { createAffiliatePayoutLogForStaffLine } from '../staffPayoutController.js';

describe('staff payout affiliate validation transaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it('closes gross booking commissions while the linked staff payment records a signed net amount', async () => {
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
    (AffiliatePayoutLog.create as jest.Mock).mockResolvedValue({ id: 72 });

    await createAffiliatePayoutLogForStaffLine({
      staffProfileId: 24,
      rangeStart: '2026-08-01',
      rangeEnd: '2026-08-31',
      paidDate: '2026-08-30',
      amountMinor: 7_000,
      currency: 'PLN',
      financeTransactionId: 602,
      note: 'Promotion payout net of a signed deduction',
      actorId: 1,
      affiliatePayout: {
        affiliateUserId: 24,
        bookingIds: [9513, 9514],
      },
      settlementAuthorization: {
        grossAmountMinor: 8_000,
        outstandingAmountMinor: 7_000,
        earningStart: null,
        earningEnd: null,
        referenceIds: [],
      },
    }, transaction);

    expect(AffiliatePayoutLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 8_000,
        financeTransactionId: 602,
        bookingIds: [9513, 9514],
      }),
      { transaction },
    );
  });

  it('rejects booking substitutions outside the signed earning-segment evidence', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;
    (getAffiliateOverview as jest.Mock).mockResolvedValue({
      bookings: [
        {
          id: 9513,
          isCommissionPaid: false,
          affiliateCommissionAmount: 40,
          currency: 'PLN',
          sourceReceivedAt: '2026-08-05T12:00:00.000Z',
        },
        {
          id: 9514,
          isCommissionPaid: false,
          affiliateCommissionAmount: 40,
          currency: 'PLN',
          sourceReceivedAt: '2026-08-06T12:00:00.000Z',
        },
      ],
    });

    await expect(createAffiliatePayoutLogForStaffLine({
      staffProfileId: 24,
      rangeStart: '2026-08-01',
      rangeEnd: '2026-08-31',
      paidDate: '2026-08-30',
      amountMinor: 4_000,
      currency: 'PLN',
      financeTransactionId: 603,
      note: 'Substituted booking',
      actorId: 1,
      affiliatePayout: {
        affiliateUserId: 24,
        bookingIds: [9513],
      },
      settlementAuthorization: {
        grossAmountMinor: 4_000,
        outstandingAmountMinor: 4_000,
        earningStart: '2026-08-01',
        earningEnd: '2026-08-15',
        referenceIds: [9514],
      },
    }, transaction)).rejects.toThrow(
      'Affiliate booking evidence no longer matches the signed settlement authorization.',
    );

    expect(AffiliatePayoutLog.create).not.toHaveBeenCalled();
  });
});
