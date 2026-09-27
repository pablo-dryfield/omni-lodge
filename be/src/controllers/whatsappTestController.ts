import type { Request, Response } from 'express';
import { getWhatsAppTestConfig } from '../config/whatsappConfig.js';
import HttpError from '../errors/HttpError.js';
import WhatsAppMessage from '../models/WhatsAppMessage.js';
import { sendWhatsAppTemplateMessage } from '../services/whatsappOutboundMessageService.js';

const PROVIDER_MESSAGE_ID = /^[^\u0000-\u001f\u007f]{1,256}$/;

const safeError = (res: Response, error: unknown): void => {
  if (error instanceof HttpError) {
    const details = error.details && typeof error.details === 'object'
      ? error.details as Record<string, unknown>
      : null;
    const code = typeof details?.code === 'string' ? details.code : undefined;
    res.status(error.status).json({ error: error.message, ...(code ? { code } : {}) });
    return;
  }
  res.status(500).json({ error: 'WhatsApp delivery test failed.' });
};

export const sendWhatsAppDeliveryTest = async (_req: Request, res: Response): Promise<void> => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const config = getWhatsAppTestConfig();
    const result = await sendWhatsAppTemplateMessage({
      recipient: config.recipient,
      templateName: config.templateName,
      languageCode: config.languageCode,
    });
    res.status(202).json({ messageId: result.messageId, status: 'accepted' });
  } catch (error) {
    safeError(res, error);
  }
};

export const getWhatsAppDeliveryTestStatus = async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Cache-Control', 'no-store');
  const messageId = req.params.messageId;
  if (!messageId || !PROVIDER_MESSAGE_ID.test(messageId)) {
    res.status(400).json({ error: 'Invalid WhatsApp message reference.' });
    return;
  }
  try {
    const message = await WhatsAppMessage.findOne({ where: { providerMessageId: messageId } });
    const status = message?.deliveryStatus ?? 'awaiting_webhook';
    const failure = status === 'failed'
      ? {
        code: message?.deliveryErrorCode ?? null,
        title: message?.deliveryErrorTitle ?? null,
        details: message?.deliveryErrorDetails ?? null,
      }
      : null;
    res.json({
      messageId,
      status,
      statusUpdatedAt: message?.statusUpdatedAt?.toISOString() ?? null,
      failure,
    });
  } catch (error) {
    safeError(res, error);
  }
};
