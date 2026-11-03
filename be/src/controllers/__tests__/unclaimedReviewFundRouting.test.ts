import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';

jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../__mocks__/sequelizeModelStub', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/StaffProfile.js', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../../models/StaffPayoutLedger.js', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../../models/StaffProfileTypePeriod.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/StaffPayoutCollectionLog.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/CompensationComponent.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/CompensationSettlementRule.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../models/AffiliatePayoutLog.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StaffPayoutReceipt.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StaffPayoutReceiptItem.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/RequiredAction.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceAccount.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceCategory.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceTransaction.js', () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }));
jest.mock('../../finance/models/VolunteerFund.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../finance/models/VolunteerFundEntry.js', () => ({ __esModule: true, default: { findAll: jest.fn(), create: jest.fn() } }));
jest.mock('../../finance/services/transactionService.js', () => ({ createFinanceTransaction: jest.fn(), updateFinanceTransaction: jest.fn() }));
jest.mock('../../finance/services/volunteerFundAllocationFinanceService.js', () => ({ createVolunteerFundAllocationTransfer: jest.fn() }));
jest.mock('../../services/configService.js', () => ({ getConfigValue: jest.fn(() => 'PLN') }));
jest.mock('../../services/affiliateService.js', () => ({ getAffiliateOverview: jest.fn() }));
jest.mock('../../services/staffPayoutReceiptService.js', () => ({ createStaffPayoutReceipt: jest.fn() }));
jest.mock('../../services/staffPayoutReceiptDeletionService.js', () => ({ buildStaffPayoutReceiptReissueItems: jest.fn() }));
jest.mock('../../services/compensationSettlementRoutingService.js', () => ({ loadCompensationSettlementRouter: jest.fn() }));
jest.mock('../../services/staffPayoutLedgerReconciliationService.js', () => ({ reconcilePersistedStaffPayoutLedgers: jest.fn() }));
jest.mock('../../services/staffPayoutSettlementDeletionService.js', () => ({ findRecoverableInterruptedPayoutBatches: jest.fn(), getStaffPayoutBatchKeyForDeletion: jest.fn(), reverseFundAllocationsForFullyDeletedPayoutBatches: jest.fn() }));

import sequelize from '../../config/database.js';
import StaffProfile from '../../models/StaffProfile.js';
import StaffPayoutLedger from '../../models/StaffPayoutLedger.js';
import StaffProfileTypePeriod from '../../models/StaffProfileTypePeriod.js';
import StaffPayoutCollectionLog from '../../models/StaffPayoutCollectionLog.js';
import CompensationComponent from '../../models/CompensationComponent.js';
import CompensationSettlementRule from '../../models/CompensationSettlementRule.js';
import AuditLog from '../../models/AuditLog.js';
import FinanceTransaction from '../../finance/models/FinanceTransaction.js';
import VolunteerFund from '../../finance/models/VolunteerFund.js';
import VolunteerFundEntry from '../../finance/models/VolunteerFundEntry.js';
import { loadCompensationSettlementRouter } from '../../services/compensationSettlementRoutingService.js';
import { reconcilePersistedStaffPayoutLedgers } from '../../services/staffPayoutLedgerReconciliationService.js';
import { signCompensationSettlementIntent } from '../../services/compensationSettlementIntentService.js';
import { routeUnclaimedReviewPayToFund } from '../staffPayoutController.js';
const userFindByPk = jest.requireMock('../../__mocks__/sequelizeModelStub').default.findByPk as jest.Mock;
const transaction = { LOCK: { UPDATE: 'UPDATE', SHARE: 'SHARE' } };
const originalJwtSecret = process.env.JWT_SECRET;
afterAll(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});
let ledger: Record<string, any>;
let req: AuthenticatedRequest;
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = 'unclaimed-review-test-secret';
  const review = { sourceKey: 'compensation_component', componentId: 4, category: 'review',
    grossAmountMinor: 15000, currency: 'PLN', destination: 'staff_vendor' as const, fundId: null, ruleId: 3,
    segmentKey: 'seg_review', staffTypePeriodId: 11, staffType: 'volunteer',
    earningStart: '2026-10-06', earningEnd: '2026-10-29', legacyExtrapolation: false };
  ledger = { id: 99, dueAmountMinor: 25000, paidAmountMinor: 5000, closingBalanceMinor: 20000,
    currencyCode: 'PLN', settlementSnapshot: { version: 2, sources: [review,
      { ...review, componentId: 16, category: 'commission', grossAmountMinor: 10000, segmentKey: 'seg_guiding' }] } };
  ledger.update = jest.fn(async changes => Object.assign(ledger, changes));
  req = { authContext: { id: 1, roleSlug: 'manager' }, body: { staffUserId: 101,
    rangeStart: '2026-10-01', rangeEnd: '2026-10-31', reason: 'Volunteer departed with review pay unclaimed',
    settlementIntents: [signCompensationSettlementIntent({ ...review, userId: 101,
      rangeStart: '2026-10-01', rangeEnd: '2026-10-31', outstandingAmountMinor: 15000,
      direction: 'payable', referenceIds: [] })] } } as unknown as AuthenticatedRequest;
  (sequelize.transaction as jest.Mock).mockImplementation(async callback => callback(transaction));
  userFindByPk.mockResolvedValue({ id: 101 });
  (StaffProfile.findOne as jest.Mock).mockResolvedValue({ userId: 101, staffType: 'volunteer' });
  (StaffPayoutLedger.findOne as jest.Mock).mockResolvedValue(ledger);
  (StaffProfileTypePeriod.findAll as jest.Mock).mockResolvedValue([{ id: 11, userId: 101, staffType: 'volunteer',
    effectiveStart: '2026-09-14', effectiveEnd: null, metadata: {} }]);
  (CompensationComponent.findAll as jest.Mock).mockResolvedValue([{ id: 4, category: 'review', isActive: true }]);
  (loadCompensationSettlementRouter as jest.Mock).mockResolvedValue({ resolve: () => ({ ruleId: 3, destination: 'staff_vendor', fundId: null }) });
  (StaffPayoutCollectionLog.findAll as jest.Mock).mockResolvedValue([]);
  (FinanceTransaction.findAll as jest.Mock).mockResolvedValue([]);
  (VolunteerFundEntry.findAll as jest.Mock).mockResolvedValue([]);
  (VolunteerFund.findAll as jest.Mock).mockResolvedValue([{ id: 1, name: 'Volunteer Fund', currency: 'PLN', isActive: true }]);
  (CompensationSettlementRule.create as jest.Mock).mockResolvedValue({ id: 90 });
  (reconcilePersistedStaffPayoutLedgers as jest.Mock).mockResolvedValue(undefined);
});

it('scopes routing to one person/month, preserves other payments, and audits within the ledger transaction', async () => {
  const res = response();
  await routeUnclaimedReviewPayToFund(req, res as unknown as Response);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ routed: true, amount: 150, currency: 'PLN', fundId: 1, fundName: 'Volunteer Fund' });
  expect(CompensationSettlementRule.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 101,
    componentId: 4, targetScope: 'user', matchKind: 'component', destination: 'volunteer_fund', fundId: 1,
    effectiveStart: '2026-10-01', effectiveEnd: '2026-10-31', createdBy: 1 }), { transaction });
  expect(ledger.dueAmountMinor).toBe(10000);
  expect(ledger.paidAmountMinor).toBe(5000);
  expect(ledger.settlementSnapshot.sources.find(source => source.componentId === 16).destination).toBe('staff_vendor');
  expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ actorId: 1,
    metaJson: expect.objectContaining({ reason: req.body.reason, amountMinor: 15000, ruleIds: [90], allocationPending: true }) }), { transaction });
  expect(reconcilePersistedStaffPayoutLedgers).toHaveBeenCalledWith(expect.objectContaining({ staffUserId: 101, transaction }));
  expect(FinanceTransaction.create).not.toHaveBeenCalled();
  expect(VolunteerFundEntry.create).not.toHaveBeenCalled();
  // A repeated request cannot create a second route or resurrect personal pay.
  await routeUnclaimedReviewPayToFund(req, response() as unknown as Response);
  expect(CompensationSettlementRule.create).toHaveBeenCalledTimes(1);
});

it.each(['assistant-manager', 'pub-crawl-guide'])('denies %s', async roleSlug => {
  req.authContext!.roleSlug = roleSlug;
  const res = response();
  await routeUnclaimedReviewPayToFund(req, res as unknown as Response);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(sequelize.transaction).not.toHaveBeenCalled();
});

it.each(['reason', 'paid review', 'legacy payment', 'no fund', 'changed history', 'scoped account'])('rejects %s without a route write', async reason => {
  if (reason === 'reason') req.body.reason = ' ';
  if (reason === 'paid review') (FinanceTransaction.findAll as jest.Mock).mockResolvedValue([{ amountMinor: 100 }]);
  if (reason === 'legacy payment') (StaffPayoutCollectionLog.findAll as jest.Mock).mockResolvedValue([{ amountMinor: 100 }]);
  if (reason === 'no fund') (VolunteerFund.findAll as jest.Mock).mockResolvedValue([]);
  if (reason === 'changed history') (StaffProfileTypePeriod.findAll as jest.Mock).mockResolvedValue([]);
  if (reason === 'scoped account') req.productTypeScope = [2];
  const res = response();
  await routeUnclaimedReviewPayToFund(req, res as unknown as Response);
  expect(res.status.mock.calls[0][0]).toBeGreaterThanOrEqual(400);
  expect(CompensationSettlementRule.create).not.toHaveBeenCalled();
  expect(ledger.update).not.toHaveBeenCalled();
});

it('rejects tampered authorizations before opening a transaction', async () => {
  req.body.settlementIntents = [`${req.body.settlementIntents[0]}tampered`];
  const res = response();
  await routeUnclaimedReviewPayToFund(req, res as unknown as Response);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(sequelize.transaction).not.toHaveBeenCalled();
});
