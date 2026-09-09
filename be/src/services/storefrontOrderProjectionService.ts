import type { Transaction } from 'sequelize';
import Booking from '../models/Booking.js';
import BookingAddon from '../models/BookingAddon.js';
import Guest from '../models/Guest.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import StorefrontOrderItem from '../models/StorefrontOrderItem.js';
import {
  buildStorefrontAddonsSnapshot,
  getStorefrontExperienceStartAt,
  mergeStorefrontAddonsSnapshot,
} from './storefrontBookingProjectionService.js';

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export type StorefrontOrderProjectionOptions = {
  bookingStatus: 'pending' | 'confirmed';
  paymentStatus: 'unpaid' | 'paid';
  paymentMethod: string;
  actorId: number;
  now?: Date;
  stripePaymentIntentId?: string | null;
  /** Keep later manifest changes intact when fulfillment is only repairing a paid retry. */
  preserveExistingBookingState?: boolean;
};

export type StorefrontOrderProjectionResult = {
  guest: Guest;
  bookings: Booking[];
};

const appendNotes = (current: string | null, additions: Array<string | null>): string => {
  const notes = (current || '')
    .split(' | ')
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const addition of additions) {
    const normalized = String(addition ?? '').trim();
    if (normalized && !notes.includes(normalized)) notes.push(normalized);
  }
  return notes.join(' | ');
};

const resolveGuest = async (
  order: StorefrontOrder,
  existingBookings: Booking[],
  options: StorefrontOrderProjectionOptions,
  transaction: Transaction,
): Promise<Guest> => {
  const guestId = existingBookings.find((booking) => booking.guestId != null)?.guestId ?? null;
  const guest = guestId == null
    ? null
    : await Guest.findByPk(guestId, { transaction, lock: transaction.LOCK.UPDATE });

  if (guest && options.preserveExistingBookingState) return guest;

  const values = {
    name: `${order.customerFirstName} ${order.customerLastName}`.trim(),
    email: order.customerEmail,
    phoneNumber: order.customerPhone,
    paymentStatus: options.paymentStatus,
    deposit: options.paymentStatus === 'paid' ? Number(order.total) : 0,
    notes: `Storefront order ${order.publicId}`,
    updatedBy: options.actorId,
  };

  if (guest) {
    await guest.update(values, { transaction });
    return guest;
  }

  return Guest.create(
    {
      ...values,
      address: null,
      createdBy: options.actorId,
    } as never,
    { transaction },
  );
};

const syncBookingAddons = async (
  booking: Booking,
  item: StorefrontOrderItem,
  currency: string,
  source: string,
  transaction: Transaction,
): Promise<void> => {
  const addons = Array.isArray(item.addons) ? item.addons : [];
  const existing = await BookingAddon.findAll({
    where: { bookingId: booking.id },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const existingByPlatformId = new Map(
    existing
      .filter((row) => row.platformAddonId)
      .map((row) => [String(row.platformAddonId), row]),
  );

  for (const addon of addons) {
    const platformAddonId = String(addon.addonId || '');
    const values = {
      addonId: Number(addon.addonId) || null,
      platformAddonId,
      platformAddonName: String(addon.name || ''),
      quantity: Number(addon.quantity) || 1,
      unitPrice: String(addon.unitPrice || 0),
      totalPrice: String(addon.total || 0),
      currency,
      isIncluded: false,
      metadata: {
        source,
        variants: Array.isArray(addon.variants) ? addon.variants : [],
      },
    };
    const row = existingByPlatformId.get(platformAddonId);
    if (row) {
      await row.update(values, { transaction });
    } else {
      await BookingAddon.create({ bookingId: booking.id, ...values } as never, { transaction });
    }
  }
};

/**
 * Projects an order into the operational booking tables without changing its
 * identity. This is used both when a bank-transfer reservation is created and
 * when any storefront order becomes paid, so retries update the same rows.
 */
export const projectStorefrontOrderBookings = async (
  order: StorefrontOrder,
  options: StorefrontOrderProjectionOptions,
  transaction: Transaction,
): Promise<StorefrontOrderProjectionResult> => {
  const now = options.now ?? new Date();
  const existingBookings = await Booking.findAll({
    where: { platform: 'omnilodge', platformOrderId: order.publicId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const existingByPlatformId = new Map(
    existingBookings.map((booking) => [booking.platformBookingId, booking]),
  );
  const guest = await resolveGuest(order, existingBookings, options, transaction);
  const grossBeforeDiscount = Number(order.subtotal) + Number(order.addonTotal);
  const orderDiscount = Number(order.discountTotal);
  const projected: Booking[] = [];

  for (const item of order.items || []) {
    const platformBookingId = `${order.publicId}-${item.id}`;
    const current = existingByPlatformId.get(platformBookingId) ?? null;
    const itemGross = Number(item.total);
    const allocatedDiscount = grossBeforeDiscount > 0
      ? roundMoney(orderDiscount * (itemGross / grossBeforeDiscount))
      : 0;
    const itemNet = Math.max(0, roundMoney(itemGross - allocatedDiscount));
    const addons = Array.isArray(item.addons) ? item.addons : [];
    const notes = appendNotes(current?.notes ?? null, [
      `Storefront order ${order.publicId}`,
      options.stripePaymentIntentId ? `Stripe payment_intent: ${options.stripePaymentIntentId}` : null,
      `Payment method: ${options.paymentMethod}`,
      `Checkout source: ${order.orderSource || 'storefront'}`,
    ]);

    if (current && options.preserveExistingBookingState) {
      // A paid webhook or a manual receipt action may be retried long after a
      // booking was amended in Manifest. Repair only projection metadata that
      // is absent; never restore stale order values over a staff amendment.
      const repairedSnapshot = mergeStorefrontAddonsSnapshot(
        current.addonsSnapshot,
        addons,
        item.options,
        item.quantity,
      );
      const repairs: Record<string, unknown> = {};
      if (current.guestId == null) repairs.guestId = guest.id;
      if (!current.experienceStartAt) {
        const experienceStartAt = getStorefrontExperienceStartAt(item.experienceDate, item.experienceTime);
        if (experienceStartAt) repairs.experienceStartAt = experienceStartAt;
      }
      if (notes !== (current.notes || '')) repairs.notes = notes;
      if (JSON.stringify(repairedSnapshot) !== JSON.stringify(current.addonsSnapshot)) {
        repairs.addonsSnapshot = repairedSnapshot;
      }
      if (Object.keys(repairs).length > 0) {
        await current.update(repairs, { transaction });
      }
      projected.push(current);
      continue;
    }

    const settlementValues = current && options.preserveExistingBookingState
      ? {}
      : {
          status: options.bookingStatus,
          statusChangedAt: current?.status === options.bookingStatus
            ? current.statusChangedAt
            : now,
          paymentStatus: options.paymentStatus,
          paymentMethod: options.paymentMethod,
        };
    const commonValues = {
      guestId: guest.id,
      ...settlementValues,
      paymentMethodCountry: order.customerCountryCode,
      utmSource: order.attribution?.utm_source || null,
      utmMedium: order.attribution?.utm_medium || null,
      utmCampaign: order.attribution?.utm_campaign || null,
      experienceDate: item.experienceDate,
      experienceStartAt: getStorefrontExperienceStartAt(item.experienceDate, item.experienceTime),
      productId: item.productId,
      productName: item.productName,
      guestFirstName: order.customerFirstName,
      guestLastName: order.customerLastName,
      guestEmail: order.customerEmail,
      guestPhone: order.customerPhone,
      partySizeTotal: item.quantity,
      partySizeAdults: item.quantity,
      partySizeChildren: 0,
      currency: order.currency,
      baseAmount: itemNet,
      addonsAmount: Number(item.addonTotal),
      discountAmount: allocatedDiscount,
      discountCode: order.discountCode,
      priceGross: itemGross,
      priceNet: itemNet,
      commissionAmount: 0,
      commissionRate: 0,
      addonsSnapshot: current
        ? mergeStorefrontAddonsSnapshot(current.addonsSnapshot, addons, item.options, item.quantity)
        : buildStorefrontAddonsSnapshot(addons, item.options, item.quantity),
      notes,
      sourceReceivedAt: current?.sourceReceivedAt || order.createdAt || now,
      processedAt: now,
      updatedBy: options.actorId,
    };

    let booking = current;
    if (booking) {
      await booking.update(commonValues as never, { transaction });
    } else {
      booking = await Booking.create(
        {
          platform: 'omnilodge',
          platformBookingId,
          platformOrderId: order.publicId,
          ...commonValues,
          createdBy: options.actorId,
        } as never,
        { transaction },
      );
    }

    await syncBookingAddons(
      booking,
      item,
      order.currency,
      order.orderSource || 'storefront',
      transaction,
    );
    projected.push(booking);
  }

  return { guest, bookings: projected };
};
