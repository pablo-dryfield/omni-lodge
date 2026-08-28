import type { NextFunction, Request, Response } from 'express';
import Stripe from 'stripe';
import {
  getStorefrontStripeClient,
  storefrontStripeWebhookConfigKey,
} from '../finance/services/stripeClient.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import { getConfigValueRaw } from '../services/configService.js';
import { recordOngoingCartEventByIdentity } from '../services/storefrontOngoingCartService.js';
import logger from '../utils/logger.js';
import { fulfillPaidOrder } from './storefrontCommerceController.js';

const webhookSecret = (): string | null => {
  const configKey = storefrontStripeWebhookConfigKey();
  const environmentSecret = configKey === 'STOREFRONT_STRIPE_TEST_WEBHOOK_SECRET'
    ? process.env.STOREFRONT_STRIPE_TEST_WEBHOOK_SECRET?.trim()
      || process.env.STRIPE_TEST_WEBHOOK_SECRET?.trim()
    : process.env.STOREFRONT_STRIPE_WEBHOOK_SECRET?.trim()
      || process.env.STRIPE_WEBHOOK_SECRET?.trim();

  return getConfigValueRaw(configKey)?.trim() || environmentSecret || null;
};

const ongoingCartIdentity = async (
  metadata: Stripe.Metadata | null,
): Promise<{ publicId?: string }> => {
  const directId = metadata?.ongoingCartPublicId?.trim();
  if (directId) return { publicId: directId };
  const orderPublicId = metadata?.orderPublicId?.trim();
  if (!orderPublicId) return {};
  const order = await StorefrontOrder.findOne({ where: { publicId: orderPublicId } });
  const ongoingId = typeof order?.metadata?.ongoingCartPublicId === 'string'
    ? order.metadata.ongoingCartPublicId
    : '';
  return ongoingId ? { publicId: ongoingId } : {};
};

const recordSessionFailure = async (
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<void> => {
  if (session.metadata?.ktkReplaced === 'true') return;
  const expired = event.type === 'checkout.session.expired';
  await recordOngoingCartEventByIdentity(
    await ongoingCartIdentity(session.metadata),
    {
      type: expired ? 'checkout_expired' : 'async_payment_failed',
      severity: expired ? 'warning' : 'error',
      message: expired
        ? 'Stripe checkout expired before payment was completed.'
        : 'Stripe reported that the delayed payment failed.',
      details: {
        stripeEventId: event.id,
        checkoutSessionId: session.id,
        orderPublicId: session.metadata?.orderPublicId || null,
      },
      dedupeKey: `stripe:${event.id}`,
      source: 'stripe',
    },
    { resetRecoveryDue: !expired },
  );
};

const recordPaymentIntentFailure = async (
  event: Stripe.Event,
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> => {
  if (event.type === 'payment_intent.canceled' && paymentIntent.metadata?.ktkReplaced === 'true') return;
  const failed = event.type === 'payment_intent.payment_failed';
  const stripeError = paymentIntent.last_payment_error;
  await recordOngoingCartEventByIdentity(
    await ongoingCartIdentity(paymentIntent.metadata),
    {
      type: failed ? 'payment_failed' : 'payment_cancelled',
      severity: failed ? 'error' : 'warning',
      message: failed
        ? stripeError?.message || 'Stripe could not complete the payment.'
        : 'Stripe cancelled the payment attempt.',
      details: {
        stripeEventId: event.id,
        paymentIntentId: paymentIntent.id,
        orderPublicId: paymentIntent.metadata?.orderPublicId || null,
        ...(failed && stripeError?.type ? { errorType: stripeError.type } : {}),
        ...(failed && stripeError?.code ? { code: stripeError.code } : {}),
        ...(failed && stripeError?.decline_code ? { declineCode: stripeError.decline_code } : {}),
        ...(!failed && paymentIntent.cancellation_reason
          ? { cancellationReason: paymentIntent.cancellation_reason }
          : {}),
      },
      dedupeKey: `stripe:${event.id}`,
      source: 'stripe',
    },
    { resetRecoveryDue: true },
  );
};

const recordPaymentIntentStatus = async (
  event: Stripe.Event,
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> => {
  const definitions = {
    'payment_intent.requires_action': {
      type: 'payment_authentication_required',
      severity: 'warning' as const,
      message: 'Stripe requested customer authentication before completing payment.',
    },
    'payment_intent.processing': {
      type: 'payment_processing',
      severity: 'info' as const,
      message: 'Stripe is processing the payment.',
    },
    'payment_intent.succeeded': {
      type: 'payment_succeeded',
      severity: 'info' as const,
      message: 'Stripe confirmed the payment.',
    },
  } as const;
  const definition = definitions[event.type as keyof typeof definitions];
  if (!definition) return;
  await recordOngoingCartEventByIdentity(
    await ongoingCartIdentity(paymentIntent.metadata),
    {
      ...definition,
      details: {
        stripeEventId: event.id,
        paymentIntentId: paymentIntent.id,
        orderPublicId: paymentIntent.metadata?.orderPublicId || null,
        status: paymentIntent.status,
      },
      dedupeKey: `stripe:${event.id}`,
      source: 'stripe',
    },
    { resetRecoveryDue: false },
  );
};

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

    const event = getStorefrontStripeClient().webhooks.constructEvent(request.body, signature, secret);
    if (
      event.type === 'checkout.session.completed'
      || event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      const publicId = session.metadata?.orderPublicId;
      if (session.payment_status === 'paid' && publicId) {
        logger.info(
          `[storefront-webhook] Processing event=${event.id} type=${event.type} order=${publicId} session=${session.id}`,
        );
        await fulfillPaidOrder(publicId, session);
      }
    } else if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const publicId = paymentIntent.metadata?.orderPublicId;
      if (publicId) {
        logger.info(
          `[storefront-webhook] Processing event=${event.id} type=${event.type} order=${publicId} payment=${paymentIntent.id}`,
        );
        await recordPaymentIntentStatus(event, paymentIntent);
        await fulfillPaidOrder(publicId, paymentIntent);
      }
    } else if (
      event.type === 'payment_intent.requires_action'
      || event.type === 'payment_intent.processing'
    ) {
      await recordPaymentIntentStatus(event, event.data.object as Stripe.PaymentIntent);
    } else if (
      event.type === 'checkout.session.async_payment_failed'
      || event.type === 'checkout.session.expired'
    ) {
      await recordSessionFailure(event, event.data.object as Stripe.Checkout.Session);
    } else if (
      event.type === 'payment_intent.payment_failed'
      || event.type === 'payment_intent.canceled'
    ) {
      await recordPaymentIntentFailure(event, event.data.object as Stripe.PaymentIntent);
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
