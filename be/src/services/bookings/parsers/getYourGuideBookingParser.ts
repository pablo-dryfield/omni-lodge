import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import type { BookingEmailParser, BookingParserContext, BookingFieldPatch, ParsedBookingEvent } from '../types.js';

dayjs.extend(customParseFormat);

const MONEY_SYMBOLS: Record<string, string> = {
  'z\u0142': 'PLN',
  zl: 'PLN',
  pln: 'PLN',
  $: 'USD',
  '\u20ac': 'EUR',
  '\u00a3': 'GBP',
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

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

const extractBookingFields = (text: string): BookingFieldPatch => {
  const fields: BookingFieldPatch = {};

  const productMatch = text.match(/has been booked:\s+(.+?)\s+Reference number/i);
  if (productMatch) {
    const rawName = productMatch[1].trim();
    const half = Math.floor(rawName.length / 2);
    const firstHalf = rawName.slice(0, half).trim();
    const secondHalf = rawName.slice(half).trim();
    fields.productName = firstHalf && firstHalf === secondHalf ? firstHalf : rawName;
  }

  const customerMatch = text.match(/Main customer\s+([A-Za-z\u00C0-\u017F' -]+?)(?=\s+[a-z0-9._%+-]+@)/i);
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

  const participantsMatch = text.match(/Number of participants\s+(\d+)\s+x\s+([A-Za-z]+)/i);
  if (participantsMatch) {
    const qty = Number.parseInt(participantsMatch[1], 10);
    if (!Number.isNaN(qty)) {
      fields.partySizeTotal = qty;
      fields.partySizeAdults = qty;
    }
  }

  const dateMatch = text.match(/Date\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
  if (dateMatch) {
    const parsed = dayjs(`${dateMatch[1]} ${dateMatch[2]}`, ['MMMM D, YYYY h:mm A'], true);
    if (parsed.isValid()) {
      fields.experienceDate = parsed.format('YYYY-MM-DD');
      fields.experienceStartAt = parsed.toDate();
    }
  }

  return fields;
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

    const referenceMatch = text.match(/Reference number\s+([A-Z0-9]+)/i);
    if (!referenceMatch) {
      return null;
    }
    const bookingId = referenceMatch[1];

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

    const tourLanguageMatch = text.match(/Tour language\s+(.+?)\s+Price/i);
    const customerLanguageMatch = text.match(/Language:\s*([A-Za-z]+)/i);
    const notes: string[] = [];
    if (tourLanguageMatch) {
      notes.push(`Tour language: ${tourLanguageMatch[1].trim()}`);
    }
    if (customerLanguageMatch) {
      notes.push(`Customer language: ${customerLanguageMatch[1].trim()}`);
    }

    return {
      platform: 'getyourguide',
      platformBookingId: bookingId,
      platformOrderId: bookingId,
      eventType: 'created',
      status: 'confirmed',
      paymentStatus: bookingFields.priceGross ? 'paid' : 'unknown',
      bookingFields,
      notes: notes.length > 0 ? notes.join(' | ') : 'Parsed from GetYourGuide confirmation email.',
      occurredAt: context.receivedAt ?? context.internalDate ?? null,
      sourceReceivedAt: context.receivedAt ?? context.internalDate ?? null,
    };
  }
}
