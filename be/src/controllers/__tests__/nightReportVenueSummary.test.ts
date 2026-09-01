import type { Response } from 'express';
import NightReportVenue from '../../models/NightReportVenue';
import VenueCompensationCollectionLog from '../../models/VenueCompensationCollectionLog';
import VenueCompensationLedger from '../../models/VenueCompensationLedger';
import VenueCompensationTerm from '../../models/VenueCompensationTerm';
import VenueCompensationTermRate from '../../models/VenueCompensationTermRate';
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
jest.mock('../../models/VenueCompensationTerm.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/VenueCompensationTermRate.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
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
const mockCollectionFindAll = VenueCompensationCollectionLog.findAll as jest.Mock;
const mockLedgerFindAll = VenueCompensationLedger.findAll as jest.Mock;
const mockLedgerUpsert = VenueCompensationLedger.upsert as jest.Mock;
const mockTermFindAll = VenueCompensationTerm.findAll as jest.Mock;
const mockRateFindAll = VenueCompensationTermRate.findAll as jest.Mock;

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
    mockCollectionFindAll.mockResolvedValue([]);
    mockTermFindAll.mockResolvedValue([]);
    mockRateFindAll.mockResolvedValue([]);
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
    expect(responsePayload[0].data.collectionDataAvailable).toBe(false);
    expect(responsePayload[0].data.venues[0].daily).toEqual([
      expect.objectContaining({
        date: '2026-08-02',
        reportId: 701,
        stayDurationMinutes: 75,
        normalCount: 9,
        cocktailsCount: 0,
        brunchCount: 0,
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

  it('marks collection data available for users without a product-type scope', async () => {
    mockGetAllowedProductTypeIds.mockResolvedValue(null);
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

    expect(mockCollectionFindAll).toHaveBeenCalledTimes(1);
    const responsePayload = res.json.mock.calls[0][0];
    expect(responsePayload[0].data.collectionDataAvailable).toBe(true);
  });

  it('does not read or rewrite full venue ledgers from product-scoped data', async () => {
    const req = {
      query: {
        period: 'custom',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      },
      authContext: { id: 1, userTypeId: 1, roleSlug: 'manager' },
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await getNightReportVenueSummary(req, res);

    const responsePayload = res.json.mock.calls[0][0];
    expect(responsePayload[0].data.rangeIsCanonical).toBe(true);
    expect(responsePayload[0].data.collectionDataAvailable).toBe(false);
    expect(mockCollectionFindAll).not.toHaveBeenCalled();
    expect(mockLedgerFindAll).not.toHaveBeenCalled();
    expect(mockLedgerUpsert).not.toHaveBeenCalled();
  });

  it('returns the effective per-guest rate bands for payable Open Bar rows', async () => {
    mockFindVenueRows.mockResolvedValue([
      {
        venueId: 51,
        venueName: 'Open Bar One',
        currencyCode: 'PLN',
        direction: 'payable',
        payoutAmount: 70,
        totalPeople: 10,
        normalCount: 6,
        cocktailsCount: 4,
        brunchCount: 0,
        stayDurationMinutes: null,
        compensationTermId: 501,
        productId: 81,
        activityDate: '2026-08-03',
        reportId: 703,
        allowsOpenBar: true,
      },
    ]);
    mockTermFindAll.mockResolvedValue([
      { id: 501, rateAmount: 5, rateUnit: 'per_person' },
    ]);
    mockRateFindAll.mockResolvedValue([
      {
        id: 601,
        termId: 501,
        productId: 81,
        ticketType: 'normal',
        rateAmount: 5,
        rateUnit: 'per_person',
        validFrom: '2026-01-01',
        validTo: null,
      },
      {
        id: 602,
        termId: 501,
        productId: 81,
        ticketType: 'cocktail',
        rateAmount: 10,
        rateUnit: 'per_person',
        validFrom: '2026-01-01',
        validTo: null,
      },
    ]);
    const req = {
      query: {
        period: 'custom',
        startDate: '2026-08-03',
        endDate: '2026-08-03',
      },
      authContext: { id: 1, userTypeId: 1, roleSlug: 'manager' },
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await getNightReportVenueSummary(req, res);

    expect(mockTermFindAll).toHaveBeenCalledTimes(1);
    expect(mockRateFindAll).toHaveBeenCalledTimes(1);
    expect(mockRateFindAll.mock.calls[0][0].where).not.toHaveProperty('isActive');
    const responsePayload = res.json.mock.calls[0][0];
    expect(responsePayload[0].data.venues[0].daily[0]).toEqual(expect.objectContaining({
      rateBreakdownMatchesPayout: true,
      rateBands: [
        expect.objectContaining({
          ticketType: 'normal',
          count: 6,
          rateAmount: 5,
          amount: 30,
        }),
        expect.objectContaining({
          ticketType: 'cocktail',
          count: 4,
          rateAmount: 10,
          amount: 40,
        }),
      ],
    }));
  });
});
