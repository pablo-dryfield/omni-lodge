import type { Response } from 'express';

jest.mock('../bookingController.js', () => ({ listBookings: jest.fn() }));
jest.mock('../nightReportController.js', () => ({ getNightReportVenueSummary: jest.fn() }));
jest.mock('../reportController.js', () => ({ getCommissionByDateRange: jest.fn() }));
jest.mock('../../middleware/authorizationMiddleware.js', () => ({
  hasModuleActionPermission: jest.fn(),
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { hasModuleActionPermission } from '../../middleware/authorizationMiddleware.js';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';
import { listBookings } from '../bookingController.js';
import { getNightReportVenueSummary } from '../nightReportController.js';
import { getCommissionByDateRange } from '../reportController.js';
import { listBookingsWithSummary } from '../bookingSummaryController.js';

const mockListBookings = listBookings as jest.Mock;
const mockVenueSummary = getNightReportVenueSummary as jest.Mock;
const mockCommissionSummary = getCommissionByDateRange as jest.Mock;
const mockHasPermission = hasModuleActionPermission as jest.Mock;

const makeRequest = (query: Record<string, string>): AuthenticatedRequest => ({
  query,
  authContext: {
    id: 7,
    userTypeId: 2,
    roleSlug: 'owner',
  },
} as unknown as AuthenticatedRequest);

const makeResponse = (): Response => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
  } as unknown as Response;
  (response.status as jest.Mock).mockReturnValue(response);
  return response;
};

const replyWith = (body: unknown, statusCode = 200) => (
  async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    res.status(statusCode).json(body);
  }
);

describe('listBookingsWithSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasPermission.mockResolvedValue(true);
    mockListBookings.mockImplementation(replyWith({ orders: [{ id: 1 }], costInsights: { otherExpenses: {} } }));
    mockVenueSummary.mockImplementation(replyWith([{ data: { venues: [{ venueId: 3 }] } }]));
    mockCommissionSummary.mockImplementation(replyWith([{
      data: [{
        userId: 5,
        firstName: 'Aimee',
        lastName: 'Kelly',
        staffType: 'Long-Term',
        dueAmount: 125,
        payouts: { currency: 'PLN', payableDue: 125, payablePaid: 100, payableOutstanding: 25 },
        settlementReconciliationRequired: false,
        settlementSources: [{
          sourceKey: 'guide_commission',
          label: 'Guide commission',
          category: 'commission',
          amount: 150,
          destination: 'staff_vendor',
          settledAmount: 100,
          outstandingAmount: 25,
          earningStart: '2026-08-01',
          earningEnd: '2026-08-31',
          staffType: 'long_term',
          referenceIds: [701],
          ruleId: 11,
          fundId: null,
          settlementIntent: 'sensitive-signed-intent',
        }, {
          sourceKey: 'quality_adjustment',
          label: 'Quality adjustment',
          category: 'deduction',
          amount: -25,
          destination: 'staff_vendor',
          settledAmount: 0,
          outstandingAmount: 0,
          earningStart: null,
          earningEnd: null,
          staffType: null,
        }, {
          sourceKey: 'volunteer_bonus',
          label: 'Volunteer bonus',
          category: 'bonus',
          amount: 40,
          destination: 'volunteer_fund',
          settledAmount: 0,
          outstandingAmount: 40,
          fundId: 9,
          settlementIntent: 'sensitive-fund-intent',
        }],
      }, {
        userId: 6,
        fullName: 'Zero Due Guide',
        staffType: 'Volunteer',
        dueAmount: 0,
        payouts: { currency: 'PLN', payableDue: 0, payablePaid: 0, payableOutstanding: 0 },
        settlementReconciliationRequired: false,
        settlementSources: [],
      }],
      accessScope: 'all',
    }]));
  });

  it('returns bookings, venues, staff payouts, and expenses through one response', async () => {
    const req = makeRequest({
      pickupFrom: '2026-08-01',
      pickupTo: '2026-08-31',
      includeSummaryInsights: 'true',
      productTypeIds: '1,2',
    });
    const res = makeResponse();

    await listBookingsWithSummary(req, res);

    expect(mockHasPermission).toHaveBeenCalledWith(req, 'staff-payouts-all', 'view');
    expect(mockListBookings.mock.calls[0][0].query).toEqual(expect.objectContaining({
      includeCostInsights: 'true',
    }));
    expect(mockVenueSummary.mock.calls[0][0].query).toEqual({
      period: 'custom',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });
    expect(mockCommissionSummary.mock.calls[0][0]).toEqual(expect.objectContaining({
      staffPayoutAccessScope: 'all',
      query: {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        scope: 'all',
      },
    }));
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      orders: [{ id: 1 }],
      costInsights: { otherExpenses: {} },
      summaryInsights: {
        venueSummary: [{ data: { venues: [{ venueId: 3 }] } }],
        staffPayments: [{
          userId: 5,
          fullName: 'Aimee Kelly',
          staffType: 'Long-Term',
          currency: 'PLN',
          amount: 125,
          paid: 100,
          outstanding: 25,
          breakdown: [{
            label: 'Guide commission',
            category: 'commission',
            amount: 150,
            earningStart: '2026-08-01',
            earningEnd: '2026-08-31',
            staffType: 'long_term',
          }, {
            label: 'Quality adjustment',
            category: 'deduction',
            amount: -25,
            earningStart: null,
            earningEnd: null,
            staffType: null,
          }],
        }, {
          userId: 6,
          fullName: 'Zero Due Guide',
          staffType: 'Volunteer',
          currency: 'PLN',
          amount: 0,
          paid: 0,
          outstanding: 0,
          breakdown: [],
        }],
      },
    });
  });

  it('merges adjacent display segments with identical compensation and routing identity', async () => {
    const staffVendorSource = {
      sourceKey: 'compensation_component',
      category: 'base',
      destination: 'staff_vendor',
      fundId: null,
      ruleId: 1,
      currency: 'PLN',
      routeChanged: false,
      settledAmount: 0,
      outstandingAmount: 0,
    };
    mockCommissionSummary.mockImplementation(replyWith([{
      data: [{
        userId: 1,
        fullName: 'Pablo Cabrera',
        staffType: 'Long-Term',
        dueAmount: 5_856.92,
        payouts: {
          currency: 'PLN',
          payableDue: 5_856.92,
          payablePaid: 0,
          payableOutstanding: 5_856.92,
        },
        settlementReconciliationRequired: false,
        settlementSources: [{
          ...staffVendorSource,
          componentId: 12,
          segmentKey: 'assistant-manager-aug-8',
          staffTypePeriodId: 68,
          legacyExtrapolation: true,
          label: 'Assistant Manager Salary',
          amount: 41.67,
          earningStart: '2026-08-08',
          earningEnd: '2026-08-08',
          staffType: 'long_term',
        }, {
          ...staffVendorSource,
          componentId: 13,
          segmentKey: 'manager-salary-period-68',
          staffTypePeriodId: 68,
          legacyExtrapolation: true,
          label: 'Manager Salary',
          amount: 4_677.42,
          earningStart: '2026-08-01',
          earningEnd: '2026-08-29',
          staffType: 'long_term',
        }, {
          ...staffVendorSource,
          componentId: 13,
          segmentKey: 'manager-salary-period-15',
          staffTypePeriodId: 15,
          legacyExtrapolation: false,
          label: 'Manager Salary',
          amount: 322.58,
          earningStart: '2026-08-30',
          earningEnd: '2026-08-31',
          staffType: 'long_term',
        }, {
          ...staffVendorSource,
          componentId: 11,
          segmentKey: 'manager-incentive-period-68',
          staffTypePeriodId: 68,
          legacyExtrapolation: true,
          label: 'Manager Incentive',
          category: 'incentive',
          amount: 762.67,
          earningStart: '2026-08-01',
          earningEnd: '2026-08-29',
          staffType: 'long_term',
        }, {
          ...staffVendorSource,
          componentId: 11,
          segmentKey: 'manager-incentive-period-15',
          staffTypePeriodId: 15,
          legacyExtrapolation: false,
          label: 'Manager Incentive',
          category: 'incentive',
          amount: 52.58,
          earningStart: '2026-08-30',
          earningEnd: '2026-08-31',
          staffType: 'long_term',
        }],
      }],
      accessScope: 'all',
    }]));
    const req = makeRequest({
      pickupFrom: '2026-08-01',
      pickupTo: '2026-08-31',
      includeSummaryInsights: 'true',
    });
    const res = makeResponse();

    await listBookingsWithSummary(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.summaryInsights.staffPayments).toEqual([expect.objectContaining({
      userId: 1,
      amount: 5_856.92,
      breakdown: [{
        label: 'Assistant Manager Salary',
        category: 'base',
        amount: 41.67,
        earningStart: '2026-08-08',
        earningEnd: '2026-08-08',
        staffType: 'long_term',
      }, {
        label: 'Manager Salary',
        category: 'base',
        amount: 5_000,
        earningStart: '2026-08-01',
        earningEnd: '2026-08-31',
        staffType: 'long_term',
      }, {
        label: 'Manager Incentive',
        category: 'incentive',
        amount: 815.25,
        earningStart: '2026-08-01',
        earningEnd: '2026-08-31',
        staffType: 'long_term',
      }],
    })]);
    expect(JSON.stringify(payload)).not.toContain('staffTypePeriodId');
    expect(JSON.stringify(payload)).not.toContain('segmentKey');
  });

  it('withholds staff breakdowns that are unreconciled or do not match the authoritative due', async () => {
    mockCommissionSummary.mockImplementation(replyWith([{
      data: [{
        userId: 8,
        fullName: 'Reconciliation Required',
        dueAmount: 30,
        payouts: { currency: 'PLN', payablePaid: 0, payableOutstanding: 30 },
        settlementReconciliationRequired: true,
        settlementSources: [{
          label: 'Guide commission',
          category: 'commission',
          amount: 30,
          destination: 'staff_vendor',
          settledAmount: 0,
          outstandingAmount: 30,
          settlementIntent: 'must-not-leak',
        }],
      }, {
        userId: 9,
        fullName: 'Mismatched Sources',
        dueAmount: 50,
        payouts: { currency: 'PLN', payablePaid: 0, payableOutstanding: 50 },
        settlementReconciliationRequired: false,
        settlementSources: [{
          label: 'Base salary',
          category: 'base',
          amount: 45,
          destination: 'staff_vendor',
          settledAmount: 0,
          outstandingAmount: 45,
          referenceIds: [9001],
          settlementIntent: 'also-must-not-leak',
        }],
      }],
      accessScope: 'all',
    }]));
    const req = makeRequest({
      pickupFrom: '2026-08-01',
      pickupTo: '2026-08-31',
      includeSummaryInsights: 'true',
    });
    const res = makeResponse();

    await listBookingsWithSummary(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      summaryInsights: expect.objectContaining({
        staffPayments: [
          expect.objectContaining({ userId: 8, amount: 30, breakdown: null }),
          expect.objectContaining({ userId: 9, amount: 50, breakdown: null }),
        ],
      }),
    }));
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(payload)).not.toContain('must-not-leak');
    expect(JSON.stringify(payload)).not.toContain('referenceIds');
  });

  it('uses payable due and never treats a staff receivable as a staff payment cost', async () => {
    mockCommissionSummary.mockImplementation(replyWith([{
      data: [{
        userId: 10,
        fullName: 'Staff Receivable',
        dueAmount: -80,
        payouts: {
          currency: 'PLN',
          payableDue: 0,
          payablePaid: 0,
          payableOutstanding: 0,
        },
        settlementReconciliationRequired: false,
        settlementSources: [{
          label: 'Historical correction',
          category: 'adjustment',
          amount: -80,
          destination: 'staff_vendor',
        }],
      }],
      accessScope: 'all',
    }]));
    const req = makeRequest({
      pickupFrom: '2026-08-01',
      pickupTo: '2026-08-31',
      includeSummaryInsights: 'true',
    });
    const res = makeResponse();

    await listBookingsWithSummary(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      summaryInsights: expect.objectContaining({
        staffPayments: [expect.objectContaining({
          userId: 10,
          amount: 0,
          breakdown: null,
        })],
      }),
    }));
  });

  it('omits staff payout data when the user lacks full access', async () => {
    mockHasPermission.mockResolvedValue(false);
    const req = makeRequest({
      pickupFrom: '2026-08-01',
      pickupTo: '2026-08-31',
      includeSummaryInsights: 'true',
    });
    const res = makeResponse();

    await listBookingsWithSummary(req, res);

    expect(mockCommissionSummary).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      summaryInsights: expect.objectContaining({ staffPayments: null }),
    }));
  });

  it('uses the regular bookings controller outside the Summary tab', async () => {
    const req = makeRequest({ pickupFrom: '2026-08-01', pickupTo: '2026-08-31' });
    const res = makeResponse();

    await listBookingsWithSummary(req, res);

    expect(mockListBookings).toHaveBeenCalledWith(req, res);
    expect(mockHasPermission).not.toHaveBeenCalled();
    expect(mockVenueSummary).not.toHaveBeenCalled();
    expect(mockCommissionSummary).not.toHaveBeenCalled();
  });

  it('rejects an invalid Summary range before running any aggregate', async () => {
    const req = makeRequest({
      pickupFrom: '2026-08-31',
      pickupTo: '2026-08-01',
      includeSummaryInsights: 'true',
    });
    const res = makeResponse();

    await listBookingsWithSummary(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockListBookings).not.toHaveBeenCalled();
    expect(mockVenueSummary).not.toHaveBeenCalled();
    expect(mockCommissionSummary).not.toHaveBeenCalled();
  });

  it('keeps venue and staff failures isolated from the bookings response', async () => {
    mockVenueSummary.mockImplementation(replyWith([{ message: 'venue unavailable' }], 500));
    mockCommissionSummary.mockImplementation(replyWith([{ message: 'staff unavailable' }], 503));
    const req = makeRequest({
      pickupFrom: '2026-08-01',
      pickupTo: '2026-08-31',
      includeSummaryInsights: 'true',
    });
    const res = makeResponse();

    await listBookingsWithSummary(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      orders: [{ id: 1 }],
      summaryInsights: {
        venueSummary: null,
        staffPayments: null,
      },
    }));
  });

  it('keeps an unexpected optional-source rejection isolated', async () => {
    mockVenueSummary.mockRejectedValue(new Error('venue query crashed'));
    const req = makeRequest({
      pickupFrom: '2026-08-01',
      pickupTo: '2026-08-31',
      includeSummaryInsights: 'true',
    });
    const res = makeResponse();

    await listBookingsWithSummary(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      summaryInsights: expect.objectContaining({
        venueSummary: null,
        staffPayments: expect.any(Array),
      }),
    }));
  });

  it('keeps a bookings failure hard and preserves its HTTP response', async () => {
    mockListBookings.mockImplementation(replyWith({ message: 'bookings unavailable' }, 502));
    const req = makeRequest({
      pickupFrom: '2026-08-01',
      pickupTo: '2026-08-31',
      includeSummaryInsights: 'true',
    });
    const res = makeResponse();

    await listBookingsWithSummary(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ message: 'bookings unavailable' });
  });

  it('does not run Summary aggregates for an orders-only request', async () => {
    const req = makeRequest({
      pickupFrom: '2026-08-01',
      pickupTo: '2026-08-31',
      includeSummaryInsights: 'true',
      ordersOnly: 'true',
    });
    const res = makeResponse();

    await listBookingsWithSummary(req, res);

    expect(mockListBookings).toHaveBeenCalledWith(req, res);
    expect(mockHasPermission).not.toHaveBeenCalled();
    expect(mockVenueSummary).not.toHaveBeenCalled();
    expect(mockCommissionSummary).not.toHaveBeenCalled();
  });
});
