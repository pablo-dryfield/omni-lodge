import { UniqueConstraintError } from 'sequelize';

jest.mock('../../services/configService.js', () => ({
  getConfigValueRaw: jest.fn((key: string) => process.env[key] ?? null),
  hasConfigValueOverride: jest.fn(() => false),
}));

jest.mock('../../models/WhatsAppWebhookInbox.js', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    findOne: jest.fn(),
    sequelize: null,
  },
}));
jest.mock('../../services/whatsappMessageService.js', () => ({
  ingestWhatsAppWebhook: jest.fn(),
  markWhatsAppSourceError: jest.fn(),
}));

import WhatsAppWebhookInbox from '../../models/WhatsAppWebhookInbox';
import {
  getWhatsAppWebhookQueueConfig,
  WhatsAppConfigError,
  type WhatsAppWebhookQueueConfig,
} from '../../config/whatsappConfig';
import {
  ingestWhatsAppWebhook,
  markWhatsAppSourceError,
} from '../../services/whatsappMessageService';
import {
  enqueueWhatsAppWebhook,
  hashWhatsAppWebhookDelivery,
  processWhatsAppWebhookJob,
  renewWhatsAppWebhookProcessingLease,
} from '../whatsappWebhookQueueService';

const inboxModel = WhatsAppWebhookInbox as unknown as {
  create: jest.Mock;
  update: jest.Mock;
  destroy: jest.Mock;
};
const mockIngest = ingestWhatsAppWebhook as jest.Mock;
const mockMarkSourceError = markWhatsAppSourceError as jest.Mock;
const generation = 'generation-1';
const receivedAt = new Date('2026-08-27T07:30:00.000Z');
const batch = {
  events: [{
    kind: 'message' as const,
    source: 'messages' as const,
    direction: 'inbound' as const,
    action: 'create' as const,
    wabaId: 'waba-1',
    phoneNumberId: 'phone-1',
    timestamp: receivedAt,
    messageId: 'wamid.1',
    targetMessageId: null,
    senderWaId: '481234567',
    recipientWaId: null,
    contactName: 'Sensitive Guest',
    messageType: 'text',
    text: 'Sensitive message body',
    contextMessageId: null,
  }],
};

const queueConfig = (
  activeId: string,
  activeByte: number,
  previous: Array<[string, number]> = [],
): WhatsAppWebhookQueueConfig => {
  const activeKey = { id: activeId, material: Buffer.alloc(32, activeByte) };
  return {
    activeKey,
    decryptionKeys: new Map([
      [activeId, activeKey.material],
      ...previous.map(([id, byte]) => [id, Buffer.alloc(32, byte)] as const),
    ]),
  };
};

describe('whatsappWebhookQueueService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    inboxModel.create.mockResolvedValue({ id: 1 });
    inboxModel.update.mockResolvedValue([1]);
    inboxModel.destroy.mockResolvedValue(1);
    mockIngest.mockResolvedValue({ inserted: 1, deduplicated: 0, statusesUpdated: 0 });
    mockMarkSourceError.mockResolvedValue(undefined);
  });

  it('encrypts normalized source content with a dedicated versioned key', async () => {
    const deliveryHash = hashWhatsAppWebhookDelivery(Buffer.from('{"delivery":"one"}'));
    const result = await enqueueWhatsAppWebhook({
      deliveryHash,
      receivedAt,
      onboardingGeneration: generation,
      queueConfig: queueConfig('key-1', 1),
      batch,
    });

    expect(result).toEqual({ queued: true, duplicate: false });
    const queued = inboxModel.create.mock.calls[0][0];
    expect(queued).toMatchObject({
      encryptionKeyId: 'key-1',
      onboardingGeneration: generation,
      leaseToken: null,
    });
    const persistedBytes = Buffer.concat([
      queued.payloadCiphertext,
      queued.payloadIv,
      queued.payloadAuthTag,
    ]).toString('utf8');
    expect(persistedBytes).not.toContain('Sensitive message body');
    expect(persistedBytes).not.toContain('Sensitive Guest');
    expect(persistedBytes).not.toContain('481234567');
  });

  it('re-encrypts a revived failed duplicate with the active key ID', async () => {
    inboxModel.create.mockRejectedValue(new UniqueConstraintError());
    const result = await enqueueWhatsAppWebhook({
      deliveryHash: 'a'.repeat(64),
      receivedAt,
      onboardingGeneration: 'generation-2',
      queueConfig: queueConfig('key-2', 2),
      batch,
    });

    expect(result).toEqual({ queued: true, duplicate: false });
    expect(inboxModel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadCiphertext: expect.any(Buffer),
        payloadIv: expect.any(Buffer),
        payloadAuthTag: expect.any(Buffer),
        encryptionKeyId: 'key-2',
        onboardingGeneration: 'generation-2',
        attemptCount: 0,
      }),
      { where: { deliveryHash: 'a'.repeat(64), status: 'failed' } },
    );
  });

  it('decrypts an in-flight row with a previous rotation key', async () => {
    const deliveryHash = 'b'.repeat(64);
    await enqueueWhatsAppWebhook({
      deliveryHash,
      receivedAt,
      onboardingGeneration: generation,
      queueConfig: queueConfig('key-1', 1),
      batch,
    });
    const encrypted = inboxModel.create.mock.calls[0][0];
    const job = {
      ...encrypted,
      id: 7,
      attemptCount: 1,
      leaseToken: 'lease-7',
    } as WhatsAppWebhookInbox;

    await processWhatsAppWebhookJob(job, queueConfig('key-2', 2, [['key-1', 1]]));

    expect(mockIngest).toHaveBeenCalledWith(batch, {
      receivedAt,
      onboardingGeneration: generation,
    });
    expect(inboxModel.destroy).toHaveBeenCalledWith({
      where: { id: 7, status: 'processing', leaseToken: 'lease-7' },
    });
  });

  it('dead-letters an exhausted decrypt failure and degrades the source', async () => {
    const job = {
      id: 8,
      deliveryHash: 'c'.repeat(64),
      payloadCiphertext: Buffer.from('bad'),
      payloadIv: Buffer.alloc(12),
      payloadAuthTag: Buffer.alloc(16),
      encryptionKeyId: 'missing-key',
      onboardingGeneration: generation,
      receivedAt,
      attemptCount: 8,
      leaseToken: 'lease-8',
    } as WhatsAppWebhookInbox;

    await processWhatsAppWebhookJob(job, queueConfig('key-2', 2));

    expect(inboxModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', leaseToken: null }),
      { where: { id: 8, status: 'processing', leaseToken: 'lease-8' } },
    );
    expect(mockMarkSourceError).toHaveBeenCalledWith(
      'queue_dead_letter',
      expect.any(Date),
      generation,
    );
  });

  it('requeues a transient processing failure and degrades the source', async () => {
    const job = {
      id: 81,
      deliveryHash: 'd'.repeat(64),
      payloadCiphertext: Buffer.from('bad'),
      payloadIv: Buffer.alloc(12),
      payloadAuthTag: Buffer.alloc(16),
      encryptionKeyId: 'missing-key',
      onboardingGeneration: generation,
      receivedAt,
      attemptCount: 1,
      leaseToken: 'lease-81',
    } as WhatsAppWebhookInbox;

    await processWhatsAppWebhookJob(job, queueConfig('key-2', 2));

    expect(inboxModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued', leaseToken: null }),
      { where: { id: 81, status: 'processing', leaseToken: 'lease-81' } },
    );
    expect(mockMarkSourceError).toHaveBeenCalledWith(
      expect.stringMatching(/^queue_/),
      expect.any(Date),
      generation,
    );
  });

  it('renews only the matching processing lease', async () => {
    await expect(
      renewWhatsAppWebhookProcessingLease(9, 'lease-9', receivedAt),
    ).resolves.toBe(true);
    expect(inboxModel.update).toHaveBeenCalledWith(
      { nextAttemptAt: new Date('2026-08-27T07:35:00.000Z') },
      { where: { id: 9, status: 'processing', leaseToken: 'lease-9' } },
    );
  });
});

describe('WhatsApp queue keyring configuration', () => {
  const encodedKey = (byte: number): string => Buffer.alloc(32, byte).toString('base64');

  it('loads an atomic composite keyring with the first entry active', () => {
    const config = getWhatsAppWebhookQueueConfig({
      WHATSAPP_WEBHOOK_QUEUE_KEYRING:
        `key-2=${encodedKey(2)},key-1=${encodedKey(1)}`,
    });

    expect(config.activeKey).toEqual({ id: 'key-2', material: Buffer.alloc(32, 2) });
    expect(config.decryptionKeys.get('key-1')).toEqual(Buffer.alloc(32, 1));
  });

  it('rejects duplicate IDs in the composite keyring', () => {
    expect(() => getWhatsAppWebhookQueueConfig({
      WHATSAPP_WEBHOOK_QUEUE_KEYRING:
        `key-1=${encodedKey(1)},key-1=${encodedKey(2)}`,
    })).toThrow('Duplicate WhatsApp queue encryption key ID');
  });

  it('rejects more than four total composite keyring entries', () => {
    expect(() => getWhatsAppWebhookQueueConfig({
      WHATSAPP_WEBHOOK_QUEUE_KEYRING: [1, 2, 3, 4, 5]
        .map((key) => `key-${key}=${encodedKey(key)}`)
        .join(','),
    })).toThrow('supports at most 4 keys');
  });

  it('falls back to legacy queue fields when no composite keyring exists', () => {
    const config = getWhatsAppWebhookQueueConfig({
      WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID: 'key-2',
      WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY: encodedKey(2),
      WHATSAPP_WEBHOOK_QUEUE_PREVIOUS_KEYS: `key-1=${encodedKey(1)}`,
    });

    expect(config.activeKey.id).toBe('key-2');
    expect(config.decryptionKeys.get('key-1')).toEqual(Buffer.alloc(32, 1));
  });

  it('rejects an unbounded previous-key list', () => {
    expect(() => getWhatsAppWebhookQueueConfig({
      WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID: 'key-5',
      WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY: encodedKey(5),
      WHATSAPP_WEBHOOK_QUEUE_PREVIOUS_KEYS: [1, 2, 3, 4]
        .map((key) => `key-${key}=${encodedKey(key)}`)
        .join(','),
    })).toThrow(WhatsAppConfigError);
  });
});
