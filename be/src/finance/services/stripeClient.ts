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
