import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import authenticate from './authMiddleware.js';

// The import body parser authenticates before accepting a large body. Routing
// then reuses only that exact Request object's completed authentication; there
// is no user/token cache across requests or client-controlled marker.
const authenticated = new WeakSet<AuthenticatedRequest>();
export const authenticateWorkspace = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (authenticated.has(req)) {
    next();
    return;
  }
  await authenticate(req, res, () => {
    authenticated.add(req);
    next();
  });
};
