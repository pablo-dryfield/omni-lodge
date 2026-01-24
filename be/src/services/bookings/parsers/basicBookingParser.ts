import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import type {
  BookingEmailParser,
  BookingParserCheck,
  BookingFieldPatch,
  BookingParserContext,
  BookingParserDiagnostics,
  ParsedBookingEvent,
} from '../types.js';
import type { BookingEventType, BookingPlatform, BookingStatus } from '../../../constants/bookings.js';

dayjs.extend(customParseFormat);

const PLATFORM_HINTS: Array<{ platform: BookingPlatform; patterns: RegExp[] }> = [
  { platform: 'fareharbor', patterns: [/fareharbor/i, /fare harbor/i] },
  { platform: 'ecwid', patterns: [/ecwid/i] },
  { platform: 'viator', patterns: [/viator/i] },
  { platform: 'getyourguide', patterns: [/get\s?your\s?guide/i, /gyg/i] },
  { platform: 'freetour', patterns: [/freetour/i, /free tour/i] },
  { platform: 'airbnb', patterns: [/airbnb/i] },
];

const DATE_FORMATS = [
  'YYYY-MM-DD',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD-MM-YYYY',
  'MM-DD-YYYY',
  'MMMM D, YYYY',
  'MMM D, YYYY',
  'D MMMM YYYY',
  'D MMM YYYY',
] as const;

const TIME_PATTERN = /(\d{1,2}:\d{2})\s*(AM|PM|A\.M\.|P\.M\.)?/i;
const BOOKING_ID_PATTERN = /(?:booking|reservation)\s*(?:id|number|no\.?|#)?\s*[:#]?\s*([A-Za-z0-9_-]{4,})/i;
const NUMERIC_ID_PATTERN = /#([A-Za-z0-9]{4,})/;

const detectPlatform = (context: BookingParserContext): BookingPlatform => {
  const haystack = [
    context.from ?? '',
    context.subject ?? '',
    context.textBody,
    context.htmlBody ?? '',
    context.headers['x-envelope-from'] ?? '',
  ].join(' ');

  for (const hint of PLATFORM_HINTS) {
    if (hint.patterns.some((pattern) => pattern.test(haystack))) {
      return hint.platform;
    }
  }

  return 'unknown';
};

const truncate = (value: string, max = 190): string => {
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max);
};

const extractBookingId = (context: BookingParserContext): string | null => {
  const sources = [context.subject, context.snippet, context.textBody, context.htmlBody].filter(Boolean) as string[];
  for (const source of sources) {
    const explicitMatch = source.match(BOOKING_ID_PATTERN);
    if (explicitMatch?.[1]) {
      return truncate(explicitMatch[1]);
    }
    const numericMatch = source.match(NUMERIC_ID_PATTERN);
    if (numericMatch?.[1]) {
      return truncate(numericMatch[1]);
    }
  }
  return truncate(context.messageId);
};

const detectStatus = (context: BookingParserContext): BookingStatus => {
  const text = `${context.subject ?? ''}\n${context.textBody ?? ''}`.toLowerCase();
  if (/cancelled|canceled|cancellation|voided/.test(text)) {
    return 'cancelled';
  }
  if (/amend|modified|updated|changed|rebooked|altered/.test(text)) {
    return 'amended';
  }
  if (/no[-\s]?show/.test(text)) {
    return 'no_show';
  }
  return 'confirmed';
};

const statusToEventType = (status: BookingStatus): BookingEventType => {
  switch (status) {
    case 'amended':
      return 'amended';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'created';
  }
};

const detectExperienceMoment = (
  context: BookingParserContext,
): { date?: string | null; startAt?: Date | null } => {
  const text = `${context.subject ?? ''}\n${context.textBody ?? ''}`;
  let parsedDate: dayjs.Dayjs | null = null;

  for (const format of DATE_FORMATS) {
    const matcher = new RegExp(
      format
        .replace('YYYY', '\\d{4}')
        .replace('MM', '\\d{2}')
        .replace('DD', '\\d{2}')
        .replace('MMMM', '[A-Z][a-z]+')
        .replace('MMM', '[A-Z][a-z]{2}')
        .replace('D', '\\d{1,2}'),
      'g',
    );
    const match = text.match(matcher);
    if (match && match[0]) {
      const candidate = dayjs(match[0], format, true);
      if (candidate.isValid()) {
        parsedDate = candidate;
        break;
      }
    }
  }

  if (!parsedDate) {
    const isoMatch = text.match(/\d{4}-\d{2}-\d{2}/);
    if (isoMatch?.[0]) {
      const candidate = dayjs(isoMatch[0], 'YYYY-MM-DD', true);
      if (candidate.isValid()) {
        parsedDate = candidate;
      }
    }
  }

  const timeMatch = text.match(TIME_PATTERN);

  if (!parsedDate) {
    return { date: null, startAt: null };
  }

  if (timeMatch?.[1]) {
    const timeToken = timeMatch[1];
    const withTime = dayjs(`${parsedDate.format('YYYY-MM-DD')} ${timeToken}`, ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD hh:mm'], true);
    return {
      date: parsedDate.format('YYYY-MM-DD'),
      startAt: withTime.isValid() ? withTime.toDate() : parsedDate.toDate(),
    };
  }

  return {
    date: parsedDate.format('YYYY-MM-DD'),
    startAt: parsedDate.toDate(),
  };
};

const detectPartySize = (context: BookingParserContext): {
  total?: number | null;
  adults?: number | null;
  children?: number | null;
} => {
  const text = context.textBody.toLowerCase();
  const totalMatch = text.match(/(?:party|group|total|guests?)\D{0,8}(\d{1,3})/);
  const adultMatch = text.match(/(?:adult[s]?|men|women)\D{0,5}(\d{1,3})/);
  const childMatch = text.match(/(?:child(?:ren)?|kids?)\D{0,5}(\d{1,3})/);

  return {
    total: totalMatch ? Number.parseInt(totalMatch[1], 10) : null,
    adults: adultMatch ? Number.parseInt(adultMatch[1], 10) : null,
    children: childMatch ? Number.parseInt(childMatch[1], 10) : null,
  };
};

const extractGuestName = (raw?: string | null): { firstName?: string | null; lastName?: string | null } => {
  if (!raw) {
    return {};
  }
  const namePart = raw.split('<')[0].trim();
  if (!namePart) {
    return {};
  }
  const [firstName, ...rest] = namePart.split(/\s+/);
  const lastName = rest.length > 0 ? rest.join(' ') : null;
  return { firstName: firstName ?? null, lastName };
};

export class BasicBookingParser implements BookingEmailParser {
  public readonly name = 'basic-heuristics';

  private buildDiagnostics(context: BookingParserContext): BookingParserDiagnostics {
    const textPresent = Boolean(context.textBody?.trim().length);
    const bookingId = extractBookingId(context);
    const canParseChecks: BookingParserCheck[] = [
      { label: 'text body present', passed: textPresent },
      { label: 'booking id detected', passed: Boolean(bookingId), value: bookingId },
    ];

    return {
      name: this.name,
      canParse: textPresent && Boolean(bookingId),
      canParseChecks,
    };
  }

  diagnose(context: BookingParserContext): BookingParserDiagnostics {
    return this.buildDiagnostics(context);
  }

  canParse(context: BookingParserContext): boolean {
    return this.buildDiagnostics(context).canParse;
  }

  async parse(context: BookingParserContext): Promise<ParsedBookingEvent | null> {
    const bookingId = extractBookingId(context);
    if (!bookingId) {
      return null;
    }

    const platform = detectPlatform(context);
    const status = detectStatus(context);
    const eventType = statusToEventType(status);
    const { date, startAt } = detectExperienceMoment(context);
    const party = detectPartySize(context);
    const guestName = extractGuestName(context.headers.from ?? context.from);

    const bookingFields: BookingFieldPatch = {
      experienceDate: date ?? null,
      experienceStartAt: startAt ?? null,
      partySizeTotal: party.total ?? null,
      partySizeAdults: party.adults ?? null,
      partySizeChildren: party.children ?? null,
      guestFirstName: guestName.firstName ?? null,
      guestLastName: guestName.lastName ?? null,
      notes: 'Parsed via heuristics. Please verify details with the source email.',
    };

    return {
      platform,
      platformBookingId: bookingId,
      status,
      eventType,
      paymentStatus: 'unknown',
      bookingFields,
      addons: [],
      sourceReceivedAt: context.receivedAt ?? context.internalDate ?? null,
      occurredAt: context.receivedAt ?? context.internalDate ?? null,
      rawPayload: {
        subject: context.subject,
        snippet: context.snippet,
      },
    };
  }
}
