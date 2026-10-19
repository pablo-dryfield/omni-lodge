jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: (req: any, _res: any, next: () => void) => {
    req.authContext = { id: 7, userTypeId: 6, roleSlug: req.headers['x-test-role'] ?? null };
    next();
  },
}));
jest.mock('../../services/productScopeService.js', () => ({
  requireBookingProductScope: (req: any, res: any, next: () => void) => {
    if (req.headers['x-out-of-scope']) return res.status(403).json({ message: 'Outside product scope' });
    next();
  },
}));
jest.mock('../../controllers/bookingController.js', () => new Proxy({ __esModule: true }, {
  get: (target, key) => key === '__esModule' ? true : (_req: any, res: any) => res.status(200).json({ operation: key }),
}));
jest.mock('../../controllers/bookingSanityController.js', () => new Proxy({ __esModule: true }, {
  get: (target, key) => key === '__esModule' ? true : (_req: any, res: any) => res.sendStatus(200),
}));
jest.mock('../../controllers/bookingSummaryController.js', () => ({ listBookingsWithSummary: (_req: any, res: any) => res.sendStatus(200) }));

import express from 'express';
import request from 'supertest';
import router from '../bookingRoutes.js';
import { MANAGER_ROLES } from '../schedulingRoles.js';

const app = express();
app.use(express.json());
app.use('/bookings', router);

describe('counter Stripe add-on refund route authorization', () => {
  it.each(MANAGER_ROLES)('allows the existing manager role %s', async (role) => {
    const response = await request(app).post('/bookings/21/counter-addon-refunds/verify').set('x-test-role', role).send({});
    expect(response.status).toBe(200);
    expect(response.body.operation).toBe('counterBookingAddonRefund');
  });

  it.each(['verify', 'refund', 'rectify'])('rejects guide access to %s', async (operation) => {
    const response = await request(app).post(`/bookings/21/counter-addon-refunds/${operation}`).set('x-test-role', 'guide').send({});
    expect(response.status).toBe(403);
  });

  it('keeps product restrictions even for assistant managers', async () => {
    const response = await request(app).post('/bookings/21/counter-addon-refunds/rectify')
      .set('x-test-role', 'assistant-manager').set('x-out-of-scope', 'true').send({});
    expect(response.status).toBe(403);
  });
});
