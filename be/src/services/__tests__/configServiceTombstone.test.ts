jest.mock('../../models/ConfigKey.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn(), findAll: jest.fn() },
}));
jest.mock('../../models/ConfigValue.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), findByPk: jest.fn(), findAll: jest.fn() },
}));
jest.mock('../../models/ConfigHistory.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), findAll: jest.fn() },
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../configEncryptionService.js', () => ({
  decryptSecret: jest.fn(),
  encryptSecret: jest.fn(),
}));
jest.mock('../seedRunService.js', () => ({
  hasSeedRun: jest.fn(),
  recordSeedRun: jest.fn(),
  listSeedRuns: jest.fn(),
}));

import ConfigKey from '../../models/ConfigKey';
import ConfigValue from '../../models/ConfigValue';
import ConfigHistory from '../../models/ConfigHistory';
import { getWhatsAppWebhookQueueConfig } from '../../config/whatsappConfig';
import {
  getConfigDetail,
  getConfigValue,
  getConfigValueRaw,
  hasConfigValueOverride,
  listConfigEntries,
  refreshConfigCache,
  revealConfigSecret,
  updateConfigValue,
} from '../configService';

const configKeyModel = ConfigKey as unknown as {
  findByPk: jest.Mock;
  findAll: jest.Mock;
};
const configValueModel = ConfigValue as unknown as {
  create: jest.Mock;
  findByPk: jest.Mock;
  findAll: jest.Mock;
};
const configHistoryModel = ConfigHistory as unknown as { create: jest.Mock };

const retentionDefinitionRecord = {
  key: 'WHATSAPP_RETENTION_DAYS',
  label: 'WhatsApp message retention (days)',
  description: null,
  category: 'WhatsApp Business',
  valueType: 'number',
  defaultValue: '7',
  validationRules: { required: true, integer: true, min: 1, max: 7 },
  isSecret: false,
  isEditable: true,
  impact: 'high',
};

const appSecretDefinitionRecord = {
  key: 'WHATSAPP_META_APP_SECRET',
  label: 'WhatsApp Meta app secret',
  description: null,
  category: 'WhatsApp Business',
  valueType: 'string',
  defaultValue: null,
  validationRules: null,
  isSecret: true,
  isEditable: true,
  impact: 'high',
};

const tombstone = (key: string) => ({
  key,
  value: null,
  encryptedValue: null,
  encryptionIv: null,
  encryptionTag: null,
  updatedAt: new Date('2026-08-27T09:00:00.000Z'),
  updatedBy: 1,
});

describe('configService explicit-unset tombstones', () => {
  const originalRetention = process.env.WHATSAPP_RETENTION_DAYS;
  const originalAppSecret = process.env.WHATSAPP_META_APP_SECRET;
  const originalContactHashKey = process.env.WHATSAPP_CONTACT_HASH_KEY;
  const originalQueueKeyId = process.env.WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID;
  const originalQueueKey = process.env.WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalRetention === undefined) delete process.env.WHATSAPP_RETENTION_DAYS;
    else process.env.WHATSAPP_RETENTION_DAYS = originalRetention;
    if (originalAppSecret === undefined) delete process.env.WHATSAPP_META_APP_SECRET;
    else process.env.WHATSAPP_META_APP_SECRET = originalAppSecret;
    if (originalContactHashKey === undefined) delete process.env.WHATSAPP_CONTACT_HASH_KEY;
    else process.env.WHATSAPP_CONTACT_HASH_KEY = originalContactHashKey;
    if (originalQueueKeyId === undefined) delete process.env.WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID;
    else process.env.WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID = originalQueueKeyId;
    if (originalQueueKey === undefined) delete process.env.WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY;
    else process.env.WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY = originalQueueKey;
  });

  it('still parses a registered default when no override row exists', () => {
    delete process.env.WHATSAPP_RETENTION_DAYS;

    expect(hasConfigValueOverride('WHATSAPP_RETENTION_DAYS')).toBe(false);
    expect(getConfigValueRaw('WHATSAPP_RETENTION_DAYS')).toBe('7');
    expect(getConfigValue('WHATSAPP_RETENTION_DAYS')).toBe(7);
  });

  it('suppresses environment and default fallbacks for tombstoned values', async () => {
    process.env.WHATSAPP_RETENTION_DAYS = '6';
    process.env.WHATSAPP_META_APP_SECRET = 'environment-secret-fallback';
    process.env.WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY_ID = 'legacy-key';
    process.env.WHATSAPP_WEBHOOK_QUEUE_ACTIVE_KEY = Buffer.alloc(32, 8).toString('base64');
    configValueModel.findAll.mockResolvedValue([
      tombstone('WHATSAPP_RETENTION_DAYS'),
      tombstone('WHATSAPP_META_APP_SECRET'),
      tombstone('WHATSAPP_WEBHOOK_QUEUE_KEYRING'),
    ]);

    await refreshConfigCache();

    expect(hasConfigValueOverride('WHATSAPP_RETENTION_DAYS')).toBe(true);
    expect(getConfigValueRaw('WHATSAPP_RETENTION_DAYS')).toBeNull();
    expect(getConfigValue('WHATSAPP_RETENTION_DAYS')).toBeNull();
    expect(getConfigValueRaw('WHATSAPP_META_APP_SECRET')).toBeNull();
    expect(() => getWhatsAppWebhookQueueConfig()).toThrow(
      'Missing required WhatsApp configuration: WHATSAPP_WEBHOOK_QUEUE_KEYRING',
    );
  });

  it('reports tombstones as unset in list, detail, and secret reveal responses', async () => {
    const retentionTombstone = tombstone('WHATSAPP_RETENTION_DAYS');
    const secretTombstone = tombstone('WHATSAPP_META_APP_SECRET');
    configValueModel.findAll.mockResolvedValue([retentionTombstone, secretTombstone]);
    await refreshConfigCache();
    configKeyModel.findAll.mockResolvedValue([
      retentionDefinitionRecord,
      appSecretDefinitionRecord,
    ]);

    const entries = await listConfigEntries();
    expect(entries).toEqual([
      expect.objectContaining({
        key: 'WHATSAPP_RETENTION_DAYS',
        value: null,
        isSet: false,
        isCleared: true,
      }),
      expect.objectContaining({
        key: 'WHATSAPP_META_APP_SECRET',
        value: null,
        maskedValue: null,
        isSet: false,
        isCleared: true,
      }),
    ]);

    configKeyModel.findByPk.mockResolvedValue(appSecretDefinitionRecord);
    configValueModel.findByPk.mockResolvedValue(secretTombstone);
    await expect(getConfigDetail('WHATSAPP_META_APP_SECRET')).resolves.toEqual(
      expect.objectContaining({
        value: null,
        maskedValue: null,
        isSet: false,
        isCleared: true,
      }),
    );
    await expect(revealConfigSecret('WHATSAPP_META_APP_SECRET')).resolves.toEqual({ value: null });
  });

  it('persists a cleared optional override as a tombstone', async () => {
    process.env.WHATSAPP_CONTACT_HASH_KEY = 'environment-contact-hash-fallback';
    const existing = {
      ...tombstone('WHATSAPP_CONTACT_HASH_KEY'),
      encryptedValue: 'encrypted-old-value',
      encryptionIv: 'old-iv',
      encryptionTag: 'old-tag',
      update: jest.fn().mockImplementation(function update(values: Record<string, unknown>) {
        Object.assign(this, values);
        return Promise.resolve(this);
      }),
    };
    const definitionRecord = {
      ...appSecretDefinitionRecord,
      key: 'WHATSAPP_CONTACT_HASH_KEY',
      label: 'WhatsApp contact hash key',
    };
    configKeyModel.findByPk.mockResolvedValue(definitionRecord);
    configValueModel.findByPk.mockResolvedValue(existing);
    configHistoryModel.create.mockResolvedValue({});

    const result = await updateConfigValue({
      key: 'WHATSAPP_CONTACT_HASH_KEY',
      value: null,
      actorId: 1,
    });

    expect(existing.update).toHaveBeenCalledWith({
      value: null,
      encryptedValue: null,
      encryptionIv: null,
      encryptionTag: null,
      updatedBy: 1,
    });
    expect(configValueModel.create).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      isSet: false,
      isCleared: true,
      maskedValue: null,
    }));
    expect(hasConfigValueOverride('WHATSAPP_CONTACT_HASH_KEY')).toBe(true);
    expect(getConfigValueRaw('WHATSAPP_CONTACT_HASH_KEY')).toBeNull();
    await expect(revealConfigSecret('WHATSAPP_CONTACT_HASH_KEY')).resolves.toEqual({ value: null });
  });
});
