import type { QueryInterface } from 'sequelize';
import { up, down, verify } from '../202610210002-food-tour-guide-label.js';

it('renames only the legacy exclusive Food Tour role without changing identity, members, scope or permissions', async () => {
  const transaction = {};
  const query = jest.fn().mockResolvedValue([[], {}]);
  const context = { sequelize: { query, transaction: jest.fn(async run => run(transaction)) } } as unknown as QueryInterface;
  await up({ context });
  const sql = query.mock.calls[0][0];
  expect(sql).toContain("SET name = 'Food Tour Guide'");
  expect(sql).toContain("r.slug = 'food-tour-owner-member'");
  expect(sql).toContain("r.name LIKE 'Food Tour Owner%Team member'");
  expect(sql).toContain('COUNT(*)');
  expect(sql).not.toMatch(/SET slug|DELETE|INSERT|UPDATE users|UPDATE user_type_product_types/i);
  query.mockClear(); await down(); expect(query).not.toHaveBeenCalled();
});
it.each([true, false])('verifies the old label is no longer present (ready=%s)', async ready => {
  const context = { sequelize: { query: jest.fn().mockResolvedValue([[{ ready }], {}]) } } as unknown as QueryInterface;
  expect((await verify({ context })).ok).toBe(ready);
});
