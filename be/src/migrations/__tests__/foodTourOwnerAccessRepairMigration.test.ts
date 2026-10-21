import type { QueryInterface } from 'sequelize';
import { up, down, verify, PAGE_GRANTS, MODULE_GRANTS } from '../202610210005-food-tour-owner-access-repair.js';
import { PRODUCT_SCOPED_MODULES, PRODUCT_SCOPED_PAGES } from '../../services/productScopedApiPolicy.js';

function setup({ eligible = true, changed = true, missingCatalog = false, pagesReady = true, modulesReady = true } = {}) {
  const transaction = {};
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('SELECT r.id, s.product_type_id')) return [eligible ? [{ id: 77, product_type_id: 27 }] : [], {}];
    if (sql.includes('SELECT id FROM pages')) return [missingCatalog ? [] : PAGE_GRANTS.map((_, id) => ({ id })), {}];
    if (sql.includes('SELECT m.id, a.id AS action_id')) return [MODULE_GRANTS.map((_, id) => ({ id })), {}];
    if (sql.includes('RETURNING id')) return [changed ? [{ id: 101 }] : [], {}];
    if (sql.includes('AS pages_ready')) return [[{ pages_ready: pagesReady, modules_ready: modulesReady }], {}];
    return [[], {}];
  });
  const context = { sequelize: { query, transaction: jest.fn(async run => run(transaction)) } } as unknown as QueryInterface;
  return { query, transaction, context };
}

it('restores only the exact product-isolated page and action grants, never global Owner access', () => {
  expect(PAGE_GRANTS).toHaveLength(9); expect(MODULE_GRANTS).toHaveLength(20);
  expect(PAGE_GRANTS.every(page => PRODUCT_SCOPED_PAGES.has(page))).toBe(true);
  expect(MODULE_GRANTS.every(grant => PRODUCT_SCOPED_MODULES.has(grant.module_slug))).toBe(true);
  expect(MODULE_GRANTS.filter(grant => grant.module_slug === 'finance-reports').map(grant => grant.action_key)).toEqual(['view']);
  expect(MODULE_GRANTS.filter(grant => grant.module_slug === 'user-directory').map(grant => grant.action_key)).toEqual(['view', 'create', 'update']);
  expect(PAGE_GRANTS).not.toContain('settings-permissions');
  expect(PAGE_GRANTS).not.toContain('settings-control-panel');
});
it('locks and verifies the existing role and exclusive Food Tour scope, without hardcoded database IDs', async () => {
  const { query, context, transaction } = setup();
  await up({ context });
  const calls = query.mock.calls as unknown as Array<[string, { transaction?: unknown; replacements?: Record<string, unknown> }]>;
  expect(calls[0][0]).toContain("WHERE slug = 'food-tour-owner' ORDER BY id FOR UPDATE");
  expect(calls[1][0]).toContain('COUNT(*) FROM user_type_product_types');
  expect(calls[1][0]).toContain("'^food tour($|[ -])'");
  expect(calls[1][0]).toContain('r.status = TRUE');
  expect(calls.every(([, options]) => options.transaction === transaction)).toBe(true);
  const inserts = calls.filter(([sql]) => /INSERT INTO "role(?:Page|Module)Permissions"/u.test(sql));
  expect(inserts).toHaveLength(2);
  expect(inserts.every(([, options]) => options.replacements?.roleId === 77)).toBe(true);
  expect(calls.map(([sql]) => sql).join('\n')).not.toMatch(/UPDATE "userTypes"|INSERT INTO users|DELETE FROM|DROP |INSERT INTO user_type_product_types/iu);
  expect(calls.find(([sql]) => sql.includes('INSERT INTO audit_logs'))?.[1].replacements?.meta).toContain('"productTypeIds":[27]');
});
it('does not grant anything to absent, inactive, shared, unscoped or non-Food-Tour roles', async () => {
  const { query, context } = setup({ eligible: false });
  await up({ context });
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
});
it('fails before writing if the reviewed pages or enabled module actions are unavailable', async () => {
  const { query, context } = setup({ missingCatalog: true });
  await expect(up({ context })).rejects.toThrow('requires all product-isolated pages and enabled module actions');
  expect(query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
});
it('leaves unrelated permissions intact and avoids timestamps/audit churn on repeat execution', async () => {
  const { query, context } = setup({ changed: false });
  await up({ context });
  const sql = query.mock.calls.map(([text]) => text).join('\n');
  expect(sql).toContain('IS DISTINCT FROM TRUE');
  expect(query.mock.calls.some(([text]) => text.includes('INSERT INTO audit_logs'))).toBe(false);
});
it.each([[true, true, true], [false, true, false], [true, false, false]])(
  'verifies page/module completeness (%s/%s => %s)', async (pagesReady, modulesReady, ok) => {
    const { context } = setup({ pagesReady, modulesReady });
    expect((await verify({ context })).ok).toBe(ok);
  },
);
it('treats an ineligible role as non-applicable without changing its existing scope or permissions', async () => {
  const { context } = setup({ eligible: false });
  expect(await verify({ context })).toEqual({ ok: true, details: { applicableRoles: 0, checks: [] } });
});
it('does not erase access-control edits or remove security scoping on rollback', async () => { await down(); });
