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
