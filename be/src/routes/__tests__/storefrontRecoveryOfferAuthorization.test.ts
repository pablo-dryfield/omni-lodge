import express, { type Response } from 'express';
import request from 'supertest';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';

jest.mock('../../middleware/authMiddleware.js', () => ({ __esModule: true, default: (req: AuthenticatedRequest, res: Response, next: () => void) => {
  const role = req.header('x-test-role');
  if (!role) { res.status(401).send(); return; }
  req.authContext = { id: 9, userTypeId: 2, roleSlug: role }; next();
} }));
jest.mock('../../controllers/storefrontOngoingCartController.js', () => {
  const respond = (_req: unknown, res: Response) => res.status(204).send();
  return { dismissOngoingCart: respond, getOngoingCartActivity: respond, listOngoingCarts: respond, listRecoveredCarts: respond,
    previewOngoingCartRecoveryEmail: respond, sendOngoingCartRecoveryEmail: respond,
    listRecoveryCoupons: jest.fn(respond), updateCartRecoveryOffer: jest.fn(respond) };
});
import routes from '../storefrontOngoingCartRoutes';
import { updateCartRecoveryOffer } from '../../controllers/storefrontOngoingCartController';
const app = express(); app.use(express.json()); app.use('/carts', routes);
beforeEach(() => jest.clearAllMocks());
it('requires authentication for recovery offer changes', async () => {
  expect((await request(app).put('/carts/cart-id/recovery-offer').send({ mode: 'none' })).status).toBe(401);
  expect(updateCartRecoveryOffer).not.toHaveBeenCalled();
});
it.each(['guide', 'volunteer', 'assistant-manager', 'food-tour-owner'])('denies coupon overrides to %s', async role => {
  expect((await request(app).put('/carts/cart-id/recovery-offer').set('x-test-role', role).send({ mode: 'coupon', promotionId: 1 })).status).toBe(403);
  expect((await request(app).get('/carts/recovery-coupons').set('x-test-role', role)).status).toBe(403);
  expect(updateCartRecoveryOffer).not.toHaveBeenCalled();
});
it.each(['admin', 'owner', 'manager'])('allows %s to manage recovery offers', async role => {
  expect((await request(app).put('/carts/cart-id/recovery-offer').set('x-test-role', role).send({ mode: 'none' })).status).toBe(204);
  expect((await request(app).get('/carts/recovery-coupons').set('x-test-role', role)).status).toBe(204);
});
