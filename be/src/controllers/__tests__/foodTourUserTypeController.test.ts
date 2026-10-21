jest.mock('../../config/database.js', () => ({ __esModule: true, default: {
  transaction: jest.fn(async run => run({ LOCK: { UPDATE: 'UPDATE' } })),
} }));
jest.mock('../../__mocks__/sequelizeModelStub.ts', () => ({ __esModule: true, default: {
  findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn(), bulkCreate: jest.fn(),
} }));
jest.mock('../../models/UserTypeProductType.js', () => ({ __esModule: true, default: { findAll: jest.fn(), bulkCreate: jest.fn() } }));
jest.mock('../../models/ProductType.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn() } }));
jest.mock('../../models/Page.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/RolePagePermission.js', () => ({ __esModule: true, default: { findAll: jest.fn(), bulkCreate: jest.fn() } }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../services/staffEligibilityHistoryService.js', () => ({ applyUserTypeChange: jest.fn() }));
import { Op } from 'sequelize';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import Common from '../../__mocks__/sequelizeModelStub';
import Links from '../../models/UserTypeProductType';
import ProductType from '../../models/ProductType';
import Page from '../../models/Page';
import RolePagePermission from '../../models/RolePagePermission';
import AuditLog from '../../models/AuditLog';
import { createFoodTourUserType, updateFoodTourUserType } from '../foodTourUserTypeController';

const roleRow = (data: { id: number; slug: string; status: boolean; name?: string; description?: string | null }) => ({ ...data,
  get: jest.fn(() => ({ ...data })),
  update: jest.fn(async function(this: any, changes) { Object.assign(data, changes); Object.assign(this, changes); return this; }),
});
let roles: ReturnType<typeof roleRow>[];
const request = (body: object = {}) => ({ authContext: { id: 215, userTypeId: 16, roleSlug: 'food-tour-owner' },
  body: { name: 'Guide', description: 'Food Tour guides', sourceUserTypeId: 15, ...body } } as AuthenticatedRequest);
beforeEach(() => {
  jest.clearAllMocks();
  roles = [roleRow({ id: 16, slug: 'food-tour-owner', name: 'Food Tour Owner', status: true }),
    roleRow({ id: 15, slug: 'food-tour-manager', name: 'Food Tour Manager', status: true }),
    roleRow({ id: 18, slug: 'food-tour-owner-member', name: 'Food Tour Owner — Team member', description: 'Original description', status: true }),
    roleRow({ id: 25, slug: 'food-tour-shared', status: true }), roleRow({ id: 1, slug: 'owner', status: true })];
  const links = [{ userTypeId: 16, productTypeId: 3 }, { userTypeId: 15, productTypeId: 3 },
    { userTypeId: 18, productTypeId: 3 }, { userTypeId: 25, productTypeId: 3 }, { userTypeId: 25, productTypeId: 1 }];
  (Links.findAll as jest.Mock).mockImplementation(async options => options?.where ? links.filter(link => link.userTypeId === options.where.userTypeId) : links);
  (Common.findByPk as jest.Mock).mockImplementation(async id => roles.find(role => role.id === id));
  (ProductType.findByPk as jest.Mock).mockResolvedValue({ id: 3, name: 'Food Tour Krakow' });
  (ProductType.findAll as jest.Mock).mockResolvedValue([{ id: 3, name: 'Food Tour Krakow' }]);
  (Page.findAll as jest.Mock).mockResolvedValue([{ id: 100 }]);
  (Common.findAll as jest.Mock).mockImplementation(async options => {
    if (options.where.slug) return [{ id: 10 }]; // Allowed module catalog.
    if (options.where.allowed) return [{ userTypeId: 15, moduleId: 10, actionId: 1 }, { userTypeId: 15, moduleId: 99, actionId: 1 }]
      .filter(p => options.where.moduleId[Op.in].includes(p.moduleId));
    return roles.filter(role => options.where.id[Op.in].includes(role.id));
  });
  (RolePagePermission.findAll as jest.Mock).mockImplementation(async options => [{ pageId: 100 }, { pageId: 999 }]
    .filter(p => options.where.pageId[Op.in].includes(p.pageId)));
  (Common.create as jest.Mock).mockImplementation(async data => ({ id: 99, get: () => ({ ...data, id: 99 }) }));
});

it('creates a prefixed, active, non-default Food Tour-only type and copies only reviewed scoped access, with audit', async () => {
  expect(await createFoodTourUserType(request(), [3])).toMatchObject({ id: 99, name: 'Food Tour Guide', slug: 'food-tour-guide', productTypeIds: [3], isDefault: false });
  expect(Links.bulkCreate).toHaveBeenCalledWith([{ userTypeId: 99, productTypeId: 3 }], expect.objectContaining({ transaction: expect.anything() }));
  expect(Common.bulkCreate).toHaveBeenCalledWith([expect.objectContaining({ userTypeId: 99, moduleId: 10, actionId: 1 })], expect.anything());
  expect(RolePagePermission.bulkCreate).toHaveBeenCalledWith([expect.objectContaining({ userTypeId: 99, pageId: 100 })], expect.anything());
  expect(Page.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: { [Op.in]: expect.not.arrayContaining(['settings-permissions', 'settings-user-types']) } } }));
  expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'product_scope.user_type_created',
    metaJson: expect.objectContaining({ sourceUserTypeId: 15, productTypeIds: [3], pagesCopied: 1, moduleActionsCopied: 1 }) }), expect.anything());
});
it('does not duplicate an existing Food Tour prefix', async () => {
  expect(await createFoodTourUserType(request({ name: 'Food Tour Coordinator' }), [3])).toMatchObject({ name: 'Food Tour Coordinator', slug: 'food-tour-coordinator' });
});
it('validates description length against the database column before writing', async () => {
  await expect(createFoodTourUserType(request({ description: 'x'.repeat(256) }), [3])).rejects.toMatchObject({ status: 400 });
  expect(Common.create).not.toHaveBeenCalled();
});
it.each([[], [1], [1, 3], null])('rejects a global, wrong or shared requested scope %j', async productTypeIds => {
  await expect(createFoodTourUserType(request({ productTypeIds }), [3])).rejects.toMatchObject({ status: 403 });
  expect(Common.create).not.toHaveBeenCalled();
});
it.each([{ slug: 'owner' }, { isDefault: true }, { status: false }, { permissions: ['all'] }, { createdBy: 1 }])('rejects protected role fields %j', async body => {
  await expect(createFoodTourUserType(request(body), [3])).rejects.toMatchObject({ status: 400 });
  expect(Common.create).not.toHaveBeenCalled();
});
it.each([1, 25, 800])('rejects global, shared or missing template %s', async sourceUserTypeId => {
  await expect(createFoodTourUserType(request({ sourceUserTypeId }), [3])).rejects.toMatchObject({ status: 403 });
  expect(Common.create).not.toHaveBeenCalled();
});
it('rejects an inactive template', async () => {
  roles.find(role => role.id === 15)!.status = false;
  await expect(createFoodTourUserType(request(), [3])).rejects.toMatchObject({ status: 403 });
});
it('rejects a manager even with a stale owner slug in the session', async () => {
  const req = request(); req.authContext!.userTypeId = 15;
  await expect(createFoodTourUserType(req, [3])).rejects.toMatchObject({ status: 403 });
  expect(Common.create).not.toHaveBeenCalled();
});
it('fails closed when the actor scope changes before the transaction', async () => {
  (Links.findAll as jest.Mock).mockResolvedValue([{ userTypeId: 16, productTypeId: 1 }]);
  await expect(createFoodTourUserType(request(), [3])).rejects.toMatchObject({ status: 409 });
});
it('does not leave a successful audit or response when writing the product scope fails', async () => {
  (Links.bulkCreate as jest.Mock).mockRejectedValueOnce(new Error('Write failed'));
  await expect(createFoodTourUserType(request(), [3])).rejects.toThrow('Write failed');
  expect(AuditLog.create).not.toHaveBeenCalled();
});

describe('metadata edits', () => {
  const editRequest = (body: object) => ({ ...request(), body } as AuthenticatedRequest);
  it('renames the existing member to Food Tour Guide while preserving its ID, slug, users, scope and permissions', async () => {
    expect(await updateFoodTourUserType(editRequest({ name: 'Food Tour Guide', description: 'Tour guiding staff' }), [3], 18))
      .toMatchObject({ id: 18, slug: 'food-tour-owner-member', name: 'Food Tour Guide', description: 'Tour guiding staff', productTypeIds: [3] });
    expect(roles.find(role => role.id === 18)!.update).toHaveBeenCalledWith({ name: 'Food Tour Guide', description: 'Tour guiding staff', updatedBy: 215 }, expect.anything());
    expect(Links.bulkCreate).not.toHaveBeenCalled(); expect(Common.bulkCreate).not.toHaveBeenCalled();
    expect(RolePagePermission.bulkCreate).not.toHaveBeenCalled(); expect(Common.create).not.toHaveBeenCalled();
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'product_scope.user_type_updated', entityId: '18',
      metaJson: expect.objectContaining({ previous: { name: 'Food Tour Owner — Team member', description: 'Original description' }, next: { name: 'Food Tour Guide', description: 'Tour guiding staff' } }) }), expect.anything());
  });
  it('supports description-only edits and clearing descriptions without changing the name', async () => {
    expect(await updateFoodTourUserType(editRequest({ description: null }), [3], 18)).toMatchObject({ name: 'Food Tour Owner — Team member', description: null });
  });
  it('allows editing the owner display name without removing owner authority', async () => {
    expect(await updateFoodTourUserType(editRequest({ name: 'Food Tour Business Owner' }), [3], 16)).toMatchObject({ id: 16, slug: 'food-tour-owner', name: 'Food Tour Business Owner' });
  });
  it.each([{ slug: 'owner' }, { status: false }, { isDefault: true }, { productTypeIds: [1] }, { permissions: [] }, { sourceUserTypeId: 1 }, { updatedBy: 1 }, {}])('rejects edits to protected fields %j', async body => {
    await expect(updateFoodTourUserType(editRequest(body), [3], 18)).rejects.toMatchObject({ status: 400 });
    expect(roles.find(role => role.id === 18)!.update).not.toHaveBeenCalled();
  });
  it.each([1, 25, 999])('rejects global, shared or missing role %s', async id => {
    await expect(updateFoodTourUserType(editRequest({ name: 'Food Tour Guide' }), [3], id)).rejects.toMatchObject({ status: 404 });
  });
  it('rejects a manager with a stale owner slug', async () => {
    const req = editRequest({ name: 'Food Tour Guide' }); req.authContext!.userTypeId = 15;
    await expect(updateFoodTourUserType(req, [3], 18)).rejects.toMatchObject({ status: 403 });
  });
  it('rechecks actor scope before editing', async () => {
    (Links.findAll as jest.Mock).mockResolvedValue([{ userTypeId: 16, productTypeId: 1 }]);
    await expect(updateFoodTourUserType(editRequest({ name: 'Food Tour Guide' }), [3], 18)).rejects.toMatchObject({ status: 409 });
  });
});
