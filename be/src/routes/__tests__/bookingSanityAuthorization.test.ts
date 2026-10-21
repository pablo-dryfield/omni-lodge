import express from 'express';
import request from 'supertest';
import type { RequestHandler, Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';

jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: ((req: AuthenticatedRequest, res: Response, next: () => void) => {
    const roleSlug = req.header('x-test-role');
    if (!roleSlug) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    req.authContext = { id: 7, userTypeId: 6, roleSlug };
    next();
  }) as RequestHandler,
}));
jest.mock('../../services/productScopeService.js', () => ({
  requireBookingProductScope: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../controllers/bookingController.js', () => new Proxy({ __esModule: true }, {
  get: (_target, key) => key === '__esModule' ? true : (_req: unknown, res: Response) => res.sendStatus(204),
}));
jest.mock('../../controllers/bookingSummaryController.js', () => ({
  listBookingsWithSummary: (_req: unknown, res: Response) => res.sendStatus(204),
}));
jest.mock('../../controllers/bookingSanityController.js', () => {
  const handlers = [
    'getSanityCheckOmniSummary', 'getSanityCheckEcwidComparison', 'reprocessEcwidSanityHints',
    'fixEcwidOrderFromSource', 'fixEcwidOrdersFromSourceBulk', 'fixEcwidOrderToExternal',
    'fixEcwidOrdersToExternalBulk', 'backfillEcwidPaymentMetadata',
  ];
  return Object.fromEntries(handlers.map(name => [name, jest.fn((_req: unknown, res: Response) => res.sendStatus(204))]));
});

import router from '../bookingRoutes.js';
import * as sanityController from '../../controllers/bookingSanityController.js';

const app = express();
app.use(express.json());
app.use('/bookings', router);

const endpoints = [
  ['get', '/omni'],
  ['get', '/ecwid'],
  ['post', '/ecwid/reprocess-hints'],
  ['post', '/ecwid/fix-order'],
  ['post', '/ecwid/fix-orders'],
  ['post', '/ecwid/fix-to-ecwid'],
  ['post', '/ecwid/fix-to-ecwid-bulk'],
  ['post', '/ecwid/backfill-payment-metadata'],
] as const;

describe.each(endpoints)('booking sanity authorization: %s %s', (method, path) => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['owner', 'admin', 'administrator', ' Administrator '])('allows %s', async role => {
    const response = await request(app)[method](`/bookings/sanity-check${path}`)
      .set('x-test-role', role).send({});
    expect(response.status).toBe(204);
  });

  it.each(['manager', 'assistant-manager', 'assistant_manager', 'guide', 'food-tour-owner', 'food-tour-admin'])(
    'rejects %s before reading data or performing any repair', async role => {
      const response = await request(app)[method](`/bookings/sanity-check${path}`)
        .set('x-test-role', role).send({});
      expect(response.status).toBe(403);
      Object.values(sanityController).filter(jest.isMockFunction)
        .forEach(handler => expect(handler).not.toHaveBeenCalled());
    },
  );

  it('requires authentication', async () => {
    expect((await request(app)[method](`/bookings/sanity-check${path}`).send({})).status).toBe(401);
    Object.values(sanityController).filter(jest.isMockFunction)
      .forEach(handler => expect(handler).not.toHaveBeenCalled());
  });
});

it('does not restrict normal manifest access to administrators and owners', async () => {
  expect((await request(app).get('/bookings/manifest').set('x-test-role', 'manager')).status).toBe(204);
});
