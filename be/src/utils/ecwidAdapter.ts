import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { EcwidOrder, EcwidOrderItem, EcwidOption, EcwidOptionSelection } from '../services/ecwidService.js';
import { ManifestGroup, OrderExtras, UnifiedOrder, UnifiedProduct } from '../types/booking.js';

const STORE_TIMEZONE = process.env.ECWID_STORE_TIMEZONE ?? 'Europe/Warsaw';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.tz.setDefault(STORE_TIMEZONE);

type GenderCounters = { men: number; women: number };

type EcwidSelection = NonNullable<EcwidOption['selections']>[number];

const TIME_PATTERN = /^(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?(?:am|pm|a\.m\.|p\.m\.))?$/i;
const DATE_TIME_PATTERN = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/;
const CUSTOM_FORMATS = [
  'YYYY-MM-DD HH:mm:ssZ',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DD HH:mm',
  'YYYY/MM/DD HH:mm',
  'DD/MM/YYYY HH:mm',
  'DD-MM-YYYY HH:mm',
  'dddd, D MMMM YYYY HH:mm',
  'ddd, D MMM YYYY HH:mm',
];

const OFFSET_TOKEN_PATTERN = /([+\-]\d{2}:?\d{2}|Z)$/i;
const MEN_LABELS = ['men', 'man', 'male', 'boys', 'boy', 'gents', 'gent', 'guys', 'guy'];
const WOMEN_LABELS = ['women', 'woman', 'female', 'girls', 'girl', 'ladies', 'lady'];

const sanitizeTimeToken = (value: string): string => {
  return value
    .replace(/\b(?:CEST|CET|BST|GMT|UTC)\b/gi, '')
    .replace(/\b(?:hrs?|hours?)\b/gi, '')
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const parseFormatToStore = (input: string, format: string): Dayjs | null => {
  const parsed = dayjs(input, format, true);
  if (!parsed.isValid()) {
    return null;
  }
  return parsed.tz(STORE_TIMEZONE);
};

const normalizeLabel = (value?: string | null): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const trimmed = String(value).trim().toLowerCase();
  return trimmed ? trimmed : undefined;
};

const includesKeyword = (subject: string | undefined, keywords: string[]): boolean => {
  if (!subject) {
    return false;
  }
  const tokens = subject.split(/[^a-z0-9]+/g).filter(Boolean);
  return tokens.some((token) => keywords.includes(token));
};

const hasUsableValue = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
};

const getSelectionRawName = (selection: EcwidSelection): string | undefined => {
  const typed = selection as EcwidOptionSelection;
  const label = typed?.name ?? typed?.selectionTitle;
  if (label === undefined || label === null) {
    return undefined;
  }
  const trimmed = String(label).trim();
  return trimmed ? trimmed : undefined;
};

const getSelectionLabel = (selection: EcwidSelection): string | undefined => {
  return normalizeLabel(getSelectionRawName(selection));
};

const getSelectionValue = (selection: EcwidSelection): unknown => {
  const typed = selection as EcwidOptionSelection;
  if (typed?.value !== undefined && typed.value !== null) {
    return typed.value;
  }
  if (typed?.selectionTitle !== undefined && typed.selectionTitle !== null) {
    return typed.selectionTitle;
  }
  return undefined;
};

const getItemOptions = (item: EcwidOrderItem): EcwidOption[] => {
  if (Array.isArray(item.selectedOptions) && item.selectedOptions.length > 0) {
    return item.selectedOptions.filter(Boolean) as EcwidOption[];
  }
  if (Array.isArray(item.options) && item.options.length > 0) {
    return item.options.filter(Boolean) as EcwidOption[];
  }
  return [];
};

const parseTimeOfDay = (base: Dayjs, timeText: string): Dayjs | null => {
  const sanitized = sanitizeTimeToken(timeText);
  if (!sanitized) {
    return null;
  }
  const upper = sanitized.toUpperCase();
  const baseDate = base.format('YYYY-MM-DD');
  const dateTime = [baseDate, upper].join(' ');
  const formats = ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD H:mm', 'YYYY-MM-DD hh:mm A', 'YYYY-MM-DD h:mm A'];
  for (const format of formats) {
    const candidate = parseFormatToStore(dateTime, format);
    if (candidate) {
      return candidate;
    }
  }
  return null;
};

const isTriviallyInvalid = (s: string) =>
  /^(no|n\/a|null|none|brak|nie|false)$/i.test(s);

const normalizeEcwidTimestamp = (value?: string): Dayjs | null => {
  if (!value) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  // 1) Obvious non-dates
  const isTriviallyInvalid = (s: string) =>
    /^(no|n\/a|null|none|brak|nie|false|invalid|undefined)$/i.test(s);
  if (isTriviallyInvalid(raw)) return null;

  // 2) Heuristic: only attempt parsing if it looks date-like (digits or month names)
  const looksDateLike = (s: string) =>
    /\d/.test(s) ||
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|sty|lut|mar|kwi|maj|cze|lip|sie|wrz|paź|lis|gru)\b/i.test(s);
  if (!looksDateLike(raw)) return null;

  const sanitized = sanitizeTimeToken(raw);

  // 3) Helper: parse strings that include an explicit offset or 'Z'
  const parseWithOffset = (input: string): Dayjs | null => {
    try {
      const parsed = dayjs.utc(input);
      return parsed.isValid() ? parsed.tz(STORE_TIMEZONE) : null;
    } catch {
      return null;
    }
  };
  const tryOffsetVariant = (input: string): Dayjs | null => {
    if (!input) {
      return null;
    }
    const condensed = input
      .replace(/\s+/g, ' ')
      .replace(' ', 'T')
      .replace(/\s([+\-]\d{2})(\d{2})$/, '$1:$2')
      .replace(/\s([+\-]\d{2}:\d{2}|Z)$/i, '$1');
    if (!OFFSET_TOKEN_PATTERN.test(condensed)) {
      return null;
    }
    return parseWithOffset(condensed);
  };


  const offsetParsed =
    tryOffsetVariant(raw) || (sanitized !== raw ? tryOffsetVariant(sanitized) : null);
  if (offsetParsed) {
    return offsetParsed;
  }

  // 4) Try explicit ISO forms first (strict)
  // ISO datetime with or without seconds + offset/Z
  const ISO_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?([Zz]|[+\-]\d{2}:?\d{2})?$/;
  if (ISO_DT_RE.test(raw)) {
    // If an offset/Z is present, trust it; otherwise treat it as local STORE_TIMEZONE
    if (/[Zz]|[+\-]\d{2}:?\d{2}$/.test(raw)) {
      const parsed = parseWithOffset(raw);
      if (parsed) return parsed;
    } else {
      const parsed = dayjs(raw, ['YYYY-MM-DDTHH:mm', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.SSS'], true);
      if (parsed.isValid()) return parsed.tz(STORE_TIMEZONE);
    }
  }

  // 5) Pure ISO date (YYYY-MM-DD): interpret at local midnight in STORE_TIMEZONE
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (ISO_DATE_RE.test(raw)) {
    const parsed = dayjs.tz(`${raw}T00:00`, STORE_TIMEZONE);
    return parsed.isValid() ? parsed : null;
  }

  // 6) Try sanitized variant of the above two
  if (sanitized !== raw) {
    if (ISO_DT_RE.test(sanitized)) {
      if (/[Zz]|[+\-]\d{2}:?\d{2}$/.test(sanitized)) {
        const parsed = parseWithOffset(sanitized);
        if (parsed) return parsed;
      } else {
        const parsed = dayjs(sanitized, ['YYYY-MM-DDTHH:mm', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.SSS'], true);
        if (parsed.isValid()) return parsed.tz(STORE_TIMEZONE);
      }
    }
    if (ISO_DATE_RE.test(sanitized)) {
      const parsed = dayjs.tz(`${sanitized}T00:00`, STORE_TIMEZONE);
      if (parsed.isValid()) return parsed;
    }
  }

  // 7) Known strict custom formats (add two-digit year variants, euro styles, etc.)
  // Keep this list small & strict to avoid accidental mis-parses.
  const STRICT_FORMATS = [
    // Datetime with seconds / no seconds (no offset)
    'YYYY-MM-DD HH:mm:ss',
    'YYYY-MM-DD HH:mm',
    'YYYY/MM/DD HH:mm',
    'DD/MM/YYYY HH:mm',
    'DD-MM-YYYY HH:mm',
    'DD/MM/YY HH:mm',
    'DD-MM-YY HH:mm',
    // Date-only
    'DD/MM/YYYY',
    'DD-MM-YYYY',
    'YYYY/MM/DD',
    'DD/MM/YY',
    'DD-MM-YY',
    // Long forms
    'dddd, D MMMM YYYY HH:mm',
    'ddd, D MMM YYYY HH:mm',
  ] as const;

  const tryStrictFormats = (s: string): Dayjs | null => {
    for (const fmt of STRICT_FORMATS) {
      const d = dayjs(s, fmt as string, true);
      if (d.isValid()) return d.tz(STORE_TIMEZONE);
    }
    return null;
  };

  const strictParsed = tryStrictFormats(raw) || (sanitized !== raw ? tryStrictFormats(sanitized) : null);
  if (strictParsed) return strictParsed;

  // 8) Loose token extraction 'YYYY-MM-DD HH:mm' -> build ISO and parse strictly
  const DATE_TIME_PATTERN = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/;
  const m = raw.match(DATE_TIME_PATTERN) || (sanitized !== raw ? sanitized.match(DATE_TIME_PATTERN) : null);
  const hasExplicitOffset = OFFSET_TOKEN_PATTERN.test(raw) || OFFSET_TOKEN_PATTERN.test(sanitized);
  if (m && !hasExplicitOffset) {
    const candidate = `${m[1]}T${m[2]}`;
    const d = dayjs(candidate, 'YYYY-MM-DDTHH:mm', true);
    if (d.isValid()) return d.tz(STORE_TIMEZONE);
  }

  // 9) Offset normalization (e.g., "+0100" -> "+01:00")
  const corrected = sanitized
    .replace(/\s+/g, ' ')
    .replace(' ', 'T')
    .replace(/\s([+\-]\d{2})(\d{2})$/, '$1:$2')
    .replace(/\s([+\-]\d{2}:\d{2}|Z)$/i, '$1');

  if (OFFSET_TOKEN_PATTERN.test(corrected)) {
    const iso = parseWithOffset(corrected);
    if (iso) return iso;
  }

  // 10) Final rule: DO NOT attempt a generic tz() parse.
  // If we didn’t match anything strictly, return null rather than inventing dates.
  return null;
};

const preferPickupMoment = (order: EcwidOrder, item: EcwidOrderItem): Dayjs | null => {
  const moments: Dayjs[] = [];
  const timeOnly: string[] = [];

  const pushValue = (label: string | undefined, value: unknown) => {
    if (value === null || value === undefined) {
      return;
    }

    const textValue = String(value).trim();
    if (!textValue) {
      return;
    }

    const sanitizedValue = sanitizeTimeToken(textValue);
    const normalized =
      normalizeEcwidTimestamp(textValue) ||
      (sanitizedValue !== textValue ? normalizeEcwidTimestamp(sanitizedValue) : null);
    if (normalized) {
      moments.push(normalized);
      return;
    }

    if (sanitizedValue && TIME_PATTERN.test(sanitizedValue)) {
      if (!timeOnly.includes(sanitizedValue)) {
        timeOnly.push(sanitizedValue);
      }
    }
  };

  const pushOption = (name?: string, value?: unknown) => {
    pushValue(name, value);
  };

  pushValue('pickupTime', order.pickupTime);
  pushValue('itemPickupTime', item.pickupTime);
  pushValue('extraPickupTime', order.extraFields?.ecwid_order_pickup_time);

  getItemOptions(item).forEach((option) => {
    if (!option) {
      return;
    }

    pushOption(option.name, option.value);

    option.selections?.forEach((selection: EcwidSelection) => {
      if (!selection) {
        return;
      }
      const selectionValue = getSelectionValue(selection);
      if (selectionValue === undefined || selectionValue === null) {
        return;
      }
      pushOption(getSelectionRawName(selection), selectionValue);
    });

  });
  order.orderExtraFields?.forEach((field) => {
    if (!field) {
      return;
    }
    pushOption(field.name, field.value);
  });

  if (order.extraFields) {
    Object.entries(order.extraFields).forEach(([key, value]) => pushOption(key, value));
  }

  if (moments.length > 0) {
    return moments.sort((a, b) => a.valueOf() - b.valueOf())[0];
  }

  if (timeOnly.length > 0) {
    const base = normalizeEcwidTimestamp(order.pickupTime ?? item.pickupTime ?? order.extraFields?.ecwid_order_pickup_time);
    if (base) {
      const [hh, mm] = timeOnly[0].split(':').map((part) => Number.parseInt(part, 10));
      if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
        return base.clone().hour(hh).minute(mm).second(0).millisecond(0);
      }
    }
  }

  return null;
};

const countMatches = (text: string, pattern: RegExp): number => {
  let total = 0;
  const iterator = text.matchAll(pattern);
  for (const match of iterator) {
    const value = match[1];
    if (!value) {
      continue;
    }
    const qty = Number.parseInt(String(value), 10);
    if (!Number.isNaN(qty)) {
      total += qty;
    }
  }
  return total;
};

const extractCountsFromText = (raw?: string | number | null): GenderCounters => {
  if (raw === null || raw === undefined) {
    return { men: 0, women: 0 };
  }

  if (typeof raw === 'number') {
    return { men: raw, women: 0 };
  }

  const text = String(raw).toLowerCase();
  const men = countMatches(text, /(\d+)\s*(men|boys|male)/g);
  const women = countMatches(text, /(\d+)\s*(women|girls|female)/g);

  return { men, women };
};
const accumulateGenderCounts = (target: GenderCounters, payload: unknown, explicitGender?: 'men' | 'women') => {
  if (payload === null || payload === undefined) {
    return;
  }

  if (typeof payload === 'number') {
    if (explicitGender === 'women') {
      target.women += payload;
    } else {
      target.men += payload;
    }
    return;
  }

  const numericValue = Number.parseInt(String(payload), 10);
  if (!Number.isNaN(numericValue) && explicitGender) {
    target[explicitGender] += numericValue;
    return;
  }

  const extracted = extractCountsFromText(payload as string | number);
  target.men += extracted.men;
  target.women += extracted.women;
};

const extractGenderCounts = (order: EcwidOrder, item: EcwidOrderItem): GenderCounters => {
  const totals: GenderCounters = { men: 0, women: 0 };

  getItemOptions(item).forEach((option) => {
    if (!option) {
      return;
    }

    const optionLabel = normalizeLabel(option.name);
    const optionValue = option.value;
    const optionHasGender = includesKeyword(optionLabel, MEN_LABELS) || includesKeyword(optionLabel, WOMEN_LABELS);

    if (includesKeyword(optionLabel, MEN_LABELS)) {
      accumulateGenderCounts(totals, optionValue, 'men');
    } else if (includesKeyword(optionLabel, WOMEN_LABELS)) {
      accumulateGenderCounts(totals, optionValue, 'women');
    } else {
      accumulateGenderCounts(totals, optionValue);
    }

    option.selections?.forEach((selection: EcwidSelection) => {
      if (!selection) {
        return;
      }
      const selectionLabel = getSelectionLabel(selection);
      const selectionValue = getSelectionValue(selection);
      if (!hasUsableValue(selectionValue)) {
        return;
      }

      if (includesKeyword(selectionLabel, MEN_LABELS)) {
        accumulateGenderCounts(totals, selectionValue, 'men');
      } else if (includesKeyword(selectionLabel, WOMEN_LABELS)) {
        accumulateGenderCounts(totals, selectionValue, 'women');
      } else if (!optionHasGender) {
        accumulateGenderCounts(totals, selectionValue);
      }
    });
  });

  order.orderExtraFields?.forEach((field) => {
    if (!field) {
      return;
    }
    const fieldLabel = normalizeLabel(field.name);
    if (includesKeyword(fieldLabel, MEN_LABELS)) {
      accumulateGenderCounts(totals, field.value, 'men');
    } else if (includesKeyword(fieldLabel, WOMEN_LABELS)) {
      accumulateGenderCounts(totals, field.value, 'women');
    } else {
      accumulateGenderCounts(totals, field.value);
    }
  });

  if (order.extraFields) {
    Object.entries(order.extraFields).forEach(([key, value]) => {
      const keyLabel = normalizeLabel(key);
      if (includesKeyword(keyLabel, MEN_LABELS)) {
        accumulateGenderCounts(totals, value, 'men');
      } else if (includesKeyword(keyLabel, WOMEN_LABELS)) {
        accumulateGenderCounts(totals, value, 'women');
      }
    });
  }

  return totals;
};

const detectAddonKind = (label: string): keyof OrderExtras | null => {
  const normalized = label.toLowerCase();
  if (normalized.includes('t-shirt') || normalized.includes('tshirt') || normalized.includes('shirt') || normalized.includes('tee')) {
    return 'tshirts';
  }
  if (normalized.includes('cocktail') || normalized.includes('drink')) {
    return 'cocktails';
  }
  if (normalized.includes('photo') || normalized.includes('picture')) {
    return 'photos';
  }
  return null;
};

const parseQuantity = (payload: unknown): number => {
  if (payload === null || payload === undefined) {
    return 0;
  }
  if (typeof payload === 'number') {
    return Number.isNaN(payload) ? 0 : payload;
  }
  const match = String(payload).match(/\d+/);
  if (match) {
    const value = Number.parseInt(match[0], 10);
    return Number.isNaN(value) ? 0 : value;
  }
  return 0;
};

const accumulateExtras = (target: OrderExtras, kind: keyof OrderExtras, payload: unknown) => {
  const qty = parseQuantity(payload);
  if (qty > 0) {
    target[kind] += qty;
  }
};

const inspectAddonEntry = (target: OrderExtras, name?: string, value?: unknown) => {
  const labelKind = name ? detectAddonKind(name) : null;
  if (labelKind) {
    accumulateExtras(target, labelKind, value);
  } else if (typeof value === 'string') {
    const valueKind = detectAddonKind(value);
    if (valueKind) {
      accumulateExtras(target, valueKind, value);
    }
  }
};

const extractAddonCounts = (order: EcwidOrder, item: EcwidOrderItem): OrderExtras => {
  const extras: OrderExtras = { tshirts: 0, cocktails: 0, photos: 0 };

  getItemOptions(item).forEach((option) => {
    if (!option) {
      return;
    }

    const optionName = option.name?.trim() ?? undefined;
    const hasSelections = Array.isArray(option.selections) && option.selections.length > 0;

    if (!hasSelections) {
      inspectAddonEntry(extras, optionName, option.value);
    }

    option.selections?.forEach((selection: EcwidSelection) => {
      if (!selection) {
        return;
      }

      const selectionValue = getSelectionValue(selection);
      if (selectionValue === undefined || selectionValue === null) {
        return;
      }

      const selectionLabel = getSelectionRawName(selection);
      const fallbackLabel = selectionLabel ?? optionName;
      inspectAddonEntry(extras, fallbackLabel, selectionValue);

      if (selectionLabel && detectAddonKind(selectionLabel) === null && optionName && optionName !== selectionLabel) {
        inspectAddonEntry(extras, optionName, selectionValue);
      }
    });
  });

  order.orderExtraFields?.forEach((field) => {
    if (!field) {
      return;
    }
    inspectAddonEntry(extras, field.name ?? undefined, field.value);
  });

  if (order.extraFields) {
    Object.entries(order.extraFields).forEach(([key, value]) => inspectAddonEntry(extras, key, value));
  }

  return extras;
};

const toUnifiedProduct = (productId: string, productName: string): UnifiedProduct => ({
  id: productId,
  name: productName,
  platform: 'ecwid',
});

export const transformEcwidOrders = (ecwidOrders: EcwidOrder[]) => {
  const productsMap = new Map<string, UnifiedProduct>();
  const orders: UnifiedOrder[] = [];

  ecwidOrders.forEach((order) => {
    order.items?.forEach((item, index) => {
      const pickupMoment = preferPickupMoment(order, item);
      if (!pickupMoment) {
        return;
      }

      const productId = String(item.productId ?? item.id ?? item.sku ?? `unknown-${index}`);
      const productName = item.name ?? 'Unknown product';

      if (!productsMap.has(productId)) {
        productsMap.set(productId, toUnifiedProduct(productId, productName));
      }

      const { men, women } = extractGenderCounts(order, item);
      const extras = extractAddonCounts(order, item);
      const baseQuantity = parseQuantity(item.quantity);
      const totalParticipants = men + women;
      const quantity = totalParticipants > 0 ? totalParticipants : baseQuantity;

      orders.push({
        id: `${order.id}-${item.id ?? item.productId ?? index}`,
        productId,
        productName,
        date: pickupMoment.format('YYYY-MM-DD'),
        timeslot: pickupMoment.format('HH:mm'),
        quantity,
        menCount: men,
        womenCount: women,
        customerName: order.shippingPerson?.name ?? order.billingPerson?.name ?? '',
        customerPhone: order.shippingPerson?.phone ?? order.billingPerson?.phone,
        platform: 'ecwid',
        pickupDateTime: pickupMoment.toISOString(),
        extras,
        rawData: { order, item },
      });
    });
  });

  const products = Array.from(productsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  return {
    products,
    orders,
  };
};

const applyPlatformBreakdown = (
  breakdown: ManifestGroup['platformBreakdown'],
  platform: string,
  men: number,
  women: number,
): void => {
  const totalPeople = men + women;
  const key = platform || 'unknown';
  const existing = breakdown.find((entry) => entry.platform === key);
  if (existing) {
    existing.totalPeople += totalPeople;
    existing.men += men;
    existing.women += women;
    existing.orderCount += 1;
    return;
  }

  breakdown.push({
    platform: key,
    totalPeople,
    men,
    women,
    orderCount: 1,
  });
};

export const groupOrdersForManifest = (orders: UnifiedOrder[]): ManifestGroup[] => {
  const groups = new Map<string, ManifestGroup>();

  orders.forEach((order) => {
    const men = Number.isFinite(order.menCount) ? order.menCount : 0;
    const women = Number.isFinite(order.womenCount) ? order.womenCount : 0;
    const totalPeople = men + women;
    const extras = order.extras ?? { tshirts: 0, cocktails: 0, photos: 0 };

    const displayTime = order.pickupDateTime
      ? dayjs(order.pickupDateTime).tz(STORE_TIMEZONE).format('HH:mm')
      : order.timeslot;

    const key = `${order.productId}|${order.date}|${displayTime}`;
    const normalizedOrder: UnifiedOrder = { ...order, timeslot: displayTime };

    const existing = groups.get(key);

    if (existing) {
      existing.totalPeople += totalPeople;
      existing.men += men;
      existing.women += women;
      existing.extras.tshirts += extras.tshirts;
      existing.extras.cocktails += extras.cocktails;
      existing.extras.photos += extras.photos;
      existing.orders.push(normalizedOrder);
      applyPlatformBreakdown(existing.platformBreakdown, normalizedOrder.platform, men, women);
      return;
    }

    groups.set(key, {
      productId: order.productId,
      productName: order.productName,
      date: order.date,
      time: displayTime,
      totalPeople,
      men,
      women,
      extras: { ...extras },
      orders: [normalizedOrder],
      platformBreakdown: [
        {
          platform: normalizedOrder.platform ?? 'unknown',
          totalPeople,
          men,
          women,
          orderCount: 1,
        },
      ],
    });
  });

  return Array.from(groups.values()).sort((a, b) => {
    if (a.date === b.date) {
      if (a.time === b.time) {
        return a.productName.localeCompare(b.productName);
      }
      return a.time.localeCompare(b.time);
    }
    return a.date.localeCompare(b.date);
  });
};
