import { up } from '../202510020001-counter-registry.js';

describe('counter registry migration', () => {
  it('uses an enum-typed fallback for the nullable period in the unique index', async () => {
    const transaction = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    const query = jest.fn().mockImplementation(async (statement: unknown) => {
      if (String(statement).includes("to_regclass('public.")) {
        return { table: null };
      }
      return undefined;
    });
    const describeTable = jest.fn()
      .mockResolvedValueOnce({ total: {}, userId: {} })
      .mockResolvedValueOnce({ product_id: {}, status: {}, notes: {}, userId: {} })
      .mockResolvedValueOnce({ counterId: {}, userId: {} })
      .mockResolvedValueOnce({ counter_id: {}, user_id: {}, role: {} });
    const context = {
      sequelize: {
        transaction: jest.fn().mockResolvedValue(transaction),
        query,
        literal: jest.fn((value: string) => value),
      },
      describeTable,
      changeColumn: jest.fn().mockResolvedValue(undefined),
      removeColumn: jest.fn().mockResolvedValue(undefined),
      addColumn: jest.fn().mockResolvedValue(undefined),
      showIndex: jest.fn().mockResolvedValue([]),
      addIndex: jest.fn().mockResolvedValue(undefined),
      renameColumn: jest.fn().mockResolvedValue(undefined),
      createTable: jest.fn().mockResolvedValue(undefined),
    };

    await expect(up({ context: context as never })).resolves.toBeUndefined();

    const indexStatement = query.mock.calls
      .map(([statement]) => String(statement))
      .find((statement) => statement.includes('counter_channel_metrics_cell_unique'));
    expect(indexStatement).toContain(
      'COALESCE(period, \'before_cutoff\'::"enum_counter_channel_metrics_period")',
    );
    expect(indexStatement).not.toContain("COALESCE(period, '-')");
    expect(indexStatement).not.toContain('period::text');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
});
