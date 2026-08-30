jest.mock('../../services/staffPayoutReceiptAccessService.js', () => ({
  assertStaffPayoutReceiptAccessState: jest.fn(),
}));
jest.mock('../../services/staffPayoutReceiptAccessTokenService.js', () => ({
  StaffPayoutReceiptAccessTokenConfigurationError: class extends Error {},
  verifyStaffPayoutReceiptAccessToken: jest.fn(),
}));

import type { NextFunction, Response } from 'express';
import { assertStaffPayoutReceiptAccessState } from '../../services/staffPayoutReceiptAccessService';
import { verifyStaffPayoutReceiptAccessToken } from '../../services/staffPayoutReceiptAccessTokenService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { authenticateStaffPayoutReceiptAccess } from '../staffPayoutReceiptAccessMiddleware';

const claims = {
  userId: 28,
  receiptId: 91,
  actionId: 101,
  tokenId: 'receipt-token-id',
  expiresAt: 1_800_000_000,
};

const createRequest = (receiptId = '91'): AuthenticatedRequest => ({
  params: { receiptId },
  get: jest.fn((name: string) => name.toLowerCase() === 'authorization' ? 'Bearer scoped-token' : undefined),
} as unknown as AuthenticatedRequest);

const createResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
  setHeader: jest.fn(),
} as unknown as Response & {
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
});

describe('staff payout receipt access middleware', () => {
  const next: NextFunction = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (verifyStaffPayoutReceiptAccessToken as jest.Mock).mockReturnValue(claims);
    (assertStaffPayoutReceiptAccessState as jest.Mock).mockResolvedValue({});
  });

  it('sets only the receipt-bound context after token and live-state validation', async () => {
    const req = createRequest();
    const res = createResponse();

    await authenticateStaffPayoutReceiptAccess(req, res, next);

    expect(req.receiptAccess).toEqual(claims);
    expect(req.authContext).toBeUndefined();
    expect(assertStaffPayoutReceiptAccessState).toHaveBeenCalledWith(claims);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects a token used for another receipt before loading receipt state', async () => {
    const req = createRequest('92');
    const res = createResponse();

    await authenticateStaffPayoutReceiptAccess(req, res, next);

    expect(assertStaffPayoutReceiptAccessState).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a receipt that was cancelled after the token was issued', async () => {
    (assertStaffPayoutReceiptAccessState as jest.Mock).mockRejectedValue(new Error('cancelled'));
    const req = createRequest();
    const res = createResponse();

    await authenticateStaffPayoutReceiptAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith([{ message: 'Unable to access this payout receipt.' }]);
    expect(next).not.toHaveBeenCalled();
  });
});
