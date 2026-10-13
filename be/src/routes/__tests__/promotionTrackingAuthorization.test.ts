import express, { type RequestHandler, type Response } from 'express';
import request from 'supertest';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';

const MODULE_SLUG = 'scheduling-promotion-routes';

jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: ((req: AuthenticatedRequest, _res: Response, next: () => void) => {
    const roleSlug = req.header('x-test-role') ?? 'manager';
    const actions = (req.header('x-test-actions') ?? '')
      .split(',')
      .map((action) => action.trim())
      .filter(Boolean);

    req.authContext = {
      id: 91,
      userTypeId: 6,
      roleSlug,
    };
    req.permissionCache = new Map([
      [MODULE_SLUG, new Set(actions)],
    ]);
    next();
  }) as RequestHandler,
}));

jest.mock('../../services/promotionTrackingService.js', () => ({
  __esModule: true,
  abortPromotionSession: jest.fn(),
  acceptPromotionCheckpoint: jest.fn(),
  assignPromotionRouteToShift: jest.fn(),
  createPromotionManagerOverride: jest.fn(),
  createPromotionRoutePlan: jest.fn(),
  createPromotionRouteVersion: jest.fn(),
  createPromotionTeamChallenge: jest.fn(),
  finishPromotionSession: jest.fn(),
  getPromotionSessionPlayback: jest.fn(),
  getPromotionToday: jest.fn(),
  listPromotionLiveSessions: jest.fn(),
  listPromotionManagerSessions: jest.fn(),
  listPromotionRoutePlans: jest.fn(),
  listPromotionTeamAssignments: jest.fn(),
  openPromotionTeamMemberProfilePhoto: jest.fn(),
  publishPromotionRouteVersion: jest.fn(),
  respondToPromotionTeamChallenge: jest.fn(),
  startPromotionSession: jest.fn(),
  uploadPromotionGroupSelfieEvidence: jest.fn(),
  uploadPromotionLocationSamples: jest.fn(),
}));

import {
  assignPromotionRouteToShift,
  createPromotionManagerOverride,
  createPromotionRoutePlan,
  createPromotionRouteVersion,
  getPromotionSessionPlayback,
  listPromotionLiveSessions,
  listPromotionManagerSessions,
  listPromotionRoutePlans,
  listPromotionTeamAssignments,
  publishPromotionRouteVersion,
} from '../../services/promotionTrackingService.js';
import promotionTrackingRoutes from '../promotionTrackingRoutes.js';

type ModuleAction = 'view' | 'create' | 'update';

type ManagerEndpoint = {
  label: string;
  method: 'get' | 'post';
  path: string;
  action: ModuleAction;
  status: number;
  service: jest.Mock;
};

const managerEndpoints: ManagerEndpoint[] = [
  {
    label: 'list route plans',
    method: 'get',
    path: '/api/promotion-tracking/manager/route-plans',
    action: 'view',
    status: 200,
    service: listPromotionRoutePlans as jest.Mock,
  },
  {
    label: 'create a route plan',
    method: 'post',
    path: '/api/promotion-tracking/manager/route-plans',
    action: 'create',
    status: 201,
    service: createPromotionRoutePlan as jest.Mock,
  },
  {
    label: 'create a route version',
    method: 'post',
    path: '/api/promotion-tracking/manager/route-plans/7/versions',
    action: 'create',
    status: 201,
    service: createPromotionRouteVersion as jest.Mock,
  },
  {
    label: 'publish a route version',
    method: 'post',
    path: '/api/promotion-tracking/manager/route-versions/72/publish',
    action: 'update',
    status: 200,
    service: publishPromotionRouteVersion as jest.Mock,
  },
  {
    label: 'create a team assignment',
    method: 'post',
    path: '/api/promotion-tracking/manager/team-assignments',
    action: 'create',
    status: 201,
    service: assignPromotionRouteToShift as jest.Mock,
  },
  {
    label: 'list team assignments',
    method: 'get',
    path: '/api/promotion-tracking/manager/team-assignments',
    action: 'view',
    status: 200,
    service: listPromotionTeamAssignments as jest.Mock,
  },
  {
    label: 'list live sessions',
    method: 'get',
    path: '/api/promotion-tracking/manager/live-sessions',
    action: 'view',
    status: 200,
    service: listPromotionLiveSessions as jest.Mock,
  },
  {
    label: 'list manager sessions',
    method: 'get',
    path: '/api/promotion-tracking/manager/sessions',
    action: 'view',
    status: 200,
    service: listPromotionManagerSessions as jest.Mock,
  },
  {
    label: 'view session playback',
    method: 'get',
    path: '/api/promotion-tracking/manager/sessions/81/playback',
    action: 'view',
    status: 200,
    service: getPromotionSessionPlayback as jest.Mock,
  },
  {
    label: 'create a manager override',
    method: 'post',
    path: '/api/promotion-tracking/manager/sessions/81/overrides',
    action: 'update',
    status: 201,
    service: createPromotionManagerOverride as jest.Mock,
  },
];

const mutationEndpoints = managerEndpoints.filter(({ method }) => method !== 'get');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/promotion-tracking', promotionTrackingRoutes);
  return app;
};

const callEndpoint = (
  endpoint: ManagerEndpoint,
  roleSlug: string,
  actions: readonly ModuleAction[],
) => {
  const pendingRequest = request(buildApp())[endpoint.method](endpoint.path)
    .set('x-test-role', roleSlug)
    .set('x-test-actions', actions.join(','));

  return endpoint.method === 'post' ? pendingRequest.send({}) : pendingRequest;
};

describe('promotion tracking manager route authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    managerEndpoints.forEach(({ service }) => {
      service.mockResolvedValue({ ok: true });
    });
  });

  it.each(managerEndpoints)(
    'allows an authorized manager to $label',
    async (endpoint) => {
      const response = await callEndpoint(endpoint, 'manager', [endpoint.action]);

      expect(response.status).toBe(endpoint.status);
      expect(response.body).toEqual({ ok: true });
      expect(endpoint.service).toHaveBeenCalledTimes(1);
    },
  );

  it.each(managerEndpoints)(
    'honors a revoked $action permission when a manager tries to $label',
    async (endpoint) => {
      const remainingActions = (['view', 'create', 'update'] as const)
        .filter((action) => action !== endpoint.action);
      const response = await callEndpoint(endpoint, 'manager', remainingActions);

      expect(response.status).toBe(403);
      expect(response.body).toEqual([{ message: 'Forbidden' }]);
      expect(endpoint.service).not.toHaveBeenCalled();
    },
  );

  it.each(mutationEndpoints)(
    'does not let a view-only assistant manager $label',
    async (endpoint) => {
      const response = await callEndpoint(endpoint, 'assistant-manager', ['view']);

      expect(response.status).toBe(403);
      expect(response.body).toEqual([{ message: 'Forbidden' }]);
      expect(endpoint.service).not.toHaveBeenCalled();
    },
  );

  it('lets a view-only assistant manager use manager read endpoints', async () => {
    const endpoint = managerEndpoints.find(({ label }) => label === 'list route plans');
    expect(endpoint).toBeDefined();

    const response = await callEndpoint(endpoint!, 'assistant-manager', ['view']);

    expect(response.status).toBe(200);
    expect(listPromotionRoutePlans).toHaveBeenCalledTimes(1);
  });

  it('keeps the manager role gate in addition to module-action permission checks', async () => {
    const endpoint = managerEndpoints.find(({ label }) => label === 'create a route plan');
    expect(endpoint).toBeDefined();

    const response = await callEndpoint(endpoint!, 'guide', ['create']);

    expect(response.status).toBe(403);
    expect(response.body).toEqual([{ message: 'Forbidden' }]);
    expect(createPromotionRoutePlan).not.toHaveBeenCalled();
  });
});
