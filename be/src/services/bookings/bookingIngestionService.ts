import type { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import sequelize from '../../config/database.js';
import BookingEmail from '../../models/BookingEmail.js';
import Booking from '../../models/Booking.js';
import BookingEvent from '../../models/BookingEvent.js';
import BookingAddon from '../../models/BookingAddon.js';
import Channel from '../../models/Channel.js';
import Product from '../../models/Product.js';
import ProductAlias from '../../models/ProductAlias.js';
import logger from '../../utils/logger.js';
import { fetchMessagePayload, listMessages } from './gmailClient.js';
import { getBookingParsers } from './parsers/index.js';
import type {
  BookingFieldPatch,
  BookingParserContext,
  BookingParserDiagnostics,
  ParsedBookingEvent,
} from './types.js';
import type { GmailMessagePayload } from './gmailClient.js';
import type { BookingPlatform, KnownBookingPlatform } from '../../constants/bookings.js';
import { canonicalizeProductLabel, sanitizeProductSource } from '../../utils/productName.js';
import { getConfigValue } from '../configService.js';
import { syncEcwidBookingUtmByBookingId } from './ecwidUtmSyncService.js';

const FALLBACK_QUERY =
  '(subject:(booking OR reservation OR "new order" OR "booking detail change" OR rebooked) OR from:(ecwid.com OR fareharbor.com OR viator.com OR getyourguide.com OR xperiencepoland.com OR airbnb.com OR airbnbmail.com))';

const resolveDefaultQuery = (): string =>
  (getConfigValue('BOOKING_GMAIL_QUERY') as string) ?? FALLBACK_QUERY;

const resolveDefaultBatch = (): number => {
  const value = Number(getConfigValue('BOOKING_GMAIL_BATCH_SIZE') ?? 20);
  return Number.isFinite(value) ? value : 20;
};

const DEFAULT_PLATFORM_CHANNEL_NAMES: Record<KnownBookingPlatform, string> = {
  fareharbor: 'Fareharbor',
  viator: 'Viator',
  getyourguide: 'GetYourGuide',
  freetour: 'FreeTour',
  ecwid: 'Ecwid',
  airbnb: 'Airbnb',
  xperiencepoland: 'XperiencePoland',
  manual: 'Manual',
  unknown: 'Unknown',
};

const channelIdCache = new Map<string, number | null>();

const CANONICAL_TO_PRODUCT_NAME: Record<string, string> = {
  'Krawl Through Krakow Pub Crawl': 'Pub Crawl',
  'NYE Pub Crawl': 'NYE Pub Crawl',
  'Bottomless Brunch': 'Bottomless Brunch',
  'Go-Karting': 'Go-Karting',
  'Shooting Range': 'Shooting Range',
  'Strip Club': 'Strip Club',
  'Polish Vodka Tasting': 'Polish Vodka Tasting',
  'Airsoft Combat': 'Airsoft Combat',
  Paintball: 'Airsoft Combat',
  'Private Pub Crawl': 'Private Pub Crawl',
  'Krawl Through Kazimierz': 'Kazimierz Pub Crawl',
};

const productIdCache = new Map<string, number | null>();
const productNameCache = new Map<number, string | null>();
const PRODUCT_ALIAS_CACHE_TTL_MS = 60 * 1000;
let productAliasCache: { fetchedAt: number; records: ProductAlias[] } | null = null;
const AIRBNB_CANCELLATION_PLACEHOLDER_PREFIX = 'airbnb-cancel-';

const normalizeAliasInput = (value: string): string => sanitizeProductSource(value).toLowerCase();

const loadProductAliases = async (): Promise<ProductAlias[]> => {
  const now = Date.now();
  if (productAliasCache && now - productAliasCache.fetchedAt < PRODUCT_ALIAS_CACHE_TTL_MS) {
    return productAliasCache.records;
  }
  const records = await ProductAlias.findAll({
    where: { active: true },
    order: [
      ['priority', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  productAliasCache = { fetchedAt: now, records };
  return records;
};

const resolveAliasMatch = (aliases: ProductAlias[], raw: string): ProductAlias | null => {
  const normalized = normalizeAliasInput(raw);
  if (!normalized) {
    return null;
  }
  for (const alias of aliases) {
    if (!alias.active) {
      continue;
    }
    if (alias.matchType === 'exact') {
      if (alias.normalizedLabel === normalized) {
        return alias;
      }
      continue;
    }
    if (alias.matchType === 'contains') {
      if (normalized.includes(alias.normalizedLabel)) {
        return alias;
      }
      continue;
    }
    if (alias.matchType === 'regex') {
      try {
        const matcher = new RegExp(alias.label, 'i');
        if (matcher.test(raw)) {
          return alias;
        }
      } catch (error) {
        logger.warn(`Invalid product alias regex: ${alias.label}`, error);
      }
    }
  }
  return null;
};

const recordPendingAlias = async (
  rawLabel: string,
  transaction?: Transaction,
): Promise<void> => {
  const sanitizedLabel = sanitizeProductSource(rawLabel).trim();
  if (!sanitizedLabel) {
    return;
  }
  if (sanitizedLabel.length > 255) {
    logger.warn('Skipping product alias capture; label exceeds 255 chars.', {
      length: sanitizedLabel.length,
    });
    return;
  }
  const normalized = normalizeAliasInput(sanitizedLabel);
  if (!normalized) {
    return;
  }
  if (normalized.length > 255) {
    logger.warn('Skipping product alias capture; normalized label exceeds 255 chars.', {
      length: normalized.length,
    });
    return;
  }
  const now = new Date();
  const existing = await ProductAlias.findOne({
    where: { normalizedLabel: normalized, productId: null },
    transaction,
  });
  if (existing) {
    await existing.update(
      {
        lastSeenAt: now,
        hitCount: (existing.hitCount ?? 0) + 1,
      },
      { transaction },
    );
    return;
  }
  await ProductAlias.create(
    {
      productId: null,
      label: sanitizedLabel,
      normalizedLabel: normalized,
      matchType: 'contains',
      priority: 100,
      active: true,
      hitCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      source: 'ingestion',
    },
    { transaction },
  );
};

const decimalKeys = new Set([
  'baseAmount',
  'addonsAmount',
  'discountAmount',
  'refundedAmount',
  'priceGross',
  'priceNet',
  'commissionAmount',
  'commissionRate',
  'unitPrice',
  'totalPrice',
  'taxAmount',
]);

const bookingStringLimits: Partial<Record<keyof BookingFieldPatch, number>> = {
  productName: 255,
  productVariant: 255,
  guestFirstName: 255,
  guestLastName: 255,
  guestEmail: 320,
  guestPhone: 64,
  hotelName: 255,
  currency: 3,
  refundedCurrency: 3,
  paymentMethod: 128,
  rawPayloadLocation: 512,
};

const normalizePlatformKey = (platform: string): string =>
  platform
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const resolvePlatformChannelNames = (): Record<string, string> => {
  const configured = getConfigValue('BOOKING_PLATFORM_CHANNEL_MAP');
  const mapping: Record<string, string> = {};

  for (const [platform, channelName] of Object.entries(DEFAULT_PLATFORM_CHANNEL_NAMES)) {
    const key = normalizePlatformKey(platform);
    const value = channelName.trim();
    if (key && value) {
      mapping[key] = value;
    }
  }

  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    return mapping;
  }

  for (const [platform, channelNameRaw] of Object.entries(configured as Record<string, unknown>)) {
    if (typeof channelNameRaw !== 'string') {
      continue;
    }
    const key = normalizePlatformKey(platform);
    const channelName = channelNameRaw.trim();
    if (!key || !channelName) {
      continue;
    }
    mapping[key] = channelName;
  }

  return mapping;
};

const resolveChannelIdForPlatform = async (platform: BookingPlatform): Promise<number | null> => {
  const platformKey = normalizePlatformKey(platform);
  if (!platformKey) {
    return null;
  }
  const channelName = resolvePlatformChannelNames()[platformKey];
  if (!channelName) {
    return null;
  }
  if (channelIdCache.has(channelName)) {
    return channelIdCache.get(channelName) ?? null;
  }
  const record = await Channel.findOne({
    where: { name: channelName },
    attributes: ['id'],
  });
  const id = record?.id ?? null;
  channelIdCache.set(channelName, id);
  return id;
};

const canonicalProductNameFromFields = (fields: BookingFieldPatch): string | null => {
  const sources: Array<string | null | undefined> = [fields.productName, fields.productVariant, fields.notes];
  for (const source of sources) {
    const canonical = canonicalizeProductLabel(source ?? null);
    if (canonical) {
      return canonical;
    }
  }
  return null;
};

const isNyeDate = (value?: string | null): boolean => {
  if (!value) {
    return false;
  }
  return /-12-31$/.test(value.trim());
};

const resolveCanonicalProductName = (fields: BookingFieldPatch): string | null => {
  const canonical = canonicalProductNameFromFields(fields);
  if (!canonical) {
    return null;
  }
  if (canonical === 'Krawl Through Krakow Pub Crawl' && isNyeDate(fields.experienceDate)) {
    return 'NYE Pub Crawl';
  }
  return canonical;
};

const resolveProductIdForCanonical = async (canonicalName: string | null): Promise<number | null> => {
  if (!canonicalName) {
    return null;
  }
  const mappedName = CANONICAL_TO_PRODUCT_NAME[canonicalName] ?? canonicalName;
  const cacheKey = mappedName.toLowerCase();
  if (productIdCache.has(cacheKey)) {
    return productIdCache.get(cacheKey) ?? null;
  }
  const record = await Product.findOne({
    where: { name: { [Op.iLike]: mappedName } },
    attributes: ['id'],
  });
  const id = record?.id ?? null;
  productIdCache.set(cacheKey, id);
  return id;
};

const resolveProductNameById = async (
  productId: number,
  transaction?: Transaction,
): Promise<string | null> => {
  if (!Number.isInteger(productId) || productId <= 0) {
    return null;
  }
  if (productNameCache.has(productId)) {
    return productNameCache.get(productId) ?? null;
  }
  const record = await Product.findByPk(productId, {
    attributes: ['id', 'name'],
    transaction,
  });
  const name = record?.name ?? null;
  productNameCache.set(productId, name);
  return name;
};

const resolveProductIdFromAliases = async (
  bookingFields: BookingFieldPatch,
  transaction?: Transaction,
): Promise<{ productId: number | null; matchedLabel: string | null }> => {
  const candidates = [
    bookingFields.productName,
    bookingFields.productVariant,
    bookingFields.notes,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : null))
    .filter((value): value is string => Boolean(value));

  if (candidates.length === 0) {
    return { productId: null, matchedLabel: null };
  }

  const aliases = await loadProductAliases();
  const now = new Date();

  for (const candidate of candidates) {
    const match = resolveAliasMatch(aliases, candidate);
    if (match) {
      await match.update(
        {
          lastSeenAt: now,
          hitCount: (match.hitCount ?? 0) + 1,
        },
        { transaction },
      );
      if (match.productId) {
        return { productId: match.productId, matchedLabel: candidate };
      }
      return { productId: null, matchedLabel: candidate };
    }
  }

  return { productId: null, matchedLabel: candidates[0] ?? null };
};

class StaleBookingEventError extends Error {
  public readonly platform: BookingPlatform;

  public readonly platformBookingId: string;

  public readonly messageId: string;

  constructor(platform: BookingPlatform, platformBookingId: string, messageId: string) {
    super('STALE_BOOKING_EVENT');
    this.name = 'StaleBookingEventError';
    this.platform = platform;
    this.platformBookingId = platformBookingId;
    this.messageId = messageId;
  }
}

const clampString = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength);
};

const clampNullableString = (value: string | null | undefined, maxLength: number): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return clampString(value, maxLength);
};

const decodeHtmlEntities = (input: string): string => {
  return input.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (entity, match) => {
    if (match.startsWith('#x') || match.startsWith('#X')) {
      const codePoint = Number.parseInt(match.slice(2), 16);
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }
    if (match.startsWith('#')) {
      const codePoint = Number.parseInt(match.slice(1), 10);
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }
    const lookup: Record<string, string> = {
      nbsp: ' ',
      amp: '&',
      quot: '"',
      lt: '<',
      gt: '>',
      apos: "'",
      bull: '*',
      ndash: '-',
      mdash: '-',
      rsquo: "'",
      lsquo: "'",
    };
    return lookup[match.toLowerCase()] ?? entity;
  });
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
  return decodeHtmlEntities(withoutBlocks);
};

const normalizeWhitespace = (input: string): string => input.replace(/\s+/g, ' ').trim();

const ensurePlainTextBody = (
  textBody?: string | null,
  htmlBody?: string | null,
  snippet?: string | null,
): string => {
  if (textBody && textBody.trim().length > 0) {
    const looksLikeHtml = /<[^>]+>/.test(textBody);
    const candidate = looksLikeHtml ? stripHtmlToText(textBody) : textBody;
    const normalized = normalizeWhitespace(candidate);
    if (normalized) {
      return normalized;
    }
  }
  if (htmlBody) {
    const stripped = normalizeWhitespace(stripHtmlToText(htmlBody));
    if (stripped) {
      return stripped;
    }
  }
  if (snippet && snippet.trim().length > 0) {
    return normalizeWhitespace(snippet);
  }
  return '';
};

const normalizeDecimal = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  return null;
};

const normalizePatch = (patch: BookingFieldPatch | undefined): Record<string, unknown> => {
  if (!patch) {
    return {};
  }
  return Object.entries(patch).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (value === undefined) {
      return acc;
    }
    if (decimalKeys.has(key)) {
      acc[key] = normalizeDecimal(value);
      return acc;
    }
    if (typeof value === 'string') {
      const limit = bookingStringLimits[key as keyof BookingFieldPatch];
      if (limit) {
        acc[key] = clampString(value, limit);
        return acc;
      }
    }
    acc[key] = value;
    return acc;
  }, {});
};

const parseDateHeader = (value?: string | null): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
};

const buildParserContext = (email: BookingEmail, payload: GmailMessagePayload): BookingParserContext => {
  const headers = {
    ...payload.headers,
    from: email.fromAddress ?? payload.headers.from ?? '',
    to: email.toAddresses ?? payload.headers.to ?? '',
  };
  const normalizedTextBody = ensurePlainTextBody(payload.textBody, payload.htmlBody, email.snippet);

  return {
    messageId: email.messageId,
    threadId: email.threadId,
    historyId: email.historyId,
    subject: email.subject,
    snippet: email.snippet,
    from: email.fromAddress,
    to: email.toAddresses ?? undefined,
    cc: email.ccAddresses ?? undefined,
    receivedAt: email.receivedAt,
    internalDate: email.internalDate,
    headers,
    textBody: normalizedTextBody,
    rawTextBody: payload.textBody ?? '',
    htmlBody: payload.htmlBody,
  };
};

const saveEmailRecord = async (payload: GmailMessagePayload): Promise<BookingEmail> => {
  const { message, textBody } = payload;
  const existing = await BookingEmail.findOne({ where: { messageId: message.id ?? '' } });
  const record =
    existing ??
    BookingEmail.build({
      messageId: message.id ?? '',
      ingestionStatus: 'pending',
    } as BookingEmail);

  record.threadId = message.threadId ?? null;
  record.historyId = message.historyId ?? null;
  record.fromAddress = clampNullableString(payload.headers.from ?? record.fromAddress ?? null, 512);
  record.toAddresses = payload.headers.to ?? record.toAddresses ?? null;
  record.ccAddresses = payload.headers.cc ?? record.ccAddresses ?? null;
  const subjectHeader = message.payload?.headers?.find((h) => h.name?.toLowerCase() === 'subject')?.value;
  record.subject = clampNullableString(subjectHeader ?? record.subject ?? null, 512);
  record.snippet = message.snippet ?? textBody.slice(0, 240);
  record.receivedAt = parseDateHeader(payload.headers.date) ?? record.receivedAt ?? null;
  record.internalDate = message.internalDate ? new Date(Number.parseInt(message.internalDate, 10)) : record.internalDate ?? null;
  record.labelIds = message.labelIds ?? record.labelIds ?? null;
  record.headers = payload.headers;
  record.payloadSize = message.sizeEstimate ?? textBody.length;
  record.rawPayload = JSON.stringify(message);

  if (!record.ingestionStatus) {
    record.ingestionStatus = 'pending';
  }

  await record.save();
  return record;
};

const updateEmailStatus = async (email: BookingEmail, status: string, failureReason?: string | null): Promise<void> => {
  email.ingestionStatus = status;
  email.failureReason = failureReason ?? null;
  await email.save();
};

const sanitizeDiagnosticValue = (value?: string | null, maxLength = 160): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

const formatDiagnosticChecks = (checks: BookingParserDiagnostics['canParseChecks']): string | null => {
  if (!checks || checks.length === 0) {
    return null;
  }
  const tokens = checks.map((check) => {
    const value = sanitizeDiagnosticValue(check.value ?? null);
    const status = check.passed ? 'yes' : 'no';
    return value ? `${check.label}: ${status} (${value})` : `${check.label}: ${status}`;
  });
  return tokens.join('; ');
};

const buildIgnoredReason = (diagnostics: BookingParserDiagnostics[]): string => {
  if (!diagnostics || diagnostics.length === 0) {
    return 'No parser matched this email.';
  }
  const lines = diagnostics.map((diag) => {
    const segments: string[] = [`canParse=${diag.canParse ? 'yes' : 'no'}`];
    if (diag.canParse) {
      segments.push(`parse=${diag.parseMatched ? 'matched' : 'no match'}`);
    }
    const canParseChecks = formatDiagnosticChecks(diag.canParseChecks);
    if (canParseChecks) {
      segments.push(`checks: ${canParseChecks}`);
    }
    if (diag.parseMatched !== undefined) {
      const parseChecks = formatDiagnosticChecks(diag.parseChecks);
      if (parseChecks) {
        segments.push(`parseChecks: ${parseChecks}`);
      }
    }
    return `${diag.name}: ${segments.join('; ')}`;
  });
  return `No parser matched this email. Parser checks:\n${lines.join('\n')}`;
};

const runParsers = async (
  context: BookingParserContext,
): Promise<{ parsed: ParsedBookingEvent | null; diagnostics: BookingParserDiagnostics[] }> => {
  const parsers = getBookingParsers();
  const diagnostics: BookingParserDiagnostics[] = [];
  for (const parser of parsers) {
    const diag = parser.diagnose
      ? parser.diagnose(context)
      : { name: parser.name, canParse: parser.canParse(context) };
    diagnostics.push(diag);
    try {
      if (!diag.canParse) {
        continue;
      }
      const result = await parser.parse(context);
      if (result) {
        diag.parseMatched = true;
        logger.debug(`[booking-email] ${parser.name} parsed message ${context.messageId} into booking ${result.platformBookingId}`);
        return { parsed: result, diagnostics };
      }
      diag.parseMatched = false;
    } catch (error) {
      diag.parseMatched = false;
      diag.parseChecks = [
        ...(diag.parseChecks ?? []),
        { label: 'parse error', passed: false, value: (error as Error).message },
      ];
      logger.warn(`[booking-email] Parser ${parser.name} failed for ${context.messageId}: ${(error as Error).message}`);
    }
  }
  return { parsed: null, diagnostics };
};

const syncAddons = async (
  bookingId: number,
  eventId: number,
  addons: ParsedBookingEvent['addons'] | undefined,
  transaction: Transaction,
): Promise<void> => {
  await BookingAddon.destroy({ where: { bookingId }, transaction });
  if (!addons || addons.length === 0) {
    return;
  }

  for (const addon of addons) {
    const record = BookingAddon.build(
      {
        bookingId,
        addonId: addon.addonId ?? null,
        platformAddonId: addon.platformAddonId ?? null,
        platformAddonName: addon.platformAddonName ?? null,
        quantity: addon.quantity ?? 1,
        unitPrice: normalizeDecimal(addon.unitPrice ?? null),
        totalPrice: normalizeDecimal(addon.totalPrice ?? null),
        currency: addon.currency ?? null,
        taxAmount: normalizeDecimal(addon.taxAmount ?? null),
        isIncluded: addon.included ?? false,
        metadata: addon.metadata ?? null,
        sourceEventId: eventId,
      } as BookingAddon,
    );
    await record.save({ transaction });
  }
};

const isValidDateValue = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.valueOf());

const normalizeNameForMatch = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return normalized || null;
};

const isAirbnbCancellationPlaceholderId = (platform: BookingPlatform, platformBookingId: string): boolean =>
  platform === 'airbnb' && platformBookingId.startsWith(AIRBNB_CANCELLATION_PLACEHOLDER_PREFIX);

const findAirbnbCancellationMatch = async (
  event: ParsedBookingEvent,
  transaction: Transaction,
): Promise<Booking | null> => {
  if (event.platform !== 'airbnb' || event.status !== 'cancelled') {
    return null;
  }

  const fields = event.bookingFields ?? {};
  const targetFirst = normalizeNameForMatch(fields.guestFirstName ?? null);
  const targetLast = normalizeNameForMatch(fields.guestLastName ?? null);
  if (!targetFirst && !targetLast) {
    return null;
  }

  const targetPartySize = typeof fields.partySizeTotal === 'number' && Number.isFinite(fields.partySizeTotal)
    ? fields.partySizeTotal
    : null;
  const targetExperienceDate = typeof fields.experienceDate === 'string' && fields.experienceDate.trim().length > 0
    ? fields.experienceDate.trim()
    : null;
  const targetStartAt = isValidDateValue(fields.experienceStartAt) ? fields.experienceStartAt : null;

  if (!targetExperienceDate && !targetStartAt && targetPartySize == null) {
    return null;
  }

  const where: Record<string, unknown> = {
    platform: 'airbnb',
    status: { [Op.ne]: 'cancelled' },
  };

  if (targetExperienceDate) {
    where.experienceDate = targetExperienceDate;
  }
  if (targetPartySize != null) {
    where.partySizeTotal = targetPartySize;
  }
  if (targetStartAt) {
    const rangeMs = 6 * 60 * 60 * 1000;
    where.experienceStartAt = {
      [Op.between]: [new Date(targetStartAt.getTime() - rangeMs), new Date(targetStartAt.getTime() + rangeMs)],
    };
  }

  const candidates = await Booking.findAll({
    where,
    order: [
      ['statusChangedAt', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    limit: 30,
    transaction,
  });

  if (candidates.length === 0) {
    return null;
  }

  const scoreCandidate = (candidate: Booking): number => {
    const candidateFirst = normalizeNameForMatch(candidate.guestFirstName ?? null);
    const candidateLast = normalizeNameForMatch(candidate.guestLastName ?? null);
    let score = 0;

    if (targetFirst) {
      if (candidateFirst === targetFirst) {
        score += 4;
      } else {
        return -1;
      }
    }
    if (targetLast) {
      if (candidateLast === targetLast) {
        score += 4;
      } else {
        return -1;
      }
    }

    if (targetPartySize != null && candidate.partySizeTotal === targetPartySize) {
      score += 2;
    }
    if (targetExperienceDate && candidate.experienceDate === targetExperienceDate) {
      score += 2;
    }
    if (targetStartAt && isValidDateValue(candidate.experienceStartAt)) {
      const minutesDiff = Math.abs(candidate.experienceStartAt.getTime() - targetStartAt.getTime()) / 60000;
      if (minutesDiff <= 30) {
        score += 3;
      } else if (minutesDiff <= 180) {
        score += 1;
      }
    }

    return score;
  };

  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate) }))
    .filter((entry) => entry.score >= 8)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return null;
  }
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return null;
  }

  return scored[0].candidate;
};

const applyParsedEvent = async (
  email: BookingEmail,
  event: ParsedBookingEvent,
  options: { isReprocess?: boolean } = {},
): Promise<number> => {
  const bookingId = await sequelize.transaction(async (transaction) => {
    const eventOccurredAt = event.occurredAt ?? event.sourceReceivedAt ?? email.receivedAt ?? new Date();
    const priorEvent =
      options.isReprocess && email.messageId
        ? await BookingEvent.findOne({
            where: { emailMessageId: email.messageId },
            transaction,
          })
        : null;

    let booking = await Booking.findOne({
      where: {
        platform: event.platform,
        platformBookingId: event.platformBookingId,
      },
      transaction,
    });

    if (!booking) {
      booking = await findAirbnbCancellationMatch(event, transaction);
    }

    if (!booking && priorEvent?.bookingId) {
      booking = await Booking.findByPk(priorEvent.bookingId, { transaction });
    }

    if (!booking && isAirbnbCancellationPlaceholderId(event.platform, event.platformBookingId)) {
      throw new Error('Unable to match Airbnb cancellation email to an existing booking');
    }

    if (!booking) {
      booking = Booking.build({
        platform: event.platform,
        platformBookingId: event.platformBookingId,
        status: event.status,
        paymentStatus: event.paymentStatus ?? 'unknown',
        statusChangedAt: eventOccurredAt,
        cancelledAt: event.status === 'cancelled' ? eventOccurredAt : null,
      } as Booking);
      await booking.save({ transaction });
    }

    const bookingRecord = booking;
    if (!bookingRecord) {
      throw new Error('Unable to initialize booking record');
    }

    if (bookingRecord.platform === 'unknown' && event.platform !== 'unknown') {
      bookingRecord.platform = event.platform;
    }

    const lastMutationAt = bookingRecord.statusChangedAt ?? bookingRecord.createdAt ?? null;
    const isOlderEvent = Boolean(lastMutationAt && eventOccurredAt < lastMutationAt);
    if (isOlderEvent) {
      const canApplyOlderEvent = event.eventType === 'created' || event.eventType === 'amended';
      if (!canApplyOlderEvent) {
        throw new StaleBookingEventError(event.platform, bookingRecord.platformBookingId, email.messageId);
      }
    }

    const bookingFields = { ...(event.bookingFields ?? {}) };
    if (bookingFields.channelId == null) {
      const inferredChannelId = await resolveChannelIdForPlatform(event.platform);
      if (inferredChannelId != null) {
        bookingFields.channelId = inferredChannelId;
      }
    }
    if (!bookingFields.productId) {
      const aliasMatch = await resolveProductIdFromAliases(bookingFields, transaction);
      if (aliasMatch.productId != null) {
        bookingFields.productId = aliasMatch.productId;
        const aliasProductName = await resolveProductNameById(aliasMatch.productId, transaction);
        if (aliasProductName) {
          bookingFields.productName = aliasProductName;
        }
      } else {
        const canonicalProductName = resolveCanonicalProductName(bookingFields);
        const inferredProductId = await resolveProductIdForCanonical(canonicalProductName);
        if (inferredProductId != null) {
          bookingFields.productId = inferredProductId;
          if (!bookingFields.productName && canonicalProductName) {
            bookingFields.productName = canonicalProductName;
          }
        } else if (aliasMatch.matchedLabel) {
          await recordPendingAlias(aliasMatch.matchedLabel, transaction);
        }
      }
    }
    const partySizeTotalDelta = bookingFields.partySizeTotalDelta ?? null;
    const partySizeAdultsDelta = bookingFields.partySizeAdultsDelta ?? null;
    const addonsExtrasDelta = bookingFields.addonsExtrasDelta ?? null;
    const explicitCocktailDelta =
      addonsExtrasDelta && Object.prototype.hasOwnProperty.call(addonsExtrasDelta, 'cocktails');
    delete bookingFields.partySizeTotalDelta;
    delete bookingFields.partySizeAdultsDelta;
    delete bookingFields.addonsExtrasDelta;

    const patch = normalizePatch(bookingFields);
    if (Object.keys(patch).length > 0) {
      bookingRecord.set(patch);
    }

    const applyDelta = (key: 'partySizeTotal' | 'partySizeAdults', delta?: number | null): void => {
      if (typeof delta !== 'number' || Number.isNaN(delta) || delta === 0) {
        return;
      }
      const current = bookingRecord.getDataValue(key);
      const next = (current ?? 0) + delta;
      bookingRecord.setDataValue(key, next);
    };

    applyDelta('partySizeTotal', partySizeTotalDelta ?? null);
    applyDelta('partySizeAdults', partySizeAdultsDelta ?? null);

    const applyExtrasDelta = (delta?: Record<string, number> | null): void => {
      if (!delta) {
        return;
      }
      const snapshot =
        bookingRecord.addonsSnapshot && typeof bookingRecord.addonsSnapshot === 'object'
          ? { ...bookingRecord.addonsSnapshot }
          : {};
      const extras =
        snapshot.extras && typeof snapshot.extras === 'object'
          ? { ...(snapshot.extras as Record<string, number>) }
          : {};
      let mutated = false;
      for (const [key, value] of Object.entries(delta)) {
        if (typeof value !== 'number' || Number.isNaN(value) || value === 0) {
          continue;
        }
        extras[key] = (extras[key] ?? 0) + value;
        mutated = true;
      }
      if (!mutated) {
        return;
      }
      snapshot.extras = extras;
      bookingRecord.addonsSnapshot = snapshot;
    };

    applyExtrasDelta(addonsExtrasDelta);

    const inferCocktailDeltaFromPartyChange = (): void => {
      if (explicitCocktailDelta) {
        return;
      }
      const cocktailDelta = (partySizeAdultsDelta ?? partySizeTotalDelta) ?? null;
      if (typeof cocktailDelta !== 'number' || Number.isNaN(cocktailDelta) || cocktailDelta === 0) {
        return;
      }
      if (!bookingRecord.addonsSnapshot || typeof bookingRecord.addonsSnapshot !== 'object') {
        return;
      }
      const snapshot = { ...bookingRecord.addonsSnapshot };
      const extras =
        snapshot.extras && typeof snapshot.extras === 'object'
          ? { ...(snapshot.extras as Record<string, number>) }
          : null;
      if (!extras || typeof extras.cocktails !== 'number') {
        return;
      }
      extras.cocktails = (extras.cocktails ?? 0) + cocktailDelta;
      snapshot.extras = extras;
      bookingRecord.addonsSnapshot = snapshot;
    };

    inferCocktailDeltaFromPartyChange();

    const shouldUpdateStatus = !bookingRecord.statusChangedAt || eventOccurredAt >= bookingRecord.statusChangedAt;
    if (shouldUpdateStatus) {
      bookingRecord.status = event.status;
      bookingRecord.statusChangedAt = eventOccurredAt;
      if (event.status === 'cancelled') {
        bookingRecord.cancelledAt = eventOccurredAt;
      } else if (bookingRecord.cancelledAt) {
        bookingRecord.cancelledAt = null;
      }
    }

    if (event.paymentStatus) {
      bookingRecord.paymentStatus = event.paymentStatus;
    }
    if (event.platformOrderId) {
      bookingRecord.platformOrderId = event.platformOrderId;
    }

    bookingRecord.lastEmailMessageId = email.messageId;
    const nextSourceReceivedAt = event.sourceReceivedAt ?? email.receivedAt ?? null;
    if (!bookingRecord.sourceReceivedAt && nextSourceReceivedAt) {
      bookingRecord.sourceReceivedAt = nextSourceReceivedAt;
    } else if (
      event.eventType === 'created' &&
      nextSourceReceivedAt &&
      bookingRecord.sourceReceivedAt &&
      nextSourceReceivedAt < bookingRecord.sourceReceivedAt
    ) {
      bookingRecord.sourceReceivedAt = nextSourceReceivedAt;
    }
    bookingRecord.processedAt = new Date();
    const addonsSnapshot =
      event.bookingFields?.addonsSnapshot ??
      (event.addons && event.addons.length > 0 ? { items: event.addons } : null);
    bookingRecord.addonsSnapshot = addonsSnapshot ?? bookingRecord.addonsSnapshot ?? null;
    if (event.notes) {
      bookingRecord.notes = event.notes;
    }

    await bookingRecord.save({ transaction });

    if (priorEvent) {
      const priorEventBookingId = priorEvent.bookingId ?? null;
      const sameBookingAsPriorEvent =
        priorEventBookingId != null && String(priorEventBookingId) === String(bookingRecord.id);
      await BookingAddon.destroy({
        where: { sourceEventId: priorEvent.id },
        transaction,
      });
      await priorEvent.destroy({ transaction });

      if (priorEventBookingId && !sameBookingAsPriorEvent) {
        const remainingEvents = await BookingEvent.count({
          where: { bookingId: priorEventBookingId },
          transaction,
        });
        if (remainingEvents === 0) {
          const orphanedBooking = await Booking.findByPk(priorEventBookingId, { transaction });
          if (
            orphanedBooking &&
            orphanedBooking.platform === event.platform &&
            orphanedBooking.lastEmailMessageId === email.messageId
          ) {
            await BookingAddon.destroy({
              where: { bookingId: orphanedBooking.id },
              transaction,
            });
            await orphanedBooking.destroy({ transaction });
          }
        }
      }
    }

    const basePayload: Record<string, unknown> =
      event.rawPayload && typeof event.rawPayload === 'object'
        ? { ...(event.rawPayload as Record<string, unknown>) }
        : event.rawPayload != null
          ? { rawPayload: event.rawPayload }
          : {};
    if (options.isReprocess) {
      basePayload.reprocessed = true;
      basePayload.originalEventType = event.eventType;
    }
    const bookingEvent = BookingEvent.build(
      {
        bookingId: bookingRecord.id,
        emailId: email.id,
        eventType: options.isReprocess ? 'replayed' : event.eventType,
        platform: event.platform,
        statusAfter: event.status,
        emailMessageId: email.messageId,
        eventPayload: Object.keys(basePayload).length > 0 ? basePayload : null,
        occurredAt: eventOccurredAt,
        ingestedAt: new Date(),
        processedAt: new Date(),
      } as BookingEvent,
    );
    await bookingEvent.save({ transaction });

    await syncAddons(bookingRecord.id, bookingEvent.id, event.addons, transaction);

    return bookingRecord.id;
  });

  return bookingId;
};

type ProcessResult = 'processed' | 'skipped_lower' | 'skipped_upper' | 'ignored' | 'failed';

export const processBookingEmail = async (
  messageId: string,
  options: { force?: boolean; receivedAfter?: Date | null; receivedBefore?: Date | null } = {},
): Promise<ProcessResult> => {
  let payload: GmailMessagePayload | null = null;
  try {
    payload = await fetchMessagePayload(messageId);
    if (!payload || !payload.message.id) {
      logger.warn(`[booking-email] Gmail message ${messageId} returned no payload`);
      return 'ignored';
    }
  } catch (error) {
    logger.error(`[booking-email] Unable to fetch message ${messageId}: ${(error as Error).message}`);
    return 'failed';
  }

  const emailRecord = await saveEmailRecord(payload);

  if (emailRecord.ingestionStatus === 'processed' && !options.force) {
    logger.debug(`[booking-email] Message ${messageId} already processed, skipping`);
    return 'ignored';
  }

  await updateEmailStatus(emailRecord, 'processing');

  const internalDate = payload.message.internalDate ? new Date(Number(payload.message.internalDate)) : null;
  if (options.receivedAfter && internalDate && internalDate < options.receivedAfter) {
    await updateEmailStatus(emailRecord, 'ignored', 'Outside requested date range (before)');
    return 'skipped_lower';
  }

  if (options.receivedBefore && internalDate && internalDate > options.receivedBefore) {
    await updateEmailStatus(emailRecord, 'ignored', 'Outside requested date range (after)');
    return 'skipped_upper';
  }

  const context = buildParserContext(emailRecord, payload);
  const { parsed, diagnostics } = await runParsers(context);

  if (!parsed) {
    await updateEmailStatus(emailRecord, 'ignored', buildIgnoredReason(diagnostics));
    return 'ignored';
  }

  const pendingEvents: ParsedBookingEvent[] = [parsed];
  const processedBookingIds = new Set<number>();

  try {
    while (pendingEvents.length > 0) {
      const current = pendingEvents.shift()!;
      const spawned = current.spawnedEvents ?? [];
      const bookingId = await applyParsedEvent(emailRecord, current, {
        isReprocess: Boolean(options.force),
      });
      processedBookingIds.add(bookingId);
      if (spawned.length > 0) {
        pendingEvents.push(...spawned);
      }
    }
    await updateEmailStatus(emailRecord, 'processed');

    for (const bookingId of processedBookingIds) {
      await syncEcwidBookingUtmByBookingId(bookingId);
    }

    return 'processed';
  } catch (error) {
    if (error instanceof StaleBookingEventError) {
      logger.info(
        `[booking-email] Detected out-of-order event for ${error.platformBookingId}, rebuilding timeline chronologically`,
      );
      await updateEmailStatus(emailRecord, 'pending');
      await rebuildBookingTimeline(error.platform, error.platformBookingId, emailRecord);
      return 'processed';
    }
    const message = (error as Error).message ?? 'Unknown error';
    await updateEmailStatus(emailRecord, 'failed', message);
    logger.error(`[booking-email] Failed to apply parsed booking for ${messageId}: ${message}`);
    return 'failed';
  }
};

const rebuildBookingTimeline = async (
  platform: BookingPlatform,
  platformBookingId: string,
  emailRecord: BookingEmail,
): Promise<void> => {
  const replayCandidates: { messageId: string; receivedAt: Date | null }[] = [];

  const existingBooking = await Booking.findOne({
    where: { platform, platformBookingId },
  });

  if (existingBooking) {
    const existingEvents = await BookingEvent.findAll({
      where: { bookingId: existingBooking.id },
      include: [{ model: BookingEmail, as: 'email' }],
      order: [['occurredAt', 'ASC']],
    });
    for (const event of existingEvents) {
      if (event.email?.messageId) {
        replayCandidates.push({
          messageId: event.email.messageId,
          receivedAt: event.email.receivedAt ?? null,
        });
      }
    }

    await BookingAddon.destroy({ where: { bookingId: existingBooking.id } });
    await BookingEvent.destroy({ where: { bookingId: existingBooking.id } });
    await existingBooking.destroy();
  }

  replayCandidates.push({
    messageId: emailRecord.messageId,
    receivedAt: emailRecord.receivedAt ?? null,
  });

  const orderedMessageIds = [...new Map(replayCandidates.map((entry) => [entry.messageId, entry.receivedAt]))]
    .sort((a, b) => {
      const left = a[1]?.valueOf() ?? 0;
      const right = b[1]?.valueOf() ?? 0;
      return left - right;
    })
    .map(([id]) => id);

  for (const replayId of orderedMessageIds) {
    await processBookingEmail(replayId, { force: true });
  }
};

export const ingestLatestBookingEmails = async (): Promise<void> => {
  try {
    const { messages } = await listMessages({
      query: resolveDefaultQuery(),
      maxResults: resolveDefaultBatch(),
    });

    if (messages.length === 0) {
      logger.debug('[booking-email] No new Gmail messages matching booking query');
      return;
    }

    for (const message of messages) {
      if (!message.id) {
        continue;
      }
      await processBookingEmail(message.id);
    }
  } catch (error) {
    logger.error(`[booking-email] Failed to ingest booking emails: ${(error as Error).message}`);
  }
};

export const reprocessBookingEmails = async (limit = 10): Promise<void> => {
  const pendingEmails = await BookingEmail.findAll({
    where: {
      ingestionStatus: {
        [Op.in]: ['failed', 'ignored'],
      },
    },
    order: [['updatedAt', 'DESC']],
    limit,
  });

  for (const email of pendingEmails) {
    await processBookingEmail(email.messageId, { force: true });
  }
};

type IngestAllOptions = {
  query?: string;
  batchSize?: number;
  receivedAfter?: Date | string;
  receivedBefore?: Date | string;
};

const toDateOrNull = (value?: Date | string): Date | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
};

export const ingestAllBookingEmails = async (options: IngestAllOptions = {}): Promise<void> => {
  const query = options.query ?? resolveDefaultQuery();
  const batchSize = options.batchSize ?? Math.max(resolveDefaultBatch(), 100);
  const receivedAfter = toDateOrNull(options.receivedAfter);
  const receivedBefore = toDateOrNull(options.receivedBefore);
  let pageToken: string | null = null;
  let scanned = 0;
  let totalEstimate: number | null = null;
  let exactTotal: number | null = null;

  try {
    do {
      const { messages, nextPageToken, totalSizeEstimate } = await listMessages({
        query,
        maxResults: batchSize,
        pageToken,
      });

      if (totalEstimate === null && totalSizeEstimate !== null) {
        totalEstimate = totalSizeEstimate;
        logger.info(
          `[booking-email] Gmail reports approximately ${totalEstimate} messages matching query "${query}"`,
        );
      }

      if (!messages || messages.length === 0) {
        break;
      }

      let hitLowerBound = false;
      const sortedMessages = [...messages].reverse();

      for (const message of sortedMessages) {
        if (!message.id) {
          continue;
        }
        const result = await processBookingEmail(message.id, { receivedAfter, receivedBefore });
        if (result === 'skipped_lower') {
          hitLowerBound = true;
        }
      }
      scanned += messages.length;

      if (!nextPageToken) {
        exactTotal = scanned;
      }

      if (exactTotal !== null) {
        const completion = Math.min((scanned / exactTotal) * 100, 100);
        logger.info(
          `[booking-email] Backfill progress: ${scanned}/${exactTotal} (${completion.toFixed(2)}% exact)`,
        );
      } else if (totalEstimate && totalEstimate > 0) {
        const completion = Math.min((scanned / totalEstimate) * 100, 100);
        logger.info(
          `[booking-email] Backfill progress: ${scanned}/${totalEstimate} (~${completion.toFixed(2)}%)`,
        );
      } else {
        logger.info(`[booking-email] Backfill progress: ${scanned} messages processed`);
      }

      pageToken = nextPageToken;
      if (hitLowerBound) {
        logger.info('[booking-email] Reached earlier than requested range, stopping ingestion.');
        break;
      }
      if (!pageToken) {
        break;
      }
    } while (true);

    if (exactTotal === null) {
      exactTotal = scanned;
    }
    logger.info(`[booking-email] Completed full mailbox ingestion. Messages scanned: ${scanned}, total=${exactTotal}`);
  } catch (error) {
    logger.error(`[booking-email] Failed full mailbox ingestion: ${(error as Error).message}`);
  }
};
