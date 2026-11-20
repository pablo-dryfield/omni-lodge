import type { QueryInterface } from 'sequelize';
import * as migration from '../202611200001-assistant-manager-manifest-access.js';

const setup = () => {
  const transaction = {};
  const query = jest.fn().mockResolvedValue([[], undefined]);
  const context = { sequelize: { query, transaction: jest.fn(async (work: (value: object) => Promise<void>) => work(transaction)) } } as unknown as QueryInterface;
  return { context, query, transaction };
};

describe('assistant manager manifest access migration', () => {
  it('grants only bank-transfer view/update to assistant manager roles, idempotently', async () => {
    const { context, query, transaction } = setup();
    await migration.up({ context });
    const [sql, options] = query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('allowed = true, status = true');
    expect(options).toEqual({ transaction, replacements: {
      moduleSlug: 'bank-transfer-booking-management', actionKeys: ['view', 'update'],
      roleKeys: ['assistantmanager', 'assistmanager'],
    } });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('propagates errors through the managed migration transaction', async () => {
    const { context, query } = setup();
    query.mockRejectedValueOnce(new Error('permission grant failed'));
    await expect(migration.up({ context })).rejects.toThrow('permission grant failed');
  });
  it.each([true, false])('verifies the complete active grant instead of accepting a partial grant: %s', async allowed => {
    const { context, query } = setup();
    query.mockResolvedValueOnce([[{ module_count: 1, role_count: 1, roles_have_access: allowed }], undefined]);
    await expect(migration.verify({ context })).resolves.toMatchObject({ ok: allowed });
  });
  it.each([{ module_count: 0, role_count: 1 }, { module_count: 1, role_count: 0 }])(
    'allows the normal access-control seed to create missing optional catalog records: %j', async counts => {
      const { context, query } = setup();
      query.mockResolvedValueOnce([[{ ...counts, roles_have_access: false }], undefined]);
      await expect(migration.verify({ context })).resolves.toMatchObject({ ok: true });
    },
  );
  it('does not revoke existing or subsequently edited grants on rollback', async () => {
    const { context, query } = setup();
    await migration.down({ context });
    expect(query).not.toHaveBeenCalled();
  });
});
