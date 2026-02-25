import { Request, Response } from 'express';
import { isAxiosError } from 'axios';
import { Op, type WhereOptions, fn, col, where as sequelizeWhere } from 'sequelize';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import Booking from '../models/Booking.js';
import BookingEmail from '../models/BookingEmail.js';
import BookingAddon from '../models/BookingAddon.js';
import BookingEvent from '../models/BookingEvent.js';
import Channel from '../models/Channel.js';
import Guest from '../models/Guest.js';
import Addon from '../models/Addon.js';
import Product from '../models/Product.js';
import ProductAlias from '../models/ProductAlias.js';
import ProductAddon from '../models/ProductAddon.js';
import HttpError from '../errors/HttpError.js';
import { getStripeClient } from '../finance/services/stripeClient.js';
import type Stripe from 'stripe';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  canonicalizeProductKeyFromLabel,
  canonicalizeProductKeyFromSources,
  canonicalizeProductLabelFromSources,
  sanitizeProductSource,
} from '../utils/productName.js';
import {
  ingestAllBookingEmails,
  ingestLatestBookingEmails,
  processBookingEmail,
} from '../services/bookings/bookingIngestionService.js';
import logger from '../utils/logger.js';
import type {
  UnifiedOrder,
  UnifiedProduct,
  ManifestGroup,
  OrderExtras,
  PlatformBreakdownEntry,
} from '../types/booking.js';
import { groupOrdersForManifest, transformEcwidOrders } from '../utils/ecwidAdapter.js';
import {
  BOOKING_ATTENDANCE_STATUSES,
  BOOKING_STATUSES,
  type BookingAttendanceStatus,
  type BookingStatus,
} from '../constants/bookings.js';
import { getEcwidOrder, updateEcwidOrder, type EcwidExtraField, type EcwidOrder } from '../services/ecwidService.js';
import { getConfigValue } from '../services/configService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const DATE_FORMAT = 'YYYY-MM-DD';
const DISPLAY_TIMEZONE = 'Europe/Warsaw';
const STORE_TIMEZONE = 'Europe/Warsaw';
const AFTER_CUTOFF_TIME = '21:00:00';
const CHECKIN_ALLOWED_STATUSES = new Set<BookingStatus>(['pending', 'confirmed', 'amended', 'completed']);
const DEFAULT_ATTENDANCE_STATUS: BookingAttendanceStatus = 'pending';

type RangeBoundary = 'start' | 'end';

type QueryParams = {
  date?: string;
  pickupFrom?: string;
  pickupTo?: string;
  productId?: string;
  time?: string;
  search?: string;
};

type UpdateBookingAttendanceBody = {
  attendedTotal?: unknown;
  attendedExtras?: Partial<Record<keyof OrderExtras, unknown>>;
};

type UpdateBulkBookingAttendanceBody = {
  updates?: Array<
    {
      bookingId?: unknown;
    } & UpdateBookingAttendanceBody
  >;
};

type BookingAttendanceUpdateResponse = {
  bookingId: number;
  allowance: number;
  attendedTotal: number;
  attendedExtras: OrderExtras;
  attendanceStatus: BookingAttendanceStatus;
  remainingTotal: number;
  order: UnifiedOrder | null;
};

type BookingAttendanceBulkUpdateResult =
  | BookingAttendanceUpdateResponse
  | {
      bookingId: number | null;
      error: string;
    };

type AmendEcwidRequestBody = {
  pickupDate?: string;
  pickupTime?: string;
};

type ReconcileEcwidRequestBody = {
  itemIndex?: number;
};

type EcwidAmendPreviewStatus = 'matched' | 'order_missing' | 'product_missing';

type EcwidAmendPreviewItem = {
  name: string | null;
  quantity: number | null;
  pickupTime: string | null;
  options: string[];
  matched?: boolean;
  matchedBookingNames?: string[];
};

const normalizeDate = (value?: string, boundary: RangeBoundary = 'start'): string | null => {
  if (!value) {
    return null;
  }

  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return null;
  }

  const normalized = boundary === 'start' ? parsed.startOf('day') : parsed.endOf('day');
  return normalized.format(DATE_FORMAT);
};

const resolveRange = (query: QueryParams): { start: string | null; end: string | null } => {
  const base = query.date;
  const startCandidate = base ?? query.pickupFrom;
  const endCandidate = base ?? query.pickupTo;

  const start = normalizeDate(startCandidate, 'start');
  const end = normalizeDate(endCandidate ?? startCandidate ?? base ?? undefined, 'end');

  if (start && !end) {
    return { start, end: start };
  }
  if (!start && end) {
    return { start: end, end };
  }
  return { start, end };
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
      } catch (error) {
        logger.warn(`Invalid product alias regex: ${alias.label}`, error);
      }
    }
  }
  return null;
};

const stripEcwidItemSuffix = (value: string): string => value.replace(/-\d+$/, '');

const extractEcwidItemOptions = (item: EcwidOrder['items'][number] | undefined): string[] => {
  if (!item) {
    return [];
  }

  const results: string[] = [];

  (item.selectedOptions ?? []).forEach((entry) => {
    const value = entry.selectionTitle ?? entry.value ?? entry.name;
    if (value !== null && value !== undefined) {
      const normalized = String(value).trim();
      if (normalized) {
        results.push(normalized);
      }
    }
  });

  (item.options ?? []).forEach((entry) => {
    if (entry.selections && entry.selections.length > 0) {
      entry.selections.forEach((selection) => {
        const value = selection.selectionTitle ?? selection.value ?? selection.name;
        if (value !== null && value !== undefined) {
          const normalized = String(value).trim();
          if (normalized) {
            results.push(normalized);
          }
        }
      });
      return;
    }
    const value = entry.value ?? entry.name;
    if (value !== null && value !== undefined) {
      const normalized = String(value).trim();
      if (normalized) {
        results.push(normalized);
      }
    }
  });

  return results;
};

type BookingEmailQueryParams = QueryParams & {
  limit?: string;
  offset?: string;
  includeTotal?: string;
  search?: string;
  subject?: string;
  from?: string;
  to?: string;
  status?: string;
  messageId?: string;
  threadId?: string;
};

type BulkEmailReprocessBody = {
  messageIds?: string[];
  pickupFrom?: string;
  pickupTo?: string;
  limit?: number;
};

type BackfillEmailRequestBody = {
  pickupFrom?: string;
  pickupTo?: string;
  batchSize?: number;
  query?: string;
};

type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  body?: { size?: number; data?: string | null };
  parts?: GmailMessagePart[];
};

type StoredGmailMessage = {
  payload?: GmailMessagePart;
};

const EMAIL_DEFAULT_LIMIT = 50;
const EMAIL_MAX_LIMIT = 1000;
const FALLBACK_BOOKING_QUERY =
  '(subject:(booking OR reservation OR "new order" OR "booking detail change" OR rebooked) OR from:(ecwid.com OR fareharbor.com OR viator.com OR getyourguide.com OR xperiencepoland.com OR airbnb.com OR airbnbmail.com))';

const resolveBookingQuery = (): string =>
  (getConfigValue('BOOKING_GMAIL_QUERY') as string) ?? FALLBACK_BOOKING_QUERY;

const clampEmailLimit = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return EMAIL_DEFAULT_LIMIT;
  }
  return Math.min(parsed, EMAIL_MAX_LIMIT);
};

const parseEmailOffset = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
};

const parseEmailLimitParam = (value: unknown, fallback: number): number => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, EMAIL_MAX_LIMIT);
};

const resolveEmailRange = (query: QueryParams): { start: Date | null; end: Date | null } => {
  const { start, end } = resolveRange(query);
  const startMoment = start ? dayjs(start).startOf('day') : null;
  const endMoment = end ? dayjs(end).endOf('day') : null;
  return {
    start: startMoment?.isValid() ? startMoment.toDate() : null,
    end: endMoment?.isValid() ? endMoment.toDate() : null,
  };
};

const hasWhereConditions = (where: WhereOptions): boolean => {
  return Object.keys(where).length > 0 || Object.getOwnPropertySymbols(where).length > 0;
};

const buildBookingEmailRangeWhere = (start: Date | null, end: Date | null): WhereOptions => {
  if (start && end) {
    return {
      [Op.or]: [
        { receivedAt: { [Op.between]: [start, end] } },
        { receivedAt: null, internalDate: { [Op.between]: [start, end] } },
      ],
    };
  }
  if (start) {
    return {
      [Op.or]: [
        { receivedAt: { [Op.gte]: start } },
        { receivedAt: null, internalDate: { [Op.gte]: start } },
      ],
    };
  }
  if (end) {
    return {
      [Op.or]: [
        { receivedAt: { [Op.lte]: end } },
        { receivedAt: null, internalDate: { [Op.lte]: end } },
      ],
    };
  }
  return {};
};

const normalizeEmailFilterValue = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildEmailLikeValue = (value: string): string => `%${escapeSearchTerm(value)}%`;

const buildBookingEmailFilterWhere = (query: BookingEmailQueryParams): WhereOptions => {
  const clauses: WhereOptions[] = [];

  const status = normalizeEmailFilterValue(query.status ?? null);
  if (status) {
    clauses.push({ ingestionStatus: status.toLowerCase() });
  }

  const messageId = normalizeEmailFilterValue(query.messageId ?? null);
  if (messageId) {
    clauses.push({ messageId: { [Op.iLike]: buildEmailLikeValue(messageId) } });
  }

  const threadId = normalizeEmailFilterValue(query.threadId ?? null);
  if (threadId) {
    clauses.push({ threadId: { [Op.iLike]: buildEmailLikeValue(threadId) } });
  }

  const subject = normalizeEmailFilterValue(query.subject ?? null);
  if (subject) {
    clauses.push({ subject: { [Op.iLike]: buildEmailLikeValue(subject) } });
  }

  const from = normalizeEmailFilterValue(query.from ?? null);
  if (from) {
    clauses.push({ fromAddress: { [Op.iLike]: buildEmailLikeValue(from) } });
  }

  const to = normalizeEmailFilterValue(query.to ?? null);
  if (to) {
    clauses.push({ toAddresses: { [Op.iLike]: buildEmailLikeValue(to) } });
  }

  const search = normalizeEmailFilterValue(query.search ?? null);
  if (search) {
    const likeValue = buildEmailLikeValue(search);
    clauses.push({
      [Op.or]: [
        { messageId: { [Op.iLike]: likeValue } },
        { subject: { [Op.iLike]: likeValue } },
        { fromAddress: { [Op.iLike]: likeValue } },
        { toAddresses: { [Op.iLike]: likeValue } },
        { snippet: { [Op.iLike]: likeValue } },
      ],
    });
  }

  if (clauses.length === 0) {
    return {};
  }
  if (clauses.length === 1) {
    return clauses[0];
  }
  return { [Op.and]: clauses };
};

const mergeBookingEmailWhere = (base: WhereOptions, extra: WhereOptions): WhereOptions => {
  const baseHasConditions = hasWhereConditions(base);
  const extraHasConditions = hasWhereConditions(extra);
  if (baseHasConditions && extraHasConditions) {
    return { [Op.and]: [base, extra] };
  }
  if (baseHasConditions) {
    return base;
  }
  if (extraHasConditions) {
    return extra;
  }
  return {};
};

const decodeBase64Url = (input: string): string => {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : normalized + '='.repeat(4 - padding);
  return Buffer.from(padded, 'base64').toString('utf-8');
};

const stripHtmlToText = (html: string): string => {
  if (!html) {
    return '';
  }
  const withoutBlocks = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|li|tr|td)>/gi, '$&\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return withoutBlocks.replace(/\s+/g, ' ').trim();
};

const collectMessageBodies = (
  payload?: GmailMessagePart,
): { textBody: string | null; htmlBody: string | null } => {
  if (!payload) {
    return { textBody: null, htmlBody: null };
  }
  const texts: string[] = [];
  const htmls: string[] = [];

  const traverse = (part?: GmailMessagePart): void => {
    if (!part) {
      return;
    }
    const data = part.body?.data;
    if (data && part.mimeType) {
      const decoded = decodeBase64Url(data);
      if (part.mimeType.startsWith('text/plain')) {
        texts.push(decoded);
      } else if (part.mimeType.startsWith('text/html')) {
        htmls.push(decoded);
      }
    }
    if (part.parts) {
      for (const child of part.parts) {
        traverse(child);
      }
    }
  };

  traverse(payload);
  return {
    textBody: texts.length > 0 ? texts.join('\n') : null,
    htmlBody: htmls.length > 0 ? htmls.join('\n') : null,
  };
};

const parsePickupMoment = (pickupDate: string, pickupTime: string): dayjs.Dayjs | null => {
  const safeDate = pickupDate?.trim();
  const safeTime = pickupTime?.trim();
  if (!safeDate || !safeTime) {
    return null;
  }

  const patterns = ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD H:mm'];
  for (const pattern of patterns) {
    const candidate = dayjs.tz(`${safeDate} ${safeTime}`, pattern, STORE_TIMEZONE);
    if (candidate.isValid()) {
      return candidate;
    }
  }
  return null;
};

const buildPickupExtraFieldPayload = (
  fields: EcwidExtraField[] | undefined,
  nextValue: string,
): EcwidExtraField => {
  const template =
    fields?.find((field) => field?.id === 'ecwid_order_pickup_time' || field?.name === 'ecwid_order_pickup_time') ??
    null;

  if (!template) {
    return {
      id: 'ecwid_order_pickup_time',
      value: nextValue,
      customerInputType: 'DATETIME',
      title: 'Pickup date and time',
      orderDetailsDisplaySection: 'shipping_info',
      orderBy: '0',
    };
  }

  return {
    ...template,
    value: nextValue,
    customerInputType: template.customerInputType ?? 'DATETIME',
    title: template.title ?? template.name ?? 'Pickup date and time',
    orderDetailsDisplaySection: template.orderDetailsDisplaySection ?? 'shipping_info',
    orderBy: template.orderBy ?? '0',
  };
};

const canonicalizeProductKey = (booking: Booking): string | null => {
  const label = prettifyProductName(booking);
  const labelKey = canonicalizeProductKeyFromLabel(label ?? null);
  if (labelKey) {
    return labelKey;
  }
  const sources = [
    label,
    booking.product?.name ?? null,
    booking.productName ?? null,
    booking.productVariant ?? null,
  ];
  return canonicalizeProductKeyFromSources(sources);
};

const prettifyProductName = (booking: Booking): string | null => {
  const directName = booking.product?.name ?? null;
  if (directName && directName.trim().length > 0) {
    return directName.trim();
  }
  const sources = [booking.productName ?? null, booking.productVariant ?? null];
  return canonicalizeProductLabelFromSources(sources);
};

const deriveProductId = (booking: Booking): string => {
  const canonicalKey = canonicalizeProductKey(booking);
  if (canonicalKey) {
    return canonicalKey;
  }

  if (booking.productId) {
    return String(booking.productId);
  }

  return `${booking.platform}-${booking.id}`;
};

const escapeSearchTerm = (input: string): string =>
  input.replace(/[%_]/g, (match) => `\\${match}`);

const buildSearchWhere = (term: string): WhereOptions => {
  const safeTerm = escapeSearchTerm(term);
  const likeValue = `%${safeTerm}%`;
  return {
    [Op.or]: [
      { platformBookingId: { [Op.iLike]: likeValue } },
      { guestPhone: { [Op.iLike]: likeValue } },
      { guestEmail: { [Op.iLike]: likeValue } },
      { guestFirstName: { [Op.iLike]: likeValue } },
      { guestLastName: { [Op.iLike]: likeValue } },
      sequelizeWhere(fn('concat_ws', ' ', col('guest_first_name'), col('guest_last_name')), {
        [Op.iLike]: likeValue,
      }),
    ],
  };
};

const buildCustomerName = (booking: Booking): string => {
  const nameParts = [booking.guestFirstName, booking.guestLastName].filter(Boolean);
  if (nameParts.length > 0) {
    return nameParts.join(' ');
  }
  if (booking.guestEmail) {
    return booking.guestEmail;
  }
  if (booking.guestPhone) {
    return booking.guestPhone;
  }
  return `Booking #${booking.id}`;
};

const splitCustomerName = (value?: string | null): { firstName: string | null; lastName: string | null } => {
  if (!value) {
    return { firstName: null, lastName: null };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { firstName: null, lastName: null };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
};

const resolveChannelIdByName = async (name: string): Promise<number | null> => {
  const channel = await Channel.findOne({
    where: { name: { [Op.iLike]: name } },
    attributes: ['id'],
  });
  return channel?.id ?? null;
};

const resolveProductIdByName = async (name?: string | null): Promise<number | null> => {
  if (!name) {
    return null;
  }
  const canonical = canonicalizeProductLabelFromSources([name]);
  const candidates = [canonical, name].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const record = await Product.findOne({
      where: { name: { [Op.iLike]: candidate } },
      attributes: ['id'],
    });
    if (record?.id) {
      return record.id;
    }
  }
  return null;
};

const pickPrimaryEcwidOrder = (orders: UnifiedOrder[]): UnifiedOrder | null => {
  if (orders.length === 0) {
    return null;
  }
  if (orders.length === 1) {
    return orders[0];
  }
  const withMoment = orders
    .map((order) => ({
      order,
      moment: order.pickupDateTime ? dayjs(order.pickupDateTime) : null,
    }))
    .sort((a, b) => {
      if (a.moment && b.moment) {
        if (a.moment.isBefore(b.moment)) return -1;
        if (a.moment.isAfter(b.moment)) return 1;
      } else if (a.moment && !b.moment) {
        return -1;
      } else if (!a.moment && b.moment) {
        return 1;
      }
      return 0;
    });
  return withMoment[0]?.order ?? orders[0];
};

const normalizeExtras = (snapshot: unknown): OrderExtras => {
  if (!snapshot || typeof snapshot !== 'object') {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  const extras = (snapshot as { extras?: Partial<OrderExtras> }).extras;
  if (!extras) {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  return {
    tshirts: Number(extras.tshirts) || 0,
    cocktails: Number(extras.cocktails) || 0,
    photos: Number(extras.photos) || 0,
  };
};

const normalizeAttendedExtras = (snapshot: unknown): OrderExtras => {
  if (!snapshot || typeof snapshot !== 'object') {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  return {
    tshirts: Math.max(0, Math.round(Number((snapshot as Record<string, unknown>).tshirts) || 0)),
    cocktails: Math.max(0, Math.round(Number((snapshot as Record<string, unknown>).cocktails) || 0)),
    photos: Math.max(0, Math.round(Number((snapshot as Record<string, unknown>).photos) || 0)),
  };
};

const deriveBookingPartySize = (booking: Booking): number => {
  const fromTotal = Number(booking.partySizeTotal);
  if (Number.isFinite(fromTotal) && fromTotal > 0) {
    return Math.max(0, Math.round(fromTotal));
  }
  const fromBreakdown = Number(booking.partySizeAdults ?? 0) + Number(booking.partySizeChildren ?? 0);
  if (Number.isFinite(fromBreakdown) && fromBreakdown > 0) {
    return Math.max(0, Math.round(fromBreakdown));
  }
  return 0;
};

const resolveCheckInAllowance = (booking: Booking): number =>
  CHECKIN_ALLOWED_STATUSES.has(booking.status) ? deriveBookingPartySize(booking) : 0;

const normalizeAttendanceStatus = (value: unknown): BookingAttendanceStatus => {
  if (typeof value === 'string' && BOOKING_ATTENDANCE_STATUSES.includes(value as BookingAttendanceStatus)) {
    return value as BookingAttendanceStatus;
  }
  return DEFAULT_ATTENDANCE_STATUS;
};

const resolveAttendanceStatus = (
  booking: Booking,
  attendedTotal: number,
  hasAttendedExtrasValue: boolean,
  options: { markNoShowWhenAbsent?: boolean } = {},
): BookingAttendanceStatus => {
  const allowance = resolveCheckInAllowance(booking);
  if (allowance <= 0) {
    return DEFAULT_ATTENDANCE_STATUS;
  }
  const normalizedAttendedTotal = clampInt(attendedTotal, 0, allowance);
  if (normalizedAttendedTotal >= allowance) {
    return 'checked_in_full';
  }
  if (normalizedAttendedTotal > 0 || hasAttendedExtrasValue) {
    return 'checked_in_partial';
  }
  if (options.markNoShowWhenAbsent) {
    return 'no_show';
  }
  return DEFAULT_ATTENDANCE_STATUS;
};

const clampInt = (value: number, min: number, max: number): number => {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) {
    return min;
  }
  return Math.min(Math.max(rounded, min), max);
};

const applyBookingAttendanceUpdate = async (
  booking: Booking,
  payload: UpdateBookingAttendanceBody,
  actorId: number | null | undefined,
): Promise<BookingAttendanceUpdateResponse> => {
  const hasAttendedTotal = Object.prototype.hasOwnProperty.call(payload, 'attendedTotal');
  const hasAttendedExtras = Object.prototype.hasOwnProperty.call(payload, 'attendedExtras');

  if (!hasAttendedTotal && !hasAttendedExtras) {
    throw new HttpError(400, 'attendedTotal or attendedExtras must be provided');
  }

  const allowance = resolveCheckInAllowance(booking);

  const currentAttended = Number(booking.attendedTotal ?? 0);
  let nextAttendedTotal = Number.isFinite(currentAttended) ? Math.max(0, Math.round(currentAttended)) : 0;
  if (hasAttendedTotal) {
    const parsed = Number(payload.attendedTotal);
    if (!Number.isFinite(parsed)) {
      throw new HttpError(400, 'attendedTotal must be a number');
    }
    nextAttendedTotal = clampInt(parsed, 0, allowance);
  } else {
    nextAttendedTotal = clampInt(nextAttendedTotal, 0, allowance);
  }

  const purchasedExtras = normalizeExtras(booking.addonsSnapshot ?? undefined);
  const nextAttendedExtras = normalizeAttendedExtras(booking.attendedAddonsSnapshot ?? undefined);
  if (hasAttendedExtras) {
    const rawExtras = payload.attendedExtras;
    if (!rawExtras || typeof rawExtras !== 'object') {
      throw new HttpError(400, 'attendedExtras must be an object');
    }
    const rawEntries = rawExtras as Record<string, unknown>;
    for (const key of ['tshirts', 'cocktails', 'photos'] as const) {
      if (!Object.prototype.hasOwnProperty.call(rawEntries, key)) {
        continue;
      }
      const parsed = Number(rawEntries[key]);
      if (!Number.isFinite(parsed)) {
        throw new HttpError(400, `attendedExtras.${key} must be a number`);
      }
      const purchased = Math.max(0, Math.round(Number(purchasedExtras[key]) || 0));
      nextAttendedExtras[key] = clampInt(parsed, 0, purchased);
    }
  }

  booking.attendedTotal = nextAttendedTotal;
  const hasAttendedExtrasValue =
    nextAttendedExtras.tshirts > 0 ||
    nextAttendedExtras.cocktails > 0 ||
    nextAttendedExtras.photos > 0;
  booking.attendedAddonsSnapshot = hasAttendedExtrasValue ? nextAttendedExtras : null;
  const nextAttendanceStatus = resolveAttendanceStatus(booking, nextAttendedTotal, hasAttendedExtrasValue);
  booking.attendanceStatus = nextAttendanceStatus;

  const hasAttendance = nextAttendanceStatus === 'checked_in_full' || nextAttendanceStatus === 'checked_in_partial';
  booking.checkedInAt = hasAttendance ? new Date() : null;
  booking.checkedInBy = hasAttendance ? (actorId ?? booking.checkedInBy ?? null) : null;
  booking.updatedBy = actorId ?? booking.updatedBy;

  await booking.save();

  return {
    bookingId: booking.id,
    allowance,
    attendedTotal: nextAttendedTotal,
    attendedExtras: nextAttendedExtras,
    attendanceStatus: nextAttendanceStatus,
    remainingTotal: Math.max(allowance - nextAttendedTotal, 0),
    order: bookingToUnifiedOrder(booking),
  };
};

const coerceCount = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const extractPartyBreakdown = (
  snapshot?: Record<string, unknown> | null,
): { men: number | null; women: number | null } => {
  if (!snapshot || typeof snapshot !== 'object') {
    return { men: null, women: null };
  }
  const breakdown = (snapshot as { partyBreakdown?: { men?: unknown; women?: unknown } }).partyBreakdown;
  if (!breakdown || typeof breakdown !== 'object') {
    return { men: null, women: null };
  }
  return {
    men: coerceCount(breakdown.men),
    women: coerceCount(breakdown.women),
  };
};

const isAfterCutoffBySourceReceivedAt = (experienceDate: string, sourceReceivedAt: Date | null): boolean => {
  if (!sourceReceivedAt) {
    return false;
  }
  const sourceMoment = dayjs(sourceReceivedAt).tz(STORE_TIMEZONE);
  if (!sourceMoment.isValid()) {
    return false;
  }
  if (sourceMoment.format(DATE_FORMAT) !== experienceDate) {
    return false;
  }
  const cutoffMoment = dayjs.tz(
    `${experienceDate} ${AFTER_CUTOFF_TIME}`,
    'YYYY-MM-DD HH:mm:ss',
    STORE_TIMEZONE,
  );
  if (!cutoffMoment.isValid()) {
    return false;
  }
  return sourceMoment.isAfter(cutoffMoment);
};

const bookingToUnifiedOrder = (booking: Booking): UnifiedOrder | null => {
  const pickupMomentUtc = booking.experienceStartAt ? dayjs(booking.experienceStartAt) : null;
  const pickupMomentLocal =
    pickupMomentUtc?.isValid() && DISPLAY_TIMEZONE ? pickupMomentUtc.tz(DISPLAY_TIMEZONE) : pickupMomentUtc;
  const experienceDate =
    booking.experienceDate ??
    (pickupMomentLocal?.isValid()
      ? pickupMomentLocal.format(DATE_FORMAT)
      : pickupMomentUtc?.isValid()
        ? pickupMomentUtc.format(DATE_FORMAT)
        : null);

  if (!experienceDate) {
    return null;
  }

  const productId = deriveProductId(booking);
  const displayProductName = prettifyProductName(booking) ?? 'Unassigned product';
  const timeslot = pickupMomentLocal?.isValid() ? pickupMomentLocal.format('HH:mm') : '--:--';
  const snapshotBreakdown = extractPartyBreakdown(booking.addonsSnapshot ?? undefined);
  const fallbackTotal =
    booking.partySizeTotal ??
    (booking.partySizeAdults != null || booking.partySizeChildren != null
      ? (booking.partySizeAdults ?? 0) + (booking.partySizeChildren ?? 0)
      : null);
  let menCount = snapshotBreakdown.men;
  let womenCount = snapshotBreakdown.women;
  if (menCount === null && womenCount === null) {
    menCount = 0;
    womenCount = 0;
  } else {
    const adultsFallback = booking.partySizeAdults ?? booking.partySizeTotal ?? 0;
    const childrenFallback = booking.partySizeChildren ?? 0;
    if (menCount === null && womenCount !== null) {
      menCount =
        fallbackTotal !== null
          ? Math.max(fallbackTotal - womenCount, 0)
          : Math.max(adultsFallback - womenCount, 0);
    }
    if (womenCount === null && menCount !== null) {
      womenCount =
        fallbackTotal !== null
          ? Math.max(fallbackTotal - menCount, 0)
          : Math.max(childrenFallback, 0);
    }
    menCount = menCount ?? adultsFallback;
    womenCount = womenCount ?? childrenFallback;
    if (fallbackTotal !== null) {
      const combined = menCount + womenCount;
      if (combined > 0 && combined !== fallbackTotal) {
        const scale = fallbackTotal / combined;
        menCount = Math.max(Math.round(menCount * scale), 0);
        womenCount = Math.max(fallbackTotal - menCount, 0);
      }
      if (combined > 0 && menCount > fallbackTotal) {
        menCount = fallbackTotal;
        womenCount = 0;
      }
      if (combined > 0 && womenCount > fallbackTotal) {
        womenCount = fallbackTotal;
      }
    }
  }
  if (booking.status === 'rebooked') {
    menCount = 0;
    womenCount = 0;
  }
  let extras = normalizeExtras(booking.addonsSnapshot ?? undefined);
  if (booking.status === 'rebooked') {
    extras = { tshirts: 0, cocktails: 0, photos: 0 };
  }
  const combinedCount = menCount + womenCount;
  const quantity =
    booking.status === 'rebooked'
      ? 0
      : fallbackTotal ?? (combinedCount > 0 ? combinedCount : (booking.partySizeAdults ?? 0));
  const normalizedQuantity = Math.max(0, Math.round(Number(quantity) || 0));
  const rawAttendedTotal = Number(booking.attendedTotal ?? 0);
  const normalizedAttendedTotal = Number.isFinite(rawAttendedTotal)
    ? Math.max(0, Math.round(rawAttendedTotal))
    : 0;
  const attendedTotal = Math.min(normalizedAttendedTotal, normalizedQuantity);
  const remainingTotal = Math.max(resolveCheckInAllowance(booking) - attendedTotal, 0);
  const attendedExtras = normalizeAttendedExtras(booking.attendedAddonsSnapshot ?? undefined);
  const sourceReceivedAtIso = booking.sourceReceivedAt ? dayjs(booking.sourceReceivedAt).toISOString() : null;
  const isAfterCutoff = isAfterCutoffBySourceReceivedAt(experienceDate, booking.sourceReceivedAt ?? null);

  return {
    id: String(booking.id),
    platformBookingId: booking.platformBookingId,
    platformBookingUrl: booking.rawPayloadLocation ?? null,
    productId,
    productName: displayProductName,
    date: experienceDate,
    timeslot,
    quantity: normalizedQuantity,
    menCount,
    womenCount,
    customerName: buildCustomerName(booking),
    customerPhone: booking.guestPhone ?? undefined,
    customerEmail: booking.guestEmail ?? undefined,
    platform: booking.platform,
    pickupDateTime: pickupMomentUtc?.isValid() ? pickupMomentUtc.toISOString() : undefined,
    extras,
    attendedTotal,
    attendedExtras,
    remainingTotal,
    sourceReceivedAt: sourceReceivedAtIso,
    isAfterCutoff,
    status: booking.status,
    attendanceStatus: normalizeAttendanceStatus(booking.attendanceStatus),
    rawData: {
      bookingId: booking.id,
      platform: booking.platform,
    },
  };
};

const collectProducts = (orders: UnifiedOrder[]): UnifiedProduct[] => {
  const map = new Map<string, UnifiedProduct>();

  orders.forEach((order) => {
    if (!map.has(order.productId)) {
      map.set(order.productId, {
        id: order.productId,
        name: order.productName,
        platform: order.platform,
      });
    }
  });

  return Array.from(map.values());
};

export const listBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { start, end } = resolveRange(req.query as QueryParams);

    const where: WhereOptions = {};
    if (start && end) {
      where.experienceDate = { [Op.between]: [start, end] };
    } else if (start) {
      where.experienceDate = { [Op.gte]: start };
    } else if (end) {
      where.experienceDate = { [Op.lte]: end };
    }

    const rows = await Booking.findAll({
      where,
      include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
      order: [
        ['experienceDate', 'ASC'],
        ['experienceStartAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const orders = rows
      .map((booking) => bookingToUnifiedOrder(booking))
      .filter((order): order is UnifiedOrder => order !== null);

    const products = collectProducts(orders);

    res.status(200).json({
      total: orders.length,
      count: orders.length,
      products,
      orders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load bookings';
    res.status(500).json({ message });
  }
};

export const listBookingEmails = async (req: Request, res: Response): Promise<void> => {
  try {
    const { start, end } = resolveEmailRange(req.query as QueryParams);
    const limit = clampEmailLimit((req.query as BookingEmailQueryParams).limit);
    const offset = parseEmailOffset((req.query as BookingEmailQueryParams).offset);
    const includeTotalParam = (req.query as BookingEmailQueryParams).includeTotal;
    const includeTotal = String(includeTotalParam ?? 'true').toLowerCase() !== 'false';
    const rangeWhere = buildBookingEmailRangeWhere(start, end);
    const filterWhere = buildBookingEmailFilterWhere(req.query as BookingEmailQueryParams);
    const where = mergeBookingEmailWhere(rangeWhere, filterWhere);

    const queryOptions = {
      where,
      order: [
        ['receivedAt', 'DESC'],
        ['internalDate', 'DESC'],
        ['id', 'DESC'],
      ] as Array<[string, string]>,
      limit,
      offset,
      attributes: [
        'id',
        'messageId',
        'threadId',
        'fromAddress',
        'toAddresses',
        'ccAddresses',
        'subject',
        'snippet',
        'receivedAt',
        'internalDate',
        'payloadSize',
        'labelIds',
        'ingestionStatus',
        'failureReason',
        'createdAt',
        'updatedAt',
      ],
    };

    let rows: BookingEmail[] = [];
    let total: number | null = null;
    if (includeTotal) {
      const [fetchedRows, count] = await Promise.all([
        BookingEmail.findAll(queryOptions),
        BookingEmail.count({ where }),
      ]);
      rows = fetchedRows;
      total = count;
    } else {
      rows = await BookingEmail.findAll(queryOptions);
    }
    const count = rows.length;
    const hasMore = includeTotal ? (offset + count < (total ?? 0)) : count === limit;

    res.status(200).json({
      total,
      count,
      limit,
      offset,
      hasMore,
      emails: rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load booking emails';
    res.status(500).json({ message });
  }
};

export const getBookingEmailPreview = async (req: Request, res: Response): Promise<void> => {
  try {
    const messageId = String(req.params?.messageId ?? '').trim();
    if (!messageId) {
      res.status(400).json({ message: 'messageId is required' });
      return;
    }

    const email = await BookingEmail.findOne({
      where: { messageId },
      attributes: [
        'id',
        'messageId',
        'threadId',
        'fromAddress',
        'toAddresses',
        'ccAddresses',
        'subject',
        'snippet',
        'receivedAt',
        'internalDate',
        'ingestionStatus',
        'failureReason',
        'rawPayload',
      ],
    });

    if (!email) {
      res.status(404).json({ message: 'Booking email not found' });
      return;
    }

    let message: StoredGmailMessage | null = null;
    if (email.rawPayload) {
      try {
        message = JSON.parse(email.rawPayload) as StoredGmailMessage;
      } catch (error) {
        message = null;
      }
    }

    const bodies = collectMessageBodies(message?.payload);
    const textBody = bodies.textBody ? bodies.textBody.trim() : null;
    const htmlBody = bodies.htmlBody ?? null;
    const htmlText = htmlBody ? stripHtmlToText(htmlBody).trim() : null;
    const previewText = textBody || htmlText || (email.snippet ? email.snippet.trim() : null) || null;

    const bookingEvents = await BookingEvent.findAll({
      where: {
        [Op.or]: [{ emailId: email.id }, { emailMessageId: email.messageId }],
      },
      include: [{ model: Booking, as: 'booking' }],
      order: [['id', 'DESC']],
    });

    const bookingMap = new Map<number, Booking>();
    bookingEvents.forEach((event) => {
      if (event.booking) {
        bookingMap.set(event.booking.id, event.booking);
      }
    });
    const bookings = Array.from(bookingMap.values()).map((booking) => booking.get({ plain: true }));
    const bookingEventsPayload = bookingEvents.map((event) => {
      const plain = event.get({ plain: true }) as unknown as Record<string, unknown>;
      delete plain.booking;
      delete plain.email;
      return plain;
    });
    const bookingIds = Array.from(bookingMap.keys());
    const bookingAddons = bookingIds.length
      ? await BookingAddon.findAll({
          where: { bookingId: { [Op.in]: bookingIds } },
          order: [
            ['bookingId', 'ASC'],
            ['id', 'ASC'],
          ],
        })
      : [];
    const bookingAddonsPayload = bookingAddons.map((addon) => addon.get({ plain: true }));

    res.status(200).json({
      id: email.id,
      messageId: email.messageId,
      threadId: email.threadId,
      fromAddress: email.fromAddress,
      toAddresses: email.toAddresses,
      ccAddresses: email.ccAddresses,
      subject: email.subject,
      snippet: email.snippet,
      receivedAt: email.receivedAt,
      internalDate: email.internalDate,
      ingestionStatus: email.ingestionStatus,
      failureReason: email.failureReason,
      gmailQuery: resolveBookingQuery(),
      bookings,
      bookingEvents: bookingEventsPayload,
      bookingAddons: bookingAddonsPayload,
      textBody,
      htmlBody,
      htmlText,
      previewText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load booking email preview';
    res.status(500).json({ message });
  }
};

export const reprocessBookingEmail = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const messageId = String(req.params?.messageId ?? '').trim();
    if (!messageId) {
      res.status(400).json({ message: 'messageId is required' });
      return;
    }

    const result = await processBookingEmail(messageId, { force: true });
    res.status(200).json({ status: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reprocess booking email';
    res.status(500).json({ message });
  }
};

export const reprocessBookingEmails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const body = req.body as BulkEmailReprocessBody;
    const inputIds = Array.isArray(body?.messageIds) ? body.messageIds : [];
    const messageIds = inputIds
      .map((value) => String(value ?? '').trim())
      .filter((value) => value.length > 0);

    let resolvedMessageIds: string[] = [];
    if (messageIds.length > 0) {
      resolvedMessageIds = Array.from(new Set(messageIds));
    } else {
      const { start, end } = resolveEmailRange({ pickupFrom: body?.pickupFrom, pickupTo: body?.pickupTo });
      if (!start && !end) {
        res.status(400).json({ message: 'messageIds or pickupFrom/pickupTo is required' });
        return;
      }
      const limit = body?.limit !== undefined ? parseEmailLimitParam(body?.limit, EMAIL_MAX_LIMIT) : undefined;
      const rangeFilter: Record<symbol, unknown> = {};
      if (start) {
        rangeFilter[Op.gte] = start;
      }
      if (end) {
        rangeFilter[Op.lte] = end;
      }
      const where: WhereOptions = {
        [Op.or]: [{ receivedAt: rangeFilter }, { internalDate: rangeFilter }],
      };
      const emailRecords = await BookingEmail.findAll({
        where,
        attributes: ['messageId'],
        order: [
          ['receivedAt', 'DESC'],
          ['internalDate', 'DESC'],
          ['id', 'DESC'],
        ],
        ...(limit ? { limit } : {}),
      });
      resolvedMessageIds = emailRecords
        .map((record) => String(record.messageId ?? '').trim())
        .filter((value) => value.length > 0);
    }

    if (resolvedMessageIds.length === 0) {
      res.status(200).json({ total: 0, results: {} });
      return;
    }

    const summary: Record<string, number> = {};
    for (const id of resolvedMessageIds) {
      try {
        const result = await processBookingEmail(id, { force: true });
        summary[result] = (summary[result] ?? 0) + 1;
      } catch (error) {
        summary.failed = (summary.failed ?? 0) + 1;
      }
    }

    res.status(200).json({ total: resolvedMessageIds.length, results: summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reprocess booking emails';
    res.status(500).json({ message });
  }
};

export const backfillBookingEmails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const body = req.body as BackfillEmailRequestBody;
    const { start, end } = resolveEmailRange({ pickupFrom: body?.pickupFrom, pickupTo: body?.pickupTo });
    if (!start && !end) {
      res.status(400).json({ message: 'pickupFrom or pickupTo is required' });
      return;
    }

    void ingestAllBookingEmails({
      receivedAfter: start ?? undefined,
      receivedBefore: end ?? undefined,
      batchSize: body?.batchSize,
      query: body?.query,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[booking-email] Backfill failed: ${message}`);
    });

    res.status(202).json({ status: 'queued' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to backfill booking emails';
    res.status(500).json({ message });
  }
};

export const ingestBookingEmails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await ingestLatestBookingEmails();
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to ingest booking emails';
    res.status(500).json({ message });
  }
};

export const importEcwidBooking = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const orderId = String((req.body as { orderId?: string })?.orderId ?? '').trim();
    if (!orderId) {
      res.status(400).json({ message: 'orderId is required' });
      return;
    }

    const existing = await Booking.findOne({
      where: { platform: 'ecwid', platformBookingId: orderId },
      attributes: ['id'],
    });
    if (existing) {
      res.status(200).json({ status: 'exists', bookingId: existing.id });
      return;
    }

    const ecwidOrder = await getEcwidOrder(orderId);
    const { orders } = transformEcwidOrders([ecwidOrder]);
    const unified = pickPrimaryEcwidOrder(orders);
    if (!unified) {
      res.status(400).json({ message: 'Unable to derive booking from Ecwid order' });
      return;
    }

    const countsTotal = Number.isFinite(unified.quantity) ? unified.quantity : 0;
    const menCount = Number.isFinite(unified.menCount) ? unified.menCount : 0;
    const womenCount = Number.isFinite(unified.womenCount) ? unified.womenCount : 0;
    const totalPeople = menCount + womenCount > 0 ? menCount + womenCount : countsTotal;
    const pickupMoment = unified.pickupDateTime ? dayjs(unified.pickupDateTime) : null;
    const now = new Date();
    const { firstName, lastName } = splitCustomerName(unified.customerName);
    const channelId = await resolveChannelIdByName('Ecwid');
    const productId = await resolveProductIdByName(unified.productName);
    const addonsSnapshot = unified.extras ? { extras: unified.extras } : null;
    const userId =
      req.user && typeof req.user === 'object' && 'id' in req.user
        ? Number(req.user.id)
        : null;

    const payload = {
      platform: 'ecwid',
      platformBookingId: unified.platformBookingId,
      platformOrderId: unified.platformBookingId,
      status: 'confirmed',
      paymentStatus: 'unknown',
      statusChangedAt: now,
      experienceDate: unified.date,
      experienceStartAt: pickupMoment?.isValid() ? pickupMoment.toDate() : null,
      productId,
      productName: unified.productName ?? null,
      guestFirstName: firstName,
      guestLastName: lastName,
      guestPhone: unified.customerPhone ?? null,
      partySizeTotal: totalPeople || null,
      partySizeAdults: totalPeople || null,
      addonsSnapshot,
      channelId,
      sourceReceivedAt: now,
      processedAt: now,
      createdBy: userId,
      updatedBy: userId,
    } as unknown as Parameters<typeof Booking.create>[0];

    const created = await Booking.create(payload as unknown as any);

    res.status(201).json({ status: 'created', bookingId: created.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import Ecwid booking';
    res.status(500).json({ message });
  }
};

export const getManifest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date, productId, time, search } = req.query as QueryParams;
    const searchTerm = typeof search === 'string' ? search.trim() : '';
    const hasSearch = searchTerm.length > 0;
    const targetDate = normalizeDate(date ?? dayjs().format(DATE_FORMAT), 'start');

    if (!targetDate) {
      res.status(400).json({ message: 'Invalid date provided' });
      return;
    }

    const normalizedProductId = typeof productId === 'string' ? productId.trim() : '';
    const numericProductId = normalizedProductId ? Number.parseInt(normalizedProductId, 10) : NaN;
    const hasNumericProductId = Number.isFinite(numericProductId);
    const productRecord = hasNumericProductId ? await Product.findByPk(numericProductId) : null;
    const canonicalProductKey = productRecord
      ? canonicalizeProductKeyFromLabel(productRecord.name ?? null)
      : null;
    const acceptedProductKeys = new Set<string>();
    if (normalizedProductId) {
      acceptedProductKeys.add(normalizedProductId);
    }
    if (hasNumericProductId) {
      acceptedProductKeys.add(String(numericProductId));
    }
    if (canonicalProductKey) {
      acceptedProductKeys.add(canonicalProductKey);
    }

    const rows = await Booking.findAll({
      where: hasSearch
        ? buildSearchWhere(searchTerm)
        : {
            experienceDate: targetDate,
            ...(hasNumericProductId ? { productId: numericProductId } : {}),
          },
      include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
      order: [
        ['experienceStartAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const baseOrders = rows
      .map((booking) => bookingToUnifiedOrder(booking))
      .filter((order): order is UnifiedOrder => order !== null);

    const scopedOrders = hasSearch
      ? baseOrders
      : baseOrders.filter((order) => order.date === targetDate);

    const filteredOrders = hasSearch
      ? scopedOrders
      : scopedOrders.filter((order) => {
          if (!hasNumericProductId && acceptedProductKeys.size > 0 && !acceptedProductKeys.has(order.productId)) {
            return false;
          }
          if (time && order.timeslot !== time) {
            return false;
          }
          return true;
        });

    const manifest = groupOrdersForManifest(filteredOrders);

    const summary = manifest.reduce<{
      totalPeople: number;
      men: number;
      women: number;
      totalOrders: number;
      extras: OrderExtras;
      platformBreakdown: PlatformBreakdownEntry[];
      statusCounts: Record<string, number>;
      attendanceStatusCounts: Record<string, number>;
    }>(
      (acc, group: ManifestGroup) => {
        acc.totalPeople += group.totalPeople;
        acc.men += group.men;
        acc.women += group.women;
        acc.totalOrders += group.orders.length;
        acc.extras.tshirts += group.extras.tshirts;
        acc.extras.cocktails += group.extras.cocktails;
        acc.extras.photos += group.extras.photos;
        group.platformBreakdown.forEach((entry) => {
          const key = entry.platform || 'unknown';
          const existing = acc.platformBreakdown.find((bucket) => bucket.platform === key);
          if (existing) {
            existing.totalPeople += entry.totalPeople;
            existing.men += entry.men;
            existing.women += entry.women;
            existing.orderCount += entry.orderCount;
            return;
          }
          acc.platformBreakdown.push({ ...entry, platform: key });
        });
        group.orders.forEach((order) => {
          acc.statusCounts[order.status] = (acc.statusCounts[order.status] ?? 0) + 1;
          const attendanceStatus = normalizeAttendanceStatus(order.attendanceStatus);
          acc.attendanceStatusCounts[attendanceStatus] = (acc.attendanceStatusCounts[attendanceStatus] ?? 0) + 1;
        });
        return acc;
      },
      {
        totalPeople: 0,
        men: 0,
        women: 0,
        totalOrders: 0,
        extras: { tshirts: 0, cocktails: 0, photos: 0 },
        platformBreakdown: [],
        statusCounts: {},
        attendanceStatusCounts: {},
      },
    );

    summary.platformBreakdown.sort((a, b) => a.platform.localeCompare(b.platform));
    for (const status of BOOKING_STATUSES) {
      if (!(status in summary.statusCounts)) {
        summary.statusCounts[status] = 0;
      }
    }
    for (const attendanceStatus of BOOKING_ATTENDANCE_STATUSES) {
      if (!(attendanceStatus in summary.attendanceStatusCounts)) {
        summary.attendanceStatusCounts[attendanceStatus] = 0;
      }
    }

    res.status(200).json({
      date: targetDate,
      filters: {
        productId: hasSearch ? null : productId ?? null,
        time: hasSearch ? null : time ?? null,
        search: hasSearch ? searchTerm : null,
      },
      orders: filteredOrders,
      manifest,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build manifest';
    res.status(500).json({ message });
  }
};

export const updateBookingAttendance = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const payload = (req.body ?? {}) as UpdateBookingAttendanceBody;

    const booking = await Booking.findByPk(bookingIdParam, {
      include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
    });
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    const result = await applyBookingAttendanceUpdate(booking, payload, req.authContext?.id ?? null);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Failed to update booking attendance';
    res.status(500).json({ message });
  }
};

export const updateBulkBookingAttendance = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as UpdateBulkBookingAttendanceBody;
    const updates = Array.isArray(body.updates) ? body.updates : [];
    if (updates.length === 0) {
      res.status(400).json({ message: 'updates must be a non-empty array' });
      return;
    }

    if (updates.length > 500) {
      res.status(400).json({ message: 'updates must contain at most 500 rows' });
      return;
    }

    const bookingIds = updates
      .map((row) => Number.parseInt(String(row?.bookingId ?? ''), 10))
      .filter((id) => Number.isInteger(id) && id > 0);
    const uniqueBookingIds = Array.from(new Set<number>(bookingIds));

    const bookings = uniqueBookingIds.length
      ? await Booking.findAll({
          where: { id: { [Op.in]: uniqueBookingIds } },
          include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
        })
      : [];
    const bookingById = new Map<number, Booking>();
    bookings.forEach((booking) => bookingById.set(booking.id, booking));

    const results: BookingAttendanceBulkUpdateResult[] = [];

    for (const row of updates) {
      const bookingId = Number.parseInt(String(row?.bookingId ?? ''), 10);
      if (!Number.isInteger(bookingId) || bookingId <= 0) {
        results.push({ bookingId: null, error: 'A valid booking ID must be provided' });
        continue;
      }

      const booking = bookingById.get(bookingId);
      if (!booking) {
        results.push({ bookingId, error: 'Booking not found' });
        continue;
      }

      try {
        const result = await applyBookingAttendanceUpdate(
          booking,
          {
            attendedTotal: row.attendedTotal,
            attendedExtras: row.attendedExtras,
          },
          req.authContext?.id ?? null,
        );
        results.push(result);
      } catch (error) {
        const message =
          error instanceof HttpError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Failed to update booking attendance';
        results.push({ bookingId, error: message });
      }
    }

    const failed = results.filter((result) => 'error' in result).length;
    const updated = results.length - failed;

    res.status(200).json({
      updated,
      failed,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update booking attendance';
    res.status(500).json({ message });
  }
};

export const getEcwidAmendPreview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam, {
      include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
    });
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be previewed through this endpoint' });
      return;
    }

    const platformBookingId = booking.platformBookingId?.trim() ?? '';
    const platformOrderId = booking.platformOrderId?.trim() ?? '';
    const rawOrderId = platformOrderId || platformBookingId;
    if (!rawOrderId) {
      res.status(400).json({ message: 'Booking is missing Ecwid platform reference' });
      return;
    }

    const orderId = stripEcwidItemSuffix(rawOrderId);
    let ecwidOrder: EcwidOrder | null = null;
    try {
      ecwidOrder = await getEcwidOrder(orderId);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        res.status(200).json({
          status: 'order_missing' satisfies EcwidAmendPreviewStatus,
          message: 'Ecwid order not found for this booking reference.',
          orderId,
          booking: {
            id: booking.id,
            platformBookingId: booking.platformBookingId,
            platformOrderId: booking.platformOrderId,
            productId: booking.productId,
            productName: booking.product?.name ?? booking.productName,
            productVariant: booking.productVariant,
          },
        });
        return;
      }
      throw error;
    }

    const aliases = await ProductAlias.findAll({
      where: { active: true },
      order: [
        ['priority', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const bookingProductName = booking.product?.name ?? booking.productName ?? null;
    const bookingProductVariant = booking.productVariant ?? null;

    const orderBookings = await Booking.findAll({
      where: {
        platform: 'ecwid',
        [Op.or]: [
          { platformOrderId: orderId },
          { platformBookingId: orderId },
          { platformBookingId: { [Op.like]: `${orderId}-%` } },
        ],
      },
      include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
      order: [['id', 'ASC']],
    });

    const items: EcwidAmendPreviewItem[] = (ecwidOrder.items ?? []).map((item) => ({
      name: item.name ? String(item.name).trim() : null,
      quantity: item.quantity ?? null,
      pickupTime: item.pickupTime ? String(item.pickupTime) : null,
      options: extractEcwidItemOptions(item),
      matched: false,
      matchedBookingNames: [],
    }));

    const ecwidItemAliasIds = items.map((item) => (item.name ? resolveAliasProductId(aliases, item.name) : null));
    const ecwidItemNormalized = items.map((item) => (item.name ? normalizeAliasLabel(item.name) : null));

    const bookingItems = orderBookings.map((record) => {
      const name = record.product?.name ?? record.productName ?? null;
      const aliasProductId = name ? resolveAliasProductId(aliases, name) : null;
      return {
        id: record.id,
        name,
        productId: record.productId ?? aliasProductId ?? null,
      };
    });

    const bookingMatches = bookingItems.map((bookingItem) => {
      let matchedIndex: number | null = null;
      if (bookingItem.name) {
        const bookingNormalized = normalizeAliasLabel(bookingItem.name);
        for (let index = 0; index < items.length; index += 1) {
          const itemName = items[index].name;
          if (!itemName) {
            continue;
          }
          const itemAliasProductId = ecwidItemAliasIds[index];
          if (bookingItem.productId !== null && itemAliasProductId !== null) {
            if (bookingItem.productId === itemAliasProductId) {
              matchedIndex = index;
              break;
            }
          }
          const itemNormalized = ecwidItemNormalized[index];
          if (
            itemNormalized &&
            (itemNormalized.includes(bookingNormalized) || bookingNormalized.includes(itemNormalized))
          ) {
            matchedIndex = index;
            break;
          }
        }
      }
      if (matchedIndex !== null) {
        items[matchedIndex].matched = true;
        if (bookingItem.name) {
          items[matchedIndex].matchedBookingNames = Array.from(
            new Set([...(items[matchedIndex].matchedBookingNames ?? []), bookingItem.name]),
          );
        }
      }
      return {
        ...bookingItem,
        matched: matchedIndex !== null,
        matchedIndex,
      };
    });

    const missingItems = bookingMatches.filter((entry) => !entry.matched && entry.name).map((entry) => entry.name as string);

    const status: EcwidAmendPreviewStatus = missingItems.length > 0 ? 'product_missing' : 'matched';
    const message =
      status === 'matched'
        ? 'Ecwid order contains all OmniLodge items for this booking.'
        : 'Ecwid order found, but some OmniLodge items are missing.';

    res.status(200).json({
      status,
      message,
      orderId,
      booking: {
        id: booking.id,
        platformBookingId: booking.platformBookingId,
        platformOrderId: booking.platformOrderId,
        productId: booking.productId,
        productName: bookingProductName,
        productVariant: bookingProductVariant,
      },
      bookingItems: bookingMatches.map((entry) => ({
        id: entry.id,
        name: entry.name,
        productId: entry.productId,
        matched: entry.matched,
        matchedIndex: entry.matchedIndex,
      })),
      missingItems,
      ecwid: {
        id: ecwidOrder.id ?? orderId,
        pickupTime: ecwidOrder.pickupTime ?? null,
        items,
      },
    });
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status ?? 502 : 500;
    const message = error instanceof Error ? error.message : 'Failed to preview Ecwid booking details';
    res.status(status).json({ message });
  }
};

export const reconcileEcwidBooking = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const { itemIndex } = req.body as ReconcileEcwidRequestBody;
    if (itemIndex === undefined || itemIndex === null || Number.isNaN(Number(itemIndex))) {
      res.status(400).json({ message: 'itemIndex is required' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be reconciled through this endpoint' });
      return;
    }

    const platformBookingId = booking.platformBookingId?.trim() ?? '';
    const platformOrderId = booking.platformOrderId?.trim() ?? '';
    const rawOrderId = platformOrderId || platformBookingId;
    if (!rawOrderId) {
      res.status(400).json({ message: 'Booking is missing Ecwid platform reference' });
      return;
    }

    const orderId = stripEcwidItemSuffix(rawOrderId);
    const ecwidOrder = await getEcwidOrder(orderId);

    const items = ecwidOrder.items ?? [];
    const index = Number(itemIndex);
    if (!Number.isFinite(index) || index < 0 || index >= items.length) {
      res.status(400).json({ message: 'itemIndex is out of range' });
      return;
    }

    const targetItem = items[index];
    const itemName = targetItem?.name ? String(targetItem.name).trim() : null;
    if (!itemName) {
      res.status(400).json({ message: 'Selected Ecwid item is missing a name' });
      return;
    }

    const aliases = await ProductAlias.findAll({
      where: { active: true },
      order: [
        ['priority', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    const resolvedProductId = resolveAliasProductId(aliases, itemName);
    const options = extractEcwidItemOptions(targetItem);
    const variant = options.length > 0 ? options.join(' | ') : null;

    booking.productName = itemName;
    booking.productId = resolvedProductId ?? null;
    booking.productVariant = variant;
    booking.updatedBy = req.authContext?.id ?? booking.updatedBy;

    await booking.save();

    res.status(200).json({
      message: 'Booking updated to match Ecwid order item',
      booking: {
        id: booking.id,
        platformBookingId: booking.platformBookingId,
        platformOrderId: booking.platformOrderId,
        productId: booking.productId,
        productName: booking.productName,
        productVariant: booking.productVariant,
      },
      ecwid: {
        id: ecwidOrder.id ?? orderId,
        itemIndex: index,
        itemName,
      },
    });
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status ?? 502 : 500;
    const message = error instanceof Error ? error.message : 'Failed to reconcile Ecwid booking';
    res.status(status).json({ message });
  }
};

export const getBookingDetails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam, {
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name'] },
        { model: Guest, as: 'guest', attributes: ['id', 'name', 'email', 'phoneNumber'] },
      ],
    });
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    const bookingEvents = await BookingEvent.findAll({
      where: { bookingId: booking.id },
      order: [['id', 'DESC']],
    });

    const emailMessageIds = new Set<string>();
    if (booking.lastEmailMessageId) {
      emailMessageIds.add(booking.lastEmailMessageId);
    }
    bookingEvents.forEach((event) => {
      if (event.emailMessageId) {
        emailMessageIds.add(event.emailMessageId);
      }
    });

    const emails = emailMessageIds.size > 0
      ? await BookingEmail.findAll({
          where: { messageId: { [Op.in]: Array.from(emailMessageIds) } },
          attributes: [
            'id',
            'messageId',
            'subject',
            'snippet',
            'receivedAt',
            'internalDate',
            'ingestionStatus',
            'failureReason',
          ],
          order: [
            ['receivedAt', 'DESC'],
            ['internalDate', 'DESC'],
            ['id', 'DESC'],
          ],
        })
      : [];

    let stripe: StripeTransactionSummary | null = null;
    let stripeError: string | null = null;
    let ecwidOrderId: string | null = null;

    if (booking.platform === 'ecwid') {
      const platformBookingId = booking.platformBookingId?.trim() ?? '';
      const platformOrderId = booking.platformOrderId?.trim() ?? '';
      const rawOrderId = platformOrderId || platformBookingId;
      if (rawOrderId) {
        ecwidOrderId = stripEcwidItemSuffix(rawOrderId);
        try {
          const ecwidOrder = await getEcwidOrder(ecwidOrderId);
          const externalTransactionId = normalizeExternalTransactionId(ecwidOrder);
          if (externalTransactionId) {
            stripe = await resolveStripeTransaction(externalTransactionId);
          }
        } catch (error) {
          if (isAxiosError(error) && error.response?.status === 404) {
            stripeError = 'Ecwid order not found.';
          } else if (isStripeResourceMissing(error)) {
            stripeError = 'Stripe transaction not found.';
          } else {
            stripeError = error instanceof Error ? error.message : 'Failed to load Stripe details';
          }
        }
      }
    }

    res.status(200).json({
      booking: booking.get({ plain: true }),
      events: bookingEvents.map((event) => event.get({ plain: true })),
      emails: emails.map((email) => email.get({ plain: true })),
      stripe,
      stripeError,
      ecwidOrderId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load booking details';
    res.status(500).json({ message });
  }
};

export const amendEcwidBooking = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const { pickupDate, pickupTime } = req.body as AmendEcwidRequestBody;
    if (!pickupDate || !pickupTime) {
      res.status(400).json({ message: 'Both pickupDate and pickupTime are required' });
      return;
    }

    const pickupMoment = parsePickupMoment(pickupDate, pickupTime);
    if (!pickupMoment) {
      res.status(400).json({ message: 'Invalid pickup date or time' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be amended through this endpoint' });
      return;
    }

    const orderId = booking.platformBookingId?.trim();
    if (!orderId) {
      res.status(400).json({ message: 'Booking is missing Ecwid platform reference' });
      return;
    }

    const pickupUtc = pickupMoment.utc();
    const ecwidPickupTime = pickupUtc.format('YYYY-MM-DD HH:mm:ss ZZ');

    const ecwidOrder = await getEcwidOrder(orderId);
    const pickupExtraField = buildPickupExtraFieldPayload(ecwidOrder.orderExtraFields, ecwidPickupTime);

    await updateEcwidOrder(orderId, {
      pickupTime: ecwidPickupTime,
      orderExtraFields: [pickupExtraField],
    });

    booking.experienceDate = pickupMoment.format(DATE_FORMAT);
    booking.experienceStartAt = pickupUtc.toDate();
    booking.updatedBy = req.authContext?.id ?? booking.updatedBy;

    await booking.save();

    res.status(200).json({
      message: 'Pickup time updated successfully',
      booking: {
        id: booking.id,
        experienceDate: booking.experienceDate,
        experienceStartAt: booking.experienceStartAt,
        pickupTimeUtc: pickupUtc.toISOString(),
      },
    });
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status ?? 502 : 500;
    let message = 'Failed to amend Ecwid booking';
    if (isAxiosError(error)) {
      if (typeof error.response?.data === 'string') {
        message = error.response.data;
      } else if (error.response?.data?.message) {
        message = error.response.data.message;
      } else if (error.message) {
        message = error.message;
      }
    } else if (error instanceof Error) {
      message = error.message;
    }
    res.status(status).json({ message });
  }
};

type StripeTransactionSummary = {
  id: string;
  type: 'charge' | 'payment_intent';
  amount: number;
  amountRefunded: number;
  currency: string;
  status: string | null;
  created: number;
  receiptEmail?: string | null;
  description?: string | null;
  fullyRefunded: boolean;
};

type EcwidRefundPreview = {
  bookingId: number;
  orderId: string;
  externalTransactionId: string;
  stripe: StripeTransactionSummary;
};

type PartialRefundPreview = EcwidRefundPreview & {
  remainingAmount: number;
  addons: Array<{
    id: number;
    platformAddonName: string | null;
    quantity: number;
    unitPrice: string | null;
    totalPrice: string | null;
    currency: string | null;
  }>;
};

const normalizeExternalTransactionId = (order: EcwidOrder): string | null => {
  const candidate = (order as { externalTransactionId?: unknown }).externalTransactionId;
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return String(candidate);
  }
  return null;
};

const isStripeResourceMissing = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return (error as { code?: string }).code === 'resource_missing';
};

const summarizeCharge = (charge: Stripe.Charge): StripeTransactionSummary => {
  const amount = charge.amount ?? 0;
  const amountRefunded = charge.amount_refunded ?? 0;
  return {
    id: charge.id,
    type: 'charge',
    amount,
    amountRefunded,
    currency: charge.currency ?? 'unknown',
    status: charge.status ?? null,
    created: charge.created ?? 0,
    receiptEmail: charge.receipt_email ?? charge.billing_details?.email ?? null,
    description: charge.description ?? null,
    fullyRefunded: amount > 0 && amountRefunded >= amount,
  };
};

const summarizePaymentIntent = (
  intent: Stripe.PaymentIntent,
  latestCharge: Stripe.Charge | null,
): StripeTransactionSummary => {
  const amount = intent.amount_received ?? intent.amount ?? 0;
  const amountRefunded = latestCharge?.amount_refunded ?? 0;
  return {
    id: intent.id,
    type: 'payment_intent',
    amount,
    amountRefunded,
    currency: intent.currency ?? 'unknown',
    status: intent.status ?? null,
    created: intent.created ?? 0,
    receiptEmail: intent.receipt_email ?? latestCharge?.receipt_email ?? latestCharge?.billing_details?.email ?? null,
    description: intent.description ?? latestCharge?.description ?? null,
    fullyRefunded: amount > 0 && amountRefunded >= amount,
  };
};

const resolveStripeTransaction = async (externalTransactionId: string): Promise<StripeTransactionSummary> => {
  const trimmed = externalTransactionId.trim();
  if (!trimmed) {
    throw new Error('External transaction ID is missing');
  }

  const stripe = getStripeClient();

  const tryPaymentIntent = async (): Promise<StripeTransactionSummary | null> => {
    try {
      const intent = await stripe.paymentIntents.retrieve(trimmed);
      let latestCharge: Stripe.Charge | null = null;
      if (typeof intent.latest_charge === 'string' && intent.latest_charge.trim().length > 0) {
        const charge = await stripe.charges.retrieve(intent.latest_charge);
        latestCharge = 'deleted' in charge && charge.deleted ? null : (charge as Stripe.Charge);
      } else if (intent.latest_charge && typeof intent.latest_charge === 'object') {
        latestCharge = intent.latest_charge as Stripe.Charge;
      }
      return summarizePaymentIntent(intent, latestCharge);
    } catch (error) {
      if (isStripeResourceMissing(error)) {
        return null;
      }
      throw error;
    }
  };

  const tryCharge = async (): Promise<StripeTransactionSummary | null> => {
    try {
      const charge = await stripe.charges.retrieve(trimmed);
      if ('deleted' in charge && charge.deleted) {
        return null;
      }
      return summarizeCharge(charge as Stripe.Charge);
    } catch (error) {
      if (isStripeResourceMissing(error)) {
        return null;
      }
      throw error;
    }
  };

  if (trimmed.startsWith('pi_')) {
    const intentSummary = await tryPaymentIntent();
    if (intentSummary) {
      return intentSummary;
    }
    const chargeSummary = await tryCharge();
    if (chargeSummary) {
      return chargeSummary;
    }
  } else if (trimmed.startsWith('ch_')) {
    const chargeSummary = await tryCharge();
    if (chargeSummary) {
      return chargeSummary;
    }
    const intentSummary = await tryPaymentIntent();
    if (intentSummary) {
      return intentSummary;
    }
  } else {
    const intentSummary = await tryPaymentIntent();
    if (intentSummary) {
      return intentSummary;
    }
    const chargeSummary = await tryCharge();
    if (chargeSummary) {
      return chargeSummary;
    }
  }

  throw new Error('Stripe transaction not found for the provided external transaction ID.');
};

const buildEcwidRefundPreview = async (booking: Booking): Promise<EcwidRefundPreview> => {
  const orderId = booking.platformBookingId?.trim();
  if (!orderId) {
    throw new Error('Booking is missing Ecwid platform reference');
  }
  const ecwidOrder = await getEcwidOrder(orderId);
  const externalTransactionId = normalizeExternalTransactionId(ecwidOrder);
  if (!externalTransactionId) {
    throw new Error('Ecwid order is missing an external transaction ID');
  }
  const stripeSummary = await resolveStripeTransaction(externalTransactionId);
  return {
    bookingId: booking.id,
    orderId,
    externalTransactionId,
    stripe: stripeSummary,
  };
};

const createStripeRefundFromSummary = async (
  summary: StripeTransactionSummary,
  metadata: { bookingId: number; orderId: string },
  amount?: number,
): Promise<Stripe.Refund | null> => {
  const stripe = getStripeClient();

  if (summary.fullyRefunded) {
    return null;
  }
  const basePayload: Stripe.RefundCreateParams = {
    reason: 'requested_by_customer',
    metadata: {
      bookingId: String(metadata.bookingId),
      orderId: metadata.orderId,
    },
  };
  if (amount && Number.isFinite(amount)) {
    basePayload.amount = Math.max(0, Math.floor(amount));
  }
  if (summary.type === 'payment_intent') {
    return stripe.refunds.create({ ...basePayload, payment_intent: summary.id });
  }
  return stripe.refunds.create({ ...basePayload, charge: summary.id });
};

export const cancelEcwidBooking = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be cancelled through this endpoint' });
      return;
    }

    if (booking.status === 'cancelled') {
      res.status(400).json({ message: 'Booking is already cancelled' });
      return;
    }

    const preview = await buildEcwidRefundPreview(booking);
    const refund = await createStripeRefundFromSummary(preview.stripe, {
      bookingId: booking.id,
      orderId: preview.orderId,
    });

    const now = new Date();
    booking.status = 'cancelled';
    booking.statusChangedAt = now;
    booking.cancelledAt = now;
    booking.updatedBy = req.authContext?.id ?? booking.updatedBy;

    await booking.save();

    res.status(200).json({
      message: refund ? 'Booking cancelled and refund issued successfully' : 'Booking cancelled successfully',
      booking: {
        id: booking.id,
        status: booking.status,
        cancelledAt: booking.cancelledAt,
      },
      refund,
      stripe: preview.stripe,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ message: error.message, details: error.details });
      return;
    }
    const message = error instanceof Error ? error.message : 'Failed to cancel booking';
    res.status(500).json({ message });
  }
};

export const getEcwidRefundPreview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be refunded through this endpoint' });
      return;
    }

    const preview = await buildEcwidRefundPreview(booking);
    res.status(200).json(preview);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ message: error.message, details: error.details });
      return;
    }
    const message = error instanceof Error ? error.message : 'Failed to load refund preview';
    res.status(500).json({ message });
  }
};

export const getPartialRefundPreview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be refunded through this endpoint' });
      return;
    }

    const preview = await buildEcwidRefundPreview(booking);
    const remaining = Math.max(preview.stripe.amount - preview.stripe.amountRefunded, 0);

    const addons = await BookingAddon.findAll({
      where: { bookingId: booking.id },
      include: [
        {
          model: Addon,
          as: 'addon',
          attributes: ['id', 'name', 'basePrice'],
        },
      ],
      order: [['id', 'ASC']],
    });

    const normalizeAddonName = (value: string): string =>
      value
        .toLowerCase()
        .replace(/add[-\s]?on/gi, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const priceOverrides = booking.productId
      ? await ProductAddon.findAll({
          where: { productId: booking.productId },
          attributes: ['addonId', 'priceOverride'],
          include: [{ model: Addon, as: 'addon', attributes: ['id', 'name', 'basePrice'] }],
        })
      : [];
    const priceOverrideByAddonId = new Map(
      priceOverrides.map((entry) => [entry.addonId, entry.priceOverride]),
    );
    const productAddonByName = new Map<
      string,
      { addonId: number; priceOverride: number | null; basePrice: number | null; name: string | null }
    >();
    priceOverrides.forEach((entry) => {
      const addonRecord = entry.addon as Addon | undefined;
      if (!addonRecord?.name) {
        return;
      }
      const key = normalizeAddonName(addonRecord.name);
      if (!key) {
        return;
      }
      productAddonByName.set(key, {
        addonId: addonRecord.id,
        priceOverride: entry.priceOverride ?? null,
        basePrice: addonRecord.basePrice ?? null,
        name: addonRecord.name,
      });
    });

    const hasMissingAddonId = addons.some((addon) => !addon.addonId && addon.platformAddonName);
    const fallbackAddonByName = new Map<
      string,
      { addonId: number; priceOverride: number | null; basePrice: number | null; name: string | null }
    >();
    if (hasMissingAddonId) {
      const allAddons = await Addon.findAll({ attributes: ['id', 'name', 'basePrice'] });
      allAddons.forEach((addon) => {
        if (!addon.name) {
          return;
        }
        const key = normalizeAddonName(addon.name);
        if (!key) {
          return;
        }
        fallbackAddonByName.set(key, {
          addonId: addon.id,
          priceOverride: null,
          basePrice: addon.basePrice ?? null,
          name: addon.name,
        });
      });
    }

    const findAddonByName = (
      rawName: string | null,
    ): { addonId: number; priceOverride: number | null; basePrice: number | null; name: string | null } | null => {
      if (!rawName) {
        return null;
      }
      const normalized = normalizeAddonName(rawName);
      if (!normalized) {
        return null;
      }
      const direct = productAddonByName.get(normalized);
      if (direct) {
        return direct;
      }
      const fallbackDirect = fallbackAddonByName.get(normalized);
      if (fallbackDirect) {
        return fallbackDirect;
      }
      for (const [key, value] of productAddonByName.entries()) {
        if (normalized.includes(key) || key.includes(normalized)) {
          return value;
        }
      }
      for (const [key, value] of fallbackAddonByName.entries()) {
        if (normalized.includes(key) || key.includes(normalized)) {
          return value;
        }
      }
      return null;
    };

    res.status(200).json({
      bookingId: preview.bookingId,
      orderId: preview.orderId,
      externalTransactionId: preview.externalTransactionId,
      stripe: preview.stripe,
      remainingAmount: remaining,
      addons: addons.map((addon) => {
        const addonRecord = addon.addon as Addon | undefined;
        let addonId = addon.addonId ?? addonRecord?.id ?? null;
        const toNumber = (value: unknown): number | null => {
          if (value === null || value === undefined) {
            return null;
          }
          if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
          }
          if (typeof value === 'string') {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : null;
          }
          return null;
        };

        let override: number | null = addonId !== null ? toNumber(priceOverrideByAddonId.get(addonId)) : null;
        let fallbackBase = toNumber(addonRecord?.basePrice ?? null);
        if (addonId === null && addon.platformAddonName) {
          const mapped = findAddonByName(addon.platformAddonName);
          if (mapped) {
            addonId = mapped.addonId;
            override = toNumber(mapped.priceOverride);
            fallbackBase = toNumber(mapped.basePrice);
          }
        }
        const unitPriceValue = override ?? fallbackBase ?? null;
        const fallbackUnitPrice = addon.unitPrice ? Number.parseFloat(addon.unitPrice) : null;
        const computedUnitPrice =
          fallbackUnitPrice ??
          (addon.totalPrice && addon.quantity > 0
            ? Number.parseFloat(addon.totalPrice) / addon.quantity
            : null);
        return {
          id: addon.id,
          platformAddonName: addon.platformAddonName ?? addonRecord?.name ?? null,
          quantity: addon.quantity,
          unitPrice:
            unitPriceValue !== null
              ? unitPriceValue.toFixed(2)
              : computedUnitPrice !== null && Number.isFinite(computedUnitPrice)
                ? computedUnitPrice.toFixed(2)
                : null,
          totalPrice: addon.totalPrice,
          currency: addon.currency,
        };
      }),
    } satisfies PartialRefundPreview);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load partial refund preview';
    res.status(500).json({ message });
  }
};

export const partialRefundEcwidBooking = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be refunded through this endpoint' });
      return;
    }

    const rawAmount = (req.body as { amount?: unknown }).amount;
    const numericAmount = typeof rawAmount === 'string' ? Number.parseFloat(rawAmount) : Number(rawAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      res.status(400).json({ message: 'A valid refund amount is required' });
      return;
    }
    const amountInCents = Math.round(numericAmount * 100);

    const preview = await buildEcwidRefundPreview(booking);
    const remaining = Math.max(preview.stripe.amount - preview.stripe.amountRefunded, 0);
    if (amountInCents >= remaining) {
      res.status(400).json({ message: 'Refund amount must be less than the remaining paid amount. Use Cancel for full refunds.' });
      return;
    }

    const refund = await createStripeRefundFromSummary(preview.stripe, {
      bookingId: booking.id,
      orderId: preview.orderId,
    }, amountInCents);

    res.status(200).json({
      message: refund ? 'Partial refund issued successfully' : 'Unable to issue refund',
      refund,
      stripe: preview.stripe,
    });
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status ?? 502 : 500;
    const message = error instanceof Error ? error.message : 'Failed to issue partial refund';
    res.status(status).json({ message });
  }
};
