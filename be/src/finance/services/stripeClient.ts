import Stripe from 'stripe';
import HttpError from '../../errors/HttpError.js';
import { getConfigValueRaw } from '../../services/configService.js';

let cachedKey: string | null = null;
let cachedClient: Stripe | null = null;

export const getStripeClient = (): Stripe => {
  const key = getConfigValueRaw('STRIPE_SECRET_KEY');
  if (!key) {
    throw new HttpError(503, 'Stripe is not configured.');
  }
  if (!cachedClient || cachedKey !== key) {
    cachedKey = key;
    cachedClient = new Stripe(key);
  }
  return cachedClient;
};

export const isStripeConfigured = (): boolean => Boolean(getConfigValueRaw('STRIPE_SECRET_KEY'));
