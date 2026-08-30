import type { NextFunction, Response } from 'express';
import { hasModuleActionPermission } from './authorizationMiddleware.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const FULL_ACCESS_MODULE = 'staff-payouts-all';
const SELF_ACCESS_MODULE = 'staff-payouts-self';

export const authorizeStaffPayoutView = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (await hasModuleActionPermission(req, FULL_ACCESS_MODULE, 'view')) {
      req.staffPayoutAccessScope = 'all';
      res.setHeader('Cache-Control', 'private, no-store');
      next();
      return;
    }

    if (await hasModuleActionPermission(req, SELF_ACCESS_MODULE, 'view')) {
      req.staffPayoutAccessScope = 'self';
      res.setHeader('Cache-Control', 'private, no-store');
      next();
      return;
    }

    res.status(403).json([{ message: 'Forbidden' }]);
  } catch (error) {
    res.status(500).json([{
      message: error instanceof Error ? error.message : 'Unable to verify staff payment access',
    }]);
  }
};
