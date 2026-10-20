import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { getAllowedProductTypeIds } from '../services/productScopeService.js';
import { hasModuleActionPermission } from './authorizationMiddleware.js';
import { productScopedApiRoute } from '../services/productScopedApiPolicy.js';

export async function enforceProductScopedApiBoundary(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = await getAllowedProductTypeIds(req);
    if (scope === null) { next(); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');
    const route = productScopedApiRoute(req.method, path);
    if (!route) { res.status(403).json([{ message: 'Company-wide administration is unavailable to product-scoped accounts.' }]); return; }
    const action = route?.action ?? ({ GET: 'view', POST: 'create', PUT: 'update', DELETE: 'delete' } as Record<string, string>)[req.method];
    const bookingCatalogRead = req.method === 'GET' && ['products', 'productTypes'].includes(route.resource)
      && await hasModuleActionPermission(req, 'booking-management', 'view');
    if (route.module && !(await hasModuleActionPermission(req, route.module, action)) && !bookingCatalogRead) {
      res.status(403).json([{ message: 'Forbidden' }]); return;
    }
    // Catalog options used by a form also require access to that form.
    if (!route.module && ['userTypes', 'productTypes'].includes(route.resource)) {
      const module = route.resource === 'userTypes' ? 'user-directory' : 'product-catalog';
      if (!(await hasModuleActionPermission(req, module, 'view')) && !bookingCatalogRead) { res.status(403).json([{ message: 'Forbidden' }]); return; }
    }
    if (route.passthrough) {
      if (route.resource === 'products' && ['POST', 'PUT'].includes(req.method)) {
        const allowed = new Set(['name', 'productTypeId', 'price', 'status', 'storefrontConfig', 'images', 'imageUrl', 'requiresNightReportCostReconciliation', 'createdBy', 'updatedBy']);
        if (!req.body || Object.keys(req.body).some(key => !allowed.has(key))) {
          res.status(400).json([{ message: 'Invalid product settings fields' }]); return;
        }
        req.body.updatedBy = req.authContext!.id;
        if (req.method === 'POST') req.body.createdBy = req.authContext!.id;
        else delete req.body.createdBy;
      }
      next(); return;
    }
    // Lazy import avoids pulling management/report integrations into JWT setup.
    const { handleProductScopedManagement } = await import('../controllers/productScopedManagementController.js');
    await handleProductScopedManagement(req, res, route, scope);
  } catch {
    // Failure to resolve a scope is never treated as company-wide access.
    res.status(503).json([{ message: 'Unable to verify product-scoped access. Please retry.' }]);
  }
}
