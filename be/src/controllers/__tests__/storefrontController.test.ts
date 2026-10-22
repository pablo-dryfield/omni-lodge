import type { Response } from 'express';
import { getStorefrontProduct, listStorefrontProducts } from '../storefrontController';

jest.mock('../../models/Addon.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Channel.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../models/ChannelProductPrice.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Product.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findOne: jest.fn() },
}));
jest.mock('../../models/ProductAddon.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ProductPrice.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/ProductType.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/inventoryService.js', () => ({
  getAddonInventoryAvailability: jest.fn(),
}));
jest.mock('../../services/storefrontPublicConfigService.js', () => ({
  getStorefrontPublicConfig: jest.fn(() => ({ currency: 'PLN' })),
}));

import Channel from '../../models/Channel.js';
import Product from '../../models/Product.js';
import ProductPrice from '../../models/ProductPrice.js';
import { getAddonInventoryAvailability } from '../../services/inventoryService.js';

const channelFindOne = Channel.findOne as jest.Mock;
const productFindAll = Product.findAll as jest.Mock;
const productFindOne = Product.findOne as jest.Mock;
const productPriceFindAll = ProductPrice.findAll as jest.Mock;
const getAddonInventoryAvailabilityMock = getAddonInventoryAvailability as jest.Mock;

const buildResponse = () => {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return response as unknown as Response & { status: jest.Mock; json: jest.Mock };
};

describe('storefront catalog pricing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    channelFindOne.mockResolvedValue(null);
    getAddonInventoryAvailabilityMock.mockResolvedValue(new Map());
  });

  it('loads only PLN scheduled prices for the public storefront catalog', async () => {
    productFindAll.mockResolvedValue([
      {
        id: 28,
        name: 'Pub Crawl',
        price: 120,
        imageUrl: null,
        images: [],
        storefrontConfig: {},
        productAddons: [],
        get: jest.fn(() => null),
      },
    ]);
    productPriceFindAll.mockResolvedValue([
      {
        id: 4,
        productId: 28,
        price: '120.00',
        validFrom: '2026-09-25',
      },
    ]);

    const response = buildResponse();

    await listStorefrontProducts({} as never, response);

    expect(productPriceFindAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        productId: expect.any(Object),
        currencyCode: 'PLN',
      }),
    }));
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      products: [
        expect.objectContaining({
          id: 28,
          price: { amount: 120, currency: 'PLN' },
        }),
      ],
    }));
  });
});

describe('public storefront custom JSON', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    channelFindOne.mockResolvedValue(null);
    productPriceFindAll.mockResolvedValue([]);
    getAddonInventoryAvailabilityMock.mockResolvedValue(new Map());
  });

  it.each([
    [28, 'Pub Crawl', 1, 'pub-crawl-28'],
    [48, 'Food Tour', 3, 'food-tour-48'],
  ])('exposes custom fields for product %s in both catalog and product responses', async (id, name, typeId, slug) => {
    const custom = {
      duration: '3 hours', inclusions: ['Local guide'],
      faqs: [{ question: 'Vegetarian?', answer: 'Yes' }],
      details: { enabled: true, optional: null, quantity: 2.5, empty: {}, list: [] },
      price: { amount: 1, currency: 'EUR' },
    };
    const storefrontConfig = {
      ...custom,
      defaultStartTime: '21:00', content: { summary: 'Existing content' },
      availability: { blockedDates: [{ date: '2026-12-31', reason: 'Closed' }] },
    };
    const product = {
      id, name, productTypeId: typeId, price: 120,
      imageUrl: null, images: [], storefrontConfig, productAddons: [],
      get: jest.fn(() => ({ id: typeId, name: typeId === 3 ? 'Food Tour' : 'Pub Crawl' })),
    };
    productFindAll.mockResolvedValue([product]);
    productFindOne.mockResolvedValue(product);
    const catalogRes = buildResponse();
    const productRes = buildResponse();
    await listStorefrontProducts({} as never, catalogRes);
    await getStorefrontProduct({ params: { slug } } as never, productRes);
    expect(catalogRes.status).toHaveBeenCalledWith(200);
    expect(productRes.status).toHaveBeenCalledWith(200);
    const catalogProduct = catalogRes.json.mock.calls[0][0].products[0];
    const detailProduct = productRes.json.mock.calls[0][0].product;
    for (const item of [catalogProduct, detailProduct]) {
      expect(item.config).toMatchObject(storefrontConfig);
      expect(item.config).not.toHaveProperty('extra');
      // Custom metadata does not change the real commerce price.
      expect(item.price).toEqual({ amount: 120, currency: 'PLN' });
      expect(item.productType.id).toBe(typeId);
    }
  });
});
