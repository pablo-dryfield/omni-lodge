import type { Response } from 'express';
import type { FindOptions, OrderItem } from 'sequelize';
import Notification from '../models/Notification.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  countActiveAmTaskPushSubscriptionsForUser,
  isAmTaskPushEnabled,
  sendAmTaskPushNotificationToUser,
} from '../services/amTaskPushService.js';

type NotificationListItem = {
  id: number;
  channel: 'in_app' | 'email';
  templateKey: string;
  title: string;
  body: string | null;
  url: string | null;
  sentAt: string;
};

type NotificationPushTestResponse = {
  userId: number;
  sent: boolean;
  targetedDeviceCount: number;
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

const parseOptionalString = (
  value: unknown,
  options?: { maxLength?: number; allowEmpty?: boolean },
): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!options?.allowEmpty && !trimmed) {
    return null;
  }
  const maxLength = options?.maxLength ?? 500;
  if (trimmed.length > maxLength) {
    return trimmed.slice(0, maxLength);
  }
  return trimmed;
};

const TESTER_ALLOWED_ROLES = new Set(['admin', 'owner', 'manager', 'assistant-manager']);

const normalizeRoleSlug = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  const withHyphens = trimmed.replace(/[\s_]+/g, '-');
  const collapsed = withHyphens.replace(/-/g, '');
  if (collapsed === 'administrator') {
    return 'admin';
  }
  if (collapsed === 'assistmanager' || collapsed === 'assistantmanager') {
    return 'assistant-manager';
  }
  if (collapsed === 'mgr') {
    return 'manager';
  }
  return withHyphens;
};

const canUseNotificationTester = (req: AuthenticatedRequest): boolean => {
  const roleSlug = normalizeRoleSlug(req.authContext?.roleSlug ?? null);
  return roleSlug != null && TESTER_ALLOWED_ROLES.has(roleSlug);
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

export const sendNotificationPushTest = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = req.authContext?.id ?? null;
    if (!actorId) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    if (!canUseNotificationTester(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const targetUserId = parsePositiveInt(
      (req.body as { userId?: unknown } | null)?.userId,
      0,
    );
    if (targetUserId <= 0) {
      res.status(400).json([{ message: 'userId is required' }]);
      return;
    }

    if (!isAmTaskPushEnabled()) {
      res.status(400).json([
        { message: 'Background push is not enabled in backend configuration' },
      ]);
      return;
    }

    const activeSubscriptionCount =
      await countActiveAmTaskPushSubscriptionsForUser(targetUserId);
    if (activeSubscriptionCount <= 0) {
      res.status(400).json([
        {
          message:
            'Selected user has no active push subscription. Ask them to open assistant manager tasks and click Enable Background.',
        },
      ]);
      return;
    }

    const customTitle = parseOptionalString(
      (req.body as { title?: unknown } | null)?.title,
      { maxLength: 120 },
    );
    const customBody = parseOptionalString(
      (req.body as { body?: unknown } | null)?.body,
      { maxLength: 500 },
    );
    const customUrl = parseOptionalString(
      (req.body as { url?: unknown } | null)?.url,
      { maxLength: 300, allowEmpty: false },
    );
    const timestamp = new Date().toISOString();
    const title = customTitle ?? 'Notification Center test';
    const body = customBody ?? `Push notification test sent at ${timestamp}.`;
    const tag = `notification-center-test-${targetUserId}-${Date.now()}`;
    const sent = await sendAmTaskPushNotificationToUser({
      userId: targetUserId,
      payload: {
        title,
        body,
        url: customUrl ?? '/notifications',
        tag,
        renotify: true,
        requireInteraction: true,
      },
    });

    if (!sent) {
      res.status(400).json([
        {
          message:
            'Push send failed. Subscription may be expired or blocked on the client device.',
        },
      ]);
      return;
    }

    await Notification.create({
      userId: targetUserId,
      channel: 'in_app',
      templateKey: 'notification_center_test',
      payloadJson: {
        title,
        body,
        url: customUrl ?? '/notifications',
        tag,
        triggeredByUserId: actorId,
        triggeredAt: timestamp,
      },
      sentAt: new Date(),
    });

    const payload: NotificationPushTestResponse = {
      userId: targetUserId,
      sent: true,
      targetedDeviceCount: activeSubscriptionCount,
    };
    res.status(200).json([{ data: payload, columns: [] }]);
  } catch (error) {
    console.error('Failed to send notification center push test', error);
    res.status(500).json([{ message: 'Failed to send test notification' }]);
  }
};
