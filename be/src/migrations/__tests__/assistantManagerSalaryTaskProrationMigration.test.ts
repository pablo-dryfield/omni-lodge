import {
  down,
  up,
} from '../202608300002-assistant-manager-salary-task-proration.js';

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

describe('Assistant Manager Salary task-proration migration', () => {
  it('enables the explicit August cutover without replacing existing custom config', async () => {
    const { context, query, transaction } = createContext();

    await up({ context });

    const [sql, options] = query.mock.calls[0];
    expect(String(sql)).toContain("slug = 'assistant-manager-salary'");
    expect(String(sql)).toContain("'{monthlyBase,taskCompletionProration}'");
    expect(String(sql)).toContain("NOT ((config->'monthlyBase') ? 'taskCompletionProration')");
    expect(options.replacements.taskProrationConfig).toContain('"effectiveStart": "2026-08-01"');
    expect(options.replacements.taskProrationConfig).toContain('"treatWaivedAsComplete": true');
    expect(options.replacements.taskProrationConfig).toContain('"treatPendingAsComplete": false');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('removes only the untouched seeded task-proration object on rollback', async () => {
    const { context, query, transaction } = createContext();

    await down({ context });

    const [sql, options] = query.mock.calls[0];
    expect(String(sql)).toContain("(config->'monthlyBase') - 'taskCompletionProration'");
    expect(String(sql)).toContain("config->'monthlyBase'->'taskCompletionProration' =");
    expect(options.replacements.taskProrationConfig).toContain('"enabled": true');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });
});
