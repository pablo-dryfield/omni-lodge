import type { Response } from 'express';
import { listStorefrontProducts } from '../storefrontController';

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
  default: { findAll: jest.fn() },
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
