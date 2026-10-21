import type { QueryInterface } from 'sequelize';
import { up, down, verify } from '../202610210001-food-tour-role-scopes.js';

function setup(types: Array<{ id: number }> = [{ id: 3 }]) {
  const transaction = {};
  const query = jest.fn().mockResolvedValue([[], {}]).mockResolvedValueOnce([types, {}]);
  const context = { sequelize: { query, transaction: jest.fn(async run => run(transaction)) } } as unknown as QueryInterface;
  return { query, transaction, context };
}

it('locks roles and only adds missing Food Tour-prefixed scopes without hardcoded IDs or replacing explicit configuration', async () => {
  const { query, context, transaction } = setup([{ id: 27 }]);
  await up({ context });
  expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('ORDER BY id FOR UPDATE'), { transaction });
  expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining('INSERT INTO user_type_product_types'), {
    replacements: { foodTourId: 27 }, transaction,
  });
  const sql = query.mock.calls.map(args => args[0]).join('\n');
  expect(sql).toContain("slug LIKE 'food-tour-%'");
  expect(sql).toContain('WHERE s.user_type_id = r.id');
  expect(sql).toContain('ON CONFLICT (user_type_id, product_type_id) DO NOTHING');
  expect(sql).not.toMatch(/DELETE|DROP|UPDATE "userTypes"|INSERT INTO users/i);
});
it('does not change anything if Food Tour is not configured', async () => {
  const { query, context } = setup([]);
  await up({ context });
  expect(query).toHaveBeenCalledTimes(1);
});
it('fails safely for ambiguous Food Tour product types', async () => {
  const { query, context } = setup([{ id: 3 }, { id: 7 }]);
  await expect(up({ context })).rejects.toThrow('ambiguous');
  expect(query).toHaveBeenCalledTimes(1);
});
it('does not broaden access on rollback', async () => { await down(); });
it.each([true, false])('verifies missing scopes (ready=%s)', async ready => {
  const { query, context } = setup();
  query.mockReset().mockResolvedValue([[{ ready }], {}]);
  expect((await verify({ context })).ok).toBe(ready);
});
