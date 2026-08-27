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
import {
  getWhatsAppConfigValue,
  getWhatsAppWebhookQueueConfig,
  resolveWhatsAppOnboardingGeneration,
} from '../../config/whatsappConfig';
import { getConfigValueRaw, refreshConfigCache, updateConfigValue } from '../configService';
import { decryptSecret, encryptSecret } from '../configEncryptionService';

const configKeyModel = ConfigKey as unknown as { findByPk: jest.Mock };
const configValueModel = ConfigValue as unknown as {
  create: jest.Mock;
  findByPk: jest.Mock;
  findAll: jest.Mock;
};
const configHistoryModel = ConfigHistory as unknown as { create: jest.Mock };
const mockEncryptSecret = encryptSecret as jest.MockedFunction<typeof encryptSecret>;
const mockDecryptSecret = decryptSecret as jest.MockedFunction<typeof decryptSecret>;

describe('WhatsApp control-panel validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configKeyModel.findByPk.mockResolvedValue({ isEditable: true });
  });

  it('feeds default WhatsApp reads from the dynamic config cache', async () => {
    configValueModel.findAll.mockResolvedValue([
      {
        key: 'WHATSAPP_RETENTION_DAYS',
        value: '5',
        updatedAt: new Date('2026-08-27T08:00:00.000Z'),
        updatedBy: 1,
      },
      {
        key: 'WHATSAPP_SOURCE_STALE_HOURS',
        value: '48',
        updatedAt: new Date('2026-08-27T08:00:00.000Z'),
        updatedBy: 1,
      },
      {
        key: 'WHATSAPP_ONBOARDING_GENERATION',
        value: 'generation-cache',
        updatedAt: new Date('2026-08-27T08:00:00.000Z'),
        updatedBy: 1,
      },
    ]);

    await refreshConfigCache();

    expect(getConfigValueRaw('WHATSAPP_RETENTION_DAYS')).toBe('5');
    expect(getWhatsAppConfigValue('WHATSAPP_RETENTION_DAYS')).toBe('5');
    expect(getWhatsAppConfigValue('WHATSAPP_SOURCE_STALE_HOURS')).toBe('48');
    expect(resolveWhatsAppOnboardingGeneration()).toBe('generation-cache');
  });

  it('loads the atomic composite keyring from the dynamic config cache', async () => {
    const keyring = [3, 2]
      .map((key) => `key-${key}=${Buffer.alloc(32, key).toString('base64')}`)
      .join(',');
    mockDecryptSecret.mockReturnValue(keyring);
    configValueModel.findAll.mockResolvedValue([{
      key: 'WHATSAPP_WEBHOOK_QUEUE_KEYRING',
      value: null,
      encryptedValue: 'encrypted-keyring',
      encryptionIv: 'keyring-iv',
      encryptionTag: 'keyring-tag',
      updatedAt: new Date('2026-08-27T08:00:00.000Z'),
      updatedBy: 1,
    }]);

    await refreshConfigCache();

    expect(getWhatsAppWebhookQueueConfig()).toEqual({
      activeKey: { id: 'key-3', material: Buffer.alloc(32, 3) },
      decryptionKeys: new Map([
        ['key-3', Buffer.alloc(32, 3)],
        ['key-2', Buffer.alloc(32, 2)],
      ]),
    });
  });

  it('accepts and encrypts one valid composite queue keyring update', async () => {
    const value = [2, 1]
      .map((key) => `key-${key}=${Buffer.alloc(32, key).toString('base64')}`)
      .join(',');
    configValueModel.findByPk.mockResolvedValue(null);
    configValueModel.create.mockResolvedValue({});
    configHistoryModel.create.mockResolvedValue({});
    mockEncryptSecret.mockReturnValue({
      encryptedValue: 'encrypted-keyring',
      iv: 'keyring-iv',
      tag: 'keyring-tag',
    });

    await updateConfigValue({
      key: 'WHATSAPP_WEBHOOK_QUEUE_KEYRING',
      value,
      actorId: 1,
    });

    expect(configValueModel.create).toHaveBeenCalledWith({
      key: 'WHATSAPP_WEBHOOK_QUEUE_KEYRING',
      value: null,
      encryptedValue: 'encrypted-keyring',
      encryptionIv: 'keyring-iv',
      encryptionTag: 'keyring-tag',
      updatedBy: 1,
    });
  });

  it.each([
    ['WHATSAPP_META_APP_SECRET', 'z'.repeat(32), '32-character hexadecimal'],
    ['WHATSAPP_WABA_ID', 'waba-1', 'numeric Meta identifier'],
    ['WHATSAPP_PHONE_NUMBER_ID', 'phone-1', 'numeric Meta identifier'],
    ['WHATSAPP_BRIEF_API_TOKEN', 'x'.repeat(31), 'at least 32 characters'],
    ['WHATSAPP_CONTACT_HASH_KEY', 'x'.repeat(31), 'at least 32 characters'],
    ['WHATSAPP_RETENTION_DAYS', 1.5, 'must be an integer'],
    ['WHATSAPP_SOURCE_STALE_HOURS', 169, 'must be <= 168'],
    [
      'WHATSAPP_WEBHOOK_QUEUE_KEYRING',
      [1, 2, 3, 4, 5]
        .map((key) => `key-${key}=${Buffer.alloc(32, key).toString('base64')}`)
        .join(','),
      'supports at most 4 keys',
    ],
    [
      'WHATSAPP_WEBHOOK_QUEUE_KEYRING',
      `key-1=${Buffer.alloc(32, 1).toString('base64')},key-1=${Buffer.alloc(32, 2).toString('base64')}`,
      'contains a duplicate key ID',
    ],
  ])('rejects an invalid %s value', async (key, value, message) => {
    await expect(
      updateConfigValue({ key, value, actorId: 1 }),
    ).rejects.toThrow(message as string);
  });
});
