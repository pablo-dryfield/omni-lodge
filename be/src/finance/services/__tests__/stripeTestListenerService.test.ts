import { isStripeTestListenerAllowed, stripeTestListenerArgs } from '../stripeTestListenerService';

jest.mock('../../../services/configService.js', () => ({
  getConfigValueRaw: jest.fn(() => null),
  updateConfigValue: jest.fn(),
}));

describe('Stripe test listener safety', () => {
  it('is disabled in production', () => {
    expect(isStripeTestListenerAllowed('production')).toBe(false);
    expect(isStripeTestListenerAllowed('development')).toBe(true);
    expect(isStripeTestListenerAllowed('test')).toBe(true);
  });

  it('uses a fixed event allowlist and forwarding target', () => {
    expect(stripeTestListenerArgs('http://localhost:3001/api/storefront/webhooks/stripe')).toEqual([
      'listen',
      '--events',
      'checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled',
      '--forward-to',
      'http://localhost:3001/api/storefront/webhooks/stripe',
    ]);
  });
});
