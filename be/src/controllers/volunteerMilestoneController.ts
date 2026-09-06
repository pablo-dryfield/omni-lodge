import type { Response } from 'express';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  getVolunteerMilestoneProgress,
  listActiveVolunteerMilestoneProgress,
  recordVolunteerAttendance,
  saveVolunteerManagementFeedback,
} from '../services/volunteerMilestoneService.js';
import type { VolunteerAttendanceStatus } from '../models/VolunteerShiftAttendance.js';
import logger from '../utils/logger.js';

const actorId = (req: AuthenticatedRequest): number => {
  const id = req.authContext?.id;
  if (!id) {
    throw new HttpError(401, 'Authentication is required.');
  }
  return id;
};

const requestedPeriod = (req: AuthenticatedRequest): string | null => {
  if (typeof req.params.period === 'string') {
    return req.params.period;
  }
  return typeof req.query.period === 'string' ? req.query.period : null;
};

const positiveId = (value: unknown, label: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${label} must be a positive integer.`);
  }
  return parsed;
};

const sendError = (res: Response, error: unknown, fallback: string): void => {
  if (error instanceof HttpError) {
    res.status(error.status).json({
      message: error.message,
      ...(error.details == null ? {} : { details: error.details }),
    });
    return;
  }
  logger.error(fallback, error);
  res.status(500).json({ message: fallback });
};

export const getMyVolunteerMilestones = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const progress = await getVolunteerMilestoneProgress(actorId(req), requestedPeriod(req), {
      selfAccess: true,
    });
    res.json(progress);
  } catch (error) {
    sendError(res, error, 'Unable to load volunteer milestone progress.');
  }
};

export const listVolunteerMilestones = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const payload = await listActiveVolunteerMilestoneProgress(requestedPeriod(req));
    res.json(payload);
  } catch (error) {
    sendError(res, error, 'Unable to load volunteer milestone summaries.');
  }
};

export const getVolunteerMilestones = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = positiveId(req.params.userId, 'userId');
    const progress = await getVolunteerMilestoneProgress(userId, requestedPeriod(req));
    res.json(progress);
  } catch (error) {
    sendError(res, error, 'Unable to load volunteer milestone progress.');
  }
};

export const putVolunteerAttendance = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const shiftAssignmentId = positiveId(req.params.shiftAssignmentId, 'shiftAssignmentId');
    const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() || null : null;
    const { attendance, volunteerUserId } = await recordVolunteerAttendance({
      shiftAssignmentId,
      status: req.body.status as VolunteerAttendanceStatus,
      notes,
      actorId: actorId(req),
    });
    const progress = await getVolunteerMilestoneProgress(volunteerUserId, requestedPeriod(req));
    res.json({
      attendance: {
        id: attendance.id,
        assignmentId: attendance.shiftAssignmentId,
        status: attendance.status,
        notes: attendance.notes,
        recordedAt: attendance.recordedAt,
        recordedBy: attendance.recordedBy,
      },
      progress,
    });
  } catch (error) {
    sendError(res, error, 'Unable to record volunteer attendance.');
  }
};

export const putVolunteerManagementFeedback = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = positiveId(req.params.userId, 'userId');
    const feedback = typeof req.body.feedback === 'string' ? req.body.feedback.trim() || null : null;
    await saveVolunteerManagementFeedback({
      volunteerUserId: userId,
      month: requestedPeriod(req),
      feedback,
      approved: req.body.approved,
      actorId: actorId(req),
    });
    const progress = await getVolunteerMilestoneProgress(userId, requestedPeriod(req));
    res.json(progress);
  } catch (error) {
    sendError(res, error, 'Unable to save volunteer management feedback.');
  }
};
