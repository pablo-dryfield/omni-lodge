import type { Request, Response } from 'express';
import crypto from 'crypto';
import { Op, Transaction, fn, col, where } from 'sequelize';
import dayjs from 'dayjs';
import sequelize from '../config/database.js';
import Booking from '../models/Booking.js';
import Counter from '../models/Counter.js';
import NightReport, { type NightReportStatus } from '../models/NightReport.js';
import NightReportVenue from '../models/NightReportVenue.js';
import NightReportPhoto from '../models/NightReportPhoto.js';
import User from '../models/User.js';
import Venue from '../models/Venue.js';
import Product from '../models/Product.js';
import VenueCompensationTerm from '../models/VenueCompensationTerm.js';
import VenueCompensationTermRate from '../models/VenueCompensationTermRate.js';
import VenueCompensationCollectionLog from '../models/VenueCompensationCollectionLog.js';
import VenueCompensationLedger from '../models/VenueCompensationLedger.js';
import FinanceAccount from '../finance/models/FinanceAccount.js';
import FinanceCategory from '../finance/models/FinanceCategory.js';
import FinanceFile from '../finance/models/FinanceFile.js';
import FinanceTransaction from '../finance/models/FinanceTransaction.js';
import FinanceVendor from '../finance/models/FinanceVendor.js';
import { recordFinanceAuditLog } from '../finance/services/auditLogService.js';
import {
  cleanupInvoiceFileIfOrphan,
  deleteFinanceTransactionAndCleanupInvoice,
} from '../finance/services/transactionDeletionService.js';
import { createFinanceTransaction, updateFinanceTransaction } from '../finance/services/transactionService.js';
import HttpError from '../errors/HttpError.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import logger from '../utils/logger.js';
import { DID_NOT_OPERATE_NOTE } from '../constants/nightReports.js';
import {
  ensureNightReportStorage,
  storeNightReportPhoto,
  deleteNightReportPhoto as removePhotoFromDisk,
  openNightReportPhotoStream,
} from '../services/nightReportStorageService.js';
import { fetchLeaderNightReportStats } from '../services/nightReportMetricsService.js';
import {
  reconcileNightReportTaskWaiversForReport,
} from '../services/assistantManagerTaskWaiverService.js';
import { getConfigValue } from '../services/configService.js';
import { getCommissionByDateRange } from './reportController.js';

const resolvePayoutCurrency = (): string =>
  String(getConfigValue('FINANCE_BASE_CURRENCY') ?? 'PLN')
    .trim()
    .toUpperCase();
const resolveVenueLedgerStartDate = (): dayjs.Dayjs =>
  dayjs(
    (getConfigValue('VENUE_LEDGER_START_DATE') as string | null) ??
      (getConfigValue('VENUE_COMP_LEDGER_START') as string | null) ??
      '2025-10-01',
  );

type RawVenueAggregate = {
  venueId: number | null;
  venueName: string | null;
  currencyCode: string | null;
  direction: 'payable' | 'receivable' | null;
  totalAmount: string | number | null;
};

type CollectionAggregate = {
  venueId: number;
  currencyCode: string;
  direction: 'receivable' | 'payable';
  totalAmountMinor: string | number | null;
};

type CollectionLogAggregate = {
  id: number;
  venueId: number;
  currencyCode: string;
  direction: 'receivable' | 'payable';
  amountMinor: string | number | null;
  financeTransactionId: number | null;
  createdAt: string | Date | null;
};

type VenueDetailAggregate = {
  venueId: number | null;
  venueName: string | null;
  currencyCode: string | null;
  direction: 'receivable' | 'payable' | null;
  payoutAmount: string | number | null;
  totalPeople: number | null;
  normalCount: number | null;
  cocktailsCount: number | null;
  brunchCount: number | null;
  activityDate: string | null;
  reportId: number | null;
  allowsOpenBar?: boolean | null;
};

type LedgerSnapshot = {
  opening: number;
  due: number;
  paid: number;
  closing: number;
};

type NightReportPayload = {
  id: number;
  counterId: number;
  activityDate: string;
  status: NightReportStatus;
  notes: string | null;
  productId: number | null;
  productName: string | null;
  requiresCostReconciliation: boolean;
  costReconciliation: {
    required: boolean;
    resolved: boolean;
    resolution: 'not_required' | 'linked_costs' | 'no_extra_cost_confirmed' | 'unresolved';
    linkedCostCount: number;
    noExtraCostConfirmed: boolean;
    noExtraCostConfirmedAt: string | null;
    noExtraCostConfirmedBy: {
      id: number;
      fullName: string;
    } | null;
  };
  leader: {
    id: number;
    fullName: string;
  } | null;
  counter: {
    id: number;
    date: string;
  } | null;
  venues: Array<{
    id: number;
    orderIndex: number;
    venueName: string;
    venueId: number | null;
    totalPeople: number;
    isOpenBar: boolean;
    normalCount: number | null;
    cocktailsCount: number | null;
    brunchCount: number | null;
    compensationTermId: number | null;
    compensationType: 'open_bar' | 'commission' | null;
    compensationDirection: 'payable' | 'receivable' | null;
    rateApplied: number | null;
    rateUnit: 'per_person' | 'flat' | null;
    payoutAmount: number | null;
    currencyCode: string | null;
  }>;
  photos: Array<{
    id: number;
    originalName: string;
    mimeType: string;
    fileSize: number;
    capturedAt: string | null;
    downloadUrl: string;
  }>;
  costs: Array<{
    id: number;
    date: string;
    serviceDate: string | null;
    currency: string;
    amountMinor: number;
    status: string;
    paymentMethod: string | null;
    description: string | null;
    nightReportId: number | null;
    productId: number | null;
    productName: string | null;
    linkOrigin: 'created' | 'linked';
    linkedReport: {
      id: number;
      activityDate: string;
      status: NightReportStatus;
      leaderName: string | null;
    } | null;
    accountId: number | null;
    accountName: string | null;
    categoryId: number | null;
    categoryName: string | null;
    vendorId: number | null;
    vendorName: string | null;
    invoiceFileId: number | null;
    invoiceReferenceCount: number;
    receiptGroupKey: string | null;
    receiptTotalMinor: number | null;
    receiptCurrency: string | null;
    receiptAllocationNote: string | null;
    receiptLineOrder: number | null;
    receiptItems: Array<{
      description: string | null;
      quantity: number;
      amountMinor: number;
    }>;
    invoiceFile: {
      id: number;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      driveFileId: string;
      driveWebViewLink: string;
      sha256: string;
      uploadedBy: number;
      uploadedAt: string;
    } | null;
  }>;
  financeSummary: {
    revenueAmount: number;
    revenueCurrency: string;
    revenueItems: Array<{
      id: string;
      label: string;
      subtitle: string | null;
      amount: number;
      currency: string;
    }>;
    linkedCostAmount: number;
    openBarCostAmount: number;
    staffPayoutAmount: number;
    totalCostAmount: number;
    costCurrency: string;
    costItems: Array<{
      id: string;
      kind: 'linked_cost' | 'open_bar' | 'staff_payout';
      label: string;
      subtitle: string | null;
      amount: number;
      currency: string;
    }>;
    earningsAmount: number;
    earningsCurrency: string;
  };
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
};

type NightReportAvailableCostPayload = NightReportPayload['costs'][number];

type NightReportCostReconciliationSummary = {
  required: boolean;
  resolved: boolean;
  resolution: 'not_required' | 'linked_costs' | 'no_extra_cost_confirmed' | 'unresolved';
  linkedCostCount: number;
  noExtraCostConfirmed: boolean;
  noExtraCostConfirmedAt: string | null;
  noExtraCostConfirmedBy: {
    id: number;
    fullName: string;
  } | null;
};

type NightReportCostPayload = {
  date: string;
  accountId: number;
  currency: string;
  amountMinor: number;
  categoryId: number | null;
  counterpartyId: number;
  paymentMethod?: string | null;
  status?: 'planned' | 'approved' | 'awaiting_reimbursement' | 'paid' | 'reimbursed' | 'void';
  description?: string | null;
  invoiceFileId?: number | null;
};

type NightReportReceiptAllocationLinePayload = {
  reportId: number;
  amountMinor: number;
  receiptAllocationNote?: string | null;
  receiptItems?: Array<{
    description?: string | null;
    quantity?: number;
    amountMinor: number;
  }>;
};

type NightReportReceiptAllocationPayload = {
  date: string;
  accountId: number;
  currency: string;
  receiptTotalMinor: number;
  categoryId: number | null;
  counterpartyId: number;
  paymentMethod?: string | null;
  status?: 'planned' | 'approved' | 'awaiting_reimbursement' | 'paid' | 'reimbursed' | 'void';
  description?: string | null;
  invoiceFileId?: number | null;
  lines: NightReportReceiptAllocationLinePayload[];
};

const ADMIN_ROLE_SLUGS = new Set(['admin', 'owner', 'super_admin']);
type SummaryPeriod = 'this_month' | 'last_month' | 'this_week' | 'last_week' | 'this_year' | 'all_time' | 'custom';

const SUMMARY_PERIODS: SummaryPeriod[] = [
  'this_month',
  'last_month',
  'this_week',
  'last_week',
  'this_year',
  'all_time',
  'custom',
];

const roundCurrencyValue = (value: number): number => Math.round(value * 100) / 100;
const convertMajorUnitsToMinor = (value: number): number => Math.round(value * 100);
const convertMinorUnitsToMajor = (value: number | string | null | undefined): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  const numeric = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return roundCurrencyValue(numeric / 100);
};

const parseMajorCurrency = (value: unknown): number => {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatTicketTypeLabel = (ticketType: 'normal' | 'cocktail' | 'brunch' | 'generic'): string => {
  switch (ticketType) {
    case 'cocktail':
      return 'Cocktail';
    case 'brunch':
      return 'Brunch';
    case 'generic':
      return 'Generic';
    case 'normal':
    default:
      return 'Normal';
  }
};

type CommissionSummarySnapshot = {
  userId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  breakdown?: Array<{
    counterId?: number | null;
    commission?: number | string | null;
  }>;
  counterIncentiveTotals?: Record<string, number | string | null>;
};

type CommissionResponsePayload = Array<{
  data?: CommissionSummarySnapshot[];
}>;

async function loadNightReportStaffPayoutSummary(
  report: NightReport,
  req: AuthenticatedRequest,
): Promise<{
  amount: number;
  currency: string;
  items: Array<{
    id: string;
    kind: 'staff_payout';
    label: string;
    subtitle: string | null;
    amount: number;
    currency: string;
  }>;
}> {
  const counterId = Number(report.counterId ?? 0);
  if (!Number.isInteger(counterId) || counterId <= 0) {
    return {
      amount: 0,
      currency: resolvePayoutCurrency(),
      items: [],
    };
  }

  const rangeStart = dayjs(report.activityDate).startOf('month').format('YYYY-MM-DD');
  const rangeEnd = dayjs(report.activityDate).endOf('month').format('YYYY-MM-DD');

  let statusCode = 200;
  let responsePayload: CommissionResponsePayload | null = null;

  const mockReq = {
    ...req,
    query: {
      startDate: rangeStart,
      endDate: rangeEnd,
    },
    authContext: {
      ...(req.authContext ?? {}),
      roleSlug: 'admin',
    },
  } as unknown as Request & AuthenticatedRequest;

  const mockRes = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: CommissionResponsePayload) {
      responsePayload = payload;
      return this;
    },
  } as unknown as Response;

  await getCommissionByDateRange(mockReq, mockRes);

  const payloadArray = responsePayload as CommissionResponsePayload | null;
  const firstPayloadEntry = statusCode === 200 && payloadArray && payloadArray.length > 0 ? payloadArray[0] : null;
  const summaries = firstPayloadEntry && Array.isArray(firstPayloadEntry.data) ? firstPayloadEntry.data : null;

  if (!summaries) {
    return {
      amount: 0,
      currency: resolvePayoutCurrency(),
      items: [],
    };
  }

  const currency = resolvePayoutCurrency();
  const items = summaries.reduce<Array<{
    id: string;
    kind: 'staff_payout';
    label: string;
    subtitle: string | null;
    amount: number;
    currency: string;
  }>>((acc, summary: CommissionSummarySnapshot) => {
      const commissionAmount = Array.isArray(summary.breakdown)
        ? summary.breakdown.reduce((innerSum: number, item) => {
            if (Number(item.counterId ?? 0) !== counterId) {
              return innerSum;
            }
            return innerSum + parseMajorCurrency(item.commission);
          }, 0)
        : 0;

      const incentiveAmount = parseMajorCurrency(summary.counterIncentiveTotals?.[String(counterId)]);
      const totalAmount = roundCurrencyValue(commissionAmount + incentiveAmount);
      if (totalAmount <= 0) {
        return acc;
      }

      const fullName = `${summary.firstName ?? ''} ${summary.lastName ?? ''}`.trim() || `User #${summary.userId ?? 'unknown'}`;
      const subtitleParts = [
        commissionAmount > 0 ? `Commission ${currency} ${roundCurrencyValue(commissionAmount).toFixed(2)}` : null,
        incentiveAmount > 0 ? `Incentive ${currency} ${roundCurrencyValue(incentiveAmount).toFixed(2)}` : null,
      ].filter(Boolean);

      acc.push({
        id: `staff-${summary.userId ?? fullName}`,
        kind: 'staff_payout',
        label: fullName,
        subtitle: subtitleParts.length > 0 ? subtitleParts.join(' • ') : null,
        amount: totalAmount,
        currency,
      });
      return acc;
    }, []);

  return {
    amount: roundCurrencyValue(items.reduce((sum, item) => sum + item.amount, 0)),
    currency,
    items,
  };
}

async function loadNightReportRevenueSummary(report: NightReport): Promise<{
  amount: number;
  currency: string;
  items: Array<{
    id: string;
    label: string;
    subtitle: string | null;
    amount: number;
    currency: string;
  }>;
}> {
  const productId = report.counter?.productId ?? null;
  if (!report.activityDate || productId == null) {
    return { amount: 0, currency: resolvePayoutCurrency(), items: [] };
  }

  const bookings = await Booking.findAll({
    where: {
      productId,
      experienceDate: report.activityDate,
      status: {
        [Op.ne]: 'cancelled',
      },
    },
    attributes: [
      'id',
      'platform',
      'platformOrderId',
      'platformBookingId',
      'guestFirstName',
      'guestLastName',
      'baseAmount',
      'tipAmount',
      'processingFee',
      'currency',
    ],
    order: [
      ['platformOrderId', 'ASC'],
      ['platformBookingId', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  if (bookings.length === 0) {
    return { amount: 0, currency: resolvePayoutCurrency(), items: [] };
  }

  const currency =
    bookings.find((booking) => typeof booking.currency === 'string' && booking.currency.trim().length > 0)?.currency?.trim().toUpperCase() ??
    resolvePayoutCurrency();

  const items = bookings.map((booking) => {
    const baseAmount = parseMajorCurrency(booking.baseAmount);
    const tipAmount = parseMajorCurrency(booking.tipAmount);
    const processingFee = parseMajorCurrency(booking.processingFee);
    const amount = roundCurrencyValue(baseAmount + tipAmount - processingFee);
    const guestName = `${booking.guestFirstName ?? ''} ${booking.guestLastName ?? ''}`.trim() || null;
    const bookingRef = booking.platformOrderId?.trim() || booking.platformBookingId?.trim() || `Booking #${booking.id}`;
    const subtitle = [
      guestName,
      `Base ${currency} ${baseAmount.toFixed(2)}`,
      tipAmount > 0 ? `Tip ${currency} ${tipAmount.toFixed(2)}` : null,
      processingFee > 0 ? `Fee ${currency} ${processingFee.toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join(' • ');

    return {
      id: `booking-${booking.id}`,
      label: bookingRef,
      subtitle: subtitle || null,
      amount,
      currency,
    };
  });

  return {
    amount: roundCurrencyValue(items.reduce((sum, item) => sum + item.amount, 0)),
    currency,
    items,
  };
}

const parseAmountToMinor = (value: unknown): number => {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, 'Amount must be a valid number');
  }
  return Math.round(parsed * 100);
};

const resolveVenueSummaryRange = async (
  rawPeriod: string | undefined,
  startDateParam?: string,
  endDateParam?: string,
): Promise<{ period: SummaryPeriod; start: dayjs.Dayjs; end: dayjs.Dayjs }> => {
  const normalized = SUMMARY_PERIODS.includes(rawPeriod as SummaryPeriod)
    ? (rawPeriod as SummaryPeriod)
    : ('this_month' as SummaryPeriod);

  const now = dayjs();
  let start: dayjs.Dayjs;
  let end: dayjs.Dayjs;

  if (normalized === 'last_month') {
    start = now.subtract(1, 'month').startOf('month');
    end = start.endOf('month');
  } else if (normalized === 'this_week') {
    start = now.startOf('week');
    end = now.endOf('week');
  } else if (normalized === 'last_week') {
    start = now.subtract(1, 'week').startOf('week');
    end = start.endOf('week');
  } else if (normalized === 'this_year') {
    start = now.startOf('year');
    end = now.endOf('year');
  } else if (normalized === 'all_time') {
    const [firstReport, lastReport] = await Promise.all([
      NightReport.findOne({
        where: { status: 'submitted' },
        attributes: ['activityDate'],
        order: [['activityDate', 'ASC']],
      }),
      NightReport.findOne({
        where: { status: 'submitted' },
        attributes: ['activityDate'],
        order: [['activityDate', 'DESC']],
      }),
    ]);

    if (firstReport?.activityDate && lastReport?.activityDate) {
      start = dayjs(firstReport.activityDate).startOf('day');
      end = dayjs(lastReport.activityDate).endOf('day');
    } else {
      start = now.startOf('month');
      end = now.endOf('month');
    }
  } else if (normalized === 'custom') {
    if (!startDateParam || !endDateParam) {
      throw new HttpError(400, 'Provide startDate and endDate when using the custom period');
    }
    start = dayjs(startDateParam).startOf('day');
    end = dayjs(endDateParam).endOf('day');
  } else {
    start = now.startOf('month');
    end = now.endOf('month');
  }

  if (normalized !== 'custom') {
    if (startDateParam) {
      const override = dayjs(startDateParam).startOf('day');
      if (!override.isValid()) {
        throw new HttpError(400, 'Invalid startDate provided');
      }
      start = override;
    }
    if (endDateParam) {
      const override = dayjs(endDateParam).endOf('day');
      if (!override.isValid()) {
        throw new HttpError(400, 'Invalid endDate provided');
      }
      end = override;
    }
  }

  if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
    throw new HttpError(400, 'Provide a valid date range');
  }

  return { period: normalized, start, end };
};

const NIGHT_REPORT_COLUMNS = [
  { header: 'ID', accessorKey: 'id', type: 'number' },
  { header: 'Date', accessorKey: 'activityDate', type: 'date' },
  { header: 'Leader', accessorKey: 'leaderName', type: 'text' },
  { header: 'Status', accessorKey: 'status', type: 'text' },
  { header: 'Total Venues', accessorKey: 'venuesCount', type: 'number' },
  { header: 'Total People', accessorKey: 'totalPeople', type: 'number' },
  { header: 'Counter ID', accessorKey: 'counterId', type: 'number' },
];

type VenueInput = {
  orderIndex?: number;
  venueName?: string;
  venueId?: number;
  totalPeople?: number;
  isOpenBar?: boolean;
  normalCount?: number | null;
  cocktailsCount?: number | null;
  brunchCount?: number | null;
};

function requireActorId(req: AuthenticatedRequest): number {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new HttpError(401, 'Unauthorized');
  }
  return actorId;
}

function isAdminRole(roleSlug: string | null | undefined): boolean {
  if (!roleSlug) {
    return false;
  }
  return ADMIN_ROLE_SLUGS.has(roleSlug);
}

function canManageReport(report: NightReport, actorId: number, roleSlug: string | null | undefined): boolean {
  if (isAdminRole(roleSlug)) {
    return true;
  }
  if (report.leaderId === actorId) {
    return true;
  }
  if (report.counter && report.counter.userId === actorId) {
    return true;
  }
  return false;
}

const buildPhotoDownloadUrl = (req: AuthenticatedRequest, reportId: number, photoId: number): string => {
  const basePath = `${req.baseUrl ?? ''}`.replace(/\/+$/, '');
  const isProduction = (process.env.NODE_ENV ?? '').trim() === 'production';

  let normalizedBase = basePath;
  if (!normalizedBase) {
    normalizedBase = isProduction ? '/nightReports' : '/api/nightReports';
  } else if (isProduction) {
    normalizedBase = normalizedBase.replace(/^\/?api(\/|$)/i, '/');
  } else if (!normalizedBase.startsWith('/api')) {
    normalizedBase = normalizedBase.startsWith('/')
      ? `/api${normalizedBase}`
      : `/api/${normalizedBase}`;
  }

  if (!normalizedBase.startsWith('/')) {
    normalizedBase = `/${normalizedBase}`;
  }

  normalizedBase = normalizedBase.replace(/\/+$/, '') || (isProduction ? '/nightReports' : '/api/nightReports');

  return `${normalizedBase}/${reportId}/photos/${photoId}/download`;
};

async function listNightReportCosts(reportId: number) {
  return FinanceTransaction.findAll({
    where: {
      kind: 'expense',
      nightReportId: reportId,
    },
    include: [
      { model: FinanceAccount, as: 'account', required: false },
      { model: FinanceCategory, as: 'category', required: false },
      { model: FinanceVendor, as: 'vendor', required: false },
      { model: Product, as: 'product', required: false },
      { model: FinanceFile, as: 'invoiceFile', required: false },
    ],
    order: [
      ['date', 'DESC'],
      ['id', 'DESC'],
    ],
  });
}

async function listNightReportCostCounts(reportIds: number[]): Promise<Map<number, number>> {
  if (reportIds.length === 0) {
    return new Map();
  }

  const rows = await FinanceTransaction.findAll({
    attributes: ['nightReportId', [fn('COUNT', col('id')), 'count']],
    where: {
      kind: 'expense',
      nightReportId: {
        [Op.in]: reportIds,
      },
    },
    group: ['nightReportId'],
    raw: true,
  });

  const counts = new Map<number, number>();
  rows.forEach((row) => {
    const reportId = Number((row as { nightReportId?: number | null }).nightReportId);
    const count = Number((row as { count?: string | number | null }).count ?? 0);
    if (Number.isInteger(reportId) && reportId > 0) {
      counts.set(reportId, Number.isFinite(count) ? count : 0);
    }
  });
  return counts;
}

function getNightReportAttendanceFlags(report: NightReport): { didNotOperate: boolean; noVenueAttendance: boolean } {
  const normalizedNotes = (report.notes ?? '').trim().toLowerCase();
  const didNotOperate = normalizedNotes === DID_NOT_OPERATE_NOTE.toLowerCase();
  const venues = report.venues ?? [];
  const noVenueAttendance =
    venues.length === 0 ||
    venues.every((venue) => Math.max(0, Number(venue.totalPeople ?? 0)) === 0);
  return { didNotOperate, noVenueAttendance };
}

function buildNightReportCostReconciliationSummary(
  report: NightReport,
  linkedCostCount: number,
): NightReportCostReconciliationSummary {
  const product = report.counter?.product ?? null;
  const { didNotOperate, noVenueAttendance } = getNightReportAttendanceFlags(report);
  const required = Boolean(product?.requiresNightReportCostReconciliation) && !didNotOperate && !noVenueAttendance;
  const noExtraCostConfirmedBy = report.noExtraCostConfirmer
    ? {
        id: report.noExtraCostConfirmer.id,
        fullName: `${report.noExtraCostConfirmer.firstName ?? ''} ${report.noExtraCostConfirmer.lastName ?? ''}`.trim(),
      }
    : null;

  if (!required) {
    return {
      required: false,
      resolved: true,
      resolution: 'not_required',
      linkedCostCount,
      noExtraCostConfirmed: Boolean(report.noExtraCostConfirmed),
      noExtraCostConfirmedAt: report.noExtraCostConfirmedAt ? report.noExtraCostConfirmedAt.toISOString() : null,
      noExtraCostConfirmedBy,
    };
  }

  if (linkedCostCount > 0) {
    return {
      required: true,
      resolved: true,
      resolution: 'linked_costs',
      linkedCostCount,
      noExtraCostConfirmed: Boolean(report.noExtraCostConfirmed),
      noExtraCostConfirmedAt: report.noExtraCostConfirmedAt ? report.noExtraCostConfirmedAt.toISOString() : null,
      noExtraCostConfirmedBy,
    };
  }

  if (report.noExtraCostConfirmed) {
    return {
      required: true,
      resolved: true,
      resolution: 'no_extra_cost_confirmed',
      linkedCostCount,
      noExtraCostConfirmed: true,
      noExtraCostConfirmedAt: report.noExtraCostConfirmedAt ? report.noExtraCostConfirmedAt.toISOString() : null,
      noExtraCostConfirmedBy,
    };
  }

  return {
    required: true,
    resolved: false,
    resolution: 'unresolved',
    linkedCostCount,
    noExtraCostConfirmed: false,
    noExtraCostConfirmedAt: null,
    noExtraCostConfirmedBy,
  };
}

function resolveNightReportCostLinkOrigin(cost: FinanceTransaction): 'created' | 'linked' {
  return cost.meta?.source === 'night-report-cost' ? 'created' : 'linked';
}

const SPLIT_GROUP_META_KEY = 'split_group_key';
const SPLIT_TOTAL_META_KEY = 'split_total_minor';
const SPLIT_ROOT_TRANSACTION_META_KEY = 'split_root_transaction_id';

type SplitGroupMeta = {
  splitGroupKey: string;
  splitTotalMinor: number;
  splitRootTransactionId: number | null;
  meta: Record<string, unknown> | null;
};

function readSplitGroupMeta(cost: FinanceTransaction): SplitGroupMeta | null {
  const meta = cost.meta && typeof cost.meta === 'object' ? (cost.meta as Record<string, unknown>) : null;
  const splitGroupKeyValue = meta?.[SPLIT_GROUP_META_KEY];
  const splitTotalMinorValue = meta?.[SPLIT_TOTAL_META_KEY];
  const splitRootTransactionIdValue = meta?.[SPLIT_ROOT_TRANSACTION_META_KEY];

  if (typeof splitGroupKeyValue !== 'string' || splitGroupKeyValue.trim().length === 0) {
    return null;
  }

  const splitTotalMinor = Number(splitTotalMinorValue);
  if (!Number.isFinite(splitTotalMinor) || splitTotalMinor < 0) {
    return null;
  }

  const splitRootTransactionId = Number(splitRootTransactionIdValue);

  return {
    splitGroupKey: splitGroupKeyValue.trim(),
    splitTotalMinor: Math.round(splitTotalMinor),
    splitRootTransactionId: Number.isFinite(splitRootTransactionId) && splitRootTransactionId > 0
      ? Math.round(splitRootTransactionId)
      : null,
    meta,
  };
}

function buildSplitMeta(
  baseMeta: Record<string, unknown> | null,
  splitGroupKey: string,
  splitTotalMinor: number,
  splitRootTransactionId: number,
): Record<string, unknown> {
  return {
    ...(baseMeta ?? {}),
    [SPLIT_GROUP_META_KEY]: splitGroupKey,
    [SPLIT_TOTAL_META_KEY]: splitTotalMinor,
    [SPLIT_ROOT_TRANSACTION_META_KEY]: splitRootTransactionId,
  };
}

function clearSplitMeta(baseMeta: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!baseMeta) {
    return null;
  }

  const nextMeta = { ...baseMeta };
  delete nextMeta[SPLIT_GROUP_META_KEY];
  delete nextMeta[SPLIT_TOTAL_META_KEY];
  delete nextMeta[SPLIT_ROOT_TRANSACTION_META_KEY];
  return Object.keys(nextMeta).length > 0 ? nextMeta : null;
}

function distributeSplitAmount(totalMinor: number, count: number): number[] {
  if (!Number.isFinite(totalMinor) || totalMinor < 0) {
    return Array.from({ length: count }, () => 0);
  }
  if (!Number.isInteger(count) || count <= 0) {
    return [];
  }

  const baseShare = Math.floor(totalMinor / count);
  const remainder = totalMinor % count;
  return Array.from({ length: count }, (_, index) => baseShare + (index < remainder ? 1 : 0));
}

async function listSplitGroupCosts(
  splitGroupKey: string,
  transaction?: Transaction,
): Promise<FinanceTransaction[]> {
  return FinanceTransaction.findAll({
    where: {
      kind: 'expense',
      [Op.and]: [where(fn('jsonb_extract_path_text', col('meta'), SPLIT_GROUP_META_KEY), splitGroupKey)],
    },
    include: [
      { model: FinanceAccount, as: 'account', required: false },
      { model: FinanceCategory, as: 'category', required: false },
      { model: FinanceVendor, as: 'vendor', required: false },
      { model: Product, as: 'product', required: false },
      {
        model: NightReport,
        as: 'nightReport',
        required: false,
        include: [{ model: User, as: 'leader', required: false }],
      },
      { model: FinanceFile, as: 'invoiceFile', required: false },
    ],
    order: [
      ['id', 'ASC'],
    ],
    transaction,
  });
}

async function rebalanceSplitGroupCosts(
  splitGroupKey: string,
  actorId: number,
  options?: { transaction?: Transaction },
): Promise<FinanceTransaction[]> {
  const rows = await listSplitGroupCosts(splitGroupKey, options?.transaction);
  if (rows.length === 0) {
    return [];
  }

  const meta = rows[0].meta && typeof rows[0].meta === 'object' ? (rows[0].meta as Record<string, unknown>) : null;
  const splitTotalMinor = (() => {
    const fromMeta = Number(meta?.[SPLIT_TOTAL_META_KEY]);
    if (Number.isFinite(fromMeta) && fromMeta >= 0) {
      return Math.round(fromMeta);
    }
    return rows.reduce((sum, row) => sum + row.amountMinor, 0);
  })();

  const splitRootTransactionId =
    Number.isFinite(Number(meta?.[SPLIT_ROOT_TRANSACTION_META_KEY])) && Number(meta?.[SPLIT_ROOT_TRANSACTION_META_KEY]) > 0
      ? Math.round(Number(meta?.[SPLIT_ROOT_TRANSACTION_META_KEY]))
      : rows[0].id;

  if (rows.length === 1) {
    await updateFinanceTransaction(
      rows[0].id,
      {
        amountMinor: splitTotalMinor,
        meta: clearSplitMeta(meta),
      },
      actorId,
      { transaction: options?.transaction },
    );
    const updated = await FinanceTransaction.findByPk(rows[0].id, { transaction: options?.transaction });
    return updated ? [updated] : [];
  }

  const shares = distributeSplitAmount(splitTotalMinor, rows.length);
  const orderedRows = [...rows].sort((left, right) => left.id - right.id);

  for (const [index, row] of orderedRows.entries()) {
    const rowMeta = row.meta && typeof row.meta === 'object' ? (row.meta as Record<string, unknown>) : null;
    await updateFinanceTransaction(
      row.id,
      {
        amountMinor: shares[index],
        meta: buildSplitMeta(rowMeta, splitGroupKey, splitTotalMinor, splitRootTransactionId),
      },
      actorId,
      { transaction: options?.transaction },
    );
  }

  return listSplitGroupCosts(splitGroupKey, options?.transaction);
}

async function removeSplitGroupCostMember(
  transaction: FinanceTransaction,
  actorId: number,
  options?: { transaction?: Transaction },
): Promise<void> {
  const splitMeta = readSplitGroupMeta(transaction);
  if (!splitMeta) {
    await deleteFinanceTransactionAndCleanupInvoice(transaction);
    return;
  }

  const invoiceFileId = transaction.invoiceFileId ?? null;

  await FinanceTransaction.destroy({
    where: { id: transaction.id },
    transaction: options?.transaction,
  });

  await rebalanceSplitGroupCosts(splitMeta.splitGroupKey, actorId, options);

  await cleanupInvoiceFileIfOrphan(invoiceFileId);
}

function serializeNightReportCost(
  cost: FinanceTransaction,
  invoiceReferenceCounts?: Map<number, number>,
): NightReportAvailableCostPayload {
  const meta = cost.meta && typeof cost.meta === 'object' ? (cost.meta as Record<string, unknown>) : null;
  const rawReceiptItems = Array.isArray(meta?.receipt_items) ? (meta.receipt_items as Array<Record<string, unknown>>) : [];
  const linkedReport =
    cost.nightReport && cost.nightReportId
      ? {
          id: cost.nightReport.id,
          activityDate: cost.nightReport.activityDate,
          status: cost.nightReport.status,
          leaderName: cost.nightReport.leader
            ? `${cost.nightReport.leader.firstName ?? ''} ${cost.nightReport.leader.lastName ?? ''}`.trim()
            : null,
        }
      : null;
  return {
    id: cost.id,
    date: cost.date,
    serviceDate: cost.serviceDate ?? null,
    currency: cost.currency,
    amountMinor: cost.amountMinor,
    status: cost.status,
    paymentMethod: cost.paymentMethod ?? null,
    description: cost.description ?? null,
    nightReportId: cost.nightReportId ?? null,
    productId: cost.productId ?? null,
    productName: cost.product?.name ?? null,
    linkOrigin: resolveNightReportCostLinkOrigin(cost),
    linkedReport,
    accountId: cost.accountId ?? null,
    accountName: cost.account?.name ?? null,
    categoryId: cost.categoryId ?? null,
    categoryName: cost.category?.name ?? null,
    vendorId: cost.counterpartyId ?? null,
    vendorName: cost.vendor?.name ?? null,
    invoiceFileId: cost.invoiceFileId ?? null,
    invoiceReferenceCount:
      cost.invoiceFileId != null ? invoiceReferenceCounts?.get(cost.invoiceFileId) ?? 1 : 0,
    receiptGroupKey: cost.receiptGroupKey ?? null,
    receiptTotalMinor: cost.receiptTotalMinor ?? null,
    receiptCurrency: cost.receiptCurrency ?? null,
    receiptAllocationNote: cost.receiptAllocationNote ?? null,
    receiptLineOrder: cost.receiptLineOrder ?? null,
    receiptItems: rawReceiptItems.map((item) => ({
      description:
        typeof item.description === 'string' && item.description.trim().length > 0 ? item.description.trim() : null,
      quantity: Math.max(1, Math.round(Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1)),
      amountMinor: Number.isFinite(Number(item.amountMinor)) ? Math.round(Number(item.amountMinor)) : 0,
    })),
    invoiceFile: cost.invoiceFile
      ? {
          id: cost.invoiceFile.id,
          originalName: cost.invoiceFile.originalName,
          mimeType: cost.invoiceFile.mimeType,
          sizeBytes: cost.invoiceFile.sizeBytes,
          driveFileId: cost.invoiceFile.driveFileId,
          driveWebViewLink: cost.invoiceFile.driveWebViewLink,
          sha256: cost.invoiceFile.sha256,
          uploadedBy: cost.invoiceFile.uploadedBy,
          uploadedAt:
            cost.invoiceFile.uploadedAt instanceof Date
              ? cost.invoiceFile.uploadedAt.toISOString()
              : new Date(cost.invoiceFile.uploadedAt).toISOString(),
        }
      : null,
  };
}

async function listLinkableNightReportCosts(report: NightReport): Promise<FinanceTransaction[]> {
  const activityDate = dayjs(report.activityDate);
  const reportProductId = report.counter?.productId ?? null;
  const windowStart = activityDate.subtract(14, 'day').format('YYYY-MM-DD');
  const windowEnd = activityDate.add(3, 'day').format('YYYY-MM-DD');

  const orConditions: Array<Record<string, unknown>> = [
    {
      date: {
        [Op.gte]: windowStart,
        [Op.lte]: windowEnd,
      },
    },
    {
      serviceDate: report.activityDate,
    },
  ];

  if (reportProductId) {
    orConditions.push({ productId: reportProductId });
  }

  const rows = await FinanceTransaction.findAll({
    where: {
      kind: 'expense',
      [Op.and]: [
        {
          [Op.or]: [
            { nightReportId: null },
            { nightReportId: { [Op.ne]: report.id } },
          ],
        },
      ],
      [Op.or]: orConditions,
    },
    include: [
      { model: FinanceAccount, as: 'account', required: false },
      { model: FinanceCategory, as: 'category', required: false },
      { model: FinanceVendor, as: 'vendor', required: false },
      { model: Product, as: 'product', required: false },
      {
        model: NightReport,
        as: 'nightReport',
        required: false,
        include: [{ model: User, as: 'leader', required: false }],
      },
      { model: FinanceFile, as: 'invoiceFile', required: false },
    ],
    order: [
      ['date', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: 100,
  });

  return rows.sort((left, right) => {
    const score = (row: FinanceTransaction): number => {
      let current = 0;
      if (row.serviceDate === report.activityDate) current += 4;
      if (reportProductId && row.productId === reportProductId) current += 3;
      if (row.date === report.activityDate) current += 2;
      if (row.invoiceFileId) current += 0.25;
      if (row.nightReportId == null) current += 0.5;
      return current;
    };
    return score(right) - score(left) || dayjs(right.date).valueOf() - dayjs(left.date).valueOf() || right.id - left.id;
  });
}

async function listNightReportReceiptGroupCosts(receiptGroupKey: string): Promise<FinanceTransaction[]> {
  const rows = await FinanceTransaction.findAll({
    where: {
      kind: 'expense',
      receiptGroupKey,
    },
    include: [
      { model: FinanceAccount, as: 'account', required: false },
      { model: FinanceCategory, as: 'category', required: false },
      { model: FinanceVendor, as: 'vendor', required: false },
      { model: Product, as: 'product', required: false },
      {
        model: NightReport,
        as: 'nightReport',
        required: false,
        include: [{ model: User, as: 'leader', required: false }],
      },
      { model: FinanceFile, as: 'invoiceFile', required: false },
    ],
    order: [
      ['receiptLineOrder', 'ASC'],
      ['date', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  return rows;
}

async function serializeNightReport(report: NightReport, req: AuthenticatedRequest): Promise<NightReportPayload> {
  const leader = report.leader
    ? {
        id: report.leader.id,
        fullName: `${report.leader.firstName ?? ''} ${report.leader.lastName ?? ''}`.trim(),
      }
    : null;

  const counter = report.counter
    ? {
        id: report.counter.id,
        date: report.counter.date,
      }
    : null;
  const product = report.counter?.product ?? null;

  const venues = (report.venues ?? [])
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((venue) => ({
      id: venue.id,
      orderIndex: venue.orderIndex,
      venueName: venue.venueName,
       venueId: venue.venueId ?? null,
      totalPeople: venue.totalPeople,
      isOpenBar: venue.isOpenBar,
      normalCount: venue.normalCount,
      cocktailsCount: venue.cocktailsCount,
      brunchCount: venue.brunchCount,
      compensationTermId: venue.compensationTermId ?? null,
      compensationType: venue.compensationType ?? null,
      compensationDirection: venue.direction ?? null,
      rateApplied: venue.rateApplied != null ? Number(venue.rateApplied) : null,
      rateUnit: venue.rateUnit ?? null,
      payoutAmount: venue.payoutAmount != null ? Number(venue.payoutAmount) : null,
      currencyCode: venue.currencyCode ?? null,
    }));

  const photos = (report.photos ?? []).map((photo) => ({
    id: photo.id,
    originalName: photo.originalName,
    mimeType: photo.mimeType,
    fileSize: photo.fileSize,
    capturedAt: photo.capturedAt ? photo.capturedAt.toISOString() : null,
    downloadUrl: buildPhotoDownloadUrl(req, report.id, photo.id),
  }));

  const costRows = await listNightReportCosts(report.id);
  const invoiceFileIds = Array.from(
    new Set(
      costRows
        .map((cost) => cost.invoiceFileId)
        .filter((value): value is number => Number.isInteger(value) && Number(value) > 0),
    ),
  );
  const invoiceReferenceCounts = new Map<number, number>();
  if (invoiceFileIds.length > 0) {
    const usageRows = await FinanceTransaction.findAll({
      attributes: ['invoiceFileId', [fn('COUNT', col('id')), 'usageCount']],
      where: {
        invoiceFileId: {
          [Op.in]: invoiceFileIds,
        },
      },
      group: ['invoiceFileId'],
      raw: true,
    });
    usageRows.forEach((row) => {
      const invoiceFileId = Number((row as { invoiceFileId?: number | string }).invoiceFileId);
      const usageCount = Number((row as { usageCount?: number | string }).usageCount);
      if (Number.isInteger(invoiceFileId) && invoiceFileId > 0) {
        invoiceReferenceCounts.set(invoiceFileId, Number.isFinite(usageCount) && usageCount > 0 ? usageCount : 1);
      }
    });
  }
  const costs = costRows.map((cost) => serializeNightReportCost(cost, invoiceReferenceCounts));
  const costReconciliation = buildNightReportCostReconciliationSummary(report, costs.length);
  const requiresCostReconciliation = costReconciliation.required;
  const linkedCostAmount = roundCurrencyValue(costs.reduce((sum, cost) => sum + convertMinorUnitsToMajor(cost.amountMinor), 0));
  const openBarCostAmount = roundCurrencyValue(
    venues.reduce((sum, venue) => {
      if (
        venue.isOpenBar !== true ||
        venue.compensationType !== 'open_bar' ||
        venue.payoutAmount == null ||
        !Number.isFinite(Number(venue.payoutAmount))
      ) {
        return sum;
      }
      return sum + Number(venue.payoutAmount);
    }, 0),
  );
  const staffPayoutSummary = await loadNightReportStaffPayoutSummary(report, req);
  const revenueSummary = await loadNightReportRevenueSummary(report);
  const openBarTermIds = Array.from(
    new Set(
      venues
        .filter((venue) => venue.isOpenBar === true && venue.compensationType === 'open_bar' && venue.compensationTermId != null)
        .map((venue) => Number(venue.compensationTermId))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );
  const openBarTerms = openBarTermIds.length
    ? await VenueCompensationTerm.findAll({
        where: {
          id: { [Op.in]: openBarTermIds },
        },
      })
    : [];
  const openBarTermMap = new Map<number, VenueCompensationTerm>();
  openBarTerms.forEach((term) => openBarTermMap.set(term.id, term));
  const openBarRates = openBarTermIds.length
    ? await VenueCompensationTermRate.findAll({
        where: {
          termId: { [Op.in]: openBarTermIds },
          isActive: true,
        },
        order: [
          ['termId', 'ASC'],
          ['productId', 'DESC'],
          ['ticketType', 'ASC'],
          ['validFrom', 'DESC'],
          ['id', 'DESC'],
        ],
      })
    : [];
  const openBarRatesByTerm = new Map<number, VenueCompensationTermRate[]>();
  openBarRates.forEach((rate) => {
    if (!openBarRatesByTerm.has(rate.termId)) {
      openBarRatesByTerm.set(rate.termId, []);
    }
    openBarRatesByTerm.get(rate.termId)!.push(rate);
  });
  const openBarCostItems = venues.flatMap((venue, index) => {
    if (
      venue.isOpenBar !== true ||
      venue.compensationType !== 'open_bar' ||
      venue.payoutAmount == null ||
      !Number.isFinite(Number(venue.payoutAmount))
    ) {
      return [];
    }

      const term =
        venue.compensationTermId != null ? openBarTermMap.get(Number(venue.compensationTermId)) ?? null : null;
      const payoutBreakdown =
        term != null
          ? computeOpenBarPayout(
              term,
              openBarRatesByTerm.get(term.id) ?? [],
              {
                normal: venue.normalCount ?? 0,
                cocktail: venue.cocktailsCount ?? 0,
                brunch: venue.brunchCount ?? 0,
              },
              product?.id ?? report.counter?.productId ?? null,
              report.activityDate,
            )
          : null;
      const bucketBreakdown = payoutBreakdown?.breakdown ?? [];
      const currency = (venue.currencyCode ?? 'PLN').trim().toUpperCase();

      if (bucketBreakdown.length === 0) {
        return [
          {
            id: `open-bar-${venue.id ?? index}`,
            kind: 'open_bar' as const,
            label: venue.venueName || 'Open Bar',
            subtitle: term ? `Term #${term.id}` : null,
            amount: roundCurrencyValue(Number(venue.payoutAmount)),
            currency,
          },
        ];
      }

      return bucketBreakdown.map((entry: (typeof bucketBreakdown)[number], entryIndex: number) => {
        const rateText = `${currency} ${roundCurrencyValue(entry.rateAmount).toFixed(2)}${entry.rateUnit === 'per_person' ? '/person' : ''}`;
        const sourceText =
          entry.source === 'ticket_rate'
            ? 'rate band'
            : entry.source === 'generic_rate'
            ? 'generic band'
            : 'term default';
        const units = entry.rateUnit === 'flat' ? 1 : entry.count;
        const amount = roundCurrencyValue(entry.rateAmount * units);

        return {
          id: `open-bar-${venue.id ?? index}-${entryIndex}`,
          kind: 'open_bar' as const,
          label: venue.venueName || 'Open Bar',
          subtitle: [term ? `Term #${term.id}` : null, `${formatTicketTypeLabel(entry.ticketType)} x${entry.count} @ ${rateText} (${sourceText})`]
            .filter(Boolean)
            .join(' • '),
          amount,
          currency,
        };
      });
    });
  const linkedCostItems = costs.map((cost) => ({
    id: `cost-${cost.id}`,
    kind: 'linked_cost' as const,
    label: cost.description?.trim() || 'Night report cost',
    subtitle: [
      dayjs(cost.date).format('MMM D, YYYY'),
      cost.vendorName,
      cost.categoryName,
      cost.paymentMethod,
    ]
      .filter(Boolean)
      .join(' • '),
    amount: convertMinorUnitsToMajor(cost.amountMinor),
    currency: cost.currency.trim().toUpperCase(),
  }));
  const costCurrency =
    venues.find((venue) => typeof venue.currencyCode === 'string' && venue.currencyCode.trim().length > 0)?.currencyCode?.trim().toUpperCase() ??
    revenueSummary.currency ??
    resolvePayoutCurrency();
  const venueCommissionAmount = roundCurrencyValue(
    venues.reduce((sum, venue) => {
      if (
        venue.compensationType !== 'commission' ||
        venue.compensationDirection !== 'receivable' ||
        venue.payoutAmount == null ||
        !Number.isFinite(Number(venue.payoutAmount))
      ) {
        return sum;
      }
      return sum + Number(venue.payoutAmount);
    }, 0),
  );
  const totalRevenueAmount = roundCurrencyValue(revenueSummary.amount + venueCommissionAmount);
  const totalCostAmount = roundCurrencyValue(linkedCostAmount + openBarCostAmount + staffPayoutSummary.amount);
  const earningsAmount = roundCurrencyValue(totalRevenueAmount - totalCostAmount);

  return {
    id: report.id,
    counterId: report.counterId,
    activityDate: report.activityDate,
    status: report.status,
    notes: report.notes ?? null,
    productId: product?.id ?? report.counter?.productId ?? null,
    productName: product?.name ?? null,
    requiresCostReconciliation,
    costReconciliation,
    leader,
    counter,
    venues,
    photos,
    costs,
    financeSummary: {
      revenueAmount: totalRevenueAmount,
      revenueCurrency: revenueSummary.currency,
      revenueItems: revenueSummary.items,
      linkedCostAmount,
      openBarCostAmount,
      staffPayoutAmount: staffPayoutSummary.amount,
      totalCostAmount,
      costCurrency,
      costItems: [...linkedCostItems, ...openBarCostItems, ...staffPayoutSummary.items],
      earningsAmount,
      earningsCurrency: revenueSummary.currency,
    },
    submittedAt: report.submittedAt ? report.submittedAt.toISOString() : null,
    createdAt: report.createdAt instanceof Date ? report.createdAt.toISOString() : new Date(report.createdAt).toISOString(),
    updatedAt:
      report.updatedAt instanceof Date
        ? report.updatedAt.toISOString()
        : report.updatedAt
        ? new Date(report.updatedAt).toISOString()
        : null,
  };
}

function buildSummaryRow(report: NightReport, linkedCostCount = 0) {
  const leaderName = report.leader
    ? `${report.leader.firstName ?? ''} ${report.leader.lastName ?? ''}`.trim()
    : '';
  const venues = report.venues ?? [];
  const totalPeople = venues.reduce((acc, venue) => acc + (venue.totalPeople ?? 0), 0);
  const costReconciliation = buildNightReportCostReconciliationSummary(report, linkedCostCount);
  return {
    id: report.id,
    activityDate: report.activityDate,
    leaderName,
    status: report.status,
    venuesCount: venues.length,
    totalPeople,
    counterId: report.counterId,
    productId: report.counter?.productId ?? null,
    productName: report.counter?.product?.name ?? null,
    requiresCostReconciliation: costReconciliation.required,
    costReconciliation,
  };
}

function normalizeVenueInput(raw: unknown): VenueInput[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => {
    const venue = (item ?? {}) as VenueInput;
    return {
      orderIndex: typeof venue.orderIndex === 'number' ? venue.orderIndex : undefined,
      venueName: typeof venue.venueName === 'string' ? venue.venueName.trim() : undefined,
      venueId: typeof venue.venueId === 'number' ? venue.venueId : undefined,
      totalPeople: typeof venue.totalPeople === 'number' ? venue.totalPeople : undefined,
      isOpenBar: typeof venue.isOpenBar === 'boolean' ? venue.isOpenBar : undefined,
      normalCount:
        venue.normalCount == null ? null : typeof venue.normalCount === 'number' ? venue.normalCount : undefined,
      cocktailsCount:
        venue.cocktailsCount == null ? null : typeof venue.cocktailsCount === 'number' ? venue.cocktailsCount : undefined,
      brunchCount:
        venue.brunchCount == null ? null : typeof venue.brunchCount === 'number' ? venue.brunchCount : undefined,
    };
  });
}

type NormalizedVenue = {
  orderIndex: number;
  venueName: string;
  venueId: number | null;
  totalPeople: number;
  isOpenBar: boolean;
  normalCount: number | null;
  cocktailsCount: number | null;
  brunchCount: number | null;
};

function validateAndArrangeVenues(raw: VenueInput[]): NormalizedVenue[] {
  if (raw.length === 0) {
    return [];
  }

  const sorted = raw
    .map((venue, index) => ({
      orderIndex: venue.orderIndex && venue.orderIndex > 0 ? Math.floor(venue.orderIndex) : index + 1,
      venueName: venue.venueName ?? '',
      venueId: venue.venueId ?? null,
      totalPeople: venue.totalPeople ?? 0,
      isOpenBar: venue.isOpenBar ?? index === 0,
      normalCount: venue.normalCount ?? null,
      cocktailsCount: venue.cocktailsCount ?? null,
      brunchCount: venue.brunchCount ?? null,
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((venue, index) => ({
      ...venue,
      orderIndex: index + 1,
    }));

  if (sorted.some((venue) => !venue.venueName)) {
    throw new HttpError(400, 'Each venue entry must include a name');
  }

  if (sorted.some((venue) => venue.totalPeople < 0)) {
    throw new HttpError(400, 'Venue headcount cannot be negative');
  }

  const openBarEntries = sorted.filter((venue) => venue.isOpenBar);
  if (openBarEntries.length !== 1) {
    throw new HttpError(400, 'Exactly one venue must be marked as the open bar');
  }
  if (sorted[0].isOpenBar !== true) {
    throw new HttpError(400, 'The first venue (order 1) must be marked as the open bar');
  }

  const [openBar] = openBarEntries;
  if (
    openBar.normalCount == null ||
    openBar.cocktailsCount == null ||
    openBar.brunchCount == null ||
    openBar.normalCount < 0 ||
    openBar.cocktailsCount < 0 ||
    openBar.brunchCount < 0
  ) {
    throw new HttpError(400, 'Open bar venue must include non-negative Normal, Cocktails, and Brunch counts');
  }

  return sorted;
}

type PreparedVenueRow = {
  orderIndex: number;
  venueId: number;
  venueName: string;
  totalPeople: number;
  isOpenBar: boolean;
  normalCount: number | null;
  cocktailsCount: number | null;
  brunchCount: number | null;
  compensationTermId: number;
  compensationType: 'open_bar' | 'commission';
  direction: 'payable' | 'receivable';
  rateApplied: number;
  rateUnit: 'per_person' | 'flat';
  payoutAmount: number;
  currencyCode: string;
};

const normalizeVenueKey = (value: string): string => value.trim().toLowerCase();

const roundToCents = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
};

async function resolveNightReportVenueRows(
  venues: NormalizedVenue[],
  activityDate: string,
  productId: number | null,
  transaction?: Transaction,
): Promise<PreparedVenueRow[]> {
  if (venues.length === 0) {
    return [];
  }

  const trimmedDate = (activityDate ?? '').trim();
  if (!trimmedDate) {
    throw new HttpError(400, 'Activity date is required to compute venue payouts');
  }

  const directory = await Venue.findAll({ transaction });
  const byId = new Map<number, Venue>();
  const byName = new Map<string, Venue>();
  directory.forEach((venue) => {
    byId.set(venue.id, venue);
    if (venue.name) {
      byName.set(normalizeVenueKey(venue.name), venue);
    }
  });

  const resolved = venues.map((entry) => {
    const key = normalizeVenueKey(entry.venueName);
    let venueRecord = entry.venueId != null ? byId.get(entry.venueId) ?? null : null;
    if (!venueRecord && key) {
      venueRecord = byName.get(key) ?? null;
    }
    if (!venueRecord) {
      throw new HttpError(400, `Venue "${entry.venueName}" is not part of the directory`);
    }
    if (entry.isOpenBar && venueRecord.allowsOpenBar !== true) {
      throw new HttpError(400, `Venue "${venueRecord.name}" is not eligible to host the open bar`);
    }
    return { entry, venue: venueRecord };
  });

  const uniqueVenueIds = [...new Set(resolved.map(({ venue }) => venue.id))];
  const terms = await VenueCompensationTerm.findAll({
    where: {
      venueId: uniqueVenueIds.length > 0 ? { [Op.in]: uniqueVenueIds } : uniqueVenueIds,
      isActive: true,
      validFrom: { [Op.lte]: trimmedDate },
      [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: trimmedDate } }],
    },
    order: [
      ['venueId', 'ASC'],
      ['compensationType', 'ASC'],
      ['validFrom', 'DESC'],
      ['id', 'DESC'],
    ],
    transaction,
  });

  const termMap = new Map<string, VenueCompensationTerm>();
  const termIds = terms.map((term) => term.id);
  const rates = termIds.length
    ? await VenueCompensationTermRate.findAll({
        where: {
          termId: { [Op.in]: termIds },
          isActive: true,
        },
        order: [
          ['termId', 'ASC'],
          ['productId', 'DESC'],
          ['ticketType', 'ASC'],
          ['validFrom', 'DESC'],
          ['id', 'DESC'],
        ],
        transaction,
      })
    : [];

  const ratesByTerm = new Map<number, VenueCompensationTermRate[]>();
  rates.forEach((rate) => {
    if (!ratesByTerm.has(rate.termId)) {
      ratesByTerm.set(rate.termId, []);
    }
    ratesByTerm.get(rate.termId)!.push(rate);
  });

  terms.forEach((term) => {
    const key = `${term.venueId}:${term.compensationType}`;
    termMap.set(key, term);
  });

  return resolved.map(({ entry, venue }) => {
    const compensationType: 'open_bar' | 'commission' = entry.isOpenBar ? 'open_bar' : 'commission';
    const direction: 'payable' | 'receivable' = entry.isOpenBar ? 'payable' : 'receivable';
    const termKey = `${venue.id}:${compensationType}`;
    const term = termMap.get(termKey);
    if (!term) {
      const hasAnyActive = terms.some(
        (candidate) => candidate.venueId === venue.id && candidate.isActive && candidate.compensationType === compensationType,
      );
      const label = entry.isOpenBar ? 'open bar payout' : 'commission';
      if (!hasAnyActive) {
        throw new HttpError(400, `No active ${label} term is configured for ${venue.name} on ${trimmedDate}`);
      }
      throw new HttpError(
        400,
        `A ${label} term for ${venue.name} exists but its date range does not cover ${trimmedDate}. Update the term or add a new one with valid dates.`,
      );
    }

    let rateApplied = 0;
    let rateUnit: 'per_person' | 'flat' = 'per_person';
    let payoutAmount = 0;

    if (entry.isOpenBar) {
      const bucketContributions = computeOpenBarPayout(
        term,
        ratesByTerm.get(term.id) ?? [],
        {
          normal: entry.normalCount ?? 0,
          cocktail: entry.cocktailsCount ?? 0,
          brunch: entry.brunchCount ?? 0,
        },
        productId,
        trimmedDate,
      );
      payoutAmount = roundToCents(bucketContributions.total);
      rateApplied = payoutAmount;
      rateUnit = 'per_person';
    } else {
      const baseRateRaw = typeof term.rateAmount === 'number' ? term.rateAmount : Number(term.rateAmount ?? 0);
      rateApplied = roundToCents(baseRateRaw);
      rateUnit = term.rateUnit === 'flat' ? 'flat' : 'per_person';
      const units = rateUnit === 'flat' ? 1 : Math.max(entry.totalPeople, 0);
      payoutAmount = roundToCents(rateApplied * units);
    }

    return {
      orderIndex: entry.orderIndex,
      venueId: venue.id,
      venueName: venue.name ?? entry.venueName,
      totalPeople: entry.totalPeople,
      isOpenBar: entry.isOpenBar,
      normalCount: entry.normalCount,
      cocktailsCount: entry.cocktailsCount,
      brunchCount: entry.brunchCount,
      compensationTermId: term.id,
      compensationType,
      direction,
      rateApplied,
      rateUnit,
      payoutAmount,
      currencyCode: term.currencyCode ?? 'USD',
    };
  });
}

function mapReportVenuesToNormalized(venues: NightReportVenue[]): NormalizedVenue[] {
  return venues
    .slice()
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
    .map((venue, index) => ({
      orderIndex: venue.orderIndex ?? index + 1,
      venueName: venue.venueName ?? '',
      venueId: venue.venueId ?? null,
      totalPeople: venue.totalPeople ?? 0,
      isOpenBar: venue.isOpenBar ?? index === 0,
      normalCount: venue.normalCount ?? null,
      cocktailsCount: venue.cocktailsCount ?? null,
      brunchCount: venue.brunchCount ?? null,
    }));
}

type BucketCounts = {
  normal: number;
  cocktail: number;
  brunch: number;
};

const bucketOrder: Array<keyof BucketCounts | 'generic'> = ['normal', 'cocktail', 'brunch', 'generic'];

function computeOpenBarPayout(
  term: VenueCompensationTerm,
  rates: VenueCompensationTermRate[],
  counts: BucketCounts,
  productId: number | null,
  referenceDate: string,
) {
  const dateValue = referenceDate;
  const contributions: number[] = [];
  const breakdown: Array<{
    ticketType: 'normal' | 'cocktail' | 'brunch' | 'generic';
    count: number;
    rateAmount: number;
    rateUnit: 'per_person' | 'flat';
    source: 'ticket_rate' | 'generic_rate' | 'term_default';
  }> = [];

  const selectRate = (ticketType: string): VenueCompensationTermRate | null => {
    const filtered = rates.filter((rate) => {
      const matchesTicket =
        rate.ticketType === ticketType ||
        (ticketType !== 'generic' && rate.ticketType === 'generic');
      if (!matchesTicket) {
        return false;
      }
      const withinStart = !rate.validFrom || rate.validFrom <= dateValue;
      const withinEnd = !rate.validTo || rate.validTo >= dateValue;
      if (!withinStart || !withinEnd) {
        return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      return null;
    }

    const productMatches = productId
      ? filtered.filter((rate) => rate.productId === productId)
      : [];
    const fallbackMatches = filtered.filter((rate) => rate.productId == null);
    const candidatePool = productMatches.length > 0 ? productMatches : fallbackMatches.length > 0 ? fallbackMatches : filtered;

    return candidatePool[0] ?? null;
  };

  const applyRate = (ticketType: keyof BucketCounts, count: number) => {
    if (!count || count <= 0) {
      return;
    }
    const rate = selectRate(ticketType);
    if (!rate) {
      const genericRate = selectRate('generic');
      if (!genericRate) {
        return;
      }
      const units = genericRate.rateUnit === 'flat' ? 1 : count;
      const rateAmount = roundToCents(Number(genericRate.rateAmount ?? 0));
      contributions.push(roundToCents(rateAmount * units));
      breakdown.push({
        ticketType,
        count,
        rateAmount,
        rateUnit: genericRate.rateUnit === 'flat' ? 'flat' : 'per_person',
        source: 'generic_rate',
      });
      return;
    }
    const units = rate.rateUnit === 'flat' ? 1 : count;
    const rateAmount = roundToCents(Number(rate.rateAmount ?? 0));
    contributions.push(roundToCents(rateAmount * units));
    breakdown.push({
      ticketType,
      count,
      rateAmount,
      rateUnit: rate.rateUnit === 'flat' ? 'flat' : 'per_person',
      source: 'ticket_rate',
    });
  };

  applyRate('normal', counts.normal);
  applyRate('cocktail', counts.cocktail);
  applyRate('brunch', counts.brunch);

  if (contributions.length === 0) {
    const fallbackRate = selectRate('generic');
    if (fallbackRate) {
      const units = fallbackRate.rateUnit === 'flat' ? 1 : Math.max(counts.normal + counts.cocktail + counts.brunch, 0);
      const rateAmount = roundToCents(Number(fallbackRate.rateAmount ?? 0));
      contributions.push(roundToCents(rateAmount * units));
      breakdown.push({
        ticketType: 'generic',
        count: Math.max(counts.normal + counts.cocktail + counts.brunch, 0),
        rateAmount,
        rateUnit: fallbackRate.rateUnit === 'flat' ? 'flat' : 'per_person',
        source: 'generic_rate',
      });
    } else {
      const baseRateRaw = typeof term.rateAmount === 'number' ? term.rateAmount : Number(term.rateAmount ?? 0);
      const rateApplied = roundToCents(baseRateRaw);
      const units = term.rateUnit === 'flat' ? 1 : Math.max(counts.normal + counts.cocktail + counts.brunch, 0);
      contributions.push(roundToCents(rateApplied * units));
      breakdown.push({
        ticketType: 'normal',
        count: Math.max(counts.normal + counts.cocktail + counts.brunch, 0),
        rateAmount: rateApplied,
        rateUnit: term.rateUnit === 'flat' ? 'flat' : 'per_person',
        source: 'term_default',
      });
    }
  }

  return {
    total: contributions.reduce((sum, value) => sum + value, 0),
    breakdown,
  };
}

async function getNightReportById(reportId: number): Promise<NightReport | null> {
  return NightReport.findByPk(reportId, {
    include: [
      {
        model: Counter,
        as: 'counter',
        include: [{ model: Product, as: 'product' }],
      },
      { model: User, as: 'leader' },
      { model: User, as: 'reassignedBy' },
      { model: User, as: 'noExtraCostConfirmer' },
      { model: NightReportVenue, as: 'venues' },
      { model: NightReportPhoto, as: 'photos' },
    ],
    order: [
      [{ model: NightReportVenue, as: 'venues' }, 'orderIndex', 'ASC'],
      [{ model: NightReportPhoto, as: 'photos' }, 'createdAt', 'ASC'],
    ],
  });
}

export const listNightReports = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};

    const { status, counterId, leaderId, from, to } = req.query;

    if (typeof status === 'string' && status) {
      where.status = status;
    }

    if (typeof counterId === 'string' && counterId) {
      where.counterId = Number(counterId);
    }

    if (typeof leaderId === 'string' && leaderId) {
      where.leaderId = Number(leaderId);
    }

    if ((typeof from === 'string' && from) || (typeof to === 'string' && to)) {
      const range: Record<string | symbol, string> = {};
      if (typeof from === 'string' && from) {
        range[Op.gte] = from;
      }
      if (typeof to === 'string' && to) {
        range[Op.lte] = to;
      }
      if (Object.keys(range).length > 0) {
        where.activityDate = range;
      }
    }

    const reports = await NightReport.findAll({
      where,
      include: [
        { model: User, as: 'leader', attributes: ['id', 'firstName', 'lastName'] },
        {
          model: Counter,
          as: 'counter',
          attributes: ['id', 'date', 'productId'],
          include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'requiresNightReportCostReconciliation'] }],
        },
        {
          model: NightReportVenue,
          as: 'venues',
          attributes: ['id', 'orderIndex', 'totalPeople', 'isOpenBar'],
        },
        { model: User, as: 'noExtraCostConfirmer', attributes: ['id', 'firstName', 'lastName'], required: false },
      ],
      order: [
        ['activityDate', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    const linkedCostCounts = await listNightReportCostCounts(reports.map((report) => report.id));
    const data = reports.map((report) => buildSummaryRow(report, linkedCostCounts.get(report.id) ?? 0));

    res.status(200).json([
      {
        data,
        columns: NIGHT_REPORT_COLUMNS,
      },
    ]);
  } catch (error) {
    logger.error('Failed to list night reports', error);
    res.status(500).json([{ message: 'Failed to list night reports' }]);
  }
};

export const createNightReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sequelize = NightReport.sequelize;
  if (!sequelize) {
    res.status(500).json([{ message: 'Database connection unavailable' }]);
    return;
  }

  try {
    const actorId = requireActorId(req);
    const body = req.body ?? {};
    const counterId = Number(body.counterId);

    if (!Number.isInteger(counterId) || counterId <= 0) {
      throw new HttpError(400, 'counterId is required');
    }

    const counter = await Counter.findByPk(counterId);
    if (!counter) {
      throw new HttpError(404, 'Counter not found');
    }

    const leaderId = body.leaderId ? Number(body.leaderId) : counter.userId;
    if (!Number.isInteger(leaderId) || leaderId <= 0) {
      throw new HttpError(400, 'leaderId is required');
    }

    const leader = await User.findByPk(leaderId);
    if (!leader) {
      throw new HttpError(404, 'Leader not found');
    }

    const activityDate = typeof body.activityDate === 'string' && body.activityDate.trim() !== '' ? body.activityDate : counter.date;

    const existing = await NightReport.findOne({ where: { counterId } });
    if (existing) {
      throw new HttpError(409, 'Night report already exists for this counter');
    }

    const venuesInput = normalizeVenueInput(body.venues);
    const normalizedVenues = validateAndArrangeVenues(venuesInput);

    const created = await sequelize.transaction(async (transaction) => {
      const report = await NightReport.create(
        {
          counterId,
          leaderId,
          activityDate,
          status: 'draft',
          notes: body.notes ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );

      if (normalizedVenues.length > 0) {
        const venueRows = await resolveNightReportVenueRows(
          normalizedVenues,
          activityDate,
          counter.productId ?? null,
          transaction,
        );
        await NightReportVenue.bulkCreate(
          venueRows.map((row) => ({
            reportId: report.id,
            ...row,
          })),
          { transaction },
        );
      }

      return report;
    });

    const fullReport = await getNightReportById(created.id);
    if (!fullReport) {
      throw new HttpError(500, 'Failed to load created report');
    }

    res.status(201).json([await serializeNightReport(fullReport, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to create night report', error);
    res.status(500).json([{ message: 'Failed to create night report' }]);
  }
};

export const getNightReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    res.status(200).json([await serializeNightReport(report, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to fetch night report', error);
    res.status(500).json([{ message: 'Failed to fetch night report' }]);
  }
};

export const updateNightReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sequelize = NightReport.sequelize;
  if (!sequelize) {
    res.status(500).json([{ message: 'Database connection unavailable' }]);
    return;
  }

  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to edit this report');
    }

    const body = req.body ?? {};
    const originalActivityDate = report.activityDate;
    const updatePayload: Partial<NightReport> = {};

    if (typeof body.activityDate === 'string' && body.activityDate.trim() !== '') {
      updatePayload.activityDate = body.activityDate;
    }

    if (typeof body.notes === 'string' || body.notes === null) {
      updatePayload.notes = body.notes ?? null;
    }

    if (body.leaderId) {
      const leaderId = Number(body.leaderId);
      if (!Number.isInteger(leaderId) || leaderId <= 0) {
        throw new HttpError(400, 'leaderId must be a positive integer');
      }
      const leader = await User.findByPk(leaderId);
      if (!leader) {
        throw new HttpError(404, 'Leader not found');
      }
      updatePayload.leaderId = leaderId;
      updatePayload.reassignedById = report.leaderId !== leaderId ? actorId : report.reassignedById ?? null;
    }

    const rawVenuesInput = body.venues;
    const hasVenuesInput = Array.isArray(rawVenuesInput);
    const venuesInput = normalizeVenueInput(rawVenuesInput);
    const normalizedVenues = venuesInput.length > 0 ? validateAndArrangeVenues(venuesInput) : [];
    const effectiveActivityDate = updatePayload.activityDate ?? report.activityDate;
    const reportProductId = report.counter?.productId ?? null;
    const shouldRebuildForDateChange =
      !hasVenuesInput && Boolean(updatePayload.activityDate) && (report.venues?.length ?? 0) > 0;
    const normalizedExistingVenues = shouldRebuildForDateChange
      ? mapReportVenuesToNormalized(report.venues ?? [])
      : [];

    await sequelize.transaction(async (transaction) => {
      if (Object.keys(updatePayload).length > 0) {
        updatePayload.updatedBy = actorId;
        await NightReport.update(updatePayload, { where: { id: reportId }, transaction });
      }

      if (updatePayload.activityDate) {
        await FinanceTransaction.update(
          { serviceDate: effectiveActivityDate, productId: reportProductId, updatedAt: new Date() },
          {
            where: { nightReportId: reportId },
            transaction,
          },
        );
      }

      if (hasVenuesInput) {
        await NightReportVenue.destroy({ where: { reportId }, transaction });
        if (normalizedVenues.length > 0) {
          const venueRows = await resolveNightReportVenueRows(
            normalizedVenues,
            effectiveActivityDate,
            reportProductId,
            transaction,
          );
          await NightReportVenue.bulkCreate(
            venueRows.map((row) => ({
              reportId,
              ...row,
            })),
            { transaction },
          );
        }
      } else if (shouldRebuildForDateChange) {
        await NightReportVenue.destroy({ where: { reportId }, transaction });
        if (normalizedExistingVenues.length > 0) {
          const venueRows = await resolveNightReportVenueRows(
            normalizedExistingVenues,
            effectiveActivityDate,
            reportProductId,
            transaction,
          );
          await NightReportVenue.bulkCreate(
            venueRows.map((row) => ({
              reportId,
              ...row,
            })),
            { transaction },
          );
        }
      }
    });

    const fresh = await getNightReportById(reportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    if (updatePayload.activityDate && updatePayload.activityDate !== originalActivityDate) {
      await reconcileNightReportTaskWaiversForReport(report, { mode: 'restore' });
    }
    await reconcileNightReportTaskWaiversForReport(fresh, { mode: 'sync' });

    res.status(200).json([await serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to update night report', error);
    res.status(500).json([{ message: 'Failed to update night report' }]);
  }
};

export const submitNightReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sequelize = NightReport.sequelize;
  if (!sequelize) {
    res.status(500).json([{ message: 'Database connection unavailable' }]);
    return;
  }

  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to submit this report');
    }

    if (report.status === 'submitted') {
      throw new HttpError(400, 'Report is already submitted');
    }

    const normalizedNotes = (report.notes ?? '').trim().toLowerCase();
    const didNotOperate = normalizedNotes === DID_NOT_OPERATE_NOTE.toLowerCase();

    const venues = report.venues ?? [];
    const noVenueAttendance =
      venues.length === 0 ||
      venues.every((venue) => Math.max(0, Number(venue.totalPeople ?? 0)) === 0);
    const hasRecordedVenues = !didNotOperate && venues.length > 0;
    if (hasRecordedVenues) {
      const openBarVenues = venues.filter((venue) => venue.isOpenBar);
      if (openBarVenues.length !== 1 || venues[0].isOpenBar !== true) {
        throw new HttpError(400, 'Ensure the first venue is marked as the open bar with required counts');
      }

      const [openBar] = openBarVenues;
      if (
        openBar.normalCount == null ||
        openBar.cocktailsCount == null ||
        openBar.brunchCount == null ||
        openBar.normalCount < 0 ||
        openBar.cocktailsCount < 0 ||
        openBar.brunchCount < 0
      ) {
        throw new HttpError(400, 'Open bar counts must be provided before submission');
      }
    }

    const photoCount = await NightReportPhoto.count({ where: { reportId } });
    if (photoCount === 0 && !didNotOperate && !noVenueAttendance) {
      throw new HttpError(400, 'Upload the signed paper photo before submitting');
    }

    const requiresCostReconciliation =
      Boolean(report.counter?.product?.requiresNightReportCostReconciliation) && !didNotOperate && !noVenueAttendance;
    if (requiresCostReconciliation) {
      const linkedCostCount = await FinanceTransaction.count({
        where: {
          kind: 'expense',
          nightReportId: reportId,
        },
      });
      const resolved = linkedCostCount > 0 || Boolean(report.noExtraCostConfirmed);
      if (!resolved) {
        throw new HttpError(
          400,
          'This product requires cost reconciliation before submission. Add/link a cost or confirm no extra cost.',
        );
      }
    }

    await NightReport.update(
      {
        status: 'submitted',
        submittedAt: new Date(),
        updatedBy: actorId,
      },
      { where: { id: reportId } },
    );

    const fresh = await getNightReportById(reportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    await reconcileNightReportTaskWaiversForReport(fresh, { mode: 'sync' });

    res.status(200).json([await serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to submit night report', error);
    res.status(500).json([{ message: 'Failed to submit night report' }]);
  }
};

export const confirmNightReportNoExtraCost = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to update cost reconciliation for this report');
    }

    await NightReport.update(
      {
        noExtraCostConfirmed: true,
        noExtraCostConfirmedBy: actorId,
        noExtraCostConfirmedAt: new Date(),
        updatedBy: actorId,
      },
      { where: { id: reportId } },
    );

    const fresh = await getNightReportById(reportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    res.status(200).json([await serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to confirm no extra cost for night report', error);
    res.status(500).json([{ message: 'Failed to confirm no extra cost for night report' }]);
  }
};

export const clearNightReportNoExtraCost = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to update cost reconciliation for this report');
    }

    await NightReport.update(
      {
        noExtraCostConfirmed: false,
        noExtraCostConfirmedBy: null,
        noExtraCostConfirmedAt: null,
        updatedBy: actorId,
      },
      { where: { id: reportId } },
    );

    const fresh = await getNightReportById(reportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    res.status(200).json([await serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to clear no extra cost confirmation for night report', error);
    res.status(500).json([{ message: 'Failed to clear no extra cost confirmation for night report' }]);
  }
};

export const deleteNightReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sequelize = NightReport.sequelize;
  if (!sequelize) {
    res.status(500).json([{ message: 'Database connection unavailable' }]);
    return;
  }

  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to delete this report');
    }

    await reconcileNightReportTaskWaiversForReport(report, { mode: 'restore' });

    await sequelize.transaction(async (transaction) => {
      const photos = await NightReportPhoto.findAll({ where: { reportId }, transaction });
      const costTransactions = await FinanceTransaction.findAll({
        where: {
          kind: 'expense',
          nightReportId: reportId,
        },
        transaction,
      });
      for (const photo of photos) {
        await removePhotoFromDisk(photo.storagePath).catch((error) => {
          logger.warn(`Failed to remove photo ${photo.id} from disk`, error);
        });
      }
      for (const costTransaction of costTransactions) {
        await FinanceTransaction.destroy({ where: { id: costTransaction.id }, transaction });
        await recordFinanceAuditLog({
          entity: 'finance_transaction',
          entityId: costTransaction.id,
          action: 'delete',
          performedBy: actorId,
        });
      }
      await NightReportPhoto.destroy({ where: { reportId }, transaction });
      await NightReportVenue.destroy({ where: { reportId }, transaction });
      await NightReport.destroy({ where: { id: reportId }, transaction });
    });

    res.status(204).send();
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to delete night report', error);
    res.status(500).json([{ message: 'Failed to delete night report' }]);
  }
};

export const getNightReportLeaderMetrics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    if (typeof startDate !== 'string' || !startDate) {
      res.status(400).json([{ message: 'startDate is required' }]);
      return;
    }

    const start = dayjs(startDate).startOf('day');
    const end = typeof endDate === 'string' && endDate ? dayjs(endDate).endOf('day') : start.endOf('day');
    if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
      res.status(400).json([{ message: 'Provide a valid date range' }]);
      return;
    }

    const minAttendanceValue = Math.max(Number(req.query.minAttendance ?? 0) || 0, 0);
    const minReportsValue = Math.max(Number(req.query.minReports ?? 0) || 0, 0);
    const retentionThresholdRaw = Number(req.query.retentionThreshold ?? 0);
    const retentionThresholdValue = Number.isFinite(retentionThresholdRaw)
      ? Math.min(Math.max(retentionThresholdRaw, 0), 1)
      : 0;

    const stats = await fetchLeaderNightReportStats(start, end);
    if (stats.size === 0) {
      res.status(200).json([
        {
          data: {
            range: { startDate: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') },
            thresholds: {
              minAttendance: minAttendanceValue,
              minReports: minReportsValue,
              retentionThreshold: retentionThresholdValue,
            },
            leaders: [],
            bestStaff: { userIds: [], retentionHits: 0 },
          },
          columns: [],
        },
      ]);
      return;
    }

    const userIds = Array.from(stats.keys());
    const users = await User.findAll({
      where: { id: { [Op.in]: userIds } },
      attributes: ['id', 'firstName', 'lastName'],
    });
    const nameMap = new Map<number, string>();
    users.forEach((user) => {
      const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
      nameMap.set(user.id, fullName.length > 0 ? fullName : `User #${user.id}`);
    });

    let bestRetentionHits = 0;
    const bestStaffIds = new Set<number>();

    const leaders = Array.from(stats.entries()).map(([userId, summary]) => {
      const totalReports = summary.reports.length;
      const totalPeople = summary.reports.reduce((sum, report) => sum + report.totalPeople, 0);
      const totalVenues = summary.reports.reduce((sum, report) => sum + report.venuesCount, 0);
      const totalRetention = summary.reports.reduce((sum, report) => sum + report.retentionRatio, 0);
      const totalOpenBarPayout = summary.reports.reduce((sum, report) => sum + (report.openBarPayout ?? 0), 0);
      const totalCommissionRevenue = summary.reports.reduce(
        (sum, report) => sum + (report.commissionRevenue ?? 0),
        0,
      );
      const netVenueValue = summary.reports.reduce((sum, report) => sum + (report.netVenueValue ?? 0), 0);
      const qualifiedReports = summary.reports.filter(
        (report) => report.totalPeople >= minAttendanceValue,
      );
      const retentionHits = qualifiedReports.filter(
        (report) => report.retentionRatio >= retentionThresholdValue,
      ).length;

      const meetsMinReports = qualifiedReports.length >= minReportsValue;
      if (meetsMinReports) {
        if (retentionHits > bestRetentionHits) {
          bestRetentionHits = retentionHits;
          bestStaffIds.clear();
          if (retentionHits > 0) {
            bestStaffIds.add(userId);
          }
        } else if (retentionHits === bestRetentionHits && retentionHits > 0) {
          bestStaffIds.add(userId);
        }
      }

      return {
        userId,
        leaderName: nameMap.get(userId) ?? `User #${userId}`,
        totalReports,
        totalPeople,
        totalVenues,
        averageAttendance: totalReports ? totalPeople / totalReports : 0,
        averageVenues: totalReports ? totalVenues / totalReports : 0,
        averageRetention: totalReports ? totalRetention / totalReports : 0,
        totalOpenBarPayout,
        totalCommissionRevenue,
        netVenueValue,
        averageNetVenueValue: totalReports ? netVenueValue / totalReports : 0,
        qualifiedReports: qualifiedReports.length,
        retentionHits,
        meetsMinimumReports: meetsMinReports,
        dailyReports: summary.reports.map((report) => ({
          ...report,
          meetsAttendance: report.totalPeople >= minAttendanceValue,
          meetsRetention:
            report.totalPeople >= minAttendanceValue && report.retentionRatio >= retentionThresholdValue,
        })),
      };
    });

    leaders.sort((a, b) => {
      if (b.retentionHits !== a.retentionHits) {
        return b.retentionHits - a.retentionHits;
      }
      return b.qualifiedReports - a.qualifiedReports;
    });

    res.status(200).json([
      {
        data: {
          range: { startDate: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') },
          thresholds: {
            minAttendance: minAttendanceValue,
            minReports: minReportsValue,
            retentionThreshold: retentionThresholdValue,
          },
          leaders,
          bestStaff: { userIds: Array.from(bestStaffIds), retentionHits: bestRetentionHits },
        },
        columns: [],
      },
    ]);
  } catch (error) {
    logger.error('Failed to calculate night report leader metrics', error);
    res.status(500).json([{ message: 'Failed to load leader metrics' }]);
  }
};

export const createVenueCompensationCollectionLog = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const venueId = Number(req.body.venueId);
    if (!Number.isInteger(venueId) || venueId <= 0) {
      throw new HttpError(400, 'A valid venueId is required.');
    }

    const directionInput = typeof req.body.direction === 'string' ? req.body.direction.toLowerCase() : '';
    const direction = directionInput === 'receivable' || directionInput === 'payable' ? directionInput : null;
    if (!direction) {
      throw new HttpError(400, 'Direction must be either "receivable" or "payable".');
    }

    const currency =
      typeof req.body.currency === 'string' && req.body.currency.trim().length > 0
        ? req.body.currency.trim().toUpperCase()
        : resolvePayoutCurrency();

    const amountMinor = parseAmountToMinor(req.body.amount);
    if (amountMinor <= 0) {
      throw new HttpError(400, 'Amount must be greater than zero.');
    }

    const rangeStartRaw = typeof req.body.rangeStart === 'string' ? req.body.rangeStart : '';
    const rangeEndRaw = typeof req.body.rangeEnd === 'string' ? req.body.rangeEnd : '';
    const rangeStart = dayjs(rangeStartRaw).startOf('day');
    const rangeEnd = dayjs(rangeEndRaw).endOf('day');
    if (!rangeStart.isValid() || !rangeEnd.isValid() || rangeEnd.isBefore(rangeStart)) {
      throw new HttpError(400, 'Provide a valid rangeStart and rangeEnd.');
    }

    const isCanonicalRange =
      rangeStart.isSame(rangeStart.startOf('month'), 'day') &&
      rangeEnd.isSame(rangeStart.endOf('month'), 'day') &&
      rangeStart.isSame(rangeEnd, 'month') &&
      rangeStart.year() === rangeEnd.year();
    if (!isCanonicalRange) {
      throw new HttpError(400, 'Collections can only be recorded for full calendar months.');
    }

    const financeTransactionIdRaw =
      req.body.financeTransactionId !== undefined ? Number(req.body.financeTransactionId) : null;
    let financeTransactionId: number | null = null;
    if (financeTransactionIdRaw !== null && financeTransactionIdRaw !== 0) {
      if (!Number.isInteger(financeTransactionIdRaw) || financeTransactionIdRaw <= 0) {
        throw new HttpError(400, 'financeTransactionId must be a positive integer.');
      }
      const transactionExists = await FinanceTransaction.count({ where: { id: financeTransactionIdRaw } });
      if (!transactionExists) {
        throw new HttpError(400, 'Finance transaction not found.');
      }
      financeTransactionId = financeTransactionIdRaw;
    }

    const venueRecord = await Venue.findByPk(venueId, {
      attributes: ['id', 'financeVendorId', 'financeClientId'],
    });
    if (!venueRecord) {
      throw new HttpError(404, 'Venue not found.');
    }
    if (direction === 'receivable' && !venueRecord.financeClientId) {
      throw new HttpError(400, 'This venue is not linked to a finance client.');
    }
    if (direction === 'payable' && !venueRecord.financeVendorId) {
      throw new HttpError(400, 'This venue is not linked to a finance vendor.');
    }

    const note =
      typeof req.body.note === 'string' && req.body.note.trim().length > 0 ? req.body.note.trim() : null;

    const record = await VenueCompensationCollectionLog.create({
      venueId,
      direction,
      currencyCode: currency,
      amountMinor,
      rangeStart: rangeStart.format('YYYY-MM-DD'),
      rangeEnd: rangeEnd.format('YYYY-MM-DD'),
      financeTransactionId,
      note,
      createdBy: actorId,
    });

    res.status(201).json([record]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to record venue compensation collection', error);
    res.status(500).json([{ message: 'Failed to record collection' }]);
  }
};

export const deleteVenueCompensationCollectionLog = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const collectionLogId = Number(req.params.id);
    if (!Number.isInteger(collectionLogId) || collectionLogId <= 0) {
      throw new HttpError(400, 'Provide a valid collection log id.');
    }

    const collectionLog = await VenueCompensationCollectionLog.findByPk(collectionLogId);
    if (!collectionLog) {
      throw new HttpError(404, 'Collection log not found.');
    }

    if (collectionLog.financeTransactionId) {
      const transaction = await FinanceTransaction.findByPk(collectionLog.financeTransactionId);
      if (transaction) {
        await deleteFinanceTransactionAndCleanupInvoice(transaction);
        await recordFinanceAuditLog({
          entity: 'finance_transaction',
          entityId: transaction.id,
          action: 'delete',
          performedBy: actorId,
        });
      }
    }

    await collectionLog.destroy();
    res.status(204).send();
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to delete venue compensation collection', error);
    res.status(500).json([{ message: 'Failed to delete collection' }]);
  }
};

export const getNightReportVenueSummary = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const periodParam = typeof req.query.period === 'string' ? req.query.period : undefined;
    const startDateParam = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDateParam = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;

    const { period, start, end } = await resolveVenueSummaryRange(periodParam, startDateParam, endDateParam);
    const isCanonicalRange =
      start.isSame(start.startOf('month'), 'day') &&
      end.isSame(start.endOf('month'), 'day') &&
      start.isSame(end, 'month') &&
      start.year() === end.year();
    const startIso = start.format('YYYY-MM-DD');
    const endIso = end.format('YYYY-MM-DD');
    const ledgerEligible = isCanonicalRange && !start.isBefore(resolveVenueLedgerStartDate(), 'day');

    const detailRows = (await NightReportVenue.findAll({
      attributes: [
        'venueId',
        'venueName',
        'currencyCode',
        'direction',
        'payoutAmount',
        'totalPeople',
        'normalCount',
        'cocktailsCount',
        'brunchCount',
        [col('report.activity_date'), 'activityDate'],
        [col('report.id'), 'reportId'],
        [col('nightReportVenueVenue.allows_open_bar'), 'allowsOpenBar'],
      ],
      include: [
        {
          model: NightReport,
          as: 'report',
          attributes: [],
          required: true,
          where: {
            status: 'submitted',
            activityDate: {
              [Op.between]: [startIso, endIso],
            },
          },
        },
        {
          model: Venue,
          as: 'nightReportVenueVenue',
          attributes: ['allowsOpenBar'],
          required: false,
        },
      ],
      raw: true,
    })) as unknown as VenueDetailAggregate[];

    const collectionRows = (await VenueCompensationCollectionLog.findAll({
      attributes: [
        'id',
        'venueId',
        'currencyCode',
        'direction',
        'amountMinor',
        'financeTransactionId',
        'createdAt',
      ],
      where: {
        rangeStart: startIso,
        rangeEnd: endIso,
      },
      order: [
        ['venue_id', 'ASC'],
        ['currency_code', 'ASC'],
        ['direction', 'ASC'],
        ['created_at', 'ASC'],
        ['id', 'ASC'],
      ],
      raw: true,
    })) as unknown as CollectionLogAggregate[];

    const collectionMap = new Map<string, { receivable: number; payable: number }>();
    const currencyCollectionMap = new Map<string, { receivable: number; payable: number }>();
    const latestCollectionMap = new Map<
      string,
      {
        receivable: { logId: number | null; financeTransactionId: number | null };
        payable: { logId: number | null; financeTransactionId: number | null };
      }
    >();
    const previousLedgerMap = new Map<string, VenueCompensationLedger>();
    const ledgerUpsertMap = new Map<
      string,
      {
        venueId: number;
        direction: 'receivable' | 'payable';
        currencyCode: string;
        rangeStart: string;
        rangeEnd: string;
        openingBalanceMinor: number;
        dueAmountMinor: number;
        paidAmountMinor: number;
        closingBalanceMinor: number;
      }
    >();
    const currencyLedgerTotals = new Map<
      string,
      { receivable: LedgerSnapshot; payable: LedgerSnapshot }
    >();
    const ensureCurrencyLedgerTotals = (currency: string) => {
      if (!currencyLedgerTotals.has(currency)) {
        currencyLedgerTotals.set(currency, {
          receivable: { opening: 0, due: 0, paid: 0, closing: 0 },
          payable: { opening: 0, due: 0, paid: 0, closing: 0 },
        });
      }
      return currencyLedgerTotals.get(currency)!;
    };

    collectionRows.forEach((row) => {
      const venueKey = `${row.venueId ?? 'null'}|${(row.currencyCode ?? 'USD').toUpperCase()}`;
      const majorAmount = roundCurrencyValue(Number(row.amountMinor ?? 0) / 100);
      if (majorAmount === 0) {
        return;
      }
      const venueTotals = collectionMap.get(venueKey) ?? { receivable: 0, payable: 0 };
      venueTotals[row.direction] += majorAmount;
      collectionMap.set(venueKey, venueTotals);

      const latestForVenue = latestCollectionMap.get(venueKey) ?? {
        receivable: { logId: null, financeTransactionId: null },
        payable: { logId: null, financeTransactionId: null },
      };
      const currentLogId = Number(row.id ?? 0);
      const latestDirection = latestForVenue[row.direction];
      if (latestDirection.logId === null || currentLogId > latestDirection.logId) {
        latestForVenue[row.direction] = {
          logId: currentLogId,
          financeTransactionId:
            row.financeTransactionId == null ? null : Number(row.financeTransactionId),
        };
      }
      latestCollectionMap.set(venueKey, latestForVenue);

      const currencyKey = (row.currencyCode ?? 'USD').toUpperCase();
      const currencyTotals = currencyCollectionMap.get(currencyKey) ?? { receivable: 0, payable: 0 };
      currencyTotals[row.direction] += majorAmount;
      currencyCollectionMap.set(currencyKey, currencyTotals);
    });

    const venueMap = new Map<
      string,
      {
        venueId: number | null;
        venueName: string;
        currency: string;
        allowsOpenBar: boolean;
        receivable: number;
        payable: number;
        totalPeopleReceivable: number;
        totalPeoplePayable: number;
        daily: Array<{
          date: string;
          reportId: number | null;
          totalPeople: number;
          amount: number;
          direction: 'receivable' | 'payable';
          normalCount: number;
          cocktailsCount: number;
          brunchCount: number;
        }>;
        latestReceivableCollectionLogId: number | null;
        latestReceivableFinanceTransactionId: number | null;
        latestPayableCollectionLogId: number | null;
        latestPayableFinanceTransactionId: number | null;
      }
    >();
    const totalsMap = new Map<string, { receivable: number; payable: number }>();

    detailRows.forEach((row) => {
      const currency = (row.currencyCode ?? 'USD').toUpperCase();
      const direction = row.direction === 'receivable' ? 'receivable' : 'payable';
      const numericAmount = Number(row.payoutAmount ?? 0);
      const amount = Number.isFinite(numericAmount) ? numericAmount : 0;
      const numericPeople = Number(row.totalPeople ?? 0);
      const totalPeople = Number.isFinite(numericPeople) ? numericPeople : 0;
      const normalCountRaw = Number(row.normalCount ?? 0);
      const normalCount = Number.isFinite(normalCountRaw) ? normalCountRaw : 0;
      const cocktailsCountRaw = Number(row.cocktailsCount ?? 0);
      const cocktailsCount = Number.isFinite(cocktailsCountRaw) ? cocktailsCountRaw : 0;
      const brunchCountRaw = Number(row.brunchCount ?? 0);
      const brunchCount = Number.isFinite(brunchCountRaw) ? brunchCountRaw : 0;
      const activityDate = row.activityDate ? dayjs(row.activityDate).format('YYYY-MM-DD') : '';
      const reportId = typeof row.reportId === 'number' ? row.reportId : null;
      const venueId = row.venueId ?? null;
      const defaultName = venueId != null ? `Venue #${venueId}` : 'Unspecified Venue';
      const venueName = (row.venueName ?? '').trim() || defaultName;
      const allowsOpenBar = row.allowsOpenBar === true;
      const key = `${venueId ?? 'null'}|${venueName}|${currency}`;

      if (!venueMap.has(key)) {
        venueMap.set(key, {
          venueId,
          venueName,
          currency,
          allowsOpenBar,
          receivable: 0,
          payable: 0,
          totalPeopleReceivable: 0,
          totalPeoplePayable: 0,
          daily: [],
          latestReceivableCollectionLogId: null,
          latestReceivableFinanceTransactionId: null,
          latestPayableCollectionLogId: null,
          latestPayableFinanceTransactionId: null,
        });
      }

      const existing = venueMap.get(key)!;
      existing[direction] += amount;
      if (direction === 'receivable') {
        existing.totalPeopleReceivable += totalPeople;
      } else {
        existing.totalPeoplePayable += totalPeople;
      }
      if (allowsOpenBar) {
        existing.allowsOpenBar = true;
      }
      existing.daily.push({
        date: activityDate,
        reportId,
        totalPeople,
        amount: roundCurrencyValue(amount),
        direction,
        normalCount,
        cocktailsCount,
        brunchCount,
      });

      if (!totalsMap.has(currency)) {
        totalsMap.set(currency, { receivable: 0, payable: 0 });
      }
      totalsMap.get(currency)![direction] += amount;
    });

    if (ledgerEligible) {
      const canonicalEntries = Array.from(venueMap.values()).filter((entry) => entry.venueId !== null);
      if (canonicalEntries.length > 0) {
        const venueIds = Array.from(new Set(canonicalEntries.map((entry) => entry.venueId))) as number[];
        const previousLedgers = await VenueCompensationLedger.findAll({
          where: {
            venueId: {
              [Op.in]: venueIds,
            },
            rangeEnd: {
              [Op.lt]: startIso,
            },
            rangeStart: {
              [Op.gte]: resolveVenueLedgerStartDate().format('YYYY-MM-DD'),
            },
          },
          order: [
            ['venue_id', 'ASC'],
            ['currency_code', 'ASC'],
            ['direction', 'ASC'],
            ['range_end', 'DESC'],
          ],
        });

        previousLedgers.forEach((ledger) => {
          const key = `${ledger.venueId}|${ledger.currencyCode}|${ledger.direction}`;
          if (!previousLedgerMap.has(key)) {
            previousLedgerMap.set(key, ledger);
          }
        });
      }
    }

    venueMap.forEach((entry) => {
      entry.daily.sort((a, b) => a.date.localeCompare(b.date));
    });

    const buildLedgerSnapshot = (
      venueId: number | null,
      currency: string,
      direction: 'receivable' | 'payable',
      dueValue: number,
      paidValue: number,
      options?: { skipLedger?: boolean },
    ): LedgerSnapshot => {
      const due = roundCurrencyValue(Math.max(dueValue, 0));
      const paid = roundCurrencyValue(Math.max(paidValue, 0));

      if (!ledgerEligible || !venueId || options?.skipLedger) {
        return {
          opening: 0,
          due,
          paid,
          closing: roundCurrencyValue(due - paid),
        };
      }

      let opening = 0;
      const previous = previousLedgerMap.get(`${venueId}|${currency}|${direction}`);
      if (previous) {
        opening = convertMinorUnitsToMajor(previous.closingBalanceMinor);
      }
      const closing = roundCurrencyValue(opening + due - paid);

      const upsertKey = `${venueId}|${currency}|${direction}`;
      ledgerUpsertMap.set(upsertKey, {
        venueId,
        direction,
        currencyCode: currency,
        rangeStart: startIso,
        rangeEnd: endIso,
        openingBalanceMinor: convertMajorUnitsToMinor(opening),
        dueAmountMinor: convertMajorUnitsToMinor(due),
        paidAmountMinor: convertMajorUnitsToMinor(paid),
        closingBalanceMinor: convertMajorUnitsToMinor(closing),
      });

      return { opening, due, paid, closing };
    };

    const venues = Array.from(venueMap.values()).map((entry) => {
      const key = `${entry.venueId ?? 'null'}|${entry.currency}`;
      const collected = collectionMap.get(key) ?? { receivable: 0, payable: 0 };
      const latestCollection = latestCollectionMap.get(key) ?? {
        receivable: { logId: null, financeTransactionId: null },
        payable: { logId: null, financeTransactionId: null },
      };
      const receivable = roundCurrencyValue(entry.receivable);
      const payable = roundCurrencyValue(entry.payable);
      const receivableCollected = roundCurrencyValue(collected.receivable);
      const payableCollected = roundCurrencyValue(collected.payable);

      const receivableLedger = buildLedgerSnapshot(
        entry.venueId,
        entry.currency,
        'receivable',
        receivable,
        receivableCollected,
      );
      const payableLedger = buildLedgerSnapshot(
        entry.venueId,
        entry.currency,
        'payable',
        payable,
        payableCollected,
        { skipLedger: entry.allowsOpenBar !== true },
      );
      const currencyLedgers = ensureCurrencyLedgerTotals(entry.currency);
      currencyLedgers.receivable.opening += receivableLedger.opening;
      currencyLedgers.receivable.due += receivableLedger.due;
      currencyLedgers.receivable.paid += receivableLedger.paid;
      currencyLedgers.receivable.closing += receivableLedger.closing;
      currencyLedgers.payable.opening += payableLedger.opening;
      currencyLedgers.payable.due += payableLedger.due;
      currencyLedgers.payable.paid += payableLedger.paid;
      currencyLedgers.payable.closing += payableLedger.closing;

      return {
        venueId: entry.venueId,
        venueName: entry.venueName,
        currency: entry.currency,
        allowsOpenBar: entry.allowsOpenBar,
        receivable,
        receivableCollected,
        receivableOutstanding: roundCurrencyValue(Math.max(receivable - receivableCollected, 0)),
        payable,
        payableCollected,
        payableOutstanding: roundCurrencyValue(Math.max(payable - payableCollected, 0)),
        net: roundCurrencyValue(receivable - payable),
        totalPeople: entry.totalPeopleReceivable + entry.totalPeoplePayable,
        totalPeopleReceivable: entry.totalPeopleReceivable,
        totalPeoplePayable: entry.totalPeoplePayable,
        daily: entry.daily,
        rowKey: key,
        receivableLedger,
        payableLedger,
        latestReceivableCollectionLogId: latestCollection.receivable.logId,
        latestReceivableFinanceTransactionId: latestCollection.receivable.financeTransactionId,
        latestPayableCollectionLogId: latestCollection.payable.logId,
        latestPayableFinanceTransactionId: latestCollection.payable.financeTransactionId,
      };
    });

    venues.sort((a, b) => b.net - a.net);

    const totalsByCurrency = Array.from(totalsMap.entries()).map(([currency, sums]) => {
      const collected = currencyCollectionMap.get(currency) ?? { receivable: 0, payable: 0 };
      const receivable = roundCurrencyValue(sums.receivable);
      const payable = roundCurrencyValue(sums.payable);
      const receivableCollected = roundCurrencyValue(collected.receivable);
      const payableCollected = roundCurrencyValue(collected.payable);
      const ledgerTotals =
        currencyLedgerTotals.get(currency) ?? {
          receivable: {
            opening: 0,
            due: receivable,
            paid: receivableCollected,
            closing: roundCurrencyValue(receivable - receivableCollected),
          },
          payable: {
            opening: 0,
            due: payable,
            paid: payableCollected,
            closing: roundCurrencyValue(payable - payableCollected),
          },
        };
      return {
        currency,
        receivable,
        receivableCollected,
        receivableOutstanding: roundCurrencyValue(Math.max(receivable - receivableCollected, 0)),
        payable,
        payableCollected,
        payableOutstanding: roundCurrencyValue(Math.max(payable - payableCollected, 0)),
        net: roundCurrencyValue(sums.receivable - sums.payable),
        receivableLedger: {
          opening: roundCurrencyValue(ledgerTotals.receivable.opening),
          due: roundCurrencyValue(ledgerTotals.receivable.due),
          paid: roundCurrencyValue(ledgerTotals.receivable.paid),
          closing: roundCurrencyValue(ledgerTotals.receivable.closing),
        },
        payableLedger: {
          opening: roundCurrencyValue(ledgerTotals.payable.opening),
          due: roundCurrencyValue(ledgerTotals.payable.due),
          paid: roundCurrencyValue(ledgerTotals.payable.paid),
          closing: roundCurrencyValue(ledgerTotals.payable.closing),
        },
      };
    });

    if (ledgerEligible && ledgerUpsertMap.size > 0) {
      await Promise.all(
        Array.from(ledgerUpsertMap.values()).map(async (payload) => {
          try {
            await VenueCompensationLedger.upsert(payload, {
              conflictFields: ["venue_id", "direction", "currency_code", "range_start", "range_end"],
            });
          } catch (error: any) {
            const pgCode: string | undefined = error?.parent?.code ?? error?.original?.code;
            if (pgCode !== '42P10') {
              throw error;
            }
            const existing = await VenueCompensationLedger.findOne({
              where: {
                venueId: payload.venueId,
                direction: payload.direction,
                currencyCode: payload.currencyCode,
                rangeStart: payload.rangeStart,
                rangeEnd: payload.rangeEnd,
              },
            });
            if (existing) {
              await existing.update(payload);
            } else {
              await VenueCompensationLedger.create(payload);
            }
          }
        }),
      );
    }

    res.status(200).json([
      {
        data: {
          period,
          range: { startDate: startIso, endDate: endIso },
          totalsByCurrency,
          venues,
          rangeIsCanonical: isCanonicalRange,
        },
        columns: [],
      },
    ]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to generate venue payout summary', error);
    res.status(500).json([{ message: 'Failed to load venue payout summary' }]);
  }
};

function parseNightReportCostPayload(body: Record<string, unknown>): NightReportCostPayload {
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  if (!date || !dayjs(date).isValid()) {
    throw new HttpError(400, 'Provide a valid cost date');
  }

  const accountId = Number(body.accountId);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw new HttpError(400, 'Select a valid account');
  }

  const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
  if (!currency || currency.length !== 3) {
    throw new HttpError(400, 'Provide a valid currency');
  }

  const amountMinor = Number(body.amountMinor);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw new HttpError(400, 'Provide a valid positive amount');
  }

  const categoryIdRaw = body.categoryId == null ? null : Number(body.categoryId);
  if (categoryIdRaw != null && (!Number.isInteger(categoryIdRaw) || categoryIdRaw <= 0)) {
    throw new HttpError(400, 'Select a valid category');
  }

  const counterpartyId = Number(body.counterpartyId);
  if (!Number.isInteger(counterpartyId) || counterpartyId <= 0) {
    throw new HttpError(400, 'Select a valid vendor');
  }

  const paymentMethod =
    typeof body.paymentMethod === 'string' && body.paymentMethod.trim().length > 0
      ? body.paymentMethod.trim()
      : null;

  const allowedStatuses = new Set(['planned', 'approved', 'awaiting_reimbursement', 'paid', 'reimbursed', 'void']);
  const statusRaw = typeof body.status === 'string' ? body.status.trim() : '';
  const status = allowedStatuses.has(statusRaw) ? (statusRaw as NightReportCostPayload['status']) : 'paid';

  const description =
    typeof body.description === 'string' && body.description.trim().length > 0
      ? body.description.trim()
      : null;

  const invoiceFileIdRaw = body.invoiceFileId == null ? null : Number(body.invoiceFileId);
  if (invoiceFileIdRaw != null && (!Number.isInteger(invoiceFileIdRaw) || invoiceFileIdRaw <= 0)) {
    throw new HttpError(400, 'Invalid attached file');
  }

  return {
    date,
    accountId,
    currency,
    amountMinor: Math.round(amountMinor),
    categoryId: categoryIdRaw,
    counterpartyId,
    paymentMethod,
    status,
    description,
    invoiceFileId: invoiceFileIdRaw,
  };
}

function parseNightReportReceiptAllocationPayload(body: Record<string, unknown>): NightReportReceiptAllocationPayload {
  const receiptTotalMinor = Number(body.receiptTotalMinor);
  const base = parseNightReportCostPayload({
    ...body,
    amountMinor: receiptTotalMinor,
  });

  if (!Number.isFinite(receiptTotalMinor) || receiptTotalMinor <= 0) {
    throw new HttpError(400, 'Provide a valid positive receipt total');
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new HttpError(400, 'Add at least one allocation line');
  }

  const lines = body.lines.map((rawLine, index) => {
    const line = (rawLine ?? {}) as Record<string, unknown>;
    const reportId = Number(line.reportId);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, `Select a valid target night report for allocation line ${index + 1}`);
    }

    const amountMinor = Number(line.amountMinor);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      throw new HttpError(400, `Provide a valid positive amount for allocation line ${index + 1}`);
    }

    const receiptItems = Array.isArray(line.receiptItems)
      ? line.receiptItems.map((rawItem, itemIndex) => {
          const item = (rawItem ?? {}) as Record<string, unknown>;
          const quantity = Number(item.quantity ?? 1);
          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new HttpError(400, `Provide a valid positive quantity for item ${itemIndex + 1} in allocation line ${index + 1}`);
          }
          const itemAmountMinor = Number(item.amountMinor);
          if (!Number.isFinite(itemAmountMinor) || itemAmountMinor <= 0) {
            throw new HttpError(400, `Provide a valid positive amount for item ${itemIndex + 1} in allocation line ${index + 1}`);
          }
          const description =
            typeof item.description === 'string' && item.description.trim().length > 0
              ? item.description.trim()
              : null;
          return {
            description,
            quantity: Math.round(quantity),
            amountMinor: Math.round(itemAmountMinor),
          };
        })
      : [];

    if (receiptItems.length > 0) {
      const itemTotal = receiptItems.reduce((sum, item) => sum + item.amountMinor * item.quantity, 0);
      if (Math.round(amountMinor) !== itemTotal) {
        throw new HttpError(400, `Allocation line ${index + 1} amount must match the sum of its items`);
      }
    }

    const receiptAllocationNote =
      typeof line.receiptAllocationNote === 'string' && line.receiptAllocationNote.trim().length > 0
        ? line.receiptAllocationNote.trim()
        : null;

    return {
      reportId,
      amountMinor: Math.round(amountMinor),
      receiptAllocationNote,
      receiptItems,
    };
  });

  const allocatedTotal = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  if (allocatedTotal > Math.round(receiptTotalMinor)) {
    throw new HttpError(400, 'Allocated total cannot exceed the receipt total');
  }

  return {
    ...base,
    receiptTotalMinor: Math.round(receiptTotalMinor),
    lines,
  };
}

export const createNightReportCost = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to add costs to this report');
    }

    const payload = parseNightReportCostPayload((req.body ?? {}) as Record<string, unknown>);

    if (payload.categoryId) {
      const category = await FinanceCategory.findByPk(payload.categoryId);
      if (!category || category.kind !== 'expense') {
        throw new HttpError(400, 'Selected category must be an expense category');
      }
    }

    if (payload.invoiceFileId) {
      const fileExists = await FinanceFile.count({ where: { id: payload.invoiceFileId } });
      if (!fileExists) {
        throw new HttpError(400, 'Attached file was not found');
      }
    }

    await createFinanceTransaction(
      {
        kind: 'expense',
        date: payload.date,
        accountId: payload.accountId,
        currency: payload.currency,
        amountMinor: payload.amountMinor,
        categoryId: payload.categoryId,
        counterpartyType: 'vendor',
        counterpartyId: payload.counterpartyId,
        paymentMethod: payload.paymentMethod ?? null,
        status: payload.status ?? 'paid',
        description: payload.description ?? null,
        invoiceFileId: payload.invoiceFileId ?? null,
        nightReportId: reportId,
        productId: report.counter?.productId ?? null,
        serviceDate: report.activityDate,
        meta: {
          source: 'night-report-cost',
        },
      },
      actorId,
    );

    await NightReport.update(
      {
        noExtraCostConfirmed: false,
        noExtraCostConfirmedBy: null,
        noExtraCostConfirmedAt: null,
        updatedBy: actorId,
      },
      { where: { id: reportId } },
    );

    const fresh = await getNightReportById(reportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    res.status(201).json([await serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to create night report cost', error);
    res.status(500).json([{ message: 'Failed to create night report cost' }]);
  }
};

export const createNightReportReceiptAllocations = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const anchorReportId = Number(req.params.id);
    if (!Number.isInteger(anchorReportId) || anchorReportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const anchorReport = await getNightReportById(anchorReportId);
    if (!anchorReport) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(anchorReport, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to add costs to this report');
    }

    const payload = parseNightReportReceiptAllocationPayload((req.body ?? {}) as Record<string, unknown>);

    if (payload.categoryId) {
      const category = await FinanceCategory.findByPk(payload.categoryId);
      if (!category || category.kind !== 'expense') {
        throw new HttpError(400, 'Selected category must be an expense category');
      }
    }

    if (payload.invoiceFileId) {
      const fileExists = await FinanceFile.count({ where: { id: payload.invoiceFileId } });
      if (!fileExists) {
        throw new HttpError(400, 'Attached file was not found');
      }
    }

    const uniqueReportIds = [...new Set(payload.lines.map((line) => line.reportId))];
    const targetReports = await Promise.all(uniqueReportIds.map((reportId) => getNightReportById(reportId)));
    const reportMap = new Map<number, NightReport>();

    uniqueReportIds.forEach((reportId, index) => {
      const report = targetReports[index];
      if (!report) {
        throw new HttpError(400, `Target night report #${reportId} was not found`);
      }
      if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
        throw new HttpError(403, `You do not have permission to allocate costs to night report #${reportId}`);
      }
      reportMap.set(reportId, report);
    });

    const receiptGroupKey = crypto.randomUUID();

    await sequelize.transaction(async (transaction) => {
      for (const [index, line] of payload.lines.entries()) {
        const targetReport = reportMap.get(line.reportId);
        if (!targetReport) {
          throw new HttpError(400, `Target night report #${line.reportId} was not found`);
        }

        await createFinanceTransaction(
          {
            kind: 'expense',
            date: payload.date,
            accountId: payload.accountId,
            currency: payload.currency,
            amountMinor: line.amountMinor,
            categoryId: payload.categoryId,
            counterpartyType: 'vendor',
            counterpartyId: payload.counterpartyId,
            paymentMethod: payload.paymentMethod ?? null,
            status: payload.status ?? 'paid',
            description: payload.description ?? null,
            invoiceFileId: payload.invoiceFileId ?? null,
            nightReportId: targetReport.id,
            productId: targetReport.counter?.productId ?? null,
            serviceDate: targetReport.activityDate,
            receiptGroupKey,
            receiptTotalMinor: payload.receiptTotalMinor,
            receiptCurrency: payload.currency,
            receiptAllocationNote: line.receiptAllocationNote ?? null,
            receiptLineOrder: index + 1,
            meta: {
              source: 'night-report-cost',
              allocation_mode: 'receipt_split',
              receipt_items: line.receiptItems ?? [],
              receipt_allocation_note: line.receiptAllocationNote ?? null,
            },
          },
          actorId,
          { transaction },
        );
      }

      await NightReport.update(
        {
          noExtraCostConfirmed: false,
          noExtraCostConfirmedBy: null,
          noExtraCostConfirmedAt: null,
          updatedBy: actorId,
        },
        {
          where: {
            id: {
              [Op.in]: uniqueReportIds,
            },
          },
          transaction,
        },
      );
    });

    const fresh = await getNightReportById(anchorReportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    res.status(201).json([await serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to create night report receipt allocations', error);
    res.status(500).json([{ message: 'Failed to create night report receipt allocations' }]);
  }
};

export const updateNightReportReceiptAllocations = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const anchorReportId = Number(req.params.id);
    if (!Number.isInteger(anchorReportId) || anchorReportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const receiptGroupKey =
      typeof req.params.receiptGroupKey === 'string' ? req.params.receiptGroupKey.trim() : '';
    if (!receiptGroupKey) {
      throw new HttpError(400, 'Invalid receipt group key');
    }

    const anchorReport = await getNightReportById(anchorReportId);
    if (!anchorReport) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(anchorReport, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to edit this shared receipt');
    }

    const existingRows = await FinanceTransaction.findAll({
      where: {
        kind: 'expense',
        receiptGroupKey,
      },
      order: [
        ['receiptLineOrder', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    if (existingRows.length === 0) {
      throw new HttpError(404, 'Shared receipt not found');
    }

    const payload = parseNightReportReceiptAllocationPayload((req.body ?? {}) as Record<string, unknown>);

    if (payload.categoryId) {
      const category = await FinanceCategory.findByPk(payload.categoryId);
      if (!category || category.kind !== 'expense') {
        throw new HttpError(400, 'Selected category must be an expense category');
      }
    }

    if (payload.invoiceFileId) {
      const fileExists = await FinanceFile.count({ where: { id: payload.invoiceFileId } });
      if (!fileExists) {
        throw new HttpError(400, 'Attached file was not found');
      }
    }

    const uniqueReportIds = [...new Set(payload.lines.map((line) => line.reportId))];
    const targetReports = await Promise.all(uniqueReportIds.map((reportId) => getNightReportById(reportId)));
    const reportMap = new Map<number, NightReport>();

    uniqueReportIds.forEach((reportId, index) => {
      const report = targetReports[index];
      if (!report) {
        throw new HttpError(400, `Target night report #${reportId} was not found`);
      }
      if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
        throw new HttpError(403, `You do not have permission to allocate costs to night report #${reportId}`);
      }
      reportMap.set(reportId, report);
    });

    const oldInvoiceIds = Array.from(
      new Set(
        existingRows
          .map((row) => row.invoiceFileId)
          .filter((invoiceFileId): invoiceFileId is number => typeof invoiceFileId === 'number' && invoiceFileId > 0),
      ),
    );
    const oldReportIds = Array.from(
      new Set(
        existingRows
          .map((row) => row.nightReportId)
          .filter((reportId): reportId is number => typeof reportId === 'number' && reportId > 0),
      ),
    );

    await sequelize.transaction(async (transaction) => {
      const remainingExisting = [...existingRows];
      const existingByReportId = new Map<number, FinanceTransaction>();
      remainingExisting.forEach((row) => {
        if (
          row.nightReportId != null &&
          Number.isInteger(row.nightReportId) &&
          row.nightReportId > 0 &&
          !existingByReportId.has(row.nightReportId)
        ) {
          existingByReportId.set(row.nightReportId, row);
        }
      });

      const retainedIds = new Set<number>();

      for (const [index, line] of payload.lines.entries()) {
        const targetReport = reportMap.get(line.reportId);
        if (!targetReport) {
          throw new HttpError(400, `Target night report #${line.reportId} was not found`);
        }

        let targetRow = existingByReportId.get(line.reportId) ?? null;
        if (targetRow) {
          existingByReportId.delete(line.reportId);
        } else {
          targetRow = remainingExisting.find((row) => !retainedIds.has(row.id)) ?? null;
        }

        if (targetRow) {
          retainedIds.add(targetRow.id);
          await updateFinanceTransaction(
            targetRow.id,
            {
              date: payload.date,
              accountId: payload.accountId,
              currency: payload.currency,
              amountMinor: line.amountMinor,
              categoryId: payload.categoryId,
              counterpartyType: 'vendor',
              counterpartyId: payload.counterpartyId,
              paymentMethod: payload.paymentMethod ?? null,
              status: payload.status ?? 'paid',
              description: payload.description ?? null,
              invoiceFileId: payload.invoiceFileId ?? null,
              nightReportId: targetReport.id,
              productId: targetReport.counter?.productId ?? null,
              serviceDate: targetReport.activityDate,
              receiptGroupKey,
              receiptTotalMinor: payload.receiptTotalMinor,
              receiptCurrency: payload.currency,
              receiptAllocationNote: line.receiptAllocationNote ?? null,
              receiptLineOrder: index + 1,
              meta: {
                source: 'night-report-cost',
                allocation_mode: 'receipt_split',
                receipt_items: line.receiptItems ?? [],
                receipt_allocation_note: line.receiptAllocationNote ?? null,
              },
            },
            actorId,
            { transaction },
          );
          continue;
        }

        const created = await createFinanceTransaction(
          {
            kind: 'expense',
            date: payload.date,
            accountId: payload.accountId,
            currency: payload.currency,
            amountMinor: line.amountMinor,
            categoryId: payload.categoryId,
            counterpartyType: 'vendor',
            counterpartyId: payload.counterpartyId,
            paymentMethod: payload.paymentMethod ?? null,
            status: payload.status ?? 'paid',
            description: payload.description ?? null,
            invoiceFileId: payload.invoiceFileId ?? null,
            nightReportId: targetReport.id,
            productId: targetReport.counter?.productId ?? null,
            serviceDate: targetReport.activityDate,
            receiptGroupKey,
            receiptTotalMinor: payload.receiptTotalMinor,
            receiptCurrency: payload.currency,
            receiptAllocationNote: line.receiptAllocationNote ?? null,
            receiptLineOrder: index + 1,
            meta: {
              source: 'night-report-cost',
              allocation_mode: 'receipt_split',
              receipt_items: line.receiptItems ?? [],
              receipt_allocation_note: line.receiptAllocationNote ?? null,
            },
          },
          actorId,
          { transaction },
        );
        retainedIds.add(created.id);
      }

      const staleIds = existingRows.filter((row) => !retainedIds.has(row.id)).map((row) => row.id);
      if (staleIds.length > 0) {
        await FinanceTransaction.destroy({
          where: {
            id: {
              [Op.in]: staleIds,
            },
          },
          transaction,
        });
      }

      const affectedReportIds = Array.from(new Set([...oldReportIds, ...uniqueReportIds]));
      if (affectedReportIds.length > 0) {
        await NightReport.update(
          {
            noExtraCostConfirmed: false,
            noExtraCostConfirmedBy: null,
            noExtraCostConfirmedAt: null,
            updatedBy: actorId,
          },
          {
            where: {
              id: {
                [Op.in]: affectedReportIds,
              },
            },
            transaction,
          },
        );
      }
    });

    await Promise.all(oldInvoiceIds.map((invoiceFileId) => cleanupInvoiceFileIfOrphan(invoiceFileId)));

    const fresh = await getNightReportById(anchorReportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    res.status(200).json([await serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to update night report receipt allocations', error);
    res.status(500).json([{ message: 'Failed to update night report receipt allocations' }]);
  }
};

export const getNightReportAvailableCosts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to view available costs for this report');
    }

    const rows = await listLinkableNightReportCosts(report);
    res.status(200).json(rows.map((row) => serializeNightReportCost(row)));
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to list available night report costs', error);
    res.status(500).json([{ message: 'Failed to list available night report costs' }]);
  }
};

export const getNightReportReceiptGroupCosts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    const receiptGroupKey =
      typeof req.params.receiptGroupKey === 'string' ? req.params.receiptGroupKey.trim() : '';

    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }
    if (!receiptGroupKey) {
      throw new HttpError(400, 'Invalid receipt group key');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to view this shared receipt');
    }

    const rows = await listNightReportReceiptGroupCosts(receiptGroupKey);
    if (rows.length === 0) {
      res.status(404).json([{ message: 'Shared receipt not found' }]);
      return;
    }

    res.status(200).json(rows.map((row) => serializeNightReportCost(row)));
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to load shared receipt group', error);
    res.status(500).json([{ message: 'Failed to load shared receipt group' }]);
  }
};

export const linkNightReportCost = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    const transactionId = Number(req.params.transactionId);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }
    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      throw new HttpError(400, 'Invalid transaction id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to link costs to this report');
    }

    const transaction = await FinanceTransaction.findByPk(transactionId);
    if (!transaction || transaction.kind !== 'expense') {
      res.status(404).json([{ message: 'Finance transaction not found' }]);
      return;
    }

    if (transaction.nightReportId && transaction.nightReportId !== reportId) {
      const sourceReport = await getNightReportById(transaction.nightReportId);
      if (!sourceReport) {
        throw new HttpError(409, 'This cost is linked to another night report that could not be loaded');
      }
      if (!canManageReport(sourceReport, actorId, req.authContext?.roleSlug)) {
        throw new HttpError(403, 'You do not have permission to reassign this cost from its current night report');
      }

      const splitMeta = readSplitGroupMeta(transaction);
      const existingRows = splitMeta
        ? await listSplitGroupCosts(splitMeta.splitGroupKey)
        : [transaction];
      const linkedReportIds = new Set(
        existingRows
          .map((row) => row.nightReportId)
          .filter((linkedReportId): linkedReportId is number => typeof linkedReportId === 'number' && linkedReportId > 0),
      );
      const affectedReportIds = [...new Set([...linkedReportIds, reportId])];

      for (const affectedReportId of affectedReportIds) {
        const affectedReport = await getNightReportById(affectedReportId);
        if (!affectedReport) {
          throw new HttpError(409, 'One of the linked night reports could not be loaded');
        }
        if (!canManageReport(affectedReport, actorId, req.authContext?.roleSlug)) {
          throw new HttpError(403, 'You do not have permission to split costs across one of the linked night reports');
        }
      }

      if (!linkedReportIds.has(reportId)) {
        const splitGroupKey = splitMeta?.splitGroupKey ?? crypto.randomUUID();
        const splitTotalMinor = splitMeta?.splitTotalMinor ?? transaction.amountMinor;
        const splitRootTransactionId = splitMeta?.splitRootTransactionId ?? transaction.id;
        const rowsToRebalance = [...existingRows].sort((left, right) => left.id - right.id);
        const nextShares = distributeSplitAmount(splitTotalMinor, rowsToRebalance.length + 1);
        const targetShare = nextShares[nextShares.length - 1] ?? splitTotalMinor;

        await sequelize.transaction(async (dbTransaction) => {
          for (const [index, row] of rowsToRebalance.entries()) {
            const rowMeta = row.meta && typeof row.meta === 'object' ? (row.meta as Record<string, unknown>) : null;
            await updateFinanceTransaction(
              row.id,
              {
                amountMinor: nextShares[index],
                meta: buildSplitMeta(rowMeta, splitGroupKey, splitTotalMinor, splitRootTransactionId),
              },
              actorId,
              { transaction: dbTransaction },
            );
          }

          await createFinanceTransaction(
            {
              kind: 'expense',
              date: transaction.date,
              accountId: transaction.accountId,
              currency: transaction.currency,
              amountMinor: targetShare,
              fxRate: transaction.fxRate,
              categoryId: transaction.categoryId,
              counterpartyType: transaction.counterpartyType,
              counterpartyId: transaction.counterpartyId,
              paymentMethod: transaction.paymentMethod,
              status: transaction.status,
              description: transaction.description,
              nightReportId: reportId,
              productId: report.counter?.productId ?? transaction.productId ?? null,
              serviceDate: report.activityDate,
              tags: transaction.tags,
              meta: buildSplitMeta(
                transaction.meta && typeof transaction.meta === 'object'
                  ? (transaction.meta as Record<string, unknown>)
                  : null,
                splitGroupKey,
                splitTotalMinor,
                splitRootTransactionId,
              ),
              invoiceFileId: transaction.invoiceFileId,
              receiptGroupKey: transaction.receiptGroupKey,
              receiptTotalMinor: transaction.receiptTotalMinor,
              receiptCurrency: transaction.receiptCurrency,
              receiptAllocationNote: transaction.receiptAllocationNote,
              receiptLineOrder: transaction.receiptLineOrder,
            },
            actorId,
            { transaction: dbTransaction },
          );
        });

        if (affectedReportIds.length > 0) {
          await NightReport.update(
            {
              noExtraCostConfirmed: false,
              noExtraCostConfirmedBy: null,
              noExtraCostConfirmedAt: null,
              updatedBy: actorId,
            },
            { where: { id: { [Op.in]: affectedReportIds } } },
          );
        }
      }
    } else {
      await updateFinanceTransaction(
        transactionId,
        {
          nightReportId: reportId,
          productId: report.counter?.productId ?? transaction.productId ?? null,
          serviceDate: report.activityDate,
        },
        actorId,
      );

      await NightReport.update(
        {
          noExtraCostConfirmed: false,
          noExtraCostConfirmedBy: null,
          noExtraCostConfirmedAt: null,
          updatedBy: actorId,
        },
        { where: { id: reportId } },
      );
    }

    const fresh = await getNightReportById(reportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    res.status(200).json([await serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to link night report cost', error);
    res.status(500).json([{ message: 'Failed to link night report cost' }]);
  }
};

export const unlinkNightReportCost = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    const transactionId = Number(req.params.transactionId);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }
    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      throw new HttpError(400, 'Invalid transaction id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to unlink costs from this report');
    }

    const transaction = await FinanceTransaction.findOne({
      where: {
        id: transactionId,
        kind: 'expense',
        nightReportId: reportId,
      },
    });

    if (!transaction) {
      res.status(404).json([{ message: 'Night report cost not found' }]);
      return;
    }

    const splitMeta = readSplitGroupMeta(transaction);
    if (resolveNightReportCostLinkOrigin(transaction) === 'created' && !splitMeta) {
      throw new HttpError(400, 'Costs created from the night report must be deleted instead of unlinked');
    }

    if (splitMeta) {
      await removeSplitGroupCostMember(transaction, actorId);
      await recordFinanceAuditLog({
        entity: 'finance_transaction',
        entityId: transactionId,
        action: 'delete',
        performedBy: actorId,
      });
    } else {
      await updateFinanceTransaction(
        transactionId,
        {
          nightReportId: null,
        },
        actorId,
      );
    }

    const fresh = await getNightReportById(reportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    res.status(200).json([await serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to unlink night report cost', error);
    res.status(500).json([{ message: 'Failed to unlink night report cost' }]);
  }
};

export const deleteNightReportCost = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    const transactionId = Number(req.params.transactionId);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }
    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      throw new HttpError(400, 'Invalid transaction id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to delete costs from this report');
    }

    const transaction = await FinanceTransaction.findOne({
      where: {
        id: transactionId,
        kind: 'expense',
        nightReportId: reportId,
      },
    });

    if (!transaction) {
      res.status(404).json([{ message: 'Night report cost not found' }]);
      return;
    }

    const splitMeta = readSplitGroupMeta(transaction);
    if (splitMeta) {
      await removeSplitGroupCostMember(transaction, actorId);
    } else {
      await deleteFinanceTransactionAndCleanupInvoice(transaction);
    }
    await recordFinanceAuditLog({
      entity: 'finance_transaction',
      entityId: transactionId,
      action: 'delete',
      performedBy: actorId,
    });

    const fresh = await getNightReportById(reportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    res.status(200).json([await serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to delete night report cost', error);
    res.status(500).json([{ message: 'Failed to delete night report cost' }]);
  }
};

export const deleteNightReportReceiptAllocations = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    const receiptGroupKey =
      typeof req.params.receiptGroupKey === 'string' ? req.params.receiptGroupKey.trim() : '';

    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }
    if (!receiptGroupKey) {
      throw new HttpError(400, 'Invalid receipt group key');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to delete this shared receipt');
    }

    const rows = await FinanceTransaction.findAll({
      where: {
        kind: 'expense',
        receiptGroupKey,
      },
      order: [
        ['receiptLineOrder', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    if (rows.length === 0) {
      res.status(404).json([{ message: 'Shared receipt not found' }]);
      return;
    }

    const invoiceFileIds = Array.from(
      new Set(
        rows
          .map((row) => row.invoiceFileId)
          .filter((invoiceFileId): invoiceFileId is number => typeof invoiceFileId === 'number' && invoiceFileId > 0),
      ),
    );

    await sequelize.transaction(async (transaction) => {
      await FinanceTransaction.destroy({
        where: {
          kind: 'expense',
          receiptGroupKey,
        },
        transaction,
      });
    });

    for (const row of rows) {
      await recordFinanceAuditLog({
        entity: 'finance_transaction',
        entityId: row.id,
        action: 'delete',
        performedBy: actorId,
        metadata: {
          receiptGroupKey,
          sharedReceipt: true,
        },
      });
    }

    for (const invoiceFileId of invoiceFileIds) {
      await cleanupInvoiceFileIfOrphan(invoiceFileId);
    }

    const fresh = await getNightReportById(reportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    res.status(200).json([await serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to delete shared receipt', error);
    res.status(500).json([{ message: 'Failed to delete shared receipt' }]);
  }
};

export const deleteNightReportReceiptAllocationsForReport = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    const targetReportId = Number(req.params.targetReportId);
    const receiptGroupKey =
      typeof req.params.receiptGroupKey === 'string' ? req.params.receiptGroupKey.trim() : '';

    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }
    if (!Number.isInteger(targetReportId) || targetReportId <= 0) {
      throw new HttpError(400, 'Invalid target report id');
    }
    if (!receiptGroupKey) {
      throw new HttpError(400, 'Invalid receipt group key');
    }

    const anchorReport = await getNightReportById(reportId);
    if (!anchorReport) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(anchorReport, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to delete allocations from this shared receipt');
    }

    const targetReport = await getNightReportById(targetReportId);
    if (!targetReport) {
      res.status(404).json([{ message: 'Target night report not found' }]);
      return;
    }
    if (!canManageReport(targetReport, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to edit the target night report');
    }

    const rows = await FinanceTransaction.findAll({
      where: {
        kind: 'expense',
        receiptGroupKey,
        nightReportId: targetReportId,
      },
      order: [
        ['receiptLineOrder', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    if (rows.length === 0) {
      res.status(404).json([{ message: 'No allocations found for this night report within the shared receipt' }]);
      return;
    }

    const invoiceFileIds = Array.from(
      new Set(
        rows
          .map((row) => row.invoiceFileId)
          .filter((invoiceFileId): invoiceFileId is number => typeof invoiceFileId === 'number' && invoiceFileId > 0),
      ),
    );

    await sequelize.transaction(async (transaction) => {
      await FinanceTransaction.destroy({
        where: {
          kind: 'expense',
          receiptGroupKey,
          nightReportId: targetReportId,
        },
        transaction,
      });
    });

    for (const row of rows) {
      await recordFinanceAuditLog({
        entity: 'finance_transaction',
        entityId: row.id,
        action: 'delete',
        performedBy: actorId,
        metadata: {
          receiptGroupKey,
          sharedReceipt: true,
          deletedForReportId: targetReportId,
        },
      });
    }

    for (const invoiceFileId of invoiceFileIds) {
      await cleanupInvoiceFileIfOrphan(invoiceFileId);
    }

    const fresh = await getNightReportById(reportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    res.status(200).json([await serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to delete receipt allocations for report', error);
    res.status(500).json([{ message: 'Failed to delete receipt allocations for report' }]);
  }
};

export const uploadNightReportPhoto = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sequelize = NightReport.sequelize;
  if (!sequelize) {
    res.status(500).json([{ message: 'Database connection unavailable' }]);
    return;
  }

  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to upload photos for this report');
    }

    const file = req.file;
    if (!file) {
      throw new HttpError(400, 'No file uploaded');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new HttpError(400, 'Only image uploads are supported');
    }

    await ensureNightReportStorage();

    const { relativePath } = await storeNightReportPhoto({
      reportId,
      activityDate: report.activityDate,
      originalName: file.originalname,
      mimeType: file.mimetype,
      data: file.buffer,
    });

    const capturedAt =
      typeof req.body?.capturedAt === 'string' && req.body.capturedAt
        ? new Date(req.body.capturedAt)
        : null;

    const photo = await NightReportPhoto.create({
      reportId,
      uploaderId: actorId,
      storagePath: relativePath,
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      capturedAt: capturedAt ? capturedAt : null,
    });

    res.status(201).json([
      {
        id: photo.id,
        originalName: photo.originalName,
        mimeType: photo.mimeType,
        fileSize: photo.fileSize,
        capturedAt: photo.capturedAt ? photo.capturedAt.toISOString() : null,
        downloadUrl: buildPhotoDownloadUrl(req, reportId, photo.id),
      },
    ]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to upload night report photo', error);
    res.status(500).json([{ message: 'Failed to upload night report photo' }]);
  }
};

export const deleteNightReportPhoto = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sequelize = NightReport.sequelize;
  if (!sequelize) {
    res.status(500).json([{ message: 'Database connection unavailable' }]);
    return;
  }

  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    const photoId = Number(req.params.photoId);

    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }
    if (!Number.isInteger(photoId) || photoId <= 0) {
      throw new HttpError(400, 'Invalid photo id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to manage photos for this report');
    }

    const photo = await NightReportPhoto.findOne({ where: { id: photoId, reportId } });
    if (!photo) {
      res.status(404).json([{ message: 'Photo not found' }]);
      return;
    }

    await sequelize.transaction(async (transaction) => {
      await NightReportPhoto.destroy({ where: { id: photoId }, transaction });
    });
    await removePhotoFromDisk(photo.storagePath).catch((error) => {
      logger.warn(`Failed to remove photo ${photo.id} from disk`, error);
    });

    res.status(204).send();
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to delete night report photo', error);
    res.status(500).json([{ message: 'Failed to delete night report photo' }]);
  }
};

export const downloadNightReportPhoto = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    const photoId = Number(req.params.photoId);

    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }
    if (!Number.isInteger(photoId) || photoId <= 0) {
      throw new HttpError(400, 'Invalid photo id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to access this photo');
    }

    const photo = await NightReportPhoto.findOne({ where: { id: photoId, reportId } });
    if (!photo) {
      res.status(404).json([{ message: 'Photo not found' }]);
      return;
    }

    const stream = await openNightReportPhotoStream(photo.storagePath);
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(photo.originalName)}"`);
    stream.on('error', (error) => {
      logger.error('Failed to stream night report photo', error);
      if (!res.headersSent) {
        res.status(500).json([{ message: 'Failed to stream photo' }]);
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (error) {
    if (error instanceof HttpError) {
      if (!res.headersSent) {
        res.status(error.status).json([{ message: error.message }]);
      }
      return;
    }
    logger.error('Failed to download night report photo', error);
    if (!res.headersSent) {
      res.status(500).json([{ message: 'Failed to download night report photo' }]);
    }
  }
};
