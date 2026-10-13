import {
  directStripeConfigKey,
  getDirectStripeClient,
  getStorefrontStripePublishableKey,
  normalizeDirectStripeMerchant,
  resolveDirectStripeMerchantAssignment,
  storefrontStripeConfigKey,
  storefrontStripePublishableConfigKey,
  storefrontStripeWebhookConfigKey,
} from '../stripeClient';
import { getConfigValueRaw } from '../../../services/configService';
import HttpError from '../../../errors/HttpError';

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

describe('direct Stripe merchant routing', () => {
  beforeEach(() => {
    mockedGetConfig.mockReset();
  });

  it.each([
    ['food-tour', 'live', 'FOOD_TOUR_STRIPE_SECRET_KEY'],
    ['food-tour', 'test', 'FOOD_TOUR_STRIPE_TEST_SECRET_KEY'],
    [null, 'live', 'STRIPE_SECRET_KEY'],
    [null, 'test', 'STRIPE_TEST_SECRET_KEY'],
  ] as const)('maps merchant %s in %s mode to %s', (merchant, mode, expected) => {
    expect(directStripeConfigKey(merchant, mode)).toBe(expected);
  });

  it('normalizes the supported marker', () => {
    expect(normalizeDirectStripeMerchant('  FOOD-TOUR ')).toBe('food-tour');
  });

  it.each([undefined, null, '', '   '])('normalizes legacy marker %p to null', (value) => {
    expect(normalizeDirectStripeMerchant(value)).toBeNull();
  });

  it('fails closed for an unknown non-empty merchant', () => {
    expect(() => directStripeConfigKey('other-business', 'live')).toThrow(HttpError);
    expect(mockedGetConfig).not.toHaveBeenCalled();
  });

  it('fails closed for a non-string merchant without reflecting the value', () => {
    expect(() => normalizeDirectStripeMerchant({ merchant: 'food-tour' })).toThrow(
      'Unsupported Stripe merchant.',
    );
  });

  it('preserves an assigned merchant when a replay omits the marker', () => {
    expect(resolveDirectStripeMerchantAssignment(true, 'food-tour', null)).toBe('food-tour');
  });

  it('preserves an assigned merchant when a replay repeats it', () => {
    expect(resolveDirectStripeMerchantAssignment(true, 'food-tour', 'food-tour')).toBe('food-tour');
  });

  it('assigns the supported merchant when a booking is first created', () => {
    expect(resolveDirectStripeMerchantAssignment(false, null, 'food-tour')).toBe('food-tour');
  });

  it('does not attach a new merchant to an unmarked legacy booking during replay', () => {
    expect(resolveDirectStripeMerchantAssignment(true, null, 'food-tour')).toBeNull();
  });

  it('does not fall back to the global key when Food Tour credentials are missing', () => {
    mockedGetConfig.mockImplementation((key: string) => (key === 'STRIPE_SECRET_KEY' ? 'global-live-key' : null));

    expect(() => getDirectStripeClient('food-tour', 'live')).toThrow(
      'FOOD_TOUR_STRIPE_SECRET_KEY is not configured.',
    );
    expect(mockedGetConfig).toHaveBeenCalledTimes(1);
    expect(mockedGetConfig).toHaveBeenCalledWith('FOOD_TOUR_STRIPE_SECRET_KEY');
  });
});
