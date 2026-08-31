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
import { replaceHomeQuickActionConfigs } from '../homeQuickActionService';

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
});
