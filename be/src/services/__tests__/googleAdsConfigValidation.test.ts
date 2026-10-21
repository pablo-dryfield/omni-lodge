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
jest.mock('../configEncryptionService.js', () => ({ decryptSecret: jest.fn(), encryptSecret: jest.fn() }));
jest.mock('../seedRunService.js', () => ({
  hasSeedRun: jest.fn(), recordSeedRun: jest.fn(), listSeedRuns: jest.fn(),
}));

import ConfigKey from '../../models/ConfigKey';
import ConfigValue from '../../models/ConfigValue';
import ConfigHistory from '../../models/ConfigHistory';
import { getConfigValue, refreshConfigCache, refreshConfigCacheKeys, updateConfigValue } from '../configService';

const key = 'GOOGLE_ADS_API_VERSION';
const originalVersion = process.env.GOOGLE_ADS_API_VERSION;

describe('Google Ads Control Panel configuration', () => {
  afterAll(() => {
    if (originalVersion === undefined) delete process.env.GOOGLE_ADS_API_VERSION;
    else process.env.GOOGLE_ADS_API_VERSION = originalVersion;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.GOOGLE_ADS_API_VERSION;
    (ConfigKey.findByPk as jest.Mock).mockResolvedValue({ key, isEditable: true, isSecret: false });
    (ConfigValue.findByPk as jest.Mock).mockResolvedValue(null);
    (ConfigValue.findAll as jest.Mock).mockResolvedValue([]);
    await refreshConfigCache();
  });

  it('uses the registry default when no override exists', () => {
    expect(getConfigValue(key)).toBe('v26');
  });

  it.each(['', '26', 'v0', 'v026', 'v26.1', 'v26/path', 'https://example.com', null])(
    'rejects invalid API version %s without saving anything', async (value) => {
      await expect(updateConfigValue({ key, value, actorId: 7 })).rejects.toThrow();
      expect(ConfigValue.create).not.toHaveBeenCalled();
      expect(ConfigHistory.create).not.toHaveBeenCalled();
    },
  );

  it('saves a valid change with actor, reason and previous version in the audit trail', async () => {
    const existing = { key, value: 'v25', update: jest.fn(async () => undefined) };
    (ConfigValue.findAll as jest.Mock).mockResolvedValue([existing]);
    (ConfigValue.findByPk as jest.Mock).mockResolvedValue(existing);
    await refreshConfigCache();

    await updateConfigValue({ key, value: 'v26', actorId: 7, reason: 'Upgrade supported Ads API' });

    expect(existing.update).toHaveBeenCalledWith(expect.objectContaining({ value: 'v26', updatedBy: 7 }));
    expect(ConfigHistory.create).toHaveBeenCalledWith({
      key, oldValue: 'v25', newValue: 'v26', actorId: 7, isSecret: false, reason: 'Upgrade supported Ads API',
    });
    expect(getConfigValue(key)).toBe('v26');
  });

  it('refreshes edits from another process without changing unrelated Google settings', async () => {
    (ConfigValue.findAll as jest.Mock).mockResolvedValue([
      { key: 'GOOGLE_ADS_CUSTOMER_ID', value: '1234567890' },
    ]);
    await refreshConfigCache();
    (ConfigValue.findAll as jest.Mock).mockResolvedValue([{ key, value: 'v25' }]);
    await refreshConfigCacheKeys([key]);

    expect(getConfigValue(key)).toBe('v25');
    expect(getConfigValue('GOOGLE_ADS_CUSTOMER_ID')).toBe('1234567890');
    expect(ConfigValue.create).not.toHaveBeenCalled();
    expect(ConfigHistory.create).not.toHaveBeenCalled();
  });
});
