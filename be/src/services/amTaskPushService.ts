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

type WebPushErrorLike = Error & {
  statusCode?: number;
  body?: unknown;
};

export type AmTaskPushDeliveryFailure = {
  subscriptionId: number;
  endpoint: string;
  endpointHost: string | null;
  statusCode: number | null;
  shouldDeactivate: boolean;
  message: string;
  bodySnippet: string | null;
  failureReason: string;
};

export type AmTaskPushDeliveryResult = {
  attemptedCount: number;
  successCount: number;
  failureCount: number;
  deactivatedCount: number;
  failures: AmTaskPushDeliveryFailure[];
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

const truncateText = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

const toEndpointHost = (endpoint: string): string | null => {
  try {
    const parsed = new URL(endpoint);
    return parsed.host || null;
  } catch {
    return null;
  }
};

const stringifyErrorBody = (body: unknown): string | null => {
  if (body == null) {
    return null;
  }
  if (typeof body === 'string') {
    const trimmed = body.trim();
    return trimmed ? truncateText(trimmed, 500) : null;
  }
  try {
    const json = JSON.stringify(body);
    return json && json !== '{}' ? truncateText(json, 500) : null;
  } catch {
    return null;
  }
};

const buildFailureReason = (params: {
  message: string;
  statusCode: number | null;
  bodySnippet: string | null;
  shouldDeactivate: boolean;
}): string => {
  const segments = [params.message];
  if (params.statusCode != null) {
    segments.push(`status=${params.statusCode}`);
  }
  if (params.shouldDeactivate) {
    segments.push('subscription-deactivated');
  }
  if (params.bodySnippet) {
    segments.push(`body=${params.bodySnippet}`);
  }
  return truncateText(segments.join(' | '), 1000);
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

export type AmTaskPushSubscriptionDebugItem = {
  id: number;
  userId: number;
  endpoint: string;
  expirationTime: string | null;
  userAgent: string | null;
  isActive: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export const listAmTaskPushSubscriptionsForUser = async (
  userId: number,
): Promise<AmTaskPushSubscriptionDebugItem[]> => {
  const subscriptions = await AssistantManagerTaskPushSubscription.findAll({
    where: { userId },
    order: [
      ['isActive', 'DESC'],
      ['updatedAt', 'DESC'],
      ['id', 'DESC'],
    ],
  });

  return subscriptions.map((subscription) => ({
    id: subscription.id,
    userId: subscription.userId,
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    userAgent: subscription.userAgent ?? null,
    isActive: subscription.isActive === true,
    lastSuccessAt: subscription.lastSuccessAt
      ? new Date(subscription.lastSuccessAt).toISOString()
      : null,
    lastFailureAt: subscription.lastFailureAt
      ? new Date(subscription.lastFailureAt).toISOString()
      : null,
    lastFailureReason: subscription.lastFailureReason ?? null,
    createdAt: subscription.createdAt
      ? new Date(subscription.createdAt).toISOString()
      : null,
    updatedAt: subscription.updatedAt
      ? new Date(subscription.updatedAt).toISOString()
      : null,
  }));
};

export const sendAmTaskPushNotificationToUserDetailed = async (options: {
  userId: number;
  payload: AmTaskPushNotificationPayload;
}): Promise<AmTaskPushDeliveryResult> => {
  const emptyResult: AmTaskPushDeliveryResult = {
    attemptedCount: 0,
    successCount: 0,
    failureCount: 0,
    deactivatedCount: 0,
    failures: [],
  };

  if (!ensureAmTaskPushConfigured().enabled) {
    return emptyResult;
  }

  const subscriptions = await AssistantManagerTaskPushSubscription.findAll({
    where: {
      userId: options.userId,
      isActive: true,
    },
  });

  if (subscriptions.length === 0) {
    return emptyResult;
  }

  const payloadJson = JSON.stringify(options.payload);
  const failures: AmTaskPushDeliveryFailure[] = [];
  let successCount = 0;
  let deactivatedCount = 0;

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
      const pushError = error as WebPushErrorLike;
      const statusCode = Number(pushError.statusCode ?? NaN);
      const shouldDeactivate = statusCode === 404 || statusCode === 410;
      const message = pushError.message?.trim() || 'Unknown push send failure';
      const bodySnippet = stringifyErrorBody(pushError.body);
      const failureReason = buildFailureReason({
        message,
        statusCode: Number.isFinite(statusCode) ? statusCode : null,
        bodySnippet,
        shouldDeactivate,
      });

      await subscription.update({
        lastFailureAt: new Date(),
        lastFailureReason: failureReason,
        isActive: shouldDeactivate ? false : subscription.isActive,
      });
      if (shouldDeactivate) {
        deactivatedCount += 1;
      }
      failures.push({
        subscriptionId: subscription.id,
        endpoint: subscription.endpoint,
        endpointHost: toEndpointHost(subscription.endpoint),
        statusCode: Number.isFinite(statusCode) ? statusCode : null,
        shouldDeactivate,
        message,
        bodySnippet,
        failureReason,
      });
      logger.warn(
        `[am-task-push] Failed to send push to subscription ${subscription.id}: ${failureReason}`,
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

  const result: AmTaskPushDeliveryResult = {
    attemptedCount: subscriptions.length,
    successCount,
    failureCount: failures.length,
    deactivatedCount,
    failures,
  };

  return result;
};

export const sendAmTaskPushNotificationToUser = async (options: {
  userId: number;
  payload: AmTaskPushNotificationPayload;
}): Promise<boolean> => {
  const result = await sendAmTaskPushNotificationToUserDetailed(options);

  return result.successCount > 0;
};

export const summarizeAmTaskPushFailures = (
  failures: AmTaskPushDeliveryFailure[],
): string[] =>
  failures.slice(0, 5).map((failure) => {
    const parts = [`#${failure.subscriptionId}`];
    if (failure.endpointHost) {
      parts.push(failure.endpointHost);
    }
    if (failure.statusCode != null) {
      parts.push(`status ${failure.statusCode}`);
    }
    parts.push(failure.message);
    if (failure.shouldDeactivate) {
      parts.push('(deactivated)');
    }
    return parts.join(' | ');
  });
