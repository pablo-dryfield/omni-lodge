import type { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import sequelize from '../../config/database.js';
import BookingEmail from '../../models/BookingEmail.js';
import Booking from '../../models/Booking.js';
import BookingEvent from '../../models/BookingEvent.js';
import BookingAddon from '../../models/BookingAddon.js';
import logger from '../../utils/logger.js';
import { fetchMessagePayload, listMessages } from './gmailClient.js';
import { getBookingParsers } from './parsers/index.js';
import type { BookingFieldPatch, BookingParserContext, ParsedBookingEvent } from './types.js';
import type { GmailMessagePayload } from './gmailClient.js';

const DEFAULT_QUERY =
  process.env.BOOKING_GMAIL_QUERY ??
  '(subject:(booking OR reservation OR "new order" OR "booking detail change" OR rebooked) OR from:(ecwid.com OR fareharbor.com OR viator.com OR getyourguide.com))';
const DEFAULT_BATCH = Number.parseInt(process.env.BOOKING_GMAIL_BATCH_SIZE ?? '20', 10);

const decimalKeys = new Set([
  'baseAmount',
  'addonsAmount',
  'discountAmount',
  'priceGross',
  'priceNet',
  'commissionAmount',
  'commissionRate',
  'unitPrice',
  'totalPrice',
  'taxAmount',
]);

const bookingStringLimits: Partial<Record<keyof BookingFieldPatch, number>> = {
  productName: 255,
  productVariant: 255,
  guestFirstName: 255,
  guestLastName: 255,
  guestEmail: 320,
  guestPhone: 64,
  hotelName: 255,
  currency: 3,
  paymentMethod: 128,
  rawPayloadLocation: 512,
};

const clampString = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength);
};

const clampNullableString = (value: string | null | undefined, maxLength: number): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return clampString(value, maxLength);
};

const decodeHtmlEntities = (input: string): string => {
  return input.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (entity, match) => {
    if (match.startsWith('#x') || match.startsWith('#X')) {
      const codePoint = Number.parseInt(match.slice(2), 16);
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }
    if (match.startsWith('#')) {
      const codePoint = Number.parseInt(match.slice(1), 10);
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }
    const lookup: Record<string, string> = {
      nbsp: ' ',
      amp: '&',
      quot: '"',
      lt: '<',
      gt: '>',
      apos: "'",
      bull: '*',
      ndash: '-',
      mdash: '-',
      rsquo: "'",
      lsquo: "'",
    };
    return lookup[match.toLowerCase()] ?? entity;
  });
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
  return decodeHtmlEntities(withoutBlocks);
};

const normalizeWhitespace = (input: string): string => input.replace(/\s+/g, ' ').trim();

const ensurePlainTextBody = (
  textBody?: string | null,
  htmlBody?: string | null,
  snippet?: string | null,
): string => {
  if (textBody && textBody.trim().length > 0) {
    const looksLikeHtml = /<[^>]+>/.test(textBody);
    const candidate = looksLikeHtml ? stripHtmlToText(textBody) : textBody;
    const normalized = normalizeWhitespace(candidate);
    if (normalized) {
      return normalized;
    }
  }
  if (htmlBody) {
    const stripped = normalizeWhitespace(stripHtmlToText(htmlBody));
    if (stripped) {
      return stripped;
    }
  }
  if (snippet && snippet.trim().length > 0) {
    return normalizeWhitespace(snippet);
  }
  return '';
};

const normalizeDecimal = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  return null;
};

const normalizePatch = (patch: BookingFieldPatch | undefined): Record<string, unknown> => {
  if (!patch) {
    return {};
  }
  return Object.entries(patch).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (value === undefined) {
      return acc;
    }
    if (decimalKeys.has(key)) {
      acc[key] = normalizeDecimal(value);
      return acc;
    }
    if (typeof value === 'string') {
      const limit = bookingStringLimits[key as keyof BookingFieldPatch];
      if (limit) {
        acc[key] = clampString(value, limit);
        return acc;
      }
    }
    acc[key] = value;
    return acc;
  }, {});
};

const parseDateHeader = (value?: string | null): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
};

const buildParserContext = (email: BookingEmail, payload: GmailMessagePayload): BookingParserContext => {
  const headers = {
    ...payload.headers,
    from: email.fromAddress ?? payload.headers.from ?? '',
    to: email.toAddresses ?? payload.headers.to ?? '',
  };
  const normalizedTextBody = ensurePlainTextBody(payload.textBody, payload.htmlBody, email.snippet);

  return {
    messageId: email.messageId,
    threadId: email.threadId,
    historyId: email.historyId,
    subject: email.subject,
    snippet: email.snippet,
    from: email.fromAddress,
    to: email.toAddresses ?? undefined,
    cc: email.ccAddresses ?? undefined,
    receivedAt: email.receivedAt,
    internalDate: email.internalDate,
    headers,
    textBody: normalizedTextBody,
    rawTextBody: payload.textBody ?? '',
    htmlBody: payload.htmlBody,
  };
};

const saveEmailRecord = async (payload: GmailMessagePayload): Promise<BookingEmail> => {
  const { message, textBody } = payload;
  const existing = await BookingEmail.findOne({ where: { messageId: message.id ?? '' } });
  const record =
    existing ??
    BookingEmail.build({
      messageId: message.id ?? '',
      ingestionStatus: 'pending',
    } as BookingEmail);

  record.threadId = message.threadId ?? null;
  record.historyId = message.historyId ?? null;
  record.fromAddress = clampNullableString(payload.headers.from ?? record.fromAddress ?? null, 512);
  record.toAddresses = payload.headers.to ?? record.toAddresses ?? null;
  record.ccAddresses = payload.headers.cc ?? record.ccAddresses ?? null;
  const subjectHeader = message.payload?.headers?.find((h) => h.name?.toLowerCase() === 'subject')?.value;
  record.subject = clampNullableString(subjectHeader ?? record.subject ?? null, 512);
  record.snippet = message.snippet ?? textBody.slice(0, 240);
  record.receivedAt = parseDateHeader(payload.headers.date) ?? record.receivedAt ?? null;
  record.internalDate = message.internalDate ? new Date(Number.parseInt(message.internalDate, 10)) : record.internalDate ?? null;
  record.labelIds = message.labelIds ?? record.labelIds ?? null;
  record.headers = payload.headers;
  record.payloadSize = message.sizeEstimate ?? textBody.length;
  record.rawPayload = JSON.stringify(message);

  if (!record.ingestionStatus || record.ingestionStatus === 'processed') {
    record.ingestionStatus = 'pending';
  }

  await record.save();
  return record;
};

const updateEmailStatus = async (email: BookingEmail, status: string, failureReason?: string | null): Promise<void> => {
  email.ingestionStatus = status;
  email.failureReason = failureReason ?? null;
  await email.save();
};

const runParsers = async (context: BookingParserContext): Promise<ParsedBookingEvent | null> => {
  const parsers = getBookingParsers();
  for (const parser of parsers) {
    try {
      if (!parser.canParse(context)) {
        continue;
      }
      const result = await parser.parse(context);
      if (result) {
        logger.debug(`[booking-email] ${parser.name} parsed message ${context.messageId} into booking ${result.platformBookingId}`);
        return result;
      }
    } catch (error) {
      logger.warn(`[booking-email] Parser ${parser.name} failed for ${context.messageId}: ${(error as Error).message}`);
    }
  }
  return null;
};

const syncAddons = async (
  bookingId: number,
  eventId: number,
  addons: ParsedBookingEvent['addons'] | undefined,
  transaction: Transaction,
): Promise<void> => {
  await BookingAddon.destroy({ where: { bookingId }, transaction });
  if (!addons || addons.length === 0) {
    return;
  }

  for (const addon of addons) {
    const record = BookingAddon.build(
      {
        bookingId,
        addonId: addon.addonId ?? null,
        platformAddonId: addon.platformAddonId ?? null,
        platformAddonName: addon.platformAddonName ?? null,
        quantity: addon.quantity ?? 1,
        unitPrice: normalizeDecimal(addon.unitPrice ?? null),
        totalPrice: normalizeDecimal(addon.totalPrice ?? null),
        currency: addon.currency ?? null,
        taxAmount: normalizeDecimal(addon.taxAmount ?? null),
        isIncluded: addon.included ?? false,
        metadata: addon.metadata ?? null,
        sourceEventId: eventId,
      } as BookingAddon,
    );
    await record.save({ transaction });
  }
};

const applyParsedEvent = async (email: BookingEmail, event: ParsedBookingEvent): Promise<void> => {
  await sequelize.transaction(async (transaction) => {
    const eventOccurredAt = event.occurredAt ?? event.sourceReceivedAt ?? email.receivedAt ?? new Date();

    let booking = await Booking.findOne({
      where: {
        platform: event.platform,
        platformBookingId: event.platformBookingId,
      },
      transaction,
    });

    if (!booking) {
      booking = Booking.build({
        platform: event.platform,
        platformBookingId: event.platformBookingId,
        status: event.status,
        paymentStatus: event.paymentStatus ?? 'unknown',
        statusChangedAt: eventOccurredAt,
        cancelledAt: event.status === 'cancelled' ? eventOccurredAt : null,
      } as Booking);
      await booking.save({ transaction });
    }

    const patch = normalizePatch(event.bookingFields);
    if (Object.keys(patch).length > 0) {
      booking.set(patch);
    }

    const shouldUpdateStatus = !booking.statusChangedAt || eventOccurredAt >= booking.statusChangedAt;
    if (shouldUpdateStatus) {
      booking.status = event.status;
      booking.statusChangedAt = eventOccurredAt;
      if (event.status === 'cancelled') {
        booking.cancelledAt = eventOccurredAt;
      } else if (booking.cancelledAt) {
        booking.cancelledAt = null;
      }
    }

    if (event.paymentStatus) {
      booking.paymentStatus = event.paymentStatus;
    }
    if (event.platformOrderId) {
      booking.platformOrderId = event.platformOrderId;
    }

    booking.lastEmailMessageId = email.messageId;
    booking.sourceReceivedAt = event.sourceReceivedAt ?? email.receivedAt ?? booking.sourceReceivedAt;
    booking.processedAt = new Date();
    const addonsSnapshot =
      event.bookingFields?.addonsSnapshot ??
      (event.addons && event.addons.length > 0 ? { items: event.addons } : null);
    booking.addonsSnapshot = addonsSnapshot ?? booking.addonsSnapshot ?? null;
    if (event.notes) {
      booking.notes = event.notes;
    }

    await booking.save({ transaction });

    const bookingEvent = BookingEvent.build(
      {
        bookingId: booking.id,
        emailId: email.id,
        eventType: event.eventType,
        platform: event.platform,
        statusAfter: event.status,
        emailMessageId: email.messageId,
        eventPayload: event.rawPayload ?? null,
        occurredAt: eventOccurredAt,
        ingestedAt: new Date(),
        processedAt: new Date(),
      } as BookingEvent,
    );
    await bookingEvent.save({ transaction });

    await syncAddons(booking.id, bookingEvent.id, event.addons, transaction);
  });
};

type ProcessResult = 'processed' | 'skipped_lower' | 'skipped_upper' | 'ignored' | 'failed';

export const processBookingEmail = async (
  messageId: string,
  options: { force?: boolean; receivedAfter?: Date | null; receivedBefore?: Date | null } = {},
): Promise<ProcessResult> => {
  let payload: GmailMessagePayload | null = null;
  try {
    payload = await fetchMessagePayload(messageId);
    if (!payload || !payload.message.id) {
      logger.warn(`[booking-email] Gmail message ${messageId} returned no payload`);
      return 'ignored';
    }
  } catch (error) {
    logger.error(`[booking-email] Unable to fetch message ${messageId}: ${(error as Error).message}`);
    return 'failed';
  }

  const emailRecord = await saveEmailRecord(payload);

  if (emailRecord.ingestionStatus === 'processed' && !options.force) {
    logger.debug(`[booking-email] Message ${messageId} already processed, skipping`);
    return 'ignored';
  }

  await updateEmailStatus(emailRecord, 'processing');

  const internalDate = payload.message.internalDate ? new Date(Number(payload.message.internalDate)) : null;
  if (options.receivedAfter && internalDate && internalDate < options.receivedAfter) {
    await updateEmailStatus(emailRecord, 'ignored', 'Outside requested date range (before)');
    return 'skipped_lower';
  }

  if (options.receivedBefore && internalDate && internalDate > options.receivedBefore) {
    await updateEmailStatus(emailRecord, 'ignored', 'Outside requested date range (after)');
    return 'skipped_upper';
  }

  const context = buildParserContext(emailRecord, payload);
  const parsed = await runParsers(context);

  if (!parsed) {
    await updateEmailStatus(emailRecord, 'ignored', 'No parser matched this email');
    return 'ignored';
  }

  const pendingEvents: ParsedBookingEvent[] = [parsed];

  try {
    while (pendingEvents.length > 0) {
      const current = pendingEvents.shift()!;
      const spawned = current.spawnedEvents ?? [];
      await applyParsedEvent(emailRecord, current);
      if (spawned.length > 0) {
        pendingEvents.push(...spawned);
      }
    }
    await updateEmailStatus(emailRecord, 'processed');
    return 'processed';
  } catch (error) {
    const message = (error as Error).message ?? 'Unknown error';
    await updateEmailStatus(emailRecord, 'failed', message);
    logger.error(`[booking-email] Failed to apply parsed booking for ${messageId}: ${message}`);
    return 'failed';
  }
};

export const ingestLatestBookingEmails = async (): Promise<void> => {
  try {
    const { messages } = await listMessages({
      query: DEFAULT_QUERY,
      maxResults: DEFAULT_BATCH,
    });

    if (messages.length === 0) {
      logger.debug('[booking-email] No new Gmail messages matching booking query');
      return;
    }

    for (const message of messages) {
      if (!message.id) {
        continue;
      }
      await processBookingEmail(message.id);
    }
  } catch (error) {
    logger.error(`[booking-email] Failed to ingest booking emails: ${(error as Error).message}`);
  }
};

export const reprocessBookingEmails = async (limit = 10): Promise<void> => {
  const pendingEmails = await BookingEmail.findAll({
    where: {
      ingestionStatus: {
        [Op.in]: ['failed', 'ignored'],
      },
    },
    order: [['updatedAt', 'DESC']],
    limit,
  });

  for (const email of pendingEmails) {
    await processBookingEmail(email.messageId, { force: true });
  }
};

type IngestAllOptions = {
  query?: string;
  batchSize?: number;
  receivedAfter?: Date | string;
  receivedBefore?: Date | string;
};

const toDateOrNull = (value?: Date | string): Date | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
};

export const ingestAllBookingEmails = async (options: IngestAllOptions = {}): Promise<void> => {
  const query = options.query ?? DEFAULT_QUERY;
  const batchSize = options.batchSize ?? Math.max(DEFAULT_BATCH, 100);
  const receivedAfter = toDateOrNull(options.receivedAfter);
  const receivedBefore = toDateOrNull(options.receivedBefore);
  let pageToken: string | null = null;
  let scanned = 0;
  let totalEstimate: number | null = null;
  let exactTotal: number | null = null;

  try {
    do {
      const { messages, nextPageToken, totalSizeEstimate } = await listMessages({
        query,
        maxResults: batchSize,
        pageToken,
      });

      if (totalEstimate === null && totalSizeEstimate !== null) {
        totalEstimate = totalSizeEstimate;
        logger.info(
          `[booking-email] Gmail reports approximately ${totalEstimate} messages matching query "${query}"`,
        );
      }

      if (!messages || messages.length === 0) {
        break;
      }

      let hitLowerBound = false;
      const sortedMessages = [...messages].reverse();

      for (const message of sortedMessages) {
        if (!message.id) {
          continue;
        }
        const result = await processBookingEmail(message.id, { receivedAfter, receivedBefore });
        if (result === 'skipped_lower') {
          hitLowerBound = true;
        }
      }
      scanned += messages.length;

      if (!nextPageToken) {
        exactTotal = scanned;
      }

      if (exactTotal !== null) {
        const completion = Math.min((scanned / exactTotal) * 100, 100);
        logger.info(
          `[booking-email] Backfill progress: ${scanned}/${exactTotal} (${completion.toFixed(2)}% exact)`,
        );
      } else if (totalEstimate && totalEstimate > 0) {
        const completion = Math.min((scanned / totalEstimate) * 100, 100);
        logger.info(
          `[booking-email] Backfill progress: ${scanned}/${totalEstimate} (~${completion.toFixed(2)}%)`,
        );
      } else {
        logger.info(`[booking-email] Backfill progress: ${scanned} messages processed`);
      }

      pageToken = nextPageToken;
      if (hitLowerBound) {
        logger.info('[booking-email] Reached earlier than requested range, stopping ingestion.');
        break;
      }
      if (!pageToken) {
        break;
      }
    } while (true);

    if (exactTotal === null) {
      exactTotal = scanned;
    }
    logger.info(`[booking-email] Completed full mailbox ingestion. Messages scanned: ${scanned}, total=${exactTotal}`);
  } catch (error) {
    logger.error(`[booking-email] Failed full mailbox ingestion: ${(error as Error).message}`);
  }
};
