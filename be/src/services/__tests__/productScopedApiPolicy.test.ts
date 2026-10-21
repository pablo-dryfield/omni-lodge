import { isExclusiveProductScope, productScopedApiRoute } from '../productScopedApiPolicy';

it.each(['/api/config', '/api/sql-helper/execute', '/api/reports/query', '/api/roleModulePermissions',
  '/api/finance/accounts', '/api/finance/transactions', '/api/finance/files/1/download', '/api/channelNumbers/summary',
  '/api/db-backups', '/api/userTypes/16/permissions', '/api/users/1/badge/send-to-print', '/api/bookings/emails'])
('denies company-wide endpoint %s even if a menu permission was granted', path => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) expect(productScopedApiRoute(method, path)).toBeNull();
});
it('allows only reviewed routes and positive integer identifiers', () => {
  expect(productScopedApiRoute('GET', '/api/bookings/25/details')?.passthrough).toBe(true);
  expect(productScopedApiRoute('PUT', '/api/productPrices/2')).toMatchObject({ module: 'product-price-management', id: 2 });
  expect(productScopedApiRoute('GET', '/api/finance/reports')).toMatchObject({ module: 'finance-reports' });
  for (const path of ['/api/users/0', '/api/users/-1', '/api/users/1/anything', '/api/users/9007199254740992']) expect(productScopedApiRoute('GET', path)).toBeNull();
  expect(productScopedApiRoute('DELETE', '/api/users/25')).toBeNull();
  expect(productScopedApiRoute('POST', '/api/userTypes')).toEqual({ resource: 'userTypes', module: 'user-directory', action: 'create' });
  expect(productScopedApiRoute('PUT', '/api/userTypes/16')).toEqual({ resource: 'userTypes', module: 'user-directory', action: 'update', id: 16 });
  expect(productScopedApiRoute('PUT', '/api/userTypes')).toBeNull();
  expect(productScopedApiRoute('DELETE', '/api/userTypes/16')).toBeNull();
  expect(productScopedApiRoute('PUT', '/api/productTypes/3')).toBeNull();
});
it('does not treat global, unassigned, or partly shared roles as exclusively delegated', () => {
  expect(isExclusiveProductScope([], [3])).toBe(false);
  expect(isExclusiveProductScope([1, 3], [3])).toBe(false);
  expect(isExclusiveProductScope([3], [3])).toBe(true);
});
