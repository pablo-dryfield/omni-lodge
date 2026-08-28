import {
  isStripeTestListenerAllowed,
  stripeLoginCompletionArgs,
  stripeTestListenerArgs,
} from '../stripeTestListenerService';

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
      'checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,payment_intent.processing,payment_intent.requires_action',
      '--forward-to',
      'http://localhost:3001/api/storefront/webhooks/stripe',
    ]);
  });

  it('supports current and legacy Stripe CLI login completion formats', () => {
    expect(stripeLoginCompletionArgs({
      next_step: 'stripe login --complete-device',
    })).toEqual(['login', '--complete-device']);
    expect(stripeLoginCompletionArgs({
      next_step: "stripe login --complete 'https://dashboard.stripe.com/stripecli/auth/example'",
    })).toEqual([
      'login',
      '--complete',
      'https://dashboard.stripe.com/stripecli/auth/example',
    ]);
    expect(stripeLoginCompletionArgs({
      poll_url: 'https://dashboard.stripe.com/stripecli/auth/example',
    })).toEqual([
      'login',
      '--complete',
      'https://dashboard.stripe.com/stripecli/auth/example',
    ]);
  });
});
