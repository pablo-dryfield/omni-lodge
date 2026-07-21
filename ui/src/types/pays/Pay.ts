import type { FinanceTransactionStatus } from '../finance/Transaction';

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

export type LockedComponentRequirement =
  | {
      type: 'review_target';
      minReviews: number;
      actualReviews: number;
      missingReviews?: number;
      totalEligibleReviews?: number;
    }
  | {
      type: 'base_override';
      allowedUnits: number;
      workedUnits: number;
      extraUnits: number;
      extraAmount: number;
      extraDays?: string[];
    }
  | {
      type: 'performance_tier';
      progressRatio: number;
      progressPercent: number;
      multiplier: number;
      deductedAmount: number;
      matchedTierLabel?: string | null;
    };

export type PayReimbursementEntry = {
  transactionId: number;
  date: string;
  vendorName: string | null;
  description: string | null;
  amount: number;
  originalAmount: number;
  originalCurrency: string;
  status: FinanceTransactionStatus;
};

export type PayReimbursementSummary = {
  awaitingAmount: number;
  reimbursedAmount: number;
  entries: PayReimbursementEntry[];
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

export type PayOpeningBalanceLedgerEntry = {
  ledgerId: number;
  rangeStart: string;
  rangeEnd: string;
  currency: string;
  openingBalance: number;
  dueAmount: number;
  paidAmount: number;
  closingBalance: number;
  createdAt: string;
  updatedAt: string | null;
};

export type PayOpeningBalanceSource = PayOpeningBalanceLedgerEntry & {
  sourceTable: string;
  staffUserId: number;
  history: PayOpeningBalanceLedgerEntry[];
};

export type PayRecordedEntry = {
  id: number;
  financeTransactionId: number | null;
  label: string;
  componentId: number | null;
  amount: number;
  currency: string;
  date: string;
  note: string | null;
  createdAt: string;
  canDelete: boolean;
};

export type PayCounterIncentiveDetail = {
  letter: string;
  name: string;
  amount: number;
};

export type PayAffiliateSaleBooking = {
  id: number;
  platformBookingId: string;
  productName: string | null;
  guestName: string;
  sourceReceivedAt: string | null;
  experienceDate: string | null;
  partySizeTotal: number;
  baseAmount: number;
  currency: string | null;
  affiliateCommissionPerPerson: number | null;
  affiliateCommissionAmount: number;
  affiliateCommissionEligible: boolean;
  affiliateCommissionIneligibleReason: string | null;
  isCommissionPaid: boolean;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

export type PayAffiliateSalesSummary = {
  bookingCount: number;
  peopleCount: number;
  revenueTotal: number;
  commissionTotal: number;
  commissionPaidTotal: number;
  commissionOutstandingTotal: number;
  currency: string | null;
  bookings: PayAffiliateSaleBooking[];
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
  counterIncentiveDetails?: Record<string, PayCounterIncentiveDetail[]>;
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
  openingBalanceSource?: PayOpeningBalanceSource | null;
  closingBalance?: number;
  dueAmount?: number;
  paidAmount?: number;
  range?: {
    startDate: string;
    endDate: string;
  };
  rangeIsCanonical?: boolean;
  reimbursements?: PayReimbursementSummary;
  paidEntries?: PayRecordedEntry[];
  affiliateSales?: PayAffiliateSalesSummary;
};
