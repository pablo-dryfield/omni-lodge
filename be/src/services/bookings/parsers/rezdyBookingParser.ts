import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { getConfigValue } from '../../configService.js';
import type { BookingStatus } from '../../../constants/bookings.js';
import type { BookingEmailParser, BookingFieldPatch, BookingParserContext, ParsedBookingEvent } from '../types.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

export type RezdySource = {
  orderId: string;
  agent: string | null;
  viatorReference: string | null;
  productCode: string | null;
  grossTotal?: number;
  netTotal?: number;
  commission?: number;
  totalPaid?: number;
  refundTotal?: number;
  refundAmount?: number;
  refundReference?: string;
  refundCurrency?: string;
  financialBasis?: string;
  reportedCommissionMismatch?: boolean;
  validationError?: string;
};

const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();
const decode = (value: string): string => value
  .replace(/&#(?:x([a-f\d]+)|(\d+));/gi, (entity, hex: string, decimal: string) => {
    const code = Number.parseInt(hex || decimal, hex ? 16 : 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  })
  .replace(/&(nbsp|amp|quot|apos|lt|gt|pound|euro);/gi, (_, name: string) =>
    ({ nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', pound: '£', euro: '€' })[name.toLowerCase()] ?? _);
const plain = (html: string): string => normalize(decode(html
  .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')));

const parseAmount = (value: string): number | null => {
  const match = value.match(/-?\d[\d\s.,]*/);
  if (!match) return null;
  let token = match[0].replace(/\s/g, '');
  const dot = token.lastIndexOf('.'), comma = token.lastIndexOf(',');
  if (comma > dot && dot < 0 && token.length - comma - 1 === 3) token = token.replace(/,/g, '');
  else if (comma > dot) token = token.replace(/\./g, '').replace(',', '.');
  else token = token.replace(/,/g, '');
  const amount = Number(token);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};
const parseMoney = (value: string | undefined): { amount: number; currency: string } | null => {
  if (!value) return null;
  const prefix = value.match(/\b(PLN|EUR|USD|GBP|AUD|CAD|CHF|CZK)\s*(-?\d[\d\s.,]*)/i);
  const suffix = value.match(/(-?\d[\d\s.,]*)\s*(PLN|EUR|USD|GBP|AUD|CAD|CHF|CZK)\b/i);
  const amount = parseAmount(prefix?.[2] ?? suffix?.[1] ?? '');
  const currency = prefix?.[1] ?? suffix?.[2];
  return amount === null || !currency ? null : { amount, currency: currency.toUpperCase() };
};

const readLabel = (text: string, label: string): string | undefined => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const amount = '-?\\d[\\d.,]*(?:\\s\\d{3})*(?:[.,]\\d{1,2})?';
  return text.match(new RegExp(`(?:^|\\s)${escaped}\\s*:?\\s*((?:PLN|EUR|USD|GBP|AUD|CAD|CHF|CZK)\\s*${amount}|${amount}\\s*(?:PLN|EUR|USD|GBP|AUD|CAD|CHF|CZK))`, 'i'))?.[1];
};
const subjectDetails = (subject: string): { id: string; status: BookingStatus; refund: boolean } | null => {
  // Only operational subjects, never customer/support replies, refund requests or marketing.
  if (/\b(?:request(?:ed)?|pending|failed)\b/i.test(subject) && /refund/i.test(subject)) return null;
  const id = subject.match(/\b(R[A-Z0-9]{6,20})\b/i)?.[1]?.toUpperCase();
  if (!id) return null;
  if (/^(?:Last minute\s*-\s*)?New (?:Confirmed|Pending) order\b/i.test(subject)) {
    return { id, status: /New Pending/i.test(subject) ? 'pending' : 'confirmed', refund: false };
  }
  if (/^(?:Order\b.*\b(?:cancelled|canceled)|Cancellation (?:for|of) order)\b/i.test(subject)) {
    return { id, status: 'cancelled', refund: false };
  }
  if (/^(?:(?:Order|Booking)\b.*\b(?:amended|updated|modified|changed)|(?:Updated|Amended|Modified) order)\b/i.test(subject)) {
    return { id, status: 'amended', refund: false };
  }
  if (/^(?:(?:Partial |Full )?Refund (?:processed|confirmation|completed)\b|Order\b.*\b(?:refunded|refund processed))/i.test(subject)) {
    return { id, status: 'amended', refund: true };
  }
  return null;
};

export class RezdyBookingParser implements BookingEmailParser {
  readonly name = 'rezdy';

  diagnose(context: BookingParserContext) {
    const from = context.from ?? context.headers.from ?? '';
    const mailbox = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
    const sender = /^(?:no-?reply|notifications)@rezdy\.com$/i.test(mailbox);
    const details = subjectDetails(context.subject ?? '');
    return {
      name: this.name,
      canParse: sender && Boolean(details),
      canParseChecks: [
        { label: 'Rezdy notification sender', passed: sender },
        { label: 'operational order subject with reference', passed: Boolean(details) },
      ],
    };
  }

  canParse(context: BookingParserContext): boolean { return this.diagnose(context).canParse; }

  async parse(context: BookingParserContext): Promise<ParsedBookingEvent | null> {
    if (!this.canParse(context)) return null;
    const details = subjectDetails(context.subject ?? '')!;
    const html = context.htmlBody ?? '';
    const structuredHtml = html.replace(/(<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>)([\s\S]*?)(?=<h[1-6]\b|$)/gi,
      (section, heading: string) => /^Special Requirements$/i.test(plain(heading)) ? heading : section);
    // The plain alternative omits product names AND supplier commission in real Rezdy emails.
    const text = html ? plain(structuredHtml) : normalize(context.textBody || context.rawTextBody || '');
    const headings = [...structuredHtml.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((m) => plain(m[1]));
    const products = headings.map((heading) => heading.match(/^(.+?)\s+\((P[A-Z0-9_-]{3,})\)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match));
    const product = products[0];
    const source: RezdySource = {
      orderId: details.id,
      agent: /\b(?:Agent|Reseller)\s+(?:Name\s*)?:?\s*Viator\b/i.test(text)
        || /\bViator\s+VIATOR\b/i.test(text) || /\bAgent Notes\s*:?\s*Viator\s*#/i.test(text)
        || /\bfrom Viator\s*$/i.test(context.subject ?? '') ? 'viator' : null,
      viatorReference: text.match(/\bViator\s+(?:Booking\s+)?Reference\s*:?\s*(?:BR[- ]?)?([A-Z0-9-]{5,})\b/i)?.[1] ?? null,
      productCode: product?.[2] ?? text.match(/Product Code\s*:?\s*([A-Z0-9_-]+)/i)?.[1] ?? null,
    };
    if (source.agent === 'viator' && !source.viatorReference) {
      source.viatorReference = text.match(/\b(?:Agent|Reseller)\s+(?:Booking\s+)?Reference\s*:?\s*(?:BR[- ]?)?([A-Z0-9-]{5,})\b/i)?.[1] ?? null;
    }
    if (source.viatorReference) {
      source.viatorReference = `BR-${source.viatorReference.replace(/^BR-/i, '').toUpperCase()}`;
      source.agent = 'viator';
    }
    const fields: BookingFieldPatch = {};
    const productName = product?.[1] ?? text.match(/\bProduct(?: Name)?\s*:\s*(.+?)(?=\s+(?:Product Code|Starts|Experience Date|Date|Item Summary)\b|$)/i)?.[1];
    if (productName) fields.productName = productName;
    if (source.productCode) fields.productVariant = source.productCode;

    const dateMatch = text.match(/New (?:Experience )?Date\s*:?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i)
      ?? text.match(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i)
      ?? text.match(/(?:New (?:Experience )?Date|Experience Date|Starts)\s*:?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    if (dateMatch) {
      const zone = (getConfigValue('REZDY_TIMEZONE') as string | null)
        ?? (getConfigValue('BOOKING_PARSER_TIMEZONE') as string | null) ?? 'Europe/Warsaw';
      const wallClock = `${dateMatch[1]} ${dateMatch[2].toUpperCase()}`;
      const parsed = dayjs(wallClock, 'MMMM D, YYYY h:mm A', true);
      if (parsed.isValid()) {
        const scheduled = dayjs.tz(wallClock, 'MMMM D, YYYY h:mm A', zone);
        if (scheduled.format('MMMM D, YYYY h:mm A') === parsed.format('MMMM D, YYYY h:mm A')) {
          fields.experienceDate = scheduled.format('YYYY-MM-DD');
          fields.experienceStartAt = scheduled.toDate();
        } else source.validationError = 'Departure falls in a timezone clock-change gap; manual review required';
      }
      else source.validationError = 'Invalid Rezdy departure date/time; manual review required';
    }
    const itemSection = text.split(/Item Summary/i)[1]?.split(/\b(?:Connect With Us|Payment History)\b/i)[0] ?? '';
    const quantities = [...itemSection.matchAll(/\b(\d+)\s+(Participants?|Adults?|Children|Child|Infants?)\b/gi)];
    const newCount = text.match(/New (?:Number of )?Participants\s*:?\s*(\d+)\b/i);
    if (newCount) {
      fields.partySizeTotal = fields.partySizeAdults = Number(newCount[1]);
    } else if (quantities.length) {
      fields.partySizeTotal = quantities.reduce((sum, m) => sum + Number(m[1]), 0);
      fields.partySizeChildren = quantities.filter((m) => /child|infant/i.test(m[2])).reduce((sum, m) => sum + Number(m[1]), 0);
      fields.partySizeAdults = fields.partySizeTotal - fields.partySizeChildren;
    } else {
      const count = text.match(/(?:New )?(?:Number of Participants|Participants)\s*:\s*(\d+)\b/i);
      if (count) fields.partySizeTotal = fields.partySizeAdults = Number(count[1]);
    }
    if (itemSection) {
      const extras = { cocktails: 0, photos: 0, tshirts: 0 };
      for (const [key, label] of [['cocktails', '(?:Unlimited (?:Crafted )?)?Cocktails?'],
        ['photos', '(?:Instant )?Photos?'], ['tshirts', 'T-?Shirts?']] as const) {
        for (const match of itemSection.matchAll(new RegExp(`\\b(\\d+)\\s+${label}\\b`, 'gi'))) extras[key] += Number(match[1]);
      }
      fields.addonsSnapshot = { extras };
    }
    const name = text.match(/(?:^|\s)Name\s*:?\s+(.+?)(?=\s+Email\b)/i)?.[1];
    if (name) {
      const [first, ...last] = name.split(/\s+/);
      fields.guestFirstName = first;
      fields.guestLastName = last.join(' ') || null;
    }
    const email = text.match(/\bEmail\s*:?\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i)?.[1];
    const phone = text.match(/\b(?:Mobile|Phone)\s*:?\s+(\+?[\d() -]{6,})(?=\s+[A-Za-z]|$)/i)?.[1];
    if (email) fields.guestEmail = email;
    if (phone) fields.guestPhone = phone.trim();

    // Read the summary BEFORE free-form customer notes / payment history to avoid quoted amounts.
    const summary = text.split(/\b(?:Special Requirements|Payment History|Best Regards)\b/i)[0];
    for (const [label, key] of [['Order Total', 'grossTotal'], ['Commission', 'commission'], ['Total Paid', 'totalPaid'],
      ['Total Refunded', 'refundTotal'], ['Refund Amount', 'refundAmount']] as const) {
      const money = parseMoney(readLabel(summary, label));
      if (money) {
        source[key] = money.amount;
        if (key === 'refundTotal' || key === 'refundAmount') source.refundCurrency = money.currency;
        else if (fields.currency && fields.currency !== money.currency) source.validationError = 'Mixed-currency order summary requires manual review';
        else fields.currency = money.currency;
      }
    }
    const supplierNet = parseMoney(readLabel(summary, 'Supplier Net')
      ?? (source.agent === 'viator' ? readLabel(summary, 'Net amount') : undefined));
    if (supplierNet) {
      source.netTotal = supplierNet.amount;
      if (fields.currency && fields.currency !== supplierNet.currency) source.validationError = 'Supplier net currency differs from order currency';
    }
    const discount = parseMoney(readLabel(summary, 'Total Discount'));
    if (discount) fields.discountAmount = discount.amount;
    const refundReference = summary.match(/Refund (?:Reference|ID|Transaction ID)\s*:?\s*([A-Z0-9_-]+)/i)?.[1];
    if (refundReference) source.refundReference = refundReference;
    const bodyOrderIds = [...summary.matchAll(/\b(?:order(?: number)?\s*[:,]?\s*)(R[A-Z0-9]{6,20})\b/gi)].map((m) => m[1].toUpperCase());
    if (bodyOrderIds.some((id) => id !== details.id)) source.validationError = 'Order reference in the subject does not match the order body';
    const orderedItems = Number(summary.match(/\bItems Ordered\s*:?\s*(\d+)\b/i)?.[1] ?? 1);
    if (products.length > 1 || orderedItems > 1) {
      source.validationError = 'Multi-item Rezdy orders require manual review; no items were imported';
    }
    if (details.refund && source.refundTotal === undefined && (source.refundAmount === undefined || !source.refundReference)) {
      source.validationError = 'Confirmed refund needs Total Refunded or Refund Amount with a unique Refund Reference';
    }
    if (source.refundCurrency && fields.currency && source.refundCurrency !== fields.currency) {
      source.validationError = 'Refund currency differs from order currency; manual review required';
    }
    const eventType = details.status === 'cancelled' ? 'cancelled' : details.status === 'amended' ? 'amended' : 'created';
    if (eventType === 'created' && (!fields.productName || !fields.experienceStartAt || !fields.partySizeTotal
      || source.grossTotal === undefined || !fields.currency)) {
      source.validationError = 'New Rezdy order is missing product, departure, participants or order total (HTML may be missing)';
    }
    return {
      platform: 'rezdy', platformBookingId: details.id, platformOrderId: details.id,
      status: details.status, eventType, bookingFields: fields,
      occurredAt: context.receivedAt ?? context.internalDate ?? null,
      sourceReceivedAt: context.receivedAt ?? context.internalDate ?? null,
      rawPayload: { rezdy: source },
      notes: `Parsed from Rezdy order ${details.id}${source.agent ? `; reseller: ${source.agent}` : ''}.`,
    };
  }
}
