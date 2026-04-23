import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import type {
  BookingEmailParser,
  BookingParserCheck,
  BookingParserContext,
  BookingParserDiagnostics,
  BookingFieldPatch,
  ParsedBookingEvent,
} from '../types.js';
import type { BookingEventType, BookingStatus } from '../../../constants/bookings.js';
import { getConfigValue } from '../../configService.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_BOOKING_TIMEZONE =
  (getConfigValue('BOOKING_PARSER_TIMEZONE') as string | null) ?? 'Europe/Warsaw';
const FREETOUR_TIMEZONE =
  (getConfigValue('FREETOUR_TIMEZONE') as string | null) ?? DEFAULT_BOOKING_TIMEZONE;

const MONEY_SYMBOLS: Record<string, string> = {
  '\u20ac': 'EUR',
  $: 'USD',
  '\u00a3': 'GBP',
};

const FREETOUR_DATE_FORMATS = ['h:mm A MMMM D, YYYY', 'h:mm A MMM D, YYYY', 'h:mm A MMMM D YYYY'];

const isPaidReservationSubject = (subject: string): boolean =>
  /paid reservation from freetour\.com/i.test(subject);

const isCancellationSubject = (subject: string): boolean =>
  /\bcancellation\b/i.test(subject);

const isFreeTourDomainSender = (from: string): boolean =>
  /@(?:news\.)?freetour\.com/i.test(from);

const isFreeTourBookingsSender = (from: string): boolean =>
  /bookings@freetour\.com/i.test(from);

const extractPaidReservationBookingId = (
  subject: string,
  text: string,
): string | null => {
  const subjectMatch = subject.match(/booking id:\s*([0-9-]{8,})/i);
  if (subjectMatch?.[1]) {
    return subjectMatch[1].trim();
  }
  const bodyReference = extractField(text, 'Booking Reference Number:', ['Booking Total Cost:']);
  if (bodyReference && /^[0-9-]{8,}$/.test(bodyReference.trim())) {
    return bodyReference.trim();
  }
  const bodyBookingId = text.match(/\bbooking id[:#]?\s*([0-9-]{8,})/i);
  if (bodyBookingId?.[1]) {
    return bodyBookingId[1].trim();
  }
  return null;
};

const extractCancellationBookingId = (subject: string, text: string): string | null => {
  const bodyMatch = text.match(/\bbooking\s*\(#([0-9-]{8,})\)/i);
  if (bodyMatch?.[1]) {
    return bodyMatch[1].trim();
  }
  const subjectMatch = subject.match(/#([0-9-]{8,})/);
  if (subjectMatch?.[1]) {
    return subjectMatch[1].trim();
  }
  const hashFallback = text.match(/#([0-9-]{8,})/);
  if (hashFallback?.[1]) {
    return hashFallback[1].trim();
  }
  return null;
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
  const subject = (context.subject ?? '').toLowerCase();
  const body = text.toLowerCase();
  const haystack = `${subject}\n${body}`;
  const cancelSubjectMarkers = ['cancel', 'cancellation'];
  const amendSubjectMarkers = ['amend', 'change', 'update', 'modified', 'reschedule'];
  const cancelBodyPatterns = [
    /booking (?:has been )?(?:cancelled|canceled)/i,
    /reservation (?:has been )?(?:cancelled|canceled)/i,
    /booking cancellation/i,
    /reservation cancellation/i,
  ];
  const amendBodyPatterns = [
    /booking (?:has been )?(?:amended|changed|updated|modified|rescheduled)/i,
    /reservation (?:has been )?(?:amended|changed|updated|modified|rescheduled)/i,
  ];

  if (cancelSubjectMarkers.some((marker) => subject.includes(marker)) || cancelBodyPatterns.some((pattern) => pattern.test(haystack))) {
    return 'cancelled';
  }
  if (amendSubjectMarkers.some((marker) => subject.includes(marker)) || amendBodyPatterns.some((pattern) => pattern.test(haystack))) {
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

  private buildDiagnostics(context: BookingParserContext): BookingParserDiagnostics {
    const from = context.from ?? context.headers.from ?? '';
    const subject = context.subject ?? '';
    const fromMatch = /freetour/i.test(from);
    const subjectMatch = /freetour/i.test(subject);
    const freeTourSender = isFreeTourDomainSender(from);
    const paidReservationTemplate = isPaidReservationSubject(subject) && isFreeTourBookingsSender(from);
    const cancellationTemplate = isCancellationSubject(subject) && freeTourSender;
    const text = context.textBody || context.rawTextBody || context.snippet || '';
    const bookingReference = paidReservationTemplate
      ? extractPaidReservationBookingId(subject, text)
      : cancellationTemplate
        ? extractCancellationBookingId(subject, text)
        : null;

    const canParseChecks: BookingParserCheck[] = [
      { label: 'from matches /freetour/i', passed: fromMatch, value: from },
      { label: 'subject matches /freetour/i', passed: subjectMatch, value: subject },
      { label: 'sender is @freetour.com', passed: freeTourSender, value: from },
      { label: 'matches paid reservation template', passed: paidReservationTemplate, value: subject },
      { label: 'matches cancellation template', passed: cancellationTemplate, value: subject },
    ];
    const parseChecks: BookingParserCheck[] = [
      { label: 'text body present', passed: Boolean(text) },
      { label: 'booking reference detected', passed: Boolean(bookingReference), value: bookingReference ?? null },
    ];

    return {
      name: this.name,
      canParse: paidReservationTemplate || cancellationTemplate,
      canParseChecks,
      parseChecks,
    };
  }

  diagnose(context: BookingParserContext): BookingParserDiagnostics {
    return this.buildDiagnostics(context);
  }

  canParse(context: BookingParserContext): boolean {
    return this.buildDiagnostics(context).canParse;
  }

  async parse(context: BookingParserContext): Promise<ParsedBookingEvent | null> {
    const from = context.from ?? context.headers.from ?? '';
    const subject = context.subject ?? '';
    const text = context.textBody || context.rawTextBody || context.snippet || '';
    if (!text) {
      return null;
    }

    const paidReservationTemplate = isPaidReservationSubject(subject) && isFreeTourBookingsSender(from);
    const cancellationTemplate = isCancellationSubject(subject) && isFreeTourDomainSender(from);
    if (!paidReservationTemplate && !cancellationTemplate) {
      return null;
    }

    const bookingReference = paidReservationTemplate
      ? extractPaidReservationBookingId(subject, text)
      : extractCancellationBookingId(subject, text);

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
    if (!productName && cancellationTemplate) {
      const cancelSubjectMatch = subject.match(/cancellation:\s*(.+)$/i);
      if (cancelSubjectMatch?.[1]) {
        productName = cancelSubjectMatch[1].trim();
      }
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
    let parsedDate: dayjs.Dayjs | null = null;
    if (normalizedDate) {
      for (const format of FREETOUR_DATE_FORMATS) {
        try {
          const candidate = dayjs.tz(normalizedDate, format, FREETOUR_TIMEZONE);
          if (candidate.isValid()) {
            parsedDate = candidate;
            break;
          }
        } catch {
          // Ignore parse errors for non-standard date tokens and keep trying next format.
        }
      }
    }
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
