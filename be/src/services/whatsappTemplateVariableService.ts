import Addon from '../models/Addon.js';
import Booking from '../models/Booking.js';
import BookingAddon from '../models/BookingAddon.js';
import type {
  WhatsAppTemplateBookingSearchResult,
  WhatsAppTemplateComponent,
  WhatsAppTemplateDefinition,
  WhatsAppTemplatePreview,
  WhatsAppTemplatePreviewButton,
  WhatsAppTemplateResolvedVariable,
  WhatsAppTemplateVariableDefinition,
} from '../types/whatsappTemplates.js';
import { buildManifestBookingSearchWhere } from '../utils/manifestBookingSearch.js';

const DISPLAY_TIME_ZONE = 'Europe/Warsaw';
const MAX_BOOKING_SEARCH_RESULTS = 20;
const MAX_BOOKING_SEARCH_LENGTH = 128;
const MISSING_VALUE_PREFIX = '[missing: ';

type PlainRecord = Record<string, unknown>;

export type WhatsAppTemplateVariableErrorCode =
  | 'INVALID_BOOKING_ID'
  | 'INVALID_SEARCH_QUERY'
  | 'BOOKING_NOT_FOUND'
  | 'UNKNOWN_VARIABLE'
  | 'INVALID_POSITIONAL_BINDINGS'
  | 'INVALID_TEMPLATE_COMPONENT'
  | 'MISSING_REQUIRED_VARIABLE';

export class WhatsAppTemplateVariableError extends Error {
  readonly code: WhatsAppTemplateVariableErrorCode;
  readonly missingVariables: string[];

  constructor(code: WhatsAppTemplateVariableErrorCode, missingVariables: string[] = []) {
    super(code);
    this.name = 'WhatsAppTemplateVariableError';
    this.code = code;
    this.missingVariables = [...new Set(missingVariables)].sort();
  }
}

export interface WhatsAppTemplatePositionalBindings {
  header?: readonly string[];
  body?: readonly string[];
  buttons?: Readonly<Record<string, readonly string[]>>;
}

export interface WhatsAppTemplateRenderOptions {
  bookingId?: number | null;
  positionalBindings?: WhatsAppTemplatePositionalBindings;
}

export interface WhatsAppTemplateSendTextParameter {
  type: 'text';
  text: string;
  parameter_name?: string;
}

export interface WhatsAppTemplateSendComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'url';
  index?: string;
  parameters: WhatsAppTemplateSendTextParameter[];
}

const VARIABLE_DEFINITIONS: readonly WhatsAppTemplateVariableDefinition[] = Object.freeze([
  {
    key: 'booking_reference',
    label: 'Booking reference',
    description: 'The external booking reference, with the OmniLodge booking ID as a fallback.',
    source: 'bookings.platform_booking_id -> bookings.id',
    dataType: 'text',
    sampleValue: 'GYG-123456',
    sensitivity: 'booking',
    nullable: false,
  },
  {
    key: 'guest_first_name',
    label: 'Guest first name',
    description: 'The booking guest\'s first name.',
    source: 'bookings.guest_first_name',
    dataType: 'text',
    sampleValue: 'Alex',
    sensitivity: 'customer',
    nullable: true,
  },
  {
    key: 'guest_full_name',
    label: 'Guest full name',
    description: 'The guest\'s first and last name joined safely.',
    source: 'bookings.guest_first_name + bookings.guest_last_name',
    dataType: 'text',
    sampleValue: 'Alex Taylor',
    sensitivity: 'customer',
    nullable: true,
  },
  {
    key: 'product_name',
    label: 'Product name',
    description: 'The product name captured on the booking.',
    source: 'bookings.product_name',
    dataType: 'text',
    sampleValue: 'Krakow Pub Crawl',
    sensitivity: 'booking',
    nullable: true,
  },
  {
    key: 'product_variant',
    label: 'Product variant',
    description: 'The selected product option or variant.',
    source: 'bookings.product_variant',
    dataType: 'text',
    sampleValue: 'Standard admission',
    sensitivity: 'booking',
    nullable: true,
  },
  {
    key: 'experience_date',
    label: 'Experience date',
    description: `The experience date formatted in ${DISPLAY_TIME_ZONE}.`,
    source: 'bookings.experience_date -> bookings.experience_start_at',
    dataType: 'date',
    sampleValue: '28 September 2026',
    sensitivity: 'booking',
    nullable: true,
  },
  {
    key: 'experience_time',
    label: 'Experience time',
    description: `The experience start time formatted in ${DISPLAY_TIME_ZONE}.`,
    source: 'bookings.experience_start_at',
    dataType: 'time',
    sampleValue: '20:00',
    sensitivity: 'booking',
    nullable: true,
  },
  {
    key: 'experience_datetime',
    label: 'Experience date and time',
    description: `The experience start date and time formatted in ${DISPLAY_TIME_ZONE}.`,
    source: 'bookings.experience_start_at',
    dataType: 'date',
    sampleValue: '28 September 2026 at 20:00',
    sensitivity: 'booking',
    nullable: true,
  },
  {
    key: 'party_size_total',
    label: 'Total guests',
    description: 'The total number of guests on the booking.',
    source: 'bookings.party_size_total',
    dataType: 'integer',
    sampleValue: '3',
    sensitivity: 'booking',
    nullable: true,
  },
  {
    key: 'party_size_adults',
    label: 'Adults',
    description: 'The number of adults on the booking.',
    source: 'bookings.party_size_adults',
    dataType: 'integer',
    sampleValue: '2',
    sensitivity: 'booking',
    nullable: true,
  },
  {
    key: 'party_size_children',
    label: 'Children',
    description: 'The number of children on the booking.',
    source: 'bookings.party_size_children',
    dataType: 'integer',
    sampleValue: '1',
    sensitivity: 'booking',
    nullable: true,
  },
  {
    key: 'pickup_location',
    label: 'Pickup location',
    description: 'The pickup location captured on the booking.',
    source: 'bookings.pickup_location',
    dataType: 'text',
    sampleValue: 'Main Market Square, Krakow',
    sensitivity: 'booking',
    nullable: true,
  },
  {
    key: 'hotel_name',
    label: 'Hotel name',
    description: 'The guest\'s pickup hotel name.',
    source: 'bookings.hotel_name',
    dataType: 'text',
    sampleValue: 'Hotel Krakow Central',
    sensitivity: 'customer',
    nullable: true,
  },
  {
    key: 'currency',
    label: 'Currency',
    description: 'The booking currency code.',
    source: 'bookings.currency',
    dataType: 'text',
    sampleValue: 'PLN',
    sensitivity: 'financial',
    nullable: true,
  },
  {
    key: 'total_amount',
    label: 'Total amount',
    description: 'The gross booking amount, falling back to the base amount.',
    source: 'bookings.price_gross -> bookings.base_amount + bookings.currency',
    dataType: 'money',
    sampleValue: '149.00 PLN',
    sensitivity: 'financial',
    nullable: true,
  },
  {
    key: 'addons_summary',
    label: 'Add-ons',
    description: 'A quantity-and-name summary of add-ons linked to the booking.',
    source: 'booking_addons.quantity + booking_addons.platform_addon_name -> addons.name',
    dataType: 'text',
    sampleValue: '2 x T-shirt, 1 x Photo package',
    sensitivity: 'booking',
    nullable: true,
  },
]);

const definitionByKey = new Map(VARIABLE_DEFINITIONS.map((definition) => [definition.key, definition]));

const cloneDefinition = (
  definition: WhatsAppTemplateVariableDefinition,
): WhatsAppTemplateVariableDefinition => ({ ...definition });

export const listWhatsAppTemplateVariables = (): WhatsAppTemplateVariableDefinition[] =>
  VARIABLE_DEFINITIONS.map(cloneDefinition);

const asPlainRecord = (value: unknown): PlainRecord => {
  if (value && typeof value === 'object') {
    const get = (value as { get?: unknown }).get;
    if (typeof get === 'function') {
      const plain = (get as (options: { plain: true }) => unknown).call(value, { plain: true });
      if (plain && typeof plain === 'object' && !Array.isArray(plain)) {
        return plain as PlainRecord;
      }
    }
    if (!Array.isArray(value)) return value as PlainRecord;
  }
  return {};
};

const compactText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const compacted = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return compacted || null;
};

const integerText = (value: unknown): string | null => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? String(number) : null;
};

const positiveBookingId = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const dateOnlyInstant = (value: unknown): Date | null => {
  const date = compactText(value);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const instant = (value: unknown): Date | null => {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value: Date): string => new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}).format(value);

const formatTime = (value: Date): string => new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}).format(value);

const formatMoney = (amount: unknown, currency: unknown): string | null => {
  if (amount === null || amount === undefined || amount === '') return null;
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return null;
  const currencyCode = compactText(currency)?.toUpperCase();
  return `${numericAmount.toFixed(2)}${currencyCode ? ` ${currencyCode}` : ''}`;
};

const variableBookingAttributes = [
  'id',
  'platformBookingId',
  'guestFirstName',
  'guestLastName',
  'productName',
  'productVariant',
  'experienceDate',
  'experienceStartAt',
  'partySizeTotal',
  'partySizeAdults',
  'partySizeChildren',
  'pickupLocation',
  'hotelName',
  'currency',
  'priceGross',
  'baseAmount',
] as const;

const searchBookingAttributes = [
  'id',
  'platformBookingId',
  'guestFirstName',
  'guestLastName',
  'guestPhone',
  'productName',
  'experienceDate',
  'experienceStartAt',
] as const;

export const searchWhatsAppTemplateBookings = async (
  query: string,
): Promise<WhatsAppTemplateBookingSearchResult[]> => {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  if (!normalizedQuery) return [];
  if (normalizedQuery.length > MAX_BOOKING_SEARCH_LENGTH) {
    throw new WhatsAppTemplateVariableError('INVALID_SEARCH_QUERY');
  }

  const rows = await Booking.findAll({
    where: buildManifestBookingSearchWhere(normalizedQuery),
    attributes: [...searchBookingAttributes],
    limit: MAX_BOOKING_SEARCH_RESULTS,
    order: [['id', 'DESC']],
  });

  return rows.flatMap((row) => {
    const booking = asPlainRecord(row);
    const id = positiveBookingId(booking.id);
    if (id === null) return [];
    const firstName = compactText(booking.guestFirstName);
    const lastName = compactText(booking.guestLastName);
    const phoneDigits = compactText(booking.guestPhone)?.replace(/\D/g, '') ?? '';
    const start = instant(booking.experienceStartAt);
    return [{
      id,
      reference: compactText(booking.platformBookingId) ?? `#${id}`,
      guestName: [firstName, lastName].filter(Boolean).join(' ') || 'Guest',
      productName: compactText(booking.productName) ?? 'Unspecified product',
      experienceAt: start?.toISOString() ?? compactText(booking.experienceDate),
      phoneSuffix: phoneDigits ? phoneDigits.slice(-4) : null,
    }];
  });
};

const summarizeAddons = (rows: unknown[]): string | null => {
  const summary = rows.flatMap((row) => {
    const addon = asPlainRecord(row);
    const associatedAddon = asPlainRecord(addon.addon);
    const name = compactText(addon.platformAddonName) ?? compactText(associatedAddon.name);
    if (!name) return [];
    const quantity = Number(addon.quantity);
    const safeQuantity = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
    return [`${safeQuantity} x ${name}`];
  });
  return summary.length ? summary.join(', ') : null;
};

const resolvedVariable = (
  definition: WhatsAppTemplateVariableDefinition,
  value: string | null,
): WhatsAppTemplateResolvedVariable => ({
  ...cloneDefinition(definition),
  value,
  missing: value === null,
});

export const resolveWhatsAppTemplateVariables = async (
  bookingId: number,
): Promise<WhatsAppTemplateResolvedVariable[]> => {
  const safeBookingId = positiveBookingId(bookingId);
  if (safeBookingId === null) {
    throw new WhatsAppTemplateVariableError('INVALID_BOOKING_ID');
  }

  const row = await Booking.findByPk(safeBookingId, {
    attributes: [...variableBookingAttributes],
  });
  if (!row) {
    throw new WhatsAppTemplateVariableError('BOOKING_NOT_FOUND');
  }
  const addonRows = await BookingAddon.findAll({
    where: { bookingId: safeBookingId },
    attributes: ['quantity', 'platformAddonName', 'addonId'],
    include: [{ model: Addon, as: 'addon', attributes: ['name'], required: false }],
    order: [['id', 'ASC']],
  });

  const booking = asPlainRecord(row);
  const id = positiveBookingId(booking.id) ?? safeBookingId;
  const firstName = compactText(booking.guestFirstName);
  const lastName = compactText(booking.guestLastName);
  const start = instant(booking.experienceStartAt);
  const date = dateOnlyInstant(booking.experienceDate) ?? start;
  const currency = compactText(booking.currency)?.toUpperCase() ?? null;
  const values: Record<string, string | null> = {
    booking_reference: compactText(booking.platformBookingId) ?? `#${id}`,
    guest_first_name: firstName,
    guest_full_name: [firstName, lastName].filter(Boolean).join(' ') || null,
    product_name: compactText(booking.productName),
    product_variant: compactText(booking.productVariant),
    experience_date: date ? formatDate(date) : null,
    experience_time: start ? formatTime(start) : null,
    experience_datetime: start ? `${formatDate(start)} at ${formatTime(start)}` : null,
    party_size_total: integerText(booking.partySizeTotal),
    party_size_adults: integerText(booking.partySizeAdults),
    party_size_children: integerText(booking.partySizeChildren),
    pickup_location: compactText(booking.pickupLocation),
    hotel_name: compactText(booking.hotelName),
    currency,
    total_amount: formatMoney(booking.priceGross ?? booking.baseAmount, currency),
    addons_summary: summarizeAddons(addonRows),
  };

  return VARIABLE_DEFINITIONS.map((definition) => resolvedVariable(
    definition,
    values[definition.key] ?? null,
  ));
};

type ComponentSection = 'header' | 'body' | `button:${number}`;

interface RenderContext {
  values: Map<string, WhatsAppTemplateResolvedVariable>;
  format: WhatsAppTemplateDefinition['parameterFormat'];
  positionalBindings?: WhatsAppTemplatePositionalBindings;
  allowUnboundPositionals: boolean;
  allowUnknownNamed: boolean;
  usedKeys: Set<string>;
  missingKeys: Set<string>;
}

const sampleVariables = (): WhatsAppTemplateResolvedVariable[] =>
  VARIABLE_DEFINITIONS.map((definition) => resolvedVariable(definition, definition.sampleValue));

const assertKnownVariable = (key: string): WhatsAppTemplateVariableDefinition => {
  const definition = definitionByKey.get(key);
  if (!definition) throw new WhatsAppTemplateVariableError('UNKNOWN_VARIABLE');
  return definition;
};

const bindingsForSection = (
  bindings: WhatsAppTemplatePositionalBindings | undefined,
  section: ComponentSection,
): readonly string[] => {
  if (section === 'header') return bindings?.header ?? [];
  if (section === 'body') return bindings?.body ?? [];
  const buttonIndex = Number(section.slice('button:'.length));
  return bindings?.buttons?.[buttonIndex] ?? [];
};

const placeholderPattern = /{{\s*([^{}]+?)\s*}}/g;

const variableKeyForPlaceholder = (
  rawPlaceholder: string,
  section: ComponentSection,
  context: RenderContext,
): string => {
  const sectionFormat = section.startsWith('button:') ? 'POSITIONAL' : context.format;
  if (sectionFormat === 'NAMED') {
    if (!/^[a-z][a-z0-9_]*$/.test(rawPlaceholder)) {
      throw new WhatsAppTemplateVariableError('UNKNOWN_VARIABLE');
    }
    if (!definitionByKey.has(rawPlaceholder) && context.allowUnknownNamed) {
      context.values.set(rawPlaceholder, {
        key: rawPlaceholder,
        label: rawPlaceholder.replace(/_/g, ' '),
        description: 'This named parameter is not mapped to a booking field.',
        source: 'Unmapped Meta template parameter',
        dataType: 'text',
        sampleValue: `Sample ${rawPlaceholder.replace(/_/g, ' ')}`,
        sensitivity: 'booking',
        nullable: false,
        value: `Sample ${rawPlaceholder.replace(/_/g, ' ')}`,
        missing: false,
      });
    } else {
      assertKnownVariable(rawPlaceholder);
    }
    return rawPlaceholder;
  }

  if (!/^[1-9]\d*$/.test(rawPlaceholder)) {
    throw new WhatsAppTemplateVariableError('INVALID_POSITIONAL_BINDINGS');
  }
  const position = Number(rawPlaceholder);
  const key = bindingsForSection(context.positionalBindings, section)[position - 1];
  if (!key && context.allowUnboundPositionals) {
    const syntheticKey = `parameter_${section.replace(':', '_')}_${position}`;
    if (!context.values.has(syntheticKey)) {
      context.values.set(syntheticKey, {
        key: syntheticKey,
        label: `Parameter ${position}`,
        description: `Unmapped positional parameter ${position} in the ${section} component.`,
        source: 'Meta positional parameter',
        dataType: 'text',
        sampleValue: `Sample ${position}`,
        sensitivity: 'booking',
        nullable: false,
        value: `Sample ${position}`,
        missing: false,
      });
    }
    return syntheticKey;
  }
  if (!key) throw new WhatsAppTemplateVariableError('INVALID_POSITIONAL_BINDINGS');
  assertKnownVariable(key);
  return key;
};

const renderText = (
  text: string,
  section: ComponentSection,
  context: RenderContext,
  encodeValues = false,
): string => text.replace(placeholderPattern, (_match, rawPlaceholder: string) => {
  const key = variableKeyForPlaceholder(rawPlaceholder.trim(), section, context);
  context.usedKeys.add(key);
  const resolved = context.values.get(key);
  const value = resolved?.value ?? null;
  if (value === null) {
    context.missingKeys.add(key);
    return `${MISSING_VALUE_PREFIX}${key}]`;
  }
  return encodeValues ? encodeURIComponent(value) : value;
});

const componentType = (component: WhatsAppTemplateComponent): string =>
  typeof component.type === 'string' ? component.type.trim().toUpperCase() : '';

const componentText = (component: WhatsAppTemplateComponent): string | null =>
  typeof component.text === 'string' ? component.text : null;

const buildRenderContext = async (
  definition: WhatsAppTemplateDefinition,
  options: WhatsAppTemplateRenderOptions,
  allowUnboundPositionals = false,
  allowUnknownNamed = false,
): Promise<RenderContext> => {
  const variables = options.bookingId === null || options.bookingId === undefined
    ? sampleVariables()
    : await resolveWhatsAppTemplateVariables(options.bookingId);
  return {
    values: new Map(variables.map((variable) => [variable.key, variable])),
    format: definition.parameterFormat,
    positionalBindings: options.positionalBindings ?? definition.bookingBindings,
    allowUnboundPositionals,
    allowUnknownNamed,
    usedKeys: new Set<string>(),
    missingKeys: new Set<string>(),
  };
};

const parseButtons = (
  component: WhatsAppTemplateComponent,
  context: RenderContext,
): WhatsAppTemplatePreviewButton[] => {
  if (!Array.isArray(component.buttons)) return [];
  return component.buttons.flatMap((rawButton, index) => {
    if (!rawButton || typeof rawButton !== 'object' || Array.isArray(rawButton)) return [];
    const button = rawButton as Record<string, unknown>;
    const type = typeof button.type === 'string' ? button.type.toUpperCase() : 'UNKNOWN';
    const otpType = compactText(button.otp_type)?.toUpperCase();
    const text = compactText(button.text)
      ?? (type === 'OTP'
        ? otpType === 'ONE_TAP' || otpType === 'ZERO_TAP' ? 'Autofill' : 'Copy code'
        : type.replace(/_/g, ' ').toLowerCase());
    const preview: WhatsAppTemplatePreviewButton = { type, text };
    if (typeof button.url === 'string') {
      preview.url = renderText(button.url, `button:${index}`, context, true);
    }
    const phoneNumber = compactText(button.phone_number ?? button.phoneNumber);
    if (phoneNumber) preview.phoneNumber = phoneNumber;
    return [preview];
  });
};

export const renderWhatsAppTemplatePreview = async (
  definition: WhatsAppTemplateDefinition,
  options: WhatsAppTemplateRenderOptions = {},
): Promise<WhatsAppTemplatePreview> => {
  const context = await buildRenderContext(
    definition,
    options,
    true,
    options.bookingId === null || options.bookingId === undefined,
  );
  let header: WhatsAppTemplatePreview['header'] = null;
  let body = '';
  let footer: string | null = null;
  let buttons: WhatsAppTemplatePreviewButton[] = [];

  for (const component of definition.components) {
    const type = componentType(component);
    if (type === 'HEADER') {
      const format = typeof component.format === 'string' ? component.format.toUpperCase() : 'TEXT';
      const text = componentText(component);
      header = {
        format,
        text: format === 'TEXT' && text !== null ? renderText(text, 'header', context) : null,
      };
    } else if (type === 'BODY') {
      const text = componentText(component);
      if (text === null && definition.category === 'AUTHENTICATION') {
        body = component.add_security_recommendation === true
          ? '123456 is your verification code. For your security, do not share this code.'
          : '123456 is your verification code.';
      } else if (text === null) {
        throw new WhatsAppTemplateVariableError('INVALID_TEMPLATE_COMPONENT');
      } else {
        body = renderText(text, 'body', context);
      }
    } else if (type === 'FOOTER') {
      const text = componentText(component);
      if (text !== null && placeholderPattern.test(text)) {
        placeholderPattern.lastIndex = 0;
        throw new WhatsAppTemplateVariableError('INVALID_TEMPLATE_COMPONENT');
      }
      placeholderPattern.lastIndex = 0;
      const expiration = Number(component.code_expiration_minutes);
      footer = text ?? (definition.category === 'AUTHENTICATION'
        && Number.isInteger(expiration)
        && expiration >= 1
        && expiration <= 90
        ? `This code expires in ${expiration} minute${expiration === 1 ? '' : 's'}.`
        : null);
    } else if (type === 'BUTTONS') {
      buttons = parseButtons(component, context);
    }
  }

  const usedVariables = [...context.usedKeys]
    .map((key) => context.values.get(key))
    .filter((variable): variable is WhatsAppTemplateResolvedVariable => Boolean(variable));

  return {
    header,
    body,
    footer,
    buttons,
    variables: usedVariables,
    missingVariables: [...context.missingKeys].sort(),
  };
};

interface PlaceholderBinding {
  placeholder: string;
  key: string;
}

const placeholderBindings = (
  text: string,
  section: ComponentSection,
  context: RenderContext,
): PlaceholderBinding[] => {
  const bindings: PlaceholderBinding[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(placeholderPattern)) {
    const placeholder = match[1].trim();
    if (seen.has(placeholder)) continue;
    const key = variableKeyForPlaceholder(placeholder, section, context);
    seen.add(placeholder);
    context.usedKeys.add(key);
    if (context.values.get(key)?.value === null) context.missingKeys.add(key);
    bindings.push({ placeholder, key });
  }
  const sectionFormat = section.startsWith('button:') ? 'POSITIONAL' : context.format;
  if (sectionFormat === 'POSITIONAL' && bindings.length) {
    const positions = bindings.map(({ placeholder }) => Number(placeholder)).sort((a, b) => a - b);
    if (positions.some((position, index) => position !== index + 1)) {
      throw new WhatsAppTemplateVariableError('INVALID_POSITIONAL_BINDINGS');
    }
    bindings.sort((left, right) => Number(left.placeholder) - Number(right.placeholder));
  }
  return bindings;
};

const sendParameters = (
  bindings: PlaceholderBinding[],
  context: RenderContext,
  section: ComponentSection,
  encodeValues = false,
): WhatsAppTemplateSendTextParameter[] => bindings.flatMap(({ key }) => {
  const value = context.values.get(key)?.value ?? null;
  if (value === null) return [];
  return [{
    type: 'text' as const,
    text: encodeValues ? encodeURIComponent(value) : value,
    ...(context.format === 'NAMED' && !section.startsWith('button:')
      ? { parameter_name: key }
      : {}),
  }];
});

export const buildWhatsAppTemplateSendComponents = async (
  definition: WhatsAppTemplateDefinition,
  options: WhatsAppTemplateRenderOptions = {},
): Promise<WhatsAppTemplateSendComponent[]> => {
  const context = await buildRenderContext(definition, options);
  const components: WhatsAppTemplateSendComponent[] = [];

  for (const component of definition.components) {
    const type = componentType(component);
    if (type === 'HEADER' || type === 'BODY') {
      const text = componentText(component);
      if (text === null) continue;
      const bindings = placeholderBindings(text, type === 'HEADER' ? 'header' : 'body', context);
      if (bindings.length) {
        components.push({
          type: type === 'HEADER' ? 'header' : 'body',
          parameters: sendParameters(bindings, context, type === 'HEADER' ? 'header' : 'body'),
        });
      }
    } else if (type === 'FOOTER') {
      const text = componentText(component);
      if (text !== null && placeholderPattern.test(text)) {
        placeholderPattern.lastIndex = 0;
        throw new WhatsAppTemplateVariableError('INVALID_TEMPLATE_COMPONENT');
      }
      placeholderPattern.lastIndex = 0;
    } else if (type === 'BUTTONS' && Array.isArray(component.buttons)) {
      component.buttons.forEach((rawButton, index) => {
        if (!rawButton || typeof rawButton !== 'object' || Array.isArray(rawButton)) return;
        const button = rawButton as Record<string, unknown>;
        const typeValue = typeof button.type === 'string' ? button.type.toUpperCase() : '';
        if (typeValue !== 'URL' || typeof button.url !== 'string') return;
        const bindings = placeholderBindings(button.url, `button:${index}`, context);
        if (!bindings.length) return;
        components.push({
          type: 'button',
          sub_type: 'url',
          index: String(index),
          parameters: sendParameters(bindings, context, `button:${index}`, true),
        });
      });
    }
  }

  if (context.missingKeys.size) {
    throw new WhatsAppTemplateVariableError(
      'MISSING_REQUIRED_VARIABLE',
      [...context.missingKeys],
    );
  }
  return components;
};

// Compatibility aliases keep controller code descriptive without exposing model details.
export const getWhatsAppTemplateVariableDefinitions = listWhatsAppTemplateVariables;
export const searchBookingsForWhatsAppTemplate = searchWhatsAppTemplateBookings;
export const resolveBookingWhatsAppTemplateVariables = resolveWhatsAppTemplateVariables;
export const renderWhatsAppTemplate = renderWhatsAppTemplatePreview;
export const buildWhatsAppTemplateMessageComponents = buildWhatsAppTemplateSendComponents;
