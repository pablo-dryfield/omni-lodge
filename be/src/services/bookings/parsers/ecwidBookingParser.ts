import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import type { BookingEmailParser, BookingParserContext, BookingFieldPatch, ParsedBookingEvent } from '../types.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_BOOKING_TIMEZONE = process.env.BOOKING_PARSER_TIMEZONE ?? 'Europe/Warsaw';
const ECWID_TIMEZONE = process.env.ECWID_TIMEZONE ?? DEFAULT_BOOKING_TIMEZONE;

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const parseNumber = (raw: string | null): number | null => {
  if (!raw) {
    return null;
  }
  const normalized = raw.replace(/\s+/g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isNaN(parsed) ? null : parsed;
};

const currencyFromToken = (token: string | null): string | null => {
  if (!token) {
    return null;
  }
  const lower = token.toLowerCase();
  if (lower.includes('z')) {
    return 'PLN';
  }
  if (lower.includes('€')) {
    return 'EUR';
  }
  if (lower.includes('$')) {
    return 'USD';
  }
  return null;
};

const parseOrderTotals = (text: string): { total: number | null; currency: string | null } => {
  const match = text.match(/Total\s+([\d\s.,-]+)\s*([^\s\d]+)/i);
  if (!match) {
    return { total: null, currency: null };
  }
  return {
    total: parseNumber(match[1]) ?? null,
    currency: currencyFromToken(match[2]),
  };
};

const extractCustomerSection = (text: string): string | null => {
  const match = text.match(/Customer\s+(.+?)\s+(?:Pickup Details|Pickup date and time)/i);
  return match?.[1]?.trim() ?? null;
};

const parseEmail = (input: string | null): string | null => {
  if (!input) {
    return null;
  }
  const match = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? null;
};

const parsePhone = (input: string | null): string | null => {
  if (!input) {
    return null;
  }
  const match = input.match(/(\+?[\d][\d\s-]{5,})/);
  if (!match) {
    return null;
  }
  let phone = match[1];
  if (phone && !phone.startsWith('+') && phone.startsWith('00')) {
    phone = `+${phone.slice(2)}`;
  }
  return phone.replace(/\s+/g, ' ').trim();
};

const parseNameFromCustomerSection = (section: string | null, email: string | null, phone: string | null): string | null => {
  if (!section) {
    return null;
  }
  let candidate = section;
  if (email) {
    candidate = candidate.replace(email, ' ');
  }
  if (phone) {
    candidate = candidate.replace(phone ?? '', ' ');
  }
  return normalizeText(candidate);
};

const parsePartySize = (text: string): { total: number | null; men: number | null; women: number | null } => {
  const manMatch = text.match(/Man:\s*(\d+)/i);
  const womanMatch = text.match(/Woman:\s*(\d+)/i);
  const men = manMatch ? Number.parseInt(manMatch[1], 10) : null;
  const women = womanMatch ? Number.parseInt(womanMatch[1], 10) : null;
  const total =
    men !== null || women !== null ? (men ?? 0) + (women ?? 0) : null;
  return {
    total,
    men,
    women,
  };
};

const parseAddons = (text: string): string | null => {
  const matches = Array.from(text.matchAll(/([A-Za-z ]+Add-On):\s*([A-Za-z0-9]+)/gi));
  if (matches.length === 0) {
    return null;
  }
  return matches
    .map(([_, label, value]) => `${label.trim()}: ${value.trim()}`)
    .join(' | ');
};

const parsePickupLocation = (text: string): string | null => {
  const match = text.match(/Meeting Point\s+(.+?)\s+Time/i);
  return match?.[1]?.trim() ?? null;
};

const parsePickupDate = (text: string): string | null => {
  const match = text.match(/Pickup date and time:? ([A-Za-z]+ \d{1,2}, \d{4})/i);
  return match?.[1]?.trim() ?? null;
};

const parsePickupTime = (text: string): string | null => {
  const match = text.match(/Time\s+([\d:.]+\s*(?:A\.M\.|P\.M\.|AM|PM))/i);
  return match?.[1]?.trim() ?? null;
};

const buildExperienceMoment = (dateRaw: string | null, timeRaw: string | null): { experienceDate: string | null; startAt: Date | null } => {
  if (!dateRaw) {
    return { experienceDate: null, startAt: null };
  }
  const normalizedDate = dateRaw.replace(/\s+/g, ' ').trim();
  const normalizedTime = timeRaw
    ? timeRaw.replace(/A\.M\./gi, 'AM').replace(/P\.M\./gi, 'PM').replace(/CEST|CET|UTC|GMT/gi, '').trim()
    : null;
  const dateFormats = ['MMM D, YYYY', 'MMMM D, YYYY'];
  const timeFormats = normalizedTime ? ['h:mm A'] : [];
  for (const format of dateFormats) {
    const datePart = dayjs.tz(normalizedDate, format, ECWID_TIMEZONE);
    if (!datePart.isValid()) {
      continue;
    }
    if (!normalizedTime) {
      return { experienceDate: datePart.format('YYYY-MM-DD'), startAt: datePart.toDate() };
    }
    for (const timeFormat of timeFormats) {
      const combined = dayjs.tz(
        `${datePart.format('YYYY-MM-DD')} ${normalizedTime}`,
        `YYYY-MM-DD ${timeFormat}`,
        ECWID_TIMEZONE,
      );
      if (combined.isValid()) {
        return {
          experienceDate: datePart.format('YYYY-MM-DD'),
          startAt: combined.toDate(),
        };
      }
    }
    return { experienceDate: datePart.format('YYYY-MM-DD'), startAt: null };
  }
  return { experienceDate: null, startAt: null };
};

export class EcwidBookingParser implements BookingEmailParser {
  public readonly name = 'ecwid';

  canParse(context: BookingParserContext): boolean {
    const subject = context.subject ?? '';
    if (subject.toLowerCase().startsWith('fwd:')) {
      return false;
    }
    const from = context.from ?? context.headers.from ?? '';
    return /ecwid/i.test(from) || /new order #/i.test(subject);
  }

  async parse(context: BookingParserContext): Promise<ParsedBookingEvent | null> {
    const text = context.textBody || context.rawTextBody || context.snippet || '';
    if (!text) {
      return null;
    }

    const orderMatch = text.match(/New order\s+#([A-Z0-9]+)/i);
    if (!orderMatch) {
      return null;
    }
    const orderId = orderMatch[1].trim();

    const productMatch = text.match(/Items\s+(.+?)\s+Man:/i);
    const productName = productMatch?.[1]?.trim() ?? null;

    const totals = parseOrderTotals(text);
    const party = parsePartySize(text);
    const addonsNote = parseAddons(text);
    const location = parsePickupLocation(text);
    const pickupDate = parsePickupDate(text);
    const pickupTime = parsePickupTime(text);
    const experienceMoment = buildExperienceMoment(pickupDate, pickupTime);

    const customerSection = extractCustomerSection(text);
    const email = parseEmail(customerSection);
    const phone = parsePhone(customerSection);
    const customerName = parseNameFromCustomerSection(customerSection, email, phone);
    const nameParts = customerName ? customerName.split(/\s+/) : [];
    const firstName = nameParts.shift() ?? null;
    const lastName = nameParts.length > 0 ? nameParts.join(' ') : null;

    const paymentMethodMatch = text.match(/Payment method\s+([A-Za-z ]+)/i);
    const paymentMethod =
      paymentMethodMatch?.[1]?.replace(/View order details/i, '').trim() ?? null;

    const addonsSnapshot: Record<string, unknown> = {};
    if (party.men !== null || party.women !== null) {
      addonsSnapshot.partyBreakdown = {
        men: party.men,
        women: party.women,
      };
    }
    if (addonsNote) {
      addonsSnapshot.notes = addonsNote;
    }

    const bookingFields: BookingFieldPatch = {
      productName,
      guestFirstName: firstName,
      guestLastName: lastName,
      guestEmail: email,
      guestPhone: phone,
      experienceDate: experienceMoment.experienceDate,
      experienceStartAt: experienceMoment.startAt,
      partySizeTotal: party.total,
      partySizeAdults: party.total,
      currency: totals.currency ?? 'PLN',
      priceGross: totals.total,
      priceNet: totals.total,
      baseAmount: totals.total,
      paymentMethod,
      pickupLocation: location,
      notes: addonsNote ?? null,
    };
    if (Object.keys(addonsSnapshot).length > 0) {
      bookingFields.addonsSnapshot = addonsSnapshot;
    }

    const paymentStatus = /paid/i.test(context.subject ?? '') || /paid/i.test(text) ? 'paid' : 'unknown';

    return {
      platform: 'ecwid',
      platformBookingId: orderId,
      platformOrderId: orderId,
      eventType: 'created',
      status: 'confirmed',
      paymentStatus,
      bookingFields,
      occurredAt: context.receivedAt ?? context.internalDate ?? null,
      sourceReceivedAt: context.receivedAt ?? context.internalDate ?? null,
    };
  }
}
