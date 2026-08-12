import { Op, type Transaction } from 'sequelize';
import HttpError from '../errors/HttpError.js';
import StorefrontSavedCart, {
  type StorefrontSavedCartCustomer,
} from '../models/StorefrontSavedCart.js';
import type { StorefrontCartInput, StorefrontQuote } from './storefrontCommerceService.js';

const ACTIVE_STATUSES = ['active', 'checkout_started'];

export const normalizeSavedCartFromQuote = (quote: StorefrontQuote): StorefrontCartInput => ({
  items: quote.items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    experienceDate: item.experienceDate,
    experienceTime: item.experienceTime,
    addons: item.addons.map((addon) => ({
      addonId: addon.addonId,
      quantity: addon.quantity,
      value: addon.value,
      variants: addon.variants,
    })),
    options: item.options,
  })),
  discountCode: quote.discountCode,
  discountCodes: quote.discountCodes,
});

export const addCustomerToSavedCart = (
  cart: StorefrontCartInput,
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    countryCode: string | null;
  },
): StorefrontCartInput => ({
  ...cart,
  items: cart.items.map((item) => ({
    ...item,
    options: {
      ...(item.options ?? {}),
      fullName: `${customer.firstName} ${customer.lastName}`.trim(),
      email: customer.email,
      phone: customer.phone ?? '',
      phoneCountry: customer.countryCode ?? '',
    },
  })),
});

export const normalizeSavedCartCustomer = (value: unknown): StorefrontSavedCartCustomer | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const phoneCountry = String(input.phoneCountry ?? '').trim().toUpperCase();
  if (phoneCountry && !/^[A-Z]{2}$/.test(phoneCountry)) {
    throw new HttpError(400, 'The prefilled phone country must use a two-letter country code.');
  }
  const customer: StorefrontSavedCartCustomer = {
    fullName: String(input.fullName ?? '').trim().slice(0, 255),
    email: String(input.email ?? '').trim().toLowerCase().slice(0, 255),
    phoneCountry,
    phone: String(input.phone ?? '').trim().slice(0, 32),
  };
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    throw new HttpError(400, 'The prefilled email address is invalid.');
  }
  return Object.values(customer).some(Boolean) ? customer : null;
};

export const expireSavedCarts = async (transaction?: Transaction): Promise<void> => {
  await StorefrontSavedCart.update(
    { status: 'expired' },
    {
      where: {
        status: { [Op.in]: ACTIVE_STATUSES },
        expiresAt: { [Op.lt]: new Date() },
      },
      transaction,
    },
  );
};

export const getUsableSavedCart = async (
  publicId: string,
  transaction?: Transaction,
  lock = false,
): Promise<StorefrontSavedCart> => {
  const savedCart = await StorefrontSavedCart.findOne({
    where: { publicId },
    transaction,
    ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!savedCart) throw new HttpError(404, 'This prepared cart was not found.');
  if (savedCart.expiresAt.getTime() <= Date.now() && ACTIVE_STATUSES.includes(savedCart.status)) {
    await savedCart.update({ status: 'expired' }, { transaction });
  }
  if (savedCart.status === 'paid') {
    throw new HttpError(409, 'This prepared cart has already been paid.');
  }
  if (savedCart.status === 'disabled') {
    throw new HttpError(410, 'This prepared cart is no longer available.');
  }
  if (savedCart.status === 'expired') {
    throw new HttpError(410, 'This prepared cart has expired.');
  }
  if (!ACTIVE_STATUSES.includes(savedCart.status)) {
    throw new HttpError(409, 'This prepared cart is not available for checkout.');
  }
  return savedCart;
};

export const savedCartStatus = (savedCart: StorefrontSavedCart): string => {
  if (ACTIVE_STATUSES.includes(savedCart.status) && savedCart.expiresAt.getTime() <= Date.now()) {
    return 'expired';
  }
  if (savedCart.status === 'active' && savedCart.openedAt) return 'opened';
  return savedCart.status;
};
