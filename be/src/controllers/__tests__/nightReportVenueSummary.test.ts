import type { Response } from 'express';
import NightReportVenue from '../../models/NightReportVenue';
import VenueCompensationLedger from '../../models/VenueCompensationLedger';
import { getAllowedProductTypeIds } from '../../services/productScopeService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { getNightReportVenueSummary } from '../nightReportController';

jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Counter.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/NightReport.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/NightReportVenue.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/NightReportPhoto.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Venue.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/VenueCompensationTerm.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/VenueCompensationTermRate.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/VenueCompensationCollectionLog.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/VenueCompensationLedger.js', () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    upsert: jest.fn(),
    create: jest.fn(),
  },
}));
jest.mock('../../finance/models/FinanceAccount.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceCategory.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceFile.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceTransaction.js', () => ({ __esModule: true, default: {} }));
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

const mockFindVenueRows = NightReportVenue.findAll as jest.Mock;
const mockGetAllowedProductTypeIds = getAllowedProductTypeIds as jest.Mock;
const mockLedgerFindAll = VenueCompensationLedger.findAll as jest.Mock;
const mockLedgerUpsert = VenueCompensationLedger.upsert as jest.Mock;

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

describe('getNightReportVenueSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllowedProductTypeIds.mockResolvedValue([12]);
    mockFindVenueRows.mockResolvedValue([
      {
        venueId: 41,
        venueName: 'Cellar Bar',
        currencyCode: 'PLN',
        direction: 'receivable',
        payoutAmount: 90,
        totalPeople: 9,
        normalCount: 9,
        cocktailsCount: 0,
        brunchCount: 0,
        stayDurationMinutes: 75,
        activityDate: '2026-08-02',
        reportId: 701,
        allowsOpenBar: false,
      },
      {
        venueId: 41,
        venueName: 'Cellar Bar',
        currencyCode: 'PLN',
        direction: 'receivable',
        payoutAmount: 110,
        totalPeople: 11,
        normalCount: 11,
        cocktailsCount: 0,
        brunchCount: 0,
        stayDurationMinutes: 90,
        activityDate: '2026-08-03',
        reportId: 702,
        allowsOpenBar: false,
      },
    ]);
  });

  it('selects and returns stay duration for every venue daily row', async () => {
    const req = {
      query: {
        period: 'custom',
        startDate: '2026-08-02',
        endDate: '2026-08-03',
      },
      authContext: { id: 1, userTypeId: 1, roleSlug: 'manager' },
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await getNightReportVenueSummary(req, res);

    expect(mockGetAllowedProductTypeIds).toHaveBeenCalledWith(req);
    expect(mockFindVenueRows).toHaveBeenCalledTimes(1);
    expect(mockFindVenueRows.mock.calls[0][0].attributes).toEqual(
      expect.arrayContaining(['stayDurationMinutes']),
    );

    const responsePayload = res.json.mock.calls[0][0];
    expect(responsePayload[0].data.venues[0].daily).toEqual([
      expect.objectContaining({
        date: '2026-08-02',
        reportId: 701,
        stayDurationMinutes: 75,
      }),
      expect.objectContaining({
        date: '2026-08-03',
        reportId: 702,
        stayDurationMinutes: 90,
      }),
    ]);
    expect(mockLedgerFindAll).not.toHaveBeenCalled();
    expect(mockLedgerUpsert).not.toHaveBeenCalled();
  });
});
