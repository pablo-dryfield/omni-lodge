import type { Response } from 'express';
import Booking from '../../models/Booking';
import NightReport from '../../models/NightReport';
import NightReportPhoto from '../../models/NightReportPhoto';
import FinanceTransaction from '../../finance/models/FinanceTransaction';
import { reconcileNightReportTaskWaiversForReport } from '../../services/assistantManagerTaskWaiverService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { submitNightReport } from '../nightReportController';

jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../models/Booking.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Counter.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/NightReport.js', () => ({
  __esModule: true,
  default: {
    sequelize: { transaction: jest.fn() },
    findByPk: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('../../models/NightReportVenue.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/NightReportPhoto.js', () => ({
  __esModule: true,
  default: { count: jest.fn() },
}));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Venue.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/VenueCompensationTerm.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/VenueCompensationTermRate.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/VenueCompensationCollectionLog.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/VenueCompensationLedger.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceAccount.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceCategory.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceFile.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: {
    count: jest.fn(),
    findAll: jest.fn(),
  },
}));
jest.mock('../../finance/models/FinanceVendor.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/services/auditLogService.js', () => ({ recordFinanceAuditLog: jest.fn() }));
jest.mock('../../finance/services/transactionDeletionService.js', () => ({
  cleanupInvoiceFileIfOrphan: jest.fn(),
  deleteFinanceTransactionAndCleanupInvoice: jest.fn(),
}));
jest.mock('../../finance/services/transactionService.js', () => ({
  createFinanceTransaction: jest.fn(),
  updateFinanceTransaction: jest.fn(),
}));
jest.mock('../../services/productScopeService.js', () => ({
  getAllowedProductTypeIds: jest.fn(),
  requireProductAccess: jest.fn(),
}));
jest.mock('../../services/nightReportStorageService.js', () => ({
  ensureNightReportStorage: jest.fn(),
  storeNightReportPhoto: jest.fn(),
  deleteNightReportPhoto: jest.fn(),
  openNightReportPhotoStream: jest.fn(),
}));
jest.mock('../../services/nightReportMetricsService.js', () => ({
  fetchLeaderNightReportStats: jest.fn(),
}));
jest.mock('../../services/assistantManagerTaskWaiverService.js', () => ({
  reconcileNightReportTaskWaiversForReport: jest.fn(),
}));
jest.mock('../../services/configService.js', () => ({ getConfigValue: jest.fn() }));
jest.mock('../reportController.js', () => ({ getCommissionByDateRange: jest.fn() }));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const mockFindByPk = NightReport.findByPk as jest.Mock;
const mockUpdate = NightReport.update as jest.Mock;
const mockTransaction = NightReport.sequelize!.transaction as jest.Mock;
const mockPhotoCount = NightReportPhoto.count as jest.Mock;
const mockFinanceFindAll = FinanceTransaction.findAll as jest.Mock;
const mockBookingFindAll = Booking.findAll as jest.Mock;
const mockReconcileTaskWaivers = reconcileNightReportTaskWaiversForReport as jest.Mock;
const activeTransaction = { id: 'night-report-submit-transaction' };

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
};

const submittedReport = {
  id: 434,
  counterId: 0,
  leaderId: 17,
  activityDate: '2026-09-10',
  status: 'submitted',
  notes: null,
  noExtraCostConfirmed: false,
  noExtraCostConfirmedAt: null,
  noExtraCostConfirmer: null,
  leader: {
    id: 17,
    firstName: 'Natalie',
    lastName: 'Looper',
  },
  counter: null,
  venues: [],
  photos: [],
  submittedAt: new Date('2026-09-11T00:30:31.783Z'),
  createdAt: new Date('2026-09-10T22:00:00.000Z'),
  updatedAt: new Date('2026-09-11T00:30:31.783Z'),
};

const draftReport = {
  ...submittedReport,
  status: 'draft',
  submittedAt: null,
  updatedAt: new Date('2026-09-11T00:30:29.000Z'),
};

describe('submitNightReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFinanceFindAll.mockResolvedValue([]);
    mockBookingFindAll.mockResolvedValue([]);
    mockTransaction.mockImplementation(async (callback: (transaction: unknown) => unknown) =>
      callback(activeTransaction),
    );
    mockReconcileTaskWaivers.mockResolvedValue({
      waivedCount: 0,
      restoredCount: 0,
      unchangedCount: 0,
    });
  });

  it('returns the current report when an authorized caller repeats a completed submission', async () => {
    mockFindByPk.mockResolvedValue(submittedReport);
    const req = {
      params: { id: '434' },
      baseUrl: '/api/nightReports',
      authContext: { id: 17, userTypeId: 5, roleSlug: 'staff' },
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await submitNightReport(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 434,
        status: 'submitted',
        submittedAt: '2026-09-11T00:30:31.783Z',
      }),
    ]);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPhotoCount).not.toHaveBeenCalled();
    expect(mockReconcileTaskWaivers).toHaveBeenCalledTimes(1);
    expect(mockReconcileTaskWaivers).toHaveBeenCalledWith(submittedReport, {
      mode: 'sync',
      transaction: activeTransaction,
    });
  });

  it('still rejects a repeated submission when the caller cannot manage the report', async () => {
    mockFindByPk.mockResolvedValue(submittedReport);
    const req = {
      params: { id: '434' },
      baseUrl: '/api/nightReports',
      authContext: { id: 99, userTypeId: 5, roleSlug: 'staff' },
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await submitNightReport(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith([
      { message: 'You do not have permission to submit this report' },
    ]);
    expect(mockFinanceFindAll).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockReconcileTaskWaivers).not.toHaveBeenCalled();
  });

  it('atomically transitions a valid draft and reconciles waivers once', async () => {
    mockFindByPk
      .mockResolvedValueOnce(draftReport)
      .mockResolvedValueOnce(submittedReport);
    mockUpdate.mockResolvedValue([1]);
    mockPhotoCount.mockResolvedValue(0);
    const req = {
      params: { id: '434' },
      baseUrl: '/api/nightReports',
      authContext: { id: 17, userTypeId: 5, roleSlug: 'staff' },
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await submitNightReport(req, res);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'submitted',
        submittedAt: expect.any(Date),
        updatedBy: 17,
      }),
      { where: { id: 434, status: 'draft' }, transaction: activeTransaction },
    );
    expect(mockReconcileTaskWaivers).toHaveBeenCalledTimes(1);
    expect(mockReconcileTaskWaivers).toHaveBeenCalledWith(submittedReport, {
      mode: 'sync',
      transaction: activeTransaction,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns the winning submission when a concurrent request loses the transition race', async () => {
    mockFindByPk
      .mockResolvedValueOnce(draftReport)
      .mockResolvedValueOnce(submittedReport);
    mockUpdate.mockResolvedValue([0]);
    mockPhotoCount.mockResolvedValue(0);
    const req = {
      params: { id: '434' },
      baseUrl: '/api/nightReports',
      authContext: { id: 17, userTypeId: 5, roleSlug: 'staff' },
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await submitNightReport(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 434,
        status: 'submitted',
        submittedAt: '2026-09-11T00:30:31.783Z',
      }),
    ]);
    expect(mockReconcileTaskWaivers).toHaveBeenCalledTimes(1);
    expect(mockReconcileTaskWaivers).toHaveBeenCalledWith(submittedReport, {
      mode: 'sync',
      transaction: activeTransaction,
    });
  });

  it('preserves draft validation before attempting the status transition', async () => {
    mockFindByPk.mockResolvedValue({
      ...draftReport,
      venues: [
        {
          totalPeople: 10,
          isOpenBar: false,
        },
      ],
    });
    const req = {
      params: { id: '434' },
      baseUrl: '/api/nightReports',
      authContext: { id: 17, userTypeId: 5, roleSlug: 'staff' },
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await submitNightReport(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith([
      { message: 'Ensure at least one venue is marked as the open bar with required counts' },
    ]);
    expect(mockPhotoCount).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockReconcileTaskWaivers).not.toHaveBeenCalled();
  });

  it('does not mask a failed post-submit reconciliation on an idempotent retry', async () => {
    mockFindByPk.mockResolvedValue(submittedReport);
    mockReconcileTaskWaivers.mockRejectedValue(new Error('Database unavailable'));
    const req = {
      params: { id: '434' },
      baseUrl: '/api/nightReports',
      authContext: { id: 17, userTypeId: 5, roleSlug: 'staff' },
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await submitNightReport(req, res);

    expect(mockReconcileTaskWaivers).toHaveBeenCalledWith(submittedReport, {
      mode: 'sync',
      transaction: activeTransaction,
    });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith([{ message: 'Failed to submit night report' }]);
  });

  it('uses one transaction for the draft transition and waiver reconciliation', async () => {
    mockFindByPk
      .mockResolvedValueOnce(draftReport)
      .mockResolvedValueOnce(submittedReport);
    mockUpdate.mockResolvedValue([1]);
    mockPhotoCount.mockResolvedValue(0);
    mockReconcileTaskWaivers.mockRejectedValue(new Error('Database unavailable'));
    const req = {
      params: { id: '434' },
      baseUrl: '/api/nightReports',
      authContext: { id: 17, userTypeId: 5, roleSlug: 'staff' },
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await submitNightReport(req, res);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'submitted' }),
      expect.objectContaining({ transaction: activeTransaction }),
    );
    expect(mockFindByPk).toHaveBeenNthCalledWith(
      2,
      434,
      expect.objectContaining({ transaction: activeTransaction }),
    );
    expect(mockReconcileTaskWaivers).toHaveBeenCalledWith(submittedReport, {
      mode: 'sync',
      transaction: activeTransaction,
    });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith([{ message: 'Failed to submit night report' }]);
  });
});
