jest.mock('../../config/database.js', () => ({ __esModule: true, default: {
  transaction: jest.fn(async run => run({ LOCK: { UPDATE: 'UPDATE' } })),
} }));
// The repository maps User, UserType and RoleModulePermission to this common
// Jest model stub. Query predicates below distinguish their operations.
jest.mock('../../__mocks__/sequelizeModelStub.ts', () => ({ __esModule: true, default: {
  findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn(), getAttributes: jest.fn(() => ({})),
} }));
jest.mock('../../models/UserTypeProductType.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ProductType.js', () => ({ __esModule: true, default: { findAll: jest.fn(), getAttributes: jest.fn(() => ({})) } }));
jest.mock('../../models/ProductPrice.js', () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), getAttributes: jest.fn(() => ({})) } }));
jest.mock('../../models/ProductAddon.js', () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), getAttributes: jest.fn(() => ({})) } }));
jest.mock('../../models/Addon.js', () => ({ __esModule: true, default: { findAll: jest.fn(), getAttributes: jest.fn(() => ({})) } }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../services/staffEligibilityHistoryService.js', () => ({ applyUserTypeChange: jest.fn() }));
import { Op } from 'sequelize';
import bcrypt from 'bcryptjs';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import CommonModel from '../../__mocks__/sequelizeModelStub';
import Links from '../../models/UserTypeProductType';
import Product from '../../models/Product';
import ProductType from '../../models/ProductType';
import ProductPrice from '../../models/ProductPrice';
import AuditLog from '../../models/AuditLog';
import { applyUserTypeChange } from '../../services/staffEligibilityHistoryService';
import { handleProductScopedManagement, manageableRoleIds } from '../productScopedManagementController';

const row = (data: Record<string, unknown>) => ({ ...data,
  get: jest.fn((key: unknown) => typeof key === 'string' ? data[key] : { ...data }),
  update: jest.fn(async function(this: any, delta) { Object.assign(data, delta); Object.assign(this, delta); return this; }),
  reload: jest.fn().mockResolvedValue(undefined), destroy: jest.fn(),
});
let users: ReturnType<typeof row>[];
let roles: ReturnType<typeof row>[];
let scopeRows: Array<{ userTypeId: number; productTypeId: number }>;
let permissions: Array<{ userTypeId: number; moduleId: number; actionId: number }>;
const req = (method: string, body: unknown = {}) => ({ method, body, path: '/', query: {}, productTypeScope: [3],
  authContext: { id: 215, userTypeId: 16, roleSlug: 'food-tour-owner' } } as AuthenticatedRequest);
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn(), send: jest.fn() } as unknown as Response);
beforeEach(() => {
  jest.clearAllMocks();
  scopeRows = [
    { userTypeId: 16, productTypeId: 3 }, { userTypeId: 18, productTypeId: 3 },
    { userTypeId: 15, productTypeId: 3 }, { userTypeId: 15, productTypeId: 1 },
    { userTypeId: 19, productTypeId: 3 },
  ];
  permissions = [
    { userTypeId: 16, moduleId: 1, actionId: 1 }, { userTypeId: 18, moduleId: 1, actionId: 1 },
    { userTypeId: 19, moduleId: 2, actionId: 2 }, { userTypeId: 15, moduleId: 2, actionId: 2 },
  ];
  roles = [row({ id: 16, slug: 'food-tour-owner', name: 'Food Tour Owner', status: true }),
    row({ id: 18, slug: 'food-tour-owner-member', name: 'Food Tour Owner — Team member', status: true }),
    row({ id: 19, slug: 'other-product-supervisor', name: 'Other supervisor', status: true }),
    row({ id: 15, slug: 'food-tour-manager', name: 'Food Tour Manager', status: true }),
    row({ id: 1, slug: 'owner', name: 'Food Tour Owner (misleading display name)', status: true }),
    row({ id: 2, slug: 'admin', name: 'Administrator', status: true })];
  users = [row({ id: 215, userTypeId: 16, username: 'Agata', status: true, approved: true, password: 'must-never-leak', medicalNotes: 'private' }),
    row({ id: 216, userTypeId: 18, username: 'FoodStaff' }), row({ id: 1, userTypeId: 1, username: 'GlobalOwner' }),
    row({ id: 217, userTypeId: 15, username: 'Shared' }), row({ id: 218, userTypeId: 2, username: 'Unassigned' })];
  (Links.findAll as jest.Mock).mockImplementation(async options => options?.where?.userTypeId ? scopeRows.filter(link => link.userTypeId === options.where.userTypeId) : scopeRows);
  (CommonModel.findAll as jest.Mock).mockImplementation(async options => {
    if (options.where.allowed) return permissions;
    if (options.where.userTypeId) return users.filter(user => options.where.userTypeId[Op.in].includes(user.userTypeId) && (!options.where.id || user.id === options.where.id));
    return roles.filter(role => (typeof options.where.id === 'number' ? role.id === options.where.id : options.where.id[Op.in].includes(role.id))
      && (options.where.status === undefined || role.status === options.where.status));
  });
  (CommonModel.findByPk as jest.Mock).mockImplementation(async id => users.find(user => user.id === id) ?? null);
  (CommonModel.create as jest.Mock).mockImplementation(async data => row({ ...data, id: 300 }));
  (Product.findAll as jest.Mock).mockResolvedValue([{ id: 48, name: 'Food Tour' }]);
  (ProductType.findAll as jest.Mock).mockResolvedValue([{ id: 3, name: 'Food Tour Krakow' }]);
  (ProductPrice.findAll as jest.Mock).mockResolvedValue([]);
  (ProductPrice.findOne as jest.Mock).mockResolvedValue(null);
});

it('hides global, unassigned, shared and unrelated role families from a Food Tour owner', async () => {
  expect(await manageableRoleIds(req('GET'), [3])).toEqual([16, 18]);
});
const scopeManagerToFoodTour = () => { scopeRows = scopeRows.filter(link => link.userTypeId !== 15 || link.productTypeId === 3); };

it('offers Food Tour Manager even when it has extra raw permissions, but only after it is explicitly Food Tour-only', async () => {
  scopeManagerToFoodTour();
  expect(await manageableRoleIds(req('GET'), [3])).toEqual([16, 18, 15]);
  const response = res();
  await handleProductScopedManagement(req('GET'), response, { resource: 'userTypes' }, [3]);
  expect((response.json as jest.Mock).mock.calls[0][0][0].data.map((role: { id: number }) => role.id)).toEqual([16, 18, 15]);
});
it.each(['Food Tour', 'Food Tour Krakow'])('recognizes the configured Food Tour product category %s', async name => {
  scopeManagerToFoodTour();
  (ProductType.findAll as jest.Mock).mockResolvedValue([{ id: 3, name }]);
  expect(await manageableRoleIds(req('GET'), [3])).toEqual([16, 18, 15]);
});
it('can manage an existing Food Tour Manager without exposing shared or global users', async () => {
  scopeManagerToFoodTour();
  const response = res();
  await handleProductScopedManagement(req('PUT', { firstName: 'Updated' }), response, { resource: 'users', id: 217 }, [3]);
  expect(response.status).toHaveBeenCalledWith(200);
  expect(users.find(user => user.id === 217)!.update).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Updated' }), expect.anything());
});
it('does not infer product scope from a Food Tour role prefix', async () => {
  scopeRows = scopeRows.filter(link => link.userTypeId !== 15);
  expect(await manageableRoleIds(req('GET'), [3])).not.toContain(15);
});
it('rejects Food Tour roles scoped exclusively to a different product', async () => {
  scopeRows = scopeRows.filter(link => link.userTypeId !== 15 || link.productTypeId === 1);
  expect(await manageableRoleIds(req('GET'), [3])).not.toContain(15);
});
it('excludes inactive prefixed roles and prefix lookalikes', async () => {
  scopeManagerToFoodTour();
  roles.find(role => role.id === 15)!.status = false;
  roles.find(role => role.id === 19)!.slug = 'food-tourism-manager';
  expect(await manageableRoleIds(req('GET'), [3])).toEqual([16, 18]);
});
it.each(['Pub Crawl', 'Food Tours'])('does not enable the Food Tour owner exception for product type %s', async name => {
  (ProductType.findAll as jest.Mock).mockResolvedValue([{ id: 3, name }]);
  expect(await manageableRoleIds(req('GET'), [3])).toEqual([]);
});
it('does not enable the exception for a shared owner scope', async () => {
  expect(await manageableRoleIds(req('GET'), [3, 1])).toEqual([]);
});
it('uses current database role identity, not a stale owner slug in the session', async () => {
  scopeManagerToFoodTour();
  roles.find(role => role.id === 16)!.slug = 'food-tour-guide';
  expect(await manageableRoleIds(req('GET'), [3])).toEqual([16, 18]);
});
it('does not give Food Tour managers the special owner delegation power', async () => {
  scopeManagerToFoodTour();
  permissions.push({ userTypeId: 15, moduleId: 1, actionId: 1 });
  const request = req('GET');
  request.authContext = { id: 217, userTypeId: 15, roleSlug: 'food-tour-owner' };
  expect(await manageableRoleIds(request, [3])).toEqual([18, 19, 15]);
});
it('rechecks target scope inside the write transaction before creating or updating a user', async () => {
  scopeManagerToFoodTour();
  (Links.findAll as jest.Mock).mockImplementation(async options => options?.where?.userTypeId
    ? scopeRows.filter(link => link.userTypeId === options.where.userTypeId)
    : [...scopeRows, ...(options?.transaction ? [{ userTypeId: 15, productTypeId: 1 }] : [])]);
  const response = res();
  await handleProductScopedManagement(req('PUT', { userTypeId: 15 }), response, { resource: 'users', id: 216 }, [3]);
  expect(response.status).toHaveBeenCalledWith(403);
  expect(applyUserTypeChange).not.toHaveBeenCalled();
});
it('lists only exclusively delegated users and removes credentials and sensitive profile fields', async () => {
  const response = res();
  await handleProductScopedManagement(req('GET'), response, { resource: 'users' }, [3]);
  const data = (response.json as jest.Mock).mock.calls[0][0][0].data;
  expect(data.map((user: { id: number }) => user.id)).toEqual([215, 216]);
  expect(JSON.stringify(data)).not.toMatch(/must-never-leak|medicalNotes|password/);
});
it.each([1, 217, 218])('cannot edit user %s outside the exclusively delegated directory', async id => {
  const response = res();
  await handleProductScopedManagement(req('PUT', { firstName: 'Changed' }), response, { resource: 'users', id }, [3]);
  expect(response.status).toHaveBeenCalledWith(404);
  expect(users.find(user => user.id === id)!.update).not.toHaveBeenCalled();
});
it.each([1, 15, 19])('cannot assign global/shared/over-privileged role %s', async userTypeId => {
  const response = res();
  await handleProductScopedManagement(req('PUT', { userTypeId }), response, { resource: 'users', id: 216 }, [3]);
  expect(response.status).toHaveBeenCalledWith(403);
  expect(applyUserTypeChange).not.toHaveBeenCalled();
});
it.each([{ roleKey: 'owner' }, { financeVendorId: 2 }, { medicalNotes: 'not delegated' }, { productTypeScope: null }])('rejects mass-assignment bypass %j', async body => {
  const response = res();
  await handleProductScopedManagement(req('PUT', body), response, { resource: 'users', id: 216 }, [3]);
  expect(response.status).toHaveBeenCalledWith(400);
});
it.each([18, 15])('creates approved scoped role %s with history and audit, no badge/affiliate side effects or password response', async userTypeId => {
  scopeManagerToFoodTour();
  const response = res();
  await handleProductScopedManagement(req('POST', { username: 'FoodMember', firstName: 'Food', lastName: 'Member',
    email: 'member@example.test', password: 'test-only-password', userTypeId }), response, { resource: 'users' }, [3]);
  expect(response.status).toHaveBeenCalledWith(201);
  const created = (CommonModel.create as jest.Mock).mock.calls[0][0];
  expect(created).toMatchObject({ userTypeId, badgeRequired: false, status: true, approved: true, createdBy: 215 });
  expect(await bcrypt.compare('test-only-password', created.password)).toBe(true);
  expect((response.json as jest.Mock).mock.calls[0][0][0]).not.toHaveProperty('password');
  expect(applyUserTypeChange).toHaveBeenCalledWith(expect.objectContaining({ userId: 300, userTypeId, actorId: 215 }));
  expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'product_scope.user_created' }), expect.anything());
  expect(JSON.stringify((AuditLog.create as jest.Mock).mock.calls)).not.toContain('test-only-password');
});
it('does not allow changing one’s own role or approval status', async () => {
  const response = res();
  await handleProductScopedManagement(req('PUT', { userTypeId: 18 }), response, { resource: 'users', id: 215 }, [3]);
  expect(response.status).toHaveBeenCalledWith(403);
});
it('rejects an attempt to move an owned price to a different product scope', async () => {
  const response = res();
  await handleProductScopedManagement(req('PUT', { productId: 1 }), response, { resource: 'productPrices', id: 4 }, [3]);
  expect(response.status).toHaveBeenCalledWith(403);
  expect(ProductPrice.create).not.toHaveBeenCalled();
});
it('cannot update a price that is absent from the scoped query', async () => {
  const response = res();
  await handleProductScopedManagement(req('PUT', { price: 25 }), response, { resource: 'productPrices', id: 4 }, [3]);
  expect(response.status).toHaveBeenCalledWith(404);
  expect(ProductPrice.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 4, productId: { [Op.in]: [48] } } }));
});
