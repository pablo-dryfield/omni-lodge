import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import HttpError from '../errors/HttpError.js';
import logger from '../utils/logger.js';
import { cancelStaffFreeEntry, checkInStaffFree, getStaffFreeAccount, getStaffFreeHistory, getStaffFreeOverview } from '../services/staffFreeEntryService.js';

const id = (value: unknown) => { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'Invalid ID.'); return n; };
const handle = (fn: (req: AuthenticatedRequest) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response) => {
  try { res.json(await fn(req)); }
  catch (error) {
    if (!(error instanceof HttpError)) logger.error('Staff free-entry operation failed', error);
    res.status(error instanceof HttpError ? error.status : 500).json([{ message: error instanceof HttpError ? error.message : 'Unable to update staff free entries.' }]);
  }
};

export const listStaffFreeEntries = handle(req => getStaffFreeOverview(id(req.params.id)));
export const staffFreeHistory = handle(req => getStaffFreeHistory(id(req.params.userId)));
export const myStaffFreeAccount = handle(req => {
  if (!req.authContext?.id) throw new HttpError(401, 'Sign in to view your free-crawl history.');
  // Never read a target ID from a query, body or path on this personal endpoint.
  return getStaffFreeAccount(id(req.authContext.id));
});
export const addStaffFreeEntry = handle(async req => {
  const counterId = id(req.params.id);
  if (req.body?.overrideReason != null && typeof req.body.overrideReason !== 'string') throw new HttpError(400, 'Provide the override reason as text.');
  if (!['allowance', 'busy_night', 'assistant_manager', 'management', 'override'].includes(req.body?.expectedBenefit)) throw new HttpError(400, 'Refresh and confirm the staff-entry decision.');
  await checkInStaffFree(counterId, id(req.body?.userId), id(req.authContext?.id), req.body?.overrideReason, req.body.expectedBenefit);
  return getStaffFreeOverview(counterId);
});
export const removeStaffFreeEntry = handle(async req => {
  const counterId = id(req.params.id);
  if (typeof req.body?.reason !== 'string') throw new HttpError(400, 'Provide a correction reason.');
  await cancelStaffFreeEntry(counterId, id(req.params.entryId), id(req.authContext?.id), req.body.reason);
  return getStaffFreeOverview(counterId);
});
