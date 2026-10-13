import express, { type RequestHandler, type Response } from 'express';
import request from 'supertest';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';

jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: ((req: AuthenticatedRequest, res: Response, next: () => void) => {
    const roleSlug = req.header('x-test-role');
    if (!roleSlug) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.authContext = {
      id: 91,
      userTypeId: 6,
      roleSlug,
    };
    next();
  }) as RequestHandler,
}));

jest.mock('../../services/promotionTrackingService.js', () => ({
  __esModule: true,
  listPromotionRoutePlans: jest.fn(),
  listPublishedPromotionRoutePlans: jest.fn(),
}));

import {
  listPromotionRoutePlans,
  listPublishedPromotionRoutePlans,
} from '../../services/promotionTrackingService.js';
import promotionTrackingRoutes from '../promotionTrackingRoutes.js';
import promotionTrackingTestRoutes from '../promotionTrackingTestRoutes.js';
import { MANAGER_ROLES } from '../schedulingRoles.js';

const listPromotionRoutePlansMock = listPromotionRoutePlans as jest.Mock;
const listPublishedPromotionRoutePlansMock = listPublishedPromotionRoutePlans as jest.Mock;

const catalogWithMixedVersionStatuses = {
  defaultHostels: ['Atlantis Hostel'],
  routePlans: [
    {
      routePlanId: '7',
      name: 'Main Promotion Route',
      description: 'Saved route',
      status: 'active',
      routeVersions: [
        { routeVersionId: '73', routeName: 'Draft route', status: 'draft' },
        { routeVersionId: '72', routeName: 'Published route', status: 'published' },
        { routeVersionId: '71', routeName: 'Retired route', status: 'retired' },
      ],
      createdAtUtc: '2026-09-01T08:00:00.000Z',
      updatedAtUtc: '2026-09-02T08:00:00.000Z',
    },
    {
      routePlanId: '8',
      name: 'Unpublished Route',
      description: 'Must not be exposed',
      status: 'active',
      routeVersions: [
        { routeVersionId: '81', routeName: 'Draft only', status: 'draft' },
      ],
      createdAtUtc: '2026-09-03T08:00:00.000Z',
      updatedAtUtc: '2026-09-03T08:00:00.000Z',
    },
  ],
};

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/promotion-tracking/test', promotionTrackingTestRoutes);
  app.use('/api/promotion-tracking', promotionTrackingRoutes);
  return app;
};

const originalRuntimeMode = process.env.APP_RUNTIME_MODE;

describe('promotion tracking dry-run saved-route catalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.APP_RUNTIME_MODE = 'dry-run';
    listPublishedPromotionRoutePlansMock.mockResolvedValue(catalogWithMixedVersionStatuses);
    listPromotionRoutePlansMock.mockResolvedValue(catalogWithMixedVersionStatuses);
  });

  afterAll(() => {
    if (originalRuntimeMode === undefined) {
      delete process.env.APP_RUNTIME_MODE;
    } else {
      process.env.APP_RUNTIME_MODE = originalRuntimeMode;
    }
  });

  it.each([...MANAGER_ROLES, 'promotion-service'])(
    'allows the authenticated %s role in dry-run mode',
    async (roleSlug) => {
      const response = await request(buildApp())
        .get('/api/promotion-tracking/test/route-plans')
        .set('x-test-role', roleSlug);

      expect(response.status).toBe(200);
    },
  );

  it('returns only the minimal plan fields and published versions from non-empty plans', async () => {
    const response = await request(buildApp())
      .get('/api/promotion-tracking/test/route-plans')
      .set('x-test-role', 'promotion-service');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      routePlans: [
        {
          routePlanId: '7',
          name: 'Main Promotion Route',
          routeVersions: [
            {
              routeVersionId: '72',
              routeName: 'Published route',
              status: 'published',
            },
          ],
        },
      ],
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers.vary).toContain('Authorization');
    expect(listPublishedPromotionRoutePlansMock).toHaveBeenCalledTimes(1);
  });

  it('supports authenticated HEAD checks without exposing a response body', async () => {
    const response = await request(buildApp())
      .head('/api/promotion-tracking/test/route-plans')
      .set('x-test-role', 'promotion-service');

    expect(response.status).toBe(200);
    expect(response.text).toBeUndefined();
    expect(listPublishedPromotionRoutePlansMock).toHaveBeenCalledTimes(1);
  });

  it('returns a generic failure without exposing backend error details', async () => {
    listPublishedPromotionRoutePlansMock.mockRejectedValueOnce(
      new Error('database password and query details'),
    );

    const response = await request(buildApp())
      .get('/api/promotion-tracking/test/route-plans')
      .set('x-test-role', 'promotion-service');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Unable to load saved promotion routes.' });
    expect(JSON.stringify(response.body)).not.toContain('password');
  });

  it('requires authentication before serving the dry-run catalog', async () => {
    const response = await request(buildApp())
      .get('/api/promotion-tracking/test/route-plans');

    expect(response.status).toBe(401);
    expect(listPublishedPromotionRoutePlansMock).not.toHaveBeenCalled();
  });

  it('authenticates before returning method-policy details in dry-run', async () => {
    const response = await request(buildApp())
      .post('/api/promotion-tracking/test/route-plans')
      .send({});

    expect(response.status).toBe(401);
    expect(response.headers.allow).toBeUndefined();
    expect(listPublishedPromotionRoutePlansMock).not.toHaveBeenCalled();
  });

  it('rejects roles outside promotion-service and the existing manager role set', async () => {
    const response = await request(buildApp())
      .get('/api/promotion-tracking/test/route-plans')
      .set('x-test-role', 'guide');

    expect(response.status).toBe(403);
    expect(response.body).toEqual([{ message: 'Forbidden' }]);
    expect(listPublishedPromotionRoutePlansMock).not.toHaveBeenCalled();
  });

  it.each(['primary', 'deployment-candidate', 'invalid'])(
    'is concealed when APP_RUNTIME_MODE is %s',
    async (runtimeMode) => {
      process.env.APP_RUNTIME_MODE = runtimeMode;

      const response = await request(buildApp())
        .get('/api/promotion-tracking/test/route-plans')
        .set('x-test-role', 'promotion-service');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Not found.' });
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(listPublishedPromotionRoutePlansMock).not.toHaveBeenCalled();
    },
  );

  it('is concealed when APP_RUNTIME_MODE is absent', async () => {
    delete process.env.APP_RUNTIME_MODE;

    const response = await request(buildApp())
      .get('/api/promotion-tracking/test/route-plans')
      .set('x-test-role', 'promotion-service');

    expect(response.status).toBe(404);
    expect(listPublishedPromotionRoutePlansMock).not.toHaveBeenCalled();
  });

  it('rejects test-catalog write methods with an explicit read-only method policy', async () => {
    const response = await request(buildApp())
      .post('/api/promotion-tracking/test/route-plans')
      .set('x-test-role', 'promotion-service')
      .send({});

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('GET, HEAD');
    expect(response.body).toEqual({ error: 'Method not allowed.' });
    expect(listPublishedPromotionRoutePlansMock).not.toHaveBeenCalled();
  });

  it('conceals unsupported methods before applying the method policy outside dry-run', async () => {
    process.env.APP_RUNTIME_MODE = 'primary';

    const response = await request(buildApp())
      .delete('/api/promotion-tracking/test/route-plans')
      .set('x-test-role', 'promotion-service');

    expect(response.status).toBe(404);
    expect(response.headers.allow).toBeUndefined();
    expect(listPublishedPromotionRoutePlansMock).not.toHaveBeenCalled();
  });

  it('does not broaden the existing manager catalog to promotion-service', async () => {
    const response = await request(buildApp())
      .get('/api/promotion-tracking/manager/route-plans')
      .set('x-test-role', 'promotion-service');

    expect(response.status).toBe(403);
    expect(listPromotionRoutePlansMock).not.toHaveBeenCalled();
  });
});
