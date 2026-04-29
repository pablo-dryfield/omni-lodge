import type { Response } from 'express';
import type { FindOptions, OrderItem } from 'sequelize';
import Notification from '../models/Notification.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  countActiveAmTaskPushSubscriptionsForUser,
  isAmTaskPushEnabled,
  listAmTaskPushSubscriptionsForUser,
  sendAmTaskPushNotificationToUserDetailed,
  summarizeAmTaskPushFailures,
  type AmTaskPushSubscriptionDebugItem,
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
  attemptedDeviceCount: number;
  successfulDeviceCount: number;
  failedDeviceCount: number;
  deactivatedDeviceCount: number;
  failureSummaries: string[];
};

type NotificationPushSubscriptionDebugResponse = {
  userId: number;
  totalSubscriptions: number;
  activeSubscriptions: number;
  items: AmTaskPushSubscriptionDebugItem[];
  recentTestEvents: NotificationPushReceiptEvent[];
};

type NotificationPushReceiptEventType =
  | 'push_received'
  | 'notification_shown'
  | 'notification_show_failed'
  | 'notification_clicked'
  | 'notification_closed';

type NotificationPushReceiptEvent = {
  notificationId: number;
  tag: string;
  eventType: NotificationPushReceiptEventType;
  at: string;
  targetUrl: string | null;
  userAgent: string | null;
  visibilityState: string | null;
  error: string | null;
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

const PUSH_RECEIPT_EVENT_TYPES = new Set<NotificationPushReceiptEventType>([
  'push_received',
  'notification_shown',
  'notification_show_failed',
  'notification_clicked',
  'notification_closed',
]);

const parsePushReceiptEventType = (
  value: unknown,
): NotificationPushReceiptEventType | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase() as NotificationPushReceiptEventType;
  return PUSH_RECEIPT_EVENT_TYPES.has(normalized) ? normalized : null;
};

const asOptionalNonEmptyString = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

const extractNotificationTag = (notification: Notification): string | null => {
  const payload = notification.payloadJson as Record<string, unknown> | null;
  const tagValue = payload?.tag;
  return typeof tagValue === 'string' && tagValue.trim() ? tagValue.trim() : null;
};

const findLatestNotificationByTag = async (
  userId: number,
  tag: string,
): Promise<Notification | null> => {
  const candidates = await Notification.findAll({
    where: {
      userId,
      channel: 'in_app',
    },
    order: [
      ['sentAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: 150,
  });

  return candidates.find((entry) => extractNotificationTag(entry) === tag) ?? null;
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
    const deliveryResult = await sendAmTaskPushNotificationToUserDetailed({
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
    const sent = deliveryResult.successCount > 0;

    if (!sent) {
      res.status(400).json([
        {
          message: 'Push send failed for every active subscription.',
          details: summarizeAmTaskPushFailures(deliveryResult.failures),
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
      attemptedDeviceCount: deliveryResult.attemptedCount,
      successfulDeviceCount: deliveryResult.successCount,
      failedDeviceCount: deliveryResult.failureCount,
      deactivatedDeviceCount: deliveryResult.deactivatedCount,
      failureSummaries: summarizeAmTaskPushFailures(deliveryResult.failures),
    };
    res.status(200).json([{ data: payload, columns: [] }]);
  } catch (error) {
    console.error('Failed to send notification center push test', error);
    res.status(500).json([{ message: 'Failed to send test notification' }]);
  }
};

export const listNotificationPushSubscriptions = async (
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

    const targetUserId = parsePositiveInt(req.query.userId, 0);
    if (targetUserId <= 0) {
      res.status(400).json([{ message: 'userId is required' }]);
      return;
    }

    const items = await listAmTaskPushSubscriptionsForUser(targetUserId);
    const testNotifications = await Notification.findAll({
      where: {
        userId: targetUserId,
        channel: 'in_app',
        templateKey: 'notification_center_test',
      },
      order: [
        ['sentAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: 30,
    });

    const recentTestEvents: NotificationPushReceiptEvent[] = [];
    for (const notification of testNotifications) {
      const payload = notification.payloadJson as Record<string, unknown> | null;
      const tag = extractNotificationTag(notification);
      if (!payload || !tag) {
        continue;
      }
      const pushDebug = payload.pushDebug as Record<string, unknown> | null;
      const events = Array.isArray(pushDebug?.events) ? pushDebug?.events : [];
      for (const event of events) {
        if (!event || typeof event !== 'object') {
          continue;
        }
        const record = event as Record<string, unknown>;
        const eventType = parsePushReceiptEventType(record.eventType);
        const at = asOptionalNonEmptyString(record.at, 64);
        if (!eventType || !at) {
          continue;
        }
        recentTestEvents.push({
          notificationId: notification.id,
          tag,
          eventType,
          at,
          targetUrl: asOptionalNonEmptyString(record.targetUrl, 300),
          userAgent: asOptionalNonEmptyString(record.userAgent, 500),
          visibilityState: asOptionalNonEmptyString(record.visibilityState, 40),
          error: asOptionalNonEmptyString(record.error, 500),
        });
      }
    }

    recentTestEvents.sort((left, right) => {
      const leftTime = new Date(left.at).getTime();
      const rightTime = new Date(right.at).getTime();
      return rightTime - leftTime;
    });

    const payload: NotificationPushSubscriptionDebugResponse = {
      userId: targetUserId,
      totalSubscriptions: items.length,
      activeSubscriptions: items.filter((item) => item.isActive).length,
      items,
      recentTestEvents: recentTestEvents.slice(0, 50),
    };

    res.status(200).json([{ data: payload, columns: [] }]);
  } catch (error) {
    console.error('Failed to list notification push subscriptions', error);
    res.status(500).json([{ message: 'Failed to load push subscriptions' }]);
  }
};

export const recordNotificationPushReceipt = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = req.authContext?.id ?? null;
    if (!actorId) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const tag = asOptionalNonEmptyString(body.tag, 200);
    const eventType = parsePushReceiptEventType(body.eventType);
    if (!tag || !eventType) {
      res.status(400).json([{ message: 'tag and eventType are required' }]);
      return;
    }

    const notification = await findLatestNotificationByTag(actorId, tag);
    if (!notification) {
      res.status(404).json([{ message: 'Matching notification not found' }]);
      return;
    }

    const payload = (notification.payloadJson ?? {}) as Record<string, unknown>;
    const pushDebug =
      payload.pushDebug && typeof payload.pushDebug === 'object'
        ? ({ ...(payload.pushDebug as Record<string, unknown>) } as Record<string, unknown>)
        : {};

    const existingEvents = Array.isArray(pushDebug.events)
      ? pushDebug.events.filter((entry) => entry && typeof entry === 'object')
      : [];

    const eventAt = new Date().toISOString();
    const nextEvent = {
      eventType,
      at: eventAt,
      targetUrl: asOptionalNonEmptyString(body.targetUrl, 300),
      userAgent:
        asOptionalNonEmptyString(
          body.userAgent,
          500,
        ) ??
        asOptionalNonEmptyString(req.get('user-agent') ?? null, 500),
      visibilityState: asOptionalNonEmptyString(body.visibilityState, 40),
      error: asOptionalNonEmptyString(body.error, 500),
    };

    const nextEvents = [...existingEvents, nextEvent].slice(-120);
    pushDebug.events = nextEvents;
    pushDebug.lastEventAt = eventAt;

    const nextPayload = {
      ...payload,
      pushDebug,
    };
    notification.payloadJson = nextPayload;
    notification.changed('payloadJson', true);
    await notification.save();

    res.status(204).send();
  } catch (error) {
    console.error('Failed to record notification push receipt', error);
    res.status(500).json([{ message: 'Failed to record push receipt' }]);
  }
};
