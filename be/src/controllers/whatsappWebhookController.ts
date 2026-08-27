import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import {
  getWhatsAppWebhookConfig,
  getWhatsAppWebhookVerificationConfig,
} from '../config/whatsappConfig.js';
import { kickWhatsAppWebhookQueue } from '../jobs/whatsappWebhookQueue.cron.js';
import { parseMetaWebhook, verifyMetaWebhookSignature } from '../services/whatsappWebhookParser.js';
import {
  enqueueWhatsAppWebhook,
  hashWhatsAppWebhookDelivery,
} from '../services/whatsappWebhookQueueService.js';
import logger from '../utils/logger.js';
import { refreshConfigCacheKeys } from '../services/configService.js';

const timingSafeEqualString = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const queryString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return null;
};

export const verifyWhatsAppWebhook = async (req: Request, res: Response): Promise<void> => {
  let verifyToken: string;
  try {
    await refreshConfigCacheKeys(['WHATSAPP_WEBHOOK_VERIFY_TOKEN']);
    verifyToken = getWhatsAppWebhookVerificationConfig().verifyToken;
  } catch {
    res.status(503).send('Webhook is not configured.');
    return;
  }

  const mode = queryString(req.query['hub.mode']);
  const challenge = queryString(req.query['hub.challenge']);
  const candidateToken = queryString(req.query['hub.verify_token']);

  if (
    mode === 'subscribe'
    && challenge !== null
    && candidateToken !== null
    && timingSafeEqualString(candidateToken, verifyToken)
  ) {
    res.status(200).type('text/plain').send(challenge);
    return;
  }

  res.status(403).send('Forbidden.');
};

export const receiveWhatsAppWebhook = async (req: Request, res: Response): Promise<void> => {
  if (!Buffer.isBuffer(req.body)) {
    res.status(400).send('Invalid webhook body.');
    return;
  }

  let config: ReturnType<typeof getWhatsAppWebhookConfig>;
  try {
    await refreshConfigCacheKeys([
      'WHATSAPP_META_APP_SECRET',
      'WHATSAPP_WABA_ID',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_ONBOARDING_GENERATION',
    ]);
    config = getWhatsAppWebhookConfig();
  } catch {
    res.status(503).send('Webhook is not configured.');
    return;
  }

  const signature = req.get('x-hub-signature-256') ?? undefined;
  if (!verifyMetaWebhookSignature(req.body, signature, config.appSecret)) {
    res.status(401).send('Invalid signature.');
    return;
  }

  let batch;
  try {
    batch = parseMetaWebhook(req.body, {
      wabaId: config.wabaId,
      phoneNumberId: config.phoneNumberId,
    });
  } catch {
    res.status(400).send('Invalid webhook payload.');
    return;
  }

  try {
    const result = await enqueueWhatsAppWebhook({
      batch,
      deliveryHash: hashWhatsAppWebhookDelivery(req.body),
    });
    logger.info(
      `[whatsapp] webhook accepted events=${batch.events.length} queued=${result.queued} duplicate=${result.duplicate}`,
    );
    res.status(200).type('text/plain').send('EVENT_RECEIVED');
    if (result.queued) kickWhatsAppWebhookQueue();
  } catch {
    logger.error('[whatsapp] webhook enqueue failed');
    res.status(500).send('Webhook enqueue failed.');
  }
};
