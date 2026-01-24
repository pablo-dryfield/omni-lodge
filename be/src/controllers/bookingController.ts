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
import Product from '../models/Product.js';
import HttpError from '../errors/HttpError.js';
import { getStripeClient } from '../finance/services/stripeClient.js';
import type Stripe from 'stripe';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  canonicalizeProductKeyFromLabel,
  canonicalizeProductKeyFromSources,
  canonicalizeProductLabelFromSources,
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
import { BOOKING_STATUSES } from '../constants/bookings.js';
import { getEcwidOrder, updateEcwidOrder, type EcwidExtraField, type EcwidOrder } from '../services/ecwidService.js';
import { getConfigValue } from '../services/configService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const DATE_FORMAT = 'YYYY-MM-DD';
const DISPLAY_TIMEZONE = 'Europe/Warsaw';
const STORE_TIMEZONE = 'Europe/Warsaw';

type RangeBoundary = 'start' | 'end';

type QueryParams = {
  date?: string;
  pickupFrom?: string;
  pickupTo?: string;
  productId?: string;
  time?: string;
  search?: string;
};

type AmendEcwidRequestBody = {
  pickupDate?: string;
  pickupTime?: string;
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
  const sources = [booking.productName ?? null, booking.product?.name ?? null, booking.productVariant ?? null];
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

  return {
    id: String(booking.id),
    platformBookingId: booking.platformBookingId,
    platformBookingUrl: booking.rawPayloadLocation ?? null,
    productId,
    productName: displayProductName,
    date: experienceDate,
    timeslot,
    quantity,
    menCount,
    womenCount,
    customerName: buildCustomerName(booking),
    customerPhone: booking.guestPhone ?? undefined,
    platform: booking.platform,
    pickupDateTime: pickupMomentUtc?.isValid() ? pickupMomentUtc.toISOString() : undefined,
    extras,
    status: booking.status,
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

    const rows = await Booking.findAll({
      where: hasSearch ? buildSearchWhere(searchTerm) : { experienceDate: targetDate },
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
          if (productId && order.productId !== productId) {
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
      },
    );

    summary.platformBreakdown.sort((a, b) => a.platform.localeCompare(b.platform));
    for (const status of BOOKING_STATUSES) {
      if (!(status in summary.statusCounts)) {
        summary.statusCounts[status] = 0;
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
