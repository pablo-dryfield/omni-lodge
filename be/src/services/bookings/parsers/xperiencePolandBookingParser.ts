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
import { getConfigValue } from '../../configService.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_BOOKING_TIMEZONE =
  (getConfigValue('BOOKING_PARSER_TIMEZONE') as string | null) ?? 'Europe/Warsaw';
const XPERIENCEPOLAND_TIMEZONE =
  (getConfigValue('XPERIENCEPOLAND_TIMEZONE') as string | null) ?? DEFAULT_BOOKING_TIMEZONE;

const NEW_FLOW_START = dayjs.tz('2026-05-05 00:00', 'YYYY-MM-DD HH:mm', XPERIENCEPOLAND_TIMEZONE);

const DATE_TIME_FORMATS = [
  'MMMM D, YYYY HH:mm',
  'MMMM D, YYYY H:mm',
  'MMMM D YYYY HH:mm',
  'MMMM D YYYY H:mm',
  'YYYY-MM-DD HH:mm',
  'YYYY-MM-DD H:mm',
  'YYYY/MM/DD HH:mm',
  'YYYY/MM/DD H:mm',
  'DD/MM/YYYY HH:mm',
  'DD.MM.YYYY HH:mm',
  'DD-MM-YYYY HH:mm',
  'D/M/YYYY HH:mm',
  'D.M.YYYY HH:mm',
  'D-M-YYYY HH:mm',
  'MMMM D, YYYY',
  'MMMM D YYYY',
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'DD/MM/YYYY',
  'DD.MM.YYYY',
  'DD-MM-YYYY',
  'D/M/YYYY',
  'D.M.YYYY',
  'D-M-YYYY',
];

const BOOKING_SENDER_PATTERN = /(?:^|[<\s])friends@xperiencepoland\.com(?:[>\s]|$)/i;
const LEGACY_BOOKING_SUBJECT_PATTERN = /\brezerwacja\s+na\b/i;
const AVAILABILITY_SUBJECT_PATTERN = /\bpotwierdzenie\s+dost/i;
const REPLY_SUBJECT_PATTERN = /^\s*(?:re|fw|fwd|odp)\s*:/i;
const LEGACY_BODY_MARKER_PATTERN = /\bnowa rezerwacja czeka na twoje potwierdzenie\b/i;

const RESERVATION_LABELS = ['Reservation number:', 'Numer rezerwacji:'];
const CLIENT_LABELS = ['Client:', 'Klient:'];
const PHONE_LABELS = ['Customer phone number:', 'Customer nr phone number:', 'Telefon klienta:'];
const DATE_LABELS = ['Date:', 'Data:'];
const TIME_LABELS = ['Time:', 'Godzina:'];
const PEOPLE_LABELS = ['Number of people:', 'Liczba osob:', 'Liczba os?b:'];
const SERVICES_LABELS = ['Basic services', 'All services', 'Uslugi podstawowe', 'Uslugi podstawowe:'];
const TOTAL_LABELS = [
  'Total amount of all services:',
  'Laczna kwota wszystkich uslug:',
  'Laczna kwota wszystkich uslug',
];
const ADDITIONAL_INFO_LABELS = ['Additional information:', 'Dodatkowe informacje:'];
const TERMINATOR_LABELS = [
  'This is our',
  'To jest nasza',
  'Confirm availability',
  'Potwierdz dostepnosc',
  'Reject booking',
  'Odrzuc rezerwacje',
];

const ALLOWED_XPERIENCE_PRODUCTS = ['Private Pub Crawl', 'Regular Pub Crawl with Open Bar'] as const;

type XperienceEmailKind =
  | 'legacy_booking'
  | 'availability_request'
  | 'availability_confirmed'
  | 'availability_rejected'
  | 'availability_alternative'
  | null;

const normalizeLabels = (input: string | string[]): string[] => (Array.isArray(input) ? input : [input]);

const foldText = (value?: string | null): string =>
  (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const findLabelStart = (text: string, candidates: string[]): { start: number; length: number } | null => {
  const lower = text.toLowerCase();
  for (const candidate of candidates) {
    const needle = candidate.toLowerCase();
    const idx = lower.indexOf(needle);
    if (idx !== -1) {
      return { start: idx, length: candidate.length };
    }
  }
  return null;
};

const extractField = (text: string, labels: string | string[], nextLabels: (string | string[])[]): string | null => {
  const resolvedLabels = normalizeLabels(labels);
  const match = findLabelStart(text, resolvedLabels);
  if (!match) {
    return null;
  }

  const afterLabel = text.slice(match.start + match.length);
  if (nextLabels.length === 0) {
    return afterLabel.trim();
  }

  const afterLower = text.toLowerCase().slice(match.start + match.length);
  let endIndex = afterLabel.length;
  for (const next of nextLabels) {
    const options = normalizeLabels(next).map((entry) => entry.toLowerCase());
    for (const option of options) {
      const idx = afterLower.indexOf(option);
      if (idx !== -1 && idx < endIndex) {
        endIndex = idx;
      }
    }
  }

  return afterLabel.slice(0, endIndex).trim();
};

const sanitizeDateText = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  return value.replace(/\(.*?\)/g, '').trim();
};

const normalizeName = (value?: string | null): { firstName: string | null; lastName: string | null } => {
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

const parseMoney = (value?: string | null): { amount: number | null; currency: string | null } => {
  if (!value) {
    return { amount: null, currency: null };
  }

  const compact = value.replace(/\s/g, '');
  const match = compact.match(/([A-Z]{3})?[^\d-]*(-?[\d.,]+)/i) ?? compact.match(/(-?[\d.,]+)/);
  if (!match) {
    return { amount: null, currency: null };
  }

  const numericValue = match[2] ?? match[1] ?? '';
  const normalized = numericValue.includes(',') && numericValue.includes('.')
    ? numericValue.replace(/,/g, '')
    : numericValue.replace(',', '.');
  const parsed = Number.parseFloat(normalized);

  let currency: string | null = null;
  const explicitCurrency = value.match(/\b([A-Z]{3})\b/i)?.[1] ?? null;
  if (explicitCurrency) {
    currency = explicitCurrency.toUpperCase();
  } else if (/z[ll]|pln/i.test(foldText(value))) {
    currency = 'PLN';
  }

  return {
    amount: Number.isNaN(parsed) ? null : parsed,
    currency,
  };
};

const parsePartySize = (value?: string | null): number | null => {
  if (!value) {
    return null;
  }
  const match = value.match(/(\d+)/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findBlockBoundary = (text: string, labels: string[]): number => {
  const lower = text.toLowerCase();
  let best = -1;
  for (const label of labels) {
    const idx = lower.indexOf(label.toLowerCase());
    if (idx !== -1 && (best === -1 || idx < best)) {
      best = idx;
    }
  }
  return best;
};

const deriveProductName = (text: string): string | null => {
  const start = findLabelStart(text, SERVICES_LABELS);
  if (!start) {
    for (const productName of ALLOWED_XPERIENCE_PRODUCTS) {
      const pattern = new RegExp(`\\b${escapeRegExp(productName)}\\b`, 'i');
      if (pattern.test(text)) {
        return productName;
      }
    }
    return null;
  }

  const afterStart = text.slice(start.start + start.length).trimStart().replace(/^[:\-]\s*/, '');
  const endIndex = findBlockBoundary(afterStart, [...TOTAL_LABELS, ...ADDITIONAL_INFO_LABELS, ...TERMINATOR_LABELS]);
  const block = (endIndex >= 0 ? afterStart.slice(0, endIndex) : afterStart).trim();
  if (!block) {
    return null;
  }

  const hits = ALLOWED_XPERIENCE_PRODUCTS.map((name) => {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i');
    const match = pattern.exec(block);
    return { name, index: match?.index ?? -1 };
  }).filter((entry) => entry.index >= 0);

  if (hits.length === 0) {
    return null;
  }

  hits.sort((left, right) => left.index - right.index);
  return hits[0].name;
};

const extractAdditionalInfo = (text: string): string | null => {
  const value = extractField(text, ADDITIONAL_INFO_LABELS, [TERMINATOR_LABELS]);
  return value?.trim() || null;
};

const parseExperienceDate = (dateText?: string | null, timeText?: string | null, fallback?: string | null) => {
  const sanitizedDate = sanitizeDateText(dateText);
  const timeValue = (timeText ?? '').trim();
  const attempts: string[] = [];
  if (sanitizedDate && timeValue) {
    attempts.push(`${sanitizedDate} ${timeValue}`);
  }
  if (sanitizedDate) {
    attempts.push(sanitizedDate);
  }
  if (fallback) {
    attempts.push(fallback);
  }

  for (const candidate of attempts) {
    for (const format of DATE_TIME_FORMATS) {
      try {
        const parsed = dayjs.tz(candidate, format, XPERIENCEPOLAND_TIMEZONE);
        if (parsed.isValid()) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
};

const extractReservationCandidate = (context: BookingParserContext, body: string): string | null => {
  const byLabel = extractField(body, RESERVATION_LABELS, [CLIENT_LABELS, PHONE_LABELS, DATE_LABELS]);
  const bySubject = context.subject?.match(/\|\s*([A-Z0-9]{4,})\s*$/i)?.[1] ?? null;
  const raw = byLabel ?? bySubject;
  if (!raw) {
    return null;
  }
  const idMatch = raw.match(/[A-Z0-9]{4,}/i);
  return idMatch?.[0]?.toUpperCase() ?? null;
};

const isNewFlowEligible = (context: BookingParserContext): boolean => {
  const anchor = context.receivedAt ?? context.internalDate ?? null;
  if (!anchor) {
    return true;
  }
  const parsed = dayjs(anchor);
  if (!parsed.isValid()) {
    return true;
  }
  return parsed.isAfter(NEW_FLOW_START) || parsed.isSame(NEW_FLOW_START);
};

const classifyEmailKind = (
  subject: string,
  body: string,
  newFlowEligible: boolean,
): XperienceEmailKind => {
  const normalizedSubject = foldText(subject);
  const normalizedBody = foldText(body);

  if (newFlowEligible) {
    if (
      normalizedBody.includes('otrzymalismy potwierdzenie dostepnosci dla zapytania') ||
      normalizedBody.includes('skontaktujemy sie z toba po potwierdzeniu rezerwacji przez klienta')
    ) {
      return 'availability_confirmed';
    }

    if (
      normalizedBody.includes('brak dostepnosci') ||
      normalizedBody.includes('nie udalo sie potwierdzic dostepnosci') ||
      normalizedBody.includes('odrzucono zapytanie')
    ) {
      return 'availability_rejected';
    }

    if (
      normalizedBody.includes('proponujemy inny termin') ||
      normalizedBody.includes('zaproponowano inny termin') ) {
      return 'availability_alternative';
    }

    if (
      normalizedBody.includes('status rezerwacji: oczekujace') ||
      normalizedBody.includes('nowa rezerwacja czeka na twoje potwierdzenie') ||
      AVAILABILITY_SUBJECT_PATTERN.test(subject) ||
      normalizedSubject.includes('potwierdzenie dostepnosci')
    ) {
      return 'availability_request';
    }
  }

  if (
    (LEGACY_BOOKING_SUBJECT_PATTERN.test(subject) || normalizedSubject.includes('rezerwacja na')) &&
    LEGACY_BODY_MARKER_PATTERN.test(normalizedBody)
  ) {
    return 'legacy_booking';
  }

  return null;
};

const extractDateTimeFromBody = (body: string, subject?: string | null) => {
  const dateText = extractField(body, DATE_LABELS, [TIME_LABELS, PEOPLE_LABELS, SERVICES_LABELS]);
  const timeText = extractField(body, TIME_LABELS, [PEOPLE_LABELS, SERVICES_LABELS, TOTAL_LABELS]);
  const subjectDateMatch = subject?.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}).*?(\d{1,2}:\d{2})/);
  const subjectFallback = subjectDateMatch ? `${subjectDateMatch[1]} ${subjectDateMatch[2]}` : null;
  const parsed = parseExperienceDate(dateText, timeText, subjectFallback);
  return { dateText, timeText, parsed };
};

const extractDateTimeFromAcknowledgement = (body: string, subject?: string | null) => {
  const match = body.match(/termin\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/i);
  if (match) {
    const parsed = parseExperienceDate(match[1], match[2], `${match[1]} ${match[2]}`);
    return {
      dateText: match[1],
      timeText: match[2],
      parsed,
    };
  }
  return extractDateTimeFromBody(body, subject);
};

const extractPartySizeText = (text: string): string | null => {
  const byLabel = extractField(text, PEOPLE_LABELS, [SERVICES_LABELS, TOTAL_LABELS, ADDITIONAL_INFO_LABELS]);
  if (byLabel) {
    return byLabel;
  }
  const regexMatch = text.match(/(?:number\s+of\s+people|liczba[^:\n\r]{0,40})\s*:\s*([^\n\r]+)/i);
  return regexMatch?.[1]?.trim() ?? null;
};

const extractTotalAmountText = (text: string): string | null => {
  const byLabel = extractField(text, TOTAL_LABELS, [ADDITIONAL_INFO_LABELS, TERMINATOR_LABELS]);
  if (byLabel) {
    return byLabel;
  }
  const regexMatch = text.match(
    /(?:total\s+amount\s+of\s+all\s+services|[^:\n\r]{0,20}kwota[^:\n\r]{0,20}us[^:\n\r]{0,20})\s*:\s*([^\n\r]+)/i,
  );
  return regexMatch?.[1]?.trim() ?? null;
};

const appendNote = (parts: Array<string | null | undefined>): string | null => {
  const normalized = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  if (normalized.length === 0) {
    return null;
  }
  return normalized.join('\n');
};

export class XperiencePolandBookingParser implements BookingEmailParser {
  readonly name = 'xperiencepoland';

  private buildDiagnostics(context: BookingParserContext): BookingParserDiagnostics {
    const subject = context.subject ?? '';
    const body = context.textBody || context.rawTextBody || context.snippet || '';
    const sender = context.from ?? context.headers.from ?? '';

    const senderMatch = BOOKING_SENDER_PATTERN.test(sender);
    const replySubjectMatch = REPLY_SUBJECT_PATTERN.test(subject);
    const newFlowEligible = isNewFlowEligible(context);
    const kind = classifyEmailKind(subject, body, newFlowEligible);
    const reservation = extractReservationCandidate(context, body);

    const subjectMatch = Boolean(
      kind === 'legacy_booking'
        ? LEGACY_BOOKING_SUBJECT_PATTERN.test(subject) && !replySubjectMatch
        : kind
          ? AVAILABILITY_SUBJECT_PATTERN.test(subject) || REPLY_SUBJECT_PATTERN.test(subject)
          : false,
    );

    const canParseChecks: BookingParserCheck[] = [
      { label: 'sender matches friends@xperiencepoland.com', passed: senderMatch, value: sender || null },
      { label: 'new flow date active', passed: newFlowEligible || kind === 'legacy_booking', value: newFlowEligible ? 'new-flow-enabled' : 'legacy-only' },
      { label: 'email kind detected', passed: Boolean(kind), value: kind },
      { label: 'subject pattern matches', passed: subjectMatch, value: subject || null },
      {
        label: 'reply subject allowed',
        passed: !replySubjectMatch || kind === 'availability_confirmed' || kind === 'availability_rejected' || kind === 'availability_alternative',
        value: replySubjectMatch ? 'reply subject' : null,
      },
      { label: 'reservation detected', passed: Boolean(reservation), value: reservation ?? null },
    ];

    const parseChecks: BookingParserCheck[] = [
      { label: 'text body present', passed: Boolean(body) },
      { label: 'reservation detected', passed: Boolean(reservation), value: reservation ?? null },
    ];

    const canParse =
      senderMatch &&
      Boolean(kind) &&
      subjectMatch &&
      Boolean(reservation) &&
      (!replySubjectMatch || kind !== 'legacy_booking');

    return {
      name: this.name,
      canParse,
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

    const body = context.textBody || context.rawTextBody || context.snippet || '';
    const subject = context.subject ?? '';
    if (!body) {
      return null;
    }

    const kind = classifyEmailKind(subject, body, isNewFlowEligible(context));
    if (!kind) {
      return null;
    }

    const reservation = extractReservationCandidate(context, body);
    if (!reservation) {
      return null;
    }

    const clientName = extractField(body, CLIENT_LABELS, [PHONE_LABELS, DATE_LABELS, TIME_LABELS]);
    const phone = extractField(body, PHONE_LABELS, [DATE_LABELS, TIME_LABELS, PEOPLE_LABELS]);
    const peopleText = extractPartySizeText(body);
    const totalAmountText = extractTotalAmountText(body);
    const productName = deriveProductName(body);
    const extraInfo = extractAdditionalInfo(body);
    const { firstName, lastName } = normalizeName(clientName ?? undefined);
    const partySize = parsePartySize(peopleText);
    const money = parseMoney(totalAmountText);

    const primaryDateTime = extractDateTimeFromBody(body, subject);
    const acknowledgementDateTime = extractDateTimeFromAcknowledgement(body, subject);
    const resolvedDate = primaryDateTime.parsed?.isValid() ? primaryDateTime.parsed : acknowledgementDateTime.parsed;

    const bookingFields: BookingFieldPatch = {};
    if (productName) {
      bookingFields.productName = productName;
    }
    if (firstName) {
      bookingFields.guestFirstName = firstName;
    }
    if (lastName) {
      bookingFields.guestLastName = lastName;
    }
    if (phone) {
      bookingFields.guestPhone = phone;
    }
    if (partySize !== null) {
      bookingFields.partySizeTotal = partySize;
      bookingFields.partySizeAdults = partySize;
    }
    if (money.currency) {
      bookingFields.currency = money.currency;
    } else if (money.amount !== null) {
      bookingFields.currency = 'PLN';
    }
    if (money.amount !== null) {
      bookingFields.priceGross = money.amount;
      bookingFields.priceNet = money.amount;
      bookingFields.baseAmount = money.amount;
    }
    if (resolvedDate?.isValid()) {
      bookingFields.experienceDate = resolvedDate.format('YYYY-MM-DD');
      bookingFields.experienceStartAt = resolvedDate.toDate();
    }

    const occurredAt = context.receivedAt ?? context.internalDate ?? null;
    const sourceReceivedAt = context.receivedAt ?? context.internalDate ?? null;

    if (kind === 'availability_request') {
      bookingFields.notes = appendNote([
        extraInfo,
        'XperiencePoland availability request received. Waiting for final confirmation.',
      ]);
      return {
        platform: 'xperiencepoland',
        platformBookingId: reservation,
        platformOrderId: reservation,
        status: 'pending',
        paymentStatus: 'unpaid',
        eventType: 'created',
        bookingFields,
        occurredAt,
        sourceReceivedAt,
        rawPayload: {
          xperienceEmailKind: kind,
        },
      };
    }

    if (kind === 'availability_confirmed') {
      bookingFields.notes = appendNote([
        extraInfo,
        'XperiencePoland availability was confirmed by supplier.',
      ]);
      return {
        platform: 'xperiencepoland',
        platformBookingId: reservation,
        platformOrderId: reservation,
        status: 'confirmed',
        paymentStatus: 'unpaid',
        eventType: 'amended',
        bookingFields,
        occurredAt,
        sourceReceivedAt,
        rawPayload: {
          xperienceEmailKind: kind,
        },
      };
    }

    if (kind === 'availability_rejected') {
      bookingFields.notes = appendNote([
        extraInfo,
        'XperiencePoland availability request was rejected.',
      ]);
      return {
        platform: 'xperiencepoland',
        platformBookingId: reservation,
        platformOrderId: reservation,
        status: 'cancelled',
        paymentStatus: 'unpaid',
        eventType: 'cancelled',
        bookingFields,
        occurredAt,
        sourceReceivedAt,
        rawPayload: {
          xperienceEmailKind: kind,
        },
      };
    }

    if (kind === 'availability_alternative') {
      bookingFields.notes = appendNote([
        extraInfo,
        'XperiencePoland proposed an alternative term. Booking remains pending.',
      ]);
      return {
        platform: 'xperiencepoland',
        platformBookingId: reservation,
        platformOrderId: reservation,
        status: 'pending',
        paymentStatus: 'unpaid',
        eventType: 'amended',
        bookingFields,
        occurredAt,
        sourceReceivedAt,
        rawPayload: {
          xperienceEmailKind: kind,
        },
      };
    }

    bookingFields.notes = extraInfo;
    return {
      platform: 'xperiencepoland',
      platformBookingId: reservation,
      platformOrderId: reservation,
      status: 'confirmed',
      paymentStatus: money.amount !== null ? 'paid' : 'unknown',
      eventType: 'created',
      bookingFields,
      occurredAt,
      sourceReceivedAt,
      rawPayload: {
        xperienceEmailKind: kind,
      },
    };
  }
}



