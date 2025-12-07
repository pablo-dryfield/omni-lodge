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

const addonKeywordMatchers: Array<{ test: RegExp; field: 'tshirts' | 'cocktails' | 'photos' }> = [
  { test: /cocktail|open\s+bar|vip entry/i, field: 'cocktails' },
  { test: /instant\s+photos?/i, field: 'photos' },
  { test: /t-?shirts?|pub\s+crawl\s+t-?shirt/i, field: 'tshirts' },
];

const extractParticipantsAndExtras = (
  text: string,
): { adults: number | null; extras: { tshirts: number; cocktails: number; photos: number } } => {
  const extras = { tshirts: 0, cocktails: 0, photos: 0 };
  let adults: number | null = null;
  const pattern = /(?:^|[\s,>])(\d+)\s*[x×]\s*([A-Za-z][^,\n]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const quantity = Number.parseInt(match[1], 10);
    if (!Number.isFinite(quantity)) {
      continue;
    }
    const label = match[2].trim();
    if (!label) {
      continue;
    }
    if (adults === null && /\badults?\b/i.test(label)) {
      adults = quantity;
      continue;
    }
    const keyword = addonKeywordMatchers.find(({ test }) => test.test(label));
    if (keyword) {
      extras[keyword.field] += quantity;
    }
  }
  return { adults, extras };
};

const mergeExtrasSnapshot = (
  snapshot: Record<string, unknown> | null | undefined,
  extras: { tshirts: number; cocktails: number; photos: number },
): Record<string, unknown> => {
  const current: Record<string, unknown> = snapshot && typeof snapshot === 'object' ? { ...snapshot } : {};
  const existing =
    current.extras && typeof current.extras === 'object'
      ? { ...(current.extras as { tshirts?: number; cocktails?: number; photos?: number }) }
      : {};
  current.extras = {
    tshirts: (existing.tshirts ?? 0) + extras.tshirts,
    cocktails: (existing.cocktails ?? 0) + extras.cocktails,
    photos: (existing.photos ?? 0) + extras.photos,
  };
  return current;
};

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
  const stripMetaMarkers = (value: string): string => {
    const markers = ['View booking', 'Most important data', 'Number of participants', 'Reference number', 'Main customer', 'Tour language'];
    let result = value;
    for (const marker of markers) {
      const idx = result.toLowerCase().indexOf(marker.toLowerCase());
      if (idx !== -1) {
        result = result.slice(0, idx).trim();
      }
    }
    return result;
  };

  let working = stripMetaMarkers(rawName.trim());
  const optionMatch = working.match(/(.+?)\s+Option:\s*(.+)$/i);
  let candidateVariant: string | null = null;
  if (optionMatch) {
    working = optionMatch[1].trim();
    candidateVariant = stripMetaMarkers(optionMatch[2].trim());
  }

  for (const candidate of PRODUCT_NAME_CANONICALS) {
    for (const pattern of candidate.patterns) {
      if (pattern.test(working)) {
        const needsVariant = working.localeCompare(candidate.canonical, undefined, { sensitivity: 'accent' }) !== 0;
        return {
          name: candidate.canonical,
          variant: needsVariant ? candidateVariant ?? working : candidateVariant ?? null,
        };
      }
    }
  }
  return { name: working, variant: candidateVariant };
};

const extractExperienceDateTime = (
  text: string,
): { dateText: string; timeText: string } | null => {
  const patterns = [
    /Date\s+New[.:]?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})[^\S\r\n]*(?:at|\@)?[^\S\r\n]*(\d{1,2}:\d{2}\s*(?:AM|PM))/i,
    /Date[:\s]+([A-Za-z]+\s+\d{1,2},\s+\d{4})[^\S\r\n]*(?:at|\@)?[^\S\r\n]*(\d{1,2}:\d{2}\s*(?:AM|PM))/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        dateText: match[1],
        timeText: match[2],
      };
    }
  }
  return null;
};

const extractBookingFields = (text: string): BookingFieldPatch => {
  const fields: BookingFieldPatch = {};

  const productMatch = text.match(/has been booked:\s+(.+?)\s+Reference number/i);
  if (productMatch) {
    let rawName = productMatch[1].trim();
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

  const customerMatch = text.match(/Main customer[:\s]+([A-Za-z\u00C0-\u017F' -]+?)(?=\s+[a-z0-9._%+-]+@)/i);
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

  const participantInfo = extractParticipantsAndExtras(text);
  if (participantInfo.adults !== null) {
    fields.partySizeTotal = participantInfo.adults;
    fields.partySizeAdults = participantInfo.adults;
  }
  const hasExtras = Object.values(participantInfo.extras).some((qty) => qty > 0);
  if (hasExtras) {
    fields.addonsSnapshot = mergeExtrasSnapshot(fields.addonsSnapshot, participantInfo.extras);
  }

  const dateInfo = extractExperienceDateTime(text);
  if (dateInfo) {
    const parsed = dayjs.tz(
      `${dateInfo.dateText} ${dateInfo.timeText}`,
      'MMMM D, YYYY h:mm A',
      GETYOURGUIDE_TIMEZONE,
    );
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
