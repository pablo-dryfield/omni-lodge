import type { QueryInterface } from 'sequelize';
import * as migration from '../202609260001-assistant-manager-review-management-access.js';

const buildContext = () => {
  const transaction = { commit: jest.fn(), rollback: jest.fn() };
  const context = {
    sequelize: {
      transaction: jest.fn().mockResolvedValue(transaction),
      query: jest.fn().mockResolvedValue([[], undefined]),
    },
  } as unknown as QueryInterface;
  return { context, transaction };
};

describe('assistant manager review management access migration', () => {
  it('idempotently grants create and update permissions', async () => {
    const { context, transaction } = buildContext();

    await migration.up({ context });

    const [sql, options] = (context.sequelize.query as jest.Mock).mock.calls[0];
    expect(sql).toContain('roleModulePermissions');
    expect(sql).toContain('ON CONFLICT');
    expect(options).toEqual({
      transaction,
      replacements: {
        actionKeys: ['create', 'update'],
        moduleSlug: 'review-counter-management',
        roleSlug: 'assistant-manager',
      },
    });
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('rolls back when the permission upsert fails', async () => {
    const { context, transaction } = buildContext();
    (context.sequelize.query as jest.Mock).mockRejectedValueOnce(new Error('access write failed'));

    await expect(migration.up({ context })).rejects.toThrow('access write failed');

    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('verifies that both permissions are active', async () => {
    const { context } = buildContext();
    (context.sequelize.query as jest.Mock).mockResolvedValueOnce([[
      { assistant_manager_has_review_management: true },
    ], undefined]);

    await expect(migration.verify({ context })).resolves.toMatchObject({ ok: true });
  });

  it('uses a safe no-op rollback', async () => {
    const { context } = buildContext();

    await migration.down({ context });

    expect(context.sequelize.query).not.toHaveBeenCalled();
    expect(context.sequelize.transaction).not.toHaveBeenCalled();
  });
});
