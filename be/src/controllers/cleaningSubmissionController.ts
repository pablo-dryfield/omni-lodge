import type { Response } from 'express';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import logger from '../utils/logger.js';
import { getCleaningPhotoStream, getCleaningSubmission, listMyCleaningSubmissions, reviewCleaningSubmissionPhoto,
  uploadCleaningSubmissionPhoto, waiveCanceledCleaningTask } from '../services/cleaningSubmissionService.js';

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
  if (error instanceof HttpError) { res.status(error.status).json({ message: error.message }); return; }
  const failure = error as { original?: { code?: string }; parent?: { code?: string } };
  if (['40001', '40P01', '23505'].includes(failure?.original?.code ?? failure?.parent?.code ?? '')) {
    res.status(409).json({ message: 'The cleaning task or schedule changed. Refresh before continuing.' }); return;
  }
  logger.error('Unable to process cleaning submission.', error);
  res.status(500).json({ message: 'Unable to process the cleaning submission.' });
};
export const getMyCleaningSubmissions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try { res.json(await listMyCleaningSubmissions(actor(req))); } catch (error) { errorResponse(res, error); }
};
export const getCleaningSubmissionDetail = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try { res.json(await getCleaningSubmission(id(req.params.submissionId), actor(req))); } catch (error) { errorResponse(res, error); }
};
export const postCleaningPhoto = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.file || req.file.fieldname !== 'file') throw new HttpError(400, 'Choose a photo to upload.');
    if (Object.keys(req.body ?? {}).some((key) => key !== 'expectedRevision')) throw new HttpError(400, 'Unknown cleaning upload field.');
    if (typeof req.params.slotKey !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/u.test(req.params.slotKey)) throw new HttpError(400, 'Invalid cleaning photo slot.');
    res.json(await uploadCleaningSubmissionPhoto({ ...actor(req), submissionId: id(req.params.submissionId),
      slotKey: req.params.slotKey, expectedRevision: req.body.expectedRevision, data: req.file.buffer }));
  } catch (error) { errorResponse(res, error); }
};
export const patchCleaningPhotoReview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try { res.json(await reviewCleaningSubmissionPhoto({ ...actor(req), submissionId: id(req.params.submissionId),
    photoId: id(req.params.photoId), body: req.body })); } catch (error) { errorResponse(res, error); }
};
export const postWaiveCanceledCleaningTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try { res.json(await waiveCanceledCleaningTask({ ...actor(req), taskLogId: id(req.params.taskLogId), body: req.body })); }
  catch (error) { errorResponse(res, error); }
};
export const streamCleaningPhoto = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const photo = await getCleaningPhotoStream(id(req.params.submissionId), id(req.params.photoId), actor(req));
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline; filename="cleaning-photo.jpg"');
    photo.stream.on('error', (error) => { logger.error('Unable to stream cleaning photo.', error); if (res.headersSent) res.destroy(); else errorResponse(res, error); });
    photo.stream.pipe(res);
  } catch (error) { errorResponse(res, error); }
};
