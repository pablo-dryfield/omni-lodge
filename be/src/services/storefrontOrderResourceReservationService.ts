import { Op, type Transaction } from 'sequelize';

import HttpError from '../errors/HttpError.js';
import AddonInventoryMapping from '../models/AddonInventoryMapping.js';
import Booking from '../models/Booking.js';
import Counter from '../models/Counter.js';
import InventoryItem from '../models/InventoryItem.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import StorefrontOrderItem from '../models/StorefrontOrderItem.js';
import StorefrontOrderResourceReservation from '../models/StorefrontOrderResourceReservation.js';
import StorefrontPromotion from '../models/StorefrontPromotion.js';
import { getAvailableStock } from './inventoryService.js';
import { getStorefrontExperienceStartAt } from './storefrontBookingProjectionService.js';
import { getActivePromotionReservationCounts } from './storefrontResourceReservationAvailabilityService.js';
import {
  allocateInventoryReservationDemands,
  canAcquireLimitedPromotion,
  resolveInventoryReservationCommitExpiry,
  resolveInventoryReservationCommitExpiryForSchedule,
  type InventoryReservationDemand,
  type InventoryReservationMapping,
} from './storefrontResourceReservationPolicy.js';

type CartLike = {
  items?: Array<{
    addons?: Array<{ addonId?: unknown }>;
  }>;
  discountCode?: unknown;
  discountCodes?: unknown;
};

type ReservableQuote = {
  discounts: Array<{ promotionId: number; code: string }>;
  items: Array<{
    experienceDate: string | null;
    experienceTime: string | null;
    addons: Array<{
      addonId: number;
      name: string;
      quantity: number;
      variants: Array<{ value: string; quantity: number }>;
    }>;
  }>;
};

type ReservableOrderItem = {
  id: number;
};

export type StorefrontReservationConsumption = {
  inventoryReservationCount: number;
  consumedPromotionIds: number[];
};

type ReservableOrder = {
  id: number;
  paymentMethod: string;
  paymentStatus: string;
  paymentDueAt: Date | null;
};

type ScheduledOrderItem = {
  id: number;
  productId: number;
  experienceDate: string | null;
  experienceTime: string | null;
  addons: Array<Record<string, unknown>>;
};

export type CounterInventoryReservationSettlement = {
  reservationIds: number[];
};

const normalizePromotionCodes = (cart: CartLike): string[] => {
  const multiple = Array.isArray(cart.discountCodes) ? cart.discountCodes : [];
  return [...new Set([...multiple, cart.discountCode]
    .map((value) => String(value ?? '').trim().toUpperCase())
    .filter(Boolean))];
};

const addonIdsFromCart = (cart: CartLike): number[] => [...new Set(
  (Array.isArray(cart.items) ? cart.items : [])
    .flatMap((item) => Array.isArray(item?.addons) ? item.addons : [])
    .map((addon) => Number(addon?.addonId))
    .filter((addonId) => Number.isInteger(addonId) && addonId > 0),
)];

const lockInventoryItems = async (
  inventoryItemIds: number[],
  transaction: Transaction,
): Promise<InventoryItem[]> => {
  if (inventoryItemIds.length === 0) return [];
  return InventoryItem.findAll({
    where: { id: { [Op.in]: [...new Set(inventoryItemIds)].sort((left, right) => left - right) } },
    attributes: ['id', 'isActive'],
    order: [['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
};

const lockPromotions = async (
  promotionIds: number[],
  transaction: Transaction,
): Promise<StorefrontPromotion[]> => {
  if (promotionIds.length === 0) return [];
  return StorefrontPromotion.findAll({
    where: { id: { [Op.in]: [...new Set(promotionIds)].sort((left, right) => left - right) } },
    order: [['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
};

/** All payment paths increment promotions under the same deterministic locks. */
export const incrementStorefrontPromotionRedemptions = async (
  promotionIds: number[],
  transaction: Transaction,
): Promise<void> => {
  const promotions = await lockPromotions(promotionIds, transaction);
  for (const promotion of promotions) {
    await promotion.increment('redemptionCount', { by: 1, transaction });
  }
};

/**
 * Locks every inventory/promotion row a bank-transfer cart can reserve. All
 * callers use inventory first and promotions second to avoid lock-order
 * inversions between concurrent order creates and payment confirmations.
 */
export const lockStorefrontCartReservationResources = async (
  cartInput: unknown,
  transaction: Transaction,
): Promise<void> => {
  const cart = cartInput && typeof cartInput === 'object' && !Array.isArray(cartInput)
    ? cartInput as CartLike
    : {};
  const addonIds = addonIdsFromCart(cart);
  const mappings = addonIds.length > 0
    ? await AddonInventoryMapping.findAll({
        where: { addonId: { [Op.in]: addonIds }, isActive: true },
        attributes: ['inventoryItemId'],
        order: [['inventoryItemId', 'ASC'], ['id', 'ASC']],
        transaction,
      })
    : [];
  await lockInventoryItems(mappings.map((mapping) => Number(mapping.inventoryItemId)), transaction);

  const codes = normalizePromotionCodes(cart);
  if (codes.length === 0) return;
  const promotions = await StorefrontPromotion.findAll({
    where: { code: { [Op.in]: codes } },
    attributes: ['id'],
    order: [['id', 'ASC']],
    transaction,
  });
  await lockPromotions(promotions.map((promotion) => Number(promotion.id)), transaction);
};

const buildInventoryDemands = (
  quote: ReservableQuote,
  paymentDueAt: Date,
  mappedAddonIds: ReadonlySet<number>,
  orderItems: ReservableOrderItem[],
): InventoryReservationDemand[] => {
  const byKey = new Map<string, InventoryReservationDemand>();
  for (const [itemIndex, item] of quote.items.entries()) {
    const orderItemId = Number(orderItems[itemIndex]?.id);
    if (!Number.isInteger(orderItemId) || orderItemId <= 0) continue;
    const experienceStartsAt = getStorefrontExperienceStartAt(
      item.experienceDate,
      item.experienceTime || (item.experienceDate ? '23:59' : null),
    );
    const commitExpiresAt = resolveInventoryReservationCommitExpiry(paymentDueAt, experienceStartsAt);
    for (const addon of item.addons) {
      if (!mappedAddonIds.has(addon.addonId)) continue;
      const selections = addon.variants.length > 0
        ? addon.variants.map((variant) => ({
            variant: String(variant.value ?? '').trim().toUpperCase() || null,
            quantity: Number(variant.quantity),
          }))
        : [{ variant: null, quantity: Number(addon.quantity) }];
      for (const selection of selections) {
        if (!Number.isInteger(selection.quantity) || selection.quantity <= 0) continue;
        const key = `${orderItemId}:${addon.addonId}:${selection.variant ?? ''}`;
        const previous = byKey.get(key);
        byKey.set(key, {
          orderItemId,
          addonId: addon.addonId,
          variant: selection.variant,
          quantity: (previous?.quantity ?? 0) + selection.quantity,
          commitExpiresAt: previous && previous.commitExpiresAt > commitExpiresAt
            ? previous.commitExpiresAt
            : commitExpiresAt,
        });
      }
    }
  }
  return [...byKey.values()];
};

/**
 * Creates all holds for a newly-created order. The caller must have called
 * lockStorefrontCartReservationResources before quoting inside the same
 * transaction, so the availability checked here cannot be claimed by another
 * bank-transfer create concurrently.
 */
export const reserveStorefrontOrderResources = async (input: {
  orderId: number;
  orderItems: ReservableOrderItem[];
  quote: ReservableQuote;
  paymentDueAt: Date;
  transaction: Transaction;
}): Promise<void> => {
  const existing = await StorefrontOrderResourceReservation.count({
    where: { orderId: input.orderId },
    transaction: input.transaction,
  });
  if (existing > 0) return;
  if (
    input.orderItems.length !== input.quote.items.length
    || input.orderItems.some((item) => !Number.isInteger(Number(item.id)) || Number(item.id) <= 0)
  ) {
    throw new HttpError(409, 'The order items could not be matched to their inventory reservations.');
  }

  const addonIds = [...new Set(input.quote.items.flatMap((item) => item.addons.map((addon) => addon.addonId)))];
  const mappings = addonIds.length > 0
    ? await AddonInventoryMapping.findAll({
        where: { addonId: { [Op.in]: addonIds }, isActive: true },
        order: [['inventoryItemId', 'ASC'], ['id', 'ASC']],
        transaction: input.transaction,
      })
    : [];
  const lockedItems = await lockInventoryItems(
    mappings.map((mapping) => Number(mapping.inventoryItemId)),
    input.transaction,
  );
  const activeInventoryItemIds = new Set(
    lockedItems.filter((item) => item.isActive).map((item) => Number(item.id)),
  );
  const usableMappings: InventoryReservationMapping[] = mappings
    .filter((mapping) => activeInventoryItemIds.has(Number(mapping.inventoryItemId)))
    .map((mapping) => ({
      id: Number(mapping.id),
      addonId: Number(mapping.addonId),
      inventoryItemId: Number(mapping.inventoryItemId),
      variant: String(mapping.variant ?? '').trim().toUpperCase() || null,
      quantityPerAddon: Number(mapping.quantityPerAddon),
    }));
  const mappedAddonIds = new Set(usableMappings.map((mapping) => mapping.addonId));
  const inventoryItemIds = [...new Set(usableMappings.map((mapping) => mapping.inventoryItemId))];
  const availabilityEntries = await Promise.all(inventoryItemIds.map(async (inventoryItemId) => [
    inventoryItemId,
    await getAvailableStock(inventoryItemId, input.transaction),
  ] as const));
  const plan = allocateInventoryReservationDemands(
    buildInventoryDemands(input.quote, input.paymentDueAt, mappedAddonIds, input.orderItems),
    usableMappings,
    new Map(availabilityEntries),
  );
  if (plan.shortages.length > 0) {
    const shortage = plan.shortages[0];
    const addonName = input.quote.items
      .flatMap((item) => item.addons)
      .find((addon) => addon.addonId === shortage.addonId)?.name ?? `add-on #${shortage.addonId}`;
    throw new HttpError(
      409,
      `Not enough ${addonName}${shortage.variant ? ` (${shortage.variant})` : ''} inventory is available.`,
    );
  }

  const promotionIds = [...new Set(input.quote.discounts.map((discount) => Number(discount.promotionId)))];
  const promotions = await lockPromotions(promotionIds, input.transaction);
  const promotionsById = new Map(promotions.map((promotion) => [Number(promotion.id), promotion]));
  const activePromotionReservations = await getActivePromotionReservationCounts(
    promotionIds,
    input.transaction,
  );
  const limitedPromotions = input.quote.discounts
    .map((discount) => ({ discount, promotion: promotionsById.get(Number(discount.promotionId)) }))
    .filter((entry): entry is { discount: { promotionId: number; code: string }; promotion: StorefrontPromotion } => (
      Boolean(entry.promotion) && entry.promotion!.maxRedemptions !== null
    ));
  for (const { discount, promotion } of limitedPromotions) {
    if (!canAcquireLimitedPromotion({
      redemptionCount: Number(promotion.redemptionCount),
      maxRedemptions: promotion.maxRedemptions,
      activeReservationCount: activePromotionReservations.get(Number(promotion.id)) ?? 0,
    })) {
      throw new HttpError(409, `Discount code ${discount.code} has reached its redemption limit.`);
    }
  }

  const rows = [
    ...plan.allocations.map((allocation) => ({
      orderId: input.orderId,
      orderItemId: allocation.orderItemId,
      resourceType: 'inventory',
      reservationKey: `inventory:${allocation.orderItemId}:${allocation.inventoryItemId}:${allocation.addonId}:${allocation.variant ?? 'ALL'}`,
      inventoryItemId: allocation.inventoryItemId,
      promotionId: null,
      addonId: allocation.addonId,
      variant: allocation.variant,
      quantity: allocation.quantity,
      status: 'held',
      expiresAt: input.paymentDueAt,
      commitExpiresAt: allocation.commitExpiresAt,
      consumedAt: null,
      releasedAt: null,
    })),
    ...limitedPromotions.map(({ promotion }) => ({
      orderId: input.orderId,
      orderItemId: null,
      resourceType: 'promotion',
      reservationKey: `promotion:${promotion.id}`,
      inventoryItemId: null,
      promotionId: Number(promotion.id),
      addonId: null,
      variant: null,
      quantity: 1,
      status: 'held',
      expiresAt: input.paymentDueAt,
      commitExpiresAt: null,
      consumedAt: null,
      releasedAt: null,
    })),
  ];
  if (rows.length > 0) {
    await StorefrontOrderResourceReservation.bulkCreate(rows as never[], {
      transaction: input.transaction,
    });
  }
};

const reacquireInventoryReservation = async (
  reservation: StorefrontOrderResourceReservation,
  transaction: Transaction,
  activeInventoryItemIds: ReadonlySet<number>,
): Promise<void> => {
  const inventoryItemId = Number(reservation.inventoryItemId);
  if (!activeInventoryItemIds.has(inventoryItemId)) {
    throw new HttpError(
      409,
      'Reserved add-on inventory is no longer active. Adjust the booking before recording payment.',
    );
  }
  const available = await getAvailableStock(inventoryItemId, transaction);
  if (available + 0.0000001 < Number(reservation.quantity)) {
    throw new HttpError(
      409,
      'Reserved add-on inventory is no longer available. Adjust the booking before recording payment.',
    );
  }
};

const getFinalizedOrderItemIds = async (
  items: ScheduledOrderItem[],
  transaction: Transaction,
): Promise<Set<number>> => {
  const dates = [...new Set(items
    .map((item) => String(item.experienceDate ?? '').trim())
    .filter(Boolean))];
  if (dates.length === 0) return new Set();
  const counters = await Counter.findAll({
    where: { date: { [Op.in]: dates }, status: 'final' },
    attributes: ['date', 'productId'],
    transaction,
  });
  const finalizedPairs = new Set(counters
    .filter((counter) => counter.productId != null)
    .map((counter) => `${counter.date}:${Number(counter.productId)}`));
  const wildcardDates = new Set(counters
    .filter((counter) => counter.productId == null)
    .map((counter) => String(counter.date)));
  return new Set(items
    .filter((item) => Boolean(item.experienceDate) && (
      wildcardDates.has(String(item.experienceDate))
      || finalizedPairs.has(`${item.experienceDate}:${Number(item.productId)}`)
    ))
    .map((item) => Number(item.id)));
};

/**
 * Converts a bank-transfer order's holds on first payment. Inventory remains
 * an availability-only commitment until after the experience; no stock
 * movement or fulfillment work is created. Limited promotions become actual
 * redemptions here, exactly once in the same payment transaction.
 */
export const consumeStorefrontOrderResourceReservations = async (input: {
  orderId: number;
  promotionIds: number[];
  now: Date;
  transaction: Transaction;
}): Promise<StorefrontReservationConsumption> => {
  const reservations = await StorefrontOrderResourceReservation.findAll({
    where: { orderId: input.orderId },
    order: [['reservationKey', 'ASC']],
    transaction: input.transaction,
    lock: input.transaction.LOCK.UPDATE,
  });
  const inventoryReservations = reservations.filter((row) => row.resourceType === 'inventory');
  const promotionReservations = reservations.filter((row) => row.resourceType === 'promotion');
  const lockedInventoryItems = await lockInventoryItems(
    inventoryReservations.map((row) => Number(row.inventoryItemId)),
    input.transaction,
  );
  const activeInventoryItemIds = new Set(
    lockedInventoryItems.filter((item) => item.isActive).map((item) => Number(item.id)),
  );
  const reservationOrderItemIds = [...new Set(inventoryReservations
    .map((row) => Number(row.orderItemId))
    .filter((orderItemId) => Number.isInteger(orderItemId) && orderItemId > 0))];
  const scheduledOrderItems = reservationOrderItemIds.length > 0
    ? await StorefrontOrderItem.findAll({
        where: { id: { [Op.in]: reservationOrderItemIds }, orderId: input.orderId },
        attributes: ['id', 'productId', 'experienceDate', 'experienceTime', 'addons'],
        order: [['id', 'ASC']],
        transaction: input.transaction,
      }) as ScheduledOrderItem[]
    : [];
  const finalizedOrderItemIds = await getFinalizedOrderItemIds(
    scheduledOrderItems,
    input.transaction,
  );
  const promotions = await lockPromotions(input.promotionIds, input.transaction);
  const promotionsById = new Map(promotions.map((promotion) => [Number(promotion.id), promotion]));

  let inventoryReservationCount = 0;
  for (const reservation of inventoryReservations) {
    if (finalizedOrderItemIds.has(Number(reservation.orderItemId))) {
      await reservation.update({
        status: 'released',
        expiresAt: input.now,
        consumedAt: reservation.consumedAt || input.now,
        releasedAt: input.now,
      }, { transaction: input.transaction });
      inventoryReservationCount += 1;
      continue;
    }
    if (reservation.status === 'consumed') continue;
    const ownsActiveHold = reservation.status === 'held' && reservation.expiresAt > input.now;
    if (!ownsActiveHold) {
      await reacquireInventoryReservation(reservation, input.transaction, activeInventoryItemIds);
    }
    const committedUntil = reservation.commitExpiresAt && reservation.commitExpiresAt > input.now
      ? reservation.commitExpiresAt
      : input.now;
    await reservation.update({
      status: 'consumed',
      expiresAt: committedUntil,
      consumedAt: input.now,
      releasedAt: null,
    }, { transaction: input.transaction });
    inventoryReservationCount += 1;
  }

  const activePromotionCounts = await getActivePromotionReservationCounts(
    input.promotionIds,
    input.transaction,
    input.now,
  );
  const reservationByPromotionId = new Map(
    promotionReservations.map((reservation) => [Number(reservation.promotionId), reservation]),
  );
  const consumedPromotionIds: number[] = [];
  for (const promotionId of [...new Set(input.promotionIds)].sort((left, right) => left - right)) {
    const promotion = promotionsById.get(promotionId);
    const reservation = reservationByPromotionId.get(promotionId);
    if (!promotion) continue;
    if (promotion.maxRedemptions === null) {
      if (reservation && reservation.status !== 'consumed') {
        await reservation.update({
          status: 'consumed',
          expiresAt: input.now,
          consumedAt: input.now,
          releasedAt: null,
        }, { transaction: input.transaction });
      }
      // Unlimited promotions still use the controller's ordinary redemption
      // increment so reporting remains unchanged; only their obsolete hold is
      // cleared here.
      continue;
    }
    if (reservation?.status === 'consumed') {
      consumedPromotionIds.push(promotionId);
      continue;
    }
    const ownsActiveReservation = reservation?.status === 'held' && reservation.expiresAt > input.now;
    if (!canAcquireLimitedPromotion({
      redemptionCount: Number(promotion.redemptionCount),
      maxRedemptions: promotion.maxRedemptions,
      activeReservationCount: activePromotionCounts.get(promotionId) ?? 0,
      ownsActiveReservation,
    })) {
      throw new HttpError(
        409,
        `Discount code ${promotion.code} is no longer available. Adjust the booking before recording payment.`,
      );
    }
    await promotion.increment('redemptionCount', { by: 1, transaction: input.transaction });
    if (reservation) {
      await reservation.update({
        status: 'consumed',
        expiresAt: input.now,
        consumedAt: input.now,
        releasedAt: null,
      }, { transaction: input.transaction });
    } else {
      await StorefrontOrderResourceReservation.create({
        orderId: input.orderId,
        orderItemId: null,
        resourceType: 'promotion',
        reservationKey: `promotion:${promotionId}`,
        inventoryItemId: null,
        promotionId,
        addonId: null,
        variant: null,
        quantity: 1,
        status: 'consumed',
        expiresAt: input.now,
        commitExpiresAt: null,
        consumedAt: input.now,
        releasedAt: null,
      } as never, { transaction: input.transaction });
    }
    consumedPromotionIds.push(promotionId);
  }

  return { inventoryReservationCount, consumedPromotionIds };
};

/** Release pending holds inside the caller's order cancellation transaction. */
export const releaseStorefrontOrderResourceReservations = async (
  orderId: number,
  transaction: Transaction,
  now = new Date(),
): Promise<number> => {
  const [released] = await StorefrontOrderResourceReservation.update({
    status: 'released',
    releasedAt: now,
  }, {
    where: { orderId, status: 'held' },
    transaction,
  });
  return released;
};

/**
 * Locks all bank-transfer orders and item-level inventory commitments touched
 * by a counter before its Booking rows are finalized. This follows the same
 * order -> order item -> reservation sequence as payment and amendments.
 */
export const lockStorefrontInventoryReservationsForCounter = async (
  counter: Pick<Counter, 'date' | 'productId'>,
  transaction: Transaction,
): Promise<CounterInventoryReservationSettlement> => {
  // Counter reconciliation iterates every active mapping, including mappings
  // for which this counter ultimately writes a zero delta. Lock the complete
  // resource set so availability cannot observe a reservation release and its
  // replacement movement on different sides of its aggregate reads.
  const activeMappings = await AddonInventoryMapping.findAll({
    where: { isActive: true },
    attributes: ['inventoryItemId'],
    order: [['inventoryItemId', 'ASC'], ['id', 'ASC']],
    transaction,
  });
  const reconciliationInventoryItemIds = [...new Set(activeMappings
    .map((mapping) => Number(mapping.inventoryItemId))
    .filter((inventoryItemId) => Number.isInteger(inventoryItemId) && inventoryItemId > 0))]
    .sort((left, right) => left - right);

  const bookings = await Booking.findAll({
    where: {
      platform: 'omnilodge',
      experienceDate: counter.date,
      ...(counter.productId != null ? { productId: counter.productId } : {}),
      platformOrderId: { [Op.ne]: null },
    },
    attributes: ['platformOrderId'],
    transaction,
  });
  const publicIds = [...new Set(bookings
    .map((booking) => String(booking.platformOrderId ?? '').trim())
    .filter(Boolean))];
  let reservations: StorefrontOrderResourceReservation[] = [];
  if (publicIds.length > 0 && reconciliationInventoryItemIds.length > 0) {
    const orders = await StorefrontOrder.findAll({
      where: {
        publicId: { [Op.in]: publicIds },
        orderSource: 'backoffice',
        paymentMethod: 'bank_transfer',
      },
      attributes: ['id'],
      order: [['id', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const orderIds = orders.map((order) => Number(order.id));
    if (orderIds.length > 0) {
      const orderItems = await StorefrontOrderItem.findAll({
        where: {
          orderId: { [Op.in]: orderIds },
          experienceDate: counter.date,
          ...(counter.productId != null ? { productId: counter.productId } : {}),
        },
        attributes: ['id'],
        order: [['id', 'ASC']],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const orderItemIds = orderItems.map((item) => Number(item.id));
      if (orderItemIds.length > 0) {
        reservations = await StorefrontOrderResourceReservation.findAll({
          where: {
            orderItemId: { [Op.in]: orderItemIds },
            inventoryItemId: { [Op.in]: reconciliationInventoryItemIds },
            resourceType: 'inventory',
            status: 'consumed',
          },
          attributes: ['id', 'inventoryItemId'],
          order: [['reservationKey', 'ASC']],
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
      }
    }
  }
  // Retain these deterministic row locks until the caller has written all
  // counter movements and released the matching reservations.
  await lockInventoryItems(reconciliationInventoryItemIds, transaction);
  return { reservationIds: reservations.map((reservation) => Number(reservation.id)) };
};

/** Releases commitments only after the matching counter usage is reconciled. */
export const releaseReconciledStorefrontInventoryReservations = async (
  settlement: CounterInventoryReservationSettlement,
  transaction: Transaction,
  now = new Date(),
): Promise<number> => {
  if (settlement.reservationIds.length === 0) return 0;
  const [released] = await StorefrontOrderResourceReservation.update({
    status: 'released',
    expiresAt: now,
    releasedAt: now,
  }, {
    where: {
      id: { [Op.in]: settlement.reservationIds },
      resourceType: 'inventory',
      status: 'consumed',
    },
    transaction,
  });
  return released;
};

/**
 * Keeps paid inventory commitments aligned with Manifest date amendments.
 * Pending holds continue to expire at the unchanged payment deadline; only
 * their post-payment horizon is refreshed. Already-paid commitments move
 * their active expiry immediately.
 */
export const refreshStorefrontOrderInventoryReservationExpiries = async (
  order: ReservableOrder,
  transaction: Transaction,
): Promise<number> => {
  if (order.paymentMethod !== 'bank_transfer' || !order.paymentDueAt) return 0;

  const reservations = await StorefrontOrderResourceReservation.findAll({
    where: {
      orderId: order.id,
      resourceType: 'inventory',
      status: { [Op.in]: ['held', 'consumed', 'released'] },
    },
    order: [['reservationKey', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (reservations.length === 0) return 0;

  const lockedInventoryItems = await lockInventoryItems(
    reservations.map((row) => Number(row.inventoryItemId)),
    transaction,
  );
  const activeInventoryItemIds = new Set(
    lockedInventoryItems.filter((item) => item.isActive).map((item) => Number(item.id)),
  );

  const items = await StorefrontOrderItem.findAll({
    where: { orderId: order.id },
    attributes: ['id', 'productId', 'experienceDate', 'experienceTime', 'addons'],
    order: [['id', 'ASC']],
    transaction,
  });
  const itemById = new Map(items.map((item) => [Number(item.id), item]));
  const scheduleByItemId = new Map(items.map((item) => [Number(item.id), {
    experienceStartsAt: getStorefrontExperienceStartAt(
      item.experienceDate,
      item.experienceTime || (item.experienceDate ? '23:59' : null),
    ),
    addons: Array.isArray(item.addons) ? item.addons : [],
  }]));
  const finalizedOrderItemIds = await getFinalizedOrderItemIds(
    items as ScheduledOrderItem[],
    transaction,
  );
  const now = new Date();

  let updated = 0;
  for (const reservation of reservations) {
    const orderItemId = Number(reservation.orderItemId);
    const orderItem = itemById.get(orderItemId);
    if (!orderItem) continue;
    const itemSchedule = scheduleByItemId.get(orderItemId);
    if (!itemSchedule) continue;
    const commitExpiresAt = resolveInventoryReservationCommitExpiryForSchedule(
      order.paymentDueAt,
      Number(reservation.addonId),
      reservation.variant,
      [itemSchedule],
    );
    if (!commitExpiresAt) continue;
    const paidCommitment = order.paymentStatus === 'paid' || reservation.consumedAt != null;
    const finalized = finalizedOrderItemIds.has(orderItemId);
    const changes: {
      commitExpiresAt: Date;
      status?: 'consumed' | 'released';
      expiresAt?: Date;
      consumedAt?: Date;
      releasedAt?: Date | null;
    } = { commitExpiresAt };
    if (paidCommitment && finalized) {
      changes.status = 'released';
      changes.expiresAt = now;
      changes.consumedAt = reservation.consumedAt || now;
      changes.releasedAt = now;
    } else if (paidCommitment) {
      const ownsActiveCommitment = reservation.status === 'consumed' && reservation.expiresAt > now;
      if (!ownsActiveCommitment && commitExpiresAt > now) {
        await reacquireInventoryReservation(reservation, transaction, activeInventoryItemIds);
      }
      changes.status = commitExpiresAt > now ? 'consumed' : 'released';
      changes.expiresAt = commitExpiresAt;
      changes.consumedAt = reservation.consumedAt || now;
      changes.releasedAt = commitExpiresAt > now ? null : now;
    }
    if (
      reservation.commitExpiresAt?.getTime() === commitExpiresAt.getTime()
      && (!changes.status || reservation.status === changes.status)
      && (!changes.expiresAt || reservation.expiresAt.getTime() === changes.expiresAt.getTime())
    ) {
      continue;
    }
    await reservation.update(changes, { transaction });
    updated += 1;
  }
  return updated;
};
