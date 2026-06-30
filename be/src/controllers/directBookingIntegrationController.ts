import type { Response } from 'express';
import dayjs from 'dayjs';
import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import Booking from '../models/Booking.js';
import BookingEvent from '../models/BookingEvent.js';
import Channel from '../models/Channel.js';
import Product from '../models/Product.js';
import type { BookingEventType, BookingPaymentStatus, BookingStatus } from '../constants/bookings.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

type DirectBookingPayload = {
  platform?: string | null;
  platformBookingId?: string | null;
  platformOrderId?: string | null;
  status?: BookingStatus | null;
  paymentStatus?: BookingPaymentStatus | null;
  paymentMethod?: string | null;
  paymentMethodCountry?: string | null;
  currency?: string | null;
  baseAmount?: number | string | null;
  addonsAmount?: number | string | null;
  discountAmount?: number | string | null;
  discountCode?: string | null;
  tipAmount?: number | string | null;
  processingFee?: number | string | null;
  processingFeeCurrency?: string | null;
  priceGross?: number | string | null;
  priceNet?: number | string | null;
  commissionAmount?: number | string | null;
  commissionRate?: number | string | null;
  experienceDate?: string | null;
  experienceStartAt?: string | null;
  productId?: number | string | null;
  productName?: string | null;
  productVariant?: string | null;
  channelId?: number | string | null;
  channelName?: string | null;
  guestFirstName?: string | null;
  guestLastName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  partySizeTotal?: number | string | null;
  partySizeAdults?: number | string | null;
  partySizeChildren?: number | string | null;
  addonsSnapshot?: Record<string, unknown> | null;
  notes?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  ipAddress?: string | null;
  sourceReceivedAt?: string | null;
  processedAt?: string | null;
};

type BookingPatch = {
  platform: string;
  platformBookingId: string;
  platformOrderId: string | null;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  paymentMethod: string | null;
  paymentMethodCountry: string | null;
  currency: string | null;
  baseAmount: string | null;
  addonsAmount: string | null;
  discountAmount: string | null;
  discountCode: string | null;
  tipAmount: string | null;
  processingFee: string | null;
  processingFeeCurrency: string | null;
  priceGross: string | null;
  priceNet: string | null;
  commissionAmount: string | null;
  commissionRate: string | null;
  experienceDate: string | null;
  experienceStartAt: Date | null;
  productId: number | null;
  productName: string | null;
  productVariant: string | null;
  channelId: number | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  partySizeTotal: number | null;
  partySizeAdults: number | null;
  partySizeChildren: number | null;
  addonsSnapshot: Record<string, unknown> | null;
  notes: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  ipAddress: string | null;
  sourceReceivedAt: Date | null;
  processedAt: Date | null;
  statusChangedAt: Date;
  cancelledAt: Date | null;
};

const DEFAULT_PLATFORM = 'direct';
const DEFAULT_STATUS: BookingStatus = 'confirmed';
const DEFAULT_PAYMENT_STATUS: BookingPaymentStatus = 'paid';
const DIRECT_CHANNEL_CANDIDATES = ['Direct', 'Website', 'Web', 'Direct Website'];

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeCurrency = (value: unknown): string | null => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  return normalized.toUpperCase().slice(0, 3);
};

const normalizeNullableDecimal = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value.trim().replace(',', '.'))
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed.toFixed(2);
};

const normalizeNullableInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
};

const normalizeDateOnly = (value: unknown): string | null => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  const parsed = dayjs(normalized);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
};

const normalizeDateTime = (value: unknown): Date | null => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  const parsed = dayjs(normalized);
  return parsed.isValid() ? parsed.toDate() : null;
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

const resolveDirectChannelId = async (explicitName?: string | null): Promise<number | null> => {
  const candidates = [explicitName, ...DIRECT_CHANNEL_CANDIDATES].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const resolved = await resolveChannelIdByName(candidate);
    if (resolved != null) {
      return resolved;
    }
  }

  return null;
};

const resolveProductIdByName = async (name?: string | null): Promise<number | null> => {
  const normalized = normalizeOptionalString(name);
  if (!normalized) {
    return null;
  }

  const product = await Product.findOne({
    where: { name: { [Op.iLike]: normalized } },
    attributes: ['id'],
  });

  return product?.id ?? null;
};

const resolveProductId = async (payload: DirectBookingPayload): Promise<number | null> => {
  const explicitProductId = normalizeNullableInteger(payload.productId);
  if (explicitProductId != null) {
    return explicitProductId;
  }

  return resolveProductIdByName(payload.productName);
};

const resolveGuestNames = (payload: DirectBookingPayload): { firstName: string | null; lastName: string | null } => {
  const firstName = normalizeOptionalString(payload.guestFirstName);
  const lastName = normalizeOptionalString(payload.guestLastName);

  if (firstName || lastName) {
    return { firstName, lastName };
  }

  const emailName = normalizeOptionalString(payload.guestEmail)?.split('@')[0] ?? null;
  return splitCustomerName(emailName);
};

const readRequestIp = (req: AuthenticatedRequest): string | null => {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  return req.ip ?? null;
};

const buildPatch = async (payload: DirectBookingPayload, req: AuthenticatedRequest): Promise<BookingPatch> => {
  const platformBookingId = normalizeOptionalString(payload.platformBookingId);
  if (!platformBookingId) {
    throw new Error('platformBookingId is required');
  }

  const experienceDate = normalizeDateOnly(payload.experienceDate);
  if (!experienceDate) {
    throw new Error('experienceDate is required and must be a valid date');
  }

  const productName = normalizeOptionalString(payload.productName);
  if (!productName) {
    throw new Error('productName is required');
  }

  const guestCount = normalizeNullableInteger(payload.partySizeTotal);
  if (guestCount == null || guestCount <= 0) {
    throw new Error('partySizeTotal is required and must be greater than 0');
  }

  const names = resolveGuestNames(payload);
  const guestEmail = normalizeOptionalString(payload.guestEmail);
  if (!guestEmail) {
    throw new Error('guestEmail is required');
  }

  return {
    platform: normalizeOptionalString(payload.platform) ?? DEFAULT_PLATFORM,
    platformBookingId,
    platformOrderId: normalizeOptionalString(payload.platformOrderId) ?? platformBookingId,
    status: payload.status ?? DEFAULT_STATUS,
    paymentStatus: payload.paymentStatus ?? DEFAULT_PAYMENT_STATUS,
    paymentMethod: normalizeOptionalString(payload.paymentMethod),
    paymentMethodCountry: normalizeOptionalString(payload.paymentMethodCountry),
    currency: normalizeCurrency(payload.currency),
    baseAmount: normalizeNullableDecimal(payload.baseAmount),
    addonsAmount: normalizeNullableDecimal(payload.addonsAmount),
    discountAmount: normalizeNullableDecimal(payload.discountAmount),
    discountCode: normalizeOptionalString(payload.discountCode),
    tipAmount: normalizeNullableDecimal(payload.tipAmount),
    processingFee: normalizeNullableDecimal(payload.processingFee),
    processingFeeCurrency: normalizeCurrency(payload.processingFeeCurrency),
    priceGross: normalizeNullableDecimal(payload.priceGross),
    priceNet: normalizeNullableDecimal(payload.priceNet),
    commissionAmount: normalizeNullableDecimal(payload.commissionAmount),
    commissionRate: normalizeNullableDecimal(payload.commissionRate),
    experienceDate,
    experienceStartAt: normalizeDateTime(payload.experienceStartAt),
    productId: await resolveProductId(payload),
    productName,
    productVariant: normalizeOptionalString(payload.productVariant),
    channelId:
      normalizeNullableInteger(payload.channelId) ?? (await resolveDirectChannelId(payload.channelName)),
    guestFirstName: names.firstName,
    guestLastName: names.lastName,
    guestEmail,
    guestPhone: normalizeOptionalString(payload.guestPhone),
    partySizeTotal: guestCount,
    partySizeAdults: normalizeNullableInteger(payload.partySizeAdults) ?? guestCount,
    partySizeChildren: normalizeNullableInteger(payload.partySizeChildren),
    addonsSnapshot:
      payload.addonsSnapshot && typeof payload.addonsSnapshot === 'object' && !Array.isArray(payload.addonsSnapshot)
        ? payload.addonsSnapshot
        : null,
    notes: normalizeOptionalString(payload.notes),
    utmSource: normalizeOptionalString(payload.utmSource),
    utmMedium: normalizeOptionalString(payload.utmMedium),
    utmCampaign: normalizeOptionalString(payload.utmCampaign),
    ipAddress: normalizeOptionalString(payload.ipAddress) ?? readRequestIp(req),
    sourceReceivedAt: normalizeDateTime(payload.sourceReceivedAt),
    processedAt: normalizeDateTime(payload.processedAt) ?? new Date(),
    statusChangedAt: new Date(),
    cancelledAt: payload.status === 'cancelled' ? new Date() : null,
  };
};

const assignBookingPatch = (booking: Booking, patch: BookingPatch, userId: number | null): boolean => {
  const nextState = {
    ...patch,
    createdBy: booking.id ? booking.createdBy : userId,
    updatedBy: userId,
  };

  let changed = false;

  for (const [key, value] of Object.entries(nextState)) {
    const typedKey = key as keyof typeof nextState;
    const currentValue = booking.get(typedKey as keyof Booking);
    const currentSerialized = currentValue instanceof Date ? currentValue.toISOString() : JSON.stringify(currentValue);
    const nextSerialized = value instanceof Date ? value.toISOString() : JSON.stringify(value);

    if (currentSerialized !== nextSerialized) {
      booking.set(typedKey as keyof Booking, value as never);
      changed = true;
    }
  }

  return changed;
};

const createBookingEvent = async (
  booking: Booking,
  eventType: BookingEventType,
  payload: DirectBookingPayload,
  transaction: Transaction,
): Promise<void> => {
  await BookingEvent.create(
    {
      bookingId: booking.id,
      eventType,
      platform: booking.platform,
      statusAfter: booking.status,
      eventPayload: payload as Record<string, unknown>,
      occurredAt: booking.processedAt ?? new Date(),
      processedAt: new Date(),
    } as BookingEvent,
    { transaction },
  );
};

export const ingestDirectBooking = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const payload = (req.body ?? {}) as DirectBookingPayload;

  try {
    const patch = await buildPatch(payload, req);
    const userId = req.authContext?.id ?? null;

    const result = await sequelize.transaction(async (transaction) => {
      let booking = await Booking.findOne({
        where: {
          platform: patch.platform,
          platformBookingId: patch.platformBookingId,
        },
        transaction,
      });

      let eventType: BookingEventType = 'created';

      if (!booking) {
        booking = Booking.build({
          platform: patch.platform,
          platformBookingId: patch.platformBookingId,
        } as Booking);
      } else {
        eventType = 'replayed';
      }

      const changed = assignBookingPatch(booking, patch, userId);
      if (eventType !== 'created' && changed) {
        eventType = 'amended';
      }

      await booking.save({ transaction });
      await createBookingEvent(booking, eventType, payload, transaction);

      return {
        booking,
        eventType,
      };
    });

    res.status(result.eventType === 'created' ? 201 : 200).json({
      status: result.eventType === 'created' ? 'created' : result.eventType === 'amended' ? 'updated' : 'exists',
      bookingId: result.booking.id,
      platform: result.booking.platform,
      platformBookingId: result.booking.platformBookingId,
      eventType: result.eventType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to ingest direct booking';
    res.status(400).json({ message });
  }
};
