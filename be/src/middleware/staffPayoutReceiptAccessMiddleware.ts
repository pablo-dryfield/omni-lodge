import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { assertStaffPayoutReceiptAccessState } from '../services/staffPayoutReceiptAccessService.js';
import {
  StaffPayoutReceiptAccessTokenConfigurationError,
  verifyStaffPayoutReceiptAccessToken,
} from '../services/staffPayoutReceiptAccessTokenService.js';

const readBearerToken = (req: AuthenticatedRequest): string | null => {
  const authorization = req.get('authorization') ?? '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
};

const denyReceiptAccess = (res: Response): void => {
  res.setHeader('WWW-Authenticate', 'Bearer');
  res.status(401).json([{ message: 'Unable to access this payout receipt.' }]);
};

export const authenticateStaffPayoutReceiptAccess = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = readBearerToken(req);
    if (!token) {
      denyReceiptAccess(res);
      return;
    }

    const claims = verifyStaffPayoutReceiptAccessToken(token);
    const routeReceiptId = Number(req.params.receiptId);
    if (
      !Number.isSafeInteger(routeReceiptId)
      || routeReceiptId <= 0
      || routeReceiptId !== claims.receiptId
    ) {
      denyReceiptAccess(res);
      return;
    }

    await assertStaffPayoutReceiptAccessState(claims);
    req.receiptAccess = claims;
    res.setHeader('Cache-Control', 'no-store');
    next();
  } catch (error) {
    if (error instanceof StaffPayoutReceiptAccessTokenConfigurationError) {
      res.status(503).json([{ message: 'Payout receipt access is temporarily unavailable.' }]);
      return;
    }
    denyReceiptAccess(res);
  }
};
