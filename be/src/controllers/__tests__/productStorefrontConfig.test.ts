import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';

jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {
  create: jest.fn(), update: jest.fn(), findByPk: jest.fn(),
} }));
jest.mock('../../models/ProductAddon.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Addon.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/storefrontMediaService.js', () => ({ uploadProductMedia: jest.fn(), deleteProductMedia: jest.fn() }));
jest.mock('../../services/productScopeService.js', () => ({
  getAllowedProductTypeIds: jest.fn(), requireProductAccess: jest.fn(),
  requireProductTypeAccess: jest.fn(), scopeProductWhere: jest.fn(),
}));

import Product from '../../models/Product';
import { requireProductAccess, requireProductTypeAccess } from '../../services/productScopeService';
import { createProduct, updateProduct } from '../productController';

const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const config = {
  defaultStartTime: '21:00', content: { summary: 'Experience' },
  duration: '3 hours', inclusions: ['Guide'],
  faqs: [{ question: 'Vegetarian?', answer: 'Yes', available: true }],
  details: { optional: null, empty: {}, list: [], quantity: 2.5 },
};

beforeEach(() => {
  jest.clearAllMocks();
  (Product.create as jest.Mock).mockImplementation(async (payload) => ({ id: 48, ...payload }));
  (Product.update as jest.Mock).mockResolvedValue([1]);
  (Product.findByPk as jest.Mock).mockResolvedValue({ id: 48, storefrontConfig: config });
});

it.each([1, 3])('creates public custom JSON for product type %s without a wrapper', async (productTypeId) => {
  const req = { body: { productTypeId, name: 'Tour', storefrontConfig: config } } as AuthenticatedRequest;
  const res = response();
  await createProduct(req, res as unknown as Response);
  expect(requireProductTypeAccess).toHaveBeenCalledWith(req, productTypeId);
  expect(Product.create).toHaveBeenCalledWith(expect.objectContaining({ storefrontConfig: config }));
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ storefrontConfig: config })]);
});

it('updates custom JSON while retaining product-scope authorization', async () => {
  const req = { params: { id: '48' }, body: { storefrontConfig: config } } as unknown as AuthenticatedRequest;
  const res = response();
  await updateProduct(req, res as unknown as Response);
  expect(requireProductAccess).toHaveBeenCalledWith(req, 48);
  expect(Product.update).toHaveBeenCalledWith({ storefrontConfig: config }, { where: { id: '48' } });
  expect(res.status).toHaveBeenCalledWith(200);
});

it.each([null, [], 'text', 123, true, { details: { amount: Infinity } }])('rejects invalid config %p before writing', async (storefrontConfig) => {
  for (const handler of [createProduct, updateProduct]) {
    const res = response();
    await handler({ params: { id: '48' }, body: { storefrontConfig } } as unknown as AuthenticatedRequest, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  }
  expect(Product.create).not.toHaveBeenCalled();
  expect(Product.update).not.toHaveBeenCalled();
});

it('does not add or clear config when a partial product update omits it', async () => {
  const res = response();
  await updateProduct({ params: { id: '48' }, body: { name: 'New name' } } as unknown as AuthenticatedRequest, res as unknown as Response);
  expect(Product.update).toHaveBeenCalledWith({ name: 'New name' }, { where: { id: '48' } });
});
