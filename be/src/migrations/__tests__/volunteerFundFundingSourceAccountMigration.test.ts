import {
  down,
  up,
  verify,
} from '../202608310002-volunteer-fund-funding-source-account.js';

const createContext = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const query = jest.fn().mockResolvedValue(undefined);
  const addColumn = jest.fn().mockResolvedValue(undefined);
  const addIndex = jest.fn().mockResolvedValue(undefined);
  const removeIndex = jest.fn().mockResolvedValue(undefined);
  const removeColumn = jest.fn().mockResolvedValue(undefined);
  return {
    context: {
      sequelize: {
        transaction: jest.fn().mockResolvedValue(transaction),
        query,
      },
      addColumn,
      addIndex,
      removeIndex,
      removeColumn,
    } as never,
    transaction,
    query,
    addColumn,
    addIndex,
    removeIndex,
    removeColumn,
  };
};

describe('volunteer fund funding source account migration', () => {
  it('adds the nullable finance account reference and conservatively backfills Cash Register PLN', async () => {
    const setup = createContext();

    await up({ context: setup.context });

    expect(setup.addColumn).toHaveBeenCalledWith(
      'volunteer_funds',
      'funding_source_account_id',
      expect.objectContaining({
        allowNull: true,
        references: { model: 'finance_accounts', key: 'id' },
        onDelete: 'RESTRICT',
      }),
      { transaction: setup.transaction },
    );
    expect(setup.addIndex).toHaveBeenCalledWith(
      'volunteer_funds',
      ['funding_source_account_id'],
      expect.objectContaining({
        name: 'volunteer_funds_funding_source_account_idx',
        transaction: setup.transaction,
      }),
    );
    const sql = setup.query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('volunteer_funds_distinct_finance_accounts_ck');
    expect(sql).toContain('funding_source_account_id <> linked_account_id');
    expect(sql).toContain("account.type = 'cash'");
    expect(sql).toContain("= 'cashregisterpln'");
    expect(sql).toContain('UPPER(account.currency) = UPPER(fund.currency)');
    expect(sql).toContain('account.id IS DISTINCT FROM fund.linked_account_id');
    expect(sql).toContain('fund.is_active = TRUE');
    expect(sql).toContain('HAVING COUNT(*) = 1');
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.transaction.rollback).not.toHaveBeenCalled();
  });

  it('removes the index and distinct-account constraint before the column', async () => {
    const setup = createContext();

    await down({ context: setup.context });

    expect(setup.removeIndex).toHaveBeenCalledWith(
      'volunteer_funds',
      'volunteer_funds_funding_source_account_idx',
      { transaction: setup.transaction },
    );
    expect(setup.query).toHaveBeenCalledWith(
      expect.stringContaining('DROP CONSTRAINT IF EXISTS volunteer_funds_distinct_finance_accounts_ck'),
      { transaction: setup.transaction },
    );
    expect(setup.removeColumn).toHaveBeenCalledWith(
      'volunteer_funds',
      'funding_source_account_id',
      { transaction: setup.transaction },
    );
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('rolls back the migration when a schema step fails', async () => {
    const setup = createContext();
    setup.addIndex.mockRejectedValueOnce(new Error('index failed'));

    await expect(up({ context: setup.context })).rejects.toThrow('index failed');

    expect(setup.transaction.rollback).toHaveBeenCalledTimes(1);
    expect(setup.transaction.commit).not.toHaveBeenCalled();
  });

  it('verifies the new column and distinct-account constraint', async () => {
    const setup = createContext();
    setup.query.mockResolvedValueOnce([[
      {
        column_exists: true,
        distinct_constraint_exists: true,
        foreign_key_exists: true,
        index_exists: true,
      },
    ]]);

    await expect(verify({ context: setup.context })).resolves.toEqual({
      ok: true,
      details: { missing: [] },
    });
  });
});
