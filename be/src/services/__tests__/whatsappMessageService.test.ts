import { Op } from 'sequelize';
import WhatsAppMessage from '../../models/WhatsAppMessage';
import WhatsAppSourceState from '../../models/WhatsAppSourceState';
import WhatsAppWebhookInbox from '../../models/WhatsAppWebhookInbox';

jest.mock('../../models/WhatsAppMessage.js', () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    bulkCreate: jest.fn(),
    destroy: jest.fn(),
  },
}));

jest.mock('../../models/WhatsAppSourceState.js', () => ({
  __esModule: true,
  default: {
    findByPk: jest.fn(),
    upsert: jest.fn(),
  },
}));

jest.mock('../../models/WhatsAppWebhookInbox.js', () => ({
  __esModule: true,
  default: {
    count: jest.fn(),
    findOne: jest.fn(),
  },
}));

import {
  deleteExpiredWhatsAppMessages,
  getWhatsAppSourceStatus,
  ingestWhatsAppWebhook,
  markWhatsAppSourceError,
  searchWhatsAppMessages,
} from '../whatsappMessageService';

const messageModel = WhatsAppMessage as unknown as {
  findAll: jest.Mock;
  findOne: jest.Mock;
  bulkCreate: jest.Mock;
  destroy: jest.Mock;
};
const sourceStateModel = WhatsAppSourceState as unknown as {
  findByPk: jest.Mock;
  upsert: jest.Mock;
};
const inboxModel = WhatsAppWebhookInbox as unknown as {
  count: jest.Mock;
  findOne: jest.Mock;
};

describe('whatsappMessageService', () => {
  const now = new Date('2026-08-27T07:30:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_RETENTION_DAYS = '7';
    process.env.WHATSAPP_ONBOARDING_GENERATION = 'generation-1';
    process.env.WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID = 'queue-key-1';
    process.env.WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    messageModel.findAll.mockResolvedValue([]);
    messageModel.bulkCreate.mockResolvedValue([]);
    messageModel.destroy.mockResolvedValue(0);
    sourceStateModel.findByPk.mockResolvedValue(null);
    sourceStateModel.upsert.mockResolvedValue([{}, true]);
    inboxModel.count.mockResolvedValue(0);
    inboxModel.findOne.mockResolvedValue(null);
  });

  afterAll(() => {
    delete process.env.WHATSAPP_RETENTION_DAYS;
    delete process.env.WHATSAPP_ONBOARDING_GENERATION;
    delete process.env.WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID;
    delete process.env.WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY;
  });

  it('deduplicates a batch and persists only hashed contact metadata', async () => {
    const result = await ingestWhatsAppWebhook(
      {
        events: [
          {
            kind: 'message',
            source: 'messages',
            direction: 'inbound',
            action: 'create',
            wabaId: 'waba-1',
            phoneNumberId: 'phone-1',
            timestamp: new Date('2026-08-27T07:00:00.000Z'),
            messageId: 'wamid.message-1',
            targetMessageId: null,
            senderWaId: '481234567',
            recipientWaId: null,
            contactName: 'Guest',
            messageType: 'text',
            text: 'Earlier text',
            contextMessageId: null,
          },
          {
            kind: 'message',
            source: 'messages',
            direction: 'inbound',
            action: 'create',
            wabaId: 'waba-1',
            phoneNumberId: 'phone-1',
            timestamp: new Date('2026-08-27T07:01:00.000Z'),
            messageId: 'wamid.message-1',
            targetMessageId: null,
            senderWaId: '481234567',
            recipientWaId: null,
            contactName: 'Guest',
            messageType: 'text',
            text: 'Latest text',
            contextMessageId: null,
          },
        ],
      },
      { receivedAt: now, contactHashKey: 'test-contact-key' },
    );

    expect(result).toEqual({ inserted: 1, deduplicated: 1, statusesUpdated: 0 });
    const [rows] = messageModel.bulkCreate.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      providerMessageId: 'wamid.message-1',
      contactPhoneSuffix: '4567',
      textContent: 'Latest text',
    });
    expect(rows[0].contactKey).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(rows[0])).not.toContain('481234567');
  });

  it('applies revocation to the target WAMID and clears message content', async () => {
    const result = await ingestWhatsAppWebhook(
      {
        events: [
          {
            kind: 'message',
            source: 'messages',
            direction: 'outbound',
            action: 'revoke',
            wabaId: 'waba-1',
            phoneNumberId: 'phone-1',
            timestamp: now,
            messageId: 'wamid.revoke-event',
            targetMessageId: 'wamid.original',
            senderWaId: null,
            recipientWaId: '481234567',
            contactName: null,
            messageType: 'text',
            text: 'must not persist',
            contextMessageId: 'wamid.context',
          },
        ],
      },
      { receivedAt: now, contactHashKey: 'test-contact-key' },
    );

    expect(result).toEqual({ inserted: 1, deduplicated: 0, statusesUpdated: 0 });
    const [rows] = messageModel.bulkCreate.mock.calls[0];
    expect(rows[0]).toMatchObject({
      providerMessageId: 'wamid.original',
      textContent: null,
      contextProviderMessageId: null,
      revokedAt: now,
    });
  });

  it('caps lookback at seven days, caps results at 100, and returns serializable citations', async () => {
    process.env.WHATSAPP_RETENTION_DAYS = '99';
    messageModel.findAll.mockResolvedValue([
      {
        providerMessageId: 'wamid.message-2',
        direction: 'inbound',
        source: 'messages',
        occurredAt: new Date('2026-08-27T07:00:00.000Z'),
        contactDisplayName: 'Guest',
        contactPhoneSuffix: '4567',
        messageType: 'text',
        textContent: 'Can you confirm?',
        contextProviderMessageId: null,
        deliveryStatus: null,
        editedAt: null,
        revokedAt: null,
      },
    ]);

    const items = await searchWhatsAppMessages({
      since: new Date('2026-07-01T00:00:00.000Z'),
      until: new Date('2026-09-01T00:00:00.000Z'),
      limit: 1_000,
      now,
    });

    const query = messageModel.findAll.mock.calls[0][0];
    expect(query.limit).toBe(100);
    expect(query.where.occurredAt[Op.gte]).toEqual(
      new Date('2026-08-20T07:30:00.000Z'),
    );
    expect(query.where.occurredAt[Op.lte]).toEqual(now);
    expect(items).toEqual([
      expect.objectContaining({
        citationRef: 'whatsapp:wamid.message-2',
        timestamp: '2026-08-27T07:00:00.000Z',
        text: 'Can you confirm?',
      }),
    ]);
    expect(JSON.stringify(items)).toContain('2026-08-27T07:00:00.000Z');
  });

  it('deletes messages older than the configured retention cutoff', async () => {
    messageModel.destroy.mockResolvedValue(4);
    await expect(deleteExpiredWhatsAppMessages(now)).resolves.toBe(4);

    const where = messageModel.destroy.mock.calls[0][0].where.occurredAt;
    expect(where[Op.lt]).toEqual(new Date('2026-08-20T07:30:00.000Z'));
  });

  it('never persists history content outside the retention window', async () => {
    const result = await ingestWhatsAppWebhook(
      {
        events: [
          {
            kind: 'message',
            source: 'history',
            direction: 'inbound',
            action: 'create',
            wabaId: 'waba-1',
            phoneNumberId: 'phone-1',
            timestamp: new Date('2026-08-01T07:00:00.000Z'),
            messageId: 'wamid.expired-history',
            targetMessageId: null,
            senderWaId: '481234567',
            recipientWaId: null,
            contactName: null,
            messageType: 'text',
            text: 'Expired history must not be stored',
            contextMessageId: null,
          },
        ],
      },
      { receivedAt: now, contactHashKey: 'test-contact-key' },
    );

    expect(result).toEqual({ inserted: 0, deduplicated: 0, statusesUpdated: 0 });
    expect(messageModel.bulkCreate).not.toHaveBeenCalled();
    expect(messageModel.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['complete', 'connected', null],
    ['failed', 'degraded', '2593109'],
  ] as const)('tracks a %s history sync control event', async (historyStatus, sourceStatus, errorCode) => {
    await ingestWhatsAppWebhook(
      {
        events: [{
          kind: 'history_sync',
          source: 'history',
          wabaId: 'waba-1',
          phoneNumberId: 'phone-1',
          status: historyStatus,
          progress: historyStatus === 'complete' ? 100 : null,
          phase: 2,
          chunkOrder: 1,
          errorCode,
        }],
      },
      { receivedAt: now, contactHashKey: 'test-contact-key' },
    );

    expect(sourceStateModel.upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      status: sourceStatus,
      historySyncStatus: historyStatus,
      lastErrorCode: errorCode,
    }));
  });

  it('does not regress a completed history sync when an older chunk arrives later', async () => {
    sourceStateModel.findByPk.mockResolvedValue({
      onboardingGeneration: 'generation-1',
      historySyncStatus: 'complete',
      historySyncProgress: 100,
    });

    await ingestWhatsAppWebhook(
      {
        events: [{
          kind: 'history_sync',
          source: 'history',
          wabaId: 'waba-1',
          phoneNumberId: 'phone-1',
          status: 'in_progress',
          progress: 50,
          phase: 0,
          chunkOrder: 1,
          errorCode: null,
        }],
      },
      { receivedAt: now, contactHashKey: 'test-contact-key' },
    );

    expect(sourceStateModel.upsert).toHaveBeenCalledWith(expect.objectContaining({
      historySyncStatus: 'complete',
      historySyncProgress: 100,
    }));
  });

  it('marks a previously connected source unavailable when webhook activity is stale', async () => {
    process.env.WHATSAPP_SOURCE_STALE_HOURS = '96';
    sourceStateModel.findByPk.mockResolvedValue({
      status: 'connected',
      onboardingGeneration: 'generation-1',
      disconnectedGeneration: null,
      historySyncStatus: 'complete',
      historySyncProgress: 100,
      lastWebhookAt: new Date('2026-08-20T00:00:00.000Z'),
      lastSuccessfulIngestAt: new Date('2026-08-20T00:00:00.000Z'),
      lastMessageAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
    });

    const status = await getWhatsAppSourceStatus(now);

    expect(status).toMatchObject({ available: false, status: 'degraded', stale: true });
    delete process.env.WHATSAPP_SOURCE_STALE_HOURS;
  });

  it('marks the source unavailable when Meta reports account removal', async () => {
    await ingestWhatsAppWebhook(
      {
        events: [{
          kind: 'account_state',
          source: 'account_update',
          wabaId: 'waba-1',
          phoneNumberId: null,
          event: 'PARTNER_REMOVED',
          unavailable: true,
        }],
      },
      { receivedAt: now, contactHashKey: 'test-contact-key' },
    );

    expect(sourceStateModel.upsert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'unavailable',
      lastErrorCode: 'partner_removed',
    }));
  });

  it('keeps account removal sticky for later webhooks in the same generation', async () => {
    sourceStateModel.findByPk.mockResolvedValue({
      status: 'unavailable',
      onboardingGeneration: 'generation-1',
      disconnectedGeneration: 'generation-1',
      historySyncStatus: 'complete',
      historySyncProgress: 100,
      lastWebhookAt: new Date('2026-08-27T07:00:00.000Z'),
      lastSuccessfulIngestAt: new Date('2026-08-27T07:00:00.000Z'),
      lastMessageAt: null,
      lastErrorAt: new Date('2026-08-27T07:00:00.000Z'),
      lastErrorCode: 'partner_removed',
    });

    await ingestWhatsAppWebhook(
      { events: [] },
      { receivedAt: now, contactHashKey: 'test-contact-key' },
    );

    expect(sourceStateModel.upsert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'unavailable',
      onboardingGeneration: 'generation-1',
      disconnectedGeneration: 'generation-1',
    }));
  });

  it('clears sticky removal only after a configured generation change', async () => {
    process.env.WHATSAPP_ONBOARDING_GENERATION = 'generation-2';
    sourceStateModel.findByPk.mockResolvedValue({
      status: 'unavailable',
      onboardingGeneration: 'generation-1',
      disconnectedGeneration: 'generation-1',
      historySyncStatus: 'complete',
      historySyncProgress: 100,
      lastWebhookAt: now,
      lastSuccessfulIngestAt: now,
      lastMessageAt: null,
      lastErrorAt: now,
      lastErrorCode: 'partner_removed',
    });

    await ingestWhatsAppWebhook(
      { events: [] },
      { receivedAt: now, onboardingGeneration: 'generation-2' },
    );

    expect(sourceStateModel.upsert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'degraded',
      onboardingGeneration: 'generation-2',
      disconnectedGeneration: null,
      historySyncStatus: 'not_started',
      historySyncProgress: null,
    }));
  });

  it('resets old-generation history when a queue failure occurs after rotation', async () => {
    process.env.WHATSAPP_ONBOARDING_GENERATION = 'generation-2';
    sourceStateModel.findByPk.mockResolvedValue({
      status: 'unavailable',
      onboardingGeneration: 'generation-1',
      disconnectedGeneration: 'generation-1',
      historySyncStatus: 'complete',
      historySyncProgress: 100,
      lastErrorAt: now,
    });

    await markWhatsAppSourceError('queue_config_failed', now, 'generation-2');

    expect(sourceStateModel.upsert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'degraded',
      onboardingGeneration: 'generation-2',
      disconnectedGeneration: null,
      historySyncStatus: 'not_started',
      historySyncProgress: null,
    }));
  });

  it('never regresses source timestamps when an older delivery is processed', async () => {
    const later = new Date('2026-08-27T07:25:00.000Z');
    sourceStateModel.findByPk.mockResolvedValue({
      status: 'connected',
      onboardingGeneration: 'generation-1',
      disconnectedGeneration: null,
      historySyncStatus: 'complete',
      historySyncProgress: 100,
      lastWebhookAt: later,
      lastSuccessfulIngestAt: later,
      lastMessageAt: later,
      lastErrorAt: null,
      lastErrorCode: null,
    });

    await ingestWhatsAppWebhook(
      { events: [] },
      { receivedAt: new Date('2026-08-27T07:00:00.000Z') },
    );

    expect(sourceStateModel.upsert).toHaveBeenCalledWith(expect.objectContaining({
      lastWebhookAt: later,
      lastSuccessfulIngestAt: later,
      lastMessageAt: later,
    }));
  });

  it('does not expose messages while initial history is incomplete', async () => {
    sourceStateModel.findByPk.mockResolvedValue({
      status: 'connected',
      onboardingGeneration: 'generation-1',
      disconnectedGeneration: null,
      historySyncStatus: 'in_progress',
      historySyncProgress: 70,
      lastWebhookAt: now,
      lastSuccessfulIngestAt: now,
      lastMessageAt: now,
      lastErrorAt: null,
      lastErrorCode: null,
    });

    await expect(getWhatsAppSourceStatus(now)).resolves.toMatchObject({
      available: false,
      status: 'degraded',
      historySyncStatus: 'in_progress',
    });
  });

  it('allows a fresh in-flight queue item but blocks a dead letter', async () => {
    sourceStateModel.findByPk.mockResolvedValue({
      status: 'connected',
      onboardingGeneration: 'generation-1',
      disconnectedGeneration: null,
      historySyncStatus: 'complete',
      historySyncProgress: 100,
      lastWebhookAt: now,
      lastSuccessfulIngestAt: now,
      lastMessageAt: now,
      lastErrorAt: null,
      lastErrorCode: null,
    });
    inboxModel.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    inboxModel.findOne.mockResolvedValue({
      receivedAt: new Date(now.getTime() - 60_000),
    });
    await expect(getWhatsAppSourceStatus(now)).resolves.toMatchObject({
      available: true,
      queue: { queued: 1, processing: 1, failed: 0 },
    });

    inboxModel.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    inboxModel.findOne.mockResolvedValue(null);
    await expect(getWhatsAppSourceStatus(now)).resolves.toMatchObject({
      available: false,
      status: 'degraded',
      queue: { failed: 1 },
    });
  });
});
