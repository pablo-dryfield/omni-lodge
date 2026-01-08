import { Request, Response } from 'express';
import { isAxiosError } from 'axios';
import { Op, type WhereOptions, fn, col, where as sequelizeWhere } from 'sequelize';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import Booking from '../models/Booking.js';
import Channel from '../models/Channel.js';
import Product from '../models/Product.js';
import stripe from '../finance/services/stripeClient.js';
import type Stripe from 'stripe';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  canonicalizeProductKeyFromLabel,
  canonicalizeProductKeyFromSources,
  canonicalizeProductLabelFromSources,
} from '../utils/productName.js';
import { ingestLatestBookingEmails } from '../services/bookings/bookingIngestionService.js';
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
  const fallbackTotal = booking.partySizeTotal ?? booking.partySizeAdults ?? null;
  let menCount = snapshotBreakdown.men;
  let womenCount = snapshotBreakdown.women;
  if (menCount === null && womenCount === null) {
    menCount = booking.partySizeAdults ?? booking.partySizeTotal ?? 0;
    womenCount = booking.partySizeChildren ?? 0;
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
      if (combined === 0) {
        menCount = fallbackTotal;
        womenCount = 0;
      } else if (combined !== fallbackTotal) {
        const scale = fallbackTotal / combined;
        menCount = Math.max(Math.round(menCount * scale), 0);
        womenCount = Math.max(fallbackTotal - menCount, 0);
      }
      if (menCount > fallbackTotal) {
        menCount = fallbackTotal;
        womenCount = 0;
      }
      if (womenCount > fallbackTotal) {
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
    const message = error instanceof Error ? error.message : 'Failed to load refund preview';
    res.status(500).json({ message });
  }
};
