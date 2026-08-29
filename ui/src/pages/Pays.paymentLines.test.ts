import { buildDefaultPaymentLines } from './Pays';
import type { Pay, PayAffiliateSaleBooking } from '../types/pays/Pay';

jest.mock('axios', () => {
  const axiosInstance = {
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => axiosInstance),
      isAxiosError: jest.fn(() => false),
      isCancel: jest.fn(() => false),
    },
  };
});

const createAffiliateBooking = (
  id: number,
  amount: number,
  isCommissionPaid: boolean,
): PayAffiliateSaleBooking => ({
  id,
  platformBookingId: `booking-${id}`,
  productName: 'Pub Crawl',
  guestName: `Guest ${id}`,
  sourceReceivedAt: '2026-07-10T12:00:00.000Z',
  experienceDate: '2026-07-12',
  partySizeTotal: 2,
  baseAmount: 200,
  currency: 'PLN',
  affiliateCommissionPerPerson: amount / 2,
  affiliateCommissionAmount: amount,
  affiliateCommissionEligible: true,
  affiliateCommissionIneligibleReason: null,
  isCommissionPaid,
  utmSource: 'luna',
  utmMedium: null,
  utmCampaign: null,
});

const createStaff = (overrides: Partial<Pay>): Pay => ({
  userId: 177,
  firstName: 'Luna',
  totalCommission: 0,
  totalPayout: 0,
  breakdown: [],
  ...overrides,
});

describe('buildDefaultPaymentLines', () => {
  it('does not let an older Promotion Sales payment consume newly outstanding bookings', () => {
    const paidBooking = createAffiliateBooking(1001, 40, true);
    const outstandingBooking = createAffiliateBooking(1002, 60, false);
    const staff = createStaff({
      totalPayout: 60,
      paidEntries: [
        {
          id: 501,
          financeTransactionId: 7001,
          label: 'Promotion Sales',
          componentId: null,
          amount: 40,
          currency: 'PLN',
          date: '2026-07-15',
          note: null,
          createdAt: '2026-07-15T12:00:00.000Z',
          canDelete: true,
        },
      ],
      affiliateSales: {
        bookingCount: 2,
        peopleCount: 4,
        revenueTotal: 400,
        commissionTotal: 100,
        commissionPaidTotal: 40,
        commissionOutstandingTotal: 60,
        currency: 'PLN',
        bookings: [paidBooking, outstandingBooking],
      },
    });

    const lines = buildDefaultPaymentLines(staff, new Map(), '', new Map());
    const promotionLine = lines.find((line) => line.label === 'Promotion Sales');

    expect(promotionLine).toMatchObject({
      amount: 60,
      affiliatePayout: {
        affiliateUserId: 177,
        bookingIds: [1002],
      },
    });
  });

  it('continues reconciling recorded payments for ordinary payout lines', () => {
    const staff = createStaff({
      totalPayout: 100,
      bucketTotals: { bonus: 100 },
      paidEntries: [
        {
          id: 502,
          financeTransactionId: 7002,
          label: 'Bonus',
          componentId: null,
          amount: 40,
          currency: 'PLN',
          date: '2026-07-15',
          note: null,
          createdAt: '2026-07-15T12:00:00.000Z',
          canDelete: true,
        },
      ],
    });

    const lines = buildDefaultPaymentLines(staff, new Map(), '', new Map());

    expect(lines.find((line) => line.label === 'Bonus')?.amount).toBe(60);
  });
});
