jest.mock('../../models/Booking.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn(() => null) }));
jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn(), isAxiosError: jest.fn(() => false) },
}));
jest.mock('googleapis', () => ({
  google: { auth: { OAuth2: jest.fn() } },
}));

import Booking from '../../models/Booking';
import { getMarketingOverview } from '../marketingService';

const bookingFindAll = Booking.findAll as jest.Mock;

describe('getMarketingOverview booking revenue recognition', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bookingFindAll.mockResolvedValue([
      {
        id: 1,
        platformBookingId: 'BT-PENDING',
        platform: 'omnilodge',
        productName: 'Pub Crawl',
        product: null,
        guestFirstName: 'Pending',
        guestLastName: 'Guest',
        experienceDate: '2026-09-10',
        experienceStartAt: new Date('2026-09-10T19:00:00.000Z'),
        sourceReceivedAt: new Date('2026-09-07T10:00:00.000Z'),
        baseAmount: '100.00',
        currency: 'PLN',
        paymentStatus: 'unpaid',
        utmSource: 'Meta Ads',
        utmMedium: 'social',
        utmCampaign: 'September',
      },
      {
        id: 2,
        platformBookingId: 'LEGACY-UNKNOWN',
        platform: 'omnilodge',
        productName: 'Pub Crawl',
        product: null,
        guestFirstName: 'Legacy',
        guestLastName: 'Guest',
        experienceDate: '2026-09-10',
        experienceStartAt: new Date('2026-09-10T19:00:00.000Z'),
        sourceReceivedAt: new Date('2026-09-07T11:00:00.000Z'),
        baseAmount: '50.00',
        currency: 'PLN',
        paymentStatus: 'unknown',
        utmSource: 'Meta Ads',
        utmMedium: 'social',
        utmCampaign: 'September',
      },
    ]);
  });

  it('retains booking counts but zeros only explicit unpaid revenue', async () => {
    const overview = await getMarketingOverview('2026-09-07', '2026-09-07');

    expect(overview.overall.bookingCount).toBe(2);
    expect(overview.overall.revenueTotal).toBe(50);
    expect(overview.metaAds.bookingCount).toBe(2);
    expect(overview.metaAds.revenueTotal).toBe(50);
    expect(overview.metaAds.bookings).toEqual([
      expect.objectContaining({ platformBookingId: 'BT-PENDING', baseAmount: 0 }),
      expect.objectContaining({ platformBookingId: 'LEGACY-UNKNOWN', baseAmount: 50 }),
    ]);
    expect(bookingFindAll.mock.calls[0][0].attributes).toContain('paymentStatus');
  });
});
