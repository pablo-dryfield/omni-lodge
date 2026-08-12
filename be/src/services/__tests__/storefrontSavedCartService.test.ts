jest.mock('../../models/StorefrontSavedCart.js', () => ({
  __esModule: true,
  default: { update: jest.fn() },
}));

import type StorefrontSavedCart from '../../models/StorefrontSavedCart';
import type { StorefrontQuote } from '../storefrontCommerceService';
import {
  addCustomerToSavedCart,
  normalizeSavedCartCustomer,
  normalizeSavedCartFromQuote,
  savedCartStatus,
} from '../storefrontSavedCartService';

const quote: StorefrontQuote = {
  currency: 'PLN',
  subtotal: 240,
  addonTotal: 118,
  discountTotal: 20,
  total: 338,
  discountCode: 'GROUP20',
  discountCodes: ['GROUP20'],
  promotionId: 7,
  discounts: [{ promotionId: 7, code: 'GROUP20', name: 'Group', amount: 20, productIds: [28] }],
  items: [{
    productId: 28,
    productName: 'Pub Crawl',
    productSlug: 'pub-crawl-28',
    quantity: 2,
    experienceDate: '2026-08-20',
    experienceTime: '21:00',
    unitPrice: 120,
    baseTotal: 240,
    addonTotal: 118,
    total: 358,
    addons: [{
      addonId: 2,
      name: 'T-Shirts',
      quantity: 2,
      value: null,
      variants: [{ value: 'S', quantity: 1 }, { value: 'M', quantity: 1 }],
      unitPrice: 59,
      total: 118,
    }],
    options: { participants: { men: 1, women: 1 } },
  }],
};

describe('storefront saved cart service', () => {
  it('stores a normalized cart without trusting quoted names or prices', () => {
    expect(normalizeSavedCartFromQuote(quote)).toEqual({
      items: [{
        productId: 28,
        quantity: 2,
        experienceDate: '2026-08-20',
        experienceTime: '21:00',
        addons: [{
          addonId: 2,
          quantity: 2,
          value: null,
          variants: [{ value: 'S', quantity: 1 }, { value: 'M', quantity: 1 }],
        }],
        options: { participants: { men: 1, women: 1 } },
      }],
      discountCode: 'GROUP20',
      discountCodes: ['GROUP20'],
    });
  });

  it('injects checkout customer details into every locked item', () => {
    const cart = normalizeSavedCartFromQuote(quote);
    const hydrated = addCustomerToSavedCart(cart, {
      firstName: 'Pablo',
      lastName: 'Cabrera',
      email: 'pablo@example.com',
      phone: '+48500100200',
      countryCode: 'PL',
    });
    expect(hydrated.items[0].options).toEqual({
      participants: { men: 1, women: 1 },
      fullName: 'Pablo Cabrera',
      email: 'pablo@example.com',
      phone: '+48500100200',
      phoneCountry: 'PL',
    });
  });

  it('normalizes optional contact prefills and rejects invalid values', () => {
    expect(normalizeSavedCartCustomer({
      fullName: '  Pablo Cabrera ',
      email: ' PABLO@EXAMPLE.COM ',
      phoneCountry: 'pl',
      phone: '+48500100200',
    })).toEqual({
      fullName: 'Pablo Cabrera',
      email: 'pablo@example.com',
      phoneCountry: 'PL',
      phone: '+48500100200',
    });
    expect(() => normalizeSavedCartCustomer({ email: 'invalid' })).toThrow('prefilled email');
    expect(() => normalizeSavedCartCustomer({ phoneCountry: 'POL' })).toThrow('phone country');
  });

  it('reports opened and expired states without changing terminal states', () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    expect(savedCartStatus({ status: 'active', openedAt: new Date(), expiresAt: future } as StorefrontSavedCart)).toBe('opened');
    expect(savedCartStatus({ status: 'active', openedAt: null, expiresAt: past } as StorefrontSavedCart)).toBe('expired');
    expect(savedCartStatus({ status: 'paid', openedAt: new Date(), expiresAt: past } as StorefrontSavedCart)).toBe('paid');
  });
});
