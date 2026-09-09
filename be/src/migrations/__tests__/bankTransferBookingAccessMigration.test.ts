import {
  down,
  up,
  verify,
} from '../202609070010-bank-transfer-booking-access.js';

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

describe('bank-transfer booking access migration', () => {
  it('creates a dedicated module for management roles without granting assistant-manager access', async () => {
    const setup = createContext();

    await up({ context: setup.context });

    const sql = setup.query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('roleModulePermissions');
    expect(setup.query.mock.calls.every(([, options]) =>
      (options as { replacements?: { moduleSlug?: string } })?.replacements?.moduleSlug
        === 'bank-transfer-booking-management',
    )).toBe(true);

    const roleGrant = setup.query.mock.calls.find(([statement]) =>
      String(statement).includes('INSERT INTO "roleModulePermissions"'),
    );
    expect(roleGrant?.[1]).toEqual(expect.objectContaining({
      transaction: setup.transaction,
      replacements: expect.objectContaining({
        roleSlugs: ['admin', 'administrator', 'owner', 'manager'],
        actionKeys: ['view', 'create', 'update'],
      }),
    }));
    expect(
      (roleGrant?.[1] as { replacements?: { roleSlugs?: string[] } })?.replacements?.roleSlugs,
    ).not.toContain('assistant-manager');
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.transaction.rollback).not.toHaveBeenCalled();
  });

  it('removes only the dedicated module and its permission links on rollback', async () => {
    const setup = createContext();

    await down({ context: setup.context });

    const sql = setup.query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('DELETE FROM "roleModulePermissions"');
    expect(sql).toContain('DELETE FROM "moduleActions"');
    expect(sql).toContain('DELETE FROM modules WHERE slug = :moduleSlug');
    expect(setup.query.mock.calls.every(([, options]) =>
      (options as { replacements?: { moduleSlug?: string } })?.replacements?.moduleSlug
        === 'bank-transfer-booking-management',
    )).toBe(true);
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('verifies the module, its three actions, and default management grants', async () => {
    const setup = createContext();
    setup.query.mockResolvedValueOnce([[
      {
        module_exists: true,
        action_count: 3,
        default_role_count: 4,
        default_roles_have_access: true,
      },
    ]]);

    await expect(verify({ context: setup.context })).resolves.toEqual({
      ok: true,
      details: {
        access: {
          module_exists: true,
          action_count: 3,
          default_role_count: 4,
          default_roles_have_access: true,
        },
      },
    });
  });
});
