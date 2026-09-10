import express, { type RequestHandler, type Response } from 'express';
import request from 'supertest';

import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';

jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: ((req: AuthenticatedRequest, res: Response, next: () => void) => {
    const roleSlug = req.header('x-test-role');
    if (!roleSlug) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    req.authContext = { id: 9, userTypeId: 2, roleSlug };
    next();
  }) as RequestHandler,
}));

jest.mock('../../middleware/authorizationMiddleware.js', () => ({
  authorizeModuleAction: (moduleSlug: string, actionKey: string) => (
    req: AuthenticatedRequest,
    res: Response,
    next: () => void,
  ) => {
    const permissions = new Set(String(req.header('x-test-permissions') ?? '').split(','));
    if (!permissions.has(`${moduleSlug}:${actionKey}`)) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }
    next();
  },
  requireRoles: (roles: readonly string[]) => (
    req: AuthenticatedRequest,
    res: Response,
    next: () => void,
  ) => {
    const normalized = req.authContext?.roleSlug === 'administrator'
      ? 'admin'
      : req.authContext?.roleSlug;
    if (!normalized || !roles.includes(normalized)) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }
    next();
  },
}));

jest.mock('../../controllers/errorMonitoringController.js', () => {
  const respond = jest.fn((_req: AuthenticatedRequest, res: Response) => res.status(204).send());
  return {
    addIssueNote: jest.fn(respond),
    deleteIssueNote: jest.fn(respond),
    getIssue: jest.fn(respond),
    getSummary: jest.fn(respond),
    listIssues: jest.fn(respond),
    patchIssue: jest.fn(respond),
    runCleanup: jest.fn(respond),
  };
});

import {
  addIssueNote,
  deleteIssueNote,
  getIssue,
  getSummary,
  listIssues,
  patchIssue,
  runCleanup,
} from '../../controllers/errorMonitoringController.js';
import errorMonitoringRoutes from '../errorMonitoringRoutes.js';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/error-monitoring', errorMonitoringRoutes);
  return app;
};

describe('error-monitoring dashboard authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires both an administrative role and the dedicated module permission', async () => {
    const app = buildApp();
    const unauthenticated = await request(app).get('/api/error-monitoring/summary');
    const manager = await request(app)
      .get('/api/error-monitoring/summary')
      .set('x-test-role', 'manager')
      .set('x-test-permissions', 'error-monitoring-dashboard:view');
    const noPermission = await request(app)
      .get('/api/error-monitoring/summary')
      .set('x-test-role', 'admin');

    expect([unauthenticated.status, manager.status, noPermission.status]).toEqual([401, 403, 403]);
    expect(getSummary).not.toHaveBeenCalled();
  });

  it.each([
    ['get', '/api/error-monitoring/summary', 'view', getSummary],
    ['get', '/api/error-monitoring/issues', 'view', listIssues],
    ['get', '/api/error-monitoring/issues/7', 'view', getIssue],
    ['patch', '/api/error-monitoring/issues/7', 'update', patchIssue],
    ['patch', '/api/error-monitoring/issues/7/status', 'update', patchIssue],
    ['post', '/api/error-monitoring/issues/7/notes', 'update', addIssueNote],
    ['delete', '/api/error-monitoring/issues/7/notes/4', 'update', deleteIssueNote],
    ['post', '/api/error-monitoring/cleanup', 'update', runCleanup],
  ] as const)('requires %s permission for %s', async (method, path, action, controller) => {
    const app = buildApp();
    const wrongAction = action === 'view' ? 'update' : 'view';
    const denied = await request(app)[method](path)
      .set('x-test-role', 'admin')
      .set('x-test-permissions', `error-monitoring-dashboard:${wrongAction}`);
    const allowed = await request(app)[method](path)
      .set('x-test-role', 'administrator')
      .set('x-test-permissions', `error-monitoring-dashboard:${action}`);

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(204);
    expect(controller).toHaveBeenCalledTimes(1);
  });
});
