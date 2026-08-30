import {
  down,
  up,
} from '../202608300003-assistant-manager-salary-takeover-split.js';

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

describe('Assistant Manager Salary takeover-split migration', () => {
  it('adds an explicit 50/50 split from the August cutover', async () => {
    const { context, query, transaction } = createContext();

    await up({ context });

    const [sql, options] = query.mock.calls[0];
    expect(String(sql)).toContain("'{monthlyBase,taskCompletionProration,takeoverSplit}'");
    expect(String(sql)).toContain("slug = 'assistant-manager-salary'");
    expect(String(sql)).toContain("NOT ((config->'monthlyBase'->'taskCompletionProration') ? 'takeoverSplit')");
    expect(options.replacements.takeoverSplitConfig).toContain('"effectiveStart": "2026-08-01"');
    expect(options.replacements.takeoverSplitConfig).toContain('"shiftTakerPercent": 50');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('removes only the untouched seeded split on rollback', async () => {
    const { context, query, transaction } = createContext();

    await down({ context });

    const [sql, options] = query.mock.calls[0];
    expect(String(sql)).toContain("- 'takeoverSplit'");
    expect(String(sql)).toContain("->'takeoverSplit' =");
    expect(options.replacements.takeoverSplitConfig).toContain('"enabled": true');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });
});
