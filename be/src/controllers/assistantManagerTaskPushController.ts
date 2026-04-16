import type { Response } from 'express';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  countActiveAmTaskPushSubscriptionsForUser,
  deleteAmTaskPushSubscription,
  getAmTaskPushPublicKey,
  sendAmTaskPushNotificationToUser,
  isAmTaskPushEnabled,
  upsertAmTaskPushSubscription,
  type AmTaskPushSubscriptionPayload,
} from '../services/amTaskPushService.js';

const getActorId = (req: AuthenticatedRequest): number | null =>
  req.authContext?.id ?? null;

const GLOBAL_TASK_VIEWER_ROLES = new Set(['admin', 'owner', 'manager']);

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
  if (collapsed === 'assistantmanager' || collapsed === 'assistmanager') {
    return 'assistant-manager';
  }
  if (collapsed === 'mgr' || collapsed === 'manager') {
    return 'manager';
  }
  return withHyphens;
};

const canTargetOtherUsers = (req: AuthenticatedRequest): boolean => {
  const normalizedRole = normalizeRoleSlug(req.authContext?.roleSlug ?? null);
  return normalizedRole != null && GLOBAL_TASK_VIEWER_ROLES.has(normalizedRole);
};

const parsePositiveInt = (value: unknown): number | null => {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }
  return null;
};

const parseSubscriptionPayload = (
  source: unknown,
): AmTaskPushSubscriptionPayload | null => {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const payload = source as {
    endpoint?: unknown;
    expirationTime?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown } | null;
  };

  const endpoint =
    typeof payload.endpoint === 'string' ? payload.endpoint.trim() : '';
  const p256dh =
    typeof payload.keys?.p256dh === 'string' ? payload.keys.p256dh.trim() : '';
  const auth =
    typeof payload.keys?.auth === 'string' ? payload.keys.auth.trim() : '';

  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  const expirationNumeric =
    payload.expirationTime == null ? null : Number(payload.expirationTime);
  const expirationTime =
    expirationNumeric != null && Number.isFinite(expirationNumeric)
      ? Math.trunc(expirationNumeric)
      : null;

  return {
    endpoint,
    expirationTime,
    keys: {
      p256dh,
      auth,
    },
  };
};

export const getTaskPushConfig = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  res.status(200).json([
    {
      data: {
        enabled: isAmTaskPushEnabled(),
        publicKey: getAmTaskPushPublicKey(),
      },
      columns: [],
    },
  ]);
};

export const upsertTaskPushSubscription = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = getActorId(req);
    if (!actorId) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const parsedSubscription = parseSubscriptionPayload(
      (req.body as { subscription?: unknown } | null)?.subscription,
    );
    if (!parsedSubscription) {
      res.status(400).json([{ message: 'Invalid push subscription payload' }]);
      return;
    }

    await upsertAmTaskPushSubscription({
      userId: actorId,
      subscription: parsedSubscription,
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(200).json([{ message: 'Push subscription saved' }]);
  } catch (error) {
    console.error('Failed to save assistant manager push subscription', error);
    res.status(500).json([{ message: 'Failed to save push subscription' }]);
  }
};

export const deleteTaskPushSubscription = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = getActorId(req);
    if (!actorId) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const endpoint =
      typeof (req.body as { endpoint?: unknown } | null)?.endpoint === 'string'
        ? ((req.body as { endpoint?: string }).endpoint ?? '').trim()
        : '';
    if (!endpoint) {
      res.status(400).json([{ message: 'endpoint is required' }]);
      return;
    }

    await deleteAmTaskPushSubscription({ userId: actorId, endpoint });
    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete assistant manager push subscription', error);
    res.status(500).json([{ message: 'Failed to delete push subscription' }]);
  }
};

export const sendTaskPushTestNotification = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = getActorId(req);
    if (!actorId) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const requestedUserId = parsePositiveInt((req.body as { userId?: unknown } | null)?.userId);
    const targetUserId = requestedUserId ?? actorId;

    if (targetUserId !== actorId && !canTargetOtherUsers(req)) {
      res.status(403).json([{ message: 'Forbidden' }]);
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
            'Selected user has no active push subscription. Ask them to open task dashboard and click Enable Background.',
        },
      ]);
      return;
    }

    const timestamp = new Date().toISOString();
    const uniqueTagSuffix = Date.now();
    const sent = await sendAmTaskPushNotificationToUser({
      userId: targetUserId,
      payload: {
        title: 'Test notification',
        body: `Push is working for this user (${timestamp}).`,
        url: '/assistant-manager-tasks?section=dashboard',
        tag: `am-task-test-${targetUserId}-${uniqueTagSuffix}`,
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

    res.status(200).json([
      {
        data: {
          userId: targetUserId,
          sent: true,
        },
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to send assistant manager push test notification', error);
    res.status(500).json([{ message: 'Failed to send test notification' }]);
  }
};
