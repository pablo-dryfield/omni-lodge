import { Router, type Router as ExpressRouter } from 'express';
import {
  APPLICATION_RUNTIME_MODES,
  resolveApplicationRuntimeMode,
} from '../config/applicationRuntimeMode.js';
import {
  isPromotionTrackingServerEnabled,
  PROMOTION_TRACKING_DISABLED_CODE,
} from '../config/promotionTrackingFeature.js';

export {
  isPromotionTrackingServerEnabled,
  PROMOTION_TRACKING_DISABLED_CODE,
};

type PromotionTrackingRouteModule = {
  default: ExpressRouter;
};

export const canLoadPromotionTrackingLiveRoutes = (env: NodeJS.ProcessEnv): boolean => {
  try {
    return resolveApplicationRuntimeMode(env.APP_RUNTIME_MODE)
      !== APPLICATION_RUNTIME_MODES.dryRun;
  } catch {
    return false;
  }
};

type PromotionTrackingFeatureGateOptions = {
  env?: NodeJS.ProcessEnv;
  loadRoutes?: () => Promise<PromotionTrackingRouteModule>;
};

export const createPromotionTrackingFeatureGate = ({
  env = process.env,
  loadRoutes = () => import('./promotionTrackingRoutes.js'),
}: PromotionTrackingFeatureGateOptions = {}): ExpressRouter => {
  const router = Router();
  let loadedRoutes: Promise<ExpressRouter> | null = null;

  const routes = async (): Promise<ExpressRouter> => {
    loadedRoutes ??= loadRoutes().then((module) => module.default);
    return loadedRoutes;
  };

  router.use(async (req, res, next) => {
    if (!canLoadPromotionTrackingLiveRoutes(env) || !isPromotionTrackingServerEnabled(env)) {
      res.status(503).json({
        error: 'Promotion tracking is not enabled on this server.',
        code: PROMOTION_TRACKING_DISABLED_CODE,
      });
      return;
    }

    try {
      const promotionRoutes = await routes();
      promotionRoutes(req, res, next);
    } catch (error) {
      next(error);
    }
  });

  return router;
};

export default createPromotionTrackingFeatureGate;
