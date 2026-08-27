import bcrypt from 'bcryptjs';
import type { Response } from 'express';
import HttpError from '../errors/HttpError.js';
import User from '../models/User.js';
import {
  completeWhatsAppEmbeddedSignupAttempt,
  createWhatsAppEmbeddedSignupAttempt,
  getWhatsAppAdminStatus,
} from '../services/whatsappEmbeddedSignupService.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const noStore = (res: Response): void => {
  res.set('Cache-Control', 'no-store');
};

const SAFE_ERROR_CODE = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;

const handleError = (res: Response, error: unknown): void => {
  if (error instanceof HttpError) {
    const details = error.details !== null && typeof error.details === 'object'
      && !Array.isArray(error.details)
      ? error.details as Record<string, unknown>
      : null;
    const code = typeof details?.code === 'string' && SAFE_ERROR_CODE.test(details.code)
      ? details.code
      : null;
    res.status(error.status).json([{
      message: error.message,
      ...(code === null ? {} : { details: { code } }),
    }]);
    return;
  }
  res.status(500).json([{ message: 'Unexpected server error.' }]);
};

const passwordConfirmed = async (
  req: AuthenticatedRequest,
  password: unknown,
): Promise<boolean> => {
  const actorId = req.authContext?.id;
  if (!actorId || typeof password !== 'string' || password.trim().length === 0) {
    return false;
  }
  const user = await User.findByPk(actorId);
  return Boolean(user && await bcrypt.compare(password, user.password));
};

export const getWhatsAppAdminStatusController = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    res.json({ status: await getWhatsAppAdminStatus() });
  } catch (error) {
    handleError(res, error);
  }
};

export const createWhatsAppEmbeddedSignupAttemptController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    if (!await passwordConfirmed(req, req.body?.password)) {
      res.status(403).json([{
        message: 'Password confirmation is required to start WhatsApp Embedded Signup.',
      }]);
      return;
    }
    const adminUserId = req.authContext?.id;
    if (!adminUserId) {
      res.status(401).json([{ message: 'Unauthorized.' }]);
      return;
    }
    const payload = await createWhatsAppEmbeddedSignupAttempt(adminUserId);
    res.status(201).json(payload);
  } catch (error) {
    handleError(res, error);
  }
};

export const completeWhatsAppEmbeddedSignupAttemptController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  noStore(res);
  try {
    const adminUserId = req.authContext?.id;
    const attemptId = req.params.id;
    if (!adminUserId || !attemptId) {
      res.status(401).json([{ message: 'Unauthorized.' }]);
      return;
    }
    const status = await completeWhatsAppEmbeddedSignupAttempt({
      attemptId,
      adminUserId,
      nonce: req.body?.nonce,
      code: req.body?.code,
      session: req.body?.session,
    });
    res.json({ status });
  } catch (error) {
    handleError(res, error);
  }
};
