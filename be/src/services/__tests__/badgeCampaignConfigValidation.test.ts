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
import { updateConfigValue } from '../configService';

const configKeyModel = ConfigKey as unknown as { findByPk: jest.Mock };
const configValueModel = ConfigValue as unknown as {
  create: jest.Mock;
  findByPk: jest.Mock;
};
const configHistoryModel = ConfigHistory as unknown as { create: jest.Mock };

const definitionRecord = {
  key: 'BADGE_CAMPAIGN_BASE_URL',
  label: 'Badge campaign URL',
  description: null,
  category: 'Badge Printing',
  valueType: 'string',
  defaultValue: 'https://krawlthroughkrakow.com/store2/pub-crawl-28/#book',
  validationRules: { required: true, maxLength: 2048, format: 'https-url' },
  isSecret: false,
  isEditable: true,
  isRevealable: true,
  isSystemManaged: false,
  impact: 'medium',
};

describe('badge campaign Control Panel validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configKeyModel.findByPk.mockResolvedValue(definitionRecord);
    configValueModel.findByPk.mockResolvedValue(null);
    configValueModel.create.mockResolvedValue({});
    configHistoryModel.create.mockResolvedValue({});
  });

  it('accepts the secure public store destination', async () => {
    const value = 'https://krawlthroughkrakow.com/store2/pub-crawl-28/#book';

    await expect(updateConfigValue({
      key: 'BADGE_CAMPAIGN_BASE_URL',
      value,
      actorId: 1,
    })).resolves.toEqual(expect.objectContaining({ value }));

    expect(configValueModel.create).toHaveBeenCalledWith(expect.objectContaining({
      key: 'BADGE_CAMPAIGN_BASE_URL',
      value,
    }));
  });

  it.each([
    null,
    '/relative-store',
    'http://store.example.com/pub-crawl',
    'https://user:password@store.example.com/pub-crawl',
    'not a URL',
  ])('rejects an unsafe campaign destination: %p', async (value) => {
    await expect(updateConfigValue({
      key: 'BADGE_CAMPAIGN_BASE_URL',
      value,
      actorId: 1,
    })).rejects.toThrow(
      value === null
        ? 'BADGE_CAMPAIGN_BASE_URL is required'
        : 'BADGE_CAMPAIGN_BASE_URL must be a valid HTTPS URL without embedded credentials',
    );

    expect(configValueModel.create).not.toHaveBeenCalled();
    expect(configHistoryModel.create).not.toHaveBeenCalled();
  });
});
