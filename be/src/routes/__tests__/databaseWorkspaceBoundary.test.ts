import express from 'express';
import request from 'supertest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: async (
    req: AuthenticatedRequest,
    res: Response,
    next: () => void,
  ) => {
    const role = req.header('x-test-role');
    if (!role) {
      res.sendStatus(401);
      return;
    }
    req.authContext = {
      id: 7,
      userTypeId: 2,
      roleSlug: role,
    } as AuthenticatedRequest['authContext'];
    if (req.header('x-test-scoped')) req.productTypeScope = [3];
    next();
  },
}));
jest.mock('../../middleware/authorizationMiddleware.js', () => ({
  ...jest.requireActual('../../middleware/authorizationMiddleware.js'),
  hasModuleActionPermission: jest.fn(async () => true),
}));
jest.mock('../../models/RolePagePermission.js', () => ({
  __esModule: true,
  default: { count: jest.fn(async () => 1) },
}));
jest.mock('../../models/ModuleAction.js', () => ({
  __esModule: true,
  default: { count: jest.fn(async () => 1) },
}));
jest.mock('../../models/Page.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/databaseWorkspace/config.js', () => ({
  workspaceConfiguration: jest.fn(),
}));
jest.mock(
  '../../controllers/databaseWorkspaceController.js',
  () =>
    new Proxy(
      { __esModule: true },
      {
        get: (target, key) =>
          key === '__esModule'
            ? true
            : (_req: unknown, res: Response) =>
                res.status(501).json({ handlerReached: true }),
      },
    ),
);
jest.mock(
  '../../controllers/databaseWorkspaceSessionController.js',
  () =>
    new Proxy(
      { __esModule: true },
      {
        get: (target, key) =>
          key === '__esModule'
            ? true
            : (_req: unknown, res: Response) =>
                res.status(501).json({ handlerReached: true }),
      },
    ),
);
jest.mock(
  '../../controllers/databaseWorkspaceMonitorController.js',
  () =>
    new Proxy(
      { __esModule: true },
      {
        get: (target, key) =>
          key === '__esModule'
            ? true
            : (_req: unknown, res: Response) =>
                res.status(501).json({ handlerReached: true }),
      },
    ),
);
jest.mock(
  '../../controllers/databaseWorkspaceImportController.js',
  () =>
    new Proxy(
      { __esModule: true },
      {
        get: (target, key) =>
          key === '__esModule'
            ? true
            : (_req: unknown, res: Response) =>
                res.status(501).json({ handlerReached: true }),
      },
    ),
);
jest.mock(
  '../../controllers/databaseWorkspaceAdminController.js',
  () =>
    new Proxy(
      { __esModule: true },
      {
        get: (target, key) =>
          key === '__esModule'
            ? true
            : (_req: unknown, res: Response) =>
                res.status(501).json({ handlerReached: true }),
      },
    ),
);
jest.mock(
  '../../controllers/databaseWorkspaceExportController.js',
  () =>
    new Proxy(
      { __esModule: true },
      {
        get: (target, key) =>
          key === '__esModule'
            ? true
            : (_req: unknown, res: Response) =>
                res.status(501).json({ handlerReached: true }),
      },
    ),
);
jest.mock(
  '../../controllers/databaseWorkspaceScheduleController.js',
  () =>
    new Proxy(
      { __esModule: true },
      {
        get: (target, key) =>
          key === '__esModule'
            ? true
            : (_req: unknown, res: Response) =>
                res.status(501).json({ handlerReached: true }),
      },
    ),
);
jest.mock(
  '../../controllers/databaseWorkspaceRecoveryController.js',
  () =>
    new Proxy(
      { __esModule: true },
      {
        get: (target, key) =>
          key === '__esModule'
            ? true
            : (_req: unknown, res: Response) =>
                res.status(501).json({ handlerReached: true }),
      },
    ),
);
import router from '../databaseWorkspaceRoutes';
import RolePagePermission from '../../models/RolePagePermission';
const app = express();
app.use(express.json());
app.use('/workspace', router);
const endpoints = (
  router.stack as Array<{
    route?: { path: string; methods: Record<string, boolean> };
  }>
).flatMap((layer) =>
  layer.route
    ? Object.keys(layer.route.methods).map((method) => [
        method,
        layer.route!.path.replace(
          /:[a-zA-Z]+/g,
          '00000000-0000-4000-8000-000000000001',
        ),
      ])
    : [],
);
beforeEach(() => {
  jest.clearAllMocks();
  (RolePagePermission.count as jest.Mock).mockResolvedValue(1);
});
it.each(endpoints)(
  '%s %s rejects anonymous, business roles, scoped admins and revoked workspace access before its handler',
  async (method, path) => {
    const call = () => request(app)[method as 'get']('/workspace' + path);
    expect((await call()).status).toBe(401);
    for (const role of [
      'user',
      'guide',
      'assistant-manager',
      'manager',
      'owner',
      'food-tour-owner',
    ])
      expect((await call().set('x-test-role', role)).status).toBe(403);
    expect(
      (await call().set('x-test-role', 'admin').set('x-test-scoped', 'yes'))
        .status,
    ).toBe(403);
    (RolePagePermission.count as jest.Mock).mockResolvedValue(0);
    expect((await call().set('x-test-role', 'admin')).status).toBe(403);
  },
);
it('allows an eligible global administrator to reach the routed handler', async () => {
  expect(endpoints.length).toBeGreaterThan(35);
  expect(
    (
      await request(app)
        .get('/workspace/capabilities')
        .set('x-test-role', 'Administrator')
    ).status,
  ).toBe(501);
});
