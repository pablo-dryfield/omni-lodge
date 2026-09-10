import type { NextFunction, Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';

import User from '../models/User.js';

const INTERNAL_TELEMETRY_HEADER = 'x-omnilodge-internal-telemetry';
const MIN_INTERNAL_TELEMETRY_SECRET_LENGTH = 32;

const digestSecret = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * Compare fixed-length digests so even differently sized candidate values use
 * the timing-safe primitive. The configured secret itself is never logged or
 * copied into monitoring data.
 */
export const isTrustedInternalTelemetrySecret = (
  candidate: string | null | undefined,
  configured: string | null | undefined,
): boolean => {
  const normalizedCandidate = String(candidate ?? '').trim();
  const normalizedConfigured = String(configured ?? '').trim();
  if (
    normalizedCandidate.length < MIN_INTERNAL_TELEMETRY_SECRET_LENGTH
    || normalizedConfigured.length < MIN_INTERNAL_TELEMETRY_SECRET_LENGTH
  ) return false;
  return timingSafeEqual(digestSecret(normalizedCandidate), digestSecret(normalizedConfigured));
};

const readInternalTelemetrySecret = (req: Request): { present: boolean; value: string | null } => {
  const raw = req.headers[INTERNAL_TELEMETRY_HEADER];
  if (raw === undefined) return { present: false, value: null };
  // Multiple values are always malformed; never pick one value from a
  // duplicated security-sensitive header.
  if (Array.isArray(raw)) return { present: true, value: null };
  return {
    present: true,
    value: typeof raw === 'string' && raw.trim() ? raw.trim() : null,
  };
};

/**
 * Adds a trusted user id when a valid normal session is available, while
 * intentionally keeping client-error ingestion usable before login and on
 * expired sessions. Never accepts a user id from the request body.
 */
const optionalErrorMonitoringAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const internalCandidate = readInternalTelemetrySecret(req);
  const configuredInternalSecret = String(process.env.ERROR_MONITORING_INTERNAL_SECRET ?? '').trim();
  req.monitoringTrustedInternal = false;
  if (internalCandidate.present) {
    if (configuredInternalSecret.length < MIN_INTERNAL_TELEMETRY_SECRET_LENGTH) {
      res.status(503).json({ message: 'Internal telemetry authentication is not configured.' });
      return;
    }
    if (!isTrustedInternalTelemetrySecret(internalCandidate.value, configuredInternalSecret)) {
      res.status(401).json({ message: 'Invalid internal telemetry credentials.' });
      return;
    }
    req.monitoringTrustedInternal = true;
  }

  const header = req.headers.authorization;
  const bearer = typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : null;
  const token = bearer || req.cookies?.token;
  if (!token) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as JwtPayload;
    if (!decoded || typeof decoded === 'string' || typeof decoded.id !== 'number') {
      next();
      return;
    }
    const user = await User.findOne({
      where: { id: decoded.id, status: true, approved: true },
      attributes: ['id'],
    });
    if (user) req.monitoringUserId = user.id;
  } catch {
    // Invalid/expired login state is useful client-error context but must not
    // make this otherwise public endpoint fail.
  }
  next();
};

export default optionalErrorMonitoringAuth;
