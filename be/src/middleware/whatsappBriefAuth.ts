import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getWhatsAppBriefConfig } from '../config/whatsappConfig.js';

const timingSafeEqualString = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const readBearerToken = (req: Request): string | null => {
  const authorization = req.get('authorization') ?? '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
};

export const whatsappBriefAuth = (req: Request, res: Response, next: NextFunction): void => {
  let configuredToken: string;

  try {
    configuredToken = getWhatsAppBriefConfig().apiToken;
  } catch {
    res.status(503).json({ error: 'WhatsApp brief source is not configured.' });
    return;
  }

  const candidate = readBearerToken(req);
  if (!candidate || !timingSafeEqualString(candidate, configuredToken)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  next();
};
