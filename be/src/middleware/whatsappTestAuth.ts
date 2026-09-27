import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getWhatsAppTestConfig } from '../config/whatsappConfig.js';
import { refreshConfigCacheKeys } from '../services/configService.js';

const CONFIG_KEYS = [
  'WHATSAPP_TEST_API_TOKEN',
  'WHATSAPP_TEST_RECIPIENT',
  'WHATSAPP_TEST_TEMPLATE_NAME',
  'WHATSAPP_TEST_TEMPLATE_LANGUAGE',
] as const;

const equal = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const whatsappTestAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  let configuredToken: string;
  try {
    await refreshConfigCacheKeys(CONFIG_KEYS);
    configuredToken = getWhatsAppTestConfig().apiToken;
  } catch {
    res.status(503).json({ error: 'WhatsApp delivery testing is not configured.' });
    return;
  }
  const match = /^Bearer\s+([^\s]+)$/i.exec((req.get('authorization') ?? '').trim());
  if (!match?.[1] || !equal(match[1], configuredToken)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  next();
};
