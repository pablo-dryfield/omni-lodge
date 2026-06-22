import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { Op } from 'sequelize';
import database from '../config/database.js';
import Booking from '../models/Booking.js';
import BookingEvent from '../models/BookingEvent.js';
import Channel from '../models/Channel.js';
import Product from '../models/Product.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftTypeProduct from '../models/ShiftTypeProduct.js';
import HttpError from '../errors/HttpError.js';
import { getConfigValue } from './configService.js';
import { listScheduledStaffForProduct } from './scheduleService.js';
import type { BookingEventType, BookingStatus } from '../constants/bookings.js';
import type { BookingFieldPatch } from './bookings/types.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

type GygOperation = 'reserve' | 'cancel' | 'upsert' | 'health';

type GygIngestOptions = {
  operation?: Exclude<GygOperation, 'health'>;
  requestedPlatformBookingId?: string | null;
};

type GygIngestResult = {
  booking: Booking;
  bookingEvent: BookingEvent;
  createdBooking: boolean;
  eventType: BookingEventType;
  status: BookingStatus;
};

type GygBookingFieldPatch = BookingFieldPatch & {
  platformOrderId?: string | null;
};

type GygAvailabilityResult = {
  productId: string;
  productName: string | null;
  timezone: string;
  availabilities: GygAvailabilitySlot[];
};

type GygAvailabilitySlot = {
  productId: string;
  datetime: string;
  dateTime: string;
  vacancies: number;
  cutoffSeconds: number;
};

const GYG_PLATFORM = 'getyourguide';
const GYG_CHANNEL_NAME = 'GetYourGuide';
const DEFAULT_TIMEZONE =
  (getConfigValue('GETYOURGUIDE_TIMEZONE') as string | null) ??
  (getConfigValue('BOOKING_PARSER_TIMEZONE') as string | null) ??
  'Europe/Warsaw';

const channelIdCache = new Map<string, number | null>();

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
};

const normalizeNumberish = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const cleaned = trimmed.replace(/[^\d,.-]/g, '');
  const normalized =
    cleaned.includes(',') && cleaned.includes('.')
      ? cleaned.replace(/,/g, '')
      : cleaned.includes(',')
        ? cleaned.replace(/,/g, '.')
        : cleaned;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const collectRecordCandidates = (input: unknown, maxDepth = 3): Record<string, unknown>[] => {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }];
  const visited = new WeakSet<object>();
  const records: Record<string, unknown>[] = [];

  while (queue.length > 0) {
    const { value, depth } = queue.shift() as { value: unknown; depth: number };
    if (!value || typeof value !== 'object') {
      continue;
    }
    if (visited.has(value as object)) {
      continue;
    }
    visited.add(value as object);

    if (Array.isArray(value)) {
      if (depth < maxDepth) {
        for (const entry of value) {
          queue.push({ value: entry, depth: depth + 1 });
        }
      }
      continue;
    }

    records.push(value as Record<string, unknown>);
    if (depth >= maxDepth) {
      continue;
    }

    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      if (nestedValue && typeof nestedValue === 'object') {
        queue.push({ value: nestedValue, depth: depth + 1 });
      }
    }
  }

  return records;
};

const readFirstText = (records: Record<string, unknown>[], keys: string[]): string | null => {
  for (const record of records) {
    for (const key of keys) {
      const candidate = normalizeText(record[key]);
      if (candidate) {
        return candidate;
      }
    }
  }
  return null;
};

const readFirstNumber = (records: Record<string, unknown>[], keys: string[]): number | null => {
  for (const record of records) {
    for (const key of keys) {
      const candidate = normalizeNumberish(record[key]);
      if (candidate !== null) {
        return candidate;
      }
    }
  }
  return null;
};

const readFirstArray = (records: Record<string, unknown>[], keys: string[]): unknown[] | null => {
  for (const record of records) {
    for (const key of keys) {
      const candidate = record[key];
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }
  return null;
};

const parseTimeOfDay = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const parsed = dayjs(value, ['HH:mm', 'H:mm', 'HH:mm:ss', 'H:mm:ss', 'h:mm A', 'h:mmA', 'h A', 'ha'], true);
  return parsed.isValid() ? parsed.format('HH:mm') : null;
};

const extractDateOnly = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[1];
  }

  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
};

const parseDateTime = (dateValue: string | null, timeValue: string | null): Date | null => {
  const dateOnly = extractDateOnly(dateValue);
  if (!dateOnly) {
    return null;
  }

  if (dateValue && /[tT]\d{2}:\d{2}/.test(dateValue) && /(?:z|[+-]\d{2}:?\d{2})$/i.test(dateValue)) {
    const parsed = dayjs(dateValue);
    return parsed.isValid() ? parsed.toDate() : null;
  }

  const normalizedTime = parseTimeOfDay(timeValue);
  if (normalizedTime) {
    const parsed = dayjs.tz(`${dateOnly} ${normalizedTime}`, 'YYYY-MM-DD HH:mm', DEFAULT_TIMEZONE);
    return parsed.isValid() ? parsed.toDate() : null;
  }

  const parsed = dayjs.tz(`${dateOnly} 00:00`, 'YYYY-MM-DD HH:mm', DEFAULT_TIMEZONE);
  return parsed.isValid() ? parsed.toDate() : null;
};

const formatOffsetDateTime = (date: string, time: string, timezoneName: string): string => {
  const parsed = dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', timezoneName);
  return parsed.format('YYYY-MM-DDTHH:mm:ssZ');
};

const parseMoney = (value: unknown): string | null => {
  const numeric = normalizeNumberish(value);
  return numeric === null ? null : numeric.toFixed(2);
};

const normalizeStatus = (rawStatus: string | null, fallback: BookingStatus): BookingStatus => {
  if (!rawStatus) {
    return fallback;
  }

  const normalized = rawStatus.toLowerCase();
  if (normalized.includes('cancel')) {
    return 'cancelled';
  }
  if (normalized.includes('amend') || normalized.includes('modify') || normalized.includes('change') || normalized.includes('update') || normalized.includes('resched') || normalized.includes('rebook')) {
    return 'amended';
  }
  if (normalized.includes('complete') || normalized.includes('fulfilled')) {
    return 'completed';
  }
  if (normalized.includes('no show') || normalized.includes('noshow')) {
    return 'no_show';
  }
  if (normalized.includes('pending') || normalized.includes('request') || normalized.includes('hold')) {
    return 'pending';
  }
  if (normalized.includes('confirm') || normalized.includes('book') || normalized.includes('accept') || normalized.includes('reserve')) {
    return 'confirmed';
  }
  return fallback;
};

const deriveEventType = (status: BookingStatus, bookingExists: boolean): BookingEventType => {
  if (status === 'cancelled') {
    return 'cancelled';
  }
  if (bookingExists) {
    return 'amended';
  }
  return 'created';
};

const resolveChannelId = async (): Promise<number | null> => {
  const cached = channelIdCache.get(GYG_CHANNEL_NAME);
  if (cached !== undefined) {
    return cached;
  }

  const configuredMapRaw = getConfigValue('BOOKING_PLATFORM_CHANNEL_MAP');
  let configuredName: string | null = null;
  if (typeof configuredMapRaw === 'string' && configuredMapRaw.trim()) {
    try {
      const parsed = JSON.parse(configuredMapRaw) as Record<string, unknown>;
      const mapped = parsed[GYG_PLATFORM];
      configuredName = typeof mapped === 'string' ? mapped.trim() : null;
    } catch {
      configuredName = null;
    }
  }
  if (!configuredName) {
    configuredName = GYG_CHANNEL_NAME;
  }

  const channel = await Channel.findOne({ where: { name: configuredName } });
  const channelId = channel?.id ?? null;
  channelIdCache.set(GYG_CHANNEL_NAME, channelId);
  return channelId;
};

const resolvePlatformBookingId = (payload: unknown, requestedPlatformBookingId?: string | null): string => {
  const records = collectRecordCandidates(payload);
  const candidate =
    normalizeText(requestedPlatformBookingId) ??
    readFirstText(records, [
      'gygBookingReference',
      'gyg_booking_reference',
      'platformBookingId',
      'platform_booking_id',
      'bookingReference',
      'booking_reference',
      'bookingId',
      'booking_id',
      'reservationId',
      'reservation_id',
      'reservationReference',
      'reservation_reference',
      'confirmationNumber',
      'confirmation_number',
      'reference',
      'id',
      'code',
    ]);

  if (!candidate) {
    throw new HttpError(400, 'Unable to determine GetYourGuide booking reference');
  }

  return candidate;
};

const generateReservationReference = (): string => {
  const timestampPart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 6);
  return `res${timestampPart}${randomPart}`.slice(0, 25);
};

const MAX_GYG_PARTICIPANTS = 99;
const GYG_SUPPORTED_CATEGORIES = new Set([
  'ADULT',
  'SENIOR',
  'YOUTH',
  'INFANT',
  'STUDENT',
  'EU_CITIZEN',
  'MILITARY',
  'EU_CITIZEN_STUDENT',
  'GROUP',
  'COLLECTIVE',
]);

const normalizeCategory = (value: unknown): string | null => {
  const text = normalizeText(value);
  return text ? text.toUpperCase() : null;
};

const readBookingItems = (records: Record<string, unknown>[]): Record<string, unknown>[] => {
  const bookingItems = readFirstArray(records, ['bookingItems', 'booking_items']);
  return bookingItems?.filter(isRecord) ?? [];
};

const sumRequestedParticipants = (bookingItems: Record<string, unknown>[]): number => {
  return bookingItems.reduce((total, bookingItem) => {
    const category = normalizeCategory(bookingItem.category);
    const count = normalizeNumberish(bookingItem.count);
    const groupSize = normalizeNumberish(bookingItem.groupSize);

    if (category === 'GROUP' || category === 'COLLECTIVE') {
      return total + (groupSize ?? count ?? 1);
    }

    return total + (count ?? 0);
  }, 0);
};

const listGygAvailabilitySlots = async (
  productId: number,
  from: dayjs.Dayjs,
  to: dayjs.Dayjs,
  timezoneName: string,
): Promise<GygAvailabilitySlot[]> => {
  const shiftTypeLinks = await ShiftTypeProduct.findAll({ where: { productId } });
  const shiftTypeIds = shiftTypeLinks.map((link) => link.shiftTypeId);

  if (shiftTypeIds.length === 0) {
    return [];
  }

  const instances = await ShiftInstance.findAll({
    where: {
      shiftTypeId: { [Op.in]: shiftTypeIds },
      date: { [Op.between]: [from.format('YYYY-MM-DD'), to.format('YYYY-MM-DD')] },
    },
    include: [{ model: ShiftAssignment, as: 'assignments', required: false }],
    order: [
      ['date', 'ASC'],
      ['timeStart', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  const bookingRows = await Booking.findAll({
    where: {
      platform: GYG_PLATFORM,
      productId,
      experienceDate: { [Op.between]: [from.format('YYYY-MM-DD'), to.format('YYYY-MM-DD')] },
      status: { [Op.ne]: 'cancelled' },
    },
    attributes: ['experienceDate', 'partySizeTotal', 'partySizeAdults', 'partySizeChildren'],
  });

  const participantsByDate = new Map<string, number>();
  bookingRows.forEach((booking) => {
    const bookingDate = booking.experienceDate?.trim();
    if (!bookingDate) {
      return;
    }
    const adults = Number(booking.partySizeAdults ?? 0);
    const children = Number(booking.partySizeChildren ?? 0);
    const partySizeTotal = Number(booking.partySizeTotal ?? 0);
    const totalParticipants =
      Number.isFinite(partySizeTotal) && partySizeTotal > 0
        ? partySizeTotal
        : Number.isFinite(adults + children) && adults + children > 0
          ? adults + children
          : 1;
    participantsByDate.set(bookingDate, (participantsByDate.get(bookingDate) ?? 0) + totalParticipants);
  });

  return instances
    .map((instance) => {
      const assignedCapacity = Array.isArray(instance.assignments) ? instance.assignments.length : 0;
      const configuredCapacity = normalizeNumberish(instance.capacity) ?? 0;
      const dailyCapacity = configuredCapacity > 0 ? configuredCapacity : assignedCapacity;
      if (dailyCapacity <= 0) {
        return null;
      }

      const bookedParticipants = participantsByDate.get(instance.date) ?? 0;
      const vacancies = Math.max(dailyCapacity - bookedParticipants, 0);
      if (vacancies <= 0) {
        return null;
      }
      const slotTime = String(instance.timeStart ?? '00:00:00').slice(0, 5);
      return {
        productId: String(productId),
        datetime: formatOffsetDateTime(instance.date, slotTime, timezoneName),
        dateTime: formatOffsetDateTime(instance.date, slotTime, timezoneName),
        vacancies,
        cutoffSeconds: 0,
      };
    })
    .filter((slot): slot is GygAvailabilitySlot => slot !== null);
};

const validateReserveRequest = async (records: Record<string, unknown>[], productId: number | null): Promise<void> => {
  const bookingItems = readBookingItems(records);
  if (bookingItems.length === 0) {
    throw new HttpError(400, 'Missing bookingItems', { errorCode: 'VALIDATION_FAILURE' });
  }

  const categories = bookingItems
    .map((bookingItem) => normalizeCategory(bookingItem.category))
    .filter((category): category is string => Boolean(category));

  if (categories.length === 0) {
    throw new HttpError(400, 'Missing booking item categories', { errorCode: 'VALIDATION_FAILURE' });
  }

  if (categories.every((category) => category === 'CHILD')) {
    throw new HttpError(400, 'Unsupported ticket category', { errorCode: 'INVALID_TICKET_CATEGORY' });
  }

  const unsupportedCategory = categories.find((category) => !GYG_SUPPORTED_CATEGORIES.has(category));
  if (unsupportedCategory) {
    throw new HttpError(400, `Unsupported ticket category: ${unsupportedCategory}`, {
      errorCode: 'INVALID_TICKET_CATEGORY',
    });
  }

  const totalParticipants = sumRequestedParticipants(bookingItems);
  if (totalParticipants > MAX_GYG_PARTICIPANTS) {
    throw new HttpError(400, 'Participants configuration is not supported', {
      errorCode: 'INVALID_PARTICIPANTS_CONFIGURATION',
    });
  }

  if (productId != null) {
    const requestedDateTime = readFirstText(records, ['dateTime', 'date_time']);
    const requestedDate = extractDateOnly(requestedDateTime);
    if (requestedDate) {
      const slots = await listGygAvailabilitySlots(
        productId,
        dayjs.tz(`${requestedDate} 00:00`, 'YYYY-MM-DD HH:mm', DEFAULT_TIMEZONE),
        dayjs.tz(`${requestedDate} 23:59`, 'YYYY-MM-DD HH:mm', DEFAULT_TIMEZONE),
        DEFAULT_TIMEZONE,
      );
      if (slots.length === 0) {
        throw new HttpError(400, 'No availability', { errorCode: 'NO_AVAILABILITY' });
      }
    }
  }
};

const resolveProductId = async (
  records: Record<string, unknown>[],
): Promise<{ productId: number | null; productName: string | null }> => {
  const rawProductId = readFirstNumber(records, ['productId', 'product_id', 'activityId', 'activity_id', 'experienceId', 'experience_id', 'tourId', 'tour_id']);
  if (rawProductId != null) {
    const product = await Product.findByPk(rawProductId);
    return {
      productId: product?.id ?? null,
      productName: product?.name ?? null,
    };
  }

  const candidateName =
    readFirstText(records, ['productName', 'product_name', 'activityName', 'activity_name', 'experienceName', 'experience_name', 'tourName', 'tour_name', 'title', 'name']) ??
    null;
  if (!candidateName) {
    return { productId: null, productName: null };
  }

  const product = await Product.findOne({
    where: {
      name: candidateName,
    },
  });

  return {
    productId: product?.id ?? null,
    productName: product?.name ?? candidateName,
  };
};

const deriveOperationStatus = (
  records: Record<string, unknown>[],
  operation: Exclude<GygOperation, 'health'>,
): BookingStatus => {
  const rawStatus = readFirstText(records, ['status', 'bookingStatus', 'reservationStatus', 'state', 'eventType']);
  if (operation === 'cancel') {
    return 'cancelled';
  }
  if (operation === 'reserve') {
    return normalizeStatus(rawStatus, 'confirmed');
  }
  return normalizeStatus(rawStatus, 'confirmed');
};

const buildBookingFields = async (
  payload: unknown,
  operation: Exclude<GygOperation, 'health'>,
): Promise<{
  platformBookingId: string;
  platformOrderId: string | null;
  status: BookingStatus;
  eventType: BookingEventType;
  bookingFields: GygBookingFieldPatch;
  rawPayload: Record<string, unknown>;
  occurredAt: Date;
}> => {
  const rawPayload = isRecord(payload) ? payload : { value: payload };
  const records = collectRecordCandidates(rawPayload);
  const now = new Date();
  const resolvedProduct = await resolveProductId(records);

  const platformBookingId = resolvePlatformBookingId(rawPayload);
  const platformOrderId =
    readFirstText(records, [
      'reservationReference',
      'reservation_reference',
      'platformOrderId',
      'platform_order_id',
      'orderId',
      'order_id',
      'orderReference',
      'order_reference',
      'supplierOrderId',
      'supplier_order_id',
    ]) ?? null;

  const status = deriveOperationStatus(records, operation);
  const eventType = deriveEventType(status, false);

  if (operation === 'reserve') {
    await validateReserveRequest(records, resolvedProduct.productId);
  }

  const dateValue =
    readFirstText(records, [
      'experienceDate',
      'experience_date',
      'date',
      'bookingDate',
      'booking_date',
      'serviceDate',
      'service_date',
      'visitDate',
      'visit_date',
      'startDate',
      'start_date',
    ]) ?? null;
  const timeValue =
    readFirstText(records, [
      'startTime',
      'start_time',
      'time',
      'slotTime',
      'slot_time',
      'experienceStartTime',
      'experience_start_time',
    ]) ?? null;
  const experienceStartAt = parseDateTime(dateValue, timeValue);

  const bookingFields: GygBookingFieldPatch = {
    channelId: await resolveChannelId(),
    productId: resolvedProduct.productId,
    productName:
      resolvedProduct.productName ??
      (readFirstText(records, [
        'productName',
        'product_name',
        'activityName',
        'activity_name',
        'experienceName',
        'experience_name',
        'tourName',
        'tour_name',
        'title',
        'name',
      ]) ?? null),
    productVariant:
      readFirstText(records, ['productVariant', 'product_variant', 'variant', 'optionName', 'option_name']) ?? null,
    guestFirstName:
      readFirstText(records, ['guestFirstName', 'guest_first_name', 'firstName', 'first_name', 'travellerFirstName', 'traveller_first_name']) ?? null,
    guestLastName:
      readFirstText(records, ['guestLastName', 'guest_last_name', 'lastName', 'last_name', 'travellerLastName', 'traveller_last_name']) ?? null,
    guestEmail:
      readFirstText(records, ['guestEmail', 'guest_email', 'email', 'customerEmail', 'customer_email']) ?? null,
    guestPhone:
      readFirstText(records, ['guestPhone', 'guest_phone', 'phone', 'phoneNumber', 'phone_number', 'customerPhone', 'customer_phone']) ?? null,
    pickupLocation:
      readFirstText(records, ['pickupLocation', 'pickup_location', 'meetingPoint', 'meeting_point', 'meetingLocation', 'meeting_location']) ?? null,
    hotelName:
      readFirstText(records, ['hotelName', 'hotel_name', 'hotel']) ?? null,
    partySizeAdults: readFirstNumber(records, ['partySizeAdults', 'party_size_adults', 'adults', 'adultCount', 'adult_count']),
    partySizeChildren: readFirstNumber(records, ['partySizeChildren', 'party_size_children', 'children', 'childCount', 'child_count']),
    partySizeTotal:
      readFirstNumber(records, ['partySizeTotal', 'party_size_total', 'partySize', 'party_size', 'participantsCount', 'participants_count', 'travellerCount', 'traveller_count']) ??
      (readFirstArray(records, ['participants', 'travellers', 'travelers', 'guests'])?.length ?? null),
    experienceDate: dateValue ? extractDateOnly(dateValue) : null,
    experienceStartAt,
    experienceEndAt: parseDateTime(
      readFirstText(records, ['endDate', 'end_date', 'endTime', 'end_time', 'experienceEndAt', 'experience_end_at']) ?? dateValue,
      readFirstText(records, ['endTime', 'end_time']) ?? null,
    ),
    currency:
      readFirstText(records, ['currency', 'currencyCode', 'currency_code'])?.toUpperCase() ?? null,
    baseAmount: parseMoney(
      readFirstNumber(records, ['baseAmount', 'base_amount', 'amount', 'totalAmount', 'total_amount', 'grossAmount', 'gross_amount', 'price', 'priceGross', 'price_gross']),
    ),
    priceGross: parseMoney(readFirstNumber(records, ['priceGross', 'price_gross', 'grossAmount', 'gross_amount', 'totalAmount', 'total_amount', 'amount'])),
    priceNet: parseMoney(readFirstNumber(records, ['priceNet', 'price_net', 'netAmount', 'net_amount'])),
    addonsAmount: parseMoney(readFirstNumber(records, ['addonsAmount', 'addons_amount'])),
    discountAmount: parseMoney(readFirstNumber(records, ['discountAmount', 'discount_amount'])),
    tipAmount: parseMoney(readFirstNumber(records, ['tipAmount', 'tip_amount'])),
    processingFee: parseMoney(readFirstNumber(records, ['processingFee', 'processing_fee'])),
    refundedAmount: parseMoney(readFirstNumber(records, ['refundedAmount', 'refunded_amount'])),
    notes:
      readFirstText(records, ['notes', 'note', 'message', 'specialRequests', 'special_requests', 'comment', 'comments']) ?? null,
    rawPayloadLocation: null,
  };

  if (operation === 'reserve' && !bookingFields.platformOrderId) {
    bookingFields.platformOrderId = generateReservationReference();
  }

  return {
    platformBookingId,
    platformOrderId,
    status,
    eventType,
    bookingFields,
    rawPayload,
    occurredAt: now,
  };
};

const cleanObject = (value: Record<string, unknown>): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null),
  );
};

export const ingestGetYourGuidePayload = async (
  payload: unknown,
  options: GygIngestOptions = {},
): Promise<GygIngestResult> => {
  const normalized = await buildBookingFields(payload, options.operation ?? 'upsert');

  if (options.requestedPlatformBookingId && normalized.platformBookingId !== options.requestedPlatformBookingId) {
    throw new HttpError(
      400,
      'GetYourGuide booking reference in the request body does not match the requested URL parameter',
    );
  }

  return database.transaction(async (transaction) => {
    const existingBooking = await Booking.findOne({
      where: {
        platform: GYG_PLATFORM,
        platformBookingId: normalized.platformBookingId,
      },
      transaction,
    });

    const eventType: BookingEventType =
      normalized.status === 'cancelled' ? 'cancelled' : existingBooking ? 'amended' : normalized.eventType;

    const bookingFields = cleanObject({
      ...normalized.bookingFields,
      platformOrderId: normalized.platformOrderId,
      status: normalized.status,
      statusChangedAt: normalized.occurredAt,
      cancelledAt: normalized.status === 'cancelled' ? normalized.occurredAt : existingBooking?.cancelledAt ?? null,
      sourceReceivedAt: normalized.occurredAt,
      processedAt: normalized.occurredAt,
    });

    let booking = existingBooking;
    const createdBooking = !booking;

    if (!booking) {
      booking = await Booking.create(
        {
          platform: GYG_PLATFORM,
          platformBookingId: normalized.platformBookingId,
          status: normalized.status,
          paymentStatus: 'unknown',
          attendanceStatus: 'pending',
          ...bookingFields,
        } as unknown as Booking,
        { transaction },
      );
    } else {
      await booking.update(
        {
          ...bookingFields,
          platform: GYG_PLATFORM,
          platformBookingId: normalized.platformBookingId,
          status: normalized.status,
        } as Partial<Booking>,
        { transaction },
      );
    }

    const event = await BookingEvent.create(
      {
        bookingId: booking.id,
        eventType,
        platform: GYG_PLATFORM,
        statusAfter: normalized.status,
        eventPayload: {
          source: 'getyourguide',
          operation: options.operation ?? 'upsert',
          platformBookingId: normalized.platformBookingId,
          platformOrderId: normalized.platformOrderId,
          bookingFields: normalized.bookingFields,
          rawPayload: normalized.rawPayload,
        },
        occurredAt: normalized.occurredAt,
        processedAt: normalized.occurredAt,
      } as unknown as BookingEvent,
      { transaction },
    );

    return {
      booking,
      bookingEvent: event,
      createdBooking,
      eventType,
      status: normalized.status,
    };
  });
};

export const fetchGetYourGuideBooking = async (platformBookingId: string): Promise<Booking | null> => {
  return Booking.findOne({
    where: {
      platform: GYG_PLATFORM,
      platformBookingId,
    },
  });
};

const parseDateTimeInput = (value: unknown): dayjs.Dayjs | null => {
  const raw = normalizeText(value);
  if (!raw) {
    return null;
  }
  const parsed = dayjs(raw);
  return parsed.isValid() ? parsed : null;
};

const readAvailabilityWindow = (query: Record<string, unknown>): { from: dayjs.Dayjs; to: dayjs.Dayjs } => {
  const from = parseDateTimeInput(query.fromDateTime);
  const to = parseDateTimeInput(query.toDateTime);
  if (!from || !to) {
    throw new HttpError(400, 'fromDateTime and toDateTime are required');
  }
  return { from, to };
};

const buildFallbackSlots = (
  from: dayjs.Dayjs,
  to: dayjs.Dayjs,
  timezoneName: string,
  productId: string,
): GygAvailabilitySlot[] => {
  const slots: GygAvailabilitySlot[] = [];
  let cursor = from.startOf('day');
  const end = to.startOf('day');

  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    const day = cursor.format('YYYY-MM-DD');
    slots.push(
      {
        productId,
        datetime: formatOffsetDateTime(day, '10:00', timezoneName),
        dateTime: formatOffsetDateTime(day, '10:00', timezoneName),
        vacancies: 99,
        cutoffSeconds: 0,
      },
      {
        productId,
        datetime: formatOffsetDateTime(day, '14:00', timezoneName),
        dateTime: formatOffsetDateTime(day, '14:00', timezoneName),
        vacancies: 99,
        cutoffSeconds: 0,
      },
    );
    cursor = cursor.add(1, 'day');
  }

  return slots;
};

export const getGetYourGuideAvailabilities = async (
  query: Record<string, unknown>,
): Promise<GygAvailabilityResult> => {
  const productIdRaw = normalizeNumberish(query.productId);
  if (!productIdRaw) {
    throw new HttpError(400, 'productId is required');
  }

  const productId = Math.trunc(productIdRaw);
  const product = await Product.findByPk(productId);
  if (!product) {
    throw new HttpError(404, `Product ${productId} not found`);
  }

  const timezoneName =
    (getConfigValue('GETYOURGUIDE_TIMEZONE') as string | null) ??
    (getConfigValue('BOOKING_PARSER_TIMEZONE') as string | null) ??
    'Europe/Warsaw';

  const { from, to } = readAvailabilityWindow(query);
  const availabilities = await listGygAvailabilitySlots(productId, from, to, timezoneName);

  return {
    productId: String(productId),
    productName: product.name,
    timezone: timezoneName,
    availabilities,
  };
};
