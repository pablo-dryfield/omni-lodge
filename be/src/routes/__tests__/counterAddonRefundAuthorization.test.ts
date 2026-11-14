jest.mock('../../middleware/authorizationMiddleware.js', () => ({
  ...jest.requireActual('../../middleware/authorizationMiddleware.js'),
  authorizeModuleAction: (_module: string, _action: string) => (req: any, res: any, next: () => void) =>
    req.headers['x-no-module'] ? res.sendStatus(403) : next(),
}));
jest.mock('../../controllers/pendingExternalRefundController.js', () => ({ getPendingExternalRefunds: (_req: any, res: any) => res.status(200).json({ data: [] }) }));
jest.mock('../../controllers/localBookingActionController.js', () => new Proxy({ __esModule: true }, {
  get: (_target, key) => key === '__esModule' ? true : (_req: any, res: any) => res.sendStatus(200),
}));
jest.mock('../../controllers/bookingPaymentController.js', () => ({ bookingPaymentDetails: jest.fn(), bookingPaymentEvents: jest.fn() }));
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

describe('shared external refund queue and Counter Summary action authorization', () => {
  it.each(MANAGER_ROLES)('allows management %s to view outstanding refunds', async role => {
    expect((await request(app).get('/bookings/pending-external-refunds').set('x-test-role', role)).status).toBe(200);
  });
  it.each(['get', 'patch', 'delete'] as const)('blocks ordinary users and missing module permissions for %s', async method => {
    const path = method === 'get' ? '/bookings/pending-external-refunds' : '/bookings/21/addon-refund-actions/task-1';
    expect((await request(app)[method](path).set('x-test-role', 'guide').send({ status: 'completed' })).status).toBe(403);
    expect((await request(app)[method](path).set('x-test-role', 'manager').set('x-no-module', 'yes').send({ status: 'completed' })).status).toBe(403);
  });
  it.each(['patch', 'delete'] as const)('keeps scope validation and routes %s to existing Counter Summary handlers', async method => {
    const path = '/bookings/21/addon-refund-actions/task-1';
    expect((await request(app)[method](path).set('x-test-role', 'manager').set('x-out-of-scope', 'yes').send({ status: 'completed' })).status).toBe(403);
    expect((await request(app)[method](path).set('x-test-role', 'assistant-manager').send({ status: 'completed' })).body.operation)
      .toBe(method === 'patch' ? 'completeBookingAddonRefundAction' : 'deleteBookingAddonRefundAction');
  });
});
