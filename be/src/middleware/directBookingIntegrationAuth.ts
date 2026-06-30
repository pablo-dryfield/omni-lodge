import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import authMiddleware from './authMiddleware.js';
import { getConfigValue } from '../services/configService.js';

const timingSafeEqualString = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const readConfiguredApiKey = (): string | null => {
  const configured = String(getConfigValue('DIRECT_BOOKINGS_API_KEY') ?? '').trim();
  return configured || null;
};

const readCandidateApiKey = (req: Request): string | null => {
  const headerValue = req.headers['x-api-key'];

  if (typeof headerValue === 'string') {
    const trimmed = headerValue.trim();
    return trimmed || null;
  }

  if (Array.isArray(headerValue)) {
    const first = String(headerValue[0] ?? '').trim();
    return first || null;
  }

  return null;
};

export const directBookingIntegrationAuth = (req: Request, res: Response, next: NextFunction): void => {
  const configuredApiKey = readConfiguredApiKey();
  const candidateApiKey = readCandidateApiKey(req);

  if (configuredApiKey && candidateApiKey && timingSafeEqualString(candidateApiKey, configuredApiKey)) {
    next();
    return;
  }

  void authMiddleware(req, res, next);
};

