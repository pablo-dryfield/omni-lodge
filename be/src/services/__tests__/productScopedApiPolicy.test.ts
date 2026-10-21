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
it('permits only POST cancellation with update permission, not other Direct actions or platforms', () => {
  expect(productScopedApiRoute('POST', '/api/bookings/10627/direct-actions/cancellation')).toEqual({
    resource: 'booking-cancellation', module: 'booking-management', id: 10627, passthrough: true, action: 'update',
  });
  for (const method of ['GET', 'PATCH', 'PUT', 'DELETE']) {
    expect(productScopedApiRoute(method, '/api/bookings/10627/direct-actions/cancellation')).toBeNull();
  }
  for (const suffix of ['confirmation', 'amend', 'partial-refund', 'cancellation/extra']) {
    expect(productScopedApiRoute('POST', `/api/bookings/10627/direct-actions/${suffix}`)).toBeNull();
  }
  for (const id of ['0', '-1', '1.5', '9007199254740992', 'other']) {
    expect(productScopedApiRoute('POST', `/api/bookings/${id}/direct-actions/cancellation`)).toBeNull();
  }
  for (const suffix of ['cancel-ecwid', 'cancel-xperience', 'cancel-civitatis']) {
    expect(productScopedApiRoute('POST', `/api/bookings/10627/${suffix}`)).toBeNull();
  }
});
it('does not treat global, unassigned, or partly shared roles as exclusively delegated', () => {
  expect(isExclusiveProductScope([], [3])).toBe(false);
  expect(isExclusiveProductScope([1, 3], [3])).toBe(false);
  expect(isExclusiveProductScope([3], [3])).toBe(true);
});
it('allows only the two reviewed self-profile onboarding writes, never generic completion or administration', () => {
  for (const suffix of ['profile-fields', 'prompted']) {
    expect(productScopedApiRoute('POST', `/api/required-actions/actions/42/${suffix}`))
      .toEqual({ resource: 'profile-requirement', id: 42, passthrough: true });
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      expect(productScopedApiRoute(method, `/api/required-actions/actions/42/${suffix}`)).toBeNull();
    }
    for (const id of ['0', '-1', '1.5', '9007199254740992', 'other']) {
      expect(productScopedApiRoute('POST', `/api/required-actions/actions/${id}/${suffix}`)).toBeNull();
    }
  }
  for (const path of ['/api/required-actions/actions', '/api/required-actions/actions/42/status',
    '/api/required-actions/actions/42/complete', '/api/required-actions/actions/42/profile-fields/extra']) {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) expect(productScopedApiRoute(method, path)).toBeNull();
  }
});
it('allows booking-bound email tools, but not bulk ingestion, backfills or global galleries', () => {
  expect(productScopedApiRoute('GET', '/api/bookings/emails/mailbox')).toMatchObject({ resource: 'booking-email', action: 'view' });
  expect(productScopedApiRoute('GET', '/api/bookings/emails/message/preview')).toMatchObject({ action: 'view' });
  expect(productScopedApiRoute('POST', '/api/bookings/emails/send')).toMatchObject({ action: 'create' });
  expect(productScopedApiRoute('POST', '/api/bookings/emails/message/reprocess')).toMatchObject({ action: 'update' });
  expect(productScopedApiRoute('PATCH', '/api/email-templates/4')).toMatchObject({ action: 'update' });
  for (const path of ['/api/bookings/emails/reprocess', '/api/bookings/emails/backfill', '/api/bookings/emails/template-gallery']) {
    expect(productScopedApiRoute('POST', path)).toBeNull();
    expect(productScopedApiRoute('GET', path)).toBeNull();
  }
});
