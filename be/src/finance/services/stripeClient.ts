import Stripe from 'stripe';
import HttpError from '../../errors/HttpError.js';
import { getConfigValueRaw } from '../../services/configService.js';

const cachedClients = new Map<string, Stripe>();

export type StripeMode = 'live' | 'test';
export type DirectStripeMerchant = 'food-tour';

type StripeSecretConfigKey =
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_TEST_SECRET_KEY'
  | 'FOOD_TOUR_STRIPE_SECRET_KEY'
  | 'FOOD_TOUR_STRIPE_TEST_SECRET_KEY';

const getStripeClientForConfigKey = (configKey: StripeSecretConfigKey): Stripe => {
  const key = getConfigValueRaw(configKey);
  if (!key) {
    throw new HttpError(503, `${configKey} is not configured.`);
  }
  const cachedClient = cachedClients.get(key);
  if (cachedClient) {
    return cachedClient;
  }
  const client = new Stripe(key);
  cachedClients.set(key, client);
  return client;
};

export const getStripeClient = (): Stripe => getStripeClientForConfigKey('STRIPE_SECRET_KEY');

export const getStripeTestClient = (): Stripe => getStripeClientForConfigKey('STRIPE_TEST_SECRET_KEY');

export const normalizeDirectStripeMerchant = (value: unknown): DirectStripeMerchant | null => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Unsupported Stripe merchant.');
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'food-tour') {
    return normalized;
  }
  throw new HttpError(400, 'Unsupported Stripe merchant.');
};

export const resolveDirectStripeMerchantAssignment = (
  isPersistedBooking: boolean,
  currentValue: unknown,
  incomingValue: unknown,
): DirectStripeMerchant | null => {
  const current = normalizeDirectStripeMerchant(currentValue);
  const incoming = normalizeDirectStripeMerchant(incomingValue);
  if (current && incoming && current !== incoming) {
    throw new HttpError(409, 'stripeMerchant cannot be changed after it is assigned to a booking');
  }
  return isPersistedBooking ? current : incoming;
};

export const directStripeConfigKey = (
  merchant: unknown,
  mode: StripeMode,
): StripeSecretConfigKey => {
  if (normalizeDirectStripeMerchant(merchant) === 'food-tour') {
    return mode === 'live' ? 'FOOD_TOUR_STRIPE_SECRET_KEY' : 'FOOD_TOUR_STRIPE_TEST_SECRET_KEY';
  }
  return mode === 'live' ? 'STRIPE_SECRET_KEY' : 'STRIPE_TEST_SECRET_KEY';
};

export const getDirectStripeClient = (
  merchant: unknown,
  mode: StripeMode,
): Stripe => getStripeClientForConfigKey(directStripeConfigKey(merchant, mode));

export const isStripeConfigured = (): boolean => Boolean(getConfigValueRaw('STRIPE_SECRET_KEY'));

export const isStripeTestConfigured = (): boolean => Boolean(getConfigValueRaw('STRIPE_TEST_SECRET_KEY'));

export const storefrontStripeConfigKey = (
  environment = process.env.NODE_ENV,
): 'STRIPE_SECRET_KEY' | 'STRIPE_TEST_SECRET_KEY' =>
  environment === 'production' ? 'STRIPE_SECRET_KEY' : 'STRIPE_TEST_SECRET_KEY';

export const storefrontStripeWebhookConfigKey = (
  environment = process.env.NODE_ENV,
): 'STOREFRONT_STRIPE_WEBHOOK_SECRET' | 'STOREFRONT_STRIPE_TEST_WEBHOOK_SECRET' =>
  environment === 'production'
    ? 'STOREFRONT_STRIPE_WEBHOOK_SECRET'
    : 'STOREFRONT_STRIPE_TEST_WEBHOOK_SECRET';

export const storefrontStripePublishableConfigKey = (
  environment = process.env.NODE_ENV,
): 'STRIPE_PUBLISHABLE_KEY' | 'STRIPE_TEST_PUBLISHABLE_KEY' =>
  environment === 'production'
    ? 'STRIPE_PUBLISHABLE_KEY'
    : 'STRIPE_TEST_PUBLISHABLE_KEY';

export const getStorefrontStripeClient = (): Stripe =>
  getStripeClientForConfigKey(storefrontStripeConfigKey());

export const isStorefrontStripeConfigured = (): boolean =>
  Boolean(getConfigValueRaw(storefrontStripeConfigKey()));

export const getStorefrontStripePublishableKey = (
  environment = process.env.NODE_ENV,
): string | null => {
  const configKey = storefrontStripePublishableConfigKey(environment);
  const key = getConfigValueRaw(configKey)?.trim() || '';
  const expectedPrefix = configKey === 'STRIPE_PUBLISHABLE_KEY' ? 'pk_live_' : 'pk_test_';
  return key.startsWith(expectedPrefix) ? key : null;
};

export const isStorefrontStripeTestMode = (): boolean =>
  storefrontStripeConfigKey() === 'STRIPE_TEST_SECRET_KEY';
