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
const GETYOURGUIDE_TIMEZONE =
  (getConfigValue('GETYOURGUIDE_TIMEZONE') as string | null) ?? DEFAULT_BOOKING_TIMEZONE;

const MONEY_SYMBOLS: Record<string, string> = {
  'z\u0142': 'PLN',
  zl: 'PLN',
  pln: 'PLN',
  $: 'USD',
  usd: 'USD',
  '\u20ac': 'EUR',
  eur: 'EUR',
  '\u00a3': 'GBP',
  gbp: 'GBP',
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const GYG_BOOKING_ID_PATTERN = /\bGYG[A-Z0-9]{8,}\b/gi;

const TRANSACTIONAL_SUBJECT_PATTERNS: RegExp[] = [
  /\bbooking\s*-\s*S\d+\s*-\s*GYG[A-Z0-9]{8,}\b/i,
  /\burgent:\s*new booking received\s*-\s*S\d+\s*-\s*GYG[A-Z0-9]{8,}\b/i,
  /\bbooking detail change:\s*-\s*S\d+\s*-\s*GYG[A-Z0-9]{8,}\b/i,
  /\ba booking has been cancel(?:ed|led)\s*-\s*S\d+\s*-\s*GYG[A-Z0-9]{8,}\b/i,
  /\bGYG[A-Z0-9]{8,}\s+was\s+cancel(?:ed|led)\b/i,
];

const TRANSACTIONAL_BODY_MARKERS: RegExp[] = [
  /\byour offer has been booked\b/i,
  /\bthe following booking has changed\b/i,
  /\bbooking detail change\b/i,
  /\breference number[:\s]+GYG[A-Z0-9]{8,}\b/i,
  /\bbooking reference[:\s]+GYG[A-Z0-9]{8,}\b/i,
  /\bGYG[A-Z0-9]{8,}\s+was\s+cancel(?:ed|led)\b/i,
];

const isNotificationSender = (from: string): boolean =>
  /@notification\.getyourguide\.com\b/i.test(from);

const isTransactionalSubject = (subject: string): boolean =>
  TRANSACTIONAL_SUBJECT_PATTERNS.some((pattern) => pattern.test(subject));

const hasTransactionalBodyMarker = (text: string): boolean =>
  TRANSACTIONAL_BODY_MARKERS.some((pattern) => pattern.test(text));

const addonKeywordMatchers: Array<{ test: RegExp; field: 'tshirts' | 'cocktails' | 'photos' }> = [
  { test: /cocktail|open\s+bar|vip entry/i, field: 'cocktails' },
  { test: /instant\s+photos?/i, field: 'photos' },
  { test: /t-?shirts?|pub\s+crawl\s+t-?shirt/i, field: 'tshirts' },
];

const BOTTOMLESS_BRUNCH_PATTERN = /bottomless brunch/i;
const PUBCRAWL_UPSELL_PATTERN = /\bpub\s*crawl\b|\bpubcrawl\b/i;

const sectionStopMarkers: RegExp[] = [
  /\bMain customer\b/i,
  /\bCustomer language\b/i,
  /\bTour language\b/i,
  /\bPickup (?:time|method)\b/i,
  /\bPhone\b/i,
  /\bPrice\b/i,
  /\bOpen booking\b/i,
  /\bWe['’]re here\b/i,
];

const extractParticipantsAndExtras = (
  text: string,
): {
  adults: number | null;
  extras: { tshirts: number; cocktails: number; photos: number };
  pubCrawlUpsellQuantity: number;
} => {
  const extras = { tshirts: 0, cocktails: 0, photos: 0 };
  let adults: number | null = null;
  let pubCrawlUpsellQuantity = 0;
  const leadingQuantityPattern =
    /(?:^|[\s,>])(\d+)\s*[xÆ×-]\s*([A-Za-z][^,\n]+?)(?=(?:\s+\d+\s*[xÆ×-]\s*[A-Za-z])|\s+(?:Main customer|Customer language|Tour language|Pickup (?:time|method)|Phone|Language|Price|Open booking|We['’]re here)|$)/gi;
  const trailingQuantityPattern = /([A-Za-z][^,\n]+?)\s*[xÆ×-]\s*(\d+)(?:\s|$)/gi;
  const nextQuantityPattern = /\s+\d+\s*[xÆ×-]\s+[A-Za-z]/i;

  const processMatch = (quantityRaw: string, labelRaw: string) => {
    const quantity = Number.parseInt(quantityRaw, 10);
    if (!Number.isFinite(quantity)) {
      return;
    }
    let label = labelRaw.trim();
    if (!label) {
      return;
    }

    const quantityIdx = label.search(nextQuantityPattern);
    if (quantityIdx !== -1) {
      label = label.slice(0, quantityIdx).trim();
    }

    let stopIdx: number | null = null;
    for (const marker of sectionStopMarkers) {
      const idx = label.search(marker);
      if (idx !== -1 && (stopIdx === null || idx < stopIdx)) {
        stopIdx = idx;
      }
    }
    if (stopIdx !== null && stopIdx >= 0) {
      label = label.slice(0, stopIdx).trim();
    }

    if (!label) {
      return;
    }

    const normalizedLabel = label.replace(/\s+/g, ' ').trim();
    if (PUBCRAWL_UPSELL_PATTERN.test(normalizedLabel) && !/t-?shirt/i.test(normalizedLabel)) {
      pubCrawlUpsellQuantity += quantity;
      return;
    }
    if (adults === null && /\badults?\b/i.test(label)) {
      adults = quantity;
      return;
    }
    const keyword = addonKeywordMatchers.find(({ test }) => test.test(label));
    if (keyword) {
      extras[keyword.field] += quantity;
    }
  };

  let match: RegExpExecArray | null;
  while ((match = leadingQuantityPattern.exec(text)) !== null) {
    processMatch(match[1], match[2]);
  }
  while ((match = trailingQuantityPattern.exec(text)) !== null) {
    processMatch(match[2], match[1]);
  }
  return { adults, extras, pubCrawlUpsellQuantity };
};

const extractTravelerAmendments = (
  text: string,
): {
  added: { count: number; names: string[] };
  removed: { count: number; names: string[] };
} => {
  if (!text) {
    return {
      added: { count: 0, names: [] },
      removed: { count: 0, names: [] },
    };
  }

  const sanitizeName = (value: string | null | undefined): string | null => {
    if (!value) {
      return null;
    }
    const normalized = value
      .replace(/\s+/g, ' ')
      .replace(/^[\s,.;:()\-]+|[\s,.;:()\-]+$/g, '')
      .trim();
    return normalized.length > 0 ? normalized : null;
  };

  const parseBucket = (action: 'added' | 'removed'): { count: number; names: string[] } => {
    const pluralPattern = new RegExp(
      `(\\d+)\\s+travell?ers?\\s+have\\s+been\\s+${action}(?:\\s+to|\\s+from)?\\s+this\\s+booking`,
      'gi',
    );
    let pluralCount = 0;
    for (const match of text.matchAll(pluralPattern)) {
      const value = Number.parseInt(match[1] ?? '', 10);
      if (Number.isFinite(value) && value > 0) {
        pluralCount += value;
      }
    }

    const namedPattern = new RegExp(
      `travell?er(?:\\s+passenger)?(?:\\s+([^\\r\\n\\u2022<]{1,140}?))?\\s+has\\s+been\\s+${action}(?:\\s+to|\\s+from)?\\s+this\\s+booking`,
      'gi',
    );
    const names: string[] = [];
    let namedCount = 0;
    for (const match of text.matchAll(namedPattern)) {
      namedCount += 1;
      const maybeName = sanitizeName(match[1] ?? null);
      if (maybeName) {
        names.push(maybeName);
      }
    }

    if (pluralCount > 0) {
      return { count: pluralCount, names };
    }
    return { count: namedCount, names };
  };

  return {
    added: parseBucket('added'),
    removed: parseBucket('removed'),
  };
};

const extractParticipantCountChange = (
  text: string,
): { newCount: number; oldCount: number } | null => {
  if (!text) {
    return null;
  }

  const candidates: RegExp[] = [
    /Number of participants\s+New\s+(\d+)\s+Old\s+(\d+)/i,
    /Number of participants\s+New\s+(\d+)\s+(\d+)\b/i,
    /participants\s+New\s+(\d+)\s+Old\s+(\d+)/i,
  ];

  for (const pattern of candidates) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const newCount = Number.parseInt(match[1] ?? '', 10);
    const oldCount = Number.parseInt(match[2] ?? '', 10);
    if (!Number.isFinite(newCount) || !Number.isFinite(oldCount) || newCount < 0 || oldCount < 0) {
      continue;
    }
    return { newCount, oldCount };
  }

  return null;
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

const normalizeMoneyAmount = (token: string): number | null => {
  const stripped = token.replace(/[^\d,.-]/g, '').trim();
  if (!stripped) {
    return null;
  }

  let normalized = stripped;
  const lastDot = stripped.lastIndexOf('.');
  const lastComma = stripped.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    if (lastDot > lastComma) {
      normalized = stripped.replace(/,/g, '');
    } else {
      normalized = stripped.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma !== -1) {
    const decimals = stripped.length - lastComma - 1;
    normalized = decimals === 3 ? stripped.replace(/,/g, '') : stripped.replace(',', '.');
  } else if (lastDot !== -1) {
    const decimals = stripped.length - lastDot - 1;
    if (decimals === 3) {
      normalized = stripped.replace(/\./g, '');
    }
  }

  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : null;
};

const normalizeCurrencyToken = (token: string | null | undefined): string | null => {
  if (!token) {
    return null;
  }
  const compact = token.trim().toLowerCase();
  if (!compact) {
    return null;
  }
  if (MONEY_SYMBOLS[compact]) {
    return MONEY_SYMBOLS[compact];
  }

  const lettersOnly = compact.replace(/[^a-z]/g, '');
  if (lettersOnly && MONEY_SYMBOLS[lettersOnly]) {
    return MONEY_SYMBOLS[lettersOnly];
  }
  if (lettersOnly.length === 3) {
    return lettersOnly.toUpperCase();
  }
  return null;
};

const parseMoney = (input: string): { currency: string | null; amount: number | null } => {
  const normalizedInput = input.replace(/\s+/g, ' ').trim();
  if (!normalizedInput) {
    return { currency: null, amount: null };
  }

  const prefixed = normalizedInput.match(/([A-Za-z]{3}|z[\u0142l]|[$\u20AC\u00A3])\s*([\d][\d.,]*)/i);
  if (prefixed) {
    return {
      currency: normalizeCurrencyToken(prefixed[1]),
      amount: normalizeMoneyAmount(prefixed[2]),
    };
  }

  const suffixed = normalizedInput.match(/([\d][\d.,]*)\s*([A-Za-z]{3}|z[\u0142l]|[$\u20AC\u00A3])/i);
  if (suffixed) {
    return {
      currency: normalizeCurrencyToken(suffixed[2]),
      amount: normalizeMoneyAmount(suffixed[1]),
    };
  }

  const amountOnly = normalizedInput.match(/([\d][\d.,]*)/);
  return {
    currency: null,
    amount: amountOnly ? normalizeMoneyAmount(amountOnly[1]) : null,
  };
};

const extractPriceMoney = (text: string): { currency: string | null; amount: number | null } | null => {
  const patterns = [
    /Price\s+paid[:\s]+((?:[A-Za-z]{3}|z[\u0142l]|[$\u20AC\u00A3])\s*[\d][\d.,]*)/i,
    /Price\s+paid[:\s]+([\d][\d.,]*\s*(?:[A-Za-z]{3}|z[\u0142l]|[$\u20AC\u00A3]))/i,
    /Price[:\s]+((?:[A-Za-z]{3}|z[\u0142l]|[$\u20AC\u00A3])\s*[\d][\d.,]*)/i,
    /Price[:\s]+([\d][\d.,]*\s*(?:[A-Za-z]{3}|z[\u0142l]|[$\u20AC\u00A3]))/i,
    /Price\s+([^\s]+\s*[\d][\d.,]*)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    const money = parseMoney(match[1]);
    if (money.amount !== null || money.currency !== null) {
      return money;
    }
  }
  return null;
};

const extractBookingId = (text: string, subject?: string | null): string | null => {
  const referenceMatch =
    text.match(/Reference number[:\s]+(GYG[A-Z0-9]{8,})/i) ??
    text.match(/Reference Number[:\s]+(GYG[A-Z0-9]{8,})/i) ??
    text.match(/Booking reference[:\s]+(GYG[A-Z0-9]{8,})/i) ??
    text.match(/\b(GYG[A-Z0-9]{8,})\s+was\s+cancel(?:ed|led)\b/i);
  if (referenceMatch?.[1]) {
    return referenceMatch[1];
  }

  const textMatch = text.match(GYG_BOOKING_ID_PATTERN);
  if (textMatch && textMatch.length > 0) {
    return textMatch[textMatch.length - 1];
  }

  if (subject) {
    const subjectMatch = subject.match(GYG_BOOKING_ID_PATTERN);
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

  const productMatch =
    text.match(/has been booked:\s+(.+?)\s+Reference number/i) ??
    text.match(/booking:\s+(.+?)\s+Reference number/i) ??
    text.match(/Tour:\s*(.+?)\s+Tour Option/i);

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

  const customerMatch =
    text.match(/Main customer[:\s]+([A-Za-z\u00C0-\u017F' -]+?)(?=\s+[a-z0-9._%+-]+@)/i) ??
    text.match(/Name:\s*([A-Za-z\u00C0-\u017F' -]+?)(?:\s+Date:|\s+Tour:|\s+Email:|$)/i);
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
  } else {
    const participantChange = extractParticipantCountChange(text);
    if (participantChange) {
      fields.partySizeTotal = participantChange.newCount;
      fields.partySizeAdults = participantChange.newCount;
    }
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

const resolvePubCrawlUpsellStartAt = (experienceDate: string | null | undefined): Date | null => {
  if (!experienceDate || !/^\d{4}-\d{2}-\d{2}$/.test(experienceDate)) {
    return null;
  }
  const parsed = dayjs.tz(`${experienceDate} 21:00`, 'YYYY-MM-DD HH:mm', GETYOURGUIDE_TIMEZONE);
  return parsed.isValid() ? parsed.toDate() : null;
};

const buildPubCrawlUpsellEvent = (
  bookingId: string,
  sourceBookingFields: BookingFieldPatch,
  attendeeCount: number,
  status: BookingStatus,
  eventType: BookingEventType,
  paymentStatus: 'paid' | 'unknown',
  occurredAt: Date | null,
): ParsedBookingEvent | null => {
  if (!Number.isFinite(attendeeCount) || attendeeCount <= 0) {
    return null;
  }

  const experienceDate = sourceBookingFields.experienceDate ?? null;
  const experienceStartAt = resolvePubCrawlUpsellStartAt(experienceDate);

  const bookingFields: BookingFieldPatch = {
    channelId: sourceBookingFields.channelId ?? null,
    productName: 'Krawl Through Krakow Pub Crawl',
    guestFirstName: sourceBookingFields.guestFirstName ?? null,
    guestLastName: sourceBookingFields.guestLastName ?? null,
    guestEmail: sourceBookingFields.guestEmail ?? null,
    guestPhone: sourceBookingFields.guestPhone ?? null,
    partySizeTotal: attendeeCount,
    partySizeAdults: attendeeCount,
    experienceDate,
    experienceStartAt,
    currency: sourceBookingFields.currency ?? null,
    priceGross: 0,
    priceNet: 0,
    baseAmount: 0,
  };

  return {
    platform: 'getyourguide',
    platformBookingId: `${bookingId}-PUBCRAWL`,
    platformOrderId: bookingId,
    eventType,
    status,
    paymentStatus,
    bookingFields,
    notes: `Generated from GetYourGuide Bottomless Brunch upsell (${attendeeCount} x Pubcrawl).`,
    occurredAt,
    sourceReceivedAt: occurredAt,
  };
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

  private buildDiagnostics(context: BookingParserContext): BookingParserDiagnostics {
    const from = context.from ?? context.headers.from ?? '';
    const subject = context.subject ?? '';
    const senderMatch = isNotificationSender(from);
    const subjectMatch = isTransactionalSubject(subject);
    const text = normalizeWhitespace(context.textBody || context.rawTextBody || context.snippet || '');
    const bodyMatch = text ? hasTransactionalBodyMarker(text) : false;
    const bookingId = text ? extractBookingId(text, subject) : null;

    const canParseChecks: BookingParserCheck[] = [
      {
        label: 'from matches @notification.getyourguide.com',
        passed: senderMatch,
        value: from,
      },
      { label: 'subject matches transactional template', passed: subjectMatch, value: subject },
      { label: 'text matches transactional marker', passed: bodyMatch },
    ];
    const parseChecks: BookingParserCheck[] = [
      { label: 'text body present', passed: Boolean(text) },
      { label: 'booking id detected', passed: Boolean(bookingId), value: bookingId ?? null },
    ];

    return {
      name: this.name,
      canParse: senderMatch && (subjectMatch || bodyMatch) && Boolean(bookingId),
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
    const diagnostics = this.buildDiagnostics(context);
    if (!diagnostics.canParse) {
      return null;
    }
    const text = normalizeWhitespace(context.textBody || context.rawTextBody || context.snippet || '');
    if (!text) {
      return null;
    }

    const bookingId = extractBookingId(text, context.subject);
    if (!bookingId) {
      return null;
    }

    const bookingFields = extractBookingFields(text);
    const participantInfo = extractParticipantsAndExtras(text);
    const travelerChanges = extractTravelerAmendments(text);
    const participantChange = extractParticipantCountChange(text);

    const money = extractPriceMoney(text);
    if (money) {
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
    const paymentStatus: 'paid' | 'unknown' = bookingFields.priceGross ? 'paid' : 'unknown';
    const occurredAt = context.receivedAt ?? context.internalDate ?? null;

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

    const shouldSpawnPubCrawlUpsell =
      participantInfo.pubCrawlUpsellQuantity > 0 &&
      typeof bookingFields.productName === 'string' &&
      BOTTOMLESS_BRUNCH_PATTERN.test(bookingFields.productName);
    const pubCrawlSpawnedEvent = shouldSpawnPubCrawlUpsell
      ? buildPubCrawlUpsellEvent(
          bookingId,
          bookingFields,
          participantInfo.pubCrawlUpsellQuantity,
          status,
          eventType,
          paymentStatus,
          occurredAt,
        )
      : null;

    const rawPayload: Record<string, unknown> = {};
    if (travelerChanges.added.count > 0) {
      rawPayload.gygTravellerAddition = {
        addedCount: travelerChanges.added.count,
        names: travelerChanges.added.names,
      };
    }
    if (travelerChanges.removed.count > 0) {
      rawPayload.gygTravellerRemoval = {
        removedCount: travelerChanges.removed.count,
        names: travelerChanges.removed.names,
      };
    }
    if (!rawPayload.gygTravellerAddition && !rawPayload.gygTravellerRemoval && participantChange) {
      const delta = participantChange.newCount - participantChange.oldCount;
      if (delta > 0) {
        rawPayload.gygTravellerAddition = {
          addedCount: delta,
          names: [],
        };
      } else if (delta < 0) {
        rawPayload.gygTravellerRemoval = {
          removedCount: Math.abs(delta),
          names: [],
        };
      }
    }

    return {
      platform: 'getyourguide',
      platformBookingId: bookingId,
      platformOrderId: bookingId,
      eventType,
      status,
      paymentStatus,
      bookingFields,
      notes: notes.length > 0 ? notes.join(' | ') : 'Parsed from GetYourGuide confirmation email.',
      occurredAt,
      sourceReceivedAt: occurredAt,
      rawPayload: Object.keys(rawPayload).length > 0 ? rawPayload : null,
      spawnedEvents: pubCrawlSpawnedEvent ? [pubCrawlSpawnedEvent] : undefined,
    };
  }
}
