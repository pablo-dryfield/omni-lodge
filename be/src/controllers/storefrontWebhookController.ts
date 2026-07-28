import type { NextFunction, Request, Response } from 'express';
import Stripe from 'stripe';
import { getStripeClient } from '../finance/services/stripeClient.js';
import { fulfillPaidOrder } from './storefrontCommerceController.js';

const webhookSecret = (): string | null =>
  process.env.STOREFRONT_STRIPE_WEBHOOK_SECRET
  || process.env.STRIPE_WEBHOOK_SECRET
  || null;

export const storefrontStripeWebhook = async (
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const secret = webhookSecret();
    if (!secret) {
      response.status(503).json({ message: 'The storefront Stripe webhook is not configured.' });
      return;
    }

    const signature = request.headers['stripe-signature'];
    if (typeof signature !== 'string' || !Buffer.isBuffer(request.body)) {
      response.status(400).json({ message: 'Invalid Stripe webhook request.' });
      return;
    }

    const event = getStripeClient().webhooks.constructEvent(request.body, signature, secret);
    if (
      event.type === 'checkout.session.completed'
      || event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      const publicId = session.metadata?.orderPublicId;
      if (session.payment_status === 'paid' && publicId) {
        await fulfillPaidOrder(publicId, session);
      }
    }

    response.json({ received: true });
  } catch (error) {
    if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
      response.status(400).json({ message: 'Invalid Stripe webhook signature.' });
      return;
    }
    next(error);
  }
};
