import crypto from "crypto";
import { Request, Response } from "express";
import {
  Association,
  ModelAttributeColumnOptions,
  Op,
  QueryTypes,
  col,
  fn,
  type ModelAttributeColumnReferencesOptions,
  type WhereOptions,
} from "sequelize";
import { Model, ModelCtor, Sequelize } from "sequelize-typescript";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import Counter, { type CounterStatus } from "../models/Counter.js";
import CounterChannelMetric from "../models/CounterChannelMetric.js";
import CounterProduct from "../models/CounterProduct.js";
import CounterUser from "../models/CounterUser.js";
import User from "../models/User.js";
import StaffProfile from "../models/StaffProfile.js";
import AffiliatePayoutLog from "../models/AffiliatePayoutLog.js";
import StaffPayoutCollectionLog from "../models/StaffPayoutCollectionLog.js";
import StaffPayoutLedger, {
  type StaffPayoutSettlementSnapshot,
  type StaffPayoutSettlementSnapshotV1,
} from "../models/StaffPayoutLedger.js";
import StaffPayoutReceipt from "../models/StaffPayoutReceipt.js";
import StaffPayoutReceiptItem from "../models/StaffPayoutReceiptItem.js";
import ShiftAssignment from "../models/ShiftAssignment.js";
import ShiftInstance from "../models/ShiftInstance.js";
import ShiftRole from "../models/ShiftRole.js";
import SwapRequest from "../models/SwapRequest.js";
import ReviewCounter from "../models/ReviewCounter.js";
import ReviewCounterEntry from "../models/ReviewCounterEntry.js";
import ReviewArchive from "../models/ReviewArchive.js";
import ReviewAssignment from "../models/ReviewAssignment.js";
import ReviewManualCredit from "../models/ReviewManualCredit.js";
import ReviewMonthLock from "../models/ReviewMonthLock.js";
import { reviewDateRangeInWarsaw, reviewPeriodStartInWarsaw } from "../utils/reviewCreditMonth.js";
import ReportTemplate, {
  ReportTemplateFieldSelection,
  ReportTemplateOptions,
  ReportTemplateDerivedField,
  ReportTemplateMetricSpotlight,
  ReportTemplateQueryGroup,
  PreviewOrderRule,
  PreviewGroupingRule,
  PreviewAggregationRule,
  PreviewHavingRule,
} from "../models/ReportTemplate.js";
import { AuthenticatedRequest } from "../types/AuthenticatedRequest";
import type { DerivedFieldExpressionAst } from "../types/DerivedFieldExpressionAst.js";
import sequelize from "../config/database.js";
import {
  computeQueryHash,
  getCachedQueryResult,
  storeQueryCacheEntry,
  enqueueQueryJob,
  getAsyncJobStatus,
  type QueryExecutionResult,
} from "../services/reporting/reportQueryService.js";
import { getConfigValue } from "../services/configService.js";
import { PreviewQueryError } from "../errors/PreviewQueryError.js";
import HttpError from "../errors/HttpError.js";
import { ensureReportingAccess } from "../utils/reportingAccess.js";
import { normalizeDerivedFieldExpressionAst } from "../utils/derivedFieldExpression.js";
import CompensationComponent, {
  type CompensationCalculationMethod,
  type CompensationComponentCategory,
} from "../models/CompensationComponent.js";
import CompensationComponentAssignment from "../models/CompensationComponentAssignment.js";
import ReviewCounterMonthlyApproval from "../models/ReviewCounterMonthlyApproval.js";
import AssistantManagerTaskLog, { type AssistantManagerTaskStatus } from "../models/AssistantManagerTaskLog.js";
import AssistantManagerTaskTemplate from "../models/AssistantManagerTaskTemplate.js";
import { fetchLeaderNightReportStats, type NightReportStatsMap } from "../services/nightReportMetricsService.js";
import Product from "../models/Product.js";
import Addon from "../models/Addon.js";
import FinanceTransaction, {
  type FinanceTransactionStatus,
} from "../finance/models/FinanceTransaction.js";
import FinanceVendor from "../finance/models/FinanceVendor.js";
import FinanceFile from "../finance/models/FinanceFile.js";
import VolunteerFund from "../finance/models/VolunteerFund.js";
import VolunteerFundEntry from "../finance/models/VolunteerFundEntry.js";
import { openFinanceFileStream } from "../finance/services/driveService.js";
import {
  getAffiliateOverview,
  type AffiliateBookingRow,
} from "../services/affiliateService.js";
import {
  applyAffiliateCommissionEarnings,
} from "../services/staffPayoutAffiliateAccountingService.js";
import {
  loadCanonicalStaffPayablePaidMinor,
  loadImmutableUncollectedAffiliatePaidMinor,
  reconcilePersistedStaffPayoutLedgers,
} from "../services/staffPayoutLedgerReconciliationService.js";
import { buildStaffPayoutStaffIdentity } from "../services/staffPayoutStaffIdentityService.js";
import {
  allocateAssistantManagerSalaryAcrossDays,
  calculateAssistantManagerSalaryTaskCompletion,
  mergeAssistantManagerSalaryDailyBreakdowns,
  partitionAssistantManagerSalaryDaysForTaskProration,
  type AssistantManagerSalaryDailyBase,
  type AssistantManagerSalaryDailyBreakdown,
  type AssistantManagerSalaryDailyTaskProgress,
  type AssistantManagerSalaryTakeoverSplitSettings,
} from "../services/assistantManagerSalaryTaskCompletionService.js";
import {
  resolveAssistantManagerSalaryTaskProgress,
  type AssistantManagerSalaryLinkedTaskSet,
  type AssistantManagerSalaryManagerShift,
  type AssistantManagerSalaryApprovedTakeover,
} from "../services/assistantManagerSalaryTaskAttributionService.js";
import { allocateAssistantManagerSalaryTakeoverDay } from "../services/assistantManagerSalaryTakeoverSplitService.js";
import {
  buildStaffPayoutReceiptCompactView,
  buildStaffPayoutReceiptTotals,
} from "../services/staffPayoutReceiptViewService.js";
import {
  isSensitiveReportModel,
  listSensitiveReportModelReferences,
} from "../services/reportModelAccessService.js";
import {
  canRefreshClosedSettlementSnapshot,
  loadCompensationSettlementRouter,
  type CompensationSettlementDestination,
} from "../services/compensationSettlementRoutingService.js";
import { signCompensationSettlementIntent } from "../services/compensationSettlementIntentService.js";
import {
  getShiftRoleMembersForRange,
  getStaffProfileTypePeriodsForRange,
  getStaffTypeMembersForRange,
  getUserTypeMembersForRange,
} from "../services/staffEligibilityHistoryService.js";
import {
  allocateCompensationAmountAcrossDates,
  allocateCompensationAmountByDateWeights,
  buildCompensationEligibilityDateIndex,
  enumerateInclusiveIsoDates,
  mergeCompensationEarningBreakdown,
  restrictCompensationEligibilityDateIndex,
  scaleCompensationEarningBreakdown,
  type CompensationEarningBreakdownEntry,
} from "../services/compensationEarningDateService.js";
import {
  allocateMinorAcrossDates,
  splitDatedEarningsAtCutoff,
  splitDatedEarningsByStaffType,
  splitDatedEarningsByStaffTypeAndRouting,
  type DatedMinorAmount,
  type StaffPayoutRoutingPartition,
  type StaffTypeEligibilityPeriod,
} from "../services/staffPayoutEarningSegmentationService.js";
import { isStaffPayoutPeriodClosedInWarsaw } from "../services/staffPayoutPeriodService.js";
import {
  buildStaffPayoutSettlementSnapshotV2,
  normalizeStaffPayoutSettlementSnapshot,
  sortStaffPayoutSettlementSnapshotSources,
  staffPayoutSettlementSnapshotsMatch,
} from "../services/staffPayoutSettlementSnapshotService.js";
import {
  buildLegacySettledPayoutSnapshotPresentation,
  resolveAuthoritativeLegacySettledPayoutSnapshot,
  type LegacySettledPayoutSnapshotPresentation,
} from "../services/legacySettledPayoutSnapshotService.js";
import { findRecoverableInterruptedPayoutBatches } from "../services/staffPayoutSettlementDeletionService.js";
import { isStaffPayoutReimbursementCollection } from "../services/staffPayoutCollectionClassificationService.js";

dayjs.extend(utc);
dayjs.extend(timezone);

type CommissionBreakdownEntry = {
  date: string;
  commission: number;
  customers: number;
  guidesCount: number;
  counterId: number;
  productId: number | null;
  productName: string;
};

type ReviewTotals = {
  totalEligibleReviews: number;
  totalTrackedReviews: number;
};

type PlatformGuestTotals = {
  totalGuests: number;
  totalBooked: number;
  totalAttended: number;
};

type PlatformGuestTierBreakdown = {
  tierIndex: number;
  rate: number;
  units: number;
  amount: number;
  cumulativeGuests: number;
};

type MonthlyBaseSettings =
  | {
      mode: "calendar_days";
      amountOverride?: number;
      monthlyCap?: number;
    }
  | {
      mode: "shift_quota";
      defaultShiftsPerMonth: number;
      shiftsFor28?: number;
      shiftsFor29?: number;
      shiftsFor30?: number;
      thirtyOneDayPattern?: number[];
      proRateByCompletion: boolean;
      unitAmountOverride?: number;
      countSource: "staff_assignments" | "counter_manager";
      monthlyCap?: number;
      taskCompletionProration?: TaskCompletionProrationSettings;
    };

type TaskCompletionProrationSettings = {
  enabled: boolean;
  effectiveStart: string | null;
  templateIds?: number[];
  treatWaivedAsComplete: boolean;
  treatPendingAsComplete: boolean;
  takeoverSplit?: AssistantManagerSalaryTakeoverSplitSettings;
};

type LockedComponentRequirement =
  | {
      type: "review_target";
      minReviews: number;
      actualReviews: number;
      missingReviews?: number;
      totalEligibleReviews?: number;
    }
  | {
      type: "base_override";
      allowedUnits: number;
      workedUnits: number;
      extraUnits: number;
      extraAmount: number;
      extraDays?: string[];
    }
  | {
      type: "performance_tier";
      progressRatio: number;
      progressPercent: number;
      multiplier: number;
      deductedAmount: number;
      matchedTierLabel?: string | null;
    };

type LockedComponentEntry = {
  componentId: number;
  name: string;
  category: CompensationComponentCategory;
  calculationMethod: CompensationCalculationMethod;
  amount: number;
  requirement: LockedComponentRequirement;
  bucketCategory?: string;
};

type ProductComponentTotal = {
  componentId: number;
  amount: number;
};

type ProductPayoutSummary = {
  productId: number | null;
  productName: string;
  counterIds: number[];
  totalCustomers: number;
  totalCommission: number;
  componentTotals: ProductComponentTotal[];
};

type ComponentTotalEntry = {
  componentId: number;
  name: string;
  category: CompensationComponentCategory;
  calculationMethod: CompensationCalculationMethod;
  amount: number;
  baseDaysCount?: number;
  baseDays?: string[];
  earningBreakdown?: CompensationEarningBreakdownEntry[];
  taskCompletionDailyBreakdown?: AssistantManagerSalaryDailyBreakdown[];
};

type ComponentComputationResult = {
  amount: number;
  baseDaysCount?: number;
  baseDays?: string[];
  earningBreakdown?: CompensationEarningBreakdownEntry[];
  taskCompletionDailyBreakdown?: AssistantManagerSalaryDailyBreakdown[];
};

type StaffPayoutReconciliation = {
  currency: string;
  payableDue: number;
  payablePaid: number;
  payableOutstanding: number;
  receivableDue: number;
  receivableCollected: number;
  receivableOutstanding: number;
};

type ReimbursementEntry = {
  transactionId: number;
  date: string;
  vendorName: string | null;
  description: string | null;
  amount: number;
  originalAmount: number;
  originalCurrency: string;
  status: FinanceTransactionStatus;
};

type ReimbursementSummary = {
  awaitingAmount: number;
  reimbursedAmount: number;
  entries: ReimbursementEntry[];
};

type PaidPayoutEntry = {
  id: number;
  financeTransactionId: number | null;
  label: string;
  componentId: number | null;
  sourceKey: string | null;
  segmentKey: string | null;
  amount: number;
  currency: string;
  date: string;
  note: string | null;
  createdAt: string;
  canDelete: boolean;
  receipt: {
    id: number;
    status: "pending" | "completed" | "cancelled";
    payoutBatchKey: string | null;
    confirmedAt: string | null;
    cancelledAt: string | null;
    hasPhoto: boolean;
    hasSignature: boolean;
  } | null;
};

type SettlementSourceSummary = {
  sourceKey: string;
  label: string;
  componentId: number | null;
  segmentKey: string | null;
  earningStart: string | null;
  earningEnd: string | null;
  staffTypePeriodId: number | null;
  staffType: string | null;
  legacyExtrapolation: boolean;
  referenceIds: number[];
  category: string;
  amount: number;
  destination: CompensationSettlementDestination;
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

type StaffAffiliateSaleBooking = {
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
  affiliatePayoutLogId: number | null;
  isCommissionPaid: boolean;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

type StaffAffiliateSalesSummary = {
  bookingCount: number;
  peopleCount: number;
  revenueTotal: number;
  commissionTotal: number;
  commissionPaidTotal: number;
  commissionOutstandingTotal: number;
  currency: string | null;
  bookings: StaffAffiliateSaleBooking[];
};

type CounterIncentiveDetail = {
  letter: string;
  name: string;
  amount: number;
};

type OpeningBalanceLedgerEntry = {
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

type OpeningBalanceSource = OpeningBalanceLedgerEntry & {
  sourceTable: "staff_payout_ledgers";
  staffUserId: number;
  history: OpeningBalanceLedgerEntry[];
};

type CommissionSummary = {
  userId: number;
  firstName: string;
  lastName: string;
  fullName: string;
  totalCommission: number;
  totalCustomers: number;
  breakdown: CommissionBreakdownEntry[];
  componentTotals: ComponentTotalEntry[];
  bucketTotals: Record<string, number>;
  grossBucketTotals: Record<string, number>;
  fundBucketTotals: Record<string, number>;
  totalPayout: number;
  grossCompensationTotal: number;
  personalPayableTotal: number;
  volunteerFundAllocationTotal: number;
  volunteerFundAllocatedTotal: number;
  volunteerFundOutstandingTotal: number;
  volunteerFundOverallocatedTotal: number;
  excludedSettlementTotal: number;
  settlementSources: SettlementSourceSummary[];
  staffType: string | null;
  productTotals: ProductPayoutSummary[];
  counterIncentiveMarkers: Record<string, string[]>;
  counterIncentiveTotals: Record<string, number>;
  counterIncentiveDetails: Record<string, CounterIncentiveDetail[]>;
  reviewTotals: ReviewTotals;
  reviewPaymentOverride: boolean;
  incentiveOverride: boolean;
  baseOverrideApproved: boolean;
  platformGuestTotals: PlatformGuestTotals;
  platformGuestBreakdowns: Record<number, PlatformGuestTierBreakdown[]>;
  lockedComponents: LockedComponentEntry[];
  monthlyShiftCounts: Record<string, number>;
  managerMonthlyShiftCounts: Record<string, number>;
  shiftDayIndex: Map<string, string[]>;
  managerShiftDayIndex: Map<string, Set<string>>;
  staffProfileId: number | null;
  financeVendorId: number | null;
  financeClientId: number | null;
  payouts: StaffPayoutReconciliation;
  openingBalance: number;
  closingBalance: number;
  openingBalanceSource: OpeningBalanceSource | null;
  reimbursements: ReimbursementSummary;
  paidEntries: PaidPayoutEntry[];
  affiliateSales: StaffAffiliateSalesSummary;
};

type GuideDailyBreakdown = {
  userId: number;
  firstName: string;
  commission: number;
  customers: number;
};

type DailyAggregate = {
  dateKey: string;
  counterId: number;
  productId: number | null;
  productName: string;
  totalCustomers: number;
  guides: Map<number, GuideDailyBreakdown>;
};

type CounterMeta = {
  dateKey: string;
  isNewSystem: boolean;
  productId: number | null;
  productName: string;
  managerId: number | null;
  status: CounterStatus | null;
};

type ProductBucket = {
  productId: number | null;
  productName: string;
  counterIds: Set<number>;
  totalCustomers: number;
  totalCommission: number;
  componentTotals: Map<number, number>;
};

type ProductBucketLookup = Map<number, Map<string, ProductBucket>>;

type GuideCommissionRateLookup = {
  defaultRate: number;
  ratesByProduct: Map<string, number>;
};

type StaffCollectionAggregate = {
  staffProfileId: number;
  currencyCode: string | null;
  direction: "receivable" | "payable";
  totalAmountMinor: number | string | null;
};

const FULL_ACCESS_ROLE_SLUGS = new Set([
  "admin",
  "owner",
  "manager",
  "assistant-manager",
  "assistant_manager",
  "assistantmanager",
]);

const MANAGER_ROLE_SLUGS = new Set(["manager", "assistant-manager", "assistant_manager", "assistantmanager"]);

const normalizeUserId = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }
  return null;
};

const normalizeRoleSlug = (role: unknown): string | null => {
  if (!role || typeof role !== "string") {
    return null;
  }
  return role.trim().toLowerCase().replace(/[\s-]+/g, "_");
};

const resolveCounterManagerId = (
  meta: CounterMeta | undefined,
  staff: CounterUser[] | undefined,
): number | null => {
  const metaManager = normalizeUserId(meta?.managerId ?? null);
  if (metaManager) {
    return metaManager;
  }
  if (!staff || staff.length === 0) {
    return null;
  }
  for (const member of staff) {
    const role = normalizeRoleSlug(member.role);
    if (role && MANAGER_ROLE_SLUGS.has(role)) {
      const fallbackId = normalizeUserId(member.userId);
      if (fallbackId) {
        return fallbackId;
      }
    }
  }
  return null;
};

// Default commission is zero unless overridden via compensation components.
const COMMISSION_RATE_PER_ATTENDEE = 0;
const NEW_COUNTER_SYSTEM_START = dayjs("2025-10-01");
const MANUAL_ATTENDANCE_START = dayjs("2025-10-01");
// From Oct 1 through Feb 25, attended counter metrics are the manually counted
// attendance (booked minus inferred no-shows). Booking-level check-ins take over here.
const PAYOUT_ATTENDANCE_START = dayjs("2026-02-26");
const REVIEW_ARCHIVE_PAYOUT_START = dayjs("2026-07-01");
const STAFF_TYPE_SEGMENTED_PAYOUT_START = "2026-08-01";
const REVIEW_MINIMUM_THRESHOLD = 15;
const isExcludedNoShowAddonName = (value?: string | null): boolean => {
  const normalized = value?.toLowerCase() ?? "";
  return normalized.includes("photo") || normalized.includes("t-shirt") || normalized.includes("tshirt");
};
const resolvePayoutCurrency = (): string =>
  String(getConfigValue('FINANCE_BASE_CURRENCY') ?? 'PLN')
    .trim()
    .toUpperCase();
const resolveStaffLedgerStartDate = (): dayjs.Dayjs =>
  dayjs(
    (getConfigValue('STAFF_LEDGER_START_DATE') as string | null) ??
      (getConfigValue('PAYOUT_LEDGER_START') as string | null) ??
      '2025-10-01',
  );
const roundCurrencyValue = (value: number): number => Math.round(value * 100) / 100;
const convertMinorUnitsToMajor = (value: unknown): number =>
  roundCurrencyValue(Number(value ?? 0) / 100);
const convertMajorUnitsToMinor = (value: number): number => Math.round(value * 100);

const buildStaffPayoutSettlementSnapshot = (
  sources: SettlementSourceSummary[],
  rangeStart: string,
  rangeEnd: string,
): StaffPayoutSettlementSnapshot => {
  const isSegmented = sources.length > 0 && sources.every((source) => (
    source.segmentKey !== null
    && source.earningStart !== null
    && source.earningEnd !== null
    && source.staffTypePeriodId !== null
    && source.staffType !== null
  ));
  if (isSegmented) {
    return buildStaffPayoutSettlementSnapshotV2(
      sources.map((source) => ({
        sourceKey: source.sourceKey,
        componentId: source.componentId,
        category: source.category,
        grossAmountMinor: convertMajorUnitsToMinor(source.amount),
        destination: source.destination,
        fundId: source.fundId,
        ruleId: source.ruleId,
        currency: source.currency,
        segmentKey: source.segmentKey as string,
        earningStart: source.earningStart as string,
        earningEnd: source.earningEnd as string,
        staffTypePeriodId: source.staffTypePeriodId as number,
        staffType: source.staffType as string,
        legacyExtrapolation: source.legacyExtrapolation,
      })),
      { rangeStart, rangeEnd },
    );
  }

  return {
    version: 1,
    sources: sortStaffPayoutSettlementSnapshotSources(sources.map((source) => ({
      sourceKey: source.sourceKey,
      componentId: source.componentId,
      category: source.category,
      grossAmountMinor: convertMajorUnitsToMinor(source.amount),
      destination: source.destination,
      fundId: source.fundId,
      ruleId: source.ruleId,
      currency: source.currency,
    }))),
  } satisfies StaffPayoutSettlementSnapshotV1;
};

type DialectQuoter = {
  quoteTable: (value: string | { tableName: string; schema?: string }) => string;
  quoteIdentifier: (value: string) => string;
};

const getDialectQuoter = (): DialectQuoter => {
  const queryInterface = sequelize.getQueryInterface() as unknown as {
    quoteTable?: DialectQuoter["quoteTable"];
    quoteIdentifier?: DialectQuoter["quoteIdentifier"];
    queryGenerator?: DialectQuoter;
  };

  if (
    queryInterface &&
    typeof queryInterface.quoteTable === "function" &&
    typeof queryInterface.quoteIdentifier === "function"
  ) {
    return {
      quoteTable: queryInterface.quoteTable.bind(queryInterface),
      quoteIdentifier: queryInterface.quoteIdentifier.bind(queryInterface),
    };
  }

  const generator = queryInterface?.queryGenerator;
  if (
    generator &&
    typeof generator.quoteTable === "function" &&
    typeof generator.quoteIdentifier === "function"
  ) {
    return {
      quoteTable: generator.quoteTable.bind(generator),
      quoteIdentifier: generator.quoteIdentifier.bind(generator),
    };
  }

  return {
    quoteTable: (value) => {
      if (typeof value === "string") {
        return `"${value.replace(/"/g, '""')}"`;
      }
      const table = `"${value.tableName.replace(/"/g, '""')}"`;
      const schema = value.schema ? `"${value.schema.replace(/"/g, '""')}"` : null;
      return schema ? `${schema}.${table}` : table;
    },
    quoteIdentifier: (value) => `"${value.replace(/"/g, '""')}"`,
  };
};

type ReportModelFieldDescriptor = {
  fieldName: string;
  columnName: string;
  type: string;
  allowNull: boolean;
  primaryKey: boolean;
  defaultValue: string | number | boolean | null;
  unique: boolean;
  references?: {
    model: string | null;
    key?: string | null;
  };
};

type ReportModelAssociationDescriptor = {
  name: string | null;
  targetModel: string;
  associationType: string;
  foreignKey?: string;
  sourceKey?: string;
  through?: string | null;
  as?: string;
};

type ReportModelDescriptor = {
  id: string;
  name: string;
  tableName: string;
  schema?: string;
  description: string;
  connection: string;
  recordCount: string;
  lastSynced: string;
  primaryKeys: string[];
  primaryKey: string | null;
  fields: ReportModelFieldDescriptor[];
  associations: ReportModelAssociationDescriptor[];
};

type DerivedFieldQueryPayload = {
  id: string;
  alias?: string;
  expressionAst: DerivedFieldExpressionAst;
  referencedModels?: string[];
  joinDependencies?: Array<[string, string]>;
  modelGraphSignature?: string | null;
  compiledSqlHash?: string | null;
};

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "between"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "is_null"
  | "is_not_null"
  | "is_true"
  | "is_false";

export type PreviewFilterClausePayload = {
  leftModelId: string;
  leftFieldId: string;
  operator: FilterOperator;
  rightType: "value" | "field";
  rightModelId?: string;
  rightFieldId?: string;
  value?: string | number | boolean | null | Array<string | number | boolean | null>;
  valueKind?: "string" | "number" | "date" | "boolean";
  range?: {
    from?: string | number | boolean | null;
    to?: string | number | boolean | null;
  };
};

export type PreviewFilterGroupPayload = {
  type: "group";
  logic: "and" | "or" | "not";
  children: PreviewFilterNode[];
};

export type PreviewFilterNode = string | PreviewFilterClausePayload | PreviewFilterGroupPayload;

export type PreviewOrderClausePayload = {
  source: "model" | "derived";
  modelId?: string | null;
  fieldId: string;
  direction?: "asc" | "desc";
};

const DERIVED_FIELD_SENTINEL = "__derived__";

const formatDerivedFieldLabel = (field: DerivedFieldQueryPayload, index: number): string => {
  if (field.alias && field.alias.trim().length > 0) {
    return field.alias.trim();
  }
  if (field.id && field.id.trim().length > 0) {
    return field.id.trim();
  }
  return `derived_${index + 1}`;
};

type DerivedFieldValidationIssue = {
  fieldId: string;
  reason: "graph_mismatch" | "missing_model" | "unjoined_model";
  models?: string[];
};

const raiseDerivedFieldStaleError = (issues: DerivedFieldValidationIssue[]): never => {
  throw new PreviewQueryError("Resolve derived field issues before running this query.", 400, {
    code: "DERIVED_FIELD_STALE",
    issues,
  });
};

const toDerivedFieldIssueFieldId = (field: DerivedFieldQueryPayload, index: number): string => {
  if (typeof field.id === "string" && field.id.trim().length > 0) {
    return field.id.trim();
  }
  return formatDerivedFieldLabel(field, index);
};

const validateDerivedFieldGraph = (
  derivedFields: DerivedFieldQueryPayload[],
  models: string[],
  joins: ReportPreviewRequest["joins"] | QueryConfig["joins"] | undefined,
  aliasMap: Map<string, string>,
) => {
  if (!derivedFields || derivedFields.length === 0) {
    return;
  }
  const currentGraphSignature = computeModelGraphSignature(models, joins ?? []);
  const issues: DerivedFieldValidationIssue[] = [];
  derivedFields.forEach((field, index) => {
    const fieldId = toDerivedFieldIssueFieldId(field, index);
    if (
      field.modelGraphSignature &&
      currentGraphSignature &&
      field.modelGraphSignature !== currentGraphSignature
    ) {
      issues.push({
        fieldId,
        reason: "graph_mismatch",
      });
    }
    const referencedModels = Array.isArray(field.referencedModels) ? field.referencedModels : [];
    const missingModels = referencedModels.filter((modelId) => !aliasMap.has(modelId));
    if (missingModels.length > 0) {
      issues.push({
        fieldId,
        reason: "missing_model",
        models: missingModels,
      });
    }
  });
  if (issues.length > 0) {
    raiseDerivedFieldStaleError(issues);
  }
};

const validateDerivedFieldJoinCoverage = (
  derivedFields: DerivedFieldQueryPayload[],
  joinedModels: Set<string>,
) => {
  if (!derivedFields || derivedFields.length === 0) {
    return;
  }
  const issues: DerivedFieldValidationIssue[] = [];
  derivedFields.forEach((field, index) => {
    const referencedModels = Array.isArray(field.referencedModels) ? field.referencedModels : [];
    const unmetModels = referencedModels.filter((modelId) => !joinedModels.has(modelId));
    if (unmetModels.length > 0) {
      issues.push({
        fieldId: toDerivedFieldIssueFieldId(field, index),
        reason: "unjoined_model",
        models: unmetModels,
      });
    }
  });
  if (issues.length > 0) {
    raiseDerivedFieldStaleError(issues);
  }
};

export type ReportPreviewRequest = {
  models: string[];
  fields: Array<{ modelId: string; fieldIds: string[] }>;
  joins?: Array<{
    id: string;
    leftModel: string;
    leftField: string;
    rightModel: string;
    rightField: string;
    joinType?: "inner" | "left" | "right" | "full";
    description?: string;
  }>;
  filters?: PreviewFilterNode[];
  orderBy?: PreviewOrderClausePayload[];
  limit?: number;
  derivedFields?: DerivedFieldQueryPayload[];
  grouping?: PreviewGroupingClausePayload[];
  aggregations?: PreviewAggregationClausePayload[];
  having?: PreviewHavingClausePayload[];
};

type ReportPreviewResponse = {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  sql: string;
};

export type QueryConfigFieldRef = {
  modelId: string;
  fieldId: string;
};

export type QueryConfigSelect = QueryConfigFieldRef & {
  alias?: string;
};

export type QueryConfigMetric = QueryConfigFieldRef & {
  alias?: string;
  aggregation: "sum" | "avg" | "min" | "max" | "count" | "count_distinct";
};

export type QueryConfigDimension = QueryConfigFieldRef & {
  alias?: string;
  bucket?: "hour" | "day" | "week" | "month" | "quarter" | "year";
};

export type QueryConfigFilterValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>
  | { from?: string | number; to?: string | number };

export type QueryConfigFilter = QueryConfigFieldRef & {
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "between";
  value: QueryConfigFilterValue;
};

export type QueryConfigOrderBy = {
  alias: string;
  direction?: "asc" | "desc";
};

export type QueryConfigOptions = {
  allowAsync?: boolean;
  cacheTtlSeconds?: number;
  forceAsync?: boolean;
  templateId?: string | null;
};

export type QueryConfigUnion = {
  all?: boolean;
  queries: QueryConfig[];
  orderBy?: QueryConfigOrderBy[];
  limit?: number;
  offset?: number;
};

export type QueryConfig = {
  models?: string[];
  select?: QueryConfigSelect[];
  metrics?: QueryConfigMetric[];
  dimensions?: QueryConfigDimension[];
  filters?: QueryConfigFilter[];
  orderBy?: QueryConfigOrderBy[];
  derivedFields?: DerivedFieldQueryPayload[];
  joins?: ReportPreviewRequest["joins"];
  limit?: number;
  options?: QueryConfigOptions;
  union?: QueryConfigUnion;
};

type PreviewGroupingClausePayload = {
  id: string;
  source: "model" | "derived";
  modelId?: string | null;
  fieldId: string;
  bucket?: "hour" | "day" | "week" | "month" | "quarter" | "year" | null;
};

type PreviewAggregationClausePayload = {
  id: string;
  source: "model" | "derived";
  modelId?: string | null;
  fieldId: string;
  aggregation: "sum" | "avg" | "min" | "max" | "count" | "count_distinct";
  alias?: string | null;
};

type PreviewHavingClausePayload = {
  id: string;
  aggregationId: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
  value?: string | number | boolean | null;
  valueKind?: "string" | "number" | "date" | "boolean";
};

type TemplateOptionsInput = {
  autoDistribution?: unknown;
  notifyTeam?: unknown;
  columnOrder?: unknown;
  columnAliases?: unknown;
  previewOrder?: unknown;
  previewGrouping?: unknown;
  previewAggregations?: unknown;
  previewHaving?: unknown;
  autoRunOnOpen?: unknown;
  previewSql?: unknown;
  visualSql?: unknown;
};

type TemplatePayloadInput = {
  name?: unknown;
  category?: unknown;
  description?: unknown;
  schedule?: unknown;
  models?: unknown;
  fields?: unknown;
  joins?: unknown;
  visuals?: unknown;
  metrics?: unknown;
  filters?: unknown;
  options?: TemplateOptionsInput | null;
  queryGroups?: unknown;
  columnOrder?: unknown;
  columnAliases?: unknown;
  previewOrder?: unknown;
  previewGrouping?: unknown;
  previewAggregations?: unknown;
  previewHaving?: unknown;
  queryConfig?: unknown;
  derivedFields?: unknown;
  metricsSpotlight?: unknown;
};

type SerializedReportTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  schedule: string;
  models: string[];
  fields: ReportTemplateFieldSelection[];
  joins: unknown[];
  visuals: unknown[];
  metrics: string[];
  filters: unknown[];
  options: ReportTemplateOptions;
  queryConfig: unknown | null;
  derivedFields: ReportTemplateDerivedField[];
  metricsSpotlight: ReportTemplateMetricSpotlight[];
  queryGroups: ReportTemplateQueryGroup[];
  columnOrder: string[];
  columnAliases: Record<string, string>;
  previewOrder: PreviewOrderRule[];
  previewGrouping: PreviewGroupingRule[];
  previewAggregations: PreviewAggregationRule[];
  previewHaving: PreviewHavingRule[];
  autoRunOnOpen: boolean;
  owner: {
    id: number | null;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_TEMPLATE_OPTIONS: ReportTemplateOptions = {
  autoDistribution: true,
  notifyTeam: true,
  columnOrder: [],
  columnAliases: {},
  previewOrder: [],
  previewGrouping: [],
  previewAggregations: [],
  previewHaving: [],
  autoRunOnOpen: false,
  previewSql: null,
  visualSql: null,
};

const modelDescriptorCache = new Map<string, ReportModelDescriptor>();

const toStringOr = (value: unknown, fallback: string): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  return fallback;
};

const toNullableString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const toTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry): entry is string => entry.length > 0)
    : [];

const toFieldSelections = (value: unknown): ReportTemplateFieldSelection[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as Record<string, unknown>;
      const modelId = typeof candidate.modelId === "string" ? candidate.modelId : null;
      const rawFieldIds = candidate.fieldIds;
      const fieldIds = Array.isArray(rawFieldIds)
        ? rawFieldIds.filter((fieldId): fieldId is string => typeof fieldId === "string")
        : [];

      if (!modelId) {
        return null;
      }

      return { modelId, fieldIds };
    })
    .filter((value): value is ReportTemplateFieldSelection => Boolean(value));
};

const toUnknownArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toColumnOrder = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  value.forEach((entry) => {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed.length > 0 && !seen.has(trimmed)) {
        seen.add(trimmed);
        ordered.push(trimmed);
      }
    }
  });
  return ordered;
};

const toColumnAliasMap = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const aliases: Record<string, string> = {};
  entries.forEach(([key, rawValue]) => {
    if (typeof key === "string" && typeof rawValue === "string") {
      const trimmedKey = key.trim();
      const trimmedValue = rawValue.trim();
      if (trimmedKey.length > 0 && trimmedValue.length > 0) {
        aliases[trimmedKey] = trimmedValue;
      }
    }
  });
  return aliases;
};

const toPreviewOrderRules = (value: unknown): PreviewOrderRule[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const rules: PreviewOrderRule[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const id =
      typeof record.id === "string" && record.id.trim().length > 0
        ? record.id.trim()
        : `order-${index}`;
    const direction = record.direction === "desc" ? "desc" : "asc";
    const source = record.source === "derived" ? "derived" : "model";
    const fieldId = typeof record.fieldId === "string" ? record.fieldId.trim() : "";
    if (!fieldId) {
      return;
    }
    const modelId =
      source === "derived"
        ? undefined
        : typeof record.modelId === "string" && record.modelId.trim().length > 0
        ? record.modelId.trim()
        : undefined;
    rules.push({
      id,
      source,
      modelId,
      fieldId,
      direction,
    });
  });
  return rules;
};

const PREVIEW_BUCKETS = new Set(["hour", "day", "week", "month", "quarter", "year"]);

const toPreviewGroupingRules = (value: unknown): PreviewGroupingRule[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const rules: PreviewGroupingRule[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const id =
      typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : `group-${index}`;
    const source = record.source === "derived" ? "derived" : "model";
    const fieldId = typeof record.fieldId === "string" ? record.fieldId.trim() : "";
    if (!fieldId) {
      return;
    }
    const modelId =
      source === "derived"
        ? undefined
        : typeof record.modelId === "string" && record.modelId.trim().length > 0
        ? record.modelId.trim()
        : undefined;
    let bucket: PreviewGroupingRule["bucket"] | null = null;
    if (typeof record.bucket === "string") {
      const normalizedBucket = record.bucket.toLowerCase();
      if (PREVIEW_BUCKETS.has(normalizedBucket)) {
        bucket = normalizedBucket as PreviewGroupingRule["bucket"];
      }
    }
    rules.push({
      id,
      source,
      modelId,
      fieldId,
      bucket,
    });
  });
  return rules;
};

const toPreviewAggregationRules = (value: unknown): PreviewAggregationRule[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const aggregations: PreviewAggregationRule[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const fieldId = typeof record.fieldId === "string" ? record.fieldId.trim() : "";
    if (!fieldId) {
      return;
    }
    const aggregation =
      record.aggregation === "avg" ||
      record.aggregation === "min" ||
      record.aggregation === "max" ||
      record.aggregation === "count" ||
      record.aggregation === "count_distinct"
        ? record.aggregation
        : "sum";
    const source = record.source === "derived" ? "derived" : "model";
    const modelId =
      source === "derived"
        ? null
        : typeof record.modelId === "string" && record.modelId.trim().length > 0
        ? record.modelId.trim()
        : null;
    const alias =
      typeof record.alias === "string" && record.alias.trim().length > 0 ? record.alias.trim() : null;
    const id =
      typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : `agg-${index}`;
    aggregations.push({
      id,
      source,
      modelId,
      fieldId,
      aggregation,
      alias,
    });
  });
  return aggregations;
};

const toPreviewHavingRules = (value: unknown): PreviewHavingRule[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const clauses: PreviewHavingRule[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const aggregationId =
      typeof record.aggregationId === "string" && record.aggregationId.trim().length > 0
        ? record.aggregationId.trim()
        : "";
    if (!aggregationId) {
      return;
    }
    const operator =
      record.operator === "neq" ||
      record.operator === "gt" ||
      record.operator === "gte" ||
      record.operator === "lt" ||
      record.operator === "lte"
        ? record.operator
        : "eq";
    const id =
      typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : `having-${index}`;
    const valueKind =
      record.valueKind === "string" ||
      record.valueKind === "number" ||
      record.valueKind === "date" ||
      record.valueKind === "boolean"
        ? record.valueKind
        : "number";
    clauses.push({
      id,
      aggregationId,
      operator,
      value: "value" in record ? (record.value as string | number | boolean | null | undefined) : undefined,
      valueKind,
    });
  });
  return clauses;
};

const toReferencedFieldMap = (value: unknown): Record<string, string[]> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const references: Record<string, string[]> = {};
  entries.forEach(([modelId, fields]) => {
    if (typeof modelId !== "string" || !Array.isArray(fields)) {
      return;
    }
    const trimmedModel = modelId.trim();
    if (!trimmedModel) {
      return;
    }
    const uniqueFields = Array.from(
      new Set(
        fields
          .map((field) => (typeof field === "string" ? field.trim() : ""))
          .filter((field) => field.length > 0),
      ),
    );
    if (uniqueFields.length > 0) {
      references[trimmedModel] = uniqueFields;
    }
  });
  return references;
};

const toJoinDependencyPairs = (value: unknown): Array<[string, string]> => {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const dependencies: Array<[string, string]> = [];
  value.forEach((entry) => {
    let left: string | null = null;
    let right: string | null = null;
    if (Array.isArray(entry) && entry.length === 2) {
      left = typeof entry[0] === "string" ? entry[0].trim() : null;
      right = typeof entry[1] === "string" ? entry[1].trim() : null;
    } else if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      left = typeof record.left === "string" ? record.left.trim() : null;
      right = typeof record.right === "string" ? record.right.trim() : null;
    }
    if (!left || !right || left === right) {
      return;
    }
    const ordered: [string, string] = left < right ? [left, right] : [right, left];
    const signature = `${ordered[0]}|${ordered[1]}`;
    if (!seen.has(signature)) {
      seen.add(signature);
      dependencies.push(ordered);
    }
  });
  dependencies.sort(([aLeft, aRight], [bLeft, bRight]) => {
    if (aLeft === bLeft) {
      return aRight.localeCompare(bRight);
    }
    return aLeft.localeCompare(bLeft);
  });
  return dependencies;
};

type JoinSignatureDescriptor = {
  leftModel: string;
  leftField: string;
  rightModel: string;
  rightField: string;
  joinType: string;
  id?: string;
};

const normalizeModelsForSignature = (models: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  models.forEach((modelId) => {
    const trimmed = toTrimmedString(modelId);
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  normalized.sort();
  return normalized;
};

const normalizeJoinsForSignature = (joins: unknown[]): JoinSignatureDescriptor[] => {
  if (!Array.isArray(joins)) {
    return [];
  }
  const allowedJoinTypes = new Set(["inner", "left", "right", "full"]);
  const normalized: JoinSignatureDescriptor[] = [];
  joins.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const candidate = entry as Record<string, unknown>;
    const leftModel = toTrimmedString(candidate.leftModel);
    const rightModel = toTrimmedString(candidate.rightModel);
    const leftField = toTrimmedString(candidate.leftField);
    const rightField = toTrimmedString(candidate.rightField);
    if (!leftModel || !rightModel || !leftField || !rightField) {
      return;
    }
    const joinTypeRaw = toTrimmedString(candidate.joinType).toLowerCase();
    const joinType = allowedJoinTypes.has(joinTypeRaw) ? joinTypeRaw : "left";
    const descriptor: JoinSignatureDescriptor = {
      leftModel,
      leftField,
      rightModel,
      rightField,
      joinType,
    };
    const id = toTrimmedString(candidate.id);
    if (id) {
      descriptor.id = id;
    }
    normalized.push(descriptor);
  });
  normalized.sort((a, b) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left.localeCompare(right);
  });
  return normalized;
};

const computeModelGraphSignature = (models: string[], joins: unknown[]): string | null => {
  const normalizedModels = normalizeModelsForSignature(models);
  if (normalizedModels.length === 0) {
    return null;
  }
  const normalizedJoins = normalizeJoinsForSignature(joins);
  const canonical = JSON.stringify({
    models: normalizedModels,
    joins: normalizedJoins,
  });
  return crypto.createHash("sha1").update(canonical).digest("hex");
};

const toDerivedFieldArray = (value: unknown): ReportTemplateDerivedField[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry, index): ReportTemplateDerivedField | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as Record<string, unknown>;
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      const expression = typeof candidate.expression === "string" ? candidate.expression.trim() : "";
      if (!name || !expression) {
        return null;
      }
      const astResult = normalizeDerivedFieldExpressionAst(candidate.expressionAst);
      const expressionAst = astResult?.ast ?? null;
      const referencedModels = astResult?.referencedModels ?? [];
      const referencedFields =
        astResult?.referencedFields ?? toReferencedFieldMap(candidate.referencedFields);
      const joinDependencies =
        astResult?.joinDependencies ?? toJoinDependencyPairs(candidate.joinDependencies);
      const compiledSqlHash = astResult?.compiledSqlHash ?? toTrimmedString(candidate.compiledSqlHash);
      const id =
        typeof candidate.id === "string" && candidate.id.trim().length > 0
          ? candidate.id.trim()
          : `derived-${index}`;
      const kind =
        candidate.kind === "aggregate" || candidate.kind === "row"
          ? (candidate.kind as "aggregate" | "row")
          : "row";
      const metadata =
        candidate.metadata && typeof candidate.metadata === "object" && !Array.isArray(candidate.metadata)
          ? (candidate.metadata as Record<string, unknown>)
          : {};
      const modelGraphSignature =
        typeof candidate.modelGraphSignature === "string" && candidate.modelGraphSignature.trim().length > 0
          ? candidate.modelGraphSignature.trim()
          : null;
      const status =
        candidate.status === "stale" ? "stale" : candidate.status === "active" ? "active" : undefined;
      return {
        id,
        name,
        expression,
        kind,
        scope: "template",
        metadata,
        expressionAst,
        referencedModels,
        referencedFields,
        joinDependencies,
        modelGraphSignature,
        compiledSqlHash: compiledSqlHash || null,
        ...(status ? { status } : {}),
      };
    })
    .filter((entry): entry is ReportTemplateDerivedField => Boolean(entry));
};

const toMetricsSpotlightArray = (value: unknown): ReportTemplateMetricSpotlight[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowedComparisons = new Set(["previous", "wow", "mom", "yoy", "custom"]);
  const allowedFormats = new Set(["number", "currency", "percentage"]);
  const allowedAggregations = new Set(["sum", "avg", "min", "max", "count", "count_distinct"]);
  return value
    .map((entry): ReportTemplateMetricSpotlight | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as Record<string, unknown>;
      const metric = typeof candidate.metric === "string" ? candidate.metric.trim() : "";
      if (!metric) {
        return null;
      }
      const label =
        typeof candidate.label === "string" && candidate.label.trim().length > 0
          ? candidate.label.trim()
          : metric;
      const targetValue = candidate.target;
      let target: number | undefined;
      if (typeof targetValue === "number" && Number.isFinite(targetValue)) {
        target = targetValue;
      } else if (typeof targetValue === "string" && targetValue.trim().length > 0) {
        const parsed = Number(targetValue);
        if (Number.isFinite(parsed)) {
          target = parsed;
        }
      }
      const comparisonRaw =
        typeof candidate.comparison === "string" ? candidate.comparison.trim().toLowerCase() : undefined;
      const comparison =
        comparisonRaw && allowedComparisons.has(comparisonRaw)
          ? (comparisonRaw as "previous" | "wow" | "mom" | "yoy" | "custom")
          : undefined;
      const formatRaw =
        typeof candidate.format === "string" ? candidate.format.trim().toLowerCase() : undefined;
      const format =
        formatRaw && allowedFormats.has(formatRaw)
          ? (formatRaw as "number" | "currency" | "percentage")
          : undefined;
      const currencyRaw =
        typeof candidate.currency === "string" ? candidate.currency.trim().toUpperCase() : undefined;
      const currency =
        currencyRaw && currencyRaw.length === 3 ? currencyRaw : undefined;
      const aggregationRaw =
        typeof candidate.aggregation === "string" ? candidate.aggregation.trim().toLowerCase() : undefined;
      const aggregation =
        aggregationRaw && allowedAggregations.has(aggregationRaw)
          ? (aggregationRaw as "sum" | "avg" | "min" | "max" | "count" | "count_distinct")
          : undefined;
      let comparisonRange: { from: string; to: string } | undefined;
      if (comparison === "custom" && candidate.comparisonRange && typeof candidate.comparisonRange === "object") {
        const rangeCandidate = candidate.comparisonRange as Record<string, unknown>;
        const from = typeof rangeCandidate.from === "string" ? rangeCandidate.from.trim() : "";
        const to = typeof rangeCandidate.to === "string" ? rangeCandidate.to.trim() : "";
        if (from && to) {
          comparisonRange = { from, to };
        }
      }
      return {
        metric,
        label,
        ...(aggregation ? { aggregation } : {}),
        target,
        comparison,
        ...(comparisonRange ? { comparisonRange } : {}),
        format,
        currency,
      };
    })
    .filter((entry): entry is ReportTemplateMetricSpotlight => Boolean(entry));
};

const normalizeQueryGroups = (value: unknown): ReportTemplateQueryGroup[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as Record<string, unknown>;
      const id =
        typeof candidate.id === "string" && candidate.id.trim().length > 0
          ? candidate.id.trim()
          : `group-${index + 1}`;
      const name =
        typeof candidate.name === "string" && candidate.name.trim().length > 0
          ? candidate.name.trim()
          : `Group ${index + 1}`;
      const models = toStringArray(candidate.models);
      const fields = toFieldSelections(candidate.fields);
      const joins = toUnknownArray(candidate.joins);
      const filters = toUnknownArray(candidate.filters);
      const filterGroups = toUnknownArray(candidate.filterGroups);
      const rawFilterSql = toUnknownArray(candidate.rawFilterSql);
      const columnAliases = toColumnAliasMap(candidate.columnAliases);
      const columnOrder = toColumnOrder(candidate.columnOrder);
      return {
        id,
        name,
        models,
        fields,
        joins,
        filters,
        ...(Object.keys(columnAliases).length > 0 ? { columnAliases } : {}),
        ...(columnOrder.length > 0 ? { columnOrder } : {}),
        ...(filterGroups.length > 0 ? { filterGroups } : {}),
        ...(rawFilterSql.length > 0 ? { rawFilterSql } : {}),
      } satisfies ReportTemplateQueryGroup;
    })
    .filter((entry): entry is ReportTemplateQueryGroup => Boolean(entry));
};

const normalizeTemplatePayload = (input: TemplatePayloadInput) => {
  const optionsCandidate =
    input.options && typeof input.options === "object" && !Array.isArray(input.options)
      ? (input.options as TemplateOptionsInput)
      : undefined;
  const columnOrder = toColumnOrder(
    input.columnOrder !== undefined ? input.columnOrder : optionsCandidate?.columnOrder,
  );
  const columnAliases = toColumnAliasMap(
    input.columnAliases !== undefined ? input.columnAliases : optionsCandidate?.columnAliases,
  );
  const previewOrderInput =
    input.previewOrder !== undefined ? input.previewOrder : optionsCandidate?.previewOrder;
  const previewOrder = toPreviewOrderRules(previewOrderInput);
  const previewGroupingInput =
    input.previewGrouping !== undefined ? input.previewGrouping : optionsCandidate?.previewGrouping;
  const previewGrouping = toPreviewGroupingRules(previewGroupingInput);
  const previewAggregationsInput =
    input.previewAggregations !== undefined
      ? input.previewAggregations
      : optionsCandidate?.previewAggregations;
  const previewAggregations = toPreviewAggregationRules(previewAggregationsInput);
  const previewHavingInput =
    input.previewHaving !== undefined ? input.previewHaving : optionsCandidate?.previewHaving;
  const previewHaving = toPreviewHavingRules(previewHavingInput);
  const autoRunOnOpen =
    typeof optionsCandidate?.autoRunOnOpen === "boolean"
      ? optionsCandidate.autoRunOnOpen
      : DEFAULT_TEMPLATE_OPTIONS.autoRunOnOpen;
  const previewSql = toNullableString(optionsCandidate?.previewSql);
  const visualSql = toNullableString(optionsCandidate?.visualSql);

  const options: ReportTemplateOptions = {
    autoDistribution:
      typeof optionsCandidate?.autoDistribution === "boolean"
        ? optionsCandidate.autoDistribution
        : DEFAULT_TEMPLATE_OPTIONS.autoDistribution,
    notifyTeam:
      typeof optionsCandidate?.notifyTeam === "boolean"
        ? optionsCandidate.notifyTeam
        : DEFAULT_TEMPLATE_OPTIONS.notifyTeam,
    columnOrder,
    columnAliases,
    previewOrder,
    previewGrouping,
    previewAggregations,
    previewHaving,
    autoRunOnOpen,
    previewSql,
    visualSql,
  };

  const models = toStringArray(input.models);
  const joins = toUnknownArray(input.joins);
  const queryGroups = normalizeQueryGroups(input.queryGroups);
  const derivedFieldsRaw = toDerivedFieldArray(input.derivedFields);
  const modelGraphSignature = computeModelGraphSignature(models, joins);
  const derivedFields =
    derivedFieldsRaw.length === 0
      ? derivedFieldsRaw
      : derivedFieldsRaw.map((field) => ({
          ...field,
          modelGraphSignature: modelGraphSignature ?? field.modelGraphSignature ?? null,
        }));

  return {
    name: toStringOr(input.name, ""),
    category: toNullableString(input.category),
    description: toNullableString(input.description),
    schedule: toStringOr(input.schedule, "Manual"),
    models,
    fields: toFieldSelections(input.fields),
    joins,
    visuals: toUnknownArray(input.visuals),
    metrics: toStringArray(input.metrics),
    filters: toUnknownArray(input.filters),
    queryConfig: input.queryConfig && typeof input.queryConfig === "object" ? input.queryConfig : null,
    derivedFields,
    metricsSpotlight: toMetricsSpotlightArray(input.metricsSpotlight),
    previewOrder,
    previewGrouping,
    previewAggregations,
    previewHaving,
    options,
    queryGroups,
  };
};

const serializeReportTemplate = (
  template: ReportTemplate & { owner?: User | null },
): SerializedReportTemplate => {
  const owner = template.owner ?? null;
  const ownerName = owner ? `${owner.firstName} ${owner.lastName}`.trim() : "Shared";
  const rawOptions = template.options ?? DEFAULT_TEMPLATE_OPTIONS;
  const templatePreviewOrder =
    Array.isArray(template.previewOrder) && template.previewOrder.length > 0
      ? toPreviewOrderRules(template.previewOrder)
      : [];
  const mergedOptions: ReportTemplateOptions = {
    autoDistribution:
      typeof rawOptions.autoDistribution === "boolean"
        ? rawOptions.autoDistribution
        : DEFAULT_TEMPLATE_OPTIONS.autoDistribution,
    notifyTeam:
      typeof rawOptions.notifyTeam === "boolean"
        ? rawOptions.notifyTeam
        : DEFAULT_TEMPLATE_OPTIONS.notifyTeam,
    columnOrder: toColumnOrder(
      Array.isArray(rawOptions.columnOrder) ? rawOptions.columnOrder : DEFAULT_TEMPLATE_OPTIONS.columnOrder,
    ),
    columnAliases: toColumnAliasMap(
      rawOptions.columnAliases !== undefined ? rawOptions.columnAliases : DEFAULT_TEMPLATE_OPTIONS.columnAliases,
    ),
    previewOrder:
      templatePreviewOrder.length > 0
        ? templatePreviewOrder
        : Array.isArray(rawOptions.previewOrder) && rawOptions.previewOrder.length > 0
        ? toPreviewOrderRules(rawOptions.previewOrder)
        : [],
    previewGrouping: Array.isArray(rawOptions.previewGrouping)
      ? toPreviewGroupingRules(rawOptions.previewGrouping)
      : [],
    previewAggregations: Array.isArray(rawOptions.previewAggregations)
      ? toPreviewAggregationRules(rawOptions.previewAggregations)
      : [],
    previewHaving: Array.isArray(rawOptions.previewHaving)
      ? toPreviewHavingRules(rawOptions.previewHaving)
      : [],
    autoRunOnOpen:
      typeof rawOptions.autoRunOnOpen === "boolean"
        ? rawOptions.autoRunOnOpen
        : DEFAULT_TEMPLATE_OPTIONS.autoRunOnOpen,
    previewSql: typeof rawOptions.previewSql === "string" ? rawOptions.previewSql : null,
    visualSql: typeof rawOptions.visualSql === "string" ? rawOptions.visualSql : null,
  };

  const serializedPreviewOrder =
    templatePreviewOrder.length > 0 ? templatePreviewOrder : mergedOptions.previewOrder;
  const serializedPreviewGrouping = mergedOptions.previewGrouping;
  const serializedPreviewAggregations = mergedOptions.previewAggregations;
  const serializedPreviewHaving = mergedOptions.previewHaving;

    return {
      id: template.id,
      name: template.name,
      category: template.category ?? "Custom",
    description: template.description ?? "",
    schedule: template.schedule ?? "Manual",
    models: Array.isArray(template.models) ? template.models : [],
    fields: Array.isArray(template.fields) ? template.fields : [],
    joins: Array.isArray(template.joins) ? template.joins : [],
    visuals: Array.isArray(template.visuals) ? template.visuals : [],
    metrics: Array.isArray(template.metrics) ? template.metrics : [],
      filters: Array.isArray(template.filters) ? template.filters : [],
      options: mergedOptions,
      queryConfig: template.queryConfig ?? null,
      queryGroups: Array.isArray(template.queryGroups) ? template.queryGroups : [],
      derivedFields: Array.isArray(template.derivedFields)
        ? template.derivedFields.map((field, index) => {
          const metadata =
            field.metadata && typeof field.metadata === "object" && !Array.isArray(field.metadata)
              ? field.metadata
              : undefined;
          return {
            ...field,
            id: field.id ?? `derived-${index}`,
            expressionAst: field.expressionAst ?? null,
            referencedModels: Array.isArray(field.referencedModels) ? field.referencedModels : [],
            referencedFields: toReferencedFieldMap(field.referencedFields),
            joinDependencies: toJoinDependencyPairs(field.joinDependencies),
            modelGraphSignature:
              typeof field.modelGraphSignature === "string" && field.modelGraphSignature.length > 0
                ? field.modelGraphSignature
                : null,
            compiledSqlHash:
              typeof field.compiledSqlHash === "string" && field.compiledSqlHash.length > 0
                ? field.compiledSqlHash
                : null,
            status: field.status === "stale" ? "stale" : undefined,
            ...(metadata ? { metadata } : {}),
          };
        })
      : [],
      metricsSpotlight: Array.isArray(template.metricsSpotlight) ? template.metricsSpotlight : [],
      columnOrder: [...mergedOptions.columnOrder],
    columnAliases: { ...mergedOptions.columnAliases },
    previewOrder: serializedPreviewOrder,
    previewGrouping: serializedPreviewGrouping,
    previewAggregations: serializedPreviewAggregations,
    previewHaving: serializedPreviewHaving,
    autoRunOnOpen: mergedOptions.autoRunOnOpen,
    owner: {
      id: template.userId ?? null,
      name: ownerName.length > 0 ? ownerName : "Shared",
    },
    createdAt: template.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: template.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
};

export const getCommissionByDateRange = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, scope } = req.query;
    const authRequest = req as AuthenticatedRequest;
    const requesterId = authRequest.authContext?.id ?? null;
    const requesterRoleSlug = authRequest.authContext?.roleSlug ?? null;
    const enforcedAccessScope = authRequest.staffPayoutAccessScope;
    const requesterHasFullAccess = enforcedAccessScope
      ? enforcedAccessScope === "all"
      : requesterRoleSlug
        ? FULL_ACCESS_ROLE_SLUGS.has(requesterRoleSlug)
        : false;
    const forceSelfScope = scope === "self";
    const shouldLimitToSelf = forceSelfScope
      || enforcedAccessScope === "self"
      || !requesterHasFullAccess;

    if (!startDate || !endDate) {
      res.status(400).json([{ message: "Start date and end date are required" }]);
      return;
    }

    const start = dayjs(startDate as string).startOf("day");
    const end = dayjs(endDate as string).endOf("day");

    const counters = await Counter.findAll({
      attributes: ["id", "date", "productId", "userId", "status"],
      where: {
        date: {
          [Op.between]: [start.toDate(), end.toDate()],
        },
      },
      order: [["date", "ASC"]],
    });

    const counterMetaById = new Map<number, CounterMeta>();
    const legacyCounterIds: number[] = [];
    const newSystemCounterIds: number[] = [];
    const productIdsToResolve = new Set<number>();

    counters.forEach((counter) => {
      const rawDate = counter.getDataValue("date");
      if (!rawDate) {
        return;
      }

      const counterDate = dayjs(rawDate);
      const dateKey = counterDate.format("YYYY-MM-DD");
      const isNewSystem = !counterDate.isBefore(NEW_COUNTER_SYSTEM_START, "day");
      const productId = isNewSystem ? counter.getDataValue("productId") ?? null : null;
      if (isNewSystem && productId !== null) {
        productIdsToResolve.add(productId);
      }

      const managerId = normalizeUserId(counter.getDataValue("userId"));
      const status = counter.getDataValue("status") ?? null;

      counterMetaById.set(counter.id, {
        dateKey,
        isNewSystem,
        productId,
        productName: "",
        managerId,
        status,
      });

      if (isNewSystem) {
        newSystemCounterIds.push(counter.id);
      } else {
        legacyCounterIds.push(counter.id);
      }
    });

    const legacyTotalsByCounter = new Map<number, number>();
    if (legacyCounterIds.length > 0) {
      const legacyRows = await CounterProduct.findAll({
        attributes: [
          "counterId",
          [Sequelize.fn("SUM", Sequelize.col("quantity")), "totalQuantity"],
        ],
        where: {
          counterId: {
            [Op.in]: legacyCounterIds,
          },
        },
        group: ["counterId"],
      });

      legacyRows.forEach((row) => {
        const counterId = row.getDataValue("counterId");
        const totalQuantity = Number(row.get("totalQuantity") ?? 0);
        legacyTotalsByCounter.set(counterId, totalQuantity);
      });
    }

    const newSystemBookedTotalsByCounter = new Map<number, number>();
    const newSystemAttendedTotalsByCounter = new Map<number, number>();
    const newSystemAttendedPeopleCountAddonTotalsByCounter = new Map<number, number>();
    if (newSystemCounterIds.length > 0) {
      const peopleCountAddons = await Addon.findAll({
        attributes: ["id", "name"],
        where: {
          name: {
            [Op.iLike]: "%cocktail%",
          },
        },
      });
      const peopleCountAddonIds = peopleCountAddons.map((addon) => addon.id);
      const metricRows = await CounterChannelMetric.findAll({
        attributes: [
          "counterId",
          "tallyType",
          "kind",
          [Sequelize.fn("SUM", Sequelize.col("qty")), "totalQty"],
        ],
        where: {
          counterId: {
            [Op.in]: newSystemCounterIds,
          },
          [Op.or]: [
            { kind: "people" },
            ...(peopleCountAddonIds.length > 0
              ? [{ kind: "addon", addonId: { [Op.in]: peopleCountAddonIds } }]
              : []),
          ],
          tallyType: { [Op.in]: ["booked", "attended"] },
        },
        group: ["counterId", "tallyType", "kind"],
      });

      metricRows.forEach((row) => {
        const counterId = row.getDataValue("counterId");
        const tallyType = String(row.getDataValue("tallyType") ?? "");
        const kind = String(row.getDataValue("kind") ?? "");
        const totalQty = Number(row.get("totalQty") ?? 0);
        if (tallyType === "booked") {
          newSystemBookedTotalsByCounter.set(
            counterId,
            (newSystemBookedTotalsByCounter.get(counterId) ?? 0) + totalQty,
          );
        }
        if (tallyType === "attended" && kind === "people") {
          newSystemAttendedTotalsByCounter.set(counterId, totalQty);
        }
        if (tallyType === "attended" && kind === "addon") {
          newSystemAttendedPeopleCountAddonTotalsByCounter.set(counterId, totalQty);
        }
      });
    }

    const productNameById = new Map<number, string>();
    if (productIdsToResolve.size > 0) {
      const products = await Product.findAll({
        where: {
          id: {
            [Op.in]: Array.from(productIdsToResolve),
          },
        },
        attributes: ["id", "name"],
      });
      products.forEach((product) => {
        productNameById.set(product.id, product.name ?? `Product ${product.id}`);
      });
    }

    counterMetaById.forEach((meta) => {
      if (meta.productId !== null) {
        meta.productName = productNameById.get(meta.productId) ?? `Product ${meta.productId}`;
      } else if (meta.isNewSystem) {
        meta.productName = "Unassigned Product";
      } else {
        meta.productName = "Legacy Counter";
      }
    });

    const counterIds = counters.map((counter) => counter.id);
    const staffRecords = await CounterUser.findAll({
      attributes: ["counterId", "userId", "role"],
      include: [
        {
          model: User,
          as: "counterUser",
          attributes: ["firstName", "lastName"],
        },
      ],
      where: {
        counterId: {
          [Op.in]: counterIds,
        },
      },
    });

    const isCanonicalRange =
      start.isSame(start.startOf("month"), "day") &&
      end.isSame(start.endOf("month"), "day") &&
      start.isSame(end, "month") &&
      start.year() === end.year();
    const isLedgerEligible = isCanonicalRange && !start.isBefore(resolveStaffLedgerStartDate(), "day");

    const commissionDataByUser = new Map<number, CommissionSummary>();
    const productBucketsByUser: ProductBucketLookup = new Map();
    const staffByCounter = new Map<number, CounterUser[]>();

    staffRecords.forEach((staff) => {
      const counterId = staff.counterId;
      if (!staffByCounter.has(counterId)) {
        staffByCounter.set(counterId, []);
      }
      staffByCounter.get(counterId)!.push(staff);

      const userId = normalizeUserId(staff.userId);
      if (!userId) {
        return;
      }
      if (!commissionDataByUser.has(userId)) {
        commissionDataByUser.set(
          userId,
          createEmptySummary(
            userId,
            staff.counterUser?.firstName,
            staff.counterUser?.lastName,
          ),
        );
      }
    });

    const managerUserIds = new Set<number>();
    counters.forEach((counter) => {
      const meta = counterMetaById.get(counter.id);
      const staffForCounter = staffByCounter.get(counter.id);
      const managerId = resolveCounterManagerId(meta, staffForCounter);
      if (managerId) {
        managerUserIds.add(managerId);
      }
    });
    if (managerUserIds.size > 0) {
      await ensureSummariesForUserIds(managerUserIds, commissionDataByUser);
    }

    const configuredComponents = await CompensationComponent.findAll({
      include: [
        {
          model: CompensationComponentAssignment,
          as: "assignments",
          where: { isActive: true },
          required: false,
        },
      ],
      order: [
        ["category", "ASC"],
        ["name", "ASC"],
      ],
    });

    const typedConfiguredComponents = configuredComponents as Array<
      CompensationComponent & { assignments?: CompensationComponentAssignment[] }
    >;
    const typedComponents = typedConfiguredComponents.filter((component) => component.isActive);
    const legacySettledPayoutComponentDefinitions = typedConfiguredComponents.map((component) => ({
      id: component.id,
      name: component.name,
      category: component.category,
      calculationMethod: component.calculationMethod,
      isActive: component.isActive,
    }));
    const guideCommissionRates = buildGuideCommissionRateLookup(typedComponents);

    const platformGuestTotals = await computePlatformGuestTotals(counterIds);
    commissionDataByUser.forEach((summary) => {
      summary.platformGuestTotals = platformGuestTotals;
    });

    const dailyAggregates = new Map<number, DailyAggregate>();

    const getOrCreateDailyAggregate = (counterId: number, meta: CounterMeta): DailyAggregate => {
      let aggregate = dailyAggregates.get(counterId);
      if (!aggregate) {
        aggregate = {
          dateKey: meta.dateKey,
          counterId,
          productId: meta.productId,
          productName: meta.productName,
          totalCustomers: 0,
          guides: new Map<number, GuideDailyBreakdown>(),
        };
        dailyAggregates.set(counterId, aggregate);
      }
      return aggregate;
    };

    counters.forEach((counter) => {
      const meta = counterMetaById.get(counter.id);
      if (!meta) {
        return;
      }
      const staffForCounter = staffByCounter.get(counter.id) ?? [];

      const counterDate = dayjs(meta.dateKey);
      const usesManualAttendance =
        !counterDate.isBefore(MANUAL_ATTENDANCE_START, "day") && counterDate.isBefore(PAYOUT_ATTENDANCE_START, "day");
      const usesBookingCheckIns = !counterDate.isBefore(PAYOUT_ATTENDANCE_START, "day");
      const useAttendance = meta.isNewSystem && (usesManualAttendance || usesBookingCheckIns);
      const customers = meta.isNewSystem
        ? useAttendance
          ? (newSystemAttendedTotalsByCounter.get(counter.id) ?? 0) +
            (usesBookingCheckIns
              ? (newSystemAttendedPeopleCountAddonTotalsByCounter.get(counter.id) ?? 0)
              : 0)
          : newSystemBookedTotalsByCounter.get(counter.id) ?? 0
        : legacyTotalsByCounter.get(counter.id) ?? 0;

      const managerId = resolveCounterManagerId(meta, staffForCounter);
      if (managerId && meta.status === "final") {
        const managerSummary = commissionDataByUser.get(managerId);
        if (managerSummary) {
          incrementMonthlyManagerShiftCount(managerSummary, meta.dateKey);
        }
      }

      const aggregate = getOrCreateDailyAggregate(counter.id, meta);
      aggregate.totalCustomers += customers;

      if (staffForCounter.length === 0 || customers === 0) {
        return;
      }

      const commissionRate = resolveGuideCommissionRate(guideCommissionRates, meta.productId);
      const totalCommissionForCounter = customers * commissionRate;
      const commissionPerStaff = totalCommissionForCounter / staffForCounter.length;

      staffForCounter.forEach((staff) => {
        const userId = normalizeUserId(staff.userId);
        if (!userId) {
          return;
        }
        const commissionSummary = commissionDataByUser.get(userId);
        if (!commissionSummary) {
          return;
        }
        incrementMonthlyShiftCount(commissionSummary, meta.dateKey);

        commissionSummary.totalCommission += commissionPerStaff;
        commissionSummary.totalCustomers += customers;

        const productBucket = getOrCreateProductBucket(
          productBucketsByUser,
          userId,
          meta.productId,
          meta.productName,
        );
        productBucket.counterIds.add(counter.id);
        productBucket.totalCustomers += customers;
        productBucket.totalCommission += commissionPerStaff;

        const guideBreakdown = aggregate.guides.get(userId) ?? {
          userId,
          firstName: commissionSummary.firstName,
          commission: 0,
          customers: 0,
        };

        guideBreakdown.commission += commissionPerStaff;
        guideBreakdown.customers += customers;

        aggregate.guides.set(userId, guideBreakdown);
      });
    });

    aggregateDailyBreakdownByUser(dailyAggregates, commissionDataByUser);

    const reviewStatsByUser = await fetchReviewStats(start, end);
    if (reviewStatsByUser.size > 0) {
      await ensureSummariesForUserIds(reviewStatsByUser.keys(), commissionDataByUser);
      reviewStatsByUser.forEach((stats, userId) => {
        const summary = commissionDataByUser.get(userId);
        if (summary) {
          summary.reviewTotals = stats;
          summary.platformGuestTotals = platformGuestTotals;
        }
      });
    }

    const summaryUserIds = Array.from(commissionDataByUser.keys());
    const approvalPeriodStarts: string[] = [];
    if (summaryUserIds.length > 0) {
      let cursor = start.startOf("month");
      const lastPeriod = end.startOf("month");
      while (cursor.isBefore(lastPeriod, "month") || cursor.isSame(lastPeriod, "month")) {
        approvalPeriodStarts.push(cursor.format("YYYY-MM-DD"));
        cursor = cursor.add(1, "month");
      }
    }

    const paymentOverrideUsers = new Set<number>();
    const incentiveOverrideUsers = new Set<number>();
    const baseOverrideUsers = new Set<number>();
    if (summaryUserIds.length > 0 && approvalPeriodStarts.length > 0) {
      const approvals = await ReviewCounterMonthlyApproval.findAll({
        where: {
          userId: { [Op.in]: summaryUserIds },
          periodStart: { [Op.in]: approvalPeriodStarts },
        },
        attributes: ["userId", "paymentApproved", "incentiveApproved", "baseOverrideApproved"],
      });
      approvals.forEach((approval) => {
        if (approval.userId != null) {
          if (approval.paymentApproved) {
            paymentOverrideUsers.add(approval.userId);
          }
          if (approval.incentiveApproved) {
            incentiveOverrideUsers.add(approval.userId);
          }
          if (approval.baseOverrideApproved) {
            baseOverrideUsers.add(approval.userId);
          }
        }
      });
    }

    commissionDataByUser.forEach((summary, userId) => {
      summary.reviewPaymentOverride = paymentOverrideUsers.has(userId);
      summary.incentiveOverride = incentiveOverrideUsers.has(userId);
      summary.baseOverrideApproved = baseOverrideUsers.has(userId);
    });

    const {
      targets: assignmentTargets,
      eligibilityDates: assignmentEligibilityDates,
    } = await resolveAssignmentTargets(commissionDataByUser, typedComponents, start, end);
    commissionDataByUser.forEach((summary) => {
      summary.platformGuestTotals = platformGuestTotals;
    });
    const requiresTaskScores = typedComponents.some(
      (component) =>
        (component.assignments?.some(
          (assignment) => {
            const monthlyBase = resolveMonthlyBaseSettings(component, assignment);
            const dailyProration = monthlyBase?.mode === "shift_quota"
              ? monthlyBase.taskCompletionProration
              : null;
            const dailyProrationApplies = Boolean(
              component.calculationMethod === "per_unit"
              && dailyProration?.enabled
              && (
                !dailyProration.effectiveStart
                || !dayjs(dailyProration.effectiveStart).isAfter(end, "day")
              ),
            );
            return assignment.isActive && (
              component.calculationMethod === "task_score"
              || dailyProrationApplies
              || hasPerformanceTierConfig(component.config ?? {})
              || hasPerformanceTierConfig(assignment.config ?? {})
            );
          },
        ) ??
          false),
    );
    const taskScoreContext: TaskScoreContext = requiresTaskScores
      ? await buildTaskScoreContext(start, end)
      : createEmptyTaskScoreContext();
    const requiresNightReportMetrics = typedComponents.some(
      (component) =>
        component.calculationMethod === "night_report" &&
        (component.assignments?.some((assignment) => assignment.isActive) ?? false),
    );
    const nightReportStats: NightReportStatsMap = requiresNightReportMetrics
      ? await fetchLeaderNightReportStats(start, end)
      : new Map();

    applyCompensationComponents(
      commissionDataByUser,
      typedComponents,
      start,
      end,
      assignmentTargets,
      assignmentEligibilityDates,
      taskScoreContext,
      nightReportStats,
      productBucketsByUser,
    );
    await applyAssistantManagerSalaryTakeoverSplits(commissionDataByUser);

    let affiliateSalesByUserId = new Map<number, StaffAffiliateSalesSummary>();
    try {
      const affiliateOverview = await getAffiliateOverview({
        startDate: start.format("YYYY-MM-DD"),
        endDate: end.format("YYYY-MM-DD"),
        currentUserId: 0,
        currentRoleSlug: "manager",
        includeStaffAffiliateAssignments: true,
      });
      affiliateSalesByUserId = buildStaffAffiliateSalesByUser(affiliateOverview.bookings);
      await ensureSummariesForUserIds(affiliateSalesByUserId.keys(), commissionDataByUser);
      affiliateSalesByUserId.forEach((affiliateSales, userId) => {
        const summary = commissionDataByUser.get(userId);
        if (summary) {
          summary.affiliateSales = affiliateSales;
          applyAffiliateCommissionEarnings(summary, affiliateSales);
        }
      });
    } catch (error) {
      console.error("Failed to attach affiliate sales to staff payout summaries", error);
      throw new HttpError(
        503,
        "Affiliate payout accounting could not be loaded, so no partial staff payout ledger was persisted.",
      );
    }

    if (isLedgerEligible) {
      // Paid Promotion Sales are immutable payout-log ownership, not a live
      // affiliate-rule calculation. Compare the live overview against that
      // authority before persisting a staff ledger; otherwise changing or
      // removing an affiliate assignment can silently move an already-paid
      // source to another person (or make it disappear altogether).
      const rangeStartIso = start.format("YYYY-MM-DD");
      const rangeEndIso = end.format("YYYY-MM-DD");
      const overlappingPayoutOwners = await AffiliatePayoutLog.findAll({
        attributes: ["affiliateUserId"],
        where: {
          currencyCode: resolvePayoutCurrency(),
          rangeStart: { [Op.lte]: rangeEndIso },
          rangeEnd: { [Op.gte]: rangeStartIso },
        },
        raw: true,
      }) as unknown as Array<{ affiliateUserId: number }>;
      const candidateOwnerIds = Array.from(new Set([
        ...overlappingPayoutOwners.map((row) => Number(row.affiliateUserId)),
        ...Array.from(affiliateSalesByUserId.entries())
          .filter(([, summary]) => summary.commissionPaidTotal > 0)
          .map(([userId]) => userId),
      ].filter((userId) => Number.isSafeInteger(userId) && userId > 0)));
      const internalPaidOwners = candidateOwnerIds.length > 0
        ? await StaffProfile.findAll({
            attributes: ["userId"],
            where: { userId: { [Op.in]: candidateOwnerIds } },
            raw: true,
          }) as unknown as Array<{ userId: number }>
        : [];

      await Promise.all(internalPaidOwners.map(async ({ userId }) => {
        const immutablePaidMinor = await loadImmutableUncollectedAffiliatePaidMinor({
          staffUserId: userId,
          rangeStart: rangeStartIso,
          rangeEnd: rangeEndIso,
          currencyCode: resolvePayoutCurrency(),
          // This comparison intentionally counts every payout log. Collection
          // rows are relevant only when canonical total-paid is assembled.
          collectedFinanceTransactionIds: new Set<number>(),
        });
        const reportedPaidMinor = convertMajorUnitsToMinor(
          affiliateSalesByUserId.get(userId)?.commissionPaidTotal ?? 0,
        );
        if (immutablePaidMinor !== reportedPaidMinor) {
          throw new HttpError(
            409,
            `Paid Promotion Sales ownership for staff member #${userId} no longer matches the current affiliate assignments. Restore or explicitly reconcile the historical assignment before continuing.`,
          );
        }
      }));
    }

    if (commissionDataByUser.size === 0) {
      res.status(404).json([{ message: "No staff members or affiliate sales found for the specified date range" }]);
      return;
    }

    const hydratedSummaryUserIds = Array.from(commissionDataByUser.keys());

    const profileByUserId = new Map<
      number,
      {
        staffProfileKey: number | null;
        financeVendorId: number | null;
        financeClientId: number | null;
        staffType: string | null;
      }
    >();
    const collectionMap = new Map<
      number,
      { currency: string; receivable: number; payable: number }
    >();
    const paidEntriesByStaffProfileId = new Map<number, PaidPayoutEntry[]>();
    let staffProfileIds: number[] = [];
    if (hydratedSummaryUserIds.length > 0) {
      const staffProfiles = (await StaffProfile.findAll({
        attributes: ["userId", "financeVendorId", "financeClientId", "staffType"],
        where: {
          userId: {
            [Op.in]: hydratedSummaryUserIds,
          },
        },
        raw: true,
      })) as Array<{
        userId: number;
        financeVendorId: number | null;
        financeClientId: number | null;
        staffType: string | null;
      }>;

      staffProfileIds = staffProfiles.map((profile) => profile.userId);

      staffProfiles.forEach((profile) => {
        profileByUserId.set(profile.userId, {
          staffProfileKey: profile.userId,
          financeVendorId: profile.financeVendorId,
          financeClientId: profile.financeClientId,
          staffType: profile.staffType,
        });
      });

      const collectionRows =
        staffProfileIds.length > 0
          ? ((await StaffPayoutCollectionLog.findAll({
              attributes: [
                ["staff_profile_id", "staffProfileId"],
                ["currency_code", "currencyCode"],
                "direction",
                [fn("COALESCE", fn("SUM", col("amount_minor")), 0), "totalAmountMinor"],
              ],
              where: {
                staffProfileId: {
                  [Op.in]: staffProfileIds,
                },
                rangeStart: start.format("YYYY-MM-DD"),
                rangeEnd: end.format("YYYY-MM-DD"),
              },
              group: ["staff_profile_id", "currency_code", "direction"],
              raw: true,
            })) as unknown as StaffCollectionAggregate[])
          : [];

      if (staffProfileIds.length > 0) {
        const payoutLogRows = await StaffPayoutCollectionLog.findAll({
          attributes: [
            "id",
            "staffProfileId",
            "currencyCode",
            "amountMinor",
            "financeTransactionId",
            "note",
            "createdAt",
          ],
          where: {
            staffProfileId: {
              [Op.in]: staffProfileIds,
            },
            direction: "payable",
            rangeStart: start.format("YYYY-MM-DD"),
            rangeEnd: end.format("YYYY-MM-DD"),
          },
          order: [
            ["createdAt", "ASC"],
            ["id", "ASC"],
          ],
        });

        const payoutLogIds = payoutLogRows.map((row) => row.id);
        const receiptItems = payoutLogIds.length > 0
          ? await StaffPayoutReceiptItem.findAll({
              attributes: ["receiptId", "collectionLogId"],
              where: { collectionLogId: { [Op.in]: payoutLogIds } },
            })
          : [];
        const receiptIds = Array.from(new Set(receiptItems.map((item) => item.receiptId)));
        const receiptsById = receiptIds.length > 0
          ? new Map(
              (
                await StaffPayoutReceipt.findAll({
                  attributes: [
                    "id",
                    "status",
                    "payoutBatchKey",
                    "confirmedAt",
                    "cancelledAt",
                    "photoFileId",
                    "signatureFileId",
                  ],
                  where: { id: { [Op.in]: receiptIds } },
                })
              ).map((receipt) => [receipt.id, receipt]),
            )
          : new Map<number, StaffPayoutReceipt>();
        const receiptByCollectionLogId = new Map<number, StaffPayoutReceipt>();
        receiptItems.forEach((item) => {
          if (!item.collectionLogId) {
            return;
          }
          const receipt = receiptsById.get(item.receiptId);
          if (receipt) {
            receiptByCollectionLogId.set(item.collectionLogId, receipt);
          }
        });

        const financeTransactionIds = Array.from(
          new Set(
            payoutLogRows
              .map((row) => row.financeTransactionId)
              .filter((value): value is number => Number.isInteger(value) && Number(value) > 0),
          ),
        );

        const financeTransactionsById =
          financeTransactionIds.length > 0
            ? new Map(
                (
                  await FinanceTransaction.findAll({
                    attributes: ["id", "date", "description", "meta"],
                    where: { id: { [Op.in]: financeTransactionIds } },
                  })
                ).map((transaction) => [transaction.id, transaction]),
              )
            : new Map<number, FinanceTransaction>();

        payoutLogRows.forEach((row) => {
          const staffProfileId = Number(row.staffProfileId ?? NaN);
          if (!Number.isFinite(staffProfileId)) {
            return;
          }

          const linkedTransaction =
            row.financeTransactionId && Number.isInteger(row.financeTransactionId)
              ? financeTransactionsById.get(row.financeTransactionId)
              : undefined;
          const meta =
            linkedTransaction?.meta && typeof linkedTransaction.meta === "object"
              ? (linkedTransaction.meta as Record<string, unknown>)
              : null;
          const lineLabel =
            typeof meta?.lineLabel === "string" && meta.lineLabel.trim().length > 0
              ? meta.lineLabel.trim()
              : null;
          const description =
            typeof linkedTransaction?.description === "string" && linkedTransaction.description.trim().length > 0
              ? linkedTransaction.description.trim()
              : null;
          const note =
            typeof row.note === "string" && row.note.trim().length > 0 ? row.note.trim() : null;
          if (isStaffPayoutReimbursementCollection({ meta, description, note })) {
            return;
          }

          const currency =
            typeof row.currencyCode === "string" && row.currencyCode.trim().length > 0
              ? row.currencyCode.trim().toUpperCase()
              : resolvePayoutCurrency();
          const amount = convertMinorUnitsToMajor(row.amountMinor ?? 0);
          const label = lineLabel ?? description ?? note ?? `Payment #${row.id}`;
          const componentIdRaw = meta?.componentId;
          const componentId =
            componentIdRaw !== null && componentIdRaw !== undefined && Number.isInteger(Number(componentIdRaw))
              ? Number(componentIdRaw)
              : null;
          const sourceKey =
            typeof meta?.sourceKey === "string" && meta.sourceKey.trim().length > 0
              ? meta.sourceKey.trim().toLowerCase()
              : componentId && componentId > 0
                ? "compensation_component"
                : meta?.affiliatePayout === true || meta?.source === "affiliate-payout"
                  ? "promotion_sales"
                  : null;
          const segmentKey =
            typeof meta?.segmentKey === "string" && meta.segmentKey.startsWith("seg_")
              ? meta.segmentKey
              : null;
          const date =
            typeof linkedTransaction?.date === "string" && linkedTransaction.date.trim().length > 0
              ? linkedTransaction.date
              : dayjs(row.createdAt).format("YYYY-MM-DD");
          const createdAt = dayjs(row.createdAt).toISOString();
          const receipt = receiptByCollectionLogId.get(row.id) ?? null;
          const existingEntries = paidEntriesByStaffProfileId.get(staffProfileId) ?? [];
          existingEntries.push({
            id: row.id,
            financeTransactionId:
              row.financeTransactionId && Number.isInteger(row.financeTransactionId)
                ? row.financeTransactionId
                : null,
            label,
            componentId: componentId && componentId > 0 ? componentId : null,
            sourceKey,
            segmentKey,
            amount: roundCurrencyValue(amount),
            currency,
            date,
            note,
            createdAt,
            canDelete: true,
            receipt: receipt ? buildStaffPayoutReceiptCompactView(receipt) : null,
          });
          paidEntriesByStaffProfileId.set(staffProfileId, existingEntries);
        });
      }

      collectionRows.forEach((row) => {
        const staffProfileId = Number(row.staffProfileId ?? NaN);
        if (!Number.isFinite(staffProfileId)) {
          return;
        }
        const currency =
          typeof row.currencyCode === "string" && row.currencyCode.trim().length > 0
            ? row.currencyCode.trim().toUpperCase()
            : resolvePayoutCurrency();
        const existing =
          collectionMap.get(staffProfileId) ?? {
            currency,
            receivable: 0,
            payable: 0,
          };
        const amount = convertMinorUnitsToMajor(row.totalAmountMinor ?? 0);
        if (row.direction === "receivable") {
          existing.receivable += amount;
        } else {
          existing.payable += amount;
        }
        existing.currency = currency;
        collectionMap.set(staffProfileId, existing);
      });
    }

    commissionDataByUser.forEach((summary, userId) => {
      const profile = profileByUserId.get(userId) ?? null;
      const staffProfileKey = profile?.staffProfileKey ?? null;
      const collection =
        (staffProfileKey ? collectionMap.get(staffProfileKey) : undefined) ?? {
          currency: resolvePayoutCurrency(),
          receivable: 0,
          payable: 0,
        };
      summary.staffProfileId = staffProfileKey;
      summary.financeVendorId = profile?.financeVendorId ?? null;
      summary.financeClientId = profile?.financeClientId ?? null;
      summary.staffType = profile?.staffType ?? null;
      summary.paidEntries = staffProfileKey
        ? (paidEntriesByStaffProfileId.get(staffProfileKey) ?? [])
        : [];
      summary.payouts.currency = collection.currency ?? resolvePayoutCurrency();
    });

    const vendorIdsByUser = new Map<number, number>();
    commissionDataByUser.forEach((summary, userId) => {
      const vendorId = summary.financeVendorId;
      if (vendorId && vendorId > 0) {
        vendorIdsByUser.set(userId, vendorId);
      }
    });

    const reimbursementsByUserId = new Map<number, FinanceTransaction[]>();
    const reimbursementsByVendorId = new Map<number, FinanceTransaction[]>();

    if (commissionDataByUser.size > 0) {
      const reimbursementRows = await FinanceTransaction.findAll({
        where: {
          status: {
            [Op.in]: ["awaiting_reimbursement", "reimbursed"],
          },
          date: {
            [Op.between]: [start.format("YYYY-MM-DD"), end.format("YYYY-MM-DD")],
          },
        },
        include: [
          {
            model: FinanceVendor,
            as: "vendor",
            attributes: ["id", "name"],
          },
        ],
        order: [
          ["date", "ASC"],
          ["id", "ASC"],
        ],
      });

      reimbursementRows.forEach((row) => {
        const meta = (row.meta ?? null) as Record<string, unknown> | null;
        const paidByUserId = normalizeUserId(meta?.paidByUserId ?? meta?.staffUserId ?? null);
        if (paidByUserId) {
          const bucket = reimbursementsByUserId.get(paidByUserId) ?? [];
          bucket.push(row);
          reimbursementsByUserId.set(paidByUserId, bucket);
          return;
        }
        const vendorId = row.counterpartyId;
        if (!vendorId) {
          return;
        }
        const bucket = reimbursementsByVendorId.get(vendorId) ?? [];
        bucket.push(row);
        reimbursementsByVendorId.set(vendorId, bucket);
      });
    }

    const createReimbursementSummary = (rows: FinanceTransaction[]): ReimbursementSummary => {
      const entries: ReimbursementEntry[] = rows.map((row) => {
        const baseAmount = convertMinorUnitsToMajor(row.baseAmountMinor ?? row.amountMinor ?? 0);
        const originalAmount = convertMinorUnitsToMajor(row.amountMinor ?? 0);
        return {
          transactionId: row.id,
          date: row.date,
          vendorName: row.vendor?.name ?? null,
          description: row.description ?? null,
          amount: roundCurrencyValue(baseAmount),
          originalAmount: roundCurrencyValue(originalAmount),
          originalCurrency: row.currency,
          status: row.status,
        };
      });

      const awaitingAmount = roundCurrencyValue(
        entries
          .filter((entry) => entry.status === "awaiting_reimbursement")
          .reduce((sum, entry) => sum + entry.amount, 0),
      );
      const reimbursedAmount = roundCurrencyValue(
        entries.filter((entry) => entry.status === "reimbursed").reduce((sum, entry) => sum + entry.amount, 0),
      );

      return {
        awaitingAmount,
        reimbursedAmount,
        entries,
      };
    };

    const applyReimbursementsToSummary = (
      summary: CommissionSummary,
      rows: FinanceTransaction[] | undefined,
    ): void => {
      if (!rows || rows.length === 0) {
        summary.reimbursements = {
          awaitingAmount: 0,
          reimbursedAmount: 0,
          entries: [],
        };
        return;
      }

      const reimbursementSummary = createReimbursementSummary(rows);
      summary.reimbursements = reimbursementSummary;

      const reimbursementPayoutAmount = roundCurrencyValue(
        reimbursementSummary.awaitingAmount + reimbursementSummary.reimbursedAmount,
      );

      if (reimbursementPayoutAmount > 0) {
        summary.bucketTotals.reimbursement =
          (summary.bucketTotals.reimbursement ?? 0) + reimbursementPayoutAmount;
        summary.totalPayout += reimbursementPayoutAmount;
      }
    };

    commissionDataByUser.forEach((summary, userId) => {
      const rowsByUser = reimbursementsByUserId.get(userId);
      if (rowsByUser && rowsByUser.length > 0) {
        applyReimbursementsToSummary(summary, rowsByUser);
        return;
      }

      const vendorId = vendorIdsByUser.get(userId);
      if (vendorId) {
        applyReimbursementsToSummary(summary, reimbursementsByVendorId.get(vendorId));
      } else {
        summary.reimbursements = {
          awaitingAmount: 0,
          reimbursedAmount: 0,
          entries: [],
        };
      }
    });

    const rangeStartIso = start.format("YYYY-MM-DD");
    const rangeEndIso = end.format("YYYY-MM-DD");
    const usesSegmentedStaffTypeRouting = rangeEndIso >= STAFF_TYPE_SEGMENTED_PAYOUT_START;
    const routingEvaluationDate = (date: string): string => `${date.slice(0, 7)}-01`;
    const rangeEndRoutingDate = routingEvaluationDate(rangeEndIso);
    const rangeEndSettlementRouter = await loadCompensationSettlementRouter({
      effectiveDate: rangeEndRoutingDate,
    });
    const settlementRouterByDate = new Map([[rangeEndRoutingDate, rangeEndSettlementRouter]]);
    const getSettlementRouterForDate = async (effectiveDate: string) => {
      const evaluationDate = routingEvaluationDate(effectiveDate);
      const existing = settlementRouterByDate.get(evaluationDate);
      if (existing) {
        return existing;
      }
      const loaded = await loadCompensationSettlementRouter({ effectiveDate: evaluationDate });
      settlementRouterByDate.set(evaluationDate, loaded);
      return loaded;
    };
    const staffTypePeriodsByUserId = new Map<number, StaffTypeEligibilityPeriod[]>();
    if (usesSegmentedStaffTypeRouting) {
      const periodRows = await getStaffProfileTypePeriodsForRange({
        userIds: Array.from(commissionDataByUser.keys()),
        startDate: rangeStartIso < STAFF_TYPE_SEGMENTED_PAYOUT_START
          ? STAFF_TYPE_SEGMENTED_PAYOUT_START
          : rangeStartIso,
        endDate: rangeEndIso,
      });
      periodRows.forEach((period) => {
        const periods = staffTypePeriodsByUserId.get(period.userId) ?? [];
        periods.push({
          id: Number(period.id),
          staffType: period.staffType,
          effectiveStart: period.effectiveStart,
          effectiveEnd: period.effectiveEnd,
          legacyExtrapolation: period.metadata?.legacyExtrapolation === true,
        });
        staffTypePeriodsByUserId.set(period.userId, periods);
      });
    }
    const settlementFundRows = await VolunteerFund.findAll({
      attributes: ["id", "name", "currency", "isActive"],
    });
    const settlementFundById = new Map(
      settlementFundRows.map((fund) => [fund.id, fund] as const),
    );
    const settlementFundNameById = new Map(
      settlementFundRows.map((fund) => [fund.id, fund.name] as const),
    );
    // Read the whole period, not only users still present in the live report.
    // Otherwise an allocation can disappear from reconciliation when its
    // staff/source calculation is removed entirely.
    const allocationRows = await VolunteerFundEntry.findAll({
      attributes: [
        "id",
        "fundId",
        "amountMinor",
        "attributedStaffUserId",
        "compensationComponentId",
        "sourceKind",
        "sourceReference",
      ],
      where: {
        entryType: "allocation",
        periodStart: rangeStartIso,
        periodEnd: rangeEndIso,
      },
    });
    const allocationIds = allocationRows.map((entry) => entry.id);
    const allocationReversalRows = allocationIds.length > 0
      ? await VolunteerFundEntry.findAll({
          attributes: ["amountMinor", "reversalOfEntryId"],
          where: {
            entryType: "reversal",
            reversalOfEntryId: { [Op.in]: allocationIds },
          },
        })
      : [];
    const settlementSourceAllocationKey = (
      userId: number,
      sourceKey: string,
      componentId: number | null,
      segmentKey: string | null,
    ) => `${userId}:${sourceKey}:${componentId ?? 0}:${segmentKey ?? "legacy"}`;
    const allocatedMinorBySourceAndFund = new Map<string, Map<number, number>>();
    const allocationIdentityByKey = new Map<
      string,
      { userId: number; sourceKey: string; componentId: number | null; segmentKey: string | null }
    >();
    const matchedSettlementAllocationKeys = new Set<string>();
    const allocationById = new Map(allocationRows.map((entry) => [entry.id, entry] as const));
    const unattributedAllocation = allocationRows.find(
      (entry) => !entry.attributedStaffUserId || !entry.sourceKind,
    );
    if (unattributedAllocation) {
      throw new HttpError(
        409,
        `Volunteer Fund allocation #${unattributedAllocation.id} is missing its staff/source attribution and must be reconciled.`,
      );
    }
    const addNetFundAllocation = (
      key: string,
      fundId: number,
      amountMinor: number,
    ): void => {
      const byFund = allocatedMinorBySourceAndFund.get(key) ?? new Map<number, number>();
      byFund.set(fundId, (byFund.get(fundId) ?? 0) + amountMinor);
      allocatedMinorBySourceAndFund.set(key, byFund);
    };
    allocationRows.forEach((entry) => {
      if (!entry.attributedStaffUserId || !entry.sourceKind) {
        return;
      }
      const key = settlementSourceAllocationKey(
        entry.attributedStaffUserId,
        entry.sourceKind,
        entry.compensationComponentId,
        entry.sourceReference?.startsWith("seg_") ? entry.sourceReference : null,
      );
      allocationIdentityByKey.set(key, {
        userId: entry.attributedStaffUserId,
        sourceKey: entry.sourceKind,
        componentId: entry.compensationComponentId,
        segmentKey: entry.sourceReference?.startsWith("seg_") ? entry.sourceReference : null,
      });
      addNetFundAllocation(key, entry.fundId, Number(entry.amountMinor ?? 0));
    });
    allocationReversalRows.forEach((reversal) => {
      if (!reversal.reversalOfEntryId) {
        return;
      }
      const original = allocationById.get(reversal.reversalOfEntryId);
      if (!original?.attributedStaffUserId || !original.sourceKind) {
        return;
      }
      const key = settlementSourceAllocationKey(
        original.attributedStaffUserId,
        original.sourceKind,
        original.compensationComponentId,
        original.sourceReference?.startsWith("seg_") ? original.sourceReference : null,
      );
      allocationIdentityByKey.set(key, {
        userId: original.attributedStaffUserId,
        sourceKey: original.sourceKind,
        componentId: original.compensationComponentId,
        segmentKey: original.sourceReference?.startsWith("seg_") ? original.sourceReference : null,
      });
      addNetFundAllocation(key, original.fundId, Number(reversal.amountMinor ?? 0));
    });

    const fallbackSettlementDates = enumerateInclusiveIsoDates(rangeStartIso, rangeEndIso);
    const buildExactDatedMinorEarnings = (
      totalAmount: number,
      rawEntries: Array<{ date: string; amount: number }>,
    ): DatedMinorAmount[] => {
      const totalMinor = convertMajorUnitsToMinor(totalAmount);
      const byDate = new Map<string, number>();
      rawEntries.forEach((entry) => {
        if (
          /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
          && entry.date >= rangeStartIso
          && entry.date <= rangeEndIso
        ) {
          byDate.set(
            entry.date,
            (byDate.get(entry.date) ?? 0) + convertMajorUnitsToMinor(entry.amount),
          );
        }
      });
      if (byDate.size === 0) {
        return allocateMinorAcrossDates(totalMinor, fallbackSettlementDates);
      }
      const dated = Array.from(byDate.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, amountMinor]) => ({ date, amountMinor }));
      const difference = totalMinor - dated.reduce((sum, entry) => sum + entry.amountMinor, 0);
      dated[dated.length - 1].amountMinor += difference;
      return dated;
    };
    const affiliateBookingEarningDate = (booking: StaffAffiliateSaleBooking): string | null => {
      if (!booking.sourceReceivedAt) {
        return null;
      }
      const parsed = dayjs(booking.sourceReceivedAt);
      return parsed.isValid() ? parsed.tz("Europe/Warsaw").format("YYYY-MM-DD") : null;
    };

    for (const summary of commissionDataByUser.values()) {
      const grossBucketTotals = { ...summary.bucketTotals };
      const personalBucketTotals: Record<string, number> = {};
      const fundBucketTotals: Record<string, number> = {};
      const sources: SettlementSourceSummary[] = [];

      const addSettlementSource = async (input: {
        sourceKey: string;
        label: string;
        componentId?: number | null;
        category: string;
        amount: number;
        earnings: DatedMinorAmount[];
        references?: Array<{ id: number; date: string }>;
      }): Promise<void> => {
        const sourceAmount = roundCurrencyValue(input.amount);
        const componentId = input.componentId ?? null;
        if (!sourceAmount) {
          return;
        }
        let settlementSegments: Array<{
          segmentKey: string | null;
          earningStart: string | null;
          earningEnd: string | null;
          coverageStart: string;
          coverageEnd: string;
          staffTypePeriodId: number | null;
          staffType: string | null;
          legacyExtrapolation: boolean;
          grossAmountMinor: number;
          routing: StaffPayoutRoutingPartition | null;
        }>;
        try {
          const cutoffPartition = splitDatedEarningsAtCutoff({
            earnings: input.earnings,
            cutoffDate: STAFF_TYPE_SEGMENTED_PAYOUT_START,
          });
          settlementSegments = [];

          const legacyEarnings = cutoffPartition.before.filter((entry) => entry.amountMinor !== 0);
          if (legacyEarnings.length > 0) {
            const legacyDates = legacyEarnings.map((entry) => entry.date).sort();
            const legacyGrossAmountMinor = legacyEarnings.reduce(
              (sum, entry) => sum + entry.amountMinor,
              0,
            );
            if (legacyGrossAmountMinor !== 0) {
              settlementSegments.push({
                segmentKey: null,
                earningStart: null,
                earningEnd: null,
                coverageStart: legacyDates[0],
                coverageEnd: legacyDates[legacyDates.length - 1],
                staffTypePeriodId: null,
                staffType: summary.staffType,
                legacyExtrapolation: false,
                grossAmountMinor: legacyGrossAmountMinor,
                routing: null,
              });
            }
          }

          const effectiveDatedEarnings = cutoffPartition.onOrAfter.filter(
            (entry) => entry.amountMinor !== 0,
          );
          if (usesSegmentedStaffTypeRouting && effectiveDatedEarnings.length > 0) {
            const periods = staffTypePeriodsByUserId.get(summary.userId) ?? [];
            // Resolve the staff type first, then resolve the routing rule valid
            // for every earning date. The routed split below groups those dates
            // by immutable staff-period + calendar-month + rule identity.
            const staffTypeSegments = splitDatedEarningsByStaffType({
              sourceKey: input.sourceKey,
              componentId,
              earnings: effectiveDatedEarnings,
              periods,
            });
            const routingByDate = new Map<string, StaffPayoutRoutingPartition>();
            for (const earning of effectiveDatedEarnings) {
              const staffTypeSegment = staffTypeSegments.find((segment) => (
                earning.date >= segment.earningStart && earning.date <= segment.earningEnd
              ));
              if (!staffTypeSegment) {
                throw new Error(`No staff-type eligibility period covers ${earning.date}.`);
              }
              const settlementRouter = await getSettlementRouterForDate(earning.date);
              const route = settlementRouter.resolve({
                userId: summary.userId,
                staffType: staffTypeSegment.staffType,
                ...(componentId
                  ? { componentId, componentCategory: input.category }
                  : { systemSource: input.sourceKey }),
              });
              routingByDate.set(earning.date, {
                ruleId: route.ruleId,
                destination: route.destination,
                fundId: route.fundId,
              });
            }
            settlementSegments.push(
              ...splitDatedEarningsByStaffTypeAndRouting({
                sourceKey: input.sourceKey,
                componentId,
                earnings: effectiveDatedEarnings,
                periods,
                routingByDate,
              })
                .filter((segment) => segment.grossAmountMinor !== 0)
                .map((segment) => ({
                  segmentKey: segment.segmentKey,
                  earningStart: segment.earningStart,
                  earningEnd: segment.earningEnd,
                  coverageStart: segment.earningStart,
                  coverageEnd: segment.earningEnd,
                  staffTypePeriodId: Number(segment.staffTypePeriodId),
                  staffType: segment.staffType,
                  legacyExtrapolation: segment.legacyExtrapolation,
                  grossAmountMinor: segment.grossAmountMinor,
                  routing: segment.routing,
                })),
            );
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Eligibility history is incomplete.";
          throw new HttpError(
            409,
            `${input.label} for ${summary.fullName} cannot be routed by earning date. ${detail}`,
          );
        }
        if (settlementSegments.length === 0) {
          throw new HttpError(
            409,
            `${input.label} for ${summary.fullName} has money but no earning-date segment.`,
          );
        }
        const segmentedGrossAmountMinor = settlementSegments.reduce(
          (sum, segment) => sum + segment.grossAmountMinor,
          0,
        );
        if (segmentedGrossAmountMinor !== convertMajorUnitsToMinor(sourceAmount)) {
          throw new HttpError(
            409,
            `${input.label} for ${summary.fullName} could not preserve its exact earning total.`,
          );
        }
        const legacyAllocationKey = settlementSourceAllocationKey(
          summary.userId,
          input.sourceKey,
          componentId,
          null,
        );
        const legacyAllocationsByFund = Array.from(
          allocatedMinorBySourceAndFund.get(legacyAllocationKey)?.entries() ?? [],
        ).filter(([, amountMinor]) => amountMinor !== 0);
        if (usesSegmentedStaffTypeRouting && settlementSegments.length > 1 && legacyAllocationsByFund.length > 0) {
          throw new HttpError(
            409,
            `${input.label} has a legacy Volunteer Fund allocation spanning more than one staff type. Reconcile it to the earning-date segments before continuing.`,
          );
        }
        const legacyPaidEntries = (summary.paidEntries ?? []).filter((entry) => (
          entry.currency === resolvePayoutCurrency()
          && entry.segmentKey === null
          && (
            componentId
              ? entry.componentId === componentId
              : entry.sourceKey === input.sourceKey
          )
        ));
        if (
          usesSegmentedStaffTypeRouting
          && input.sourceKey !== "promotion_sales"
          && settlementSegments.length > 1
          && legacyPaidEntries.some((entry) => entry.amount !== 0)
        ) {
          throw new HttpError(
            409,
            `${input.label} has a legacy staff payment spanning more than one staff type. Reconcile it to the earning-date segments before continuing.`,
          );
        }

        for (const settlementSegment of settlementSegments) {
        const amount = convertMinorUnitsToMajor(settlementSegment.grossAmountMinor);
        const exactAllocationKey = settlementSourceAllocationKey(
          summary.userId,
          input.sourceKey,
          componentId,
          settlementSegment.segmentKey,
        );
        const exactAllocationsByFund = Array.from(
          allocatedMinorBySourceAndFund.get(exactAllocationKey)?.entries() ?? [],
        ).filter(([, amountMinor]) => amountMinor !== 0);
        const usesLegacyAllocation = settlementSegment.segmentKey !== null
          && settlementSegments.length === 1
          && exactAllocationsByFund.length === 0
          && legacyAllocationsByFund.length > 0;
        const allocationKey = usesLegacyAllocation ? legacyAllocationKey : exactAllocationKey;
        const nonzeroAllocationsByFund = usesLegacyAllocation
          ? legacyAllocationsByFund
          : exactAllocationsByFund;
        matchedSettlementAllocationKeys.add(allocationKey);
        if (nonzeroAllocationsByFund.some(([, amountMinor]) => amountMinor < 0)) {
          throw new HttpError(
            409,
            `${input.label} has an invalid negative Volunteer Fund balance. Reconcile that allocation before continuing.`,
          );
        }
        const route = settlementSegment.routing ?? (
          await getSettlementRouterForDate(settlementSegment.coverageEnd)
        ).resolve({
          userId: summary.userId,
          staffType: settlementSegment.staffType,
          ...(componentId
            ? { componentId, componentCategory: input.category }
            : { systemSource: input.sourceKey }),
        });
        const activeAllocationsByFund = nonzeroAllocationsByFund;
        if (activeAllocationsByFund.length > 1) {
          throw new HttpError(
            409,
            `${input.label} has active allocations in more than one Volunteer Fund. Reverse the incorrect allocation before settling this period.`,
          );
        }
        const historicalFundId = activeAllocationsByFund[0]?.[0] ?? null;
        const allocatedAmount = roundCurrencyValue(
          activeAllocationsByFund.reduce((sum, [, amountMinor]) => sum + amountMinor, 0) / 100,
        );
        const hasTakeoverSalaryAllocation = componentId !== null
          && summary.componentTotals.some((component) =>
            component.componentId === componentId
            && component.taskCompletionDailyBreakdown?.some(
              (row) => row.takeoverAllocationRole === "shift_taker"
                || row.takeoverAllocationRole === "task_owner",
            ),
          );
        if (
          input.sourceKey === "compensation_component"
          && hasTakeoverSalaryAllocation
          && convertMajorUnitsToMinor(allocatedAmount) > convertMajorUnitsToMinor(amount)
        ) {
          throw new HttpError(
            409,
            `${input.label} has already been allocated to a Volunteer Fund above its recalculated takeover share. Reverse the excess allocation before applying the takeover salary split.`,
          );
        }
        const segmentIncludesDate = (date: string | null): boolean => Boolean(
          date
          && date >= settlementSegment.coverageStart
          && date <= settlementSegment.coverageEnd
        );
        const personallySettledAmount = input.sourceKey === "promotion_sales"
          ? roundCurrencyValue(
              summary.affiliateSales.bookings
                .filter((booking) => (
                  booking.isCommissionPaid
                  && segmentIncludesDate(affiliateBookingEarningDate(booking))
                ))
                .reduce((sum, booking) => sum + booking.affiliateCommissionAmount, 0),
            )
          : roundCurrencyValue(
              (summary.paidEntries ?? [])
                .filter((entry) => (
                  entry.currency === resolvePayoutCurrency()
                  && (
                    componentId
                      ? entry.componentId === componentId
                      : entry.sourceKey === input.sourceKey
                  )
                  && (
                    entry.segmentKey === settlementSegment.segmentKey
                    || (
                      settlementSegment.segmentKey !== null
                      && settlementSegments.length === 1
                      && entry.segmentKey === null
                    )
                  )
                ))
                .reduce((sum, entry) => sum + entry.amount, 0),
            );
        if (
          input.sourceKey === "compensation_component"
          && convertMajorUnitsToMinor(personallySettledAmount) > convertMajorUnitsToMinor(amount)
        ) {
          throw new HttpError(
            409,
            `${input.label} has already been paid above its recalculated amount. Reconcile or reverse the historical payment before applying the takeover salary split.`,
          );
        }
        if (historicalFundId && personallySettledAmount > 0) {
          throw new HttpError(
            409,
            `${input.label} has both a staff payment and a live Volunteer Fund allocation for this period. Reconcile or reverse the incorrect settlement before continuing.`,
          );
        }
        const historicalDestination = historicalFundId
          ? "volunteer_fund"
          : personallySettledAmount > 0
            ? "staff_vendor"
            : null;
        const routeChanged = historicalDestination === "volunteer_fund"
          ? route.destination !== "volunteer_fund" || route.fundId !== historicalFundId
          : historicalDestination === "staff_vendor"
            ? route.destination !== "staff_vendor"
            : false;
        // A live ledger settlement is authoritative for its whole source and
        // period. This prevents either destination from being exposed again
        // after a rule or staff-label change.
        const destination = historicalDestination ?? route.destination;
        const fundId = historicalFundId
          ?? (destination === "volunteer_fund" ? route.fundId : null);
        const allocatedFundIds = activeAllocationsByFund
          .map(([allocatedFundId]) => allocatedFundId)
          .sort((left, right) => left - right);
        const fund = fundId ? settlementFundById.get(fundId) ?? null : null;
        if (destination === "volunteer_fund") {
          if (!fund) {
            throw new HttpError(
              409,
              `${input.label} references a missing Volunteer Fund. Restore the fund before settling.`,
            );
          }
          if (fund.currency.trim().toUpperCase() !== resolvePayoutCurrency()) {
            throw new HttpError(
              409,
              `${fund.name} must use ${resolvePayoutCurrency()} to receive staff compensation.`,
            );
          }
        }
        const outstandingAmount = destination === "volunteer_fund"
          ? roundCurrencyValue(Math.max(amount - allocatedAmount, 0))
          : destination === "staff_vendor" && input.sourceKey !== "reimbursement"
            ? roundCurrencyValue(Math.max(amount - personallySettledAmount, 0))
            : 0;
        if (outstandingAmount > 0 && fund && !fund.isActive) {
          throw new HttpError(
            409,
            `${input.label} still has an outstanding amount but ${fund.name} is inactive. Reactivate it or update future routing.`,
          );
        }
        const overallocatedAmount = destination === "volunteer_fund"
          ? roundCurrencyValue(Math.max(allocatedAmount - amount, 0))
          : 0;

        sources.push({
          sourceKey: input.sourceKey,
          label: input.label,
          componentId,
          segmentKey: settlementSegment.segmentKey,
          earningStart: settlementSegment.earningStart,
          earningEnd: settlementSegment.earningEnd,
          staffTypePeriodId: settlementSegment.staffTypePeriodId,
          staffType: settlementSegment.staffType,
          legacyExtrapolation: settlementSegment.legacyExtrapolation,
          referenceIds: (input.references ?? [])
            .filter((reference) => segmentIncludesDate(reference.date))
            .map((reference) => reference.id)
            .sort((left, right) => left - right),
          category: input.category,
          amount,
          destination,
          fundId,
          fundName: fund?.name ?? null,
          ruleId: route.ruleId,
          settledAmount: destination === "volunteer_fund" ? allocatedAmount : personallySettledAmount,
          allocatedAmount,
          outstandingAmount,
          overallocatedAmount,
          currency: resolvePayoutCurrency(),
          allocatedFundIds,
          routeChanged,
          settlementIntent: null,
        });

        if (destination === "staff_vendor") {
          personalBucketTotals[input.category] =
            (personalBucketTotals[input.category] ?? 0) + amount;
        } else if (destination === "volunteer_fund") {
          fundBucketTotals[input.category] = (fundBucketTotals[input.category] ?? 0) + amount;
        }
        }
      };

      await addSettlementSource({
        sourceKey: "guide_commission",
        label: "Guide commission",
        category: "commission",
        amount: summary.totalCommission,
        earnings: buildExactDatedMinorEarnings(
          summary.totalCommission,
          summary.breakdown.map((entry) => ({ date: entry.date, amount: entry.commission })),
        ),
      });
      for (const component of summary.componentTotals) {
        await addSettlementSource({
          sourceKey: "compensation_component",
          label: component.name,
          componentId: component.componentId,
          category: component.category,
          amount: component.amount,
          earnings: buildExactDatedMinorEarnings(
            component.amount,
            (component.earningBreakdown ?? []).map((entry) => ({
              date: entry.date,
              amount: entry.amount,
            })),
          ),
        });
      }
      const promotionBookingsWithDates = summary.affiliateSales.bookings
        .map((booking) => ({ booking, date: affiliateBookingEarningDate(booking) }))
        .filter((entry): entry is { booking: StaffAffiliateSaleBooking; date: string } => Boolean(entry.date));
      await addSettlementSource({
        sourceKey: "promotion_sales",
        label: "Promotion Sales",
        category: "affiliate_commission",
        amount: summary.affiliateSales.commissionTotal,
        earnings: buildExactDatedMinorEarnings(
          summary.affiliateSales.commissionTotal,
          promotionBookingsWithDates.map(({ booking, date }) => ({
            date,
            amount: booking.affiliateCommissionAmount,
          })),
        ),
        references: promotionBookingsWithDates
          .filter(({ booking }) => !booking.isCommissionPaid && booking.affiliateCommissionAmount > 0)
          .map(({ booking, date }) => ({ id: booking.id, date })),
      });
      await addSettlementSource({
        sourceKey: "reimbursement",
        label: "Reimbursements",
        category: "reimbursement",
        amount:
          summary.reimbursements.awaitingAmount + summary.reimbursements.reimbursedAmount,
        earnings: buildExactDatedMinorEarnings(
          summary.reimbursements.awaitingAmount + summary.reimbursements.reimbursedAmount,
          summary.reimbursements.entries.map((entry) => ({
            date: entry.date,
            amount: entry.amount,
          })),
        ),
      });

      // Deductions are signed compensation sources but the fund ledger records
      // only the net amount reserved for the volunteer. Cap positive source
      // allocations to that net outstanding total so +100 / -20 cannot create
      // a 100 fund allocation.
      const fundSourcesById = new Map<number, SettlementSourceSummary[]>();
      sources.forEach((source) => {
        if (source.destination !== "volunteer_fund" || !source.fundId) {
          return;
        }
        const entries = fundSourcesById.get(source.fundId) ?? [];
        entries.push(source);
        fundSourcesById.set(source.fundId, entries);
      });
      fundSourcesById.forEach((fundSources) => {
        const fundGross = roundCurrencyValue(
          fundSources.reduce((sum, source) => sum + source.amount, 0),
        );
        const fundAllocated = roundCurrencyValue(
          fundSources.reduce((sum, source) => sum + source.allocatedAmount, 0),
        );
        let remainingOutstanding = roundCurrencyValue(Math.max(fundGross - fundAllocated, 0));
        fundSources.forEach((source) => {
          const sourceCandidate = roundCurrencyValue(
            Math.max(source.amount - source.allocatedAmount, 0),
          );
          source.outstandingAmount = roundCurrencyValue(
            Math.min(sourceCandidate, remainingOutstanding),
          );
          remainingOutstanding = roundCurrencyValue(
            Math.max(remainingOutstanding - source.outstandingAmount, 0),
          );
          if (
            !shouldLimitToSelf
            && source.outstandingAmount > 0
            && source.fundId
            && !source.routeChanged
          ) {
            source.settlementIntent = signCompensationSettlementIntent({
              userId: summary.userId,
              rangeStart: rangeStartIso,
              rangeEnd: rangeEndIso,
              sourceKey: source.sourceKey,
              componentId: source.componentId,
              category: source.category,
              destination: source.destination,
              fundId: source.fundId,
              grossAmountMinor: Math.round(source.amount * 100),
              outstandingAmountMinor: Math.round(source.outstandingAmount * 100),
              ruleId: source.ruleId,
              currency: source.currency,
              ...(source.segmentKey ? {
                direction: "payable",
                segmentKey: source.segmentKey,
                earningStart: source.earningStart as string,
                earningEnd: source.earningEnd as string,
                staffTypePeriodId: source.staffTypePeriodId as number,
                staffType: source.staffType as string,
                legacyExtrapolation: source.legacyExtrapolation,
                referenceIds: source.referenceIds,
              } : {}),
            });
          }
        });
      });

      // Calculated personal compensation is authorized per source as well.
      // Distribute only the net remaining amount across positive sources so
      // deductions cannot be bypassed by submitting their gross rows. Staff
      // reimbursements retain their separate transaction-ID validation path.
      const personalSources = sources
        .filter(
          (source) => source.destination === "staff_vendor" && source.sourceKey !== "reimbursement",
        )
        // Promotion Sales are tied to immutable booking IDs and their payout
        // log must equal those bookings. Apply any cross-source deduction to a
        // flexible compensation line before reducing this evidence-bound row.
        .sort((left, right) => (
          Number(right.sourceKey === "promotion_sales")
          - Number(left.sourceKey === "promotion_sales")
        ));
      const personalGross = roundCurrencyValue(
        personalSources.reduce((sum, source) => sum + source.amount, 0),
      );
      const personalSettled = roundCurrencyValue(
        personalSources.reduce((sum, source) => sum + source.settledAmount, 0),
      );
      let personalRemainingOutstanding = roundCurrencyValue(
        Math.max(personalGross - personalSettled, 0),
      );
      personalSources.forEach((source) => {
        const sourceCandidate = roundCurrencyValue(
          Math.max(source.amount - source.settledAmount, 0),
        );
        source.outstandingAmount = roundCurrencyValue(
          Math.min(sourceCandidate, personalRemainingOutstanding),
        );
        personalRemainingOutstanding = roundCurrencyValue(
          Math.max(personalRemainingOutstanding - source.outstandingAmount, 0),
        );
        if (!shouldLimitToSelf && source.outstandingAmount > 0 && !source.routeChanged) {
          source.settlementIntent = signCompensationSettlementIntent({
            userId: summary.userId,
            rangeStart: rangeStartIso,
            rangeEnd: rangeEndIso,
            sourceKey: source.sourceKey,
            componentId: source.componentId,
            category: source.category,
            destination: source.destination,
            fundId: null,
            grossAmountMinor: Math.round(source.amount * 100),
            outstandingAmountMinor: Math.round(source.outstandingAmount * 100),
            ruleId: source.ruleId,
            currency: source.currency,
            ...(source.segmentKey ? {
              direction: "payable",
              segmentKey: source.segmentKey,
              earningStart: source.earningStart as string,
              earningEnd: source.earningEnd as string,
              staffTypePeriodId: source.staffTypePeriodId as number,
              staffType: source.staffType as string,
              legacyExtrapolation: source.legacyExtrapolation,
              referenceIds: source.referenceIds,
            } : {}),
          });
        }
      });

      const personalPayableTotal = sources
        .filter((source) => source.destination === "staff_vendor")
        .reduce((sum, source) => sum + source.amount, 0);
      const fundAllocationTotal = sources
        .filter((source) => source.destination === "volunteer_fund")
        .reduce((sum, source) => sum + source.amount, 0);
      const fundAllocatedTotal = sources
        .filter((source) => source.destination === "volunteer_fund")
        .reduce((sum, source) => sum + source.allocatedAmount, 0);
      const fundOutstandingTotal = sources
        .filter((source) => source.destination === "volunteer_fund")
        .reduce((sum, source) => sum + source.outstandingAmount, 0);
      const fundOverallocatedTotal = Array.from(fundSourcesById.values()).reduce(
        (sum, fundSources) => {
          const gross = fundSources.reduce((fundSum, source) => fundSum + source.amount, 0);
          const allocated = fundSources.reduce(
            (fundSum, source) => fundSum + source.allocatedAmount,
            0,
          );
          return sum + Math.max(allocated - gross, 0);
        },
        0,
      );
      const excludedTotal = sources
        .filter((source) => source.destination === "excluded")
        .reduce((sum, source) => sum + source.amount, 0);

      summary.grossBucketTotals = grossBucketTotals;
      summary.bucketTotals = Object.fromEntries(
        Object.entries(personalBucketTotals).map(([key, value]) => [key, roundCurrencyValue(value)]),
      );
      summary.fundBucketTotals = Object.fromEntries(
        Object.entries(fundBucketTotals).map(([key, value]) => [key, roundCurrencyValue(value)]),
      );
      summary.grossCompensationTotal = roundCurrencyValue(
        sources.reduce((sum, source) => sum + source.amount, 0),
      );
      summary.personalPayableTotal = roundCurrencyValue(personalPayableTotal);
      summary.volunteerFundAllocationTotal = roundCurrencyValue(fundAllocationTotal);
      summary.volunteerFundAllocatedTotal = roundCurrencyValue(fundAllocatedTotal);
      summary.volunteerFundOutstandingTotal = roundCurrencyValue(fundOutstandingTotal);
      summary.volunteerFundOverallocatedTotal = roundCurrencyValue(fundOverallocatedTotal);
      summary.excludedSettlementTotal = roundCurrencyValue(excludedTotal);
      summary.settlementSources = sources;
      summary.totalPayout = summary.personalPayableTotal;
    }

    const unmatchedAllocation = Array.from(allocatedMinorBySourceAndFund.entries()).find(
      ([allocationKey, allocationsByFund]) => (
        !matchedSettlementAllocationKeys.has(allocationKey)
        && Array.from(allocationsByFund.values()).some((amountMinor) => amountMinor !== 0)
      ),
    );
    if (unmatchedAllocation) {
      const [allocationKey] = unmatchedAllocation;
      const identity = allocationIdentityByKey.get(allocationKey);
      const sourceDescription = identity?.componentId
        ? `compensation component #${identity.componentId}`
        : identity?.sourceKey ?? "unknown compensation source";
      const staffDescription = identity?.userId ? `staff member #${identity.userId}` : "a staff member";
      throw new HttpError(
        409,
        `A live Volunteer Fund allocation for ${sourceDescription} and ${staffDescription} no longer matches a calculated settlement source. Reconcile or reverse that allocation before continuing.`,
      );
    }

    const commissionUserIds = Array.from(commissionDataByUser.keys());
    const previousLedgerHistoryMap = new Map<number, StaffPayoutLedger[]>();
    const exactLedgerByUserId = new Map<number, StaffPayoutLedger>();
    const ledgerUserCreatedAtMap = new Map<number, Date>();
    if (isLedgerEligible && commissionUserIds.length > 0) {
      const previousLedgers = await StaffPayoutLedger.findAll({
        where: {
          staffUserId: {
            [Op.in]: commissionUserIds,
          },
          rangeEnd: {
            [Op.lt]: start.format("YYYY-MM-DD"),
          },
          rangeStart: {
            [Op.gte]: resolveStaffLedgerStartDate().format("YYYY-MM-DD"),
          },
        },
        order: [
          ["staff_user_id", "ASC"],
          ["range_end", "DESC"],
        ],
      });
      const ledgerUsers = await User.findAll({
        where: {
          id: {
            [Op.in]: commissionUserIds,
          },
        },
        attributes: ["id", "createdAt"],
      });
      const exactLedgers = await StaffPayoutLedger.findAll({
        where: {
          staffUserId: { [Op.in]: commissionUserIds },
          rangeStart: rangeStartIso,
          rangeEnd: rangeEndIso,
        },
        order: [["id", "DESC"]],
      });
      exactLedgers.forEach((ledger) => {
        if (!exactLedgerByUserId.has(ledger.staffUserId)) {
          exactLedgerByUserId.set(ledger.staffUserId, ledger);
        }
      });
      ledgerUsers.forEach((user) => {
        ledgerUserCreatedAtMap.set(user.id, user.createdAt);
      });

      previousLedgers.forEach((ledger) => {
        const history = previousLedgerHistoryMap.get(ledger.staffUserId) ?? [];
        history.push(ledger);
        previousLedgerHistoryMap.set(ledger.staffUserId, history);
      });
    }

    await Promise.all(
      Array.from(commissionDataByUser.entries()).map(async ([userId, summary]) => {
        const profile = profileByUserId.get(userId) ?? null;
        const collection =
          (profile?.staffProfileKey ? collectionMap.get(profile.staffProfileKey) : undefined) ?? {
            currency: resolvePayoutCurrency(),
            receivable: 0,
            payable: 0,
          };
        const payoutCurrency = (
          exactLedgerByUserId.get(userId)?.currencyCode
          ?? (profile?.staffProfileKey ? resolvePayoutCurrency() : collection.currency)
          ?? resolvePayoutCurrency()
        ).trim().toUpperCase();
        const payablePaidMinor = await loadCanonicalStaffPayablePaidMinor({
          staffUserId: userId,
          rangeStart: rangeStartIso,
          rangeEnd: rangeEndIso,
          currencyCode: payoutCurrency,
        });
        const payableDue = summary.totalPayout > 0 ? roundCurrencyValue(summary.totalPayout) : 0;
        const receivableDue = summary.totalPayout < 0
          ? roundCurrencyValue(Math.abs(summary.totalPayout))
          : 0;
        const payablePaid = roundCurrencyValue(payablePaidMinor / 100);
        summary.payouts = {
          currency: payoutCurrency,
          payableDue,
          payablePaid,
          payableOutstanding: roundCurrencyValue(Math.max(payableDue - payablePaid, 0)),
          receivableDue,
          receivableCollected: roundCurrencyValue(collection.receivable),
          receivableOutstanding: roundCurrencyValue(
            Math.max(receivableDue - collection.receivable, 0),
          ),
        };
      }),
    );

    const serializeOpeningBalanceLedger = (
      ledger: StaffPayoutLedger,
      amounts?: {
        openingBalance: number;
        closingBalance: number;
      },
    ): OpeningBalanceLedgerEntry => ({
      ledgerId: ledger.id,
      rangeStart: ledger.rangeStart,
      rangeEnd: ledger.rangeEnd,
      currency: ledger.currencyCode,
      openingBalance: amounts?.openingBalance ?? roundCurrencyValue(ledger.openingBalanceMinor / 100),
      dueAmount: roundCurrencyValue(ledger.dueAmountMinor / 100),
      paidAmount: roundCurrencyValue(ledger.paidAmountMinor / 100),
      closingBalance: amounts?.closingBalance ?? roundCurrencyValue(ledger.closingBalanceMinor / 100),
      createdAt: ledger.createdAt.toISOString(),
      updatedAt: ledger.updatedAt ? ledger.updatedAt.toISOString() : null,
    });

    const buildOpeningBalanceSource = (
      userId: number,
    ): { openingBalance: number; source: OpeningBalanceSource | null } => {
      const rawHistory = previousLedgerHistoryMap.get(userId) ?? [];
      if (rawHistory.length === 0) {
        return { openingBalance: 0, source: null };
      }

      const userCreatedAt = ledgerUserCreatedAtMap.get(userId);
      const latestLedgerByPeriod = new Map<string, StaffPayoutLedger>();
      rawHistory.forEach((ledger) => {
        const key = `${ledger.rangeStart}:${ledger.rangeEnd}`;
        const existing = latestLedgerByPeriod.get(key);
        if (!existing) {
          latestLedgerByPeriod.set(key, ledger);
          return;
        }
        const ledgerUpdatedAt = ledger.updatedAt ?? ledger.createdAt;
        const existingUpdatedAt = existing.updatedAt ?? existing.createdAt;
        if (
          ledgerUpdatedAt > existingUpdatedAt ||
          (ledgerUpdatedAt.getTime() === existingUpdatedAt.getTime() && ledger.id > existing.id)
        ) {
          latestLedgerByPeriod.set(key, ledger);
        }
      });

      const eligibleHistory = Array.from(latestLedgerByPeriod.values())
        .filter((ledger) => {
          if (!userCreatedAt) {
            return true;
          }
          return !dayjs(ledger.rangeEnd).endOf("day").isBefore(dayjs(userCreatedAt).startOf("day"));
        })
        .sort((left, right) => left.rangeEnd.localeCompare(right.rangeEnd));

      if (eligibleHistory.length === 0) {
        return { openingBalance: 0, source: null };
      }

      let runningBalance = 0;
      const computedHistory = eligibleHistory.map((ledger) => {
        const openingBalance = roundCurrencyValue(runningBalance);
        const dueAmount = roundCurrencyValue(ledger.dueAmountMinor / 100);
        const paidAmount = roundCurrencyValue(ledger.paidAmountMinor / 100);
        const closingBalance = roundCurrencyValue(openingBalance + dueAmount - paidAmount);
        runningBalance = closingBalance;
        return serializeOpeningBalanceLedger(ledger, { openingBalance, closingBalance });
      });
      const latest = computedHistory[computedHistory.length - 1];
      const latestLedger = eligibleHistory[eligibleHistory.length - 1];

      return {
        openingBalance: latest.closingBalance,
        source: {
          ...latest,
          sourceTable: "staff_payout_ledgers",
          staffUserId: latestLedger.staffUserId,
          history: [...computedHistory].reverse(),
        },
      };
    };

    const isClosedLedgerPeriod = isLedgerEligible
      && isStaffPayoutPeriodClosedInWarsaw(rangeEndIso);
    const settlementSnapshotForPersistenceByUserId = new Map<
      number,
      StaffPayoutSettlementSnapshot
    >();
    const refreshableClosedLedgerUserIds = new Set<number>();
    const allSummaries = Array.from(commissionDataByUser.values()).map((entry) => {
      const productBuckets = productBucketsByUser.get(entry.userId);
      const productTotals = productBuckets
        ? Array.from(productBuckets.values()).map((bucket) => ({
            productId: bucket.productId,
            productName: bucket.productName,
            counterIds: Array.from(bucket.counterIds.values()),
            totalCustomers: bucket.totalCustomers,
            totalCommission: Number(bucket.totalCommission.toFixed(2)),
            componentTotals: Array.from(bucket.componentTotals.entries()).map(([componentId, amount]) => ({
              componentId,
              amount: Number(amount.toFixed(2)),
            })),
          }))
        : [];
      const payouts = entry.payouts ?? {
        currency: resolvePayoutCurrency(),
        payableDue: 0,
        payablePaid: 0,
        payableOutstanding: 0,
        receivableDue: 0,
          receivableCollected: 0,
          receivableOutstanding: 0,
        };
      const openingBalanceResult = isLedgerEligible
        ? buildOpeningBalanceSource(entry.userId)
        : { openingBalance: 0, source: null };
      const openingBalance = openingBalanceResult.openingBalance;
      const openingBalanceSource = openingBalanceResult.source;
      const exactLedger = exactLedgerByUserId.get(entry.userId) ?? null;
      const currentSettlementSnapshot = buildStaffPayoutSettlementSnapshot(
        entry.settlementSources,
        rangeStartIso,
        rangeEndIso,
      );
      const canRefreshClosedSnapshot = Boolean(
        isClosedLedgerPeriod
        && exactLedger
        && canRefreshClosedSettlementSnapshot({
          canonicalPaidMinor: convertMajorUnitsToMinor(payouts.payablePaid ?? 0),
          liveFundAllocatedMinor: convertMajorUnitsToMinor(
            entry.volunteerFundAllocatedTotal ?? 0,
          ),
        }),
      );
      let settlementReconciliationRequired = false;
      let settlementReconciliationMessage: string | null = null;
      let authoritativeLegacyPresentation: LegacySettledPayoutSnapshotPresentation | null = null;
      if (isClosedLedgerPeriod && exactLedger) {
        if (canRefreshClosedSnapshot) {
          // A report snapshot is not a settlement by itself. If no personal
          // payment or live fund allocation exists, a corrected policy may
          // refresh the closed period's destination and personal due.
          refreshableClosedLedgerUserIds.add(entry.userId);
          settlementSnapshotForPersistenceByUserId.set(
            entry.userId,
            currentSettlementSnapshot,
          );
        } else {
          const rawStoredSnapshot = exactLedger.settlementSnapshot;
          const storedSnapshot = normalizeStaffPayoutSettlementSnapshot(rawStoredSnapshot, {
            rangeStart: rangeStartIso,
            rangeEnd: rangeEndIso,
          });
          const storedPersonalDueMinor = storedSnapshot
            ? storedSnapshot.sources
                .filter((source) => source.destination === "staff_vendor")
                .reduce((sum, source) => sum + source.grossAmountMinor, 0)
            : null;
          const authoritativeLegacySnapshot = resolveAuthoritativeLegacySettledPayoutSnapshot({
            settlementSnapshot: rawStoredSnapshot,
            rangeStart: rangeStartIso,
            rangeEnd: rangeEndIso,
            ledgerCurrency: exactLedger.currencyCode,
            dueAmountMinor: Number(exactLedger.dueAmountMinor),
            ledgerPaidAmountMinor: Number(exactLedger.paidAmountMinor),
            canonicalPaidAmountMinor: convertMajorUnitsToMinor(payouts.payablePaid ?? 0),
            liveFundAllocatedAmountMinor: convertMajorUnitsToMinor(
              entry.volunteerFundAllocatedTotal ?? 0,
            ),
          });
          if (authoritativeLegacySnapshot) {
            authoritativeLegacyPresentation = buildLegacySettledPayoutSnapshotPresentation(
              authoritativeLegacySnapshot,
              legacySettledPayoutComponentDefinitions,
              settlementFundNameById,
            );
          }
          const canInitializeLegacySnapshot = rawStoredSnapshot === null
            && convertMajorUnitsToMinor(entry.personalPayableTotal) === exactLedger.dueAmountMinor;
          // Effective-dated staff eligibility starts in August 2026. For an
          // earlier period that is valid and fully paid in both ledgers, the
          // immutable v1 snapshot is the read authority. When that presentation
          // exists, both mutation and mismatch branches below are skipped: the
          // snapshot is never rewritten and no new settlement intent is minted.
          if (!authoritativeLegacyPresentation && canInitializeLegacySnapshot) {
            // Ledgers created before source snapshots existed can be adopted only
            // when the recomputed personal liability still equals the frozen due.
            settlementSnapshotForPersistenceByUserId.set(
              entry.userId,
              currentSettlementSnapshot,
            );
          } else if (
            !authoritativeLegacyPresentation
            && (
              !storedSnapshot
              || !staffPayoutSettlementSnapshotsMatch(storedSnapshot, currentSettlementSnapshot, {
                rangeStart: rangeStartIso,
                rangeEnd: rangeEndIso,
              })
              || storedPersonalDueMinor !== exactLedger.dueAmountMinor
            )
          ) {
            settlementReconciliationRequired = true;
            settlementReconciliationMessage =
              "This closed period's source breakdown no longer matches its saved payout ledger. Reconcile the historical breakdown before processing more compensation.";
          }
        }
      } else {
        // Open periods remain provisional. Save their current per-source
        // authority so the first report after month close can detect drift.
        settlementSnapshotForPersistenceByUserId.set(
          entry.userId,
          currentSettlementSnapshot,
        );
      }
      const periodDueAmount = isClosedLedgerPeriod && exactLedger && !canRefreshClosedSnapshot
        ? roundCurrencyValue(exactLedger.dueAmountMinor / 100)
        : Number(entry.totalPayout.toFixed(2));
      const periodPaidAmount = roundCurrencyValue(payouts.payablePaid ?? 0);
      const closingBalance = isLedgerEligible
        ? roundCurrencyValue(openingBalance + periodDueAmount - periodPaidAmount)
        : roundCurrencyValue(periodDueAmount - periodPaidAmount);

      return {
        ...entry,
        totalCommission: Number(
          (authoritativeLegacyPresentation?.totalCommission ?? entry.totalCommission).toFixed(2),
        ),
        totalCustomers: entry.totalCustomers,
        breakdown: entry.breakdown.map((item) => ({
          ...item,
          commission: Number(item.commission.toFixed(2)),
        })),
        componentTotals: (
          authoritativeLegacyPresentation?.componentTotals ?? entry.componentTotals
        ).map((component) => ({
          ...component,
          amount: Number(component.amount.toFixed(2)),
        })),
        bucketTotals: Object.fromEntries(
          Object.entries(
            authoritativeLegacyPresentation?.bucketTotals ?? entry.bucketTotals,
          ).map(([key, value]) => [key, Number(value.toFixed(2))]),
        ),
        grossBucketTotals: Object.fromEntries(
          Object.entries(
            authoritativeLegacyPresentation?.grossBucketTotals ?? entry.grossBucketTotals,
          ).map(([key, value]) => [key, Number(value.toFixed(2))]),
        ),
        fundBucketTotals: Object.fromEntries(
          Object.entries(
            authoritativeLegacyPresentation?.fundBucketTotals ?? entry.fundBucketTotals,
          ).map(([key, value]) => [key, Number(value.toFixed(2))]),
        ),
        totalPayout: periodDueAmount,
        grossCompensationTotal: Number(
          (
            authoritativeLegacyPresentation?.grossCompensationTotal
            ?? entry.grossCompensationTotal
          ).toFixed(2),
        ),
        personalPayableTotal: authoritativeLegacyPresentation
          ? Number(authoritativeLegacyPresentation.personalPayableTotal.toFixed(2))
          : isClosedLedgerPeriod && exactLedger
            ? periodDueAmount
            : Number(entry.personalPayableTotal.toFixed(2)),
        volunteerFundAllocationTotal: Number(
          (
            authoritativeLegacyPresentation?.volunteerFundAllocationTotal
            ?? entry.volunteerFundAllocationTotal
          ).toFixed(2),
        ),
        volunteerFundAllocatedTotal: Number(
          (
            authoritativeLegacyPresentation?.volunteerFundAllocatedTotal
            ?? entry.volunteerFundAllocatedTotal
          ).toFixed(2),
        ),
        volunteerFundOutstandingTotal: Number(
          (
            authoritativeLegacyPresentation?.volunteerFundOutstandingTotal
            ?? entry.volunteerFundOutstandingTotal
          ).toFixed(2),
        ),
        volunteerFundOverallocatedTotal: Number(
          (
            authoritativeLegacyPresentation?.volunteerFundOverallocatedTotal
            ?? entry.volunteerFundOverallocatedTotal
          ).toFixed(2),
        ),
        excludedSettlementTotal: Number(
          (
            authoritativeLegacyPresentation?.excludedSettlementTotal
            ?? entry.excludedSettlementTotal
          ).toFixed(2),
        ),
        settlementSources: (
          authoritativeLegacyPresentation?.settlementSources ?? entry.settlementSources
        ).map((source) => ({
          ...source,
          settlementIntent: settlementReconciliationRequired
            ? null
            : source.settlementIntent,
          amount: Number(source.amount.toFixed(2)),
          settledAmount: Number(source.settledAmount.toFixed(2)),
          allocatedAmount: Number(source.allocatedAmount.toFixed(2)),
          outstandingAmount: Number(source.outstandingAmount.toFixed(2)),
          overallocatedAmount: Number(source.overallocatedAmount.toFixed(2)),
        })),
        settlementReconciliationRequired,
        settlementReconciliationMessage,
        productTotals,
        counterIncentiveDetails: Object.fromEntries(
          Object.entries(entry.counterIncentiveDetails ?? {}).map(([counterId, details]) => [
            counterId,
            details.map((detail) => ({
              ...detail,
              amount: Number(detail.amount.toFixed(2)),
            })),
          ]),
        ),
        reviewTotals: entry.reviewTotals,
        platformGuestTotals: entry.platformGuestTotals,
        platformGuestBreakdowns: Object.fromEntries(
          Object.entries(entry.platformGuestBreakdowns ?? {}).map(([componentId, tiers]) => [
            componentId,
            tiers.map((tier) => ({
              ...tier,
              amount: Number(tier.amount.toFixed(2)),
            })),
          ]),
        ),
        lockedComponents: entry.lockedComponents.map((locked) => ({
          ...locked,
          amount: Number(locked.amount.toFixed(2)),
        })),
        payouts: {
          currency: payouts.currency ?? resolvePayoutCurrency(),
          payableDue: periodDueAmount > 0 ? periodDueAmount : 0,
          payablePaid: roundCurrencyValue(payouts.payablePaid ?? 0),
          payableOutstanding: roundCurrencyValue(
            Math.max((periodDueAmount > 0 ? periodDueAmount : 0) - (payouts.payablePaid ?? 0), 0),
          ),
          receivableDue: roundCurrencyValue(payouts.receivableDue ?? 0),
          receivableCollected: roundCurrencyValue(payouts.receivableCollected ?? 0),
          receivableOutstanding: roundCurrencyValue(payouts.receivableOutstanding ?? 0),
        },
        openingBalance,
        openingBalanceSource,
        closingBalance,
        range: {
          startDate: rangeStartIso,
          endDate: rangeEndIso,
        },
        dueAmount: periodDueAmount,
        paidAmount: periodPaidAmount,
        rangeIsCanonical: isCanonicalRange,
        paidEntries: (entry.paidEntries ?? []).map((paidEntry) => ({
          ...paidEntry,
          amount: roundCurrencyValue(paidEntry.amount),
        })),
      };
    });

    const reconciliationUserIds = allSummaries
      .filter((entry) => entry.settlementReconciliationRequired)
      .map((entry) => entry.userId);
    const recoverableInterruptedBatches = reconciliationUserIds.length > 0
      ? await findRecoverableInterruptedPayoutBatches({
          staffUserIds: reconciliationUserIds,
          rangeStart: rangeStartIso,
          rangeEnd: rangeEndIso,
        })
      : new Map<number, string[]>();
    const summariesWithRecoveryState = allSummaries.map((entry) => ({
      ...entry,
      interruptedSettlementRecoveryAvailable:
        (recoverableInterruptedBatches.get(entry.userId)?.length ?? 0) > 0,
    }));

    const data = shouldLimitToSelf
      ? requesterId === null
        ? []
        : summariesWithRecoveryState.filter((entry) => entry.userId === requesterId)
      : summariesWithRecoveryState;

    // Self-service views must never refresh or create payout ledgers for other
    // staff members. The configured module permission is resolved by route
    // middleware before this expensive report starts.
    const summariesForPersistence = shouldLimitToSelf ? data : summariesWithRecoveryState;

    if (isLedgerEligible && summariesForPersistence.length > 0) {
      await Promise.all(
        summariesForPersistence.map((summary) => sequelize.transaction(async (transaction) => {
          // Serialize report writers for a user, then validate and lock their
          // existing carry chain before changing due/snapshot authority.
          await User.findByPk(summary.userId, {
            attributes: ["id"],
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          await reconcilePersistedStaffPayoutLedgers({
            staffUserId: summary.userId,
            affectedRangeStart: rangeStartIso,
            affectedRangeEnd: rangeEndIso,
            transaction,
          });

          const where = {
            staffUserId: summary.userId,
            rangeStart: rangeStartIso,
            rangeEnd: rangeEndIso,
          };
          const existing = await StaffPayoutLedger.findOne({
            where,
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          const settlementSnapshot =
            settlementSnapshotForPersistenceByUserId.get(summary.userId) ?? null;
          if (existing) {
            if (isClosedLedgerPeriod) {
              if (refreshableClosedLedgerUserIds.has(summary.userId)) {
                // The report calculation happened before this transaction. A
                // competing staff payout or fund allocation may have committed
                // in between. Payout/allocation writers take the same User lock,
                // and allocation rows are locked here before we decide that the
                // historical snapshot is still provisional.
                const lockedAllocationRows = await VolunteerFundEntry.findAll({
                  attributes: ["id", "amountMinor"],
                  where: {
                    entryType: "allocation",
                    attributedStaffUserId: summary.userId,
                    periodStart: rangeStartIso,
                    periodEnd: rangeEndIso,
                  },
                  transaction,
                  lock: transaction.LOCK.UPDATE,
                });
                const lockedAllocationIds = lockedAllocationRows.map((entry) => entry.id);
                const lockedAllocationReversals = lockedAllocationIds.length > 0
                  ? await VolunteerFundEntry.findAll({
                      attributes: ["amountMinor"],
                      where: {
                        entryType: "reversal",
                        reversalOfEntryId: { [Op.in]: lockedAllocationIds },
                      },
                      transaction,
                      lock: transaction.LOCK.UPDATE,
                    })
                  : [];
                const lockedLiveFundAllocatedMinor = [
                  ...lockedAllocationRows,
                  ...lockedAllocationReversals,
                ].reduce((sum, entry) => sum + Number(entry.amountMinor), 0);
                if (!canRefreshClosedSettlementSnapshot({
                  canonicalPaidMinor: Number(existing.paidAmountMinor),
                  liveFundAllocatedMinor: lockedLiveFundAllocatedMinor,
                })) {
                  throw new HttpError(
                    409,
                    "This closed payout period was settled while Pays was refreshing. Refresh Pays before continuing.",
                  );
                }
                await existing.update({
                  currencyCode: summary.payouts?.currency ?? resolvePayoutCurrency(),
                  dueAmountMinor: convertMajorUnitsToMinor(summary.dueAmount ?? 0),
                  settlementSnapshot,
                }, { transaction });
              } else if (settlementSnapshotForPersistenceByUserId.has(summary.userId)) {
                await existing.update({ settlementSnapshot }, { transaction });
              }
            } else {
              await existing.update({
                currencyCode: summary.payouts?.currency ?? resolvePayoutCurrency(),
                dueAmountMinor: convertMajorUnitsToMinor(summary.dueAmount ?? 0),
                settlementSnapshot,
              }, { transaction });
            }
          } else {
            await StaffPayoutLedger.create({
              ...where,
              currencyCode: summary.payouts?.currency ?? resolvePayoutCurrency(),
              openingBalanceMinor: 0,
              dueAmountMinor: convertMajorUnitsToMinor(summary.dueAmount ?? 0),
              paidAmountMinor: 0,
              closingBalanceMinor: 0,
              settlementSnapshot,
            }, { transaction });
          }

          // Canonical paid is the final writer in the same transaction. Any
          // failure rolls back the report's due/snapshot write as well.
          await reconcilePersistedStaffPayoutLedgers({
            staffUserId: summary.userId,
            affectedRangeStart: rangeStartIso,
            affectedRangeEnd: rangeEndIso,
            transaction,
          });
        })),
      );
    }

    res.status(200).json([{
      data,
      columns: [],
      accessScope: shouldLimitToSelf ? "self" : "all",
    }]);
  } catch (error) {
    console.error("Error:", error);
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    res.status(500).json([{ message: "Internal server error" }]);
  }
};

const parseStaffPayoutReceiptId = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const serializeReceiptDateTime = (value: Date | string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.toISOString() : null;
};

const formatReceiptStaffName = (user: User | null): string => {
  if (!user) {
    return "Unknown staff member";
  }
  const name = [user.firstName, user.lastName]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join(" ");
  return name || `Staff #${user.id}`;
};

const parseStaffPayoutReceiptHistoryDate = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  const parsed = dayjs(normalized);
  return parsed.isValid() && parsed.format("YYYY-MM-DD") === normalized ? normalized : null;
};

const getReceiptHistoryBatchGroupKey = (receipt: StaffPayoutReceipt): string => {
  const batchKey = typeof receipt.payoutBatchKey === "string" ? receipt.payoutBatchKey.trim() : "";
  return batchKey || `receipt:${receipt.id}`;
};

const setSensitiveReceiptResponseHeaders = (res: Response): void => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
};

export const listStaffPayoutReceiptHistory = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  setSensitiveReceiptResponseHeaders(res);
  try {
    const batchKey = typeof req.query.batchKey === "string" ? req.query.batchKey.trim() : "";
    if (batchKey.length > 128) {
      res.status(400).json([{ message: "Payout batch key must be 128 characters or fewer." }]);
      return;
    }

    const staffUserIdRaw = req.query.staffUserId;
    const staffUserId = staffUserIdRaw === undefined
      ? null
      : parseStaffPayoutReceiptId(staffUserIdRaw);
    if (staffUserIdRaw !== undefined && !staffUserId) {
      res.status(400).json([{ message: "A valid staffUserId is required." }]);
      return;
    }

    const where: WhereOptions = {};
    if (batchKey) {
      Object.assign(where, { payoutBatchKey: batchKey });
      if (staffUserId) {
        Object.assign(where, { staffUserId });
      }
    } else {
      const startDate = parseStaffPayoutReceiptHistoryDate(req.query.startDate);
      const endDate = parseStaffPayoutReceiptHistoryDate(req.query.endDate);
      if (!staffUserId || !startDate || !endDate) {
        res.status(400).json([{
          message: "Provide a batchKey, or provide staffUserId with valid startDate and endDate values.",
        }]);
        return;
      }
      if (dayjs(startDate).isAfter(dayjs(endDate), "day")) {
        res.status(400).json([{ message: "startDate cannot be after endDate." }]);
        return;
      }
      Object.assign(where, {
        staffUserId,
        rangeStart: { [Op.lte]: endDate },
        rangeEnd: { [Op.gte]: startDate },
      });
    }

    const receipts = await StaffPayoutReceipt.findAll({
      attributes: [
        "id",
        "staffUserId",
        "payoutBatchKey",
        "status",
        "rangeStart",
        "rangeEnd",
        "paidDate",
        "paidByName",
        "confirmedAt",
        "cancelledAt",
        "cancelReason",
        "photoFileId",
        "signatureFileId",
        "createdAt",
      ],
      where,
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"],
      ],
    });

    const receiptIds = receipts.map((receipt) => receipt.id);
    const staffUserIds = Array.from(new Set(receipts.map((receipt) => receipt.staffUserId)));
    const [items, staffUsers] = await Promise.all([
      receiptIds.length > 0
        ? StaffPayoutReceiptItem.findAll({
            attributes: ["receiptId", "amountMinor", "currencyCode"],
            where: { receiptId: { [Op.in]: receiptIds } },
            order: [["id", "ASC"]],
          })
        : Promise.resolve([] as StaffPayoutReceiptItem[]),
      staffUserIds.length > 0
        ? User.findAll({
            attributes: ["id", "firstName", "lastName"],
            where: { id: { [Op.in]: staffUserIds } },
          })
        : Promise.resolve([] as User[]),
    ]);

    const itemsByReceiptId = new Map<number, StaffPayoutReceiptItem[]>();
    items.forEach((item) => {
      const receiptItems = itemsByReceiptId.get(item.receiptId) ?? [];
      receiptItems.push(item);
      itemsByReceiptId.set(item.receiptId, receiptItems);
    });
    const staffUsersById = new Map(staffUsers.map((user) => [user.id, user]));

    const currentReceiptIdByBatch = new Map<string, number>();
    receipts.forEach((receipt) => {
      if (receipt.status !== "pending" && receipt.status !== "completed") {
        return;
      }
      const groupKey = getReceiptHistoryBatchGroupKey(receipt);
      if (!currentReceiptIdByBatch.has(groupKey)) {
        currentReceiptIdByBatch.set(groupKey, receipt.id);
      }
    });
    receipts.forEach((receipt) => {
      const groupKey = getReceiptHistoryBatchGroupKey(receipt);
      if (!currentReceiptIdByBatch.has(groupKey)) {
        currentReceiptIdByBatch.set(groupKey, receipt.id);
      }
    });

    res.status(200).json({
      receipts: receipts.map((receipt) => {
        const receiptItems = itemsByReceiptId.get(receipt.id) ?? [];
        const createdAtValue = receipt.get("createdAt") as Date | string | null | undefined;
        return {
          id: receipt.id,
          status: receipt.status,
          staffUserId: receipt.staffUserId,
          staffName: formatReceiptStaffName(staffUsersById.get(receipt.staffUserId) ?? null),
          payoutBatchKey: receipt.payoutBatchKey ?? null,
          rangeStart: receipt.rangeStart,
          rangeEnd: receipt.rangeEnd,
          paidDate: receipt.paidDate,
          paidByName: receipt.paidByName,
          confirmedAt: serializeReceiptDateTime(receipt.confirmedAt),
          cancelledAt: serializeReceiptDateTime(receipt.cancelledAt),
          cancelReason: receipt.cancelReason ?? null,
          createdAt: serializeReceiptDateTime(createdAtValue),
          totals: buildStaffPayoutReceiptTotals(receiptItems),
          itemCount: receiptItems.length,
          hasPhoto: Boolean(receipt.photoFileId),
          hasSignature: Boolean(receipt.signatureFileId),
          isCurrent: currentReceiptIdByBatch.get(getReceiptHistoryBatchGroupKey(receipt)) === receipt.id,
        };
      }),
      hasMore: false,
    });
  } catch (error) {
    console.error("Failed to load staff payout receipt history", error);
    res.status(500).json([{ message: "Failed to load payout receipt history." }]);
  }
};

export const getStaffPayoutReceiptDetail = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  setSensitiveReceiptResponseHeaders(res);
  try {
    const receiptId = parseStaffPayoutReceiptId(req.params.id);
    if (!receiptId) {
      res.status(400).json([{ message: "A valid payout receipt id is required." }]);
      return;
    }

    const receipt = await StaffPayoutReceipt.findByPk(receiptId);
    if (!receipt) {
      res.status(404).json([{ message: "Payout receipt not found." }]);
      return;
    }

    const [items, staffUser] = await Promise.all([
      StaffPayoutReceiptItem.findAll({
        where: { receiptId },
        order: [["id", "ASC"]],
      }),
      User.findByPk(receipt.staffUserId, {
        attributes: ["id", "firstName", "lastName"],
      }),
    ]);

    const createdAtValue = receipt.get("createdAt") as Date | string | null | undefined;
    res.status(200).json({
      id: receipt.id,
      status: receipt.status,
      staffUserId: receipt.staffUserId,
      staffName: formatReceiptStaffName(staffUser),
      payoutBatchKey: receipt.payoutBatchKey ?? null,
      rangeStart: receipt.rangeStart,
      rangeEnd: receipt.rangeEnd,
      paidDate: receipt.paidDate,
      paidByName: receipt.paidByName,
      acceptanceText: receipt.acceptanceText,
      acceptanceVersion: receipt.acceptanceVersion,
      confirmedAt: serializeReceiptDateTime(receipt.confirmedAt),
      cancelledAt: serializeReceiptDateTime(receipt.cancelledAt),
      cancelReason: receipt.cancelReason ?? null,
      createdAt: serializeReceiptDateTime(createdAtValue),
      totals: buildStaffPayoutReceiptTotals(items),
      items: items.map((item) => ({
        id: item.id,
        collectionLogId: item.collectionLogId ?? item.collectionLogIdSnapshot,
        financeTransactionId: item.financeTransactionId ?? item.financeTransactionIdSnapshot,
        label: item.label,
        amountMinor: item.amountMinor,
        amount: item.amountMinor / 100,
        currency: item.currencyCode.trim().toUpperCase(),
      })),
      hasPhoto: Boolean(receipt.photoFileId),
      hasSignature: Boolean(receipt.signatureFileId),
    });
  } catch (error) {
    console.error("Failed to load staff payout receipt", error);
    res.status(500).json([{ message: "Failed to load payout receipt." }]);
  }
};

const streamStaffPayoutReceiptEvidence = async (
  req: AuthenticatedRequest,
  res: Response,
  kind: "photo" | "signature",
): Promise<void> => {
  setSensitiveReceiptResponseHeaders(res);
  try {
    const receiptId = parseStaffPayoutReceiptId(req.params.id);
    if (!receiptId) {
      res.status(400).json([{ message: "A valid payout receipt id is required." }]);
      return;
    }

    const receipt = await StaffPayoutReceipt.findByPk(receiptId, {
      attributes: ["id", "photoFileId", "signatureFileId"],
    });
    if (!receipt) {
      res.status(404).json([{ message: "Payout receipt not found." }]);
      return;
    }

    const fileId = kind === "photo" ? receipt.photoFileId : receipt.signatureFileId;
    if (!fileId) {
      res.status(404).json([{ message: `Payout receipt ${kind} not found.` }]);
      return;
    }
    const file = await FinanceFile.findOne({
      where: { id: fileId, purpose: "staff_payout_receipt" },
    });
    if (!file) {
      res.status(404).json([{ message: `Payout receipt ${kind} file not found.` }]);
      return;
    }

    const stream = await openFinanceFileStream(file.driveFileId);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const maxEvidenceBytes = 10 * 1024 * 1024;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxEvidenceBytes) {
        stream.destroy();
        throw new Error(`Stored payout receipt ${kind} exceeds the evidence size limit.`);
      }
      chunks.push(buffer);
    }
    const evidence = Buffer.concat(chunks, totalBytes);
    const digest = crypto.createHash("sha256").update(evidence).digest("hex");
    if (digest !== file.sha256 || evidence.length !== Number(file.sizeBytes)) {
      throw new Error(`Stored payout receipt ${kind} failed its integrity check.`);
    }

    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.originalName)}"`);
    res.setHeader("Content-Length", String(evidence.length));
    res.status(200).send(evidence);
  } catch (error) {
    console.error(`Failed to load payout receipt ${kind}`, error);
    if (!res.headersSent) {
      res.status(500).json([{ message: `Failed to load payout receipt ${kind}.` }]);
    }
  }
};

export const downloadStaffPayoutReceiptPhoto = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => streamStaffPayoutReceiptEvidence(req, res, "photo");

export const downloadStaffPayoutReceiptSignature = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => streamStaffPayoutReceiptEvidence(req, res, "signature");

export const listReportModels = (_req: Request, res: Response): void => {
  try {
    modelDescriptorCache.clear();
    const models = Object.values(sequelize.models) as Array<ModelCtor<Model>>;
    const payload = models
      .filter((model) => !isSensitiveReportModel(model.name))
      .map(describeModel)
      .sort((a, b) => a.name.localeCompare(b.name));

    res.status(200).json({ models: payload });
  } catch (error) {
    console.error("Failed to enumerate report models", error);
    res.status(500).json({ message: "Unable to enumerate data models" });
  }
};

const resolveQueryConfigModels = (config: QueryConfig): string[] => {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const addModel = (modelId: unknown) => {
    if (typeof modelId !== "string") {
      return;
    }
    const trimmed = modelId.trim();
    if (!trimmed || trimmed === DERIVED_FIELD_SENTINEL) {
      return;
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      ordered.push(trimmed);
    }
  };

  const baseModels = Array.isArray(config.models) ? config.models : [];
  baseModels.forEach(addModel);
  (config.select ?? []).forEach((entry) => addModel(entry?.modelId));
  (config.metrics ?? []).forEach((entry) => addModel(entry?.modelId));
  (config.dimensions ?? []).forEach((entry) => addModel(entry?.modelId));
  (config.filters ?? []).forEach((entry) => addModel(entry?.modelId));

  return ordered;
};

const normalizeColumnType = (raw: string | null | undefined): string | null => {
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  if (
    normalized.includes("int") ||
    normalized.includes("numeric") ||
    normalized.includes("decimal") ||
    normalized.includes("double") ||
    normalized.includes("real") ||
    normalized.includes("float")
  ) {
    return "number";
  }
  if (normalized.includes("bool")) {
    return "boolean";
  }
  if (normalized.includes("date") || normalized.includes("time")) {
    return "date";
  }
  if (
    normalized.includes("char") ||
    normalized.includes("text") ||
    normalized.includes("uuid") ||
    normalized.includes("json")
  ) {
    return "string";
  }
  return null;
};

const normalizeSelectQueryConfig = (config: QueryConfig): ReportPreviewRequest => {
  if (!config || typeof config !== "object") {
    throw new PreviewQueryError("Invalid query payload.");
  }

  const selectEntries = Array.isArray(config.select) ? config.select : [];
  if (selectEntries.length === 0) {
    throw new PreviewQueryError("Select at least one field for your query.");
  }

  const groupedFields = new Map<string, Set<string>>();
  selectEntries.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const { modelId, fieldId } = entry;
    if (typeof modelId !== "string" || typeof fieldId !== "string") {
      return;
    }
    if (!groupedFields.has(modelId)) {
      groupedFields.set(modelId, new Set<string>());
    }
    groupedFields.get(modelId)!.add(fieldId);
  });

  if (groupedFields.size === 0) {
    throw new PreviewQueryError("Unable to determine any valid fields to query.");
  }

  const resolvedModels = resolveQueryConfigModels(config);
  const dedupedModels = new Set(resolvedModels);

  groupedFields.forEach((_fields, modelId) => {
    if (typeof modelId === "string" && modelId.trim().length > 0) {
      dedupedModels.add(modelId.trim());
    }
  });

  if (dedupedModels.size === 0) {
    throw new PreviewQueryError("At least one data model is required.");
  }

  const fields = Array.from(groupedFields.entries()).map(([modelId, fieldSet]) => ({
    modelId,
    fieldIds: Array.from(fieldSet),
  }));

  const joins = Array.isArray(config.joins) ? config.joins : [];

  return {
    models: Array.from(dedupedModels),
    fields,
    joins,
    filters: [],
    limit: config.limit,
    derivedFields:
      Array.isArray(config.derivedFields) && config.derivedFields.length > 0
        ? config.derivedFields
        : undefined,
  };
};

const assertNoSensitiveReportModelReferences = (value: unknown): void => {
  const blockedModels = listSensitiveReportModelReferences(value);
  if (blockedModels.length > 0) {
    throw new PreviewQueryError(
      `The following models are available only through their dedicated restricted endpoints: ${blockedModels.join(", ")}.`,
      403,
    );
  }
};

export const executePreviewQuery = async (
  payload: ReportPreviewRequest,
): Promise<{ result: ReportPreviewResponse; sql: string; meta: Record<string, unknown> }> => {
  assertNoSensitiveReportModelReferences(payload);
  if (!payload || !Array.isArray(payload.models) || payload.models.length === 0) {
    throw new PreviewQueryError("At least one data model is required.");
  }

  const requestedFields =
    payload.fields?.filter((entry) => Array.isArray(entry.fieldIds) && entry.fieldIds.length > 0) ?? [];

  if (requestedFields.length === 0) {
    throw new PreviewQueryError("Select at least one field across your models.");
  }

  const aliasMap = new Map<string, string>();
  payload.models.forEach((modelId, index) => {
    aliasMap.set(modelId, `m${index}`);
  });

  const derivedFieldPayloads = Array.isArray(payload.derivedFields) ? payload.derivedFields : [];
  validateDerivedFieldGraph(derivedFieldPayloads, payload.models, payload.joins ?? [], aliasMap);
  const derivedFieldLookup = new Map<string, DerivedFieldQueryPayload>(
    derivedFieldPayloads.map((field) => [field.id, field]),
  );

  const previewGrouping = toPreviewGroupingRules(payload.grouping);
  const previewAggregations = toPreviewAggregationRules(payload.aggregations);
  const previewHaving = toPreviewHavingRules(payload.having);
  const isAggregatedPreview = previewGrouping.length > 0 || previewAggregations.length > 0;

  const selectClauses: string[] = [];
  const selectedAliases = new Set<string>();
  const groupByClauses: string[] = [];
  const aggregationAliasLookup = new Map<string, string>();

  if (!isAggregatedPreview) {
    requestedFields.forEach((entry) => {
      const descriptor = ensureModelDescriptor(entry.modelId);
      const alias = aliasMap.get(entry.modelId);
      if (!descriptor || !alias) {
        return;
      }

      entry.fieldIds.forEach((fieldId) => {
        const field = descriptor.fields.find((candidate) => candidate.fieldName === fieldId);
        if (!field) {
          return;
        }
        const selectAlias = `${descriptor.id}__${field.fieldName}`;
        if (selectedAliases.has(selectAlias)) {
          return;
        }
        selectedAliases.add(selectAlias);
        selectClauses.push(
          `${alias}.${quoteIdentifier(field.columnName)} AS ${quoteIdentifier(selectAlias)}`,
        );
      });
    });

    if (selectClauses.length === 0) {
      throw new PreviewQueryError("Unable to determine any valid fields to query.");
    }

    derivedFieldPayloads.forEach((field, index) => {
      try {
        const { clause, alias } = buildDerivedFieldSelectClause(field, aliasMap, index);
        selectClauses.push(clause);
        selectedAliases.add(alias);
      } catch (error) {
        if (error instanceof PreviewQueryError) {
          throw error;
        }
        throw new PreviewQueryError(
          `Derived field ${field.id || `#${index + 1}`} could not be processed.`,
        );
      }
    });
  }

  const applyDateBucket = (expression: string, bucket?: PreviewGroupingRule["bucket"]) => {
    if (!bucket) {
      return expression;
    }
    const normalizedBucket = bucket.toLowerCase();
    if (!PREVIEW_BUCKETS.has(normalizedBucket)) {
      throw new PreviewQueryError(`Unsupported time bucket: ${bucket}`);
    }
    return `date_trunc('${normalizedBucket}', ${expression})`;
  };

  if (previewGrouping.length > 0) {
    previewGrouping.forEach((group, index) => {
      let expression: string | null = null;
      let aliasValue: string | null = null;
      if (group.source === "derived") {
        const derivedField = derivedFieldLookup.get(group.fieldId);
        if (!derivedField || !derivedField.expressionAst) {
          throw new PreviewQueryError(
            `Derived field ${group.fieldId || `#${index + 1}`} is not available for grouping.`,
          );
        }
        expression = renderDerivedFieldExpressionSql(derivedField.expressionAst, aliasMap);
        aliasValue = group.bucket
          ? `${derivedField.id}_${group.bucket}`
          : derivedField.id ?? `derived_group_${index}`;
      } else {
        const modelId = group.modelId ?? "";
        const descriptor = ensureModelDescriptor(modelId);
        const alias = aliasMap.get(modelId);
        if (!descriptor || !alias) {
          throw new PreviewQueryError(`Model ${modelId} is not available for grouping.`);
        }
        const field = descriptor.fields.find((candidate) => candidate.fieldName === group.fieldId);
        if (!field) {
          throw new PreviewQueryError(
            `Field ${group.fieldId} is not available on model ${modelId}.`,
          );
        }
        const baseExpression = `${alias}.${quoteIdentifier(field.columnName)}`;
        expression = applyDateBucket(baseExpression, group.bucket ?? undefined);
        aliasValue =
          group.bucket && group.bucket.length > 0
            ? `${descriptor.id}__${field.fieldName}_${group.bucket}`
            : `${descriptor.id}__${field.fieldName}`;
      }
      if (!expression || !aliasValue) {
        return;
      }
      selectClauses.push(`${expression} AS ${quoteIdentifier(aliasValue)}`);
      groupByClauses.push(expression);
      selectedAliases.add(aliasValue);
    });
  }

  if (previewAggregations.length > 0) {
    const aggregationMap: Record<PreviewAggregationClausePayload["aggregation"], string> = {
      sum: "SUM",
      avg: "AVG",
      min: "MIN",
      max: "MAX",
      count: "COUNT",
      count_distinct: "COUNT",
    };
    previewAggregations.forEach((aggregation, index) => {
      const sqlAggregation = aggregationMap[aggregation.aggregation] ?? "SUM";
      let expression: string | null = null;
      if (aggregation.source === "derived") {
        const derivedField = derivedFieldLookup.get(aggregation.fieldId);
        if (!derivedField || !derivedField.expressionAst) {
          throw new PreviewQueryError(
            `Derived field ${aggregation.fieldId || `#${index + 1}`} is not available for aggregations.`,
          );
        }
        expression = renderDerivedFieldExpressionSql(derivedField.expressionAst, aliasMap);
      } else {
        const modelId = aggregation.modelId ?? "";
        const descriptor = ensureModelDescriptor(modelId);
        const alias = aliasMap.get(modelId);
        if (!descriptor || !alias) {
          throw new PreviewQueryError(`Model ${modelId} is not available for aggregations.`);
        }
        const field = descriptor.fields.find((candidate) => candidate.fieldName === aggregation.fieldId);
        if (!field) {
          throw new PreviewQueryError(
            `Field ${aggregation.fieldId} is not available on model ${modelId}.`,
          );
        }
        expression = `${alias}.${quoteIdentifier(field.columnName)}`;
      }
      if (!expression) {
        return;
      }
      const aliasValue =
        aggregation.alias && aggregation.alias.trim().length > 0
          ? aggregation.alias.trim()
          : `${aggregation.id || aggregation.fieldId}_${aggregation.aggregation}_${index}`;
      const aggregationExpression =
        aggregation.aggregation === "count_distinct"
          ? `${sqlAggregation}(DISTINCT (${expression}))`
          : `${sqlAggregation}(${expression})`;
      selectClauses.push(`${aggregationExpression} AS ${quoteIdentifier(aliasValue)}`);
      selectedAliases.add(aliasValue);
      aggregationAliasLookup.set(aggregation.id, aliasValue);
    });
  }

  if (isAggregatedPreview && selectClauses.length === 0) {
    throw new PreviewQueryError(
      "Grouping or aggregation is required to build the preview. Add at least one grouping or aggregation rule.",
    );
  }

  const baseModelId = payload.models[0];
  const baseDescriptor = ensureModelDescriptor(baseModelId);
  const baseAlias = aliasMap.get(baseModelId)!;
  if (!baseDescriptor) {
    throw new PreviewQueryError(`Model ${baseModelId} is not available.`);
  }

  const fromClause = buildFromClause(baseDescriptor, baseAlias);
  const { clauses: joinClauses, joinedModels, unresolvedJoins } = buildJoinClauses(
    payload.joins ?? [],
    aliasMap,
    baseModelId,
  );

  if (unresolvedJoins.length > 0) {
    throw new PreviewQueryError("Some models could not be joined. Verify your join configuration.", 400, unresolvedJoins);
  }

  const unjoinedModels = payload.models.filter(
    (modelId) => modelId !== baseModelId && !joinedModels.has(modelId),
  );

  if (unjoinedModels.length > 0) {
    throw new PreviewQueryError("Some selected models are not connected to the base model.", 400, unjoinedModels);
  }

  validateDerivedFieldJoinCoverage(derivedFieldPayloads, joinedModels);

  const whereClauses = buildWhereClauses(payload.filters ?? [], aliasMap, derivedFieldLookup);
  const orderByClauses = buildOrderByClauses(payload.orderBy ?? [], aliasMap, derivedFieldLookup);
  const havingClauses = buildHavingClauses(previewHaving, aggregationAliasLookup);

  const sqlParts = [
    `SELECT ${selectClauses.join(", ")}`,
    `FROM ${fromClause}`,
    ...joinClauses,
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "",
    groupByClauses.length > 0 ? `GROUP BY ${groupByClauses.join(", ")}` : "",
    havingClauses.length > 0 ? `HAVING ${havingClauses.join(" AND ")}` : "",
    orderByClauses.length > 0 ? `ORDER BY ${orderByClauses.join(", ")}` : "",
  ].filter(Boolean);

  const sql = sqlParts.join(" ");

  const rows = await sequelize.query<Record<string, unknown>>(sql, {
    type: QueryTypes.SELECT,
  });

  const columns = rows.length > 0 ? Object.keys(rows[0]) : Array.from(selectedAliases);

  const response: ReportPreviewResponse = {
    rows,
    columns,
    sql,
  };

  return {
    result: response,
    sql,
    meta: {
      type: "preview",
      models: payload.models,
      selectedColumns: Array.from(selectedAliases),
    },
  };
};

type BuiltQueryConfigResult = {
  sql: string;
  columns: string[];
  replacements: Record<string, unknown>;
  meta: Record<string, unknown>;
  columnTypes: Array<string | null>;
};

const buildSelectQuerySql = (config: QueryConfig, paramPrefix = ""): BuiltQueryConfigResult => {
  const selectEntries = (config.select ?? []).filter(
    (entry): entry is QueryConfigSelect =>
      Boolean(entry) &&
      typeof entry.modelId === "string" &&
      entry.modelId.trim().length > 0 &&
      typeof entry.fieldId === "string" &&
      entry.fieldId.trim().length > 0,
  );

  if (selectEntries.length === 0) {
    throw new PreviewQueryError("Select at least one field for your query.");
  }

  const resolvedModels = resolveQueryConfigModels(config);
  if (resolvedModels.length === 0) {
    throw new PreviewQueryError("At least one data model is required.");
  }

  const aliasMap = new Map<string, string>();
  resolvedModels.forEach((modelId, index) => {
    aliasMap.set(modelId, `m${index}`);
  });

  const derivedFieldPayloads = Array.isArray(config.derivedFields) ? config.derivedFields : [];
  validateDerivedFieldGraph(derivedFieldPayloads, resolvedModels, config.joins ?? [], aliasMap);
  const derivedFieldLookup = new Map<string, DerivedFieldQueryPayload>(
    derivedFieldPayloads.map((field) => [field.id, field]),
  );

  const selectClauses: string[] = [];
  const selectedAliases: string[] = [];
  const selectedTypes: Array<string | null> = [];
  const seenAliases = new Set<string>();

  selectEntries.forEach((entry, index) => {
    const modelId = entry.modelId.trim();
    let selectAlias =
      entry.alias && entry.alias.trim().length > 0 ? entry.alias.trim() : `${entry.modelId}__${entry.fieldId}`;
    let expression: string | null = null;
    let columnType: string | null = null;

    if (modelId === DERIVED_FIELD_SENTINEL) {
      const derivedId = entry.fieldId.trim();
      const derivedField = derivedFieldLookup.get(derivedId);
      if (!derivedField || !derivedField.expressionAst) {
        throw new PreviewQueryError(
          `Derived field ${derivedId || entry.alias || `#${index + 1}`} is not available for selection.`,
        );
      }
      expression = renderDerivedFieldExpressionSql(derivedField.expressionAst, aliasMap);
      if (!entry.alias || entry.alias.trim().length === 0) {
        selectAlias = derivedField.id?.trim() || `derived_${index + 1}`;
      }
      columnType = null;
    } else {
      const descriptor = ensureModelDescriptor(modelId);
      const modelAlias = aliasMap.get(modelId);
      if (!descriptor || !modelAlias) {
        throw new PreviewQueryError(`Model ${modelId} is not available.`);
      }
      const field = descriptor.fields.find((candidate) => candidate.fieldName === entry.fieldId);
      if (!field) {
        throw new PreviewQueryError(
          `Field ${entry.fieldId} is not available on model ${modelId}.`,
        );
      }
      expression = `${modelAlias}.${quoteIdentifier(field.columnName)}`;
      if (!entry.alias || entry.alias.trim().length === 0) {
        selectAlias = `${descriptor.id}__${field.fieldName}`;
      }
      columnType = normalizeColumnType(field.type);
    }

    if (!expression || !selectAlias) {
      return;
    }
    if (seenAliases.has(selectAlias)) {
      return;
    }
    seenAliases.add(selectAlias);
    selectClauses.push(`${expression} AS ${quoteIdentifier(selectAlias)}`);
    selectedAliases.push(selectAlias);
    selectedTypes.push(columnType);
  });

  if (selectClauses.length === 0) {
    throw new PreviewQueryError("Unable to determine any valid fields to query.");
  }

  const baseModelId = resolvedModels[0];
  const baseDescriptor = ensureModelDescriptor(baseModelId);
  const baseAlias = aliasMap.get(baseModelId);
  if (!baseDescriptor || !baseAlias) {
    throw new PreviewQueryError(`Model ${baseModelId} is not available.`);
  }

  const fromClause = buildFromClause(baseDescriptor, baseAlias);
  const { clauses: joinClauses, joinedModels, unresolvedJoins } = buildJoinClauses(
    config.joins ?? [],
    aliasMap,
    baseModelId,
  );

  if (unresolvedJoins.length > 0) {
    throw new PreviewQueryError("Some models could not be joined. Verify your join configuration.", 400, unresolvedJoins);
  }

  const unjoinedModels = resolvedModels.filter(
    (modelId) => modelId !== baseModelId && !joinedModels.has(modelId),
  );
  if (unjoinedModels.length > 0) {
    throw new PreviewQueryError("Some selected models are not connected to the base model.", 400, unjoinedModels);
  }

  validateDerivedFieldJoinCoverage(derivedFieldPayloads, joinedModels);

  const filterFragments: string[] = [];
  const replacements: Record<string, unknown> = {};

  (config.filters ?? []).forEach((filter, index) => {
    if (
      !filter ||
      typeof filter.modelId !== "string" ||
      typeof filter.fieldId !== "string" ||
      typeof filter.operator !== "string"
    ) {
      return;
    }
    const descriptor = ensureModelDescriptor(filter.modelId);
    const modelAlias = aliasMap.get(filter.modelId);
    if (!descriptor || !modelAlias) {
      throw new PreviewQueryError(`Model ${filter.modelId} is not available for filters.`);
    }
    const field = descriptor.fields.find((candidate) => candidate.fieldName === filter.fieldId);
    if (!field) {
      throw new PreviewQueryError(
        `Field ${filter.fieldId} is not available on model ${filter.modelId}.`,
      );
    }

    const column = `${modelAlias}.${quoteIdentifier(field.columnName)}`;
    const paramKey = `${paramPrefix}filter_${index}`;
    let fragment: string | null = null;
    const value = filter.value;

    switch (filter.operator) {
      case "eq":
        fragment = `${column} = :${paramKey}`;
        break;
      case "neq":
        fragment = `${column} <> :${paramKey}`;
        break;
      case "gt":
        fragment = `${column} > :${paramKey}`;
        break;
      case "gte":
        fragment = `${column} >= :${paramKey}`;
        break;
      case "lt":
        fragment = `${column} < :${paramKey}`;
        break;
      case "lte":
        fragment = `${column} <= :${paramKey}`;
        break;
      case "in": {
        if (!Array.isArray(value) || value.length === 0) {
          throw new PreviewQueryError("Filter 'in' requires a non-empty array value.");
        }
        const listKey = `${paramKey}_list`;
        fragment = `${column} IN (:${listKey})`;
        replacements[listKey] = value;
        break;
      }
      case "not_in": {
        if (!Array.isArray(value) || value.length === 0) {
          throw new PreviewQueryError("Filter 'not_in' requires a non-empty array value.");
        }
        const listKey = `${paramKey}_list`;
        fragment = `${column} NOT IN (:${listKey})`;
        replacements[listKey] = value;
        break;
      }
      case "between": {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new PreviewQueryError("Filter 'between' requires an object value with from/to.");
        }
        const from = (value as { from?: string | number }).from;
        const to = (value as { to?: string | number }).to;
        if (from === undefined || to === undefined) {
          throw new PreviewQueryError("Filter 'between' requires both from and to values.");
        }
        const fromKey = `${paramKey}_from`;
        const toKey = `${paramKey}_to`;
        fragment = `${column} BETWEEN :${fromKey} AND :${toKey}`;
        replacements[fromKey] = from;
        replacements[toKey] = to;
        break;
      }
      default:
        throw new PreviewQueryError(`Unsupported filter operator: ${filter.operator}`);
    }

    if (
      filter.operator === "eq" ||
      filter.operator === "neq" ||
      filter.operator === "gt" ||
      filter.operator === "gte" ||
      filter.operator === "lt" ||
      filter.operator === "lte"
    ) {
      replacements[paramKey] = value;
    }

    if (fragment) {
      filterFragments.push(fragment);
    }
  });

  const sqlParts = [
    `SELECT ${selectClauses.join(", ")}`,
    `FROM ${fromClause}`,
    ...joinClauses,
    filterFragments.length > 0 ? `WHERE ${filterFragments.join(" AND ")}` : "",
  ];

  const orderByParts: string[] = [];
  (config.orderBy ?? []).forEach((clause) => {
    if (!clause || typeof clause.alias !== "string") {
      return;
    }
    const direction = clause.direction && clause.direction.toLowerCase() === "desc" ? "DESC" : "ASC";
    const alias = clause.alias.trim();
    if (selectedAliases.includes(alias)) {
      orderByParts.push(`${quoteIdentifier(alias)} ${direction}`);
    }
  });

  if (orderByParts.length > 0) {
    sqlParts.push(`ORDER BY ${orderByParts.join(", ")}`);
  }

  const sql = sqlParts.filter(Boolean).join(" ");

  return {
    sql,
    columns: selectedAliases,
    replacements,
    meta: {
      models: resolvedModels,
      metrics: [],
      dimensions: selectedAliases,
      limit: null,
    },
    columnTypes: selectedTypes,
  };
};

const buildAggregatedQuerySql = (config: QueryConfig, paramPrefix = ""): BuiltQueryConfigResult => {
  const resolvedModels = resolveQueryConfigModels(config);
  if (resolvedModels.length === 0) {
    throw new PreviewQueryError("At least one data model is required.");
  }

  const metrics = (config.metrics ?? []).filter(
    (metric): metric is QueryConfigMetric =>
      metric !== null &&
      typeof metric === "object" &&
      typeof metric.modelId === "string" &&
      metric.modelId.trim().length > 0 &&
      typeof metric.fieldId === "string" &&
      metric.fieldId.trim().length > 0 &&
      typeof metric.aggregation === "string",
  );

  const dimensions = (config.dimensions ?? []).filter(
    (dimension): dimension is QueryConfigDimension =>
      dimension !== null &&
      typeof dimension === "object" &&
      typeof dimension.modelId === "string" &&
      dimension.modelId.trim().length > 0 &&
      typeof dimension.fieldId === "string" &&
      dimension.fieldId.trim().length > 0,
  );

  if (metrics.length === 0) {
    throw new PreviewQueryError("Configure at least one metric for aggregated queries.");
  }

  const aliasMap = new Map<string, string>();
  resolvedModels.forEach((modelId, index) => {
    aliasMap.set(modelId, `m${index}`);
  });

  const derivedFieldPayloads = Array.isArray(config.derivedFields) ? config.derivedFields : [];
  validateDerivedFieldGraph(derivedFieldPayloads, resolvedModels, config.joins ?? [], aliasMap);
  const derivedFieldLookup = new Map<string, DerivedFieldQueryPayload>(
    derivedFieldPayloads.map((field) => [field.id, field]),
  );

  const allowedBuckets = new Set(["hour", "day", "week", "month", "quarter", "year"]);

  const dimensionSelectClauses: string[] = [];
  const groupByClauses: string[] = [];
  const resolvedDimensions: string[] = [];
  const resolvedDimensionTypes: Array<string | null> = [];

  dimensions.forEach((dimension) => {
    const modelId = dimension.modelId.trim();
    const descriptor = ensureModelDescriptor(modelId);
    const modelAlias = aliasMap.get(modelId);
    if (!descriptor || !modelAlias) {
      throw new PreviewQueryError(`Model ${modelId} is not available.`);
    }
    const field = descriptor.fields.find((candidate) => candidate.fieldName === dimension.fieldId);
    if (!field) {
      throw new PreviewQueryError(
        `Field ${dimension.fieldId} is not available on model ${modelId}.`,
      );
    }
    const baseExpression = `${modelAlias}.${quoteIdentifier(field.columnName)}`;
    let columnExpression = baseExpression;
    let columnType = normalizeColumnType(field.type);
    if (dimension.bucket) {
      const bucketKey = dimension.bucket.toLowerCase();
      if (!allowedBuckets.has(bucketKey)) {
        throw new PreviewQueryError(`Unsupported time bucket: ${dimension.bucket}`);
      }
      columnExpression = `date_trunc('${bucketKey}', ${baseExpression})`;
      columnType = "date";
    }
    const alias =
      dimension.alias && dimension.alias.trim().length > 0
        ? dimension.alias.trim()
        : dimension.bucket
        ? `${descriptor.id}__${field.fieldName}_${dimension.bucket}`
        : `${descriptor.id}__${field.fieldName}`;
    dimensionSelectClauses.push(`${columnExpression} AS ${quoteIdentifier(alias)}`);
    groupByClauses.push(columnExpression);
    resolvedDimensions.push(alias);
    resolvedDimensionTypes.push(columnType);
  });

  const metricSelectClauses: string[] = [];
  const resolvedMetrics: string[] = [];
  const resolvedMetricTypes: Array<string | null> = [];

  const aggregationMap: Record<QueryConfigMetric["aggregation"], string> = {
    sum: "SUM",
    avg: "AVG",
    min: "MIN",
    max: "MAX",
    count: "COUNT",
    count_distinct: "COUNT",
  };

  metrics.forEach((metric, index) => {
    const modelId = metric.modelId.trim();
    const aggregationKey = metric.aggregation;
    const sqlAggregation = aggregationMap[aggregationKey];
    if (!sqlAggregation) {
      throw new PreviewQueryError(`Unsupported aggregation: ${aggregationKey}`);
    }

    if (modelId === DERIVED_FIELD_SENTINEL) {
      const derivedFieldId = metric.fieldId?.trim() ?? "";
      const derivedField = derivedFieldLookup.get(derivedFieldId);
      if (!derivedField || !derivedField.expressionAst) {
        throw new PreviewQueryError(
          `Derived field ${derivedFieldId || metric.alias || `#${index + 1}`} is not available for analytics.`,
        );
      }
      const expressionSql = renderDerivedFieldExpressionSql(derivedField.expressionAst, aliasMap);
      const aliasValue =
        metric.alias && metric.alias.trim().length > 0
          ? metric.alias.trim()
          : `${derivedField.id}_${aggregationKey}_${index}`;
      const aggregationExpression =
        aggregationKey === "count_distinct"
          ? `${sqlAggregation}(DISTINCT (${expressionSql}))`
          : `${sqlAggregation}(${expressionSql})`;
      metricSelectClauses.push(`${aggregationExpression} AS ${quoteIdentifier(aliasValue)}`);
      resolvedMetrics.push(aliasValue);
      resolvedMetricTypes.push("number");
      return;
    }

    const descriptor = ensureModelDescriptor(modelId);
    const modelAlias = aliasMap.get(modelId);
    if (!descriptor || !modelAlias) {
      throw new PreviewQueryError(`Model ${modelId} is not available.`);
    }
    const field = descriptor.fields.find((candidate) => candidate.fieldName === metric.fieldId);
    if (!field) {
      throw new PreviewQueryError(
        `Field ${metric.fieldId} is not available on model ${modelId}.`,
      );
    }
    const baseExpression = `${modelAlias}.${quoteIdentifier(field.columnName)}`;
    const alias =
      metric.alias && metric.alias.trim().length > 0
        ? metric.alias.trim()
        : `${descriptor.id}__${field.fieldName}_${aggregationKey}_${index}`;
    const aggregationExpression =
      aggregationKey === "count_distinct"
        ? `${sqlAggregation}(DISTINCT ${baseExpression})`
        : `${sqlAggregation}(${baseExpression})`;
    metricSelectClauses.push(`${aggregationExpression} AS ${quoteIdentifier(alias)}`);
    resolvedMetrics.push(alias);
    if (
      aggregationKey === "sum" ||
      aggregationKey === "avg" ||
      aggregationKey === "count" ||
      aggregationKey === "count_distinct"
    ) {
      resolvedMetricTypes.push("number");
    } else {
      resolvedMetricTypes.push(normalizeColumnType(field.type));
    }
  });

  const selectClauses = [...dimensionSelectClauses, ...metricSelectClauses];

  const baseModelId = resolvedModels[0];
  const baseDescriptor = ensureModelDescriptor(baseModelId);
  const baseAlias = aliasMap.get(baseModelId);
  if (!baseDescriptor || !baseAlias) {
    throw new PreviewQueryError(`Model ${baseModelId} is not available.`);
  }

  const fromClause = buildFromClause(baseDescriptor, baseAlias);
  const { clauses: joinClauses, joinedModels, unresolvedJoins } = buildJoinClauses(
    config.joins ?? [],
    aliasMap,
    baseModelId,
  );

  if (unresolvedJoins.length > 0) {
    throw new PreviewQueryError("Some models could not be joined. Verify your join configuration.", 400, unresolvedJoins);
  }

  const unjoinedModels = resolvedModels.filter(
    (modelId) => modelId !== baseModelId && !joinedModels.has(modelId),
  );
  if (unjoinedModels.length > 0) {
    throw new PreviewQueryError("Some selected models are not connected to the base model.", 400, unjoinedModels);
  }

  validateDerivedFieldJoinCoverage(derivedFieldPayloads, joinedModels);

  const filterFragments: string[] = [];
  const replacements: Record<string, unknown> = {};

  (config.filters ?? []).forEach((filter, index) => {
    if (
      !filter ||
      typeof filter.modelId !== "string" ||
      typeof filter.fieldId !== "string" ||
      typeof filter.operator !== "string"
    ) {
      return;
    }
    const descriptor = ensureModelDescriptor(filter.modelId);
    const modelAlias = aliasMap.get(filter.modelId);
    if (!descriptor || !modelAlias) {
      throw new PreviewQueryError(`Model ${filter.modelId} is not available for filters.`);
    }
    const field = descriptor.fields.find((candidate) => candidate.fieldName === filter.fieldId);
    if (!field) {
      throw new PreviewQueryError(
        `Field ${filter.fieldId} is not available on model ${filter.modelId}.`,
      );
    }

    const column = `${modelAlias}.${quoteIdentifier(field.columnName)}`;
    const paramKey = `${paramPrefix}filter_${index}`;
    let fragment: string | null = null;
    const value = filter.value;

    switch (filter.operator) {
      case "eq":
        fragment = `${column} = :${paramKey}`;
        break;
      case "neq":
        fragment = `${column} <> :${paramKey}`;
        break;
      case "gt":
        fragment = `${column} > :${paramKey}`;
        break;
      case "gte":
        fragment = `${column} >= :${paramKey}`;
        break;
      case "lt":
        fragment = `${column} < :${paramKey}`;
        break;
      case "lte":
        fragment = `${column} <= :${paramKey}`;
        break;
      case "in": {
        if (!Array.isArray(value) || value.length === 0) {
          throw new PreviewQueryError("Filter 'in' requires a non-empty array value.");
        }
        const listKey = `${paramKey}_list`;
        fragment = `${column} IN (:${listKey})`;
        replacements[listKey] = value;
        break;
      }
      case "not_in": {
        if (!Array.isArray(value) || value.length === 0) {
          throw new PreviewQueryError("Filter 'not_in' requires a non-empty array value.");
        }
        const listKey = `${paramKey}_list`;
        fragment = `${column} NOT IN (:${listKey})`;
        replacements[listKey] = value;
        break;
      }
      case "between": {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new PreviewQueryError("Filter 'between' requires an object value with from/to.");
        }
        const from = (value as { from?: string | number }).from;
        const to = (value as { to?: string | number }).to;
        if (from === undefined || to === undefined) {
          throw new PreviewQueryError("Filter 'between' requires both from and to values.");
        }
        const fromKey = `${paramKey}_from`;
        const toKey = `${paramKey}_to`;
        fragment = `${column} BETWEEN :${fromKey} AND :${toKey}`;
        replacements[fromKey] = from;
        replacements[toKey] = to;
        break;
      }
      default:
        throw new PreviewQueryError(`Unsupported filter operator: ${filter.operator}`);
    }

    if (
      filter.operator === "eq" ||
      filter.operator === "neq" ||
      filter.operator === "gt" ||
      filter.operator === "gte" ||
      filter.operator === "lt" ||
      filter.operator === "lte"
    ) {
      replacements[paramKey] = value;
    }

    if (fragment) {
      filterFragments.push(fragment);
    }
  });

  const sqlParts = [
    `SELECT ${selectClauses.join(", ")}`,
    `FROM ${fromClause}`,
    ...joinClauses,
    filterFragments.length > 0 ? `WHERE ${filterFragments.join(" AND ")}` : "",
    resolvedDimensions.length > 0 ? `GROUP BY ${groupByClauses.join(", ")}` : "",
  ];

  const orderByParts: string[] = [];
  (config.orderBy ?? []).forEach((clause) => {
    if (!clause || typeof clause.alias !== "string") {
      return;
    }
    const direction = clause.direction && clause.direction.toLowerCase() === "desc" ? "DESC" : "ASC";
    const alias = clause.alias.trim();
    if (resolvedMetrics.includes(alias) || resolvedDimensions.includes(alias)) {
      orderByParts.push(`${quoteIdentifier(alias)} ${direction}`);
    }
  });

  if (orderByParts.length > 0) {
    sqlParts.push(`ORDER BY ${orderByParts.join(", ")}`);
  }

  const sql = sqlParts.filter(Boolean).join(" ");
  const columns = [...resolvedDimensions, ...resolvedMetrics];
  const columnTypes = [...resolvedDimensionTypes, ...resolvedMetricTypes];

  return {
    sql,
    columns,
    replacements,
    meta: {
      models: resolvedModels,
      metrics: resolvedMetrics,
      dimensions: resolvedDimensions,
      filters: config.filters ?? [],
      limit: null,
    },
    columnTypes,
  };
};

const executeAggregatedQuery = async (
  config: QueryConfig,
): Promise<{ result: ReportPreviewResponse; sql: string; meta: Record<string, unknown> }> => {
  const built = buildAggregatedQuerySql(config, "");
  const rows = await sequelize.query<Record<string, unknown>>(built.sql, {
    replacements: built.replacements,
    type: QueryTypes.SELECT,
  });

  return {
    result: {
      rows,
      columns: built.columns,
      sql: built.sql,
    },
    sql: built.sql,
    meta: built.meta,
  };
};

const executeSelectQueryConfig = async (
  config: QueryConfig,
): Promise<{ result: ReportPreviewResponse; sql: string; meta: Record<string, unknown> }> => {
  const built = buildSelectQuerySql(config, "");
  const rows = await sequelize.query<Record<string, unknown>>(built.sql, {
    replacements: built.replacements,
    type: QueryTypes.SELECT,
  });

  return {
    result: {
      rows,
      columns: built.columns,
      sql: built.sql,
    },
    sql: built.sql,
    meta: built.meta,
  };
};

const isAggregatedConfig = (config: QueryConfig): boolean =>
  (config.metrics?.length ?? 0) > 0 || (config.dimensions?.length ?? 0) > 0;

const executeQueryConfigSync = async (
  config: QueryConfig,
): Promise<QueryExecutionResult> => {
  assertNoSensitiveReportModelReferences(config);
  const unionQueries = Array.isArray(config.union?.queries) ? config.union?.queries ?? [] : [];
  const isUnionRequest = unionQueries.length > 0;
  if (isUnionRequest) {
    const union = await executeUnionQuery(config.union as QueryConfigUnion);
    return {
      rows: union.result.rows,
      columns: union.result.columns,
      sql: union.sql,
      meta: union.meta,
    };
  }
  if (isAggregatedConfig(config)) {
    const aggregated = await executeAggregatedQuery(config);
    return {
      rows: aggregated.result.rows,
      columns: aggregated.result.columns,
      sql: aggregated.sql,
      meta: aggregated.meta,
    };
  }
  const preview = await executeSelectQueryConfig(config);
  return {
    rows: preview.result.rows,
    columns: preview.result.columns,
    sql: preview.sql,
    meta: preview.meta,
  };
};

const runQueryConfigWithCache = async (
  config: QueryConfig,
): Promise<{ execution: QueryExecutionResult; hash: string; cached: boolean }> => {
  assertNoSensitiveReportModelReferences(config);
  const hash = computeQueryHash(config);
  const cached = await getCachedQueryResult(hash);
  if (cached) {
    return { execution: cached, hash, cached: true };
  }
  const execution = await executeQueryConfigSync(config);
  const templateId = config.options?.templateId ?? null;
  const cacheTtlSeconds = config.options?.cacheTtlSeconds ?? undefined;
  await storeQueryCacheEntry(hash, templateId, execution, cacheTtlSeconds);
  return { execution, hash, cached: false };
};

const buildQueryConfigSql = (config: QueryConfig, paramPrefix = ""): BuiltQueryConfigResult => {
  return isAggregatedConfig(config)
    ? buildAggregatedQuerySql(config, paramPrefix)
    : buildSelectQuerySql(config, paramPrefix);
};

const executeUnionQuery = async (
  unionConfig: QueryConfigUnion,
  options: { disableLimit?: boolean } = {},
): Promise<{ result: ReportPreviewResponse; sql: string; meta: Record<string, unknown> }> => {
  if (!unionConfig || !Array.isArray(unionConfig.queries) || unionConfig.queries.length === 0) {
    throw new PreviewQueryError("Union queries must include at least one subquery.");
  }

  const unionOp = unionConfig.all === false ? "UNION" : "UNION ALL";
  const replacements: Record<string, unknown> = {};
  const sqlFragments: string[] = [];
  let baseColumns: string[] | null = null;
  let baseTypes: Array<string | null> | null = null;
  const metaQueries: Array<Record<string, unknown>> = [];

  unionConfig.queries.forEach((query, index) => {
    const built = buildQueryConfigSql(query, `u${index}_`);
    metaQueries.push(built.meta);

    if (!baseColumns) {
      baseColumns = built.columns.slice();
      baseTypes = built.columnTypes.slice();
    } else {
      if (built.columns.length !== baseColumns.length) {
        throw new PreviewQueryError(
          `Union query ${index + 1} does not match the expected column count (${baseColumns.length}).`,
        );
      }
      built.columns.forEach((column, columnIndex) => {
        if (column !== baseColumns![columnIndex]) {
          throw new PreviewQueryError(
            `Union query ${index + 1} column ${columnIndex + 1} must be '${baseColumns![columnIndex]}'.`,
          );
        }
        const expectedType = baseTypes?.[columnIndex] ?? null;
        const incomingType = built.columnTypes[columnIndex] ?? null;
        if (!expectedType && incomingType) {
          baseTypes![columnIndex] = incomingType;
          return;
        }
        if (expectedType && incomingType && expectedType !== incomingType) {
          throw new PreviewQueryError(
            `Union query ${index + 1} column '${column}' type mismatch (${incomingType} vs ${expectedType}).`,
          );
        }
      });
    }

    Object.assign(replacements, built.replacements);
    sqlFragments.push(`(${built.sql})`);
  });

  const unionSql = sqlFragments.join(` ${unionOp} `);
  const orderByParts: string[] = [];
  const availableColumns: string[] = baseColumns ? [...baseColumns] : [];
  (unionConfig.orderBy ?? []).forEach((clause) => {
    if (!clause || typeof clause.alias !== "string") {
      return;
    }
    const alias = clause.alias.trim();
    if (!availableColumns.includes(alias)) {
      return;
    }
    const direction = clause.direction && clause.direction.toLowerCase() === "desc" ? "DESC" : "ASC";
    orderByParts.push(`${quoteIdentifier(alias)} ${direction}`);
  });

  const unionAlias = quoteIdentifier("unioned");
  const sqlParts = [`SELECT * FROM (${unionSql}) AS ${unionAlias}`];

  if (orderByParts.length > 0) {
    sqlParts.push(`ORDER BY ${orderByParts.join(", ")}`);
  }

  // Limits are disabled for union queries to return full result sets.

  if (unionConfig.offset !== undefined && unionConfig.offset !== null) {
    const offsetValue = Math.max(Number(unionConfig.offset) || 0, 0);
    replacements.union_offset = offsetValue;
    sqlParts.push("OFFSET :union_offset");
  }

  const sql = sqlParts.join(" ");
  const rows = await sequelize.query<Record<string, unknown>>(sql, {
    replacements,
    type: QueryTypes.SELECT,
  });

  const columns = baseColumns ?? [];

  return {
    result: {
      rows,
      columns,
      sql,
    },
    sql,
    meta: {
      union: {
        all: unionConfig.all !== false,
        queries: metaQueries,
        limit: unionConfig.limit ?? null,
        offset: unionConfig.offset ?? null,
      },
      columns,
    },
  };
};

export const runReportPreview = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  let lastSql = "";
  try {
    ensureReportingAccess(req);
    assertNoSensitiveReportModelReferences(req.body);
    const unionPayload = (req.body as QueryConfig)?.union;
    if (unionPayload && Array.isArray(unionPayload.queries) && unionPayload.queries.length > 0) {
      const { result, sql, meta } = await executeUnionQuery(unionPayload, { disableLimit: true });
      lastSql = sql;
      res.status(200).json({
        ...result,
        meta: {
          ...meta,
          executedAt: new Date().toISOString(),
        },
      });
      return;
    }
    const payload = req.body as ReportPreviewRequest;
    const { result, sql, meta } = await executePreviewQuery(payload);
    lastSql = sql;
    res.status(200).json({
      ...result,
      meta: {
        ...meta,
        executedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof PreviewQueryError) {
      res
        .status(error.status)
        .json(error.details ? { message: error.message, details: error.details } : { message: error.message });
      return;
    }
    console.error("Failed to run report preview", error, lastSql ? `SQL: ${lastSql}` : "");
    const payload =
      process.env.NODE_ENV !== "production" && error instanceof Error
        ? { message: "Failed to run report preview.", details: error.message }
        : { message: "Failed to run report preview." };
    res.status(500).json(payload);
  }
};

export const executeReportQuery = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  let lastSql = "";
  try {
    ensureReportingAccess(req);
    const config = req.body as QueryConfig;
    assertNoSensitiveReportModelReferences(config);
    const unionQueries = Array.isArray(config.union?.queries) ? config.union?.queries ?? [] : [];
    const isUnionRequest = unionQueries.length > 0;
    const templateId = config.options?.templateId ?? null;
    const cacheTtlSeconds = config.options?.cacheTtlSeconds ?? undefined;
    const hash = computeQueryHash(config);

    const cached = await getCachedQueryResult(hash);
    if (cached) {
      res.status(200).json({
        rows: cached.rows,
        columns: cached.columns,
        sql: cached.sql,
        meta: {
          ...cached.meta,
          hash,
        },
      });
      return;
    }

    const executeQuery = async (): Promise<QueryExecutionResult> => {
      const execution = await executeQueryConfigSync(config);
      lastSql = execution.sql;
      return execution;
    };

    const shouldAllowAsync = Boolean(config.options?.allowAsync);
    const forceAsync = Boolean(config.options?.forceAsync);
    const metricsCount = isUnionRequest
      ? unionQueries.reduce((total, query) => total + (query.metrics?.length ?? 0), 0)
      : config.metrics?.length ?? 0;
    const dimensionCount = isUnionRequest
      ? unionQueries.reduce((total, query) => total + (query.dimensions?.length ?? 0), 0)
      : config.dimensions?.length ?? 0;
    const plannedLimit = isUnionRequest ? config.union?.limit ?? 0 : config.limit ?? 0;
    const shouldProcessAsync =
      shouldAllowAsync &&
      (forceAsync || metricsCount > 2 || plannedLimit > 5000 || dimensionCount > 3);

    if (shouldProcessAsync) {
      const job = await enqueueQueryJob(hash, templateId, executeQuery, cacheTtlSeconds);
      res.status(202).json({
        jobId: job.id,
        hash,
        status: job.status,
        queuedAt: job.createdAt?.toISOString() ?? new Date().toISOString(),
      });
      return;
    }

    const execution = await executeQuery();
    await storeQueryCacheEntry(hash, templateId, execution, cacheTtlSeconds);

    res.status(200).json({
      rows: execution.rows,
      columns: execution.columns,
      sql: execution.sql,
      meta: {
        ...execution.meta,
        hash,
        cached: false,
        executedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof PreviewQueryError) {
      res
        .status(error.status)
        .json(error.details ? { message: error.message, details: error.details } : { message: error.message });
      return;
    }
    console.error("Failed to execute report query", error, lastSql ? `SQL: ${lastSql}` : "");
    const payload =
      process.env.NODE_ENV !== "production" && error instanceof Error
        ? { message: "Failed to execute report query.", details: error.message }
        : { message: "Failed to execute report query." };
    res.status(500).json(payload);
  }
};

export const executeReportQueryBulk = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req);
    const body = req.body as { requests?: Array<{ id?: unknown; config?: unknown }> };
    const requests = Array.isArray(body?.requests) ? body.requests : [];
    if (requests.length === 0) {
      res.status(400).json({ message: "Provide at least one bulk query request." });
      return;
    }
    const results = await Promise.all(
      requests.map(async (request) => {
        const id = typeof request.id === "string" ? request.id.trim() : "";
        const config = request.config as QueryConfig | undefined;
        if (!id || !config) {
          return {
            id: id || "unknown",
            status: "error" as const,
            message: "Each bulk request must include an id and config.",
          };
        }
        try {
          const { execution, hash, cached } = await runQueryConfigWithCache(config);
          return {
            id,
            status: "success" as const,
            response: {
              rows: execution.rows,
              columns: execution.columns,
              sql: execution.sql,
              meta: {
                ...execution.meta,
                hash,
                cached,
                executedAt: new Date().toISOString(),
              },
            },
          };
        } catch (error) {
          if (error instanceof PreviewQueryError) {
            return {
              id,
              status: "error" as const,
              message: error.message,
              details: error.details ? JSON.stringify(error.details) : undefined,
            };
          }
          const message =
            process.env.NODE_ENV !== "production" && error instanceof Error
              ? error.message
              : "Failed to execute report query.";
          return {
            id,
            status: "error" as const,
            message,
          };
        }
      }),
    );
    res.status(200).json({ results });
  } catch (error) {
    console.error("Failed to execute bulk report query", error);
    res.status(500).json({ message: "Failed to execute bulk report query." });
  }
};

export const getReportQueryJobStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { jobId } = req.params;
    if (!jobId) {
      res.status(400).json({ message: "Job id is required." });
      return;
    }
    const job = await getAsyncJobStatus(jobId);
    if (!job) {
      res.status(404).json({ message: "Job not found." });
      return;
    }

    if (job.status === "completed" && job.result) {
      const result = job.result as QueryExecutionResult;
      res.status(200).json({
        rows: result.rows,
        columns: result.columns,
        sql: result.sql,
        meta: {
          ...(result.meta ?? {}),
          hash: job.hash ?? undefined,
          cached: false,
          executedAt: job.finishedAt?.toISOString() ?? new Date().toISOString(),
        },
      });
      return;
    }

    res.status(200).json({
      jobId: job.id,
      status: job.status,
      hash: job.hash,
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      error: job.error ?? null,
    });
  } catch (error) {
    console.error("Failed to fetch query job status", error);
    res.status(500).json({ message: "Failed to fetch query job status." });
  }
};

export const listReportTemplates = async (_req: Request, res: Response): Promise<void> => {
  try {
    const templates = await ReportTemplate.findAll({
      include: [
        {
          model: User,
          as: "owner",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
      order: [["updatedAt", "DESC"]],
    });

    res.json({
      templates: templates.map((template) => serializeReportTemplate(template)),
    });
  } catch (error) {
    console.error("Failed to list report templates", error);
    res.status(500).json({ error: "Failed to load report templates" });
  }
};

export const createReportTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = req.authContext?.id ?? null;
    const payload = normalizeTemplatePayload((req.body ?? {}) as TemplatePayloadInput);

    if (!payload.name) {
      res.status(400).json({ error: "Template name is required" });
      return;
    }

    const template = await ReportTemplate.create({
      userId: actorId,
      name: payload.name,
      category: payload.category,
      description: payload.description,
      schedule: payload.schedule,
      models: payload.models,
      fields: payload.fields,
      joins: payload.joins,
      visuals: payload.visuals,
      metrics: payload.metrics,
      filters: payload.filters,
      queryConfig: payload.queryConfig,
      derivedFields: payload.derivedFields,
      metricsSpotlight: payload.metricsSpotlight,
      previewOrder: payload.previewOrder,
      options: payload.options,
      queryGroups: payload.queryGroups,
    });

    const reloaded = await template.reload({
      include: [
        {
          model: User,
          as: "owner",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
    });

    res.status(201).json({
      template: serializeReportTemplate(reloaded),
    });
  } catch (error) {
    console.error("Failed to create report template", error);
    res.status(500).json({ error: "Failed to create report template" });
  }
};

export const updateReportTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "Template id is required" });
      return;
    }

    const template = await ReportTemplate.findByPk(id, {
      include: [
        {
          model: User,
          as: "owner",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
    });

    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const actorId = req.authContext?.id ?? null;
    const roleSlug = req.authContext?.roleSlug ?? null;
    const hasFullAccess = roleSlug ? FULL_ACCESS_ROLE_SLUGS.has(roleSlug) : false;
    const isOwner = actorId !== null && template.userId === actorId;

    if (!hasFullAccess && !isOwner) {
      res.status(403).json({ error: "You do not have permission to modify this template" });
      return;
    }

    const payload = normalizeTemplatePayload((req.body ?? {}) as TemplatePayloadInput);

    if (!payload.name) {
      res.status(400).json({ error: "Template name is required" });
      return;
    }

    template.name = payload.name;
    template.category = payload.category;
    template.description = payload.description;
    template.schedule = payload.schedule;
    template.models = payload.models;
    template.fields = payload.fields;
    template.joins = payload.joins;
    template.visuals = payload.visuals;
    template.metrics = payload.metrics;
    template.filters = payload.filters;
    template.queryConfig = payload.queryConfig;
    template.derivedFields = payload.derivedFields;
    template.metricsSpotlight = payload.metricsSpotlight;
    template.previewOrder = payload.previewOrder;
    template.options = payload.options;
    template.queryGroups = payload.queryGroups;

    await template.save();
    await template.reload({
      include: [
        {
          model: User,
          as: "owner",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
    });

    res.json({
      template: serializeReportTemplate(template),
    });
  } catch (error) {
    console.error("Failed to update report template", error);
    res.status(500).json({ error: "Failed to update report template" });
  }
};

export const deleteReportTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "Template id is required" });
      return;
    }

    const template = await ReportTemplate.findByPk(id);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const actorId = req.authContext?.id ?? null;
    const roleSlug = req.authContext?.roleSlug ?? null;
    const hasFullAccess = roleSlug ? FULL_ACCESS_ROLE_SLUGS.has(roleSlug) : false;
    const isOwner = actorId !== null && template.userId === actorId;

    if (!hasFullAccess && !isOwner) {
      res.status(403).json({ error: "You do not have permission to delete this template" });
      return;
    }

    await template.destroy();
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete report template", error);
    res.status(500).json({ error: "Failed to delete report template" });
  }
};

const aggregateDailyBreakdownByUser = (
  dailyAggregates: Map<number, DailyAggregate>,
  commissionDataByUser: Map<number, CommissionSummary>,
): void =>  {
  dailyAggregates.forEach((aggregate) => {
    const guidesCount = aggregate.guides.size;

    aggregate.guides.forEach((guide) => {
      const summary = commissionDataByUser.get(guide.userId);
      if (!summary) {
        return;
      }

      summary.breakdown.push({
        date: aggregate.dateKey,
        commission: guide.commission,
        customers: guide.customers,
        guidesCount,
        counterId: aggregate.counterId,
        productId: aggregate.productId,
        productName: aggregate.productName,
      });
    });
  });
}

const getOrCreateProductBucket = (
  lookup: ProductBucketLookup,
  userId: number,
  productId: number | null,
  productName: string,
): ProductBucket => {
  let userBuckets = lookup.get(userId);
  if (!userBuckets) {
    userBuckets = new Map<string, ProductBucket>();
    lookup.set(userId, userBuckets);
  }
  const key = productId === null ? "__null__" : `${productId}`;
  let bucket = userBuckets.get(key);
  if (!bucket) {
    bucket = {
      productId,
      productName,
      counterIds: new Set<number>(),
      totalCustomers: 0,
      totalCommission: 0,
      componentTotals: new Map<number, number>(),
    };
    userBuckets.set(key, bucket);
  } else if (productName && productName !== bucket.productName) {
    bucket.productName = productName;
  }
  return bucket;
};

const allocateComponentToProduct = (
  lookup: ProductBucketLookup,
  userId: number,
  productId: number | null,
  productName: string,
  componentId: number,
  amount: number,
) => {
  if (!amount) {
    return;
  }
  const bucket = getOrCreateProductBucket(lookup, userId, productId, productName);
  const current = bucket.componentTotals.get(componentId) ?? 0;
  bucket.componentTotals.set(componentId, current + amount);
};

const createEmptyAffiliateSalesSummary = (): StaffAffiliateSalesSummary => ({
  bookingCount: 0,
  peopleCount: 0,
  revenueTotal: 0,
  commissionTotal: 0,
  commissionPaidTotal: 0,
  commissionOutstandingTotal: 0,
  currency: null,
  bookings: [],
});

const createEmptySummary = (
  userId: number,
  firstName: unknown,
  lastName: unknown = "",
): CommissionSummary => ({
  userId,
  ...buildStaffPayoutStaffIdentity({ userId, firstName, lastName }),
  totalCommission: 0,
  totalCustomers: 0,
  breakdown: [],
  componentTotals: [],
  bucketTotals: { commission: 0 },
  grossBucketTotals: { commission: 0 },
  fundBucketTotals: {},
  totalPayout: 0,
  grossCompensationTotal: 0,
  personalPayableTotal: 0,
  volunteerFundAllocationTotal: 0,
  volunteerFundAllocatedTotal: 0,
  volunteerFundOutstandingTotal: 0,
  volunteerFundOverallocatedTotal: 0,
  excludedSettlementTotal: 0,
  settlementSources: [],
  staffType: null,
  productTotals: [],
  counterIncentiveMarkers: {},
  counterIncentiveTotals: {},
  counterIncentiveDetails: {},
  reviewTotals: { totalEligibleReviews: 0, totalTrackedReviews: 0 },
  reviewPaymentOverride: false,
  incentiveOverride: false,
  baseOverrideApproved: false,
  platformGuestTotals: { totalGuests: 0, totalBooked: 0, totalAttended: 0 },
  platformGuestBreakdowns: {},
  lockedComponents: [],
  monthlyShiftCounts: {},
  managerMonthlyShiftCounts: {},
  shiftDayIndex: new Map<string, string[]>(),
  managerShiftDayIndex: new Map<string, Set<string>>(),
  staffProfileId: null,
  financeVendorId: null,
  financeClientId: null,
  payouts: {
    currency: resolvePayoutCurrency(),
    payableDue: 0,
    payablePaid: 0,
    payableOutstanding: 0,
    receivableDue: 0,
    receivableCollected: 0,
    receivableOutstanding: 0,
  },
  openingBalance: 0,
  closingBalance: 0,
  openingBalanceSource: null,
  reimbursements: {
    awaitingAmount: 0,
    reimbursedAmount: 0,
    entries: [],
  },
  paidEntries: [],
  affiliateSales: createEmptyAffiliateSalesSummary(),
});

const buildStaffAffiliateSalesByUser = (
  bookings: AffiliateBookingRow[],
): Map<number, StaffAffiliateSalesSummary> => {
  const salesByUser = new Map<number, StaffAffiliateSalesSummary>();

  bookings.forEach((booking) => {
    const affiliateUserId = normalizeUserId(booking.affiliateUserId);
    if (!affiliateUserId) {
      return;
    }

    const current = salesByUser.get(affiliateUserId) ?? createEmptyAffiliateSalesSummary();
    current.bookings.push({
      id: booking.id,
      platformBookingId: booking.platformBookingId,
      productName: booking.productName,
      guestName: booking.guestName,
      sourceReceivedAt: booking.sourceReceivedAt,
      experienceDate: booking.experienceDate,
      partySizeTotal: booking.partySizeTotal,
      baseAmount: booking.baseAmount,
      currency: booking.currency,
      affiliateCommissionPerPerson: booking.affiliateCommissionPerPerson,
      affiliateCommissionAmount: booking.affiliateCommissionAmount,
      affiliateCommissionEligible: booking.affiliateCommissionEligible,
      affiliateCommissionIneligibleReason: booking.affiliateCommissionIneligibleReason,
      affiliatePayoutLogId: booking.affiliatePayoutLogId,
      isCommissionPaid: booking.isCommissionPaid,
      utmSource: booking.utmSource,
      utmMedium: booking.utmMedium,
      utmCampaign: booking.utmCampaign,
    });
    current.bookingCount += 1;
    current.peopleCount += booking.partySizeTotal;
    current.revenueTotal += booking.baseAmount;
    current.commissionTotal += booking.affiliateCommissionAmount;
    if (booking.isCommissionPaid) {
      current.commissionPaidTotal += booking.affiliateCommissionAmount;
    } else {
      current.commissionOutstandingTotal += booking.affiliateCommissionAmount;
    }

    const bookingCurrency = booking.currency?.trim().toUpperCase() || null;
    if (current.currency === null) {
      current.currency = bookingCurrency;
    } else if (bookingCurrency !== current.currency) {
      current.currency = null;
    }

    salesByUser.set(affiliateUserId, current);
  });

  salesByUser.forEach((summary) => {
    summary.revenueTotal = roundCurrencyValue(summary.revenueTotal);
    summary.commissionTotal = roundCurrencyValue(summary.commissionTotal);
    summary.commissionPaidTotal = roundCurrencyValue(summary.commissionPaidTotal);
    summary.commissionOutstandingTotal = roundCurrencyValue(summary.commissionOutstandingTotal);
    summary.bookings = summary.bookings
      .map((booking) => ({
        ...booking,
        baseAmount: roundCurrencyValue(booking.baseAmount),
        affiliateCommissionAmount: roundCurrencyValue(booking.affiliateCommissionAmount),
      }))
      .sort((left, right) => {
        const leftDate = left.sourceReceivedAt ?? left.experienceDate ?? "";
        const rightDate = right.sourceReceivedAt ?? right.experienceDate ?? "";
        return leftDate.localeCompare(rightDate) || left.id - right.id;
      });
  });

  return salesByUser;
};

const recordCounterIncentiveMarker = (
  summary: CommissionSummary,
  counterId: number | null | undefined,
  componentName: string,
  amount = 0,
) => {
  if (!counterId || counterId <= 0) {
    return;
  }
  const key = String(counterId);
  const name = componentName?.trim() || "Incentive";
  const letter = name.charAt(0)?.toUpperCase() || "I";
  const existing = summary.counterIncentiveMarkers[key] ?? [];
  if (!existing.includes(letter)) {
    summary.counterIncentiveMarkers[key] = [...existing, letter];
  }
  if (amount) {
    const details = summary.counterIncentiveDetails[key] ?? [];
    const existingDetail = details.find((detail) => detail.letter === letter && detail.name === name);
    if (existingDetail) {
      existingDetail.amount += amount;
    } else {
      details.push({ letter, name, amount });
    }
    summary.counterIncentiveDetails[key] = details;
  }
};

const recordCounterIncentiveTotal = (
  summary: CommissionSummary,
  counterId: number | null | undefined,
  amount: number,
) => {
  if (!counterId || counterId <= 0 || !amount) {
    return;
  }
  const key = String(counterId);
  summary.counterIncentiveTotals[key] = (summary.counterIncentiveTotals[key] ?? 0) + amount;
};

const incrementMonthlyShiftCount = (summary: CommissionSummary, dateKey: string | null | undefined) => {
  if (!dateKey) {
    return;
  }
  const parsed = dayjs(dateKey);
  if (!parsed.isValid()) {
    return;
  }
  const monthKey = parsed.format("YYYY-MM");
  summary.monthlyShiftCounts[monthKey] = (summary.monthlyShiftCounts[monthKey] ?? 0) + 1;
  let dayEntries = summary.shiftDayIndex.get(monthKey);
  if (!dayEntries) {
    dayEntries = [];
    summary.shiftDayIndex.set(monthKey, dayEntries);
  }
  dayEntries.push(parsed.format("YYYY-MM-DD"));
};

const incrementMonthlyManagerShiftCount = (summary: CommissionSummary, dateKey: string | null | undefined) => {
  if (!dateKey) {
    return;
  }
  const parsed = dayjs(dateKey);
  if (!parsed.isValid()) {
    return;
  }
  const monthKey = parsed.format("YYYY-MM");
  let daySet = summary.managerShiftDayIndex.get(monthKey);
  if (!daySet) {
    daySet = new Set<string>();
    summary.managerShiftDayIndex.set(monthKey, daySet);
  }
  const normalizedDayKey = parsed.format("YYYY-MM-DD");
  if (daySet.has(normalizedDayKey)) {
    return;
  }
  daySet.add(normalizedDayKey);
  summary.managerMonthlyShiftCounts[monthKey] = (summary.managerMonthlyShiftCounts[monthKey] ?? 0) + 1;
};

const recordLockedComponent = (
  summary: CommissionSummary,
  component: CompensationComponent,
  amount: number,
  requirement: LockedComponentRequirement,
) => {
  if (!amount) {
    return;
  }
  summary.lockedComponents.push({
    componentId: component.id,
    name: component.name,
    category: component.category,
    calculationMethod: component.calculationMethod,
    amount,
    requirement,
    bucketCategory: component.category,
  });
  if (component.category) {
    summary.bucketTotals[component.category] = (summary.bucketTotals[component.category] ?? 0) + amount;
  }
};

const ensureSummariesForUserIds = async (
  userIds: Iterable<number>,
  summaries: Map<number, CommissionSummary>,
): Promise<void> => {
  const missingIds = Array.from(new Set(Array.from(userIds).filter((userId) => !summaries.has(userId))));
  if (missingIds.length === 0) {
    return;
  }

  const users = await User.findAll({
    where: { id: { [Op.in]: missingIds } },
    attributes: ["id", "firstName", "lastName"],
  });

  users.forEach((user) => {
    if (!summaries.has(user.id)) {
      summaries.set(
        user.id,
        createEmptySummary(
          user.id,
          user.firstName,
          user.lastName,
        ),
      );
    }
  });
};

const fetchReviewStats = async (
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
): Promise<Map<number, ReviewTotals>> => {
  const startIso = rangeStart.format("YYYY-MM-DD");
  const endIso = rangeEnd.format("YYYY-MM-DD");
  const lastLegacyReviewDay = REVIEW_ARCHIVE_PAYOUT_START.subtract(1, "day");
  const legacyReviewEnd = rangeEnd.isBefore(lastLegacyReviewDay, "day") ? rangeEnd : lastLegacyReviewDay;
  const archiveReviewStart = rangeStart.isAfter(REVIEW_ARCHIVE_PAYOUT_START, "day")
    ? rangeStart
    : REVIEW_ARCHIVE_PAYOUT_START;
  const includesLegacyReviews = !legacyReviewEnd.isBefore(rangeStart, "day");
  const includesArchiveReviews = !archiveReviewStart.isAfter(rangeEnd, "day");

  const counters = includesLegacyReviews ? await ReviewCounter.findAll({
    attributes: ["id", "periodStart", "periodEnd"],
    where: {
      [Op.or]: [
        {
          periodStart: {
            [Op.between]: [startIso, legacyReviewEnd.format("YYYY-MM-DD")],
          },
        },
        {
          periodEnd: {
            [Op.between]: [startIso, legacyReviewEnd.format("YYYY-MM-DD")],
          },
        },
        {
          [Op.and]: [
            { periodStart: { [Op.lte]: startIso } },
            {
              [Op.or]: [
                { periodEnd: { [Op.gte]: legacyReviewEnd.format("YYYY-MM-DD") } },
                { periodEnd: null },
              ],
            },
          ],
        },
      ],
    },
  }) : [];

  const counterIds = counters.map((counter) => counter.id);

  const entries = counterIds.length > 0
    ? await ReviewCounterEntry.findAll({
        attributes: ["counterId", "userId", "roundedCount", "underMinimumApproved"],
        where: {
          counterId: { [Op.in]: counterIds },
          category: "staff",
          userId: { [Op.ne]: null },
        },
      })
    : [];

  const stats = new Map<number, ReviewTotals>();
  entries.forEach((entry) => {
    const userId = entry.getDataValue("userId");
    if (!userId) {
      return;
    }
    const roundedCountRaw = entry.get("roundedCount");
    const roundedCount = Number(roundedCountRaw ?? 0);
    if (!Number.isFinite(roundedCount) || roundedCount <= 0) {
      return;
    }
    const current = stats.get(userId) ?? { totalEligibleReviews: 0, totalTrackedReviews: 0 };
    current.totalTrackedReviews += roundedCount;
    current.totalEligibleReviews += roundedCount;
    stats.set(userId, current);
  });

  const applicableReviewLocks = includesArchiveReviews ? (await ReviewMonthLock.findAll({
    where: {
      isLocked: true,
      periodStart: {
        [Op.between]: [archiveReviewStart.startOf("month").format("YYYY-MM-DD"), rangeEnd.startOf("month").format("YYYY-MM-DD")],
      },
    },
  })).filter((lock) => {
    const lockStart = dayjs(lock.periodStart);
    return !lockStart.isBefore(archiveReviewStart, "day") && !lockStart.endOf("month").isAfter(rangeEnd, "day");
  }) : [];
  const lockedReviewIds = new Set(
    applicableReviewLocks.flatMap((lock) => Array.isArray(lock.reviewIds) ? lock.reviewIds.map(Number) : []),
  );
  const lockedPeriods = new Map(applicableReviewLocks.map((lock) => [lock.periodStart, new Set(Array.isArray(lock.reviewIds) ? lock.reviewIds.map(Number) : [])]));
  const archiveReviewRange = reviewDateRangeInWarsaw(archiveReviewStart.format("YYYY-MM-DD"), endIso);
  const archivedReviews = includesArchiveReviews ? await ReviewArchive.findAll({
    attributes: ["id", "reviewCreatedAt", "creditMonth", "isDeleted"],
    where: {
      [Op.or]: [
        {
          creditMonth: { [Op.between]: [archiveReviewStart.format("YYYY-MM-DD"), endIso] },
        },
        {
          creditMonth: null,
          reviewCreatedAt: {
            [Op.between]: [archiveReviewRange.start, archiveReviewRange.end],
          },
        },
        ...(lockedReviewIds.size ? [{ id: { [Op.in]: Array.from(lockedReviewIds) } }] : []),
      ],
    },
  }) : [];
  const archivedReviewIds = archivedReviews.filter((review) => {
    if (lockedReviewIds.has(review.id)) return true;
    const periodStart = review.creditMonth ?? reviewPeriodStartInWarsaw(review.reviewCreatedAt);
    if (lockedPeriods.has(periodStart)) return false;
    return !review.isDeleted;
  }).map((review) => review.id);
  if (archivedReviewIds.length > 0) {
    const archiveAssignments = await ReviewAssignment.findAll({
      attributes: ["reviewId", "userId"],
      where: { reviewId: { [Op.in]: archivedReviewIds } },
    });
    const assignmentCountByReviewId = new Map<number, number>();
    archiveAssignments.forEach((assignment) => {
      assignmentCountByReviewId.set(
        assignment.reviewId,
        (assignmentCountByReviewId.get(assignment.reviewId) ?? 0) + 1,
      );
    });
    archiveAssignments.forEach((assignment) => {
      const assignmentCount = assignmentCountByReviewId.get(assignment.reviewId) ?? 0;
      if (assignmentCount <= 0) {
        return;
      }
      const credit = 1 / assignmentCount;
      const current = stats.get(assignment.userId) ?? { totalEligibleReviews: 0, totalTrackedReviews: 0 };
      current.totalTrackedReviews += credit;
      current.totalEligibleReviews += credit;
      stats.set(assignment.userId, current);
    });
  }

  const manualCredits = includesArchiveReviews ? await ReviewManualCredit.findAll({
    attributes: ["userId", "credit"],
    where: {
      date: { [Op.between]: [archiveReviewStart.format("YYYY-MM-DD"), endIso] },
      category: "staff",
      userId: { [Op.ne]: null },
      [Op.or]: [
        { notes: null },
        { notes: { [Op.notLike]: "Backfilled from legacy review counter #%" } },
      ],
    },
  }) : [];
  manualCredits.forEach((entry) => {
    if (entry.userId == null) {
      return;
    }
    const credit = Number(entry.credit ?? 0);
    if (!Number.isFinite(credit) || credit <= 0) {
      return;
    }
    const current = stats.get(entry.userId) ?? { totalEligibleReviews: 0, totalTrackedReviews: 0 };
    current.totalTrackedReviews += credit;
    current.totalEligibleReviews += credit;
    stats.set(entry.userId, current);
  });

  return stats;
};

const computePlatformGuestTotals = async (counterIds: number[]): Promise<PlatformGuestTotals> => {
  if (!counterIds || counterIds.length === 0) {
    return { totalGuests: 0, totalBooked: 0, totalAttended: 0 };
  }

  const counterRows = await Counter.findAll({
    where: { id: { [Op.in]: counterIds } },
    attributes: ["id", "productId"],
  });
  const productIdByCounter = new Map<number, number | null>();
  counterRows.forEach((counter) => {
    productIdByCounter.set(counter.id, counter.productId ?? null);
  });

  const rows = await CounterChannelMetric.findAll({
    attributes: [
      "counterId",
      "channelId",
      "kind",
      "addonId",
      "tallyType",
      [Sequelize.fn("SUM", Sequelize.col("qty")), "totalQty"],
    ],
    where: {
      counterId: { [Op.in]: counterIds },
      kind: { [Op.in]: ["people", "addon"] },
      tallyType: { [Op.in]: ["booked", "attended"] },
    },
    group: ["counterId", "channelId", "kind", "addonId", "tallyType"],
  });

  const addonIds = new Set<number>();
  rows.forEach((row) => {
    const kind = row.getDataValue("kind") as string;
    const addonId = Number(row.getDataValue("addonId") ?? 0);
    if (kind === "addon" && Number.isFinite(addonId) && addonId > 0) {
      addonIds.add(addonId);
    }
  });

  const excludedAddonIds = new Set<number>();
  if (addonIds.size > 0) {
    const addons = await Addon.findAll({
      where: { id: { [Op.in]: Array.from(addonIds) } },
      attributes: ["id", "name"],
    });
    addons.forEach((addon) => {
      if (isExcludedNoShowAddonName(addon.name ?? null)) {
        excludedAddonIds.add(addon.id);
      }
    });
  }

  const bucketTotals = new Map<string, { booked: number; attended: number }>();
  rows.forEach((row) => {
    const counterId = Number(row.getDataValue("counterId") ?? 0);
    const channelId = Number(row.getDataValue("channelId") ?? 0);
    const kind = row.getDataValue("kind") as string;
    const addonId = Number(row.getDataValue("addonId") ?? 0);
    if (kind === "addon" && excludedAddonIds.has(addonId)) {
      return;
    }
    const productId = productIdByCounter.get(counterId) ?? null;
    const tallyType = row.getDataValue("tallyType") as string;
    const qty = Number(row.get("totalQty") ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      return;
    }
    const bucketKey = `${productId ?? "null"}|${channelId}|${kind}|${addonId || "null"}`;
    const bucket = bucketTotals.get(bucketKey) ?? { booked: 0, attended: 0 };
    if (tallyType === "booked") {
      bucket.booked += qty;
    } else if (tallyType === "attended") {
      bucket.attended += qty;
    }
    bucketTotals.set(bucketKey, bucket);
  });

  let totalBooked = 0;
  let totalAttended = 0;
  let totalNoShow = 0;
  bucketTotals.forEach((bucket) => {
    totalBooked += bucket.booked;
    totalAttended += bucket.attended;
    totalNoShow += Math.max(bucket.booked - bucket.attended, 0);
  });

  const totalGuests = totalAttended + totalNoShow;
  return {
    totalGuests,
    totalBooked,
    totalAttended,
  };
};

function describeModel(model: ModelCtor<Model>): ReportModelDescriptor {
  const attributes = model.getAttributes();
  const fields = Object.entries(attributes).map(([fieldName, attribute]) =>
    describeField(fieldName, attribute),
  );

  const primaryKeys = fields
    .filter((field) => field.primaryKey)
    .map((field) => field.fieldName);

  const tableNameRaw = model.getTableName();
  const tableName =
    typeof tableNameRaw === "string" ? tableNameRaw : tableNameRaw.tableName ?? model.name;
  const schema =
    typeof tableNameRaw === "string" ? undefined : tableNameRaw.schema ?? undefined;

  const associations = Object.values(model.associations ?? {}).map((association) =>
    describeAssociation(association),
  );

  const descriptor: ReportModelDescriptor = {
    id: model.name,
    name: model.name,
    tableName,
    schema,
    description: buildModelDescription(model.name, schema, tableName),
    connection: "OmniLodge core database",
    recordCount: "N/A",
    lastSynced: new Date().toISOString(),
    primaryKeys,
    primaryKey: primaryKeys[0] ?? null,
    fields,
    associations,
  };

  modelDescriptorCache.set(descriptor.id, descriptor);

  return descriptor;
}

const isAssignmentEffectiveForRange = (
  assignment: CompensationComponentAssignment,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
) => {
  const effectiveStart = assignment.effectiveStart ? dayjs(assignment.effectiveStart) : null;
  const effectiveEnd = assignment.effectiveEnd ? dayjs(assignment.effectiveEnd) : null;
  if (effectiveStart && effectiveStart.isAfter(rangeEnd, "day")) {
    return false;
  }
  if (effectiveEnd && effectiveEnd.isBefore(rangeStart, "day")) {
    return false;
  }
  return true;
};

type AssignmentTargetMap = Map<number, number[]>;
type AssignmentEligibilityDateMap = Map<number, Map<number, Set<string>>>;

type DatedEligibilityTarget = {
  userIds: number[];
  datesByUserId: Map<number, Set<string>>;
};

type TaskLogStatusBucket = {
  total: number;
  completed: number;
  waived: number;
  missed: number;
  pending: number;
  totalPoints: number;
  completedPoints: number;
  waivedPoints: number;
  missedPoints: number;
  pendingPoints: number;
};

type TaskLogDaySummary = {
  overall: TaskLogStatusBucket;
  byTemplate: Map<number, TaskLogStatusBucket>;
};

type TaskLogSummary = TaskLogDaySummary & {
  byDate: Map<string, TaskLogDaySummary>;
};

type TaskScoreLookup = Map<number, TaskLogSummary>;

type ShiftTaskDaySummary = TaskLogDaySummary & {
  taskOwnerUserId: number;
  taskOwnerName: string;
  shiftInstanceId: number;
  shiftAssignmentIds: Set<number>;
};

type ManagerShiftsByUserAndDate = Map<
  number,
  Map<string, AssistantManagerSalaryManagerShift[]>
>;

type ApprovedTakeoversByUserAndDate = Map<
  number,
  Map<string, AssistantManagerSalaryApprovedTakeover[]>
>;

type TaskScoreContext = {
  byUser: TaskScoreLookup;
  shiftTaskSetsByDate: Map<string, ShiftTaskDaySummary[]>;
  managerShiftsByUserAndDate: ManagerShiftsByUserAndDate;
  approvedTakeoversByUserAndDate: ApprovedTakeoversByUserAndDate;
};

const createEmptyTaskScoreContext = (): TaskScoreContext => ({
  byUser: new Map(),
  shiftTaskSetsByDate: new Map(),
  managerShiftsByUserAndDate: new Map(),
  approvedTakeoversByUserAndDate: new Map(),
});

const assignmentAppliesToUser = (
  assignment: CompensationComponentAssignment,
  userId: number,
  targetsByAssignment: AssignmentTargetMap,
): boolean => {
  if (assignment.targetScope === "global") {
    return true;
  }
  const targetUserIds = targetsByAssignment.get(assignment.id);
  if (targetUserIds && targetUserIds.includes(userId)) {
    return true;
  }
  return false;
};

const resolveEarningBreakdownForAmount = (
  amount: number,
  earningBreakdown: CompensationEarningBreakdownEntry[] | undefined,
  eligibleDates: ReadonlySet<string> | null,
): CompensationEarningBreakdownEntry[] | undefined => {
  if (!amount) {
    return undefined;
  }
  const merged = mergeCompensationEarningBreakdown(earningBreakdown ?? []);
  if (merged.length > 0) {
    const mergedMinor = merged.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
    const targetMinor = Math.round(amount * 100);
    return mergedMinor === targetMinor
      ? merged
      : scaleCompensationEarningBreakdown(merged, amount);
  }
  if (eligibleDates && eligibleDates.size > 0) {
    return allocateCompensationAmountAcrossDates(amount, eligibleDates);
  }
  return undefined;
};

const computeAssignmentAmount = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
  summary: CommissionSummary,
  taskScoreContext: TaskScoreContext,
  nightReportStats: NightReportStatsMap,
  nightReportBestCache: Map<string, NightReportBestCacheEntry>,
  productBucketsByUser: ProductBucketLookup,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
  eligibleDates: ReadonlySet<string> | null,
  assignmentEligibilityDatesByUser: ReadonlyMap<number, ReadonlySet<string>> | null,
): ComponentComputationResult => {
  const reviewRequirement = resolveReviewTargetRequirement(component, assignment);
  const performanceTierSettings = resolvePerformanceTierSettings(component, assignment);
  const totalEligibleReviews = summary.reviewTotals?.totalEligibleReviews ?? 0;
  const totalTrackedReviews = summary.reviewTotals?.totalTrackedReviews ?? totalEligibleReviews;
  const applyCompensationGates = (
    amount: number,
    baseDaysCount?: number,
    baseDays?: string[],
    taskCompletionDailyBreakdown?: AssistantManagerSalaryDailyBreakdown[],
    earningBreakdown?: CompensationEarningBreakdownEntry[],
  ): ComponentComputationResult => {
    if (!amount) {
      return {
        amount: 0,
        baseDaysCount,
        baseDays,
        taskCompletionDailyBreakdown,
      };
    }
    const resolvedEarningBreakdown = resolveEarningBreakdownForAmount(
      amount,
      earningBreakdown,
      eligibleDates,
    );
    const hasOverride =
      component.category === "review" ? summary.reviewPaymentOverride : summary.incentiveOverride;
    if (reviewRequirement && totalEligibleReviews < reviewRequirement.minReviews) {
      if (hasOverride) {
        return {
          amount,
          baseDaysCount,
          baseDays,
          taskCompletionDailyBreakdown,
          earningBreakdown: resolvedEarningBreakdown,
        };
      }
      recordLockedComponent(summary, component, amount, {
        type: "review_target",
        minReviews: reviewRequirement.minReviews,
        actualReviews: totalTrackedReviews,
        missingReviews: Math.max(0, reviewRequirement.minReviews - totalTrackedReviews),
        totalEligibleReviews,
      });
      return { amount: 0 };
    }

    // Daily task proration is already the performance adjustment for this
    // salary. Applying a second aggregate tier here would make the component
    // total disagree with its auditable daily rows.
    if (performanceTierSettings && !taskCompletionDailyBreakdown) {
      const outcome = resolvePerformanceTierOutcome(
        summary,
        taskScoreContext.byUser,
        performanceTierSettings,
        eligibleDates,
      );
      const adjustedAmount = amount * outcome.multiplier;

      if (amount > 0 && adjustedAmount < amount) {
        recordLockedComponent(summary, component, amount - adjustedAmount, {
          type: "performance_tier",
          progressRatio: outcome.progressRatio,
          progressPercent: outcome.progressPercent,
          multiplier: outcome.multiplier,
          deductedAmount: amount - adjustedAmount,
          matchedTierLabel: outcome.matchedTierLabel,
        });
      }

      return {
        amount: adjustedAmount,
        baseDaysCount,
        baseDays,
        taskCompletionDailyBreakdown,
        earningBreakdown: resolveEarningBreakdownForAmount(
          adjustedAmount,
          resolvedEarningBreakdown,
          eligibleDates,
        ),
      };
    }

    return {
      amount,
      baseDaysCount,
      baseDays,
      taskCompletionDailyBreakdown,
      earningBreakdown: resolvedEarningBreakdown,
    };
  };

  if (component.calculationMethod === "task_score") {
    const taskScorePayout = computeTaskScorePayout(
      component,
      assignment,
      summary,
      taskScoreContext.byUser,
      eligibleDates,
    );
    return applyCompensationGates(
      taskScorePayout.amount,
      undefined,
      undefined,
      undefined,
      taskScorePayout.earningBreakdown,
    );
  }
  if (component.calculationMethod === "night_report") {
    const nightReportPayout = computeNightReportIncentive(
      component,
      assignment,
      summary,
      nightReportStats,
      nightReportBestCache,
      productBucketsByUser,
      eligibleDates,
      assignmentEligibilityDatesByUser,
    );
    return applyCompensationGates(
      nightReportPayout.amount,
      undefined,
      undefined,
      undefined,
      nightReportPayout.earningBreakdown,
    );
  }

  const reviewSettings = resolveReviewPayoutSettings(component, assignment);
  if (reviewSettings) {
    return applyCompensationGates(computeReviewPayoutAmount(summary, reviewSettings));
  }

  const platformGuestSettings = resolvePlatformGuestSettings(component, assignment);
  if (platformGuestSettings) {
    return applyCompensationGates(
      computePlatformGuestPayout(summary, platformGuestSettings, component.id),
    );
  }

  const monthlyBaseSettings = resolveMonthlyBaseSettings(component, assignment);
  if (component.calculationMethod === "flat" && monthlyBaseSettings?.mode === "calendar_days") {
    const {
      amount: proratedAmount,
      creditedUnits,
      creditedDates,
      earningBreakdown,
    } = computeCalendarDayBaseAmount(
      assignment,
      monthlyBaseSettings,
      rangeStart,
      rangeEnd,
      eligibleDates,
    );
    return applyCompensationGates(
      proratedAmount,
      creditedUnits,
      creditedDates,
      undefined,
      earningBreakdown,
    );
  }
  if (component.calculationMethod === "per_unit" && monthlyBaseSettings?.mode === "shift_quota") {
    const {
      amount,
      creditedUnits,
      creditedDates,
      dailyBase,
      lockedExtraAmount,
      lockedExtraUnits,
      lockedExtraDates,
      lockedExtraDailyBase,
    } = computeShiftQuotaBaseAmount(
      assignment,
      monthlyBaseSettings,
      summary,
      rangeStart,
      rangeEnd,
      eligibleDates,
    );
    let baseAmount = amount;
    let baseUnits = creditedUnits;
    let baseDates = creditedDates;
    let eligibleDailyBase = dailyBase;
    if (lockedExtraAmount > 0) {
      if (summary.baseOverrideApproved) {
        baseAmount += lockedExtraAmount;
        baseUnits += lockedExtraUnits;
        if (lockedExtraDates.length > 0) {
          baseDates = [...new Set([...baseDates, ...lockedExtraDates])].sort((a, b) =>
            a < b ? -1 : a > b ? 1 : 0,
          );
        }
        eligibleDailyBase = [...eligibleDailyBase, ...lockedExtraDailyBase];
      } else {
        recordLockedComponent(summary, component, lockedExtraAmount, {
          type: "base_override",
          allowedUnits: creditedUnits,
          workedUnits: creditedUnits + lockedExtraUnits,
          extraUnits: lockedExtraUnits,
          extraAmount: lockedExtraAmount,
          extraDays: lockedExtraDates,
        });
      }
    }
    const dailyProration = monthlyBaseSettings.taskCompletionProration;
    let taskCompletionDailyBreakdown: AssistantManagerSalaryDailyBreakdown[] | undefined;
    let earningBreakdown = eligibleDailyBase.map((day) => ({
      date: day.date,
      amount: day.baseAmount,
    }));
    if (
      dailyProration?.enabled
      && dailyProration.effectiveStart
      && eligibleDailyBase.length === baseUnits
    ) {
      const { unchangedDailyBase, proratedDailyBase } =
        partitionAssistantManagerSalaryDaysForTaskProration(
          eligibleDailyBase,
          dailyProration.effectiveStart,
        );
      const progressByDate = buildAssistantManagerSalaryTaskProgressForRecipient(
        taskScoreContext,
        summary,
        dailyProration,
        proratedDailyBase.map((day) => day.date),
      );
      const calculatedBreakdown = calculateAssistantManagerSalaryTaskCompletion({
        dailyBase: proratedDailyBase,
        progressByDate,
        treatWaivedAsComplete: dailyProration.treatWaivedAsComplete,
        treatPendingAsComplete: dailyProration.treatPendingAsComplete,
        salaryRecipientUserId: summary.userId,
        salaryRecipientName: summary.fullName,
        // Cross-staff transfers are currently supported only for base salary.
        // Commission components also feed product allocations, which would
        // need a separate product-level transfer policy.
        takeoverSplit: component.category === "base"
          ? dailyProration.takeoverSplit
          : undefined,
      });
      taskCompletionDailyBreakdown = calculatedBreakdown.length > 0
        ? calculatedBreakdown
        : undefined;
      baseAmount = unchangedDailyBase.reduce((sum, day) => sum + day.baseAmount, 0)
        + calculatedBreakdown.reduce(
        (sum, day) => sum + day.payableAmount,
        0,
      );
      earningBreakdown = [
        ...unchangedDailyBase.map((day) => ({ date: day.date, amount: day.baseAmount })),
        ...calculatedBreakdown.map((day) => ({ date: day.date, amount: day.payableAmount })),
      ];
    }
    return applyCompensationGates(
      baseAmount,
      baseUnits,
      baseDates,
      taskCompletionDailyBreakdown,
      earningBreakdown,
    );
  }

  const baseAmount = Number(assignment.baseAmount ?? 0);
  const unitAmount = Number(assignment.unitAmount ?? 0);
  let total = baseAmount;

  if (!Number.isNaN(unitAmount) && unitAmount !== 0) {
    if (component.calculationMethod === "per_unit") {
      total += unitAmount * summary.totalCustomers;
    } else if (component.calculationMethod === "percentage") {
      total += (unitAmount / 100) * summary.totalCommission;
    }
  }

  return applyCompensationGates(total);
};

const resolveAssignmentEligibleDatesForUser = (
  assignment: CompensationComponentAssignment,
  userId: number,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
  assignmentEligibilityDates: AssignmentEligibilityDateMap,
): ReadonlySet<string> | null => {
  if (assignment.targetScope !== "global") {
    return assignmentEligibilityDates.get(assignment.id)?.get(userId) ?? null;
  }
  const overlap = getAssignmentOverlapRange(assignment, rangeStart, rangeEnd);
  return overlap
    ? new Set(enumerateInclusiveIsoDates(
        overlap.start.format("YYYY-MM-DD"),
        overlap.end.format("YYYY-MM-DD"),
      ))
    : null;
};

const applyCompensationComponents = (
  summaries: Map<number, CommissionSummary>,
  components: Array<CompensationComponent & { assignments?: CompensationComponentAssignment[] }>,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
  assignmentTargets: AssignmentTargetMap,
  assignmentEligibilityDates: AssignmentEligibilityDateMap,
  taskScoreContext: TaskScoreContext,
  nightReportStats: NightReportStatsMap,
  productBucketsByUser: ProductBucketLookup,
) => {
  const nightReportBestCache = new Map<string, NightReportBestCacheEntry>();
  summaries.forEach((summary) => {
    summary.componentTotals = [];
    summary.bucketTotals = { commission: summary.totalCommission };
    summary.totalPayout = summary.totalCommission;
    summary.lockedComponents = [];
  });

  components.forEach((component) => { 
    const assignments = component.assignments ?? [];
    if (assignments.length === 0) {
      return;
    }

    summaries.forEach((summary) => {
      const aggregate = assignments.reduce<ComponentComputationResult>(
        (acc, assignment) => {
          if (
            !assignment.isActive ||
            !isAssignmentEffectiveForRange(assignment, rangeStart, rangeEnd) ||
            !assignmentAppliesToUser(assignment, summary.userId, assignmentTargets)
          ) {
            return acc;
          }
          const eligibleDates = resolveAssignmentEligibleDatesForUser(
            assignment,
            summary.userId,
            rangeStart,
            rangeEnd,
            assignmentEligibilityDates,
          );
          if (!eligibleDates || eligibleDates.size === 0) {
            return acc;
          }
          const eligibilityDatesByUser = assignment.targetScope === "global"
            ? null
            : assignmentEligibilityDates.get(assignment.id) ?? null;
          const computation = computeAssignmentAmount(
            component,
            assignment,
            summary,
            taskScoreContext,
            nightReportStats,
            nightReportBestCache,
            productBucketsByUser,
            rangeStart,
            rangeEnd,
            eligibleDates,
            eligibilityDatesByUser,
          );
          acc.amount += computation.amount;
          if (computation.baseDaysCount !== undefined) {
            acc.baseDaysCount = (acc.baseDaysCount ?? 0) + computation.baseDaysCount;
          }
          if (computation.baseDays && computation.baseDays.length > 0) {
            acc.baseDays = acc.baseDays ?? [];
            acc.baseDays.push(...computation.baseDays);
          }
          if (
            computation.taskCompletionDailyBreakdown
            && computation.taskCompletionDailyBreakdown.length > 0
          ) {
            acc.taskCompletionDailyBreakdown = acc.taskCompletionDailyBreakdown ?? [];
            acc.taskCompletionDailyBreakdown.push(...computation.taskCompletionDailyBreakdown);
          }
          if (computation.earningBreakdown && computation.earningBreakdown.length > 0) {
            acc.earningBreakdown = acc.earningBreakdown ?? [];
            acc.earningBreakdown.push(...computation.earningBreakdown);
          }
          return acc;
        },
        { amount: 0 },
      );

      const hasBaseDayMetadata =
        aggregate.baseDaysCount !== undefined ||
        (aggregate.baseDays !== undefined && aggregate.baseDays.length > 0);
      const hasTaskCompletionDailyBreakdown = Boolean(
        aggregate.taskCompletionDailyBreakdown
        && aggregate.taskCompletionDailyBreakdown.length > 0,
      );
      const earningBreakdown = resolveEarningBreakdownForAmount(
        aggregate.amount,
        aggregate.earningBreakdown,
        null,
      );

      if (aggregate.amount !== 0 || hasBaseDayMetadata || hasTaskCompletionDailyBreakdown) {
        const taskCompletionDailyBreakdown = aggregate.taskCompletionDailyBreakdown
          ? mergeAssistantManagerSalaryDailyBreakdowns(
              aggregate.taskCompletionDailyBreakdown,
            )
          : undefined;
        summary.componentTotals.push({
          componentId: component.id,
          name: component.name,
          category: component.category,
          calculationMethod: component.calculationMethod,
          amount: aggregate.amount,
          ...(aggregate.baseDaysCount !== undefined ? { baseDaysCount: aggregate.baseDaysCount } : {}),
          ...(aggregate.baseDays && aggregate.baseDays.length > 0
            ? { baseDays: [...aggregate.baseDays].sort((a, b) => a.localeCompare(b)) }
            : {}),
          ...(earningBreakdown && earningBreakdown.length > 0
            ? { earningBreakdown }
            : {}),
          ...(taskCompletionDailyBreakdown && taskCompletionDailyBreakdown.length > 0
            ? { taskCompletionDailyBreakdown }
            : {}),
        });
        if (aggregate.amount !== 0) {
          summary.bucketTotals[component.category] =
            (summary.bucketTotals[component.category] ?? 0) + aggregate.amount;
          summary.totalPayout += aggregate.amount;
        }

        if (aggregate.amount > 0 && component.category === "commission" && summary.totalCommission > 0) {
          const userBuckets = productBucketsByUser.get(summary.userId);
          if (userBuckets) {
            const positiveBuckets = Array.from(userBuckets.values()).filter(
              (bucket) => bucket.totalCommission > 0,
            );
            if (positiveBuckets.length > 0) {
              const bucketCommissionTotal = positiveBuckets.reduce(
                (sum, bucket) => sum + bucket.totalCommission,
                0,
              );
              const divisor = bucketCommissionTotal > 0 ? bucketCommissionTotal : summary.totalCommission;
              let remaining = aggregate.amount;
              positiveBuckets.forEach((bucket, index) => {
                const ratio = divisor > 0 ? bucket.totalCommission / divisor : 0;
                let allocation = aggregate.amount * ratio;
                if (index === positiveBuckets.length - 1) {
                  allocation = remaining;
                } else {
                  allocation = roundCurrencyValue(allocation);
                  remaining = roundCurrencyValue(remaining - allocation);
                }
                if (allocation > 0) {
                  allocateComponentToProduct(
                    productBucketsByUser,
                    summary.userId,
                    bucket.productId,
                    bucket.productName ?? "Product payout",
                    component.id,
                    allocation,
                  );
                }
              });
            }
          }
        }
      }
    });
  });
};

type AssistantManagerSalaryTakeoverCredit = {
  sourceSummary: CommissionSummary;
  sourceComponent: ComponentTotalEntry;
  taskOwnerUserId: number;
  amount: number;
  taskOwnerRow: AssistantManagerSalaryDailyBreakdown;
};

const applyAssistantManagerSalaryTakeoverSplits = async (
  summaries: Map<number, CommissionSummary>,
): Promise<void> => {
  const componentPlans: Array<{
    sourceSummary: CommissionSummary;
    sourceComponent: ComponentTotalEntry;
    sourceRows: AssistantManagerSalaryDailyBreakdown[];
    credits: AssistantManagerSalaryTakeoverCredit[];
  }> = [];

  // Take a snapshot so newly hydrated task owners are not made eligible for
  // unrelated global compensation assignments in the normal component pass.
  Array.from(summaries.values()).forEach((sourceSummary) => {
    sourceSummary.componentTotals.forEach((sourceComponent) => {
      const dailyRows = sourceComponent.taskCompletionDailyBreakdown;
      if (!dailyRows || dailyRows.length === 0) {
        return;
      }
      const credits: AssistantManagerSalaryTakeoverCredit[] = [];
      const sourceRows = dailyRows.map((row) => {
        if (row.takeoverSplitPolicy?.shiftTakerUserId !== sourceSummary.userId) {
          return row;
        }
        const allocated = allocateAssistantManagerSalaryTakeoverDay(row);
        if (!allocated) {
          return row;
        }
        credits.push({
          sourceSummary,
          sourceComponent,
          taskOwnerUserId: row.takeoverSplitPolicy.taskOwnerUserId,
          amount: allocated.taskOwnerPayableAmount,
          taskOwnerRow: allocated.taskOwnerRow,
        });
        return allocated.shiftTakerRow;
      });
      if (credits.length > 0) {
        componentPlans.push({ sourceSummary, sourceComponent, sourceRows, credits });
      }
    });
  });

  if (componentPlans.length === 0) {
    return;
  }
  const credits = componentPlans.flatMap((plan) => plan.credits);
  await ensureSummariesForUserIds(
    credits.map((credit) => credit.taskOwnerUserId),
    summaries,
  );
  const missingTaskOwner = credits.find(
    (credit) => !summaries.has(credit.taskOwnerUserId),
  );
  if (missingTaskOwner) {
    throw new HttpError(
      409,
      `Task-plan owner #${missingTaskOwner.taskOwnerUserId} could not be loaded for the Assistant Manager Salary takeover split.`,
    );
  }

  componentPlans.forEach((plan) => {
    const transferredAmount = roundCurrencyValue(
      plan.credits.reduce((sum, credit) => sum + credit.amount, 0),
    );
    plan.sourceComponent.amount = roundCurrencyValue(
      plan.sourceComponent.amount - transferredAmount,
    );
    plan.sourceComponent.taskCompletionDailyBreakdown = plan.sourceRows;
    if (plan.sourceComponent.earningBreakdown) {
      plan.sourceComponent.earningBreakdown = mergeCompensationEarningBreakdown([
        ...plan.sourceComponent.earningBreakdown,
        ...plan.credits.map((credit) => ({
          date: credit.taskOwnerRow.date,
          amount: -credit.amount,
        })),
      ]);
    }
    plan.sourceSummary.bucketTotals[plan.sourceComponent.category] = roundCurrencyValue(
      (plan.sourceSummary.bucketTotals[plan.sourceComponent.category] ?? 0)
      - transferredAmount,
    );
    plan.sourceSummary.totalPayout = roundCurrencyValue(
      plan.sourceSummary.totalPayout - transferredAmount,
    );
  });

  credits.forEach((credit) => {
    const taskOwnerSummary = summaries.get(credit.taskOwnerUserId)!;
    let taskOwnerComponent = taskOwnerSummary.componentTotals.find(
      (component) => component.componentId === credit.sourceComponent.componentId,
    );
    if (!taskOwnerComponent) {
      taskOwnerComponent = {
        componentId: credit.sourceComponent.componentId,
        name: credit.sourceComponent.name,
        category: credit.sourceComponent.category,
        calculationMethod: credit.sourceComponent.calculationMethod,
        amount: 0,
        taskCompletionDailyBreakdown: [],
      };
      taskOwnerSummary.componentTotals.push(taskOwnerComponent);
    }
    taskOwnerComponent.amount = roundCurrencyValue(
      taskOwnerComponent.amount + credit.amount,
    );
    taskOwnerComponent.taskCompletionDailyBreakdown = [
      ...(taskOwnerComponent.taskCompletionDailyBreakdown ?? []),
      credit.taskOwnerRow,
    ].sort((left, right) => left.date.localeCompare(right.date));
    taskOwnerComponent.earningBreakdown = mergeCompensationEarningBreakdown([
      ...(taskOwnerComponent.earningBreakdown ?? []),
      { date: credit.taskOwnerRow.date, amount: credit.amount },
    ]);
    taskOwnerSummary.bucketTotals[credit.sourceComponent.category] = roundCurrencyValue(
      (taskOwnerSummary.bucketTotals[credit.sourceComponent.category] ?? 0) + credit.amount,
    );
    taskOwnerSummary.totalPayout = roundCurrencyValue(
      taskOwnerSummary.totalPayout + credit.amount,
    );
  });
};

type TaskScoreSettings = {
  templateIds?: number[];
  minimumMultiplier: number;
  maximumMultiplier: number;
  treatWaivedAsComplete: boolean;
  treatPendingAsComplete: boolean;
};

type PerformanceTierRule = {
  minProgress: number;
  maxProgress: number | null;
  multiplier: number;
  label: string | null;
};

type PerformanceTierSettings = {
  templateIds?: number[];
  treatWaivedAsComplete: boolean;
  treatPendingAsComplete: boolean;
  defaultProgressRatio: number;
  defaultMultiplier: number;
  tiers: PerformanceTierRule[];
};

type PerformanceTierOutcome = {
  multiplier: number;
  progressRatio: number;
  progressPercent: number;
  matchedTierLabel: string | null;
};

const createStatusBucket = (): TaskLogStatusBucket => ({
  total: 0,
  completed: 0,
  waived: 0,
  missed: 0,
  pending: 0,
  totalPoints: 0,
  completedPoints: 0,
  waivedPoints: 0,
  missedPoints: 0,
  pendingPoints: 0,
});

const incrementStatusBucket = (
  bucket: TaskLogStatusBucket,
  status: AssistantManagerTaskStatus,
  points: number,
) => {
  bucket.total += 1;
  bucket.totalPoints += points;
  if (status === "completed") {
    bucket.completed += 1;
    bucket.completedPoints += points;
  } else if (status === "waived") {
    bucket.waived += 1;
    bucket.waivedPoints += points;
  } else if (status === "missed") {
    bucket.missed += 1;
    bucket.missedPoints += points;
  } else {
    bucket.pending += 1;
    bucket.pendingPoints += points;
  }
};

const selectTaskBucket = (
  summary: TaskLogDaySummary | undefined,
  templateIds?: number[],
  fallbackToOverall = true,
): TaskLogStatusBucket | null => {
  if (!summary) {
    return null;
  }
  if (!templateIds || templateIds.length === 0) {
    return summary.overall;
  }
  const aggregate = createStatusBucket();
  templateIds.forEach((templateId) => {
    const bucket = summary.byTemplate.get(templateId);
    if (bucket) {
      aggregate.total += bucket.total;
      aggregate.completed += bucket.completed;
      aggregate.waived += bucket.waived;
      aggregate.missed += bucket.missed;
      aggregate.pending += bucket.pending;
      aggregate.totalPoints += bucket.totalPoints;
      aggregate.completedPoints += bucket.completedPoints;
      aggregate.waivedPoints += bucket.waivedPoints;
      aggregate.missedPoints += bucket.missedPoints;
      aggregate.pendingPoints += bucket.pendingPoints;
    }
  });
  if (aggregate.total === 0) {
    return fallbackToOverall ? summary.overall : aggregate;
  }
  return aggregate;
};

const mergeTaskStatusBucket = (
  target: TaskLogStatusBucket,
  source: TaskLogStatusBucket,
): void => {
  target.total += source.total;
  target.completed += source.completed;
  target.waived += source.waived;
  target.missed += source.missed;
  target.pending += source.pending;
  target.totalPoints += source.totalPoints;
  target.completedPoints += source.completedPoints;
  target.waivedPoints += source.waivedPoints;
  target.missedPoints += source.missedPoints;
  target.pendingPoints += source.pendingPoints;
};

const selectTaskBucketForDates = (
  summary: TaskLogSummary | undefined,
  templateIds: number[] | undefined,
  eligibleDates: ReadonlySet<string> | null,
): TaskLogStatusBucket | null => {
  if (!summary || !eligibleDates) {
    return selectTaskBucket(summary, templateIds);
  }
  const filtered: TaskLogDaySummary = {
    overall: createStatusBucket(),
    byTemplate: new Map<number, TaskLogStatusBucket>(),
  };
  summary.byDate.forEach((daySummary, date) => {
    if (!eligibleDates.has(date)) {
      return;
    }
    mergeTaskStatusBucket(filtered.overall, daySummary.overall);
    daySummary.byTemplate.forEach((bucket, templateId) => {
      const target = filtered.byTemplate.get(templateId) ?? createStatusBucket();
      mergeTaskStatusBucket(target, bucket);
      filtered.byTemplate.set(templateId, target);
    });
  });
  return selectTaskBucket(filtered, templateIds);
};

const taskProgressFromBucket = (
  bucket: TaskLogStatusBucket | null,
): AssistantManagerSalaryDailyTaskProgress | undefined => {
  if (!bucket || bucket.totalPoints <= 0) {
    return undefined;
  }
  return {
    totalTasks: bucket.total,
    completedTasks: bucket.completed,
    waivedTasks: bucket.waived,
    pendingTasks: bucket.pending,
    missedTasks: bucket.missed,
    totalPoints: bucket.totalPoints,
    completedPoints: bucket.completedPoints,
    waivedPoints: bucket.waivedPoints,
    pendingPoints: bucket.pendingPoints,
    missedPoints: bucket.missedPoints,
  };
};

const buildAssistantManagerSalaryTaskProgressForRecipient = (
  context: TaskScoreContext,
  salaryRecipient: CommissionSummary,
  settings: TaskCompletionProrationSettings,
  eligibleDates: string[],
): Map<string, AssistantManagerSalaryDailyTaskProgress> => {
  const progressByDate = new Map<string, AssistantManagerSalaryDailyTaskProgress>();
  if (!settings.effectiveStart) {
    return progressByDate;
  }

  const ownSummary = context.byUser.get(salaryRecipient.userId);
  const managerShiftsByDate = context.managerShiftsByUserAndDate.get(
    salaryRecipient.userId,
  );
  Array.from(new Set(eligibleDates)).forEach((date) => {
    if (date < settings.effectiveStart!) {
      return;
    }

    const ownProgress = taskProgressFromBucket(selectTaskBucket(
      ownSummary?.byDate.get(date),
      settings.templateIds,
      false,
    ));
    const linkedTaskSets: AssistantManagerSalaryLinkedTaskSet[] = (
      context.shiftTaskSetsByDate.get(date) ?? []
    ).flatMap((taskSet) => {
      const taskProgress = taskProgressFromBucket(selectTaskBucket(
        taskSet,
        settings.templateIds,
        false,
      ));
      return taskProgress
        ? [{
            taskOwnerUserId: taskSet.taskOwnerUserId,
            taskOwnerName: taskSet.taskOwnerName,
            shiftInstanceId: taskSet.shiftInstanceId,
            shiftAssignmentIds: Array.from(taskSet.shiftAssignmentIds),
            progress: taskProgress,
          }]
        : [];
    });
    const attributedProgress = resolveAssistantManagerSalaryTaskProgress({
      salaryRecipientUserId: salaryRecipient.userId,
      salaryRecipientName: salaryRecipient.fullName,
      ownProgress,
      managerShifts: managerShiftsByDate?.get(date) ?? [],
      linkedTaskSets,
      approvedTakeovers:
        context.approvedTakeoversByUserAndDate.get(salaryRecipient.userId)?.get(date) ?? [],
    });
    if (attributedProgress) {
      progressByDate.set(date, attributedProgress);
    }
  });
  return progressByDate;
};

const readNumeric = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
};

const readNumericArray = (value: unknown): number[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const appendParsed = (input: unknown, target: number[]) => {
    if (typeof input === "object" && input !== null && "id" in input) {
      appendParsed((input as { id: unknown }).id, target);
      return;
    }

    const parsed = readNumeric(input);
    if (parsed === undefined) {
      return;
    }
    const normalized = Math.trunc(parsed);
    if (Number.isFinite(normalized)) {
      target.push(normalized);
    }
  };

  const collected: number[] = [];
  if (Array.isArray(value)) {
    value.forEach((entry) => appendParsed(entry, collected));
  } else if (typeof value === "string") {
    value
      .split(/[,;\s]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .forEach((token) => appendParsed(token, collected));
  } else {
    appendParsed(value, collected);
  }

  const deduped = Array.from(
    new Set(collected.filter((id) => Number.isInteger(id) && id >= 0)),
  );
  return deduped.length > 0 ? deduped : undefined;
};

const readBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return undefined;
};

type GuideCommissionProductEntry = {
  productId: number | null;
  rate: number;
};

type GuideCommissionConfig = {
  defaultRate: number | null;
  entries: GuideCommissionProductEntry[];
};

function buildGuideCommissionRateLookup(
  components: Array<CompensationComponent & { assignments?: CompensationComponentAssignment[] }>,
): GuideCommissionRateLookup {
  const ratesByProduct = new Map<string, number>();
  let defaultRate = COMMISSION_RATE_PER_ATTENDEE;

  const applyConfig = (config: GuideCommissionConfig | null) => {
    if (!config) {
      return;
    }
    if (config.defaultRate !== null && config.defaultRate !== undefined && Number.isFinite(config.defaultRate)) {
      defaultRate = config.defaultRate;
    }
    config.entries.forEach((entry) => {
      if (!Number.isFinite(entry.rate)) {
        return;
      }
      const key = entry.productId === null ? "__null__" : `${entry.productId}`;
      ratesByProduct.set(key, entry.rate);
    });
  };

  components.forEach((component) => {
    applyConfig(normalizeGuideCommissionConfig(component.config ?? {}));
    component.assignments?.forEach((assignment) => {
      if (!assignment.isActive) {
        return;
      }
      applyConfig(normalizeGuideCommissionConfig(assignment.config ?? {}));
    });
  });

  return {
    defaultRate,
    ratesByProduct,
  };
}

function resolveGuideCommissionRate(lookup: GuideCommissionRateLookup, productId: number | null): number {
  const key = productId === null ? "__null__" : `${productId}`;
  return lookup.ratesByProduct.get(key) ?? lookup.defaultRate;
}

const GUIDE_COMMISSION_CANDIDATE_KEYS = [
  "guideCommission",
  "guide_commission",
  "guideCommissionRates",
  "guide_commission_rates",
  "productCommission",
  "product_commission",
  "productCommissionRates",
  "product_commission_rates",
  "commissionRates",
  "commission_rates",
];

const collectGuideCommissionProductIds = (value: unknown): Array<number | null> => {
  if (value === undefined) {
    return [];
  }
  if (value === null) {
    return [null];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => parseGuideCommissionProductId(entry))
      .filter((entry): entry is number | null => entry !== undefined);
  }
  if (typeof value === "string") {
    const tokens = value
      .split(/[,;\s]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    if (tokens.length > 1) {
      return tokens
        .map((token) => parseGuideCommissionProductId(token))
        .filter((entry): entry is number | null => entry !== undefined);
    }
  }
  const parsed = parseGuideCommissionProductId(value);
  return parsed === undefined ? [] : [parsed];
};

const parseGuideCommissionProductId = (value: unknown): number | null | undefined => {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "null" || normalized === "legacy" || normalized === "none") {
      return null;
    }
  }
  const numeric = readNumeric(value);
  if (numeric === undefined) {
    return undefined;
  }
  const rounded = Math.trunc(numeric);
  if (!Number.isFinite(rounded)) {
    return undefined;
  }
  return rounded;
};

const extractGuideCommissionConfigCandidate = (config: unknown): Record<string, unknown> | null => {
  if (!config || typeof config !== "object") {
    return null;
  }
  const record = config as Record<string, unknown>;
  for (const key of GUIDE_COMMISSION_CANDIDATE_KEYS) {
    const candidate = record[key];
    if (candidate && typeof candidate === "object") {
      return candidate as Record<string, unknown>;
    }
  }
  if (
    "defaultRate" in record ||
    "default_rate" in record ||
    "productRate" in record ||
    "product_rate" in record ||
    "products" in record ||
    "productIds" in record ||
    "product_ids" in record
  ) {
    return record;
  }
  return null;
};

const normalizeGuideCommissionConfig = (config: unknown): GuideCommissionConfig | null => {
  const candidate = extractGuideCommissionConfigCandidate(config);
  if (!candidate) {
    return null;
  }

  const defaultRateCandidate = readNumeric(
    candidate["defaultRate"] ??
      candidate["default_rate"] ??
      candidate["rate"] ??
      candidate["unitAmount"] ??
      candidate["unit_amount"] ??
      candidate["baseRate"] ??
      candidate["base_rate"],
  );

  const entries: GuideCommissionProductEntry[] = [];

  const rawProducts =
    candidate["products"] ??
    candidate["productRates"] ??
    candidate["product_rates"] ??
    candidate["entries"] ??
    candidate["items"];

  if (Array.isArray(rawProducts)) {
    rawProducts.forEach((rawEntry) => {
      if (!rawEntry || typeof rawEntry !== "object") {
        return;
      }
      const record = rawEntry as Record<string, unknown>;
      const rate = readNumeric(
        record["rate"] ?? record["amount"] ?? record["value"] ?? record["unitAmount"] ?? record["unit_amount"],
      );
      if (rate === undefined) {
        return;
      }
      const ids =
        collectGuideCommissionProductIds(
          record["productIds"] ??
            record["product_ids"] ??
            record["products"] ??
            record["productList"] ??
            record["product_list"],
        );
      if (ids.length > 0) {
        ids.forEach((productId) => entries.push({ productId, rate }));
        return;
      }
      const singleIds = collectGuideCommissionProductIds(
        record["productId"] ??
          record["product_id"] ??
          record["id"] ??
          record["counterProductId"] ??
          record["counter_product_id"],
      );
      if (singleIds.length === 0) {
        return;
      }
      singleIds.forEach((productId) => entries.push({ productId, rate }));
    });
  } else {
    const rate = readNumeric(
      candidate["productRate"] ??
        candidate["product_rate"] ??
        candidate["rate"] ??
        candidate["amount"] ??
        candidate["value"] ??
        candidate["unitAmount"] ??
        candidate["unit_amount"],
    );
    const ids =
      collectGuideCommissionProductIds(
        candidate["productIds"] ??
          candidate["product_ids"] ??
          candidate["products"] ??
          candidate["productList"] ??
          candidate["product_list"],
      ) ??
      collectGuideCommissionProductIds(
        candidate["productId"] ??
          candidate["product_id"] ??
          candidate["id"] ??
          candidate["counterProductId"] ??
          candidate["counter_product_id"],
      );
    if (rate !== undefined && ids.length > 0) {
      ids.forEach((productId) => entries.push({ productId, rate }));
    }
  }

  if (entries.length === 0 && (defaultRateCandidate === undefined || Number.isNaN(defaultRateCandidate))) {
    return null;
  }

  return {
    defaultRate:
      defaultRateCandidate !== undefined && Number.isFinite(defaultRateCandidate)
        ? defaultRateCandidate
        : null,
    entries,
  };
};

const normalizeTaskScoreSettings = (config: unknown): Partial<TaskScoreSettings> => {
  if (!config || typeof config !== "object") {
    return {};
  }
  const record = config as Record<string, unknown>;
  const candidate =
    typeof record.taskScore === "object"
      ? (record.taskScore as Record<string, unknown>)
      : typeof record.task_score === "object"
      ? (record.task_score as Record<string, unknown>)
      : record;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const templateIdsRaw = (candidate.templateIds ?? candidate.template_ids) as unknown;
  const templateIds = Array.isArray(templateIdsRaw)
    ? Array.from(
        new Set(
          templateIdsRaw
            .map((entry) => Number(entry))
            .filter((entry) => Number.isInteger(entry) && entry > 0),
        ),
      )
    : undefined;

  const minimumMultiplier =
    readNumeric(
      candidate.minimumMultiplier ??
        candidate.minimum_multiplier ??
        candidate.minimumCompletionRate ??
        candidate.minimum_completion_rate,
    ) ?? undefined;

  const maximumMultiplier =
    readNumeric(
      candidate.maximumMultiplier ??
        candidate.maximum_multiplier ??
        candidate.maximumCompletionRate ??
        candidate.maximum_completion_rate,
    ) ?? undefined;

  const treatWaivedAsComplete =
    readBoolean(
      candidate.treatWaivedAsComplete ??
        candidate.waivedCountsAsComplete ??
        candidate.includeWaived,
    ) ?? undefined;

  const treatPendingAsComplete =
    readBoolean(
      candidate.treatPendingAsComplete ??
        candidate.pendingCountsAsComplete ??
        candidate.includePending,
    ) ?? undefined;

  const settings: Partial<TaskScoreSettings> = {};
  if (templateIds && templateIds.length > 0) {
    settings.templateIds = templateIds;
  }
  if (minimumMultiplier !== undefined) {
    settings.minimumMultiplier = Number(minimumMultiplier);
  }
  if (maximumMultiplier !== undefined) {
    settings.maximumMultiplier = Number(maximumMultiplier);
  }
  if (treatWaivedAsComplete !== undefined) {
    settings.treatWaivedAsComplete = treatWaivedAsComplete;
  }
  if (treatPendingAsComplete !== undefined) {
    settings.treatPendingAsComplete = treatPendingAsComplete;
  }
  return settings;
};

const resolveTaskScoreSettings = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
): TaskScoreSettings => {
  const componentSettings = normalizeTaskScoreSettings(component.config);
  const assignmentSettings = normalizeTaskScoreSettings(assignment.config);

  const merged: TaskScoreSettings = {
    templateIds: assignmentSettings.templateIds ?? componentSettings.templateIds,
    minimumMultiplier:
      assignmentSettings.minimumMultiplier ??
      componentSettings.minimumMultiplier ??
      0,
    maximumMultiplier:
      assignmentSettings.maximumMultiplier ??
      componentSettings.maximumMultiplier ??
      1,
    treatWaivedAsComplete:
      assignmentSettings.treatWaivedAsComplete ??
      componentSettings.treatWaivedAsComplete ??
      true,
    treatPendingAsComplete:
      assignmentSettings.treatPendingAsComplete ??
      componentSettings.treatPendingAsComplete ??
      false,
  };

  if (!merged.templateIds || merged.templateIds.length === 0) {
    merged.templateIds = undefined;
  }

  if (!Number.isFinite(merged.minimumMultiplier) || merged.minimumMultiplier < 0) {
    merged.minimumMultiplier = 0;
  }
  if (!Number.isFinite(merged.maximumMultiplier)) {
    merged.maximumMultiplier = 1;
  }
  if (merged.maximumMultiplier < merged.minimumMultiplier) {
    merged.maximumMultiplier = merged.minimumMultiplier;
  }

  return merged;
};

const normalizeProgressThreshold = (value: number | undefined): number | undefined => {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  const scaled = value > 1 ? value / 100 : value;
  return Math.min(Math.max(scaled, 0), 1);
};

const parsePerformanceTierRules = (value: unknown): PerformanceTierRule[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const rules: PerformanceTierRule[] = [];
  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const candidate = entry as Record<string, unknown>;
    const multiplier =
      readNumeric(
        candidate.multiplier ??
          candidate.payoutMultiplier ??
          candidate.payout_multiplier ??
          candidate.amountMultiplier ??
          candidate.amount_multiplier,
      ) ?? undefined;

    if (multiplier === undefined || !Number.isFinite(multiplier)) {
      return;
    }

    const minProgress = normalizeProgressThreshold(
      readNumeric(
        candidate.minProgress ??
          candidate.min_progress ??
          candidate.minPercent ??
          candidate.min_percent ??
          candidate.from,
      ),
    );
    const maxProgress = normalizeProgressThreshold(
      readNumeric(
        candidate.maxProgress ??
          candidate.max_progress ??
          candidate.maxPercent ??
          candidate.max_percent ??
          candidate.to,
      ),
    );

    const normalizedMin = minProgress ?? 0;
    const normalizedMax = maxProgress ?? null;
    if (normalizedMax !== null && normalizedMax < normalizedMin) {
      return;
    }

    const label =
      typeof candidate.label === "string" && candidate.label.trim().length > 0
        ? candidate.label.trim()
        : null;

    rules.push({
      minProgress: normalizedMin,
      maxProgress: normalizedMax,
      multiplier: multiplier < 0 ? 0 : multiplier,
      label,
    });
  });

  rules.sort((left, right) => {
    if (left.minProgress !== right.minProgress) {
      return right.minProgress - left.minProgress;
    }
    const leftMax = left.maxProgress ?? 1;
    const rightMax = right.maxProgress ?? 1;
    return rightMax - leftMax;
  });

  return rules;
};

const normalizePerformanceTierSettings = (config: unknown): Partial<PerformanceTierSettings> => {
  if (!config || typeof config !== "object") {
    return {};
  }
  const record = config as Record<string, unknown>;
  const candidate =
    typeof record.performanceTier === "object"
      ? (record.performanceTier as Record<string, unknown>)
      : typeof record.performance_tier === "object"
      ? (record.performance_tier as Record<string, unknown>)
      : record;

  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const tiers = parsePerformanceTierRules(candidate.tiers ?? candidate.rules ?? candidate.levels);
  const templateIds = readNumericArray(candidate.templateIds ?? candidate.template_ids)?.filter(
    (id) => Number.isInteger(id) && id > 0,
  );
  const treatWaivedAsComplete =
    readBoolean(
      candidate.treatWaivedAsComplete ??
        candidate.waivedCountsAsComplete ??
        candidate.includeWaived,
    ) ?? undefined;
  const treatPendingAsComplete =
    readBoolean(
      candidate.treatPendingAsComplete ??
        candidate.pendingCountsAsComplete ??
        candidate.includePending,
    ) ?? undefined;
  const defaultProgressRatio = normalizeProgressThreshold(
    readNumeric(candidate.defaultProgressRatio ?? candidate.default_progress_ratio),
  );
  const defaultMultiplier =
    readNumeric(
      candidate.defaultMultiplier ??
        candidate.default_multiplier ??
        candidate.fallbackMultiplier ??
        candidate.fallback_multiplier,
    ) ?? undefined;

  const settings: Partial<PerformanceTierSettings> = {};
  if (tiers.length > 0) {
    settings.tiers = tiers;
  }
  if (templateIds && templateIds.length > 0) {
    settings.templateIds = templateIds;
  }
  if (treatWaivedAsComplete !== undefined) {
    settings.treatWaivedAsComplete = treatWaivedAsComplete;
  }
  if (treatPendingAsComplete !== undefined) {
    settings.treatPendingAsComplete = treatPendingAsComplete;
  }
  if (defaultProgressRatio !== undefined) {
    settings.defaultProgressRatio = defaultProgressRatio;
  }
  if (defaultMultiplier !== undefined) {
    settings.defaultMultiplier = defaultMultiplier;
  }

  return settings;
};

const resolvePerformanceTierSettings = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
): PerformanceTierSettings | null => {
  const componentSettings = normalizePerformanceTierSettings(component.config ?? {});
  const assignmentSettings = normalizePerformanceTierSettings(assignment.config ?? {});

  const tiers = assignmentSettings.tiers ?? componentSettings.tiers;
  if (!tiers || tiers.length === 0) {
    return null;
  }

  const merged: PerformanceTierSettings = {
    tiers,
    templateIds: assignmentSettings.templateIds ?? componentSettings.templateIds,
    treatWaivedAsComplete:
      assignmentSettings.treatWaivedAsComplete ??
      componentSettings.treatWaivedAsComplete ??
      true,
    treatPendingAsComplete:
      assignmentSettings.treatPendingAsComplete ??
      componentSettings.treatPendingAsComplete ??
      false,
    defaultProgressRatio:
      assignmentSettings.defaultProgressRatio ??
      componentSettings.defaultProgressRatio ??
      1,
    defaultMultiplier:
      assignmentSettings.defaultMultiplier ??
      componentSettings.defaultMultiplier ??
      1,
  };

  if (!Number.isFinite(merged.defaultProgressRatio)) {
    merged.defaultProgressRatio = 1;
  }
  merged.defaultProgressRatio = Math.min(Math.max(merged.defaultProgressRatio, 0), 1);

  if (!Number.isFinite(merged.defaultMultiplier) || merged.defaultMultiplier < 0) {
    merged.defaultMultiplier = 1;
  }

  if (!merged.templateIds || merged.templateIds.length === 0) {
    merged.templateIds = undefined;
  }

  return merged;
};

const hasPerformanceTierConfig = (config: unknown): boolean => {
  if (!config || typeof config !== "object") {
    return false;
  }
  const record = config as Record<string, unknown>;
  const candidate =
    (record.performanceTier as unknown) ?? (record.performance_tier as unknown) ?? config;
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  const typedCandidate = candidate as Record<string, unknown>;
  const tiers = typedCandidate.tiers ?? typedCandidate.rules ?? typedCandidate.levels;
  return Array.isArray(tiers) && tiers.length > 0;
};

const resolveTaskProgressByPoints = (
  summary: TaskLogSummary | undefined,
  settings: Pick<PerformanceTierSettings, "templateIds" | "treatWaivedAsComplete" | "treatPendingAsComplete">,
  eligibleDates: ReadonlySet<string> | null,
): number | null => {
  const bucket = selectTaskBucketForDates(summary, settings.templateIds, eligibleDates);
  if (!bucket) {
    return null;
  }

  const denominator = bucket.totalPoints > 0 ? bucket.totalPoints : bucket.total;
  if (denominator <= 0) {
    return null;
  }

  const numerator =
    bucket.completedPoints +
    (settings.treatWaivedAsComplete ? bucket.waivedPoints : 0) +
    (settings.treatPendingAsComplete ? bucket.pendingPoints : 0);

  const ratio = numerator / denominator;
  return Math.min(Math.max(ratio, 0), 1);
};

const resolvePerformanceTierOutcome = (
  summary: CommissionSummary,
  taskScoreLookup: TaskScoreLookup,
  settings: PerformanceTierSettings,
  eligibleDates: ReadonlySet<string> | null,
): PerformanceTierOutcome => {
  const userTaskSummary = taskScoreLookup.get(summary.userId);
  const resolvedProgress =
    resolveTaskProgressByPoints(userTaskSummary, settings, eligibleDates)
    ?? settings.defaultProgressRatio;

  const matchedRule = settings.tiers.find((rule) => {
    if (resolvedProgress < rule.minProgress) {
      return false;
    }
    if (rule.maxProgress !== null && resolvedProgress > rule.maxProgress) {
      return false;
    }
    return true;
  });

  const multiplier = matchedRule?.multiplier ?? settings.defaultMultiplier;
  return {
    multiplier,
    progressRatio: resolvedProgress,
    progressPercent: Math.round(resolvedProgress * 10000) / 100,
    matchedTierLabel: matchedRule?.label ?? null,
  };
};

const clampValue = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const computeTaskScorePayout = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
  summary: CommissionSummary,
  taskScoreLookup: TaskScoreLookup,
  eligibleDates: ReadonlySet<string> | null,
): ComponentComputationResult => {
  const baseAmount = Number(assignment.baseAmount ?? 0);
  if (baseAmount === 0) {
    return { amount: 0 };
  }

  const userSummary = taskScoreLookup.get(summary.userId);
  if (!userSummary) {
    return { amount: baseAmount };
  }

  const settings = resolveTaskScoreSettings(component, assignment);
  const bucket = selectTaskBucketForDates(userSummary, settings.templateIds, eligibleDates);
  if (!bucket || bucket.total === 0) {
    return { amount: baseAmount };
  }

  const completedCount =
    bucket.completed +
    (settings.treatWaivedAsComplete ? bucket.waived : 0) +
    (settings.treatPendingAsComplete ? bucket.pending : 0);

  const completionRatio = bucket.total > 0 ? completedCount / bucket.total : 1;
  const multiplier = clampValue(
    completionRatio,
    settings.minimumMultiplier,
    settings.maximumMultiplier,
  );

  let total = baseAmount * multiplier;
  const unitAmount = Number(assignment.unitAmount ?? 0);
  if (!Number.isNaN(unitAmount) && unitAmount !== 0) {
    total += unitAmount * completedCount;
  }

  const dailyWeights: Array<{ date: string; weight: number }> = [];
  userSummary.byDate.forEach((daySummary, date) => {
    if (eligibleDates && !eligibleDates.has(date)) {
      return;
    }
    const dayBucket = selectTaskBucket(daySummary, settings.templateIds);
    if (!dayBucket || dayBucket.total <= 0) {
      return;
    }
    const dayCompleted = dayBucket.completed
      + (settings.treatWaivedAsComplete ? dayBucket.waived : 0)
      + (settings.treatPendingAsComplete ? dayBucket.pending : 0);
    dailyWeights.push({
      date,
      weight: dayCompleted > 0 ? dayCompleted : dayBucket.total,
    });
  });

  return {
    amount: total,
    earningBreakdown: allocateCompensationAmountByDateWeights(total, dailyWeights),
  };
};

const resolveTaskLogPoints = (metaValue: unknown, templateConfigValue: unknown): number => {
  const meta = metaValue && typeof metaValue === "object"
    ? metaValue as Record<string, unknown>
    : {};
  const templateConfig = templateConfigValue && typeof templateConfigValue === "object"
    ? templateConfigValue as Record<string, unknown>
    : {};
  const candidate =
    readNumeric(
      meta.points ??
        meta.pointValue ??
        meta.point_value ??
        meta.score ??
        templateConfig.points,
    ) ?? 1;
  if (!Number.isFinite(candidate) || candidate < 0) {
    return 1;
  }
  return candidate;
};

const buildTaskScoreContext = async (
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
): Promise<TaskScoreContext> => {
  const dateRange = [rangeStart.format("YYYY-MM-DD"), rangeEnd.format("YYYY-MM-DD")];
  const [logs, shiftAssignments, approvedTakeoverRequests] = await Promise.all([
    AssistantManagerTaskLog.findAll({
      attributes: ["userId", "templateId", "taskDate", "status", "meta"],
      include: [
        {
          model: AssistantManagerTaskTemplate,
          as: "template",
          attributes: ["id", "scheduleConfig"],
          required: false,
        },
        {
          model: User,
          as: "user",
          attributes: ["id", "firstName", "lastName"],
          required: false,
        },
      ],
      where: {
        taskDate: {
          [Op.between]: dateRange,
        },
      },
    }),
    ShiftAssignment.findAll({
      attributes: ["id", "userId", "shiftInstanceId", "roleInShift"],
      include: [
        {
          model: ShiftInstance,
          as: "shiftInstance",
          attributes: ["id", "date"],
          required: true,
          where: {
            date: {
              [Op.between]: dateRange,
            },
          },
        },
        {
          model: ShiftRole,
          as: "shiftRole",
          attributes: ["id", "name", "slug"],
          required: false,
        },
      ],
    }),
    SwapRequest.findAll({
      attributes: [
        "requesterId",
        "partnerId",
        "fromAssignmentId",
        "assignmentSnapshot",
      ],
      where: {
        requestType: "takeover",
        status: "approved",
      },
    }),
  ]);

  const summaryByUser = new Map<number, TaskLogSummary>();
  const shiftTaskSetsByDate = new Map<string, ShiftTaskDaySummary[]>();
  const shiftTaskSetIndex = new Map<string, ShiftTaskDaySummary>();

  logs.forEach((log) => {
    const userId = log.getDataValue("userId");
    if (!userId) {
      return;
    }
    const templateId = log.getDataValue("templateId");
    const status = log.getDataValue("status") as AssistantManagerTaskStatus;
    const taskDate = String(log.getDataValue("taskDate") ?? "");
    const typedLog = log as AssistantManagerTaskLog & {
      template?: AssistantManagerTaskTemplate | null;
      user?: User | null;
    };
    const template = typedLog.template ?? null;
    const taskOwnerName = [typedLog.user?.firstName, typedLog.user?.lastName]
      .map((name) => String(name ?? "").trim())
      .filter(Boolean)
      .join(" ") || `Staff #${userId}`;
    const metaValue = log.getDataValue("meta");
    const meta = metaValue && typeof metaValue === "object"
      ? metaValue as Record<string, unknown>
      : {};
    const points = resolveTaskLogPoints(
      metaValue,
      template?.scheduleConfig,
    );

    let userSummary = summaryByUser.get(userId);
    if (!userSummary) {
      userSummary = {
        overall: createStatusBucket(),
        byTemplate: new Map<number, TaskLogStatusBucket>(),
        byDate: new Map<string, TaskLogDaySummary>(),
      };
      summaryByUser.set(userId, userSummary);
    }

    incrementStatusBucket(userSummary.overall, status, points);
    if (templateId) {
      let templateSummary = userSummary.byTemplate.get(templateId);
      if (!templateSummary) {
        templateSummary = createStatusBucket();
        userSummary.byTemplate.set(templateId, templateSummary);
      }
      incrementStatusBucket(templateSummary, status, points);
    }
    if (/^\d{4}-\d{2}-\d{2}$/u.test(taskDate)) {
      let daySummary = userSummary.byDate.get(taskDate);
      if (!daySummary) {
        daySummary = {
          overall: createStatusBucket(),
          byTemplate: new Map<number, TaskLogStatusBucket>(),
        };
        userSummary.byDate.set(taskDate, daySummary);
      }
      incrementStatusBucket(daySummary.overall, status, points);
      if (templateId) {
        let dayTemplateSummary = daySummary.byTemplate.get(templateId);
        if (!dayTemplateSummary) {
          dayTemplateSummary = createStatusBucket();
          daySummary.byTemplate.set(templateId, dayTemplateSummary);
        }
        incrementStatusBucket(dayTemplateSummary, status, points);
      }

      const shiftInstanceId = normalizeUserId(meta.shiftInstanceId);
      const shiftAssignmentId = normalizeUserId(meta.shiftAssignmentId);
      if (shiftInstanceId) {
        const taskSetKey = `${taskDate}:${shiftInstanceId}:${userId}`;
        let shiftTaskSet = shiftTaskSetIndex.get(taskSetKey);
        if (!shiftTaskSet) {
          shiftTaskSet = {
            overall: createStatusBucket(),
            byTemplate: new Map<number, TaskLogStatusBucket>(),
            taskOwnerUserId: userId,
            taskOwnerName,
            shiftInstanceId,
            shiftAssignmentIds: new Set<number>(),
          };
          shiftTaskSetIndex.set(taskSetKey, shiftTaskSet);
          const dateTaskSets = shiftTaskSetsByDate.get(taskDate) ?? [];
          dateTaskSets.push(shiftTaskSet);
          shiftTaskSetsByDate.set(taskDate, dateTaskSets);
        }
        if (shiftAssignmentId) {
          shiftTaskSet.shiftAssignmentIds.add(shiftAssignmentId);
        }
        incrementStatusBucket(shiftTaskSet.overall, status, points);
        if (templateId) {
          let shiftTemplateSummary = shiftTaskSet.byTemplate.get(templateId);
          if (!shiftTemplateSummary) {
            shiftTemplateSummary = createStatusBucket();
            shiftTaskSet.byTemplate.set(templateId, shiftTemplateSummary);
          }
          incrementStatusBucket(shiftTemplateSummary, status, points);
        }
      }
    }
  });

  const managerShiftsByUserAndDate: ManagerShiftsByUserAndDate = new Map();
  shiftAssignments.forEach((assignment) => {
    const typedAssignment = assignment as ShiftAssignment & {
      shiftInstance?: ShiftInstance | null;
      shiftRole?: ShiftRole | null;
    };
    const shiftInstance = typedAssignment.shiftInstance ?? null;
    if (!shiftInstance) {
      return;
    }
    const roleCandidates = [
      typedAssignment.roleInShift,
      typedAssignment.shiftRole?.slug,
      typedAssignment.shiftRole?.name,
    ].map(normalizeRoleSlug);
    if (!roleCandidates.some((role) => role && MANAGER_ROLE_SLUGS.has(role))) {
      return;
    }
    const userId = normalizeUserId(typedAssignment.userId);
    const shiftInstanceId = normalizeUserId(typedAssignment.shiftInstanceId);
    const shiftAssignmentId = normalizeUserId(typedAssignment.id);
    const date = String(shiftInstance.date ?? "");
    if (!userId || !shiftInstanceId || !shiftAssignmentId || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
      return;
    }

    let shiftsByDate = managerShiftsByUserAndDate.get(userId);
    if (!shiftsByDate) {
      shiftsByDate = new Map<string, AssistantManagerSalaryManagerShift[]>();
      managerShiftsByUserAndDate.set(userId, shiftsByDate);
    }
    const managerShifts = shiftsByDate.get(date) ?? [];
    let managerShift = managerShifts.find(
      (candidate) => candidate.shiftInstanceId === shiftInstanceId,
    );
    if (!managerShift) {
      managerShift = { shiftInstanceId, shiftAssignmentIds: [] };
      managerShifts.push(managerShift);
      shiftsByDate.set(date, managerShifts);
    }
    if (!managerShift.shiftAssignmentIds.includes(shiftAssignmentId)) {
      managerShift.shiftAssignmentIds.push(shiftAssignmentId);
    }
  });

  const approvedTakeoversByUserAndDate: ApprovedTakeoversByUserAndDate = new Map();
  approvedTakeoverRequests.forEach((request) => {
    const shiftTakerUserId = normalizeUserId(request.getDataValue("requesterId"));
    const partnerUserId = normalizeUserId(request.getDataValue("partnerId"));
    const fromAssignmentId = normalizeUserId(request.getDataValue("fromAssignmentId"));
    const snapshotValue = request.getDataValue("assignmentSnapshot") as unknown;
    if (
      !shiftTakerUserId
      || !snapshotValue
      || typeof snapshotValue !== "object"
      || Array.isArray(snapshotValue)
    ) {
      return;
    }

    const snapshot = snapshotValue as Record<string, unknown>;
    const shiftInstanceValue = snapshot.shiftInstance;
    const shiftInstance = shiftInstanceValue
      && typeof shiftInstanceValue === "object"
      && !Array.isArray(shiftInstanceValue)
      ? shiftInstanceValue as Record<string, unknown>
      : null;
    const date = typeof shiftInstance?.date === "string"
      ? shiftInstance.date.trim()
      : "";
    const shiftInstanceId = normalizeUserId(
      snapshot.shiftInstanceId ?? shiftInstance?.id,
    );
    const originalOwnerUserId = normalizeUserId(snapshot.userId) ?? partnerUserId;
    if (
      !shiftInstanceId
      || !originalOwnerUserId
      || !/^\d{4}-\d{2}-\d{2}$/u.test(date)
      || date < dateRange[0]
      || date > dateRange[1]
    ) {
      return;
    }

    const assigneeValue = snapshot.assignee;
    const assignee = assigneeValue
      && typeof assigneeValue === "object"
      && !Array.isArray(assigneeValue)
      ? assigneeValue as Record<string, unknown>
      : null;
    const originalOwnerName = [assignee?.firstName, assignee?.lastName]
      .map((name) => typeof name === "string" ? name.trim() : "")
      .filter(Boolean)
      .join(" ") || `Staff #${originalOwnerUserId}`;
    const approvedTakeover: AssistantManagerSalaryApprovedTakeover = {
      originalOwnerUserId,
      originalOwnerName,
      shiftInstanceId,
      shiftAssignmentId: normalizeUserId(snapshot.id) ?? fromAssignmentId,
      originalRoleInShift:
        typeof snapshot.roleInShift === "string" ? snapshot.roleInShift.trim() : null,
    };
    let takeoversByDate = approvedTakeoversByUserAndDate.get(shiftTakerUserId);
    if (!takeoversByDate) {
      takeoversByDate = new Map<string, AssistantManagerSalaryApprovedTakeover[]>();
      approvedTakeoversByUserAndDate.set(shiftTakerUserId, takeoversByDate);
    }
    const dateTakeovers = takeoversByDate.get(date) ?? [];
    const duplicate = dateTakeovers.some((candidate) =>
      candidate.originalOwnerUserId === approvedTakeover.originalOwnerUserId
      && candidate.shiftInstanceId === approvedTakeover.shiftInstanceId
      && candidate.shiftAssignmentId === approvedTakeover.shiftAssignmentId,
    );
    if (!duplicate) {
      dateTakeovers.push(approvedTakeover);
      takeoversByDate.set(date, dateTakeovers);
    }
  });

  return {
    byUser: summaryByUser,
    shiftTaskSetsByDate,
    managerShiftsByUserAndDate,
    approvedTakeoversByUserAndDate,
  };
};

type NightReportIncentiveSettings = {
  minAttendance: number;
  minReports: number;
  retentionThreshold: number;
  payoutPerQualifiedReport: number;
  retentionBonusPerDay: number;
  bestOfRangeBonus: number;
  perCustomerRate: number;
  perCustomerSource: 'total' | 'open_bar';
  dynamicMinAttendanceMultiplier: number;
  allowedProductIds: number[] | null;
};

type NightReportBestCacheEntry = {
  topUserIds: Set<number>;
  topHits: number;
};

type ReviewPayoutSettings = {
  minReviews: number;
  maxReviews: number | null;
  rate: number;
};

type PlatformGuestTier = {
  size: number | null;
  rate: number;
};

type PlatformGuestSettings = {
  minimumGuests: number;
  tiers: PlatformGuestTier[];
};

const buildProductFilterSet = (productIds: number[] | null): Set<number> | null => {
  if (!productIds || productIds.length === 0) {
    return null;
  }
  return new Set(productIds);
};

const reportMatchesProductFilter = (
  report: { productId: number | null },
  filter: Set<number> | null,
): boolean => {
  if (!filter) {
    return true;
  }
  if (report.productId === null || report.productId === undefined) {
    return false;
  }
  return filter.has(report.productId);
};

const normalizeNightReportConfig = (config: unknown): Partial<NightReportIncentiveSettings> => {
  if (!config || typeof config !== "object") {
    return {};
  }
  const record = config as Record<string, unknown>;
  const candidate =
    typeof record.nightReport === "object"
      ? (record.nightReport as Record<string, unknown>)
      : typeof record.night_report === "object"
      ? (record.night_report as Record<string, unknown>)
      : record;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const settings: Partial<NightReportIncentiveSettings> = {};

  const minAttendance =
    readNumeric(candidate.minAttendance ?? candidate.min_attendance ?? candidate.minimumAttendance) ??
    undefined;
  if (minAttendance !== undefined) {
    settings.minAttendance = minAttendance;
  }

  const minReports =
    readNumeric(candidate.minReports ?? candidate.min_reports ?? candidate.minimumReports) ?? undefined;
  if (minReports !== undefined) {
    settings.minReports = minReports;
  }

  const retentionThreshold =
    readNumeric(
      candidate.retentionThreshold ??
        candidate.retention_threshold ??
        candidate.retentionTarget ??
        candidate.retention_target,
    ) ?? undefined;
  if (retentionThreshold !== undefined) {
    settings.retentionThreshold = retentionThreshold;
  }

  const payoutPerQualifiedReport =
    readNumeric(
      candidate.payoutPerQualifiedReport ??
        candidate.payout_per_qualified_report ??
        candidate.payoutPerReport ??
        candidate.payout_per_report,
    ) ?? undefined;
  if (payoutPerQualifiedReport !== undefined) {
    settings.payoutPerQualifiedReport = payoutPerQualifiedReport;
  }

  const retentionBonusPerDay =
    readNumeric(
      candidate.retentionBonusPerDay ??
        candidate.retention_bonus_per_day ??
        candidate.retentionBonus ??
        candidate.retention_bonus,
    ) ?? undefined;
  if (retentionBonusPerDay !== undefined) {
    settings.retentionBonusPerDay = retentionBonusPerDay;
  }

  const bestOfRangeBonus =
    readNumeric(
      candidate.bestOfRangeBonus ??
        candidate.best_of_range_bonus ??
        candidate.bestStaffBonus ??
        candidate.best_staff_bonus,
    ) ?? undefined;
  if (bestOfRangeBonus !== undefined) {
    settings.bestOfRangeBonus = bestOfRangeBonus;
  }

  const perCustomerRate =
    readNumeric(
      candidate.perCustomerRate ??
        candidate.per_customer_rate ??
        candidate.perAttendeeRate ??
        candidate.per_attendee_rate,
    ) ?? undefined;
  if (perCustomerRate !== undefined) {
    settings.perCustomerRate = perCustomerRate;
  }

  const perCustomerSourceRaw =
    candidate.perCustomerSource ??
    candidate.per_customer_source ??
    candidate.attendanceSource ??
    candidate.attendance_source;
  if (typeof perCustomerSourceRaw === 'string') {
    const normalized = perCustomerSourceRaw.trim().toLowerCase();
    settings.perCustomerSource = normalized === 'open_bar' || normalized === 'openbar' ? 'open_bar' : 'total';
  }

  const dynamicMultiplier =
    readNumeric(
      candidate.dynamicMinAttendanceMultiplier ??
        candidate.dynamic_min_attendance_multiplier ??
        candidate.attendanceMultiplier ??
        candidate.attendance_multiplier,
    ) ?? undefined;
  if (dynamicMultiplier !== undefined) {
    settings.dynamicMinAttendanceMultiplier = dynamicMultiplier;
  }

  const allowedProducts =
    readNumericArray(
      candidate.allowedProductIds ??
        candidate.allowed_product_ids ??
        candidate.productIds ??
        candidate.product_ids ??
        candidate.products ??
        candidate.productFilter ??
        candidate.product_filter,
    ) ?? undefined;
  if (allowedProducts !== undefined) {
    settings.allowedProductIds = allowedProducts;
  }

  return settings;
};

const normalizeReviewPayoutConfig = (config: unknown): Partial<ReviewPayoutSettings> => {
  if (!config || typeof config !== "object") {
    return {};
  }
  const record = config as Record<string, unknown>;
  const candidate =
    typeof record.reviewPayout === "object"
      ? (record.reviewPayout as Record<string, unknown>)
      : typeof record.review_payout === "object"
      ? (record.review_payout as Record<string, unknown>)
      : record;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const settings: Partial<ReviewPayoutSettings> = {};
  const minReviews =
    readNumeric(
      candidate.minReviews ??
        candidate.min_reviews ??
        candidate.minimumReviews ??
        candidate.minimum_reviews,
    ) ?? undefined;
  if (minReviews !== undefined) {
    settings.minReviews = Math.max(1, Math.floor(minReviews));
  }

  const maxReviews =
    readNumeric(
      candidate.maxReviews ??
        candidate.max_reviews ??
        candidate.maximumReviews ??
        candidate.maximum_reviews,
    ) ?? undefined;
  if (maxReviews !== undefined) {
    settings.maxReviews = Math.max(1, Math.floor(maxReviews));
  }

  const rate = readNumeric(candidate.rate ?? candidate.amount) ?? undefined;
  if (rate !== undefined) {
    settings.rate = rate;
  }

  return settings;
};

type ReviewTargetRequirement = {
  minReviews: number;
};

const normalizeReviewRequirementConfig = (config: unknown): Partial<ReviewTargetRequirement> => {
  if (!config || typeof config !== "object") {
    return {};
  }
  const record = config as Record<string, unknown>;
  const candidate =
    typeof record.requiresReviewTarget === "object"
      ? (record.requiresReviewTarget as Record<string, unknown>)
      : typeof record.requires_review_target === "object"
      ? (record.requires_review_target as Record<string, unknown>)
      : record;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const minReviews =
    readNumeric(
      candidate.minReviews ??
        candidate.min_reviews ??
        candidate.minimumReviews ??
        candidate.minimum_reviews,
    ) ?? undefined;
  if (minReviews === undefined) {
    return {};
  }
  return { minReviews: Math.max(1, Math.floor(minReviews)) };
};

const normalizePlatformGuestConfig = (config: unknown): Partial<PlatformGuestSettings> => {
  if (!config || typeof config !== "object") {
    return {};
  }
  const record = config as Record<string, unknown>;
  const candidate =
    typeof record.platformGuests === "object"
      ? (record.platformGuests as Record<string, unknown>)
      : typeof record.platform_guests === "object"
      ? (record.platform_guests as Record<string, unknown>)
      : record;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const tiersRaw = Array.isArray(candidate.tiers) ? candidate.tiers : [];
  const tiers: PlatformGuestTier[] = [];
  tiersRaw.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const bucket = entry as Record<string, unknown>;
    const sizeRaw = readNumeric(bucket.size ?? bucket.block ?? bucket.units ?? bucket.limit);
    const rateRaw = readNumeric(bucket.rate ?? bucket.amount ?? bucket.unitAmount ?? bucket.unit_amount);
    if (!Number.isFinite(rateRaw) || rateRaw === undefined || rateRaw === null) {
      return;
    }
    const normalizedSize =
      sizeRaw !== undefined && sizeRaw !== null
        ? Math.max(1, Math.floor(sizeRaw))
        : null;
    tiers.push({
      size: normalizedSize,
      rate: rateRaw,
    });
  });

  const minimumGuests =
    readNumeric(candidate.minimumGuests ?? candidate.minimum_guests) ??
    (tiers.length > 0 && tiers[0].size ? tiers[0].size : 0) ??
    0;

  return {
    minimumGuests: Math.max(0, Math.floor(minimumGuests)),
    tiers,
  };
};

const resolveNightReportSettings = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
): NightReportIncentiveSettings => {
  const componentSettings = normalizeNightReportConfig(component.config ?? {});
  const assignmentSettings = normalizeNightReportConfig(assignment.config ?? {});
  const merged: NightReportIncentiveSettings = {
    minAttendance: assignmentSettings.minAttendance ?? componentSettings.minAttendance ?? 0,
    minReports: assignmentSettings.minReports ?? componentSettings.minReports ?? 0,
    retentionThreshold:
      assignmentSettings.retentionThreshold ?? componentSettings.retentionThreshold ?? 0,
    payoutPerQualifiedReport:
      assignmentSettings.payoutPerQualifiedReport ??
      componentSettings.payoutPerQualifiedReport ??
      Number(assignment.baseAmount ?? 0),
    retentionBonusPerDay:
      assignmentSettings.retentionBonusPerDay ??
      componentSettings.retentionBonusPerDay ??
      Number(assignment.unitAmount ?? 0),
    bestOfRangeBonus:
      assignmentSettings.bestOfRangeBonus ?? componentSettings.bestOfRangeBonus ?? 0,
    perCustomerRate:
      assignmentSettings.perCustomerRate ?? componentSettings.perCustomerRate ?? 0,
    perCustomerSource:
      assignmentSettings.perCustomerSource ?? componentSettings.perCustomerSource ?? 'total',
    dynamicMinAttendanceMultiplier:
      assignmentSettings.dynamicMinAttendanceMultiplier ??
      componentSettings.dynamicMinAttendanceMultiplier ??
      4,
    allowedProductIds:
      assignmentSettings.allowedProductIds ??
      componentSettings.allowedProductIds ??
      null,
  };

  if (!Number.isFinite(merged.minAttendance) || merged.minAttendance < 0) {
    merged.minAttendance = 0;
  }
  if (!Number.isFinite(merged.minReports) || merged.minReports < 0) {
    merged.minReports = 0;
  }
  if (!Number.isFinite(merged.retentionThreshold)) {
    merged.retentionThreshold = 0;
  } else if (merged.retentionThreshold > 1) {
    merged.retentionThreshold = 1;
  } else if (merged.retentionThreshold < 0) {
    merged.retentionThreshold = 0;
  }
  if (!Number.isFinite(merged.payoutPerQualifiedReport)) {
    merged.payoutPerQualifiedReport = 0;
  }
  if (!Number.isFinite(merged.retentionBonusPerDay)) {
    merged.retentionBonusPerDay = 0;
  }
  if (!Number.isFinite(merged.bestOfRangeBonus)) {
    merged.bestOfRangeBonus = 0;
  }
  if (!Number.isFinite(merged.perCustomerRate) || merged.perCustomerRate < 0) {
    merged.perCustomerRate = 0;
  }
  if (merged.perCustomerSource !== 'open_bar') {
    merged.perCustomerSource = 'total';
  }
  if (!Number.isFinite(merged.dynamicMinAttendanceMultiplier) || merged.dynamicMinAttendanceMultiplier <= 0) {
    merged.dynamicMinAttendanceMultiplier = 4;
  }
  if (merged.allowedProductIds && merged.allowedProductIds.length > 0) {
    const sanitized = Array.from(
      new Set(
        merged.allowedProductIds.filter((id) => Number.isInteger(id) && id >= 0),
      ),
    ).sort((a, b) => a - b);
    merged.allowedProductIds = sanitized.length > 0 ? sanitized : null;
  } else {
    merged.allowedProductIds = null;
  }

  return merged;
};

const resolveReviewPayoutSettings = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
): ReviewPayoutSettings | null => {
  const componentSettings = normalizeReviewPayoutConfig(component.config ?? {});
  const assignmentSettings = normalizeReviewPayoutConfig(assignment.config ?? {});

  const minReviewsCandidate =
    assignmentSettings.minReviews ?? componentSettings.minReviews ?? 1;
  const maxReviewsCandidate =
    assignmentSettings.maxReviews ?? componentSettings.maxReviews ?? null;
  const rateCandidate = assignmentSettings.rate ?? componentSettings.rate;

  if (rateCandidate === undefined || rateCandidate === null) {
    return null;
  }
  if (!Number.isFinite(rateCandidate) || rateCandidate === 0) {
    return null;
  }

  const minReviews = Math.max(1, Math.floor(minReviewsCandidate));
  let maxReviews: number | null = null;
  if (maxReviewsCandidate !== null && maxReviewsCandidate !== undefined) {
    const normalizedMax = Math.max(minReviews, Math.floor(maxReviewsCandidate));
    maxReviews = normalizedMax;
  }

  return {
    minReviews,
    maxReviews,
    rate: rateCandidate,
  };
};

const resolveReviewTargetRequirement = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
): ReviewTargetRequirement | null => {
  const componentRequirement = normalizeReviewRequirementConfig(component.config ?? {});
  const assignmentRequirement = normalizeReviewRequirementConfig(assignment.config ?? {});

  let minReviews =
    assignmentRequirement.minReviews ?? componentRequirement.minReviews ?? null;

  if ((minReviews === null || minReviews <= 0) && component.category === "review") {
    minReviews = REVIEW_MINIMUM_THRESHOLD;
  }

  if (minReviews === null || minReviews <= 0) {
    return null;
  }

  return { minReviews };
};

const computeReviewPayoutAmount = (
  summary: CommissionSummary,
  settings: ReviewPayoutSettings,
): number => {
  const eligibleReviews = summary.reviewTotals?.totalEligibleReviews ?? 0;
  if (eligibleReviews < settings.minReviews) {
    return 0;
  }

  const upperBound = settings.maxReviews ?? eligibleReviews;
  const cappedUpper = Math.min(eligibleReviews, upperBound);
  if (cappedUpper < settings.minReviews) {
    return 0;
  }

  const units = cappedUpper - settings.minReviews + 1;
  if (units <= 0) {
    return 0;
  }

  return units * settings.rate;
};

const resolvePlatformGuestSettings = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
): PlatformGuestSettings | null => {
  const componentSettings = normalizePlatformGuestConfig(component.config ?? {});
  const assignmentSettings = normalizePlatformGuestConfig(assignment.config ?? {});

  const tiers = (assignmentSettings.tiers ?? componentSettings.tiers ?? []).filter(
    (tier): tier is PlatformGuestTier =>
      !!tier && Number.isFinite(tier.rate) && tier.rate !== 0 && (tier.size === null || tier.size > 0),
  );

  if (tiers.length === 0) {
    return null;
  }

  const minimumGuests =
    assignmentSettings.minimumGuests ??
    componentSettings.minimumGuests ??
    (tiers[0].size ?? 0);

  return {
    minimumGuests: Math.max(0, Math.floor(minimumGuests)),
    tiers,
  };
};

const computePlatformGuestPayout = (
  summary: CommissionSummary,
  settings: PlatformGuestSettings,
  componentId: number,
): number => {
  const totalGuests = summary.platformGuestTotals?.totalGuests ?? 0;
  if (totalGuests < settings.minimumGuests || totalGuests <= 0) {
    delete summary.platformGuestBreakdowns[componentId];
    return 0;
  }

  let remaining = totalGuests;
  let total = 0;
  let processed = 0;
  const breakdownEntries: PlatformGuestTierBreakdown[] = [];
  for (const tier of settings.tiers) {
    const tierSize = tier.size ?? remaining;
    if (tierSize <= 0) {
      continue;
    }
    const units = Math.min(remaining, tierSize);
    if (units <= 0) {
      break;
    }
    total += units * tier.rate;
    processed += units;
    breakdownEntries.push({
      tierIndex: breakdownEntries.length,
      rate: tier.rate,
      units,
      amount: units * tier.rate,
      cumulativeGuests: processed,
    });
    remaining -= units;
    if (remaining <= 0) {
      break;
    }
  }

  if (breakdownEntries.length > 0) {
    summary.platformGuestBreakdowns[componentId] = breakdownEntries;
  } else {
    delete summary.platformGuestBreakdowns[componentId];
  }

  return total;
};

const MONTHLY_BASE_CONFIG_KEYS = [
  "monthlyBase",
  "monthly_base",
  "monthlySalary",
  "monthly_salary",
  "baseSalary",
  "base_salary",
  "salary",
];

const resolveMonthlyBaseSettings = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
): MonthlyBaseSettings | null => {
  const componentSettings = normalizeMonthlyBaseConfig(component.config ?? {});
  const assignmentSettings = normalizeMonthlyBaseConfig(assignment.config ?? {});
  if (!assignmentSettings && !componentSettings) {
    return null;
  }
  if (!assignmentSettings) {
    return componentSettings;
  }
  if (!componentSettings) {
    return assignmentSettings;
  }
  if (assignmentSettings.mode !== componentSettings.mode) {
    return assignmentSettings;
  }
  return mergeMonthlyBaseSettings(componentSettings, assignmentSettings);
};

const normalizeTaskCompletionProrationSettings = (
  value: unknown,
): TaskCompletionProrationSettings | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const effectiveStartRaw = typeof record.effectiveStart === "string"
    ? record.effectiveStart.trim()
    : typeof record.effective_start === "string"
      ? record.effective_start.trim()
      : "";
  const effectiveStart = /^\d{4}-\d{2}-\d{2}$/u.test(effectiveStartRaw)
    && dayjs(effectiveStartRaw).isValid()
    && dayjs(effectiveStartRaw).format("YYYY-MM-DD") === effectiveStartRaw
    ? effectiveStartRaw
    : null;
  const requestedEnabled = readBoolean(record.enabled) ?? false;
  const templateIds = readNumericArray(record.templateIds ?? record.template_ids)
    ?.filter((id) => Number.isInteger(id) && id > 0);
  const takeoverSplitRecord = (
    record.takeoverSplit ?? record.takeover_split
  );
  let takeoverSplit: AssistantManagerSalaryTakeoverSplitSettings | undefined;
  if (
    takeoverSplitRecord
    && typeof takeoverSplitRecord === "object"
    && !Array.isArray(takeoverSplitRecord)
  ) {
    const takeoverRecord = takeoverSplitRecord as Record<string, unknown>;
    const takeoverEffectiveStartRaw = typeof takeoverRecord.effectiveStart === "string"
      ? takeoverRecord.effectiveStart.trim()
      : typeof takeoverRecord.effective_start === "string"
        ? takeoverRecord.effective_start.trim()
        : "";
    const takeoverEffectiveStart = /^\d{4}-\d{2}-\d{2}$/u.test(takeoverEffectiveStartRaw)
      && dayjs(takeoverEffectiveStartRaw).isValid()
      && dayjs(takeoverEffectiveStartRaw).format("YYYY-MM-DD") === takeoverEffectiveStartRaw
      ? takeoverEffectiveStartRaw
      : null;
    const shiftTakerPercent = readNumeric(
      takeoverRecord.shiftTakerPercent
      ?? takeoverRecord.shift_taker_percent
      ?? takeoverRecord.recipientPercent
      ?? takeoverRecord.recipient_percent,
    ) ?? 50;
    const takeoverEnabled = readBoolean(takeoverRecord.enabled) ?? false;
    takeoverSplit = {
      enabled:
        takeoverEnabled
        && takeoverEffectiveStart !== null
        && shiftTakerPercent > 0
        && shiftTakerPercent < 100,
      effectiveStart: takeoverEffectiveStart,
      shiftTakerPercent:
        Number.isFinite(shiftTakerPercent) && shiftTakerPercent > 0 && shiftTakerPercent < 100
          ? shiftTakerPercent
          : 50,
    };
  }

  return {
    // An enabled rule without a valid date would silently rewrite all closed
    // payroll history, so fail closed until the cutover is explicit.
    enabled: requestedEnabled && effectiveStart !== null,
    effectiveStart,
    ...(templateIds && templateIds.length > 0
      ? { templateIds: Array.from(new Set(templateIds)) }
      : {}),
    treatWaivedAsComplete:
      readBoolean(record.treatWaivedAsComplete ?? record.treat_waived_as_complete) ?? true,
    treatPendingAsComplete:
      readBoolean(record.treatPendingAsComplete ?? record.treat_pending_as_complete) ?? false,
    ...(takeoverSplit ? { takeoverSplit } : {}),
  };
};

const normalizeMonthlyBaseConfig = (config: unknown): MonthlyBaseSettings | null => {
  if (!config || typeof config !== "object") {
    return null;
  }
  const record = extractMonthlyBaseConfigCandidate(config);
  if (!record) {
    return null;
  }
  const typeCandidate = typeof record.type === "string" ? record.type.trim().toLowerCase() : "calendar_days";
  if (typeCandidate === "calendar_days" || typeCandidate === "calendar-days") {
    const amountOverride = readNumeric(
      record.monthlyAmount ??
        record.monthly_amount ??
        record.amount ??
        record.value ??
        record.salary ??
        record.baseAmount ??
        record.base_amount,
    );
    const monthlyCap = readNumeric(
      record.maximumAmount ??
        record.maximum_amount ??
        record.maxAmount ??
        record.max_amount ??
        record.monthlyCap ??
        record.monthly_cap ??
        record.cap,
    );
    return {
      mode: "calendar_days",
      amountOverride: amountOverride ?? undefined,
      monthlyCap: monthlyCap !== undefined && monthlyCap > 0 ? monthlyCap : undefined,
    };
  }

  if (typeCandidate === "shift_quota" || typeCandidate === "shift-quota") {
    const defaultShiftsRaw =
      readNumeric(record.defaultShiftsPerMonth ?? record.default_shifts_per_month ?? record.defaultShifts);
    const defaultShifts =
      defaultShiftsRaw !== undefined && Number.isFinite(defaultShiftsRaw) ? Math.max(1, Math.trunc(defaultShiftsRaw)) : null;
    if (!defaultShifts) {
      return null;
    }

    const readShiftCount = (value: unknown): number | undefined => {
      const parsed = readNumeric(value);
      if (parsed === undefined || !Number.isFinite(parsed)) {
        return undefined;
      }
      const normalized = Math.max(0, Math.trunc(parsed));
      return normalized > 0 ? normalized : undefined;
    };

    const extractPattern = (value: unknown): number[] | undefined => {
      if (!Array.isArray(value)) {
        return undefined;
      }
      const normalized = value
        .map((entry) => readShiftCount(entry))
        .filter((entry): entry is number => entry !== undefined && entry > 0);
      return normalized.length > 0 ? normalized : undefined;
    };

    const unitOverride = readNumeric(
      record.unitAmountOverride ?? record.unit_amount_override ?? record.unitAmount ?? record.unit_amount ?? record.rate,
    );
    const proRate = readBoolean(record.proRateByCompletion ?? record.pro_rate_by_completion);
    const monthlyCap = readNumeric(
      record.maximumAmount ??
        record.maximum_amount ??
        record.maxAmount ??
        record.max_amount ??
        record.monthlyCap ??
        record.monthly_cap ??
        record.cap,
    );

    const countSourceRaw = typeof record.countSource === "string" ? record.countSource.trim().toLowerCase() : null;
    const countSource: "staff_assignments" | "counter_manager" =
      countSourceRaw === "counter_manager" || countSourceRaw === "manager"
        ? "counter_manager"
        : "staff_assignments";
    const taskCompletionProration = normalizeTaskCompletionProrationSettings(
      record.taskCompletionProration ?? record.task_completion_proration,
    );

    return {
      mode: "shift_quota",
      defaultShiftsPerMonth: defaultShifts,
      shiftsFor28: readShiftCount(
        record.twentyEightDayMonths ??
          record.twenty_eight_day_months ??
          record.february ??
          record.februaryStandard ??
          record.february_standard,
      ),
      shiftsFor29: readShiftCount(
        record.twentyNineDayMonths ?? record.twenty_nine_day_months ?? record.leapYearFebruary ?? record.leap_year_february,
      ),
      shiftsFor30: readShiftCount(record.thirtyDayMonths ?? record.thirty_day_months),
      thirtyOneDayPattern: extractPattern(record.thirtyOneDayPattern ?? record.thirty_one_day_pattern),
      proRateByCompletion: proRate ?? true,
      unitAmountOverride: unitOverride !== undefined && Number.isFinite(unitOverride) ? unitOverride : undefined,
      countSource,
      monthlyCap: monthlyCap !== undefined && monthlyCap > 0 ? monthlyCap : undefined,
      taskCompletionProration,
    };
  }

  return null;
};

const mergeMonthlyBaseSettings = (
  base: MonthlyBaseSettings,
  override: MonthlyBaseSettings,
): MonthlyBaseSettings => {
  if (override.mode !== base.mode) {
    return override;
  }
  if (override.mode === "calendar_days" && base.mode === "calendar_days") {
    return {
      mode: "calendar_days",
      amountOverride: override.amountOverride ?? base.amountOverride,
      monthlyCap: override.monthlyCap ?? base.monthlyCap,
    };
  }
  if (override.mode === "shift_quota" && base.mode === "shift_quota") {
    return {
      mode: "shift_quota",
      defaultShiftsPerMonth: override.defaultShiftsPerMonth ?? base.defaultShiftsPerMonth,
      shiftsFor28: override.shiftsFor28 ?? base.shiftsFor28,
      shiftsFor29: override.shiftsFor29 ?? base.shiftsFor29,
      shiftsFor30: override.shiftsFor30 ?? base.shiftsFor30,
      thirtyOneDayPattern: override.thirtyOneDayPattern ?? base.thirtyOneDayPattern,
      proRateByCompletion: override.proRateByCompletion ?? base.proRateByCompletion,
      unitAmountOverride: override.unitAmountOverride ?? base.unitAmountOverride,
      countSource: override.countSource ?? base.countSource ?? "staff_assignments",
      monthlyCap: override.monthlyCap ?? base.monthlyCap,
      taskCompletionProration:
        override.taskCompletionProration ?? base.taskCompletionProration,
    };
  }
  return override;
};

const extractMonthlyBaseConfigCandidate = (config: unknown): Record<string, unknown> | null => {
  if (!config || typeof config !== "object") {
    return null;
  }
  const record = config as Record<string, unknown>;
  for (const key of MONTHLY_BASE_CONFIG_KEYS) {
    const candidate = record[key];
    if (candidate && typeof candidate === "object") {
      return candidate as Record<string, unknown>;
    }
  }
  if ("type" in record || "monthlyAmount" in record || "monthly_amount" in record) {
    return record;
  }
  return null;
};

const computeCalendarDayBaseAmount = (
  assignment: CompensationComponentAssignment,
  settings: Extract<MonthlyBaseSettings, { mode: "calendar_days" }>,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
  eligibleDates: ReadonlySet<string> | null = null,
): {
  amount: number;
  creditedUnits: number;
  creditedDates: string[];
  earningBreakdown: CompensationEarningBreakdownEntry[];
} => {
  const monthlyAmount = settings.amountOverride ?? Number(assignment.baseAmount ?? 0);
  if (!Number.isFinite(monthlyAmount) || monthlyAmount === 0) {
    return { amount: 0, creditedUnits: 0, creditedDates: [], earningBreakdown: [] };
  }
  const overlap = getAssignmentOverlapRange(assignment, rangeStart, rangeEnd);
  if (!overlap) {
    return { amount: 0, creditedUnits: 0, creditedDates: [], earningBreakdown: [] };
  }
  let total = 0;
  let creditedUnits = 0;
  const creditedDates: string[] = [];
  const earningBreakdown: CompensationEarningBreakdownEntry[] = [];
  const monthlyCap = settings.monthlyCap ?? null;
  let cursor = overlap.start.startOf("day");
  const finalDay = overlap.end.startOf("day");
  while (!cursor.isAfter(finalDay, "day")) {
    const monthStart = cursor.startOf("month");
    const monthEnd = cursor.endOf("month").startOf("day");
    const sliceEnd = monthEnd.isBefore(finalDay) ? monthEnd : finalDay;
    const sliceDates: string[] = [];
    let sliceCursor = cursor.clone();
    while (!sliceCursor.isAfter(sliceEnd, "day")) {
      const date = sliceCursor.format("YYYY-MM-DD");
      if (!eligibleDates || eligibleDates.has(date)) {
        sliceDates.push(date);
      }
      sliceCursor = sliceCursor.add(1, "day");
    }
    const daysCovered = sliceDates.length;
    const daysInMonth = monthEnd.diff(monthStart.startOf("day"), "day") + 1;
    if (daysCovered > 0 && daysInMonth > 0) {
      const prorated = monthlyAmount * (daysCovered / daysInMonth);
      const capped = monthlyCap !== null && monthlyCap > 0 ? Math.min(prorated, monthlyCap) : prorated;
      total += capped;
      creditedUnits += daysCovered;
      creditedDates.push(...sliceDates);
      earningBreakdown.push(...allocateCompensationAmountAcrossDates(capped, sliceDates));
    }
    cursor = sliceEnd.add(1, "day").startOf("day");
  }
  return {
    amount: total,
    creditedUnits,
    creditedDates,
    earningBreakdown: mergeCompensationEarningBreakdown(earningBreakdown),
  };
};

const computeShiftQuotaBaseAmount = (
  assignment: CompensationComponentAssignment,
  settings: Extract<MonthlyBaseSettings, { mode: "shift_quota" }>,
  summary: CommissionSummary,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
  eligibleDates: ReadonlySet<string> | null = null,
): {
  amount: number;
  creditedUnits: number;
  creditedDates: string[];
  dailyBase: AssistantManagerSalaryDailyBase[];
  lockedExtraAmount: number;
  lockedExtraUnits: number;
  lockedExtraDates: string[];
  lockedExtraDailyBase: AssistantManagerSalaryDailyBase[];
} => {
  const unitAmount = settings.unitAmountOverride ?? Number(assignment.unitAmount ?? 0);
  if (!Number.isFinite(unitAmount) || unitAmount === 0) {
    return {
      amount: 0,
      creditedUnits: 0,
      creditedDates: [],
      dailyBase: [],
      lockedExtraAmount: 0,
      lockedExtraUnits: 0,
      lockedExtraDates: [],
      lockedExtraDailyBase: [],
    };
  }
  const overlap = getAssignmentOverlapRange(assignment, rangeStart, rangeEnd);
  if (!overlap) {
    return {
      amount: 0,
      creditedUnits: 0,
      creditedDates: [],
      dailyBase: [],
      lockedExtraAmount: 0,
      lockedExtraUnits: 0,
      lockedExtraDates: [],
      lockedExtraDailyBase: [],
    };
  }

  let total = 0;
  let creditedUnitsTotal = 0;
  const creditedDaySet = new Set<string>();
  const dailyBase: AssistantManagerSalaryDailyBase[] = [];
  let lockedExtraAmount = 0;
  let lockedExtraUnits = 0;
  const lockedExtraDaySet = new Set<string>();
  const lockedExtraDailyBase: AssistantManagerSalaryDailyBase[] = [];
  const monthlyCap = settings.monthlyCap ?? null;
  let cursor = overlap.start.startOf("month");
  const lastMonth = overlap.end.startOf("month");

  const collectRecordedDays = (monthKey: string): string[] => {
    if (settings.countSource === "counter_manager") {
      const daySet = summary.managerShiftDayIndex.get(monthKey);
      return daySet ? Array.from(daySet) : [];
    }
    const entries = summary.shiftDayIndex.get(monthKey);
    return entries ? [...entries] : [];
  };

  const normalizeDaysForOverlap = (days: string[]): string[] => {
    if (days.length === 0) {
      return [];
    }
    return days
      .map((value) => dayjs(value))
      .filter(
        (day) =>
          day.isValid() &&
          (day.isSame(overlap.start, "day") || day.isAfter(overlap.start, "day")) &&
          (day.isSame(overlap.end, "day") || day.isBefore(overlap.end, "day")) &&
          (!eligibleDates || eligibleDates.has(day.format("YYYY-MM-DD"))),
      )
      .sort((a, b) => a.valueOf() - b.valueOf())
      .map((day) => day.format("YYYY-MM-DD"));
  };

  while (!cursor.isAfter(lastMonth, "month")) {
    const monthStart = cursor.startOf("month");
    const monthEnd = cursor.endOf("month");
    if (monthEnd.isBefore(overlap.start) || monthStart.isAfter(overlap.end)) {
      cursor = cursor.add(1, "month");
      continue;
    }

    const quota = determineShiftQuotaForMonth(cursor, settings);
    if (quota <= 0) {
      cursor = cursor.add(1, "month");
      continue;
    }

    const monthKey = cursor.format("YYYY-MM");
    const normalizedDays = normalizeDaysForOverlap(collectRecordedDays(monthKey));
    let worked: number;
    if (normalizedDays.length > 0 || eligibleDates) {
      worked = normalizedDays.length;
    } else if (settings.countSource === "counter_manager") {
      worked = summary.managerMonthlyShiftCounts[monthKey] ?? 0;
    } else {
      worked = summary.monthlyShiftCounts[monthKey] ?? 0;
    }
    if (worked <= 0) {
      cursor = cursor.add(1, "month");
      continue;
    }

    let creditedUnits = 0;
    if (settings.proRateByCompletion) {
      creditedUnits = Math.min(worked, quota);
    } else if (worked >= quota) {
      creditedUnits = quota;
    }

    const creditedDays = normalizedDays.slice(0, creditedUnits);

    const extraUnits = Math.max(0, worked - creditedUnits);
    if (creditedUnits > 0) {
      let monthAmount = creditedUnits * unitAmount;
      if (monthlyCap !== null && monthlyCap > 0) {
        monthAmount = Math.min(monthAmount, monthlyCap);
      }
      const monthDailyBase = creditedDays.length === creditedUnits
        ? allocateAssistantManagerSalaryAcrossDays(monthAmount, creditedDays)
        : [];
      total += monthDailyBase.length > 0
        ? monthDailyBase.reduce((sum, day) => sum + day.baseAmount, 0)
        : monthAmount;
      creditedUnitsTotal += creditedUnits;
      creditedDays.forEach((day) => creditedDaySet.add(day));
      dailyBase.push(...monthDailyBase);
    }

    if (extraUnits > 0) {
      const extraDays = normalizedDays.slice(creditedUnits, creditedUnits + extraUnits);
      const extraAmount = roundCurrencyValue(extraUnits * unitAmount);
      const extraDailyBase = extraDays.length === extraUnits
        ? allocateAssistantManagerSalaryAcrossDays(extraAmount, extraDays)
        : [];
      lockedExtraAmount += extraDailyBase.length > 0
        ? extraDailyBase.reduce((sum, day) => sum + day.baseAmount, 0)
        : extraAmount;
      lockedExtraUnits += extraUnits;
      extraDays.forEach((day) => lockedExtraDaySet.add(day));
      lockedExtraDailyBase.push(...extraDailyBase);
    }

    cursor = cursor.add(1, "month");
  }

  const creditedDates = Array.from(creditedDaySet).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lockedExtraDates = Array.from(lockedExtraDaySet).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    amount: total,
    creditedUnits: creditedUnitsTotal,
    creditedDates,
    dailyBase,
    lockedExtraAmount,
    lockedExtraUnits,
    lockedExtraDates,
    lockedExtraDailyBase,
  };
};

const THIRTY_ONE_DAY_MONTHS = [0, 2, 4, 6, 7, 9, 11];
const THIRTY_ONE_MONTHS_PER_YEAR = THIRTY_ONE_DAY_MONTHS.length;

const determineShiftQuotaForMonth = (
  monthRef: dayjs.Dayjs,
  settings: Extract<MonthlyBaseSettings, { mode: "shift_quota" }>,
): number => {
  const daysInMonth = monthRef.daysInMonth();
  if (daysInMonth === 28) {
    return settings.shiftsFor28 ?? settings.defaultShiftsPerMonth;
  }
  if (daysInMonth === 29) {
    return settings.shiftsFor29 ?? settings.defaultShiftsPerMonth;
  }
  if (daysInMonth === 30) {
    return settings.shiftsFor30 ?? settings.defaultShiftsPerMonth;
  }
  if (daysInMonth === 31) {
    if (settings.thirtyOneDayPattern && settings.thirtyOneDayPattern.length > 0) {
      const ordinal = getThirtyOneMonthOrdinal(monthRef);
      const patternLength = settings.thirtyOneDayPattern.length;
      const index = ((ordinal - 1) % patternLength + patternLength) % patternLength;
      return settings.thirtyOneDayPattern[index] ?? settings.defaultShiftsPerMonth;
    }
    return settings.defaultShiftsPerMonth;
  }
  return settings.defaultShiftsPerMonth;
};

const getThirtyOneMonthOrdinal = (monthRef: dayjs.Dayjs): number => {
  const monthIndex = monthRef.month();
  if (!THIRTY_ONE_DAY_MONTHS.includes(monthIndex)) {
    return 0;
  }
  const ordinalWithinYear = THIRTY_ONE_DAY_MONTHS.filter((entry) => entry <= monthIndex).length;
  const yearsDiff = monthRef.year() - 2000;
  return yearsDiff * THIRTY_ONE_MONTHS_PER_YEAR + ordinalWithinYear;
};

const countDaysWithinRange = (daySet: Set<string>, start: dayjs.Dayjs, end: dayjs.Dayjs): number => {
  if (daySet.size === 0) {
    return 0;
  }
  let count = 0;
  daySet.forEach((dayKey) => {
    const day = dayjs(dayKey);
    if (day.isValid() && (day.isSame(start, "day") || (day.isAfter(start, "day") && (day.isBefore(end, "day") || day.isSame(end, "day"))))) {
      count += 1;
    }
  });
  return count;
};

const getAssignmentOverlapRange = (
  assignment: CompensationComponentAssignment,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
): { start: dayjs.Dayjs; end: dayjs.Dayjs } | null => {
  let start = rangeStart;
  if (assignment.effectiveStart) {
    const candidate = dayjs(assignment.effectiveStart);
    if (candidate.isAfter(start)) {
      start = candidate;
    }
  }
  let end = rangeEnd;
  if (assignment.effectiveEnd) {
    const candidate = dayjs(assignment.effectiveEnd);
    if (candidate.isBefore(end)) {
      end = candidate;
    }
  }
  if (end.isBefore(start, "day")) {
    return null;
  }
  return { start, end };
};

const computeNightReportIncentive = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
  summary: CommissionSummary,
  nightReportStats: NightReportStatsMap,
  nightReportBestCache: Map<string, NightReportBestCacheEntry>,
  productBucketsByUser: ProductBucketLookup,
  eligibleDates: ReadonlySet<string> | null,
  assignmentEligibilityDatesByUser: ReadonlyMap<number, ReadonlySet<string>> | null,
): ComponentComputationResult => {
  const leaderStats = nightReportStats.get(summary.userId);
  if (!leaderStats) {
    return { amount: 0 };
  }

  const settings = resolveNightReportSettings(component, assignment);
  const productFilter = buildProductFilterSet(settings.allowedProductIds);
  const qualifiedReports = leaderStats.reports.filter((report) => {
    if (eligibleDates && !eligibleDates.has(report.date)) {
      return false;
    }
    if (!reportMatchesProductFilter(report, productFilter)) {
      return false;
    }
    const baseCount = report.postOpenBarPeople ?? 0;
    const hasDynamic = settings.dynamicMinAttendanceMultiplier > 0;
    const dynamicTarget =
      hasDynamic && baseCount > 0 ? baseCount * settings.dynamicMinAttendanceMultiplier : null;
    if (hasDynamic && baseCount <= 0 && (!settings.minAttendance || settings.minAttendance <= 0)) {
      return false;
    }
    const target =
      dynamicTarget !== null && dynamicTarget > 0 ? dynamicTarget : settings.minAttendance;
    return target > 0 ? report.totalPeople >= target : report.totalPeople > 0;
  });

  if (qualifiedReports.length < settings.minReports) {
    return { amount: 0 };
  }

  const productAmountMap = new Map<
    string,
    { productId: number | null; productName: string; amount: number }
  >();
  const earningAmountsByDate = new Map<string, number>();

  const creditReportAmount = (report: typeof qualifiedReports[number] | null, amount: number) => {
    if (!report || !amount) {
      return;
    }
    const productId = report.productId ?? null;
    const productName =
      report.productName ?? (productId !== null ? `Product ${productId}` : "Unassigned Product");
    const key = productId === null ? "__null__" : `${productId}`;
    if (!productAmountMap.has(key)) {
      productAmountMap.set(key, { productId, productName, amount: 0 });
    }
    const entry = productAmountMap.get(key)!;
    entry.amount += amount;
    earningAmountsByDate.set(
      report.date,
      (earningAmountsByDate.get(report.date) ?? 0) + amount,
    );
    recordCounterIncentiveMarker(summary, report.counterId, component.name ?? component.id.toString(), amount);
    recordCounterIncentiveTotal(summary, report.counterId, amount);
  };

  if (settings.payoutPerQualifiedReport !== 0) {
    qualifiedReports.forEach((report) => {
      creditReportAmount(report, settings.payoutPerQualifiedReport);
    });
  }

  if (settings.retentionBonusPerDay !== 0) {
    qualifiedReports.forEach((report) => {
      if (report.retentionRatio >= settings.retentionThreshold) {
        creditReportAmount(report, settings.retentionBonusPerDay);
      }
    });
  }

  if (settings.perCustomerRate > 0) {
    qualifiedReports.forEach((report) => {
      const attendance =
        settings.perCustomerSource === "open_bar"
          ? report.openBarPeople ?? 0
          : report.totalPeople ?? 0;
      if (attendance > 0) {
        creditReportAmount(report, attendance * settings.perCustomerRate);
      }
    });
  }

  if (settings.bestOfRangeBonus > 0) {
    const bestEntry = getNightReportBestEntry(
      nightReportBestCache,
      assignment,
      settings,
      nightReportStats,
      eligibleDates,
      assignmentEligibilityDatesByUser,
    );
    if (bestEntry.topHits > 0 && bestEntry.topUserIds.has(summary.userId)) {
      let bestReport: (typeof qualifiedReports)[number] | null = null;
      qualifiedReports.forEach((candidate) => {
        if (!bestReport || candidate.retentionRatio > bestReport.retentionRatio) {
          bestReport = candidate;
        }
      });
      creditReportAmount(bestReport, settings.bestOfRangeBonus);
    }
  }

  let total = 0;
  productAmountMap.forEach((entry) => {
    total += entry.amount;
    allocateComponentToProduct(
      productBucketsByUser,
      summary.userId,
      entry.productId,
      entry.productName,
      component.id,
      entry.amount,
    );
  });

  return {
    amount: total,
    earningBreakdown: mergeCompensationEarningBreakdown(
      Array.from(earningAmountsByDate.entries()).map(([date, amount]) => ({ date, amount })),
    ),
  };
};

const getNightReportBestEntry = (
  cache: Map<string, NightReportBestCacheEntry>,
  assignment: CompensationComponentAssignment,
  settings: NightReportIncentiveSettings,
  nightReportStats: NightReportStatsMap,
  globalEligibleDates: ReadonlySet<string> | null,
  assignmentEligibilityDatesByUser: ReadonlyMap<number, ReadonlySet<string>> | null,
): NightReportBestCacheEntry => {
  const productFilter = buildProductFilterSet(settings.allowedProductIds);
  const productKey =
    settings.allowedProductIds && settings.allowedProductIds.length > 0
      ? settings.allowedProductIds.join(",")
      : "*";
  const cacheKey = [
    assignment.id,
    settings.minAttendance,
    settings.minReports,
    settings.retentionThreshold,
    settings.dynamicMinAttendanceMultiplier,
    productKey,
  ].join("|");
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let topHits = 0;
  const topUserIds = new Set<number>();

  nightReportStats.forEach((summary, userId) => {
    const userEligibleDates = assignment.targetScope === "global"
      ? globalEligibleDates
      : assignmentEligibilityDatesByUser?.get(userId) ?? null;
    if (!userEligibleDates || userEligibleDates.size === 0) {
      return;
    }
    const qualifiedReports = summary.reports.filter((report) => {
      if (!userEligibleDates.has(report.date)) {
        return false;
      }
      if (!reportMatchesProductFilter(report, productFilter)) {
        return false;
      }
      const baseCount = report.postOpenBarPeople ?? 0;
      const hasDynamic = settings.dynamicMinAttendanceMultiplier > 0;
      const dynamicTarget =
        hasDynamic && baseCount > 0 ? baseCount * settings.dynamicMinAttendanceMultiplier : null;
      if (hasDynamic && baseCount <= 0 && (!settings.minAttendance || settings.minAttendance <= 0)) {
        return false;
      }
      const target =
        dynamicTarget !== null && dynamicTarget > 0 ? dynamicTarget : settings.minAttendance;
      return target > 0 ? report.totalPeople >= target : report.totalPeople > 0;
    });
    if (qualifiedReports.length < settings.minReports) {
      return;
    }
    const retentionHits = qualifiedReports.filter(
      (report) => report.retentionRatio >= settings.retentionThreshold,
    ).length;
    if (retentionHits > topHits) {
      topHits = retentionHits;
      topUserIds.clear();
      topUserIds.add(userId);
    } else if (retentionHits === topHits && retentionHits > 0) {
      topUserIds.add(userId);
    }
  });

  const entry: NightReportBestCacheEntry = { topHits, topUserIds };
  cache.set(cacheKey, entry);
  return entry;
};

const resolveAssignmentTargets = async (
  summaries: Map<number, CommissionSummary>,
  components: Array<CompensationComponent & { assignments?: CompensationComponentAssignment[] }>,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
): Promise<{
  targets: AssignmentTargetMap;
  eligibilityDates: AssignmentEligibilityDateMap;
}> => {
  const targets = new Map<number, number[]>();
  const eligibilityDates = new Map<number, Map<number, Set<string>>>();
  const staffTypeCache = new Map<string, DatedEligibilityTarget>();
  const shiftRoleCache = new Map<number, DatedEligibilityTarget>();
  const userTypeCache = new Map<number, DatedEligibilityTarget>();
  const missingUserIds = new Set<number>();
  const latestUserCreatedAt = rangeEnd.endOf("day").toDate();
  const rangeStartIso = rangeStart.format("YYYY-MM-DD");
  const rangeEndIso = rangeEnd.format("YYYY-MM-DD");

  const buildTarget = (datesByUserId: Map<number, Set<string>>): DatedEligibilityTarget => ({
    userIds: Array.from(datesByUserId.keys()).sort((left, right) => left - right),
    datesByUserId,
  });

  const loadStaffTypeTarget = async (staffType: string): Promise<DatedEligibilityTarget> => {
    const cached = staffTypeCache.get(staffType);
    if (cached) {
      return cached;
    }
    const rows = await getStaffTypeMembersForRange({
      staffType: staffType as StaffProfile["staffType"],
      startDate: rangeStartIso,
      endDate: rangeEndIso,
    });
    const target = buildTarget(buildCompensationEligibilityDateIndex(
      rows,
      rangeStartIso,
      rangeEndIso,
    ));
    staffTypeCache.set(staffType, target);
    return target;
  };

  const loadShiftRoleTarget = async (shiftRoleId: number): Promise<DatedEligibilityTarget> => {
    const cached = shiftRoleCache.get(shiftRoleId);
    if (cached) {
      return cached;
    }
    const rows = await getShiftRoleMembersForRange({
      shiftRoleId,
      startDate: rangeStartIso,
      endDate: rangeEndIso,
    });
    const target = buildTarget(buildCompensationEligibilityDateIndex(
      rows,
      rangeStartIso,
      rangeEndIso,
    ));
    shiftRoleCache.set(shiftRoleId, target);
    return target;
  };

  const loadUserTypeTarget = async (userTypeId: number): Promise<DatedEligibilityTarget> => {
    const cached = userTypeCache.get(userTypeId);
    if (cached) {
      return cached;
    }
    const rows = await getUserTypeMembersForRange({
      userTypeId,
      startDate: rangeStartIso,
      endDate: rangeEndIso,
    });
    const target = buildTarget(buildCompensationEligibilityDateIndex(
      rows,
      rangeStartIso,
      rangeEndIso,
    ));
    userTypeCache.set(userTypeId, target);
    return target;
  };

  for (const component of components) {
    for (const assignment of component.assignments ?? []) {
      let target: DatedEligibilityTarget = { userIds: [], datesByUserId: new Map() };
      if (assignment.targetScope === "user" && assignment.userId) {
        const userIds = await filterUserIdsCreatedOnOrBefore([assignment.userId], latestUserCreatedAt);
        target = {
          userIds,
          datesByUserId: new Map(userIds.map((userId) => [
            userId,
            new Set(enumerateInclusiveIsoDates(rangeStartIso, rangeEndIso)),
          ])),
        };
      } else if (assignment.targetScope === "staff_type" && assignment.staffType) {
        target = await loadStaffTypeTarget(assignment.staffType);
      } else if (assignment.targetScope === "shift_role" && assignment.shiftRoleId) {
        target = await loadShiftRoleTarget(assignment.shiftRoleId);
      } else if (assignment.targetScope === "user_type" && assignment.userTypeId) {
        target = await loadUserTypeTarget(assignment.userTypeId);
      }

      const assignmentOverlap = getAssignmentOverlapRange(assignment, rangeStart, rangeEnd);
      const assignmentTarget = assignmentOverlap
        ? buildTarget(restrictCompensationEligibilityDateIndex(
            target.datesByUserId,
            assignmentOverlap.start.format("YYYY-MM-DD"),
            assignmentOverlap.end.format("YYYY-MM-DD"),
          ))
        : { userIds: [], datesByUserId: new Map<number, Set<string>>() };

      if (assignmentTarget.userIds.length > 0) {
        targets.set(assignment.id, assignmentTarget.userIds);
        eligibilityDates.set(assignment.id, assignmentTarget.datesByUserId);
      }

      assignmentTarget.userIds.forEach((userId) => {
        if (!summaries.has(userId)) {
          missingUserIds.add(userId);
        }
      });
    }
  }

  if (missingUserIds.size > 0) {
    const users = await User.findAll({
      where: {
        id: { [Op.in]: Array.from(missingUserIds) },
      },
      attributes: ["id", "firstName", "lastName"],
    });

    users.forEach((user) => {
      if (!summaries.has(user.id)) {
        summaries.set(
          user.id,
          createEmptySummary(user.id, user.firstName, user.lastName),
        );
      }
    });
  }

  return { targets, eligibilityDates };
};

const filterUserIdsCreatedOnOrBefore = async (
  userIds: number[],
  latestUserCreatedAt: Date,
): Promise<number[]> => {
  if (userIds.length === 0) {
    return [];
  }
  const users = await User.findAll({
    where: {
      id: { [Op.in]: userIds },
      createdAt: {
        [Op.lte]: latestUserCreatedAt,
      },
    },
    attributes: ["id"],
  });
  return users.map((user) => user.id);
};

function describeField(
  fieldName: string,
  attribute: ModelAttributeColumnOptions<Model>,
): ReportModelFieldDescriptor {
  const columnName = (attribute.field as string | undefined) ?? fieldName;
  const type = describeAttributeType(attribute);
  const allowNull =
    attribute.allowNull !== undefined ? attribute.allowNull : !attribute.primaryKey;
  const primaryKey = Boolean(attribute.primaryKey);
  const unique = Boolean(
    typeof attribute.unique === "boolean"
      ? attribute.unique
      : attribute.unique && typeof attribute.unique === "object",
  );
  const defaultValue = serializeDefaultValue(attribute.defaultValue);

  let referenceModel: string | null = null;
  let referenceKey: string | null = null;
  const references = attribute.references;
  if (references) {
    if (typeof references === "string") {
      referenceModel = references;
    } else {
      const referenceOptions = references as ModelAttributeColumnReferencesOptions;
      const modelReference = referenceOptions.model;
      if (typeof modelReference === "string") {
        referenceModel = modelReference;
      } else if (modelReference && typeof modelReference === "object") {
        referenceModel =
          (modelReference as { tableName?: string; name?: string }).tableName ??
          (modelReference as { name?: string }).name ??
          null;
      }
      if (typeof referenceOptions.key === "string") {
        referenceKey = referenceOptions.key;
      }
    }
  }

  return {
    fieldName,
    columnName,
    type,
    allowNull,
    primaryKey,
    defaultValue,
    unique,
    references: referenceModel
      ? {
          model: referenceModel,
          key: referenceKey,
        }
      : undefined,
  };
}

function describeAssociation(association: Association): ReportModelAssociationDescriptor {
  const target =
    (association.target && "name" in association.target
      ? (association.target as { name?: string }).name
      : undefined) ?? "";

  const foreignKeyRaw = (association as unknown as { foreignKey?: string | { fieldName?: string } })
    .foreignKey;
  const foreignKey =
    typeof foreignKeyRaw === "string"
      ? foreignKeyRaw
      : foreignKeyRaw && typeof foreignKeyRaw === "object"
      ? foreignKeyRaw.fieldName
      : undefined;

  const through =
    (association as unknown as { throughModel?: { name?: string } }).throughModel?.name ??
    (association as unknown as { through?: { model?: { name?: string } } }).through?.model?.name ??
    null;

  return {
    name: (association as { as?: string }).as ?? null,
    targetModel: target,
    associationType: association.associationType,
    foreignKey,
    sourceKey: (association as { sourceKey?: string }).sourceKey,
    through,
    as: (association as { as?: string }).as,
  };
}

function describeAttributeType(attribute: ModelAttributeColumnOptions<Model>): string {
  const rawType = (attribute.type ?? {}) as {
    key?: string;
    toSql?: () => string;
    constructor?: { name?: string };
    options?: { values?: unknown[] };
  };

  if (typeof rawType.toSql === "function") {
    try {
      return rawType.toSql();
    } catch {
      // ignore toSql errors and fall through to other formats
    }
  }

  if (rawType.key) {
    return rawType.key;
  }

  if (rawType.constructor?.name) {
    return rawType.constructor.name;
  }

  return "UNKNOWN";
}

function serializeDefaultValue(
  defaultValue: ModelAttributeColumnOptions<Model>["defaultValue"],
): string | number | boolean | null {
  if (defaultValue === undefined || defaultValue === null) {
    return null;
  }

  if (typeof defaultValue === "function") {
    return "[function]";
  }

  if (defaultValue instanceof Date) {
    return defaultValue.toISOString();
  }

  if (typeof defaultValue === "string" || typeof defaultValue === "number" || typeof defaultValue === "boolean") {
    return defaultValue;
  }

  return String(defaultValue);
}

function buildModelDescription(modelName: string, schema: string | undefined, tableName: string): string {
  if (schema) {
    return `${modelName} model mapped to ${schema}.${tableName}`;
  }
  return `${modelName} model mapped to ${tableName}`;
}

function findField(
  descriptor: ReportModelDescriptor,
  identifier: string,
): ReportModelFieldDescriptor | undefined {
  return descriptor.fields.find(
    (field) => field.fieldName === identifier || field.columnName === identifier,
  );
}

function ensureModelDescriptor(modelId: string): ReportModelDescriptor | null {
  if (isSensitiveReportModel(modelId)) {
    return null;
  }
  const cached = modelDescriptorCache.get(modelId);
  if (cached) {
    return cached;
  }

  const sequelizeModel = sequelize.models[modelId];
  if (!sequelizeModel) {
    return null;
  }

  return describeModel(sequelizeModel as ModelCtor<Model>);
}

const escapeLiteral = (value: string): string => value.replace(/'/g, "''");

const resolveColumnExpression = (
  modelId: string,
  fieldId: string,
  aliasMap: Map<string, string>,
): string => {
  const descriptor = ensureModelDescriptor(modelId);
  const modelAlias = aliasMap.get(modelId);
  if (!descriptor || !modelAlias) {
    throw new PreviewQueryError(`Model ${modelId} is not available for derived fields.`);
  }
  const field =
    descriptor.fields.find((candidate) => candidate.fieldName === fieldId) ??
    descriptor.fields.find((candidate) => candidate.columnName === fieldId);
  if (!field) {
    throw new PreviewQueryError(`Field ${fieldId} is not available on model ${modelId}.`);
  }
  return `${modelAlias}.${quoteIdentifier(field.columnName)}`;
};

const renderDerivedFieldExpressionSql = (
  node: DerivedFieldExpressionAst,
  aliasMap: Map<string, string>,
): string => {
  switch (node.type) {
    case "column":
      return resolveColumnExpression(node.modelId, node.fieldId, aliasMap);
    case "literal":
      if (node.valueType === "number") {
        return Number(node.value).toString();
      }
      if (node.valueType === "boolean") {
        return node.value ? "TRUE" : "FALSE";
      }
      return `'${escapeLiteral(String(node.value))}'`;
    case "binary": {
      const left = renderDerivedFieldExpressionSql(node.left, aliasMap);
      const right = renderDerivedFieldExpressionSql(node.right, aliasMap);
      return `(${left} ${node.operator} ${right})`;
    }
    case "unary": {
      const argument = renderDerivedFieldExpressionSql(node.argument, aliasMap);
      return `${node.operator}(${argument})`;
    }
    case "function": {
      const args = node.args.map((arg) => renderDerivedFieldExpressionSql(arg, aliasMap)).join(", ");
      return `${node.name}(${args})`;
    }
    default:
      throw new PreviewQueryError("Unsupported derived field expression node.");
  }
};

const buildDerivedFieldSelectClause = (
  field: DerivedFieldQueryPayload,
  aliasMap: Map<string, string>,
  index: number,
): { clause: string; alias: string } => {
  if (!field.expressionAst) {
    throw new PreviewQueryError("Derived field expression is missing.");
  }
  const expressionSql = renderDerivedFieldExpressionSql(field.expressionAst, aliasMap);
  const alias =
    (typeof field.alias === "string" && field.alias.trim().length > 0
      ? field.alias.trim()
      : field.id.trim().length > 0
      ? field.id.trim()
      : `derived_${index}`) ?? `derived_${index}`;
  return {
    clause: `${expressionSql} AS ${quoteIdentifier(alias)}`,
    alias,
  };
};

function buildFromClause(descriptor: ReportModelDescriptor, alias: string): string {
  return `${quoteTable(descriptor)} ${alias}`;
}

function buildJoinClauses(
  joins: ReportPreviewRequest["joins"],
  aliasMap: Map<string, string>,
  baseModelId: string,
): { clauses: string[]; joinedModels: Set<string>; unresolvedJoins: string[] } {
  if (!joins || joins.length === 0) {
    return { clauses: [], joinedModels: new Set<string>([baseModelId]), unresolvedJoins: [] };
  }

  const clauses: string[] = [];
  const remaining = [...joins];
  const joined = new Set<string>([baseModelId]);
  const unresolved: string[] = [];

  let progress = true;
  while (remaining.length > 0 && progress) {
    progress = false;

    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const join = remaining[index];

      let leftModelId = join.leftModel;
      let rightModelId = join.rightModel;
      let leftFieldId = join.leftField;
      let rightFieldId = join.rightField;

      const leftJoined = joined.has(leftModelId);
      const rightJoined = joined.has(rightModelId);

      if (!leftJoined && rightJoined) {
        // Swap orientation so that the already joined model appears on the left side.
        [leftModelId, rightModelId] = [rightModelId, leftModelId];
        [leftFieldId, rightFieldId] = [rightFieldId, leftFieldId];
      } else if (!leftJoined && !rightJoined) {
        continue;
      }

      const leftAlias = aliasMap.get(leftModelId);
      const rightAlias = aliasMap.get(rightModelId);
      const leftDescriptor = ensureModelDescriptor(leftModelId);
      const rightDescriptor = ensureModelDescriptor(rightModelId);

      if (!leftAlias || !rightAlias || !leftDescriptor || !rightDescriptor) {
        remaining.splice(index, 1);
        progress = true;
        continue;
      }

    const leftField = findField(leftDescriptor, leftFieldId);
      const rightField = findField(rightDescriptor, rightFieldId);
      if (!leftField || !rightField) {
        const knownLeft = leftFieldId.split("__").pop() ?? leftFieldId;
        const knownRight = rightFieldId.split("__").pop() ?? rightFieldId;
        const leftFallback = findField(leftDescriptor, knownLeft);
        const rightFallback = findField(rightDescriptor, knownRight);

        if (!leftFallback || !rightFallback) {
          remaining.splice(index, 1);
          progress = true;
          unresolved.push(
            `${leftModelId}.${leftFieldId} -> ${rightModelId}.${rightFieldId} (missing field metadata)`,
          );
          continue;
        }

        leftFieldId = leftFallback.fieldName;
        rightFieldId = rightFallback.fieldName;
      }

      const resolvedLeftField = leftField ?? findField(leftDescriptor, leftFieldId)!;
      const resolvedRightField = rightField ?? findField(rightDescriptor, rightFieldId)!;

      if (!resolvedLeftField || !resolvedRightField) {
        remaining.splice(index, 1);
        progress = true;
        unresolved.push(
          `${leftModelId}.${leftFieldId} -> ${rightModelId}.${rightFieldId} (missing field metadata)`,
        );
        continue;
      }

      const joinType = (join.joinType ?? "left").toUpperCase();
      const normalizedJoin =
        joinType === "INNER" || joinType === "RIGHT" || joinType === "FULL" ? joinType : "LEFT";

      const rightTable = buildFromClause(rightDescriptor, rightAlias);

      clauses.push(
        `${normalizedJoin} JOIN ${rightTable} ON ${leftAlias}.${quoteIdentifier(resolvedLeftField.columnName ?? resolvedLeftField.fieldName)} = ${rightAlias}.${quoteIdentifier(resolvedRightField.columnName ?? resolvedRightField.fieldName)}`,
      );

      joined.add(rightModelId);
      remaining.splice(index, 1);
      progress = true;
    }
  }

  if (remaining.length > 0) {
    remaining.forEach((join) => {
      unresolved.push(`${join.leftModel}.${join.leftField} -> ${join.rightModel}.${join.rightField}`);
    });
  }

  return { clauses, joinedModels: joined, unresolvedJoins: unresolved };
}

const isFilterGroupNode = (node: PreviewFilterNode): node is PreviewFilterGroupPayload =>
  Boolean(node && typeof node === "object" && (node as { type?: unknown }).type === "group");

function buildWhereClauses(
  filters: PreviewFilterNode[],
  aliasMap: Map<string, string>,
  derivedFieldLookup: Map<string, DerivedFieldQueryPayload>,
): string[] {
  if (!filters || filters.length === 0) {
    return [];
  }
  return filters
    .map((node) => renderFilterNode(node, aliasMap, derivedFieldLookup))
    .filter((clause): clause is string => Boolean(clause));
}

function renderFilterNode(
  node: PreviewFilterNode,
  aliasMap: Map<string, string>,
  derivedFieldLookup: Map<string, DerivedFieldQueryPayload>,
): string | null {
  if (typeof node === "string") {
    const trimmed = node.trim();
    if (trimmed.length === 0 || trimmed.includes(";") || trimmed.includes("--")) {
      return null;
    }
    return trimmed;
  }
  if (isFilterGroupNode(node)) {
    const children = Array.isArray(node.children) ? node.children : [];
    const renderedChildren = children
      .map((child) => renderFilterNode(child, aliasMap, derivedFieldLookup))
      .filter((clause): clause is string => Boolean(clause));
    if (renderedChildren.length === 0) {
      return null;
    }
    if (node.logic === "not") {
      return `NOT (${renderedChildren[0]})`;
    }
    if (renderedChildren.length === 1) {
      return renderedChildren[0];
    }
    const joiner = node.logic === "or" ? " OR " : " AND ";
    return `(${renderedChildren.join(joiner)})`;
  }
  return renderPreviewFilterClause(node, aliasMap, derivedFieldLookup);
}

function renderPreviewFilterClause(
  clause: PreviewFilterClausePayload,
  aliasMap: Map<string, string>,
  derivedFieldLookup: Map<string, DerivedFieldQueryPayload>,
): string {
  const operator = clause.operator;
  const leftExpression =
    clause.leftModelId === DERIVED_FIELD_SENTINEL
      ? renderDerivedFieldFilterExpression(clause.leftFieldId, aliasMap, derivedFieldLookup)
      : resolveColumnExpression(clause.leftModelId, clause.leftFieldId, aliasMap);

  const requiresValue = !["is_null", "is_not_null", "is_true", "is_false"].includes(operator);
  const allowFieldComparison = ["eq", "neq", "gt", "gte", "lt", "lte"].includes(operator);

  if (!requiresValue) {
    switch (operator) {
      case "is_null":
        return `${leftExpression} IS NULL`;
      case "is_not_null":
        return `${leftExpression} IS NOT NULL`;
      case "is_true":
        return `${leftExpression} IS TRUE`;
      case "is_false":
        return `${leftExpression} IS FALSE`;
      default:
        return `${leftExpression} IS NULL`;
    }
  }

  if (clause.rightType === "field") {
    if (!allowFieldComparison) {
      throw new PreviewQueryError("This operator does not support comparing against another field.");
    }
    if (!clause.rightModelId || !clause.rightFieldId) {
      throw new PreviewQueryError("Select a comparison field for this filter.");
    }
    const rightExpression =
      clause.rightModelId === DERIVED_FIELD_SENTINEL
        ? renderDerivedFieldFilterExpression(clause.rightFieldId, aliasMap, derivedFieldLookup)
        : resolveColumnExpression(clause.rightModelId, clause.rightFieldId, aliasMap);
    const operatorSqlMap: Partial<Record<FilterOperator, string>> = {
      eq: "=",
      neq: "<>",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
    };
    const sqlOperator = operatorSqlMap[operator];
    if (!sqlOperator) {
      throw new PreviewQueryError("The selected operator requires a literal value.");
    }
    return `${leftExpression} ${sqlOperator} ${rightExpression}`;
  }

  if (operator === "between") {
    const range = clause.range;
    if (!range || range.from === undefined || range.to === undefined || range.from === null || range.to === null) {
      throw new PreviewQueryError(`Provide both start and end values for ${clause.leftFieldId}.`);
    }
    const fromLiteral = buildFilterLiteral(
      clause.valueKind ?? "string",
      range.from as string | number | boolean,
      `Filter ${clause.leftFieldId} (start)`,
    );
    const toLiteral = buildFilterLiteral(
      clause.valueKind ?? "string",
      range.to as string | number | boolean,
      `Filter ${clause.leftFieldId} (end)`,
    );
    return `${leftExpression} BETWEEN ${fromLiteral} AND ${toLiteral}`;
  }

  if (operator === "in") {
    const rawValues = Array.isArray(clause.value)
      ? clause.value
      : clause.value === undefined || clause.value === null
      ? []
      : [clause.value];
    const entries: Array<string | number | boolean> = [];
    rawValues.forEach((entry) => {
      if (entry === null || entry === undefined) {
        return;
      }
      if (typeof entry === "string") {
        entry
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .forEach((value) => entries.push(value));
        return;
      }
      entries.push(entry);
    });
    if (entries.length === 0) {
      throw new PreviewQueryError(`Provide at least one value for ${clause.leftFieldId}.`);
    }
    const literals = entries.map((entry) =>
      buildFilterLiteral(
        clause.valueKind ?? "string",
        entry as string | number | boolean,
        `Filter ${clause.leftFieldId}`,
      ),
    );
    return `${leftExpression} IN (${literals.join(", ")})`;
  }

  switch (operator) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      const literalValue = Array.isArray(clause.value) ? clause.value[0] : clause.value;
      const literal = buildFilterLiteral(
        clause.valueKind ?? "string",
        literalValue,
        `Filter ${clause.leftFieldId}`,
      );
      if (operator === "eq") {
        return `${leftExpression} = ${literal}`;
      }
      if (operator === "neq") {
        return `${leftExpression} <> ${literal}`;
      }
      if (operator === "gt") {
        return `${leftExpression} > ${literal}`;
      }
      if (operator === "gte") {
        return `${leftExpression} >= ${literal}`;
      }
      if (operator === "lt") {
        return `${leftExpression} < ${literal}`;
      }
      return `${leftExpression} <= ${literal}`;
    case "contains": {
      const value = typeof clause.value === "string" ? clause.value.trim() : "";
      if (!value) {
        throw new PreviewQueryError("Provide a value for contains filters.");
      }
      const literalValue = `'${`%${escapeLiteral(value)}%`}'`;
      return `${leftExpression} ILIKE ${literalValue}`;
    }
    case "starts_with": {
      const value = typeof clause.value === "string" ? clause.value.trim() : "";
      if (!value) {
        throw new PreviewQueryError("Provide a value for starts with filters.");
      }
      const literalValue = `'${`${escapeLiteral(value)}%`}'`;
      return `${leftExpression} ILIKE ${literalValue}`;
    }
    case "ends_with": {
      const value = typeof clause.value === "string" ? clause.value.trim() : "";
      if (!value) {
        throw new PreviewQueryError("Provide a value for ends with filters.");
      }
      const literalValue = `'${`%${escapeLiteral(value)}`}'`;
      return `${leftExpression} ILIKE ${literalValue}`;
    }
    default:
      throw new PreviewQueryError("Unsupported filter operator.");
  }
}

function renderDerivedFieldFilterExpression(
  fieldId: string,
  aliasMap: Map<string, string>,
  derivedFieldLookup: Map<string, DerivedFieldQueryPayload>,
): string {
  const derivedField = derivedFieldLookup.get(fieldId);
  if (!derivedField || !derivedField.expressionAst) {
    throw new PreviewQueryError(`Derived field ${fieldId} is not available for this template.`);
  }
  return renderDerivedFieldExpressionSql(derivedField.expressionAst, aliasMap);
}

function buildFilterLiteral(
  kind: PreviewFilterClausePayload["valueKind"],
  value: string | number | boolean | null | undefined,
  label: string,
): string {
  if (kind === "number") {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      throw new PreviewQueryError(`Enter a valid number for ${label}.`);
    }
    return String(numeric);
  }
  if (kind === "boolean") {
    const normalized =
      typeof value === "boolean" ? (value ? "true" : "false") : String(value ?? "").toLowerCase();
    if (normalized !== "true" && normalized !== "false") {
      throw new PreviewQueryError(`Select true or false for ${label}.`);
    }
    return normalized === "true" ? "TRUE" : "FALSE";
  }
  if (typeof value !== "string") {
    throw new PreviewQueryError(`Provide a value for ${label}.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PreviewQueryError(`Provide a value for ${label}.`);
  }
  if (kind === "string" && trimmed.length > 0) {
    return `'${escapeLiteral(trimmed)}'`;
  }
  if (kind === "date") {
    return `'${escapeLiteral(trimmed)}'`;
  }
  return `'${escapeLiteral(trimmed)}'`;
}

function buildOrderByClauses(
  orderBy: PreviewOrderClausePayload[],
  aliasMap: Map<string, string>,
  derivedFieldLookup: Map<string, DerivedFieldQueryPayload>,
): string[] {
  if (!orderBy || orderBy.length === 0) {
    return [];
  }
  return orderBy.map((clause) => {
    const direction = clause.direction?.toUpperCase() === "DESC" ? "DESC" : "ASC";
    if (clause.source === "derived") {
      const expression = renderDerivedFieldFilterExpression(clause.fieldId, aliasMap, derivedFieldLookup);
      return `${expression} ${direction}`;
    }
    if (!clause.modelId) {
      throw new PreviewQueryError("Order by clause is missing a model reference.");
    }
    const expression = resolveColumnExpression(clause.modelId, clause.fieldId, aliasMap);
    return `${expression} ${direction}`;
  });
}

function buildHavingClauses(
  having: PreviewHavingClausePayload[],
  aggregationAliasLookup: Map<string, string>,
): string[] {
  if (!having || having.length === 0) {
    return [];
  }
  const operatorSqlMap: Record<PreviewHavingClausePayload["operator"], string> = {
    eq: "=",
    neq: "<>",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
  };
  return having.reduce<string[]>((clauses, clause) => {
    const alias = aggregationAliasLookup.get(clause.aggregationId);
    if (!alias) {
      throw new PreviewQueryError("One or more HAVING clauses reference unknown aggregations.");
    }
    const operator = operatorSqlMap[clause.operator] ?? "=";
    const literal = buildFilterLiteral(clause.valueKind ?? "number", clause.value, `Aggregation ${alias}`);
    clauses.push(`${quoteIdentifier(alias)} ${operator} ${literal}`);
    return clauses;
  }, []);
}

function quoteTable(descriptor: ReportModelDescriptor): string {
  const quoter = getDialectQuoter();
  if (descriptor.schema) {
    return quoter.quoteTable({
      tableName: descriptor.tableName,
      schema: descriptor.schema,
    });
  }
  return quoter.quoteTable(descriptor.tableName);
}

function quoteIdentifier(value: string): string {
  const quoter = getDialectQuoter();
  return quoter.quoteIdentifier(value);
}

