jest.mock('../../middleware/authMiddleware.js', () => ({
  __esModule: true,
  default: (_req: unknown, res: { status: (code: number) => { json: (value: unknown) => void } }) =>
    res.status(418).json({ normalAuthReached: true }),
}));
jest.mock('../../middleware/staffPayoutReceiptAccessMiddleware.js', () => ({
  authenticateStaffPayoutReceiptAccess: (
    req: { receiptAccess?: Record<string, number | string> },
    _res: unknown,
    next: () => void,
  ) => {
    req.receiptAccess = {
      userId: 28,
      receiptId: 91,
      actionId: 101,
      tokenId: 'route-test-token',
      expiresAt: 1_800_000_000,
    };
    next();
  },
}));
jest.mock('../../middleware/authorizationMiddleware.js', () => ({
  authorizeModuleAction: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../controllers/staffPayoutReceiptAccessController.js', () => ({
  exchangeStaffPayoutReceiptAccess: (_req: unknown, res: { status: (code: number) => { json: (value: unknown) => void } }) =>
    res.status(201).json({ route: 'exchange' }),
  getStaffPayoutReceiptAccess: (_req: unknown, res: { status: (code: number) => { json: (value: unknown) => void } }) =>
    res.status(202).json({ route: 'access' }),
  confirmStaffPayoutReceiptAccess: (_req: unknown, res: { status: (code: number) => { json: (value: unknown) => void } }) =>
    res.status(203).json({ route: 'scoped-confirm' }),
}));
jest.mock('../../controllers/requiredActionController.js', () => {
  const normalController = (_req: unknown, res: { status: (code: number) => { json: (value: unknown) => void } }) =>
    res.status(204).json({ route: 'normal-controller' });
  return {
    completeProfileFieldsAction: normalController,
    completeRequiredAction: normalController,
    confirmStaffPayoutReceiptRequiredAction: normalController,
    createRequiredAction: normalController,
    decideManagerSwapRequiredAction: normalController,
    decideManagerShiftRequestRequiredAction: normalController,
    listMyRequiredActions: normalController,
    markRequiredActionPrompted: normalController,
    respondToSwapRequiredAction: normalController,
    respondToShiftRequestRequiredAction: normalController,
    updateRequiredActionStatus: normalController,
  };
});

import express from 'express';
import request from 'supertest';
import requiredActionRoutes from '../requiredActionRoutes';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/required-actions', requiredActionRoutes);
  return app;
};

describe('staff payout receipt-only route isolation', () => {
  it('places credential exchange and scoped receipt routes before normal auth', async () => {
    const app = buildApp();

    expect((await request(app).post('/required-actions/staff-payout-receipts/access')).status).toBe(201);
    expect((await request(app).get('/required-actions/staff-payout-receipts/91/access')).status).toBe(202);
    expect((await request(app).post('/required-actions/staff-payout-receipts/91/access/confirm')).status).toBe(203);
  });

  it('keeps the active-user action list and original confirm route behind normal auth', async () => {
    const app = buildApp();

    expect((await request(app).get('/required-actions/me')).status).toBe(418);
    expect((await request(app).post('/required-actions/staff-payout-receipts/91/confirm')).status).toBe(418);
  });
});
