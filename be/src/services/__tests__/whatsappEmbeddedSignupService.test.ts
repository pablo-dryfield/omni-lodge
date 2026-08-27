import crypto from 'node:crypto';
import { Op } from 'sequelize';

const mockTransactionObject = { LOCK: { UPDATE: 'UPDATE' } };
const mockDatabaseTransaction = jest.fn(async (
  callback: (transaction: typeof mockTransactionObject) => unknown,
) => callback(mockTransactionObject));

jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: mockDatabaseTransaction },
}));
jest.mock('../../config/whatsappConfig.js', () => ({
  WhatsAppConfigError: class WhatsAppConfigError extends Error {},
  getWhatsAppEmbeddedSignupConfig: jest.fn(() => ({
    appId: '828737393371751',
    appSecret: 'a'.repeat(32),
    configId: '123456789',
    graphApiVersion: 'v25.0',
  })),
  getWhatsAppWebhookQueueConfig: jest.fn(() => ({
    activeKey: { id: 'active-key', material: Buffer.alloc(32) },
    decryptionKeys: new Map([['active-key', Buffer.alloc(32)]]),
  })),
  getWhatsAppWebhookVerificationConfig: jest.fn(() => ({ verifyToken: 'verify-token' })),
}));
jest.mock('../../models/WhatsAppEmbeddedSignupAttempt.js', () => ({
  __esModule: true,
  default: {
    sequelize: { transaction: mockDatabaseTransaction },
    update: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    findByPk: jest.fn(),
  },
}));
jest.mock('../../models/WhatsAppSourceState.js', () => ({
  __esModule: true,
  default: { upsert: jest.fn() },
}));
jest.mock('../configService.js', () => ({
  getConfigValueRaw: jest.fn(),
  refreshConfigCacheKeys: jest.fn().mockResolvedValue(undefined),
  updateSystemConfigValues: jest.fn(),
}));
jest.mock('../whatsappMessageService.js', () => ({
  getWhatsAppSourceStatus: jest.fn(),
}));

import WhatsAppEmbeddedSignupAttempt from '../../models/WhatsAppEmbeddedSignupAttempt';
import WhatsAppSourceState from '../../models/WhatsAppSourceState';
import sequelize from '../../config/database';
import {
  getWhatsAppWebhookQueueConfig,
  WhatsAppConfigError,
} from '../../config/whatsappConfig';
import {
  getConfigValueRaw,
  updateSystemConfigValues,
} from '../configService';
import {
  completeWhatsAppEmbeddedSignupAttempt,
  createWhatsAppEmbeddedSignupAttempt,
  getWhatsAppAdminStatus,
  parseWhatsAppEmbeddedSignupSession,
} from '../whatsappEmbeddedSignupService';
import { WhatsAppMetaGraphError } from '../whatsappMetaGraphClient';
import { getWhatsAppSourceStatus } from '../whatsappMessageService';

const attemptModel = WhatsAppEmbeddedSignupAttempt as unknown as {
  update: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  findByPk: jest.Mock;
};
const database = sequelize as unknown as { transaction: jest.Mock };
database.transaction = mockDatabaseTransaction;
const sourceStateModel = WhatsAppSourceState as unknown as { upsert: jest.Mock };
const mockGetConfigValueRaw = getConfigValueRaw as jest.Mock;
const mockUpdateSystemConfigValues = updateSystemConfigValues as jest.Mock;
const mockGetWhatsAppSourceStatus = getWhatsAppSourceStatus as jest.Mock;
const mockGetWhatsAppWebhookQueueConfig = getWhatsAppWebhookQueueConfig as jest.Mock;

const configValues = new Map<string, string | null>();
const defaultConfig = (): void => {
  configValues.clear();
  configValues.set('WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'verify-token');
  configValues.set('WHATSAPP_META_APP_ID', '828737393371751');
  configValues.set('WHATSAPP_META_APP_SECRET', 'a'.repeat(32));
  configValues.set('WHATSAPP_META_GRAPH_API_VERSION', 'v25.0');
  configValues.set('WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID', '123456789');
  configValues.set('WHATSAPP_BUSINESS_ACCESS_TOKEN', null);
  configValues.set('WHATSAPP_WABA_ID', null);
  configValues.set('WHATSAPP_PHONE_NUMBER_ID', null);
  configValues.set('WHATSAPP_ONBOARDING_GENERATION', '1');
};

const hashNonce = (nonce: string): string =>
  crypto.createHash('sha256').update(nonce, 'utf8').digest('hex');

const makeAttempt = (overrides: Record<string, unknown> = {}) => {
  const nonce = crypto.randomBytes(32).toString('base64url');
  const attempt: Record<string, any> = {
    id: '91f93227-93a5-4e7f-8837-c830d4f22934',
    adminUserId: 7,
    nonceHash: hashNonce(nonce),
    status: 'pending',
    expiresAt: new Date(Date.now() + 60_000),
    wabaId: null,
    phoneNumberId: null,
    onboardingGeneration: null,
    tokenStoredAt: null,
    subscriptionStatus: 'not_started',
    recoveryLeaseAt: null,
    appStateSyncStatus: 'not_started',
    historySyncStatus: 'not_started',
    errorCode: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  attempt.update = jest.fn(async (values: Record<string, unknown>) => {
    Object.assign(attempt, values, { updatedAt: new Date() });
    return attempt;
  });
  return { attempt, nonce };
};

const session = {
  type: 'WA_EMBEDDED_SIGNUP',
  event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  version: 3,
  data: { waba_id: '111222333', phone_number_id: '444555666' },
};

const safeSourceStatus = {
  source: 'whatsapp',
  available: false,
  status: 'degraded',
  historySyncStatus: 'in_progress',
  historySyncProgress: null,
  lastWebhookAt: null,
  lastSuccessfulIngestAt: null,
  lastMessageAt: null,
  lastErrorAt: null,
  lastErrorCode: null,
  retentionDays: 7,
  stale: false,
  staleAfterHours: 96,
  onboardingGeneration: 'generation',
  accountDisconnected: false,
  queue: { configured: true, queued: 0, processing: 0, failed: 0, oldestPendingAt: null },
};

const makeGraphClient = () => ({
  exchangeEmbeddedSignupCode: jest.fn().mockResolvedValue('t'.repeat(64)),
  validateAccessToken: jest.fn().mockResolvedValue(undefined),
  listWabaPhoneNumberIds: jest.fn().mockResolvedValue(['444555666']),
  assertCoexistencePhone: jest.fn().mockResolvedValue(undefined),
  subscribeWaba: jest.fn().mockResolvedValue(undefined),
  dispatchCoexistenceSync: jest.fn()
    .mockResolvedValueOnce('app-state-request')
    .mockResolvedValueOnce('history-request'),
  registerPhoneNumber: jest.fn(),
});

describe('WhatsApp Embedded Signup service', () => {
  let currentAttempt: Record<string, any> | null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDatabaseTransaction.mockImplementation(async (
      callback: (transaction: typeof mockTransactionObject) => unknown,
    ) => callback(mockTransactionObject));
    defaultConfig();
    currentAttempt = null;
    mockGetConfigValueRaw.mockImplementation((key: string) => configValues.get(key) ?? null);
    mockUpdateSystemConfigValues.mockImplementation(async ({ values }: { values: Record<string, unknown> }) => {
      Object.entries(values).forEach(([key, value]) => configValues.set(key, String(value)));
    });
    mockGetWhatsAppSourceStatus.mockResolvedValue(safeSourceStatus);
    attemptModel.findByPk.mockImplementation(async () => currentAttempt);
    attemptModel.findOne.mockImplementation(async () => currentAttempt);
    attemptModel.update.mockImplementation(async (values: Record<string, unknown>, options: any) => {
      if (currentAttempt && options?.where?.id === currentAttempt.id) {
        Object.assign(currentAttempt, values, { updatedAt: new Date() });
      }
      return [1];
    });
    sourceStateModel.upsert.mockResolvedValue(undefined);
  });

  it('accepts only the Coexistence completion event at session version 3', () => {
    expect(parseWhatsAppEmbeddedSignupSession(session)).toEqual({
      type: session.type,
      event: session.event,
      version: 3,
      data: { wabaId: '111222333', phoneNumberId: '444555666' },
    });
    expect(() => parseWhatsAppEmbeddedSignupSession({ ...session, version: 4 })).toThrow(
      'Invalid Embedded Signup completion session',
    );
    expect(() => parseWhatsAppEmbeddedSignupSession({ ...session, version: ' 3' })).toThrow(
      'Invalid Embedded Signup completion session',
    );
  });

  it('creates one expiring, nonce-bound attempt and guards stale one-shot states', async () => {
    const now = new Date('2026-08-27T10:00:00.000Z');
    attemptModel.findOne.mockResolvedValue(null);
    attemptModel.create.mockImplementation(async (values: Record<string, unknown>) => values);

    const result = await createWhatsAppEmbeddedSignupAttempt(7, now);

    expect(result.launch).toEqual({
      appId: '828737393371751',
      configId: '123456789',
      graphApiVersion: 'v25.0',
    });
    expect(result.attempt.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.attempt.expiresAt).toBe('2026-08-27T10:10:00.000Z');
    const cleanupWhere = attemptModel.update.mock.calls[0]?.[1]?.where;
    expect(cleanupWhere[Op.or]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'processing',
        subscriptionStatus: 'not_started',
        appStateSyncStatus: 'not_started',
        historySyncStatus: 'not_started',
      }),
    ]));
  });

  it('rejects another attempt while the partial-index protected attempt is active', async () => {
    attemptModel.findOne.mockResolvedValue({ status: 'processing' });

    await expect(createWhatsAppEmbeddedSignupAttempt(7)).rejects.toMatchObject({ status: 409 });
    expect(attemptModel.create).not.toHaveBeenCalled();
  });

  it('expires a cancelled pending attempt owned by the same admin before replacing it', async () => {
    const prior = makeAttempt().attempt;
    const defaultUpdate = attemptModel.update.getMockImplementation();
    attemptModel.update.mockImplementation(async (values: Record<string, unknown>, options: any) => {
      if (options?.where?.adminUserId === 7 && options?.where?.status === 'pending') {
        Object.assign(prior, values);
      }
      return defaultUpdate?.(values, options) ?? [1];
    });
    attemptModel.findOne.mockImplementation(async () => (
      prior.status === 'pending' ? prior : null
    ));
    attemptModel.create.mockImplementation(async (values: Record<string, unknown>) => values);

    const replacement = await createWhatsAppEmbeddedSignupAttempt(7);

    expect(prior.status).toBe('expired');
    expect(prior.errorCode).toBe('ATTEMPT_REPLACED');
    expect(replacement.attempt.id).not.toBe(prior.id);
  });

  it('does not replace a pending attempt owned by another admin', async () => {
    const otherAdminAttempt = makeAttempt({ adminUserId: 9 }).attempt;
    attemptModel.findOne.mockResolvedValue(otherAdminAttempt);

    await expect(createWhatsAppEmbeddedSignupAttempt(7)).rejects.toMatchObject({ status: 409 });
    expect(attemptModel.create).not.toHaveBeenCalled();
  });

  it('blocks local re-onboarding for an established tuple whose one-shot sync was consumed', async () => {
    configValues.set('WHATSAPP_BUSINESS_ACCESS_TOKEN', 't'.repeat(64));
    configValues.set('WHATSAPP_WABA_ID', '111222333');
    configValues.set('WHATSAPP_PHONE_NUMBER_ID', '444555666');
    configValues.set('WHATSAPP_ONBOARDING_GENERATION', 'connected-generation');
    attemptModel.findOne.mockResolvedValue(makeAttempt({
      status: 'completed',
      wabaId: '111222333',
      phoneNumberId: '444555666',
      onboardingGeneration: 'connected-generation',
      subscriptionStatus: 'succeeded',
      appStateSyncStatus: 'succeeded',
      historySyncStatus: 'unknown',
    }).attempt);

    await expect(createWhatsAppEmbeddedSignupAttempt(7)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('offboarding or recovery'),
    });
    expect(attemptModel.create).not.toHaveBeenCalled();
  });

  it('returns a safe configuration conflict when webhook readiness is incomplete', async () => {
    mockGetWhatsAppWebhookQueueConfig.mockImplementationOnce(() => {
      throw new WhatsAppConfigError('raw configuration key detail');
    });

    await expect(createWhatsAppEmbeddedSignupAttempt(7)).rejects.toMatchObject({
      status: 409,
      message: 'Complete the WhatsApp Meta configuration first.',
    });
    expect(attemptModel.create).not.toHaveBeenCalled();
  });

  it('keeps an existing connected generation active when a newer attempt is only pending', async () => {
    configValues.set('WHATSAPP_BUSINESS_ACCESS_TOKEN', 't'.repeat(64));
    configValues.set('WHATSAPP_WABA_ID', '111222333');
    configValues.set('WHATSAPP_PHONE_NUMBER_ID', '444555666');
    configValues.set('WHATSAPP_ONBOARDING_GENERATION', 'connected-generation');
    const pending = makeAttempt({
      id: 'f5599801-b16d-436f-b754-c071116ebfc6',
      status: 'pending',
      onboardingGeneration: null,
    }).attempt;
    const connected = makeAttempt({
      id: '83da4e37-33e7-48a3-bd25-d4ed8798a60a',
      status: 'completed',
      wabaId: '111222333',
      phoneNumberId: '444555666',
      onboardingGeneration: 'connected-generation',
      subscriptionStatus: 'succeeded',
      completedAt: new Date(),
    }).attempt;
    attemptModel.findOne.mockImplementation(async (options: any) =>
      options?.where?.onboardingGeneration ? connected : pending);

    const status = await getWhatsAppAdminStatus();

    expect(status.connected).toBe(true);
    expect(status.coexistenceVerified).toBe(true);
    expect(status.latestAttempt?.id).toBe(pending.id);
  });

  it('binds completion to the creating admin, nonce, and expiry', async () => {
    const created = makeAttempt();
    currentAttempt = created.attempt;
    await expect(completeWhatsAppEmbeddedSignupAttempt({
      attemptId: created.attempt.id,
      adminUserId: 8,
      nonce: created.nonce,
      code: 'code',
      session,
      graphClient: makeGraphClient() as any,
    })).rejects.toMatchObject({ status: 404 });

    currentAttempt = makeAttempt().attempt;
    await expect(completeWhatsAppEmbeddedSignupAttempt({
      attemptId: currentAttempt.id,
      adminUserId: 7,
      nonce: crypto.randomBytes(32).toString('base64url'),
      code: 'code',
      session,
      graphClient: makeGraphClient() as any,
    })).rejects.toMatchObject({ status: 403 });

    const expired = makeAttempt({ expiresAt: new Date(Date.now() - 1_000) });
    currentAttempt = expired.attempt;
    await expect(completeWhatsAppEmbeddedSignupAttempt({
      attemptId: expired.attempt.id,
      adminUserId: 7,
      nonce: expired.nonce,
      code: 'code',
      session,
      graphClient: makeGraphClient() as any,
    })).rejects.toMatchObject({ status: 410 });
    expect(expired.attempt.status).toBe('expired');
  });

  it('stages config before subscribing, dispatches each sync once, and never registers', async () => {
    const created = makeAttempt();
    currentAttempt = created.attempt;
    const graphClient = makeGraphClient();

    const status = await completeWhatsAppEmbeddedSignupAttempt({
      attemptId: created.attempt.id,
      adminUserId: 7,
      nonce: created.nonce,
      code: 'code',
      session,
      graphClient: graphClient as any,
    });

    expect(mockUpdateSystemConfigValues).toHaveBeenCalledWith(expect.objectContaining({
      values: expect.objectContaining({
        WHATSAPP_BUSINESS_ACCESS_TOKEN: 't'.repeat(64),
        WHATSAPP_WABA_ID: '111222333',
        WHATSAPP_PHONE_NUMBER_ID: '444555666',
        WHATSAPP_ONBOARDING_GENERATION: expect.any(String),
      }),
    }));
    const stagedAttemptCallIndex = attemptModel.update.mock.calls.findIndex(
      ([values]) => typeof values.onboardingGeneration === 'string',
    );
    expect(stagedAttemptCallIndex).toBeGreaterThanOrEqual(0);
    expect(attemptModel.update.mock.invocationCallOrder[stagedAttemptCallIndex]).toBeLessThan(
      mockUpdateSystemConfigValues.mock.invocationCallOrder[0],
    );
    expect(mockUpdateSystemConfigValues.mock.invocationCallOrder[0]).toBeLessThan(
      graphClient.subscribeWaba.mock.invocationCallOrder[0],
    );
    expect(graphClient.dispatchCoexistenceSync.mock.calls.map((call) => call[2])).toEqual([
      'smb_app_state_sync',
      'history',
    ]);
    expect(graphClient.registerPhoneNumber).not.toHaveBeenCalled();
    expect(status.connected).toBe(true);
    expect(created.attempt.status).toBe('completed');

    await completeWhatsAppEmbeddedSignupAttempt({
      attemptId: created.attempt.id,
      adminUserId: 7,
      nonce: created.nonce,
      code: 'code',
      session,
      graphClient: graphClient as any,
    });
    expect(graphClient.dispatchCoexistenceSync).toHaveBeenCalledTimes(2);
  });

  it('leaves a failed subscription staged but disconnected and sends no one-shot sync', async () => {
    const created = makeAttempt();
    currentAttempt = created.attempt;
    const graphClient = makeGraphClient();
    graphClient.subscribeWaba.mockRejectedValue(
      new WhatsAppMetaGraphError('META_400_OAUTHEXCEPTION_190', 400, false),
    );

    await expect(completeWhatsAppEmbeddedSignupAttempt({
      attemptId: created.attempt.id,
      adminUserId: 7,
      nonce: created.nonce,
      code: 'code',
      session,
      graphClient: graphClient as any,
    })).rejects.toMatchObject({
      status: 502,
      details: { code: 'META_400_OAUTHEXCEPTION_190' },
    });

    expect(mockUpdateSystemConfigValues).toHaveBeenCalledTimes(1);
    expect(sourceStateModel.upsert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'unavailable',
      disconnectedGeneration: expect.any(String),
      lastErrorCode: 'meta_400_oauthexception_190',
    }));
    expect(graphClient.dispatchCoexistenceSync).not.toHaveBeenCalled();
    expect(created.attempt.status).toBe('failed');
    expect(created.attempt.errorCode).toBe('META_400_OAUTHEXCEPTION_190');
  });

  it('records an ambiguous one-shot timeout as unknown and never retries it', async () => {
    const created = makeAttempt();
    currentAttempt = created.attempt;
    const graphClient = makeGraphClient();
    graphClient.dispatchCoexistenceSync
      .mockReset()
      .mockRejectedValueOnce(new WhatsAppMetaGraphError('META_TIMEOUT', null, true))
      .mockResolvedValueOnce('history-request');

    await completeWhatsAppEmbeddedSignupAttempt({
      attemptId: created.attempt.id,
      adminUserId: 7,
      nonce: created.nonce,
      code: 'code',
      session,
      graphClient: graphClient as any,
    });

    expect(created.attempt.appStateSyncStatus).toBe('unknown');
    expect(created.attempt.historySyncStatus).toBe('succeeded');
    expect(created.attempt.errorCode).toBe('META_TIMEOUT');
    expect(graphClient.dispatchCoexistenceSync).toHaveBeenCalledTimes(2);

    await completeWhatsAppEmbeddedSignupAttempt({
      attemptId: created.attempt.id,
      adminUserId: 7,
      nonce: created.nonce,
      code: 'code',
      session,
      graphClient: graphClient as any,
    });
    expect(graphClient.dispatchCoexistenceSync).toHaveBeenCalledTimes(2);
  });

  it('keeps provider success non-retryable when local success persistence is ambiguous', async () => {
    const created = makeAttempt();
    currentAttempt = created.attempt;
    const graphClient = makeGraphClient();
    const defaultUpdate = attemptModel.update.getMockImplementation();
    let rejectedSuccessWrite = false;
    attemptModel.update.mockImplementation(async (values: Record<string, unknown>, options: any) => {
      if (!rejectedSuccessWrite && values.appStateSyncStatus === 'succeeded') {
        rejectedSuccessWrite = true;
        throw new Error('database acknowledgement was lost');
      }
      return defaultUpdate?.(values, options) ?? [1];
    });

    await completeWhatsAppEmbeddedSignupAttempt({
      attemptId: created.attempt.id,
      adminUserId: 7,
      nonce: created.nonce,
      code: 'code',
      session,
      graphClient: graphClient as any,
    });

    expect(created.attempt.appStateSyncStatus).toBe('unknown');
    expect(created.attempt.errorCode).toBe('SYNC_PERSISTENCE_UNKNOWN');
    expect(graphClient.dispatchCoexistenceSync).toHaveBeenCalledTimes(2);

    await completeWhatsAppEmbeddedSignupAttempt({
      attemptId: created.attempt.id,
      adminUserId: 7,
      nonce: created.nonce,
      code: 'code',
      session,
      graphClient: graphClient as any,
    });
    expect(graphClient.dispatchCoexistenceSync).toHaveBeenCalledTimes(2);
  });

  it('resumes only unclaimed one-shot work after a subscribed processing crash', async () => {
    const created = makeAttempt({
      status: 'processing',
      expiresAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 60_000),
      wabaId: '111222333',
      phoneNumberId: '444555666',
      onboardingGeneration: 'resume-generation',
      subscriptionStatus: 'succeeded',
      appStateSyncStatus: 'claimed',
      appStateSyncClaimedAt: new Date(Date.now() - 60_000),
      historySyncStatus: 'not_started',
    });
    currentAttempt = created.attempt;
    configValues.set('WHATSAPP_BUSINESS_ACCESS_TOKEN', 't'.repeat(64));
    configValues.set('WHATSAPP_WABA_ID', '111222333');
    configValues.set('WHATSAPP_PHONE_NUMBER_ID', '444555666');
    configValues.set('WHATSAPP_ONBOARDING_GENERATION', 'resume-generation');
    const graphClient = makeGraphClient();

    const status = await completeWhatsAppEmbeddedSignupAttempt({
      attemptId: created.attempt.id,
      adminUserId: 7,
      nonce: created.nonce,
      code: undefined,
      session: undefined,
      graphClient: graphClient as any,
    });

    expect(graphClient.exchangeEmbeddedSignupCode).not.toHaveBeenCalled();
    expect(graphClient.subscribeWaba).not.toHaveBeenCalled();
    expect(graphClient.dispatchCoexistenceSync).toHaveBeenCalledTimes(1);
    expect(graphClient.dispatchCoexistenceSync).toHaveBeenCalledWith(
      't'.repeat(64),
      '444555666',
      'history',
    );
    expect(created.attempt.appStateSyncStatus).toBe('unknown');
    expect(created.attempt.historySyncStatus).toBe('succeeded');
    expect(created.attempt.status).toBe('completed');
    expect(status.connected).toBe(true);
  });

  it('rejects an overlapping resume while a one-shot provider call may still be in flight', async () => {
    const created = makeAttempt({
      status: 'processing',
      wabaId: '111222333',
      phoneNumberId: '444555666',
      onboardingGeneration: 'resume-generation',
      subscriptionStatus: 'succeeded',
      appStateSyncStatus: 'claimed',
      appStateSyncClaimedAt: new Date(),
      historySyncStatus: 'not_started',
      updatedAt: new Date(),
    });
    currentAttempt = created.attempt;
    const graphClient = makeGraphClient();

    await expect(completeWhatsAppEmbeddedSignupAttempt({
      attemptId: created.attempt.id,
      adminUserId: 7,
      nonce: created.nonce,
      code: undefined,
      session: undefined,
      graphClient: graphClient as any,
    })).rejects.toMatchObject({
      status: 409,
      message: 'Embedded Signup completion is still being processed.',
    });

    expect(created.attempt.status).toBe('processing');
    expect(created.attempt.appStateSyncStatus).toBe('claimed');
    expect(graphClient.dispatchCoexistenceSync).not.toHaveBeenCalled();
  });

  it('persists a recovery lease before two stale no-claim recoveries can overlap', async () => {
    const created = makeAttempt({
      status: 'processing',
      wabaId: '111222333',
      phoneNumberId: '444555666',
      onboardingGeneration: 'resume-generation',
      subscriptionStatus: 'succeeded',
      appStateSyncStatus: 'not_started',
      historySyncStatus: 'not_started',
      updatedAt: new Date(Date.now() - 60_000),
    });
    currentAttempt = created.attempt;
    configValues.set('WHATSAPP_BUSINESS_ACCESS_TOKEN', 't'.repeat(64));
    configValues.set('WHATSAPP_WABA_ID', '111222333');
    configValues.set('WHATSAPP_PHONE_NUMBER_ID', '444555666');
    configValues.set('WHATSAPP_ONBOARDING_GENERATION', 'resume-generation');
    const graphClient = makeGraphClient();
    let transactionTail = Promise.resolve();
    mockDatabaseTransaction.mockImplementation(async (
      callback: (transaction: typeof mockTransactionObject) => unknown,
    ) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await callback(mockTransactionObject);
      } finally {
        release();
      }
    });

    const completion = () => completeWhatsAppEmbeddedSignupAttempt({
      attemptId: created.attempt.id,
      adminUserId: 7,
      nonce: created.nonce,
      code: undefined,
      session: undefined,
      graphClient: graphClient as any,
    });
    const results = await Promise.allSettled([completion(), completion()]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toMatchObject({
      status: 409,
      message: 'Embedded Signup completion is still being processed.',
    });
    expect(created.attempt.recoveryLeaseAt).toBeInstanceOf(Date);
    expect(graphClient.dispatchCoexistenceSync).toHaveBeenCalledTimes(2);
    expect(created.attempt.status).toBe('completed');
  });

  it('surfaces stale processing with a claimed operation as recovery-required', async () => {
    currentAttempt = makeAttempt({
      status: 'processing',
      subscriptionStatus: 'unknown',
      updatedAt: new Date(Date.now() - (20 * 60 * 1000)),
    }).attempt;

    const status = await getWhatsAppAdminStatus();

    expect(status.latestAttempt).toEqual(expect.objectContaining({
      status: 'processing',
      recoveryRequired: true,
    }));
  });

  it('rejects authorization-code whitespace before making a Meta request', async () => {
    const created = makeAttempt();
    currentAttempt = created.attempt;
    const graphClient = makeGraphClient();

    await expect(completeWhatsAppEmbeddedSignupAttempt({
      attemptId: created.attempt.id,
      adminUserId: 7,
      nonce: created.nonce,
      code: ' code ',
      session,
      graphClient: graphClient as any,
    })).rejects.toMatchObject({ status: 400 });
    expect(graphClient.exchangeEmbeddedSignupCode).not.toHaveBeenCalled();
  });
});
