import { Op, UniqueConstraintError, type Transaction } from 'sequelize';
import { createHash, randomUUID } from 'node:crypto';
import HttpError from '../errors/HttpError.js';
import StorefrontOngoingCart, {
  type StorefrontOngoingCartCustomer,
} from '../models/StorefrontOngoingCart.js';
import { getConfigValue } from './configService.js';
import { quoteStorefrontCart, type StorefrontCartInput, type StorefrontQuote } from './storefrontCommerceService.js';
import {
  normalizeSavedCartCustomer,
  normalizeSavedCartFromQuote,
} from './storefrontSavedCartService.js';
import { recordServerJourneyEvent } from './storefrontJourneyService.js';

export const ONGOING_CART_STATUSES = [
  'active',
  'checkout_started',
  'sending_recovery',
  'recovery_sent',
] as const;

export const STOREFRONT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const parseStorefrontUuid = (value: unknown, label: string): string => {
  const normalized = String(value ?? '').trim();
  if (!STOREFRONT_UUID_PATTERN.test(normalized)) throw new HttpError(400, `${label} is invalid.`);
  return normalized;
};

export const ongoingCartDelayMinutes = (): number => {
  const configured = Number(getConfigValue('STOREFRONT_ABANDONED_CART_DELAY_MINUTES'));
  return Number.isFinite(configured) ? Math.min(10080, Math.max(15, Math.round(configured))) : 60;
};

export const nextRecoveryDueAt = (from = new Date()): Date =>
  new Date(from.getTime() + ongoingCartDelayMinutes() * 60_000);

const normalizeCustomer = (value: unknown): StorefrontOngoingCartCustomer => {
  const customer = normalizeSavedCartCustomer(value);
  if (!customer?.fullName || !customer.email || !customer.phoneCountry || !customer.phone) {
    throw new HttpError(400, 'Complete customer contact details are required to save this cart.');
  }
  return {
    fullName: customer.fullName,
    email: customer.email,
    phoneCountry: customer.phoneCountry,
    phone: customer.phone,
  };
};

const normalizeAttribution = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 30)
      .map(([key, raw]) => [key.slice(0, 80), typeof raw === 'string' ? raw.slice(0, 1000) : raw]),
  );
};

type OngoingCartInput = {
  sessionId: unknown;
  publicId?: unknown;
  cart: unknown;
  customer: unknown;
  attribution?: unknown;
  quote?: StorefrontQuote;
  clientContext?: unknown;
};

const activeWhere = (sessionId: string) => ({
  sessionId,
  status: { [Op.in]: [...ONGOING_CART_STATUSES] },
});

type CartClientContext = {
  browserId: string | null;
  pageId: string | null;
};

const normalizeClientContext = (value: unknown): CartClientContext => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { browserId: null, pageId: null };
  }
  const input = value as Record<string, unknown>;
  const browserId = String(input.browserId ?? '').trim();
  const pageId = String(input.pageId ?? '').trim();
  return {
    browserId: STOREFRONT_UUID_PATTERN.test(browserId) ? browserId : null,
    pageId: STOREFRONT_UUID_PATTERN.test(pageId) ? pageId : null,
  };
};

const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]),
  );
};

export const ongoingCartFingerprint = (cart: StorefrontCartInput): string =>
  createHash('sha256').update(JSON.stringify(canonicalJson(cart))).digest('hex');

const dedupeWindowMinutes = (): number => {
  const configured = Number(getConfigValue('STOREFRONT_ONGOING_CART_DEDUPE_WINDOW_MINUTES'));
  return Number.isFinite(configured) ? Math.min(1440, Math.max(5, Math.round(configured))) : 30;
};

const dedupeCutoff = (now = new Date()): Date =>
  new Date(now.getTime() - dedupeWindowMinutes() * 60_000);

const normalizedPhone = (customer: StorefrontOngoingCartCustomer): string =>
  `${customer.phoneCountry}:${customer.phone.replace(/\D/g, '')}`;

const sameCustomer = (
  left: StorefrontOngoingCartCustomer,
  right: StorefrontOngoingCartCustomer,
): boolean => left.email === right.email && normalizedPhone(left) === normalizedPhone(right);

const fingerprintFor = (ongoing: StorefrontOngoingCart): string => {
  const stored = ongoing.metadata?.cartFingerprint;
  return typeof stored === 'string' && stored ? stored : ongoingCartFingerprint(ongoing.cart);
};

const appendUnique = (existing: unknown, value: string | null, limit = 10): string[] => {
  const values = Array.isArray(existing)
    ? existing.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return value ? [...new Set([...values, value])].slice(-limit) : values.slice(-limit);
};

const cartMetadata = (
  existing: Record<string, unknown> | null | undefined,
  fingerprint: string,
  sessionId: string,
  context: CartClientContext,
): Record<string, unknown> => ({
  ...(existing ?? {}),
  recoveryCount: Number(existing?.recoveryCount ?? 0),
  cartFingerprint: fingerprint,
  sessionIds: appendUnique(existing?.sessionIds, sessionId),
  browserIds: appendUnique(existing?.browserIds, context.browserId),
  pageIds: appendUnique(existing?.pageIds, context.pageId, 20),
  lastBrowserId: context.browserId ?? existing?.lastBrowserId ?? null,
  lastPageId: context.pageId ?? existing?.lastPageId ?? null,
});

const findRecentCustomerDuplicate = async (
  customer: StorefrontOngoingCartCustomer,
  fingerprint: string,
  now: Date,
): Promise<StorefrontOngoingCart | null> => {
  const candidates = await StorefrontOngoingCart.findAll({
    where: {
      status: { [Op.in]: [...ONGOING_CART_STATUSES] },
      lastActivityAt: { [Op.gte]: dedupeCutoff(now) },
      customer: { [Op.contains]: { email: customer.email } } as never,
    },
    order: [['lastActivityAt', 'DESC']],
    limit: 25,
  });
  return candidates.find((candidate) => (
    sameCustomer(candidate.customer, customer) && fingerprintFor(candidate) === fingerprint
  )) ?? null;
};

const terminalCartError = (ongoing: StorefrontOngoingCart): HttpError | null => {
  if (ongoing.status === 'converted') return new HttpError(409, 'This cart has already been paid.');
  if (ongoing.status === 'dismissed') return new HttpError(410, 'This cart is no longer available.');
  return ONGOING_CART_STATUSES.includes(ongoing.status as typeof ONGOING_CART_STATUSES[number])
    ? null
    : new HttpError(409, 'This cart is not available for checkout.');
};

export const upsertOngoingCart = async (input: OngoingCartInput): Promise<StorefrontOngoingCart> => {
  const sessionId = parseStorefrontUuid(input.sessionId, 'Cart session ID');
  const customer = normalizeCustomer(input.customer);
  const quote = input.quote ?? await quoteStorefrontCart(input.cart as StorefrontCartInput);
  const cart = normalizeSavedCartFromQuote(quote);
  const fingerprint = ongoingCartFingerprint(cart);
  const clientContext = normalizeClientContext(input.clientContext);
  const attribution = normalizeAttribution(input.attribution);
  const now = new Date();
  const values = {
    status: 'active',
    cart,
    customer,
    quoteSnapshot: quote,
    attribution,
    currency: quote.currency,
    total: quote.total,
    lastActivityAt: now,
    recoveryDueAt: nextRecoveryDueAt(now),
    recoverySentAt: null,
    recoveryMessageId: null,
    recoveryError: null,
    dismissedAt: null,
  };

  const requestedPublicId = String(input.publicId ?? '').trim();
  let ongoing = requestedPublicId
    ? await StorefrontOngoingCart.findOne({
        where: { publicId: parseStorefrontUuid(requestedPublicId, 'Ongoing cart ID') },
      })
    : null;
  if (ongoing) {
    const terminalError = terminalCartError(ongoing);
    if (terminalError) throw terminalError;
  }
  ongoing ??= await StorefrontOngoingCart.findOne({ where: activeWhere(sessionId) });
  if (!ongoing) {
    const recentSessionCarts = await StorefrontOngoingCart.findAll({
      where: {
        sessionId,
        status: 'converted',
        convertedAt: { [Op.gte]: dedupeCutoff(now) },
      },
      order: [['convertedAt', 'DESC']],
      limit: 5,
    });
    const recentConverted = recentSessionCarts.find((candidate) => (
      fingerprintFor(candidate) === fingerprint
    ));
    if (recentConverted) throw new HttpError(409, 'This cart has already been paid.');
    ongoing = await findRecentCustomerDuplicate(customer, fingerprint, now);
  }
  if (ongoing) {
    await ongoing.update({
      ...values,
      status: ongoing.status === 'checkout_started' ? 'checkout_started' : values.status,
      metadata: cartMetadata(ongoing.metadata, fingerprint, sessionId, clientContext),
    });
    return ongoing;
  }

  try {
    return await StorefrontOngoingCart.create({
      sessionId,
      ...values,
      openedAt: null,
      firstRecoverySentAt: null,
      lastRecoverySentAt: null,
      recoveryOpenedAt: null,
      recoveredAt: null,
      recoveryCount: 0,
      checkoutStartedAt: null,
      convertedAt: null,
      orderId: null,
      metadata: cartMetadata(null, fingerprint, sessionId, clientContext),
    });
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
    ongoing = await StorefrontOngoingCart.findOne({ where: activeWhere(sessionId) });
    if (!ongoing) throw error;
    await ongoing.update({
      ...values,
      metadata: cartMetadata(ongoing.metadata, fingerprint, sessionId, clientContext),
    });
    return ongoing;
  }
};

export const getUsableOngoingCart = async (
  publicIdValue: unknown,
  transaction?: Transaction,
  lock = false,
): Promise<StorefrontOngoingCart> => {
  const publicId = parseStorefrontUuid(publicIdValue, 'Ongoing cart ID');
  const ongoing = await StorefrontOngoingCart.findOne({
    where: { publicId, status: { [Op.in]: [...ONGOING_CART_STATUSES] } },
    transaction,
    ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!ongoing) throw new HttpError(410, 'This cart is no longer available.');
  return ongoing;
};

export const resetOngoingCartCheckoutActivity = async (
  ongoing: StorefrontOngoingCart,
  quote: StorefrontQuote,
  orderId: number,
  transaction?: Transaction,
): Promise<void> => {
  const now = new Date();
  await ongoing.update({
    status: 'checkout_started',
    quoteSnapshot: quote,
    cart: normalizeSavedCartFromQuote(quote),
    currency: quote.currency,
    total: quote.total,
    lastActivityAt: now,
    recoveryDueAt: nextRecoveryDueAt(now),
    recoverySentAt: null,
    recoveryMessageId: null,
    recoveryError: null,
    checkoutStartedAt: now,
    orderId,
  }, { transaction });
};

export const markOngoingCartConverted = async (
  orderId: number,
  convertedAt = new Date(),
  transaction?: Transaction,
): Promise<void> => {
  const ongoingCarts = await StorefrontOngoingCart.findAll({
    where: { orderId },
    transaction,
    ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  for (const ongoing of ongoingCarts) {
    await ongoing.update({
      status: 'converted',
      convertedAt,
      ...(ongoing.recoveryOpenedAt && !ongoing.recoveredAt ? { recoveredAt: convertedAt } : {}),
    }, { transaction });

    const fingerprint = fingerprintFor(ongoing);
    const candidates = await StorefrontOngoingCart.findAll({
      where: {
        status: { [Op.in]: [...ONGOING_CART_STATUSES] },
        lastActivityAt: { [Op.gte]: dedupeCutoff(convertedAt) },
        [Op.or]: [
          { sessionId: ongoing.sessionId },
          { customer: { [Op.contains]: { email: ongoing.customer.email } } as never },
        ],
      },
      transaction,
      ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
      limit: 200,
    });
    for (const duplicate of candidates) {
      if (Number(duplicate.id) === Number(ongoing.id)) continue;
      const matchesSession = duplicate.sessionId === ongoing.sessionId;
      const matchesCustomerCart = sameCustomer(duplicate.customer, ongoing.customer)
        && fingerprintFor(duplicate) === fingerprint;
      if (!matchesSession && !matchesCustomerCart) continue;
      const metadata = duplicate.metadata && typeof duplicate.metadata === 'object'
        ? duplicate.metadata
        : {};
      const events = Array.isArray(metadata.events) ? metadata.events : [];
      await duplicate.update({
        status: 'dismissed',
        dismissedAt: convertedAt,
        metadata: {
          ...metadata,
          events: [...events, {
            id: randomUUID(),
            type: 'post_payment_duplicate_dismissed',
            severity: 'info',
            message: 'Duplicate ongoing cart dismissed after payment completed.',
            details: { convertedCartPublicId: ongoing.publicId, orderId },
            occurredAt: convertedAt.toISOString(),
          }].slice(-50),
        },
      }, { transaction });
    }
  }
};

export type StorefrontOngoingCartEvent = {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  details: Record<string, unknown> | null;
  occurredAt: string;
};

const storedEvents = (ongoing: StorefrontOngoingCart): StorefrontOngoingCartEvent[] => {
  const events = ongoing.metadata?.events;
  return Array.isArray(events) ? events as StorefrontOngoingCartEvent[] : [];
};

export const recordOngoingCartEvent = async (
  ongoing: StorefrontOngoingCart,
  event: Omit<StorefrontOngoingCartEvent, 'id' | 'occurredAt'> & {
    dedupeKey?: string;
    source?: 'server' | 'stripe';
  },
): Promise<void> => {
  await recordServerJourneyEvent(ongoing, event);
};

export const recordOngoingCartEventByIdentity = async (
  identity: { publicId?: unknown; sessionId?: unknown },
  event: Omit<StorefrontOngoingCartEvent, 'id' | 'occurredAt'> & {
    dedupeKey?: string;
    source?: 'server' | 'stripe';
  },
  options: { resetRecoveryDue?: boolean } = {},
): Promise<void> => {
  try {
    const candidates: Record<string, string>[] = [];
    const publicId = String(identity.publicId ?? '').trim();
    const sessionId = String(identity.sessionId ?? '').trim();
    if (STOREFRONT_UUID_PATTERN.test(publicId)) candidates.push({ publicId });
    if (STOREFRONT_UUID_PATTERN.test(sessionId)) candidates.push({ sessionId });
    if (!candidates.length) return;
    const ongoing = await StorefrontOngoingCart.findOne({
      where: {
        [Op.or]: candidates,
        status: { [Op.in]: [...ONGOING_CART_STATUSES] },
      },
      order: [['lastActivityAt', 'DESC']],
    });
    if (!ongoing) return;
    if (options.resetRecoveryDue) {
      const now = new Date();
      await ongoing.update({
        lastActivityAt: now,
        recoveryDueAt: nextRecoveryDueAt(now),
      });
    }
    await recordOngoingCartEvent(ongoing, event);
  } catch {
    // Activity tracking must never interrupt the customer's storefront request.
  }
};

export const serializeOngoingCart = (
  ongoing: StorefrontOngoingCart,
  orderPublicId: string | null = null,
) => ({
  id: ongoing.id,
  publicId: ongoing.publicId,
  sessionId: ongoing.sessionId,
  status: ongoing.status,
  cart: ongoing.cart,
  customer: ongoing.customer,
  quote: ongoing.quoteSnapshot,
  attribution: ongoing.attribution,
  currency: ongoing.currency,
  total: Number(ongoing.total),
  lastActivityAt: ongoing.lastActivityAt,
  recoveryDueAt: ongoing.recoveryDueAt,
  recoverySentAt: ongoing.recoverySentAt,
  firstRecoverySentAt: ongoing.firstRecoverySentAt,
  lastRecoverySentAt: ongoing.lastRecoverySentAt,
  recoveryOpenedAt: ongoing.recoveryOpenedAt,
  recoveredAt: ongoing.recoveredAt,
  recoveryCount: ongoing.recoveryCount,
  events: [...storedEvents(ongoing)].reverse(),
  diagnostics: {
    cartFingerprint: typeof ongoing.metadata?.cartFingerprint === 'string'
      ? ongoing.metadata.cartFingerprint
      : ongoingCartFingerprint(ongoing.cart),
    sessionIds: Array.isArray(ongoing.metadata?.sessionIds) ? ongoing.metadata.sessionIds : [],
    browserIds: Array.isArray(ongoing.metadata?.browserIds) ? ongoing.metadata.browserIds : [],
    pageIds: Array.isArray(ongoing.metadata?.pageIds) ? ongoing.metadata.pageIds : [],
    lastBrowserId: ongoing.metadata?.lastBrowserId ?? null,
    lastPageId: ongoing.metadata?.lastPageId ?? null,
  },
  openedAt: ongoing.openedAt,
  checkoutStartedAt: ongoing.checkoutStartedAt,
  convertedAt: ongoing.convertedAt,
  dismissedAt: ongoing.dismissedAt,
  orderId: ongoing.orderId,
  orderPublicId,
  createdAt: ongoing.createdAt,
  updatedAt: ongoing.updatedAt,
});
