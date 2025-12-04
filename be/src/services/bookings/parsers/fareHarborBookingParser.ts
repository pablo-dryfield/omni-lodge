import type { BookingEmailParser, BookingParserContext, BookingFieldPatch, ParsedBookingEvent } from '../types.js';
import type { BookingEventType, BookingStatus } from '../../../constants/bookings.js';

const MONEY_PATTERN = /(PLN|USD|EUR|GBP)?\s*([\d.,]+)/i;
const BOOKING_NUMBER_PATTERN = /Booking\s*#(\d+)/i;
const PRODUCT_LINE_PATTERN = /Booking\s*#\d+\s+(.+?)\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i;
const PARTY_SEGMENT_PATTERN = /(\d+)\s+(Man|Men|Woman|Women|Guest|Guests|People|Persons|Adult|Adults|Child|Children|Kid|Kids)/gi;
const EMAIL_PATTERN = /Email:\s*([^\s]+@[^\s]+)/i;
const PHONE_PATTERN = /Phone:\s*([+()\d\s-]{6,})/i;
const NAME_PATTERN = /Name:\s*([^\n]+?)(?:\s+Phone:|\s+Email:|$)/i;
const BOOKING_TOTAL_PATTERN = /Booking\s+total\s+(PLN|USD|EUR|GBP)?\s*([\d.,]+)/i;
const TAXES_PATTERN = /Taxes\s+(PLN|USD|EUR|GBP)?\s*([\d.,]+)/i;
const DUE_PATTERN = /Due:\s*(PLN|USD|EUR|GBP)?\s*([\d.,]+)/i;
const PAYMENT_PATTERN = /[•*]?\s*(PLN|USD|EUR|GBP)?\s*([\d.,]+)\s*(?:[-–]\s*)?([^(]+?)\s*\(([^)]+)\)/i;
const ADULT_TERMS = new Set(['man', 'men', 'woman', 'women', 'guest', 'guests', 'people', 'persons', 'adult', 'adults']);
const CHILD_TERMS = new Set(['child', 'children', 'kid', 'kids']);

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

const extractProductName = (text: string): string | null => {
  const match = text.match(PRODUCT_LINE_PATTERN);
  return match?.[1]?.trim() ?? null;
};

const extractPartyCounts = (
  text: string,
): { total: number | null; adults: number | null; children: number | null } => {
  let adults = 0;
  let children = 0;
  const matches = text.matchAll(PARTY_SEGMENT_PATTERN);
  for (const match of matches) {
    const qty = Number.parseInt(match[1], 10);
    if (Number.isNaN(qty)) {
      continue;
    }
    const label = match[2].toLowerCase();
    if (ADULT_TERMS.has(label)) {
      adults += qty;
    } else if (CHILD_TERMS.has(label)) {
      children += qty;
    }
  }
  const total = adults + children;
  return {
    total: total > 0 ? total : null,
    adults: adults > 0 ? adults : null,
    children: children > 0 ? children : null,
  };
};

const MONTH_LOOKUP: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const parseDateTimeTokens = (dateToken: string, timeToken: string): Date | null => {
  const dateMatch = dateToken.match(/([A-Za-z]+),\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i);
  const timeMatch = timeToken.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!dateMatch || !timeMatch) {
    return null;
  }
  const monthIndex = MONTH_LOOKUP[dateMatch[3].toLowerCase()];
  if (monthIndex === undefined) {
    return null;
  }
  const day = Number.parseInt(dateMatch[2], 10);
  const year = Number.parseInt(dateMatch[4], 10);
  let hour = Number.parseInt(timeMatch[1], 10);
  const minute = Number.parseInt(timeMatch[2], 10);
  const period = timeMatch[3].toLowerCase();
  if (period === 'pm' && hour < 12) {
    hour += 12;
  }
  if (period === 'am' && hour === 12) {
    hour = 0;
  }
  if (Number.isNaN(day) || Number.isNaN(year) || Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }
  return new Date(Date.UTC(year, monthIndex, day, hour, minute));
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
  const regex = /([A-Za-z0-9 ?'()]+?)\s+(PLN|USD|EUR|GBP)\s*([\d.,]+)/g;
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

const buildBookingFields = (contextText: string, scheduleText: string): BookingFieldPatch => {
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

  const party = extractPartyCounts(contextText);
  fields.partySizeTotal = party.total;
  fields.partySizeAdults = party.adults;
  fields.partySizeChildren = party.children;

  const experienceFromSubject = extractExperienceFromSubject(scheduleText);
  const scheduleSource = scheduleText.trim().length > 0 ? scheduleText : contextText;
  const experience = experienceFromSubject ?? extractExperience(scheduleSource);
  fields.experienceDate = experience.experienceDate;
  fields.experienceStartAt = experience.experienceStartAt;
  fields.experienceEndAt = experience.experienceEndAt;

  return fields;
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

export class FareHarborBookingParser implements BookingEmailParser {
  public readonly name = 'fareharbor';

  canParse(context: BookingParserContext): boolean {
    const from = context.from ?? context.headers.from ?? '';
    const subject = context.subject ?? '';
    return /fareharbor/i.test(from) || /fareharbor/i.test(subject);
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
    const bookingFields = buildBookingFields(text, scheduleText);
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
    if (detailLines.length > 0 || questionnaire) {
      bookingFields.addonsSnapshot = {
        detailLines,
        questionnaire,
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
      occurredAt: context.receivedAt ?? context.internalDate ?? null,
      sourceReceivedAt: context.receivedAt ?? context.internalDate ?? null,
      spawnedEvents,
    };
  }
}
