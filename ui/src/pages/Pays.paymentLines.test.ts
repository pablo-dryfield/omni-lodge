import {
  buildDefaultFundAllocationLines,
  buildDefaultPaymentLines,
  createStaffPayoutSettlementRequestId,
  formatPayStaffName,
} from './Pays';
import type { Pay, PayAffiliateSaleBooking, PaySettlementSource } from '../types/pays/Pay';

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

const createGuideCommissionSource = (
  destination: PaySettlementSource['destination'],
): PaySettlementSource => ({
  sourceKey: 'guide_commission',
  label: 'Pub Crawl - Commission',
  componentId: null,
  category: 'commission',
  amount: 100,
  destination,
  fundId: destination === 'volunteer_fund' ? 1 : null,
  fundName: destination === 'volunteer_fund' ? 'Volunteer Fund' : null,
  ruleId: 10,
  settledAmount: 0,
  allocatedAmount: 0,
  outstandingAmount: 100,
  overallocatedAmount: 0,
  currency: 'PLN',
  allocatedFundIds: [],
  routeChanged: false,
  settlementIntent: 'signed-period-routing-intent',
});

const volunteerCommissionStaff = (overrides: Partial<Pay> = {}): Pay => createStaff({
  staffType: 'volunteer',
  totalPayout: 100,
  personalPayableTotal: 100,
  closingBalance: 100,
  payouts: {
    currency: 'PLN',
    payableDue: 100,
    payablePaid: 0,
    payableOutstanding: 100,
    receivableDue: 0,
    receivableCollected: 0,
    receivableOutstanding: 0,
  },
  productTotals: [{
    productId: 1,
    productName: 'Pub Crawl',
    counterIds: [],
    totalCustomers: 10,
    totalCommission: 100,
    componentTotals: [],
  }],
  ...overrides,
});

describe('formatPayStaffName', () => {
  it('prefers and normalizes the full name supplied by the payout payload', () => {
    expect(formatPayStaffName({
      firstName: 'Ignored',
      lastName: 'Fields',
      fullName: '  Luna   Martini  ',
    })).toBe('Luna Martini');
  });

  it('combines first and last name when fullName is absent', () => {
    expect(formatPayStaffName({ firstName: '  Cristian ', lastName: ' Lopez  ' }))
      .toBe('Cristian Lopez');
  });

  it('uses an unambiguous staff id when name fields are empty', () => {
    expect(formatPayStaffName({ firstName: ' ', lastName: null, userId: 177 }))
      .toBe('Staff #177');
  });

  it('uses the safe generic fallback when no identity is available', () => {
    expect(formatPayStaffName(null)).toBe('Staff member');
  });
});

describe('createStaffPayoutSettlementRequestId', () => {
  it('creates distinct backend-safe identifiers for separate modal opens', () => {
    const firstRequestId = createStaffPayoutSettlementRequestId();
    const secondRequestId = createStaffPayoutSettlementRequestId();

    expect(firstRequestId).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(secondRequestId).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(secondRequestId).not.toBe(firstRequestId);
  });
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

  it('keeps an explicitly routed historical Volunteer liability payable to staff', () => {
    const staff = volunteerCommissionStaff({
      range: { startDate: '2026-07-01', endDate: '2026-07-31' },
      settlementSources: [createGuideCommissionSource('staff_vendor')],
    });

    const lines = buildDefaultPaymentLines(staff, new Map(), '', new Map());

    expect(lines).toEqual([
      expect.objectContaining({
        label: 'Pub Crawl - Commission',
        sourceKey: 'guide_commission',
        amount: 100,
        settlementIntent: 'signed-period-routing-intent',
      }),
    ]);
  });

  it('selects the August Volunteer Fund destination instead of a personal line', () => {
    const source = createGuideCommissionSource('volunteer_fund');
    const staff = volunteerCommissionStaff({
      range: { startDate: '2026-08-01', endDate: '2026-08-31' },
      totalPayout: 0,
      personalPayableTotal: 0,
      volunteerFundAllocationTotal: 100,
      closingBalance: 0,
      payouts: {
        currency: 'PLN',
        payableDue: 0,
        payablePaid: 0,
        payableOutstanding: 0,
        receivableDue: 0,
        receivableCollected: 0,
        receivableOutstanding: 0,
      },
      settlementSources: [source],
    });

    expect(buildDefaultPaymentLines(staff, new Map(), '', new Map())).toEqual([]);
    expect(buildDefaultFundAllocationLines(staff)).toEqual([
      expect.objectContaining({
        sourceKey: 'guide_commission',
        amount: 100,
        fundId: 1,
        settlementIntent: 'signed-period-routing-intent',
      }),
    ]);
  });

  it('keeps effective-dated staff-type segments separate in a mixed month', () => {
    const personalSource: PaySettlementSource = {
      ...createGuideCommissionSource('staff_vendor'),
      label: 'Guide commission',
      amount: 60,
      outstandingAmount: 60,
      segmentKey: 'seg_long_term',
      earningStart: '2026-08-01',
      earningEnd: '2026-08-15',
      staffTypePeriodId: 81,
      staffType: 'long_term',
      settlementIntent: 'signed-personal-segment',
    };
    const fundSource: PaySettlementSource = {
      ...createGuideCommissionSource('volunteer_fund'),
      label: 'Guide commission',
      amount: 40,
      outstandingAmount: 40,
      segmentKey: 'seg_volunteer',
      earningStart: '2026-08-16',
      earningEnd: '2026-08-31',
      staffTypePeriodId: 82,
      staffType: 'volunteer',
      settlementIntent: 'signed-fund-segment',
    };
    const staff = volunteerCommissionStaff({
      range: { startDate: '2026-08-01', endDate: '2026-08-31' },
      totalPayout: 60,
      personalPayableTotal: 60,
      volunteerFundAllocationTotal: 40,
      closingBalance: 60,
      payouts: {
        currency: 'PLN',
        payableDue: 60,
        payablePaid: 0,
        payableOutstanding: 60,
        receivableDue: 0,
        receivableCollected: 0,
        receivableOutstanding: 0,
      },
      settlementSources: [personalSource, fundSource],
    });

    expect(buildDefaultPaymentLines(staff, new Map(), '', new Map())).toEqual([
      expect.objectContaining({
        label: 'Guide commission (Aug 1–Aug 15)',
        amount: 60,
        settlementIntent: 'signed-personal-segment',
      }),
    ]);
    expect(buildDefaultFundAllocationLines(staff)).toEqual([
      expect.objectContaining({
        label: 'Guide commission (Aug 16–Aug 31)',
        amount: 40,
        settlementIntent: 'signed-fund-segment',
      }),
    ]);
  });
});
