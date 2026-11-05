jest.mock('../../models/Addon.js', () => ({ __esModule: true, default: class Addon {} }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: class Product {} }));
jest.mock('../../models/ProductAddon.js', () => ({ __esModule: true, default: {
  create: jest.fn(), update: jest.fn(), findByPk: jest.fn(),
} }));

import type { Request, Response } from 'express';
import ProductAddon from '../../models/ProductAddon';
import { createProductAddon, updateProductAddon } from '../productAddonController';

const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response);
beforeEach(() => jest.clearAllMocks());

it.each([createProductAddon, updateProductAddon])('rejects invalid availability before saving', async handler => {
  const res = response();
  await handler({ params: { id: '1' }, body: { storefrontConfig: { availability: { daysOfWeek: [0, 8] } } } } as unknown as Request, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(ProductAddon.create).not.toHaveBeenCalled();
  expect(ProductAddon.update).not.toHaveBeenCalled();
});

it('persists weekday rules alongside existing prices and arbitrary advanced JSON', async () => {
  const config = { selectionMode: 'quantity', quantityPrices: { '2': 30 },
    availability: { enabled: true, daysOfWeek: [5, 6], unavailableMessage: 'Weekend tours only.' },
    content: { badge: 'Popular', translations: { pl: 'Popularne' } },
  };
  jest.mocked(ProductAddon.update).mockResolvedValue([1]);
  jest.mocked(ProductAddon.findByPk).mockResolvedValue({ id: 1, storefrontConfig: config } as ProductAddon);
  const res = response();
  await updateProductAddon({ params: { id: '1' }, body: { storefrontConfig: config } } as unknown as Request, res);
  expect(ProductAddon.update).toHaveBeenCalledWith({ storefrontConfig: config }, { where: { id: '1' } });
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ storefrontConfig: config })]);
});
