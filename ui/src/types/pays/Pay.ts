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
};

export type LockedComponentRequirement = {
  type: 'review_target';
  minReviews: number;
  actualReviews: number;
};

export type LockedComponentSummary = {
  componentId: number;
  name: string;
  category: string;
  calculationMethod: string;
  amount: number;
  requirement: LockedComponentRequirement;
};

export type PlatformGuestTierBreakdown = {
  tierIndex: number;
  rate: number;
  units: number;
  amount: number;
  cumulativeGuests: number;
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
  };
  platformGuestTotals?: {
    totalGuests: number;
    totalBooked: number;
    totalAttended: number;
  };
  platformGuestBreakdowns?: Record<string, PlatformGuestTierBreakdown[]>;
  lockedComponents?: LockedComponentSummary[];
  breakdown: PayBreakdown[];
};
