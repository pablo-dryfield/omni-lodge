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
const AIRBNB_TIMEZONE = process.env.AIRBNB_TIMEZONE ?? DEFAULT_BOOKING_TIMEZONE;

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

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

const decodeHtmlEntities = (value: string): string => {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
};

const cleanListingTitle = (value: string): string => {
  let result = value.trim();
  result = result.replace(/^(?:euid=)?[0-9a-f]{8}(?:-[0-9a-f]{4,})+\s+/i, '');
  result = result.replace(/^[0-9]{6,}\s+/, '');
  return result.trim();
};

const MONEY_SYMBOLS: Record<string, string> = {
  zl: 'PLN',
  'z\u0142': 'PLN',
  pln: 'PLN',
  $: 'USD',
  '\u20ac': 'EUR',
  '\u00a3': 'GBP',
};

const TIMEZONE_ALIASES: Record<string, string> = {
  CET: 'Europe/Warsaw',
  CEST: 'Europe/Warsaw',
  UTC: 'UTC',
  GMT: 'UTC',
};

const parseCount = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  const match = value.match(/(\d{1,3})/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
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

const parseMoney = (value: string | null): { amount: number | null; currency: string | null } => {
  if (!value) {
    return { amount: null, currency: null };
  }
  const match = value.match(/([A-Za-z\u0142$€£]{1,5})?\s*([\d.,]+)/i);
  if (!match) {
    return { amount: null, currency: null };
  }
  const amount = Number.parseFloat(match[2].replace(/,/g, ''));
  if (Number.isNaN(amount)) {
    return { amount: null, currency: null };
  }
  const rawSymbol = match[1]?.trim() ?? '';
  const symbol = rawSymbol.toLowerCase();
  const currency =
    MONEY_SYMBOLS[rawSymbol] ??
    MONEY_SYMBOLS[symbol] ??
    (rawSymbol && rawSymbol.length === 3 ? rawSymbol.toUpperCase() : null);
  return { amount, currency };
};

const stripWeekday = (value: string): string => {
  const trimmed = value.trim();
  const commaStripped = trimmed.replace(/^[A-Za-z]{3,9},\s+/i, '');
  if (commaStripped !== trimmed) {
    return commaStripped;
  }
  return trimmed.replace(/^[A-Za-z]{3,9}\s+(?=[A-Za-z]+)/i, '');
};

const parseEmail = (text: string): string | null => {
  const match = text.match(/[A-Z0-9._%+-]+@(?:guest\.)?airbnb\.com/i) ??
    text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? null;
};

const parsePhone = (text: string): string | null => {
  const match = text.match(/(?:phone|contact)\s*[:\-]?\s*([+0-9()[\]\s.-]{6,})/i);
  if (!match?.[1]) {
    return null;
  }
  let normalized = match[1].replace(/[().-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`;
  }
  return normalized;
};

const extractGuestNameFromSubject = (subject?: string | null): string | null => {
  if (!subject) {
    return null;
  }
  const confirmedMatch = subject.match(
    /^(?:confirmed|canceled|cancelled|updated|alteration|change|request|inquiry)\s*:\s*([A-Za-z\u00C0-\u017F' -]+?)\s+(?:booked|requested|cancelled|canceled|updated|changed|altered)\b/i,
  );
  if (confirmedMatch?.[1]) {
    return confirmedMatch[1].trim();
  }
  const bookedMatch = subject.match(/^([A-Za-z\u00C0-\u017F' -]+?)\s+booked your experience\b/i);
  if (bookedMatch?.[1]) {
    return bookedMatch[1].trim();
  }
  return null;
};

const extractBookingId = (text: string, subject?: string | null): string | null => {
  const sources = [text, subject].filter(Boolean) as string[];
  const patterns: RegExp[] = [
    /\b(?:reservation|confirmation|booking)\s*(?:code|id|number|#)?\s*[:#]?\s*([A-Z0-9]{4,})/i,
    /\b(?:trip|reservation)\s*id\s*[:#]?\s*([A-Z0-9]{4,})/i,
  ];

  for (const source of sources) {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }
    const fallbackMatch = source.match(/#([A-Z0-9]{5,})/i);
    if (fallbackMatch?.[1]) {
      return fallbackMatch[1];
    }
  }
  return null;
};

const DATE_ONLY_FORMATS = [
  'ddd, MMM D, YYYY',
  'ddd, MMMM D, YYYY',
  'dddd, MMM D, YYYY',
  'dddd, MMMM D, YYYY',
  'MMM D, YYYY',
  'MMMM D, YYYY',
  'MMM D YYYY',
  'MMMM D YYYY',
  'YYYY-MM-DD',
];

const DATE_FORMATS = [
  'ddd, MMM D, YYYY h:mm A',
  'ddd, MMM D, YYYY',
  'dddd, MMM D, YYYY h:mm A',
  'dddd, MMM D, YYYY',
  'MMM D, YYYY h:mm A',
  'MMM D, YYYY',
  'MMMM D, YYYY h:mm A',
  'MMMM D, YYYY',
  'MMM D YYYY',
  'MMMM D YYYY',
  'YYYY-MM-DD',
];

const resolveTimezone = (label?: string | null): string => {
  if (!label) {
    return AIRBNB_TIMEZONE;
  }
  const key = label.trim().toUpperCase();
  return TIMEZONE_ALIASES[key] ?? AIRBNB_TIMEZONE;
};

const parseDatePart = (value: string, timezoneName: string): dayjs.Dayjs | null => {
  const candidates = [value, stripWeekday(value)].filter((entry, index, self) => entry && self.indexOf(entry) === index);
  for (const candidateValue of candidates) {
    for (const format of DATE_ONLY_FORMATS) {
      const plain = dayjs(candidateValue, format, true);
      if (!plain.isValid()) {
        continue;
      }
      try {
        const candidate = dayjs.tz(plain.format('YYYY-MM-DD'), 'YYYY-MM-DD', timezoneName);
        if (candidate.isValid()) {
          return candidate;
        }
      } catch (error) {
        continue;
      }
    }
  }
  return null;
};

const parseDateTimeValue = (value: string | null): dayjs.Dayjs | null => {
  if (!value) {
    return null;
  }
  const normalized = value
    .replace(/\s+at\s+/i, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(?:GMT|UTC)[+-]\d{1,2}/gi, '')
    .trim();
  const candidates = [normalized, stripWeekday(normalized)].filter((entry, index, self) => entry && self.indexOf(entry) === index);

  for (const candidateValue of candidates) {
    for (const format of DATE_FORMATS) {
      try {
        const candidate = dayjs.tz(candidateValue, format, AIRBNB_TIMEZONE);
        if (candidate.isValid()) {
          return candidate;
        }
      } catch (error) {
        continue;
      }
    }
  }

  const timeMatch = normalized.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
  if (timeMatch) {
    const datePart = normalized.replace(timeMatch[0], '').trim();
    for (const format of ['ddd, MMM D, YYYY', 'dddd, MMM D, YYYY', 'MMM D, YYYY', 'MMMM D, YYYY', 'MMM D YYYY', 'MMMM D YYYY', 'YYYY-MM-DD']) {
      try {
        const cleanedPart = stripWeekday(datePart);
        const dateCandidate = dayjs.tz(cleanedPart, format, AIRBNB_TIMEZONE);
        if (!dateCandidate.isValid()) {
          continue;
        }
        const combined = dayjs.tz(
          `${dateCandidate.format('YYYY-MM-DD')} ${timeMatch[1]}`,
          'YYYY-MM-DD h:mm A',
          AIRBNB_TIMEZONE,
        );
        if (combined.isValid()) {
          return combined;
        }
        return dateCandidate;
      } catch (error) {
        continue;
      }
    }
  }

  return null;
};

const extractExperienceWindow = (
  text: string,
): { startAt: dayjs.Dayjs | null; endAt: dayjs.Dayjs | null } => {
  const match = text.match(
    /Date\s*(?:and|&)\s*time\s+([A-Za-z]{3,9},?\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})\s*[\u00b7\u2022]?\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s*[-\u2013\u2014]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))(?:\s*([A-Za-z]{2,5}))?/i,
  );
  if (!match) {
    return { startAt: null, endAt: null };
  }
  const timezoneName = resolveTimezone(match[4] ?? null);
  const datePart = parseDatePart(match[1], timezoneName);
  if (!datePart) {
    return { startAt: null, endAt: null };
  }
  const dateStamp = datePart.format('YYYY-MM-DD');
  const start = dayjs.tz(`${dateStamp} ${match[2]}`, 'YYYY-MM-DD h:mm A', timezoneName);
  let end = dayjs.tz(`${dateStamp} ${match[3]}`, 'YYYY-MM-DD h:mm A', timezoneName);
  if (start.isValid() && end.isValid() && end.isBefore(start)) {
    end = end.add(1, 'day');
  }
  return {
    startAt: start.isValid() ? start : null,
    endAt: end.isValid() ? end : null,
  };
};

const extractListingName = (text: string): string | null => {
  const stopLabels = ['Check-in', 'Check out', 'Check-out', 'Checkout', 'Guests', 'Reservation', 'Confirmation', 'Total'];
  const labels = ['Listing:', 'Listing name:', 'Home:', 'Property:', 'Your place:', 'Accommodation:', 'Experience:'];
  for (const label of labels) {
    const value = extractField(text, label, stopLabels);
    if (value) {
      return cleanListingTitle(value);
    }
  }
  const urlMatch = text.match(/(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9 '&-]{5,})\s+https?:\/\/www\.airbnb\.com\/experiences\/\d+/i);
  if (urlMatch?.[1]) {
    return cleanListingTitle(urlMatch[1]);
  }
  const hostedByMatch = text.match(/(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9 '&-]{5,})\s+Hosted by/i);
  if (hostedByMatch?.[1]) {
    return cleanListingTitle(hostedByMatch[1]);
  }
  return null;
};

const extractReservationLink = (htmlBody?: string | null, textBody?: string | null): string | null => {
  const html = htmlBody ?? '';
  const anchorMatch = html.match(
    /href=["']([^"']+)["'][^>]*>\s*View reservation\s*<\/a>/i,
  );
  if (anchorMatch?.[1]) {
    return decodeHtmlEntities(anchorMatch[1]).trim();
  }

  const candidates = [
    ...(html.match(/https?:\/\/www\.airbnb\.com\/hosting\/[^\s"'<>]+/gi) ?? []),
    ...(textBody?.match(/https?:\/\/www\.airbnb\.com\/hosting\/[^\s"'<>]+/gi) ?? []),
  ];
  if (candidates.length > 0) {
    return decodeHtmlEntities(candidates[0]).trim();
  }
  return null;
};

const extractGuestName = (text: string): string | null => {
  const stopLabels = [
    'Check-in',
    'Check out',
    'Check-out',
    'Checkout',
    'Guests',
    'Reservation',
    'Confirmation',
    'Total',
    'Listing',
    'Phone',
    'Email',
  ];
  const labels = ['Guest:', 'Guest name:', 'Guest Name:', 'Name:'];
  for (const label of labels) {
    const value = extractField(text, label, stopLabels);
    if (value) {
      return value;
    }
  }
  const fromMatch = text.match(/(?:new reservation|reservation request|request to book)\s+from\s+([A-Za-z\u00C0-\u017F' -]+)/i);
  if (fromMatch?.[1]) {
    return fromMatch[1].trim();
  }
  const arrivingMatch = text.match(/([A-Za-z\u00C0-\u017F' -]+)\s+is\s+arriving/i);
  if (arrivingMatch?.[1]) {
    return arrivingMatch[1].trim();
  }
  const bookedMatch = text.match(/([A-Za-z\u00C0-\u017F' -]+)\s+booked your experience\b/i);
  if (bookedMatch?.[1]) {
    return bookedMatch[1].trim();
  }
  return null;
};

const extractStayDates = (text: string): { checkIn: dayjs.Dayjs | null; checkOut: dayjs.Dayjs | null } => {
  const stopLabels = ['Check-out', 'Checkout', 'Guests', 'Reservation', 'Confirmation', 'Total', 'Listing', 'Phone', 'Email'];
  const checkInRaw =
    extractField(text, 'Check-in:', stopLabels) ??
    extractField(text, 'Check in:', stopLabels) ??
    extractField(text, 'Check-in date:', stopLabels);
  const checkOutRaw =
    extractField(text, 'Check-out:', stopLabels) ??
    extractField(text, 'Check out:', stopLabels) ??
    extractField(text, 'Checkout:', stopLabels) ??
    extractField(text, 'Check-out date:', stopLabels);

  return {
    checkIn: parseDateTimeValue(checkInRaw),
    checkOut: parseDateTimeValue(checkOutRaw),
  };
};

const extractEarningsTotal = (text: string): { amount: number | null; currency: string | null } => {
  const totalWithCurrencyMatch = text.match(/Total\s*\(([^)]+)\)\s*([\d.,]+)/i);
  if (totalWithCurrencyMatch) {
    const amount = Number.parseFloat(totalWithCurrencyMatch[2].replace(/,/g, ''));
    const currencyToken = totalWithCurrencyMatch[1].trim();
    const currency =
      MONEY_SYMBOLS[currencyToken.toLowerCase()] ??
      (currencyToken.length === 3 ? currencyToken.toUpperCase() : null);
    return {
      amount: Number.isNaN(amount) ? null : amount,
      currency,
    };
  }

  const totalMatch = text.match(/Total\s*[:\s]+\s*([\d.,]+)\s*([A-Za-z\u0142$€£]{1,5})/i);
  if (totalMatch) {
    const amount = Number.parseFloat(totalMatch[1].replace(/,/g, ''));
    const money = parseMoney(`${totalMatch[2]} ${totalMatch[1]}`);
    return {
      amount: Number.isNaN(amount) ? null : amount,
      currency: money.currency ?? null,
    };
  }
  return { amount: null, currency: null };
};

const deriveStatusFromContext = (context: BookingParserContext, text: string): BookingStatus => {
  const subject = (context.subject ?? '').toLowerCase();
  const body = text.toLowerCase();
  if (subject.includes('cancelled') || subject.includes('canceled')) {
    return 'cancelled';
  }
  if (subject.includes('alteration') || subject.includes('change') || subject.includes('updated') || subject.includes('modified')) {
    return 'amended';
  }
  if (subject.includes('request') || subject.includes('inquiry')) {
    return 'pending';
  }
  if (subject.includes('confirmed') || subject.includes('booked')) {
    return 'confirmed';
  }
  if (/(?:reservation|booking)\s+(?:was|has been)?\s*(?:cancelled|canceled)\b/i.test(body)) {
    return 'cancelled';
  }
  if (/(?:reservation|booking)\s+(?:was|has been)?\s*(?:changed|updated|modified|altered)\b/i.test(body)) {
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

export class AirbnbBookingParser implements BookingEmailParser {
  public readonly name = 'airbnb';

  canParse(context: BookingParserContext): boolean {
    const from = context.from ?? context.headers.from ?? '';
    const subject = context.subject ?? '';
    return /airbnb/i.test(from) || /airbnb/i.test(subject);
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

    const bookingFields: BookingFieldPatch = {};
    const listingName = extractListingName(text);
    if (listingName) {
      bookingFields.productName = listingName;
    }
    const reservationLink = extractReservationLink(context.htmlBody ?? null, context.textBody ?? null);
    if (reservationLink) {
      bookingFields.rawPayloadLocation = reservationLink;
    }

    const guestRaw = extractGuestNameFromSubject(context.subject) ?? extractGuestName(text);
    const guestName = parseName(guestRaw);
    if (guestName.firstName) {
      bookingFields.guestFirstName = guestName.firstName;
    }
    if (guestName.lastName) {
      bookingFields.guestLastName = guestName.lastName;
    }

    const email = parseEmail(text);
    if (email) {
      bookingFields.guestEmail = email;
    }

    const phone = parsePhone(text);
    if (phone) {
      bookingFields.guestPhone = phone;
    }

    const experienceWindow = extractExperienceWindow(text);
    if (experienceWindow.startAt) {
      bookingFields.experienceDate = experienceWindow.startAt.format('YYYY-MM-DD');
      bookingFields.experienceStartAt = experienceWindow.startAt.toDate();
    }
    if (experienceWindow.endAt) {
      bookingFields.experienceEndAt = experienceWindow.endAt.toDate();
      if (!bookingFields.experienceDate) {
        bookingFields.experienceDate = experienceWindow.endAt.format('YYYY-MM-DD');
      }
    }

    if (!experienceWindow.startAt) {
      const stayDates = extractStayDates(text);
      if (stayDates.checkIn) {
        bookingFields.experienceDate = stayDates.checkIn.format('YYYY-MM-DD');
        bookingFields.experienceStartAt = stayDates.checkIn.toDate();
      }
      if (stayDates.checkOut) {
        bookingFields.experienceEndAt = stayDates.checkOut.toDate();
        if (!bookingFields.experienceDate) {
          bookingFields.experienceDate = stayDates.checkOut.format('YYYY-MM-DD');
        }
      }
    }

    const stopLabels = ['Check-in', 'Check out', 'Check-out', 'Checkout', 'Reservation', 'Confirmation', 'Total', 'Listing'];
    const guestsRaw = extractField(text, 'Guests:', stopLabels) ?? extractField(text, 'Guest count:', stopLabels);
    const adultsInlineMatch = text.match(/\bGuests?\s+(\d{1,3})\s+adults?\b/i);
    const totalGuests =
      parseCount(guestsRaw) ??
      parseCount(adultsInlineMatch?.[1] ?? null) ??
      parseCount(text.match(/\b(\d{1,3})\s+guests?\b/i)?.[1] ?? null);

    const adultsRaw = extractField(text, 'Adults:', stopLabels);
    const childrenRaw = extractField(text, 'Children:', stopLabels);
    const adults = parseCount(adultsRaw) ?? parseCount(adultsInlineMatch?.[1] ?? null);
    const children = parseCount(childrenRaw);

    if (adults !== null) {
      bookingFields.partySizeAdults = adults;
    }
    if (children !== null) {
      bookingFields.partySizeChildren = children;
    }
    if (totalGuests !== null) {
      bookingFields.partySizeTotal = totalGuests;
      if (bookingFields.partySizeAdults === undefined || bookingFields.partySizeAdults === null) {
        bookingFields.partySizeAdults = totalGuests;
      }
    } else if (adults !== null || children !== null) {
      bookingFields.partySizeTotal = (adults ?? 0) + (children ?? 0);
    }

    const status = deriveStatusFromContext(context, text);
    const eventType = statusToEventType(status);

    const notes: string[] = [];
    if (status === 'cancelled') {
      notes.push('Email indicates reservation was cancelled.');
    } else if (status === 'amended') {
      notes.push('Email indicates reservation was amended.');
    } else if (status === 'pending') {
      notes.push('Email indicates reservation is pending.');
    }
    if (notes.length > 0) {
      bookingFields.notes = notes.join(' | ');
    }

    const earnings = extractEarningsTotal(text);
    if (earnings.amount !== null) {
      bookingFields.priceGross = earnings.amount;
      bookingFields.baseAmount = earnings.amount;
      bookingFields.priceNet = earnings.amount;
      if (earnings.currency) {
        bookingFields.currency = earnings.currency;
      }
      if (bookingFields.notes) {
        bookingFields.notes = `${bookingFields.notes} | Airbnb earnings total parsed from host email.`;
      } else {
        bookingFields.notes = 'Airbnb earnings total parsed from host email.';
      }
    }

    return {
      platform: 'airbnb',
      platformBookingId: bookingId,
      platformOrderId: bookingId,
      eventType,
      status,
      paymentStatus: 'unknown',
      bookingFields,
      occurredAt: context.receivedAt ?? context.internalDate ?? null,
      sourceReceivedAt: context.receivedAt ?? context.internalDate ?? null,
      rawPayload: {
        subject: context.subject,
        snippet: context.snippet,
      },
    };
  }
}
