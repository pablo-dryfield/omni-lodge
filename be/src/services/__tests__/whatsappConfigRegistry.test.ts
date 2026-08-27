import { CONFIG_DEFINITION_MAP } from '../../config/appConfigRegistry';

const WHATSAPP_CONFIG_KEYS = [
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'WHATSAPP_META_APP_ID',
  'WHATSAPP_META_APP_SECRET',
  'WHATSAPP_META_GRAPH_API_VERSION',
  'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID',
  'WHATSAPP_BUSINESS_ACCESS_TOKEN',
  'WHATSAPP_WABA_ID',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BRIEF_API_TOKEN',
  'WHATSAPP_ONBOARDING_GENERATION',
  'WHATSAPP_WEBHOOK_QUEUE_KEYRING',
  'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID',
  'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY',
  'WHATSAPP_WEBHOOK_QUEUE_PREVIOUS_KEYS',
  'WHATSAPP_CONTACT_HASH_KEY',
  'WHATSAPP_RETENTION_DAYS',
  'WHATSAPP_SOURCE_STALE_HOURS',
] as const;

describe('WhatsApp control-panel registry', () => {
  it('registers every runtime setting in one control-panel category', () => {
    const definitions = WHATSAPP_CONFIG_KEYS.map((key) => CONFIG_DEFINITION_MAP.get(key));

    expect(definitions).not.toContain(undefined);
    expect(definitions.map((definition) => definition?.category)).toEqual(
      Array(WHATSAPP_CONFIG_KEYS.length).fill('WhatsApp Business'),
    );
  });

  it('encrypts credential and key material but leaves Meta identifiers visible', () => {
    const secretKeys = [
      'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
      'WHATSAPP_META_APP_SECRET',
      'WHATSAPP_BUSINESS_ACCESS_TOKEN',
      'WHATSAPP_BRIEF_API_TOKEN',
      'WHATSAPP_WEBHOOK_QUEUE_KEYRING',
      'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY',
      'WHATSAPP_WEBHOOK_QUEUE_PREVIOUS_KEYS',
      'WHATSAPP_CONTACT_HASH_KEY',
    ];
    const visibleKeys = [
      'WHATSAPP_WABA_ID',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_META_APP_ID',
      'WHATSAPP_META_GRAPH_API_VERSION',
      'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID',
      'WHATSAPP_ONBOARDING_GENERATION',
      'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID',
      'WHATSAPP_RETENTION_DAYS',
      'WHATSAPP_SOURCE_STALE_HOURS',
    ];

    secretKeys.forEach((key) => expect(CONFIG_DEFINITION_MAP.get(key)?.isSecret).toBe(true));
    visibleKeys.forEach((key) => expect(CONFIG_DEFINITION_MAP.get(key)?.isSecret).not.toBe(true));
  });

  it('declares bounded retention, staleness, identifier, and keyring validation', () => {
    expect(CONFIG_DEFINITION_MAP.get('WHATSAPP_RETENTION_DAYS')?.validation).toEqual({
      required: true,
      integer: true,
      min: 1,
      max: 7,
    });
    expect(CONFIG_DEFINITION_MAP.get('WHATSAPP_SOURCE_STALE_HOURS')?.validation).toEqual({
      required: true,
      integer: true,
      min: 1,
      max: 168,
    });
    expect(CONFIG_DEFINITION_MAP.get('WHATSAPP_WABA_ID')?.validation).toEqual(
      expect.objectContaining({ pattern: '^\\d{1,64}$', maxLength: 64 }),
    );
    expect(
      CONFIG_DEFINITION_MAP.get('WHATSAPP_WEBHOOK_QUEUE_KEYRING')?.validation,
    ).toEqual(expect.objectContaining({ format: 'whatsapp-queue-keyring', maxLength: 512 }));
  });

  it('keeps separate legacy queue fields noneditable', () => {
    [
      'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID',
      'WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY',
      'WHATSAPP_WEBHOOK_QUEUE_PREVIOUS_KEYS',
    ].forEach((key) => {
      expect(CONFIG_DEFINITION_MAP.get(key)?.isEditable).toBe(false);
    });
  });

  it('keeps onboarding output system-managed and sensitive credentials non-revealable', () => {
    [
      'WHATSAPP_BUSINESS_ACCESS_TOKEN',
      'WHATSAPP_WABA_ID',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_ONBOARDING_GENERATION',
    ].forEach((key) => {
      expect(CONFIG_DEFINITION_MAP.get(key)).toEqual(expect.objectContaining({
        isEditable: false,
        isSystemManaged: true,
      }));
    });
    ['WHATSAPP_META_APP_SECRET', 'WHATSAPP_BUSINESS_ACCESS_TOKEN'].forEach((key) => {
      expect(CONFIG_DEFINITION_MAP.get(key)?.isRevealable).toBe(false);
    });
  });
});
