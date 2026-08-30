jest.mock('../../__mocks__/sequelizeModelStub.ts', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/UserType.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftRole.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/requestContextService.js', () => ({
  getRequestContextValue: jest.fn(),
  setRequestContextValue: jest.fn(),
}));
jest.mock('../../services/performanceMonitorService.js', () => ({
  performanceMonitorService: { attachAuthenticatedUser: jest.fn() },
}));
jest.mock('../../services/queryDiagnosticsService.js', () => ({
  queryDiagnosticsService: { attachAuthenticatedUser: jest.fn() },
}));

import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../../__mocks__/sequelizeModelStub';
import { issueStaffPayoutReceiptAccessToken } from '../../services/staffPayoutReceiptAccessTokenService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import authenticateJWT from '../authMiddleware';

const createResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
} as unknown as Response & { status: jest.Mock; json: jest.Mock });

describe('normal auth receipt-token isolation', () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalReceiptSecret = process.env.STAFF_PAYOUT_RECEIPT_ACCESS_SECRET;
  const next: NextFunction = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'shared-test-secret';
    process.env.STAFF_PAYOUT_RECEIPT_ACCESS_SECRET = 'shared-test-secret';
  });

  afterAll(() => {
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalReceiptSecret === undefined) delete process.env.STAFF_PAYOUT_RECEIPT_ACCESS_SECRET;
    else process.env.STAFF_PAYOUT_RECEIPT_ACCESS_SECRET = originalReceiptSecret;
  });

  it('rejects a receipt capability before user status or roles can make it a normal session', async () => {
    const { token } = issueStaffPayoutReceiptAccessToken({
      userId: 28,
      receiptId: 91,
      actionId: 101,
    });
    const req = {
      headers: { authorization: `Bearer ${token}` },
      cookies: {},
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await authenticateJWT(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(User.findByPk).not.toHaveBeenCalled();
    expect(req.authContext).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  it('preserves the existing active-user JWT flow', async () => {
    (User.findByPk as jest.Mock).mockResolvedValue({
      id: 28,
      status: true,
      approved: true,
      userTypeId: 3,
      firstName: 'Aimee',
      lastName: 'Kelly',
      role: { slug: 'assistant-manager', name: 'Assistant Manager' },
      shiftRoles: [{ slug: 'manager' }],
    });
    const token = jwt.sign({ id: 28 }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
    const req = {
      headers: { authorization: `Bearer ${token}` },
      cookies: {},
    } as unknown as AuthenticatedRequest;
    const res = createResponse();

    await authenticateJWT(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(req.authContext).toMatchObject({
      id: 28,
      userTypeId: 3,
      roleSlug: 'assistant-manager',
      shiftRoleSlugs: ['manager'],
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
