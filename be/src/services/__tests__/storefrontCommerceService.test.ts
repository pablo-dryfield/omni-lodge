import dayjs from 'dayjs';
import { quoteStorefrontCart } from '../storefrontCommerceService';

jest.mock('../../models/Addon.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Channel.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ChannelProductPrice.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Product.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/ProductAddon.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ProductPrice.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/StorefrontPromotion.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../storefrontResourceReservationAvailabilityService.js', () => ({
  getActivePromotionReservationCounts: jest.fn(async () => new Map()),
}));
jest.mock('../inventoryService.js', () => ({
  getAddonInventoryAvailability: jest.fn(async () => new Map()),
}));

import Product from '../../models/Product.js';
import ProductPrice from '../../models/ProductPrice.js';
import StorefrontPromotion from '../../models/StorefrontPromotion.js';

const productFindAll = Product.findAll as jest.Mock;
const productPriceFindAll = ProductPrice.findAll as jest.Mock;
const promotionFindAll = StorefrontPromotion.findAll as jest.Mock;

describe('quoteStorefrontCart validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects an empty cart', async () => {
    await expect(quoteStorefrontCart({ items: [] })).rejects.toThrow(
      'The cart must contain at least one item.',
    );
  });

  it('rejects quantities above the selected product maximum', async () => {
    productFindAll.mockResolvedValue([{
      id: 1,
      name: 'Pub Crawl',
      slug: 'pub-crawl',
      price: 100,
      storefrontConfig: { maxParticipants: 50 },
      productAddons: [],
    }]);
    productPriceFindAll.mockResolvedValue([]);

    await expect(
      quoteStorefrontCart({
        items: [{ productId: 1, quantity: 51 }],
      }),
    ).rejects.toThrow('items[0].quantity must be an integer between 1 and 50.');
  });

  it('rejects malformed experience dates', async () => {
    await expect(
      quoteStorefrontCart({
        items: [{ productId: 1, quantity: 1, experienceDate: '28-07-2026' }],
      }),
    ).rejects.toThrow('Experience date must use YYYY-MM-DD.');
  });

  it('rejects past experience dates', async () => {
    await expect(
      quoteStorefrontCart({
        items: [
          {
            productId: 1,
            quantity: 1,
            experienceDate: dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
          },
        ],
      }),
    ).rejects.toThrow('Experience date cannot be in the past.');
  });

  it('allows past experience dates when explicitly requested', async () => {
    const experienceDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    productFindAll.mockResolvedValue([{
      id: 1,
      name: 'Pub Crawl',
      slug: 'pub-crawl',
      price: 100,
      storefrontConfig: { dateRequired: true },
      productAddons: [],
    }]);
    productPriceFindAll.mockResolvedValue([]);

    await expect(
      quoteStorefrontCart({
        items: [
          {
            productId: 1,
            quantity: 1,
            experienceDate,
          },
        ],
      }, undefined, { allowPastExperienceDates: true }),
    ).resolves.toEqual(expect.objectContaining({
      total: 100,
      items: [
        expect.objectContaining({
          productId: 1,
          experienceDate,
        }),
      ],
    }));
  });

  it('rejects a product date blocked by storefront availability rules', async () => {
    productFindAll.mockResolvedValue([{
      id: 1,
      name: 'Pub Crawl',
      slug: 'pub-crawl',
      price: 100,
      storefrontConfig: {
        dateRequired: true,
        timeMode: 'fixed',
        defaultStartTime: '21:00',
        availability: {
          blockedDates: [{
            date: '2026-12-31',
            reason: 'Book the New Year party instead.',
          }],
        },
      },
      productAddons: [],
    }]);
    productPriceFindAll.mockResolvedValue([]);

    await expect(
      quoteStorefrontCart({
        items: [{
          productId: 1,
          quantity: 1,
          experienceDate: '2026-12-31',
          experienceTime: '21:00',
        }],
      }),
    ).rejects.toThrow('Book the New Year party instead.');
  });

  it('uses the configured fixed date when the cart omits an activity date', async () => {
    productFindAll.mockResolvedValue([{
      id: 1,
      name: 'NYE Pub Crawl',
      slug: 'nye-pub-crawl',
      price: 120,
      storefrontConfig: {
        timeMode: 'fixed',
        defaultStartTime: '21:00',
        availability: {
          dateMode: 'fixed',
          fixedDate: '2026-12-31',
        },
      },
      productAddons: [],
    }]);
    productPriceFindAll.mockResolvedValue([]);

    await expect(
      quoteStorefrontCart({
        items: [{ productId: 1, quantity: 1 }],
      }),
    ).resolves.toEqual(expect.objectContaining({
      total: 120,
      items: [
        expect.objectContaining({
          productId: 1,
          experienceDate: '2026-12-31',
          experienceTime: '21:00',
        }),
      ],
    }));
  });

  it('rejects a date that differs from the configured fixed product date', async () => {
    productFindAll.mockResolvedValue([{
      id: 1,
      name: 'NYE Pub Crawl',
      slug: 'nye-pub-crawl',
      price: 120,
      storefrontConfig: {
        availability: {
          dateMode: 'fixed',
          fixedDate: '2026-12-31',
        },
      },
      productAddons: [],
    }]);
    productPriceFindAll.mockResolvedValue([]);

    await expect(
      quoteStorefrontCart({
        items: [{ productId: 1, quantity: 1, experienceDate: '2026-12-30' }],
      }),
    ).rejects.toThrow('NYE Pub Crawl can only be booked for 2026-12-31.');
  });

  it('rejects allowed-date products outside their configured dates', async () => {
    productFindAll.mockResolvedValue([{
      id: 1,
      name: 'Halloween Pub Crawl',
      slug: 'halloween-pub-crawl',
      price: 120,
      storefrontConfig: {
        availability: {
          dateMode: 'allowed_dates',
          allowedDates: ['2026-10-31'],
        },
      },
      productAddons: [],
    }]);
    productPriceFindAll.mockResolvedValue([]);

    await expect(
      quoteStorefrontCart({
        items: [{ productId: 1, quantity: 1, experienceDate: '2026-11-01' }],
      }),
    ).rejects.toThrow('Halloween Pub Crawl is not available on the selected date.');
  });

  it('applies a manual amount before discount calculation', async () => {
    productFindAll.mockResolvedValue([{
      id: 1,
      name: 'Pub Crawl',
      slug: 'pub-crawl',
      price: 31.57,
      storefrontConfig: {},
      productAddons: [],
    }]);
    productPriceFindAll.mockResolvedValue([]);
    promotionFindAll.mockResolvedValue([{
      id: 7,
      code: 'ROUND10',
      name: 'Rounded transfer discount',
      type: 'percentage',
      value: 10,
      currency: null,
      maxRedemptions: null,
      redemptionCount: 0,
      minSubtotal: null,
      metadata: null,
    }]);

    await expect(
      quoteStorefrontCart(
        {
          items: [{ productId: 1, quantity: 1 }],
          discountCode: 'ROUND10',
        },
        undefined,
        { amountBeforeDiscountOverride: 28 },
      ),
    ).resolves.toEqual(expect.objectContaining({
      subtotal: 28,
      addonTotal: 0,
      calculatedAmountBeforeDiscount: 31.57,
      amountBeforeDiscountOverride: 28,
      discountTotal: 2.8,
      total: 25.2,
      items: [
        expect.objectContaining({
          productId: 1,
          unitPrice: 28,
          baseTotal: 28,
          total: 28,
        }),
      ],
    }));
  });

  it('rejects carts with more than 20 lines', async () => {
    await expect(
      quoteStorefrontCart({
        items: Array.from({ length: 21 }, (_, index) => ({
          productId: index + 1,
          quantity: 1,
        })),
      }),
    ).rejects.toThrow('The cart cannot contain more than 20 items.');
  });
});

describe('storefront discount rules', () => {
  const promotion = (overrides: Record<string, unknown> = {}) => ({
    id: 1, code: 'SAVE', name: 'Save', type: 'fixed', value: 10, currency: 'PLN',
    maxRedemptions: null, redemptionCount: 0, minSubtotal: null, metadata: null, ...overrides,
  });
  const items = [{ productId: 28, quantity: 2, addons: [{ addonId: 7, quantity: 2 }] }];
  beforeEach(() => {
    jest.clearAllMocks();
    productFindAll.mockResolvedValue([{
      id: 28, name: 'Pub Crawl', price: 120, storefrontConfig: {},
      productAddons: [{
        addonId: 7, maxPerAttendee: 1, priceOverride: null, storefrontConfig: {},
        addon: { id: 7, name: 'Cocktail', isActive: true, basePrice: 30 },
      }],
    }]);
    productPriceFindAll.mockResolvedValue([]);
    promotionFindAll.mockResolvedValue([promotion()]);
  });

  it('rejects different codes before loading products, including the legacy singular field', async () => {
    for (const codes of [
      { discountCodes: ['DISCOUNTED-PC', 'NOMADTABLE'] },
      { discountCodes: ['SAVE'], discountCode: 'OTHER' },
    ]) {
      await expect(quoteStorefrontCart({ items, ...codes })).rejects.toThrow('Only one discount code');
    }
    expect(productFindAll).not.toHaveBeenCalled();
  });

  it('deduplicates repeated codes and preserves legacy booking-wide fixed discounts', async () => {
    const quote = await quoteStorefrontCart({ items, discountCodes: ['save', ' SAVE '], discountCode: 'SAVE' });
    expect(quote).toMatchObject({ subtotal: 240, addonTotal: 60, discountTotal: 10, total: 290, discountCodes: ['SAVE'] });
  });

  it.each(['tour', 'tour_and_addons'])('applies fixed 10 PLN per participant, not per cocktail (%s)', async (discountScope) => {
    promotionFindAll.mockResolvedValue([promotion({ metadata: { applicationBasis: 'person', discountScope } })]);
    const quote = await quoteStorefrontCart({ items, discountCode: 'SAVE' });
    expect(quote).toMatchObject({ discountTotal: 20, total: 280 });
    expect(quote.discounts[0]).toMatchObject({ applicationBasis: 'person', discountScope, participantCount: 2, value: 10 });
  });

  it.each([
    ['booking', 'tour', 24], ['person', 'tour', 24],
    ['booking', 'tour_and_addons', 30], ['person', 'tour_and_addons', 30],
  ])('calculates 10 percent with %s / %s rules without multiplying the rate by participant count', async (applicationBasis, discountScope, expected) => {
    promotionFindAll.mockResolvedValue([promotion({ type: 'percentage', currency: null, metadata: { applicationBasis, discountScope } })]);
    expect((await quoteStorefrontCart({ items, discountCode: 'SAVE' })).discountTotal).toBe(expected);
  });

  it('keeps legacy percentage totals and rounds money once', async () => {
    promotionFindAll.mockResolvedValue([promotion({ type: 'percentage', value: 8.33, currency: null })]);
    const quote = await quoteStorefrontCart({ items: [{ productId: 28, quantity: 2 }], discountCode: 'SAVE' });
    expect(quote).toMatchObject({ discountTotal: 19.99, total: 220.01 });
  });

  it.each(['booking', 'person'])('caps a large %s tour-only discount without consuming add-on charges', async (applicationBasis) => {
    promotionFindAll.mockResolvedValue([promotion({ value: 1000, metadata: { applicationBasis, discountScope: 'tour' } })]);
    expect(await quoteStorefrontCart({ items, discountCode: 'SAVE' })).toMatchObject({ discountTotal: 240, total: 60 });
  });

  it('counts participants only for eligible products across multiple cart lines', async () => {
    const products = await productFindAll();
    productFindAll.mockResolvedValue([...products, { id: 32, name: 'NYE', price: 250, storefrontConfig: {}, productAddons: [] }]);
    promotionFindAll.mockResolvedValue([promotion({ metadata: { applicationBasis: 'person', discountScope: 'tour', productIds: [28] } })]);
    expect(await quoteStorefrontCart({ items: [...items, { productId: 28, quantity: 1 }, { productId: 32, quantity: 3 }], discountCode: 'SAVE' }))
      .toMatchObject({ discountTotal: 30, total: 1140, discounts: [expect.objectContaining({ participantCount: 3 })] });
  });

  it('does not transfer unused per-person discounts from cheap tickets to expensive tickets', async () => {
    productFindAll.mockResolvedValue([
      { id: 28, name: 'Small', price: 5, storefrontConfig: {}, productAddons: [] },
      { id: 32, name: 'Large', price: 100, storefrontConfig: {}, productAddons: [] },
    ]);
    promotionFindAll.mockResolvedValue([promotion({ metadata: { applicationBasis: 'person', discountScope: 'tour' } })]);
    expect(await quoteStorefrontCart({ items: [{ productId: 28, quantity: 2 }, { productId: 32, quantity: 1 }], discountCode: 'SAVE' }))
      .toMatchObject({ discountTotal: 20, total: 90 });
  });

  it('retains currency, redemption, minimum and product eligibility checks', async () => {
    for (const [override, message] of [
      [{ currency: 'EUR' }, 'not available for this currency'],
      [{ maxRedemptions: 1, redemptionCount: 1 }, 'redemption limit'],
      [{ minSubtotal: 500 }, 'minimum subtotal'],
      [{ metadata: { productIds: [32] } }, 'does not apply'],
    ] as const) {
      promotionFindAll.mockResolvedValue([promotion(override)]);
      await expect(quoteStorefrontCart({ items, discountCode: 'SAVE' })).rejects.toThrow(message);
    }
  });
});
