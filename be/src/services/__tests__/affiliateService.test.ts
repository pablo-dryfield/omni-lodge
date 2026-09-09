jest.mock('../../models/Booking.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../__mocks__/sequelizeModelStub.ts', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/AffiliatePayoutLog.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/StaffProfile.js', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../configService.js', () => ({
  getConfigValue: jest.fn(),
  updateConfigValue: jest.fn(),
}));
jest.mock('../bookings/bookingUtmCatalogService.js', () => ({
  fetchBookingUtmCatalog: jest.fn(),
}));
jest.mock('../affiliateBookingHistoryService.js', () => ({
  fetchAffiliateBookingsWithPriorPubCrawl: jest.fn(),
}));

import AffiliatePayoutLog from '../../models/AffiliatePayoutLog';
import Booking from '../../models/Booking';
import User from '../../__mocks__/sequelizeModelStub';
import { Op } from 'sequelize';
import { fetchBookingUtmCatalog } from '../bookings/bookingUtmCatalogService';
import { getConfigValue } from '../configService';
import { getAffiliateCommissionEligibility, getAffiliateOverview } from '../affiliateService';
import { fetchAffiliateBookingsWithPriorPubCrawl } from '../affiliateBookingHistoryService';

const bookingFindAll = Booking.findAll as jest.Mock;
const userFindAll = User.findAll as jest.Mock;
const payoutLogFindAll = AffiliatePayoutLog.findAll as jest.Mock;
const configValue = getConfigValue as jest.Mock;
const utmCatalog = fetchBookingUtmCatalog as jest.Mock;
const previousPubCrawlBookings = fetchAffiliateBookingsWithPriorPubCrawl as jest.Mock;

const buildCristianBookings = () =>
  [
    { id: 9513, platformBookingId: '5EZDH', sourceReceivedAt: '2026-07-20T19:04:13.000Z', partySizeTotal: 1 },
    { id: 9514, platformBookingId: 'BTJOQ', sourceReceivedAt: '2026-07-20T19:08:10.000Z', partySizeTotal: 2 },
    { id: 9515, platformBookingId: '2IDGS', sourceReceivedAt: '2026-07-20T19:08:00.000Z', partySizeTotal: 1 },
  ].map((booking) => ({
    ...booking,
    platform: 'omnilodge',
    productName: 'Pub Crawl',
    product: null,
    guestFirstName: 'Affiliate',
    guestLastName: 'Guest',
    experienceDate: '2026-07-21',
    sourceReceivedAt: new Date(booking.sourceReceivedAt),
    partySizeAdults: booking.partySizeTotal,
    partySizeChildren: 0,
    baseAmount: 470,
    currency: 'PLN',
    utmSource: 'Cristian',
    utmMedium: 'Badge',
    utmCampaign: 'Staff',
  }));

const buildCristianPayoutLog = () => ({
  id: 2,
  affiliateUserId: 24,
  currencyCode: 'PLN',
  amountMinor: 8000,
  paidDate: '2026-08-15',
  rangeStart: '2026-07-01',
  rangeEnd: '2026-07-31',
  bookingIds: [9513, 9515, 9514],
  financeTransactionId: 601,
  note: 'Promotion sales payout for Cristian',
});

const loadOverview = () =>
  getAffiliateOverview({
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    selectedAffiliateUserId: 24,
    currentUserId: 1,
    currentRoleSlug: 'owner',
    includeStaffAffiliateAssignments: true,
  });

describe('getAffiliateCommissionEligibility', () => {
  it('applies 20:45 in Europe/Warsaw during both summer and winter time regardless of server timezone', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(getAffiliateCommissionEligibility('2026-07-20T18:44:59.000Z', '2026-07-20')).toEqual({
        eligible: true,
        reason: null,
      });
      expect(getAffiliateCommissionEligibility('2026-07-20T18:45:00.000Z', '2026-07-20')).toEqual({
        eligible: false,
        reason: 'Same-day booking at or after 20:45',
      });
      expect(getAffiliateCommissionEligibility('2026-01-20T19:44:59.000Z', '2026-01-20')).toEqual({
        eligible: true,
        reason: null,
      });
      expect(getAffiliateCommissionEligibility('2026-01-20T19:45:00.000Z', '2026-01-20')).toEqual({
        eligible: false,
        reason: 'Same-day booking at or after 20:45',
      });
    } finally {
      if (originalTimezone == null) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it.each([
    ['2026-07-20T20:00:00.000Z', '2026-07-21'],
    ['2026-01-20T21:00:00.000Z', '2026-01-21'],
    ['2026-07-31T21:59:59.000Z', '2026-08-01'],
    ['2026-07-20T20:00:00.000Z', '2026-08-20'],
  ])('allows a late booking for a later experience: %s / %s', (receivedAt, experienceDate) => {
    expect(getAffiliateCommissionEligibility(receivedAt, experienceDate)).toEqual({
      eligible: true,
      reason: null,
    });
  });

  it('uses the Warsaw calendar date and clock around UTC midnight', () => {
    expect(getAffiliateCommissionEligibility('2026-07-20T22:30:00.000Z', '2026-07-21')).toEqual({
      eligible: true,
      reason: null,
    });
    expect(getAffiliateCommissionEligibility('2026-01-20T23:30:00.000Z', '2026-01-21')).toEqual({
      eligible: true,
      reason: null,
    });
  });

  it.each([
    [null, '2026-07-20'],
    ['invalid', '2026-07-20'],
    ['2026-07-20T20:00:00.000Z', null],
  ])('does not infer a same-day cutoff from missing or invalid dates', (receivedAt, experienceDate) => {
    expect(getAffiliateCommissionEligibility(receivedAt, experienceDate)).toEqual({ eligible: true, reason: null });
  });

  it('excludes repeat customers even when they book ahead or before the cutoff', () => {
    for (const receivedAt of ['2026-07-20T20:00:00.000Z', '2026-07-20T10:00:00.000Z']) {
      expect(getAffiliateCommissionEligibility(receivedAt, '2026-07-21', false, true)).toEqual({
        eligible: false,
        reason: 'Previous Pub Crawl booking (matching email or phone)',
      });
    }
  });

  it('does not retroactively invalidate a commission that has already been paid', () => {
    expect(getAffiliateCommissionEligibility('2026-07-20T19:04:13.000Z', '2026-07-20', true, true)).toEqual({
      eligible: true,
      reason: null,
    });
  });
});

describe('getAffiliateOverview affiliate payout history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configValue.mockReturnValue({
      rules: [
        {
          id: 'cristian-badge',
          userId: 24,
          utmSource: 'Cristian',
          utmMedium: 'Badge',
          utmCampaign: 'Staff',
          notes: null,
        },
      ],
    });
    userFindAll.mockResolvedValue([
      {
        id: 24,
        firstName: 'Cristian',
        lastName: 'Iaderosa',
        status: true,
        userTypeId: 4,
        affiliateCommissionRate: 30,
        financeVendorId: 10,
        role: { id: 4, slug: 'pub-crawl-guide', name: 'Pub Crawl Guide' },
      },
    ]);
    bookingFindAll.mockResolvedValue(buildCristianBookings());
    previousPubCrawlBookings.mockResolvedValue(new Set());
    utmCatalog.mockResolvedValue({ utmSource: [], utmMedium: [], utmCampaign: [] });
  });

  it('excludes an unpaid same-day booking received after the Warsaw cutoff', async () => {
    payoutLogFindAll.mockResolvedValue([]);
    bookingFindAll.mockResolvedValue(buildCristianBookings().map((booking) => ({
      ...booking,
      experienceDate: '2026-07-20',
    })));

    const overview = await loadOverview();

    expect(overview.bookings[0]).toEqual(
      expect.objectContaining({
        affiliateCommissionEligible: false,
        affiliateCommissionIneligibleReason: 'Same-day booking at or after 20:45',
        affiliateCommissionAmount: 0,
        isCommissionPaid: false,
      }),
    );
    expect(overview.bookings).toHaveLength(3);
    expect(overview.summary.commissionTotal).toBe(0);
    const bookingQuery = bookingFindAll.mock.calls[0][0];
    expect(bookingQuery.where.sourceReceivedAt[Op.gte]).toBe('2026-06-30T22:00:00.000Z');
    expect(bookingQuery.where.sourceReceivedAt[Op.lt]).toBe('2026-07-31T22:00:00.000Z');
  });

  it('includes new-customer bookings received after the cutoff for the next day', async () => {
    payoutLogFindAll.mockResolvedValue([]);

    const overview = await loadOverview();

    expect(overview.bookings.every((booking) => booking.affiliateCommissionEligible)).toBe(true);
    expect(overview.bookings.map((booking) => booking.affiliateCommissionAmount)).toEqual([30, 60, 30]);
    expect(overview.summary.commissionOutstandingTotal).toBe(120);
    expect(previousPubCrawlBookings).toHaveBeenCalledTimes(1);
    expect(previousPubCrawlBookings).toHaveBeenCalledWith([9513, 9514, 9515], undefined);
  });

  it('keeps an explicitly unpaid booking in counts while excluding its revenue and commission', async () => {
    payoutLogFindAll.mockResolvedValue([]);
    bookingFindAll.mockResolvedValue(buildCristianBookings().map((booking, index) => ({
      ...booking,
      paymentStatus: index === 0 ? 'unpaid' : 'paid',
    })));

    const overview = await loadOverview();

    expect(overview.summary.bookingCount).toBe(3);
    expect(overview.dailySeries[0]).toEqual(expect.objectContaining({
      bookingCount: 3,
      peopleCount: 4,
      revenue: 940,
      commission: 90,
    }));
    expect(overview.bookings[0]).toEqual(expect.objectContaining({
      baseAmount: 0,
      paymentStatus: 'unpaid',
      affiliateCommissionEligible: false,
      affiliateCommissionIneligibleReason: 'Booking is unpaid',
      affiliateCommissionAmount: 0,
    }));
    expect(overview.summary.revenueTotal).toBe(940);
    expect(overview.summary.commissionOutstandingTotal).toBe(90);
  });

  it('excludes historical customer matches from commissions and report totals', async () => {
    payoutLogFindAll.mockResolvedValue([]);
    bookingFindAll.mockResolvedValue(buildCristianBookings().map((booking) => ({
      ...booking,
      // BIGINT values can be returned as strings by the database driver.
      id: String(booking.id),
    })));
    previousPubCrawlBookings.mockResolvedValue(new Set([9514]));

    const overview = await loadOverview();

    expect(overview.bookings[1]).toEqual(expect.objectContaining({
      affiliateCommissionEligible: false,
      affiliateCommissionIneligibleReason: 'Previous Pub Crawl booking (matching email or phone)',
      affiliateCommissionAmount: 0,
    }));
    expect(overview.summary.commissionOutstandingTotal).toBe(60);
    expect(overview.dailySeries[0].commission).toBe(60);
    expect(overview.affiliateBreakdown[0].outstandingCommission).toBe(60);
  });

  it('keeps the payout-log amount as historical earnings even after the rate or cutoff changes', async () => {
    payoutLogFindAll.mockResolvedValue([buildCristianPayoutLog()]);
    bookingFindAll.mockResolvedValue(buildCristianBookings().map((booking) => ({
      ...booking,
      id: String(booking.id),
    })));

    const overview = await loadOverview();

    expect(overview.bookings[0]).toEqual(
      expect.objectContaining({
        affiliateCommissionEligible: true,
        affiliateCommissionIneligibleReason: null,
        affiliateCommissionPerPerson: 20,
        affiliateCommissionAmount: 20,
        affiliatePayoutLogId: 2,
        isCommissionPaid: true,
      }),
    );
    expect(overview.bookings.map((booking) => booking.affiliateCommissionAmount)).toEqual([20, 40, 20]);
    expect(overview.summary).toEqual(
      expect.objectContaining({
        commissionTotal: 80,
        commissionPaidTotal: 80,
        commissionOutstandingTotal: 0,
      }),
    );
    expect(previousPubCrawlBookings).toHaveBeenCalledWith([], undefined);
  });

  it('preserves a payout allocation when some paid bookings are outside the selected range', async () => {
    payoutLogFindAll.mockResolvedValue([buildCristianPayoutLog()]);
    bookingFindAll
      .mockResolvedValueOnce([{ ...buildCristianBookings()[0], id: '9513' }])
      .mockResolvedValueOnce([
        { id: '9514', partySizeTotal: 2 },
        { id: '9515', partySizeTotal: 1 },
      ]);

    const overview = await loadOverview();

    expect(overview.bookings[0].affiliateCommissionAmount).toBe(20);
    expect(overview.summary.commissionPaidTotal).toBe(20);
    expect(overview.summary.commissionOutstandingTotal).toBe(0);
  });
});
