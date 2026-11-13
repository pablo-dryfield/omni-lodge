import { Op, type Transaction } from 'sequelize';
import { createHash, randomUUID } from 'node:crypto';
import sequelize from '../config/database.js';
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
import { normalizedCartEmail, normalizedCartName, normalizedCartPhone, resolveCartIdentity, sameCartExperiences } from './storefrontCartIdentity.js';
import { findCartIdentityCandidates } from './storefrontCartIdentityRepository.js';
import { dismissCartWithPaidMatch } from './storefrontCartBookingMatchService.js';
import { assertCartPaymentsEditable } from './storefrontCartPaymentGuardService.js';

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
  cartVersion?: unknown;
  cartVersionProtocol?: unknown;
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

const terminalCartError = (ongoing: StorefrontOngoingCart): HttpError | null => {
  if (ongoing.status === 'converted') return new HttpError(409, 'This cart has already been paid.');
  if (ongoing.status === 'dismissed') return new HttpError(410, 'This cart is no longer available.');
  return ONGOING_CART_STATUSES.includes(ongoing.status as typeof ONGOING_CART_STATUSES[number])
    ? null
    : new HttpError(409, 'This cart is not available for checkout.');
};

export const assertOngoingCartVersion = (
  ongoing: StorefrontOngoingCart, expected: unknown, requested: StorefrontCartInput, protocol?: unknown,
): void => {
  if (typeof expected === 'string' && !/^[a-f0-9]{64}$/.test(expected)) {
    throw new HttpError(400, 'Invalid cart version. Refresh your cart.');
  }
  if (ongoing.status === 'dismissed' && ongoing.metadata?.mergeReason === 'customer_identity') {
    throw new HttpError(409, 'This cart changed on another device. Review your selections before continuing.');
  }
  const required = protocol === 1 || ongoing.metadata?.cartVersionProtocol === 1 || Boolean(expected);
  if (!required) return;
  const currentVersion = ongoingCartFingerprint(ongoing.cart);
  // A retry of the exact selection already saved is safe even if its acknowledgment was lost.
  if (expected !== currentVersion && ongoingCartFingerprint(requested) !== currentVersion) {
    throw new HttpError(409, 'This cart changed on another device. Review your selections before continuing.');
  }
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

  return sequelize.transaction(async transaction => {
    // Serialize matching identities and browser sessions across processes, not just this server.
    const keys = [
      `session:${sessionId}`, `email:${normalizedCartEmail(customer.email)}`,
      `phone:${normalizedCartPhone(customer)}`, `name:${normalizedCartName(customer.fullName)}`,
    ].filter(key => !key.endsWith(':')).sort();
    for (const key of keys) {
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))', {
        replacements: { key: `storefront-cart:${key}` }, transaction,
      });
    }
    const requestedPublicId = String(input.publicId ?? '').trim();
    let ongoing = requestedPublicId
      ? await StorefrontOngoingCart.findOne({
          where: { publicId: parseStorefrontUuid(requestedPublicId, 'Ongoing cart ID') },
          transaction, lock: transaction.LOCK.UPDATE,
        }) : null;
    if (ongoing) {
      // An already-open page can still submit a superseded ID, including legacy
      // clients. Require review rather than letting it supersede the newer draft again.
      if (ongoing.status === 'dismissed' && ongoing.metadata?.mergeReason === 'customer_identity') {
        assertOngoingCartVersion(ongoing, input.cartVersion, cart, input.cartVersionProtocol);
        ongoing = null;
      }
      else {
        const terminalError = terminalCartError(ongoing);
        if (terminalError) throw terminalError;
      }
    }
    ongoing ??= await StorefrontOngoingCart.findOne({
      where: activeWhere(sessionId), transaction, lock: transaction.LOCK.UPDATE,
    });
    if (ongoing) assertOngoingCartVersion(ongoing, input.cartVersion, cart, input.cartVersionProtocol);
    if (!ongoing) {
      const recentSessionCarts = await StorefrontOngoingCart.findAll({
        where: { sessionId, status: 'converted', convertedAt: { [Op.gte]: dedupeCutoff(now) } },
        order: [['convertedAt', 'DESC']], transaction, limit: 5,
      });
      if (recentSessionCarts.some(candidate => fingerprintFor(candidate) === fingerprint)) {
        throw new HttpError(409, 'This cart has already been paid.');
      }
    }
    const candidates = await findCartIdentityCandidates(customer, transaction);
    const match = resolveCartIdentity(customer, candidates.filter(candidate => Number(candidate.id) !== Number(ongoing?.id)));
    const duplicates = match.kind === 'matched'
      ? match.carts.filter(candidate => Number(candidate.id) !== Number(ongoing?.id)) : [];
    await assertCartPaymentsEditable([...(ongoing ? [ongoing] : []), ...duplicates], transaction);
    if (ongoing?.status === 'sending_recovery' || duplicates.some(candidate => candidate.status === 'sending_recovery')) {
      throw new HttpError(409, 'Your cart is being updated. Please try again in a moment.');
    }
    if (ongoing) {
      await ongoing.update({
        ...values,
        status: ongoing.status === 'checkout_started' ? 'checkout_started' : values.status,
        metadata: { ...cartMetadata(ongoing.metadata, fingerprint, sessionId, clientContext), identityReview: null,
          ...(input.cartVersionProtocol === 1 ? { cartVersionProtocol: 1 } : {}), },
      }, { transaction });
    } else {
      // New browsers get their own opaque access identity and payment context. Never return
      // somebody else's saved contact details, order or Stripe payment intent from a lookup.
      ongoing = await StorefrontOngoingCart.create({
        sessionId, ...values, openedAt: null, firstRecoverySentAt: null,
        lastRecoverySentAt: null, recoveryOpenedAt: null, recoveredAt: null, recoveryCount: 0,
        checkoutStartedAt: null, convertedAt: null, orderId: null,
        metadata: { ...cartMetadata(null, fingerprint, sessionId, clientContext),
          ...(input.cartVersionProtocol === 1 ? { cartVersionProtocol: 1 } : {}), },
      }, { transaction });
    }
    for (const duplicate of duplicates) {
      await mergeOngoingCartHistory(ongoing, duplicate, match.matchedBy, now, transaction);
    }
    // An exact name is a review hint, never proof that a public visitor owns another cart.
    if (match.kind === 'name_only') {
      const ids = match.carts.filter(candidate => Number(candidate.id) !== Number(ongoing!.id)).map(candidate => candidate.id);
      if (ids.length) await ongoing.update({ metadata: {
        ...ongoing.metadata, identityReview: { reason: 'Name matches; email and phone do not.', candidateCartIds: ids },
      } }, { transaction });
    }
    return ongoing;
  });
};

export const mergeOngoingCartHistory = async (
  current: StorefrontOngoingCart, previous: StorefrontOngoingCart, matchedBy: string,
  now = new Date(), transaction?: Transaction,
): Promise<void> => {
  const previousIds = Array.isArray(previous.metadata?.mergedCartIds) ? previous.metadata.mergedCartIds : [];
  const currentIds = Array.isArray(current.metadata?.mergedCartIds) ? current.metadata.mergedCartIds : [];
  const mergedCartIds = [...new Set([...currentIds, previous.id, ...previousIds].map(Number))].filter(id => Number.isSafeInteger(id) && id > 0 && id !== Number(current.id));
  await previous.update({ status: 'dismissed', dismissedAt: now, metadata: {
    ...previous.metadata, mergedIntoCartPublicId: current.publicId, mergeReason: 'customer_identity',
    events: [...(Array.isArray(previous.metadata?.events) ? previous.metadata.events : []), {
      id: randomUUID(), type: 'cart_merged', severity: 'info',
      message: 'Superseded by the latest cart. Original selections and payment history are retained.',
      details: { matchedBy, activeCartPublicId: current.publicId }, occurredAt: now.toISOString(),
    }].slice(-50),
  } }, { transaction });
  await current.update({ metadata: { ...current.metadata, mergedCartIds, identityReview: null } }, { transaction });
};

export const reconcileOngoingCart = async (snapshot: StorefrontOngoingCart): Promise<void> => {
  await sequelize.transaction(async transaction => {
    const customer = snapshot.customer;
    for (const key of [
      `email:${normalizedCartEmail(customer.email)}`, `phone:${normalizedCartPhone(customer)}`,
      `name:${normalizedCartName(customer.fullName)}`, `session:${snapshot.sessionId}`,
    ].filter(value => !value.endsWith(':')).sort()) {
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))', {
        replacements: { key: `storefront-cart:${key}` }, transaction,
      });
    }
    const current = await StorefrontOngoingCart.findByPk(snapshot.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!current || !['active', 'checkout_started', 'recovery_sent'].includes(current.status)) return;
    if (JSON.stringify(current.customer) !== JSON.stringify(customer)) return;
    if (await dismissCartWithPaidMatch(current, transaction)) return;
    const others = (await findCartIdentityCandidates(customer, transaction)).filter(candidate => Number(candidate.id) !== Number(current.id));
    const match = resolveCartIdentity(customer, others);
    if (match.kind !== 'matched' || !match.carts.length) return;
    const group = [current, ...match.carts];
    if (group.some(cart => cart.status === 'sending_recovery')) return;
    group.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime() || Number(b.id) - Number(a.id));
    for (const older of group.slice(1)) await mergeOngoingCartHistory(group[0], older, match.matchedBy, new Date(), transaction);
  });
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
  paid?: { cart: StorefrontCartInput; customer: StorefrontOngoingCartCustomer },
): Promise<void> => {
  const ongoingCarts = await StorefrontOngoingCart.findAll({
    where: { orderId }, transaction,
    ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  for (const ongoing of ongoingCarts) {
    if (paid && !sameCartExperiences(ongoing.cart, paid.cart)) {
      // A delayed payment for an earlier selection must not complete a newly edited trip.
      await ongoing.update({ orderId: null, metadata: {
        ...ongoing.metadata, previousPaidOrderId: orderId,
      } }, { transaction });
      continue;
    }
    await ongoing.update({
      status: 'converted', convertedAt,
      ...(ongoing.recoveryOpenedAt && !ongoing.recoveredAt ? { recoveredAt: convertedAt } : {}),
    }, { transaction });
  }
  const customer = paid?.customer ?? ongoingCarts[0]?.customer;
  const paidCart = paid?.cart ?? ongoingCarts[0]?.cart;
  if (!customer || !paidCart) return;
  const candidates = await findCartIdentityCandidates(customer, transaction);
  const match = resolveCartIdentity(customer, candidates);
  if (match.kind !== 'matched') return;
  for (const duplicate of match.carts) {
    if (ongoingCarts.some(cart => Number(cart.id) === Number(duplicate.id))) continue;
    if (duplicate.createdAt && new Date(duplicate.createdAt).getTime() > convertedAt.getTime()) continue;
    if (!sameCartExperiences(duplicate.cart, paidCart)) continue;
    const metadata = duplicate.metadata ?? {};
    const events = Array.isArray(metadata.events) ? metadata.events : [];
    await duplicate.update({
      status: 'dismissed', dismissedAt: convertedAt,
      metadata: {
        ...metadata, alreadyBooked: { kind: 'order', id: orderId },
        events: [...events, {
          id: randomUUID(), type: 'post_payment_duplicate_dismissed', severity: 'info',
          message: 'Duplicate ongoing cart dismissed after payment completed.',
          details: { convertedCartPublicId: ongoingCarts[0]?.publicId ?? null, orderId, matchedBy: match.matchedBy },
          occurredAt: convertedAt.toISOString(),
        }].slice(-50),
      },
    }, { transaction });
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
  options: { includeRecoveryOfferAudit?: boolean } = {},
) => ({
  id: ongoing.id,
  publicId: ongoing.publicId,
  sessionId: ongoing.sessionId,
  status: ongoing.status,
  cart: ongoing.cart,
  cartVersion: ongoingCartFingerprint(ongoing.cart),
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
  identityReview: ongoing.metadata?.identityReview ? 'Name match needs email or phone confirmation.' : null,
  events: [...storedEvents(ongoing)]
    .filter(event => options.includeRecoveryOfferAudit !== false
      || !['recovery_offer_updated', 'recovery_email_sent'].includes(event.type))
    .reverse(),
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
