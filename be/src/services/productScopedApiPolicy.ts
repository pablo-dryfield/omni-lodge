// A product-restricted account cannot opt into a company-wide endpoint by
// adding a menu permission or crafting a request. New endpoints are denied
// until their server-side isolation has been reviewed.
export const PRODUCT_SCOPED_PAGES = new Set([
  'dashboard', 'bookings', 'bookings-manifest', 'settings', 'settings-users', 'settings-products',
  'settings-product-prices', 'settings-product-addons', 'finance',
]);
export const PRODUCT_SCOPED_MODULES = new Set([
  'booking-management', 'booking-manifest', 'user-directory', 'product-catalog',
  'product-price-management', 'product-addon-management', 'finance-reports',
]);

export type ScopedApiRoute = { resource: string; module?: string; id?: number; passthrough?: boolean; action?: string };
export function productScopedApiRoute(method: string, path: string): ScopedApiRoute | null {
  const read = method === 'GET';
  if ((read && /^\/api\/bookings\/emails\/(?:mailbox|(?:gmail\/)?[^/]+\/preview)$/.test(path)) ||
    (method === 'POST' && /^\/api\/bookings\/emails\/(?:send|render-preview|[^/]+\/reprocess)$/.test(path))) {
    return { resource: 'booking-email', module: 'booking-management', passthrough: true,
      action: read || path.endsWith('/render-preview') ? 'view' : path.endsWith('/reprocess') ? 'update' : 'create' };
  }
  if ((path === '/api/email-templates' && ['GET', 'POST'].includes(method)) ||
    (method === 'PATCH' && /^\/api\/email-templates\/[1-9]\d*$/.test(path))) {
    return { resource: 'email-templates', module: 'booking-management', passthrough: true,
      action: read ? 'view' : method === 'POST' ? 'create' : 'update' };
  }
  // Self-service onboarding is not company administration. The controller
  // checks the action's type, active window and authenticated-user audience.
  const profileAction = method === 'POST'
    ? /^\/api\/required-actions\/actions\/([1-9]\d*)\/(?:profile-fields|prompted)$/.exec(path)
    : null;
  if (profileAction) {
    const id = Number(profileAction[1]);
    return Number.isSafeInteger(id) ? { resource: 'profile-requirement', id, passthrough: true } : null;
  }
  if (read && path === '/api/reports/home-preferences') return { resource: 'home' };
  if (read && ['/api/session', '/api/session/profile-photo', '/api/accessControl/me',
    '/api/required-actions/me', '/api/notifications', '/api/currencies/options'].includes(path)) {
    return { resource: 'personal', passthrough: true };
  }
  if (method === 'POST' && path === '/api/notifications/read-all') return { resource: 'personal', passthrough: true };
  if (read && path === '/api/finance/reports') return { resource: 'finance', module: 'finance-reports' };
  if (['POST', 'DELETE'].includes(method) && /^\/api\/products\/[1-9]\d*\/media$/.test(path)) {
    return { resource: 'product-media', module: 'product-catalog', passthrough: true, action: 'update' };
  }
  if (read && (path === '/api/bookings' || path === '/api/bookings/manifest' || /^\/api\/bookings\/[1-9]\d*\/details$/.test(path))) {
    return { resource: 'bookings', module: 'booking-management', passthrough: true };
  }
  const match = /^\/api\/(users|userTypes|productTypes|products|productPrices|productAddons|addons)(?:\/([1-9]\d*|active))?$/.exec(path);
  if (!match) return null;
  const resource = match[1];
  const suffix = match[2];
  const id = suffix && suffix !== 'active' ? Number(suffix) : undefined;
  if (id !== undefined && !Number.isSafeInteger(id)) return null;
  const modules: Record<string, string> = {
    users: 'user-directory', products: 'product-catalog', productPrices: 'product-price-management',
    productAddons: 'product-addon-management', addons: 'product-addon-management',
  };
  if (resource === 'users' && !['GET', 'POST', 'PUT'].includes(method)) return null; // Deactivate; never destroy history.
  if (resource === 'userTypes' && !read && !((method === 'POST' && !suffix) || (method === 'PUT' && id !== undefined))) return null;
  if (['productTypes', 'addons'].includes(resource) && !read) return null;
  if (suffix === 'active' && (!read || !['users', 'products'].includes(resource))) return null;
  if (!read && !['POST', 'PUT', 'DELETE'].includes(method)) return null;
  if (!read && ((method === 'POST' && id !== undefined) || (method !== 'POST' && id === undefined))) return null;
  if (resource === 'userTypes' && !read) return { resource, module: 'user-directory', action: method === 'POST' ? 'create' : 'update', ...(id ? { id } : {}) };
  return { resource, module: modules[resource], id, passthrough: resource === 'products' };
}

/** Empty/unassigned and shared roles never qualify for delegated management. */
export const isExclusiveProductScope = (candidate: number[], allowed: number[]): boolean =>
  candidate.length > 0 && candidate.every(id => allowed.includes(id));
