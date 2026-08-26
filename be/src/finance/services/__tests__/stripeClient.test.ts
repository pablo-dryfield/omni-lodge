import { storefrontStripeConfigKey, storefrontStripeWebhookConfigKey } from '../stripeClient';

jest.mock('../../../services/configService.js', () => ({ getConfigValueRaw: jest.fn() }));

describe('storefront Stripe environment selection', () => {
  it('uses the test key outside production', () => {
    expect(storefrontStripeConfigKey('development')).toBe('STRIPE_TEST_SECRET_KEY');
    expect(storefrontStripeConfigKey('test')).toBe('STRIPE_TEST_SECRET_KEY');
    expect(storefrontStripeConfigKey(undefined)).toBe('STRIPE_TEST_SECRET_KEY');
  });

  it('uses the live key only in production', () => {
    expect(storefrontStripeConfigKey('production')).toBe('STRIPE_SECRET_KEY');
  });

  it('uses the test webhook secret outside production', () => {
    expect(storefrontStripeWebhookConfigKey('development')).toBe('STOREFRONT_STRIPE_TEST_WEBHOOK_SECRET');
    expect(storefrontStripeWebhookConfigKey('test')).toBe('STOREFRONT_STRIPE_TEST_WEBHOOK_SECRET');
    expect(storefrontStripeWebhookConfigKey(undefined)).toBe('STOREFRONT_STRIPE_TEST_WEBHOOK_SECRET');
  });

  it('uses the live webhook secret only in production', () => {
    expect(storefrontStripeWebhookConfigKey('production')).toBe('STOREFRONT_STRIPE_WEBHOOK_SECRET');
  });
});
