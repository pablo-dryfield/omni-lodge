export type PayBreakdown = {
  date: string;
  commission: number;
  customers: number;
  guidesCount: number;
  counterId?: number;
  productId?: number | null;
  productName?: string;
};

export type PayComponentSummary = {
  componentId: number;
  name: string;
  category: string;
  calculationMethod: string;
  amount: number;
  baseDaysCount?: number;
  baseDays?: string[];
};

export type LockedComponentRequirement = {
  type: 'review_target';
  minReviews: number;
  actualReviews: number;
  missingReviews?: number;
  totalEligibleReviews?: number;
};

export type LockedComponentSummary = {
  componentId: number;
  name: string;
  category: string;
  calculationMethod: string;
  amount: number;
  requirement: LockedComponentRequirement;
  bucketCategory?: string;
};

export type PlatformGuestTierBreakdown = {
  tierIndex: number;
  rate: number;
  units: number;
  amount: number;
  cumulativeGuests: number;
};

export type PayPayouts = {
  currency: string;
  payableDue: number;
  payablePaid: number;
  payableOutstanding: number;
  receivableDue: number;
  receivableCollected: number;
  receivableOutstanding: number;
};

export type Pay = {
  userId?: number;
  firstName: string;
  totalCommission: number;
  totalPayout?: number;
  totalCustomers?: number;
  bucketTotals?: Record<string, number>;
  componentTotals?: PayComponentSummary[];
  productTotals?: Array<{
    productId: number | null;
    productName: string;
    counterIds: number[];
    totalCustomers: number;
    totalCommission: number;
    componentTotals: Array<{ componentId: number; amount: number }>;
  }>;
  counterIncentiveMarkers?: Record<string, string[]>;
  counterIncentiveTotals?: Record<string, number>;
  reviewTotals?: {
    totalEligibleReviews: number;
    totalTrackedReviews?: number;
  };
  platformGuestTotals?: {
    totalGuests: number;
    totalBooked: number;
    totalAttended: number;
  };
  platformGuestBreakdowns?: Record<string, PlatformGuestTierBreakdown[]>;
  lockedComponents?: LockedComponentSummary[];
  breakdown: PayBreakdown[];
  staffProfileId?: number | null;
  financeVendorId?: number | null;
  financeClientId?: number | null;
  payouts?: PayPayouts;
  openingBalance?: number;
  closingBalance?: number;
  dueAmount?: number;
  paidAmount?: number;
  range?: {
    startDate: string;
    endDate: string;
  };
};
