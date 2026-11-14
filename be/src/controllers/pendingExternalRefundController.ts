import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { getAllowedProductTypeIds } from '../services/productScopeService.js';
import { listPendingExternalRefunds } from '../services/pendingExternalRefundService.js';

export const getPendingExternalRefunds = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  res.setHeader('Cache-Control', 'private, no-store');
  const limit = Number(req.query.limit ?? 8);
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0) {
    res.status(400).json({ message: 'Use a limit from 1 to 50 and a non-negative integer offset.' }); return;
  }
  try {
    const scope = await getAllowedProductTypeIds(req);
    res.json(await listPendingExternalRefunds(scope, limit, offset));
  } catch {
    res.status(500).json({ message: 'Unable to load pending external refunds.' });
  }
};
