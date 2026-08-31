import {
  down,
  up,
  verify,
} from '../202608310001-home-quick-action-config.js';

const createContext = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const query = jest.fn().mockResolvedValue(undefined);
  const createTable = jest.fn().mockResolvedValue(undefined);
  const addConstraint = jest.fn().mockResolvedValue(undefined);
  const addIndex = jest.fn().mockResolvedValue(undefined);
  const dropTable = jest.fn().mockResolvedValue(undefined);
  return {
    context: {
      sequelize: {
        transaction: jest.fn().mockResolvedValue(transaction),
        query,
      },
      createTable,
      addConstraint,
      addIndex,
      dropTable,
    } as never,
    transaction,
    query,
    createTable,
    addConstraint,
    addIndex,
    dropTable,
  };
};

describe('home quick action configuration migration', () => {
  it('creates durable configs and normalized audience targets', async () => {
    const setup = createContext();

    await up({ context: setup.context });

    expect(setup.createTable).toHaveBeenNthCalledWith(
      1,
      'home_quick_action_configs',
      expect.objectContaining({ action_key: expect.objectContaining({ primaryKey: true }) }),
      expect.objectContaining({ transaction: setup.transaction }),
    );
    expect(setup.createTable).toHaveBeenNthCalledWith(
      2,
      'home_quick_action_targets',
      expect.objectContaining({
        action_key: expect.objectContaining({ onDelete: 'CASCADE' }),
        user_id: expect.objectContaining({ references: { model: 'users', key: 'id' } }),
        user_type_id: expect.objectContaining({ references: { model: 'userTypes', key: 'id' } }),
        shift_role_id: expect.objectContaining({ references: { model: 'shift_roles', key: 'id' } }),
      }),
      expect.objectContaining({ transaction: setup.transaction }),
    );
    expect(setup.query.mock.calls.map(([sql]) => String(sql)).join('\n')).toContain(
      'num_nonnulls(user_id, user_type_id, shift_role_id, staff_profile_type) = 1',
    );
    expect(setup.query.mock.calls.map(([sql]) => String(sql)).join('\n')).toContain(
      "staff_profile_type IN ('volunteer', 'long_term', 'assistant_manager', 'manager', 'guide')",
    );
    expect(setup.addIndex).toHaveBeenCalledTimes(4);
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.transaction.rollback).not.toHaveBeenCalled();
  });

  it('drops targets before configs on rollback', async () => {
    const setup = createContext();

    await down({ context: setup.context });

    expect(setup.dropTable.mock.calls.map(([table]) => table)).toEqual([
      'home_quick_action_targets',
      'home_quick_action_configs',
    ]);
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('verifies both tables exist', async () => {
    const setup = createContext();
    setup.query.mockResolvedValueOnce([[
      { table_name: 'home_quick_action_configs' },
      { table_name: 'home_quick_action_targets' },
    ]]);

    await expect(verify({ context: setup.context })).resolves.toEqual({
      ok: true,
      details: { missing: [] },
    });
  });
});
