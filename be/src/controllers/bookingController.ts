import { Request, Response } from 'express';
import { isAxiosError } from 'axios';
import { Op, type WhereOptions, fn, col, where as sequelizeWhere, type Transaction, literal, type OrderItem } from 'sequelize';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import Booking from '../models/Booking.js';
import BookingEmail from '../models/BookingEmail.js';
import BookingAddon from '../models/BookingAddon.js';
import BookingEvent from '../models/BookingEvent.js';
import EmailTemplate from '../models/EmailTemplate.js';
import Channel from '../models/Channel.js';
import Counter from '../models/Counter.js';
import CounterChannelMetric from '../models/CounterChannelMetric.js';
import Guest from '../models/Guest.js';
import Addon from '../models/Addon.js';
import Product from '../models/Product.js';
import ProductAlias from '../models/ProductAlias.js';
import ProductAddon from '../models/ProductAddon.js';
import HttpError from '../errors/HttpError.js';
import { getStripeClient } from '../finance/services/stripeClient.js';
import type Stripe from 'stripe';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  canonicalizeProductKeyFromLabel,
  canonicalizeProductKeyFromSources,
  canonicalizeProductLabelFromSources,
  sanitizeProductSource,
} from '../utils/productName.js';
import {
  ingestAllBookingEmails,
  ingestLatestBookingEmails,
  processBookingEmail,
} from '../services/bookings/bookingIngestionService.js';
import {
  fetchMessagePayload as fetchGmailMessagePayload,
  listMailboxMessages,
  sendMessage as sendGmailMessage,
} from '../services/bookings/gmailClient.js';
import {
  renderReactEmailTemplateSource,
  renderStoredEmailTemplate,
  type EmailTemplateContext,
} from '../services/emailTemplates/emailTemplateRenderer.js';
import { syncEcwidBookingUtmByBookingId } from '../services/bookings/ecwidUtmSyncService.js';
import logger from '../utils/logger.js';
import type {
  UnifiedOrder,
  UnifiedProduct,
  ManifestGroup,
  OrderExtras,
  PlatformBreakdownEntry,
} from '../types/booking.js';
import { groupOrdersForManifest, transformEcwidOrders } from '../utils/ecwidAdapter.js';
import {
  BOOKING_ATTENDANCE_STATUSES,
  BOOKING_STATUSES,
  type BookingAttendanceStatus,
  type BookingStatus,
} from '../constants/bookings.js';
import { getEcwidOrder, updateEcwidOrder, type EcwidExtraField, type EcwidOrder } from '../services/ecwidService.js';
import { getConfigValue } from '../services/configService.js';
import type { EmailTemplateType } from '../models/EmailTemplate.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const DATE_FORMAT = 'YYYY-MM-DD';
const DISPLAY_TIMEZONE = 'Europe/Warsaw';
const STORE_TIMEZONE = 'Europe/Warsaw';
const AFTER_CUTOFF_TIME = '21:00:00';
const CHECKIN_ALLOWED_STATUSES = new Set<BookingStatus>(['pending', 'confirmed', 'amended', 'completed']);
const DEFAULT_ATTENDANCE_STATUS: BookingAttendanceStatus = 'pending';

type RangeBoundary = 'start' | 'end';

type QueryParams = {
  date?: string;
  pickupFrom?: string;
  pickupTo?: string;
  productId?: string;
  time?: string;
  search?: string;
};

type UpdateBookingAttendanceBody = {
  attendedTotal?: unknown;
  attendedExtras?: Partial<Record<keyof OrderExtras, unknown>>;
};

type UpdateBulkBookingAttendanceBody = {
  updates?: Array<
    {
      bookingId?: unknown;
    } & UpdateBookingAttendanceBody
  >;
};

type BookingAttendanceUpdateResponse = {
  bookingId: number;
  allowance: number;
  attendedTotal: number;
  attendedExtras: OrderExtras;
  attendanceStatus: BookingAttendanceStatus;
  remainingTotal: number;
  order: UnifiedOrder | null;
};

type BookingAttendanceBulkUpdateResult =
  | BookingAttendanceUpdateResponse
  | {
      bookingId: number | null;
      error: string;
    };

type AmendPickupRequestBody = {
  pickupDate?: string;
  pickupTime?: string;
};

type ReconcileEcwidRequestBody = {
  itemIndex?: number;
};

type EcwidAmendPreviewStatus = 'matched' | 'order_missing' | 'product_missing';

type EcwidAmendPreviewItem = {
  name: string | null;
  quantity: number | null;
  pickupTime: string | null;
  options: string[];
  matched?: boolean;
  matchedBookingNames?: string[];
};

const normalizeDate = (value?: string, boundary: RangeBoundary = 'start'): string | null => {
  if (!value) {
    return null;
  }

  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return null;
  }

  const normalized = boundary === 'start' ? parsed.startOf('day') : parsed.endOf('day');
  return normalized.format(DATE_FORMAT);
};

const resolveRange = (query: QueryParams): { start: string | null; end: string | null } => {
  const base = query.date;
  const startCandidate = base ?? query.pickupFrom;
  const endCandidate = base ?? query.pickupTo;

  const start = normalizeDate(startCandidate, 'start');
  const end = normalizeDate(endCandidate ?? startCandidate ?? base ?? undefined, 'end');

  if (start && !end) {
    return { start, end: start };
  }
  if (!start && end) {
    return { start: end, end };
  }
  return { start, end };
};

const normalizeAliasLabel = (value: string): string => sanitizeProductSource(value).toLowerCase();

const resolveAliasProductId = (aliases: ProductAlias[], value: string): number | null => {
  const normalized = normalizeAliasLabel(value);
  for (const alias of aliases) {
    if (!alias.active) {
      continue;
    }
    if (alias.matchType === 'exact') {
      if (alias.normalizedLabel === normalized) {
        return alias.productId ?? null;
      }
      continue;
    }
    if (alias.matchType === 'contains') {
      if (normalized.includes(alias.normalizedLabel)) {
        return alias.productId ?? null;
      }
      continue;
    }
    if (alias.matchType === 'regex') {
      try {
        const matcher = new RegExp(alias.label, 'i');
        if (matcher.test(value)) {
          return alias.productId ?? null;
        }
      } catch (error) {
        logger.warn(`Invalid product alias regex: ${alias.label}`, error);
      }
    }
  }
  return null;
};

const stripEcwidItemSuffix = (value: string): string => value.replace(/-\d+$/, '');

const extractEcwidItemOptions = (item: EcwidOrder['items'][number] | undefined): string[] => {
  if (!item) {
    return [];
  }

  const results: string[] = [];

  (item.selectedOptions ?? []).forEach((entry) => {
    const value = entry.selectionTitle ?? entry.value ?? entry.name;
    if (value !== null && value !== undefined) {
      const normalized = String(value).trim();
      if (normalized) {
        results.push(normalized);
      }
    }
  });

  (item.options ?? []).forEach((entry) => {
    if (entry.selections && entry.selections.length > 0) {
      entry.selections.forEach((selection) => {
        const value = selection.selectionTitle ?? selection.value ?? selection.name;
        if (value !== null && value !== undefined) {
          const normalized = String(value).trim();
          if (normalized) {
            results.push(normalized);
          }
        }
      });
      return;
    }
    const value = entry.value ?? entry.name;
    if (value !== null && value !== undefined) {
      const normalized = String(value).trim();
      if (normalized) {
        results.push(normalized);
      }
    }
  });

  return results;
};

type BookingEmailQueryParams = QueryParams & {
  limit?: string;
  offset?: string;
  includeTotal?: string;
  search?: string;
  subject?: string;
  from?: string;
  to?: string;
  status?: string;
  messageId?: string;
  threadId?: string;
};

type BookingMailboxQueryParams = {
  email?: string;
  limit?: string;
  pageToken?: string;
};

type BulkEmailReprocessBody = {
  messageIds?: string[];
  pickupFrom?: string;
  pickupTo?: string;
  limit?: number;
};

type BackfillEmailRequestBody = {
  pickupFrom?: string;
  pickupTo?: string;
  batchSize?: number;
  query?: string;
};

type SendBookingEmailBody = {
  to?: unknown;
  subject?: unknown;
  body?: unknown;
  templateId?: unknown;
  templateContext?: Record<string, unknown> | null;
  htmlBodyOverride?: unknown;
  textBodyOverride?: unknown;
};

type RenderedEmailResult = {
  templateId: number | null;
  templateType: EmailTemplateType | null;
  subject: string;
  textBody: string;
  htmlBody: string | null;
};

type CreateEmailTemplateBody = {
  name?: unknown;
  description?: unknown;
  templateType?: unknown;
  subjectTemplate?: unknown;
  bodyTemplate?: unknown;
  isActive?: unknown;
};

type UpdateEmailTemplateBody = {
  name?: unknown;
  description?: unknown;
  templateType?: unknown;
  subjectTemplate?: unknown;
  bodyTemplate?: unknown;
  isActive?: unknown;
};

type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  body?: { size?: number; data?: string | null };
  parts?: GmailMessagePart[];
};

type StoredGmailMessage = {
  payload?: GmailMessagePart;
};

const EMAIL_DEFAULT_LIMIT = 50;
const EMAIL_MAX_LIMIT = 1000;
const MAILBOX_DEFAULT_LIMIT = 25;
const MAILBOX_MAX_LIMIT = 100;
const EMAIL_ADDRESS_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_TEMPLATE_TYPES: EmailTemplateType[] = ['plain_text', 'react_email'];
const FALLBACK_BOOKING_QUERY =
  '(subject:(booking OR reservation OR "new order" OR "booking detail change" OR rebooked) OR from:(ecwid.com OR fareharbor.com OR viator.com OR getyourguide.com OR xperiencepoland.com OR airbnb.com OR airbnbmail.com))';

const resolveBookingQuery = (): string =>
  (getConfigValue('BOOKING_GMAIL_QUERY') as string) ?? FALLBACK_BOOKING_QUERY;

const clampEmailLimit = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return EMAIL_DEFAULT_LIMIT;
  }
  return Math.min(parsed, EMAIL_MAX_LIMIT);
};

const parseEmailOffset = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
};

const parseEmailLimitParam = (value: unknown, fallback: number): number => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, EMAIL_MAX_LIMIT);
};

const parseMailboxLimitParam = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return MAILBOX_DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAILBOX_MAX_LIMIT);
};

const sanitizeHeaderValue = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();

const parseOptionalInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const normalizeEmailTemplateType = (value: unknown): EmailTemplateType | null => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (EMAIL_TEMPLATE_TYPES.includes(normalized as EmailTemplateType)) {
    return normalized as EmailTemplateType;
  }
  return null;
};

const normalizeOptionalString = (value: unknown): string | null => {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeTemplateName = (value: unknown): string | null => {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
};

const normalizeTemplateContext = (value: unknown): EmailTemplateContext => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const sanitizeValue = (input: unknown, depth = 0): unknown => {
    if (depth > 8) {
      return null;
    }
    if (
      input === null ||
      input === undefined ||
      typeof input === 'string' ||
      typeof input === 'number' ||
      typeof input === 'boolean'
    ) {
      return input;
    }
    if (Array.isArray(input)) {
      return input.map((entry) => sanitizeValue(entry, depth + 1));
    }
    if (typeof input === 'object') {
      return Object.entries(input as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, raw]) => {
        const normalizedKey = String(key ?? '').trim();
        if (!normalizedKey) {
          return acc;
        }
        acc[normalizedKey] = sanitizeValue(raw, depth + 1);
        return acc;
      }, {});
    }
    return null;
  };

  return Object.entries(value as Record<string, unknown>).reduce<EmailTemplateContext>((acc, [key, raw]) => {
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey) {
      return acc;
    }
    acc[normalizedKey] = sanitizeValue(raw, 0);
    return acc;
  }, {});
};

const enrichTemplateContextAliases = (context: EmailTemplateContext): EmailTemplateContext => {
  const normalized: EmailTemplateContext = { ...context };
  const toFiniteNumber = (value: unknown, fallback = 0): number => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const toNonNegativeInt = (value: unknown, fallback = 0): number =>
    Math.max(0, Math.round(toFiniteNumber(value, fallback)));
  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  };
  const normalizeAddonNameKey = (value: unknown): string =>
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  const buildRefundAddonRow = (
    rawValue: unknown,
    fallbackName: string,
    fallbackQuantity = 0,
    fallbackAmount = 0,
  ): Record<string, unknown> => {
    const record = asRecord(rawValue);
    const name = normalizeOptionalString(record?.name) ?? fallbackName;
    const bookedQty = toNonNegativeInt(record?.bookedQty ?? record?.qty, fallbackQuantity);
    const refundQty = toNonNegativeInt(record?.refundQty ?? record?.quantity, 0);
    const amount = toFiniteNumber(record?.amount, fallbackAmount);
    const unitPrice = toFiniteNumber(record?.unitPrice, 0);
    return {
      name,
      qty: bookedQty,
      quantity: refundQty,
      bookedQty,
      refundQty,
      unitPrice,
      amount,
    };
  };

  const resolveStringAlias = (keys: string[]): string | null => {
    for (const key of keys) {
      const value = normalizeOptionalString(normalized[key]);
      if (value) {
        return value;
      }
    }
    return null;
  };

  const bookingReference = resolveStringAlias(['bookingReference', 'bookingId', 'platformBookingId', 'reservationId']);
  if (bookingReference) {
    if (!normalizeOptionalString(normalized.bookingReference)) {
      normalized.bookingReference = bookingReference;
    }
    if (!normalizeOptionalString(normalized.bookingId)) {
      normalized.bookingId = bookingReference;
    }
    if (!normalizeOptionalString(normalized.platformBookingId)) {
      normalized.platformBookingId = bookingReference;
    }
    if (!normalizeOptionalString(normalized.reservationId)) {
      normalized.reservationId = bookingReference;
    }
  }

  const peopleCountRaw = normalized.peopleCount ?? normalized.quantity;
  const peopleCount = typeof peopleCountRaw === 'number' ? peopleCountRaw : Number.parseInt(String(peopleCountRaw ?? ''), 10);
  if (Number.isFinite(peopleCount)) {
    if (!Number.isFinite(Number(normalized.peopleCount))) {
      normalized.peopleCount = peopleCount;
    }
    if (!Number.isFinite(Number(normalized.quantity))) {
      normalized.quantity = peopleCount;
    }
  }

  if (!normalizeOptionalString(normalized.currency)) {
    normalized.currency = 'EUR';
  }

  const contextHint = `${String(normalized.templateKey ?? '')} ${String(normalized.partialReason ?? '')} ${String(
    normalized.refundReason ?? '',
  )}`.toLowerCase();
  const isRefundLikeContext =
    contextHint.includes('refund') ||
    normalized.refundedAmount !== undefined ||
    normalized.totalPaidAmount !== undefined ||
    normalized.isFullRefund !== undefined ||
    normalized.refundedAddons !== undefined;

  if (isRefundLikeContext) {
    const quantity = toNonNegativeInt(normalized.quantity ?? normalized.peopleCount, 0);
    const peopleRefundSource = asRecord(normalized.peopleRefund) ?? asRecord(normalized.peopleRefundDetails);
    const peopleRefund = {
      name: normalizeOptionalString(peopleRefundSource?.name) ?? 'People',
      qty: toNonNegativeInt(peopleRefundSource?.qty ?? peopleRefundSource?.bookedQty, quantity),
      quantity: toNonNegativeInt(peopleRefundSource?.quantity ?? peopleRefundSource?.refundQty, 0),
      bookedQty: toNonNegativeInt(peopleRefundSource?.bookedQty ?? peopleRefundSource?.qty, quantity),
      refundQty: toNonNegativeInt(peopleRefundSource?.refundQty ?? peopleRefundSource?.quantity, 0),
      unitPrice: toFiniteNumber(peopleRefundSource?.unitPrice, 0),
      amount: toFiniteNumber(peopleRefundSource?.amount, 0),
    };
    normalized.peopleRefund = peopleRefund;
    if (!asRecord(normalized.peopleRefundDetails)) {
      normalized.peopleRefundDetails = peopleRefund;
    }
    if (!asRecord(normalized.peopleChange)) {
      normalized.peopleChange = {
        from: quantity,
        to: quantity,
        amount: 0,
      };
    }

    const addonRows = Array.isArray(normalized.refundedAddons)
      ? (normalized.refundedAddons as unknown[]).map((entry) => buildRefundAddonRow(entry, 'Add-On'))
      : [];
    const existingByName = (tokens: string[]): Record<string, unknown> | null =>
      addonRows.find((row) => {
        const key = normalizeAddonNameKey((row as Record<string, unknown>).name);
        return tokens.some((token) => key.includes(token));
      }) ?? null;
    const ensureByAlias = (
      aliasKey: 'cocktailsRefund' | 'tshirtsRefund' | 'photosRefund',
      tokens: string[],
      fallbackName: string,
    ): Record<string, unknown> => {
      const existing = existingByName(tokens);
      if (existing) {
        return existing;
      }
      const aliasFallback = buildRefundAddonRow(normalized[aliasKey], fallbackName);
      addonRows.push(aliasFallback);
      return aliasFallback;
    };

    const cocktailsRefund = ensureByAlias('cocktailsRefund', ['cocktail', 'drink'], 'Cocktails Add-On');
    const tshirtsRefund = ensureByAlias('tshirtsRefund', ['tshirt', 'shirt'], 'T-Shirts Add-On');
    const photosRefund = ensureByAlias('photosRefund', ['photo', 'picture', 'instantpic'], 'Photos Add-On');

    const refundedAmount = Math.max(0, toFiniteNumber(normalized.refundedAmount, 0));
    const hasPositiveRefundBreakdown = addonRows.some(
      (row) =>
        toFiniteNumber((row as Record<string, unknown>).amount, 0) > 0 ||
        toNonNegativeInt((row as Record<string, unknown>).refundQty, 0) > 0,
    );
    if (!hasPositiveRefundBreakdown && refundedAmount > 0) {
      addonRows.push(
        buildRefundAddonRow(
          {
            name: 'Manual adjustment',
            qty: 1,
            quantity: 1,
            bookedQty: 1,
            refundQty: 1,
            unitPrice: refundedAmount,
            amount: refundedAmount,
          },
          'Manual adjustment',
          1,
          refundedAmount,
        ),
      );
    }

    normalized.refundedAddons = addonRows;
    if (!Array.isArray(normalized.addons) || normalized.addons.length === 0) {
      normalized.addons = addonRows;
    }
    if (!Array.isArray(normalized.addonsBreakdown) || normalized.addonsBreakdown.length === 0) {
      normalized.addonsBreakdown = addonRows;
    }
    normalized.cocktailsRefund = cocktailsRefund;
    normalized.tshirtsRefund = tshirtsRefund;
    normalized.photosRefund = photosRefund;
    const refundedAddonsByType = asRecord(normalized.refundedAddonsByType) ?? {};
    normalized.refundedAddonsByType = {
      ...refundedAddonsByType,
      cocktails: refundedAddonsByType.cocktails ?? cocktailsRefund,
      tshirts: refundedAddonsByType.tshirts ?? tshirtsRefund,
      photos: refundedAddonsByType.photos ?? photosRefund,
    };
  }

  return normalized;
};

const toEmailTemplateResponse = (template: EmailTemplate) => ({
  id: template.id,
  name: template.name,
  description: template.description,
  templateType: template.templateType,
  subjectTemplate: template.subjectTemplate,
  bodyTemplate: template.bodyTemplate,
  isActive: template.isActive,
  createdBy: template.createdBy,
  updatedBy: template.updatedBy,
});

const resolveRenderedEmailFromPayload = async (payload: SendBookingEmailBody): Promise<RenderedEmailResult> => {
  const subjectInput = sanitizeHeaderValue(String(payload?.subject ?? ''));
  const bodyInput = String(payload?.body ?? '').trim();
  const htmlBodyOverrideInput = normalizeOptionalString(payload?.htmlBodyOverride);
  const textBodyOverrideInput = normalizeOptionalString(payload?.textBodyOverride);
  const templateId = parseOptionalInteger(payload?.templateId);
  const normalizedContext = enrichTemplateContextAliases(normalizeTemplateContext(payload?.templateContext));
  const reactTemplateSourceRaw = normalizedContext.reactTemplateSource;
  const reactTemplateSource =
    typeof reactTemplateSourceRaw === 'string' && reactTemplateSourceRaw.trim().length > 0
      ? reactTemplateSourceRaw
      : null;

  let subject = subjectInput;
  let textBody = bodyInput;
  let htmlBody: string | null = null;
  let templateType: EmailTemplateType | null = null;

  if (!templateId && reactTemplateSource) {
    let renderedTemplate: Awaited<ReturnType<typeof renderReactEmailTemplateSource>>;
    try {
      renderedTemplate = await renderReactEmailTemplateSource({
        source: reactTemplateSource,
        subject: subjectInput,
        context: normalizedContext,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to render React Email template source';
      throw new HttpError(400, message);
    }
    subject = sanitizeHeaderValue(renderedTemplate.subject);
    textBody = renderedTemplate.textBody;
    htmlBody = renderedTemplate.htmlBody;
    templateType = renderedTemplate.templateType;
  }

  if (templateId) {
    const template = await EmailTemplate.findByPk(templateId);
    if (!template) {
      throw new HttpError(404, 'Email template not found');
    }
    if (!template.isActive) {
      throw new HttpError(400, 'Email template is inactive');
    }

    let renderedTemplate: Awaited<ReturnType<typeof renderStoredEmailTemplate>>;
    try {
      renderedTemplate = await renderStoredEmailTemplate({
        template,
        context: normalizedContext,
        subjectOverride: subjectInput || null,
        bodyOverride: bodyInput || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to render selected email template';
      throw new HttpError(400, message);
    }

    subject = sanitizeHeaderValue(renderedTemplate.subject);
    textBody = renderedTemplate.textBody;
    htmlBody = renderedTemplate.htmlBody;
    templateType = renderedTemplate.templateType;
  }

  if (!subject) {
    throw new HttpError(400, 'subject is required');
  }
  if (htmlBodyOverrideInput || textBodyOverrideInput) {
    const htmlBodyOverride = htmlBodyOverrideInput ?? null;
    const textBodyOverride = textBodyOverrideInput ?? (htmlBodyOverride ? stripHtmlToText(htmlBodyOverride) : null);
    if (!textBodyOverride) {
      throw new HttpError(400, 'body is required');
    }
    return {
      templateId: templateId ?? null,
      templateType,
      subject,
      textBody: textBodyOverride,
      htmlBody: htmlBodyOverride ?? htmlBody,
    };
  }
  if (!textBody) {
    throw new HttpError(400, 'body is required');
  }

  return {
    templateId: templateId ?? null,
    templateType,
    subject,
    textBody,
    htmlBody,
  };
};

const resolveEmailRange = (query: QueryParams): { start: Date | null; end: Date | null } => {
  const { start, end } = resolveRange(query);
  const startMoment = start ? dayjs(start).startOf('day') : null;
  const endMoment = end ? dayjs(end).endOf('day') : null;
  return {
    start: startMoment?.isValid() ? startMoment.toDate() : null,
    end: endMoment?.isValid() ? endMoment.toDate() : null,
  };
};

const hasWhereConditions = (where: WhereOptions): boolean => {
  return Object.keys(where).length > 0 || Object.getOwnPropertySymbols(where).length > 0;
};

const buildBookingEmailRangeWhere = (start: Date | null, end: Date | null): WhereOptions => {
  if (start && end) {
    return {
      [Op.or]: [
        { receivedAt: { [Op.between]: [start, end] } },
        { receivedAt: null, internalDate: { [Op.between]: [start, end] } },
      ],
    };
  }
  if (start) {
    return {
      [Op.or]: [
        { receivedAt: { [Op.gte]: start } },
        { receivedAt: null, internalDate: { [Op.gte]: start } },
      ],
    };
  }
  if (end) {
    return {
      [Op.or]: [
        { receivedAt: { [Op.lte]: end } },
        { receivedAt: null, internalDate: { [Op.lte]: end } },
      ],
    };
  }
  return {};
};

const normalizeEmailFilterValue = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildEmailLikeValue = (value: string): string => `%${escapeSearchTerm(value)}%`;

const buildBookingEmailFilterWhere = (query: BookingEmailQueryParams): WhereOptions => {
  const clauses: WhereOptions[] = [];

  const status = normalizeEmailFilterValue(query.status ?? null);
  if (status) {
    clauses.push({ ingestionStatus: status.toLowerCase() });
  }

  const messageId = normalizeEmailFilterValue(query.messageId ?? null);
  if (messageId) {
    clauses.push({ messageId: { [Op.iLike]: buildEmailLikeValue(messageId) } });
  }

  const threadId = normalizeEmailFilterValue(query.threadId ?? null);
  if (threadId) {
    clauses.push({ threadId: { [Op.iLike]: buildEmailLikeValue(threadId) } });
  }

  const subject = normalizeEmailFilterValue(query.subject ?? null);
  if (subject) {
    clauses.push({ subject: { [Op.iLike]: buildEmailLikeValue(subject) } });
  }

  const from = normalizeEmailFilterValue(query.from ?? null);
  if (from) {
    clauses.push({ fromAddress: { [Op.iLike]: buildEmailLikeValue(from) } });
  }

  const to = normalizeEmailFilterValue(query.to ?? null);
  if (to) {
    clauses.push({ toAddresses: { [Op.iLike]: buildEmailLikeValue(to) } });
  }

  const search = normalizeEmailFilterValue(query.search ?? null);
  if (search) {
    const likeValue = buildEmailLikeValue(search);
    clauses.push({
      [Op.or]: [
        { messageId: { [Op.iLike]: likeValue } },
        { subject: { [Op.iLike]: likeValue } },
        { fromAddress: { [Op.iLike]: likeValue } },
        { toAddresses: { [Op.iLike]: likeValue } },
        { snippet: { [Op.iLike]: likeValue } },
      ],
    });
  }

  if (clauses.length === 0) {
    return {};
  }
  if (clauses.length === 1) {
    return clauses[0];
  }
  return { [Op.and]: clauses };
};

const mergeBookingEmailWhere = (base: WhereOptions, extra: WhereOptions): WhereOptions => {
  const baseHasConditions = hasWhereConditions(base);
  const extraHasConditions = hasWhereConditions(extra);
  if (baseHasConditions && extraHasConditions) {
    return { [Op.and]: [base, extra] };
  }
  if (baseHasConditions) {
    return base;
  }
  if (extraHasConditions) {
    return extra;
  }
  return {};
};

const decodeBase64Url = (input: string): string => {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : normalized + '='.repeat(4 - padding);
  return Buffer.from(padded, 'base64').toString('utf-8');
};

const stripHtmlToText = (html: string): string => {
  if (!html) {
    return '';
  }
  const withoutBlocks = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|li|tr|td)>/gi, '$&\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return withoutBlocks.replace(/\s+/g, ' ').trim();
};

const collectMessageBodies = (
  payload?: GmailMessagePart,
): { textBody: string | null; htmlBody: string | null } => {
  if (!payload) {
    return { textBody: null, htmlBody: null };
  }
  const texts: string[] = [];
  const htmls: string[] = [];

  const traverse = (part?: GmailMessagePart): void => {
    if (!part) {
      return;
    }
    const data = part.body?.data;
    if (data && part.mimeType) {
      const decoded = decodeBase64Url(data);
      if (part.mimeType.startsWith('text/plain')) {
        texts.push(decoded);
      } else if (part.mimeType.startsWith('text/html')) {
        htmls.push(decoded);
      }
    }
    if (part.parts) {
      for (const child of part.parts) {
        traverse(child);
      }
    }
  };

  traverse(payload);
  return {
    textBody: texts.length > 0 ? texts.join('\n') : null,
    htmlBody: htmls.length > 0 ? htmls.join('\n') : null,
  };
};

const parsePickupMoment = (pickupDate: string, pickupTime: string): dayjs.Dayjs | null => {
  const safeDate = pickupDate?.trim();
  const safeTime = pickupTime?.trim();
  if (!safeDate || !safeTime) {
    return null;
  }

  const patterns = ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD H:mm'];
  for (const pattern of patterns) {
    const candidate = dayjs.tz(`${safeDate} ${safeTime}`, pattern, STORE_TIMEZONE);
    if (candidate.isValid()) {
      return candidate;
    }
  }
  return null;
};

const buildPickupExtraFieldPayload = (
  fields: EcwidExtraField[] | undefined,
  nextValue: string,
): EcwidExtraField => {
  const template =
    fields?.find((field) => field?.id === 'ecwid_order_pickup_time' || field?.name === 'ecwid_order_pickup_time') ??
    null;

  if (!template) {
    return {
      id: 'ecwid_order_pickup_time',
      value: nextValue,
      customerInputType: 'DATETIME',
      title: 'Pickup date and time',
      orderDetailsDisplaySection: 'shipping_info',
      orderBy: '0',
    };
  }

  return {
    ...template,
    value: nextValue,
    customerInputType: template.customerInputType ?? 'DATETIME',
    title: template.title ?? template.name ?? 'Pickup date and time',
    orderDetailsDisplaySection: template.orderDetailsDisplaySection ?? 'shipping_info',
    orderBy: template.orderBy ?? '0',
  };
};

const canonicalizeProductKey = (booking: Booking): string | null => {
  const label = prettifyProductName(booking);
  const labelKey = canonicalizeProductKeyFromLabel(label ?? null);
  if (labelKey) {
    return labelKey;
  }
  const sources = [
    label,
    booking.product?.name ?? null,
    booking.productName ?? null,
    booking.productVariant ?? null,
  ];
  return canonicalizeProductKeyFromSources(sources);
};

const prettifyProductName = (booking: Booking): string | null => {
  const directName = booking.product?.name ?? null;
  if (directName && directName.trim().length > 0) {
    return directName.trim();
  }
  const sources = [booking.productName ?? null, booking.productVariant ?? null];
  return canonicalizeProductLabelFromSources(sources);
};

const deriveProductId = (booking: Booking): string => {
  const canonicalKey = canonicalizeProductKey(booking);
  if (canonicalKey) {
    return canonicalKey;
  }

  if (booking.productId) {
    return String(booking.productId);
  }

  return `${booking.platform}-${booking.id}`;
};

const escapeSearchTerm = (input: string): string =>
  input.replace(/[%_]/g, (match) => `\\${match}`);

const buildSearchWhere = (term: string): WhereOptions => {
  const safeTerm = escapeSearchTerm(term);
  const likeValue = `%${safeTerm}%`;
  return {
    [Op.or]: [
      { platformBookingId: { [Op.iLike]: likeValue } },
      { guestPhone: { [Op.iLike]: likeValue } },
      { guestEmail: { [Op.iLike]: likeValue } },
      { guestFirstName: { [Op.iLike]: likeValue } },
      { guestLastName: { [Op.iLike]: likeValue } },
      sequelizeWhere(fn('concat_ws', ' ', col('guest_first_name'), col('guest_last_name')), {
        [Op.iLike]: likeValue,
      }),
    ],
  };
};

const buildCustomerName = (booking: Booking): string => {
  const nameParts = [booking.guestFirstName, booking.guestLastName].filter(Boolean);
  if (nameParts.length > 0) {
    return nameParts.join(' ');
  }
  if (booking.guestEmail) {
    return booking.guestEmail;
  }
  if (booking.guestPhone) {
    return booking.guestPhone;
  }
  return `Booking #${booking.id}`;
};

const splitCustomerName = (value?: string | null): { firstName: string | null; lastName: string | null } => {
  if (!value) {
    return { firstName: null, lastName: null };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { firstName: null, lastName: null };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
};

const resolveChannelIdByName = async (name: string): Promise<number | null> => {
  const channel = await Channel.findOne({
    where: { name: { [Op.iLike]: name } },
    attributes: ['id'],
  });
  return channel?.id ?? null;
};

const resolveProductIdByName = async (name?: string | null): Promise<number | null> => {
  if (!name) {
    return null;
  }
  const canonical = canonicalizeProductLabelFromSources([name]);
  const candidates = [canonical, name].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const record = await Product.findOne({
      where: { name: { [Op.iLike]: candidate } },
      attributes: ['id'],
    });
    if (record?.id) {
      return record.id;
    }
  }
  return null;
};

const pickPrimaryEcwidOrder = (orders: UnifiedOrder[]): UnifiedOrder | null => {
  if (orders.length === 0) {
    return null;
  }
  if (orders.length === 1) {
    return orders[0];
  }
  const withMoment = orders
    .map((order) => ({
      order,
      moment: order.pickupDateTime ? dayjs(order.pickupDateTime) : null,
    }))
    .sort((a, b) => {
      if (a.moment && b.moment) {
        if (a.moment.isBefore(b.moment)) return -1;
        if (a.moment.isAfter(b.moment)) return 1;
      } else if (a.moment && !b.moment) {
        return -1;
      } else if (!a.moment && b.moment) {
        return 1;
      }
      return 0;
    });
  return withMoment[0]?.order ?? orders[0];
};

const normalizeExtras = (snapshot: unknown): OrderExtras => {
  if (!snapshot || typeof snapshot !== 'object') {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  const extras = (snapshot as { extras?: Partial<OrderExtras> }).extras;
  if (!extras) {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  return {
    tshirts: Number(extras.tshirts) || 0,
    cocktails: Number(extras.cocktails) || 0,
    photos: Number(extras.photos) || 0,
  };
};

const normalizeAttendedExtras = (snapshot: unknown): OrderExtras => {
  if (!snapshot || typeof snapshot !== 'object') {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  return {
    tshirts: Math.max(0, Math.round(Number((snapshot as Record<string, unknown>).tshirts) || 0)),
    cocktails: Math.max(0, Math.round(Number((snapshot as Record<string, unknown>).cocktails) || 0)),
    photos: Math.max(0, Math.round(Number((snapshot as Record<string, unknown>).photos) || 0)),
  };
};

const deriveBookingPartySize = (booking: Booking): number => {
  const fromTotal = Number(booking.partySizeTotal);
  if (Number.isFinite(fromTotal) && fromTotal > 0) {
    return Math.max(0, Math.round(fromTotal));
  }
  const fromBreakdown = Number(booking.partySizeAdults ?? 0) + Number(booking.partySizeChildren ?? 0);
  if (Number.isFinite(fromBreakdown) && fromBreakdown > 0) {
    return Math.max(0, Math.round(fromBreakdown));
  }
  return 0;
};

const resolveCheckInAllowance = (booking: Booking): number =>
  CHECKIN_ALLOWED_STATUSES.has(booking.status) ? deriveBookingPartySize(booking) : 0;

const normalizeAttendanceStatus = (value: unknown): BookingAttendanceStatus => {
  if (typeof value === 'string' && BOOKING_ATTENDANCE_STATUSES.includes(value as BookingAttendanceStatus)) {
    return value as BookingAttendanceStatus;
  }
  return DEFAULT_ATTENDANCE_STATUS;
};

const resolveAttendanceStatus = (
  booking: Booking,
  attendedTotal: number,
  hasAttendedExtrasValue: boolean,
  options: { markNoShowWhenAbsent?: boolean } = {},
): BookingAttendanceStatus => {
  const allowance = resolveCheckInAllowance(booking);
  if (allowance <= 0) {
    return DEFAULT_ATTENDANCE_STATUS;
  }
  const normalizedAttendedTotal = clampInt(attendedTotal, 0, allowance);
  if (normalizedAttendedTotal >= allowance) {
    return 'checked_in_full';
  }
  if (normalizedAttendedTotal > 0 || hasAttendedExtrasValue) {
    return 'checked_in_partial';
  }
  if (options.markNoShowWhenAbsent) {
    return 'no_show';
  }
  return DEFAULT_ATTENDANCE_STATUS;
};

const clampInt = (value: number, min: number, max: number): number => {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) {
    return min;
  }
  return Math.min(Math.max(rounded, min), max);
};

const applyBookingAttendanceUpdate = async (
  booking: Booking,
  payload: UpdateBookingAttendanceBody,
  actorId: number | null | undefined,
): Promise<BookingAttendanceUpdateResponse> => {
  const hasAttendedTotal = Object.prototype.hasOwnProperty.call(payload, 'attendedTotal');
  const hasAttendedExtras = Object.prototype.hasOwnProperty.call(payload, 'attendedExtras');

  if (!hasAttendedTotal && !hasAttendedExtras) {
    throw new HttpError(400, 'attendedTotal or attendedExtras must be provided');
  }

  const allowance = resolveCheckInAllowance(booking);

  const currentAttended = Number(booking.attendedTotal ?? 0);
  let nextAttendedTotal = Number.isFinite(currentAttended) ? Math.max(0, Math.round(currentAttended)) : 0;
  if (hasAttendedTotal) {
    const parsed = Number(payload.attendedTotal);
    if (!Number.isFinite(parsed)) {
      throw new HttpError(400, 'attendedTotal must be a number');
    }
    nextAttendedTotal = clampInt(parsed, 0, allowance);
  } else {
    nextAttendedTotal = clampInt(nextAttendedTotal, 0, allowance);
  }

  const purchasedExtras = normalizeExtras(booking.addonsSnapshot ?? undefined);
  const nextAttendedExtras = normalizeAttendedExtras(booking.attendedAddonsSnapshot ?? undefined);
  if (hasAttendedExtras) {
    const rawExtras = payload.attendedExtras;
    if (!rawExtras || typeof rawExtras !== 'object') {
      throw new HttpError(400, 'attendedExtras must be an object');
    }
    const rawEntries = rawExtras as Record<string, unknown>;
    for (const key of ['tshirts', 'cocktails', 'photos'] as const) {
      if (!Object.prototype.hasOwnProperty.call(rawEntries, key)) {
        continue;
      }
      const parsed = Number(rawEntries[key]);
      if (!Number.isFinite(parsed)) {
        throw new HttpError(400, `attendedExtras.${key} must be a number`);
      }
      const purchased = Math.max(0, Math.round(Number(purchasedExtras[key]) || 0));
      nextAttendedExtras[key] = clampInt(parsed, 0, purchased);
    }
  }

  booking.attendedTotal = nextAttendedTotal;
  const hasAttendedExtrasValue =
    nextAttendedExtras.tshirts > 0 ||
    nextAttendedExtras.cocktails > 0 ||
    nextAttendedExtras.photos > 0;
  booking.attendedAddonsSnapshot = hasAttendedExtrasValue ? nextAttendedExtras : null;
  const nextAttendanceStatus = resolveAttendanceStatus(booking, nextAttendedTotal, hasAttendedExtrasValue);
  booking.attendanceStatus = nextAttendanceStatus;

  const hasAttendance = nextAttendanceStatus === 'checked_in_full' || nextAttendanceStatus === 'checked_in_partial';
  booking.checkedInAt = hasAttendance ? new Date() : null;
  booking.checkedInBy = hasAttendance ? (actorId ?? booking.checkedInBy ?? null) : null;
  booking.updatedBy = actorId ?? booking.updatedBy;

  await booking.save();

  return {
    bookingId: booking.id,
    allowance,
    attendedTotal: nextAttendedTotal,
    attendedExtras: nextAttendedExtras,
    attendanceStatus: nextAttendanceStatus,
    remainingTotal: Math.max(allowance - nextAttendedTotal, 0),
    order: bookingToUnifiedOrder(booking),
  };
};

const coerceCount = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const extractPartyBreakdown = (
  snapshot?: Record<string, unknown> | null,
): { men: number | null; women: number | null } => {
  if (!snapshot || typeof snapshot !== 'object') {
    return { men: null, women: null };
  }
  const breakdown = (snapshot as { partyBreakdown?: { men?: unknown; women?: unknown } }).partyBreakdown;
  if (!breakdown || typeof breakdown !== 'object') {
    return { men: null, women: null };
  }
  return {
    men: coerceCount(breakdown.men),
    women: coerceCount(breakdown.women),
  };
};

const isAfterCutoffBySourceReceivedAt = (experienceDate: string, sourceReceivedAt: Date | null): boolean => {
  if (!sourceReceivedAt) {
    return false;
  }
  const sourceMoment = dayjs(sourceReceivedAt).tz(STORE_TIMEZONE);
  if (!sourceMoment.isValid()) {
    return false;
  }
  if (sourceMoment.format(DATE_FORMAT) !== experienceDate) {
    return false;
  }
  const cutoffMoment = dayjs.tz(
    `${experienceDate} ${AFTER_CUTOFF_TIME}`,
    'YYYY-MM-DD HH:mm:ss',
    STORE_TIMEZONE,
  );
  if (!cutoffMoment.isValid()) {
    return false;
  }
  return sourceMoment.isAfter(cutoffMoment);
};

const bookingToUnifiedOrder = (booking: Booking): UnifiedOrder | null => {
  const pickupMomentUtc = booking.experienceStartAt ? dayjs(booking.experienceStartAt) : null;
  const pickupMomentLocal =
    pickupMomentUtc?.isValid() && DISPLAY_TIMEZONE ? pickupMomentUtc.tz(DISPLAY_TIMEZONE) : pickupMomentUtc;
  const experienceDate =
    booking.experienceDate ??
    (pickupMomentLocal?.isValid()
      ? pickupMomentLocal.format(DATE_FORMAT)
      : pickupMomentUtc?.isValid()
        ? pickupMomentUtc.format(DATE_FORMAT)
        : null);

  if (!experienceDate) {
    return null;
  }

  const productId = deriveProductId(booking);
  const displayProductName = prettifyProductName(booking) ?? 'Unassigned product';
  const timeslot = pickupMomentLocal?.isValid() ? pickupMomentLocal.format('HH:mm') : '--:--';
  const snapshotBreakdown = extractPartyBreakdown(booking.addonsSnapshot ?? undefined);
  const fallbackTotal =
    booking.partySizeTotal ??
    (booking.partySizeAdults != null || booking.partySizeChildren != null
      ? (booking.partySizeAdults ?? 0) + (booking.partySizeChildren ?? 0)
      : null);
  let menCount = snapshotBreakdown.men;
  let womenCount = snapshotBreakdown.women;
  if (menCount === null && womenCount === null) {
    menCount = 0;
    womenCount = 0;
  } else {
    const adultsFallback = booking.partySizeAdults ?? booking.partySizeTotal ?? 0;
    const childrenFallback = booking.partySizeChildren ?? 0;
    if (menCount === null && womenCount !== null) {
      menCount =
        fallbackTotal !== null
          ? Math.max(fallbackTotal - womenCount, 0)
          : Math.max(adultsFallback - womenCount, 0);
    }
    if (womenCount === null && menCount !== null) {
      womenCount =
        fallbackTotal !== null
          ? Math.max(fallbackTotal - menCount, 0)
          : Math.max(childrenFallback, 0);
    }
    menCount = menCount ?? adultsFallback;
    womenCount = womenCount ?? childrenFallback;
    if (fallbackTotal !== null) {
      const combined = menCount + womenCount;
      if (combined > 0 && combined !== fallbackTotal) {
        const scale = fallbackTotal / combined;
        menCount = Math.max(Math.round(menCount * scale), 0);
        womenCount = Math.max(fallbackTotal - menCount, 0);
      }
      if (combined > 0 && menCount > fallbackTotal) {
        menCount = fallbackTotal;
        womenCount = 0;
      }
      if (combined > 0 && womenCount > fallbackTotal) {
        womenCount = fallbackTotal;
      }
    }
  }
  if (booking.status === 'rebooked') {
    menCount = 0;
    womenCount = 0;
  }
  let extras = normalizeExtras(booking.addonsSnapshot ?? undefined);
  if (booking.status === 'rebooked') {
    extras = { tshirts: 0, cocktails: 0, photos: 0 };
  }
  const combinedCount = menCount + womenCount;
  const quantity =
    booking.status === 'rebooked'
      ? 0
      : fallbackTotal ?? (combinedCount > 0 ? combinedCount : (booking.partySizeAdults ?? 0));
  const normalizedQuantity = Math.max(0, Math.round(Number(quantity) || 0));
  const rawAttendedTotal = Number(booking.attendedTotal ?? 0);
  const normalizedAttendedTotal = Number.isFinite(rawAttendedTotal)
    ? Math.max(0, Math.round(rawAttendedTotal))
    : 0;
  const attendedTotal = Math.min(normalizedAttendedTotal, normalizedQuantity);
  const remainingTotal = Math.max(resolveCheckInAllowance(booking) - attendedTotal, 0);
  const attendedExtras = normalizeAttendedExtras(booking.attendedAddonsSnapshot ?? undefined);
  const sourceReceivedAtIso = booking.sourceReceivedAt ? dayjs(booking.sourceReceivedAt).toISOString() : null;
  const isAfterCutoff = isAfterCutoffBySourceReceivedAt(experienceDate, booking.sourceReceivedAt ?? null);

  return {
    id: String(booking.id),
    platformBookingId: booking.platformBookingId,
    platformBookingUrl: booking.rawPayloadLocation ?? null,
    productId,
    productName: displayProductName,
    date: experienceDate,
    timeslot,
    quantity: normalizedQuantity,
    menCount,
    womenCount,
    customerName: buildCustomerName(booking),
    customerPhone: booking.guestPhone ?? undefined,
    customerEmail: booking.guestEmail ?? undefined,
    platform: booking.platform,
    pickupDateTime: pickupMomentUtc?.isValid() ? pickupMomentUtc.toISOString() : undefined,
    extras,
    attendedTotal,
    attendedExtras,
    remainingTotal,
    sourceReceivedAt: sourceReceivedAtIso,
    isAfterCutoff,
    status: booking.status,
    attendanceStatus: normalizeAttendanceStatus(booking.attendanceStatus),
    rawData: {
      bookingId: booking.id,
      platform: booking.platform,
      channelId: booking.channelId,
      currency: booking.currency ?? null,
      paymentStatus: booking.paymentStatus,
      baseAmount: booking.baseAmount,
      addonsAmount: booking.addonsAmount,
      discountAmount: booking.discountAmount,
      refundedAmount: booking.refundedAmount,
      refundedCurrency: booking.refundedCurrency ?? null,
      priceGross: booking.priceGross,
      priceNet: booking.priceNet,
      commissionAmount: booking.commissionAmount,
      commissionRate: booking.commissionRate,
      partySizeTotal: booking.partySizeTotal,
      attendedTotal: booking.attendedTotal,
      experienceDate: booking.experienceDate,
      experienceStartAt: booking.experienceStartAt ? dayjs(booking.experienceStartAt).toISOString() : null,
      statusChangedAt: booking.statusChangedAt ? dayjs(booking.statusChangedAt).toISOString() : null,
      cancelledAt: booking.cancelledAt ? dayjs(booking.cancelledAt).toISOString() : null,
      sourceReceivedAt: booking.sourceReceivedAt ? dayjs(booking.sourceReceivedAt).toISOString() : null,
    },
  };
};

const collectProducts = (orders: UnifiedOrder[]): UnifiedProduct[] => {
  const map = new Map<string, UnifiedProduct>();

  orders.forEach((order) => {
    if (!map.has(order.productId)) {
      map.set(order.productId, {
        id: order.productId,
        name: order.productName,
        platform: order.platform,
      });
    }
  });

  return Array.from(map.values());
};

const parseMoneyLikeNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }
    const normalized = trimmed.replace(/\s+/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

const FREE_TICKET_REGEXES = [
  /(?:free|complimentary|comp)\s*tickets?\s*[:=-]?\s*(\d{1,4})/gi,
  /(\d{1,4})\s*(?:free|complimentary|comp)\s*tickets?/gi,
  /(?:ticket[s]?\s*free)\s*[:=-]?\s*(\d{1,4})/gi,
];

const extractFreeTicketsFromNote = (note: string | null | undefined): number => {
  if (!note || typeof note !== 'string') {
    return 0;
  }
  let total = 0;
  FREE_TICKET_REGEXES.forEach((regex) => {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null = regex.exec(note);
    while (match) {
      const parsed = Number.parseInt(match[1] ?? '0', 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        total += parsed;
      }
      match = regex.exec(note);
    }
  });
  if (total === 0 && /(free|complimentary|comp)\s*tickets?/i.test(note)) {
    return 1;
  }
  return total;
};

const resolveCounterDateWhere = (start: string | null, end: string | null): WhereOptions => {
  const dateWhere: WhereOptions = {};
  if (start && end) {
    (dateWhere as { date?: unknown }).date = { [Op.between]: [start, end] };
  } else if (start) {
    (dateWhere as { date?: unknown }).date = { [Op.gte]: start };
  } else if (end) {
    (dateWhere as { date?: unknown }).date = { [Op.lte]: end };
  }
  return dateWhere;
};

export const listBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { start, end } = resolveRange(req.query as QueryParams);

    const where: WhereOptions = {};
    if (start && end) {
      where.experienceDate = { [Op.between]: [start, end] };
    } else if (start) {
      where.experienceDate = { [Op.gte]: start };
    } else if (end) {
      where.experienceDate = { [Op.lte]: end };
    }

    const rows = await Booking.findAll({
      where,
      include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
      order: [
        ['experienceDate', 'ASC'],
        ['experienceStartAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const orders = rows
      .map((booking) => bookingToUnifiedOrder(booking))
      .filter((order): order is UnifiedOrder => order !== null);

    const products = collectProducts(orders);
    const bookingIds = rows.map((booking) => Number(booking.id)).filter((id) => Number.isFinite(id) && id > 0);

    const bookingAddonsRows = bookingIds.length
      ? await BookingAddon.findAll({
          where: { bookingId: { [Op.in]: bookingIds } },
          include: [{ model: Addon, as: 'addon', attributes: ['id', 'name'], required: false }],
          order: [
            ['bookingId', 'ASC'],
            ['id', 'ASC'],
          ],
        })
      : [];

    const bookingAddons = bookingAddonsRows.map((addon) => {
      const plain = addon.get({ plain: true }) as {
        id: number;
        bookingId: number;
        addonId: number | null;
        platformAddonId: string | null;
        platformAddonName: string | null;
        quantity: number;
        unitPrice: string | null;
        totalPrice: string | null;
        currency: string | null;
        isIncluded: boolean;
        addon?: { id: number; name: string } | null;
      };

      const addonName =
        (plain.addon?.name && plain.addon.name.trim()) ||
        (plain.platformAddonName && plain.platformAddonName.trim()) ||
        'Unknown add-on';

      return {
        id: plain.id,
        bookingId: plain.bookingId,
        addonId: plain.addonId,
        addonName,
        platformAddonId: plain.platformAddonId,
        platformAddonName: plain.platformAddonName,
        quantity: Number.isFinite(Number(plain.quantity)) ? Number(plain.quantity) : 0,
        unitPrice: roundCurrency(parseMoneyLikeNumber(plain.unitPrice)),
        totalPrice: roundCurrency(parseMoneyLikeNumber(plain.totalPrice)),
        currency: plain.currency ?? null,
        isIncluded: Boolean(plain.isIncluded),
      };
    });

    const counters =
      start || end
        ? await Counter.findAll({
            where: resolveCounterDateWhere(start, end),
            attributes: ['id', 'date', 'notes'],
            include: [
              {
                model: CounterChannelMetric,
                as: 'metrics',
                required: false,
                where: { kind: 'cash_payment', tallyType: 'attended' },
                attributes: ['id', 'counterId', 'channelId', 'qty', 'kind', 'tallyType'],
                include: [{ model: Channel, as: 'channel', required: false, attributes: ['id', 'name'] }],
              },
            ],
            order: [
              ['date', 'ASC'],
              ['id', 'ASC'],
            ],
          })
        : [];

    type CashByChannelRow = { channelId: number | null; channelName: string; amount: number };
    type CashEntryRow = {
      counterId: number;
      counterDate: string;
      channelId: number | null;
      channelName: string;
      amount: number;
    };
    type FreeTicketEntryRow = { counterId: number; counterDate: string; count: number; note: string };

    let cashPaymentsTotal = 0;
    let freeTicketsTotal = 0;
    const cashByChannelMap = new Map<string, CashByChannelRow>();
    const cashEntries: CashEntryRow[] = [];
    const freeTicketEntries: FreeTicketEntryRow[] = [];

    counters.forEach((counter) => {
      const counterDate = String(counter.date);
      const note = typeof counter.notes === 'string' ? counter.notes.trim() : '';
      const freeTickets = extractFreeTicketsFromNote(note);
      if (freeTickets > 0) {
        freeTicketsTotal += freeTickets;
        freeTicketEntries.push({
          counterId: counter.id,
          counterDate,
          count: freeTickets,
          note,
        });
      }

      const metrics = (counter as unknown as { metrics?: CounterChannelMetric[] }).metrics ?? [];
      metrics.forEach((metric) => {
        const amount = roundCurrency(parseMoneyLikeNumber(metric.qty));
        if (!Number.isFinite(amount) || amount <= 0) {
          return;
        }
        const metricPlain = metric.get({ plain: true }) as {
          channelId?: number;
          channel?: { id?: number; name?: string } | null;
        };
        const channelId = Number.isFinite(Number(metricPlain.channelId)) ? Number(metricPlain.channelId) : null;
        const channelName =
          (metricPlain.channel?.name && String(metricPlain.channel.name).trim()) ||
          (channelId ? `Channel ${channelId}` : 'Unknown channel');
        const channelKey = `${channelId ?? 'unknown'}|${channelName}`;

        const channelBucket = cashByChannelMap.get(channelKey) ?? {
          channelId,
          channelName,
          amount: 0,
        };
        channelBucket.amount = roundCurrency(channelBucket.amount + amount);
        cashByChannelMap.set(channelKey, channelBucket);

        cashEntries.push({
          counterId: counter.id,
          counterDate,
          channelId,
          channelName,
          amount,
        });
        cashPaymentsTotal = roundCurrency(cashPaymentsTotal + amount);
      });
    });

    const cashByChannel = Array.from(cashByChannelMap.values())
      .map((entry) => ({ ...entry, amount: roundCurrency(entry.amount) }))
      .sort((a, b) => b.amount - a.amount || a.channelName.localeCompare(b.channelName));

    res.status(200).json({
      total: orders.length,
      count: orders.length,
      products,
      orders,
      bookingAddons,
      counterInsights: {
        currency: 'PLN',
        cashPaymentsTotal: roundCurrency(cashPaymentsTotal),
        cashByChannel,
        cashEntries,
        freeTicketsTotal,
        freeTicketEntries,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load bookings';
    res.status(500).json({ message });
  }
};

export const listBookingEmails = async (req: Request, res: Response): Promise<void> => {
  try {
    const { start, end } = resolveEmailRange(req.query as QueryParams);
    const limit = clampEmailLimit((req.query as BookingEmailQueryParams).limit);
    const offset = parseEmailOffset((req.query as BookingEmailQueryParams).offset);
    const includeTotalParam = (req.query as BookingEmailQueryParams).includeTotal;
    const includeTotal = String(includeTotalParam ?? 'true').toLowerCase() !== 'false';
    const rangeWhere = buildBookingEmailRangeWhere(start, end);
    const filterWhere = buildBookingEmailFilterWhere(req.query as BookingEmailQueryParams);
    const where = mergeBookingEmailWhere(rangeWhere, filterWhere);

    const queryOptions = {
      where,
      order: [
        [literal('COALESCE("received_at", "internal_date")'), 'DESC'],
        ['id', 'DESC'],
      ] as OrderItem[],
      limit,
      offset,
      attributes: [
        'id',
        'messageId',
        'threadId',
        'fromAddress',
        'toAddresses',
        'ccAddresses',
        'subject',
        'snippet',
        'receivedAt',
        'internalDate',
        'payloadSize',
        'labelIds',
        'ingestionStatus',
        'failureReason',
        'createdAt',
        'updatedAt',
      ],
    };

    let rows: BookingEmail[] = [];
    let total: number | null = null;
    if (includeTotal) {
      const [fetchedRows, count] = await Promise.all([
        BookingEmail.findAll(queryOptions),
        BookingEmail.count({ where }),
      ]);
      rows = fetchedRows;
      total = count;
    } else {
      rows = await BookingEmail.findAll(queryOptions);
    }
    const count = rows.length;
    const hasMore = includeTotal ? (offset + count < (total ?? 0)) : count === limit;

    res.status(200).json({
      total,
      count,
      limit,
      offset,
      hasMore,
      emails: rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load booking emails';
    res.status(500).json({ message });
  }
};

export const getBookingEmailPreview = async (req: Request, res: Response): Promise<void> => {
  try {
    const messageId = String(req.params?.messageId ?? '').trim();
    if (!messageId) {
      res.status(400).json({ message: 'messageId is required' });
      return;
    }

    const email = await BookingEmail.findOne({
      where: { messageId },
      attributes: [
        'id',
        'messageId',
        'threadId',
        'fromAddress',
        'toAddresses',
        'ccAddresses',
        'subject',
        'snippet',
        'receivedAt',
        'internalDate',
        'ingestionStatus',
        'failureReason',
        'rawPayload',
      ],
    });

    if (!email) {
      res.status(404).json({ message: 'Booking email not found' });
      return;
    }

    let message: StoredGmailMessage | null = null;
    if (email.rawPayload) {
      try {
        message = JSON.parse(email.rawPayload) as StoredGmailMessage;
      } catch (error) {
        message = null;
      }
    }

    const bodies = collectMessageBodies(message?.payload);
    const textBody = bodies.textBody ? bodies.textBody.trim() : null;
    const htmlBody = bodies.htmlBody ?? null;
    const htmlText = htmlBody ? stripHtmlToText(htmlBody).trim() : null;
    const previewText = textBody || htmlText || (email.snippet ? email.snippet.trim() : null) || null;

    const bookingEvents = await BookingEvent.findAll({
      where: {
        [Op.or]: [{ emailId: email.id }, { emailMessageId: email.messageId }],
      },
      include: [{ model: Booking, as: 'booking' }],
      order: [['id', 'DESC']],
    });

    const bookingMap = new Map<number, Booking>();
    bookingEvents.forEach((event) => {
      if (event.booking) {
        bookingMap.set(event.booking.id, event.booking);
      }
    });
    const bookings = Array.from(bookingMap.values()).map((booking) => booking.get({ plain: true }));
    const bookingEventsPayload = bookingEvents.map((event) => {
      const plain = event.get({ plain: true }) as unknown as Record<string, unknown>;
      delete plain.booking;
      delete plain.email;
      return plain;
    });
    const bookingIds = Array.from(bookingMap.keys());
    const bookingAddons = bookingIds.length
      ? await BookingAddon.findAll({
          where: { bookingId: { [Op.in]: bookingIds } },
          order: [
            ['bookingId', 'ASC'],
            ['id', 'ASC'],
          ],
        })
      : [];
    const bookingAddonsPayload = bookingAddons.map((addon) => addon.get({ plain: true }));

    res.status(200).json({
      id: email.id,
      messageId: email.messageId,
      threadId: email.threadId,
      fromAddress: email.fromAddress,
      toAddresses: email.toAddresses,
      ccAddresses: email.ccAddresses,
      subject: email.subject,
      snippet: email.snippet,
      receivedAt: email.receivedAt,
      internalDate: email.internalDate,
      ingestionStatus: email.ingestionStatus,
      failureReason: email.failureReason,
      gmailQuery: resolveBookingQuery(),
      bookings,
      bookingEvents: bookingEventsPayload,
      bookingAddons: bookingAddonsPayload,
      textBody,
      htmlBody,
      htmlText,
      previewText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load booking email preview';
    res.status(500).json({ message });
  }
};

export const listBookingMailboxEmails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const query = req.query as BookingMailboxQueryParams;
    const email = String(query?.email ?? '').trim().toLowerCase();
    if (!email) {
      res.status(400).json({ message: 'email is required' });
      return;
    }
    if (!EMAIL_ADDRESS_REGEX.test(email)) {
      res.status(400).json({ message: 'email must be a valid email address' });
      return;
    }

    const limit = parseMailboxLimitParam(query?.limit);
    const pageTokenRaw = String(query?.pageToken ?? '').trim();
    const pageToken = pageTokenRaw.length > 0 ? pageTokenRaw : null;

    const result = await listMailboxMessages({
      email,
      maxResults: limit,
      pageToken,
    });

    res.status(200).json({
      email,
      count: result.messages.length,
      nextPageToken: result.nextPageToken,
      messages: result.messages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load mailbox emails';
    res.status(500).json({ message });
  }
};

export const getMailboxEmailPreview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const messageId = String(req.params?.messageId ?? '').trim();
    if (!messageId) {
      res.status(400).json({ message: 'messageId is required' });
      return;
    }

    const payload = await fetchGmailMessagePayload(messageId);
    if (!payload) {
      res.status(404).json({ message: 'Email not found in Gmail mailbox' });
      return;
    }

    const htmlBody = payload.htmlBody ?? null;
    const textBody = payload.textBody?.trim() ? payload.textBody.trim() : null;
    const htmlText = htmlBody ? stripHtmlToText(htmlBody).trim() : null;
    const snippet = payload.message.snippet ? payload.message.snippet.trim() : null;
    const previewText = textBody || htmlText || snippet || null;

    const internalDateRaw = payload.message.internalDate ?? null;
    const internalDateNumber = internalDateRaw !== null ? Number(internalDateRaw) : NaN;
    const internalDateCandidate =
      Number.isFinite(internalDateNumber) && !Number.isNaN(internalDateNumber)
        ? new Date(internalDateNumber)
        : null;
    const internalDate =
      internalDateCandidate && !Number.isNaN(internalDateCandidate.getTime())
        ? internalDateCandidate.toISOString()
        : null;

    const labels = payload.message.labelIds ?? [];
    const ingestionStatus = labels.includes('SENT') ? 'sent' : 'received';

    res.status(200).json({
      id: 0,
      messageId,
      fromAddress: payload.headers['from'] ?? null,
      toAddresses: payload.headers['to'] ?? null,
      ccAddresses: payload.headers['cc'] ?? null,
      subject: payload.headers['subject'] ?? null,
      snippet,
      receivedAt: internalDate,
      internalDate,
      ingestionStatus,
      failureReason: null,
      previewText,
      textBody,
      htmlBody,
      htmlText,
      gmailQuery: null,
      labelIds: labels,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load mailbox email preview';
    res.status(500).json({ message });
  }
};

export const listEmailTemplates = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const templates = await EmailTemplate.findAll({
      order: [
        ['isActive', 'DESC'],
        ['name', 'ASC'],
      ],
    });

    res.status(200).json({
      count: templates.length,
      templates: templates.map(toEmailTemplateResponse),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load email templates';
    res.status(500).json({ message });
  }
};

export const createEmailTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const payload = req.body as CreateEmailTemplateBody;
    const name = normalizeTemplateName(payload?.name);
    const description = normalizeOptionalString(payload?.description);
    const templateType = normalizeEmailTemplateType(payload?.templateType);
    const subjectTemplate = normalizeOptionalString(payload?.subjectTemplate);
    const bodyTemplate = normalizeOptionalString(payload?.bodyTemplate);
    const isActive = payload?.isActive === undefined ? true : Boolean(payload?.isActive);

    if (!name) {
      res.status(400).json({ message: 'name is required' });
      return;
    }
    if (!templateType) {
      res.status(400).json({ message: `templateType must be one of ${EMAIL_TEMPLATE_TYPES.join(', ')}` });
      return;
    }
    if (!subjectTemplate) {
      res.status(400).json({ message: 'subjectTemplate is required' });
      return;
    }
    if (!bodyTemplate) {
      res.status(400).json({ message: 'bodyTemplate is required' });
      return;
    }

    const existing = await EmailTemplate.findOne({
      where: {
        name: { [Op.iLike]: name },
      },
      attributes: ['id'],
    });
    if (existing) {
      res.status(409).json({ message: 'An email template with the same name already exists' });
      return;
    }

    const template = EmailTemplate.build();
    template.name = name;
    template.description = description;
    template.templateType = templateType;
    template.subjectTemplate = subjectTemplate;
    template.bodyTemplate = bodyTemplate;
    template.isActive = isActive;
    template.createdBy = req.authContext?.id ?? null;
    template.updatedBy = req.authContext?.id ?? null;
    await template.save();

    res.status(201).json(toEmailTemplateResponse(template));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create email template';
    res.status(500).json({ message });
  }
};

export const updateEmailTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const templateId = parseOptionalInteger(req.params?.templateId);
    if (!templateId) {
      res.status(400).json({ message: 'templateId must be a valid positive integer' });
      return;
    }

    const template = await EmailTemplate.findByPk(templateId);
    if (!template) {
      res.status(404).json({ message: 'Email template not found' });
      return;
    }

    const payload = req.body as UpdateEmailTemplateBody;

    if (payload.name !== undefined) {
      const name = normalizeTemplateName(payload.name);
      if (!name) {
        res.status(400).json({ message: 'name cannot be empty' });
        return;
      }
      const conflict = await EmailTemplate.findOne({
        where: {
          id: { [Op.ne]: template.id },
          name: { [Op.iLike]: name },
        },
        attributes: ['id'],
      });
      if (conflict) {
        res.status(409).json({ message: 'An email template with the same name already exists' });
        return;
      }
      template.name = name;
    }

    if (payload.description !== undefined) {
      template.description = normalizeOptionalString(payload.description);
    }

    if (payload.templateType !== undefined) {
      const templateType = normalizeEmailTemplateType(payload.templateType);
      if (!templateType) {
        res.status(400).json({ message: `templateType must be one of ${EMAIL_TEMPLATE_TYPES.join(', ')}` });
        return;
      }
      template.templateType = templateType;
    }

    if (payload.subjectTemplate !== undefined) {
      const subjectTemplate = normalizeOptionalString(payload.subjectTemplate);
      if (!subjectTemplate) {
        res.status(400).json({ message: 'subjectTemplate cannot be empty' });
        return;
      }
      template.subjectTemplate = subjectTemplate;
    }

    if (payload.bodyTemplate !== undefined) {
      const bodyTemplate = normalizeOptionalString(payload.bodyTemplate);
      if (!bodyTemplate) {
        res.status(400).json({ message: 'bodyTemplate cannot be empty' });
        return;
      }
      template.bodyTemplate = bodyTemplate;
    }

    if (payload.isActive !== undefined) {
      template.isActive = Boolean(payload.isActive);
    }

    template.updatedBy = req.authContext?.id ?? null;
    await template.save();

    res.status(200).json(toEmailTemplateResponse(template));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update email template';
    res.status(500).json({ message });
  }
};

export const renderBookingEmailPreview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const payload = req.body as SendBookingEmailBody;
    const rendered = await resolveRenderedEmailFromPayload(payload);

    res.status(200).json({
      templateId: rendered.templateId,
      templateType: rendered.templateType,
      subject: rendered.subject,
      textBody: rendered.textBody,
      htmlBody: rendered.htmlBody,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ message: error.message, details: error.details });
      return;
    }
    const message = error instanceof Error ? error.message : 'Failed to render booking email preview';
    res.status(500).json({ message });
  }
};

export const sendBookingEmail = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const payload = req.body as SendBookingEmailBody;
    const to = String(payload?.to ?? '').trim();

    if (!to) {
      res.status(400).json({ message: 'to is required' });
      return;
    }
    if (!EMAIL_ADDRESS_REGEX.test(to)) {
      res.status(400).json({ message: 'to must be a valid email address' });
      return;
    }

    const rendered = await resolveRenderedEmailFromPayload(payload);

    const sendResult = await sendGmailMessage({
      to,
      subject: rendered.subject,
      textBody: rendered.textBody,
      htmlBody: rendered.htmlBody,
    });
    res.status(200).json({
      status: 'sent',
      id: sendResult.id,
      threadId: sendResult.threadId,
      templateType: rendered.templateType,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ message: error.message, details: error.details });
      return;
    }
    const message = error instanceof Error ? error.message : 'Failed to send booking email';
    res.status(500).json({ message });
  }
};

export const reprocessBookingEmail = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const messageId = String(req.params?.messageId ?? '').trim();
    if (!messageId) {
      res.status(400).json({ message: 'messageId is required' });
      return;
    }

    const result = await processBookingEmail(messageId, { force: true });
    res.status(200).json({ status: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reprocess booking email';
    res.status(500).json({ message });
  }
};

export const reprocessBookingEmails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const body = req.body as BulkEmailReprocessBody;
    const inputIds = Array.isArray(body?.messageIds) ? body.messageIds : [];
    const messageIds = inputIds
      .map((value) => String(value ?? '').trim())
      .filter((value) => value.length > 0);

    let resolvedMessageIds: string[] = [];
    if (messageIds.length > 0) {
      resolvedMessageIds = Array.from(new Set(messageIds));
    } else {
      const { start, end } = resolveEmailRange({ pickupFrom: body?.pickupFrom, pickupTo: body?.pickupTo });
      if (!start && !end) {
        res.status(400).json({ message: 'messageIds or pickupFrom/pickupTo is required' });
        return;
      }
      const limit = body?.limit !== undefined ? parseEmailLimitParam(body?.limit, EMAIL_MAX_LIMIT) : undefined;
      const rangeFilter: Record<symbol, unknown> = {};
      if (start) {
        rangeFilter[Op.gte] = start;
      }
      if (end) {
        rangeFilter[Op.lte] = end;
      }
      const where: WhereOptions = {
        [Op.or]: [{ receivedAt: rangeFilter }, { internalDate: rangeFilter }],
      };
      const emailRecords = await BookingEmail.findAll({
        where,
        attributes: ['messageId'],
        order: [
          ['receivedAt', 'DESC'],
          ['internalDate', 'DESC'],
          ['id', 'DESC'],
        ],
        ...(limit ? { limit } : {}),
      });
      resolvedMessageIds = emailRecords
        .map((record) => String(record.messageId ?? '').trim())
        .filter((value) => value.length > 0);
    }

    if (resolvedMessageIds.length === 0) {
      res.status(200).json({ total: 0, results: {} });
      return;
    }

    const summary: Record<string, number> = {};
    for (const id of resolvedMessageIds) {
      try {
        const result = await processBookingEmail(id, { force: true });
        summary[result] = (summary[result] ?? 0) + 1;
      } catch (error) {
        summary.failed = (summary.failed ?? 0) + 1;
      }
    }

    res.status(200).json({ total: resolvedMessageIds.length, results: summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reprocess booking emails';
    res.status(500).json({ message });
  }
};

export const backfillBookingEmails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const body = req.body as BackfillEmailRequestBody;
    const { start, end } = resolveEmailRange({ pickupFrom: body?.pickupFrom, pickupTo: body?.pickupTo });
    if (!start && !end) {
      res.status(400).json({ message: 'pickupFrom or pickupTo is required' });
      return;
    }

    void ingestAllBookingEmails({
      receivedAfter: start ?? undefined,
      receivedBefore: end ?? undefined,
      batchSize: body?.batchSize,
      query: body?.query,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[booking-email] Backfill failed: ${message}`);
    });

    res.status(202).json({ status: 'queued' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to backfill booking emails';
    res.status(500).json({ message });
  }
};

export const ingestBookingEmails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await ingestLatestBookingEmails();
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to ingest booking emails';
    res.status(500).json({ message });
  }
};

export const importEcwidBooking = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const orderId = String((req.body as { orderId?: string })?.orderId ?? '').trim();
    if (!orderId) {
      res.status(400).json({ message: 'orderId is required' });
      return;
    }

    const existing = await Booking.findOne({
      where: { platform: 'ecwid', platformBookingId: orderId },
      attributes: ['id'],
    });
    if (existing) {
      res.status(200).json({ status: 'exists', bookingId: existing.id });
      return;
    }

    const ecwidOrder = await getEcwidOrder(orderId);
    const { orders } = transformEcwidOrders([ecwidOrder]);
    const unified = pickPrimaryEcwidOrder(orders);
    if (!unified) {
      res.status(400).json({ message: 'Unable to derive booking from Ecwid order' });
      return;
    }

    const countsTotal = Number.isFinite(unified.quantity) ? unified.quantity : 0;
    const menCount = Number.isFinite(unified.menCount) ? unified.menCount : 0;
    const womenCount = Number.isFinite(unified.womenCount) ? unified.womenCount : 0;
    const totalPeople = menCount + womenCount > 0 ? menCount + womenCount : countsTotal;
    const pickupMoment = unified.pickupDateTime ? dayjs(unified.pickupDateTime) : null;
    const now = new Date();
    const { firstName, lastName } = splitCustomerName(unified.customerName);
    const channelId = await resolveChannelIdByName('Ecwid');
    const productId = await resolveProductIdByName(unified.productName);
    const addonsSnapshot = unified.extras ? { extras: unified.extras } : null;
    const userId =
      req.user && typeof req.user === 'object' && 'id' in req.user
        ? Number(req.user.id)
        : null;

    const payload = {
      platform: 'ecwid',
      platformBookingId: unified.platformBookingId,
      platformOrderId: unified.platformBookingId,
      status: 'confirmed',
      paymentStatus: 'unknown',
      statusChangedAt: now,
      experienceDate: unified.date,
      experienceStartAt: pickupMoment?.isValid() ? pickupMoment.toDate() : null,
      productId,
      productName: unified.productName ?? null,
      guestFirstName: firstName,
      guestLastName: lastName,
      guestPhone: unified.customerPhone ?? null,
      partySizeTotal: totalPeople || null,
      partySizeAdults: totalPeople || null,
      addonsSnapshot,
      channelId,
      sourceReceivedAt: now,
      processedAt: now,
      createdBy: userId,
      updatedBy: userId,
    } as unknown as Parameters<typeof Booking.create>[0];

    const created = await Booking.create(payload as unknown as any);
    await syncEcwidBookingUtmByBookingId(created.id);

    res.status(201).json({ status: 'created', bookingId: created.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import Ecwid booking';
    res.status(500).json({ message });
  }
};

export const getManifest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date, productId, time, search } = req.query as QueryParams;
    const searchTerm = typeof search === 'string' ? search.trim() : '';
    const hasSearch = searchTerm.length > 0;
    const targetDate = normalizeDate(date ?? dayjs().format(DATE_FORMAT), 'start');

    if (!targetDate) {
      res.status(400).json({ message: 'Invalid date provided' });
      return;
    }

    const normalizedProductId = typeof productId === 'string' ? productId.trim() : '';
    const numericProductId = normalizedProductId ? Number.parseInt(normalizedProductId, 10) : NaN;
    const hasNumericProductId = Number.isFinite(numericProductId);
    const productRecord = hasNumericProductId ? await Product.findByPk(numericProductId) : null;
    const canonicalProductKey = productRecord
      ? canonicalizeProductKeyFromLabel(productRecord.name ?? null)
      : null;
    const acceptedProductKeys = new Set<string>();
    if (normalizedProductId) {
      acceptedProductKeys.add(normalizedProductId);
    }
    if (hasNumericProductId) {
      acceptedProductKeys.add(String(numericProductId));
    }
    if (canonicalProductKey) {
      acceptedProductKeys.add(canonicalProductKey);
    }

    const rows = await Booking.findAll({
      where: hasSearch
        ? buildSearchWhere(searchTerm)
        : {
            experienceDate: targetDate,
            ...(hasNumericProductId ? { productId: numericProductId } : {}),
          },
      include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
      order: [
        ['experienceStartAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const baseOrders = rows
      .map((booking) => bookingToUnifiedOrder(booking))
      .filter((order): order is UnifiedOrder => order !== null);

    const scopedOrders = hasSearch
      ? baseOrders
      : baseOrders.filter((order) => order.date === targetDate);

    const filteredOrders = hasSearch
      ? scopedOrders
      : scopedOrders.filter((order) => {
          if (!hasNumericProductId && acceptedProductKeys.size > 0 && !acceptedProductKeys.has(order.productId)) {
            return false;
          }
          if (time && order.timeslot !== time) {
            return false;
          }
          return true;
        });

    const manifest = groupOrdersForManifest(filteredOrders);

    const summary = manifest.reduce<{
      totalPeople: number;
      men: number;
      women: number;
      totalOrders: number;
      extras: OrderExtras;
      platformBreakdown: PlatformBreakdownEntry[];
      statusCounts: Record<string, number>;
      attendanceStatusCounts: Record<string, number>;
    }>(
      (acc, group: ManifestGroup) => {
        acc.totalPeople += group.totalPeople;
        acc.men += group.men;
        acc.women += group.women;
        acc.totalOrders += group.orders.length;
        acc.extras.tshirts += group.extras.tshirts;
        acc.extras.cocktails += group.extras.cocktails;
        acc.extras.photos += group.extras.photos;
        group.platformBreakdown.forEach((entry) => {
          const key = entry.platform || 'unknown';
          const existing = acc.platformBreakdown.find((bucket) => bucket.platform === key);
          if (existing) {
            existing.totalPeople += entry.totalPeople;
            existing.men += entry.men;
            existing.women += entry.women;
            existing.orderCount += entry.orderCount;
            return;
          }
          acc.platformBreakdown.push({ ...entry, platform: key });
        });
        group.orders.forEach((order) => {
          acc.statusCounts[order.status] = (acc.statusCounts[order.status] ?? 0) + 1;
          const attendanceStatus = normalizeAttendanceStatus(order.attendanceStatus);
          acc.attendanceStatusCounts[attendanceStatus] = (acc.attendanceStatusCounts[attendanceStatus] ?? 0) + 1;
        });
        return acc;
      },
      {
        totalPeople: 0,
        men: 0,
        women: 0,
        totalOrders: 0,
        extras: { tshirts: 0, cocktails: 0, photos: 0 },
        platformBreakdown: [],
        statusCounts: {},
        attendanceStatusCounts: {},
      },
    );

    summary.platformBreakdown.sort((a, b) => a.platform.localeCompare(b.platform));
    for (const status of BOOKING_STATUSES) {
      if (!(status in summary.statusCounts)) {
        summary.statusCounts[status] = 0;
      }
    }
    for (const attendanceStatus of BOOKING_ATTENDANCE_STATUSES) {
      if (!(attendanceStatus in summary.attendanceStatusCounts)) {
        summary.attendanceStatusCounts[attendanceStatus] = 0;
      }
    }

    res.status(200).json({
      date: targetDate,
      filters: {
        productId: hasSearch ? null : productId ?? null,
        time: hasSearch ? null : time ?? null,
        search: hasSearch ? searchTerm : null,
      },
      orders: filteredOrders,
      manifest,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build manifest';
    res.status(500).json({ message });
  }
};

export const updateBookingAttendance = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const payload = (req.body ?? {}) as UpdateBookingAttendanceBody;

    const booking = await Booking.findByPk(bookingIdParam, {
      include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
    });
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    const result = await applyBookingAttendanceUpdate(booking, payload, req.authContext?.id ?? null);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Failed to update booking attendance';
    res.status(500).json({ message });
  }
};

export const updateBulkBookingAttendance = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as UpdateBulkBookingAttendanceBody;
    const updates = Array.isArray(body.updates) ? body.updates : [];
    if (updates.length === 0) {
      res.status(400).json({ message: 'updates must be a non-empty array' });
      return;
    }

    if (updates.length > 500) {
      res.status(400).json({ message: 'updates must contain at most 500 rows' });
      return;
    }

    const bookingIds = updates
      .map((row) => Number.parseInt(String(row?.bookingId ?? ''), 10))
      .filter((id) => Number.isInteger(id) && id > 0);
    const uniqueBookingIds = Array.from(new Set<number>(bookingIds));

    const bookings = uniqueBookingIds.length
      ? await Booking.findAll({
          where: { id: { [Op.in]: uniqueBookingIds } },
          include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
        })
      : [];
    const bookingById = new Map<number, Booking>();
    bookings.forEach((booking) => bookingById.set(booking.id, booking));

    const results: BookingAttendanceBulkUpdateResult[] = [];

    for (const row of updates) {
      const bookingId = Number.parseInt(String(row?.bookingId ?? ''), 10);
      if (!Number.isInteger(bookingId) || bookingId <= 0) {
        results.push({ bookingId: null, error: 'A valid booking ID must be provided' });
        continue;
      }

      const booking = bookingById.get(bookingId);
      if (!booking) {
        results.push({ bookingId, error: 'Booking not found' });
        continue;
      }

      try {
        const result = await applyBookingAttendanceUpdate(
          booking,
          {
            attendedTotal: row.attendedTotal,
            attendedExtras: row.attendedExtras,
          },
          req.authContext?.id ?? null,
        );
        results.push(result);
      } catch (error) {
        const message =
          error instanceof HttpError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Failed to update booking attendance';
        results.push({ bookingId, error: message });
      }
    }

    const failed = results.filter((result) => 'error' in result).length;
    const updated = results.length - failed;

    res.status(200).json({
      updated,
      failed,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update booking attendance';
    res.status(500).json({ message });
  }
};

export const getEcwidAmendPreview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam, {
      include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
    });
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be previewed through this endpoint' });
      return;
    }

    const platformBookingId = booking.platformBookingId?.trim() ?? '';
    const platformOrderId = booking.platformOrderId?.trim() ?? '';
    const rawOrderId = platformOrderId || platformBookingId;
    if (!rawOrderId) {
      res.status(400).json({ message: 'Booking is missing Ecwid platform reference' });
      return;
    }

    const orderId = stripEcwidItemSuffix(rawOrderId);
    let ecwidOrder: EcwidOrder | null = null;
    try {
      ecwidOrder = await getEcwidOrder(orderId);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        res.status(200).json({
          status: 'order_missing' satisfies EcwidAmendPreviewStatus,
          message: 'Ecwid order not found for this booking reference.',
          orderId,
          booking: {
            id: booking.id,
            platformBookingId: booking.platformBookingId,
            platformOrderId: booking.platformOrderId,
            productId: booking.productId,
            productName: booking.product?.name ?? booking.productName,
            productVariant: booking.productVariant,
          },
        });
        return;
      }
      throw error;
    }

    const aliases = await ProductAlias.findAll({
      where: { active: true },
      order: [
        ['priority', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const bookingProductName = booking.product?.name ?? booking.productName ?? null;
    const bookingProductVariant = booking.productVariant ?? null;

    const orderBookings = await Booking.findAll({
      where: {
        platform: 'ecwid',
        [Op.or]: [
          { platformOrderId: orderId },
          { platformBookingId: orderId },
          { platformBookingId: { [Op.like]: `${orderId}-%` } },
        ],
      },
      include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
      order: [['id', 'ASC']],
    });

    const items: EcwidAmendPreviewItem[] = (ecwidOrder.items ?? []).map((item) => ({
      name: item.name ? String(item.name).trim() : null,
      quantity: item.quantity ?? null,
      pickupTime: item.pickupTime ? String(item.pickupTime) : null,
      options: extractEcwidItemOptions(item),
      matched: false,
      matchedBookingNames: [],
    }));

    const ecwidItemAliasIds = items.map((item) => (item.name ? resolveAliasProductId(aliases, item.name) : null));
    const ecwidItemNormalized = items.map((item) => (item.name ? normalizeAliasLabel(item.name) : null));

    const bookingItems = orderBookings.map((record) => {
      const name = record.product?.name ?? record.productName ?? null;
      const aliasProductId = name ? resolveAliasProductId(aliases, name) : null;
      return {
        id: record.id,
        name,
        productId: record.productId ?? aliasProductId ?? null,
      };
    });

    const bookingMatches = bookingItems.map((bookingItem) => {
      let matchedIndex: number | null = null;
      if (bookingItem.name) {
        const bookingNormalized = normalizeAliasLabel(bookingItem.name);
        for (let index = 0; index < items.length; index += 1) {
          const itemName = items[index].name;
          if (!itemName) {
            continue;
          }
          const itemAliasProductId = ecwidItemAliasIds[index];
          if (bookingItem.productId !== null && itemAliasProductId !== null) {
            if (bookingItem.productId === itemAliasProductId) {
              matchedIndex = index;
              break;
            }
          }
          const itemNormalized = ecwidItemNormalized[index];
          if (
            itemNormalized &&
            (itemNormalized.includes(bookingNormalized) || bookingNormalized.includes(itemNormalized))
          ) {
            matchedIndex = index;
            break;
          }
        }
      }
      if (matchedIndex !== null) {
        items[matchedIndex].matched = true;
        if (bookingItem.name) {
          items[matchedIndex].matchedBookingNames = Array.from(
            new Set([...(items[matchedIndex].matchedBookingNames ?? []), bookingItem.name]),
          );
        }
      }
      return {
        ...bookingItem,
        matched: matchedIndex !== null,
        matchedIndex,
      };
    });

    const missingItems = bookingMatches.filter((entry) => !entry.matched && entry.name).map((entry) => entry.name as string);

    const status: EcwidAmendPreviewStatus = missingItems.length > 0 ? 'product_missing' : 'matched';
    const message =
      status === 'matched'
        ? 'Ecwid order contains all OmniLodge items for this booking.'
        : 'Ecwid order found, but some OmniLodge items are missing.';

    res.status(200).json({
      status,
      message,
      orderId,
      booking: {
        id: booking.id,
        platformBookingId: booking.platformBookingId,
        platformOrderId: booking.platformOrderId,
        productId: booking.productId,
        productName: bookingProductName,
        productVariant: bookingProductVariant,
      },
      bookingItems: bookingMatches.map((entry) => ({
        id: entry.id,
        name: entry.name,
        productId: entry.productId,
        matched: entry.matched,
        matchedIndex: entry.matchedIndex,
      })),
      missingItems,
      ecwid: {
        id: ecwidOrder.id ?? orderId,
        pickupTime: ecwidOrder.pickupTime ?? null,
        items,
      },
    });
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status ?? 502 : 500;
    const message = error instanceof Error ? error.message : 'Failed to preview Ecwid booking details';
    res.status(status).json({ message });
  }
};

export const reconcileEcwidBooking = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const { itemIndex } = req.body as ReconcileEcwidRequestBody;
    if (itemIndex === undefined || itemIndex === null || Number.isNaN(Number(itemIndex))) {
      res.status(400).json({ message: 'itemIndex is required' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be reconciled through this endpoint' });
      return;
    }

    const platformBookingId = booking.platformBookingId?.trim() ?? '';
    const platformOrderId = booking.platformOrderId?.trim() ?? '';
    const rawOrderId = platformOrderId || platformBookingId;
    if (!rawOrderId) {
      res.status(400).json({ message: 'Booking is missing Ecwid platform reference' });
      return;
    }

    const orderId = stripEcwidItemSuffix(rawOrderId);
    const ecwidOrder = await getEcwidOrder(orderId);

    const items = ecwidOrder.items ?? [];
    const index = Number(itemIndex);
    if (!Number.isFinite(index) || index < 0 || index >= items.length) {
      res.status(400).json({ message: 'itemIndex is out of range' });
      return;
    }

    const targetItem = items[index];
    const itemName = targetItem?.name ? String(targetItem.name).trim() : null;
    if (!itemName) {
      res.status(400).json({ message: 'Selected Ecwid item is missing a name' });
      return;
    }

    const aliases = await ProductAlias.findAll({
      where: { active: true },
      order: [
        ['priority', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    const resolvedProductId = resolveAliasProductId(aliases, itemName);
    const options = extractEcwidItemOptions(targetItem);
    const variant = options.length > 0 ? options.join(' | ') : null;

    booking.productName = itemName;
    booking.productId = resolvedProductId ?? null;
    booking.productVariant = variant;
    booking.updatedBy = req.authContext?.id ?? booking.updatedBy;

    await booking.save();

    res.status(200).json({
      message: 'Booking updated to match Ecwid order item',
      booking: {
        id: booking.id,
        platformBookingId: booking.platformBookingId,
        platformOrderId: booking.platformOrderId,
        productId: booking.productId,
        productName: booking.productName,
        productVariant: booking.productVariant,
      },
      ecwid: {
        id: ecwidOrder.id ?? orderId,
        itemIndex: index,
        itemName,
      },
    });
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status ?? 502 : 500;
    const message = error instanceof Error ? error.message : 'Failed to reconcile Ecwid booking';
    res.status(status).json({ message });
  }
};

export const getBookingDetails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam, {
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name'] },
        { model: Guest, as: 'guest', attributes: ['id', 'name', 'email', 'phoneNumber'] },
      ],
    });
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    const bookingEvents = await BookingEvent.findAll({
      where: { bookingId: booking.id },
      order: [['id', 'DESC']],
    });

    const emailMessageIds = new Set<string>();
    if (booking.lastEmailMessageId) {
      emailMessageIds.add(booking.lastEmailMessageId);
    }
    bookingEvents.forEach((event) => {
      if (event.emailMessageId) {
        emailMessageIds.add(event.emailMessageId);
      }
    });

    const emails = emailMessageIds.size > 0
      ? await BookingEmail.findAll({
          where: { messageId: { [Op.in]: Array.from(emailMessageIds) } },
          attributes: [
            'id',
            'messageId',
            'subject',
            'snippet',
            'receivedAt',
            'internalDate',
            'ingestionStatus',
            'failureReason',
          ],
          order: [
            ['receivedAt', 'DESC'],
            ['internalDate', 'DESC'],
            ['id', 'DESC'],
          ],
        })
      : [];

    let stripe: StripeTransactionSummary | null = null;
    let stripeError: string | null = null;
    let ecwidOrderId: string | null = null;

    if (booking.platform === 'ecwid') {
      const platformBookingId = booking.platformBookingId?.trim() ?? '';
      const platformOrderId = booking.platformOrderId?.trim() ?? '';
      const rawOrderId = platformOrderId || platformBookingId;
      if (rawOrderId) {
        ecwidOrderId = stripEcwidItemSuffix(rawOrderId);
        try {
          const ecwidOrder = await getEcwidOrder(ecwidOrderId);
          const externalTransactionId = normalizeExternalTransactionId(ecwidOrder);
          if (externalTransactionId) {
            stripe = await resolveStripeTransaction(externalTransactionId);
          }
        } catch (error) {
          if (isAxiosError(error) && error.response?.status === 404) {
            stripeError = 'Ecwid order not found.';
          } else if (isStripeResourceMissing(error)) {
            stripeError = 'Stripe transaction not found.';
          } else {
            stripeError = error instanceof Error ? error.message : 'Failed to load Stripe details';
          }
        }
      }
    }

    res.status(200).json({
      booking: booking.get({ plain: true }),
      events: bookingEvents.map((event) => event.get({ plain: true })),
      emails: emails.map((email) => email.get({ plain: true })),
      stripe,
      stripeError,
      ecwidOrderId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load booking details';
    res.status(500).json({ message });
  }
};

export const amendEcwidBooking = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const { pickupDate, pickupTime } = req.body as AmendPickupRequestBody;
    if (!pickupDate || !pickupTime) {
      res.status(400).json({ message: 'Both pickupDate and pickupTime are required' });
      return;
    }

    const pickupMoment = parsePickupMoment(pickupDate, pickupTime);
    if (!pickupMoment) {
      res.status(400).json({ message: 'Invalid pickup date or time' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be amended through this endpoint' });
      return;
    }

    const orderId = booking.platformBookingId?.trim();
    if (!orderId) {
      res.status(400).json({ message: 'Booking is missing Ecwid platform reference' });
      return;
    }

    const pickupUtc = pickupMoment.utc();
    const ecwidPickupTime = pickupUtc.format('YYYY-MM-DD HH:mm:ss ZZ');

    const ecwidOrder = await getEcwidOrder(orderId);
    const pickupExtraField = buildPickupExtraFieldPayload(ecwidOrder.orderExtraFields, ecwidPickupTime);

    await updateEcwidOrder(orderId, {
      pickupTime: ecwidPickupTime,
      orderExtraFields: [pickupExtraField],
    });

    booking.experienceDate = pickupMoment.format(DATE_FORMAT);
    booking.experienceStartAt = pickupUtc.toDate();
    booking.updatedBy = req.authContext?.id ?? booking.updatedBy;

    await booking.save();

    res.status(200).json({
      message: 'Pickup time updated successfully',
      booking: {
        id: booking.id,
        experienceDate: booking.experienceDate,
        experienceStartAt: booking.experienceStartAt,
        pickupTimeUtc: pickupUtc.toISOString(),
      },
    });
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status ?? 502 : 500;
    let message = 'Failed to amend Ecwid booking';
    if (isAxiosError(error)) {
      if (typeof error.response?.data === 'string') {
        message = error.response.data;
      } else if (error.response?.data?.message) {
        message = error.response.data.message;
      } else if (error.message) {
        message = error.message;
      }
    } else if (error instanceof Error) {
      message = error.message;
    }
    res.status(status).json({ message });
  }
};

export const amendXperiencePolandBooking = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const { pickupDate, pickupTime } = req.body as AmendPickupRequestBody;
    if (!pickupDate || !pickupTime) {
      res.status(400).json({ message: 'Both pickupDate and pickupTime are required' });
      return;
    }

    const pickupMoment = parsePickupMoment(pickupDate, pickupTime);
    if (!pickupMoment) {
      res.status(400).json({ message: 'Invalid pickup date or time' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'xperiencepoland') {
      res.status(400).json({ message: 'Only XperiencePoland bookings can be amended through this endpoint' });
      return;
    }

    const pickupUtc = pickupMoment.utc();
    booking.experienceDate = pickupMoment.format(DATE_FORMAT);
    booking.experienceStartAt = pickupUtc.toDate();
    booking.updatedBy = req.authContext?.id ?? booking.updatedBy;

    await booking.save();

    res.status(200).json({
      message: 'Pickup time updated successfully',
      booking: {
        id: booking.id,
        experienceDate: booking.experienceDate,
        experienceStartAt: booking.experienceStartAt,
        pickupTimeUtc: pickupUtc.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to amend XperiencePoland booking';
    res.status(500).json({ message });
  }
};

type StripeTransactionSummary = {
  id: string;
  type: 'charge' | 'payment_intent';
  amount: number;
  amountRefunded: number;
  currency: string;
  status: string | null;
  created: number;
  receiptEmail?: string | null;
  description?: string | null;
  fullyRefunded: boolean;
};

type EcwidRefundPreview = {
  bookingId: number;
  orderId: string;
  externalTransactionId: string;
  stripe: StripeTransactionSummary;
};

type PartialRefundPreview = EcwidRefundPreview & {
  remainingAmount: number;
  people: {
    quantity: number;
    unitPrice: string | null;
    totalPrice: string | null;
    currency: string | null;
  };
  addons: Array<{
    id: number;
    platformAddonName: string | null;
    quantity: number;
    unitPrice: string | null;
    totalPrice: string | null;
    currency: string | null;
  }>;
};

const normalizeExternalTransactionId = (order: EcwidOrder): string | null => {
  const candidate = (order as { externalTransactionId?: unknown }).externalTransactionId;
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return String(candidate);
  }
  return null;
};

const isStripeResourceMissing = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return (error as { code?: string }).code === 'resource_missing';
};

const summarizeCharge = (charge: Stripe.Charge): StripeTransactionSummary => {
  const amount = charge.amount ?? 0;
  const amountRefunded = charge.amount_refunded ?? 0;
  return {
    id: charge.id,
    type: 'charge',
    amount,
    amountRefunded,
    currency: charge.currency ?? 'unknown',
    status: charge.status ?? null,
    created: charge.created ?? 0,
    receiptEmail: charge.receipt_email ?? charge.billing_details?.email ?? null,
    description: charge.description ?? null,
    fullyRefunded: amount > 0 && amountRefunded >= amount,
  };
};

const summarizePaymentIntent = (
  intent: Stripe.PaymentIntent,
  latestCharge: Stripe.Charge | null,
): StripeTransactionSummary => {
  const amount = intent.amount_received ?? intent.amount ?? 0;
  const amountRefunded = latestCharge?.amount_refunded ?? 0;
  return {
    id: intent.id,
    type: 'payment_intent',
    amount,
    amountRefunded,
    currency: intent.currency ?? 'unknown',
    status: intent.status ?? null,
    created: intent.created ?? 0,
    receiptEmail: intent.receipt_email ?? latestCharge?.receipt_email ?? latestCharge?.billing_details?.email ?? null,
    description: intent.description ?? latestCharge?.description ?? null,
    fullyRefunded: amount > 0 && amountRefunded >= amount,
  };
};

const resolveStripeTransaction = async (externalTransactionId: string): Promise<StripeTransactionSummary> => {
  const trimmed = externalTransactionId.trim();
  if (!trimmed) {
    throw new Error('External transaction ID is missing');
  }

  const stripe = getStripeClient();

  const tryPaymentIntent = async (): Promise<StripeTransactionSummary | null> => {
    try {
      const intent = await stripe.paymentIntents.retrieve(trimmed);
      let latestCharge: Stripe.Charge | null = null;
      if (typeof intent.latest_charge === 'string' && intent.latest_charge.trim().length > 0) {
        const charge = await stripe.charges.retrieve(intent.latest_charge);
        latestCharge = 'deleted' in charge && charge.deleted ? null : (charge as Stripe.Charge);
      } else if (intent.latest_charge && typeof intent.latest_charge === 'object') {
        latestCharge = intent.latest_charge as Stripe.Charge;
      }
      return summarizePaymentIntent(intent, latestCharge);
    } catch (error) {
      if (isStripeResourceMissing(error)) {
        return null;
      }
      throw error;
    }
  };

  const tryCharge = async (): Promise<StripeTransactionSummary | null> => {
    try {
      const charge = await stripe.charges.retrieve(trimmed);
      if ('deleted' in charge && charge.deleted) {
        return null;
      }
      return summarizeCharge(charge as Stripe.Charge);
    } catch (error) {
      if (isStripeResourceMissing(error)) {
        return null;
      }
      throw error;
    }
  };

  if (trimmed.startsWith('pi_')) {
    const intentSummary = await tryPaymentIntent();
    if (intentSummary) {
      return intentSummary;
    }
    const chargeSummary = await tryCharge();
    if (chargeSummary) {
      return chargeSummary;
    }
  } else if (trimmed.startsWith('ch_')) {
    const chargeSummary = await tryCharge();
    if (chargeSummary) {
      return chargeSummary;
    }
    const intentSummary = await tryPaymentIntent();
    if (intentSummary) {
      return intentSummary;
    }
  } else {
    const intentSummary = await tryPaymentIntent();
    if (intentSummary) {
      return intentSummary;
    }
    const chargeSummary = await tryCharge();
    if (chargeSummary) {
      return chargeSummary;
    }
  }

  throw new Error('Stripe transaction not found for the provided external transaction ID.');
};

const buildEcwidRefundPreview = async (booking: Booking): Promise<EcwidRefundPreview> => {
  const orderId = booking.platformBookingId?.trim();
  if (!orderId) {
    throw new Error('Booking is missing Ecwid platform reference');
  }
  const ecwidOrder = await getEcwidOrder(orderId);
  const externalTransactionId = normalizeExternalTransactionId(ecwidOrder);
  if (!externalTransactionId) {
    throw new Error('Ecwid order is missing an external transaction ID');
  }
  const stripeSummary = await resolveStripeTransaction(externalTransactionId);
  return {
    bookingId: booking.id,
    orderId,
    externalTransactionId,
    stripe: stripeSummary,
  };
};

type ResolvedPartialRefundAddon = {
  bookingAddon: BookingAddon;
  displayName: string;
  quantity: number;
  unitPrice: number;
  currency: string | null;
};

type ResolvedPartialRefundPeople = {
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  currency: string | null;
};

type EcwidMoneySnapshot = {
  gross: number | null;
  net: number | null;
  discount: number | null;
  remaining: number;
  refunded: number;
  addons: number | null;
};

const parseMoneyValue = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\s+/g, '').replace(',', '.');
    if (!normalized) {
      return null;
    }
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const formatMoneyValue = (value: number): string => roundMoney(value).toFixed(2);

const buildEcwidMoneySnapshot = (booking: Booking): EcwidMoneySnapshot => {
  let gross = parseMoneyValue(booking.priceGross);
  let net = parseMoneyValue(booking.priceNet);
  let discount = parseMoneyValue(booking.discountAmount);

  gross = gross !== null ? Math.max(roundMoney(gross), 0) : null;
  net = net !== null ? Math.max(roundMoney(net), 0) : null;
  discount = discount !== null ? Math.max(roundMoney(discount), 0) : null;

  if (gross === null && net !== null && discount !== null) {
    gross = roundMoney(net + discount);
  }
  if (net === null && gross !== null && discount !== null) {
    net = Math.max(roundMoney(gross - discount), 0);
  }
  if (discount === null && gross !== null && net !== null) {
    discount = Math.max(roundMoney(gross - net), 0);
  }

  const refunded = Math.max(roundMoney(parseMoneyValue(booking.refundedAmount) ?? 0), 0);
  const addons = parseMoneyValue(booking.addonsAmount);
  let remaining = parseMoneyValue(booking.baseAmount);

  if (remaining === null) {
    if (net !== null) {
      remaining = Math.max(roundMoney(net - refunded), 0);
    } else {
      remaining = 0;
    }
  }

  return {
    gross,
    net,
    discount,
    remaining: Math.max(roundMoney(remaining), 0),
    refunded,
    addons: addons !== null ? Math.max(roundMoney(addons), 0) : null,
  };
};

const applyEcwidMoneySnapshot = (booking: Booking, snapshot: EcwidMoneySnapshot): void => {
  if (snapshot.gross !== null) {
    booking.priceGross = formatMoneyValue(snapshot.gross);
  }
  if (snapshot.net !== null) {
    booking.priceNet = formatMoneyValue(snapshot.net);
  }
  if (snapshot.discount !== null) {
    booking.discountAmount = formatMoneyValue(snapshot.discount);
  }
  booking.baseAmount = formatMoneyValue(snapshot.remaining);
  booking.refundedAmount = formatMoneyValue(snapshot.refunded);
};

const normalizeAddonNameForRefund = (value: string): string =>
  value
    .toLowerCase()
    .replace(/add[-\s]?on/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const classifyAddonExtraKey = (name: string | null): keyof OrderExtras | null => {
  const normalized = normalizeAddonNameForRefund(String(name ?? ''));
  if (!normalized) {
    return null;
  }
  if (/shirt|t shirt|tshirt/.test(normalized)) {
    return 'tshirts';
  }
  if (/cocktail|open bar|vip/.test(normalized)) {
    return 'cocktails';
  }
  if (/photo|instant photo|picture/.test(normalized)) {
    return 'photos';
  }
  return null;
};

const resolvePartialRefundPeople = (booking: Booking, fallbackCurrency: string): ResolvedPartialRefundPeople => {
  const toPositiveCount = (value: unknown): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return Math.max(0, Math.round(parsed));
  };

  // Primary source must be party_size_total.
  let quantity = toPositiveCount(booking.partySizeTotal);

  // Fallbacks for records that may not have party_size_total populated.
  if (quantity <= 0) {
    const snapshotBreakdown = extractPartyBreakdown(booking.addonsSnapshot ?? undefined);
    const fromBreakdown = toPositiveCount(snapshotBreakdown.men) + toPositiveCount(snapshotBreakdown.women);
    if (fromBreakdown > 0) {
      quantity = fromBreakdown;
    }
  }

  if (quantity <= 0) {
    const adults = toPositiveCount(booking.partySizeAdults);
    const children = toPositiveCount(booking.partySizeChildren);
    quantity = adults + children;
  }

  const baseAmountRaw =
    parseMoneyValue(booking.baseAmount) ??
    parseMoneyValue(booking.priceNet) ??
    (() => {
      const gross = parseMoneyValue(booking.priceGross);
      const addons = parseMoneyValue(booking.addonsAmount);
      if (gross !== null && addons !== null) {
        return Math.max(gross - addons, 0);
      }
      return null;
    })() ??
    0;

  const totalPrice = roundMoney(Math.max(baseAmountRaw, 0));
  const unitPrice = quantity > 0 ? roundMoney(totalPrice / quantity) : 0;

  return {
    quantity,
    unitPrice,
    totalPrice,
    currency: booking.currency ?? fallbackCurrency.toUpperCase(),
  };
};

const resolvePartialRefundPeopleFromBaseAmount = (
  booking: Booking,
  fallbackCurrency: string,
  addonsTotalAmount: number,
): ResolvedPartialRefundPeople => {
  const people = resolvePartialRefundPeople(booking, fallbackCurrency);
  const baseAmount = parseMoneyValue(booking.baseAmount);
  if (baseAmount === null) {
    return people;
  }

  const normalizedAddonsTotal = Number.isFinite(addonsTotalAmount)
    ? Math.max(roundMoney(addonsTotalAmount), 0)
    : 0;
  const peopleTotal = Math.max(roundMoney(baseAmount - normalizedAddonsTotal), 0);
  const peopleUnitPrice = people.quantity > 0 ? roundMoney(peopleTotal / people.quantity) : 0;

  return {
    quantity: people.quantity,
    unitPrice: peopleUnitPrice,
    totalPrice: peopleTotal,
    currency: booking.currency ?? fallbackCurrency.toUpperCase(),
  };
};

const resolveAddonsTotalAmount = (addons: ResolvedPartialRefundAddon[]): number =>
  roundMoney(
    addons.reduce((sum, entry) => {
      const lineTotal = roundMoney(entry.unitPrice * entry.quantity);
      return sum + lineTotal;
    }, 0),
  );

const resolvePartialRefundAddons = async (
  booking: Booking,
  fallbackCurrency: string,
): Promise<ResolvedPartialRefundAddon[]> => {
  const addons = await BookingAddon.findAll({
    where: { bookingId: booking.id },
    include: [
      {
        model: Addon,
        as: 'addon',
        attributes: ['id', 'name', 'basePrice'],
      },
    ],
    order: [['id', 'ASC']],
  });

  const priceOverrides = booking.productId
    ? await ProductAddon.findAll({
        where: { productId: booking.productId },
        attributes: ['addonId', 'priceOverride'],
        include: [{ model: Addon, as: 'addon', attributes: ['id', 'name', 'basePrice'] }],
      })
    : [];

  const priceOverrideByAddonId = new Map(
    priceOverrides.map((entry) => [entry.addonId, entry.priceOverride]),
  );

  const productAddonByName = new Map<
    string,
    { addonId: number; priceOverride: number | null; basePrice: number | null; name: string | null }
  >();
  priceOverrides.forEach((entry) => {
    const addonRecord = entry.addon as Addon | undefined;
    if (!addonRecord?.name) {
      return;
    }
    const key = normalizeAddonNameForRefund(addonRecord.name);
    if (!key) {
      return;
    }
    productAddonByName.set(key, {
      addonId: addonRecord.id,
      priceOverride: entry.priceOverride ?? null,
      basePrice: addonRecord.basePrice ?? null,
      name: addonRecord.name,
    });
  });

  const hasMissingAddonId = addons.some((addon) => !addon.addonId && addon.platformAddonName);
  const fallbackAddonByName = new Map<
    string,
    { addonId: number; priceOverride: number | null; basePrice: number | null; name: string | null }
  >();

  if (hasMissingAddonId) {
    const allAddons = await Addon.findAll({ attributes: ['id', 'name', 'basePrice'] });
    allAddons.forEach((addon) => {
      if (!addon.name) {
        return;
      }
      const key = normalizeAddonNameForRefund(addon.name);
      if (!key) {
        return;
      }
      fallbackAddonByName.set(key, {
        addonId: addon.id,
        priceOverride: null,
        basePrice: addon.basePrice ?? null,
        name: addon.name,
      });
    });
  }

  const findAddonByName = (
    rawName: string | null,
  ): { addonId: number; priceOverride: number | null; basePrice: number | null; name: string | null } | null => {
    if (!rawName) {
      return null;
    }
    const normalized = normalizeAddonNameForRefund(rawName);
    if (!normalized) {
      return null;
    }
    const direct = productAddonByName.get(normalized);
    if (direct) {
      return direct;
    }
    const fallbackDirect = fallbackAddonByName.get(normalized);
    if (fallbackDirect) {
      return fallbackDirect;
    }
    for (const [key, value] of productAddonByName.entries()) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return value;
      }
    }
    for (const [key, value] of fallbackAddonByName.entries()) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return value;
      }
    }
    return null;
  };

  const resolvedAddons: Array<ResolvedPartialRefundAddon | null> = addons.map(
    (addon): ResolvedPartialRefundAddon | null => {
      const addonRecord = addon.addon as Addon | undefined;
      let addonId = addon.addonId ?? addonRecord?.id ?? null;
      let override = addonId !== null ? parseMoneyValue(priceOverrideByAddonId.get(addonId)) : null;
      let fallbackBase = parseMoneyValue(addonRecord?.basePrice ?? null);
      if (addonId === null && addon.platformAddonName) {
        const mapped = findAddonByName(addon.platformAddonName);
        if (mapped) {
          addonId = mapped.addonId;
          override = parseMoneyValue(mapped.priceOverride);
          fallbackBase = parseMoneyValue(mapped.basePrice);
        }
      }

      const fromUnit = parseMoneyValue(addon.unitPrice);
      const fromTotal = parseMoneyValue(addon.totalPrice);
      const derivedFromTotal = fromTotal !== null && addon.quantity > 0 ? fromTotal / addon.quantity : null;
      const resolvedUnit = roundMoney(Math.max(override ?? fallbackBase ?? fromUnit ?? derivedFromTotal ?? 0, 0));
      if (resolvedUnit <= 0 || addon.quantity <= 0) {
        return null;
      }

      return {
        bookingAddon: addon,
        displayName: addon.platformAddonName ?? addonRecord?.name ?? `Addon ${addon.id}`,
        quantity: Math.max(0, Math.round(addon.quantity)),
        unitPrice: resolvedUnit,
        currency: addon.currency ?? booking.currency ?? fallbackCurrency.toUpperCase(),
      };
    },
  );

  return resolvedAddons.filter((entry): entry is ResolvedPartialRefundAddon => entry !== null);
};

const createStripeRefundFromSummary = async (
  summary: StripeTransactionSummary,
  metadata: { bookingId: number; orderId: string },
  amount?: number,
): Promise<Stripe.Refund | null> => {
  const stripe = getStripeClient();

  if (summary.fullyRefunded) {
    return null;
  }
  const basePayload: Stripe.RefundCreateParams = {
    reason: 'requested_by_customer',
    metadata: {
      bookingId: String(metadata.bookingId),
      orderId: metadata.orderId,
    },
  };
  if (amount && Number.isFinite(amount)) {
    basePayload.amount = Math.max(0, Math.floor(amount));
  }
  if (summary.type === 'payment_intent') {
    return stripe.refunds.create({ ...basePayload, payment_intent: summary.id });
  }
  return stripe.refunds.create({ ...basePayload, charge: summary.id });
};

const recordManualCancellationEvent = async (
  booking: Booking,
  occurredAt: Date,
  actorId: number | null,
  payload: Record<string, unknown>,
  transaction?: Transaction,
): Promise<void> => {
  const cancellationEvent = BookingEvent.build();
  cancellationEvent.bookingId = booking.id;
  cancellationEvent.emailId = null;
  cancellationEvent.eventType = 'cancelled';
  cancellationEvent.platform = booking.platform;
  cancellationEvent.statusAfter = 'cancelled';
  cancellationEvent.emailMessageId = null;
  cancellationEvent.eventPayload = {
    source: 'manual',
    actorId,
    ...payload,
  };
  cancellationEvent.occurredAt = occurredAt;
  cancellationEvent.ingestedAt = occurredAt;
  cancellationEvent.processedAt = occurredAt;
  await cancellationEvent.save(transaction ? { transaction } : undefined);
};

export const cancelEcwidBooking = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be cancelled through this endpoint' });
      return;
    }

    if (booking.status === 'cancelled') {
      res.status(400).json({ message: 'Booking is already cancelled' });
      return;
    }

    const preview = await buildEcwidRefundPreview(booking);
    const refund = await createStripeRefundFromSummary(preview.stripe, {
      bookingId: booking.id,
      orderId: preview.orderId,
    });

    const now = new Date();
    const money = buildEcwidMoneySnapshot(booking);
    const fullRefundAmount = refund?.amount ? roundMoney(refund.amount / 100) : money.remaining;
    booking.status = 'cancelled';
    booking.statusChangedAt = now;
    booking.cancelledAt = now;
    money.remaining = 0;
    money.refunded = roundMoney(money.refunded + fullRefundAmount);
    money.addons = 0;
    applyEcwidMoneySnapshot(booking, money);
    booking.addonsAmount = formatMoneyValue(0);
    booking.refundedCurrency = (booking.currency ?? preview.stripe.currency ?? '').toUpperCase() || null;
    booking.paymentStatus = 'refunded';
    booking.updatedBy = req.authContext?.id ?? booking.updatedBy;

    const sequelizeClient = Booking.sequelize;
    if (!sequelizeClient) {
      throw new Error('Database client is not initialized');
    }

    await sequelizeClient.transaction(async (transaction) => {
      await booking.save({ transaction });
      await recordManualCancellationEvent(booking, now, req.authContext?.id ?? null, {
        action: 'cancel-ecwid',
        refunded: Boolean(refund),
        refundedAmount: fullRefundAmount,
        currency: booking.refundedCurrency ?? booking.currency ?? preview.stripe.currency ?? null,
        orderId: preview.orderId,
        externalTransactionId: preview.externalTransactionId,
        stripeTransactionId: preview.stripe.id,
        stripeTransactionType: preview.stripe.type,
      }, transaction);
    });

    res.status(200).json({
      message: refund ? 'Booking cancelled and refund issued successfully' : 'Booking cancelled successfully',
      booking: {
        id: booking.id,
        status: booking.status,
        cancelledAt: booking.cancelledAt,
      },
      refund,
      stripe: preview.stripe,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ message: error.message, details: error.details });
      return;
    }
    const message = error instanceof Error ? error.message : 'Failed to cancel booking';
    res.status(500).json({ message });
  }
};

export const cancelXperiencePolandBooking = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'xperiencepoland') {
      res.status(400).json({ message: 'Only XperiencePoland bookings can be cancelled through this endpoint' });
      return;
    }

    if (booking.status === 'cancelled') {
      res.status(400).json({ message: 'Booking is already cancelled' });
      return;
    }

    const now = new Date();
    booking.status = 'cancelled';
    booking.statusChangedAt = now;
    booking.cancelledAt = now;
    booking.updatedBy = req.authContext?.id ?? booking.updatedBy;

    const sequelizeClient = Booking.sequelize;
    if (!sequelizeClient) {
      throw new Error('Database client is not initialized');
    }

    await sequelizeClient.transaction(async (transaction) => {
      await booking.save({ transaction });
      await recordManualCancellationEvent(booking, now, req.authContext?.id ?? null, {
        action: 'cancel-xperiencepoland',
      }, transaction);
    });

    res.status(200).json({
      message: 'Booking cancelled successfully',
      booking: {
        id: booking.id,
        status: booking.status,
        cancelledAt: booking.cancelledAt,
      },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ message: error.message, details: error.details });
      return;
    }
    const message = error instanceof Error ? error.message : 'Failed to cancel booking';
    res.status(500).json({ message });
  }
};

export const getEcwidRefundPreview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be refunded through this endpoint' });
      return;
    }

    const preview = await buildEcwidRefundPreview(booking);
    res.status(200).json(preview);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ message: error.message, details: error.details });
      return;
    }
    const message = error instanceof Error ? error.message : 'Failed to load refund preview';
    res.status(500).json({ message });
  }
};

export const getPartialRefundPreview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be refunded through this endpoint' });
      return;
    }

    const preview = await buildEcwidRefundPreview(booking);
    const remaining = Math.max(preview.stripe.amount - preview.stripe.amountRefunded, 0);
    const resolvedAddons = await resolvePartialRefundAddons(booking, preview.stripe.currency);
    const addonsTotalAmount = resolveAddonsTotalAmount(resolvedAddons);
    const people = resolvePartialRefundPeopleFromBaseAmount(
      booking,
      preview.stripe.currency,
      addonsTotalAmount,
    );

    res.status(200).json({
      bookingId: preview.bookingId,
      orderId: preview.orderId,
      externalTransactionId: preview.externalTransactionId,
      stripe: preview.stripe,
      remainingAmount: remaining,
      people: {
        quantity: people.quantity,
        unitPrice: formatMoneyValue(people.unitPrice),
        totalPrice: formatMoneyValue(people.totalPrice),
        currency: people.currency,
      },
      addons: resolvedAddons.map((entry) => ({
        id: entry.bookingAddon.id,
        platformAddonName: entry.displayName,
        quantity: entry.quantity,
        unitPrice: formatMoneyValue(entry.unitPrice),
        totalPrice: formatMoneyValue(entry.unitPrice * entry.quantity),
        currency: entry.currency,
      })),
    } satisfies PartialRefundPreview);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load partial refund preview';
    res.status(500).json({ message });
  }
};

export const partialRefundEcwidBooking = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const bookingIdParam = Number.parseInt(String(req.params?.bookingId ?? ''), 10);
    if (Number.isNaN(bookingIdParam)) {
      res.status(400).json({ message: 'A valid booking ID must be provided' });
      return;
    }

    const booking = await Booking.findByPk(bookingIdParam);
    if (!booking) {
      res.status(404).json({ message: 'Booking not found' });
      return;
    }

    if (booking.platform !== 'ecwid') {
      res.status(400).json({ message: 'Only Ecwid bookings can be refunded through this endpoint' });
      return;
    }

    const preview = await buildEcwidRefundPreview(booking);
    const resolvedAddons = await resolvePartialRefundAddons(booking, preview.stripe.currency);
    const addonsTotalAmount = resolveAddonsTotalAmount(resolvedAddons);
    const people = resolvePartialRefundPeopleFromBaseAmount(
      booking,
      preview.stripe.currency,
      addonsTotalAmount,
    );
    const addonByBookingAddonId = new Map(resolvedAddons.map((entry) => [entry.bookingAddon.id, entry]));

    const body = req.body as {
      amount?: unknown;
      peopleQuantity?: unknown;
      addonQuantities?: Record<string, unknown>;
    };

    const peopleQuantityRaw = Number(body.peopleQuantity ?? 0);
    const requestedPeopleQuantity = Number.isFinite(peopleQuantityRaw)
      ? Math.max(0, Math.min(Math.round(peopleQuantityRaw), people.quantity))
      : 0;

    const addonQuantitiesRaw = body.addonQuantities && typeof body.addonQuantities === 'object'
      ? body.addonQuantities
      : {};
    const normalizeAddonLookupKey = (value: string): string =>
      String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    const addonByAlias = new Map<string, ResolvedPartialRefundAddon>();
    resolvedAddons.forEach((entry) => {
      const aliases = [
        String(entry.bookingAddon.id),
        entry.bookingAddon.addonId !== null ? String(entry.bookingAddon.addonId) : null,
        entry.bookingAddon.platformAddonId,
        entry.bookingAddon.platformAddonName,
        entry.displayName,
      ];
      aliases.forEach((alias) => {
        if (!alias) {
          return;
        }
        const rawKey = String(alias).trim().toLowerCase();
        if (rawKey) {
          addonByAlias.set(rawKey, entry);
        }
        const normalizedKey = normalizeAddonLookupKey(alias);
        if (normalizedKey) {
          addonByAlias.set(normalizedKey, entry);
        }
      });
    });
    const requestedAddonQuantities = new Map<number, number>();
    for (const [rawKey, rawValue] of Object.entries(addonQuantitiesRaw)) {
      const parsedQty = Number(rawValue);
      if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
        continue;
      }
      const bookingAddonId = Number.parseInt(rawKey, 10);
      let addonEntry =
        Number.isFinite(bookingAddonId) && addonByBookingAddonId.has(bookingAddonId)
          ? addonByBookingAddonId.get(bookingAddonId)
          : undefined;
      if (!addonEntry) {
        const rawLookupKey = String(rawKey).trim().toLowerCase();
        addonEntry =
          addonByAlias.get(rawLookupKey) ??
          addonByAlias.get(normalizeAddonLookupKey(rawKey));
      }
      if (!addonEntry && resolvedAddons.length === 1) {
        addonEntry = resolvedAddons[0];
      }
      if (!addonEntry) {
        continue;
      }
      const normalizedQty = Number.isFinite(parsedQty)
        ? Math.max(0, Math.min(Math.round(parsedQty), addonEntry.quantity))
        : 0;
      requestedAddonQuantities.set(
        addonEntry.bookingAddon.id,
        Math.max(requestedAddonQuantities.get(addonEntry.bookingAddon.id) ?? 0, normalizedQty),
      );
    }

    const peopleRefundAmount = roundMoney(requestedPeopleQuantity * people.unitPrice);
    const addonRefundBreakdown = resolvedAddons
      .map((entry) => {
        const refundQty = requestedAddonQuantities.get(entry.bookingAddon.id) ?? 0;
        if (refundQty <= 0) {
          return null;
        }
        const refundAmount = roundMoney(refundQty * entry.unitPrice);
        return {
          bookingAddonId: entry.bookingAddon.id,
          name: entry.displayName,
          refundQty,
          unitPrice: entry.unitPrice,
          refundAmount,
          currency: entry.currency,
          remainingQty: Math.max(entry.quantity - refundQty, 0),
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          bookingAddonId: number;
          name: string;
          refundQty: number;
          unitPrice: number;
          refundAmount: number;
          currency: string | null;
          remainingQty: number;
        } => entry !== null,
      );
    const addonsRefundAmount = roundMoney(
      addonRefundBreakdown.reduce((sum, entry) => sum + entry.refundAmount, 0),
    );

    const computedAmount = roundMoney(peopleRefundAmount + addonsRefundAmount);
    if (computedAmount <= 0) {
      res.status(400).json({
        message: 'Select at least one refunded person or add-on quantity.',
      });
      return;
    }

    const rawAmount = body.amount;
    if (rawAmount !== null && rawAmount !== undefined && `${rawAmount}`.trim() !== '') {
      const numericAmount = typeof rawAmount === 'string' ? Number.parseFloat(rawAmount) : Number(rawAmount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        res.status(400).json({ message: 'A valid refund amount is required' });
        return;
      }
      if (Math.abs(roundMoney(numericAmount) - computedAmount) > 0.01) {
        res.status(400).json({
          message: 'Refund amount does not match selected people/add-ons breakdown. Refresh and try again.',
        });
        return;
      }
    }

    const amountInCents = Math.round(computedAmount * 100);
    const remaining = Math.max(preview.stripe.amount - preview.stripe.amountRefunded, 0);
    if (amountInCents >= remaining) {
      res.status(400).json({ message: 'Refund amount must be less than the remaining paid amount. Use Cancel for full refunds.' });
      return;
    }

    const refund = await createStripeRefundFromSummary(preview.stripe, {
      bookingId: booking.id,
      orderId: preview.orderId,
    }, amountInCents);

    const sequelizeClient = Booking.sequelize;
    if (!sequelizeClient) {
      throw new Error('Database client is not initialized');
    }
    const now = new Date();

    await sequelizeClient.transaction(async (transaction) => {
      if (requestedPeopleQuantity > 0) {
        const currentTotal = deriveBookingPartySize(booking);
        booking.partySizeTotal = Math.max(currentTotal - requestedPeopleQuantity, 0);

        if (booking.partySizeAdults !== null || booking.partySizeChildren !== null) {
          let remainingToDeduct = requestedPeopleQuantity;
          let adults = Math.max(0, Math.round(Number(booking.partySizeAdults ?? 0)));
          let children = Math.max(0, Math.round(Number(booking.partySizeChildren ?? 0)));

          const deductedAdults = Math.min(adults, remainingToDeduct);
          adults -= deductedAdults;
          remainingToDeduct -= deductedAdults;

          if (remainingToDeduct > 0) {
            const deductedChildren = Math.min(children, remainingToDeduct);
            children -= deductedChildren;
            remainingToDeduct -= deductedChildren;
          }

          booking.partySizeAdults = adults;
          booking.partySizeChildren = children;
        }
      }

      const money = buildEcwidMoneySnapshot(booking);
      const nextBaseAmount = Math.max(roundMoney(money.remaining - computedAmount), 0);
      const nextRefunded = roundMoney(money.refunded + computedAmount);
      const nextAddonsAmount = Math.max(roundMoney((money.addons ?? 0) - addonsRefundAmount), 0);

      money.remaining = nextBaseAmount;
      money.refunded = nextRefunded;
      money.addons = nextAddonsAmount;
      applyEcwidMoneySnapshot(booking, money);
      booking.addonsAmount = formatMoneyValue(nextAddonsAmount);
      booking.refundedCurrency = (booking.currency ?? preview.stripe.currency ?? '').toUpperCase() || null;
      booking.paymentStatus = nextBaseAmount <= 0 ? 'refunded' : 'partial';

      const snapshotBase =
        booking.addonsSnapshot && typeof booking.addonsSnapshot === 'object'
          ? { ...(booking.addonsSnapshot as Record<string, unknown>) }
          : {};
      const previousExtras = normalizeExtras(snapshotBase);
      const nextExtras: OrderExtras = {
        tshirts: previousExtras.tshirts,
        cocktails: previousExtras.cocktails,
        photos: previousExtras.photos,
      };

      addonRefundBreakdown.forEach((entry) => {
        const addonEntry = addonByBookingAddonId.get(entry.bookingAddonId);
        if (!addonEntry) {
          return;
        }
        const bookingAddon = addonEntry.bookingAddon;
        const nextQuantity = Math.max(addonEntry.quantity - entry.refundQty, 0);
        bookingAddon.quantity = nextQuantity;
        bookingAddon.unitPrice = formatMoneyValue(addonEntry.unitPrice);
        bookingAddon.totalPrice = formatMoneyValue(nextQuantity * addonEntry.unitPrice);
        bookingAddon.currency = bookingAddon.currency ?? addonEntry.currency ?? booking.currency ?? null;
        bookingAddon.updatedAt = now;

        const category = classifyAddonExtraKey(entry.name);
        if (category) {
          nextExtras[category] = Math.max(nextExtras[category] - entry.refundQty, 0);
        }
      });

      await Promise.all(
        addonRefundBreakdown.map(async (entry) => {
          const addonEntry = addonByBookingAddonId.get(entry.bookingAddonId);
          if (!addonEntry) {
            return;
          }
          await addonEntry.bookingAddon.save({ transaction });
        }),
      );

      snapshotBase.extras = nextExtras;
      booking.addonsSnapshot = snapshotBase;
      booking.updatedBy = req.authContext?.id ?? booking.updatedBy;
      await booking.save({ transaction });

      const partialRefundEvent = BookingEvent.build();
      partialRefundEvent.bookingId = booking.id;
      partialRefundEvent.emailId = null;
      partialRefundEvent.eventType = 'note';
      partialRefundEvent.platform = booking.platform;
      partialRefundEvent.statusAfter = booking.status;
      partialRefundEvent.emailMessageId = null;
      partialRefundEvent.eventPayload = {
        source: 'manual',
        actorId: req.authContext?.id ?? null,
        action: 'partial-refund',
        orderId: preview.orderId,
        externalTransactionId: preview.externalTransactionId,
        stripeTransactionId: preview.stripe.id,
        stripeTransactionType: preview.stripe.type,
        stripeRefundId: refund?.id ?? null,
        totalRefundAmount: computedAmount,
        currency: booking.currency ?? preview.stripe.currency ?? null,
        people: {
          refundedQty: requestedPeopleQuantity,
          unitPrice: people.unitPrice,
          amount: peopleRefundAmount,
          remainingQty: booking.partySizeTotal ?? 0,
        },
        addons: addonRefundBreakdown.map((entry) => ({
          bookingAddonId: entry.bookingAddonId,
          name: entry.name,
          refundedQty: entry.refundQty,
          unitPrice: entry.unitPrice,
          amount: entry.refundAmount,
          remainingQty: entry.remainingQty,
        })),
      };
      partialRefundEvent.occurredAt = now;
      partialRefundEvent.ingestedAt = now;
      partialRefundEvent.processedAt = now;
      await partialRefundEvent.save({ transaction });
    });

    res.status(200).json({
      message: refund ? 'Partial refund issued successfully' : 'Unable to issue refund',
      refund,
      stripe: preview.stripe,
      breakdown: {
        amount: computedAmount,
        people: {
          refundedQty: requestedPeopleQuantity,
          unitPrice: people.unitPrice,
          amount: peopleRefundAmount,
        },
        addons: addonRefundBreakdown.map((entry) => ({
          bookingAddonId: entry.bookingAddonId,
          name: entry.name,
          refundedQty: entry.refundQty,
          unitPrice: entry.unitPrice,
          amount: entry.refundAmount,
        })),
      },
    });
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status ?? 502 : 500;
    const message = error instanceof Error ? error.message : 'Failed to issue partial refund';
    res.status(status).json({ message });
  }
};
