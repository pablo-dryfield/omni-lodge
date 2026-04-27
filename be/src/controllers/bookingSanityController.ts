import { Request, Response } from 'express';
import { Op, type WhereOptions, fn, col, where as sequelizeWhere } from 'sequelize';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import sequelize from '../config/database.js';
import Booking from '../models/Booking.js';
import BookingEvent from '../models/BookingEvent.js';
import ProductAlias from '../models/ProductAlias.js';
import { fetchEcwidOrders, getEcwidOrder, type EcwidOrder } from '../services/ecwidService.js';
import { processBookingEmail, type ScopedReprocessHint } from '../services/bookings/bookingIngestionService.js';
import { transformEcwidOrders } from '../utils/ecwidAdapter.js';
import { sanitizeProductSource } from '../utils/productName.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const DATE_FORMAT = 'YYYY-MM-DD';
const STORE_TIMEZONE = 'Europe/Warsaw';
const DEFAULT_TOLERANCE = 0.01;
const ECWID_REFUND_PAYMENT_STATUSES = new Set(['PARTIALLY_REFUNDED', 'REFUNDED']);

type SanityDateField = 'experience_date' | 'source_received_at';

type SanityCheckQueryParams = {
  startDate?: string;
  endDate?: string;
  dateField?: string;
  platform?: string;
  includeCancelled?: string;
  includeBreakdown?: string;
  tolerance?: string;
};

type EcwidScopedReprocessBody = {
  rows?: Array<{
    orderId?: string;
    hints?: string[];
  }>;
};

type EcwidFixOrderBody = {
  orderId?: string;
};

type EcwidFixOrdersBody = {
  orderIds?: string[];
};

type OmniOrderAggregate = {
  orderKey: string;
  platformOrderId: string | null;
  bookingIds: number[];
  platformBookingIds: string[];
  bookings: number;
  people: number;
  revenue: number;
  baseAmount: number;
  tipAmount: number;
  priceGross: number;
  priceNet: number;
  refundedAmount: number;
  firstDate: string | null;
  lastDate: string | null;
  firstSourceReceivedAt: string | null;
  lastSourceReceivedAt: string | null;
  statuses: string[];
};

type OmniTotals = {
  bookings: number;
  orderGroups: number;
  people: number;
  revenue: number;
  baseAmount: number;
  tipAmount: number;
  priceGross: number;
  priceNet: number;
  refundedAmount: number;
};

type OmniPlatformSummary = {
  platform: string;
  totals: OmniTotals;
};

type EcwidExternalAggregate = {
  orderId: string;
  date: string | null;
  matchSource: 'activity' | 'pickup_fallback' | 'create_date';
  paymentStatus: string;
  subtotal: number;
  couponDiscount: number;
  discountAmount: number;
  tipImpact: number;
  refundedAmount: number;
  revenue: number;
  people: number;
  peopleSource: 'participants' | 'quantity_fallback';
  bookings: number;
};

type EcwidMismatchReason = 'only_omni' | 'only_external' | 'mismatch';
type EcwidCauseKey = 'tip' | 'coupon' | 'refund';

type EcwidMismatchDiagnosis = {
  checkOrder: EcwidCauseKey[];
  checkHints: EcwidCauseKey[];
  likelyCauses: string[];
  tipImpact: number;
  couponImpact: number;
  refundAdjustment: number;
  deltaAfterTip: number;
  deltaAfterCoupon: number;
  deltaAfterRefund: number;
};

type EcwidMismatch = {
  reason: EcwidMismatchReason;
  orderId: string;
  omniRevenue: number;
  externalRevenue: number;
  deltaRevenue: number;
  omniPeople: number;
  externalPeople: number;
  deltaPeople: number;
  omniBookings: number;
  externalBookings: number;
  omniFirstDate: string | null;
  omniLastDate: string | null;
  externalDate: string | null;
  externalPaymentStatus: string | null;
  externalMatchSource: string | null;
  diagnosis: EcwidMismatchDiagnosis;
};

type EcwidDiagnosticsSummary = {
  checkOrder: EcwidCauseKey[];
  hintCounts: Record<EcwidCauseKey, number>;
  likelyCauseCounts: Record<string, number>;
  topLikelyCauses: Array<{ cause: string; count: number }>;
};

type CollectOmniParams = {
  startDate: string;
  endDate: string;
  dateField: SanityDateField;
  platform?: string | null;
  includeCancelled: boolean;
};

const parseMoneyLikeNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }
    const normalized = trimmed.replace(/\s+/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const roundCurrency = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeDate = (value: string | undefined, boundary: 'start' | 'end'): string | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return null;
  }
  return (boundary === 'start' ? parsed.startOf('day') : parsed.endOf('day')).format(DATE_FORMAT);
};

const resolveDateRange = (
  query: SanityCheckQueryParams,
): { startDate: string; endDate: string } => {
  const fallbackStart = dayjs().tz(STORE_TIMEZONE).startOf('month').format(DATE_FORMAT);
  const fallbackEnd = dayjs().tz(STORE_TIMEZONE).endOf('month').format(DATE_FORMAT);

  const normalizedStart = normalizeDate(query.startDate, 'start') ?? fallbackStart;
  const normalizedEnd = normalizeDate(query.endDate ?? query.startDate, 'end') ?? fallbackEnd;

  if (normalizedStart <= normalizedEnd) {
    return { startDate: normalizedStart, endDate: normalizedEnd };
  }

  return { startDate: normalizedEnd, endDate: normalizedStart };
};

const resolveDateField = (value?: string): SanityDateField => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'source_received_at') {
    return 'source_received_at';
  }
  return 'experience_date';
};

const parseBooleanFlag = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return fallback;
};

const parseTolerance = (value: string | undefined): number => {
  const parsed = Number.parseFloat(String(value ?? DEFAULT_TOLERANCE));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_TOLERANCE;
  }
  return parsed;
};

const VALID_SCOPED_REPROCESS_HINTS = new Set<ScopedReprocessHint>(['tip', 'coupon', 'refund']);

const normalizeScopedHints = (values: unknown): ScopedReprocessHint[] => {
  if (!Array.isArray(values)) {
    return [];
  }
  const normalized = values
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter((value): value is ScopedReprocessHint => VALID_SCOPED_REPROCESS_HINTS.has(value as ScopedReprocessHint));
  return [...new Set(normalized)];
};

const collectEcwidOrderMessageIds = async (orderId: string): Promise<string[]> => {
  const bookings = await Booking.findAll({
    where: {
      platform: 'ecwid',
      [Op.or]: [{ platformOrderId: orderId }, { platformBookingId: orderId }],
    },
    attributes: ['id', 'lastEmailMessageId'],
    order: [['id', 'ASC']],
  });

  if (bookings.length === 0) {
    return [];
  }

  const bookingIds = bookings.map((booking) => Number(booking.id)).filter((id) => Number.isFinite(id) && id > 0);
  const fallbackMessageIds = bookings
    .map((booking) => String(booking.lastEmailMessageId ?? '').trim())
    .filter((value) => value.length > 0);

  if (bookingIds.length === 0) {
    return [...new Set(fallbackMessageIds)];
  }

  const events = await BookingEvent.findAll({
    where: {
      bookingId: { [Op.in]: bookingIds },
      emailMessageId: { [Op.ne]: null },
    },
    attributes: ['emailMessageId', 'occurredAt', 'id'],
    order: [
      ['occurredAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  const messageIdsFromEvents = events
    .map((event) => String(event.emailMessageId ?? '').trim())
    .filter((value) => value.length > 0);

  return [...new Set([...messageIdsFromEvents, ...fallbackMessageIds])];
};

const normalizeAliasLabel = (value: string): string => sanitizeProductSource(value).toLowerCase();

const resolveAliasProductId = (aliases: ProductAlias[], value: string): number | null => {
  const normalized = normalizeAliasLabel(value);
  for (const alias of aliases) {
    if (!alias.active) {
      continue;
    }
    if (alias.matchType === 'exact') {
      if (alias.normalizedLabel === normalized) {
        return alias.productId ?? null;
      }
      continue;
    }
    if (alias.matchType === 'contains') {
      if (normalized.includes(alias.normalizedLabel)) {
        return alias.productId ?? null;
      }
      continue;
    }
    if (alias.matchType === 'regex') {
      try {
        const matcher = new RegExp(alias.label, 'i');
        if (matcher.test(value)) {
          return alias.productId ?? null;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
};

const formatEcwidItemVariant = (item: Record<string, unknown>): string | null => {
  const parts: string[] = [];
  const selectedOptions = Array.isArray(item.selectedOptions)
    ? (item.selectedOptions as Array<Record<string, unknown>>)
    : [];
  selectedOptions.forEach((entry) => {
    const name = String(entry.name ?? '').trim();
    const value = String(entry.value ?? entry.selectionTitle ?? '').trim();
    if (name && value) {
      parts.push(`${name}: ${value}`);
      return;
    }
    if (value) {
      parts.push(value);
    }
  });

  const options = Array.isArray(item.options) ? (item.options as Array<Record<string, unknown>>) : [];
  options.forEach((entry) => {
    const name = String(entry.name ?? '').trim();
    const directValue = String(entry.value ?? '').trim();
    const selections = Array.isArray(entry.selections) ? (entry.selections as Array<Record<string, unknown>>) : [];
    if (selections.length > 0) {
      selections.forEach((selection) => {
        const value = String(selection.selectionTitle ?? selection.value ?? selection.name ?? '').trim();
        if (name && value) {
          parts.push(`${name}: ${value}`);
        } else if (value) {
          parts.push(value);
        }
      });
      return;
    }
    if (name && directValue) {
      parts.push(`${name}: ${directValue}`);
    } else if (directValue) {
      parts.push(directValue);
    }
  });

  return parts.length > 0 ? Array.from(new Set(parts)).join(' | ') : null;
};

const splitByWeights = (total: number, weights: number[]): number[] => {
  const normalizedTotal = roundCurrency(Math.max(total, 0));
  if (weights.length === 0) {
    return [];
  }
  const normalizedWeights = weights.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const totalWeight = normalizedWeights.reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) {
    const equalWeight = Array.from({ length: weights.length }).map(() => 1);
    return splitByWeights(normalizedTotal, equalWeight);
  }

  const rawShares = normalizedWeights.map((weight) => (normalizedTotal * weight) / totalWeight);
  const rounded = rawShares.map((value) => roundCurrency(value));
  const roundedSum = roundCurrency(rounded.reduce((sum, value) => sum + value, 0));
  const drift = roundCurrency(normalizedTotal - roundedSum);
  if (Math.abs(drift) > 0 && rounded.length > 0) {
    rounded[rounded.length - 1] = roundCurrency(rounded[rounded.length - 1] + drift);
  }
  return rounded;
};

const toDateOnlyString = (value: Date | null | undefined): string | null => {
  if (!value || Number.isNaN(value.getTime())) {
    return null;
  }
  return dayjs(value).tz(STORE_TIMEZONE).format(DATE_FORMAT);
};

const toIsoString = (value: Date | null | undefined): string | null => {
  if (!value || Number.isNaN(value.getTime())) {
    return null;
  }
  return dayjs(value).toISOString();
};

const resolveBookingPeople = (booking: Booking): number => {
  const total = Number(booking.partySizeTotal);
  if (Number.isFinite(total) && total > 0) {
    return Math.max(Math.round(total), 0);
  }

  const adults = Number(booking.partySizeAdults);
  const children = Number(booking.partySizeChildren);
  const adultsValue = Number.isFinite(adults) ? Math.max(Math.round(adults), 0) : 0;
  const childrenValue = Number.isFinite(children) ? Math.max(Math.round(children), 0) : 0;
  const combined = adultsValue + childrenValue;
  if (combined > 0) {
    return combined;
  }
  return adultsValue;
};

const toNormalizedDate = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return null;
  }
  return parsed.tz(STORE_TIMEZONE).format(DATE_FORMAT);
};

const ECWID_MEN_LABELS = ['men', 'man', 'male', 'boys', 'boy', 'gents', 'gent', 'guys', 'guy'];
const ECWID_WOMEN_LABELS = ['women', 'woman', 'female', 'girls', 'girl', 'ladies', 'lady'];

const normalizeKeywordValue = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const includesKeywordToken = (source: unknown, keywords: string[]): boolean => {
  const normalized = normalizeKeywordValue(source);
  if (!normalized) {
    return false;
  }
  const tokens = normalized.split(/[^a-z0-9]+/g).filter(Boolean);
  return tokens.some((token) => keywords.includes(token));
};

const countRegexMatches = (text: string, regex: RegExp): number => {
  let total = 0;
  for (const match of text.matchAll(regex)) {
    const rawNumber = match[1];
    if (!rawNumber) {
      continue;
    }
    const parsed = Number.parseInt(rawNumber, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      total += parsed;
    }
  }
  return total;
};

const extractGenderFromText = (rawValue: unknown): { men: number; women: number } => {
  const text = normalizeKeywordValue(rawValue);
  if (!text) {
    return { men: 0, women: 0 };
  }
  return {
    men: countRegexMatches(text, /(\d+)\s*(men|man|boys|boy|male)/g),
    women: countRegexMatches(text, /(\d+)\s*(women|woman|girls|girl|female)/g),
  };
};

const parsePositiveInteger = (rawValue: unknown): number => {
  if (rawValue === null || rawValue === undefined) {
    return 0;
  }
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) && rawValue > 0 ? Math.round(rawValue) : 0;
  }
  const matched = String(rawValue).match(/\d+/);
  if (!matched || !matched[0]) {
    return 0;
  }
  const parsed = Number.parseInt(matched[0], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const accumulateGenderValue = (
  target: { men: number; women: number },
  rawValue: unknown,
  explicit?: 'men' | 'women',
): void => {
  if (rawValue === null || rawValue === undefined) {
    return;
  }
  if (explicit) {
    const qty = parsePositiveInteger(rawValue);
    if (qty > 0) {
      target[explicit] += qty;
      return;
    }
  }
  const extracted = extractGenderFromText(rawValue);
  target.men += extracted.men;
  target.women += extracted.women;
};

const resolveSelectionValue = (selection: Record<string, unknown>): unknown => {
  if (selection.value !== undefined && selection.value !== null) {
    return selection.value;
  }
  if (selection.selectionTitle !== undefined && selection.selectionTitle !== null) {
    return selection.selectionTitle;
  }
  if (selection.name !== undefined && selection.name !== null) {
    return selection.name;
  }
  return undefined;
};

const resolveSelectionLabel = (selection: Record<string, unknown>): string => {
  const rawLabel = selection.name ?? selection.selectionTitle;
  return normalizeKeywordValue(rawLabel);
};

type EcwidRawPeopleStats = {
  people: number;
  peopleSource: 'participants' | 'quantity_fallback';
  itemCount: number;
};

const resolveRawEcwidPeopleStats = (rawOrder: EcwidOrder): EcwidRawPeopleStats => {
  const order = rawOrder as Record<string, unknown>;
  const items = Array.isArray(order.items) ? (order.items as Array<Record<string, unknown>>) : [];
  if (items.length === 0) {
    return {
      people: 0,
      peopleSource: 'quantity_fallback',
      itemCount: 1,
    };
  }

  let people = 0;
  let hasParticipants = false;

  items.forEach((item) => {
    const counters = { men: 0, women: 0 };
    const options = Array.isArray(item.selectedOptions)
      ? (item.selectedOptions as Array<Record<string, unknown>>)
      : Array.isArray(item.options)
        ? (item.options as Array<Record<string, unknown>>)
        : [];

    options.forEach((option) => {
      const optionLabel = normalizeKeywordValue(option.name);
      const optionGender: 'men' | 'women' | undefined = includesKeywordToken(optionLabel, ECWID_MEN_LABELS)
        ? 'men'
        : includesKeywordToken(optionLabel, ECWID_WOMEN_LABELS)
          ? 'women'
          : undefined;

      accumulateGenderValue(counters, option.value, optionGender);

      const selections = Array.isArray(option.selections)
        ? (option.selections as Array<Record<string, unknown>>)
        : [];
      selections.forEach((selection) => {
        const selectionLabel = resolveSelectionLabel(selection);
        if (includesKeywordToken(selectionLabel, ECWID_MEN_LABELS)) {
          accumulateGenderValue(counters, resolveSelectionValue(selection), 'men');
          return;
        }
        if (includesKeywordToken(selectionLabel, ECWID_WOMEN_LABELS)) {
          accumulateGenderValue(counters, resolveSelectionValue(selection), 'women');
          return;
        }
        accumulateGenderValue(counters, resolveSelectionValue(selection), optionGender);
      });
    });

    const participants = counters.men + counters.women;
    if (participants > 0) {
      hasParticipants = true;
      people += participants;
      return;
    }
    people += parsePositiveInteger(item.quantity);
  });

  return {
    people,
    peopleSource: hasParticipants ? 'participants' : 'quantity_fallback',
    itemCount: items.length,
  };
};

const isDateInsideRange = (value: string | null, startDate: string, endDate: string): boolean => {
  if (!value) {
    return false;
  }
  return value >= startDate && value <= endDate;
};

const compareNullableDate = (left: string | null, right: string | null): number => {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left.localeCompare(right);
};

type EcwidComparableOmniRevenue = {
  value: number;
  refundAdjusted: boolean;
  refundAdjustment: number;
};
const ECWID_CHECK_ORDER: EcwidCauseKey[] = ['tip', 'coupon', 'refund'];

const resolveEcwidComparableOmniRevenue = (
  omniRow: OmniOrderAggregate,
  externalRow: EcwidExternalAggregate | undefined,
): EcwidComparableOmniRevenue => {
  if (!externalRow) {
    return {
      value: omniRow.revenue,
      refundAdjusted: false,
      refundAdjustment: 0,
    };
  }

  const paymentStatus = String(externalRow.paymentStatus ?? '').trim().toUpperCase();
  const hasRefundInOmni = omniRow.refundedAmount > 0;
  const ecwidShowsRefundedStatus = ECWID_REFUND_PAYMENT_STATUSES.has(paymentStatus);

  if (hasRefundInOmni && ecwidShowsRefundedStatus) {
    // Ecwid refund payloads are inconsistent:
    // - some orders keep "total" as gross (before refund),
    // - others reflect a net-like final total.
    // Pick whichever Omni candidate is closest to Ecwid total.
    const candidateNet = roundCurrency(omniRow.revenue);
    const candidateGross =
      omniRow.priceGross > 0 ? roundCurrency(omniRow.priceGross) : roundCurrency(omniRow.revenue + omniRow.refundedAmount);
    const externalTotal = roundCurrency(externalRow.revenue);

    const netDistance = Math.abs(roundCurrency(candidateNet - externalTotal));
    const grossDistance = Math.abs(roundCurrency(candidateGross - externalTotal));
    const useGross = grossDistance < netDistance;
    const value = useGross ? candidateGross : candidateNet;
    const refundAdjustment = roundCurrency(value - omniRow.revenue);

    return {
      value,
      refundAdjusted: useGross && Math.abs(refundAdjustment) > DEFAULT_TOLERANCE,
      refundAdjustment,
    };
  }

  return {
    value: omniRow.revenue,
    refundAdjusted: false,
    refundAdjustment: 0,
  };
};

const buildEcwidMismatchDiagnosis = (
  deltaRevenue: number,
  tolerance: number,
  externalRow: EcwidExternalAggregate,
  comparableRevenue: EcwidComparableOmniRevenue,
  omniRow: OmniOrderAggregate,
): EcwidMismatchDiagnosis => {
  const tipImpact = roundCurrency(externalRow.tipImpact);
  const couponImpact = roundCurrency(externalRow.couponDiscount + externalRow.discountAmount);
  const refundAdjustment = roundCurrency(comparableRevenue.refundAdjustment);
  const deltaAfterTip = roundCurrency(deltaRevenue + tipImpact);
  const deltaAfterCoupon = roundCurrency(deltaRevenue - couponImpact);
  const deltaAfterRefund = roundCurrency(deltaRevenue - refundAdjustment);

  const checkHints: EcwidCauseKey[] = [];
  if (Math.abs(tipImpact) > tolerance) {
    checkHints.push('tip');
  }
  if (Math.abs(couponImpact) > tolerance) {
    checkHints.push('coupon');
  }
  if (
    Math.abs(refundAdjustment) > tolerance ||
    omniRow.refundedAmount > 0 ||
    ECWID_REFUND_PAYMENT_STATUSES.has(String(externalRow.paymentStatus ?? '').toUpperCase())
  ) {
    checkHints.push('refund');
  }

  const likelyCauses: string[] = [];
  const tipExplains = Math.abs(deltaAfterTip) <= tolerance && Math.abs(tipImpact) > tolerance;
  const couponExplains = Math.abs(deltaAfterCoupon) <= tolerance && Math.abs(couponImpact) > tolerance;
  const refundExplains = Math.abs(deltaAfterRefund) <= tolerance && Math.abs(refundAdjustment) > tolerance;

  if (tipExplains) {
    likelyCauses.push('tip');
  }
  if (couponExplains) {
    likelyCauses.push('coupon');
  }
  if (refundExplains) {
    likelyCauses.push('refund');
  }

  if (likelyCauses.length === 0) {
    const tipCouponExplains =
      Math.abs(roundCurrency(deltaRevenue + tipImpact - couponImpact)) <= tolerance &&
      (Math.abs(tipImpact) > tolerance || Math.abs(couponImpact) > tolerance);
    const tipRefundExplains =
      Math.abs(roundCurrency(deltaRevenue + tipImpact - refundAdjustment)) <= tolerance &&
      (Math.abs(tipImpact) > tolerance || Math.abs(refundAdjustment) > tolerance);
    const couponRefundExplains =
      Math.abs(roundCurrency(deltaRevenue - couponImpact - refundAdjustment)) <= tolerance &&
      (Math.abs(couponImpact) > tolerance || Math.abs(refundAdjustment) > tolerance);
    const allExplains =
      Math.abs(roundCurrency(deltaRevenue + tipImpact - couponImpact - refundAdjustment)) <= tolerance &&
      (Math.abs(tipImpact) > tolerance || Math.abs(couponImpact) > tolerance || Math.abs(refundAdjustment) > tolerance);

    if (tipCouponExplains) {
      likelyCauses.push('tip+coupon');
    } else if (tipRefundExplains) {
      likelyCauses.push('tip+refund');
    } else if (couponRefundExplains) {
      likelyCauses.push('coupon+refund');
    } else if (allExplains) {
      likelyCauses.push('tip+coupon+refund');
    }
  }

  if (likelyCauses.length === 0) {
    likelyCauses.push('unresolved');
  }

  return {
    checkOrder: ECWID_CHECK_ORDER,
    checkHints,
    likelyCauses,
    tipImpact,
    couponImpact,
    refundAdjustment,
    deltaAfterTip,
    deltaAfterCoupon,
    deltaAfterRefund,
  };
};

const buildEcwidMissingDiagnosis = (
  reason: EcwidMismatchReason,
  externalRow?: EcwidExternalAggregate,
  omniRow?: OmniOrderAggregate,
): EcwidMismatchDiagnosis => {
  const checkHints: EcwidCauseKey[] = [];
  const tipImpact = roundCurrency(externalRow?.tipImpact ?? 0);
  const couponImpact = roundCurrency((externalRow?.couponDiscount ?? 0) + (externalRow?.discountAmount ?? 0));
  const ecwidPaymentStatus = String(externalRow?.paymentStatus ?? '').trim().toUpperCase();
  const ecwidIsFullyRefunded = ecwidPaymentStatus === 'REFUNDED';

  if (Math.abs(tipImpact) > DEFAULT_TOLERANCE) {
    checkHints.push('tip');
  }
  if (Math.abs(couponImpact) > DEFAULT_TOLERANCE) {
    checkHints.push('coupon');
  }
  if (
    ecwidIsFullyRefunded ||
    (omniRow?.refundedAmount ?? 0) > 0
  ) {
    checkHints.push('refund');
  }

  return {
    checkOrder: ECWID_CHECK_ORDER,
    checkHints,
    likelyCauses: [reason === 'only_external' ? 'missing_in_omni' : 'missing_in_ecwid'],
    tipImpact,
    couponImpact,
    refundAdjustment: 0,
    deltaAfterTip: 0,
    deltaAfterCoupon: 0,
    deltaAfterRefund: 0,
  };
};

const summarizeEcwidDiagnostics = (mismatches: EcwidMismatch[]): EcwidDiagnosticsSummary => {
  const hintCounts: Record<EcwidCauseKey, number> = {
    tip: 0,
    coupon: 0,
    refund: 0,
  };
  const likelyCauseCounts: Record<string, number> = {};

  mismatches.forEach((row) => {
    row.diagnosis.checkHints.forEach((hint) => {
      hintCounts[hint] += 1;
    });
    row.diagnosis.likelyCauses.forEach((cause) => {
      likelyCauseCounts[cause] = (likelyCauseCounts[cause] ?? 0) + 1;
    });
  });

  const topLikelyCauses = Object.entries(likelyCauseCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cause, count]) => ({ cause, count }));

  return {
    checkOrder: ECWID_CHECK_ORDER,
    hintCounts,
    likelyCauseCounts,
    topLikelyCauses,
  };
};

const aggregateOmniRows = (rows: Booking[], dateField: SanityDateField): { orders: OmniOrderAggregate[]; totals: OmniTotals } => {
  const map = new Map<string, OmniOrderAggregate>();

  rows.forEach((booking) => {
    const bookingId = Number(booking.id);
    if (!Number.isFinite(bookingId) || bookingId <= 0) {
      return;
    }

    const platformOrderId = typeof booking.platformOrderId === 'string' ? booking.platformOrderId.trim() : '';
    const platformBookingId = typeof booking.platformBookingId === 'string' ? booking.platformBookingId.trim() : '';
    const orderKey = platformOrderId || platformBookingId || `booking-${bookingId}`;

    const effectiveDate =
      dateField === 'source_received_at'
        ? toDateOnlyString(booking.sourceReceivedAt ?? null) ?? booking.experienceDate ?? null
        : booking.experienceDate ?? toDateOnlyString(booking.sourceReceivedAt ?? null);

    const sourceReceivedAt = toIsoString(booking.sourceReceivedAt ?? null);

    const people = resolveBookingPeople(booking);
    const baseAmount = roundCurrency(parseMoneyLikeNumber(booking.baseAmount));
    const tipAmount = roundCurrency(parseMoneyLikeNumber(booking.tipAmount));
    const priceGross = roundCurrency(parseMoneyLikeNumber(booking.priceGross));
    const priceNet = roundCurrency(parseMoneyLikeNumber(booking.priceNet));
    const refundedAmount = roundCurrency(parseMoneyLikeNumber(booking.refundedAmount));
    const revenue = roundCurrency(baseAmount + tipAmount);

    const existing = map.get(orderKey);
    if (existing) {
      existing.bookings += 1;
      existing.people += people;
      existing.baseAmount = roundCurrency(existing.baseAmount + baseAmount);
      existing.tipAmount = roundCurrency(existing.tipAmount + tipAmount);
      existing.revenue = roundCurrency(existing.revenue + revenue);
      existing.priceGross = roundCurrency(existing.priceGross + priceGross);
      existing.priceNet = roundCurrency(existing.priceNet + priceNet);
      existing.refundedAmount = roundCurrency(existing.refundedAmount + refundedAmount);
      existing.bookingIds.push(bookingId);
      if (platformBookingId && !existing.platformBookingIds.includes(platformBookingId)) {
        existing.platformBookingIds.push(platformBookingId);
      }
      if (booking.status && !existing.statuses.includes(booking.status)) {
        existing.statuses.push(booking.status);
      }
      if (effectiveDate) {
        if (!existing.firstDate || effectiveDate < existing.firstDate) {
          existing.firstDate = effectiveDate;
        }
        if (!existing.lastDate || effectiveDate > existing.lastDate) {
          existing.lastDate = effectiveDate;
        }
      }
      if (sourceReceivedAt) {
        if (!existing.firstSourceReceivedAt || sourceReceivedAt < existing.firstSourceReceivedAt) {
          existing.firstSourceReceivedAt = sourceReceivedAt;
        }
        if (!existing.lastSourceReceivedAt || sourceReceivedAt > existing.lastSourceReceivedAt) {
          existing.lastSourceReceivedAt = sourceReceivedAt;
        }
      }
      return;
    }

    map.set(orderKey, {
      orderKey,
      platformOrderId: platformOrderId || null,
      bookingIds: [bookingId],
      platformBookingIds: platformBookingId ? [platformBookingId] : [],
      bookings: 1,
      people,
      revenue,
      baseAmount,
      tipAmount,
      priceGross,
      priceNet,
      refundedAmount,
      firstDate: effectiveDate,
      lastDate: effectiveDate,
      firstSourceReceivedAt: sourceReceivedAt,
      lastSourceReceivedAt: sourceReceivedAt,
      statuses: booking.status ? [booking.status] : [],
    });
  });

  const orders = Array.from(map.values()).sort((a, b) => {
    const dateCompare = compareNullableDate(a.firstDate, b.firstDate);
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return a.orderKey.localeCompare(b.orderKey);
  });

  const totals = orders.reduce<OmniTotals>(
    (acc, row) => {
      acc.bookings += row.bookings;
      acc.orderGroups += 1;
      acc.people += row.people;
      acc.revenue = roundCurrency(acc.revenue + row.revenue);
      acc.baseAmount = roundCurrency(acc.baseAmount + row.baseAmount);
      acc.tipAmount = roundCurrency(acc.tipAmount + row.tipAmount);
      acc.priceGross = roundCurrency(acc.priceGross + row.priceGross);
      acc.priceNet = roundCurrency(acc.priceNet + row.priceNet);
      acc.refundedAmount = roundCurrency(acc.refundedAmount + row.refundedAmount);
      return acc;
    },
    {
      bookings: 0,
      orderGroups: 0,
      people: 0,
      revenue: 0,
      baseAmount: 0,
      tipAmount: 0,
      priceGross: 0,
      priceNet: 0,
      refundedAmount: 0,
    },
  );

  return { orders, totals };
};

const loadOmniBookings = async (params: CollectOmniParams): Promise<Booking[]> => {
  const { startDate, endDate, dateField, platform, includeCancelled } = params;

  const where: WhereOptions = {};
  const clauses: WhereOptions[] = [];

  if (platform) {
    clauses.push({ platform });
  }

  if (!includeCancelled) {
    clauses.push({ status: { [Op.ne]: 'cancelled' } });
  }

  if (dateField === 'experience_date') {
    clauses.push({ experienceDate: { [Op.between]: [startDate, endDate] } });
  } else {
    const sourceDateExpression = fn('DATE', fn('timezone', STORE_TIMEZONE, col('source_received_at')));
    clauses.push(sequelizeWhere(sourceDateExpression, { [Op.between]: [startDate, endDate] }));
  }

  if (clauses.length === 1) {
    Object.assign(where, clauses[0]);
  } else if (clauses.length > 1) {
    Object.assign(where, { [Op.and]: clauses });
  }

  return Booking.findAll({
    where,
    attributes: [
      'id',
      'platform',
      'platformOrderId',
      'platformBookingId',
      'status',
      'experienceDate',
      'sourceReceivedAt',
      'partySizeTotal',
      'partySizeAdults',
      'partySizeChildren',
      'baseAmount',
      'tipAmount',
      'priceGross',
      'priceNet',
      'refundedAmount',
    ],
    order: [
      ['platform', 'ASC'],
      ['experienceDate', 'ASC'],
      ['sourceReceivedAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });
};

const collectOmniData = async (params: CollectOmniParams): Promise<{ orders: OmniOrderAggregate[]; totals: OmniTotals }> => {
  const rows = await loadOmniBookings(params);
  return aggregateOmniRows(rows, params.dateField);
};

const fetchEcwidOrdersForRange = async (
  dateField: SanityDateField,
  startDate: string,
  endDate: string,
): Promise<EcwidOrder[]> => {
  const orders: EcwidOrder[] = [];
  let offset = 0;
  const limit = 100;

  for (;;) {
    const endDateExclusive = dayjs(endDate).add(1, 'day').format(DATE_FORMAT);
    const payload =
      dateField === 'source_received_at'
        ? {
            createdFrom: startDate,
            createdTo: endDateExclusive,
            sortBy: 'createDate:asc',
            offset: String(offset),
            limit: String(limit),
          }
        : {
            pickupFrom: startDate,
            pickupTo: endDateExclusive,
            sortBy: 'pickupTime:asc',
            offset: String(offset),
            limit: String(limit),
          };

    const response = await fetchEcwidOrders(payload);
    const items = Array.isArray(response.items) ? response.items : [];
    orders.push(...items);

    if (items.length < limit) {
      break;
    }

    offset += items.length;
    if (offset > 50000) {
      break;
    }
  }

  return orders;
};

const collectEcwidExternalData = (
  rawOrders: EcwidOrder[],
  dateField: SanityDateField,
  startDate: string,
  endDate: string,
  includeCancelled: boolean,
): { orders: EcwidExternalAggregate[]; totals: OmniTotals } => {
  const transformed = transformEcwidOrders(rawOrders);
  const byOrderId = new Map<
    string,
    {
      peopleFromParticipants: number;
      peopleHybrid: number;
      hasParticipants: boolean;
      hasFallbackOnlyItems: boolean;
      itemCount: number;
      activityDate: string | null;
    }
  >();

  transformed.orders.forEach((order) => {
    const orderId = String(order.platformBookingId ?? '').trim();
    if (!orderId) {
      return;
    }
    const existing = byOrderId.get(orderId) ?? {
      peopleFromParticipants: 0,
      peopleHybrid: 0,
      hasParticipants: false,
      hasFallbackOnlyItems: false,
      itemCount: 0,
      activityDate: null,
    };
    const men = Number.isFinite(order.menCount) ? Math.max(order.menCount, 0) : 0;
    const women = Number.isFinite(order.womenCount) ? Math.max(order.womenCount, 0) : 0;
    const participantCount = men + women;
    const itemQuantity = Number.isFinite(order.quantity) ? Math.max(order.quantity, 0) : 0;
    existing.peopleFromParticipants += participantCount;
    existing.peopleHybrid += participantCount > 0 ? participantCount : itemQuantity;
    if (participantCount > 0) {
      existing.hasParticipants = true;
    } else {
      existing.hasFallbackOnlyItems = true;
    }
    existing.itemCount += 1;
    if (order.date && (!existing.activityDate || order.date < existing.activityDate)) {
      existing.activityDate = order.date;
    }
    byOrderId.set(orderId, existing);
  });
  const rawStatsByOrderId = new Map<string, EcwidRawPeopleStats>();
  rawOrders.forEach((raw) => {
    const rawRecord = raw as EcwidOrder & Record<string, unknown>;
    const orderId = String(rawRecord.id ?? '').trim();
    if (!orderId) {
      return;
    }
    rawStatsByOrderId.set(orderId, resolveRawEcwidPeopleStats(raw));
  });

  const paidStatuses = new Set(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);
  const map = new Map<string, EcwidExternalAggregate>();

  rawOrders.forEach((raw) => {
    const rawRecord = raw as EcwidOrder & Record<string, unknown>;
    const orderId = String(rawRecord.id ?? '').trim();
    if (!orderId) {
      return;
    }

    const paymentStatus = String(rawRecord.paymentStatus ?? '').trim().toUpperCase();
    if (!paidStatuses.has(paymentStatus)) {
      return;
    }
    const fulfillmentStatus = String(
      rawRecord.fulfillmentStatus ?? rawRecord.fulfillmentStatusName ?? '',
    )
      .trim()
      .toUpperCase();
    const ecwidCancelledLike = paymentStatus === 'REFUNDED' || fulfillmentStatus === 'CANCELLED';
    if (!includeCancelled && ecwidCancelledLike) {
      return;
    }

    const transformedEntry = byOrderId.get(orderId);
    const pickupDate = toNormalizedDate(
      typeof rawRecord.pickupTime === 'string' ? rawRecord.pickupTime : null,
    );
    const createDate = toNormalizedDate(
      typeof rawRecord.createDate === 'string' ? rawRecord.createDate : null,
    );

    let effectiveDate: string | null = null;
    let matchSource: EcwidExternalAggregate['matchSource'] = 'create_date';

    if (dateField === 'experience_date') {
      if (transformedEntry?.activityDate) {
        effectiveDate = transformedEntry.activityDate;
        matchSource = 'activity';
      } else if (pickupDate) {
        effectiveDate = pickupDate;
        matchSource = 'pickup_fallback';
      } else {
        effectiveDate = createDate;
        matchSource = 'create_date';
      }
    } else {
      effectiveDate = createDate;
      matchSource = 'create_date';
    }

    if (!isDateInsideRange(effectiveDate, startDate, endDate)) {
      return;
    }

    const items = Array.isArray(rawRecord.items) ? (rawRecord.items as Array<Record<string, unknown>>) : [];
    const fallbackItemCount = items.length > 0 ? items.length : 1;
    const rawStats = rawStatsByOrderId.get(orderId);
    const fallbackPeopleFromQuantity = items.reduce((sum, item) => {
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity)) {
        return sum;
      }
      return sum + Math.max(Math.round(quantity), 0);
    }, 0);
    const transformedPeople = transformedEntry ? Math.max(transformedEntry.peopleHybrid, 0) : 0;
    const rawPeople = rawStats ? Math.max(rawStats.people, 0) : 0;
    const people = Math.max(transformedPeople, rawPeople, Math.max(fallbackPeopleFromQuantity, 0));
    const peopleSource: EcwidExternalAggregate['peopleSource'] =
      transformedEntry?.hasParticipants || rawStats?.peopleSource === 'participants'
        ? 'participants'
        : 'quantity_fallback';
    const bookingCount = Math.max(transformedEntry?.itemCount ?? 0, rawStats?.itemCount ?? 0, fallbackItemCount);
    const revenue = roundCurrency(parseMoneyLikeNumber(rawRecord.total));
    const subtotal = roundCurrency(parseMoneyLikeNumber(rawRecord.subtotal));
    const couponDiscount = roundCurrency(Math.abs(parseMoneyLikeNumber(rawRecord.couponDiscount)));
    const discountAmount = roundCurrency(Math.abs(parseMoneyLikeNumber(rawRecord.discount)));
    const refundedAmount = roundCurrency(Math.abs(parseMoneyLikeNumber(rawRecord.refundedAmount)));
    const extraFields = Array.isArray(rawRecord.orderExtraFields)
      ? (rawRecord.orderExtraFields as Array<Record<string, unknown>>)
      : [];
    const tipsField = extraFields.find((field) => {
      const id = String(field.id ?? '').trim().toLowerCase();
      const name = String(field.name ?? field.title ?? '').trim().toLowerCase();
      return id === 'tips' || name.includes('tip');
    });
    const tipFieldRawValue = String(tipsField?.value ?? '').trim();
    const tipFieldAmount =
      tipFieldRawValue && !tipFieldRawValue.includes('%')
        ? roundCurrency(Math.abs(parseMoneyLikeNumber(tipFieldRawValue)))
        : 0;
    let tipImpact =
      subtotal > 0 || couponDiscount > 0 || discountAmount > 0
        ? roundCurrency(revenue - subtotal + couponDiscount + discountAmount)
        : 0;
    if (Math.abs(tipImpact) <= DEFAULT_TOLERANCE && tipFieldAmount > 0) {
      tipImpact = tipFieldAmount;
    }
    tipImpact = tipImpact > DEFAULT_TOLERANCE ? tipImpact : 0;

    const existing = map.get(orderId);
    if (existing) {
      existing.revenue = Math.max(existing.revenue, revenue);
      existing.subtotal = Math.max(existing.subtotal, subtotal);
      existing.couponDiscount = Math.max(existing.couponDiscount, couponDiscount);
      existing.discountAmount = Math.max(existing.discountAmount, discountAmount);
      existing.tipImpact = Math.max(existing.tipImpact, tipImpact);
      existing.refundedAmount = Math.max(existing.refundedAmount, refundedAmount);
      existing.people = Math.max(existing.people, people);
      existing.bookings = Math.max(existing.bookings, bookingCount);
      if (effectiveDate && (!existing.date || effectiveDate < existing.date)) {
        existing.date = effectiveDate;
      }
      return;
    }

    map.set(orderId, {
      orderId,
      date: effectiveDate,
      matchSource,
      paymentStatus,
      subtotal,
      couponDiscount,
      discountAmount,
      tipImpact,
      refundedAmount,
      revenue,
      people,
      peopleSource,
      bookings: bookingCount,
    });
  });

  const orders = Array.from(map.values()).sort((a, b) => {
    const dateCompare = compareNullableDate(a.date, b.date);
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return a.orderId.localeCompare(b.orderId);
  });

  const totals = orders.reduce<OmniTotals>(
    (acc, row) => {
      acc.bookings += row.bookings;
      acc.orderGroups += 1;
      acc.people += row.people;
      acc.revenue = roundCurrency(acc.revenue + row.revenue);
      return acc;
    },
    {
      bookings: 0,
      orderGroups: 0,
      people: 0,
      revenue: 0,
      baseAmount: 0,
      tipAmount: 0,
      priceGross: 0,
      priceNet: 0,
      refundedAmount: 0,
    },
  );

  return { orders, totals };
};

const resolveEcwidDetailedPeople = async (orderId: string): Promise<number | null> => {
  const normalizedId = String(orderId ?? '').trim();
  if (!normalizedId) {
    return null;
  }
  const order = await getEcwidOrder(normalizedId);
  const transformed = transformEcwidOrders([order]).orders;
  if (transformed.length === 0) {
    return null;
  }
  const people = transformed.reduce((sum, entry) => {
    const men = Number.isFinite(entry.menCount) ? Math.max(entry.menCount, 0) : 0;
    const women = Number.isFinite(entry.womenCount) ? Math.max(entry.womenCount, 0) : 0;
    const participants = men + women;
    const quantity = Number(entry.quantity);
    const quantitySafe = Number.isFinite(quantity) ? Math.max(Math.round(quantity), 0) : 0;
    return sum + (participants > 0 ? participants : quantitySafe);
  }, 0);
  return people > 0 ? people : null;
};

const reconcileEcwidPeopleFromDetails = async (
  omniByKey: Map<string, OmniOrderAggregate>,
  externalByKey: Map<string, EcwidExternalAggregate>,
  externalTotals: OmniTotals,
  tolerance: number,
): Promise<void> => {
  const candidateIds = new Set<string>();

  externalByKey.forEach((externalRow, orderId) => {
    const omniRow = omniByKey.get(orderId);
    if (!omniRow) {
      return;
    }
    if (externalRow.peopleSource !== 'quantity_fallback') {
      return;
    }
    if (externalRow.people > 1) {
      return;
    }
    if (omniRow.people <= externalRow.people) {
      return;
    }
    if (omniRow.bookings !== externalRow.bookings) {
      return;
    }
    const comparable = resolveEcwidComparableOmniRevenue(omniRow, externalRow);
    const revenueDelta = roundCurrency(comparable.value - externalRow.revenue);
    if (Math.abs(revenueDelta) > tolerance) {
      return;
    }
    candidateIds.add(orderId);
  });

  if (candidateIds.size === 0) {
    return;
  }

  for (const orderId of candidateIds) {
    try {
      const detailedPeople = await resolveEcwidDetailedPeople(orderId);
      if (detailedPeople === null || detailedPeople <= 0) {
        continue;
      }
      const externalRow = externalByKey.get(orderId);
      if (!externalRow) {
        continue;
      }
      if (detailedPeople <= externalRow.people) {
        continue;
      }
      externalTotals.people += detailedPeople - externalRow.people;
      externalRow.people = detailedPeople;
      externalRow.peopleSource = 'participants';
    } catch {
      // Non-blocking fallback; keep original list-based people if detail fetch fails.
    }
  }
};

export const reprocessEcwidSanityHints = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as EcwidScopedReprocessBody;
    const rawRows = Array.isArray(body?.rows) ? body.rows : [];
    if (rawRows.length === 0) {
      res.status(400).json({ message: 'rows is required' });
      return;
    }

    const planMap = new Map<string, Set<ScopedReprocessHint>>();
    rawRows.forEach((row) => {
      const orderId = String(row?.orderId ?? '').trim();
      if (!orderId) {
        return;
      }
      const hints = normalizeScopedHints(row?.hints);
      const resolvedHints = hints.length > 0 ? hints : ECWID_CHECK_ORDER;
      const current = planMap.get(orderId) ?? new Set<ScopedReprocessHint>();
      resolvedHints.forEach((hint) => current.add(hint));
      planMap.set(orderId, current);
    });

    const plans = Array.from(planMap.entries()).map(([orderId, hintSet]) => ({
      orderId,
      hints: Array.from(hintSet) as ScopedReprocessHint[],
    }));

    if (plans.length === 0) {
      res.status(400).json({ message: 'No valid order rows provided' });
      return;
    }

    const globalResults: Record<string, number> = {};
    const orderResults: Array<{
      orderId: string;
      hints: ScopedReprocessHint[];
      messageIds: string[];
      messageCount: number;
      results: Record<string, number>;
    }> = [];
    let missingOrders = 0;
    let totalMessages = 0;

    for (const plan of plans) {
      const messageIds = await collectEcwidOrderMessageIds(plan.orderId);
      if (messageIds.length === 0) {
        missingOrders += 1;
        orderResults.push({
          orderId: plan.orderId,
          hints: plan.hints,
          messageIds: [],
          messageCount: 0,
          results: { missing: 1 },
        });
        continue;
      }

      const scopedResults: Record<string, number> = {};
      for (const messageId of messageIds) {
        try {
          const result = await processBookingEmail(messageId, {
            force: true,
            scopedHints: plan.hints,
          });
          scopedResults[result] = (scopedResults[result] ?? 0) + 1;
          globalResults[result] = (globalResults[result] ?? 0) + 1;
        } catch (error) {
          scopedResults.failed = (scopedResults.failed ?? 0) + 1;
          globalResults.failed = (globalResults.failed ?? 0) + 1;
        }
      }

      totalMessages += messageIds.length;
      orderResults.push({
        orderId: plan.orderId,
        hints: plan.hints,
        messageIds,
        messageCount: messageIds.length,
        results: scopedResults,
      });
    }

    res.status(200).json({
      ordersRequested: plans.length,
      ordersMissing: missingOrders,
      messageCount: totalMessages,
      results: globalResults,
      orders: orderResults,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run scoped Ecwid reprocess';
    res.status(500).json({ message });
  }
};

type EcwidFixResult = {
  orderId: string;
  message: string;
  totals: {
    ecwidGross: number;
    ecwidNet: number;
    ecwidDiscount: number;
    ecwidTip: number;
  };
  updatedBookingIds: number[];
  createdBookingIds: number[];
  cancelledBookingIds: number[];
};

const runEcwidOrderFixFromSource = async (inputOrderId: string, actorId: number | null): Promise<EcwidFixResult> => {
  const orderId = inputOrderId.replace(/-\d+$/, '');
  const ecwidOrder = await getEcwidOrder(orderId);
  const rawOrder = ecwidOrder as EcwidOrder & Record<string, unknown>;
  const rawItems = Array.isArray(rawOrder.items) ? (rawOrder.items as Array<Record<string, unknown>>) : [];
  if (rawItems.length === 0) {
    throw new Error('Ecwid order has no items to sync');
  }

  const transformedItems = transformEcwidOrders([ecwidOrder]).orders;
  const transformedBuckets = new Map<string, typeof transformedItems>();
  transformedItems.forEach((entry, index) => {
    const rawItem = (entry.rawData as Record<string, unknown> | null | undefined)?.order
      ? ((entry.rawData as Record<string, unknown>).item as Record<string, unknown> | undefined)
      : ((entry.rawData as Record<string, unknown> | undefined)?.item as Record<string, unknown> | undefined);
    const key = String(rawItem?.id ?? rawItem?.productId ?? index);
    const bucket = transformedBuckets.get(key) ?? [];
    bucket.push(entry);
    transformedBuckets.set(key, bucket);
  });

  const aliases = await ProductAlias.findAll({
    where: { active: true },
    order: [
      ['priority', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  const quantityByIndex = rawItems.map((item) => {
    const quantity = Number(item.quantity);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  });

  const grossByIndex = rawItems.map((item, index) => {
    const quantity = quantityByIndex[index];
    const price = parseMoneyLikeNumber(item.price ?? item.productPrice);
    let gross = roundCurrency(price * quantity);
    if (gross <= 0) {
      gross = roundCurrency(parseMoneyLikeNumber(item.subtotal ?? item.total));
    }
    return gross;
  });

  const orderGrossRaw = roundCurrency(parseMoneyLikeNumber(rawOrder.subtotal));
  const fallbackGross = roundCurrency(grossByIndex.reduce((sum, value) => sum + value, 0));
  const orderGross = orderGrossRaw > 0 ? orderGrossRaw : fallbackGross;
  const orderTotal = roundCurrency(parseMoneyLikeNumber(rawOrder.total));
  let discountTotal = roundCurrency(
    Math.abs(parseMoneyLikeNumber(rawOrder.discount)) + Math.abs(parseMoneyLikeNumber(rawOrder.couponDiscount)),
  );
  if (discountTotal <= 0 && orderGross > orderTotal) {
    discountTotal = roundCurrency(orderGross - orderTotal);
  }
  const tipTotal = Math.max(roundCurrency(orderTotal - orderGross + discountTotal), 0);
  const refundedTotal = roundCurrency(Math.abs(parseMoneyLikeNumber(rawOrder.refundedAmount)));

  const weights = grossByIndex.map((gross, index) => (gross > 0 ? gross : quantityByIndex[index]));
  const grossShares = splitByWeights(orderGross > 0 ? orderGross : Math.max(orderTotal, 0), weights);
  const discountShares = splitByWeights(discountTotal, weights);
  const tipShares = splitByWeights(tipTotal, weights);
  const refundedShares = splitByWeights(refundedTotal, weights);

  const paymentStatusRaw = String(rawOrder.paymentStatus ?? '').trim().toUpperCase();
  const omniPaymentStatus =
    paymentStatusRaw === 'PAID'
      ? 'paid'
      : paymentStatusRaw === 'PARTIALLY_REFUNDED'
        ? 'partial'
        : paymentStatusRaw === 'REFUNDED'
          ? 'refunded'
          : 'unknown';
  const omniStatus = paymentStatusRaw === 'REFUNDED' ? 'cancelled' : 'confirmed';
  const currency = String(rawOrder.currency ?? 'PLN')
    .trim()
    .toUpperCase() || 'PLN';
  const discountCode = String(rawOrder.couponName ?? rawOrder.couponCode ?? '').trim() || null;

  const now = new Date();
  const orderCreatedAtRaw = String(rawOrder.createDate ?? '').trim();
  const orderCreatedAt = orderCreatedAtRaw && dayjs(orderCreatedAtRaw).isValid() ? dayjs(orderCreatedAtRaw).toDate() : now;

  const existingBookings = await Booking.findAll({
    where: {
      platform: 'ecwid',
      [Op.or]: [
        { platformOrderId: orderId },
        { platformBookingId: orderId },
        { platformBookingId: { [Op.like]: `${orderId}-%` } },
      ],
    },
    order: [['id', 'ASC']],
  });

  const updatedBookingIds: number[] = [];
  const createdBookingIds: number[] = [];
  const cancelledBookingIds: number[] = [];

  await sequelize.transaction(async (transaction) => {
    for (let index = 0; index < rawItems.length; index += 1) {
      const rawItem = rawItems[index];
      const itemKey = String(rawItem.id ?? rawItem.productId ?? index);
      const bucket = transformedBuckets.get(itemKey) ?? [];
      const transformed = bucket.length > 0 ? bucket.shift() ?? null : transformedItems[index] ?? null;
      transformedBuckets.set(itemKey, bucket);

      const itemName = String(rawItem.name ?? transformed?.productName ?? '').trim();
      const resolvedProductId = itemName ? resolveAliasProductId(aliases, itemName) : null;
      const itemVariant = formatEcwidItemVariant(rawItem);
      const peopleRaw = Number(transformed?.quantity ?? quantityByIndex[index] ?? 0);
      const people = Number.isFinite(peopleRaw) ? Math.max(Math.round(peopleRaw), 0) : 0;
      const experienceDate = transformed?.date ?? existingBookings[index]?.experienceDate ?? null;
      const timeslot = transformed?.timeslot ?? null;
      const experienceStartAt =
        experienceDate && timeslot && /^\d{2}:\d{2}$/.test(timeslot)
          ? dayjs.tz(`${experienceDate} ${timeslot}`, 'YYYY-MM-DD HH:mm', STORE_TIMEZONE).toDate()
          : experienceDate
            ? dayjs.tz(`${experienceDate} 00:00`, 'YYYY-MM-DD HH:mm', STORE_TIMEZONE).toDate()
            : null;
      const gross = roundCurrency(grossShares[index] ?? 0);
      const discountAmount = roundCurrency(discountShares[index] ?? 0);
      const tipAmount = roundCurrency(tipShares[index] ?? 0);
      const refundedAmount = roundCurrency(refundedShares[index] ?? 0);
      const baseAmount = roundCurrency(gross - discountAmount);
      const platformBookingId = index === 0 ? orderId : `${orderId}-${index + 1}`;
      const extras = transformed?.extras ?? null;
      const addonsSnapshot = extras ? { extras } : null;

      const booking = existingBookings[index] ?? Booking.build();
      const isNew = !existingBookings[index];

      if (isNew) {
        booking.platform = 'ecwid';
        booking.platformBookingId = platformBookingId;
        booking.platformOrderId = orderId;
        booking.status = 'confirmed';
        booking.paymentStatus = 'unknown';
        booking.statusChangedAt = now;
        booking.sourceReceivedAt = orderCreatedAt;
        booking.createdBy = actorId;
      }

      booking.platformBookingId = platformBookingId;
      booking.platformOrderId = orderId;
      booking.status = omniStatus;
      booking.paymentStatus = omniPaymentStatus;
      booking.statusChangedAt = now;
      booking.cancelledAt = omniStatus === 'cancelled' ? now : null;
      booking.productName = itemName || booking.productName;
      booking.productVariant = itemVariant;
      booking.productId = resolvedProductId;
      booking.partySizeTotal = people;
      booking.partySizeAdults = people;
      booking.partySizeChildren = 0;
      booking.experienceDate = experienceDate;
      if (experienceStartAt && !Number.isNaN(experienceStartAt.getTime())) {
        booking.experienceStartAt = experienceStartAt;
      }
      booking.currency = currency;
      booking.priceGross = gross > 0 ? gross.toFixed(2) : '0.00';
      booking.discountAmount = discountAmount > 0 ? discountAmount.toFixed(2) : null;
      booking.discountCode = discountCode;
      booking.tipAmount = tipAmount > 0 ? tipAmount.toFixed(2) : null;
      booking.baseAmount = baseAmount > 0 ? baseAmount.toFixed(2) : '0.00';
      booking.priceNet = baseAmount > 0 ? baseAmount.toFixed(2) : '0.00';
      booking.refundedAmount = refundedAmount > 0 ? refundedAmount.toFixed(2) : null;
      booking.refundedCurrency = refundedAmount > 0 ? currency : null;
      booking.addonsSnapshot = addonsSnapshot;
      booking.processedAt = now;
      booking.updatedBy = actorId;

      await booking.save({ transaction });

      if (isNew) {
        createdBookingIds.push(Number(booking.id));
      } else {
        updatedBookingIds.push(Number(booking.id));
      }
    }

    for (let index = rawItems.length; index < existingBookings.length; index += 1) {
      const booking = existingBookings[index];
      booking.status = 'cancelled';
      booking.cancelledAt = now;
      booking.statusChangedAt = now;
      booking.partySizeTotal = 0;
      booking.partySizeAdults = 0;
      booking.partySizeChildren = 0;
      booking.baseAmount = '0.00';
      booking.priceGross = '0.00';
      booking.priceNet = '0.00';
      booking.tipAmount = null;
      booking.discountAmount = null;
      booking.refundedAmount = null;
      booking.refundedCurrency = null;
      booking.updatedBy = actorId;
      await booking.save({ transaction });
      cancelledBookingIds.push(Number(booking.id));
    }
  });

  return {
    orderId,
    message: 'Ecwid order synchronized into Omni bookings',
    totals: {
      ecwidGross: orderGross,
      ecwidNet: orderTotal,
      ecwidDiscount: discountTotal,
      ecwidTip: tipTotal,
    },
    updatedBookingIds,
    createdBookingIds,
    cancelledBookingIds,
  };
};

export const fixEcwidOrderFromSource = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as EcwidFixOrderBody;
    const inputOrderId = String(body?.orderId ?? '').trim();
    if (!inputOrderId) {
      res.status(400).json({ message: 'orderId is required' });
      return;
    }
    const actorIdRaw = Number((req as any)?.authContext?.id ?? (req as any)?.user?.id);
    const actorId = Number.isFinite(actorIdRaw) && actorIdRaw > 0 ? actorIdRaw : null;
    const result = await runEcwidOrderFixFromSource(inputOrderId, actorId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fix Ecwid order from source';
    res.status(500).json({ message });
  }
};

export const fixEcwidOrdersFromSourceBulk = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as EcwidFixOrdersBody;
    const inputOrderIds = Array.isArray(body?.orderIds) ? body.orderIds : [];
    const orderIds = Array.from(
      new Set(
        inputOrderIds
          .map((value) => String(value ?? '').trim())
          .filter((value) => value.length > 0),
      ),
    );
    if (orderIds.length === 0) {
      res.status(400).json({ message: 'orderIds is required' });
      return;
    }

    const actorIdRaw = Number((req as any)?.authContext?.id ?? (req as any)?.user?.id);
    const actorId = Number.isFinite(actorIdRaw) && actorIdRaw > 0 ? actorIdRaw : null;

    const results: Array<{ orderId: string; status: 'ok' | 'failed'; result?: EcwidFixResult; error?: string }> = [];
    let fixed = 0;
    let failed = 0;

    for (const orderId of orderIds) {
      try {
        const result = await runEcwidOrderFixFromSource(orderId, actorId);
        results.push({ orderId: result.orderId, status: 'ok', result });
        fixed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fix Ecwid order';
        results.push({ orderId, status: 'failed', error: message });
        failed += 1;
      }
    }

    res.status(200).json({
      requested: orderIds.length,
      fixed,
      failed,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to bulk fix Ecwid orders from source';
    res.status(500).json({ message });
  }
};

export const getSanityCheckOmniSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query as SanityCheckQueryParams;
    const { startDate, endDate } = resolveDateRange(query);
    const dateField = resolveDateField(query.dateField);
    const includeCancelled = parseBooleanFlag(query.includeCancelled, false);
    const includeBreakdown = parseBooleanFlag(query.includeBreakdown, false);
    const platformFilter = typeof query.platform === 'string' ? query.platform.trim().toLowerCase() : '';

    if (platformFilter) {
      const omni = await collectOmniData({
        startDate,
        endDate,
        dateField,
        platform: platformFilter,
        includeCancelled,
      });

      res.status(200).json({
        window: {
          startDate,
          endDate,
          dateField,
        },
        platform: platformFilter,
        includeCancelled,
        totals: omni.totals,
        orders: includeBreakdown ? omni.orders : undefined,
      });
      return;
    }

    const rows = await loadOmniBookings({
      startDate,
      endDate,
      dateField,
      includeCancelled,
    });

    const buckets = new Map<string, Booking[]>();
    rows.forEach((row) => {
      const key = typeof row.platform === 'string' && row.platform.trim() ? row.platform.trim() : 'unknown';
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    });

    const summaries: OmniPlatformSummary[] = Array.from(buckets.entries())
      .map(([platform, platformRows]) => ({
        platform,
        totals: aggregateOmniRows(platformRows, dateField).totals,
      }))
      .sort((a, b) => a.platform.localeCompare(b.platform));

    res.status(200).json({
      window: {
        startDate,
        endDate,
        dateField,
      },
      includeCancelled,
      platforms: summaries,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load sanity-check summary';
    res.status(500).json({ message });
  }
};

export const getSanityCheckEcwidComparison = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query as SanityCheckQueryParams;
    const { startDate, endDate } = resolveDateRange(query);
    const dateField = resolveDateField(query.dateField);
    const includeCancelled = parseBooleanFlag(query.includeCancelled, false);
    const tolerance = parseTolerance(query.tolerance);

    const [omni, ecwidRawOrders] = await Promise.all([
      collectOmniData({
        startDate,
        endDate,
        dateField,
        platform: 'ecwid',
        includeCancelled,
      }),
      fetchEcwidOrdersForRange(dateField, startDate, endDate),
    ]);

    const external = collectEcwidExternalData(ecwidRawOrders, dateField, startDate, endDate, includeCancelled);

    const omniByKey = new Map<string, OmniOrderAggregate>();
    omni.orders.forEach((row) => {
      omniByKey.set(row.orderKey, row);
    });

    const externalByKey = new Map<string, EcwidExternalAggregate>();
    external.orders.forEach((row) => {
      externalByKey.set(row.orderId, row);
    });

    await reconcileEcwidPeopleFromDetails(omniByKey, externalByKey, external.totals, tolerance);

    const allKeys = new Set<string>([...omniByKey.keys(), ...externalByKey.keys()]);
    const mismatches: EcwidMismatch[] = [];
    let omniComparableRevenueTotal = 0;

    allKeys.forEach((key) => {
      const omniRow = omniByKey.get(key);
      const externalRow = externalByKey.get(key);

      if (omniRow && !externalRow) {
        omniComparableRevenueTotal = roundCurrency(omniComparableRevenueTotal + omniRow.revenue);
        mismatches.push({
          reason: 'only_omni',
          orderId: key,
          omniRevenue: omniRow.revenue,
          externalRevenue: 0,
          deltaRevenue: omniRow.revenue,
          omniPeople: omniRow.people,
          externalPeople: 0,
          deltaPeople: omniRow.people,
          omniBookings: omniRow.bookings,
          externalBookings: 0,
          omniFirstDate: omniRow.firstDate,
          omniLastDate: omniRow.lastDate,
          externalDate: null,
          externalPaymentStatus: null,
          externalMatchSource: null,
          diagnosis: buildEcwidMissingDiagnosis('only_omni', undefined, omniRow),
        });
        return;
      }

      if (!omniRow && externalRow) {
        mismatches.push({
          reason: 'only_external',
          orderId: key,
          omniRevenue: 0,
          externalRevenue: externalRow.revenue,
          deltaRevenue: roundCurrency(-externalRow.revenue),
          omniPeople: 0,
          externalPeople: externalRow.people,
          deltaPeople: -externalRow.people,
          omniBookings: 0,
          externalBookings: externalRow.bookings,
          omniFirstDate: null,
          omniLastDate: null,
          externalDate: externalRow.date,
          externalPaymentStatus: externalRow.paymentStatus,
          externalMatchSource: externalRow.matchSource,
          diagnosis: buildEcwidMissingDiagnosis('only_external', externalRow),
        });
        return;
      }

      if (!omniRow || !externalRow) {
        return;
      }

      const omniComparableRevenue = resolveEcwidComparableOmniRevenue(omniRow, externalRow);
      omniComparableRevenueTotal = roundCurrency(omniComparableRevenueTotal + omniComparableRevenue.value);
      const normalizedExternalPeople =
        omniRow.people === 0 && externalRow.peopleSource === 'quantity_fallback' ? 0 : externalRow.people;
      const deltaRevenue = roundCurrency(omniComparableRevenue.value - externalRow.revenue);
      const deltaPeople = omniRow.people - normalizedExternalPeople;
      const deltaBookings = omniRow.bookings - externalRow.bookings;
      const revenueMismatch = Math.abs(deltaRevenue) > tolerance;
      const peopleMismatch = deltaPeople !== 0;
      const bookingsMismatch = deltaBookings !== 0;

      if (!revenueMismatch && !peopleMismatch && !bookingsMismatch) {
        return;
      }

      mismatches.push({
        reason: 'mismatch',
        orderId: key,
        omniRevenue: omniComparableRevenue.value,
        externalRevenue: externalRow.revenue,
        deltaRevenue,
        omniPeople: omniRow.people,
        externalPeople: normalizedExternalPeople,
        deltaPeople,
        omniBookings: omniRow.bookings,
        externalBookings: externalRow.bookings,
        omniFirstDate: omniRow.firstDate,
        omniLastDate: omniRow.lastDate,
        externalDate: externalRow.date,
        externalPaymentStatus: externalRow.paymentStatus,
        externalMatchSource: externalRow.matchSource,
        diagnosis: buildEcwidMismatchDiagnosis(deltaRevenue, tolerance, externalRow, omniComparableRevenue, omniRow),
      });
    });

    mismatches.sort((a, b) => {
      const revenueDeltaCompare = Math.abs(b.deltaRevenue) - Math.abs(a.deltaRevenue);
      if (revenueDeltaCompare !== 0) {
        return revenueDeltaCompare;
      }
      const peopleDeltaCompare = Math.abs(b.deltaPeople) - Math.abs(a.deltaPeople);
      if (peopleDeltaCompare !== 0) {
        return peopleDeltaCompare;
      }
      return a.orderId.localeCompare(b.orderId);
    });

    const mismatchCounts = mismatches.reduce(
      (acc, row) => {
        acc[row.reason] += 1;
        return acc;
      },
      { only_omni: 0, only_external: 0, mismatch: 0 },
    );
    const diagnostics = summarizeEcwidDiagnostics(mismatches);

    const omniTotalsForComparison: OmniTotals = {
      ...omni.totals,
      revenue: roundCurrency(omniComparableRevenueTotal),
    };

    res.status(200).json({
      window: {
        startDate,
        endDate,
        dateField,
      },
      includeCancelled,
      tolerance,
      omniTotals: omniTotalsForComparison,
      omniTotalsRaw: omni.totals,
      externalTotals: external.totals,
      totals: {
        gapRevenue: roundCurrency(omniTotalsForComparison.revenue - external.totals.revenue),
        gapPeople: omni.totals.people - external.totals.people,
        gapBookings: omni.totals.bookings - external.totals.bookings,
      },
      mismatchCounts,
      diagnostics,
      passed: mismatches.length === 0,
      mismatches,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run Ecwid sanity-check';
    res.status(500).json({ message });
  }
};
