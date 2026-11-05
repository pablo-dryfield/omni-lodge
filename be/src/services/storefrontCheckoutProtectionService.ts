import { createHash } from 'node:crypto';
import type Stripe from 'stripe';
import HttpError from '../errors/HttpError.js';

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
};
export const checkoutSelectionFingerprint = (quote: unknown, customer: unknown): string =>
  createHash('sha256').update(JSON.stringify(canonical({ quote, customer }))).digest('hex');

/** Cancel an unsubmitted old attempt before changing its order snapshot. */
export const protectStorefrontPaymentSelection = async (
  stripe: Stripe, intent: Stripe.PaymentIntent, unchanged: boolean, amount: number, currency: string,
): Promise<'reuse' | 'replace'> => {
  if (['processing', 'requires_capture', 'requires_action', 'succeeded'].includes(intent.status)) {
    throw new HttpError(409, 'Payment has already been submitted and is being confirmed.');
  }
  if (intent.status === 'canceled') return 'replace';
  if (unchanged && intent.amount === amount && intent.currency === currency) return 'reuse';
  try {
    const cancelled = await stripe.paymentIntents.cancel(intent.id, { cancellation_reason: 'abandoned' });
    if (cancelled.status !== 'canceled') throw new Error('Payment was not cancelled.');
  } catch {
    // Payment may have moved into confirmation between retrieval and cancellation.
    // Keep the old order intact; let its webhook confirm its original selection.
    throw new HttpError(409, 'Payment is being confirmed. Please wait before changing this booking.');
  }
  return 'replace';
};
