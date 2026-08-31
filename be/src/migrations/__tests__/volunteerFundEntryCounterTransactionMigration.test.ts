import {
  down,
  up,
  verify,
} from '../202608310003-volunteer-fund-entry-counter-transaction.js';

const createContext = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const query = jest.fn().mockResolvedValue(undefined);
  const addColumn = jest.fn().mockResolvedValue(undefined);
  const removeColumn = jest.fn().mockResolvedValue(undefined);
  return {
    context: {
      sequelize: {
        transaction: jest.fn().mockResolvedValue(transaction),
        query,
      },
      addColumn,
      removeColumn,
    } as never,
    transaction,
    query,
    addColumn,
    removeColumn,
  };
};

describe('volunteer fund entry counter transaction migration', () => {
  it('adds a restricted counter-side FK, paired-allocation check, and partial unique index', async () => {
    const setup = createContext();

    await up({ context: setup.context });

    expect(setup.addColumn).toHaveBeenCalledWith(
      'volunteer_fund_entries',
      'finance_counter_transaction_id',
      expect.objectContaining({
        allowNull: true,
        references: { model: 'finance_transactions', key: 'id' },
        onDelete: 'RESTRICT',
      }),
      { transaction: setup.transaction },
    );
    const sql = setup.query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('volunteer_fund_entry_allocation_finance_pair_ck');
    expect(sql).toContain("entry_type = 'allocation'");
    expect(sql).toContain('finance_transaction_id IS NULL AND finance_counter_transaction_id IS NULL');
    expect(sql).toContain('finance_transaction_id IS NOT NULL');
    expect(sql).toContain('finance_counter_transaction_id IS NOT NULL');
    expect(sql).toContain('finance_transaction_id <> finance_counter_transaction_id');
    expect(sql).toContain("entry_type <> 'allocation' AND finance_counter_transaction_id IS NULL");
    expect(sql).toContain('CREATE UNIQUE INDEX volunteer_fund_entries_finance_counter_transaction_uidx');
    expect(sql).toContain('WHERE finance_counter_transaction_id IS NOT NULL');
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.transaction.rollback).not.toHaveBeenCalled();
  });

  it('drops the index and pair constraint before removing the column', async () => {
    const setup = createContext();

    await down({ context: setup.context });

    const statements = setup.query.mock.calls.map(([statement]) => String(statement));
    expect(statements[0]).toContain('DROP INDEX IF EXISTS volunteer_fund_entries_finance_counter_transaction_uidx');
    expect(statements[1]).toContain('DROP CONSTRAINT IF EXISTS volunteer_fund_entry_allocation_finance_pair_ck');
    expect(setup.removeColumn).toHaveBeenCalledWith(
      'volunteer_fund_entries',
      'finance_counter_transaction_id',
      { transaction: setup.transaction },
    );
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('rolls back when a schema step fails', async () => {
    const setup = createContext();
    setup.query.mockRejectedValueOnce(new Error('constraint failed'));

    await expect(up({ context: setup.context })).rejects.toThrow('constraint failed');

    expect(setup.transaction.rollback).toHaveBeenCalledTimes(1);
    expect(setup.transaction.commit).not.toHaveBeenCalled();
  });

  it('verifies the column, restricted FK, pair constraint, and partial unique index', async () => {
    const setup = createContext();
    setup.query.mockResolvedValueOnce([[
      {
        column_exists: true,
        pair_constraint_exists: true,
        restricted_foreign_key_exists: true,
        partial_unique_index_exists: true,
      },
    ]]);

    await expect(verify({ context: setup.context })).resolves.toEqual({
      ok: true,
      details: { missing: [] },
    });
  });
});
