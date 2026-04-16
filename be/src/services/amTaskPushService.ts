import webpush, { type PushSubscription } from 'web-push';
import AssistantManagerTaskPushSubscription from '../models/AssistantManagerTaskPushSubscription.js';
import Notification from '../models/Notification.js';
import { getConfigValue } from './configService.js';
import logger from '../utils/logger.js';

export type AmTaskPushSubscriptionPayload = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type AmTaskPushNotificationPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  renotify?: boolean;
  requireInteraction?: boolean;
  silent?: boolean;
  taskLogId?: number;
  eventType?: 'reminder' | 'start';
};

const resolveBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeExpirationTime = (value: unknown): string | null => {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return String(Math.trunc(numeric));
};

const toPushSubscription = (
  subscription: AssistantManagerTaskPushSubscription,
): PushSubscription => {
  const expirationTimeRaw =
    typeof subscription.expirationTime === 'string'
      ? Number(subscription.expirationTime)
      : Number(subscription.expirationTime ?? NaN);
  return {
    endpoint: subscription.endpoint,
    expirationTime:
      Number.isFinite(expirationTimeRaw) && expirationTimeRaw > 0
        ? expirationTimeRaw
        : null,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };
};

let cachedSignature: string | null = null;
let cachedConfigured = false;

const ensureAmTaskPushConfigured = (): {
  enabled: boolean;
  publicKey: string | null;
} => {
  const enabledFlag = resolveBoolean(getConfigValue('AM_TASK_PUSH_ENABLED'), true);
  const subject = normalizeString(getConfigValue('AM_TASK_PUSH_VAPID_SUBJECT'));
  const publicKey = normalizeString(getConfigValue('AM_TASK_PUSH_VAPID_PUBLIC_KEY'));
  const privateKey = normalizeString(getConfigValue('AM_TASK_PUSH_VAPID_PRIVATE_KEY'));
  const signature = JSON.stringify({ enabledFlag, subject, publicKey, privateKey });

  if (signature === cachedSignature) {
    return { enabled: cachedConfigured, publicKey };
  }

  cachedSignature = signature;
  cachedConfigured = false;

  if (!enabledFlag) {
    return { enabled: false, publicKey };
  }

  if (!subject || !publicKey || !privateKey) {
    return { enabled: false, publicKey };
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    cachedConfigured = true;
    return { enabled: true, publicKey };
  } catch (error) {
    logger.error(
      `[am-task-push] Failed to initialize Web Push VAPID details: ${
        (error as Error).message
      }`,
    );
    return { enabled: false, publicKey };
  }
};

export const getAmTaskPushPublicKey = (): string | null =>
  ensureAmTaskPushConfigured().publicKey;

export const isAmTaskPushEnabled = (): boolean =>
  ensureAmTaskPushConfigured().enabled;

export const upsertAmTaskPushSubscription = async (options: {
  userId: number;
  subscription: AmTaskPushSubscriptionPayload;
  userAgent?: string | null;
}): Promise<AssistantManagerTaskPushSubscription> => {
  const { userId, subscription, userAgent } = options;
  const endpoint = normalizeString(subscription.endpoint);
  const p256dh = normalizeString(subscription.keys?.p256dh);
  const auth = normalizeString(subscription.keys?.auth);

  if (!endpoint || !p256dh || !auth) {
    throw new Error('Invalid push subscription payload');
  }

  const expirationTime = normalizeExpirationTime(subscription.expirationTime);
  const normalizedUserAgent = normalizeString(userAgent ?? null);

  const existing = await AssistantManagerTaskPushSubscription.findOne({
    where: { endpoint },
  });

  if (existing) {
    await existing.update({
      userId,
      p256dh,
      auth,
      expirationTime,
      userAgent: normalizedUserAgent,
      isActive: true,
      lastFailureAt: null,
      lastFailureReason: null,
    });
    return existing;
  }

  return AssistantManagerTaskPushSubscription.create({
    userId,
    endpoint,
    p256dh,
    auth,
    expirationTime,
    userAgent: normalizedUserAgent,
    isActive: true,
  });
};

export const deleteAmTaskPushSubscription = async (options: {
  userId: number;
  endpoint: string;
}): Promise<number> => {
  const endpoint = normalizeString(options.endpoint);
  if (!endpoint) {
    return 0;
  }
  return AssistantManagerTaskPushSubscription.destroy({
    where: {
      userId: options.userId,
      endpoint,
    },
  });
};

export const countActiveAmTaskPushSubscriptionsForUser = async (
  userId: number,
): Promise<number> =>
  AssistantManagerTaskPushSubscription.count({
    where: {
      userId,
      isActive: true,
    },
  });

export const sendAmTaskPushNotificationToUser = async (options: {
  userId: number;
  payload: AmTaskPushNotificationPayload;
}): Promise<boolean> => {
  if (!ensureAmTaskPushConfigured().enabled) {
    return false;
  }

  const subscriptions = await AssistantManagerTaskPushSubscription.findAll({
    where: {
      userId: options.userId,
      isActive: true,
    },
  });

  if (subscriptions.length === 0) {
    return false;
  }

  const payloadJson = JSON.stringify(options.payload);
  let successCount = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(toPushSubscription(subscription), payloadJson, {
        TTL: 300,
        urgency: 'high',
      });
      successCount += 1;
      await subscription.update({
        lastSuccessAt: new Date(),
        lastFailureAt: null,
        lastFailureReason: null,
        isActive: true,
      });
    } catch (error) {
      const pushError = error as Error & { statusCode?: number; body?: unknown };
      const statusCode = Number(pushError.statusCode ?? NaN);
      const shouldDeactivate = statusCode === 404 || statusCode === 410;
      const message = pushError.message?.trim() || 'Unknown push send failure';
      await subscription.update({
        lastFailureAt: new Date(),
        lastFailureReason: message.slice(0, 1000),
        isActive: shouldDeactivate ? false : subscription.isActive,
      });
      logger.warn(
        `[am-task-push] Failed to send push to subscription ${subscription.id}: ${message}`,
      );
    }
  }

  if (
    successCount > 0 &&
    (options.payload.taskLogId != null || options.payload.eventType != null)
  ) {
    try {
      await Notification.create({
        userId: options.userId,
        channel: 'in_app',
        templateKey:
          options.payload.eventType != null
            ? `am_task_${options.payload.eventType}`
            : 'am_task_push',
        payloadJson: {
          title: options.payload.title,
          body: options.payload.body,
          url: options.payload.url ?? null,
          tag: options.payload.tag ?? null,
          taskLogId: options.payload.taskLogId ?? null,
          eventType: options.payload.eventType ?? null,
        },
        sentAt: new Date(),
      });
    } catch (error) {
      logger.warn(
        `[am-task-push] Sent push but failed to persist in-app notification for user ${options.userId}: ${
          (error as Error).message
        }`,
      );
    }
  }

  return successCount > 0;
};
