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

export type PayTaskAttributionMethod =
  | 'salary_recipient'
  | 'shift_assignment'
  | 'shift_instance'
  | 'ambiguous';

export type PayAssistantManagerSalaryTakeoverSplit = {
  shiftTakerUserId: number;
  shiftTakerName: string;
  taskOwnerUserId: number;
  taskOwnerName: string;
  shiftTakerPercent: number;
  taskOwnerPercent: number;
  fullDayBaseAmount: number;
  fullDayPayableAmount: number;
  shiftTakerBaseAmount: number;
  shiftTakerPayableAmount: number;
  taskOwnerBaseAmount: number;
  taskOwnerPayableAmount: number;
};

export type PayAssistantManagerSalaryTakeoverAllocationRole =
  | 'shift_taker'
  | 'task_owner';

export type PayTaskCompletionDailyBreakdownRow = {
  date: string;
  baseAmount: number;
  taskOwnerUserId?: number | null;
  taskOwnerName?: string | null;
  attributionMethod?: PayTaskAttributionMethod | null;
  shiftInstanceIds?: number[];
  attributionWarning?: string | null;
  totalTasks?: number;
  completedTasks?: number;
  waivedTasks?: number;
  incompleteTasks?: number;
  completedPercent: number;
  missingPercent: number;
  deductionAmount: number;
  payableAmount: number;
  takeoverAllocationRole?: PayAssistantManagerSalaryTakeoverAllocationRole;
  takeoverSplit?: PayAssistantManagerSalaryTakeoverSplit;
};

export type PayComponentSummary = {
  componentId: number;
  name: string;
  category: string;
  calculationMethod: string;
  amount: number;
  baseDaysCount?: number;
  baseDays?: string[];
  taskCompletionDailyBreakdown?: PayTaskCompletionDailyBreakdownRow[];
};

export type PaySettlementDestination = 'staff_vendor' | 'volunteer_fund' | 'excluded';

export type PaySettlementSource = {
  sourceKey: string;
  label: string;
  componentId: number | null;
  /** Stable identity for an effective-dated staff-type earning segment. */
  segmentKey?: string | null;
  earningStart?: string | null;
  earningEnd?: string | null;
  staffTypePeriodId?: number | string | null;
  staffType?: string | null;
  legacyExtrapolation?: boolean;
  /** Exact source records, such as unpaid affiliate booking IDs, covered by the segment. */
  referenceIds?: number[];
  category: string;
  amount: number;
  destination: PaySettlementDestination;
  fundId: number | null;
  fundName: string | null;
  ruleId: number;
  settledAmount: number;
  allocatedAmount: number;
  outstandingAmount: number;
  overallocatedAmount: number;
  currency: string;
  allocatedFundIds: number[];
  routeChanged: boolean;
  settlementIntent: string | null;
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

export type PayPayoutReceiptStatus = 'pending' | 'completed' | 'cancelled';

export type PayRecordedEntryReceipt = {
  id: number;
  status: PayPayoutReceiptStatus;
  payoutBatchKey: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  hasPhoto: boolean;
  hasSignature: boolean;
};

export type PayPayoutReceiptTotal = {
  amount: number;
  amountMinor: number;
  currency: string;
};

export type PayPayoutReceiptDetailItem = {
  id: number;
  collectionLogId: number;
  financeTransactionId: number | null;
  label: string;
  amount: number;
  amountMinor: number;
  currency: string;
};

export type PayPayoutReceiptDetail = {
  id: number;
  status: PayPayoutReceiptStatus;
  staffUserId: number;
  staffName: string;
  payoutBatchKey: string | null;
  rangeStart: string;
  rangeEnd: string;
  paidDate: string;
  paidByName: string;
  acceptanceText: string;
  acceptanceVersion: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  totals: PayPayoutReceiptTotal[];
  items: PayPayoutReceiptDetailItem[];
  hasPhoto: boolean;
  hasSignature: boolean;
};

export type PayPayoutReceiptHistoryEntry = {
  id: number;
  status: PayPayoutReceiptStatus;
  staffUserId: number;
  staffName: string;
  payoutBatchKey: string | null;
  rangeStart: string;
  rangeEnd: string;
  paidDate: string;
  paidByName: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  totals: PayPayoutReceiptTotal[];
  itemCount: number;
  hasPhoto: boolean;
  hasSignature: boolean;
  isCurrent: boolean;
};

export type PayPayoutReceiptHistoryResponse = {
  receipts: PayPayoutReceiptHistoryEntry[];
  hasMore: boolean;
};

export type PayRecordedEntry = {
  id: number;
  financeTransactionId: number | null;
  label: string;
  componentId: number | null;
  sourceKey?: string | null;
  amount: number;
  currency: string;
  date: string;
  note: string | null;
  createdAt: string;
  canDelete: boolean;
  receipt?: PayRecordedEntryReceipt | null;
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
  lastName?: string | null;
  fullName?: string | null;
  staffType?: string | null;
  totalCommission: number;
  totalPayout?: number;
  grossCompensationTotal?: number;
  personalPayableTotal?: number;
  volunteerFundAllocationTotal?: number;
  volunteerFundAllocatedTotal?: number;
  volunteerFundOutstandingTotal?: number;
  volunteerFundOverallocatedTotal?: number;
  excludedSettlementTotal?: number;
  settlementSources?: PaySettlementSource[];
  settlementReconciliationRequired?: boolean;
  settlementReconciliationMessage?: string | null;
  totalCustomers?: number;
  bucketTotals?: Record<string, number>;
  grossBucketTotals?: Record<string, number>;
  fundBucketTotals?: Record<string, number>;
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
