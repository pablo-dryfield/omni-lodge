const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockDatabase = {
  transaction: jest.fn(async (callback: (transaction: typeof mockTransaction) => unknown) =>
    callback(mockTransaction)),
};

jest.mock('../../models/ConfigKey.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn(), findAll: jest.fn() },
}));
jest.mock('../../models/ConfigValue.js', () => ({
  __esModule: true,
  default: {
    sequelize: mockDatabase,
    create: jest.fn(),
    findByPk: jest.fn(),
    findAll: jest.fn(),
  },
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
  encryptSecret: jest.fn(() => ({
    encryptedValue: 'ciphertext',
    iv: 'iv',
    tag: 'tag',
  })),
}));
jest.mock('../seedRunService.js', () => ({
  hasSeedRun: jest.fn(),
  recordSeedRun: jest.fn(),
  listSeedRuns: jest.fn(),
}));

import ConfigHistory from '../../models/ConfigHistory';
import ConfigKey from '../../models/ConfigKey';
import ConfigValue from '../../models/ConfigValue';
import { updateSystemConfigValues } from '../configService';

const configKeyModel = ConfigKey as unknown as { findByPk: jest.Mock };
const configValueModel = ConfigValue as unknown as {
  sequelize: typeof mockDatabase;
  create: jest.Mock;
  findByPk: jest.Mock;
};
const configHistoryModel = ConfigHistory as unknown as { create: jest.Mock };

describe('system-managed config writes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configValueModel.sequelize = mockDatabase;
    configKeyModel.findByPk.mockResolvedValue({});
  });

  it('encrypts and commits the onboarding tuple atomically with correct audit history', async () => {
    const wabaRecord = {
      value: '111',
      update: jest.fn().mockImplementation(function update(values: Record<string, unknown>) {
        Object.assign(this, values);
        return Promise.resolve(this);
      }),
    };
    configValueModel.findByPk.mockImplementation(async (key: string) =>
      key === 'WHATSAPP_WABA_ID' ? wabaRecord : null);

    await updateSystemConfigValues({
      values: {
        WHATSAPP_BUSINESS_ACCESS_TOKEN: 't'.repeat(64),
        WHATSAPP_WABA_ID: '222',
      },
      actorId: 7,
      reason: 'Embedded Signup test',
    });

    expect(mockDatabase.transaction).toHaveBeenCalledTimes(1);
    expect(wabaRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ value: '222', updatedBy: 7 }),
      { transaction: mockTransaction },
    );
    expect(configValueModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'WHATSAPP_BUSINESS_ACCESS_TOKEN',
        value: null,
        encryptedValue: 'ciphertext',
      }),
      { transaction: mockTransaction },
    );
    expect(configHistoryModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'WHATSAPP_WABA_ID',
        oldValue: '111',
        newValue: '222',
      }),
      { transaction: mockTransaction },
    );
    expect(configHistoryModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'WHATSAPP_BUSINESS_ACCESS_TOKEN',
        oldValue: null,
        newValue: null,
        isSecret: true,
      }),
      { transaction: mockTransaction },
    );
  });

  it('refuses to use the privileged writer for an ordinary editable setting', async () => {
    await expect(updateSystemConfigValues({
      values: { WHATSAPP_RETENTION_DAYS: 5 },
      actorId: 7,
      reason: 'test',
    })).rejects.toThrow('WHATSAPP_RETENTION_DAYS is not system-managed');
    expect(mockDatabase.transaction).not.toHaveBeenCalled();
  });
});
