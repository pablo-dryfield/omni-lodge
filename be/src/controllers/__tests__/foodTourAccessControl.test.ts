jest.mock('../../__mocks__/sequelizeModelStub.ts', () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn() } }));
jest.mock('../../models/Page.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/RolePagePermission.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../services/productScopeService.js', () => ({ getAllowedProductTypeIds: jest.fn() }));
jest.mock('../../services/foodTourRolePolicy.js', () => ({ isFoodTourOwner: jest.fn() }));
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import Common from '../../__mocks__/sequelizeModelStub';
import Page from '../../models/Page';
import RolePagePermission from '../../models/RolePagePermission';
import { getAllowedProductTypeIds } from '../../services/productScopeService';
import { isFoodTourOwner } from '../../services/foodTourRolePolicy';
import { getCurrentUserAccess } from '../accessControlController';

beforeEach(() => {
  jest.clearAllMocks();
  (getAllowedProductTypeIds as jest.Mock).mockResolvedValue([3]);
  (isFoodTourOwner as jest.Mock).mockResolvedValue(true);
  (Page.findAll as jest.Mock).mockResolvedValue([{ id: 1, slug: 'settings-users' }, { id: 2, slug: 'settings-user-types' }, { id: 3, slug: 'settings-permissions' }]);
  (RolePagePermission.findAll as jest.Mock).mockResolvedValue([1, 2, 3].map(pageId => ({ pageId, status: true, canView: true })));
  (Common.findAll as jest.Mock).mockImplementation(async options => options?.where
    ? [1, 2].map(actionId => ({ moduleId: 1, actionId, allowed: true, status: true }))
    : [{ id: 1, slug: 'user-directory', key: 'view' }, { id: 2, slug: 'settings-user-types-admin', key: 'create' }]);
});
async function load(roleSlug: string) {
  const req = { authContext: { id: 215, userTypeId: 16, roleSlug } } as AuthenticatedRequest;
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis(), setHeader: jest.fn() } as unknown as Response;
  await getCurrentUserAccess(req, res);
  return (res.json as jest.Mock).mock.calls[0][0];
}
it('shows the restricted role screen to a verified Food Tour Owner but never global permissions', async () => {
  const payload = await load('food-tour-owner');
  expect(payload.pages).toContain('settings-user-types');
  expect(payload.pages).not.toContain('settings-permissions');
  expect(payload.modules).not.toHaveProperty('settings-user-types-admin');
});
it('does not show the role screen to managers even if their raw page permission grants it', async () => {
  expect((await load('food-tour-manager')).pages).not.toContain('settings-user-types');
});
it('does not use a stale session owner slug as authorization', async () => {
  (isFoodTourOwner as jest.Mock).mockResolvedValue(false);
  expect((await load('food-tour-owner')).pages).not.toContain('settings-user-types');
});
it('keeps metadata editing available to an owner with update/view but not create permission', async () => {
  (Common.findAll as jest.Mock).mockImplementation(async options => options?.where
    ? [1, 2].map(actionId => ({ moduleId: 1, actionId, allowed: true, status: true }))
    : [{ id: 1, slug: 'user-directory', key: 'view' }, { id: 2, slug: 'settings-user-types-admin', key: 'update' }]);
  const payload = await load('food-tour-owner');
  expect(payload.pages).toContain('settings-user-types');
  expect(payload.modules['user-directory']).toEqual(['view', 'update']);
});
