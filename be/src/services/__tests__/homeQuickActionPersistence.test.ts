jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../models/AuditLog.js', () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));
jest.mock('../../models/HomeQuickActionConfig.js', () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    upsert: jest.fn(),
  },
}));
jest.mock('../../models/HomeQuickActionTarget.js', () => ({
  __esModule: true,
  default: {
    bulkCreate: jest.fn(),
    destroy: jest.fn(),
    findAll: jest.fn(),
  },
}));
jest.mock('../../models/StaffProfile.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

import sequelize from '../../config/database';
import AuditLog from '../../models/AuditLog';
import HomeQuickActionConfig from '../../models/HomeQuickActionConfig';
import HomeQuickActionTarget from '../../models/HomeQuickActionTarget';
import {
  HOME_PLANNED_PAYMENTS_CONFIG_KEY,
  replaceHomeQuickActionConfigs,
} from '../homeQuickActionService';

describe('home quick action configuration persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('locks the config without an outer join and loads targets separately for the audit snapshot', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    (sequelize.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));

    const existing = {
      actionKey: 'finance-record-transaction',
      enabled: true,
      audienceMode: 'targeted',
      sortOrder: 0,
      createdBy: 4,
      targets: undefined,
    };
    const previousTargets = [{
      effect: 'allow',
      userId: null,
      userTypeId: 3,
      shiftRoleId: null,
      staffProfileType: null,
    }];
    const savedRecord = {
      actionKey: 'finance-record-transaction',
      enabled: false,
      audienceMode: 'all',
      sortOrder: 0,
      createdBy: 4,
      targets: [],
    };

    (HomeQuickActionConfig.findByPk as jest.Mock).mockResolvedValue(existing);
    (HomeQuickActionTarget.findAll as jest.Mock).mockResolvedValue(previousTargets);
    (HomeQuickActionConfig.upsert as jest.Mock).mockResolvedValue([savedRecord, false]);
    (HomeQuickActionTarget.destroy as jest.Mock).mockResolvedValue(1);
    (HomeQuickActionConfig.findAll as jest.Mock).mockResolvedValue([savedRecord]);

    await replaceHomeQuickActionConfigs([{
      actionId: 'finance-record-transaction',
      enabled: false,
      audienceMode: 'all',
      allowUserIds: [],
      denyUserIds: [],
      userTypeIds: [],
      shiftRoleIds: [],
      staffProfileTypes: [],
    }], 9);

    expect(HomeQuickActionConfig.findByPk).toHaveBeenCalledWith(
      'finance-record-transaction',
      { transaction, lock: 'UPDATE' },
    );
    expect(HomeQuickActionTarget.findAll).toHaveBeenCalledWith({
      where: { actionKey: 'finance-record-transaction' },
      transaction,
      order: [['id', 'ASC']],
    });
    expect((HomeQuickActionTarget.findAll as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (HomeQuickActionTarget.destroy as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(AuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metaJson: {
          before: expect.objectContaining({
            actionId: 'finance-record-transaction',
            userTypeIds: [3],
          }),
          after: expect.objectContaining({ enabled: false }),
        },
      }),
      { transaction },
    );
  });

  it('persists the planned-payments homepage section with the same audience targets', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    (sequelize.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));

    const savedRecord = {
      actionKey: HOME_PLANNED_PAYMENTS_CONFIG_KEY,
      enabled: true,
      audienceMode: 'targeted',
      sortOrder: 0,
      createdBy: 9,
      targets: [{
        effect: 'allow',
        userId: null,
        userTypeId: 3,
        shiftRoleId: null,
        staffProfileType: null,
      }],
    };

    (HomeQuickActionConfig.findByPk as jest.Mock).mockResolvedValue(null);
    (HomeQuickActionConfig.upsert as jest.Mock).mockResolvedValue([savedRecord, true]);
    (HomeQuickActionTarget.destroy as jest.Mock).mockResolvedValue(0);
    (HomeQuickActionTarget.bulkCreate as jest.Mock).mockResolvedValue([]);
    (HomeQuickActionConfig.findAll as jest.Mock).mockResolvedValue([savedRecord]);

    const saved = await replaceHomeQuickActionConfigs([{
      actionId: HOME_PLANNED_PAYMENTS_CONFIG_KEY,
      enabled: true,
      audienceMode: 'targeted',
      allowUserIds: [],
      denyUserIds: [],
      userTypeIds: [3],
      shiftRoleIds: [7],
      staffProfileTypes: ['long_term'],
    }], 9);

    expect(HomeQuickActionConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        actionKey: HOME_PLANNED_PAYMENTS_CONFIG_KEY,
        enabled: true,
        audienceMode: 'targeted',
      }),
      { transaction, returning: true },
    );
    expect(HomeQuickActionTarget.bulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          actionKey: HOME_PLANNED_PAYMENTS_CONFIG_KEY,
          effect: 'allow',
          userTypeId: 3,
        }),
        expect.objectContaining({
          actionKey: HOME_PLANNED_PAYMENTS_CONFIG_KEY,
          effect: 'allow',
          shiftRoleId: 7,
        }),
        expect.objectContaining({
          actionKey: HOME_PLANNED_PAYMENTS_CONFIG_KEY,
          effect: 'allow',
          staffProfileType: 'long_term',
        }),
      ]),
      { transaction },
    );
    expect(saved).toEqual([
      expect.objectContaining({
        actionId: HOME_PLANNED_PAYMENTS_CONFIG_KEY,
        enabled: true,
        audienceMode: 'targeted',
        userTypeIds: [3],
      }),
    ]);
  });
});
