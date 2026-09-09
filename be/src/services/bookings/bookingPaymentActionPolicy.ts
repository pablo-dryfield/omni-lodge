import HttpError from '../../errors/HttpError.js';

export type BookingPaymentActionSnapshot = {
  paymentMethod?: string | null;
  paymentStatus?: string | null;
};

const normalizedPaymentValue = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/**
 * Stripe refund endpoints are intentionally unavailable for explicitly unpaid
 * or bank-transfer bookings. These checks belong on the server even when the
 * corresponding UI action is hidden.
 */
export const assertStripeRefundEligiblePayment = (
  payment: BookingPaymentActionSnapshot,
): void => {
  if (normalizedPaymentValue(payment.paymentMethod) === 'bank_transfer') {
    throw new HttpError(409, 'Bank-transfer bookings cannot use Stripe refund actions.');
  }
  if (normalizedPaymentValue(payment.paymentStatus) === 'unpaid') {
    throw new HttpError(409, 'Unpaid bookings cannot be refunded.');
  }
};

/**
 * Storefront confirmations represent a completed purchase, so both the order
 * and its projected booking must explicitly agree that payment was received.
 */
export const assertStorefrontConfirmationEligiblePayment = (
  payment: BookingPaymentActionSnapshot,
): void => {
  if (normalizedPaymentValue(payment.paymentStatus) !== 'paid') {
    throw new HttpError(409, 'Storefront confirmation emails can only be sent after payment is received.');
  }
};
