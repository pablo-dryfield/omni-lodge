import type { Response } from 'express';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { getVolunteerAttendanceCheck, saveVolunteerAttendanceCheck } from '../services/volunteerAttendanceCheckService.js';
import logger from '../utils/logger.js';

const actor = (req: AuthenticatedRequest) => {
  if (!req.authContext?.id) throw new HttpError(401, 'Authentication is required.');
  return { actorId: req.authContext.id, roleSlug: req.authContext.roleSlug };
};
const id = (value: unknown): number => {
  const parsed = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new HttpError(400, 'A positive integer ID is required.');
  return parsed;
};
const errorResponse = (res: Response, error: unknown) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  logger.error('Unable to process evidence-linked attendance check.', error);
  res.status(500).json({ message: 'Unable to process the attendance check.' });
};
export const getTaskAttendanceCheck = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try { res.json(await getVolunteerAttendanceCheck(id(req.params.logId), actor(req))); }
  catch (error) { errorResponse(res, error); }
};
export const putTaskAttendanceCheck = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json(await saveVolunteerAttendanceCheck({ ...actor(req), taskLogId: id(req.params.logId),
      assignmentId: id(req.params.assignmentId), body: req.body }));
  } catch (error) { errorResponse(res, error); }
};
