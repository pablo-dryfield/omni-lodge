import { up, down, verify } from '../202611030001-halloween-guiding-component.js';

it('seeds editable Halloween configuration atomically without mutating historical payouts', async () => {
  const transaction = {};
  const query = jest.fn(async () => [[], {}]);
  const context = { sequelize: { query, transaction: jest.fn(async callback => callback(transaction)) } };
  await up({ context: context as never });
  expect(query).toHaveBeenCalledTimes(1);
  const [sql, options] = query.mock.calls[0] as unknown as [string, { transaction: unknown }];
  expect(options.transaction).toBe(transaction);
  expect(sql).toContain('IF halloween_product_id IS NULL THEN RETURN');
  expect(sql).toContain("WHERE slug = 'halloween-pub-crawl-guiding'");
  expect(sql).toContain('RETURN; -- Preserve any existing administrator configuration');
  expect(sql).toContain('template.default_finance_account_id, template.default_finance_category_id');
  expect(sql).toContain("'settlementComponent', TRUE, 'reviewTargetRequired', TRUE");
  expect(sql).toContain("'productId', halloween_product_id, 'rate', 6");
  expect(sql).toContain('FROM compensation_component_assignments a WHERE component_id = template.id AND is_active = TRUE');
  expect(sql).toContain('INSERT INTO audit_logs');
  expect(sql).not.toMatch(/staff_payout|volunteer_fund|finance_transactions|\bUPDATE\s+[a-z_]|\bDELETE FROM|\bDROP TABLE/i);
  await down();
  expect(query).toHaveBeenCalledTimes(1);
});

it.each([true, false])('reports readiness %s without overriding administrator edits', async ready => {
  const context = { sequelize: { query: jest.fn(async () => [[{ ready }], {}]) } };
  expect(await verify({ context: context as never })).toMatchObject({ ok: ready });
});
