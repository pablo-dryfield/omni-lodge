import type { Transaction } from 'sequelize';
import HttpError from '../errors/HttpError.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import { getStorefrontStripeClient, isStorefrontStripeConfigured } from '../finance/services/stripeClient.js';

/** A cart save must not revise or supersede a draft whose payment is being confirmed. */
export const assertCartPaymentsEditable = async (
  carts: readonly { orderId?: number | null }[], transaction: Transaction,
): Promise<void> => {
  for (const orderId of new Set(carts.map(cart => cart.orderId).filter((id): id is number => Boolean(id)))) {
    const order = await StorefrontOrder.findByPk(orderId, { transaction });
    if (!order) continue;
    const blocked = () => new HttpError(409, 'Payment has already been submitted and is being confirmed. Please wait before changing this booking.');
    if (order.paymentStatus === 'paid' || order.status === 'confirmed') throw blocked();
    if (!isStorefrontStripeConfigured()) continue;
    const stripe = getStorefrontStripeClient();
    if (order.stripePaymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId);
      if (['processing', 'requires_capture', 'requires_action', 'succeeded'].includes(intent.status)) throw blocked();
    } else if (order.stripeCheckoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
      if (session.status === 'complete') throw blocked();
    }
  }
};
