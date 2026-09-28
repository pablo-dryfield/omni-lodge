import { Router, type Router as ExpressRouter } from 'express';
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
    if (!isPromotionTrackingServerEnabled(env)) {
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
