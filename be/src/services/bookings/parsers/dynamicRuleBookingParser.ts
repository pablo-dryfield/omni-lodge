import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import type {
  BookingEmailParser,
  BookingFieldPatch,
  BookingParserCheck,
  BookingParserContext,
  BookingParserDiagnostics,
  ParsedBookingEvent,
} from '../types.js';
import {
  BOOKING_EVENT_TYPES,
  BOOKING_PAYMENT_STATUSES,
  BOOKING_PLATFORMS,
  BOOKING_STATUSES,
  type BookingEventType,
  type BookingPaymentStatus,
  type BookingPlatform,
  type BookingStatus,
} from '../../../constants/bookings.js';
import { getConfigValue } from '../../configService.js';
import logger from '../../../utils/logger.js';

dayjs.extend(customParseFormat);

const DATE_ONLY_FORMATS = [
  'YYYY-MM-DD',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD-MM-YYYY',
  'MM-DD-YYYY',
  'MMMM D, YYYY',
  'MMM D, YYYY',
  'D MMMM YYYY',
  'D MMM YYYY',
] as const;

const DATE_TIME_FORMATS = [
  'YYYY-MM-DD HH:mm',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DDTHH:mm',
  'YYYY-MM-DDTHH:mm:ss',
  'DD/MM/YYYY HH:mm',
  'DD-MM-YYYY HH:mm',
  'MMMM D, YYYY h:mm A',
  'MMM D, YYYY h:mm A',
  'D MMMM YYYY H:mm',
  'D MMM YYYY H:mm',
] as const;

const DYNAMIC_SOURCE_FIELDS = [
  'from',
  'to',
  'cc',
  'subject',
  'snippet',
  'textBody',
  'htmlBody',
] as const;

type DynamicSourceField = (typeof DYNAMIC_SOURCE_FIELDS)[number];

type DynamicClause = {
  source: DynamicSourceField;
  pattern: string;
  flags?: string;
  group?: number;
  label?: string;
};

type DynamicParserExtractConfig = {
  platformBookingId: DynamicClause;
  platformOrderId?: DynamicClause;
  productName?: DynamicClause;
  productVariant?: DynamicClause;
  guestEmail?: DynamicClause;
  guestPhone?: DynamicClause;
  guestFirstName?: DynamicClause;
  guestLastName?: DynamicClause;
  experienceDate?: DynamicClause;
  experienceStartAt?: DynamicClause;
  currency?: DynamicClause;
  baseAmount?: DynamicClause;
  partySizeTotal?: DynamicClause;
  partySizeAdults?: DynamicClause;
  partySizeChildren?: DynamicClause;
  paymentMethod?: DynamicClause;
  notes?: DynamicClause;
};

type DynamicStatusConfig = {
  cancelled: DynamicClause[];
  amended: DynamicClause[];
  noShow: DynamicClause[];
  confirmed: DynamicClause[];
  defaultStatus?: BookingStatus;
};

type DynamicParserDefaults = {
  status?: BookingStatus;
  eventType?: BookingEventType;
  paymentStatus?: BookingPaymentStatus;
};

type DynamicParserDefinition = {
  id: string;
  enabled: boolean;
  priority: number;
  platform: BookingPlatform;
  matchAll: DynamicClause[];
  matchAny: DynamicClause[];
  extract: DynamicParserExtractConfig;
  status: DynamicStatusConfig;
  defaults: DynamicParserDefaults;
};

const DYNAMIC_SOURCE_SET = new Set<string>(DYNAMIC_SOURCE_FIELDS);
const BOOKING_PLATFORM_SET = new Set<string>(BOOKING_PLATFORMS);
const BOOKING_STATUS_SET = new Set<string>(BOOKING_STATUSES);
const BOOKING_EVENT_TYPE_SET = new Set<string>(BOOKING_EVENT_TYPES);
const BOOKING_PAYMENT_STATUS_SET = new Set<string>(BOOKING_PAYMENT_STATUSES);
const VALID_REGEX_FLAGS = /^[dgimsuy]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSourceField = (value: unknown): value is DynamicSourceField =>
  typeof value === 'string' && DYNAMIC_SOURCE_SET.has(value);

const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toOptionalInteger = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }
  return value >= 0 ? value : undefined;
};

const buildClauseLabel = (clause: DynamicClause): string =>
  clause.label ?? `${clause.source} =~ /${clause.pattern}/${clause.flags ?? 'i'}`;

const normalizeClause = (
  input: unknown,
  defaultSource?: DynamicSourceField,
): DynamicClause | null => {
  if (typeof input === 'string') {
    const pattern = input.trim();
    if (!pattern || !defaultSource) {
      return null;
    }
    return { source: defaultSource, pattern };
  }

  if (!isRecord(input)) {
    return null;
  }

  const source = isSourceField(input.source) ? input.source : defaultSource;
  const pattern = toOptionalString(input.pattern);
  if (!source || !pattern) {
    return null;
  }

  const flags = toOptionalString(input.flags);
  const group = toOptionalInteger(input.group);
  const label = toOptionalString(input.label);
  return { source, pattern, flags, group, label };
};

const normalizeClauseList = (
  input: unknown,
  defaultSource?: DynamicSourceField,
): DynamicClause[] => {
  if (Array.isArray(input)) {
    return input
      .map((entry) => normalizeClause(entry, defaultSource))
      .filter((entry): entry is DynamicClause => Boolean(entry));
  }
  const single = normalizeClause(input, defaultSource);
  return single ? [single] : [];
};

const compileRegex = (clause: DynamicClause): { regex: RegExp | null; error?: string } => {
  const flags = clause.flags ?? 'i';
  if (!VALID_REGEX_FLAGS.test(flags)) {
    return { regex: null, error: `Invalid regex flags "${flags}"` };
  }
  try {
    return { regex: new RegExp(clause.pattern, flags) };
  } catch (error) {
    return {
      regex: null,
      error: `Invalid regex "${clause.pattern}": ${(error as Error).message}`,
    };
  }
};

const getContextValue = (context: BookingParserContext, source: DynamicSourceField): string => {
  const value = context[source];
  return typeof value === 'string' ? value : '';
};

const truncate = (value: string, max = 140): string => (value.length > max ? `${value.slice(0, max)}...` : value);

const clausePasses = (
  context: BookingParserContext,
  clause: DynamicClause,
): { passed: boolean; value?: string; error?: string } => {
  const sourceText = getContextValue(context, clause.source);
  const { regex, error } = compileRegex(clause);
  if (!regex) {
    return { passed: false, value: truncate(sourceText), error };
  }
  return {
    passed: regex.test(sourceText),
    value: truncate(sourceText),
  };
};

const extractClauseValue = (
  context: BookingParserContext,
  clause: DynamicClause | undefined,
): { value: string | null; error?: string } => {
  if (!clause) {
    return { value: null };
  }

  const sourceText = getContextValue(context, clause.source);
  const { regex, error } = compileRegex(clause);
  if (!regex) {
    return { value: null, error };
  }

  const match = regex.exec(sourceText);
  if (!match) {
    return { value: null };
  }

  const targetGroup = clause.group ?? (match.length > 1 ? 1 : 0);
  const candidate = match[targetGroup];
  if (typeof candidate !== 'string') {
    return { value: null };
  }

  const trimmed = candidate.trim();
  return { value: trimmed.length > 0 ? trimmed : null };
};

const inferStatusFromContext = (context: BookingParserContext): BookingStatus => {
  const text = `${context.subject ?? ''}\n${context.textBody ?? ''}`.toLowerCase();
  if (/cancelled|canceled|cancellation|voided/.test(text)) {
    return 'cancelled';
  }
  if (/amend|modified|updated|changed|rebooked|altered/.test(text)) {
    return 'amended';
  }
  if (/no[-\s]?show/.test(text)) {
    return 'no_show';
  }
  return 'confirmed';
};

const statusToEventType = (status: BookingStatus): BookingEventType => {
  switch (status) {
    case 'amended':
      return 'amended';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'created';
  }
};

const normalizeDateOnly = (value: string): string | null => {
  const token = value.trim();
  if (!token) {
    return null;
  }

  for (const format of DATE_ONLY_FORMATS) {
    const parsed = dayjs(token, format, true);
    if (parsed.isValid()) {
      return parsed.format('YYYY-MM-DD');
    }
  }

  const fallback = dayjs(token);
  if (!fallback.isValid()) {
    return null;
  }
  return fallback.format('YYYY-MM-DD');
};

const normalizeDateTime = (value: string): Date | null => {
  const token = value.trim();
  if (!token) {
    return null;
  }

  for (const format of DATE_TIME_FORMATS) {
    const parsed = dayjs(token, format, true);
    if (parsed.isValid()) {
      return parsed.toDate();
    }
  }

  const fallback = dayjs(token);
  if (!fallback.isValid()) {
    return null;
  }
  return fallback.toDate();
};

const normalizeInteger = (value: string): number | null => {
  const cleaned = value.replace(/[^\d-]/g, '');
  if (!cleaned) {
    return null;
  }
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeDecimal = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let normalized = trimmed.replace(/[^\d,.-]/g, '');
  if (!normalized) {
    return null;
  }

  if (normalized.includes('.') && normalized.includes(',')) {
    normalized = normalized.replace(/,/g, '');
  } else if (!normalized.includes('.') && normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeCurrency = (value: string): string | null => {
  const cleaned = value.replace(/[^A-Za-z]/g, '').toUpperCase();
  return cleaned.length === 3 ? cleaned : null;
};

const normalizeBookingStatus = (value: unknown): BookingStatus | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return BOOKING_STATUS_SET.has(normalized) ? (normalized as BookingStatus) : undefined;
};

const normalizeBookingEventType = (value: unknown): BookingEventType | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return BOOKING_EVENT_TYPE_SET.has(normalized) ? (normalized as BookingEventType) : undefined;
};

const normalizePaymentStatus = (value: unknown): BookingPaymentStatus | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return BOOKING_PAYMENT_STATUS_SET.has(normalized) ? (normalized as BookingPaymentStatus) : undefined;
};

const normalizePlatform = (value: unknown): BookingPlatform => {
  if (typeof value !== 'string') {
    return 'unknown';
  }
  const normalized = value.trim();
  return BOOKING_PLATFORM_SET.has(normalized) ? (normalized as BookingPlatform) : 'unknown';
};

const normalizeExtractConfig = (input: unknown): DynamicParserExtractConfig | null => {
  if (!isRecord(input)) {
    return null;
  }

  const platformBookingId = normalizeClause(input.platformBookingId, 'textBody');
  if (!platformBookingId) {
    return null;
  }

  return {
    platformBookingId,
    platformOrderId: normalizeClause(input.platformOrderId, 'textBody') ?? undefined,
    productName: normalizeClause(input.productName, 'textBody') ?? undefined,
    productVariant: normalizeClause(input.productVariant, 'textBody') ?? undefined,
    guestEmail: normalizeClause(input.guestEmail, 'textBody') ?? undefined,
    guestPhone: normalizeClause(input.guestPhone, 'textBody') ?? undefined,
    guestFirstName: normalizeClause(input.guestFirstName, 'textBody') ?? undefined,
    guestLastName: normalizeClause(input.guestLastName, 'textBody') ?? undefined,
    experienceDate: normalizeClause(input.experienceDate, 'textBody') ?? undefined,
    experienceStartAt: normalizeClause(input.experienceStartAt, 'textBody') ?? undefined,
    currency: normalizeClause(input.currency, 'textBody') ?? undefined,
    baseAmount: normalizeClause(input.baseAmount, 'textBody') ?? undefined,
    partySizeTotal: normalizeClause(input.partySizeTotal, 'textBody') ?? undefined,
    partySizeAdults: normalizeClause(input.partySizeAdults, 'textBody') ?? undefined,
    partySizeChildren: normalizeClause(input.partySizeChildren, 'textBody') ?? undefined,
    paymentMethod: normalizeClause(input.paymentMethod, 'textBody') ?? undefined,
    notes: normalizeClause(input.notes, 'textBody') ?? undefined,
  };
};

const normalizeMatchConfig = (
  input: unknown,
): { matchAll: DynamicClause[]; matchAny: DynamicClause[] } => {
  if (!isRecord(input)) {
    return { matchAll: [], matchAny: [] };
  }

  const matchAll = normalizeClauseList(input.all);
  const matchAny = normalizeClauseList(input.any);

  for (const source of DYNAMIC_SOURCE_FIELDS) {
    const clauses = normalizeClauseList(input[source], source);
    if (clauses.length > 0) {
      matchAll.push(...clauses);
    }
  }

  return { matchAll, matchAny };
};

const normalizeStatusConfig = (input: unknown): DynamicStatusConfig => {
  if (!isRecord(input)) {
    return {
      cancelled: [],
      amended: [],
      noShow: [],
      confirmed: [],
    };
  }

  return {
    cancelled: normalizeClauseList(input.cancelled, 'textBody'),
    amended: normalizeClauseList(input.amended, 'textBody'),
    noShow: normalizeClauseList(input.noShow, 'textBody'),
    confirmed: normalizeClauseList(input.confirmed, 'textBody'),
    defaultStatus: normalizeBookingStatus(input.default),
  };
};

const normalizeDefaults = (input: unknown): DynamicParserDefaults => {
  if (!isRecord(input)) {
    return {};
  }
  return {
    status: normalizeBookingStatus(input.status),
    eventType: normalizeBookingEventType(input.eventType),
    paymentStatus: normalizePaymentStatus(input.paymentStatus),
  };
};

const normalizeDefinition = (input: unknown): DynamicParserDefinition | null => {
  if (!isRecord(input)) {
    return null;
  }

  const id = toOptionalString(input.id);
  if (!id) {
    return null;
  }

  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true;
  const priority = typeof input.priority === 'number' && Number.isFinite(input.priority) ? input.priority : 0;
  const platform = normalizePlatform(input.platform);
  const { matchAll, matchAny } = normalizeMatchConfig(input.match);
  if (matchAll.length === 0 && matchAny.length === 0) {
    return null;
  }
  const extract = normalizeExtractConfig(input.extract);
  if (!extract) {
    return null;
  }
  const status = normalizeStatusConfig(input.status);
  const defaults = normalizeDefaults(input.defaults);

  return {
    id,
    enabled,
    priority,
    platform,
    matchAll,
    matchAny,
    extract,
    status,
    defaults,
  };
};

const normalizeDefinitions = (input: unknown): DynamicParserDefinition[] => {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized: DynamicParserDefinition[] = [];
  for (const entry of input) {
    const parsed = normalizeDefinition(entry);
    if (!parsed) {
      logger.warn('[booking-email] Ignoring invalid BOOKING_DYNAMIC_PARSERS entry');
      continue;
    }
    if (!parsed.enabled) {
      continue;
    }
    normalized.push(parsed);
  }
  return normalized.sort((left, right) => right.priority - left.priority);
};

class DynamicRuleBookingParser implements BookingEmailParser {
  public readonly name: string;

  constructor(private readonly definition: DynamicParserDefinition) {
    this.name = `dynamic:${definition.id}`;
  }

  private buildMatchChecks(context: BookingParserContext): BookingParserCheck[] {
    const checks: BookingParserCheck[] = [];

    for (const clause of this.definition.matchAll) {
      const result = clausePasses(context, clause);
      checks.push({
        label: `all:${buildClauseLabel(clause)}`,
        passed: result.passed,
        value: result.error ?? result.value,
      });
    }

    if (this.definition.matchAny.length > 0) {
      const anyResults = this.definition.matchAny.map((clause) => ({ clause, result: clausePasses(context, clause) }));
      const anyPassed = anyResults.some(({ result }) => result.passed);
      checks.push({
        label: 'any:at least one matcher must pass',
        passed: anyPassed,
      });
      for (const { clause, result } of anyResults) {
        checks.push({
          label: `any:${buildClauseLabel(clause)}`,
          passed: result.passed,
          value: result.error ?? result.value,
        });
      }
    }

    return checks;
  }

  private evaluateCanParse(checks: BookingParserCheck[]): boolean {
    if (checks.length === 0) {
      return false;
    }
    const requiredChecks = checks.filter((check) => check.label.startsWith('all:'));
    const anyGate = checks.find((check) => check.label === 'any:at least one matcher must pass');
    const allRequiredPassed = requiredChecks.every((check) => check.passed);
    const anyGatePassed = anyGate ? anyGate.passed : true;
    return allRequiredPassed && anyGatePassed;
  }

  private resolveStatus(context: BookingParserContext): BookingStatus {
    const testAny = (clauses: DynamicClause[]): boolean =>
      clauses.some((clause) => clausePasses(context, clause).passed);

    if (testAny(this.definition.status.cancelled)) {
      return 'cancelled';
    }
    if (testAny(this.definition.status.amended)) {
      return 'amended';
    }
    if (testAny(this.definition.status.noShow)) {
      return 'no_show';
    }
    if (testAny(this.definition.status.confirmed)) {
      return 'confirmed';
    }
    if (this.definition.defaults.status) {
      return this.definition.defaults.status;
    }
    if (this.definition.status.defaultStatus) {
      return this.definition.status.defaultStatus;
    }
    return inferStatusFromContext(context);
  }

  private extractBookingFields(context: BookingParserContext): BookingFieldPatch {
    const extract = this.definition.extract;
    const fields: BookingFieldPatch = {};

    const assignStringField = <K extends keyof BookingFieldPatch>(key: K, clause?: DynamicClause): void => {
      const value = extractClauseValue(context, clause).value;
      if (!value) {
        return;
      }
      fields[key] = value as BookingFieldPatch[K];
    };

    assignStringField('productName', extract.productName);
    assignStringField('productVariant', extract.productVariant);
    assignStringField('guestEmail', extract.guestEmail);
    assignStringField('guestPhone', extract.guestPhone);
    assignStringField('guestFirstName', extract.guestFirstName);
    assignStringField('guestLastName', extract.guestLastName);
    assignStringField('paymentMethod', extract.paymentMethod);
    assignStringField('notes', extract.notes);

    const experienceDate = extractClauseValue(context, extract.experienceDate).value;
    if (experienceDate) {
      fields.experienceDate = normalizeDateOnly(experienceDate) ?? experienceDate;
    }

    const experienceStartAt = extractClauseValue(context, extract.experienceStartAt).value;
    if (experienceStartAt) {
      const normalized = normalizeDateTime(experienceStartAt);
      if (normalized) {
        fields.experienceStartAt = normalized;
      }
    }

    const currency = extractClauseValue(context, extract.currency).value;
    if (currency) {
      fields.currency = normalizeCurrency(currency) ?? currency.toUpperCase();
    }

    const baseAmount = extractClauseValue(context, extract.baseAmount).value;
    if (baseAmount) {
      const normalized = normalizeDecimal(baseAmount);
      fields.baseAmount = normalized ?? baseAmount;
    }

    const partySizeTotal = extractClauseValue(context, extract.partySizeTotal).value;
    if (partySizeTotal) {
      const normalized = normalizeInteger(partySizeTotal);
      if (normalized != null) {
        fields.partySizeTotal = normalized;
      }
    }

    const partySizeAdults = extractClauseValue(context, extract.partySizeAdults).value;
    if (partySizeAdults) {
      const normalized = normalizeInteger(partySizeAdults);
      if (normalized != null) {
        fields.partySizeAdults = normalized;
      }
    }

    const partySizeChildren = extractClauseValue(context, extract.partySizeChildren).value;
    if (partySizeChildren) {
      const normalized = normalizeInteger(partySizeChildren);
      if (normalized != null) {
        fields.partySizeChildren = normalized;
      }
    }

    return fields;
  }

  diagnose(context: BookingParserContext): BookingParserDiagnostics {
    const canParseChecks = this.buildMatchChecks(context);
    const canParse = this.evaluateCanParse(canParseChecks);
    const bookingIdExtraction = extractClauseValue(context, this.definition.extract.platformBookingId);
    const parseChecks: BookingParserCheck[] = [
      {
        label: 'platformBookingId extracted',
        passed: Boolean(bookingIdExtraction.value),
        value: bookingIdExtraction.error ?? bookingIdExtraction.value ?? undefined,
      },
    ];

    return {
      name: this.name,
      canParse,
      canParseChecks,
      parseChecks,
    };
  }

  canParse(context: BookingParserContext): boolean {
    const checks = this.buildMatchChecks(context);
    return this.evaluateCanParse(checks);
  }

  async parse(context: BookingParserContext): Promise<ParsedBookingEvent | null> {
    if (!this.canParse(context)) {
      return null;
    }

    const bookingIdResult = extractClauseValue(context, this.definition.extract.platformBookingId);
    if (!bookingIdResult.value) {
      return null;
    }

    const orderId = extractClauseValue(context, this.definition.extract.platformOrderId).value;
    const status = this.resolveStatus(context);
    const eventType = this.definition.defaults.eventType ?? statusToEventType(status);
    const paymentStatus = this.definition.defaults.paymentStatus ?? 'unknown';
    const bookingFields = this.extractBookingFields(context);
    const occurredAt = context.receivedAt ?? context.internalDate ?? null;

    return {
      platform: this.definition.platform,
      platformBookingId: bookingIdResult.value,
      platformOrderId: orderId,
      status,
      eventType,
      paymentStatus,
      bookingFields,
      sourceReceivedAt: occurredAt,
      occurredAt,
      rawPayload: {
        parser: this.name,
      },
    };
  }
}

export const buildDynamicRuleBookingParsers = (): BookingEmailParser[] => {
  const rawConfig = getConfigValue('BOOKING_DYNAMIC_PARSERS');
  const definitions = normalizeDefinitions(rawConfig);
  return definitions.map((definition) => new DynamicRuleBookingParser(definition));
};
