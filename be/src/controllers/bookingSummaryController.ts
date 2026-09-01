import type { Response } from 'express';
import dayjs from 'dayjs';
import { hasModuleActionPermission } from '../middleware/authorizationMiddleware.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import logger from '../utils/logger.js';
import { listBookings } from './bookingController.js';
import { getNightReportVenueSummary } from './nightReportController.js';
import { getCommissionByDateRange } from './reportController.js';

const DATE_FORMAT = 'YYYY-MM-DD';
const FULL_STAFF_PAYOUT_MODULE = 'staff-payouts-all';

type CapturedResponse = {
  statusCode: number;
  body: unknown;
  error?: unknown;
};

type BookingSummaryStaffPaymentBreakdown = {
  label: string;
  category: string;
  amount: number;
  earningStart: string | null;
  earningEnd: string | null;
  staffType: string | null;
};

type BookingSummaryStaffPayment = {
  userId: number | null;
  fullName: string;
  staffType: string | null;
  currency: string;
  amount: number;
  paid: number | null;
  outstanding: number | null;
  breakdown: BookingSummaryStaffPaymentBreakdown[] | null;
};

type ResponseHandler = (
  req: AuthenticatedRequest,
  res: Response,
) => Promise<void>;

const captureResponse = async (
  handler: ResponseHandler,
  req: AuthenticatedRequest,
): Promise<CapturedResponse> => {
  let statusCode = 200;
  let body: unknown = null;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
  } as unknown as Response;

  try {
    await handler(req, response);
    return { statusCode, body };
  } catch (error) {
    return { statusCode: 500, body: null, error };
  }
};

const isSuccessful = (response: CapturedResponse): boolean => (
  response.statusCode >= 200 && response.statusCode < 300
);

const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = dayjs(value);
  return parsed.isValid() && parsed.format(DATE_FORMAT) === value;
};

const cloneRequestWithQuery = (
  req: AuthenticatedRequest,
  query: Record<string, unknown>,
): AuthenticatedRequest => ({
  ...req,
  query: query as AuthenticatedRequest['query'],
  authContext: req.authContext,
  permissionCache: req.permissionCache,
} as AuthenticatedRequest);

const resolveOptionalBody = (
  response: CapturedResponse | null,
  source: 'venue' | 'staff',
): unknown | null => {
  if (!response || !isSuccessful(response)) {
    if (response) {
      logger.warn(
        `Booking Summary ${source} insights were unavailable`,
        response.error ?? { statusCode: response.statusCode },
      );
    }
    return null;
  }
  return response.body;
};

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const asFiniteNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asNullableFiniteNumber = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveStaffAmount = (
  row: Record<string, unknown>,
  payouts: Record<string, unknown> | null,
): number => {
  const payableDue = asNullableFiniteNumber(payouts?.payableDue);
  if (payableDue != null) return Math.max(payableDue, 0);
  const dueAmount = asNullableFiniteNumber(row.dueAmount);
  if (dueAmount != null) return Math.max(dueAmount, 0);
  const totalPayout = asNullableFiniteNumber(row.totalPayout);
  if (totalPayout != null) return Math.max(totalPayout, 0);
  return Math.max(asFiniteNumber(row.totalCommission), 0);
};

const asNullableText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
};

const toMinorUnits = (value: number): number | null => {
  const minorUnits = Math.round(value * 100);
  return Number.isSafeInteger(minorUnits) ? minorUnits : null;
};

type ProjectedStaffPaymentBreakdown = {
  row: BookingSummaryStaffPaymentBreakdown;
  amountMinor: number;
  mergeKey: string | null;
};

const asNullablePositiveInteger = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const buildStaffBreakdownMergeKey = (
  source: Record<string, unknown>,
  row: BookingSummaryStaffPaymentBreakdown,
): string | null => {
  const sourceKey = asNullableText(source.sourceKey);
  const currency = asNullableText(source.currency)?.toUpperCase() ?? null;
  const ruleId = asNullablePositiveInteger(source.ruleId);
  const componentId = asNullablePositiveInteger(source.componentId);
  const rawComponentId = source.componentId;
  const fundId = asNullablePositiveInteger(source.fundId);
  const rawFundId = source.fundId;
  if (
    !sourceKey
    || !currency
    || !ruleId
    || !row.staffType
    || (rawComponentId != null && componentId == null)
    || (rawFundId != null && fundId == null)
  ) {
    return null;
  }

  // Immutable segment/staff-period IDs and legacy-extrapolation metadata are
  // intentionally presentation-only exclusions: a migration boundary may
  // create two otherwise identical adjacent earning segments.
  return JSON.stringify([
    sourceKey.toLowerCase(),
    componentId,
    row.label,
    row.category.toLowerCase(),
    row.staffType.toLowerCase(),
    source.destination,
    currency,
    ruleId,
    fundId,
    source.routeChanged === true,
  ]);
};

const areAdjacentStaffBreakdownPeriods = (
  left: BookingSummaryStaffPaymentBreakdown,
  right: BookingSummaryStaffPaymentBreakdown,
): boolean => {
  if (
    !left.earningStart
    || !left.earningEnd
    || !right.earningStart
    || !right.earningEnd
    || !isValidIsoDate(left.earningStart)
    || !isValidIsoDate(left.earningEnd)
    || !isValidIsoDate(right.earningStart)
    || !isValidIsoDate(right.earningEnd)
    || left.earningEnd < left.earningStart
    || right.earningEnd < right.earningStart
  ) {
    return false;
  }
  return dayjs(left.earningEnd).add(1, 'day').format(DATE_FORMAT) === right.earningStart;
};

const mergeAdjacentStaffPaymentBreakdown = (
  rows: ProjectedStaffPaymentBreakdown[],
): BookingSummaryStaffPaymentBreakdown[] => {
  const merged: ProjectedStaffPaymentBreakdown[] = [];
  const latestIndexByKey = new Map<string, number>();

  rows.forEach((candidate) => {
    const previousIndex = candidate.mergeKey == null
      ? undefined
      : latestIndexByKey.get(candidate.mergeKey);
    const previous = previousIndex == null ? null : merged[previousIndex];

    if (
      previous
      && previous.mergeKey === candidate.mergeKey
      && areAdjacentStaffBreakdownPeriods(previous.row, candidate.row)
    ) {
      previous.amountMinor += candidate.amountMinor;
      previous.row.amount = previous.amountMinor / 100;
      previous.row.earningEnd = candidate.row.earningEnd;
      return;
    }

    const nextIndex = merged.length;
    merged.push({
      ...candidate,
      row: { ...candidate.row },
    });
    if (candidate.mergeKey != null) {
      latestIndexByKey.set(candidate.mergeKey, nextIndex);
    }
  });

  return merged.map(({ row }) => row);
};

const projectStaffPaymentBreakdown = (
  row: Record<string, unknown>,
  amount: number,
): BookingSummaryStaffPaymentBreakdown[] | null => {
  if (row.settlementReconciliationRequired === true || !Array.isArray(row.settlementSources)) {
    return null;
  }

  const projected: ProjectedStaffPaymentBreakdown[] = [];
  for (const value of row.settlementSources) {
    const source = asRecord(value);
    if (!source) return null;
    if (source.destination !== 'staff_vendor') continue;

    const sourceAmount = asNullableFiniteNumber(source.amount);
    const label = asNullableText(source.label);
    const category = asNullableText(source.category);
    if (sourceAmount == null || !label || !category) return null;

    const sourceMinorUnits = toMinorUnits(sourceAmount);
    if (sourceMinorUnits == null) return null;
    const projectedRow: BookingSummaryStaffPaymentBreakdown = {
      label,
      category,
      amount: sourceAmount,
      earningStart: asNullableText(source.earningStart),
      earningEnd: asNullableText(source.earningEnd),
      staffType: asNullableText(source.staffType),
    };
    projected.push({
      row: projectedRow,
      amountMinor: sourceMinorUnits,
      mergeKey: buildStaffBreakdownMergeKey(source, projectedRow),
    });
  }

  const expectedMinorUnits = toMinorUnits(amount);
  const projectedMinorUnits = projected.reduce(
    (sum, source) => sum + source.amountMinor,
    0,
  );
  if (
    expectedMinorUnits == null
    || projectedMinorUnits == null
    || !Number.isSafeInteger(projectedMinorUnits)
    || projectedMinorUnits !== expectedMinorUnits
  ) {
    return null;
  }

  return mergeAdjacentStaffPaymentBreakdown(projected);
};

const projectStaffPayments = (
  response: CapturedResponse | null,
): BookingSummaryStaffPayment[] | null => {
  const rawBody = resolveOptionalBody(response, 'staff');
  if (!Array.isArray(rawBody)) return null;
  const envelope = asRecord(rawBody[0]);
  if (!envelope || envelope.accessScope !== 'all' || !Array.isArray(envelope.data)) {
    logger.warn('Booking Summary staff insights had an invalid response shape');
    return null;
  }

  return envelope.data.reduce<BookingSummaryStaffPayment[]>((rows, value) => {
    const row = asRecord(value);
    if (!row) return rows;
    const payouts = asRecord(row.payouts);
    const rawUserId = asNullableFiniteNumber(row.userId);
    const userId = rawUserId != null && Number.isSafeInteger(rawUserId) && rawUserId > 0
      ? rawUserId
      : null;
    const nameParts = [row.firstName, row.lastName]
      .map((part) => String(part ?? '').trim())
      .filter(Boolean);
    const fullName = String(row.fullName ?? '').trim()
      || nameParts.join(' ')
      || (userId == null ? 'Unknown Staff Member' : `Staff #${userId}`);
    const amount = resolveStaffAmount(row, payouts);
    const paid = asNullableFiniteNumber(payouts?.payablePaid ?? row.paidAmount);
    const reportedOutstanding = asNullableFiniteNumber(payouts?.payableOutstanding);

    rows.push({
      userId,
      fullName,
      staffType: String(row.staffType ?? '').trim() || null,
      currency: String(payouts?.currency ?? row.currency ?? '').trim().toUpperCase(),
      amount,
      paid,
      outstanding: reportedOutstanding ?? (paid == null ? null : Math.max(amount - paid, 0)),
      breakdown: projectStaffPaymentBreakdown(row, amount),
    });
    return rows;
  }, []);
};

export const listBookingsWithSummary = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  const includeSummaryInsights = String(req.query.includeSummaryInsights ?? '')
    .trim()
    .toLowerCase() === 'true';

  const ordersOnly = String(req.query.ordersOnly ?? '').trim().toLowerCase() === 'true';
  if (!includeSummaryInsights || ordersOnly) {
    await listBookings(req, res);
    return;
  }

  const startDate = String(req.query.pickupFrom ?? req.query.date ?? '').trim();
  const endDate = String(req.query.pickupTo ?? req.query.date ?? '').trim();
  if (
    !isValidIsoDate(startDate)
    || !isValidIsoDate(endDate)
    || endDate < startDate
  ) {
    res.status(400).json({ message: 'Valid pickupFrom and pickupTo are required for Booking Summary' });
    return;
  }

  let canViewAllStaffPayouts = false;
  try {
    canViewAllStaffPayouts = await hasModuleActionPermission(
      req,
      FULL_STAFF_PAYOUT_MODULE,
      'view',
    );
  } catch (error) {
    logger.warn('Booking Summary staff payout access could not be resolved', error);
  }

  const bookingsRequest = cloneRequestWithQuery(req, {
    ...req.query,
    includeCostInsights: 'true',
  });
  const venueRequest = cloneRequestWithQuery(req, {
    period: 'custom',
    startDate,
    endDate,
  });
  const staffRequest = cloneRequestWithQuery(req, {
    startDate,
    endDate,
    scope: 'all',
  });
  staffRequest.staffPayoutAccessScope = 'all';

  const [bookingsResponse, venueResponse, staffResponse] = await Promise.all([
    captureResponse(listBookings, bookingsRequest),
    captureResponse(getNightReportVenueSummary, venueRequest),
    canViewAllStaffPayouts
      ? captureResponse(getCommissionByDateRange, staffRequest)
      : Promise.resolve(null),
  ]);

  if (!isSuccessful(bookingsResponse)) {
    if (bookingsResponse.error) {
      logger.error('Booking Summary bookings source failed unexpectedly', bookingsResponse.error);
      res.status(500).json({ message: 'Failed to load bookings' });
      return;
    }
    res.status(bookingsResponse.statusCode).json(bookingsResponse.body);
    return;
  }
  if (
    !bookingsResponse.body
    || typeof bookingsResponse.body !== 'object'
    || Array.isArray(bookingsResponse.body)
  ) {
    res.status(500).json({ message: 'Invalid Booking Summary response' });
    return;
  }

  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({
    ...bookingsResponse.body,
    summaryInsights: {
      venueSummary: resolveOptionalBody(venueResponse, 'venue'),
      staffPayments: projectStaffPayments(staffResponse),
    },
  });
};
