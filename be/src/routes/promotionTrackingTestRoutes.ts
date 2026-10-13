import { Router, type NextFunction, type Response } from 'express';
import {
  APPLICATION_RUNTIME_MODES,
  resolveApplicationRuntimeMode,
} from '../config/applicationRuntimeMode.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireRoles } from '../middleware/authorizationMiddleware.js';
import { listPublishedPromotionRoutePlans } from '../services/promotionTrackingService.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { MANAGER_ROLES } from './schedulingRoles.js';

const DRY_RUN_ROUTE_CATALOG_ROLES = [...MANAGER_ROLES, 'promotion-service'] as const;

export const isPromotionTrackingTestRuntime = (env: NodeJS.ProcessEnv): boolean => {
  try {
    return resolveApplicationRuntimeMode(env.APP_RUNTIME_MODE)
      === APPLICATION_RUNTIME_MODES.dryRun;
  } catch {
    return false;
  }
};

const createDryRunOnlyGate = (env: NodeJS.ProcessEnv) => (
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  if (!isPromotionTrackingTestRuntime(env)) {
    res.status(404).json({ error: 'Not found.' });
    return;
  }
  next();
};

export const createPromotionTrackingTestRoutes = ({
  env = process.env,
}: {
  env?: NodeJS.ProcessEnv;
} = {}) => {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Authorization');
    next();
  });

  router.all(
    '/route-plans',
    createDryRunOnlyGate(env),
    authMiddleware,
    requireRoles(DRY_RUN_ROUTE_CATALOG_ROLES),
    (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        res.status(405).json({ error: 'Method not allowed.' });
        return;
      }
      next();
    },
  );

  router.get(
    '/route-plans',
    async (_req: AuthenticatedRequest, res) => {
      try {
        const catalog = await listPublishedPromotionRoutePlans();
        res.json({
          routePlans: catalog.routePlans.flatMap((plan) => {
            const routeVersions = plan.routeVersions.filter(
              (version) => version.status === 'published',
            );
            return routeVersions.length > 0
              ? [{
                  routePlanId: plan.routePlanId,
                  name: plan.name,
                  routeVersions,
                }]
              : [];
          }),
        });
      } catch {
        res.status(500).json({ error: 'Unable to load saved promotion routes.' });
      }
    },
  );

  return router;
};

export default createPromotionTrackingTestRoutes();
