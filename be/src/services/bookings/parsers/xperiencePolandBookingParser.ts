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

const DATE_TIME_FORMATS = [
  'MMMM D, YYYY HH:mm',
  'MMMM D, YYYY H:mm',
  'MMMM D YYYY HH:mm',
  'MMMM D YYYY H:mm',
  'DD/MM/YYYY HH:mm',
  'DD.MM.YYYY HH:mm',
  'DD-MM-YYYY HH:mm',
  'D/M/YYYY HH:mm',
];

const normalizeLabels = (input: string | string[]): string[] => (Array.isArray(input) ? input : [input]);

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
  return value.replace(/\(.*?\)/g, '').replace(/,/, ',').trim();
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
  const match = value.match(/([\d.,]+)/);
  if (!match) {
    return { amount: null, currency: null };
  }
  const parsed = Number.parseFloat(match[1].replace(/,/g, ''));
  return {
    amount: Number.isNaN(parsed) ? null : parsed,
    currency: /pln/i.test(value) ? 'PLN' : null,
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

const deriveProductName = (text: string): string | null => {
  const servicesMatch =
    text.match(/Basic services\s+([\s\S]+?)Total amount of all services/i) ??
    text.match(/Usługi podstawowe\s+([\s\S]+?)Łączna kwota wszystkich usług/i);
  if (!servicesMatch) {
    return null;
  }
  const lines = servicesMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  const firstLine = lines[0];
  return firstLine.replace(/\s+PLN.*$/i, '').trim();
};

const extractAdditionalInfo = (text: string): string | null => {
  const match = text.match(/Additional information:\s*(.+)/i);
  if (!match) {
    return null;
  }
  return match[1].trim();
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

export class XperiencePolandBookingParser implements BookingEmailParser {
  public readonly name = 'xperiencepoland';

  private buildDiagnostics(context: BookingParserContext): BookingParserDiagnostics {
    const from = context.from ?? context.headers.from ?? '';
    const subject = context.subject ?? '';
    const fromMatch = /xperiencepoland\.com/i.test(from);
    const subjectMatch = /xperience/i.test(subject);
    const body = context.textBody || context.rawTextBody || context.snippet || '';
    const reservation =
      (body &&
        extractField(body, ['Reservation number:', 'Numer rezerwacji:'], [['Client:', 'Klient:']])) ??
      context.subject?.match(/\|\s*([A-Z0-9]+)\)/)?.[1] ??
      null;

    const canParseChecks: BookingParserCheck[] = [
      { label: 'from matches /xperiencepoland\\.com/i', passed: fromMatch, value: from },
      { label: 'subject matches /xperience/i', passed: subjectMatch, value: subject },
    ];
    const parseChecks: BookingParserCheck[] = [
      { label: 'text body present', passed: Boolean(body) },
      { label: 'reservation detected', passed: Boolean(reservation), value: reservation ?? null },
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
    const body = context.textBody || context.rawTextBody || context.snippet || '';
    if (!body) {
      return null;
    }

    const reservation =
      extractField(body, ['Reservation number:', 'Numer rezerwacji:'], [['Client:', 'Klient:']]) ??
      context.subject?.match(/\|\s*([A-Z0-9]+)\)/)?.[1];
    if (!reservation) {
      return null;
    }

    const clientName = extractField(
      body,
      ['Client:', 'Klient:'],
      [['Customer phone number:', 'Customer nr phone number:', 'Telefon klienta:'], ['Date:', 'Data:']],
    );
    const phone = extractField(
      body,
      ['Customer phone number:', 'Customer nr phone number:', 'Telefon klienta:'],
      [['Date:', 'Data:'], ['Time:', 'Godzina:']],
    );
    const dateText = extractField(body, ['Date:', 'Data:'], [['Time:', 'Godzina:'], ['Number of people:', 'Liczba osób:']]);
    const timeText = extractField(
      body,
      ['Time:', 'Godzina:'],
      [['Number of people:', 'Liczba osób:'], ['All services', 'Usługi podstawowe'], ['Basic services', 'Usługi podstawowe']],
    );
    const peopleText = extractField(
      body,
      ['Number of people:', 'Liczba osób:'],
      [
        ['All services', 'Usługi podstawowe'],
        ['Basic services', 'Usługi podstawowe'],
        ['Total amount of all services:', 'Łączna kwota wszystkich usług:'],
      ],
    );
    const totalAmountText = extractField(
      body,
      ['Total amount of all services:', 'Łączna kwota wszystkich usług:'],
      [['Additional information:', 'Dodatkowe informacje:'], ['This is our']],
    );

    const subjectDateMatch = context.subject?.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}).*?(\d{1,2}:\d{2})/);
    const subjectDate = subjectDateMatch ? subjectDateMatch[1] : null;
    const subjectTime = subjectDateMatch ? subjectDateMatch[2] : null;

    const parsedDate = parseExperienceDate(dateText, timeText, subjectDate && subjectTime ? `${subjectDate} ${subjectTime}` : null);

    const partySize = parsePartySize(peopleText);
    const money = parseMoney(totalAmountText);
    const productName = deriveProductName(body);
    const notes = extractAdditionalInfo(body) ?? extractField(body, ['Additional information:', 'Dodatkowe informacje:'], []);
    const { firstName, lastName } = normalizeName(clientName ?? undefined);

    const bookingFields: BookingFieldPatch = {
      productName,
      guestFirstName: firstName,
      guestLastName: lastName,
      guestPhone: phone ?? null,
      partySizeTotal: partySize,
      partySizeAdults: partySize,
      currency: money.currency ?? 'PLN',
      priceGross: money.amount,
      priceNet: money.amount,
      baseAmount: money.amount,
      notes,
      experienceDate: parsedDate?.isValid() ? parsedDate.format('YYYY-MM-DD') : null,
      experienceStartAt: parsedDate?.isValid() ? parsedDate.toDate() : null,
    };

    return {
      platform: 'xperiencepoland',
      platformBookingId: reservation.trim(),
      platformOrderId: reservation.trim(),
      status: 'confirmed',
      paymentStatus: money.amount ? 'paid' : 'unknown',
      eventType: 'created',
      bookingFields,
      occurredAt: context.receivedAt ?? context.internalDate ?? null,
      sourceReceivedAt: context.receivedAt ?? context.internalDate ?? null,
    };
  }
}
