import HttpError from '../../../errors/HttpError';
import {
  assertStorefrontConfirmationEligiblePayment,
  assertStripeRefundEligiblePayment,
} from '../bookingPaymentActionPolicy';

describe('assertStripeRefundEligiblePayment', () => {
  it.each(['bank_transfer', 'Bank Transfer', 'bank-transfer'])(
    'blocks the %s payment-method spelling',
    (paymentMethod) => {
      expect(() => assertStripeRefundEligiblePayment({
        paymentMethod,
        paymentStatus: 'paid',
      })).toThrow(new HttpError(409, 'Bank-transfer bookings cannot use Stripe refund actions.'));
    },
  );

  it('blocks explicitly unpaid bookings regardless of a stale Stripe method', () => {
    expect(() => assertStripeRefundEligiblePayment({
      paymentMethod: 'stripe',
      paymentStatus: 'unpaid',
    })).toThrow(new HttpError(409, 'Unpaid bookings cannot be refunded.'));
  });

  it('keeps legacy and explicitly paid Stripe bookings eligible', () => {
    expect(() => assertStripeRefundEligiblePayment({})).not.toThrow();
    expect(() => assertStripeRefundEligiblePayment({
      paymentMethod: 'stripe',
      paymentStatus: 'paid',
    })).not.toThrow();
  });
});

describe('assertStorefrontConfirmationEligiblePayment', () => {
  it.each([undefined, null, '', 'unknown', 'unpaid', 'deposit', 'partial', 'refunded'])(
    'blocks a storefront confirmation with payment status %p',
    (paymentStatus) => {
      expect(() => assertStorefrontConfirmationEligiblePayment({ paymentStatus })).toThrow(
        new HttpError(409, 'Storefront confirmation emails can only be sent after payment is received.'),
      );
    },
  );

  it('allows only an explicitly paid storefront booking or order', () => {
    expect(() => assertStorefrontConfirmationEligiblePayment({ paymentStatus: 'paid' })).not.toThrow();
    expect(() => assertStorefrontConfirmationEligiblePayment({ paymentStatus: 'PAID' })).not.toThrow();
  });
});
