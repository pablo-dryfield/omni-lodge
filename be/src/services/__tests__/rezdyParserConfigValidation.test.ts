jest.mock('../../models/ConfigKey.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/ConfigValue.js', () => ({ __esModule: true, default: { create: jest.fn(), findByPk: jest.fn(), findAll: jest.fn() } }));
jest.mock('../../models/ConfigHistory.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../configEncryptionService.js', () => ({ decryptSecret: jest.fn(), encryptSecret: jest.fn() }));
jest.mock('../seedRunService.js', () => ({ hasSeedRun: jest.fn(), recordSeedRun: jest.fn(), listSeedRuns: jest.fn() }));

import ConfigKey from '../../models/ConfigKey.js';
import ConfigValue from '../../models/ConfigValue.js';
import ConfigHistory from '../../models/ConfigHistory.js';
import { CONFIG_DEFINITION_MAP } from '../../config/appConfigRegistry.js';
import { REZDY_DEFAULT_START_TIMES_KEY } from '../../config/rezdyParserConfig.js';
import { getConfigValue, refreshConfigCacheKeys, updateConfigValue } from '../configService.js';

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(ConfigKey.findByPk).mockResolvedValue({ isEditable: true } as ConfigKey);
  jest.mocked(ConfigValue.findByPk).mockResolvedValue(null);
  jest.mocked(ConfigValue.findAll).mockResolvedValue([]);
  await refreshConfigCacheKeys([REZDY_DEFAULT_START_TIMES_KEY]);
});

describe('Rezdy default departure configuration', () => {
  it('starts disabled and registers an editable validated Control Panel setting', () => {
    expect(getConfigValue(REZDY_DEFAULT_START_TIMES_KEY)).toEqual({});
    expect(CONFIG_DEFINITION_MAP.get(REZDY_DEFAULT_START_TIMES_KEY)).toMatchObject({ category: 'Booking Parsers',
      valueType: 'json', defaultValue: '{}', impact: 'medium', validation: { format: 'rezdy-default-start-times' } });
  });

  it('saves product times with the administrator and reason and updates live reads', async () => {
    await updateConfigValue({ key: REZDY_DEFAULT_START_TIMES_KEY, value: { PTEST01: '14:00', POTHER01: '00:00' },
      actorId: 7, reason: 'Confirmed standard departures' });
    expect(getConfigValue(REZDY_DEFAULT_START_TIMES_KEY)).toEqual({ PTEST01: '14:00', POTHER01: '00:00' });
    expect(ConfigHistory.create).toHaveBeenCalledWith(expect.objectContaining({ key: REZDY_DEFAULT_START_TIMES_KEY,
      actorId: 7, reason: 'Confirmed standard departures', isSecret: false }));
  });

  it.each([[], 14, '[]', { PTEST01: '24:00' }, { PTEST01: '14:60' }, { PTEST01: '2:00 PM' },
    { PTEST01: 14 }, { 'Krakow Food Tour': '14:00' }, { ptest01: '14:00' }])('rejects invalid defaults before changing stored values: %p', async (value) => {
    await expect(updateConfigValue({ key: REZDY_DEFAULT_START_TIMES_KEY, value, actorId: 7 })).rejects.toMatchObject({ status: 400 });
    expect(ConfigValue.create).not.toHaveBeenCalled();
    expect(ConfigHistory.create).not.toHaveBeenCalled();
  });

  it('refreshes changes made by another worker and supports disabling all defaults', async () => {
    jest.mocked(ConfigValue.findAll).mockResolvedValue([{ key: REZDY_DEFAULT_START_TIMES_KEY, value: '{"PTEST01":"15:00"}' }] as ConfigValue[]);
    await refreshConfigCacheKeys([REZDY_DEFAULT_START_TIMES_KEY]);
    expect(getConfigValue(REZDY_DEFAULT_START_TIMES_KEY)).toEqual({ PTEST01: '15:00' });
    await updateConfigValue({ key: REZDY_DEFAULT_START_TIMES_KEY, value: {}, actorId: 7 });
    expect(getConfigValue(REZDY_DEFAULT_START_TIMES_KEY)).toEqual({});
  });
});
