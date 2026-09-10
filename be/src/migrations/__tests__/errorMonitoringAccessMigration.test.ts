import { down, up, verify } from '../202609090002-error-monitoring-access.js';

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
    transaction,
    query,
  };
};

describe('error monitoring access migration', () => {
  it('creates the page, module, actions, and restricted management grants', async () => {
    const setup = createContext();

    await up({ context: setup.context });

    const sql = setup.query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('INSERT INTO pages');
    expect(sql).toContain('rolePagePermissions');
    expect(sql).toContain('roleModulePermissions');
    expect(setup.query.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      replacements: { pageSlug: 'error-monitoring' },
    }));
    const roleGrant = setup.query.mock.calls.find(([statement]) =>
      String(statement).includes('INSERT INTO "roleModulePermissions"'),
    );
    expect(roleGrant?.[1]).toEqual(expect.objectContaining({
      replacements: expect.objectContaining({
        roleSlugs: ['admin', 'administrator', 'owner'],
        actionKeys: ['view', 'update'],
      }),
    }));
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.transaction.rollback).not.toHaveBeenCalled();
  });

  it('removes only the dedicated access records on rollback', async () => {
    const setup = createContext();

    await down({ context: setup.context });

    const sql = setup.query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('DELETE FROM "roleModulePermissions"');
    expect(sql).toContain('DELETE FROM "rolePagePermissions"');
    expect(sql).toContain('DELETE FROM modules');
    expect(sql).toContain('DELETE FROM pages');
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('passes when every present target role has page and module access', async () => {
    const setup = createContext();
    setup.query.mockResolvedValueOnce([[
      {
        module_exists: true,
        action_count: 2,
        target_role_count: 2,
        present_roles_have_access: true,
      },
    ]]);

    await expect(verify({ context: setup.context })).resolves.toMatchObject({ ok: true });
  });

  it('fails when the target roles are absent or a grant is incomplete', async () => {
    const noRoles = createContext();
    noRoles.query.mockResolvedValueOnce([[
      {
        module_exists: true,
        action_count: 2,
        target_role_count: 0,
        present_roles_have_access: true,
      },
    ]]);
    const incomplete = createContext();
    incomplete.query.mockResolvedValueOnce([[
      {
        module_exists: true,
        action_count: 2,
        target_role_count: 2,
        present_roles_have_access: false,
      },
    ]]);

    await expect(verify({ context: noRoles.context })).resolves.toMatchObject({ ok: false });
    await expect(verify({ context: incomplete.context })).resolves.toMatchObject({ ok: false });
  });
});
