jest.mock('../../config/database.js', () => ({ __esModule: true, default: {
  transaction: jest.fn(async (run: (transaction: unknown) => unknown) => run({ LOCK: { UPDATE: 'UPDATE' } })),
} }));
jest.mock('../../middleware/authMiddleware.js', () => ({ __esModule: true,
  default: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../__mocks__/sequelizeModelStub', () => ({ __esModule: true, default: {
  findByPk: jest.fn(), findAll: jest.fn(), getAttributes: jest.fn(() => ({})),
} }));
jest.mock('../../models/ProductType.js', () => ({ __esModule: true, default: { count: jest.fn() } }));
jest.mock('../../models/UserTypeProductType.js', () => ({ __esModule: true, default: {
  findAll: jest.fn(), destroy: jest.fn(), bulkCreate: jest.fn(),
} }));

import express from 'express';
import request from 'supertest';
import UserType from '../../__mocks__/sequelizeModelStub';
import ProductType from '../../models/ProductType.js';
import Scope from '../../models/UserTypeProductType.js';
import router from '../userTypeRoutes.js';

const app = express();
app.use(express.json());
app.use('/userTypes', router);
let links: Array<{ userTypeId: number; productTypeId: number }>;
let role: { id: number; name: string; slug: string; update: jest.Mock; get: jest.Mock };
beforeEach(() => {
  jest.clearAllMocks();
  links = [];
  role = { id: 16, name: 'Food Tour Owner', slug: 'food-tour-owner', update: jest.fn(), get: jest.fn() };
  role.get.mockImplementation(() => ({ id: role.id, name: role.name, slug: role.slug }));
  role.update.mockImplementation(async (data) => Object.assign(role, data));
  (UserType.findByPk as jest.Mock).mockResolvedValue(role);
  (UserType.findAll as jest.Mock).mockResolvedValue([role]);
  (Scope.findAll as jest.Mock).mockImplementation(async () => links);
  (Scope.destroy as jest.Mock).mockImplementation(async () => { links = []; });
  (Scope.bulkCreate as jest.Mock).mockImplementation(async (next) => { links = next; });
  (ProductType.count as jest.Mock).mockResolvedValue(1);
});

it('saves product types alone and returns the persisted selection on reload', async () => {
  const saved = await request(app).put('/userTypes/16').send({ productTypeIds: [3] });
  expect(saved.status).toBe(200);
  expect(saved.body[0]).toMatchObject({ id: 16, name: 'Food Tour Owner', productTypeIds: [3] });
  expect(role.update).not.toHaveBeenCalled();
  expect(Scope.bulkCreate).toHaveBeenCalledWith([{ userTypeId: 16, productTypeId: 3 }], { transaction: expect.anything() });
  const reloaded = await request(app).get('/userTypes');
  expect(reloaded.body[0].data[0].productTypeIds).toEqual([3]);
});

it('clears the product scope using an empty array', async () => {
  links = [{ userTypeId: 16, productTypeId: 3 }];
  const response = await request(app).put('/userTypes/16').send({ productTypeIds: [] });
  expect(response.status).toBe(200);
  expect(response.body[0].productTypeIds).toEqual([]);
  expect(Scope.bulkCreate).not.toHaveBeenCalled();
});

it('does not clear an omitted scope when updating another field', async () => {
  links = [{ userTypeId: 16, productTypeId: 3 }];
  const response = await request(app).put('/userTypes/16').send({ description: 'Food tour access' });
  expect(response.status).toBe(200);
  expect(Scope.destroy).not.toHaveBeenCalled();
  expect(role.update).toHaveBeenCalledWith({ description: 'Food tour access' }, { transaction: expect.anything() });
});

it.each([{ name: '' }, { slug: '' }, { productTypeIds: '3' }, { productTypeIds: [0] }, { productTypeIds: ['invalid'] }])(
  'rejects invalid partial updates: %j', async (body) => {
    const response = await request(app).put('/userTypes/16').send(body);
    expect(response.status).toBe(400);
    expect(Scope.destroy).not.toHaveBeenCalled();
  },
);

it('keeps the existing scope when the selected product type does not exist', async () => {
  links = [{ userTypeId: 16, productTypeId: 3 }];
  (ProductType.count as jest.Mock).mockResolvedValue(0);
  const response = await request(app).put('/userTypes/16').send({ productTypeIds: [999] });
  expect(response.status).toBe(400);
  expect(response.body[0].message).toMatch(/do not exist/);
  expect(Scope.destroy).not.toHaveBeenCalled();
  expect(links).toEqual([{ userTypeId: 16, productTypeId: 3 }]);
});

it('returns 404 for a missing role without changing scope links', async () => {
  (UserType.findByPk as jest.Mock).mockResolvedValue(null);
  expect((await request(app).put('/userTypes/999').send({ productTypeIds: [3] })).status).toBe(404);
  expect(Scope.destroy).not.toHaveBeenCalled();
});

it('still requires a name when creating a new user type', async () => {
  expect((await request(app).post('/userTypes').send({ productTypeIds: [3] })).status).toBe(400);
});
