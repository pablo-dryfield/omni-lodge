import type { Response } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import Booking from '../models/Booking.js';
import BookingEvent from '../models/BookingEvent.js';
import Channel from '../models/Channel.js';
import Product from '../models/Product.js';
import ProductAlias from '../models/ProductAlias.js';
import { sendMessage as sendGmailMessage } from '../services/bookings/gmailClient.js';
import type { SendMessageResult } from '../services/bookings/gmailClient.js';
import { getConfigValue } from '../services/configService.js';
import type { BookingEventType, BookingPaymentStatus, BookingStatus } from '../constants/bookings.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import logger from '../utils/logger.js';
import { canonicalizeProductLabelFromSources, sanitizeProductSource } from '../utils/productName.js';

dayjs.extend(utc);
dayjs.extend(timezone);

type DirectBookingPayload = {
  platform?: string | null;
  platformBookingId?: string | null;
  platformOrderId?: string | null;
  status?: BookingStatus | null;
  paymentStatus?: BookingPaymentStatus | null;
  paymentMethod?: string | null;
  paymentMethodCountry?: string | null;
  stripeLivemode?: boolean | string | null;
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
const DISPLAY_TIMEZONE = 'Europe/Warsaw';
const MEETING_POINT = "St. Mary's Basilica, plac Mariacki 5, 31-042 Krakow, Poland";
const GUIDE_NOTE = "Look for the guide holding a pretzel on a stick.";
const PRODUCT_ALIAS_CACHE_TTL_MS = 60 * 1000;
let productAliasCache: { fetchedAt: number; records: ProductAlias[] } | null = null;

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

const normalizeStripeLivemode = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', 'live', 'livemode', '1', 'yes'].includes(normalized)) {
    return true;
  }
  if (['false', 'test', 'testmode', '0', 'no'].includes(normalized)) {
    return false;
  }

  return null;
};

const appendSystemNote = (notes: string | null, systemNote: string | null): string | null => {
  if (!systemNote) {
    return notes;
  }

  const normalizedSystemNote = systemNote.toLowerCase();
  const existingParts = (notes ?? '')
    .split(/\s*\|\s*|\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (existingParts.some((part) => part.toLowerCase() === normalizedSystemNote)) {
    return notes;
  }

  return [...existingParts, systemNote].join(' | ') || null;
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

const normalizeAliasLabel = (value: string): string => sanitizeProductSource(value).toLowerCase();

const loadProductAliases = async (): Promise<ProductAlias[]> => {
  const now = Date.now();
  if (productAliasCache && now - productAliasCache.fetchedAt < PRODUCT_ALIAS_CACHE_TTL_MS) {
    return productAliasCache.records;
  }

  const records = await ProductAlias.findAll({
    where: { active: true },
    order: [
      ['priority', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  productAliasCache = { fetchedAt: now, records };
  return records;
};

const resolveAliasProductId = (aliases: ProductAlias[], value: string): number | null => {
  const normalized = normalizeAliasLabel(value);
  if (!normalized) {
    return null;
  }

  for (const alias of aliases) {
    if (!alias.active || alias.productId == null) {
      continue;
    }
    if (alias.matchType === 'exact') {
      if (alias.normalizedLabel === normalized) {
        return alias.productId;
      }
      continue;
    }
    if (alias.matchType === 'contains') {
      if (normalized.includes(alias.normalizedLabel)) {
        return alias.productId;
      }
      continue;
    }
    if (alias.matchType === 'regex') {
      try {
        const matcher = new RegExp(alias.label, 'i');
        if (matcher.test(value)) {
          return alias.productId;
        }
      } catch (error) {
        logger.warn(`Invalid product alias regex: ${alias.label}`, error);
      }
    }
  }

  return null;
};

const findProductIdByLooseName = async (candidates: string[]): Promise<number | null> => {
  const products = await Product.findAll({
    attributes: ['id', 'name'],
    order: [['id', 'ASC']],
  });

  const normalizedCandidates = candidates
    .map((candidate) => normalizeAliasLabel(candidate))
    .filter(Boolean);

  for (const product of products) {
    const productName = normalizeAliasLabel(product.name);
    if (!productName) {
      continue;
    }
    if (normalizedCandidates.some((candidate) => candidate === productName)) {
      return product.id;
    }
  }

  for (const product of products) {
    const productName = normalizeAliasLabel(product.name);
    if (!productName) {
      continue;
    }
    if (
      normalizedCandidates.some(
        (candidate) => candidate.includes(productName) || productName.includes(candidate),
      )
    ) {
      return product.id;
    }
  }

  return null;
};

const resolveProductIdByName = async (name?: string | null): Promise<number | null> => {
  const normalized = normalizeOptionalString(name);
  if (!normalized) {
    return null;
  }

  const canonical = canonicalizeProductLabelFromSources([normalized]);
  const candidates = Array.from(new Set([normalized, canonical].filter(Boolean) as string[]));

  for (const candidate of candidates) {
    const product = await Product.findOne({
      where: { name: { [Op.iLike]: candidate } },
      attributes: ['id'],
    });
    if (product?.id != null) {
      return product.id;
    }
  }

  const aliases = await loadProductAliases();
  for (const candidate of candidates) {
    const aliasProductId = resolveAliasProductId(aliases, candidate);
    if (aliasProductId != null) {
      return aliasProductId;
    }
  }

  return findProductIdByLooseName(candidates);
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

  const stripeLivemode = normalizeStripeLivemode(payload.stripeLivemode);
  const normalizedNotes = appendSystemNote(
    normalizeOptionalString(payload.notes),
    typeof stripeLivemode === 'boolean' ? `Stripe livemode: ${stripeLivemode ? 'true' : 'false'}` : null,
  );

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
    notes: normalizedNotes,
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

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const stripHtml = (value: string): string =>
  value
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const SYSTEM_NOTE_PREFIXES = [
  'requested start time:',
  'stripe payment_intent:',
  'stripe payment intent:',
  'stripe livemode:',
  'stripe mode:',
  'checkout source:',
];

const sanitizeEmailHeaderPart = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();

const quoteEmailDisplayName = (value: string): string =>
  `"${sanitizeEmailHeaderPart(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const resolveDirectBookingEmailFrom = (): string | null => {
  const address = sanitizeEmailHeaderPart(String(getConfigValue('DIRECT_BOOKINGS_EMAIL_FROM_ADDRESS') ?? ''));
  if (!address) {
    return null;
  }

  const name = sanitizeEmailHeaderPart(String(getConfigValue('DIRECT_BOOKINGS_EMAIL_FROM_NAME') ?? 'Food Tour Krakow'));
  return name ? `${quoteEmailDisplayName(name)} <${address}>` : address;
};

const resolveDirectBookingNotificationEmail = (): string | null => {
  const email = sanitizeEmailHeaderPart(String(getConfigValue('DIRECT_BOOKINGS_NOTIFICATION_EMAIL') ?? ''));
  return email || null;
};

const extractCustomerNotes = (notes: string | null | undefined): string | null => {
  const rawNotes = notes?.trim();
  if (!rawNotes) {
    return null;
  }

  const customerNotes = rawNotes
    .split(/\s*\|\s*|\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const normalizedPart = part.toLowerCase();
      return !SYSTEM_NOTE_PREFIXES.some((prefix) => normalizedPart.startsWith(prefix));
    })
    .join(' | ')
    .trim();

  return customerNotes || null;
};

const formatDisplayDate = (value: string | Date | null): string => {
  if (!value) {
    return 'To be confirmed';
  }

  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('DD/MM/YYYY') : 'To be confirmed';
};

const formatDisplayTime = (value: Date | null): string => {
  if (!value) {
    return '2:00 PM';
  }

  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.tz(DISPLAY_TIMEZONE).format('h:mm A') : '2:00 PM';
};

const formatMoney = (amount: string | null, currency: string | null): string => {
  if (!amount) {
    return 'Paid';
  }

  const parsed = Number.parseFloat(amount);
  if (!Number.isFinite(parsed)) {
    return amount;
  }

  const normalizedCurrency = (currency ?? '').toUpperCase();
  const suffix = normalizedCurrency === 'PLN' ? 'zł' : normalizedCurrency || '';
  const normalizedAmount = Number.isInteger(parsed) ? parsed.toFixed(0) : parsed.toFixed(2);
  return `${normalizedAmount}${suffix ? ` ${suffix}` : ''}`;
};

const buildGuestName = (booking: Booking): string => {
  const fullName = [booking.guestFirstName, booking.guestLastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');

  return fullName || 'Guest';
};

const bookingInfoRow = (label: string, value: unknown): string => `
  <tr>
    <td style="padding:12px 0;color:#7d6b70;font-family:Arial,sans-serif;font-size:15px;">${escapeHtml(label)}</td>
    <td style="padding:12px 0;color:#2f2128;font-family:Arial,sans-serif;font-size:15px;font-weight:700;text-align:right;">${escapeHtml(value || '-')}</td>
  </tr>
`;

const buildDirectBookingConfirmationEmail = (booking: Booking): { subject: string; htmlBody: string; textBody: string } => {
  const guestName = buildGuestName(booking);
  const tourName = booking.productName ?? 'Krakow Food Tour';
  const orderNumber = booking.id;
  const date = formatDisplayDate(booking.experienceDate);
  const time = formatDisplayTime(booking.experienceStartAt);
  const guests = booking.partySizeTotal ?? 1;
  const totalPaid = formatMoney(booking.priceGross ?? booking.baseAmount, booking.currency);
  const notes = extractCustomerNotes(booking.notes);

  const htmlBody = `
<!doctype html>
<html>
  <body style="margin:0;background:#2f2128;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#fac7b3;border-radius:32px;padding:18px;font-family:Arial,sans-serif;">
      <div style="background:#fffaf6;border-radius:26px;padding:34px 28px;text-align:center;">
        <p style="margin:0 0 18px;color:#8b4a2e;font-family:Arial,sans-serif;font-size:13px;font-weight:800;letter-spacing:5px;text-transform:uppercase;">Booking confirmed</p>
        <h1 style="margin:0;color:#2f2128;font-family:Georgia,serif;font-size:44px;line-height:1.02;font-weight:500;">You are booked</h1>
        <p style="margin:18px 0 0;color:#4b3b40;font-size:17px;line-height:1.55;">Hi ${escapeHtml(guestName)}, your ${escapeHtml(tourName)} is confirmed. Bring your appetite.</p>

        <div style="margin:28px auto 0;background:#2f2128;color:#fff;border-radius:20px;padding:18px 20px;max-width:340px;">
          <div style="color:#e39b6e;font-size:12px;font-weight:900;letter-spacing:4px;text-transform:uppercase;">Order number</div>
          <div style="font-size:30px;font-weight:900;line-height:1.2;">${escapeHtml(orderNumber)}</div>
        </div>

        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:28px 0 0;border-collapse:collapse;border-top:1px solid #f0ded6;border-bottom:1px solid #f0ded6;">
          ${bookingInfoRow('Tour', tourName)}
          ${bookingInfoRow('Date', date)}
          ${bookingInfoRow('Start time', time)}
          ${bookingInfoRow('Guests', guests)}
          ${bookingInfoRow('Total paid', totalPaid)}
          ${bookingInfoRow('Payment method', booking.paymentMethod ?? 'Card')}
          ${bookingInfoRow('Customer email', booking.guestEmail)}
          ${bookingInfoRow('Customer phone', booking.guestPhone)}
        </table>

        ${
          notes
            ? `<div style="margin:24px 0 0;text-align:left;background:#fff3ed;border:1px solid #f0d2c3;border-radius:18px;padding:18px;color:#4b3b40;font-size:15px;line-height:1.55;"><strong style="color:#2f2128;">Dietary notes or requests</strong><br>${escapeHtml(notes)}</div>`
            : ''
        }

        <div style="margin:24px 0 0;background:#2f2128;color:#fff;border-radius:20px;padding:20px;font-size:15px;line-height:1.6;">
          <strong>Meeting point</strong><br>
          ${escapeHtml(MEETING_POINT)}<br>
          ${escapeHtml(GUIDE_NOTE)}
        </div>

        <p style="margin:24px 0 0;color:#7d6b70;font-size:13px;line-height:1.5;">If anything changes, reply to this email or contact us before your tour.</p>
      </div>
    </div>
  </body>
</html>`;

  const textBody = [
    'Booking confirmed',
    '',
    `Hi ${guestName}, your ${tourName} is confirmed.`,
    `Order number: ${orderNumber}`,
    `Date: ${date}`,
    `Start time: ${time}`,
    `Guests: ${guests}`,
    `Total paid: ${totalPaid}`,
    `Payment method: ${booking.paymentMethod ?? 'Card'}`,
    `Customer email: ${booking.guestEmail ?? ''}`,
    `Customer phone: ${booking.guestPhone ?? ''}`,
    notes ? `Dietary notes or requests: ${notes}` : null,
    '',
    `Meeting point: ${MEETING_POINT}`,
    GUIDE_NOTE,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return {
    subject: `Your ${tourName} booking is confirmed`,
    htmlBody,
    textBody: textBody || stripHtml(htmlBody),
  };
};

const buildInternalDirectBookingNotificationEmail = (
  booking: Booking,
): { subject: string; htmlBody: string; textBody: string } => {
  const guestName = buildGuestName(booking);
  const tourName = booking.productName ?? 'Krakow Food Tour';
  const date = formatDisplayDate(booking.experienceDate);
  const time = formatDisplayTime(booking.experienceStartAt);
  const guests = booking.partySizeTotal ?? 1;
  const totalPaid = formatMoney(booking.priceGross ?? booking.baseAmount, booking.currency);
  const notes = extractCustomerNotes(booking.notes);
  const parsedDate = booking.experienceDate ? dayjs(booking.experienceDate) : null;
  const subjectDate = parsedDate?.isValid() ? parsedDate.format('ddd, MMM D, YYYY') : date;
  const subject = `New Booking for ${subjectDate} (${booking.id})`;

  const htmlBody = `
<!doctype html>
<html>
  <body style="margin:0;background:#2f2128;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#fac7b3;border-radius:28px;padding:18px;font-family:Arial,sans-serif;">
      <div style="background:#fffaf6;border-radius:22px;padding:30px 26px;">
        <p style="margin:0 0 14px;color:#8b4a2e;font-size:13px;font-weight:800;letter-spacing:4px;text-transform:uppercase;text-align:center;">New direct booking</p>
        <h1 style="margin:0;color:#2f2128;font-family:Georgia,serif;font-size:36px;line-height:1.08;font-weight:500;text-align:center;">${escapeHtml(tourName)}</h1>
        <div style="margin:24px auto;background:#2f2128;color:#fff;border-radius:18px;padding:16px 18px;max-width:320px;text-align:center;">
          <div style="color:#e39b6e;font-size:12px;font-weight:900;letter-spacing:3px;text-transform:uppercase;">Omni-Lodge reference</div>
          <div style="font-size:28px;font-weight:900;line-height:1.2;">${escapeHtml(booking.id)}</div>
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border-top:1px solid #f0ded6;border-bottom:1px solid #f0ded6;">
          ${bookingInfoRow('Tour', tourName)}
          ${bookingInfoRow('Date', date)}
          ${bookingInfoRow('Start time', time)}
          ${bookingInfoRow('Guests', guests)}
          ${bookingInfoRow('Guest name', guestName)}
          ${bookingInfoRow('Guest email', booking.guestEmail)}
          ${bookingInfoRow('Guest phone', booking.guestPhone)}
          ${bookingInfoRow('Total paid', totalPaid)}
          ${bookingInfoRow('Payment method', booking.paymentMethod ?? 'Card')}
          ${bookingInfoRow('Platform booking ID', booking.platformBookingId)}
        </table>
        ${
          notes
            ? `<div style="margin:24px 0 0;background:#fff3ed;border:1px solid #f0d2c3;border-radius:18px;padding:18px;color:#4b3b40;font-size:15px;line-height:1.55;"><strong style="color:#2f2128;">Dietary notes or requests</strong><br>${escapeHtml(notes)}</div>`
            : ''
        }
      </div>
    </div>
  </body>
</html>`;

  const textBody = [
    'New direct booking',
    '',
    `Omni-Lodge reference: ${booking.id}`,
    `Tour: ${tourName}`,
    `Date: ${date}`,
    `Start time: ${time}`,
    `Guests: ${guests}`,
    `Guest name: ${guestName}`,
    `Guest email: ${booking.guestEmail ?? ''}`,
    `Guest phone: ${booking.guestPhone ?? ''}`,
    `Total paid: ${totalPaid}`,
    `Payment method: ${booking.paymentMethod ?? 'Card'}`,
    `Platform booking ID: ${booking.platformBookingId ?? ''}`,
    notes ? `Dietary notes or requests: ${notes}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return {
    subject,
    htmlBody,
    textBody: textBody || stripHtml(htmlBody),
  };
};

const sendDirectBookingConfirmationEmail = async (booking: Booking): Promise<SendMessageResult | null> => {
  const to = booking.guestEmail?.trim();
  if (!to) {
    logger.warn(`[direct-bookings] Skipping confirmation email for booking ${booking.id}: missing guest email`);
    return null;
  }

  const email = buildDirectBookingConfirmationEmail(booking);
  const result = await sendGmailMessage({
    to,
    from: resolveDirectBookingEmailFrom(),
    subject: email.subject,
    textBody: email.textBody,
    htmlBody: email.htmlBody,
  });

  logger.info(`[direct-bookings] Sent confirmation email for booking ${booking.id}`, {
    messageId: result.id,
    rfcMessageId: result.rfcMessageId,
    threadId: result.threadId,
    labelIds: result.labelIds,
    to: result.to,
    from: result.from,
  });

  return result;
};

const sendInternalDirectBookingNotificationEmail = async (
  booking: Booking,
): Promise<SendMessageResult | null> => {
  const to = resolveDirectBookingNotificationEmail();
  if (!to) {
    logger.warn(`[direct-bookings] Skipping internal notification for booking ${booking.id}: missing notification email`);
    return null;
  }

  const email = buildInternalDirectBookingNotificationEmail(booking);
  const result = await sendGmailMessage({
    to,
    from: resolveDirectBookingEmailFrom(),
    subject: email.subject,
    textBody: email.textBody,
    htmlBody: email.htmlBody,
  });

  logger.info(`[direct-bookings] Sent internal notification email for booking ${booking.id}`, {
    messageId: result.id,
    rfcMessageId: result.rfcMessageId,
    threadId: result.threadId,
    labelIds: result.labelIds,
    to: result.to,
    from: result.from,
  });

  return result;
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

    let customerEmailStatus: 'sent' | 'skipped' | 'failed' = 'skipped';
    let customerEmailMessageId: string | null = null;
    let customerEmailFrom: string | null = null;
    let customerEmailTo: string | null = result.booking.guestEmail ?? null;
    let customerEmailRfcMessageId: string | null = null;
    let customerEmailLabelIds: string[] = [];
    let internalEmailStatus: 'sent' | 'skipped' | 'failed' = 'skipped';
    let internalEmailMessageId: string | null = null;
    let internalEmailFrom: string | null = null;
    let internalEmailTo: string | null = resolveDirectBookingNotificationEmail();

    if (result.eventType === 'created') {
      try {
        const emailResult = await sendDirectBookingConfirmationEmail(result.booking);
        if (emailResult) {
          customerEmailStatus = 'sent';
          customerEmailMessageId = emailResult.id;
          customerEmailFrom = emailResult.from ?? null;
          customerEmailTo = emailResult.to ?? customerEmailTo;
          customerEmailRfcMessageId = emailResult.rfcMessageId ?? null;
          customerEmailLabelIds = emailResult.labelIds ?? [];
        }
      } catch (emailError) {
        customerEmailStatus = 'failed';
        logger.error(
          `[direct-bookings] Failed to send confirmation email for booking ${result.booking.id}: ${(emailError as Error).message}`,
        );
      }

      try {
        const internalEmailResult = await sendInternalDirectBookingNotificationEmail(result.booking);
        if (internalEmailResult) {
          internalEmailStatus = 'sent';
          internalEmailMessageId = internalEmailResult.id;
          internalEmailFrom = internalEmailResult.from ?? null;
          internalEmailTo = internalEmailResult.to ?? internalEmailTo;
        }
      } catch (emailError) {
        internalEmailStatus = 'failed';
        logger.error(
          `[direct-bookings] Failed to send internal notification email for booking ${result.booking.id}: ${(emailError as Error).message}`,
        );
      }
    }

    res.status(result.eventType === 'created' ? 201 : 200).json({
      status: result.eventType === 'created' ? 'created' : result.eventType === 'amended' ? 'updated' : 'exists',
      bookingId: result.booking.id,
      platform: result.booking.platform,
      platformBookingId: result.booking.platformBookingId,
      eventType: result.eventType,
      customerEmailStatus,
      customerEmailMessageId,
      customerEmailFrom,
      customerEmailTo,
      customerEmailRfcMessageId,
      customerEmailLabelIds,
      internalEmailStatus,
      internalEmailMessageId,
      internalEmailFrom,
      internalEmailTo,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to ingest direct booking';
    res.status(400).json({ message });
  }
};
