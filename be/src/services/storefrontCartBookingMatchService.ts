import { Op, type Transaction } from 'sequelize';
import { randomUUID } from 'node:crypto';
import Booking from '../models/Booking.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import StorefrontOngoingCart from '../models/StorefrontOngoingCart.js';
import { resolveCartIdentity, sameCartExperiences } from './storefrontCartIdentity.js';
import { cartCustomerWhere } from './storefrontCartIdentityRepository.js';
import type { StorefrontCartInput } from './storefrontCommerceService.js';

type PaidMatch = { kind: 'order' | 'booking'; id: number };

export const findPaidCartMatch = async (cart: StorefrontOngoingCart, transaction?: Transaction): Promise<PaidMatch | null> => {
  if (!cart.cart.items?.length || !cart.createdAt) return null;
  // Use the current booking, not an old converted-cart snapshot: a booking may
  // subsequently have been cancelled, refunded or moved to a different date.
  const bookings = await Booking.findAll({
    where: {
      status: 'confirmed', paymentStatus: 'paid',
      productId: { [Op.in]: cart.cart.items.map(item => Number(item.productId)) },
      experienceDate: { [Op.in]: cart.cart.items.map(item => item.experienceDate).filter((date): date is string => Boolean(date)) },
      ...cartCustomerWhere(cart.customer, true),
    },
    attributes: ['id', 'platformOrderId', 'platform', 'guestEmail', 'guestPhone', 'guestFirstName', 'guestLastName', 'productId', 'experienceDate', 'experienceStartAt', 'partySizeTotal', 'createdAt'],
    transaction,
  });
  const publicIds = [...new Set(bookings.filter(booking => booking.platform === 'omnilodge')
    .map(booking => booking.platformOrderId).filter((id): id is string => Boolean(id)))];
  const orders = publicIds.length ? await StorefrontOrder.findAll({
    where: { publicId: { [Op.in]: publicIds }, status: 'confirmed', paymentStatus: 'paid', paidAt: { [Op.gte]: cart.createdAt } },
    attributes: ['id', 'publicId', 'customerCountryCode'], transaction,
  }) : [];
  const orderByPublicId = new Map(orders.map(order => [order.publicId, order]));
  const eligible = bookings.filter(booking => booking.platform === 'omnilodge'
    ? orderByPublicId.has(booking.platformOrderId ?? '')
    : new Date(booking.createdAt).getTime() >= new Date(cart.createdAt).getTime());
  const candidates = eligible.map(booking => ({ booking, customer: {
    email: booking.guestEmail, phone: booking.guestPhone,
    phoneCountry: booking.platform === 'omnilodge' ? orderByPublicId.get(booking.platformOrderId ?? '')?.customerCountryCode : undefined,
    fullName: [booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' '),
  } }));
  const bookingMatch = resolveCartIdentity(cart.customer, candidates);
  if (bookingMatch.kind !== 'matched') return null;
  const groups = new Map<string, typeof bookings>();
  for (const { booking } of bookingMatch.carts) {
    const key = `${booking.platform}:${booking.platformOrderId || `booking-${booking.id}`}`;
    groups.set(key, [...(groups.get(key) ?? []), booking]);
  }
  for (const group of groups.values()) {
    const paidCart: StorefrontCartInput = { items: group.map(booking => ({
      productId: Number(booking.productId), quantity: Number(booking.partySizeTotal),
      experienceDate: String(booking.experienceDate ?? '').slice(0, 10),
      experienceTime: booking.experienceStartAt ? new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Warsaw',
      }).format(new Date(booking.experienceStartAt)) : null,
    })) };
    if (sameCartExperiences(cart.cart, paidCart)) {
      const order = group[0].platform === 'omnilodge' ? orderByPublicId.get(group[0].platformOrderId ?? '') : null;
      return order ? { kind: 'order', id: Number(order.id) } : { kind: 'booking', id: Number(group[0].id) };
    }
  }
  return null;
};

export const dismissCartWithPaidMatch = async (cart: StorefrontOngoingCart, transaction?: Transaction): Promise<boolean> => {
  const match = await findPaidCartMatch(cart, transaction);
  if (!match) return false;
  const now = new Date();
  const events = Array.isArray(cart.metadata?.events) ? cart.metadata.events : [];
  const [changed] = await StorefrontOngoingCart.update({
    status: 'dismissed', dismissedAt: now,
    metadata: { ...cart.metadata, alreadyBooked: match, events: [...events, {
      id: randomUUID(), type: 'already_booked', severity: 'info',
      message: 'Removed from ongoing carts: matching paid booking found. No recovery sale was attributed.',
      details: match, occurredAt: now.toISOString(),
    }].slice(-50) },
  }, { where: { id: cart.id, status: { [Op.in]: ['active', 'checkout_started', 'recovery_sent', 'sending_recovery'] } }, transaction });
  return changed > 0;
};
