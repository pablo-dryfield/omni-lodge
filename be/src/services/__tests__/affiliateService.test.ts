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

import AffiliatePayoutLog from '../../models/AffiliatePayoutLog';
import Booking from '../../models/Booking';
import User from '../../__mocks__/sequelizeModelStub';
import { Op } from 'sequelize';
import { fetchBookingUtmCatalog } from '../bookings/bookingUtmCatalogService';
import { getConfigValue } from '../configService';
import { getAffiliateCommissionEligibility, getAffiliateOverview } from '../affiliateService';

const bookingFindAll = Booking.findAll as jest.Mock;
const userFindAll = User.findAll as jest.Mock;
const payoutLogFindAll = AffiliatePayoutLog.findAll as jest.Mock;
const configValue = getConfigValue as jest.Mock;
const utmCatalog = fetchBookingUtmCatalog as jest.Mock;

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
      expect(getAffiliateCommissionEligibility('2026-07-20T18:44:59.000Z')).toEqual({
        eligible: true,
        reason: null,
      });
      expect(getAffiliateCommissionEligibility('2026-07-20T18:45:00.000Z')).toEqual({
        eligible: false,
        reason: 'Booked after 20:45',
      });
      expect(getAffiliateCommissionEligibility('2026-01-20T19:44:59.000Z')).toEqual({
        eligible: true,
        reason: null,
      });
      expect(getAffiliateCommissionEligibility('2026-01-20T19:45:00.000Z')).toEqual({
        eligible: false,
        reason: 'Booked after 20:45',
      });
    } finally {
      if (originalTimezone == null) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('does not retroactively invalidate a commission that has already been paid', () => {
    expect(getAffiliateCommissionEligibility('2026-07-20T19:04:13.000Z', true)).toEqual({
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
    utmCatalog.mockResolvedValue({ utmSource: [], utmMedium: [], utmCampaign: [] });
  });

  it('excludes an unpaid booking received after the Warsaw cutoff', async () => {
    payoutLogFindAll.mockResolvedValue([]);

    const overview = await loadOverview();

    expect(overview.bookings[0]).toEqual(
      expect.objectContaining({
        affiliateCommissionEligible: false,
        affiliateCommissionIneligibleReason: 'Booked after 20:45',
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

  it('keeps the payout-log amount as historical earnings even after the rate or cutoff changes', async () => {
    payoutLogFindAll.mockResolvedValue([buildCristianPayoutLog()]);

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
  });
});
