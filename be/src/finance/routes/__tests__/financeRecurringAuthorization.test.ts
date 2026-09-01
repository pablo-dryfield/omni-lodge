import type { NextFunction, Request, Response } from 'express';

jest.mock('../../../middleware/authorizationMiddleware.js', () => ({
  authorizeModuleAction: jest.fn((moduleSlug: string, actionKey: string) => (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const permissions = new Set(
      String(req.header('x-test-permissions') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (!permissions.has(`${moduleSlug}:${actionKey}`)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    next();
  }),
  requireRoles: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

jest.mock('../../middleware/financeAccessMiddleware.js', () => ({
  financeAuthChain: [(_req: Request, _res: Response, next: NextFunction) => next()],
}));

jest.mock('../../controllers/accountController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn((_req, res) => res.status(204).send()) },
));
jest.mock('../../controllers/categoryController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn((_req, res) => res.status(204).send()) },
));
jest.mock('../../controllers/vendorController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn((_req, res) => res.status(204).send()) },
));
jest.mock('../../controllers/clientController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn((_req, res) => res.status(204).send()) },
));
jest.mock('../../controllers/transactionController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn((_req, res) => res.status(204).send()) },
));
jest.mock('../../controllers/recurringRuleController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn((_req, res) => res.status(204).send()) },
));
jest.mock('../../controllers/fileController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn((_req, res) => res.status(204).send()) },
));
jest.mock('../../controllers/managementRequestController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn((_req, res) => res.status(204).send()) },
));
jest.mock('../../controllers/budgetController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn((_req, res) => res.status(204).send()) },
));
jest.mock('../../controllers/reportController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn((_req, res) => res.status(204).send()) },
));
jest.mock('../../controllers/refundController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn((_req, res) => res.status(204).send()) },
));
jest.mock('../../controllers/compensationSettlementRuleController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn((_req, res) => res.status(204).send()) },
));
jest.mock('../../controllers/volunteerFundController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn((_req, res) => res.status(204).send()) },
));

import express from 'express';
import request from 'supertest';
import financeRoutes from '../financeRoutes';

const buildApp = () => {
  const app = express();
  app.use('/api/finance', financeRoutes);
  return app;
};

type RouteCase = {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string;
  permissions: string[];
};

const routeCases: RouteCase[] = [
  {
    method: 'get',
    path: '/api/finance/files/19/download',
    permissions: ['finance-transactions:view'],
  },
  { method: 'get', path: '/api/finance/transactions', permissions: ['finance-transactions:view'] },
  {
    method: 'get',
    path: '/api/finance/transactions/planned-expenses',
    permissions: ['finance-transactions:view'],
  },
  {
    method: 'post',
    path: '/api/finance/transactions/4/planned-expense-action',
    permissions: ['finance-transactions:update'],
  },
  { method: 'get', path: '/api/finance/transactions/4', permissions: ['finance-transactions:view'] },
  { method: 'post', path: '/api/finance/transactions', permissions: ['finance-transactions:create'] },
  { method: 'put', path: '/api/finance/transactions/4', permissions: ['finance-transactions:update'] },
  { method: 'delete', path: '/api/finance/transactions/4', permissions: ['finance-transactions:delete'] },
  { method: 'post', path: '/api/finance/transfers', permissions: ['finance-transactions:create'] },
  { method: 'get', path: '/api/finance/recurring-rules', permissions: ['finance-recurring:view'] },
  { method: 'get', path: '/api/finance/recurring-rules/bootstrap', permissions: ['finance-recurring:view'] },
  { method: 'get', path: '/api/finance/recurring-rules/4', permissions: ['finance-recurring:view'] },
  { method: 'post', path: '/api/finance/recurring-rules', permissions: ['finance-recurring:create'] },
  { method: 'put', path: '/api/finance/recurring-rules/4', permissions: ['finance-recurring:update'] },
  { method: 'delete', path: '/api/finance/recurring-rules/4', permissions: ['finance-recurring:delete'] },
  {
    method: 'post',
    path: '/api/finance/recurring-runs/execute',
    permissions: ['finance-recurring:update', 'finance-transactions:create'],
  },
  {
    method: 'get',
    path: '/api/finance/recurring-rules/4/occurrences',
    permissions: ['finance-recurring:view', 'finance-transactions:view'],
  },
  {
    method: 'post',
    path: '/api/finance/recurring-rules/4/occurrences/9/post',
    permissions: ['finance-recurring:update', 'finance-transactions:update'],
  },
  {
    method: 'post',
    path: '/api/finance/recurring-rules/4/occurrences/9/void',
    permissions: ['finance-recurring:update', 'finance-transactions:update'],
  },
];

describe('finance recurring route permissions', () => {
  it.each(routeCases)('$method $path requires its granular module actions', async ({
    method,
    path,
    permissions,
  }) => {
    const denied = await request(buildApp())[method](path);
    expect(denied.status).toBe(403);

    for (const missingPermission of permissions) {
      const partialPermissions = permissions.filter((permission) => permission !== missingPermission);
      const partial = await request(buildApp())[method](path)
        .set('x-test-permissions', partialPermissions.join(','));
      expect(partial.status).toBe(403);
    }

    const allowed = await request(buildApp())[method](path)
      .set('x-test-permissions', permissions.join(','));
    expect(allowed.status).toBe(204);
  });
});
