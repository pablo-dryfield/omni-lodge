import { Op } from 'sequelize';

import StorefrontOngoingCart from '../models/StorefrontOngoingCart.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import {
  getOngoingCartJourney,
  type StorefrontJourneyTimelineVisit,
} from './storefrontJourneyService.js';

type BookingStorefrontReference = {
  platform: string | null;
  platformOrderId: string | null;
};

export type BookingStorefrontActivity = {
  order: {
    publicId: string;
    status: string;
    paymentStatus: string;
    paidAt: Date | null;
  } | null;
  cart: {
    publicId: string;
    status: string;
    total: number;
    currency: string;
    openedAt: Date | null;
    checkoutStartedAt: Date | null;
    recoverySentAt: Date | null;
    recoveryOpenedAt: Date | null;
    recoveredAt: Date | null;
    convertedAt: Date | null;
  } | null;
  visits: StorefrontJourneyTimelineVisit[];
};

export const getBookingStorefrontActivity = async (
  booking: BookingStorefrontReference,
): Promise<BookingStorefrontActivity | null> => {
  if (String(booking.platform ?? '').trim().toLowerCase() !== 'omnilodge') return null;
  const orderPublicId = String(booking.platformOrderId ?? '').trim();
  if (!orderPublicId) return { order: null, cart: null, visits: [] };

  const order = await StorefrontOrder.findOne({ where: { publicId: orderPublicId } });
  if (!order) return { order: null, cart: null, visits: [] };

  const metadataCartId = typeof order.metadata?.ongoingCartPublicId === 'string'
    ? order.metadata.ongoingCartPublicId.trim()
    : '';
  const cart = await StorefrontOngoingCart.findOne({
    where: {
      [Op.or]: [
        { orderId: order.id },
        ...(metadataCartId ? [{ publicId: metadataCartId }] : []),
      ],
    },
    order: [['convertedAt', 'DESC NULLS LAST'], ['createdAt', 'DESC']],
  });

  return {
    order: {
      publicId: order.publicId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paidAt: order.paidAt,
    },
    cart: cart ? {
      publicId: cart.publicId,
      status: cart.status,
      total: Number(cart.total),
      currency: cart.currency,
      openedAt: cart.openedAt,
      checkoutStartedAt: cart.checkoutStartedAt,
      recoverySentAt: cart.recoverySentAt,
      recoveryOpenedAt: cart.recoveryOpenedAt,
      recoveredAt: cart.recoveredAt,
      convertedAt: cart.convertedAt,
    } : null,
    visits: cart ? await getOngoingCartJourney(cart.id) : [],
  };
};
