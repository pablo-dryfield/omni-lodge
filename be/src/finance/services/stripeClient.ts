import Stripe from 'stripe';
import HttpError from '../../errors/HttpError.js';
import { getConfigValueRaw } from '../../services/configService.js';

const cachedClients = new Map<string, Stripe>();

const getStripeClientForConfigKey = (configKey: 'STRIPE_SECRET_KEY' | 'STRIPE_TEST_SECRET_KEY'): Stripe => {
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

export const getStorefrontStripeClient = (): Stripe =>
  getStripeClientForConfigKey(storefrontStripeConfigKey());

export const isStorefrontStripeConfigured = (): boolean =>
  Boolean(getConfigValueRaw(storefrontStripeConfigKey()));

export const isStorefrontStripeTestMode = (): boolean =>
  storefrontStripeConfigKey() === 'STRIPE_TEST_SECRET_KEY';
