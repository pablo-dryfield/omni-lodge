import type { Response } from 'express';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  getVolunteerMilestoneProgress,
  listActiveVolunteerMilestoneProgress,
  recordVolunteerAttendance,
  saveVolunteerManagementFeedback,
} from '../services/volunteerMilestoneService.js';
import {
  getVolunteerStayProgress,
  listVolunteerStayProgress,
  saveVolunteerStay,
  saveVolunteerStayFeedback,
} from '../services/volunteerStayService.js';
import type { VolunteerAttendanceStatus } from '../models/VolunteerShiftAttendance.js';
import { openProfilePhotoStream } from '../services/profilePhotoStorageService.js';
import { getVolunteerProfilePhotoRecord } from '../services/volunteerProfilePhotoService.js';
import logger from '../utils/logger.js';

const ALLOWED_PROFILE_PHOTO_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);

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

const requestedStayId = (req: AuthenticatedRequest): number | undefined =>
  req.query.stayId == null ? undefined : positiveId(req.query.stayId, 'stayId');

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
    const period = requestedPeriod(req);
    const progress = period
      ? await getVolunteerMilestoneProgress(actorId(req), period, { selfAccess: true })
      : await getVolunteerStayProgress(actorId(req), { selfAccess: true, stayId: requestedStayId(req) });
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
    const period = requestedPeriod(req);
    const payload = period ? await listActiveVolunteerMilestoneProgress(period) : await listVolunteerStayProgress();
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
    const period = requestedPeriod(req);
    const progress = period ? await getVolunteerMilestoneProgress(userId, period)
      : await getVolunteerStayProgress(userId, { stayId: requestedStayId(req) });
    res.json(progress);
  } catch (error) {
    sendError(res, error, 'Unable to load volunteer milestone progress.');
  }
};

export const streamVolunteerProfilePhoto = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const userId = positiveId(req.params.userId, 'userId');
    const photo = await getVolunteerProfilePhotoRecord(userId);
    const { stream, mimeType } = await openProfilePhotoStream(photo.storagePath);
    if (res.destroyed) {
      stream.destroy();
      return;
    }

    const normalizedMimeType = mimeType.trim().toLowerCase();
    if (!ALLOWED_PROFILE_PHOTO_MIME_TYPES.has(normalizedMimeType)) {
      stream.destroy();
      res.status(415).json({ message: 'Stored profile photo is not a supported image.' });
      return;
    }

    res.setHeader('Content-Type', normalizedMimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');
    res.vary('Cookie');
    res.vary('Authorization');
    stream.once('error', (error: NodeJS.ErrnoException) => {
      stream.unpipe(res);
      stream.destroy();
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const notFound = error.code === 'ENOENT';
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(notFound ? 404 : 500).json({
        message: notFound ? 'Volunteer profile photo was not found.' : 'Unable to read the volunteer profile photo.',
      });
    });
    res.once('close', () => stream.destroy());
    stream.pipe(res);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'ENOENT' || code === 404) {
      res.status(404).json({ message: 'Volunteer profile photo was not found.' });
      return;
    }
    sendError(res, error, 'Unable to read the volunteer profile photo.');
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
    const period = requestedPeriod(req);
    const progress = period ? await getVolunteerMilestoneProgress(volunteerUserId, period)
      : await getVolunteerStayProgress(volunteerUserId, { stayId: requestedStayId(req) });
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

export const createVolunteerStay = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const progress = await saveVolunteerStay({
      userId: positiveId(req.params.userId, 'userId'), body: req.body, actorId: actorId(req),
    });
    res.status(201).json(progress);
  } catch (error) {
    sendError(res, error, 'Unable to create the volunteer stay.');
  }
};

export const updateVolunteerStay = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const progress = await saveVolunteerStay({
      userId: positiveId(req.params.userId, 'userId'), stayId: positiveId(req.params.stayId, 'stayId'),
      body: req.body, actorId: actorId(req),
    });
    res.json(progress);
  } catch (error) {
    sendError(res, error, 'Unable to update the volunteer stay.');
  }
};

export const putVolunteerStayFeedback = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const progress = await saveVolunteerStayFeedback({
      userId: positiveId(req.params.userId, 'userId'), stayId: positiveId(req.params.stayId, 'stayId'),
      body: req.body, actorId: actorId(req),
    });
    res.json(progress);
  } catch (error) {
    sendError(res, error, 'Unable to save volunteer stay feedback.');
  }
};
