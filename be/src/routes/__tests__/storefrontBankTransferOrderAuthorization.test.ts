import express, { type RequestHandler, type Response } from 'express';
import request from 'supertest';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';

jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: ((req: AuthenticatedRequest, res: Response, next: () => void) => {
    if (!req.header('x-test-user')) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    req.authContext = { id: 9, userTypeId: 2, roleSlug: 'manager' };
    next();
  }) as RequestHandler,
}));

jest.mock('../../middleware/authorizationMiddleware.js', () => ({
  authorizeModuleAction: (moduleSlug: string, actionKey: string) => (
    req: AuthenticatedRequest,
    res: Response,
    next: () => void,
  ) => {
    const permissions = new Set(String(req.header('x-test-permissions') ?? '').split(','));
    if (!permissions.has(`${moduleSlug}:${actionKey}`)) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }
    next();
  },
}));

jest.mock('../../controllers/storefrontBankTransferOrderController.js', () => {
  const respond = jest.fn((_req: AuthenticatedRequest, res: Response) => res.status(204).send());
  return {
    cancelStorefrontBankTransferOrder: jest.fn(respond),
    createStorefrontBankTransferOrder: jest.fn(respond),
    listStorefrontBankTransferCatalog: jest.fn(respond),
    listStorefrontBankTransferOrders: jest.fn(respond),
    markStorefrontBankTransferPaymentReceived: jest.fn(respond),
    resendStorefrontBankTransferCancellation: jest.fn(respond),
    resendStorefrontBankTransferInstructions: jest.fn(respond),
    retryStorefrontBankTransferConfirmation: jest.fn(respond),
  };
});

import {
  cancelStorefrontBankTransferOrder,
  createStorefrontBankTransferOrder,
  listStorefrontBankTransferCatalog,
  listStorefrontBankTransferOrders,
  markStorefrontBankTransferPaymentReceived,
  resendStorefrontBankTransferCancellation,
  resendStorefrontBankTransferInstructions,
  retryStorefrontBankTransferConfirmation,
} from '../../controllers/storefrontBankTransferOrderController';
import storefrontBankTransferOrderRoutes from '../storefrontBankTransferOrderRoutes';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/storefront-bank-transfer-orders', storefrontBankTransferOrderRoutes);
  return app;
};

describe('bank-transfer booking route authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires authentication before exposing the order queue', async () => {
    expect((await request(buildApp()).get('/api/storefront-bank-transfer-orders')).status).toBe(401);
  });

  it('does not accept generic booking-management permission for the bank-transfer queue', async () => {
    const response = await request(buildApp())
      .get('/api/storefront-bank-transfer-orders')
      .set('x-test-user', '9')
      .set('x-test-permissions', 'booking-management:view');

    expect(response.status).toBe(403);
    expect(listStorefrontBankTransferOrders).not.toHaveBeenCalled();
  });

  it.each([
    ['get', '/api/storefront-bank-transfer-orders', 'view', listStorefrontBankTransferOrders],
    ['get', '/api/storefront-bank-transfer-orders/catalog', 'view', listStorefrontBankTransferCatalog],
    ['post', '/api/storefront-bank-transfer-orders', 'create', createStorefrontBankTransferOrder],
    ['patch', '/api/storefront-bank-transfer-orders/abc/payment-received', 'update', markStorefrontBankTransferPaymentReceived],
    ['patch', '/api/storefront-bank-transfer-orders/abc/cancel', 'update', cancelStorefrontBankTransferOrder],
    ['post', '/api/storefront-bank-transfer-orders/abc/resend-instructions', 'update', resendStorefrontBankTransferInstructions],
    ['post', '/api/storefront-bank-transfer-orders/abc/retry-confirmation', 'update', retryStorefrontBankTransferConfirmation],
    ['post', '/api/storefront-bank-transfer-orders/abc/resend-cancellation', 'update', resendStorefrontBankTransferCancellation],
  ] as const)('requires dedicated %s access for %s', async (method, path, action, controller) => {
    const app = buildApp();
    const forbidden = await request(app)[method](path)
      .set('x-test-user', '9')
      .set('x-test-permissions', `booking-management:${action}`);
    expect(forbidden.status).toBe(403);
    expect(controller).not.toHaveBeenCalled();

    const allowed = await request(app)[method](path)
      .set('x-test-user', '9')
      .set('x-test-permissions', `bank-transfer-booking-management:${action}`);
    expect(allowed.status).toBe(204);
    expect(controller).toHaveBeenCalledTimes(1);
  });
});
