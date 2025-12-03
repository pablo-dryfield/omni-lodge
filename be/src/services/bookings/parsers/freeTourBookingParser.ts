import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import type { BookingEmailParser, BookingParserContext, BookingFieldPatch, ParsedBookingEvent } from '../types.js';
import type { BookingEventType, BookingStatus } from '../../../constants/bookings.js';

dayjs.extend(customParseFormat);

const MONEY_SYMBOLS: Record<string, string> = {
  '\u20ac': 'EUR',
  $: 'USD',
  '\u00a3': 'GBP',
};

const extractField = (text: string, label: string, nextLabels: string[]): string | null => {
  const lowerText = text.toLowerCase();
  const lowerLabel = label.toLowerCase();
  const start = lowerText.indexOf(lowerLabel);
  if (start === -1) {
    return null;
  }
  let slice = text.slice(start + label.length);
  if (nextLabels.length) {
    const lowerSlice = lowerText.slice(start + label.length);
    let endIndex = -1;
    for (const next of nextLabels) {
      const idx = lowerSlice.indexOf(next.toLowerCase());
      if (idx !== -1 && (endIndex === -1 || idx < endIndex)) {
        endIndex = idx;
      }
    }
    if (endIndex !== -1) {
      slice = slice.slice(0, endIndex);
    }
  }
  return slice.trim();
};

const ENTITY_CURRENCY: Record<string, string> = {
  '&euro;': 'EUR',
  '&eur;': 'EUR',
};

const parseMoney = (value: string | null): { amount: number | null; currency: string | null } => {
  if (!value) {
    return { amount: null, currency: null };
  }
  const match = value.match(/(&[a-z]+;|[\u20ac$\u00a3]?)([\d.,]+)/i);
  if (!match) {
    return { amount: null, currency: null };
  }
  const amount = Number.parseFloat(match[2].replace(/,/g, ''));
  const symbol = match[1];
  let currency: string | null = null;
  if (symbol?.startsWith('&')) {
    currency = ENTITY_CURRENCY[symbol.toLowerCase()] ?? null;
  } else {
    currency = symbol ? MONEY_SYMBOLS[symbol] ?? null : null;
  }
  return {
    amount: Number.isNaN(amount) ? null : amount,
    currency,
  };
};

const parsePartySize = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  const match = value.match(/(\d+)/);
  if (!match) {
    return null;
  }
  const size = Number.parseInt(match[1], 10);
  return Number.isNaN(size) ? null : size;
};

const parseName = (value: string | null): { firstName: string | null; lastName: string | null } => {
  if (!value) {
    return { firstName: null, lastName: null };
  }
  const parts = value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { firstName: null, lastName: null };
  }
  const firstName = parts.shift() ?? null;
  const lastName = parts.length > 0 ? parts.join(' ') : null;
  return { firstName, lastName };
};

const deriveStatusFromContext = (context: BookingParserContext, text: string): BookingStatus => {
  const haystack = `${context.subject ?? ''}\n${text}`.toLowerCase();
  if (/(?:canceled|cancelled|cancellation)/i.test(haystack)) {
    return 'cancelled';
  }
  if (/(?:amended|change|changed|updated|modified|rescheduled)/i.test(haystack)) {
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

export class FreeTourBookingParser implements BookingEmailParser {
  public readonly name = 'freetour';

  canParse(context: BookingParserContext): boolean {
    const from = context.from ?? context.headers.from ?? '';
    const subject = context.subject ?? '';
    return /freetour/i.test(from) || /freetour/i.test(subject);
  }

  async parse(context: BookingParserContext): Promise<ParsedBookingEvent | null> {
    const text = context.textBody || context.rawTextBody || context.snippet || '';
    if (!text) {
      return null;
    }

    const bookingReference = extractField(text, 'Booking Reference Number:', ['Booking Total Cost:']);
    if (!bookingReference) {
      return null;
    }

    let productName: string | null = null;
    const anchoredMatch = text.match(/Booking ID:[^A-Za-z0-9]+[^\s]+\s+([A-Za-z0-9 .,'-]+?)\s+Tour Reservation/i);
    if (anchoredMatch?.[1]) {
      productName = anchoredMatch[1].trim();
    } else {
      const fallback = text.match(/([A-Za-z0-9 .,'-]+?)\s+Tour Reservation/i);
      productName = fallback?.[1]?.trim() ?? null;
    }

    const dateRaw = extractField(text, 'Date of the Tour:', ['Language:']);
    const language = extractField(text, 'Language:', ['Adults:']);
    const adultsRaw = extractField(text, 'Adults:', ['Booking Name:']);
    const bookingName = extractField(text, 'Booking Name:', ['Booking E-mail:']);
    const email = extractField(text, 'Booking E-mail:', ['Booking phone:']);
    const phone = extractField(text, 'Booking phone:', ['Booking Reference Number:']);
    const totalCost = extractField(text, 'Booking Total Cost:', ['Paid:']);
    const paidValue = extractField(text, 'Paid:', ['Balance due:']);
    const balanceValue = extractField(text, 'Balance due:', ['If you are']);

    const size = parsePartySize(adultsRaw);
    const money = parseMoney(paidValue ?? totalCost);

    let normalizedDate = dateRaw ?? null;
    if (normalizedDate?.includes(',')) {
      const firstComma = normalizedDate.indexOf(',');
      normalizedDate = `${normalizedDate.slice(0, firstComma)} ${normalizedDate.slice(firstComma + 1).trim()}`;
    }
    const parsedDate = normalizedDate
      ? dayjs(normalizedDate, ['h:mm A MMMM D, YYYY', 'h:mm A MMM D, YYYY', 'h:mm A MMMM D YYYY'], true)
      : null;
    const nameParts = parseName(bookingName);
    const totalMoney = totalCost ? parseMoney(totalCost) : null;

    const bookingFields: BookingFieldPatch = {
      productName,
      guestFirstName: nameParts.firstName,
      guestLastName: nameParts.lastName,
      guestEmail: email ?? null,
      guestPhone: phone ?? null,
      partySizeTotal: size,
      partySizeAdults: size,
      currency: money.currency ?? totalMoney?.currency ?? (totalCost?.includes('\u20ac') ? 'EUR' : null),
      priceGross: money.amount ?? totalMoney?.amount ?? null,
      baseAmount: money.amount ?? totalMoney?.amount ?? null,
      priceNet: money.amount ?? totalMoney?.amount ?? null,
      paymentMethod: null,
      notes: language ? `Language: ${language}` : null,
      experienceDate: parsedDate?.isValid() ? parsedDate.format('YYYY-MM-DD') : null,
      experienceStartAt: parsedDate?.isValid() ? parsedDate.toDate() : null,
    };

    const status = deriveStatusFromContext(context, text);
    const eventType = statusToEventType(status);

    const paymentStatus =
      money.amount !== null || (balanceValue && /0/.test(balanceValue)) ? 'paid' : 'unknown';

    if (status === 'cancelled') {
      bookingFields.notes = bookingFields.notes
        ? `${bookingFields.notes} | Email indicates booking was cancelled.`
        : 'Email indicates booking was cancelled.';
    } else if (status === 'amended') {
      bookingFields.notes = bookingFields.notes
        ? `${bookingFields.notes} | Email indicates booking was amended.`
        : 'Email indicates booking was amended.';
    }

    return {
      platform: 'freetour',
      platformBookingId: bookingReference.trim(),
      platformOrderId: bookingReference.trim(),
      eventType,
      status,
      paymentStatus,
      bookingFields,
      occurredAt: context.receivedAt ?? context.internalDate ?? null,
      sourceReceivedAt: context.receivedAt ?? context.internalDate ?? null,
    };
  }
}
