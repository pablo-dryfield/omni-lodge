import type { QueryInterface } from 'sequelize';
import * as migration from '../202609060002-volunteer-progress-role-access-repair.js';

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

describe('volunteer progress role access repair migration', () => {
  it('idempotently grants page and module view access to the legacy volunteer role', async () => {
    const { context, transaction } = buildContext();

    await migration.up({ context });

    expect(context.sequelize.query).toHaveBeenCalledTimes(2);
    const calls = (context.sequelize.query as jest.Mock).mock.calls;
    const sql = calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('rolePagePermissions');
    expect(sql).toContain('roleModulePermissions');
    expect(sql).toContain('ON CONFLICT');
    calls.forEach(([, options]) => {
      expect(options).toEqual(expect.objectContaining({
        transaction,
        replacements: expect.objectContaining({
          roleSlug: 'pub-crawl-guide',
        }),
      }));
    });
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('rolls back when an access upsert fails', async () => {
    const { context, transaction } = buildContext();
    (context.sequelize.query as jest.Mock).mockRejectedValueOnce(new Error('access write failed'));

    await expect(migration.up({ context })).rejects.toThrow('access write failed');

    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('verifies access when the legacy volunteer role exists', async () => {
    const { context } = buildContext();
    (context.sequelize.query as jest.Mock).mockResolvedValueOnce([[
      {
        legacy_role_count: 1,
        legacy_role_has_view: true,
      },
    ], undefined]);

    await expect(migration.verify({ context })).resolves.toEqual({
      ok: true,
      details: {
        access: {
          legacy_role_count: 1,
          legacy_role_has_view: true,
        },
      },
    });

    const [sql, options] = (context.sequelize.query as jest.Mock).mock.calls[0];
    expect(sql).toContain('legacy_role_has_view');
    expect(sql).not.toContain("ut.slug = 'guide'");
    expect(options.replacements.roleSlug).toBe('pub-crawl-guide');

    (context.sequelize.query as jest.Mock).mockReset().mockResolvedValueOnce([[
      {
        legacy_role_count: 1,
        legacy_role_has_view: false,
      },
    ], undefined]);
    await expect(migration.verify({ context })).resolves.toMatchObject({ ok: false });
  });

  it('passes verification as an intentional no-op when the legacy role does not exist', async () => {
    const { context } = buildContext();
    (context.sequelize.query as jest.Mock).mockResolvedValueOnce([[
      {
        legacy_role_count: 0,
        legacy_role_has_view: true,
      },
    ], undefined]);

    await expect(migration.verify({ context })).resolves.toMatchObject({
      ok: true,
      details: {
        access: {
          legacy_role_count: 0,
          legacy_role_has_view: true,
        },
      },
    });
  });

  it('treats rollback as a no-op so valid access owned by the prior migration is preserved', async () => {
    const { context } = buildContext();

    await migration.down({ context });

    expect(context.sequelize.query).not.toHaveBeenCalled();
    expect(context.sequelize.transaction).not.toHaveBeenCalled();
  });
});
