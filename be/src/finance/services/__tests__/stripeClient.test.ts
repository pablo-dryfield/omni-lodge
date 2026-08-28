import {
  getStorefrontStripePublishableKey,
  storefrontStripeConfigKey,
  storefrontStripePublishableConfigKey,
  storefrontStripeWebhookConfigKey,
} from '../stripeClient';
import { getConfigValueRaw } from '../../../services/configService';

jest.mock('../../../services/configService.js', () => ({ getConfigValueRaw: jest.fn() }));

const mockedGetConfig = getConfigValueRaw as jest.MockedFunction<typeof getConfigValueRaw>;

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

  it('uses environment-matched publishable keys', () => {
    expect(storefrontStripePublishableConfigKey('development')).toBe('STRIPE_TEST_PUBLISHABLE_KEY');
    expect(storefrontStripePublishableConfigKey('test')).toBe('STRIPE_TEST_PUBLISHABLE_KEY');
    expect(storefrontStripePublishableConfigKey('production')).toBe('STRIPE_PUBLISHABLE_KEY');
  });

  it('rejects publishable keys configured for the wrong Stripe mode', () => {
    mockedGetConfig.mockReturnValue('pk_live_wrong_mode');
    expect(getStorefrontStripePublishableKey('development')).toBeNull();

    mockedGetConfig.mockReturnValue('pk_test_correct_mode');
    expect(getStorefrontStripePublishableKey('development')).toBe('pk_test_correct_mode');

    mockedGetConfig.mockReturnValue('pk_test_wrong_mode');
    expect(getStorefrontStripePublishableKey('production')).toBeNull();
  });
});
