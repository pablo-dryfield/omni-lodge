import {
  down,
  up,
} from '../202609280004-reconcile-natalie-jamie-manager-swap.js';

const createContext = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const query = jest.fn().mockResolvedValue(undefined);
  return {
    context: {
      sequelize: {
        transaction: jest.fn().mockResolvedValue(transaction),
        query,
      },
    } as never,
    query,
    transaction,
  };
};

describe('Natalie and Jamie historical Manager swap reconciliation', () => {
  it('turns the existing approved swap into a Manager-only salary split', async () => {
    const { context, query, transaction } = createContext();

    await up({ context });

    const [sql, options] = query.mock.calls[0];
    expect(String(sql)).toContain("DATE '2026-09-24'");
    expect(String(sql)).toContain("DATE '2026-09-27'");
    expect(String(sql)).toContain("'salaryPolicy', 'takeover_split'");
    expect(String(sql)).toContain("'taskPolicy', 'retain_original_owner'");
    expect(String(sql)).toContain('SET user_id = request_row.partner_id');
    expect(String(sql)).toContain("'reconciliationKey', 'natalie-jamie-2026-09-24-27-manager-only'");
    expect(options.replacements).toBeUndefined();
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('removes only its marker and restores the prior owners on rollback', async () => {
    const { context, query, transaction } = createContext();

    await down({ context });

    const [sql] = query.mock.calls[0];
    expect(String(sql)).toContain("assignment_snapshot - 'roleBundle'");
    expect(String(sql)).toContain('from_assignment_id = NULL');
    expect(String(sql)).toContain('to_assignment_id = NULL');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });
});
