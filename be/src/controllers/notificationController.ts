import type { Response } from 'express';
import type { FindOptions, OrderItem } from 'sequelize';
import Notification from '../models/Notification.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

type NotificationListItem = {
  id: number;
  channel: 'in_app' | 'email';
  templateKey: string;
  title: string;
  body: string | null;
  url: string | null;
  sentAt: string;
};

const parsePositiveInt = (
  value: unknown,
  fallback: number,
  bounds?: { min?: number; max?: number },
): number => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  const min = bounds?.min ?? 1;
  const max = bounds?.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(Math.max(numeric, min), max);
};

const prettifyTemplateKey = (templateKey: string): string =>
  templateKey
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const toListItem = (notification: Notification): NotificationListItem => {
  const payload = (notification.payloadJson ?? {}) as Record<string, unknown>;
  const payloadTitle =
    typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : null;
  const payloadBody =
    typeof payload.body === 'string' && payload.body.trim()
      ? payload.body.trim()
      : null;
  const payloadUrl =
    typeof payload.url === 'string' && payload.url.trim() ? payload.url.trim() : null;

  return {
    id: notification.id,
    channel: notification.channel,
    templateKey: notification.templateKey,
    title: payloadTitle ?? prettifyTemplateKey(notification.templateKey),
    body: payloadBody,
    url: payloadUrl,
    sentAt: new Date(notification.sentAt).toISOString(),
  };
};

export const listMyNotifications = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = req.authContext?.id ?? null;
    if (!actorId) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const limit = parsePositiveInt(req.query.limit, 50, { min: 1, max: 200 });
    const offset = parsePositiveInt(req.query.offset, 0, {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });
    const includeAllChannels = String(req.query.includeAllChannels ?? '').toLowerCase() === 'true';

    const where: FindOptions['where'] = includeAllChannels
      ? { userId: actorId }
      : { userId: actorId, channel: 'in_app' };
    const order: OrderItem[] = [
      ['sentAt', 'DESC'],
      ['id', 'DESC'],
    ];

    const result = await Notification.findAndCountAll({
      where,
      order,
      limit,
      offset,
    });

    res.status(200).json({
      items: result.rows.map(toListItem),
      total: result.count,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Failed to list notifications', error);
    res.status(500).json([{ message: 'Failed to list notifications' }]);
  }
};
