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
      { role_count: 1, granted_action_count: 2 },
    ], undefined]);

    await expect(migration.verify({ context })).resolves.toMatchObject({ ok: true });

    const [sql, options] = (context.sequelize.query as jest.Mock).mock.calls[0];
    expect(sql).toContain('COUNT(DISTINCT a.key)');
    expect(options.replacements).toMatchObject({
      actionKeys: ['create', 'update'],
      roleSlug: 'assistant-manager',
    });
  });

  it('fails verification when the role or either permission is missing', async () => {
    const { context } = buildContext();
    (context.sequelize.query as jest.Mock)
      .mockResolvedValueOnce([[{ role_count: 1, granted_action_count: 1 }], undefined])
      .mockResolvedValueOnce([[{ role_count: 0, granted_action_count: 0 }], undefined]);

    await expect(migration.verify({ context })).resolves.toMatchObject({ ok: false });
    await expect(migration.verify({ context })).resolves.toMatchObject({ ok: false });
  });

  it('uses a safe no-op rollback', async () => {
    const { context } = buildContext();

    await migration.down({ context });

    expect(context.sequelize.query).not.toHaveBeenCalled();
    expect(context.sequelize.transaction).not.toHaveBeenCalled();
  });
});
