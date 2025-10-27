import { NextFunction, Response } from 'express';
import authMiddleware from '../../middleware/authMiddleware.js';
import { requireRoles } from '../../middleware/authorizationMiddleware.js';
import { AuthenticatedRequest } from '../../types/AuthenticatedRequest';

export const FINANCE_ALLOWED_ROLES = ['admin', 'manager', 'assistant-manager', 'owner'];

export const financeAuthChain = [
  authMiddleware,
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const context = req.authContext;
    if (!context || !context.roleSlug) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }
    next();
  },
  requireRoles(FINANCE_ALLOWED_ROLES),
];
