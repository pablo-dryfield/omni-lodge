import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { Op, UniqueConstraintError } from 'sequelize';
import {
  getWhatsAppWebhookQueueConfig,
  resolveWhatsAppOnboardingGeneration,
  type WhatsAppWebhookQueueConfig,
} from '../config/whatsappConfig.js';
import WhatsAppWebhookInbox from '../models/WhatsAppWebhookInbox.js';
import type {
  NormalizedWhatsAppWebhookEvent,
  WhatsAppWebhookBatch,
} from '../types/whatsapp.js';
import {
  ingestWhatsAppWebhook,
  markWhatsAppSourceError,
} from './whatsappMessageService.js';

const ENCRYPTION_CONTEXT = 'omnilodge-whatsapp-webhook-inbox-v2';
const MAX_ENCRYPTED_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_ATTEMPTS = 8;
const PROCESSING_LEASE_MS = 5 * 60 * 1000;
const PROCESSING_HEARTBEAT_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
let processing = false;

type EncryptedPayload = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

export type WhatsAppWebhookEnqueueResult = {
  queued: boolean;
  duplicate: boolean;
};

const encryptionAad = (
  deliveryHash: string,
  keyId: string,
  onboardingGeneration: string,
): Buffer => Buffer.from(
  `${ENCRYPTION_CONTEXT}\u0000${deliveryHash}\u0000${keyId}\u0000${onboardingGeneration}`,
  'utf8',
);

const encryptBatch = (
  batch: WhatsAppWebhookBatch,
  deliveryHash: string,
  key: { id: string; material: Buffer },
  onboardingGeneration: string,
): EncryptedPayload => {
  const plaintext = Buffer.from(JSON.stringify(batch), 'utf8');
  if (plaintext.length > MAX_ENCRYPTED_PAYLOAD_BYTES) {
    throw new Error('WhatsApp normalized webhook exceeds the queue size limit');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key.material, iv);
  cipher.setAAD(encryptionAad(deliveryHash, key.id, onboardingGeneration));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
};

const restoreBatchDates = (value: unknown): WhatsAppWebhookBatch => {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { events?: unknown }).events)) {
    throw new Error('Invalid encrypted WhatsApp webhook batch');
  }

  const events = (value as { events: unknown[] }).events.map((event): NormalizedWhatsAppWebhookEvent => {
    if (!event || typeof event !== 'object') {
      throw new Error('Invalid encrypted WhatsApp webhook event');
    }
    const record = event as Record<string, unknown>;
    if (record.kind === 'history_sync' || record.kind === 'account_state') {
      return record as unknown as NormalizedWhatsAppWebhookEvent;
    }
    if (record.kind !== 'message' && record.kind !== 'status') {
      throw new Error('Invalid encrypted WhatsApp webhook event kind');
    }
    const timestamp = new Date(String(record.timestamp ?? ''));
    if (!Number.isFinite(timestamp.getTime())) {
      throw new Error('Invalid encrypted WhatsApp webhook timestamp');
    }
    return { ...record, timestamp } as unknown as NormalizedWhatsAppWebhookEvent;
  });

  return { events };
};

const decryptBatch = (
  job: WhatsAppWebhookInbox,
  queueConfig: WhatsAppWebhookQueueConfig,
): WhatsAppWebhookBatch => {
  const key = queueConfig.decryptionKeys.get(job.encryptionKeyId);
  if (!key) throw new Error('Unknown WhatsApp webhook queue encryption key ID');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    job.payloadIv,
  );
  decipher.setAAD(encryptionAad(
    job.deliveryHash,
    job.encryptionKeyId,
    job.onboardingGeneration,
  ));
  decipher.setAuthTag(job.payloadAuthTag);
  const plaintext = Buffer.concat([
    decipher.update(job.payloadCiphertext),
    decipher.final(),
  ]);
  return restoreBatchDates(JSON.parse(plaintext.toString('utf8')) as unknown);
};

const normalizedErrorCode = (error: unknown): string => {
  const name = error instanceof Error ? error.name : 'unknown_error';
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64) || 'unknown_error';
};

export const hashWhatsAppWebhookDelivery = (rawBody: Buffer): string =>
  createHash('sha256').update(rawBody).digest('hex');

export async function enqueueWhatsAppWebhook(params: {
  batch: WhatsAppWebhookBatch;
  deliveryHash: string;
  receivedAt?: Date;
  onboardingGeneration?: string;
  queueConfig?: WhatsAppWebhookQueueConfig;
}): Promise<WhatsAppWebhookEnqueueResult> {
  if (!/^[a-f0-9]{64}$/.test(params.deliveryHash)) {
    throw new Error('Invalid WhatsApp webhook delivery hash');
  }
  const receivedAt = params.receivedAt ?? new Date();
  const onboardingGeneration = params.onboardingGeneration
    ?? resolveWhatsAppOnboardingGeneration();
  let queueConfig: WhatsAppWebhookQueueConfig;
  try {
    queueConfig = params.queueConfig ?? getWhatsAppWebhookQueueConfig();
  } catch (error) {
    try {
      await markWhatsAppSourceError('queue_config_failed', receivedAt, onboardingGeneration);
    } catch {
      // Keep the configuration error as the primary failure.
    }
    throw error;
  }
  let encrypted: EncryptedPayload;
  try {
    encrypted = encryptBatch(
      params.batch,
      params.deliveryHash,
      queueConfig.activeKey,
      onboardingGeneration,
    );
  } catch (error) {
    try {
      await markWhatsAppSourceError('queue_encrypt_failed', receivedAt, onboardingGeneration);
    } catch {
      // Keep the encryption error as the primary failure.
    }
    throw error;
  }

  try {
    await WhatsAppWebhookInbox.create({
      deliveryHash: params.deliveryHash,
      payloadCiphertext: encrypted.ciphertext,
      payloadIv: encrypted.iv,
      payloadAuthTag: encrypted.authTag,
      encryptionKeyId: queueConfig.activeKey.id,
      onboardingGeneration,
      status: 'queued',
      attemptCount: 0,
      nextAttemptAt: receivedAt,
      receivedAt,
      lastErrorCode: null,
      leaseToken: null,
    });
    return { queued: true, duplicate: false };
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) {
      try {
        await markWhatsAppSourceError('queue_enqueue_failed', receivedAt, onboardingGeneration);
      } catch {
        // Keep the queue persistence error as the primary failure.
      }
      throw error;
    }
    const [resetCount] = await WhatsAppWebhookInbox.update(
      {
        payloadCiphertext: encrypted.ciphertext,
        payloadIv: encrypted.iv,
        payloadAuthTag: encrypted.authTag,
        encryptionKeyId: queueConfig.activeKey.id,
        onboardingGeneration,
        status: 'queued',
        attemptCount: 0,
        nextAttemptAt: receivedAt,
        receivedAt,
        lastErrorCode: null,
        leaseToken: null,
      },
      { where: { deliveryHash: params.deliveryHash, status: 'failed' } },
    );
    return { queued: resetCount > 0, duplicate: resetCount === 0 };
  }
}

const claimNextJob = async (now: Date): Promise<WhatsAppWebhookInbox | null> => {
  const sequelize = WhatsAppWebhookInbox.sequelize;
  if (!sequelize) throw new Error('WhatsApp webhook inbox is not attached to Sequelize');

  return sequelize.transaction(async (transaction) => {
    // Serialize claims across PM2/process instances. The transaction-level lock is
    // held only while deciding which job owns the processing lease.
    await sequelize.query(
      "SELECT pg_advisory_xact_lock(hashtext('omnilodge_whatsapp_webhook_queue'));",
      { transaction },
    );
    const activeJob = await WhatsAppWebhookInbox.findOne({
      where: { status: 'processing', nextAttemptAt: { [Op.gt]: now } },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (activeJob) return null;

    const job = await WhatsAppWebhookInbox.findOne({
      where: {
        [Op.or]: [
          { status: 'queued', nextAttemptAt: { [Op.lte]: now } },
          {
            status: 'processing',
            nextAttemptAt: { [Op.lte]: now },
          },
        ],
      },
      order: [['id', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true,
    });
    if (!job) return null;

    const leaseToken = randomUUID();
    await job.update(
      {
        status: 'processing',
        attemptCount: job.attemptCount + 1,
        nextAttemptAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
        lastErrorCode: null,
        leaseToken,
      },
      { transaction },
    );
    return job;
  });
};

export async function renewWhatsAppWebhookProcessingLease(
  jobId: number,
  leaseToken: string,
  now = new Date(),
): Promise<boolean> {
  const [renewed] = await WhatsAppWebhookInbox.update(
    { nextAttemptAt: new Date(now.getTime() + PROCESSING_LEASE_MS) },
    { where: { id: jobId, status: 'processing', leaseToken } },
  );
  return renewed === 1;
}

const safelyMarkSourceDegraded = async (
  errorCode: string,
  at: Date,
  onboardingGeneration: string,
): Promise<void> => {
  try {
    await markWhatsAppSourceError(errorCode, at, onboardingGeneration);
  } catch {
    // The queue row remains retryable even if source health persistence is unavailable.
  }
};

export async function processWhatsAppWebhookJob(
  job: WhatsAppWebhookInbox,
  queueConfigOverride?: WhatsAppWebhookQueueConfig,
): Promise<void> {
  const leaseToken = job.leaseToken;
  if (!leaseToken) throw new Error('WhatsApp webhook job has no processing lease');
  let heartbeatActive = true;
  let heartbeatInFlight = false;
  const heartbeat = setInterval(() => {
    if (!heartbeatActive || heartbeatInFlight) return;
    heartbeatInFlight = true;
    void renewWhatsAppWebhookProcessingLease(job.id, leaseToken)
      .then((renewed) => renewed || !heartbeatActive
        ? undefined
        : safelyMarkSourceDegraded(
          'queue_lease_lost',
          new Date(),
          job.onboardingGeneration,
        ))
      .catch(() => heartbeatActive
        ? safelyMarkSourceDegraded(
          'queue_lease_heartbeat_failed',
          new Date(),
          job.onboardingGeneration,
        )
        : undefined)
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, PROCESSING_HEARTBEAT_MS);
  heartbeat.unref();

  try {
    const queueConfig = queueConfigOverride ?? getWhatsAppWebhookQueueConfig();
    const batch = decryptBatch(job, queueConfig);
    await ingestWhatsAppWebhook(batch, {
      receivedAt: job.receivedAt,
      onboardingGeneration: job.onboardingGeneration,
    });
    heartbeatActive = false;
    clearInterval(heartbeat);
    const deleted = await WhatsAppWebhookInbox.destroy({
      where: { id: job.id, status: 'processing', leaseToken },
    });
    if (deleted !== 1) throw new Error('WhatsApp webhook processing lease was lost');
  } catch (error) {
    const exhausted = job.attemptCount >= MAX_ATTEMPTS;
    const retryDelayMs = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, job.attemptCount - 1));
    const errorCode = normalizedErrorCode(error);
    try {
      await WhatsAppWebhookInbox.update(
        {
          status: exhausted ? 'failed' : 'queued',
          nextAttemptAt: new Date(Date.now() + retryDelayMs),
          lastErrorCode: errorCode,
          leaseToken: null,
        },
        { where: { id: job.id, status: 'processing', leaseToken } },
      );
    } finally {
      await safelyMarkSourceDegraded(
        exhausted ? 'queue_dead_letter' : `queue_${errorCode}`,
        new Date(),
        job.onboardingGeneration,
      );
    }
  } finally {
    heartbeatActive = false;
    clearInterval(heartbeat);
  }
}

export async function processQueuedWhatsAppWebhooks(limit = 10): Promise<number> {
  if (processing) return 0;
  processing = true;
  let processed = 0;
  try {
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 25));
    while (processed < boundedLimit) {
      const job = await claimNextJob(new Date());
      if (!job) break;
      await processWhatsAppWebhookJob(job);
      processed += 1;
    }
    return processed;
  } finally {
    processing = false;
  }
}

export async function deleteExpiredWhatsAppWebhookJobs(
  now = new Date(),
  retentionDays = 7,
): Promise<number> {
  const safeRetentionDays = Math.max(1, Math.min(Math.floor(retentionDays), 7));
  const cutoff = new Date(now.getTime() - safeRetentionDays * DAY_MS);
  return WhatsAppWebhookInbox.destroy({
    where: { receivedAt: { [Op.lt]: cutoff } },
  });
}
