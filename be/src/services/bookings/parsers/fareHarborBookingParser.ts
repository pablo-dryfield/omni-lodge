import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import type {
  BookingEmailParser,
  BookingParserCheck,
  BookingParserContext,
  BookingParserDiagnostics,
  BookingFieldPatch,
  ParsedBookingEvent,
} from '../types.js';
import type { BookingEventType, BookingStatus, NormalizedAddonInput } from '../../../constants/bookings.js';
import { getConfigValue } from '../../configService.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_BOOKING_TIMEZONE =
  (getConfigValue('BOOKING_PARSER_TIMEZONE') as string | null) ?? 'Europe/Warsaw';
const FAREHARBOR_TIMEZONE =
  (getConfigValue('FAREHARBOR_TIMEZONE') as string | null) ?? DEFAULT_BOOKING_TIMEZONE;

const MONEY_PATTERN = /(PLN|USD|EUR|GBP)?\s*([\d.,]+)/i;
const BOOKING_NUMBER_PATTERN = /Booking\s*#(\d+)/i;
const PRODUCT_LINE_PATTERN =
  /Booking\s*#\d+\s+(.+?)\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/gi;
const PARTY_SEGMENT_PATTERN = /(\d+)\s+(Man|Men|Woman|Women|Guest|Guests|People|Persons|Adult|Adults|Child|Children|Kid|Kids)/gi;
const EMAIL_PATTERN = /Email:\s*([^\s]+@[^\s]+)/i;
const PHONE_PATTERN = /Phone:\s*([+()\d\s-]{6,})/i;
const NAME_PATTERN = /Name:\s*([^\n]+?)(?:\s+Phone:|\s+Email:|$)/i;
const BOOKING_TOTAL_PATTERN = /Booking\s+total\s+(PLN|USD|EUR|GBP)?\s*([\d.,]+)/i;
const TAXES_PATTERN = /Taxes\s+(PLN|USD|EUR|GBP)?\s*([\d.,]+)/i;
const DUE_PATTERN = /Due:\s*(PLN|USD|EUR|GBP)?\s*([\d.,]+)/i;
const PAYMENT_PATTERN = /[•*]?\s*(PLN|USD|EUR|GBP)?\s*([\d.,]+)\s*(?:[-–]\s*)?([^(]+?)\s*\(([^)]+)\)/i;
const MALE_TERMS = new Set(['man', 'men']);
const FEMALE_TERMS = new Set(['woman', 'women']);
const ADULT_TERMS = new Set(['man', 'men', 'woman', 'women', 'guest', 'guests', 'people', 'persons', 'adult', 'adults']);
const CHILD_TERMS = new Set(['child', 'children', 'kid', 'kids']);

type PartyCounts = {
  total: number | null;
  adults: number | null;
  children: number | null;
  men: number | null;
  women: number | null;
};

const normalize = (value?: string | null): string => value?.trim() ?? '';

const parseMoney = (input?: string | null): { currency: string | null; amount: number | null } => {
  if (!input) {
    return { currency: null, amount: null };
  }
  const match = input.match(MONEY_PATTERN);
  if (!match) {
    return { currency: null, amount: null };
  }
  const amount = Number.parseFloat(match[2].replace(/,/g, ''));
  return { currency: match[1] ?? null, amount: Number.isNaN(amount) ? null : amount };
};

const extractBookingNumber = (text: string): string | null => {
  const match = text.match(BOOKING_NUMBER_PATTERN);
  return match?.[1] ?? null;
};

const sanitizeProductCandidate = (value: string): string => {
  const normalized = value.replace(/\u00a0/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').trim();
  const cleanLine = (line: string): string =>
    line.replace(/^(Cancelled|Canceled|Rebooked|Booked|Booking|View on FareHarbor)\s*:*/i, '').trim();
  const lines = normalized
    .split(/[\r\n]+/)
    .map((line) => cleanLine(line))
    .filter((line) => line.length > 0);
  const preferred = lines.find(
    (line) => !/^(cancelled|canceled|rebooked|view on fareharbor)/i.test(line),
  );
  return (preferred ?? cleanLine(normalized)).replace(/\s+/g, ' ').trim();
};

const extractProductName = (text: string): string | null => {
  const matches = Array.from(text.matchAll(PRODUCT_LINE_PATTERN))
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));

  if (matches.length === 0) {
    return null;
  }

  for (let idx = matches.length - 1; idx >= 0; idx -= 1) {
    let candidate = sanitizeProductCandidate(matches[idx]);
    const nestedMatch = candidate.match(/Booking\s*#\d+\s+(.+)/i);
    if (nestedMatch?.[1]) {
      candidate = sanitizeProductCandidate(nestedMatch[1]);
    }
    if (!/view\s+on\s+fareharbor/i.test(candidate) && !/cancelled\s+by/i.test(candidate)) {
      return candidate;
    }
  }

  const fallback = sanitizeProductCandidate(matches[matches.length - 1]);
  const nestedMatch = fallback.match(/Booking\s*#\d+\s+(.+)/i);
  return nestedMatch?.[1] ? sanitizeProductCandidate(nestedMatch[1]) : fallback;
};

const extractPartyCounts = (text: string): PartyCounts => {
  let adults = 0;
  let children = 0;
  let men = 0;
  let women = 0;
  const matches = text.matchAll(PARTY_SEGMENT_PATTERN);
  for (const match of matches) {
    const qty = Number.parseInt(match[1], 10);
    if (Number.isNaN(qty)) {
      continue;
    }
    let precedingChar: string | null = null;
    if (match.index !== undefined && match.index > 0) {
      let cursor = match.index - 1;
      while (cursor >= 0 && /\s/.test(text[cursor])) {
        cursor -= 1;
      }
      if (cursor >= 0) {
        precedingChar = text[cursor];
      }
    }
    if (precedingChar && /[\d.]/.test(precedingChar)) {
      continue;
    }
    const label = match[2].toLowerCase();
    if (ADULT_TERMS.has(label)) {
      adults += qty;
      if (MALE_TERMS.has(label)) {
        men += qty;
      } else if (FEMALE_TERMS.has(label)) {
        women += qty;
      }
    } else if (CHILD_TERMS.has(label)) {
      children += qty;
    }
  }
  const total = adults + children;
  return {
    total: total > 0 ? total : null,
    adults: adults > 0 ? adults : null,
    children: children > 0 ? children : null,
    men: men > 0 ? men : null,
    women: women > 0 ? women : null,
  };
};

const extractPartyCountsFromCustomers = (text: string): PartyCounts => {
  const boundaries = ['item', 'details', 'payments', 'booking total', 'total paid'];
  let customersSection: string | null = null;
  for (const boundary of boundaries) {
    customersSection = sliceSection(text, 'customers', boundary);
    if (customersSection) {
      break;
    }
  }
  if (!customersSection) {
    customersSection = sliceSection(text, 'customers') ?? null;
  }

  if (customersSection) {
    const counts = extractPartyCounts(customersSection);
    if (counts.total !== null || counts.children !== null || counts.adults !== null) {
      return counts;
    }
  }
  const paymentsIdx = text.toLowerCase().indexOf('payments');
  const headerScope = paymentsIdx === -1 ? text : text.slice(0, paymentsIdx);
  return extractPartyCounts(headerScope);
};

const normalizeDateToken = (value: string): string => {
  const normalized = value.replace(/\u00a0/g, ' ').replace(/@/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+/i, '');
};

const normalizeTimeMarker = (value: string): string =>
  value.replace(/\b(am|pm)\b/gi, (match) => match.toUpperCase());

const parseDateTimeTokens = (dateToken: string, timeToken: string): Date | null => {
  const sanitizedDate = normalizeDateToken(dateToken);
  const sanitizedTime = normalizeTimeMarker(normalizeDateToken(timeToken));
  const dateTime = `${sanitizedDate} ${sanitizedTime}`;
  const formats = ['D MMMM YYYY h:mm A', 'D MMMM YYYY h:mm a', 'D MMMM YYYY H:mm'];
  for (const format of formats) {
    const naive = dayjs(dateTime, format, true);
    if (!naive.isValid()) {
      continue;
    }
    const zoned = naive.tz(FAREHARBOR_TIMEZONE, true);
    if (zoned.isValid()) {
      return zoned.toDate();
    }
  }
  return null;
};

const extractExperience = (
  text: string,
): { experienceDate: string | null; experienceStartAt: Date | null; experienceEndAt: Date | null } => {
  const regex = /([A-Za-z]+,\s+\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*@\s*([\d:]+\s*(?:am|pm))/gi;
  const matches = Array.from(text.matchAll(regex));
  if (matches.length === 0) {
    return { experienceDate: null, experienceStartAt: null, experienceEndAt: null };
  }

  const cleanToken = (value: string): string => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const start = parseDateTimeTokens(cleanToken(matches[0][1]), cleanToken(matches[0][2]));
  const end = matches[1] ? parseDateTimeTokens(cleanToken(matches[1][1]), cleanToken(matches[1][2])) : null;

  return {
    experienceDate: start ? start.toISOString().slice(0, 10) : null,
    experienceStartAt: start,
    experienceEndAt: end,
  };
};

const extractExperienceFromSubject = (
  subject: string,
): { experienceDate: string | null; experienceStartAt: Date | null; experienceEndAt: Date | null } | null => {
  if (!subject) {
    return null;
  }
  const clean = (value: string) => value.replace(/\u00a0/g, ' ').trim();
  const marker = ' on ';
  const lower = subject.toLowerCase();
  const idx = lower.indexOf(marker);
  if (idx === -1) {
    return null;
  }
  const remainder = subject.slice(idx + marker.length);
  const hyphenIdx = remainder.indexOf('-');
  const startSegment = hyphenIdx === -1 ? remainder : remainder.slice(0, hyphenIdx);
  const startTokens = startSegment.match(/([A-Za-z]+,\s+\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*@\s*([\d:]+\s*(?:am|pm))/i);
  if (!startTokens) {
    return null;
  }
  const start = parseDateTimeTokens(clean(startTokens[1]), clean(startTokens[2]));

  const endSegment = hyphenIdx === -1 ? '' : remainder.slice(hyphenIdx + 1);
  const endTokens = endSegment.match(/([A-Za-z]+,\s+\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*@\s*([\d:]+\s*(?:am|pm))/i);
  const end =
    endTokens && endTokens[1] && endTokens[2]
      ? parseDateTimeTokens(clean(endTokens[1]), clean(endTokens[2]))
      : null;

  return {
    experienceDate: start ? start.toISOString().slice(0, 10) : null,
    experienceStartAt: start,
    experienceEndAt: end,
  };
};

const sliceSection = (text: string, startKeyword: string, endKeyword?: string): string | null => {
  const lower = text.toLowerCase();
  const startIdx = lower.indexOf(startKeyword.toLowerCase());
  if (startIdx === -1) {
    return null;
  }
  let section = text.slice(startIdx + startKeyword.length);
  if (endKeyword) {
    const endIdx = section.toLowerCase().indexOf(endKeyword.toLowerCase());
    if (endIdx !== -1) {
      section = section.slice(0, endIdx);
    }
  }
  return section.trim();
};

const extractDetailLines = (text: string): Array<{ label: string; amount: number }> => {
  const section = sliceSection(text, 'details', 'total paid');
  if (!section) {
    return [];
  }
  const entries = [];
  const regex = /([A-Za-z0-9 ?'()!:;-]+?)\s+(PLN|USD|EUR|GBP)\s*([\d.,]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(section)) !== null) {
    const amount = Number.parseFloat(match[3].replace(/,/g, ''));
    if (Number.isNaN(amount)) {
      continue;
    }
    entries.push({ label: match[1].trim(), amount });
  }
  return entries;
};

const QUESTION_LINE_PATTERNS = [
  /^How did you hear about us\?/i,
  /^Where are you from\?/i,
  /^How many photos do you want\?/i,
  /^How many T-shirts would you like to get\?/i,
  /^Bring the PubCrawl/i,
  /^Elevate Your Pub Crawl/i,
  /^How many people would like extra cocktails\?/i,
  /^Instant Photos/i,
];

const extractQuestionnaire = (text: string): string | null => {
  const section = sliceSection(text, 'details') ?? text;
  const lines = section.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const questionnaireLines = lines.filter((line) => QUESTION_LINE_PATTERNS.some((pattern) => pattern.test(line)));
  if (questionnaireLines.length === 0) {
    return null;
  }
  return questionnaireLines.map((line) => line.replace(/\s+/g, ' ').trim()).join(' | ');
};

const extractPaymentDetails = (
  text: string,
  currencyHint: string | null,
): { paymentMethod: string | null; currency: string | null; amount: number | null } => {
  const section = sliceSection(text, 'payments', 'details') ?? text;
  const bulletMatch = section.match(/[•]\s*(PLN|USD|EUR|GBP)?\s*([\d.,]+)\s*(?:[-–]\s*([^(]+?)\s*)?\(([^)]+)\)/i);
  const match = bulletMatch ?? section.match(PAYMENT_PATTERN);
  if (!match) {
    return { paymentMethod: null, currency: currencyHint, amount: null };
  }
  const amount = Number.parseFloat(match[2].replace(/,/g, ''));
  const method = match[3]?.trim() ?? null;
  return {
    paymentMethod: method,
    currency: match[1] ?? currencyHint,
    amount: Number.isNaN(amount) ? null : amount,
  };
};

const buildBookingFields = (
  contextText: string,
  scheduleText: string,
): { fields: BookingFieldPatch; party: PartyCounts } => {
  const fields: BookingFieldPatch = {};

  const nameMatch = contextText.match(NAME_PATTERN);
  if (nameMatch) {
    const parts = nameMatch[1].trim().split(/\s+/);
    fields.guestFirstName = parts.shift() ?? null;
    fields.guestLastName = parts.length > 0 ? parts.join(' ') : null;
  }
  const phoneMatch = contextText.match(PHONE_PATTERN);
  if (phoneMatch) {
    fields.guestPhone = phoneMatch[1].trim();
  }
  const emailMatch = contextText.match(EMAIL_PATTERN);
  if (emailMatch) {
    fields.guestEmail = emailMatch[1].trim();
  }

  const party = extractPartyCountsFromCustomers(contextText);
  fields.partySizeTotal = party.total;
  fields.partySizeAdults = party.adults;
  fields.partySizeChildren = party.children;

  const experienceFromSubject = extractExperienceFromSubject(scheduleText);
  const scheduleSource = scheduleText.trim().length > 0 ? scheduleText : contextText;
  const experience = experienceFromSubject ?? extractExperience(scheduleSource);
  fields.experienceDate = experience.experienceDate;
  fields.experienceStartAt = experience.experienceStartAt;
  fields.experienceEndAt = experience.experienceEndAt;

  return { fields, party };
};

const extractRebookedNewId = (text: string): string | null => {
  const match = text.match(/New\s+#?(\d{5,})/i);
  if (match?.[1]) {
    return match[1];
  }
  const altMatch = text.match(/New\s+https?:\/\/[^\s#/]+\/[^\s#]+#?(\d{5,})/i);
  return altMatch?.[1] ?? null;
};

const stripHtmlTags = (value: string): string => value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();

type FareHarborComparisonRows = Record<string, { old: string; new: string }>;

const extractComparisonRowsFromHtml = (html?: string | null): FareHarborComparisonRows | null => {
  if (!html) {
    return null;
  }
  const comparisonMatch = html.match(/(<table[\s\S]*?<th[^>]*>\s*Old\s*<\/th>\s*<th[^>]*>\s*New\s*<\/th>[\s\S]*?<\/table>)/i);
  if (!comparisonMatch) {
    return null;
  }
  const tableHtml = comparisonMatch[1];
  const rows: FareHarborComparisonRows = {};
  const rowRegex =
    /<tr[^>]*>\s*<td[^>]*>\s*<b>([\s\S]*?)<\/b>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHtml))) {
    const label = stripHtmlTags(rowMatch[1]).toLowerCase();
    if (!label) {
      continue;
    }
    rows[label] = {
      old: stripHtmlTags(rowMatch[2]),
      new: stripHtmlTags(rowMatch[3]),
    };
  }
  return Object.keys(rows).length > 0 ? rows : null;
};

type FareHarborRebookDetails = {
  newBookingId: string | null;
  newDateRange: string | null;
  newTimeRange: string | null;
  newCustomers: string | null;
  newProductName: string | null;
};

const extractRebookDetails = (context: BookingParserContext): FareHarborRebookDetails | null => {
  const rows = extractComparisonRowsFromHtml(context.htmlBody);
  if (!rows) {
    return null;
  }
  const getValue = (label: string): string | null => rows[label]?.new ?? null;
  const sanitize = (value: string | null): string | null => {
    if (!value) {
      return null;
    }
    return value.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  };
  const newBookingRaw = getValue('id');
  const bookingMatch = newBookingRaw?.match(/(\d{5,})/);
  const newBookingId = bookingMatch?.[1] ?? null;
  if (!newBookingId) {
    return null;
  }
  return {
    newBookingId,
    newDateRange: getValue('date'),
    newTimeRange: getValue('time'),
    newCustomers: sanitize(getValue('customers')),
    newProductName: sanitize(getValue('item')),
  };
};

const splitRange = (value: string | null): [string | null, string | null] => {
  if (!value) {
    return [null, null];
  }
  const parts = value
    .split(/\s*-\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return [null, null];
  }
  if (parts.length === 1) {
    return [parts[0], parts[0]];
  }
  return [parts[0], parts[1]];
};

const deriveRebookSchedule = (details: FareHarborRebookDetails): {
  experienceDate: string | null;
  experienceStartAt: Date | null;
  experienceEndAt: Date | null;
} => {
  const [startDate, endDate] = splitRange(details.newDateRange);
  const [startTime, endTime] = splitRange(details.newTimeRange);
  const experienceStartAt =
    startDate && startTime ? parseDateTimeTokens(startDate, startTime) : null;
  let experienceEndAt: Date | null = null;
  if (endDate && endTime) {
    experienceEndAt = parseDateTimeTokens(endDate, endTime);
  } else if (startDate && endTime) {
    experienceEndAt = parseDateTimeTokens(startDate, endTime);
  }
  return {
    experienceDate: experienceStartAt ? experienceStartAt.toISOString().slice(0, 10) : null,
    experienceStartAt,
    experienceEndAt,
  };
};

const deriveStatusFromContext = (context: BookingParserContext, bodyText: string): BookingStatus => {
  const haystack = `${context.subject ?? ''}\n${bodyText ?? ''}`.toLowerCase();
  if (/(?:cancelled|canceled|cancellation)/i.test(haystack)) {
    return 'cancelled';
  }
  if (/(?:amended|modified|updated|changed|rebooked)/i.test(haystack)) {
    return 'amended';
  }
  if (/no[-\s]?show/.test(haystack)) {
    return 'no_show';
  }
  return 'confirmed';
};

const statusToEventType = (status: BookingStatus): BookingEventType => {
  switch (status) {
    case 'cancelled':
      return 'cancelled';
    case 'amended':
    case 'rebooked':
      return 'amended';
    default:
      return 'created';
  }
};

type FareHarborAddonExtras = {
  tshirts: number;
  cocktails: number;
  photos: number;
};

const ADDON_BASE_LABELS = new Set(
  Array.from(ADULT_TERMS.values()).concat(Array.from(CHILD_TERMS.values())).concat(['total']),
);

const parseQuestionnaireValues = (questionnaire: string | null): FareHarborAddonExtras => {
  if (!questionnaire) {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  const entries = questionnaire.split('|').map((part) => part.trim()).filter(Boolean);
  const values: FareHarborAddonExtras = { tshirts: 0, cocktails: 0, photos: 0 };
  for (const entry of entries) {
    const match = entry.match(/^(.+?):\s*(.+)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim();
    const rawValue = match[2].trim();
    const numericValue = Number.parseInt(rawValue, 10);
    if (Number.isNaN(numericValue)) {
      continue;
    }
    if (/t-?shirts?/i.test(key)) {
      values.tshirts = numericValue;
    } else if (/extra cocktails?/i.test(key)) {
      values.cocktails = numericValue;
    } else if (/photos?/i.test(key)) {
      values.photos = numericValue;
    }
  }
  return values;
};

const deriveAddonsFromDetailLines = (
  detailLines: Array<{ label: string; amount: number }>,
  currency: string | null,
  questionnaire: string | null,
): { addons: NormalizedAddonInput[]; extras: FareHarborAddonExtras; totalAmount: number } => {
  const addons: NormalizedAddonInput[] = [];
  const extras: FareHarborAddonExtras = { tshirts: 0, cocktails: 0, photos: 0 };
  const questionnaireCounts = parseQuestionnaireValues(questionnaire);
  let pendingTshirts = questionnaireCounts.tshirts;
  let pendingCocktails = questionnaireCounts.cocktails;
  let pendingPhotos = questionnaireCounts.photos;
  let totalAmount = 0;

  const pushAddon = (name: string, quantity: number, totalPrice: number): void => {
    if (quantity <= 0 || !Number.isFinite(totalPrice) || totalPrice <= 0) {
      return;
    }
    const unitPrice = Number((totalPrice / quantity).toFixed(2));
    addons.push({
      platformAddonName: name,
      quantity,
      unitPrice,
      totalPrice,
      currency,
    });
    totalAmount += totalPrice;
  };

  const extractNumericFromLabel = (label: string): number | null => {
    const match = label.match(/(\d+)/);
    if (!match) {
      return null;
    }
    const value = Number.parseInt(match[1], 10);
    return Number.isNaN(value) ? null : value;
  };

  const consumePending = (kind: 'tshirts' | 'cocktails' | 'photos'): number | null => {
    switch (kind) {
      case 'tshirts':
        if (pendingTshirts > 0) {
          const qty = pendingTshirts;
          pendingTshirts = 0;
          return qty;
        }
        return null;
      case 'cocktails':
        if (pendingCocktails > 0) {
          const qty = pendingCocktails;
          pendingCocktails = 0;
          return qty;
        }
        return null;
      case 'photos':
        if (pendingPhotos > 0) {
          const qty = pendingPhotos;
          pendingPhotos = 0;
          return qty;
        }
        return null;
      default:
        return null;
    }
  };

  for (const line of detailLines) {
    const rawLabel = line.label?.trim() ?? '';
    if (!rawLabel) {
      continue;
    }
    if (!Number.isFinite(line.amount) || line.amount <= 0) {
      continue;
    }
    const normalizedLabel = rawLabel.toLowerCase();
    if (normalizedLabel.includes('tax')) {
      continue;
    }
    if (ADDON_BASE_LABELS.has(normalizedLabel)) {
      continue;
    }

    if (/photos?/i.test(rawLabel)) {
      const qtyFromLabel = extractNumericFromLabel(rawLabel);
      const pending = consumePending('photos');
      const qty = qtyFromLabel ?? pending ?? 1;
      extras.photos += qty;
      pushAddon(rawLabel, qty, line.amount);
      continue;
    }

    if (/t-?shirts?/i.test(rawLabel)) {
      const qtyFromLabel = extractNumericFromLabel(rawLabel);
      const pending = consumePending('tshirts');
      const qty = qtyFromLabel ?? pending ?? 1;
      extras.tshirts += qty;
      pushAddon(rawLabel, qty, line.amount);
      continue;
    }

    if (/cocktails?/i.test(rawLabel)) {
      const qtyFromLabel = extractNumericFromLabel(rawLabel);
      const pending = consumePending('cocktails');
      const qty = qtyFromLabel ?? pending ?? 1;
      extras.cocktails += qty;
      pushAddon(rawLabel, qty, line.amount);
      continue;
    }

    if (/^\d+$/.test(rawLabel)) {
      const pendingShirts = consumePending('tshirts');
      if (pendingShirts) {
        extras.tshirts += pendingShirts;
        pushAddon('T-Shirts', pendingShirts, line.amount);
        continue;
      }
      const qty = Number.parseInt(rawLabel, 10);
      if (qty > 0) {
        extras.cocktails += qty;
        pushAddon('Extra Cocktails', qty, line.amount);
        continue;
      }
    }
  }

  return { addons, extras, totalAmount };
};

export class FareHarborBookingParser implements BookingEmailParser {
  public readonly name = 'fareharbor';

  private buildDiagnostics(context: BookingParserContext): BookingParserDiagnostics {
    const from = context.from ?? context.headers.from ?? '';
    const subject = context.subject ?? '';
    const fromMatch = /fareharbor/i.test(from);
    const subjectMatch = /fareharbor/i.test(subject);
    const text = normalize(context.textBody || context.rawTextBody || context.snippet);
    const bookingNumber = text ? extractBookingNumber(text) : null;

    const canParseChecks: BookingParserCheck[] = [
      { label: 'from matches /fareharbor/i', passed: fromMatch, value: from },
      { label: 'subject matches /fareharbor/i', passed: subjectMatch, value: subject },
    ];
    const parseChecks: BookingParserCheck[] = [
      { label: 'text body present', passed: Boolean(text) },
      { label: 'booking number detected', passed: Boolean(bookingNumber), value: bookingNumber ?? null },
    ];

    return {
      name: this.name,
      canParse: fromMatch || subjectMatch,
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
    const text = normalize(context.textBody || context.rawTextBody || context.snippet);
    if (!text) {
      return null;
    }

    const bookingNumber = extractBookingNumber(text);
    if (!bookingNumber) {
      return null;
    }

    const scheduleText = (context.subject ?? '').trim();
    const { fields: bookingFields, party } = buildBookingFields(text, scheduleText);
    bookingFields.productName = extractProductName(text);

    const bookingTotal = text.match(BOOKING_TOTAL_PATTERN);
    const bookingTotalMoney = bookingTotal ? parseMoney(bookingTotal[0]) : { currency: null, amount: null };
    const taxes = text.match(TAXES_PATTERN);
    const taxesMoney = taxes ? parseMoney(taxes[0]) : { currency: null, amount: null };
    const due = text.match(DUE_PATTERN);
    const dueMoney = due ? parseMoney(due[0]) : { currency: null, amount: null };

    const paymentDetails = extractPaymentDetails(text, bookingTotalMoney.currency);

    const currency = bookingTotalMoney.currency ?? paymentDetails.currency ?? taxesMoney.currency ?? null;
    const totalAmount = bookingTotalMoney.amount ?? paymentDetails.amount ?? null;

    if (totalAmount !== null) {
      bookingFields.priceGross = totalAmount;
    }
    if (taxesMoney.amount !== null && totalAmount !== null) {
      bookingFields.baseAmount = Number((totalAmount - taxesMoney.amount).toFixed(2));
    } else if (totalAmount !== null) {
      bookingFields.baseAmount = totalAmount;
    }
    if (bookingFields.baseAmount !== undefined && bookingFields.baseAmount !== null) {
      bookingFields.priceNet = bookingFields.baseAmount;
    }

    if (currency) {
      bookingFields.currency = currency;
    }
    if (paymentDetails.paymentMethod) {
      bookingFields.paymentMethod = paymentDetails.paymentMethod;
    }

    const detailLines = extractDetailLines(text);
    const questionnaire = extractQuestionnaire(text);
    const addonsSnapshot: Record<string, unknown> = {};
    if (detailLines.length > 0) {
      addonsSnapshot.detailLines = detailLines;
    }
    if (questionnaire) {
      addonsSnapshot.questionnaire = questionnaire;
    }
    if (party.men !== null || party.women !== null) {
      addonsSnapshot.partyBreakdown = {
        men: party.men,
        women: party.women,
      };
    }
    if (Object.keys(addonsSnapshot).length > 0) {
      bookingFields.addonsSnapshot = addonsSnapshot;
    }
    const derivedAddons = deriveAddonsFromDetailLines(detailLines, currency, questionnaire);
    if (derivedAddons.totalAmount > 0) {
      bookingFields.addonsAmount = Number(derivedAddons.totalAmount.toFixed(2));
    }
    if (
      derivedAddons.extras.cocktails > 0 ||
      derivedAddons.extras.photos > 0 ||
      derivedAddons.extras.tshirts > 0
    ) {
      bookingFields.addonsSnapshot = {
        ...(bookingFields.addonsSnapshot ?? {}),
        extras: derivedAddons.extras,
      };
    }

    const paymentStatus =
      (dueMoney.amount !== null && dueMoney.amount === 0) || paymentDetails.amount !== null ? 'paid' : 'unknown';

    const baseFieldsForSpawn: BookingFieldPatch = { ...bookingFields };

    let status = deriveStatusFromContext(context, text);
    const rebookDetails = status === 'amended' ? extractRebookDetails(context) : null;
    let rebookedNewId = status === 'amended' ? extractRebookedNewId(text) : null;
    if (rebookDetails?.newBookingId) {
      rebookedNewId = rebookDetails.newBookingId;
    }
    if (status === 'amended' && rebookedNewId) {
      status = 'rebooked';
      delete bookingFields.experienceDate;
      delete bookingFields.experienceStartAt;
      delete bookingFields.experienceEndAt;
      if (rebookDetails?.newProductName) {
        bookingFields.productName = rebookDetails.newProductName;
      }
      if (rebookDetails?.newCustomers) {
        const rebookCounts = extractPartyCounts(rebookDetails.newCustomers);
        if (rebookCounts.total !== null) {
          bookingFields.partySizeTotal = rebookCounts.total;
        }
        if (rebookCounts.adults !== null) {
          bookingFields.partySizeAdults = rebookCounts.adults;
        }
        if (rebookCounts.children !== null) {
          bookingFields.partySizeChildren = rebookCounts.children;
        }
        if (rebookCounts.men !== null || rebookCounts.women !== null) {
          const snapshot =
            (bookingFields.addonsSnapshot as Record<string, unknown> | undefined) ?? {};
          snapshot.partyBreakdown = {
            men: rebookCounts.men,
            women: rebookCounts.women,
          };
          bookingFields.addonsSnapshot = snapshot;
        }
      }
    }
    const eventType = statusToEventType(status);

    const noteParts: string[] = [];
    if (questionnaire) {
      noteParts.push(questionnaire);
    }
    if (status === 'cancelled') {
      noteParts.push('Parsed from FareHarbor cancellation email.');
    } else if (status === 'amended') {
      noteParts.push('Parsed from FareHarbor amendment email.');
    } else if (status === 'rebooked') {
      noteParts.push('Parsed from FareHarbor rebooking email. Original booking moved to a new slot.');
      if (rebookedNewId) {
        noteParts.push(`New booking id: #${rebookedNewId}.`);
      }
    } else {
      noteParts.push('Parsed from FareHarbor confirmation email.');
    }

    let spawnedEvents: ParsedBookingEvent[] | undefined;
    if ((status === 'rebooked' || status === 'amended') && rebookedNewId) {
      const newEventFields: BookingFieldPatch = { ...baseFieldsForSpawn };
      if (rebookDetails?.newProductName) {
        newEventFields.productName = rebookDetails.newProductName;
      }
      if (rebookDetails?.newCustomers) {
        const newCounts = extractPartyCounts(rebookDetails.newCustomers);
        if (newCounts.total !== null) {
          newEventFields.partySizeTotal = newCounts.total;
        }
        if (newCounts.adults !== null) {
          newEventFields.partySizeAdults = newCounts.adults;
        }
        if (newCounts.children !== null) {
          newEventFields.partySizeChildren = newCounts.children;
        }
      }
      if (rebookDetails) {
        const schedule = deriveRebookSchedule(rebookDetails);
        if (schedule.experienceDate) {
          newEventFields.experienceDate = schedule.experienceDate;
        }
        if (schedule.experienceStartAt) {
          newEventFields.experienceStartAt = schedule.experienceStartAt;
        }
        if (schedule.experienceEndAt) {
          newEventFields.experienceEndAt = schedule.experienceEndAt;
        }
      }
      spawnedEvents = [
        {
          platform: 'fareharbor',
          platformBookingId: rebookedNewId,
          platformOrderId: rebookedNewId,
          eventType: 'amended',
          status: 'amended',
          paymentStatus,
          bookingFields: newEventFields,
          addons: derivedAddons.addons,
          notes: `Generated from FareHarbor rebooking of #${bookingNumber}.`,
          occurredAt: context.receivedAt ?? context.internalDate ?? null,
          sourceReceivedAt: context.receivedAt ?? context.internalDate ?? null,
        },
      ];
    }

    return {
      platform: 'fareharbor',
      platformBookingId: bookingNumber,
      platformOrderId: bookingNumber,
      eventType,
      status,
      paymentStatus,
      bookingFields,
      notes: noteParts.join(' '),
      addons: derivedAddons.addons,
      occurredAt: context.receivedAt ?? context.internalDate ?? null,
      sourceReceivedAt: context.receivedAt ?? context.internalDate ?? null,
      spawnedEvents,
    };
  }
}
