import crypto from 'node:crypto';
import { Op, UniqueConstraintError } from 'sequelize';
import {
  getWhatsAppEmbeddedSignupConfig,
  getWhatsAppWebhookQueueConfig,
  getWhatsAppWebhookVerificationConfig,
  WhatsAppConfigError,
} from '../config/whatsappConfig.js';
import sequelize from '../config/database.js';
import HttpError from '../errors/HttpError.js';
import WhatsAppEmbeddedSignupAttempt, {
  type WhatsAppOnboardingOperationStatus,
} from '../models/WhatsAppEmbeddedSignupAttempt.js';
import WhatsAppSourceState from '../models/WhatsAppSourceState.js';
import {
  getConfigValueRaw,
  refreshConfigCacheKeys,
  updateSystemConfigValues,
} from './configService.js';
import {
  WhatsAppMetaGraphClient,
  WhatsAppMetaGraphError,
  type WhatsAppCoexistenceSyncType,
} from './whatsappMetaGraphClient.js';
import { getWhatsAppSourceStatus, type WhatsAppSourceStatus } from './whatsappMessageService.js';

const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const PROCESSING_STALE_MS = 15 * 60 * 1000;
const SYNC_RECOVERY_LEASE_MS = 30 * 1000;
const NUMERIC_META_ID = /^\d{1,64}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LAUNCH_CONFIG_KEYS = [
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'WHATSAPP_META_APP_ID',
  'WHATSAPP_META_APP_SECRET',
  'WHATSAPP_META_GRAPH_API_VERSION',
  'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID',
] as const;
const WEBHOOK_QUEUE_CONFIG_KEYS = [
  'WHATSAPP_WEBHOOK_QUEUE_KEYRING',
  'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID',
  'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY',
  'WHATSAPP_WEBHOOK_QUEUE_PREVIOUS_KEYS',
] as const;
const CONNECTION_CONFIG_KEYS = [
  'WHATSAPP_BUSINESS_ACCESS_TOKEN',
  'WHATSAPP_WABA_ID',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ONBOARDING_GENERATION',
] as const;

type JsonRecord = Record<string, unknown>;

export interface WhatsAppEmbeddedSignupSession {
  type: 'WA_EMBEDDED_SIGNUP';
  event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
  version: string | number;
  data: {
    wabaId: string;
    phoneNumberId: string | null;
  };
}

export interface WhatsAppAdminSafeAttempt {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'expired';
  expiresAt: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  onboardingGeneration: string | null;
  subscriptionStatus: string;
  appStateSyncStatus: string;
  historySyncStatus: string;
  errorCode: string | null;
  recoveryRequired: boolean;
  completedAt: string | null;
  createdAt: string;
}

export interface WhatsAppAdminStatus {
  connected: boolean;
  coexistenceVerified: boolean;
  launchConfigured: boolean;
  businessAccessTokenConfigured: boolean;
  configuration: {
    launchConfigured: boolean;
    webhookVerifyTokenConfigured: boolean;
    metaAppSecretConfigured: boolean;
    businessAccessTokenConfigured: boolean;
  };
  wabaId: string | null;
  phoneNumberId: string | null;
  onboardingGeneration: string | null;
  latestAttempt: WhatsAppAdminSafeAttempt | null;
  source: WhatsAppSourceStatus;
}

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;

const asIso = (value: unknown): string | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};

const configured = (key: string): boolean => Boolean(getConfigValueRaw(key)?.trim());

const nonceHash = (nonce: string): string =>
  crypto.createHash('sha256').update(nonce, 'utf8').digest('hex');

const nonceMatches = (candidate: string, expectedHash: string): boolean => {
  const candidateBuffer = Buffer.from(nonceHash(candidate), 'hex');
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  return candidateBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
};

const attemptErrorCode = (error: unknown): string => {
  if (error instanceof WhatsAppMetaGraphError) {
    return error.safeCode;
  }
  if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
    return 'ONBOARDING_REQUEST_INVALID';
  }
  return 'ONBOARDING_INTERNAL_ERROR';
};

const safeAttempt = (
  attempt: WhatsAppEmbeddedSignupAttempt | null,
  now = new Date(),
): WhatsAppAdminSafeAttempt | null => {
  if (!attempt) return null;
  const expiresAt = asIso(attempt.expiresAt) ?? now.toISOString();
  const effectiveStatus = attempt.status === 'pending'
    && new Date(expiresAt).getTime() <= now.getTime()
      ? 'expired'
      : attempt.status;
  const operationStarted = attempt.subscriptionStatus !== 'not_started'
    || attempt.appStateSyncStatus !== 'not_started'
    || attempt.historySyncStatus !== 'not_started';
  const hasConsumedOrAmbiguousOperation = attempt.subscriptionStatus === 'unknown'
    || ['claimed', 'succeeded', 'unknown'].includes(attempt.appStateSyncStatus)
    || ['claimed', 'succeeded', 'unknown'].includes(attempt.historySyncStatus);
  const updatedAt = asIso(attempt.updatedAt);
  const staleProcessing = effectiveStatus === 'processing'
    && operationStarted
    && updatedAt !== null
    && new Date(updatedAt).getTime() <= now.getTime() - PROCESSING_STALE_MS;
  return {
    id: attempt.id,
    status: effectiveStatus,
    expiresAt,
    wabaId: attempt.wabaId ?? null,
    phoneNumberId: attempt.phoneNumberId ?? null,
    onboardingGeneration: attempt.onboardingGeneration ?? null,
    subscriptionStatus: attempt.subscriptionStatus,
    appStateSyncStatus: attempt.appStateSyncStatus,
    historySyncStatus: attempt.historySyncStatus,
    errorCode: attempt.errorCode ?? null,
    recoveryRequired: staleProcessing
      || (effectiveStatus === 'failed' && hasConsumedOrAmbiguousOperation),
    completedAt: asIso(attempt.completedAt),
    createdAt: asIso(attempt.createdAt) ?? now.toISOString(),
  };
};

export const parseWhatsAppEmbeddedSignupSession = (
  value: unknown,
): WhatsAppEmbeddedSignupSession => {
  const session = asRecord(value);
  const data = asRecord(session?.data);
  const wabaId = data?.waba_id;
  const phoneNumberId = data?.phone_number_id;
  const version = session?.version;
  if (
    session?.type !== 'WA_EMBEDDED_SIGNUP'
    || session.event !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
    || (version !== 3 && version !== '3')
    || typeof wabaId !== 'string'
    || !NUMERIC_META_ID.test(wabaId)
    || (phoneNumberId !== undefined
      && (typeof phoneNumberId !== 'string' || !NUMERIC_META_ID.test(phoneNumberId)))
  ) {
    throw new HttpError(400, 'Invalid Embedded Signup completion session.');
  }
  return {
    type: 'WA_EMBEDDED_SIGNUP',
    event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    version,
    data: {
      wabaId,
      phoneNumberId: typeof phoneNumberId === 'string' ? phoneNumberId : null,
    },
  };
};

export const getWhatsAppAdminStatus = async (): Promise<WhatsAppAdminStatus> => {
  await refreshConfigCacheKeys([
    ...LAUNCH_CONFIG_KEYS,
    ...WEBHOOK_QUEUE_CONFIG_KEYS,
    ...CONNECTION_CONFIG_KEYS,
  ]);
  const tokenConfigured = configured('WHATSAPP_BUSINESS_ACCESS_TOKEN');
  const wabaId = getConfigValueRaw('WHATSAPP_WABA_ID')?.trim() || null;
  const phoneNumberId = getConfigValueRaw('WHATSAPP_PHONE_NUMBER_ID')?.trim() || null;
  const onboardingGeneration = getConfigValueRaw('WHATSAPP_ONBOARDING_GENERATION')?.trim() || null;
  const [latestAttempt, activationAttempt, source] = await Promise.all([
    WhatsAppEmbeddedSignupAttempt.findOne({ order: [['created_at', 'DESC']] }),
    onboardingGeneration && wabaId && phoneNumberId
      ? WhatsAppEmbeddedSignupAttempt.findOne({
          where: { onboardingGeneration, wabaId, phoneNumberId },
          order: [['created_at', 'DESC']],
        })
      : Promise.resolve(null),
    getWhatsAppSourceStatus(),
  ]);
  let webhookQueueConfigured = false;
  try {
    getWhatsAppWebhookQueueConfig();
    webhookQueueConfigured = true;
  } catch (error) {
    if (!(error instanceof WhatsAppConfigError)) throw error;
  }
  const launchConfigured = webhookQueueConfigured
    && configured('WHATSAPP_META_APP_ID')
    && configured('WHATSAPP_META_APP_SECRET')
    && configured('WHATSAPP_META_GRAPH_API_VERSION')
    && configured('WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID')
    && configured('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
  const latestSafeAttempt = safeAttempt(latestAttempt);
  const activationSafeAttempt = safeAttempt(activationAttempt);
  const activationAllowsConnection = activationSafeAttempt?.subscriptionStatus === 'succeeded';
  return {
    connected: Boolean(tokenConfigured && wabaId && phoneNumberId && activationAllowsConnection),
    coexistenceVerified: Boolean(
      activationSafeAttempt?.status === 'completed'
      && activationSafeAttempt.wabaId === wabaId
      && activationSafeAttempt.phoneNumberId === phoneNumberId,
    ),
    launchConfigured,
    businessAccessTokenConfigured: tokenConfigured,
    configuration: {
      launchConfigured,
      webhookVerifyTokenConfigured: configured('WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
      metaAppSecretConfigured: configured('WHATSAPP_META_APP_SECRET'),
      businessAccessTokenConfigured: tokenConfigured,
    },
    wabaId,
    phoneNumberId,
    onboardingGeneration,
    latestAttempt: latestSafeAttempt,
    source,
  };
};

export const createWhatsAppEmbeddedSignupAttempt = async (
  adminUserId: number,
  now = new Date(),
): Promise<{
  attempt: { id: string; nonce: string; expiresAt: string };
  launch: { appId: string; configId: string; graphApiVersion: string };
}> => {
  await refreshConfigCacheKeys([
    ...LAUNCH_CONFIG_KEYS,
    ...WEBHOOK_QUEUE_CONFIG_KEYS,
    ...CONNECTION_CONFIG_KEYS,
  ]);
  let launchConfig: ReturnType<typeof getWhatsAppEmbeddedSignupConfig>;
  try {
    getWhatsAppWebhookVerificationConfig();
    getWhatsAppWebhookQueueConfig();
    launchConfig = getWhatsAppEmbeddedSignupConfig();
  } catch (error) {
    if (error instanceof WhatsAppConfigError) {
      throw new HttpError(409, 'Complete the WhatsApp Meta configuration first.');
    }
    throw error;
  }
  const existingToken = getConfigValueRaw('WHATSAPP_BUSINESS_ACCESS_TOKEN')?.trim() || null;
  const existingWabaId = getConfigValueRaw('WHATSAPP_WABA_ID')?.trim() || null;
  const existingPhoneNumberId = getConfigValueRaw('WHATSAPP_PHONE_NUMBER_ID')?.trim() || null;
  const existingGeneration = getConfigValueRaw('WHATSAPP_ONBOARDING_GENERATION')?.trim() || null;
  if (existingToken && existingWabaId && existingPhoneNumberId && existingGeneration) {
    const activationAttempt = await WhatsAppEmbeddedSignupAttempt.findOne({
      where: {
        onboardingGeneration: existingGeneration,
        wabaId: existingWabaId,
        phoneNumberId: existingPhoneNumberId,
      },
      order: [['created_at', 'DESC']],
    });
    const syncWasConsumedOrAmbiguous = activationAttempt
      && [activationAttempt.appStateSyncStatus, activationAttempt.historySyncStatus]
        .some((status) => ['claimed', 'succeeded', 'unknown'].includes(status));
    if (
      !activationAttempt
      || activationAttempt.subscriptionStatus === 'succeeded'
      || activationAttempt.subscriptionStatus === 'unknown'
      || syncWasConsumedOrAmbiguous
    ) {
      throw new HttpError(
        409,
        'The current WhatsApp connection requires explicit offboarding or recovery first.',
      );
    }
  }
  await WhatsAppEmbeddedSignupAttempt.update(
    { status: 'expired', errorCode: 'ATTEMPT_EXPIRED' },
    {
      where: {
        [Op.or]: [
          { status: 'pending', expiresAt: { [Op.lte]: now } },
          {
            status: 'processing',
            updatedAt: { [Op.lte]: new Date(now.getTime() - PROCESSING_STALE_MS) },
            subscriptionStatus: 'not_started',
            appStateSyncStatus: 'not_started',
            historySyncStatus: 'not_started',
          },
        ],
      },
    },
  );
  await WhatsAppEmbeddedSignupAttempt.update(
    { status: 'expired', errorCode: 'ATTEMPT_REPLACED' },
    { where: { adminUserId, status: 'pending' } },
  );
  const active = await WhatsAppEmbeddedSignupAttempt.findOne({
    where: { status: { [Op.in]: ['pending', 'processing'] } },
  });
  if (active) {
    throw new HttpError(409, 'A WhatsApp Embedded Signup attempt is already active.');
  }

  const nonce = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + ATTEMPT_TTL_MS);
  let attempt: WhatsAppEmbeddedSignupAttempt;
  try {
    attempt = await WhatsAppEmbeddedSignupAttempt.create({
      id: crypto.randomUUID(),
      adminUserId,
      nonceHash: nonceHash(nonce),
      status: 'pending',
      expiresAt,
      subscriptionStatus: 'not_started',
      appStateSyncStatus: 'not_started',
      historySyncStatus: 'not_started',
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw new HttpError(409, 'A WhatsApp Embedded Signup attempt is already active.');
    }
    throw error;
  }
  return {
    attempt: { id: attempt.id, nonce, expiresAt: expiresAt.toISOString() },
    launch: {
      appId: launchConfig.appId,
      configId: launchConfig.configId,
      graphApiVersion: launchConfig.graphApiVersion,
    },
  };
};

const claimCompletion = async (params: {
  attemptId: string;
  adminUserId: number;
  nonce: string;
  now: Date;
  hasCompletionMaterial: boolean;
}): Promise<{
  attempt: WhatsAppEmbeddedSignupAttempt;
  mode: 'new' | 'completed' | 'resume_subscribed';
}> => {
  return sequelize.transaction(async (transaction) => {
    const attempt = await WhatsAppEmbeddedSignupAttempt.findByPk(params.attemptId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!attempt || attempt.adminUserId !== params.adminUserId) {
      throw new HttpError(404, 'Embedded Signup attempt not found.');
    }
    if (!NONCE_PATTERN.test(params.nonce) || !nonceMatches(params.nonce, attempt.nonceHash)) {
      throw new HttpError(403, 'Embedded Signup nonce is invalid.');
    }
    if (attempt.status === 'completed') {
      return { attempt, mode: 'completed' };
    }
    if (attempt.status === 'processing' && attempt.subscriptionStatus === 'succeeded') {
      const recoveryCutoff = new Date(params.now.getTime() - SYNC_RECOVERY_LEASE_MS);
      const latestActivityAt = [attempt.updatedAt, attempt.recoveryLeaseAt]
        .filter((value): value is Date => value instanceof Date)
        .reduce<Date | null>((latest, value) => (
          !latest || value.getTime() > latest.getTime() ? value : latest
        ), null);
      if (!latestActivityAt || latestActivityAt.getTime() > recoveryCutoff.getTime()) {
        throw new HttpError(409, 'Embedded Signup completion is still being processed.');
      }
      const staleClaimPatch: Record<string, unknown> = {};
      const claimedOperations = [
        {
          status: attempt.appStateSyncStatus,
          claimedAt: attempt.appStateSyncClaimedAt,
          statusField: 'appStateSyncStatus',
          completedAtField: 'appStateSyncCompletedAt',
        },
        {
          status: attempt.historySyncStatus,
          claimedAt: attempt.historySyncClaimedAt,
          statusField: 'historySyncStatus',
          completedAtField: 'historySyncCompletedAt',
        },
      ];
      for (const operation of claimedOperations) {
        if (operation.status !== 'claimed') continue;
        if (!operation.claimedAt || operation.claimedAt.getTime() > recoveryCutoff.getTime()) {
          throw new HttpError(409, 'Embedded Signup completion is still being processed.');
        }
        staleClaimPatch[operation.statusField] = 'unknown';
        staleClaimPatch[operation.completedAtField] = params.now;
      }
      await attempt.update({
        ...staleClaimPatch,
        recoveryLeaseAt: params.now,
        ...(Object.keys(staleClaimPatch).length > 0
          ? { errorCode: attempt.errorCode || 'SYNC_STATE_UNKNOWN' }
          : {}),
      }, { transaction });
      return { attempt, mode: 'resume_subscribed' };
    }
    if (attempt.expiresAt.getTime() <= params.now.getTime() && attempt.status === 'pending') {
      await attempt.update(
        { status: 'expired', errorCode: 'ATTEMPT_EXPIRED' },
        { transaction },
      );
      throw new HttpError(410, 'Embedded Signup attempt has expired.');
    }
    if (attempt.status !== 'pending') {
      throw new HttpError(409, 'Embedded Signup attempt cannot be completed again.');
    }
    if (!params.hasCompletionMaterial) {
      throw new HttpError(400, 'Embedded Signup completion material is required.');
    }
    await attempt.update({ status: 'processing', errorCode: null }, { transaction });
    return { attempt, mode: 'new' };
  });
};

const resolvePhoneNumberId = async (params: {
  client: WhatsAppMetaGraphClient;
  accessToken: string;
  wabaId: string;
  sessionPhoneNumberId: string | null;
}): Promise<string> => {
  const phoneIds = Array.from(new Set(
    await params.client.listWabaPhoneNumberIds(params.accessToken, params.wabaId),
  ));
  if (params.sessionPhoneNumberId) {
    if (!phoneIds.includes(params.sessionPhoneNumberId)) {
      throw new WhatsAppMetaGraphError('META_PHONE_WABA_MISMATCH', 200, false);
    }
    return params.sessionPhoneNumberId;
  }
  if (phoneIds.length !== 1 || !phoneIds[0]) {
    throw new WhatsAppMetaGraphError(
      phoneIds.length === 0 ? 'META_PHONE_NOT_FOUND' : 'META_PHONE_AMBIGUOUS',
      200,
      false,
    );
  }
  return phoneIds[0];
};

const claimSyncDispatch = async (
  attemptId: string,
  syncType: WhatsAppCoexistenceSyncType,
  now: Date,
): Promise<boolean> => {
  return sequelize.transaction(async (transaction) => {
    const attempt = await WhatsAppEmbeddedSignupAttempt.findByPk(attemptId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!attempt) {
      throw new HttpError(404, 'Embedded Signup attempt not found.');
    }
    const statusField = syncType === 'history' ? 'historySyncStatus' : 'appStateSyncStatus';
    const claimedAtField = syncType === 'history'
      ? 'historySyncClaimedAt'
      : 'appStateSyncClaimedAt';
    if (attempt[statusField] !== 'not_started') {
      return false;
    }
    await attempt.update({
      [statusField]: 'claimed',
      [claimedAtField]: now,
    }, { transaction });
    return true;
  });
};

const finishSyncDispatch = async (params: {
  attemptId: string;
  syncType: WhatsAppCoexistenceSyncType;
  status: Extract<WhatsAppOnboardingOperationStatus, 'succeeded' | 'failed' | 'unknown'>;
  requestId?: string | null;
  now: Date;
}): Promise<void> => {
  const statusField = params.syncType === 'history' ? 'historySyncStatus' : 'appStateSyncStatus';
  const requestIdField = params.syncType === 'history'
    ? 'historySyncRequestId'
    : 'appStateSyncRequestId';
  const completedAtField = params.syncType === 'history'
    ? 'historySyncCompletedAt'
    : 'appStateSyncCompletedAt';
  const [updatedCount] = await WhatsAppEmbeddedSignupAttempt.update({
    [statusField]: params.status,
    [requestIdField]: params.requestId ?? null,
    [completedAtField]: params.now,
  }, { where: { id: params.attemptId, [statusField]: 'claimed' } });
  if (updatedCount !== 1) {
    throw new HttpError(409, 'WhatsApp sync dispatch state requires recovery.');
  }
};

const dispatchSyncOnce = async (params: {
  attemptId: string;
  client: WhatsAppMetaGraphClient;
  accessToken: string;
  phoneNumberId: string;
  syncType: WhatsAppCoexistenceSyncType;
}): Promise<string | null> => {
  const claimed = await claimSyncDispatch(params.attemptId, params.syncType, new Date());
  if (!claimed) return null;
  let requestId: string;
  try {
    requestId = await params.client.dispatchCoexistenceSync(
      params.accessToken,
      params.phoneNumberId,
      params.syncType,
    );
  } catch (error) {
    const graphError = error instanceof WhatsAppMetaGraphError ? error : null;
    const safeCode = attemptErrorCode(error);
    try {
      await finishSyncDispatch({
        attemptId: params.attemptId,
        syncType: params.syncType,
        status: graphError?.ambiguous ? 'unknown' : 'failed',
        now: new Date(),
      });
    } catch {
      // The durable claim remains in place. Never turn a local persistence
      // failure into permission to repeat a one-shot provider request.
    }
    return safeCode;
  }

  try {
    await finishSyncDispatch({
      attemptId: params.attemptId,
      syncType: params.syncType,
      status: 'succeeded',
      requestId,
      now: new Date(),
    });
    return null;
  } catch {
    try {
      await finishSyncDispatch({
        attemptId: params.attemptId,
        syncType: params.syncType,
        status: 'unknown',
        now: new Date(),
      });
    } catch {
      // A claimed row is already terminal for retry purposes.
    }
    return 'SYNC_PERSISTENCE_UNKNOWN';
  }
};

const failAttempt = async (attemptId: string, error: unknown): Promise<void> => {
  await WhatsAppEmbeddedSignupAttempt.update({
    status: 'failed',
    errorCode: attemptErrorCode(error),
  }, { where: { id: attemptId, status: 'processing' } });
};

const finishSubscribedAttempt = async (params: {
  attemptId: string;
  client: WhatsAppMetaGraphClient;
  accessToken: string;
  phoneNumberId: string;
  onboardingGeneration: string;
}): Promise<WhatsAppAdminStatus> => {
  await WhatsAppSourceState.upsert({
    id: 1,
    status: 'connected',
    historySyncStatus: 'in_progress',
    historySyncProgress: null,
    onboardingGeneration: params.onboardingGeneration,
    disconnectedGeneration: null,
    lastErrorAt: null,
    lastErrorCode: null,
  });

  const appStateSyncError = await dispatchSyncOnce({
    attemptId: params.attemptId,
    client: params.client,
    accessToken: params.accessToken,
    phoneNumberId: params.phoneNumberId,
    syncType: 'smb_app_state_sync',
  });
  const historySyncError = await dispatchSyncOnce({
    attemptId: params.attemptId,
    client: params.client,
    accessToken: params.accessToken,
    phoneNumberId: params.phoneNumberId,
    syncType: 'history',
  });
  const persistedAttempt = await WhatsAppEmbeddedSignupAttempt.findByPk(params.attemptId);
  if (!persistedAttempt) {
    throw new HttpError(409, 'Embedded Signup attempt requires recovery.');
  }
  const persistedAppStateIssue = ['claimed', 'failed', 'unknown']
    .includes(persistedAttempt.appStateSyncStatus);
  const persistedHistoryIssue = ['claimed', 'failed', 'unknown']
    .includes(persistedAttempt.historySyncStatus);
  const persistedSyncError = persistedAppStateIssue || persistedHistoryIssue
    ? persistedAttempt.errorCode || 'SYNC_STATE_UNKNOWN'
    : null;
  const syncError = appStateSyncError ?? historySyncError ?? persistedSyncError;
  if (syncError) {
    await WhatsAppSourceState.upsert({
      id: 1,
      status: 'degraded',
      historySyncStatus: historySyncError || persistedHistoryIssue ? 'failed' : 'in_progress',
      onboardingGeneration: params.onboardingGeneration,
      lastErrorAt: new Date(),
      lastErrorCode: syncError.toLowerCase().slice(0, 64),
    });
  }
  const [completedCount] = await WhatsAppEmbeddedSignupAttempt.update({
    status: 'completed',
    completedAt: new Date(),
    errorCode: syncError,
  }, {
    where: {
      id: params.attemptId,
      status: 'processing',
      subscriptionStatus: 'succeeded',
    },
  });
  if (completedCount !== 1) {
    throw new HttpError(409, 'Embedded Signup attempt requires recovery.');
  }
  return getWhatsAppAdminStatus();
};

const resumeSubscribedAttempt = async (params: {
  attempt: WhatsAppEmbeddedSignupAttempt;
  graphClient?: WhatsAppMetaGraphClient;
}): Promise<WhatsAppAdminStatus> => {
  await refreshConfigCacheKeys([...LAUNCH_CONFIG_KEYS, ...CONNECTION_CONFIG_KEYS]);
  const config = getWhatsAppEmbeddedSignupConfig();
  const accessToken = getConfigValueRaw('WHATSAPP_BUSINESS_ACCESS_TOKEN')?.trim() || null;
  const wabaId = getConfigValueRaw('WHATSAPP_WABA_ID')?.trim() || null;
  const phoneNumberId = getConfigValueRaw('WHATSAPP_PHONE_NUMBER_ID')?.trim() || null;
  const onboardingGeneration = getConfigValueRaw('WHATSAPP_ONBOARDING_GENERATION')?.trim() || null;
  if (
    !accessToken
    || !wabaId
    || !phoneNumberId
    || !onboardingGeneration
    || params.attempt.wabaId !== wabaId
    || params.attempt.phoneNumberId !== phoneNumberId
    || params.attempt.onboardingGeneration !== onboardingGeneration
  ) {
    throw new HttpError(409, 'Embedded Signup attempt requires recovery.');
  }
  return finishSubscribedAttempt({
    attemptId: params.attempt.id,
    client: params.graphClient ?? new WhatsAppMetaGraphClient(config),
    accessToken,
    phoneNumberId,
    onboardingGeneration,
  });
};

export const completeWhatsAppEmbeddedSignupAttempt = async (params: {
  attemptId: string;
  adminUserId: number;
  nonce: unknown;
  code: unknown;
  session: unknown;
  graphClient?: WhatsAppMetaGraphClient;
  now?: Date;
}): Promise<WhatsAppAdminStatus> => {
  if (typeof params.nonce !== 'string' || !NONCE_PATTERN.test(params.nonce)) {
    throw new HttpError(400, 'Embedded Signup nonce is invalid.');
  }
  const hasCode = typeof params.code === 'string';
  const hasSession = params.session !== undefined && params.session !== null;
  const hasCompletionMaterial = hasCode && hasSession;
  let code: string | null = null;
  let session: WhatsAppEmbeddedSignupSession | null = null;
  if (hasCode || hasSession) {
    if (!hasCompletionMaterial || (params.code as string).length < 1
      || (params.code as string).length > 4096) {
      throw new HttpError(400, 'Embedded Signup authorization code is invalid.');
    }
    code = (params.code as string).trim();
    if (!code || code !== params.code) {
      throw new HttpError(400, 'Embedded Signup authorization code is invalid.');
    }
    session = parseWhatsAppEmbeddedSignupSession(params.session);
  }
  const claimed = await claimCompletion({
    attemptId: params.attemptId,
    adminUserId: params.adminUserId,
    nonce: params.nonce,
    now: params.now ?? new Date(),
    hasCompletionMaterial,
  });
  if (claimed.mode === 'completed') {
    return getWhatsAppAdminStatus();
  }
  if (claimed.mode === 'resume_subscribed') {
    return resumeSubscribedAttempt({ attempt: claimed.attempt, graphClient: params.graphClient });
  }
  if (!code || !session) {
    throw new HttpError(400, 'Embedded Signup completion material is required.');
  }

  try {
    await refreshConfigCacheKeys(LAUNCH_CONFIG_KEYS);
    const config = getWhatsAppEmbeddedSignupConfig();
    const client = params.graphClient ?? new WhatsAppMetaGraphClient(config);
    const accessToken = await client.exchangeEmbeddedSignupCode(code);
    await client.validateAccessToken(accessToken, session.data.wabaId);
    const phoneNumberId = await resolvePhoneNumberId({
      client,
      accessToken,
      wabaId: session.data.wabaId,
      sessionPhoneNumberId: session.data.phoneNumberId,
    });
    await client.assertCoexistencePhone(accessToken, phoneNumberId);

    const onboardingGeneration = crypto.randomUUID();
    const [stagedAttemptCount] = await WhatsAppEmbeddedSignupAttempt.update({
      wabaId: session.data.wabaId,
      phoneNumberId,
      onboardingGeneration,
      subscriptionStatus: 'not_started',
    }, { where: { id: params.attemptId, status: 'processing' } });
    if (stagedAttemptCount !== 1) {
      throw new HttpError(409, 'Embedded Signup attempt requires recovery.');
    }

    const tokenStoredAt = new Date();
    await updateSystemConfigValues({
      values: {
        WHATSAPP_BUSINESS_ACCESS_TOKEN: accessToken,
        WHATSAPP_WABA_ID: session.data.wabaId,
        WHATSAPP_PHONE_NUMBER_ID: phoneNumberId,
        WHATSAPP_ONBOARDING_GENERATION: onboardingGeneration,
      },
      actorId: params.adminUserId,
      reason: `WhatsApp Embedded Signup attempt ${params.attemptId}`,
    });
    const subscriptionAttemptedAt = new Date();
    const [subscriptionClaimCount] = await WhatsAppEmbeddedSignupAttempt.update({
      tokenStoredAt,
      subscriptionStatus: 'unknown',
      subscriptionAttemptedAt,
    }, { where: { id: params.attemptId, status: 'processing' } });
    if (subscriptionClaimCount !== 1) {
      throw new HttpError(409, 'Embedded Signup attempt requires recovery.');
    }

    try {
      await client.subscribeWaba(accessToken, session.data.wabaId);
    } catch (error) {
      await WhatsAppEmbeddedSignupAttempt.update({
        subscriptionStatus: error instanceof WhatsAppMetaGraphError && error.ambiguous
          ? 'unknown'
          : 'failed',
      }, { where: { id: params.attemptId } });
      await WhatsAppSourceState.upsert({
        id: 1,
        status: 'unavailable',
        onboardingGeneration,
        disconnectedGeneration: onboardingGeneration,
        lastErrorAt: new Date(),
        lastErrorCode: attemptErrorCode(error).toLowerCase().slice(0, 64),
      });
      throw error;
    }
    await WhatsAppEmbeddedSignupAttempt.update({
      subscriptionStatus: 'succeeded',
      subscribedAt: new Date(),
    }, { where: { id: params.attemptId, status: 'processing' } });

    return finishSubscribedAttempt({
      attemptId: params.attemptId,
      client,
      accessToken,
      phoneNumberId,
      onboardingGeneration,
    });
  } catch (error) {
    await failAttempt(params.attemptId, error);
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'WhatsApp Embedded Signup could not be completed.', {
      code: attemptErrorCode(error),
    });
  }
};
