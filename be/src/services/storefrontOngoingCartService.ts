import { Op, UniqueConstraintError, type Transaction } from 'sequelize';
import { randomUUID } from 'node:crypto';
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
};

const activeWhere = (sessionId: string) => ({
  sessionId,
  status: { [Op.in]: [...ONGOING_CART_STATUSES] },
});

export const upsertOngoingCart = async (input: OngoingCartInput): Promise<StorefrontOngoingCart> => {
  const sessionId = parseStorefrontUuid(input.sessionId, 'Cart session ID');
  const customer = normalizeCustomer(input.customer);
  const quote = input.quote ?? await quoteStorefrontCart(input.cart as StorefrontCartInput);
  const cart = normalizeSavedCartFromQuote(quote);
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
        where: {
          publicId: parseStorefrontUuid(requestedPublicId, 'Ongoing cart ID'),
          status: { [Op.in]: [...ONGOING_CART_STATUSES] },
        },
      })
    : null;
  ongoing ??= await StorefrontOngoingCart.findOne({ where: activeWhere(sessionId) });
  if (ongoing) {
    await ongoing.update({
      ...values,
      status: ongoing.status === 'checkout_started' ? 'checkout_started' : values.status,
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
      metadata: { recoveryCount: 0 },
    });
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
    ongoing = await StorefrontOngoingCart.findOne({ where: activeWhere(sessionId) });
    if (!ongoing) throw error;
    await ongoing.update(values);
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
  event: Omit<StorefrontOngoingCartEvent, 'id' | 'occurredAt'> & { dedupeKey?: string },
): Promise<void> => {
  const metadata = ongoing.metadata && typeof ongoing.metadata === 'object' ? ongoing.metadata : {};
  const events = storedEvents(ongoing);
  if (event.dedupeKey && events.some((item) => item.details?.dedupeKey === event.dedupeKey)) return;
  const nextEvent: StorefrontOngoingCartEvent = {
    id: randomUUID(),
    type: event.type.slice(0, 64),
    severity: event.severity,
    message: event.message.slice(0, 1000),
    details: event.details || event.dedupeKey
      ? { ...(event.details || {}), ...(event.dedupeKey ? { dedupeKey: event.dedupeKey } : {}) }
      : null,
    occurredAt: new Date().toISOString(),
  };
  await ongoing.update({ metadata: { ...metadata, events: [...events, nextEvent].slice(-50) } });
};

export const recordOngoingCartEventByIdentity = async (
  identity: { publicId?: unknown; sessionId?: unknown },
  event: Omit<StorefrontOngoingCartEvent, 'id' | 'occurredAt'> & { dedupeKey?: string },
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
    if (event.dedupeKey && storedEvents(ongoing).some(
      (item) => item.details?.dedupeKey === event.dedupeKey,
    )) return;
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
  openedAt: ongoing.openedAt,
  checkoutStartedAt: ongoing.checkoutStartedAt,
  convertedAt: ongoing.convertedAt,
  dismissedAt: ongoing.dismissedAt,
  orderId: ongoing.orderId,
  orderPublicId,
  createdAt: ongoing.createdAt,
  updatedAt: ongoing.updatedAt,
});
