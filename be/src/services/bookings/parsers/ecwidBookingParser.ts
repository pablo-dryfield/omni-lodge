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
const ECWID_TIMEZONE =
  (getConfigValue('ECWID_TIMEZONE') as string | null) ?? DEFAULT_BOOKING_TIMEZONE;

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeMeridiem = (value: string): string =>
  value
    .replace(/A\s*\.?\s*M\.?/gi, 'AM')
    .replace(/P\s*\.?\s*M\.?/gi, 'PM');

const DEFAULT_LABEL_TERMINATORS = [
  'Full Name',
  'Phone Number',
  'Group Time',
  'Activity Time',
  'Activity Date',
  'Time',
  'Date',
  'Meeting Point',
  'Price per item',
  'Quantity',
  'Subtotal',
  'Total',
  'Items',
  'Man',
  'Woman',
];

const extractLabeledValue = (
  text: string,
  label: string,
  terminators: string[] = DEFAULT_LABEL_TERMINATORS,
): string | null => {
  if (!text) {
    return null;
  }

  const escapedLabel = escapeRegex(label);
  const terminatorPattern = terminators
    .filter((term) => term.toLowerCase() !== label.toLowerCase())
    .map((term) => escapeRegex(term))
    .join('|');

  if (!terminatorPattern) {
    const simpleMatch = text.match(new RegExp(`${escapedLabel}\\s*:\\s*(.+?)\\s*$`, 'i'));
    return simpleMatch?.[1]?.trim() ?? null;
  }

  const matcher = new RegExp(
    `${escapedLabel}\\s*:\\s*(.+?)(?=\\s+(?:${terminatorPattern})\\s*:|\\s+(?:${terminatorPattern})\\b|\\s*$)`,
    'i',
  );
  const match = text.match(matcher);
  return match?.[1]?.trim() ?? null;
};

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
  const match = text.match(
    /Customer\s+(.+?)\s+(?:Pickup Details|Pickup date and time|Billing Info|Billing information)/i,
  );
  return match?.[1]?.trim() ?? null;
};

const parseEmail = (input: string | null): string | null => {
  if (!input) {
    return null;
  }
  const match = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? null;
};

const parsePhone = (input: string | null, email?: string | null): string | null => {
  if (!input) {
    return null;
  }
  let normalized = input.replace(/\u00a0/g, ' ');
  if (email) {
    normalized = normalized.split(email).join(' ');
  }
  const labeledMatch = normalized.match(/(?:phone|tel|mobile)[:\s]+([+0-9()[\]\s.-]+)/i);
  const haystack = labeledMatch?.[1] ?? normalized;
  const matches = Array.from(haystack.matchAll(/(\+?\d[\d\s().-]{5,})/g)).map((entry) => entry[1]);
  if (matches.length === 0) {
    return null;
  }
  const normalizedMatches = matches.filter((value) => value.replace(/\D+/g, '').length >= 7);
  if (normalizedMatches.length === 0) {
    return null;
  }
  let phone =
    normalizedMatches.find((value) => value.trim().startsWith('+')) ??
    normalizedMatches.find((value) => value.replace(/\D+/g, '').length >= 9) ??
    normalizedMatches[0];
  const extIndex = phone.toLowerCase().indexOf('ext');
  if (extIndex !== -1) {
    phone = phone.slice(0, extIndex);
  }
  phone = phone.replace(/[().-]/g, ' ');
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
  candidate = candidate.replace(/\+?\d[\d\s().-]{5,}/g, ' ');
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

type ParsedAddonRow = {
  label: string;
  rawValue: string;
  quantity: number;
  category: 'cocktails' | 'tshirts' | 'photos' | null;
};

type ParsedAddonCounters = {
  cocktails: number;
  tshirts: number;
  photos: number;
};

const parseItemQuantity = (text: string): number => {
  const match = text.match(/Quantity:\s*(\d+)/i);
  if (!match) {
    return 1;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) || parsed <= 0 ? 1 : parsed;
};

const detectAddonCategory = (label: string): ParsedAddonRow['category'] => {
  const normalized = label.toLowerCase();
  if (normalized.includes('cocktail') || normalized.includes('drink')) {
    return 'cocktails';
  }
  if (normalized.includes('photo')) {
    return 'photos';
  }
  if (normalized.includes('shirt') || normalized.includes('tee')) {
    return 'tshirts';
  }
  return null;
};

const parseAddonQuantity = (value: string): number => {
  const digitMatch = value.replace(/[,]/g, '').match(/(-?\d+)/);
  if (digitMatch) {
    const parsed = Number.parseInt(digitMatch[1], 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  if (/yes/i.test(value)) {
    return 1;
  }
  return 0;
};

const parseAddonRows = (text: string): ParsedAddonRow[] => {
  if (!text) {
    return [];
  }

  const normalized = text.replace(/\r\n/g, '\n');
  const pattern =
    /([A-Za-z][A-Za-z\s-]*Add-On):\s*([\s\S]*?)(?=(?:\s+[A-Za-z][A-Za-z\s-]*Add-On:|\s+Price per item|\s+Quantity:|\s+Subtotal|$))/gi;

  const rows: ParsedAddonRow[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized))) {
    const label = match[1].trim();
    const rawValue = match[2].replace(/\s+/g, ' ').trim();
    rows.push({
      label,
      rawValue,
      quantity: parseAddonQuantity(rawValue),
      category: detectAddonCategory(label),
    });
  }

  return rows;
};

const summarizeAddonCategories = (rows: ParsedAddonRow[]): ParsedAddonCounters => {
  return rows.reduce<ParsedAddonCounters>(
    (acc, row) => {
      if (row.category && row.quantity > 0) {
        acc[row.category] += row.quantity;
      }
      return acc;
    },
    { cocktails: 0, tshirts: 0, photos: 0 },
  );
};

const parsePickupLocation = (text: string): string | null => {
  const match = text.match(/Meeting Point\s+(.+?)\s+Time/i);
  if (match?.[1]) {
    return match[1].trim();
  }
  return extractLabeledValue(text, 'Meeting Point');
};

const parsePickupDate = (text: string): string | null => {
  const match = text.match(
    /Pickup date and time:? ([A-Za-z]+ \d{1,2}, \d{4}(?:\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)?)/i,
  );
  if (match?.[1]) {
    return match[1].trim();
  }
  const activityDate = extractLabeledValue(text, 'Activity Date');
  if (activityDate) {
    return activityDate;
  }
  const pickupDate = extractLabeledValue(text, 'Pickup Date');
  if (pickupDate) {
    return pickupDate;
  }
  return extractLabeledValue(text, 'Date');
};

const parsePickupTime = (text: string): string | null => {
  const activityTime = extractLabeledValue(text, 'Activity Time');
  if (activityTime) {
    return normalizeMeridiem(activityTime).trim();
  }
  const pickupTime = extractLabeledValue(text, 'Pickup Time');
  if (pickupTime) {
    return normalizeMeridiem(pickupTime).trim();
  }
  const labeledTime = extractLabeledValue(text, 'Time');
  if (labeledTime) {
    return normalizeMeridiem(labeledTime).trim();
  }
  const pickupLineMatch = text.match(
    /Pickup date and time:? [A-Za-z]+\s+\d{1,2},\s+\d{4}[,\s]+(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
  );
  if (pickupLineMatch?.[1]) {
    return normalizeMeridiem(pickupLineMatch[1]).trim();
  }
  const labeled = extractLabeledValue(text, 'Group Time');
  return labeled ? normalizeMeridiem(labeled).trim() : null;
};

const parsePickupLineTime = (text: string): string | null => {
  const pickupLineMatch = text.match(
    /Pickup date and time:? [A-Za-z]+\s+\d{1,2},\s+\d{4}[,\s]+(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
  );
  if (pickupLineMatch?.[1]) {
    return normalizeMeridiem(pickupLineMatch[1]).trim();
  }
  return null;
};

const parsePubCrawlDetailsTime = (text: string): string | null => {
  const match = text.match(/Pub Crawl Details[\s\S]*?Time\s+([\d:.]+\s*(?:A\.M\.|P\.M\.|AM|PM)?)/i);
  if (match?.[1]) {
    return normalizeMeridiem(match[1]).trim();
  }
  return null;
};

type EcwidItemBlock = {
  block: string;
  price: number | null;
  currency: string | null;
  quantity: number;
};

const extractItemsSection = (text: string): string | null => {
  const match = text.match(/Items\s+([\s\S]+?)(?:\s+Subtotal\b|\s+Shipping\b|\s+Discount\b|\s+Total\b|\s+Customer\b|$)/i);
  return match?.[1]?.trim() ?? null;
};

const splitItemBlocks = (section: string | null): EcwidItemBlock[] => {
  if (!section) {
    return [];
  }

  const pattern = /Price per item:\s*([\d\s.,-]+)\s*([^\s\d]+)?\s*Quantity:\s*(\d+)/gi;
  const blocks: EcwidItemBlock[] = [];
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = pattern.exec(section))) {
    const endIndex = match.index + match[0].length;
    const block = section.slice(lastIndex, endIndex).trim();
    const price = parseNumber(match[1]) ?? null;
    const currency = currencyFromToken(match[2] ?? null);
    const quantity = Number.parseInt(match[3], 10);
    blocks.push({
      block,
      price,
      currency,
      quantity: Number.isNaN(quantity) || quantity <= 0 ? 1 : quantity,
    });
    lastIndex = endIndex;
  }

  return blocks;
};

const parseProductNameFromBlock = (block: string): string | null => {
  if (!block) {
    return null;
  }
  const match = block.match(
    /^(.+?)(?:\s+(?:Man:|Woman:|Packages?:|Activity Date:|Activity Time:|Pickup Date:|Pickup Time:|Date:|Time:|Phone Number:|Vehicle Type:|Full Name:|Flight Number:|Price per item:|Quantity:|Subtotal|Total)\b|$)/i,
  );
  return match?.[1]?.trim() ?? null;
};

const parseVariantFromBlock = (block: string): string | null => {
  const packageLabel = extractLabeledValue(block, 'Packages') ?? extractLabeledValue(block, 'Package');
  const vehicleType = extractLabeledValue(block, 'Vehicle Type');
  const parts = [packageLabel, vehicleType].filter(Boolean);
  return parts.length > 0 ? parts.join(' | ') : null;
};

const buildExperienceMoment = (dateRaw: string | null, timeRaw: string | null): { experienceDate: string | null; startAt: Date | null } => {
  if (!dateRaw) {
    return { experienceDate: null, startAt: null };
  }
  let normalizedDate = dateRaw.replace(/\s+/g, ' ').trim();
  let normalizedTime = timeRaw
    ? normalizeMeridiem(timeRaw).replace(/CEST|CET|UTC|GMT/gi, '').trim()
    : null;
  const dateTimeMatch = normalizedDate.match(
    /([A-Za-z]+\s+\d{1,2},\s+\d{4})(?:[,\s]+(\d{1,2}:\d{2}\s*(?:AM|PM)?))?/i,
  );
  if (dateTimeMatch) {
    normalizedDate = dateTimeMatch[1].trim();
    if (!normalizedTime && dateTimeMatch[2]) {
      normalizedTime = normalizeMeridiem(dateTimeMatch[2]).trim();
    }
  }
  const dateFormats = ['MMM D, YYYY', 'MMMM D, YYYY', 'YYYY-MM-DD', 'YYYY/MM/DD'];
  const usesAmPm = normalizedTime ? /am|pm/i.test(normalizedTime) : false;
  const timeFormats = normalizedTime ? (usesAmPm ? ['h:mm A'] : ['H:mm']) : [];
  for (const format of dateFormats) {
    let datePart: dayjs.Dayjs | null = null;
    try {
      const parsed = dayjs.tz(normalizedDate, format, ECWID_TIMEZONE);
      datePart = parsed.isValid() ? parsed : null;
    } catch {
      datePart = null;
    }
    if (!datePart) {
      continue;
    }
    if (!normalizedTime) {
      return { experienceDate: datePart.format('YYYY-MM-DD'), startAt: null };
    }
    for (const timeFormat of timeFormats) {
      let combined: dayjs.Dayjs | null = null;
      try {
        const parsed = dayjs.tz(
          `${datePart.format('YYYY-MM-DD')} ${normalizedTime}`,
          `YYYY-MM-DD ${timeFormat}`,
          ECWID_TIMEZONE,
        );
        combined = parsed.isValid() ? parsed : null;
      } catch {
        combined = null;
      }
      if (combined) {
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

  private buildDiagnostics(context: BookingParserContext): BookingParserDiagnostics {
    const subject = context.subject ?? '';
    const from = context.from ?? context.headers.from ?? '';
    const isForwarded = subject.toLowerCase().startsWith('fwd:');
    const fromMatch = /ecwid/i.test(from);
    const subjectMatch = /new order #/i.test(subject);
    const text = context.textBody || context.rawTextBody || context.snippet || '';
    const orderMatch = text.match(/New order\s+#([A-Z0-9]+)/i);

    const canParseChecks: BookingParserCheck[] = [
      { label: 'subject starts with "fwd:"', passed: !isForwarded, value: subject },
      { label: 'from matches /ecwid/i', passed: fromMatch, value: from },
      { label: 'subject matches /new order #/i', passed: subjectMatch, value: subject },
    ];

    const parseChecks: BookingParserCheck[] = [
      { label: 'text body present', passed: Boolean(text) },
      { label: 'order id matched /New order #/i', passed: Boolean(orderMatch), value: orderMatch?.[1] ?? null },
    ];

    return {
      name: this.name,
      canParse: !isForwarded && (fromMatch || subjectMatch),
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
    const text = context.textBody || context.rawTextBody || context.snippet || '';
    if (!text) {
      return null;
    }

    const orderMatch = text.match(/New order\s+#([A-Z0-9]+)/i);
    if (!orderMatch) {
      return null;
    }
    const orderId = orderMatch[1].trim();

    const totals = parseOrderTotals(text);
    const subjectProductMatch = (context.subject ?? '').match(/^(.+?)\s*:\s*New order/i);
    const itemsSection = extractItemsSection(text);
    const itemBlocks = splitItemBlocks(itemsSection);
    const fallbackBlocks: EcwidItemBlock[] = itemBlocks.length > 0
      ? itemBlocks
      : [{
          block: itemsSection ?? text,
          price: null,
          currency: totals.currency,
          quantity: parseItemQuantity(text),
        }];
    const overallPickupDate = parsePickupDate(text);
    const overallPickupTime = parsePickupLineTime(text);
    const pubCrawlDetailsTime = parsePubCrawlDetailsTime(text);
    const location = parsePickupLocation(text);

    const customerSection = extractCustomerSection(text);
    const email = parseEmail(customerSection) ?? parseEmail(text);
    const phone = parsePhone(customerSection, email) ?? extractLabeledValue(text, 'Phone Number');
    const labeledFullName = extractLabeledValue(text, 'Full Name');
    const customerName =
      labeledFullName ?? parseNameFromCustomerSection(customerSection, email, phone);
    const nameParts = customerName ? customerName.split(/\s+/) : [];
    const firstName = nameParts.shift() ?? null;
    const lastName = nameParts.length > 0 ? nameParts.join(' ') : null;

    const paymentMethodMatch = text.match(/Payment method\s+([A-Za-z ]+)/i);
    const paymentMethod =
      paymentMethodMatch?.[1]?.replace(/View order details/i, '').trim() ?? null;

    const paymentStatus = /paid/i.test(context.subject ?? '') || /paid/i.test(text) ? 'paid' : 'unknown';

    const buildEvent = (item: EcwidItemBlock, index: number): ParsedBookingEvent => {
      const itemQuantity = item.quantity > 0 ? item.quantity : parseItemQuantity(item.block);
      const party = parsePartySize(item.block);
      let scaledParty = { ...party };
      let addonRows = parseAddonRows(item.block);
      if (itemQuantity > 1) {
        const scale = (value: number | null): number | null => (value !== null ? value * itemQuantity : null);
        scaledParty = {
          men: scale(party.men),
          women: scale(party.women),
          total: null,
        };
        if (scaledParty.men !== null || scaledParty.women !== null) {
          const menCount = scaledParty.men ?? 0;
          const womenCount = scaledParty.women ?? 0;
          scaledParty.total = menCount + womenCount;
        } else {
          scaledParty.total = scale(party.total);
        }
        addonRows = addonRows.map((row) => ({
          ...row,
          quantity: row.quantity * itemQuantity,
        }));
      }
      if (scaledParty.total === null && party.men === null && party.women === null && itemQuantity > 0) {
        scaledParty = {
          ...scaledParty,
          total: itemQuantity,
        };
      }

      const productName =
        parseProductNameFromBlock(item.block) ??
        (index === 0 ? subjectProductMatch?.[1]?.trim() ?? null : null);
      const isPubCrawl = productName ? productName.toLowerCase().includes('pub crawl') : false;
      const productVariant = parseVariantFromBlock(item.block);
      const pickupDate = parsePickupDate(item.block) ?? overallPickupDate;
      let pickupTime = parsePickupTime(item.block);
      if (!pickupTime && isPubCrawl) {
        pickupTime = pubCrawlDetailsTime ?? overallPickupTime ?? '21:00';
      }
      const experienceMoment = buildExperienceMoment(pickupDate, pickupTime);
      const addonCounters = summarizeAddonCategories(addonRows);
      const addonsNote =
        addonRows.length > 0
          ? addonRows.map((row) => `${row.label}: ${row.rawValue}`).join(' | ')
          : null;
      const flightNumber = extractLabeledValue(item.block, 'Flight Number');
      const notesParts = [addonsNote, flightNumber ? `Flight Number: ${flightNumber}` : null].filter(Boolean);
      const itemTotal =
        item.price !== null
          ? item.price * itemQuantity
          : fallbackBlocks.length === 1
            ? totals.total
            : null;
      const currency = item.currency ?? totals.currency ?? 'PLN';

      const addonsSnapshot: Record<string, unknown> = {};
      if (scaledParty.men !== null || scaledParty.women !== null) {
        addonsSnapshot.partyBreakdown = {
          men: scaledParty.men,
          women: scaledParty.women,
        };
      }
      if (addonRows.length > 0) {
        addonsSnapshot.addons = addonRows;
      }
      if (Object.values(addonCounters).some((count) => count > 0)) {
        addonsSnapshot.extras = addonCounters;
      }

      const bookingFields: BookingFieldPatch = {
        productName,
        productVariant,
        guestFirstName: firstName,
        guestLastName: lastName,
        guestEmail: email,
        guestPhone: phone,
        experienceDate: experienceMoment.experienceDate,
        experienceStartAt: experienceMoment.startAt,
        partySizeTotal: scaledParty.total,
        partySizeAdults: scaledParty.total,
        currency,
        priceGross: itemTotal,
        priceNet: itemTotal,
        baseAmount: itemTotal,
        paymentMethod,
        pickupLocation: location,
        notes: notesParts.length > 0 ? notesParts.join(' | ') : null,
      };
      if (Object.keys(addonsSnapshot).length > 0) {
        bookingFields.addonsSnapshot = addonsSnapshot;
      }

      const normalizedAddons =
        addonRows
          .filter((row) => row.quantity > 0)
          .map((row) => ({
            platformAddonName: row.label,
            quantity: row.quantity,
            metadata: {
              category: row.category ?? undefined,
              rawValue: row.rawValue,
            },
          })) ?? [];

      return {
        platform: 'ecwid',
        platformBookingId: index === 0 ? orderId : `${orderId}-${index + 1}`,
        platformOrderId: orderId,
        eventType: 'created',
        status: 'confirmed',
        paymentStatus,
        addons: normalizedAddons.length > 0 ? normalizedAddons : undefined,
        bookingFields,
        occurredAt: context.receivedAt ?? context.internalDate ?? null,
        sourceReceivedAt: context.receivedAt ?? context.internalDate ?? null,
      };
    };

    const baseEvent = buildEvent(fallbackBlocks[0], 0);
    if (fallbackBlocks.length > 1) {
      baseEvent.spawnedEvents = fallbackBlocks.slice(1).map((item, index) => buildEvent(item, index + 1));
    }

    return baseEvent;
  }
}
