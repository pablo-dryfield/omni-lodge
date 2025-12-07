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
const VIATOR_TIMEZONE = process.env.VIATOR_TIMEZONE ?? DEFAULT_BOOKING_TIMEZONE;

const DATE_FORMATS = ['ddd, MMM D, YYYY', 'ddd, MMM DD, YYYY', 'MMM D, YYYY', 'MMM DD, YYYY', 'MMMM D, YYYY', 'MMMM DD, YYYY'];

const MONEY_PATTERN = /([A-Z]{3})\s*([\d.,]+)/i;
const TIME_PATTERN = /(\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.|am|pm)?)\b/i;

const COCKTAIL_GRADE_CODES = new Set(['TG2', 'TG2~21:00', 'TG2-21:00', 'TG2=21:00']);
const COCKTAIL_KEYWORDS = [/cocktail/i, /open bar/i, /vip entry/i, /welcome shots?/i];

const normalizeBookingText = (value: string): string =>
  value.replace(/[\u00A0\u202F\u2007]/g, ' ');

const extractField = (text: string, label: string, nextLabels: string[] = []): string | null => {
  const lower = text.toLowerCase();
  const anchor = label.toLowerCase();
  const start = lower.indexOf(anchor);
  if (start === -1) {
    return null;
  }

  let value = text.slice(start + label.length);
  if (nextLabels.length > 0) {
    const lowerValue = value.toLowerCase();
    let endIndex = -1;
    for (const candidate of nextLabels) {
      const idx = lowerValue.indexOf(candidate.toLowerCase());
      if (idx !== -1 && (endIndex === -1 || idx < endIndex)) {
        endIndex = idx;
      }
    }
    if (endIndex !== -1) {
      value = value.slice(0, endIndex);
    }
  }

  return value.trim();
};

const parseMoney = (input: string | null): { currency: string | null; amount: number | null } => {
  if (!input) {
    return { currency: null, amount: null };
  }
  const match = input.match(MONEY_PATTERN);
  if (!match) {
    return { currency: null, amount: null };
  }
  const amount = Number.parseFloat(match[2].replace(/,/g, ''));
  return {
    currency: match[1]?.toUpperCase() ?? null,
    amount: Number.isNaN(amount) ? null : amount,
  };
};

const sanitizeLeadTraveler = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const noiseMarkers = ['Optional:', 'Please visit', 'Manage Bookings', 'Have questions', 'If you need help', 'Management Center'];
  let result = value;
  for (const marker of noiseMarkers) {
    const idx = result.toLowerCase().indexOf(marker.toLowerCase());
    if (idx !== -1) {
      result = result.slice(0, idx);
    }
  }
  return result.trim();
};

const parseName = (
  value: string | null,
): { firstName: string | null; lastName: string | null } => {
  if (!value) {
    return { firstName: null, lastName: null };
  }
  const tokens = value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return { firstName: null, lastName: null };
  }
  const firstName = tokens.shift() ?? null;
  const lastName = tokens.length > 0 ? tokens.join(' ') : null;
  return { firstName, lastName };
};

const parseTravelDate = (
  value: string | null,
  timeHint: string | null,
): { experienceDate: string | null; experienceStartAt: Date | null } => {
  if (!value) {
    return { experienceDate: null, experienceStartAt: null };
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  const candidateValues = [normalized];
  if (/^[A-Za-z]{3},/.test(normalized)) {
    candidateValues.push(normalized.replace(/^[A-Za-z]{3},\s*/, ''));
  }

  let parsedDate: dayjs.Dayjs | null = null;
  for (const candidateValue of candidateValues) {
    for (const format of DATE_FORMATS) {
      const naïve = dayjs(candidateValue, format, true);
      if (!naïve.isValid()) {
        continue;
      }
      parsedDate = dayjs.tz(naïve.format('YYYY-MM-DD'), 'YYYY-MM-DD', VIATOR_TIMEZONE);
      break;
    }
    if (parsedDate) {
      break;
    }
  }

  if (!parsedDate) {
    return { experienceDate: null, experienceStartAt: null };
  }

  if (timeHint) {
    const timeMatch = timeHint.match(TIME_PATTERN);
    if (timeMatch?.[1]) {
      let normalizedTime = timeMatch[1].trim();
      let format = 'YYYY-MM-DD HH:mm';
      if (/[ap]\.?m\.?/i.test(normalizedTime)) {
        normalizedTime = normalizedTime.replace(/\./g, '').toUpperCase();
        format = 'YYYY-MM-DD h:mm A';
      }
      const withTime = dayjs.tz(`${parsedDate.format('YYYY-MM-DD')} ${normalizedTime}`, format, VIATOR_TIMEZONE);
      if (withTime.isValid()) {
        return {
          experienceDate: parsedDate.format('YYYY-MM-DD'),
          experienceStartAt: withTime.toDate(),
        };
      }
    }
  }

  return {
    experienceDate: parsedDate.format('YYYY-MM-DD'),
    experienceStartAt: null,
  };
};

const parseTravelerCounts = (
  input: string | null,
): { total: number | null; adults: number | null } => {
  if (!input) {
    return { total: null, adults: null };
  }
  const countMatch = input.match(/(\d+)/);
  if (!countMatch) {
    return { total: null, adults: null };
  }
  const total = Number.parseInt(countMatch[1], 10);
  if (Number.isNaN(total)) {
    return { total: null, adults: null };
  }
  return { total, adults: total };
};

const stripHtml = (value: string): string =>
  value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();

const parsePhone = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const normalizedInput = stripHtml(value);
  const cleaned = normalizedInput.replace(/Send the customer a message\.?/i, '').trim();
  const withoutPrefix = cleaned.replace(/^[A-Za-z()\s]+/, '').trim();
  if (!withoutPrefix) {
    return null;
  }
  const match = withoutPrefix.match(/(\+?\d[\d\s\-()]+)/);
  if (!match) {
    return withoutPrefix;
  }
  return match[1].replace(/[()\s-]+/g, ' ').replace(/\s+/g, ' ').trim();
};

const requiresCocktailAddon = (
  grade: string | null,
  gradeCode: string | null,
  description: string | null,
): boolean => {
  const haystacks = [grade, gradeCode, description].filter((value): value is string => Boolean(value));
  if (gradeCode) {
    const normalizedCode = gradeCode.toUpperCase();
    if (COCKTAIL_GRADE_CODES.has(normalizedCode)) {
      return true;
    }
  }
  return haystacks.some((value) => COCKTAIL_KEYWORDS.some((pattern) => pattern.test(value)));
};

const mergeCocktailExtras = (
  snapshot: Record<string, unknown> | null | undefined,
  quantity: number,
): Record<string, unknown> => {
  const next: Record<string, unknown> = snapshot && typeof snapshot === 'object' ? { ...snapshot } : {};
  const existingExtras =
    next.extras && typeof next.extras === 'object'
      ? { ...(next.extras as Record<string, number>) }
      : { tshirts: 0, cocktails: 0, photos: 0 };
  existingExtras.cocktails = (existingExtras.cocktails ?? 0) + quantity;
  next.extras = existingExtras;
  return next;
};

const deriveStatusFromContext = (context: BookingParserContext, textBody: string): BookingStatus => {
  const haystack = `${context.subject ?? ''}\n${textBody ?? ''}`.toLowerCase();

  if (/(?:canceled|cancelled|cancellation)/i.test(haystack)) {
    return 'cancelled';
  }
  if (/(?:amended|amendment|changed|change|modified|updated|rebooked|rebook)/i.test(haystack)) {
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

export class ViatorBookingParser implements BookingEmailParser {
  public readonly name = 'viator';

  canParse(context: BookingParserContext): boolean {
    const haystack = `${context.from ?? ''} ${context.subject ?? ''}`.toLowerCase();
    if (!haystack.includes('viator')) {
      return false;
    }
    return /booking reference:/i.test(context.textBody ?? context.rawTextBody ?? '');
  }

  async parse(context: BookingParserContext): Promise<ParsedBookingEvent | null> {
    const text = context.textBody || context.rawTextBody || context.snippet || '';
    if (!text) {
      return null;
    }

    const normalizedText = normalizeBookingText(text);

    const bookingReferenceRaw = extractField(normalizedText, 'Booking Reference:', ['Tour Name:']);
    const bookingReferenceMatch = bookingReferenceRaw?.match(/#?[A-Z0-9-]+/);
    const bookingReference = bookingReferenceMatch?.[0]?.replace(/^#/, '') ?? null;
    if (!bookingReference) {
      return null;
    }

    const tourName = extractField(normalizedText, 'Tour Name:', ['Travel Date:']);
    const travelDate = extractField(normalizedText, 'Travel Date:', ['Lead Traveler Name:']);
    const leadTravelerRaw = extractField(normalizedText, 'Lead Traveler Name:', [
      'Traveler Names:',
      'Travelers:',
      'Product Code:',
      'Tour Grade:',
      'Tour Grade Code:',
      'Tour Grade Description:',
      'Tour Language:',
      'Location:',
      'Special Requirements:',
    ]);
    const travelerNames = extractField(normalizedText, 'Traveler Names:', ['Travelers:']);
    const travelers = extractField(normalizedText, 'Travelers:', ['Product Code:']);
    const productCode = extractField(normalizedText, 'Product Code:', ['Tour Grade:']);
    const tourGrade = extractField(normalizedText, 'Tour Grade:', ['Tour Grade Code:']);
    const tourGradeCode = extractField(normalizedText, 'Tour Grade Code:', ['Tour Grade Description:']);
    const gradeDescription = extractField(normalizedText, 'Tour Grade Description:', ['Tour Language:']);
    const tourLanguage = extractField(normalizedText, 'Tour Language:', ['Location:']);
    const location = extractField(normalizedText, 'Location:', [
      'Net Rate:',
      'Travel Date:',
      'Lead Traveler Name:',
      'Meeting Point:',
      'Special Requirements:',
      'Phone:',
      'Optional:',
      'Have questions',
    ]);
    const netRate = extractField(normalizedText, 'Net Rate:', ['Meeting Point:', 'Special Requirements:', 'Phone:', 'Optional:']);
    const meetingPoint = extractField(normalizedText, 'Meeting Point:', ['Special Requirements:', 'Phone:', 'Optional:']);
    const specialRequirements = extractField(normalizedText, 'Special Requirements:', ['Phone:', 'Optional:', 'Have questions']);
    const phone = extractField(normalizedText, 'Phone:', ['Optional:', 'Have questions', 'Management Center', 'Send the customer a message.']);

    const timeHint = tourGrade ?? tourGradeCode ?? '';
    const schedule = parseTravelDate(travelDate, timeHint);
    const counts = parseTravelerCounts(travelers);
    const leadTraveler = sanitizeLeadTraveler(leadTravelerRaw);
    const nameParts = parseName(leadTraveler);
    const money = parseMoney(netRate);
    const guestPhone = parsePhone(phone);

    const bookingFields: BookingFieldPatch = {};
    const assignField = <K extends keyof BookingFieldPatch>(key: K, value: BookingFieldPatch[K]): void => {
      if (value !== null && value !== undefined) {
        bookingFields[key] = value;
      }
    };

    assignField('productName', tourName ?? null);
    assignField('productVariant', tourGrade ?? tourGradeCode ?? null);
    assignField('guestFirstName', nameParts.firstName);
    assignField('guestLastName', nameParts.lastName);
    assignField('guestPhone', guestPhone);
    assignField('partySizeTotal', counts.total);
    assignField('partySizeAdults', counts.adults);
    assignField('experienceDate', schedule.experienceDate);
    assignField('currency', money.currency);
    assignField('priceGross', money.amount ?? null);
    assignField('priceNet', money.amount ?? null);
    assignField('baseAmount', money.amount ?? null);
    assignField('pickupLocation', meetingPoint ?? location ?? null);

    if (schedule.experienceStartAt) {
      bookingFields.experienceStartAt = schedule.experienceStartAt;
    }

    const status = deriveStatusFromContext(context, normalizedText);
    const eventType = statusToEventType(status);
    if (requiresCocktailAddon(tourGrade, tourGradeCode, gradeDescription)) {
      const cocktailQuantity = counts.total ?? counts.adults ?? null;
      if (cocktailQuantity && cocktailQuantity > 0) {
        bookingFields.addonsSnapshot = mergeCocktailExtras(bookingFields.addonsSnapshot, cocktailQuantity);
      }
    }

    const noteParts: string[] = [];
    if (travelerNames) {
      noteParts.push(`Traveler names: ${travelerNames}`);
    }
    if (tourLanguage) {
      noteParts.push(`Tour language: ${tourLanguage}`);
    }
    if (location && meetingPoint) {
      noteParts.push(`Location: ${location}`);
    }
    if (gradeDescription) {
      noteParts.push(`Grade description: ${gradeDescription}`);
    }
    if (productCode) {
      noteParts.push(`Product code: ${productCode}`);
    }
    if (tourGradeCode) {
      noteParts.push(`Grade code: ${tourGradeCode}`);
    }
    if (specialRequirements) {
      noteParts.push(`Special requirements: ${specialRequirements}`);
    }
    if (status === 'cancelled') {
      noteParts.push('Email indicates booking was cancelled.');
    } else if (status === 'amended') {
      noteParts.push('Email indicates booking was amended.');
    }
    if (noteParts.length > 0) {
      bookingFields.notes = noteParts.join(' | ');
    }

    const paymentStatus = money.amount !== null ? 'paid' : 'unknown';

    return {
      platform: 'viator',
      platformBookingId: bookingReference,
      platformOrderId: bookingReference,
      eventType,
      status,
      paymentStatus,
      bookingFields,
      occurredAt: context.receivedAt ?? context.internalDate ?? null,
      sourceReceivedAt: context.receivedAt ?? context.internalDate ?? null,
    };
  }
}
