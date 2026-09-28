import express, { Router, type Router as ExpressRouter } from 'express';
import request from 'supertest';
import {
  createPromotionTrackingFeatureGate,
  isPromotionTrackingServerEnabled,
  PROMOTION_TRACKING_DISABLED_CODE,
} from '../promotionTrackingFeatureGate';

describe('promotion tracking feature gate', () => {
  it('keeps the route stack unloaded and returns a clear disabled response by default', async () => {
    const loadRoutes = jest.fn<Promise<{ default: ExpressRouter }>, []>();
    const app = express();
    app.use('/api/promotion-tracking', createPromotionTrackingFeatureGate({
      env: {},
      loadRoutes,
    }));

    const response = await request(app)
      .get('/api/promotion-tracking/me/today')
      .expect(503);

    expect(response.body).toEqual({
      error: 'Promotion tracking is not enabled on this server.',
      code: PROMOTION_TRACKING_DISABLED_CODE,
    });
    expect(loadRoutes).not.toHaveBeenCalled();
  });

  it('loads and delegates to promotion tracking routes only when enabled', async () => {
    const promotionRoutes = Router();
    promotionRoutes.get('/me/today', (_req, res) => {
      res.json({ ok: true });
    });
    const loadRoutes = jest.fn(async () => ({ default: promotionRoutes }));
    const app = express();
    app.use('/api/promotion-tracking', createPromotionTrackingFeatureGate({
      env: { FEATURE_PROMOTION_TRACKING_SERVER: 'true' },
      loadRoutes,
    }));

    await request(app)
      .get('/api/promotion-tracking/me/today')
      .expect(200, { ok: true });

    expect(loadRoutes).toHaveBeenCalledTimes(1);
  });

  it.each(['1', 'true', 'TRUE', 'yes', 'on', 'enabled'])(
    'accepts %s as an enabled flag value',
    (value) => {
      expect(isPromotionTrackingServerEnabled({
        FEATURE_PROMOTION_TRACKING_SERVER: value,
      })).toBe(true);
    },
  );
});
