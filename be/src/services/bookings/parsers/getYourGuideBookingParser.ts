import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import type { BookingEmailParser, BookingParserContext, BookingFieldPatch, ParsedBookingEvent } from '../types.js';
import type { BookingEventType, BookingStatus } from '../../../constants/bookings.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_BOOKING_TIMEZONE = process.env.BOOKING_PARSER_TIMEZONE ?? 'Europe/Warsaw';
const GETYOURGUIDE_TIMEZONE = process.env.GETYOURGUIDE_TIMEZONE ?? DEFAULT_BOOKING_TIMEZONE;

const MONEY_SYMBOLS: Record<string, string> = {
  'z\u0142': 'PLN',
  zl: 'PLN',
  pln: 'PLN',
  $: 'USD',
  '\u20ac': 'EUR',
  '\u00a3': 'GBP',
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const parseMoney = (input: string): { currency: string | null; amount: number | null } => {
  const match = input.match(/([^\d\s]+)?\s*([\d.,]+)/);
  if (!match) {
    return { currency: null, amount: null };
  }
  const symbol = match[1]?.trim() ?? '';
  const amount = Number.parseFloat(match[2].replace(/,/g, ''));
  if (Number.isNaN(amount)) {
    return { currency: null, amount: null };
  }
  const normalizedSymbol = symbol.toLowerCase();
  const currency =
    MONEY_SYMBOLS[symbol] ??
    MONEY_SYMBOLS[normalizedSymbol] ??
    (symbol.toUpperCase().length === 3 ? symbol.toUpperCase() : null);
  return { currency, amount };
};

const extractBookingId = (text: string, subject?: string | null): string | null => {
  const referenceMatch = text.match(/Reference number[:\s]+([A-Z0-9]+)/i);
  if (referenceMatch?.[1]) {
    return referenceMatch[1];
  }
  if (subject) {
    const subjectMatch = subject.match(/[A-Z0-9]{10,}/g);
    if (subjectMatch && subjectMatch.length > 0) {
      return subjectMatch[subjectMatch.length - 1];
    }
  }
  return null;
};

const PRODUCT_NAME_CANONICALS: Array<{ canonical: string; patterns: RegExp[] }> = [
  {
    canonical: 'Krawl Through Krakow Pub Crawl',
    patterns: [
      /krawl through krakow pub crawl/i,
      /krakow:\s*pub crawl/i,
      /krakow pub crawl/i,
    ],
  },
];

const canonicalizeProductName = (rawName: string): { name: string; variant: string | null } => {
  const trimmed = rawName.trim();
  for (const candidate of PRODUCT_NAME_CANONICALS) {
    for (const pattern of candidate.patterns) {
      if (pattern.test(trimmed)) {
        const needsVariant = trimmed.localeCompare(candidate.canonical, undefined, { sensitivity: 'accent' }) !== 0;
        return {
          name: candidate.canonical,
          variant: needsVariant ? trimmed : null,
        };
      }
    }
  }
  return { name: trimmed, variant: null };
};

const extractBookingFields = (text: string): BookingFieldPatch => {
  const fields: BookingFieldPatch = {};

  const productMatch = text.match(/has been booked:\s+(.+?)\s+Reference number/i);
  if (productMatch) {
    const rawName = productMatch[1].trim();
    const half = Math.floor(rawName.length / 2);
    const firstHalf = rawName.slice(0, half).trim();
    const secondHalf = rawName.slice(half).trim();
    const deduped = firstHalf && firstHalf === secondHalf ? firstHalf : rawName;
    const canonical = canonicalizeProductName(deduped);
    fields.productName = canonical.name;
    if (canonical.variant) {
      fields.productVariant = canonical.variant;
    }
  }

  const customerMatch = text.match(/Main customer\s+([A-Za-z\u00C0-\u017F' -]+?)(?=\s+[a-z0-9._%+-]+@)/i);
  if (customerMatch) {
    const parts = customerMatch[1].trim().split(/\s+/);
    fields.guestFirstName = parts.shift() ?? null;
    fields.guestLastName = parts.length > 0 ? parts.join(' ') : null;
  }

  const emailMatch = text.match(/([a-z0-9._%+-]+@reply\.getyourguide\.com)/i);
  if (emailMatch) {
    fields.guestEmail = emailMatch[1];
  }

  const phoneMatch = text.match(/Phone:\s*([+()\d\s-]+)/i);
  if (phoneMatch) {
    fields.guestPhone = phoneMatch[1].trim();
  }

  const participantsMatch = text.match(/Number of participants\s+(\d+)\s+x\s+([A-Za-z]+)/i);
  if (participantsMatch) {
    const qty = Number.parseInt(participantsMatch[1], 10);
    if (!Number.isNaN(qty)) {
      fields.partySizeTotal = qty;
      fields.partySizeAdults = qty;
    }
  }

  const dateMatch = text.match(/Date\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
  if (dateMatch) {
    const parsed = dayjs.tz(`${dateMatch[1]} ${dateMatch[2]}`, 'MMMM D, YYYY h:mm A', GETYOURGUIDE_TIMEZONE);
    if (parsed.isValid()) {
      fields.experienceDate = parsed.format('YYYY-MM-DD');
      fields.experienceStartAt = parsed.toDate();
    }
  }

  return fields;
};

const deriveStatusFromContext = (context: BookingParserContext, text: string): BookingStatus => {
  const haystack = `${context.subject ?? ''}\n${text}`.toLowerCase();
  if (/(?:canceled|cancelled|cancellation)/i.test(haystack)) {
    return 'cancelled';
  }
  if (/(?:detail change|booking change|changed|amended|updated|rebook)/i.test(haystack)) {
    return 'amended';
  }
  return 'confirmed';
};

const statusToEventType = (status: BookingStatus): BookingEventType => {
  switch (status) {
    case 'cancelled':
      return 'cancelled';
    case 'amended':
      return 'amended';
    default:
      return 'created';
  }
};

export class GetYourGuideBookingParser implements BookingEmailParser {
  public readonly name = 'getyourguide';

  canParse(context: BookingParserContext): boolean {
    const from = context.from ?? context.headers.from ?? '';
    const subject = context.subject ?? '';
    return /getyourguide/i.test(from) || /getyourguide/i.test(subject);
  }

  async parse(context: BookingParserContext): Promise<ParsedBookingEvent | null> {
    const text = normalizeWhitespace(context.textBody || context.rawTextBody || context.snippet || '');
    if (!text) {
      return null;
    }

    const bookingId = extractBookingId(text, context.subject);
    if (!bookingId) {
      return null;
    }

    const bookingFields = extractBookingFields(text);

    const priceMatch = text.match(/Price\s+([^\s]+)\s*([\d.,]+)/i);
    if (priceMatch) {
      const money = parseMoney(`${priceMatch[1]} ${priceMatch[2]}`);
      if (money.amount !== null) {
        bookingFields.priceGross = money.amount;
        bookingFields.baseAmount = money.amount;
      }
      if (money.currency) {
        bookingFields.currency = money.currency;
      }
    }

    const status = deriveStatusFromContext(context, text);
    const eventType = statusToEventType(status);

    const tourLanguageMatch = text.match(/Tour language\s+(.+?)\s+Price/i);
    const customerLanguageMatch = text.match(/Language:\s*([A-Za-z]+)/i);
    const notes: string[] = [];
    if (tourLanguageMatch) {
      notes.push(`Tour language: ${tourLanguageMatch[1].trim()}`);
    }
    if (customerLanguageMatch) {
      notes.push(`Customer language: ${customerLanguageMatch[1].trim()}`);
    }
    if (status === 'cancelled') {
      notes.push('Email indicates booking was cancelled.');
    } else if (status === 'amended') {
      notes.push('Email indicates booking was amended/changed.');
    }

    return {
      platform: 'getyourguide',
      platformBookingId: bookingId,
      platformOrderId: bookingId,
      eventType,
      status,
      paymentStatus: bookingFields.priceGross ? 'paid' : 'unknown',
      bookingFields,
      notes: notes.length > 0 ? notes.join(' | ') : 'Parsed from GetYourGuide confirmation email.',
      occurredAt: context.receivedAt ?? context.internalDate ?? null,
      sourceReceivedAt: context.receivedAt ?? context.internalDate ?? null,
    };
  }
}
