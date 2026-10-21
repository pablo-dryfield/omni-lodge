jest.mock('../../services/productScopeService.js', () => ({ getAllowedProductTypeIds: jest.fn() }));
jest.mock('../authorizationMiddleware.js', () => ({ hasModuleActionPermission: jest.fn() }));
jest.mock('../../controllers/productScopedManagementController.js', () => ({ handleProductScopedManagement: jest.fn() }));
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { getAllowedProductTypeIds } from '../../services/productScopeService';
import { hasModuleActionPermission } from '../authorizationMiddleware';
import { handleProductScopedManagement } from '../../controllers/productScopedManagementController';
import { enforceProductScopedApiBoundary } from '../productScopedApiBoundary';

const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() } as unknown as Response);
beforeEach(() => { jest.clearAllMocks(); (getAllowedProductTypeIds as jest.Mock).mockResolvedValue([3]); (hasModuleActionPermission as jest.Mock).mockResolvedValue(true); });
it('keeps company-wide accounts on their existing routes', async () => {
  (getAllowedProductTypeIds as jest.Mock).mockResolvedValue(null);
  const next = jest.fn();
  await enforceProductScopedApiBoundary({} as AuthenticatedRequest, response(), next);
  expect(next).toHaveBeenCalledTimes(1);
});
it('fails closed when scope resolution fails', async () => {
  (getAllowedProductTypeIds as jest.Mock).mockRejectedValue(new Error('Database unavailable'));
  const res = response(), next = jest.fn();
  await enforceProductScopedApiBoundary({} as AuthenticatedRequest, res, next);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(next).not.toHaveBeenCalled();
});
it.each(['/api/config', '/api/reports/query', '/api/users/1/badge/send-to-print', '/api/finance/accounts'])('blocks crafted global request %s', async originalUrl => {
  const res = response(), next = jest.fn();
  await enforceProductScopedApiBoundary({ originalUrl, method: 'POST' } as AuthenticatedRequest, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
  expect(handleProductScopedManagement).not.toHaveBeenCalled();
});
it('requires an action permission as well as product scope', async () => {
  (hasModuleActionPermission as jest.Mock).mockResolvedValue(false);
  const res = response(), next = jest.fn();
  await enforceProductScopedApiBoundary({ originalUrl: '/api/users/215', method: 'PUT' } as AuthenticatedRequest, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(handleProductScopedManagement).not.toHaveBeenCalled();
});
it('routes approved management operations to the scoped handler, never a legacy controller', async () => {
  const req = { originalUrl: '/api/users/215?productTypeIds=1', method: 'PUT' } as AuthenticatedRequest;
  const res = response(), next = jest.fn();
  await enforceProductScopedApiBoundary(req, res, next);
  expect(handleProductScopedManagement).toHaveBeenCalledWith(req, res, expect.objectContaining({ resource: 'users', id: 215 }), [3]);
  expect(next).not.toHaveBeenCalled();
});
it('sends role creation through the isolated handler with user-directory create permission, never global role administration', async () => {
  const req = { originalUrl: '/api/userTypes', method: 'POST' } as AuthenticatedRequest;
  const res = response(), next = jest.fn();
  await enforceProductScopedApiBoundary(req, res, next);
  expect(hasModuleActionPermission).toHaveBeenCalledWith(req, 'user-directory', 'create');
  expect(handleProductScopedManagement).toHaveBeenCalledWith(req, res, { resource: 'userTypes', module: 'user-directory', action: 'create' }, [3]);
  expect(next).not.toHaveBeenCalled();
});
it('requires update permission and the isolated metadata handler for user type edits', async () => {
  const req = { originalUrl: '/api/userTypes/18', method: 'PUT' } as AuthenticatedRequest;
  const res = response(), next = jest.fn();
  await enforceProductScopedApiBoundary(req, res, next);
  expect(hasModuleActionPermission).toHaveBeenCalledWith(req, 'user-directory', 'update');
  expect(handleProductScopedManagement).toHaveBeenCalledWith(req, res, { resource: 'userTypes', module: 'user-directory', action: 'update', id: 18 }, [3]);
  expect(next).not.toHaveBeenCalled();
});
