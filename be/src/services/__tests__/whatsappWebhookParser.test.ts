import { createHmac } from 'node:crypto';

jest.mock('../../services/configService.js', () => ({
  getConfigValueRaw: jest.fn((key: string) => process.env[key] ?? null),
  hasConfigValueOverride: jest.fn(() => false),
}));

import {
  parseMetaWebhook,
  parseSignedWhatsAppWebhook,
  parseWhatsAppWebhookPayload,
  verifyWhatsAppWebhookSignature,
  WhatsAppWebhookSignatureError,
  WhatsAppWebhookValidationError,
} from '../whatsappWebhookParser';
import {
  getWhatsAppConfigValue,
  getWhatsAppBriefConfig,
  getWhatsAppWebhookConfig,
  getWhatsAppWebhookQueueConfig,
  loadWhatsAppConfig,
  resolveWhatsAppOnboardingGeneration,
  WhatsAppConfigError,
} from '../../config/whatsappConfig';
import { getConfigValueRaw, hasConfigValueOverride } from '../../services/configService';

const mockGetConfigValueRaw = getConfigValueRaw as jest.MockedFunction<typeof getConfigValueRaw>;
const mockHasConfigValueOverride = hasConfigValueOverride as jest.MockedFunction<
  typeof hasConfigValueOverride
>;

const options = {
  expectedWabaId: 'waba-1',
  expectedPhoneNumberId: 'phone-number-1',
};

const metadata = {
  display_phone_number: '15550001111',
  phone_number_id: options.expectedPhoneNumberId,
};

describe('WhatsApp webhook signature verification', () => {
  const appSecret = 'test-only-app-secret';
  const rawBody = Buffer.from('{"object":"whatsapp_business_account"}', 'utf8');
  const signature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

  it('validates the exact raw request bytes', () => {
    expect(verifyWhatsAppWebhookSignature(rawBody, signature, appSecret)).toBe(true);
    expect(
      verifyWhatsAppWebhookSignature(
        Buffer.from('{ "object":"whatsapp_business_account"}', 'utf8'),
        signature,
        appSecret,
      ),
    ).toBe(false);
  });

  it('rejects malformed and mismatched signatures', () => {
    expect(verifyWhatsAppWebhookSignature(rawBody, undefined, appSecret)).toBe(false);
    expect(verifyWhatsAppWebhookSignature(rawBody, 'sha256=not-hex', appSecret)).toBe(false);
    expect(
      verifyWhatsAppWebhookSignature(rawBody, `sha256=${'0'.repeat(64)}`, appSecret),
    ).toBe(false);
  });

  it('verifies before parsing a signed payload', () => {
    expect(() =>
      parseSignedWhatsAppWebhook(rawBody, `sha256=${'0'.repeat(64)}`, {
        metaAppSecret: appSecret,
        wabaId: options.expectedWabaId,
        phoneNumberId: options.expectedPhoneNumberId,
      }),
    ).toThrow(WhatsAppWebhookSignatureError);
  });
});

describe('WhatsApp configuration', () => {
  const environment = {
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-token',
    WHATSAPP_META_APP_SECRET: 'app-secret',
    WHATSAPP_WABA_ID: 'waba-1',
    WHATSAPP_PHONE_NUMBER_ID: 'phone-number-1',
    WHATSAPP_BRIEF_API_TOKEN: 'brief-token',
  };

  beforeEach(() => {
    mockGetConfigValueRaw.mockReset();
    mockGetConfigValueRaw.mockImplementation((key) => process.env[key] ?? null);
    mockHasConfigValueOverride.mockReset();
    mockHasConfigValueOverride.mockReturnValue(false);
  });

  it('loads webhook and brief settings from only the supported environment keys', () => {
    expect(getWhatsAppWebhookConfig(environment)).toEqual({
      verifyToken: 'verify-token',
      appSecret: 'app-secret',
      wabaId: 'waba-1',
      phoneNumberId: 'phone-number-1',
      retentionDays: 7,
    });
    expect(
      getWhatsAppBriefConfig({ ...environment, WHATSAPP_RETENTION_DAYS: '14' }),
    ).toEqual({ apiToken: 'brief-token', retentionDays: 14 });
  });

  it('rejects missing values and invalid retention without exposing their contents', () => {
    expect(() =>
      getWhatsAppWebhookConfig({ ...environment, WHATSAPP_META_APP_SECRET: '   ' }),
    ).toThrow(WhatsAppConfigError);
    expect(() =>
      getWhatsAppBriefConfig({ ...environment, WHATSAPP_RETENTION_DAYS: '7.5' }),
    ).toThrow('WHATSAPP_RETENTION_DAYS must be a positive integer');
  });

  it('uses dynamic registry values by default while explicit environments remain isolated', () => {
    const dynamicValues: Record<string, string> = {
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'dynamic-verify-token',
      WHATSAPP_META_APP_SECRET: 'dynamic-app-secret',
      WHATSAPP_WABA_ID: 'dynamic-waba',
      WHATSAPP_PHONE_NUMBER_ID: 'dynamic-phone',
      WHATSAPP_BRIEF_API_TOKEN: 'dynamic-brief-token',
      WHATSAPP_RETENTION_DAYS: '5',
      WHATSAPP_ONBOARDING_GENERATION: 'generation-3',
      WHATSAPP_WEBHOOK_QUEUE_KEYRING:
        `queue-key-3=${Buffer.alloc(32, 3).toString('base64')},queue-key-2=${Buffer.alloc(32, 2).toString('base64')}`,
      WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID: 'queue-key-3',
      WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY: Buffer.alloc(32, 9).toString('base64'),
      WHATSAPP_CONTACT_HASH_KEY: 'dynamic-contact-hash-key',
      WHATSAPP_SOURCE_STALE_HOURS: '72',
    };
    mockGetConfigValueRaw.mockImplementation((key) => dynamicValues[key] ?? null);

    expect(loadWhatsAppConfig()).toEqual({
      webhookVerifyToken: 'dynamic-verify-token',
      metaAppSecret: 'dynamic-app-secret',
      wabaId: 'dynamic-waba',
      phoneNumberId: 'dynamic-phone',
      briefApiToken: 'dynamic-brief-token',
      retentionDays: 5,
    });
    expect(resolveWhatsAppOnboardingGeneration()).toBe('generation-3');
    expect(getWhatsAppWebhookQueueConfig()).toEqual({
      activeKey: { id: 'queue-key-3', material: Buffer.alloc(32, 3) },
      decryptionKeys: new Map([
        ['queue-key-3', Buffer.alloc(32, 3)],
        ['queue-key-2', Buffer.alloc(32, 2)],
      ]),
    });
    expect(getWhatsAppConfigValue('WHATSAPP_CONTACT_HASH_KEY')).toBe(
      'dynamic-contact-hash-key',
    );
    expect(getWhatsAppConfigValue('WHATSAPP_SOURCE_STALE_HOURS')).toBe('72');

    mockGetConfigValueRaw.mockClear();
    expect(getWhatsAppWebhookConfig(environment).appSecret).toBe('app-secret');
    expect(mockGetConfigValueRaw).not.toHaveBeenCalled();
  });

  it('does not reactivate legacy queue fields after the composite keyring is cleared', () => {
    const legacyValues: Record<string, string> = {
      WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID: 'legacy-key',
      WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY: Buffer.alloc(32, 8).toString('base64'),
    };
    mockGetConfigValueRaw.mockImplementation((key) => legacyValues[key] ?? null);
    mockHasConfigValueOverride.mockImplementation(
      (key) => key === 'WHATSAPP_WEBHOOK_QUEUE_KEYRING',
    );

    expect(() => getWhatsAppWebhookQueueConfig()).toThrow(
      'Missing required WhatsApp configuration: WHATSAPP_WEBHOOK_QUEUE_KEYRING',
    );
  });
});

describe('parseWhatsAppWebhookPayload', () => {
  it('parses inbound messages and statuses from every entry and change', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: options.expectedWabaId,
          changes: [
            {
              field: 'messages',
              value: {
                metadata,
                contacts: [{ wa_id: 'customer-1', profile: { name: 'Ada' } }],
                messages: [
                  {
                    from: 'customer-1',
                    id: 'message-1',
                    timestamp: '1787808600',
                    type: 'text',
                    text: { body: 'Can I check in early?' },
                    context: { id: 'message-before' },
                  },
                ],
                statuses: [
                  {
                    id: 'sent-message-1',
                    recipient_id: 'customer-2',
                    status: 'delivered',
                    timestamp: 1787808601,
                    conversation: { id: 'conversation-1' },
                    pricing: { category: 'utility' },
                  },
                ],
              },
            },
            {
              field: 'messages',
              value: {
                metadata,
                messages: [
                  {
                    from: 'customer-3',
                    id: 'message-2',
                    timestamp: 1787808602000,
                    type: 'image',
                    image: { id: 'discard-this-media-id', caption: 'Broken shower' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const result = parseWhatsAppWebhookPayload(payload, options);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      kind: 'message',
      source: 'messages',
      direction: 'inbound',
      action: 'create',
      wabaId: options.expectedWabaId,
      phoneNumberId: options.expectedPhoneNumberId,
      messageId: 'message-1',
      targetMessageId: null,
      senderWaId: 'customer-1',
      recipientWaId: null,
      contactName: 'Ada',
      messageType: 'text',
      text: 'Can I check in early?',
      contextMessageId: 'message-before',
      timestamp: new Date('2026-08-27T05:30:00.000Z'),
    });
    expect(result[1]).toEqual(
      expect.objectContaining({
        kind: 'status',
        messageId: 'sent-message-1',
        status: 'delivered',
        recipientWaId: 'customer-2',
        conversationId: 'conversation-1',
      }),
    );
    expect(result[2]).toEqual(
      expect.objectContaining({
        kind: 'message',
        messageId: 'message-2',
        messageType: 'image',
        text: 'Broken shower',
        timestamp: new Date('2026-08-27T05:30:02.000Z'),
      }),
    );
    expect(result[2]).not.toHaveProperty('mediaId');
    expect(JSON.stringify(result)).not.toContain('discard-this-media-id');
  });

  it('parses all history threads and infers inbound and outbound direction', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: options.expectedWabaId,
          changes: [
            {
              field: 'history',
              value: {
                metadata,
                history: [
                  {
                    metadata: { phase: 'INITIAL_BOOTSTRAP', chunk_order: 1, progress: 50 },
                    threads: [
                      {
                        id: 'customer-1',
                        messages: [
                          {
                            from: 'customer-1',
                            to: '15550001111',
                            id: 'history-inbound',
                            timestamp: '1787808600',
                            type: 'text',
                            text: { body: 'Inbound history' },
                          },
                          {
                            from: '15550001111',
                            id: 'history-outbound',
                            timestamp: 1787808601,
                            type: 'document',
                            document: { id: 'discard-document-id', caption: 'Your receipt' },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const result = parseWhatsAppWebhookPayload(payload, options);

    expect(result).toEqual([
      expect.objectContaining({
        kind: 'history_sync',
        source: 'history',
        status: 'in_progress',
        progress: 50,
        chunkOrder: 1,
      }),
      expect.objectContaining({
        source: 'history',
        direction: 'inbound',
        messageId: 'history-inbound',
        text: 'Inbound history',
      }),
      expect.objectContaining({
        source: 'history',
        direction: 'outbound',
        messageId: 'history-outbound',
        recipientWaId: 'customer-1',
        text: 'Your receipt',
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('discard-document-id');
  });

  it('surfaces declined history sharing without retaining error details', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: options.expectedWabaId,
        changes: [{
          field: 'history',
          value: {
            metadata,
            history: [{ errors: [{ code: 2593109, message: 'Private error details' }] }],
          },
        }],
      }],
    };

    const result = parseWhatsAppWebhookPayload(payload, options);

    expect(result).toEqual([
      expect.objectContaining({
        kind: 'history_sync',
        status: 'declined',
        errorCode: '2593109',
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('Private error details');
  });

  it('surfaces account removal as source-unavailable state', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: options.expectedWabaId,
        changes: [{ field: 'account_update', value: { event: 'PARTNER_REMOVED' } }],
      }],
    };

    expect(parseWhatsAppWebhookPayload(payload, options)).toEqual([{
      kind: 'account_state',
      source: 'account_update',
      wabaId: options.expectedWabaId,
      phoneNumberId: options.expectedPhoneNumberId,
      event: 'PARTNER_REMOVED',
      unavailable: true,
    }]);
  });

  it('normalizes message echoes, including edit and revoke events', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: options.expectedWabaId,
          changes: [
            {
              field: 'smb_message_echoes',
              value: {
                metadata,
                message_echoes: [
                  {
                    from: '15550001111',
                    to: 'customer-1',
                    id: 'echo-text',
                    timestamp: 1787808600,
                    type: 'text',
                    text: { body: 'See you soon' },
                  },
                  {
                    from: '15550001111',
                    to: 'customer-1',
                    id: 'echo-edit',
                    timestamp: '1787808601',
                    type: 'edit',
                    edit: {
                      original_message_id: 'echo-text',
                      message: { type: 'text', text: { body: 'See you at 3' } },
                    },
                  },
                  {
                    from: '15550001111',
                    to: 'customer-1',
                    id: 'echo-revoke',
                    timestamp: '1787808602',
                    type: 'revoke',
                    revoke: { original_message_id: 'echo-text' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const result = parseWhatsAppWebhookPayload(payload, options);

    expect(result).toEqual([
      expect.objectContaining({
        source: 'smb_message_echoes',
        direction: 'outbound',
        action: 'create',
        messageId: 'echo-text',
        text: 'See you soon',
      }),
      expect.objectContaining({
        source: 'smb_message_echoes',
        direction: 'outbound',
        action: 'edit',
        messageId: 'echo-edit',
        targetMessageId: 'echo-text',
        messageType: 'text',
        text: 'See you at 3',
      }),
      expect.objectContaining({
        source: 'smb_message_echoes',
        direction: 'outbound',
        action: 'revoke',
        messageId: 'echo-revoke',
        targetMessageId: 'echo-text',
        text: null,
      }),
    ]);
  });

  it('validates but does not retain app-state/contact sync changes', () => {
    const result = parseWhatsAppWebhookPayload(
      {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: options.expectedWabaId,
            changes: [
              {
                field: 'smb_app_state_sync',
                value: {
                  metadata,
                  state_sync: [{
                    type: 'contact',
                    contact: { full_name: 'Do not ingest', phone_number: '48123456789' },
                    action: 'add',
                  }],
                },
              },
            ],
          },
        ],
      },
      options,
    );

    expect(result).toEqual([]);

    expect(() => parseWhatsAppWebhookPayload(
      {
        object: 'whatsapp_business_account',
        entry: [{
          id: options.expectedWabaId,
          changes: [{
            field: 'smb_app_state_sync',
            value: {
              metadata: { ...metadata, phone_number_id: 'another-phone' },
              state_sync: [],
            },
          }],
        }],
      },
      options,
    )).toThrow('unexpected phone number id');
  });

  it('parses a raw JSON Buffer into a batch', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ id: options.expectedWabaId, changes: [] }],
      }),
      'utf8',
    );

    expect(
      parseMetaWebhook(rawBody, {
        wabaId: options.expectedWabaId,
        phoneNumberId: options.expectedPhoneNumberId,
      }),
    ).toEqual({ events: [] });
  });

  it('rejects the wrong webhook object, WABA, or phone number id', () => {
    expect(() => parseWhatsAppWebhookPayload({ object: 'page' }, options)).toThrow(
      WhatsAppWebhookValidationError,
    );

    const basePayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: options.expectedWabaId,
          changes: [{ field: 'messages', value: { metadata } }],
        },
      ],
    };

    expect(() =>
      parseWhatsAppWebhookPayload(
        { ...basePayload, entry: [{ ...basePayload.entry[0], id: 'another-waba' }] },
        options,
      ),
    ).toThrow('unexpected WABA id');

    expect(() =>
      parseWhatsAppWebhookPayload(
        {
          ...basePayload,
          entry: [
            {
              ...basePayload.entry[0],
              changes: [
                {
                  field: 'messages',
                  value: { metadata: { ...metadata, phone_number_id: 'another-phone' } },
                },
              ],
            },
          ],
        },
        options,
      ),
    ).toThrow('unexpected phone number id');
  });
});
