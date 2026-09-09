import { createHash } from 'node:crypto';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';
import { Op, UniqueConstraintError, type Order, type Transaction, type WhereOptions } from 'sequelize';
import sequelize from '../config/database.js';
import HttpError from '../errors/HttpError.js';
import AuditLog from '../models/AuditLog.js';
import Booking from '../models/Booking.js';
import BookingEvent from '../models/BookingEvent.js';
import Product from '../models/Product.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import StorefrontOrderItem from '../models/StorefrontOrderItem.js';
import User from '../models/User.js';
import { fulfillPaidOrder } from '../controllers/storefrontCommerceController.js';
import {
  quoteStorefrontCart,
  STOREFRONT_CURRENCY,
  type StorefrontCartInput,
  type StorefrontQuote,
} from './storefrontCommerceService.js';
import { addCustomerToSavedCart, normalizeSavedCartFromQuote } from './storefrontSavedCartService.js';
import {
  lockStorefrontCartReservationResources,
  releaseStorefrontOrderResourceReservations,
  reserveStorefrontOrderResources,
} from './storefrontOrderResourceReservationService.js';
import { findLockedStorefrontOrderWithItems } from './storefrontOrderPersistenceService.js';
import { projectStorefrontOrderBookings } from './storefrontOrderProjectionService.js';
import { resolveBankTransferCancellation } from './storefrontBankTransferCancellationPolicy.js';
import { getStorefrontExperienceStartAt } from './storefrontBookingProjectionService.js';
import {
  getStorefrontBankTransferAccount,
  getStorefrontBankTransferDueHours,
} from './storefrontBankTransferConfigService.js';
import {
  deliverStorefrontBankTransferCancellationEmail,
  deliverStorefrontBankTransferInstructionsEmail,
  deliverStorefrontOrderEmails,
  isStorefrontOrderConfirmationEmailComplete,
} from './storefrontOrderEmailService.js';
import logger from '../utils/logger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type BankTransferCustomer = {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string | null;
  countryCode: string | null;
};

export type CreateBankTransferOrderInput = {
  actorId: number;
  allowedProductTypeIds: number[] | null;
  clientRequestId: unknown;
  customer: unknown;
  cart: unknown;
};

export type ReceiveBankTransferOrderInput = {
  actorId: number;
  allowedProductTypeIds: number[] | null;
  publicId: unknown;
  paymentReference?: unknown;
  note?: unknown;
  clientRequestId?: unknown;
};

export type CancelBankTransferOrderInput = {
  actorId: number;
  allowedProductTypeIds: number[] | null;
  publicId: unknown;
  note?: unknown;
};

const clean = (value: unknown, maxLength: number): string =>
  (typeof value === 'string' ? value : '').trim().slice(0, maxLength);

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const parseUuid = (value: unknown, label: string): string => {
  const normalized = (typeof value === 'string' ? value : '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new HttpError(400, `${label} is invalid.`);
  return normalized;
};

const parseCustomer = (value: unknown): BankTransferCustomer => {
  const source = asRecord(value);
  if (!source) throw new HttpError(400, 'Customer details are required.');
  const suppliedFirstName = clean(source.firstName, 100);
  const suppliedLastName = clean(source.lastName, 100);
  const suppliedFullName = clean(source.fullName, 201);
  const parts = suppliedFullName.split(/\s+/).filter(Boolean);
  const firstName = suppliedFirstName || parts.shift() || '';
  const lastName = suppliedLastName || parts.join(' ');
  const fullName = `${firstName} ${lastName}`.trim();
  const email = clean(source.email, 254).toLowerCase();
  const suppliedPhone = clean(source.phone, 40) || null;
  const countryCodeValue = typeof (source.phoneCountry ?? source.countryCode) === 'string'
    ? String(source.phoneCountry ?? source.countryCode).trim().toUpperCase()
    : '';
  let countryCode = countryCodeValue || null;
  if (!fullName) throw new HttpError(400, 'Customer name is required.');
  if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'A valid customer email is required.');
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    throw new HttpError(400, 'Phone country must use a two-letter country code.');
  }
  let phone: string | null = null;
  if (suppliedPhone) {
    try {
      const parsed = parsePhoneNumberFromString(
        suppliedPhone,
        countryCode ? countryCode as CountryCode : undefined,
      );
      if (!parsed?.isValid()) throw new Error('invalid phone');
      phone = parsed.number;
      countryCode = parsed.country || countryCode;
    } catch {
      throw new HttpError(400, 'Phone number is invalid for the selected country.');
    }
  }
  return { firstName, lastName, fullName, email, phone, countryCode };
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  const source = asRecord(value);
  if (!source) return value;
  return Object.keys(source).sort().reduce<Record<string, unknown>>((result, key) => {
    if (source[key] !== undefined) result[key] = stableValue(source[key]);
    return result;
  }, {});
};

const requestHash = (customer: BankTransferCustomer, cart: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(stableValue({ customer, cart })))
    .digest('hex');

const paymentReference = (orderId: number): string => `KTK-BT-${String(orderId).padStart(6, '0')}`;

const loadOrder = async (publicId: string): Promise<StorefrontOrder> => {
  const order = await StorefrontOrder.findOne({
    where: { publicId },
    include: [{ model: StorefrontOrderItem, as: 'items' }],
    order: [[{ model: StorefrontOrderItem, as: 'items' }, 'id', 'ASC']],
  });
  if (!order || order.orderSource !== 'backoffice' || order.paymentMethod !== 'bank_transfer') {
    throw new HttpError(404, 'Bank transfer order not found.');
  }
  return order;
};

const assertProductScope = async (
  productIdsInput: number[],
  allowedProductTypeIds: number[] | null,
  transaction?: Transaction,
): Promise<void> => {
  const normalizedProductIds = productIdsInput.map(Number);
  if (
    normalizedProductIds.length === 0
    || normalizedProductIds.some((productId) => !Number.isInteger(productId) || productId <= 0)
  ) {
    throw new HttpError(409, 'The bank transfer order has no valid booking items.');
  }
  const productIds = [...new Set(normalizedProductIds)];
  if (allowedProductTypeIds === null) return;
  const products = await Product.findAll({
    where: { id: { [Op.in]: productIds } },
    attributes: ['id', 'productTypeId'],
    transaction,
  });
  if (
    products.length !== productIds.length
    || products.some((product) => !allowedProductTypeIds.includes(Number(product.productTypeId)))
  ) {
    throw new HttpError(403, 'One or more products are outside your assigned product scope.');
  }
};

const createItems = async (
  order: StorefrontOrder,
  quote: StorefrontQuote,
  transaction: Transaction,
): Promise<StorefrontOrderItem[]> => StorefrontOrderItem.bulkCreate(
  quote.items.map((item) => ({
    orderId: order.id,
    productId: item.productId,
    productName: item.productName,
    productSlug: item.productSlug,
    quantity: item.quantity,
    experienceDate: item.experienceDate,
    experienceTime: item.experienceTime,
    unitPrice: item.unitPrice,
    baseTotal: item.baseTotal,
    addonTotal: item.addonTotal,
    total: item.total,
    addons: item.addons,
    options: item.options,
  })) as never[],
  { transaction, returning: true },
);

const findIdempotentOrder = async (
  key: string,
  hash: string,
  transaction?: Transaction,
): Promise<StorefrontOrder | null> => {
  const order = await StorefrontOrder.findOne({
    where: { idempotencyKey: key },
    transaction,
    ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!order) return null;
  if (order.idempotencyRequestHash !== hash) {
    throw new HttpError(409, 'This request ID was already used for a different booking order.');
  }
  return order;
};

const createOrderTransaction = async (
  actorId: number,
  clientRequestId: string,
  hash: string,
  customer: BankTransferCustomer,
  cart: StorefrontCartInput,
  allowedProductTypeIds: number[] | null,
): Promise<{ order: StorefrontOrder; created: boolean }> => sequelize.transaction(async (transaction) => {
  const existing = await findIdempotentOrder(clientRequestId, hash, transaction);
  if (existing) return { order: existing, created: false };
  await lockStorefrontCartReservationResources(cart, transaction);
  // A same-key request may have committed while this transaction waited for a
  // shared stock/promotion lock. Recheck before quoting so the retry returns
  // the first order instead of reporting that its own newly-created hold used
  // the final unit.
  const concurrent = await findIdempotentOrder(clientRequestId, hash, transaction);
  if (concurrent) return { order: concurrent, created: false };
  const quote = await quoteStorefrontCart(cart, transaction);
  if (quote.total <= 0) throw new HttpError(400, 'A bank transfer order must have an amount greater than zero.');
  await assertProductScope(quote.items.map((item) => item.productId), allowedProductTypeIds, transaction);
  const now = new Date();
  const configuredDueAt = new Date(
    now.getTime() + getStorefrontBankTransferDueHours() * 60 * 60 * 1000,
  );
  const earliestExperienceAt = quote.items
    .map((item) => getStorefrontExperienceStartAt(
      item.experienceDate,
      item.experienceTime || (item.experienceDate ? '23:59' : null),
    ))
    .filter((value): value is Date => value !== null)
    .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
  const dueAt = earliestExperienceAt && earliestExperienceAt < configuredDueAt
    ? new Date(Math.max(now.getTime(), earliestExperienceAt.getTime()))
    : configuredDueAt;
  const normalizedCart = normalizeSavedCartFromQuote(quote);
  const order = await StorefrontOrder.create({
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    orderSource: 'backoffice',
    paymentMethod: 'bank_transfer',
    currency: quote.currency,
    subtotal: quote.subtotal,
    addonTotal: quote.addonTotal,
    discountTotal: quote.discountTotal,
    total: quote.total,
    customerFirstName: customer.firstName,
    customerLastName: customer.lastName,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    customerCountryCode: customer.countryCode,
    discountCode: quote.discountCode,
    attribution: {
      source: 'backoffice_bank_transfer',
      utm_source: 'omnilodge',
      utm_medium: 'bank_transfer',
    },
    metadata: {
      promotionId: quote.promotionId,
      promotionIds: quote.discounts.map((discount) => discount.promotionId),
      discountCodes: quote.discountCodes,
      discounts: quote.discounts,
      cart: normalizedCart,
    },
    createdByUserId: actorId,
    paymentDueAt: dueAt,
    idempotencyKey: clientRequestId,
    idempotencyRequestHash: hash,
  } as never, { transaction });
  await order.update({ paymentReference: paymentReference(Number(order.id)) }, { transaction });
  order.items = await createItems(order, quote, transaction);
  await reserveStorefrontOrderResources({
    orderId: Number(order.id),
    orderItems: order.items,
    quote,
    paymentDueAt: dueAt,
    transaction,
  });
  const projection = await projectStorefrontOrderBookings(order, {
    bookingStatus: 'pending',
    paymentStatus: 'unpaid',
    paymentMethod: 'bank_transfer',
    actorId,
    now,
  }, transaction);

  await AuditLog.create({
    actorId,
    action: 'storefront.bank_transfer_order_created',
    entity: 'storefront_order',
    entityId: String(order.id),
    metaJson: {
      publicId: order.publicId,
      paymentReference: order.paymentReference,
      total: Number(order.total),
      currency: order.currency,
      bookingIds: projection.bookings.map((booking) => Number(booking.id)),
    },
  }, { transaction });
  await BookingEvent.bulkCreate(projection.bookings.map((booking) => ({
    bookingId: booking.id,
    emailId: null,
    eventType: 'created',
    platform: 'omnilodge',
    statusAfter: 'pending',
    eventPayload: {
      source: 'backoffice_bank_transfer',
      orderPublicId: order.publicId,
      paymentReference: order.paymentReference,
    },
    occurredAt: now,
    processedAt: now,
  })) as never[], { transaction });
  return { order, created: true };
});

const serializeOrders = async (orders: StorefrontOrder[]) => {
  const publicIds = orders.map((order) => order.publicId);
  const userIds = [...new Set(orders.flatMap((order) => [
    order.createdByUserId,
    order.paymentReceivedByUserId,
  ]).filter((id): id is number => id != null).map(Number))];
  const [bookings, users] = await Promise.all([
    publicIds.length > 0
      ? Booking.findAll({
          where: { platform: 'omnilodge', platformOrderId: { [Op.in]: publicIds } },
          attributes: ['id', 'platformOrderId', 'platformBookingId'],
        })
      : [],
    userIds.length > 0
      ? User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'firstName', 'lastName'] })
      : [],
  ]);
  const bookingIds = new Map(bookings.map((booking) => [booking.platformBookingId, Number(booking.id)]));
  const userById = new Map(users.map((user) => [Number(user.id), user]));
  const actor = (id: number | null) => {
    if (id == null) return null;
    const user = userById.get(Number(id));
    return { id: Number(id), fullName: user ? `${user.firstName} ${user.lastName}`.trim() : `User #${id}` };
  };

  return orders.map((order) => ({
    publicId: order.publicId,
    status: order.status === 'cancelled'
      ? 'cancelled'
      : order.paymentStatus === 'paid'
        ? 'payment_received'
        : 'awaiting_transfer',
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    paymentReference: order.paymentReference,
    paymentDueAt: order.paymentDueAt,
    subtotal: Number(order.subtotal),
    addonTotal: Number(order.addonTotal),
    discountTotal: Number(order.discountTotal),
    total: Number(order.total),
    currency: order.currency,
    customer: {
      fullName: `${order.customerFirstName} ${order.customerLastName}`.trim(),
      firstName: order.customerFirstName,
      lastName: order.customerLastName,
      email: order.customerEmail,
      phone: order.customerPhone,
      phoneCountry: order.customerCountryCode,
      countryCode: order.customerCountryCode,
    },
    items: (order.items || []).map((item) => ({
      bookingId: bookingIds.get(`${order.publicId}-${item.id}`) ?? null,
      productId: item.productId,
      productName: item.productName,
      productSlug: item.productSlug,
      quantity: item.quantity,
      experienceDate: item.experienceDate,
      experienceTime: item.experienceTime,
      unitPrice: Number(item.unitPrice),
      baseTotal: Number(item.baseTotal),
      addonTotal: Number(item.addonTotal),
      total: Number(item.total),
      addons: item.addons,
      options: item.options,
    })),
    createdBy: actor(order.createdByUserId),
    receivedBy: actor(order.paymentReceivedByUserId),
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    customerEmailSentAt: order.customerEmailSentAt,
    internalEmailSentAt: order.internalEmailSentAt,
    confirmationEmailComplete: isStorefrontOrderConfirmationEmailComplete(order),
    bankTransferInstructionsEmailSentAt: order.bankTransferEmailSentAt,
    bankTransferCancellationEmailSentAt: order.bankTransferCancellationEmailSentAt,
    cancellationReason: typeof order.metadata?.bankTransferCancellationReason === 'string'
      ? order.metadata.bankTransferCancellationReason
      : null,
    cancelledAt: typeof order.metadata?.bankTransferCancelledAt === 'string'
      ? order.metadata.bankTransferCancelledAt
      : null,
    receivedPaymentReference: typeof order.metadata?.receivedPaymentReference === 'string'
      ? order.metadata.receivedPaymentReference
      : null,
    paymentNote: order.paymentNote,
  }));
};

export const serializeBankTransferOrder = async (order: StorefrontOrder) =>
  (await serializeOrders([order]))[0];

const resolveAllowedProductIds = async (
  allowedProductTypeIds: number[] | null,
): Promise<Set<number> | null> => {
  if (allowedProductTypeIds === null) return null;
  const productTypeIds = [...new Set(allowedProductTypeIds
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))];
  if (productTypeIds.length === 0) return new Set();
  const products = await Product.findAll({
    where: { productTypeId: { [Op.in]: productTypeIds } },
    attributes: ['id'],
  });
  return new Set(products.map((product) => Number(product.id)));
};

const orderMatchesProductScope = (
  order: StorefrontOrder,
  allowedProductIds: ReadonlySet<number> | null,
): boolean => {
  if (allowedProductIds === null) return true;
  const items = order.items || [];
  return items.length > 0 && items.every((item) => allowedProductIds.has(Number(item.productId)));
};

const loadScopedLimitedOrders = async (
  stateWhere: WhereOptions,
  orderBy: Order,
  limit: number,
  allowedProductIds: ReadonlySet<number> | null,
): Promise<StorefrontOrder[]> => {
  if (limit <= 0 || (allowedProductIds !== null && allowedProductIds.size === 0)) return [];
  const baseOptions = {
    where: {
      orderSource: 'backoffice',
      paymentMethod: 'bank_transfer',
      ...stateWhere,
    },
    include: [{ model: StorefrontOrderItem, as: 'items' }],
    order: orderBy,
  };
  if (allowedProductIds === null) {
    return StorefrontOrder.findAll({ ...baseOptions, limit });
  }

  const result: StorefrontOrder[] = [];
  const batchSize = 250;
  let offset = 0;
  while (result.length < limit) {
    const batch = await StorefrontOrder.findAll({
      ...baseOptions,
      limit: batchSize,
      offset,
    });
    result.push(...batch.filter((candidate) => orderMatchesProductScope(candidate, allowedProductIds)));
    if (batch.length < batchSize) break;
    offset += batch.length;
  }
  return result.slice(0, limit);
};

export const listBankTransferOrders = async (
  allowedProductTypeIds: number[] | null,
  options: { includeCancelled?: boolean } = {},
) => {
  const allowedProductIds = await resolveAllowedProductIds(allowedProductTypeIds);
  const allAwaitingOrders = await StorefrontOrder.findAll({
    where: {
      orderSource: 'backoffice',
      paymentMethod: 'bank_transfer',
      status: 'pending_payment',
      paymentStatus: 'unpaid',
    },
    include: [{ model: StorefrontOrderItem, as: 'items' }],
    order: [['createdAt', 'DESC'], [{ model: StorefrontOrderItem, as: 'items' }, 'id', 'ASC']],
  });
  const awaitingOrders = allAwaitingOrders.filter((order) => orderMatchesProductScope(order, allowedProductIds));
  const paidLimit = Math.max(0, 250 - awaitingOrders.length);
  const paidOrders = paidLimit > 0
    ? await loadScopedLimitedOrders(
        { status: 'confirmed', paymentStatus: 'paid' },
        [['createdAt', 'DESC'], [{ model: StorefrontOrderItem, as: 'items' }, 'id', 'ASC']],
        paidLimit,
        allowedProductIds,
      )
    : [];
  const cancelledOrders = options.includeCancelled
    ? await loadScopedLimitedOrders(
        { status: 'cancelled', paymentStatus: 'unpaid' },
        [['updatedAt', 'DESC'], [{ model: StorefrontOrderItem, as: 'items' }, 'id', 'ASC']],
        100,
        allowedProductIds,
      )
    : [];
  // Awaiting reservations are intentionally unbounded here. They are the work
  // queue and must never disappear behind the bounded paid-order history.
  const orders = [...awaitingOrders, ...paidOrders, ...cancelledOrders];
  return serializeOrders(orders);
};

export const createBankTransferOrder = async (input: CreateBankTransferOrderInput) => {
  const clientRequestId = parseUuid(input.clientRequestId, 'Client request ID');
  const customer = parseCustomer(input.customer);
  const cartInput = input.cart as StorefrontCartInput;
  if (!cartInput || !Array.isArray(cartInput.items)) {
    throw new HttpError(400, 'The cart must contain at least one item.');
  }
  if (cartInput.items.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new HttpError(400, 'One or more cart items are invalid.');
  }
  const cart = addCustomerToSavedCart(cartInput, customer);
  const hash = requestHash(customer, cart);
  const existing = await findIdempotentOrder(clientRequestId, hash);
  if (existing) {
    const order = await loadOrder(existing.publicId);
    await assertProductScope((order.items || []).map((item) => item.productId), input.allowedProductTypeIds);
    let emailError: string | null = null;
    if (!order.bankTransferEmailSentAt) {
      try {
        await deliverStorefrontBankTransferInstructionsEmail(
          order.publicId,
          getStorefrontBankTransferAccount(order.currency),
        );
      } catch (error) {
        emailError = 'The booking already exists, but the bank transfer email could not be sent.';
        logger.error(
          `[storefront-email] Idempotent bank-transfer delivery failed for ${order.publicId}: ${(error as Error).message}`,
        );
      }
    }
    return { order: await loadOrder(order.publicId), created: false, emailError };
  }

  // The storefront currency is canonical today. Resolve configuration before
  // committing an order so a missing bank account cannot leave an unsendable
  // reservation in the operations queue.
  const account = getStorefrontBankTransferAccount(STOREFRONT_CURRENCY);

  let result: { order: StorefrontOrder; created: boolean };
  try {
    result = await createOrderTransaction(
      input.actorId,
      clientRequestId,
      hash,
      customer,
      cart,
      input.allowedProductTypeIds,
    );
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
    const concurrent = await findIdempotentOrder(clientRequestId, hash);
    if (!concurrent) throw error;
    result = { order: concurrent, created: false };
  }

  let emailError: string | null = null;
  const createdOrder = await loadOrder(result.order.publicId);
  if (!createdOrder.bankTransferEmailSentAt) {
    try {
      await deliverStorefrontBankTransferInstructionsEmail(createdOrder.publicId, account);
    } catch (error) {
      emailError = 'The booking was created, but the bank transfer email could not be sent.';
      logger.error(
        `[storefront-email] Bank-transfer instructions failed for ${createdOrder.publicId}: ${(error as Error).message}`,
      );
    }
  }
  return { order: await loadOrder(createdOrder.publicId), created: result.created, emailError };
};

export const receiveBankTransferOrder = async (input: ReceiveBankTransferOrderInput) => {
  const publicId = parseUuid(input.publicId, 'Bank transfer order ID');
  const order = await loadOrder(publicId);
  await assertProductScope((order.items || []).map((item) => item.productId), input.allowedProductTypeIds);
  if (order.status === 'confirmed' && order.paymentStatus === 'paid') {
    // Safe retry: repair any projection/email work without changing the original
    // receiver, note, or bank-statement reference.
    await fulfillPaidOrder(publicId, null, { paymentMethod: 'bank_transfer' });
    return loadOrder(publicId);
  }
  if (order.status !== 'pending_payment' || order.paymentStatus !== 'unpaid') {
    throw new HttpError(409, 'This bank transfer order can no longer be marked as paid.');
  }
  const receivedReference = clean(input.paymentReference, 160) || null;
  const note = clean(input.note, 2000) || null;
  const clientRequestId = input.clientRequestId != null && clean(input.clientRequestId, 36)
    ? parseUuid(input.clientRequestId, 'Client request ID')
    : null;

  const paidOrder = await fulfillPaidOrder(publicId, null, {
    actorId: input.actorId,
    paymentMethod: 'bank_transfer',
    paymentReceivedByUserId: input.actorId,
    paymentNote: note,
    receivedPaymentReference: receivedReference,
    clientRequestId,
  });
  // Cancellation/expiry and payment confirmation deliberately compete for the
  // same order lock. If cancellation won that race, fulfillment returns the
  // terminal order without reviving it; surface that result as a conflict so
  // the client never reports a cancelled reservation as successfully paid.
  if (paidOrder.status !== 'confirmed' || paidOrder.paymentStatus !== 'paid') {
    throw new HttpError(409, 'This bank transfer booking was cancelled before payment could be recorded.');
  }
  return loadOrder(publicId);
};

export const resendBankTransferInstructions = async (
  publicIdInput: unknown,
  actorId: number,
  allowedProductTypeIds: number[] | null,
) => {
  const publicId = parseUuid(publicIdInput, 'Bank transfer order ID');
  const order = await loadOrder(publicId);
  await assertProductScope((order.items || []).map((item) => item.productId), allowedProductTypeIds);
  if (order.status !== 'pending_payment' || order.paymentStatus !== 'unpaid') {
    throw new HttpError(409, 'Bank transfer instructions cannot be sent for this order state.');
  }
  const account = getStorefrontBankTransferAccount(order.currency);
  const sent = await deliverStorefrontBankTransferInstructionsEmail(publicId, account, { force: true });
  if (!sent) {
    throw new HttpError(409, 'This bank transfer order is no longer awaiting payment.');
  }
  await AuditLog.create({
    actorId,
    action: 'storefront.bank_transfer_instructions_resent',
    entity: 'storefront_order',
    entityId: String(order.id),
    metaJson: { publicId, customerEmail: order.customerEmail },
  });
  return loadOrder(publicId);
};

export const retryBankTransferConfirmation = async (
  publicIdInput: unknown,
  actorId: number,
  allowedProductTypeIds: number[] | null,
) => {
  const publicId = parseUuid(publicIdInput, 'Bank transfer order ID');
  const order = await loadOrder(publicId);
  await assertProductScope((order.items || []).map((item) => item.productId), allowedProductTypeIds);
  if (order.status !== 'confirmed' || order.paymentStatus !== 'paid') {
    throw new HttpError(409, 'Payment must be received before sending the final confirmation.');
  }
  await deliverStorefrontOrderEmails(publicId);
  await AuditLog.create({
    actorId,
    action: 'storefront.bank_transfer_confirmation_retried',
    entity: 'storefront_order',
    entityId: String(order.id),
    metaJson: { publicId, customerEmail: order.customerEmail },
  });
  return loadOrder(publicId);
};

type LockedCancellationOptions = {
  actorId: number | null;
  action: string;
  source: string;
  reason: string;
  note?: string | null;
  now: Date;
};

const transitionLockedBankTransferOrderToCancelled = async (
  order: StorefrontOrder,
  transaction: Transaction,
  options: LockedCancellationOptions,
): Promise<boolean> => {
  const decision = resolveBankTransferCancellation(order);
  if (decision === 'already_cancelled') return false;
  if (decision !== 'cancel') {
    throw new HttpError(409, 'Only an unpaid reservation awaiting bank transfer can be cancelled here.');
  }

  const bookings = await Booking.findAll({
    where: { platform: 'omnilodge', platformOrderId: order.publicId },
    order: [['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  for (const booking of bookings) {
    await booking.update({
      status: 'cancelled',
      paymentStatus: 'unpaid',
      cancelledAt: options.now,
      statusChangedAt: options.now,
      updatedBy: options.actorId,
    }, { transaction });
  }
  await order.update({
    status: 'cancelled',
    paymentStatus: 'unpaid',
    metadata: {
      ...(order.metadata || {}),
      bankTransferCancellationReason: options.reason,
      bankTransferCancelledAt: options.now.toISOString(),
    },
  }, { transaction });
  const releasedResourceReservations = await releaseStorefrontOrderResourceReservations(
    Number(order.id),
    transaction,
    options.now,
  );

  await AuditLog.create({
    actorId: options.actorId,
    action: options.action,
    entity: 'storefront_order',
    entityId: String(order.id),
    metaJson: {
      publicId: order.publicId,
      paymentReference: order.paymentReference,
      reason: options.reason,
      bookingIds: bookings.map((booking) => Number(booking.id)),
      releasedResourceReservations,
      ...(options.note ? { note: options.note } : {}),
    },
  }, { transaction });
  if (bookings.length > 0) {
    await BookingEvent.bulkCreate(bookings.map((booking) => ({
      bookingId: booking.id,
      emailId: null,
      eventType: 'cancelled',
      platform: 'omnilodge',
      statusAfter: 'cancelled',
      eventPayload: {
        source: options.source,
        reason: options.reason,
        ...(options.actorId != null ? { actorId: options.actorId } : {}),
        orderPublicId: order.publicId,
        paymentReference: order.paymentReference,
        releasedResourceReservations,
        ...(options.note ? { note: options.note } : {}),
      },
      occurredAt: options.now,
      processedAt: options.now,
    })) as never[], { transaction });
  }
  return true;
};

export const cancelBankTransferOrder = async (input: CancelBankTransferOrderInput) => {
  const publicId = parseUuid(input.publicId, 'Bank transfer order ID');
  const initialOrder = await loadOrder(publicId);
  await assertProductScope(
    (initialOrder.items || []).map((item) => item.productId),
    input.allowedProductTypeIds,
  );
  const note = clean(input.note, 2000) || null;

  const cancelled = await sequelize.transaction(async (transaction): Promise<boolean> => {
    const order = await lockBankTransferOrderForUpdate(publicId, transaction);
    await assertProductScope(
      (order.items || []).map((item) => item.productId),
      input.allowedProductTypeIds,
      transaction,
    );
    return transitionLockedBankTransferOrderToCancelled(order, transaction, {
      actorId: input.actorId,
      action: 'storefront.bank_transfer_order_cancelled',
      source: 'backoffice_bank_transfer_cancellation',
      reason: 'cancelled_by_staff',
      note,
      now: new Date(),
    });
  });

  let emailError: string | null = null;
  try {
    await deliverStorefrontBankTransferCancellationEmail(publicId);
  } catch (error) {
    emailError = 'The reservation was cancelled, but the customer cancellation email could not be sent.';
    logger.error(
      `[storefront-email] Bank-transfer cancellation delivery failed for ${publicId}: ${(error as Error).message}`,
    );
  }
  return { order: await loadOrder(publicId), cancelled, emailError };
};

export const expireOverdueBankTransferOrders = async (
  options: { now?: Date; limit?: number } = {},
) => {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 100)));
  const candidates = await StorefrontOrder.findAll({
    where: {
      orderSource: 'backoffice',
      paymentMethod: 'bank_transfer',
      status: 'pending_payment',
      paymentStatus: 'unpaid',
      paymentDueAt: { [Op.lte]: now },
    },
    attributes: ['publicId'],
    order: [['paymentDueAt', 'ASC'], ['id', 'ASC']],
    limit,
  });
  const expiredPublicIds: string[] = [];
  const failedPublicIds: string[] = [];

  for (const candidate of candidates) {
    try {
      const expired = await sequelize.transaction(async (transaction): Promise<boolean> => {
        const order = await lockBankTransferOrderForUpdate(candidate.publicId, transaction);
        if (order.status !== 'pending_payment' || order.paymentStatus !== 'unpaid') return false;
        if (!order.paymentDueAt || order.paymentDueAt.getTime() > now.getTime()) return false;
        return transitionLockedBankTransferOrderToCancelled(order, transaction, {
          actorId: null,
          action: 'storefront.bank_transfer_order_expired',
          source: 'bank_transfer_payment_deadline',
          reason: 'payment_deadline_expired',
          now,
        });
      });
      if (!expired) continue;
      expiredPublicIds.push(candidate.publicId);
      try {
        await deliverStorefrontBankTransferCancellationEmail(candidate.publicId);
      } catch (error) {
        logger.error(
          `[storefront-email] Expired bank-transfer cancellation delivery failed for ${candidate.publicId}: ${(error as Error).message}`,
        );
      }
    } catch (error) {
      failedPublicIds.push(candidate.publicId);
      logger.error(
        `[storefront-bank-transfer] Failed to expire ${candidate.publicId}: ${(error as Error).message}`,
      );
    }
  }

  return {
    examined: candidates.length,
    expired: expiredPublicIds.length,
    expiredPublicIds,
    failedPublicIds,
  };
};

export const resendBankTransferCancellation = async (
  publicIdInput: unknown,
  actorId: number,
  allowedProductTypeIds: number[] | null,
) => {
  const publicId = parseUuid(publicIdInput, 'Bank transfer order ID');
  const order = await loadOrder(publicId);
  await assertProductScope((order.items || []).map((item) => item.productId), allowedProductTypeIds);
  if (order.status !== 'cancelled' || order.paymentStatus !== 'unpaid') {
    throw new HttpError(409, 'A cancellation email is only available for a cancelled unpaid reservation.');
  }
  const sent = await deliverStorefrontBankTransferCancellationEmail(publicId, { force: true });
  if (!sent) throw new HttpError(409, 'This bank transfer cancellation is no longer eligible for email delivery.');
  await AuditLog.create({
    actorId,
    action: 'storefront.bank_transfer_cancellation_resent',
    entity: 'storefront_order',
    entityId: String(order.id),
    metaJson: { publicId, customerEmail: order.customerEmail },
  });
  return loadOrder(publicId);
};

export const lockBankTransferOrderForUpdate = async (
  publicId: string,
  transaction: Transaction,
): Promise<StorefrontOrder> => {
  const order = await findLockedStorefrontOrderWithItems(publicId, transaction);
  if (!order || order.orderSource !== 'backoffice' || order.paymentMethod !== 'bank_transfer') {
    throw new HttpError(404, 'Bank transfer order not found.');
  }
  return order;
};
